#!/usr/bin/env node
/**
 * 本地一键打包脚本（2026-08-05，彻底解决 Windows 打包重复问题）
 *
 * 解决的问题：
 *  1) 客户端残留进程占用 win-unpacked 文件 → rm 失败（Device busy）→ 打包要重建
 *     - 启动测试时从 dist-rel/win-unpacked 直接运行，关闭后句柄可能未释放；
 *       脚本打包前先 taskkill 清理，不依赖人工。
 *  2) winCodeSign 解压 darwin 符号链接失败（exit 2）
 *     - 根因：Windows 普通用户无 SeCreateSymbolicLinkPrivilege（除非开发者模式），
 *       electron-builder 的 app-builder 用 `7za x -snld` 建符号链接必然失败。
 *     - 修复：把 scripts/7za-wrapper-win-x64.exe（Rust 编译，-snld→-snl-）替换
 *       node_modules/7zip-bin/win/x64/7za.exe（原版备份 7za_real.exe）。npm install 后重跑本脚本即可。
 *     - 根治：开启 Windows「开发者模式」并重启后，符号链接权限恢复，此补丁不再需要。
 *  3) electron zip 缓存损坏（BadZipFile）
 *     - 下载中断/被杀会留下损坏 zip。脚本用 7za t 校验缓存，损坏自动删除（重下走镜像）。
 *  4) ms-playwright 路径固定指向 Administrator（本机在其它用户名下不存在）
 *     - 脚本动态生成 build.local.json，检测当前用户 ms-playwright 路径。
 *  5) GitHub 下载卡死
 *     - 强制走 npmmirror 镜像（ELECTRON_MIRROR / ELECTRON_BUILDER_BINARIES_MIRROR）。
 *
 * 用法：node scripts/build-local.mjs   （或 npm run build:local，如需可自行加 script）
 */
