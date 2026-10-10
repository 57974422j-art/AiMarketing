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
// ★VF_CHARSET_V1（2026-10-09 用户实测「降级之后照样被 fonts 闸门拦」）：
//   把文案压回字体子集内的**唯一实现**（涮→烫、其余表外字删掉；只做减法不编造）
import { loadCharset, sanitizeText, sanitizeSlots } from './charset'

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
function deriveCopyFromSummary(summary: string, scenes: Array<{ structure: string; media: string[] }>): any[] {
  const set = loadCharset(path.join(filmToolsDir(), 'fonts', 'chars-cmn.txt'))
  const raw = String(summary || '')
    .split(/[\n；;，。,.、:：]+/).map((s) => s.replace(/^\s*[\d.、)）]+\s*/, '').trim())
  const all = raw.filter((s) => s.length >= 2)
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

/** ★VF_FILMCOPY_V1（2026-10-09 用户定案 B：「该用模型就用模型。还有让 AI 先总结素材。不要乱出片」）
 *  —— AI「先总结素材 → 再写逐镜文案」，**任一步不过就不许出片**。
 *   ① 看图：qwen-vl-max 一次读前 8 张（describeImagesWithVL）→ 一句话总结 + 逐张一句；
 *   ② 骨架：planFilm()（**只出骨架、不渲染**）→ 每段结构 + 该段素材；
 *   ③ 写文案：generateText（writer 档位）按骨架填 slots；
 *   ④ 服务端校验：解析 + 每镜 ≤60 字 + 用字在字表内 + 无 emoji + **剥掉任何数字卡字段**（红线：不许编造数据）。
 *  ⚠️ 与 scripts/vf-film-gen.mjs 同一套硬规矩；区别：那边让模型**排分镜**，这里骨架已定、只让模型**填文案**。 */
