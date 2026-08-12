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

// ── 4) Next standalone 构建（阶段0：API 代理到服务器）────
log('4/7 构建 Next standalone（API_TARGET=https://ai-niuma.cc）…')
const buildRes = spawnSync('npm', ['run', 'build'], {
  cwd: ROOT,
  env: { ...process.env, API_TARGET: 'https://ai-niuma.cc' },
  stdio: 'inherit',
  shell: true,
})
if (buildRes.status !== 0) { console.error('❌ next build 失败'); process.exit(1) }

// 复制 static/public 进 standalone（Next 官方要求）
const STANDALONE = resolve(ROOT, '.next/standalone')
function copyDir(src, dest, skip = []) {
  if (!existsSync(src)) return
  mkdirSync(dest, { recursive: true })
  for (const name of readdirSync(src)) {
    if (skip.includes(name)) continue
    cpSync(resolve(src, name), resolve(dest, name), { recursive: true })
  }
}
mkdirSync(resolve(STANDALONE, '.next'), { recursive: true })
copyDir(resolve(ROOT, '.next/static'), resolve(STANDALONE, '.next/static'))
copyDir(resolve(ROOT, 'public'), resolve(STANDALONE, 'public'), ['updates'])
// Next standalone 会自动复制整个 public/（含 updates/ 里的旧安装包，本地有 4.7GB），
// 必须删除，否则 electron-builder 打包 5GB+ 会卡死在压缩/签名阶段
rmSync(resolve(STANDALONE, 'public/updates'), { recursive: true, force: true })
// 2026-08-11 客户端正式版连服务器：不复制本地 dev.db（API 走服务器，登录/计费/数据统一）
log('standalone 就绪: ' + STANDALONE + '（已清理 public/updates；客户端 API 走服务器）')

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
  // 2026-08-12：standalone 进 asar 但全部 unpack（app.asar.unpacked/standalone 真实文件）
  // ——ELECTRON_RUN_AS_NODE 可执行真实文件（asar 内 MODULE_NOT_FOUND）+ 自动更新随 asar 一起替换 unpacked
  files: [...pkg.build.files, '.next/standalone/**'],
  // 2026-08-12 v1.0.26: dot dir .next 被 electron-builder glob 排除 (asarUnpack/extraResources 都漏)
  // 修复: standalone 进 asar + 显式 unpack 'standalone/.next/**' -> server.js + .next 全真实文件
  asarUnpack: ['**/*.node', '**/*.exe', '**/*.dll', '.next/standalone/**', '.next/standalone/**/*'],
  extraResources: [
    { from: 'scripts/platform-tools', to: 'scripts/platform-tools' },
    { from: 'scripts/scrcpy', to: 'scripts/scrcpy' },
    { from: pw, to: 'ms-playwright', filter: ['**/*'] },
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
