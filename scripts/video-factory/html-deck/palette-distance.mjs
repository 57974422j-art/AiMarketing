#!/usr/bin/env node
/**
 * palette-distance.mjs —— **配色可辨性量尺（唯一实现）**：给每套母版的调色板算"最近一对"的**感知距离**
 *
 * 为什么要有它（K25 的证据必须**可独立复跑**）：
 *   · 交付物对外报过"8 皮肤 × 4 配色 = 32 组合"，但**多套皮肤的 4 个配色肉眼几乎同色** ⇒
 *     "宣称的维度"必须能被**读数**证实，否则只能按**名义维度**报数。
 *   · ★ 教训（本工具存在的第二个理由）：我第一版用 **ΔRGB（sRGB 欧氏）** 当量尺 ⇒ 对**深色/低饱和**配色
 *     **低估**可辨性 ⇒ 与感知尺 **ΔE76（CIELAB · D65）** 在 **4/8 套**上给出**相反判定**（冤枉了 4 套皮肤）。
 *     ⇒ 判据换成 ΔE76 为主、ΔRGB 只作对照；`--self-test` 里**专门留了一个"两把尺判定不同"的样本**
 *       （深色对：ΔRGB 说"名义"、ΔE76 说"可辨"）—— **量尺本身也要能被证伪**。
 *
 * 用法：
 *   node palette-distance.mjs [--skin master-v1] [--min-de 20] [--json] [--self-test]
 *     · 默认：逐套打印"最近一对 ΔE76 / ΔRGB + 判定 + 色名"
 *     · `--min-de <n>`：**判据模式** —— 任一套的最近一对 ΔE76 < n ⇒ 红（exit 1）⇒ 可当闸门用
 *     · `--json`：机读输出（供上层脚本对账）
 *     · `--self-test`：合成样本自证（含"ΔRGB 与 ΔE76 判定不同"的关键样本）
 *
 * 判据档（经验）：ΔE76 <10 **几乎不可辨** · 10~20 **弱（细看才能分）** · >20 **可辨** · ≥30 **明显**
 * 退出码：0 通过 · 1 判据失败（--min-de 不满足）· 2 输入/环境错误
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { MASTERS_DIR } from './paths.mjs'

const EXIT = { OK: 0, FAIL: 1, INPUT: 2 }

/* ---------------- 旗标：全部登记（未登记 ⇒ 大声红；本仓"引用须登记"纪律） ---------------- */
const FLAGS = {
  '--skin': 'skin', '--min-de': 'minDe', '--json': 'json', '--self-test': 'selfTest',
}
/* ★★ 旗标类型（唯一真源）：哪些选项键是 bool —— 解析器从这里派生（不手写第二份名单） */
const BOOL_KEYS = new Set(['json', 'selfTest'])
const A = {}
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i]
  if (!(a in FLAGS)) {
    console.error(`✗ 未识别的参数：${a}`)
    console.error(`   允许：${Object.keys(FLAGS).join(' ')}`)
    process.exit(EXIT.INPUT)
  }
  const key = FLAGS[a]
  if (BOOL_KEYS.has(key)) { A[key] = true; continue }
  A[key] = process.argv[++i]
}

