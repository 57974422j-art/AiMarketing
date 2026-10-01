/**
 * ★VF_BANNER_V1（2026-09-29 用户定案）——「顶部固定标题」（全程钉在画面顶部的那两行）
 *
 * 用户原话（本文件的设计依据）：
 *   「固定标题（你截图那种：黄字黑边 + 半透明色块白字，全程钉在顶部不动）……
 *     第 1 行颜色：随机颜色可以吗？位置固定全片。可选文案提炼，一切都要都可以默认这样后期集成自动化比较方便。」
 * 定案：**颜色随机（从主题色板里随机，不是任意随机）· 位置钉整片 · 文案默认由 AI 提炼（允许以后手动覆盖）· 默认开启**。
 *
 * 为什么要单独一个文件（照 i2v-plan.ts 的先例）：
 *   ① 提炼两行 / 截断 / emoji 清理 / 开关 全是**纯逻辑**，必须能被自测脚本直接跑
 *      （scripts/vf-banner-selftest.ts：ts-node 直接 import，不联网、不烧钱）；
 *   ② 出片侧有两条线要用它（「图视混剪」vf-video.ts 与「图片成片」chat/route.ts）——
 *      两处必须共用**同一份**截断长度 / 兜底规则 / 根级字段形状，否则迟早漂移。
 *
 * ⚠️ 契约（与渲染层 scripts/video-factory/render.py 的 ★VF_BANNER_V1 逐字对齐）：
 *   渲染层只读**分镜根级** `banner`：{ line1, line2, from, to }。
 *   · `from`/`to` 是 1-based 镜号；`to: 0`（或不给）= 钉到片尾 = 用户要的「钉全片」。
 *   · `banner: false` 或**缺失** = 不画 —— 所以必须由调用方**显式**传（本文件负责给出该字段）。
 *   · 颜色/底衬由渲染层从主题色板随机挑（`_banner_pick`），服务端**不发颜色**（那是渲染层的事）。
 */
import { stripEmoji, normalizeDeckStyle,
  // ★VF_STYLES_WIRE_V1（2026-10-01）：成品风格（5 套，人话名字）→ plan 根级 `style`。
  //   未指定/非法 → '' → **不写 style 键**（老链路 theme + deck_style 零回归）。
  normalizeStyle } from './anti-ai'

/** 第 1 行（钩子/主题）字数上限 —— 用户定案 ≤12 字 */
export const VF_BANNER_LINE1_MAX = 12
/** ★VF_BANNER_EMPTYLINE_V1（2026-10-01）：不可见字符表 —— 与渲染层 render.py 的 `_BANNER_INVIS`
 *  **逐字一致**（零宽 / BOM / 变体选择符 / 软连字符）。服务端漏了这一步 → 空行照进 plan。 */
export const VF_BANNER_INVIS = '\u200b\u200c\u200d\u200e\u200f\u2060\ufeff\ufe0e\ufe0f\u00ad'
/** 第 2 行（核心承诺/关键点）字数上限 —— 用户定案 ≤18 字 */
export const VF_BANNER_LINE2_MAX = 18
/** 规则兜底时第 1 行取首句前几字（比 AI 档更保守：兜底宁短不长） */
export const VF_BANNER_FALLBACK_LINE1 = 10
/** 规则兜底时第 2 行取次句前几字 */
export const VF_BANNER_FALLBACK_LINE2 = 16

/** 渲染层要的根级 banner 字段（from/to 为 1-based 镜号；to=0 → 到片尾）
 *  ★VF_BANNER_EMPTYLINE_V1（2026-10-01 用户实测「空色块」）：`line2` 改为**可选** ——
 *  只写非空行；两行都空时**根本不生成 banner**（根级没有 banner 字段）。 */
export interface VfBanner {
  line1: string
  line2?: string
  from: number
  to: number
}

