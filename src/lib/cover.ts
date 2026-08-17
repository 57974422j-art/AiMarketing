// 2026-08-15: 封面外链 → OSS 转存（防 CDN 失效裂图）——prompt-sources / prompt-sync 共享
import { putObject } from '@/lib/oss'

export async function migrateCover(url: string, prefix: string): Promise<string> {
  if (!url || !/^https?:\/\//.test(url) || url.includes('aliyuncs.com')) return url
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) })
    if (!res.ok) return url
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length < 100) return url
    const m = url.split('?')[0].match(/\.(png|jpe?g|webp|gif|svg|avif)/i)
    const ext = (m ? m[1] : 'jpg').toLowerCase()
    const key = `covers/${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}.${ext}`
    await putObject(key, buf, `image/${ext === 'jpg' ? 'jpeg' : ext}`)
    return `https://${process.env.OSS_BUCKET}.${process.env.OSS_REGION}.aliyuncs.com/${key}`
  } catch {
    return url
  }
}
