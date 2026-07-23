/**
 * 个人仓库统一入库层
 *
 * 所有「导入到个人仓库 storage/{userId}/」的入口都必须走这里，
 * 保证：① 文件名统一 YYYYMMDD_NNN.ext（天然按日期正确排列）；
 *       ② 视频自动生成 .thumbs/{name}.jpg 缩略图；③ 配额一致。
 *
 * 覆盖来源：电脑本地导入 / 一键成片存仓库 / 数字人存仓库。
 */
import fs from 'fs'
import path from 'path'
import { tmpdir } from 'os'
import { putObject, listObjects, getObject, objectExists } from '@/lib/oss'
import { runFFmpeg } from '@/lib/ffmpeg'

const MAX_QUOTA = 500 * 1024 * 1024 // 500MB

const VIDEO_RE = /\.(mp4|mov|avi|mkv|webm)$/i

/** 用 FFmpeg 从视频 buffer 截第一帧作为缩略图 */
async function generateThumbnail(videoBuffer: Buffer): Promise<Buffer | null> {
  try {
    const tmpIn = path.join(tmpdir(), `thumb_${Date.now()}_in.mp4`)
    const tmpOut = path.join(tmpdir(), `thumb_${Date.now()}_out.jpg`)
    fs.writeFileSync(tmpIn, videoBuffer)
    await runFFmpeg(`-y -i "${tmpIn}" -ss 00:00:00.5 -vframes 1 -q:v 2 "${tmpOut}"`, {
      timeout: 15000,
      skipNice: true,
      priority: 'high',
    })
    const thumb = fs.readFileSync(tmpOut)
    fs.unlinkSync(tmpIn)
    fs.unlinkSync(tmpOut)
    return thumb
  } catch (e) {
    console.error('[thumbnail] FFmpeg生成失败:', e instanceof Error ? e.message : e)
    return null
  }
}

export interface SaveToRepoOptions {
  userId: string
  buffer: Buffer
  ext: string
  mime: string
  /** 是否做 500MB 配额检查，默认 true */
  quotaCheck?: boolean
}

/**
 * 统一写入个人仓库：日期序命名 + 自动缩略图
 * 返回最终文件名（如 20260723_001.mp4）
 */
export async function saveToPersonalRepo(opts: SaveToRepoOptions): Promise<{ name: string }> {
  const { userId, buffer, ext, mime } = opts
  const quotaCheck = opts.quotaCheck ?? true

  // 配额检查（统计该用户已用空间）
  if (quotaCheck) {
    try {
      const files = await listObjects(`storage/${userId}/`)
      const used = files.reduce((sum, f) => sum + f.size, 0)
      if (used + buffer.length > MAX_QUOTA) {
        throw new Error('存储空间不足')
      }
    } catch (e) {
      if (e instanceof Error && e.message === '存储空间不足') throw e
      // OSS 列目录失败时跳过配额检查
    }
  }

  // 日期序命名：YYYYMMDD_NNN.ext
  const now = new Date()
  const datePrefix = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
  let todaySeq = 1
  try {
    const existing = (await listObjects(`storage/${userId}/${datePrefix}`)).filter(
      o => !o.name.includes('/.thumbs/')
    )
    todaySeq = existing.length + 1
  } catch {}
  const name = `${datePrefix}_${String(todaySeq).padStart(3, '0')}.${ext}`
  const key = `storage/${userId}/${name}`

  // 上传主文件
  await putObject(key, buffer, mime)

  // 视频文件：生成缩略图存到 .thumbs/ 目录
  if (VIDEO_RE.test(name)) {
    try {
      const thumbBuffer = await generateThumbnail(buffer)
      if (thumbBuffer) {
        const thumbName = name.replace(VIDEO_RE, '.jpg')
        const thumbKey = `storage/${userId}/.thumbs/${thumbName}`
        await putObject(thumbKey, thumbBuffer, 'image/jpeg')
      }
    } catch {}
  }

  return { name }
}

/**
 * 存量视频缺缩略图时后台懒补齐：
 * 从 OSS 取回视频 buffer → 现截一帧 → 存回 .thumbs/
 */
export async function ensureThumb(userId: string, videoName: string): Promise<void> {
  const key = `storage/${userId}/${videoName}`
  const thumbName = videoName.replace(VIDEO_RE, '.jpg')
  const thumbKey = `storage/${userId}/.thumbs/${thumbName}`
  try {
    if (await objectExists(thumbKey)) return
    const videoBuf = await getObject(key)
    const thumbBuffer = await generateThumbnail(videoBuf)
    if (thumbBuffer) await putObject(thumbKey, thumbBuffer, 'image/jpeg')
  } catch (e) {
    console.error('[ensureThumb] 补齐失败:', e instanceof Error ? e.message : e)
  }
}
