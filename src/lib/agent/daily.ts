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
import { saveToPersonalRepo } from '@/lib/personal-storage'
import { dashscopeFunctionCall } from '@/lib/ai-providers'
// ★纯函数层（零依赖、可单测：temp/_exp/daily/test-plan.mjs）
import { DAILY_STYLE, aiPrompt, extractJson, normSegs, normMotion, normTheme, themeName, buildPlanFromSegs, buildDailyPlan, formatDailyPlan, applyDailyEdit, buildPlanCardPayload, buildDoneCardPayload, embedImages, rotateTheme, planFromCaptions, byLabel, assignFx, planFingerprint, similarity, rerollPlan, scrimFor, applyEditBatch, layoutLabel, assignTextLayer, checkDiversity, fixDiversity } from './daily-plan'
import type { PlanBy } from './daily-plan'

export { DAILY_STYLE }

export const DAILY_TAG = 'vf_draft_daily'
export const DAILY_PREFIX = '日报落地页草稿:'
/** 入口词（与 standard-commands.ts 的 text **一字不差**；比对时去空白） */
export const DAILY_ENTRY = ['日报落地页', '日报页', '做日报页']
// ★VF_DAILY_V11（2026-10-13 用户「页数多不是问题、少反而是问题；这个是为了做视频用的」）：
//   可勾素材从 6 张放到 **10 张** —— 段数按素材量走（prompt 里的下限 = 张数×1.5），素材多一点才有段数空间。
export const DAILY_MAX_PICK = 10
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
  /** 生成好的 HTML 在个人仓库里的文件名 */
  htmlName?: string
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

export async function saveDailyDraft(db: any, uid: number | string, d: DailyDraft): Promise<void> {
  const content = DAILY_PREFIX + JSON.stringify(d)
  try {
    const ex = await db.agentMemory.findFirst({ where: { userId: String(uid), tags: { equals: DAILY_TAG } }, orderBy: { updatedAt: 'desc' } })
    if (ex) await db.agentMemory.update({ where: { id: ex.id }, data: { content } })
    else await db.agentMemory.create({ data: { userId: String(uid), content, tags: DAILY_TAG, salience: 0.5 } })
  } catch { /* 草稿存不上不影响本轮回复 */ }
}

