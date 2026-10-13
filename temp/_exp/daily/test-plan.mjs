/**
 * ★VF_DAILY_V2 纯函数回归（对标 temp/_repo/test.mjs 的口径：断言 + 反例）
 * 跑法：
 *   cd G:\AiMarketing
 *   npx tsc src/lib/agent/daily-plan.ts --target es2022 --module es2022 --skipLibCheck --outDir temp/_exp/daily/run
 *   node temp/_exp/daily/test-plan.mjs
 *
 * 测的是「AI 吐出来的 JSON → 引擎能吃的配置」这一关口（这条路出错 = 用户拿到烂片子）。
 */
import {
  DAILY_STYLE, clip, extractJson, aiPrompt, normMotion, normSegs,
  buildPlanFromSegs, buildDailyPlan, formatDailyPlan, planDuration, layoutLabel, applyDailyEdit,
  buildPlanCardPayload, normTheme, themeName, PLAN_THEMES,
  embedImages, buildDoneCardPayload, rotateTheme,
} from './run/daily-plan.js'

let pass = 0, fail = 0
const ok = (cond, name, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')) }
}
const eq = (a, b, name) => ok(a === b, name, `期望 ${JSON.stringify(b)}，实得 ${JSON.stringify(a)}`)

const IMG = ['1', '2', '3', '4', '5', '6']

console.log('\n=== 1. extractJson（模型爱包代码块/加解释）===')
eq(extractJson('前面废话 {"segments":[{"imgs":[1]}]} 后面废话')?.segments.length, 1, '纯文本夹 JSON')
eq(extractJson('```json\n{"a":1}\n```')?.a, 1, 'markdown 代码块')
eq(extractJson('没有 JSON') , null, '没有 JSON → null')
eq(extractJson('{"a":'), null, '半截 JSON → null（不抛错）')

console.log('\n=== 2. normSegs：正常 AI 输出（6 图 5 段，含双图段）===')
const aiGood = {
  motion: 'lively',
  segments: [
    { kind: 'cover', kicker: '第 01 期 · 京味', stamp: '封面故事', title: ['凌晨四点', '第一锅汤'], imgs: [1], points: [['四点起火', '老汤先滚'], ['手切现片', '立盘不掉'], ['七上八下', '毛肚最佳']], form: 'overlay', place: 'cover' },
    { kind: 'feature', kicker: '后厨 · 手作', title: ['刀起刀落', '薄如纸片'], imgs: [2, 3], points: [['现切现摆', '纹理分明']], form: 'sticker', place: 'cover' },
    { kind: 'feature', kicker: '蘸料 · 自调', title: ['一碗蘸料', '各凭口味'], imgs: [4], points: [['麻酱韭花', '腐乳香菜']], form: 'vertical', place: 'mat' },
    { kind: 'feature', kicker: '门店 · 环境', title: ['木桌长凳', '热气腾腾'], imgs: [5, 6], points: [['临街窗位', '看得见锅']], form: 'overlay', place: 'cover' },
    { kind: 'end', kicker: '日报 · 收尾', title: ['今日收锅', '明日再来'], imgs: [1], points: [], form: 'sticker', place: 'cover' },
  ],
}
const g = normSegs(aiGood, 6, '京味铜锅涮肉')
eq(g.segs.length, 5, '段数保持 5')
eq(g.added, 0, '没漏图 → added=0')
eq(g.segs[0].kind, 'cover', '首段 cover')
eq(g.segs[4].kind, 'end', '末段 end')
eq(g.segs[1].imgs.join('+'), '2+3', '双图段保留 2+3')
eq(g.segs[0].stamp, '封面故事', '封面角标保留')
eq(normMotion(aiGood.motion), 'lively', '动效档 lively 保留')
ok(new Set(g.segs.map((s) => s.layout)).size >= 3, '★L2：整份至少 3 种结构（AI 只给一种时会被轮换）')
{
  const g2 = normSegs({ segments: [
    { kind: 'cover', layout: 'hero', title: ['甲乙', '丙丁'], imgs: [1], points: [['甲', '乙']] },
    { kind: 'feature', layout: 'grid4', title: ['戊己', '庚辛'], imgs: [2, 3, 4, 5], points: [] },
    { kind: 'end', layout: 'quote', title: ['壬癸', '子丑'], imgs: [6], points: [] },
  ] }, 6, '')
  eq(g2.segs.map((s) => s.layout).join(','), 'hero,grid4,quote', '★L2：AI 明确指定的三种结构原样保留（改动最小）')
  eq(g2.fixes.length, 0, '★L2：合规时 fixes 为空（不乱报）')
}

