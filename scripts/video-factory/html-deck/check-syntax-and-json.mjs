#!/usr/bin/env node
/* check-syntax-and-json.mjs —— **全量语法 / JSON 守卫**（team-lead 批准，判红）
 *
 * 两件事（都是"通用防线"，比逐条匹配更根本、零误报）：
 *   ① **全量 `node --check`**（所有 `.mjs`）—— 抓"**已经造成语法错**"的：
 *      事故类型：块注释里出现【星号紧跟斜杠】的连写 ⇒ 注释被提前终止 ⇒ 尾部当代码 ⇒ 语法错
 *      （本文件第一版就踩了：注释里原样写了那个连写 ⇒ 当场语法错 —— 正好由本条规矩抓住）。
 *   ② **全量 `.json` 必须能 `JSON.parse`** —— 抓任何 JSON 破损：
 *      事故类型：JSON 内层用了直引号（`"真 bug"`）⇒ 非法（我本轮也踩过一次）。
 *   （"内层引号一律中文引号"只作**约定**，不做断言 —— 风格 ≠ 正确性。）
 *
 * 扫描面：入库根下 3 层 + `fonts/`（跳过 `out` 前缀目录 / `node_modules` / `evidence` / `cs-test` / `seek-test` / 点目录）
 * 退出码：0 = 全过 · 1 = 有语法/JSON 错（红）· 2 = 一个文件都没扫到（"无事可查" ≠ "查过且通过"）
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, relative } from 'node:path'
import { DECK_DIR, ENGINE_ROOT, selfCheck } from './paths.mjs'
/* ★★ **共享扫描免疫**（team-lead ③：唯一实现）：`maskSource()` 由 `engine-bin.mjs` 导出 ⇒
   本文件的"裸媒体工具"扫描与 `engine-bin` 的 K17-ff 扫描**共用同一套"剥注释（保字符串）"逻辑** ✓
   —— 本次血现场正是"朴素匹配**被文档误伤**"（`engine-bin` 断言被它**自己的说明注释**触发 ⇒ 凡 import 它的工具全 exit 2）✓ */
import { maskSource } from './engine-bin.mjs'

selfCheck({ quiet: true })

const SKIP_DIR = /^(out|node_modules|evidence|cs-test|seek-test|\.)/
const files = []
const collect = (dir, depth = 0) => {
  let es = []
  try { es = readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of es) {
    if (e.isDirectory()) { if (!SKIP_DIR.test(e.name) && depth < 3) collect(join(dir, e.name), depth + 1); continue }
    if (/\.(mjs|json|css|js)$/i.test(e.name)) files.push(join(dir, e.name))
  }
}
collect(DECK_DIR)
const fontsDir = join(ENGINE_ROOT, 'fonts')
if (existsSync(fontsDir)) collect(fontsDir)

const mjs = files.filter((f) => /\.mjs$/i.test(f))
const json = files.filter((f) => /\.json$/i.test(f))
/* ★★ **I9 扩面**（team-lead 现场 · **真覆盖缺口**）：注释卫生原先**只扫 `.mjs`** ⇒
   `.css` / `.js`（母版里也有手写 JS）**无人管** —— 他的事故正是在 `skin-health.css` 的**头部注释**里
   写了【星号紧跟斜杠】⇒ 注释**提前闭合** ⇒ 其后文本被当 CSS 解析（**本机看不出**，靠他的审计量尺才抓到）。
   ★ 做法照 **K32 的正面用法**：**同一实现 + 扩大文件面**（复用下方的 `blockCommentBalance`，不另写扫描器）；
     新增的只有"**被扫描的文件名集合**"这一处 ✓
   ⚠️ **两层都要扩**：本文件是**宽判据**（平衡 ⇒ 结论来源）；"提前闭合但**仍然平衡**"那种形态由
     `commit-safe.mjs` 的**窄判据**（注释续行引述闭合符 · 能定格行号）抓 ⇒ 那边同步扩面 ✓
     （否则他那种 `.p6-` + 斜杠星号 的形态在**宽**这一层**仍会漏** —— 实测其 `depth` 归零 ✓）。 */
