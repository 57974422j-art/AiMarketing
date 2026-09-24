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

/* ==================== 类型（本线自己定义，不设共用类型文件） ==================== */

export interface VfVideoDraft {
  step: 'form' | 'script' | 'running'
  topic: string
  aspect: string            // portrait | landscape | auto
  dur: number
  voice: string
  theme: string
  bgm: string
  uploaded: string[]        // 本次上传的文件名（可选；仓库里的素材也会用）
  script: string
  brief: string             // 图文素材 + 视频理解结论（喂写文案/排分镜）
  shots?: any[]
  size?: number[]
  aspectResolved?: string
  cover?: number
  subLen?: number
  /** ★原声开关（用户定案"原声静音加个键"）：默认 false=静音（配音统一铺）。
   *  ⚠️ 置 true 需要渲染层支持"把视频原声压到 20~30% 并混进最后混音" → 放在第 3 步，先不假装生效。 */
  keepAudio?: boolean
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
  listRepoMaterials: (userId: number | string, limit?: number, mode?: 'spread' | 'recent') => Promise<any[]>
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

/* ==================== ② 入口判定（本线自己的词表） ==================== */

/** 本线入口词：视频混剪 / 用我的视频 / 视频+图片 之类 */
const VIDEO_LINE_ENTRY = /视频混剪|混剪|视频成片|用我的视频|我的视频(做|合成|剪|成片)|把.{0,6}视频.{0,6}(剪|混|合成)|视频.{0,3}(加|和|\+).{0,3}图片|图片.{0,3}(加|和|\+).{0,3}视频/
/** 别线的明确入口词 —— 出现这些一律不认领（优先级规则，历史事故：残留草稿吞掉别线的消息） */
const OTHER_LINE_ENTRY = /本地成片|素材成片|素材合成|素材智能成片|用我的素材|用我的素材库|用素材库|AI\s*制片|AI\s*成片|AI\s*制作|全部\s*AI|全\s*AI|素材\s*\+\s*AI|混合创作|发布|发到|发抖音|发小红书|发微博|发视频号|平台:/

export function matchesVideoLine(msg: string): boolean {
  const m = String(msg || '').trim()
  if (!m) return false
  // 协议串不是入口词（卡片提交要靠"本线有草稿"来认领）
  if (/^(VF_FORM|VF_JSON|MAKE_VIDEO|VF_EDIT|VF_BRIEF)/.test(m)) return false
  if (OTHER_LINE_ENTRY.test(m)) return false
  return VIDEO_LINE_ENTRY.test(m)
}

/** 本线是否该接管这一轮（有本线草稿 → 一定接管，否则草稿永远卡住） */
export async function shouldTakeOverVideoLine(db: any, uid: number, userMessage: string): Promise<boolean> {
  const m = String(userMessage || '')
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
const ENTRY_STRIP = /视频混剪|混剪|视频成片|用我的视频|我的视频|本地成片|素材合成|帮我做.{0,3}(一条|个|条)?视频|帮我成片|帮我做视频|做一条视频|做个视频|做成片|做个宣传片/g

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
    source: 'repo',
  })
}

/* ==================== ⑤ 起草（写文案 → 排分镜 → 确认卡） ==================== */

