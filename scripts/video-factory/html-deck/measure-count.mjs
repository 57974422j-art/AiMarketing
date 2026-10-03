#!/usr/bin/env node
/* ============================================================================
 * measure-count.mjs —— **条数类构造器**（数组长度 N 的判据扫描）
 *
 * 为什么需要它：现有 `measure-sweep` 扫的是"往元素文本注入 k 字"（字符长度），
 *   **条数**（`items`/`steps`/`toc`/`series`… 的**数组长度**）此前**完全没有判据** ⇒ 自证 (a') 段的唯一空白。
 *
 * 做法（**复用成熟管线**，不另造轮子）：每个 N ⇒
 *   ① 造变体 deck（把目标数组**循环补足/截断到 N 条**，写 `examples/__tmp_count-kN.json`（已被 .gitignore 覆盖））
 *   ② 调 `crosscheck-deck-json.mjs --ks 0`（**零注入探针**：渲染 + 引擎闸门 + 判据码提取，全在它里面）
 *   ③ 读回**条数**（`dom-target.mjs <outdir> <sel>`）⇒ 必须 == N，否则**红**（防止"注入没生效"被当读数）
 *
 * ★ team-lead 五条口径（逐条实现）：
 *   (a) **读回必须是条数**：`count == N` 否则红（count 版的"读回 == k"）
 *   (b) **N_MAX = max(现上限, 下限) + 3（硬顶 20）**；目标不是"扫到底"而是证 `cap` **有余量**；
 *       **无触发 ⇒ 记 `judgeLimitAtLeast: N_MAX`（绝不是 null！）** —— null 会被 I3 归成"未测/量具缺陷"⇒ 又变债务
 *   (c) ★ **候选码必须 ⊆ JUDGE 集合**：出现"不在判据集合的码"⇒ **红 + 点名该码**（否则把"非判据类失败"误记成"容量够宽"）
 *   (d) **正控**：另跑一个"必定触发"的页型（如 steps 扫到 N=30）⇒ 必须触发（证明整条管线会咬）
 *   (e) 一次只铺一个页型；跑通再铺其余
 *
 * 用法：
 *   node measure-count.mjs --deck master-v1 --page 2 --jsonpath pages.1.items --cls "li:first-child .t" [--sel li] [--min 3] [--max 5] [--keep]
 * ========================================================================== */
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const argv = process.argv
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d }
const DECK = arg('--deck', 'master-v1')
const PAGE = Number(arg('--page', '2'))
const JSONPATH = arg('--jsonpath', 'pages.1.items')
const CLS = arg('--cls', 'li:first-child .t')
const SEL = arg('--sel', 'li')
const MIN = Number(arg('--min', '3'))
const MAX = Number(arg('--max', '5'))
const KEEP = argv.includes('--keep')
/* ★ (b) **修正版**（team-lead 2026-10-04：原式 `max(cap,min)+3` 太松 ⇒ cap=5 只扫到 8 ⇒ 断言 `cap ≤ 8` 近乎同义反复）：
   `N_MAX = min(20, max(cap+3, 2×cap))` ⇒ cap5→10 · cap6→12 · cap4→8 · cap12→20 · cap2→6（更强且仍便宜）。 */
const STRIDE = Math.max(1, Number(arg('--stride', '1')))   /* ★ 大 N_MAX 时用**步长**（否则扫到 30 = 28 次渲染） */
const NM = arg('--nmax', '')
const N_MAX = NM ? Number(NM) : Math.min(20, Math.max(MAX + 3, 2 * MAX))
if (NM) console.log(`  ℹ --nmax=${NM}（**显式放宽**：理由必须写进 commit/报告，否则不许放宽）`)
const JUDGE = ['text_box_overlap', 'text_box_overflow', 'container_overflow', 'canvas_overflow', 'content_overlap', 'decor_content_collision'].filter((c) => c !== 'text_box_overlap')

