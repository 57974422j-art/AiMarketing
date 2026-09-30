/**
 * ★VF_POOL_V1（2026-09-30）——「成片素材池治理」纯函数层（零依赖、可单测、不联网、不烧钱）
 *
 * 用户原话（本文件的设计依据）：
 *   「重复选图这个你可以看如何改。」
 *   「它选的都是视频 所以你看不出，都是前面做的视频……本身那些视频就是素材库中的图片做的所以看着都一样。」
 *     → 用户的【出片产物】被当成素材再喂回去，形成"自我循环"（旧片→新片→又当素材）。
 *   「第四条 3张动图我还是没懂……这个你需要自己确认一下」→ 花钱必须看得出效果，避免无效花钱。
 *
 * 本文件只做**纯逻辑**（判定 / 去重 / 降权 / 缓存键），IO（读任务文件、读写缓存、调 AI）
 * 一律留在 video-material.ts / vf-video.ts —— 这样脚本可以脱网单测，见 scripts/vf-pool-selftest.ts。
 *
 * 与 anti-ai.ts / banner.ts / i2v-plan.ts 同类：**纯函数、零依赖**，
 * 所以 vf-video.ts 静态 import 不违反它「零 import 连累别的线」的设计约束。
 */

/* ══════════════════ ① 成片判定（治"拿自己旧片当素材"）══════════════════ */

/** 一个素材条目的最小形状（不依赖 video-material.ts 的 RepoMaterial，避免循环依赖） */
export interface PoolItem {
  name: string
  key?: string
  size?: number
  kind?: string
  updatedAt?: number
}

/**
 * 本系统出片产物 / 统一入库命名：`YYYYMMDD_NNN.ext`（见 lib/personal-storage.ts 的 saveToPersonalRepo）。
 * ★注意：这只是【弱信号】——用户从电脑导入的视频也会被改名成这个格式，
 *   所以**光靠文件名不足以判定**（宁可不排、别错排）；真正的强判据是"出片记录"（任务文件的 repoName）。
 */
export const VF_OUTCOME_NAME_RE = /^\d{8}_\d{3}\.(mp4|mov|webm|mkv|avi)$/i

/** 文件名像不像"本系统出片/统一入库命名"（弱信号，单独不足以排除） */
export function isOutcomeName(name: string): boolean {
  return VF_OUTCOME_NAME_RE.test(String(name || ''))
}

/** 排除后素材池低于这个数就整体放开（避免把素材池排空 → 用户直接没图可用） */
export const VF_POOL_MIN_KEEP = 3

export interface SelectPoolOptions {
  /** 强判据：仓库里"确实是本系统出片产物"的文件名集合（来自 video-factory 任务文件的 repoName） */
  outcomeNames?: Iterable<string> | null
  /** 排除后少于这个数就整体放开（默认 VF_POOL_MIN_KEEP = 3） */
  minKeep?: number
  /** ★VF_MEMORY_V1（2026-09-30 用户定案「个人仓库怎么分配 AI 仓库」）：用户显式【提拔】的素材名
   *  —— 一律保留（即使它是"本系统出片产物"）。卡片上的「✅ 当素材用」写这条名单。 */
  allow?: Iterable<string> | null
  /** ★VF_MEMORY_V1：用户显式【禁用】的素材名 —— 一律排除（优先级最高，连"安全阀"也不放开）。 */
  deny?: Iterable<string> | null
}

export interface SelectPoolResult<T extends PoolItem> {
  /** 本轮真正可用的素材（放开排除时 = 全部 - 被禁用的） */
  kept: T[]
  /** 被排除的素材（deny 名单 + 出片产物；安全阀放开时只剩 deny 名单） */
  excluded: T[]
  /** 命中几条出片记录（不论最终排没排） */
  candidates: number
  /** 是否因为池子过少而放开了"出片产物"排除 */
  released: boolean
  /** ★VF_MEMORY_V1：被「别用」名单硬排除的条数（安全阀也不会放开这些） */
  denied: number
  /** 日志（调用方原样写进 vfLog / ctx.log，保证"可解释、可回退"） */
  notes: string[]
}

/** 把任意字符串集合规整成 `Set<string>`（null/空 → 空集合，绝不抛） */
function toNameSet(v?: Iterable<string> | null): Set<string> {
  const s = new Set<string>()
  if (v == null) return s
  try { for (const x of v as any) if (x != null && String(x)) s.add(String(x)) } catch { /* ignore */ }
  return s
}

/** 前 8 个名字 + "…"（日志用） */
function nameSample<T extends PoolItem>(arr: T[]): string {
  const s = arr.slice(0, 8).map((x) => String((x as any)?.name || '')).join('、')
  return s + (arr.length > 8 ? '…' : '')
}

/**
 * 从素材列表里剔除【本系统出片产物】。
 *
 * 判据（两条一起用，且**只做加法不做减法**）：
 *   ① 强判据 `outcomeNames`：仓库里已有的"出片记录"元数据里出现过这个名字（video-factory 任务文件的 repoName）；
 *   ② 弱信号 `isOutcomeName`：文件名是统一入库命名 `YYYYMMDD_NNN.mp4`。
 *   只有【两条同时成立】才排除 —— 这样误判概率极低（用户自己导入的原片一般不在出片记录里）。
 *
 * 安全阀：排除后剩余 < minKeep → **整体放开**（改回全部素材），并把原因写进 notes。
 * 若根本没有出片记录元数据（强判据缺失）→ 一条都不排（宁可不排，别错排）。
 */
