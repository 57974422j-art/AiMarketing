/* ═══════════════════════════════════════════════════════════════════════════
 * ★VF_DH_V1（2026-10-27）【数字人口播 · 独立状态机线】
 *
 * 用户原话：
 *   「数字人不应该跟网页制作那套混在一起，**它应该是单独状态机、呼出页面不一样**。
 *     这里要加仓库选项卡但**不能和成片那个一样**，因为**那个完全是为做视频设计的**。」
 *
 * 一句话：**照片 + 文案 → 云端生成口播视频**（wan2.2-s2v），与"网页排版出片"零交集。
 *
 * ── 铁律（本文件为什么长这样）────────────────────────────────────────────
 *  · **不 import 任何 `@/lib/agent/vf/**`**、不 import `daily*`：
 *    那些是网页成片的编排，混进来就会互相污染（用户明确要求）。
 *  · 只用 SDK 层：`ai-providers` 的 `textToSpeech` / `wanS2vDetect` / `wanS2vSubmit` / `wanS2vQuery`，
 *    `oss` 的上传与签名，`token-wallet` 的点数校验/记账。
 *  · 草稿**自己一份**：`SystemConfig.key = 'dh_draft_<uid>'`（不占别的线的草稿表/内存 Map）。
 *  · 卡片**自己一套**（`VfDhCard`），协议前缀 `VF_DH_` —— 与 `VF_FORM` / `VF_FILM_*` 完全分开。
 *
 * ── 协议（唯一口径）────────────────────────────────────────────────────
 *  客户端 → 服务端（只由我们自己的卡片按钮产生，用户不会手打）：
 *    `VF_DH_FORM:{"at":"photo","name":"x.jpg"}`         选好照片
 *    `VF_DH_FORM:{"at":"copy","script":"…","res":"480P"}` 提交文案 + 分辨率
 *    `VF_DH_FORM:{"at":"abort"}`                        取消这一单
 *  服务端 → 客户端（卡片渲染）：统一 `VF_JSON:{step:'dh_*', …}`
 *    —— 页面上**只能有一个入口**能拿到卡片（见 page.tsx 的 `_vj.step.startsWith('dh_')`），
 *       所以 `VF_DH_TASK{id}` / `VF_DH_DONE{url,name}` 的**语义已并入** JSON 的
 *       `step:'dh_running'|'dh_done'` + `taskId` / `videoUrl` / `repoName` 字段（不再单发一串前缀，
 *       否则页面解析不到、卡片不出来）。
 * ═══════════════════════════════════════════════════════════════════════════ */
import { listRepoMaterials } from '@/lib/agent/video-material'
import { signedUrl, objectExists, uploadOSS } from '@/lib/oss'
import { saveToPersonalRepo } from '@/lib/personal-storage'
import { textToSpeech, wanS2vDetect, wanS2vSubmit, wanS2vQuery } from '@/lib/ai-providers'
import { checkTokens, spendTokens, dhCostOf, DH_POINTS_PER_SEC } from '@/lib/token-wallet'

/* ==================== ① 常量（口径只在这里写一次） ==================== */
/** 字数 → 秒数：4 字/秒（用户可见的"约 N 秒"与计费**同一份**算法） */
export const DH_CPS = 4
/** wan2.2-s2v 单条输出上限 20 秒 ⇒ 文案上限 = 4×20 = 80 字（超了就如实让用户删短，不做分段拼接） */
export const DH_MAX_SEC = 20
export const DH_MAX_CHARS = DH_CPS * DH_MAX_SEC
/** 文案最少几个字（1 个字念出来没有意义，且 TTS 常拒） */
export const DH_MIN_CHARS = 4
/** 照片候选上限（仓库里可能几百张，卡片只要一排） */
const DH_PICK_MAX = 12

export type DhStep = 'dh_photo' | 'dh_copy' | 'dh_running' | 'dh_done'

