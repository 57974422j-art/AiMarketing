/** dom-target.mjs —— **DOM 目标定位的唯一实现**（量表注入 / 填表驱动 / 找页 共用）
 *
 * 为什么需要它（2026-10-03 两个实战缺陷）：
 *  ① `pageNoOfSelector` 曾用**裸子串**找页 ⇒ 单字母 class `.t` 撞上 `tex` ⇒ 判成封面页 ⇒ 稳定帧取错；
 *  ② `.t` / `.h2` 这类 class **一页多处/多页同名** ⇒ "注入哪个元素"不明确 ⇒ 读数无意义。
 *
 * ⇒ 规矩（team-lead 裁定）：**目标必须唯一命中（`count === 1`）**，否则调用方 `exit 2`；
 *    表里用**唯一形态**书写检测点。本模块只支持我们实际需要的形态（不做通用 CSS 引擎）：
 *
 *   | 形态 | 语义（本工具约定） | 例 |
 *   |---|---|---|
 *   | `cls` | class token 精确匹配（**不许裸子串**） | `cover-title` |
 *   | `tag` | 标签名（仅限常见标签，白名单见 `TAGS`） | `h2` |
 *   | `tag.cls` | 标签 + class | `h2.h2` |
 *   | `ancestorCls target` | 在**首个**该类祖先后（窗口 = 直到下一个 `<section`）找 target，要求窗口内唯一 | `p2-head h2` |
 *   | `X:first-child` | **首个匹配 X 的元素**（X = 标签或 class）；由构造保证唯一 | `li:first-child` · `p4-line:first-child` |
 *   | `X:first-child target` | 上述元素的**内部**再找 target（要求唯一） | `li:first-child .t` |
 *
 * ⚠️ `:first-child` 的语义如实声明：本工具取"**首个匹配**"（而非严格 CSS 的"父元素第一个子元素"）——
 *    在本母版里两者一致（首个 `<li>`/首个 `.p4-line` 都确实是父的第一个子元素）；若某 deck 不一致，
 *    该形态**仍是确定且唯一**的（工具约定），但语义与 CSS 有差别，故在此写明。
 *
 * 返回：`{ count, pageNo, openEnd, closeStart, tag, why }`
 *
 * ★★ **CSS 子集（`countCss`）的受支持构造集 —— 自 2026-10-04 起冻结**（team-lead msg33 ④："边界要显式化"）：
 *   | 构造 | 例 | 说明 |
 *   |---|---|---|
 *   | `tag` / `.class` / `tag.class` | `div.p3-metrics` | 复合选择器（多 class 可） |
 *   | 组合器 **后代**（空格） | `div.p3-metrics div` | compare 单侧选择器需要 |
 *   | 组合器 **子代** `>` | `div.p3-metrics > div` | data 叶需要 |
 *   | `:first-child` · `:nth-child(n)` | `div:first-child` · `li:nth-child(2)` | 严格按"父的第 n 个子元素" |
 *   | `[attr]` · `[attr="v"]` | `[data-anim]` | 属性存在/等值 |
 *   **其余一律不支持**（`+` `~` `*` `:not()` `::` `:nth-of-type` …）⇒ `countCss` 返回 `{ok:false}`
 *   ⇒ **调用方必须判红**（`SELECTOR_UNSUPPORTED` / `[SEL_UNSUPPORTED]`），**绝不静默返回 0**。
 *   ⚠️ **新增构造必须先问**（不许顺手加）—— 与 `domTarget` 的既有约定区隔：那套（`:first-child` = 首个匹配 ·
 *   祖先 = 窗口搜索）是 crosscheck / measure-sweep 的**承重语义**，本函数**只增不改**地另开一套严格语义。
 */
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** 常见 HTML 标签白名单：**裸词默认按 class 解释**，只有命中此表才当标签（否则 `kicker` 会被当 `<kicker>`） */
const TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'p', 'div', 'span', 'li', 'ul', 'ol', 'img', 'section', 'a', 'i', 'b', 'em', 'strong', 'svg', 'figure', 'blockquote'])

