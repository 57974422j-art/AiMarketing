import { NextRequest, NextResponse } from 'next/server'
import path from 'node:path'
import fs from 'node:fs'
import { getAuthFromHeaders } from '@/lib/api-auth'
import { vfRootDir, vfStorageRoot, vfLog } from '@/lib/agent/video-material'

/**
 * ★VF_PPTPREVIEW_WIRE_V1（2026-10-01 用户定案）「完全成片之前能把 PPT 抽出来审核一下效果吗？」
 *
 * 老板原话就是这一句。渲染层已交付 `render.py --ppt-preview`：
 *   每镜出一张"内容全就位"的 PNG（p01.png…）+ index.json（键：i/file/type/variant/t/text/subtitle），
 *   **复用出片同一条渲染链**（不渲整段视频、不烧字幕、不烧顶部固定标题、很快）。
 *
 * 本路由 = 那条能力的**接线**（出片确认卡上的「👀 先看 PPT 页」按钮 → 这里）：
 *   ① 客户端把**即将出片的那份 plan** 传进来（= 卡片里的 `sb.plan`，与 make_ai_video 用的是
 *      **同一个 buildVideoPlan 产物** —— 绝不在这里另拼一份，否则预览与成片会漂移）；
 *   ② 原样写进临时目录 → spawn 与出片**同款**的 python 调用方式（BU_PYTHON /
 *      windowsHide / spawn 收 stdout 尾日志 / 超时 kill，照 chat/route.ts 的 preview_video_shot）；
 *   ③ 每张 PNG 走**现成的**「存文件 + 签名 URL」helper（saveToPersonalRepo + signedUrl，
 *      与样板镜 / 成片入库完全同一套）；失败会让整条请求如实报错，**绝不静默**；
 *   ④ 返回签名 URL 列表 + index.json 摘要（镜号/类型/实际生效的 variant）。
 *
 * ⚠️ 三条硬规矩：
 *   · **不扣点**（这是审核，不是出片）—— 本路由绝不调任何计费函数。
 *   · **不让出片依赖它**（`make_ai_video` 一个字都没改，出片照旧能直接点）。
 *   · 失败一律回一句人话（`成功=false` + `error: 预览生成失败：<原因>`），前端原样显示。
 */
export const dynamic = 'force-dynamic'

const PY_TIMEOUT_MS = 180000

export async function POST(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, error: '未认证' }, { status: 401 })
  const uid = String(auth.userId)

  // ① 取 plan（客户端给的 sb.plan；字符串 / 对象都收）
  let plan: any = null
  try {
    const body = await request.json()
    plan = body?.plan
    if (typeof plan === 'string') plan = JSON.parse(plan)
  } catch { plan = null }
  if (!plan || typeof plan !== 'object' || !Array.isArray(plan.shots) || !plan.shots.length) {
    return NextResponse.json({ success: false, error: '预览生成失败：没有可预览的分镜（plan 为空）' })
  }

  // ② 找 render.py（多候选向上找，与出片同一函数）
  const { spawn } = await import('child_process')
  const renderP = path.join(vfRootDir() || '', 'scripts', 'video-factory', 'render.py')
  if (!fs.existsSync(renderP)) {
    return NextResponse.json({ success: false, error: '预览生成失败：服务端缺少 render.py（视频工厂未部署）' })
  }

  const dir = path.join(vfStorageRoot(), uid, 'video-factory', 'pptpreview_' + Date.now())
  try {
    fs.mkdirSync(dir, { recursive: true })
    const sbP = path.join(dir, 'plan.json')
    const od = path.join(dir, 'out')
    fs.mkdirSync(od, { recursive: true })
    // 即将出片的那份 plan —— **原样**落盘（不裁剪、不另拼字段）
    fs.writeFileSync(sbP, JSON.stringify(plan), 'utf8')

    const py = process.env.BU_PYTHON || (process.platform === 'win32' ? 'python' : 'python3')
    const args = [renderP, '--storyboard', sbP, '--ppt-preview', '--outdir', od]
    let logTail = ''
    const code: number | null = await new Promise((resolve) => {
      try {
        const ch = spawn(py, args, { windowsHide: true })
        let so = ''
        const push = (d: any) => { so = (so + String(d)).slice(-8000) }
        ch.stdout.on('data', push)
        ch.stderr.on('data', push)
        const t = setTimeout(() => { try { ch.kill() } catch { /* ignore */ } logTail = so; resolve(-2) }, PY_TIMEOUT_MS)
        ch.on('close', (c: number | null) => { clearTimeout(t); logTail = so; resolve(c) })
        ch.on('error', (e: any) => { clearTimeout(t); logTail = 'spawn error: ' + String(e?.message || e); resolve(-1) })
      } catch (e: any) { logTail = String(e?.message || e); resolve(-1) }
    })

    if (code !== 0) {
      const reason = code === -2 ? `渲染超时（>${Math.round(PY_TIMEOUT_MS / 1000)} 秒）`
        : code === -1 ? `无法启动 python（${py}，可设环境变量 BU_PYTHON 指定解释器）`
          : `render.py 退出码 ${code}`
      vfLog(uid, `[PPT预览] 失败：${reason}\n${String(logTail).split('\n').slice(-12).join('\n')}`)
      return NextResponse.json({ success: false, error: `预览生成失败：${reason}` })
    }

    const idxP = path.join(od, 'index.json')
    if (!fs.existsSync(idxP)) {
      return NextResponse.json({ success: false, error: '预览生成失败：render.py 未产出 index.json' })
    }
    let idx: any[] = []
    try { idx = JSON.parse(fs.readFileSync(idxP, 'utf8')) } catch { idx = [] }

    // ③ 逐张入库 + 签名 URL（与样板镜 / 成片入库同一套 helper）
    const { readFile } = await import('fs/promises')
    const { saveToPersonalRepo } = await import('@/lib/personal-storage')
    const { signedUrl } = await import('@/lib/oss')
    const images: any[] = []
    for (const it of (Array.isArray(idx) ? idx : [])) {
      const f = String(it?.file || '')
      if (!f) continue
      const p = path.join(od, path.basename(f))   // basename 防路径穿越
      if (!fs.existsSync(p)) continue
      try {
        const buf = await readFile(p)
        // quotaCheck=false：审核用的小 PNG 不该被"仓库已满"挡掉（与数字人入库同一做法）
        const { name } = await saveToPersonalRepo({ userId: uid, buffer: buf, ext: 'png', mime: 'image/png', quotaCheck: false })
        const url = await signedUrl(`storage/${uid}/${name}`, 86400)
        images.push({
          i: it.i, file: it.file, type: it.type, variant: it.variant, t: it.t,
          text: it.text, subtitle: it.subtitle, url,
        })
      } catch (e: any) {
        vfLog(uid, '[PPT预览] 某张入库失败：' + String(e?.message || e).slice(0, 120))
      }
    }
    if (!images.length) {
      return NextResponse.json({ success: false, error: '预览生成失败：没有产出可用的图片' })
    }
    vfLog(uid, `[PPT预览] 成功：${images.length} 张（plan 根级 style=${String(plan.style || '（未指定）')} / deck_style=${String(plan.deck_style || '')}）`)
    return NextResponse.json({ success: true, count: images.length, images })
  } catch (e: any) {
    vfLog(uid, '[PPT预览] 异常：' + String(e?.message || e).slice(0, 200))
    return NextResponse.json({ success: false, error: '预览生成失败：' + String(e?.message || e).slice(0, 160) })
  } finally {
    // 临时目录清理（PNG 已入仓库；失败也清，避免堆积）
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
  }
}