/* ══════════ ★VF_BANNER_EMPTYLINE_V1（2026-10-01 用户实测：成片顶部出现"空色块"）══════════
 * 现象（用户报过两次；team-lead 抽帧放大定案）：
 *   `dist-rel/fixbase/top_t0020.png`：顶部白字「AI营销系统30秒生成」**正下方紧贴一个黑色实心矩形、
 *   块内无文字、位置恒定、水平居中**；而同片其它镜（背景本来就黑）同位置干净 → "时有时无"。
 *
 * 根因（服务端这一侧）：**banner 的某一行是空字符串，但它照样被写进了 plan** ——
 *   · `bannerFieldOf()` 原来只在【两行都空】时才返回空对象（`if (!line1 && !line2) return {}`），
 *     所以「line1 有值 + line2 = ''」会原样写进 plan → 渲染层照画两行底衬 → 第 2 行只剩一个空框。
 *   · `buildBanner()` 在「只手填了 1 行 + 另一行净化后为空（全是 emoji/标点/markdown）」时同样会产出空行。
 * 影响：不只是难看 —— 排查"留档 ≠ 出片"时也会被这行空串误导（本次就白跑了两轮）。
 *
 * 规矩（本文件统一收口，两个卖点都走它）：
 *   ① 两行都空 → **不生成 banner**（根级没有这个字段，渲染层一根都不画）；
 *   ② 只有一行非空 → **只写那一行**（非空行提到 line1；绝不给渲染层留一个空槽/空框）；
 *   ③ 正常两行 → 原样（行为与以前逐字一致）。
 * 渲染层另有"空行不画框"的第二道兜底（team-lead 安排），服务端这里**不许再留空行**。
 */
export function bannerFieldLines(line1: any, line2: any): { line1: string; line2?: string } | null {
  const l1 = normalizeBannerLine(line1, VF_BANNER_LINE1_MAX)
  const l2 = normalizeBannerLine(line2, VF_BANNER_LINE2_MAX)
  if (!l1 && !l2) return null
  if (!l1) return { line1: l2 }
  if (!l2) return { line1: l1 }
  return { line1: l1, line2: l2 }
}

/** 两行纯文案（还没挂 from/to） */
export interface VfBannerLines {
  line1: string
  line2: string
}

/**
 * 单行净化：去 emoji/装饰符号 → 去**不可见字符** → 去 markdown 记号 → 去首尾引号/空白 → 去**结尾标点** → 截断到 max。
 * 为什么去结尾标点：这是"钉在画面上的标题"，用户要求不出现句号/逗号这类收尾标点（视觉更干净）。
 */
