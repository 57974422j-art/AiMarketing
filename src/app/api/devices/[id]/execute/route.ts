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

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth || auth.role === 'end-user') return NextResponse.json({ success: false, message: '无权操作' }, { status: 403 })

    const { id } = await params
    const deviceId = parseInt(id)
    const body = await request.json()
    const { accountId, platform, actions, keyword } = body

    if (!deviceId || !platform || !actions?.length) {
      return NextResponse.json({ success: false, message: '缺少参数' }, { status: 400 })
    }

    const device = await prisma.device.findUnique({ where: { id: deviceId } })
    if (!device) return NextResponse.json({ success: false, message: '设备不存在' }, { status: 404 })
    const port = device.apiPort
    if (!port) return NextResponse.json({ success: false, message: '设备未配置端口' }, { status: 400 })

    const results: { action: string; success: boolean; message: string }[] = []
    const log = (action: string, success: boolean, message: string) => results.push({ action, success, message })

    // 1. 打开对应 App
    const app = APP_PACKAGES[platform]
    if (app) {
      const r = await UI.openApp(port, app.pkg, app.act)
      await UI.sleep(5000)
      log('openApp', r.success, r.success ? `${platform} 已启动` : `启动失败: ${r.message}`)
    }

    // 2. 逐个执行动作
    for (const action of actions) {
      try {
        let r: any
        switch (action) {
          case 'search': {
            const kw = keyword || '热门'
            r = await Douyin.search(port, kw)
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
      } catch (e) {
        log(action, false, `异常: ${e instanceof Error ? e.message : '未知错误'}`)
      }
      await new Promise(r => setTimeout(r, 3000 + Math.random() * 5000))
    }

    return NextResponse.json({ success: true, data: { deviceId, platform, results } })
  } catch (e) {
    console.error('执行错误:', e)
    return NextResponse.json({ success: false, message: '执行失败' }, { status: 500 })
  } finally { await prisma.$disconnect() }
}
