#!/usr/bin/env node
/**
 * check-engine-lint.mjs —— 引擎 lint 的**硬闸门**（把 team-lead 拍定的口径钉住）
 *
 * 口径（team-lead 定）：
 *   1. `check --json` 的 **`lint.errorCount === 0` 是硬闸门**；
 *   2. 另**显式断言**两个 code 绝不出现：
 *      · `missing_timeline_registry`  —— 注册必须**内联**在 composition HTML 里（外部 master.js 的注册 lint 看不见）；
 *      · `multiple_root_compositions` —— 产物目录里只许一个 `index.html`（多一个根级 HTML 就报）；
 *   3. `layout / motion / contrast` 有 findings 时 **先人看再定**（我们的文字可能不在引擎审计面内，见主报告 §26 的 ⑤）——
 *      所以本闸门**不**把这三段当判据，只打印摘要；
 *   4. 其余 lint warning（如 `track_too_dense` / `nested_structure_needs_subcomposition`）**只记录不拦**（结构性建议）。
 *
 * 用法: node check-engine-lint.mjs <产物目录> [--verbose]
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
/* ★ 路径收口：唯一来源 `paths.mjs`（本文件**不再**自己 `resolve(HERE,'..')`）。
   双布局探测（flat 入库后 / bridge-dev 当前开发树）+ 缺路径即红（`exit 2`）；避免再出现 K12 的 `..` 数错。 */
import { ENGINE_ROOT as ROOT, selfCheck } from './paths.mjs'
selfCheck({ quiet: true })
/** ★ hyperframes 解析：**唯一实现**在 `engine-bin.mjs`（K17 结构性收口 —— 本文件**不再保留候选数组定义**）。
    顺序：`ENGINE_HF_BIN` → `PATH` → 开发回退 `<引擎根>/node_modules/.bin/hyperframes[.cmd]`；
    全找不到 ⇒ 该模块 **exit 2**（§25b：输入/环境不完整 ≠ 判据失败）并列出所有候选。 */
import { resolveHyperframes } from './engine-bin.mjs'
const HF_INFO = resolveHyperframes()
const HF = HF_INFO.p
console.log(`  hyperframes = ${HF}（来源：${HF_INFO.why}；platform=${process.platform}）`)
const args = process.argv.slice(2)
/** ★ 部署闸门 = **两档**（v1 + v2；两套母版的 CSS 与判据路径不同：v2 才走 `p7-concl` 那条
    "过渡帧→稳定帧复测"、v2 的对比度令牌取值也不同 —— 只跑 v1 会漏掉整套 v2 代码路径）。
    ★ **自给自足**：**不依赖 `out/`**（`out/` 不在 git、服务器上不存在）—— 先 `render-deck.mjs --no-render`
    在**系统临时目录**生成产物（HTML + 对账，秒级），再对临时产物跑判据。
    ★ **唯一入口**：`node check-engine-lint.mjs --deploy`（部署脚本只调这一条，别内联拼参数 —— 改口径会分叉）。 */
const DEPLOY_DECKS = [
  { json: 'examples/deck.all12.json', tag: 'v1 · all12（16:9）' },
  { json: 'examples/deck.all12-master-v2.json', tag: 'v2 · all12（azure，判定路径不同）' },
]
if (args.includes('--deploy')) {
  const _d0 = Date.now()
  const tmpRoot = join(process.env.TEMP || process.env.TMP || '.', `cgl-deploy-${Date.now()}`)
  let badD = 0
  for (const d of DEPLOY_DECKS) {
    const name = String(d.json).split('/').pop().replace(/\.json$/, '')
    const prod = join(tmpRoot, name)
    const t1 = Date.now()
    const g = spawnSync(process.execPath, [join(HERE, 'render-deck.mjs'), join(HERE, d.json), '--no-render', '--outdir', tmpRoot], { encoding: 'utf8' })
    const genMs = Date.now() - t1
    console.log(`\n===== 部署闸门 · ${d.tag} =====`)
    // ★ 内层输出**一律加缩进前缀** `  | ` ⇒ 保证"**未被缩进的机器可读行只有一条（外层 GATE-RESULT）**"，
    //   即使解析方写错成"搜 RESULT "（`GATE-RESULT ` 含该子串）也不会误配生成器那行。
    const relay = (s, isErr) => { for (const line of String(s || '').split('\n')) if (line.trim()) (isErr ? console.error : console.log)(`  | ${line}`) }
    relay(g.stdout); relay(g.stderr, true)
    console.log(`  生成（HTML + 对账，**未渲染**）= ${(genMs / 1000).toFixed(1)}s · exit=${g.status} · 临时产物 ${prod}`)
    if (g.status !== 0 || !existsSync(join(prod, 'index.html'))) { badD++; console.error('  ✗ 生成失败 ⇒ 部署闸门判红'); continue }
    const c = spawnSync(process.execPath, [fileURLToPath(import.meta.url), prod, '--assert-contrast', '--deploy-no-pixel'], { encoding: 'utf8' })
    relay(c.stdout); relay(c.stderr, true)
    // 解析内层 GATE-RESULT（缩进后的行也能抓到）：聚合 ok / pixel_skipped，并**再兜一道 B-2**
    const m = String(c.stdout || '').match(/^GATE-RESULT (\{.*\})$/m)
    let inner = null
    try { inner = m ? JSON.parse(m[1]) : null } catch { inner = null }
    if (!inner) { badD++; console.error('  ✗ 内层未打印 GATE-RESULT（解析方/闸门口径漂移）⇒ 判红') }
    else {
      if (inner.pixel_skipped > 0) { badD++; console.error(`  ✗ 内层 pixel_skipped=${inner.pixel_skipped} > 0 ⇒ 部署档降级不许存在 ⇒ 判红（上报 team-lead）`) }
      if (!inner.ok) badD++
    }
    if (c.status !== 0) badD++
  }
  const ms = Date.now() - _d0
  console.log(`\n部署闸门（${DEPLOY_DECKS.length} 档，自给自足：临时目录生成 + 判据）**实测总耗时 = ${(ms / 1000).toFixed(1)}s** · 失败档数 = ${badD}${ms > 60000 ? '  ⚠ 超 60s 预算 ⇒ 按契约上报 team-lead' : ''}`)
  // ★ 外层**唯一一条未被缩进的机器可读行**：部署脚本只认行首 `^GATE-RESULT `
  console.log(`GATE-RESULT ${JSON.stringify({ ok: badD === 0, mode: 'deploy', decks: DEPLOY_DECKS.length, failed: badD, total_ms: ms, over_budget: ms > 60000 })}`)
  process.exit(badD ? 1 : 0)
}
/** 部署模式：不渲染 ⇒ **没有 mp4** ⇒ 无法抽稳定帧做像素复测。该情形**明确打印跳过**（不静默），
    由"程序化过渡帧证明"兜底；完整像素口径 = 本机全矩阵。 */