export function normalizeBannerLine(v: any, max: number): string {
  let s = stripEmoji(v)
  // ★VF_BANNER_EMPTYLINE_V1（2026-10-01）：剥掉"看不见的字符"——**这一条就是老板报的"空色块"的根因**。
  //   `\u200b` 这类零宽/BOM/变体选择符既不是空白也不是 emoji → `trim()` 认不出 → 一行"只有零宽字符"
  //   的标题会被服务端当成**非空**写进 plan，渲染层于是给它画一个底衬框，可框里一个字都看不见。
  for (const _ch of VF_BANNER_INVIS) s = s.split(_ch).join('')
  s = s.replace(/[*#`]/g, '')
  s = s.replace(/^[\s"'“”「」『』【】（）()]+|[\s"'“”「」『』【】（）()]+$/g, '')
  s = s.replace(/[。！？!?，,、；;：:.…\s]+$/g, '')   // 结尾标点（用户要求 line1 不要标点结尾）
  s = s.replace(/\s{2,}/g, ' ').trim()
  return s.slice(0, Math.max(1, Number(max) || 1))
}

/** 把口播文案按句末标点/换行切成句子（规则兜底用） */
export function splitBannerSentences(script: any): string[] {
  return String(script == null ? '' : script)
    .split(/[。！？!?\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * 规则兜底：AI 失败/返回不合法时**绝不因此不出片** ——
 *   line1 = 文案首句前 10 字，line2 = 次句前 16 字（没有次句就用首句）。
 */
export function fallbackBanner(script: any): VfBannerLines {
  const ss = splitBannerSentences(script)
  const line1 = normalizeBannerLine(ss[0] || String(script == null ? '' : script), VF_BANNER_FALLBACK_LINE1)
  const line2 = normalizeBannerLine(ss[1] || ss[0] || String(script == null ? '' : script), VF_BANNER_FALLBACK_LINE2)
  return { line1, line2 }
}

/** 从 AI 返回的文本里解析两行；任何一步不合法 → 返回 null（交给 fallbackBanner） */
export function parseBanner(raw: any): VfBannerLines | null {
  const t = String(raw == null ? '' : raw)
  const m = t.match(/\{[\s\S]*\}/)
  if (!m) return null
  let o: any
  try { o = JSON.parse(m[0]) } catch { return null }
  if (!o || typeof o !== 'object') return null
  // 容错：AI 偶尔用 line_1 / title / sub 之类别名
  const line1 = normalizeBannerLine(o.line1 ?? o.line_1 ?? o.title, VF_BANNER_LINE1_MAX)
  const line2 = normalizeBannerLine(o.line2 ?? o.line_2 ?? o.sub, VF_BANNER_LINE2_MAX)
  if (!line1 || !line2) return null
  return { line1, line2 }
}

/** 提炼提示词：**必须贴合这条片的文案**，不许编造文案里没有的数据/承诺 */
export function buildBannerPrompt(o: { script: string; brief?: string; topic?: string }): string {
  return `你是短视频标题编辑。给下面这条口播视频想两行【全程钉在画面顶部的固定标题】。\n` +
    `要求：\n` +
    `① 第 1 行：钩子/主题，**≤${VF_BANNER_LINE1_MAX} 字**，不要标点结尾，不要 emoji —— 观众扫一眼就知道"这条在讲什么"\n` +
    `② 第 2 行：核心承诺或关键点，**≤${VF_BANNER_LINE2_MAX} 字**，不要标点结尾，不要 emoji\n` +
    `③ 只能基于下面【文案】里**已有的信息**——**不许编造**文案里没有的数字、承诺、机构名、效果\n` +
    `④ 只输出一个 JSON 对象：{"line1":"...","line2":"..."}（不要 markdown、不要解释、不要多余字段）\n` +
    `【主题】${o?.topic || '（未指定，按文案概括）'}\n` +
    (o?.brief ? `【素材/画面】${String(o.brief).slice(0, 400)}\n` : '') +
    `【文案】${String(o?.script || '')}`
}

export interface BannerBuildOpts {
  script: string
  brief?: string
  topic?: string
  /** 设置卡开关：'off'/false = 不要（既不生成也不带字段）；其余（含缺省/'on'）= 自动 */
  pin?: string | boolean
  /** ★VF_BANNER_PIN2_V1（2026-09-29 用户定案）：「顶部标题第 1 行」手填 —— 留空 = AI 自动拟。
   *  填了就以用户为准（仍走 normalizeBannerLine 清洗/截断）；与 pin2 一起都填 → 完全不调 AI。 */
  pin1?: string
  /** ★VF_BANNER_PIN2_V1：「顶部标题第 2 行」手填（同上）。 */
  pin2?: string
  /** 项目现成的**文本**调用（便宜的），由调用方注入（vf-video.ts 与 route.ts 都用它） */
  generateText: (prompt: string) => Promise<string | null>
}

export interface BannerBuildResult {
  /** 直接 `planWithBanner(plan, r.field)` 用；开关关 / 提炼不出时是**空对象**（渲染层因此不画） */
  field: { banner?: VfBanner }
  /** 提炼出来的两行（开关关 / 文案为空时是 null）；调用方存进草稿 */
  lines: VfBannerLines | null
  /** 是否走了【规则兜底】（AI 拒绝/超时/返回不合法）—— 写日志用 */
  fallback: boolean
  /** 人类可读说明（调用方原样写日志） */
  notes: string[]
}

/**
 * 出片前的一次「固定标题」提炼（★默认自动）：
 *   开关关（'off'）→ 不调用 AI、不返回字段（**一根标题都不画**）；
 *   否则调一次**便宜的文本调用**产两行；失败/不合法 → 规则兜底；文案为空 → 不带字段。
 *   **绝不 throw**：任何异常都降级成兜底（不能因为一个标题把整条片卡死）。
 */
export async function buildBanner(o: BannerBuildOpts): Promise<BannerBuildResult> {
  const notes: string[] = []
  const pinOff = o?.pin === false || String(o?.pin ?? 'on').trim().toLowerCase() === 'off'
  if (pinOff) {
    return { field: {}, lines: null, fallback: false, notes: ['设置卡选了「不要」→ 不生成、plan 里也不带 banner（渲染层因此不画）'] }
  }
  // ★VF_BANNER_PIN2_V1（2026-09-29 用户定案）：设置卡「顶部标题第 1/2 行」手填优先。
  //   两行都手填 → **一次 AI 都不调**（用户说了算）；只填一行 → 另一行仍交给 AI 补，手填的永不被覆盖。
  //   手填内容同样走 normalizeBannerLine（去 emoji / 去 markdown / 去结尾标点 / 截断到 12 / 18 字）。
  const manual1 = normalizeBannerLine(o?.pin1, VF_BANNER_LINE1_MAX)
  const manual2 = normalizeBannerLine(o?.pin2, VF_BANNER_LINE2_MAX)
  if (manual1 && manual2) {
    notes.push(`用你手填的两行（不调 AI）：第1行「${manual1}」/ 第2行「${manual2}」`)
    return { field: { banner: { line1: manual1, line2: manual2, from: 1, to: 0 } }, lines: { line1: manual1, line2: manual2 }, fallback: false, notes }
  }
  let lines: VfBannerLines | null = null
  try {
    const raw = await o.generateText(buildBannerPrompt({ script: o?.script || '', brief: o?.brief, topic: o?.topic }))
    lines = parseBanner(raw)
    if (!lines) notes.push('AI 返回空/不合法 → 走规则兜底（首句前 10 字 / 次句前 16 字）')
  } catch (e: any) {
    notes.push('AI 提炼失败 → 走规则兜底：' + String(e?.message || e).slice(0, 120))
  }
  const fallback = !lines
  if (!lines) lines = fallbackBanner(o?.script)
  // 手填的那一行**永远**覆盖 AI/兜底（另一行没手填才用 AI 结果）
  const l1 = manual1 || normalizeBannerLine(lines.line1, VF_BANNER_LINE1_MAX)
  const l2 = manual2 || normalizeBannerLine(lines.line2, VF_BANNER_LINE2_MAX)
  if (manual1 || manual2) {
    notes.push(`第 ${[manual1 ? '1' : '', manual2 ? '2' : ''].filter(Boolean).join('、')} 行用你手填的，另一行 AI 自动`)
  }
  // ★VF_BANNER_EMPTYLINE_V1（2026-10-01）：空行一律不写进 plan —— 两行都空 → 不生成 banner；
  //   只剩一行 → 只写那一行（非空行提到 line1）。绝不给渲染层留一个空槽（那就会画成"空色块"）。
  const shaped = bannerFieldLines(l1, l2)
  if (!shaped) {
    notes.push('两行都为空 → 本次不带固定标题（绝不给渲染层留空行）')
    return { field: {}, lines: null, fallback, notes }
  }
  if (!l1 || !l2) {
    notes.push(`★空行已滤掉（原 第1行「${l1}」/ 第2行「${l2}」）→ plan 里只写非空行` +
      `（否则渲染层会给空行画一个空底衬框 = 用户报的"空色块"）`)
  }
  notes.push((fallback ? '规则兜底' : 'AI 提炼成功') + `：第1行「${shaped.line1}」/ 第2行「${shaped.line2 || '(无)'}」`)
  return { field: { banner: { ...shaped, from: 1, to: 0 } }, lines: { line1: shaped.line1, line2: shaped.line2 || '' }, fallback, notes }
}

/**
 * 草稿（{ pin, banner }）→ plan 要用的**根级** banner 字段。
 * 开关关 / 草稿里没提炼出两行 → **空对象**（绝不硬塞、绝不画）。
 * 出片那一刻不再调 AI（提炼在起草时已做），这里只做形状收敛 + 再净化一次（防御性）。
 */
export function bannerFieldOf(vd: { pin?: string | boolean; pin1?: string; pin2?: string; banner?: { line1?: string; line2?: string } } | null | undefined): { banner?: VfBanner } {
  if (vd?.pin === false || String(vd?.pin ?? 'on').trim().toLowerCase() === 'off') return {}
  // ★VF_BANNER_PIN2_V1：手填优先（与 buildBanner 同口径）——即便草稿里存着旧的 AI 两行，
  //   只要用户在设置卡里手填了，出片也一定用手填的（防"手填了却出的是旧标题"）。
  const line1 = normalizeBannerLine(vd?.pin1, VF_BANNER_LINE1_MAX) || normalizeBannerLine(vd?.banner?.line1, VF_BANNER_LINE1_MAX)
  const line2 = normalizeBannerLine(vd?.pin2, VF_BANNER_LINE2_MAX) || normalizeBannerLine(vd?.banner?.line2, VF_BANNER_LINE2_MAX)
  // ★VF_BANNER_EMPTYLINE_V1（2026-10-01）：**单行空也要滤掉** —— 这一处就是老板那颗"空色块"的根因：
  //   原来只在"两行都空"时才不生成；「line1 有值 + line2 = ''」会把空串写进 plan → 渲染层照画第 2 行的空底衬框。
  const shaped = bannerFieldLines(line1, line2)
  if (!shaped) return {}
  return { banner: { ...shaped, from: 1, to: 0 } }
}

/* ══════════════════ ★VF_BANNER_RECOMPUTE_V1（2026-09-29 team-lead 要求）══════════════════
 * 现象：banner 只在【起草】时生成一次；用户在出片前用「文案微调 / 保存并重写文案」改了文案，
 *      标题还是旧的（跟新文案对不上）。→ 需要在【文案被修改的路径】上按新文案重算 banner。
 * 什么时候【不】重算（纯函数，可自测）：
 *   · 开关关（pin='off'）——本来就没有固定标题；
 *   · 新文案为空；
 *   · 用户两行都手填了 —— 手填的**永不覆盖**（用户说了算），重算也是白调 AI。
 * ════════════════════════════════════════════════════════════════════════════════════════ */

/** 用户是否两行都手填了（手填 = 永不覆盖） */
export function hasManualBanner(pin1?: any, pin2?: any): boolean {
  return !!(normalizeBannerLine(pin1, VF_BANNER_LINE1_MAX) && normalizeBannerLine(pin2, VF_BANNER_LINE2_MAX))
}

/** 文案改了 → 标题要不要重算？ */
export function shouldRebuildBanner(vd: { pin?: string | boolean; pin1?: string; pin2?: string } | null | undefined, script: string): boolean {
  if (!String(script || '').trim()) return false
  if (vd?.pin === false || String(vd?.pin ?? 'on').trim().toLowerCase() === 'off') return false
  if (hasManualBanner(vd?.pin1, vd?.pin2)) return false
  return true
}

/**
 * 把 banner 字段挂到 plan 的**根级**（绝不塞进 shots）—— 渲染层 render.py 只读根级 `sb.get('banner')`。
 * 单独一个纯函数是为了自测能直接断言"根级有、shots 里没有"。
 */
export function planWithBanner<T extends Record<string, any>>(plan: T, field: { banner?: VfBanner }): T & { banner?: VfBanner } {
  const out: any = { ...(plan || {}) }
  if (field && field.banner) out.banner = field.banner
  return out
}

/* ══════════════════ ★VF_SBDUMP_V2（2026-10-01 team-lead 定案）══════════════════
 * 事故：老板那条真片（20261001_004）的**本地留档与出片 plan 不是同一份** ——
 *   留档 `E:\ai-marketing\data\vf-storyboards\vf-20261001-125750-u1.json` 里
 *   **没有 `banner`**（可成片里明明有固定标题）、**13 镜全没有 `variant`**
 *   （可第 1 镜成片是 deck 版式）→ **开发机拿着留档复现不出成片**，team-lead 因此白跑两轮。
 * 为什么：留档走的是一张「精简卡片」的 shots（只映射 type/text/dur/subtitle… 见 route.ts 的 vfScriptCard），
 *   banner/deck_style/variant/frame… 全在卡片映射那一步被丢掉；plan 又是出片那一刻**另拼一份**。
 * 修法（本节）：把 plan 的**组装**收口成一个纯函数 `buildVideoPlan()`，
 *   **出片 / 样板镜 / 本地留档 三处共用同一份**（同一个函数、同一份字段、同一份默认值）——
 *   于是"留档里的 plan"与"渲染真正读的 plan"逐字一致，`scripts/vf-local.mjs --sb <留档>` 复现得出来。
 * ⚠️ overlay_text 缺省 = 开（render.py 只在显式 `false` 时才关）→ 显式写上不改变任何现有行为。
 */
export const VF_PLAN_FPS = 25
export function buildVideoPlan(shots: any[], vd: any, opts?: { sizeDefault?: number[] }): Record<string, any> {
  const size = (Array.isArray(vd?.size) && vd.size.length === 2 ? vd.size : null) || opts?.sizeDefault || [1080, 1920]
  // ★VF_STYLES_WIRE_V1（2026-10-01）：「🎨 画面风格」= 5 套成品风格之一；未选 / 非法 → normalizeStyle 返回 ''
  //   → 下面**不写 style 键**（render.py 的 apply_style 不触发）→ 老链路（theme + deck_style）逐字不变。
  const _style = normalizeStyle(vd?.style)
  return planWithBanner({
    size,
    fps: VF_PLAN_FPS,
    shots: Array.isArray(shots) ? shots : [],
    overlay_text: vd?.big !== 'off',                 // 'off' 才关；缺省 = 开（与 render.py 缺省一致）
    deck_style: normalizeDeckStyle(vd?.deckStyle),   // ★VF_DECK_STYLES_V1：画面模版（非法/缺省 = 'auto'）
    ...(_style ? { style: _style } : {}),            // ★VF_STYLES_WIRE_V1：成品风格（选了才写；不选 = 不写）
  }, bannerFieldOf(vd))
}
