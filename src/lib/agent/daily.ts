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
import { listAllObjects, getObject } from '@/lib/oss'
import { saveToPersonalRepo } from '@/lib/personal-storage'
import { dashscopeFunctionCall } from '@/lib/ai-providers'
import { runFFmpeg } from '@/lib/ffmpeg'
// ★纯函数层（零依赖、可单测：temp/_exp/daily/test-plan.mjs）
import { DAILY_STYLE, aiPrompt, extractJson, normSegs, normMotion, buildPlanFromSegs, buildDailyPlan, formatDailyPlan, applyDailyEdit } from './daily-plan'

export { DAILY_STYLE }

export const DAILY_TAG = 'vf_draft_daily'
export const DAILY_PREFIX = '日报落地页草稿:'
/** 入口词（与 standard-commands.ts 的 text **一字不差**；比对时去空白） */
export const DAILY_ENTRY = ['日报落地页', '日报页', '做日报页']
export const DAILY_MAX_PICK = 6
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
  planBy?: 'ai' | 'fallback'
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
  try {
    const base = `storage/${uid}/`
    const sub = cleanSeg(subdir)
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

async function readPickBuffer(p: DailyPick): Promise<Buffer | null> {
  try {
    if (p.local && p.abs) return fs.readFileSync(p.abs)
    return await getObject(p.key)
  } catch { return null }
}

/* ─────────────── AI 看素材 → 分段方案（★v2 的核心；提示词/规整在 daily-plan.ts） ─────────────── */

/** 压缩后再喂视觉模型（512 宽，几十 KB 级）——失败就用原图 */
async function shrinkForVision(buf: Buffer): Promise<Buffer> {
  if (buf.length < 220 * 1024) return buf
  const tin = path.join(os.tmpdir(), `dv_${Date.now()}_${Math.random().toString(36).slice(2)}.img`)
  const tout = tin + '.jpg'
  try {
    fs.writeFileSync(tin, buf)
    await runFFmpeg(`-y -i "${tin}" -vf "scale=512:-2" -q:v 5 "${tout}"`, { timeout: 12000, skipNice: true, priority: 'high' })
    const out = fs.readFileSync(tout)
    return out.length ? out : buf
  } catch { return buf } finally {
    try { fs.unlinkSync(tin) } catch { /* ignore */ }
    try { fs.unlinkSync(tout) } catch { /* ignore */ }
  }
}

/**
 * ★v2 核心：AI 看素材 → 分段方案。
 * 返回 ok=false 时**不是异常**，是"这轮 AI 没排出来"，调用方回落确定性保底版式并**如实告知用户**。
 */
export async function aiPlanSegments(picks: DailyPick[], topic: string): Promise<{ ok: boolean; segs?: any[]; error?: string; added?: number; motion?: string }> {
  const n = picks.length
  if (!n) return { ok: false, error: '没有素材' }
  const content: any[] = [{ type: 'text', text: aiPrompt(n, topic) }]
  let bytes = 0
  let sent = 0
  for (let i = 0; i < n; i++) {
    const buf = await readPickBuffer(picks[i])
    if (!buf || !buf.length) continue
    if (bytes + buf.length > 9 * 1024 * 1024) break
    bytes += buf.length
    const small = await shrinkForVision(buf)
    const mime = /\.png$/i.test(picks[i].name) ? 'image/png' : 'image/jpeg'
    content.push({ type: 'text', text: `【图 ${i + 1}】${picks[i].name}` })
    content.push({ type: 'image_url', image_url: { url: `data:${mime};base64,${small.toString('base64')}` } })
    sent++
  }
  if (sent === 0) return { ok: false, error: '素材一张都没读到' }
  try {
    const res = await dashscopeFunctionCall([{ role: 'user', content }], [], 2600, 0.6, true)
    const raw = extractJson(String(res?.content || ''))
    if (!raw) return { ok: false, error: 'AI 没吐出可解析的 JSON' }
    const { segs, added } = normSegs(raw, n, topic)
    if (segs.length < 2) return { ok: false, error: 'AI 的分段不合规（段数不足）' }
    return { ok: true, segs, added, motion: normMotion(raw?.motion) }
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e).slice(0, 120) }
  }
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
    const names = await listDailyImages(uid, LIST_SHOWN)
    try { ctx.log?.(uid, `[日报落地页] 起稿（第 1 步 选素材 · 候选 ${names.length} 张）`) } catch { /* ignore */ }
    if (!names.length) {
      return '📄「日报落地页」第 1 步 / 共 3 步 · 选素材（本轮只出 HTML 文件，不出视频）\n'
        + '⚠️ 你的个人仓库里还没有**图片** —— 先去「个人仓库」上传几张，再回来说一次「日报落地页」。'
    }
    return materialsReply(d, names, d.source)
  }

  if (!d) return null

  // ── 退出口（防止草稿"终身吞掉"后续消息） ──
  if (DAILY_EXIT_RE.test(bare)) {
    await clearDailyDraft(ctx.prisma, uid)
    try { ctx.log?.(uid, '[日报落地页] 用户取消 → 本线草稿已清') } catch { /* ignore */ }
    return '已退出「日报落地页」（本线草稿已清）。想重来就说「日报落地页」。'
  }

  // 老草稿（v2 的"step=topic"）兼容：等价于"还没挑图"，直接落到第 1 步
  if (d.step === 'topic') d.step = 'pick'

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

    // ③ AI 看素材 → 分段方案（失败回落保底，绝不空手）
    const picks = toPicks(uid, src, picked)
    d.names = picked
    try { ctx.log?.(uid, `[日报落地页] AI 看素材编排（${picks.length} 张，来源=${src.kind}）…`) } catch { /* ignore */ }
    const ai = await aiPlanSegments(picks, d.topic || '')
    let plan: any
    let by: 'ai' | 'fallback'
    let note = ''
    if (ai.ok && ai.segs && ai.segs.length) {
      plan = buildPlanFromSegs(ai.segs, d.topic || '', ai.motion || 'normal')
      by = 'ai'
      if (ai.added) note = `AI 漏了 ${ai.added} 张，已自动补段`
    } else {
      note = String(ai.error || '未知原因')
      const fb = buildDailyPlan(picked, d.topic || '')
      plan = buildPlanFromSegs(fb.segments, d.topic || '', fb.motion)
      by = 'fallback'
      try { ctx.log?.(uid, '[日报落地页] AI 编排失败 → 保底版式：' + note) } catch { /* ignore */ }
    }
    attachSrc(plan, picks)
    d.plan = plan
    d.planBy = by
    d.planNote = note
    d.step = 'review'
    await saveDailyDraft(ctx.prisma, uid, d)
    try { ctx.log?.(uid, `[日报落地页] 方案已排（${by}，${plan.segments.length} 段）`) } catch { /* ignore */ }
    return formatDailyPlan(plan, { topic: d.topic || '', picks, by, note })
  }

  /* ── 第 3 步：确认（确认 → 生成；重选 → 回第 2 步） ── */
  if (d.step === 'review') {
    if (DAILY_BACK_RE.test(bare)) {
      d.step = 'pick'
      d.plan = undefined
      await saveDailyDraft(ctx.prisma, uid, d)
      const src = d.source || { kind: 'repo' }
      const names = src.kind === 'local' ? (listLocalImages(String(src.value || ''), LIST_CAP).names || [])
        : await listDailyImages(uid, src.kind === 'subdir' ? LIST_CAP : LIST_SHOWN, src.kind === 'subdir' ? src.value : '')
      if (!names.length) { await clearDailyDraft(ctx.prisma, uid); return '⚠️ 来源里没有可用图片了，本单已取消。' }
      return materialsReply(d, names, src)
    }
    if (!DAILY_YES_RE.test(bare)) {
      // ★逐段微调：`改 3 标题=…` / `改 3 版式=竖排` / `动效=活泼` / `删 3` —— 改完重列方案
      const picksForEdit = toPicks(uid, d.source || { kind: 'repo' }, d.names || [])
      const ed = applyDailyEdit(d.plan, raw, picksForEdit)
      if (ed.matched) {
        if (!ed.ok) return '⚠️ ' + ed.msg + '\n\n' + formatDailyPlan(d.plan, { topic: d.topic || '', picks: picksForEdit, by: d.planBy || 'fallback', note: d.planNote })
        d.plan = ed.plan
        await saveDailyDraft(ctx.prisma, uid, d)
        try { ctx.log?.(uid, '[日报落地页] ' + ed.msg) } catch { /* ignore */ }
        return '✅ ' + ed.msg + '\n\n'
          + formatDailyPlan(d.plan, { topic: d.topic || '', picks: picksForEdit, by: d.planBy || 'fallback', note: d.planNote })
      }
      return '这一步在等你**拍板**：\n'
        + '· 满意 → 回 `确认`（我就生成 HTML 文件）\n'
        + '· 想换素材 → 回 `重选`\n'
        + '· 想退出 → 回 `取消`\n'
        + '· 想改某一段 → 例如 `改 3 标题=刀起刀落/薄如纸片`、`改 3 版式=竖排`、`改 3 用图=2,4`、`删 3`'
    }
    const plan = d.plan
    if (!plan || !Array.isArray(plan.segments) || !plan.segments.length) {
      await clearDailyDraft(ctx.prisma, uid)
      return '⚠️ 方案丢了（草稿异常），本单已取消。再说一次「日报落地页」重来。'
    }
    const picks = toPicks(uid, d.source || { kind: 'repo' }, d.names || [])
    const r = await buildAndStoreDaily(uid, plan)
    if (!r.ok || !r.name) {
      try { ctx.log?.(uid, '[日报落地页] 生成失败：' + String(r.error || '')) } catch { /* ignore */ }
      return '⚠️ HTML 生成失败：' + String(r.error || '未知原因') + '\n（可以回 `确认` 再试一次；若反复失败，把这句发给开发者）'
    }
    d.step = 'done'
    d.htmlName = r.name
    await saveDailyDraft(ctx.prisma, uid, d)
    try { ctx.log?.(uid, `[日报落地页] 已生成 ${r.name}（${plan.segments.length} 段 · ${d.planBy}）`) } catch { /* ignore */ }
    const url = `/api/storage/file?userId=${uid}&name=${encodeURIComponent(r.name)}&download=1`
    const ordered = picks.map((p, i) => `${i + 1}.jpg ← ${p.name}`).join('\n　')
    return '✅ **日报落地页 HTML 已生成**（' + plan.segments.length + ' 段 · 风格 ' + DAILY_STYLE.name
      + ' · ' + (d.planBy === 'ai' ? 'AI 看素材编排' : '系统保底版式') + ' · 合规检查：' + (r.note || 'R1~R14 通过') + '）\n\n'
      + '**下载**：' + url + '\n\n'
      + '换成真图（2 步）：\n'
      + '　① 下载后**双击**用浏览器打开即可预览（上下滚动 = 预览模式，每段自动循环）；\n'
      + '　② 在 HTML 同目录建 `images/` 文件夹，把图按下面对应关系命名放进去：\n　' + ordered + '\n\n'
      + '文件已存进你的**个人仓库**（生成素材组）。想再做一份：再说一次「日报落地页」。'
  }

  // step = done：还有草稿时，用户说别的话 → 明确引导（不让草稿吞消息）
  return '这一单已经生成好了。想**再做一份**就说「日报落地页」；也可以回「取消」清掉本单草稿。'
}