export interface DhDraft {
  step: DhStep
  /** 选中的照片（个人仓库文件名） */
  photo?: string
  /** 文案（要念出来的话） */
  script?: string
  /** 分辨率（默认 480P；720P 价格翻倍，必须明示） */
  res?: '480P' | '720P'
  /** 提交出去的任务号（wan2.2-s2v 的 task_id） */
  taskId?: string
  /** 提交时刻（前端显示"已等待 N 秒"） */
  startedAt?: number
  /** 本次实扣点数（报价 = 实扣，同一函数算） */
  cost?: number
  /** 是否已记账（**成功才扣**：提交时不扣、出片成功那一刻扣一次；靠这个标记幂等） */
  charged?: boolean
  /** 估算秒数（= 作文本长度/4，与计费同源） */
  sec?: number
  /** 交付：成片直链（签名/仓库） */
  videoUrl?: string
  /** 交付：个人仓库文件名 */
  repoName?: string
  /** 失败/被拦原因（如实展示） */
  err?: string
  /** 上次下发的照片候选（重出卡片时不再重复列仓库） */
  images?: Array<{ name: string; url: string }>
  /** 存盘时间（判断草稿是否过期，避免刷出几天前的单） */
  savedAt?: number
}

export interface DhCtx {
  prisma: any
  uid: number
  userMessage: string
  auth?: any
  /** 服务器日志（复用调用方的 vfLog 即可，本线不另建日志文件） */
  log?: (uid: number | string, msg: string) => void
  /** ★VF_TASK_TRACE_V1：执行步骤上报（右侧通用面板用）；可选，没注入就静默跳过 */
  step?: (label: string, extra?: { tool?: string; since?: number; args?: string }) => void
}

const logOf = (ctx: DhCtx) => (m: string) => { try { ctx.log?.(ctx.uid, m) } catch { /* ignore */ } }

/* ==================== ② 草稿（SystemConfig 里自己一份） ==================== */
const DRAFT_KEY = (uid: number | string) => 'dh_draft_' + String(uid)
/** 草稿多久算过期（30 分钟）：出片 2~6 分钟，30 分钟足够"回来看一眼"；再久就当新的一单 */
const DRAFT_TTL = 30 * 60 * 1000

export async function loadDhDraft(prisma: any, uid: number | string): Promise<DhDraft | null> {
  try {
    const row = await prisma.systemConfig.findUnique({ where: { key: DRAFT_KEY(uid) } })
    if (!row?.value) return null
    const d = JSON.parse(row.value) as DhDraft
    if (!d?.step) return null
    if (d.savedAt && Date.now() - Number(d.savedAt) > DRAFT_TTL && d.step !== 'dh_running') return null
    return d
  } catch { return null }
}

export async function saveDhDraft(prisma: any, uid: number | string, d: DhDraft): Promise<void> {
  try {
    const value = JSON.stringify({ ...d, savedAt: Date.now() })
    await prisma.systemConfig.upsert({
      where: { key: DRAFT_KEY(uid) },
      create: { key: DRAFT_KEY(uid), value, label: '数字人草稿', description: '数字人口播线状态机草稿（自动，勿手改）' },
      update: { value },
    })
  } catch (e: any) { console.error('[DH] 存草稿失败:', e?.message || e) }
}

export async function clearDhDraft(prisma: any, uid: number | string): Promise<void> {
  /* ★VF_DH_KEEP_V1（2026-10-27）：清草稿之前，**如果这一单还在云端跑，先把"任务指针"另存一份**。
     为什么必须有：标准模式是「任何命令 = 重来」，点一下别的命令就会走 `stdClearAllDrafts` →
     本线草稿被清 → **task_id 丢了** → 云端那条已经开跑的视频（一条 ~¥15 的真实成本）永远拿不回来。
     （成片线没这个问题：它们的进度读**任务文件**，不读草稿。）
     口径：`dh_last_task_<uid>` 不被"命令=重来"清掉；新开一单/取消时才删。 */
  try {
    const d = await loadDhDraft(prisma, uid)
    if (d?.step === 'dh_running' && d.taskId) await saveLastTask(prisma, uid, d)
  } catch { /* ignore */ }
  try { await prisma.systemConfig.deleteMany({ where: { key: DRAFT_KEY(uid) } }) } catch { /* ignore */ }
}

