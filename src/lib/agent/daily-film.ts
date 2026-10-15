/**
 * ★VF_DAILYFILM_V2（**服务端接入** · 2026-10-14 用户定案「先做1」）—— 「日报落地页 → 视频」的异步任务。
 * =============================================================================
 * 为什么必须异步：出片一次 **~125s**（13 段 / 41.8s 的片），而客户端 AI 接口超时是 **120s**
 *   ⇒ 同步走完必然超时。所以照仓库既有的「任务文件 + 状态接口 + 前端轮询」范式做
 *   （同 `make_ai_video`：`vf<ts>.json` + `/api/agent/make-video-status`）——
 *   本文件用 **`df<ts>.json`**（独立前缀，与成片线的 `vf*` 互不干扰），配 `/api/agent/daily-film-status`。
 *
 * 任务文件：`<vfStorageRoot()>/<uid>/video-factory/df<ts>.json`
 *   `{ id, status: running|done|failed, startedAt, finishedAt, htmlName, repoName, url, tail[], error }`
 *
 * ⚠️ 出片本身**不在 src 里实现**：调命令行工具 `tools/daily-film.mjs`
 *   （打包 → 用字闸门 → 引擎校验 → `hyperframes render`）。`src` 只做三件事：
 *   "从仓库取回单文件版 HTML → 起进程 → 收产物入库 + 签名直链"。
 *   为什么不复用 HTML成片线：两条线的"页"是两套结构，复用会吃掉日报版式（详见 EXECUTION_LOG 2026-10-14）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
// ★VF_ROOT_V1 口径：`vfRootDir()` = 项目根（standalone 下 cwd 是 .next/standalone，拼 cwd 会指到残缺的 scripts/）
import { vfRootDir, vfStorageRoot } from './video-material'
import { saveToPersonalRepo } from '@/lib/personal-storage'

export interface DailyFilmTask {
  id: string
  status: 'running' | 'done' | 'failed'
  startedAt: string
  finishedAt?: string
  /** 出片用的**单文件版** HTML 在个人仓库里的文件名（配图版不支持出片） */
  htmlName: string
  /** 成片入库后的仓库文件名 */
  repoName?: string
  /** 24h 签名直链（给 `<video src>` 用） */
  url?: string
  /** ★VF_DAILYVOICE_V2：这一单是**带配音（+字幕）**的吗（前端完成卡据此换文案） */
  voiced?: boolean
  /** 最后若干行输出（排障用，与成片线的 vf*.json 同口径） */
  tail: string[]
  error?: string
}

function taskDir(uid: number | string): string {
  return path.join(vfStorageRoot(), String(uid), 'video-factory')
}
export function dailyFilmTaskPath(uid: number | string, id: string): string {
  return path.join(taskDir(uid), id + '.json')
}

function writeTask(uid: number | string, t: DailyFilmTask): void {
  try {
    fs.mkdirSync(taskDir(uid), { recursive: true })
    fs.writeFileSync(dailyFilmTaskPath(uid, t.id), JSON.stringify(t, null, 2), 'utf8')
  } catch {
    // 落盘失败也要让流程继续（内存里的 t 仍会被本次 catch 收尾）；查不到任务由调用方如实报
  }
}

export function readDailyFilmTask(uid: number | string, id: string): DailyFilmTask | null {
  try {
    const p = dailyFilmTaskPath(uid, id)
    if (!fs.existsSync(p)) return null
    return JSON.parse(fs.readFileSync(p, 'utf8')) as DailyFilmTask
  } catch {
    return null
  }
}

/** 该用户**正在跑**的出片任务（防重复点：同一个人同时只允许一个） */
export function findRunningDailyFilm(uid: number | string): DailyFilmTask | null {
  try {
    const dir = taskDir(uid)
    if (!fs.existsSync(dir)) return null
    const files = fs.readdirSync(dir).filter((f) => /^df\d+\.json$/.test(f)).sort().reverse().slice(0, 5)
    for (const f of files) {
      const t = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as DailyFilmTask
      if (t && t.status === 'running') return t
    }
  } catch {
    // 读不动就当没有
  }
  return null
}

/** 跑子进程、收集输出（异步，不阻塞事件循环；超时强杀） */
function runTool(cmd: string, args: string[], timeoutMs: number): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const t0 = Date.now()
    let out = ''
    const p = spawn(cmd, args, { cwd: process.cwd(), env: process.env })
    const timer = setTimeout(() => { try { p.kill('SIGKILL') } catch { /* ignore */ } }, timeoutMs)
    const onChunk = (b: Buffer) => {
      out += String(b)
      if (out.length > 300000) out = out.slice(-150000)   // 渲染日志很长，只留尾部
    }
    p.stdout?.on('data', onChunk)
    p.stderr?.on('data', onChunk)
    p.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, out: out + '\n' + String(e?.message || e) }) })
    p.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code: code == null ? -1 : code, out: out + '\n(用时 ' + ((Date.now() - t0) / 1000).toFixed(0) + 's)' })
    })
  })
}

