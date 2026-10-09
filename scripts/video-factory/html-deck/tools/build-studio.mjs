#!/usr/bin/env node
/**
 * ★VF_STUDIO_V1 —— 风格包管理器构建脚本
 * =============================================================================
 * 做三件事（**只读数据 + 写产物**，不改任何链路代码）：
 *   ① 读 styles/*.json（风格包）+ elements/*.json（四张表）+ styles/verticals.json（赛道）
 *   ② 给每张风格包**抽缩略图**（用它的 example 字段：`out/xxx.mp4#6.2s`；支持 `ref:` 外部视频）
 *   ③ 把数据内嵌进 tools/studio.tpl.html → 生成 **tools/style-studio.html**（双击即可打开）
 *   ④ 同时生成 styles/index.json（给别的工具/AGENT 读的清单）
 *
 * 用法：node tools/build-studio.mjs
 * 产物：tools/style-studio.html · styles/index.json · styles/thumbs/*.jpg
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
// ★VF_LIBV2_V1（2026-10-09 用户定案 A「把库资产都合并了」）：
//   本脚本从此**不只读 styles/** —— 也读 masters/（deck 母版 10 套，PPT成片线用的那批）。
//   为什么：那 10 套以前**只有代码里知道**（vf-deck-render.ts 的 DECK_SKINS），管理台完全看不到，
//   于是"库"被拆成了两半。现在并到同一次构建、同一个页面里（资产一处可见）。
//   ⚠️ 母版是**只读**资产（改它要动 masters/<dir> 里的代码 + 重新生成）⇒ 本页只列 + 看封面，不提供编辑。
//   IMPL 来自 pack-to-page（★VF_PACK2PAGE_V2）⇒ 给每套风格包标"可当页 / 仅镜头组"，不许静默回退。
import { IMPL } from './pack-to-page.mjs'

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')   // html-deck/
const STYLES = path.join(HERE, 'styles')
const ELEMENTS = path.join(HERE, 'elements')
const THUMBS = path.join(STYLES, 'thumbs')
const TPL = path.join(HERE, 'tools', 'studio.tpl.html')
const OUT = path.join(HERE, 'tools', 'style-studio.html')

const rd = (p) => JSON.parse(fs.readFileSync(p, 'utf8'))
// ★ 排除清单：下划线开头（_schema.json）+ 生成物（index.json）+ **同目录的表（verticals.json）**
//   —— 实测踩过：只排前两个，`verticals.json` 会被当成第 9 张"风格包"混进管理器。
const NOT_A_PACK = new Set(['index.json', 'verticals.json'])
const listJson = (dir) => fs.readdirSync(dir).filter((f) => f.endsWith('.json') && !f.startsWith('_') && !NOT_A_PACK.has(f))

// ---------------- ① 读数据 ----------------
const elements = rd(path.join(ELEMENTS, 'elements.json'))
const structures = rd(path.join(ELEMENTS, 'structures.json'))
const motions = rd(path.join(ELEMENTS, 'motions.json'))
const shotgroups = rd(path.join(ELEMENTS, 'shotgroups.json'))
const verticals = rd(path.join(STYLES, 'verticals.json'))

const packs = listJson(STYLES).map((f) => {
  const p = rd(path.join(STYLES, f))
  p.__file = f
  return p
})

// ---------------- ①b 读 deck 母版（★VF_LIBV2_V1） ----------------
// 与风格包并列的"另一半资产"：masters/<dir>/master.json（10 套，PPT成片线用，**有配音**）。
// 之前管理台完全看不到这批（只有 vf-deck-render.ts 的 DECK_SKINS 知道）⇒ 现在并到同一份清单里。
const MASTERS = path.join(HERE, 'masters')
const masters = (() => {
  let ds = []
  try { ds = fs.readdirSync(MASTERS, { withFileTypes: true }) } catch { return [] }
  return ds.filter((d) => d.isDirectory() && d.name.startsWith('master-')).map((d) => {
    const dir = d.name
    let j = {}
    try { j = rd(path.join(MASTERS, dir, 'master.json')) } catch { /* 坏母版跳过，不让整个构建挂掉 */ }
    const has = (f) => { try { return fs.existsSync(path.join(MASTERS, dir, f)) } catch { return false } }
    return {
      id: j.id || dir,
      name: j.name || dir,
      dir,
      cover: 'masters/' + dir + '/' + (j.cover || 'cover.jpg'),
      pages: j.page || 0,
      fonts: (j.fonts && j.fonts.files) || [],
      vertical: has('master-9x16.html'), horizontal: has('master-16x9.html'),
      note: String(j._note || '').slice(0, 140),
    }
  }).sort((a, b) => a.id.localeCompare(b.id))
})()