const styleFiles = files.filter((f) => /\.(css|js)$/i.test(f))
const check = mjs.filter((f) => spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' }).status !== 0)
const badJson = []
for (const f of json) {
  try { JSON.parse(readFileSync(f, 'utf8')) } catch (e) { badJson.push(`${f} —— ${e.message}`) }
}

/* ★★ **I9 机器化**（`invariants.json` 的 I9「注释里不许出现块注释符号」：`enforcedBy` 从"（待做）"落地）。
   事故：**两次**把【星号紧跟斜杠】原文写进块注释 ⇒ 注释在**那两字符**处提前闭合 ⇒ 后续说明文字变成代码
   （一次已提交成坏提交，一次首次运行即被自己的语法错挡住）。
   判据：**块注释计数必须平衡**（跳过字符串 / 模板 / 行注释的简易状态机）—— 提前闭合会留下未闭合的开符号
   ⇒ 计到文件尾仍 > 0 ⇒ 红。
   ⚠️ **能力边界（如实）**：① 只抓"提前闭合后**计数不平衡**"这一半；若后续**恰好是合法 JS**（计数平衡）
      ⇒ 本扫描抓不到 ⇒ 由第 ① 步 `node --check` + 评审兜底；② **不建模**正则字面量与模板 `${}` 内部
      （其中的注释符号会被跳过）⇒ 只会**漏报**、不会误报；实测当前入库树全绿（见下方 ✓ 行）。
   ⚠️ 本扫描**自己的源码里不写那两个字符的连写**（逐字符比较 ⇒ 结构上避免重踩自匹配坑，与 HF / K17-ff 同款）。
   ★★ **I9 是有意的两层**（team-lead 的可判伪裁定实验 · 见 README §25u + 证据 `evidence/tmp-i9/`）：
      · **本处（宽 · 平衡扫描）** = **I9 结论来源**：抓"块注释**不平衡**"（多/少闭合符）；
      · **`commit-safe.mjs` 的窄判据** = **明细**：抓"**注释续行里引述了闭合符**"这一种形态（**能定格到行号**）。
      实验结论：造得出一个**窄抓得到、宽抓不到**的必红样本（`evidence/tmp-i9/narrow-sample.mjs`：续行含闭合符、
      且**其余是合法 JS** ⇒ `node --check` 通过、平衡也成立 ⇒ 宽判据**抓不到**）⇒ **两者能力真的不同** ⇒ 保留两层。 */
const commentDrift = []
const notModeled = []      /* ★ 可见债务：本扫描**没能建模**的文件（模板 `${}` 嵌套等）—— 计数必须打印，不许静默 */
/* ★ I9 扩面（team-lead 现场）：`.mjs` + **`.css` / `.js`** 共用同一状态机（**同一实现 + 扩大文件面** · K32 正面用法） */
for (const f of [...mjs, ...styleFiles]) {
  let s = ''
  /* ⚠️ catch **必须会说话**：哑 catch 棘轮的判据原文是「体内**既无 `console.`/`throw` 也无计数**」
     （silent-catch-baseline.json 的 `_doc`）—— 首版我只在 catch 里给一个布尔赋值（不 print/不计数）⇒ 被棘轮**当场咬到**
     （该文件基线 0 ⇒ 只许减 ⇒ 新增即红）⇒ 现在体内**直接 console.error + 推送计数**。
     ⚠️⚠️ 而且**这里不许写出那个形状的字面量**：抽取正则是"catch + 花括号块"的朴素匹配 ⇒
     注释里原样写一遍会被当成**真 catch** 判哑（实测：我第一版注释正是这样把本文件又弄红一次 = 自指涉坑）。 */
  let readFail = 0
  try { s = readFileSync(f, 'utf8') } catch (e) {
    readFail++
    console.error(`   ⚠ [I9 块注释扫描] ${relative(ENGINE_ROOT, f)} 读取失败：${e.message ?? e}`)
    commentDrift.push(`${relative(ENGINE_ROOT, f)} —— 读取失败（计数不完整）`)
    continue
  }
  if (readFail) commentDrift.push('（读取失败计数不应出现在这里）')
  const bal = blockCommentBalance(s)
  /* ⚠️ **两件事分开**（不许混）：`depth !== 0` = **判据**（真·块注释不平衡 ⇒ 红）；
     `q` 残留 = **本扫描没建模**（如模板 `${}` 里再嵌模板 ⇒ 首版正因此把 7 个文件假红 ✗）⇒ 只**登记为可见债务**、
     不判红（按 team-lead ④ 的分档：**1 格 + 修法专美（迷你词法器）⇒ 挂可见债务**，等第 2 例再建）。
     ⚠️ 但它**必须**出现在输出里（`未建模 N`）⇒ 债务要么被还、要么被看见，不许静默略过。 */
  if (bal.depth !== 0) commentDrift.push(`${relative(ENGINE_ROOT, f)} —— 块注释未平衡（残留 ${bal.depth} 个未闭合）`)
  if (bal.unclosedString) notModeled.push(`${relative(ENGINE_ROOT, f)}（引号开于 L${bal.line}）`)
}
/* ★★ **扫描器抽成纯函数**（team-lead ② 的加强）：让"**边界样本**"进 `--self-test-i9`（**合成样本**）
   ⇒ 不再需要"`evidence/` 文件 + 豁免 + gitignore"那套**两难**（扫描面天然一致、**新克隆也能复跑**）✓ */
export function blockCommentBalance(src) {
  const s = String(src || '')
  let depth = 0, q = null
  let qAt = 0                                /* 引号开启位置（诊断用：误报时要能一眼看出在哪） */
  const at = (i) => { let k = 0; for (let j = 0; j < i && j < s.length; j++) if (s[j] === '\n') k++; return 1 + k }
  /* 正则字面量的判定需要"前一个**有效**字符"（跳过空白） */
  const prevSig = (i) => { let j = i - 1; while (j >= 0 && '\t \r\n'.includes(s[j])) j--; return j >= 0 ? s[j] : '' }
  for (let i = 0; i < s.length; i++) {
    const c = s[i], n = s[i + 1]
    /* ⚠️ **注释状态优先**：在块注释内时，引号一律**不算**（否则注释里的撇号会被当成"字符串开启"⇒ 误报）——
       实测：首版就是这个坑，把两个文件报成"字符串未闭合"（残留 0 ✗ 明显不合理）。 */
    if (depth > 0) { if (c === '*' && n === '/') { depth--; i++ } continue }
    if (q) { if (c === '\\') { i++; continue } if (c === q) q = null; continue }
    if (c === '/' && n === '*') { depth++; i++; continue }
    if (c === '/' && n === '/') { while (i < s.length && s[i] !== '\n') i++; continue }
    /* ★ **必须建模正则字面量**：否则正则里的引号会被当成"字符串开启"（⇒ 后面一路错位）、
       正则里的注释符号会被当成真注释 —— 实测首版把 **7 个文件**报成"字符串未闭合"（全是这个原因 ✗）。
       判定（业界通行的启发式）：`/` 的前一个**有效**字符若**不是**"值结束"（标识符/数字/右括号/右方括号）
       ⇒ 视为**正则起点**；随后跳到未转义的闭 `/`（尊重 `[...]` 字符类；遇换行即停 ⇒ 不吞文件）。 */
    if (c === '/') {
      if (!/[A-Za-z0-9_$)\]]/.test(prevSig(i))) {
        i++
        let cls = false
        for (; i < s.length; i++) {
          if (s[i] === '\\') { i++; continue }
          if (s[i] === '[') cls = true
          else if (s[i] === ']') cls = false
          else if (s[i] === '/' && !cls) break
          else if (s[i] === '\n') break
        }
      }
      continue
    }
    if (c === "'" || c === '"' || c === '`') { q = c; qAt = i; continue }
  }
  /* ⚠️ **两件事分开**（不许混）：`depth !== 0` = **判据**（真·块注释不平衡 ⇒ 红）；
     `q` 残留 = **本扫描没建模**（如模板 `${}` 里再嵌模板 ⇒ 首版正因此把 7 个文件假红 ✗）⇒ 只**登记为可见债务**、
     不判红（按 team-lead ④ 的分档：**1 格 + 修法专美（迷你词法器）⇒ 挂可见债务**，等第 2 例再建）。
     ⚠️ 但它**必须**出现在输出里（`未建模 N`）⇒ 债务要么被还、要么被看见，不许静默略过。 */
  return { depth, unclosedString: q, line: q ? at(qAt) : null }
}

