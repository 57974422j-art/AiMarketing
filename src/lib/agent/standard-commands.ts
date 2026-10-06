// ★STD_MODE_V1（2026-09-21，用户定案）：标准模式 = 【命令白名单，锁死】。
//
// ── 用户原话（这是本文件存在的唯一理由，改之前先读一遍）────────────────────
//   · 「请记住 11 条就是命令，少一个字 错一个字都不执行」
//   · 「小红书搜索删除；其它三个点击出现【开发中】；先把手上有搞好」
//   · 「标准模式就给我锁死，每一个独立状态机。点哪个进哪个；进去了任何一条，
//      不管到 1.2.3.4.5 步，看到第一条就是重来」
//   · 「除了这些按键，发什么文字 都可以回复【没有这个功能，请切换去自由模式尝试或联系客服咨询】」
//   · 「这些虽然是文字，它也是一个完整命令。进入这个命令，就没有别的路可以走」
//
// ── 用法（只在 route.ts 一处判定）───────────────────────────────────────
//   const hit = matchStdCommand(userMessage)
//   命中 machine → 清掉所有流程草稿（=重来）并强制进状态机
//   命中 tool    → 照旧交给 AI 带工具跑一次（参数得由 AI 从话里提；批2 会收窄成"只给这一个工具"）
//   命中 wip     → 直接回「开发中」
//   没命中       → 有进行中的流程就交给它；没有 → 回 STD_UNSUPPORTED_REPLY（锁死）
//
// ── 铁律 ────────────────────────────────────────────────────────────────
//   1. 加/改命令【只改这张表】—— 不要再往 route.ts 里加正则（那正是前几轮"每次都这里错"的来源）
//   2. 匹配 = **去掉所有空白后完全相等**（半角/全角空格、换行都忽略）
//      —— 这样按钮上的「AI 制片帮我做一条视频」和你手打的「AI制片帮我做一条视频」都算同一条；
//         除此之外少一个字、错一个字 **一律不执行**。
//   3. text 必须与前端按钮文字一字不差（前端在 src/app/agent/page.tsx 的 FEATURE_TIPS）

export type StdCmdKind =
  | 'machine' // 多步状态机（自己一套流程、自己的卡片）
  | 'tool'    // 单步：交给一个固定工具执行
  | 'wip'     // 还没做好 → 点了只回「开发中」

export type StdCommand = {
  id: string
  text: string      // 命令原文（= 前端按钮文字）
  kind: StdCmdKind
  note: string      // 给后来人：这条归谁、走到哪、缺口在哪
  /** ★VF_RENAME_V1（2026-09-28，用户定案）：**精确相等**的备选写法 ——
   *  只为兼容"改名/拆分之前用户已经说惯的那句"（例如素材线从长句改成短名「图片成片」）。
   *  ⚠️ 规则不变：去空白后必须与 `text` 或某个别名**完全相等**；依旧不做前缀/包含/模糊匹配。
   *  ⚠️ 别名**不列进**锁死回复的清单（清单只列 text）—— 保证"按钮 = 命令"一一对应，界面不啰嗦。 */
  alias?: string[]
}

