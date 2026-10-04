/* deck-jsonpath.mjs —— ★ **deck 数据路径（jsonpath）语义的唯一实现**
 *
 * ⚠️⚠️ 本仓有**三套"路径"语言**，各住各的模块 ⇒ **永不合并**（同族不同味）：
 *   ① **文件系统路径** —— `paths.mjs`（`DECK_DIR` / `MASTERS_DIR` / `FONTS_DIR` / `EXAMPLES_DIR` / `SCHEMA` / `OUT_DIR`
 *      + `LAYOUT = flat|bridge-dev` 双布局探测）；它的自述原文是"**引擎路径的唯一来源**"；
 *   ② **deck 数据路径（jsonpath）** —— **本模块**：`pages.<i>.<a>.<b>`（0-based 页下标 + **任意层**字段）；
 *   ③ **schema JSON Pointer** —— `#/…`（`check-schema-vs-limits` 表内的 `jsonPointer`）⇒ **另行处理，本模块不碰**。
 *   ⇒ 将来若有人想把三者合并：先答清"**这条路径的根是什么**"（文件系统 / 一份 deck 对象 / 一份 schema 对象）。
 *
 * 判据（消费方必须遵守）：
 *   · `pages.` 的**解析**只许出现在本模块（**出现次数断言**在 `check-schema-vs-limits`）—— 此前页下标正则**散在 3 处**
 *     （`measure-count` 两处 + `check-schema-vs-limits` 一处）⇒ 与 K17 同族（"同一逻辑多份 ⇒ 只改一处 ⇒ 静默分叉"）。
 *   · **只认结构、不猜**：底档没有 pages / 页不存在 / holder 某层不是对象 / **末段不是数组** ⇒ 返回 `{ok:false, why}`
 *     ⇒ 调用方**停手**（exit 2），不许 crash、不许猜。
 *   · ★★ **读点 = 写点**：`parseDeckPath()` 同时给出 `holder`（**对象引用**）与 `leaf`（键名）⇒ **读**与**注入写**
 *     用**同一个解析结果** ⇒ "读穿嵌套、写回顶层"这类假绿在**结构上**不可能发生（team-lead ② 的往返断言前提）。
 *
 * 本模块**无顶层副作用**（纯函数 + 仅当被直接执行时才跑自测）⇒ 可安全被 CLI 工具 import。
 */

/** 解析 `pages.<i>.<a>.<b>…` ⇒ `{ ok, pageIndex, segs, holder, leaf, why }`
 *  · `holder` = 倒数第二层所在的**对象引用**（注入写就用它）· `leaf` = 末段键名（其值应为**数组**）
 *  ⚠️ 纯函数：不读文件、不 exit（"停手"与报错文案由调用方决定 ⇒ 同一语义、不同工具可有不同工艺）。 */
export function parseDeckPath(root, jsonpath) {
  const m = /^pages\.(\d+)\.(.+)$/.exec(String(jsonpath || ''))
  if (!m) return { ok: false, why: `不是 pages.<i>.<字段>… 形态：${jsonpath}` }
  const pageIndex = Number(m[1])
  const segs = m[2].split('.')
  if (!root || !Array.isArray(root.pages)) return { ok: false, why: '底档没有 pages 数组' }
  const page = root.pages[pageIndex]
  if (page === undefined || page === null || typeof page !== 'object' || Array.isArray(page)) {
    return { ok: false, why: `pages[${pageIndex}] 不存在或不是对象` }
  }
  const holderSegs = segs.slice(0, -1)
  let holder = page
  for (const s of holderSegs) {
    const nxt = holder[s]
    if (nxt === undefined || nxt === null || typeof nxt !== 'object' || Array.isArray(nxt)) {
      return { ok: false, why: `holder 路径 pages[${pageIndex}].${holderSegs.join('.')} 里「${s}」不存在或不是对象` }
    }
    holder = nxt
  }
  const leaf = segs[segs.length - 1]
  if (!Array.isArray(holder[leaf])) {
    return { ok: false, why: `末段「${leaf}」不是数组（= ${holder[leaf] === undefined ? 'undefined' : typeof holder[leaf]}）` }
  }
  return { ok: true, pageIndex, segs, holder, leaf }
}

