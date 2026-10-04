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
/* ★ msg31 ④：`--sel` 的 **CSS 子集**复用 `dom-target.countCss`（**唯一实现**，不另造选择器引擎）。 */
import { countCss } from './dom-target.mjs'
import { fileURLToPath } from 'node:url'
/* ★★ team-lead msg8 ③：兜底 = **跳过 shebang/import 后的第一句可执行**（此前它在 ~60 行之后 ⇒ 那段里的异常仍漏网）。 */
for (const [ev, tag] of [['uncaughtException', 'UNCAUGHT_EXCEPTION'], ['unhandledRejection', 'UNCAUGHT_REJECTION']]) {
  process.on(ev, (e) => {
    console.log(`✗ **[${tag}] 未捕获的故障 ⇒ 已转为带 tag 的红（exit 2）：${(e && e.message) || e}`)
    const st = String((e && e.stack) || '').split('\n').slice(1, 4).join(' | ')
    if (st) console.error(`     ${st}`)
    process.exit(2)
  })
}
/* ★ msg8 ③：兜底的正控（主动抛 ⇒ 断言转 tag + exit 2）。 */
if (process.argv.includes('--self-test-uncaught')) throw new Error('自测：故意抛出（验证兜底转 tag）')

const HERE = dirname(fileURLToPath(import.meta.url))
const argv = process.argv
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d }
const DECK = arg('--deck', 'master-v1')
const PAGE = Number(arg('--page', '2'))
/* ★★ team-lead msg29 ③(b)：容器唯一性守卫的**显式豁免**（`--containers-expect <n>` + **必带理由** `--containers-why`）。 */
const CONT_EXPECT = arg('--containers-expect', '')
const CONT_WHY = arg('--containers-why', '')
const JSONPATH = arg('--jsonpath', 'pages.1.items')
const CLS = arg('--cls', 'li:first-child .t')
/* ★ team-lead ①：**默认值必须安全** —— 旧默认 `li` = **全篇计数**（正是"读回 23"那个坑）⇒
   缺 `--sel` ⇒ **红**（不许静默退化成全篇）。与"无输出即失败"同族。 */
const SEL = arg('--sel', '')
if (!SEL && !process.argv.includes('--self-test-extract') && !process.argv.includes('--self-test-scope')) {
  console.error('✗ 缺 `--sel`（检测点标签，如 li）⇒ **不许用危险默认**（旧默认 li 会全篇计数 ⇒ 读数错）⇒ exit 2')
  process.exit(2)
}
/* ★★ team-lead ②（msg1）：**同一套旗标三件套**（此前只有 crosscheck 有 ⇒ 本工具的新旗标"无人罩"）：
   ① **注册表** ② **未识别即红**（`source` 若写错一个旗标，照抄者**立刻得到点名红**，而不是哑的"未识别参数"）
   ③ **覆盖断言**：注册表 ⊇ 源码里出现的全部旗标字面量 · 且每个注册项**必须被真正消费**（防"登记了却没人读"）。 */
/** ★ team-lead msg6 ④：**跨工具提示** —— 未识别旗标时查一遍**本仓其它工具**，直接告诉你该用哪个
    （他两度用错工具、各白跑一次；`--ks`/`-short` 类提示已有，这里是"跨工具"那一半）。 */
function siblingHint(flagName) {
  try {
    for (const f of readdirSync(HERE)) {
      if (!f.endsWith('.mjs') || f === 'measure-count.mjs') continue
      if (readFileSync(join(HERE, f), 'utf8').includes("'" + flagName + "'")) return f
    }
  } catch { /* ignore */ }
  return ''
}
const MC_FLAGS = [
  { name: '--deck', argv: true }, { name: '--page', argv: true }, { name: '--jsonpath', argv: true },
  { name: '--cls', argv: true }, { name: '--sel', argv: true }, { name: '--min', argv: true },
  { name: '--max', argv: true }, { name: '--stride', argv: true }, { name: '--nmax', argv: true },
  { name: '--maxitems-ptr', argv: true }, { name: '--keep', argv: false },
  { name: '--self-test-extract', argv: false }, { name: '--self-test-scope', argv: false },
  { name: '--containers-expect', argv: true }, { name: '--containers-why', argv: true },
  { name: '--self-test-uncaught', argv: false },   /* ★ msg8 ③：兜底正控（主动抛 ⇒ 断言转 tag） */
]
/* ⚠️ 这四个是**下游引擎**旗标（透传给 crosscheck/render）—— 我第一版留空表 ⇒ **本工具自己的注册表断言当场点名**
   （`✗ 旗标注册表不全：--outdir --assert-overlap --assert-decor --no-contrast`）⇒ 照它补登（"守卫自己被守卫"又一例）。 */
const MC_DOWNSTREAM = ['--outdir', '--assert-overlap', '--assert-decor', '--no-contrast']
/* ★ **外部命令**（git）旗标：本工具不解析、只转交 ⇒ 单列一类（我加"读数打印 SHA"时写了 '--short'/'--porcelain'
   ⇒ 被自己的注册表断言判红 ⇒ 这正是"守卫自己被守卫"），见 crosscheck 同名字段的说明。 */
