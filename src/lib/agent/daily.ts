/**
 * ★VF_DAILY_V2（2026-10-12 用户定案·第二轮）：「日报落地页」线 —— 第 9 条状态机线
 * =============================================================================
 * v1（已上线）：入口词 → 列素材 → 回序号 → 直接生成（文案是中性占位）。
 * v2 用户原话：「A+C 吧」「素材暂时是手动选取模式」「设计风格只有一个先定型」
 *            「依然 AI 开素材决定设计风格」「出一个 风格/页数/排版/文字 列表，确认后生成」。
 *
 * ⇒ **v4 流程（3 步）**：
 *   ① 选素材（点按钮**直接列素材**；手动挑序号；★C 来源可选 = 个人仓库根 / `目录=子目录` / `本机=绝对路径`
 *        ★主题**可选**：`京味铜锅涮肉 1,3,5` 或 `主题=…`，不写就走中性占位）
 *   ② 方案确认（AI **看素材** → 出「风格 · 段数 · 每段排版 · 文字」清单 → 可 `改 N …` 微调 → 回 `确认`）
 *   ③ 生成（引擎 tools/daily-page.mjs → 存个人仓库 → 下载链接 + 真图命名对照表）
 *
 *   v2→v4 为什么砍掉"先单独问主题"那一步（2026-10-12 17:58 用户实测）：
 *     点按钮后看到"请回一句主题"⇒ 他不知道要再打字、以为卡住了，连着三次都停在第 1 步
 *     （服务器日志只有 `起稿（第 1 步 主题）`、从没有主题消息）。⇒ 主题改成"跟序号一句话说"。
 *
 * ★风格口径（用户定案）：**本轮只做一个风格，先定型**（DAILY_STYLE「暖纸日报」），
 *   不做风格选择；但**段数 / 每段版式 / 文案 / 动效档仍由 AI 看素材决定**（AI 编排）。
 *   AI 一旦失败/输出不合规 ⇒ 回落 `buildDailyPlan()` 的确定性保底版式，并在回复里**如实说明**。
 *
 * ★分层：**纯函数**（AI 输出规整 / 方案组装 / 清单格式化）在 `./daily-plan.ts`（零 import、可单测）；
 *   本文件只管 **IO 与状态机**（草稿、OSS/本机素材、视觉模型调用、引擎生成）。
 *
 * ⚠️ 铁律（与其它 8 条线同款，缺一处就出事 —— route.ts 那几处注释是血泪史）：
 *   ① 命令必须登记进 `standard-commands.ts`（标准模式是白名单锁死）；
 *   ② 本线草稿必须登记进 route.ts 的 `stdHasAnyDraft`（否则第 2 步被闸门锁死）；
 *   ③ 必须登记进 `stdClearAllDrafts`（否则"命令 = 重来"对本线不成立，旧草稿会吞掉后续消息）；
 *   ④ 分派块放**最前**、只认自己的命令与自己线内的话。
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { listAllObjects } from '@/lib/oss'
// ★VF_ROOT_V1 口径（2026-10-14）：引擎路径一律走 vfRootDir()，**不要**用 process.cwd() ——
//   服务器跑的是 pm2 里的 `.next/standalone/server.js`，cwd 是 `.next/standalone`，
//   而 standalone 的 `scripts/` 只含**少数被 file tracing 拷进去的文件**（残缺）
//   ⇒ 拼 cwd 会指到那个残缺目录、报出看不出所以然的"模块找不到"。
import { vfRootDir } from './video-material'
import { saveToPersonalRepo } from '@/lib/personal-storage'
import { dashscopeFunctionCall } from '@/lib/ai-providers'
// ★纯函数层（零依赖、可单测：temp/_exp/daily/test-plan.mjs）
import { DAILY_STYLE, aiPrompt, extractJsonEx, normSegs, normMotion, normTheme, normFont, themeName, buildPlanFromSegs, buildDailyPlan, formatDailyPlan, assignTextMotion, pickFont, applyDailyEdit, buildPlanCardPayload, buildDoneCardPayload, embedImages, rotateTheme, planFromCaptions, byLabel, assignFx, planFingerprint, similarity, rerollPlan, scrimFor, applyEditBatch, layoutLabel, assignTextLayer, checkDiversity, fixDiversity, voicePrompt, voicePromptStrict, normVoiceLines, buildVoiceCardPayload, estimateSec, parseVoiceLines, VOICE_MAX_CHARS, voiceKeyOf, aiDesignPrompt } from './daily-plan'
import type { PlanBy } from './daily-plan'

export { DAILY_STYLE }

export const DAILY_TAG = 'vf_draft_daily'
export const DAILY_PREFIX = '日报落地页草稿:'
/** 入口词（与 standard-commands.ts 的 text **一字不差**；比对时去空白） */
export const DAILY_ENTRY = ['日报落地页', '日报页', '做日报页']
// ★VF_DAILY_V11（2026-10-13 用户「页数多不是问题、少反而是问题；这个是为了做视频用的」）：
//   可勾素材从 6 张放到 10 张 —— 段数按素材量走（prompt 里的下限 = 张数×1.5），素材多一点才有段数空间。
// ★VF_DAILY_V27（2026-10-16 用户定案「1.+2」：原话「素材不能规定10张这个要放开」「不要限制」）：
//   再放到 **20 张**。放开前**逐项核对过连带影响**（这不是改一个数字）：
//     · **段数**：prompt 里段数上限仍是 16，而下限 `min(16, ceil(n*1.5))` 在 n=20 时也顶到 16
//       ⇒ 20 张正好排进 16 段（12 段单图 + 4 段双图）⇒ **不用动段数上限**；
//     · **方案不截断**：`aiPlanSegments` 的 maxTokens 是 **8000**（16 段方案约 2~3k token）⇒ 有余量；
//     · **单文件版内嵌预算 24MB**：20 张中等图约 4~10MB ⇒ 有余量（超预算会**如实告知**，不静默丢图）；
//     · **出片 worker**：页面越大、每个 Chrome 吃内存越多 ⇒ 已在 `daily-film.mjs` 里改成
//       **按页面体积自动降 worker**（这正是 2026-10-14 那次 native crash 的成因，写死 2 会在图更多时重演）；
//     · **片长**：20 段约 80s（原 14 段 56s）—— 这正是用户要的"素材多、段数多"。
export const DAILY_MAX_PICK = 20
/** 首次列出的张数（免得刷屏） */
const LIST_SHOWN = 12
/** 指定来源（子目录/本机）时最多列出多少张 */
const LIST_CAP = 60
const IMG_RE = /\.(jpg|jpeg|png|gif|webp)$/i

/** 素材来源：repo = 个人仓库根 ｜ subdir = 个人仓库子目录 ｜ local = 本机绝对路径 */
export type DailySource = { kind: 'repo' | 'subdir' | 'local'; value?: string }

export interface DailyDraft {
  step: 'topic' | 'pick' | 'review' | 'done'
  /** 用户的主题（用在标题上；没有就用中性占位并如实告知） */
  topic?: string
  /** ★C：素材来源 */
  source?: DailySource
  /** 已选素材文件名（相对来源） */
  names?: string[]
  /** 待确认的分段方案（引擎配置） */
  plan?: any
  /** 方案是谁排的：ai = AI 看素材编排 ｜ fallback = 系统保底 */
  planBy?: PlanBy
  /** AI 失败原因（给人看的） */
  planNote?: string
  /** 生成好的 HTML（**配图版**）在个人仓库里的文件名 */
  htmlName?: string
  /** ★VF_DAILYFILM_V2（2026-10-14 用户定案「先做1」）：**单文件版**（图内嵌）的仓库文件名 ——
   *  出片只认它（工具要求"单文件自足"：配图版的图在同级目录、渲不了）⇒ 没有就明确报错、不猜。 */
  singleName?: string
  /** ★VF_DAILYFILM_V2：最近一次出片任务 id（前端轮询 `/api/agent/daily-film-status` 用） */
  filmTaskId?: string
  /** ★VF_DAILYVOICE_V1：最近一版**逐段口播稿**（配音稿卡上给用户改的那份；合成时以卡上回传的为准） */
  voice?: string[]
  /** ★VF_DAILY_V32（2026-10-16 用户定案「生成HTML 改成 2个 AI开关」）：**让 AI 放手排版** ——
   *  默认 AI 是保守的（只求"相邻两段别撞"）；打开后把目标提到"整份要有明显不同的视觉气质"，
   *  鼓励它混搭 版式 × 叠法 × 对齐 × 文字层 × 字号 × 动效（这些维度**引擎早就都有**，只是不敢用）。 */
  aiLayout?: boolean
  /** ★VF_DAILY_V32：**皮肤也交给 AI 挑** —— 默认服务端要求"这次必须换一个和上次不同的皮肤"
   *  （治"两份看着像同一套"的老办法）；打开后**解除那条约束**，让 AI 纯按本批素材气质挑。 */
  aiPickSkin?: boolean
  /** ★VF_DAILYVOICE_V6：这份口播对应的**画面指纹**（`voiceKeyOf(plan.segments)`）——
   *  出稿时比对：画面字没变才沿用旧稿；变了就当没有（宁可让 AI 重写，也不给错配的稿）。 */
  voiceKey?: string
}

export function newDailyDraft(): DailyDraft { return { step: 'topic' } }

/** 入口词判定（去空白后完全相等） */
export function isDailyEntry(m: string): boolean {
  return DAILY_ENTRY.indexOf(String(m || '').replace(/\s+/g, '')) >= 0
}

const DAILY_EXIT_RE = /^(取消|退出|重来|不做了|算了|清空|重置|退出日报|退出日报落地页)$/
const DAILY_SKIP_RE = /^(跳过|不用|无|没有|无主题|不写|随便|skip|none)$/i
const DAILY_YES_RE = /^(确认|确定|可以|好的|好|ok|okay|没问题|生成|开始生成|就这样|开始|对|是的)$/i
const DAILY_BACK_RE = /^(重选|重挑|换素材|改素材|重新选|返回|上一步)$/

/* ─────────────── 草稿（照 lead.ts 同款：db.agentMemory + tag 精确匹配） ─────────────── */

/* ★VF_DRAFT_LOG_V1（2026-10-19 **实测证据**：用户编辑 3 处后，DB 里仍全是旧文案：
   段1「京味铜锅鲜」/ 段7「生菜垫底·兰花点缀」/ 段14「丰盛一席」都被原样存着 ⇒
   方案卡显示"已改 3 处"（内存里是新的），**但库里是旧的** ⇒ 生成时读旧版 ⇒ 用户看到"完全没按我的做"。
   原来这里 `catch {}` **把错完全吞掉**，所以从日志里看不到任何异常。
   现口径：**失败必须打出来**（带错误信息 + content 长度 + 关键段标题），成功也打一行
   "关键段标题"——这样一眼能看出"存进去的到底是哪一版"。**只加日志，不改逻辑**。 */
export async function saveDailyDraft(db: any, uid: number | string, d: DailyDraft): Promise<void> {
  const content = DAILY_PREFIX + JSON.stringify(d)
  const segs = Array.isArray((d as any)?.plan?.segments) ? (d as any).plan.segments : []
  const key = 'seg1=' + JSON.stringify(segs[0]?.title) + ' segN=' + JSON.stringify(segs[segs.length - 1]?.title)
  try {
    /* ★VF_DRAFT_ORDER_V1（2026-10-19 排查「编辑改了、生成还是旧文案」）：
       原来按 `updatedAt desc` 取，**同一毫秒内两条记录的顺序不稳定**（SQLite 时间精度 + 并发保存可能产生多条）
       ⇒ 可能出现"`save` 更新了 A 条、`load` 读到 B 条"⇒ **生成用旧文案**（DB 实测就是这个现象）。
       现口径：**按自增 `id` 倒序**（id 是单调递增的，永远能准确指向"最后一次写入的那条"）。
       读写**同一口径**，不会再错位。 */
    const ex = await db.agentMemory.findFirst({ where: { userId: String(uid), tags: { equals: DAILY_TAG } }, orderBy: { id: 'desc' } })
    if (ex) await db.agentMemory.update({ where: { id: ex.id }, data: { content } })
    else await db.agentMemory.create({ data: { userId: String(uid), content, tags: DAILY_TAG, salience: 0.5 } })
    console.log('[日报草稿] 已保存 step=' + String((d as any)?.step) + ' 段数=' + segs.length + ' 长度=' + content.length + ' ' + key)
    /* ★VF_DRAFT_VERIFY_V1（2026-10-19 用户实测：方案卡显示 6 处已改、DB 里却是旧文案 ⇒ 生成用了旧版）：
       **保存完立刻读回来比对** —— 这是唯一能当场判定"到底存进去没有"的办法。
       不一致就打 `**读回不一致**`，把"存的"和"读的"两行都打出来 ⇒ 一眼看出是写失败、还是读错条。 */
    try {
      const back = await loadDailyDraft(db, uid)
      const bs = Array.isArray((back as any)?.plan?.segments) ? (back as any).plan.segments : []
      const a0 = JSON.stringify(segs[0]?.title || null)
      const b0 = JSON.stringify(bs[0]?.title || null)
      const aN = JSON.stringify(segs[segs.length - 1]?.title || null)
      const bN = JSON.stringify(bs[bs.length - 1]?.title || null)
      if (a0 !== b0 || aN !== bN || bs.length !== segs.length) {
        console.error('[日报草稿] **读回不一致**！存: 段数=' + segs.length + ' seg1=' + a0 + ' segN=' + aN
          + ' ｜ 读: 段数=' + bs.length + ' seg1=' + b0 + ' segN=' + bN)
      }
    } catch { /* 自校验失败不影响主流程 */ }
  } catch (e: any) {
    // ⚠️ 原来这里吞错 ⇒ 用户改了字、库里没变、日志一片安静。现在必须喊出来。
    console.error('[日报草稿] **保存失败**：' + String(e?.message || e).slice(0, 300)
      + ' ｜ step=' + String((d as any)?.step) + ' 段数=' + segs.length + ' 长度=' + content.length + ' ' + key)
  }
}

export async function loadDailyDraft(db: any, uid: number | string): Promise<DailyDraft | null> {
  try {
    // ★VF_DRAFT_ORDER_V1：与 save 同一口径（id 倒序）—— 见 saveDailyDraft 注释
    const dm = await db.agentMemory.findFirst({ where: { userId: String(uid), tags: { equals: DAILY_TAG } }, orderBy: { id: 'desc' } })
    if (!dm) { console.log('[日报草稿] 读取：**没有草稿**'); return null }
    const s = String(dm.content || '')
    const i = s.indexOf('{')
    if (i < 0) return null
    const d = JSON.parse(s.slice(i))
    /* ★VF_DRAFT_LOG_V1：读取时也打一行"关键段标题" —— 与保存那行对照，
       就能直接看出"存的哪版 / 读的哪版"，不用再翻产物。 */
    try {
      const sg = Array.isArray(d?.plan?.segments) ? d.plan.segments : []
      console.log('[日报草稿] 读取 id=' + dm.id + ' step=' + String((d as any)?.step) + ' 段数=' + sg.length
        + ' seg1=' + JSON.stringify(sg[0]?.title) + ' segN=' + JSON.stringify(sg[sg.length - 1]?.title))
    } catch { /* ignore */ }
    return d && typeof d === 'object' ? (d as DailyDraft) : null
  } catch { return null }
}

export async function clearDailyDraft(db: any, uid: number | string): Promise<void> {
  try { await db.agentMemory.deleteMany({ where: { userId: String(uid), tags: { equals: DAILY_TAG } } }) } catch { /* ignore */ }
}

export async function hasDailyDraft(db: any, uid: number | string): Promise<boolean> {
  return !!(await loadDailyDraft(db, uid))?.step
}

/* ─────────────── 素材（只取"原始图片"：排除 .thumbs / _gen / 生成物 gen_ / 视频） ─────────────── */

function cleanSeg(v?: string): string { return String(v || '').replace(/^[/\\]+|[/\\]+$/g, '') }

/**
 * 个人仓库里的图片。
 * @param subdir 只在某个子目录里找（'' = 仓库根，含子目录）
 * 返回的是**相对个人仓库根**的名字（`sub/xxx.jpg`），拼 key 时直接 `storage/{uid}/{name}`。
 */
export async function listDailyImages(uid: number | string, limit = LIST_SHOWN, subdir = ''): Promise<string[]> {
  const sub = cleanSeg(subdir)
  if (!sub) {
    // ★VF_DAILY_V5（2026-10-12 用户定案「仓库不要搞错：个人仓库对，但要进原始素材」）：
    //   仓库根**与成片线同一口径** —— 走 `listRepoMaterials`（★VF_MATONLY_V1：`gen_` 生成物 +
    //   **出片记录里的老成片**一律硬排除）。旧实现自己排一遍，只排 `gen_`/`.thumbs`，
    //   会漏掉"改名之前的老成片"（如 `20261011_022.mp4`）⇒ 那就是用户说的"仓库搞错了"。
    try {
      const { listRepoMaterials } = await import('@/lib/agent/video-material')
      const items = await listRepoMaterials(uid, limit, 'recent')
      return (items || []).filter((m: any) => m?.kind === 'image')
        .map((m: any) => String(m.name || '')).filter(Boolean).slice(0, limit)
    } catch { /* 取不到就落到下面的老实现（不让"列目录失败"变成"没素材"） */ }
  }
  try {
    const base = `storage/${uid}/`
    const prefix = sub ? `${base}${sub}/` : base
    const objs = await listAllObjects(prefix, 3000)
    return objs
      .map((o) => String(o.name || ''))
      .filter((n) => !n.includes('/.thumbs/') && !n.includes('/_gen/'))
      .map((n) => n.slice(base.length))
      .filter((n) => IMG_RE.test(n) && !/(^|\/)gen_/.test(n))
      .slice(-limit * 3)          // 先取较多，再按 key 序倒排（= 新的在前）
      .reverse()
      .slice(0, limit)
  } catch { return [] }
}

/**
 * ★VF_DAILY_V5：给素材卡用的「原始素材 + 24h 签名缩略图」。
 * 与成片线 `vf-htmlfilm.ts` 的 `repoImages()` 同口径（同一底层、同一排除规则），
 * 保证"日报线的素材"和"成片线的素材"是**同一批东西**。
 */
async function dailyMatItems(uid: number | string, limit = LIST_CAP): Promise<Array<{ name: string; url: string }>> {
  try {
    const { listRepoMaterials } = await import('@/lib/agent/video-material')
    const { signedUrl } = await import('@/lib/oss')
    const items = await listRepoMaterials(uid, limit, 'recent')
    const imgs = (items || []).filter((m: any) => m?.kind === 'image').slice(0, limit)
    const out: Array<{ name: string; url: string }> = []
    for (const m of imgs) {
      let url = ''
      try { url = await signedUrl(`storage/${uid}/${m.name}`, 86400) } catch { /* 单张失败不影响整卡 */ }
      out.push({ name: String(m.name || ''), url })
    }
    return out
  } catch { return [] }
}

/**
 * ★VF_DAILY_V5：**直接复用成片线那张素材卡**（`VF_JSON` + `step:'film_mat'`，前端 `VfFilmCard`）。
 * 为什么不新造一张卡：用户在 18:35 原话「去看看 HTML 怎么做的」—— 那张卡有缩略图网格、
 * 上传/刷新/全选/清空、勾选上限、默认勾选数全部现成；新造一张只会多一处漂移。
 * 两处"会显示错线名"的字已参数化（`title` / `nextLabel`），默认值仍是成片线原话。
 */
async function dailyMatCard(uid: number | string, d: DailyDraft): Promise<string> {
  const images = await dailyMatItems(uid, LIST_CAP)
  const body = {
    step: 'film_mat',
    title: '📄 日报落地页',
    hint: images.length
      // ⚠️ 卡片里的 hint 是**纯文本**（不渲染 markdown）⇒ 不能写 `**加粗**`（会原样露出星号）
      ? '第 1 步 / 共 3 步 · 选原始素材（只列你上传的图，成片不算素材；最多勾 ' + DAILY_MAX_PICK + ' 张，不勾就用最近 ' + DAILY_MAX_PICK + ' 张）'
      : '第 1 步 / 共 3 步 · 还没有原始素材 —— 先点「⬆️ 上传图片」传几张（成片不算素材）',
    nextLabel: '下一步 → 看方案',
    proto: 'VF_DAILY_FORM',   // ★本线的协议串（前端 `next()` 用它，不跟成片线共用）
    images,
    names: Array.isArray(d.names) ? d.names : [],
    max: DAILY_MAX_PICK,
    poolMax: LIST_CAP,
    defRecent: 0,          // 手动选取模式：**不替用户勾**（不勾就按最近 N 张，并在回复里说清）
    pack: '',
  }
  return 'VF_JSON:' + JSON.stringify(body)
}

/** 本机目录白名单（防止一句话让服务端乱读任意路径） */
function localRoots(): string[] {
  const cand = [process.cwd(), 'E:\\ai-marketing', 'G:\\AiMarketing', 'D:\\ai-marketing', '/root/AiMarketing', '/data']
  return cand.map((c) => { try { return path.resolve(c) } catch { return '' } }).filter(Boolean)
}

function localAllowed(dir: string): { ok: boolean; error?: string } {
  if (!path.isAbsolute(dir)) return { ok: false, error: '要写**完整路径**（例如 `E:\\ai-marketing\\storage\\1\\餐饮素材`）' }
  const abs = path.resolve(dir)
  const roots = localRoots()
  const inRoot = roots.some((r) => {
    const a = process.platform === 'win32' ? abs.toLowerCase() : abs
    const b = process.platform === 'win32' ? r.toLowerCase() : r
    return a === b || a.startsWith(b.endsWith(path.sep) ? b : b + path.sep)
  })
  if (!inRoot) return { ok: false, error: '这个路径不在允许范围（' + roots.join(' / ') + '）' }
  let isDir = false
  try { isDir = fs.statSync(abs).isDirectory() } catch { return { ok: false, error: '服务端**读不到**这个路径：' + abs + '（如果应用跑在服务器上，它是看不到你电脑里的文件夹的）' } }
  if (!isDir) return { ok: false, error: '这不是一个文件夹：' + abs }
  return { ok: true }
}

