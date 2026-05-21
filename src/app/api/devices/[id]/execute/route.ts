import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'
import * as Douyin from '@/lib/douyin-automation'
import * as UI from '@/lib/uiautomator-driver'
import { ADB } from '@/lib/adb-helper'

// 单例 Prisma
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }
const prisma = globalForPrisma.prisma || new PrismaClient()
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

// 平台 → 包名映射
const APP_PACKAGES: Record<string, { pkg: string; act: string }> = {
  douyin: { pkg: 'com.ss.android.ugc.aweme', act: '.main.MainActivity' },
  kuaishou: { pkg: 'com.smile.gifmaker', act: '.MainActivity' },
  xiaohongshu: { pkg: 'com.xingin.xhs', act: '.activity.SplashActivity' },
  shipinhao: { pkg: 'com.tencent.mm', act: '.ui.LauncherUI' }, // 修正：视频号在微信内
  weibo: { pkg: 'com.sina.weibo', act: '.SplashActivity' },
  bilibili: { pkg: 'tv.danmaku.bili', act: '.MainActivityV2' },
}

const abortMap = new Map<number, AbortController>()

// ── ADB 或 HTTP shell ──
async function shell(port: number, adbPort: number): Promise<ADB | null> {
  if (ADB.isAvailable()) {
    const adb = new ADB(adbPort)
    adb.connect()
    return adb
  }
  return null
}

// ── 页面检测 ──
async function detectPage(port: number): Promise<string> {
  const screen = await UI.extractScreenData(port)
  if (!screen.success) return 'unknown'
  const texts = (screen.data as any)?.texts || []

  // 阻断型弹窗处理（青少年模式/升级提示）
  const dismissTexts = ['我知道了', '青少年模式', '取消', '以后再说', '暂不升级', '忽略']
  for (const dt of dismissTexts) {
    if (texts.some((t: string) => t.includes(dt))) {
      await UI.findAndClick(port, dt)
      await UI.sleep(1000)
    }
  }

  if (texts.some((t: string) => t.includes('首页') || t === '推荐')) return 'feed'
  if (texts.some((t: string) => t.includes('搜索热点') || t.includes('大家都在搜') || t.includes('历史搜索'))) return 'search_page'
  if (texts.some((t: string) => t.includes('直播'))) return 'live'
  if (texts.some((t: string) => t === '消息')) return 'messages'
  if (texts.some((t: string) => t.includes('我') && texts.some((tt: string) => tt.includes('获赞')))) return 'profile'
  return 'unknown'
}

