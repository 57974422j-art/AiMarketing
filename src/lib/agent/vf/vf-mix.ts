// ★VF_MIXLINE_V1（2026-09-21）：【素材 + AI 创作】—— 第三条独立线
//
// 用户定案（原话）：
//   「3个不同的 素材智能成片，AI制片，素材+AI创作 可以吗 三个不同状态机」
//   「混合规则 = B：AI 自己标注哪几镜用 AI」
//   「不要设计公用层……最怕你们设计了共用，不如不拆，出问题都不能用」
//
// ── 三条线的关系（**各自独立，互不 import**） ─────────────────────────────
//   ① 素材智能成片   → route.ts 现有那条（用户："先不动"）
//   ② AI 制片        → vf-aivideo.ts（已建，全部镜由 AI 生成）
//   ③ 素材+AI 创作   → 本文件（**部分镜 AI、其余用素材**）
//
// ── 本文件的设计约束（与前两条线一致） ─────────────────────────────────
//   1. **零 import**：prisma / executeToolCall / 素材函数 / downloadMaterials / generateText
//      全部由 route.ts 通过 ctx 注入 → **不可能连累其它两条线**。
//   2. **自己的草稿**：内存 Map + DB tag `vf_draft_mix`（与 `vf_draft` / `vf_draft_ai` 都不同）。
//   3. **自己排分镜**：**不复用** `genVideoShots`（那是"共用逻辑"）——本文件自带一份 prompt + 解析，
//      唯一差别是**要求 AI 给每镜一个 `need_ai` 标记**（规则 B）。
//   4. **内部绝不 throw**：异常转成人话返回 + 写日志。
//
// ── 规则 B 的落地 ──────────────────────────────────────────────────────
//   排分镜时让 AI 判断：这一镜的画面**能用你的素材图讲清楚** → `need_ai:false`（省钱，多数镜）；
//   **抽象概念/数据/对比/情绪/开场/结尾**这种"没对应实拍图或需要张力"的 → `need_ai:true`（建议 2~4 镜）。
//   出片时把 `need_ai:true` 的**镜号**（1-based）传给 `make.py --mix 1,5,9`
//   → `gen_ai_clips` 只对这些镜调 H3，**其余镜沿用素材图**（画面完全不动）。

/* ==================== 类型（本线自己定义） ==================== */

export interface VfMixDraft {
  step: 'form' | 'script' | 'running'
  topic: string
  aspect: string
  dur: number
  voice: string
  theme: string
  bgm: string
  script: string
  source: 'mix'
  /** ★A3（2026-09-22）：前端传来的"本次刚上传的文件名"——有则**只用这些**（上传优先铁律） */
  uploaded?: string[]
  shots?: any[]
  size?: number[]
  aspectResolved?: string
  imgs?: string[]          // 本地图片路径（排分镜用）
  brief?: string
  cover?: number
  subLen?: number
  aiShots?: number[]       // ★规则 B：AI 标注要生成的镜号（1-based）
}

export interface VfMixCtx {
  uid: number
  userMessage: string
  auth: any
  prisma: any
  executeToolCall: (name: string, args: Record<string, any>, auth: any) => Promise<string>
  generateText: (prompt: string) => Promise<string>
  log: (uid: number | string, msg: string) => void
  voiceList: any[]
  /** 素材（纯工具，无状态） */
  listRepoMaterials: (userId: number | string, limit?: number, mode?: 'spread' | 'recent') => Promise<any[]>
  summarizeMaterials: (userId: number | string, mats: any[], visN: number) => Promise<string>
  probeMaterialSizes: (userId: number | string, mats: any[]) => Promise<any>
  /** 把素材下载到本地，返回带 `localPath` 的数组（真实签名：**2 个参数**） */
  downloadMaterials: (userId: number | string, mats: any[]) => Promise<any[]>
  parseForm: (userMessage: string) => Record<string, any> | null
  splitScript: (script: string, n: number, maxLen?: number) => string[]
}

/* ==================== ① 草稿（本线自己一份） ==================== */

const VF_MIX_DRAFT = new Map<number, VfMixDraft>()
const VF_MIX_TAG = 'vf_draft_mix'          // ★与 vf_draft / vf_draft_ai 都不同 → 绝不串线

// ★VF_DRAFT_ISOLATE_V1（2026-09-22）：读写清一律【精确匹配】本线 tag。
//   原来用 `contains` —— 素材线的 tag 'vf_draft' 是本线 tag 的**子串**，素材线清草稿时
//   `deleteMany({tags:{contains:'vf_draft'}})` 会把本线草稿一起删掉（用户实测：本线走一半跳回第一步）。
async function saveVfMixDraft(db: any, uid: number | string, d: VfMixDraft): Promise<void> {
  const content = '素材AI创作草稿:' + JSON.stringify(d)
  try {
    const ex = await db.agentMemory.findFirst({ where: { userId: String(uid), tags: { equals: VF_MIX_TAG } }, orderBy: { updatedAt: 'desc' } })
    if (ex) await db.agentMemory.update({ where: { id: ex.id }, data: { content } })
    else await db.agentMemory.create({ data: { userId: String(uid), content, tags: VF_MIX_TAG, salience: 0.5 } })
  } catch { /* 草稿存不上不影响本轮 */ }
}