const MC_EXTERNAL = ['--short', '--porcelain']
{
  const src = readFileSync(fileURLToPath(import.meta.url), 'utf8')
  const found = [...new Set([...src.matchAll(/'(--[a-zA-Z][\w-]*)'/g)].map((m) => m[1]))]
  const known = new Set([...MC_FLAGS.map((f) => f.name), ...MC_DOWNSTREAM, ...MC_EXTERNAL])
  const missing = found.filter((f) => !known.has(f))
  if (missing.length) { console.error(`✗ **旗标注册表不全**：${missing.join(' ')} ⇒ 新增旗标必须登记进 MC_FLAGS（自己）或 MC_DOWNSTREAM（下游）⇒ exit 2`); process.exit(2) }
  const unknown = [...new Set(argv.filter((a) => /^--/.test(a)))].filter((a) => !known.has(a))
  /* ⚠️ 模板串里**不许出现反引号**（我第一次写「照抄 `source`」⇒ 把模板串提前闭合 ⇒ 语法错；与"块注释嵌套"同族）。 */
  if (unknown.length) {
    console.error(`✗ **未识别的参数**：${unknown.join(' ')}\n   允许的旗标：${[...known].join(' ')}\n   （防"照抄 source 时写错一个旗标"变成**哑红** ⇒ 此处点名）⇒ exit 2`)
    const hint = siblingHint(unknown[0])
    if (hint) console.error(`   ★ **该旗标属其它工具**：\`${hint}\` ⇒ 请用：node ${hint} ${unknown[0]} …（本次用错了工具 ⇒ 白跑）`)
    process.exit(2)
  }
  const dead = MC_FLAGS.filter((f) => !new RegExp(`(arg\\(|flag\\(|includes\\()'${f.name}'`).test(src)).map((f) => f.name)
  if (dead.length) { console.error(`✗ 注册了但**没人消费**的旗标：${dead.join(' ')} ⇒ 要么接线、要么删登记（防"登记即假装覆盖"）⇒ exit 2`); process.exit(2) }
  console.log(`  ✓ 旗标三件套：注册 **${MC_FLAGS.length}** · 未识别 **0** · 死旗标 **0** · 源码字面量 **${found.length}** 全部已登记`)
}
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
/* ★★ msg29 ②：**运行期把 `--page` 接线为真校验**（秒级、在任何渲染之前）—— 声明与 `--jsonpath` 推出的应在页不符 ⇒ exit 2。 */
{
  const tag = pageArgTag(JSONPATH, PAGE)
  if (tag) {
    console.error(`✗ [${tag}] --page ${PAGE} ≠ 由 --jsonpath 推出的应在页 ${pageArgExpect(JSONPATH)}（${JSONPATH} ⇒ 0-based 第 ${pageArgExpect(JSONPATH)} 页）`)
    console.error('   ⇒ 定位权威是 --jsonpath（实测 --page 的数值**不决定**被量对象）⇒ --page 只是**声明**：声明与权威不符即红')
    process.exit(2)
  }
  if (pageArgExpect(JSONPATH)) console.log(`  ✓ 页声明一致：--page ${PAGE} == jsonpath 推出的第 ${pageArgExpect(JSONPATH)} 页（判定后再跑）`)
}
const before = node0.maxItems
node0.maxItems = Math.max(before, N_MAX)
const ovr = join(tmpdir(), `deck.schema.count.${process.pid}.json`)
writeFileSync(ovr, JSON.stringify(sch, null, 2), 'utf8')

/* ★★ team-lead ②：**提取器的 I11 漏洞** —— 旧写法 `…match || 0` ⇒ 「**行没打印**」与「**真 0 条**」**不可区分**，
   而前者会被读成"无判据码"（我的**承重结论**就可能只是解析失效）。
   ⇒ 三态区分：**行存在且 >0**（触发）｜**行存在且 =0**（真无）｜**行缺失** ⇒ **红 `EXTRACT-INPUT-MISSING`**；
   并回显**扫描统计**（`扫 N 行`，N=0 ⇒ 红 —— I11 直接适用）。 */
function parseEngineOut(gout) {
  const lines = String(gout || '').split('\n').length
  const ovlLine = /重叠判据[^\n]*共\s*(\d+)\s*条/.exec(gout)
  const codesLine = (/各 code 计数:\s*([^\n]*)/.exec(gout) || [])[1] || ''
  const codes = codesLine.split('·').map((s) => s.trim().split('×')[0].trim()).filter(Boolean)
  return { lines, codes, ovl: ovlLine ? Number(ovlLine[1]) : null }
}
/* ★ 提取器**自己的正控/负控**（合成输入，不需要渲染）：`--self-test-extract` */
if (process.argv.includes('--self-test-extract')) {
  const A = '  各 code 计数: content_overlap×2 · canvas_overflow×1\n  重叠判据（content_overlap）[--assert-overlap]：共 2 条（白名单命中 0 条）'
  const B = '  各 code 计数: text_box_overflow×1\n  重叠判据（content_overlap）[--assert-overlap]：共 0 条（白名单命中 0 条）'
  const C = '  各 code 计数: text_box_overflow×1'
  const a = parseEngineOut(A), b = parseEngineOut(B), c = parseEngineOut(C)
  const ok = a.ovl === 2 && a.codes.includes('content_overlap') && b.ovl === 0 && c.ovl === null
  console.log(`  提取器自测：A(触发) ovl=${a.ovl} ✓=${a.ovl === 2} · B(真无) ovl=${b.ovl} ✓=${b.ovl === 0} · C(缺行) ovl=${c.ovl === null ? 'null(判红)' : c.ovl} ✓=${c.ovl === null}`)
  console.log(`  扫行数：A=${a.lines} B=${b.lines} C=${c.lines}（0 ⇒ 红）`)
  process.exit(ok ? 0 : 1)
}

