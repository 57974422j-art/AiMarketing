#!/usr/bin/env node
/**
 * ★VF_PPTPAGE_V1（2026-10-07 用户定案「先做 P0」）—— 把老引擎的【纯文字镜】换成
 * **新引擎（html-deck）渲出的整页版式图**，再当素材贴回原镜。
 *
 * ── 为什么是这个形态（先读这三条，否则一定会想"为什么不一镜一个 deck"）──
 *   ① 新引擎 deck **下限 4 页**（deck.schema.json:27 `minItems:4`）+ 首屏必须 cover；
 *      且 render-deck **没有"只渲某一页"的开关**（CLI 只有 <deck.json> / --outdir / --no-render）
 *      ⇒ **"一镜 = 一个 deck" 走不通**（校验先 exit 3）。
 *      所以：**把一条片的纯文字镜合成"一个 deck"渲一次**，再把 `frames/pN-full.png` 按序贴回对应镜。
 *      顺带白拿三样东西：schema 校验 / 字体覆盖闸门 / 输入→输出对账（reconcile.md）。
 *   ② 老引擎 render.py 只认**本地绝对路径**的 `src`（`os.path.exists` + `ffmpeg -i`，见 render.py:1715/1743）
 *      ⇒ 渲出来的 PNG 必须落成绝对路径，再让该镜 `type:'bgimage'`、`src:<png>`。这样 Ken Burns/
 *      渐变遮罩（VF_SCRIM_V1）/大字避让/字幕**全部自动继承**，不新增第二条渲染链。
 *   ③ **逐镜兜底**：任何一镜"映射不上 / 内容不合页型窗口 / 命中字表外字符" ⇒ **该镜保持原样**
 *      （继续用老引擎画法），绝不因为一页不合规就让整片退回或崩掉 —— 与 render.py:3521
 *      的"素材判废 → 改用质感底板"同一种语义。整脚本异常也只写日志、不改 storyboard。
 *
 * ── 用法（由 make.py / 预览路由调用，不给人手敲）──
 *   node ppt-pages.mjs --storyboard <sb.json> --out <sb.pptpage.json> [--outdir <缓存根>]
 *                      [--style bluewhite] [--master master-tech] [--palette cyan]
 *                      [--max N] [--dry]
 *   退出码恒为 0（失败只是"没换页"），真正的成败看最后一行 `[PPT-PAGE] RESULT {...}`。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DECK_DIR = path.join(__dirname, 'html-deck')
const RENDER_DECK = path.join(DECK_DIR, 'render-deck.mjs')
const FONT_TABLE = path.join(DECK_DIR, 'fonts', 'chars-cmn.txt')
const OUT_ROOT = path.join(DECK_DIR, 'out')

/* ============ 0) 参数 ============ */
function arg(name, dflt = '') {
  const i = process.argv.indexOf('--' + name)
  if (i >= 0 && i + 1 < process.argv.length && !process.argv[i + 1].startsWith('--')) return process.argv[i + 1]
  return process.argv.includes('--' + name) ? '1' : dflt
}
const SB = arg('storyboard')
const OUT_SB = arg('out')
const OUTDIR = arg('outdir', path.join(OUT_ROOT, 'pptpage'))
const STYLE = arg('style', '')
const MASTER_ARG = arg('master', '')
const PALETTE_ARG = arg('palette', '')
const MAX_PAGES = parseInt(arg('max', '24')) || 24
const DRY = process.argv.includes('--dry')

const notes = []
const say = (s) => { notes.push(s); console.log('[PPT-PAGE] ' + s) }
const done = (extra = {}) => {
  console.log('[PPT-PAGE] RESULT ' + JSON.stringify({ ok: extra.ok !== false, swapped: extra.swapped || 0, skipped: extra.skipped || 0, pages: extra.pages || 0, out: extra.out || '', note: extra.note || '' }))
  process.exit(0)
}

/* ============ 1) 老引擎 5 套「画面风格」→ 新引擎 master+palette ============
 * ⚠️ 这是 **P0 的临时粗映射**：两套皮肤体系的正式对齐（老 style/theme/deck_style → 新 master+palette
 *    + 皮肤库统一）是 P1 的活。这里只保证"气质大致不打架"，并允许 --master/--palette 覆盖。 */
const STYLE_MAP = {
  bluewhite: ['master-v2', 'azure'],
  darkgrad: ['master-tech', 'cyan'],
  cleanlight: ['master-v2', 'steel'],
  magazine: ['master-editorial', 'vermilion'],
  softlux: ['master-mono', 'graphite'],
}
function skinOf() {
  if (MASTER_ARG) return [MASTER_ARG, PALETTE_ARG || 'cyan']
  return STYLE_MAP[String(STYLE || '').trim()] || ['master-tech', 'cyan']
}

