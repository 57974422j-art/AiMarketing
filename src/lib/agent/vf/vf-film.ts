/**
 * ★VF_FILMLINE_V1（2026-10-08）—— 「素材片 / MG 线」的 AGENT 侧封装（**新增线，不动老线**）
 * =============================================================================
 * 这条线要解决的事：用户给一批素材（图片/视频帧）+ 一句主题，就要一条**好看的竖屏短片**。
 * 做法不是"AI 生成画面"，而是"**风格包 + 镜头组**"（引擎逐帧渲 HTML）—— 可复现、可验收。
 *
 * 三件事（全部落在 scripts/video-factory/html-deck/tools/ 的离线工具上，本文件只做封装）：
 *   ① capabilityBrief()  —— 给模型看的**能力清单**（它不知道这套新引擎，必须每次喂）
 *   ② orchestrate()      —— 编排：判赛道 / 选风格包 / 选镜头组 / 填文案（**只引用库内 id**）
 *        · 先让 AI 出（由上层把 brief 交给模型），再用 `validate` 校验；越界 ⇒ 自动回退
 *        · 没有 AI 也能出（`rule` 规则版，永不失败）
 *   ③ render()           —— 出片：三道闸门（素材/用字/引擎校验）→ 渲染；**失败即回退**
 *
 * ⚠ 设计纪律（与本项目其余部分一致）：本条线**不改动** deck 的 12 种制式页型契约，
 *   走独立入口 render-film.mjs ⇒ 老线（图片成片/图视混剪/PPT+图视）行为一行不变。
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { vfRootDir } from '@/lib/agent/video-material'

/** 引擎工具目录 */
export function filmToolsDir(): string {
  return path.join(vfRootDir() || '', 'scripts', 'video-factory', 'html-deck')
}

export function filmLineReady(): boolean {
  const d = filmToolsDir()
  return fs.existsSync(path.join(d, 'tools', 'orchestrate.mjs')) && fs.existsSync(path.join(d, 'tools', 'render-film.mjs'))
}

/** 给模型的一页纸（**每次都要喂** —— 它不可能"了解"一个 2025 年的新引擎） */
export function capabilityBrief(): string {
  return [
    '【素材片线（可编程页 · 风格包 + 镜头组）】你可以把用户给的素材直接做成竖屏短片，做法不是 AI 生成画面，而是"HTML 逐帧渲染"，因此**画面可复现、可验收**。',
    '用户给素材（图片/视频帧）+ 一句主题 → 你只做四件事：**判赛道、选风格包、选镜头组、填文案**。',
    '铁律：**只能引用库里已有的 id**（风格包 id / 结构 id / 镜头组 id）。库外的 id 会被校验器替换成默认值（记为 fallback），所以"选得不准"没关系，"发明 id"会被回退。',
    '你不写代码、不画页面、不排时间线 —— 编排由编排器做，出片由引擎做。',
    '失败语义：出片前有三道闸门（素材齐全 / 用字在字体子集内 / 引擎校验对比度与重叠）。任一道不过 ⇒ 返回失败原因，**不会产出坏片**，此时应回退老画法（如 make_ai_video）或改文案重试。',
  ].join('\n')
}

type RunOut = { code: number; out: string }

function runNode(args: string[], timeoutMs = 15 * 60 * 1000): Promise<RunOut> {
  return new Promise((resolve) => {
    const dir = filmToolsDir()
    const child = spawn(process.execPath, args, { cwd: dir })
    let out = ''
    const t = setTimeout(() => { try { child.kill() } catch { /* ignore */ } }, timeoutMs)
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { out += d })
    child.on('close', (code) => { clearTimeout(t); resolve({ code: code ?? -1, out }) })
  })
}

/** ② 规则版编排（离线保底）：永不失败 */
export async function orchestrate(opts: {
  materials: string[]
  text?: string
  pack?: string
  variant?: number
  id?: string
  outJson: string
}): Promise<{ ok: boolean; vertical?: string; pack?: string; scenes?: number; total?: number; note?: string }> {
  if (!opts.materials?.length) return { ok: false, note: '没有素材' }
  const args = [
    path.join('tools', 'orchestrate.mjs'), 'rule',
    '--materials', opts.materials.join(','),
    '--text', String(opts.text || ''),
    '--variant', String(opts.variant || 0),
    '--id', opts.id || 'vf-film',
    '--out', opts.outJson,
  ]
  if (opts.pack) args.push('--pack', opts.pack)
  const r = await runNode(args, 120000)
  if (r.code !== 0 || !fs.existsSync(path.join(filmToolsDir(), opts.outJson))) return { ok: false, note: r.out.slice(-300) }
  try {
    const j = JSON.parse(fs.readFileSync(path.join(filmToolsDir(), opts.outJson), 'utf8'))
    return { ok: true, vertical: j.vertical, pack: j.pack, scenes: j.scenes?.length, total: j.total, note: (j.rationale || []).join(' / ') }
  } catch (e: any) { return { ok: false, note: String(e?.message || e) } }
}

