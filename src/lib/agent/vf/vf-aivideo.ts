// ★VF_AILINE_V1（2026-09-21）：【AI 制片】—— 完全独立的一条线
//
// 用户定案（原话）：
//   「把现在的视频状态机先不动，抽你需要的做 AI 制片。不用制作牵涉太广。」
//   「不要设计公用层……最怕你们设计了共用，不如不拆，出问题都不能用。」
//   「第一输入主题按主题来，没输入看素材库，知道这个用户平时是干什么的……然后确认横屏竖屏、
//     确认时长、确认风格。**风格不要什么深蓝深青这些**，用真正的**广告/日常/影视级**风格来定义，
//     譬如动画，这些**制片风格**加一些标签。然后让 AI 按文案做分镜、收尾帧，这些再确认。」
//   「素材是让 AI 知道这人干什么的、要做什么题材；**上传素材是为了防止有些用户素材库混乱**
//     （平时美食、旅游等记录乱七八糟都放个人仓库，导致 AI 写文案混乱）。」
//   「配音/配乐保持自动（不上卡）；配乐牵扯版权，让 AI 自己配，能留个音乐类型就行。」
//
// ── 本文件的设计约束 ────────────────────────────────────────────────────
//   1. **自成一套**：入口 / 草稿 / 文案 / 分镜 / 确认卡 / 出片全在本文件。
//   2. **零 import**：prisma / 工具函数全部由 `ctx` 注入 → **不可能连累其它两条线**。
//      （代价：**每个引用的常量都必须在本文件定义** —— 曾因跨文件引用 `TOOL_INTENT` 踩过 ReferenceError）
//   3. **自己的草稿**：内存 Map + DB tag `vf_draft_ai`（与 `vf_draft` / `vf_draft_mix` 都不同）。
//   4. **内部绝不 throw**：异常转成人话返回 + 写日志。
//
// ── 流程（用户定的 3 步） ──────────────────────────────────────────────
//   卡1 `ai_setup`  主题（可留空→看素材库/上传图推断"我猜你在做 XX"）+ 上传素材（可选）
//   卡2 `ai_opts`   文案写好后：**横屏/竖屏 + 时长 + 成片风格**（一张卡；配音/配乐不上卡）
//   卡3 `script`    分镜清单（含收尾镜）+ 约 X 点 → 确认出片
//
// ── AI 制片**仍然看素材**，但只看"干净的依据" ──────────────────────────
//   素材在中作是【知道你在做什么题材】。**若用户上传了图 → 只看上传的**（避免仓库里
//   美食/旅游/日常混杂把文案带偏）。**上传的图不入片** —— AI 制片画面全部由 AI 生成。

/* ==================== 类型（本线自己定义，不设共用类型文件） ==================== */

export interface VfAiDraft {
  step: 'ai_setup' | 'ai_opts' | 'script' | 'running'
  topic: string
  aspect: string          // portrait | landscape
  dur: number
  /** ★成片风格标签（用户定案：广告/日常/影视级…；空 = AI 自动挑） */
  style: string
  voice: string
  theme: string           // 配色（保留但不上卡：仍决定字幕色/压暗，跟风格自动配）
  bgm: string
  musicType: string       // ★音乐类型（用户定案："能留个音乐类型就行"）
  script: string
  uploaded: string[]      // ★用户本次上传的文件名（只当"干净的依据"，不入片）
  source: 'ai'
  shots?: any[]
  size?: number[]
  aspectResolved?: string
  brief?: string
  cover?: number
  subLen?: number
  styleResolved?: string
}

/** 依赖注入：由 route.ts 提供（本文件不 import 项目内部路径，避免循环依赖/路径写错） */
export interface VfAiCtx {
  uid: number
  userMessage: string
  auth: any
  /** 数据库客户端（由 route.ts 注入 —— 是"连接"，不是共用业务逻辑） */
  prisma: any
  executeToolCall: (name: string, args: Record<string, any>, auth: any) => Promise<string>
  genVideoShots: (o: {
    uid: number | string; aspect: string; dur: number; shotN: number
    imgPaths: string[]; brief: string; script: string
    /** ★VF_AIONLY_V1（2026-09-21）：AI 制片 = 文生视频 → 只产出"不需要素材图"的卡型 */
    aiOnly?: boolean
    retryHint?: string; wantPrompt?: boolean
  }) => Promise<any[]>
  generateText: (prompt: string) => Promise<string>
  vfScriptCard: (vd: any, shots: any[], imgN: number, brief: string, aspect: string, cover?: number, estSec?: number) => string
  log: (uid: number | string, msg: string) => void
  voiceList: any[]
  listRepoMaterials: (userId: number | string, limit?: number, mode?: 'spread' | 'recent') => Promise<any[]>
  summarizeMaterials: (userId: number | string, mats: any[], visN: number) => Promise<string>
  probeMaterialSizes: (userId: number | string, mats: any[]) => Promise<any>
  downloadMaterials: (userId: number | string, mats: any[]) => Promise<any[]>
  splitScript: (script: string, n: number, maxLen?: number) => string[]
  parseForm: (userMessage: string) => Record<string, any> | null
}

