/**
 * ★VF_LEAD_V1（2026-09-29 老板定案）——「智能获客」= AGENT 页标准模式下的一条**独立状态机线**。
 *
 * ── 老板原话（本文档存在的唯一理由，改之前先读一遍）─────────────────────────
 *   「允许评论私信，和现在视频一样**增加一个按键『智能获客』**。前端弹**详细表格**。**可填写可推荐话术**。」
 *   「频控上限：这个你**找个参考值**。或者**有输入框控制速度**。先不考虑合规，我会测试……
 *     我要先知道**极限能力**。」
 *   「获客也有**视频一样的面板**，包括**选哪些平台可以勾**。当然首先要**确认有用户登录态**。
 *     是否使用现有的工具去获客，我们**热点采集的模式相似**。**暂时不做自动获客**。
 *     也是 **AGENT 页加一个状态机，标准模式下**。」
 *
 * ── 本轮范围（务必守住，别越界）──────────────────────────────────────────
 *   ✅ 做：入口命令（登记进 standard-commands.ts）→ 一张“智能获客设置面板”卡 → 保存配置 / 预演。
 *   ❌ 不做：**自动执行**（不真的去评论/私信/关注）。老板明说「暂时不做自动获客」。
 *   → 面板上必须有一句范围说明，免得用户以为点了就开始发；执行器留给下一版（见文件末尾 TODO）。
 *
 * ── 与四条成片线的关系（为什么单独一个文件）────────────────────────────
 *   与 `src/lib/agent/vf/*` 是【平行的一套】：自己的入口词、自己的草稿 tag（`vf_draft_lead`）、
 *   自己的协议前缀（`LEAD_CFG:`）。**绝不复用 VF_FORM** —— 成片三条线共用 VF_FORM 已经因为
 *   “字段撞车”踩过坑（AI 制片线要靠 `source/voice/theme/bgm` 逐个排除才不认领），
 *   获客线不该再挤进去。用独立前缀 = 天然不可能污染别线草稿。
 *
 * ── 下一版执行器读什么（根级字段 = 契约）────────────────────────────────
 *   草稿根级固定这几个键，执行器（未开发）直接读：
 *     platforms: string[]                      勾选平台 id（只该有“已登录”的）
 *     scripts:   { scene, text }[]             话术库（评论/私信共用，按场景选）
 *     keywords:  string[]                      目标人群/关键词（1~3）
 *     speed:     { tier, commentPerDay, dmPerDay, gapMin, gapMax }   频控（0=不限）
 *     sources:   string[]                      数据来源 id（复用既有采集能力）
 *   ⚠️ 频控的 `commentPerDay/dmPerDay = 0` 语义是【不限】（极速档）——执行器必须按此解释，
 *      不要当成“0 条”。
 */

import { stripEmoji } from './vf/anti-ai'
import { PLATFORMS } from './platforms'

/* ==================== ① 入口词 / 协议前缀 ==================== */

/** 标准模式命令原文（必须与 standard-commands.ts 的 `text` 和 page.tsx 的 FEATURE_TIPS 一字不差） */
export const LEAD_ENTRY_WORD = '智能获客'
/** 面板提交用的协议前缀（独立于 VF_FORM，绝不与成片线撞字段） */
export const LEAD_CFG_PREFIX = 'LEAD_CFG:'

const stripWs = (s: string): string => String(s || '').replace(/[\s\u3000]+/g, '')

/** 是否「智能获客」入口词 —— **严格相等**（沿用项目口径：去空白后完全相等，不做前缀/包含/模糊） */
export function matchesLeadLine(msg: string): boolean {
  return stripWs(msg) === stripWs(LEAD_ENTRY_WORD)
}

/* ==================== ② 平台（唯一真源复用 platforms.ts） ==================== */

export interface LeadPlatformDef {
  id: string
  name: string
  icon: string
  loginUrl: string
}

/** 6 个平台（抖音/小红书/微博/视频号/B站/快手）——取自 `platforms.ts`，不另立一份 */
export const LEAD_PLATFORMS: LeadPlatformDef[] = PLATFORMS.map((p) => ({
  id: p.id, name: p.name, icon: p.icon, loginUrl: p.loginUrl,
}))

