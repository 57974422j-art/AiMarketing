import { NextRequest, NextResponse } from 'next/server'
import { getAuthFromHeaders } from '@/lib/api-auth'
import { listObjects, putObject } from '@/lib/oss'
import { saveToPersonalRepo, ensureThumb } from '@/lib/personal-storage'

const MAX_QUOTA = 500 * 1024 * 1024 // 500MB

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
  // 2026-08-12 #5: 删除 query 回退（原 query 可伪造他人 userId 枚举私有素材），强制 header/cookie 鉴权
  const auth = getAuthFromHeaders(request)
  if (!auth?.userId) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })

  try {
    const prefix = `storage/${auth.userId}/`
    const objects = await listObjects(prefix)
    // 已存在的缩略图集合，用于判断存量视频是否需要补图
    const thumbSet = new Set(
      objects.filter(o => o.name.includes('/.thumbs/')).map(o => o.name.split('/.thumbs/')[1])
    )

    // 过滤掉 .thumbs 子目录的文件，只返回用户上传的文件
    const files = objects
      .filter(o => !o.name.includes('/.thumbs/'))
      .map(o => {
        const name = o.name.replace(prefix, '')
        const isVideo = /\.(mp4|mov|avi|mkv|webm)$/i.test(name)
        // 缩略图路径（OSS 上 .thumbs/{name}.jpg）
        const thumbName = name.replace(/\.(mp4|mov|avi|mkv|webm)$/i, '.jpg')
        const thumbExists = thumbSet.has(thumbName)
        // 存量视频缺缩略图时后台异步补齐
        if (isVideo && !thumbExists) void ensureThumb(auth!.userId, name)
        return {
          name,
          size: o.size,
          mtime: o.lastModified.toISOString(),
          isVideo,
          // 视频用 .thumbs 缩略图；图片直接用文件本身作预览；缺图时返回 null（由懒补齐生成）
          thumbUrl: isVideo
            ? (thumbExists ? `/api/storage/file?userId=${auth!.userId}&name=.thumbs/${thumbName}` : null)
            : `/api/storage/file?userId=${auth!.userId}&name=${encodeURIComponent(name)}`,
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
  const buffer = Buffer.from(await file.arrayBuffer())

  // 根据扩展名设置 MIME 类型
  const mimeMap: Record<string, string> = { mp4: 'video/mp4', mov: 'video/quicktime', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' }
  const mime = mimeMap[ext.toLowerCase()] || 'application/octet-stream'

  try {
    const res = await saveToPersonalRepo({ userId: auth.userId, buffer, ext, mime })
    // 2026-08-15: 视频抽 3 帧存 OSS——Agent 发视频时 AI 能"看"内容（提取提示词/描述）
    let frames: string[] = []
    if (mime.startsWith('video/')) {
      try {
        const os = await import('os'); const path = await import('path'); const fsx = await import('fs'); const cp = await import('child_process')
        const tmp = path.join(os.tmpdir(), `frame-src-${auth.userId}-${Date.now()}.${ext}`)
        fsx.writeFileSync(tmp, buffer)
        const framesB = []
        for (let f = 0; f < 3; f++) {
          let out: Buffer | null = null
          try { out = cp.execSync(`ffmpeg -y -ss ${f * 2} -i "${tmp}" -frames:v 1 -vf scale=480:-1 -f image2pipe -vcodec mjpeg - 2>/dev/null`, { timeout: 30000 }) } catch {}
          if (out && out.length > 500) {
            const fk = `storage/${auth.userId}/frame-${Date.now()}-${f}.jpg`
            await putObject(fk, out, 'image/jpeg')
            framesB.push(`/api/storage/file?userId=${auth.userId}&name=${encodeURIComponent(fk.split('/').pop() || fk)}`)
          }
        }
        frames = framesB
        try { fsx.unlinkSync(tmp) } catch {}
      } catch (e2) { console.warn('[storage] 视频抽帧失败', e2?.message) }
    }
    return NextResponse.json({ success: true, data: { name: res.name, size: file.size, frames } })
  } catch (e) {
    const message = e instanceof Error ? e.message : '保存失败'
    return NextResponse.json({ success: false, message }, { status: 413 })
  }
}

// 强制动态渲染：API 路由依赖 request.headers / 鉴权，禁止 Next 在构建期静态预渲染
export const dynamic = 'force-dynamic'