console.log('\n=== 3. normSegs：坏输入（越界/重复/3 张/超长/非法枚举）===')
const bad = normSegs({
  segments: [
    { kind: 'xyz', title: ['这是一个超过十二个字的超长标题啊啊啊', '第二行也超长了超过十二个字了'], imgs: [1, 1, 9, 2, 3], points: [['一二三四五六七八九十', '短'], ['b', 'c'], ['d', 'e'], ['f', 'g']], form: 'nope', place: 'nope' },
  ],
}, 6, '')
eq(bad.segs[0].kind, 'cover', '非法 kind → 首段强制 cover')
eq(bad.segs[0].imgs.length, 3, '★L2：越界/重复滤镜后留 3 张（上限从 2 放到 4）')
eq(bad.segs[0].imgs.join('+'), '1+2+3', 'imgs 取到 1+2+3（9 被丢、重复被去）')
eq(bad.segs[0].layout, 'grid3', '★L2：3 张图 ⇒ 结构自动定成 三图拼版')
ok(Array.isArray(bad.fixes) && bad.fixes.length > 0, '★L2：结构被校正的事记进 fixes（不闷着改）')
ok(bad.segs[0].title[0].length <= 12 && bad.segs[0].title[1].length <= 12, '标题两行都截断到 ≤12 字', JSON.stringify(bad.segs[0].title))
eq(bad.segs[0].points.length, 3, '信息点最多 3 组')
ok(bad.segs[0].points.every((p) => p[0].length <= 8 && (p[1] || '').length <= 8), '信息点每项 ≤8 字')
eq(bad.segs[0].form, 'overlay', '非法 form → overlay')
eq(bad.segs[0].place, 'cover', '非法 place → cover')
ok(bad.added > 0, '漏掉的图被自动补段（added>0）', 'added=' + bad.added)
const usedBad = new Set(bad.segs.flatMap((s) => s.imgs))
eq([...Array(6)].every((_, i) => usedBad.has(i + 1)), true, '6 张图全被覆盖（不漏素材）')

console.log('\n=== 4. normSegs：空/垃圾 → 交给调用方回落 ===')
eq(normSegs({ segments: [] }, 6, '').segs.length, 0, '空 segments → 0 段（调用方转保底）')
eq(normSegs(null, 6, '').segs.length, 0, 'null → 0 段')
eq(normSegs({ segments: [{ imgs: [] }] }, 6, '').segs.length, 0, '段里没图 → 丢弃')

console.log('\n=== 5. 保底版式 buildDailyPlan（AI 挂了也不能空手）===')
const fb = buildDailyPlan(IMG, '京味铜锅涮肉')
eq(fb.segments.length, 6, '每张图一段 → 6 段')
eq(fb.segments[0].kind, 'cover', '首段 cover')
eq(fb.segments[5].kind, 'end', '末段 end')
eq(fb.segments.map((s) => s.imgs[0]).join(','), '1,2,3,4,5,6', '图号 1..6 一一对应')
eq(new Set(fb.segments.map((s) => s.layout)).size >= 3, true, '★L2：保底版式也有 ≥3 种结构（AI 挂了也不会整份一个样）')
eq(fb.segments[0].src[0], '1', '保底段也带 src（记录对应素材，统一数组）')
ok(formatDailyPlan(fb, { topic: '', picks: [{ name: 'a.jpg' }], by: 'fallback' }).includes('对应素材'), 'src 是数组/字符串都不炸（防御式）')