const deployNoPixel = args.includes('--deploy-no-pixel')
let deploySkipped = 0
// ★ Windows 相对路径坑：一律 `path.resolve()` 成绝对路径再交给引擎
//   （实测：传 `..\deck-contract\out\x` 时引擎报 `Not a directory: …\dist-rel\deck-contract\out\x` —— `..` 被多解析一层）
const dirArg = args.find((a) => !a.startsWith('--'))
if (!dirArg) {
  console.error('用法: node check-engine-lint.mjs <产物目录> [--dump] [--assert-contrast] [--assert-overlap] [--verbose]')
  console.error('  例: node check-engine-lint.mjs out/deck.master-v1')
  process.exit(2)
}
const dir = resolve(dirArg)
const verbose = args.includes('--verbose')
const dump = args.includes('--dump')
const assertContrast = args.includes('--assert-contrast')
/* ★ **重叠判据开关**（team-lead ③ 抓到的口径分叉）：闸门原先只判三码溢出，而 `measure-sweep` 判
   (三码 ∪ `content_overlap`) ⇒ **"内容上限"用了比闸门更严的判据** ⇒ 会出现"deck 过闸门、却违反写进 schema 的上限"。
   ⇒ 现在并列；`gate-release` **恒带**此旗（发版口径 = sweep 口径，一字一致）。 */
const assertOverlap = args.includes('--assert-overlap')

/** 溢出类判据（team-lead 定）：`text_box_overflow` 被容器裁 / `container_overflow` 溢出裁切容器 / `canvas_overflow` 出画布 */
const OVERFLOW_CODES = ['text_box_overflow', 'container_overflow', 'canvas_overflow']
/** ★ 重叠码：**与三码并列**进"内容上限"判据（集合与 `measure-sweep.mjs` 的 `JUDGE` 完全一致） */
const OVERLAP_CODES = ['content_overlap']
/** 允许清单：**故意裁切**的元素必须逐条列出 selector + 理由（绝不许静默忽略） */
const ALLOWLIST_FILE = join(HERE, 'allowlist-overflow.json')
/** ★ 重叠的**同构白名单**：只收"设计性重叠"，每条必须写 `selector` + `reason` + `_evidence.nonDesign`
 *  （"**非设计性证据**"：为什么它不是把内容上限撑破的那种重叠）—— 没有证据不许登记。 */
const ALLOWLIST_OVERLAP_FILE = join(HERE, 'allowlist-overlap.json')

