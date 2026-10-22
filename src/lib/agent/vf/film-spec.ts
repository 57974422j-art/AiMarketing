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
// ★VF_VOICE_PICK_V1：口播气质的枚举（AI 只挑气质，音色由服务端映射 —— 纯数据模块，无循环依赖）
import { VOICE_TONES } from './tts-voices'

/** 开关：**每次调用都读 env**（测试可切、运维可热改；默认关） */
export function aiSpecEnabled(): boolean {
  return /^(1|true|on|yes)$/i.test(String(process.env.VF_FILM_AI_SPEC || ''))
}

/** 只允许这些组、这些键（与 `film-to-page.mjs` 的 SPEC_DEF / SPEC_ENUM 一一对应） */
export const SPEC_KEYS: Record<string, string[]> = {
  layout: ['system', 'whitespace'],
  image: ['place', 'complete'],
  pacing: ['minShotSec'],
  // ★VF_FILMTRANS_V2b（2026-10-11 自检抓到）：`trans` 早就进了引擎 SPEC_ENUM，但**白名单里漏了**
  //   ⇒ AI 声明的"全图页转场"每次都被 pickSpec 丢掉（等于白声明）。补上。
  motion: ['img', 'ease', 'type', 'cross', 'trans'],
  text: ['titleForm', 'ornament', 'weight', 'tracking', 'scale'],
  gates: ['minImageWidth'],
  // ★VF_THEME_V1（2026-10-11 用户定案「AI 完全自己画 就不要参与我们模版…动效样式完全它自主安排」）：
  //   配色也能由 AI 定。合法性**不靠模型自觉** —— 引擎 tools/theme.mjs 的 normTheme 会判对比度，
  //   不达标一律丢弃并退回风格包（用户原话「直接就一个墨绿底色简直没法看」）。
  theme: ['bg', 'bg2', 'ink', 'dim', 'faint', 'accent', 'accentText', 'font', 'radius'],
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
    ['转场', (sp && sp.motion && sp.motion.trans && sp.motion.trans !== 'auto') ? String(sp.motion.trans) : ''],
    // ★VF_THEME_V1：AI 自定配色时，卡片上要说清"这片不用库里模板的配色"
    ['配色', (sp && sp.theme && sp.theme.bg) ? 'AI 自定(' + String(sp.theme.bg) + ')' : ''],
  ]
  return rows.filter(([, v]) => v !== '').map(([k, v]) => k + '=' + v).join(' · ')
}

/** 给模型的"一页纸"：**只问风格语法**（不写文案 —— 文案是下一步自己的活）
 *  ★VF_THEME_V1（2026-10-11 用户定案「AI 完全自己画 就不要参与我们模版…动效样式完全它自主安排」）：
 *  `paint=true`（用户勾了「AI 完全自主」）时**连配色一起要** —— 这一片不套库里风格包的皮肤；
 *  给回来的 theme 由引擎 tools/theme.mjs 判对比度，不合格**丢弃退回**（不出"墨绿一坨"）。 */