/**
 * 起一个出片任务：**立即返回**任务对象，真活在后头跑（前端靠 `/api/agent/daily-film-status` 轮询收尾）。
 * ⚠️ 后台任务跑在**当前进程**里 ⇒ pm2 重启会丢（与既有 `make_ai_video` 行为一致，已登记 ISSUES）。
 */
export async function startDailyFilm(
  uid: number | string, htmlName: string, opts?: { voice?: string[] },
): Promise<DailyFilmTask> {
  const voiced = Array.isArray(opts?.voice) && opts!.voice!.length > 0
  const id = 'df' + Date.now()
  const t: DailyFilmTask = { id, status: 'running', startedAt: new Date().toISOString(), htmlName, tail: [], voiced }
  writeTask(uid, t)
  const work = path.join(taskDir(uid), id)
  const push = (s: string) => {
    t.tail.push(String(s).slice(0, 300))
    if (t.tail.length > 40) t.tail = t.tail.slice(-40)
    writeTask(uid, t)
  }
  ;(async () => {
    try {
      fs.mkdirSync(path.join(work, 'out'), { recursive: true })
      // ① 取回单文件版 HTML（交付时本地临时文件已删，只有仓库里那份）
      push('[取件] 从仓库取回 ' + htmlName)
      const { getObject } = await import('@/lib/oss')
      const buf = await getObject(`storage/${uid}/${htmlName}`)
      if (!buf || !buf.length) throw new Error('仓库里取不到 ' + htmlName + '（可能已被清理，请重新生成一份）')
      const htmlPath = path.join(work, 'in.html')
      fs.writeFileSync(htmlPath, buf)
      push('[取件] OK ' + (buf.length / 1024 / 1024).toFixed(1) + ' MB')
      // ② 跑出片工具（打包 → 用字闸门 → 引擎校验 → 渲染）
      // ⚠️★★ 必须走 `vfRootDir()`，**绝不能** `process.cwd()`（2026-10-14 用户实测踩到）：
      //   服务器跑的是 pm2 里的 `.next/standalone/server.js` ⇒ cwd = `.next/standalone`；
      //   而 Next 的 file tracing 只会把**个别被字面量引用到的脚本**拷进 `.next/standalone/scripts/…`：
      //     工具 `daily-film.mjs` 在里面（所以它能启动、还打了 `stage=fonts`），
      //     但它 spawn 的兄弟脚本 `check-page-fonts.mjs` 与 `node_modules/hyperframes` **都不在**
      //   ⇒ 用户看到的报错是
      //     `Cannot find module '…/.next/standalone/scripts/video-factory/html-deck/check-page-fonts.mjs'`，
      //     还被裹在 `stage=fonts 用字闸门未过` 里 ⇒ **完全看不出是路径问题**。
      //   口径与成片线一致：`vfRootDir()` 从 cwd 上溯到**项目根**（判据 = scripts/video-factory/make.py 在），
      //   那里才有完整引擎（工具 + 兄弟脚本 + node_modules/hyperframes）。
      const deckRoot = path.join(vfRootDir() || process.cwd(), 'scripts', 'video-factory', 'html-deck')
      // ★VF_DAILYVOICE_V2：工具二选一 ——
      //   无声出片 `daily-film.mjs`（打包 → 两道闸门 → 渲染）
      //   配音出片 `daily-voice.mjs`（逐段 TTS → 按**实测时长**回填时间轴 → SRT → 渲染 → 混音烧字幕）
      //   两者都在同一个 work 目录里跑、都以 FINAL_MP4: 报告产物 ⇒ 后面收尾逻辑完全共用。
      const tool = path.join(deckRoot, 'tools', voiced ? 'daily-voice.mjs' : 'daily-film.mjs')
      // 齐了才敢跑 —— 缺一样都会在**中途**炸成晦涩报错（2026-10-14 就是这么踩的），不如一次说清
      const need: Array<[string, string]> = [
        [voiced ? '配音出片工具' : '出片工具', tool],
        ['用字表闸门', path.join(deckRoot, 'check-page-fonts.mjs')],
        ['渲染引擎', path.join(deckRoot, 'node_modules', 'hyperframes', 'bin', 'hyperframes.mjs')],
      ]
      // 配音还多一样依赖：纯 Node 的 TTS（生产服务器没有 python 也能跑）
      if (voiced) need.push(['TTS（纯 Node）', path.join(deckRoot, 'tools', 'tts-node.mjs')])
      const miss = need.filter(([, p]) => !fs.existsSync(p)).map(([n, p]) => n + '（' + p + '）')
      if (miss.length) {
        throw new Error('引擎不完整，缺：' + miss.join('；')
          + ' —— 服务器上请确认 scripts/video-factory/html-deck 已装依赖（cd scripts/video-factory/html-deck && npm ci --omit=dev）')
      }
      const outDir = path.join(work, 'out')
      let args: string[]
      if (voiced) {
        // 口播落成**与成片线同格式**的旁白文件（{ "voice": [...] }）—— 那个格式是 film-voice 验证过的，
        // 两边工具通用，将来要挪/复用都不必转换。
        const vp = path.join(work, 'voices.json')
        fs.writeFileSync(vp, JSON.stringify({ voice: opts!.voice }, null, 2), 'utf8')
        push('[配音] ' + opts!.voice!.filter((x) => String(x || '').trim()).length + '/' + opts!.voice!.length + ' 段有口播')
        args = [tool, htmlPath, '--voices', vp, '--outdir', outDir]
      } else {
        args = [tool, htmlPath, '--outdir', outDir]
      }
      // 配音比无声多花 TTS 的时间 ⇒ 上限给到 60 分钟（前端轮询本身是 30 分钟超时，够）
      const r = await runTool(process.execPath, args, 60 * 60 * 1000)
      String(r.out || '').split('\n').filter((l) => l.trim()).slice(-12).forEach(push)
      // ★VF_DAILYFILM_V5（2026-10-15 用户实测「渲染跑了 332s 却判失败、报错还是空的」）：
      //   产物路径**优先从文件读** —— 工具会把 mp4 绝对路径写进 `<outDir>/FINAL_MP4.txt`。
      //   为什么不再只靠 stdout：① 我们自己的 runTool 有 30 万字符上限（只留尾部）；
      //   ② 工具侧也可能因输出过长被截断 ⇒ "其实渲好了却拿不到路径" ⇒ 白判失败。
      //   （配音链路那次就是被我写错字段名害的：`spawnSync` 返回 `stdout`，我读了 `out` ⇒ 永远 undefined。）
      const m = (() => {
        try {
          const f = String(fs.readFileSync(path.join(outDir, 'FINAL_MP4.txt'), 'utf8')).trim().split('\n')[0].trim()
          if (f) return [null, f] as any
        } catch { /* 失败时没有这个文件 ⇒ 回退 stdout */ }
        return /FINAL_MP4:(.+)/.exec(String(r.out || ''))
      })()
      if (r.code !== 0 || !m) {
        // ★VF_DAILYFILM_V4（2026-10-14 用户实测「stage=fonts ✗ 用字闸门未过（服务器会渲成豆腐块）：」
        //   冒号后面**什么都没有**）：病灶与成片线的 ★VF_FONTMSG_V1 **一模一样** ——
        //   这里原来只挑含 `stage=` / `✗` 的行，而"**到底是哪个字**"在**紧接着的下一行**（工具是分两行打的）
        //   ⇒ 被整条滤掉 ⇒ 用户拿到一个"冒号后面是空的"报错，根本没法改。
        //   现口径：先定位 stage 行，再把它**紧随其后的 4 行**原样带上（不滤）。
        const all = String(r.out || '').split('\n').map((x) => x.trim()).filter(Boolean)
        const at = all.findIndex((l) => /stage=/.test(l))
        const near = (at >= 0 ? all.slice(at, at + 5) : all.slice(-4)).join(' ⏎ ')
        throw new Error('出片失败（exit ' + r.code + '）：' + (near || '见 tail').slice(0, 400))
      }
      const mp4 = String(m[1]).trim()
      if (!fs.existsSync(mp4)) throw new Error('工具报了成品但文件不在：' + mp4)
      // ③ 入库 + 24h 签名直链（前端 `<video src>` 直接用）
      const mp4Buf = fs.readFileSync(mp4)
      push('[入库] ' + (mp4Buf.length / 1024 / 1024).toFixed(1) + ' MB mp4')
      const saved = await saveToPersonalRepo({ userId: uid, buffer: mp4Buf, ext: 'mp4', mime: 'video/mp4', gen: true })
      const { signedUrl } = await import('@/lib/oss')
      const url = await signedUrl(`storage/${uid}/${saved.name}`, 24 * 3600)
      t.status = 'done'
      t.finishedAt = new Date().toISOString()
      t.repoName = String(saved?.name || '')
      t.url = url
      push('[完成] ' + t.repoName)
      writeTask(uid, t)
    } catch (e: any) {
      t.status = 'failed'
      t.finishedAt = new Date().toISOString()
      t.error = String(e?.message || e).slice(0, 300)
      push('[失败] ' + t.error)
      writeTask(uid, t)
    } finally {
      try { fs.rmSync(work, { recursive: true, force: true }) } catch { /* 中间产物留着也无害 */ }
    }
  })().catch(() => { /* 上面已兜住所有失败路径 */ })
  return t
}
