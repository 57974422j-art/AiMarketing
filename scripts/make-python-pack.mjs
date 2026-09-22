#!/usr/bin/env node
/**
 * ═══ MAKE_PYTHON_PACK_V1（2026-09-22 用户定案「第一次安装就扎实点，把需要的都补上」）═══
 *
 * 作用：产出【带版本清单】的环境包 public/python-bu.zip →
 *       再被 build-local.mjs 打进安装包（<resources>/python-bu.zip）→ 用户机器上零下载、零版本差。
 *
 * 两种做法（都在这里，选一个）：
 *
 *  ① --from-scratch（★推荐，当前就用这个）
 *       用本机 python 造一个【干净、自包含、可整体搬走】的运行环境：
 *         · 拷解释器本体（python.exe + pythonXX.dll + DLLs + Lib 标准库）
 *         · 只 pip 装【脚本真正需要的库】（清单见 electron/env-manifest.js 的 PY_PACKAGES）
 *       为什么不用"从本机 site-packages 直接拷"：本机装着 torch/demucs 之类 2GB 的东西，
 *       整包拷进去既巨大又带一堆无关风险 —— 而且历史上的包就是这么来的，才会"本机好、用户机器坏"。
 *
 *  ② --from <dir>
 *       以一台【已经跑通】的现成环境为源打包（沿用老做法）。
 *       支持两种结构：<dir>\python.exe（全量安装式，可整体搬走）
 *                      <dir>\Scripts\python.exe（venv 式 —— ⚠️ venv 不可整体搬走，
 *                        用户机器上很可能起不来，这就是"换台机器又不行"的常见成因，尽量别用）
 *
 * 无论哪种做法，最后都会：
 *   · 与 electron/env-manifest.js 的版本规格逐个比对（不符 → 直接失败，不产出坏包）
 *   · 用【即将打进包里的那个 python.exe】真跑一次：版本 + 逐包 import + 真启动 playwright
 *     （能跑起来才算数 —— 这一步就是在证明"它脱离本机也能用"）
 *   · 写出 env-manifest.json（包自证：客户端自检和打包闸门都读它）
 *
 * 用法：
 *   node scripts/make-python-pack.mjs --from-scratch
 *   node scripts/make-python-pack.mjs --from-scratch --index https://pypi.tuna.tsinghua.edu.cn/simple
 *   node scripts/make-python-pack.mjs --from "<安装目录>\python\buvenv-test" --out public/python-bu.zip
 *   可选： --python "C:\Python314\python.exe"  指定用哪个 python 造/探测
 *
 * ⚠️ --index 为什么要留着：本机实测【默认 pip 源里没有 anthropic】（browser_use 的依赖），
 *    会导致 pip 直接失败；换清华源才有。所以这个参数是"能不能造出包"的关键开关之一。
 */
import { existsSync, statSync, mkdirSync, writeFileSync, rmSync, cpSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve, dirname, join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const M = require(resolve(ROOT, 'electron/env-manifest.js'))

const argv = process.argv.slice(2)
const hasFlag = (k) => argv.includes(k)
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }

const FROM = arg('--from', '')
const SCRATCH = hasFlag('--from-scratch')
const PY_IN = arg('--python', 'python')
const INDEX = arg('--index', '')
const OUT = resolve(ROOT, arg('--out', 'public/python-bu.zip'))
const S7Z = resolve(ROOT, 'node_modules/7zip-bin/win/x64/7za.exe')

const log = (m) => console.log('[python-pack] ' + m)
const die = (m) => { console.error('❌ ' + m); process.exit(1) }

if (!FROM && !SCRATCH) die('必须选一种：--from-scratch（推荐）或 --from <已可用的 python 目录>')
if (!existsSync(S7Z)) die('找不到 7za: ' + S7Z + '（请先 npm install）')

const PROBE = [
  'import sys,json',
  'd={"python":sys.version.split()[0],"imports":{},"prefix":sys.prefix}',
  'import importlib.metadata as m',
  'for k in ' + JSON.stringify(M.PY_PACKAGES.map((p) => p.pkg)) + ':',
  '    try: d[k]=m.version(k)',
  '    except Exception: d[k]=""',
  'for mod in ' + JSON.stringify(M.PY_PACKAGES.map((p) => p.imp)) + ':',
  '    try:',
  '        __import__(mod.split(".")[0]); d["imports"][mod]="ok"',
  '    except Exception as e: d["imports"][mod]="ERR "+str(e)[:60]',
  'print("VFENV"+json.dumps(d))',
].join('\n')