/* ============ 2) 字表（超表字 = 渲染必失败 exit 8 ⇒ 先自己筛掉，别拖垮整个 deck）============ */
let FONT_SET = null
function fontOk(text) {
  const s = String(text == null ? '' : text)
  if (!s) return true
  if (FONT_SET === null) {
    try {
      FONT_SET = new Set(fs.readFileSync(FONT_TABLE, 'utf8').split(''))
    } catch { FONT_SET = null; say('⚠️ 读不到字表（' + FONT_TABLE + '）→ 跳过字表预筛（由引擎闸门兜底）') }
  }
  if (!FONT_SET) return true
  for (const ch of s) {
    if (/\s/.test(ch)) continue
    if (/[\x20-\x7E]/.test(ch)) continue
    if (!FONT_SET.has(ch)) return false
  }
  return true
}

/* ============ 3) 卡型映射：老引擎纯文字镜 → 新引擎页型（**窗口取自 deck.schema.json，逐条硬校验**）============
 * 只映射"内容天然够格"的卡型；差一个字段就**不映射**（宁可这一镜留在老画法，也不许凭空造内容）。
 *   title  → cover/section（title 4~24 字；subtitle 6~40 可选）
 *   list   → bullets（title 4~24；items 3~5 条、每条 8~147；summary 6~334）
 *          或 toc（title 4~24；items 3~6 条、每条 4~24）
 *   number → section（title=label 4~24；number=value+suffix ≤12）
 *   end    → end（line1 4~135 / cta 6~351 / en 6~356 —— 老引擎 end 卡没有 en ⇒ 通常跳过）
 *   compare/chart/quote → 需要多条子项或更严窗口（compare.points 2~4 条 / chart.series 4~12 个 /
 *           quote 12~80 且须句末标点）⇒ 老引擎数据形态多半不够，**本批一律跳过**（P1 再谈）。
 */
const W = {
  t4_24: (s) => lenOk(s, 4, 24),
  t4_50: (s) => lenOk(s, 4, 50),
  s6_40: (s) => lenOk(s, 6, 40),
}
function lenOk(s, a, b) {
  const n = String(s == null ? '' : s).trim().length
  return n >= a && n <= b
}
function clip(s, b) { return String(s == null ? '' : s).trim().slice(0, b) }

function mapShot(shot) {
  const ty = String(shot?.type || '')
  const text = String(shot?.text == null ? '' : shot.text).trim()
  const title = String(shot?.title == null ? '' : shot.title).trim()
  const sub = String(shot?.subtitle == null ? '' : shot.subtitle).trim()
  if (ty === 'title') {
    if (!W.t4_50(text)) return { page: null, why: 'title 大字长度不在 4~24/4~50 窗口（' + text.length + ' 字）' }
    const p = { type: 'section', title: clip(text, 24) }
    if (W.s6_40(sub)) p.subtitle = clip(sub, 40)
    return { page: p, why: '' }
  }
  if (ty === 'list') {
    const items = (Array.isArray(shot?.items) ? shot.items : []).map((x) => String(x == null ? '' : x).trim()).filter(Boolean).slice(0, 5)
    const t = title || text
    if (!W.t4_24(t)) return { page: null, why: 'list 标题长度不在 4~24 窗口（' + t.length + ' 字）' }
    if (items.length >= 3 && items.every((x) => lenOk(x, 8, 147))) {
      const p = { type: 'bullets', title: clip(t, 24), items }
      if (lenOk(sub, 6, 334)) p.summary = clip(sub, 334)
      return { page: p, why: '' }
    }
    if (items.length >= 3 && items.every((x) => lenOk(x, 4, 24))) {
      const p = { type: 'toc', title: clip(t, 24), items: items.slice(0, 6) }
      return { page: p, why: '条目偏短 → 走 toc 页型' }
    }
    return { page: null, why: 'list 条目数/长度不合 bullets(3~5 条,8~147) 也不合 toc(3~6 条,4~24)' }
  }
  if (ty === 'number') {
    const label = String(shot?.label == null ? '' : shot.label).trim() || title || text
    const num = String(shot?.value == null ? '' : shot.value).trim() + String(shot?.suffix == null ? '' : shot.suffix).trim()
    if (!W.t4_24(label)) return { page: null, why: 'number 的 label 长度不在 4~24 窗口（' + label.length + ' 字）' }
    if (!num || String(num).length > 12) return { page: null, why: 'number 的 数值+单位 超 12 字（' + num.length + '）' }
    const p = { type: 'section', title: clip(label, 24), number: String(num).slice(0, 12) }
    if (W.s6_40(sub)) p.subtitle = clip(sub, 40)
    return { page: p, why: '' }
  }
  if (ty === 'end') {
    const line1 = text || title
    const cta = String(shot?.cta == null ? '' : shot.cta).trim()
    const en = String(shot?.en == null ? '' : shot.en).trim()
    if (!W.t4_50(line1) || !lenOk(cta, 6, 351) || !lenOk(en, 6, 356)) {
      return { page: null, why: 'end 需要 line1(4~135)+cta(6~351)+en(6~356)，老引擎 end 卡通常没有 en' }
    }
    return { page: { type: 'end', line1: clip(line1, 135), cta: clip(cta, 351), en: clip(en, 356) }, why: '' }
  }
  return { page: null, why: '本批不映射的卡型（' + ty + '）' }
}

