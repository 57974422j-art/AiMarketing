/**
 * ═══ ENV_INSTALL_V1（2026-09-22 用户定案）═══
 *
 * 解决的核心问题（用户原话）：
 *   "自检要精准不能像现在这样没有就跳过了，没有什么立即启动安装什么"
 *   "安装期间不进入下一步…发现更新没更新不允许进入下一步，只有版本号对上才进入下一步"
 *   "其它安装包也是检查有什么缺什么。系统是什么，然后先从我们 OSS 下载下来缺什么补什么"
 *
 * 本模块提供【校验 → 补齐 → 复检】三件事，配合 env-manifest.js 的清单工作：
 *   verifyItem(item)   逐项校验（存在？版本对？真能跑？）——【不信"文件在"就算好】
 *   repairItem(item)   缺/不符 → 补齐：① 包内自带 → ② 本地备份 → ③ OSS 下载
 *   runEnvSelfCheck()  完整状态机：逐项 校验→补齐→【复检】→ 出 verdict
 *
 * 铁律（与 installer.nsh / build-local.mjs 的 KEEP_USERDATA 一致）：
 *   · 用户数据目录（data/ storage/）永不删除、永不改名
 *   · 要重建的目录 → 【改名保留】(<dir>.bak-<时间戳>) 而不是删除
 *   · 登录态目录只判"可写"，不读内容、不重建（首次安装为空 = 正常）
 */

const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const M = require('./env-manifest')

/** 安装根目录：exe 同级 */
function installRoot() {
  try { return path.dirname(require('electron').app.getPath('exe')) } catch (e) { return process.cwd() }
}
/** 包内资源目录 */
function resourcesRoot() {
  try { return process.resourcesPath } catch (e) { return path.join(installRoot(), 'resources') }
}

/** 写安装/自检日志（用户可把这一个文件发过来定位问题） */
function elog(line) {
  const msg = '[' + new Date().toLocaleString() + '] ' + line
  try { console.log('[env] ' + line) } catch (e) {}
  try {
    const f = path.join(require('electron').app.getPath('userData'), 'env-setup.log')
    if (fs.existsSync(f) && fs.statSync(f).size > 2 * 1024 * 1024) {
      try { fs.renameSync(f, f + '.1') } catch (e2) {}   // 超过 2MB 轮转一份，防无限增长
    }
    fs.appendFileSync(f, msg + '\n')
  } catch (e) {}
}

/** 只含 `*` 的极简 glob（够用且无依赖）：把 * 当路径段内的通配 */
function globMatch(pattern, p) {
  const norm = (s) => String(s).replace(/\\/g, '/')
  const re = '^' + norm(pattern).split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*') + '$'
  return new RegExp(re, 'i').test(norm(p))
}
/** 展开带 * 的路径：返回实际命中的文件（只支持"某一级目录名带 *"这种常见形态） */
function globExpand(root, pattern) {
  const norm = (s) => String(s).replace(/\\/g, '/')
  const full = path.join(root, norm(pattern))
  if (!norm(pattern).includes('*')) return fs.existsSync(full) ? [full] : []
  // 逐段展开
  const segs = norm(pattern).split('/')
  let cur = [root]
  for (const seg of segs) {
    const next = []
    for (const c of cur) {
      if (!seg.includes('*')) { next.push(path.join(c, seg)); continue }
      try {
        for (const ent of fs.readdirSync(c)) {
          if (globMatch(seg, ent)) next.push(path.join(c, ent))
        }
      } catch (e) {}
    }
    cur = next
    if (!cur.length) break
  }
  return cur.filter((p) => { try { return fs.existsSync(p) } catch (e) { return false } })
}

/** 异步跑命令，返回 {code, stdout, stderr}（绝不阻塞主进程） */
function run(exe, args, opts) {
  const o = opts || {}
  return new Promise((resolve) => {
    let done = false
    const fin = (r) => { if (!done) { done = true; resolve(r) } }
    try {
      const p = spawn(exe, args, { windowsHide: true, env: Object.assign({}, process.env, o.env || {}) })
      let out = '', err = ''
      const t = setTimeout(() => { try { p.kill() } catch (e) {} fin({ code: -1, stdout: out, stderr: 'timeout' }) }, o.timeout || 300000)
      if (p.stdout) p.stdout.on('data', (d) => { out += String(d) })
      if (p.stderr) p.stderr.on('data', (d) => { err += String(d) })
      p.on('close', (code) => { clearTimeout(t); fin({ code, stdout: out, stderr: err }) })
      p.on('error', (e) => { clearTimeout(t); fin({ code: -9, stdout: '', stderr: String((e && e.message) || e) }) })
    } catch (e) { fin({ code: -9, stdout: '', stderr: String((e && e.message) || e) }) }
  })
}

