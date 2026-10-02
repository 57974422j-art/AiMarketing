#!/usr/bin/env node
/**
 * check-exit-codes.mjs —— 回归 `ENGINE-CONTRACT.md` 承诺的**退出码语义**
 *
 * 为什么需要它：契约里写"服务端能照着调、出错能自己判"，那退出码就必须被**测**，不能只被写。
 * 本脚本只跑 `--no-render`（不落视频，秒级），断言各失败阶段给出各自的退出码 + 可解析的 RESULT 行。
 *
 * 用法: node check-exit-codes.mjs
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ENGINE = join(HERE, 'render-deck.mjs')
const ex = (f) => join(HERE, 'examples', f)

const CASES = [
  { desc: '合格 deck（--no-render）→ 成功', file: ex('deck.charttypes.json'), extra: ['--no-render', '--outdir', join(HERE, 'out-exitcode')], expect: 0, stage: 'no-render' },
  { desc: '未知 masterId（master-v9）→ 前置不满足', file: ex('deck.bad-master.json'), extra: ['--no-render'], expect: 2, stage: 'master' },
  { desc: 'palette 不属于所选母版（master-v1 + azure）→ 前置不满足', file: ex('deck.bad-palette.json'), extra: ['--no-render'], expect: 2, stage: 'palette' },
  // ★ 优先级：前置检查(母版/palette/asset) **先于** 契约校验 ⇒ 这个 deck 同时"palette 非法 + 内容不达标"，
  //   按契约顺序应报 2/palette（不是 3/validate）。文档里必须写明这个顺序，否则服务端会误判。
  { desc: '非法 palette + 内容不达标 → 按优先级报 palette（前置先于校验）', file: ex('deck.bad.json'), extra: ['--no-render'], expect: 2, stage: 'palette' },
  { desc: '图表页数据不达标（前置都合法）→ 契约校验不通过', file: ex('deck.bad-chart.json'), extra: ['--no-render'], expect: 3, stage: 'validate' },
  { desc: '自定义封面素材（尚未实现）→ 明确报错而非静默忽略', file: ex('deck.covercustom.json'), extra: ['--no-render'], expect: 2, stage: 'asset' },
  { desc: 'deck 文件不存在 → 用法错', file: join(HERE, 'examples', '__not_exist__.json'), extra: ['--no-render'], expect: 2, stage: 'usage' },
  { desc: '缺 deck 路径参数 → 用法错', file: null, extra: ['--no-render'], expect: 2, stage: 'usage' },
  // 渲染阶段失败：用 ENGINE_HF_BIN 指向不存在的渲染器（故障演练），必须给 5 而不是 1
  { desc: '渲染器不可用（ENGINE_HF_BIN 指向不存在）→ 渲染失败', file: ex('deck.master-v1.json'), extra: ['--outdir', join(HERE, 'out-exitcode')], expect: 5, stage: 'render', env: { ENGINE_HF_BIN: join(HERE, '__no_such_renderer__') } },
  // ★ 字体覆盖闸门（坑 28）：deck 含缺字 → 渲染入口必须给 8。
  //   deck 临时造（在合法 deck 的标题里塞一个必然缺字的 emoji），用完即删 —— **不污染 examples 基线**。
  //   注意映射：脚本自身缺字退 1，渲染入口统一映射为 EXIT.FONT=8（见 fonts/README.md §5）。
  {
    desc: '字体覆盖闸门：deck 含缺字（emoji）→ exit 8 / stage fonts',
    file: null,
    mkDeck: () => {
      const p = join(HERE, '__tmp_font_missing.json')
      const d = JSON.parse(readFileSync(ex('deck.types8.json'), 'utf8'))
      d.meta.title = d.meta.title + '🙂'
      writeFileSync(p, JSON.stringify(d, null, 2), 'utf8')
      return p
    },
    extra: ['--no-render', '--outdir', join(HERE, 'out-exitcode')],
    expect: 8, stage: 'fonts',
  },
]

let bad = 0
console.log('\n=== 退出码语义回归（ENGINE-CONTRACT.md）===\n')

/* ------------------------------------------------------------------
   额外演练：exit 4（对账不通过）
   ★ 这个码**无法由"合法 deck"触发**（闸门在前，这是好事），所以它在"按文档写"的测试里天然是盲区。
     消盲区的方法：现造一份"**故意少写一处内容**"的生成器副本，跑一次，断言它报 4。
     这样 §8 就不再需要写"4 未被覆盖"。
   ------------------------------------------------------------------ */
function drillReconcile() {
  const tmp = join(HERE, '__tmp_break_content.mjs')
  const src = readFileSync(ENGINE, 'utf8')
  const needle = 'esc(deck.meta.subtitle)'
  if (!src.includes(needle)) return { ok: false, why: '注入点失效（找不到 esc(deck.meta.subtitle)）' }
  writeFileSync(tmp, src.replace(needle, '"(故意丢弃的副标题)"'), 'utf8')
  let code = null, stage = null
  try {
    const r = spawnSync(process.execPath, [tmp, ex('deck.master-v1.json'), '--no-render',
      '--outdir', join(HERE, 'out-exitcode-drill')], { encoding: 'utf8' })
    code = r.status
    const line = (r.stdout || '').split('\n').find((l) => l.startsWith('RESULT '))
    try { stage = JSON.parse(line.slice(7)).stage } catch { stage = '(无 RESULT 行)' }
  } finally {
    if (existsSync(tmp)) unlinkSync(tmp)
  }
  const ok = code === 4 && stage === 'reconcile'
  if (!ok) bad++
  console.log(`  ${ok ? '✓' : '✗'} 生成器少写内容（故障演练）→ 对账不通过`)
  console.log(`      期望 exit=4/stage=reconcile  实际 exit=${code}/stage=${stage}`)
}
for (const c of CASES) {
  // 有些用例需要"临时造一份 deck"（如故意含缺字）——用完即删，不污染 examples 基线
  const file = c.mkDeck ? c.mkDeck() : c.file
  const args = file ? [ENGINE, file, ...c.extra] : [ENGINE, ...c.extra]
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', env: { ...process.env, ...(c.env || {}) } })
  if (c.mkDeck && existsSync(file)) unlinkSync(file)
  const code = r.status
  const resLine = (r.stdout || '').split('\n').find((l) => l.startsWith('RESULT '))
  let parsed = null
  try { parsed = JSON.parse(resLine.slice(7)) } catch { /* 无 RESULT 行 */ }
  const ok = code === c.expect && !!parsed && parsed.ok === (c.expect === 0) && parsed.stage === c.stage
  if (!ok) bad++
  console.log(`  ${ok ? '✓' : '✗'} ${c.desc}`)
  console.log(`      期望 exit=${c.expect}/stage=${c.stage}  实际 exit=${code}/stage=${parsed ? parsed.stage : '(无 RESULT 行)'}${parsed && parsed.error ? '  · ' + String(parsed.error).slice(0, 70) : ''}`)
}
drillReconcile()

console.log(`\n结论: ${bad === 0 ? `PASS（${CASES.length + 1} 个退出码场景全部符合契约，含 1 个故障演练）` : `FAIL（${bad} 个场景不符）`}`)
process.exit(bad === 0 ? 0 : 1)