import { execSync, execFileSync, spawnSync } from 'node:child_process'
import { existsSync, copyFileSync, writeFileSync, rmSync, readFileSync, mkdirSync, cpSync, readdirSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const S7Z = resolve(ROOT, 'node_modules/7zip-bin/win/x64/7za.exe')
const S7Z_REAL = resolve(ROOT, 'node_modules/7zip-bin/win/x64/7za_real.exe')
const WRAPPER = resolve(ROOT, 'scripts/7za-wrapper-win-x64.exe')
const ELECTRON_CACHE = process.env.LOCALAPPDATA ? resolve(process.env.LOCALAPPDATA, 'electron/Cache') : null
const OUT = resolve(ROOT, 'dist-rel')

const log = m => console.log(`[build-local] ${m}`)

// ── 1) 清理客户端残留进程 ──────────────────────────────
log('1/7 清理客户端残留进程…')
for (const name of ['AI营销助手.exe', 'electron.exe']) {
  try { execSync(`taskkill /F /IM "${name}"`, { stdio: 'ignore' }) } catch { /* 无进程则忽略 */ }
}

// ── 2) 应用 7za 符号链接补丁 ───────────────────────────
log('2/7 检查 7za 补丁…')
if (!existsSync(S7Z)) {
  console.error('❌ 找不到 7zip-bin，请先 npm install'); process.exit(1)
}
if (existsSync(WRAPPER)) {
  if (!existsSync(S7Z_REAL)) {
    copyFileSync(S7Z, S7Z_REAL)
    copyFileSync(WRAPPER, S7Z)
    log('已应用 7za wrapper（原版备份为 7za_real.exe）')
  } else {
    log('7za 补丁已在（原版 7za_real.exe 存在）')
  }
} else {
  log('⚠️ 未找到 scripts/7za-wrapper-win-x64.exe，跳过补丁（若 winCodeSign 解压失败请先开启开发者模式或生成 wrapper）')
}

// ── 3) 校验 electron 缓存 zip ──────────────────────────
log('3/7 校验 electron 缓存 zip…')
if (ELECTRON_CACHE && existsSync(ELECTRON_CACHE)) {
  let removed = 0
  for (const f of readdirSync(ELECTRON_CACHE)) {
    if (!f.endsWith('.zip')) continue
    const p = resolve(ELECTRON_CACHE, f)
    const t = spawnSync(S7Z, ['t', p], { stdio: 'ignore' })
    if (t.status !== 0) {
      rmSync(p, { force: true })
      log(`已删除损坏缓存: ${f}`); removed++
    }
  }
  if (removed === 0) log('缓存 zip 全部完好')
}

// ── 4) 2026-08-13 v1.0.30 纯壳：不再 next build / 不打包 standalone——
// 客户端直接加载服务器页面（https://ai-niuma.cc），本地无后端/无代理/无数据库
log('4/7 纯壳模式：跳过 Next standalone 构建（页面/API 全在服务器）…')

// 纯壳：无 standalone 复制（客户端加载服务器页面）

// ── 4b) ★ENVPACK_GATE_V1（2026-09-22 用户定案）：环境包一致性闸门 ────────
// 为什么要有这一步（用户原话："你说又是版本对不上什么的"）：
//   前后几次事故都是【包里的环境】和【客户端要的版本】互不知道对方要什么
//   （zip 是旧的/坏的、缺 driver、Python 版本对不上、内核 build 不匹配…）。
//   所以把"一致性"前移到【打包阶段】：不符合就【直接打包失败】——
//   绝不产出一个"装完还得靠用户碰运气"的安装包。
const MANIFEST_PATH = resolve(ROOT, 'electron/env-manifest.js')
const ENV_ZIP = resolve(ROOT, 'public/python-bu.zip')
// ms-playwright 源目录（★提到这里：下面的内核校验要用；原来在 5) 里定义）
const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8'))
const loc = String(process.env.LOCALAPPDATA || '').split(String.fromCharCode(92)).join('/')
const candidates = ['C:/Users/Administrator/AppData/Local/ms-playwright', loc + '/ms-playwright']
const pw = candidates.find((p) => existsSync(p)) || candidates[0]
log('4b/7 校验环境包（安装包必须自带 + 版本必须与代码清单一致）…')
// 环境包内的 env-manifest.json 内容（4c 校验 Python 侧内核时要用 → 声明在块外）
let innerPythonManifest = null
{
  const M = createRequire(import.meta.url)(MANIFEST_PATH)
  if (!existsSync(ENV_ZIP)) {
    console.error(
      '❌ 找不到环境包: public/python-bu.zip\n' +
      '   用户定稿：环境包【必须打进安装包】（用户机器上零下载）。\n' +
      '   生成方式（在一台"环境已跑通"的机器上）：\n' +
      '     node scripts/make-python-pack.mjs --from "<安装目录>\\python\\buvenv-test"\n'
    )
    process.exit(1)
  }
  const zsize = readFileSync(ENV_ZIP).length
  if (zsize < 20 * 1024 * 1024) {
    console.error('❌ 环境包过小（' + (zsize / 1048576).toFixed(1) + 'MB）—— 大概率是坏包（历史上出现过 69MB 缺 driver 的坏包），请重新生成')
    process.exit(1)
  }
  // 列内容 + 取出包内的 env-manifest.json（用 7za，避免引入 zip 依赖）
  let list = ''
  try { list = execFileSync(S7Z, ['l', '-ba', ENV_ZIP], { encoding: 'utf-8', maxBuffer: 128 * 1024 * 1024 }) } catch (e) {
    console.error('❌ 无法读取环境包内容: ' + String((e && e.message) || e)); process.exit(1)
  }
  // 两种合法结构都接受：buvenv-test/python.exe（全量安装式，可整体搬走）
  //                    buvenv-test/Scripts/python.exe（venv 式）
  if (!/buvenv-test[\\/](Scripts[\\/])?python\.exe/i.test(list)) {
    console.error('❌ 环境包结构不对：里面既没有 buvenv-test/python.exe，也没有 buvenv-test/Scripts/python.exe')
    process.exit(1)
  }
  try {
    const txt = execFileSync(S7Z, ['e', '-so', ENV_ZIP, 'env-manifest.json'], { encoding: 'utf-8', maxBuffer: 8 * 1024 * 1024 })
    innerPythonManifest = JSON.parse(txt)
  } catch (e) {
    console.error('❌ 环境包里没有可读的 env-manifest.json（无法核对版本）—— 请用 scripts/make-python-pack.mjs 重新生成')
    process.exit(1)
  }
  const inner = innerPythonManifest
  const problems = []
  if (String(inner.envPackVersion || '') !== String(M.ENV_PACK_VERSION)) {
    problems.push('环境包版本 ' + (inner.envPackVersion || '?') + ' ≠ 代码要求的 ' + M.ENV_PACK_VERSION + '（改了依赖就必须重做包，并把 ENV_PACK_VERSION 一起递增）')
  }
  const rt = inner.runtime || {}
  for (const [k, spec] of [['playwright', M.RUNTIME.playwright.spec], ['browser_use', M.RUNTIME.browser_use.spec]]) {
    const a = String(rt[k] || '')
    if (spec && !/^[<>=]/.test(spec) && a !== spec) problems.push('环境包 ' + k + '=' + (a || '(缺)') + ' ≠ 代码要求的 ' + spec)
  }
  if (!M.matchSpec(String(rt.python || ''), M.RUNTIME.python.spec)) {
    problems.push('环境包 python=' + (rt.python || '(缺)') + ' 不在要求区间 ' + M.RUNTIME.python.spec)
  }
  // ★PY_PACKAGES_V1：清单里要求的每个包都必须【真的在包内清单里】
  for (const p of M.PY_PACKAGES) {
    if (!String(rt[p.pkg] || '')) problems.push('环境包缺少依赖 ' + p.pkg + '（脚本里会 import 它，缺了用户机器上发布就崩）')
  }
  if (problems.length) {
    console.error('❌ 环境包与客户端要求不一致（这就是"装完还是版本对不上"的根源）：\n   - ' + problems.join('\n   - ') +
      '\n   请重做环境包：node scripts/make-python-pack.mjs --from "<安装目录>\\python\\buvenv-test"')
    process.exit(1)
  }
  log('   环境包 OK：' + (zsize / 1048576).toFixed(1) + 'MB / 版本 ' + inner.envPackVersion +
    ' / python ' + (rt.python || '?') + ' / playwright ' + (rt.playwright || '?') + ' / browser_use ' + (rt.browser_use || '?'))
}

// ── 4c) ★BROWSER_ALIGN_V1：两侧内核都必须"按各自 playwright 要的 build"落在同一个目录 ──
// 为什么必须在这里硬校验（本机实测到的真实事故）：
//   · Node 侧 playwright 1.60.0 要 chromium-1223；Python 侧 playwright 1.62.0 要 chromium-1234；
//     而当时 ms-playwright 里只有 **chromium-1228** —— 两边【都不对】。
//   · 后果一：包内 Chromium 兜底（"用户没装 Chrome 也能用"）实际失效；
//   · 后果二（更隐蔽）：运行时把 PLAYWRIGHT_BROWSERS_PATH 指向该目录，Python 子进程会继承 →
//     Python 去那里找 1234 → 找不到 → 发布开不了浏览器 → "换台机器就不行"。
// ⇒ 现在：先让两侧各自把【自己要的 build】装进同一个目录，再【逐个断言】文件真在。
//    （build 号一律不写死：问各自 playwright 本人要 executable_path）
{
  log('4c/7 校验两侧浏览器内核（问各自 playwright 要哪个 build，缺就装）…')
  if (!existsSync(pw)) {
    console.error('❌ 找不到 ms-playwright 源目录: ' + pw)
    process.exit(1)
  }

  // ★PW_DL_V1（2026-09-22 实测踩坑）：这步【不是卡住，是官方 CDN 在国内很慢】。
  //   实测数据（本机）：
  //     · 官方 cdn.playwright.dev 可达，但速度约 0.22 MB/s → 一个 chrome-win64.zip(~150MB) 要约 11 分钟
  //     · npmmirror 的 playwright 镜像【只镜像了 linux-arm64】，Windows 的包一个都没有（实测 404）→ 用不了
  //   所以：① 用 --no-shell 跳过 headless shell（再省 ~100MB；生产脚本 bu_exec.py 是 headless=False，用不到）
  //        ② 允许用 PLAYWRIGHT_DOWNLOAD_HOST 指定镜像（有可用镜像时直接生效）
  //        ③ 先把"要下什么"打出来（dry-run），免得看进度条以为卡死了
  const PW_HOST = process.env.PLAYWRIGHT_DOWNLOAD_HOST || ''
  const pwEnv = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: pw }
  if (PW_HOST) { log('   PLAYWRIGHT_DOWNLOAD_HOST = ' + PW_HOST) } else {
    log('   ⚠️ 未设 PLAYWRIGHT_DOWNLOAD_HOST → 走官方 CDN（国内实测约 0.22MB/s，一个包约 11 分钟，慢但在动）')
    log('      没有可用国内镜像就别设（npmmirror 的 playwright 镜像实测只有 linux-arm64，Windows 用不了）')
  }
  const dryRun = (cmd, args) => {
    try {
      const out = execFileSync(cmd, args, { encoding: 'utf-8', shell: true, env: pwEnv, timeout: 60000 })
      for (const l of String(out).split(/\r?\n/)) {
        if (/Download url|Download fallback|Install location|^\S.*v\d+\)/.test(l.trim())) log('      ' + l.trim())
      }
    } catch (e) { log('      （dry-run 失败，忽略：' + String((e.message || e)).slice(0, 80) + '）') }
  }

  // (1) Node 侧：用本仓库的 playwright 把内核装进该目录（幂等，已装则秒过）
  log('   [Node] 要下载/校验的内容：')
  dryRun('npx', ['playwright', 'install', 'chromium', '--no-shell', '--dry-run'])
  try {
    log('   [Node] npx playwright install chromium --no-shell（PLAYWRIGHT_BROWSERS_PATH=' + pw + '）…')
    execFileSync('npx', ['playwright', 'install', 'chromium', '--no-shell'], { stdio: 'inherit', shell: true, env: pwEnv })
  } catch (e) {
    console.error('❌ Node 侧浏览器内核安装失败: ' + (e.message || e) +
      '\n   若是因为网络太慢/超时，重跑一次即可（已下好的部分不会重下）。' +
      '\n   也可手动：$env:PLAYWRIGHT_BROWSERS_PATH="' + pw + '"; npx playwright install chromium --no-shell')
    process.exit(1)
  }

  // (2) 断言：Node 的 playwright 说"内核在哪"，那个文件就必须真在
  {
    const probe = 'const{chromium}=require("playwright");process.stdout.write(chromium.executablePath())'
    let exe = ''
    try { exe = String(execFileSync(process.execPath, ['-e', probe], { encoding: 'utf-8', env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: pw } })).trim() } catch (e) { }
    if (!exe || !existsSync(exe)) {
      console.error('❌ Node 侧内核对不上：playwright 要 ' + (exe || '(问不出来)') + '，但该文件不存在。\n' +
        '   目录里现有：' + readdirSync(pw).filter((d) => /^chromium/i.test(d)).join(', ') +
        '\n   → 装上它：PLAYWRIGHT_BROWSERS_PATH="' + pw + '" npx playwright install chromium')
      process.exit(1)
    }
    log('   [Node] ✅ 内核就绪：' + exe)
  }

  // (3) Python 侧：它要的 build 常常与 Node 不同 → 也必须补进同一个目录
  //     用"打包机上的 python"来装：要求它的 playwright 版本与【环境包里实测的版本】一致，
  //     否则装进来的 build 跟环境包对不上（那就是白装）。
  {
    const pyPwVer = (() => { try { return String((innerPythonManifest.runtime || {}).playwright || '') } catch (e) { return '' } })()
    let sysPwVer = ''
    try { sysPwVer = String(execFileSync('python', ['-c', 'import importlib.metadata as m;print(m.version("playwright"))'], { encoding: 'utf-8' })).trim() } catch (e) { sysPwVer = '' }
    if (!sysPwVer) {
      console.error('❌ 打包机上找不到可用的 python（或没装 playwright），无法保证 Python 侧内核正确。\n' +
        '   Python 侧 playwright 版本（来自环境包清单）: ' + (pyPwVer || '未知') +
        '\n   处理：在打包机安装 python + 执行 pip install playwright==' + (pyPwVer || '<与环境包一致>'))
      process.exit(1)
    }
    if (pyPwVer && sysPwVer !== pyPwVer) {
      console.error('❌ 打包机 python 的 playwright 版本（' + sysPwVer + '）≠ 环境包里的（' + pyPwVer + '）——' +
        '\n   两边要的内核 build 不同，装进来也是错的。\n' +
        '   处理：pip install playwright==' + pyPwVer + '   （或用与环境包一致的机器打包）')
      process.exit(1)
    }
    log('   [Python] 要下载/校验的内容：')
    dryRun('python', ['-m', 'playwright', 'install', 'chromium', '--no-shell', '--dry-run'])
    try {
      log('   [Python] playwright ' + sysPwVer + ' install chromium --no-shell（同一目录）…')
      execFileSync('python', ['-m', 'playwright', 'install', 'chromium', '--no-shell'], { stdio: 'inherit', env: pwEnv })
    } catch (e) {
      console.error('❌ Python 侧浏览器内核安装失败: ' + (e.message || e) +
        '\n   若是因为网络太慢/超时，重跑一次即可（已下好的部分不会重下）。' +
        '\n   也可手动：$env:PLAYWRIGHT_BROWSERS_PATH="' + pw + '"; python -m playwright install chromium --no-shell')
      process.exit(1)
    }
    const probe2 = 'from playwright.sync_api import sync_playwright\np=sync_playwright().start()\nprint(p.chromium.executable_path)\np.stop()'
    let exe2 = ''
    try { exe2 = String(execFileSync('python', ['-c', probe2], { encoding: 'utf-8', env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: pw } })).trim().split(/\r?\n/).pop() } catch (e) { }
    if (!exe2 || !existsSync(exe2)) {
      console.error('❌ Python 侧内核对不上：playwright 要 ' + (exe2 || '(问不出来)') + '，但该文件不存在。')
      process.exit(1)
    }
    log('   [Python] ✅ 内核就绪：' + exe2)
  }
  log('   两侧内核已对齐（同一个目录里可并存多个 build，各取各的）')
}