export function selectMaterialPool<T extends PoolItem>(
  items: T[],
  opts: SelectPoolOptions = {},
): SelectPoolResult<T> {
  const list = Array.isArray(items) ? items : []
  const minKeep = Math.max(1, Math.floor(Number(opts.minKeep ?? VF_POOL_MIN_KEEP)) || VF_POOL_MIN_KEEP)
  const notes: string[] = []
  const names = toNameSet(opts.outcomeNames)
  // ★VF_MEMORY_V1：用户的显式名单（卡片上的「✅ 当素材用 / 🚫 别用」写这两份）
  const allow = toNameSet(opts.allow)
  const deny = toNameSet(opts.deny)

  const hardExcluded: T[] = []   // deny 名单：一律排除（安全阀也不放开）
  const softExcluded: T[] = []   // "本系统出片产物"：池子太小时可放开
  const kept: T[] = []
  for (const it of list) {
    const n = String((it as any)?.name || '')
    if (deny.has(n)) { hardExcluded.push(it); continue }
    if (allow.has(n)) { kept.push(it); continue }              // ★提拔：即使它是出片产物也保留
    if (names.size && names.has(n) && isOutcomeName(n)) { softExcluded.push(it); continue }
    kept.push(it)
  }
  if (hardExcluded.length) {
    notes.push(`[素材池] 按你的「别用」名单排除 ${hardExcluded.length} 条：${nameSample(hardExcluded)}`)
  }

  if (!softExcluded.length) {
    notes.push(names.size
      ? `[素材池] 未发现"本系统出片产物"（已核对 ${names.size} 条出片记录）`
      : '[素材池] 没有可用的"出片记录"元数据 → 本轮不排除任何素材（宁可不排，别错排）')
    return { kept, excluded: hardExcluded, candidates: 0, released: false, denied: hardExcluded.length, notes }
  }

  const head = `[素材池] 排除 ${softExcluded.length} 条"本系统出片产物"（它们是用户自己的成片，不是原始素材）`
  if (kept.length >= minKeep) {
    notes.push(head + `：${nameSample(softExcluded)}`)
    return {
      kept, excluded: [...hardExcluded, ...softExcluded],
      candidates: softExcluded.length, released: false, denied: hardExcluded.length, notes,
    }
  }

  // 安全阀：排完就快空了 → 放开"出片产物"排除（**不动 deny 名单** —— 那是用户显式说的"别用"）
  // ★VF_MEMORY_V1 修（2026-09-30，team-lead 复跑发现回归）：**必须保留"已放开排除"这句原话**
  //   （★VF_POOL_V1 的日志契约：池子 < minKeep 自动放开的动作要在日志里看得到；
  //     `scripts/vf-pool-selftest.ts` 断言的就是 `notes.some(n => n.includes('放开排除'))`）。
  //   所以这里把新信息（含出片产物 / 不动 deny 名单）挂在这句话之后，而不是改写它。
  notes.push(head)
  notes.push(
    `[素材池] 排除后仅剩 ${kept.length} 条（< ${minKeep}）→ 已放开排除（含"出片产物"：可用素材只剩 ${kept.length} 条），` +
    `本轮加入这 ${softExcluded.length} 条（避免素材池被排空；你的「别用」名单不受影响，deny 仍一律排除）`,
  )
  return {
    kept: [...kept, ...softExcluded], excluded: hardExcluded,
    candidates: softExcluded.length, released: true, denied: hardExcluded.length, notes,
  }
}

/* ══════════════════ ② 同一次分镜内不重复用同一素材 ══════════════════ */

export interface DedupeResult {
  /** 修正后的素材序号（与入参等长；-1 = 该镜不用素材） */
  ids: number[]
  /** 换成了"还没用过的"素材的镜数 */
  reassigned: number
  /** 素材不够、只能重复时，被调整到"隔得较远"的镜数 */
  gapFixed: number
  /** 实在没有可换的素材 → 保留原样的镜数 */
  unreplaceable: number
  notes: string[]
}

/**
 * 同一份分镜里同一素材不重复。
 *
 * 逐位处理：
 *   ① 首次出现的素材保留；重复出现的 → 换成【还没用过的】素材（reassigned++）；
 *   ② 若素材总数 < 用到素材的镜头数（都占满了）→ 允许重复，但要求同一素材两次出现
 *      之间**至少隔 minGap 镜**：优先换成"上次出现最早"的那个素材（gapFixed++）；
 *      连这个都做不到 → 保留原样（unreplaceable++），绝不静默丢弃镜头。
 *
 * @param ids   每个镜的素材序号（-1 / null / 越界 = 该镜不用素材）
 * @param total 可用素材总数
 * @param minGap 同一素材两次出现之间至少隔几镜（默认 2）
 */
