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

/** 基线：随契约有意变更时，必须在这里显式改数（改数即"我确认放宽/收紧了闸门"）
 *
 * ⚠️ ★VF_REBASE_1006（2026-10-06，用户授权「改基线」）：11 个 **bad 样例**的"不达标项数"上调。
 *   **exit 与建议数一个没变**（都是 1 / 0 或 1 / 3）—— 变的只是"命中项计数"。
 *   原因（已逐条核对，不是新增缺陷）：validate-deck 现在**同一条判据被两处各报一次**——
 *   ① schema 窗口检查（`lim(...)` 读 deck.schema.json 的 minLength/maxLength）；
 *   ② 各页型的**专用检查函数**（checkChart / checkBullets …）。
 *   实测同一路径两条：`pages[2].explain` → 「2 字，少于下限 8 字（schema）」+「解释只有 2 字，要求 ≥8 字」。
 *   `deck.bad.json` 里 `pages[1].title/items/…`、`pages[2].metric.*` 同样各出现两次。
 *   ⇒ 因为是**反例**，判据命中项变多不代表闸门变松/变紧；数字上调 = "我确认当前命中数就是这些"。
 *   🟡 待办（有意留着，别顺手改）：要不要在 validate-deck 里对「同一 path + 同一判据」去重
 *   （去重后计数会回到旧基线 13/3/2… ⇒ 那时应把本表再改回去）。见 ISSUES.md 同名条目。
 */
const BASELINE = [
  {
    file: 'examples/deck.master-v1.json',
    desc: '金样例（真实母版内容，事实基准）',
    exit: 0, errors: 0, warns: 0,
  },
  {
    file: 'examples/deck.bad.json',
    desc: '反例（多类不达标）',
    exit: 1, errors: 20, warns: 3,   // ★VF_REBASE_1006：13 → 20（同一判据两处上报，见上方说明）
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
    exit: 1, errors: 3, warns: 1,   // ★VF_REBASE_1006：2 → 3
  },
  {
    file: 'examples/deck.bad-chart.json',
    desc: '图表页：数据点 <4、含非数字、解释过短',
    exit: 1, errors: 4, warns: 0,   // ★VF_REBASE_1006：3 → 4（explain 被 schema+专用检查各报一次）
  },
  {
    file: 'examples/deck.bad-compare.json',
    desc: '对比页：左栏 1 条、右栏 5 条、结论过短',
    exit: 1, errors: 6, warns: 0,   // ★VF_REBASE_1006：3 → 6
  },
  {
    file: 'examples/deck.bad-quote.json',
    desc: '引用页：名词短语（缺句末标点）、作者过短',
    exit: 1, errors: 3, warns: 0,   // ★VF_REBASE_1006：2 → 3
  },
  {
    file: 'examples/deck.bad-toc.json',
    desc: '目录页：只有 2 条（要求 3~6）',
    exit: 1, errors: 2, warns: 0,   // ★VF_REBASE_1006：1 → 2
  },
  {
    file: 'examples/deck.bad-summary.json',
    desc: '小结页：4 条（要求恰好 3 条）',
    exit: 1, errors: 2, warns: 0,   // ★VF_REBASE_1006：1 → 2
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
  // ---- 页型 11~12：图片 / 步骤（12/12 收口）----
  {
    file: 'examples/deck.all12.json',
    desc: '12 页整片：12 种页型全用上（应全达标）',
    exit: 0, errors: 0, warns: 0,
  },
  {
    file: 'examples/deck.img3.json',
    desc: '图片页三种版式 left/right/full（应全达标）',
    exit: 0, errors: 0, warns: 0,
  },
  {
    file: 'examples/deck.bad-image-missing.json',
    desc: '图片页：素材文件不存在',
    exit: 1, errors: 1, warns: 0,
  },
  {
    file: 'examples/deck.bad-image-video.json',
    desc: '图片页：给了视频素材（须暴露"入口统一转码"接口）',
    exit: 1, errors: 1, warns: 0,
  },
  {
    file: 'examples/deck.bad-image-short.json',
    desc: '图片页：标题 <4 字 + 图注 <8 字',
    exit: 1, errors: 4, warns: 0,   // ★VF_REBASE_1006：2 → 4（标题/图注各被两处上报）
  },
  {
    file: 'examples/deck.bad-steps-2.json',
    desc: '步骤页：只有 2 条',
    exit: 1, errors: 2, warns: 0,   // ★VF_REBASE_1006：1 → 2
  },
  {
    file: 'examples/deck.bad-steps-7.json',
    desc: '步骤页：有 7 条',
    exit: 1, errors: 2, warns: 0,   // ★VF_REBASE_1006：1 → 2
  },
  {
    file: 'examples/deck.bad-steps-short.json',
    desc: '步骤页：某一步只有 1 字',
    exit: 1, errors: 2, warns: 0,   // ★VF_REBASE_1006：1 → 2
  },
  // ---- D15：竖屏图片页只有 full ----
  {
    file: 'examples/deck.bad-image-portrait-left.json',
    desc: '竖屏图片页给了 left（D15 禁；报错并建议改 full）',
    exit: 1, errors: 1, warns: 0,
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
const envErrs = []   // ★ 环境/输入不完整（子进程 exit 2）—— 单独收集，最后**冒泡 exit 2**
let failed = 0

for (const b of BASELINE) {
  const abs = join(HERE, b.file)
  if (!existsSync(abs)) { rows.push({ ...b, ok: false, why: '样例文件不存在' }); failed++; continue }
  const r = run(b.file)
  // ★ K16/K15 家族修法：子进程 **exit 2 = 环境/输入不完整** ⇒ **冒泡，绝不混进基线对比**
  //   （否则"找不到 hyperframes"会伪装成"偏离基线"，把人引到错误的调查方向 —— 这正是我们踩过的坑）
  if (r.code === 2) {
    envErrs.push({ file: b.file, raw: r.err || r.raw || '' })
    rows.push({ ...b, ok: false, why: ['环境/输入不完整（exit 2）—— **不是基线回归**'] })
    continue
  }
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

/* ★ 环境错误优先冒泡：任何样例遇到 exit 2 ⇒ **本脚本 exit 2**，且**不打 PASS/FAIL 结论**
   （不许把"环境不完整"伪装成"偏离基线"；§25a：失败输出原样保留） */
if (envErrs.length) {
  console.error(`\n✗ 环境/输入不完整（exit 2），**不是基线回归** —— 共 ${envErrs.length}/${BASELINE.length} 个样例受影响：`)
  for (const e of envErrs) {
    console.error(`  · ${e.file}`)
    console.error(e.raw || '(无 stderr)')
  }
  console.error('  （若确属契约变更：把该样例基线显式改成 `exit: 2` 并登记理由；否则请先修环境再跑本脚本）')
  process.exit(2)
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