console.log('\n=== 6. 引擎配置口径 ===')
const plan = buildPlanFromSegs(g.segs, '京味铜锅涮肉', 'lively')
// 模拟 daily.ts 的 attachSrc（段 → 素材名），清单里要显示"这段用了哪几张"
plan.segments.forEach((s) => { s.src = s.imgs.map((x) => x + '.jpg') })
eq(plan.meta.accent, DAILY_STYLE.accent, 'meta.accent = 风格定型色')
eq(plan.meta.paper, DAILY_STYLE.paper, 'meta.paper = 风格定型底色')
eq(plan.imageDir, 'images', 'imageDir = images')
eq(plan.motion, 'lively', 'motion 透传')
eq(buildPlanFromSegs(g.segs, 'x', '乱写的').motion, 'normal', '非法 motion → normal')
ok(planDuration(plan) > 15 && planDuration(plan) < 20, '5 段时长 ≈16.2s', String(planDuration(plan)))
eq(layoutLabel({ kind: 'cover', imgs: [1], layout: 'hero' }), '封面 · 满幅压字（1 图）', '★L2 标签：结构名 + 图数')
eq(layoutLabel({ kind: 'feature', imgs: [1, 2], layout: 'stack2' }), '正片 · 上下双图（2 图）', '★L2 标签：上下双图')
eq(layoutLabel({ kind: 'feature', imgs: [1, 2, 3, 4], layout: 'grid4', place: 'mat' }), '正片 · 四宫格（4 图） · 相纸留边', '★L2 标签：四宫格 + 留边')
eq(layoutLabel({ kind: 'cover', imgs: [1] }), '封面 · 单图通栏（1 图）', '没有 layout 字段也能出标签（老方案兼容）')

console.log('\n=== 7. 给人看的清单 formatDailyPlan ===')
const byAi = formatDailyPlan(plan, { topic: '京味铜锅涮肉', picks: IMG.map((n) => ({ name: n + '.jpg' })), by: 'ai' })
ok(byAi.includes('第 2 步 / 共 3 步'), '有"第 2 步/共 3 步"（v4 合并主题步后为 3 步流程）')
ok(byAi.includes('方案确认'), '有"方案确认"')
ok(byAi.includes(DAILY_STYLE.name), '写明唯一风格名')
ok(byAi.includes('共 **5 段**'), '写明段数')
ok(byAi.includes('确认') && byAi.includes('重选') && byAi.includes('取消'), '给全三个出口（确认/重选/取消）')
ok(byAi.includes('AI 看素材后编排'), '标注方案来源 = AI')
ok(byAi.includes('对应素材'), '每段列出对应素材名')
const byFb = formatDailyPlan(fb, { topic: '', picks: IMG.map((n) => ({ name: n + '.jpg' })), by: 'fallback', note: 'AI 没吐出可解析的 JSON' })
ok(byFb.includes('保底版式') && byFb.includes('没吐出可解析'), 'AI 失败时如实说明（不装成功）')
ok(byFb.includes('（未给 → 中性占位文案）'), '没主题时如实说明')

console.log('\n=== 8. 提示词里必须写死的约束（防走偏）===')
const p = aiPrompt(6, '京味铜锅涮肉')
for (const kw of ['先看图', '每张图至少用一次', '≤12', '不许编', '不要 markdown',
  '结构库', 'layout', '至少用到 3 种不同', '相邻两段 layout 不能相同',
  'grid3', 'grid4', 'quote', 'split', 'stack2', '图数必须与该结构匹配']) {
  ok(p.includes(kw), '提示词含约束：' + kw)
}
eq(clip('  很长   的文案  ', 4), '很长 的', 'clip 去空白+截断')

