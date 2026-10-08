#!/usr/bin/env node
/**
 * ★VF_STUDIO_SRV_V1 —— 风格包管理器的本地服务（让"写库 / 试片"两个按钮真的能用）
 * =============================================================================
 * 为什么需要它：浏览器页面（file://）**不能写文件、不能调渲染**。所以用一个**本机小服务**兜住，
 * 用户侧**不碰命令行** —— 双击 `启动风格管理器.cmd` 即可（它会自动打开浏览器）。
 *
 * 接口（只监听 127.0.0.1，不对外）：
 *   GET  /                     → 管理器页面
 *   GET  /api/ping             → { ok, root, version }
 *   POST /api/save   {pack}    → 校验并写入 styles/<id>.json，然后重建清单与管理器页面
 *   POST /api/render {id}      → 按该风格包生成页面并**渲 3 秒试片**，返回 mp4/jpg 地址
 *   POST /api/extract{video,every} → 跑抽取器，返回候选清单（"喂视频自动建库"那一步）
 *   POST /api/open   {path}    → 在系统里打开某文件（方便用户看试片/成片）
 *
 * 静态目录：html-deck/（只读），所以页面能直接引用 styles/thumbs/*.jpg 与 out/preview/*.mp4
 * 用法：node tools/studio-server.mjs [--port 7788] [--no-open]
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')   // html-deck/
// ══════════════ ★VF_STUDIORUNTIME_V1（2026-10-08 用户定案 ②③④）══════════════
// ① **风格库写进"运行时库"**：`<项目>/storage/_studio/styles/` —— **绝不写代码目录的 styles/**
//    代码目录是 git 仓库：在生产上写它会与仓库不同步（下次 git pull 冲突/被覆盖）。
//    引擎读取口径 = **内置库（html-deck/styles，随仓库交付）+ 运行时库（本目录，运行产出）**，
//    同名以运行时优先；要"**固化进内置库**"时由我提交进仓库（别再忘）。
// ② 试片 / 成片 / 抽帧产物也落运行时根（`storage/_studio/out/`），不再往代码目录的 out/ 堆。
// ③ 这些动作（抽帧 / 试片 / 出片）都要 ffmpeg + 超帧引擎 ⇒ **只在管理员本机跑**：
//    生产服务器上不启本服务（本服务只监听 127.0.0.1），普通用户机器没有 ffmpeg、也不参与试片。
// 可用 VF_STUDIO_HOME 覆盖运行时根（默认 = html-deck 往上 3 级的 storage）。
const STORAGE_ROOT = process.env.VF_STUDIO_HOME || path.resolve(HERE, '..', '..', '..', 'storage')
const RUNTIME_ROOT = path.join(STORAGE_ROOT, '_studio')
const stylesDir = path.join(HERE, 'styles')                 // 内置库（**只读**）
const runtimeStyles = path.join(RUNTIME_ROOT, 'styles')     // 运行时库（可写）
const outRoot = path.join(RUNTIME_ROOT, 'out')              // 产物根（试片/成片/抽帧）
const ensureDir = (d) => { try { fs.mkdirSync(d, { recursive: true }) } catch { /* ignore */ } }
ensureDir(runtimeStyles); ensureDir(outRoot)
/** 风格包解析：**运行时优先** → 内置（同名以运行时为准）；找不到返回 '' */
const resolvePackFile = (id) => {
  const s = safeId(id)
  if (!s) return ''
  const r = path.join(runtimeStyles, s + '.json')
  if (fs.existsSync(r)) return r
  const b = path.join(stylesDir, s + '.json')
  return fs.existsSync(b) ? b : ''
}
/** 读一个目录下的风格包（排除 _schema / index / verticals 这类非包文件） */
const NOT_A_PACK = new Set(['index.json', 'verticals.json'])
const readPacks = (dir) => {
  const out = []
  let fs2 = []
  try { fs2 = fs.readdirSync(dir) } catch { return out }
  for (const f of fs2) {
    if (!f.endsWith('.json') || f.startsWith('_') || NOT_A_PACK.has(f)) continue
    try { out.push(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))) } catch { /* 跳过坏文件 */ }
  }
  return out
}
/** 重建**运行时清单**（只写运行时库里的 index.json；内置 index.json 仍由仓库维护） */
const rebuildRuntimeIndex = () => {
  try {
    const packs = readPacks(runtimeStyles)
    fs.writeFileSync(path.join(runtimeStyles, 'index.json'),
      JSON.stringify({ version: 'runtime', at: new Date().toISOString(), items: packs }, null, 2) + '\n', 'utf8')
    return packs.length
  } catch { return -1 }
}
const args = process.argv.slice(2)
const arg = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d }
const PORT = parseInt(arg('port', '7788'), 10)

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.mp4': 'video/mp4', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2' }