export async function loadDailyDraft(db: any, uid: number | string): Promise<DailyDraft | null> {
  try {
    const dm = await db.agentMemory.findFirst({ where: { userId: String(uid), tags: { equals: DAILY_TAG } }, orderBy: { updatedAt: 'desc' } })
    if (!dm) return null
    const s = String(dm.content || '')
    const i = s.indexOf('{')
    if (i < 0) return null
    const d = JSON.parse(s.slice(i))
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
export async function aiPlanSegments(picks: DailyPick[], topic: string, lastTheme = ''): Promise<{ ok: boolean; segs?: any[]; error?: string; added?: number; fixes?: string[]; theme?: string; custom?: any; motion?: string; sawImages?: boolean; vlErr?: string; captions?: string }> {
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
  const prompt = aiPrompt(n, topic, { lastTheme })
    + (summary ? '\n\n【素材实拍内容（视觉模型逐张读出，写文案必须据此，不许编造看不到的东西）】\n' + summary : '')
  // ★VF_DAILY_V12（2026-10-13 用户实测日志）：
  //   病灶①：主模型 **60s 超时**（`[qwen3.8] 调用异常: The operation was aborted due to timeout`）
  //          → DeepSeek 兜底也空 → 保底版式（用户：「AI 没排字」）。
  //   病灶②（我这边的雷）：`maxTokens` 只有 **2600**，而 V11 把段数提到 ≥9/最多 16 ⇒ 长 JSON 很容易被
  //          **截断**，而"截断"和"没吐 JSON"在现象上**一模一样**。
  //   现口径：maxTokens **6000** + **失败再试一次**（第二次用更严格的"只回 JSON"+ 段数收敛 ⇒ 更快更短）。
  const strict = '⚠️ 上一条没有产出可解析的 JSON。现在**只回一个 JSON 对象**：不要解释、不要 markdown 代码块、'
    + '不要在 JSON 前后写任何字；段数取 ' + Math.max(6, Math.min(10, n + 2)) + ' 段左右（别追求最多段）。'
  let lastErr = ''
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await dashscopeFunctionCall(
        [{ role: 'user', content: attempt === 1 ? prompt : prompt + '\n\n' + strict }],
        [], 6000, attempt === 1 ? 0.6 : 0.3, false,
      )
      const raw = extractJson(String(res?.content || ''))
      if (!raw) { lastErr = 'AI 没吐出可解析的 JSON' + (attempt > 1 ? '（重试也没成功）' : '') + (vlErr ? '；' + vlErr : ''); continue }
      const { segs, added, fixes } = normSegs(raw, n, topic)
      if (segs.length < 2) { lastErr = 'AI 的分段不合规（段数不足）'; continue }
      // ★L4：皮肤（AI 按素材挑；自定配色交给引擎做对比度体检）
      const th = normTheme(raw)
      const allFixes = fixes.concat(th.fixes)
      return { ok: true, segs, added, fixes: allFixes, theme: th.theme, custom: th.custom, motion: normMotion(raw?.motion), sawImages: !!summary, vlErr }
    } catch (e: any) {
      lastErr = String(e?.message || e).slice(0, 120) + (attempt === 1 ? '（已重试一次）' : '')
    }
  }
  // ★V12：把**看图摘要**一起返回 —— 文字模型挂了，但图已经看过 ⇒ 调用方可用它排出"有真内容"的兜底件
  return { ok: false, error: lastErr || '未知原因', sawImages: !!summary, vlErr, captions: summary }
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
  const repo = process.cwd()
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
  const repo = process.cwd()
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
    const rows = await prisma.agentMemory.findMany({
      where: { userId: { in: [String(uid), String(Number(uid) || 0)] }, tags: { contains: SKIN_TAG } },
      orderBy: { updatedAt: 'desc' }, take: 1,
    })
    const first = (rows || [])[0]
    if (first) await prisma.agentMemory.update({ where: { id: first.id }, data: { content: theme } })
    else await prisma.agentMemory.create({ data: { userId: String(uid), content: theme, tags: SKIN_TAG } })
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
      spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', tin, '-vf', 'scale=min(1600\\,iw):-2', '-q:v', '5', tout], { timeout: 20000 })
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
  const ai = await aiPlanSegments(picks, d.topic || '', recent[0])
  // ★VF_DAILY_V9：第二道药 —— AI 没挑 / 挑的还是上一套 ⇒ **服务端强制换**（纯函数 rotateTheme，可复现）
  const rot = rotateTheme(ai.ok ? String(ai.theme || '') : '', recent, picked.join('|') + '|' + (d.topic || ''))
  let plan: any
  // ★VF_DAILY_V12：多一档 `captions`（文字模型挂了，但**图已看过** ⇒ 用看图摘要排"有真内容"的方案）
  let by: 'ai' | 'captions' | 'fallback'
  let note = ''
  if (ai.ok && ai.segs && ai.segs.length) {
    // ★L4：皮肤（theme / custom）来自 AI；引擎会做对比度体检，不达标自己在页头回落并写明
    // ★V9：换成 rot.theme（若 AI 的挑法被轮换否决，就**不带**它的自定配色 —— 否则两处打架）
    plan = buildPlanFromSegs(ai.segs, d.topic || '', ai.motion || 'normal', rot.theme,
      rot.theme === 'custom' ? ai.custom : undefined)
    by = 'ai'
    if (ai.added) note = `AI 漏了 ${ai.added} 张，已自动补段`
  } else {
    note = String(ai.error || '未知原因')
    // ★VF_DAILY_V12：**先试"看图摘要兜底"** —— 图已经看过了（VL 逐张读出内容），别浪费：
    //   用它排出有真标题/真信息点的方案（不再"现场记录 N/N"那种空壳占位）。
    const cap = planFromCaptions(ai.captions || '', picks.length, d.topic || '')
    if (cap.used > 0 && cap.segments.length >= 2) {
      plan = buildPlanFromSegs(cap.segments, d.topic || '', 'normal', rot.theme)
      by = 'captions'
      note = note + ' ⇒ 已改用**看图摘要**重排（标题/信息点都来自读图，不是占位）'
      try { ctx.log?.(uid, `[日报落地页] AI 没排出 ⇒ 按看图摘要重排（读到 ${cap.used} 张的内容，${cap.segments.length} 段）`) } catch { /* ignore */ }
    } else {
      const fb = buildDailyPlan(picked, d.topic || '')
      plan = buildPlanFromSegs(fb.segments, d.topic || '', fb.motion, rot.theme)
      by = 'fallback'
      try { ctx.log?.(uid, '[日报落地页] AI 编排失败 → 保底版式：' + note) } catch { /* ignore */ }
    }
  }
  if (rot.theme) await rememberSkin(ctx.prisma, uid, rot.theme)
  // ★VF_DAILY_V13（用户：「低相似度」）：① 先按"素材+主题"的稳定散列排**效果序**（每份不同）；
  //   ② 与**上一份**比相似度（皮肤 20% / 结构序 50% / 效果序 30%），>0.70 就**重掷**（换效果序+单图段结构），
  //      取"更不像"的那次；③ 记下这一份的指纹，供下一份比较。
  const fxSeed = (() => {
    let h = 5381
    const key = picked.join('|') + '|' + (d.topic || '')
    for (let i = 0; i < key.length; i++) h = ((h * 33) ^ key.charCodeAt(i)) >>> 0
    return h
  })()
  assignFx(plan.segments, fxSeed)
  // ★VF_DAILY_V21（2026-10-14 用户「依然是文字排版同质化严重」）：**文字层也轮换** ——
  //   AI 没指定 type 的段，服务端按 seed 轮换四种（相邻段必不同）；指定过的段不动。
  //   这样"结构 8 种"之外又多一维（文字层 4 种），一份里不会只有一张脸。
  assignTextLayer(plan.segments, fxSeed)
  try {
    const faces = plan.segments.map((s: any) => String(s.type || 'band'))
    ctx.log?.(uid, `[日报落地页] 文字层序 ${faces.slice(0, 8).join('/')}${faces.length > 8 ? ' …' : ''}`
      + ` ｜ 一份里 ${new Set(faces).size} 种（结构 ${new Set(plan.segments.map((s: any) => String(s.layout || '-'))).size} 种）`)
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

/** 方案交付：仓库来源 ⇒ 出**方案卡**；本机/子目录（没有缩略图可签）⇒ 退回文字清单 */
function planOut(d: DailyDraft, picks: DailyPick[], by: PlanBy, note: string, hintExtra = ''): string {
  if ((d.source || { kind: 'repo' }).kind === 'repo') {
    return 'VF_JSON:' + JSON.stringify(buildPlanCardPayload(d.plan, {
      picks, by, note, hintExtra, topic: d.topic || '',
    }))
  }
  return (hintExtra ? '✅ ' + hintExtra + '\n\n' : '')
    + formatDailyPlan(d.plan, { topic: d.topic || '', picks, by, note })
}

/**
 * ★VF_DAILY_L3/B（2026-10-12 用户定案「行 B」）：生成 → **真浏览器逐段体检** → 不合格的段**逐段退回 L2 模板** → 重生。
 * · 只在"有 AI 自写段"时才跑（纯模板件已离线全过，省 3~8 秒）；
 * · 体检硬线只认**竖屏**（用户口径：竖屏为主），横屏结果只记日志；
 * · 没装校验器 / 没浏览器 ⇒ **跳过体检并如实说明**（绝不因为体检环境缺失就把交付拦下）；
 * · 最多重来 3 轮（每轮只动不合格的段），仍不过就按最佳结果交付并写清哪几段没过。
 */
async function generateVerified(ctx: DailyCtx, plan: any): Promise<{ ok: boolean; buf?: Buffer; name?: string; note: string; dropped: string[]; error?: string }> {
  const repo = process.cwd()
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
        const { signedUrl } = await import('@/lib/oss')
        const u = await signedUrl(p.key, 600)
        const res = await fetch(u)
        if (res.ok) b = Buffer.from(await res.arrayBuffer())
      }
    } catch { b = null }
    if (!b || !b.length) continue
    // ★V16：**先压再嵌**（否则超 12MB 预算的后半段图会被跳过 = 用户看到的"部分图没有"）
    if (b.length > 900 * 1024) b = await shrinkForEmbed(b)
    const png = b[0] === 0x89 && b[1] === 0x50
    // ★V19（A′）：内嵌也要按**同一套引用名**替换（配图版用的是同级扁平名，不再写死 images/N.jpg）
    imgs.push({
      n: i + 1, mime: png ? 'image/png' : 'image/jpeg', b64: b.toString('base64'), bytes: b.length,
      ref: (refOf && refOf(i + 1)) || `images/${i + 1}.jpg`,
    })
  }
  if (!imgs.length) return null
  // 预算放到 24MB（压过之后 10 张通常只有 3~5MB；这只是"最后一道保险"，不要它再成为丢图原因）
  const rc = embedImages(buf.toString('utf8'), imgs, 24 * 1024 * 1024)
  if (!rc.embedded) return null
  const saved = await saveToPersonalRepo({ userId: uid, buffer: Buffer.from(rc.html, 'utf8'), ext: 'html', mime: 'text/html', gen: true })
  return { name: String(saved?.name || ''), embedded: rc.embedded }
}