/** 本机目录里的图片（手动模式：只列不下载） */
export function listLocalImages(dir: string, limit = LIST_SHOWN): { ok: boolean; names?: string[]; error?: string } {
  const allow = localAllowed(dir)
  if (!allow.ok) return { ok: false, error: allow.error }
  try {
    const abs = path.resolve(dir)
    const names = fs.readdirSync(abs, { withFileTypes: true })
      .filter((e) => e.isFile() && IMG_RE.test(e.name))
      .map((e) => e.name)
      .sort((a, b) => (a < b ? 1 : -1))
      .slice(0, limit)
    return { ok: true, names }
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e).slice(0, 120) }
  }
}

export interface DailyPick { name: string; key: string; local?: boolean; abs?: string }

function toPicks(uid: number | string, src: DailySource, names: string[]): DailyPick[] {
  if (src.kind === 'local') {
    const dir = String(src.value || '')
    return names.map((n) => ({ name: n, key: path.join(dir, n), local: true, abs: path.join(dir, n) }))
  }
  return names.map((n) => ({ name: n, key: `storage/${uid}/${n}` }))
}

// ★VF_DAILY_V6：不再自己下二进制/缩图（旧路径见文件头"vf6"注释）—— 看图交给 `describeImagesWithVL`，直接给 URL。

/* ─────────────── AI 看素材 → 分段方案（★v2 的核心；提示词/规整在 daily-plan.ts） ─────────────── */

/**
 * ★VF_DAILY_V6（2026-10-12 服务器日志实测，**改看图的通路**）：
 *   病灶（pm2 日志逐行对得上）：
 *     `[模型] ⚠️ qwen3-max 在本账号不存在（HTTP 404 Model not exist）` → 兜底到 **deepseek-v4-flash**
 *     ⇒ 模型**一个像素都没看到** ⇒ "AI 没吐出可解析的 JSON" ⇒ 每次都掉进保底版式（用户看到的正是这个）。
 *   还有一处白跑：我自己用 ffmpeg 缩图，临时文件写成 `/tmp/dv_xxx.img` ⇒
 *     `Invalid data found when processing input`（后缀不认识就解不开）。
 *   现口径：**走成片线那条已验证的看图通路** `describeImagesWithVL`（自带模型候选链 + 404 自愈 +
 *     缺 key 探针），直接把**签名 URL** 递给它（不再自己下二进制、不再自己缩图）。
 *   两段式：① 视觉模型逐张读出"拍的是什么" ② **文字模型**（qwen3.8-flash，稳）据此出 JSON 方案。
 *   视觉不可用时**不判死**：退成"按主题+序号排"，并把原因如实写进方案卡。
 */
/* ★VF_DAILY_V43（2026-10-17 用户实测 + 日志定因后定案「提高 tokens 输出 我们试试 —— 我前面没要求过限制输出」）：
   日志把两条链路的瓶颈**分开暴露**得很清楚：
     · `[qwen3.8] 调用异常: The operation was aborted due to timeout` ⇒ 主模型**60 秒超时**，根本没返回；
     · `[deepseek] 返回空内容（finish length · 思考 17324 字 · maxTokens 8000）` ⇒ **思考把额度吃光、正文一个字没吐**。
   ⇒ 所以要**同时**提两样，缺一不可（只提额度 ⇒ 思考更久 ⇒ 那条 60s 超时会更频繁）：
     ① **输出额度 8000 → 32000**（本机探针实测：百炼 qwen3.8-flash 对 8000/16000/32000/64000 **全部 200 不拒绝**）；
     ② **单次超时 60s → 180s**（思考型模型本来就慢）。
   ⚠️ 备选（这次**没做**，已实测有效，要用再说）：给请求加 `enable_thinking:false` ⇒ 探针里**思考 0 字**、
     更快更稳；但它会改变模型的"想不想"，可能影响文案质量，所以不擅自开。 */
const PLAN_MAX_TOKENS = 32000
const PLAN_TIMEOUT_MS = 180000

export async function aiPlanSegments(picks: DailyPick[], topic: string, lastTheme = '', aiOpts?: { aiLayout?: boolean; aiPickSkin?: boolean }): Promise<{ ok: boolean; segs?: any[]; error?: string; added?: number; fixes?: string[]; theme?: string; custom?: any; font?: string; motion?: string; sawImages?: boolean; vlErr?: string; captions?: string; parseNote?: string; rawHead?: string }> {
  const n = picks.length
  if (!n) return { ok: false, error: '没有素材' }

  // ① 看图（可选，失败不判死）
  let summary = ''
  let vlErr = ''
  try {
    const { describeImagesWithVL, vlReady, vlModel } = await import('@/lib/ai-providers')
    if (!vlReady()) vlErr = '服务端没配视觉模型 key（DASHSCOPE_API_KEY）'
    else {
      const { signedUrl } = await import('@/lib/oss')
      const urls: string[] = []
      for (const p of picks) {
        try {
          if (p.local && p.abs) {
            const b = fs.readFileSync(p.abs)
            if (b.length > 6 * 1024 * 1024) continue                    // 单张太大就跳过（不缩图，避免再踩 ffmpeg）
            const mime = /\.png$/i.test(p.name) ? 'image/png' : 'image/jpeg'
            urls.push(`data:${mime};base64,${b.toString('base64')}`)
          } else {
            urls.push(await signedUrl(p.key, 3600))
          }
        } catch { /* 单张失败跳过 */ }
      }
      if (!urls.length) vlErr = '素材 URL 拿不到（OSS 签名失败）'
      else {
        const ask = '这是一组要做成「日报落地页」的实拍照片（共 ' + urls.length + ' 张，按给定顺序编号 1..' + urls.length + '）。'
          + '第一行：一句话总结这组素材拍的是什么（≤30 字）。'
          + '之后**逐张一行**，写清第 N 张拍的是什么（主体/菜品/场景，≤20 字），格式「N. …」。'
          + '只回这些，不要解释、不要 markdown 代码块。'
        for (let tries = 1; tries <= 2 && !summary; tries++) {
          try {
            const r = await describeImagesWithVL(urls, ask, 900)
            if (String(r || '').trim()) summary = String(r).trim()
          } catch { /* 试第二次 */ }
        }
        if (!summary) vlErr = '视觉模型读图失败（' + vlModel() + '）'
      }
    }
  } catch (e: any) { vlErr = String(e?.message || e).slice(0, 100) }

  // ② 让**文字模型**据此出 JSON 方案（有读图总结就带上；没有就按主题+序号排，并如实标注）
  // ★VF_DAILY_V32：两个 AI 开关透传给提示词（开关只改措辞，引擎与闸门一行不动）
  const prompt = aiPrompt(n, topic, { lastTheme, aiLayout: !!aiOpts?.aiLayout, aiPickSkin: !!aiOpts?.aiPickSkin })
    + (summary ? '\n\n【素材实拍内容（视觉模型逐张读出，写文案必须据此，不许编造看不到的东西）】\n' + summary : '')
  // ★VF_DAILY_V12（2026-10-13 用户实测日志）：
  //   病灶①：主模型 **60s 超时**（`[qwen3.8] 调用异常: The operation was aborted due to timeout`）
  //          → DeepSeek 兜底也空 → 保底版式（用户：「AI 没排字」）。
  //   病灶②（我这边的雷）：`maxTokens` 只有 **2600**，而 V11 把段数提到 ≥9/最多 16 ⇒ 长 JSON 很容易被
  //          **截断**，而"截断"和"没吐 JSON"在现象上**一模一样**。
  //   现口径：maxTokens **8000**（V25b 从 6000 提上来：V25 之后每一段多带了字段，截断风险回升）
  //   + **失败再试一次**（第二次用更严格的"只回 JSON"+ 段数收敛 ⇒ 更快更短）。
  //   ★VF_DAILY_V25b（2026-10-14 用户实测「AI 这轮没排出方案…重试也没成功」）：**失败必须留证据** ——
  //   以前只记一句"没吐出可解析的 JSON"，连模型的原文都没存 ⇒ 只能猜（截断？全角？围栏？）。
  //   现在：① 解析器逐级放宽（见 `extractJsonEx`）；② 失败时把**响应长度 + 开头/结尾 + 修到哪一级**写进日志。
  const strict = '⚠️ 上一条没有产出可解析的 JSON。现在**只回一个 JSON 对象**：不要解释、不要 markdown 代码块、'
    + '不要在 JSON 前后写任何字；段数取 ' + Math.max(6, Math.min(10, n + 2)) + ' 段左右（别追求最多段）；'
    + '`scale`/`stamp`/`kicker`/`tm` 都可以不写（服务端会补），**只写 `layout`/`title`/`imgs` 也能出片**。'
  let lastErr = ''
  let parseNote = ''      // ★V25b：解析诊断（写日志用；本函数没有 ctx/uid，所以随返回值带出去）
  let rawHead = ''
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      // ★VF_DAILY_V43：额度 8000→32000、超时 60s→180s、**并关掉思考**
      //   （三条是一组：实测 8000 连 200s 都跑不完；32000 要 188.6s 且贴着超时线；关思考后只要 15.9s）
      const res = await dashscopeFunctionCall(
        [{ role: 'user', content: attempt === 1 ? prompt : prompt + '\n\n' + strict }],
        [], PLAN_MAX_TOKENS, attempt === 1 ? 0.6 : 0.3, false, undefined, PLAN_TIMEOUT_MS, true,
      )
      const txt = String(res?.content || '')
      const ex = extractJsonEx(txt)
      const raw = ex.value
      // ★VF_DAILY_V41（2026-10-16）：诊断字段**必须够用** —— 用户实测反复出现"响应 0 字"，
      //   而旧日志只记"0 字"⇒ 只能猜（是截断？空响应？思考吃额度？网关抖动？）。
      //   现口径一次记全：模型 id · finish 原因 · 思考字数 · 本次 prompt 字符数 · maxTokens。
      //   **判据（下次一眼分清）**：
      //     · `finish=length` + 思考 >0  ⇒ **思考把额度吃光**（content 被挤成空 —— 同类坑 aiVoiceLines V1d 踩过）；
      //     · `finish=stop` + 思考 0 + 响应 0 字 ⇒ 模型/网关侧**真的返回了空**，与 prompt 长度无关。
      const sentLen = (attempt === 1 ? prompt : prompt + '\n\n' + strict).length
      const diag = ' · 模型 ' + String((res as any)?.model || '?')
        + ' · finish ' + String((res as any)?.finishReason || '?')
        + ' · 思考 ' + Number((res as any)?.reasoningChars || 0) + ' 字'
        + ' · 本次 prompt ' + sentLen + ' 字 · maxTokens 8000'
      parseNote = `第 ${attempt} 次：响应 ${txt.length} 字 · 解析 ${ex.how}${diag}`   // ★V25b：随返回值带给调用方去写日志
      if (!raw) {
        rawHead = txt.slice(0, 200).replace(/\s+/g, ' ')
        lastErr = 'AI 没吐出可解析的 JSON' + (attempt > 1 ? '（重试也没成功）' : '') + '：' + ex.how + (vlErr ? '；' + vlErr : '')
        // 空响应**单独再记一条**（它最容易被误读成"格式问题"，实际是模型根本没给内容）
        if (!txt.trim()) {
          try { console.error('[日报落地页] AI 返回**空内容**（第 ' + attempt + ' 次）' + diag) } catch { /* ignore */ }
        }
        continue
      }
      const { segs, added, fixes } = normSegs(raw, n, topic)
      if (segs.length < 2) { lastErr = 'AI 的分段不合规（段数不足）'; continue }
      // ★L4：皮肤（AI 按素材挑；自定配色交给引擎做对比度体检）
      const th = normTheme(raw)
      // ★VF_DAILY_V25（B1）：AI 挑的**字体配对**要收下来（提示词里问了它，以前这里没接 ⇒ 白问）
      const fo = normFont(raw)
      const allFixes = fixes.concat(th.fixes).concat(fo.fixes)
      return { ok: true, segs, added, fixes: allFixes, theme: th.theme, custom: th.custom, font: fo.font, motion: normMotion(raw?.motion), sawImages: !!summary, vlErr, parseNote }
    } catch (e: any) {
      lastErr = String(e?.message || e).slice(0, 120) + (attempt === 1 ? '（已重试一次）' : '')
    }
  }
  // ★V12：把**看图摘要**一起返回 —— 文字模型挂了，但图已经看过 ⇒ 调用方可用它排出"有真内容"的兜底件
  // ★V25b：连同 `parseNote`（响应多少字、修到哪一级、用量）与 `rawHead`（原文开头）带出去 —— 调用方写日志
  return { ok: false, error: lastErr || '未知原因', sawImages: !!summary, vlErr, captions: summary, parseNote, rawHead }
}

/* ─────────────── ★VF_DAILYVOICE_V1：AI 写逐段口播（配音的**第一步**：先给人看、可改） ─────────────── */

/**
 * ★VF_DAILYVOICE_V1（2026-10-14 用户定案「TTS 按你的 AI 写口播」「不要一次来和视频做，分 2 步，
 *   因为可能文案和时间戳字幕需要修改」）—— 给**已交付的那份页**逐段写口播，产出**配音稿卡**；
 *   人改完才进合成（合成入口是 `at:'synth'`）。
 *
 * ⚠️ 为什么这里**再看一次图**：口播的职责是**补充**画面没说的（画面标题/信息点已经占了字面），
 *    不看图就只能复读画面字或凭空编造 —— 用户明确定过"旁白要补充、不要复读"。
 *    看图通路**复用** `aiPlanSegments` 那条已验证的 `describeImagesWithVL`（自带模型候选链 + 缺 key 探针）；
 *    这里问法不同（只要"逐张拍的是什么"，不带排版诉求），所以没抽公共函数 —— 改动集中、风险更小。
 * ⚠️ **既不判死也不编造**：视觉或文字模型任一失败 ⇒ `ok:false` + 原因，让调用方如实告知
 *    （用户可自己写口播、或重试）；**绝不**退回"拿画面字当口播"那种看着成功、实际复读的假产物。
 */
/* ═══ ★VF_DAIDESIGN_V1（2026-10-17 用户定案「先做阶段1」）：**AI 自由档** —— 让 AI 直接写整页 HTML ═══
   与既有模板档（8 种 layout）并存：模板档保证"可复现 + 稳定"，自由档解决"8 个框架的天花板"。
   可行依据 = 2026-10-17 的**端到端实测**（不是设想）：AI 写的页面经 `adapt-ai-page.mjs` 做 3 条机械转换后，
   **不改一个排版动效**即可过四道闸门并出片（9 段 41s / 20.8MB）。
   ⚠️ 两个必须的配套（缺一不可，实测出来的）：
     ① **先读图**（`describeImagesWithVL`）再把摘要拼进提示词 —— 否则 AI 会瞎编文案
        （实测：不读图时，它给"徽派古建"素材写出一整套火锅文案）；
     ② **超时给足**（240s）：自由页输出 20~25k 字，实测 **162.5s**；用方案档的 180s 会很险。 */
/* ★VF_DAIDESIGN_V4：240s → 170s（deepseek-v4-pro 单轮实测 152s + 余量）。
   配合总预算 420s / 2 轮 ⇒ 最坏 460s，不会再撞 nginx 600s。 */
const DESIGN_TIMEOUT_MS = 170000
export async function aiDesignPage(
  picks: DailyPick[], topic: string,
  /* ★VF_DAIDESIGN_V2b（2026-10-18 用户实测「网络连接失败」→ 服务器 nginx `proxy_read_timeout 600s`）：
     单轮默认 240s，**可由调用方按剩余预算收紧** —— 修错循环必须保证总耗时 < 600s，
     否则请求会在网关被掐断，前端只看到"网络连接失败"（用户遇到的就是这个）。
     **不传 = 240s（逐字保持现状）**。 */
  opts?: { failNote?: string; timeoutMs?: number },
): Promise<{ ok: boolean; html?: string; error?: string; captions?: string; vlErr?: string; diag?: string }> {
  const n = picks.length
  if (!n) return { ok: false, error: '没有素材' }

  // ① 读图（复用成片线那条已验证的通路；失败不判死，但原因要如实带出去）
  let summary = ''
  let vlErr = ''
  try {
    const { describeImagesWithVL, vlReady, vlModel } = await import('@/lib/ai-providers')
    if (!vlReady()) vlErr = '服务端没配视觉模型 key（DASHSCOPE_API_KEY）'
    else {
      const { signedUrl } = await import('@/lib/oss')
      const urls: string[] = []
      for (const p of picks) {
        try {
          if (p.local && p.abs) {
            const b = fs.readFileSync(p.abs)
            if (b.length > 6 * 1024 * 1024) continue            // 单张太大就跳过（不缩图，避免再踩 ffmpeg）
            const mime = /\.png$/i.test(p.name) ? 'image/png' : 'image/jpeg'
            urls.push(`data:${mime};base64,${b.toString('base64')}`)
          } else {
            urls.push(await signedUrl(p.key, 3600))
          }
        } catch { /* 单张失败跳过 */ }
      }
      if (!urls.length) vlErr = '素材 URL 拿不到（OSS 签名失败）'
      else {
        const ask = '这是一组要做成「旅行纪实视频页」的实拍照片（共 ' + urls.length + ' 张，按给定顺序编号 1..' + urls.length + '）。'
          + '第一行：一句话总结这组素材拍的是什么（≤30 字）。'
          + '之后**逐张一行**，写清第 N 张拍的是什么（主体/场景/细节/氛围，≤20 字），格式「N. …」。'
          + '只回这些，不要解释、不要 markdown 代码块。'
        for (let tries = 1; tries <= 2 && !summary; tries++) {
          try {
            const r = await describeImagesWithVL(urls, ask, 900)
            if (String(r || '').trim()) summary = String(r).trim()
          } catch { /* 试第二次 */ }
        }
        if (!summary) vlErr = '视觉模型读图失败（' + vlModel() + '）'
      }
    }
  } catch (e: any) { vlErr = String(e?.message || e).slice(0, 100) }

  // ② 让 AI 出整页 HTML（关思考 + 大额度 + 长超时，与方案档同口径）
  const prompt = aiDesignPrompt(n, topic, { failNote: opts?.failNote })
    + (summary ? '\n\n【素材实拍内容（视觉模型逐张读出，写文案必须据此，不许编造）】\n' + summary : '')
  let txt = ''
  let diag = ''
  try {
    const budget = Math.max(60000, Number(opts?.timeoutMs) || DESIGN_TIMEOUT_MS)
    /* ★VF_DAIDESIGN_V3（2026-10-18 用户「换 deepseek 试试」→ 服务器实测账号里只有
       `deepseek-flash` / `deepseek-v4-pro` 两个（**没有 v4.1 / 1017**）⇒ 用其中最强的 `deepseek-v4-pro`）：
       为什么要换：AI 自由页要一次写 2 万字 HTML，`qwen3.8-flash` 是**小模型**，空间坐标算不准
       ⇒ 压字/对比度这类"低级错误"频发（实测 3 轮全挂）。
       保底：deepseek 失败（无 key / 报错 / 空内容）**自动回落百炼 qwen**，不让整条线挂掉。 */
    let used = ''
    try {
      const dsKey = process.env.DEEPSEEK_API_KEY
        || (() => { try { const c = fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8'); const m = c.match(/^DEEPSEEK_API_KEY=(.+)$/m); return m ? m[1].trim().replace(/^["']|["']$/g, '') : '' } catch { return '' } })()
      if (!dsKey) throw new Error('没有 DEEPSEEK_API_KEY')
      const r = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + dsKey },
        body: JSON.stringify({
          model: 'deepseek-flash',
          messages: [{ role: 'user', content: prompt }],
          /* ★VF_DAIDESIGN_V3c（2026-10-18 用户定案「**max_tokens 取消这个不限制**」）：
             **不再传 `max_tokens`** —— 之前 16000/32000 都是拍脑袋，结果 16000 那版每轮都被截断
             （思考先吃额度、正文要 1.5~2 万字 ⇒ 缺 `</html>` ⇒ 3 轮全挂）。
             现口径：交给模型自己的默认输出上限（deepseek 会按模型能力给到最大），
             **超时仍由 `AbortSignal.timeout(budget)` 兜住**，不会无限等。
             ⚠️ 百炼那条回落路径保持原样（`PLAN_MAX_TOKENS` 32000），它本来就够用。 */
          temperature: 0.8,
          stream: false,
        }),
        signal: AbortSignal.timeout(budget),
      } as any)
      if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + (await r.text()).slice(0, 160))
      const j: any = await r.json()
      const ch = j?.choices?.[0]
      txt = String(ch?.message?.content || '')
      used = 'deepseek-flash'
      diag = '模型 deepseek-flash · finish ' + String(ch?.finish_reason || '?')
        + ' · 输出 ' + txt.length + ' 字 · prompt ' + prompt.length + ' 字'
    } catch (eDs: any) {
      // 回落百炼（原路径，逐字不变）
      const res = await dashscopeFunctionCall(
        [{ role: 'user', content: prompt }], [], PLAN_MAX_TOKENS, 0.8, false, undefined, budget, true,
      )
      txt = String(res?.content || '')
      used = 'qwen(回落)'
      diag = 'deepseek 失败(' + String(eDs?.message || eDs).slice(0, 80) + ') ⇒ 回落百炼 · 模型 '
        + String((res as any)?.model || '?') + ' · 输出 ' + txt.length + ' 字 · prompt ' + prompt.length + ' 字'
    }
    diag = '[' + used + '] ' + diag
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e).slice(0, 200), captions: summary, vlErr, diag }
  }
  if (!txt.trim()) return { ok: false, error: 'AI 返回空内容', captions: summary, vlErr, diag }

  // ③ 提 HTML（AI 可能包 markdown 围栏）
  /* ★VF_DAIDESIGN_V3b：**提取兜底** —— 原来只认 `<!DOCTYPE … </html>` 完整闭合，
     一旦输出被截断（缺 `</html>`）就判"没给出完整 HTML"⇒ 3 轮全挂、白等 600 秒（用户实测）。
     现口径：缺结尾也接受 —— 从 `<!DOCTYPE`（或 `<html`）截到末尾，**自动补 `</html>`**。
     另外先剥掉 AI 爱加的 markdown 围栏（```html … ```），否则开头会带 `html ` 这种残渣。 */
  const clean = String(txt).replace(/^\s*```[a-zA-Z]*\s*/m, '').replace(/```\s*$/m, '')
  const m = /<!DOCTYPE html[\s\S]*<\/html>/i.exec(clean)
    || /<html[\s\S]*<\/html>/i.exec(clean)
    || (/<!DOCTYPE html/i.test(clean)
      ? [clean.slice(clean.search(/<!DOCTYPE html/i)) + '\n</html>'] : null)
    || (/<html/i.test(clean) ? [clean.slice(clean.search(/<html/i)) + '\n</html>'] : null)
  if (!m) {
    return {
      ok: false, captions: summary, vlErr, diag,
      error: 'AI 没给出完整 HTML（前 120 字：' + txt.slice(0, 120).replace(/\s+/g, ' ') + '）',
    }
  }
  return { ok: true, html: m[0], captions: summary, vlErr, diag }
}

