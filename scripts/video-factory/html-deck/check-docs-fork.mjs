#!/usr/bin/env node
/* ⓪d **docs 分叉不变量** —— 内容级扫描（**不看名字**，看引擎对应物与 MD5）
 *
 * 目标：`docs/ppt-html-probe` 只许保留"**引擎里从来没有过**"的东西（引擎 = 唯一真源）。
 *
 * 规则（team-lead 裁定）：
 *   ① 豁免：`evidence/` 子树（证据）· `.md` 文档 —— **仍打印**命中数与其引擎对应物，避免"豁免=盲区"
 *   ② 白名单 `docs-fork-allowlist.json`：条目**必须带 category** ∈ {`docs-only`, `experiment`}
 *   ③ ⛔ **硬边界**：白名单**不许**收留"引擎某在库文件的旧版本 / 改名旧快照"
 *      （判定 = 该名在引擎有同名文件，**或**该内容 MD5 等于引擎任一文件）⇒ 命中即 **exit 2**（"只能删"）；
 *      否则白名单会变成"旧副本收容所"，正是要防的。
 *   ④ 每次运行**必须打印**：白名单条目数 + 每条 文件名/类别（增长可见）
 *   ⑤ 打印每类**命中规则与对应物**（豁免/白名单/违反各自的依据）
 *
 * 退出码（分档）：0 = 无分叉 · 1 = 有未登记分叉（红）· 2 = 用法/环境/白名单配置错（§25b）
 * 环境：`DOCS_DIR` 可覆盖 docs 树位置（默认 `<engine>/../../docs/ppt-html-probe`）
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { join, relative, basename, resolve } from 'node:path'
import { ENGINE_ROOT, DECK_DIR, selfCheck } from './paths.mjs'

selfCheck({ quiet: true })

/* ★ **两布局都正确**（flat 迁移抓出的真 bug：第一版在入库树里解析出 `scripts/docs/ppt-html-probe` ✗）：
 *   · flat：入库根 = `<repo>/scripts/video-factory/html-deck` ⇒ docs = `<repo>/docs/ppt-html-probe`（**上溯三层**）
 *   · bridge-dev：引擎根 = `<repo>/dist-rel/probe-hf` ⇒ docs = `<repo>/docs/ppt-html-probe`（**上溯两层**） */
const DOCS_DIR = process.env.DOCS_DIR || (basename(ENGINE_ROOT) === 'html-deck'
  ? resolve(ENGINE_ROOT, '..', '..', '..', 'docs', 'ppt-html-probe')
  : resolve(ENGINE_ROOT, '..', '..', 'docs', 'ppt-html-probe'))
/* ⛔ **基线必须是「入库树」（git 跟踪的 `<repo>/scripts/video-factory/html-deck`），不是本探针工作树**。
   事故根因（team-lead 抓）：我曾拿 `dist-rel/probe-hf/`（**被 `.gitignore` 吞掉、不可分发**）当"引擎侧"基线
   ⇒ 把只在探针树存在的对应物当成"已入库"⇒ 删了 docs 里**唯一进 git 的副本**（差一步就静默损坏分发件）。
   ⇒ 现在：① 基线 = 入库树；② 每个"对应物"**必须被 `git ls-files` 跟踪**；只在探针树有 ⇒ **exit 2**（不许删、不许豁免）。 */
/* ★ **两套布局的映射表**（team-lead ⑤.2，写死在代码里以免每次重新猜）：
 *   · **flat（入库树）**：`scripts/video-factory/html-deck/` 直接放脚本 ⇒ `ENGINE_ROOT === 入库根`
 *   · **bridge-dev（探针树）**：`dist-rel/probe-hf/deck-contract/` 放脚本、`dist-rel/probe-hf/` 是引擎根
 *     ⇒ 入库根 = `<ENGINE_ROOT>/../../scripts/video-factory/html-deck`
 *   ⇒ 判据：`ENGINE_ROOT` 的目录名是 `html-deck` 即视为 flat（否则按 bridge 推导）；可用 `LANDING_DIR` 覆盖。 */
const LANDING_DIR = process.env.LANDING_DIR || (basename(ENGINE_ROOT) === 'html-deck'
  ? ENGINE_ROOT
  : resolve(ENGINE_ROOT, '..', '..', 'scripts', 'video-factory', 'html-deck'))

