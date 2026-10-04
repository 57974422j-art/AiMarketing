import { NextRequest, NextResponse } from 'next/server'
import path from 'node:path'
import fs from 'node:fs'
import { getAuthFromHeaders } from '@/lib/api-auth'
import { vfRootDir, vfStorageRoot, vfLog } from '@/lib/agent/video-material'

/**
 * ★VF_DECKPREVIEW_WIRE_V1（2026-10-04 用户定案「接」）——「新引擎成片预览」：
 *   把 AGENT 页出片确认卡上**即将出片的同一份 plan**（sb.plan）交给 **HTML 逐帧引擎**
 *   （scripts/video-factory/html-deck/，10 套皮肤），用 `make-video.mjs` 真出一条**完整成片**
 *   （PPT 动态页 + 配音字幕占位由引擎口径决定）→ 入库 + 签名 URL → 前端直接播放对比。
 *
 * 与 /api/agent/vf/ppt-preview 的关系（同一模板、不同后端）：
 *   · ppt-preview = **老 Python 渲染链**的逐镜 PNG（快、内容全就位、不成片）；
 *   · 本路由   = **新引擎**的真成片 MP4（慢一些、含动效/转场，可直接看投放效果）。
 *
 * ⚠️ 三条硬规矩（照 ppt-preview 原样继承）：
 *   · **不扣点**（这是预览审核，不是出片）—— 本路由绝不调任何计费函数。
 *   · **不让出片依赖它**（make_ai_video 一个字都没改，出片照旧能直接点）。
 *   · 失败一律回一句人话（`成功=false` + `error`），前端原样显示；日志进 vfLog。
 *
 * ⚠️ plan→文案映射（诚实口径 + 实测校准）：plan 的 shot 是「一面卡片」（text + subtitle），
 *   引擎吃的是 markdown，且**内容节每节必须 ≥3 条要点**（gen-deck L180 实测：不足则整节丢弃 ⇒
 *   "一镜一节"必然只剩封面+尾页 ⇒ GEN-TOO-FEW-PAGES）。映射规则（只用 plan 内容，不编造）：
 *     · 第一个 title 镜 → 封面（`# text` + subtitle）
 *     · 其余镜 → 每镜产出一条要点 `- text：subtitle`（截到引擎窗口 ≤28 字），**每 3 镜并成一节**
 *       （节标题 = 该组第一镜的 text）；尾页由引擎自动生成。
 *     · 中间镜 < 3 条 ⇒ 引擎最少要「封面 + 2 内容节 + 尾页」，如实报"分镜太少"而非硬凑。
 *   ⇒ 预览目的是**看新引擎的皮肤/动效/版式效果**，不是逐字复刻老链路的每一镜。
 */
export const dynamic = 'force-dynamic'

/** 皮肤白名单 = masters/ 目录的权威清单（mast-<id>）；不在表内的 id 一律拒绝（防任意参数注入 spawn）。 */
const SKINS = ['ecom', 'editorial', 'edu', 'festive', 'formal', 'health', 'mono', 'tech', 'v1', 'v2'] as const
const ORIS = ['9:16', '16:9'] as const
const MAX_SECTIONS = 10         // 每节 3 镜 ⇒ 最多消费 30 镜（渲染时长可控）
const BULLET_MAX = 28           // 引擎要点窗口上限（gen-deck W.iBullets，实测 L192 同窗）
const TIMEOUT_MS = 420000       // 新引擎真渲染（页面多时 1~3 分钟级），给足余量