/** 跑一个 python 并把 VFENV 那行解析出来（清掉 PYTHONHOME/PYTHONPATH —— 否则本机变量会掩盖真实问题） */
function probePy(py, cwd) {
  const env = { ...process.env }
  delete env.PYTHONHOME
  delete env.PYTHONPATH
  delete env.PLAYWRIGHT_BROWSERS_PATH
  let out = ''
  try {
    out = execFileSync(py, ['-c', PROBE], { encoding: 'utf-8', timeout: 300000, env, cwd })
  } catch (e) {
    return { ok: false, err: String((e.stdout || '') + (e.stderr || '') || e.message || e).slice(-500) }
  }
  const line = String(out).split(/\r?\n/).find((l) => l.startsWith('VFENV'))
  if (!line) return { ok: false, err: '探测无输出：' + String(out).slice(-300) }
  try { return { ok: true, info: JSON.parse(line.slice(5)) } } catch (e) { return { ok: false, err: '探测输出无法解析' } }
}

/** 逐项比对版本规格 + import 是否都 ok */
function checkAgainstManifest(info) {
  const bad = []
  if (!M.matchSpec(info.python, M.RUNTIME.python.spec)) bad.push('python = ' + (info.python || '(缺)') + '，要求 ' + M.RUNTIME.python.spec)
  for (const p of M.PY_PACKAGES) {
    const v = String(info[p.pkg] || '')
    if (p.spec && !M.matchSpec(v, p.spec)) bad.push(p.pkg + ' = ' + (v || '(缺)') + '，要求 ' + p.spec)
    const im = (info.imports || {})[p.imp]
    if (im !== 'ok') bad.push('import ' + p.imp + ' 失败：' + String(im || '未测'))
  }
  return bad
}

const STAGE = resolve(ROOT, 'temp/python-pack-stage')
const INNER = join(STAGE, 'buvenv-test')

// ══════════════════════════════════════════════════════════════
log('0/6 准备打包目录…')
try { rmSync(STAGE, { recursive: true, force: true }) } catch (e) {}
mkdirSync(INNER, { recursive: true })

let SRC_DESC = ''

