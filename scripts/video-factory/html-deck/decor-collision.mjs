/** decor-collision.mjs —— **装饰×内容碰撞判据的唯一实现**
 *
 * 判据（team-lead 裁定 A 的配套）：**装饰白名单 ∩ 内容盒 > 0 ⇒ 红**，码名 `decor_content_collision`。
 *
 * 数据来源：引擎 layout finding `text_occluded`。
 *   · 几何由引擎算（我们不重复实现像素几何 —— 那是引擎的强项）；
 *   · `containerSelector` = **遮挡者**（实测定案：把 `.progress` 临时 `display:none` 后该 finding **消失**，
 *     而 `.progress` 并不是被遮文字 `p.cover-sub` 的容器 ⇒ 它是遮挡者）。字段名有歧义，故此处写明依据。
 *
 * 分类：
 *   ① 遮挡者命中 `allowlist-decor.json`（我们自己的装饰/覆盖层）⇒ `decor_content_collision`（**判据码，红**）；
 *   ② 未命中 ⇒ 仍留在**观察清单**（只记录 + 计数，不判红）—— 这是**独立锚点交叉校验**：
 *      若我们判"无装饰碰撞"而引擎仍报 `text_occluded` ⇒ 说明**装饰白名单不全**（调用方打印提醒）。
 *
 * ★ 为什么必须"唯一实现"：闸门与量表若各写一套，"内容上限"就会用比闸门更严/更松的判据 ⇒
 *   我们已经吃过一次 `content_overlap` 分叉（team-lead ③）。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

/** 本判据的码名（闸门/量表/表里都应引用这个常量，别各写字符串） */
export const DECOR_CODE = 'decor_content_collision'
/** 引擎侧"遮挡"类码（当前只有这一个；将来引擎加码时在此登记，两侧同时生效） */
const OCCLUSION_CODES = ['text_occluded']

/** 读装饰白名单（默认同目录 `allowlist-decor.json`；每条须有 selector + reason） */
export function decorAllowList(file) {
  const p = file || join(HERE, 'allowlist-decor.json')
  if (!existsSync(p)) return []
  try { return (JSON.parse(readFileSync(p, 'utf8')).allow || []) } catch { return [] }
}

/** 把引擎 findings 分类为 { collisions, nonDecor, counts }（两侧**同一实现**） */
export function classifyOcclusions(findings, allow) {
  const list = allow || decorAllowList()
  const hit = (sel) => list.find((a) => a.selector && String(sel || '').includes(a.selector))
  const collisions = [], nonDecor = []
  for (const f of (findings || [])) {
    if (!f || !OCCLUSION_CODES.includes(String(f.code || ''))) continue
    const occluder = String(f.containerSelector || '')
    const a = hit(occluder)
    if (a) collisions.push({ ...f, code: DECOR_CODE, engineCode: f.code, occluder, decor: a.selector, decorReason: a.reason })
    else nonDecor.push({ ...f, occluder })
  }
  return {
    collisions,
    nonDecor,
    counts: { occlusions: collisions.length + nonDecor.length, collisions: collisions.length, nonDecor: nonDecor.length },
  }
}

/** 交叉校验提醒文本（无装饰碰撞但引擎仍报非装饰遮挡 ⇒ 白名单可能不全）；两条都不报 ⇒ null */
export function crossCheckNote(counts) {
  if (!counts || counts.collisions > 0) return null
  if (counts.nonDecor > 0) return `交叉校验：我们判**无装饰碰撞**，而引擎报 ${counts.nonDecor} 条 \`text_occluded\`（遮挡者不在装饰白名单）⇒ **白名单可能不全**（逐条见观察清单）`
  return null
}
