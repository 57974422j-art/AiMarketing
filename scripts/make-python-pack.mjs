#!/usr/bin/env node
/**
 * ═══ MAKE_PYTHON_PACK_V1（2026-09-22 用户定案「第一次安装就扎实点，把需要的都补上」）═══
 *
 * 作用：把一台【已经验证可用】的 Python 环境，打成【带版本清单】的环境包
 *       （public/python-bu.zip）→ 再打进安装包 → 用户机器上零下载、零版本差。
 *
 * 为什么必须以 --from 为一个现成目录为源（而不是从零 pip 装）：
 *   本次事故的根因就是"包里的环境"和"客户端要的版本"互相不知道对方要什么
 *   （zip 是旧/坏版本、缺 driver、Python 版本对不上…）。以"已经跑通的那台机器"为基准，
 *   并把【实测版本】写进 env-manifest.json，才可能保证两边一致 —— 这就是"扎实"。
 *
 * 用法：
 *   # ① 先确认源目录是可用的（会真跑一次 python 校验版本）
 *   node scripts/make-python-pack.mjs --from "D:\AiMarketing\dist-rel\win-unpacked\python\buvenv-test"
 *   # ② 产出 public/python-bu.zip（里面含 env-manifest.json）
 *   # ③ 上传 OSS（可选，包内自带已经够用；上传只是给"包内损坏"兜底）
 *   node scripts/upload-python-bu.mjs public/python-bu.zip
 *
 * 校验不过会【直接失败】并告诉你差什么（宁可不产出，也不产出一个"版本对不上"的包）。
 */
