#!/usr/bin/env node
/**
 * temp/_exp/daily/test-jsonrepair.mjs —— ★VF_DAILY_V25b（AI 没吐出可解析的 JSON）的回归。
 * 为什么要有这支：这条报错**以前只能猜**（源码里连模型原文都没记），而"猜"我们已经栽过好几次。
 * 这里把模型真实会吐的五类废输出**做成样本**，逐个验证"能不能修回来"、"修到哪一级"：
 *   ① 被 maxTokens 截断（括号不闭合）② 尾随逗号 ③ 全角标点 ④ 代码块围栏/前后夹解释 ⑤ 多段连写
 * 跑法：npx tsc src/lib/agent/daily-plan.ts --target es2022 --module es2022 --skipLibCheck --outDir temp/_exp/daily/run
 *       node temp/_exp/daily/test-jsonrepair.mjs
 */
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { extractJson, extractJsonEx } = require('./run/daily-plan.js')

let pass = 0, fail = 0
const ok = (c, msg, extra) => { if (c) { pass++; console.log('  ✓ ' + msg) } else { fail++; console.log('  ✗ ' + msg + (extra ? '  → ' + extra : '')) } }
const T = (name, txt, check, wantHow) => {
  const ex = extractJsonEx(txt)
  const good = !!ex.value && check(ex.value)
  ok(good, name + (good ? '（' + ex.how + '）' : ''), good ? '' : 'how=' + ex.how)
  if (wantHow) ok(ex.how.indexOf(wantHow) >= 0, '   └ 修到的那一级是「' + wantHow + '」', 'how=' + ex.how)
  return ex
}

const isPlan = (v) => v && Array.isArray(v.segments) && v.segments.length > 0
const good = '{"theme":"copper-pot","segments":[{"layout":"hero","title":["手切鲜肉","现点现切"],"imgs":[1]},{"layout":"split","title":["黑百叶","七上八下"],"imgs":[2]}]}'

console.log('\n=== 1. 正常/常见脏输出 ===')
T('干净 JSON 直接过', good, isPlan, '直接解析')
T('代码块围栏 ```json', '```json\n' + good + '\n```', isPlan, '去围栏')
T('前后夹解释文字', '好的，我按素材排好了：\n' + good + '\n希望符合预期。', isPlan, '直接解析')
T('围栏 + 解释 + 换行', '```json\n' + good + '\n```\n以上是方案。', isPlan, '去围栏')

console.log('\n=== 2. 尾随逗号 / 全角标点 ===')
T('尾随逗号（对象）', good.replace('"imgs":[2]}', '"imgs":[2],}'), isPlan, '修尾逗号')
T('尾随逗号（数组）', good.replace('"imgs":[2]', '"imgs":[2,]'), isPlan, '修尾逗号')
T('全角冒号与逗号', good.replace(/:/g, '：').replace(/,/g, '，'), isPlan, '全角归一')

console.log('\n=== 3. 被截断（长 JSON 的典型死法）===')
// 截断在"第二个段的对象中间"——最后那个 } 是内层对象的闭合，整体并不闭合
const trunc1 = good.slice(0, good.length - 30)
T('中段截断（能救回第一段）', trunc1, (v) => v.segments && v.segments.length >= 1, '截断修复')
const trunc2 = good.slice(0, good.indexOf('"imgs":[2]') + 3)   // 截在字符串中间
T('字符串中间截断', trunc2, (v) => v.segments && v.segments.length >= 1, '截断修复')
const trunc3 = '{"theme":"night-gold","segments":[{"layout":"hero","title":["铜锅老汤","手切上桌"],"imgs":[1]},{"layout":"gri'
T('截在 key 中间', trunc3, (v) => v.segments && v.segments.length === 1, '截断修复')

console.log('\n=== 4. 真的没救的（必须老实返回 null，不能瞎猜）===')
// ⚠️ 我第一版这三行用了 `T(...)`（判据是"解析成功"）⇒ 负例必然报 ✗，是**测试写错**而不是代码错。
//    负例要断言的是"返回 null 且说明原因"，这里换成 Tnull。
const Tnull = (name, txt) => {
  const ex = extractJsonEx(txt)
  ok(ex.value === null, name + ' ⇒ 返回 null（不编造）', 'how=' + ex.how)
}
Tnull('完全不是 JSON', '我没法完成这个任务，因为素材不够。')
Tnull('空响应', '')
Tnull('纯解释 + 半个花括号', '抱歉，我先把结构列一下{')
Tnull('只有一对方括号', '[]')
ok(extractJson('') === null && extractJson('你好') === null, '兼容入口 extractJson 也不乱返回')

console.log('\n=== 5. 失败时的 how 必须能当诊断线索（含原文首尾）===')
const diag = extractJsonEx('{"segments":[{"layout":"hero"')   // 缺闭合，理论上能修
ok(typeof diag.how === 'string' && diag.how.length > 0, 'how 有内容：' + diag.how.slice(0, 40))
const bad = extractJsonEx('随便写点东西，没有 JSON')
ok(/五级都失败/.test(bad.how) && /响应 \d+ 字/.test(bad.how) && /开头/.test(bad.how) && /结尾/.test(bad.how),
  '彻底失败时 how 里有"响应字数 + 开头 + 结尾"（日志里就能看出是不是被截断）', bad.how)

console.log(`\n结果：通过 ${pass} · 失败 ${fail}`)
process.exit(fail ? 1 : 0)