async function loadVfMixDraft(db: any, uid: number | string): Promise<VfMixDraft | null> {
  try {
    const dm = await db.agentMemory.findFirst({ where: { userId: String(uid), tags: { equals: VF_MIX_TAG } }, orderBy: { updatedAt: 'desc' } })
    if (dm?.content) {
      // 只取 JSON 部分（历史串线可能留下别线的中文前缀，直接 JSON.parse 会失败）
      const _t = String(dm.content)
      const _i = _t.indexOf('{')
      return JSON.parse(_i >= 0 ? _t.slice(_i) : _t)
    }
  } catch { /* ignore */ }
  return null
}

export async function clearVfMixDraft(db: any, uid: number | string): Promise<void> {
  VF_MIX_DRAFT.delete(Number(uid))
  try { await db.agentMemory.deleteMany({ where: { userId: String(uid), tags: { equals: VF_MIX_TAG } } }) } catch { /* ignore */ }
}

/* ==================== ② 入口判定（本线自己的词表） ==================== */

/** 工具类意图（不是"出成片"）—— ★本线【自己一份】（零 import 铁律：不引用 vf-aivideo.ts 的） */
const TOOL_INTENT = /(写|生成|做).{0,4}(文案|脚本|标题|话题)|海报|图片|插画|今日热点|热点|数字人|口播视频|背景音乐|配乐|BGM|搜一下|搜索|记录一件事|记一下|提醒/

