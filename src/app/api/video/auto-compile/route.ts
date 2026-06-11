import { NextRequest, NextResponse } from 'next/server'
import { execSync } from 'child_process'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import { startTask, getTask, startSmartTask, getCostEstimate } from '@/lib/video-task-manager'
import { SmartCompileOptions, DEFAULT_SMART_OPTIONS } from '@/lib/smart-compile-engine'

export const dynamic = 'force-dynamic'
const OUT = '/root/AiMarketing/public/generated'
function dir() { if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true }) }

// POST: 创建任务（立即返回 taskId，后台异步执行）
export async function POST(req: NextRequest) {
  try {
    const f = await req.formData()
    const text = (f.get('text') as string) || ''
    const voice = (f.get('voice') as string) || 'zh_female_vv_uranus_bigtts'
    const bgmFile = f.get('bgm') as File | null
    const bgmUrl = (f.get('bgmUrl') as string) || ''
    const mode = (f.get('mode') as string) || 'free'
    const ratio = (f.get('ratio') as string) || '16:9'
    const resolution = (f.get('resolution') as string) || '1080p'
    const subtitleSize = parseInt((f.get('subtitleSize') as string) || '36')
    const duration = parseInt((f.get('duration') as string) || '30')
    const showSubs = (f.get('showSubs') as string) !== 'false'
    const stickerText = (f.get('stickerText') as string) || ''
    const stickerPos = (f.get('stickerPos') as string) || 'tl'
    const titleText = (f.get('titleText') as string) || ''
    const colorFilter = (f.get('colorFilter') as string) || ''
    const subtitleMode = (f.get('subtitleMode') as string) || 'tts-sync'
    const customSrt = (f.get('customSrt') as string) || ''

    if (!text) return NextResponse.json({ success: false, message: '缺少文案' }, { status: 400 })
    dir()
    const taskId = crypto.randomUUID().slice(0, 8)
    const wd = path.join(OUT, taskId)
    fs.mkdirSync(wd, { recursive: true })

    // 收集素材（三种来源）
    const mp: string[] = []
    if (mode === 'smart') {
      // 智能模式：搜索的图片URL
      const urls: string[] = JSON.parse((f.get('imageUrls') as string) || '[]')
      if (!urls.length) return NextResponse.json({ success: false, message: '无图片URL' }, { status: 400 })
      for (let i = 0; i < urls.length; i++) {
        const p = path.join(wd, `i${i}.jpg`)
        execSync(`curl -s -L -o "${p}" "${urls[i]}"`, { timeout: 15000 })
        mp.push(p)
      }
    } else if (mode === 'storage') {
      // 仓库模式：从 storage 仓库选取
      const storageFilesRaw = (f.get('storageFiles') as string) || '[]'
      const storageFiles: Array<{ name: string }> = JSON.parse(storageFilesRaw)
      if (!storageFiles.length) return NextResponse.json({ success: false, message: '未选择仓库文件' }, { status: 400 })
      // 从 OSS 下载选中的文件到本地工作目录
      const { getOSSClient } = await import('@/lib/oss')
      const oss = await getOSSClient()
      // 从 auth 获取 userId（优先 header，其次 query fallback）
      let userId = ''
      try {
        const authHeader = req.headers.get('cookie') || ''
        // 简单提取：实际项目中应使用 getAuthFromHeaders
        const userIdMatch = authHeader.match(/userId=([^;]+)/)
        if (userIdMatch) userId = userIdMatch[1]
      } catch {}
      if (!userId) {
        // 尝试从 formData 中获取
        userId = (f.get('userId') as string) || ''
      }
      for (let i = 0; i < storageFiles.length; i++) {
        const key = `storage/${userId}/${storageFiles[i].name}`
        const ext = storageFiles[i].name.split('.').pop() || 'jpg'
        const p = path.join(wd, `s${i}.${ext}`)
        try {
          const result = await oss.get(key)
          fs.writeFileSync(p, result.content as Buffer)
          mp.push(p)
        } catch (e) {
          console.error(`[素材] 下载失败: ${key}`, (e as Error)?.message)
        }
      }
      if (!mp.length) return NextResponse.json({ success: false, message: '仓库文件下载失败' }, { status: 400 })
    } else {
      // 免费模式：本地上传
      const mf = f.getAll('media') as File[]
      if (!mf.length) return NextResponse.json({ success: false, message: '请上传素材' }, { status: 400 })
      for (let i = 0; i < mf.length; i++) {
        const p = path.join(wd, `m${i}.${mf[i].name.split('.').pop() || 'jpg'}`)
        fs.writeFileSync(p, Buffer.from(await mf[i].arrayBuffer()))
        mp.push(p)
      }
    }

    // BGM
    let bgp = ''
    if (bgmFile) {
      bgp = path.join(wd, 'b.' + (bgmFile.name.split('.').pop() || 'mp3'))
      fs.writeFileSync(bgp, Buffer.from(await bgmFile.arrayBuffer()))
    } else if (bgmUrl) {
      bgp = path.join(wd, 'b.mp3')
      execSync(`curl -s -L -o "${bgp}" "${bgmUrl}"`, { timeout: 15000 })
    }

    // 启动异步任务（根据 smartMode 选择普通或智能引擎）
    const smartModeRaw = (f.get('smartMode') as string) || 'false'
    const smartMode = smartModeRaw === 'true'

    if (smartMode) {
      // ── 智能成片模式 ──
      const transition = (f.get('transition') as string) || DEFAULT_SMART_OPTIONS.transition
      const kenBurns = (f.get('kenBurns') as string) || DEFAULT_SMART_OPTIONS.kenBurns
      const subtitleStyle = (f.get('subtitleStyle') as string) || DEFAULT_SMART_OPTIONS.subtitleStyle

      // 透明贴纸：保存上传的文件到工作目录
      let stickers: any[] = []
      try { stickers = JSON.parse((f.get('stickers') as string) || '[]') } catch {}
      const stickerUploads = f.getAll('stickerUploads') as File[]
      for (let si = 0; si < Math.min(stickerUploads.length, stickers.length); si++) {
        const ext = (stickerUploads[si].name.split('.').pop() || 'png').toLowerCase()
        const sp = path.join(wd, `sticker${si}.${ext}`)
        fs.writeFileSync(sp, Buffer.from(await stickerUploads[si].arrayBuffer()))
        // 更新 src 为实际文件路径
        if (stickers[si]) stickers[si].src = sp
      }

      const smartOptions: SmartCompileOptions = {
        enabled: true,
        transition: transition as any,
        transitionDuration: parseFloat((f.get('transitionDur') as string) || '0.8'),
        kenBurns: kenBurns as any,
        subtitleStyle: subtitleStyle as any,
        stickers,
      }

      startSmartTask(taskId, wd, mp, text, voice, ratio, resolution, subtitleSize, bgp, duration, showSubs, stickerText, stickerPos, titleText, colorFilter, subtitleMode as any, smartOptions, customSrt)
    } else {
      // ── 普通成片模式（原有逻辑不变）──
      startTask(taskId, wd, mp, text, voice, ratio, resolution, subtitleSize, bgp, duration, showSubs, stickerText, stickerPos, titleText, colorFilter, subtitleMode as any, customSrt)
    }

    return NextResponse.json({ success: true, data: { taskId } })
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message })
  }
}

