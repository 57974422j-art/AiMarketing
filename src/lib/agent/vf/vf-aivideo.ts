// ★VF_AILINE_V1（2026-09-21）：【AI 制片】—— 完全独立的一条线
//
// 用户定案（原话）：
//   「把现在的视频状态机先不动，抽你需要的做 AI 制片。不用制作牵涉太广。」
//   「不要设计公用层……最怕你们设计了共用，不如不拆，出问题都不能用。」
//
// ── 本文件的设计约束（遵守用户的三条铁律） ─────────────────────────────
//   1. **自成一套**：入口判定 / 草稿 / 文案 / 分镜 / 确认卡 / 门禁 / 出片，全部在这个文件里。
//   2. **不共用逻辑**：**不 import 素材合成那条线的任何状态机代码**（宁可重复）。
//      允许依赖的只有【无状态的纯工具】（prisma / vfLog / genVideoShots / vfScriptCard），
//      而且**通过 ctx 注入**（这样本文件反过来不 import route.ts，避免循环依赖）。
//   3. **零侵入**：本文件只在 route.ts 里被"分派"一次；**不改动**素材合成的任何一行。
//
// ── 与素材合成的【唯一差别】（其余流程完全一样） ────────────────────────
//   · 分镜要求 AI 多给一个 `prompt`（英文画面描述）→ 给 MiniMax H3 当提示词
//   · 计费按【秒 × 50 点】（768P），不是按文案字数
//   · 出片时显式传 `source: 'ai'`（不再让对方读草稿去猜）
//   —— 正因为"差别只有这三点"，才**必须各自写一份**：共用一段就会"一个坏两个坏"。
//
// ── AI 制片**仍然看素材**（用户定案："看了素材让它自己决定"） ─────────────
//   素材在这里的作用是【给 AI 依据】：AI 因此知道你在卖什么，文案与画面描述才贴合。
//   **不是**"把素材图用进片子"——AI 出片是"AI 画全新画面"（要"让素材动起来"是另一个功能）。

//   —— 不 import 项目内部的 prisma 封装（项目里根本没有 `@/lib/prisma`），
//      改为**由 route.ts 注入**数据库客户端（`ctx.prisma`）。注入的是"连接"，不是"共用业务逻辑"。

/* ==================== 类型（本线自己定义，不设共用类型文件） ==================== */

export interface VfAiDraft {
  step: 'form' | 'script' | 'running'
  topic: string
  aspect: string          // portrait | landscape | auto
  dur: number
  voice: string
  theme: string
  bgm: string             // 'auto' | ''
  script: string          // 文案（AI 写或用户贴）
  source: 'ai'            // 恒为 'ai'（本线专用）
  shots?: any[]
  size?: number[]
  aspectResolved?: string
  imgs?: string[]
  brief?: string
  voiceList?: any[]
  cover?: number
  subLen?: number
}

/** 依赖注入：由 route.ts 提供（本文件不 import 项目内部路径，避免循环依赖/路径写错） */
export interface VfAiCtx {
  uid: number
  userMessage: string
  auth: any
  /** 数据库客户端（由 route.ts 注入 —— 是"连接"，不是共用业务逻辑） */
  prisma: any
  /** 工具执行器（出片走它） */
  executeToolCall: (name: string, args: Record<string, any>, auth: any) => Promise<string>
  /** 排分镜（素材合成那套的同一实现——它是**无状态纯函数**，允许共用） */
  genVideoShots: (o: {
    uid: number | string; aspect: string; dur: number; shotN: number
    imgPaths: string[]; brief: string; script: string
    retryHint?: string; wantPrompt?: boolean
  }) => Promise<any[]>
  /** 文案生成（无状态） */
  generateText: (prompt: string) => Promise<string>
  /** 确认卡（**本线自己算成本**，所以这里只做渲染） */
  vfScriptCard: (vd: any, shots: any[], imgN: number, brief: string, aspect: string, cover?: number, estSec?: number) => string
  /** 自己的日志（会带 [VF-A] 前缀） */
  log: (uid: number | string, msg: string) => void
  /** 音色列表（纯数据；只用于起稿卡让用户选音色 —— 不填则前端该区为空） */
  voiceList: any[]
  /** 素材相关（纯工具，无状态） */
  listRepoMaterials: (userId: number | string, limit?: number, mode?: 'spread' | 'recent') => Promise<any[]>
  summarizeMaterials: (userId: number | string, mats: any[], visN: number) => Promise<string>
  probeMaterialSizes: (userId: number | string, mats: any[]) => Promise<any>
  /** 按标点切段（出片前兜底填 subtitle 用） */
  splitScript: (script: string, n: number, maxLen?: number) => string[]
  /** 主题/画幅等表单协议解析（纯函数） */
  parseForm: (userMessage: string) => Record<string, any> | null
}