if (SCRATCH) {
  // ── 模式 ①：从零造一个干净环境 ─────────────────────────────
  log('1/6 探测本机 python（' + PY_IN + '）…')
  const host = probePy(PY_IN)
  if (!host.ok) die('本机 python 不可用（' + PY_IN + '）：' + host.err +
    '\n   提示：用 --python "<python.exe 全路径>" 指定一个可用的 python')
  const hostExe = (() => {
    try { return String(execFileSync(PY_IN, ['-c', 'import sys;print(sys.executable)'], { encoding: 'utf-8' })).trim() } catch (e) { return '' }
  })()
  if (!hostExe || !existsSync(hostExe)) die('拿不到本机 python.exe 的真实路径')
  log('   本机 python ' + host.info.python + '：' + hostExe)
  if (checkAgainstManifest(host.info).length) {
    log('   本机环境与清单并不完全一致（下面会按清单把缺的装进包里，不影响）：')
    log('     ' + checkAgainstManifest(host.info).join('\n     '))
  }

  log('2/6 复制解释器本体（python.exe + DLLs + Lib 标准库，跳过 site-packages）…')
  const prefix = dirname(hostExe)
  const SKIP_DIRS = new Set(['scripts', 'doc', 'include', 'libs', 'tcl', 'share', '__pycache__'])
  const copyFilter = (src) => {
    const rel = src.slice(prefix.length).replace(/^[\\/]+/, '')
    if (!rel) return true
    const parts = rel.split(/[\\/]/)
    const first = parts[0].toLowerCase()
    if (parts.length === 1) {
      if (first === 'lib') return true
      return true                                     // 根目录下的文件（exe/dll/许可证）全要
    }
    if (SKIP_DIRS.has(first)) return false            // 这些跟运行无关（tkinter/头文件/调试符号…）
    if (first === 'lib' && parts[1] && parts[1].toLowerCase() === 'site-packages') return false  // 库按清单单独装
    if (/\.pdb$/i.test(rel)) return false
    return true
  }
  cpSync(prefix, INNER, { recursive: true, filter: copyFilter })
  const pyInPack = existsSync(join(INNER, 'python.exe'))
    ? join(INNER, 'python.exe')
    : join(INNER, 'Scripts', 'python.exe')
  if (!existsSync(pyInPack)) die('复制后包里找不到 python.exe（结构异常）')
  log('   → ' + pyInPack)

  log('3/6 pip 安装清单里的库（只装脚本真正需要的）…')
  const sitePk = join(INNER, 'Lib', 'site-packages')
  mkdirSync(sitePk, { recursive: true })
  const specs = M.PY_PACKAGES.map((p) => (p.spec ? p.pkg + '==' + p.spec : p.pkg))
  log('   ' + specs.join('  '))
  // ★PY_PACK_INDEX_FIX_V1：本机默认源里【没有 anthropic】（browser_use 依赖）→ pip 直接失败；
  //   加了 --index（如清华源）才装得下来。若配了 PIP_INDEX_URL 也一并尊重。
  const indexUrl = INDEX || process.env.PIP_INDEX_URL || ''
  if (indexUrl) log('   源：' + indexUrl)
  const pipArgs = ['-m', 'pip', 'install', '--no-warn-script-location', '--upgrade', '--target', sitePk]
  if (indexUrl) pipArgs.push('-i', indexUrl)
  pipArgs.push(...specs)
  try {
    execFileSync(hostExe, pipArgs, { stdio: 'inherit', env: { ...process.env, PYTHONHOME: '', PYTHONPATH: '' } })
  } catch (e) {
    die('pip 安装失败：' + (e.message || e) +
      '\n   常见原因：默认源缺少某些包（例如 anthropic）—— 换源重试：' +
      '\n     node scripts/make-python-pack.mjs --from-scratch --index https://pypi.tuna.tsinghua.edu.cn/simple' +
      '\n   （需要联网；也可先在别处装好后用 --from 打包）')
  }
  SRC_DESC = 'from-scratch(' + hostExe + ')'
} else {
  // ── 模式 ②：以现成环境为源 ─────────────────────────────────
  if (!existsSync(FROM)) die('--from 目录不存在: ' + FROM)
  const pyExe1 = join(FROM, 'Scripts', 'python.exe')
  const pyExe2 = join(FROM, 'python.exe')
  const pySrc = existsSync(pyExe1) ? pyExe1 : (existsSync(pyExe2) ? pyExe2 : '')
  if (!pySrc) die('目录里没有 python.exe（既不在根下也不在 Scripts\\ 下）：' + FROM)
  log('1/6 源环境: ' + pySrc + (pySrc === pyExe1 ? '  ⚠️ venv 结构（不可整体搬走，用户机器上可能起不来，建议改用 --from-scratch）' : ''))
  log('2/6 复制环境（1~3 分钟，视磁盘）…')
  cpSync(FROM, INNER, {
    recursive: true,
    filter: (src) => !/__pycache__/i.test(src) && !/\.pdb$/i.test(src),
  })
  SRC_DESC = FROM
}

// ── 4) ★自证：用"即将打进包里的那个 python.exe"真跑一次 ──────────
log('4/6 自证：用包内 python.exe 真跑一次（版本 + 逐包 import）…')
const pyFinal = existsSync(join(INNER, 'python.exe'))
  ? join(INNER, 'python.exe')
  : join(INNER, 'Scripts', 'python.exe')
if (!existsSync(pyFinal)) die('包里没有 python.exe')
const self = probePy(pyFinal)
if (!self.ok) {
  die('包内 python 起不来：' + self.err +
    '\n   （venv 结构或缺少 DLL/标准库都会这样 —— 这就是"用户机器上跑不起来"的成因）')
}
const bad = checkAgainstManifest(self.info)
if (bad.length) {
  die('包内环境与客户端要求不一致（不产出坏包）：\n   - ' + bad.join('\n   - ') +
    '\n   处理：pip 装齐后再打包，或调整 electron/env-manifest.js 的版本规格（但两者必须一致）')
}
log('   ✓ python ' + self.info.python + ' / ' + M.PY_PACKAGES.map((p) => p.pkg + ' ' + (self.info[p.pkg] || '?')).join(' / '))