/** class token 在开标签里的匹配片段（前边界 = 引号或空白；后边界 = 空白或引号） */
const clsAttrRe = (cls) => new RegExp(`class="(?:[^"]*\\s)?${esc(cls)}(?=[\\s"])`)
/** 元素开标签正则：`tag` 或 `tag` + class token 约束 */
const openRe = (spec) => {
  const m = /^([a-z0-9]+)\.([\w-]+)$/i.exec(spec)
  if (m) return { re: new RegExp(`<${m[1]}\\b[^>]*${clsAttrRe(m[2]).source}[^>]*>`, 'gi'), tag: m[1] }
  if (TAGS.has(spec.toLowerCase())) return { re: new RegExp(`<${spec}\\b[^>]*>`, 'gi'), tag: spec }
  return { re: new RegExp(`<([a-z0-9]+)\\b[^>]*${clsAttrRe(spec.replace(/^\./, '')).source}[^>]*>`, 'gi'), tag: null }
}

/** 首个匹配元素的 [开标签起点, 内文起点, 内文终点) —— 内文终点取**同标签最近闭合**（我们的目标是文本叶子，够用） */
function firstRegion(html, spec, from = 0, to = html.length) {
  const seg = html.slice(from, to)
  const { re, tag: tagHint } = openRe(spec)
  const hits = [...seg.matchAll(re)]
  if (!hits.length) return { count: 0, why: `找不到目标「${spec}」` }
  const m = hits[0]
  const openStart = from + m.index
  const tag = tagHint || (/<([a-z0-9]+)\b/i.exec(m[0]) || [])[1] || 'span'
  const openEnd = html.indexOf('>', openStart)
  const closeStart = html.indexOf(`</${tag}>`, openEnd + 1)
  if (openEnd < 0) return { count: hits.length, why: '开标签损坏' }
  return { count: hits.length, openStart, openEnd: openEnd + 1, closeStart: closeStart < 0 ? html.length : closeStart, tag }
}

export function domTarget(html, sel) {
  const s = String(sel || '').trim()
  if (!s) return { count: 0, why: '空 selector' }

  const fcTwo = /^(.+?):first-child\s+(.+)$/.exec(s)          // `X:first-child target`
  const fcOne = /^(.+?):first-child$/.exec(s)                 // `X:first-child`
  const desc = /^([A-Za-z0-9_.-]+)\s+([A-Za-z0-9_.-]+)$/.exec(s) // `ancestor target`
  const pageNoOf = (openStart) => html.slice(0, openStart).split(/<section\b/).length - 1   // ★ 减 1（首段在 section 之前）

  if (fcOne) {
    const r = firstRegion(html, fcOne[1])
    if (!r.count) return { count: 0, why: r.why }
    return { count: 1, pageNo: pageNoOf(r.openStart), openEnd: r.openEnd, closeStart: r.closeStart, tag: r.tag }
  }
  if (fcTwo) {
    const outer = firstRegion(html, fcTwo[1])
    if (!outer.count) return { count: 0, why: outer.why }
    const inner = firstRegion(html, fcTwo[2], outer.openEnd, outer.closeStart)
    if (!inner.count) return { count: 0, why: `「${fcTwo[1]}:first-child」内找不到目标「${fcTwo[2]}」` }
    return { count: inner.count, pageNo: pageNoOf(inner.openStart), openEnd: inner.openEnd, closeStart: inner.closeStart, tag: inner.tag }
  }
  if (desc) {
    const anc = firstRegion(html, desc[1])
    if (!anc.count) return { count: 0, why: anc.why }
    /* 窗口 = 祖先后到**下一个 `<section`**（不用祖先后close：嵌套 div 的第一个 `</div>` 常常在目标之前 ⇒ 实测窗口过小）*/
    const nextSec = html.indexOf('<section', anc.openStart + 1)
    const windowEnd = nextSec < 0 ? html.length : nextSec
    const t = firstRegion(html, desc[2], anc.openEnd, windowEnd)
    if (!t.count) return { count: 0, why: `「${desc[1]}」后找不到目标「${desc[2]}」` }
    return { count: t.count, pageNo: pageNoOf(t.openStart), openEnd: t.openEnd, closeStart: t.closeStart, tag: t.tag }
  }
  const r = firstRegion(html, s)
  if (!r.count) return { count: 0, why: r.why }
  return { count: r.count, pageNo: pageNoOf(r.openStart), openEnd: r.openEnd, closeStart: r.closeStart, tag: r.tag }
}

