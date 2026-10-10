#!/usr/bin/env node
/**
 * ★VF_ORCHESTRATE_V1 —— 「AI 编排」：素材 → 赛道 / 风格包 / 镜头组 / 文案
 * =============================================================================
 * 这是批次 2.4 的核心。设计原则（对应我们前几轮定下的规矩）：
 *   ① **AI 只做"选 + 填"，不画页面** ⇒ 它只能引用库里的 id（styles / shotgroups / structures / elements）
 *   ② **越界必回退** ⇒ 有专门的校验器 validate()：任何不存在的 id 一律替换成默认值并记 fallback
 *   ③ **永不失败** ⇒ 规则版（rule）离线就能出合法编排；AI 版（brief→agent→validate）是增强，不是依赖
 *
 * 三种用法（CLI）：
 *   node tools/orchestrate.mjs rule     --materials a.jpg,b.jpg [--text "旅游 攻略"] [--pack xxx] --out film.json
 *   node tools/orchestrate.mjs brief    --materials a.jpg,b.jpg [--text "…"]          # 输出给 AI 的编排简报
 *   node tools/orchestrate.mjs validate <编排.json> [--materials …] [--fix] --out film.json
 * 三种用法（import）：orchestrateRule / buildBrief / validateOrchestration
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { arrange } from './arrange.mjs'

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const rd = (p) => JSON.parse(fs.readFileSync(p, 'utf8'))
const STYLES_DIR = path.join(HERE, 'styles')

export function loadLibrary() {
  const idx = rd(path.join(STYLES_DIR, 'index.json'))
  const verticals = rd(path.join(STYLES_DIR, 'verticals.json')).items
  const shotgroups = rd(path.join(HERE, 'elements', 'shotgroups.json')).items
  const structures = rd(path.join(HERE, 'elements', 'structures.json')).items
  const motions = rd(path.join(HERE, 'elements', 'motions.json')).items
  const elements = rd(path.join(HERE, 'elements', 'elements.json')).items
  return {
    styles: idx.items,
    verticals, shotgroups, structures, motions, elements,
    ids: {
      style: new Set(idx.items.map((x) => x.id)),
      structure: new Set(structures.map((x) => x.id)),
      shotgroup: new Set(shotgroups.map((x) => x.id)),
      motion: new Set(motions.map((x) => x.id)),
      element: new Set(elements.map((x) => x.id)),
      vertical: new Set(verticals.map((x) => x.id)),
    },
  }
}

/* ---------------- ① 读素材：文件名 + 主色（不联网、不训练） ---------------- */
function fileNameOnly(p) { return String(p).replace(/^.*[\\/]/, '').replace(/\.[a-z0-9]+$/i, '') }

