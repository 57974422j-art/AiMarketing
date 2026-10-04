// ★VF_VIDEOLINE_V1（2026-09-24 用户定案）：【视频混剪】—— 完全独立的一条线
//
// 用户原话（本文件的设计依据）：
//   「我说的不是抽帧，是几个视频完整片段在全片中。如果需要视频理解能力可以抽帧方式理解插入视频。」
//   「原声静音加个键 ✅」「2 接受」（= 排分镜时按视频真实时长决定该镜文案长度，让片段能完整播完）
//   「3 不是交替，具体安排让 AI 来。如果需要 AI 有看视频能力也可以释放。」
//   「我建议视频图片合成单独做，不要混在现在的素材合成中。如果成熟了后期合并，免得把刚才做的弄乱了。」
//   「就叫 视频混剪」
//
// ── 本文件的设计约束（照 AI 制片线 vf-aivideo.ts 的先例）────────────────────
//   1. **自成一套**：入口 / 草稿 / 文案 / 分镜 / 确认卡 / 出片 全在本文件。
//   2. **零 import**：prisma 与工具函数全部由 `ctx` 注入 → 不可能连累其它三条线。
//   3. **自己的草稿**：内存 Map + DB tag `vf_draft_video`（与 vf_draft / vf_draft_ai / vf_draft_mix
//      都不同），读写一律 `equals` **精确匹配** —— 历史事故：用 `contains` 时别线清草稿会把本线一起删掉。
//   4. **内部绝不 throw**：异常转成人话返回 + 写日志。
//   5. **素材合成线一个字不动**（用户要求：怕把刚做好的弄乱）。
//
// ── 流程（2 张卡，客户端零改动：设置卡复用素材线那张，分镜卡复用 vfScriptCard）──
//   卡1 step='form'   复用素材线设置卡（它有 时长/画幅/音色/风格 + 上传，且 accept 带 video/*）
//   卡2 step='script' 分镜清单（每镜：🎬 用视频第几秒~第几秒 / 🖼 用第几张图）+ 确认出片
//   确认 → make_ai_video（plan 里带 type:'video' 的镜，渲染层 card_video 已支持）
//
// ── 画面怎么排（用户定案：**不写死交替，让 AI 来**）──────────────────────
//   排分镜时把【图片清单 + 视频清单（含真实时长 + 抽帧看懂的"这段在演什么"）】一起喂给 AI，
//   由它决定哪几镜用视频、从第几秒开始；约束：①相邻两镜不用同一个视频 ②同一视频切多段时隔 ≥2 镜
//   ③**用视频的那几镜，subtitle 按 4.5 字/秒 写够**（这是让"完整片段"能播完的关键：
//     最终镜长 = 该镜配音真实时长（tts 回填），文案长度对了，配音时长就≈视频时长）。

// ★VF_ANTIAI_V1（2026-09-29 用户定案「按建议顺序执行」）：「反 AI 味清单」的提示词 + 服务端兜底。
//   与 standard-commands.ts 同类：**纯函数、零依赖**（不碰 prisma、不碰别的线）——
//   所以这里静态 import 不违反本文件"零 import 连累别的线"的设计约束。
import { ANTI_AI_PROMPT, sanitizeAntiAiShots, pickDesignFields, lockUserTheme, splitLongSubtitles,
  VF_MOTION_PROMPT, ensurePersistentMotion,
  // ★VF_DECK_WIRE_V1（2026-10-01）：「富编排 PPT 页」的提示词（什么时候用 deck / 4 套风格怎么选 /
  //   字段怎么填）—— 与「图片成片」线（chat/route.ts 的 vfShotsPrompt）**共用同一份常量**。
  VF_DECK_PROMPT,
  // ★VF_NEIGHBOR_DEDUP_V1（2026-10-01）：「相邻两镜同大字」的服务端硬兜底（用户实测 3 组连续同大字）。
  // ★VF_DECK_STYLES_V1（2026-10-01）：用户选了画面模版时给提示词补一句「优先用用户选的」+ 值归一化
  //   （非法/缺省 → 'auto'，渲染层读 plan 根级 deck_style 的逐字契约）。
  dedupeAdjacentSameText, deckStylePromptNote, normalizeDeckStyle,
  // ★VF_STYLES_WIRE_V1（2026-10-01）：「🎨 画面风格」（5 套成品风格）→ 草稿 → plan 根级 `style`；
  //   用户选了就给提示词补一句「版式由系统统一负责，你只要把内容写足」。
  normalizeStyle, stylePromptNote } from './anti-ai'
// ★VF_MOTIONPPT_WIRE_V1（2026-09-30）：`VF_MOTION_PROMPT` = 「长镜必须有动效」的档位说明
//   （与 ANTI_AI_PROMPT 同样**两个分镜 prompt 共用**一份，免得两条线走偏）；
//   `ensurePersistentMotion` = 服务端兜底（AI 忘写时给 title/end 长镜自动补 `motion='grow'`）。
// ★VF_VIDI2V_V1（2026-09-29 用户定案「图视混剪 → 逐镜图生视频，50 点/秒」）：
//   同图去重 / 每片张数上限 / 计费秒数 全是**纯函数**（同样零依赖）—— 且与报价侧
//   （chat/route.ts 的 vfScriptCard 成本 + make_ai_video 实扣）共用同一份公式，避免报价与实扣漂移。
// ★VF_I2V_REUSE_V1（2026-09-29 team-lead 要求）：构造 i2vShots 的通用入口在 i2v-plan.ts 的
//   buildI2vShots() —— **本线只是第一个调用方**，别的线（图片成片 / 素材+AI）要开图生视频，
//   把那边的 shots + keyByPath 传进同一个函数即可（默认仍然只在图视混剪开启）。
import { buildI2vShots, i2vKeyMap } from './i2v-plan'
import type { I2vBuildResult, I2vPlan } from './i2v-plan'
// ★VF_I2VDFLT_V1（2026-09-30 用户定案）：把「关掉动图 / 保持静态 / 全部动起来 / 智能筛」这句话
//   解析成 i2v 取值（协议串 VF_I2V_OFF: 也认）—— 与闸门（standard-commands.ts）共用同一份规则，
//   保证"放行的那句话"和"真的能改设置的那句话"完全一致。standard-commands.ts 零依赖，不违反本文件约束。
import { i2vIntentOf } from '../standard-commands'
// ★VF_I2VSUIT_V1（2026-09-30 用户定案「i2v 只对『有主体可动』的素材开」）：
//   把"图片本地路径 → 识别摘要"的映射建出来（纯函数），交给 buildI2vShots 逐图分类 ——
//   界面/截图/海报/文字页这类"动起来也看不出"的直接跳过（省钱），并在日志里说明为什么。
import { i2vSummaryByPath } from './i2v-suit'
// ★VF_BANNER_V1（2026-09-29 用户定案）「顶部固定标题」：提炼两行 + 根级字段形状，两条线共用同一份
//   （纯逻辑放 banner.ts，与 anti-ai.ts / i2v-plan.ts 同类，静态 import 不连累别的线）。
import { buildBanner, fallbackBanner, bannerFieldOf,
  // ★VF_SBDUMP_V2（2026-10-01）：出片/样板镜/本地留档**共用同一个 plan 组装函数**（唯一来源；
  //   函数内部仍走 planWithBanner —— "banner 只挂根级、绝不进 shots"的契约没有变）
  buildVideoPlan } from './banner'
import type { VfBannerLines } from './banner'
// ★VF_POOL_V1（2026-09-30 用户定案「重复选图」「每次都是同几张」）：「成片素材池治理」纯函数 ——
//   与 anti-ai.ts / banner.ts / i2v-plan.ts 同类（零依赖、可单测），所以静态 import 不违反本文件
//   「零 import 连累别的线」的约束。真正治的是：① 同一素材在一份分镜里被反复用 ② 老用同几张。
import { dedupeMaterialUse, demoteRecent, recentNamesOf, mergeRecentRuns, shuffleDeterministic } from './material-pool'
// ★VF_MEMORY_V1（2026-09-30）：素材「提拔/禁用」名单（纯函数；名单本体存 agentMemory，IO 在本文件内用 ctx.prisma）
// ★VF_MATUI_V1（2026-09-30 用户定案）：清单改版 + 「🔄 换一张」+ 🎞 打勾（applyMatSwap / parseMatSwapMessage /
//   buildMatUIList / pickSwapTarget）—— 纯函数，零依赖。
import {
  parseMatPolicy, serializeMatPolicy, applyMatSet, parseMatSetMessage, materialStateOf, VF_MAT_POLICY_TAG,
  applyMatSwap, parseMatSwapMessage, buildMatUIList, pickSwapTarget, VF_MAT_UI_LIMIT,
} from './material-pool'
import type { MatPolicy, MatSetAction, MatUIItem } from './material-pool'
// ★VF_SHOTFIX_V1（2026-09-30）：分镜质量兜底（list 时长下限 + 相邻同内容合并）
import { ensureListDuration, mergeAdjacentSameShots } from './material-pool'

/* ==================== 类型（本线自己定义，不设共用类型文件） ==================== */

