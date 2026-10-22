/**
 * ★VF_HTMLSTD_V1（2026-10-08 用户定案「要」）——「HTML成片」的**独立状态机**（第 8 条线）
 * =============================================================================
 * 用户原话（为什么做这个）：
 *   · 「要不要我照其他线的规矩改成状态机？大致三张卡：素材卡 / 风格卡 / 确认卡」→「**要**」
 *   · 之前它只是 `kind:'tool'`（一键出片、AI 提参数、只给一张完成卡）⇒ 与其它 7 条线**形态不一致**
 *     （用户实测时就问了："不是状态机吗"）。
 *
 * 形制**照 `vf-ppt.ts`**（用户定过的规矩：独立草稿 / 独立 step / 独立协议串 / 独立分派）：
 *   · 独立草稿：tag `vf_draft_htmlfilm`，前缀 `HTML成片草稿:`（用户隔离靠 userId）
 *   · 独立 step：`mat`（选素材）→ `style`（选风格包）→ `pitch`（口播营销稿 3 选 1，★VF_FILM_PITCH_V1）
 *                → `confirm`（确认出片）
 *   · 独立协议串：`VF_FILM_FORM:{at:'mat'|'style',…}`（卡片「下一步/上一步」）、
 *                `VF_FILM_GO:{…}`（确认卡「🎬 出片」）—— 只由我们自己的卡片产生，用户不会手打
 *   · 独立分派：route.ts 里一条 `stdCmdOwned(['film'])` 的 if 块（**不动任何老线**）
 *
 * ⚠️ 三条铁律（本项目历史踩坑，改这个文件前先读）：
 *   ① **第一步就必须落草稿**（PPT成片/视频混剪/获客线都因为"只出卡不落草稿"被闸门锁死过）；
 *   ② `stdHasAnyDraft` 必须登记本线（否则第二步协议串被当成"非命令"拦掉）；
 *   ③ `isStdNoDraftAllowed` 必须放行本线两条协议串（兜底：草稿因任何原因读不到时也不锁死）。
 *
 * 出片复用：`makeFilmFromMaterials`（编排 + 渲染）+ `filmDoneProtocol`（入个人仓库 + 签名 URL）
 *   —— 与旧的一键工具路径**同一份实现**，不另写一套。
 */
import fs from 'node:fs'
import path from 'node:path'
import { vfLog, vfStorageRoot, materialDir, listRepoMaterials, downloadMaterials } from '../video-material'
import { filmToolsDir, planFilm, makeFilmFromMaterials, filmDoneProtocol } from './vf-film'
// ★VF_CHARSET_V1（2026-10-09 用户实测「降级之后照样被 fonts 闸门拦」）：
//   把文案压回字体子集内的**唯一实现**（涮→烫、其余表外字删掉；只做减法不编造）
import { loadCharset, sanitizeText, sanitizeSlots } from './charset'
// ★VF_FILMCOPY_V5/V6：骨架 ↔ 文案的**唯一对齐口径**（按段号归位 + 分批 + 只补缺口）—— 单列成模块便于单测
import { alignCopy, mergeSlots, batchRanges } from './film-copy-align'
// ★VF_SPEC_V2：AI 自规划风格语法（**开关默认关**；关掉 ⇒ 零行为变化）—— 单列成模块便于单测
// ★VF_THEME_V1：`theme` 由 AI 定（完全自主模式）；★VF_PACKAI_V1：挑风格包也交给 AI（读图那一步）
// ★VF_LAY_V1：`pickLayId/describeLay/laySpec/mergeLay` = "图呈现（满幅压字）"的唯一口径（纯函数、可单测）
import { aiSpecEnabled, pickSpec, describeSpec, specPrompt, packPickPrompt, pickPackId, pickLayId, describeLay, laySpec, mergeLay } from './film-spec'
// ★VF_FILM_PITCH_V1/V2（2026-10-22）：口播营销稿的题面、解析、配额与**确定性切段**（白名单式，纯函数可单测）
import { pitchPrompt, pickPitchCandidates, pickPitchExtras, pitchStats, pitchQuotas, pitchNeedChars, splitPitchToSegments } from './film-spec'
// ★VF_VOICE_PICK_V1（2026-10-22 用户定案「配音不能选」+「加个字段给 AI 知道做什么配音合适」）：
//   **音色白名单/气质→音色映射的唯一真源**（48 个 + legacy 映射；AI 只判气质，音色由这里定）
import { TONE_LABEL, TONE_VOICES, pickTtsVoice, pickVoiceTone, ttsVoiceName, voiceForTone, voiceOptions } from './tts-voices'

const HTMLFILM_TAG = 'vf_draft_htmlfilm'
const HTMLFILM_PREFIX = 'HTML成片草稿:'

/** ★VF_FILMSRC_V2（2026-10-10 · P1）本线**代码版本戳**。
 *  为什么必须有：草案存在 DB 里、骨架是"当时代码"排的；一旦部署/改版（结构表、arrange 规则、
 *  闸门都变了），旧草案的**文案**与新代码排出的**骨架**必然错配 ——
 *  用户实测那次就是：卡片按 12 张排 8 段、出片按 17 张排 12 段，后 4 镜空、被 copy 闸门拦。
 *  口径：草案带版本；**出片前比对**，不一致 ⇒ **这一单作废**（明确让用户重走一遍），
 *  不猜、不合并、不"用旧文案配新骨架"。**改这里的值 = 让所有在飞草案失效**（部署即作废的实现）。 */
// ★VF_RATIO_V1（2026-10-10）：骨架算法改了（比例条取代写死 0.35）⇒ **版本戳必须升**，
//   否则在飞草案（旧比例排的骨架）会与新码排出的骨架/文案错配 —— 这正是这条纪律存在的理由。
// ★VF_LAY_V1（2026-10-14）：第 2 步卡多了「图呈现」（满幅压字 / 相纸不裁 / 跟风格），
//   它会**改变 spec**（image.place / complete）⇒ 改变排骨架 ⇒ 在飞草案（旧码排的骨架）必须作废 ⇒ 版本戳升。
// ★VF_FILM_PITCH_V1（2026-10-22）：第 2 步之后多了「口播营销稿 3 选 1 + 可编辑」（step='pitch'），
//   逐镜文案的第 4 步从"AI 各写一句 ≤18 字碎句"改成"**整稿切段**"⇒ 草案结构变了（pitch* 三字段）
//   且第 2 步不再直接出确认卡 ⇒ 旧草案（step:'confirm'、没有 pitchText）与新流程必然错配 ⇒ 版本戳必须升。
// ★VF_FILM_PITCH_V2（2026-10-22）：口播从"模型切段"改成"服务端确定性切段"，且稿长与段数绑死
//   ⇒ **在飞草案（V1 那单：确认卡上 voice 全空、稿只有二三十字）必须作废**，否则用户点出片还是老的坏结果。
export const FILM_LINE_VERSION = 'film-2026-10-22-pitch2'

export type HtmlFilmStep = 'mat' | 'style' | 'pitch' | 'confirm'

export type HtmlFilmDraft = {
  step: HtmlFilmStep
  /** 用户勾选的**个人仓库文件名**（空数组 = 用最近 FILM_DEFAULT_RECENT 张） */
  names: string[]
  /** 风格包 id（空 = 编排器按赛道自己挑） */
  pack: string
  /** 主题文本（可选，用于文案填充） */
  topic?: string
  // ★VF_FILMCOPY_V1（2026-10-09 用户定案「B该用模型就用模型 / 让 AI 先总结素材 / **不要乱出片**」）：
  /** AI 看图后的**素材总结**（一句话 + 逐张一句）——给用户看，也是写文案的依据 */
  summary?: string
  /** 骨架（每段结构 + 该段素材）；与出片时的排列**同序**（arrange 确定性） */
  plan?: Array<{ structure: string; media: string[] }>
  /** AI 按骨架写的**逐镜文案**（下标 = 骨架序号；key 按结构：title1/sub/chips/rows…） */
  copy?: any[]
  // ══ ★VF_FILMSRC_V1（2026-10-10 用户定案）════════════════════════════════════
  //   用户原话：「我不是给你一个比例（每 10 张 3~4 张完整大图）吗，多少帧多少镜不要做什么约束，
  //             那我给你 50 张图你也做 8 个镜头不肯定出问题吗？」
  //   病灶（本机核对出来的铁证）：这条线**在四处各算了一遍"这次用哪些素材"**，且各有固定上限
  //     · 卡片展示 40 张（repoImages）      · AI 写文案处 `.slice(0,12)` ← 只按 12 张排骨架
  //     · 出片处同一段逻辑但保留勾选的 17 张 ⇒ **同一条单卡片排 8 段、出片排 12 段**
  //     · 看图 `picked.slice(0,8)` ⇒ 50 张里 42 张 AI 从没见过
  //   ⇒ 文案按下标合并到分镜时就错位（后 4 镜空，被 copy 闸门拦）。
  //   现口径：**素材集合与骨架都只有一个真源** —— 写文案那一步定稿，出片只认这一份。
  /** ✅本次**实际用到的素材文件名**（写文案那一步定稿；出片**只认它**，不再重取/重切） */
  picked?: string[]
  /** 写文案那一步**真正读懂的图片张数**（分批读图的总数，给用户看，不藏） */
  readN?: number
  /** 写文案那一步编好的**整份 film.json**（出片直接用它 ⇒ 骨架不可能与文案错位） */
  filmJson?: any
  /** 编排判出来的赛道（出片复用，避免第二处口径） */
  vertical?: string
  /** ★VF_FILMSRC_V2：排这一单时的**代码版本**（出片前比对：不一致 ⇒ 这单作废、要求重来） */
  ver?: string
  /** ★VF_RATIO_V1：**大图:填图 比例**（**百分数 0~100**，默认 50 = 5:5）。
   *  为什么用百分数：卡片上显示/拖动就是"5 : 5"这种直观值；转成 0~1 只在传给引擎那一步做（一处）。 */
  plateRatio?: number
  /** ★VF_SPEC_V1：**风格语法**（L1 构图 / L2 动效 / L3 文本形态）——由 AI 声明（"四项全部让 AI 自己规划"），
   *  写进 film.json，由渲染器的语法层解释。没声明 ⇒ 用 pack.spec / 引擎默认。 */
  spec?: any
  /** ★VF_SPEC_V2：**这一单是否让 AI 规划风格语法**（第 2 步卡上的开关，默认不勾）。
   *  默认值由服务端总闸 `VF_FILM_AI_SPEC` 决定；用户可在卡上勾/取消 ⇒ 这里存**最终决定**。 */
  aiSpec?: boolean
  /** ★VF_THEME_V1（2026-10-11 用户定案「AI 完全自己画 就不要参与我们模版」）：
   *  勾了它 ⇒ **连配色也由 AI 定**（这一片不套库里风格包的皮肤），动效/排版全自主。
   *  引擎会判对比度，不合格**丢弃退回**风格包（防"墨绿一坨"）。 */
  aiPaint?: boolean
  /** ★VF_ASPECT_V1：画幅 '9:16'（竖，默认）| '16:9'（横）——出片时渲染侧按它选画布 */
  aspect?: string
  /** ★VF_LAY_V1（2026-10-14 用户定案「满幅压字要可选，而不是改老风格；AI 也可选」）：
   *  **图呈现**：'auto'（默认，跟风格包 / 交给 AI 判）| 'bleed'（满幅压字）| 'plate'（相纸不裁）。
   *  它是**用户声明**（第 2 步卡上的三选）——AI 的建议只在用户选 'auto' 时才写进这里。 */
  lay?: string
  /** ★VF_LAY_V1：**实际生效**的图呈现（AI 代选时与 lay 不同），给确认卡回显用 */
  layEff?: string
  // ══ ★VF_FILM_PITCH_V1（2026-10-22 用户原话「**不是改画面上的，改的是口播**。AI 出 3 条可以选、可以修改」）══
  //   为什么加这三段：老流程是"AI 按段各写一句 ≤18 字"⇒ 拼起来是一串碎句，不是连贯口播稿。
  //   现口径：先让 AI 出 **3 条完整的口播营销稿**（钩子型/优惠型/口碑型）⇒ 用户选 1 条、可手工改
  //   ⇒ 改完这条 = **逐段口播的唯一来源**（切成 N 段写进每段 voice）。
  /** 3 条候选（互不相同；下标 = 候选序号） */
  pitchCandidates?: string[]
  /** 用户选了第几条（下标；手工改过的内容存 pitchText） */
  pitchPick?: number
  /** **最终口播稿**（选中的那条 + 用户手工修改）—— 逐段 voice 只能由它切出来 */
  pitchText?: string
  // ══ ★VF_VOICE_PICK_V1（2026-10-22 用户定案「配音不能选」+「加个字段给 AI 知道做什么配音合适」）══
  /** AI 判的**口播气质**（lively/promo/warm/gang/doc/brand）—— 出稿那一次调用顺带产出；
   *  确认卡据此给**默认音色**（人可改）。AI 不直接给音色 id：它会把 48 个 id 编错。 */
  voiceTone?: string
  /** AI 判的**配乐曲风**（2~4 个汉字，如「轻快市井」）—— 这轮只显示 + 留档
   *  （乐库还空、MiniMax 音乐生成你说后面再看；将来挑曲/生成直接拿它当提示词）。 */
  musicMood?: string
}

/** 进程内缓存（与 vf-ppt.ts 同形制：DB 是主，Map 是"这一回合的加速"） */
const HTMLFILM_DRAFT = new Map<number, HtmlFilmDraft>()

/* ═══════════════ ★VF_FILMSRC_V1：素材集合 —— 全链**只有这一处** ═══════════════
   为什么单列（用户实测踩出来的）：同一条单，"卡片/看图/出片"三处各写了一份取素材逻辑，
   而且各有固定上限（12 / 8 / 40）⇒ 卡片按 12 张排 8 段、出片按 17 张排 12 段 ⇒
   文案按下标合进分镜就错位（后 4 镜空 ⇒ 被 copy 闸门拦）。
   现口径：
     · 上限**只有一个**（FILM_MAT_MAX），且**写进卡片让用户看得见**，不再是隐藏天花板；
     · 看图片数 = 用到的图片数（分批读，不再"只看前 8 张"）；
     · 定稿写进草案（vd.picked / vd.filmJson），出片**只认草案**。
   ⚠️ 要改上限请改环境变量 `VF_FILM_MAT_MAX`，**不要**再去别处写 slice(0,N)。 */