/** 解析 HTML 里的命中计数（供量表的"唯一命中"断言直接复用） */
export function countBySelector(html, sel) {
  return domTarget(html, sel).count
}

/* ---------- 自带 CLI **自证**（避免 shell 引号地狱、也不必写临时脚本）----------
   用法：`node dom-target.mjs <产物目录> <selector>` ⇒ 打印 count / pageNo / tag / why / 内文前 60 字
        `node dom-target.mjs --selftest` ⇒ **常驻负控**：断言 token 匹配与裸子串匹配给出**不同页**（见下） */
const FIXTURE = [
  '<body>',
  '<section id="s1"><div class="tex">纹理</div><div class="progress"><i></i></div></section>',
  '<section id="s2"><ul><li><span class="t">首条</span></li><li><span class="t">次条</span></li></ul><div class="p2-sum">小结</div></section>',
  '<section id="s3"><div class="p3-body">解释</div></section>',
  '<section id="s4"><div class="p4-cta">CTA</div></section>',
  '</body>',
].join('\n')

/** 常驻负控：把"两个实战缺陷"钉成断言（team-lead ①）。
 *  缺陷 A：裸子串找页（`.t` 撞 `tex`）⇒ 必须与 token 匹配给出**不同页**；
 *  缺陷 B（我首版修法）：token 正则用 `^|\s` 做前边界（无 `m` 标志 ⇒ `^` 只匹配整串开头）⇒ **首个 class 都不匹配** ⇒ 全 null。 */