log('5/6 再证一步：真启动 playwright（import 通过 ≠ 能用）…')
try {
  const rt = execFileSync(pyFinal, ['-c', 'from playwright.sync_api import sync_playwright\np=sync_playwright().start()\nprint("VFRT"+str(p.chromium.executable_path))\np.stop()'], { encoding: 'utf-8', timeout: 300000 })
  const rl = String(rt).split(/\r?\n/).find((l) => l.startsWith('VFRT'))
  log('   ✓ playwright 能启动（它期望的内核：' + (rl ? rl.slice(4) : '?') + '）')
  log('     ↳ 打包时 build-local.mjs 会把这个内核装进 <resources>/ms-playwright')
} catch (e) {
  die('包内 playwright 真启动失败：' + String((e.stdout || '') + (e.stderr || '') || e.message || e).slice(-400))
}

// ── 6) 写清单 + 压缩 + 校验产出 ────────────────────────────────
log('6/6 写清单 → 压缩 → 校验…')
writeFileSync(join(STAGE, 'env-manifest.json'), JSON.stringify({
  kind: 'python-bu',
  envPackVersion: M.ENV_PACK_VERSION,
  builtAt: new Date().toISOString(),
  builtFrom: SRC_DESC,
  layout: existsSync(join(INNER, 'python.exe')) ? 'buvenv-test/python.exe' : 'buvenv-test/Scripts/python.exe',
  runtime: Object.assign({ python: String(self.info.python || '') },
    M.PY_PACKAGES.reduce((o, p) => { o[p.pkg] = String(self.info[p.pkg] || ''); return o }, {})),
  expect: Object.assign({ python: M.RUNTIME.python.spec },
    M.PY_PACKAGES.reduce((o, p) => { if (p.spec) o[p.pkg] = p.spec; return o }, {})),
  packages: M.PY_PACKAGES.map((p) => p.pkg + (p.spec ? '==' + p.spec : '')),
  browsersDir: M.BROWSERS_DIR,
  note: '本文件是环境包自证：客户端自检读它核对版本/依赖；打包脚本也读它拦住"版本对不上"的包。',
}, null, 2))

mkdirSync(dirname(OUT), { recursive: true })
try { rmSync(OUT, { force: true }) } catch (e) {}
execFileSync(S7Z, ['a', '-tzip', '-mx=3', '-bso0', '-bsp0', OUT, 'buvenv-test', 'env-manifest.json'], { cwd: STAGE, stdio: 'inherit' })
if (!existsSync(OUT)) die('压缩失败（未产出 ' + OUT + '）')
try { rmSync(STAGE, { recursive: true, force: true }) } catch (e) {}

const size = statSync(OUT).size
if (size < 20 * 1024 * 1024) die('产出过小（' + Math.round(size / 1048576) + 'MB）—— 大概率打错了目录')
let list = ''
try { list = execFileSync(S7Z, ['l', '-ba', OUT], { encoding: 'utf-8', maxBuffer: 256 * 1024 * 1024 }) } catch (e) { die('无法列出 zip 内容: ' + (e.message || e)) }
if (!/buvenv-test[\\/](Scripts[\\/])?python\.exe/i.test(list)) die('zip 里没有 python.exe（结构不对）')
if (!/env-manifest\.json/i.test(list)) die('zip 里没有 env-manifest.json（客户端无法核对版本）')

const n = list.split(/\r?\n/).filter(Boolean).length
console.log('')
log('✅ 完成：' + OUT)
log('   ' + (size / 1048576).toFixed(1) + ' MB / ' + n + ' 个条目 / 环境包版本 ' + M.ENV_PACK_VERSION)
log('   来源：' + SRC_DESC)
log('   实测：python ' + self.info.python + ' / ' + M.PY_PACKAGES.map((p) => p.pkg + ' ' + (self.info[p.pkg] || '?')).join(' / '))
console.log('')
log('下一步：')
log('   ① 打进安装包（会顺带把两侧浏览器内核装齐并逐个断言）：node scripts/build-local.mjs')
log('   ② 上传 OSS（兜底通道用，可选）：node scripts/upload-python-bu.mjs public/python-bu.zip')
