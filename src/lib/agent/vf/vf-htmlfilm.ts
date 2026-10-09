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
 *   · 独立 step：`mat`（选素材）→ `style`（选风格包）→ `confirm`（确认出片）
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
import { filmToolsDir, makeFilmFromMaterials, filmDoneProtocol } from './vf-film'

const HTMLFILM_TAG = 'vf_draft_htmlfilm'
const HTMLFILM_PREFIX = 'HTML成片草稿:'

export type HtmlFilmStep = 'mat' | 'style' | 'confirm'

export type HtmlFilmDraft = {
  step: HtmlFilmStep
  /** 用户勾选的**个人仓库文件名**（空数组 = 用最近 12 张） */
  names: string[]
  /** 风格包 id（空 = 编排器按赛道自己挑） */
  pack: string
  /** 主题文本（可选，用于文案填充） */
  topic?: string
}

/** 进程内缓存（与 vf-ppt.ts 同形制：DB 是主，Map 是"这一回合的加速"） */
const HTMLFILM_DRAFT = new Map<number, HtmlFilmDraft>()

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
  } catch { /* 存储失败不影响本次流程（内存 Map 仍在） */ }
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
      step: (['mat', 'style', 'confirm'].includes(String(j.step)) ? String(j.step) : 'mat') as HtmlFilmStep,
      names: Array.isArray(j.names) ? j.names.map((x: any) => String(x)) : [],
      pack: String(j.pack || ''),
      topic: String(j.topic || ''),
    }
  } catch { return null }
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

/** 个人仓库里的图片（含 24h 签名缩略图）——素材卡用 */
async function repoImages(uid: number | string): Promise<Array<{ name: string; url: string }>> {
  try {
    const items = await listRepoMaterials(uid, 40, 'recent')
    const imgs = (items || []).filter((m: any) => m?.kind === 'image').slice(0, 40)
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

/* ───────────────────────── 三张卡（都走 VF_JSON，客户端按 step 选组件）───────────────────────── */

async function matCard(uid: number | string, vd: HtmlFilmDraft): Promise<string> {
  const images = await repoImages(uid)
  const body = {
    step: 'film_mat',
    hint: images.length
      ? '第 1 步 / 共 3 步 · 选素材（个人仓库里的图片；不勾就默认用最近 12 张）'
      : '第 1 步 / 共 3 步 · 个人仓库里还没有图片 —— 先上传几张，或点「下一步」由系统用最近素材',
    images,
    names: vd.names,
    max: 40,
    pack: vd.pack,
  }
  return 'VF_JSON:' + JSON.stringify(body)
}

function styleCard(vd: HtmlFilmDraft): string {
  const packs = htmlFilmPacks()
  const body = {
    step: 'film_style',
    hint: `第 2 步 / 共 3 步 · 选风格（已选 ${vd.names.length || '最近'} 张素材）`,
    packs,
    pack: vd.pack,
    n: vd.names.length,
    names: vd.names,
  }
  return 'VF_JSON:' + JSON.stringify(body)
}

function confirmCard(vd: HtmlFilmDraft): string {
  const packs = htmlFilmPacks()
  const pk = packs.find((p) => p.id === vd.pack)
  const n = vd.names.length || 12
  const body = {
    step: 'film_confirm',
    hint: '第 3 步 / 共 3 步 · 确认出片',
    names: vd.names,
    n: vd.names.length,
    pack: vd.pack,
    packName: pk ? pk.name : '（自动按赛道挑）',
    // 估算：编排器按风格包的镜头组定段数（实测 8 张素材 ≈ 6 段 · 30 秒）
    estSec: 30,
    estShots: Math.max(4, Math.min(8, Math.ceil(Math.max(1, n) / 1.5))),
    cost: 0,
    topic: String(vd.topic || ''),
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
}

/** 返回 string = 本线的回复（协议串/卡）；返回 null = 不是本线的话，交给后面的流程 */
export async function handleHtmlFilmLine(ctx: HtmlFilmCtx): Promise<string | null> {
  const { uid, prisma } = ctx
  const msg = String(ctx.userMessage || '').trim()

  // ── ① 入口：清草稿 → 落**第一步草稿** → 出素材卡（铁律①：第一步就落草稿）
  if (ctx.isEntry) {
    await clearHtmlFilmDraft(prisma, uid)
    const vd: HtmlFilmDraft = { step: 'mat', names: [], pack: '', topic: '' }
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
      vd.names = Array.isArray(f.names) ? f.names.map((x: any) => String(x)).slice(0, 40) : []
      if (f.topic !== undefined) vd.topic = String(f.topic || '').slice(0, 60)
      vd.step = 'style'
      await saveHtmlFilmDraft(prisma, uid, vd)
      return styleCard(vd)
    }
    if (at === 'style') {
      vd.pack = String(f.pack || '')
      vd.step = 'confirm'
      await saveHtmlFilmDraft(prisma, uid, vd)
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

    // 素材解析：勾选的 → 本地；没勾 → 个人仓库最近 12 张；再不行 → 老的 material/ 目录（兼容旧路径）
    let files: string[] = []
    try {
      const repo = await listRepoMaterials(uid, 40, 'recent')
      const pool = (repo || []).filter((m: any) => m?.kind === 'image')
      const picked = vd.names.length ? pool.filter((m: any) => vd.names.includes(String(m.name))) : pool.slice(0, 12)
      const dl = await downloadMaterials(uid, picked)
      files = (dl || []).map((m: any) => String(m.localPath || '')).filter(Boolean)
      if (files.length) vfLog(uid, `[HTML成片] 素材：${files.length} 张（勾选 ${vd.names.length || 0} / 仓库图片 ${pool.length}）`)
    } catch (e: any) {
      vfLog(uid, '[HTML成片] 取仓库图片失败：' + String(e?.message || e).slice(0, 120))
    }
    if (!files.length) {
      try {
        const mdir = materialDir(uid)
        files = fs.readdirSync(mdir).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).map((f) => path.join(mdir, f))
      } catch { files = [] }
    }
    if (!files.length) return 'TOOL_REJECT:没有找到素材（个人仓库里没有图片）——请先上传几张图片，再说一次「HTML成片」。'
    files = files.slice(0, 40)   // ★与"上传多少用多少"同口径（上限 40）

    const workDir = path.join(vfStorageRoot(), String(uid), 'video-factory', 'film_' + Date.now())
    vfLog(uid, `[HTML成片] 开始：${files.length} 张素材 → 编排 + 出片（风格包=${vd.pack || '自动'}${wantVoice ? ' · 配音+字幕' : ' · 无声'}）`)
    const r = await makeFilmFromMaterials({
      materials: files,
      text: String(vd.topic || ''),
      pack: vd.pack || '',
      workDir,
      // ★VF_FILMVOICE_V1：默认配音 + 字幕（走 film-voice：TTS 实测时长 → 重排镜头 → 字幕 → 混音烧字幕）
      voiced: wantVoice,
      voice: goF.voice ? String(goF.voice) : undefined,
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