/* ==================== ① 草稿：本线自己一份（内存 Map + DB tag 都和素材合成不同） ==================== */

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

/* ==================== ② 入口判定（本线自己的词表） ==================== */

/** 工具类意图（不是"出成片"）——三条线共用同一份判断（**纯规则，不是业务逻辑**） */
const TOOL_INTENT = /(写|生成|做).{0,4}(文案|脚本|标题|话题)|海报|图片|插画|今日热点|热点|数字人|口播视频|背景音乐|配乐|BGM|搜一下|搜索|记录一件事|记一下|提醒/
/** 若"工具词命中"且"完全没有出片词" → 这不是出片意图（避免"帮我写一个 AI 制片文案"被误当出片） */
function isToolIntentOnly(m: string): boolean {
  return TOOL_INTENT.test(m) && !/成片|制片|做视频|做个视频|做一条视频|剪辑|出片/.test(m)
}

/** 是否"AI 制片"意图（三条线之一：素材智能成片 / AI 制片 / 素材+AI 创作） */
export function matchesAiLine(msg: string): boolean {
  const m = String(msg || '')
  // 不抢发布状态机的活；也不抢"写文案/海报/热点…"这类工具的活
  if (/发布|发到|发抖音|发小红书|发微博|发视频号|平台:/.test(m)) return false
  if (isToolIntentOnly(m)) return false
  // ① 明确说"AI 制片/AI 成片"；② "全部/纯/整片 AI"；③ "用 AI（帮我）做一条视频"
  //   ★注意：本函数【优先于】素材合成的 vfIntent 判断（分派在成片入口之前），
  //     所以"用 AI 帮我做一条视频"会归这里，而"用本地成片帮我做一条视频"不含 AI → 仍归素材智能成片。
  if (/AI\s*制片|AI\s*成片|全部\s*AI|全\s*AI|纯\s*AI|整片\s*AI|AI\s*制作|AI\s*生成/.test(m)) return true
  if (/(用|帮我用|通过|走)\s*AI\s*.{0,8}(做|生成|制作|拍|出).{0,6}视频/.test(m)) return true
  if (/AI\s*.{0,6}(做|制作|生成|出).{0,6}视频/.test(m)) return true
  return false
}

/** 本线是否有进行中的草稿（有则**必须继续本线**，绝不被素材合成接管） */
export async function hasAiDraft(db: any, uid: number): Promise<boolean> {
  if (VF_AI_DRAFT.has(uid)) return true
  const d = await loadVfAiDraft(db, uid)
  if (d?.step) { VF_AI_DRAFT.set(uid, d); return true }
  return false
}

/** 本线自己的"流程词"（不算新指令，否则会把草稿重置回第一步） */
const AI_FLOW_WORD = /确认|开始|生成吧|出片|就这个|^行$|^好$|^OK$|可以|强制出片/i