/** 是否"素材 + AI 创作"意图 */
export function matchesMixLine(msg: string): boolean {
  const m = String(msg || '')
  if (/发布|发到|发抖音|发小红书|发微博|发视频号|平台:/.test(m)) return false
  // 工具类意图（写文案/海报/热点…）不算出片
  // ★VF_PROTO_V1（2026-09-21）：**协议串（卡片提交）不是"工具意图"** —— 表单里带的文案正文
  //   若含"写标题/海报"等词，会被误判成"想写文案"→ 本线不认领（与 AI 制片线同一条修法、各写各的）。
  const _isProto = /^(VF_FORM|VF_JSON)\s*[:{]/.test(m.trim())
  if (!_isProto && TOOL_INTENT.test(m) && !/成片|制片|做视频|做个视频|做一条视频|剪辑|出片/.test(m)) return false
  // ★必须【先排除】素材智能成片与 AI 制片：本线只在明确说"素材+AI / 混合创作"时接管
  if (/^(素材合成|素材智能成片|用我的素材库)$/.test(m.trim())) return false
  return /素材\s*[+＋加和与]\s*AI|素材\s*AI\s*创作|素材\s*AI\s*混合|混合\s*创作|AI\s*混合|半\s*AI/.test(m)
}

export async function hasMixDraft(db: any, uid: number): Promise<boolean> {
  if (VF_MIX_DRAFT.has(uid)) return true
  const d = await loadVfMixDraft(db, uid)
  if (d?.step) { VF_MIX_DRAFT.set(uid, d); return true }
  return false
}

/** 本线是否该接管这一轮（有本线草稿 → 一定接管，否则草稿会永远卡住） */
export async function shouldTakeOverMixLine(db: any, uid: number, userMessage: string): Promise<boolean> {
  const m = String(userMessage || '')
  // ★VF_FORM_OWNER_V1（2026-09-21）：三线共用 `VF_FORM:` 前缀 → 表单必须按【字段】认领。
  //   带 source/voice/theme/bgm 的表单 = 素材线的 → 本线绝不接管（与 AI 线同规则、各写各的）。
  const _fm = m.trim().match(/^VF_FORM:(\{[\s\S]*\})/)
  if (_fm) {
    try {
      const f = JSON.parse(_fm[1] || '{}')
      if (('source' in f) || ('voice' in f) || ('theme' in f) || ('bgm' in f)) return false
    } catch { /* 解析失败 → 交给后面的判断 */ }
  }
  // ★VF_ENTRY_PRIORITY_V1（2026-09-21）：【别线的明确入口词】优先于本线残留草稿。
  //   与 AI 制片线同一条规则：本线有草稿时也不能吞掉【明确说了素材成片】的消息，
  //   否则素材智能成片永远进不去（用户实测："进入不了状态机了"）。
  if (/本地成片|素材成片|素材合成|素材智能成片|用我的素材|用我上传的素材|用素材库/.test(m)) return false
  // ★VF_ENTRY_PRIORITY_V1 补充（2026-09-21）：**AI 制片的入口词也要让出** ——
  //   本线分派在 AI 制片线【之前】，若本线有残留草稿，就会把「AI 制片帮我做一条视频」抢走
  //   （与"素材线的『确认』被 AI 线抢走"是同一类错，只是方向相反 —— 所以两边都要排）。
  if (/AI\s*制片|AI\s*成片|全部\s*AI|全\s*AI|纯\s*AI|整片\s*AI|AI\s*制作|AI\s*生成/.test(m)) return false
  // ★VF_MIX_RUNCLOSE_V1（2026-09-21）：与 AI 制片线同一条缺陷 ——「入队后草稿停在 running 没人收尾」
  //   会让本线"有草稿必接管"终身吞掉所有消息（含素材线的「确认」）。
  //   running 一律视为僵尸：自清 + 不接管（本线现在也是"入队即清草稿"，只剩历史僵尸这一瞬）。
  if (await hasMixDraft(db, uid)) {
    const _d = await loadVfMixDraft(db, uid)
    if (_d?.step === 'running') {
      await clearVfMixDraft(db, uid)
      return matchesMixLine(m)
    }
    return true
  }
  return matchesMixLine(m)
}

/* ==================== ③ 常量 ==================== */

const MIX_FLOW_WORD = /确认|开始|生成吧|出片|就这个|^行$|^好$|^OK$|可以|强制出片/i
const THEME_NAMES: Record<string, string> = { dark: '深蓝科技', tech: '深青科技', light: '浅色纸感' }
const KNOWN_TYPES = ['bgimage', 'title', 'list', 'number', 'compare', 'chart', 'end']
const DEMO_WORDS = ['效率翻10倍', 'AI营销系统', '三大能力', '效率提升', '评论区见', '点击咨询', '新做法', '旧做法']

/* ==================== ④ 主流程 ==================== */

export async function handleMixLine(ctx: VfMixCtx): Promise<string> {
  const { uid, userMessage } = ctx
  try {
    let vd = VF_MIX_DRAFT.get(uid)
    if (!vd) { const r = await loadVfMixDraft(ctx.prisma, uid); if (r?.step) { vd = r; VF_MIX_DRAFT.set(uid, vd) } }

    // ★VF_EXIT_V1（2026-09-21）：卡住时的【退出口】（与 AI 制片线同规则、各写各的）。
    //   清本线草稿，不动别线；用户说这些词即退出本线。
    if (vd && /^(重新开始|取消|退出|重来|不做了|算了|清空|重置|退出制片)$/.test(String(userMessage).trim())) {
      await clearVfMixDraft(ctx.prisma, uid)
      try { ctx.log(uid, '[VF-X] 用户取消 → 本线草稿已清（不影响素材线/AI制片线）') } catch { /* ignore */ }
      return '已退出「素材+AI 创作」（本线草稿已清）。想重来说「素材+AI创作」。'
    }

    // ★VF_MIXLINE_RESTART_V1（2026-09-21）：与 AI 制片线同一条规则（各写各的）——
    //   **本线入口词 = 再开一条** → 作废旧草稿、走起稿。否则上一轮残留在 script/ai_opts 的草稿
    //   会把新指令吞掉（只回那一步的兜底话术，用户以为"状态机不进"）。
    //   只认入口词：「确认 / 下一步 / VF_FORM」绝不重置。
    if (vd && matchesMixLine(userMessage)) {
      await clearVfMixDraft(ctx.prisma, uid)
      vd = undefined
      try { ctx.log(uid, '[VF-X] 检测到本线入口词 → 旧草稿作废，重新起稿（=再做一条）') } catch { /* ignore */ }
    }

    /* ── 起稿 ── */
    if (!vd) {
      const topic = String(userMessage)
        .replace(/素材\s*[+＋加和与]\s*AI|素材\s*AI\s*(创作|混合)|混合\s*创作|AI\s*混合|半\s*AI/g, '')
        .replace(/本地成片|帮我做.{0,3}(一条|个|条)?视频|帮我成片|做一条视频|做个视频|做成片/g, '')
        .replace(/^(用|请用|请|来|帮我|帮忙|给我|麻烦)\s*/, '')
        .replace(/^[\s:：,，,。、]+/, '').trim()
      vd = {
        step: 'form', topic, aspect: 'portrait', dur: 30,
        voice: 'longxiaochun', theme: 'dark', bgm: 'auto', script: '', source: 'mix',
      }
      VF_MIX_DRAFT.set(uid, vd)
      await saveVfMixDraft(ctx.prisma, uid, vd)
      ctx.log(uid, `[VF-X] 起稿（素材+AI 创作）topic="${topic.slice(0, 30)}"`)
      // ★同 AI 制片：走**专属极简卡**（`step:'ai_setup'`），不再复用素材合成那张完整表单
      //   （否则又是一张"几乎一样的卡"）。混合线同样**不需要**用户选画幅/音色/配乐 ——
      //   它只需要知道"主题 + 时长"，其余（含"哪几镜用 AI"）由 AI 自己判断。
      return 'VF_JSON:' + JSON.stringify({
        step: 'ai_setup',
        mixLine: true,
        topic, dur: 30, costRate: 50,
        hint: '素材 + AI 创作：**能用你素材图的镜就用素材，AI 判断"该动起来"的镜才调 AI**（省钱）。你只给主题。',
      })
    }

    /* ── 表单提交 → 起草 ── */
    const f = ctx.parseForm(userMessage)
    if (f && (vd.step === 'form' || vd.step === 'script')) {
      if (f.aspect) vd.aspect = ['portrait', 'landscape', 'auto'].includes(String(f.aspect)) ? String(f.aspect) : 'portrait'
      if (f.dur) vd.dur = Math.max(5, Math.min(900, parseInt(f.dur) || 30))
      if (f.theme) vd.theme = ['dark', 'tech', 'light'].includes(String(f.theme)) ? String(f.theme) : 'dark'
      if (f.voice) vd.voice = String(f.voice)
      if (typeof f.topic === 'string' && f.topic.trim()) vd.topic = f.topic.trim().slice(0, 300)
      if (f.script && String(f.script).trim()) vd.script = String(f.script).trim().slice(0, 4000)
      // ★A3（2026-09-22，用户铁律「上传优先」）：把表单里的**上传名单**接住 ——
      //   原来完全没解析它 → 用户明明在卡片上"上传了 5 张"，本线照样只看整个仓库
      //   （用户实测：卡片写"已上传 5 张"，实际用的还是仓库那 30 张）。
      if (Array.isArray(f.uploaded)) vd.uploaded = f.uploaded.map((x: any) => String(x)).slice(0, 60)
      if (f.bgm !== undefined) vd.bgm = String(f.bgm) === 'auto' ? 'auto' : ''
      ctx.log(uid, `[VF-X] 表单 dur=${vd.dur} aspect=${vd.aspect} theme=${vd.theme} topic="${vd.topic.slice(0, 20)}"`)
      return await draftAndCard(ctx, vd)
    }

    /* ── 对话里直接给主题 ── */
    if (vd.step === 'form' && !f && !MIX_FLOW_WORD.test(userMessage.trim())
        && userMessage.trim().length >= 2
        && !/^(竖屏|横屏|自动)$/.test(userMessage.trim())
        && !/^VF_JSON|^MAKE_VIDEO|^\{|^\[/.test(userMessage.trim())) {
      vd.topic = userMessage.trim().slice(0, 300)
      ctx.log(uid, `[VF-X] 对话里给了主题="${vd.topic.slice(0, 30)}" → 直接起草`)
      return await draftAndCard(ctx, vd)
    }

    /* ── 确认 → 出片（★带 --mix 镜号） ── */
    if (vd.step === 'script' && MIX_FLOW_WORD.test(userMessage.trim())) {
      if (!vd.shots?.length) return '素材+AI 创作：分镜还没排好，先不出片。回「重试」我再排一次。'
      const aiN = Array.isArray(vd.aiShots) ? vd.aiShots.length : 0
      // ★A1（2026-09-22，用户实测「卡片报 205 点、实扣 1500 点」）：
      //   原来 `source:'ai'` + `mix:''`（AI 一镜都没标）→ make.py 判定"**全镜 AI**"，
      //   服务端按【整片时长 × 50】扣费（30 秒 = 1500 点），而卡片只按 `Math.max(4, 0) = 4` 秒报 205 点。
      //   对策：一镜都没标 → **直接不出片**（宁可重排，也绝不按整片扣钱）。
      if (!aiN) {
        ctx.log(uid, '[VF-X] ⚠️ 一镜 AI 都没标（aiShots 为空）→ 拒绝出片（避免退化成"全镜 AI + 按整片扣费"）')
        return '素材+AI 创作：这次分镜里**没有任何一镜被标为"需要 AI 生成"**。'
          + '\n直接出片会退化成「全镜 AI」，并按**整片时长**计费（和刚才的报价对不上）——所以我先不出。'
          + '\n回「重试」我重新排一次分镜。'
      }
      // ★A2（2026-09-22）：报价 = "AI 镜的实际 dur 之和 × 50" + "素材部分按文案字数" ——
      //   与确认卡、与服务端扣费**三处同口径**。**去掉原来的 `Math.max(4, …)`**：
      //   它让"0 镜 AI"也恒收 4 秒 AI 费（≈200 点）；有 AI 镜时 Σ 本来就 >0，不需要兜底。
      const aiSecExact = (vd.shots || []).reduce(
        (a: number, s: any, i: number) => a + ((vd.aiShots || []).includes(i + 1) ? (Number(s.dur) || 0) : 0), 0)
      const cost = Math.max(1, Math.ceil(aiSecExact * 50) + Math.ceil(String(vd.script || '').length / 20))
      // ★VF_MIX_RUNCLOSE_V1（2026-09-21）：入队即【作废本线草稿】（与素材线/AI制片线同款）——
      //   否则草稿永远停在 running，本线"有草稿必接管"会终身吞掉后续所有消息。
      VF_MIX_DRAFT.delete(uid)
      await clearVfMixDraft(ctx.prisma, uid)
      try { ctx.log(uid, '[VF-X] 已入队 → 本线草稿作废（不再吞掉后续消息）') } catch { /* ignore */ }
      const run = await ctx.executeToolCall('make_ai_video', {
        plan: JSON.stringify({ size: vd.size || [720, 1280], fps: 25, shots: vd.shots }),
        script: vd.script,
        theme: vd.theme,
        speaker: vd.voice,
        bgm: vd.bgm,
        // ★A1：必须传 'mix'（不是 'ai'）—— 两条线语义不同：
        //   'ai' = AI 制片（**全部**镜由 H3 生成 + 按整片时长计费）；'mix' = 只对 mix 镜号调 H3。
        //   原来传 'ai' 且 mix 为空时 → 被当成 AI 制片：全镜 AI + 整片计费（实扣 1500 的根因）。
        source: 'mix',
        mix: (vd.aiShots || []).join(','),  // ★规则 B：只对这些镜号调 H3
        duration: vd.dur,
        confirmed: true,
      }, ctx.auth)
      ctx.log(uid, `[VF-X] 出片入队（${aiN} 镜 AI / 共 ${vd.shots.length} 镜，约 ${cost} 点）→ ${String(run).slice(0, 100)}`)
      return String(run)
    }

    /* ── 重试 ── */
    if (vd.step === 'script' && /^重试|重新排|再排一次|重排分镜/.test(userMessage.trim())) {
      ctx.log(uid, '[VF-X] 重排分镜')
      return await draftAndCard(ctx, vd, true)
    }

    if (vd.step === 'running') {
      return '素材+AI 创作已在后台渲染中——完成后自动推结果（也可问「视频做得怎么样了」）。'
    }
    return '素材+AI 创作：请点「🚀 开始出片」，或直接回「确认」。'
  } catch (e: any) {
    const msg = String(e?.message || e).slice(0, 200)
    try { ctx.log(uid, '[VF-X] ❌ 异常: ' + msg) } catch { /* ignore */ }
    return `素材+AI 创作环节出错：${msg}\n（把这句发我即可定位；这次没有静默失败。）`
  }
}

/* ==================== ⑤ 起草（素材 → 文案 → 分镜[带 need_ai] → 确认卡） ==================== */

async function draftAndCard(ctx: VfMixCtx, vd: VfMixDraft, isRetry = false): Promise<string> {
  const { uid } = ctx
  const dur = Math.max(5, Math.min(900, Number(vd.dur) || 30))
  const need = Math.round(dur * 4.5)

  // ① 文案
  if (!vd.script) {
    const p = `你是短视频编导。为「${vd.topic || 'AI 营销'}」写一条约 ${dur} 秒的口播文案，` +
      `**约 ${need} 字**（中文配音约 4.5 字/秒），口语化、有钩子、结尾有行动号召。` +
      `只输出文案本身，不要标题、不要解释。`
    vd.script = String(await ctx.generateText(p) || '').trim().slice(0, 4000)
    ctx.log(uid, `[VF-X] 文案 ${vd.script.length} 字（目标 ${need}）`)
  }

  // ② 取素材 + 下载到本地（本线【真的要用你的图】）
  let brief = ''
  let imgs: string[] = []
  let maxSide = 0
  try {
    // ★A3（2026-09-22，用户铁律）：**本轮带了上传 → 只认上传的那几张，绝不掺素材库**。
    //   用户原话：「上传时上传的，素材库是素材库的……哪怕已经看过素材库了，看到上传的也以上传的为主。
    //   用户要做什么主题我们不能搞错，误判。」（原实现从不读 vd.uploaded → 用户实测上传的 5 张毫无作用）
    const _wanted: string[] = Array.isArray(vd.uploaded) ? vd.uploaded.map((x: any) => String(x)) : []
    const matsAll = await ctx.listRepoMaterials(uid, Math.max(40, _wanted.length + 20, Math.round(dur / 30) * 5 + 20), _wanted.length ? 'recent' : 'spread')
    let mats = matsAll || []
    if (_wanted.length) {
      const _byName = new Map((matsAll || []).map((m: any) => [String(m.name), m]))
      const _picked = _wanted.map((n: string) => _byName.get(n)).filter(Boolean) as any[]
      if (_picked.length) {
        mats = _picked
        ctx.log(uid, `[VF-X] ★上传优先：只看本次上传的 ${_picked.length}/${_wanted.length} 张（不掺仓库）`)
      } else {
        ctx.log(uid, `[VF-X] ⚠️ 上传名单 ${_wanted.length} 张在仓库里没找到 → 回退用仓库（若你确实上传过，请重发一次表单）`)
      }
    }
    brief = await ctx.summarizeMaterials(uid, mats || [], Math.max(8, Math.min(20, Math.round(dur / 30) * 5)))
    try { const sz = await ctx.probeMaterialSizes(uid, mats || []); maxSide = sz?.maxSide || 0 } catch { /* ignore */ }
    // ★真实签名：downloadMaterials(uid, mats) → 返回带 localPath 的数组
    const dl = await ctx.downloadMaterials(uid, (mats || []).slice(0, 30))
    imgs = (dl || []).map((m: any) => m?.localPath).filter(Boolean)
    ctx.log(uid, `[VF-X] 素材 ${(mats || []).length} 张 → 本地可用 ${imgs.length} 张（最大边 ${maxSide}px）`)
  } catch (e: any) {
    ctx.log(uid, '[VF-X] ⚠️ 素材准备失败: ' + String(e?.message || e).slice(0, 120))
  }
  vd.brief = String(brief || '').slice(0, 1500)

  // ③ 画幅 / 画布（跟素材走；AI 片段会被渲染器缩放到这个画布）
  const aspect = (vd.aspect === 'landscape' || vd.aspect === 'portrait') ? vd.aspect : 'portrait'
  vd.aspectResolved = aspect
  vd.size = aspect === 'landscape'
    ? (maxSide >= 1920 ? [1920, 1080] : (maxSide >= 1280 ? [1280, 720] : [960, 540]))
    : (maxSide >= 1920 ? [1080, 1920] : (maxSide >= 1280 ? [720, 1280] : [540, 960]))
  vd.imgs = imgs

  // ④ 排分镜（★本线自己一份 prompt —— 要 need_ai；**不复用 genVideoShots**）
  const shotN = Math.max(4, Math.min(40, Math.round(dur / 5)))
  const shots = await genMixShots(ctx, vd, shotN, imgs, brief, isRetry)

  // ⑤ 覆盖率门禁 + 字幕兜底（与另两条线同口径：<80% 不给确认）
  let subLen = shots.reduce((a, s) => a + String(s.subtitle || '').length, 0)
  let cover = vd.script ? subLen / vd.script.length : 0
  ctx.log(uid, `[VF-X] 覆盖率 ${Math.round(cover * 100)}%（subtitle ${subLen} / 文案 ${vd.script.length}）`)
  if (shots.length >= 2 && cover < 0.8 && vd.script) {
    const segs = ctx.splitScript(vd.script, shots.length)
    let sum = 0
    shots.forEach((s: any, i: number) => { const t = String(segs[i] || '').trim(); if (t) { s.subtitle = t; sum += t.length } })
    if (sum > subLen) { subLen = sum; cover = vd.script ? sum / vd.script.length : 0 }
    ctx.log(uid, `[VF-X] 字幕兜底 → 覆盖 ${Math.round(cover * 100)}%`)
  }
  // ★A4（2026-09-22，用户实测「一句话反复在读」）：**超额覆盖也要修剪** ——
  //   实测 6 镜的 subtitle **一模一样**（6 × 24 字 = 144 字 / 文案 97 字 = 覆盖 148%）
  //   → 配音当然反复念同一句。原来只在覆盖 <80% 时兜底，**>100% 从来没人管**。
  //   修法（确定性）：覆盖 >110% 时，按帧把文案重切成 N 段填回去（与不足时同一套 splitScript）。
  if (shots.length >= 2 && cover > 1.1 && vd.script) {
    const _beforeOver = Math.round(cover * 100)
    const segs = ctx.splitScript(vd.script, shots.length)
    let sum2 = 0
    shots.forEach((s: any, i: number) => { const t = String(segs[i] || '').trim(); if (t) { s.subtitle = t; sum2 += t.length } })
    if (sum2 > 0) { subLen = sum2; cover = vd.script ? sum2 / vd.script.length : 0 }
    ctx.log(uid, `[VF-X] 字幕超额 ${_beforeOver}% → 按帧重切 ${shots.length} 段 → 覆盖 ${Math.round(cover * 100)}%`)
  }

  // ⑥ 规则 B：把 need_ai 的镜号收集起来（1-based）
  const aiShots: number[] = []
  shots.forEach((s: any, i: number) => { if (s.need_ai) aiShots.push(i + 1) })
  // 安全阀：AI 若标太多（> 一半），只保留前 4 个（避免成本失控）
  if (aiShots.length > Math.max(2, Math.floor(shots.length / 2))) {
    aiShots.length = Math.min(4, Math.max(2, Math.floor(shots.length / 2)))
    ctx.log(uid, `[VF-X] ⚠️ AI 标注的镜数过多 → 收敛为前 ${aiShots.length} 镜（控制成本）`)
  }

  const estSec = Math.round(subLen / 4.5)
  vd.shots = shots
  vd.cover = cover
  vd.subLen = subLen
  vd.aiShots = aiShots
  vd.step = 'script'
  VF_MIX_DRAFT.set(uid, vd)
  await saveVfMixDraft(ctx.prisma, uid, vd)
  ctx.log(uid, `[VF-X] 分镜 ${shots.length} 镜（其中 **${aiShots.length} 镜用 AI**：第 ${aiShots.join(',') || '无'} 镜）/ 覆盖 ${Math.round(cover * 100)}% / 预计 ${estSec} 秒 / 风格 ${THEME_NAMES[vd.theme] || vd.theme}`)

  // ⑦ 确认卡（自己拼 —— 成本与 make_ai_video 的实扣**完全同口径**：
  //    ★"AI 镜的【实际 dur 之和】× 50" + "素材部分按文案字数"，不是"全片时长 × 占比"，
  //      否则每镜时长不均时，卡片报价和实扣会对不上）
  // ★A2（2026-09-22）：**去掉 `Math.max(4, …)`** —— 它让"0 镜 AI"也恒收 4 秒 AI 费（≈200 点，
  //   用户实测卡片报的 205 点里 200 点是假的）。现在按**实际 AI 镜秒数**算，与服务端扣费同口径。
  const aiSecExact = shots.reduce(
    (a: number, s: any, i: number) => a + (aiShots.includes(i + 1) ? (Number(s.dur) || 0) : 0), 0)
  const aiSec = Math.round(aiSecExact)
  const cost = Math.max(1, Math.ceil(aiSecExact * 50) + Math.ceil(String(vd.script || '').length / 20))
  // ★A1（2026-09-22）：AI 一镜都没标时，不要再输出"第 **无** 镜"（用户实测看到的就是这句），
  //   而要把后果说清楚（否则用户点确认 → 全镜 AI + 按整片扣费，与报价不符）。
  const _aiHint = aiShots.length
    ? `其中 **第 ${aiShots.join('、')} 镜由 AI 生成**，其余用你的素材。`
    : '**这次没有任何镜被标为"需要 AI"**（直接出片会退化成「全镜 AI」并按整片时长计费）—— 回「重试」我重排一次。'
  const _srcHint = (Array.isArray(vd.uploaded) && vd.uploaded.length) ? '（★只看你本次上传的图）' : ''
  return 'VF_JSON:' + JSON.stringify({
    step: 'script', mixLine: true, source: 'mix',
    topic: vd.topic, script: vd.script,
    shots: shots.map((s: any) => ({
      type: s.type, text: s.text || s.title || '', dur: Math.round((Number(s.dur) || 0) * 10) / 10,
      need_ai: !!s.need_ai,                                  // ★前端可在清单里标出"这镜是 AI 生成"
    })),
    usedImages: imgs.length, brief: String(brief || '').slice(0, 400),
    voice: vd.voice, voiceName: (ctx.voiceList || []).find((v: any) => v.id === vd.voice)?.name || vd.voice,
    theme: vd.theme, cost,
    aspect, aspectName: aspect === 'landscape' ? '横屏 16:9' : '竖屏 9:16',
    coverage: cover, estSec,
    aiShots, aiShotCount: aiShots.length,
    hint: `看完 ${imgs.length} 张图${_srcHint}，排了 ${shots.length} 个镜头（覆盖文案 ${Math.round(cover * 100)}%·预计 ${estSec} 秒·${aspect === 'landscape' ? '按素材定为横屏' : '按素材定为竖屏'}·风格 ${THEME_NAMES[vd.theme] || vd.theme}）—— ${_aiHint}回复「确认」开始出片。`,
  })
}

/* ==================== ⑥ 排分镜（本线自己一份 —— 唯一差别是 need_ai） ==================== */

async function genMixShots(ctx: VfMixCtx, vd: VfMixDraft, shotN: number, imgs: string[], brief: string, isRetry = false): Promise<any[]> {
  const { uid } = ctx
  const script = String(vd.script || '')
  const charN = script.length
  const avgN = Math.max(8, Math.round(charN / Math.max(1, shotN)))
  const aspect = vd.aspectResolved || 'portrait'
  const prompt = `你是短视频编导。把下面这条口播文案排成分镜。
画幅 ${aspect === 'landscape' ? '横屏 16:9' : '竖屏 9:16'}，总时长约 ${vd.dur} 秒，【必须切成 ${shotN} 个镜头左右（±3 以内）】，【各镜 dur 相加必须约等于 ${vd.dur} 秒】。${isRetry ? '\n⚠️上次你没排好：subtitle 必须完整覆盖全文、必须给足镜头数。' : ''}
【可用的图】共 ${imgs.length} 张（图号 1~${imgs.length}）${brief ? '，内容：\n' + brief : ''}

只输出严格 JSON 数组（不要 markdown、不要解释）。每镜字段示例（注意 pick 是【纯数字】）：
[{"type":"bgimage","pick":1,"text":"效率翻10倍","subtitle":"很多营销人还在熬夜改文案、通宵盯屏幕，今天给你看一套能自动出片的系统。","dur":7,"need_ai":false}]
★【type 只能是这 7 种：bgimage / title / list / number / compare / chart / end】——不要自造 subtitle、text、image 等其它 type！
★★【need_ai 决定这一镜的画面从哪来】★★
  · **need_ai=false** —— 这一镜**能用上面那些实拍图讲清楚**时用这个（**绝大多数镜都应该是 false**，省钱）；
  · **need_ai=true** —— 只有这一镜是【抽象概念 / 数据 / 对比 / 情绪渲染 / 开场抓眼 / 结尾号召】等
    "**没有对应实拍图、或需要画面张力**"的情况才标 true。**全片建议 2~4 镜，绝不要超过一半**。
  · need_ai=true 的镜，请同时给一个 prompt 字段（**英文**画面描述，含主体/动作/场景/光影/镜头感，60~80 词，
    画面里**不要出现文字**）："prompt":"A young marketer working late at night, camera slowly pushes in, cinematic warm lighting"
★★【示例里的文字只是"字段长什么样"的演示，**绝对不许照抄示例里的任何词句**】★★
要求：
①【最关键】每镜都要给 subtitle，且【所有 subtitle 拼起来必须**完整覆盖**下面那段文案】（文案共 ${charN} 字，按 ${shotN} 镜算 → **平均每镜约 ${avgN} 字**）
② text 只能是 4~8 字的短语（画面上的大字，不是字幕）
③【pick 必须是纯数字】（如 1、2、3），范围 1~${imgs.length}；每个 bgimage 的 pick 尽量用不同数字
④ 不要编造素材里没有的东西
编镜依据（文案）：
${script}`
  let raw = ''
  try { raw = (await ctx.generateText(prompt)) || '' } catch (e: any) { ctx.log(uid, '[VF-X] 分镜生成失败: ' + String(e?.message || e).slice(0, 120)) }
  let arr = parseShots(raw)
  if (!arr) {
    ctx.log(uid, '[VF-X] 分镜解析失败 → 重试一次')
    try {
      const fixed = (await ctx.generateText(`下面这段本应是 JSON 数组但语法有误（常见：中文引号、结尾多逗号、尾随文字）。请【只修 JSON 语法、不改内容】，只输出修正后的 JSON 数组：\n${String(raw).slice(0, 6000)}`)) || ''
      arr = parseShots(fixed)
    } catch { /* ignore */ }
  }
  if (!arr) { ctx.log(uid, '[VF-X] 分镜 0 镜（解析失败，已重试）'); return [] }
  return mapShots(arr, imgs, charN, shotN, script)
}

/** 从 AI 输出里抠出 JSON 数组（本线自己一份正则容错） */
function parseShots(raw: string): any[] | null {
  const t = String(raw || '').replace(/```json|```/g, '').trim()
  const m = t.match(/\[[\s\S]*\]/)
  if (!m) return null
  try {
    const a = JSON.parse(m[0])
    return Array.isArray(a) && a.length ? a : null
  } catch {
    try {
      // 常见修法：中文引号 → 英文、尾随逗号
      const fixed = m[0].replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/,\s*([\]}])/g, '$1')
      const a = JSON.parse(fixed)
      return Array.isArray(a) && a.length ? a : null
    } catch { return null }
  }
}

