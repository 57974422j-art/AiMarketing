/** timing.mjs —— **稳定帧时序的唯一实现**（team-lead ②：时刻不许硬编码、不许两处各写一套）
 *
 * 现状（收口前）：`check-engine-lint.mjs` 有一份"自述唯一实现"，`check-coverage-matrix.mjs` 有**第二份副本**
 *   （它自己注释就写着「第 2 处实现 …待办」），`measure-sweep.mjs` 更是**硬编码 `--at 1.0`**。
 *   ⇒ 三处口径可能漂移 ⇒ 抽到本模块，三处**只 import**。
 *
 * 契约公式（**稳定帧**）：`min( max(入场收尾, 页长 × PAGE_SETTLE_FRACTION), 下一页淡入前 − NEXT_FADE_MARGIN_S )`，
 *   其中"入场收尾" = `start + 该页内最大 data-at + ENTER_TAIL_S`；末页 cap = `start + dur − TAIL_MARGIN_S`。
 *   违约（落在页外 / 距下一页淡入过近）⇒ 返回 `violation` 说明（调用方判红或打印）。
 *
 * ★ 四个常数**必须具名分开**（team-lead ①）：`ENTER_TAIL_S` 与 `PAGE_SETTLE_FRACTION` 数值相同**纯属巧合** ——
 *   合用一个 `0.6` 会让"下一个人调 A 顺手改掉 B"。改任何一个都必须**显式**改对应的具名常数。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { domTarget } from './dom-target.mjs'

/* ---------- 四个具名常数（含义各不相同；数值巧合不代表可合并） ---------- */
/** A. 入场收尾（秒）：`start + max(data-at) + ENTER_TAIL_S` = 本页所有入场动画名义完成时刻 */
export const ENTER_TAIL_S = 0.6
/** B. 页长沉降比例：`start + dur × PAGE_SETTLE_FRACTION` = 不依赖 data-at 的兜底沉降点 */
export const PAGE_SETTLE_FRACTION = 0.6
/** C. 下一页淡入的安全余量（秒）：cap = `next.start − NEXT_FADE_MARGIN_S` */
export const NEXT_FADE_MARGIN_S = 0.15
/** D. 末页页尾余量（秒）：cap = `start + dur − TAIL_MARGIN_S`（末页没有下一页） */
export const TAIL_MARGIN_S = 0.1

/** 从产物 HTML 解析每页时序：`start` / `dur` / 该页内最大 `data-at` */
export function timingTable(dirPath) {
  const f = join(dirPath, 'index.html')
  const html = existsSync(f) ? readFileSync(f, 'utf8') : ''
  const t = []
  html.split(/<section\b/).slice(1).forEach((s, idx) => {
    const head = s.slice(0, s.indexOf('>') + 1)
    const start = Number((head.match(/data-start="([\d.]+)"/) || [])[1] || 0)
    const dur = Number((head.match(/data-duration="([\d.]+)"/) || [])[1] || 0)
    const ats = [...s.matchAll(/data-at="([\d.]+)"/g)].map((m) => Number(m[1]))
    t.push({ i: idx + 1, start, dur, maxAt: ats.length ? Math.max(...ats) : 0 })
  })
  return t
}

/** 稳定帧时刻（**契约公式**）：返回 `{ p, next, at, violation }`；页号不存在 ⇒ null */
export function settledAt(dirPath, no, table) {
  const t = table || timingTable(dirPath)
  const p = t[no - 1]
  if (!p) return null
  const next = t[no] || null
  const enterEnd = p.start + p.maxAt + ENTER_TAIL_S
  const want = Math.max(enterEnd, p.start + p.dur * PAGE_SETTLE_FRACTION)
  const cap = next ? next.start - NEXT_FADE_MARGIN_S : p.start + p.dur - TAIL_MARGIN_S
  const at = Math.min(want, cap)
  const violation = !(at > p.start + 1e-6 && at < p.start + p.dur - 1e-6)
    ? `settledAt=${at.toFixed(3)}s 不在本页 [${p.start}, ${(p.start + p.dur).toFixed(2)}) 内`
    : (next && at > next.start - NEXT_FADE_MARGIN_S + 1e-6) ? `settledAt=${at.toFixed(3)}s 距下一页淡入(${next.start}s) < ${NEXT_FADE_MARGIN_S}s` : null
  return { p, next, at, violation }
}

/** 全页稳定帧时刻列表（字符串数组，供 `--at a,b,c` 用） */
export function settledAtList(dirPath, table) {
  const t = table || timingTable(dirPath)
  return t.map((_, idx) => settledAt(dirPath, idx + 1, t).at.toFixed(3))
}

/** 采样时刻是否落在**过渡帧**内（程序化；唯一实现） */
export function transitionAt(dirPath, time, table) {
  const t = table || timingTable(dirPath)
  const tt = Number(time)
  const p = t.find((q) => tt >= q.start - 1e-6 && tt < q.start + q.dur + 1e-6)
  if (!p) return null
  const next = t[t.indexOf(p) + 1] || null
  const enterEnd = p.start + p.maxAt + ENTER_TAIL_S
  if (tt < enterEnd) return { p, next, how: `本页入场：t < start(${p.start}) + max(data-at)(${p.maxAt}) + ${ENTER_TAIL_S} = ${enterEnd.toFixed(2)}` }
  if (next && tt >= next.start - 1e-6) return { p, next, how: `页尾交叉淡入：下一页 data-start=${next.start}s 起淡入，而 t=${time} ≥ ${next.start}` }
  return null
}

/** 某时刻所属页（工具函数） */
export function pageOfTime(table, t) {
  return table.find((p) => Number(t) >= p.start - 1e-6 && Number(t) < p.start + p.dur + 1e-6) || null
}

/** 元素所属页号（从产物 HTML 找该 selector 所在的第几个 `<section>`；找不到 ⇒ null）
 *  ⚠️ **必须按 class token 匹配，不许裸子串**（2026-10-03 实战抓出的缺陷）：
 *  原先写 `secs[i].includes(cls)` ⇒ 单字母 class（如 `.t`）会**撞上 `tex`/`text` 等** ⇒ 判成**封面页**
 *  ⇒ 稳定帧取错页 ⇒ 注入的溢出在那一帧不可见 ⇒ **正控失败（超长都不报）**，看起来像"量具失效"。
 */
export function pageNoOfSelector(dirPath, selector) {
  const f = join(dirPath, 'index.html')
  if (!existsSync(f)) return null
  /* ★ 委托 **DOM 目标定位的唯一实现**（`dom-target.mjs`）：支持唯一形态（如 `li:first-child .t`）并自带命中计数；
     这里只取"所属页号"。**不许**再在本文件里写第二套匹配（那正是上一版裸子串撞 `tex` 的来源）。 */
  const r = domTarget(readFileSync(f, 'utf8'), selector)
  return r && r.pageNo ? r.pageNo : null
}
