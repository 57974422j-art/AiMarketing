#!/usr/bin/env node
/**
 * ═══ ★PKG_VERIFY_V1（2026-09-28 用户定案：「保留一种，确保新机器安装上就能用，有坑把坑填了」）═══
 *
 * 出厂完整性闸门 —— 只认【已经打好的包】（默认 dist-rel/win-unpacked），把客户端启动自检那 9 项
 * 需要的东西【逐项在包里找一遍】；缺任何一件 → 直接失败（exit 1），这个包不许出厂。
 *
 * ■ 为什么必须有这一步（2026-09-28 真实事故）：
 *   有人绕过 build-local.mjs、直接 `npx electron-builder` 打包 —— 那条路只读 package.json 的旧配置，
 *   打出来的包【少 4 样】：
 *     resources/models/sherpa/…      语音识别模型（24MB）→ 语音输入 / 声纹球不可用
 *     resources/python-bu.zip        内置 Python 环境包（149MB）→ 新机器首装没有环境
 *     resources/opencli-extension    OpenCLI 浏览器扩展
 *     resources/scripts/keep-login-alive.mjs  登录态保活脚本 → 保活失效
 *   而打包"成功"、体积看着也正常 → 用户装完才发现。所以把校验补成硬闸门：
 *   清单唯一真源 = electron/env-manifest.js（自检与打包共用同一份），再补三项清单没写但必须有的。
 *
 * ■ 用法：
 *   node scripts/verify-package.mjs              校验 dist-rel/win-unpacked
 *   node scripts/verify-package.mjs --latest     额外校验 dist-rel/latest.yml 已指向 OSS（发布前用）
 *   node scripts/verify-package.mjs <包目录>      校验指定目录
 *   （build-local.mjs 打包完会自动带 --latest 调用本脚本）
 */