export function selfTest() {
  const bad = []
  const t = domTarget(FIXTURE, 't')
  const tex = domTarget(FIXTURE, 'tex')
  const sub = domTarget(FIXTURE, 'p2-sum')
  const li = domTarget(FIXTURE, 'li:first-child .t')
  const body = domTarget(FIXTURE, 'p3-body')
  // ① token 匹配：`.t` ⇒ 页 2（不是页 1）；`.tex` ⇒ 页 1 —— **两者不同页**（裸子串会都把 `.t` 判成页 1）
  if (t.pageNo !== 2) bad.push(`.t 应判为页 2，实际 ${t.pageNo}（裸子串/坏正则的典型症状）`)
  if (tex.pageNo !== 1) bad.push(`.tex 应判为页 1，实际 ${tex.pageNo}`)
  const bareSub = FIXTURE.split(/<section\b/).slice(1).findIndex((s) => s.includes('t')) + 1   // 旧实现（裸子串）
  console.log(`  对照：裸子串实现会把 .t 判成页 ${bareSub}；token 实现判成页 ${t.pageNo} ⇒ ${bareSub !== t.pageNo ? '**两者不同 ✓（缺陷 A 被钉住）**' : '✗ 未区分（断言无效）'}`)
  if (bareSub === t.pageNo) bad.push('裸子串与 token 匹配给出同一页 ⇒ 负控无效（说明 fixture 没覆盖该缺陷）')
  // ② 命中数：`.t` 在 fixture 里 2 个 ⇒ 唯一命中断言应能拒绝（调用方 exit 2）
  if (t.count !== 2) bad.push(`fixture 里 .t 应有 2 个，实际 ${t.count}`)
  if (sub.count !== 1 || body.count !== 1) bad.push('唯一形态的 count 应为 1')
  // ③ 首版修法（`^|\s` 前边界）会把**首个 class** 判成"找不到" ⇒ 这里钉住"首个 class 必须能命中"
  if (!li.count || li.pageNo !== 2) bad.push(`「li:first-child .t」应命中页 2，实际 ${li.pageNo}/${li.count}`)
  // ④ 反控：把 token 正则换成坏形状（模拟首版）⇒ 必须失败（证明负控能失败）
  const badRe = new RegExp('class="[^"]*(?:^|\\s)tex(?:\\s|")')
  if (badRe.test(FIXTURE)) bad.push('坏形状正则（无 m 标志用 ^ 前边界）竟然命中了 ⇒ 负控失效')
  /* ★★ msg31 ④：**CSS 子集**的合成自测 —— ① 组合器必须命中**预期条数**（正控）② **不支持的语法必须 `ok:false`**
     （负控；**不许静默 0** —— 那正是咬过我们的那口）。免渲染、秒级。 */
  /* ⚠️ fixture **必须能区分"子代"与"后代"**：第一版两者都 2（没嵌套）⇒ **抓住 bug 的能力为零** ——
     我那个"组合器取错侧"的 bug（`>` 被当后代 ⇒ 真实产物 6 而非 2）**它照样通过** ✗ ⇒ 现嵌一层：子代 2 / 后代 3。 */
  const cssSrc = '<section><div class="p3-metrics"><div>a<div>x</div></div><div>b</div></div><div class="other"><div>c</div></div></section>'
  const c1 = countCss(cssSrc, 'div.p3-metrics > div')
  const c2 = countCss(cssSrc, 'div.p3-metrics div')
  const c3 = countCss(cssSrc, '.p3-metrics > div:first-child')
  const c4 = countCss(cssSrc, 'div.p3-metrics > div:nth-child(2)')
  const c5 = countCss(cssSrc, 'div + div')
  const c6 = countCss(cssSrc, 'div:not(.p3-metrics)')
  if (!c1.ok || c1.count !== 2) bad.push(`组合器（**子代**）应命中 2，实际 ${JSON.stringify(c1)}`)
  if (!c2.ok || c2.count !== 3) bad.push(`组合器（**后代**）应命中 3（子代 2 + 孙 1 ⇒ **必须与子代不同**，否则 fixture 抓不住取错侧的 bug），实际 ${JSON.stringify(c2)}`)
  if (!c3.ok || c3.count !== 1) bad.push(`:first-child 应命中 1，实际 ${JSON.stringify(c3)}`)
  if (!c4.ok || c4.count !== 1) bad.push(`:nth-child(2) 应命中 1，实际 ${JSON.stringify(c4)}`)
  if (c5.ok || c6.ok) bad.push('不支持的语法（`+` / `:not()`）竟然 ok:true ⇒ **必须 ok:false**（不许静默 0）')
  console.log(`  CSS 子集对照：子代=${JSON.stringify(c1)} · 后代=${JSON.stringify(c2)} · :first-child=${JSON.stringify(c3)} · :nth-child(2)=${JSON.stringify(c4)} · 不支持(+)⇒ok=${c5.ok}（须 false）`)
  return bad
}

/* ---------- ★★ team-lead msg29 ① / msg31 ④：`--sel` 的 **CSS 选择器子集**（data / compare 两叶需要**组合器**）----------
   为什么"只增不改"：`domTarget` 的语义是**本工具约定**（`:first-child` = 首个匹配 · 祖先 = 窗口搜索），
   那是 crosscheck / measure-sweep 的**承重约定** ⇒ 不许动它。这里给"**按选择器计数**"补真组合器能力。
   ★ **最关键的一条**：不支持的语法 ⇒ 返回 `{ ok:false, why }`，由调用方**判红** —— **绝不静默返回 0**
     （静默 0 正是咬过我们的那口：选择器不被支持时"页内=0/全篇=0"看起来像读数）。
   支持（白名单）：复合 `tag` / `.class` / `tag.class`（多 class）· 组合器 **后代（空格）与子代（`>`）**
     · 伪类 `:first-child` / `:nth-child(n)` · 属性 `[attr]` / `[attr="v"]`。其余（`+` `~` `*` `:not()` `::` 等）⇒ 不支持。 */

