/**
 * ★VF_FILMCOPY_V5（2026-10-10 用户实测「段数 13 ≠ 14 ⇒ 整单不出片」）
 * =============================================================================
 * 病情：写文案的模型被要求"数组长度 = 段数"（**让它数够 N 个**），而 LLM 数数不可靠 ——
 *   用户这次勾了 18 张素材（骨架 14 段），模型只回了 13 段 ⇒ 老代码
 *   `got.length !== pl.scenes.length ⇒ 整批作废` ⇒ 重试仍少一段 ⇒ 降级又碰上"读图总结为空" ⇒ **没出片**。
 *
 * 现口径（**按段号归位，不数数**）：
 *   · 元素带 `i`（或 `index`）⇒ 放到第 i 段（**错位风险 = 0**）；
 *   · 没带 `i` ⇒ 退回"按顺序填"（只在数量正好时可信；多的算 extra、少的算缺口）；
 *   · 返回缺口清单 ⇒ 调用方**第二轮只补那几段**（补 1~2 段 ≫ 重写 N 段还要数对），
 *     补不齐的再由"读图拼句"**按段**兜底（并如实告知）。
 *
 * 为什么单列成模块：这段是"骨架 ↔ 文案"唯一对齐口径，必须能**脱离模型单测**
 *   （正反例 fixtures 见 `temp/_aligntest/`；不依赖 prisma/网络/模型）。
 */

export type SlotsArr = Array<Record<string, any> | null>

export type AlignResult = {
  /** 归位后的每段 slots（length = 段数；缺失为 null） */
  slots: SlotsArr
  /** 缺失的段号（0-based） */
  missing: number[]
  /** 多出来的元素个数（段号越界 / 重复占位） */
  extra: number
  /** 是否按段号归位（false = 退回按顺序填） */
  byIndex: boolean
}

/** 把模型回的元素归位到 N 个段上（**不改内容**，只决定谁属于哪段） */
export function alignCopy(got: any[], n: number): AlignResult {
  const out: SlotsArr = new Array(n).fill(null)
  const hasI = (Array.isArray(got) ? got : []).some((x) => x && typeof x === 'object' && (x.i !== undefined || x.index !== undefined))
  let extra = 0
  if (hasI) {
    for (const x of got) {
      const raw = (x && typeof x === 'object') ? (x.i !== undefined ? x.i : x.index) : undefined
      const k = Number(raw)
      if (Number.isInteger(k) && k >= 0 && k < n) { if (out[k]) extra++; out[k] = (x && x.slots) || {} }
      else extra++
    }
  } else {
    for (let k = 0; k < got.length; k++) {
      if (k < n) out[k] = (got[k] && got[k].slots) || {}
      else extra++
    }
  }
  const missing: number[] = []
  for (let k = 0; k < n; k++) if (!out[k]) missing.push(k)
  return { slots: out, missing, extra, byIndex: hasI }
}

/** 合并两轮结果：**有值就覆盖、空着就留**（第二轮"只补缺口"用） */
export function mergeSlots(a: SlotsArr | null, b: SlotsArr): SlotsArr {
  if (!a) return b
  return a.map((v, k) => v || b[k] || null)
}

/** ★VF_FILMCOPY_V6（2026-10-10 用户实测「文案：不是合法 JSON」）：
 *  段数一多（14~18 段），**一整份 JSON 的输出很长** ⇒ 很可能被**输出上限截断**，
 *  截断后括号不闭合 ⇒ `scanJson` 判"不是合法 JSON"（老实现整批作废）。
 *  现口径：**分批请求**（每批 ≤ `size` 段），每批独立重试 —— 单次输出短了，截断风险≈0，
 *  且"一批失败"不再拖垮其他批。返回每批的**段号**（不是数量），便于按 i 归位。 */
export function batchRanges(n: number, size = 6): number[][] {
  const out: number[][] = []
  const step = Math.max(1, Math.floor(size))
  for (let k = 0; k < n; k += step) {
    const b: number[] = []
    for (let j = k; j < Math.min(k + step, n); j++) b.push(j)
    out.push(b)
  }
  return out
}