import { existsSync, statSync, readdirSync, readFileSync, openSync, readSync, closeSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const manifest = require(resolve(ROOT, 'electron/env-manifest.js'))
const { ITEMS } = manifest

const argv = process.argv.slice(2)
const CHECK_LATEST = argv.includes('--latest')
const dirArg = argv.find((a) => !a.startsWith('--'))
const OUT = resolve(ROOT, 'dist-rel')
const UNPACKED = resolve(ROOT, dirArg || 'dist-rel/win-unpacked')

const ok = []
const bad = []
const floor = (m) => console.log('   ' + m)
const mb = (n) => (n / 1048576).toFixed(1) + ' MB'

/** 包内【清单没写、但客户端必须有】的东西（本闸门专有） */
const EXTRA_REQUIRED = [
  { path: 'resources/opencli-extension/manifest.json', why: 'OpenCLI 浏览器扩展（发布用）' },
  { path: 'resources/scripts/keep-login-alive.mjs', why: '登录态保活脚本（计划任务指向它）' },
]

/** 读 asar 头部索引（asar 是「头 JSON + 数据」的简单格式，不需要装 asar 包）。
 *  实测（2026-09-28）踩过两次偏移坑，正确布局（两段 pickle）：
 *     [0..3]=4  [4..7]=第二段 pickle 字节数
 *     [8..11]=第二段 pickle 头(=4+jsonLen)  [12..15]=JSON 字节数  [16..]=JSON（可能带 4 字节对齐补零）
 *  即：JSON 长度读偏移 12，JSON 从偏移 16 开始。 */
function readAsarIndex(p) {
  const fd = openSync(p, 'r')
  try {
    const head = Buffer.alloc(16)
    readSync(fd, head, 0, 16, 0)
    const jsonSize = head.readUInt32LE(12)
    if (!(jsonSize > 0 && jsonSize < 64 * 1024 * 1024)) throw new Error('asar 头异常（jsonSize=' + jsonSize + '）')
    const buf = Buffer.alloc(jsonSize)
    readSync(fd, buf, 0, jsonSize, 16)
    return JSON.parse(buf.toString('utf8').replace(/\0+$/, ''))
  } finally { closeSync(fd) }
}

/** 在 asar 索引树里找一条相对路径（如 node_modules/x/package.json） */
function asarHas(tree, relPath) {
  const parts = String(relPath).replace(/\\/g, '/').split('/').filter(Boolean)
  let cur = tree
  for (const seg of parts) {
    const files = cur && cur.files
    if (!files || !files[seg]) return false
    cur = files[seg]
  }
  return true
}

function need(rel, why, minBytes = 1) {
  const abs = join(UNPACKED, rel)
  try {
    if (!existsSync(abs)) { bad.push({ rel, why, err: '不存在' }); return false }
    const st = statSync(abs)
    if (!st.isDirectory() && st.size < minBytes) { bad.push({ rel, why, err: '文件过小（' + st.size + ' 字节，疑似坏文件）' }); return false }
    ok.push({ rel, why, size: st.isDirectory() ? null : st.size })
    return true
  } catch (e) { bad.push({ rel, why, err: String((e && e.message) || e) }); return false }
}

console.log('\n[出厂闸门] 校验包: ' + UNPACKED)
if (!existsSync(UNPACKED)) {
  console.error('❌ 找不到包目录（先打包，或传正确路径）：' + UNPACKED)
  process.exit(1)
}

// ── ① asar（自检清单里 base:'app' 的那些项在 asar 内）──────
let asarIndex = null
const asarPath = join(UNPACKED, 'resources/app.asar')
if (existsSync(asarPath)) {
  try { asarIndex = readAsarIndex(asarPath) } catch (e) { floor('⚠️ asar 索引读不出（跳过 asar 内检查）: ' + e.message) }
} else {
  bad.push({ rel: 'resources/app.asar', why: '应用本体', err: '不存在' })
}

// ── ② 逐项对照清单（electron/env-manifest.js 是唯一真源）──
for (const it of ITEMS) {
  if (it.kind === 'files') {
    const list = it.files || []
    for (const f of list) {
      if (it.base === 'app') {
        // 在 app.asar 里
        if (asarIndex) {
          if (asarHas(asarIndex, f)) ok.push({ rel: 'app.asar/' + f, why: it.title, size: null })
          else bad.push({ rel: 'app.asar/' + f, why: it.title, err: 'asar 内不存在' })
        }
      } else {
        need(f, it.title, it.minBytes || 1)
      }
    }
  } else if (it.kind === 'exeAny') {
    const any = (it.exeAny || []).some((f) => existsSync(join(UNPACKED, f)))
    if (any) ok.push({ rel: (it.exeAny || [])[0] + '（其一）', why: it.title, size: null })
    else bad.push({ rel: (it.exeAny || []).join(' | '), why: it.title, err: '候选文件一个都不存在' })
  } else if (it.kind === 'zip') {
    const z = join(UNPACKED, 'resources', it.zipName || '')
    if (existsSync(z)) {
      const sz = statSync(z).size
      if (sz < 50 * 1048576) bad.push({ rel: 'resources/' + it.zipName, why: it.title, err: '环境包过小（' + mb(sz) + '），疑似坏包' })
      else ok.push({ rel: 'resources/' + it.zipName, why: it.title, size: sz })
    } else {
      bad.push({ rel: 'resources/' + it.zipName, why: it.title, err: '不存在（新机器首装将没有内置环境）' })
    }
  } else if (it.kind === 'nodebrowser') {
    // Node 侧内核：<resources>/ms-playwright 下必须有一个 chromium-*，且里面有可执行的 chrome.exe。
    // ⚠️ 目录布局随 playwright 版本变过，实测（2026-09-28）：
    //   旧内核 chromium-1223 → chrome-win\chrome.exe
    //   新内核 chromium-1234 → chrome-win64\chrome.exe   ← 一开始只认 chrome-win，误报"没有内核"
    //   所以两种都认，外加"直接放在 chromium-* 根下"的兜底。
    const dir = join(UNPACKED, 'resources', manifest.BROWSERS_DIR)
    const subdirs = ['chrome-win64', 'chrome-win', '']
    let found = ''
    try {
      for (const n of readdirSync(dir)) {
        if (!/^chromium-\d+$/.test(n)) continue
        for (const s of subdirs) {
          const rel = join(n, s, 'chrome.exe')
          if (existsSync(join(dir, rel))) { found = rel.replace(/\\/g, '/'); break }
        }
        if (found) break
      }
    } catch { /* 目录不存在 → found 保持空 */ }
    if (found) ok.push({ rel: 'resources/' + manifest.BROWSERS_DIR + '/' + found, why: it.title, size: null })
    else bad.push({ rel: 'resources/' + manifest.BROWSERS_DIR + '/chromium-*/{chrome-win64,chrome-win}/chrome.exe', why: it.title, err: '包内没有可用的 chromium 内核' })
  }
  // kind === 'pybrowser' 是 Python 侧内核（在 python/ 用户目录里，运行时自检，不在包内）→ 跳过
}

// ── ③ 清单没写、但客户端必须有的两项 ─────────────────────
for (const x of EXTRA_REQUIRED) need(x.path, x.why, 1)

// ── ④ 更新通道：latest.yml 必须已指向 OSS（否则客户端下载走服务器 → 404）──
if (CHECK_LATEST) {
  const yml = join(OUT, 'latest.yml')
  try {
    const y = readFileSync(yml, 'utf8')
    const ver = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version
    const rel = 'url: AI-Marketing-Setup-' + ver + '.exe'
    if (y.includes(rel)) bad.push({ rel: 'dist-rel/latest.yml', why: '自动更新清单', err: 'url 还是【相对文件名】→ 客户端会去服务器下载 → 404（必须指 OSS 绝对地址）' })
    else if (!/url:\s*https:\/\/[^\s]*\/updates\/AI-Marketing-Setup-[0-9.]+\.exe/.test(y)) bad.push({ rel: 'dist-rel/latest.yml', why: '自动更新清单', err: 'url 既不是相对名也不是标准 OSS 地址，请人工确认' })
    else ok.push({ rel: 'dist-rel/latest.yml', why: '自动更新清单（已指 OSS）', size: statSync(yml).size })
  } catch (e) { bad.push({ rel: 'dist-rel/latest.yml', why: '自动更新清单', err: '读不到: ' + String((e && e.message) || e) }) }
}

// ── 汇总 ─────────────────────────────────────────────────
console.log('\n   ✅ 齐备 ' + ok.length + ' 项')
const showOk = ok.filter((o) => o.size != null)
if (showOk.length) for (const o of showOk) floor('· ' + o.rel + (o.size ? '   ' + mb(o.size) : ''))
if (bad.length) {
  console.log('\n   ❌ 缺失 / 不合格 ' + bad.length + ' 项：')
  for (const b of bad) floor('· ' + b.rel + '  → ' + b.err + '   （' + b.why + '）')
  console.error('\n[出厂闸门] 不通过：这个包【不许出厂】—— 装到用户机器上会缺件。')
  console.error('           正确做法：npm run electron:build（= scripts/build-local.mjs），它会把这些都打进去。\n')
  process.exit(1)
}
console.log('\n[出厂闸门] ✅ 通过：包内 9 项自检所需文件齐全，新机器装完即为可用状态。\n')
