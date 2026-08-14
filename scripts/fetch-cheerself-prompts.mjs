// 2026-08-14: 抓取 cheerselfai.com 提示词库 → 导入 PromptTemplate（学习库）
// 封面/图自动下载转 OSS（坚决不存外链）
// 用法: node --env-file=.env.local scripts/fetch-cheerself-prompts.mjs [--lib=seedance-2-5] [--limit=N]
import OSS from 'ali-oss'
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
const BASE = 'https://cheerselfai.com/prompts'
const LIBS = [
  { slug: 'seedance-2-5',   model: 'Seedance 2.5',   category: '视频提示词' },
  { slug: 'minimax-h3',     model: 'MiniMax H3',     category: '视频提示词' },
  { slug: 'gpt-image-2',    model: 'GPT Image 2',    category: '图像提示词' },
  { slug: 'seedream-5-pro', model: 'Seedream 5 Pro', category: '图像提示词' },
  { slug: 'flux-3',         model: 'FLUX 3',         category: '视频提示词' },
  { slug: 'ecommerce-image',model: 'GPT Image 2',    category: '电商图片提示词' },
]
const limit = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || '60', 10)
const only = process.argv.find(a => a.startsWith('--lib='))?.split('=')[1]

let ossClient = null
function getOss() {
  if (ossClient) return ossClient
  const r = process.env.OSS_REGION, k = process.env.OSS_ACCESS_KEY_ID, s = process.env.OSS_ACCESS_KEY_SECRET, b = process.env.OSS_BUCKET
  if (!r || !k || !s || !b) { console.warn('[OSS] 未配置——封面跳过转存'); return null }
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
      // 视频：下载后 ffmpeg 抽首帧
      const fs = await import('fs')
      const os = await import('os')
      const path = await import('path')
      const cp = await import('child_process')
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

function stripTags(h) {
  return h.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim()
}

async function fetchLib(slug) {
  const url = `${BASE}/${slug}`
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(90000) })
  if (!r.ok) throw new Error(`${slug} HTTP ${r.status}`)
  const html = await r.text()
  const starts = [...html.matchAll(/<div class="imagePromptCard/g)].map(m => m.index)
  const actions = [...html.matchAll(/<div class="imagePromptCardActions">/g)].map(m => m.index)
  const items = []
  for (let i = 0; i < starts.length; i++) {
    const s = starts[i]
    const a = actions.find(x => x > s)
    if (!a) continue
    const cardHtml = html.substring(s, a)
    let prompt = stripTags(cardHtml)
    const ti = prompt.indexOf('提示词')
    if (ti >= 0 && ti < 30) prompt = prompt.substring(ti + 3).trim()
    prompt = prompt.replace(/^[\s:：]*/, '').replace(/当前浏览器不支持视频播放\s*$/, '').replace(/\s+$/g, '').trim()
    const after = html.substring(a, a + 900)
    const mAuthor = after.match(/@([A-Za-z0-9_\-\.]+)/)
    const mX = after.match(/https:\/\/x\.com\/[^"\s'\)]+/)
    let cover = ''
    let coverMp4 = ''
    const mPoster = cardHtml.match(/poster="([^"]+)/)
    if (mPoster) cover = mPoster[1]
    const mMp4 = cardHtml.match(/<source[^>]*src="([^"]+\.mp4[^"]*)"/)
    if (mMp4) coverMp4 = mMp4[1]
    if (!cover && !coverMp4) {
      const mMp42 = cardHtml.match(/https:\/\/[^"']+\.mp4[^"']*/)
      if (mMp42) coverMp4 = mMp42[0]
    }
    if (!cover) {
      const mImg = cardHtml.match(/<img[^>]*src="([^"]+)/)
      if (mImg) {
        let u = mImg[1]
        if (u.startsWith('/_next/image?url=')) u = decodeURIComponent(u.split('url=')[1].split('&')[0])
        if (u.startsWith('/')) u = 'https://cheerselfai.com' + u
        cover = u
      }
    }
    if (prompt.length > 20) items.push({ prompt, author: mAuthor?.[1] || '', xurl: mX?.[0] || '', cover, coverMp4 })
  }
  return items
}

async function main() {
  const libs = LIBS.filter(l => !only || l.slug === only)
  let total = 0
  for (const lib of libs) {
    try {
      const items = await fetchLib(lib.slug)
      console.log(`[${lib.slug}] 解析到 ${items.length} 条`)
      let inserted = 0
      for (const it of items.slice(0, limit)) {
        const exist = it.xurl
          ? await prisma.promptTemplate.findFirst({ where: { model: lib.model, originalUrl: it.xurl } })
          : await prisma.promptTemplate.findFirst({ where: { model: lib.model, prompt: it.prompt } })
        if (exist) {
          // 已存在但无封面 → 补转 OSS
          if (!exist.previewUrl && (it.cover || it.coverMp4)) {
            let pv = it.cover ? await coverToOss(it.cover, lib.slug, items.indexOf(it)) : null
            if (!pv && it.coverMp4) pv = await coverToOss(it.coverMp4, lib.slug, items.indexOf(it))
            if (pv) await prisma.promptTemplate.update({ where: { id: exist.id }, data: { previewUrl: pv, coverUrl: pv } })
          }
          continue
        }
        let previewUrl = null
        if (it.cover) previewUrl = await coverToOss(it.cover, lib.slug, items.indexOf(it))
        if (!previewUrl && it.coverMp4) previewUrl = await coverToOss(it.coverMp4, lib.slug, items.indexOf(it))
        await prisma.promptTemplate.create({
          data: {
            title: it.prompt.substring(0, 40),
            prompt: it.prompt,
            previewUrl,
            coverUrl: previewUrl || undefined,
            category: lib.category,
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
      console.log(`  → 入库 ${inserted} 条`)
    } catch (e) { console.error(`[${lib.slug}] 失败: ${e.message}`) }
  }
  console.log(`\n完成：共入库 ${total} 条`)
  await prisma.$disconnect()
}
main()
