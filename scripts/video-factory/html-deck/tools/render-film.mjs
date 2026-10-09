#!/usr/bin/env node
/**
 * ★VF_RENDERFILM_V1 —— 成片入口：film.json → 页面 → **三道闸门** → 渲染
 * =============================================================================
 * 这是批次 2.1 的"引擎接入"部分。设计取舍（重要）：
 *   · **不改 deck.schema.json**：那 12 种制式页型是老线在跑的契约，动它=动老线。
 *   · 走**独立入口**：老链路一行不改，天然满足"新东西失败 ⇒ 调用方回退老画法"。
 *
 * 三道闸门（任一道不过 ⇒ 返回 ok:false + stage + 原因，**绝不产出坏片**）：
 *   ① media  素材文件必须齐全（缺一张就退，避免"黑块/占位"混进成片）
 *   ② fonts  用字必须在字体子集内（否则服务器渲成豆腐块）
 *   ③ check  引擎运行时校验：文字对比度 / 版面重叠 / 遮挡 / 资源缺失
 * 之后才真渲，并抽 4 帧拼一张**审片图**（供人一眼看全片）。
 *
 * 用法：node tools/render-film.mjs films/demo-30s.json [--outdir out/film]
 * 退出码：0 成功 · 1 被闸门拦（看 stdout 的 stage） · 2 用法错
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { buildFilm } from './film-to-page.mjs'

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const HF = path.join(HERE, 'node_modules', 'hyperframes', 'bin', 'hyperframes.mjs')

function run(cmd, argv, opts) { return spawnSync(cmd, argv, Object.assign({ cwd: HERE, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }, opts || {})) }

/** 解析风格包：film.pack 可以是 id（读 styles/）或内联对象
 *  ★VF_STUDIORUNTIME_V1（2026-10-08 用户定案 ②）：读取口径 = **运行时库优先 → 内置库**。
 *   运行时库目录由 `VF_STYLES_EXTRA` 传入（studio-server 会带；不设 ⇒ 行为与从前一字不差）。
 *   为什么：后台保存的风格包写进 `storage/_studio/styles`（不写代码目录，避免与 git 冲突），
 *   所以引擎必须知道"运行时库"这回事，否则刚存的风格在实验室里出不了片。 */
function styleDirs() {
  const extra = String(process.env.VF_STYLES_EXTRA || '').split(/[;,]/).map((s) => s.trim()).filter(Boolean)
  return extra.concat([path.join(HERE, 'styles')])
}
function resolvePack(film) {
  if (film.packObj) return film.packObj
  if (film.pack && typeof film.pack === 'object') return film.pack
  const id = String(film.pack || '').trim()
  if (!id) return {}
  for (const d of styleDirs()) {
    const f = path.join(d, id + '.json')
    if (fs.existsSync(f)) {
      try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { /* 换下一个库 */ }
    }
  }
  return null
}