const VOID_TAGS = new Set(['img', 'br', 'hr', 'input', 'source', 'track', 'wbr', 'meta', 'link'])
const CSS_OK_CHARS = /^[a-zA-Z0-9_.#:>\-\s[\]="'()]+$/
const CSS_UNSUPPORTED = /(\+|\*|::|:not\(|:nth-of-type|:last-child|:hover|~)/

/** 把 HTML 解析成**轻量节点树**（只做标签栈；不建完整 DOM）。返回 `{ nodes, root }`，节点含 `tag/attrs/parent/children` */
export function parseNodes(html) {
  const nodes = []
  const stack = []
  const re = /<(\/?)([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g
  let m
  while ((m = re.exec(html))) {
    const [, close, tag, attrs] = m
    const t = tag.toLowerCase()
    if (!close) {
      const node = { tag: t, attrs: attrs || '', parent: stack.length ? stack[stack.length - 1] : null, children: [] }
      nodes.push(node)
      if (node.parent) node.parent.children.push(node)
      if (!VOID_TAGS.has(t) && !/\/\s*$/.test(attrs || '')) stack.push(node)
    } else {
      for (let i = stack.length - 1; i >= 0; i--) if (stack[i].tag === t) { stack.length = i; break }
    }
  }
  return nodes
}

/** 解析选择器为 `[{ combinator:' '|'>', compound:{tag,classes,attrs,pseudos} }]`；不支持 ⇒ `null`（调用方判红） */
export function parseSelector(sel) {
  const s = String(sel || '').trim()
  if (!s || !CSS_OK_CHARS.test(s) || CSS_UNSUPPORTED.test(s)) return null
  const parts = []
  let cur = ''
  let depth = 0
  let pending = ''      /* 紧邻左侧的组合器（'' = 后代） */
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '[') depth++
    if (ch === ']') depth--
    if (depth === 0 && (ch === '>' || /\s/.test(ch))) {
      if (cur.trim()) parts.push({ combinator: pending || ' ', compound: parseCompound(cur.trim()) })
      /* ⚠️ **只在刚 push 完一个复合选择器时**更新 `pending`（`>` 记给**下一个**复合选择器）。
         实测踩过：`'a > b'` 里 `>` 之后还有空白 ⇒ 若每次空白都重设 pending ⇒ `>` 被后来的空格**覆盖成后代** ✗
         （症状：`div.p3-metrics > div` 得 3、写成无空格的 `div.p3-metrics>div` 得 2 —— **两种写法不一致**）。 */
      if (cur.trim()) {
        cur = ''
        const rest = s.slice(i).replace(/^\s+/, '')
        if (rest[0] === '>') { pending = '>'; i += s.slice(i).indexOf('>') } else pending = ' '
      }
      continue
    }
    cur += ch
  }
  if (cur.trim()) parts.push({ combinator: parts.length ? (pending || ' ') : ' ', compound: parseCompound(cur.trim()) })
  if (!parts.length || parts.some((p) => !p.compound)) return null
  parts[0].combinator = ' '      /* 最左的复合选择器不依赖左侧 */
  return parts
}

function parseCompound(c) {
  const todo = String(c)
  const out = { tag: null, classes: [], attrs: [], pseudos: [] }
  const attrRe = /\[([\w-]+)(?:([~^$*|]?=)\s*"?([^\]"]*)"?)?\]/g
  let rest = todo.replace(attrRe, (_, k, op, v) => { out.attrs.push({ k, op: op || null, v: v || null }); return ' ' })
  const pseudoRe = /:(first-child|nth-child\((\d+)\))/g
  rest = rest.replace(pseudoRe, (_, p, n) => { out.pseudos.push(n ? { nth: Number(n) } : { first: true }); return ' ' })
  for (const tok of rest.split(/\s+/).filter(Boolean)) {
    const m = /^([a-zA-Z][\w-]*)?((?:\.[\w-]+)+)?$/.exec(tok)
    if (!m) return null
    if (m[1]) { if (out.tag) return null; out.tag = m[1].toLowerCase() }
    for (const cl of (m[2] || '').split('.').filter(Boolean)) out.classes.push(cl)
  }
  if (!out.tag && !out.classes.length && !out.attrs.length && !out.pseudos.length) return null
  return out
}

function matchCompound(node, cp) {
  if (!cp) return false
  if (cp.tag && node.tag !== cp.tag) return false
  const cls = /class="([^"]*)"/.exec(node.attrs || '')
  const tokens = cls ? cls[1].split(/\s+/).filter(Boolean) : []
  for (const c of cp.classes) if (!tokens.includes(c)) return false
  for (const a of cp.attrs) {
    if (!new RegExp(`\\b${a.k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:=("[^"]*"|'[^']*'|[^\\s>]*))?`).test(node.attrs || '')) return false
    if (a.op === '=') { const get = new RegExp(`\\b${a.k}\\s*=\\s*"?([^"\\s>]*)"?`).exec(node.attrs || ''); if (!get || get[1] !== a.v) return false }
  }
  for (const p of cp.pseudos) {
    const sibs = node.parent ? node.parent.children : [node]
    const idx = sibs.indexOf(node) + 1
    if (p.first && idx !== 1) return false
    if (p.nth !== undefined && idx !== p.nth) return false
  }
  return true
}

