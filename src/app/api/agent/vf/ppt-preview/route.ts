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

    // ★VF_PPTPAGE_PREVIEW_V1（2026-10-07 用户实测「**不还是老样子吗？**」）：
    //   **新线的预览也必须走新引擎换页**，否则"看到的"和"出片后的"永远不一致。
    //   为什么之前不一致：这个「👀 先看 PPT 页」是老引擎**逐镜静帧**（卡型名 bgimage / title·deck / duo / end
    //   都是老引擎的），而新线的换页发生在**出片那一刻**（make.py 里）⇒ 预览永远显示老画法，
    //   用户拿预览判断"换没换"，必然得出"还是老样子"。
    //   实现与本线出片**同一把尺子**：先调 `ppt-pages.mjs` 把纯文字镜换成新引擎整页，再拿结果去逐镜渲。
    //   ⚠️ **只对带 plan 根级 `pptpage` 的线生效**（= 新线「PPT+图视」自己写的键）；老线没有该键 ⇒ 预览照旧。
    //   ⚠️ 换页 deck 走的是与出片**同一个缓存目录**（按内容 hash）⇒ 出过片的那条，预览是秒级；没出过则要等一次渲染。
    let sbForRender = sbP
    // ★VF_PPTBADGE_V1 补丁②（2026-10-07 用户质问「这里写的怎么明显，你都还是分不清吗？」）：
    //   把"本线换了几页 / 没换的为什么"**带回给卡片**。改前界面只给结论（"0 页新引擎"）不给依据，
    //   用户看不出"是新线本该换却没换"还是"这条线本来就不换" —— 我也只能靠日志猜。现在原样回传。
    let swapInfo: any = {
      on: false,
      swapped: 0,
      total: Array.isArray(plan?.shots) ? plan.shots.length : 0,
      skips: [] as any[],
    }
    const _ppRoot = (plan as any)?.pptpage
    if (_ppRoot && typeof _ppRoot === 'object') {
      swapInfo.on = true
      swapInfo.master = String((_ppRoot as any).master || '')
      swapInfo.palette = String((_ppRoot as any).palette || '')
      try {
        const scriptP = path.join(vfRootDir() || '', 'scripts', 'video-factory', 'ppt-pages.mjs')
        if (fs.existsSync(scriptP)) {
          const outP = path.join(dir, 'plan.pptpage.json')
          const argsP = [scriptP, '--storyboard', sbP, '--out', outP,
            '--outdir', path.join(vfRootDir() || '', 'scripts', 'video-factory', 'html-deck', 'out', 'pptpage')]
          if (String((_ppRoot as any).master || '').trim()) argsP.push('--master', String((_ppRoot as any).master).trim())
          if (String((_ppRoot as any).palette || '').trim()) argsP.push('--palette', String((_ppRoot as any).palette).trim())
          if ((_ppRoot as any).mix === false) argsP.push('--no-mix')
          const nodeB = process.env.BU_NODE || 'node'
          await new Promise<void>((resolve) => {
            try {
              const ch = spawn(nodeB, argsP, { windowsHide: true })
              let so = ''
              ch.stdout.on('data', (d: any) => { so = (so + String(d)).slice(-4000) })
              ch.stderr.on('data', (d: any) => { so = (so + String(d)).slice(-4000) })
              const t = setTimeout(() => { try { ch.kill() } catch { /* ignore */ } resolve() }, 15 * 60 * 1000)
              ch.on('close', () => {
                clearTimeout(t)
                // ★VF_SKIPWHY_V1（2026-10-07）：脚本每镜都会打印 `第 N 镜（卡型）不换页：<具体原因>`，
                //   这里整条捞出来回给卡片 —— 用户要能分辨"哪几页没换、为什么"，命令行日志他看不到。
                try {
                  const _so = String(so || '')
                  // ★VF_DECKRESIL_V1 配套：整批失败会自动**降级重试一次**（摘掉素材 image 页）⇒
                  //   stdout 里会有**两轮**逐镜日志，直接全捞会把同一镜的两条原因混在一起（用户已实测到）。
                  //   这里只取**最后一轮**（= 真正决定了本次预览的那一轮），并标记"已重试"。
                  const _mark = '★VF_DECKRESIL_V1'
                  const _mix = _so.lastIndexOf(_mark)
                  if (_mix >= 0) swapInfo.retried = true
                  const _scope = _mix >= 0 ? _so.slice(_mix) : _so
                  const _re = /\[PPT-PAGE\]\s*第\s*(\d+)\s*镜(?:（([^）]*)）)?\s*不换页：([^\n\r]*)/g
                  const _sk: any[] = []
                  let _m: RegExpExecArray | null
                  while ((_m = _re.exec(_scope)) !== null && _sk.length < 12) {
                    _sk.push({ i: Number(_m[1]), type: String(_m[2] || ''), why: String(_m[3] || '').trim().slice(0, 90) })
                  }
                  swapInfo.skips = _sk
                  // ★VF_PPTPAGE_CAP_V1：把"因**页数上限**被砍的镜"单独回传（改前它一声不吭 ⇒
                  //   用户看到"24/36"完全不知道为什么，会以为还是内容不合窗口）。
                  const _m2 = _scope.match(/★VF_PPTPAGE_CAP[^\n]*上限\s*(\d+)[^\n]*?第\s*([\d、,，\s]+)镜/)
                  if (_m2) {
                    swapInfo.capLimit = Number(_m2[1]) || 0
                    swapInfo.capped = String(_m2[2]).split(/[、,，\s]+/).map((x) => Number(x)).filter((x) => x > 0)
                  }
                } catch { /* ignore */ }
                if (fs.existsSync(outP)) {
                  sbForRender = outP
                  try {
                    const _j = JSON.parse(fs.readFileSync(outP, 'utf8'))
                    swapInfo.swapped = Number(_j?.pptpage?.swapped || 0)
                    swapInfo.pages = Number(_j?.pptpage?.pages || 0)
                  } catch { /* ignore */ }
                  vfLog(uid, `[PPT预览] 新线换页成功 → 预览改用 storyboard.pptpage.json（换 ${swapInfo.swapped}/${swapInfo.total} 镜）`)
                } else {
                  swapInfo.note = String(so).split('\n').filter(Boolean).slice(-1)[0] || ''
                  vfLog(uid, '[PPT预览] 换页未生效 → 预览回落老画法：' + swapInfo.note)
                }
                resolve()
              })
              ch.on('error', () => { clearTimeout(t); resolve() })
            } catch { resolve() }
          })
        }
      } catch (e: any) {
        vfLog(uid, '[PPT预览] 换页异常（忽略，预览回落老画法）：' + String(e?.message || e).slice(0, 140))
      }
    }

    const py = process.env.BU_PYTHON || (process.platform === 'win32' ? 'python' : 'python3')
    const args = [renderP, '--storyboard', sbForRender, '--ppt-preview', '--outdir', od]
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
          // ★VF_PPTBADGE_V1 补丁（2026-10-07 用户实测「共 7 页（其中 0 页 = 新引擎整页）」）：
          //   改前这里是**白名单式重建**（逐字段列举）—— 我在 render.py 的 index.json 里写了 `pptpage`，
          //   却忘了在这个对象里带出去 ⇒ 前端永远读到 undefined ⇒ 标签与统计**永远显示 0 页**（用户当场撞上）。
          //   现在改成**展开索引项 + 覆盖 url**：以后 render.py 往索引里加任何字段都自动透传，
          //   不会再因为"忘了在这里加一行"而静默丢字段。
          ...it,
          url,
          pptpage: it.pptpage === true,
        })
      } catch (e: any) {
        vfLog(uid, '[PPT预览] 某张入库失败：' + String(e?.message || e).slice(0, 120))
      }
    }
    if (!images.length) {
      return NextResponse.json({ success: false, error: '预览生成失败：没有产出可用的图片' })
    }
    vfLog(uid, `[PPT预览] 成功：${images.length} 张（plan 根级 style=${String(plan.style || '（未指定）')} / deck_style=${String(plan.deck_style || '')}）`)
    return NextResponse.json({ success: true, count: images.length, images, swap: swapInfo })
  } catch (e: any) {
    vfLog(uid, '[PPT预览] 异常：' + String(e?.message || e).slice(0, 200))
    return NextResponse.json({ success: false, error: '预览生成失败：' + String(e?.message || e).slice(0, 160) })
  } finally {
    // 临时目录清理（PNG 已入仓库；失败也清，避免堆积）
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
  }
}