function send(res, code, obj) { const b = JSON.stringify(obj); res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(b) }); res.end(b) }
function readBody(req) { return new Promise((resolve) => { let s = ''; req.on('data', (c) => { s += c; if (s.length > 24e6) req.destroy() }); req.on('end', () => { try { resolve(JSON.parse(s || '{}')) } catch { resolve({}) } }) }) }

/* ---------------- 「30 秒素材片」工作台（批次 2.2）----------------
   作业目录：out/workbench/<job>/  （media/ 放素材；film.json 是编排）
   出片是**异步作业**（渲一条 30 秒片约 40~60 秒），页面轮询 /api/film/status。
   ★ 失败语义：render-film 的闸门拦下时，作业状态 = failed + stage + 原因
     （页面显示原因；**不产出坏片** —— 这正是"回退老画法"的接口）。 */
const JOBS = new Map()
const workRoot = path.join(outRoot, 'workbench')            // ★VF_STUDIORUNTIME_V1：产物落运行时根
const EXT_OK = new Set(['.jpg', '.jpeg', '.png', '.webp'])
const safeId = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 32)

/** 基本校验（与 styles/_schema.json 同口径的"必须项"） */
function validatePack(p) {
  const errs = []
  if (!safeId(p.id)) errs.push('id 必须是字母数字和短横线')
  if (!p.name) errs.push('缺 name')
  if (!(p.structure || []).length) errs.push('至少选一个 structure')
  if (!p.tokens || !p.tokens.bg || !p.tokens.ink) errs.push('tokens.bg / tokens.ink 必填')
  return errs
}

