// 2026-08-14: 从 cheerfull 抓取 JSON 导入 PromptTemplate（去重 + 封面转 OSS）
// 用法: node --env-file=.env.local scripts/import-cheerself-full.mjs [--nocover] [--lib=minimax-h3]
import OSS from 'ali-oss'
import fs from 'fs'
import { gunzipSync } from 'zlib'
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
const CATS = {
  'seedance-2-5': '视频提示词', 'minimax-h3': '视频提示词', 'flux-3': '视频提示词',
  'gpt-image-2': '图像提示词', 'seedream-5-pro': '图像提示词', 'ecommerce-image': '电商图片提示词',
}
const nocover = process.argv.includes('--nocover')
const doVideo = process.argv.includes('--video')
const mediaOnly = process.argv.includes('--media-only')  // 2026-08-15: 只导入有封面图/视频的（跳过空词条）
// 2026-08-15: prompt 归一化去重（去空白/换行差异——滚动抓取同一提示词可能微差）
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase()
const only = process.argv.find(a => a.startsWith('--lib='))?.split('=')[1]

let ossClient = null
function getOss() {
  if (ossClient) return ossClient
  const r = process.env.OSS_REGION, k = process.env.OSS_ACCESS_KEY_ID, s = process.env.OSS_ACCESS_KEY_SECRET, b = process.env.OSS_BUCKET
  if (!r || !k || !s || !b) return null
  ossClient = new OSS({ region: r, accessKeyId: k, accessKeySecret: s, bucket: b, authorizationV4: true, endpoint: `https://${r}.aliyuncs.com` })
  return ossClient
}
async function videoToOss(url, slug, idx) {
  try {
    const oss = getOss()
    if (!oss || !url) return null
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(120000) })
    if (!r.ok) return null
    const buf = Buffer.from(await r.arrayBuffer())
    if (buf.length < 10000 || buf.length > 100 * 1024 * 1024) return null
    const key = `prompts/cheerselfai/${slug}/video-${idx}.mp4`
    await oss.put(key, buf, { headers: { 'Content-Type': 'video/mp4' } })
    return `https://${process.env.OSS_BUCKET}.${process.env.OSS_REGION}.aliyuncs.com/${key}`
  } catch { return null }
}

async function coverToOss(url, slug, idx) {
  try {
    const oss = getOss()
    if (!oss || !url) return null
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(60000) })
    if (!r.ok) return null
    const buf = Buffer.from(await r.arrayBuffer())
    if (buf.length < 500) return null
    const isMp4 = /\.mp4(\?|$)/i.test(url) || url.includes('.mp4')
    if (isMp4) {
      const os = await import('os'); const path = await import('path'); const cp = await import('child_process')
      const tmp = path.join(os.tmpdir(), `cheer-${slug}-${idx}.mp4`)
      fs.writeFileSync(tmp, buf)
      try {
        const out = cp.execSync(`ffmpeg -y -i "${tmp}" -frames:v 1 -f image2pipe -vcodec mjpeg - 2>/dev/null`, { timeout: 60000 })
        if (!out || out.length < 500) return null
        const key = `prompts/cheerselfai/${slug}/${idx}.jpg`
        await oss.put(key, out, { headers: { 'Content-Type': 'image/jpeg' } })
        return `https://${process.env.OSS_BUCKET}.${process.env.OSS_REGION}.aliyuncs.com/${key}`
      } catch { return null } finally { try { fs.unlinkSync(tmp) } catch {} }
    }
    if (buf.length > 8 * 1024 * 1024) return null
    const ext = (url.split('?')[0].match(/\.(jpe?g|png|webp|gif)$/i)?.[1] || 'jpg').toLowerCase()
    const key = `prompts/cheerselfai/${slug}/${idx}.${ext}`
    await oss.put(key, buf, { headers: { 'Content-Type': 'image/' + (ext === 'jpg' ? 'jpeg' : ext) } })
    return `https://${process.env.OSS_BUCKET}.${process.env.OSS_REGION}.aliyuncs.com/${key}`
  } catch { return null }
}