// ── 5) 生成临时打包配置（ms-playwright 指向本机）───────
// 2026-09-13: 构建前从 src/lib/agent/platforms.ts 生成 electron/platforms.generated.js
try {
  const { execFileSync } = await import('node:child_process')
  execFileSync(process.execPath, [resolve(ROOT, 'scripts/gen-platforms-js.mjs')], { stdio: 'inherit' })
} catch (e) { log('WARN gen-platforms-js 失败（不阻断）: ' + (e.message || e)) }

log('5/7 生成 build.local.json…')
// pkg / pw 已在 4b 之前算好（见上）
// 2026-08-12：打包前自动更新 version.json buildDate（避免版本日期滞后）
try {
  const vj = resolve(ROOT, 'electron/version.json')
  const vd = JSON.parse(readFileSync(vj, 'utf-8'))
  vd.buildDate = new Date().toISOString().slice(0, 10)
  writeFileSync(vj, JSON.stringify(vd, null, 2) + String.fromCharCode(10))
  log('version.json buildDate 更新为 ' + vd.buildDate)
} catch (e) { log('⚠️ buildDate 更新失败: ' + e.message) }

const build = {
  appId: pkg.build.appId,
  productName: pkg.build.productName,
  directories: { output: 'dist-rel' },
  // 2026-08-13 v1.0.30 纯壳：files 只含 electron/preload；无 standalone/无 next build
  files: pkg.build.files,
  // 2026-09-10 瘦身：只保留中英语言包（原来 41M 全语言）
  electronLanguages: ['zh-CN', 'en-US'],
  asarUnpack: ['**/*.node', '**/*.exe', '**/*.dll', '**/node_modules/@jackwener/opencli/**', 'node_modules/@jackwener/opencli/**'], // 2026-08-26: 缺 node_modules 前缀→@jackwener 未 unpack→vod-upload.js 找不到→发布只开页面
  extraResources: [
    { from: 'scripts/platform-tools', to: 'scripts/platform-tools' },
    // 2026-08-29: Browser Use 执行器（bu_exec.py——AGENT 工具箱 browser_use_execute）
    { from: 'scripts/browser-use', to: 'scripts/browser-use', filter: ['**/*'] },
    // ★ARCHIVE_AGENT_PUBLISH_V1（2026-09-17）：本目录现在【只放真正被调用的】bu_pub_*.py + _cdp_click.py。
    //   旧注释提到的 douyin-agent.js / xhs-agent.js 等 38 个历史脚本已归档到 scripts/_archive/agent-publish/
    //   （该目录【故意不打包】）；归档原因与目录约定见 scripts/agent-publish/README.md
    { from: 'scripts/agent-publish', to: 'scripts/agent-publish', filter: ['**/*'] },
    // ★KEEP_ALIVE_PACK_V1（2026-09-17）：登录态保活脚本——【必须打进包】。
    //   它在 scripts/ 根目录（不在 agent-publish/ 里），上面那条覆盖不到 → 1.0.203 首次打包
    //   实测确实缺它（计划任务指向的脚本在用户机器上不存在 = 保活失效）。
    { from: 'scripts/keep-login-alive.mjs', to: 'scripts/keep-login-alive.mjs' },
    { from: 'scripts/scrcpy', to: 'scripts/scrcpy' },
    // ★ENVPACK_SHIP_V1（2026-09-22 用户定案「客户端大小无所谓，保证用户一次安装好最重要」）：
    //   环境包【必须打进安装包】→ 落到 <resources>/python-bu.zip：
    //     用户机器上第一次安装就有完整环境，【运行时零下载】；OSS 只当"包内损坏"时的兜底。
    //   缺这个 zip 会在下面 4b 步【直接打包失败】（宁可不产出，也不产出一个装完不能用的包）。
    { from: 'public/python-bu.zip', to: 'python-bu.zip' },
    { from: pw, to: 'ms-playwright', filter: ['**/*'] },
    // 2026-08-19: 本地语音识别模型（sherpa-onnx）——随包分发
    // 2026-08-21: OpenCLI 浏览器扩展（打包分发——用户免商店/免代理，开发者模式加载即可）
    { from: 'electron/resources/opencli-extension', to: 'opencli-extension', filter: ['**/*'] },
  ],
  win: pkg.build.win,
  publish: pkg.build.publish,
  nsis: pkg.build.nsis,
}
writeFileSync(resolve(ROOT, 'build.local.json'), JSON.stringify(build, null, 2))
log(`ms-playwright 源: ${pw}`)