export function renderFilm(filmPath, opts = {}) {
  const abs = path.resolve(filmPath)
  if (!fs.existsSync(abs)) return { ok: false, stage: 'usage', err: 'film.json 不存在：' + abs }
  let film
  try { film = JSON.parse(fs.readFileSync(abs, 'utf8')) } catch (e) { return { ok: false, stage: 'usage', err: 'film.json 解析失败：' + e.message } }
  if (!Array.isArray(film.scenes) || !film.scenes.length) return { ok: false, stage: 'usage', err: 'film.scenes 为空' }

  const pack = resolvePack(film)
  if (pack === null) return { ok: false, stage: 'pack', err: '风格包不存在：' + film.pack }
  film = Object.assign({}, film, { packObj: pack })
  if (!film.id) film.id = path.basename(abs, '.json')

  const outDir = path.resolve(HERE, opts.outdir || path.join('out', 'film', film.id))
  const b = buildFilm(film, outDir, path.dirname(abs))

  // ① 素材齐全
  if (b.missing.length) return { ok: false, stage: 'media', err: '缺素材：' + b.missing.join(', '), dir: outDir }

  // ② 用字闸门
  const fp = run(process.execPath, [path.join(HERE, 'check-page-fonts.mjs'), outDir, '--json'])
  if (fp.status !== 0) {
    // ★VF_FONTMSG_V1（2026-10-09 用户实测「出片被拦（fonts）：**1 个表外字**：」后面是空的）：
    //   病灶：老实现只抓"**N 个表外字**："那一行（`.filter(l => /表外字/.test(l))`），
    //   而**到底是哪个字**在紧随其后的缩进行里（`      馐  ← index.html`）⇒ 全被过滤掉了
    //   ⇒ 用户拿到一个"冒号后面什么都没有"的报错，根本没法改文案。
    //   现口径：用 `--json` 拿结构化结果，把**字与所属文件一起**报出来。
    let miss = ''
    try {
      const j = JSON.parse(String(fp.stdout || ''))
      const hit = new Set()
      for (const r of (j.results || [])) for (const m of (r.miss || [])) if (m && m.ch) hit.add(String(m.ch))
      miss = Array.from(hit).join(' ')
    } catch {
      const ls = String(fp.stdout || '').split('\n')
      const i = ls.findIndex((l) => /表外字/.test(l))
      miss = i >= 0 ? ls.slice(i, i + 8).join(' ').replace(/\s+/g, ' ').trim() : String(fp.stdout || '')
    }
    return {
      ok: false, stage: 'fonts',
      err: ('字表外的字：' + (miss || '(未解析出)') + ' —— 改文案避开这些字即可（引擎字体是子集，缺字服务器上会渲成豆腐块）').slice(0, 300),
      dir: outDir,
    }
  }

  // ③ 引擎运行时校验（对比度 / 重叠 / 遮挡 / 资源）
  const ck = run(process.execPath, [HF, 'check', outDir])
  if (ck.status !== 0) {
    const lines = String(ck.stdout || '').split('\n').filter((l) => l.includes('✗')).slice(0, 6).join(' | ')
    return { ok: false, stage: 'check', err: lines.slice(0, 400) || 'check 未通过', dir: outDir }
  }

  // ④ 真渲
  const mp4 = path.join(outDir, film.id + '.mp4')
  const r = run(process.execPath, [HF, 'render', outDir, '-o', mp4, '-f', String(film.fps || 25), '-q', opts.quality || 'looks'], { timeout: 30 * 60 * 1000 })
  if (r.status !== 0 || !fs.existsSync(mp4)) return { ok: false, stage: 'render', err: String(r.stderr || r.stdout || '').slice(-400), dir: outDir }

  // ⑤ 审片图（4 帧拼一张）
  const sheet = path.join(outDir, 'sheet.jpg')
  const total = b.total
  const picks = [0.12, 0.37, 0.62, 0.87].map((f) => (total * f).toFixed(2))
  const frames = []
  picks.forEach((t, i) => {
    const f = path.join(outDir, 'rv' + i + '.jpg')
    run('ffmpeg', ['-nostdin', '-y', '-v', 'error', '-ss', t, '-i', mp4, '-frames:v', '1', '-vf', 'scale=420:-1', f])
    if (fs.existsSync(f)) frames.push(f)
  })
  if (frames.length === 4) {
    run('ffmpeg', ['-nostdin', '-y', '-v', 'error', '-i', path.join(outDir, 'rv%d.jpg'), '-vf', 'tile=2x2:margin=6:padding=6', '-frames:v', '1', sheet])
  }

  return { ok: true, stage: 'done', mp4, sheet: fs.existsSync(sheet) ? sheet : '', dir: outDir, total, structs: b.structs, scenes: film.scenes.length }
}

/* ---------------- CLI ---------------- */
const isCli = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
if (isCli) {
  const args = process.argv.slice(2)
  const arg = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d }
  const filmPath = args.find((a) => !a.startsWith('--'))
  if (!filmPath) { console.error('用法: node tools/render-film.mjs <film.json> [--outdir out/film]'); process.exit(2) }
  const res = renderFilm(filmPath, { outdir: arg('outdir', ''), quality: arg('quality', 'looks') })
  if (!res.ok) {
    console.log(`✗ 被闸门拦下：stage=${res.stage}`)
    console.log('  原因：' + res.err)
    console.log('  ⇒ 调用方应**回退老画法**（本入口不产出任何坏片）')
    process.exit(1)
  }
  console.log(`✓ 成片：${path.relative(HERE, res.mp4)}（${res.scenes} 段 · ${res.total}s）`)
  if (res.sheet) console.log(`  审片图：${path.relative(HERE, res.sheet)}`)
  console.log('  结构：' + res.structs.join(' → '))
}