console.log('\n=== 9. 逐段微调 applyDailyEdit ===')
{
  const picks = IMG.map((n) => ({ name: n + '.jpg' }))
  const base = () => buildPlanFromSegs(JSON.parse(JSON.stringify(g.segs)), '京味铜锅涮肉', 'normal')
  base().segments.forEach((s, i) => { s.src = s.imgs.map((x) => picks[x - 1].name) })

  const p1 = base(); p1.segments.forEach((s) => { s.src = s.imgs.map((x) => picks[x - 1].name) })
  const before = JSON.stringify(p1)
  let e = applyDailyEdit(p1, '改 3 标题=刀起刀落/薄如纸片', picks)
  ok(e.ok && e.plan.segments[2].title.join('/') === '刀起刀落/薄如纸片', '改标题（斜杠分行）')
  ok(JSON.stringify(p1) === before, '不动原方案对象（深拷贝）')
  ok(e.msg.includes('第 3 段'), '回话里点明改的是哪一段', e.msg)

  e = applyDailyEdit(base(), '改 3 标题=只有一行', picks)
  ok(e.ok && e.plan.segments[2].title[0] === '只有一行', '只给一行 → 第一行替换')
  ok(e.ok && e.plan.segments[2].title.length === 2, '第二行保留（不吞掉）')

  e = applyDailyEdit(base(), '改 3 版式=竖排', picks)
  ok(e.ok && e.plan.segments[2].layout === 'vertical' && e.plan.segments[2].form === 'vertical', '★L2：改结构=竖排 → layout/form 同步 vertical')
  e = applyDailyEdit(base(), '改 2 版式=竖排', picks)
  ok(e.matched && !e.ok && e.msg.includes('张图'), '★L2：段2 有 2 张图、竖排只要 1 张 ⇒ 拦下并说清', e.msg)
  e = applyDailyEdit(base(), '改 2 版式=歪着', picks)
  ok(e.matched && !e.ok && e.msg.includes('可选'), '不认识的版式 → 报错并给可选项', e.msg)
  e = applyDailyEdit(base(), '改 2 类型=结尾', picks)
  ok(e.ok && e.plan.segments[1].kind === 'end', '改类型=结尾')

  e = applyDailyEdit(base(), '改 1 用图=2,4', picks)
  ok(e.ok && e.plan.segments[0].imgs.join('+') === '2+4', '改用图=2,4')
  ok(e.plan.segments[0].src.join('+') === '2.jpg+4.jpg', '改用图时 src 跟着换（清单才对得上）')
  e = applyDailyEdit(base(), '改 1 用图=99', picks)
  ok(e.matched && !e.ok, '图号越界 → 拦下', e.msg)
  e = applyDailyEdit(base(), '改 1 用图=1,2,3', picks)
  ok(e.ok && e.plan.segments[0].imgs.length === 3, '★L2：单段最多 4 张（3 张保留）')
  e = applyDailyEdit(base(), '改 1 用图=1,2,3,4,5,6', picks)
  ok(e.ok && e.plan.segments[0].imgs.length === 4, '★L2：给多了也只取 4 张')
  e = applyDailyEdit(base(), '改 1 版式=四宫格', picks)
  ok(e.matched && !e.ok && e.msg.includes('要 4 张图'), '★L2：结构要 4 张图而这段只有 1 张 ⇒ 拦下并说清原因', e.msg)
  const p4 = base()
  p4.segments[0].imgs = [1, 2, 3, 4]
  e = applyDailyEdit(p4, '改 1 版式=四宫格', picks)
  ok(e.ok && e.plan.segments[0].layout === 'grid4', '★L2：图数够 ⇒ 结构改成四宫格')

  e = applyDailyEdit(base(), '改 2 信息点=甲,乙;丙,丁;戊,己;庚,辛', picks)
  ok(e.ok && e.plan.segments[1].points.length === 3, '信息点最多 3 组')
  ok(e.plan.segments[1].points[0].join('') === '甲乙', '信息点按 逗号/分号 切成两列')

  e = applyDailyEdit(base(), '动效=活泼', picks)
  ok(e.ok && e.plan.motion === 'lively', '动效=活泼')
  e = applyDailyEdit(base(), '动效=乱写', picks)
  ok(e.matched && !e.ok, '不认识的动效档 → 拦下', e.msg)
  e = applyDailyEdit(base(), '节奏=稳', picks)
  ok(e.ok && e.plan.motion === 'calm', '别名：节奏=稳')

  const p2 = base()
  e = applyDailyEdit(p2, '删 1', picks)
  ok(e.ok && e.plan.segments.length === 4, '删 1 段 → 4 段')
  ok(e.ok && e.plan.segments[0].kind === 'cover', '删掉封面后，新首段顶上当封面')
  e = applyDailyEdit(base(), '删 99', picks)
  ok(e.matched && !e.ok, '删不存在的段 → 拦下', e.msg)
  const two = { ...base(), segments: base().segments.slice(0, 2) }
  e = applyDailyEdit(two, '删 1', picks)
  ok(e.matched && !e.ok, '只剩 2 段时不许再删（起码 2 段）', e.msg)

  e = applyDailyEdit(base(), '确认', picks)
  ok(!e.matched, '「确认」不是微调（交给状态机）')
  e = applyDailyEdit(base(), '帮我看下今天热榜', picks)
  ok(!e.matched, '无关的话不当微调（不抢别的线）')

  ok(layoutLabel({ kind: 'cover', imgs: [1], layout: 'vertical', place: 'mat' }) === '封面 · 竖排标题（1 图） · 相纸留边', '★L2 标签：竖排 + 留边')
}

