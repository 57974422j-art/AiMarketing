/**
 * ★VF_SPEC_V2：让 AI 自己规划"风格语法"（**开关默认关闭**）
 * =============================================================================
 * 用户 2026-10-10 定案：「加开关默认关闭；开启后 AI 制作；**不要把现在的又搞坏了**」。
 *
 * · **关（默认）⇒ 零行为变化**：不调模型、不传 spec，整条线走的还是 pack / 引擎默认语法。
 * · **开（`VF_FILM_AI_SPEC=1`）⇒ 在"排骨架"之前**多一次小模型调用，让它按素材气质声明
 *   L1 构图 / L2 动效 / L3 文本形态（layout / image / pacing / motion / text / gates）。
 *   为什么必须在骨架**之前**：`image.complete` 会决定 `arrange` 允不允许用 fullbleed（满屏裁切）——
 *   声明晚了，骨架与声明就打架，出片时会被 `stage=spec` 拒渲（这条在 2026-10-10 实测抓过）。
 * · 失败**不判死**：拿不到就退回"不给 spec"（= 现状行为），并在确认卡上如实说一句。
 * · 合法性**不靠模型自觉**：① 服务端**白名单按键**（`pickSpec`，多写的字段一律丢）；
 *   ② 数值/枚举由引擎 `normSpec`（film-to-page.mjs）**夹回并打印**；
 *   ③ 最终仍由引擎闸门兜底（字表 / 对比度 / 重叠 / 完整大图比例 / 规格自相矛盾）。
 *
 * 为什么单列成模块：开关语义与白名单必须能**脱离模型单测**
 * （`temp/_spec/test.mjs`：默认关 / 开启后只放行白名单键 / 垃圾输入不崩）。
 */

/** 开关：**每次调用都读 env**（测试可切、运维可热改；默认关） */
export function aiSpecEnabled(): boolean {
  return /^(1|true|on|yes)$/i.test(String(process.env.VF_FILM_AI_SPEC || ''))
}

/** 只允许这 6 组、这些键（与 `film-to-page.mjs` 的 SPEC_DEF 一一对应） */
export const SPEC_KEYS: Record<string, string[]> = {
  layout: ['system', 'whitespace'],
  image: ['place', 'complete'],
  pacing: ['minShotSec'],
  motion: ['img', 'ease', 'type', 'cross'],
  text: ['titleForm', 'ornament', 'weight', 'tracking', 'scale'],
  gates: ['minImageWidth'],
}

/** 白名单化：`{spec:{…}}` 或裸 `{…}` 都收；只留白名单键；一个可用键都没有 ⇒ null */
export function pickSpec(j: any): any | null {
  const src = (j && typeof j === 'object' && j.spec && typeof j.spec === 'object') ? j.spec : j
  if (!src || typeof src !== 'object') return null
  const out: any = {}
  let n = 0
  for (const g of Object.keys(SPEC_KEYS)) {
    const s = src[g]
    if (!s || typeof s !== 'object') continue
    const o: any = {}
    for (const k of SPEC_KEYS[g]) if (s[k] !== undefined && s[k] !== null) { o[k] = s[k]; n++ }
    if (Object.keys(o).length) out[g] = o
  }
  return n ? out : null
}

/** 一句话说清 AI 规划了什么（确认卡上给用户看，**别让它悄悄生效**） */
export function describeSpec(sp: any): string {
  const g = (a: string, k: string): string => (sp && sp[a] && sp[a][k] !== undefined ? String(sp[a][k]) : '')
  const rows: Array<[string, string]> = [
    ['排版', g('layout', 'system')], ['留白', g('layout', 'whitespace')],
    ['照片', g('image', 'place')],
    ['完整', (sp && sp.image && sp.image.complete !== undefined) ? (sp.image.complete ? '保证' : '可裁切') : ''],
    ['标题', g('text', 'titleForm')], ['字重', g('text', 'weight')],
    ['字距', g('text', 'tracking')], ['字号', g('text', 'scale')],
    ['入场', g('motion', 'img')], ['段间', g('motion', 'cross')],
  ]
  return rows.filter(([, v]) => v !== '').map(([k, v]) => k + '=' + v).join(' · ')
}

/** 给模型的"一页纸"：**只问风格语法**（不写文案 —— 文案是下一步自己的活） */
export function specPrompt(summary: string, n: number, topic: string): string {
  return '你是竖屏短片（9:16）的**视觉导演**。这批素材共 ' + n + ' 张实拍照片。\n'
    + (topic ? '主题：' + topic + '\n' : '')
    + (summary ? '【素材读图总结】\n' + String(summary).slice(0, 1200) + '\n' : '')
    + '\n请**只**规划"版式语法"（不要写文案、不要写分镜），只回一个 JSON：\n'
    + '{"spec":{"layout":{"system":"axis|grid|free","whitespace":0.08~0.55},'
    + '"image":{"place":"mat|mat-tape|fullbleed","complete":true|false},'
    + '"motion":{"img":"push|pop|fade","ease":"out|back|inout","type":"overlay|sticker|vertical","cross":0.06~0.8},'
    + '"text":{"titleForm":"overlay|sticker|vertical","ornament":"rule|tape|hairline|none","weight":100~900,"tracking":-0.04~0.2,"scale":0.7~1.4},'
    + '"gates":{"minImageWidth":0}}}\n'
    + '含义：system 排版骨架（axis 中轴 / grid 严格网格 / free 自由错位）；whitespace 留白（越大越疏）；\n'
    + 'place 照片呈现（mat 相纸不裁 / mat-tape 相纸+胶带 / fullbleed 满屏裁切）；\n'
    + 'complete=true 表示"这套风格**保证图片完整**"（此时别选 fullbleed）；\n'
    + 'titleForm 标题形态；weight/tracking/scale = 标题字重 / 字距 / 字号倍率。\n'
    + '硬规矩：① 只回 JSON，不要解释、不要 markdown 围栏；② **拿不准的键就别写**（会退回默认，不会出错）；\n'
    + '③ 不许编造数据/品牌；④ 自检"同一度"——别让每一页长得一样。'
}