export async function POST(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, error: '未认证' }, { status: 401 })
  const uid = String(auth.userId)

  // ① 取 plan + 预览参数（皮肤/方向；白名单校验）
  let plan: any = null
  let skin = 'v1'
  let ori: string = '9:16'
  try {
    const body = await request.json()
    plan = body?.plan
    if (typeof plan === 'string') plan = JSON.parse(plan)
    if (typeof body?.skin === 'string' && (SKINS as readonly string[]).includes(body.skin)) skin = body.skin
    if (typeof body?.orientation === 'string' && (ORIS as readonly string[]).includes(body.orientation)) ori = body.orientation
  } catch { plan = null }
  if (!plan || typeof plan !== 'object' || !Array.isArray(plan.shots) || !plan.shots.length) {
    return NextResponse.json({ success: false, error: '预览生成失败：没有可预览的分镜（plan 为空）' })
  }

  // ② plan.shots → copy.md（映射规则见文件头；每 3 镜一节；不足则如实报错）
  const shots: any[] = plan.shots
  const bulletOf = (s: any): string => {
    const text = String(s?.text || '').trim()
    const sub = String(s?.subtitle || '').trim()
    let b = text && sub && text !== sub ? `${text}：${sub}` : (text || sub)
    if (b.length > BULLET_MAX) b = b.slice(0, BULLET_MAX - 1) + '…'
    return b.length >= 6 ? b : ''          // 引擎要点窗口下限 6 字 ⇒ 太短的镜如实跳过
  }
  const mid = shots.slice(1).map(bulletOf).filter(Boolean)
  if (mid.length < 6) {                    // 引擎最少要 封面 + 2 内容节（每节 3 条）+ 尾页
    return NextResponse.json({ success: false, error: `预览生成失败：分镜可用的文字太少（可用要点 ${mid.length} 条，新引擎至少需要 6 条 ≈ 6 镜）` })
  }
  const lines: string[] = []
  const first = shots.find((s) => String(s?.text || '').trim() || String(s?.subtitle || '').trim())
  const coverText = String(first?.text || '').trim() || '预览'
  const coverSub = String(first?.subtitle || '').trim()
  lines.push(`# ${coverText}`, coverSub, '')
  let used = 0
  for (let i = 0; i + 3 <= mid.length && used < MAX_SECTIONS; i += 3, used++) {
    const grp = mid.slice(i, i + 3)
    lines.push(`## ${grp[0].split('：')[0].slice(0, 12)}`, ...grp.map((b) => `- ${b}`), '')
  }

  const { spawn } = await import('child_process')
  const engDir = path.join(vfRootDir() || '', 'scripts', 'video-factory', 'html-deck')
  const mkP = path.join(engDir, 'make-video.mjs')
  if (!fs.existsSync(mkP)) {
    return NextResponse.json({ success: false, error: '预览生成失败：服务端缺少 html-deck 引擎（scripts/video-factory/html-deck 未部署）' })
  }

  const dir = path.join(vfStorageRoot(), uid, 'video-factory', 'deckpreview_' + Date.now())
  try {
    fs.mkdirSync(dir, { recursive: true })
    const mdP = path.join(dir, 'copy.md')
    const od = path.join(dir, 'out')
    fs.mkdirSync(od, { recursive: true })
    fs.writeFileSync(mdP, lines.filter((l) => l !== '').join('\n') + '\n', 'utf8')

    // ③ spawn 新引擎（cwd=引擎目录；日志收尾，超时 kill —— 形状照 ppt-preview）
    const args = [mkP, '--in', mdP, '--skins', skin, '--orientations', ori, '--outdir', od]
    let logTail = ''
    const code: number | null = await new Promise((resolve) => {
      try {
        const ch = spawn(process.execPath, args, { windowsHide: true, cwd: engDir })
        let so = ''
        const push = (d: any) => { so = (so + String(d)).slice(-8000) }
        ch.stdout.on('data', push)
        ch.stderr.on('data', push)
        const t = setTimeout(() => { try { ch.kill() } catch { /* ignore */ } logTail = so; resolve(-2) }, TIMEOUT_MS)
        ch.on('close', (c: number | null) => { clearTimeout(t); logTail = so; resolve(c) })
        ch.on('error', (e: any) => { clearTimeout(t); logTail = 'spawn error: ' + String(e?.message || e); resolve(-1) })
      } catch (e: any) { logTail = String(e?.message || e); resolve(-1) }
    })

    if (code !== 0) {
      const reason = code === -2 ? `渲染超时（>${Math.round(TIMEOUT_MS / 1000)} 秒）`
        : code === -1 ? `无法启动 node（${process.execPath}）`
          : `make-video.mjs 退出码 ${code}`
      vfLog(uid, `[新引擎预览] 失败：${reason}\n${String(logTail).split('\n').slice(-12).join('\n')}`)
      return NextResponse.json({ success: false, error: `预览生成失败：${reason}` })
    }

    // ④ 找产物（新目录里全树找 MP4；本路由只请求 1 皮肤 × 1 方向 ⇒ 恰好 1 条；不是 1 条 = 不许猜）
    const mp4s: string[] = []
    const walk = (d: string) => {
      for (const it of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, it.name)
        if (it.isDirectory()) walk(p)
        else if (it.name.toLowerCase().endsWith('.mp4')) mp4s.push(p)
      }
    }
    walk(od)
    if (mp4s.length !== 1) {
      vfLog(uid, `[新引擎预览] 产物数异常：${mp4s.length} 条 MP4（应恰好 1）`)
      return NextResponse.json({ success: false, error: `预览生成失败：产物数异常（${mp4s.length} 条 MP4，应恰好 1）` })
    }
    const stat = fs.statSync(mp4s[0])
    if (!stat.size) {
      return NextResponse.json({ success: false, error: '预览生成失败：产物 MP4 为空（0 字节）' })
    }

    // ⑤ 入库 + 签名 URL（与 ppt-preview / 成片入库同一套 helper）
    const { readFile } = await import('fs/promises')
    const { saveToPersonalRepo } = await import('@/lib/personal-storage')
    const { signedUrl } = await import('@/lib/oss')
    const buf = await readFile(mp4s[0])
    const { name } = await saveToPersonalRepo({ userId: uid, buffer: buf, ext: 'mp4', mime: 'video/mp4', quotaCheck: false })
    const url = await signedUrl(`storage/${uid}/${name}`, 86400)

    // 报告侧读回页数/时长（不信任内存变量 —— 读引擎自己写的 make-report.json）
    let pages = used + 2, durS = 0     // 引擎自动加封面 + 尾页（gen-deck L254/L271）
    try {
      const rep = JSON.parse(fs.readFileSync(path.join(od, 'make-report.json'), 'utf8'))
      const row = (rep.rows || [])[0] || {}
      if (row.dur) durS = Number(row.dur) || 0
    } catch { /* 报告缺失不阻塞预览（MP4 已验证存在且非空） */ }

    vfLog(uid, `[新引擎预览] 成功：skin=${skin} ${ori} · ${pages} 页 · ${Math.round(stat.size / 1024 / 1024 * 10) / 10}MB${durS ? ` · ${durS}s` : ''}`)
    return NextResponse.json({
      success: true, url, skin, orientation: ori, pages,
      sizeMB: Math.round(stat.size / 1024 / 1024 * 10) / 10, dur: durS,
      truncated: shots.length > 1 + used * 3 ? `分镜 ${shots.length} 镜，预览取前 ${1 + used * 3} 镜（上限 ${MAX_SECTIONS} 节 × 3 镜）` : '',
    })
  } catch (e: any) {
    vfLog(uid, '[新引擎预览] 异常：' + String(e?.message || e).slice(0, 200))
    return NextResponse.json({ success: false, error: '预览生成失败：' + String(e?.message || e).slice(0, 160) })
  } finally {
    // 临时目录清理（MP4 已入仓库；失败也清，避免堆积）
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
  }
}