const ASPECTS: Record<string, string> = { portrait: '竖屏 9:16', landscape: '横屏 16:9', auto: '自动' }
const THEME_NAMES: Record<string, string> = { dark: '深蓝科技', tech: '深青科技', light: '浅色纸感' }

/* ==================== ③ 主流程 ==================== */

/**
 * AI 制片的一整轮处理。
 * 返回要回给前端/用户的字符串（一律是 `VF_JSON:{...}` 卡片协议或纯文本）。
 * **绝不抛异常**：内部全部包住 → 出错时返回"人话"，不再"静默吞掉"（这次事故的教训）。
 */
export async function handleAiLine(ctx: VfAiCtx): Promise<string> {
  const { uid, userMessage } = ctx
  try {
    let vd = VF_AI_DRAFT.get(uid)
    if (!vd) { const r = await loadVfAiDraft(ctx.prisma, uid); if (r?.step) { vd = r; VF_AI_DRAFT.set(uid, vd) } }

    /* ── 第 1 步：起稿（还没有草稿）→ 发"AI 制片设置"卡 ── */
    if (!vd) {
      const topic = String(userMessage)
        .replace(/全部\s*AI|全\s*AI|纯\s*AI|AI\s*制作|AI\s*生成|整片\s*AI/g, '')
        .replace(/本地成片|帮我做.{0,3}(一条|个|条)?视频|帮我成片|做一条视频|做个视频|做成片/g, '')
        .replace(/^(用|请用|请|来|帮我|帮忙|给我|麻烦)\s*/, '')
        .replace(/^[\s:：,，,。、]+/, '').trim()
      vd = {
        step: 'form', topic, aspect: 'portrait',   // ★AI 制片默认竖屏（用户定案：「它知道竖屏横屏」）
        dur: 30, voice: 'longxiaochun', theme: 'dark', bgm: 'auto',
        script: '', source: 'ai',
      }
      VF_AI_DRAFT.set(uid, vd)
      await saveVfAiDraft(ctx.prisma, uid, vd)
      ctx.log(uid, `[VF-A] 起稿（AI 制片）topic="${topic.slice(0, 30)}"`)
      // ★AI 制片【专属极简卡】（用户定案："AI 制作就纯 AI 制作了……音乐、字幕 AI 它都能自己把握"）
      //   → **不再复用素材合成那张完整表单**（那张有画面来源/画幅/音色/BGM/风格 —— 对 AI 制片全是多余的；
      //     上一版因此做成了"两张几乎一样的卡"，用户实测直接指出"你搞 2 个一样的"）。
      //   这里只发 `step:'ai_setup'`，**只要【主题 + 时长】**；前端按它渲染极简卡。
      //   提交时前端仍发 VF_FORM（只带 source/topic/dur），下面 `parseForm` 完全兼容。
      return 'VF_JSON:' + JSON.stringify({
        step: 'ai_setup',
        aiLine: true,
        topic,
        dur: 30,
        costRate: 50,
        hint: 'AI 制片：你只给主题，**画面 / 文案 / 分镜 / 配音 / 字幕 / 配乐**全部自动完成。',
      })
    }

    /* ── 第 2 步：表单提交（VF_FORM:{...}）→ 写文案 + 排分镜 + 出确认卡 ── */
    const f = ctx.parseForm(userMessage)
    if (f && (vd.step === 'form' || vd.step === 'ai_setup' || vd.step === 'script')) {
      if (f.aspect) vd.aspect = ['portrait', 'landscape', 'auto'].includes(String(f.aspect)) ? String(f.aspect) : 'portrait'
      if (f.dur) vd.dur = Math.max(5, Math.min(900, parseInt(f.dur) || 30))
      if (f.theme) vd.theme = ['dark', 'tech', 'light'].includes(String(f.theme)) ? String(f.theme) : 'dark'
      if (f.voice) vd.voice = String(f.voice)
      if (typeof f.topic === 'string' && f.topic.trim()) vd.topic = f.topic.trim().slice(0, 300)
      if (f.script && String(f.script).trim()) vd.script = String(f.script).trim().slice(0, 4000)
      if (f.bgm !== undefined) vd.bgm = String(f.bgm) === 'auto' ? 'auto' : ''
      ctx.log(uid, `[VF-A] 表单 dur=${vd.dur} aspect=${vd.aspect} theme=${vd.theme} topic="${vd.topic.slice(0, 20)}"`)
      return await draftAndCard(ctx, vd, '')
    }

    /* ── 第 2.5 步：用户【没点表单】，直接在对话里说了主题 → 当成主题，直接起草 ──
       （不补这条路径的话，用户说"咖啡店开业"会被忽略，只回一句"请点开始出片"——
         与素材合成那条线的体验不一致。） */
    if (vd.step === 'form' && !f && !AI_FLOW_WORD.test(userMessage.trim())
        && userMessage.trim().length >= 2
        && !/^(竖屏|横屏|自动|竖屏 9:16|横屏 16:9)$/.test(userMessage.trim())
        && !/^VF_JSON|^MAKE_VIDEO|^\{|^\[/.test(userMessage.trim())) {
      vd.topic = userMessage.trim().slice(0, 300)
      ctx.log(uid, `[VF-A] 对话里给了主题="${vd.topic.slice(0, 30)}" → 直接起草`)
      return await draftAndCard(ctx, vd, '')
    }

    /* ── 第 3 步：确认 → 出片 ── */
    if (vd.step === 'script' && AI_FLOW_WORD.test(userMessage.trim())) {
      if (!vd.shots?.length) {
        return 'AI 制片：分镜还没排好，先不出片。回「重试」我再排一次。'
      }
      const cost = Math.max(1, Math.ceil(Math.max(4, Number(vd.dur) || 30) * 50))
      vd.step = 'running'
      VF_AI_DRAFT.set(uid, vd)
      await saveVfAiDraft(ctx.prisma, uid, vd)
      // ★显式传 source:'ai'（不读草稿去猜 —— 这正是上次事故的根因）
      const run = await ctx.executeToolCall('make_ai_video', {
        plan: JSON.stringify({ size: vd.size || [720, 1280], fps: 25, shots: vd.shots }),
        script: vd.script,
        theme: vd.theme,
        speaker: vd.voice,
        bgm: vd.bgm,
        source: 'ai',
        duration: vd.dur,
        confirmed: true,
      }, ctx.auth)
      ctx.log(uid, `[VF-A] 出片入队（约 ${cost} 点 / ${vd.dur} 秒）→ ${String(run).slice(0, 100)}`)
      return String(run)
    }

    /* ── 第 4 步：重试分镜 ── */
    if (vd.step === 'script' && /^重试|重新排|再排一次|重排分镜/.test(userMessage.trim())) {
      ctx.log(uid, '[VF-A] 重排分镜')
      return await draftAndCard(ctx, vd, '上次分镜不达标，这次必须覆盖全文、排够镜头。')
    }

    /* ── 第 5 步：出片中，或其它 → 给明确回应（不留白） ── */
    if (vd.step === 'running') {
      return 'AI 制片已在后台生成中——完成后自动推结果（也可问「视频做得怎么样了」）。'
    }
    return 'AI 制片：请点「🚀 开始出片」，或直接回「确认」。'
  } catch (e: any) {
    // ★这次事故的教训：异常绝不静默。写日志 + 给用户可读可转发的句
    const msg = String(e?.message || e).slice(0, 200)
    try { ctx.log(uid, '[VF-A] ❌ 异常: ' + msg) } catch { /* ignore */ }
    return `AI 制片环节出错：${msg}\n（把这句话发我即可定位；这次没有静默失败。）`
  }
}

/* ==================== ④ 起草（写文案 → 排分镜 → 确认卡） ==================== */

async function draftAndCard(ctx: VfAiCtx, vd: VfAiDraft, retryHint: string): Promise<string> {
  const { uid } = ctx
  const dur = Math.max(5, Math.min(900, Number(vd.dur) || 30))
  const need = Math.round(dur * 4.5)                    // 中文配音约 4.5 字/秒

  // ① 文案
  if (!vd.script) {
    const p = `你是短视频编导。为「${vd.topic || 'AI 营销'}」写一条约 ${dur} 秒的口播文案，` +
      `**约 ${need} 字**（中文配音约 4.5 字/秒），口语化、有钩子、结尾有行动号召。` +
      `只输出文案本身，不要标题、不要解释、不要分段标记。`
    vd.script = String(await ctx.generateText(p) || '').trim().slice(0, 4000)
    ctx.log(uid, `[VF-A] 文案 ${vd.script.length} 字（目标 ${need}）`)
  }

  // ② 素材（只当"依据"：让 AI 知道你在卖什么）
  let brief = ''
  let imgN = 0
  try {
    const mats = await ctx.listRepoMaterials(uid, 40, 'spread')
    imgN = (mats || []).length
    brief = await ctx.summarizeMaterials(uid, mats || [], Math.max(8, Math.min(20, Math.round(dur / 30) * 5)))
  } catch { /* 素材拿不到也继续（AI 制片不依赖素材图） */ }
  vd.imgs = []
  vd.brief = String(brief || '').slice(0, 1500)

  // ③ 画幅 / 画布（AI 制片画布按 H3 的 768P 档）
  const aspect = (vd.aspect === 'landscape' || vd.aspect === 'portrait') ? vd.aspect : 'portrait'
  vd.aspectResolved = aspect
  vd.size = aspect === 'landscape' ? [1280, 720] : [720, 1280]

  // ④ 分镜（★本线专有：wantPrompt=true → 要英文画面描述给 H3）
  const shotN = Math.max(4, Math.min(40, Math.round(dur / 5)))
  const shots = await ctx.genVideoShots({
    uid, aspect, dur, shotN,
    imgPaths: [],                      // AI 制片不用素材图（素材只当依据）
    brief: vd.brief,
    script: vd.script,
    wantPrompt: true,                  // ★要 prompt
    ...(retryHint ? { retryHint } : {}),
  })

  // ⑤ 覆盖率门禁 + 兜底填 subtitle（与素材合成同口径：<80% 不给确认）
  let subLen = (shots || []).reduce((a, s) => a + String(s.subtitle || '').length, 0)
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
  ctx.log(uid, `[VF-A] 分镜 ${(shots || []).length} 镜 / 覆盖 ${Math.round(cover * 100)}% / 预计 ${estSec} 秒 / 画幅 ${ASPECTS[aspect]} / 风格 ${THEME_NAMES[vd.theme] || vd.theme}`)

  // ⑥ 确认卡 —— **成本按秒**（与 make_ai_video 的扣费同口径）
  const card = ctx.vfScriptCard({ ...vd, source: 'ai' }, shots, imgN, vd.brief, aspect, cover, estSec)
  return card
}

/* ==================== ⑤ 供 route.ts 分派用的最小接口 ==================== */

/** 本线是否该接管这一轮 */
export async function shouldTakeOverAiLine(db: any, uid: number, userMessage: string): Promise<boolean> {
  // ★【有本线草稿 → 一定接管】（用户定案"状态机直接执行，不把复杂判断交给 AI"）：
  //   否则用户随口说一句（既不是流程词、不是表单、也不含"AI"）就会被判为"不接管"
  //   → 这一轮掉回【素材合成】那条线，而那条线看不到本线草稿 → 变成"AI 自由发挥"，
  //     本线草稿就**永远卡在做不完的状态**。所以只要本线有草稿，就必须由本线继续。
  if (await hasAiDraft(db, uid)) return true
  return matchesAiLine(userMessage)
}