/**
 * ★「未登录的平台默认不勾」——老板定案「首先要确认有用户登录态」。
 * accounts = 客户端 buCheck 的登录态数组（[{ id:'douyin', loggedIn:true }, ...]）。
 * 客户端传进来我们只认 `loggedIn === true` 的平台；**传空/未传 → 一律不勾**
 * （宁可用户自己勾，也不默认替他勾一个"可能没登录"的平台）。
 */
export function defaultCheckedPlatforms(accounts?: any[]): string[] {
  const on = new Set(
    (Array.isArray(accounts) ? accounts : []).filter((a) => a && a.loggedIn).map((a) => String(a.id)),
  )
  return LEAD_PLATFORMS.filter((p) => on.has(p.id)).map((p) => p.id)
}

/* ==================== ③ 频控速度档（参考值写进常量并留档） ==================== */

/**
 * ⚠️ 频控参考值（★老板原话「这个你找个参考值」「先不考虑合规，我要先知道极限能力」）：
 *   这是【工程参考值，不是平台合规值】——真实平台风控阈值不公开，这里只给“速度档”，
 *   并按老板要求给到【极速档（不设上限，风险自担）】。默认档 = 慢（最稳）。
 *   数值口径：单号（单账号）/ 每日。
 */
export type LeadSpeedTier = 'slow' | 'medium' | 'fast' | 'turbo'

export interface LeadSpeedPreset {
  id: LeadSpeedTier
  name: string
  /** 单号每日评论上限；0 = 不设上限（极速档） */
  commentPerDay: number
  /** 单号每日私信上限；0 = 不设上限（极速档） */
  dmPerDay: number
  /** 两次动作之间的随机间隔下限（秒） */
  gapMin: number
  /** 两次动作之间的随机间隔上限（秒） */
  gapMax: number
  /** 风险等级（给界面如实标注，不美化） */
  risk: string
}

export const LEAD_SPEED_PRESETS: LeadSpeedPreset[] = [
  { id: 'slow',   name: '慢（默认·最稳）', commentPerDay: 30,  dmPerDay: 10, gapMin: 90, gapMax: 180, risk: '低' },
  { id: 'medium', name: '中',             commentPerDay: 100, dmPerDay: 30, gapMin: 45, gapMax: 120, risk: '中' },
  { id: 'fast',   name: '快',             commentPerDay: 300, dmPerDay: 80, gapMin: 20, gapMax: 60,  risk: '高' },
  { id: 'turbo',  name: '极速（不设上限·风险自担）', commentPerDay: 0, dmPerDay: 0, gapMin: 5, gapMax: 15, risk: '极高' },
]

/** 默认档 = 慢（老板没指定时，一切取保守值） */
export const LEAD_DEFAULT_TIER: LeadSpeedTier = 'slow'

export interface LeadSpeed {
  tier: LeadSpeedTier
  commentPerDay: number
  dmPerDay: number
  gapMin: number
  gapMax: number
}

function numOf(v: any, dflt: number): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : dflt
}

/**
 * 档位 → 具体数值（含「输入框自定义」覆盖）。
 * 规则：① 认不出的档位 → 回默认档（不抛错）；② 自定义值覆盖预设；
 *      ③ 间隔做钳制（1~3600 秒，且 gapMin ≤ gapMax）—— 防用户填 0 秒把节奏打成机器。
 * ⚠️ commentPerDay/dmPerDay 允许 0，语义 = 不限（极速档）。
 */
export function resolveLeadSpeed(tier: any, custom?: any): LeadSpeed {
  const tiers: LeadSpeedTier[] = ['slow', 'medium', 'fast', 'turbo']
  const t: LeadSpeedTier = tiers.indexOf(String(tier) as LeadSpeedTier) >= 0
    ? (String(tier) as LeadSpeedTier) : LEAD_DEFAULT_TIER
  const p = LEAD_SPEED_PRESETS.find((x) => x.id === t) || LEAD_SPEED_PRESETS[0]
  const c = custom && typeof custom === 'object' ? custom : {}
  const commentPerDay = Math.max(0, Math.round(numOf(c.commentPerDay, p.commentPerDay)))
  const dmPerDay = Math.max(0, Math.round(numOf(c.dmPerDay, p.dmPerDay)))
  let gapMin = Math.max(1, Math.min(3600, Math.round(numOf(c.gapMin, p.gapMin))))
  let gapMax = Math.max(1, Math.min(3600, Math.round(numOf(c.gapMax, p.gapMax))))
  if (gapMax < gapMin) gapMax = gapMin
  return { tier: t, commentPerDay, dmPerDay, gapMin, gapMax }
}