console.log('\n=== 10. 方案确认卡载荷 buildPlanCardPayload（★V6：第 2 步也出卡）===')
eq(buildPlanCardPayload(plan, { picks: [], by: 'ai' }).step, 'daily_plan', 'step = daily_plan')
eq(buildPlanCardPayload(plan, { picks: [], by: 'ai' }).proto, 'VF_DAILY_FORM', 'proto = VF_DAILY_FORM（前端据此发本线协议串）')
{
  const pl = buildPlanCardPayload(plan, { picks: [], by: 'ai', topic: '京味铜锅涮肉' })
  eq(pl.segs.length, 5, '段数 = 5')
  ok(String(pl.segs[0].label).includes('满幅'), '第 1 段带版式标签（满幅大图）')
  eq(pl.segs[0].title.length, 2, '标题保持两行数组')
  eq(typeof pl.segs[0].points[0], 'string', '信息点拍平成字符串（前端直接显示）')
  ok(String(pl.segs[0].src[0]).includes('.jpg'), '带对应素材名')
  ok(String(pl.hint).includes('第 2 步 / 共 3 步'), '卡头写第 2 步 / 共 3 步')
  ok(String(pl.hint).includes('段'), '卡头写段数与时长')
  const pl2 = buildPlanCardPayload(fb, { picks: [], by: 'fallback', note: 'AI 没吐出可解析的 JSON' })
  eq(pl2.by, 'fallback', '保底时 by=fallback（卡上要如实标）')
  ok(String(pl2.note).includes('JSON'), '保底时带上原因')
  ok(String(buildPlanCardPayload(plan, { picks: [], by: 'ai', hintExtra: '已改：第 3 段标题 → 甲 / 乙' }).hint).includes('已改'), 'hintExtra（微调回执）能带进卡头')
}

console.log('\n=== 11. ★L4 皮肤（theme / custom + 对比度体检口径）===')
eq(themeName('night-gold'), '夜宴金', 'themeName：id → 人话名')
eq(themeName('乱写'), DAILY_STYLE.name, 'themeName：不认识 ⇒ 回落默认名')
{
  const a = normTheme({ theme: 'tea-green' })
  eq(a.theme, 'tea-green', 'normTheme：库里的皮肤原样保留')
  eq(a.fixes.length, 0, 'normTheme：合规时 fixes 为空')
  const b = normTheme({ theme: 'night-gold2' })
  eq(b.theme, 'paper-daily', 'normTheme：不在库里 ⇒ 用默认')
  ok(b.fixes.some((x) => x.includes('不在库里')), 'normTheme：如实记下"库里没有"', JSON.stringify(b.fixes))
  const c = normTheme({ custom: { paper: '#14161A', ink: '#F2EFE9', dim: '#A9A29A', accent: '#D8A94B' } })
  eq(c.theme, 'custom', 'normTheme：自定配色 ⇒ theme=custom')
  eq(c.custom.accent, '#D8A94B', 'normTheme：自定配色透传（引擎再做对比度体检）')
  const d = normTheme({ custom: { paper: '红色', ink: '#fff', dim: '#ccc', accent: '#000' } })
  ok(!d.custom && d.fixes.some((x) => x.includes('hex')), 'normTheme：自定配色不是 hex ⇒ 丢掉并记下', JSON.stringify(d.fixes))
}
{
  const pl = buildPlanFromSegs(g.segs, '夜食', 'lively', 'night-gold')
  eq(pl.meta.theme, 'night-gold', 'buildPlanFromSegs：皮肤透传给引擎')
  ok(formatDailyPlan(pl, { topic: '', picks: [], by: 'ai' }).includes('皮肤：**夜宴金**'), '清单里写明皮肤名')
  const pc = buildPlanFromSegs(g.segs, '', 'normal', 'custom', { paper: '#14161A', ink: '#F2EFE9', dim: '#A9A29A', accent: '#D8A94B' })
  eq(pc.meta.custom.accent, '#D8A94B', '自定配色进 meta.custom')
  ok(buildPlanCardPayload(pc, { picks: [], by: 'ai' }).hint.includes('皮肤'), '方案卡卡头写皮肤')
}
{
  const p2 = aiPrompt(6, '夜食')
  for (const kw of ['皮肤库', 'night-gold', 'tea-green', 'custom', '对比度', '4.5', '2.0']) {
    ok(p2.includes(kw), '提示词含皮肤约束：' + kw)
  }
}