export const FILM_MAT_MAX = Math.max(20, Number(process.env.VF_FILM_MAT_MAX || 60) || 60)
/** 从个人仓库最多拉多少张**候选**（列表上限，不是使用上限） */
export const FILM_POOL_MAX = Math.max(FILM_MAT_MAX, 200)
/** 用户没勾选时的默认：最近 N 张（卡片上写着这句话，前端同口径） */
export const FILM_DEFAULT_RECENT = 12
/** AI 一次读图最多送几张（超过就**分批**，不再"只看前 8 张就写全片文案"） */
const VL_BATCH = 8

// ★VF_SPEC_V2（"让 AI 自己规划风格语法"，**开关默认关**）的实现全部在 `./film-spec`：
//   开关 `aiSpecEnabled()` / 白名单 `pickSpec()` / 人话说明 `describeSpec()` / 一页纸 `specPrompt()`。
//   单列成模块的理由：开关语义与白名单必须能**脱离模型单测**（见 temp/_spec/test.mjs）。

export type FilmPick = { pool: any[]; picked: any[]; missing: string[]; capped: number }

/** 取素材（**卡片展示 / 写文案 / 出片 三处共用**：唯一实现）。
 *  · `names` 非空 ⇒ 严格按用户勾选的**顺序**与名单取（顺序 = 出片顺序）；
 *    找不到的名字进 `missing`（调用方**必须如实报错**，绝不静默换素材）。
 *  · `names` 空 ⇒ 最近 FILM_DEFAULT_RECENT 张（与卡片提示同口径）。 */
export async function pickFilmMaterials(uid: number | string, names: string[]): Promise<FilmPick> {
  const repo = await listRepoMaterials(uid, FILM_POOL_MAX, 'recent')
  const pool = (repo || []).filter((m: any) => m?.kind === 'image')
  const want = (names || []).map((x) => String(x)).filter(Boolean)
  const picked: any[] = []
  const missing: string[] = []
  if (want.length) {
    for (const n of want) {
      const m = pool.find((x: any) => String(x.name) === n)
      if (m) picked.push(m); else missing.push(n)
    }
  } else {
    picked.push(...pool.slice(0, FILM_DEFAULT_RECENT))
  }
  const capped = Math.max(0, picked.length - FILM_MAT_MAX)
  return { pool, picked: capped ? picked.slice(0, FILM_MAT_MAX) : picked, missing, capped }
}

export async function saveHtmlFilmDraft(db: any, uid: number | string, d: HtmlFilmDraft): Promise<void> {
  HTMLFILM_DRAFT.set(Number(uid), d)
  const content = HTMLFILM_PREFIX + JSON.stringify({ ...d, __savedAt: Date.now() })
  try {
    const ex = await db.agentMemory.findFirst({
      where: { userId: String(uid), tags: { equals: HTMLFILM_TAG } },
      orderBy: { updatedAt: 'desc' },
    })
    if (ex) await db.agentMemory.update({ where: { id: ex.id }, data: { content, updatedAt: new Date() } })
    else await db.agentMemory.create({ data: { userId: String(uid), content, tags: HTMLFILM_TAG, salience: 0.5 } })
  } catch (e: any) {
    // ★VF_FILMSRC_V1（2026-10-10 用户实测「点出片说：这一单已经结束了」）：
    //   老代码这里是 `catch { /* 忽略 */ }` ⇒ **草案只存在内存里**、DB 写失败没人知道；
    //   一旦进程重启（部署/崩），这一单就"凭空消失"，用户只看到"没有进行中的流程"。
    //   现口径：**如实打日志**（内存 Map 仍在，本次流程照常；但重启后会丢，日志里能查到原因）。
    vfLog(uid, '[HTML成片] ⚠ 草案落库失败（重启后这一单会丢）：' + String(e?.message || e).slice(0, 160))
  }
}

export async function loadHtmlFilmDraft(db: any, uid: number | string): Promise<HtmlFilmDraft | null> {
  const mem = HTMLFILM_DRAFT.get(Number(uid))
  if (mem) return mem
  try {
    const r = await db.agentMemory.findFirst({
      where: { userId: String(uid), tags: { equals: HTMLFILM_TAG } },
      orderBy: { updatedAt: 'desc' },
    })
    const c = String(r?.content || '')
    if (!c.startsWith(HTMLFILM_PREFIX)) return null
    const j = JSON.parse(c.slice(c.indexOf('{')))
    return {
      // ★VF_FILM_PITCH_V1：**'pitch' 必须登记**（load 是白名单式重建，漏了 ⇒ 选了稿回来变成 'mat'，
      //   用户会看到"流程退回到选素材"）；下面的 pitch* 三字段同理 —— 漏了就等于把用户选的稿丢了。
      step: (['mat', 'style', 'pitch', 'confirm'].includes(String(j.step)) ? String(j.step) : 'mat') as HtmlFilmStep,
      names: Array.isArray(j.names) ? j.names.map((x: any) => String(x)) : [],
      pack: String(j.pack || ''),
      topic: String(j.topic || ''),
      // ★VF_FILMCOPY_V1：这三个字段**必须一起取回来**（load 是白名单式重建，漏一个就等于把 AI 写的文案丢了）
      summary: String(j.summary || ''),
      plan: Array.isArray(j.plan) ? j.plan : [],
      copy: Array.isArray(j.copy) ? j.copy : [],
      // ★VF_FILMSRC_V1：**单一真源字段也必须一起取回来** —— 漏了 picked/filmJson，
      //   重启后出片就会退回"重新取素材 + 重新编排"⇒ 又回到"卡片 8 段 / 出片 12 段"那个坑。
      picked: Array.isArray(j.picked) ? j.picked.map((x: any) => String(x)) : [],
      readN: Number(j.readN) || 0,
      filmJson: (j.filmJson && typeof j.filmJson === 'object') ? j.filmJson : null,
      vertical: String(j.vertical || ''),
      // ★VF_FILMSRC_V2：版本戳也要取回来（取不回来就当成"旧版本"⇒ 出片前作废要求重来，正好是想要的行为）
      ver: String(j.ver || ''),
      // ★VF_RATIO_V1：比例也要取回来（漏了它 ⇒ 出片时按默认 5:5 重排，与卡片上显示的比例不符）
      plateRatio: Number.isFinite(Number(j.plateRatio)) && j.plateRatio !== null && j.plateRatio !== undefined
        ? Number(j.plateRatio) : undefined,
      // ★VF_SPEC_V1：语法也一起取回（漏了它 ⇒ 出片时退回默认语法，与卡片上给用户看的风格不符）
      spec: (j.spec && typeof j.spec === 'object') ? j.spec : undefined,
      // ★VF_SPEC_V2：开关状态也要取回（漏了它 ⇒ "换风格"回来时开关会被重置成默认）
      aiSpec: j.aiSpec === undefined ? undefined : !!j.aiSpec,
      // ★VF_THEME_V1：完全自主开关也要取回（漏了 ⇒ "换风格"回来就丢了）
      aiPaint: j.aiPaint === undefined ? undefined : !!j.aiPaint,
      // ★VF_LAY_V1：图呈现也要取回（漏了 ⇒ "换风格"回来就变回"跟风格"，与卡片上显示的不符）。
      //   读法与 aspect 一致：合法值直接用；**旧草案没有这个字段** ⇒ undefined（由 at:'style' 那步补 'auto'）；
      //   万一存了非法值 ⇒ 退 'auto'（这是**内部读取**，草稿全是本线自己写的，不是"静默改用户的选择"）。
      lay: pickLayId(j.lay) || (j.lay === undefined ? undefined : 'auto'),
      layEff: pickLayId(j.layEff) || undefined,
      // ★VF_FILM_PITCH_V1：口播营销稿也要一起取回（漏了 ⇒ 用户选的那条稿在"下一步"后凭空消失，
      //   逐段 voice 就无从切起；见 195-198 那条注释：load 是白名单式重建，漏一个字段等于丢数据）
      pitchCandidates: Array.isArray(j.pitchCandidates)
        ? j.pitchCandidates.map((x: any) => String(x)).filter((x: string) => x.trim()).slice(0, 3) : [],
      pitchPick: Number.isFinite(Number(j.pitchPick)) ? Math.max(0, Math.round(Number(j.pitchPick))) : undefined,
      pitchText: typeof j.pitchText === 'string' ? j.pitchText.slice(0, 1500) : '',
      // ★VF_VOICE_PICK_V1：AI 的语气/曲风建议也要取回（漏了 ⇒ 确认卡上的"AI 建议"消失、默认音色退回 Cherry）
      voiceTone: pickVoiceTone(j.voiceTone) || '',
      musicMood: typeof j.musicMood === 'string' ? j.musicMood.slice(0, 20) : '',
    }
  } catch { return null }
}

/** ★VF_PACKAI_V1：给 AI 挑包用的**可用包清单**（体检通过的包；health.json 不存在 ⇒ 全给，不干预）。
 *  口径来源：tools/check-style-packs.mjs 产出的 styles/health.json（唯一体检真源）。 */
export async function availablePacks(): Promise<Array<{ id: string; name?: string; desc?: string; mood?: string }>> {
  try {
    const fs = await import('fs')
    const pt = await import('path')
    const dir = pt.join(filmToolsDir(), 'styles')
    const idx: any = JSON.parse(fs.readFileSync(pt.join(dir, 'index.json'), 'utf8'))
    let health: any = null
    try { health = JSON.parse(fs.readFileSync(pt.join(dir, 'health.json'), 'utf8')) } catch { health = null }
    const hitems = (health && health.items) || null
    return (Array.isArray(idx.items) ? idx.items : [])
      .filter((x: any) => !hitems || !hitems[x.id] || hitems[x.id].ok)
      .map((x: any) => ({ id: String(x.id), name: x.name, desc: x.desc, mood: x.mood }))
  } catch { return [] }
}

export async function clearHtmlFilmDraft(db: any, uid: number | string): Promise<void> {
  HTMLFILM_DRAFT.delete(Number(uid))
  try {
    await db.agentMemory.deleteMany({ where: { userId: String(uid), tags: { equals: HTMLFILM_TAG } } })
  } catch { /* ignore */ }
}

export async function hasHtmlFilmDraft(db: any, uid: number | string): Promise<boolean> {
  if (HTMLFILM_DRAFT.has(Number(uid))) return true
  try {
    const r = await db.agentMemory.findFirst({
      where: { userId: String(uid), tags: { equals: HTMLFILM_TAG } },
      orderBy: { updatedAt: 'desc' },
    })
    return String(r?.content || '').startsWith(HTMLFILM_PREFIX)
  } catch { return false }
}

/** 风格包清单（**读内置库** `html-deck/styles/index.json`，共 11 套）。
 *  ⚠️ 只读、不改；运行时库（后台新存的）本轮不并入 AGENT 卡片（那是本机实验室的事，先不耦合）。 */
export function htmlFilmPacks(): Array<{ id: string; name: string; mood: string; desc: string }> {
  try {
    const f = path.join(filmToolsDir(), 'styles', 'index.json')
    const j = JSON.parse(fs.readFileSync(f, 'utf8'))
    const items = Array.isArray(j?.items) ? j.items : []
    return items.map((x: any) => ({
      id: String(x.id || ''),
      name: String(x.name || x.id || ''),
      mood: String(x.mood || ''),
      desc: String(x.desc || ''),
    })).filter((x) => x.id)
  } catch { return [] }
}

/** 个人仓库里的图片（含 24h 签名缩略图）——素材卡用
 *  ★VF_FILMSRC_V1：这里的 40 也是"天花板"之一（用户有 50 张时后 10 张根本勾不到）
 *  ⇒ 统一到 FILM_POOL_MAX（候选池上限，与 pickFilmMaterials 同源）。 */
async function repoImages(uid: number | string): Promise<Array<{ name: string; url: string }>> {
  try {
    const items = await listRepoMaterials(uid, FILM_POOL_MAX, 'recent')
    const imgs = (items || []).filter((m: any) => m?.kind === 'image').slice(0, FILM_POOL_MAX)
    const { signedUrl } = await import('@/lib/oss')
    const out: Array<{ name: string; url: string }> = []
    for (const m of imgs) {
      let url = ''
      try { url = await signedUrl(`storage/${uid}/${m.name}`, 86400) } catch { /* 单张失败不影响整卡 */ }
      out.push({ name: String(m.name || ''), url })
    }
    return out
  } catch { return [] }
}

/** ★VF_JSONSCAN_V1（2026-10-09 用户实测「文案解析失败：Unexpected non-whitespace character after JSON」）：
 *  取**第一个完整**的 JSON 值（配对括号扫描，带字符串/转义处理）。
 *  为什么不能用 `indexOf('[')…lastIndexOf(']')`：模型常在 JSON 后面又补一段解释或**再吐一个数组**，
 *  那种切法会把尾巴一起塞进 JSON.parse ⇒ 直接解析失败（同一个坑在 scripts/vf-film-gen.mjs 已修过一次，
 *  这里当时没照抄 —— 我的疏漏）。 */
function scanJson(text: string): any | null {
  const s = String(text || '')
  for (let st = 0; st < s.length; st++) {
    const open = s[st]
    if (open !== '{' && open !== '[') continue
    const close = open === '{' ? '}' : ']'
    let depth = 0, inStr = false, esc = false
    for (let i = st; i < s.length; i++) {
      const c = s[i]
      if (inStr) {
        if (esc) esc = false
        else if (c === '\\') esc = true
        else if (c === '"') inStr = false
      } else if (c === '"') inStr = true
      else if (c === open) depth++
      else if (c === close) {
        depth--
        if (depth === 0) {
          try { return JSON.parse(s.slice(st, i + 1)) } catch { break }   // 这段不是合法 JSON ⇒ 从下一个位置再试
        }
      }
    }
  }
  return null
}