/** 目标 python.exe：解压后可能在 buvenv-test 或更浅一层（沿用旧的动态查找逻辑） */
function findBuiltinPy() {
  const root = path.join(installRoot(), 'python')
  const cands = [
    path.join(root, 'buvenv-test', 'Scripts', 'python.exe'),
  ]
  for (const c of cands) { try { if (fs.existsSync(c)) return c } catch (e) {} }
  try {
    for (const d of fs.readdirSync(root, { withFileTypes: true })) {
      if (!d.isDirectory() || /\.bak-/i.test(d.name)) continue
      const p1 = path.join(root, d.name)
      for (const sub of ['Scripts', '']) {
        const c = path.join(p1, sub, 'python.exe')
        if (fs.existsSync(c)) return c
      }
    }
  } catch (e) {}
  return ''
}

/**
 * ── 网络探测（用户定稿②：没网络 → 客户端不启动，弹窗让联网）──
 * 只要"能连上我们服务器"就算有网（能不能上外网不作要求）。
 */
async function probeNetwork(serverUrl, timeoutMs) {
  const url = String(serverUrl || 'https://ai-niuma.cc').replace(/\/$/, '')
  try {
    const r = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(timeoutMs || 8000) })
    return { ok: r.status > 0, status: r.status, url }
  } catch (e) {
    return { ok: false, status: 0, url, err: String((e && e.message) || e) }
  }
}

// ─────────────────────────────────────────────────────────────
// 单镜校验
// ─────────────────────────────────────────────────────────────

/**
 * ★PY_PACKAGES_V1：一次问清"Python 版本 + 清单里每个包的真实版本 + 每个包是否真能 import"。
 *   为什么不只查 playwright/browser_use：脚本还 import dotenv / PIL —— 缺了它们，
 *   本机看不出问题，用户机器上发布就崩（这正是"检查有什么缺什么"要覆盖的范围）。
 */
function buildPyProbe() {
  const pkgs = M.PY_PACKAGES.map((p) => p.pkg)
  const imps = M.PY_PACKAGES.map((p) => p.imp)
  return [
    'import sys,json',
    'd={"python":sys.version.split()[0],"imports":{}}',
    'import importlib.metadata as m',
    'for k in ' + JSON.stringify(pkgs) + ':',
    '    try: d[k]=m.version(k)',
    '    except Exception: d[k]=""',
    'for mod in ' + JSON.stringify(imps) + ':',
    '    try:',
    '        __import__(mod.split(".")[0]); d["imports"][mod]="ok"',
    '    except Exception as e: d["imports"][mod]="ERR "+str(e)[:60]',
    'print("VFENV"+json.dumps(d))',
  ].join('\n')
}
const PY_PROBE = buildPyProbe()

