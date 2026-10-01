/**
 * ★VF_QUOTE_FIX_V1（2026-10-01）自测 —— 画面文字里的英文引号归一化
 *
 * 背景（真实事故）：渲染层用 `-vf "…"` 拼 ffmpeg 滤镜串；**文案里出现 ASCII 双引号 `"` 会让
 *   命令行提前闭合 → 那一镜的 filter graph 直接解析失败 → 整镜渲染失败**（渲染层同学实测撞到过，
 *   只好手工把文案里的 `"` 换成中文引号绕开）。
 * 修法：在 sanitizeAntiAiShots（出片前的服务端净化）里，对**画面文字类字段**统一替换：
 *   `"` → “ / ”（成对交替；奇数个全用前引号）　`'` → ‘　`` ` `` → 删除
 *   覆盖 TEXT_KEYS（text/title/left/right/leftDesc/rightDesc/label/cta/subtitle）
 *        + items（数组逐条）+ kicker / en；**必须幂等**、**不动其它标点**、subtitle 一个字不丢。
 *
 * 本自测**纯函数、不联网、不烧钱、不碰数据库 / 不碰渲染层**。
 * 跑法（项目根目录）：
 *   npx ts-node --transpile-only -O '{"module":"commonjs","moduleResolution":"node"}' scripts/vf-quotefix-selftest.ts
 * 退出码：全部通过 = 0，有失败 = 1。
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { normalizeQuotes, sanitizeAntiAiShots } from '../src/lib/agent/vf/anti-ai'

let pass = 0
let fail = 0
function ok(cond: any, name: string, extra = '') {
  if (cond) { pass++; console.log('  ✅ ' + name) }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' → ' + extra : '')) }
}
function eq(a: any, b: any, name: string) {
  ok(JSON.stringify(a) === JSON.stringify(b), name, `实际 ${JSON.stringify(a)} / 期望 ${JSON.stringify(b)}`)
}

const root = process.cwd()

console.log('\n① normalizeQuotes：替换规则 + 幂等（直接测纯函数）')
{
  eq(normalizeQuotes('"引号"').s, '“引号”', '成对双引号 → “ ”')
  eq(normalizeQuotes("'x'").s, '‘x‘', "单引号 → ‘")
  eq(normalizeQuotes('a`b').s, 'ab', '反引号 → 删除')
  eq(normalizeQuotes('"未闭合').s, '“未闭合', '奇数个双引号 → 全用前引号（不猜哪边收尾）')
  eq(normalizeQuotes('"A"和"B"').s, '“A”和“B”', '多组成对双引号 → 逐组交替')
  eq(normalizeQuotes('"效率" 说 \'好\' 用 `code`').s, '“效率” 说 ‘好‘ 用 code',
    '混排（双引号 + 单引号 + 反引号）一次全换')
  // 计数
  eq(normalizeQuotes('"A"').n, 2, '计数：2 个双引号 = 2 处')
  eq(normalizeQuotes('a`b').n, 1, '计数：反引号删除算 1 处')
  eq(normalizeQuotes('没有引号').n, 0, '无引号 → 计数 0')
  eq(normalizeQuotes('').s, '', '空串原样')
  eq(normalizeQuotes(null as any).s, '', 'null → 空串（不抛）')
  // 幂等
  const once = normalizeQuotes('"A" 与 \'B\' 与 `C`').s
  eq(normalizeQuotes(once).s, once, '幂等：替换后再跑一次不变')
  eq(normalizeQuotes(once).n, 0, '幂等：替换后再跑一次计数 0')
  // 不误伤普通标点
  const plain = '逗号，句号。感叹！问号？分号；冒号：破折号—省略号…括号（中）[英]{花}《书名》'
  eq(normalizeQuotes(plain).s, plain, '普通中英文标点一个都不动')
  eq(normalizeQuotes(plain).n, 0, '普通标点 → 计数 0')
}

console.log('\n② sanitizeAntiAiShots：画面文字字段全覆盖 + notes 计数')
{
  const r = sanitizeAntiAiShots([{ type: 'title', text: '"效率"', subtitle: "it's ok" }])
  const s = r.shots[0]
  eq(s.text, '“效率”', 'text 里的双引号已归一化')
  eq(s.subtitle, 'it‘s ok', "subtitle 里的撇号已归一化")
  ok(r.notes.some((n) => n.includes('英文引号已归一化 3 处')), 'notes 记了准确计数（3 处）：' + JSON.stringify(r.notes))
  ok(r.notes.some((n) => n.includes('ffmpeg 滤镜串会被引号截断')), 'notes 写清了"为什么"（滤镜串被截断）')
  // 幂等：第二次不再记引号
  const r2 = sanitizeAntiAiShots(r.shots)
  ok(!r2.notes.some((n) => n.includes('英文引号')), '幂等：净化后的分镜再跑一次，不再有引号改动')
  // 覆盖 TEXT_KEYS 全部
  const keys = ['text', 'title', 'left', 'right', 'leftDesc', 'rightDesc', 'label', 'cta', 'subtitle']
  const shot: any = { type: 'compare' }
  for (const k of keys) shot[k] = `"${k}"`
  const rk = sanitizeAntiAiShots([shot]).shots[0]
  for (const k of keys) {
    ok(String(rk[k]).includes('“') && !String(rk[k]).includes('"'), `TEXT_KEYS.${k} 已归一化：${rk[k]}`)
  }
  // items（字符串 + 对象 label）+ kicker / en
  const ri = sanitizeAntiAiShots([{
    type: 'title', text: '标题', kicker: '"栏目"', en: "PRODUCT'S NAME",
    items: ['"要点一"', { label: '"要点二"' }],
  }]).shots[0]
  eq(ri.kicker, '“栏目”', 'kicker 已归一化')
  eq(ri.en, 'PRODUCT‘S NAME', 'en 已归一化（撇号）')
  eq(ri.items[0], '“要点一”', 'items 字符串项已归一化')
  eq(ri.items[1].label, '“要点二”', 'items 对象项的 label 已归一化')
  // 不动其它标点
  const rp = sanitizeAntiAiShots([{ type: 'title', text: '一句，两句话。真的！' }]).shots[0]
  eq(rp.text, '一句，两句话。真的！', '普通标点不被误伤')
  // 一字不丢：无引号的 subtitle 原样
  const sub = '这句字幕一个字都不能少，标点也在。'
  const rs = sanitizeAntiAiShots([{ type: 'title', text: 'A', subtitle: sub }]).shots[0]
  eq(rs.subtitle, sub, '无引号的 subtitle 一字不动')
}

console.log('\n③ 源码级：★VF_QUOTE_FIX_V1 标记与导出（防以后被删/改错）')
{
  const antiSrc = readFileSync(join(root, 'src/lib/agent/vf/anti-ai.ts'), 'utf-8')
  ok(/★VF_QUOTE_FIX_V1/.test(antiSrc), 'anti-ai.ts 有 ★VF_QUOTE_FIX_V1 标记（含"为什么 + 用户实测"）')
  ok(/export function normalizeQuotes/.test(antiSrc), 'normalizeQuotes 是导出的（自测/复用都要）')
  ok(/QUOTE_EXTRA_KEYS\s*=\s*\['kicker',\s*'en'\]/.test(antiSrc), 'kicker / en 在引号归一化的覆盖名单里')
  ok(/画面文字里的英文引号已归一化 \$\{quoteFix\} 处/.test(antiSrc), 'notes 文案就是约定那句（含计数）')
}

console.log(`\n${pass} 项通过 / ${fail} 项失败`)
process.exit(fail ? 1 : 0)
