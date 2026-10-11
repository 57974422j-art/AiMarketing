/**
 * ★VF_LIBMERGE_V1（2026-10-11 用户定案）「把可以 PPT 和 HTML 用的一起汇总到 HTML，整理清楚可调用」
 * =============================================================================
 * 做什么：把 **PPT 母版**（`masters/master-<id>/master.json`）**展开成 HTML 成片认得的"风格包"**，
 *         落到 `styles/` 并合进 `styles/index.json`。
 * 为什么这样做（而不是在运行时给多个消费点打补丁）：
 *   HTML 线读取风格只有两处约定 —— ① 卡片读 `styles/index.json`（列清单）② 渲染读 `styles/<id>.json`。
 *   把母版**materialize 成同构的真实包文件**，这两处**一个字都不用改**就全通，
 *   自动挑赛道（`pickPack`）也自然能用（它只认 index 的 items）。
 * 映射口径（母版 → 风格包）：
 *   · **能直接用**：`bg` / `ink` / `palette.<名>.accent`（一个母版 × 4 配色 = 4 个包）
 *   · **推导**：`bg2`（同向 ±6%）、`dim`/`faint`（ink 施透明度）、`accentText`（accent 提亮）
 *   · **默认**：font/radius/density/grain/motion/elements（HTML 侧的排版与元素仍由 **HTML 自己的结构库**决定
 *     —— 母版带来的主要是**配色/明暗那层皮肤**；PPT 的版式几何（canvas/plot/image）HTML 不用，故不外带）
 *   · **新增**：`createdBy:"master"` + `srcMaster`/`srcPalette`/`srcAspect`（溯源，卡片与审计都靠它）
 * 幂等：重复跑只覆盖 `createdBy:"master"` 的包，**不动**原有内置包与运行时包。
 * 用法：node tools/build-styles-from-masters.mjs [--dry]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const STYLES = path.join(HERE, 'styles')
const MASTERS = path.join(HERE, 'masters')
const DRY = process.argv.includes('--dry')

/* 母版 → 赛道（HTML 的 verticals 用；让"自动挑赛道"也能挑到母版皮肤） */
const MASTER_VERTICAL = {
  tech: ['tech', 'education', 'b2b', 'medical', 'finance', 'recruit'],
  v1: ['b2b', 'finance', 'education'],
  v2: ['b2b', 'education', 'recruit'],
  ecom: ['ecommerce', 'food'],
  editorial: ['culture', 'food', 'travel'],
  festive: ['festival', 'food'],
  formal: ['b2b', 'finance', 'medical'],
  health: ['medical', 'health', 'education'],
  edu: ['education', 'recruit'],
  mono: ['culture', 'design', 'b2b'],
}

const hex = (s) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(s || '').trim())
  return m ? '#' + m[1].toLowerCase() : ''
}
const rgb = (h) => {
  const x = hex(h).slice(1)
  return [parseInt(x.slice(0, 2), 16), parseInt(x.slice(2, 4), 16), parseInt(x.slice(4, 6), 16)]
}
const toHex = (a) => '#' + a.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')
const lum = (h) => { const [r, g, b] = rgb(h); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 }
/** 同向调整亮度：亮底更亮、暗底更暗（bg2 用） */
const shade = (h, k) => {
  const [r, g, b] = rgb(h)
  const t = lum(h) > 0.5 ? 1 : 0
  return toHex([r + (t ? 255 - r : -r) * k, g + (t ? 255 - g : -g) * k, b + (t ? 255 - b : -b) * k])
}
/** 把颜色往"底色方向"混，得到次级/三级文字色（dim/faint） */
const mix = (fg, bg, k) => { const a = rgb(fg), b = rgb(bg); return toHex([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]) }

/** 一个母版的某配色 → 一个风格包
 *  ⚠️ 实测教训（2026-10-11 首次跑）：母版的配色名**可能是中文**（ecom = 品红/橙红/电蓝/蜜绿；
 *     formal = 绛红/焦棕/墨蓝/松绿）。若把非 ASCII 一律替换成 `-`，这 4 个会得到**同一个 id**
 *     ⇒ 互相覆盖（首次跑就少写了 6 个包，48 而不是 54 个文件）。
 *     现口径：ASCII 名直接用；非 ASCII ⇒ 用**该母版内配色的位置号** `p1..pN` 保证唯一，
 *     而 `name` / `srcPalette` **仍保留原始中文**（卡片显示与溯源都用中文，不丢信息）。 */