export const STD_COMMANDS: StdCommand[] = [
  // ── 多步状态机（现成、可用）────────────────────────────────────────────
  { id: 'publish',  text: '帮我发一个视频',          kind: 'machine', note: '发布状态机（选视频→标题→话题→封面→平台→发布）' },
  // ★VF_RENAME_V1（2026-09-28，用户定案）：「用本地成片帮我做一条视频」→ 短名「图片成片」，
  //   和新加的「图视混剪」凑成一对（图片成片 = 只用你仓库的图；图视混剪 = 图片 + 视频片段混排）。
  //   原来那句长话保留成【别名】—— 老用户照原样说照样能进（仍是严格相等，不放宽匹配）。
  { id: 'vf_local', text: '图片成片',               kind: 'machine', alias: ['用本地成片帮我做一条视频', '素材成片'], note: '素材线状态机（成片设置卡→分镜确认卡→入队出片）' },
  // ★VF_VIDEOLINE_V1 补登记命令表（2026-09-28，用户实测事故）：
  //   这条线 09-24 建好时**只写了入口词、漏登记命令表** → 标准模式下说「视频混剪」会被
  //   锁死回复（STD_UNSUPPORTED_REPLY）拦住，根本走不到它的分派（route.ts 的视频混剪分派在锁死之后）。
  //   用户实测现象：他自己那台能进（因为账号上另有旧草稿把闸门顶开），别的机器/账号进不去。
  //   ⚠️ 这条线自己的入口正则认「视频混剪/混剪」，故把两种说法都做成别名，避免"用户打旧词被锁死"。
  { id: 'vf_video', text: '图视混剪',               kind: 'machine', alias: ['视频混剪', '混剪', '视频混剪做一条成片'], note: '视频混剪线状态机（设置卡→分镜确认卡→出片；仓库视频片段 + 图片混排，AI 决定哪几镜用视频）' },
  // ★VF_RENAME_V1(2026-09-28，用户定案)：四条成片线统一短名 ——
  //   图片成片 / 图视混剪 / AI 制片 / 素材+AI。旧长句一律保留成【别名】，老客户端按钮照旧能用。
  // ★VF_I2V_V1（2026-09-29）：把「用我的图动起来」登记成 AI 制片线的**别名** ——
  //   标准模式是命令白名单锁死（非命令且无进行中流程 → STD_UNSUPPORTED_REPLY），
  //   图生视频是并入 AI 制片线的一个入口，不登记就永远被锁死在闸门外（与 09-28 视频混剪那次同一类坑）。
  //   仍是**严格相等**匹配（别名只是"另一个精确写法"，不放宽规则）。
  { id: 'vf_ai',    text: 'AI 制片',               kind: 'machine', alias: ['AI 制片帮我做一条视频', '用我的图动起来'], note: 'AI 制片线状态机（主题卡→选项卡→分镜确认卡→逐镜出片；别名支持图生视频）' },
  { id: 'vf_mix',   text: '素材+AI',               kind: 'machine', alias: ['素材+AI创作做一条视频'], note: '混合线状态机（主题卡→分镜确认卡→只对标注镜调 AI）' },
  // ★VF_PPTSOLO_V1（2026-10-06 用户定案「彻底拆开」）：「PPT 成片」= 第 6 条状态机线（HTML 逐帧动态 PPT）。
  //   用户原话：「如果 2 者相互矛盾，你给我彻底拆开，做个 PPT 成片 / HTML 逐帧成片，原设计图视混剪和图片成片
  //   单独保留。不要混在一起。要不这个好了那个又坏了，我们调试起来很麻烦。」
  //   它是**唯一**能出「动态 PPT」的入口 —— 图片成片/图视混剪的成片方式不再提供 deck 选项（做成片方式的封路）。
  //   时序真源 = 配音（页 = PPT 版式页；不取素材、不排分镜、不插素材图）⇒ 与上面几条线互不干扰。
  //   ⚠️ 必须登记在这张表里：标准模式是命令白名单锁死（不登记 → 说「PPT成片」会被 STD_UNSUPPORTED_REPLY 拦住；
  //   本项目已因此踩过两次坑：视频混剪线漏登记、图生视频漏登记）。
  { id: 'vf_ppt',   text: 'PPT成片',               kind: 'machine', alias: ['动态PPT', '动态PPT成片'], note: 'PPT 成片线状态机（PPT 设置卡→确认卡→新引擎出片；只吃文案+皮肤，配音为时序真源）' },
  // ★VF_LEAD_V1（2026-09-29 老板定案）：「智能获客」= 第 5 条状态机线（获客面板）。
  //   老板原话：「允许评论私信，和现在视频一样**增加一个按键『智能获客』**……也是 AGENT 页加一个状态机，标准模式下。」
  //   ⚠️ 必须登记在这张表里 —— 标准模式是命令白名单锁死（不登记 → 说「智能获客」会被 STD_UNSUPPORTED_REPLY 拦住，
  //   本项目已因此踩过两次坑：视频混剪线漏登记、图生视频漏登记）。
  //   ⚠️ 本轮范围 = **只配置 + 预演，不自动执行**（老板原话「暂时不做自动获客」）。实现在 src/lib/agent/lead.ts。
  { id: 'lead',     text: '智能获客',               kind: 'machine', note: '获客面板状态机（设置面板卡→保存配置／预演；本轮不自动执行）' },

  // ── 单步（现成、可用；批2 收窄为"只给这一个工具"）──────────────────────
  { id: 'copy',     text: '帮我写一个小红书文案',      kind: 'tool',    note: '工具 generate_copy（平台=小红书）' },
  { id: 'poster',   text: '帮我生成一张产品海报',      kind: 'tool',    note: '工具 generate_image（会先搜公共模板）' },
  { id: 'digital',  text: '帮我生成一个数字人口播',    kind: 'tool',    note: '工具 digital_human_speak' },

  // ── 缺口（用户定案：先回"开发中"，把手上 7 条做扎实）──────────────────
  { id: 'hotspot',  text: '帮我查一下今日热点',        kind: 'wip',     note: '⚠️ 缺专用工具（只有 /api/agent/hotspots 接口，工具箱里没有热点工具）' },
  { id: 'music',    text: '帮我配一段背景音乐',        kind: 'wip',     note: '⚠️ Agent 侧无音乐工具（只有网页 /api/music/generate）' },
  { id: 'todo',     text: '帮我记录一件事：明天要交房租', kind: 'wip',   note: '⚠️ upsert_memory 只有"长期记忆"语义，没有待办/提醒' },
]

