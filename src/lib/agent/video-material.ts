// ★VF_MATERIAL_V1（2026-09-19）：成片素材层
//   作用：把【个人仓库】（OSS `storage/{userId}/`）里的素材列出来 + 下载到服务器本地
//        + 用视觉模型看懂（qwen-vl-max，复用 ai-providers.describeImageWithVL）
//   为什么需要：render.py 的画面输入要的是【服务器本地文件路径】，而素材在 OSS 上。
//   ★注意：服务器只能读 OSS 个人仓库；客户端"本地仓库"在用户电脑上，服务器看不到。
//   复用：抽帧已有（extract_video_frames 在 chat route）——这里不重复造，先只理解【图片】。
import fs from 'fs'
import path from 'path'
import { spawnSync } from 'child_process'
import { listObjects, getObject } from '@/lib/oss'
import { describeImageWithVL } from '@/lib/ai-providers'

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
    // ★VF_MATSPREAD_V1：图片走"分批均匀抽样"，视频另留少量（画面以图为主）
    const imgs = all.filter((o) => o.kind === 'image')
    const vids = all.filter((o) => o.kind === 'video')
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
  const b64 = 'data:image/jpeg;base64,' + fs.readFileSync(p).toString('base64')
  const cls = (await describeImageWithVL(b64,
    '这张图属于哪一类？只回一个词：软件界面（软件/网页/手机界面截图、工具或后台界面）／海报（成品宣传图、带大字的图）／实拍（照片、人物、场景、产品实拍）／图表（数据图表、表格、看板）。',
    24)) || ''
  const hit = VL_PROMPT_BY_CLASS.find((c) => cls.indexOf(c.kw) >= 0)
  return await describeImageWithVL(b64, hit ? hit.prompt : VL_PROMPT_GENERIC, 400)
}

export async function summarizeMaterials(
  userId: string | number,
  items: RepoMaterial[],
  maxImages = 10,
): Promise<string> {
  const imgs = items.filter((i) => i.kind === 'image').slice(0, Math.max(1, Math.min(20, maxImages)))
  const vids = items.filter((i) => i.kind === 'video').slice(0, 5)
  if (!imgs.length && !vids.length) return ''

  const lines: string[] = []
  if (vids.length) lines.push('视频素材（仅列名，未看画面）：' + vids.map((v) => v.name).join('、'))

  const withLocal = await downloadMaterials(userId, imgs)
  let i = 0
  for (const m of withLocal) {
    if (!m.localPath) continue
    i++
    try {
      // ★VF_VLM_2STAGE_V1（P1）：缩图 → ①分类 → ②按类别细看（提示词见上方 VL_PROMPT_* 常量）
      const desc = await vlDescribeMaterial(m.localPath)
      lines.push(`图${i}（${m.name}）：${desc || '（未识别）'}`)
    } catch (e: any) {
      lines.push(`图${i}（${m.name}）：（读图失败）`)
    }
  }
  if (!i) return lines.join('\n')
  return (lines.length ? lines.join('\n') + '\n' : '') + `（以上共看了 ${i} 张图；如需看更多素材告诉我）`
}
