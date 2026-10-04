/* color.mjs —— ★★ **颜色工具的唯一实现**（`hex2rgb` 家族）
 *
 * 为什么要有它：本仓此前有 **5 份** `hex2rgb`，而且**语义各不相同** ✗：
 *   · `check-master-manifest` 版 ⇒ 只认 6 位、返回**字符串** `"r,g,b"`、非法返回 `null`；
 *   · `palette-distance` 版 ⇒ 认 3/6 位、返回**数组**、非法返回 `null`；
 *   · `verify-chart` / `verify-density` / `verify-image` 三份 ⇒ **裸切分、零校验**（非法值会变成 `NaN` 并**静默传播**）。
 * ⇒ 与 **K17** 同族（同一逻辑多份 ⇒ 只改一处 ⇒ 静默分叉）⇒ 收拢到本模块；
 *   `check-syntax-and-json` 有"**颜色工具只许定义一处**"的出现次数断言守着（与 K17-ff 同款）。
 *
 * ⚠️ **两个口径（有意并存，如实）**：
 *   · `hex2rgb(h)` —— **严格版**：认 `#rgb` / `#rrggbb`（`#` 可省）；**非法 ⇒ `null`**。
 *     新代码一律用它，并**显式处理 `null`**（我们选"**响亮地失败**"，而不是让 `NaN` 静默传播成"看着合理但是错的"数）。
 *   · `hex2rgbTrusted(h)` —— **可信输入版**：**不做校验**，直接切片解析（保留旧三个调用点的**1:1 行为**）。
 *     仅用于"值来自 `master.json` / schema / 常量"的场景（那时非法即**上游已坏**，校验在更早处）。
 *     ⚠️ **不许**用它处理**外部/用户输入**（那条路必须走严格版）。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { maskSource } from './engine-bin.mjs'
const ENGINE_DIR = dirname(fileURLToPath(import.meta.url))

/** 严格：`'#0af'` / `'#00aaff'` / `'00aaff'` ⇒ `[0,170,255]`；非法 ⇒ `null` */
export function hex2rgb(h) {
  const s = String(h == null ? '' : h).trim().replace('#', '')
  if (!/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(s)) return null
  const f = s.length === 3 ? s.split('').map((c) => c + c).join('') : s
  return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16))
}

/** 同上的**字符串**形态（`check-master-manifest` 用它做累计比较）：非法 ⇒ `null` */
export function hex2rgbStr(h) {
  const a = hex2rgb(h)
  return a ? a.join(',') : null
}

/** **可信输入版（零校验）**：与旧的三份"裸切分"实现**逐字等价** ⇒ 保证行为 1:1（只搬家，不改行为）。
 *  ⚠️ 输入被认为是**已校验**的（母版/schema/常量）；**不许**用于外部输入。 */
export function hex2rgbTrusted(h) {
  const s = String(h).replace('#', '')
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16))
}

/* ★★ **导入即自检：颜色工具只许定义一处**（team-lead ③ 的三条要求逐条满足）——
   ① **一行复跑**：`node -e "import('./color.mjs')"`（出红时不必先跑渲染）
   ② **红时报"文件×次数"**（并点名，便于定位）
   ③ **登记进 `commit-safe` 前置清单**（否则"导入即自检"会退化成"只在我记得跑时才自检"）
   ⚠️ 匹配前先 `maskSource(t, { maskStrings: false })`（**剥注释保字符串**）—— 今天那场血现场（规则被自己的文档触发）的教训 ✓ */
{
  const NEEDLE = 'hex2rgb'                      /* 定义形态：`function hex2rgb(` / `const hex2rgb =` / `hex2rgb = (` */
  const self = 'color.mjs'
  let files = []
  let readFail = 0
  try { files = readdirSync(ENGINE_DIR).filter((f) => f.endsWith('.mjs') && f !== self) } catch (e) { readFail++; console.error(`   ⚠ [颜色工具唯一性] 目录读取失败：${e.message}`) }
  const hits = []
  for (const f of files) {
    let t = ''
    try { t = readFileSync(join(ENGINE_DIR, f), 'utf8') } catch (e) { readFail++; console.error(`   ⚠ [颜色工具唯一性] 读取失败 ${f}：${e.message}`); continue }
    const masked = maskSource(t, { maskStrings: false })
    const n = (masked.match(new RegExp('(function|const|let|var)\\s+' + NEEDLE + '\\s*[=(]', 'g')) || []).length
    if (n) hits.push(`${f}×${n}`)
  }
  if (readFail) console.error(`   （颜色工具唯一性：有 ${readFail} 处读取失败 ⇒ 计数可能不完整）`)
  if (hits.length) {
    console.error('✗ **颜色工具只许定义一处**（`color.mjs`）：')
    console.error(`   违规：${hits.join(' · ')} ⇒ 请改 import：严格版 \`hex2rgb\` · 字符串形态 \`hex2rgbStr\` · 可信输入版 \`hex2rgbTrusted\``)
    process.exit(2)
  }
}

/* ---- 自测（仅直接执行本文件时跑；被 import 时**零副作用**）：
 *  必红/不许红成对（本次收拢的验收：口径要能被合成样本证伪） ---- */
if (process.argv[1] && String(process.argv[1]).replace(/\\/g, '/').endsWith('color.mjs')) {
  const cases = []
  const chk = (name, cond) => { cases.push(cond); console.log(`   ${cond ? '✓' : '✗'} ${name}`) }
  chk('① 6 位（带 #）⇒ 正确数组', JSON.stringify(hex2rgb('#00aaff')) === '[0,170,255]')
  chk('② 6 位（无 #）⇒ 同上', JSON.stringify(hex2rgb('00aaff')) === '[0,170,255]')
  chk('③ 3 位缩写 ⇒ 展开（#0af ⇒ 0,170,255）', JSON.stringify(hex2rgb('#0af')) === '[0,170,255]')
  chk('④ ★非法 ⇒ **null**（不是 NaN 数组）', hex2rgb('zzz') === null && hex2rgb('') === null && hex2rgb(null) === null)
  chk('⑤ 字符串形态与数组形态**同源**', hex2rgbStr('#00aaff') === '0,170,255' && hex2rgbStr('zzz') === null)
  /* ⑥ 与旧"裸切分"实现**逐字等价**（行为 1:1）：注意 3 位缩写对它**本来就无效**（`[10,15,NaN]`）——
     这**正是**"零校验"的固有行为 ⇒ 也**正是**它只许用于"已校验的母版/schema 值"的理由 ✓（我首版样本写错了期望值 ⇒ 当场被抓 ✓） */
  {
    const t6 = hex2rgbTrusted('00aaff'), t3 = hex2rgbTrusted('#0af')
    chk('⑥ 可信输入版与旧"裸切分"实现**逐字等价**（行为 1:1 · 含"3 位缩写本就无效"这一固有行为）',
      JSON.stringify(t6) === JSON.stringify([0, 170, 255]) && t3[0] === 10 && t3[1] === 15 && Number.isNaN(t3[2]))
  }
  const fail = cases.filter((x) => !x).length
  console.log(`   ${fail === 0 ? '✓' : '✗'} [COLOR-SELFTEST] 颜色工具 用例=${cases.length} · 失败=${fail}`)
  process.exit(fail === 0 ? 0 : 1)
}