export function specPrompt(summary: string, n: number, topic: string, paint = false): string {
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
    + 'place 照片呈现（mat 相纸不裁 / mat-tape 相纸+胶带 / fullbleed ★满幅压字：图铺满整页 + 压一层暗场 + 标题叠在图上）；\n'
    + '★「满幅压字」只适合**主体清楚、本身好看**的实拍（横图 / 主体居中 / 画面有氛围）；'
    + '以文字截图、表格、信息图为主的素材**不要**选它（字会跟图里的字打架）；\n'
    + 'complete=true 表示"这套风格**保证图片完整**"（此时别选 fullbleed）；\n'
    + 'titleForm 标题形态；weight/tracking/scale = 标题字重 / 字距 / 字号倍率。\n'
    + '硬规矩：① 只回 JSON，不要解释、不要 markdown 围栏；② **拿不准的键就别写**（会退回默认，不会出错）；\n'
    + '③ 不许编造数据/品牌；④ 自检"同一度"——别让每一页长得一样；\n'
    // ★VF_SPEC_V2b（2026-10-10 实测：AI 只填了 text 组 4 个键 ⇒ 版式/图片/动效全走默认）：
    //   它把"拿不准就别写"执行得过于保守 ⇒ 明确点出"这三项最影响观感，尽量定下来"。
    + '⑤ **尽量**把这三项也定下来（它们最影响观感）：`layout.system`、`image.place`、`motion.img`；\n'
    + '   真拿不准才省略（省略 = 用引擎默认，不会出错）；\n'
    // ★VF_FILMTRANS_V2b：转场键早就在引擎里，之前白名单漏了 ⇒ AI 声明也被丢，现在补上并明确告诉它
    + '⑥ 可选 `motion.trans`（**只在"整张不裁的全图页"上生效**）：auto/fade/wipe/cut/push/slide-up/zoom-through/blur-dissolve/light-leak。\n'
    + (paint
      ? '\n★**本次完全自主**：连**配色**也由你定（不使用库里任何模板皮肤）。请在 JSON 里再加一组 theme：\n'
        + '"theme":{"bg":"#rrggbb","bg2":"#rrggbb","ink":"#rrggbb","dim":"#rrggbb","accent":"#rrggbb"}\n'
        + '配色硬线（不合格会被**整组丢弃**、退回默认皮肤）：\n'
        + '  ① bg 与 ink 对比度 ≥ 4.5（字必须看得清：深底配浅字，浅底配深字）；\n'
        + '  ② accent 与 bg 对比度 ≥ 2.5（强调要看得出来，别整片一坨同色）；\n'
        + '  ③ 全部用 #rrggbb；④ bg2 与 bg 要**有轻微差别**（成片拿它做第二层，同色会显平）；\n'
        + '  ⑤ 配色要**服务素材**（美食偏暖、科技偏冷、医疗偏洁净），别为了花哨牺牲可读性。\n'
      : '')
}

/* ═════════ ★VF_PACKAI_V1（2026-10-11 用户定案「AI审图的时候就挑选可用的可以吗？」）═════════
   背景：自动挑包原来是"赛道 prefer[0]"（**永远同一个包**），轮换又会轮到不合适的（"轮上去直接没法看"）。
   现口径：**让 AI 看着素材挑**（在读图/审图那一步，一次调用），且**只能从"体检通过"的包里挑**
   （体检 = tools/check-style-packs.mjs → styles/health.json）。
   ⚠️ 校验在服务端做（`pickPackId`）：模型编的 id 一律不认 ⇒ 退回引擎兜底。 */

/** 给模型的挑包题面：**只给候选清单**（id 必须逐字来自清单） */
export function packPickPrompt(
  list: Array<{ id: string; name?: string; desc?: string; mood?: string }>,
  summary: string, topic: string): string {
  const rows = (Array.isArray(list) ? list : []).slice(0, 80)
    .map((p) => '- ' + p.id + '（' + String(p.name || '') + (p.mood ? ' · ' + p.mood : '') + '）：'
      + String(p.desc || '').slice(0, 70))
    .join('\n')
  return '你是短片的美术指导。请**看着这批素材**，从下面这份"可用风格包"清单里挑**最合适的一个**。\n'
    + (topic ? '主题：' + topic + '\n' : '')
    + (summary ? '【素材读图总结】\n' + String(summary).slice(0, 1200) + '\n' : '')
    + '\n【可用风格包】（**只能从这些 id 里挑**）\n' + rows + '\n'
    + '\n只回一个 JSON：{"pack":"<上面某个 id>","why":"一句话理由","lay":"auto|bleed|plate"}。\n'
    + '`lay`＝**图呈现**（★VF_LAY_V1，2026-10-14 用户定案「满幅压字要可选、不要改老风格」）：\n'
    + '  auto＝跟风格包自带版式（**拿不准就填它**）；\n'
    + '  bleed＝**满幅压字**（图铺满整页 + 压一层暗场 + 标题叠在图上；适合主体清楚、本身好看的实拍，尤其横图）；\n'
    + '  plate＝**相纸不裁**（图整张不裁、不压字；适合以文字截图 / 表格 / 信息图为主，或绝不能被裁的图）。\n'
    + '硬规矩：① id 必须**逐字**来自上面清单（编造的 id 会被丢弃）；② 按"素材气质 / 用途"匹配，'
    + '不要只看配色好不好看；③ 以竖屏截图为主的素材，优先信息层级清楚的（如 dark-dashboard / glass-saas）；'
    + '④ 美食/风景实拍，优先留白多、照片为主的（如 reel-showcase / paper-editorial）。'
}