export function dedupeMaterialUse(
  ids: Array<number | null | undefined>,
  total: number,
  minGap = 2,
): DedupeResult {
  const n = Array.isArray(ids) ? ids.length : 0
  const totalN = Math.max(0, Math.floor(Number(total) || 0))
  const gap = Math.max(1, Math.floor(Number(minGap) || 2))
  const out: number[] = new Array(n).fill(-1)
  for (let i = 0; i < n; i++) {
    const v = ids[i]
    out[i] = typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < totalN ? Math.floor(v) : -1
  }
  const notes: string[] = []
  if (totalN <= 0 || n === 0) return { ids: out, reassigned: 0, gapFixed: 0, unreplaceable: 0, notes }

  const used = new Set<number>()
  const lastPos = new Map<number, number>()
  let reassigned = 0, gapFixed = 0, unreplaceable = 0

  // ① 首次保留；重复的换成"还没用过的"
  for (let i = 0; i < n; i++) {
    const id = out[i]
    if (id < 0) continue
    if (!used.has(id)) { used.add(id); lastPos.set(id, i); continue }
    let free = -1
    for (let c = 0; c < totalN; c++) { if (!used.has(c)) { free = c; break } }
    if (free >= 0) { out[i] = free; used.add(free); lastPos.set(free, i); reassigned++ }
  }

  // ② 素材不够（都占满了）→ 允许重复，但保证同一素材间隔 ≥ gap
  for (let i = 0; i < n; i++) {
    const id = out[i]
    if (id < 0) continue
    const prev = lastPos.get(id)
    // prev === i = 本次是该素材【第一次出现】（pass① 记下的就是它自己）→ 天然不违反间隔
    if (prev === undefined || prev === i || i - prev >= gap) { lastPos.set(id, i); continue }
    // 找一个"上次出现最早、且满足间隔"的素材来换
    let best = -1, bestPrev = Infinity
    for (let c = 0; c < totalN; c++) {
      const p = lastPos.get(c)
      if (p === undefined) continue
      if (i - p >= gap && p < bestPrev) { best = c; bestPrev = p }
    }
    if (best >= 0) { out[i] = best; lastPos.set(best, i); gapFixed++ }
    else { lastPos.set(id, i); unreplaceable++ }
  }

  if (reassigned) notes.push(`[素材去重] ${reassigned} 镜换成还没用过的素材（同一素材在一条分镜里只用一次）`)
  if (gapFixed) notes.push(`[素材去重] 素材总数不足 → ${gapFixed} 镜改用"隔得较远"的素材，保证同一素材间隔 ≥ ${gap} 镜`)
  if (unreplaceable) notes.push(`[素材去重] ${unreplaceable} 镜实在没有可换的素材 → 保留原样（素材数 < 镜头数）`)
  return { ids: out, reassigned, gapFixed, unreplaceable, notes }
}

/* ══════════════════ ③ "最近用过"降权（治每次都是同几张）══════════════════ */

/**
 * 确定性打乱（不依赖 Math.random，便于单测）—— 每次起草用不同 seed 打乱素材顺序，
 * 让"每次都从最前面几张选"变成"顺序每轮都变"，配合下面的"最近用过降权"一起治"每次都是同几张"。
 */
export function shuffleDeterministic<T>(arr: T[], seed: number): T[] {
  const a = Array.isArray(arr) ? arr.slice() : []
  let s = (Math.floor(Number(seed) || 0) >>> 0) || 0x9e3779b9
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    const t = a[i]; a[i] = a[j]; a[j] = t
  }
  return a
}

/**
 * 把"最近 1~2 次用过的素材"排到列表**后面**（**不是排除** —— 素材不够时仍会用到）。
 * 稳定分区：未用过的保持原有顺序在前，最近用过的附在后面。
 */
export function demoteRecent<T extends PoolItem>(
  items: T[],
  recentNames: Iterable<string> | null | undefined,
): { items: T[]; demoted: number } {
  const list = Array.isArray(items) ? items : []
  const set = recentNames == null ? new Set<string>() : new Set<string>([...(recentNames as any)].map((x) => String(x)))
  if (!set.size) return { items: list.slice(), demoted: 0 }
  const front: T[] = [], back: T[] = []
  for (const it of list) {
    if (set.has(String((it as any)?.name || ''))) back.push(it)
    else front.push(it)
  }
  return { items: [...front, ...back], demoted: back.length }
}

/** 从"最近使用"记录里摊平出所有素材名（供降权用） */
export function recentNamesOf(runs: Array<Array<string>> | null | undefined): Set<string> {
  const out = new Set<string>()
  if (!Array.isArray(runs)) return out
  for (const r of runs) {
    if (!Array.isArray(r)) continue
    for (const n of r) if (n) out.add(String(n))
  }
  return out
}

/**
 * 合并"最近使用"记录：新的放最前，最多保留 keepRuns 轮（默认 2 = "最近 1~2 次"）。
 * 返回**新数组**（不改原数组）。
 */
export function mergeRecentRuns(
  prev: Array<Array<string>> | null | undefined,
  current: string[],
  keepRuns = 2,
): Array<Array<string>> {
  const keep = Math.max(1, Math.floor(Number(keepRuns) || 2))
  const cur = [...new Set((Array.isArray(current) ? current : []).map((x) => String(x)).filter(Boolean))]
  const out: Array<Array<string>> = []
  if (cur.length) out.push(cur)
  if (Array.isArray(prev)) {
    for (const r of prev) {
      if (out.length >= keep) break
      if (!Array.isArray(r) || !r.length) continue
      out.push([...new Set(r.map((x) => String(x)).filter(Boolean))])
    }
  }
  return out.slice(0, keep)
}

/* ══════════════════ ④ 素材识别指纹缓存（治"看 2 次浪费钱"）══════════════════ */

/** 缓存键分隔符 */
export const VF_VL_CACHE_SEP = '@'

/**
 * 视觉摘要缓存键 = `<仓库 key 或文件名>@<字节大小>`。
 *   · 名字 + 大小一起进键 → **文件被替换/大小变了就自动失效**（重算摘要）；
 *   · 改名会换 key → 命中失败 → 重算（**只会多花钱，绝不会串味**，符合"容忍改名"的要求）；
 *   · 键里带 size 也顺带挡住"同名不同内容"的最常见情形。
 */