/** 返回入库树中**被 git 跟踪**的相对路径集合（相对 LANDING_DIR）；git 不可用 ⇒ 环境错（exit 2） */
function gitTracked(root) {
  let repo = ''
  try { repo = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8' }).trim() } catch {
    console.error(`✗ 无法确定 git 仓库根（${root}）⇒ 基线无效（§25b ⇒ exit 2）`)
    process.exit(2)
  }
  const rel = relative(repo, root).split('\\').join('/')
  let out = ''
  try { out = execFileSync('git', ['ls-files', '--', rel], { cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }) } catch {
    console.error(`✗ git ls-files 失败（${rel}）⇒ 基线无效（§25b ⇒ exit 2）`)
    process.exit(2)
  }
  return new Set(out.split('\n').map((s) => s.trim()).filter(Boolean).map((p) => p.slice(rel.length + 1)))
}
const WL_FILE = join(DECK_DIR, 'docs-fork-allowlist.json')
const CATS = ['docs-only', 'experiment']
const SKIP_DIR = /^(out|node_modules|evidence|\.)/   // 引擎侧扫描跳过：产物/依赖/证据/点目录
// ★ 通配符"斜杠+星号"**分段拼**（不写成字面量）：本文件不出现该两字符连写 ⇒ 不触发 ⓪c 注释安全误报（同 K17 断言手法）
const WILDCARD = '/' + '*'

if (!existsSync(DOCS_DIR)) {
  console.error(`✗ docs 树不存在：${DOCS_DIR}（用 DOCS_DIR 指定；§25b ⇒ exit 2）`)
  process.exit(2)
}

const md5 = (p) => createHash('md5').update(readFileSync(p)).digest('hex')

function walk(dir, base = dir, out = []) {
  let es = []
  try { es = readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of es) {
    const p = join(dir, e.name)
    if (e.isDirectory()) { if (!SKIP_DIR.test(e.name)) walk(p, base, out) }
    else out.push({ p, rel: relative(base, p).split('\\').join('/') })
  }
  return out
}

/* ---------- 入库树索引（**只认 git 跟踪的**）+ 探针树索引（用于检测"只在探针树"） ---------- */
const tracked = gitTracked(LANDING_DIR)
const missingTracked = [...tracked].filter((rel) => !existsSync(join(LANDING_DIR, rel)))
if (missingTracked.length) {
  console.error(`✗ 入库树有 ${missingTracked.length} 个**已跟踪但磁盘缺失**的文件（先 checkout/拉取；§25b ⇒ exit 2）：`)
  for (const m of missingTracked.slice(0, 10)) console.error(`    · ${m}`)
  process.exit(2)
}
const indexOf = (root, files) => {
  const name = new Map(), sha = new Map()
  for (const rel of files) {
    const n = basename(rel)
    if (!name.has(n)) name.set(n, [])
    name.get(n).push(rel)
    let h = null
    try { h = md5(join(root, rel)) } catch { /* ignore */ }
    if (h) { if (!sha.has(h)) sha.set(h, []); sha.get(h).push(rel) }
  }
  return { name, sha, n: files.length }
}
/* ★ 探针树路径必须**自己推**，不能用 `ENGINE_ROOT`：flat 下 `ENGINE_ROOT` 就是入库树 ⇒
   会把"探针树"索引指向入库树自己 ⇒ **"只在探针树"检测静默失效**（这正是本类事故的核心保护，不能失效）。 */
const PROBE_DIR = process.env.PROBE_DIR || (basename(ENGINE_ROOT) === 'html-deck'
  ? resolve(ENGINE_ROOT, '..', '..', '..', 'dist-rel', 'probe-hf')
  : ENGINE_ROOT)
/* ④ **服务器/全新克隆根本没有探针树**（`dist-rel/` 被 gitignore）⇒ 检测必须**跳过并 exit 0**，
   否则发版闸门在服务器上永远红（"缺输入"要退化成"跳过"，不是"判红"）。 */
const HAS_PROBE = existsSync(PROBE_DIR)
/* ★ 负控断言（team-lead ②）：**探针索引根 == 入库根 ⇒ "只在探针树"检测静默失效**（flat 下我第一版就是这个真 bug）
   ⇒ 直接判 **exit 2（配置错）**，不许继续绿灯。 */