function packFromMaster(master, paletteName, paletteIdx) {
  const pal = (master.palette || {})[paletteName] || {}
  const bg = hex(master.bg) || '#0b1220'
  const ink = hex(master.ink) || '#e6f0f5'
  const accent = hex(pal.accent) || '#29d3c9'
  const light = lum(bg) > 0.5
  const ascii = /^[a-zA-Z0-9._-]+$/.test(String(paletteName))
  const id = `${master.id}-${ascii ? String(paletteName).toLowerCase() : 'p' + (paletteIdx + 1)}`
    .replace(/[^a-zA-Z0-9._-]/g, '-').toLowerCase()
  return {
    id,
    name: `${master.name || master.id} · ${paletteName}`,
    desc: `PPT 母版「${master.name || master.id}」的 ${paletteName} 配色（皮肤并入 HTML 成片；版式仍走 HTML 结构库）`,
    aspect: 'both',                       // 皮肤与画幅无关（横竖都能用）
    speed: 'normal',
    mood: light ? '高级' : '科技',
    vertical: MASTER_VERTICAL[master.id] || ['b2b'],
    tokens: {
      bg, bg2: shade(bg, 0.06),
      ink, dim: mix(ink, bg, 0.35), faint: mix(ink, bg, 0.55),
      accent, accentText: shade(accent, 0.18),
      font: 'sans-900', radius: 0, density: 'normal', grain: 0.02,
    },
    structure: ['pipeline-process'],       // 默认首选结构（HTML 结构库里的一个；编排仍会按素材自排）
    // 元素 id 一律取**库里真实存在**的（实测：chip-row 不存在 ⇒ 换成 caption-pill；否则编排会回退并打印）
    elements: ['bg-gradient-linear', 'grid-fine', 'title-duo', 'eyebrow-en', 'caption-bottom-big', 'caption-pill'],
    motion: { enter: 'wipe-in', emphasis: 'sweep', exit: 'crossfade-out', pace: 1.0 },
    prompt: `${master.name || master.id}（${paletteName}）配色：底色 ${bg} / 文字 ${ink} / 强调 ${accent}。`,
    refs: [],
    createdBy: 'master',                    // ★ 标记来源：便于"只覆盖母版派生的包"
    srcMaster: master.id,
    srcPalette: paletteName,
    srcAspect: Object.keys(master.canvas || {}),
  }
}

/** 读所有母版（含配色清单） */
function readMasters() {
  if (!fs.existsSync(MASTERS)) return []
  const out = []
  for (const d of fs.readdirSync(MASTERS)) {
    const f = path.join(MASTERS, d, 'master.json')
    if (!fs.existsSync(f)) continue
    try {
      const j = JSON.parse(fs.readFileSync(f, 'utf8'))
      if (j && j.id) out.push(j)
    } catch { /* 单个母版坏了不影响其它 */ }
  }
  return out
}

const masters = readMasters()
const made = []
for (const m of masters) {
  const pals = Object.keys(m.palette || {})
  if (!pals.length) { console.log('  ⚠️ ' + m.id + ' 没声明 palette ⇒ 跳过（不猜色）'); continue }
  pals.forEach((p, i) => made.push(packFromMaster(m, p, i)))
}
console.log(`母版 ${masters.length} 个 → 派生风格包 ${made.length} 个（${masters.map((m) => m.id).join(', ')}）`)

/* 写包文件 + 合进 index.json（只覆盖 createdBy:"master" 的，内置/运行时包原样保留） */
const idxPath = path.join(STYLES, 'index.json')
const idx = JSON.parse(fs.readFileSync(idxPath, 'utf8'))
const oldItems = Array.isArray(idx.items) ? idx.items : []
const keep = oldItems.filter((x) => x && x.createdBy !== 'master')
const newItems = made.map((p) => ({
  id: p.id, name: p.name, mood: p.mood, desc: p.desc,
  createdBy: 'master', srcMaster: p.srcMaster, srcPalette: p.srcPalette,
}))
const merged = [...keep, ...newItems]

if (!DRY) {
  for (const p of made) fs.writeFileSync(path.join(STYLES, p.id + '.json'), JSON.stringify(p, null, 2) + '\n', 'utf8')
  // 清掉旧的母版派生包（母版或配色被删时不能留孤儿）
  for (const x of oldItems) {
    if (x && x.createdBy === 'master' && !made.some((p) => p.id === x.id)) {
      const f = path.join(STYLES, x.id + '.json')
      if (fs.existsSync(f)) fs.unlinkSync(f)
    }
  }
  const next = {
    ...idx,
    generatedNote: 'index 由 tools/build-styles-from-masters.mjs 合并（内置包 + 母版派生包）',
    counts: { ...(idx.counts || {}), styles: merged.length, masterDerived: newItems.length },
    items: merged,
  }
  fs.writeFileSync(idxPath, JSON.stringify(next, null, 2) + '\n', 'utf8')
}

console.log(`样式清单：${oldItems.length} → ${merged.length}（内置 ${keep.length} + 母版派生 ${newItems.length}）${DRY ? '（--dry 未写盘）' : ''}`)
console.log('前 6 个新包：' + newItems.slice(0, 6).map((x) => x.id).join(', '))