/* ── 在跑的"任务指针"（防丢件，见 clearDhDraft 的注释）── */
const LAST_KEY = (uid: number | string) => 'dh_last_task_' + String(uid)
async function saveLastTask(prisma: any, uid: number | string, d: DhDraft): Promise<void> {
  try {
    const value = JSON.stringify({ ...d, savedAt: Date.now() })
    await prisma.systemConfig.upsert({
      where: { key: LAST_KEY(uid) },
      create: { key: LAST_KEY(uid), value, label: '数字人任务指针', description: '数字人在跑/刚出的那一单（自动，勿手改）' },
      update: { value },
    })
  } catch { /* ignore */ }
}
async function loadLastTask(prisma: any, uid: number | string): Promise<DhDraft | null> {
  try {
    const row = await prisma.systemConfig.findUnique({ where: { key: LAST_KEY(uid) } })
    if (!row?.value) return null
    const d = JSON.parse(row.value) as DhDraft
    return d?.taskId ? d : null
  } catch { return null }
}
async function dropLastTask(prisma: any, uid: number | string): Promise<void> {
  try { await prisma.systemConfig.deleteMany({ where: { key: LAST_KEY(uid) } }) } catch { /* ignore */ }
}

export async function hasDhDraft(prisma: any, uid: number | string): Promise<boolean> {
  const d = await loadDhDraft(prisma, uid)
  return !!d?.step
}

