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
import { execSync, spawnSync } from 'node:child_process'
import { existsSync, copyFileSync, writeFileSync, rmSync, readFileSync, mkdirSync, cpSync, readdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

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

// ── 5) 生成临时打包配置（ms-playwright 指向本机）───────
log('5/7 生成 build.local.json…')
const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8'))
const loc = String(process.env.LOCALAPPDATA || '').split(String.fromCharCode(92)).join('/')
const candidates = ['C:/Users/Administrator/AppData/Local/ms-playwright', loc + '/ms-playwright']
const pw = candidates.find(p => existsSync(p)) || candidates[0]
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
  asarUnpack: ['**/*.node', '**/*.exe', '**/*.dll', '**/node_modules/@jackwener/opencli/**', 'node_modules/@jackwener/opencli/**'], // 2026-08-26: 缺 node_modules 前缀→@jackwener 未 unpack→vod-upload.js 找不到→发布只开页面
  extraResources: [
    { from: 'scripts/platform-tools', to: 'scripts/platform-tools' },
    // 2026-08-29: Browser Use 执行器（bu_exec.py——AGENT 工具箱 browser_use_execute）
    { from: 'scripts/browser-use', to: 'scripts/browser-use', filter: ['**/*'] },
    { from: 'scripts/scrcpy', to: 'scripts/scrcpy' },
    { from: pw, to: 'ms-playwright', filter: ['**/*'] },
    // 2026-08-19: 本地语音识别模型（sherpa-onnx）——随包分发
    { from: 'electron/models/sherpa', to: 'models/sherpa', filter: ['**/*'] },
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
log('6/7 清理 dist-rel/win-unpacked…')
rmSync(resolve(OUT, 'win-unpacked'), { recursive: true, force: true })

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