const SRC = join(HERE, 'examples', `deck.${DECK}.json`)
if (!existsSync(SRC)) { console.error(`✗ 找不到底档 ${SRC} ⇒ exit 2`); process.exit(2) }
const base = JSON.parse(readFileSync(SRC, 'utf8'))

/** 按 `pages.<i>.<key>` 取/写数组（只支持两层：pages.i.key） */
const [pIdx, key] = JSONPATH.split('.').slice(1)
const page = base.pages[Number(pIdx)]
if (!page || !Array.isArray(page[key])) { console.error(`✗ 底档里 ${JSONPATH} 不是数组 ⇒ 停手（不许猜）`); process.exit(2) }
const seed = page[key].slice()

/* ★ **必须抬 `maxItems` 才能探到条数真判据**（与 K22 同族：schema 上限会**拦死测量** —— 实测 N=6/7/8 全被 `maxItems:5` 拒）⇒
   造 override（`DECK_SCHEMA_OVERRIDE`，**仅渲染**用；引擎读的是 HTML，不受影响）。指针守卫：找不到 maxItems 就停手。 */
const MAXITEM_PTR = arg('--maxitems-ptr', '#/$defs/pageBullets/properties/items')
const sch = JSON.parse(readFileSync(join(HERE, 'deck.schema.json'), 'utf8'))
const node0 = MAXITEM_PTR.split('/').slice(1).reduce((o, k) => (o == null ? undefined : o[k]), sch)
if (!node0 || node0.maxItems === undefined) { console.error(`✗ 指针 ${MAXITEM_PTR} 在 schema 里**没有 maxItems** ⇒ 停手（指针守卫）`); process.exit(2) }
const before = node0.maxItems
node0.maxItems = Math.max(before, N_MAX)
const ovr = join(tmpdir(), `deck.schema.count.${process.pid}.json`)
writeFileSync(ovr, JSON.stringify(sch, null, 2), 'utf8')

const created = []
const cleanup = () => { if (!KEEP) for (const p of created) { try { rmSync(p, { recursive: true, force: true }) } catch { /* ignore */ } } }
process.on('exit', cleanup)

/** 把一个数组**循环补足/截断**到 n 条（条数构造器的核心动作） */
function fit(arr, n) {
  const out = []
  for (let i = 0; i < n; i++) out.push(arr[i % arr.length])
  return out
}

