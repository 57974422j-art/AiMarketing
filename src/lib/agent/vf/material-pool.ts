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
}

export interface SelectPoolResult<T extends PoolItem> {
  /** 本轮真正可用的素材（放开排除时 = 全部） */
  kept: T[]
  /** 被排除的"出片产物"（放开时为空） */
  excluded: T[]
  /** 命中几条出片记录（不论最终排没排） */
  candidates: number
  /** 是否因为池子过少而放开了排除 */
  released: boolean
  /** 日志（调用方原样写进 vfLog / ctx.log，保证"可解释、可回退"） */
  notes: string[]
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

  const names = opts.outcomeNames == null ? null : new Set<string>([...(opts.outcomeNames as any)].map((x) => String(x)))
  if (!names || names.size === 0) {
    notes.push('[素材池] 没有可用的"出片记录"元数据 → 本轮不排除任何素材（宁可不排，别错排）')
    return { kept: list, excluded: [], candidates: 0, released: false, notes }
  }

  const excluded: T[] = []
  const kept: T[] = []
  for (const it of list) {
    const n = String((it as any)?.name || '')
    if (names.has(n) && isOutcomeName(n)) excluded.push(it)
    else kept.push(it)
  }

  if (!excluded.length) {
    notes.push(`[素材池] 未发现"本系统出片产物"（已核对 ${names.size} 条出片记录）`)
    return { kept, excluded: [], candidates: 0, released: false, notes }
  }

  const head = `[素材池] 排除 ${excluded.length} 条"本系统出片产物"（它们是用户自己的成片，不是原始素材）`
  if (kept.length >= minKeep) {
    const sample = excluded.slice(0, 8).map((x) => String((x as any)?.name || '')).join('、')
    notes.push(head + `：${sample}${excluded.length > 8 ? '…' : ''}`)
    return { kept, excluded, candidates: excluded.length, released: false, notes }
  }

  // 安全阀：排完就快空了 → 整体放开（宁可多一条出片，也不能让用户"没素材可用"）
  notes.push(head)
  notes.push(
    `[素材池] 排除后仅剩 ${kept.length} 条（< ${minKeep}）→ 已放开排除，` +
    `本轮改用全部 ${list.length} 条素材（避免素材池被排空）`,
  )
  return { kept: list, excluded: [], candidates: excluded.length, released: true, notes }
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
