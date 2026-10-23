import { NextRequest, NextResponse } from 'next/server'
import { getAuthFromHeaders } from '@/lib/api-auth'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'

/**
 * 配音稿弹窗里「看一眼这一帧」
 *
 * ★VF_DAILY_FRAME_V1（2026-10-23 用户定案：第四步的弹窗里要有这段的画面，
 *   编辑要"看着画面"才能判断文案怎么改）
 *
 * 做三件事：
 *   ① 从个人仓库（OSS）取出那份产物 HTML（`gen_xxx.html`）
 *   ② 用 daily-film.mjs 打包成 hyperframes 项目目录
 *   ③ 用 `hyperframes snapshot --at <t>` 抽**一帧** PNG，base64 返回
 *
 * ⚠️ 为什么慢（8~12 秒）：要真的起一次浏览器渲染。前端要显示"加载画面…"。
 * ⚠️ 只读：**不改任何文件**（临时目录用完就删）。
 *
 * POST { name: 'gen_xxx.html', t: 8.5 }
 * => { success, data: { image: 'data:image/png;base64,...', t } }
 */
export const maxDuration = 120
export const dynamic = 'force-dynamic'

const run = (cmd: string, args: string[], timeout = 120000) => new Promise<{ code: number; out: string }>((resolve) => {
  execFile(cmd, args, { timeout, maxBuffer: 8 * 1024 * 1024 }, (err, so, se) => {
    resolve({ code: err ? 1 : 0, out: String(so || '') + '\n' + String(se || '') })
  })
})

export async function POST(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })

  let body: any = {}
  try { body = await request.json() } catch { /* ignore */ }
  const name = String(body?.name || '').trim()
  /* 优先用「段号 seg」（1-based）—— 配音卡上只有段号，没有每段起点时间；
     接口自己从 HTML 的 data-start/data-duration 算该段中点。也兼容直接给 t。 */
  const seg = Number(body?.seg)
  let t = Number(body?.t)
  if (!name || !/^[\w.-]+\.html?$/i.test(name)) {
    return NextResponse.json({ success: false, message: '缺少产物名（gen_xxx.html）' }, { status: 400 })
  }
  if (!Number.isFinite(t) && !(Number.isFinite(seg) && seg >= 1)) {
    return NextResponse.json({ success: false, message: '缺少段号 seg（第几段）或时间点 t' }, { status: 400 })
  }

  const uid = String((auth as any)?.userId || (auth as any)?.uid || '')
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dailyframe-'))
  try {
    // ① 取 HTML（个人仓库）
    const { getObject } = await import('@/lib/oss')
    let html = ''
    try {
      const buf = await getObject('storage/' + uid + '/' + name)
      html = String(buf.toString('utf8') || '')
    } catch (e: any) {
      return NextResponse.json({ success: false, message: '取不到产物：' + String(e?.message || e).slice(0, 100) }, { status: 404 })
    }
    if (!/<\/html>/i.test(html)) {
      return NextResponse.json({ success: false, message: '产物不是完整 HTML' }, { status: 422 })
    }

    /* 没给 t 就给段号 ⇒ 从 HTML 里读第 seg 段的 data-start/data-duration，取中点。
       为什么取中点：段首通常是入场动画（还没显示完），段中点才是"这一段稳定长什么样"。 */
    if (!Number.isFinite(t)) {
      const secs = [...html.matchAll(/<section\b[^>]*\bclass="[^"]*\bsec\b[^>]*>/gi)]
      const tag = secs[Math.max(0, Math.min(secs.length - 1, Math.floor(seg) - 1))]?.[0] || ''
      const st = Number((/data-start="([\d.]+)"/.exec(tag) || [])[1] || 0)
      const du = Number((/data-duration="([\d.]+)"/.exec(tag) || [])[1] || 3)
      if (!secs.length) {
        return NextResponse.json({ success: false, message: '页面里没有 .sec 分段，抽不了帧' }, { status: 422 })
      }
      t = st + Math.max(0.2, du * 0.55)
    }

    const srcHtml = path.join(tmpRoot, name)
    fs.writeFileSync(srcHtml, html, 'utf8')

    /* ★ 必须走 `vfRootDir()`，**绝不能** `process.cwd()`（2026-10-14 已在 daily-film.ts 里踩过一次）：
       standalone 模式下 `process.cwd()` 是 `.next/standalone` ⇒ 拼出来的引擎路径不存在
       ⇒ 用户实测弹窗里报「引擎不完整（缺 daily-film.mjs 或 hyperframes）」。 */
    const { vfRootDir } = await import('@/lib/agent/video-material')
    const deckRoot = path.join(vfRootDir() || process.cwd(), 'scripts', 'video-factory', 'html-deck')
    const filmTool = path.join(deckRoot, 'tools', 'daily-film.mjs')
    const hfEntry = path.join(deckRoot, 'node_modules', 'hyperframes', 'bin', 'hyperframes.mjs')
    if (!fs.existsSync(filmTool) || !fs.existsSync(hfEntry)) {
      return NextResponse.json({ success: false, message: '引擎不完整（缺 daily-film.mjs 或 hyperframes）' }, { status: 500 })
    }

    // ② 打包（生成 hyperframes 项目目录；--check-only 只打包不渲染）
    const packDir = path.join(tmpRoot, 'packed')
    const pack = await run(process.execPath, [filmTool, srcHtml, '--outdir', packDir, '--check-only'], 150000)
    if (!fs.existsSync(path.join(packDir, 'hyperframes.json'))) {
      const tail = pack.out.split('\n').filter((l) => l.trim()).slice(-5).join(' | ')
      return NextResponse.json({ success: false, message: '打包失败：' + tail.slice(0, 300) }, { status: 422 })
    }

    // ③ 抽一帧
    const shotDir = path.join(tmpRoot, 'shot')
    fs.mkdirSync(shotDir, { recursive: true })
    const snap = await run(process.execPath, [
      hfEntry, 'snapshot', packDir,
      '--at', String(t), '--no-end',
      '-o', shotDir,
      '--timeout', '20000',
      '--no-browser-gpu',
    ], 150000)

    const png = fs.readdirSync(shotDir).find((f) => /^frame-\d+-at-[\d.]+s\.png$/i.test(f))
    if (!png) {
      const tail = snap.out.split('\n').filter((l) => l.trim()).slice(-5).join(' | ')
      return NextResponse.json({ success: false, message: '抽帧失败：' + tail.slice(0, 300) }, { status: 502 })
    }
    const buf = fs.readFileSync(path.join(shotDir, png))
    return NextResponse.json({
      success: true,
      data: { image: 'data:image/png;base64,' + buf.toString('base64'), t, bytes: buf.length },
    })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: '抽帧出错：' + String(e?.message || e).slice(0, 140) }, { status: 500 })
  } finally {
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }) } catch { /* ignore */ }
  }
}