/* ==================== ① 成片风格（★本线自己一份；用户要我"补充成片风格"） ==================== */

/** 成片风格标签 → 喂给 AI 生成画面的英文关键词 + 建议的配色（theme）与音乐类型 */
export const AI_STYLES: Array<{ id: string; name: string; en: string; theme: string; music: string; desc: string }> = [
  { id: 'cinematic', name: '影视级', en: 'cinematic, film grain, dramatic lighting, shallow depth of field, anamorphic', theme: 'dark', music: '史诗感/弦乐', desc: '品牌大片、要高级感' },
  { id: 'commercial', name: '广告片', en: 'commercial product shot, clean studio lighting, glossy, hero angle, macro detail', theme: 'light', music: '轻快电子', desc: '卖货、促销、产品展示' },
  { id: 'vlog', name: '日常记录', en: 'casual vlog, natural light, handheld camera, real life, soft tones', theme: 'light', music: '清新民谣', desc: '探店、日常、真人感' },
  { id: 'anime', name: '动画', en: 'anime style, 2D illustration, cel shading, vivid colors, clean line art', theme: 'dark', music: '活泼电子', desc: '抽象概念、年轻向' },
  { id: 'toy3d', name: '3D 潮玩', en: '3D render, claymation, toy-like, soft studio light, pastel palette', theme: 'light', music: '可爱轻音', desc: '产品、可爱、年轻' },
  { id: 'tech', name: '科技感', en: 'futuristic, neon glow, holographic UI, cyber, dark background with cyan accents', theme: 'tech', music: '科技律动', desc: '软件、AI、数码' },
  { id: 'documentary', name: '纪实访谈', en: 'documentary style, interview framing, natural skin tones, available light', theme: 'light', music: '舒缓钢琴', desc: '人物故事、客户案例' },
  { id: 'ink', name: '国风水墨', en: 'ink painting, hand-drawn, oriental, minimal, rice paper texture', theme: 'light', music: '古风民乐', desc: '文化、文艺、茶叶养生' },
]

function styleOf(id: string) {
  return AI_STYLES.find((s) => s.id === id) || null
}

/* ==================== ② 草稿（本线自己一份） ==================== */

const VF_AI_DRAFT = new Map<number, VfAiDraft>()
const VF_AI_TAG = 'vf_draft_ai'          // ★与素材合成的 'vf_draft' 分开 → 绝不串线

async function saveVfAiDraft(db: any, uid: number | string, d: VfAiDraft): Promise<void> {
  const content = 'AI制片草稿:' + JSON.stringify(d)
  try {
    const ex = await db.agentMemory.findFirst({ where: { userId: String(uid), tags: { contains: VF_AI_TAG } } })
    if (ex) await db.agentMemory.update({ where: { id: ex.id }, data: { content } })
    else await db.agentMemory.create({ data: { userId: String(uid), content, tags: VF_AI_TAG, salience: 0.5 } })
  } catch { /* 草稿存不上不影响本轮 */ }
}

async function loadVfAiDraft(db: any, uid: number | string): Promise<VfAiDraft | null> {
  try {
    const dm = await db.agentMemory.findFirst({ where: { userId: String(uid), tags: { contains: VF_AI_TAG } }, orderBy: { updatedAt: 'desc' } })
    if (dm?.content) return JSON.parse(String(dm.content).replace(/^AI制片草稿:/, ''))
  } catch { /* ignore */ }
  return null
}

export async function clearVfAiDraft(db: any, uid: number | string): Promise<void> {
  VF_AI_DRAFT.delete(Number(uid))
  try { await db.agentMemory.deleteMany({ where: { userId: String(uid), tags: { contains: VF_AI_TAG } } }) } catch { /* ignore */ }
}

