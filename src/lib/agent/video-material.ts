// ★VF_MATERIAL_V1（2026-09-19）：成片素材层
//   作用：把【个人仓库】（OSS `storage/{userId}/`）里的素材列出来 + 下载到服务器本地
//        + 用视觉模型看懂（qwen-vl-max，复用 ai-providers.describeImageWithVL）
//   为什么需要：render.py 的画面输入要的是【服务器本地文件路径】，而素材在 OSS 上。
//   ★注意：服务器只能读 OSS 个人仓库；客户端"本地仓库"在用户电脑上，服务器看不到。
//   复用：抽帧已有（extract_video_frames 在 chat route）——这里不重复造，先只理解【图片】。
import fs from 'fs'
import path from 'path'
import { spawnSync, execFile } from 'child_process'
import { listObjects, getObject, signedUrl } from '@/lib/oss'
import { describeImageWithVL, describeImagesWithVL } from '@/lib/ai-providers'
// ★VF_POOL_V1（2026-09-30）：成片素材池治理的**纯函数**（判定"本系统出片产物" / 视觉摘要缓存键）。
//   逻辑在 material-pool.ts（零依赖、可单测），本文件只负责 IO（读任务文件、读写缓存文件）。
import { selectMaterialPool, cacheGet, cacheSet, cacheGetRaw, cacheSetRaw, vlClipCacheKey } from './vf/material-pool'

/**
 * ★VF_VIDGUARD_V1（2026-09-24 用户实测：「素材库里有 3 分钟多的视频」）：
 *   保护线 —— 超过就不把这条视频当"画面片段"用，避免一个素材把服务器和请求拖死：
 *     · 单文件 > 400MB：服务器下载 + ffmpeg 逐帧解码都要很久，成片里也就用几秒，不划算
 *     · 单条 > 30 分钟：基本不是"短视频素材"，多半是整段录屏/直播回放
 *   被挡下的视频会在日志里如实写出来（不静默丢弃）。
 */
export const VF_VIDEO_MAX_MB = 400
export const VF_VIDEO_MAX_SEC = 1800
/** 一次成片最多考察多少个视频（每个要多帧识别，太多既慢又贵） */
export const VF_VIDEO_MAX_CLIPS = 6

/**
 * ★VF_VIDPROBE_V2（2026-09-24）：异步跑子进程（**不阻塞事件循环**）。
 *   为什么必须异步：原来用 spawnSync，而"多帧采样"要给每个视频跑 2~5 次 ffmpeg ——
 *   同步跑会把整个 Node 服务卡住十几秒（别的用户的请求全排队），
 *   所以探测/抽帧统一改成 execFile + Promise。
 */
function runCmd(cmd: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    try {
      execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, encoding: 'utf-8' },
        (err, stdout) => resolve(err ? '' : String(stdout || '')))
    } catch { resolve('') }
  })
}

