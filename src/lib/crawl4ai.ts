// 2026-08-13: crawl4ai 共享调用（/api/crawl 代理 + Agent crawl_web 工具共用）
const CRAWL4AI_URL = process.env.CRAWL4AI_URL || 'http://127.0.0.1:11235'
const CRAWL4AI_TOKEN = process.env.CRAWL4AI_API_TOKEN || ''

export async function crawlWeb(url: string): Promise<{ ok: boolean; markdown?: string; title?: string; error?: string }> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (CRAWL4AI_TOKEN) headers['Authorization'] = `Bearer ${CRAWL4AI_TOKEN}`
    const r = await fetch(`${CRAWL4AI_URL}/crawl`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        urls: [url], priority: 10, max_depth: 1, verbose: false,
        headless: true, js: true, wait_for: 'domcontentloaded', page_timeout: 30000,
        user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      }),
      signal: AbortSignal.timeout(90000),
    })
    if (!r.ok) return { ok: false, error: `crawl4ai HTTP ${r.status}` }
    const d = await r.json()
    const first = Array.isArray(d?.results) ? d.results[0] : null
    const md = first?.markdown || first?.cleaned_html || ''
    return { ok: true, markdown: String(md).substring(0, 50000), title: first?.metadata?.title || '' }
  } catch (e: any) {
    return { ok: false, error: `crawl4ai 调用失败: ${e?.message || e}` }
  }
}

// 防 SSRF：拒绝内网/保留地址
export function isBlockedCrawlUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl)
    if (!['http:', 'https:'].includes(u.protocol)) return true
    const h = u.hostname.toLowerCase()
    if (h === 'localhost' || h === '::1' || h === '0.0.0.0' || h.endsWith('.local')) return true
    const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
    if (m) {
      const [a, b] = [parseInt(m[1]), parseInt(m[2])]
      if (a === 127 || a === 10 || a === 0) return true
      if (a === 172 && b >= 16 && b <= 31) return true
      if (a === 192 && b === 168) return true
      if (a === 169 && b === 254) return true
    }
    return false
  } catch { return true }
}
