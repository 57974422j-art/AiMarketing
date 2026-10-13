#!/usr/bin/env node
/**
 * temp/_exp/daily/check-edit.mjs —— 复现/回归：**编辑命令里 `;` 的歧义**。
 * 病灶（用户 2026-10-14 反馈「编辑后保存可能有问题」）：
 *   信息点命令的官方口径是 `改 3 信息点=甲,乙;丙,丁`（`;` 分组），
 *   而 V20 的批量 `applyEditBatch` **也按 `;` 拆命令** ⇒
 *     ① 多组信息点被劈成两条 → 后半条不像命令 ⇒ 只改了一半（或报"这条没生效"）；
 *     ② 用户从卡片上改的、正好是"两组信息点"的段（他的第 6 段就是两组）⇒ 必踩。
 * 修法：只按**换行**拆；`;` 后面**只有当它紧跟 `改/删/动效`** 时才算命令分隔（避免误劈信息点）。
 * 跑法：node temp/_exp/daily/check-edit.mjs
 */
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { applyEditBatch, applyDailyEdit } = require('./run/daily-plan.js')

let pass = 0, fail = 0
const ok = (c, msg, extra) => { if (c) { pass++; console.log('  ✓ ' + msg) } else { fail++; console.log('  ✗ ' + msg + (extra ? '  → ' + extra : '')) } }

const mkPlan = () => ({ meta: { theme: 'tea-green' }, segments: [
  { kind: 'cover', layout: 'hero', title: ['甲', '乙'], points: [['a', 'b']], imgs: [1] },
  { kind: 'feature', layout: 'split', title: ['丙', '丁'], points: [['c', 'd'], ['e', 'f']], imgs: [2] },
  { kind: 'end', layout: 'sticker', title: ['戊'], points: [], imgs: [3] },
] })
const picks = [{ name: '1.jpg' }, { name: '2.jpg' }, { name: '3.jpg' }]

console.log('\n=== 用户那次的原样输入（他说"就感觉漏"）===')
{
  const raw = '改 15 信息点=红鼓器皿,麻酱随'
  const r = applyDailyEdit(mkPlan(), raw.replace('15', '2'), picks)
  ok(r.matched && r.ok, '单组信息点：一条命令，正常生效')
  ok(r.plan.segments[1].points.map((p) => p.join('·')).join(' | ') === '红鼓器皿·麻酱随',
    '整组替换（不是追加），且与用户输入一致')
}

console.log('\n=== 关键：**两组信息点**（用户第 6 段就是两组）===')
{
  const r = applyEditBatch(mkPlan(), '改 2 信息点=花草点缀,生菜冰碗;酥皮卷身,白盘净摆', picks)
  ok(r.matched && r.ok, '两组信息点：应该作为**一条**命令整体生效')
  const got = (r.plan.segments[1].points || []).map((p) => p.join('·')).join(' | ')
  ok(got === '花草点缀·生菜冰碗 | 酥皮卷身·白盘净摆', '两组都写进去了（不能只留第一组）', got)
}

console.log('\n=== 多条命令仍要能一次发（换行分隔；或 `;` 后紧跟"改/删/动效"）===')
{
  const a = applyEditBatch(mkPlan(), '改 1 标题=暮色/铜锅\n删 3', picks)
  ok(a.ok && a.plan.segments.length === 2 && a.plan.segments[0].title.join('/') === '暮色/铜锅', '换行分隔的两条：都生效')
  const b = applyEditBatch(mkPlan(), '改 1 标题=暮色/铜锅;删 3', picks)
  ok(b.ok && b.plan.segments.length === 2, '`;` 后紧跟"删"⇒ 仍算分隔符，两条都生效')
  const c = applyEditBatch(mkPlan(), '改 1 标题=暮色/铜锅；动效=活泼', picks)
  ok(c.ok, '全角 `；` 后紧跟"动效"⇒ 也算分隔符')
}

console.log(`\n结果：通过 ${pass} · 失败 ${fail}`)
process.exit(fail ? 1 : 0)