/* ★★ 旗标三件套覆盖断言（与 mux-video / make-video 同款）：注册表 ⊇ 源码字面量 ∧ 每个注册项真被消费 */
{
  const src = readFileSync(new URL(import.meta.url), 'utf8')
  const found = [...new Set([...src.matchAll(/'(--[a-zA-Z][\w-]*)'/g)].map((m) => m[1]))]
  const known = new Set(Object.keys(FLAGS))
  const missing = found.filter((f) => !known.has(f))
  const dead = [...known].filter((n) => !new RegExp(`\\bA\\.${FLAGS[n]}\\b`).test(src))
  const keys = Object.values(FLAGS)
  const boolNotRegistered = [...BOOL_KEYS].filter((k) => !keys.includes(k))
  const usesBool = /BOOL_KEYS\.has\(/.test(src)
  const valuePath = /A\[key\]\s*=\s*process\.argv\[\+\+i\]/.test(src)
  if (boolNotRegistered.length || !usesBool || !valuePath) {
    console.error(`✗ 旗标三件套-④ 类型断言失败：未注册键 ${boolNotRegistered.join(' ') || '（无）'} · 用 BOOL_KEYS=${usesBool} · 有值路径=${valuePath}`)
    process.exit(EXIT.INPUT)
  }
  if (missing.length || dead.length) {
    console.error(`✗ 旗标三件套断言失败：注册表不全 ${missing.join(' ') || '（无）'} · 注册未消费 ${dead.join(' ') || '（无）'}`)
    process.exit(EXIT.INPUT)
  }
  console.log(`  ✓ 旗标三件套：注册 **${known.size}** · 源码字面量 **${found.length}** 全部已登记 · 死旗标 **0** · bool 由声明派生 ✓`)
}

/* ---------------- 颜色数学（ΔE76 = CIELAB 欧氏；sRGB → 线性 → XYZ(D65) → Lab） ---------------- */
import { hex2rgb } from './color.mjs'   /* ★ 颜色工具**唯一实现**（此前本文件是 5 份副本之一；同名 ∴ 零调用点改动；语义 1:1：认 3/6 位、非法 null） */
function rgb2lab(rgb) {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  })
  const X = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047
  const Y = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 1.0
  const Z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  const [fx, fy, fz] = [f(X), f(Y), f(Z)]
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}
const dE76 = (a, b) => {
  const [A1, A2] = [rgb2lab(a), rgb2lab(b)]
  return Math.hypot(A1[0] - A2[0], A1[1] - A2[1], A1[2] - A2[2])
}
const distRGB = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

const band = (de) => (de < 10 ? '**几乎不可辨**' : de < 20 ? '**弱（细看才能分）**' : de < 30 ? '可辨' : '明显')

/** 取最近一对（按给定度量）——返回 {de, rgb, a, b}（a/b 是色名） */
function closestPair(entries, fn) {
  let best = { v: Infinity, a: '', b: '' }
  for (let i = 0; i < entries.length; i++) for (let j = i + 1; j < entries.length; j++) {
    const v = fn(entries[i].rgb, entries[j].rgb)
    if (v < best.v) best = { v, a: entries[i].name, b: entries[j].name }
  }
  return best
}

function readMasters(only) {
  const out = []
  for (const s of readdirSync(MASTERS_DIR)) {
    const p = join(MASTERS_DIR, s, 'master.json')
    if (!existsSync(p)) continue
    if (only && s !== only && s !== 'master-' + only) continue
    const m = JSON.parse(readFileSync(p, 'utf8'))
    const keys = Object.keys(m.palette || {})
    const entries = []
    for (const k of keys) {
      const rgb = hex2rgb(m.palette[k] && m.palette[k].accent)
      if (!rgb) { console.error(`✗ ${s} 的 palette.${k}.accent 不是合法 #hex（${m.palette[k] && m.palette[k].accent}）⇒ exit 2`); process.exit(EXIT.INPUT) }
      entries.push({ name: k, rgb })
    }
    if (entries.length < 2) { console.error(`✗ ${s} 的 palette 少于 2 项 ⇒ 无可比性 ⇒ exit 2`); process.exit(EXIT.INPUT) }
    out.push({ skin: s, n: entries.length, entries })
  }
  return out
}