/* ============ 4) 主流程 ============ */
let sb
try { sb = JSON.parse(fs.readFileSync(SB, 'utf8')) } catch (e) { say('读 storyboard 失败：' + String(e.message).slice(0, 120)); done({ ok: false, note: 'read-storyboard' }) }
if (!sb || !Array.isArray(sb.shots) || !sb.shots.length) { say('storyboard 没有 shots'); done({ ok: false, note: 'no-shots' }) }

// 4.1 挑出可映射的镜（**顺序即页序**）
const picked = []
for (let i = 0; i < sb.shots.length; i++) {
  const r = mapShot(sb.shots[i])
  if (r.page) picked.push({ idx: i, page: r.page })
  else say(`第 ${i + 1} 镜（${sb.shots[i].type}）不换页：${r.why}`)
}
if (!picked.length) { say('没有任何一镜可换 → 原样输出'); done({ ok: false, skipped: sb.shots.length, note: 'none-mappable' }) }
if (picked.length > MAX_PAGES) { say(`可换镜数 ${picked.length} > 上限 ${MAX_PAGES} → 只换前 ${MAX_PAGES} 镜（其余留老画法）`); picked.length = MAX_PAGES }

// 4.2 字表预筛（命中表外字 → 那一镜不换）
const fontBad = []
for (let k = picked.length - 1; k >= 0; k--) {
  const txt = JSON.stringify(picked[k].page)
  if (!fontOk(txt)) { fontBad.push(picked[k].idx + 1); picked.splice(k, 1) }
}
if (fontBad.length) say('这些镜命中字表外字符 → 不换页：' + fontBad.join('、'))
if (!picked.length) { say('字表预筛后无可换镜 → 原样输出'); done({ ok: false, note: 'font-filtered' }) }

// 4.3 组装 deck：**第 1 页必须 cover**（schema 硬要求）⇒ 封面用影片自己的顶部标题/主题（不是编的），
//     并且**这个 cover 不贴回任何镜**（纯占位，满足页序约束）；页数不足 4 时用最后一页重复补齐（多渲的帧丢弃）。
const [masterId, palette] = skinOf()
const size = Array.isArray(sb.size) ? sb.size : [720, 1280]
const orientation = size[0] >= size[1] ? '16:9' : '9:16'
const banner = sb.banner || {}
const coverKicker = clip(banner.line2 || sb.topic || 'AI 营销', 32)
const padPage = JSON.parse(JSON.stringify(picked[picked.length - 1].page))
const pages = [{ type: 'cover', kicker: coverKicker }, ...picked.map((p) => p.page)]
const PAD = 4 // schema minItems
let padN = 0
while (pages.length < PAD) { pages.push(JSON.parse(JSON.stringify(padPage))); padN++ }
if (padN) say(`页数不足 ${PAD}（schema 下限）→ 补 ${padN} 页占位（多渲的帧丢弃）`)

const deck = {
  version: '1.0',
  meta: { title: clip(banner.line1 || sb.topic || 'AI 营销系统演示', 50), subtitle: clip(banner.line2 || coverKicker, 60), lang: 'zh-CN' },
  style: { masterId, palette, density: 'normal', tempo: 'normal', orientation },
  pages,
}