/** ★VF_FILMCOPY_V2 降级用：用**读图总结**里的词直接拼一版文案（**取材于素材本身 ⇒ 不算编造、也不带数字**）。
 *  为什么要有它：AI 文案抽风时不能把整条线卡死（用户："为什么老是出错"）；但也不能编造 ⇒
 *  就从视觉模型对这批素材的真实描述里取词。
 *  ★VF_CHARSET_V1（2026-10-09 用户实测「降级之后照样被 fonts 闸门拦」）修两处：
 *    ① **取词后一律压回字表内** —— 老实现直接把总结里的词塞进文案，而总结里就可能有表外字
 *       （本例：「涮羊肉片」的「涮」）⇒ 降级反而制造下一次失败（引擎 fonts 闸门拦死出片）。
 *    ② **修"每条都一样"** —— 老实现 `lines[min(len-1, i)]` ⇒ 词用完后后面几镜全重复同一句
 *       （用户截图就是"烤鸭肉 · 涮羊肉片 毛肚…"重复 5 次）；现在按镜号**轮着用**词，并优先取短词（菜名）。 */
export function deriveCopyFromSummary(summary: string, scenes: Array<{ structure: string; media: string[] }>): any[] {
  const set = loadCharset(path.join(filmToolsDir(), 'fonts', 'chars-cmn.txt'))
  // ★VF_FILM_PITCH_V2（2026-10-22 用户实测 13/14/15 段被补成「第四张 · 第五张」）：
  //   读图总结里天然带「第一张：…」「图8：…」这类**序号行** —— 那是"第几张照片"，**不是文案**。
  //   兜底时把它们当短词用，成片里就会念一堆"第四张 第五张"（用户看到的正是这个）。
  //   口径：**以序号开头的整条一律剔除**（宁可这一镜少个词，也不产出这种废话）。
  const PAGE = /^第?\s*[一二三四五六七八九十百零两0-9]+\s*[张幅图]/
  const raw = String(summary || '')
    .split(/[\n；;，。,.、:：]+/).map((s) => s.replace(/^\s*[\d.、)）]+\s*/, '').trim())
  const all0 = raw.filter((s) => s.length >= 2 && !PAGE.test(s))
  // ★VF_FILMCOPY_V4（2026-10-10 · P2）：**降级时不写"做法"** —— 视觉模型最爱把做法猜错
  //   （用户现场实例：把一盘生毛肚读成「**烤制**牛肚」）。降级拼句本就是从读图词里取词，
  //   一旦把猜错的做法词当标题写进画面，就是"拿错的东西当事实"。
  //   口径：读图词里**含做法动词的整条丢掉**（烤/炸/卤/蒸/煮/炒/炖/焖/煎/拌/腌/熏/烧）；
  //   只有"所有候选都带做法"时才退回去用（宁可少信息，也不能整片文案空着）。
  const COOK = /[烤炸卤蒸煮炒炖焖煎拌腌熏烧]/
  const all = (() => {
    const clean = all0.filter((s) => !COOK.test(s))
    if (clean.length >= 2) {
      if (clean.length !== all0.length) console.log('[film] 降级拼句：丢掉 ' + (all0.length - clean.length) + ' 条含"做法"的读图词（做法容易认错）')
      return clean
    }
    return all0
  })()
  const shortWords = all.filter((s) => s.length <= 8)                 // 优先短词（菜名/场景名），别把整句塞进标题
  const words = (shortWords.length >= 2 ? shortWords : all)
    .map((w) => sanitizeText(w, set)[0]).filter((w) => w.length >= 2)  // ★压回字表内（删字不换词）
  const pick = (i: number) => (words.length ? words[((i % words.length) + words.length) % words.length] : '')
  return scenes.map((sc, i) => {
    const a = pick(i)
    const b = words.length > 1 ? pick(i + 1) : ''
    const short = String(a || '').slice(0, 8)
    const sub = (b && b !== a ? String(b) : '').slice(0, 16)
    const slots: any = {}
    const st = String(sc.structure || '')
    if (st === 'opening-hero') { slots.title1 = short; if (sub) slots.sub = sub }
    else if (st === 'works-wall') { slots.title = short; slots.rows = [] }
    else if (st === 'grid-2x2') { slots.title = short; slots.nums = ['01', '02', '03', '04'] }
    else { slots.title = short; if (sub) slots.sub = sub }
    return { slots }
  })
}

/** ★VF_FILM_PITCH_V1（2026-10-22 用户定案「**不是改画面上的，改的是口播**。AI 出 3 条可以选、可以修改」）——
 *  「下一步」那一下的**第一段**：看懂素材 → 排好骨架 → **出 3 条完整口播营销稿**（到这里为止，**不写逐镜文案**）。
 *
 *  为什么拆成两段（原来是一个 `aiPrepareCopy` 一口气干完）：
 *    老流程"AI 按段各写一句 ≤18 字"⇒ 拼起来是**一串碎句**，不是连贯口播稿；
 *    现流程要求"先出一整稿 → 用户选/改 → 再切段"⇒ 写逐镜文案那一步必须**晚于**用户挑稿，
 *    而且它**只认定稿**（骨架/读图总结在第一步就固化了，第二步绝不重排、不重取素材）。
 *
 *  ★VF_FILMCOPY_V1 沿用：先总结素材、不看清就不许出片；① 看图 ② 排骨架 ③ 出口播稿。
 *  ⚠️ 与 scripts/vf-film-gen.mjs 同一套硬规矩（不编数据 / 零 emoji / 不造品牌）。 */
