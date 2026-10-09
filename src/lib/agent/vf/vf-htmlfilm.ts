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
import { filmToolsDir, planFilm, makeFilmFromMaterials, filmDoneProtocol } from './vf-film'

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
  // ★VF_FILMCOPY_V1（2026-10-09 用户定案「B该用模型就用模型 / 让 AI 先总结素材 / **不要乱出片**」）：
  /** AI 看图后的**素材总结**（一句话 + 逐张一句）——给用户看，也是写文案的依据 */
  summary?: string
  /** 骨架（每段结构 + 该段素材）；与出片时的排列**同序**（arrange 确定性） */
  plan?: Array<{ structure: string; media: string[] }>
  /** AI 按骨架写的**逐镜文案**（下标 = 骨架序号；key 按结构：title1/sub/chips/rows…） */
  copy?: any[]
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
      // ★VF_FILMCOPY_V1：这三个字段**必须一起取回来**（load 是白名单式重建，漏一个就等于把 AI 写的文案丢了）
      summary: String(j.summary || ''),
      plan: Array.isArray(j.plan) ? j.plan : [],
      copy: Array.isArray(j.copy) ? j.copy : [],
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

/** ★VF_FILMCOPY_V1（2026-10-09 用户定案 B：「该用模型就用模型。还有让 AI 先总结素材。不要乱出片」）
 *  —— AI「先总结素材 → 再写逐镜文案」，**任一步不过就不许出片**。
 *   ① 看图：qwen-vl-max 一次读前 8 张（describeImagesWithVL）→ 一句话总结 + 逐张一句；
 *   ② 骨架：planFilm()（**只出骨架、不渲染**）→ 每段结构 + 该段素材；
 *   ③ 写文案：generateText（writer 档位）按骨架填 slots；
 *   ④ 服务端校验：解析 + 每镜 ≤60 字 + 用字在字表内 + 无 emoji + **剥掉任何数字卡字段**（红线：不许编造数据）。
 *  ⚠️ 与 scripts/vf-film-gen.mjs 同一套硬规矩；区别：那边让模型**排分镜**，这里骨架已定、只让模型**填文案**。 */