export interface VfVideoDraft {
  step: 'form' | 'script' | 'running'
  topic: string
  aspect: string            // portrait | landscape | auto
  dur: number
  voice: string
  theme: string
  bgm: string
  /** ★VF_DECK_STYLES_V1（2026-10-01 用户定案「我没看到新模版」）：画面模版（deck 系列风格）。
   *  取值 = 'auto'（AI 按题材自选）| 'deck' | 'deck-grad' | 'deck-mono' | 'deck-mag'
   *       | 'deck-glass' | 'deck-soft'；非法/缺省 → 'auto'（归一化在 anti-ai.ts 的 normalizeDeckStyle）。
   *  链路：设置卡 → 草稿 → 出片时写进 plan 根级 `deck_style`（渲染层读它）。 */
  deckStyle?: string
  /** ★VF_STYLES_WIRE_V1（2026-10-01 用户定案「目前模版有2套我是不是有点乱。能统一一下吗？」）：
   *  「🎨 画面风格」= 5 套成品风格之一（键名逐字见渲染层 themes.py 的 STYLES）：
   *   'bluewhite' | 'darkgrad' | 'cleanlight' | 'magazine' | 'softlux'。
   *  **缺省 / '' / 非法 = 不指定**（normalizeStyle 返回 ''）→ 出片时不写 plan 根级 `style`，走老链路（零回归）。 */
  style?: string
  /** ★OVERLAY_TEXT_SWITCH_V1（2026-09-29 用户定案）：画面大字开关 'on'|'off'
   *  只关【压在素材/视频上的大字】；独立文字卡（标题/结尾/列表…）与字幕不受影响。 */
  big?: string
  uploaded: string[]        // 本次上传的文件名（可选；仓库里的素材也会用）
  script: string
  brief: string             // 图文素材 + 视频理解结论（喂写文案/排分镜）
  shots?: any[]
  size?: number[]
  aspectResolved?: string
  cover?: number
  subLen?: number
  /** ★VF_I2VDFLT_V1（2026-09-30）：本次分镜用到的图片张数（分镜卡重出时显示"看完 N 张图"用） */
  imgN?: number
  /** ★VF_VIDI2V_V1（2026-09-29 用户定案「图视混剪逐镜图生视频」）：'all' | 'on' | 'off'
   *  ★VF_I2VDFLT_V1（2026-09-30 用户定案）：**'all' = 全部动起来 = 默认**（未传/缺省也按 'all'）；
   *   'on' = 智能筛（只对有主体可动的素材开，省钱，用户主动选）；'off' = 全部静态（不注入、不计费）。
   *  ★VF_I2VSUIT_V1：'all' 不按素材类型筛选（界面/海报类也照做）。 */
  i2v?: string
  /** ★VF_I2VSUIT_V1（2026-09-30 用户定案）：图片本地路径 → 识别摘要（判断"有没有主体可动"）。
   *  为什么存进草稿：起草时算过一次 i2v 计划（报价），出片时还要**用同一份摘要**再算一次（实扣）——
   *  报价与实扣必须同源（否则又会出现"卡片报 A、实扣 B"）。 */
  i2vSuit?: Record<string, string>
  /** ★VF_VIDI2V_V1：图片本地路径 → 个人仓库 key（出片时现算 i2vShots 用）。
   *  为什么要存进草稿：图生视频首帧只能喂**公网地址**，而分镜里的 src 是服务器本地路径；
   *  纯函数 buildI2vPlan() 需要这个映射把本地路径换回仓库 key（签名统一在 chat/route.ts 里做）。 */
  i2vKeys?: Record<string, string>
  /** ★VF_BANNER_V1（2026-09-29 用户定案）：「📌 顶部固定标题」开关 'on'（默认，AI 自动拟两行）| 'off'（不要）。 */
  pin?: string
  /** ★VF_BANNER_PIN2_V1（2026-09-29）：设置卡手填的「第 1 行」（留空 = AI 自动拟）；手填优先，永不覆盖。 */
  pin1?: string
  /** ★VF_BANNER_PIN2_V1：设置卡手填的「第 2 行」（留空 = AI 自动拟）。 */
  pin2?: string
  /** ★VF_BANNER_V1：起草时提炼出来的两行标题（AI 或其规则兜底）；出片时挂到 plan 根级 `banner`。 */
  banner?: VfBannerLines
  /** ★原声开关（用户定案"原声静音加个键"）：默认 false=静音（配音统一铺）。
   *  ⚠️ 置 true 需要渲染层支持"把视频原声压到 20~30% 并混进最后混音" → 放在第 3 步，先不假装生效。 */
  keepAudio?: boolean
  /** ★VF_MEMORY_V1（2026-09-30）：素材清单（`[{name,kind,state}]`，state ∈ all|outcome|deny|allow）——
   *  卡片「素材识别结果」逐条给「✅ 当素材用 / 🚫 别用」。由 ctx.matUI() 生成后存进草稿。
   *  ★VF_MATUI_V1（2026-09-30）：每条再加 `i2v`（🎞 打勾）与 `url`（图片 24h 签名缩略图）；
   *  顺序 = 可用在前、已排除在后；上限 40（可用优先占额度）。 */
  mats?: Array<MatUIItem & { url?: string }>
  /** ★VF_MATUI_V1：共 N 条可用（**总数**，不是裁剪后的条数）—— 卡片显示"共 N 条可用 / M 条已排除" */
  matUsableN?: number
  /** ★VF_MATUI_V1：M 条已排除（总数） */
  matExcludedN?: number
  /** ★VF_MATUI_V1（2026-09-30 用户定案「🎞 打勾才动」）：当前「🎞 打勾」名单（随名单落库，出草稿时取）。
   *  为什么要存进草稿：i2vBuildOf() 是**纯函数**（不能读库），而 'picked' 档必须按勾选名单过滤 →
   *  由本线在读到名单的那一刻同步到这里。 */
  i2vPicked?: string[]
}

/** 依赖注入：由 route.ts 提供（本文件不 import 项目内部路径，避免循环依赖/路径写错） */
export interface VfVideoCtx {
  uid: number
  userMessage: string
  auth: any
  prisma: any
  executeToolCall: (name: string, args: Record<string, any>, auth: any) => Promise<string>
  /** 注意：项目里的 generateText 可能返回 null（调用失败）→ 本文件必须自己兜住 */
  generateText: (prompt: string) => Promise<string | null>
  vfScriptCard: (vd: any, shots: any[], imgN: number, brief: string, aspect: string, cover?: number, estSec?: number) => string
  log: (uid: number | string, msg: string) => void
  voiceList: any[]
  /** ★VF_MEMORY_V1：第 4 参为用户显式「提拔/禁用」名单（deny 一律排除、allow 一律保留） */
  listRepoMaterials: (userId: number | string, limit?: number, mode?: 'spread' | 'recent',
    opts?: { allow?: string[] | null; deny?: string[] | null }) => Promise<any[]>
  /** ★VF_MEMORY_V1：卡片「素材识别结果」的逐条清单（全仓库 + 状态；只列目录，**不触发 VL**）。
   *  可选 —— 未提供时卡片不显示素材按钮（向后兼容）。
   *  ★VF_MATUI_V1：返回体带上两个**总数**（可用 / 已排除），卡片据此显示"共 N 可用 / M 已排除"。 */
  matUI?: (userId: number | string) => Promise<{ items: Array<MatUIItem & { url?: string }>; usableN: number; excludedN: number }>
  summarizeMaterials: (userId: number | string, mats: any[], visN: number) => Promise<string>
  /** ★视频探测（时长/宽高/有无音轨）+ 抽帧理解 —— 见 video-material.ts 的 probeVideos/describeVideoClips */
  probeVideos: (userId: number | string, mats: any[]) => Promise<any[]>
  /** ★VF_MULTIFRAME_V1：多带一个 userId —— 抽帧的临时文件要落在该用户的目录下 */
  describeVideoClips: (clips: any[], userId?: number | string) => Promise<string>
  downloadMaterials: (userId: number | string, mats: any[]) => Promise<any[]>
  splitScript: (script: string, n: number, maxLen?: number) => string[]
  parseForm: (userMessage: string) => Record<string, any> | null
}

/* ==================== ① 草稿（本线自己一份） ==================== */

const VF_VIDEO_DRAFT = new Map<number, VfVideoDraft>()
const VF_VIDEO_TAG = 'vf_draft_video'      // ★与 vf_draft / vf_draft_ai / vf_draft_mix 都不同

async function saveVfVideoDraft(db: any, uid: number | string, d: VfVideoDraft): Promise<void> {
  const content = '视频混剪草稿:' + JSON.stringify(d)
  try {
    const ex = await db.agentMemory.findFirst({ where: { userId: String(uid), tags: { equals: VF_VIDEO_TAG } }, orderBy: { updatedAt: 'desc' } })
    if (ex) await db.agentMemory.update({ where: { id: ex.id }, data: { content } })
    else await db.agentMemory.create({ data: { userId: String(uid), content, tags: VF_VIDEO_TAG, salience: 0.5 } })
  } catch { /* 草稿存不上不影响本轮 */ }
}

async function loadVfVideoDraft(db: any, uid: number | string): Promise<VfVideoDraft | null> {
  if (VF_VIDEO_DRAFT.has(Number(uid))) return VF_VIDEO_DRAFT.get(Number(uid)) || null
  try {
    const dm = await db.agentMemory.findFirst({ where: { userId: String(uid), tags: { equals: VF_VIDEO_TAG } }, orderBy: { updatedAt: 'desc' } })
    if (dm?.content) {
      const t = String(dm.content)
      const i = t.indexOf('{')
      const d = JSON.parse(i >= 0 ? t.slice(i) : t) as VfVideoDraft
      VF_VIDEO_DRAFT.set(Number(uid), d)
      return d
    }
  } catch { /* ignore */ }
  return null
}

export async function clearVfVideoDraft(db: any, uid: number | string): Promise<void> {
  VF_VIDEO_DRAFT.delete(Number(uid))
  try { await db.agentMemory.deleteMany({ where: { userId: String(uid), tags: { equals: VF_VIDEO_TAG } } }) } catch { /* ignore */ }
}

export async function hasVfVideoDraft(db: any, uid: number): Promise<boolean> {
  if (VF_VIDEO_DRAFT.has(uid)) return true
  const d = await loadVfVideoDraft(db, uid)
  return !!d?.step
}

/* ── ★VF_POOL_V1：「最近用过」记录（治"每次都是同几张"）────────────────────
 * 用户原话：「第四条 3张动图我还是没懂」+ 反复看到同几张素材 → 选素材时要把最近 1~2 次用过的
 * **排到后面**（不是排除，素材不够时仍可用）。
 * 存储：**不新增表** —— 复用既有 agentMemory（只需 userId/content/tags 三个现成字段），
 * 用本线自己的 tag（与 vf_draft_video 一样，一律 equals 精确匹配，绝不用 contains 误伤别线）。 */
/** ★VF_POOL_V1（2026-09-30，team-lead 放开 route.ts 后定案）：这个 tag 是**两条成片线共用**的
 *  ——「图片成片/素材线」也读同一份（见 chat/route.ts 的 vfRememberUsedImages）。
 *  为什么共用而不是各线一个：两条线取的是**同一个个人仓库**，用户抱怨的"每次都是同几张"是池级现象；
 *  若各线各记一份，A 线降权只躲开 A 线自己用过的，B 线用过的照样排在前面 → 问题只解决一半。
 *  仍保持**本表 agentMemory 精确 equals 匹配**（历史事故：contains 会误伤别线草稿）。 */
const VF_RECENT_TAG = 'vf_recent_used'
const VF_RECENT_HEAD = '成片最近用过:'

export async function loadRecentUsedRuns(db: any, uid: number | string): Promise<string[][]> {
  try {
    const dm = await db.agentMemory.findFirst({
      where: { userId: String(uid), tags: { equals: VF_RECENT_TAG } },
      orderBy: { updatedAt: 'desc' },
    })
    if (dm?.content) {
      const t = String(dm.content)
      const i = t.indexOf('[')
      const j = JSON.parse(i >= 0 ? t.slice(i) : t)
      return Array.isArray(j) ? j : []
    }
  } catch { /* 读不到 → 视为没有历史 */ }
  return []
}

export async function saveRecentUsedRuns(db: any, uid: number | string, runs: string[][]): Promise<void> {
  try {
    const content = VF_RECENT_HEAD + JSON.stringify(runs)
    const ex = await db.agentMemory.findFirst({
      where: { userId: String(uid), tags: { equals: VF_RECENT_TAG } },
      orderBy: { updatedAt: 'desc' },
    })
    if (ex) await db.agentMemory.update({ where: { id: ex.id }, data: { content } })
    else await db.agentMemory.create({ data: { userId: String(uid), content, tags: VF_RECENT_TAG, salience: 0.4 } })
  } catch { /* 记不上只影响"下次降权"，不影响本轮出片 */ }
}

/* ==================== ② 入口判定（本线自己的词表） ==================== */

/** 本线入口词：视频混剪 / 用我的视频 / 视频+图片 之类 */
const VIDEO_LINE_ENTRY = /视频混剪|混剪|视频成片|用我的视频|我的视频(做|合成|剪|成片)|把.{0,6}视频.{0,6}(剪|混|合成)|视频.{0,3}(加|和|\+).{0,3}图片|图片.{0,3}(加|和|\+).{0,3}视频/
/** 别线的明确入口词 —— 出现这些一律不认领（优先级规则，历史事故：残留草稿吞掉别线的消息）
 *  ★VF_RENAME_V1（2026-09-28）：素材线按钮改名成短名「图片成片」→ 这里必须认得它，
 *    否则本线草稿活着时会把「图片成片」这条命令蹭走。 */