// 4.4 缓存：内容 hash（页 + 皮肤 + 画幅）→ 同一个 deck 只渲一次
const hash = crypto.createHash('sha1').update(JSON.stringify({ pages, masterId, palette, orientation })).digest('hex').slice(0, 12)
const name = 'pf' + hash
const deckPath = path.join(OUTDIR, name + '.json')
const framesDir = path.join(OUT_ROOT, name, 'frames')
// ⚠️ 帧名是 **0 基**（`p0-full.png` = 封面，实测 `html-deck/out/<deck>/frames/`）⇒
//    第 k 个"可换镜"（k 从 0 数）对应 deck 的第 k+1 页 ⇒ 帧名 `p{k+1}-full.png`。
const pngOf = (k) => path.join(framesDir, `p${k + 1}-full.png`)

if (DRY) { say(`dry-run：不渲染，deck 有 ${pages.length} 页（可换 ${picked.length} 镜）→ ${deckPath}`); done({ ok: true, pages: pages.length, swapped: 0, note: 'dry' }) }

let rendered = picked.every((_, k) => fs.existsSync(pngOf(k)))
if (!rendered) {
  try {
    fs.mkdirSync(OUTDIR, { recursive: true })
    fs.writeFileSync(deckPath, JSON.stringify(deck, null, 2), 'utf8')
    const t0 = Date.now()
    say(`渲染 ${name}（${pages.length} 页 → ${picked.length} 镜可用，master=${masterId}/${palette}，${orientation}）…`)
    const r = spawnSync(process.execPath, [RENDER_DECK, deckPath, '--outdir', OUT_ROOT], { encoding: 'utf8', timeout: 15 * 60 * 1000 })
    const tail = String(r.stdout || '').split('\n').filter((x) => /RESULT|✗|校验|RENDER total/.test(x)).slice(-3).join(' | ')
    if (r.status !== 0) { say(`渲染失败（exit ${r.status}）：${(tail || String(r.stderr || '')).slice(0, 240)}`); done({ ok: false, note: 'render-failed' }) }
    say(`渲染完成 ${((Date.now() - t0) / 1000).toFixed(1)}s · ${tail.slice(0, 160)}`)
  } catch (e) { say('渲染异常：' + String(e.message).slice(0, 160)); done({ ok: false, note: 'render-throw' }) }
}
if (!picked.every((_, k) => fs.existsSync(pngOf(k)))) { say('缺帧（部分页没渲出来）→ 原样输出，不换任何镜'); done({ ok: false, note: 'missing-frames' }) }

// 4.5 贴回：可换的镜 → type:'bgimage' + src:<png>，并**删掉 text**（页面自己已有标题层级，
//     再叠一层老引擎大字就是"字压字"）；subtitle 保留（字幕照常），dur 不动（时序真源不变）。
const out = JSON.parse(JSON.stringify(sb))
let swapped = 0
picked.forEach((p, k) => {
  const s = out.shots[p.idx]
  s.type = 'bgimage'
  s.src = pngOf(k)
  delete s.text
  delete s.variant
  // ★这四条是"整页设计图"的**必要姿态**（P0 本机实测踩出来的，缺一条就不对）：
  //   · frame:'none' —— 否则"编辑风"主题（news/data）会把素材缩成圆角卡片 + 背景虚化
  //     （VF_TPL_B1_V1 卡片版式），整页设计图被缩成一小块、四周一圈模糊复本（实测图就是这样坏的）。
  //   · kb:'none'    —— 否则每镜会自带推近（render.py 的 zoompan），推近=逐帧裁切，把页面安全边切掉。
  //   · _pptpage     —— 否则深色母版的页面会被 `_screen`（又深又满字→改质感底板）判废丢掉。
  //   · 删 text      —— 页面自己已有标题层级，再叠老引擎大字就是"字压字"。
  s.frame = 'none'
  s.kb = 'none'
  s._pptpage = true
  swapped++
})
out.pptpage = { version: 1, masterId, palette, orientation, pages: pages.length, swapped, skipped: sb.shots.length - swapped, deck: deckPath, at: new Date().toISOString() }
try {
  fs.mkdirSync(path.dirname(OUT_SB || '.'), { recursive: true })   // 调用方给的 wd 可能还没建（本机单测就踩到）
  fs.writeFileSync(OUT_SB, JSON.stringify(out, null, 2), 'utf8')
} catch (e) { say('写输出失败：' + String(e.message).slice(0, 120)); done({ ok: false, note: 'write-out' }) }
say(`换页完成：${swapped} 镜换成新引擎版式页 / ${sb.shots.length - swapped} 镜保持老画法 → ${OUT_SB}`)
done({ ok: true, swapped, skipped: sb.shots.length - swapped, pages: pages.length, out: OUT_SB })
