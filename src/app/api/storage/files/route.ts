import { NextRequest, NextResponse } from 'next/server'
import { getAuthFromHeaders } from '@/lib/api-auth'
import { putObject, listObjects } from '@/lib/oss'
import { execSync } from 'child_process'
import { tmpdir } from 'os'
import { join } from 'path'

const MAX_QUOTA = 500 * 1024 * 1024 // 500MB

/** FFmpeg 路径 */
function getFFmpeg(): string {
  const paths = ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg', 'ffmpeg']
  for (const p of paths) {
    try { execSync(`"${p}" -version`, { stdio: 'ignore', timeout: 3000 }); return p }
    catch {}
  }
  return 'ffmpeg'
}

/** 用 FFmpeg 从视频 buffer 中截取第一帧作为缩略图 */
async function generateThumbnail(videoBuffer: Buffer): Promise<Buffer | null> {
  try {
    const ffmpeg = getFFmpeg()
    const tmpIn = join(tmpdir(), `thumb_${Date.now()}_in.mp4`)
    const tmpOut = join(tmpdir(), `thumb_${Date.now()}_out.jpg`)
    require('fs').writeFileSync(tmpIn, videoBuffer)
    execSync(
      `"${ffmpeg}" -y -i "${tmpIn}" -ss 00:00:00.5 -vframes 1 -q:v 2 "${tmpOut}"`,
      { stdio: 'ignore', timeout: 15000 }
    )
    const thumb = require('fs').readFileSync(tmpOut)
    require('fs').unlinkSync(tmpIn)
    require('fs').unlinkSync(tmpOut)
    return thumb
  } catch (e) {
    console.error('[thumbnail] FFmpeg生成失败:', e instanceof Error ? e.message : e)
    return null
  }
}

/** 获取用户在 OSS 上的已用空间 */
async function usedQuota(userId: number): Promise<number> {
  try {
    const files = await listObjects(`storage/${userId}/`)
    return files.reduce((sum, f) => sum + f.size, 0)
  } catch {
    return 0
  }
}

export async function GET(request: NextRequest) {
  let auth = getAuthFromHeaders(request)
  // 兼容白名单模式：Electron 环境可能无法带 Cookie，允许通过 query param 传 userId
  if (!auth) {
    const queryUserId = request.nextUrl.searchParams.get('userId')
    const queryRole = request.nextUrl.searchParams.get('role') || 'end-user'
    if (queryUserId) {
      auth = { userId: parseInt(queryUserId, 10), role: queryRole, teamId: null }
      if (isNaN(auth.userId)) auth = null
    }
  }
  if (!auth) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })

  try {
    const prefix = `storage/${auth.userId}/`
    const objects = await listObjects(prefix)

    // 过滤掉 .thumbs 子目录的文件，只返回用户上传的文件
    const files = objects
      .filter(o => !o.name.includes('/.thumbs/'))
      .map(o => {
        const name = o.name.replace(prefix, '')
        const isVideo = /\.(mp4|mov|avi|mkv|webm)$/i.test(name)
        // 缩略图路径（OSS 上 .thumbs/{name}.jpg）
        const thumbName = name.replace(/\.(mp4|mov|avi|mkv|webm)$/i, '.jpg')
        return {
          name,
          size: o.size,
          mtime: o.lastModified.toISOString(),
          isVideo,
          thumbUrl: isVideo ? `/api/storage/file?userId=${auth!.userId}&name=.thumbs/${thumbName}` : null,
        }
      })
      .sort((a, b) => b.mtime.localeCompare(a.mtime))

    const used = await usedQuota(auth.userId)
    return NextResponse.json({ success: true, data: { files, used, total: MAX_QUOTA, userId: auth.userId } })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message || '读取失败' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })

  const form = await request.formData()
  const file = form.get('file') as File
  if (!file) return NextResponse.json({ success: false, message: '缺少文件' }, { status: 400 })

  const used = await usedQuota(auth.userId)
  if (used + file.size > MAX_QUOTA) {
    return NextResponse.json({ success: false, message: `存储空间不足（已用 ${(used / 1024 / 1024).toFixed(1)}MB / 500MB）` }, { status: 413 })
  }

  const ext = file.name.split('.').pop() || 'mp4'
  const name = Date.now() + '_' + file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const key = `storage/${auth.userId}/${name}`
  const buffer = Buffer.from(await file.arrayBuffer())

  // 根据扩展名设置 MIME 类型
  const mimeMap: Record<string, string> = { mp4: 'video/mp4', mov: 'video/quicktime', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' }
  const mime = mimeMap[ext.toLowerCase()] || 'application/octet-stream'

  await putObject(key, buffer, mime)

  // 视频文件：生成缩略图存到 .thumbs/ 目录
  const isVideo = /\.(mp4|mov|avi|mkv|webm)$/i.test(name)
  if (isVideo) {
    try {
      const thumbBuffer = await generateThumbnail(buffer)
      if (thumbBuffer) {
        const thumbName = name.replace(/\.(mp4|mov|avi|mkv|webm)$/i, '.jpg')
        const thumbKey = `storage/${auth.userId}/.thumbs/${thumbName}`
        await putObject(thumbKey, thumbBuffer, 'image/jpeg')
      }
    } catch {}
  }

  return NextResponse.json({ success: true, data: { name, size: file.size } })
}