const OTHER_LINE_ENTRY = /本地成片|图片成片|素材成片|素材合成|素材智能成片|用我的素材|用我的素材库|用素材库|AI\s*制片|AI\s*成片|AI\s*制作|全部\s*AI|全\s*AI|素材\s*\+\s*AI|混合创作|发布|发到|发抖音|发小红书|发微博|发视频号|平台:/

export function matchesVideoLine(msg: string): boolean {
  const m = String(msg || '').trim()
  if (!m) return false
  // 协议串不是入口词（卡片提交要靠"本线有草稿"来认领）
  if (/^(VF_FORM|VF_JSON|MAKE_VIDEO|VF_EDIT|VF_BRIEF)/.test(m)) return false
  if (OTHER_LINE_ENTRY.test(m)) return false
  return VIDEO_LINE_ENTRY.test(m)
}

/** 本线是否该接管这一轮（有本线草稿 → 一定接管，否则草稿永远卡住）
 *
 *  `opts.otherStdCommand`（★VF_STDCMD_GUARD_V1，2026-09-28 实测）：这句话命中了【别条】标准模式命令
 *  （含 tool 类：写小红书文案 / 产品海报 / 数字人口播）→ 本线**一律不认领**。
 *  事故原型（本地单测已复现）：本线草稿停在 form/script 时，「帮我写一个小红书文案」会被本线接走。
 *  命令表是唯一路由权威（在 route.ts 判定后传进来），这样本文件仍保持"零 import"、可独立测。
 */
export async function shouldTakeOverVideoLine(
  db: any, uid: number, userMessage: string, opts?: { otherStdCommand?: boolean },
): Promise<boolean> {
  const m = String(userMessage || '')
  if (opts?.otherStdCommand) return false
  const d = await loadVfVideoDraft(db, uid)
  const _f = String(m).trim().match(/^VF_FORM:(\{[\s\S]*\})/)
  if (_f) {
    // ★本线复用了素材线那张设置卡 → 表单字段与素材线**相同**，只能靠"本线草稿停在 form"来认领
    return !!d && d.step === 'form'
  }
  if (OTHER_LINE_ENTRY.test(m)) return false
  if (d?.step) {
    // running 草稿一律视为僵尸：自清 + 只有明确入口词才重新接管（历史事故：终身吞掉别线的「确认」）
    if (d.step === 'running') {
      await clearVfVideoDraft(db, uid)
      return matchesVideoLine(m)
    }
    return true
  }
  return matchesVideoLine(m)
}

/* ==================== ③ 小工具（零依赖，自己一份） ==================== */

const FLOW_WORD = /确认|开始|生成吧|出片|就这个|^行$|^好$|^OK$|可以|下一步/i
const ENTRY_STRIP = /图视混剪|视频混剪|混剪|视频成片|用我的视频|我的视频|本地成片|图片成片|素材合成|帮我做.{0,3}(一条|个|条)?视频|帮我成片|帮我做视频|做一条视频|做个视频|做成片|做个宣传片/g