/* ═══ ★VF_DAIDESIGN_V2（2026-10-18 用户实测「content_overlap / 对比度 1.8:1」后定案「修吧」）：
   **只跑闸门、不交付** —— 给"修错循环"用：AI 出页面 → 这里跑四道闸门 → 不过就把报错喂回去重写。
   三个设计要点（都是踩过的坑）：
     ① **图内嵌再检查**，**绝不调 `publishPickedImages`** —— 那会占用图名、和交付时那次冲突
        （V1b 就是"两批名字 ⇒ 单文件版 0 匹配 ⇒ 出片按钮变灰"）；
     ② 页面用**原始图名**（`1.jpg`~`N.jpg`）检查，与 AI 交付时一致 —— 图名替换留到 `finishDaily` 做；
     ③ 只跑 `--check-only`（不渲染），一次约 **20~40 秒**；渲染才是 60 秒级，那种不能进重试环。 */
async function checkDesignPage(html: string, picks: DailyPick[], tag: string): Promise<{ ok: boolean; note: string }> {
  // ① 图内嵌（只为让 check 能读到图；不进 OSS、不占名字）
  const imgs: any[] = []
  for (let i = 0; i < picks.length; i++) {
    try {
      const p = picks[i]
      let b: Buffer | null = null
      if (p.local && p.abs && fs.existsSync(p.abs)) b = fs.readFileSync(p.abs)
      else {
        // 与 buildSingleFile 同一口径：优先 OSS SDK（signedUrl+fetch 线上实测只读到 1/17 张）
        const { getObject } = await import('@/lib/oss')
        b = await getObject(p.key)
      }
      if (!b || !b.length) continue
      const mime = /\.png$/i.test(p.name) ? 'image/png' : 'image/jpeg'
      imgs.push({ n: i + 1, mime, b64: b.toString('base64'), bytes: b.length, ref: String(i + 1) + '.jpg' })
    } catch { /* 单张失败就跳过 */ }
  }
  if (!imgs.length) return { ok: false, note: '素材读不出来（一张都没读到），无法跑闸门' }
  const emb = embedImages(html, imgs, 48 * 1024 * 1024)
  // ② 写临时目录 + 跑 check-only
  let tmp = ''
  try {
    const os = await import('node:os')
    const { execFile } = await import('node:child_process')
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aidchk-'))
    const f = path.join(tmp, 'index.html')
    fs.writeFileSync(f, emb.html, 'utf8')
    const script = path.join(vfRootDir(), 'scripts', 'video-factory', 'html-deck', 'tools', 'daily-film.mjs')
    const out = path.join(tmp, 'out')
    const r = await new Promise<{ code: number; text: string }>((resolve) => {
      execFile('node', [script, f, '--outdir', out, '--check-only'], { timeout: 240000, maxBuffer: 8 * 1024 * 1024 },
        (err, so, se) => resolve({ code: err ? 1 : 0, text: String(so || '') + '\n' + String(se || '') }))
    })
    // ③ 摘出真正有用的行（✗ 开头的判据 + 四个阶段的结论），别把整段日志喂回去
    const lines = r.text.split('\n').map((l) => l.trim())
      .filter((l) => /^✗|stage=(html|check|render)/.test(l))
      .slice(0, 8)
    const okAll = r.code === 0 && /引擎校验 OK/.test(r.text)
    if (okAll) return { ok: true, note: '四道闸门全过' }
    return { ok: false, note: lines.length ? lines.join('\n') : ('check 失败但没给出可用报错（exit=' + r.code + '）') }
  } catch (e: any) {
    return { ok: false, note: '跑闸门时出错：' + String(e?.message || e).slice(0, 160) }
  } finally {
    try { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* ignore */ }
  }
}

export async function aiVoiceLines(
  picks: DailyPick[], segs: any[], topic = '',
): Promise<{ ok: boolean; lines?: string[]; fixes?: string[]; error?: string; sawImages?: boolean; vlErr?: string; diag?: string }> {
  if (!Array.isArray(segs) || !segs.length) return { ok: false, error: '没有分段方案（要先出 HTML 才能配音）' }

  // ① 看图：逐张读出"拍的是什么"（失败不判死，但原因要如实带出去）
  let summary = ''
  let vlErr = ''
  try {
    if (!picks.length) vlErr = '没有素材可看'
    else {
      const { describeImagesWithVL, vlReady, vlModel } = await import('@/lib/ai-providers')
      if (!vlReady()) vlErr = '服务端没配视觉模型 key（DASHSCOPE_API_KEY）'
      else {
        const { signedUrl } = await import('@/lib/oss')
        const urls: string[] = []
        for (const p of picks) {
          try {
            if (p.local && p.abs) {
              const b = fs.readFileSync(p.abs)
              if (b.length > 6 * 1024 * 1024) continue                 // 单张太大跳过（不缩图，避免再踩 ffmpeg）
              const mime = /\.png$/i.test(p.name) ? 'image/png' : 'image/jpeg'
              urls.push('data:' + mime + ';base64,' + b.toString('base64'))
            } else {
              urls.push(await signedUrl(p.key, 3600))
            }
          } catch { /* 单张失败跳过 */ }
        }
        if (!urls.length) vlErr = '素材 URL 拿不到（OSS 签名失败）'
        else {
          const ask = '这是一组实拍照片（共 ' + urls.length + ' 张，按给定顺序编号 1..' + urls.length + '）。'
            + '**逐张一行**，写清第 N 张拍的是什么（主体 / 菜品 / 场景 / 细节，≤20 字），格式「N. …」。'
            + '只回这些，不要总述、不要解释、不要 markdown 代码块。'
          for (let tries = 1; tries <= 2 && !summary; tries++) {
            try {
              const r = await describeImagesWithVL(urls, ask, 900)
              if (String(r || '').trim()) summary = String(r).trim()
            } catch { /* 试第二次 */ }
          }
          if (!summary) vlErr = '视觉模型读图失败（' + vlModel() + '）'
        }
      }
    }
  } catch (e: any) { vlErr = String(e?.message || e).slice(0, 100) }

  // ② 文字模型按"画面字 + 看图摘要"写口播 —— ★VF_DAILYVOICE_V1d（2026-10-14 **服务端日志确证后重写**）
  //   病灶（pm2 日志原文）：`[qwen3.8] 调用异常: The operation was aborted due to timeout`
  //   —— 主模型**60 秒超时**（那个 timeoutMs 硬编码在 dashscopeFunctionCall 里，我改不了），兜底链又拿不到内容
  //   ⇒ 两次尝试都回空。**两个诱因，第二个是我的错**：
  //     ① 一次让它写 13 句（还要"补充不复读"）⇒ 生成量大 ⇒ 必然容易撞 60s；
  //     ② 上一版我把 maxTokens 从 4000 **降到 2500** —— 若这是思考型模型，额度会被"思考"吃光、
  //        `content` 就是空串（aiPlanSegments 一直用 **8000**，而它输出比我还长）⇒ **等于我帮倒忙**。
  //   现口径：**分批**（每批 ≤5 段，单批生成量小 ⇒ 不撞超时）+ **maxTokens 8000**（与 aiPlanSegments 对齐）
  //   + 每批 2 次尝试（长 prompt → 极简 prompt）+ **某批失败不整单失败**（凑够就交付，并如实报哪几段会静音）。
  const BATCH = 5
  const out: string[] = new Array(segs.length).fill('')
  const allFixes: string[] = []
  const diags: string[] = []
  for (let s = 0; s < segs.length; s += BATCH) {
    const part = segs.slice(s, s + BATCH)
    const tag = '段' + (s + 1) + '-' + (s + part.length)
    let okPart = false
    let lastErr = ''
    for (let attempt = 1; attempt <= 2 && !okPart; attempt++) {
      try {
        const ask = attempt === 1 ? voicePrompt(part, summary, topic, s) : voicePromptStrict(part, summary, s)
        // ★VF_DAILY_V43：口播这条是**同一个病**（10-14 的日志里就是"空响应"三条连发）⇒ 同样 提额度 + 提超时 + 关思考
        const res = await dashscopeFunctionCall([{ role: 'user', content: ask }], [], PLAN_MAX_TOKENS, attempt === 1 ? 0.5 : 0.3, false, undefined, PLAN_TIMEOUT_MS, true)
        const txt = String(res?.content || '')
        const ex = extractJsonEx(txt)
        // 兜底：模型常无视"只回 JSON"、直接一行一句 ⇒ JSON 失败后再按行抽一次
        const fb = ex.value ? null : parseVoiceLines(txt)
        const usage = (res && (res as any).usage) ? ' · 用量 ' + JSON.stringify((res as any).usage) : ''
        diags.push(tag + ' 第' + attempt + '次：响应 ' + txt.length + ' 字 · '
          + (ex.value ? '解析 ' + ex.how : (fb ? '行兜底救回 ' + fb.length + ' 行' : '既不是 JSON 也不像逐行文本')) + usage)
        if (!ex.value && !fb) {
          // ★VF_DAILY_V43：文案跟着额度/超时一起改（旧文案写死"60s 超时"，现已 180s ⇒ 会误导排查）
          lastErr = txt.length
            ? ('解析不出来：' + ex.how)
            : `空响应（超时 ${PLAN_TIMEOUT_MS / 1000}s 到了，或思考把 ${PLAN_MAX_TOKENS} 额度吃光了）`
          continue
        }
        const { lines, fixes } = normVoiceLines(ex.value || fb, part.length)
        if (!lines.filter(Boolean).length) { lastErr = '这批全是空的'; continue }
        lines.forEach((t, k) => { out[s + k] = t })
        allFixes.push(...fixes)
        okPart = true
      } catch (e: any) {
        lastErr = String(e?.message || e).slice(0, 120)
        diags.push(tag + ' 第' + attempt + '次：调用异常 ' + lastErr.slice(0, 80))
      }
    }
    if (!okPart) allFixes.push(tag + ' **没写出来**（' + (lastErr || '未知') + '）—— 这几段会静音')
  }
  const got = out.filter(Boolean).length
  if (!got) {
    return { ok: false, error: '口播一段都没写出来', sawImages: !!summary, vlErr, diag: diags.slice(-3).join(' · ').slice(0, 400) }
  }
  return { ok: true, lines: out, fixes: allFixes, sawImages: !!summary, vlErr, diag: diags.slice(-3).join(' · ').slice(0, 300) }
}

/** 素材名 → 图号（HTML 里 images/N.jpg 的 N 就是所选顺序），顺便记下"这段用了哪几张" */
function attachSrc(plan: any, picks: DailyPick[]) {
  if (!plan || !Array.isArray(plan.segments)) return plan
  plan.segments.forEach((s: any) => {
    s.src = (s.imgs || []).map((x: number) => picks[x - 1]?.name || '').filter(Boolean)
  })
  return plan
}

/* ─────────────── 生成（调引擎 tools/daily-page.mjs → 存个人仓库） ─────────────── */

export function generateDailyHtml(uid: number | string, plan: any): { ok: boolean; name?: string; error?: string; note?: string } {
  // ★VF_ROOT_V1（2026-10-14）：**不能**用 process.cwd()（standalone 下是 .next/standalone，那里 scripts/ 是残缺的）；
  //   vfRootDir() 上溯到项目根；本地开发时它返回的就是 cwd ⇒ 行为逐字不变。
  const repo = vfRootDir() || process.cwd()
  const engine = path.join(repo, 'scripts', 'video-factory', 'html-deck', 'tools', 'daily-page.mjs')
  if (!fs.existsSync(engine)) return { ok: false, error: '引擎缺失：scripts/video-factory/html-deck/tools/daily-page.mjs' }
  const stamp = Date.now()
  const cfgPath = path.join(os.tmpdir(), `daily_${stamp}.json`)
  const outPath = path.join(os.tmpdir(), `daily_${stamp}.html`)
  try {
    fs.writeFileSync(cfgPath, JSON.stringify(plan), 'utf8')
    const r = spawnSync(process.execPath, [engine, cfgPath, '--out', outPath], { cwd: repo, encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024 })
    if (r.status !== 0 || !fs.existsSync(outPath)) {
      return { ok: false, error: '引擎生成失败：' + String(r.stderr || r.stdout || '').slice(0, 200) }
    }
    const note = String(r.stdout || '').split('\n').filter((l) => l.includes('体检')).join(' ').slice(0, 200)
    return { ok: true, name: outPath, note }
  } finally {
    try { fs.unlinkSync(cfgPath) } catch { /* ignore */ }
  }
}

/** 生成 → 入库（返回仓库文件名） */
export async function buildAndStoreDaily(uid: number | string, plan: any): Promise<{ ok: boolean; name?: string; error?: string; note?: string }> {
  const repo = vfRootDir() || process.cwd()   // ★VF_ROOT_V1：同上（别用 process.cwd()）
  const engine = path.join(repo, 'scripts', 'video-factory', 'html-deck', 'tools', 'daily-page.mjs')
  const stamp = Date.now()
  const cfgPath = path.join(os.tmpdir(), `daily_${stamp}.json`)
  const outPath = path.join(os.tmpdir(), `daily_${stamp}.html`)
  try {
    fs.writeFileSync(cfgPath, JSON.stringify(plan), 'utf8')
    const r = spawnSync(process.execPath, [engine, cfgPath, '--out', outPath], { cwd: repo, encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024 })
    if (r.status !== 0 || !fs.existsSync(outPath)) {
      return { ok: false, error: '引擎生成失败：' + String(r.stderr || r.stdout || '').slice(0, 200) }
    }
    const buf = fs.readFileSync(outPath)
    const saved = await saveToPersonalRepo({ userId: uid, buffer: buf, ext: 'html', mime: 'text/html', gen: true })
    const note = String(r.stdout || '').split('\n').filter((l) => l.includes('体检')).join(' ').slice(0, 200)
    return { ok: true, name: saved.name, note }
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e).slice(0, 200) }
  } finally {
    try { fs.unlinkSync(cfgPath) } catch { /* ignore */ }
    try { fs.unlinkSync(outPath) } catch { /* ignore */ }
  }
}

/* ─────────────── 接管判定 + 处理（照 lead 线：入口词 或 本线有草稿 才接管） ─────────────── */

export async function shouldTakeOverDailyLine(db: any, uid: number | string, msg: string): Promise<boolean> {
  const m = String(msg || '').trim()
  if (isDailyEntry(m)) return true
  return await hasDailyDraft(db, uid)
}

export interface DailyCtx {
  uid: number | string
  userMessage: string
  prisma: any
  /** 只有"点/说了命令"才算入口（本线没有协议串，保留参数与其它线同形） */
  isEntry?: boolean
  /** ★VF_FILELINK_V1：调用方传入的**对外域名**（用于拼"本站短链"；拿不到就退回相对路径） */
  origin?: string
  log?: (uid: number | string, s: string) => void
}

/** 第 2 步的列素材回复（来源可切换 —— ★C） */
function materialsReply(d: DailyDraft, names: string[], src: DailySource): string {
  const srcLabel = src.kind === 'local' ? `本机目录：${src.value}`
    : (src.kind === 'subdir' ? `个人仓库 · 子目录「${src.value}」`
      : '个人仓库（全部图片）')
  const L: string[] = []
  L.push('📄「日报落地页」第 1 步 / 共 3 步 · **选素材**（手动挑：回序号）')
  L.push('')
  L.push(`主题：${d.topic || '未给（想给就一起写，示例见下）'}`)
  L.push(`来源：${srcLabel}　共 ${names.length} 张${names.length >= LIST_CAP ? '（只列前 ' + LIST_CAP + ' 张）' : ''}`)
  L.push('')
  names.forEach((n, i) => L.push(`  ${i + 1}. ${n}`))
  L.push('')
  L.push(`👉 回**要用哪几张**（最多 ${DAILY_MAX_PICK} 张），就一个数字列表：\`1,3,5\`${names.length > DAILY_MAX_PICK ? '（也可回 `自动` 用前 ' + Math.min(DAILY_MAX_PICK, names.length) + ' 张）' : ''}`)
  L.push('· 想带主题：`京味铜锅涮肉 1,3,5`（或 `主题=京味铜锅涮肉`）')
  L.push('· 只想看某个子文件夹：`目录=子文件夹名`　·　想用电脑上的文件夹：`本机=E:\\ai-marketing\\storage\\1\\餐饮素材`')
  L.push('· 想退出：回「取消」')
  return L.join('\n')
}

/**
 * ★VF_DAILY_V9：皮肤轮换的"记住上次" —— 复用现成的 `AgentMemory`（tags 含「日报皮肤」）。
 * 为什么用它：① 表已经存在、有索引，不用动 schema；② **不会污染用户画像** ——
 * 画像注入只读 tags 含「画像 / agent_profile」的记录（route.ts 里那两行），这类记录看不见。
 * 失败**不影响**交付（记不住就退化成"每次都按 seed 挑"，绝不因为写库失败拦住用户）。
 */
const SKIN_TAG = '日报皮肤'
// ★VF_DAILY_V13：上一份的**指纹**（皮肤+结构序+效果序）—— 用来判"这份和上一份像不像"，太像就重掷
const FP_TAG = '日报指纹'
async function lastFp(prisma: any, uid: number | string): Promise<string> {
  try {
    const rows = await prisma.agentMemory.findMany({
      where: { userId: { in: [String(uid), String(Number(uid) || 0)] }, tags: { contains: FP_TAG } },
      orderBy: { updatedAt: 'desc' }, take: 1,
    })
    return String((rows || [])[0]?.content || '')
  } catch { return '' }
}
async function rememberFp(prisma: any, uid: number | string, fp: string): Promise<void> {
  if (!fp) return
  try {
    const rows = await prisma.agentMemory.findMany({
      where: { userId: { in: [String(uid), String(Number(uid) || 0)] }, tags: { contains: FP_TAG } },
      orderBy: { updatedAt: 'desc' }, take: 1,
    })
    const first = (rows || [])[0]
    if (first) await prisma.agentMemory.update({ where: { id: first.id }, data: { content: fp } })
    else await prisma.agentMemory.create({ data: { userId: String(uid), content: fp, tags: FP_TAG } })
  } catch { /* 记不住不影响交付 */ }
}
async function recentSkins(prisma: any, uid: number | string): Promise<string[]> {
  try {
    const rows = await prisma.agentMemory.findMany({
      where: { userId: { in: [String(uid), String(Number(uid) || 0)] }, tags: { contains: SKIN_TAG } },
      orderBy: { updatedAt: 'desc' }, take: 3,
    })
    return (rows || []).map((r: any) => String(r?.content || '').trim().split(/\s+/)[0]).filter(Boolean)
  } catch { return [] }
}
async function rememberSkin(prisma: any, uid: number | string, theme: string): Promise<void> {
  if (!theme) return
  try {
    /* ★VF_DAILY_V41（2026-10-16 用户实测 + **数据库取证**后定案）：改成"**追加一条**"。
       病灶（原写法）：`findMany({..., take: 1})` + `update({ id: first.id })` ⇒ **永远只维护一条记录**；
       而 `recentSkins` 用 `take: 3` 想拿"最近 3 份皮肤" ⇒ **永远只拿得到 1 条** ⇒
       `rotateTheme` 里"排除最近 **2** 次用过的皮肤"退化成"只排除上一次" ⇒ 皮肤变成
       **A→B→A→B 乒乓**（连续生成时约一半概率和上一次同配色 —— 用户「几乎看不出变化」的主因之一）。
       用户服务器数据库实测坐实：`AgentMemory` 里 tags=日报皮肤 的记录**只有 1 条**（content=copper-pot）。
       现口径：每份**追加**（`updatedAt` 自然递增 ⇒ `recentSkins` 的 desc 排序才有意义），
       并只保留最近 KEEP 条（KEEP 取 6 > `recentSkins` 用的 3，留余量；不无限增长）。
       ⚠️ 仍然"失败不影响交付"：记不住最多退化成"按 seed 挑"，绝不因为写库失败拦住用户。 */
    const KEEP = 6
    await prisma.agentMemory.create({ data: { userId: String(uid), content: theme, tags: SKIN_TAG } })
    const all = await prisma.agentMemory.findMany({
      where: { userId: { in: [String(uid), String(Number(uid) || 0)] }, tags: { contains: SKIN_TAG } },
      orderBy: { updatedAt: 'desc' },
    })
    const extra = (all || []).slice(KEEP).map((r: any) => r.id)
    if (extra.length) await prisma.agentMemory.deleteMany({ where: { id: { in: extra } } })
  } catch { /* 记不住不影响交付 */ }
}

/**
 * ★VF_DAILY_V15 · R5′：量一张图的**平均亮度**（0~255）—— ffmpeg 缩成 1×1 灰度、读那 1 个字节。
 * 便宜（几十毫秒）、确定（同图同值）、不引新依赖；读不到就返回 0（调用方按"没量到"保守处理）。
 * ⚠️ 临时文件必须带正确后缀（`.jpg`）—— 早先我自己拼的 `.img` 让 ffmpeg 判 Invalid data（踩过）。
 */
async function pickLum(p: DailyPick): Promise<number> {
  try {
    let buf: Buffer | null = null
    if (p.local && p.abs && fs.existsSync(p.abs)) buf = fs.readFileSync(p.abs)
    else {
      const { signedUrl } = await import('@/lib/oss')
      const u = await signedUrl(p.key, 300)
      const r = await fetch(u)
      if (r.ok) buf = Buffer.from(await r.arrayBuffer())
    }
    if (!buf || !buf.length) return 0
    const tin = path.join(os.tmpdir(), `dl_${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`)
    try {
      fs.writeFileSync(tin, buf)
      const out = spawnSync('ffmpeg', ['-v', 'error', '-i', tin, '-vf', 'format=gray,scale=1:1', '-f', 'rawvideo', '-'], { timeout: 8000 })
      const b = out.stdout
      return b && b.length ? b[0] : 0
    } finally { try { fs.unlinkSync(tin) } catch { /* ignore */ } }
  } catch { return 0 }
}