async function draftAndCard(ctx: VfVideoCtx, vd: VfVideoDraft, retryHint = ''): Promise<string> {
  const { uid } = ctx
  const dur = Math.max(5, Math.min(900, Number(vd.dur) || 30))

  // ── 1) 素材：图片 + 视频（视频要探测元信息 + 抽帧看懂内容）──
  const mats = await ctx.listRepoMaterials(uid, 30)
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
    `⑤text 是画面大字：4~8 字的完整短语，不要从文案截半句、不要标点\n` +
    `⑥只输出严格 JSON 数组（不要 markdown、不要解释）\n` +
    `⑦【视频要用够】有视频可用时，视频镜不少于总镜数的 1/3（你自己的实拍比图更有说服力）；\n` +
    `   但也不要把画面全给视频（视频镜不超过 2/3，避免整片都是同一支片子）\n\n编镜依据（文案）：\n${script}`
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
      const want = clampNum(s?.dur, 1.5, 60, 5)
      // ★VF_VIDFIT_V1（2026-09-24 用户实拍「有 3 分钟的视频」）：这一镜**最终**多长，取决于
      //   【配音真实时长】（tts 回填）≈ 字幕字数 ÷ 4.5 —— 而不是 AI 写的 dur。
      //   旧写法只看 dur：AI 把 vstart 定在片尾附近、字幕又写长了 → 片段不够用 →
      //   渲染层只能放慢/循环（观感立刻变差，这正是"片段没法完整播完"的来源）。
      //   现在按"预期配音时长"反推起点上限：需要多长就往前让多少，从源头避免贴尾切。
      const expect = Math.round((sub.length / 4.5) * 10) / 10
      const needLen = Math.min(60, Math.max(want, expect))
      const start = clampNum(s?.vstart, 0, Math.max(0, real - needLen), 0)
      // 片段不够长 → 用"这段能给的"为准（渲染层还有放慢/循环兜底）；太长就按 needLen 截
      const maxLen = real > 1 ? Math.max(1.5, real - start) : needLen
      const len = real > 1 ? Math.min(needLen, maxLen) : needLen
      // src_dur = 片段自身总长（渲染层用它判断"要不要放慢/循环兜底"）；vstart = 从第几秒开始
      // _ci = 用的是第几个视频（下面按需下载/降级用，写完就删）
      shotsOut.push({
        type: 'video', src: c?.path || '', _ci: i0, src_dur: Math.round(real * 100) / 100,
        vstart: Math.round(start * 100) / 100, dur: Math.round(len * 100) / 100, text: big, subtitle: sub,
      })
    } else if (imgPaths.length) {
      const i = parseInt(s?.pick) - 1
      const p = imgPaths[i >= 0 && i < imgPaths.length ? i : (shotsOut.length % imgPaths.length)]
      shotsOut.push({ type: 'bgimage', src: p, text: big, subtitle: sub, dur: clampNum(s?.dur, 2, 8, 5) })
    } else {
      shotsOut.push({ type: 'title', text: big || sub.slice(0, 8), subtitle: sub, dur: 4 })
    }
  }

  // ── 5.5) ★VF_VIDONDEMAND_V1（2026-09-24）：只下载【真的排进分镜】的视频。
  //   长视频动辄几百 MB，V1 是"用不用得着都先把 8 条全下下来"→ 起草卡在请求里（还可能超时）。
  //   现在：探测/抽帧走 OSS 直链（零下载），等 AI 排完分镜，只下它真正用到的那几条。
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
  const estSec = Math.round(subLen / 4.5)

  // ── 7) 存草稿 + 出确认卡（复用素材线的分镜卡，客户端零改动）──
  vd.script = script
  vd.brief = brief
  vd.shots = shotsOut
  vd.size = size
  vd.aspectResolved = aspect
  vd.cover = cover
  vd.subLen = subLen
  vd.step = 'script'
  VF_VIDEO_DRAFT.set(uid, vd)
  await saveVfVideoDraft(ctx.prisma, uid, vd)
  const nV = shotsOut.filter((s) => s.type === 'video').length
  ctx.log(uid, `[VF-V] 分镜 ${shotsOut.length} 镜（视频 ${nV} 镜 / 图片 ${shotsOut.length - nV} 镜）覆盖 ${Math.round(cover * 100)}%`)
  return ctx.vfScriptCard(
    { ...vd, voiceList: ctx.voiceList, source: '' },
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
        if (f.aspect) vd.aspect = String(f.aspect)
        if (f.dur) vd.dur = Math.max(5, Math.min(900, parseInt(f.dur) || 30))
        if (f.voice) vd.voice = String(f.voice)
        if (f.theme) vd.theme = String(f.theme)
        if (f.bgm) vd.bgm = String(f.bgm)
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

    // ── 卡2：确认 → 出片（入队即作废本线草稿，避免终身吞消息）──
    if (vd.step === 'script' && FLOW_WORD.test(String(userMessage).trim())) {
      if (!vd.shots?.length) return '视频混剪：分镜还没排好，先不出片。回「重试」我再排一次。'
      VF_VIDEO_DRAFT.delete(uid)
      await clearVfVideoDraft(ctx.prisma, uid)
      ctx.log(uid, '[VF-V] 已入队 → 本线草稿作废')
      const run = await ctx.executeToolCall('make_ai_video', {
        plan: JSON.stringify({ size: vd.size || [720, 1280], fps: 25, shots: vd.shots }),
        script: vd.script,
        theme: vd.theme,
        speaker: vd.voice,
        bgm: vd.bgm,
        duration: vd.dur,
        confirmed: true,
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