function rebuild() {
  const r = spawnSync(process.execPath, [path.join(HERE, 'tools', 'build-studio.mjs')], { cwd: HERE, encoding: 'utf8' })
  return { ok: r.status === 0, out: String(r.stdout || '').trim().split('\n').slice(-3).join(' | '), err: String(r.stderr || '').slice(0, 300) }
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1')
  const p = decodeURIComponent(u.pathname)

  // ---------- API ----------
  if (p === '/api/ping') return send(res, 200, {
    ok: true, root: HERE, version: 'VF_STUDIO_SRV_V2',
    // ★VF_STUDIORUNTIME_V1：把"库在哪"如实回给前端（内置=只读 / 运行时=可写 / 产物在哪）
    builtin: stylesDir, runtime: runtimeStyles, out: outRoot,
    builtinN: readPacks(stylesDir).length, runtimeN: readPacks(runtimeStyles).length,
  })

  // ★VF_STUDIORUNTIME_V1：清单 = **内置 + 运行时合并**（同名以运行时为准），带 source 标记
  if (p === '/api/list') {
    const bi = readPacks(stylesDir).map((x) => ({ ...x, source: 'builtin' }))
    const rt = readPacks(runtimeStyles).map((x) => ({ ...x, source: 'runtime' }))
    const byId = new Map()
    for (const x of bi) byId.set(String(x.id), x)
    for (const x of rt) byId.set(String(x.id), x)
    return send(res, 200, { ok: true, items: Array.from(byId.values()), builtinN: bi.length, runtimeN: rt.length })
  }

  if (p === '/api/save' && req.method === 'POST') {
    const { pack } = await readBody(req)
    const errs = validatePack(pack || {})
    if (errs.length) return send(res, 400, { ok: false, errs })
    const id = safeId(pack.id)
    pack.id = id
    pack.createdBy = pack.createdBy || 'user'
    // ★VF_STUDIORUNTIME_V1（用户定案 ②）：**写运行时库**，绝不碰代码目录的 styles/
    const file = path.join(runtimeStyles, id + '.json')
    fs.writeFileSync(file, JSON.stringify(pack, null, 2) + '\n', 'utf8')
    const n = rebuildRuntimeIndex()
    return send(res, 200, {
      ok: true, file, where: 'runtime', runtimeN: n,
      note: '已存入**运行时库**（' + path.relative(RUNTIME_ROOT, file).replace(/\\/g, '/') + '）；内置库只读、不受影响。'
        + '要"固化进内置库"请让 AI 提交进仓库（这样 git pull 不会冲突）。',
    })
  }

  if (p === '/api/render' && req.method === 'POST') {
    const { id, pack } = await readBody(req)
    let use = pack
    if (!use) {
      // ★VF_STUDIORUNTIME_V1：运行时库优先 → 内置库
      const f = resolvePackFile(id)
      if (!f) return send(res, 404, { ok: false, err: '风格包不存在：' + id })
      use = JSON.parse(fs.readFileSync(f, 'utf8'))
    }
    const outDir = path.join(outRoot, 'preview', safeId(use.id))   // ★VF_STUDIORUNTIME_V1：产物落运行时根
    const mod = await import('./pack-to-page.mjs')
    try {
      mod.buildPage(use, outDir)
      const r = mod.renderPreview(outDir)
      if (!r.ok) return send(res, 500, { ok: false, err: r.err })
      return send(res, 200, {
        ok: true,
        mp4: '/out/preview/' + safeId(use.id) + '/preview.mp4',
        jpg: r.jpg ? '/out/preview/' + safeId(use.id) + '/preview.jpg' : '',
      })
    } catch (e) { return send(res, 500, { ok: false, err: String(e.message).slice(0, 400) }) }
  }

  if (p === '/api/extract' && req.method === 'POST') {
    const { video, every } = await readBody(req)
    if (!video || !fs.existsSync(video)) return send(res, 400, { ok: false, err: '视频不存在：' + video })
    const outDir = path.join(outRoot, 'extract', 'v' + Date.now())   // ★VF_STUDIORUNTIME_V1：产物落运行时根
    const r = spawnSync(process.execPath, [path.join(HERE, 'tools', 'extract-elements.mjs'), video,
      '--out', outDir, '--every', String(every || 8.5)], { cwd: HERE, encoding: 'utf8', timeout: 10 * 60 * 1000 })
    const cf = path.join(outDir, 'candidates.json')
    if (!fs.existsSync(cf)) return send(res, 500, { ok: false, err: String(r.stderr || r.stdout || '').slice(-400) })
    const j = JSON.parse(fs.readFileSync(cf, 'utf8'))
    // 把候选截图换成可访问 URL
    j.candidates = j.candidates.map((c) => ({ ...c, url: '/out/extract/' + path.basename(outDir) + '/' + c.frame }))
    j.outDir = path.relative(HERE, outDir).replace(/\\/g, '/')
    return send(res, 200, { ok: true, data: j })
  }

  if (p === '/api/open' && req.method === 'POST') {
    const { target } = await readBody(req)
    const f = path.resolve(target || '')
    // ★VF_STUDIORUNTIME_V1：产物现在在运行时根（storage/_studio）⇒ 两处都放行
    const okPath = f.startsWith(HERE) || f.startsWith(RUNTIME_ROOT)
    if (!okPath || !fs.existsSync(f)) return send(res, 400, { ok: false, err: '路径不合法' })
    if (process.platform === 'win32') spawnSync('cmd', ['/c', 'start', '', f], { windowsHide: true })
    else spawnSync('open', [f])
    return send(res, 200, { ok: true })
  }

  // ---------- 30 秒素材片：上传 / 出片 / 进度 ----------
  if (p === '/api/film/upload' && req.method === 'POST') {
    const { job, name, data } = await readBody(req)
    const jid = safeId(job)
    if (!jid) return send(res, 400, { ok: false, err: '缺 job' })
    const ext = path.extname(String(name || '')).toLowerCase()
    if (!EXT_OK.has(ext)) return send(res, 400, { ok: false, err: '只支持 jpg/jpeg/png/webp（收到 ' + ext + '）' })
    const b64 = String(data || '').replace(/^data:[^,]+,/, '')
    const buf = Buffer.from(b64, 'base64')
    if (!buf.length) return send(res, 400, { ok: false, err: '空文件' })
    if (buf.length > 12e6) return send(res, 400, { ok: false, err: '单张素材请小于 12MB' })
    const dir = path.join(workRoot, jid, 'media')
    fs.mkdirSync(dir, { recursive: true })
    const safeName = safeId(path.basename(name, ext)) + ext
    fs.writeFileSync(path.join(dir, safeName), buf)
    return send(res, 200, { ok: true, file: safeName, url: '/out/workbench/' + jid + '/media/' + safeName, kb: Math.round(buf.length / 1024) })
  }

  if (p === '/api/film/make' && req.method === 'POST') {
    const body = await readBody(req)
    const jid = safeId(body.job)
    if (!jid) return send(res, 400, { ok: false, err: '缺 job' })
    const dir = path.join(workRoot, jid)
    const mediaDir = path.join(dir, 'media')
    const files = fs.existsSync(mediaDir) ? fs.readdirSync(mediaDir) : []
    if (!files.length) return send(res, 400, { ok: false, err: '请先上传至少 1 张素材' })
    const arr = await import('./arrange.mjs')
    const film = arr.arrange({
      id: 'wb-' + jid,
      name: body.name || '30 秒 HTML成片',   // ★VF_HTMLCMD_V1：旧名「素材片」→「HTML成片」
      pack: body.pack || 'reel-showcase',
      media: files.map((f) => 'media/' + f),
      structures: body.structures,
      slots: body.slots || {},
    })
    fs.writeFileSync(path.join(dir, 'film.json'), JSON.stringify(film, null, 2) + '\n', 'utf8')
    const st = { state: 'running', stage: '', err: '', log: '', mp4: '', sheet: '', startedAt: Date.now(), total: film.total, scenes: film.scenes.length, pack: film.pack }
    JOBS.set(jid, st)
    const rf = path.join(HERE, 'tools', 'render-film.mjs')
    // ★VF_STUDIORUNTIME_V1：产物落运行时根；并把**运行时库**告诉引擎（VF_STYLES_EXTRA）
    //   —— 这样"刚在管理器里存的新风格"能立刻在实验室出片，而不必先固化进内置库。
    const child = spawn(process.execPath, [rf, path.join(dir, 'film.json'), '--outdir', path.join(outRoot, 'workbench', jid, 'render')],
      { cwd: HERE, env: { ...process.env, VF_STYLES_EXTRA: runtimeStyles } })
    let so = ''
    child.stdout.on('data', (d) => { so += d; st.log = so.slice(-400) })
    child.stderr.on('data', (d) => { so += d; st.log = so.slice(-400) })
    child.on('close', (code) => {
      st.finishedAt = Date.now()
      const base = 'out/workbench/' + jid + '/render/' + film.id
      if (code === 0) { st.state = 'done'; st.mp4 = '/' + base + '.mp4'; st.sheet = '/' + base.replace(/\/[^/]+$/, '') + '/sheet.jpg' }
      else {
        const stage = (so.match(/stage=(\w+)/) || [])[1] || 'unknown'
        const why = (so.split('\n').find((l) => l.includes('原因：')) || '').replace('原因：', '').trim()
        st.state = 'failed'; st.stage = stage; st.err = why || so.slice(-300)
      }
    })
    return send(res, 200, { ok: true, job: jid, scenes: film.scenes.length, total: film.total })
  }

  if (p === '/api/film/status') {
    const jid = safeId(u.searchParams.get('job') || '')
    const st = JOBS.get(jid)
    if (!st) return send(res, 404, { ok: false, err: '作业不存在（服务重启会丢作业记录）' })
    return send(res, 200, Object.assign({ ok: true, job: jid, elapsed: Math.round((Date.now() - st.startedAt) / 1000) + 's' }, st))
  }

  // ---------- 静态 ----------
  // ★VF_STUDIORUNTIME_V1：`/out/*` 现在映射到**运行时产物根**（storage/_studio/out）——
  //   试片 mp4/jpg、抽帧候选图、实验室素材与成片都在那儿（URL 形状不变，前端零改动）。
  const isOut = p === '/out' || p.startsWith('/out/')
  const baseDir = isOut ? outRoot : HERE
  const rel = isOut ? p.replace(/^\/out\/?/, '') : (p === '/' ? 'tools/style-studio.html' : (p === '/lab' ? 'tools/film-lab.html' : p))
  let file = path.join(baseDir, rel)
  if (!file.startsWith(baseDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('404')
  }
  const ext = path.extname(file).toLowerCase()
  res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
})

server.listen(PORT, '127.0.0.1', () => {
  const url = 'http://127.0.0.1:' + PORT + '/'
  console.log('风格包管理器已启动：' + url)
  console.log('（这个窗口不要关；关掉就等于停服务）')
  console.log('30 秒 HTML成片工作台：' + url + 'lab')
  if (!args.includes('--no-open')) {
    if (process.platform === 'win32') spawnSync('cmd', ['/c', 'start', '', url], { windowsHide: true })
    else spawnSync('open', [url])
  }
})