export function vlCacheKey(key: string, size: number): string {
  return `${String(key || '')}${VF_VL_CACHE_SEP}${Math.floor(Number(size) || 0)}`
}

/**
 * ★VF_POOL_V1 扩展（2026-09-30，team-lead + memory-frames 复核）：**视频多帧理解**的缓存键。
 *
 * 为什么要和图片分开一个函数：`describeOneClip` 是"看懂**整条**视频"（按片长抽 2~5 帧），
 *   所以它天然带 `起始秒 = 0`（不是按 vstart 切片；vstart 是排分镜阶段 AI 才决定的，
 *   同一份"整条理解"对任意 vstart 都成立）。但为了满足"**绝不能串味**"，
 *   键里把 `时长` 也带上 —— 片长决定抽哪几帧，片长变了（文件被换 / 重新导出）就必须重算。
 *   ⇒ `键 = 仓库key@字节大小@起始秒@时长`（起始秒恒为 0；将来若改成"按 vstart 抽帧"再传真实起始秒）。
 */
export function vlClipCacheKey(key: string, size: number, startSec: number, durSec: number): string {
  const r1 = (v: any) => Math.round((Number(v) || 0) * 10) / 10
  return `${String(key || '')}${VF_VL_CACHE_SEP}${Math.floor(Number(size) || 0)}${VF_VL_CACHE_SEP}${r1(startSec)}${VF_VL_CACHE_SEP}${r1(durSec)}`
}

/** 用**完整键**取摘要（图片/视频两种键都能走这里）；命中返回文本，未命中/空返回 null */
export function cacheGetRaw(cache: Record<string, string> | null | undefined, fullKey: string): string | null {
  if (!cache) return null
  const v = cache[fullKey]
  return typeof v === 'string' && v.trim() ? v : null
}

/** 用**完整键**写摘要（返回 true = 真的写进去了，调用方据此决定要不要落盘） */
export function cacheSetRaw(
  cache: Record<string, string>,
  fullKey: string,
  val: string | null | undefined,
): boolean {
  if (!cache) return false
  const v = typeof val === 'string' ? val.trim() : ''
  if (!v) return false   // 识别失败（null/空）不写缓存 → 下次重试，避免把"没识别出来"永久缓存
  cache[fullKey] = v
  return true
}

/** 从缓存对象里取摘要（命中返回文本，未命中/空返回 null） */
export function cacheGet(cache: Record<string, string> | null | undefined, key: string, size: number): string | null {
  return cacheGetRaw(cache, vlCacheKey(key, size))
}

/** 写入缓存对象（返回 true = 真的写进去了，调用方据此决定要不要落盘） */
export function cacheSet(
  cache: Record<string, string>,
  key: string,
  size: number,
  val: string | null | undefined,
): boolean {
  return cacheSetRaw(cache, vlCacheKey(key, size), val)
}

/* ════════════════════════════════════════════════════════════════════════════════════════
 * ★VF_MEMORY_V1（2026-09-30）——「已知用户」注入段 + 素材「提拔 / 禁用」名单（纯函数）
 *
 * 用户原话（本节的由来）：
 *   「我们 AGENT 上下文记忆如何处理的，后期经常用了，是否很多不用去看了，从记忆中就已经明确
 *     用户是做什么的了。仓库有什么也都知道。除非新的上传可以需要看下。」
 *   「仓库我截图了一个 codex 的仓库图……我们个人仓库怎么分配 AI 仓库主要看哪里的。这个比较关键」
 *
 * 本节的函数全部**纯函数、零依赖**（不读库、不读盘、不联网）—— 库/OSS 的 IO 留给 chat/route.ts，
 * 这样自测脚本（scripts/vf-memory-shotfix-selftest.ts）可以脱网直接跑。
 * ════════════════════════════════════════════════════════════════════════════════════════ */

/** 素材许可/禁用名单的 tag（存进 agentMemory，**不新建表**） */
export const VF_MAT_POLICY_TAG = 'vf_material_allow'
/** 名单正文前缀（与项目其它 agentMemory 记录同风格，解析时只取 `{` 起） */
const MAT_POLICY_PREFIX = '素材名单:'

export interface MatPolicy {
  allow: string[]
  deny: string[]
  /**
   * ★VF_MATUI_V1（2026-09-30 用户定案）：「🎞 打勾才动」的名单 —— 被勾上的素材名**才**生成 AI 动图。
   *   · 与 allow/deny 同一份 content（`素材名单:{"allow":[],"deny":[],"i2v":[]}`）；
   *   · ⚠️ **向后兼容**：旧 content 没有 `i2v` 字段 → 解析结果 = 空数组（= 一张都不勾）。
   */
  i2v?: string[]
}

/** 名单类动作（★VF_MATUI_V1 追加 pick/unpick = 🎞 勾选/取消） */
export type MatSetAction = 'allow' | 'deny' | 'auto' | 'pick' | 'unpick'

/** 名单里的名字规整（去空、去重、封顶 200 条） */
function uniqNames(v: any): string[] {
  const arr = Array.isArray(v) ? v : []
  return [...new Set(arr.map((x: any) => String(x || '').trim()).filter(Boolean))].slice(0, 200)
}

/** 解析 agentMemory 里的名单正文（坏数据/空 → 空名单，绝不抛） */
export function parseMatPolicy(raw: string | null | undefined): MatPolicy {
  try {
    const t = String(raw || '').trim()
    if (!t) return { allow: [], deny: [], i2v: [] }
    const i = t.indexOf('{')
    const j: any = JSON.parse(i >= 0 ? t.slice(i) : t)
    return { allow: uniqNames(j?.allow), deny: uniqNames(j?.deny), i2v: uniqNames(j?.i2v) }
  } catch { return { allow: [], deny: [], i2v: [] } }
}