/** 并发受控的 map（保持结果顺序）—— 多个视频并行识别，但别一次打满百炼的 QPS */
async function mapLimit<T, R>(arr: T[], limit: number, fn: (v: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(arr.length)
  let next = 0
  const n = Math.max(1, Math.min(limit, arr.length))
  await Promise.all(new Array(n).fill(0).map(async () => {
    for (;;) {
      const i = next++
      if (i >= arr.length) return
      try { out[i] = await fn(arr[i], i) } catch { out[i] = undefined as any }
    }
  }))
  return out
}

const IMG_RE = /\.(jpg|jpeg|png|webp|gif)$/i
const VID_RE = /\.(mp4|mov|avi|mkv|webm)$/i
const AUD_RE = /\.(mp3|m4a|wav|aac)$/i

export type MaterialKind = 'image' | 'video' | 'audio' | 'other'

export interface RepoMaterial {
  name: string
  key: string
  kind: MaterialKind
  size: number
  updatedAt: number
  localPath?: string
}

function kindOf(name: string): MaterialKind {
  if (VID_RE.test(name)) return 'video'
  if (IMG_RE.test(name)) return 'image'
  if (AUD_RE.test(name)) return 'audio'
  return 'other'
}

/**
 * ★VF_LOG_V1（2026-09-19）：成片调试日志（服务器侧）
 *   位置：`<storage>/<userId>/video-factory/vf_debug.log`
 *   用途：和客户端的 `bu_debug.log`（发布用）对应，但成片跑在【服务器】，所以日志在服务器侧。
 *   记：状态机每步（入口/素材来源/起草/入队）、素材下载、视觉理解结果、make.py 的 tail。
 */
export function vfLog(userId: string | number, msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}`
  try {
    const dir = path.join(process.env.LOCAL_STORAGE || path.join(process.cwd(), 'storage'), String(userId), 'video-factory')
    fs.mkdirSync(dir, { recursive: true })
    fs.appendFileSync(path.join(dir, 'vf_debug.log'), line + '\n')
  } catch { /* 日志失败不影响主流程 */ }
  console.log('[VF]', msg)
}

/**
 * ★VF_ROOT_V1（2026-09-19）：找项目根目录（成片脚本 / storage 都基于它）
 *   坑：pm2 跑的是 next standalone（`.next/standalone/server.js`）→ process.cwd() 指向
 *   `.next/standalone`，而不是项目根 → 写死 cwd 会导致「找不到 scripts/video-factory/make.py」。
 *   候选顺序：VF_ROOT 环境变量 → cwd → cwd 上两级 → /root/AiMarketing
 */
export function vfRootDir(): string {
  const cands = [
    process.env.VF_ROOT || '',
    process.cwd(),
    path.join(process.cwd(), '..', '..'),
    '/root/AiMarketing',
  ].filter(Boolean) as string[]
  for (const d of cands) {
    try { if (fs.existsSync(path.join(d, 'scripts', 'video-factory', 'make.py'))) return d } catch {}
  }
  return ''
}

/** 成片输出/任务文件的根目录（★必须全局统一——写任务和查进度要同一个地方） */
export function vfStorageRoot(): string {
  return process.env.LOCAL_STORAGE || path.join(vfRootDir() || process.cwd(), 'storage')
}

/**
 * ★VF_PROBE_V1（2026-09-19）：读图片宽高——纯 JS 解析文件头，零依赖、零子进程
 *   用途：判断画幅（素材多为横图 → 出横屏，不硬塞竖屏）
 */
export function probeImageSize(buf: Buffer): { w: number; h: number } | null {
  try {
    // PNG：\x89PNG\r\n\x1a\n + IHDR（宽高在 16/20 字节）
    if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
      return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
    }
    // JPEG：扫 SOF0/1/2 段取宽高
    if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
      let i = 2
      while (i < buf.length - 9) {
        if (buf[i] !== 0xff) { i++; continue }
        const m = buf[i + 1]
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
          return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) }
        }
        const len = buf.readUInt16BE(i + 2)
        if (len < 2) break
        i += 2 + len
      }
    }
    // GIF：前 10 字节（宽高小端）
    if (buf.length > 10 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
      return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) }
    }
  } catch {}
  return null
}

/** 统计素材横竖比例 + 尺寸（用于自动定画布 / 过滤低清图）
 *  ★VF_SIZEFIT_V1（2026-09-20，用户实测“图片都是糊的”）：
 *    ① 探测张数 20 → **30**（与“实际取图 30 张”对齐，避免“判定用一批、出图用另一批”）
 *    ② 额外返回每张尺寸 + 最大边（供“低清图不进画面”和“画布跟素材走”用）
 */
export async function probeMaterialSizes(
  userId: string | number,
  items: RepoMaterial[],
): Promise<{
  portrait: number; landscape: number; square: number; total: number
  maxSide: number; sizes: { key: string; w: number; h: number }[]
}> {
  const withLocal = await downloadMaterials(userId, items.filter((i) => i.kind === 'image').slice(0, 30))
  let portrait = 0, landscape = 0, square = 0, total = 0, maxSide = 0
  const sizes: { key: string; w: number; h: number }[] = []
  for (const m of withLocal) {
    if (!m.localPath) continue
    try {
      const sz = probeImageSize(fs.readFileSync(m.localPath))
      if (!sz?.w || !sz?.h) continue
      total++
      sizes.push({ key: m.key || m.name, w: sz.w, h: sz.h })
      if (sz.w > maxSide) maxSide = sz.w
      if (sz.h > maxSide) maxSide = sz.h
      const r = sz.w / sz.h
      if (r > 1.15) landscape++
      else if (r < 0.87) portrait++
      else square++
    } catch {}
  }
  return { portrait, landscape, square, total, maxSide, sizes }
}

/** 素材本地工作目录（与 make.py 的 --workdir 同区域，随用户隔离） */
export function materialDir(userId: string | number): string {
  return path.join(vfStorageRoot(), String(userId), 'video-factory', 'material')
}

/* ══════════════════ ★VF_POOL_V1（2026-09-30）：成片素材池治理 ══════════════════ */

/**
 * 读"本系统出片记录"——从**仓库里已有的元数据**里拿，不新建任何爬取/表。
 *
 * 依据（用户原话「它选的都是视频……都是前面做的视频」= 用户把自己出的片又当素材喂回去，自我循环）：
 *   video-factory 每次出片都写了任务文件 `<storage>/<uid>/video-factory/vf<ts>.json`，
 *   成片入库后里面有 `repoName`（= 个人仓库里的文件名 `YYYYMMDD_NNN.mp4`，见 chat/route.ts 的 repoExtra）。
 *   把这些 repoName 收集起来 → 强判据"这条素材是本系统出片产物"。
 *
 * 为什么只认任务文件（不查 GenerationRecord 表）：本函数在 listRepoMaterials 里调用，
 *   而那里没有 prisma；任务文件是"仓库里已有的元数据"，零依赖、零新爬取，且**不会误伤**
 *   用户自己导入的原片（导入的视频不在出片记录里）。
 */
export function readOutcomeNames(userId: string | number): Set<string> {
  const names = new Set<string>()
  try {
    const dir = path.join(vfStorageRoot(), String(userId), 'video-factory')
    if (!fs.existsSync(dir)) return names
    for (const f of fs.readdirSync(dir)) {
      if (!/^vf.*\.json$/i.test(f)) continue
      try {
        const j: any = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
        const n = String(j?.repoName || '').trim()
        if (n) names.add(n)
      } catch { /* 单个任务文件坏了不影响其余 */ }
    }
  } catch { /* 目录不可读 → 视为无记录（宁可不排，别错排） */ }
  return names
}

/** 视觉摘要缓存文件路径（落在该用户素材目录下，随用户隔离） */
function vlCachePath(userId: string | number): string {
  return path.join(materialDir(userId), '.vl_cache.json')
}

/** 读视觉摘要缓存（坏文件/不存在 → 空对象；绝不因为缓存问题影响识别） */
function loadVlCache(userId: string | number): Record<string, string> {
  try {
    const p = vlCachePath(userId)
    if (!fs.existsSync(p)) return {}
    const j: any = JSON.parse(fs.readFileSync(p, 'utf8'))
    return j && typeof j === 'object' && !Array.isArray(j) ? j as Record<string, string> : {}
  } catch { return {} }
}

/** 写视觉摘要缓存（最多留 800 条，防文件无限膨胀；写失败不影响本次识别）
 *  ★VF_POOL_V1：**先读盘再合并**—— 图片摘要（summarizeMaterials）与视频多帧理解（describeVideoClips）
 *  在 vf-video.ts 里是**并行**跑的，各自 load 一份缓存；若不合并，后写的会把先写的新条目冲掉
 *  （只影响"下次少省钱"，不影响正确性，但白丢缓存没意义）。 */
function saveVlCache(userId: string | number, cache: Record<string, string>): void {
  try {
    const merged: Record<string, string> = { ...loadVlCache(userId), ...cache }
    const keys = Object.keys(merged)
    if (keys.length > 800) {
      for (const k of keys.slice(0, keys.length - 800)) delete merged[k]
    }
    const p = vlCachePath(userId)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, JSON.stringify(merged))
  } catch { /* 缓存写失败忽略 */ }
}

/**
 * ★VF_POOL_V1 扩展（2026-09-30，memory-frames 指出「用户能看到的垃圾」）：
 *   清掉素材目录里历史遗留的 `*_vl.jpg`（= shrinkForVL 的缩图中间产物）。
 *   现版本已改成"用完即删"（见 vlDescribeMaterial），这里只做**老残留 / 进程中断**的兜底：
 *   超过 TTL（默认 6 小时）还没被删的，直接清掉。
 */
function cleanupVlThumbs(userId: string | number, ttlMs = 6 * 3600 * 1000): void {
  try {
    const dir = materialDir(userId)
    if (!fs.existsSync(dir)) return
    const now = Date.now()
    for (const f of fs.readdirSync(dir)) {
      if (!/_vl\.jpg$/i.test(f)) continue
      try {
        const p = path.join(dir, f)
        if (now - fs.statSync(p).mtimeMs > ttlMs) fs.unlinkSync(p)
      } catch { /* 单个删除失败忽略 */ }
    }
  } catch { /* 目录不可读忽略 */ }
}

/**
 * 列个人仓库素材（新的在前）
 * @param limit 最多返回多少条（默认 40；视觉理解另按 maxImages 控制）
 */
/** ★VF_MATSPREAD_V1（2026-09-20，用户实测"画面单调"的根因）：
 *   个人仓库的常见形态是"一批封面图 + 一批同一视频切帧（高度相似）"，
 *   而原来这里是 `按 updatedAt 倒序 + 取前 N` → **取到的全是同一批最新相似帧**。
 *   改成：① 封面图（cover_*）优先 ② 按"文件名批次前缀"分组、**组间轮转交织**取
 *        → 来源尽量分散，不再被某一批淹没。
 */
function spreadMaterials(imgItems: RepoMaterial[], limit: number): RepoMaterial[] {
  if (limit <= 0) return []
  const keyOf = (n: string): string => {
    const b = n.replace(/\.[a-z0-9]+$/i, '')
    if (/^cover[_-]/i.test(b)) return 'cover'          // 以前做的封面图 → 单独一组且优先
    const m = b.match(/^([a-zA-Z]*\d{4,8})/)           // 20260920_001 → '20260920'（同批次）
    return m ? m[1] : (b.split(/[_-]/)[0] || b).slice(0, 8)
  }
  const groups = new Map<string, RepoMaterial[]>()
  for (const it of imgItems) {
    const k = keyOf(it.name)
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(it)
  }
  const keys = [...groups.keys()].sort((a, b) => (a === 'cover' ? -1 : b === 'cover' ? 1 : a.localeCompare(b)))
  const lists = keys.map((k) => (groups.get(k) || []).slice().sort((a, b) => b.updatedAt - a.updatedAt))
  const out: RepoMaterial[] = []
  let round = 0
  // 轮转：每轮从每组各取 1 张（组内按均匀步长前进）→ 天然交织、不偏向某一批
  while (out.length < limit && round < 300) {
    let added = false
    for (const lst of lists) {
      if (out.length >= limit) break
      if (!lst.length) continue
      const span = Math.max(1, Math.ceil(limit / Math.max(1, lists.length)))
      const pos = Math.min(lst.length - 1, Math.floor(round * lst.length / span))
      const it = lst[pos]
      if (it && !out.includes(it)) { out.push(it); added = true }
    }
    if (!added) break
    round++
  }
  for (const lst of lists) for (const it of lst) { if (out.length >= limit) break; if (!out.includes(it)) out.push(it) }
  return out.slice(0, limit)
}

export async function listRepoMaterials(userId: string | number, limit = 40, mode: 'spread' | 'recent' = 'spread'): Promise<RepoMaterial[]> {
  const uid = String(userId)
  try {
    const objs = await listObjects(`storage/${uid}/`, 1000)
    const all = objs
      .filter((o) => !o.name.includes('/.thumbs/') && !o.name.endsWith('/'))
      .map((o) => {
        const name = o.name.split('/').pop() || o.name
        return {
          name,
          key: o.name,
          kind: kindOf(name),
          size: o.size,
          updatedAt: o.lastModified ? new Date(o.lastModified).getTime() : 0,
        } as RepoMaterial
      })
    // ★VF_UPLOAD_V1（2026-09-20）：mode='recent' —— **只用最近上传的**
    //   供表单「📤 我上传素材」：用户刚传的那批就是最新的，直接按时间倒序取。
    if (mode === 'recent') {
      return all.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit)
    }
    // ★VF_POOL_V1（2026-09-30）：默认排除【本系统出片产物】—— 治"拿自己旧片当素材"的自我循环
    //   （用户原话：「它选的都是视频……都是前面做的视频，本身那些视频就是素材库中的图片做的」）。
    //   · 判据 = 出片记录（任务文件 repoName，强）+ 统一入库命名（弱）**两条同时成立** → 才排除；
    //   · 没有出片记录 / 排除后素材太少 → 自动不排 / 放开（可解释、可回退，绝不把素材池排空）；
    //   · 每次判定与原因都写进 vfLog（可核对到底排了谁、为什么排）。
    //   ⚠️ mode='recent'（用户本次刚上传的）不排除 —— 那是用户明确要用的，不能替他决定。
    const _pool = selectMaterialPool(all, { outcomeNames: readOutcomeNames(uid) })
    for (const _n of _pool.notes) vfLog(uid, _n)
    const base = _pool.kept
    // ★VF_MATSPREAD_V1：图片走"分批均匀抽样"，视频另留少量（画面以图为主）
    const imgs = base.filter((o) => o.kind === 'image')
    const vids = base.filter((o) => o.kind === 'video')
    const vidKeep = Math.min(vids.length, 6)
    const picked = spreadMaterials(imgs, Math.max(1, limit - vidKeep))
    return [...picked, ...vids.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, vidKeep)].slice(0, limit)
  } catch (e: any) {
    console.error('[成片素材] 列仓库失败:', e?.message || e)
    return []
  }
}

/** 下载指定素材到服务器本地（单个失败跳过，不阻断） */
export async function downloadMaterials(userId: string | number, items: RepoMaterial[]): Promise<RepoMaterial[]> {
  const dir = materialDir(userId)
  try { fs.mkdirSync(dir, { recursive: true }) } catch {}
  const out: RepoMaterial[] = []
  for (const it of items) {
    try {
      const lp = path.join(dir, it.name)
      if (fs.existsSync(lp) && fs.statSync(lp).size === it.size) { out.push({ ...it, localPath: lp }); continue }
      const buf = await getObject(it.key)
      fs.writeFileSync(lp, buf)
      out.push({ ...it, localPath: lp })
    } catch (e: any) {
      console.error(`[成片素材] 下载失败 ${it.name}:`, e?.message || e)
    }
  }
  return out
}

/**
 * 用视觉模型看懂素材（只处理图片，最多 maxImages 张；默认 10，可调 20）
 * 返回一段中文摘要，供"写文案"用——比如：
 *   「最近素材：①拿铁特写(暖光木桌) ②店内全景(午后) ③开业海报(红金配色)…」
 * 说明：单图一张一次调用（复用 describeImageWithVL），每张约 0.2 点
 */
/** 抽一帧（长边 ≤1200）交给视觉模型 —— **只用于"看懂视频在演什么"**，成片里放的仍是完整片段。
 *  ★VF_MULTIFRAME_V1：改成异步（不卡住 Node）+ 输出到指定文件 —— 因为源可以是
 *  【OSS 签名直链】，这样 3 分钟以上的长视频也能抽帧，不必先整段下载。 */
async function grabVideoFrame(src: string, at: number, outPath: string): Promise<string> {
  try {
    try { fs.mkdirSync(path.dirname(outPath), { recursive: true }) } catch {}
    await runCmd('ffmpeg', ['-v', 'error', '-y', '-ss', String(Math.max(0, at)), '-i', src,
      '-frames:v', '1', '-vf',
      "scale='if(gt(iw,ih),min(1200,iw),-2)':'if(gt(iw,ih),-2,min(1200,ih))'", outPath], 45000)
    if (fs.existsSync(outPath) && fs.statSync(outPath).size > 1024) return outPath
  } catch (e) { /* 单帧失败不影响整条线 */ }
  return ''
}

/** ═══ ★VF_VIDEOLINE_V1（2026-09-24 用户定案「视频混剪」独立线）═══
 *  探测视频素材的元信息：**时长 / 宽高 / 有没有音轨 / 文件大小** —— 排分镜要靠真实时长决定
 *  "这一镜多长"以及"这个片段能不能放下"。只给视频混剪线用；素材合成线仍走"仅列名"。
 *
 *  ★VF_VIDPROBE_V2（2026-09-24 用户实测：「素材库里可能有 3 分钟多的视频」）：
 *    V1 是"先把视频全下载到服务器再探测"—— 8 条长视频就是几百 MB 堵在聊天请求里（还可能超时）。
 *    V2 改成三步，长视频不再拖垮起草：
 *      ① 本地已有缓存（上次下载过、大小对得上）→ 直接探，零网络；
 *      ② 否则把 **OSS 签名直链**交给 ffprobe —— 它只读文件头/索引，**不下载整段**；
 *      ③ 真正被排进分镜的视频，等分镜排完再【按需下载】（见 vf-video.ts 的 VF_VIDONDEMAND_V1）。
 *    返回值额外带：key/size/sizeMB（供按需下载与保护线判断）、path（仅缓存命中时非空）、over（超保护线）。
 */
export async function probeVideos(userId: string | number, items: RepoMaterial[]): Promise<any[]> {
  const vids = (items || []).filter((i) => i.kind === 'video').slice(0, 8)
  if (!vids.length) return []
  const dir = materialDir(userId)
  try { fs.mkdirSync(dir, { recursive: true }) } catch {}
  const probeOne = async (src: string): Promise<{ dur: number; w: number; h: number; hasAudio: boolean }> => {
    const js = await runCmd('ffprobe', ['-v', 'error', '-show_entries',
      'format=duration:stream=codec_type,width,height', '-of', 'json', src], 30000)
    try {
      const j: any = JSON.parse(js || '{}')
      const streams: any[] = j?.streams || []
      const v0 = streams.find((s: any) => s.codec_type === 'video')
      return {
        dur: Number(j?.format?.duration || 0),
        w: Number(v0?.width || 0), h: Number(v0?.height || 0),
        hasAudio: streams.some((s: any) => s.codec_type === 'audio'),
      }
    } catch { return { dur: 0, w: 0, h: 0, hasAudio: false } }
  }
  const out: any[] = []
  for (const v of vids) {
    // ① 缓存命中 → 用本地文件（最快，也不用签名）
    let lp = path.join(dir, v.name)
    let cached = false
    let url = ''
    try { cached = fs.existsSync(lp) && (!v.size || Math.abs(fs.statSync(lp).size - v.size) < 1024) } catch { cached = false }
    let meta = { dur: 0, w: 0, h: 0, hasAudio: false }
    if (cached) meta = await probeOne(lp)
    // ② 没缓存 → OSS 签名直链。实测（2026-09-24，本机）：23MB 的 https 直链 ffprobe 只花 0.61 秒
    //    就读出时长 —— 因为 ffmpeg 只发 Range 请求读文件头/索引，**不会下整段**。
    if (!(meta.dur > 0.5)) {
      try { url = await signedUrl(v.key, 3600) } catch { url = '' }
      if (url) {
        const m2 = await probeOne(url)
        if (m2.dur > 0.5) { meta = m2; cached = false }
      }
    }
    // ③ 直链也探不出来（签名/编码/网络古怪）→ 退回【老行为】：下载这一条再探。
    //    宁可慢一点，也绝不让用户的视频"用不了"（V1 本来就会下载，退路必须保住）。
    if (!(meta.dur > 0.5)) {
      const one = await downloadMaterials(userId, [v])
      const lp2 = one?.[0]?.localPath
      if (lp2) {
        const m3 = await probeOne(lp2)
        if (m3.dur > 0.5) { meta = m3; cached = true; lp = lp2 }
      }
    }
    if (!(meta.dur > 0.5)) {
      // 探不到时长 = 无法安全切片（不知道 vstart 会不会越界、也不知道能放几秒）→ 本次不用，并如实记一笔
      console.error(`[成片素材] 视频探测失败（本次不用）：${v.name}`)
      continue
    }
    const sizeMB = Math.round((Number(v.size || 0) / 1048576) * 10) / 10
    const over = (Number(v.size) > VF_VIDEO_MAX_MB * 1048576) || (meta.dur > VF_VIDEO_MAX_SEC)
    out.push({
      name: v.name, key: v.key, size: Number(v.size || 0), sizeMB,
      url: cached ? '' : url, path: cached ? lp : '',
      dur: Math.round(meta.dur * 10) / 10, w: meta.w, h: meta.h, hasAudio: meta.hasAudio, over,
    })
  }
  return out
}

/** 每条视频按片长决定抽几帧 —— 片子越长，需要看的"时间点"越多（这就是"时间轴"的采样密度） */
function frameRatios(dur: number): number[] {
  if (dur <= 20) return [0.25, 0.65]                       // 短片：2 帧够（开头/结尾多是包装，避开）
  if (dur <= 60) return [0.12, 0.42, 0.72]
  if (dur <= 150) return [0.10, 0.32, 0.55, 0.78]
  return [0.06, 0.25, 0.45, 0.65, 0.85]                    // 3 分钟以上：5 帧
}

/** 看懂【一条】视频：抽 N 帧 → 一次多图识别 → 逐帧说明 + 推荐片段 */
async function describeOneClip(c: any, i: number, framesDir: string): Promise<string> {
  const dur = Number(c?.dur || 0)
  const head = `视频${i + 1}（${c?.name}）：总长 ${dur} 秒` +
    `${c?.w && c?.h ? ` ${c.w}x${c.h}` : ''}${c?.hasAudio ? '，带原声' : '，无音轨'}` +
    `${c?.sizeMB ? `，${c.sizeMB}MB` : ''}`
  const src = String(c?.path || c?.url || '')
  if (!src || !(dur > 0.5)) return head + '；画面内容：（探不到，本次不用）'
  const times = frameRatios(dur).map((r) => Math.round(dur * r * 10) / 10)
  const base = path.parse(String(c?.name || 'v')).name.replace(/[^\w.-]/g, '_')
  const pairs = (await Promise.all(times.map(async (t, k) => {
    const p = await grabVideoFrame(src, t, path.join(framesDir, `${base}_${k}_${Math.round(t)}.jpg`))
    return [t, p] as [number, string]
  }))).filter(([, p]) => p)
  if (!pairs.length) return head + '；画面内容：（抽帧失败，本次不用）'
  const ts = pairs.map(([t]) => t)
  const frames = pairs.map(([, p]) => p)
  const list = ts.map((t, k) => `第${k + 1}张 = 第 ${Math.round(t)} 秒`).join('、')
  const prompt =
    `这是【同一条用户素材视频】在 ${frames.length} 个时间点抽出的帧，已按时间先后排列（${list}）。\n` +
    `请严格按下面的格式回答（中文，不要多余的话、不要 markdown）：\n` +
    ts.map((t, k) => `${k + 1}. <第 ${Math.round(t)} 秒这一帧在演什么，25 字内；` +
      `如果是纯文字页/黑场/转场/画面发糊，就直接写"文字页""黑场""转场""模糊">`).join('\n') + '\n' +
    `推荐：<用"第A~B秒"给出最适合当短视频素材的一段（要有主体动作或画面清楚、别是文字页/转场/黑场），` +
    `后面用 10 字以内说理由；若整条都不适合，就写"无">`
  let ans = ''
  try {
    ans = (await describeImagesWithVL(
      frames.map((f) => 'data:image/jpeg;base64,' + fs.readFileSync(f).toString('base64')), prompt, 700)) || ''
  } catch { ans = '' }
  const per: string[] = []
  let rec = ''
  for (const raw of String(ans).replace(/\r/g, '').split('\n')) {
    // ★实测（2026-09-24）：模型偶尔会写成 "- **1)** 文字页：满屏花字""推荐片段：第20~34秒"
    //   → 先清掉 markdown 装饰，否则整行都匹配不上（原来会丢掉一半描述）
    const t = raw.trim().replace(/^[-*#>\s]+/, '').replace(/\*\*/g, '').replace(/^[`\s]+|[`\s]+$/g, '').trim()
    if (!t) continue
    const m = t.match(/^(\d+)\s*[.、)）]\s*(.+)$/)
    if (m) {
      const k = parseInt(m[1]) - 1
      if (k >= 0 && k < frames.length) per[k] = m[2].trim()
      continue
    }
    // "推荐：…" / "★推荐片段：…" / "推荐区间：…" 都认
    const r = t.match(/^[★]?\s*推荐[^\s:：]{0,4}\s*[:：]\s*(.+)$/)
    if (r) rec = r[1].trim()
  }
  if (!per.some(Boolean) && !rec) {
    // 整层没识别出来 → 如实说，并给出"谨慎使用"的指引（别让 AI 凭运气从 0 秒切，那多半是片头花字）
    return head + '；画面内容：（没识别出来，不确定哪段好看 → 谨慎使用：若要用，从片子中间取，别从开头/结尾）'
  }
  const body = ts.map((t, k) => `  · 第 ${Math.round(t)} 秒：${per[k] || '（未描述）'}`).join('\n')
  return head + '\n' + body + (rec ? `\n  ★推荐片段：${rec}` : '')
}

/** 让 AI"看懂"每个视频 —— ★VF_MULTIFRAME_V1（2026-09-24 用户定案：「素材库里有 3 分钟多的视频」）
 *  老做法只抽 1 帧（片长 45% 处）→ 对 3 分钟的视频等于"让 AI 瞎猜该从第几秒切"，
 *  很容易切到过渡段/黑场/无用镜头。
 *  现在按片长抽 2~5 帧，**一次多图调用**问出"每个时间点在演什么 + 哪一段最适合当素材"，
 *  这段文字直接进"排分镜"的提示词 → AI 定的 vstart 才会落在有内容的画面上。
 *  成本：每条约 0.6~1.2 点（用户已定：「成本先不管，主要看成片效果」）。 */
export async function describeVideoClips(clips: any[], userId?: string | number): Promise<string> {
  if (!clips?.length) return ''
  // 每次起草用【独立】的临时目录：同一用户连点两次时两轮抽帧互不打扰（否则会互相删帧）
  const base = userId != null ? materialDir(userId) : vfStorageRoot()
  const framesDir = path.join(base, 'vf_frames_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6))
  try { fs.mkdirSync(framesDir, { recursive: true }) } catch {}
  // ★VF_POOL_V1 扩展（2026-09-30 team-lead 要求）：视频多帧理解并入**同一个缓存通道**（.vl_cache.json）——
  //   用户抱怨的"看 2 次浪费钱"的另一半：同一条素材视频反复起草会重复抽 2~5 帧 + 1 次多图调用。
  //   缓存的是 **describeOneClip 的文本结果**（不是帧文件 —— 帧继续"看完就删"，源视频大、留着没意义）。
  //   键 = `仓库key@字节大小@起始秒@时长`（见 vlClipCacheKey）：整条理解恒定 起始秒=0、时长=片长
  //   → 同一条视频被不同分镜取不同 vstart 时命中同一份（这份理解对任意 vstart 都成立，不会串味）；
  //   而文件被替换/重新导出（size 或时长变）→ 键变 → 自动重算。
  const cache = userId != null ? loadVlCache(userId) : {}
  let hits = 0
  let dirty = false
  let parts: string[] = []
  try {
    // 3 个并发：既压住总耗时，也别把百炼 QPS 一次打满（结果顺序仍与 clips 一致）
    parts = await mapLimit(clips, 3, async (c: any, i: number) => {
      const ck = vlClipCacheKey(String(c?.key || c?.name || ''), Number(c?.size || 0), 0, Number(c?.dur || 0))
      const hit = cacheGetRaw(cache, ck)
      if (hit) {
        hits++
        // 缓存的文本里带着"视频N（name）"的序号 → 按当前位置改写编号（名与内容都不变），避免编号错位
        return hit.replace(/^视频\d+/, '视频' + (i + 1))
      }
      const text = await describeOneClip(c, i, framesDir)
      // 识别失败（抽帧失败 / 探不到 / 没识别出来）**不写缓存** → 下次仍会重试
      if (text && !/（抽帧失败|（探不到|（没识别出来/.test(text)) {
        if (cacheSetRaw(cache, ck, text)) dirty = true
      }
      return text
    })
  } finally {
    // 抽帧只是中间产物（成片里播的是完整片段）→ 识别完整体删掉，不在服务器上堆垃圾
    try { fs.rmSync(framesDir, { recursive: true, force: true }) } catch { /* 清理失败不影响结果 */ }
  }
  if (dirty && userId != null) saveVlCache(userId, cache)
  if (hits && userId != null) vfLog(userId, `[素材池] 视频多帧理解命中缓存 ${hits} 条（省下 ${hits} 次多图调用）`)
  return parts.filter(Boolean).join('\n')
}

/** ★VF_VLM_PROMPT_V1（2026-09-24 用户实测 + 本地 A/B 验证后改写）：**行业无关**的"通用四问"。
 *  老问法的三个坑（用户实测踩到）：
 *    ① 只问"画面**主体**" → 用户的素材多是【工具界面截图，右半边预览框里嵌着一张海报】，
 *       模型抓走最抢眼的那张海报 → 把整图说成"智能手表海报"
 *       （实测 20260906_002.jpg / 20260922_015.jpg 两张都错，它们其实是 AI 营销工具界面）；
 *    ② 用途例子只给"产品图/门店/海报" → 没有"软件界面/工具截图"这一档，模型不会往界面上靠；
 *    ③ 限 40 字一句话 → 装不下"这是界面 + 界面里嵌了什么"这层信息。
 *  ★危害不止标签难看：这段摘要是【直接喂给写文案/排分镜】的（见本文件 summarizeMaterials 注释）
 *    → 摘要说"素材是智能手表海报"，文案就围着"智能手表新品首发"写，整片主题跑偏。
 *  本地验证（6 张：营销工具界面 / 餐饮点餐界面 / 美食实拍 / 风景×2 / 合成海报）分类与嵌图判断全对。
 */
const VL_PROMPT_GENERIC =
  '这是用户个人素材库里的一张图。请按顺序用中文回答：' +
  '①先判断它属于哪一类（软件界面或工具截图 / 成品海报或宣传图 / 实拍人物或场景 / 数据图表）；' +
  '②若画面里出现网页、软件窗口或手机界面，主体请描述【这个界面/系统本身是做什么的】，' +
  '界面里嵌着的海报或图片用括号补充（如"界面右侧预览框里嵌着一张手表海报"）；' +
  '③列出最关键的可读文字（标题/按钮/栏目，4~8 个）；' +
  '④最后一句说它适合配哪类文案。只描述实际可见内容，不要猜测，不超过 100 字。'

/** ★VF_VLM_2STAGE_V1（2026-09-24 用户定案的 P1）：两段式识别 —— 先分类，再按类别问对应的问题。
 *  一段式的问题是"所有图都用同一个问法"：界面截图需要它读界面文字，海报需要它读卖点，实拍需要它描述氛围。
 *  按类别分派后，各自问到点子上；分类失败则回退到通用四问（绝不因为分类失败而认不出图）。 */
const VL_PROMPT_BY_CLASS: { kw: string; prompt: string }[] = [
  {
    kw: '软件界面',
    prompt: '这是软件界面/工具截图。请用中文说明：①这个界面/系统是做什么的（产品定位）；' +
      '②主要区域与栏目；③界面上最关键的可读文字（标题/按钮/栏目，6~10 个）；' +
      '④界面里嵌着的海报或图片用括号补充（如"右侧预览框里嵌着一张手表海报"）。只描述可见内容，不超过 120 字。',
  },
  {
    kw: '海报',
    prompt: '这是宣传海报/成品图。请用中文说明：①主体物与核心卖点；②图上的标题/副标题文字；' +
      '③色调与风格；④适合配哪类文案。只描述可见内容，不超过 80 字。',
  },
  {
    kw: '实拍',
    prompt: '这是实拍照片。请用中文说明：①画面主体与场景；②氛围/光线/色调；③图上若出现文字就读出来；' +
      '④适合配哪类文案。只描述可见内容，不超过 80 字。',
  },
  {
    kw: '图表',
    prompt: '这是数据图表/表格。请用中文说明：①图表主题；②关键指标与数值；③结论；' +
      '④适合配哪类文案。只描述可见内容，不超过 80 字。',
  },
]

/** ★VF_VLM_COMPRESS_V1（P1）：喂给视觉模型前先把长边缩到 1500px（素材常是 1MB 级界面截图）。
 *  缩图失败（例如环境里没有 ffmpeg）就原图返回 —— 绝不因为缩图把整个识别搞失败。 */
function shrinkForVL(src: string): string {
  try {
    const out = src.replace(/(\.[a-zA-Z0-9]+)$/, '_vl.jpg')
    const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', src, '-vf',
      "scale='if(gt(iw,ih),min(1500,iw),-2)':'if(gt(iw,ih),-2,min(1500,ih))'", out], { timeout: 30000 })
    if (r.status === 0 && fs.existsSync(out) && fs.statSync(out).size > 1024) return out
  } catch (e) { /* 回退原图 */ }
  return src
}

/** ★VF_VLM_2STAGE_V1：一张素材的完整识别 = 缩图 → ①分类 → ②按类别细看 */
async function vlDescribeMaterial(localPath: string): Promise<string | null> {
  const p = shrinkForVL(localPath)
  try {
    const b64 = 'data:image/jpeg;base64,' + fs.readFileSync(p).toString('base64')
    const cls = (await describeImageWithVL(b64,
      '这张图属于哪一类？只回一个词：软件界面（软件/网页/手机界面截图、工具或后台界面）／海报（成品宣传图、带大字的图）／实拍（照片、人物、场景、产品实拍）／图表（数据图表、表格、看板）。',
      24)) || ''
    const hit = VL_PROMPT_BY_CLASS.find((c) => cls.indexOf(c.kw) >= 0)
    return await describeImageWithVL(b64, hit ? hit.prompt : VL_PROMPT_GENERIC, 400)
  } finally {
    // ★VF_POOL_V1：`*_vl.jpg` 缩图只是中间产物（用完即删）—— 原来一直留在素材目录里，是用户能看到的垃圾。
    //   缩图失败时 shrinkForVL 返回原图路径（p === localPath）→ 绝不能删原图。
    if (p !== localPath) { try { fs.unlinkSync(p) } catch { /* 已被删/占用忽略 */ } }
  }
}

export async function summarizeMaterials(
  userId: string | number,
  items: RepoMaterial[],
  maxImages = 10,
): Promise<string> {
  const imgs = items.filter((i) => i.kind === 'image').slice(0, Math.max(1, Math.min(20, maxImages)))
  const vids = items.filter((i) => i.kind === 'video').slice(0, 5)
  if (!imgs.length && !vids.length) return ''

  // ★VF_POOL_V1：顺手清掉素材目录里历史遗留的 `*_vl.jpg`（老版本残留 / 进程中断留下的中间图）。
  //   现版本缩图已"用完即删"，这里只做兜底 TTL 清理，不影响本次识别。
  cleanupVlThumbs(userId)

  const lines: string[] = []
  if (vids.length) lines.push('视频素材（仅列名，未看画面）：' + vids.map((v) => v.name).join('、'))

  const withLocal = await downloadMaterials(userId, imgs)
  // ★VF_POOL_V1（2026-09-30）：素材识别【指纹缓存】—— 治用户抱怨的「看 2 次浪费钱」：
  //   同一张图在多次起草里被反复识别（每次都要跑 2~3 次视觉调用）。
  //   键 = `仓库key@字节大小`（见 material-pool.vlCacheKey）：文件大小一变就自动失效重算；
  //   改名 → key 变 → 命中失败 → 重算（**只会多花钱，绝不串味**）。
  //   识别失败（null/空）不写缓存 → 下次仍会重试，不会把"没识别出来"永久缓存。
  const vlCache = loadVlCache(userId)
  let vlDirty = false
  let vlHits = 0
  let i = 0
  for (const m of withLocal) {
    if (!m.localPath) continue
    i++
    try {
      // ① 先查缓存（命中就完全不调模型）
      const hitDesc = cacheGet(vlCache, m.key || m.name, m.size)
      if (hitDesc) {
        vlHits++
        lines.push(`图${i}（${m.name}）：${hitDesc}`)
        continue
      }
      // ② 未命中 → ★VF_VLM_2STAGE_V1：缩图 → ①分类 → ②按类别细看（提示词见上方 VL_PROMPT_* 常量）
      const desc = await vlDescribeMaterial(m.localPath)
      if (cacheSet(vlCache, m.key || m.name, m.size, desc)) vlDirty = true
      lines.push(`图${i}（${m.name}）：${desc || '（未识别）'}`)
    } catch (e: any) {
      lines.push(`图${i}（${m.name}）：（读图失败）`)
    }
  }
  if (vlDirty) saveVlCache(userId, vlCache)
  if (vlHits) vfLog(userId, `[成片素材] 视觉摘要命中缓存 ${vlHits} 张（省下 ${vlHits} 次/轮的看图调用）`)
  if (!i) return lines.join('\n')
  return (lines.length ? lines.join('\n') + '\n' : '') + `（以上共看了 ${i} 张图；如需看更多素材告诉我）`
}
