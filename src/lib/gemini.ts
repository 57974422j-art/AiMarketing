/**
 * Gemini 客户端 — 支持直连/中转代理
 * 
 * 直连: GEMINI_BASE_URL=https://generativelanguage.googleapis.com/v1beta
 * 中转: GEMINI_BASE_URL=https://bboluo.com/v1  (OpenAI 兼容)
 * 模型: [L]gemini-3-flash-preview  [L]gemini-3.1-pro-preview
 */

interface GeminiOptions {
  model?: string
  temperature?: number
  maxTokens?: number
  responseMimeType?: string
  googleSearch?: boolean // grounding
}

const DEFAULT_MODEL = 'gemini-2.5-flash'

function getGeminiConfig() {
  const key = process.env.GEMINI_API_KEY
  const baseUrl = process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta'
  return { key, baseUrl }
}

/** 判断是否为 OpenAI 兼容中转（/v1 结尾） */
function isOpenAIProxy(url: string): boolean {
  return url.endsWith('/v1') || url.includes('/v1/')
}

/** OpenAI 兼容中转调用 */
async function callOpenAIProxy(prompt: string, opts: GeminiOptions = {}): Promise<string> {
  const { key, baseUrl } = getGeminiConfig()
  const model = opts.model || DEFAULT_MODEL

  const messages: any[] = [{ role: 'user', content: prompt }]
  if (opts.googleSearch) {
    // 给模型加上搜索提示
    messages.unshift({ role: 'system', content: 'You have access to Google Search. Use current real data. Return JSON if requested.' })
  }

  const body: any = {
    model,
    messages,
    temperature: opts.temperature ?? 0.7,
  }
  if (opts.maxTokens) body.max_tokens = opts.maxTokens
  if (opts.responseMimeType === 'application/json') {
    body.response_format = { type: 'json_object' }
  }

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Gemini proxy ${res.status}: ${text.substring(0, 200)}`)
  }
  const data = await res.json()
  return { text: data.choices?.[0]?.message?.content || '', raw: data }
}

/** Google 原生 API 调用 */
async function callGoogleNative(prompt: string, opts: GeminiOptions = {}): Promise<string> {
  const { key, baseUrl } = getGeminiConfig()
  const model = opts.model || DEFAULT_MODEL

  const contents = [{ parts: [{ text: prompt }], role: 'user' }]
  const tools = opts.googleSearch ? [{ google_search: {} }] : undefined

  const body: any = { contents }
  if (tools) body.tools = tools
  if (opts.responseMimeType) {
    body.generationConfig = {
      ...body.generationConfig,
      responseMimeType: opts.responseMimeType,
    }
  }

  const res = await fetch(`${baseUrl}/models/${model}:generateContent?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Gemini native ${res.status}: ${text.substring(0, 200)}`)
  }
  const data = await res.json()
  return { text: data.candidates?.[0]?.content?.parts?.[0]?.text || '', raw: data }
}

/** 主入口 — 自动选择调用方式 */
export async function gemini(prompt: string, opts: GeminiOptions = {}): Promise<string> {
  const { key, baseUrl } = getGeminiConfig()
  if (!key) throw new Error('GEMINI_API_KEY 未配置')

  if (isOpenAIProxy(baseUrl)) {
    console.log('[Gemini] 使用 OpenAI 兼容中转:', baseUrl.substring(0, 30))
    return (await callOpenAIProxy(prompt, opts)).text
  }
  console.log('[Gemini] 使用 Google 原生 API')
  return (await callGoogleNative(prompt, opts)).text
}

export interface GroundingSource {
  uri: string
  title: string
}

/**
 * 从模型原始响应中深度扫描真实 grounding 来源（真实 URL/标题）。
 * 兼容：Google 原生 groundingMetadata.groundingChunks[].web，
 *       以及 OpenAI 兼容代理的 annotations.url_citation / 任意 web.{uri,title}。
 */
function extractGroundingSources(raw: any): GroundingSource[] {
  const out: GroundingSource[] = []
  const seen = new Set<string>()
  const push = (uri?: string, title?: string) => {
    if (uri && !seen.has(uri)) { seen.add(uri); out.push({ uri, title: title || uri }) }
  }
  const walk = (o: any) => {
    if (!o || typeof o !== 'object') return
    if (Array.isArray(o)) { o.forEach(walk); return }
    if (o.web && (o.web.uri || o.web.url)) push(o.web.uri || o.web.url, o.web.title)
    if (o.url_citation && o.url_citation.url) push(o.url_citation.url, o.url_citation.title)
    if (o.groundingMetadata) {
      (o.groundingMetadata.groundingChunks || []).forEach((c: any) => c?.web && push(c.web.uri, c.web.title))
    }
    for (const k of Object.keys(o)) walk(o[k])
  }
  walk(raw)
  return out
}

/** 同 gemini()，但额外返回 search grounding 真实来源 */
export async function geminiWithGrounding(prompt: string, opts: GeminiOptions = {}): Promise<{ text: string; grounding: GroundingSource[] }> {
  const { key, baseUrl } = getGeminiConfig()
  if (!key) throw new Error('GEMINI_API_KEY 未配置')
  const r = isOpenAIProxy(baseUrl)
    ? await callOpenAIProxy(prompt, opts)
    : await callGoogleNative(prompt, opts)
  return { text: r.text, grounding: extractGroundingSources(r.raw) }
}

/** JSON 结构化返回 */
export async function geminiJSON<T = any>(prompt: string, opts: GeminiOptions = {}): Promise<T> {
  const text = await gemini(prompt, { ...opts, responseMimeType: 'application/json' })
  const clean = text.replace(/```json/g, '').replace(/```/g, '').trim()
  return JSON.parse(clean) as T
}

// ====== 趋势猎手专用函数 ======

export interface TrendingItem {
  id: string
  title: string
  platform: string
  hotness: number
  url: string
  image: string
  description: string
  category?: string
  aiComment?: string
  viralFactors?: string[]
  imageUrl?: string
}

export async function searchTrends(keyword: string, platforms: string[], count = 8): Promise<TrendingItem[]> {
  const safeCount = Math.min(Math.max(Number(count) || 8, 1), 20)
  const prompt = `Search for the most trending and viral content/videos related to "${keyword}" on these platforms: ${platforms.join(", ")}.
Focus on the last 24-48 hours. Return a list of approximately ${safeCount} items.
For each item, provide: title, platform, hotness (0-100), a descriptive URL, a high-quality placeholder image URL (related to the topic), and a short description.
Use your search tools to find REAL current information and REAL source URLs. Do NOT make up fake data.
Return the result as a JSON array with fields: title, platform, hotness, url, image, description.`

  const { text, grounding } = await geminiWithGrounding(prompt, { googleSearch: true, model: '[L]gemini-3-flash-preview' })
  const clean = text.replace(/```json/g, '').replace(/```/g, '').trim()
  const results = JSON.parse(clean) as any[]

  console.log(`[TrendVideo] 真实 grounding 来源数: ${grounding.length}`)
  return results.map((item: any, i: number) => {
    const g = grounding.length ? grounding[i % grounding.length] : null
    return {
      ...item,
      id: `trend_${Date.now()}_${i}`,
      title: g?.title || item.title,
      url: g?.uri || item.url,
      imageUrl: item.imageUrl || item.image,
    }
  })
}

export async function analyzeTrends(items: TrendingItem[]): Promise<TrendingItem[]> {
  const prompt = `Analyze the following viral trends and provide:
1. Smart classification (e.g., Tech, Entertainment, News).
2. Viral factor analysis (Why is this trending?).
3. A catchy AI recommendation/summary (1 sentence).

Input Data: ${JSON.stringify(items.map(i => ({ title: i.title, description: i.description })))}

Return the original items updated with these new fields: category, aiComment, viralFactors (array of strings).
Return as a JSON array.`

  const analysis = await geminiJSON<any[]>(prompt, { model: '[L]gemini-3-flash-preview' || 'gemini-2.5-flash' })
  return items.map((item, i) => ({
    ...item,
    ...analysis[i],
  }))
}

export async function extractVideoInsights(item: TrendingItem): Promise<{ summary: string; script: string; pptStructure: any[] }> {
  const prompt = `你是一个专业的短视频分析专家。针对这个热门内容 "${item.title}" (${item.description})，请完成：
1. 总结其爆款逻辑（200字以内）。
2. 提炼核心文案/脚本。
3. 生成5页PPT提纲（标题、要点，每页不超过3条）。
返回JSON格式: { "summary": "...", "script": "...", "pptStructure": [{"title":"","content":[""]}] }`

  return geminiJSON(prompt, { model: '[L]gemini-3-flash-preview' || 'gemini-2.5-flash' })
}