/** ②b 校验 AI 的编排（越界回退）：AI 输出 → 合法编排 */
export async function validate(orchestrationJson: string, opts: { materials: string[]; outJson: string }) {
  const args = [path.join('tools', 'orchestrate.mjs'), 'validate', orchestrationJson, '--materials', opts.materials.join(','), '--out', opts.outJson]
  const r = await runNode(args, 120000)
  const fallbacks = (r.out.match(/fallback (\d+)/) || [])[1] || '0'
  return { ok: r.code === 0, fallbacks: Number(fallbacks), note: r.out.slice(-400) }
}

/** ③ 出片：三道闸门 → 渲染（失败返回 stage，调用方据此回退） */
export async function render(filmJson: string, outDir: string): Promise<{ ok: boolean; mp4?: string; sheet?: string; stage?: string; err?: string }> {
  const r = await runNode([path.join('tools', 'render-film.mjs'), filmJson, '--outdir', outDir], 30 * 60 * 1000)
  // ★VF_FILM_PATH_V1（2026-10-08 用户实测：协议串里 `localMp4` 是
  //   `…/film.mp4（6 段 · 30s）` —— 路径后面粘着**说明文字**）：
  //   原来靠 stdout 正则 `成片：(.*?)\n` 抓路径，而 render-film 那行打印是
  //   `成片：<相对路径>（N 段 · Ms）` ⇒ 抓到的"路径"根本不存在 ⇒ 后续 `readFile` 失败
  //   ⇒ 入个人仓库/签名整条断掉（前端于是只剩"没拿到可播放地址"）。
  //   现口径：**按目录找文件**（最稳，不看 stdout 文案）——
  //     成片 = outDir 下最大的 .mp4（渲染产物只有一个）；审片图 = sheet.jpg（或 *sheet*.jpg）。
  //   都找不到才退回"清洗过的"stdout 路径（去掉行尾说明文字/括号）。
  if (r.code === 0) {
    const dirAbs = path.isAbsolute(outDir) ? outDir : path.join(filmToolsDir(), outDir)
    let mp4 = ''
    let sheet = ''
    try {
      const names = fs.readdirSync(dirAbs)
      const sizeOf = (p: string) => { try { return fs.statSync(p).size } catch { return 0 } }
      const mp4s = names.filter((n) => /\.mp4$/i.test(n))
        .map((n) => ({ p: path.join(dirAbs, n), sz: sizeOf(path.join(dirAbs, n)) }))
        .sort((a, b) => b.sz - a.sz)
      if (mp4s.length && mp4s[0].sz > 0) mp4 = mp4s[0].p
      const sh = names.find((n) => /^sheet\.jpe?g$/i.test(n)) || names.find((n) => /sheet.*\.jpe?g$/i.test(n))
      if (sh) sheet = path.join(dirAbs, sh)
    } catch { /* 目录读不到 → 走下面兜底 */ }
    if (!mp4) {
      const m = r.out.match(/成片[:：]\s*([^\s（(]+)/)   // 只取到空白/括号为止，别把说明文字带进来
      if (m) {
        const cand = path.isAbsolute(m[1]) ? m[1].trim() : path.join(filmToolsDir(), m[1].trim())
        if (fs.existsSync(cand)) mp4 = cand
      }
    }
    return { ok: true, mp4, sheet }
  }
  const stage = (r.out.match(/stage=(\w+)/) || [])[1] || 'unknown'
  const why = (r.out.split('\n').find((l) => l.includes('原因：')) || '').replace('原因：', '').trim()
  return { ok: false, stage, err: why || r.out.slice(-300) }
}

/** 端到端一步到位：素材 → 编排 → 出片（试点线用；AI 想自己编排时改用 orchestrate + validate） */
export async function makeFilmFromMaterials(opts: {
  materials: string[]
  text?: string
  pack?: string
  variant?: number
  workDir: string
}): Promise<{ ok: boolean; mp4?: string; sheet?: string; stage?: string; err?: string; vertical?: string; pack?: string }> {
  fs.mkdirSync(opts.workDir, { recursive: true })
  const filmJson = path.join(opts.workDir, 'film.json')
  const rel = path.relative(filmToolsDir(), filmJson).replace(/\\/g, '/')
  const o = await orchestrate({ materials: opts.materials, text: opts.text, pack: opts.pack, variant: opts.variant, id: 'vf-film', outJson: rel })
  if (!o.ok) return { ok: false, stage: 'orchestrate', err: o.note }
  const r = await render(rel, path.join('out', 'film', path.basename(opts.workDir)))
  return { ...r, vertical: o.vertical, pack: o.pack }
}