/* ★★ **I9 边界样本（合成 · team-lead ② 的加强）**：`--self-test-i9` ——
   ① 平衡 ⇒ `depth 0`（不许红）· ② 未闭合 ⇒ `depth > 0`（必红）·
   ③ ★**窄判据那种形状**（注释续行里引述闭合符 + 后面还有字 + **其余是合法 JS**）⇒ **`depth` 仍为 0**
      ⇒ **宽判据在原理上抓不到**（一多一少**相抵**）—— 这就是"**两层能力不同**"的**可复跑证据**，
      且**零文件依赖**（不再需要 evidence 目录 / 豁免 / gitignore）✓
   ④ glob 写在**字符串**里 ⇒ 不算注释（`depth 0`，防假阳性）。
   ⚠️ 样本**运行期拼**（源码里不出现连续探针）⇒ 判定器不自匹配（HF / K17-ff / 本批多次同款坑）。 */
if (process.argv.includes('--self-test-i9')) {
  const S = '*' + '/'
  const O = '/' + '*'      /* ⚠️ 开符号也**分段拼**：⓪c 注释安全检查会抓"源码里出现注释符号连写"（实测 2 处假红）*/
  const cases = []
  const chk = (name, cond) => { cases.push(cond); console.log(`   ${cond ? '✓' : '✗'} ${name}`) }
  chk('① 平衡块注释 ⇒ depth=0（不许红）', blockCommentBalance(O + ' a ' + S + ' const x = 1').depth === 0)
  chk('② 未闭合块注释 ⇒ depth>0（必红）', blockCommentBalance(O + ' a\nconst x = 1').depth > 0)
  chk('③ ★边界样本：续行引述闭合符 ⇒ **宽判据 depth 仍 0（抓不到）**', blockCommentBalance(O + ' 说明\n * 你要写 ' + S + ' const y = 2\n').depth === 0)
  chk('④ glob 在字符串里 ⇒ 不算注释（depth 0）', blockCommentBalance("const g = '" + '**/*' + ".mjs'").depth === 0)
  const fail = cases.filter((x) => !x).length
  console.log(`   ${fail === 0 ? '✓' : '✗'} [I9-SELFTEST] 合成边界样本 用例=${cases.length} · 失败=${fail}`)
  process.exit(fail === 0 ? 0 : 1)
}

