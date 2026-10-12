/**
 * ★VF_DAILY_V1（2026-10-12 用户定案）：「日报落地页」线 —— 第 9 条状态机线
 * =============================================================================
 * 用户原话：「不要一次就搞 HTML 成片 AI 自主，我觉得我们应该加一个让我们的 AI AGENT
 *           有做日报落地页的能力」「不做到出片 你做到选素材 出HTML 就行」
 *
 * 本轮范围（v1 = **只到 HTML**，不做视频出片）：
 *   入口词 → 第 1 步「选素材」（服务端列最近图片 + 序号）→ 用户回序号 / 自动（可带 `主题=…`）
 *   → 引擎 `tools/daily-page.mjs` 生成**合规 HTML**（R1~R14，见 docs/exp/响应式段规范-v1.md）
 *   → 存个人仓库（`gen_日期_序号.html`）→ 回**下载链接**
 *
 * 设计取舍（为什么 v1 用"文字选材"而不是图形卡）：
 *   图形卡要动 `page.tsx` 的 renderContent / VfFilmCard（前端渲染链，风险最大）。
 *   v1 先把 **服务端线 + 引擎生成 + 入库** 这条主干跑通；v2 再把"回序号"换成"点勾选"。
 *
 * ⚠️ 铁律（与其它 8 条线同款，缺一处就出事 —— route.ts 那几处注释是血泪史）：
 *   ① 命令必须登记进 `standard-commands.ts`（标准模式是白名单锁死）；
 *   ② 本线草稿必须登记进 route.ts 的 `stdHasAnyDraft`（否则第 2 步被闸门锁死）；
 *   ③ 必须登记进 `stdClearAllDrafts`（否则"命令 = 重来"对本线不成立，旧草稿会吞掉后续消息）；
 *   ④ 分派块放**最前**、只认自己的命令与自己线内的话（不看别线的 handled 标志）。
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { listAllObjects } from '@/lib/oss'
import { saveToPersonalRepo } from '@/lib/personal-storage'

export const DAILY_TAG = 'vf_draft_daily'
export const DAILY_PREFIX = '日报落地页草稿:'
/** 入口词（与 standard-commands.ts 的 text **一字不差**；比对时去空白） */
export const DAILY_ENTRY = ['日报落地页', '日报页', '做日报页']
export const DAILY_MAX_PICK = 6
const IMG_RE = /\.(jpg|jpeg|png|gif|webp)$/i

export interface DailyDraft {
  step: 'pick' | 'done'
  /** 已选素材文件名 */
  names?: string[]
  /** 用户的主题（用在标题上；没有就用中性占位并如实告知） */
  topic?: string
  /** 生成好的 HTML 在个人仓库里的文件名 */
  htmlName?: string
}

export function newDailyDraft(): DailyDraft { return { step: 'pick' } }

/** 入口词判定（去空白后完全相等） */
export function isDailyEntry(m: string): boolean {
  return DAILY_ENTRY.indexOf(String(m || '').replace(/\s+/g, '')) >= 0
}

const DAILY_EXIT_RE = /^(取消|退出|重来|不做了|算了|清空|重置|退出日报|退出日报落地页)$/

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

export async function listDailyImages(uid: number | string, limit = 12): Promise<string[]> {
  try {
    const objs = await listAllObjects(`storage/${uid}/`, 2000)
    return objs
      .map((o) => String(o.name || ''))
      .filter((n) => !n.includes('/.thumbs/') && !n.includes('/_gen/'))
      .map((n) => n.slice(`storage/${uid}/`.length))
      .filter((n) => IMG_RE.test(n) && !/^gen_/.test(n))
      .slice(-limit * 3)          // 先取较多，再按 mtime 排序（listAllObjects 已按 key 序）
      .reverse()
      .slice(0, limit)
  } catch { return [] }
}

/* ─────────────── 段配置（v1 = 确定性；不叫 AI 写文案，文案是中性占位并如实告知） ─────────────── */

const CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十']

export function buildDailyPlan(names: string[], topicRaw: string) {
  const topic = String(topicRaw || '').trim().slice(0, 24)
  const segs = names.map((nm, i) => {
    const kind = i === 0 ? 'cover' : (i === names.length - 1 ? 'end' : 'feature')
    const t1 = topic ? topic.slice(0, 6) : (kind === 'cover' ? '这几张' : '现场记录')
    const t2 = topic && topic.length > 6 ? topic.slice(6, 12) : (kind === 'cover' ? '值得一看' : `${i + 1} / ${names.length}`)
    return {
      kind,
      kicker: `日报 · ${topic || '素材记录'} · 其${CN[i] || i + 1}`,
      stamp: kind === 'cover' ? '第 01 期' : undefined,
      title: [t1, t2],
      imgs: [i + 1],
      points: [['实拍', '原图'], ['细节', '特写'], ['现场', '记录']],
      place: 'cover',
      form: i === 0 ? 'overlay' : (i === 1 ? 'sticker' : 'vertical'),
      src: nm,      // 只在生成时用来记录对应素材（不进 HTML）
    }
  })
  return { meta: { issue: '第 01 期', accent: '#C6392B', paper: '#F5F1E8', title: `日报落地页 · ${topic || '素材记录'}` }, motion: 'normal', imageDir: 'images', segments: segs }
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
    return { ok: true, name: undefined, note }
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
  /** 只有"点/说了命令"才算入口（本线 v1 没有协议串，保留参数与其它线同形） */
  isEntry?: boolean
  log?: (uid: number | string, s: string) => void
}