/** 去掉所有空白（半角/全角/换行）—— 用于"去空格后严格相等" */
const stripWs = (s: string): string => String(s || '').replace(/[\s\u3000]+/g, '')

/**
 * 命中命令才返回条目，否则 null。
 * ★严格：去空白后必须与 `text`（按钮文字）或它的某个 `alias` **完全相等**
 *   —— 依旧不做前缀/包含/模糊匹配（别名是"另一个精确写法"，不是放宽规则）。
 */
export function matchStdCommand(msg: string): StdCommand | null {
  const m = stripWs(msg)
  if (!m) return null
  for (const c of STD_COMMANDS) {
    if (stripWs(c.text) === m) return c
    if (c.alias && c.alias.some((a) => stripWs(a) === m && stripWs(a))) return c
  }
  return null
}

/** 非命令 + 没有任何进行中的流程 → 固定回复（标准模式锁死） */
export const STD_UNSUPPORTED_REPLY: string =
  '标准模式只支持下面这几条命令（点下方按钮即可，**少一个字、错一个字都不执行**）：\n' +
  STD_COMMANDS.map((c) => '· ' + c.text).join('\n') +
  '\n\n你这句话不在命令表里 —— 请【切换到自由模式】再试，或联系客服咨询。'

/** 「开发中」占位命令的固定回复 */
export function STD_WIP_REPLY(text: string): string {
  return `「${text}」还在开发中 —— 请先用手上已经通的这几条命令。`
}

/* ══════════════════ ★VF_I2VDFLT_V1（2026-09-30）—— 标准模式闸门「放行规则」的纯函数 ══════════════════
 * 用户原话（本节的由来）：
 *   「关掉图转视频，直接生成」被标准模式命令白名单拦掉（回了"请切自由模式"）→ 这是上一轮的错，要修。
 * 规则：
 *   · 出片确认卡上的「🚫 关掉动图重出」发的是**我们自己的协议串**（`VF_I2V_OFF:`，用户不会手打）；
 *   · 用户也可能直接说「关掉动图 / 保持静态 / 全部动起来 / 智能筛」这类**改设置**的话；
 *   · 上面这些**只有在【该会话有进行中的成片草稿】时才放行** —— 没草稿时保持"命令白名单锁死"的原设计
 *     （否则用户随便说话都会掉进状态机）。
 * 这些规则放在这里（而不是散在 route.ts 的正则里），是因为本文件是"命令/闸门"的唯一权威，且**可单测**。
 * ══════════════════════════════════════════════════════════════════════════════════════════════ */

/** ★只读【查询类】例外：出片入队后草稿即作废（VF_RUN_CLOSE_V1），"任务在跑"在草稿里看不出来 ——
 *  若把「视频做得怎么样了」也锁死，用户就没法查进度。这类**没有草稿也放行**。 */
export const STD_QUERY_RE = /视频做得怎么样了|做到哪了|进度|做完了吗|好了没|好了吗/

/** ★「改设置」的说法（i2v 动图相关）——宽松但**限词**；只有【有草稿】时才放行（见 stdGatePass）。
 *  ★VF_MATUI_V1（2026-09-30）：补「只动我勾选的」这一档的说法（用户新加的档位，见 i2vIntentOf）。 */
