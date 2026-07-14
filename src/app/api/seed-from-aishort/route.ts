import { NextRequest, NextResponse } from 'next/server'
import { getAuthFromHeaders } from '@/lib/api-auth'
import Database from 'better-sqlite3'
import { join } from 'path'

export const runtime = 'nodejs'

// ChatGPT-Shortcut 标签 → PromptTemplate 分类映射
const TAG_MAP: Record<string, string> = {
  write: '品牌宣传',
  article: '品牌宣传',
  company: '品牌宣传',
  seo: '品牌宣传',
  speech: '品牌宣传',
  professional: '品牌宣传',
  text: '文案模板',
  ai: '通用工具',
  tool: '通用工具',
}

const USEFUL_TAGS = Object.keys(TAG_MAP)

interface AIShortPrompt {
  zh?: { title?: string; prompt?: string; description?: string }
  en?: { prompt?: string }
  tags?: string[]
}

export async function POST(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth || auth.role !== 'admin') {
      return NextResponse.json({ success: false, message: '需要管理员权限' }, { status: 403 })
    }

    const CDN = 'https://cdn.jsdelivr.net/gh/rockbenben/ChatGPT-Shortcut@main/src/data/prompt.json'

    console.log('[AIShort] 开始拉取数据...')
    const res = await fetch(CDN, { signal: AbortSignal.timeout(30000) })
    if (!res.ok) return NextResponse.json({ success: false, message: `CDN返回 ${res.status}` }, { status: 502 })
    const all: AIShortPrompt[] = await res.json()
    console.log(`[AIShort] 总共 ${all.length} 条`)

    // 过滤 + 去重
    const seen = new Set<string>()
    const filtered: { title: string; prompt: string; category: string }[] = []

    for (const item of all) {
      const tags = item.tags || []
      const match = tags.find(t => USEFUL_TAGS.includes(t))
      if (!match) continue

      const title = item.zh?.title || ''
      const prompt = item.zh?.prompt || item.en?.prompt || ''
      if (!prompt || prompt.length < 20) continue

      const key = prompt.substring(0, 80)
      if (seen.has(key)) continue
      seen.add(key)

      filtered.push({
        title: title.substring(0, 200),
        prompt: prompt.substring(0, 2000),
        category: TAG_MAP[match],
      })
    }

    console.log(`[AIShort] 过滤后 ${filtered.length} 条: 品牌宣传/文案模板/通用工具`)

    // 写入 SQLite
    const db = new Database(join(process.cwd(), 'prisma', 'dev.db'))
    // 确保表存在
    db.exec(`CREATE TABLE IF NOT EXISTS PromptTemplate (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      prompt TEXT NOT NULL,
      category TEXT,
      previewUrl TEXT,
      isActive INTEGER DEFAULT 1,
      createdAt TEXT DEFAULT (datetime('now')),
      updatedAt TEXT
    )`)

    let inserted = 0
    let skipped = 0
    const insert = db.prepare(
      `INSERT INTO PromptTemplate (title, prompt, category, isActive, createdAt)
       VALUES (?, ?, ?, 1, datetime('now'))`
    )
    const check = db.prepare(`SELECT id FROM PromptTemplate WHERE prompt LIKE ? LIMIT 1`)

    for (const item of filtered) {
      const existing = check.get(item.prompt.substring(0, 100) + '%')
      if (existing) { skipped++; continue }
      insert.run(item.title, item.prompt, item.category)
      inserted++
    }

    db.close()
    console.log(`[AIShort] 写入完成: 新增${inserted}条, 跳过${skipped}条`)

    return NextResponse.json({
      success: true,
      message: `从 AiShort 导入完成：共 ${filtered.length} 条匹配，新增 ${inserted} 条（跳过 ${skipped} 条重复）`,
      data: { total: all.length, filtered: filtered.length, inserted, skipped },
    })
  } catch (error: any) {
    console.error('[AIShort] 导入失败:', error)
    return NextResponse.json({ success: false, message: error.message || '导入失败' }, { status: 500 })
  }
}