/* ==================== ④ 数据来源（复用既有采集能力，不新写爬虫） ==================== */

export interface LeadDataSource {
  id: string
  name: string
  /** 既有接口（复用，不新写爬虫） */
  api: string
  note: string
  /** ⚠️ 现网仅 Admin 可用（P0 缺口，见 docs/获客系统方案-20260929.md 第四节第 5 条） */
  adminOnly: boolean
  /** 默认是否勾选 */
  defaultOn: boolean
}

export const LEAD_DATA_SOURCES: LeadDataSource[] = [
  { id: 'hotspot',      name: '今日热点（多源聚合）', api: '/api/agent/hotspots',        note: '服务器直调头条/百度 + 客户端上报', adminOnly: false, defaultOn: true },
  { id: 'trending',     name: '平台热榜',             api: '/api/mediacrawler/trending', note: '抖音热榜入库 CrawledTrending',    adminOnly: true,  defaultOn: true },
  { id: 'lead_pool',    name: '已有线索池',           api: '/api/data-center/leads',     note: '已采集的线索/评论池（去重后再触达）', adminOnly: false, defaultOn: true },
  { id: 'kw_search',    name: '关键词搜索（视频）',   api: '/api/mediacrawler/search',   note: '⚠️ 现网仅 Admin 可用',           adminOnly: true,  defaultOn: false },
  { id: 'comment_crawl', name: '评论抓取',            api: '/api/mediacrawler/comments', note: '⚠️ 现网仅 Admin 可用',           adminOnly: true,  defaultOn: false },
  { id: 'user_profile', name: '用户主页 / 画像',      api: '/api/mediacrawler/user',     note: '⚠️ 现网仅 Admin 可用',           adminOnly: true,  defaultOn: false },
]

export function defaultCheckedSources(): string[] {
  return LEAD_DATA_SOURCES.filter((s) => s.defaultOn).map((s) => s.id)
}

/* ==================== ⑤ 话术清洗与限长 ==================== */

/** 单条话术最长字数（评论区限长参考；超出直接截断，不靠 AI 自觉） */
export const LEAD_SCRIPT_MAX = 120
/** 场景/触发条件最长字数 */
export const LEAD_SCENE_MAX = 20
/** 话术库最多条数（防刷屏） */
export const LEAD_SCRIPT_MAX_N = 30

export interface LeadScript { scene: string; text: string }

/**
 * 话术清洗（★老板要求「话术要**去 emoji、限长**」）：
 *   ① 去 emoji/装饰符号 —— 复用 anti-ai.ts 的 stripEmoji（与成片画面文字同一套规矩，免得两处走偏）
 *   ② 换行/多空格压成单空格（一句话术 = 一行）
 *   ③ 去首尾引号/标点
 *   ④ 硬截断到 max（默认 120 字）
 */