const HARD_CODES = ['missing_timeline_registry', 'multiple_root_compositions']
const strip = (s) => String(s || '').replace(/\u001b\[[0-9;]*m/g, '')

if (!existsSync(join(dir, 'index.html'))) {
  console.error(`✗ ${dir} 里没有 index.html（引擎 CLI 的默认入口；产物目录只许这一个 composition 文件）`)
  process.exit(2)
}

// 默认**跑** contrast（否则看不见那几条 `contrast_aa_failure`）；只有 --no-contrast 才跳过。
// 注意：`--no-contrast` 时引擎返回 `contrast.findings=0` —— 别把"没跑"误读成"没问题"。
const checkArgs = ['check', dir, '--json']
if (args.includes('--no-contrast')) checkArgs.push('--no-contrast')
const deckKey = String(dir).split(/[\\/]/).filter(Boolean).slice(-1)[0]
/** 引擎 CLI **偶发** JSON 不可解析（实测 17 档里 1 次）⇒ 处置五道约束：
    ① 只重试 1 次 ② 打印"已重试"（不静默）③ 原始输出留证落盘并打印路径 ④ 计数进报告
    ⑤ 连续两次运行同一档都瞬时失败 ⇒ 红（状态存 .gate-transient-state.json） */
const runCheck = () => {
  const rr = spawnSync(HF, checkArgs, { encoding: 'utf8', shell: true })
  const oo = strip(rr.stdout) + strip(rr.stderr)
  // ★ stderr 会**追加**在 JSON 之后（如 node 的 DeprecationWarning）⇒ 必须夹在**第一个 { 与最后一个 }** 之间解析
  const ii = oo.indexOf('{'), kk = oo.lastIndexOf('}')
  let jj = null
  try { jj = JSON.parse(oo.slice(ii, kk + 1)) } catch { jj = null }
  return { jj, oo }
}
let transientCount = 0
let { jj: j, oo: out } = runCheck()
if (!j || !j.lint) {
  transientCount = 1
  const body = `deck=${deckKey}\ndir=${dir}\nat=${new Date().toISOString()}\n---- 不可解析原始输出（前 4000 字）----\n` + out.slice(0, 4000)
  // ★ 运行态文件必须写在**仓库之外**（team-lead 裁定，两次修正的最终形态）：
  //   ① 写引擎根目录 ⇒ 白名单断言"随运行而红"（不稳定判据，实测踩过）
  //   ② 写 `evidence/` ⇒ 入库后该目录**不存在**（§2 已排除）⇒ 闸门新建目录 + 写文件 ⇒ **git status 变脏**
  //   ⇒ 统一写到**系统临时目录**（`os.tmpdir()` 的等价物：不碰仓库、不需要预建目录、不入库）
  const EV_DIR = join(process.env.TEMP || process.env.TMP || '/tmp', 'html-deck-gate')
  let evFile = join(EV_DIR, `${deckKey}-${Date.now()}.txt`)
  try { writeFileSync(evFile, body, 'utf8') } catch {
    evFile = join(EV_DIR, `fallback-${deckKey}-${Date.now()}.txt`)   // 兜底同样**不碰仓库**
    try { writeFileSync(evFile, body, 'utf8') } catch { evFile = '(落盘失败)' }
  }
  console.error(`  ⚠ 首次调用 JSON 不可解析，已重试（原始输出前 400 字已留证：${evFile}）`)
  console.error(`     ${out.slice(0, 400).replace(/\s+/g, ' ')}`)
  const r2 = runCheck()
  j = r2.jj
  out = r2.oo
}
// ★ 运行态状态文件**也不落仓库**（与上面 EV_DIR 同一处口径；写系统临时目录）
const STATE_FILE = join(process.env.TEMP || process.env.TMP || '/tmp', 'html-deck-gate', 'gate-transient-state.json')
let gstate = {}
try { gstate = JSON.parse(readFileSync(STATE_FILE, 'utf8')) } catch { gstate = {} }
if (transientCount) {
  if (gstate[deckKey]) {
    console.error(`✗ ${deckKey} **连续两次运行**都出现瞬时解析失败 ⇒ 红（引擎/环境可能真有问题，不是偶发）`)
    process.exit(1)
  }
  gstate[deckKey] = true
} else if (gstate[deckKey]) delete gstate[deckKey]
try { writeFileSync(STATE_FILE, JSON.stringify(gstate, null, 2), 'utf8') } catch { /* ignore */ }
if (!j || !j.lint) {
  console.error('✗ 重试后仍无法解析 check 的 JSON 输出：\n' + out.slice(0, 800))
  process.exit(2)
}
console.log(`  瞬时解析失败计数（本次运行）= ${transientCount}`)

/* ---------- ★ 稳定帧契约的**唯一实现**（时序只此一处；溢出与对比度两个消费者都调它） ---------- */
const ENTER_TAIL_S = 0.6 // 入场动画名义收尾（渲染器 data-anim 时长档）
/** 从产物 HTML 解析每页时序：start / duration / 该页内最大 data-at（自带读文件，避免 TDZ） */
function timingTable(dirPath) {
  const f = join(dirPath, 'index.html')
  const html = existsSync(f) ? readFileSync(f, 'utf8') : ''
  const t = []
  html.split(/<section\b/).slice(1).forEach((s, idx) => {
    const head = s.slice(0, s.indexOf('>') + 1)
    const start = Number((head.match(/data-start="([\d.]+)"/) || [])[1] || 0)
    const dur = Number((head.match(/data-duration="([\d.]+)"/) || [])[1] || 0)
    const ats = [...s.matchAll(/data-at="([\d.]+)"/g)].map((m2) => Number(m2[1]))
    t.push({ i: idx + 1, start, dur, maxAt: ats.length ? Math.max(...ats) : 0 })
  })
  return t
}
/** 稳定帧时刻（**契约公式**）：min( max(入场收尾, 页长×60%), 下一页淡入前 − 0.15s ) + 违约信息 */
function settledAtForImpl(dirPath, no, table) {
  const t = table || timingTable(dirPath)
  const p = t[no - 1]
  if (!p) return null
  const next = t[no] || null
  const want = Math.max(p.start + p.maxAt + ENTER_TAIL_S, p.start + p.dur * 0.6)
  const cap = next ? next.start - 0.15 : p.start + p.dur - 0.1
  const at = Math.min(want, cap)
  const violation = !(at > p.start + 1e-6 && at < p.start + p.dur - 1e-6)
    ? `settledAt=${at.toFixed(3)}s 不在本页 [${p.start}, ${(p.start + p.dur).toFixed(2)}) 内`
    : (next && at > next.start - 0.15 + 1e-6) ? `settledAt=${at.toFixed(3)}s 距下一页淡入(${next.start}s) < 0.15s` : null
  return { p, next, at, violation }
}
/** 采样时刻是否落在**过渡帧**内（程序化；唯一实现） */
function transitionAt(dirPath, time, table) {
  const t = table || timingTable(dirPath)
  const tt = Number(time)
  const p = t.find((q) => tt >= q.start - 1e-6 && tt < q.start + q.dur + 1e-6) || null
  if (!p) return null
  const next = t[t.indexOf(p) + 1] || null
  const enterEnd = p.start + p.maxAt + ENTER_TAIL_S
  if (tt < enterEnd) return { p, next, how: `本页入场：t < start(${p.start}) + max(data-at)(${p.maxAt}) + ${ENTER_TAIL_S} = ${enterEnd.toFixed(2)}` }
  if (next && tt >= next.start - 1e-6) return { p, next, how: `页尾交叉淡入：下一页 data-start=${next.start}s 起淡入，而 t=${time} ≥ ${next.start}` }
  return null
}

/* ---------- ★ 引擎**按稳定帧时刻**再跑一次 layout（`check --at`）：溢出判据以此为准；
   引擎原采样时刻的 findings 只当**线索**打印。附带的耗时一并记录（进报告）。 ---------- */
const TABLE = timingTable(dir)
const SETTLED = TABLE.map((q, idx) => settledAtForImpl(dir, idx + 1, TABLE)).filter(Boolean)
const atList = SETTLED.map((s2) => s2.at.toFixed(3)).join(',')
const _t0 = Date.now()
let j2 = null
if (atList) {
  for (const flag of [['--at', atList], [`--at=${atList}`]]) {
    const r2 = spawnSync(HF, ['check', dir, '--json', ...flag], { encoding: 'utf8', shell: true })
    const o2 = strip(r2.stdout) + strip(r2.stderr)
    const i2 = o2.indexOf('{'), k2 = o2.lastIndexOf('}')
    try { const p2 = JSON.parse(o2.slice(i2, k2 + 1)); if (p2 && p2.layout) { j2 = p2; break } } catch { /* 换下一种写法 */ }
  }
}
const settleMs = Date.now() - _t0
const settledFindings = (j2 && j2.layout && j2.layout.findings) || []
console.log(`  [稳定帧附加运行] check --at ${atList}（${SETTLED.length} 个时刻）· ${j2 ? `取回 ${settledFindings.length} 条 layout findings` : '**失败 ⇒ 溢出判据不成立，判红**'} · 额外耗时 **${settleMs}ms**`)

const findings = j.lint.findings || []
const byCode = {}
for (const f of findings) {
  const c = f.code || f.rule || '(unknown)'
  byCode[c] = (byCode[c] || 0) + 1
}

console.log(`=== 引擎 lint 硬闸门 · ${dir} ===`)
console.log(`  lint: ok=${j.lint.ok} · error=${j.lint.errorCount} · warning=${j.lint.warningCount} · info=${j.lint.infoCount}`)
console.log('  各 code 计数: ' + (Object.keys(byCode).length ? Object.entries(byCode).map(([k, v]) => `${k}×${v}`).join(' · ') : '(无)'))

let bad = 0
if (j.lint.errorCount !== 0) { bad++; console.error(`  ✗ lint.errorCount=${j.lint.errorCount} ≠ 0（硬闸门）`) }
else console.log('  ✓ lint.errorCount = 0')

for (const c of HARD_CODES) {
  const hit = findings.filter((f) => (f.code || f.rule) === c)
  if (hit.length) {
    bad++
    console.error(`  ✗ 出现禁用 code ${c}×${hit.length}`)
    for (const h of hit.slice(0, 3)) console.error(`      · ${String(h.message || '').slice(0, 160)}`)
  } else console.log(`  ✓ 未出现 ${c}`)
}

if (verbose) {
  const extra = findings.filter((f) => !HARD_CODES.includes(f.code || f.rule))
  if (extra.length) {
    console.log('  记录（不拦）:')
    for (const f of extra) console.log(`    · [${f.severity || '?'}] ${f.code} :: ${String(f.message || '').slice(0, 160)}`)
  }
}
for (const seg of ['layout', 'motion', 'contrast']) {
  const s = j[seg]
  if (!s) continue
  const n = (s.errorCount || 0) + (s.warningCount || 0) + (s.infoCount || 0)
  console.log(`  ${seg}: ok=${s.ok} · 发现 ${n}（**只记录，先人看再定**）`)
}

/* ---------- 溢出判据：引擎三码 − 允许清单 = 0（内容上限的判据口径） ---------- */
const allow = existsSync(ALLOWLIST_FILE) ? (JSON.parse(readFileSync(ALLOWLIST_FILE, 'utf8')).allow || []) : []
const isAllowed = (f) => allow.some((a) =>
  (!a.code || a.code === (f.code || f.rule)) &&
  (!a.selector || String(f.selector || '').includes(a.selector)))

const lay = j.layout || {}
/** 引擎**原采样时刻**的溢出 findings —— 只当**线索**（采样点与页边界结构性不对齐） */
const lf = (lay.findings || []).filter((f) => OVERFLOW_CODES.includes(f.code || f.rule))
/** ★ 判定用**稳定帧**上的几何（引擎 `check --at` 取回） */
const lfSettled = settledFindings.filter((f) => OVERFLOW_CODES.includes(f.code || f.rule))
const overflowAll = lfSettled
const overflowBad = lfSettled.filter((f) => !isAllowed(f))
if (!j2) overflowBad.push({ code: '(稳定帧附加运行失败)', selector: '-', time: '-', message: '引擎 check --at 未返回稳定帧 layout ⇒ 溢出判据不成立（不许用原采样时刻的结论顶替）', rect: null })

/* ---------- ★ 重叠判据（`content_overlap`）—— 与三码**并列**（team-lead ③）----------
   口径 = **稳定帧上的 (三码 ∪ content_overlap) − (溢出白名单 ∪ 重叠白名单) = 0**，与 `measure-sweep` 一字一致。
   为什么必须并列：**内容上限**若用比闸门更严的判据量，就会出现"过闸门但违反上限"⇒ 上限变成一纸声明。 */
const overlapAllow = existsSync(ALLOWLIST_OVERLAP_FILE) ? (JSON.parse(readFileSync(ALLOWLIST_OVERLAP_FILE, 'utf8')).allow || []) : []
const isOverlapAllowed = (f) => overlapAllow.some((a) => (!a.selector || String(f.selector || '').includes(a.selector)))
const overlapAll = settledFindings.filter((f) => OVERLAP_CODES.includes(f.code || f.rule))
const overlapBad = overlapAll.filter((f) => !isOverlapAllowed(f))
if (!j2) overlapBad.push({ code: '(稳定帧附加运行失败)', selector: '-', time: '-', message: '引擎 check --at 未返回稳定帧 layout ⇒ 重叠判据同样不成立', rect: null })
if (assertOverlap) {
  console.log(`\n  重叠判据（${OVERLAP_CODES.join(' / ')}）[--assert-overlap]：共 ${overlapAll.length} 条（白名单命中 ${overlapAll.length - overlapBad.length} 条，另 ${j2 ? 0 : 1} 条环境失败）`)
  if (overlapBad.length) {
    bad++
    console.error(`  ✗ 不在白名单内的重叠 ${overlapBad.length} 条 ⇒ **与 sweep 同一口径**（设计性重叠请进 allowlist-overlap.json，必须写"非设计性证据"）：`)
    for (const f of overlapBad.slice(0, 10)) {
      console.error(`      · [${f.code}] sel=${f.selector} t=${f.time} rect=${JSON.stringify(f.rect || f.bbox || null)} container=${String(f.containerSelector || '-')}`)
      console.error(`        fixHint=${String(f.fixHint || f.message || '').slice(0, 150)}`)
    }
  } else console.log('    ✓ 白名单外重叠 = 0')
}

if (dump) {
  console.log('\n  --- --dump：layout 全部 findings（按 code+selector 归并）---')
  const g = {}
  for (const f of (lay.findings || [])) {
    const c = f.code || f.rule || '?'
    g[c] = g[c] || {}
    const s = f.selector || '-'
    g[c][s] = (g[c][s] || 0) + 1
  }
  for (const [c, sels] of Object.entries(g)) {
    console.log(`    ${c} ×${Object.values(sels).reduce((a, b) => a + b, 0)}`)
    for (const [s, n] of Object.entries(sels)) {
      const one = (lay.findings || []).find((f) => (f.code || f.rule) === c && (f.selector || '-') === s)
      console.log(`      · ${s} ×${n}  例: ${JSON.stringify(one && (one.rect || one.bbox || one.box || null))}  t=${one && one.time}`)
    }
  }
  const cf = (j.contrast && j.contrast.findings) || []
  if (cf.length) {
    console.log(`\n  --- contrast findings ×${cf.length} ---`)
    for (const f of cf) console.log(`    · ${f.code || f.rule} sel=${f.selector || '-'} ratio=${f.ratio || f.contrast || '?'} t=${f.time}  ${String(f.message || '').slice(0, 110)}`)
  }
}

console.log(`\n  溢出判据（${OVERFLOW_CODES.join(' / ')}）：共 ${overflowAll.length} 条（允许清单命中 ${overflowAll.length - overflowBad.length} 条）`)
if (overflowBad.length) {
  bad++
  console.error(`  ✗ 不在允许清单内的溢出 ${overflowBad.length} 条 ⇒ 违反内容上限口径（与对比度**同一口径**：以**稳定帧**为准）：`)
  for (const f of overflowBad.slice(0, 10)) {
    // 过渡帧判定：本块位置在时序块**之前**，直接调 transitionOf 会踩 TDZ ⇒ 用 hoisted 的 pageTimes() 就地自算
    // （口径与下方 transitionOf 完全一致；后续可把时序块上移做"一处维护"）
    const _pgs = pageTimes()
    const _p = _pgs.find((q) => Number(f.time) >= q.start - 1e-6 && Number(f.time) < q.start + q.dur + 1e-6) || null
    const _nx = _p ? (_pgs[_pgs.indexOf(_p) + 1] || null) : null
    const tr = _p
      ? (Number(f.time) < _p.start + _p.maxAt + 0.6
        ? { how: `本页入场：t < start(${_p.start}) + max(data-at)(${_p.maxAt}) + 0.6 = ${(_p.start + _p.maxAt + 0.6).toFixed(2)}` }
        : (_nx && Number(f.time) >= _nx.start - 1e-6 ? { how: `页尾交叉淡入：下一页 data-start=${_nx.start}s 起淡入` } : null))
      : null
    console.error(`      · [${f.code}] sel=${f.selector} t=${f.time} rect=${JSON.stringify(f.rect || f.bbox || null)} ${String(f.message || '').slice(0, 90)}`)
    // 过渡帧里的几何 finding 不能直接下结论：必须在"入场结束、下一页淡入前"那一帧上复测几何。
    // 像素无法反推容器几何 ⇒ 本闸门**明确判红**并把缺口写出来（不许静默放过，也不许假装测过）。
    if (tr) {
      bad++
      console.error(`        ✗ 采样落在**过渡帧**（${tr.how}）⇒ 几何须在稳定帧上复测；本闸门无法从像素反推容器几何 ⇒ 判红（需引擎支持"按时刻跑 layout"或 DOM 求值）`)
    }
  }
} else {
  console.log('  ✓ 不在允许清单内的溢出 = 0')
}

/* ---------- 对比度判据：与溢出判据**同构**（引擎 findings − 对比度白名单 = 0）
   口径：信息性小字必须 ≥4.5:1（大字档 ≥3:1），**一律不许进白名单**；白名单只收**纯装饰**，
   且每条必须① 给出不承载信息的证据（文本摘录）② 提供 aria-hidden 在**产物 HTML 里可 grep** 的证据。 ---------- */
const CONTRAST_ALLOWLIST_FILE = join(HERE, 'allowlist-contrast.json')
const callow = existsSync(CONTRAST_ALLOWLIST_FILE) ? (JSON.parse(readFileSync(CONTRAST_ALLOWLIST_FILE, 'utf8')).allow || []) : []
const DIR = (() => {
  const a = process.argv.slice(2).find((x) => !x.startsWith('--'))
  return a ? resolve(a) : null
})()
const HTML = DIR && existsSync(join(DIR, 'index.html')) ? readFileSync(join(DIR, 'index.html'), 'utf8') : ''
/** 定位同名标签的匹配 `</tag>`（按同名标签配对计数） */
function findClose(html, startIdx, tag) {
  const re = new RegExp('<' + tag + '\\b|</' + tag + '>', 'g')
  re.lastIndex = startIdx
  let depth = 0
  let m
  while ((m = re.exec(html))) {
    depth += m[0][1] === '/' ? -1 : 1
    if (depth === 0) return m.index + m[0].length
  }
  return html.length
}
/** 取 `html` 内**深度 0**（即当前节点的直接子元素）的 `<tag>` 切片 —— 这是上一版点名的根因：
    上一版对"无 nth 的部分"把**所有嵌套**的 div 都收了进来，导致后面的 section:nth-of-type(6) 在错误的
    节点集里找，最后点到 class="" 的元素 ⇒ **打印空值 = 没点名**。 */
function directChildren(html, tag) {
  const out = []
  const re = new RegExp('<' + tag + '\\b', 'g')
  let m
  while ((m = re.exec(html))) {
    const head = html.slice(0, m.index)
    let depth = 0
    const re2 = new RegExp('<' + tag + '\\b|</' + tag + '>', 'g')
    let m2
    while ((m2 = re2.exec(head))) depth += m2[0][1] === '/' ? -1 : 1
    if (depth !== 0) continue
    const end = findClose(html, m.index, tag)
    out.push(html.slice(m.index, end))
    re.lastIndex = end
  }
  return out
}
/** 该 class 在本产物 CSS 里的**最后一条匹配规则**的声明（= 级联上最可能生效的声明值） */
function declared(cls) {
  if (!cls || !DIR) return ''
  const f = join(DIR, 'assets', 'master.css')
  const css = existsSync(f) ? readFileSync(f, 'utf8') : ''
  if (!css) return ''
  let out = ''
  for (const k of cls.split(/\s+/).filter(Boolean)) {
    const re = new RegExp('\\.' + k.replace(/[-_]/g, '\\$&') + '[^{}]*\\{[^}]*\\}', 'g')
    const ms = css.match(re)
    if (ms && ms.length) out += (out ? '  |  ' : '') + '.' + k + ' → ' + ms[ms.length - 1].replace(/\s+/g, ' ').slice(0, 170)
  }
  return out
}
/** 逐元素点名：结构化选择器 → `tagName + class + 文本摘录 + outerHTML 前 120 字 + CSS 声明值`。
    ★ 纪律：**解析不出来时绝不打印空值充当"已点名"** —— 必须回落到 tagName + outerHTML 片段让人能判定。 */
function describeSelector(sel) {
  const raw = String(sel || '')
  const lastTag = (raw.split('>').pop() || '').trim().match(/^[a-z0-9]+/i)
  const empty = { tag: lastTag ? lastTag[0] : '', cls: '', text: '', outer: '' }
  if (!HTML || !raw) return empty
  let nodes = [HTML]
  for (const part of raw.split('>').map((s) => s.trim()).filter(Boolean)) {
    const tag = (part.match(/^[a-z0-9]+/i) || [''])[0]
    if (!tag) continue
    const nth = Number((part.match(/nth-of-type\((\d+)\)/) || [])[1] || 0)
    const kids = nodes.flatMap((h) => directChildren(h, tag))
    nodes = nth ? (kids[nth - 1] ? [kids[nth - 1]] : []) : (kids.length ? [kids[0]] : [])
  }
  const node = nodes[0] || ''
  if (!node) return empty
  const cls = (node.match(/class="([^"]*)"/) || [])[1] || ''
  const text = node.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)
  const outer = node.replace(/\s+/g, ' ').trim().slice(0, 120)
  return { tag: lastTag ? lastTag[0] : '', cls, text, outer }
}
/** ★ 时序/过渡判定的**唯一实现**在文件上方（`timingTable` / `transitionAt` / `settledAtForImpl`）。
    这里只留薄封装 —— **溢出块与对比度块走同一实现**，逻辑漂移在结构上不可能发生。 */