/** 序列化成 agentMemory 的正文（★VF_MATUI_V1：多带一份 i2v 勾选名单） */
export function serializeMatPolicy(p: MatPolicy | null | undefined): string {
  return MAT_POLICY_PREFIX + JSON.stringify({
    allow: uniqNames(p?.allow), deny: uniqNames(p?.deny), i2v: uniqNames(p?.i2v),
  })
}

/**
 * 把一次「✅/🚫/🎞」动作落到名单上。
 *   · allow / deny 互斥（互相把对方那份里的同名项删掉）；
 *   · action='auto' = 从 allow/deny 两边都移除 → 回默认规则（⚠️ **不动 🎞 勾选**：
 *     前端的「取消当素材用/取消别用」不该顺手把"这一镜要动"也取消掉）；
 *   · action='pick' / 'unpick'（★VF_MATUI_V1）= 只增删 i2v 勾选，**不动** allow/deny。
 */
export function applyMatSet(p: MatPolicy | null | undefined, name: string, action: MatSetAction): MatPolicy {
  const n = String(name || '').trim()
  let allow = uniqNames(p?.allow)
  let deny = uniqNames(p?.deny)
  let i2v = uniqNames(p?.i2v)
  if (!n) return { allow, deny, i2v }
  if (action === 'allow') {
    deny = deny.filter((x) => x !== n)                 // allow 与 deny 互斥
    if (!allow.includes(n)) allow.push(n)
  } else if (action === 'deny') {
    allow = allow.filter((x) => x !== n)
    if (!deny.includes(n)) deny.push(n)
  } else if (action === 'pick') {
    if (!i2v.includes(n)) i2v.push(n)                  // ★只碰 🎞，绝不动 allow/deny
  } else if (action === 'unpick') {
    i2v = i2v.filter((x) => x !== n)
  } else {
    // action === 'auto' → 从 allow/deny 两边移除（回默认规则）；⚠️ **不动 🎞**
    allow = allow.filter((x) => x !== n)
    deny = deny.filter((x) => x !== n)
  }
  return { allow: uniqNames(allow), deny: uniqNames(deny), i2v: uniqNames(i2v) }
}

/**
 * ★VF_MATUI_V1（2026-09-30 用户定案）：「🔄 换一张」把一张素材换成另一张时，名单怎么变 ——
 *   · 被换掉的（out）→ **deny**（用户已经用这个按钮表达了"这张不要"）；
 *   · 换上的（in）  → **allow**（明确要用它）；
 *   · 🎞 勾选状态**随替换转移**（out 勾着 → in 接过来）：用户要的是"这一镜动起来"，
 *     不是"必须这一张动"，所以换个图不该把动效一起弄丢。
 * 入参非法（空名 / 同一张）→ 原样返回（不抛）。
 */
export function applyMatSwap(p: MatPolicy | null | undefined, outName: string, inName: string): MatPolicy {
  const out = String(outName || '').trim()
  const inn = String(inName || '').trim()
  let cur: MatPolicy = { allow: uniqNames(p?.allow), deny: uniqNames(p?.deny), i2v: uniqNames(p?.i2v) }
  if (!out || !inn || out === inn) return cur
  const hadPick = uniqNames(cur.i2v).includes(out)
  cur = applyMatSet(cur, out, 'deny')
  cur = applyMatSet(cur, inn, 'allow')
  if (hadPick) {
    cur = applyMatSet(cur, out, 'unpick')
    cur = applyMatSet(cur, inn, 'pick')
  }
  return cur
}