async function aiPrepareCopy(ctx: HtmlFilmCtx, uid: number | string, vd: HtmlFilmDraft):
Promise<{ ok: boolean; err?: string; summary?: string; plan?: any[]; copy?: any[] }> {
  if (!ctx.generateText) return { ok: false, err: '服务端没接上文案模型（generateText 未注入）' }
  // ① 素材（勾选的优先，没勾用最近 12 张 —— 与真正出片同一口径）
  let picked: any[] = []
  try {
    const repo = await listRepoMaterials(uid, 40, 'recent')
    const pool = (repo || []).filter((m: any) => m?.kind === 'image')
    picked = (vd.names.length ? pool.filter((m: any) => vd.names.includes(String(m.name))) : pool.slice(0, 12)).slice(0, 12)
  } catch { /* ignore */ }
  if (!picked.length) return { ok: false, err: '个人仓库里没有可用图片' }
  // ② 看图总结（读图失败**不判死**：少点信息也比卡住好；文案本身仍必须写出来）
  let summary = ''
  try {
    const { signedUrl } = await import('@/lib/oss')
    const { describeImagesWithVL } = await import('@/lib/ai-providers')
    const urls: string[] = []
    for (const m of picked.slice(0, 8)) {
      try { urls.push(await signedUrl('storage/' + uid + '/' + m.name, 3600)) } catch { /* 单张失败跳过 */ }
    }
    if (urls.length) {
      const r = await describeImagesWithVL(urls,
        '这是一组【餐饮/美食实拍】照片。只回两段：第一段一句话总结这组素材是什么（≤30 字）；第二段逐张一行说清每张拍的是什么（菜名/场景），不要编号、不要多余解释。', 700)
      summary = String(r || '').trim()
    }
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
  const pl = await planFilm({ materials: files, text: String(vd.topic || ''), pack: vd.pack || '', workDir })
  if (!pl.ok || !pl.scenes || !pl.scenes.length) return { ok: false, err: '编排骨架失败：' + String(pl.err || '') }
  // ④ 让模型按骨架填文案
  const guide = [
    'opening-hero  开场封面：slots{eyebrow,title1,title2,sub,foot}        media=1 张',
    'fullbleed     满幅实拍：slots{eyebrow,title,sub,chips[1~4],foot}     media=1 张',
    'works-wall    作品墙(3图)：slots{title,sub,rows[3],foot}             media=3 张',
    'grid-2x2      四宫格(4图)：slots{title,sub,nums[4],tail,foot}         media=4 张',
    'glass-product 结尾卡(无图)：slots{eyebrow,title,sub}（**不要写 value/unit/kpi**）media=0',
  ].join('\n  ')
  const planTxt = pl.scenes.map((s, i) => '  ' + i + '. ' + s.structure + '（素材 ' + s.media.length + ' 张）').join('\n')
  const prompt = '你是一位竖屏短视频（9:16）的文案。素材是一组餐饮/美食实拍。\n'
    + (vd.topic ? '主题/卖点：' + vd.topic + '\n' : '（用户没给主题：请**只依据素材**写，不要自创品牌、不要编数据）\n')
    + (summary ? '【素材总结（视觉模型读图所得）】\n' + summary + '\n' : '')
    + '【这条片的段落骨架（顺序固定，不要增删）】\n' + planTxt + '\n\n'
    + '请为**每一段**填文案（按结构给对应的 key）：\n  ' + guide + '\n\n'
    + '【硬规矩 · 违反即返工】\n'
    + '1. **绝对不许编造数据**：不许出现曝光/点击率/转化/百分比/排名等没有来源的数字；也不许写"数据驱动/实时监控"这类跟素材无关的话。\n'
    + '2. 零 emoji、零符号图标；不要英文小字（结尾卡的 eyebrow 也写中文）。\n'
    + '3. 每段文案合计 ≤60 字；chips 每条 ≤3 字；rows 每条 ≤12 字。\n'
    + '4. **不许用「涮」字**（项目字体子集里没有，会上豆腐块）——火锅的动作写「烫 / 下锅 / 火锅」；别用生僻字。\n'
    + '5. 只回一个 JSON 数组（长度 = 段数），元素形如 {"slots":{...}}；不要 markdown 围栏、不要解释。'
  let txt = ''
  try { txt = await ctx.generateText(prompt) } catch (e: any) { return { ok: false, err: '文案模型调用失败：' + String(e?.message || e).slice(0, 100) } }
  let arr: any[] = []
  try {
    const s = String(txt).replace(/```(?:json)?/gi, '')
    const a = s.indexOf('['), b = s.lastIndexOf(']')
    if (a < 0 || b < 0) throw new Error('没给 JSON 数组')
    arr = JSON.parse(s.slice(a, b + 1))
    if (!Array.isArray(arr)) throw new Error('不是数组')
  } catch (e: any) { return { ok: false, err: '文案解析失败：' + String(e?.message || e).slice(0, 80) } }
  if (arr.length !== pl.scenes.length) return { ok: false, err: '文案段数(' + arr.length + ')与骨架(' + pl.scenes.length + ')不一致' }
  // ⑤ 校验（用字表 / 字数 / emoji）+ 剥数字卡字段
  let charset = ''
  try { charset = fs.readFileSync(path.join(filmToolsDir(), 'fonts', 'chars-cmn.txt'), 'utf8') } catch { charset = '' }
  const set = new Set(charset.split(''))
  const copy: any[] = []
  for (let i = 0; i < arr.length; i++) {
    const slots: any = Object.assign({}, (arr[i] || {}).slots || {})
    const all = JSON.stringify(slots)
    if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(all)) return { ok: false, err: '第 ' + i + ' 段带了 emoji' }
    const n = ['eyebrow', 'title', 'title1', 'title2', 'sub', 'tail', 'foot'].reduce((a, k) => a + String(slots[k] || '').length, 0)
      + (Array.isArray(slots.rows) ? slots.rows.join('').length : 0)
      + (Array.isArray(slots.chips) ? slots.chips.join('').length : 0)
    if (n > 60) return { ok: false, err: '第 ' + i + ' 段文案 ' + n + ' 字（>60）' }
    const bad = charset ? Array.from(new Set(Array.from(all).filter((c) => c.charCodeAt(0) > 127 && !set.has(c)))) : []
    if (bad.length) return { ok: false, err: '第 ' + i + ' 段有字表外的字：' + bad.join('') }
    delete slots.value; delete slots.unit; delete slots.kpi; delete slots.kpiTitle
    copy.push({ slots })
  }
  return { ok: true, summary, plan: pl.scenes.map((s) => ({ structure: s.structure, media: s.media, dur: s.dur })), copy }
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
  const plan = Array.isArray(vd.plan) ? vd.plan : []
  const copy = Array.isArray(vd.copy) ? vd.copy : []
  const estSec = Math.round(plan.reduce((a: number, s: any) => a + (Number(s.dur) || 0), 0)) || 30
  const body = {
    step: 'film_confirm',
    // ★VF_FILMCOPY_V1：数字（段数/时长）改成**按真实骨架算**，不再写死 30 秒/6 段
    hint: '第 3 步 / 共 3 步 · 确认出片（文案已按素材写好，先看一眼；不满意可「← 换风格」重写）',
    names: vd.names,
    n: vd.names.length,
    pack: vd.pack,
    packName: pk ? pk.name : '（自动按赛道挑）',
    estSec,
    estShots: plan.length || Math.max(4, Math.min(8, Math.ceil(Math.max(1, n) / 1.5))),
    cost: 0,
    topic: String(vd.topic || ''),
    // ★VF_FILMCOPY_V1：把「AI 素材总结 + 逐镜文案」一起下发 —— 用户**看过再点出片**（不再"乱出片"）
    summary: String(vd.summary || ''),
    plan,
    copy,
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
  /** ★VF_FILMCOPY_V1：写字用的模型入口（route.ts 的 genTextW → writer 模型档位）；不注入就只能报错不写文案 */
  generateText?: (p: string) => Promise<string>
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
      if (f.topic !== undefined) vd.topic = String(f.topic || '').slice(0, 60)
      // ★VF_FILMCOPY_V1（用户原话：「B该用模型就用模型。还有让 AI 先总结素材。**不要乱出片**」）：
      //   「下一步」不再直接出确认卡 —— **先让 AI 看图总结素材 + 按骨架写逐镜文案**，连同确认卡一起给用户看，
      //   用户看过、点「🎬 出片」才真出片。写文案失败 ⇒ **不出确认卡、不出片**（宁可不做，也不乱做）。
      const prep = await aiPrepareCopy(ctx, uid, vd)
      if (!prep.ok) {
        vfLog(uid, '[HTML成片] AI 写文案失败 → 未出片：' + String(prep.err || '').slice(0, 160))
        return '⚠️ HTML成片：这一步没能让 AI 按素材写好文案（' + String(prep.err || '').slice(0, 120)
          + '）——**没有出片**。可以稍后重试，或回上一步换一批素材 / 换风格。'
      }
      vd.summary = prep.summary
      vd.plan = prep.plan
      vd.copy = prep.copy
      vd.step = 'confirm'
      await saveHtmlFilmDraft(prisma, uid, vd)
      vfLog(uid, `[HTML成片] AI 已总结素材并写好 ${(prep.copy || []).length} 段文案 → 出确认卡（等用户点出片）`)
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
      // ★VF_FILMCOPY_V1：把确认卡上那份 AI 文案**按序号**并进骨架（用户看过的那一版，出片必须与之一致）
      copy: Array.isArray(vd.copy) && vd.copy.length ? vd.copy : undefined,
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