/** 从模型回答里取包 id：**必须在 allowed 里**（编的 id / 空 / 非字符串一律不认 ⇒ null） */
export function pickPackId(j: any, allowed: string[]): string | null {
  const id = String((j && typeof j === 'object' && j.pack !== undefined && j.pack !== null) ? j.pack : '').trim()
  if (!id) return null
  return (Array.isArray(allowed) ? allowed : []).includes(id) ? id : null
}

/* ═════════ ★VF_LAY_V1（2026-10-14 用户定案「满幅压字要**可选**，而不是改老风格；AI 也可选」）═════════
   背景：用户看到"动效字压在素材图上"的小样，觉得这样**图片面积更完整**。
   查证结论（先查再改，不重造）：这能力**引擎早就有** —— `image.place='fullbleed'` +
   `text.titleForm='overlay'`，实现在 `tools/film-to-page.mjs` 的 `specCss` ③ 段
   （图铺满整页 + 压一层暗场 + 字转白加投影）。
   ⇒ 所以**不加新风格包**（那只覆盖一个方案），而是把它做成**正交于风格包的一个声明**：
     51 个风格包都能套；老包一个字节不改 ⇒ 不选 `bleed` 时**出片与今天完全一致**。
   两条 AI 通道（都不额外烧点）：① 用户勾了"让 AI 自己规划版式" ⇒ `specPrompt` 里声明 image.place；
   ② 没勾（默认）⇒ 在已有的"审图挑包"那一次调用里顺带问 `lay`（`packPickPrompt`）。
   两条人的通道：第 2 步卡上的三选（用户手选**压倒** AI 的建议）。
   边界（引擎已定，这里不改）：fullbleed **只作用于"整页单图"三类结构**
   （fullbleed / plate-top / plate-bottom）；多图页保持网格 —— 想让多图页也压字要新增页型，是另一个活。 */

/** 图呈现（用户在第 2 步卡上选；'auto' = 跟风格包 / 交给 AI 判） */
export const LAY_IDS = ['auto', 'bleed', 'plate'] as const

/** 只认这三个值（编的值 / 空 ⇒ null，调用方**保持原值**，不静默改） */
export function pickLayId(v: any): string | null {
  const s = String(v === undefined || v === null ? '' : v).trim()
  return (LAY_IDS as readonly string[]).includes(s) ? s : null
}

/** 一句话（卡片 / 日志用） */
export function describeLay(lay: string): string {
  return lay === 'bleed' ? '满幅压字' : lay === 'plate' ? '相纸不裁' : '跟风格'
}

/** lay ⇒ spec 覆盖（**只在这一处翻译**；返回 null = 不覆盖任何键）
 *  ⚠️ `bleed` 必须**同时**给 `complete:false`：满幅必然裁切，只改 place 不改 complete
 *     就是"声明自相矛盾"，arrange 与骨架会打架（出片被 stage=spec 拒渲）。 */
export function laySpec(lay: string): any | null {
  const s = pickLayId(lay)
  if (!s || s === 'auto') return null
  if (s === 'bleed') {
    return {
      image: { place: 'fullbleed', complete: false },
      text: { titleForm: 'overlay' },
      motion: { type: 'overlay' },
    }
  }
  // plate：强制"相纸不裁"（用来**压过** AI / 风格包可能选的 fullbleed）
  return { image: { place: 'mat', complete: true } }
}

/** 把 lay 覆盖**合并进** spec —— 优先级：**用户手选 > AI 规划 > 风格包 spec > 引擎默认**
 *  ⚠️ 必须发生在 `planFilm`（排骨架）**之前**：`image.complete` 决定 arrange 允不允许 fullbleed，
 *     声明晚了骨架与声明就打架 ⇒ 出片时被 stage=spec 拒渲（2026-10-10 实测抓过这条）。 */
export function mergeLay(spec: any, lay: string): any {
  const ov = laySpec(lay)
  if (!ov) return spec
  const out: any = (spec && typeof spec === 'object') ? JSON.parse(JSON.stringify(spec)) : {}
  for (const g of Object.keys(ov)) {
    out[g] = { ...((out[g] && typeof out[g] === 'object') ? out[g] : {}), ...ov[g] }
  }
  return out
}

