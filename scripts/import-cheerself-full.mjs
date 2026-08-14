// 2026-08-14: 从 cheerfull 抓取 JSON 导入 PromptTemplate（去重 + 封面转 OSS）
// 用法: node --env-file=.env.local scripts/import-cheerself-full.mjs [--nocover] [--lib=minimax-h3]
import OSS from 'ali-oss'
import fs from 'fs'
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
const CATS = {
  'seedance-2-5': '视频提示词', 'minimax-h3': '视频提示词', 'flux-3': '视频提示词',
  'gpt-image-2': '图像提示词', 'seedream-5-pro': '图像提示词', 'ecommerce-image': '电商图片提示词',
}
const nocover = process.argv.includes('--nocover')
const only = process.argv.find(a => a.startsWith('--lib='))?.split('=')[1]

let ossClient = null
function getOss() {
  if (ossClient) return ossClient
  const r = process.env.OSS_REGION, k = process.env.OSS_ACCESS_KEY_ID, s = process.env.OSS_ACCESS_KEY_SECRET, b = process.env.OSS_BUCKET
  if (!r || !k || !s || !b) return null
  ossClient = new OSS({ region: r, accessKeyId: k, accessKeySecret: s, bucket: b, authorizationV4: true, endpoint: `https://${r}.aliyuncs.com` })
  return ossClient
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

const data = JSON.parse(fs.readFileSync('scripts/cheerself-full.json', 'utf8'))
let total = 0
for (const slug of Object.keys(data)) {
  if (only && slug !== only) continue
  const lib = data[slug]
  if (!lib?.items?.length) continue
  let inserted = 0, covered = 0
  for (let i = 0; i < lib.items.length; i++) {
    const it = lib.items[i]
    const exist = it.xurl
      ? await prisma.promptTemplate.findFirst({ where: { model: lib.model, originalUrl: it.xurl } })
      : await prisma.promptTemplate.findFirst({ where: { model: lib.model, prompt: it.prompt } })
    let previewUrl = null
    if (!exist && !nocover) {
      const cover = it.poster || it.mp4 || (it.img ? (it.img.startsWith('/') ? 'https://cheerselfai.com' + it.img : it.img) : '')
      if (cover) previewUrl = await coverToOss(cover, slug, i)
      if (previewUrl) covered++
    }
    if (exist) {
      if (!exist.previewUrl && !nocover) {
        const cover = it.poster || it.mp4 || (it.img ? (it.img.startsWith('/') ? 'https://cheerselfai.com' + it.img : it.img) : '')
        const pv = cover ? await coverToOss(cover, slug, i) : null
        if (pv) await prisma.promptTemplate.update({ where: { id: exist.id }, data: { previewUrl: pv, coverUrl: pv } })
      }
      continue
    }
    await prisma.promptTemplate.create({
      data: {
        title: it.prompt.substring(0, 40),
        prompt: it.prompt,
        previewUrl,
        coverUrl: previewUrl || undefined,
        category: CATS[slug] || '提示词',
        model: lib.model,
        source: 'cheerselfai',
        author: it.author || null,
        originalUrl: it.xurl || null,
        tags: `${lib.model},cheerselfai`,
        isActive: true,
      },
    })
    inserted++
  }
  total += inserted
  console.log(`[${slug}] 新增 ${inserted} 条（封面 ${covered}）`)
}
console.log(`\n完成：新增 ${total} 条`)
await prisma.$disconnect()