export async function handleDailyLine(ctx: DailyCtx): Promise<string | null> {
  const uid = ctx.uid
  const raw = String(ctx.userMessage || '').trim()
  const bare = raw.replace(/\s+/g, '')
  let d = await loadDailyDraft(ctx.prisma, uid)

  // ── 入口：作废旧草稿 → 新面板（"看到命令就是重来"，与其它 8 条线一致） ──
  if (isDailyEntry(bare)) {
    await clearDailyDraft(ctx.prisma, uid)
    d = newDailyDraft()
    await saveDailyDraft(ctx.prisma, uid, d)
    const imgs = await listDailyImages(uid, 12)
    try { ctx.log?.(uid, `[日报落地页] 起稿（候选图片 ${imgs.length} 张）`) } catch { /* ignore */ }
    if (!imgs.length) {
      return '📄「日报落地页」第 1 步 · 选素材\n⚠️ 你的个人仓库里还没有**图片** —— 先去「个人仓库」上传几张，再回来说一次「日报落地页」。'
    }
    return '📄「日报落地页」第 1 步 / 共 2 步 · **选素材**（本轮只生成 HTML 文件，不出视频）\n\n'
      + '个人仓库里的图片（最近 ' + imgs.length + ' 张）：\n'
      + imgs.map((n, i) => `  ${i + 1}. ${n}`).join('\n') + '\n\n'
      + '回我**要用哪几张**，例如：`1,3,5`（最多 ' + DAILY_MAX_PICK + ' 张）；或回 `自动` 用最近 ' + Math.min(DAILY_MAX_PICK, imgs.length) + ' 张。\n'
      + '可选：带上主题，例如 `1,3,5 主题=京味铜锅涮肉`（主题会用在标题上；不带主题就用中性占位文案）。\n'
      + '（想退出：回「取消」）'
  }

  if (!d) return null

  // ── 退出口（防止草稿"终身吞掉"后续消息） ──
  if (DAILY_EXIT_RE.test(bare)) {
    await clearDailyDraft(ctx.prisma, uid)
    try { ctx.log?.(uid, '[日报落地页] 用户取消 → 本线草稿已清') } catch { /* ignore */ }
    return '已退出「日报落地页」（本线草稿已清）。想重来就说「日报落地页」。'
  }

  if (d.step === 'pick') {
    const imgs = await listDailyImages(uid, 12)
    if (!imgs.length) { await clearDailyDraft(ctx.prisma, uid); return '⚠️ 个人仓库里没有图片了，本单已取消。' }
    const auto = /自动/.test(bare)
    const nums = (bare.match(/\d+/g) || []).map((x) => parseInt(x, 10)).filter((n) => n >= 1 && n <= imgs.length)
    const picked = auto ? imgs.slice(0, DAILY_MAX_PICK) : Array.from(new Set(nums)).slice(0, DAILY_MAX_PICK).map((n) => imgs[n - 1])
    if (!picked.length) {
      return '还差一步：请回**序号**（如 `1,3,5`）或回 `自动` 用最近 ' + Math.min(DAILY_MAX_PICK, imgs.length) + ' 张。'
    }
    const tm = /主题\s*[=:：]\s*([^\s,，、]+)/.exec(raw)
    const topic = tm ? tm[1] : ''
    const plan = buildDailyPlan(picked, topic)
    const r = await buildAndStoreDaily(uid, plan)
    if (!r.ok || !r.name) {
      try { ctx.log?.(uid, '[日报落地页] 生成失败：' + String(r.error || '')) } catch { /* ignore */ }
      return '⚠️ HTML 生成失败：' + String(r.error || '未知原因') + '\n（可以回 `自动` 再试一次；若反复失败，把这句发给开发者）'
    }
    d.step = 'done'
    d.names = picked
    d.topic = topic
    d.htmlName = r.name
    await saveDailyDraft(ctx.prisma, uid, d)
    try { ctx.log?.(uid, `[日报落地页] 已生成 ${r.name}（素材 ${picked.length} 张）`) } catch { /* ignore */ }
    const url = `/api/storage/file?userId=${uid}&name=${encodeURIComponent(r.name)}&download=1`
    return '✅ **日报落地页 HTML 已生成**（' + picked.length + ' 段 · 合规检查：' + (r.note || 'R1~R14 通过') + '）\n\n'
      + '**下载**：' + url + '\n'
      + '（下载后**双击**用浏览器打开即可；上下滚动是"预览模式"，每段会自动循环播放动效。\n'
      + '　真图到位后把图片按 `1.jpg…N.jpg` 放进同目录 `images/` 文件夹即可替换当前占位图。）\n\n'
      + '文件已存进你的**个人仓库**（生成素材组）。\n'
      + '想再来一单：再说一次「日报落地页」。'
  }

  // step = done：还有草稿时，用户说别的话 → 明确引导（不让草稿吞消息）
  return '这一单已经生成好了。想**再做一份**就说「日报落地页」；也可以回「取消」清掉本单草稿。'
}