/** ★VF_DAILY_V6：真的生成 HTML 入库（**卡片按钮 `at:'go'` 与打字 `确认` 两条路共用**） */
async function finishDaily(ctx: DailyCtx, d: DailyDraft, picks: DailyPick[]): Promise<string> {
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
  const r = await generateVerified(ctx, plan)
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
    if (d.source && d.source.kind !== 'repo') return null
    let f: any = {}
    try { f = JSON.parse(raw.slice(raw.indexOf('{'))) } catch { /* ignore */ }
    const at = String(f?.at || 'mat')
    // ① 方案卡「✅ 生成 HTML」→ 真的生成（与打字 `确认` 同一份实现）
    if (at === 'go') {
      if (d.step !== 'review' || !d.plan) return null
      return await finishDaily(ctx, d, toPicks(uid, d.source || { kind: 'repo' }, d.names || []))
    }
    // ② 「🔄 重选素材」→ 回第 1 步，重出素材卡
    if (at === 'back_mat') {
      d.step = 'pick'
      d.plan = undefined
      await saveDailyDraft(ctx.prisma, uid, d)
      return await dailyMatCard(uid, d)
    }
    if (at !== 'mat' || d.step !== 'pick') return null
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
    await saveDailyDraft(ctx.prisma, uid, d)   // 保留草稿 ⇒ 下次还能改；但这条消息不归本线
    return null
  }
  await clearDailyDraft(ctx.prisma, uid)
  return null
}