async function aiPreparePitch(ctx: HtmlFilmCtx, uid: number | string, vd: HtmlFilmDraft):
Promise<{ ok: boolean; err?: string; summary?: string; plan?: any[]; warn?: string
  picked?: string[]; readN?: number; filmJson?: any; vertical?: string
  /** ★VF_FILM_PITCH_V1：3 条口播营销稿候选（互不相同） */
  pitchCandidates?: string[]
  /** ★VF_SPEC_V2：AI 规划的风格语法（开关关闭 / 失败 ⇒ undefined = 用引擎默认） */
  spec?: any
  /** 给用户看的一句话（"AI 规划了什么" / "为什么没用上"） */
  specNote?: string }> {
  if (!ctx.generateText) return { ok: false, err: '服务端没接上文案模型（generateText 未注入）' }
  // ① 素材（★VF_FILMSRC_V1：**唯一实现** pickFilmMaterials —— 与本线卡片、出片三处共用）
  let pick: FilmPick = { pool: [], picked: [], missing: [], capped: 0 }
  try { pick = await pickFilmMaterials(uid, vd.names) } catch { /* 取不到就走下面"没有可用图片" */ }
  const picked = pick.picked
  if (!picked.length) return { ok: false, err: '还没有原始素材（只列你上传的图，成片不算）' }
  // 勾选的图被删/被移出候选池 ⇒ **如实报错**（绝不静默换素材：换了素材，文案与分镜就必然错位）
  if (pick.missing.length) {
    return { ok: false, err: '有 ' + pick.missing.length + ' 张勾选的图片在原始素材里找不到了（'
      + pick.missing.slice(0, 3).join('、') + (pick.missing.length > 3 ? ' …' : '') + '）——请回上一步「刷新列表」后重新勾选' }
  }
  // ② 看图总结（★VF_FILMSRC_V1：**分批读完所有要用的图** —— 老实现只看前 8 张，
  //    50 张素材里 42 张 AI 从没见过 ⇒ 写出来的文案自然对不上后面那些张）。
  //    读图失败**不判死**（少点信息也比卡住好；文案本身仍必须写出来）。
  let summary = ''
  let readN = 0
  // ★VF_FILMCOPY_V5：读图失败的真因（老实现被 catch 吞掉 ⇒ 用户只看到"没有读图总结可兜底"）
  let vlErr = ''
  try {
    const { signedUrl } = await import('@/lib/oss')
    const { describeImagesWithVL, vlReady, vlModel } = await import('@/lib/ai-providers')
    const batches = Math.max(1, Math.ceil(picked.length / VL_BATCH))
    const parts: string[] = []
    // ★VF_VLPROBE_V1（2026-10-10 用户日志实测「读图：0/17 张（分 3 批）」）：
    //   `describeImagesWithVL` **没配 key 时是 `return null`（静默）** —— 我们只看到"返回空"，
    //   最容易被误读成"模型故障/限流"，白花几轮（这次真因很可能就是服务端缺 DASHSCOPE_API_KEY）。
    //   现口径：**先探针**，缺 key 就明说、并且**不再空打 3 批模型**（省时间也省日志噪声）。
    if (!vlReady()) {
      vlErr = '服务端未配置视觉模型 key（缺 DASHSCOPE_API_KEY）⇒ 读图未启用'
      vfLog(uid, '[HTML成片] ⚠️ ' + vlErr)
    }
    for (let bi = 0; vlReady() && bi < batches; bi++) {
      const batch = picked.slice(bi * VL_BATCH, (bi + 1) * VL_BATCH)
      const urls: string[] = []
      for (const m of batch) {
        try { urls.push(await signedUrl('storage/' + uid + '/' + m.name, 3600)) } catch { /* 单张失败跳过 */ }
      }
      if (!urls.length) { if (!vlErr) vlErr = '素材签名 URL 拿不到（OSS 签名失败？）'; continue }
      const ask = '这是一组【餐饮/美食实拍】照片（第 ' + (bi + 1) + ' 批，共 ' + batches + ' 批）。'
        + '只回两段：第一段一句话总结这批素材是什么（≤30 字）；第二段逐张一行说清每张拍的是什么（菜名/场景），不要编号、不要多余解释。'
      // ★VF_FILMCOPY_V5：读图失败**重试一次** —— 它不再只是"补充信息"，而是文案兜底的**唯一依据**；
      //   而且失败原因必须**记下来**（老实现只 catch 掉 ⇒ 用户只看到"没有读图总结可兜底"，查不到真因）。
      let okBatch = false
      for (let tries = 1; tries <= 2 && !okBatch; tries++) {
        try {
          const r = await describeImagesWithVL(urls, ask, 700)
          if (String(r || '').trim()) { parts.push(String(r).trim()); okBatch = true }
          // ★VF_VLMODEL_V1：把"用的哪个模型"写进原因 —— 用户实测真因就是 `qwen-vl-max` 不存在（404）
          else if (!vlErr) vlErr = '视觉模型未返回内容（当前模型 ' + vlModel() + '）'
            + '—— 若服务端日志里出现 model_not_found，请用环境变量 VF_VL_MODEL 指定可用模型名'
        } catch (e: any) {
          if (!vlErr) vlErr = '视觉模型调用失败：' + String(e?.message || e).slice(0, 90)
        }
      }
      if (okBatch) readN += urls.length
    }
    summary = parts.join('\n')
    vfLog(uid, `[HTML成片] 读图：${readN}/${picked.length} 张（分 ${batches} 批）· 素材 ${picked.length} 张（仓库候选 ${pick.pool.length}${pick.capped ? ' · 超上限砍 ' + pick.capped : ''}）`)
    // ★VF_FILMCOPY_V5b：**读图 0 张必须留一条显眼的日志**（否则只能靠卡片上那句话猜）
    if (!readN) vfLog(uid, '[HTML成片] ⚠️ 读图 0 张：' + (vlErr || '原因未记录') + ' ⇒ 文案没有素材依据（只能按骨架写，贴合度会明显变差）')
  } catch { /* ignore */ }
  // ③ 骨架（只出骨架、不渲染）——需要**本地文件**，先下载（与出片同一步）
  const workDir = path.join(vfStorageRoot(), String(uid), 'video-factory', 'film_' + Date.now())
  let files: string[] = []
  try {
    const dl = await downloadMaterials(uid, picked)
    files = (dl || []).map((m: any) => String(m.localPath || '')).filter(Boolean)
    if (!files.length) {
      try {
        const md = materialDir(uid)
        files = fs.readdirSync(md).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).map((f) => path.join(md, f))
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  if (!files.length) return { ok: false, err: '素材下载失败（没拿到本地文件）' }
  // ★VF_SPEC_V2：**开关打开时**，在排骨架**之前**让 AI 先定"风格语法"（理由见 AI_SPEC 注释）。
  //   关（默认）⇒ 这段完全不进 ⇒ 与今天之前的行为**一模一样**。
  let spec: any = vd.spec || undefined
  let specNote = ''
  // ★VF_PACKAI_V1：AI 挑的风格包（用户手动选了包就**以用户的为准**，这里不挑）
  let packNote = ''
  // ★VF_PACKAI_V1（2026-10-11 用户定案「AI审图的时候就挑选可用的可以吗？」）：
  //   **就在读图/审图这一步顺便挑包** —— 旧的"赛道 prefer[0]"永远同一个包、轮换又会轮到难看的，
  //   所以改成：AI 看着素材，从**体检通过**的包里挑一个；编的 id 一律不认（退回引擎兜底）。
  if (!vd.pack) {
    try {
      const cand = await availablePacks()
      if (cand.length) {
        const pkTxt = String(await ctx.generateText(
          packPickPrompt(cand, summary, String(vd.topic || ''))) || '')
        const pkj = scanJson(pkTxt)
        const pid = pickPackId(pkj, cand.map((x) => x.id))
        if (pid) {
          vd.pack = pid
          packNote = '🎨 AI 按素材挑的风格包：' + pid + '（从 ' + cand.length + ' 个可用包里挑）'
          vfLog(uid, '[HTML成片] AI 挑风格包：' + pid)
        } else {
          vfLog(uid, '[HTML成片] AI 挑风格包：没给出可用 id ⇒ 退回引擎兜底')
        }
        // ★VF_LAY_V1（2026-10-14）：**同一次调用顺带**问"图呈现"（不多烧一次点）。
        //   只在用户没手选时采纳 —— 用户在第 2 步卡上选了 bleed/plate ⇒ AI 的建议一律不覆盖。
        const aiLay = pickLayId(pkj && pkj.lay)
        if (aiLay && aiLay !== 'auto' && (!vd.lay || vd.lay === 'auto')) {
          vd.lay = aiLay
          vfLog(uid, '[HTML成片] AI 按素材判图呈现：' + aiLay + '（' + describeLay(aiLay) + '）')
        } else if (aiLay) {
          vfLog(uid, '[HTML成片] AI 建议图呈现=' + aiLay + '，但用户已选 ' + (vd.lay || 'auto') + ' ⇒ 以用户为准')
        }
      }
    } catch (e: any) {
      vfLog(uid, '[HTML成片] AI 挑风格包失败：' + String(e?.message || e).slice(0, 80) + ' ⇒ 退回引擎兜底')
    }
  }
  // 这一单到底走不走"AI 规划"：**草稿里的开关优先**（用户在第 2 步卡上勾的），
  //   草稿没存过才退回服务端总闸。默认（不勾 + 总闸未开）⇒ 整段不进 ⇒ 与老流程完全一致。
  const wantSpec = vd.aiSpec === undefined ? aiSpecEnabled() : !!vd.aiSpec
  // ★VF_THEME_V1：勾了「AI 完全自主」⇒ 强制走这段（连配色一起交给 AI）
  const wantPaint = !!vd.aiPaint
  if ((wantSpec || wantPaint) && !spec) {
    try {
      const spTxt = String(await ctx.generateText(
        specPrompt(summary, picked.length, String(vd.topic || ''), wantPaint)) || '')
      const sp = pickSpec(scanJson(spTxt))
      if (sp) {
        spec = sp
        specNote = (wantPaint && sp.theme ? '🧪 AI 完全自主：配色/动效由 AI 定（不用库里模板皮肤）· ' : '🎨 风格语法由 AI 规划：')
          + describeSpec(sp) + (packNote ? ' · ' + packNote : '')
        vfLog(uid, '[HTML成片] AI 规划风格语法：' + JSON.stringify(sp))
      } else {
        specNote = 'ℹ️ 这一步 AI 没给出风格语法，已用引擎默认（不影响出片）'
      }
    } catch (e: any) {
      specNote = 'ℹ️ 风格语法规划失败（' + String(e?.message || e).slice(0, 60) + '），已用引擎默认'
    }
    if (specNote) vfLog(uid, '[HTML成片] ' + specNote)
  }
  // ★VF_LAY_V1（2026-10-14 用户定案「满幅压字要可选，而不是改老风格；AI 也可选」）：
  //   把"图呈现"**覆盖进 spec**（优先级：用户手选 > AI 规划 > 风格包 spec > 引擎默认）。
  //   ⚠️ 位置**必须在 planFilm 之前**：`image.complete` 决定 arrange 允不允许 fullbleed，
  //      声明晚了骨架与声明打架 ⇒ 出片被 stage=spec 拒渲（2026-10-10 实测抓过）。
  //   不选（auto）⇒ 一个键都不覆盖 ⇒ 与今天完全一致。
  const layEff = pickLayId(vd.lay) || 'auto'
  vd.layEff = layEff
  if (layEff !== 'auto') {
    spec = mergeLay(spec, layEff)
    vfLog(uid, '[HTML成片] 图呈现=' + layEff + '（' + describeLay(layEff) + '）⇒ spec 覆盖 ' + JSON.stringify(laySpec(layEff)))
  }
  // ★VF_RATIO_V1：**比例在这里生效**（骨架只编一次 ⇒ 必须是"排骨架"的这一步拿到它）。
  //   草稿里存的是百分数（0~100），传给引擎时统一除 100（**只在这一处换算**，别处一律百分数）。
  const pl = await planFilm({
    materials: files, text: String(vd.topic || ''), pack: vd.pack || '', workDir,
    plateRatio: (vd.plateRatio === undefined ? 60 : Number(vd.plateRatio)) / 100,
    // ★VF_ASPECT_V1：画幅随骨架写入（出片时渲染侧按它选画布）
    aspect: vd.aspect === '16:9' ? '16:9' : '9:16',
    // ★VF_SPEC_V1/V2：语法（AI 声明的 ⇒ 由引擎解释；没声明 ⇒ pack/引擎默认兜底）
    spec,
  })
  if (!pl.ok || !pl.scenes || !pl.scenes.length) return { ok: false, err: '编排骨架失败：' + String(pl.err || '') }
  // ★VF_FILMSRC_V1：把**这份骨架本身**（整份 film.json）与素材名单一起固化 —— 出片直接用它，
  //   不再重新编排（老实现出片会再 orchestrate 一次；素材一变 ⇒ 段数一变 ⇒ 整片文案错位）。
  const filmJson = pl.film
  const vertical = String(pl.vertical || '')
  // ★VF_FILMSRC_V1：**直接写进草稿**（调用方随后 save 的就是这个对象）——
  //   刻意不在三个 return 分支里各写一遍：那又是"同一件事多处实现"，正是本线的老毛病。
  //   出片（VF_FILM_GO）只认这四个字段：素材名单 / 读图数 / 整份骨架 / 赛道。
  vd.picked = picked.map((m: any) => String(m.name))
  vd.readN = readN
  vd.filmJson = filmJson
  vd.vertical = vertical
  vd.ver = FILM_LINE_VERSION   // ★VF_FILMSRC_V2：文案与骨架是"这一版代码"排的
  // ══ ★VF_FILM_PITCH_V1：**第一段到此为止** —— 先出 3 条口播营销稿；逐镜文案等用户挑完稿再写 ══
  const planOut0 = pl.scenes.map((s) => ({ structure: s.structure, media: s.media, dur: s.dur }))
  // ★VF_FILM_PITCH_V2：配额按骨架每段真实时长算（唯一口径：`film-spec.ts::pitchQuotas`）
  const quotas0 = pitchQuotas(pl.scenes.map((s) => s.dur))
  const pitch = await genPitchCandidates(ctx, uid, summary, String(vd.topic || ''), planTextOf(pl.scenes), quotas0)
  if (!pitch.candidates.length) {
    return { ok: false, err: '没能让 AI 写出可用的口播营销稿'
      + (pitch.err ? '（' + String(pitch.err).slice(0, 90) + '）' : '')
      + ' —— **没有出片**。可稍后重试，或回上一步换一批素材。' }
  }
  vd.pitchCandidates = pitch.candidates
  vd.pitchPick = 0
  vd.pitchText = pitch.candidates[0]
  // ★VF_VOICE_PICK_V1：AI 判的"气质 / 曲风"落进草稿（确认卡据此给默认音色；曲风将来挑曲用）
  vd.voiceTone = pickVoiceTone(pitch.tone) || ''
  vd.musicMood = String(pitch.music || '').slice(0, 20)
  vfLog(uid, '[HTML成片] 口播营销稿：AI 出了 ' + pitch.candidates.length + ' 条候选（'
    + pitch.candidates.map((x) => pitchStats(x).chars + ' 字/' + pitchStats(x).lines + ' 行').join(' / ')
    + '）· 这条片需要约 ' + pitch.needChars + ' 字'
    + (vd.voiceTone ? ' · 气质=' + (TONE_LABEL[vd.voiceTone] || vd.voiceTone) : ''))
  return { ok: true, summary, plan: planOut0, pitchCandidates: pitch.candidates, warn: pitch.warn, spec, specNote }
}

/** 骨架 → 段落清单（**唯一实现**：口播稿题面、逐镜切段两处共用同一份描述） */
function planTextOf(scenes: Array<{ structure: string; media: string[] }>): string {
  return scenes.map((s, i) => '  ' + i + '. ' + s.structure + '（素材 ' + ((s.media || []).length) + ' 张）').join('\n')
    + '\n  ⇒ **这条片一共 ' + scenes.length + ' 段**'
}

/** ★VF_FILM_PITCH_V1：出 3 条口播营销稿（钩子型 / 优惠型 / 口碑型）。
 *  ★VF_FILM_PITCH_V2（2026-10-22 用户实测「稿太短」）：**篇幅与段数必须绑死** ——
 *  老题面只写"每条 120~180 字"（与段数无关的固定值），15 段 / 54 秒的片子照样只拿到 29 字。
 *  现口径：先按骨架每段**真实时长**算配额（`pitchQuotas`）⇒ 把"N 段 / 每段 X~Y 字 / 全稿 Z 字 / 正好 N 行"写进题面
 *  ⇒ 出稿后**硬校验字数**；明显不够就带着"上一次只有 N 字"**重写一次**；仍不够**如实告警**（不假装合格）。 */
async function genPitchCandidates(ctx: HtmlFilmCtx, uid: number | string,
  summary: string, topic: string, planTxt: string, quotas: number[]):
Promise<{ candidates: string[]; warn?: string; err?: string; needChars: number
  /** ★VF_VOICE_PICK_V1：AI 顺带判的"口播气质 / 配乐曲风"（白名单式，非法值 ⇒ ''） */
  tone?: string; music?: string }> {
  const need = pitchNeedChars(quotas)
  const perSegMin = 13
  const perSegMax = 18
  const low = Math.round(need * 0.6)   // 低于这个数 = 成片会大段静音 ⇒ 必须重写一次
  const gen = ctx.generateText
  if (!gen) return { candidates: [], err: '服务端没接上文案模型（generateText 未注入）', needChars: need }
  const ask = (retryNote: string) => pitchPrompt({
    summary, topic, planTxt, segs: quotas.length, needChars: need, perSegMin, perSegMax,
  }) + (retryNote ? '\n\n【重写要求】' + retryNote : '')
  let err = ''
  let best: string[] = []
  let bestChars = 0
  let bestLines = 0
  for (let attempt = 1; attempt <= 2; attempt++) {
    let txt = ''
    const retryNote = attempt === 1 ? ''
      : '上一次每条只写了 ' + bestChars + ' 字 / ' + bestLines + ' 行，远少于要求。这次必须写到 '
        + Math.round(need * 0.85) + '~' + Math.round(need * 1.25) + ' 字、**正好 ' + quotas.length + ' 行**'
        + '（每行 ' + perSegMin + '~' + perSegMax + ' 字），不够就是不合格。'
    try {
      txt = String(await gen(ask(retryNote)) || '')
    } catch (e: any) {
      err = '模型调用失败：' + String(e?.message || e).slice(0, 90)
      break
    }
    const j = scanJson(String(txt).replace(/```(?:json)?/gi, ''))
    const cands = pickPitchCandidates(j)
    // ★VF_VOICE_PICK_V1：同一次回答里顺带取的"气质 / 曲风"（白名单式；拿不到就当没有，不影响流程）
    const ex = pickPitchExtras(j)
    if (!cands.length) {
      err = 'AI 没给出可用的口播稿'
        + (txt.trim() ? '（原文片段：' + txt.replace(/\s+/g, ' ').trim().slice(0, 120) + '）' : '（返回是空的）')
      continue
    }
    // 三条候选角度不同，取**最长的那条**当"够不够长"的判据（其余原样给用户选）
    let top = cands[0]
    for (const c of cands) if (pitchStats(c).chars > pitchStats(top).chars) top = c
    const st = pitchStats(top)
    if (st.chars > bestChars) { best = cands; bestChars = st.chars; bestLines = st.lines }
    if (st.chars >= low) {
      if (cands.length < 3) {
        vfLog(uid, '[HTML成片] 口播稿：AI 只给了 ' + cands.length + ' 条可用候选（要 3 条）—— 如实按 ' + cands.length + ' 条给用户')
      }
      if (ex.tone || ex.music) {
        vfLog(uid, '[HTML成片] AI 建议：气质=' + (ex.tone || '未给') + '（推荐音色 ' + voiceForTone(ex.tone) + '）· 曲风=' + (ex.music || '未给'))
      }
      if (st.chars < Math.round(need * 0.85)) {
        return { candidates: cands, needChars: need, tone: ex.tone, music: ex.music,
          warn: 'ℹ️ AI 写的稿偏短（' + st.chars + ' 字 / 这条片需要约 ' + need + ' 字）—— 可以在框里补两句，或点「← 换风格」重来一次。' }
      }
      return { candidates: cands, needChars: need, tone: ex.tone, music: ex.music }
    }
    vfLog(uid, `[HTML成片] 口播稿第 ${attempt} 次不够长：最好一条 ${st.chars} 字 / ${st.lines} 行（需要 ≥${low} 字 / ${quotas.length} 行）`)
  }
  // 两次都没到"能用的下限" ⇒ 有稿就给（**如实告警**，让用户自己补），没稿才降级
  if (best.length) {
    const perSeg = Math.max(1, Math.round(need / Math.max(1, quotas.length)))
    vfLog(uid, '[HTML成片] ⚠️ 口播稿两次都偏短，按现有 ' + bestChars + ' 字交给用户（可在框里补写）')
    return { candidates: best, needChars: need,
      warn: '⚠️ AI 写的稿太短（' + bestChars + ' 字 / 这条片需要约 ' + need + ' 字，共 ' + quotas.length + ' 段）'
        + '—— 直接出片的话大概只有前 ' + Math.max(1, Math.round(bestChars / perSeg)) + ' 段有配音，其余段静音。'
        + '请在下面的框里补充到约 ' + need + ' 字（一行一段），或点「← 换风格」重写一次。' }
  }
  // 降级：用**读图总结**拼一条（取材于素材本身 ⇒ 不编造；没有读图结果就如实失败）
  const fb = String(summary || '').replace(/\s+/g, ' ').trim()
  if (!fb) return { candidates: [], err, needChars: need }
  vfLog(uid, '[HTML成片] 口播稿降级为"读图拼句"：' + err)
  return {
    candidates: [(topic ? topic + '。' : '') + fb.slice(0, 110)],
    needChars: need,
    warn: '⚠️ 这次没能让 AI 写出 3 条口播营销稿（' + err + '），已按**读图结果**拼了一条兜底稿；'
      + '建议点「← 换风格」重试，或在下面的框里自己改。',
  }
}

/** ★VF_FILM_PITCH_V1 第二段：把**用户定稿的口播稿**按骨架切成 N 段写进每段 `voice`（口播的唯一来源），
 *  同时按结构填画面文案（画面字是"看"的、voice 是"听"的 —— 谁都不许照抄对方）。
 *
 *  ⚠️ **只认第 2 步的定稿**（`vd.filmJson` / `vd.plan` / `vd.summary`）：这里**绝不重排骨架、绝不重取素材**
 *     —— 重排必然让"用户看过的那份稿"与成片段数错配（本线历史上的老坑）。
 *  校验/降级沿用 ★VF_FILMCOPY_V2/V5：按段号归位、分批请求、只补缺口、失败如实告知。 */
async function aiWriteCopyByPitch(ctx: HtmlFilmCtx, uid: number | string, vd: HtmlFilmDraft, pitchText: string):
Promise<{ ok: boolean; err?: string; copy?: any[]; plan?: any[]; warn?: string
  /** ★VF_FILM_PITCH_V2：有几段切到了口播 / 这条片需要多少字（卡片与日志的**同一份读数**） */
  voiceN?: number; needChars?: number }> {
  if (!ctx.generateText) return { ok: false, err: '服务端没接上文案模型（generateText 未注入）' }
  const scenes: any[] = Array.isArray(vd.filmJson?.scenes) ? vd.filmJson.scenes
    : (Array.isArray(vd.plan) ? vd.plan : [])
  if (!scenes.length) return { ok: false, err: '这一单的骨架丢了（草稿里没有分段）——请点「← 换风格」重走一次' }
  const summary = String(vd.summary || '')
  const pitch = String(pitchText || '').trim()
  const planTxt = planTextOf(scenes)
  // ④ 让模型按骨架填文案（口播 = **整稿切段**，不是各写各的）
  const guide = [
    'opening-hero  开场封面：slots{eyebrow,title1,title2,sub,foot}        media=1 张',
    'plate-top     ★完整大图（图整张不裁 · 标题在图**上方**）：slots{eyebrow,title,sub,chips[1~4],foot} media=1 张',
    'plate-bottom  ★完整大图（图整张不裁 · 文案在图下方）：slots{eyebrow,title,sub,chips[1~4],foot} media=1 张',
    'fullbleed     满幅实拍（**裁切**满屏）：slots{eyebrow,title,sub,chips[1~4],foot}  media=1 张',
    'works-wall    作品墙(3图)：slots{title,sub,rows[3],foot}             media=3 张',
    'grid-2x2      四宫格(4图)：slots{title,sub,nums[4],tail,foot}         media=4 张',
    'glass-product 结尾卡(无图)：slots{eyebrow,title,sub}（**不要写 value/unit/kpi**）media=0',
  ].join('\n  ')
  // ★VF_FILM_PITCH_V1：planTxt 在函数开头已用 `planTextOf(scenes)` 生成（**唯一实现**），这里不再重算
  const prompt = '你是一位竖屏短视频（9:16）的文案。素材是一组餐饮/美食实拍。\n'
    + (vd.topic ? '主题/卖点：' + vd.topic + '\n' : '（用户没给主题：请**只依据素材**写，不要自创品牌、不要编数据）\n')
    + (summary ? '【素材总结（视觉模型读图所得）】\n' + summary + '\n' : '')
    + '【这条片的段落骨架（顺序固定，不要增删）】\n' + planTxt + '\n\n'
    + '请为**每一段**填文案（按结构给对应的 key）：\n  ' + guide + '\n\n'
    + '【硬规矩 · 违反即返工】\n'
    + '1. **绝对不许编造数据**：不许出现曝光/点击率/转化/百分比/排名等没有来源的数字；也不许写"数据驱动/实时监控"这类跟素材无关的话。\n'
    + '2. 零 emoji、零符号图标；不要英文小字（结尾卡的 eyebrow 也写中文）。\n'
    + '3. 每段文案合计 ≤60 字；chips 每条 ≤3 字；rows 每条 ≤12 字。\n'
    // ★扩表 B（2026-10-10）：字表扩到 GB2312 全集（6763 字）⇒ 「涮」等二级字已可用，
    //   原来的"绝对不许写涮"改成软提示（否则 AI 会把正确菜名写成"烫"，反而更不像人话）。
    + '4. **用字**：写常用字即可（引擎字表覆盖 GB2312 全集 6763 字，「涮/糍/粑」这类都能写）；'
    + '尽量避开罕用字与异体字（真撞到表外字会被如实压回并告知，不会静默）。\n'
    // ★VF_FILMCOPY_V5（2026-10-10 用户实测「段数 13 ≠ 14 ⇒ 整单不出片」）：
    //   老要求是"数组长度 = 段数"——**让模型数够 N 个**，而 LLM 数数本来就不可靠（实测少回 1 段就整批作废）。
    //   现口径：**每段带段号 `i`** ⇒ 服务端按 `i` 归位（错位风险=0），少哪段就只补哪段。
    + '5. 只回一个 JSON 对象：{"scenes":[{"i":0,"slots":{…}},{"i":1,"slots":{…}},…]}；'
    + '**每段一个、`i` 从 0 连续到 ' + (scenes.length - 1) + '（绝不能漏段；宁可每段写短，也不要少一段）**；'
    + '不要 markdown 围栏、不要解释。\n'
    // ★VF_FILM_PITCH_V2（2026-10-22 用户实测「口播稿没出现在视频里」）：
    //   老口径让**模型**把整稿切成 N 段 ⇒ 那是让它做算术（29 字切 15 段每段 1.9 字，它只能放弃写 voice）。
    //   现口径：**切段由服务端确定性完成**（`splitPitchToSegments`，按标点装箱、一字不删），
    //   模型**只写画面文案**、明确禁止写 voice（写了也会被服务端覆盖）。
    + '6. **不要写 `voice` 字段**（口播由系统按用户定稿的稿子切好后注入；你写了会打架、也浪费额度）。\n'
    + '   画面文案照旧写"这一镜看到的东西"（是什么菜/什么做法/看到什么），**不要照抄口播**。\n'
    + '【这条片的定稿口播（供你参考语气，不要改写、不要复述进画面文案）】\n' + pitch.slice(0, 1200) + '\n'
    // ★VF_PLATE_V1（2026-10-10 用户定案「每 10 张图必须出现 3~4 张**完整大图**」）：
    //   完整大图=实拍**整张不裁**、占满画幅 93% 宽（plate-top / plate-bottom 两种构图交替）。
    //   为什么写进提示词：用户实测"前片一律、每帧 3 个图去填充"就是**排得太平**害的；
    //   骨架已由 arrange 排好配额（每 10 张 3~4 张），模型**只填文案、不许改结构/挪素材**。
    + '7. **排版纪律（用户点名的硬要求）**：骨架里的 `plate-top` / `plate-bottom` 是"**完整大图**"页'
    + '（每 10 张素材 3~4 张，已经排好）——**不要改结构、不要挪素材、不要合并段落**。'
    + '这两页的文案只写"这一张里真有的东西"（是什么菜、什么做法、看到什么），'
    + '不许写"满汉全席 / 超值套餐 / 一口上瘾"这类空话套话。'
  // ★VF_FILMCOPY_V2（2026-10-09 用户实测「为什么老是出错」）：**最多两次尝试 + 三次降级，绝不卡死**。
  //   ① 宽容解析（scanJson 配对扫描：数组 / {scenes:[…]} / 带解释的尾巴 都能取到）；
  //   ② 解析不过 ⇒ 带"上次哪里错"**重试一次**；
  //   ③ 仍不过/校验不过（字数/字表/emoji）⇒ 用**读图总结**拼一版（取材于素材本身，不编造、不带数字），
  //      并在确认卡上**如实标注**"这版是自动拼的，建议换风格重试"。
  //   只有"模型完全调不通 / 没素材 / 下载失败"这类**环境问题**才整步失败（那时也确实不该出片）。
  const parseArr = (t: string): any[] | null => {
    const j = scanJson(String(t).replace(/```(?:json)?/gi, ''))
    if (!j) return null
    if (Array.isArray(j)) return j
    if (Array.isArray((j as any)?.scenes)) return (j as any).scenes
    if (Array.isArray((j as any)?.copy)) return (j as any).copy
    return null
  }
  // ★VF_FILM_PITCH_V1：骨架段数只从**定稿**取（vd.filmJson.scenes / vd.plan），不重排
  const planOut = scenes.map((s) => ({ structure: s.structure, media: s.media, dur: s.dur }))
  const N = scenes.length
  // ★VF_FILMCOPY_V5/V6：不再"要一整批且长度全等"，而是**按段号归位 + 分批请求 + 只补缺口**
  //   （V6 的起因：14 段整份 JSON 太长 ⇒ 大概率被输出截断 ⇒ "不是合法 JSON"）。
  let slotsArr: (any | null)[] | null = null
  let extraN = 0
  let why = ''
  let snip = ''
  const snippet = (t: string) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, 160)
  const segLine = (k: number) => '  ' + k + '. ' + String((planOut[k] || {}).structure || '')
    + '（素材 ' + (((planOut[k] || {}).media) || []).length + ' 张）'
  const askFor = (idxs: number[], retry: boolean) => prompt + '\n\n【这次只要写这些段】\n'
    + idxs.map(segLine).join('\n')
    + '\n只回 {"scenes":[{"i":<段号>,"slots":{…}}]} —— **`i` 必须就是上面这些段号**；'
    + (retry ? '（上一次这批不是合法 JSON 或漏了段，这次务必只回 JSON、不要任何解释）' : '不要解释、不要 markdown 围栏。')
  const batches = batchRanges(N, 6)
  for (const idxs of batches) {
    let miss = idxs.slice()
    for (let attempt = 1; attempt <= 2 && miss.length; attempt++) {
      let txt = ''
      try {
        // ★VF_FILMSRC_V2：注入的 genTextW 在模型不通时返回 null ⇒ 这里统一成字符串（下面 parseArr 已有兜底）
        txt = String(await ctx.generateText(askFor(miss, attempt > 1)) || '')
      } catch (e: any) {
        why = '模型调用失败：' + String(e?.message || e).slice(0, 80)
        miss = []   // 模型调不通 ⇒ 环境问题：这批判死（整批兜底会处理），别再连打模型
        break
      }
      const got = parseArr(txt)
      if (!got) {
        // ★VF_FILMCOPY_V6：**把模型原文片段留下来** —— 否则永远分不清"被截断"“模型在说人话”还是"空返回"
        snip = snippet(txt)
        why = '不是合法 JSON' + (snip ? '（原文片段：' + snip + '）' : '（返回是空的）')
        continue
      }
      let al = alignCopy(got, N)
      if (!al.byIndex) {
        // 这批没带段号 ⇒ 按"**我问的顺序**"归位（只当数量不超过所问段数时才敢这么映射，绝不越界）
        const remapped = got.slice(0, idxs.length).map((x: any, j: number) => ({ i: idxs[j], slots: (x && x.slots) || {} }))
        al = alignCopy(remapped, N)
      }
      if (al.extra) extraN += al.extra
      slotsArr = mergeSlots(slotsArr, al.slots)
      miss = miss.filter((k) => !(slotsArr && slotsArr[k]))
    }
    if (miss.length) why = why || ('第 ' + miss.slice(0, 6).map((k) => k + 1).join('、') + ' 段没写')
  }
  // ★VF_FILM_PITCH_V2（2026-10-22 用户实测第 13/14/15 段被读图词补成「第四张 · 第五张」）：
  //   整批失败时**对这些段单独再问一次**（最多 4 段）—— 单段请求输出最短、最不容易被截断，
  //   比"拿读图总结凑一句废话"强得多。补不上才落到读图词兜底（并如实告知）。
  const stillMiss = slotsArr
    ? slotsArr.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0)
    : Array.from({ length: N }, (_, i) => i)
  if (stillMiss.length) {
    for (const k of stillMiss.slice(0, 4)) {
      try {
        const txt = String(await ctx.generateText(askFor([k], true)) || '')
        const got = parseArr(txt)
        const sl = got && got[0] && got[0].slots ? got[0].slots : null
        if (!sl) continue
        const one: any[] = new Array(N).fill(null)
        one[k] = sl
        slotsArr = mergeSlots(slotsArr, one)
      } catch { /* 单段补写失败就算了（后面还有读图词兜底 + 如实告警） */ }
    }
    const left = (slotsArr || []).filter((v) => !v).length
    vfLog(uid, `[HTML成片] 漏段单段补写：原缺 ${stillMiss.length} 段 ⇒ 补完还缺 ${left} 段`)
  }
  // 校验（用字表 / 字数 / emoji）+ 剥数字卡字段
  let charset = ''
  try { charset = fs.readFileSync(path.join(filmToolsDir(), 'fonts', 'chars-cmn.txt'), 'utf8') } catch { charset = '' }
  const set = new Set(charset.split(''))
  const copy: any[] = []
  // ★VF_CHARSET_V1（2026-10-09 用户实测连环坑）：表外字**不再整段作废、也不再触发降级** ——
  //   老口径（"有字表外的字 ⇒ copy 清空 ⇒ 降级拼句"）会把 AI 写好的文案整批丢掉，
  //   而降级拼句又可能从读图总结里取到表外字（本例「涮羊肉片」的「涮」）⇒ 最后还是出片失败。
  //   现口径：**先把文案压回字表内**（charset.ts：涮→烫、其余表外字删掉，只做减法、不换词不编造），
  //   再把"自动删/换了哪些字"如实告知（走 warn ⇒ 确认卡上那行提示）。
  const fixed: string[] = []
  // ★VF_FILMCOPY_V5：**兜底按段做**（老实现只在"整批为空"时才兜底 ⇒ 少一段就整单失败，用户实测翻车）
  const filled: number[] = []
  const derived = summary ? deriveCopyFromSummary(summary, scenes) : null
  // ══ ★VF_FILM_PITCH_V2（2026-10-22 用户实测「口播稿没出现在视频里」的根治）══
  //   口播**不再由模型切**：模型只写画面文案；这条定稿稿由**服务端确定性切段**后注入每段 `voice`。
  //   好处：① 覆盖率可机器核对（切出来 == 原稿，只做装箱不删字）；
  //        ② 模型再怎么写飞都不会丢口播/改优惠；③ 稿短时**如实显示只有前几段有口播**。
  const quotas = pitchQuotas(scenes.map((s: any) => s.dur))
  const needChars = pitchNeedChars(quotas)
  const segs = splitPitchToSegments(pitch, quotas)
  const injectVoice = (arr: any[]): number => {
    let n = 0
    if (!Array.isArray(arr)) return 0
    for (let i = 0; i < arr.length; i++) {
      const v = String(segs[i] || '').replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '').trim()
      if (!v) continue
      if (!arr[i] || typeof arr[i] !== 'object') continue
      if (!arr[i].slots || typeof arr[i].slots !== 'object') arr[i].slots = {}
      arr[i].slots.voice = v
      n++
    }
    return n
  }
  let hardErr = ''
  if (slotsArr) {
    for (let i = 0; i < N; i++) {
      const mine = slotsArr[i]
      let slots: any = Object.assign({}, mine || (derived && derived[i] ? derived[i].slots : {}) || {})
      if (!mine || !Object.keys(mine).length) filled.push(i)
      if (set.size) {
        // ★VF_FILM_PITCH_V2：模型这一步**只写画面文案**（prompt 已明确禁止写 voice），
        //   口播在下面由 `splitPitchToSegments` **确定性注入** ⇒ 这里一律按画面字段压字表即可。
        //   （老实现会连 `voice` 一起压 —— 那等于改用户定稿的稿子；现在 voice 根本不从这里过）
        const r = sanitizeSlots(slots, set)
        slots = r.slots
        for (const d of r.drops) fixed.push('第 ' + i + ' 段 ' + d.k + '「' + d.from + '」→「' + d.to + '」')
      }
      const all = JSON.stringify(slots)
      if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(all)) { hardErr = '第 ' + i + ' 段带 emoji'; break }
      const n = ['eyebrow', 'title', 'title1', 'title2', 'sub', 'tail', 'foot'].reduce((a, k) => a + String(slots[k] || '').length, 0)
        + (Array.isArray(slots.rows) ? slots.rows.join('').length : 0)
        + (Array.isArray(slots.chips) ? slots.chips.join('').length : 0)
      if (n > 60) { hardErr = '第 ' + i + ' 段 ' + n + ' 字（>60）'; break }
      delete slots.value; delete slots.unit; delete slots.kpi; delete slots.kpiTitle
      copy.push({ slots })
    }
  }
  if (hardErr) copy.length = 0   // 校验不过 ⇒ 整批不用（保持老口径：宁可降级，也不出违规文案）
  if (!copy.length) {
    // ③ 降级：用读图总结拼一版（不卡死、也不编造）。**失败时把真因说全**（模型 + 读图各一条）
    const reason = '文案：' + (hardErr || why || '模型没给出可用结果')
      + '；读图：' + (summary ? '有总结可用' : '没有成功读图（第 2 步没读到图，原因见那里）')
    if (!summary) return { ok: false, err: reason + ' —— **没有出片**。可稍后重试（读图/模型偶发失败），或回上一步换一批素材。' }
    vfLog(uid, '[HTML成片] AI 文案降级为"读图拼句"：' + (hardErr || why))
    // ★VF_FILM_PITCH_V2：画面文案是拼的，但**口播仍然按用户定稿注入**（切段是确定性的，不依赖模型）
    const dcopy: any[] = derived || deriveCopyFromSummary(summary, scenes)
    const dVoiceN = injectVoice(dcopy)
    return { ok: true, plan: planOut, copy: dcopy, voiceN: dVoiceN, needChars,
      warn: '⚠️ 画面文案没能由 AI 写好（' + (hardErr || why) + '），已按**读图结果**自动拼了一版'
        + '；口播仍按你选的那条稿切好了（' + dVoiceN + '/' + N + ' 段有口播）。建议点「← 换风格」重试一次。' }
  }
  // 兜底补完仍是空的段 ⇒ 明确失败（空文案页会被下游 no-copy 闸门拦，不如这里说清）
  const emptyIdx: number[] = []
  copy.forEach((c, i) => { if (!Object.keys((c && c.slots) || {}).length) emptyIdx.push(i) })
  if (emptyIdx.length) {
    return { ok: false, err: '第 ' + emptyIdx.slice(0, 6).map((k) => k + 1).join('、') + ' 段没有任何文案（模型漏写、读图词也不够补）'
      + '（' + (why || '') + '）—— **没有出片**。可稍后重试，或回上一步换一批素材 / 换风格。' }
  }
  // ★VF_FILM_PITCH_V2：口播注入（**必须在 emptyIdx 判定之后**：voice 是我们加的，不参与"这段是不是空"的判定）
  const voiceN = injectVoice(copy)
  // 如实告知：① 哪几段是兜底补的（这版是拼的）② 哪几处用字被压回字表
  const warnParts: string[] = []
  if (filled.length) {
    warnParts.push('⚠️ 第 ' + filled.slice(0, 6).map((k) => k + 1).join('、') + ' 段文案模型没写，已按**读图结果**补齐'
      + (filled.length > 6 ? '（共 ' + filled.length + ' 段）' : '') + '；建议点「← 换风格」重试一次会更顺。')
  }
  if (extraN) warnParts.push('ℹ️ 模型多写了 ' + extraN + ' 段（已忽略，不会串页）')
  if (fixed.length) {
    warnParts.push('ℹ️ 有 ' + fixed.length + ' 处用字不在引擎字表内，已自动压回（表外字删掉，只做减法不换词）：'
      + fixed.slice(0, 4).join('；') + (fixed.length > 4 ? ' …' : ''))
  }
  // ★VF_FILM_PITCH_V2：**口播覆盖率如实报**（切段是我们做的，所以这里的数字是"确定的事实"、不是估计）——
  //   稿短就会明确写出"只有前 k 段有口播"，不藏、也不自动复制凑段（复制 = 同一句话念多遍，更难听）。
  const pitchLen = pitch.replace(/\s+/g, '').length
  if (!voiceN) {
    warnParts.push('⚠️ 这条稿切不出任何一段口播 —— 配音会退回念画面大字。请回上一步把稿写好。')
  } else if (voiceN < N) {
    warnParts.push('ℹ️ 口播稿 ' + pitchLen + ' 字 / 本片 ' + N + ' 段（这段片子约需 ' + needChars + ' 字）'
      + '⇒ **只有前 ' + voiceN + ' 段有口播，其余 ' + (N - voiceN) + ' 段静音**。'
      + '想全程有配音：回上一步把稿补到约 ' + needChars + ' 字（一行一段）。')
    vfLog(uid, `[HTML成片] 口播未覆盖全片：${voiceN}/${N} 段（稿 ${pitchLen} 字 / 需要约 ${needChars} 字）`)
  } else {
    vfLog(uid, `[HTML成片] 口播已覆盖全片：${voiceN}/${N} 段（稿 ${pitchLen} 字 / 需要约 ${needChars} 字）`)
  }
  // ⚠️ `warn` 只装"**降级/补齐**"这类**异常**信息（日志用 `prep.warn ? '（降级）'` 判断）；
  //   `specNote`（AI 规划了什么）单独返回 —— 早先把它并进 warn 导致日志把"AI 规划成功"误标成"（降级）"。
  return { ok: true, plan: planOut, copy, warn: warnParts.join('\n'), voiceN, needChars }
}

