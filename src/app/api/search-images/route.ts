import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * 获取 DuckDuckGo vqd token（必需的第一步）
 */
async function getVqd(query: string): Promise<string | null> {
  try {
    const res = await fetch('https://duckduckgo.com/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `q=${encodeURIComponent(query)}`,
      redirect: 'manual'
    })
    // 从 Set-Cookie 或响应头/URL 中提取 vqd
    const url = res.headers.get('url') || ''
    const match = url.match(/vqd=([^&]+)/)
    if (match) return match[1]

    // 备选：从 body 提取
    const text = await res.text()
    const vqdMatch = text.match(/vqd['":\s]+(['"])([^'"]+)\1/)
    return vqdMatch?.[2] || null
  } catch {
    return null
  }
}

/**
 * 方案1：DuckDuckGo 图片搜索（带 vqd token）
 */
async function searchDuckDuckGo(q: string, count: number): Promise<Array<{url:string;thumb:string;title:string}>> {
  // 先尝试不带 vqd（某些环境可以直接用）
  const directUrl = `https://duckduckgo.com/i.js?q=${encodeURIComponent(q)}&o=json&p=1&s=0&f=,,,&vqd=`
  try {
    const res = await fetch(directUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
    })
    if (!res.ok) throw new Error(`DDG HTTP ${res.status}`)
    const data = await res.json()
    if (data.results && data.results.length > 0) {
      return data.results.slice(0, count).map((r: any) => ({
        url: r.image,
        thumb: r.thumbnail,
        title: r.title
      }))
    }
  } catch (e) {
    console.log(`[search-images] DDG 直接请求失败:`, e instanceof Error ? e.message : e)
  }

  // 带vqd重试
  try {
    const vqd = await getVqd(q)
    console.log(`[search-images] DDG vqd token: ${vqd ? '已获取' : '获取失败'}`)
    if (!vqd) throw new Error('无法获取 vqd')

    const url = `https://duckduckgo.com/i.js?q=${encodeURIComponent(q)}&o=json&p=1&s=0&f=,,,&vqd=${vqd}`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
    })
    if (!res.ok) throw new Error(`DDG HTTP ${res.status}`)

    const data = await res.json()
    return (data.results || []).slice(0, count).map((r: any) => ({
      url: r.image,
      thumb: r.thumbnail,
      title: r.title
    }))
  } catch (e) {
    console.error(`[search-images] DDG vqd模式也失败:`, e)
    return []
  }
}

/**
 * 方案2：Pixabay 免费图片 API（备用）
 */
async function searchPixabay(q: string, count: number): Promise<Array<{url:string;thumb:string;title:string}>> {
  const key = process.env.PIXABAY_API_KEY
  if (!key) return []

  try {
    const url = `https://pixabay.com/api/?key=${key}&q=${encodeURIComponent(q)}&image_type=photo&per_page=${count}&safesearch=true`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Pixabay HTTP ${res.status}`)
    const data = await res.json()
    return (data.hits || []).slice(0, count).map((h: any) => ({
      url: h.largeImageURL || h.webformatURL,
      thumb: h.previewURL,
      tags: h.tags
    }))
  } catch (e) {
    console.error(`[search-images] Pixabay 备用也失败:`, e)
    return []
  }
}

/**
 * 方案3：Unsplash Source（无需 API key 的免费备选）
 * 格式: https://source.unsplash.com/400x300/?{keyword}
 * 注意: source.unsplash.com 已 deprecated，用新方式
 */
function generateUnsplashUrls(q: string, count: number): Array<{url:string;thumb:string;title:string}> {
  // Unsplash 已废弃 source API，改用 picsum 作为最终兜底
  // 这里返回空让调用方走 picsum 兜底
  return []
}

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get('q') || ''
  const count = parseInt(request.nextUrl.searchParams.get('count') || '6')
  if (!q) return NextResponse.json({ success: false, message: '缺少搜索词' }, { status: 400 })

  let images: Array<{url:string;thumb:string;title:string}> = []

  const key = process.env.PIXABAY_API_KEY

  // 1. Pixabay 优先（相关性远好于 DuckDuckGo）
  if (key) {
    images = await searchPixabay(q, count)
    if (images.length > 0) {
      console.log(`[search-images] Pixabay 关键词="${q}" 结果=${images.length}`)
      return NextResponse.json({ success: true, data: images })
    }
  }

  // 2. Pixabay 无结果或无Key → DuckDuckGo
  images = await searchDuckDuckGo(q, count)
  if (images.length > 0) {
    console.log(`[search-images] DuckDuckGo 关键词="${q}" 结果=${images.length}`)
    return NextResponse.json({ success: true, data: images })
  }

  // 3. 最终兜底：Picsum 随机图 + 占位提示
  console.warn(`[search-images] 所有来源均无结果，关键词: "${q}"，使用占位图`)
  for (let i = 0; i < Math.min(count, 4); i++) {
    images.push({
      url: `https://picsum.photos/seed/${q}${i}/400/300`,
      thumb: `https://picsum.photos/seed/${q}${i}/100/80`,
      title: `${q} - 示例图${i+1}`
    })
  }

  console.log(`[search-images] 兜底关键词="${q}" 结果数=${images.length}`)

  return NextResponse.json({ success: true, data: images })
}