let raw
if (fs.existsSync('scripts/cheerself-full.json.gz')) {
  raw = gunzipSync(fs.readFileSync('scripts/cheerself-full.json.gz')).toString('utf8')
} else {
  raw = fs.readFileSync('scripts/cheerself-full.json', 'utf8')
}
const data = JSON.parse(raw)
let total = 0
for (const slug of Object.keys(data)) {
  if (only && slug !== only) continue
  const lib = data[slug]
  if (!lib?.items?.length) continue
  let inserted = 0, covered = 0
  // 2026-08-15: 高效去重——一次拉该库全量到内存 Map（O(1) 查）
  const allRows = await prisma.promptTemplate.findMany({ where: { source: 'cheerselfai', model: lib.model }, select: { id: true, prompt: true, originalUrl: true, previewUrl: true, videoUrl: true } })
  const byXurl = new Map(allRows.filter(r => r.originalUrl).map(r => [r.originalUrl, r]))
  const byPrompt = new Map(allRows.map(r => [norm(r.prompt), r]))
  for (let i = 0; i < lib.items.length; i++) {
    const it = lib.items[i]
    // --media-only: 跳过无图/无视频的条目（图片库懒加载空词条不入库）
    if (mediaOnly && !it.poster && !it.mp4 && !it.img) continue
    const exist = it.xurl ? byXurl.get(it.xurl) : byPrompt.get(norm(it.prompt))
    let previewUrl = null
    let videoUrl = null
    if (doVideo && it.mp4) videoUrl = await videoToOss(it.mp4, slug, i)
    if (doVideo && i % 20 === 0) console.log(`  [${slug}] ${i}/${lib.items.length} 条（本轮 video: ${videoUrl ? 'OK' : '-'}）`)
    if (!exist && !nocover) {
      // 2026-08-15: poster(pbs 被墙)失败 → fallback mp4(r2.dev 可达) 抽帧
      let cover = it.poster || ''
      if (!cover && it.img) cover = it.img.startsWith('/') ? 'https://cheerselfai.com' + it.img : it.img
      if (cover) previewUrl = await coverToOss(cover, slug, i)
      if (!previewUrl && it.mp4) previewUrl = await coverToOss(it.mp4, slug, i)
      if (previewUrl) covered++
    }
    if (exist) {
      if (!exist.previewUrl && !nocover) {
        let cover = it.poster || ''
        if (!cover && it.img) cover = it.img.startsWith('/') ? 'https://cheerselfai.com' + it.img : it.img
        let pv = cover ? await coverToOss(cover, slug, i) : null
        if (!pv && it.mp4) pv = await coverToOss(it.mp4, slug, i)
        if (pv) await prisma.promptTemplate.update({ where: { id: exist.id }, data: { previewUrl: pv, coverUrl: pv } })
      }
      // 2026-08-15: videoUrl 更新独立于 nocover（--video --nocover 时视频也要写库）
      if (doVideo && videoUrl && !exist.videoUrl) await prisma.promptTemplate.update({ where: { id: exist.id }, data: { videoUrl } })
      continue
    }
    await prisma.promptTemplate.create({
      data: {
        title: it.prompt.substring(0, 40),
        prompt: it.prompt,
        previewUrl,
        coverUrl: previewUrl || undefined,
        videoUrl: videoUrl || undefined,
        category: CATS[slug] || '提示词',
        model: lib.model,
        source: 'cheerselfai',
        author: it.author || null,
        originalUrl: it.xurl || null,
        tags: `${lib.model},cheerselfai`,
        isActive: true,
      },
    })
    byPrompt.set(norm(it.prompt), { id: created.id, prompt: it.prompt, originalUrl: it.xurl || null, previewUrl: previewUrl || null, videoUrl: videoUrl || null })
    if (it.xurl) byXurl.set(it.xurl, { id: created.id, prompt: it.prompt, originalUrl: it.xurl, previewUrl: previewUrl || null, videoUrl: videoUrl || null })
    inserted++
  }
  total += inserted
  console.log(`[${slug}] 新增 ${inserted} 条（封面 ${covered}）`)
}
console.log(`\n完成：新增 ${total} 条`)
await prisma.$disconnect()