const PAGES = TABLE
const ENTER_TAIL = ENTER_TAIL_S
const pageOf = (t) => PAGES.find((p) => t >= p.start - 1e-6 && t < p.start + p.dur + 1e-6)
const transitionOf = (t) => transitionAt(dir, t, PAGES)
// 断言：封装结果必须与唯一实现一致（若将来只改一处时序规则 ⇒ 这里立刻红）
if (JSON.stringify(PAGES) !== JSON.stringify(timingTable(dir))) { bad++; console.error('  ✗ 时序两份结果不一致（漂移）⇒ 红') }
console.log(`  时序唯一实现自检：${PAGES.length} 页 · settledAt 列表 [${atList}]（与 --at 附加运行**同一公式**）`)
/** 帧指纹（FNV-1a）：记录"这张证据帧是闸门当场抽的"，不依赖产物目录里可能过期的 frames/ */
function fp(buf) { let h = 0x811c9dc5; for (let i = 0; i < buf.length; i++) { h ^= buf[i]; h = (h * 0x01000193) >>> 0 } return h.toString(16).padStart(8, '0') }
/** 闸门**自己**从 mp4 抽的稳定帧（系统临时目录 + 记录源 mp4/时刻/指纹）—— **不信任**产物里的 frames/*.png */
const FRAME = {}
function settledFrame(no) {
  if (FRAME[no] !== undefined) return FRAME[no]
  let res = null
  const p = PAGES[no - 1]
  if (DIR && p) {
    const base = String(DIR).split(/[\\/]/).filter(Boolean).pop()
    const cand = [join(DIR, `output-${base}.mp4`)]
    try { for (const n of readdirSync(DIR)) if (/^output-.*\.mp4$/.test(n)) cand.push(join(DIR, n)) } catch { /* 没导入 readdirSync 就只用显式名 */ }
    const mp4 = cand.find((x) => existsSync(x))
    if (mp4) {
      // ★ "稳定帧"的时刻必须**程序化**取，且要满足：本页所有入场动画已完成，同时**早于下一页开始淡入**。
      //   取 mid-page 会踩坑：晚入场的元素（data-at 大的那条）此刻可能还没出现（实测 t=16.5 时该行区域是空白的 ⇒ 1.01:1）。
      // ★ 用**唯一实现**（文件上方的 settledAtForImpl），不再就地复制公式 —— 一份逻辑、一处维护
      const s2 = settledAtForImpl(DIR, no, PAGES)
      const listed = SETTLED[no - 1] ? SETTLED[no - 1].at.toFixed(3) : null
      const at = s2.at
      const violation = s2.violation || (listed && listed !== at.toFixed(3) ? `抽帧时刻 ${at.toFixed(3)}s ≠ --at 列表里的 ${listed}s（两处漂移）` : null)
      const out = join(process.env.TEMP || process.env.TMP || '.', `cgl-settled-${process.pid}-p${no}.png`)
      const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-ss', at.toFixed(3), '-i', mp4, '-frames:v', '1', out])
      if (r.status === 0 && existsSync(out)) res = { png: out, at: at.toFixed(3), fp: fp(readFileSync(out)), mp4, violation }
    }
  }
  FRAME[no] = res
  return res
}
/** 按 finding 的 **rect（元素自身）** 在帧上实测对比（3%/97% 分位亮度）。
    ★ rect 缺失/过小/越界 ⇒ 返回 null ⇒ **判红**：不许拿邻近区域顶替（那会把"元素移位/消失"放过去）。 */
