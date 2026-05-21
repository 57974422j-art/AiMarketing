import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'
import * as Douyin from '@/lib/douyin-automation'
import * as UI from '@/lib/uiautomator-driver'

const prisma = new PrismaClient()

// 平台 → 包名映射
const APP_PACKAGES: Record<string, { pkg: string; act: string }> = {
  douyin: { pkg: 'com.ss.android.ugc.aweme', act: '.main.MainActivity' },
  kuaishou: { pkg: 'com.smile.gifmaker', act: '.MainActivity' },
  xiaohongshu: { pkg: 'com.xingin.xhs', act: '.activity.SplashActivity' },
  shipinhao: { pkg: 'com.tencent.channels', act: '.ui.SplashActivity' },
  weibo: { pkg: 'com.sina.weibo', act: '.SplashActivity' },
  bilibili: { pkg: 'tv.danmaku.bili', act: '.MainActivityV2' },
}

// 全局中止信号
const abortMap = new Map<number, AbortController>()

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const deviceId = parseInt(id)
  // 查询执行状态
  const running = abortMap.has(deviceId)
  return NextResponse.json({ success: true, data: { deviceId, running } })
}

/** POST 执行 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ac = new AbortController()
  const signal = ac.signal
  const { id } = await params
  const deviceId = parseInt(id)

  try {
    const auth = getAuthFromHeaders(request)
    if (!auth || auth.role === 'end-user') return NextResponse.json({ success: false, message: '无权操作' }, { status: 403 })

    const body = await request.json()
    const { platform, actions, keyword, keywords } = body
    if (!deviceId || !platform || !actions?.length) {
      return NextResponse.json({ success: false, message: '缺少参数' }, { status: 400 })
    }

    const searchKeyword = keyword || (Array.isArray(keywords) && keywords.length > 0 ? keywords[0] : '热门')

    const device = await prisma.device.findUnique({ where: { id: deviceId } })
    if (!device) return NextResponse.json({ success: false, message: '设备不存在' }, { status: 404 })
    const port = device.apiPort
    if (!port) return NextResponse.json({ success: false, message: '设备未配置端口' }, { status: 400 })

    // 注册中止信号
    const prev = abortMap.get(deviceId)
    if (prev) prev.abort() // 中止之前的任务
    abortMap.set(deviceId, ac)

    const results: { action: string; success: boolean; message: string }[] = []
    const log = (action: string, success: boolean, message: string) => {
      if (!signal.aborted) results.push({ action, success, message })
    }
    const checkAbort = () => { if (signal.aborted) throw new Error('已停止') }

    // 1. 打开对应 App
    const app = APP_PACKAGES[platform]
    if (app) {
      const r = await UI.openApp(port, app.pkg, app.act)
      await UI.sleep(10000 + Math.random() * 3000) // 10-13 秒等开屏
      checkAbort()
      log('openApp', r.success, r.success ? `${platform} 已启动` : `启动失败: ${r.message}`)

      // 刷 2 条视频（模拟真人）
      if (r.success) {
        for (let i = 1; i <= 2; i++) {
          checkAbort()
          await UI.sleep(4000 + Math.random() * 3000) // 浏览 4-7 秒
          await UI.scrollUp(port)                      // 上滑下一条
          log('browse', true, `浏览第 ${i} 条视频`)
        }
      }
    } else {
      log('openApp', true, `未知平台 ${platform}，跳过打开`)
    }

    // 2. 逐个执行动作（失败即停）
    let criticalFail = false
    for (const action of actions) {
      checkAbort()
      if (criticalFail) { log(action, false, '前序动作失败已跳过'); continue }

      try {
        let r: any
        switch (action) {
          case 'search': {
            // 点底部"搜索"Tab
            await UI.tap(port, 540, 1850)
            await UI.sleep(2000)
            // 点顶部的搜索输入框区域
            await UI.tap(port, 540, 120)
            await UI.sleep(1000)
            // 输入关键词
            r = await UI.inputText(port, searchKeyword)
            await UI.sleep(1000)
            // 键盘搜索
            await UI.execShell(port, 'input keyevent KEYCODE_SEARCH')
            await UI.sleep(1000)
            await UI.tap(port, 540, 400)
            await UI.sleep(3000)
            r = { success: true, message: `已搜索"${searchKeyword}"` }
            break
          }
          case 'like': {
            r = await Douyin.like(port)
            break
          }
          case 'comment': {
            r = await Douyin.comment(port, '不错')
            break
          }
          case 'follow': {
            r = await Douyin.follow(port)
            break
          }
          case 'share': {
            r = await Douyin.shareVideo(port)
            break
          }
          case 'dm': {
            r = await Douyin.sendDirectMessage(port, '用户', '你好')
            break
          }
          case 'extract': {
            r = await Douyin.extractVideoInfo(port)
            break
          }
          case 'comments': {
            r = await Douyin.extractComments(port)
            break
          }
          case 'publish': {
            r = await Douyin.publishVideo(port, { title: '自动发布' })
            break
          }
          default: {
            log(action, false, `未知动作: ${action}`)
            continue
          }
        }
        log(action, r.success, r.message || (r.success ? '成功' : '失败'))
        if (!r.success) criticalFail = true // 失败后跳过后续
      } catch (e) {
        const msg = e instanceof Error ? e.message : '未知错误'
        if (msg !== '已停止') { log(action, false, `异常: ${msg}`); criticalFail = true }
      }
      await new Promise(r => setTimeout(r, 3000 + Math.random() * 5000))
      checkAbort()
    }

    return NextResponse.json({ success: true, data: { deviceId, platform, results } })
  } catch (e) {
    const msg = e instanceof Error ? e.message : '未知错误'
    return NextResponse.json({
      success: msg === '已停止' ? false : false,
      message: msg,
      data: msg === '已停止' ? { stopped: true } : undefined,
    }, { status: msg === '已停止' ? 200 : 500 })
  } finally {
    abortMap.delete(deviceId)
    await prisma.$disconnect()
  }
}

// GET /api/devices/[id]/execute?action=stop
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const deviceId = parseInt(id)
  const ac = abortMap.get(deviceId)
  if (ac) { ac.abort(); abortMap.delete(deviceId) }
  return NextResponse.json({ success: true, message: '已发送停止信号' })
}