/* ==================== ③ 入口判定（本线自己的词表） ==================== */

/** 工具类意图（不是"出成片"）—— ★本文件自己一份（零 import 铁律） */
const TOOL_INTENT = /(写|生成|做).{0,4}(文案|脚本|标题|话题)|海报|图片|插画|今日热点|热点|数字人|口播视频|背景音乐|配乐|BGM|搜一下|搜索|记录一件事|记一下|提醒/
function isToolIntentOnly(m: string): boolean {
  // ★VF_PROTO_V1（2026-09-21）：**协议串（卡片提交）不是"工具意图"** —— 否则表单里带的【文案正文】
  //   只要出现"写标题/海报/图片"这类词，整条消息就被判成"用户想写文案" → 本线不认领 →
  //   连 skipModelStep1 的 vfLineWord 也变 false → 掉出状态机（用户实测：AI 制片走到"下一步"就断）。
  if (/^(VF_FORM|VF_JSON)\s*[:{]/.test(String(m || '').trim())) return false
  return TOOL_INTENT.test(m) && !/成片|制片|做视频|做个视频|做一条视频|剪辑|出片/.test(m)
}

/** 是否"AI 制片"意图 */
export function matchesAiLine(msg: string): boolean {
  const m = String(msg || '')
  if (/发布|发到|发抖音|发小红书|发微博|发视频号|平台:/.test(m)) return false
  if (isToolIntentOnly(m)) return false
  if (/AI\s*制片|AI\s*成片|全部\s*AI|全\s*AI|纯\s*AI|整片\s*AI|AI\s*制作|AI\s*生成/.test(m)) return true
  if (/(用|帮我用|通过|走)\s*AI\s*.{0,8}(做|生成|制作|拍|出).{0,6}视频/.test(m)) return true
  if (/AI\s*.{0,6}(做|制作|生成|出).{0,6}视频/.test(m)) return true
  return false
}

export async function hasAiDraft(db: any, uid: number): Promise<boolean> {
  if (VF_AI_DRAFT.has(uid)) return true
  const d = await loadVfAiDraft(db, uid)
  if (d?.step) { VF_AI_DRAFT.set(uid, d); return true }
  return false
}

/** 本线是否该接管这一轮（有本线草稿 → 一定接管，否则草稿会永远卡住） */
export async function shouldTakeOverAiLine(db: any, uid: number, userMessage: string): Promise<boolean> {
  const m = String(userMessage || '')
  // ★VF_FORM_OWNER_V1（2026-09-21 用户实测第二轮：还是接错）：三条线【共用 `VF_FORM:` 前缀】，
  //   所以【表单提交】必须按【字段】认领归属，不能只看前缀（我上一轮只加"入口词排除"，漏了这条）。
  //   素材线的表单字段 = source/voice/theme/bgm（三线里只有它用这几个）；
  //   AI 线的表单 = {topic,uploaded?}（卡1）或 {script,aspect,dur,style}（卡2）。
  //   → 只要表单带素材线字段，本线【绝不接管】。
  const _fm = m.trim().match(/^VF_FORM:(\{[\s\S]*\})/)
  if (_fm) {
    try {
      const f = JSON.parse(_fm[1] || '{}')
      if (('source' in f) || ('voice' in f) || ('theme' in f) || ('bgm' in f)) return false
    } catch { /* 解析失败 → 交给后面的判断 */ }
  }
  // ★VF_ENTRY_PRIORITY_V1（2026-09-21 用户实测指出）：【别线的明确入口词】优先于【本线残留草稿】。
  //   问题：原来第一句就是"有本线草稿 → 一定接管" → AI 线草稿一残留，就把【所有】消息吞掉：
  //        用户说「用本地成片帮我做一条视频」（明明是素材智能成片的词，素材线 vfIntent=true）
  //        却被 AI 线抢走，回一句"请点开始出片" —— 素材线永远进不去（用户实测"进入不了状态机"）。
  //   规则：消息明确带【素材线】的词 → 本线不接管（让素材线接手）。
  //   （MIX 线早就这么做了：vf-mix.ts 的 matchesMixLine 里先排除"素材合成/素材智能成片/用我的素材库"）
  if (/本地成片|素材成片|素材合成|素材智能成片|用我的素材|用我上传的素材|用素材库/.test(m)) return false
  // ★VF_AI_RUNCLOSE_V1（2026-09-21 用户实测：素材线的「确认」被本线抢走 → 回"AI 制片已在后台生成中"）：
  //   本线"有草稿必接管"本身没错，但**入队后草稿停在 running 且没人收尾**（僵尸）→
  //   它会【终身】吞掉所有消息（含别线的「确认」）。→ running 草稿一律视为僵尸：自清 + 不接管。
  //   （本线现在"入队即清草稿"，所以只剩历史僵尸与"渲染中"这一瞬，绝不再吞别线的确认。）
  if (await hasAiDraft(db, uid)) {
    const _d = await loadVfAiDraft(db, uid)
    if (_d?.step === 'running') {
      await clearVfAiDraft(db, uid)
      return matchesAiLine(m)
    }
    return true
  }
  return matchesAiLine(m)
}

/* ==================== ④ 常量 ==================== */

const AI_FLOW_WORD = /确认|开始|生成吧|出片|就这个|^行$|^好$|^OK$|可以|下一步|强制出片/i
/** ★剥"AI 制片"这类入口词 —— 之前只剥了「AI 制作」，导致「AI 制片」被当成主题（用户实测） */
const AI_ENTRY_WORDS = /全部\s*AI|全\s*AI|纯\s*AI|整片\s*AI|AI\s*制片|AI\s*成片|AI\s*制作|AI\s*生成/g
const VIDEO_WORDS = /本地成片|帮我做.{0,3}(一条|个|条)?视频|帮我成片|帮我做视频|做一条视频|做个视频|做成片|做个宣传片/g

/* ==================== ⑤ 主流程 ==================== */

export async function handleAiLine(ctx: VfAiCtx): Promise<string> {
  const { uid, userMessage } = ctx
  try {
    let vd = VF_AI_DRAFT.get(uid)
    if (!vd) { const r = await loadVfAiDraft(ctx.prisma, uid); if (r?.step) { vd = r; VF_AI_DRAFT.set(uid, vd) } }

    // ★VF_EXIT_V1（2026-09-21 用户实测指出）：卡住时的【退出口】。
    //   原来没有退出口 → 只要本线有草稿，这一线就永远占着这一轮（用户："进入不了状态机了"）。
    //   用户说这些词 → 清本线草稿，回到可重新开始的状态（不动别线草稿）。
    if (vd && /^(重新开始|取消|退出|重来|不做了|算了|清空|重置|退出制片)$/.test(String(userMessage).trim())) {
      await clearVfAiDraft(ctx.prisma, uid)
      try { ctx.log(uid, '[VF-A] 用户取消 → 本线草稿已清（不影响素材线/混合线）') } catch { /* ignore */ }
      return '已退出 AI 制片（本线草稿已清）。想重来就说「AI 制片」；想用素材成片说「用本地成片帮我做一条视频」。'
    }

    // ★VF_AILINE_RESTART_V1（2026-09-21 用户实测：说「AI 制片帮我做一条视频」被回
    //   「AI 制片：请在上面选好 横竖屏/时长/风格，点「下一步」」）：
    //   **根因** —— 上一轮残留在 `ai_opts`（或 `script`）的草稿把【新指令】吞了：不进起稿，
    //   直接落到那一步的兜底话术。素材线早就有"入口词 → 清草稿重来"（route.ts 的 vfIntent），
    //   **本线漏了**（又是"只接了一半"）。
    //   规则：**本线入口词 = 再开一条**（不是"继续上一条"）→ 作废旧草稿，走起稿发主题卡。
    //   注意：只认入口词 —— 「确认 / 下一步 / VF_FORM」这些**绝不**重置，否则会打断正在进行的流程。
    if (vd && matchesAiLine(userMessage)) {
      await clearVfAiDraft(ctx.prisma, uid)
      vd = undefined
      try { ctx.log(uid, '[VF-A] 检测到本线入口词 → 旧草稿作废，重新起稿（=再做一条）') } catch { /* ignore */ }
    }

    /* ── 第 1 步：起稿（还没有草稿）→ 发"主题卡"（主题 + 上传素材） ── */
    if (!vd) {
      const topic = String(userMessage)
        .replace(AI_ENTRY_WORDS, '')
        .replace(VIDEO_WORDS, '')
        .replace(/^(用|请用|请|来|帮我|帮忙|给我|麻烦)\s*/, '')
        .replace(/^[\s:：,，,。、]+/, '').trim()

      let guess = ''
      if (!topic) {
        // ★用户定案：没输入主题 → 看素材库（上传的优先），推断"这人平时在做什么"
        //   注意：**只做一句推断、用户可改**；不做画像（用户："先不画像，画像不完整，怕四不像"）
        try {
          const mats = await ctx.listRepoMaterials(uid, 20, 'recent')
          const visN = Math.min(8, Math.max(3, (mats || []).length))
          const brief = await ctx.summarizeMaterials(uid, (mats || []).slice(0, 12), visN)
          if (brief && String(brief).trim().length >= 2) {
            const g = await ctx.generateText(
              `下面是某位用户素材库里的内容摘要。请用【不超过 18 个字】一句话猜"他平时是做什么生意/做什么题材的内容"，` +
              `只输出这一句话，不要解释、不要标点以外的任何文字。\n摘要：\n${String(brief).slice(0, 800)}`)
            guess = String(g || '').trim().replace(/^["'「]|["'」]$/g, '').slice(0, 30)
            ctx.log(uid, `[VF-A] 没给主题 → 按素材库猜："${guess}"`)
          }
        } catch (e: any) {
          ctx.log(uid, '[VF-A] 素材库推断失败（不影响）: ' + String(e?.message || e).slice(0, 120))
        }
      }

      vd = {
        step: 'ai_setup', topic: topic || guess, aspect: 'portrait', dur: 30,
        style: '', voice: 'longxiaochun', theme: 'dark', bgm: 'auto', musicType: '',
        script: '', uploaded: [], source: 'ai',
      }
      VF_AI_DRAFT.set(uid, vd)
      await saveVfAiDraft(ctx.prisma, uid, vd)
      ctx.log(uid, `[VF-A] 起稿（AI 制片）topic="${vd.topic.slice(0, 30)}"（guess=${guess ? '有' : '无'}）`)
      return 'VF_JSON:' + JSON.stringify({
        step: 'ai_setup', aiLine: true, topic: vd.topic, guess: guess || '',
        hint: guess
          ? `我没看到主题，**按你的素材库猜的**：「${guess}」（不对就直接改）。其余（画面/文案/分镜/配音/字幕/配乐）全自动。`
          : '你说个主题就行（留空我就看你的素材库猜）。其余（画面/文案/分镜/配音/字幕/配乐）全自动。',
        hintUpload: '如果素材库里啥都有（美食/旅游/日常混着），**上传几张这次的图**，我就只看这几张，文案不会被带偏。',
      })
    }

    /* ── 第 2 步：主题卡提交（VF_FORM:{topic,uploaded}）→ 写文案 → 发"选项卡" ── */
    const f = ctx.parseForm(userMessage)
    if (f && (vd.step === 'ai_setup' || vd.step === 'ai_opts' || vd.step === 'script')) {
      if (typeof f.topic === 'string' && f.topic.trim()) vd.topic = f.topic.trim().slice(0, 300)
      if (Array.isArray(f.uploaded)) vd.uploaded = f.uploaded.map((x: any) => String(x)).slice(0, 30)

      // 第一部分：主题卡 → 写文案 → 发选项卡
      if (vd.step === 'ai_setup') {
        if (!vd.script) {
          const need = Math.round((Number(vd.dur) || 30) * 4.5)
          let brief = ''
          try {
            const mats = await ctx.listRepoMaterials(uid, 40, vd.uploaded.length ? 'recent' : 'spread')
            const use = vd.uploaded.length
              ? (mats || []).filter((m: any) => vd.uploaded.includes(String(m.name)))   // ★只看上传的
              : (mats || [])
            if (vd.uploaded.length) ctx.log(uid, `[VF-A] 只看本次上传的 ${use.length}/${vd.uploaded.length} 张（不被仓库杂图带偏）`)
            brief = await ctx.summarizeMaterials(uid, use.slice(0, 12), Math.max(3, Math.min(10, Math.round((Number(vd.dur) || 30) / 30) * 5)))
          } catch { /* ignore */ }
          vd.brief = String(brief || '').slice(0, 1200)
          // ★VF_AIONLY_V1（2026-09-21 用户定案）：AI 制片是**文生视频** ——
          //   「除了第一步看用户，其它都不拿个人仓库素材」→ 写文案**不再喂素材摘要**，
          //   题材已经由第一步（看素材猜出的）【主题】承载了。
          const p = `你是短视频编导。为「${vd.topic || 'AI 营销'}」写一条约 ${vd.dur} 秒的口播文案，` +
            `**约 ${need} 字**（中文配音约 4.5 字/秒），口语化、开场 3 秒抓人、结尾有行动号召。` +
            `\n只输出文案本身，不要标题、不要解释、不要 markdown。`
          vd.script = String(await ctx.generateText(p) || '').trim().slice(0, 4000)
          // ★VF_AIDUR_V1（2026-09-21 用户实测：选 10 秒，AI 却写了 83 字 ≈ 18 秒 → 成片预计 25 秒）：
          //   AI 制片线原来**没有任何"按目标字数"的护栏**（素材线有压缩 + 硬截）→ 时长永远不可控。
          //   这里补同口径的两道：超 1.15 倍让 AI 压缩；仍超 1.35 倍就按句末硬截到 1.1 倍。
          //   （中文配音约 4.5 字/秒 → 字数就是时长，所以护栏必须卡在文案这一步。）
          try {
            if (vd.script.length > need * 1.15) {
              const _sh = String(await ctx.generateText(
                `把下面这段口播文案【压缩】到 ${need} 字（现在 ${vd.script.length} 字，必须删掉约 ${vd.script.length - need} 字）。` +
                `要求：① 保留核心卖点 ② 删掉重复表达与铺垫 ③ 保持原顺序和「。」「！」断句 ④ 只输出压缩后的文案本身，不要解释。\n原文：${vd.script}`) || '').trim()
              if (_sh.length >= need * 0.6 && _sh.length < vd.script.length) {
                ctx.log(uid, `[VF-A] 文案压缩 ${vd.script.length} → ${_sh.length} 字（目标 ${need}）`)
                vd.script = _sh.slice(0, 4000)
              }
            }
            if (vd.script.length > need * 1.35) {
              const _cut = vd.script.slice(0, Math.round(need * 1.1))
              const _lastP = Math.max(_cut.lastIndexOf('。'), _cut.lastIndexOf('！'))
              vd.script = _lastP > need * 0.6 ? _cut.slice(0, _lastP + 1) : _cut
              ctx.log(uid, `[VF-A] 文案硬截 → ${vd.script.length} 字（目标 ${need}）`)
            }
          } catch (e: any) {
            ctx.log(uid, '[VF-A] 文案时长护栏异常（不影响出片）: ' + String(e?.message || e).slice(0, 100))
          }
          ctx.log(uid, `[VF-A] 文案 ${vd.script.length} 字（目标 ${need}）`)
        }
        vd.step = 'ai_opts'
        VF_AI_DRAFT.set(uid, vd)
        await saveVfAiDraft(ctx.prisma, uid, vd)
        return 'VF_JSON:' + JSON.stringify({
          step: 'ai_opts', aiLine: true,
          topic: vd.topic, script: vd.script, dur: vd.dur, aspect: vd.aspect,
          styles: AI_STYLES.map((s) => ({ id: s.id, name: s.name, desc: s.desc })),
          hint: '文案写好了（可在下面直接改）。确认三件事：**横屏还是竖屏 / 时长 / 成片风格**（风格可不选，让 AI 自己挑）。',
        })
      }

      // 第二部分：选项卡 → 排分镜 → 发确认卡
      if (vd.step === 'ai_opts') {
        if (f.aspect) vd.aspect = String(f.aspect) === 'landscape' ? 'landscape' : 'portrait'
        if (f.dur) vd.dur = Math.max(5, Math.min(900, parseInt(f.dur) || 30))
        if (f.style !== undefined) vd.style = styleOf(String(f.style)) ? String(f.style) : ''
        if (f.script && String(f.script).trim()) vd.script = String(f.script).trim().slice(0, 4000)
        const st = styleOf(vd.style)
        if (st) { vd.theme = st.theme; vd.musicType = st.music }   // 配色/音乐类型跟风格自动走
        ctx.log(uid, `[VF-A] 选项 aspect=${vd.aspect} dur=${vd.dur} style=${vd.style || '(AI自选)'} → 排分镜`)
        return await draftAndCard(ctx, vd, '')
      }
    }

    /* ── 第 2.5 步：主题卡上用户【直接打字】给了主题 → 当成主题继续 ── */
    if (vd.step === 'ai_setup' && !f && !AI_FLOW_WORD.test(userMessage.trim())
        && userMessage.trim().length >= 2
        && !/^(竖屏|横屏|自动)$/.test(userMessage.trim())
        && !/^VF_JSON|^MAKE_VIDEO|^\{|^\[/.test(userMessage.trim())) {
      vd.topic = userMessage.trim().replace(VIDEO_WORDS, '').replace(/^[\s:：,，,。、]+/, '').trim().slice(0, 300)
      ctx.log(uid, `[VF-A] 对话里给了主题="${vd.topic.slice(0, 30)}" → 写文案`)
      VF_AI_DRAFT.set(uid, vd); await saveVfAiDraft(ctx.prisma, uid, vd)
      // 复用"主题卡提交"逻辑：直接进第 2 步的第一部分
      return await handleAiLine({ ...ctx, userMessage: 'VF_FORM:' + JSON.stringify({ topic: vd.topic }) })
    }

    /* ── 第 3 步：确认分镜 → 出片 ── */
    if (vd.step === 'script' && AI_FLOW_WORD.test(userMessage.trim())) {
      if (!vd.shots?.length) return 'AI 制片：分镜还没排好，先不出片。回「重试」我再排一次。'
      const cost = Math.max(1, Math.ceil(Math.max(4, Number(vd.dur) || 30) * 50))
      // ★VF_AI_RUNCLOSE_V1（2026-09-21）：入队即【作废本线草稿】——与素材线的 VF_RUN_CLOSE_V1 同款。
      //   进度由 <storage>/<uid>/video-factory/vf<ts>.json 独立跟踪，草稿留着没有用处；
      //   留着反而会让本线"有草稿必接管"终身吞掉后续所有消息（实测：素材线的「确认」被本线抢走）。
      VF_AI_DRAFT.delete(uid)
      await clearVfAiDraft(ctx.prisma, uid)
      try { ctx.log(uid, '[VF-A] 已入队 → 本线草稿作废（不再吞掉后续消息）') } catch { /* ignore */ }
      // ★显式传 source:'ai' + style（不读草稿去猜 —— 上次事故的根因就是"读错草稿"）
      const run = await ctx.executeToolCall('make_ai_video', {
        plan: JSON.stringify({ size: vd.size || [720, 1280], fps: 25, shots: vd.shots, style: vd.styleResolved || '', musicType: vd.musicType || '' }),
        script: vd.script,
        theme: vd.theme,
        speaker: vd.voice,
        bgm: vd.bgm,
        source: 'ai',
        style: vd.styleResolved || '',
        musicType: vd.musicType || '',
        duration: vd.dur,
        confirmed: true,
      }, ctx.auth)
      ctx.log(uid, `[VF-A] 出片入队（约 ${cost} 点 / ${vd.dur} 秒 / 风格 ${vd.styleResolved || 'AI自选'}）→ ${String(run).slice(0, 100)}`)
      return String(run)
    }

    /* ── 第 4 步：重试分镜 ── */
    if (vd.step === 'script' && /^重试|重新排|再排一次|重排分镜/.test(userMessage.trim())) {
      ctx.log(uid, '[VF-A] 重排分镜')
      return await draftAndCard(ctx, vd, '上次分镜不达标，这次必须覆盖全文、排够镜头，且最后一镜要有收尾。')
    }

    /* ── 兜底：给明确回应（不留白） ── */
    if (vd.step === 'running') return 'AI 制片已在后台生成中——完成后自动推结果（也可问「视频做得怎么样了」）。'
    if (vd.step === 'ai_setup') return 'AI 制片：说个主题就行（或点「🚀 开始出片」）。'
    if (vd.step === 'ai_opts') return 'AI 制片：请在上面选好 横竖屏 / 时长 / 风格，点「下一步」。'
    return 'AI 制片：请点「🚀 开始出片」，或直接回「确认」。'
  } catch (e: any) {
    const msg = String(e?.message || e).slice(0, 200)
    try { ctx.log(uid, '[VF-A] ❌ 异常: ' + msg) } catch { /* ignore */ }
    return `AI 制片环节出错：${msg}\n（把这句发我即可定位；这次没有静默失败。）`
  }
}

/* ==================== ⑥ 起草（排分镜 → 确认卡） ==================== */

async function draftAndCard(ctx: VfAiCtx, vd: VfAiDraft, retryHint: string): Promise<string> {
  const { uid } = ctx
  const dur = Math.max(5, Math.min(900, Number(vd.dur) || 30))
  const aspect = vd.aspect === 'landscape' ? 'landscape' : 'portrait'
  vd.aspectResolved = aspect
  vd.size = aspect === 'landscape' ? [1280, 720] : [720, 1280]
  // ★风格：用户没选 → 让 AI 按文案自动挑一个（挑完记下来，H3 的 prompt 与配色都用它）
  let styleId = vd.style
  if (!styleOf(styleId)) {
    try {
      const list = AI_STYLES.map((s) => `${s.id}=${s.name}（${s.desc}）`).join(' / ')
      const pick = String(await ctx.generateText(
        `下面这条短视频文案，最适合哪种【成片风格】？只回 id 一个词，不要解释。\n可选：${list}\n文案：\n${String(vd.script).slice(0, 500)}`) || '').trim().toLowerCase()
      styleId = styleOf(pick) ? pick : 'cinematic'
      ctx.log(uid, `[VF-A] 未选风格 → AI 自选「${styleOf(styleId)?.name}」`)
    } catch { styleId = 'cinematic' }
  }
  vd.styleResolved = styleId
  const st = styleOf(styleId)
  if (st) { vd.theme = st.theme; if (!vd.musicType) vd.musicType = st.music }

  const shotN = Math.max(4, Math.min(40, Math.round(dur / 5)))
  const imgs: string[] = []   // ★AI 制片画面全 AI 生成 → 不给素材图（素材只当"题材依据"）
  const shots = await ctx.genVideoShots({
    uid, aspect, dur, shotN,
    // ★VF_AIONLY_V1（2026-09-21 用户定案）：**AI 制片 = 文生视频** ——
    //   素材只在"第一步看素材库猜题材"用一次；之后一路不碰素材库：
    //   ① 不带素材图（imgPaths 为空）② 不带素材摘要（brief 空）③ aiOnly → 只产出不需要图的卡型
    //   （`bgimage`/`image` 一律降级成 title，绝不出现"要素材图却没有图"的镜 → 渲染必崩的那种）
    imgPaths: imgs, brief: '', script: vd.script,
    wantPrompt: true,                    // ★要英文画面描述（喂 H3）
    aiOnly: true,                        // ★只允许"不需要素材图"的卡型
    ...(retryHint ? { retryHint } : {}),
  })

  // 覆盖率门禁 + 字幕兜底（与另两条线同口径：<80% 不给确认）
  let subLen = (shots || []).reduce((a: number, s: any) => a + String(s.subtitle || '').length, 0)
  let cover = vd.script ? subLen / vd.script.length : 0
  ctx.log(uid, `[VF-A] 覆盖率 ${Math.round(cover * 100)}%（subtitle ${subLen} / 文案 ${vd.script.length}）`)
  if ((shots || []).length >= 2 && cover < 0.8 && vd.script) {
    const segs = ctx.splitScript(vd.script, shots.length)
    let sum = 0
    shots.forEach((s: any, i: number) => { const t = String(segs[i] || '').trim(); if (t) { s.subtitle = t; sum += t.length } })
    if (sum > subLen) { subLen = sum; cover = vd.script ? sum / vd.script.length : 0 }
    ctx.log(uid, `[VF-A] 字幕兜底 → 覆盖 ${Math.round(cover * 100)}%`)
  }

  const estSec = Math.round(subLen / 4.5)
  vd.shots = shots
  vd.cover = cover
  vd.subLen = subLen
  vd.step = 'script'
  VF_AI_DRAFT.set(uid, vd)
  await saveVfAiDraft(ctx.prisma, uid, vd)
  ctx.log(uid, `[VF-A] 分镜 ${(shots || []).length} 镜 / 覆盖 ${Math.round(cover * 100)}% / 预计 ${estSec} 秒 / 画幅 ${aspect} / 风格 ${st?.name}`)

  // 确认卡：成本按秒（与 make_ai_video 同口径）+ 把风格/画幅透给卡片
  const card = ctx.vfScriptCard(
    { ...vd, source: 'ai', styleName: st?.name || '', aspectName: aspect === 'landscape' ? '横屏 16:9' : '竖屏 9:16' },
    shots, 0, vd.brief || '', aspect, cover, estSec)
  return card
}