console.log('\n=== 12. ★L3 AI 自写段（透传 / 体积上限 / 方案级开关 / 契约写进提示词）===')
{
  const raw = {
    segments: [
      { kind: 'cover', layout: 'hero', title: ['甲乙', '丙丁'], imgs: [1], points: [], html: '<div class="ai1-x">hi</div>', css: '.ai1-x{opacity:var(--sp,1)}' },
      { kind: 'feature', layout: 'hero', title: ['戊己', '庚辛'], imgs: [2], points: [] },
    ],
  }
  const g3 = normSegs(raw, 2, '')
  ok(!!g3.segs[0].html && !!g3.segs[0].css, '★L3：html/css 原样透传')
  ok(!g3.segs[1].html, '★L3：没写的段就没有 html（互不影响）')
  const big = normSegs({ segments: [{ kind: 'cover', layout: 'hero', title: ['甲乙', '丙丁'], imgs: [1], points: [], html: 'x'.repeat(9000), css: 'y'.repeat(9000) }] }, 1, '')
  eq(big.segs[0].html.length, 6000, '★L3：html 截断到 6000 字符')
  eq(big.segs[0].css.length, 6000, '★L3：css 截断到 6000 字符')
  eq(buildPlanFromSegs(g3.segs, '', 'normal').meta.aiHtml, true, '★L3：有 AI 段 ⇒ meta.aiHtml=true（方案级开关，不靠服务器环境变量）')
  ok(buildPlanFromSegs(g3.segs.filter((s) => !s.html), '', 'normal').meta.aiHtml === undefined, '★L3：纯模板 ⇒ 不开这个开关')
  const p3 = aiPrompt(6, '')
  for (const kw of ['你自己写某几段', '--sp', 'nowrap', 'ai{N}-', 'min-height:0', '竖屏 720×1280 为主', 'position:absolute', 'var(--paper)']) {
    ok(p3.includes(kw), '★L3 提示词含契约：' + kw)
  }
}

console.log('\n=== 10. 交付：单文件内嵌 embedImages + 交付卡 buildDoneCardPayload ===')
{
  const html = '<img src="images/1.jpg"><img src="images/2.jpg"><img src="images/3.jpg">'
  const imgs = [
    { n: 1, mime: 'image/jpeg', b64: 'AAA', bytes: 100 },
    { n: 2, mime: 'image/png', b64: 'BBB', bytes: 100 },
  ]
  let r = embedImages(html, imgs)
  ok(r.embedded === 2, '两张图都被内嵌')
  ok(r.html.includes('data:image/jpeg;base64,AAA'), 'data URI 写进去了（jpeg）')
  ok(r.html.includes('data:image/png;base64,BBB'), 'png 的 mime 保留')
  ok(r.html.includes('images/3.jpg'), '没有数据的图仍保留相对路径（不裂图）')
  // skipped 的语义 = "**给了图数据**但没嵌进去的"（超预算/编号对不上）；
  // 没给数据的图号（这里的 images/3.jpg）不算 skipped —— 它由调用方用 imgCount 口径去报。
  ok(r.skipped === 0, 'skipped 只数"给了图却没嵌成的"')

  r = embedImages(html, [
    { n: 1, mime: 'image/jpeg', b64: 'A', bytes: 900 },
    { n: 2, mime: 'image/jpeg', b64: 'B', bytes: 900 },
  ], 1000)
  ok(r.embedded === 1, '超预算的图不嵌（只嵌进一张）')
  ok(r.html.includes('images/2.jpg'), '超预算那张保持相对路径')

  r = embedImages(html.replace(/images\/1\.jpg/g, 'images/9.jpg'), imgs)
  ok(r.embedded === 1 && r.skipped === 1, '图号对不上就跳过（不误替换别的编号）')

  const card = buildDoneCardPayload({ name: 'a.html', viewUrl: 'http://x/f/1/a.html', dlUrl: 'http://x/f/1/a.html?dl=1',
    segs: 4, skin: '暖纸日报', by: 'ai', aiSegs: 1, structures: 3, note: 'R1~R14 通过', dropped: [], ordered: ['1.jpg ← p.jpg'] })
  ok(card.step === 'daily_done', '交付卡 step=daily_done')
  ok(card.hint.includes('第 3 步 / 共 3 步'), '交付卡写清是第 3 步')
  ok(!card.plainUrl && card.viewUrl === 'http://x/f/1/a.html', '没有单文件版 ⇒ plainUrl 空、直接用配图版')
  ok(card.imgMsg === '', '没给 imgCount 就不乱说图片状态')

  const card2 = buildDoneCardPayload({ name: 'a.html', viewUrl: 'http://x/f/1/a.html', dlUrl: 'd',
    segs: 4, skin: 's', by: 'ai', singleName: 'b.html', singleUrl: 'http://x/f/1/b.html',
    singleDlUrl: 'http://x/f/1/b.html?dl=1', imgCount: 6, embedded: 6 })
  ok(card2.viewUrl === 'http://x/f/1/b.html' && card2.dlUrl === 'http://x/f/1/b.html?dl=1', '有单文件版 ⇒ 预览/下载走单文件')
  ok(card2.plainUrl === 'http://x/f/1/a.html', '配图版仍给（另开一个链接）')
  ok(card2.imgMsg.includes('已内嵌'), '全嵌 ⇒ 明说"真图已内嵌"')

  const card3 = buildDoneCardPayload({ name: 'a.html', viewUrl: 'v', segs: 2, skin: 's', by: 'fallback', imgCount: 6, embedded: 0 })
  ok(card3.imgMsg.includes('未内嵌') && card3.facts.includes('系统保底版式'), '没嵌成 ⇒ 如实说（用户不会以为坏了）')
  ok(card3.note.includes('7 天有效'), '有效期写在卡里')

  const card4 = buildDoneCardPayload({ name: 'a.html', viewUrl: 'v', segs: 3, skin: 's', by: 'ai', imgCount: 6, embedded: 2 })
  ok(card4.imgMsg.includes('2/6'), '部分内嵌 ⇒ 报清"2/6"')
}