// ★★ **K17-ff 第 2 层收口（结构性断言）**：源码里**不许再出现裸的媒体工具调用**
//   （即 `spawnSync` 后直接跟媒体工具**字面量**）—— 必须走 `engine-bin.mjs` 的
//   `resolveFfmpeg()` / `resolveFfprobe()`（**唯一实现**，候选数组与环境变量只许在那一处）。
//   ⇒ 让"**第 11 处裸用法**"进不来（此前 10 处已清扫：measure-limits 2 · verify-chart 2 · verify-density 2 ·
//      verify-image 3 · verify-masters 1 —— 靠**人记得**清完，靠**断言**才守得住）。
//   ⚠️ 探针**分段拼**（源码里不出现连续探针）⇒ 判定器不自匹配（HF / K17-ff / 本批多次同款坑）。
//   ⚠️ 本段**用行注释**（不是块注释）：闸门 ⓪c 是**行级朴素扫描**（进入块注释后，任何含"块注释起始符"的行即判红），
//      它自己给的解法就是"**改用行注释**"——此处照办（另：这类"判据误伤真源"的现场值得记进 K 表）。
{
  const N1 = "spawnSync('ff" + "mpeg'"
  const N2 = "spawnSync('ff" + "probe'"
  const matcher = (t) => (t.split(N1).length - 1) + (t.split(N2).length - 1)
  if (process.argv.includes('--self-test-bare-media')) {
    const cases = []
    const chk = (name, cond) => { cases.push(cond); console.log(`   ${cond ? '✓' : '✗'} ${name}`) }
    chk('① 裸调用样本 ⇒ 命中（必红）', matcher(maskSource('const r = ' + N1 + ", [ '-v' ]", { maskStrings: false })) === 1)
    chk('② 裸 ffprobe 样本 ⇒ 命中（必红）', matcher(maskSource('const r = ' + N2 + ", [ '-v' ]", { maskStrings: false })) === 1)
    chk('③ 走唯一实现的写法 ⇒ 不命中（不许红）', matcher(maskSource('const r = spawnSync(resolveFf' + "mpeg().p, [ '-v' ])", { maskStrings: false })) === 0)
    chk('④ ★**注释里**出现完整字面量 ⇒ 不许命中（与 engine-bin 同源的"剥注释"免疫 · 本次血现场的回归样本）',
      matcher(maskSource('// 说明：' + N1 + ' 必须改走唯一实现', { maskStrings: false })) === 0)
    const fail = cases.filter((x) => !x).length
    console.log(`   ${fail === 0 ? '✓' : '✗'} [BARE-MEDIA-SELFTEST] 裸媒体工具断言 用例=${cases.length} · 失败=${fail}`)
    process.exit(fail === 0 ? 0 : 1)
  }
  const hits = []
  for (const f of mjs) {
    let t = ''
    let rf = 0
    try { t = readFileSync(f, 'utf8') } catch (e) { rf++; console.error(`   ⚠ [裸媒体工具扫描] 读取失败：${e.message}`) }
    if (rf) continue
    const n = matcher(t)
    if (n) hits.push(`${relative(ENGINE_ROOT, f)}×${n}`)
  }
  if (hits.length) {
    console.error(`✗ **裸媒体工具调用**（K17-ff 第 2 层）：${hits.join(' · ')}`)
    console.error('   ⇒ 一律改用 `resolveFfmpeg().p` / `resolveFfprobe().p`（唯一实现在 `engine-bin.mjs`；'
      + '它同时保证"渲染器钉住的 ffmpeg"被尊重）')
    process.exit(1)
  }
  console.log(`  ✓ 裸媒体工具调用 = 0（${mjs.length} 个 .mjs 全走 resolveFfmpeg/resolveFfprobe）`)
}