async function aiPrepareCopy(ctx: HtmlFilmCtx, uid: number | string, vd: HtmlFilmDraft):
Promise<{ ok: boolean; err?: string; summary?: string; plan?: any[]; copy?: any[]; warn?: string }> {
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
    'plate-top     ★完整大图（图整张不裁 · 标题在图**上方**）：slots{eyebrow,title,sub,chips[1~4],foot} media=1 张',
    'plate-bottom  ★完整大图（图整张不裁 · 文案在图下方）：slots{eyebrow,title,sub,chips[1~4],foot} media=1 张',
    'fullbleed     满幅实拍（**裁切**满屏）：slots{eyebrow,title,sub,chips[1~4],foot}  media=1 张',
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
    + '5. 只回一个 JSON 数组（长度 = 段数），元素形如 {"slots":{...}}；不要 markdown 围栏、不要解释。\n'
    // ★VF_VOICE_SPOKEN_V1（2026-10-09 用户实测「字幕/配音 = 画面大字，音画完全重复」）：
    //   **让模型多写一句"口播句"** —— 画面大字是"看"的（短、可断句、可横排），
    //   口播是"听"的（成句、口语、念得顺）。给了它，配音和字幕就不再是"念画面字"了。
    + '6. **每一段再多给一个 `voice`（口播句）**：一句自然口语（≤18 字、像人在说话、念得顺），'
    + '**不要照抄画面大字**，也不许编造数据/品牌/门店名。写法：{"slots":{…,"voice":"…"}}'
    + '（有 voice 就用 voice 配音；没给就退回念画面大字）。\n'
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
  const planOut = pl.scenes.map((s) => ({ structure: s.structure, media: s.media, dur: s.dur }))
  let arr: any[] | null = null
  let why = ''
  for (let attempt = 1; attempt <= 2 && !arr; attempt++) {
    let txt = ''
    try {
      txt = await ctx.generateText(attempt === 1
        ? prompt
        : prompt + '\n\n⚠️ 上一次你的输出不合法（' + why + '）。这次**只回一个 JSON 对象**：{"scenes":[{"slots":{…}}]} —— 不要任何解释、不要 markdown 围栏、不要多余的数组。')
    } catch (e: any) {
      why = '模型调用失败：' + String(e?.message || e).slice(0, 80)
      break   // 模型都调不通 ⇒ 环境问题，走失败（不该硬造一条片）
    }
    const got = parseArr(txt)
    if (!got) { why = why || '不是合法 JSON'; continue }
    if (got.length !== pl.scenes.length) { why = '段数 ' + got.length + ' ≠ ' + pl.scenes.length; continue }
    arr = got
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
  if (arr) {
    for (let i = 0; i < arr.length; i++) {
      let slots: any = Object.assign({}, (arr[i] || {}).slots || {})
      if (set.size) {
        const r = sanitizeSlots(slots, set)
        slots = r.slots
        for (const d of r.drops) fixed.push('第 ' + i + ' 段 ' + d.k + '「' + d.from + '」→「' + d.to + '」')
      }
      const all = JSON.stringify(slots)
      if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(all)) { why = '第 ' + i + ' 段带 emoji'; copy.length = 0; break }
      const n = ['eyebrow', 'title', 'title1', 'title2', 'sub', 'tail', 'foot'].reduce((a, k) => a + String(slots[k] || '').length, 0)
        + (Array.isArray(slots.rows) ? slots.rows.join('').length : 0)
        + (Array.isArray(slots.chips) ? slots.chips.join('').length : 0)
      if (n > 60) { why = '第 ' + i + ' 段 ' + n + ' 字（>60）'; copy.length = 0; break }
      delete slots.value; delete slots.unit; delete slots.kpi; delete slots.kpiTitle
      copy.push({ slots })
    }
  }
  if (!copy.length && !arr) {
    // ③ 降级：用读图总结拼一版（不卡死、也不编造）
    if (!summary) return { ok: false, err: '文案模型没给出可用结果（' + why + '），且没有读图总结可兜底' }
    vfLog(uid, '[HTML成片] AI 文案降级为"读图拼句"：' + why)
    return { ok: true, summary, plan: planOut, copy: deriveCopyFromSummary(summary, pl.scenes),
      warn: '⚠️ 这版文案没能由 AI 写好（' + why + '），已按**读图结果**自动拼了一版；建议点「← 换风格」重试一次。' }
  }
  if (!copy.length) {
    if (!summary) return { ok: false, err: 'AI 文案没过校验（' + why + '），且没有读图总结可兜底' }
    vfLog(uid, '[HTML成片] AI 文案没过校验 → 降级为"读图拼句"：' + why)
    return { ok: true, summary, plan: planOut, copy: deriveCopyFromSummary(summary, pl.scenes),
      warn: '⚠️ 这版文案没过校验（' + why + '），已按**读图结果**自动拼了一版；建议点「← 换风格」重试一次。' }
  }
  // ★VF_CHARSET_V1：如实告知"哪几处被压回字表"（不悄悄改文案，也不因此卡住出片）
  const warnFix = fixed.length
    ? ('ℹ️ 有 ' + fixed.length + ' 处用字不在引擎字体子集内，已自动压回（涮→烫 / 表外字删掉，只做减法不换词）：'
      + fixed.slice(0, 4).join('；') + (fixed.length > 4 ? ' …' : ''))
    : ''
  return { ok: true, summary, plan: planOut, copy, warn: warnFix }
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
  const n = vd.names.length || 12
  const plan = Array.isArray(vd.plan) ? vd.plan : []
  const copy = Array.isArray(vd.copy) ? vd.copy : []
  // ★VF_FILMEST_V2：先按"文案字数"估（贴近实测），估不出来才退回"骨架声明时长相加"
  const estSec = estimateVoiceSec(copy)
    || Math.round(plan.reduce((a: number, s: any) => a + (Number(s.dur) || 0), 0)) || 30
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
      // ★VF_FILMCOPY_V2：降级时带一句"这版是自动拼的"（如实告知，别让用户以为 AI 正常工作了）
      ;(vd as any).warn = String(prep.warn || '')
      await saveHtmlFilmDraft(prisma, uid, vd)
      vfLog(uid, `[HTML成片] AI 已总结素材并写好 ${(prep.copy || []).length} 段文案${prep.warn ? '（降级）' : ''} → 出确认卡（等用户点出片）`)
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