/** 归一化：pick → 本地路径、need_ai 保留、未知 type 归一化（本线自己一份） */
function mapShots(arr: any[], imgs: string[], charN: number, shotN: number, script: string): any[] {
  const n = imgs.length
  const used = new Array(Math.max(1, n)).fill(0)
  let last = -1
  const nextIdx = (want: number) => {
    if (n <= 0) return -1
    let idx = (want >= 1 && want <= n) ? want - 1 : -1
    if (idx >= 0 && used[idx] === 0 && idx !== last) { /* 直接用 */ }
    else {
      let best = -1
      for (let k = 0; k < n; k++) {
        if (k === last) continue
        if (best < 0 || used[k] < used[best]) best = k
      }
      idx = best >= 0 ? best : (last + 1) % n
    }
    if (idx >= 0 && idx < n) used[idx]++
    last = idx
    return idx
  }
  const notDemo = (v: any) => {
    const s = String(v == null ? '' : v).trim()
    return DEMO_WORDS.includes(s) ? '' : s
  }
  const out = arr.map((s: any) => {
    const ty = String(s?.type || '')
    const need_ai = !!s.need_ai
    const _pp = need_ai && s.prompt ? { prompt: String(s.prompt).slice(0, 900) } : {}
    const dur = Math.min(15, Math.max(2, parseFloat(s.dur) || 4))
    if (ty === 'bgimage' || ty === 'image' || !KNOWN_TYPES.includes(ty)) {
      const idx = nextIdx(parseInt(s.pick))
      const lp = (idx >= 0 && n > 0) ? imgs[Math.max(0, Math.min(n - 1, idx))] : ''
      const sub = String(s.subtitle || s.text || '').slice(0, 200)
      // 无图可用 → 降级 title（但若 need_ai，画面由 AI 生成，仍可保留）
      if (!lp && !need_ai) return { type: 'title', text: notDemo(s.text) || notDemo(s.title), subtitle: sub, dur, need_ai: false, ..._pp }
      return { type: 'bgimage', src: lp, text: notDemo(s.text).slice(0, 14), subtitle: sub, dur, need_ai, ..._pp }
    }
    const o: any = { ...s, dur, need_ai, ..._pp }
    if (o.text !== undefined) o.text = notDemo(o.text)
    if (o.title !== undefined) o.title = notDemo(o.title)
    if (o.label !== undefined) o.label = notDemo(o.label)
    if (o.cta !== undefined) o.cta = notDemo(o.cta)
    if (Array.isArray(o.items)) {
      o.items = o.items.map((x: any) => (x && typeof x === 'object' ? { ...x, label: notDemo(x.label) } : notDemo(x)))
    }
    delete o.pick
    return o
  }).filter((s: any) => String(s.subtitle || '').trim())

  // 兜底扩镜：镜数不足目标 70% → 按文案重排（本线自己一份）
  if (out.length && out.length < shotN * 0.7) {
    const segs = splitByScript(script, shotN)
    if (segs.length > out.length) {
      const rebuilt = segs.map((t, i) => {
        const base = out[Math.min(i, out.length - 1)] || {}
        return { ...base, subtitle: t, type: base.type || 'bgimage', dur: Math.max(3, Math.round((charN / Math.max(1, segs.length)) / 4.5 * 10) / 10) }
      })
      return rebuilt
    }
  }
  return out
}

/** 按文案切 N 段（本线自己一份，不引用 vf-aivideo 的） */
function splitByScript(script: string, n: number, maxLen = 45): string[] {
  const s = String(script || '').trim()
  if (!s || n <= 0) return []
  const parts = s.split(/(?<=[。！？!?；;])/).map((x) => x.trim()).filter(Boolean)
  const segs: string[] = []
  let buf = ''
  const per = Math.ceil(s.length / n)
  for (const p of parts) {
    if (buf && (buf + p).length > per * 1.35) { segs.push(buf); buf = p }
    else buf += p
    while (buf.length > maxLen) { segs.push(buf.slice(0, maxLen)); buf = buf.slice(maxLen) }
  }
  if (buf) segs.push(buf)
  while (segs.length > n) {
    const a = segs.pop() as string
    segs[segs.length - 1] = (segs[segs.length - 1] || '') + a
  }
  return segs
}