console.log(`\n⓪f 全量语法/JSON 守卫：.mjs ${mjs.length} 个（node --check + 块注释平衡）· .json ${json.length} 个（JSON.parse）· ★**I9 扩面**：.css/.js ${styleFiles.length} 个（块注释平衡 —— 原先**只扫 .mjs** ⇒ 缺口）`)
if (!mjs.length || !json.length || !styleFiles.length) {
  console.error(`✗ 扫描面异常（.mjs ${mjs.length} · .json ${json.length} · .css/.js ${styleFiles.length}）⇒ exit 2（"无事可查" ≠ "查过且通过"；css/js 计数为 0 说明 I9 扩面没生效）`)
  process.exit(2)
}
if (check.length || badJson.length || commentDrift.length) {
  console.error(`\n✗ 语法/JSON/块注释 错（§25a：原始清单，未过滤）`)
  for (const f of check) console.error(`    · [node --check 失败] ${relative(ENGINE_ROOT, f)}`)
  for (const f of badJson) console.error(`    · [JSON.parse 失败] ${relative(ENGINE_ROOT, f)}`)
  for (const f of commentDrift) console.error(`    · [块注释不平衡 · I9 · .mjs/.css/.js] ${f}`)
  console.error('  ⇒ 优先查"块注释里是否原样写了【星号紧跟斜杠】"（该写法会提前终止注释、尾部当代码）')
  process.exit(1)
}
console.log(`  ✓ ${mjs.length} 个 .mjs 语法全过 + 块注释平衡 · ${json.length} 个 .json 全部可解析 · ★ .css/.js ${styleFiles.length} 个块注释平衡（I9 扩面）`)
if (notModeled.length) {
  console.log(`  ⚠ 块注释扫描**未建模** ${notModeled.length} 个（模板 ${'${}'} 嵌套等 ⇒ 这些文件只受 node --check 保护）：${notModeled.join(' · ')}`)
  console.log('    （可见债务：把扫描升级为带 ${} 嵌套的迷你词法器 —— 按"1 格 + 修法专美 ⇒ 挂债"处理，等第 2 例再建）')
}