/* ───────────── 四张卡（都走 VF_JSON，客户端按 step 选组件）：素材 / 风格 / 口播稿 / 确认 ───────────── */

async function matCard(uid: number | string, vd: HtmlFilmDraft): Promise<string> {
  const images = await repoImages(uid)
  const body = {
    step: 'film_mat',
    hint: images.length
      // ★VF_MATONLY_V1（2026-10-12 用户定案「AGENT 页里要用到仓库的地方，**路径直接改成原始素材。不要有成片**」）：
      //   选素材这一步**只列原始素材**（`gen_` 成片/审片图、以及出片记录里的老成片一律不列）——文案也要说明白。
      // ★VF_FILM_PITCH_V1：多了「口播营销稿」这一步 ⇒ 总步数 3 → 4（日报线有自己的 hint，不受影响）
      ? '第 1 步 / 共 4 步 · 选原始素材（只列你上传的图，成片不算；不勾就默认用最近 ' + FILM_DEFAULT_RECENT + ' 张）'
      : '第 1 步 / 共 4 步 · 还没有原始素材 —— 先上传几张，或点「下一步」由系统用最近素材',
    images,
    names: vd.names,
    // ★VF_FILMSRC_V1：上限**只有一个**且下发到前端（不再各写 40/12/8）——
    //   用户看得见"最多 N 张"，要改就改 VF_FILM_MAT_MAX。
    max: FILM_MAT_MAX,
    poolMax: FILM_POOL_MAX,
    defRecent: FILM_DEFAULT_RECENT,   // ★VF_FILMSRC_V1：前端默认勾选数也由服务端下发（不让前端再写一个 12）
    pack: vd.pack,
  }
  return 'VF_JSON:' + JSON.stringify(body)
}

