/** deck-targets.mjs —— **声明清单的唯一实现**（team-lead ②.1：不许两处各写一套）
 *
 * 背景：`gate-release` 与 `check-coverage-matrix` 各自"由**磁盘现状**定义被测集" ⇒ ① 磁盘一乱（`out-sweep-k*` ×30）
 *   就会污染测评集；② 两套实现容易漂移（本项目已被"两套实现"坑过两次）。⇒ 本模块是**唯一来源**。
 *
 * 声明档 = `examples/deck.*.json` − 反例（`bad-expected.json`） − 排除表（`exclude-coverage.json`）。
 * 纪律：① 排除表条目必须带 `why` + `category`；② 禁静默跳过（每个 example 必须有归属，否则计入 issues）；
 *      ③ 未声明产物**可见忽略**（打印一行，不静默纳入/消失）。
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { DECK_DIR, EXAMPLES_DIR } from './paths.mjs'

export const OUT_ROOTS = ['out', 'out-master-v2']

const readJson = (p, fb) => { try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return fb } }
const globToRe = (g) => new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$')

/** 反例档（bad-expected.json）⇒ 本来就该失败、不产出物、也不是覆盖缺口 */
export function badDecks() {
  return (readJson(join(DECK_DIR, 'bad-expected.json'), { bad: [] }).bad || []).map((x) => x.deck)
}

/** 排除表（exclude-coverage.json）：**只许显式目录名**（禁 glob）+ 必须带 `reason`（或别名 `why`）+ `category` */
export function exclusions() {
  return (readJson(join(DECK_DIR, 'exclude-coverage.json'), { exclude: [] }).exclude || []).map((e) => {
    /* ⚠️ 字段名统一：一律按 `x.reason || x.why` 读（两者都缺才报）—— team-lead 抽验时因只认 `reason` 误报过 */
    const reason = e.reason || e.why
    const dirs = Array.isArray(e.dirs) ? e.dirs : (e.dir ? [e.dir] : [])
    return { dirs, category: e.category, reason, hasGlob: Boolean(e.glob), ok: Boolean(dirs.length && reason && e.category && !e.glob) }
  })
}
/** 展开后的排除集合（**每次运行都要打印**：新命中必须可见，不许静默变多） */
export function exclusionsExpanded() { return exclusions().flatMap((e) => e.dirs) }
const matched = (list, deck) => list.find((e) => e.dirs.includes(deck))

/** 声明档 = 应当产出成片的档 */
export function declaredDecks() {
  const issues = []
  const ex = exclusions()
  for (const e of ex) {
    if (e.hasGlob) issues.push(`排除表**不许用 glob**（会把将来新增的档静默吸收）⇒ 改成显式目录名：${JSON.stringify(e.dirs)}`)
    else if (!e.ok) issues.push(`排除表条目缺 dirs/reason(或 why)/category：${JSON.stringify(e.dirs)}`)
  }
  const bad = new Set(badDecks())
  const decks = []
  if (!existsSync(EXAMPLES_DIR)) return { decks, issues: [...issues, `examples 不存在：${EXAMPLES_DIR}`] }
  /* ★ 声明档 = **全部** `examples/*.json`（不只 `deck.*`）− 反例 − 排除表。
     ⚠️ 我曾只收 `deck.*` 且对 `palette-*.json` **静默忽略** ⇒ 那正是"禁静默跳过"要防的：cover 矩阵随后暴露
     `master-v1 · olive/clay/mist-blue` 覆盖为 0（其覆盖原先靠**旧 `palette-*` 产物** ⇒ 假覆盖）。 */
  const all = readdirSync(EXAMPLES_DIR).filter((x) => x.endsWith('.json')).map((x) => x.replace(/\.json$/, ''))
  for (const deck of all) {
    if (bad.has(deck) || matched(ex, deck)) continue
    decks.push({ deck, outdir: /-master-v2$/.test(deck) ? 'out-master-v2' : 'out', example: join(EXAMPLES_DIR, `${deck}.json`) })
  }
  /* 禁静默跳过：每个 examples/*.json 必须有归属（声明档 / 反例 / 排除表） */
  for (const n of all) {
    if (bad.has(n) || matched(ex, n) || decks.some((d) => d.deck === n)) continue
    issues.push(`examples/${n}.json 既不在声明档、也不在反例/排除表 ⇒ 禁静默跳过`)
  }
  return { decks, issues }
}

export const mp4Of = ({ outdir, deck }) => join(DECK_DIR, outdir, deck, `output-${deck}.mp4`)
export const hasMp4 = (d) => existsSync(mp4Of(d))

/** 磁盘现状：**全枚举** `out/` + `out-master-v2/` 的**全部子目录**（team-lead 抓到的真洞）。
 *  ⚠️ 旧版按**目录名前缀**（以 `deck.` 开头）过滤子目录 ⇒ **不以该前缀命名的目录对我不可见**
 *  ⇒ `undeclaredProducts()` 是集合差 ⇒ 那些目录**既不进声明也不算未声明** ⇒ **"可见忽略"承诺失效**（静默消失）。
 *  活例子：`out/palette-clay` 等就是**没有该前缀**的档；将来任何别的目录名都会静默消失。
 *  ⇒ 现在**不做任何前缀/正则/glob 过滤**，只做**集合成员判定**（调用方按声明集合分类），并导出 `scanSummary()` 供打印总数。 */
export function diskProducts() {
  const out = []
  for (const r of OUT_ROOTS) {
    const base = join(DECK_DIR, r)
    if (!existsSync(base)) continue
    for (const e of readdirSync(base, { withFileTypes: true })) {
      if (!e.isDirectory()) continue
      out.push({ outdir: r, deck: e.name, mp4: existsSync(join(base, e.name, `output-${e.name}.mp4`)), staleFlag: existsSync(join(base, e.name, 'STALE.md')) })
    }
  }
  return out
}

/** 扫描计数（**每次必须打印**：任何过滤都无法再静默缩小集合） */
export function scanSummary() {
  const all = diskProducts()
  const decl = new Set(declaredDecks().decks.map((d) => `${d.outdir}/${d.deck}`))
  const undecl = all.filter((p) => !decl.has(`${p.outdir}/${p.deck}`)).map((p) => `${p.outdir}/${p.deck}`)
  return { total: all.length, declared: all.length - undecl.length, undeclared: undecl }
}

/** 磁盘有、但不在声明档里的产物 ⇒ 打印用（不静默纳入，也不静默消失） */
export function undeclaredProducts() {
  const decl = new Set(declaredDecks().decks.map((d) => `${d.outdir}/${d.deck}`))
  return diskProducts().filter((p) => !decl.has(`${p.outdir}/${p.deck}`)).map((p) => `${p.outdir}/${p.deck}`)
}

export const mtime = (p) => { try { return statSync(p).mtimeMs } catch { return 0 } }
export const _selfCheck = () => declaredDecks()