/**
 * ★VF_DAILY_V16（2026-10-13 用户实测：「我在客户端中**能看到部分图片、部分没有**」）：
 *   病因：单文件版内嵌图有 **12MB 预算**（`embedImages` 的 cap），超预算的图**直接跳过**
 *   ⇒ 10 张原图（每张 2~4MB）只嵌进前 4 张，其余留在 `images/N.jpg` 相对路径
 *   ⇒ 单文件版里那些图位**什么都没有**（不是它没加，是超预算被跳过了）。
 *   修法：**先压再嵌** —— 长边 ≤1600、q≈5（约 200~500KB/张）⇒ 10 张全部进得去，单文件仍在几 MB。
 *   （缩图临时文件必须带正确后缀；踩过 `.img` 被 ffmpeg 判 Invalid data 的坑。）
 */
async function shrinkForEmbed(buf: Buffer): Promise<Buffer> {
  try {
    const tin = path.join(os.tmpdir(), `dsc_${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`)
    const tout = tin + '.out.jpg'
    try {
      fs.writeFileSync(tin, buf)
      // ★VF_DAILY_V37（2026-10-16 撤回占位方案后的补偿）：**质量 q5 → q7**。
      //   为什么这次动质量（与 V34b"只缩尺寸不动质量"的口径相反）：
      //   引擎校验不接受"占位"，所以**普通图只能逐个内嵌** ⇒ "同一张图被多段复用"造成的重复
      //   **在不动渲染器的前提下消不掉**（实测 17 张 → 38 个图位）。⇒ 只能把单张压小来抵消：
      //     长边 **1280 保持不动**（满幅页确实需要 1280，再小会糊）× 质量 **q7**（约 150KB/张）
      //     ⇒ 38 个图位 ≈ **5.7MB**，低于"曾经成功出片"的 7.4MB。
      //   ⚠️ 这与用户"别妨碍清晰度"的交代**不一致**，已在 ISSUES 里记明理由与还原条件：
      //     等"图改用 CSS 背景、天然只存一份"那条正道做完，就把质量档还原成 q5。
      spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', tin, '-vf', 'scale=min(1280\\,iw):-2', '-q:v', '7', tout], { timeout: 20000 })
      const out = fs.existsSync(tout) ? fs.readFileSync(tout) : null
      return out && out.length && out.length < buf.length ? out : buf
    } finally {
      try { fs.unlinkSync(tin) } catch { /* ignore */ }
      try { fs.unlinkSync(tout) } catch { /* ignore */ }
    }
  } catch { return buf }
}

/** ★VF_DAILY_V5：挑完图 → AI 看素材排方案 → 返回"方案确认"回复。
 *  卡片协议串与"文字回序号"两条入口**共用这一份**（免得两处各排一遍、行为漂移）。 */
async function runPlan(ctx: DailyCtx, d: DailyDraft, src: DailySource, picked: string[], note0 = ''): Promise<string> {
  const uid = ctx.uid
  const picks = toPicks(uid, src, picked)
  d.source = src
  d.names = picked
  try { ctx.log?.(uid, `[日报落地页] AI 看素材编排（${picks.length} 张，来源=${src.kind}）…`) } catch { /* ignore */ }
  // ★VF_DAILY_V9：把"上次用的皮肤"告诉 AI（提示词里明确要求换一个）——这是"看着像同一套"的第一道药
  const recent = await recentSkins(ctx.prisma, uid)
  const ai = await aiPlanSegments(picks, d.topic || '', recent[0], { aiLayout: !!d.aiLayout, aiPickSkin: !!d.aiPickSkin })
  // ★VF_DAILY_V9：第二道药 —— AI 没挑 / 挑的还是上一套 ⇒ **服务端强制换**（纯函数 rotateTheme，可复现）
  const rot = rotateTheme(ai.ok ? String(ai.theme || '') : '', recent, picked.join('|') + '|' + (d.topic || ''))
  // ★VF_DAILY_V25：种子提前到"建 plan 之前"算 —— 因为**字体配对**要在建 plan 时就写进 meta
  //   （原来这段在下面排效果序时才算；它只依赖 素材+主题，提前不影响可复现性）
  const fxSeed = (() => {
    let h = 5381
    const key = picked.join('|') + '|' + (d.topic || '')
    for (let i = 0; i < key.length; i++) h = ((h * 33) ^ key.charCodeAt(i)) >>> 0
    return h
  })()
  // ★VF_DAILY_V25（B1）：字体配对 —— AI 挑的优先；与上一份同款就顺延一组（字体这条轴不能只跟着皮肤走）
  const fp = pickFont({ want: (ai as any).font, themeId: rot.theme, recentThemes: recent, key: fxSeed })
  let plan: any
  // ★VF_DAILY_V12：多一档 `captions`（文字模型挂了，但**图已看过** ⇒ 用看图摘要排"有真内容"的方案）
  let by: 'ai' | 'captions' | 'fallback'
  let note = ''
  if (ai.ok && ai.segs && ai.segs.length) {
    // ★L4：皮肤（theme / custom）来自 AI；引擎会做对比度体检，不达标自己在页头回落并写明
    // ★V9：换成 rot.theme（若 AI 的挑法被轮换否决，就**不带**它的自定配色 —— 否则两处打架）
    plan = buildPlanFromSegs(ai.segs, d.topic || '', ai.motion || 'normal', rot.theme,
      rot.theme === 'custom' ? ai.custom : undefined, undefined, fp.font)
    by = 'ai'
    if (ai.added) note = `AI 漏了 ${ai.added} 张，已自动补段`
  } else {
    note = String(ai.error || '未知原因')
    // ★VF_DAILY_V25b：AI 编排失败时把**诊断**写进日志（用户实测「AI 这轮没排出方案…重试也没成功」时，
    //   旧代码只留一句"没吐出可解析的 JSON"，连原文都没有 ⇒ 只能猜。现在：响应多少字、修到哪一级、
    //   用量、原文开头都记下来，下次一眼能分清"截断/空响应/全是解释/真超时"。）
    try {
      if (ai.parseNote) ctx.log?.(uid, '[日报落地页] AI 方案解析诊断 · ' + ai.parseNote)
      if (ai.rawHead) ctx.log?.(uid, '[日报落地页] AI 原文开头（诊断用）：' + ai.rawHead)
    } catch { /* ignore */ }
    // ★VF_DAILY_V12：**先试"看图摘要兜底"** —— 图已经看过了（VL 逐张读出内容），别浪费：
    //   用它排出有真标题/真信息点的方案（不再"现场记录 N/N"那种空壳占位）。
    const cap = planFromCaptions(ai.captions || '', picks.length, d.topic || '')
    if (cap.used > 0 && cap.segments.length >= 2) {
        plan = buildPlanFromSegs(cap.segments, d.topic || '', 'normal', rot.theme, undefined, undefined, fp.font)
      by = 'captions'
      note = note + ' ⇒ 已改用**看图摘要**重排（标题/信息点都来自读图，不是占位）'
      try { ctx.log?.(uid, `[日报落地页] AI 没排出 ⇒ 按看图摘要重排（读到 ${cap.used} 张的内容，${cap.segments.length} 段）`) } catch { /* ignore */ }
    } else {
      const fb = buildDailyPlan(picked, d.topic || '')
      plan = buildPlanFromSegs(fb.segments, d.topic || '', fb.motion, rot.theme, undefined, undefined, fp.font)
      by = 'fallback'
      try { ctx.log?.(uid, '[日报落地页] AI 编排失败 → 保底版式：' + note) } catch { /* ignore */ }
    }
  }
  if (rot.theme) await rememberSkin(ctx.prisma, uid, rot.theme)
  // ★VF_DAILY_V13（用户：「低相似度」）：① 按"素材+主题"的稳定散列排**效果序**（每份不同）；
  //   ② 与**上一份**比相似度（皮肤 20% / 结构序 50% / 效果序 30%），>0.70 就**重掷**（换效果序+单图段结构），
  //      取"更不像"的那次；③ 记下这一份的指纹，供下一份比较。
  //   ⚠️ V25：种子本身已在上面（建 plan 之前）算好 —— 字体配对要用它（见 fp）。
  assignFx(plan.segments, fxSeed)
  // ★VF_DAILY_V21（2026-10-14 用户「依然是文字排版同质化严重」）：**文字层也轮换** ——
  //   AI 没指定 type 的段，服务端按 seed 轮换四种（相邻段必不同）；指定过的段不动。
  //   这样"结构 8 种"之外又多一维（文字层 4 种），一份里不会只有一张脸。
  assignTextLayer(plan.segments, fxSeed)
  // ★VF_DAILY_V25：**文字动效**也轮换（用户点名的第四条轴）—— 七种入场动作、相邻必不同。
  //   为什么必须服务端排：这是"相邻重复"这类问题**只有整片视角才看得见**的地方，
  //   交给引擎兜底也行，但那样就没法在交付前的去同质化自检里一起看。
  assignTextMotion(plan.segments, fxSeed)
  try {
    // ★VF_DAILY_V25：日志按**用户点名的四条轴**打（去同质化的验收就是看这四行雷不雷同）
    const faces = plan.segments.map((s: any) => String(s.type || 'band'))
    const tms = plan.segments.map((s: any) => String(s.tm || '-'))
    const lays = plan.segments.map((s: any) => String(s.layout || '-'))
    const fxs = plan.segments.map((s: any) => String(s.fx || '-').split('#')[0])
    ctx.log?.(uid, `[日报落地页] 四轴 · 配色「${themeName(rot.theme)}」/ 字体「${plan.meta?.font || fp.font || '皮肤默认'}」`
      + ` / 结构 ${new Set(lays).size} 种、文字层 ${new Set(faces).size} 种 / 文字动效 ${new Set(tms).size} 种、图效 ${new Set(fxs).size} 种`)
    ctx.log?.(uid, `[日报落地页] 轴序 · 结构 ${lays.slice(0, 8).join('/')}${lays.length > 8 ? ' …' : ''}`)
    ctx.log?.(uid, `[日报落地页] 轴序 · 文字层 ${faces.slice(0, 8).join('/')}${faces.length > 8 ? ' …' : ''}`
      + ` ｜ 文字动效 ${tms.slice(0, 8).join('/')}${tms.length > 8 ? ' …' : ''}`)
    if (fp.fixes.length) ctx.log?.(uid, '[日报落地页] 字体配对：' + fp.fixes.join('；'))
  } catch { /* ignore */ }
  // ★VF_DAILY_V22（用户定案「按 A 升级」）：**去同质化机器自检** —— 借 oil-ui 的硬规则
  //   「任意两个方向最多共享四项中的一项」。我们落在段落级：**相邻两段最多共享 1 项**
  //   （方向四元组 = 摆图法 / 文字层 / 取景 / 字号档）。不合格就**就地错开**，并如实报了几处。
  let divNote = ''
  try {
    const dv = checkDiversity(plan.segments, 1)
    if (!dv.ok) {
      const fx = fixDiversity(plan.segments, 1)
      divNote = `去同质化：错开 ${fx.fixed} 处` + (fx.left ? `（仍有 ${fx.left} 处相邻偏像，素材单一时限）` : '')
      try {
        ctx.log?.(uid, `[日报落地页] ${divNote} ｜ 方向组合 ${dv.distinct} 种（目标 ≥${dv.want}）`
          + (fx.msgs.length ? ' ｜ ' + fx.msgs.slice(0, 3).join('；') : ''))
      } catch { /* ignore */ }
    } else {
      try { ctx.log?.(uid, `[日报落地页] 去同质化自检：通过（相邻不撞；方向组合 ${dv.distinct} 种）`) } catch { /* ignore */ }
    }
  } catch { /* 自检失败不拦交付 */ }
  const fpPrev = await lastFp(ctx.prisma, uid)
  let sim = similarity(planFingerprint(plan, rot.theme), fpPrev)
  let rerollNote = ''
  for (let k = 1; k <= 2 && sim > 0.7; k++) {
    rerollPlan(plan, k)
    const s2 = similarity(planFingerprint(plan, rot.theme), fpPrev)
    if (s2 < sim) { sim = s2; rerollNote = `与上一份相似度 ${(sim * 100).toFixed(0)}% ⇒ 已重掷（效果序 + 单图段结构）` }
    else break
  }
  if (!rerollNote && fpPrev && sim > 0.7) rerollNote = `与上一份仍像 ${(sim * 100).toFixed(0)}%（素材/主题太接近时难免，可回「重选」换一批图）`
  await rememberFp(ctx.prisma, uid, planFingerprint(plan, rot.theme))
  try {
    ctx.log?.(uid, `[日报落地页] 多样性自检：与上一份相似度 ${(sim * 100).toFixed(0)}%`
      + (rerollNote ? ' ⇒ ' + rerollNote : '') + ' ｜ 效果序 ' + plan.segments.slice(0, 6).map((s: any) => s.fx).join('/'))
  } catch { /* ignore */ }
  try {
    ctx.log?.(uid, `[日报落地页] 皮肤 ${themeName(rot.theme)}${rot.rotated ? '（轮换：上次 ' + (themeName(rot.from) || '无') + '）' : ''}`
      + (recent.length ? ' ｜ 近几次：' + recent.slice(0, 3).map(themeName).join(' → ') : ''))
  } catch { /* ignore */ }
  // ★VF_DAILY_V15 · R5′：量每张图的平均亮度 ⇒ 按段定暗衬档（深色图不加暗衬，白字靠描边+阴影）
  try {
    const lums = await Promise.all(picks.map((p) => pickLum(p)))
    const byIdx = new Map<number, number>(picks.map((p, i) => [i + 1, lums[i]]))
    plan.segments.forEach((s: any) => { s.scrim = scrimFor((s.imgs || []).map((x: number) => byIdx.get(x) || 0)) })
    try {
      const noScrim = plan.segments.map((s: any, i: number) => (s.scrim === 'none' ? i + 1 : 0)).filter(Boolean)
      ctx.log?.(uid, `[日报落地页] R5′ 亮度 ${lums.map((v, i) => '#' + (i + 1) + '=' + v).join(' ')}`
        + ` ｜ 不加暗衬的段：${noScrim.join(',') || '无'}`)
    } catch { /* ignore */ }
  } catch { /* 量不到 ⇒ 全走 soft（保守） */ }
  attachSrc(plan, picks)
  d.plan = plan
  d.planBy = by
  d.planNote = note
  d.step = 'review'
  await saveDailyDraft(ctx.prisma, uid, d)
  try { ctx.log?.(uid, `[日报落地页] 方案已排（${by}，${plan.segments.length} 段，看图=${ai.sawImages ? '是' : '否' + (ai.vlErr ? '（' + ai.vlErr + '）' : '')}）`) } catch { /* ignore */ }
  // ★VF_DAILY_V6：**"没看成图"要如实写在卡上**（不然用户以为 AI 真看过素材了）
  const extra: string[] = []
  // ★VF_DAILY_V9：轮换过就**明说**（用户要能看见"这次跟上次不一样"，否则还是觉得像同款）
  if (rot.rotated) extra.push('皮肤轮换：上次「' + (themeName(rot.from) || '未记录') + '」→ 这次「' + themeName(rot.theme) + '」')
  // ★VF_DAILY_V22：去同质化自检动过手就如实说（用户要看得见"这次哪里不一样"）
  if (divNote) extra.push(divNote)
  // ★V13：把"多样性自检"的结果也如实写在卡上（用户要的正是"看着别像"）
  if (rerollNote) extra.push(rerollNote)
  if (note0) extra.push(note0.replace(/\*\*/g, ''))
  if (ai.ok && !ai.sawImages) extra.push('这轮没看成图：' + (ai.vlErr || '未知原因') + '（方案按主题/序号排，文案请自己核一遍）')
  // ★L2：AI 给的结构与图数打架 / 整份结构太单一 ⇒ 我校正过，**如实写进卡头**（不闷着改）
  if (ai.ok && ai.fixes && ai.fixes.length) {
    try { ctx.log?.(uid, '[日报落地页] 结构校正：' + ai.fixes.join('；')) } catch { /* ignore */ }
    extra.push('结构已校正：' + ai.fixes.slice(0, 2).join('；') + (ai.fixes.length > 2 ? ` 等 ${ai.fixes.length} 处` : ''))
  }
  return planOut(d, picks, by, note, extra.join(' · '))
}

/**
 * ★VF_DAILY_V28（2026-10-16 用户定案「4」修交付卡编辑后出片失效）：**凡是"要先重新生成一份"的情形，
 * 就把当前方案卡**一起**发出来**，别只回一句文字。
 * 病灶：在交付卡上点「✏️ 编辑」保存后，草稿会退回"方案确认"（**这是刻意的**，2026-10-13 定案：
 *   改完不偷偷重跑渲染，让用户自己点「✅ 生成 HTML」）。但**聊天记录里那张旧交付卡还在**、
 *   出片 / 配音按钮**依然可点** ⇒ 点下去老写法只回"还没生成 HTML（先点「✅ 生成 HTML」）"——
 *   **而"在哪点生成"用户看不到**（新方案卡可能已经被这轮消息顶到上面去了）。
 * 现口径：这种"因为方案改过才不能出片"的情况 ⇒ **把方案卡重新发一份**（附一句提示）⇒ 用户眼前
 *   立刻就有「✅ 生成 HTML」可点 ⇒ **闭环**。其余原因（旧单没单文件版等）仍按原样回文字。
 */
async function needRegen(ctx: DailyCtx, d: DailyDraft, why: string): Promise<string> {
  // ⚠️ `as string`：TS 在函数末尾那几处会把 `d.step` 收窄成 `'done'`（同 ★VF_DAILY_V26 那个坑），
  //   但草稿是**从 JSON 读回来的**、运行期确实可能是 `review` ⇒ 断言才与运行期一致。
  if ((d.step as string) === 'review' && d.plan) {
    const picks = toPicks(ctx.uid, d.source || { kind: 'repo' }, d.names || [])
    return planOut(d, picks, d.planBy || 'fallback', d.planNote || '',
      why + ' ⇒ **要先重新生成一份**（下面是当前方案，点「✅ 生成 HTML」就行）')
  }
  return why
}

/** 方案交付：**一律出方案卡**（第 2 步）。
 * ★VF_DAILY_V30（2026-10-16 用户定案「8」：本机/子目录来源在第 2 步只有一段文字、**没有卡片也没有编辑面板**）：
 *   老写法按**来源**分叉 —— repo 出卡、本机/子目录退回文字清单，理由写的是"没有缩略图可签"。
 *   但**方案卡根本不需要缩略图**（它显示的是「用图序号 + 素材文件名」，而 `picks` 这个参数在
 *   `buildPlanCardPayload` 里**一次都没用到** —— 已逐行核对）⇒ 那条理由不成立。
 *   而"退回文字清单"的代价是**实打实的**：没有卡片 ⇒ **没有「✏️ 编辑」面板**、只能靠打字改。
 *   第 1 步（选素材）需要缩略图，那是客观限制；第 2 步没必要跟着受罚。
 *   ⇒ 现口径：一律出卡（本机图的"能不能直接预览"只影响预览环节，不影响方案确认与编辑）。 */
function planOut(d: DailyDraft, picks: DailyPick[], by: PlanBy, note: string, hintExtra = ''): string {
  return 'VF_JSON:' + JSON.stringify(buildPlanCardPayload(d.plan, {
    picks, by, note, hintExtra, topic: d.topic || '',
    // ★VF_DAILY_V32：两个 AI 开关回显（卡片按它渲染复选框）
    aiLayout: !!d.aiLayout, aiPickSkin: !!d.aiPickSkin,
  }))
}

/**
 * ★VF_DAILY_L3/B（2026-10-12 用户定案「行 B」）：生成 → **真浏览器逐段体检** → 不合格的段**逐段退回 L2 模板** → 重生。
 * · 只在"有 AI 自写段"时才跑（纯模板件已离线全过，省 3~8 秒）；
 * · 体检硬线只认**竖屏**（用户口径：竖屏为主），横屏结果只记日志；
 * · 没装校验器 / 没浏览器 ⇒ **跳过体检并如实说明**（绝不因为体检环境缺失就把交付拦下）；
 * · 最多重来 3 轮（每轮只动不合格的段），仍不过就按最佳结果交付并写清哪几段没过。
 */
async function generateVerified(ctx: DailyCtx, plan: any): Promise<{ ok: boolean; buf?: Buffer; name?: string; note: string; dropped: string[]; error?: string }> {
  const repo = vfRootDir() || process.cwd()   // ★VF_ROOT_V1：同上（别用 process.cwd()）
  const verifier = path.join(repo, 'scripts', 'video-factory', 'html-deck', 'tools', 'daily-verify.mjs')
  const hasAI = Array.isArray(plan?.segments) && plan.segments.some((s: any) => s && typeof s.html === 'string' && s.html.trim())
  const dropped: string[] = []
  let note = ''
  for (let round = 0; round < 3; round++) {
    const g = generateDailyHtml(ctx.uid, plan)          // 只出到临时文件（还没落盘）
    if (!g.ok || !g.name) return { ok: false, note, dropped, error: g.error }
    const tmp = g.name
    note = String(g.note || '').trim()
    const store = async () => {
      try {
        const buf = fs.readFileSync(tmp)
        const saved = await saveToPersonalRepo({ userId: ctx.uid, buffer: buf, ext: 'html', mime: 'text/html', gen: true })
        return { ok: true, buf, name: saved.name, note, dropped }
      } catch (e: any) {
        return { ok: false, note, dropped, error: String(e?.message || e).slice(0, 200) }
      } finally { try { fs.unlinkSync(tmp) } catch { /* ignore */ } }
    }
    if (!hasAI || !fs.existsSync(verifier)) {
      if (hasAI) note += '（未装渲染校验器，跳过体检）'
      return await store()
    }
    const r = spawnSync(process.execPath, [verifier, tmp, '--json'], { cwd: repo, encoding: 'utf8', timeout: 180000, maxBuffer: 16 * 1024 * 1024 })
    if (r.status === 2) {
      note += '（渲染体检未启用：' + String(r.stdout || r.stderr || '').trim().split('\n')[0].slice(0, 80) + '）'
      return await store()
    }
    let parsed: any = null
    try { parsed = JSON.parse(String(r.stdout || '').trim().split('\n').filter(Boolean).pop() || '') } catch { parsed = null }
    if (!parsed) { note += '（体检结果解析失败，按现值交付）'; return await store() }
    const bad: any[] = (parsed?.views?.v?.segs || []).filter((s: any) => !s.ok)
    try { ctx.log?.(ctx.uid, `[日报落地页] 渲染体检 第${round + 1}轮：竖屏不合格 ${bad.length} 段` + (bad.length ? '（' + bad.map((b: any) => `段${b.seg}: ` + (b.reasons || []).join('；').slice(0, 70)).join(' | ') + '）' : '')) } catch { /* ignore */ }
    if (!bad.length) return await store()
    let healable = 0
    for (const b of bad) {
      const seg = plan?.segments?.[Number(b.seg) - 1]
      if (seg && typeof seg.html === 'string' && seg.html.trim()) {
        dropped.push(`段${b.seg}（${(b.reasons || []).join('；').slice(0, 70)}）`)
        delete seg.html
        delete seg.css
        healable++
      }
    }
    if (!healable || round === 2) {
      note += '（仍有 ' + bad.length + ' 段未过体检：' + bad.map((b: any) => '段' + b.seg).join('、') + '）'
      return await store()
    }
  }
  return { ok: false, note, dropped, error: '体检回落轮次用尽' }
}