/* ★ team-lead ②/③/④：把**读数解析类逻辑**抽成**纯函数** ⇒ 可喂**合成输入自测**（秒级、免渲染、可判伪）。
   这三条是"条数读数"的**承重判据**（决定"有没有几何失败模式"）⇒ 必须自证。 */
function scopedCount(htmlText, tag) { return (String(htmlText).match(new RegExp(`<${tag}\\b`, 'gi')) || []).length }
/* ★★ msg31 ④：`--sel` **支持 CSS 子集**（组合器 `>`/后代 · `:first-child` · `:nth-child(n)` · `[attr]`）——
   含这些语法时走 `countCss`（`dom-target` 的唯一实现）；**不被支持 ⇒ 返回 bad ⇒ 调用方判红**
   （**绝不静默 0**：静默 0 曾把我引向"选择器不可表达"的误判，也让"读数"看起来正常）。纯标签选择器仍走快路径（零风险）。 */
function selCount(htmlText, sel) {
  if (/[>[\] :]/.test(String(sel))) {
    const r = countCss(htmlText, sel)
    return r.ok ? { n: r.count } : { bad: r.why }
  }
  return { n: (String(htmlText).match(new RegExp(`<${String(sel).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi')) || []).length }
}
function containerCount(sliceHtml) { return (String(sliceHtml).match(/<(ul|ol)\b/gi) || []).length }
function pageAssertOk(hitPage, cellPage) { return !cellPage || Number(hitPage) === Number(cellPage) }
/* ★★ team-lead msg29 ②（**裁定 a：接线为真校验**）：定位权威是 `--jsonpath pages.<i>`（0-based ⇒ 应在页 `i+1`），
   `--page` 是**声明** ⇒ 声明与权威不符 ⇒ **红**（tag `PAGE_ARG_MISMATCH`），**不是**"用它定位"。
   与 `crosscheck --expect-page` **对称**（那里断言"命中页 == 该格 page"，这里断言"声明页 == jsonpath 推出的页"）。
   ★ 为什么必须接线：实测 `--page` 的数值**不决定**被量对象（`--page 3` 打 `pages.3.steps`（第 4 页）也通过）
     ⇒ 不接线它就是**纸面装饰**（后人写错无人知）；接线后 13/17 格命令里的 `--page` **立刻有牙**。 */
function pageArgTag(jsonpath, page) {
  const m = /^pages\.(\d+)\./.exec(String(jsonpath || ''))
  if (!m) return null                      /* 非页内数组（如顶层 pages）⇒ 没有"应在页"可声明 */
  return Number(page) === Number(m[1]) + 1 ? null : 'PAGE_ARG_MISMATCH'
}
/* ★★ team-lead msg29 ③(b)：**容器唯一性守卫的显式豁免**（守卫**不弱化**）——
   有些页**天然多容器**（如 compare 页左右各一个 `<ul>`）⇒ 合并计数会**高估** ⇒ 此时不该"关掉守卫"，
   而应**声明预期**：`--containers-expect <n>`（本页该选择器预期命中几个容器）+ **必带理由** `--containers-why`（与灰名单同款）。
   判据：未声明 ⇒ 原守卫（>1 红）不变；声明了 ⇒ 命中数必须 == n（≠ ⇒ `CONTAINERS_EXPECT_MISMATCH`）；
        声明了却**没给理由** ⇒ `CONTAINERS_EXPECT_NO_REASON`（豁免必须写理由）。 */
function containerExpectTag(containers, expect, why) {
  if (expect === '' || expect === null || expect === undefined) return null
  if (!String(why || '').trim()) return 'CONTAINERS_EXPECT_NO_REASON'
  return Number(containers) === Number(expect) ? null : 'CONTAINERS_EXPECT_MISMATCH'
}
function pageArgExpect(jsonpath) {
  const m = /^pages\.(\d+)\./.exec(String(jsonpath || ''))
  return m ? Number(m[1]) + 1 : null
}
/* ★ `--self-test-scope`：**合成输入**正/负控（与 `--self-test-extract` 同款形态）——
   ① 单容器切片 ⇒ 容器数 1（不红）② **双容器切片 ⇒ 容器数 2（必须红）** ③ 切条数正确 ④ 页断言：同页 true / 异页 false（必须红）。 */
if (process.argv.includes('--self-test-scope')) {
  const one = '<section><ul><li>a</li><li>b</li><li>c</li></ul></section>'
  const two = '<section><ul><li>a</li></ul><ol><li>b</li></ol></section>'
  const c1 = containerCount(one) === 1, c2 = containerCount(two) === 2, s3 = scopedCount(one, 'li') === 3
  const p1 = pageAssertOk(4, 4) === true, p2 = pageAssertOk(3, 4) === false
  /* ★ msg29 ②：**`--page` 声明的合成负控** —— 负控的**红因必须恰为 tag**（不只"红了"）。 */
  const pa1 = pageArgTag('pages.9.items', 10) === null
  const pa2 = pageArgTag('pages.9.items', 9) === 'PAGE_ARG_MISMATCH'
  const pa3 = pageArgTag('pages', 5) === null      /* 顶层数组 ⇒ 无应在页 ⇒ 不红 */
  /* ★ msg29 ③(b)：**容器豁免**的合成自测 —— 未声明⇒原守卫 / 声明且相符⇒通过 / 不符⇒恰为该 tag / 无理由⇒恰为理由 tag。 */
  const ce1 = containerExpectTag(2, '', '') === null
  const ce2 = containerExpectTag(2, 2, 'compare 页左右各一 ul') === null
  const ce3 = containerExpectTag(2, 3, '理由') === 'CONTAINERS_EXPECT_MISMATCH'
  const ce4 = containerExpectTag(2, 2, '   ') === 'CONTAINERS_EXPECT_NO_REASON'
  /* ★ msg31 ④：**选择器子集**的合成自测 —— 组合器命中预期条数；**不支持的语法 ⇒ bad（判红）**。 */
  const cssSrc = '<section><div class="p3-metrics"><div>a</div><div>b</div></div><div class="other"><div>c</div></div></section>'
  const sc1 = selCount(cssSrc, 'div.p3-metrics>div').n === 2
  const sc2 = selCount(cssSrc, 'div.p3-metrics div').n === 2
  const sc3 = !!selCount(cssSrc, 'div + div').bad
  const sc4 = selCount(cssSrc, 'li').n === 0
  const ok = c1 && c2 && s3 && p1 && p2 && pa1 && pa2 && pa3 && ce1 && ce2 && ce3 && ce4 && sc1 && sc2 && sc3 && sc4
  console.log(`  合成自测(scope)：单容器=${containerCount(one)}(须 1) ${c1 ? '✓' : '✗'} · **双容器=${containerCount(two)}(须 2 ⇒ 红)** ${c2 ? '✓' : '✗'} · 切条数=${scopedCount(one, 'li')}(须 3) ${s3 ? '✓' : '✗'}`)
  console.log(`                    页断言：同页(4,4)=${pageAssertOk(4, 4)}(须 true) ${p1 ? '✓' : '✗'} · **异页(3,4)=${pageAssertOk(3, 4)}(须 false ⇒ 红)** ${p2 ? '✓' : '✗'}`)
  console.log(`                    **--page 声明**：一致(pages.9.items, 10)=${pageArgTag('pages.9.items', 10)}(须 null) ${pa1 ? '✓' : '✗'} · **不一致(9)=${pageArgTag('pages.9.items', 9)}(须恰为 PAGE_ARG_MISMATCH)** ${pa2 ? '✓' : '✗'} · 顶层数组(pages, 5)=${pageArgTag('pages', 5)}(须 null) ${pa3 ? '✓' : '✗'}`)
  console.log(`                    **容器豁免**：未声明(2,'')=${containerExpectTag(2, '', '')}(须 null) ${ce1 ? '✓' : '✗'} · 声明相符(2,2,理由)=${containerExpectTag(2, 2, '理由')}(须 null) ${ce2 ? '✓' : '✗'} · **不符(2,3)=${containerExpectTag(2, 3, '理由')}(须恰为 CONTAINERS_EXPECT_MISMATCH)** ${ce3 ? '✓' : '✗'} · **无理由(2,2,'  ')=${containerExpectTag(2, 2, '  ')}(须恰为 CONTAINERS_EXPECT_NO_REASON)** ${ce4 ? '✓' : '✗'}`)
  process.exit(ok ? 0 : 1)
}

const created = []
let PROBE = { g: 0, s: 0 }      /* 作用域探针（页无关 `li` 计数：全篇 vs 页内）—— 循环内记录，汇总处判 scopeOk */
const cleanup = () => { if (!KEEP) for (const p of created) { try { rmSync(p, { recursive: true, force: true }) } catch { /* ignore */ } } }
process.on('exit', cleanup)

/** 把一个数组**循环补足/截断**到 n 条（条数构造器的核心动作） */
function fit(arr, n) {
  const out = []
  for (let i = 0; i < n; i++) out.push(arr[i % arr.length])
  return out
}

/* ★★ **根治"临时档留痕"**（team-lead ①卫生 + 漂移守卫的**故意**判红「`examples/__tmp_*` 不许留痕」）：
   ① 变体档改写到 `out-tmp-count/`（以 out 开头的目录被 .gitignore 覆盖 ⇒ 不进 git、也不是锚点）—— 此前写 `examples/` ⇒
      一旦进程被管道截断（我看到的是 `Select-Object -First N` 把进程掐死）就**留痕** ⇒ 挡住整批提交（commit-safe 实测拒绝我）。
   ② 顺带**清扫本工具自己命名空间**的存量（`examples/__tmp_count-k*.json`）—— 只删自己的前缀，不碰别人。 */
const TMP_DIR = join(HERE, 'out-tmp-count')
mkdirSync(TMP_DIR, { recursive: true })
if (!KEEP) {
  const stale = readdirSync(join(HERE, 'examples')).filter((f) => /^__tmp_count-k\d+\.json$/.test(f))
  for (const f of stale) { try { rmSync(join(HERE, 'examples', f), { force: true }) } catch { /* ignore */ } }
  if (stale.length) console.log(`  ℹ 清扫本工具存量残留 ${stale.length} 个（examples/__tmp_count-k*.json ⇒ 变体档已改写到 out-tmp-count/）`)
}
/* ★ team-lead msg4 ②：读数必须能归属到一棵树（否则跨快照比对产出假"未修/已修"）。 */
const TREE = (() => {
  try {
    const sha = String(spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: HERE, encoding: 'utf8' }).stdout || '').trim() || 'n/a'
    /* ⚠️ 排除 `.codebuddy/`（协作目录，不入库）⇒ 否则每轮假报"有未提交改动"。 */
    const paths = String(spawnSync('git', ['status', '--porcelain'], { cwd: HERE, encoding: 'utf8' }).stdout || '')
      .split('\n').map((l) => l.trim()).filter((l) => l && !l.includes('.codebuddy/'))
    return { sha, dirty: paths.length > 0, n: paths.length, paths }
  } catch { return { sha: 'n/a', dirty: null, n: 0 } }
})()
console.log(`  ℹ 读数归属：**SHA=${TREE.sha}** · 工作树 ${TREE.dirty ? `**有 ${TREE.n} 处未提交改动 ⇒ 该读数不可用于复核**（先提交再取读数）` : '清洁 ✓'}`)
/* ★ msg6 ③(b)：打印那 N 处的路径（≤5）⇒ 人能一眼判断是不是真污染。 */
if (TREE.dirty) for (const l of TREE.paths.slice(0, 5)) console.log(`       · ${l}`)
if (TREE.dirty && TREE.n > 5) console.log(`       · …（其余 ${TREE.n - 5} 处）`)
console.log(`=== 条数构造器：deck=${DECK} · ${JSONPATH} · N=${MIN}…${N_MAX}（现上限 ${MAX}·下限 ${MIN}）===`)
const rows = []
for (let N = MIN; N <= N_MAX; N += STRIDE) {
  /* ⚠️ **变体档必须与例档同目录（`examples/`）**：render 按**档所在目录**解析素材 ⇒ 我把档挪到 `out-tmp-count/` 后
     render 直接失败（实测 ENOENT：`out-tmp-count-k3/__tmp_count-k3/index.html` 不存在）。⇒ 目录**不动**，
     改用三重"不留痕"保证：**启动清扫存量 + 渲染后立即删 + exit 自洁**（把留痕窗口压到"一次渲染"的时长）。 */
  const vj = join(HERE, 'examples', `__tmp_count-k${N}.json`)
  const vrel = `examples/__tmp_count-k${N}.json`
  const outdir = `out-tmp-count-k${N}`
  const d = JSON.parse(JSON.stringify(base))
  d.pages[Number(pIdx)][key] = fit(seed, N)
  writeFileSync(vj, JSON.stringify(d, null, 2), 'utf8')
  created.push(vj, join(HERE, outdir))

  /* ② 自己渲染（**不用 crosscheck 的注入**：它的"零注入"会把首条文本变空 ⇒ 触发 minLength ⇒ 校验拒 —— 实测踩过） */
  const r = spawnSync(process.execPath, [join(HERE, 'render-deck.mjs'), vrel, '--outdir', outdir],
    { cwd: HERE, encoding: 'utf8', maxBuffer: 1 << 26, env: { ...process.env, DECK_SCHEMA_OVERRIDE: ovr } })
  const rout = String(r.stdout || '') + String(r.stderr || '')
  /* 产物落在 <outdir>/<变体名>/（render 用 deck 文件名做子目录） */
  const prodDir = join(HERE, outdir, `__tmp_count-k${N}`)

  /* ★★ team-lead ③：**页作用域不靠"人手挑唯一类名"**（那是"量具版的 K22"：换母版即失效、且无人守）——
     用**页切片**（与 `dom-target` 的 `pageNo` **同一机制、同一索引**）：第 i 页 = 第 (i+1) 个 `<section>` 切片内计数。
     三条断言（缺一 ⇒ 读数不可信）：
       (a) `scoped == N`（页内条数 = 注入条数）
       (b) 与 `dom-target` 报的 `pageNo` **交叉核对**必须 == 注入页索引 + 1（防"数对了别的页"）
       (c) 同时打印 `global`（全篇计数）；并要求**至少一行 `global > scoped`** —— 这是**作用域自己的负控**
           （若作用域没生效、把整篇当一页，读数可能"恰好对" ⇒ 假绿） */
  if (!KEEP) { try { rmSync(vj, { force: true }) } catch { /* ignore */ } }   /* ★ 渲染一完就删 ⇒ 留痕窗口 = 一次渲染时长 */
  /* ⚠️ **产物缺失 ⇒ 判红（不崩栈）**：第一版直接 `readFileSync` ⇒ 我照抄 `source` 时得到的是**异常栈**
     （`ENOENT … index.html`）而不是"渲染失败"的可读判据 ⇒ 违反"凡打印 ✗ 必须有失败标记"的反面（**连 ✗ 都没有**）。 */
  const prodHtml = join(prodDir, 'index.html')
  if (!existsSync(prodHtml)) {
    console.log(`  N=${String(N).padStart(2)} · **渲染失败：产物缺失**（${prodHtml}）⇒ 计入失败`)
    for (const l of rout.split('\n').filter(Boolean).slice(-6)) console.log(`        ↳ ${l.trim().slice(0, 170)}`)
    rows.push({ N, codes: [], judgeHit: [], outsider: [], gate: 'FAIL', counted: -1, global: -1, dtPage: null, dtCount: null, renderExit: r.status, engineExit: -1, twoPath: '（未跑：产物缺失）', containers: -1 })
    continue
  }
  const html = readFileSync(prodHtml, 'utf8')
  const secs = html.split(/<section\b/i).slice(1)                 /* 每页一切片 */
  const tag = SEL.replace(/[^a-z]/gi, '') || 'li'
  const slice = String(secs[Number(pIdx)] || '')
  const sR = selCount(slice, SEL), gR = selCount(html, SEL)
  /* ★ 作用域探针（**页无关**：`li`）—— 本行在循环内，**必须在这里记录**（汇总处 `html`/`slice` 不在作用域，
     我第一版直接在汇总处写 ⇒ `[UNCAUGHT_EXCEPTION] html is not defined` ⇒ 被工具转成带 tag 的红 ✓）。 */
  PROBE = { g: selCount(html, 'li').n ?? 0, s: selCount(slice, 'li').n ?? 0 }
  if (sR.bad || gR.bad) {
    console.log(`      ✗ [SEL_UNSUPPORTED] ${sR.bad || gR.bad} ⇒ **判红**（不许把"不支持"当 0 读数）`)
    rows[rows.length - 1].selBad = true
  }
  const scoped = sR.n ?? -1
  const global = gR.n ?? -1
  /* ★ team-lead ⑤：**页内同类容器数必须 == 1** —— 否则"切片内所有 `<li`"会**合并高估**（两个 `<ul>` ⇒ 读回 > N）。
     便宜且可判伪（比按 jsonpath 定位容器轻）。★ ②：**真红**（计入 contOk，参与退出码）。 */
  const containers = containerCount(slice)
  const dt = spawnSync(process.execPath, [join(HERE, 'dom-target.mjs'), prodDir, SEL], { cwd: HERE, encoding: 'utf8' })
  const dout = String(dt.stdout || '') + String(dt.stderr || '')
  const cm = dout.match(/count"?\s*:\s*(\d+)/i)
  const pm = dout.match(/pageNo"?\s*:\s*(\d+)/i)
  const counted = scoped
  const dtPage = pm ? Number(pm[1]) : null
  const dtCount = cm ? Number(cm[1]) : null

  /* ④ 引擎闸门（与 crosscheck 同一调用）⇒ 从原始输出里提取 `"code": "xxx"` 并分类 */
  const g = spawnSync(process.execPath, [join(HERE, 'check-engine-lint.mjs'), prodDir, '--assert-overlap', '--assert-decor', '--no-contrast'],
    { cwd: HERE, encoding: 'utf8', maxBuffer: 1 << 26 })
  const gout = String(g.stdout || '') + String(g.stderr || '')
  /* ⚠️ **实测输出形态**：`各 code 计数: timeline_track_too_dense×1 · nested_structure_needs_subcomposition×12`
     （**不是** JSON 的 `"code":` 形态）—— 我第一版按 JSON 提取 ⇒ **永远拿空集** ✗（同族：提取式与真实形态不符）。
     JUDGE 判据另看**专用断言行**：`重叠判据（content_overlap）[--assert-overlap]：共 N 条` ⇒ **N>0 才算判据触发**。 */
  const ex = parseEngineOut(gout)
  const uniq = ex.codes
  /* **行缺失 ⇒ 红**（I11）：不许把"没打印"读成"真 0 条" */
  if (ex.ovl === null || ex.lines === 0) {
    console.error(`✗ **EXTRACT-INPUT-MISSING**：引擎输出里${ex.lines === 0 ? '**没有任何行**' : '**没有**「重叠判据…共 N 条」行'} ⇒ 提取器输入缺失 ⇒ 本次"无判据码"结论**不可采信** ⇒ exit 2`)
    process.exit(2)
  }
  const judgeHit = ex.ovl > 0 ? ['content_overlap'] : []
  console.log(`      提取器：扫 ${ex.lines} 行 · 提出 ${uniq.length} 码（其中判据 ${judgeHit.length}）· 重叠行=共 ${ex.ovl} 条`)
  const outsider = uniq.filter((x) => !JUDGE.includes(x))
  const gateOk = /结论:\s*PASS/.test(gout) || (g.status === 0 && !judgeHit.length)

  rows.push({ N, codes: uniq, judgeHit, outsider, gate: gateOk ? 'PASS' : 'FAIL', counted, global, dtPage, dtCount, renderExit: r.status, engineExit: g.status })
  /* (b) **交叉核对**（修正语义）：`dom-target` 用**标签型**选择器时会选**它找到的第一个**含该标签的页 ——
     那未必是注入页（实测：`li` ⇒ 它数的是更早的 bullets 页，pageNo=3）⇒ 那不是失败，而是"**它数了别的页**"。
     ⇒ 正确判据：**只有当两者指向同一页时**才要求计数一致（真交叉核对）；否则打印 ℹ（本次读回**以页切片为准**）。 */
  const injPage1b = Number(pIdx) + 1
  /* ★ team-lead ②(1)：**异页 ⇒ 本格没有"第二路"** ⇒ 必须显式记 `twoPath: 未交叉（页切片单源）`，
     **不许**记成"交叉通过"（否则又把**单源当双源**）。同页 ⇒ 记"双源一致"。 */
  let twoPath = '未交叉（页切片单源）'
  if (dtPage !== null && dtPage === injPage1b && dtCount !== null && dtCount === counted) {
    twoPath = '双源一致（dom-target 同页同数）'
  } else if (dtPage !== null && dtPage === injPage1b && dtCount !== null && dtCount !== counted) {
    console.log(`      ⚠️ **同页双机制不一致**：dom-target count=${dtCount} ≠ 页切片=${counted}（同为第 ${injPage1b} 页）⇒ 读数不可信`)
  } else if (dtPage !== null && dtPage !== injPage1b) {
    console.log(`      ℹ dom-target 选的是**别的页**（pageNo=${dtPage} ≠ 注入页 ${injPage1b}）⇒ twoPath=**未交叉（页切片单源）**`)
  }
  /* ⚠️ team-lead ②：这行原**只打 ✗**、看不出会不会红 ⇒ 现明写"已计入失败"，且它**确实**进 contOk ⇒ exit 2
     （通则：**凡打印 ✗ 的行，必须有对应的失败标记/退出码** —— ✗ 与退出码同源）。 */
  /* ★★ msg29 ③(b)：容器守卫 + **显式豁免**（声明预期 + 必带理由）；两者都**计入失败**（contOk）。 */
  const contTag = containerExpectTag(containers, CONT_EXPECT, CONT_WHY)
  if (contTag) {
    const whyTxt = contTag === 'CONTAINERS_EXPECT_NO_REASON'
      ? '**声明了 `--containers-expect` 却没给 `--containers-why` 理由**（豁免必须写理由）'
      : `**页内同类容器数 = ${containers} ≠ 声明的 ${CONT_EXPECT}**`
    console.log(`      ✗ [${contTag}] ${whyTxt} ⇒ 切片内计数会**合并高估** ⇒ 读数不可信（**已计入失败 ⇒ exit 2**）`)
  } else if (CONT_EXPECT !== '' && Number(CONT_EXPECT) === containers) {
    console.log(`      ✓ 页内同类容器数 = ${containers} == 声明的 ${CONT_EXPECT}（**豁免理由**：${CONT_WHY}）`)
  } else if (containers > 1) {
    console.log(`      ✗ **页内同类容器数 = ${containers} > 1** ⇒ 切片内计数会**合并高估** ⇒ 读数不可信（**已计入失败 ⇒ exit 2**）`)
  }
  /* ⚠️ 赋值放到 push **之后**（第一版把 `twoPath` 写进 push 的对象字面量、而声明在其后 ⇒ `Cannot access 'twoPath' before initialization`） */
  const lastRow = rows[rows.length - 1]
  lastRow.twoPath = twoPath
  lastRow.containers = containers
  lastRow.contOk = (!contTag) && (containers <= 1 || (CONT_EXPECT !== '' && Number(CONT_EXPECT) === containers && String(CONT_WHY).trim() !== ''))
  if (global < counted) console.log(`      ⚠️ **作用域异常**：页内 ${counted} > 全篇 ${global} ⇒ 切片逻辑有问题`)
  console.log(`  N=${String(N).padStart(2)} · 渲染 exit=${r.status} · 引擎 exit=${g.status} · **页内=${counted}**（需 ${N}${counted === N ? ' ✓' : ' ✗'}）· 全篇=${global}${dtPage !== null ? ` · dt.pageNo=${dtPage}` : ''} · 判据码=[${judgeHit.join(', ')}]${outsider.length ? ' · 非判据码=[' + outsider.join(', ') + ']' : ''}`)
  /* ⚠️ **渲染失败必须打原样输出**（§25a：不许过滤失败输出）—— 我第一版把它 `void` 掉了 ⇒ 事后无从定位 */
  if (r.status !== 0) {
    console.log(`      渲染 ✗（exit=${r.status}）原样末 6 行：`)
    for (const l of rout.split('\n').filter(Boolean).slice(-6)) console.log(`        ${l.slice(0, 170)}`)
  }
  /* ⚠️ **恒定 vs 新增**：行内只**记录**；是否判红由**跨 N 差分**决定（见结论段）—— 第一版行内直接写"要求红"⇒
     与结论段"恒定码不判红"**自相矛盾**（实跑打到）。 */
  if (outsider.length) console.log(`      ℹ 非判据集合的码（是否判红看**跨 N 差分**）：${outsider.join(', ')}`)
}

/* 判定 */
const badReadback = rows.filter((r) => r.counted !== r.N)
/* ★ (c) **按 N 差分**（第一版"出现任何非判据码即红"太钝：`timeline_track_too_dense` 等**在 N=3 就有** ⇒
   是**恒定装饰性 warning**（与"容量失败模式"无关）⇒ 只有**随 N 新增**的非判据码才是"候选码不在判据集合"）
   ⇒ 红条件 = **新增的非判据码**（点名），恒定非判据码**记录但不红**。 */
const baseCodes = new Set(rows.length ? rows[0].codes : [])
const constantOutsiders = [...new Set(rows.flatMap((r) => r.outsider).filter((c) => baseCodes.has(c)))]
const newOutsiders = [...new Set(rows.flatMap((r) => r.outsider).filter((c) => !baseCodes.has(c)))]
const first = rows.find((r) => r.judgeHit.length)
console.log('\n=== 结论 ===')
if (badReadback.length) console.log(`  ✗ **页内条数不匹配** ${badReadback.length} 行（${badReadback.map((r) => `N=${r.N}:${r.counted}`).join(' ')}）⇒ 注入或切片出错 ⇒ 读数无意义 ⇒ exit 2`)
/* ★ (c) **作用域自己的负控**：若所有行的 `global == scoped` ⇒ 作用域**没生效**（把整篇当一页）⇒ 读数可能"恰好对" = 假绿 */
const scopeOk = (PROBE.g > PROBE.s) || rows.some((r) => r.global > r.counted)
if (!scopeOk) console.log(`  ✗ **作用域未生效**（所有行 全篇 == 页内）⇒ 切片逻辑没起作用 ⇒ 读数可能"恰好对" = **假绿** ⇒ exit 2`)
const contOk = rows.every((r) => (r.contOk !== undefined ? r.contOk : (r.containers || 0) <= 1))
if (!contOk) console.log(`  ✗ **页内同类容器数 > 1**（某 N 的切片里不止一个列表容器）⇒ 计数会**合并高估** ⇒ 读数不可信 ⇒ exit 2`)
console.log(`  twoPath 记录：${[...new Set(rows.map((r) => r.twoPath))].join(' / ')}`)
if (scopeOk) console.log(`  ✓ 作用域负控：${PROBE.g > PROBE.s ? `**页无关探针**（li：全篇 ${PROBE.g} > 页内 ${PROBE.s}）` : `本格计数 ${rows.filter((r) => r.global > r.counted).length} 行出现 **全篇 > 页内**`} ⇒ 切片确实在起作用`)
if (newOutsiders.length) console.log(`  ✗ **有"随 N 新增的非判据码"**：${newOutsiders.join(', ')} ⇒ 不许当"无触发" ⇒ exit 2`)
if (constantOutsiders.length) console.log(`  ℹ 恒定非判据码（各 N 都有 ⇒ 与容量无关，**记录不判红**）：${constantOutsiders.join(', ')}`)
if (first) console.log(`  ✅ 判据（首个触发判据码的 N）= **${first.N}** · 决定性码 = [${first.judgeHit.join(', ')}] · 闸门=${first.gate}`)
/* ★ team-lead ③ **字段改名**：`judgeLimitAtLeast` 会被读成"**判据 ≥ N_MAX**"，而事实**相反**（N_MAX 内**未触发任何判据**）⇒
   改为 **`capacityAtLeast`**（**容量**：能装多少 ≠ **约束**：该写多少）。文档里必须区分二者 ——
   条数既然无几何失败模式 ⇒ 其上限**只能由编辑意图定** ⇒ 这正是 `kind: editorial` 的含义。 */
else console.log(`  ⏳ 到 N_MAX=${N_MAX} **未触发任何判据** ⇒ 记 **capacityAtLeast: ${N_MAX}**（**容量** ≥ ${N_MAX}；**不是**"判据 ≥ ${N_MAX}"，也不是 null）⇒ 诚实归 editorial：唯一断言「cap ≤ 容量」`)
process.exit(badReadback.length || newOutsiders.length || !scopeOk || !contOk || rows.some((x) => x.selBad) ? 2 : 0)