export function analyzeMaterials(files) {
  return (files || []).map((f) => {
    const file = typeof f === 'string' ? f : f.file
    const abs = path.isAbsolute(file) ? file : path.resolve(file)
    let color = (typeof f === 'object' && f.color) || null
    let light = null
    if (!color && fs.existsSync(abs)) {
      const r = spawnSync('ffmpeg', ['-nostdin', '-v', 'error', '-i', abs, '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { encoding: 'buffer', maxBuffer: 4096 })
      const b = r.stdout
      if (b && b.length >= 3) { color = { r: b[0], g: b[1], b: b[2] }; light = (0.2126 * b[0] + 0.7152 * b[1] + 0.0722 * b[2]) / 255 }
    }
    return { file, name: fileNameOnly(file), color, light, exists: fs.existsSync(abs) }
  })
}

/* ---------------- ② 判赛道：关键词权重 3 + 颜色权重 2（见 verticals.json 的 detect） ---------------- */
export function pickVertical(lib, { text = '', mats = [] } = {}) {
  const t = String(text).toLowerCase()
  const score = {}
  const why = {}
  for (const v of lib.verticals) {
    let s = 0, hits = []
    for (const h of (v.hints || [])) {
      if (h && t.includes(String(h).toLowerCase())) { s += 3; hits.push(h) }
    }
    // 颜色倾向：暖色偏餐饮/宠物/电商，冷色偏科技/B2B/金融
    const warm = /美食|餐饮|宠物|母婴|农产品|活动|展会|电商/.test(v.name)
    const cool = /科技|金融|B2B|企业|汽车|数码|医疗|政务/.test(v.name)
    for (const m of mats) {
      if (m.light == null) continue
      const warmPix = m.color ? (m.color.r > m.color.b + 18) : false
      if (warmPix && warm) s += 2
      if (!warmPix && cool) s += 1
    }
    if (s > 0) { score[v.id] = s; why[v.id] = hits }
  }
  const ranked = Object.keys(score).sort((a, b) => score[b] - score[a]).slice(0, 3)
  const top = ranked[0]
  const conf = top ? score[top] : 0
  const chosen = conf >= 4 ? top : 'general'
  return { vertical: chosen, candidates: ranked.map((id) => ({ id, score: score[id], hits: why[id] })), confidence: conf, reason: conf >= 4 ? '关键词/颜色命中' : '命中不足 ⇒ 落通用' }
}

/* ---------------- ③ 选风格包：赛道的 prefer 优先，其次 vertical 命中 ---------------- */
export function pickPack(lib, { vertical, text = '', prefer, variant = 0 } = {}) {
  if (prefer && lib.ids.style.has(prefer)) return { pack: prefer, reason: '用户指定' }
  const vdef = lib.verticals.find((v) => v.id === vertical)
  const preferIds = ((vdef && vdef.prefer) || []).filter((id) => lib.ids.style.has(id))
  // ★ 变体：同一赛道多次出片时，在推荐位里轮换 ⇒ "每次不同风格"但**始终在库内**（用户 10-08 的诉求）
  if (preferIds.length) {
    const idx = Math.abs(Number(variant) || 0) % preferIds.length
    return { pack: preferIds[idx], reason: '赛道 ' + vertical + ' 的推荐位[' + idx + '/' + preferIds.length + ']' }
  }
  const byVertical = lib.styles.find((s) => (s.vertical || []).includes(vertical))
  if (byVertical) return { pack: byVertical.id, reason: '风格包声明适用该赛道' }
  return { pack: 'reel-showcase', reason: '兜底（素材展示型）' }
}

/* ---------------- ④ 规则版编排（离线保底，永不失败） ---------------- */
// ★VF_FILMFORK_V2（2026-10-10 用户实测「出片被拦（layout）：转场只有 0 种」）：
//   病灶 = **同一个"吞字段"老毛病又犯一次** —— arrange 给每段算好了 `trans`（fade/wipe/cut/push 轮换），
//   而这里重拼 scenes 时只挑了 shotgroup/structure/dur/slots/media ⇒ `trans` 被丢掉 ⇒
//   render-film 数出"转场 0 种" ⇒ 被排版闸门拒渲（闸门是对的，是我喂给它的数据缺字段）。
//   现口径：转场字段**在这里统一兜底**（缺了就按同一张表轮换补上，并打日志），
//   避免"编排器算了、导出时丢了"这类事再发生。
const ORCH_TRS = ['fade', 'wipe', 'cut', 'push']
function withTrans(scenes) {
  let filled = 0
  const out = (scenes || []).map((s, i) => {
    const t = String((s && s.trans) || '')
    if (!t) filled++
    return Object.assign({}, s, { trans: t || ORCH_TRS[i % ORCH_TRS.length] })
  })
  if (filled) console.log('[orchestrate] 有 ' + filled + ' 段没带 trans ⇒ 按 fade/wipe/cut/push 轮换补上（不静默）')
  return out
}

export function orchestrateRule(opts = {}) {
  const lib = opts.lib || loadLibrary()
  const mats = opts.mats || analyzeMaterials(opts.materials || [])
  const vertical = opts.vertical || pickVertical(lib, { text: opts.text, mats }).vertical
  const pack = opts.pack || pickPack(lib, { vertical, text: opts.text, variant: opts.variant }).pack
  const media = mats.map((m) => m.file)
  const film = arrange({
    id: opts.id || 'orch-' + Date.now(),
    name: opts.name || 'HTML成片（自动编排）',   // ★VF_HTMLCMD_V1：旧名「素材片」→「HTML成片」
    pack,
    media,
    slots: opts.slots || {},
  })
  return {
    source: 'rule',
    vertical,
    pack,
    // ★VF_FILMFORK_V2：`trans` 必须带出去（少了它，排版闸门会数出"转场 0 种"而拒渲）
    scenes: withTrans(film.scenes.map((s) => ({ shotgroup: s.shotgroup, structure: s.structure, dur: s.dur, slots: s.slots, media: s.media, trans: s.trans }))),
    total: film.total,
    // ★VF_FILMSRC_V1（2026-10-10）：**这几个字段必须带出去** —— arrange 已经算好了
    //   "完整大图配额"（requirePlate / plateCount / imageCount），而这里原来只挑了
    //   source/vertical/pack/scenes/total/materials/rationale ⇒ **requirePlate 被丢掉**
    //   ⇒ 出片时 render-film 那条 `stage=plate` 硬闸门**根本不会跑**。
    //   （这就是"改了一半"的典型：闸门加了、但传参链上被吞掉。）
    requirePlate: !!film.requirePlate,
    plateCount: Number(film.plateCount) || 0,
    imageCount: Number(film.imageCount) || 0,
    // ★VF_LAYOUTGATE_V1：排版纪律（页型/图数/转场要有变化）的硬口径也要带出去，否则同"被吞掉"
    requireLayout: !!film.requireLayout,
    materials: mats.map((m) => ({ file: m.file, name: m.name, light: m.light })),
    rationale: [
      '赛道：' + vertical,
      '风格包：' + pack,
      '编排：' + film.scenes.length + ' 段 / ' + film.total + 's（工具自动编排，素材不足的段留空）',
      '完整大图配额：' + (Number(film.plateCount) || 0) + '/' + (Number(film.imageCount) || 0)
        + ' = 每 10 张 ' + (((Number(film.plateCount) || 0) / Math.max(1, Number(film.imageCount) || 1)) * 10).toFixed(1)
        + ' 张（要求 3~4）' + (film.requirePlate ? ' · 硬口径' : ''),
    ],
  }
}

/* ---------------- ⑤ 给 AI 的编排简报（agent 拿它去"选 + 填"） ---------------- */
export function buildBrief(opts = {}) {
  const lib = opts.lib || loadLibrary()
  const mats = opts.mats || analyzeMaterials(opts.materials || [])
  const v = pickVertical(lib, { text: opts.text, mats })
  return {
    task: '为一组素材编排一条竖屏短视频（9:16）。你只做四件事：判赛道、选风格包、选镜头组、填文案。不许发明库里没有的 id。',
    materialsBrief: mats.map((m, i) => ({ i, name: m.name, 明度: m.light == null ? '未知' : m.light.toFixed(2), 建议: m.light != null && m.light > 0.6 ? '亮底素材' : '暗底素材' })),
    allowed: {
      structure: [...lib.ids.structure],
      style: lib.styles.map((s) => ({ id: s.id, name: s.name, mood: s.mood, vertical: s.vertical })),
      shotgroup: lib.shotgroups.map((s) => ({ id: s.id, name: s.name, structure: s.structure, dur: s.dur })),
      vertical: [...lib.ids.vertical],
    },
    guess: { vertical: v.vertical, candidates: v.candidates, pack: pickPack(lib, { vertical: v.vertical, variant: opts.variant }).pack },
    variant: '同一赛道可在推荐位里轮换（variant 0/1/2…）⇒ 每次不同但都在库内',
    outputSchema: {
      vertical: 'string（必须是 allowed.vertical 之一）',
      pack: 'string（必须是 allowed.style[].id 之一）',
      scenes: '[{ structure:string（allowed.structure 之一）, dur:number, slots:object, media:[文件名] }]',
    },
    note: '产物会先过校验器：任何库外 id 会被替换成默认值并记为 fallback（所以宁可选不准，也不要发明 id）。',
  }
}

/* ---------------- ⑥ 校验/修正：越界回退（"只能引用库内 id"的兜底） ---------------- */
export function validateOrchestration(o, opts = {}) {
  const lib = opts.lib || loadLibrary()
  const fb = []
  const def = orchestrateRule(Object.assign({}, opts, { lib }))
  const out = { source: o.source || 'ai', vertical: o.vertical, pack: o.pack, scenes: [], rationale: o.rationale || [], fallbacks: fb }

  if (!lib.ids.vertical.has(out.vertical)) { fb.push('vertical:' + out.vertical + ' → ' + def.vertical); out.vertical = def.vertical }
  if (!lib.ids.style.has(out.pack)) { fb.push('pack:' + out.pack + ' → ' + def.pack); out.pack = def.pack }

  const scenes = Array.isArray(o.scenes) && o.scenes.length ? o.scenes : def.scenes
  const fileNames = (opts.materials || []).map((f) => (typeof f === 'string' ? f : f.file))
  const base = path.dirname(opts.filmPath || path.join(HERE, 'x.json'))
  // ★VF_FILMSRC_V1（2026-10-10 用户定案「我给 50 张图你也做 8 个镜头？」）：
  //   段数**只由素材张数决定**（arrange 的规则算出来），这里原来 `slice(0, 12)` 会把
  //   大素材量的片砍到 12 段 ⇒ 素材没出全、文案也对不上。现在只留一个**保护性**上限（60 段，
  //   防的是异常输入，不是"限制用户素材"），要改请改这里一处。
  const SCENE_MAX = Math.max(12, Number(process.env.VF_FILM_SCENE_MAX || 60) || 60)
  if (scenes.length > SCENE_MAX) fb.push('scenes:' + scenes.length + ' 段 → 截到 ' + SCENE_MAX + ' 段（保护性上限）')
  for (const sc of scenes.slice(0, SCENE_MAX)) {
    const st = lib.ids.structure.has(sc.structure) ? sc.structure : 'opening-hero'
    if (st !== sc.structure) fb.push('structure:' + sc.structure + ' → ' + st)
    const sg = lib.ids.shotgroup.has(sc.shotgroup) ? sc.shotgroup : (lib.shotgroups.find((x) => x.structure === st) || {}).id || ''
    if (sg !== sc.shotgroup) fb.push('shotgroup:' + sc.shotgroup + ' → ' + sg)
    const dur = Math.max(2, Math.min(12, Number(sc.dur) || 4))
    const media = (sc.media || []).filter((m) => {
      const p = path.resolve(base, m)
      const ok = fs.existsSync(p) || fileNames.some((f) => path.resolve(f) === p || path.basename(f) === path.basename(p))
      if (!ok) fb.push('media:' + m + ' → 丢弃（文件不存在）')
      return ok
    })
    // ★VF_FILMFORK_V2：AI 编排通常不写 trans ⇒ 先原样带上，循环结束后统一兜底补（见 withTrans）
    out.scenes.push({ shotgroup: sg, structure: st, dur, slots: sc.slots || {}, media, trans: String(sc.trans || '') })
  }
  out.scenes = withTrans(out.scenes)   // ★VF_FILMFORK_V2：缺 trans 的段统一补上（AI 编排常常不写）
  out.total = +out.scenes.reduce((a, s) => a + s.dur, 0).toFixed(2)
  // ★VF_FILMSRC_V1：配额声明按**最终 scenes 现算**（AI 自己排的也算数）——
  //   段落数/图数只由素材张数决定，不封顶；完整大图占不到每 10 张 3~4 张 ⇒ 出片时会被 stage=plate 拒。
  out.imageCount = out.scenes.reduce((a, s) => a + ((s.media || []).length), 0)
  out.plateCount = out.scenes.filter((s) => /^plate-/.test(String(s.structure))).length
  out.requirePlate = out.imageCount >= 10
  out.requireLayout = out.imageCount >= 8   // ★VF_LAYOUTGATE_V1：素材够多就该有排版变化（页型/图数/转场）
  return out
}

/* ---------------- CLI ---------------- */
const isCli = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
if (isCli) {
  const args = process.argv.slice(2)
  const arg = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d }
  const cmd = args[0]
  const materials = (arg('materials', '') || '').split(',').map((s) => s.trim()).filter(Boolean)
    .map((m) => (path.isAbsolute(m) ? m : path.resolve(arg('basedir', '.'), m)))
  const text = arg('text', '')
  const lib = loadLibrary()
  const mats = analyzeMaterials(materials)

  if (cmd === 'rule') {
    const o = orchestrateRule({ lib, mats, materials: materials, text, pack: arg('pack', ''), id: arg('id', 'orch'), variant: Number(arg('variant', '0')) || 0 })
    const out = arg('out', '')
    if (out) { fs.writeFileSync(out, JSON.stringify(o, null, 2) + '\n', 'utf8'); console.log('已写：' + out) }
    console.log(`赛道=${o.vertical} 风格包=${o.pack} ${o.scenes.length} 段 ${o.total}s`)
    console.log(o.rationale.join('\n'))
  } else if (cmd === 'brief') {
    console.log(JSON.stringify(buildBrief({ lib, mats, materials, text }), null, 2))
  } else if (cmd === 'validate') {
    const f = args[1] && !args[1].startsWith('--') ? args[1] : arg('in', '')
    if (!f || !fs.existsSync(f)) { console.error('用法: validate <编排.json> [--materials a,b] [--out film.json]'); process.exit(2) }
    const j = JSON.parse(fs.readFileSync(f, 'utf8'))
    const v = validateOrchestration(j, { lib, materials, filmPath: f })
    const out = arg('out', '')
    if (out) {
      // id 取**输出文件名**（否则成片会都叫 orch.mp4，现场分不清哪条是哪条 —— 实测踩过）
      const id = j.id || path.basename(out, '.json')
      // ★VF_FILMSRC_V1：**必须把配额声明写进 film.json**，否则出片时 `stage=plate` 那条硬闸门不跑
      fs.writeFileSync(out, JSON.stringify({
        id, name: j.name || 'HTML成片', pack: v.pack, fps: 25,
        requirePlate: !!v.requirePlate, plateCount: v.plateCount, imageCount: v.imageCount,
        requireLayout: !!v.requireLayout,
        scenes: v.scenes,
      }, null, 2) + '\n', 'utf8')
      console.log('已写：' + out)
    }
    console.log('fallback ' + v.fallbacks.length + ' 处' + (v.fallbacks.length ? '：\n  ' + v.fallbacks.join('\n  ') : ''))
  } else {
    console.log('用法：orchestrate.mjs rule|brief|validate …  （见文件头注释）')
    process.exit(2)
  }
}