/** 只取 0-based 页下标 —— 替代此前**散在 3 处**的 `/^pages\.(\d+)\./`（含 `--jsonpath\s+…` 变体）。
 *  · 解析失败 ⇒ `null`（调用方自定红/停手口径） */
export function pageIndexOf(jsonpath) {
  const m = /^pages\.(\d+)\./.exec(String(jsonpath || ''))
  return m ? Number(m[1]) : null
}

/** ★ **可肉眼审计的"解释行"**（team-lead ②(9)）：证明"**读点 = 人看得出的那一层**"，而不是只有程序知道。
 *  例：`pages.5.left.points ⇒ holder=pages[5].left · leaf=points · 量到 3（期望 3）` */
export function describeDeckPath(jsonpath, parsed, measured, expected) {
  if (!parsed || !parsed.ok) return `${jsonpath} ⇒ **无法解析**：${parsed?.why || '?'}`
  const holderPath = `pages[${parsed.pageIndex}]` + (parsed.segs.length > 1 ? '.' + parsed.segs.slice(0, -1).join('.') : '')
  const tail = measured === undefined ? '' : ` · 量到 ${measured}${expected === undefined ? '' : `（期望 ${expected}）`}`
  return `${jsonpath} ⇒ holder=${holderPath} · leaf=${parsed.leaf}${tail}`
}

/* ---- 自测（仅直接执行本文件时跑；被 import 时**零副作用**）：
 *  team-lead ②(10) 四例：嵌套有效 / holder 缺失 ⇒ 停手 / **末段是对象不是数组 ⇒ 停手（与前一例不同错因）** / 两层回归
 *  + 一例：`pageIndexOf` 与解析**同源**（替换掉散在 3 处的正则后不至于两套口径） ---- */
if (process.argv[1] && String(process.argv[1]).replace(/\\/g, '/').endsWith('deck-jsonpath.mjs')) {
  const cases = []
  const chk = (name, cond) => { cases.push(cond); console.log(`   ${cond ? '✓' : '✗'} ${name}`) }
  const root = { pages: [{}, {}, {}, {}, {}, { left: { points: ['a', 'b', 'c'] }, right: { points: ['x'] }, steps: ['s1'] }] }
  const p1 = parseDeckPath(root, 'pages.5.left.points')
  chk('① 嵌套路径有效 ⇒ holder=pages[5].left（对象引用）· leaf=points', p1.ok && p1.pageIndex === 5 && p1.leaf === 'points' && p1.holder === root.pages[5].left)
  chk('② **holder 缺失** ⇒ 停手信号 ok:false（不抛、不猜）', parseDeckPath(root, 'pages.5.nope.points').ok === false)
  chk('③ **末段是对象不是数组** ⇒ 停手信号（**与 ② 不同错因**）', parseDeckPath(root, 'pages.5.left').ok === false)
  chk('④ 两层路径行为不变（回归：pages.<i>.<数组>）', parseDeckPath(root, 'pages.5.steps').ok === true)
  chk('⑤ pageIndexOf 与解析**同源**（两层/嵌套/非法 三态一致）',
    pageIndexOf('pages.5.left.points') === 5 && pageIndexOf('pages.0.items') === 0 && pageIndexOf('不是路径') === null)
  chk('⑥ 解释行可肉眼审计（含 holder 层与 leaf）', /holder=pages\[5\]\.left · leaf=points/.test(describeDeckPath('pages.5.left.points', p1, 3, 3)))
  const fail = cases.filter((x) => !x).length
  console.log(`   ${fail === 0 ? '✓' : '✗'} [DECK-JSONPATH-SELFTEST] 用例=${cases.length} · 失败=${fail}`)
  process.exit(fail === 0 ? 0 : 1)
}