/* ---------------- 自测：合成样本（含"两把尺判定不同"的关键样本） ---------------- */
function selfTest() {
  const cases = []
  const chk = (name, ok, detail) => cases.push({ name, ok, detail })
  /* ① 必红：同色 ⇒ ΔE 0 ⇒ 必须落在"几乎不可辨" */
  chk('① 同色对 ⇒ ΔE≈0 ⇒ 判"几乎不可辨"', dE76(hex2rgb('#2f5fa8'), hex2rgb('#2f5fa8')) < 1, `ΔE=${dE76(hex2rgb('#2f5fa8'), hex2rgb('#2f5fa8')).toFixed(2)}`)
  /* ② 不许红：明显不同的对 ⇒ ΔE 必须 >30（防止量尺"常量返回"） */
  const d2 = dE76(hex2rgb('#ff4d2e'), hex2rgb('#2ee0ff'))
  chk('② 橙红↔青 ⇒ ΔE>30（量尺不是常量）', d2 > 30, `ΔE=${d2.toFixed(1)}`)
  /* ③ ★ 关键样本：**深色低饱和对** ⇒ ΔRGB 说"名义"、ΔE76 说"可辨"（两把尺判定不同 ⇒ 量尺适用边界） */
  const dk = [hex2rgb('#6b2a30'), hex2rgb('#5a4229')]   // formal 绛红 ↔ 焦棕（真实值）
  const [e3, r3] = [dE76(dk[0], dk[1]), distRGB(dk[0], dk[1])]
  chk('③ 深色对：ΔRGB<60 但 ΔE76>20 ⇒ **两把尺判定不同**（正是换尺的实证）', r3 < 60 && e3 > 20, `ΔRGB=${r3.toFixed(1)} · ΔE76=${e3.toFixed(1)}`)
  /* ④ 对称性与自反对角（度量必须满足） */
  const sym = Math.abs(dE76(hex2rgb('#c8a06a'), hex2rgb('#1c3d5a')) - dE76(hex2rgb('#1c3d5a'), hex2rgb('#c8a06a'))) < 1e-9
  chk('④ ΔE76 对称', sym, '')
  /* ⑤ 非法 hex 必须被判非法（不许静默当黑） */
  chk('⑤ 非法 hex ⇒ hex2rgb 返回 null', hex2rgb('nope') === null && hex2rgb('#12') === null, '')
  const fail = cases.filter((c) => !c.ok)
  for (const c of cases) console.log(`   ${c.ok ? '✓' : '✗'} ${c.name}${c.detail ? '  · ' + c.detail : ''}`)
  console.log(`${fail.length ? '✗' : '✓'} [PALETTE-SELFTEST] 合成样本 用例=${cases.length} · 失败=${fail.length}`)
  return fail.length ? EXIT.FAIL : EXIT.OK
}

if (A.selfTest) process.exit(selfTest())

/* ---------------- 主路径：逐套量 + （可选）判据模式 ---------------- */
const masters = readMasters(A.skin)
if (!masters.length) { console.error(`✗ 没找到母版（--skin ${A.skin || '(未指定)'}）⇒ exit 2`); process.exit(EXIT.INPUT) }

const rows = masters.map((m) => {
  const de = closestPair(m.entries, dE76)
  const rg = closestPair(m.entries, distRGB)
  return { skin: m.skin, n: m.n, minDE: Number(de.v.toFixed(1)), pair: `${de.a} ↔ ${de.b}`, minRGB: Number(rg.v.toFixed(1)), rgbPair: `${rg.a} ↔ ${rg.b}` }
}).sort((a, b) => a.minDE - b.minDE)

if (A.json) {
  console.log(JSON.stringify({ tool: 'palette-distance', metric: 'dE76(CIELAB,D65)', rows, minDeRequired: A.minDe != null ? Number(A.minDe) : null }, null, 2))
} else {
  console.log('  皮肤（最近一对）        ΔE76    ΔRGB   判定                 色名对')
  for (const r of rows) console.log('  ' + r.skin.replace('master-', '').padEnd(20) + String(r.minDE).padStart(6) + '  ' + String(r.minRGB).padStart(6) + '   ' + band(r.minDE).padEnd(20) + r.pair)
}

/* 判据模式：`--min-de <n>` ⇒ 任一套最近一对低于 n ⇒ 红（可当闸门 · 也能证明"判据咬得动"） */
if (A.minDe != null) {
  const need = Number(A.minDe)
  if (!Number.isFinite(need) || need < 0) { console.error(`✗ --min-de 必须是非负数字（现 ${A.minDe}）⇒ exit 2`); process.exit(EXIT.INPUT) }
  const bad = rows.filter((r) => r.minDE < need)
  for (const b of bad) console.log(`  ✗ [PALETTE-TOO-CLOSE] ${b.skin}：最近一对 ΔE76=${b.minDE} < 要求 ${need}（${b.pair}）`)
  console.log(`  ${bad.length ? '✗' : '✓'} [PALETTE-DIST] 套数=${rows.length} · 最近 ΔE76=${rows[0].minDE}（${rows[0].skin}）· 要求 ≥${need} · 不达标 ${bad.length} 套`)
  process.exit(bad.length ? EXIT.FAIL : EXIT.OK)
}
console.log(`  ✓ [PALETTE-DIST] 套数=${rows.length} · 最近一对 ΔE76=${rows[0].minDE}（${rows[0].skin} · ${rows[0].pair}）· 弱(<20) ${rows.filter((r) => r.minDE < 20).length} 套`)
process.exit(EXIT.OK)