/** 内置环境：真跑一次，拿真实版本 + 逐包 import + 真启动 playwright（"文件在"不算通过） */
async function verifyPythonItem(item) {
  const py = findBuiltinPy()
  if (!py) return { ok: false, detail: '未安装（' + path.join(installRoot(), 'python') + ' 下没有 python.exe）', fixable: true }
  const r = await run(py, ['-c', PY_PROBE], { timeout: 60000 })
  const line = String(r.stdout || '').split(/\r?\n/).find((l) => l.startsWith('VFENV'))
  if (!line) {
    return { ok: false, detail: '环境存在但跑不起来：' + String((r.stderr || r.stdout) || '').slice(-200), fixable: true }
  }
  let got = {}
  try { got = JSON.parse(line.slice(5)) } catch (e) {}
  const bad = []
  if (!M.matchSpec(got.python, M.RUNTIME.python.spec)) bad.push('python=' + (got.python || '?') + '（要求 ' + M.RUNTIME.python.spec + '）')
  // ★PY_PACKAGES_V1：逐包"版本对 + 真能 import"
  const imps = got.imports || {}
  for (const p of (item.packages || M.PY_PACKAGES)) {
    const v = String(got[p.pkg] || '')
    if (p.spec && !M.matchSpec(v, p.spec)) bad.push(p.pkg + '=' + (v || '缺') + '（要求 ' + p.spec + '）')
    if (imps[p.imp] !== 'ok') bad.push(p.imp + ' 无法 import（' + String(imps[p.imp] || '未测') + '）')
  }
  if (bad.length) {
    return { ok: false, got, detail: '版本/依赖不符：' + bad.join(' / '), fixable: true }
  }
  // ★真执行：import 通过 ≠ 能用（旧代码已经吃过这个亏）—— 再真启动一次，并顺便问出它期望的浏览器路径
  const r2 = await run(py, ['-c', 'from playwright.sync_api import sync_playwright\np=sync_playwright().start()\nprint("VFEXE"+str(p.chromium.executable_path))\np.stop()'], { timeout: 90000 })
  const l2 = String(r2.stdout || '').split(/\r?\n/).find((l) => l.startsWith('VFEXE'))
  if (!l2) {
    return { ok: false, got, detail: '能 import 但真启动 playwright 失败：' + String((r2.stderr || r2.stdout) || '').slice(-200), fixable: false }
  }
  const wantExe = l2.slice(5).trim()
  const exeOk = wantExe && fs.existsSync(wantExe)
  // 逐包列出实测版本（用户/开发一眼能看到"包里到底是什么版本"）
  const verTxt = ['python ' + got.python]
    .concat((item.packages || M.PY_PACKAGES).map((p) => p.pkg + ' ' + (got[p.pkg] || '?')))
    .join(' / ')
  return {
    ok: true, got,
    detail: verTxt +
      '\n浏览器内核：' + (exeOk ? '就绪（' + wantExe + '）' : '⚠️ 期望位置不存在：' + wantExe),
    pythonExe: py, browserExe: wantExe, browserOk: exeOk,
  }
}

/** app.getAppPath()：打包后是 <resources>\app.asar —— asar 内文件要走这个基准（★ASR_PACK_V1） */
function appPath() {
  try { return require('electron').app.getAppPath() } catch (e) { return process.cwd() }
}
/** 是否安装版（决定 devSkip 项要不要跳过） */
function isPackaged() {
  try { return !!require('electron').app.isPackaged } catch (e) { return false }
}