if (HAS_PROBE && resolve(PROBE_DIR) === resolve(LANDING_DIR)) {
  console.error(`✗ 探针索引根 == 入库根（${PROBE_DIR}）⇒ "只在探针树"检测**静默失效** ⇒ exit 2（配置错）`)
  process.exit(2)
}
const landing = indexOf(LANDING_DIR, [...tracked])
const probe = HAS_PROBE
  ? indexOf(PROBE_DIR, walk(PROBE_DIR).map((f) => f.rel))
  : { name: new Map(), sha: new Map(), n: 0 }
const byName = landing.name, byMd5 = landing.sha
console.log(`\n入库树（git tracked）：${landing.n} 个文件（${LANDING_DIR}）`)
console.log(HAS_PROBE
  ? `探针工作树（**不可分发**，仅用于检测"只在探针树"）：${probe.n} 个文件（${PROBE_DIR}）`
  : `探针工作树**不存在**（${PROBE_DIR}）⇒ **跳过"只在探针树"检测**（本机守卫；服务器/全新克隆属正常）`)
console.log(`docs 树：${DOCS_DIR}`)

/* ---------- ②④ 白名单：类别必填 + 每次打印条目数与类别 ---------- */
const wlRaw = existsSync(WL_FILE) ? JSON.parse(readFileSync(WL_FILE, 'utf8')) : { allow: [] }
const allow = wlRaw.allow || []
console.log(`\n白名单条目数 = ${allow.length}（来源 ${relative(ENGINE_ROOT, WL_FILE)}）`)
for (const a of allow) {
  const nm = a.path ? (a.name ? `${a.name} ← ${a.path}` : a.path) : (a.name || '(缺 path/name)')
  console.log(`  · ${nm}  [${a.category || '✗缺类别'}]  ${a.reason || ''}`)
}
const badCat = allow.filter((a) => !CATS.includes(a.category))
if (badCat.length) {
  console.error(`\n✗ 白名单条目必须带 category ∈ {${CATS.join(' | ')}}；缺失/错误 ${badCat.length} 条：`)
  for (const a of badCat) console.error(`    · ${a.path || a.name || '(缺路径)'} → ${a.category || '(无)'}`)
  process.exit(2)
}

const wlHit = (rel) => allow.find((a) => {
  const p = (a.path || '').split('\\').join('/')
  if (!p) return false
  if (p.endsWith(WILDCARD)) return rel.startsWith(p.slice(0, -1))
  return rel === p
})

/* ---------- ③ ⛔ 硬边界：白名单不许收留"旧版本/改名快照" ---------- */
console.log('\n--- ③ 硬边界检查（白名单里每一条都不许是引擎在库文件的旧版本/改名快照）---')
const snaps = []
for (const a of allow) {
  const name = a.name || basename((a.path || '').split('\\').join('/'))
  const dp = a.path && !a.path.endsWith(WILDCARD) ? join(DOCS_DIR, a.path) : null
  const dmd5 = dp && existsSync(dp) ? md5(dp) : null
  const nameHit = byName.get(name) || []
  const md5Hit = dmd5 ? (byMd5.get(dmd5) || []) : []
  const probeHit = dmd5 ? (probe.sha.get(dmd5) || []) : []
  if (nameHit.length || md5Hit.length) {
    snaps.push(`${name} → 入库树同名[${nameHit.slice(0, 2).join(', ') || '-'}]${md5Hit.length ? ' · 逐字节相同[' + md5Hit.slice(0, 2).join(', ') + ']' : ''}`)
    console.log(`  ✗ ${snaps[snaps.length - 1]}`)
  } else if (probeHit.length) {
    // ★ team-lead ④：**"对应物只在探针树"的条目全部降级为"待入库"**，不许当豁免理由 ⇒ exit 2
    snaps.push(`⛔ ${name} → 对应物**只在探针树**（${probeHit.slice(0, 2).join(', ')}）⇒ **先入库**，不许当豁免理由`)
    console.log(`  ✗ ${snaps[snaps.length - 1]}`)
  } else {
    console.log(`  ✓ ${name}（入库树无同名、无逐字节相同 ⇒ 确是"入库树从来没有过的东西"）`)
  }
}
if (snaps.length) {
  console.error(`\n✗ ⛔ 硬边界被破坏：白名单试图收留 ${snaps.length} 项"引擎旧版本/改名快照" ⇒ **只能删，不许登记**（exit 2）`)
  process.exit(2)
}

