#!/usr/bin/env node
/**
 * check-examples.mjs —— 样例集回归自检（D11）
 *
 * 为什么需要它：契约（deck.schema.json）与闸门（validate-deck.mjs）是两份规则，
 * 改一边就可能把闸门**改松**（比如把"要点 ≥3 条"改成 ≥1 条，金样例照样过、反例却不再报错）。
 * 本脚本以**带基线数字**的断言锁住三件事：
 *   ① 每个样例的 exit code 不变
 *   ② 每个样例的"不达标项数 / 建议数"与基线**完全相同**（数量一变就红）
 *   ③ 掺 HTML 样例的报错**恰好落在 HTML 相关路径**上（防止闸门被放宽后别的东西开始漏）
 *
 * 用法: node check-examples.mjs           （人读）
 *       node check-examples.mjs --json    （机器可读）
 * 退出码: 0 = 全部符合基线; 1 = 有偏离
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
// 允许指向另一个校验器副本：用于自证"闸门被改松时回归会不会变红"（见 README §5）
const VALIDATOR = process.env.DECK_VALIDATOR || join(HERE, 'validate-deck.mjs')

/** 基线：随契约有意变更时，必须在这里显式改数（改数即"我确认放宽/收紧了闸门"） */
const BASELINE = [
  {
    file: 'examples/deck.master-v1.json',
    desc: '金样例（真实母版内容，事实基准）',
    exit: 0, errors: 0, warns: 0,
  },
  {
    file: 'examples/deck.bad.json',
    desc: '反例（多类不达标）',
    exit: 1, errors: 13, warns: 3,
  },
  {
    file: 'examples/deck.html-injected.json',
    desc: '金样例掺 HTML/CSS（闸门命中）',
    exit: 1, errors: 3, warns: 0,
    allErrorsMatch: /HTML\/CSS 标记/,
  },
  // ---- 新页型 4→8 的反例（每种新页型各 1 个；每个都只让"目标页型"报错，其余页合法）----
  {
    file: 'examples/deck.bad-section.json',
    desc: '章节页：只有编号、无标题、副题过短',
    exit: 1, errors: 2, warns: 1,
  },
  {
    file: 'examples/deck.bad-chart.json',
    desc: '图表页：数据点 <4、含非数字、解释过短',
    exit: 1, errors: 3, warns: 0,
  },
  {
    file: 'examples/deck.bad-compare.json',
    desc: '对比页：左栏 1 条、右栏 5 条、结论过短',
    exit: 1, errors: 3, warns: 0,
  },
  {
    file: 'examples/deck.bad-quote.json',
    desc: '引用页：名词短语（缺句末标点）、作者过短',
    exit: 1, errors: 2, warns: 0,
  },
  {
    file: 'examples/deck.bad-toc.json',
    desc: '目录页：只有 2 条（要求 3~6）',
    exit: 1, errors: 1, warns: 0,
  },
  {
    file: 'examples/deck.bad-summary.json',
    desc: '小结页：4 条（要求恰好 3 条）',
    exit: 1, errors: 1, warns: 0,
  },
  // ---- 母版枚举化（masterId 枚举 + 资产必须真存在）----
  {
    file: 'examples/deck.bad-master.json',
    desc: '非法 masterId（master-v9 不在枚举内）',
    exit: 1, errors: 1, warns: 0,
  },
  {
    file: 'examples/deck.bad-palette.json',
    desc: 'palette 不属于所选母版（master-v1 没有 azure）',
    exit: 1, errors: 1, warns: 0,
  },
  // ---- 三种图表类型的验证用 deck（应全达标；它不进反例，只保证契约能过）----
  {
    file: 'examples/deck.charttypes.json',
    desc: '图表页 line / donut / bar 三连（三种真画）',
    exit: 0, errors: 0, warns: 0,
  },
  {
    file: 'examples/deck.charttypes-master-v2.json',
    desc: '同上 · master-v2 + azure',
    exit: 0, errors: 0, warns: 0,
  },
]

function run(file) {
  const r = spawnSync(process.execPath, [VALIDATOR, file, '--json'], { cwd: HERE, encoding: 'utf8' })
  let parsed = null
  try { parsed = JSON.parse(r.stdout) } catch { /* 解析失败下面单独报 */ }
  return { code: r.status, parsed, raw: r.stdout, err: r.stderr }
}

const jsonMode = process.argv.includes('--json')
const rows = []
let failed = 0

for (const b of BASELINE) {
  const abs = join(HERE, b.file)
  if (!existsSync(abs)) { rows.push({ ...b, ok: false, why: '样例文件不存在' }); failed++; continue }
  const r = run(b.file)
  const why = []
  if (r.code !== b.exit) why.push(`exit ${r.code} ≠ 基线 ${b.exit}`)
  if (!r.parsed) {
    why.push(`--json 输出无法解析: ${(r.err || r.raw || '').slice(0, 120)}`)
  } else {
    if (r.parsed.errorCount !== b.errors) why.push(`不达标项 ${r.parsed.errorCount} ≠ 基线 ${b.errors}`)
    if (r.parsed.warnCount !== b.warns) why.push(`建议项 ${r.parsed.warnCount} ≠ 基线 ${b.warns}`)
    if (b.allErrorsMatch) {
      const bad = r.parsed.issues.filter((i) => i.level === 'error' && !b.allErrorsMatch.test(i.msg))
      if (bad.length) why.push(`有 ${bad.length} 条不达标不在"HTML 标记"上：${bad.map((x) => x.path).join(', ')}`)
    }
  }
  const ok = why.length === 0
  if (!ok) failed++
  rows.push({ ...b, ok, why, got: r.parsed && { errors: r.parsed.errorCount, warns: r.parsed.warnCount, exit: r.code } })
}

if (jsonMode) {
  console.log(JSON.stringify({ pass: failed === 0, failed, baselines: BASELINE.length, rows }, null, 2))
} else {
  console.log('\n=== 契约样例集回归（D11）===\n')
  for (const r of rows) {
    console.log(`  ${r.ok ? '✓' : '✗'} ${r.file}`)
    console.log(`      ${r.desc}`)
    console.log(`      基线: exit=${r.exit} 不达标=${r.errors} 建议=${r.warns}` +
      (r.got ? `   实际: exit=${r.got.exit} 不达标=${r.got.errors} 建议=${r.got.warns}` : ''))
    if (!r.ok) for (const w of r.why) console.log(`      → 偏离: ${w}`)
  }
  console.log('')
  console.log(`结论: ${failed === 0 ? `PASS（${BASELINE.length} 个样例全部符合基线）` : `FAIL（${failed}/${BASELINE.length} 个样例偏离基线）`}`)
  if (failed === 0) {
    console.log('基线数字（请登记进报告）：' +
      BASELINE.map((b) => `${b.file.split('/').pop()}=exit${b.exit}/${b.errors}err/${b.warns}warn`).join(' · '))
  }
}
process.exit(failed === 0 ? 0 : 1)