/** 卡片按钮发的协议串：`VF_MAT_SET:{"name":"xxx.jpg","action":"allow"|"deny"|"auto"|"pick"|"unpick"}` */
export const STD_MAT_SET_RE = /^VF_MAT_SET\s*[:{]/

/**
 * ★VF_MATUI_V1（2026-09-30 用户定案）：「🔄 换一张」的协议串 —— `VF_MAT_SWAP:{"out":"<被换掉的文件名>"}`。
 *
 * 为什么**另开一条**串（而不是复用 VF_MAT_SET 两连发）：
 *   · 换一张要「一读一写」两件事（把 out 记 deny + 把 in 记 allow），客户端并不知道"下一张同类型
 *     素材是谁"（那是仓库当前状态 + 上限 40 条裁剪后的结果，只有服务端算得准）；
 *   · 客户端只需要回传 **out 是谁**，服务端用 pickSwapTarget() 算出 in（同类型下一张）→ 名单变更
 *     完全在服务端一处完成，避免"客户端选的 in 与 AI 实际用的池子不一致"。
 *   · 两连发 VF_MAT_SET 会有中间态（只发了 deny 就断线 → 那张图被永久禁用、还没换上新的）。
 */
export const STD_MAT_SWAP_RE = /^VF_MAT_SWAP\s*[:{]/

/** 解析「🔄 换一张」协议串；不是这条串 / out 缺失 → null */
export function parseMatSwapMessage(msg: string): { out: string } | null {
  const m = String(msg || '').trim()
  if (!STD_MAT_SWAP_RE.test(m)) return null
  try {
    const i = m.indexOf('{')
    const j: any = JSON.parse(i >= 0 ? m.slice(i) : m)
    const out = String(j?.out || '').trim()
    return out ? { out } : null
  } catch { return null }
}

/** 解析协议串；不是这条串 / 名字缺失 → null（调用方据此判断"这句话是不是素材名单动作"） */
export function parseMatSetMessage(msg: string): { name: string; action: MatSetAction } | null {
  const m = String(msg || '').trim()
  if (!STD_MAT_SET_RE.test(m)) return null
  try {
    const i = m.indexOf('{')
    const j: any = JSON.parse(i >= 0 ? m.slice(i) : m)
    const name = String(j?.name || '').trim()
    if (!name) return null
    const a = String(j?.action || '').toLowerCase()
    const action: MatSetAction = (a === 'allow' || a === 'deny' || a === 'pick' || a === 'unpick') ? a as MatSetAction : 'auto'
    return { name, action }
  } catch { return null }
}

/**
 * 一条素材在界面上的状态（卡片按钮显示用）：
 *   'deny'    = 在「别用」名单里；
 *   'allow'   = 在「当素材用」名单里（即使它是出片产物也会被用）；
 *   'outcome' = 本系统出片产物（默认不进池，需点「✅ 当素材用」才用）；
 *   'all'     = 走默认规则。
 */
export function materialStateOf(
  name: string,
  o: { allow?: Iterable<string> | null; deny?: Iterable<string> | null; outcomeNames?: Iterable<string> | null },
): 'allow' | 'deny' | 'outcome' | 'all' {
  const n = String(name || '')
  if (!n) return 'all'
  const allow = toNameSet(o?.allow), deny = toNameSet(o?.deny), out = toNameSet(o?.outcomeNames)
  if (deny.has(n)) return 'deny'
  if (allow.has(n)) return 'allow'
  if (out.size && out.has(n) && isOutcomeName(n)) return 'outcome'
  return 'all'
}

/* ════════════════════════════════════════════════════════════════════════════════════════
 * ★VF_MATUI_V1（2026-09-30）—— 素材清单「可读版」：排序 / 缩略图条目 / 上限 40 / 点选替换
 *
 * 用户原话（本节的由来，实测截图）：
 *   「这个什么意思没明白。**这不是使用的素材 也不是 AI 看的素材，有什么用？是不是搞错了**。」
 *   → 上一版清单**取全仓库**、把「出片产物（默认被排除）」排在最前、只显示 12 条 →
 *     用户仓库里出片产物多 → 前 12 条全是「仅出片产物」，真正能用的图片一张都没出现。
 *
 * 三处改法（都在这两个纯函数里，IO/签名留在 chat/route.ts）：
 *   ① **可用素材在前**、「已排除」折叠在后（折叠是前端的事，这里保证顺序 + 分组正确）；
 *   ② 条目带 kind（image/video，前端据此给缩略图或 🎬 占位图标）与 i2v（🎞 勾选状态）；
 *   ③ 上限提到 40，且**可用素材优先占额度**（余额才轮到已排除）。
 * ════════════════════════════════════════════════════════════════════════════════════════ */

/** 清单总上限（★VF_MATUI_V1：12 → 40，治"真正能用的图根本没出现"） */
export const VF_MAT_UI_LIMIT = 40

export interface MatUIItem {
  name: string
  kind: 'image' | 'video'
  /** allow/deny/outcome/all —— 与 materialStateOf 同口径 */
  state: 'allow' | 'deny' | 'outcome' | 'all'
  /** ★VF_MATUI_V1：🎞 打勾（这一镜生成 AI 动图） */
  i2v: boolean
}

export interface MatUIBuild {
  /** 已按"可用在前、已排除在后"排好、并裁到上限的清单（前端按 state 分组即可） */
  items: MatUIItem[]
  /** 可用素材（"会被 AI 选中"的那批）——已裁到上限 */
  usable: MatUIItem[]
  /** 已排除（出片产物 / 你标了别用）——已裁到上限 */
  excluded: MatUIItem[]
  /** **总数**（未裁剪）：可用 N 条 */
  usableN: number
  /** **总数**（未裁剪）：已排除 M 条 */
  excludedN: number
}

/** 这条状态算不算"会被 AI 选中"的可用素材（allow = 用户点名要用；all = 走默认规则） */
export function isUsableState(st: string): boolean {
  return st === 'all' || st === 'allow'
}

/** 图片/视频判定（优先用调用方给的 kind，缺失时按扩展名） */
function kindOfName(name: string, kind?: string): 'image' | 'video' {
  if (String(kind || '') === 'video') return 'video'
  return /\.(mp4|mov|webm|mkv|avi)$/i.test(String(name || '')) ? 'video' : 'image'
}

/**
 * 建「素材清单」：分组 + 排序 + 上限。
 *   · **可用素材（all / allow）在前**，「已排除（outcome / deny）」在后 —— 与旧版正好相反
 *     （旧版 rankOf 把 outcome/deny 排到最前，正是用户看到的"前 12 条全是出片产物"）；
 *   · 各自**保持传入顺序**（仓库顺序 / 服务端给的顺序），不做二次排序（稳定、可解释）；
 *   · 上限 limit（默认 40）：可用先占满，余额才给已排除；
 *   · 重名去重（同名文件只出现一次）。
 */
export function buildMatUIList(
  items: Array<{ name: string; kind?: string }> | null | undefined,
  o: {
    allow?: Iterable<string> | null
    deny?: Iterable<string> | null
    outcomeNames?: Iterable<string> | null
    i2v?: Iterable<string> | null
    limit?: number
  } = {},
): MatUIBuild {
  const limit = Math.max(1, Math.floor(Number(o.limit ?? VF_MAT_UI_LIMIT)) || VF_MAT_UI_LIMIT)
  const i2vSet = toNameSet(o.i2v)
  const seen = new Set<string>()
  const usable: MatUIItem[] = []
  const excluded: MatUIItem[] = []
  for (const it of Array.isArray(items) ? items : []) {
    const name = String((it as any)?.name || '')
    if (!name || seen.has(name)) continue
    seen.add(name)
    const state = materialStateOf(name, { allow: o.allow, deny: o.deny, outcomeNames: o.outcomeNames })
    const item: MatUIItem = { name, kind: kindOfName(name, (it as any)?.kind), state, i2v: i2vSet.has(name) }
    if (isUsableState(state)) usable.push(item)
    else excluded.push(item)
  }
  const head = usable.slice(0, limit)
  const rooms = Math.max(0, limit - head.length)
  return {
    items: [...head, ...excluded.slice(0, rooms)],
    usable: head, excluded: excluded.slice(0, rooms),
    usableN: usable.length, excludedN: excluded.length,
  }
}

/**
 * ★VF_MATUI_V1：「🔄 换一张」要换成哪一张 —— 在**可用素材**里，找**同一类型的下一张**
 * （从当前这张往后循环扫一圈，跳过被 deny 的与调用方点名要跳过的）。
 * 找不到（同类只剩它一张）→ null（调用方如实回一句"仓库里没有别的同类型素材可换"）。
 */
export function pickSwapTarget<T extends { name: string; kind?: string }>(
  items: T[] | null | undefined,
  outName: string,
  o: { kind?: string; deny?: Iterable<string> | null; skip?: Iterable<string> | null } = {},
): T | null {
  const list = (Array.isArray(items) ? items : []).filter((x) => x && String((x as any).name || ''))
  if (!list.length) return null
  const out = String(outName || '')
  const idx = list.findIndex((x) => String((x as any).name || '') === out)
  if (idx < 0) return null
  const deny = toNameSet(o.deny)
  const skip = toNameSet(o.skip)
  const want = kindOfName(out, o.kind || String((list[idx] as any)?.kind || ''))
  for (let i = 1; i <= list.length; i++) {
    const c: any = list[(idx + i) % list.length]
    const cn = String(c?.name || '')
    if (!cn || cn === out) continue
    if (kindOfName(cn, String(c?.kind || '')) !== want) continue
    if (deny.has(cn) || skip.has(cn)) continue
    return c as T
  }
  return null
}

/** 「已知用户」注入段的输入（全部来自 route.ts 的 IO 层） */
export interface KnownUserInput {
  /** 画像类记忆原文（已按 updatedAt 从新到旧排序；如 "行业/业务：餐饮"、"名字：小美"…） */
  profileLines?: string[]
  imgN?: number
  vidN?: number
  recentNames?: string[]
}

/** 段尾那句固定指令（用户原话：「是否很多不用去看了……除非新的上传可以需要看下」） */
export const KNOWN_USER_TAIL = '（以上信息已确认过，除非用户新上传/明确要求，不要重复询问或重复识别。）'

/**
 * 拼「已知用户」注入段（≤300 字，短、可失效）。
 * 无画像且仓库为空 → 返回 null（调用方据此"不注入"，绝不影响对话）。
 * 返回 profileChars / repoChars 供日志打 `[记忆] 已注入已知用户（画像 X 字 / 仓库摘要 Y 字）`。
 */
export function buildKnownUserBlock(inp: KnownUserInput | null | undefined): { text: string; profileChars: number; repoChars: number } | null {
  const lines = (inp?.profileLines || []).map((s) => String(s || '').trim()).filter(Boolean)
  const imgN = Math.max(0, Math.floor(Number(inp?.imgN) || 0))
  const vidN = Math.max(0, Math.floor(Number(inp?.vidN) || 0))
  const recent = (inp?.recentNames || []).map((s) => String(s || '').trim()).filter(Boolean).slice(0, 3)
  const hasRepo = !!(imgN || vidN)
  if (!lines.length && !hasRepo) return null

  // 画像段封顶 160 字（避免提示词膨胀；超出只截断画像，不动仓库段）
  let profile = lines.join('；')
  if (profile.length > 160) profile = profile.slice(0, 160) + '…'
  const parts: string[] = []
  if (profile) parts.push(`用户画像：${profile}`)
  const repoLine = hasRepo
    ? `仓库：图片 ${imgN} 张、视频 ${vidN} 条${recent.length ? `，最近上传 ${recent.join('、')}` : ''}`
    : ''
  if (repoLine) parts.push(repoLine)
  if (!parts.length) return null

  return {
    text: `【已知用户（长期记忆）】${parts.join('；')}。\n${KNOWN_USER_TAIL}`,
    profileChars: profile.length,
    repoChars: repoLine.length,
  }
}

/* ════════════════════════════════════════════════════════════════════════════════════════
 * ★VF_SHOTFIX_V1（2026-09-30）—— 分镜质量兜底（纯函数）
 *
 * 用户原话（本节的由来）：
 *   「最后一个画面表现有点不对」—— 抽帧确认：**第 9 镜是 list 卡（4 条）但只排了 2 秒**，
 *   只显示出前 2 条就切走了；而且**第 8、9 镜是同一个 list（items 完全相同）连着出现**。
 *
 * 两条兜底：① list 卡时长下限 = 条数 × 0.5 + 1 秒（不够自动加时，并尽量从"最长的镜"扣回）；
 *          ② 相邻两镜"同卡型 + 同内容" → 合并成一镜（时长相加、字幕接续）。
 * ⚠️ 只做"**只增不减**"的修正：不裁内容、不删镜（合并 = 两镜内容合二为一）。
 * ════════════════════════════════════════════════════════════════════════════════════════ */

/** 每条 item 至少要几秒才来得及出现（用户口径：条数 × 0.5 + 1） */
export const LIST_SEC_PER_ITEM = 0.5
/** 给别的镜"扣时间"时不低于这个秒数（分镜的 dur 下限本来就是 2s） */
export const SHOT_DUR_FLOOR = 2

const round1 = (v: any): number => Math.round((Number(v) || 0) * 10) / 10

/** list 卡时长下限（4 条 → 3.0s；0 条 → 1.0s） */
export function listMinDuration(itemCount: number): number {
  const n = Math.max(0, Math.floor(Number(itemCount) || 0))
  return round1(n * LIST_SEC_PER_ITEM + 1)
}

/**
 * ① list 卡时长下限：不够 → 自动加时到下限，并按"从同片里最长的镜扣回"尽量保持总时长不变。
 *   - 只从**非 list 镜**里扣（别再动别的 list 的下限）；每镜扣到 SHOT_DUR_FLOOR(2s) 为止；
 *   - 扣不满就**只加时**（总时长略增），绝不裁内容、绝不删镜。
 * 返回新数组（不改入参）+ 日志（调用方原样写进 vfLog，例如：
 *   `[分镜] 第 9 镜 list 4 条 → 时长 2s 提到 3s（否则末条来不及出现）`）。
 */
export function ensureListDuration(shots: any[]): { shots: any[]; notes: string[] } {
  const src = (Array.isArray(shots) ? shots : []).map((s) => ({ ...(s || {}) }))
  const notes: string[] = []
  let extra = 0
  for (let i = 0; i < src.length; i++) {
    const s: any = src[i]
    if (String(s?.type) !== 'list') continue
    const n = Array.isArray(s?.items) ? s.items.length : 0
    if (n <= 0) continue
    const min = listMinDuration(n)
    const dur = Number(s.dur) || 0
    if (dur + 1e-6 < min) {
      extra += (min - dur)
      notes.push(`[分镜] 第 ${i + 1} 镜 list ${n} 条 → 时长 ${round1(dur)}s 提到 ${round1(min)}s（否则末条来不及出现）`)
      s.dur = min
    }
  }
  if (extra <= 1e-6) return { shots: src, notes }

  let need = extra
  const donors = src
    .map((s: any, i: number) => ({ i, dur: Number(s?.dur) || 0 }))
    .filter((x) => String(src[x.i]?.type) !== 'list')
    .sort((a, b) => b.dur - a.dur)
  for (const d of donors) {
    if (need <= 1e-6) break
    const can = d.dur - SHOT_DUR_FLOOR
    if (can <= 1e-6) continue
    const cut = Math.min(can, need)
    src[d.i].dur = round1(d.dur - cut)
    need -= cut
  }
  if (need > 1e-6) {
    notes.push(`[分镜] list 加时 ${round1(extra)}s，其中 ${round1(need)}s 扣不回（其余镜已到 ${SHOT_DUR_FLOOR}s 下限）→ 总时长略增，内容不动`)
  } else {
    notes.push(`[分镜] list 加时 ${round1(extra)}s 已从同片较长的镜扣回 → 总时长基本不变`)
  }
  return { shots: src, notes }
}

/** 相邻两镜"同内容"的判据（返回 '' = 不参与合并） */
function shotContentKey(s: any): string {
  const t = String(s?.type || '')
  if (t === 'list') {
    const items = Array.isArray(s?.items) ? s.items.map((x: any) => (x && typeof x === 'object' ? JSON.stringify(x) : String(x))) : []
    return `list:${String(s?.title || '')}:${items.join('|')}`
  }
  // ⚠️ bgimage 除了"同 text"还要求**同 src** —— 否则两张不同的图会因大字相同被并成一镜（丢画面）
  if (t === 'bgimage') return `bgimage:${String(s?.text || '')}:${String(s?.src || '')}`
  if (t === 'title') return `title:${String(s?.text || '')}`
  return ''
}

/**
 * ② 相邻镜"同卡型 + 同内容" → 合并成一镜（时长相加、字幕按原顺序拼起来）。
 *   只处理 list（items 完全相同 + 同标题）/ bgimage（同 text 且同 src）/ title（同 text）。
 *   中间隔了一镜的（非相邻）**只打日志不合并**（保持画面节奏，不越权改动）。
 */
export function mergeAdjacentSameShots(shots: any[]): { shots: any[]; notes: string[] } {
  const src = Array.isArray(shots) ? shots : []
  const out: any[] = []
  const notes: string[] = []
  for (const s of src) {
    const prev: any = out[out.length - 1]
    const k1 = prev ? shotContentKey(prev) : ''
    const k2 = shotContentKey(s)
    if (prev && k1 && k1 === k2) {
      prev.dur = round1((Number(prev.dur) || 0) + (Number(s.dur) || 0))
      prev.subtitle = (String(prev.subtitle || '') + String(s.subtitle || '')).slice(0, 600)
      notes.push(`[分镜] 第 ${out.length} 与 ${out.length + 1} 镜同卡型同内容 → 已合并（时长相加、字幕接续）`)
      continue
    }
    out.push({ ...(s || {}) })
  }
  return { shots: out, notes }
}
