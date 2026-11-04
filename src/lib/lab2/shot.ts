/**
 * ★★ 2026-11-03 用户："给它眼睛" —— 让它自己看自己的成片
 *
 * 为什么需要这个：
 *   人写 CSS → 浏览器渲染 → 眼睛看到糊了 → 改
 *   AI 写 CSS → 输出 → **看不到结果** → 交差
 *   ⇒ 它缺的不是"知识"，是"眼睛"
 *
 * 做法：
 *   生成 HTML 后，用无头 Chromium 截 4 帧（t = 1s / 25% / 50% / 75%）
 *   把截图发回给模型 ⇒ "这是你自己的成片，检查三件事"
 */

import fs from 'node:fs'
import path from 'node:path'
/* ★2026-11-03：静态 import（standalone 打包不包含动态 import 的模块） */
import { chromium } from 'playwright'

export type ShotResult = {
  ok: boolean
  /** 4 张截图的 data URL（给模型看） */
  images: string[]
  /** 截图对应的秒数 */
  times: number[]
  /** 失败原因 */
  error?: string
}

/**
 * 截 4 帧
 * @param html     完整 HTML
 * @param W/H      画布尺寸
 * @param total    总时长（秒）
 */
export async function shotFrames(
  html: string,
  W: number,
  H: number,
  total: number,
): Promise<ShotResult> {
  const tmpDir = path.join(process.cwd(), 'temp', '_lab2', 'shot')
  const tmpFile = path.join(tmpDir, 'shot_' + Date.now() + '.html')
  let browser: { close: () => Promise<void> } | null = null

  /* ★2026-11-03 加日志：定位到底卡在哪一步（跑一次就能看） */
  console.log('[lab2-shot] ① 开始，tmpDir=' + tmpDir)

  try {
    fs.mkdirSync(tmpDir, { recursive: true })
    fs.writeFileSync(tmpFile, html, 'utf8')
    console.log('[lab2-shot] ② 临时文件已写：' + tmpFile + '（' + Math.round(html.length / 1024) + 'KB）')

    /**
     * ★★★ 2026-11-03 服务器报错：
     *   browserType.launch: Executable doesn't exist at
     *   /root/.cache/ms-playwright/chromium_headless_shell-1223/...
     *   ⇒ playwright 装了，但 chromium 二进制没下载
     *
     * 修法：按顺序探测，找到就用
     *   ① CHROMIUM_PATH 环境变量
     *   ② 系统 chromium / chromium-browser / google-chrome / chrome
     *   ③ playwright 自带（npx playwright install chromium 之后才有）
     */
    const candidates: string[] = [
      process.env.CHROMIUM_PATH,
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/snap/bin/chromium',
      '/opt/google/chrome/chrome',
    ].filter(Boolean) as string[]

    /**
     * ★★★ 2026-11-03 服务器实况：
     *   root 用户下没有 chromium，但 **appuser 用户装过**：
     *   /home/appuser/.cache/ms-playwright/chromium_headless_shell-1228/
     *     chrome-headless-shell-linux64/chrome-headless-shell
     *   ⇒ 服务如果是 root 跑的，playwright 按当前用户找 ⇒ 找不到
     *   ⇒ 必须**扫所有用户的 .cache/ms-playwright**
     */
    try {
      const homes: string[] = ['/root', '/home']
      for (const h of homes) {
        if (h === '/home') {
          for (const u of fs.readdirSync('/home')) homes.push('/home/' + u)
          continue
        }
        const pwDir = h + '/.cache/ms-playwright'
        if (!fs.existsSync(pwDir)) continue
        /* ms-playwright 下会有 chromium-XXXX / chromium_headless_shell-XXXX 目录 */
        for (const sub of fs.readdirSync(pwDir)) {
          if (!/^chromium/i.test(sub)) continue
          const base = pwDir + '/' + sub
          /* 常见两种布局 */
          const guesses = [
            base + '/chrome-linux/chrome',
            base + '/chrome-headless-shell-linux64/chrome-headless-shell',
          ]
          for (const g of guesses) {
            try { if (fs.existsSync(g)) candidates.push(g) } catch { /* ignore */ }
          }
          /* 兜底：递归找一层 */
          try {
            for (const sub2 of fs.readdirSync(base)) {
              const g = base + '/' + sub2 + '/chrome-headless-shell'
              if (fs.existsSync(g)) candidates.push(g)
              const g2 = base + '/' + sub2 + '/chrome'
              if (fs.existsSync(g2)) candidates.push(g2)
            }
          } catch { /* ignore */ }
        }
      }
    } catch { /* ignore */ }

    let exe: string | undefined
    for (const c of candidates) {
      try {
        if (c && fs.existsSync(c)) { exe = c; break }
      } catch { /* ignore */ }
    }

    console.log('[lab2-shot] ③ 找到的 chromium：' + (exe || '（用 playwright 默认）'))
    console.log('[lab2-shot] ③ 候选列表：' + candidates.slice(0, 5).join(' | '))

    browser = await chromium.launch({
      executablePath: exe,     /* undefined ⇒ 用 playwright 自带的 */
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    })
    console.log('[lab2-shot] ④ 浏览器已启动')

    const page = await (browser as unknown as {
      newPage: (o: unknown) => Promise<{
        goto: (u: string, o: unknown) => Promise<void>
        evaluate: (fn: unknown, arg?: unknown) => Promise<unknown>
        screenshot: (o: unknown) => Promise<Buffer>
        close: () => Promise<void>
      }>
    }).newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })

    await page.goto('file:///' + tmpFile.replace(/\\/g, '/'), { waitUntil: 'load', timeout: 15000 })
    console.log('[lab2-shot] ⑤ 页面已加载')

    /* 等 __seek 就绪 */
    await page.evaluate(() => new Promise((r) => setTimeout(r, 400)))

    /**
     * ★★★ 2026-11-04 用户实测两个问题：
     *   ① 「固定 4 帧」⇒ 60 秒的片子只截 1/15/30/45s，**末段（58-60s）永远看不到**
     *      实测那段是黑屏（图空 + 没字），自审完全没发现
     *   ② 「seek 后只等 220ms」⇒ 而片子的文字过渡是 transition 0.8s + delay 最多 0.6s
     *      ⇒ 截图时字还没淡入完 ⇒ **自审看到"没字"，但成片其实是有的**
     *      （我自己截图也踩过这个坑，误判过好几单）
     *
     * 现在：
     *   · **按段采样**：每段取中点（避开淡入淡出），段数多少就截多少
     *   · 上限 12 帧（几十段的长片也截得完；均匀抽，但**保证含最后一段**）
     *   · 每帧等 1500ms（覆盖 0.8s transition + 0.6s delay）
     */
    const secs: { start: number; dur: number }[] = []
    html.replace(
      /data-start=["']?([\d.]+)["']?[^>]*data-duration=["']?([\d.]+)/g,
      (_m, a, b) => {
        secs.push({ start: parseFloat(a), dur: parseFloat(b) })
        return _m
      },
    )

    let times: number[]
    if (secs.length) {
      times = secs.map((s) => Math.round((s.start + s.dur * 0.5) * 10) / 10)
    } else {
      /* 解析不到段 ⇒ 退回按总时长均匀取 4 点 */
      const sec = Math.max(1, total || 30)
      times = [0.25, 0.5, 0.75, 0.95].map((v) => Math.round(sec * v * 10) / 10)
    }

    const MAX_FRAMES = 12
    if (times.length > MAX_FRAMES) {
      const lastT = times[times.length - 1]
      const step = times.length / MAX_FRAMES
      const picked: number[] = []
      for (let i = 0; i < MAX_FRAMES; i++) picked.push(times[Math.floor(i * step)])
      picked[picked.length - 1] = lastT        /* ★最后一段必须在内 */
      times = picked
    }

    console.log('[lab2-shot] ⑥ 采样 ' + times.length + ' 帧：' + times.join(' / ') + 's')

    const images: string[] = []
    for (const t of times) {
      await page.evaluate((tt) => {
        try {
          // @ts-expect-error 页面内注入的全局
          window.__lab2Paused = true
          // @ts-expect-error 页面内注入的全局
          if (typeof window.__seek === 'function') window.__seek(tt)
        } catch { /* ignore */ }
      }, t)
      /* 等动效跑完（transition 0.8s + delay 最多 0.6s） */
      await page.evaluate(() => new Promise((r) => setTimeout(r, 1500)))
      const buf = await page.screenshot({ type: 'jpeg', quality: 72 })
      images.push('data:image/jpeg;base64,' + buf.toString('base64'))
    }

    await page.close()
    await browser.close()
    browser = null

    console.log('[lab2-shot] ⑦ 完成，' + images.length + ' 张截图')
    return { ok: true, images, times }
  } catch (e) {
    console.error('[lab2-shot] ❌ 失败：' + String((e as Error)?.message || e))
    console.error('[lab2-shot] ❌ stack：' + String((e as Error)?.stack || '').slice(0, 500))
    try { if (browser) await browser.close() } catch { /* ignore */ }
    return { ok: false, images: [], times: [], error: String((e as Error)?.message || e).slice(0, 160) }
  } finally {
    try { fs.unlinkSync(tmpFile) } catch { /* ignore */ }
  }
}