/* ==================== ③ 意图判定（只管自己的命令与自己的协议串） ==================== */
/** 本线的卡片协议串（只有我们自己的按钮会产生）。 */
export const DH_FORM_RE = /^VF_DH_FORM\s*[:{]/
/** 兼容：卡片/老消息可能发 `VF_DH_TASK:{id}` 来问进度（等价于"我再看一眼这一单"）。 */
export const DH_TASK_RE = /^VF_DH_TASK\s*[:{]/

/**
 * 这句话是不是本线的（**严格**）：命令命中由命令表负责，这里只认**自己的协议串**。
 * ⚠️ 刻意**不认**"取消/重来"这类通用词 —— 那些词各条线都有，认了就会把别线的流程蹭走
 *   （09-28 视频混剪 / 09-29 获客 / 10-07 PPT / 10-08 HTML成片踩过四次）。取消走卡片按钮（`at:'abort'`）。
 */
export function dhIntentOf(msg: string): boolean {
  const m = String(msg || '').trim()
  if (!m) return false
  return DH_FORM_RE.test(m) || DH_TASK_RE.test(m)
}

/** 解析协议串里的 JSON（容错：截到最后一个 `}`，尾巴有脏字符也不崩） */
export function parseDhForm(msg: string): any | null {
  const m = String(msg || '').trim()
  const i = m.indexOf('{')
  if (i < 0) return null
  const j = m.lastIndexOf('}')
  if (j <= i) return null
  try { return JSON.parse(m.slice(i, j + 1)) } catch { return null }
}

/* ==================== ④ 报价（报价 = 实扣，同一个函数） ==================== */
/** 字数 → 估算秒数（4 字/秒，**向下取整**、至少 1 秒）
 *  ⚠️ 为什么是 floor 不是 round：验收口径写死了「30 字 ⇒ 约 7 秒 · 350 点」（30/4=7.5）。
 *     用 round 会得 8 秒/400 点，与需求文档对不上。报价与实扣都走这一个函数 ⇒ 两处必然一致。 */
export function dhSecOf(script: string): number {
  const n = String(script || '').replace(/\s+/g, '').length
  return Math.max(1, Math.floor(n / DH_CPS))
}

/* ==================== ⑤ 照片候选（只列图片，单选） ==================== */
/** 仓库图片 → 卡片缩略图（只列图片；签名是本地 HMAC，不产生额外请求） */
async function pickImages(uid: number): Promise<Array<{ name: string; url: string }>> {
  let mats: any[] = []
  try { mats = (await listRepoMaterials(uid, 40, 'recent')) || [] } catch { mats = [] }
  const imgs = mats.filter((m: any) => String(m?.kind || '') === 'image' && m?.name)
  const out: Array<{ name: string; url: string }> = []
  for (const m of imgs.slice(0, DH_PICK_MAX)) {
    const key = String(m.key || `storage/${uid}/${m.name}`)
    let url = ''
    try { url = await signedUrl(key, 3600) } catch { url = '' }
    out.push({ name: String(m.name), url })
  }
  return out
}

/* ==================== ⑥ 卡片载荷 ==================== */
/** 第 1 步：选照片 */
function photoCard(d: DhDraft, images: Array<{ name: string; url: string }>, note?: string): string {
  return 'VF_JSON:' + JSON.stringify({
    step: 'dh_photo',
    dhLine: true,
    images,
    picked: d.photo || '',
    note: note || '',
    hint: '选一张人像照片（单人 · 正面 · 清晰）。仓库里没有合适的就上传一张 —— 整张脸要清楚，别太远、别侧脸。',
  })
}

/** 第 2 步：贴文案（前端按 `cps` / `perSec` 自己算"约 N 秒 · 预计 N 点"，**口径由服务端下发**） */
function copyCard(d: DhDraft, photoUrl: string, note?: string): string {
  const res = d.res === '720P' ? '720P' : '480P'
  const script = String(d.script || '')
  const sec = dhSecOf(script)
  return 'VF_JSON:' + JSON.stringify({
    step: 'dh_copy',
    dhLine: true,
    photo: { name: d.photo || '', url: photoUrl },
    script,
    res,
    sec: script ? sec : 0,
    cost: script ? dhCostOf(sec, res) : 0,
    // ★口径下发：卡片不自己写死"4 字/秒""50 点/秒"，避免服务端改了价而卡片还按老价报
    cps: DH_CPS,
    perSec: DH_POINTS_PER_SEC[res],
    prices: DH_POINTS_PER_SEC,
    maxChars: DH_MAX_CHARS,
    maxSec: DH_MAX_SEC,
    note: note || '',
    hint: '把要念的话贴进来（' + DH_MIN_CHARS + '~' + DH_MAX_CHARS + ' 字）。默认 480P；720P 更清晰但单价翻倍。',
  })
}

/** 第 3 步：生成中 */
function runningCard(d: DhDraft): string {
  return 'VF_JSON:' + JSON.stringify({
    step: 'dh_running',
    dhLine: true,
    taskId: d.taskId || '',
    startedAt: Number(d.startedAt) || Date.now(),
    sec: Number(d.sec) || 0,
    cost: Number(d.cost) || 0,
    res: d.res || '480P',
    hint: '已提交云端生成（wan2.2-s2v）。2~6 分钟出片，可以离开这个页面，回来我继续给你盯着。',
  })
}

/* ==================== ⑦ 主流程 ==================== */
/**
 * 数字人线分派。返回 null = 本线不接（交给别的线 / 交给 AI）；
 * 返回字符串 = 本轮回复（卡片协议串或人话）。
 *
 * 内部**绝不 throw**（异常转人话）—— 一条线出错不能连累别的线（仓库里踩过）。
 */
export async function handleDhLine(ctx: DhCtx): Promise<string | null> {
  const uid = Number(ctx.uid) || 0
  const msg = String(ctx.userMessage || '').trim()
  const log = logOf(ctx)
  try {
    /* ── 0. 命令词「数字人」= 新起一单 ── */
    // 由调用方判定"命中本线命令"后传进来（见 chat/route.ts 的 isEntry）；这里只按"有没有草稿"决定
    const d0 = await loadDhDraft(ctx.prisma, uid)

    /* ── 1. 协议串：我们是唯一入口 ── */
    if (dhIntentOf(msg)) {
      // ① 进度问候（兼容老消息里的 VF_DH_TASK:{id}）：不改变状态，只把卡片重新发一遍
      if (DH_TASK_RE.test(msg)) {
        if (!d0) return '这一单已经结束了（草稿已清）。要再做一条就说「数字人」。'
        return stateCardOf(ctx, d0)
      }
      const f = parseDhForm(msg)
      if (!f) return '数字人：这条指令没看懂（协议串坏了）。点卡片上的按钮重来一次，或说「数字人」重开。'

      // ② 取消
      if (String(f.at || '') === 'abort' || String(f.action || '') === 'abort') {
        await clearDhDraft(ctx.prisma, uid)
        await dropLastTask(ctx.prisma, uid)   // ★VF_DH_KEEP_V1：明确取消 ⇒ 指针也清（用户不要了）
        ctx.step?.('已取消')
        return '已退出「数字人口播」（草稿已清，不扣点）。想重来说「数字人」。'
      }

      // ③ 选照片（只认单张；不是人像后面 detect 会拦住）
      if (String(f.at || '') === 'photo') {
        const name = String(f.name || '').trim()
        if (!name) return '数字人：没收到照片名。点缩略图重选一张，或上传一张。'
        if (!d0) return '这一单已经结束了。说「数字人」重开一张。'
        // 防伪造：照片必须**真在**这个用户的仓库里（不信前端传的路径）
        const key = `storage/${uid}/${name}`
        let exists = false
        try { exists = await objectExists(key) } catch { exists = false }
        if (!exists) return `数字人：仓库里找不到这张照片（${name}）。重新选一张，或上传一张。`
        d0.photo = name
        d0.step = 'dh_copy'
        d0.err = ''
        await saveDhDraft(ctx.prisma, uid, d0)
        let url = ''
        try { url = await signedUrl(key, 3600) } catch { url = '' }
        log(`[DH] 选好照片 ${name} → 贴文案`)
        return copyCard(d0, url)
      }

      // ③b 回去换照片（文案保留 —— 用户常是"这张不合适，换一张同样的话"）
      if (String(f.at || '') === 'back') {
        if (!d0) return '这一单已经结束了。说「数字人」重开一张。'
        d0.step = 'dh_photo'
        d0.photo = ''
        await saveDhDraft(ctx.prisma, uid, d0)
        ctx.step?.('回去换照片')
        const images = d0.images?.length ? d0.images : await pickImages(uid)
        return photoCard({ ...d0, images }, images)
      }

      // ④ 提交文案 → 检测 → 配音 → 提交（这一支才可能扣点）
      if (String(f.at || '') === 'copy') {
        return await submitDh(ctx, d0, f)
      }

      return '数字人：这条指令没看懂。点卡片上的按钮重来一次，或说「数字人」重开。'
    }

    /* ── 2. 没有协议串：只有"命令词进线"才走到这里（调用方保证） ── */
    // 已有一单在跑 → 如实告知 + 重新发运行卡（绝不悄悄起第二条）
    if (d0?.step === 'dh_running' && d0.taskId) {
      log('[DH] 已有任务在跑，重发运行卡')
      return runningCard(d0)
    }
    /* ★VF_DH_KEEP_V1：草稿已被"命令=重来"清掉、但云端那条还在跑 ⇒ **不许悄悄开新单**
       （不然那条已经开跑的视频就彻底丢了，一条是真金白银）。20 分钟还没完才当它丢了。 */
    const _lastTask = await loadLastTask(ctx.prisma, uid)
    if (_lastTask?.step === 'dh_running') {
      const _age = Date.now() - Number(_lastTask.startedAt || 0)
      if (_age < 20 * 60 * 1000) {
        log('[DH] 上一单还在跑（指针里捞回来的）→ 重发运行卡，不覆盖')
        return runningCard(_lastTask)
      }
      await dropLastTask(ctx.prisma, uid)
    }

    const _tImg = Date.now()
    const images = await pickImages(uid)
    const d: DhDraft = { step: 'dh_photo', images, savedAt: Date.now() }
    await saveDhDraft(ctx.prisma, uid, d)
    await dropLastTask(ctx.prisma, uid)   // ★VF_DH_KEEP_V1：新一单开始 ⇒ 旧的"任务指针"作废
    ctx.step?.(`读仓库照片 ${images.length} 张`, { since: _tImg })
    log(`[DH] 起一单 → 照片候选 ${images.length} 张`)
    return photoCard(d, images)
  } catch (e: any) {
    const m = String(e?.message || e).slice(0, 200)
    try { log('[DH] ❌ 异常: ' + m) } catch { /* ignore */ }
    ctx.step?.('出错 · ' + m.slice(0, 12))
    return `数字人环节出错：${m}\n（把这句发我即可定位；这次没有静默失败。）`
  }
}

/** 把当前草稿渲染成对应的卡片（重发/回来看一眼） */
export async function stateCardOf(ctx: DhCtx, d: DhDraft): Promise<string> {
  if (d.step === 'dh_running') return runningCard(d)
  if (d.step === 'dh_done') return doneCard(d)
  if (d.step === 'dh_copy') {
    let url = ''
    try { url = d.photo ? await signedUrl(`storage/${ctx.uid}/${d.photo}`, 3600) : '' } catch { url = '' }
    return copyCard(d, url)
  }
  const images = d.images?.length ? d.images : await pickImages(Number(ctx.uid) || 0)
  return photoCard(d, images)
}

/** 交付卡（轮询成功后由 /api/agent/dh 返回的数据也能直接渲染） */
export function doneCard(d: DhDraft): string {
  return 'VF_JSON:' + JSON.stringify({
    step: 'dh_done',
    dhLine: true,
    videoUrl: d.videoUrl || '',
    repoName: d.repoName || '',
    sec: Number(d.sec) || 0,
    cost: Number(d.cost) || 0,
    res: d.res || '480P',
    hint: '成片已存进个人仓库（不会过期）。想再来一条就点下面。',
  })
}

/**
 * 提交生成（唯一会花钱的一支）。顺序**固定**：
 *   ① 字数/时长护栏 → ② 点数校验 → ③ **detect 把关（不过就不扣点、不提交）**
 *   → ④ TTS 配音 → ⑤ 音频上传（拿公网可拉的地址）→ ⑥ 提交任务 → ⑦ **成功才扣点**
 * 为什么 detect 在扣点之前：用户实测过"火锅图"也能点生成 ⇒ 白等 5 分钟 + 白花钱。
 */
async function submitDh(ctx: DhCtx, d: DhDraft | null, f: any): Promise<string> {
  const uid = Number(ctx.uid) || 0
  const log = logOf(ctx)
  if (!d) return '这一单已经结束了。说「数字人」重开一张。'
  if (!d.photo) return '数字人：还没选照片。先点一张人像照片（或上传一张），再提交文案。'

  const script = String(f.script || '').replace(/\r/g, '').trim()
  const res: '480P' | '720P' = String(f.res || d.res || '') === '720P' ? '720P' : '480P'
  const n = script.replace(/\s+/g, '').length
  if (n < DH_MIN_CHARS) return `数字人：文案太短了（现在 ${n} 字，至少 ${DH_MIN_CHARS} 字）。把要念的话贴进来再点生成。`
  if (n > DH_MAX_CHARS) {
    return `数字人：这条口播最长 ${DH_MAX_SEC} 秒（约 ${DH_MAX_CHARS} 字），你现在 ${n} 字。\n`
      + `请删到 ${DH_MAX_CHARS} 字以内再提交（超长口播要分段拼接，P1 还没做 —— 不硬做，免得白扣点）。`
  }

  const sec = dhSecOf(script)
  const cost = dhCostOf(sec, res)

  // ② 点数校验（不足直接拒，别等检测和配音白跑一趟）
  try {
    const chk = await checkTokens(uid, cost)
    if (!chk?.allowed) return `数字人：${chk?.message || '点数不足'}`
  } catch { /* 校验接口异常 → 交给真正的扣费去兜（宁可先跑） */ }

  // ③ detect 把关：**不通过就不扣点、不提交**
  const photoUrl = await signedUrl(`storage/${uid}/${d.photo}`, 3600)
  const _tDet = Date.now()
  const det = await wanS2vDetect(photoUrl)
  if (!det.ok) {
    const isReject = det.kind !== 'error'
    ctx.step?.(isReject ? '检测未通过' : '检测接口失败', { since: _tDet })
    log('[DH] detect ' + (isReject ? '不通过' : '接口出错') + '：' + String(det.reason || '').slice(0, 160))
    d.err = String(det.reason || '')
    await saveDhDraft(ctx.prisma, uid, d)
    return '数字人：**这张照片不能用**，没有扣点、也没有提交。\n'
      + `原因：${det.reason || '未通过人脸检测'}\n`
      + (isReject
        ? '换一张：**单人 · 正面 · 五官清楚 · 别太远**（半身或头像都行，别侧脸、别合照、别戴大墨镜）。'
        : '⚠️ 这不是照片的问题，是接口的问题（鉴权/地域）。wan2.2-s2v **仅适用于华北2（北京）**，请先核对百炼 Key 的地域。')
  }
  ctx.step?.('检查照片（人脸）', { since: _tDet })

  // ④ 配音（TTS → mp3 字节）
  const _tTts = Date.now()
  let audioBuf: ArrayBuffer | null = null
  try { audioBuf = await textToSpeech(script) } catch (e: any) { log('[DH] TTS 异常: ' + String(e?.message || e).slice(0, 120)) }
  if (!audioBuf || audioBuf.byteLength <= 100) {
    ctx.step?.('配音失败')
    await saveDhDraft(ctx.prisma, uid, d)
    return '数字人：**配音没合出来**（TTS 失败），没有扣点、也没有提交。稍后重试一次；连续失败请检查百炼/硅基的 Key。'
  }
  ctx.step?.(`合成配音 ${n} 字`, { since: _tTts })

  // ⑤ 音频要一个**公网可拉**的地址（wan2.2-s2v 在阿里云侧拉，读不到我们的私有对象）
  let audioUrl = ''
  try { audioUrl = await uploadOSS(Buffer.from(audioBuf), 'mp3', 'dh') } catch { audioUrl = '' }
  if (!audioUrl) {
    await saveDhDraft(ctx.prisma, uid, d)
    return '数字人：配音上传失败（拿不到公网地址），没有扣点、也没有提交。稍后重试一次。'
  }

  // ⑥ 提交任务（已自己检测过 ⇒ skipDetect，省一次检测的钱与时间）
  const _tSub = Date.now()
  // ★VF_DH_DETECT_V2（2026-10-29）：官方 face-detect **不返回人脸框**（只有 check_pass / humanoid），
  //   而提交接口的 input 也只认 `image_url` / `audio_url` ⇒ 不再传 bbox。
  //   （原来传的 `{face:det.face, ext:det.ext}` 恒为 undefined，纯属"看起来传了其实没传"。）
  //   detect 只当**把关**用：过了就走提交，没过就拦住不扣点。
  const taskId = await wanS2vSubmit(photoUrl, audioUrl, { resolution: res, skipDetect: true })
  if (!taskId) {
    ctx.step?.('提交失败')
    log('[DH] 提交任务失败（wan2.2-s2v 返回空 task_id）')
    await saveDhDraft(ctx.prisma, uid, d)
    return '数字人：**提交生成失败**（云端没给任务号），没有扣点。\n'
      + '常见原因：① 百炼 Key 地域不对（wan2.2-s2v **仅华北2·北京**）；② 照片/音频链接云端拉不到（OSS 权限）；③ 模型未开通。'
  }

  // ⑦ 这里**不扣点** —— 全项目口径是"出片成功才扣"（vf 那条线也是 `okDone` 才 spendTokens）。
  //   这一支只负责提交；扣费在 `dhAdvance` 收到 SUCCEEDED 时做一次（`charged` 标记幂等）。
  //   为什么不做"提交即扣"：任务失败（云端过载/内容审核）时用户什么都没拿到，扣了就得人工退。
  ctx.step?.(`提交生成 · 约 ${sec} 秒`, { since: _tSub })

  const next: DhDraft = {
    ...d, step: 'dh_running', script, res, sec, cost,
    taskId, startedAt: Date.now(), err: '', videoUrl: '', repoName: '', charged: false,
  }
  await saveDhDraft(ctx.prisma, uid, next)
  log(`[DH] 已提交 ${taskId}（${res} · 约 ${sec}s · ${cost} 点）`)
  return runningCard(next)
}

/* ==================== ⑧ 轮询推进（给 /api/agent/dh 用） ==================== */
export interface DhPollResult {
  ok: boolean
  state?: 'running' | 'done' | 'failed'
  waited?: number
  videoUrl?: string
  repoName?: string
  message?: string
}

/**
 * 查一次这一单的进度，**成功时顺手入库**（幂等：已入库就不再重复下载/上传）。
 * 只认自己的草稿（taskId 必须与草稿一致）⇒ 不可能拿别人的任务号来读。
 */
export async function dhAdvance(ctx: { prisma: any; uid: number }, taskId: string): Promise<DhPollResult> {
  const uid = Number(ctx.uid) || 0
  let d = await loadDhDraft(ctx.prisma, uid)
  /* ★VF_DH_KEEP_V1：草稿被"命令=重来"清掉时，靠 `dh_last_task_<uid>` 这一份指针把在跑的任务接回来
     （否则用户点一下别的命令 = 云端那条视频彻底没了，钱白花）。 */
  let fromSnap = false
  if (!d?.taskId || (taskId && String(d.taskId) !== String(taskId))) {
    const s = await loadLastTask(ctx.prisma, uid)
    if (s && String(s.taskId) === String(taskId)) { d = s; fromSnap = true }
  }
  if (!d?.taskId) return { ok: false, message: '这一单已经结束了（草稿已清）。' }
  if (taskId && String(taskId) !== String(d.taskId)) return { ok: false, message: '任务号对不上（不是这一单）。' }
  const persist = async (n: DhDraft) => { if (fromSnap) await saveLastTask(ctx.prisma, uid, n); else await saveDhDraft(ctx.prisma, uid, n) }

  // 已交付 ⇒ 直接回 done（刷新页面后卡片要能立刻显示成片）
  if (d.step === 'dh_done' && (d.videoUrl || d.repoName)) {
    return { ok: true, state: 'done', videoUrl: d.videoUrl, repoName: d.repoName }
  }

  const q = await wanS2vQuery(String(d.taskId))
  if (!q) return { ok: true, state: 'running', waited: Math.round((Date.now() - Number(d.startedAt || Date.now())) / 1000) }
  const waited = Math.round((Date.now() - Number(d.startedAt || Date.now())) / 1000)

  if (q.status === 'SUCCEEDED' && q.videoUrl) {
    // 入库（幂等）：先落个人仓库，再签名给前端播（仓库私有；直链会过期）
    let repoName = String(d.repoName || '')
    let playUrl = String(d.videoUrl || '')
    if (!repoName) {
      try {
        const r = await fetch(q.videoUrl, { signal: AbortSignal.timeout(120000) })
        if (r.ok) {
          const buf = Buffer.from(await r.arrayBuffer())
          if (buf.length > 1024) {
            const saved = await saveToPersonalRepo({ userId: uid, buffer: buf, ext: 'mp4', mime: 'video/mp4', gen: true })
            repoName = saved.name
          }
        }
      } catch { /* 下载失败不判死：还能给云端直链 */ }
    }
    if (repoName) {
      try { playUrl = await signedUrl(`storage/${uid}/${repoName}`, 86400) } catch { /* 保留云端直链 */ }
    }
    // ★扣点就在这一刻（出片成功才扣，且只扣一次）—— 与报价同一个 `dhCostOf`
    if (!d.charged && Number(d.cost) > 0) {
      try { await spendTokens(uid, Number(d.cost), `digital_human:${d.res || '480P'}:${d.sec || 0}s`) } catch { /* 记账失败不影响交付 */ }
    }
    const next: DhDraft = { ...d, step: 'dh_done', videoUrl: playUrl, repoName, charged: true, savedAt: Date.now() }
    await persist(next)
    return { ok: true, state: 'done', videoUrl: playUrl, repoName }
  }

  if (q.status === 'FAILED' || q.status === 'CANCELED') {
    const why = String(q.reason || q.status)
    // ★失败**不扣点**（口径：成功才扣）⇒ 退回可重试态，照片/文案都留着
    const next: DhDraft = { ...d, step: 'dh_copy', taskId: '', err: why, charged: false }
    await persist(next)
    // 这一单已经结束了（失败）⇒ 指针没用了，清掉（免得下次拿它当"在跑"）
    if (fromSnap) await dropLastTask(ctx.prisma, uid)
    return { ok: true, state: 'failed', message: `云端生成失败：${why}\n**这次不扣点**。照片和文案都留着，改一下再点生成。` }
  }

  return { ok: true, state: 'running', waited }
}