console.log('\n=== 11. 皮肤轮换 rotateTheme + 提示词带上次皮肤（VF_DAILY_V9）===')
{
  let r = rotateTheme('night-gold', ['paper-daily'], 'seed')
  ok(r.theme === 'night-gold' && !r.rotated, 'AI 主动挑了不一样的 ⇒ 用它（不轮换）')
  r = rotateTheme('paper-daily', ['paper-daily'], 'seed')
  ok(r.rotated && r.theme !== 'paper-daily' && r.from === 'paper-daily', 'AI 挑的还是上次那套 ⇒ 强制换')
  r = rotateTheme('', ['paper-daily'], 'seed')
  ok(r.rotated && !!r.theme && r.theme !== 'paper-daily', 'AI 没挑 ⇒ 换一个（且不是上次那套）')
  r = rotateTheme('', ['paper-daily', 'night-gold'], 'seed')
  ok(r.theme !== 'paper-daily' && r.theme !== 'night-gold', '最近两次用过的都排除')
  r = rotateTheme('custom', ['paper-daily'], 'seed')
  ok(r.theme === 'custom' && !r.rotated, 'AI 自定配色 ⇒ 不动（本身就是"不一样"）')
  const a = rotateTheme('', ['x'], 'abc'), b = rotateTheme('', ['x'], 'abc'), c = rotateTheme('', ['x'], 'zzz')
  ok(a.theme === b.theme, '同 seed 同结果（可复现）')
  const ids = PLAN_THEMES.map((t) => t.id)
  ok([a.theme, c.theme].every((x) => ids.includes(x)), '轮换结果一定落在皮肤库白名单里')

  const p1 = aiPrompt(6, '铜锅')
  ok(!p1.includes('这次必须换一个不同的皮肤'), '首次做：提示词不做"必须换"的硬要求')
  const p2 = aiPrompt(6, '铜锅', { lastTheme: 'paper-daily' })
  ok(p2.includes('必须换一个不同的皮肤') && p2.includes('暖纸日报'), '带上次皮肤 ⇒ 提示词要求换 + 写出上次是哪套')
  ok(p2.includes('night-gold') && p2.includes('tea-green'), '皮肤库 6 套仍然全在提示词里（AI 有得挑）')
}

console.log(`\n结果：通过 ${pass} · 失败 ${fail}`)
process.exit(fail ? 1 : 0)
