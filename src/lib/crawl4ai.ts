// 2026-08-13: crawl4ai 共享调用（/api/crawl 代理 + Agent crawl_web 工具共用）
const CRAWL4AI_URL = process.env.CRAWL4AI_URL || 'http://127.0.0.1:11235'
const CRAWL4AI_TOKEN = process.env.CRAWL4AI_API_TOKEN || ''

// 2026-08-13: 清理抓取文本——只留正文文字，去链接/图片/表格线/分隔线/URL/符号噪音
export function cleanMarkdown(md: string): string {
  if (!md) return ''
  const out = md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')          // 图片
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')          // 链接只留文字
    .replace(/^[\s]*\|[\s\-:]*\|.*$/gm, '')           // 表格分隔线
    .replace(/\|/g, ' ')                              // 表格竖线
    .replace(/[-*_=]{3,}/g, ' ')                      // 分隔线
    .replace(/#{1,6}\s*/g, '')                        // 标题符号
    .replace(/[`>~*_]/g, '')                          // 其它 markdown 符号
    .replace(/https?:\/\/[^\s)]+/g, ' ')              // URL
    .replace(/\s{2,}/g, ' ')                          // 多余空白
    .trim()
  return out
}

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
    // 2026-08-14: fit_markdown（crawl4ai 正文提取）优先；无正文/过短视为无内容（门户导航文字不算正文）
    const raw = first?.fit_markdown || first?.markdown || first?.cleaned_html || ''
    const cleaned = cleanMarkdown(String(raw))
    if (cleaned.length < 300) return { ok: true, markdown: '', title: first?.metadata?.title || '' }
    return { ok: true, markdown: cleaned.substring(0, 50000), title: first?.metadata?.title || '' }
  } catch (e: any) {
    return { ok: false, error: `crawl4ai 调用失败: ${e?.message || e}` }
  }
}

// 2026-08-14: 抓取整页截图（C 方案——截图后交给视觉模型读图）
export async function crawlScreenshot(url: string): Promise<{ ok: boolean; base64?: string; error?: string }> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (CRAWL4AI_TOKEN) headers['Authorization'] = `Bearer ${CRAWL4AI_TOKEN}`
    const r = await fetch(`${CRAWL4AI_URL}/crawl`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        urls: [url], priority: 10, max_depth: 1, verbose: false,
        headless: true, js: true, wait_for: 'domcontentloaded', page_timeout: 40000,
        screenshot: true, full_page: true,
        user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      }),
      signal: AbortSignal.timeout(120000),
    })
    if (!r.ok) return { ok: false, error: `crawl4ai HTTP ${r.status}` }
    const d = await r.json()
    const first = Array.isArray(d?.results) ? d.results[0] : null
    const shot = first?.screenshot
    if (!shot) return { ok: false, error: 'crawl4ai 未返回截图（可能截图不可用）' }
    // screenshot 可能是 base64 或 URL
    if (typeof shot === 'string' && shot.startsWith('data:image')) {
      return { ok: true, base64: shot }
    }
    if (typeof shot === 'string' && /^https?:\/\//.test(shot)) {
      // 服务器 fetch 截图 → base64（百炼需要公网 URL 或 base64）
      const img = await fetch(shot, { signal: AbortSignal.timeout(30000) })
      const buf = Buffer.from(await img.arrayBuffer())
      return { ok: true, base64: `data:image/png;base64,${buf.toString('base64')}` }
    }
    return { ok: false, error: '截图格式未知' }
  } catch (e: any) {
    return { ok: false, error: `截图失败: ${e?.message || e}` }
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