/* ═════════ ★VF_FILM_PITCH_V1（2026-10-22 用户原话「**不是改画面上的，改的是口播**。AI 出 3 条可以选、可以修改」）═════════
   背景：老流程是"AI 按骨架各写一句 ≤18 字的口播句"⇒ 拼起来是一串**碎句**（各写各的，语意不接），
   而且提示词里完全没有"钩子 / 开场抓人 / 优惠"的要求（全仓 grep 0 命中）。
   现口径：先出 **3 条完整口播营销稿**（不同角度）⇒ 用户选 1 条、可手工改 ⇒ 定稿那条再按段切开。

   ★VF_FILM_PITCH_V2（2026-10-22 用户实测第一条：3 条候选只有 **23/31/29 字**，而片子是 **15 段 / 54 秒**）：
   两个真因（都不是模型的锅，是题面与设计没对上）：
     ① 题面写"每条 120~180 字"—— 这是个**与段数无关的固定值**，而且没有"必须分 N 行"的可数约束 ⇒
        便宜的 writer 模型写完一句就收（实测 29 字 ≈ 6 秒，而片子 54 秒）；
     ② 让模型"把整稿切成 15 段"= **让它做算术**：29 字切 15 段每段 1.9 字，物理上不可能 ⇒ 它干脆不给 `voice`
        ⇒ 配音退回念画面大字（用户实测"口播稿没出现在视频里"）。
   现口径（本文件的四个纯函数）：
     · `pitchQuotas()` —— 按**每段真实时长**算该段该念多少字（配额）；
     · `pitchPrompt()` —— **篇幅是硬要求**：共 N 段 ⇒ 必写 N 行、每行 13~18 字、全稿约 needChars 字（给区间）；
     · `pickPitchCandidates()` —— 解析（支持 `lines[]` 与多行 `text`），**保留换行**（一行一段）；
     · `splitPitchToSegments()` —— **切段交给服务端**（确定性装箱，只按标点边界、**绝不删字/改字**）⇒
       不再让模型做算术，覆盖率可机器核对。

   为什么放在本文件：`film-spec.ts` **只有 HTML 成片线引用**（已全仓核对），题面与解析放这里天然隔离，
   而且都是纯函数 ⇒ 能脱离模型单测（见 temp/_spec/test.mjs）。 */

/** 每段口播的字数配额用多少语速：**念稿语速 4 字/秒**（字幕/口播口径，比"整片时长估算"的 3.2 字/秒略快，
 *  因为后者含每段尾巴与停顿）。3.6 秒的段 ⇒ 约 14 字。 */
export const PITCH_CPS = 4

/** 每段该念多少字（按骨架每段的**真实时长**算；dur 缺失按 3.6 秒，夹在 8~26 字之间） */
export function pitchQuotas(durs: Array<number | undefined>): number[] {
  return (Array.isArray(durs) ? durs : []).map((d) => {
    const dur = Number(d) || 3.6
    return Math.max(8, Math.min(26, Math.round(dur * PITCH_CPS)))
  })
}

/** 全稿该有多少字 = 各段配额之和（卡片上给用户看"你要写多少字"的**唯一口径**） */
export function pitchNeedChars(quotas: number[]): number {
  return (Array.isArray(quotas) ? quotas : []).reduce((a, b) => a + (Number(b) || 0), 0)
}

/** 口播稿的题面（3 条不同角度：钩子型 / 优惠型 / 口碑型）
 *  ⚠️ 硬线①：**没有优惠就不许编优惠**（模型最爱自己发明"立减 20"）；
 *  ⚠️ 硬线②：零 emoji、不许自创品牌名、不许编数据；
 *  ⚠️ 硬线③（V2 新增）：**篇幅与行数是硬要求** —— 共 N 段就写 N 行，每行一句该段的口播。 */
