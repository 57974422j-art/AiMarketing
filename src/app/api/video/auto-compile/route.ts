import { NextRequest, NextResponse } from 'next/server'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import { startTask, getTask, startSmartTask, getCostEstimate } from '@/lib/video-task-manager'
import { SmartCompileOptions, DEFAULT_SMART_OPTIONS } from '@/lib/smart-compile-engine'

/** 根据URL路径猜测文件扩展名（图片/视频） */
function guessExtFromUrl(url: string): string {
  // 先从 URL 路径提取
  const pathname = url.split('?')[0].split('#')[0]
  const ext = pathname.split('.').pop()?.toLowerCase() || ''
  const imageExts = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp']
  const videoExts = ['mp4', 'webm', 'mov', 'avi', 'mkv', 'm4v']
  if (imageExts.includes(ext)) return ext
  if (videoExts.includes(ext)) return ext
  // 默认返回 jpg（大多数搜图结果是图片）
  return 'jpg'
}

/**
 * 安全下载文件到本地
 * @returns { ok: boolean, error?: string } 不再抛异常，由调用方决定是否跳过
 */
async function downloadToFile(url: string, dest: string, retries = 5): Promise<{ ok: boolean; error?: string }> {
  for (let attempt = 0; attempt < retries; attempt++) {
    if (attempt > 0) {
      const delay = Math.min(1000 * Math.pow(2, attempt), 8000) // 2s/4s/8s 退避
      await new Promise(r => setTimeout(r, delay))
    }
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30000)
    try {
      const res = await fetch(url, {
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'image/*,video/*,*/*',
        }
      })
      clearTimeout(timeout)
      if (res.status === 429) {
        // 被限流，等待后重试
        continue
      }
      if (!res.ok) {
        if (attempt < retries - 1) continue
        return { ok: false, error: `HTTP ${res.status}` }
      }
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length < 100) {
        if (attempt < retries - 1) continue
        return { ok: false, error: `文件过小 (${buf.length}B)` }
      }
      fs.writeFileSync(dest, buf)
      return { ok: true }
    } catch (e: any) {
      clearTimeout(timeout)
      if (attempt < retries - 1) continue
      const msg = e.name === 'AbortError' ? '下载超时(30s)' : (e.message || String(e))
      return { ok: false, error: msg }
    }
  }
  return { ok: false, error: '重试耗尽' }
}

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
    const titleStyle = (f.get('titleStyle') as string) || 'popin'
    const titlePos = (f.get('titlePos') as string) || 'center'
    const titleTiming = (f.get('titleTiming') as string) || 'intro'
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
      // 智能模式：网络URL（图片/视频混合）
      const urls: string[] = JSON.parse((f.get('imageUrls') as string) || '[]')
      if (!urls.length) return NextResponse.json({ success: false, message: '无图片/视频URL' }, { status: 400 })
      let failCount = 0
      for (let i = 0; i < urls.length; i++) {
        if (i > 0) await new Promise(r => setTimeout(r, 1200)) // 间隔1.2s防限流
        const ext = guessExtFromUrl(urls[i])
        const p = path.join(wd, `i${i}.${ext}`)
        const result = await downloadToFile(urls[i], p)
        if (result.ok) {
          mp.push(p)
        } else {
          failCount++
          console.warn(`[素材] 下载第${i+1}张失败 (${urls[i].slice(0, 60)}...): ${result.error}`)
        }
      }
      if (mp.length === 0) {
        return NextResponse.json({ success: false, message: `${failCount}个素材全部下载失败，请检查图片/视频链接是否有效` }, { status: 400 })
      }
      if (failCount > 0) {
        console.warn(`[素材] 共${urls.length}个，成功${mp.length}个，失败${failCount}个`)
      }
    } else if (mode === 'storage') {
      // 仓库模式：从 storage 仓库选取
      const storageFilesRaw = (f.get('storageFiles') as string) || '[]'
      const storageFiles: Array<{ name: string }> = JSON.parse(storageFilesRaw)
      if (!storageFiles.length) return NextResponse.json({ success: false, message: '未选择仓库文件' }, { status: 400 })
      // 从 OSS 下载选中的文件到本地工作目录
      const { getOSSClient } = await import('@/lib/oss')
      const oss = await getOSSClient()
      // 从 auth 获取 userId（middleware 已经解析 JWT 并注入 X-User-Id）
      let userId = req.headers.get('X-User-Id') || ''
      if (!userId) {
        // fallback: 尝试从 formData 中获取
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
      // 免费模式：本地上传 + 可选的网络URL混合
      const mf = f.getAll('media') as File[]

      // 处理本地上传文件
      for (let i = 0; i < mf.length; i++) {
        const p = path.join(wd, `m${i}.${mf[i].name.split('.').pop() || 'jpg'}`)
        fs.writeFileSync(p, Buffer.from(await mf[i].arrayBuffer()))
        mp.push(p)
      }

      // 兼容：free 模式也可能附带网络图片/视频URL（素材列表混搭场景）
      const extraUrls: string[] = JSON.parse((f.get('imageUrls') as string) || '[]')
      if (extraUrls.length > 0) {
        let baseIdx = mp.length // 从已有文件数之后继续编号
        for (let i = 0; i < extraUrls.length; i++) {
          const ext = guessExtFromUrl(extraUrls[i])
          const p = path.join(wd, `u${baseIdx + i}.${ext}`)
          const result = await downloadToFile(extraUrls[i], p)
          if (result.ok) {
            mp.push(p)
          } else {
            console.warn(`[素材] free模式附加URL下载失败 (${extraUrls[i].slice(0, 60)}...): ${result.error}`)
          }
        }
      }

      if (mp.length === 0) return NextResponse.json({ success: false, message: '请上传素材或添加图片/视频' }, { status: 400 })
    }

    // BGM
    let bgp = ''
    if (bgmFile) {
      bgp = path.join(wd, 'b.' + (bgmFile.name.split('.').pop() || 'mp3'))
      fs.writeFileSync(bgp, Buffer.from(await bgmFile.arrayBuffer()))
    } else if (bgmUrl) {
      bgp = path.join(wd, 'b.mp3')
      await downloadToFile(bgmUrl, bgp)
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

      startSmartTask(taskId, wd, mp, text, voice, ratio, resolution, subtitleSize, bgp, duration, showSubs, stickerText, stickerPos, titleText, titleStyle as any, titlePos as any, titleTiming as any, colorFilter, subtitleMode as any, smartOptions, customSrt)
    } else {
      // ── 普通成片模式（原有逻辑不变）──
      startTask(taskId, wd, mp, text, voice, ratio, resolution, subtitleSize, bgp, duration, showSubs, stickerText, stickerPos, titleText, titleStyle as any, titlePos as any, titleTiming as any, colorFilter, subtitleMode as any, customSrt)
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