/**
 * ★VF_DAILY_V8（2026-10-13 用户原话「纯 HTML 打开都看不到图片 是否需要一个文件夹包才可以」）：
 *   再出一份**单文件版**——把 `images/N.jpg` 引用换成**内嵌 base64** ⇒ 打开预览/双击文件就能看到真图，
 *   不用建 `images/` 文件夹、发人也只发一个文件（代价是文件变大，所以带上限：超预算的图不嵌）。
 *   取图：本机素材直接读文件；仓库素材走 OSS 签名地址 fetch（600 秒够用）。
 *   失败**不影响**交付（调用方兜住，回落到"配图版"）。
 */
/**
 * ★VF_DAILY_V19（2026-10-13 用户拍板「A 执行」= 本地镜像 + 同级扁平图）：
 *   把所选 N 张素材**入库成同级扁平名**（`gen_日期_序号.jpg`，不带子目录）—— 这样：
 *     · HTML 与图在**同一个平铺文件夹**里 ⇒ 客户端镜像拍平也照样能一起落地、相对引用天然可解析；
 *     · 三个"禁 `/`"的接口（读/删/短链）都能过 ⇒ 图能被取到、能删、能发人。
 *   取图：本机素材直接读文件；仓库素材走 `getObject`（**不是**签名 URL + fetch，少一次网络往返）。
 *   失败**不拦交付**：取不到的那张留空名 ⇒ 引擎回落老口径（占位色块），卡上如实报"入库 x/N"。
 */
async function publishPickedImages(uid: number | string, picks: DailyPick[]): Promise<string[]> {
  const out: string[] = []
  for (let i = 0; i < picks.length; i++) {
    const p = picks[i]
    let buf: Buffer | null = null
    try {
      if (p.local && p.abs && fs.existsSync(p.abs)) buf = fs.readFileSync(p.abs)
      else {
        const { getObject } = await import('@/lib/oss')
        buf = await getObject(p.key)
      }
    } catch { buf = null }
    if (!buf || !buf.length) { out.push(''); continue }
    const png = buf[0] === 0x89 && buf[1] === 0x50
    try {
      const saved = await saveToPersonalRepo({
        userId: uid, buffer: buf, ext: png ? 'png' : 'jpg',
        mime: png ? 'image/png' : 'image/jpeg', gen: true,
      })
      out.push(String(saved?.name || ''))
    } catch { out.push('') }
  }
  return out
}

async function buildSingleFile(uid: number | string, buf: Buffer | undefined, picks: DailyPick[], refOf?: (n: number) => string): Promise<{ name: string; embedded: number } | null> {
  if (!buf || !buf.length || !picks.length) return null
  const imgs: Array<{ n: number; mime: string; b64: string; bytes: number; ref?: string }> = []
  for (let i = 0; i < picks.length; i++) {
    const p = picks[i]
    let b: Buffer | null = null
    try {
      if (p.local && p.abs && fs.existsSync(p.abs)) b = fs.readFileSync(p.abs)
      else {
        /* ★VF_DAIDESIGN_V1e（2026-10-17 用户实测「视频里很多段没有图片」→ 查实：单文件版只内嵌了 1 张）：
           原来走 `signedUrl` + `fetch`（**多一跳 HTTP**）。线上实测：同一批 17 张图**只读到 1 张**
           ⇒ 其余走 `continue` ⇒ 单文件版缺图（出片**不报错**，只是画面空 —— 用户看到的正是这个）。
           而 `publishPickedImages`（**同一批图、同一时刻**）走 OSS SDK `getObject` **全部成功**
           ⇒ SDK 路径稳、HTTP 路径不稳。现口径：**优先 `getObject`**，失败才退回 fetch。 */
        try {
          const { getObject } = await import('@/lib/oss')
          b = await getObject(p.key)
        } catch {
          const { signedUrl } = await import('@/lib/oss')
          const u = await signedUrl(p.key, 600)
          const res = await fetch(u)
          if (res.ok) b = Buffer.from(await res.arrayBuffer())
        }
      }
    } catch { b = null }
    if (!b || !b.length) continue
    // ★V16：**先压再嵌**（否则超 12MB 预算的后半段图会被跳过 = 用户看到的"部分图没有"）
    // ★VF_DAILY_V34（2026-10-16 用户实测「458s 后 stage=render ✗ RegExpExecMultiple」）：
    //   原来只有 **>900KB** 的图才压 ⇒ 500~900KB 的图**原样内嵌**，16 张就是十几兆
    //   ⇒ 单文件版 **9.9MB** ⇒ 引擎侧对**超长字符串做正则**时把 Node 撑爆
    //   （`v8::internal::Runtime_RegExpExecMultiple`，且崩溃点在"浏览器已启动"之后 ⇒ 不是渲染失败，是打包/喂页面那步炸的）。
    //   现口径：**阈值降到 380KB**（超过就压）—— 宁可多压一次，也不要页面胖。
    if (b.length > 380 * 1024) b = await shrinkForEmbed(b)
    const png = b[0] === 0x89 && b[1] === 0x50
    // ★V19（A′）：内嵌也要按**同一套引用名**替换（配图版用的是同级扁平名，不再写死 images/N.jpg）
    imgs.push({
      n: i + 1, mime: png ? 'image/png' : 'image/jpeg', b64: b.toString('base64'), bytes: b.length,
      ref: (refOf && refOf(i + 1)) || `images/${i + 1}.jpg`,
    })
  }
  if (!imgs.length) return null
  /* ★VF_DAILY_V35（2026-10-16 从仓库取件实测确认）：**同一张图只内嵌一份**。
     实测读数：`页面 10.62 MB · 内嵌 38 张 · 全 jpeg · 平均 214 KB/张`
       ⇒ **压图本身完全正常**（214KB 正是预期）；真因是 **17 张素材被引用 38 次**，
         而 `embedImages` 是**按引用名逐点替换**的 ⇒ 每个引用点塞一份完整 base64 ≈ 8.1MB。
     为什么切分型不重复：`slats`/`blinds`/`mosaic` 用 `:root` 里**只声明一次**的 CSS 变量
       （`daily-page.mjs:518-522` 的注释就写着这件事）。
     现口径（三步）：
       ① 每张图的 base64 收进**一张共享表** `window.__IMGS`（整个页面只出现一份）；
       ② 内嵌前把**普通图** `<img …>` 里的 `src` 换成占位（`__IMG6__`）——这样 `embedImages`
          **匹配不到引用名 ⇒ 不会重复塞**；页面里一小段脚本再把 `img[data-img]` 的 src 指到共享表；
       ③ **切分型的 `--imgN` 照旧**交给 `embedImages` 替换（它在 :root 里只一处，本来就不重复）。
     ⚠️ 正则**只处理 `<img …>` 标签**，绝不碰切分型的 `--img1:url(gen_…)` 声明。
     （★V37 备注：这段"共享表"方案也已撤回 —— 下面那条 V37 注释说明了原因。）
     ⚠️ 共享表放在 `</body>` 前，脚本同步执行 ⇒ 引擎逐帧截图时 src 早已就位。 */
  /* ★V35 / V36 的"占位 + 脚本换 src"**都已撤回**（V37，见下）——这里只留最终口径。 */
  /* ⚠️⚠️ ★VF_DAILY_V37（2026-10-16 用户实测「stage=check ✗ missing_local_asset: __IMG8__, __IMG4__ …」）：
     **V35/V36 的"占位 + 加载后用脚本换 src"行不通，已撤回。**
     原因：**引擎的静态校验会检查 `<img>` 引用的本地文件是否存在，而它读的是源码**
     （看到 `src="__IMG8__"` 就判"引用了项目里没有的文件"）⇒ 出片在 **check 阶段**就失败；
     而"加载后再把 src 换成图片数据"这招救不了 —— **校验发生在加载之前**。
     现口径：**普通图恢复逐个内嵌**（校验能过）；体积问题改为**在源头压小**
     （见 `shrinkForEmbed` 的质量档）。
     ✅ 真正的正道（图改用 CSS 背景、像"切分型"那样天然只存一份）已记进 ISSUES，
        那条做完就不必再靠压质量换体积了。 */
  const html = buf.toString('utf8')
  // 预算放到 24MB（压过之后 10 张通常只有 3~5MB；这只是"最后一道保险"，不要它再成为丢图原因）
  const rc = embedImages(html, imgs, 24 * 1024 * 1024)
  if (!rc.embedded) return null
  const saved = await saveToPersonalRepo({ userId: uid, buffer: Buffer.from(rc.html, 'utf8'), ext: 'html', mime: 'text/html', gen: true })
  return { name: String(saved?.name || ''), embedded: rc.embedded }
}

/* ═══ ★VF_DAIDESIGN_V1（阶段 1 第 4 步，2026-10-17）：**AI 自由档** —— AI 整页写 HTML，其余交付链路复用 ═══
   流程：aiDesignPage（**先读图** → 出整页 HTML）→ 适配（图名归一 / 字体名 → 自造名 / 注入 base64 @font-face）
        → 造一个"最小 plan"（只为交付卡的段数统计）→ `finishDaily(prebuilt)` 走完交付
        （图入库 / 单文件版 / 交付卡 / 出片 / 配音**全部复用**，一行不用改）。
   ⚠️ 适配逻辑与 `scripts/video-factory/html-deck/tools/adapt-ai-page.mjs` **同口径**（那边给 CLI/实验用）。
   ⏳ 本轮**未做**"闸门报错自动回喂 AI 重写"：一次要 3~5 分钟，且**还没有真实失败样本**可依。
      先让入口能用，出片时 `daily-film.mjs` 会把溢出/缺图/越界**如实点名**（V8 起失败还会留 render.log）
      ⇒ 拿真样本再补重试策略，比凭空设计稳。 */
/* ★VF_DAIDESIGN_V2（2026-10-18 用户实测「content_overlap + 对比度 1.8:1」后定案「修吧」）：
   **修错循环** —— AI 出页面 → 跑四道闸门 → 不过就把**报错原文**喂回去，只让它改那几处 → 最多 3 轮。
   为什么这是必需的（不是可选）：AI 自由排版时"字压字 / 对比度不足"是**必然偶发**，提示词防不住；
   但闸门能**精确点名是哪两个元素**（`div.bc > span:nth-of-type(3)` 压到 `div.loc`），所以改起来很准。
   3 轮仍不过 ⇒ **回落模板档**（`d.plan` 还是方案卡那份，没被覆盖），并**如实报** AI 版的报错原文 ——
   绝不给黑片、也不假装成功。 */