export function pitchPrompt(input: {
  summary: string; topic: string; planTxt: string
  segs: number; needChars: number; perSegMin: number; perSegMax: number
}): string {
  const segs = Math.max(1, Number(input.segs) || 1)
  const need = Math.max(20, Number(input.needChars) || segs * 14)
  const pmin = Math.max(4, Number(input.perSegMin) || 13)
  const pmax = Math.max(pmin + 1, Number(input.perSegMax) || 18)
  const low = Math.round(need * 0.85)
  const high = Math.round(need * 1.25)
  return '你是短视频口播稿写手。素材是一组餐饮/美食实拍。\n'
    + '【素材总结（视觉模型读图所得）】\n'
    + (input.summary ? String(input.summary).slice(0, 1200) : '（这次没有读图结果 ⇒ 只写能确定的内容，拿不准的细节一律不写）') + '\n'
    + '【用户给的主题/卖点】'
    + (input.topic ? input.topic : '（用户没给 ⇒ 只依据素材，不许自创品牌、不许编数据）') + '\n'
    + '【这条片的段落骨架】\n' + String(input.planTxt || '').slice(0, 700) + '\n\n'
    // ★VF_FILM_PITCH_V2：篇幅必须**与段数绑定**（老题面的"120~180 字"和 15 段片子完全对不上）
    + '【篇幅 · 硬要求（写不够会直接退回重写）】\n'
    + '· 这条片一共 **' + segs + ' 段**，每段约 ' + pmin + '~' + pmax + ' 字；\n'
    + '· **全稿必须有 ' + low + '~' + high + ' 字**（目标 ' + need + ' 字）—— 少于 ' + low + ' 字算不合格；\n'
    + '· **一行 = 一个镜头**：必须**正好写 ' + segs + ' 行**，第 k 行就是第 k 段要念的那句话；\n'
    + '· 行与行之间**语意要接**（是一条连贯的稿，不是 ' + segs + ' 条互不相干的标语）；\n'
    + '· 宁可多写具体细节（菜名 / 做法 / 火候 / 场景 / 吃法），**不许**用"超值""必吃""一口上瘾""值得一试"这类空话凑字数。\n\n'
    + '请写 **3 条不同角度**的口播营销稿：\n'
    + '① 钩子型：第 1 行必须是钩子（≤15 字，用具体细节抓人）\n'
    + '② 优惠型：把活动说清楚（**只在素材或主题里真的出现打折/活动时才写；没有就换一个角度，绝不许编优惠**）\n'
    + '③ 口碑型：用真实可见的细节立信（现切、卖完就收、几点开门这类）\n'
    + '三条都必须：口语化能直接念（不要书面语、不要排比句堆砌）· 第 1 行就能立住（不要"大家好""今天给大家介绍"）'
    + '· 结尾给一个落点（到店/留言/收藏，三选一，不要每条都"评论区见"）· **零 emoji**'
    + '· **不许编造数据、不许编不存在的优惠、不许自创品牌名**\n'
    // ★VF_VOICE_PICK_V1（2026-10-22 用户定案「加个字段给 AI 知道做什么配音合适」）：
    //   AI **只判"气质"**（枚举）+ 一个曲风短语；`tone → 具体音色` 由服务端映射（不让模型编 48 个 id）。
    //   同一次调用顺带产出 ⇒ 不额外烧点。
    + '另外顺带判两件事（不要解释，各回一个值）：\n'
    + '· `tone`：这条片最适合的**口播气质**，只能从这六个里挑一个（原样回英文 key）：\n'
    + '    lively=活泼开场 / promo=热情叫卖 / warm=温柔叙述 / gang=江湖烟火 / doc=纪实旁白 / brand=品牌质感\n'
    + '· `music`：最适合的**配乐曲风**，2~4 个汉字（例：轻快市井 / 温柔民谣 / 国潮鼓点 / 安静纪实）\n'
    + '只输出严格 JSON（`lines` 是**逐段口播的数组，长度必须 = ' + segs + '**）：\n'
    + '{"candidates":[{"angle":"钩子型","lines":["第1段","第2段",…]},'
    + '{"angle":"优惠型","lines":[…]},{"angle":"口碑型","lines":[…]}]'
    + ',"tone":"lively","music":"轻快市井"}'
}

/** ★VF_VOICE_PICK_V1：从出稿那次回答里取**附带的语气/曲风建议**（白名单式，编的值一律不认）。
 *  · `tone` 只认 `tts-voices.ts` 的 6 个枚举（其余 ⇒ ''，由调用方退回"不预设"）；
 *  · `music` 只认 2~12 个汉字（模型爱写"轻快、欢快、富有活力的一首"这种长句 ⇒ 截断更好用）。 */