function rectContrast(png, rect) {
  if (!rect || !existsSync(png)) return null
  const x = Math.round(rect.left ?? rect.x ?? 0)
  const y = Math.round(rect.top ?? rect.y ?? 0)
  const w = Math.round(rect.width ?? rect.w ?? 0)
  const h = Math.round(rect.height ?? rect.h ?? 0)
  if (w < 6 || h < 6 || x < 0 || y < 0) return null
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', png, '-vf', `crop=${w}:${h}:${x}:${y}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 26 })
  const b = r && r.status === 0 ? r.stdout : null
  if (!b || b.length < 3 * 6 * 6) return null
  const N = Math.floor(b.length / 3)
  const L = []
  for (let i = 0; i < N; i++) L.push(0.2126 * b[i * 3] + 0.7152 * b[i * 3 + 1] + 0.0722 * b[i * 3 + 2])
  L.sort((a, c) => a - c)
  const lo = L[Math.floor(N * 0.03)]
  const hi = L[Math.floor(N * 0.97)]
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) }
  return (Math.max(f(lo), f(hi)) + 0.05) / (Math.min(f(lo), f(hi)) + 0.05)
}

if (assertContrast) {
  const cf = (j.contrast && j.contrast.findings) || []
  const deco = callow.filter((a) => (a.kind || 'decorative') === 'decorative')
  const samp = callow.filter((a) => a.kind === 'sampling-artifact')
  const hitIn = (f, list) => {
    const d = describeSelector(f.selector)
    const clsHit = d.cls.split(/\s+/).filter(Boolean)
    return list.find((a) =>
      (!a.code || a.code === (f.code || f.rule)) &&
      ((!a.selector || String(f.selector || '').includes(a.selector)) ||
        (a.className && clsHit.includes(a.className))))
  }
  const rows = cf.map((f) => {
    const a = hitIn(f, deco)
    if (a) return { f, kind: 'decorative', a }
    const tr = transitionOf(Number(f.time))
    if (tr) return { f, kind: 'enter', p: tr.p, how: tr.how }
    return { f, kind: 'plain' }

  })
  const nDeco = rows.filter((r) => r.kind === 'decorative').length
  const nEnter = rows.filter((r) => r.kind === 'enter').length
  console.log(`  对比度判据：共 ${cf.length} 条（装饰豁免 ${nDeco} · **过渡帧→稳定帧复测** ${nEnter} · 待修 ${rows.length - nDeco - nEnter}）`)
  console.log(`    采样假阳性以"系统性修法"处理（判据建立在闸门自产的稳定帧 + 元素自身 rect 上）⇒ sampling-artifact 白名单条目 = ${samp.length}（硬规矩：≥2 条必须系统性修法；本实现已系统性，故应为 0）`)
  for (const r of rows) {
    if (r.kind === 'decorative') {
      const a = r.a
      const tag = `[${a.className || a.selector}]`
      if (!a.ariaHiddenGrep) { bad++; console.error(`    ✗ ${tag} 装饰豁免缺 ariaHiddenGrep 证据（不许静默豁免）`) }
      else if (a.className && !HTML.includes(a.className)) { /* 该产物无此元素 ⇒ 不适用 */ }
      else if (HTML.includes(a.ariaHiddenGrep)) console.log(`    ✓ ${tag} 装饰性豁免证据（产物 HTML 可 grep）：${a.ariaHiddenGrep}`)
      else { bad++; console.error(`    ✗ ${tag} aria-hidden 证据在产物 HTML 里**找不到**（不许静默豁免）：${a.ariaHiddenGrep}`) }
      continue
    }
    // ★ 并列双测（**每条**非装饰 finding 都量）：引擎采样时刻比值 ＋ 该元素在**稳定帧**上的 rect 实测比值；
    //   **判定以稳定帧为准**。理由：引擎采样点与页边界结构性不对齐（引擎特性），逐条特判必然导致白名单膨胀。
    const d = describeSelector(r.f.selector)
    const rect = r.f.rect || r.f.bbox || null
    const tr = r.kind === 'enter' ? { how: r.how, p: r.p } : null
    const p = tr ? tr.p : pageOf(Number(r.f.time))
    if (!p) { bad++; console.error(`    ✗ 时序算不出来（无法定位页）⇒ 红：过渡帧证明必须**程序化**，t=${r.f.time} sel=${r.f.selector}`); continue }
    const nextP = PAGES[PAGES.indexOf(p) + 1] || null
    const enginePass = Number(r.f.ratio || 0) >= Number(r.f.requiredRatio || 4.5)
    const fr = settledFrame(p.i)
    const v = fr ? rectContrast(fr.png, rect) : null
    console.log(`    · [并列双测] 引擎 t=${r.f.time}s ratio=${r.f.ratio ?? '?'}（${enginePass ? '达标' : '不达标'}）· 稳定帧 rect 实测 ${v === null ? '**量不到**' : `${v.toFixed(2)}:1`}`)
    console.log(`      过渡帧判据：${tr ? tr.how : '**不在过渡窗口**'}（第 ${p.i} 页 · 本页入场收尾 ${(p.start + p.maxAt + ENTER_TAIL).toFixed(2)}s · 下一页淡入 ${nextP ? `${nextP.start}s` : '-'}）`)
    console.log(`      点名: tag=${d.tag} class="${d.cls}" 文本「${d.text}」· rect=${JSON.stringify(rect)} · 引擎 fg=${r.f.fg} bg=${r.f.bg}`)
    console.log(`      证据帧（**闸门当场抽**，非产物历史帧）：${fr ? `${fr.mp4} @ t=${fr.at}s · 指纹 ${fr.fp}` : '**抽帧失败**'}`)
    if (fr && fr.violation) { bad++; console.error(`      ✗ 稳定帧取法违约：${fr.violation} ⇒ 红（不许静默回退到别的时刻）`); continue }
    if (v === null) {
      if (deployNoPixel) {
        deploySkipped++
        // ★ 决策 B-2：部署档的"跳过像素复测"**必须 = 0，否则判红** —— 降级必须显式且有界，不许长期靠跳过顶包
        bad++
        console.error(`      ✗ 部署模式出现"跳过像素复测"（累计 ${deploySkipped}）⇒ **判红**：降级口径必须为 0；真出现请上报 team-lead（依据 = 程序化过渡帧证明，但完整像素口径只有本机全矩阵）`)
        continue
      }
      bad++
      console.error(`      ✗ 量不到该元素（rect 缺失/越界）⇒ 不许用邻近区域替代 ⇒ 红`)
      if (!d.cls || !d.text) console.error(`        ⚠ 点名不完整（**不得当作已点名**）→ outerHTML = ${d.outer || '(定位失败)'}`)
      continue
    }
    if (v >= 4.5 && tr) console.log(`      ✓ 判定（以稳定帧为准）：稳定帧 ${v.toFixed(2)}:1 ≥ 4.5 且引擎采样落在**过渡帧**（页尾交叉淡入 / 入场）⇒ 非缺陷`)
    else if (v >= 4.5 && !tr) { bad++; console.error(`      ✗ 稳定帧达标，但引擎采样**不在过渡窗口** ⇒ 不许用推广掩盖真问题 ⇒ 红（需查明引擎为何在非过渡时刻读到 ${r.f.ratio}）`) }
    else { bad++; console.error(`      ✗ 稳定帧实测 ${v.toFixed(2)}:1 < 4.5 ⇒ 红，必须真修 CSS · CSS 声明: ${declared(d.cls) || '(需人工定位)'}`) }
  }
  if (!rows.some((r) => r.kind === 'plain')) console.log('  ✓ 待修 contrast findings = 0')
  if (deployNoPixel) console.log(`  部署模式：跳过像素复测 = ${deploySkipped} 条（无 mp4；本机全矩阵为完整口径）`)
}

console.log(`\n结论: ${bad === 0 ? 'PASS（引擎 lint 硬闸门 + 溢出判据通过）' : `FAIL（${bad} 项）`}`)
/** ★ 机器可读 RESULT 行（决策 B-1）：让部署脚本/以后的人一眼判断"这次是全口径还是**降级口径**"；
    `pixel_skipped` 在部署档**必须为 0**（B-2，否则上面已判红）。 */
console.log(`GATE-RESULT ${JSON.stringify({
  ok: bad === 0,
  deploy_no_pixel: deployNoPixel,
  pixel_skipped: deploySkipped,
  contrast_findings: ((j.contrast && j.contrast.findings) || []).length,
  overflow_all: overflowAll.length,
  overflow_bad: overflowBad.length,
  transient_json_failures: transientCount,
})}`)
process.exit(bad ? 1 : 0)