async function runDesignRetry(ctx: DailyCtx, d: DailyDraft, picks: DailyPick[]): Promise<string> {
  const uid = ctx.uid
  const topic = String(d.topic || '')
  let failNote = ''
  let lastErr = ''
  /* ★VF_DAIDESIGN_V2b（2026-10-18 用户实测「网络连接失败」→ 服务器 `/etc/nginx/conf.d/ai-niuma.cc.conf`
     配的是 `proxy_read_timeout 600s`）：**总预算 500s**，保证一定在网关掐断前返回。
     为什么必须加：3 轮跑满 = 3×(162s 生成 + 30s 闸门) ≈ 600s ⇒ 必然撞上 600s 上限 ⇒
     用户看到的是"网络连接失败"（**看起来像崩了，其实是被网关断掉**），而且**白等 10 分钟、什么也没拿到**。
     现口径：剩余时间不足 90s 就不再开新一轮（开了也出不来），把已拿到的报错如实带出去。 */
  /* ★VF_DAIDESIGN_V4（2026-10-19 用户实测「AI 自由设计 又 网络连接失败」）：
     病根：**预算只算了"生成"，没算"闸门"** ——
       · 单轮生成上限 240s，闸门（打包+用字+引擎校验）每轮还要 30~60s
       · 3 轮最坏 = 3×240 + 3×60 = **900s** ⇒ 远超 nginx `proxy_read_timeout 600s` ⇒ 504 ⇒ 前端只看到"网络连接失败"
       · 且换成 `deepseek-v4-pro` 后单轮实测 **152s**（比 qwen 慢一倍）⇒ 3 轮必超
     现口径（**保证 600s 内一定返回**）：
       · **轮次 3 → 2**（第 1 轮就过的情况占多数；第 2 轮仍挂说明是 AI 真排版问题，第 3 轮也救不回来）
       · **总预算 500s → 420s**，且每轮判断时**预留 100s 给闸门**
       · 单轮生成上限 240s → **170s**（152s 实测 + 余量）
     ⇒ 最坏 2×(170 + 60) = **460s**，稳在 600s 内。 */
  const T0 = Date.now()
  const BUDGET_MS = 420000
  for (let attempt = 1; attempt <= 2; attempt++) {
    const left = BUDGET_MS - (Date.now() - T0)
    if (left < 90000) {
      lastErr = (lastErr ? lastErr + '\n' : '') + '（已到总时长预算 ' + Math.round(BUDGET_MS / 1000) + 's，停止重试）'
      break
    }
    // ★VF_DAIDESIGN_V4：单轮时长要**给闸门留 80s**（打包/用字/引擎校验约 30~60s）——
    //   原来只留 20s ⇒ 生成吃满后闸门没时间、整轮白跑，最后整体超时被网关掐断。
    const design = await aiDesignPage(picks, topic, { failNote, timeoutMs: Math.min(DESIGN_TIMEOUT_MS, left - 80000) })
    try {
      ctx.log?.(uid, '[日报落地页] AI 自由设计 第' + attempt + '轮：' + (design.ok ? 'OK' : '失败')
        + ' ｜ ' + String(design.diag || '') + (design.vlErr ? ' ｜ 读图：' + design.vlErr : ''))
    } catch { /* ignore */ }
    if (!design.ok || !design.html) { lastErr = String(design.error || '未知原因'); failNote = ''; continue }

    // 字体适配（必须在 check 前：服务器无 CJK ⇒ 不换字体会误报对比度/溢出）
    let html = String(design.html)
    html = html.replace(/["']?TXT-Serif["']?/g, '"NotoSerifSC"').replace(/["']?TXT-Sans["']?/g, '"NotoSansSC"')
      .replace(/"Noto Serif SC"/g, '"NotoSerifSC"').replace(/"Noto Sans SC"/g, '"NotoSansSC"')
    if (!/@font-face/.test(html)) {
      try {
        const fdir = path.join(vfRootDir(), 'scripts', 'video-factory', 'html-deck', 'fonts')
        const face = (fname: string, f: string, w: string) => {
          const fp = path.join(fdir, f)
          if (!fs.existsSync(fp)) return ''
          return '@font-face{font-family:"' + fname + '";src:url(data:font/woff2;base64,'
            + fs.readFileSync(fp).toString('base64') + ') format("woff2");font-weight:' + w + ';font-display:block}'
        }
        const faces = face('NotoSerifSC', 'NotoSerifSC-sub.woff2', '200 900')
          + face('NotoSansSC', 'NotoSansSC-sub.woff2', '100 900')
        if (faces) html = html.replace(/<\/style>/i, '\n' + faces + '\n</style>')
      } catch { /* 注入失败就退系统字体 */ }
    }

    // ⭐ 闸门：不过就把报错原文交给下一轮
    const chk = await checkDesignPage(html, picks, 'r' + attempt)
    try {
      ctx.log?.(uid, '[日报落地页] AI 自由设计 第' + attempt + '轮闸门：' + (chk.ok ? '✅ 通过' : '✗ 未过\n' + chk.note))
    } catch { /* ignore */ }
    if (!chk.ok) { lastErr = chk.note; failNote = chk.note; continue }

    // 通过 ⇒ 预览兜底 + 最小 plan ⇒ 交付（以下与 runDesign 成功路径一致）
    if (!/data-mode=/.test(html)) html = html.replace(/<html\b/i, '<html data-mode="preview"')
    if (!/id="ai-preview-guard"/.test(html)) {
      const guard = '<style id="ai-preview-guard">'
        + 'html:not([data-mode="film"]),html:not([data-mode="film"]) body{height:auto!important;overflow-y:auto!important;background:#000}'
        + 'html:not([data-mode="film"]) body>*{height:auto!important;max-height:none!important;overflow:visible!important}'
        + 'html:not([data-mode="film"]) .stage,html:not([data-mode="film"]) #stage{height:auto!important;overflow:visible!important}'
        + 'html:not([data-mode="film"]) .sec{display:flex!important;visibility:visible!important;'
        + 'position:relative!important;inset:auto!important;left:auto!important;top:auto!important;'
        + 'width:720px!important;height:1280px!important;overflow:hidden!important;opacity:1!important;margin:0 auto 12px}'
        + '</style>'
        + '<script id="ai-preview-guard-js">(function(){'
        + 'var root=document.documentElement;if(root.getAttribute("data-mode")==="film")return;'
        + 'function boot(){var secs=[].slice.call(document.querySelectorAll(".sec"));if(!secs.length)return;'
        + 'for(var i=0;i<secs.length;i++){var s0=secs[i];'
        + 's0.style.visibility="visible";'
        + 'if(window.getComputedStyle(s0).display==="none")s0.style.display="flex";'
        + 'var a=s0.parentElement;'
        + 'while(a&&a!==document.body){a.style.overflow="visible";a.style.height="auto";a.style.maxHeight="none";a=a.parentElement;}'
        + 'if(a){a.style.overflowY="auto";a.style.height="auto";}}'
        + 'var t0=[],wasIn=[];'
        + 'function tick(){var vh=window.innerHeight||1280;'
        + 'for(var i=0;i<secs.length;i++){var s=secs[i],r=s.getBoundingClientRect();'
        + 'var inView=(r.top<vh*0.85)&&(r.bottom>0);'
        + 'if(inView&&!wasIn[i]){wasIn[i]=true;t0[i]=window.performance.now();}'
        + 'if(!inView){wasIn[i]=false;t0[i]=null;}'
        + 'var du=(+s.dataset.duration||3)*1000;'
        + 'var p=(t0[i]==null)?0:Math.min(1,(window.performance.now()-t0[i])/du);'
        + 's.style.setProperty("--p",String(p));}'
        + 'window.requestAnimationFrame(tick);}'
        + 'window.requestAnimationFrame(tick);}'
        + 'if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot);else boot();'
        + '})();</script>'
      html = /<\/head>/i.test(html)
        ? html.replace(/<\/head>/i, guard + '\n</head>')
        : (/<\/body>/i.test(html) ? html.replace(/<\/body>/i, guard + '\n</body>') : html + guard)
    }
    const secN = Math.max(1, (html.match(/<section[^>]*\bclass="[^"]*\bsec\b/g) || []).length)
    d.plan = { meta: { theme: '' }, segments: Array.from({ length: secN }, () => ({ layout: 'free', title: ['', ''] })) } as any
    d.planBy = 'ai'
    try { ctx.log?.(uid, '[日报落地页] AI 自由设计：第' + attempt + '轮过闸门 · ' + secN + ' 段') } catch { /* ignore */ }
    return await finishDaily(ctx, d, picks, { html })
  }
  // 3 轮都不过 ⇒ 回落模板档（d.plan 仍是方案卡那份，没被覆盖）
  try { ctx.log?.(uid, '[日报落地页] AI 自由设计：3 轮均未过闸门 ⇒ 回落模板档。最后一次报错：' + lastErr) } catch { /* ignore */ }
  /* ★VF_DAILYEDIT_V3（2026-10-19 用户实测「**吐字不是卡片**」）：原来这里把**提示文字拼在 `VF_JSON` 前面**：
       `'⚠️ AI 版连续 3 轮没过闸门…' + 报错 + await finishDaily(...)` ⇒ 整条回复**以 ⚠️ 开头** ⇒
       前端 `content.startsWith('VF_JSON:')` 判否 ⇒ **降级成纯文本**（用户看到"文字 + 一坨裸 JSON"）。
       现口径：**先拿到卡片串，再把提示塞进卡片的 `hint` / `aiFailNote` 字段** ⇒ 整条回复仍是**纯 `VF_JSON`**，
       卡片正常渲染，提示也不丢（显示在卡片顶部）。
       ⚠️ 不调 `finishDaily` 的签名（避免牵连模板档），只在它返回的 JSON 里注入字段。 */
  const cardStr = String(await finishDaily(ctx, d, picks) || '')
  const PREFIX = 'VF_JSON:'
  if (cardStr.startsWith(PREFIX)) {
    try {
      const j = JSON.parse(cardStr.slice(PREFIX.length))
      const why = '⚠️ AI 版 3 轮没过闸门，已自动改用模板版'
      j.hint = why + ' · ' + String(j.hint || '')
      if (lastErr) j.aiFailNote = String(lastErr).slice(0, 600)
      return PREFIX + JSON.stringify(j)
    } catch { return cardStr }
  }
  // 兜底（极端情况拿到的不是卡片）：至少把提示带上
  return '⚠️ AI 版 3 轮没过闸门，已自动改用模板版：\n' + (lastErr || '（无报错信息）') + '\n\n' + cardStr
}

async function runDesign(ctx: DailyCtx, d: DailyDraft, picks: DailyPick[]): Promise<string> {
  const uid = ctx.uid
  const design = await aiDesignPage(picks, String(d.topic || ''))
  try {
    ctx.log?.(uid, '[日报落地页] AI 自由设计：' + (design.ok ? 'OK' : '失败') + ' ｜ ' + String(design.diag || '')
      + (design.vlErr ? ' ｜ 读图：' + design.vlErr : ''))
  } catch { /* ignore */ }
  if (!design.ok || !design.html) {
    return '⚠️ AI 自由设计这轮没成功：' + String(design.error || '未知原因')
      + '\n（想稳妥出片就点「✅ 生成 HTML」走模板版；或再点一次「🎨 AI 自由设计」重试）'
  }
  /* ⚠️ ★VF_DAIDESIGN_V1b（2026-10-17 用户实测「单文件版没生成、出片按钮变灰」）：
     **这里绝不能再调 `publishPickedImages`** —— 它会给同一批图另生成一套名字，
     而 `finishDaily` 内部还会上传一次 ⇒ 两套名字 ⇒ 页面里写的是旧的、单文件版拿新的去匹配 ⇒ 0 匹配。
     图名替换已整体移进 `finishDaily`（在它拿到 `imageNames` 之后做）。
     本函数只负责与"图名"无关的适配：**字体**。 */
  let html = String(design.html)
  html = html.replace(/["']?TXT-Serif["']?/g, '"NotoSerifSC"').replace(/["']?TXT-Sans["']?/g, '"NotoSansSC"')
    .replace(/"Noto Serif SC"/g, '"NotoSerifSC"').replace(/"Noto Sans SC"/g, '"NotoSansSC"')
  if (!/@font-face/.test(html)) {
    try {
      const fdir = path.join(vfRootDir(), 'scripts', 'video-factory', 'html-deck', 'fonts')
      const face = (fname: string, f: string, w: string) => {
        const p = path.join(fdir, f)
        if (!fs.existsSync(p)) return ''
        return '@font-face{font-family:"' + fname + '";src:url(data:font/woff2;base64,'
          + fs.readFileSync(p).toString('base64') + ') format("woff2");font-weight:' + w + ';font-display:block}'
      }
      const faces = face('NotoSerifSC', 'NotoSerifSC-sub.woff2', '200 900')
        + face('NotoSansSC', 'NotoSansSC-sub.woff2', '100 900')
      if (faces) html = html.replace(/<\/style>/i, '\n' + faces + '\n</style>')
    } catch { /* 注入失败就退系统字体（服务器会豆腐块）——日志里能看出来 */ }
  }
  /* ② 预览态兜底（★VF_DAIDESIGN_V1b，用户实测「预览只看到一张照片」）：
     AI 页的段全是 `position:absolute; inset:0`，而它只在加载时调过一次 `__seek(0)`
     ⇒ **12 段全部叠在一起**（最上面那张盖住一切）⇒ 用户以为页面坏了。
     引擎出片**不受影响**（按 `data-start` 的 clip 时间轴管显隐），**只有浏览器预览会这样**。
     现口径：标 `data-mode="preview"` + 一条只在**非 film** 生效的规则 ⇒ 预览默认只显示第 1 段。
     ⚠️ 安全性：`daily-film.mjs` 打包时本就会把 `data-mode="preview"` 改成 `film`（老机制）⇒ 出片时该规则失效。 */
  if (!/data-mode=/.test(html)) html = html.replace(/<html\b/i, '<html data-mode="preview"')
  if (!/id="ai-preview-guard"/.test(html)) {
    /* ★VF_DAIDESIGN_V1c（2026-10-17 用户实测「在卡里预览还是只有一个图、没滚轮」）：
       上一版 guard 只显示第 1 段 ⇒ 用户看到的**还是一张图**（虽然不再是叠团）。
       现口径：预览态把段改成**纵向堆叠**（`position:relative` + 固定 1280 高、容器高度放开）
       ⇒ **能滚动看完全部段**；出片时 `data-mode` 变 `film` ⇒ 这些规则全部失效，引擎照旧按 clip 排。
       ⚠️ 不做"自动逐段播放"：那要 rAF/时钟，引擎 check 会判 `non_deterministic_code`
         （模板页是靠打包时把 rAF 打桩才做到的）—— 自由档不引入这个复杂度，预览用滚动就够。 */
    /* ★VF_DAIDESIGN_V1d（2026-10-17 用户实测「还是只有一张图，这次连文字都没有了」）：
       **guard 忘了把 `--p` 抬起来**。AI 页所有文字/图层的透明度都写成
       `opacity: clamp(0, calc(var(--p) * 3), 1)`，而 `__seek(0)` 把每段的 `--p` 都设成 **0**
       ⇒ 文字**全透明**（用户："连文字都没有"），只剩封面那张不受 `--p` 控 opacity 的图
       ⇒ 观感"只有一张图"。
       现口径：预览态给每段 `--p:1`（CSS `!important` 压内联 + `load` 后补一次内联，双保险）
       ⇒ **每段都完整呈现**（文字/图全在），配合纵向堆叠即可滚动看完全部段。
       ⚠️ 出片时 `daily-film.mjs` 把 `data-mode` 改成 `film` ⇒ CSS 规则失效，且下面那段 JS
          第一行就 `return` ⇒ **出片路径完全不受影响**（引擎仍按 `data-start` 的 clip + `__seek(t)` 驱动）。 */
    /* ★★ ★VF_DAIDESIGN_V2（2026-10-17 **量出来之后**才改，不再猜）★★
       事实（本地用 puppeteer 量真产物 187，逐段读数）：`12 段 · 每段 1280 高 · --p 全=1 · 每段都有可见文字 · 11/12 段图已加载`
       ⇒ **页面本身完全正常**，问题在"预览根本没有播放器"：
         · **模板页（daily-page.mjs）在预览态有 rAF 循环**（`__seek(t)` 推时间）⇒ 能自动一段段过完；
         · **AI 自由页只在加载时调了一次 `__seek(0)`** ⇒ **永远停在第 1 段** ⇒ 用户看到"一张照片、滚不动"
           （预览框是固定一屏 `720×1280`，看第 1 段当然就是一张封面图）。
       前几轮我一直在改"布局/滚动"（堆叠、overflow、--p）——**方向错了**。正解是**给 AI 页装同款播放器**：
       按 `data-start/data-duration` 循环推 `--p` + 只让"当前段"可见。
       ⚠️ 出片零影响：① `data-mode` 打包时变 `film` ⇒ 第一行就 return；② `daily-film.mjs` 打包时本就会把
          `requestAnimationFrame` 全替换成 `__noopRaf`（模板页正是靠这条才敢用 rAF）⇒ 出片时它也跑不起来。 */
    /* ★★ ★VF_DAIDESIGN_V3（2026-10-17 **截图 + 代码双证**之后定案，V2 的播放器方案作废）★★
       铁证（用户给的 `gen_20261017_206.html`）：
         · 截图：只有第 1 段（封面火锅图），段 2 以后看不见、总高只有 1292 ⇒ 不能滚；
         · 代码：AI 自己的 CSS 是 `.sec{position:absolute;inset:0;display:none;flex-direction:column;...}`
           —— **它用 `display:none` 做段显隐**，而 V1c/V1d/V2 的 guard 只覆盖了 `position`/`opacity`
           ⇒ 段 2 以后仍是 `display:none` ⇒ **高度 0** ⇒ 只剩第 1 段。
         · AI 每次写法都不同（187 那份就没这个问题）⇒ guard **必须同时覆盖 display**，否则随机复现。
      现口径（**最确定的一种**）：预览态把段**纵向堆叠成一条长页**（可滚，一次看完全部段），
        并**强制** `display:flex!important`（压掉 `display:none`）+ `--p:1!important`（压掉"入场中"的透明）。
        **不再注入播放器**（V2 那版作废）：AI 自己有时也会写显隐脚本，两个播放器会打架；
        堆叠是纯 CSS，AI 写什么都压得住。
        ⚠️ 出片零影响：`daily-film.mjs` 打包时把 `data-mode="preview"` 改成 `film` ⇒ 整段规则失效。 */
    /* ★VF_DAIDESIGN_V5（2026-10-17 实测 225）：段都 1280 高、display 全 flex、图也都在，
       但 `scrollHeight` 仍只有 1280 ⇒ **被某个外层容器裁住**（AI 不一定叫 `.stage`，可能是 `.wrap/.page/.container`）。
       现口径：直接放开 `body` 的**任意直接子元素**（高度自适应 + 不裁）—— 比猜类名稳。 */
    /* ★★★ ★VF_DAIDESIGN_V7（2026-10-17 用户定案「**不要管 AI 怎么写，你要管你怎么获取**」）★★★
       前六版 guard 全在"改页面/抹平动效"（强制 `display:flex`、强制 `--p:1`、纵向堆叠）
       ⇒ 后果正是用户说的两件事：**预览里"连一点动效都没有了"**（244，每段被钉在终态）、
         而**出片是空片**（`film` 态整套规则失效 ⇒ 回到 AI 的 `.sec{display:none}`）。
       现口径（**唯一正确的事：驱动，不改造**）：
         · **完全不碰 AI 的 CSS / 版式 / 动效**（不再有任何 `!important` 改造）；
         · 包一层 `window.__seek(t)`：① 按 `data-start/duration` 推每段 `--p`（**按时间推、绝不钉 1** ⇒ 动效保留）；
           ② 按时间切 `display`（当前段用它**原本该有的** display，其余 `none`）——
              因为 AI 常写 `.sec{display:none}` 却没写"谁来切"，而引擎只按 `data-start` 排帧、**不会替你改 display**
              ⇒ 不接管就必然是空片（`246.mp4` 就是这么空的）；
         · **预览态**（非 film）自己用 rAF 循环推时间 ⇒ **像视频一样自动播 10 段，动效完整**；
         · **出片态**（film）不自己推时间，只由引擎调 `__seek(t)` ⇒ 走**同一份 apply 逻辑** ⇒ 预览与成片一致。
       安全性：`daily-film.mjs` 打包时本就会把 `requestAnimationFrame` 全替换成 `__noopRaf`（模板页同款）⇒ 出片时预览循环自动失效。
       ⚠️ 位置必须插在 `</head>` 之前（`<style>` 之外）——插在 `</style>` 前会 style 嵌套、CSS 全失效（V4 的血教训）。 */
    /* ★★★ ★VF_DAIDESIGN_V8（2026-10-17 用户定案「**265 按 018 方式展示预览**」）★★★
       018 的预览是什么（代码）：`.sec{--sp:1}`（段在**文档流**里）+ `body{overflow-y:auto}`（**能滚**）
         + `--sp` 24 处 ⇒ **滚着看，滚到哪段，那段就在播动效**。
       265 的预览是什么：`.sec{position:absolute;...;opacity:clamp(0,var(--p)*6,1)}` + `body{overflow:hidden}`
         ⇒ 14 段**全叠在一屏、不能滚**，只能靠时间一个个切出来。
       我前两版各错一半：V1c~V6 **铺开了但钉死 `--p:1`**（动效没了）；
                       V7 **改成播放器**（动效回来但不能滚）。
       现口径（**两者合体，就是用户要的 018 形态**）：
         · **铺开**（纯 CSS，只在非 film 生效）：段 `position:relative` + 固定 1280 高 + `display:flex`（压掉 AI 的
           `display:none`）+ `opacity:1`（压掉 AI 的"整段随 --p 透明"）+ 沿祖先放开 `overflow/height`（不猜类名/层数）；
         · **`--p` 由"段在视口里的可见度"驱动**（滚到哪段 → 它的 `--p` 从 0 走到 1）⇒ 动效随滚动播，**绝不钉 1**；
         · **出片态（film）一个字都不动** —— 由引擎 `data-start` + `__seek(t)` 驱动（引擎本来就推 `--p`）。
       安全性：用 rAF 轮询（不挂 scroll 监听，避免被"滚动触发"类判据误伤）；而 `daily-film.mjs` 打包时本就会把
         `requestAnimationFrame` 全替换成 `__noopRaf`（模板页同款）⇒ 出片时这套预览逻辑自动失效。 */
    /* ★★★ ★VF_DAIDESIGN_V9（2026-10-17 用户定案「**日报预览必须是滚轮，和现在一样不能改**」）★★★
       铁证（304 模板档 vs 284 AI 档）：
         · 304：`.sec{--sp:1}`（**文档流**）+ `body` 可滚 + `--sp`×24 ⇒ **滚轮，滚到哪段播哪段**；
         · 284：`.sec{position:absolute;inset:0}`（**全叠一屏**）+ `body` 不可滚 ⇒ 原生是"播放型"。
       用户要求：**预览必须是滚轮**（像 304 那样），**成片用引擎时间驱动**（这个已验通，见 exp284 45s 成片）。
       V8 的病：把 `--p` 映射成"段在视口的位置"⇒ 段一进屏 `--p` 就跳到大半 ⇒ **动效看起来没了**。
       V9 的正解（**`--p` 语义一个字不改**，只改"时间的起点"）：
         · **铺开**（纯 CSS）：段 `position:relative` + 1280 高 + `display:flex` + `opacity:1` + 沿祖先放开裁剪 ⇒ 能滚；
         · **每段"进屏那一刻开始计时"**：`--p = (now - 该段进屏时刻) / 该段 data-duration`
           ⇒ 还是"段内时间进度"，只是起点从"全片 0 秒"换成"该段进屏那刻"
           ⇒ **滚到哪段，那段就从 0 播到 1**，跟 304 的 `--sp` 体验一致；
         · **film 态整段 return** ⇒ 成片仍由引擎 `__seek(t)` 驱动（已验：11 段/45s/四道闸门全过）。
       ⚠️ 出片安全性：`performance.now` / `requestAnimationFrame` 在 `daily-film.mjs` 打包时都会被替换成空实现，
          加上 film 态首行 return ⇒ **双保险，出片路径完全不受影响**。 */
    const guard = '<style id="ai-preview-guard">'
      + 'html:not([data-mode="film"]),html:not([data-mode="film"]) body{height:auto!important;overflow-y:auto!important;background:#000}'
      + 'html:not([data-mode="film"]) body>*{height:auto!important;max-height:none!important;overflow:visible!important}'
      + 'html:not([data-mode="film"]) .stage,html:not([data-mode="film"]) #stage{height:auto!important;overflow:visible!important}'
      /* ★VF_DAIDESIGN_V10（2026-10-17 用户实测「**没裁掉，是几段接一起了**」）：
         AI 的 `.sec` 只写 `width/height:1280` + `opacity:0`，**没有 `overflow:hidden`**（324 实测确认）。
         播放时靠 `opacity` 一层层遮 + `body{overflow:hidden}` 挡住溢出 ⇒ 看不出问题；
         我把段铺成 `position:relative` 后**没补 `overflow`** ⇒ 段内 `top > 1280` 的元素**漏到下一段**
         ⇒ 观感"几段接在一起"（不是被裁，是**没裁**）。
         现口径：铺开时**补 `overflow:hidden`**，与播放时的裁切行为保持一致 ⇒ 段与段边界干净。 */
      /* ★VF_DAIDESIGN_V12（2026-10-17 用户实测 363「除了第一张图能显示，后面全黑」）：
         AI 这次用 **`visibility:hidden`** 藏段（`.sec{…opacity:0;visibility:hidden;…}`），
         而 V9/V10 只覆盖了 `display` / `opacity` / 尺寸 ⇒ **段 2 起永远 hidden ⇒ 全黑**。
         ⇒ 这是"AI 藏段"的第 3 种写法（display:none → opacity:0 → visibility:hidden）。
         现口径：**把几种"藏段手段"一次性覆盖**（display / visibility / opacity / height / inset），
         以后不管它换哪种，预览都不会再黑。
         ⚠️ **故意不覆盖 `transform` 和 `clip-path`** —— 那两个是 AI 做**动效**（位移/缩放）
            和**异形图**（圆形/蜂窝）的正当手段，盖掉就把它的设计毁了。 */
      + 'html:not([data-mode="film"]) .sec{display:flex!important;visibility:visible!important;'
      + 'position:relative!important;inset:auto!important;'
      + 'left:auto!important;top:auto!important;width:720px!important;height:1280px!important;'
      + 'overflow:hidden!important;opacity:1!important;margin:0 auto 12px}'
      + '</style>'
      + '<script id="ai-preview-guard-js">(function(){'
      + 'var root=document.documentElement;if(root.getAttribute("data-mode")==="film")return;'
      + 'function boot(){'
      + 'var secs=[].slice.call(document.querySelectorAll(".sec"));if(!secs.length)return;'
      + 'for(var i=0;i<secs.length;i++){var s0=secs[i];'
      // ★VF_DAIDESIGN_V12：**内联**把它显出来（内联优先级最高，AI 用什么选择器都压不住）
      // ⚠️ display 只在"算出来是 none"时才强设 flex（AI 可能用 grid/block，别破坏它的布局）
      + 's0.style.visibility="visible";'
      + 'if(window.getComputedStyle(s0).display==="none")s0.style.display="flex";'
      + 'var a=s0.parentElement;'
      + 'while(a&&a!==document.body){a.style.overflow="visible";a.style.height="auto";a.style.maxHeight="none";a=a.parentElement;}'
      + 'if(a){a.style.overflowY="auto";a.style.height="auto";}}'
      + 'var t0=[],wasIn=[];'
      + 'function tick(){var vh=window.innerHeight||1280;'
      + 'for(var i=0;i<secs.length;i++){var s=secs[i],r=s.getBoundingClientRect();'
      + 'var inView=(r.top<vh*0.85)&&(r.bottom>0);'
      + 'if(inView&&!wasIn[i]){wasIn[i]=true;t0[i]=window.performance.now();}'
      + 'if(!inView){wasIn[i]=false;t0[i]=null;}'
      + 'var du=(+s.dataset.duration||3)*1000;'
      + 'var p=(t0[i]==null)?0:Math.min(1,(window.performance.now()-t0[i])/du);'
      + 's.style.setProperty("--p",String(p));}'
      + 'window.requestAnimationFrame(tick);}'
      + 'window.requestAnimationFrame(tick);'
      + '}'
      + 'if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot);else boot();'
      + '})();</script>'
    /* ⚠️⚠️ ★VF_DAIDESIGN_V4（2026-10-17 **这就是"改了半天没效果"的总根因**）：
       guard 自己含 `<style>` 标签，却被插在 **已有 `<style>` 内部**（原写法 `replace(/<\/style>/i, …)`）
       ⇒ 变成 `<style> … <style id="ai-preview-guard">…</style> </style>` **嵌套**
       ⇒ 浏览器把内层当**文本** ⇒ **CSS 一条都不生效**，`getElementById('ai-preview-guard')` 也返回 null
         （实测 225：`guard:false`、`body高 1280`、段 2 以后仍按 AI 的 `display:none`/`opacity:0` ⇒ 只看到第 1 段）。
       ⇒ **必须插到 `</head>` 之前（`<style>` 之外）**。兜底：`</body>` → 末尾追加。 */
    html = /<\/head>/i.test(html)
      ? html.replace(/<\/head>/i, guard + '\n</head>')
      : (/<\/body>/i.test(html) ? html.replace(/<\/body>/i, guard + '\n</body>') : html + guard)
  }
  // ③ 最小 plan（只服务交付卡的段数统计；自由档没有"8 种版式"概念）
  const secN = Math.max(1, (html.match(/<section[^>]*\bclass="[^"]*\bsec\b/g) || []).length)
  d.plan = {
    meta: { theme: '' },
    segments: Array.from({ length: secN }, () => ({ layout: 'free', title: ['', ''] })),
  } as any
  d.planBy = 'ai'
  try { ctx.log?.(uid, '[日报落地页] AI 自由设计：' + secN + ' 段 · ' + (Buffer.byteLength(html, 'utf8') / 1048576).toFixed(2) + ' MB（适配后）') } catch { /* ignore */ }
  return await finishDaily(ctx, d, picks, { html })
}

/** ★VF_DAILY_V6：真的生成 HTML 入库（**卡片按钮 `at:'go'` 与打字 `确认` 两条路共用**） */
async function finishDaily(ctx: DailyCtx, d: DailyDraft, picks: DailyPick[], prebuilt?: { html: string }): Promise<string> {
  const uid = ctx.uid
  const plan = d.plan
  if (!plan || !Array.isArray(plan.segments) || !plan.segments.length) {
    await clearDailyDraft(ctx.prisma, uid)
    return '⚠️ 方案丢了（草稿异常），本单已取消。再说一次「日报落地页」重来。'
  }
  // ★VF_DAILY_V19（A′）：**先**把所选图入库成同级扁平名，**再**生成 HTML —— HTML 直接引用这些名字，
  //   于是"页面 + 它用的图"在仓库里是同一层的平铺文件，客户端镜像会把它们放进同一个文件夹。
  //   失败不拦交付（计 0 张，卡上如实报）。
  let imageNames: string[] = []
  try {
    imageNames = await publishPickedImages(uid, picks)
    const okN = imageNames.filter(Boolean).length
    try { ctx.log?.(uid, `[日报落地页] 图片入库 ${okN}/${picks.length} 张（同级扁平名，供本地镜像同目录落地）`) } catch { /* ignore */ }
  } catch (e: any) {
    try { ctx.log?.(uid, '[日报落地页] 图片入库失败（不影响交付）：' + String(e?.message || e).slice(0, 120)) } catch { /* ignore */ }
  }
  if (imageNames.some(Boolean)) plan.imageNames = imageNames
  // ★L3/B：走"生成 → 真浏览器逐段体检 → 不合格段逐段退回 L2 模板 → 重生"（纯模板件自动跳过体检）
  /* ★VF_DAIDESIGN_V1（阶段 1 第 4 步，2026-10-17）：**AI 自由档**直接把成品 HTML 交进来（`prebuilt`），
     跳过"模板生成 + 逐段体检"这一步 —— 但**交付链路完全复用**：
     图入库 / 单文件版 / 交付卡 / 出片(`at:'film'`) / 配音(`at:'voice'`) **一行都不用改**。
     ⇒ 一套交付代码服务两条档（模板档 / 自由档），这也是为什么它必须是"可选参数"而不是新函数。 */
  let r: any
  if (prebuilt) {
    /* ★VF_DAIDESIGN_V1b（2026-10-17 用户实测「单文件版没生成 ⇒ 出片按钮变灰」后定案）：
       **自由档绝不能在别处自己调 `publishPickedImages`** —— 那会给同一批图**另生成一套名字**，
       而页面里写的是上一套 ⇒ `buildSingleFile` 拿新名字去页面里找 ⇒ **0 匹配 ⇒ 单文件版为空 ⇒ 出片按钮变灰**
       （用户截图：`单文件版: gen_..._112.html ｜ 配图版: gen_..._112.html` 两个名字一样、按钮灰）。
       现口径：自由档只交"**还没换图名**的 HTML"（`prebuilt.html`），
       **图名替换必须在这里、拿到 `imageNames` 之后做** ⇒ 保证"页面里的名字 = 交付卡 `imgNames` = 单文件版用的名字"。
       这也是模板档一直以来的硬口径：**一次生成只许上传一批图**。 */
    /* ★VF_DAIDESIGN_V13（2026-10-17 用户实测 381「全黑」后定案）：
       原来这里**只替换 `<img src="N.jpg">`**，**漏了 CSS 的 `url(N.jpg)`**。
       而 AI 一旦用**异形图**（圆形/蜂窝/跨页）就会写 `background-image: url(4.jpg)` ⇒
       这些引用**永远保持原始编号名**，与入库后的 `gen_xxx.jpg` 对不上 ⇒ 浏览器 404 ⇒ 页面全黑（实测 381）。
       ⇒ 现口径：**两种引用一起换**（`src="…"` 与 `url(…)`，含带引号写法），其余逻辑不动。 */
    const mapImgRef = (raw: string): string => {
      const m = /^(?:images\/)?(\d+)\.[a-zA-Z]+$/.exec(String(raw || '').trim())
      return m ? String(imageNames[Number(m[1]) - 1] || '') : ''
    }
    let h1 = String(prebuilt.html)
      .replace(/src="((?:images\/)?\d+\.[a-zA-Z]+)"/g, (m0, ref) => {
        const nm = mapImgRef(ref)
        return nm ? 'src="' + nm + '"' : m0
      })
      .replace(/url\(\s*(['"]?)((?:images\/)?\d+\.[a-zA-Z]+)\1\s*\)/g, (m0, _q, ref) => {
        const nm = mapImgRef(ref)
        return nm ? 'url(' + nm + ')' : m0
      })
    const pb = Buffer.from(h1, 'utf8')
    const saved = await saveToPersonalRepo({ userId: uid, buffer: pb, ext: 'html', mime: 'text/html', gen: true })
    r = {
      ok: !!saved?.name, name: String(saved?.name || ''), buf: pb,
      note: 'AI 自由设计版（整页版式由 AI 写；未过四道闸门，出片时若有问题会如实报）',
      dropped: [],
    }
  } else {
    r = await generateVerified(ctx, plan)
  }
  if (!r.ok || !r.name) {
    try { ctx.log?.(uid, '[日报落地页] 生成失败：' + String(r.error || '')) } catch { /* ignore */ }
    return '⚠️ HTML 生成失败：' + String(r.error || '未知原因') + '\n（可以回 `确认` 再试一次；若反复失败，把这句发给开发者）'
  }
  d.step = 'done'
  d.htmlName = r.name
  await saveDailyDraft(ctx.prisma, uid, d)
  try { ctx.log?.(uid, `[日报落地页] 已生成 ${r.name}（${plan.segments.length} 段 · ${d.planBy}）`) } catch { /* ignore */ }
  // ★VF_FILELINK_V1（2026-10-12 用户原话「你至少包装一下 怎么这么现实出来了 连我服务器地址什么都搞出来了」）：
  //   不再往回复里贴 OSS 原始签名地址（桶名/区域/OSSAccessKeyId/内部 key 全在里面）。
  //   对外只给**本站短链** `/f/<uid>/<文件名>?t=<过期>.<签名>` —— 由 src/app/f/[uid]/[name]/route.ts
  //   校验签名后 302 跳到真地址（不代理流量、无状态；7 天有效、可发人）。
  //   OSS 原始地址与内部路径只写进**服务端日志**（排障用），不出现在聊天里。
  const key = `storage/${uid}/${r.name}`
  const base = String(ctx.origin || '').replace(/\/+$/, '')
  const abs = (p: string) => (p ? (base ? base + p : p) : '')
  let link: any = null
  try { link = await import('@/lib/file-link') } catch { /* 极端情况下退回下面的 api 路径 */ }
  const linkOf = (nm: string) => {
    let p = ''
    try { p = link ? link.fileLinkPath(uid, nm, 7 * 86400) : '' } catch { p = '' }
    return { view: p, dl: p ? p + (p.includes('?') ? '&' : '?') + 'dl=1' : '' }
  }
  const apiPath = `/api/storage/file?userId=${uid}&name=${encodeURIComponent(r.name)}&download=1`
  // ★VF_DAILY_V8：单文件版（图内嵌）—— 失败不影响交付，只是回落到"配图版"
  let single: { name: string; embedded: number } | null = null
  try {
    single = await buildSingleFile(uid, r.buf, picks, (n: number) => String(imageNames[n - 1] || ''))
    if (single) try { ctx.log?.(uid, `[日报落地页] 单文件版已生成 ${single.name}（内嵌真图 ${single.embedded} 张）`) } catch { /* ignore */ }
  } catch (e: any) {
    try { ctx.log?.(uid, '[日报落地页] 单文件版生成失败（不影响交付）：' + String(e?.message || e).slice(0, 120)) } catch { /* ignore */ }
  }
  // ★VF_DAILYFILM_V2：把**单文件版**的名字也记进草稿 —— 出片（`at:'film'`）只认它。
  //   交付卡里虽然有 `name`（=单文件版名），但那是发给前端的；**服务端唯一能读的地方就是这个草稿**。
  if (single && single.name) {
    d.singleName = String(single.name)
    await saveDailyDraft(ctx.prisma, uid, d)
  }
  const std = linkOf(r.name)
  const stdView = abs(std.view) || apiPath
  const stdDl = abs(std.dl)
  const one = single && single.name ? linkOf(single.name) : { view: '', dl: '' }
  const oneView = abs(one.view)
  const oneDl = abs(one.dl)
  const singleOk = !!(single && single.name && oneView)
  try { ctx.log?.(uid, `[日报落地页] 交付：${key} ｜ 短链 ${std.view || apiPath}`) } catch { /* ignore */ }
  // ★L3/B：如实报"AI 自写了几段 / 哪几段没过体检被退回模板"（回落过的段此时已经没有 html 字段）
  const aiSegs = plan.segments.filter((s: any) => s && typeof s.html === 'string' && s.html.trim()).length
  // ★VF_DAILY_V7：最后一步也出**卡**（原来是纯文本 ⇒ 用户说"最后一步都是文字"）。
  //   卡里三个动作：▶ 打开预览（403/410 页面也是 HTML ⇒ 浏览器直接渲染）/ ⬇ 下载 / 🔁 再做一份；
  //   事实行与体检回落、真图命名对照全在卡里（不再往聊天里倒一大段文字）。
  try { ctx.log?.(uid, `[日报落地页] 交付卡已发（${r.name} · ${plan.segments.length} 段 · 结构 ${new Set(plan.segments.map((s: any) => String(s.layout || '-'))).size} 种）`) } catch { /* ignore */ }
  return 'VF_JSON:' + JSON.stringify(buildDoneCardPayload({
    name: r.name,
    viewUrl: stdView,
    dlUrl: stdDl,
    singleName: singleOk ? (single as any).name : '',
    // ★VF_DAILYFILM_V3：**单文件版"存在"就够**（与短链是否生成成功无关）—— 出片只依赖它。
    hasSingle: !!(single && single.name),
    singleUrl: singleOk ? oneView : '',
    singleDlUrl: singleOk ? oneDl : '',
    plainUrl: stdView,
    // ★VF_HTMLVIEW_V1 → ★VF_DAILY_V19（A′）修正：**站内预览走"配图版 + 服务端改写"出口**。
    //   为什么改：单文件版是几 MB 的 data: 内嵌 HTML，塞进 `srcDoc` 又大又慢（客户端里还可能是空白）；
    //   配图版只引用扁平图名，由 `/api/storage/htmlview` 在**服务端**把相对图名换成本站签名短链
    //   （`/f/<uid>/<图名>?t=…`，**不需要 cookie**）⇒ 卡内 iframe（sandbox 无同源）也能正常出图。
    apiView: `/api/storage/htmlview?userId=${uid}&name=${encodeURIComponent(r.name)}`,
    previewPath: `/preview/repo?userId=${uid}&name=${encodeURIComponent(r.name)}`,
    imgCount: picks.length,
    // ★V19：这批图的扁平名（客户端据此把图一起镜像到本地同一文件夹）
    imgNames: imageNames.filter(Boolean),
    embedded: singleOk ? (single as any).embedded : 0,
    segs: plan.segments.length,
    skin: themeName(plan?.meta?.theme),
    by: (d.planBy || 'fallback') as PlanBy,
    aiSegs,
    structures: new Set(plan.segments.map((s: any) => String(s.layout || '-'))).size,
    note: (r.note || 'R1~R14 通过').trim(),
    dropped: r.dropped || [],
    // ★V19（A′）：对照表改成"**仓库里的同级图名** ← 原素材名"（不再教用户建 images/ 文件夹）
    ordered: imageNames.some(Boolean)
      ? picks.map((p, i) => `${imageNames[i] || '（未入库）'} ← ${p.name}`)
      : picks.map((p, i) => `${i + 1}.jpg ← ${p.name}`),
    // ★VF_DAILY_V20：交付卡上也给一份**精简段表** —— 卡片上的"✏️ 编辑"面板靠它回填与生成命令
    //   （不重新依赖方案卡；交付后用户仍能改标题/信息点/版式/类型，或删段）
    segsBrief: plan.segments.map((s: any, i: number) => ({
      i: i + 1,
      label: layoutLabel(s),
      kind: String(s.kind || ''),
      layout: String(s.layout || ''),
      type: String(s.type || 'band'),
      scale: Number(s.scale) || 1,
      title: (Array.isArray(s.title) ? s.title : [s.title]).map((x: any) => String(x == null ? '' : x)),
      points: (Array.isArray(s.points) ? s.points : []).map((p: any) => (Array.isArray(p) ? p.filter(Boolean).join('·') : String(p))),
      imgs: Array.isArray(s.imgs) ? s.imgs : [],
    })),
  }))
}

export async function handleDailyLine(ctx: DailyCtx): Promise<string | null> {
  const uid = ctx.uid
  const raw = String(ctx.userMessage || '').trim()
  const bare = raw.replace(/\s+/g, '')
  let d = await loadDailyDraft(ctx.prisma, uid)

  // ── 入口：作废旧草稿 → **直接列素材**（★VF_DAILY_V4：把"先单独问主题"那一步合并掉） ──
  //   用户实测（2026-10-12 17:58）：点按钮后看到"请回一句主题"，他不知道要再打字、以为卡住，
  //   连着三次都停在这一步。⇒ 改成"点按钮就给素材清单"，主题改成**可选**（跟序号一句话说）：
  //     `1,3,5`（不给主题） / `京味铜锅涮肉 1,3,5`（给主题） / `主题=京味铜锅涮肉`
  if (isDailyEntry(bare)) {
    await clearDailyDraft(ctx.prisma, uid)
    d = newDailyDraft()
    d.source = { kind: 'repo' }
    await saveDailyDraft(ctx.prisma, uid, d)
    // ★VF_DAILY_V5：入口直接出**图形素材卡**（复用成片线那张卡；原来是文字清单 + 回序号）
    const card = await dailyMatCard(uid, d)
    try { ctx.log?.(uid, '[日报落地页] 起稿 → 出素材卡（第 1 步选原始素材）') } catch { /* ignore */ }
    return card
  }

  if (!d) return null

  // ★VF_DAILY_V5：**别线的协议串一律让位**。本线有草稿时会接管"非命令"消息，而别线的卡片协议串
  //   （VF_FILM_FORM / VF_FILM_GO / VF_PPT_FORM / VF_DECK_CONFIRM / VF_EDIT / LEAD_CFG…）也是"非命令"
  //   ⇒ 不显式放走就会被本线吃掉（成片线点「下一步」没反应）。只认自己的 `VF_DAILY_FORM`。
  if (/^VF_/.test(raw) && !/^VF_DAILY_FORM\s*[:{]/.test(raw)) return null

  // ── 退出口（防止草稿"终身吞掉"后续消息） ──
  if (DAILY_EXIT_RE.test(bare)) {
    await clearDailyDraft(ctx.prisma, uid)
    try { ctx.log?.(uid, '[日报落地页] 用户取消 → 本线草稿已清') } catch { /* ignore */ }
    return '已退出「日报落地页」（本线草稿已清）。想重来就说「日报落地页」。'
  }

  // 老草稿（v2 的"step=topic"）兼容：等价于"还没挑图"，直接落到第 1 步
  if (d.step === 'topic') d.step = 'pick'

  /* ── ★VF_DAILY_V5：自己的素材卡协议串（**不复用成片线的 `VF_FILM_FORM`** —— 两条线各有草稿时
     会互相抢消息；用自己的 `VF_DAILY_FORM`，前端靠卡里的 `proto` 字段发对应的串）。
     只在"等挑素材"这一步 + 来源是个人仓库时认；其它情况 return null 交回主流程。 ── */
  if (/^VF_DAILY_FORM\s*[:{]/.test(raw)) {
    let f: any = {}
    try { f = JSON.parse(raw.slice(raw.indexOf('{'))) } catch { /* ignore */ }
    const at = String(f?.at || 'mat')
    // ★VF_DAILYFILM_V2（2026-10-14 接入出片时发现）：这道"非仓库来源"闸门原来挡在**最前面**，
    //   但它其实只是为"素材卡（at:'mat'，勾选的是仓库里的图）"立的 —— 挡在门口会把
    //   **出片（at:'film'）**也一起挡掉：本机/子目录来源的单子点「🎬 出片」会**毫无反应**。
    //   现口径：**只挡 mat**，其余动作各自判前置条件（go 判 review+plan、film 判 done+singleName）。
    if (d.source && d.source.kind !== 'repo' && at === 'mat') return null
    // ① 方案卡「✅ 生成 HTML」→ 真的生成（与打字 `确认` 同一份实现）
    if (at === 'go') {
      if (d.step !== 'review' || !d.plan) return null
      /* ★VF_PLAN_FROM_CARD_V1（2026-10-19 用户实测「改了 6 处、生成出来一个字没改」，且 DB 里存的仍是旧文案）：
         **根治**：卡片点「✅ 生成 HTML」时会把**卡片上显示的方案**（title/points/imgs）一起带回来，
         这里**用它覆盖草稿**再生成 ⇒ **你看到什么就生成什么**，不再依赖"草稿有没有存对/读对"。
         为什么只覆盖这三项：生成 HTML 真正需要的就是"文案 + 用哪张图"；`layout/type/scale/kind` 仍以草稿为准
         （它们是排版参数，卡片上的 label 只是中文描述，反解回 id 反而容易错）。
         ⚠️ 覆盖后立刻存库，并把"用的是哪版"打进日志 —— 以后再出问题，日志能直接对上。 */
      const cardSegs = Array.isArray((f as any)?.segs) ? (f as any).segs : []
      if (cardSegs.length && Array.isArray((d.plan as any)?.segments)) {
        /* ★VF_PLAN_FROM_CARD_V2（2026-10-19 用户实测「删了第 4、10 段，方案卡 13 段，交付还是 15 段」）：
           V1 只覆盖 title/points/imgs，**段数仍按草稿** ⇒ 删段无效。
           现口径：**用卡片上的段完全重建 `segments`**（段数、顺序、版式、字号、用图全听卡片的）
           ⇒ 删段/改版式/改字号/改用图，全部"看到什么就生成什么"。
           ⚠️ 只保留生成 HTML 真正需要的字段；`src`（图名展示）由 `publishPickedImages` 重新给，
              不依赖卡片（卡片里的 src 是旧的、且可能指向已删除的图）。 */
        const rebuilt = cardSegs.map((s: any, idx: number) => {
          const t = Array.isArray(s.title) ? s.title.map((x: any) => String(x || '')).filter(Boolean) : []
          const pts = Array.isArray(s.points) ? s.points : []
          const im = Array.isArray(s.imgs) ? s.imgs.map((x: any) => Number(x)).filter((x: number) => x > 0) : []
          return {
            layout: String(s.layout || 'hero'),
            kind: String(s.kind || (idx === 0 ? 'cover' : idx === cardSegs.length - 1 ? 'end' : 'feature')),
            type: String(s.type || 'band'),
            scale: Number(s.scale) || 1,
            title: t.length ? t.slice(0, 2) : ['', ''],
            points: pts,
            imgs: im.length ? im : [1],
          }
        })
        ;(d.plan as any).segments = rebuilt
        await saveDailyDraft(ctx.prisma, uid, d)
        try {
          ctx.log?.(uid, '[日报落地页] 生成用**卡片上的方案重建**：' + rebuilt.length + ' 段 · seg1='
            + JSON.stringify(rebuilt[0]?.title) + ' · segN=' + JSON.stringify(rebuilt[rebuilt.length - 1]?.title))
        } catch { /* ignore */ }
      }
      return await finishDaily(ctx, d, toPicks(uid, d.source || { kind: 'repo' }, d.names || []))
    }
    /* ★VF_DAIDESIGN_V1（阶段 1 第 4 步）：**🎨 AI 自由设计** —— "AI 整页写 HTML"这条档。
       与 `at:'go'`（模板档）**并列**，不替换：自由档失败 / 想要可复现时，用户仍可点「✅ 生成 HTML」。
       前置条件与 go 相同（`step==='review'` 且方案在）—— 方案卡本身就是"素材已选好 + 已读图"的产物，
       自由档直接用它带的 picks/topic（**不重新选素材**）。 */
    if (at === 'aiDesign') {
      if (d.step !== 'review' || !d.plan) {
        return '⚠️ 现在不能走 AI 自由设计：本单不在"方案确认"这一步。先选好素材、等方案卡出来。'
      }
      // ★VF_DAIDESIGN_V2：走**带修错循环**的入口（3 轮 + 回落模板档）
      return await runDesignRetry(ctx, d, toPicks(uid, d.source || { kind: 'repo' }, d.names || []))
    }
    // ① ★VF_DAILY_V32（2026-10-16 用户定案「这个生成HTML 改成 2个 AI开关」）：
    //   切换两个 AI 开关 ⇒ **立刻按新设置重排一遍方案**。
    //   为什么必须重排：开关只是**提示词的措辞**，不重排的话用户切了开关却看不到任何变化
    //   （那正是他一开始抱怨的"AI 参与和不参与完全分不出来"）。
    //   代价：会调一次 AI + 看图（10~20 秒）—— 这是用户主动点的，可以接受；卡片上有说明。
    if (at === 'layout') {
      const st = String(d.step || '')
      if (st !== 'pick' && st !== 'review') {
        return '⚠️ 现在改不了排版开关：本单不在"选素材 / 方案确认"这两步。'
          + '想做新的一单就说「日报落地页」；想改这一单就先回方案确认那一步。'
      }
      if (typeof f?.aiLayout === 'boolean') d.aiLayout = f.aiLayout
      if (typeof f?.aiPickSkin === 'boolean') d.aiPickSkin = f.aiPickSkin
      await saveDailyDraft(ctx.prisma, uid, d)
      const picked = Array.isArray(d.names) && d.names.length ? d.names.map((x) => String(x)) : []
      if (!picked.length) return await dailyMatCard(uid, d)
      try {
        ctx.log?.(uid, '[日报落地页] 排版开关变更 ⇒ 按新设置重排（放手排版=' + (d.aiLayout ? '开' : '关')
          + '，皮肤交给 AI=' + (d.aiPickSkin ? '开' : '关') + '）')
      } catch { /* ignore */ }
      return await runPlan(ctx, d, d.source || { kind: 'repo' }, picked,
        '已按新开关重排（放手排版=' + (d.aiLayout ? '开' : '关') + '，皮肤交给 AI=' + (d.aiPickSkin ? '开' : '关') + '）')
    }
    // ② 「🔄 重选素材」→ 回第 1 步，重出素材卡
    if (at === 'back_mat') {
      d.step = 'pick'
      d.plan = undefined
      await saveDailyDraft(ctx.prisma, uid, d)
      return await dailyMatCard(uid, d)
    }
    // ③ ★VF_DAILYFILM_V2（2026-10-14 用户定案「先做1」）：交付后**出片**（日报 HTML → mp4）。
    //   为什么异步：出片一次 ~125s，而客户端 AI 接口超时是 120s ⇒ 同步走完**必然超时**。
    //   口径同存片线的 make_ai_video：立刻回执（带任务 id）+ 前端轮询 `/api/agent/daily-film-status`。
    // ④ ★VF_DAILYVOICE_V1（2026-10-14 用户定案「TTS 按你的 AI 写口播」「不要一次来和视频做，分 2 步」）：
    //   **第一步：出配音稿** —— AI 逐段写口播 ⇒ 卡片上给人改；改完再走 `at:'synth'` 合成（第二步）。
    //   ⚠️ **不动 `d.step`**（保持 'done'）：配音稿是"交付卡之上的附加步骤"，
    //      改了会让同一张卡上的「🎬 出片（无配音）」失效（那支要求 step==='done'）。
    if (at === 'voice') {
      if (d.step !== 'done' || !d.singleName || !d.plan) {
        return await needRegen(ctx, d, '⚠️ 这一单还不能配音：' + ((d.step !== 'done' || !d.plan)
          ? '还没生成 HTML。'
          : '没有**单文件版**（配音要在它基础上回填时间轴）。'))
      }
      const v = await aiVoiceLines(
        toPicks(uid, d.source || { kind: 'repo' }, d.names || []), d.plan.segments, d.topic || '')
      if (!v.ok) {
        try { ctx.log?.(uid, '[日报落地页] 口播没写出来：' + String(v.error || '') + (v.vlErr ? ' · ' + v.vlErr : '') + (v.diag ? ' · ' + v.diag : '')) } catch { /* ignore */ }
        return '⚠️ 口播没写出来：' + String(v.error || '未知原因')
          + (v.vlErr ? '\n（看图那步：' + v.vlErr + '）' : '')
          + (v.diag ? '\n（诊断：' + String(v.diag).slice(0, 300) + '）' : '')
          // ⚠️ 别在这里承诺"你把文案发我我照排" —— 那条路径**还没做**（记在 ISSUES 里了）。
          + '\n\n可以回一句「再写一次」重试。**若反复失败，把上面那行「诊断」发我**（它会写清是空响应还是解析不出来、原文长什么样）。'
      }
      // ★VF_DAILYVOICE_V4：把**上一版**（用户上次改完提交的）留一份给卡片回填（刷新后能恢复）。
      //   ⚠️ 必须在 `d.voice = lines` **之前**取，否则拿到的是刚生成的新稿（那就不叫"恢复"了）。
      // ★VF_DAILYVOICE_V6（2026-10-16 用户定案「6」：配音稿"换一单就失效"）：**只有"画面没变"时才认它** ——
      //   老口径无条件带过去 ⇒ 用户改了标题 / 换了素材之后再出稿，卡片上会显示**上一版的口播**
      //   （念的和看的不是一回事，比丢稿更糟）。现口径：比对**画面指纹**，一致才沿用，否则当没有。
      const curKey = voiceKeyOf(d.plan.segments)
      const prevVoice = (d.voiceKey === curKey && Array.isArray(d.voice)) ? d.voice : []
      const lines = v.lines || []
      d.voice = lines
      d.voiceKey = curKey
      await saveDailyDraft(ctx.prisma, uid, d)
      const note = v.sawImages
        ? '口播是 AI **看过每张素材**后写的'
        : ('**没看到图**（' + (v.vlErr || '未知') + '）—— 口播只按画面文字推的，务必逐条核对')
      try { ctx.log?.(uid, '[日报落地页] 配音稿已出：' + lines.filter(Boolean).length + '/' + lines.length + ' 段有口播') } catch { /* ignore */ }
      return 'VF_JSON:' + JSON.stringify(buildVoiceCardPayload({
        segs: d.plan.segments, lines, fixes: v.fixes, theme: d.plan?.meta?.theme,
        by: d.planBy, name: d.singleName, note, sawImages: v.sawImages, topic: d.topic,
        saved: prevVoice,   // ★VF_DAILYVOICE_V4：上次改完提交过的那一版（刷新/换设备后能恢复）
      }))
    }
    if (at === 'film') {
      if (d.step !== 'done' || !d.singleName) {
        return await needRegen(ctx, d, '⚠️ 这一单还不能出片：' + (d.step !== 'done'
          ? '还没生成 HTML。'
          : '出片只认"图已内嵌"的**单文件版** —— 常见原因：① 这份页是**旧版本**（出片功能上线前）'
            + '生成的，旧草稿不记单文件版；② 当时单文件版没生成成功（图太多、超内嵌预算）。'))
      }
      const { startDailyFilm, findRunningDailyFilm } = await import('./daily-film')
      const running = findRunningDailyFilm(uid)
      if (running) {
        return '⏳ 上一次出片**还在跑**（' + running.id + '）—— 完成后会自动发卡片，不用重复点。\n\n'
          + 'VF_DAILY_FILM_TASK:' + JSON.stringify({ id: running.id, name: running.htmlName, reuse: true })
      }
      const t = await startDailyFilm(uid, d.singleName)
      d.filmTaskId = t.id
      await saveDailyDraft(ctx.prisma, uid, d)
      try { ctx.log?.(uid, '[日报落地页] 出片任务已起：' + t.id + '（' + d.singleName + '）') } catch { /* ignore */ }
      return '🎬 **开始出片**（' + d.singleName + '）——大约 **2 分钟**'
        + '（打包 → 用字闸门 → 引擎校验 → 渲染）。\n完事我会自动把成片发到这儿，**你可以先干别的**。\n\n'
        + 'VF_DAILY_FILM_TASK:' + JSON.stringify({ id: t.id, name: d.singleName })
    }
    // ⑤ ★VF_DAILYVOICE_V2（2026-10-14 用户定案「分 2 步」的**第二步**）：把改好的口播合成成片。
    //   异步：逐段 TTS + 渲染 + 混音，通常 3~6 分钟 ⇒ 立刻回执 + 前端轮询（与无声出片**同一条通道**）。
    //   ⚠️ 口播以**卡上回传的**为准（用户可能刚改过），不信草稿里那份旧的。
    if (at === 'synth') {
      if (d.step !== 'done' || !d.singleName) {
        return await needRegen(ctx, d, '⚠️ 这一单还不能合成：' + (d.step !== 'done'
          ? '还没生成 HTML。'
          : '没有**单文件版**（合成要在它基础上回填时间轴）。'))
      }
      const arr = Array.isArray(f?.voice) ? f.voice.map((x: any) => String(x == null ? '' : x)) : []
      if (!arr.length) return '⚠️ 没收到口播稿（要在配音稿卡上点「✅ 开始合成」才会带上）—— 请重新点一次「🎙 出片（带配音 · 字幕）」。'
      const { startDailyFilm, findRunningDailyFilm } = await import('./daily-film')
      const running = findRunningDailyFilm(uid)
      if (running) {
        return '⏳ 上一次出片**还在跑**（' + running.id + '）—— 完成后会自动发卡片，不用重复点。\n\n'
          + 'VF_DAILY_FILM_TASK:' + JSON.stringify({ id: running.id, name: running.htmlName, reuse: true })
      }
      d.voice = arr
      await saveDailyDraft(ctx.prisma, uid, d)
      const t = await startDailyFilm(uid, d.singleName, { voice: arr })
      d.filmTaskId = t.id
      await saveDailyDraft(ctx.prisma, uid, d)
      try { ctx.log?.(uid, '[日报落地页] 配音合成任务已起：' + t.id + '（' + arr.filter(Boolean).length + '/' + arr.length + ' 段口播）') } catch { /* ignore */ }
      return '🎙 **开始合成**（配音 + 字幕）——逐段配音 → 按**实测时长**重排画面 → 烧字幕，通常 **3~6 分钟**。\n'
        + '完事我会自动把成片发到这儿，**你可以先干别的**。\n\n'
        + 'VF_DAILY_FILM_TASK:' + JSON.stringify({ id: t.id, name: d.singleName })
    }
    // ★VF_DAILY_V30（2026-10-16 用户定案「9」：旧素材卡的「下一步」在非选图步骤**点了没反应**）：
    //   老写法一律 `return null` ⇒ 交回主流程 ⇒ 而那一刻**没有任何人接**（本线已过选素材阶段，
    //   其余线也不认这条串）⇒ 用户点了等于石沉大海。⚠️ 更值得警惕的是它和 ★VF_DAILY_V26 同一个机制：
    //   消息最终可能落到主 AI 手里被自由发挥（那次 11 条编辑就是这么被"重排"掉的）。
    //   现口径：`at:'mat'`（能确定是素材卡发来的）但**步骤已经过了** ⇒ 回一句**人话引导**
    //   （告诉他现在在哪一步、该点哪里），而不是沉默；其余 `at` 仍然 `return null`（不吞别线的消息）。
    if (at !== 'mat') return null
    if (d.step !== 'pick') {
      const where = (d.step as string) === 'review'
        ? '这单**已经排好方案**了 —— 往上翻那张「方案确认」卡，点「✅ 生成 HTML」；也可以直接打字回 `确认`。'
        : ((d.step as string) === 'done'
          ? '这单**已经生成好了** —— 往上翻交付卡（那里有出片 / 编辑 / 下载 / 分享）；想做新的一份就说「日报落地页」。'
          : '本单当前不在"选素材"这一步 —— 回「取消」可以重来，或说「日报落地页」重新起一单。')
      return '⚠️ 这张素材卡已经过期了：' + where
    }
    const items = await dailyMatItems(uid, LIST_CAP)
    const all = items.map((x) => x.name)
    let picked = (Array.isArray(f?.names) ? f.names : [])
      .map((x: any) => String(x)).filter((n: string) => all.indexOf(n) >= 0)
    picked = Array.from(new Set(picked)).slice(0, DAILY_MAX_PICK)
    let note0 = ''
    if (!picked.length) {
      picked = all.slice(0, DAILY_MAX_PICK)
      note0 = '你**没勾选**，我按最近 ' + picked.length + ' 张走（下次可以先点图勾选）。'
    }
    if (!picked.length) {
      await saveDailyDraft(ctx.prisma, uid, d)
      return '⚠️ 原始素材里没有图片（只有成片的仓库不算素材）。先去「个人仓库」上传几张，再点一次「日报落地页」。'
    }
    return await runPlan(ctx, d, { kind: 'repo' }, picked, note0)
  }

  /* ── 第 1 步：选素材（手动；来源可切换；主题可选） ── */
  if (d.step === 'pick') {
    // ① 解析来源（先剥掉来源表达式，免得路径里的数字被当成序号）
    const SRC_RE = /(本机|目录)\s*[=:：]\s*("[^"]+"|'[^']+'|[^\s,，、]+)/g
    const unq = (s: string) => s.trim().replace(/^["']|["']$/g, '')
    const locM = /本机\s*[=:：]\s*("[^"]+"|'[^']+'|[^\s,，、]+)/.exec(raw)
    const dirM = /目录\s*[=:：]\s*("[^"]+"|'[^']+'|[^\s,，、]+)/.exec(raw)
    const strip = (s: string) => s.replace(SRC_RE, ' ')

    let src: DailySource = d.source || { kind: 'repo' }
    let names: string[] = []
    if (locM) {
      const dir = unq(locM[1])
      const r = listLocalImages(dir, LIST_CAP)
      if (!r.ok) {
        try { ctx.log?.(uid, '[日报落地页] 本机路径不可用：' + String(r.error)) } catch { /* ignore */ }
        return '⚠️ 这个本机路径用不了：' + String(r.error) + '\n\n'
          + '（换个人仓库里的图：回 `目录=子文件夹名`；或者先把图**上传到个人仓库**，再说一次「日报落地页」）'
      }
      src = { kind: 'local', value: dir }
      names = r.names || []
      if (!names.length) return '⚠️ 这个文件夹里没有图片：`' + dir + '`'
    } else if (dirM) {
      const sub = unq(dirM[1])
      src = { kind: 'subdir', value: sub }
      names = await listDailyImages(uid, LIST_CAP, sub)
      if (!names.length) return '⚠️ 个人仓库里没有「' + sub + '」这个子目录下的图片。\n（回 `目录=` 换成别的名字，或直接回序号用仓库根目录的图）'
    } else {
      src = d.source || { kind: 'repo' }
      if (src.kind === 'local') {
        const r = listLocalImages(String(src.value || ''), LIST_CAP)
        names = r.ok ? (r.names || []) : []
        if (!r.ok) { src = { kind: 'repo' }; names = await listDailyImages(uid, LIST_SHOWN) }
      } else if (src.kind === 'subdir') {
        names = await listDailyImages(uid, LIST_CAP, src.value)
        if (!names.length) { src = { kind: 'repo' }; names = await listDailyImages(uid, LIST_SHOWN) }
      } else {
        // 仓库根：与首次列出的张数保持一致（免得用户回了没见过的序号）
        names = await listDailyImages(uid, LIST_SHOWN)
      }
    }
    d.source = src

    if (!names.length) {
      await clearDailyDraft(ctx.prisma, uid)
      return '⚠️ 这个来源里没有可用图片，本单已取消。想重来就说「日报落地页」。'
    }

    // ② 序号（来源表达式已剥离）
    const auto = /自动/.test(bare)
    const nums = ((strip(raw).match(/\d+/g) || []).map((x) => parseInt(x, 10))).filter((n) => n >= 1 && n <= names.length)
    const picked = auto
      ? names.slice(0, DAILY_MAX_PICK)
      : Array.from(new Set(nums)).slice(0, DAILY_MAX_PICK).map((n) => names[n - 1]).filter(Boolean)

    // ①' 主题（可选）：显式 `主题=xxx` 优先；否则把"剥掉来源/序号之后剩下的文字"当主题 ——
    //     这样 `京味铜锅涮肉 1,3,5` 一句话就能既给主题又挑图（少一次来回）。
    const tm = /主题\s*[=:：]\s*("[^"]+"|'[^']+'|[^\s,，、]+)/.exec(raw)
    if (tm) {
      d.topic = unq(tm[1]).slice(0, 24)
    } else if (!DAILY_SKIP_RE.test(bare)) {
      const leftover = strip(raw)
        .replace(/主题\s*[=:：]\s*("[^"]+"|'[^']+'|[^\s,，、]+)/g, ' ')
        .replace(/自动/g, ' ')
        .replace(/[\d,，、]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
      if (leftover.length >= 2) d.topic = leftover.slice(0, 24)
    } else {
      d.topic = ''
    }

    // 只换了来源、还没挑图 ⇒ 存下来 + 重新列清单（不让用户重打一遍）
    if (!picked.length) {
      await saveDailyDraft(ctx.prisma, uid, d)
      return materialsReply(d, names, src)
    }

    // ③ AI 看素材 → 分段方案（失败回落保底，绝不空手）—— 与卡片协议那条路**同一份实现**
    return await runPlan(ctx, d, src, picked)
  }

  /* ── 第 3 步：确认（确认 → 生成；重选 → 回第 2 步） ── */
  if (d.step === 'review') {
    if (DAILY_BACK_RE.test(bare)) {
      d.step = 'pick'
      d.plan = undefined
      await saveDailyDraft(ctx.prisma, uid, d)
      const src = d.source || { kind: 'repo' }
      // ★VF_DAILY_V5：仓库来源 ⇒ 重新出**素材卡**（与入口一致）；本机/子目录没有缩略图 ⇒ 走文字清单
      if (src.kind === 'repo') return await dailyMatCard(uid, d)
      const names = src.kind === 'local' ? (listLocalImages(String(src.value || ''), LIST_CAP).names || [])
        : await listDailyImages(uid, src.kind === 'subdir' ? LIST_CAP : LIST_SHOWN, src.kind === 'subdir' ? src.value : '')
      if (!names.length) { await clearDailyDraft(ctx.prisma, uid); return '⚠️ 来源里没有可用图片了，本单已取消。' }
      return materialsReply(d, names, src)
    }
    if (!DAILY_YES_RE.test(bare)) {
      // ★逐段微调：`改 3 标题=…` / `改 3 版式=竖排` / `动效=活泼` / `删 3` —— 改完重列方案
      // ★VF_DAILY_V20：改走 applyEditBatch ⇒ 卡片上的"编辑"面板可以**一次发多条**（改几段 + 删一段同时）
      const picksForEdit = toPicks(uid, d.source || { kind: 'repo' }, d.names || [])
      const ed = applyEditBatch(d.plan, raw, picksForEdit)
      if (ed.matched) {
        if (!ed.ok) return '⚠️ ' + ed.msg
        d.plan = ed.plan
        await saveDailyDraft(ctx.prisma, uid, d)
        try { ctx.log?.(uid, '[日报落地页] ' + ed.msg) } catch { /* ignore */ }
        return planOut(d, picksForEdit, d.planBy || 'fallback', d.planNote || '', ed.msg)
      }
      /* ★VF_DAILYEDIT_V2（2026-10-18 用户定案「两个你确定了就改…不要改了后会话窗口出 AI 接管的提示」）：
         复查结论：`applyEditBatch` 其实**已经支持**全部 7 项（标题/信息点/用图/版式/类型/文字层/字号/删除/排序/动效），
         改完也会用 `ed.msg` 回读（"已改：段3 标题"）⇒ **功能不是死的**，我之前判断错了。
         **唯一真缺口**：命令**完全没被识别**时（如把"改第三段标题"写成自然语言），
         会落到下面这段话 ⇒ 用户只看到"等你拍板"，**不知道自己的命令没生效**（以为改了）。
         现口径：**看起来像编辑命令、但没被识别 ⇒ 明确告知"没识别 + 原方案没动 + 正确写法"**。
         ⚠️ 刻意**不触发任何 AI 重新生成**，只回事实（用户要求：不要出"AI 接管/重做"的提示）。 */
      const rawTrim = String(raw || '').trim()
      if (/^(?:改|删|排序|动效|节奏)\s*[\d=:：]/.test(rawTrim) || /^(?:改|删)\s*\d+/.test(rawTrim)) {
        return '⚠️ 这条我没识别成编辑命令，**原方案一个字没动**：\n'
          + '`' + rawTrim.slice(0, 48) + '`\n\n'
          + '正确写法（可直接复制改数字）：\n'
          + '· 改标题 → `改 3 标题=第一行/第二行`\n'
          + '· 改信息点 → `改 3 信息点=甲,乙;丙,丁`\n'
          + '· 换图 → `改 3 用图=2,4`\n'
          + '· 换版式/文字层/字号 → `改 3 版式=竖排` / `改 3 文字层=引文体` / `改 3 字号=1.15`\n'
          + '· 删一段 → `删 3`\n'
          + '· 调顺序 → `排序=3,1,2`'
      }
      return '这一步在等你**拍板**：\n'
        + '· 满意 → 回 `确认`（我就生成 HTML 文件）\n'
        + '· 想换素材 → 回 `重选`\n'
        + '· 想退出 → 回 `取消`\n'
        + '· 想改某一段 → 例如 `改 3 标题=刀起刀落/薄如纸片`、`改 3 版式=竖排`、`改 3 用图=2,4`、`删 3`'
    }
    // ④ 打字 `确认` → 生成（★VF_DAILY_V6：抽成 finishDaily，与方案卡的「✅ 生成 HTML」共用）
    return await finishDaily(ctx, d, toPicks(uid, d.source || { kind: 'repo' }, d.names || []))
  }

  // step = done：★VF_DAILY_V5 修掉一个**会吞消息**的隐患 ——
  //   旧实现只要有草稿（done 也留着）就 return 一句引导 ⇒ 那之后**用户说任何话都会被本线截住**
  //   （别的命令、普通聊天全进不来）。现口径：交付即清草稿、返回 null 交回主流程；
  //   想再做一份 ⇒ 说「日报落地页」会重新起稿（入口本来就是"作废旧单"）。
  //
  // ★VF_DAILY_V20（2026-10-13 用户「加一个编辑键…可以点了以后可编辑文字，可以删除」）：
  //   交付卡上也能改 —— 所以 done 状态**不再立刻清草稿**，而是：
  //     · 收到**编辑命令**（`改 <n> …` / `删 <n>`）⇒ 应用 → 回到 `review` → 重列方案
  //       （用户看到改动后，自己点「✅ 生成 HTML」才重出文件；不偷偷重跑 AI/渲染）
  //     · 其它任何消息 ⇒ 保留草稿但 **return null**（交回主流程，绝不吞消息 —— 这是 V5 那条红线）
  //     · 入口词/退出词 仍在上面的分支里处理（重来 / 取消），语义不变。
  if (d.step === 'done' && d.plan) {
    const picksForEdit = toPicks(uid, d.source || { kind: 'repo' }, d.names || [])
    const ed = applyEditBatch(d.plan, raw, picksForEdit)
    if (ed.matched) {
      if (!ed.ok) return '⚠️ ' + ed.msg
      d.plan = ed.plan
      d.step = 'review'
      await saveDailyDraft(ctx.prisma, uid, d)
      try { ctx.log?.(uid, '[日报落地页] 交付后编辑：' + ed.msg) } catch { /* ignore */ }
      return planOut(d, picksForEdit, d.planBy || 'fallback', d.planNote || '', ed.msg)
    }
    /* ★VF_DAILYEDIT_V2b（2026-10-18）：**交付后**的编辑命令没被识别时，**不要放回主流程**。
       原来这里直接 `return null` ⇒ 消息落到主 AI ⇒ **AI 会"接管"并把整份方案重排**（用户明确讨厌这个：
       "不要改了后会话窗口出 AI 接管的提示说重做什么的"），而且用户会以为"精确改了那一段"，其实全变了。
       现口径：看起来像编辑命令但没识别 ⇒ **明确说"没识别、原方案没动、正确写法"**，绝不交给 AI 重排。 */
    const rawTrimDone = String(raw || '').trim()
    if (/^(?:改|删|排序|动效|节奏)\s*[\d=:：]/.test(rawTrimDone) || /^(?:改|删)\s*\d+/.test(rawTrimDone)) {
      await saveDailyDraft(ctx.prisma, uid, d)
      return '⚠️ 这条我没识别成编辑命令，**交付的那份一个字没动**：\n'
        + '`' + rawTrimDone.slice(0, 48) + '`\n\n'
        + '正确写法：`改 3 标题=第一行/第二行` · `删 3` · `排序=3,1,2` · `改 3 用图=2,4`\n'
        + '（改完我会把改后的方案列出来，你满意再点「✅ 生成 HTML」重出文件）'
    }
    await saveDailyDraft(ctx.prisma, uid, d)   // 保留草稿 ⇒ 下次还能改；但这条消息不归本线
    return null
  }
  // ★VF_DAILY_V26（2026-10-15 用户定案「修14」）：**这里不再清草稿**。
  //   病灶（实测定位，证据三条）：这句"兜底清理"会在**任何未被识别的消息**上把草稿删掉 ——
  //   用户在流程里随便发一句"它不认识的话"，草稿就被**静默清掉**；草稿一没，之后所有编辑命令
  //   **都不再被本线接管**（`route.ts` 的接管条件里 `hasDailyDraft` 为假）⇒ 消息落到主 AI，
  //   **由 AI 重排整份方案**（用户只看到"改成功了"，其实不是精确改那几处，还可能动到没提的段）。
  //   证据：① 本线**每次**处理消息都会打 `[日报落地页-DIAG]`，而用户那次编辑前后日志**一条都没有**；
  //         ② 回执文案（`已改：第 2/3/4/… 段`）在 `src/` 里 grep **零匹配** ⇒ 不是本线产出的；
  //         ③ 用真代码实测解析器**本身正确**（`改 4 信息点=手切;牛肉,堆叠` ⇒ 两组，没坏）。
  //   为什么"保留"是安全的：本函数对不认识的输入一律 `return null` ⇒ **交回主流程，不吞消息**
  //   （这正是上面 done 分支早就采用的口径，两处现在一致）。
  //
  //   ⚠️ 但**不能无条件保留**（2026-10-15 评估副作用后收窄）：草稿长期活着会让 `route.ts` 的
  //      `stdHasAnyDraft()` 恒为真 ⇒ **标准模式的"非命令锁死"被一直顶开**（老口径"交付即清草稿"
  //      本来就是为恢复锁死）⇒ 无条件保留等于**修一个 bug 引入另一个**。
  //   现口径（**按"这一步用户能不能改文案"分**）：
  //     · `pick`（还在选素材）：没有"改文案"的诉求，说错话就清掉、回第 1 步重来，代价小 ⇒ 按 V5 原意清；
  //     · `review` / `done`（方案卡 / 交付卡）：用户**正在改文案**，说错一句话就丢草稿代价太大 ⇒ **保留**。
  //   ⚠️ 这里必须写 `(d.step as string)`：TS 会把 `d.step` 按控制流收窄成 `'done'`，
  //      于是 `=== 'pick'` 被判成"两个类型没有重叠"（TS2367）；
  //      但草稿是**从 JSON 读回来的**，运行期确实可能是 `pick`（尤其**本次更新前就存在的旧草稿**），
  //      所以断言成 string 才与运行期一致 —— 别为了消警告把判断删掉（那会退回"偷走草稿"）。
  if ((d.step as string) === 'pick') {
    await clearDailyDraft(ctx.prisma, uid)
    return null
  }
  await saveDailyDraft(ctx.prisma, uid, d)   // 保留草稿 ⇒ 下次还能接着改
  return null
}