function styleCard(vd: HtmlFilmDraft): string {
  const packs = htmlFilmPacks()
  const body = {
    step: 'film_style',
    hint: `第 2 步 / 共 4 步 · 选风格（已选 ${vd.names.length || '最近'} 张素材）`,
    packs,
    pack: vd.pack,
    n: vd.names.length,
    names: vd.names,
    // ★VF_RATIO_V1：**大图:填图 比例条**（默认 50 = 5:5）——整条链的口号是
    //   「素材越多、越靠"多图页"消化，越不逼 AI 发明新版面」；这个值是**用户/AI 的声明**，
    //   出片时机器按"声明 vs 实测"核对（render-film 的完整大图那一行）。
    plateRatio: vd.plateRatio === undefined ? 60 : Number(vd.plateRatio),
    plateRatioHint: '大图 : 填图 —— 往左=更多多图页（素材多、变化多）；往右=更多整张不裁的大图',
    // ★VF_ASPECT_V1：画幅回显到卡片（用户能看见"这条片按什么画幅排"，切换会重排骨架）
    aspect: vd.aspect === '16:9' ? '16:9' : '9:16',
    // ★VF_SPEC_V2：开关下发给卡片 —— `aiSpec` 是**这一单的当前值**（默认 = 总闸），
    //   `aiSpecForced` 只用来显示"服务端总闸已开"那句提示（用户仍可取消）。
    aiSpec: vd.aiSpec === undefined ? aiSpecEnabled() : !!vd.aiSpec,
    aiSpecForced: aiSpecEnabled(),
    // ★VF_THEME_V1：完全自主开关回显（第 2 步卡上能看到当前是不是"不用库里模板皮肤"）
    aiPaint: !!vd.aiPaint,
    // ★VF_LAY_V1：**图呈现**下发（第 2 步卡上的三选）。
    //   ⚠️ 事实（2026-10-14 查证，别凭印象）：`styleCard` 全仓**只有 vf-htmlfilm.ts 自己一处调用**，
    //      这张 `film_style` 卡就是**HTML 成片线专有**；日报线复用的是**素材卡**（`film_mat`），**不是这张**。
    //      ⇒ 前端用 `vj.lay !== undefined` 判"显不显示"是**防御性**写法（当前恒为 true），
    //        不是为了"避开日报线"——别把它读成"日报线也会看到这个选项"。
    lay: pickLayId(vd.lay) || 'auto',
    layHint: '跟风格＝用这套包自带的版式；满幅压字＝图铺满整页、标题叠在图上（图片面积最大）；相纸不裁＝图整张不裁、不压字',
  }
  return 'VF_JSON:' + JSON.stringify(body)
}

/** ★VF_FILM_PITCH_V1（2026-10-22 用户原话「**不是改画面上的，改的是口播**。AI 出 3 条可以选、可以修改」）
 *  —— 第 2.5 步：**口播营销稿**卡（3 条候选单选 + 一个可编辑文本框 + 「用这条写口播」）。
 *  · 三条是**不同角度**（钩子型 / 优惠型 / 口碑型），口径见 `film-spec.ts::pitchPrompt`；
 *  · 前端选中某条 ⇒ 自动带进 textarea ⇒ 用户可以随便改；**提交的是 textarea 里的内容**（不是原文）；
 *  · 提交后这条就是"逐段 voice 的唯一来源"（服务端 aiWriteCopyByPitch 按骨架切段）。 */
function pitchCard(vd: HtmlFilmDraft): string {
  const cands = Array.isArray(vd.pitchCandidates) ? vd.pitchCandidates : []
  const pickedIdx = Number.isFinite(Number(vd.pitchPick))
    ? Math.min(Math.max(0, Math.round(Number(vd.pitchPick))), Math.max(0, cands.length - 1)) : 0
  const plan = Array.isArray(vd.plan) ? vd.plan : []
  // ★VF_FILM_PITCH_V2：把"这条片需要多少字 / 多少段"下发到卡片 ——
  //   用户改稿时能**当场看到够不够**（老版本只显示"当前 N 字"，没有参照物 ⇒ 29 字看上去也"正常"）
  const quotas = pitchQuotas(plan.map((s: any) => s.dur))
  const body = {
    step: 'film_pitch',
    hint: '第 3 步 / 共 4 步 · 口播营销稿（AI 写了 ' + cands.length + ' 条不同角度，选一条；也可以直接改）',
    // ⚠️ 这里是**配音要念的稿**，不是画面大字 —— 卡片标题与说明都要点明，否则用户会以为是字幕
    candidates: cands,
    pick: pickedIdx,
    // 回显口径：**用户改过就用他改的**（pitchText），没改过就带出选中的那条
    text: String(vd.pitchText || cands[pickedIdx] || ''),
    angles: ['钩子型', '优惠型', '口碑型'],
    n: (Array.isArray(vd.picked) ? vd.picked.length : 0) || vd.names.length,
    estShots: plan.length,
    // ★VF_FILM_PITCH_V2：篇幅读数（**推荐字数 = 各段配额之和**；一行 = 一个镜头）
    segs: quotas.length,
    needChars: pitchNeedChars(quotas),
    perSegMin: 13,
    perSegMax: 18,
    estSec: Math.round(plan.reduce((a: number, s: any) => a + (Number(s.dur) || 0), 0)) || 0,
    topic: String(vd.topic || ''),
    pack: vd.pack,
  }
  return 'VF_JSON:' + JSON.stringify(body)
}