async function navigateTo(port: number, target: string, retry = 3): Promise<boolean> {
  for (let i = 0; i < retry; i++) {
    const page = await detectPage(port)
    if (page === target) return true
    if (i === retry - 1) return false
    await UI.goBack(port)
    await UI.sleep(1500)
  }
  return false
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const deviceId = parseInt(id)
  const running = abortMap.has(deviceId)
  return NextResponse.json({ success: true, data: { deviceId, running } })
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ac = new AbortController()
  const signal = ac.signal
  const { id } = await params
  const deviceId = parseInt(id)

  try {
    const auth = getAuthFromHeaders(request)
    if (!auth || auth.role === 'end-user') {
      return NextResponse.json({ success: false, message: '无权操作' }, { status: 403 })
    }

    const body = await request.json()
    const { platform, actions, keyword, keywords } = body
    if (!deviceId || !platform || !actions?.length) {
      return NextResponse.json({ success: false, message: '缺少参数' }, { status: 400 })
    }

    const searchKeyword = keyword || (Array.isArray(keywords) && keywords.length > 0 ? keywords[0] : '热门')

    const device = await prisma.device.findUnique({ where: { id: deviceId } })
    if (!device) return NextResponse.json({ success: false, message: '设备不存在' }, { status: 404 })
    const port = device.apiPort
    const adbPort = device.adbPort
    if (!port) return NextResponse.json({ success: false, message: '设备未配置端口' }, { status: 400 })

    const results: { action: string; success: boolean; message: string }[] = []
    const log = (action: string, success: boolean, message: string) => {
      if (!signal.aborted) results.push({ action, success, message })
    }
    const checkAbort = () => { if (signal.aborted) throw new Error('已停止') }

    // 初始化 ADB（如果可用）
    const adb = adbPort ? await shell(port, adbPort) : null
    log('adb', !!adb, adb ? 'ADB 直连模式' : 'HTTP shell 模式（ADB 未安装）')

    // 注册中止
    const prev = abortMap.get(deviceId)
    if (prev) prev.abort()
    abortMap.set(deviceId, ac)

    // 1. 打开对应 App（冷启动）
    const app = APP_PACKAGES[platform]
    if (app) {
      // 先强制杀死，冷启动
      if (adb) {
        adb.forceStop(app.pkg)
      } else {
        await fetch(`http://127.0.0.1:${port}/shell`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command: `am force-stop ${app.pkg}` }),
        })
      }
      await UI.sleep(1500)

      // 启动
      if (adb) {
        adb.openApp(app.pkg, app.act)
      } else {
        await UI.openApp(port, app.pkg, app.act)
      }
      await UI.sleep(12000 + Math.random() * 3000)
      checkAbort()
      log('openApp', true, `${platform} 已启动`)

      // 刷 2 条视频
      for (let i = 1; i <= 2; i++) {
        checkAbort()
        await UI.sleep(4000 + Math.random() * 3000)
        if (adb) {
          adb.scrollUp(500) // 500ms 快速上滑
        } else {
          await UI.scrollUp(port)
        }
        log('browse', true, `浏览第 ${i} 条视频`)
      }
    }

    await UI.sleep(3000)
    log('pause', true, '准备开始执行任务')

    // 2. 执行动作
    let criticalFail = false
    for (const action of actions) {
      checkAbort()
      if (criticalFail) { log(action, false, '前序动作失败已跳过'); continue }

      try {
        let r: any
        switch (action) {
          case 'search': {
            const onFeed = await navigateTo(port, 'feed')
            if (!onFeed) { r = { success: false, message: '无法回到首页' }; break }

            r = await UI.findAndClick(port, '搜索')
            if (!r.success && adb) {
              adb.tap(950, 120) // 备用：点右上角搜索
            }
            await UI.sleep(3000)

            // 搜索页 → 输入关键词
            const screen = await UI.extractScreenData(port)
            const inputFields = (screen.data as any)?.inputFields || []

            if (inputFields.length > 0) {
              const bounds = inputFields[0].bounds
              const cx = bounds.x + bounds.width / 2
              const cy = bounds.y + bounds.height / 2
              await UI.tap(port, cx, cy)
              await UI.sleep(2000) // 等键盘完全弹出

              // 全选 + 删除旧内容
              const sendCmd = async (cmd: string) => {
                if (adb) { adb.keyEvent(cmd) }
                else {
                  await fetch(`http://127.0.0.1:${port}/shell`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ command }),
                  })
                }
              }
              await sendCmd('KEYCODE_A')
              await UI.sleep(300)
              await sendCmd('KEYCODE_DEL')
              await UI.sleep(500)

              // 输入关键词
              log('input', true, `正在输入"${searchKeyword}"...`)
              const inputOk = adb ? adb.inputText(searchKeyword).success : (await UI.inputText(port, searchKeyword)).success
              await UI.sleep(2000)

              // 验证：再 dump 一次，看输入框是否有内容
              const verify = await UI.extractScreenData(port)
              const verifyTexts = (verify.data as any)?.texts || []
              const hasKeyword = verifyTexts.some((t: string) => t.includes(searchKeyword.slice(0, 2)))
              if (!hasKeyword && !inputOk) {
                // ADB 输入失败，降级用 input 命令
                log('input', false, 'ADB 输入失败，降级...')
                await sendCmd(`text "${searchKeyword}"`)
                await UI.sleep(2000)
              }

              // 回车搜索
              await sendCmd('KEYCODE_ENTER')
              await UI.sleep(1000)
              await sendCmd('KEYCODE_SEARCH')
              await UI.sleep(4000)
              r = { success: true, message: `已搜索"${searchKeyword}"` }
            } else {
              r = await UI.tapAndInput(port, '搜索', searchKeyword)
              await UI.sleep(1500)
              if (adb) adb.keyEvent('KEYCODE_SEARCH')
              await UI.sleep(3000)
            }
            break
          }

          case 'like': { r = await Douyin.like(port); break }
          case 'comment': { r = await Douyin.comment(port, '不错'); break }
          case 'follow': { r = await Douyin.follow(port); break }
          case 'share': { r = await Douyin.shareVideo(port); break }
          case 'dm': { r = await Douyin.sendDirectMessage(port, '用户', '你好'); break }
          case 'extract': { r = await Douyin.extractVideoInfo(port); break }
          case 'comments': { r = await Douyin.extractComments(port); break }
          case 'publish': { r = await Douyin.publishVideo(port, { title: '自动发布' }); break }
          default: { log(action, false, `未知动作: ${action}`); continue }
        }
        log(action, r.success, r.message || (r.success ? '成功' : '失败'))
        if (!r.success) criticalFail = true
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
      success: false, message: msg,
      data: msg === '已停止' ? { stopped: true } : undefined,
    }, { status: msg === '已停止' ? 200 : 500 })
  } finally {
    abortMap.delete(deviceId)
    // 注意：不在 finally 中 $disconnect()，防止并发断开其他请求的连接
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const deviceId = parseInt(id)
  const ac = abortMap.get(deviceId)
  if (ac) { ac.abort(); abortMap.delete(deviceId) }
  return NextResponse.json({ success: true, message: '已发送停止信号' })
}