// GET: 查询任务状态 / 费用估算
export async function GET(req: NextRequest) {
  const taskId = req.nextUrl.searchParams.get('taskId')

  // 费算估算接口（不创建任务）
  if (req.nextUrl.searchParams.get('action') === 'cost') {
    const duration = parseInt((req.nextUrl.searchParams.get('duration') as string) || '30') || 30
    const subtitleMode = (req.nextUrl.searchParams.get('subtitleMode') as string) || 'tts-sync'
    const transition = (req.nextUrl.searchParams.get('transition') as string) || 'fade'
    const kenBurns = (req.nextUrl.searchParams.get('kenBurns') as string) || 'zoomin'

    const { DEFAULT_SMART_OPTIONS } = await import('@/lib/smart-compile-engine')
    const cost = getCostEstimate(duration, subtitleMode, {
      ...DEFAULT_SMART_OPTIONS,
      enabled: true,
      transition: transition as any,
      kenBurns: kenBurns as any,
    })
    return NextResponse.json({ success: true, data: cost })
  }

  // 任务状态查询
  if (!taskId) return NextResponse.json({ success: false, message: '缺少taskId' }, { status: 400 })
  const task = getTask(taskId)
  if (!task) return NextResponse.json({ success: false, message: '任务不存在' }, { status: 404 })
  return NextResponse.json({ success: true, data: task })
}