export const STD_SETTING_RE = /关掉?图转视频|关掉?动图|不要动图|保持静态|全部动起来|让图动起来|智能筛|只动我?勾选|只动勾选|勾选的才动/
/** ★我们自己的卡片协议串：出片确认卡「🚫 关掉动图重出」产生（用户不会手打）。 */
export const STD_I2V_OFF_RE = /^VF_I2V_OFF\s*[:{]/

/* ★VF_MEMORY_V1（2026-09-30 用户定案）：素材「✅ 当素材用 / 🚫 别用」发的协议串 `VF_MAT_SET:`。
 * 闸门口径与 `VF_I2V_OFF` **完全一致**：
 *   · **有进行中的成片草稿** → 放行（`stdGatePass` 在 hasDraft=true 时一律 true）→ 由成片线在
 *     step='script' 里改名单并重出确认卡；
 *   · **没有草稿** → 依旧锁死（回 STD_UNSUPPORTED_REPLY）—— 协议串只服务"卡上那一下"，
 *     不参与流程时不该开口子（否则用户随手粘一串 JSON 就会掉进状态机）。
 * 正则本体放 material-pool.ts（`STD_MAT_SET_RE`）—— 那里同时有解析函数（纯函数、可单测）。
 */

/** 这句话是不是「改设置的动图说法」或我们自己的 `VF_I2V_OFF` 协议串。 */
export function isStdSettingMessage(msg: string): boolean {
  const m = String(msg || '').trim()
  if (!m) return false
  if (STD_I2V_OFF_RE.test(m)) return true
  return STD_SETTING_RE.test(m)
}

/**
 * 没有进行中的草稿时，这一句能不能放行？
 *   true  = 放行（只读查询 / 只重渲协议 —— 不参与流程、不烧 AI）；
 *   false = 锁死（回 STD_UNSUPPORTED_REPLY）。
 * ⚠️ 「改设置」的说法（`STD_SETTING_RE`）与 `VF_I2V_OFF` 协议串**不在**这里 —— 它们没草稿时也要拦。
 */
export function isStdNoDraftAllowed(msg: string): boolean {
  const m = String(msg || '').trim()
  if (!m) return false
  if (STD_QUERY_RE.test(m)) return true
  // ★VF_RENDER_ONESHOT_V1：片已出、草稿作废后，「只重渲第 N 镜」发的 VF_EDIT 协议串仍要能进（不烧 AI）
  if (/^VF_EDIT\s*[:{]/.test(m)) return true
  return false
}

/**
 * ★标准模式闸门的最终判定（纯函数，可单测）——「非命令」的一句话该不该放行。
 * @param msg      用户原文
 * @param hasDraft 该会话有没有进行中的流程（发布 / 任一条成片线草稿）
 * 返回 true = 继续走流程；false = 回 STD_UNSUPPORTED_REPLY（锁死）。
 *   · 有草稿 → **一律放行**（含"改设置"的说法、`VF_I2V_OFF` 协议串、以及各线的「确认/重试」等）；
 *   · 没草稿 → 只有只读查询 / `VF_EDIT` 只重渲放行，其余（含"改设置"）**一律锁死**。
 */
export function stdGatePass(msg: string, hasDraft: boolean): boolean {
  if (hasDraft) return true
  return isStdNoDraftAllowed(msg)
}

/**
 * ★VF_I2VDFLT_V1：把「用户这句话想怎么动图」解析成 i2v 取值；不是这类话 → null。
 *   'off' = 关掉动图/保持静态；'picked' = 只动我勾选的（★VF_MATUI_V1 新增）；
 *   'all' = 全部动起来；'on' = 智能筛。
 * 用途：两条成片线（图片成片 / 图视混剪）在 step='script' 收到这句话时，
 *   把草稿的 i2v 改掉并**重新出一份确认卡**（金额随之变小/变大，用户立刻看得到）。
 * ⚠️ 顺序不能反：先判 off（"关掉图转视频"里含"图"、"让图动起来"里含"动起来"），
 *   ★VF_MATUI_V1 再把 picked 放在 all **之前**（"只动我勾选的"里也含"动"）。
 */
export function i2vIntentOf(msg: string): 'off' | 'picked' | 'all' | 'on' | null {
  const m = String(msg || '').trim()
  if (!m) return null
  if (STD_I2V_OFF_RE.test(m)) return 'off'
  // ★VF_MATUI_V1（2026-09-30）修一个真会踩的坑：**别的协议串不算"改设置"的说法** ——
  //   各线的分派是"先判 i2vIntentOf、后判素材名单"，而素材名单的协议串里带着**文件名**
  //   （`VF_MAT_SET:{"name":"动起来.jpg",...}` / `VF_MAT_SWAP:{"out":"...动起来.jpg"}`）→
  //   文件名里只要含「动起来」，就会被误判成"全部动起来"→ 走错分支（名单动作被吞）。
  if (/^(VF_MAT_SET|VF_MAT_SWAP|VF_EDIT|VF_BRIEF|VF_JSON|VF_FORM|MAKE_VIDEO)/i.test(m)) return null
  if (/关掉?图转视频|关掉?动图|不要动图|保持静态/.test(m)) return 'off'
  if (/智能筛/.test(m)) return 'on'
  // ★VF_MATUI_V1（2026-09-30 用户定案）：必须排在 all 之前 —— 否则"只动我勾选的"会被当成"全部动"
  if (/只动我?勾选|只动勾选|勾选的才动/.test(m)) return 'picked'
  if (/全部动起来|全都动|全动|让图动起来|图动起来|动起来/.test(m)) return 'all'
  return null
}