import { existsSync, statSync, mkdirSync, writeFileSync, rmSync, cpSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const M = require(resolve(ROOT, 'electron/env-manifest.js'))

const argv = process.argv.slice(2)
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
const SRC = arg('--from', '')
const OUT = resolve(ROOT, arg('--out', 'public/python-bu.zip'))
const S7Z = resolve(ROOT, 'node_modules/7zip-bin/win/x64/7za.exe')

const log = (m) => console.log('[python-pack] ' + m)
const die = (m) => { console.error('❌ ' + m); process.exit(1) }

if (!SRC) die('必须指定 --from <已可用的 python 目录>（例如 dist-rel/win-unpacked/python/buvenv-test）')
if (!existsSync(SRC)) die('--from 目录不存在: ' + SRC)
if (!existsSync(S7Z)) die('找不到 7za: ' + S7Z + '（请先 npm install）')

const pyExe = join(SRC, 'Scripts', 'python.exe')
if (!existsSync(pyExe)) die('目录里没有 Scripts\\python.exe: ' + pyExe + '（要指向 buvenv-test 那层）')

// ── 1) 真跑一次源环境，拿【实测版本】 ─────────────────────────
log('1/5 实测源环境版本…')
const probe =
  'import sys,json\n' +
  'd={"python":sys.version.split()[0]}\n' +
  'try:\n' +
  '  import importlib.metadata as m\n' +
  '  for k in ("playwright","browser_use"):\n' +
  '    try: d[k]=m.version(k)\n' +
  '    except Exception: d[k]=""\n' +
  'except Exception: pass\n' +
  'print("VFENV"+json.dumps(d))'
let got = {}
try {
  const out = execFileSync(pyExe, ['-c', probe], { encoding: 'utf-8', timeout: 120000 })
  const line = String(out).split(/\r?\n/).find((l) => l.startsWith('VFENV'))
  got = JSON.parse(String(line).slice(5))
} catch (e) {
  die('源环境跑不起来: ' + String((e && e.message) || e).slice(0, 300))
}
log('   实测：python ' + got.python + ' / playwright ' + got.playwright + ' / browser_use ' + got.browserUse)

// ── 2) 与代码清单逐个对版本（不符 → 直接失败） ────────────────
log('2/5 与 electron/env-manifest.js 的版本规格比对…')
const bad = []
for (const [k, spec] of [['python', M.RUNTIME.python.spec], ['playwright', M.RUNTIME.playwright.spec], ['browser_use', M.RUNTIME.browser_use.spec]]) {
  // python 包里 browser_use 的版本读作 browserUse（Python 包名带下划线，JSON 里保持可读）
  const a = String((k === 'browser_use' ? got.browserUse : got[k]) || '')
  if (!M.matchSpec(a, spec)) bad.push('  · ' + k + ' = ' + (a || '(缺)') + '，但代码要求 ' + spec)
}
if (bad.length) {
  die('源环境与客户端要求的版本不一致：\n' + bad.join('\n') +
    '\n\n→ 请在这个环境里补齐/降级后重试，例如：\n' +
    '   "' + pyExe + '" -m pip install playwright==' + M.RUNTIME.playwright.spec + ' browser_use==' + M.RUNTIME.browser_use.spec +
    '\n（★不要为了"能打包"去改代码里的 spec —— 那正是这次事故的成因）')
}
log('   ✓ 版本全部对得上')

// ── 3) 组装 staging（buvenv-test/ + env-manifest.json）────────
log('3/5 组装打包目录…')
const STAGE = resolve(ROOT, 'temp/python-pack-stage')
try { rmSync(STAGE, { recursive: true, force: true }) } catch (e) {}
const stageInner = join(STAGE, 'buvenv-test')
mkdirSync(stageInner, { recursive: true })
log('   复制环境（约 1~3 分钟，视磁盘）…')
cpSync(SRC, stageInner, { recursive: true })

const manifest = {
  kind: 'python-bu',
  envPackVersion: M.ENV_PACK_VERSION,
  builtAt: new Date().toISOString(),
  builtFrom: SRC,
  runtime: {
    python: String(got.python || ''),
    playwright: String(got.playwright || ''),
    browser_use: String(got.browserUse || ''),
  },
  // 记录期望值：客户端自检会拿这两个值核对"包里的环境"和"代码要的版本"是否一致
  expect: {
    python: M.RUNTIME.python.spec,
    playwright: M.RUNTIME.playwright.spec,
    browser_use: M.RUNTIME.browser_use.spec,
  },
  browsersDir: M.BROWSERS_DIR,
  note: '本文件是环境包自证：客户端自检读它核对版本；打包脚本也读它拦住"版本对不上"的包。',
}
writeFileSync(join(STAGE, 'env-manifest.json'), JSON.stringify(manifest, null, 2))

// ── 4) 打包（7za -tzip） ────────────────────────────────────
log('4/5 压缩…')
mkdirSync(dirname(OUT), { recursive: true })
try { rmSync(OUT, { force: true }) } catch (e) {}
execFileSync(S7Z, ['a', '-tzip', '-mx=3', '-bso0', '-bsp0', OUT, 'buvenv-test', 'env-manifest.json'], { cwd: STAGE, stdio: 'inherit' })
if (!existsSync(OUT)) die('压缩失败（未产出 ' + OUT + '）')

try { rmSync(STAGE, { recursive: true, force: true }) } catch (e) {}

// ── 5) 自检产出（★不许产出"没有清单"的包）───────────────────
log('5/5 校验产出…')
const size = statSync(OUT).size
if (size < 20 * 1024 * 1024) die('产出过小（' + Math.round(size / 1048576) + 'MB）——大概率打错了目录')
// 用 7za 列出内容，确认 buvenv-test/Scripts/python.exe 与 env-manifest.json 都在
let list = ''
try { list = execFileSync(S7Z, ['l', '-ba', OUT], { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 }) } catch (e) { die('无法列出 zip 内容: ' + String((e && e.message) || e)) }
const hasPy = /buvenv-test[\\/]Scripts[\\/]python\.exe/i.test(list)
const hasMf = /env-manifest\.json/i.test(list)
if (!hasPy) die('zip 里没有 buvenv-test/Scripts/python.exe（结构不对）')
if (!hasMf) die('zip 里没有 env-manifest.json（客户端无法核对版本）')

const n = list.split(/\r?\n/).filter(Boolean).length
console.log('')
log('✅ 完成：' + OUT)
log('   大小 ' + (size / 1048576).toFixed(1) + ' MB / ' + n + ' 个条目 / 环境包版本 ' + M.ENV_PACK_VERSION)
log('   实测版本 python ' + got.python + ' / playwright ' + got.playwright + ' / browser_use ' + got.browserUse)
console.log('')
log('下一步：')
log('   ① 打进安装包：node scripts/build-local.mjs   （它会自动带上 public/python-bu.zip 并做一致性校验）')
log('   ② 上传 OSS（可选，兜底用）：node scripts/upload-python-bu.mjs public/python-bu.zip')