console.log(`=== 条数构造器：deck=${DECK} · ${JSONPATH} · N=${MIN}…${N_MAX}（现上限 ${MAX}·下限 ${MIN}）===`)
const rows = []
for (let N = MIN; N <= N_MAX; N += STRIDE) {
  const vj = join(HERE, 'examples', `__tmp_count-k${N}.json`)
  const outdir = `out-tmp-count-k${N}`
  const d = JSON.parse(JSON.stringify(base))
  d.pages[Number(pIdx)][key] = fit(seed, N)
  writeFileSync(vj, JSON.stringify(d, null, 2), 'utf8')
  created.push(vj, join(HERE, outdir))

  /* ② 自己渲染（**不用 crosscheck 的注入**：它的"零注入"会把首条文本变空 ⇒ 触发 minLength ⇒ 校验拒 —— 实测踩过） */
  const r = spawnSync(process.execPath, [join(HERE, 'render-deck.mjs'), `examples/__tmp_count-k${N}.json`, '--outdir', outdir],
    { cwd: HERE, encoding: 'utf8', maxBuffer: 1 << 26, env: { ...process.env, DECK_SCHEMA_OVERRIDE: ovr } })
  const rout = String(r.stdout || '') + String(r.stderr || '')
  /* 产物落在 <outdir>/<变体名>/（render 用 deck 文件名做子目录） */
  const prodDir = join(HERE, outdir, `__tmp_count-k${N}`)

  /* ③ (a) 读回条数（必须 == N）：`dom-target` 输出形态实测为 {"selector":"li","count":4,…} */
  const dt = spawnSync(process.execPath, [join(HERE, 'dom-target.mjs'), prodDir, SEL], { cwd: HERE, encoding: 'utf8' })
  const dout = String(dt.stdout || '') + String(dt.stderr || '')
  const cm = dout.match(/count"?\s*:\s*(\d+)/i)
  const counted = cm ? Number(cm[1]) : null

  /* ④ 引擎闸门（与 crosscheck 同一调用）⇒ 从原始输出里提取 `"code": "xxx"` 并分类 */
  const g = spawnSync(process.execPath, [join(HERE, 'check-engine-lint.mjs'), prodDir, '--assert-overlap', '--assert-decor', '--no-contrast'],
    { cwd: HERE, encoding: 'utf8', maxBuffer: 1 << 26 })
  const gout = String(g.stdout || '') + String(g.stderr || '')
  const allCodes = [...gout.matchAll(/"code"\s*:\s*"([a-z_]+)"/g)].map((x) => x[1])
  const uniq = [...new Set(allCodes)]
  const judgeHit = uniq.filter((x) => JUDGE.includes(x))
  const outsider = uniq.filter((x) => !JUDGE.includes(x))
  const gateOk = /结论:\s*PASS/.test(gout) || (g.status === 0 && !judgeHit.length)

  rows.push({ N, codes: uniq, judgeHit, outsider, gate: gateOk ? 'PASS' : 'FAIL', counted, renderExit: r.status, engineExit: g.status })
  console.log(`  N=${String(N).padStart(2)} · 渲染 exit=${r.status} · 引擎 exit=${g.status} · 读回条数=${counted === null ? '?' : counted}（需 ${N}${counted === N ? ' ✓' : ' ✗'}）· 判据码=[${judgeHit.join(', ')}]${outsider.length ? ' · 非判据码=[' + outsider.join(', ') + ']' : ''}`)
  /* ⚠️ **渲染失败必须打原样输出**（§25a：不许过滤失败输出）—— 我第一版把它 `void` 掉了 ⇒ 事后无从定位 */
  if (r.status !== 0) {
    console.log(`      渲染 ✗（exit=${r.status}）原样末 6 行：`)
    for (const l of rout.split('\n').filter(Boolean).slice(-6)) console.log(`        ${l.slice(0, 170)}`)
  }
  if (outsider.length) console.log(`      ⚠️ **出现不在判据集合的码**：${outsider.join(', ')} ⇒ (c) 要求红（不得当作"无触发"）`)
}

/* 判定 */
const badReadback = rows.filter((r) => r.counted !== r.N)
const outsiderRows = rows.filter((r) => r.outsider.length)
const first = rows.find((r) => r.judgeHit.length)
console.log('\n=== 结论 ===')
if (badReadback.length) console.log(`  ✗ **读回条数不匹配** ${badReadback.length} 行（${badReadback.map((r) => `N=${r.N}:${r.counted}`).join(' ')}）⇒ 注入没生效 ⇒ 读数无意义 ⇒ exit 2`)
if (outsiderRows.length) console.log(`  ✗ **有"非判据集合的码"**：${[...new Set(outsiderRows.flatMap((r) => r.outsider))].join(', ')} ⇒ 不许当"无触发" ⇒ exit 2`)
if (first) console.log(`  ✅ 判据（首个触发判据码的 N）= **${first.N}** · 决定性码 = [${first.judgeHit.join(', ')}] · 闸门=${first.gate}`)
else console.log(`  ⏳ 到 N_MAX=${N_MAX} 未触发 ⇒ 按 (b) 记 **judgeLimitAtLeast: ${N_MAX}**（**不是 null**：已测且容量 ≥ ${N_MAX}）⇒ editorial 格的「cap ≤ ${N_MAX}」仍要断言`)
process.exit(badReadback.length || outsiderRows.length ? 2 : 0)