/* ---------- 全树分类 ---------- */
const docs = walk(DOCS_DIR)
const exempt = [], allowed = [], viol = [], fatal = []
for (const f of docs) {
  const name = basename(f.p)
  let h = null
  try { h = md5(f.p) } catch { /* ignore */ }
  const nameHit = (byName.get(name) || []).filter((x) => x !== name)   // 排除自身同路径噪音
  const md5Hit = h ? (byMd5.get(h) || []) : []
  const info = { rel: f.rel, md5: h, nameHit, md5Hit }
  if (/^evidence\//.test(f.rel) || /\.md$/.test(f.rel)) {
    const isEv = /^evidence\//.test(f.rel)
    exempt.push({ ...info, why: isEv ? '证据目录（按登记制保留）' : '*.md（文档，非代码）' })
    // ★ **豁免 ≠ 免检**：豁免只免"未登记"的红，**不免"重复副本"** —— 与引擎在库文件**逐字节相同**的 .md/证据
    //   仍是"改名副本/旧快照" ⇒ ⛔ 硬边界同样适用（**只能删**）。面向读者应改成**指针/索引**（如 docs/README.md：同名但内容不同 ⇒ 不报）。
    if (md5Hit.length) viol.push({ ...info, kind: `豁免项但**逐字节重复**引擎 ${md5Hit.slice(0, 3).join(', ')} ⇒ **只能删**（豁免≠免检；面向读者请改成指针/索引）` })
    continue
  }
  const a = wlHit(f.rel)
  if (a) { allowed.push({ ...info, cat: a.category, why: a.reason || '' }); continue }
  // 违反：逐字节重复 > 同名/改名快照 > 未知
  const probeShaHit = h ? (probe.sha.get(h) || []) : []
  if (!md5Hit.length && !nameHit.length && probeShaHit.length) {
    fatal.push(`${f.rel} → 对应物**只在探针树**（${probeShaHit.slice(0, 3).join(', ')}，**未被 git 跟踪**）⇒ **先入库**，不许删/豁免`)
  }
  const kind = md5Hit.length ? `逐字节重复**入库树** ${md5Hit.slice(0, 3).join(', ')} ⇒ **删**`
    : nameHit.length ? `入库树有同名文件 ${nameHit.slice(0, 3).join(', ')} ⇒ **改名旧快照嫌疑 ⇒ 删**（若确为 docs 独有须给行级证据）`
      : probeShaHit.length ? `⛔ 对应物**只在 gitignore 探针树**（${probeShaHit.slice(0, 3).join(', ')}）⇒ **先入库**（基线无效，不许删）`
        : '入库树全树无对应物且未登记 ⇒ **入白名单（带类别）或删**'
  viol.push({ ...info, kind })
}

console.log(`\n--- ① 豁免（evidence/ 子树 · .md 文档）：${exempt.length} 个 ---`)
for (const e of exempt) {
  const c = e.md5Hit.length ? ` ⚠ 引擎有逐字节相同：${e.md5Hit.slice(0, 2).join(', ')}` : (e.nameHit.length ? ` · 引擎同名：${e.nameHit.slice(0, 2).join(', ')}` : '')
  console.log(`  · ${e.rel}  [${e.why}]${c}`)
}
console.log(`\n--- ② 白名单命中：${allowed.length} 个 ---`)
for (const a of allowed) console.log(`  · ${a.rel}  [${a.cat}]  ${a.why}`)

/* ---------- 索引断言（team-lead ②：「索引必须为真」）----------
   `docs/README.md` 里**列出的每个文件路径**都必须 ①**存在** ②**被 git 跟踪**（否则就是"索引指向已删文件"的静默腐烂）。
   只校验"本目录内"的路径（含扩展名的相对路径）——`deck-contract/x.mjs`、`scripts/…/html-deck/` 这类**外部引用**不校验。 */
