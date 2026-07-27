import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { tmpdir } from 'os'
import { getAuthFromCookie } from '@/lib/api-auth'
import { getObject, putObject } from '@/lib/oss'
import { runFFmpeg, runFFprobe } from '@/lib/ffmpeg'
import { agnesChat } from '@/lib/ai-providers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const VIDEO_RE = /\.(mp4|mov|avi|mkv|webm)$/i

/**
 * AI 看片智能填充：从视频抽关键帧 → 多模态模型理解 → 返回标题/正文/话题 + 自动封面
 * body: { videoName: string, mode?: 'frame' | 'full' }
 *   frame（默认）= 抽 4 张关键帧；full = 抽 9 张更密帧
 * 返回: { success, title, description, topics, coverImage }
 */
export async function POST(request: NextRequest) {
  const auth = getAuthFromCookie(request)
  if (!auth) {
    return NextResponse.json({ success: false, message: '未登录' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const videoName = String(body.videoName || '').trim()
  const mode: 'frame' | 'full' = body.mode === 'full' ? 'full' : 'frame'

  if (!videoName || !VIDEO_RE.test(videoName)) {
    return NextResponse.json({ success: false, message: '请提供有效的视频文件名' }, { status: 400 })
  }

  const uid = String(auth.userId)
  const key = `storage/${uid}/${videoName}`

  // 1. 取视频字节
  let videoBuf: Buffer
  try {
    videoBuf = await getObject(key)
  } catch (e: any) {
    return NextResponse.json({ success: false, message: '视频读取失败：' + (e?.message || '') }, { status: 404 })
  }

  const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  const tmpIn = path.join(tmpdir(), `analyze_${stamp}_in.mp4`)
  fs.writeFileSync(tmpIn, videoBuf)

  const frameCount = mode === 'full' ? 9 : 4
  const framePaths: string[] = []

  try {
    // 2. 取时长
    let duration = 0
    try {
      const d = await runFFprobe(`-v error -show_entries format=duration -of default=nokey=1:noprint_wrappers=1 "${tmpIn}"`)
      duration = parseFloat(d) || 0
    } catch { duration = 0 }

    // 3. 抽 N 张均匀帧
    if (duration > 1) {
      const outArgs: string[] = []
      for (let i = 1; i <= frameCount; i++) {
        const t = (duration * i / (frameCount + 1)).toFixed(2)
        const out = path.join(tmpdir(), `analyze_${stamp}_f${i}.jpg`)
        framePaths.push(out)
        outArgs.push(`-ss ${t} -vframes 1 -q:v 3 "${out}"`)
      }
      await runFFmpeg(`-y -i "${tmpIn}" ${outArgs.join(' ')}`, { timeout: 60000, threads: 1 })
    } else {
      for (let i = 1; i <= frameCount; i++) {
        const t = (i * 0.5).toFixed(2)
        const out = path.join(tmpdir(), `analyze_${stamp}_f${i}.jpg`)
        framePaths.push(out)
        await runFFmpeg(`-y -i "${tmpIn}" -ss ${t} -vframes 1 -q:v 3 "${out}"`, { timeout: 30000 })
      }
    }

    // 4. 读帧为 base64 喂给 Agnes 多模态
    const images = framePaths
      .filter(p => { try { return fs.existsSync(p) && fs.statSync(p).size > 0 } catch { return false } })
      .map(p => `data:image/jpeg;base64,${fs.readFileSync(p).toString('base64')}`)

    if (images.length === 0) {
      throw new Error('未提取到任何有效帧')
    }

    const sysPrompt = `你是一个资深短视频内容运营专家。用户会给你一部视频的若干关键帧截图（按时间顺序）。请理解视频的画面主体、氛围、卖点与故事线，并产出适合在抖音/小红书/视频号等平台发布的文案。要求：
- title：吸睛标题，≤20字，带情绪或悬念钩子
- description：正文文案，80-200字，口语化、有开头钩子与行动号召
- topics：3-6个话题标签（不带#号，纯词）
必须且只能输出一个 JSON 对象，不要任何解释、不要 Markdown 代码块。格式：
{"title":"...","description":"...","topics":["...","..."]}`

    const userContent: any[] = [
      { type: 'text', text: `这是视频的 ${images.length} 张关键帧（按时间顺序），请据此生成标题、正文和话题标签。` },
      ...images.map(u => ({ type: 'image_url', image_url: { url: u } })),
    ]

    const res = await agnesChat([
      { role: 'system', content: sysPrompt },
      { role: 'user', content: userContent },
    ], [], 'agnes-2.5-flash', 1200)

    let parsed: any = {}
    const raw = res.content || ''
    try {
      parsed = JSON.parse(raw.replace(/```json|```/g, '').trim())
    } catch {
      const m = raw.match(/\{[\s\S]*\}/)
      if (m) { try { parsed = JSON.parse(m[0]) } catch {} }
    }

    const title = String(parsed.title || '').slice(0, 50)
    const description = String(parsed.description || '').slice(0, 1000)
    const topics = Array.isArray(parsed.topics)
      ? parsed.topics.map((x: any) => String(x)).filter(Boolean).slice(0, 10)
      : []

    // 5. 选中间帧作封面，上传到个人仓库 .thumbs/analyze/
    const coverIdx = Math.floor(images.length / 2)
    const coverBuf = fs.readFileSync(framePaths[coverIdx])
    const coverName = `.thumbs/analyze/${videoName.replace(VIDEO_RE, '')}_ai_cover.jpg`
    await putObject(`storage/${uid}/${coverName}`, coverBuf, 'image/jpeg')

    return NextResponse.json({
      success: true,
      title,
      description,
      topics,
      coverImage: `/api/storage/file?userId=${uid}&name=${encodeURIComponent(coverName)}`,
    })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: 'AI 分析失败：' + (e?.message || '') }, { status: 500 })
  } finally {
    try { fs.unlinkSync(tmpIn) } catch {}
    for (const p of framePaths) { try { fs.unlinkSync(p) } catch {} }
  }
}