export function cleanLeadText(v: any, max: number = LEAD_SCRIPT_MAX): string {
  return stripEmoji(v)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s"'“”「」『』:：,，。]+/, '')
    .replace(/[\s"'“”「」『』]+$/, '')
    .trim()
    .slice(0, max)
}

/** 归一化整张话术表：清洗 + 丢掉空话术 + 兜底场景名 + 去重 + 封顶 */
export function normalizeLeadScripts(list: any, maxN: number = LEAD_SCRIPT_MAX_N): LeadScript[] {
  const out: LeadScript[] = []
  const seen = new Set<string>()
  for (const it of (Array.isArray(list) ? list : [])) {
    const scene = cleanLeadText(it && typeof it === 'object' ? it.scene : '', LEAD_SCENE_MAX) || '通用'
    const text = cleanLeadText(it && typeof it === 'object' ? it.text : it)
    if (!text) continue
    if (seen.has(text)) continue
    seen.add(text)
    out.push({ scene, text })
    if (out.length >= maxN) break
  }
  return out
}

/* ==================== ⑥ 草稿（本线自己一份，独立 tag） ==================== */

/** ★独立草稿 tag —— 与成片线（vf_draft_base / vf_draft_ai / vf_draft_mix / vf_draft_video）完全不同。
 *  ⚠️ 读写清一律【精确匹配 equals】：历史上成片线用 `contains` 出过“子串误删别线草稿”的事故。 */
export const LEAD_TAG = 'vf_draft_lead'

export interface LeadDraft {
  step: 'lead_setup' | 'lead_preview'
  platforms: string[]
  scripts: LeadScript[]
  keywords: string[]
  speed: LeadSpeed
  sources: string[]
  updatedAt?: number
}

export function newLeadDraft(): LeadDraft {
  return {
    step: 'lead_setup',
    platforms: [],                    // 空 = 让前端按“已登录平台”默认勾（见 defaultCheckedPlatforms）
    scripts: [],
    keywords: [],
    speed: resolveLeadSpeed(LEAD_DEFAULT_TIER),
    sources: defaultCheckedSources(),
    updatedAt: Date.now(),
  }
}

/**
 * ★字段白名单（安全边界）：只接受本线认识的字段，其余**一律忽略**。
 * 为什么单独一个函数：面板提交的是 JSON，若直接 `{...draft, ...patch}` 合并，
 * 别人线上的字段（如成片线的 `pin`/`topic`）就会【污染本线草稿】。这里做白名单 = 天然隔离。
 * （自测 `scripts/vf-lead-selftest.ts` 会带 `pin`/`topic` 来验证它们进不来。）
 */
export function applyLeadPatch(d: LeadDraft, patch: any): LeadDraft {
  const p = patch && typeof patch === 'object' ? patch : {}
  const out: LeadDraft = { ...d, speed: { ...d.speed } }

  if (Array.isArray(p.platforms)) {
    const allow = new Set(LEAD_PLATFORMS.map((x) => x.id))
    out.platforms = Array.from(new Set(p.platforms.map((x: any) => String(x)).filter((x: string) => allow.has(x))))
  }
  if (Array.isArray(p.sources)) {
    const allow = new Set(LEAD_DATA_SOURCES.map((x) => x.id))
    out.sources = Array.from(new Set(p.sources.map((x: any) => String(x)).filter((x: string) => allow.has(x))))
  }
  if (Array.isArray(p.scripts)) {
    out.scripts = normalizeLeadScripts(p.scripts)
  } else if (typeof p.scripts === 'string') {
    // 兼容“一行一条”的纯文本（前端另一种可能形态）
    out.scripts = normalizeLeadScripts(p.scripts.split('\n'))
  }
  if (Array.isArray(p.keywords)) {
    out.keywords = p.keywords.map((k: any) => cleanLeadText(k, LEAD_SCENE_MAX)).filter(Boolean).slice(0, 3)
  } else if (typeof p.keywords === 'string') {
    out.keywords = p.keywords.split(/[,，、|]/).map((s) => cleanLeadText(s, LEAD_SCENE_MAX)).filter(Boolean).slice(0, 3)
  }
  if (p.speed && typeof p.speed === 'object') {
    out.speed = resolveLeadSpeed(p.speed.tier, p.speed)
  } else if (typeof p.tier === 'string') {
    out.speed = resolveLeadSpeed(p.tier, p.custom)
  }
  out.updatedAt = Date.now()
  return out
}

export async function saveLeadDraft(db: any, uid: number | string, d: LeadDraft): Promise<void> {
  const content = '智能获客草稿:' + JSON.stringify(d)
  try {
    const ex = await db.agentMemory.findFirst({ where: { userId: String(uid), tags: { equals: LEAD_TAG } }, orderBy: { updatedAt: 'desc' } })
    if (ex) await db.agentMemory.update({ where: { id: ex.id }, data: { content } })
    else await db.agentMemory.create({ data: { userId: String(uid), content, tags: LEAD_TAG, salience: 0.5 } })
  } catch { /* 草稿存不上不影响本轮回复 */ }
}

export async function loadLeadDraft(db: any, uid: number | string): Promise<LeadDraft | null> {
  try {
    const dm = await db.agentMemory.findFirst({ where: { userId: String(uid), tags: { equals: LEAD_TAG } }, orderBy: { updatedAt: 'desc' } })
    if (dm?.content) {
      // 只取 JSON 部分（历史串线可能留下中文前缀，直接 JSON.parse 会失败）
      const t = String(dm.content)
      const i = t.indexOf('{')
      return JSON.parse(i >= 0 ? t.slice(i) : t)
    }
  } catch { /* ignore */ }
  return null
}

export async function clearLeadDraft(db: any, uid: number | string): Promise<void> {
  try { await db.agentMemory.deleteMany({ where: { userId: String(uid), tags: { equals: LEAD_TAG } } }) } catch { /* ignore */ }
}

export async function hasLeadDraft(db: any, uid: number | string): Promise<boolean> {
  return !!(await loadLeadDraft(db, uid))?.step
}

/* ==================== ⑦ 预演（只算清单与节奏，不发） ==================== */

export interface LeadPreview {
  actions: string[]
  cadence: string
  /** 所有勾选平台合计的每日上限（0 = 不限） */
  perDay: { comment: number; dm: number }
  riskNote: string
  scopeNote: string
}

function speedName(tier: LeadSpeedTier): string {
  return LEAD_SPEED_PRESETS.find((s) => s.id === tier)?.name || tier
}

export function buildLeadPreview(d: LeadDraft): LeadPreview {
  const n = Math.max(1, d.platforms.length)
  const sp = d.speed
  const cnName = (id: string) => LEAD_PLATFORMS.find((p) => p.id === id)?.name || id
  const srcName = (id: string) => LEAD_DATA_SOURCES.find((s) => s.id === id)?.name || id
  const un = (v: number) => (v === 0 ? '不限' : String(v))
  const totalComment = sp.commentPerDay === 0 ? 0 : sp.commentPerDay * n
  const totalDm = sp.dmPerDay === 0 ? 0 : sp.dmPerDay * n
  const sample = d.scripts[0]?.text || ''
  const actions: string[] = [
    `① 数据采集来源：${d.sources.length ? d.sources.map(srcName).join('、') : '（未勾选任何来源）'}`,
    `② 目标人群/关键词：${d.keywords.length ? d.keywords.join('、') : '（未填）'}`,
    `③ 触达平台：${d.platforms.length ? d.platforms.map(cnName).join('、') : '（未勾选任何平台）'}`,
    `④ 评论话术：${d.scripts.length} 条${sample ? `（示例：${sample.slice(0, 40)}${sample.length > 40 ? '…' : ''}）` : ''}`,
    `⑤ 私信话术：${d.scripts.length} 条（与评论话术同一话术库，按场景/触发条件选用）`,
    `⑥ 每个账号每日上限：评论 ≤ ${un(sp.commentPerDay)} / 私信 ≤ ${un(sp.dmPerDay)}；动作间隔 ${sp.gapMin}~${sp.gapMax} 秒随机（档位：${speedName(sp.tier)}）`,
    `⑦ 合计（${d.platforms.length} 个平台）：评论 ≤ ${un(totalComment)} / 私信 ≤ ${un(totalDm)} 每天`,
  ]
  return {
    actions,
    cadence: `每号每日 评论 ≤ ${un(sp.commentPerDay)} / 私信 ≤ ${un(sp.dmPerDay)}，间隔 ${sp.gapMin}~${sp.gapMax} 秒随机`,
    perDay: { comment: totalComment, dm: totalDm },
    riskNote: sp.tier === 'turbo'
      ? '⚠️ 极速档不设上限：这是“极限能力”参考值，**不是安全值**——平台反垃圾会限流甚至封号，风险自担。'
      : `当前档位风险：${LEAD_SPEED_PRESETS.find((s) => s.id === sp.tier)?.risk || '未知'}（平台风控阈值不公开，仅供参考）。`,
    scopeNote: '本轮只【预览动作清单与频控节奏】，不会真的去评论 / 私信 / 关注。要真正执行请等下一版执行器。',
  }
}

/** 面板卡片（step='lead_setup' / 'lead_preview' 都用这一份数据结构） */
export function buildLeadSetupCard(d: LeadDraft): any {
  return {
    step: 'lead_setup',
    leadLine: true,
    platforms: LEAD_PLATFORMS,
    checked: d.platforms,
    scripts: d.scripts,
    keywords: d.keywords,
    speed: d.speed,
    speedPresets: LEAD_SPEED_PRESETS.map((s) => ({
      id: s.id, name: s.name, commentPerDay: s.commentPerDay, dmPerDay: s.dmPerDay,
      gapMin: s.gapMin, gapMax: s.gapMax, risk: s.risk,
    })),
    sources: LEAD_DATA_SOURCES.map((s) => ({ id: s.id, name: s.name, api: s.api, note: s.note, adminOnly: s.adminOnly })),
    checkedSources: d.sources,
    scriptMax: LEAD_SCRIPT_MAX,
    hint: '「智能获客」设置面板：勾平台（只显示已登录的能勾）→ 填/让 AI 推荐话术 → 填关键词 → 选速度档 → 勾数据来源。',
    scopeNote: '本轮只做【配置与预演】，不会自动执行（不会真的去评论/私信）。',
  }
}

/* ==================== ⑧ 提交解析 / 接管判定 / 主流程 ==================== */

/** 解析 `LEAD_CFG:{...}`（面板提交） */
export function parseLeadCfg(msg: string): any | null {
  const m = String(msg || '').trim().match(/^LEAD_CFG:(\{[\s\S]*\})/)
  if (!m) return null
  try { return JSON.parse(m[1]) } catch { return null }
}

/**
 * 本线是否该接管这一轮：
 *  ① 自己的协议串（LEAD_CFG:）→ 一定接管（卡片提交不能被 AI 自由发挥吃掉）；
 *  ② 自己的入口词 → 接管（= 重来）；
 *  ③ 本线草稿还在 → 接管（否则草稿会永远卡住）。
 * ⚠️ 「命中别条标准模式命令」由 route.ts 的 stdCmdOwned(['lead']) 统一挡，不在这里重复判。
 */
export async function shouldTakeOverLeadLine(db: any, uid: number | string, msg: string): Promise<boolean> {
  const m = String(msg || '').trim()
  if (/^LEAD_CFG\s*[:{]/.test(m)) return true
  if (matchesLeadLine(m)) return true
  return await hasLeadDraft(db, uid)
}

function summaryLine(d: LeadDraft): string {
  const sp = d.speed
  const un = (v: number) => (v === 0 ? '不限' : String(v))
  return `平台 ${d.platforms.length} 个 / 话术 ${d.scripts.length} 条 / 关键词 ${d.keywords.length} 个 / 速度「${speedName(sp.tier)}」评论 ≤${un(sp.commentPerDay)}·私信 ≤${un(sp.dmPerDay)}·间隔 ${sp.gapMin}~${sp.gapMax} 秒`
}

export interface LeadCtx {
  uid: number
  userMessage: string
  auth?: any
  /** 数据库连接（由 route.ts 注入 —— 是“连接”，不是共用业务逻辑） */
  prisma: any
  log: (uid: number | string, msg: string) => void
}

/**
 * 「智能获客」主流程（本文件内部**绝不 throw**：异常转人话返回 + 写日志）。
 * 分支：入口词 → 新面板；LEAD_CFG → 保存 / 预演；其余 → 引导。
 */
export async function handleLeadLine(ctx: LeadCtx): Promise<string> {
  const { uid, userMessage } = ctx
  try {
    const m = String(userMessage || '').trim()
    let d = await loadLeadDraft(ctx.prisma, uid)

    // 退出口（防止草稿“终身吞掉”后续消息 —— 与 AI 制片线同款）
    if (d && /^(重新开始|取消|退出|重来|不做了|算了|清空|重置|退出获客)$/.test(m)) {
      await clearLeadDraft(ctx.prisma, uid)
      try { ctx.log(uid, '[LEAD] 用户取消 → 本线草稿已清（不影响成片线）') } catch { /* ignore */ }
      return '已退出「智能获客」（本线草稿已清）。想重来就说「智能获客」。'
    }

    // ① 入口词 = 再开一条（作废旧草稿，发新面板）—— 老板「点哪个进哪个，进去看到第一条就是重来」
    if (matchesLeadLine(m)) {
      await clearLeadDraft(ctx.prisma, uid)
      d = newLeadDraft()
      await saveLeadDraft(ctx.prisma, uid, d)
      try { ctx.log(uid, '[LEAD] 起稿（智能获客设置面板）') } catch { /* ignore */ }
      return 'VF_JSON:' + JSON.stringify(buildLeadSetupCard(d))
    }

    // ② 面板提交（LEAD_CFG:{action,...}）
    const cfg = parseLeadCfg(m)
    if (cfg) {
      if (!d) d = newLeadDraft()
      d = applyLeadPatch(d, cfg)
      const action = String(cfg.action || 'save')

      if (action === 'preview') {
        d.step = 'lead_preview'
        await saveLeadDraft(ctx.prisma, uid, d)
        const pv = buildLeadPreview(d)
        try { ctx.log(uid, `[LEAD] 预演：${pv.actions.length} 条动作清单（不执行）`) } catch { /* ignore */ }
        return 'VF_JSON:' + JSON.stringify({
          step: 'lead_preview', leadLine: true,
          actions: pv.actions, cadence: pv.cadence, perDay: pv.perDay,
          riskNote: pv.riskNote, scopeNote: pv.scopeNote,
          // 预演卡上给「返回面板」用：把当前配置回传，避免用户再填一遍
          checked: d.platforms, scripts: d.scripts, keywords: d.keywords,
          speed: d.speed, checkedSources: d.sources,
        })
      }

      // 预演卡「↩ 返回面板」：把预演卡带回来的配置原样回填成设置面板（不用用户再填一遍）
      if (action === 'edit') {
        d.step = 'lead_setup'
        await saveLeadDraft(ctx.prisma, uid, d)
        return 'VF_JSON:' + JSON.stringify(buildLeadSetupCard(d))
      }

      d.step = 'lead_setup'
      await saveLeadDraft(ctx.prisma, uid, d)
      try { ctx.log(uid, `[LEAD] 保存配置：${summaryLine(d)}`) } catch { /* ignore */ }
      return `✅ 已保存「智能获客」配置（存到服务端草稿，刷新/重启不丢）：${summaryLine(d)}。\n本轮不会自动执行 —— 想看将要执行的动作清单与频控节奏，回「预演」；想改就回「智能获客」重开面板。`
    }

    // ③ 有草稿但说了别的 → 引导（不留白）
    if (d) return '「智能获客」面板：请在上面填好，点「💾 保存配置」或「👀 预演（只预览，不发送）」。'
    return '「智能获客」：请先说「智能获客」打开设置面板。'
  } catch (e: any) {
    const msg = String(e?.message || e).slice(0, 200)
    try { ctx.log(uid, '[LEAD] ❌ 异常: ' + msg) } catch { /* ignore */ }
    return `「智能获客」环节出错：${msg}\n（把这句发我即可定位；这次没有静默失败。）`
  }
}

/* ==================== ⑨ 下一版：执行器（本轮不做） ==================== */
// TODO(★VF_LEAD_V1·下一版)：执行器读上面草稿根级字段，按 speed 档位排队执行
//   · 复用既有能力：评论 = douyin-comment 模板批量化；私信 = real-device.ts 的 sendPrivateMessage（现在是 mock，必须先接真）
//   · 风控：失败即降速、异常即停并告警、多账号错峰（见 docs/获客系统方案-20260929.md 第五节 5.1）
//   · 计费：按线索条数 or 扣点（老板待定，方案第四节第 3/10 条）
//   · 合规：联系方式加密存储 + 权限隔离 + 保留期（方案第四节第 6 条）
// 本轮**明确不做**（老板原话「暂时不做自动获客」）—— 所以这里只有注释，没有可执行代码。