/** 文件清单（存在 + 不太小）。基准：默认 <安装目录>（extraResources 类）；item.base==='app' 则用 app.getAppPath() */
function verifyFilesItem(item) {
  const root = item.base === 'app' ? appPath() : installRoot()
  const miss = [], tiny = []
  for (const f of item.files || []) {
    const p = path.join(root, f.replace(/\//g, path.sep))
    try {
      const st = fs.statSync(p)
      if ((item.minBytes || 1) > 0 && st.size < item.minBytes) tiny.push(f + '（仅 ' + st.size + ' 字节）')
    } catch (e) { miss.push(f) }
  }
  if (miss.length || tiny.length) {
    return {
      ok: false,
      detail: (miss.length ? '缺失 ' + miss.length + ' 个：' + miss.slice(0, 3).join(' / ') + (miss.length > 3 ? ' …' : '') : '') +
        (tiny.length ? (miss.length ? '；' : '') + '内容异常：' + tiny.join(' / ') : ''),
      miss, fixable: true,
    }
  }
  return { ok: true, detail: '齐备（' + item.files.length + ' 个文件，均存在且可读）' }
}

/**
 * ★BROWSER_ALIGN_V1：Python 侧内核 —— 【问 Python 的 playwright 本人要路径】，再看它在不在。
 *   为什么不能"看目录里有没有 chromium-*"：版本不同要的 build 号不同
 *   （本机实测 Node 1.60→1223、Python 1.62→1234，而包内当时只有 1228 = 两边都不对）。
 *
 *   为什么两侧共用 <resources>/ms-playwright 这一个目录（而不是各放一份）：
 *     ① 运行时 main.js 会把 PLAYWRIGHT_BROWSERS_PATH 设成它（Node 侧必须），
 *        这个变量【Python 子进程会继承】—— 所以 Python 发布时用的就是这里；
 *        校验必须**按同样的方式**问一遍，否则"校验说没事、发布却找不到浏览器"。
 *     ② 一个目录里可以同时存在多个 build（chromium-1223 / chromium-1234），
 *        各侧只会去找自己那个 —— 互不干扰，也不用再猜。
 */
function sharedBrowsersDir() {
  return path.join(installRoot(), 'resources', M.BROWSERS_DIR)
}
async function askPyChromiumExe(py, pwb) {
  const env = pwb ? { PLAYWRIGHT_BROWSERS_PATH: pwb } : {}
  const r = await run(py, ['-c', 'from playwright.sync_api import sync_playwright\np=sync_playwright().start()\nprint("VFEXE"+str(p.chromium.executable_path))\np.stop()'], { timeout: 120000, env })
  const l = String(r.stdout || '').split(/\r?\n/).find((x) => x.startsWith('VFEXE'))
  if (!l) return { exe: '', err: String((r.stderr || r.stdout) || '').slice(-200) }
  return { exe: l.slice(5).trim() }
}

async function verifyPyBrowsersItem() {
  const py = findBuiltinPy()
  if (!py) return { ok: false, detail: '内置 Python 环境还没装好 → 先修「内置运行环境」这一项', fixable: false }
  const dir = sharedBrowsersDir()
  const pwb = fs.existsSync(dir) ? dir : ''      // 与运行时一致：包内那份在 → 就用它
  const a = await askPyChromiumExe(py, pwb)
  if (!a.exe) return { ok: false, detail: 'Python 的 playwright 起不来：' + a.err, fixable: true }
  if (!fs.existsSync(a.exe)) {
    const build = path.basename(path.dirname(path.dirname(a.exe)))
    const have = (() => { try { return fs.readdirSync(pwb || path.join(process.env.LOCALAPPDATA || '', 'ms-playwright')).filter((d) => /^chromium/i.test(d)).join(', ') } catch (e) { return '?' } })()
    return {
      ok: false, want: a.exe, fixable: true,
      detail: 'Python 侧内核缺失：它需要 ' + build + '（' + a.exe + '），但目录里只有 ' + (have || '(空)') +
        '\n→ 不补的话：发布脚本开不了浏览器 → 发布必然失败（这就是"换台机器就不行"的常见原因）',
    }
  }
  return { ok: true, detail: '就绪（' + a.exe + '）', exe: a.exe }
}

/**
 * ★BROWSER_ALIGN_V1：Python 侧内核补齐 —— 用【这个 Python 自己的】playwright 把内核装进
 *   两侧共用的 <resources>/ms-playwright（它要哪个 build 就装哪个，不猜、不写死）；装完【立刻复检】。
 */
async function repairPyBrowsersItem(item, onProgress) {
  const py = findBuiltinPy()
  if (!py) return { ok: false, detail: '内置 Python 环境还没装好 → 先修「内置运行环境」这一项' }
  const dir = sharedBrowsersDir()
  const report = (m, p) => { try { if (onProgress) onProgress(m, p) } catch (e) {} }
  try { fs.mkdirSync(dir, { recursive: true }) } catch (e) {
    return { ok: false, detail: '无法写入内核目录（安装目录没有写权限）：' + dir + ' → ' + String((e && e.message) || e) }
  }
  report('正在用 Python 自带的 playwright 安装内核（约 130MB，需要联网）…', 10)
  const r = await run(py, ['-m', 'playwright', 'install', 'chromium'], { timeout: 1800000, env: { PLAYWRIGHT_BROWSERS_PATH: dir } })
  elog('python -m playwright install chromium → code=' + r.code + ' tail=' + String((r.stderr || r.stdout) || '').slice(-200))
  if (r.code !== 0) return { ok: false, detail: '安装内核失败：' + String((r.stderr || r.stdout) || '').slice(-240) }
  report('内核安装完成 → 正在复检…', 85)
  const v = await verifyPyBrowsersItem()
  return v.ok ? { ok: true, detail: v.detail } : { ok: false, detail: '补装后复检仍未通过：' + v.detail }
}

/**
 * ★BROWSER_ALIGN_V1：Node 侧内核 —— 同样【问 Node 的 playwright 本人】。
 *   这一项运行时补不了（客户端里没有 npm），所以不 blocking，只把问题说清楚；
 *   出厂 correctness 由 build-local.mjs 的硬闸门保证。
 */
function verifyNodeBrowsersItem(item) {
  const dir = path.join(installRoot(), item.dir || ('resources/' + M.BROWSERS_DIR))
  if (!fs.existsSync(dir)) {
    return { ok: false, detail: '包内没有 ' + dir + '（安装包缺内核）——系统没装 Chrome 时无法登记/发布', fixable: false }
  }
  let exe = ''
  try {
    process.env.PLAYWRIGHT_BROWSERS_PATH = dir      // 只在本进程内指一下，确保问的是"包内这份"
    const { chromium } = require('playwright')
    exe = chromium.executablePath()
  } catch (e) {
    return { ok: false, detail: '无法询问 Node 的 playwright：' + String((e && e.message) || e), fixable: false }
  }
  if (!exe) return { ok: false, detail: '包内没有可用的 Chromium', fixable: false }
  if (!fs.existsSync(exe)) {
    const have = (() => { try { return fs.readdirSync(dir).filter((d) => /^chromium/i.test(d)).join(', ') } catch (e) { return '?' } })()
    return {
      ok: false, fixable: false,
      detail: '包内内核与该版本 Node playwright 【对不上】：playwright 要 ' + path.basename(path.dirname(path.dirname(exe))) +
        '，包内实际是 ' + (have || '(空)') + '（期望文件：' + exe + '）\n' +
        '→ 影响：没有系统 Chrome/Edge 的机器将无法登记/发布；指纹浏览器也可能起不来。\n' +
        '→ 修法：用新版安装包覆盖安装（打包时 build-local.mjs 会用 Node 自己的 playwright 把内核装进该目录）',
    }
  }
  return { ok: true, detail: '就绪（' + exe + '）', exe }
}

/** 候选可执行文件里至少一个存在（可选：必须是"完整 Chromium"而非 headless_shell） */
function verifyExeAnyItem(item) {
  const root = installRoot()
  const hits = []
  for (const pat of item.exeAny || []) {
    for (const p of globExpand(root, pat)) hits.push(p)
  }
  if (item.needFullChromium) {
    const full = hits.filter((p) => /chrome\.exe$/i.test(p))
    if (!full.length) {
      return { ok: false, detail: '没找到可开界面的 Chromium（只有 headless/或完全没有）——登记与发布需要一个真窗口浏览器', hits, fixable: false }
    }
    return { ok: true, detail: '就绪（' + full.length + ' 个可用内核，例如 ' + path.basename(path.dirname(path.dirname(full[0]))) + '）', hits }
  }
  if (!hits.length) return { ok: false, detail: '未找到（候选：' + (item.exeAny || []).join(' / ') + '）', fixable: true }
  return { ok: true, detail: '就绪（' + hits.length + ' 个）', hits }
}

/** 统一入口：按 kind 分派 */
async function verifyItem(item) {
  try {
    // ★ASR_PACK_V1：有些项只在【安装版】才有意义（例如 <resources>/models —— 开发环境读的是仓库目录）
    if (item.devSkip && !isPackaged()) {
      return { ok: true, detail: '开发环境跳过（该项只在安装版里有意义）' }
    }
    if (item.kind === 'zip') return await verifyPythonItem(item)
    if (item.kind === 'files') return verifyFilesItem(item)
    if (item.kind === 'exeAny') return verifyExeAnyItem(item)
    if (item.kind === 'pybrowser') return await verifyPyBrowsersItem(item)   // ★BROWSER_ALIGN_V1
    if (item.kind === 'nodebrowser') return verifyNodeBrowsersItem(item)     // ★BROWSER_ALIGN_V1
    return { ok: false, detail: '未知类型 ' + item.kind, fixable: false }
  } catch (e) {
    return { ok: false, detail: String((e && e.message) || e), fixable: false }
  }
}

// ─────────────────────────────────────────────────────────────
// 补齐
// ─────────────────────────────────────────────────────────────

/** 把要重建的目录【改名保留】（绝不删除） */
function renameAside(dir) {
  try {
    if (!fs.existsSync(dir)) return { ok: true, renamed: '' }
    const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
    const bak = dir + '.bak-' + ts
    fs.renameSync(dir, bak)
    elog('旧目录已改名保留（未删除）：' + dir + ' → ' + path.basename(bak))
    return { ok: true, renamed: bak }
  } catch (e) {
    return { ok: false, err: String((e && e.message) || e) }
  }
}

/** 解压 zip 到 dest（用 powershell Expand-Archive —— 与旧实现一致，避免引入新依赖） */
async function unzipTo(zipPath, destDir) {
  fs.mkdirSync(destDir, { recursive: true })
  const r = await run('powershell', ['-NoProfile', '-NonInteractive', '-Command',
    'Expand-Archive -LiteralPath "' + zipPath + '" -DestinationPath "' + destDir + '" -Force'], { timeout: 1800000 })
  if (r.code !== 0) return { ok: false, err: String((r.stderr || r.stdout) || '').slice(-300) }
  return { ok: true }
}

/** 读 zip 内的 env-manifest.json（解压后它就在 dest 里） */
function readInnerManifest(destDir, name) {
  const cands = [path.join(destDir, name), path.join(destDir, 'buvenv-test', name)]
  for (const c of cands) {
    try { if (fs.existsSync(c)) return { path: c, json: JSON.parse(fs.readFileSync(c, 'utf-8')) } } catch (e) {}
  }
  return null
}

/**
 * 补齐一个 zip 类依赖：
 *   ① 包内自带（resources/<zipName>）→ ② 同目录下的本地备份（python/<zipName>）
 *   ③ OSS 下载（用户允许：缺什么从 OSS 下载什么；正常用户永远走不到这一步）
 * 装完【立刻复检】—— 这就是"安装也是，只有对得上才进入下一步"。
 */
async function repairZipItem(item, onProgress) {
  const root = installRoot()
  const destName = item.dest || 'python'
  const destDir = path.join(root, destName)
  const report = (msg, pct) => { try { if (onProgress) onProgress(msg, pct) } catch (e) {} }

  // ── 找 zip（包内 → 本地备份 → OSS）──
  //   ★顺序即用户定稿：包内自带（主）→ 本地备份 → OSS（只在这两级都没有/都坏时才用）
  const cands = [
    path.join(resourcesRoot(), item.zipName),          // ① 包内 resources/python-bu.zip
    path.join(destDir, item.zipName),                  // ② 上次留下的备份（在 python/ 里）
  ]
  let zipPath = ''
  for (const c of cands) {
    try { if (fs.existsSync(c) && fs.statSync(c).size > 1024 * 1024) { zipPath = c; break } } catch (e) {}
  }
  if (zipPath) {
    report('使用【安装包内自带】的环境包（无需下载）：' + path.basename(zipPath), 20)
  } else if (item.ossUrl) {
    // ★OSS 只作兜底：包内没有/被杀软删了才走这里
    report('包内未找到环境包 → 从 OSS 下载（需要联网，约 100~250MB）…', 5)
    fs.mkdirSync(destDir, { recursive: true })
    const dl = path.join(destDir, item.zipName)
    try {
      const rsp = await fetch(item.ossUrl, { signal: AbortSignal.timeout(1800000) })
      if (!rsp.ok) throw new Error('HTTP ' + rsp.status)
      const buf = Buffer.from(await rsp.arrayBuffer())
      fs.writeFileSync(dl, buf)
      elog('OSS 下载完成：' + dl + '（' + Math.round(buf.length / 1048576) + 'MB）')
      zipPath = dl
      report('下载完成（' + Math.round(buf.length / 1048576) + 'MB）→ 正在解压…', 35)
    } catch (e) {
      return { ok: false, detail: '包内没有环境包，OSS 下载也失败：' + String((e && e.message) || e) }
    }
  } else {
    return { ok: false, detail: '包内没有环境包，且清单里没配 OSS 地址' }
  }

  // ── 解压前：旧目录【改名保留】（绝不删用户数据）──
  const preserve = ['storage']
  try {
    if (fs.existsSync(destDir)) {
      // 先把要保留的子目录挪到临时位（防被 ---Force 覆盖丢失）
      const stash = []
      for (const sub of preserve) {
        const sp = path.join(destDir, sub)
        if (fs.existsSync(sp)) { const tp = destDir + '.__keep_' + sub; try { fs.renameSync(sp, tp); stash.push([tp, sp]) } catch (e) {} }
      }
      const rn = renameAside(destDir)
      if (!rn.ok) return { ok: false, detail: '旧环境目录改名失败（可能被占用，请先关闭客户端再试）：' + rn.err }
      fs.mkdirSync(destDir, { recursive: true })
      for (const [tp, sp] of stash) { try { fs.renameSync(tp, sp) } catch (e) {} }
    }
  } catch (e) { elog('旧目录处理异常（继续）：' + String((e && e.message) || e)) }

  report('正在解压环境包（大文件，请稍候，勿关闭窗口）…', 45)
  const ex = await unzipTo(zipPath, destDir)
  if (!ex.ok) return { ok: false, detail: '解压失败：' + ex.err }

  // ── 装完【立刻复检】──
  report('解压完成 → 正在复检…', 80)
  const inner2 = readInnerManifest(destDir, item.innerManifest)
  if (item.innerManifest) {
    if (!inner2) {
      elog('⚠️ 环境包里没有 ' + item.innerManifest + ' —— 无法核对版本（这说明包是旧的/坏的，请重新制作）')
    } else {
      const want = M.ENV_PACK_VERSION
      const gotV = String((inner2.json && inner2.json.envPackVersion) || '')
      if (gotV && gotV !== want) {
        elog('⚠️ 环境包版本不符：包内 ' + gotV + ' / 期望 ' + want + '（继续复检，以实际能跑为准）')
      } else {
        elog('环境包清单核对通过：' + gotV)
      }
      // 顺手核对关键版本（包内清单 vs 代码清单）
      const req = (inner2.json && inner2.json.runtime) || {}
      for (const k of ['playwright', 'browser_use']) {
        const a = String(req[k] || ''), b = String((M.RUNTIME[k] || {}).spec || '')
        if (a && b && a !== b && !/^[<>=]/.test(b)) {
          elog('⚠️ 版本不一致：包内 ' + k + '=' + a + ' / 代码要求 ' + b + ' —— 请重做环境包（打包阶段本应拦住）')
        }
      }
    }
  }
  const v = await verifyItem(item)
  return v.ok ? { ok: true, detail: v.detail } : { ok: false, detail: '补齐后复检仍未通过：' + v.detail }
}

/** 补齐入口（目前只有 zip 类"能从源头重装"；files/exeAny 类属于【打包漏了】→ 明确报错，不糊弄） */
async function repairItem(item, onProgress) {
  if (item.kind === 'zip') return await repairZipItem(item, onProgress)
  if (item.kind === 'pybrowser') return await repairPyBrowsersItem(item, onProgress)   // ★BROWSER_ALIGN_V1
  // 文件类缺件本地没法凭空造出来 —— 但要分清两种情况（★OPTIONAL_COPY_FIX_V1）：
  //   · blocking（登记/发布必需）→ 这是【安装包本身不完整】，让用户重装（唯一出路）
  //   · 非 blocking（如本地语音识别）→ 别叫用户去重装！本版本就可能没内置它，重装一百次也没用。
  //     （用户实测：截图里那条 asr-lib 提示写着"请重新下载安装包覆盖安装"→ 白下 679MB）
  const _list = (item.files || item.exeAny || []).slice(0, 3).join(' / ')
  if (!item.blocking) {
    return { ok: false, detail: (item.note ? item.note + '\n' : '') + '（缺失：' + _list + '）' }
  }
  return {
    ok: false,
    detail: '安装包内缺少该组件（' + _list + '）——' +
      '这是【安装包本身不完整】，请重新下载安装包覆盖安装；' +
      '若反复如此，把 ' + 'data\\env-setup.log' + ' 发给开发',
  }
}

// ─────────────────────────────────────────────────────────────
// 状态机
// ─────────────────────────────────────────────────────────────

/**
 * 跑完整个环境自检（清单驱动）。
 * onItem(id, state, detail, done, progress)：每条状态回吐给自检页（与 splash 现有协议一致）
 * 返回 { ok, blocked:[], results:{} } —— ok=false 时调用方【不得放行进入下一步】
 */
async function runEnvSelfCheck(onItem) {
  const emit = (id, state, detail, done, progress) => { try { if (onItem) onItem(id, state, detail, done, progress) } catch (e) {} }
  const results = {}
  const blocked = []
  const todo = M.ITEMS
  let i = 0
  const overall = (extra) => {
    const pct = Math.round(((i + (extra || 0)) / todo.length) * 100)
    return Math.max(0, Math.min(100, pct))
  }
  elog('环境自检开始：清单 ' + todo.length + ' 项 / 环境包版本 ' + M.ENV_PACK_VERSION + ' / 安装根目录 ' + installRoot())

  for (const item of todo) {
    i++
    emit(item.id, 'run', '正在校验：' + item.title, false, overall(0))
    let v = await verifyItem(item)
    if (v.ok) {
      emit(item.id, 'ok', item.title + '：通过\n' + String(v.detail || ''), true, overall(0.9))
      results[item.id] = { ok: true, detail: v.detail }
      continue
    }
    elog('❌ ' + item.id + ' 未通过：' + v.detail)
    // 未通过 → 【立刻补齐】（不再"没有就跳过"）
    if (v.fixable) {
      emit(item.id, 'run', item.title + '：未通过 → 正在自动补齐…\n' + String(v.detail || ''), false, overall(0.2))
      let r
      try {
        r = await repairItem(item, (msg, pct) => {
          emit(item.id, 'run', item.title + '：' + msg, false, overall(Math.min(0.85, (pct || 0) / 100)))
        })
      } catch (e) {
        r = { ok: false, detail: '补齐异常：' + String((e && e.message) || e) }
      }
      if (r.ok) {
        emit(item.id, 'ok', item.title + '：已自动补齐并通过复检 ✓\n' + String(r.detail || ''), true, overall(0.95))
        results[item.id] = { ok: true, detail: r.detail, repaired: true }
        elog('✅ ' + item.id + ' 已自动补齐')
        continue
      }
      v = { ok: false, detail: r.detail || v.detail }
    }
    // 仍未通过
    const state = item.blocking ? 'bad' : 'warn'
    emit(item.id, state, item.title + '：未通过\n' + String(v.detail || '') +
      (item.blocking ? '\n\n★这是必要组件，未通过不允许进入下一步。修好后点「重试」或重启客户端。' : ''), true, overall(1))
    results[item.id] = { ok: false, detail: v.detail }
    if (item.blocking) blocked.push({ id: item.id, title: item.title, detail: v.detail })
  }

  const ok = blocked.length === 0
  // ★OPTIONAL_COPY_FIX_V1：日志别再说"全部通过"却留着一条 ⚠（用户截图里就是"标题说全过、下面一条提示"，看着自相矛盾）
  const warnIds = M.ITEMS.filter((it) => !it.blocking && !((results[it.id] || {}).ok)).map((it) => it.id)
  elog('环境自检结束：' + (ok
    ? ('必要项全部通过' + (warnIds.length
      ? '（另有 ' + warnIds.length + ' 项提示未通过：' + warnIds.join(', ') + ' —— 不影响登记/发布）'
      : '（' + M.ITEMS.length + ' 项）'))
    : ('被拦下 ' + blocked.length + ' 项 → ' + blocked.map((b) => b.id).join(', '))))
  return { ok, blocked, warnIds, results }
}

/** 给发布用的浏览器内核路径（Node 侧与 Python 侧共用包内那一份） */
function bundledBrowsersDir() {
  return path.join(resourcesRoot(), M.BROWSERS_DIR)
}

/**
 * ★PLAYWRIGHT_BROWSERS_PATH：让 Python 侧的 playwright 也用【包内那一份】内核 ——
 *   ① 只存一份浏览器（省 ~150MB）② 两侧版本天然一致 ③ 不依赖 %LOCALAPPDATA% 里有没有装
 *   只在"包内确实有内核、且能过校验"时才设置；否则【保持原行为】（绝不制造新问题）。
 */
function applyBundledBrowsersPath() {
  try {
    const dir = bundledBrowsersDir()
    if (!fs.existsSync(dir)) { elog('包内没有 ' + M.BROWSERS_DIR + ' → 不设置 PLAYWRIGHT_BROWSERS_PATH（Python 侧走它自己的默认位置）'); return false }
    process.env.PLAYWRIGHT_BROWSERS_PATH = dir
    elog('PLAYWRIGHT_BROWSERS_PATH = ' + dir + '（Node 与 Python 共用包内内核）')
    return true
  } catch (e) { return false }
}

module.exports = {
  installRoot, resourcesRoot, findBuiltinPy, globExpand,
  probeNetwork, verifyItem, repairItem, runEnvSelfCheck,
  applyBundledBrowsersPath, bundledBrowsersDir, elog, run,
}