export function pickPitchExtras(j: any): { tone: string; music: string } {
  const o = (j && typeof j === 'object' && !Array.isArray(j)) ? j : {}
  const toneRaw = String((o as any).tone || '').trim().toLowerCase()
  const tone = (VOICE_TONES as readonly string[]).includes(toneRaw) ? toneRaw : ''
  const musicRaw = String((o as any).music || '').replace(/[\s"'「」【】]/g, '').trim()
  const music = /^[\u4E00-\u9FFF]{2,12}$/.test(musicRaw) ? musicRaw : ''
  return { tone, music }
}

/** 稿子的读数（**唯一口径**：字数是"去掉空白后的字符数"，行数是"非空行数"） */
export function pitchStats(text: string): { chars: number; lines: number } {
  const t = String(text || '')
  const lines = t.split('\n').map((s) => s.trim()).filter(Boolean).length
  return { chars: t.replace(/\s+/g, '').length, lines }
}

/** 从模型回答里取口播稿候选（**白名单式**：`lines[]` / `text` / `script` / `content` 四种键）
 *  · **保留换行**（一行 = 一段，这是切段的抓手）；行内多空格压成一个、空行丢掉；
 *  · 条数不足**不补**（有几条给几条，调用方如实告知）；超过 3 条只取前 3；
 *  · 顺手清掉 emoji / 箭头符号；过短的丢掉（多半是角度标签而不是稿子）。 */
export function pickPitchCandidates(j: any): string[] {
  const raw = Array.isArray(j) ? j
    : (j && typeof j === 'object' && Array.isArray((j as any).candidates)) ? (j as any).candidates
    : (j && typeof j === 'object' && Array.isArray((j as any).pitches)) ? (j as any).pitches
    : []
  const out: string[] = []
  for (const x of raw) {
    const raw0 = (typeof x === 'string') ? x
      : (x && Array.isArray(x.lines)) ? x.lines.map((l: any) => String(l || '')).join('\n')
      : String((x && (x.text || x.script || x.content)) || '')
    const t = raw0
      .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2190}-\u{21FF}]/gu, '')   // 零 emoji / 零箭头符号
      .split('\n')
      .map((s) => s.replace(/[ \t\u3000]+/g, ' ').replace(/^\s*[-·•*\d.、)）]+\s*/, '').trim())
      .filter(Boolean)
      .join('\n')
      .trim()
    if (t.replace(/\s+/g, '').length < 10) continue   // 太短 = 角度标签，不是稿子
    if (out.includes(t)) continue                     // 三条必须各不相同（用户"选"的前提）
    out.push(t.slice(0, 1200))
    if (out.length >= 3) break
  }
  return out
}

/** ★VF_FILM_PITCH_V2：把**定稿的口播稿切成 N 段**（**确定性**，不调模型、不删字、不改字）
 *  · ① 用户/模型已经写了正好 N 行 ⇒ **一行一段**（最符合预期，用户改哪行就改哪段）；
 *  · ② 否则按句末标点切句 → 按每段配额**装箱**（当前段装不下就进下一段，空段直接装）；
 *  · ③ 句子比段数还少 ⇒ 后面的段留空（**绝不复制凑数**，宁可那段静音）；
 *  · ④ 剩下的全部并入最后一段 ⇒ **各段拼起来 == 原稿**（这条是可断言的强性质）。
 *  返回长度恒等于 `quotas.length`。 */
export function splitPitchToSegments(text: string, quotas: number[]): string[] {
  const q = (Array.isArray(quotas) ? quotas : []).map((x) => Math.max(6, Math.round(Number(x) || 14)))
  const N = q.length
  if (!N) return []
  const raw = String(text || '').replace(/\r/g, '').trim()
  if (!raw) return Array.from({ length: N }, () => '')
  // ① 行数正好 = 段数 ⇒ 一行一段（保留用户的意图，不做任何再切）
  const lines = raw.split('\n')
    .map((s) => s.replace(/^\s*[-·•*\d.、)）]+\s*/, '').trim())
    .filter(Boolean)
  if (lines.length === N) return lines
  // ② 按句切（句末标点后断开；超长句再按逗号断，避免一段被一句撑爆）
  const flat = raw.replace(/\n+/g, '')
  const sents = flat.split(/(?<=[。！？!?；;])/).map((s) => s.trim()).filter(Boolean)
  const parts: string[] = []
  for (const s of sents) {
    if (s.length <= 30) { parts.push(s); continue }
    for (const c of s.split(/(?<=[，,])/)) { const t = c.trim(); if (t) parts.push(t) }
  }
  // ③ 装箱（**只做拼接，一个字都不删**）
  const out: string[] = Array.from({ length: N }, () => '')
  let k = 0
  for (const p of parts) {
    if (k >= N - 1) { out[N - 1] += p; continue }
    if (out[k] && (out[k].length + p.length) > q[k]) k++
    out[k] += p
  }
  return out.map((s) => s.trim())
}