function cleanText(s: any, max = 4000): string {
  return String(s == null ? '' : s).replace(/[*#`]/g, '')
    .replace(/^[\s"'“”「」『』]+|[\s"'“”「」『』]+$/g, '').trim().slice(0, max)
}
function clampNum(v: any, lo: number, hi: number, dflt: number): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return dflt
  return Math.max(lo, Math.min(hi, n))
}
function parseJsonArray(raw: string): any[] | null {
  try {
    const m = String(raw || '').match(/\[[\s\S]*\]/)
    if (!m) return null
    const a = JSON.parse(m[0])
    return Array.isArray(a) ? a : null
  } catch { return null }
}

/* ── ★VF_VIDI2V_V1（2026-09-29 用户定案「图视混剪 → 逐镜图生视频」）── */

/**
 * ★VF_I2V_REUSE_V1：本线草稿 → **通用构造**（出片 args / 计划 / 日志话术）。
 * ⚠️ 本线只是"第一个调用方"：真正干活的是 i2v-plan.ts 的 buildI2vShots()。
 *    别的成片线要开图生视频，把它那边的 shots + keyByPath 传进同一个函数即可
 *    （本函数的角色 = "草稿字段 → 函数入参" 的适配层，一行）。
 * 设置卡选了「保持静态」→ args 为空对象、计划为空：**一根首帧都不注入、也不计费**。
 */
export function i2vBuildOf(vd: VfVideoDraft): I2vBuildResult {
  return buildI2vShots({
    shots: vd?.shots || [],
    keyByPath: vd?.i2vKeys || {},
    // ★VF_MATUI_V1（2026-09-30 用户定案「能不加 AI 做视频就不加」）：**缺省 = 'off'（不动）** ——
    //   旧草稿没这个字段时也不动（不偷偷花钱）；用户想动就在设置卡切到 picked / on / all。
    enabled: vd?.i2v ?? 'off',
    // ★VF_I2VSUIT_V1：把"图片本地路径 → 识别摘要"透给通用函数 → 只对有主体可动的素材开。
    //   旧草稿没有这个字段（undefined）→ 不过滤（保持旧行为；用户重排一次分镜即可拿到筛选）。
    //   'all' / 'picked' 时 buildI2vShots 内部会忽略本参数（用户手动点名了）。
    summaryByPath: vd?.i2vSuit,
    // ★VF_MATUI_V1：'picked' 档只动清单里打了勾（🎞）的素材
    picked: vd?.i2vPicked ?? null,
  })
}

/** 只要"计划"（确认卡报价 / 自测脚本用） */
export function i2vPlanOf(vd: VfVideoDraft): I2vPlan {
  return i2vBuildOf(vd).plan
}

/** 把通用构造返回的说明原样写进日志（哪几张动 / 为什么没动 / 哪些拿不到公网地址 —— 排障全看这几行） */
function logI2vNotes(ctx: VfVideoCtx, notes: string[]): void {
  for (const n of notes) ctx.log(ctx.uid, '[VF-V][图生视频] ' + n)
}

/* ==================== ④ 卡片 ==================== */

function formCard(vd: VfVideoDraft): string {
  return 'VF_JSON:' + JSON.stringify({
    step: 'form',
    hint: '视频混剪：用你仓库里的**视频片段 + 图片**混排（AI 决定哪几镜用视频）；原声默认静音、配音统一铺',
    topic: vd.topic || '',
    voice: vd.voice,
    voices: (vd as any).voiceList || [],
    aspect: vd.aspect,
    dur: vd.dur,
    theme: vd.theme,
    bgm: vd.bgm,
    // ★VF_DECK_STYLES_V1（2026-10-01）：画面模版**回显**（用户从设置卡再进来还能看到自己选的）
    deckStyle: vd.deckStyle || 'auto',
    // ★VF_STYLES_WIRE_V1（2026-10-01）：「🎨 画面风格」**回显**（未选 = '' → 卡片显示"跟随 AI / 不指定"）
    style: vd.style || '',
    big: vd.big || 'on',      // ★OVERLAY_TEXT_SWITCH_V1：画面大字（加 / 不加），默认加
    // ★VF_VIDI2V_V1：让图动起来（逐镜图生视频）开关；★VF_MATUI_V1 起**默认不动**（'off'，0 点动图）
    i2v: vd.i2v || 'off',
    // ★VF_BANNER_V1：顶部固定标题（AI 自动拟两行）开关 —— 默认开（用户要"默认这样，方便后期集成自动化"）
    pin: vd.pin || 'on',
    // ★VF_BANNER_PIN2_V1：手填的两行**回显**（用户从「设置」回来还能看到自己填过的；留空=AI 自动拟）
    pin1: vd.pin1 || '',
    pin2: vd.pin2 || '',
    source: 'repo',
  })
}

/* ==================== ⑤ 起草（写文案 → 排分镜 → 确认卡） ==================== */

/* ── ★VF_MEMORY_V1（2026-09-30）：素材「提拔/禁用」名单（本线用 ctx.prisma 读写 agentMemory）──
 * 纯逻辑（解析/合并/状态判定）在 material-pool.ts；这里只做本线的库 IO。 */
async function loadVideoMatPolicy(db: any, uid: number | string): Promise<MatPolicy> {
  try {
    const m = await db.agentMemory.findFirst({
      where: { userId: String(uid), tags: { contains: VF_MAT_POLICY_TAG } },
      orderBy: { updatedAt: 'desc' },
    })
    return parseMatPolicy(m?.content)
  } catch { return { allow: [], deny: [], i2v: [] } }
}
/** ★VF_MATUI_V1：把名单正文写回（落库一处，供 applyMatSet / applyMatSwap 两条路复用） */
async function saveVideoMatPolicyContent(db: any, uid: number | string, p: MatPolicy): Promise<void> {
  const content = serializeMatPolicy(p)
  try {
    const ex = await db.agentMemory.findFirst({ where: { userId: String(uid), tags: { contains: VF_MAT_POLICY_TAG } }, orderBy: { updatedAt: 'desc' } })
    if (ex) await db.agentMemory.update({ where: { id: ex.id }, data: { content, tags: VF_MAT_POLICY_TAG } })
    else await db.agentMemory.create({ data: { userId: String(uid), content, tags: VF_MAT_POLICY_TAG, salience: 0.6 } })
  } catch { /* 存不上只影响下次起草，不影响本轮 */ }
}
async function saveVideoMatPolicy(db: any, uid: number | string, name: string, action: MatSetAction): Promise<void> {
  // ★VF_MATUI_V1：动作扩到 pick/unpick（🎞 勾选/取消）
  await saveVideoMatPolicyContent(db, uid, applyMatSet(await loadVideoMatPolicy(db, uid), name, action))
}

async function draftAndCard(ctx: VfVideoCtx, vd: VfVideoDraft, retryHint = ''): Promise<string> {
  const { uid } = ctx
  const dur = Math.max(5, Math.min(900, Number(vd.dur) || 30))

  // ── 1) 素材：图片 + 视频（视频要探测元信息 + 抽帧看懂内容）──
  // ★VF_MEMORY_V1（2026-09-30）：先读用户「提拔/禁用」名单 → 起草时即生效（deny 一律排除、allow 一律保留）
  const _matPolicy = await loadVideoMatPolicy(ctx.prisma, uid)
  // ★VF_MATUI_V1：把「🎞 打勾」名单同步进草稿（i2vBuildOf 是纯函数，'picked' 档只能从这里拿到勾选名单）
  vd.i2vPicked = _matPolicy.i2v || []
  const matsRaw = await ctx.listRepoMaterials(uid, 30, 'spread', { allow: _matPolicy.allow, deny: _matPolicy.deny })
  // ★VF_MEMORY_V1：卡片上"素材识别结果"那一段的逐条清单（全仓库 + 状态），随草稿存起来
  // ★VF_MATUI_V1：清单改版（可用在前 / 已排除在后 / 上限 40 / 图片带缩略图 / 🎞 勾选）+ 两个总数
  if (ctx.matUI) {
    try {
      const _mu = await ctx.matUI(uid)
      vd.mats = _mu.items; vd.matUsableN = _mu.usableN; vd.matExcludedN = _mu.excludedN
    } catch { /* 拿不到就不显示按钮 */ }
  }
  // ★VF_POOL_V1（2026-09-30）素材池治理之二：**打乱 + 最近用过降权**
  //   治用户实测「每次都选同几张」（原话：「第四条 3张动图我还是没懂」+ 反复同图）。
  //   · 打乱用本轮 seed（Date.now()）→ 每轮顺序都不同，不再"永远从最前面几张挑"；
  //   · 最近 1~2 次用过的素材稳定排到**后面**（不是排除，素材不够时仍可用）。
  //   ⚠️ 必须在这里打乱：后面 summarizeMaterials 的「图1..图N」与 downloadMaterials 的 imgPaths
  //      都从同一份 mats 顺序派生 —— 先打乱才能保证"摘要编号"与"pick 编号"严格对齐。
  const recentRuns = await loadRecentUsedRuns(ctx.prisma, uid)
  const _shuf = shuffleDeterministic((matsRaw || []) as any[], Date.now())
  const _dem = demoteRecent(_shuf, recentNamesOf(recentRuns))
  if (_dem.demoted) ctx.log(uid, `[VF-V][素材池] 最近用过 ${_dem.demoted} 条已排到后面（不是排除，素材不够时仍可用）`)
  const mats = _dem.items
  const imgs = (mats || []).filter((m: any) => m.kind === 'image')
  // ★VF_VIDPROBE_V2：探测走 OSS 签名直链（**不下载整段**）—— 用户素材里可能有 3 分钟以上的长视频，
  //   旧做法"先全下再探"会把聊天请求堵死。
  // ★VF_VIDGUARD_V1：超保护线的（单文件 > 400MB / 单条 > 30 分钟）不拿出来当片段用（日志如实写）。
  const clipsAll = (await ctx.probeVideos(uid, mats || [])) || []
  const clips = clipsAll.filter((c: any) => !c.over).slice(0, 6)   // 与 VF_VIDEO_MAX_CLIPS 一致
  const skipped = clipsAll.filter((c: any) => c.over)
  if (skipped.length) {
    ctx.log(uid, '[VF-V] 本次不用这些视频（过大/过长）：' +
      skipped.map((c: any) => `${c.name}(${c.sizeMB}MB/${c.dur}s)`).join('、'))
  }
  // ★VF_MULTIFRAME_V1：每个视频抽 2~5 帧、一次多图识别 → 得到"时间轴"（哪一段有内容）
  // ★三件事【并行】做（视频时间轴 / 图片识别 / 图片下载）—— 串行会让起草多等十几秒，
  //   而它们彼此独立，并行后总耗时≈最慢的那一件。
  const [clipLines, imgBrief, imgLocal] = await Promise.all([
    ctx.describeVideoClips(clips, uid),
    (imgs.length && ctx.summarizeMaterials)
      ? ctx.summarizeMaterials(uid, mats || [], 8) : Promise.resolve(''),
    imgs.length ? ctx.downloadMaterials(uid, imgs.slice(0, 20)) : Promise.resolve([] as any[]),
  ])
  const brief = [imgBrief, clipLines].filter(Boolean).join('\n')
  const imgPaths = imgLocal.map((m: any) => m.localPath).filter(Boolean)
  // ★VF_VIDI2V_V1：图片本地路径 → 个人仓库 key 的映射（用通用小工具 i2vKeyMap 建）。
  //   为什么需要它：分镜里 bgimage 的 src 是**服务器本地路径**（downloadMaterials 下的 material/），
  //   而图生视频供应商要求首帧是**公网可拉取**的地址（拿不到 cookie、读不到服务器磁盘）
  //   → 只能换回仓库 key，由 chat/route.ts 的 resolveImageToPublicUrl() 现签 OSS 直链（24h）。
  const i2vKeyByPath = i2vKeyMap(imgLocal)
  // ★VF_I2VSUIT_V1（2026-09-30 用户定案「i2v 只对有主体可动的素材开」）：
  //   用**本次的看图结论**（imgBrief：图N（name）：摘要）建"本地路径 → 摘要"映射 —— 只给
  //   `imgBrief`（不含视频行），因为 i2v 只作用在图片镜上。出片时复用同一份（存进草稿 vd.i2vSuit）。
  const i2vSuitByPath = i2vSummaryByPath(imgBrief, imgLocal)
  ctx.log(uid, `[VF-V] 素材：图 ${imgPaths.length} 张 / 视频 ${clips.length} 个（含${clips.filter((c: any) => c.sizeMB).length} 条已探到大小）`)

  if (!imgPaths.length && !clips.length) {
    vd.step = 'form'
    return '视频混剪：你的个人仓库里没有可用素材（图片或视频都行）。先传一些素材（设置卡上的「📤 我上传素材」支持视频），再来一句「视频混剪」我就开工。'
  }

  // ── 2) 画幅：用户指定优先；auto 则按第一个视频/素材的宽高判断 ──
  let aspect = vd.aspect === 'landscape' ? 'landscape' : (vd.aspect === 'portrait' ? 'portrait' : '')
  if (!aspect) {
    const c0 = clips.find((c: any) => c.w && c.h)
    aspect = c0 ? (Number(c0.w) > Number(c0.h) ? 'landscape' : 'portrait') : 'portrait'
  }
  const size = aspect === 'landscape' ? [1280, 720] : [720, 1280]

  // ── 3) 文案：用户贴了就用他的 ──
  const need = Math.round(dur * 4.5)
  const ctxTxt = `【他的素材】\n${brief || '（没有可用素材）'}`
  let script = cleanText(vd.script || '')
  if (!script) {
    try {
      script = cleanText(await ctx.generateText(
        `你是短视频口播文案写手。写一条约 ${dur} 秒的中文口播文案。\n${ctxTxt}\n` +
        `【主题】${vd.topic || '（自行决定，贴合素材）'}\n` +
        `要求：①必须 ${need} 字左右，不得少于 ${Math.round(dur * 3)} 字 ②开头 3 秒抓人 ` +
        `③用「。」「！」断句 ④保留数字与专业术语 ⑤只输出文案本身，不要标题、不要解释、不要 markdown、不要引号。`,
      ))
    } catch (e: any) { ctx.log(uid, '[VF-V] 文案失败: ' + String(e?.message || e).slice(0, 120)) }
  }
  if (!script) return '视频混剪：文案没写出来（AI 调用失败）。回「重试」我再试一次。'
  ctx.log(uid, `[VF-V] 文案 ${script.length} 字（目标 ${need}）`)

  // ── 3.5) ★VF_BANNER_V1（2026-09-29 用户定案）「顶部固定标题」：出片前用一次**便宜的文本调用**拟两行 ──
  //   为什么在【起草】时就提炼、而不是出片那一刻：① 文案在这里才定稿（出片只读草稿）；② 出片那一刻再调
  //   AI = 用户点「确认」后还要多等一次网络往返；③ 提炼失败/返回不合法一律走规则兜底（首句前 10 字 /
  //   次句前 16 字）—— **绝不因为一个标题把整条片卡死**。开关关掉就不调、不带字段（渲染层不画）。
  try {
    const _banner = await buildBanner({
      script, brief, topic: vd.topic, pin: vd.pin ?? 'on',
      // ★VF_BANNER_PIN2_V1：手填优先（两行都填 → 本函数完全不调 AI）
      pin1: vd.pin1, pin2: vd.pin2,
      generateText: ctx.generateText,
    })
    for (const _n of _banner.notes) ctx.log(uid, '[VF-V][固定标题] ' + _n)
    vd.banner = _banner.lines || undefined
  } catch (e: any) {
    // buildBanner 内部已兜底，这里只是"最后一道"——任何意外都用规则兜底，绝不上抛
    ctx.log(uid, '[VF-V][固定标题] 提炼异常 → 规则兜底：' + String(e?.message || e).slice(0, 100))
    vd.banner = fallbackBanner(script)
  }

  // ── 4) 排分镜：把图片 + 视频（含真实时长与内容）一起给 AI，由它决定哪几镜用视频 ──
  const shotN = Math.max(4, Math.min(40, Math.round(dur / 5)))
  const prompt = `你是短视频混剪编导。把下面这条口播文案排成分镜，画面用【用户的素材】。\n` +
    `画幅 ${aspect === 'landscape' ? '横屏 16:9' : '竖屏 9:16'}，总时长约 ${dur} 秒，【必须切成 ${shotN} 个镜头左右（±3 以内）】。\n` +
    `【可用的图】共 ${imgPaths.length} 张（图号 1~${imgPaths.length}）${imgBrief ? '：\n' + imgBrief : ''}\n` +
    `【可用的视频】共 ${clips.length} 个（编号 1~${clips.length}）${clipLines ? '：\n' + clipLines : ''}\n` +
    (retryHint ? `⚠️上次你没排好：${retryHint}\n` : '') +
    `\n要求：\n` +
    `①【用视频的镜】写成 {"type":"video","vclip":1,"vstart":12,"dur":6,"text":"画面大字","subtitle":"这一镜念的文案"}\n` +
    `   · vclip=用第几个视频；vstart=从该视频第几秒开始；dur=这一镜大概几秒（建议 4~10 秒）\n` +
    `   · ★vstart 要落在上面视频清单里标出的【★推荐片段】区间内 —— 那是"看过画面之后"挑出的有内容的一段；\n` +
    `     不要从视频最开头（常是片头/花字）或最结尾切；标了"无推荐 /（本次不用）"的视频不要用\n` +
    `   · ★vstart+dur 之外还要再留 2 秒以上余量（别贴着片尾切）——配音可能比 dur 略长，留余量才不会"放慢/循环"\n` +
    `   · ★该镜 subtitle 必须【按 4.5 字/秒 写够】（dur 6 秒 → 约 27 字）——最终镜长按配音真实时长算，\n` +
    `     文案长度对了，视频片段才能【完整播完】（否则画面会被放慢或循环）\n` +
    `②【用图片的镜】写成 {"type":"bgimage","pick":2,"text":"画面大字","subtitle":"..."}\n` +
    `③【所有 subtitle 拼起来必须完整覆盖文案，且顺序一致】；不许扩写、不许重复、不许自己编句子\n` +
    `④相邻两镜不要用同一个视频；同一个视频切多段时，两段之间至少隔 2 镜\n` +
    // ★VF_POOL_V1（2026-09-30 用户实测「AI 选择重复图一张」「连着两镜看着一样」）：
    //   提示词里给出"每张最多用一次"的**硬规矩**（服务端在归一化阶段还有兜底去重，见下方 dedupeMaterialUse）。
    `⑩【素材不许重复用】同一张图 / 同一个视频在一份分镜里【最多用一次】；` +
    `只有在素材总数 < 镜头数时才允许重复，且同一素材的两镜之间【至少隔 2 镜】\n` +
    // ★VF_MOTIONPPT_WIRE_V1（2026-09-30）：「长镜必须有动效」档位接进提示词（放在 ⑩ 附近）。
    //   用户实测原话：「第一个图片应该是个 PPT 没有动效或者是不明显，时间过长」；逐帧实测第 1 镜
    //   "动 1 秒、静止 5.5 秒"。根因 = 渲染层动效字段（enter/motion/frame/wipe/bgblur）在 src/ 里
    //   0 命中（提示词没接线）→ AI 永远不写。这段规矩与图片成片线**共用同一份常量**（anti-ai.ts）。
    VF_MOTION_PROMPT +
    // ★VF_DECK_WIRE_V1（2026-10-01）：把「富编排 PPT 页」（variant=deck / 4 套风格）接进本线提示词
    //   —— 何时用/何时不用/字段怎么填；与「图片成片」线共用同一份常量（anti-ai.ts）。
    VF_DECK_PROMPT +
    // ★VF_DECK_STYLES_V1（2026-10-01）：用户在设置卡选了画面模版 → 告诉 AI「必须用用户选的」
    //   （用户没选 = 'auto' → 这里加了个空串，等于没加，保持"AI 自选"的现状不变）。
    deckStylePromptNote(vd.deckStyle) +
    // ★VF_STYLES_WIRE_V1（2026-10-01）：用户选了「画面风格」→ 告诉 AI「版式由系统统一负责、内容写足」
    //   （未选 / 非法 → 空串，等于没加，AI 自选版式的现状一字不变）。
    stylePromptNote(vd.style) +
    // ★VF_TEXTCARD_V1（2026-09-29 用户实测「没单独生成页面 都是图片加打字」）：
    //   原来提示词只说"画面用用户的素材" → AI 从不排独立文字卡，整条片成了"图文轮播"（12/12 镜都是素材镜）。
    //   现在明确要求：每 4~5 镜至少 1 镜用【不用素材】的文字卡，画面才有层次与节奏。
    `⑧【必须有独立文字卡】每 4~5 镜里至少 1 镜用【不用素材】的文字卡（别整片都是"图/视频 + 白字"）：\n` +
    `   · {"type":"title","text":"4~8 字短句","subtitle":"…"} —— 大字标题卡\n` +
    `   · {"type":"list","title":"小标题","items":["要点1","要点2","要点3"],"subtitle":"…"} —— 逐条揭示\n` +
    `   · {"type":"compare","left":"旧做法","right":"新做法","leftDesc":"≤14 字","rightDesc":"≤14 字","subtitle":"…"} —— 左右对比\n` +
    `   · {"type":"number","value":10,"suffix":"倍","label":"效率提升","subtitle":"…"} —— 数字卡（**只在文案里真有这个数字时**才用）\n` +
    `   这几类卡的画面由渲染层按【主题】自动排版（渐变底 + 强调色），比压在素材上更清楚\n` +
    `⑤text 是画面大字：4~8 字的完整短语，不要从文案截半句、不要标点\n` +
    `⑥只输出严格 JSON 数组（不要 markdown、不要解释）\n` +
    `⑦【视频要用够】有视频可用时，视频镜不少于总镜数的 1/3（你自己的实拍比图更有说服力）；\n` +
    `   但也不要把画面全给视频（视频镜不超过 2/3，避免整片都是同一支片子）\n` +
    // ★VF_ANTIAI_V1：反 AI 味硬规矩（emoji 图标 / 假数据 / 每镜 ken burns / 角标 / 卡型重复 / 对比卡限字数）
    ANTI_AI_PROMPT +
    `\n编镜依据（文案）：\n${script}`
  let raw = ''
  try { raw = (await ctx.generateText(prompt)) || '' } catch (e: any) { ctx.log(uid, '[VF-V] 分镜失败: ' + String(e?.message || e).slice(0, 120)) }
  let arr = parseJsonArray(raw)
  if (!arr) {
    try {
      const fixed = (await ctx.generateText(
        `下面这段本应是 JSON 数组但语法有误。请【只修正 JSON 语法、不改内容】，只输出修正后的 JSON 数组：\n${String(raw).slice(0, 6000)}`,
      )) || ''
      arr = parseJsonArray(fixed)
      ctx.log(uid, arr ? '[VF-V] 分镜 JSON 修复成功' : '[VF-V] 分镜 JSON 仍失败')
    } catch (e: any) { ctx.log(uid, '[VF-V] 分镜修复异常: ' + String(e?.message || e).slice(0, 120)) }
  }
  if (!arr || !arr.length) return '视频混剪：分镜没排出来（AI 输出不是合法 JSON，已重试一次）。回「重试」再排一次。'

  // ── 5) 归一化：视频镜 → 服务端本地路径 + start/dur（越界就夹回来）；图片镜 → pick → 本地路径 ──
  // ★VF_SHOTCAP_V1（2026-09-28 用户定案「每镜视频硬上限」）：
  //   提示词里已经写了"每镜 4~10 秒"，但那只是【软约束】—— AI 偶尔会排出一个 20 秒的镜。
  //   这里做【服务端硬夹取】（渲染层仍有放慢/循环兜底），并把被夹取的镜数如实写进日志。
  // ★VF_TEXTCARD_V1（2026-09-29）：AI 明确要的【独立文字卡】——归一化时照做，不再一律变成 bgimage
  const TEXT_CARDS = new Set(['title', 'list', 'number', 'compare', 'chart', 'end'])
  const VF_VIDEO_SHOT_MAX_SEC = 10
  const VF_VIDEO_SHOT_MIN_SEC = 2
  let _capHits = 0
  const shotsOut: any[] = []
  for (const s of arr) {
    const ty = String(s?.type || '')
    const sub = cleanText(s?.subtitle, 300)
    const big = cleanText(s?.text, 14)
    if (ty === 'video' && clips.length) {
      const ci = parseInt(s?.vclip) - 1
      const i0 = ci >= 0 && ci < clips.length ? ci : 0
      const c = clips[i0]
      const real = Number(c?.dur || 0)
      const want = clampNum(s?.dur, VF_VIDEO_SHOT_MIN_SEC, VF_VIDEO_SHOT_MAX_SEC, 5)
      // ★VF_VIDFIT_V1（2026-09-24 用户实拍「有 3 分钟的视频」）：这一镜**最终**多长，取决于
      //   【配音真实时长】（tts 回填）≈ 字幕字数 ÷ 4.5 —— 而不是 AI 写的 dur。
      //   旧写法只看 dur：AI 把 vstart 定在片尾附近、字幕又写长了 → 片段不够用 →
      //   渲染层只能放慢/循环（观感立刻变差，这正是"片段没法完整播完"的来源）。
      //   现在按"预期配音时长"反推起点上限：需要多长就往前让多少，从源头避免贴尾切。
      const expect = Math.round((sub.length / 4.5) * 10) / 10
      const needLen = Math.min(VF_VIDEO_SHOT_MAX_SEC, Math.max(want, expect))
      // ★VF_SHOTCAP_V1：这一镜的"想要长度"（AI 写的 dur 或文案应付的时长）超上限 → 记一笔
      if (Math.max(Number(s?.dur || 0), expect) > VF_VIDEO_SHOT_MAX_SEC) _capHits++
      const start = clampNum(s?.vstart, 0, Math.max(0, real - needLen), 0)
      // 片段不够长 → 用"这段能给的"为准（渲染层还有放慢/循环兜底）；太长就按 needLen 截
      const maxLen = real > 1 ? Math.max(1.5, real - start) : needLen
      const len = real > 1 ? Math.min(needLen, maxLen) : needLen
      // src_dur = 片段自身总长（渲染层用它判断"要不要放慢/循环兜底"）；vstart = 从第几秒开始
      // _ci = 用的是第几个视频（下面按需下载/降级用，写完就删）
      shotsOut.push({
        // ★VF_AI_PICK_V1：AI 自选的 theme/variant/motion/transition **必须显式带上** ——
        //   这里是"显式造对象"（不是 {...s}），漏了字段就等于把 AI 的选择悄悄丢掉了。
        ...pickDesignFields(s),
        type: 'video', src: c?.path || '', _ci: i0, src_dur: Math.round(real * 100) / 100,
        vstart: Math.round(start * 100) / 100, dur: Math.round(len * 100) / 100, text: big, subtitle: sub,
      })
    } else if (TEXT_CARDS.has(ty)) {
      // ★VF_TEXTCARD_V1（2026-09-29 用户实测「没单独生成页面 都是图片加打字」）：
      //   老逻辑：只要不是 video 就一律变成 bgimage（硬配一张图）→ AI 排的文字卡全被吃掉，
      //   整条片永远是"图 + 白字"（实测 12/12 镜都是素材镜）。
      //   现在：AI 明确要的文字卡就照做，各卡自己的字段（list 的 items、compare 的左右、number 的值）
      //   原样带过去 —— 渲染层早就支持这些卡型，且 anti-ai 会兜住"文案里没数字的数字卡"。
      const o: any = { ...s, type: ty, subtitle: sub, dur: clampNum(s?.dur, 2, 8, 4) }
      if (ty === 'title') o.text = big
      else delete o.text
      shotsOut.push(o)
    } else if (imgPaths.length) {
      const i = parseInt(s?.pick) - 1
      const pickIdx = i >= 0 && i < imgPaths.length ? i : (shotsOut.length % imgPaths.length)
      // ★VF_POOL_V1：显式记下"用第几张图"（_pick），供下面"同一素材不重复"的兜底去重改写（写完就删）
      shotsOut.push({ ...pickDesignFields(s), type: 'bgimage', _pick: pickIdx, src: imgPaths[pickIdx], text: big, subtitle: sub, dur: clampNum(s?.dur, 2, 8, 5) })
    } else {
      shotsOut.push({ type: 'title', text: big || sub.slice(0, 8), subtitle: sub, dur: 4 })
    }
  }

  // ── 5.45) ★VF_POOL_V1（2026-09-30）：同一素材不重复（归一化阶段的**服务端兜底**）
  //   用户实测：「AI 选择重复图一张」「连着两镜看着一样」。提示词里已写硬规矩（⑩），
  //   但 AI 不一定每次都听 → 这里再兜一层：重复的镜换成【还没用到的】素材；
  //   素材不够（素材数 < 镜头数）才允许重复，但保证同一素材间隔 ≥ 2 镜；实在没得换就保留原样 + 日志。
  //   图片、视频两条通道各自去重（图不跨到视频，反之亦然）。
  {
    const _imgIdx = shotsOut.map((s: any) => (s.type === 'bgimage' && typeof s._pick === 'number') ? s._pick : null)
    const _d1 = dedupeMaterialUse(_imgIdx, imgPaths.length, 2)
    for (let k = 0; k < shotsOut.length; k++) {
      const s: any = shotsOut[k]
      if (s.type !== 'bgimage' || typeof s._pick !== 'number') continue
      const ni = _d1.ids[k]
      if (ni >= 0 && ni !== s._pick && imgPaths[ni]) { s._pick = ni; s.src = imgPaths[ni] }
    }
    const _vidIdx = shotsOut.map((s: any) => (s.type === 'video' && typeof s._ci === 'number') ? s._ci : null)
    const _d2 = dedupeMaterialUse(_vidIdx, clips.length, 2)
    for (let k = 0; k < shotsOut.length; k++) {
      const s: any = shotsOut[k]
      if (s.type !== 'video' || typeof s._ci !== 'number') continue
      const ni = _d2.ids[k]
      if (ni >= 0 && ni !== s._ci && clips[ni]) {
        s._ci = ni
        s.src_dur = Math.round(Number(clips[ni]?.dur || 0) * 100) / 100
        s.vstart = clampNum(s.vstart, 0, Math.max(0, Number(clips[ni]?.dur || 0) - Number(s.dur || 5)), 0)
      }
    }
    for (const _n of _d1.notes) ctx.log(uid, '[VF-V]' + _n)
    for (const _n of _d2.notes) ctx.log(uid, '[VF-V]' + _n)
  }

  // ── 5.5) ★VF_VIDONDEMAND_V1（2026-09-24）：只下载【真的排进分镜】的视频。
  //   长视频动辄几百 MB，V1 是"用不用得着都先把 8 条全下下来"→ 起草卡在请求里（还可能超时）。
  //   现在：探测/抽帧走 OSS 直链（零下载），等 AI 排完分镜，只下它真正用到的那几条。
  // ── 5.4) ★VF_ADJGUARD_V1（2026-09-28 与本轮"每镜硬上限"一起做）：
  //   提示词里要求"相邻两镜不要用同一个视频"，但 AI 偶尔违反 → 连着两镜同一个片段，
  //   观感就是"卡住了/重复了"。这里做硬护栏：违反就把第二镜换成【另一个视频】，
  //   没有别的视频可用就降级为图片镜（有图时）。
  let _adjFixed = 0
  for (let k = 1; k < shotsOut.length; k++) {
    const a: any = shotsOut[k - 1]
    const b: any = shotsOut[k]
    if (a?.type !== 'video' || b?.type !== 'video') continue
    if (Number(a._ci) !== Number(b._ci)) continue
    const alt = clips.findIndex((_c: any, i: number) => i !== Number(b._ci))
    if (alt >= 0) {
      b._ci = alt
      b.src_dur = Math.round(Number(clips[alt]?.dur || 0) * 100) / 100
      b.vstart = clampNum(b.vstart, 0, Math.max(0, Number(clips[alt]?.dur || 0) - Number(b.dur || 5)), 0)
      _adjFixed++
    } else if (imgPaths.length) {
      b.type = 'bgimage'
      b.src = imgPaths[k % imgPaths.length]
      delete b.vstart
      delete b.src_dur
      _adjFixed++
    }
  }
  if (_adjFixed) ctx.log(uid, `[VF-V] 相邻两镜撞同一个视频 → 已调整 ${_adjFixed} 处（换视频/降级为图）`)
  if (_capHits) ctx.log(uid, `[VF-V] ${_capHits} 个视频镜超出每镜上限 ${VF_VIDEO_SHOT_MAX_SEC}s → 已夹到上限（渲染层可放慢/循环兜底）`)

  // ★VF_POOL_V1（2026-09-30）：记下本份分镜**实际用到**的素材名 —— 供"最近用过降权"，
  //   下次起草把它们排到后面（治「每次都是同几张」）。必须在下面删掉 _pick/_ci 之前统计。
  const usedNames: string[] = []
  for (const s of shotsOut as any[]) {
    if (s.type === 'bgimage' && typeof s._pick === 'number' && imgLocal[s._pick]) usedNames.push(String(imgLocal[s._pick].name))
    else if (s.type === 'video' && typeof s._ci === 'number' && clips[s._ci]) usedNames.push(String(clips[s._ci].name))
  }

  const usedCi = [...new Set(shotsOut.filter((s: any) => s.type === 'video').map((s: any) => Number(s._ci)))]
    .filter((n) => Number.isFinite(n) && n >= 0 && n < clips.length)
  if (usedCi.length) {
    const need = usedCi.map((n) => clips[n]).filter((c: any) => c?.key)
    ctx.log(uid, `[VF-V] 按需下载视频 ${need.length} 个：` +
      need.map((c: any) => `${c.name}(${c.sizeMB}MB)`).join('、'))
    let local: any[] = []
    try {
      local = await ctx.downloadMaterials(uid, need.map((c: any) => ({
        name: c.name, key: c.key, kind: 'video', size: c.size, updatedAt: 0,
      })))
    } catch (e: any) { ctx.log(uid, '[VF-V] 视频下载异常: ' + String(e?.message || e).slice(0, 120)) }
    const byName = new Map<string, string>()
    for (const m of local) if (m?.localPath) byName.set(String(m.name), String(m.localPath))
    for (const s of shotsOut) {
      if (s.type !== 'video') continue
      const lp = byName.get(String(clips[Number(s._ci)]?.name || ''))
      if (lp) s.src = lp
    }
  }
  // 下载失败 / 素材已被删 → 这一镜降级成图片镜或大字卡：宁可换个画面，
  // 也不要让渲染层拿到空 src（那会是"输入文件不存在"→ 整片失败）。
  for (let k = 0; k < shotsOut.length; k++) {
    const s: any = shotsOut[k]
    if (s.type === 'video' && !s.src) {
      ctx.log(uid, `[VF-V] 第 ${k + 1} 镜的视频没拿到本地文件 → 降级为${imgPaths.length ? '图片' : '大字'}镜`)
      if (imgPaths.length) {
        s.type = 'bgimage'
        s.src = imgPaths[k % imgPaths.length]
      } else {
        s.type = 'title'
      }
      delete s.vstart
      delete s.src_dur
    }
    delete s._ci
    delete s._pick   // ★VF_POOL_V1：临时字段（只在去重/统计时用），别带进草稿
  }

  // ── 6) 覆盖检查（与素材线同口径）：不足就按文案顺序补上"空/过短"的镜 ──
  let subLen = shotsOut.reduce((a: number, s: any) => a + String(s.subtitle || '').length, 0)
  let cover = script.length ? subLen / script.length : 0
  if (shotsOut.length >= 2 && cover < 0.85) {
    const segs = ctx.splitScript(script, shotsOut.length)
    let sum = 0
    for (let i = 0; i < shotsOut.length; i++) {
      const cur = String(shotsOut[i].subtitle || '')
      const seg = String(segs[i] || '')
      if (seg.length > cur.length) shotsOut[i].subtitle = seg.slice(0, 300)   // 只增不减
      sum += String(shotsOut[i].subtitle || '').length
    }
    subLen = sum
    cover = script.length ? subLen / script.length : cover
    ctx.log(uid, `[VF-V] 字幕覆盖不足 → 按文案顺序补齐 → ${Math.round(cover * 100)}%`)
  }
  // ── 6.5) ★VF_SUBSPLIT_V1（2026-09-30）：单镜字幕上限 → 超长【按句拆镜】（不许截断/丢文案）
  //   用户实测原话：「90 秒的样子 AI 把字幕都放在一起……90 秒的片子字幕好像溢出了。」
  //   留档实测：10 镜 / 计划 49 秒 → 成片 121.68 秒，**第 10 镜 subtitle 257 字**（其余 25~42 字）。
  //   上层闸门（覆盖 ≥80%）按总字数算 → 257 字都在 → 100% 通过、拦不住 → 这里做服务端硬兜底。
  //   位置刻意放在【覆盖检查之后、算 vd.cover 之前】：拆完再算覆盖（拆镜不改总字数，覆盖不变，
  //   但顺序上必须早于"≥80% 才给出片"的闸门，免得"拆了反而被拒"）。
  {
    const _sp = splitLongSubtitles(shotsOut)
    if (_sp.notes.length) {
      shotsOut.length = 0
      shotsOut.push(..._sp.shots)
      for (const _n of _sp.notes) ctx.log(uid, '[分镜] ' + _n)
      subLen = shotsOut.reduce((a: number, s: any) => a + String(s.subtitle || '').length, 0)
      cover = script.length ? subLen / script.length : cover
    }
  }
  // ── ★VF_SHOTFIX_V1（2026-09-30 用户实测「最后一个画面表现有点不对」）──
  //   ① 相邻两镜同卡型同内容（list items 完全相同 / bgimage 同 text 同 src / title 同 text）→ 合并成一镜；
  //   ② list 卡时长下限 = 条数 × 0.5 + 1 秒（不够自动加时，并尽量从同片最长的镜扣回）。
  //   位置：紧跟 ★VF_SUBSPLIT_V1 之后（拆镜完再合并/加时，不改字幕总字数 → 覆盖不变）。
  {
    const _mg = mergeAdjacentSameShots(shotsOut)
    if (_mg.notes.length) {
      shotsOut.length = 0
      shotsOut.push(..._mg.shots)
      for (const _n of _mg.notes) ctx.log(uid, _n)
    }
    const _lf = ensureListDuration(shotsOut)
    if (_lf.notes.length) {
      shotsOut.length = 0
      shotsOut.push(..._lf.shots)
      for (const _n of _lf.notes) ctx.log(uid, _n)
    }
  }
  const estSec = Math.round(subLen / 4.5)

  // ── 7) 存草稿 + 出确认卡（复用素材线的分镜卡，客户端零改动）──
  vd.script = script
  vd.brief = brief
  // ★VF_ANTIAI_V1（2026-09-29）：「反 AI 味」服务端兜底（提示词写了规矩，但 AI 不一定每次都遵守）：
  //   ① 清 emoji/符号当图标 ② 对比卡限字数（左右 ≤8、说明 ≤14）③ 数字/图表卡若文案里没数字 → 降级
  //   原则：只减不增 —— 宁可不花哨，也不要"一眼 AI"。处理明细写进日志，便于回溯 AI 到底写了什么。
  {
    const _anti = sanitizeAntiAiShots(shotsOut)
    shotsOut.length = 0
    shotsOut.push(..._anti.shots)
    if (_anti.notes.length) ctx.log(uid, '[VF-V][反AI味] ' + _anti.notes.join('；'))
    // ★VF_THEMELOCK_V1（2026-09-30 用户定案「1 确定同意」）：**主题由用户定死，AI 不许改**。
    //   事故：用户选了浅色主题（文字近黑）→ 压在深色素材上"基本看不见"；而 AI 还能在镜里写 theme。
    //   现在：用户选了 → 删掉 AI 写的所有 theme（用户选的说了算）；用户没选 → 保持允许 AI 自选。
    const _tl = lockUserTheme(shotsOut, vd.theme)
    if (_tl.notes.length) ctx.log(uid, '[VF-V][主题] ' + _tl.notes.join('；'))
    // ★VF_MOTIONPPT_WIRE_V1（2026-09-30）：长镜纯文字卡的"持续型动效"服务端兜底 ——
    //   刻意放在 sanitizeAntiAiShots **之后**：number/chart 因无据被降级成 title 后，
    //   那个"新 title"同样要能被兜到（否则它就是一个静态 6 秒的空屏卡）。
    const _mo = ensurePersistentMotion(shotsOut)
    if (_mo.notes.length) ctx.log(uid, '[VF-V][动效] ' + _mo.notes.join('；'))
    shotsOut.length = 0
    shotsOut.push(..._mo.shots)
    // ★VF_NEIGHBOR_DEDUP_V1（2026-10-01 用户实测「智能营销封面×2 / 智能营销方案×2 / 效率提升×2」）：
    //   相邻两镜画面大字完全相同 → 只改**后一镜**（换 kicker/label 或 subtitle 首句；改不出就保留）。
    //   刻意放在这一批的**最后**（前面的净化/降级/动效都改完了，这里看到的是最终文案）——
    //   纯函数、不联网、不改字幕一个字。
    const _dd = dedupeAdjacentSameText(shotsOut)
    if (_dd.notes.length) ctx.log(uid, '[VF-V][大字] ' + _dd.notes.join('；'))
    shotsOut.length = 0
    shotsOut.push(..._dd.shots)
  }
  vd.shots = shotsOut
  // ★VF_VIDI2V_V1：把"本地路径 → 仓库 key"的映射存进草稿 —— 出片（确认那一步）时用它现算 i2vShots
  vd.i2vKeys = i2vKeyByPath
  // ★VF_I2VSUIT_V1：把"本地路径 → 识别摘要"也存进草稿 —— 出片时按**同一份摘要**再算一次计划，
  //   保证确认卡上的"含让 N 张图动起来：约 M 点"与实扣**逐字一致**（报价 = 实扣）。
  vd.i2vSuit = i2vSuitByPath
  vd.size = size
  vd.aspectResolved = aspect
  vd.cover = cover
  vd.subLen = subLen
  // ★VF_I2VDFLT_V1：把"本次用了几张图"也存草稿 —— 分镜卡「🚫 关掉动图重出」重出卡时要用它显示"看完 N 张图"
  vd.imgN = imgPaths.length
  vd.step = 'script'
  VF_VIDEO_DRAFT.set(uid, vd)
  await saveVfVideoDraft(ctx.prisma, uid, vd)
  // ★VF_POOL_V1：把本份分镜用到的素材记进"最近用过"（最多留 2 轮）—— 下次起草降权（不排除）
  if (usedNames.length) {
    await saveRecentUsedRuns(ctx.prisma, uid, mergeRecentRuns(recentRuns, usedNames, 2))
    ctx.log(uid, `[VF-V][素材池] 已记"最近用过" ${[...new Set(usedNames)].length} 条（下次起草排到后面）`)
  }
  const nV = shotsOut.filter((s) => s.type === 'video').length
  ctx.log(uid, `[VF-V] 分镜 ${shotsOut.length} 镜（视频 ${nV} 镜 / 图片 ${shotsOut.length - nV} 镜）覆盖 ${Math.round(cover * 100)}%`)
  // ★VF_VIDI2V_V1：这次要让哪几张图动起来（开关关掉 → 空；费用如实报在确认卡上）
  const _i2vB = i2vBuildOf(vd)
  logI2vNotes(ctx, _i2vB.notes)
  return ctx.vfScriptCard(
    // i2vSec / i2vImages 只给【本线】用：分镜卡据此把"让图动起来"的钱**如实显示**（不许藏成本）
    // ★VF_I2VDFLT_V1：把"被智能筛跳过的图"一起透到卡片（hint 一句 + 结构化 i2vSkipped）
    { ...vd, voiceList: ctx.voiceList, source: '', i2vSec: _i2vB.plan.sec, i2vImages: _i2vB.plan.images,
      i2vSkipped: _i2vB.plan.unfitSamples, i2vSkippedN: _i2vB.plan.skippedUnfit },
    shotsOut, imgPaths.length, brief, aspect, cover, estSec,
  )
}

/* ==================== ⑥ 主流程 ==================== */

export async function handleVideoLine(ctx: VfVideoCtx): Promise<string> {
  const { uid, userMessage } = ctx
  try {
    let vd = await loadVfVideoDraft(ctx.prisma, uid)

    // ── 入口：起一条干净草稿 → 出设置卡 ──
    if (!vd?.step) {
      const topic = String(userMessage).replace(ENTRY_STRIP, '').replace(/^[\s:：,，,。、]+/, '').trim().slice(0, 300)
      vd = {
        step: 'form', topic, aspect: 'auto', dur: 30,
        voice: (ctx.voiceList && ctx.voiceList[0] && ctx.voiceList[0].id) || 'longxiaochun',
        theme: 'dark', bgm: '', uploaded: [], script: '', brief: '', keepAudio: false,
        // ★VF_MATUI_V1（2026-09-30 用户定案「能不加 AI 做视频就不加」）：**默认 = 'off'（不动）**。
        //   四档全部保留，用户想动随时在设置卡切：off（默认）/ picked（只动勾选）/ on（智能筛）/ all（全部）。
        i2v: 'off',
        pin: 'on',   // ★VF_BANNER_V1：默认出「顶部固定标题」（老板定案「默认开，方便自动化」；设置卡可关）
        pin1: '', pin2: '',   // ★VF_BANNER_PIN2_V1：默认留空 = AI 自动拟两行（用户在设置卡手填则以他为准）
        // ★VF_DECK_STYLES_V1（2026-10-01）：「🎨 画面模版」默认 'auto' = AI 按题材自选（用户不选就与现状一致）
        deckStyle: 'auto',
        // ★VF_STYLES_WIRE_V1（2026-10-01）：「🎨 画面风格」默认 ''（不指定）→ 不写 plan 根级 style
        style: '',
      }
      VF_VIDEO_DRAFT.set(uid, vd)
      await saveVfVideoDraft(ctx.prisma, uid, vd)
      ctx.log(uid, `[VF-V] 入口 → 出设置卡（主题="${topic.slice(0, 20)}"）`)
      return formCard({ ...vd, voiceList: ctx.voiceList } as any)
    }

    // ── 卡1：设置卡提交 → 起草 ──
    if (vd.step === 'form') {
      const f = ctx.parseForm(userMessage)
      if (f) {
        // ★VF_ENGINE_UI_V1（2026-10-04 用户定案「成片方式第一轮就选」）：classic=老引擎（默认）/ deck=新引擎动态 PPT
        if (f.engine !== undefined) vd.engine = String(f.engine) === 'deck' ? 'deck' : 'classic'
        if (f.aspect) vd.aspect = String(f.aspect)
        if (f.dur) vd.dur = Math.max(5, Math.min(900, parseInt(f.dur) || 30))
        if (f.voice) vd.voice = String(f.voice)
        if (f.theme) vd.theme = String(f.theme)
        if (f.bgm) vd.bgm = String(f.bgm)
        // ★VF_DECK_STYLES_V1（2026-10-01）：画面模版（'auto' | 6 个 deck 风格）—— 走白名单归一化（非法 → 'auto'）
        if (f.deckStyle !== undefined) vd.deckStyle = normalizeDeckStyle(f.deckStyle)
        // ★VF_STYLES_WIRE_V1（2026-10-01）：「🎨 画面风格」（5 套成品风格）—— 走白名单归一化
        //   （非法 / 未选 → '' = 不指定；出片时据此决定是否写 plan 根级 `style`）。
        if (f.style !== undefined) vd.style = normalizeStyle(f.style)
      if (f.big) vd.big = String(f.big)   // ★OVERLAY_TEXT_SWITCH_V1：'on' | 'off'
        // ★VF_VIDI2V_V1：'off'（全静态图，不额外计费）| 'on'（智能筛，只动有主体可动的图）
        // ★VF_MATUI_V1（2026-09-30 用户定案）：新增 'picked'（只动我勾选的🎞）；缺省 = 'off'
        // ★VF_I2VSUIT_V1（2026-09-30）：'all' / 'picked' = 不按素材类型筛选（用户手动点名了）
        if (f.i2v) {
          const _i2vV = String(f.i2v)
          vd.i2v = (_i2vV === 'off' || _i2vV === 'picked' || _i2vV === 'all') ? _i2vV : 'on'
        }
        // ★VF_BANNER_V1：'on'（默认，AI 自动拟两行固定标题）| 'off'（不要）
        if (f.pin) vd.pin = String(f.pin) === 'off' ? 'off' : 'on'
        // ★VF_BANNER_PIN2_V1（2026-09-29）：手填的第 1/2 行（留空 = AI 自动拟）——
        //   原样存草稿，起草时交给 buildBanner 决定"用手填还是调 AI"（清洗/截断都在 buildBanner 里）。
        if (f.pin1 !== undefined) vd.pin1 = String(f.pin1 || '').slice(0, 60)
        if (f.pin2 !== undefined) vd.pin2 = String(f.pin2 || '').slice(0, 80)
        if (Array.isArray(f.uploaded)) vd.uploaded = f.uploaded.map((x: any) => String(x))
        if (typeof f.script === 'string' && f.script.trim()) vd.script = cleanText(f.script)
        if (typeof f.topic === 'string' && f.topic.trim()) vd.topic = String(f.topic).trim().slice(0, 300)
        VF_VIDEO_DRAFT.set(uid, vd)
        await saveVfVideoDraft(ctx.prisma, uid, vd)
        ctx.log(uid, `[VF-V] 设置卡提交：${vd.dur}s / ${vd.aspect} / 音色 ${vd.voice}`)
        return await draftAndCard(ctx, vd)
      }
      // 用户在卡1 直接打了主题（没点按钮）
      const t = String(userMessage).replace(ENTRY_STRIP, '').trim()
      if (t.length >= 2 && !FLOW_WORD.test(t) && !/^(竖屏|横屏|自动)$/.test(t) && !/^(VF_|MAKE_VIDEO|\{)/.test(t)) {
        vd.topic = t.slice(0, 300)
        VF_VIDEO_DRAFT.set(uid, vd)
        await saveVfVideoDraft(ctx.prisma, uid, vd)
        ctx.log(uid, `[VF-V] 对话里给主题 → 起草`)
        return await draftAndCard(ctx, vd)
      }
      return '视频混剪：请在上面选好 时长/画幅/音色，点「🚀 开始出片」；或直接说个主题。'
    }

    // ── ★VF_I2VDFLT_V1（2026-09-30 用户定案）：一键改「动图」设置 → 重出确认卡 ──
    //   来源：① 分镜卡「🚫 关掉动图重出」发的协议串 `VF_I2V_OFF:`；
    //        ② 用户直接说「关掉动图 / 保持静态 / 全部动起来 / 智能筛」。
    //   只改草稿 i2v，**不重排分镜、不扣钱**；金额随之变小/变大（用户立刻看得到）。
    //   为什么走协议串：标准模式是命令白名单锁死，中文人话会被拦（见 standard-commands.ts 的规则）。
    if (vd.step === 'script' && !!i2vIntentOf(String(userMessage)) && !!vd.shots?.length) {
      const _iv = i2vIntentOf(String(userMessage)) as 'off' | 'picked' | 'all' | 'on'
      // ★VF_MATUI_V1：'picked' 要按「🎞 打勾」名单过滤 → 先刷新草稿里的勾选名单（同一轮刚保存的也读得到）
      vd.i2vPicked = (await loadVideoMatPolicy(ctx.prisma, uid)).i2v || []
      const _before = i2vBuildOf(vd)
      vd.i2v = _iv
      VF_VIDEO_DRAFT.set(uid, vd)
      await saveVfVideoDraft(ctx.prisma, uid, vd)
      const _after = i2vBuildOf(vd)
      logI2vNotes(ctx, _after.notes)   // 改后重新报一遍"动几张 / 为什么没动"
      const _label = _iv === 'off' ? '保持静态' : _iv === 'picked' ? '只动我勾选的'
        : (_iv === 'all' ? '全部动起来' : '智能筛')
      const _delta = _before.points - _after.points
      ctx.log(uid, `[图生视频] 用户一键${_iv === 'off' ? '关掉' : '改设置'} → 「${_label}」` +
        `${_iv === 'off' ? '，本片不再生成动图' : ''}（${_before.points} 点 → ${_after.points} 点` +
        `${_delta > 0 ? `，省 ${_delta} 点` : _delta < 0 ? `，加 ${-_delta} 点` : ''}）`)
      return ctx.vfScriptCard(
        { ...vd, voiceList: ctx.voiceList, source: '', i2vSec: _after.plan.sec, i2vImages: _after.plan.images,
          i2vSkipped: _after.plan.unfitSamples, i2vSkippedN: _after.plan.skippedUnfit,
          i2vNotPicked: _after.plan.notPickedNames, i2vNotPickedN: _after.plan.skippedNotPicked },
        vd.shots || [], Number(vd.imgN) || 0, String(vd.brief || ''), vd.aspectResolved || 'portrait',
        Number(vd.cover) || 1, Math.round((Number(vd.subLen) || 0) / 4.5))
    }

    // ── ★VF_MEMORY_V1（2026-09-30 用户定案「个人仓库怎么分配 AI 仓库主要看哪里的」）──
    //   素材识别结果里每条素材的「✅ 当素材用 / 🚫 别用」发的协议串：
    //     VF_MAT_SET:{"name":"<文件名>","action":"allow"|"deny"|"auto"|"pick"|"unpick"}
    //   只改【名单】+ 重出确认卡（**不重排分镜、不扣钱**；下次起草时名单即生效）。
    //   ★VF_MATUI_V1：动作新增 pick/unpick（🎞 打勾/取消打勾）。
    const _ms = parseMatSetMessage(String(userMessage))
    if (vd.step === 'script' && _ms) {
      await saveVideoMatPolicy(ctx.prisma, uid, _ms.name, _ms.action)
      // ★VF_MATUI_V1：名单变了 → 勾选名单/清单/两个总数全部刷新（否则重出的卡片还是旧状态）
      vd.i2vPicked = (await loadVideoMatPolicy(ctx.prisma, uid)).i2v || []
      if (ctx.matUI) {
        try {
          const _mu = await ctx.matUI(uid)
          vd.mats = _mu.items; vd.matUsableN = _mu.usableN; vd.matExcludedN = _mu.excludedN
        } catch { /* ignore */ }
      }
      VF_VIDEO_DRAFT.set(uid, vd)
      await saveVfVideoDraft(ctx.prisma, uid, vd)
      const _label = _ms.action === 'allow' ? '可用' : _ms.action === 'deny' ? '不用'
        : _ms.action === 'pick' ? '动效' : _ms.action === 'unpick' ? '不动效' : '自动'
      ctx.log(uid, `[素材池] 用户把 ${_ms.name} 设为「${_label}」`)
      const _afterMat = i2vBuildOf(vd)
      return ctx.vfScriptCard(
        { ...vd, voiceList: ctx.voiceList, source: '', i2vSec: _afterMat.plan.sec, i2vImages: _afterMat.plan.images,
          i2vSkipped: _afterMat.plan.unfitSamples, i2vSkippedN: _afterMat.plan.skippedUnfit,
          i2vNotPicked: _afterMat.plan.notPickedNames, i2vNotPickedN: _afterMat.plan.skippedNotPicked },
        vd.shots || [], Number(vd.imgN) || 0, String(vd.brief || ''), vd.aspectResolved || 'portrait',
        Number(vd.cover) || 1, Math.round((Number(vd.subLen) || 0) / 4.5))
    }

    // ── ★VF_MATUI_V1（2026-09-30 用户定案「选中的图片是否可以做个小预览，点击可以替换一个」）──
    //   清单「🔄 换一张」发的协议串 `VF_MAT_SWAP:{"out":"<被换掉的文件名>"}`。
    //   服务端算"同类型的下一张"（pickSwapTarget）→ out 记 deny、in 记 allow（🎞 勾选转移）→ 重出确认卡。
    {
      const _sw = parseMatSwapMessage(String(userMessage))
      if (vd.step === 'script' && _sw) {
        const _pol = await loadVideoMatPolicy(ctx.prisma, uid)
        const _cands = await ctx.listRepoMaterials(uid, 60, 'spread', {})
        // ★只在【可用素材】里换（"已排除"里的东西本来就不该用）：复用与清单同一份分组/上限逻辑
        const _usable = buildMatUIList(
          (_cands || []).map((c: any) => ({ name: String(c?.name || ''), kind: String(c?.kind || '') })),
          { allow: _pol.allow, deny: _pol.deny, i2v: _pol.i2v, limit: VF_MAT_UI_LIMIT },
        ).usable
        const _target = pickSwapTarget(_usable as any[], _sw.out, { deny: _pol.deny })
        if (!_target) {
          ctx.log(uid, `[素材池] 换一张：仓库里没有别的同类素材可换了（${_sw.out}）`)
          return `仓库里没有别的同类素材可以换「${_sw.out}」（同类只剩这一张）。\n` +
            `你可以先「📤 我上传素材」多传几张，或直接在清单里点「✅ 当素材用」把别的图提拔进来。`
        }
        await saveVideoMatPolicyContent(ctx.prisma, uid, applyMatSwap(_pol, _sw.out, String((_target as any).name || '')))
        vd.i2vPicked = (await loadVideoMatPolicy(ctx.prisma, uid)).i2v || []
        if (ctx.matUI) {
          try {
            const _mu = await ctx.matUI(uid)
            vd.mats = _mu.items; vd.matUsableN = _mu.usableN; vd.matExcludedN = _mu.excludedN
          } catch { /* ignore */ }
        }
        VF_VIDEO_DRAFT.set(uid, vd)
        await saveVfVideoDraft(ctx.prisma, uid, vd)
        ctx.log(uid, `[素材池] 用户「换一张」：${_sw.out} → ${String((_target as any).name || '')}（旧图记「别用」、新图记「当素材用」）`)
        const _afterSw = i2vBuildOf(vd)
        return ctx.vfScriptCard(
          { ...vd, voiceList: ctx.voiceList, source: '', i2vSec: _afterSw.plan.sec, i2vImages: _afterSw.plan.images,
            i2vSkipped: _afterSw.plan.unfitSamples, i2vSkippedN: _afterSw.plan.skippedUnfit,
            i2vNotPicked: _afterSw.plan.notPickedNames, i2vNotPickedN: _afterSw.plan.skippedNotPicked },
          vd.shots || [], Number(vd.imgN) || 0, String(vd.brief || ''), vd.aspectResolved || 'portrait',
          Number(vd.cover) || 1, Math.round((Number(vd.subLen) || 0) / 4.5))
      }
    }

    // ── 卡2b：★VF_PREVIEW_V1（2026-09-29 用户定案 P0①「样板镜先确认」）──
    //   用户点「🎬 先看样板镜」→ 只渲染开头约 8 秒（不配音、不扣点）看风格；
    //   满意再点「确认出片」。治的是规划文档 4.2 #5「用户看到成品才发现风格不对」。
    if (vd.step === 'script' && /样板镜|先看预览|先出预览|预览一下|看看样板/.test(String(userMessage).trim())) {
      if (!vd.shots?.length) return '视频混剪：分镜还没排好，先不出预览。回「重试」我再排一次。'
      ctx.log(uid, `[VF-V] 样板镜预览：取开头约 8 秒（共 ${vd.shots.length} 镜）`)
      return String(await ctx.executeToolCall('preview_video_shot', {
        // ★VF_BANNER_V1：样板镜也带上固定标题（用户就是要在预览里看到那两行长什么样）
        // ★VF_SBDUMP_V2：与出片/留档共用 buildVideoPlan（同一份字段，别再三处各拼一份）
        plan: JSON.stringify(buildVideoPlan(vd.shots, vd, { sizeDefault: [720, 1280] })),
        seconds: 8,
      }, ctx.auth))
    }

    // ── 卡2：确认 → 出片（入队即作废本线草稿，避免终身吞消息）──
    if (vd.step === 'script' && FLOW_WORD.test(String(userMessage).trim())) {
      if (!vd.shots?.length) return '视频混剪：分镜还没排好，先不出片。回「重试」我再排一次。'
      // ★VF_VIDI2V_V1（2026-09-29 用户定案「图视混剪 → 逐镜图生视频」）：
      //   ① i2vShots 的 image 传的是【个人仓库 key】——由 chat/route.ts 的 resolveImageToPublicUrl()
      //      现签 OSS 直链（供应商必须能从公网拉到第一帧；它拿不到 cookie、也读不到服务器本地路径）。
      //   ② 必须**同时声明** source='mix' + mix=镜号：这是 chat/route.ts 的护栏要求（不声明直接
      //      TOOL_REJECT —— 不许绕过），也顺带让计费走"只算这几镜的秒数"的混合口径，
      //      与确认卡上那句"含让 N 张图动起来"同源（报价 = 实扣）。
      //   ③ 关掉开关（i2v='off'）→ 一个字段都不传，走纯素材合成。
      // ★VF_I2V_REUSE_V1：入参全部由通用函数给（同图去重 / 上限 6 张 / 开关 / 计费 / 声明 source+mix）
      const _i2vB = i2vBuildOf(vd)
      logI2vNotes(ctx, _i2vB.notes)   // 动了几张 / 为什么没动 / 哪些拿不到公网地址（通用话术，原样写日志）
      // ★VF_BANNER_V1：顶部固定标题 —— 开关开且草稿里有提炼结果才带上；**根级**字段（绝不在 shots 里）
      const _bannerF = bannerFieldOf(vd)
      if (_bannerF.banner) ctx.log(uid, `[VF-V] 固定标题：${_bannerF.banner.line1} / ${_bannerF.banner.line2}（钉全片）`)
      VF_VIDEO_DRAFT.delete(uid)
      await clearVfVideoDraft(ctx.prisma, uid)
      ctx.log(uid, '[VF-V] 已入队 → 本线草稿作废')
      const run = await ctx.executeToolCall('make_ai_video', {
        // ★OVERLAY_TEXT_SWITCH_V1（2026-09-29）：把"画面大字开关"写进分镜 plan ——
        //   render.py 读到 overlay_text=false 就不再把这些大字压在素材/视频上（独立文字卡与字幕照旧）。
        // ★VF_BANNER_V1：把固定标题挂到 plan 的**根级**（planWithBanner 保证不塞进 shots——
        //   render.py 只读根级 sb.get('banner')，塞进 shots 每一镜就会每帧重画）。
        // ★VF_SBDUMP_V2（2026-10-01）：出片 plan 与"本地留档的 plan"、样板镜 preview **共用同一个函数**
        //   （buildVideoPlan：size/fps/shots/overlay_text/deck_style + banner），杜绝"留档 ≠ 出片"。
        plan: JSON.stringify(buildVideoPlan(vd.shots, vd, { sizeDefault: [720, 1280] })),
        script: vd.script,
        theme: vd.theme,
        speaker: vd.voice,
        bgm: vd.bgm,
        duration: vd.dur,
        confirmed: true,
        // ★VF_VIDI2V_V1：{ i2vShots, source:'mix', mix } 由通用函数拼好（没有可动的图时是空对象）
        ..._i2vB.args,
      }, ctx.auth)
      ctx.log(uid, `[VF-V] 出片入队 → ${String(run).slice(0, 100)}`)
      return String(run)
    }

    // ── 重排分镜 ──
    if (vd.step === 'script' && /^重试|重新排|再排一次|重排分镜/.test(String(userMessage).trim())) {
      ctx.log(uid, '[VF-V] 重排分镜')
      return await draftAndCard(ctx, vd, '上次分镜没排好：这次必须覆盖全文、排够镜头、视频镜的 subtitle 要按 4.5 字/秒 写够。')
    }

    // ── 兜底：不留白 ──
    if (vd.step === 'running') return '视频混剪已在后台生成中——完成后自动推结果（也可问「视频做得怎么样了」）。'
    return '视频混剪：回「确认」就出片；也可以说「重试」重排分镜。'
  } catch (e: any) {
    const msg = String(e?.message || e).slice(0, 200)
    try { ctx.log(uid, '[VF-V] ❌ 异常: ' + msg) } catch { /* ignore */ }
    return `视频混剪环节出错：${msg}\n（把这句发我即可定位；这次没有静默失败。）`
  }
}