// ── 5) 清理旧产物（此时无占用）────────────────────────
// ★KEEP_USERDATA_V1（2026-09-22 用户定案「以后不动就行了」）：清 win-unpacked 时【必须保留用户数据】——
//   客户端 userData = exe 同级 data/（【多账号】登录态 data/browser-profile/{账号Id}/… + accounts.json
//   + 指纹 profile data/browser-profiles/），同级的 storage/（用户本地仓库镜像）与 python/（内置环境）
//   也都是用户数据（用户明确：这些一律不许删）。
//   旧实现 rmSync(整个 win-unpacked) 会把它们一起删掉 —— 用户实测「更新后登录态丢 / storage 被删」。
//   现在：逐项删除【程序文件】，只跳过这三个目录；单项被占用也不中断（让 electron-builder 覆盖即可）。
const KEEP_USER_DIRS = ['data', 'python', 'storage']
const WU = resolve(OUT, 'win-unpacked')
if (existsSync(WU)) {
  const kept = []
  for (const ent of readdirSync(WU, { withFileTypes: true })) {
    const nm = String(ent.name)
    if (ent.isDirectory() && KEEP_USER_DIRS.includes(nm.toLowerCase())) { kept.push(nm); continue }
    try { rmSync(resolve(WU, nm), { recursive: true, force: true }) } catch (e) { log('⚠️ 删除 ' + nm + ' 失败（占用中，交给打包覆盖）: ' + e.message) }
  }
  log('6/7 清理 dist-rel/win-unpacked（只删程序文件）' + (kept.length ? '；★保留用户数据: ' + kept.join(' / ') : ''))
} else {
  log('6/7 dist-rel/win-unpacked 不存在，跳过清理')
}