// ---------------- ② 抽缩略图 ----------------
fs.mkdirSync(THUMBS, { recursive: true })
let thumbOk = 0, thumbSkip = 0
for (const p of packs) {
  const out = path.join(THUMBS, p.id + '.jpg')
  p.thumb = 'styles/thumbs/' + p.id + '.jpg'
  const ex = String(p.example || '')
  if (!ex) { thumbSkip++; continue }
  const [rawPath, tRaw] = ex.split('#')
  const t = Math.max(0.05, parseFloat(tRaw || '2') || 2)
  const src = rawPath.startsWith('ref:') ? rawPath.slice(4) : path.resolve(HERE, rawPath)
  if (!fs.existsSync(src)) { console.log(`  · 缩略图跳过（源不存在）：${p.id} ← ${src}`); thumbSkip++; continue }
  const r = spawnSync('ffmpeg', ['-nostdin', '-y', '-v', 'error', '-ss', String(t), '-i', src,
    '-frames:v', '1', '-vf', 'scale=320:-1', out], { encoding: 'utf8' })
  if (r.status === 0 && fs.existsSync(out)) { thumbOk++; }
  else { console.log(`  · 缩略图失败：${p.id}（${String(r.stderr || '').slice(0, 120)}）`); thumbSkip++ }
}

// ---------------- ③ 清单 ----------------
const index = {
  version: '0.1',
  builtAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
  note: '风格包清单（由 tools/build-studio.mjs 生成；管理器页面读内嵌数据，这个文件给 AGENT/其它工具读）',
  counts: { styles: packs.length, masters: masters.length, elements: elements.items.length, structures: structures.items.length, motions: motions.items.length, shotgroups: shotgroups.items.length, verticals: verticals.items.length },
  // ★VF_PACK2PAGE_V2（用户定案 C）：已实现的"页型"清单 —— 判断某套风格包能不能"当页用"就看这个
  //   （structure[0] 不在其中 ⇒ 当页/试片会回落 opening-hero，管理台会显式提示，不再静默）
  impl: IMPL,
  items: packs.map((p) => ({
    id: p.id, name: p.name, desc: p.desc, aspect: p.aspect, speed: p.speed, mood: p.mood,
    vertical: p.vertical, structure: p.structure, thumb: p.thumb, example: p.example, createdBy: p.createdBy || 'builtin',
    canPage: IMPL.includes((p.structure || [])[0] || 'opening-hero'),
  })),
  // ★VF_LIBV2_V1（用户定案 A）：deck 母版也进这份清单（只读资产）—— 别的工具/AGENT 读一处就够
  masters: masters.map((m) => ({ id: m.id, name: m.name, dir: m.dir, cover: m.cover, vertical: m.vertical, horizontal: m.horizontal, fonts: m.fonts })),
}
fs.writeFileSync(path.join(STYLES, 'index.json'), JSON.stringify(index, null, 2) + '\n', 'utf8')

// ---------------- ④ 生成管理器页面 ----------------
const DB = {
  styles: packs.map((p) => { const q = { ...p }; delete q.__file; return q }),
  // ★VF_LIBV2_V1（用户定案 A）：母版并入同一个界面（烤进页面 ⇒ 离线双击 file:// 也能列出来）
  masters,
  // ★VF_PACK2PAGE_V2（用户定案 C）：已实现页型清单 ⇒ 管理台给每套风格包标"可当页 / 仅镜头组"
  impl: IMPL,
  lib: { elements, structures, motions, shotgroups, verticals: verticals.items },
}
const tpl = fs.readFileSync(TPL, 'utf8')
if (!tpl.includes('/*__DATA__*/')) { console.error('模板缺少 /*__DATA__*/ 占位'); process.exit(2) }
fs.writeFileSync(OUT, tpl.replace('/*__DATA__*/', 'window.DB = ' + JSON.stringify(DB) + ';'), 'utf8')

// ⑤ 同时生成「30 秒素材片 · 出片工作台」（与管理器共用同一份风格包数据）
const LAB_TPL = path.join(HERE, 'tools', 'film-lab.tpl.html')
const LAB_OUT = path.join(HERE, 'tools', 'film-lab.html')
if (fs.existsSync(LAB_TPL)) {
  const lt = fs.readFileSync(LAB_TPL, 'utf8')
  if (lt.includes('/*__DATA__*/')) {
    fs.writeFileSync(LAB_OUT, lt.replace('/*__DATA__*/', 'window.DB = ' + JSON.stringify(DB) + ';'), 'utf8')
    console.log(`工作台：${path.relative(HERE, LAB_OUT)}   ← 出片入口（上传素材 → 选风格 → 出片）`)
  }
}

console.log(`风格包 ${packs.length} 张 · 元素 ${elements.items.length} · 结构 ${structures.items.length} · 动效 ${motions.items.length} · 镜头组 ${shotgroups.items.length} · 赛道 ${verticals.items.length}`)
console.log(`缩略图：成功 ${thumbOk} · 跳过/失败 ${thumbSkip}`)
console.log(`清单：${path.relative(HERE, path.join(STYLES, 'index.json'))}`)
console.log(`管理器：${path.relative(HERE, OUT)}   ← 双击即可打开（不需要命令行）`)
