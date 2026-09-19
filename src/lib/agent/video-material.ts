// ★VF_MATERIAL_V1（2026-09-19）：成片素材层
//   作用：把【个人仓库】（OSS `storage/{userId}/`）里的素材列出来 + 下载到服务器本地
//        + 用视觉模型看懂（qwen-vl-max，复用 ai-providers.describeImageWithVL）
//   为什么需要：render.py 的画面输入要的是【服务器本地文件路径】，而素材在 OSS 上。
//   ★注意：服务器只能读 OSS 个人仓库；客户端"本地仓库"在用户电脑上，服务器看不到。
//   复用：抽帧已有（extract_video_frames 在 chat route）——这里不重复造，先只理解【图片】。
import fs from 'fs'
import path from 'path'
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

/** 素材本地工作目录（与 make.py 的 --workdir 同区域，随用户隔离） */
export function materialDir(userId: string | number): string {
  const root = process.env.LOCAL_STORAGE || path.join(process.cwd(), 'storage')
  return path.join(root, String(userId), 'video-factory', 'material')
}

/**
 * 列个人仓库素材（新的在前）
 * @param limit 最多返回多少条（默认 40；视觉理解另按 maxImages 控制）
 */
export async function listRepoMaterials(userId: string | number, limit = 40): Promise<RepoMaterial[]> {
  const uid = String(userId)
  try {
    const objs = await listObjects(`storage/${uid}/`, 1000)
    return objs
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
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit)
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
      const b64 = 'data:image/jpeg;base64,' + fs.readFileSync(m.localPath).toString('base64')
      const desc = await describeImageWithVL(
        b64,
        '这是用户个人素材库里的一张图。请用中文一句话描述画面主体、场景、色调与可能的用途（如产品图/门店/海报）。只描述实际可见内容，不要猜测，不超过 40 字。',
      )
      lines.push(`图${i}（${m.name}）：${desc || '（未识别）'}`)
    } catch (e: any) {
      lines.push(`图${i}（${m.name}）：（读图失败）`)
    }
  }
  if (!i) return lines.join('\n')
  return (lines.length ? lines.join('\n') + '\n' : '') + `（以上共看了 ${i} 张图；如需看更多素材告诉我）`
}