// ── 6) 执行打包（镜像加速）────────────────────────────
log('7/7 执行 electron-builder…')
const env = {
  ...process.env,
  ELECTRON_MIRROR: 'https://npmmirror.com/mirrors/electron/',
  ELECTRON_BUILDER_BINARIES_MIRROR: 'https://npmmirror.com/mirrors/electron-builder-binaries/',
}
const r = spawnSync('npx', ['electron-builder', '--config', 'build.local.json'], { cwd: ROOT, env, stdio: 'inherit', shell: true })
rmSync(resolve(ROOT, 'build.local.json'), { force: true })
if (r.status !== 0) {
  console.error(`❌ 打包失败（退出码 ${r.status}）`, r.error ? r.error.message : ''); process.exit(1)
}

// ── 产物汇总 ──────────────────────────────────────────
for (const f of readdirSync(OUT).filter(f => f.endsWith('.exe'))) {
  const p = resolve(OUT, f)
  const mb = (readFileSync(p).length / 1024 / 1024).toFixed(1)
  log(`✅ 产物: dist-rel/${f} (${mb} MB)`)
}
log('完成。本地启动测试: SERVER_URL=http://localhost:3000 "dist-rel/win-unpacked/AI营销助手.exe"')

// 2026-09-03: 打包后自动把 latest.yml 的 url/path 改成 OSS（否则客户端下载走服务器 404/0%）
try {
  const ymlPath = resolve(process.cwd(), 'dist-rel', 'latest.yml')
  const ver = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')).version
  const OSS_URL = 'https://aimarketing-1.oss-cn-hangzhou.aliyuncs.com/updates/AI-Marketing-Setup-' + ver + '.exe'
  let y = readFileSync(ymlPath, 'utf8')
  y = y.replace('url: AI-Marketing-Setup-' + ver + '.exe', 'url: ' + OSS_URL).replace('path: AI-Marketing-Setup-' + ver + '.exe', 'path: ' + OSS_URL)
  writeFileSync(ymlPath, y)
  log('latest.yml url 已指 OSS（自动）')
} catch (e) { log('latest.yml OSS 化失败: ' + e.message) }