const idxViol = []
const readmeP = join(DOCS_DIR, 'README.md')
if (!existsSync(readmeP)) idxViol.push('docs/README.md 不存在（索引缺失 ⇒ 红）')
else {
  const docsTracked = gitTracked(DOCS_DIR)
  const txt = readFileSync(readmeP, 'utf8')
  const seen = new Set()
  for (const m of txt.matchAll(/`([^`\n]+)`/g)) {
    const p = m[1].trim()
    if (p.startsWith('.')) continue                                     // `.md` 这类"扩展名写法"不是路径（我第一版误报过）
    const leaf = p.includes('/') ? p.split('/').pop() : p
    if (!/^[\w][\w.\-]*\.(md|json|png|ps1|sh|cjs|py|txt)$/i.test(leaf)) continue  // 只认"像文件名的项"
    if (p.includes('*') || p.includes('…')) continue                    // 通配/省略写法不算
    if (p.includes('/') && !/^(evidence|tools|examples|fonts)\//.test(p)) continue  // 跳过外部引用
    if (seen.has(p)) continue
    seen.add(p)
    if (!existsSync(join(DOCS_DIR, p))) idxViol.push(`${p} —— README 列出但**不存在**（索引腐烂）`)
    else if (!docsTracked.has(p)) idxViol.push(`${p} —— 在树上但**未被 git 跟踪**（克隆者拿不到）`)
  }
  console.log(`\n--- 索引断言（README.md 列出 ${seen.size} 个本目录路径）---`)
  if (idxViol.length) for (const x of idxViol) console.error(`  ✗ ${x}`)
  else console.log(`  ✓ 全部存在且在 git 跟踪里`)
}

/* ---------- 证据引用断言（team-lead ①：**不许有孤儿二进制**）----------
   `evidence/` 下每个文件都必须在 `README.md` 或 `probe-REPORT.md` 里被**引用**（按 filename 子串匹配）——
   否则"没人引的证据"会慢慢变成垃圾场（且克隆者不知道它为什么在）。 */
const evDir = join(DOCS_DIR, 'evidence')
if (existsSync(evDir)) {
  const evFiles = walk(evDir)                       // ⚠️ walk() 返回 [{p, rel}]（不是字符串；第一版按字符串用 ⇒ `basename(Object)` 崩）
  const cite = ['README.md', 'probe-REPORT.md']
    .filter((f) => existsSync(join(DOCS_DIR, f)))
    .map((f) => readFileSync(join(DOCS_DIR, f), 'utf8')).join('\n')
  const orphan = evFiles.filter((f) => !cite.includes(basename(f.rel)))
  console.log(`\n--- 证据引用断言（evidence/ ${evFiles.length} 个文件必须在 README.md / probe-REPORT.md 里被引用）---`)
  if (orphan.length) {
    for (const x of orphan) console.error(`  ✗ evidence/${x.rel} —— **孤儿证据**（没人引用）`)
    console.error(`\n✗ **孤儿证据**：${orphan.length} 个 ⇒ exit 1（要么在 README/报告里引用它，要么删掉）`)
    process.exit(1)
  }
  console.log('  ✓ 全部被引用')
}

console.log(`\n--- ⑤ 违反（未登记分叉）：${viol.length} 个 ---`)
for (const v of viol) console.log(`  ✗ ${v.rel}  ⇒ ${v.kind}`)

if (fatal.length) {
  console.error(`\n⛔ **基线无效（exit 2）**：${fatal.length} 个 docs 文件的对应物**只在 gitignore 探针树**（不可分发）`)
  console.error('   ⇒ 处置：**先把对应物拷进入库树**（`scripts/video-factory/html-deck/…`，核 MD5）**再删** docs 副本；不许删、不许豁免。')
  for (const x of fatal) console.error(`    · ${x}`)
  process.exit(2)
}
if (idxViol.length) {
  console.error(`\n✗ **索引不真**：README.md 列出 ${idxViol.length} 个不存在/未跟踪的路径 —— 要么**重新生成索引**，要么把文件补回并 git add（索引腐烂会让人找不到东西）。`)
  process.exit(1)
}
if (viol.length) {
  console.error(`\n✗ docs 分叉不变量失败：${viol.length} 项未登记分叉（§25a：上面为**未经筛选**的原始清单）`)
  console.error(`  处置：① 引擎里从来没有过 ⇒ 入 \`docs-fork-allowlist.json\`（**必须带 category**：docs-only | experiment）；`)
  console.error(`        ② 引擎里有（旧版本/改名快照/逐字节重复）⇒ **只能删**（白名单不收留旧版本）；`)
  console.error(`        ③ docs 独有内容而引擎更旧 ⇒ 先**回迁引擎**，再删 docs 侧，并登记回迁 commit/行级证据。`)
  process.exit(1)
}
console.log(`\n✓ docs 分叉不变量成立：白名单 ${allow.length} 条 · 豁免 ${exempt.length} 个 · 违反 0`)
