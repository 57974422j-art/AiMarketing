/**
 * ★VF_PACKHEALTH_V1 的 CLI：把风格包逐个体检，产出 styles/health.json。
 *   node tools/check-style-packs.mjs            # 体检 + 写 health.json（退出码 0）
 *   node tools/check-style-packs.mjs --strict   # 有不可用包就退出码 1（给闸门用）
 *
 * 为什么要有它：用户定案「不管手动自动 都要会选，并且**选了能用不出错**」——
 *   ① 自动挑包（orchestrate.pickPack）读 health.json **跳过不可用包**；
 *   ② AGENT 卡片把不可用的包**标出来并禁用**（用户手动也选不到"没法看"的那个）。
 *
 * 体检口径 = tools/theme.mjs（唯一实现，别在这儿另抄一套阈值）。
 * 另外体检**三条结构性风险**（不判死，只登记，因为它决定"这个包在 HTML 成片里还剩多少设计"）：
 *   · structure 是 PPT 结构名（pipeline-process 之类）⇒ HTML 侧不认（母版包的通病）
 *   · elements 非空 ⇒ 这些渐变/网格/装饰 **HTML 成片不吃** ⇒ 只剩配色
 *   · spec 为空 ⇒ 该包不参与"AI 语法层"
 */
import fs from 'node:fs'
import path from 'node:path'
import { checkTokens } from './theme.mjs'

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const STYLES = path.join(HERE, '..', 'styles')
const rd = (p) => JSON.parse(fs.readFileSync(p, 'utf8'))

// HTML 成片真的会用的结构名（film-to-page/sceneBody 支持的 8 个 + 允许的别名）
const HTML_STRUCTS = new Set(['opening-hero', 'works-wall', 'glass-product', 'data-dashboard', 'fullbleed', 'plate-top', 'plate-bottom', 'grid-2x2', 'closeup-hud'])

const idx = rd(path.join(STYLES, 'index.json'))
const items = Array.isArray(idx.items) ? idx.items : []
const out = { builtAt: new Date().toISOString().slice(0, 19).replace('T', ' '), counts: {}, items: {} }
const rows = []

for (const it of items) {
  const id = String(it.id || '')
  let pack = null
  const f = path.join(STYLES, id + '.json')
  try { pack = fs.existsSync(f) ? rd(f) : null } catch { pack = null }
  const chk = pack ? checkTokens(pack.tokens) : { ok: false, problems: ['读不到 styles/' + id + '.json'], warns: [], metrics: {} }
  const warns = [...(chk.warns || [])]
  if (pack) {
    const st = Array.isArray(pack.structure) ? pack.structure : []
    const stBad = st.filter((x) => !HTML_STRUCTS.has(String(x)))
    if (stBad.length) warns.push('structure 里有 HTML 侧不认识的名字：' + stBad.join('/') + '（母版包的 PPT 结构名）')
    if (Array.isArray(pack.elements) && pack.elements.length) warns.push('elements 有 ' + pack.elements.length + ' 个（HTML 成片**不吃** ⇒ 只剩配色与字体）')
    if (!pack.spec) warns.push('没有 spec（不参与 AI 语法层；纯皮肤包）')
  }
  out.items[id] = { ok: !!chk.ok, problems: chk.problems || [], warns, metrics: chk.metrics || {}, createdBy: String(it.createdBy || (pack && pack.createdBy) || ''), name: String(it.name || (pack && pack.name) || id) }
  rows.push([id, chk.ok ? 'OK ' : 'BAD', String(it.createdBy || ''), (chk.problems || []).join('；') || '-', (chk.metrics && chk.metrics.inkBg) ? 'inkBg=' + chk.metrics.inkBg : ''])
}

const bad = Object.keys(out.items).filter((k) => !out.items[k].ok)
out.counts = { styles: items.length, ok: items.length - bad.length, bad: bad.length, badIds: bad }
fs.writeFileSync(path.join(STYLES, 'health.json'), JSON.stringify(out, null, 2))

const w = (s, n) => String(s).padEnd(n).slice(0, n)
console.log('风格包体检 —— 共 ' + items.length + ' 张：可用 ' + out.counts.ok + ' / 不可用 ' + bad.length)
console.log('  ' + w('id', 28) + w('结果', 6) + w('来源', 10) + '问题')
for (const r of rows) {
  if (r[1] === 'BAD') console.log('  ' + w(r[0], 28) + w(r[1], 6) + w(r[2], 10) + r[3])
}
const warnOnly = Object.keys(out.items).filter((k) => out.items[k].ok && out.items[k].warns.length)
console.log('  （可用但带提醒的：' + warnOnly.length + ' 张，例：' + warnOnly.slice(0, 3).map((k) => k + ' → ' + out.items[k].warns[0]).join('；') + '）')
console.log('  已写 styles/health.json')
if (process.argv.includes('--strict') && bad.length) { console.error('❌ 有 ' + bad.length + ' 张不可用（--strict）'); process.exit(1) }