/** 按**选择器子集**计数。返回 `{ ok, count, why }`：`ok:false` ⇒ 语法**不被支持**（调用方必须判红，不许当 0） */
export function countCss(html, sel) {
  const chain = parseSelector(sel)
  if (!chain) return { ok: false, count: 0, why: `选择器「${sel}」不在受支持子集内（支持：tag/.class/后代/` + '>' + `/ :first-child / :nth-child(n) / [attr]=v；其余请改用受支持形态而不是静默 0）` }
  const nodes = parseNodes(html)
  const last = chain[chain.length - 1].compound
  let n = 0
  for (const node of nodes) {
    if (!matchCompound(node, last)) continue
    let cur = node
    let ok = true
    for (let i = chain.length - 2; i >= 0; i--) {
      /* ⚠️ **组合器属于右侧复合选择器**（实测踩过：用左侧 ⇒ `>` 被当成"后代" ⇒ 把子孙也算进来 ⇒
         `div.p3-metrics>div` 过匹配成 6（应 2）——"看着有结果"的错读数，比 0 更危险）。 */
      const combinator = chain[i + 1].combinator
      const { compound } = chain[i]
      if (combinator === '>') { cur = cur.parent; if (!cur || !matchCompound(cur, compound)) { ok = false; break } }
      else {
        let up = cur.parent
        let hit = null
        while (up) { if (matchCompound(up, compound)) { hit = up; break } up = up.parent }
        if (!hit) { ok = false; break }
        cur = hit
      }
    }
    if (ok) n++
  }
  return { ok: true, count: n }
}

if (process.argv[1] && process.argv[1].endsWith('dom-target.mjs')) {
  const { readFileSync } = await import('node:fs')
  const { join } = await import('node:path')
  const argv = process.argv.slice(2)
  if (argv[0] === '--selftest') {
    const bad = selfTest()
    console.log(bad.length ? `✗ dom-target 自检失败（${bad.length} 条）：\n  · ${bad.join('\n  · ')}` : '✓ dom-target 自检通过（缺陷 A：裸子串 vs token 不同页 · 缺陷 B：首个 class 可命中 · 唯一命中计数正确）')
    process.exit(bad.length ? 1 : 0)
  }
  const [dirArg, selArg] = argv
  if (dirArg && selArg) {
    const html = readFileSync(join(dirArg, 'index.html'), 'utf8')
    const r = domTarget(html, selArg)
    console.log(JSON.stringify({ selector: selArg, count: r.count, pageNo: r.pageNo ?? null, tag: r.tag ?? null, why: r.why || null }))
    if (r.openEnd) console.log('  内文前 60 字 =', html.slice(r.openEnd, r.openEnd + 60).replace(/<[^>]+>/g, '').replace(/\s+/g, ' '))
  } else {
    console.log('用法: node dom-target.mjs <产物目录> <selector>  |  node dom-target.mjs --selftest')
  }
}
