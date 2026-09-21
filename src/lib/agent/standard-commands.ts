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
}

export const STD_COMMANDS: StdCommand[] = [
  // ── 多步状态机（现成、可用）────────────────────────────────────────────
  { id: 'publish',  text: '帮我发一个视频',          kind: 'machine', note: '发布状态机（选视频→标题→话题→封面→平台→发布）' },
  { id: 'vf_local', text: '用本地成片帮我做一条视频', kind: 'machine', note: '素材线状态机（成片设置卡→分镜确认卡→入队出片）' },
  { id: 'vf_ai',    text: 'AI 制片帮我做一条视频',    kind: 'machine', note: 'AI 制片线状态机（主题卡→选项卡→分镜确认卡→逐镜出片）' },
  { id: 'vf_mix',   text: '素材+AI创作做一条视频',    kind: 'machine', note: '混合线状态机（主题卡→分镜确认卡→只对标注镜调 AI）' },

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
 * ★严格：去空白后必须**完全相等**（不做前缀/包含/模糊匹配）。
 */
export function matchStdCommand(msg: string): StdCommand | null {
  const m = stripWs(msg)
  if (!m) return null
  for (const c of STD_COMMANDS) if (stripWs(c.text) === m) return c
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