/** ★VF_FILMEST_V2（2026-10-09 用户实测「卡上说约 35 秒、成片只有 24.6 秒」）：
 *  预估口径改成**按文案字数**算（口播语速实测 ~3.2 字/秒 + 每镜 0.5s 尾巴，
 *  与 `tools/film-voice.mjs` 的实测口径同源）——
 *  老口径是"骨架声明时长相加"（每镜 4~4.5s ⇒ 约 36s），而真实出片时长是**TTS 实测**决定的，
 *  两者差 10 秒以上。⚠️ 这仍只是**预估**（卡片上要写明"以实测配音为准"）。
 *  取词口径与 film-voice 的 deriveVoice **保持一处**：有 `voice` 用 voice，没有才用 title/title1/title2/sub。 */
const VOICE_CPS = 3.2   // 字/秒（实测：本机 8 镜 25.44s、服务端 8 镜 24.57s，都在 3.0~3.6 之间）
function estimateVoiceSec(copy: any[]): number {
  if (!Array.isArray(copy) || !copy.length) return 0
  let total = 0
  for (const c of copy) {
    const slots: any = (c && c.slots) || {}
    const spoken = String(slots.voice || '').trim()
    const text = spoken || [slots.title, slots.title1, slots.title2, slots.sub]
      .map((x: any) => String(x || '').trim()).filter(Boolean).join('，')
    total += Math.max(2.2, text.length / VOICE_CPS + 0.5)
  }
  return Math.round(total) || 0
}

function confirmCard(vd: HtmlFilmDraft): string {
  const packs = htmlFilmPacks()
  const pk = packs.find((p) => p.id === vd.pack)
  const plan = Array.isArray(vd.plan) ? vd.plan : []
  const copy = Array.isArray(vd.copy) ? vd.copy : []
  const picked = Array.isArray(vd.picked) ? vd.picked : []
  // ★VF_FILMEST_V2：先按"文案字数"估（贴近实测），估不出来才退回"骨架声明时长相加"
  const estSec = estimateVoiceSec(copy)
    || Math.round(plan.reduce((a: number, s: any) => a + (Number(s.dur) || 0), 0)) || 30
  const body = {
    step: 'film_confirm',
    // ★VF_FILMCOPY_V1：数字（段数/时长）改成**按真实骨架算**，不再写死 30 秒/6 段
    hint: '第 4 步 / 共 4 步 · 确认出片（文案已按你的口播稿切好，先看一眼；不满意可「← 换风格」重写）',
    names: vd.names,
    // ★VF_RATIO_V1：把这一单用的比例回显到确认卡（用户能看见"这条片按几比几排的"）
    plateRatio: vd.plateRatio === undefined ? 60 : Number(vd.plateRatio),
    // ★VF_FILMSRC_V1：卡片上写的张数 = **出片真正会用的张数**（vd.picked 定稿件）。
    //   老实现这里发的是"勾选名单长度"，而出片用的是另一份切片（12/40）⇒ 卡片与实际不符。
    n: picked.length || vd.names.length,
    pickedN: picked.length,
    readN: Number(vd.readN) || 0,
    matMax: FILM_MAT_MAX,
    pack: vd.pack,
    packName: pk ? pk.name : '（自动按赛道挑）',
    // ★VF_LAY_V1：把"图呈现"回显到确认卡（用户能看见这条片到底是满幅压字还是相纸不裁；
    //   AI 代选时 layEff 与用户选的 auto 不同，这里显示的是**实际生效**那个）
    lay: pickLayId(vd.layEff || vd.lay) || 'auto',
    layName: describeLay(pickLayId(vd.layEff || vd.lay) || 'auto'),
    estSec,
    // ★VF_FILMSRC_V1（用户原话「我给你 50 张图你也做 8 个镜头？」）：
    //   **段数不再有兜底上限**（老代码 `plan.length || Math.min(8, …)` 会给一个假的 8）。
    //   段数只由骨架决定，骨架由素材张数决定 —— 取不到就如实显示 0，让用户看见异常。
    estShots: plan.length,
    cost: 0,
    topic: String(vd.topic || ''),
    // ★VF_FILMCOPY_V1：把「AI 素材总结 + 逐镜文案」一起下发 —— 用户**看过再点出片**（不再"乱出片"）
    summary: String(vd.summary || ''),
    plan,
    copy,
    // ★VF_FILM_PITCH_V1：把**最终口播稿**（用户选/改过的那条）下发 —— 确认卡要让用户看见"成片到底念什么"
    pitchText: String(vd.pitchText || ''),
    pitchPick: Number(vd.pitchPick) || 0,
    pitchN: Array.isArray(vd.pitchCandidates) ? vd.pitchCandidates.length : 0,
    // ★VF_FILM_PITCH_V2：**有口播的段数 / 总段数 / 应需字数**（从 copy 里数，与出片实际一致）
    /** ★VF_VOICE_PICK_V1（2026-10-22 用户定案「配音不能选」）：**音色选择**下发到确认卡。
     *  · `voice` = 默认值：AI 判的气质 → 推荐音色（拿不到气质 ⇒ Cherry，与历史默认一致）；
     *  · `voices` = 全部 48 个（`hot` 12 个默认展示，其余折叠）+ 每个的中文名/性别/语种/描述；
     *  · `voiceAi`/`toneLabel` = "AI 建议"那一行的人话（用户可忽略）。
     *  ⚠️ 前端提交的 voice **必须**经 `pickTtsVoice` 白名单后才进 makeFilmFromMaterials（见 VF_FILM_GO）。 */
    voice: voiceForTone(vd.voiceTone),
    voiceName: ttsVoiceName(voiceForTone(vd.voiceTone)),
    voiceTone: String(vd.voiceTone || ''),
    toneLabel: TONE_LABEL[String(vd.voiceTone || '')] || '',
    toneVoices: TONE_VOICES[String(vd.voiceTone || '')] || [],
    voices: voiceOptions(),
    // ★VF_VOICE_PICK_V1：AI 判的配乐曲风（这轮只显示；乐库/音乐生成接通后直接当"挑哪首/生成什么"的依据）
    musicMood: String(vd.musicMood || ''),
    voiceN: copy.filter((c: any) => String((c && c.slots && c.slots.voice) || '').trim()).length,
    needChars: (() => {
      const q = pitchQuotas(plan.map((s: any) => s.dur))
      return pitchNeedChars(q)
    })(),
    // ★VF_FILMCOPY_V2：降级时把原因带给前端（卡片上要如实显示，不能让用户以为 AI 正常写了）
    warn: String((vd as any).warn || ''),
  }
  return 'VF_JSON:' + JSON.stringify(body)
}

/* ───────────────────────── 分派入口（route.ts 只调这一个函数）───────────────────────── */

export type HtmlFilmCtx = {
  uid: number | string
  userMessage: string
  prisma: any
  /** 用户本次是**点/说了命令**（HTML成片）——入口，走"第三步卡"流程 */
  isEntry?: boolean
  /** ★VF_FILMCOPY_V1：写字用的模型入口（route.ts 的 genTextW → writer 模型档位）；不注入就只能报错不写文案
   *  ★VF_FILMSRC_V2：类型放宽到 `string | null` —— 注入它的 `genTextW` 在模型不通时就返回 null，
   *  写窄了会出现"类型对不上"的噪声（而且会让读代码的人以为它永不返回 null）。 */
  generateText?: (p: string) => Promise<string | null>
}

/** 返回 string = 本线的回复（协议串/卡）；返回 null = 不是本线的话，交给后面的流程 */
export async function handleHtmlFilmLine(ctx: HtmlFilmCtx): Promise<string | null> {
  const { uid, prisma } = ctx
  const msg = String(ctx.userMessage || '').trim()

  // ── ① 入口：清草稿 → 落**第一步草稿** → 出素材卡（铁律①：第一步就落草稿）
  if (ctx.isEntry) {
    await clearHtmlFilmDraft(prisma, uid)
    // ★VF_FILMSRC_V2：进线即打上**当前代码版本**（后面出片要拿它与代码比对）
    const vd: HtmlFilmDraft = { step: 'mat', names: [], pack: '', topic: '', ver: FILM_LINE_VERSION }
    await saveHtmlFilmDraft(prisma, uid, vd)
    vfLog(uid, '[HTML成片] 进线 → 出素材卡（状态机第 1/3 步）')
    return await matCard(uid, vd)
  }

  // ── ② 卡片协议串：VF_FILM_FORM:{at:'mat'|'style'|'back_mat'|'back_style', …}
  if (/^VF_FILM_FORM\s*[:{]/.test(msg)) {
    let f: any = {}
    try { f = JSON.parse(msg.slice(msg.indexOf('{'))) } catch { /* ignore */ }
    const vd = (await loadHtmlFilmDraft(prisma, uid)) || { step: 'mat', names: [], pack: '', topic: '' } as HtmlFilmDraft
    const at = String(f.at || '')
    if (at === 'mat') {
      // ★VF_FILMSRC_V1：上限只用 FILM_MAT_MAX 这一个（老实现这里是 40、写文案处是 12、出片是 40）
      vd.names = Array.isArray(f.names) ? f.names.map((x: any) => String(x)).slice(0, FILM_MAT_MAX) : []
      if (f.topic !== undefined) vd.topic = String(f.topic || '').slice(0, 60)
      vd.step = 'style'
      await saveHtmlFilmDraft(prisma, uid, vd)
      return styleCard(vd)
    }
    if (at === 'style') {
      vd.pack = String(f.pack || '')
      // ★VF_RATIO_V1：比例条的值（0~100）。越界夹回并如实打印（不静默）；
      //   没带 ⇒ 保持原值（默认 50 = 5:5，由 planFilm 那一步统一兜底）。
      // ★VF_ASPECT_V1（2026-10-11 用户定案「我要的是横屏竖屏我可以选」）：画幅（第 2 步卡）
      //   只认两个值；非法值**夹回竖屏并打印**（不静默）。
      if (f.aspect !== undefined && f.aspect !== null && f.aspect !== '') {
        const a = String(f.aspect)
        vd.aspect = a === '16:9' ? '16:9' : '9:16'
        if (a !== '16:9' && a !== '9:16') vfLog(uid, '[HTML成片] aspect=' + a + ' 不是 9:16/16:9 ⇒ 夹回 9:16')
      }
      if (vd.aspect === undefined) vd.aspect = '9:16'
      if (f.plateRatio !== undefined && f.plateRatio !== null && f.plateRatio !== '') {
        const rRaw = Number(f.plateRatio)
        const r = Number.isFinite(rRaw) ? Math.min(100, Math.max(0, Math.round(rRaw))) : 60
        if (Number.isFinite(rRaw) && rRaw !== r) vfLog(uid, '[HTML成片] plateRatio=' + rRaw + ' 越界 ⇒ 夹回 ' + r)
        vd.plateRatio = r
      }
      if (vd.plateRatio === undefined) vd.plateRatio = 60
      // ★VF_SPEC_V2：第 2 步卡上的"🎨 让 AI 自己规划版式"开关（**最终决定**就存这儿）
      if (f.aiSpec !== undefined) vd.aiSpec = !!f.aiSpec
      if (vd.aiSpec === undefined) vd.aiSpec = aiSpecEnabled()   // 没带 ⇒ 服务端总闸决定默认值
      // ★VF_THEME_V1（用户定案「AI 完全自己画 就不要参与我们模版」）：勾了"完全自主" ⇒ 必然走 AI 规划
      if (f.aiPaint !== undefined) vd.aiPaint = !!f.aiPaint
      if (vd.aiPaint) vd.aiSpec = true
      // ★VF_LAY_V1：**图呈现**（第 2 步卡三选）。只认 auto/bleed/plate；
      //   非法值**保持原值并打印**（不静默改）；没带 ⇒ 不动（日报线复用本卡时也不会误改）。
      if (f.lay !== undefined && f.lay !== null && f.lay !== '') {
        const lv = String(f.lay)
        const lk = pickLayId(lv)
        if (lk) vd.lay = lk
        else vfLog(uid, '[HTML成片] lay=' + lv + ' 不在 auto/bleed/plate ⇒ 保持原值 ' + (vd.lay || 'auto'))
      }
      if (!vd.lay) vd.lay = 'auto'
      // ★VF_PACKAI_V1：用户手动选了包 ⇒ 记下来（AI 挑包只在"没手选"时才做）
      if (f.pack !== undefined) vd.pack = String(f.pack || '')
      if (f.topic !== undefined) vd.topic = String(f.topic || '').slice(0, 60)
      // ★VF_FILMCOPY_V1（用户原话：「B该用模型就用模型。还有让 AI 先总结素材。**不要乱出片**」）：
      //   「下一步」不再直接出确认卡 —— **先让 AI 看图总结素材 + 排骨架 + 出 3 条口播营销稿**，
      //   用户选 1 条（可改）之后，才按这条稿切段写逐镜文案。任一步失败 ⇒ **不出卡、不出片**（宁可不做，也不乱做）。
      const prep = await aiPreparePitch(ctx, uid, vd)
      if (!prep.ok) {
        vfLog(uid, '[HTML成片] AI 出素材总结/口播稿失败 → 未出片：' + String(prep.err || '').slice(0, 160))
        return '⚠️ HTML成片：这一步没能让 AI 按素材写好口播稿（' + String(prep.err || '').slice(0, 120)
          + '）——**没有出片**。可以稍后重试，或回上一步换一批素材 / 换风格。'
      }
      vd.summary = prep.summary
      vd.plan = prep.plan
      // ★VF_FILM_PITCH_V1：这一步**不写逐镜文案**（没有 copy）—— 文案要等用户把口播稿定下来
      vd.copy = []
      // ★VF_SPEC_V2：AI 规划的风格语法落进草稿（出片时以定稿骨架里的 spec 为准；这里兜底）
      if (prep.spec !== undefined) vd.spec = prep.spec
      vd.step = 'pitch'
      // ★VF_FILMCOPY_V2：降级时带一句"这版是自动拼的"（如实告知，别让用户以为 AI 正常工作了）
      // ★VF_SPEC_V2b：卡片上**两样都要显示**（AI 规划了什么 + 降级/补齐提醒），
      //   但日志那条"（降级）"只看 `prep.warn` —— 早先混在一起会把"AI 规划成功"误标成"降级"。
      ;(vd as any).warn = [prep.warn, prep.specNote].filter(Boolean).join('\n')
      await saveHtmlFilmDraft(prisma, uid, vd)
      vfLog(uid, `[HTML成片] AI 已总结素材并出了 ${(prep.pitchCandidates || []).length} 条口播稿${prep.warn ? '（降级）' : ''} → 出口播稿卡（等用户选/改）`)
      return pitchCard(vd)
    }
    // ★VF_FILM_PITCH_V1（2026-10-22）：用户选了某条口播稿（也可以**手工改**）⇒ 这条就是逐段口播的唯一来源。
    //   ⚠️ 这里**只认定稿**（骨架/读图总结在第 2 步已固化）—— 绝不重排、绝不重取素材。
    if (at === 'pitch') {
      const cands = Array.isArray(vd.pitchCandidates) ? vd.pitchCandidates : []
      const rawPick = Number(f.pick)
      const pickIdx = Number.isFinite(rawPick)
        ? Math.min(Math.max(0, Math.round(rawPick)), Math.max(0, cands.length - 1)) : 0
      const text = String(f.text === undefined ? (cands[pickIdx] || '') : f.text).trim()
      if (!text) {
        // 空稿 ⇒ **不往下走**（否则整片没口播）：把原卡还给用户并说清原因
        return '⚠️ HTML成片：口播稿是空的 —— 请先选一条候选（或在框里写几句），再点「用这条写口播」。\n' + pitchCard(vd)
      }
      vd.pitchPick = pickIdx
      vd.pitchText = text.slice(0, 1500)
      const edited = String(f.text !== undefined && String(f.text).trim() !== String(cands[pickIdx] || '').trim())
      const st0 = pitchStats(vd.pitchText)
      vfLog(uid, '[HTML成片] 口播稿已定稿：第 ' + (pickIdx + 1) + ' 条 · ' + st0.chars + ' 字 / ' + st0.lines + ' 行（'
        + (edited ? '用户手工改过' : '未改动') + '）')
      const wr = await aiWriteCopyByPitch(ctx, uid, vd, vd.pitchText)
      if (!wr.ok) {
        vfLog(uid, '[HTML成片] 按口播稿切段写文案失败 → 未出片：' + String(wr.err || '').slice(0, 160))
        await saveHtmlFilmDraft(prisma, uid, vd)
        return '⚠️ HTML成片：没能把这条口播稿按段切好（' + String(wr.err || '').slice(0, 120)
          + '）——**没有出片**。可以点「← 改风格/素材」回去调整再试，或稍后重试。'
      }
      vd.copy = wr.copy
      if (!Array.isArray(vd.plan) || !vd.plan.length) vd.plan = wr.plan
      vd.step = 'confirm'
      // 只在这次真有提醒时追加（**避免同一句反复回来时越叠越长**）
      const prevWarn = String((vd as any).warn || '')
      if (wr.warn && !prevWarn.includes(wr.warn)) (vd as any).warn = [prevWarn, wr.warn].filter(Boolean).join('\n')
      await saveHtmlFilmDraft(prisma, uid, vd)
      vfLog(uid, `[HTML成片] 已按口播稿切成 ${(wr.copy || []).length} 段（有口播 ${wr.voiceN || 0} 段 / 需要约 ${wr.needChars || 0} 字）→ 出确认卡（等用户点出片）`)
      return confirmCard(vd)
    }
    if (at === 'back_style') { vd.step = 'style'; await saveHtmlFilmDraft(prisma, uid, vd); return styleCard(vd) }
    if (at === 'back_mat') { vd.step = 'mat'; await saveHtmlFilmDraft(prisma, uid, vd); return await matCard(uid, vd) }
    // 认不出就退回素材卡（不锁死）
    return await matCard(uid, vd)
  }

  // ── ③ 确认卡「🎬 出片」：VF_FILM_GO:{…} → 真的出片
  if (/^VF_FILM_GO\s*[:{]/.test(msg)) {
    let goF: any = {}
    try { goF = JSON.parse(msg.slice(msg.indexOf('{'))) } catch { /* ignore */ }
    // ★VF_FILMVOICE_V1（2026-10-09 用户定案「先校准流程」）：**本线默认配音 + 字幕**。
    //   用户原话是「本次制作还是没有字幕 TTS 只有图片」⇒ 默认就该有声；要无声版时由确认卡明确传 false。
    const wantVoice = goF.voiced === undefined ? true : !!goF.voiced
    const vd = await loadHtmlFilmDraft(prisma, uid)
    if (!vd) return 'HTML成片：这一单已经结束了（没有进行中的流程）——请重新说一次「HTML成片」。'

    // ★VF_FILMSRC_V2（P1 · 2026-10-10）：**版本戳比对** —— 草案是"上一版代码"排的（可能刚部署过），
    //   它的文案与本次代码排出的骨架必然错配（用户实测：卡片 8 段 / 出片 12 段 ⇒ 后 4 镜空）。
    //   口径：**这一单作废、明确让用户重走一遍**（不猜、不合并、不用旧文案配新骨架）。
    //   ⇒ 这就是"部署即作废在飞草案"的实现：改 FILM_LINE_VERSION 一处，所有在飞草案全部失效。
    if (String(vd.ver || '') !== FILM_LINE_VERSION) {
      await clearHtmlFilmDraft(prisma, uid)
      vfLog(uid, '[HTML成片] 草案版本过期（' + (vd.ver || '无版本') + ' ≠ ' + FILM_LINE_VERSION + '）⇒ 已作废，要求重来一次')
      return 'HTML成片：这一单是**旧版本**排出来的（脚本/模板刚更新过），为避免"卡片上的文案与成片骨架对不上"，'
        + '**已把它作废、没有出片**。请重新说一次「HTML成片」重走一遍（素材还在原始素材里，勾选约 1 分钟）。'
    }

    // ★VF_RATIO_V1：比例在"出确认卡"那一刻就已生效（**骨架与文案都按它排好了**）⇒
    //   出片前改比例 = 必须重排 ⇒ 口径同"骨架只编一次、错位即作废"：**明确拒绝 + 让用户重走**，
    //   绝不悄悄按新比例重排（那会让卡片上给用户看过的那份文案与成片对不上）。
    if (goF.plateRatio !== undefined && goF.plateRatio !== null && goF.plateRatio !== ''
      && Number.isFinite(Number(goF.plateRatio))) {
      const wantP = Math.min(100, Math.max(0, Math.round(Number(goF.plateRatio))))
      const curP = vd.plateRatio === undefined ? 60 : Number(vd.plateRatio)
      if (wantP !== curP) {
        vfLog(uid, '[HTML成片] 出片时比例被改（' + curP + ' → ' + wantP + '）⇒ 拒绝（骨架/文案已按旧比例排好）')
        return 'HTML成片：这一单的**比例**在出片前不能改（骨架与文案都已按 '
          + (curP / 10).toFixed(1) + ' : ' + ((100 - curP) / 10).toFixed(1)
          + ' 排好）——想换比例请点「← 换风格」重走一次（约 1 分钟）。**没有出片**。'
      }
    }

    // ★VF_FILMSRC_V1：**先判这单自不自洽，再去下载素材**（顺序有意提前：省一次下载；
    //   也让它离线可测）。骨架段数必须等于文案条数 —— 不一致就明确拒渲，
    //   绝不把旧文案硬合并到新骨架（那次 8 条文案塞进 12 段骨架，后 4 镜空 ⇒ 被 copy 闸门拦）。
    const planScenes: any[] = Array.isArray(vd.filmJson?.scenes) ? vd.filmJson.scenes : []
    const copyArr: any[] = Array.isArray(vd.copy) ? vd.copy : []
    if (planScenes.length && copyArr.length && planScenes.length !== copyArr.length) {
      vfLog(uid, `[HTML成片] ★骨架/文案不一致：骨架 ${planScenes.length} 段 vs 文案 ${copyArr.length} 条 ⇒ 拒渲（要求重排）`)
      return 'TOOL_REJECT:HTML成片：这一单的骨架（' + planScenes.length + ' 段）与文案（' + copyArr.length
        + ' 条）不一致 —— **没有出片**（不做"旧文案塞新骨架"这种硬合并）。请重新说一次「HTML成片」，让它按当前素材重排一次。'
    }

    // ══ ★VF_FILMSRC_V1：出片**只认写文案那一步的定稿** ══
    //   用户实测的病灶：老实现这里**再取一次仓库、再切一次张数**（卡片按 12 张排 8 段、
    //   这里按勾选的 17 张排 12 段）⇒ 同一单两个骨架 ⇒ 文案按下标合并就错位（后 4 镜空）。
    //   现口径：素材名单 = `vd.picked`（定稿），骨架 = `vd.filmJson`（定稿），一个都不重算。
    const pickNames = (Array.isArray(vd.picked) && vd.picked.length) ? vd.picked : vd.names
    let files: string[] = []
    try {
      const pick = await pickFilmMaterials(uid, pickNames)
      if (pick.missing.length) {
        return 'TOOL_REJECT:HTML成片：这一单定稿的素材里有 ' + pick.missing.length + ' 张在原始素材找不到了（'
          + pick.missing.slice(0, 3).join('、') + '）——请重新说一次「HTML成片」并刷新列表重勾（**没有自动换素材**）。'
      }
      const dl = await downloadMaterials(uid, pick.picked)
      files = (dl || []).map((m: any) => String(m.localPath || '')).filter(Boolean)
      if (files.length) {
        vfLog(uid, `[HTML成片] 出片素材：${files.length} 张（定稿 ${pickNames.length || 0} 张 / 仓库候选 ${pick.pool.length}${pick.capped ? ' · 超上限砍 ' + pick.capped : ''}）`)
      }
    } catch (e: any) {
      vfLog(uid, '[HTML成片] 取仓库图片失败：' + String(e?.message || e).slice(0, 120))
    }
    if (!files.length) {
      try {
        const mdir = materialDir(uid)
        files = fs.readdirSync(mdir).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).map((f) => path.join(mdir, f))
      } catch { files = [] }
    }
    if (!files.length) return 'TOOL_REJECT:没有找到素材（原始素材里没有图片；成片不算素材）——请先上传几张图片，再说一次「HTML成片」。'
    // ★VF_FILMSRC_V1：**不再** files.slice(0,40) —— 上限只在 pickFilmMaterials 一处（FILM_MAT_MAX）

    // （★VF_FILMSRC_V1 的"骨架/文案一致性校验"已在上面、下载素材**之前**做过）

    const workDir = path.join(vfStorageRoot(), String(uid), 'video-factory', 'film_' + Date.now())
    // ★VF_VOICE_PICK_V1（2026-10-22 用户定案「配音不能选」）：**音色只认白名单** ——
    //   用户手选 > AI 建议（气质映射）> Cherry；非法 id **绝不往下游发**（阿里会 400，且 tts-node 会静默折回）。
    const wantV = pickTtsVoice(goF.voice) || voiceForTone(vd.voiceTone)
    vfLog(uid, `[HTML成片] 开始：${files.length} 张素材 → 出片（骨架 ${planScenes.length || '现排'} 段 · 风格包=${vd.pack || '自动'}`
      + `${wantVoice ? ' · 配音+字幕（音色 ' + ttsVoiceName(wantV) + ' / ' + wantV + '）' : ' · 无声'}）`)
    const r = await makeFilmFromMaterials({
      materials: files,
      text: String(vd.topic || ''),
      pack: vd.pack || '',
      workDir,
      // ★VF_FILMVOICE_V1：默认配音 + 字幕（走 film-voice：TTS 实测时长 → 重排镜头 → 字幕 → 混音烧字幕）
      voiced: wantVoice,
      voice: wantV,
      // ★VF_FILMCOPY_V1：把确认卡上那份 AI 文案**按序号**并进骨架（用户看过的那一版，出片必须与之一致）
      copy: Array.isArray(vd.copy) && vd.copy.length ? vd.copy : undefined,
      // ★VF_FILMSRC_V1：**用定稿的那份骨架**（不再让出片重排一次）
      planJson: vd.filmJson || undefined,
      // ★VF_RATIO_V1：比例也带上（只在"没有定稿骨架、需要现场编排"时才会用到；有定稿时以定稿为准）
      plateRatio: (vd.plateRatio === undefined ? 60 : Number(vd.plateRatio)) / 100,
      // ★VF_ASPECT_V1：画幅同上（有定稿骨架时以定稿里的 aspect 为准）
      aspect: vd.aspect === '16:9' ? '16:9' : '9:16',
      // ★VF_SPEC_V1：语法同上（有定稿骨架时以定稿里的 spec 为准）
      spec: vd.spec,
      vertical: vd.vertical || '',
    })
    if (!r.ok) {
      vfLog(uid, `[HTML成片] 被闸门拦下：stage=${r.stage} ${String(r.err || '').slice(0, 160)}`)
      return `TOOL_REJECT:HTML成片出片被拦（${r.stage}）：${String(r.err || '').slice(0, 200)}；可改文案/换风格包后重试，或改用「图片成片」。`
    }
    vfLog(uid, `[HTML成片] 完成：${r.mp4}（赛道=${r.vertical} 风格包=${r.pack}${r.voiced ? ' · 配音+字幕' : ''}${r.voiceErr ? ' · 配音失败：' + r.voiceErr : ''}）`)
    // 出片即作废草稿（与各线一致：同一套内容要重做就重新说一次命令）
    await clearHtmlFilmDraft(prisma, uid)
    return await filmDoneProtocol(uid, r)
  }

  return null
}
