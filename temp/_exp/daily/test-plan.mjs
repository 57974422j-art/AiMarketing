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
  embedImages, buildDoneCardPayload, rotateTheme, planFromCaptions, PLAN_PLACES, byLabel,
  DAILY_FX, DAILY_FX_POOL, assignFx, planFingerprint, similarity, rerollPlan, scrimFor,
  DAILY_FX_QUIET, DAILY_FX_CUT, fxCutSlot,
  cmdOf, cmdDel, cmdMotion, applyEditBatch,
  assignTextLayer, PLAN_TEXT_TYPES, PLAN_TSCALES,
  segDirection, sharedDims, checkDiversity, fixDiversity,
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
  // ★VF_DAILY_V11：现在多了一条"段数不足"的如实告知（用户：「页数多不是问题、少反而是问题」）——
  //   所以"合规"要按新口径理解：结构/图数都对 ⇒ **除段数提示外不报别的**。
  const other = g2.fixes.filter((x) => !x.includes('片长会偏短'))
  eq(other.length, 0, '★L2：合规时除"段数提示"外不报别的（不乱报）')
  ok(g2.fixes.some((x) => x.includes('片长会偏短')), '★V11：段数不足 ⇒ 如实提示（3 段 < 期望 ≥9 段）', JSON.stringify(g2.fixes))
}
{
  // ★V11：段数够时**不许**再报"片长偏短"（否则就是噪音）
  const many = { segments: [] }
  for (let i = 1; i <= 9; i++) many.segments.push({ kind: i === 1 ? 'cover' : 'feature', layout: 'hero', title: ['甲乙', '丙丁'], imgs: [(i % 6) + 1], points: [] })
  const g3 = normSegs(many, 6, '')
  ok(!g3.fixes.some((x) => x.includes('片长会偏短')), '★V11：9 段（≥期望）⇒ 不报"片长偏短"')
  ok(aiPrompt(6, '铜锅').includes('至少 9 段'), '★V11：提示词写明段数下限（6 张 ⇒ ≥9 段）')
  ok(aiPrompt(6, '铜锅').includes('最多 16 段'), '★V11：提示词写明段数上限 16')
  ok(aiPrompt(6, '铜锅').includes('少才是缺点'), '★V11：提示词说明"段少是缺点"（给视频用的口径）')
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
  // ★V19：文案改了（"未嵌"→"未取到真图"）—— 断言跟着口径走，别让文案改动制造假红
  ok(card3.imgMsg.includes('未取到真图') && card3.facts.includes('系统保底版式'), '没取到真图 ⇒ 如实说（用户不会以为坏了）')
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

console.log('\n=== 12. ★V12 看图摘要兜底 planFromCaptions + place=contain ===')
{
  const caps = '京味铜锅涮肉实拍\n1. 门店夜景门头\n2. 手切鲜羊肉，立盘不掉\n3. 冰碗虾滑，配紫苏叶\n'
  const r = planFromCaptions(caps, 3, '铜锅涮肉')
  ok(r.used === 3, '读到 3 张的内容')
  ok(r.segments.length >= 6, '段数 ≥6（3 张素材 ⇒ 期望 ≥6 段）', String(r.segments.length))
  ok(r.segments[0].kind === 'cover' && r.segments[r.segments.length - 1].kind === 'end', '首段封面 / 末段结尾')
  ok(r.segments.every((s) => s.place === 'contain'), '兜底件一律 contain（不裁主体）')
  const t = (r.segments[1].title || []).join('')
  ok(t.includes('手切') || t.includes('鲜羊'), '标题来自读图内容（不是"现场记录 2/6"）', t)
  ok(r.segments.some((s) => (s.points || []).length), '信息点也来自读图')
  ok(new Set(r.segments.map((s) => s.imgs[0])).size >= 2, '素材不够时循环用图（相邻段不同图）')
  ok(byLabel('captions').includes('看图摘要'), '来源标签：captions ⇒ 写明"按看图摘要排"')
  ok(byLabel('ai').includes('AI') && byLabel('fallback').includes('保底'), '来源标签：ai / fallback 照旧')

  const z = planFromCaptions('', 3, '')
  ok(z.used === 0, '没摘要 ⇒ used=0（不假装有内容）')
  ok(z.segments.every((s) => !!String((s.title || []).join('')).trim()), '没摘要也有标题（不会空标题）')

  ok(PLAN_PLACES.indexOf('contain') >= 0, 'place 白名单加了 contain')
  const g = normSegs({ segments: [{ kind: 'cover', layout: 'hero', title: ['甲乙', '丙丁'], imgs: [1], points: [], place: 'contain' }] }, 3, '')
  eq(g.segs[0].place, 'contain', 'AI 写 place=contain 会被保留（不再被改回 cover）')
  ok(layoutLabel({ kind: 'feature', imgs: [1], layout: 'split', place: 'contain' }).includes('整张不裁'), '清单里写"整张不裁"')
}

console.log('\n=== 13. ★V13 多样性：效果序 / 指纹 / 相似度 / 重掷 ===')
{
  const mk = (layouts) => ({ meta: { theme: 'tea-green' }, segments: layouts.map((l) => ({ layout: l, imgs: [1] })) })
  const p1 = mk(['hero', 'vertical', 'split', 'sticker'])
  assignFx(p1.segments, 0)
  // ★V19：口径改成"安静组为主 + 切分型限 1 次" ⇒ 不再断言"等于池子前 4 个"，而是断言配额与规则
  ok(p1.segments.map((s) => String(s.fx).split('#')[0]).every((x) => DAILY_FX_QUIET.includes(x)),
    '4 段（<6）⇒ 全走安静组，一个切分型都没有')
  ok(new Set(p1.segments.map((s) => String(s.fx).split('#')[0])).size >= 3, '相邻段效果 id 必不同（4 段至少 3 种）')
  const p2 = mk(['hero', 'vertical', 'split', 'sticker']); assignFx(p2.segments, 3)
  ok(p2.segments[0].fx !== p1.segments[0].fx, 'offset 不同 ⇒ 效果序整体平移（两份不会一模一样）')
  const fp1 = planFingerprint(p1, 'tea-green')
  ok(similarity(fp1, fp1) >= 0.999, '自己和自己 ≈ 100%')
  const sFx = similarity(planFingerprint(p2, 'tea-green'), fp1)
  ok(sFx > 0 && sFx < 1, '只换效果序 ⇒ 相似度在 0~1 之间（结构占大头）', sFx.toFixed(2))
  const p3 = mk(['quote', 'grid3', 'stack2', 'grid4']); assignFx(p3.segments, 5)
  const sAll = similarity(planFingerprint(p3, 'night-gold'), fp1)
  ok(sAll < 0.35, '结构+皮肤+效果都不同 ⇒ 明显不像（<35%）', sAll.toFixed(2))
  const before = planFingerprint(p1, 'tea-green')
  rerollPlan(p1, 1)
  ok(planFingerprint(p1, 'tea-green') !== before, '重掷后指纹确实变了（真的换了东西）')
  ok(p1.segments.every((s) => DAILY_FX_POOL.indexOf(s.fx) >= 0), '重掷后每段仍拿到合法效果（池内）')
  ok(similarity('', fp1) === 0, '没有上一份 ⇒ 相似度 0（首次做不触发重掷）')
}

console.log('\n=== 14. ★V15 R5′ 暗衬档 + 空列按构造消除 ===')
{
  eq(scrimFor([30, 60, 90]), 'none', '深色图 ⇒ 不加暗衬（白字本来就清楚）')
  eq(scrimFor([200, 190]), 'soft', '亮图 ⇒ 保留渐隐暗衬（白字在亮底看不清）')
  eq(scrimFor([90, 200]), 'soft', '一深一亮混段 ⇒ 保守（保留暗衬）')
  eq(scrimFor([]), 'soft', '量不到亮度 ⇒ 保守（不赌）')
  // ⚠️ 用 3 段样本（单段会被"首段=封面"等规则改写，不适合验这条）
  const g = normSegs({ segments: [
    { kind: 'cover', layout: 'hero', title: ['甲乙', '丙丁'], imgs: [1], points: [['甲', '乙']] },
    { kind: 'feature', layout: 'split', title: ['戊己', '庚辛'], imgs: [2], points: [] },
    { kind: 'end', layout: 'quote', title: ['壬癸', '子丑'], imgs: [3], points: [] },
  ] }, 3, '')
  eq(g.segs[1].layout, 'sticker', '空信息点的 split ⇒ 自动换贴纸标题（消灭空列）')
  ok(g.fixes.some((x) => x.includes('空档')), '并如实记进 fixes', JSON.stringify(g.fixes))
  const g2 = normSegs({ segments: [
    { kind: 'cover', layout: 'hero', title: ['甲乙', '丙丁'], imgs: [1], points: [['甲', '乙']] },
    { kind: 'feature', layout: 'split', title: ['戊己', '庚辛'], imgs: [2], points: [['甲', '乙']] },
    { kind: 'end', layout: 'quote', title: ['壬癸', '子丑'], imgs: [3], points: [] },
  ] }, 3, '')
  eq(g2.segs[1].layout, 'split', '有信息点的 split 原样保留（不乱改）')
}

console.log('\n=== 12. V19（A′）：效果配额 + 同级扁平图名 + 交付卡口径 ===')
{
  // ── 效果配额（用户原话：「这个不能大范围使用哦，10 个里面有一个就行」）──
  eq(fxCutSlot(4, 0), -1, '4 段短片：切分型一个名额都不给（-1）')
  eq(fxCutSlot(6, 0), 0, '6 段（刚好到线）：给一个名额，落在封面')
  ok(fxCutSlot(15, 0) === 0 && fxCutSlot(15, 1) === 14, '15 段：名额在封面(0)/收尾(14) 二选一（按 offset 奇偶）')

  const a = Array.from({ length: 15 }, () => ({}))
  assignFx(a, 0)
  const aIds = a.map((s) => String(s.fx).split('#')[0])
  const aCuts = aIds.filter((x) => DAILY_FX_CUT.includes(x))
  eq(aCuts.length, 1, '15 段里切分型**只出现 1 次**（≈"10 个里 1 个"）')
  eq(aIds[0], aCuts[0], '这一次落在封面（offset 偶数）')
  eq(aIds.filter((x) => DAILY_FX_QUIET.includes(x)).length, 14, '其余 14 段全是安静组（回拉/推近/横移）')
  ok(aIds.every((x, i) => i === 0 || x !== aIds[i - 1]), '相邻段 id 必不同（不会连着两段一个风格）')
  ok(a.every((s) => DAILY_FX_POOL.includes(String(s.fx))), '全部落在白名单（id#变体）里')

  const b = Array.from({ length: 15 }, () => ({}))
  assignFx(b, 1)
  const bIds = b.map((s) => String(s.fx).split('#')[0])
  ok(bIds.filter((x) => DAILY_FX_CUT.includes(x))[0] === bIds[14], 'offset 奇数 ⇒ 名额落到收尾')

  const c = Array.from({ length: 15 }, () => ({}))
  assignFx(c, 0)
  eq(c.map((s) => s.fx).join(), a.map((s) => s.fx).join(), '同 offset 同结果（可复现）')
  const d = Array.from({ length: 15 }, () => ({}))
  assignFx(d, 4)
  ok(d.map((s) => s.fx).join() !== a.map((s) => s.fx).join(), '不同 offset ⇒ 效果序不同（两份不重样）')

  const small = Array.from({ length: 4 }, () => ({}))
  assignFx(small, 0)
  ok(small.every((s) => DAILY_FX_QUIET.includes(String(s.fx).split('#')[0])), '4 段短片：一个切分型都没有')

  // ── 同级扁平图名（A′）：内嵌要按**同一套引用名**替换 ──
  const html2 = '<img class="ph" src="gen_x_p1.jpg"><style>:root{--img1:url(gen_x_p1.jpg);--img2:url(gen_x_p2.jpg)}</style>'
  const e2 = embedImages(html2, [{ n: 1, mime: 'image/jpeg', b64: 'AAA', bytes: 10, ref: 'gen_x_p1.jpg' }], 1024 * 1024)
  eq(e2.embedded, 1, '扁平名（img 标签 + --img 变量）都能被内嵌')
  ok(!e2.html.includes('gen_x_p1.jpg') && e2.html.includes('gen_x_p2.jpg'), '替换掉的那张干净、没数据的图名保持原样')
  // 老档（images/N.jpg）不能因为这次改动而失效
  const e3 = embedImages('<img src="images/2.jpg">', [{ n: 2, mime: 'image/jpeg', b64: 'BBB', bytes: 10 }], 1024 * 1024)
  eq(e3.embedded, 1, '没给 ref ⇒ 退回老口径 images/N.jpg（旧档照旧能嵌）')

  // ── 交付卡：图入库口径 ──
  const card5 = buildDoneCardPayload({ name: 'gen_x.html', viewUrl: 'v', segs: 3, skin: 's', by: 'ai',
    imgCount: 2, imgNames: ['gen_x_p1.jpg', 'gen_x_p2.jpg'] })
  ok(card5.imgMsg.includes('随件入库') && card5.imgMsg.includes('镜像'), '图入库 ⇒ 卡上说清"随件入库 + 客户端自动镜像"')
  eq(card5.imgNames.length, 2, '卡里带**图名表**（客户端据此把图一起镜像到本地同一文件夹）')
  ok(card5.note.includes('不用再建 images/'), '卡里不再教用户建 images/ 文件夹')
  const card6 = buildDoneCardPayload({ name: 'gen_x.html', viewUrl: 'v', segs: 3, skin: 's', by: 'ai', imgCount: 2, imgNames: ['a.jpg', ''] })
  ok(card6.imgMsg.includes('1/2'), '只入库一半 ⇒ 如实报 "1/2"')

  // ── cfg 透传：只在真给了图名表时才写（旧链路零变化）──
  const cfgOld = buildPlanFromSegs([{ title: ['a'], imgs: [1], points: [] }], 't')
  ok(!('imageNames' in cfgOld), '没给图名表 ⇒ cfg 里不出现 imageNames（旧链路产物一字不变）')
  const cfgNew = buildPlanFromSegs([{ title: ['a'], imgs: [1], points: [] }], 't', 'normal', 'paper-daily', undefined, ['gen_x_p1.jpg'])
  eq((cfgNew.imageNames || [])[0], 'gen_x_p1.jpg', '给了图名表 ⇒ 透传进 cfg（引擎据此引用）')
}

console.log('\n=== 13. V20：卡片「✏️ 编辑」= 命令拼装 + 批量执行 ===')
{
  eq(cmdOf(3, '标题', ' 刀起刀落/薄如纸片 '), '改 3 标题=刀起刀落/薄如纸片', '拼命令：两端空白去掉')
  eq(cmdDel(5), '删 5', '删段命令')
  eq(cmdMotion('活泼'), '动效=活泼', '动效命令')

  const mkPlan = () => ({ meta: { theme: 'tea-green' }, segments: [
    { kind: 'cover', layout: 'hero', title: ['甲', '乙'], points: [['a', 'b']], imgs: [1] },
    { kind: 'feature', layout: 'split', title: ['丙', '丁'], points: [['c', 'd']], imgs: [2] },
    { kind: 'end', layout: 'sticker', title: ['戊'], points: [], imgs: [3] },
  ] })
  const picks = [{ name: '1.jpg' }, { name: '2.jpg' }, { name: '3.jpg' }]

  const b1 = applyEditBatch(mkPlan(), '改 2 标题=手切/羊肉\n改 1 标题=暮色/铜锅\n删 3', picks)
  ok(b1.matched && b1.ok, '一次发三条（两改一删）⇒ 全部执行')
  eq(b1.plan.segments.length, 2, '删掉一段后只剩 2 段')
  eq(b1.plan.segments[0].title.join('/'), '暮色/铜锅', '第 1 段标题改到了')
  eq(b1.plan.segments[1].title.join('/'), '手切/羊肉', '第 2 段标题也改到了')
  ok(b1.msg.includes('已删掉第 3 段'), '汇总里写清删了哪一段')

  // UI 的排序口径：先改后删（删按段号从大到小）⇒ 服务器顺序执行时不会"段号前移改错对象"
  const b2 = applyEditBatch(mkPlan(), '改 3 标题=新的/结尾\n删 2', picks)
  ok(b2.ok && b2.plan.segments[1].title.join('/') === '新的/结尾', '先改第 3 段再删第 2 段 ⇒ 改的是原第 3 段')

  const b3 = applyEditBatch(mkPlan(), '改 2 标题=手切/羊肉\n这是一句普通聊天', picks)
  ok(b3.matched && b3.ok, '一半命令一半闲聊 ⇒ 命令照样生效')
  ok(b3.msg.includes('没生效'), '但**明说**那条没生效（绝不静默改一半）')

  const b4 = applyEditBatch(mkPlan(), '这是一句普通聊天', picks)
  ok(!b4.matched, '完全不是命令 ⇒ matched=false（交回主流程，本线不吞消息 —— V5 那条红线）')

  const b5 = applyEditBatch(mkPlan(), '改 2 版式=四宫格', picks)
  ok(b5.matched && !b5.ok, '第一条就不合法（1 张图排四宫格）⇒ 整批不执行并如实报错')

  // 卡片载荷：编辑面板要回填的三件套
  const pc = buildPlanCardPayload(mkPlan(), { picks, by: 'ai' })
  ok(pc.segs.every((s) => 'kind' in s && 'layout' in s && 'label' in s), '方案卡每段带 kind/layout/label（面板回填用）')
  const done = buildDoneCardPayload({ name: 'a.html', viewUrl: 'v', segs: 3, skin: 's', by: 'ai',
    segsBrief: [{ i: 1, title: ['甲'], points: [], kind: 'cover', layout: 'hero' }] })
  eq(done.segsBrief.length, 1, '交付卡带 segsBrief（交付之后仍能编辑）')
}

console.log('\n=== 14. V21：拖拽排序（排序=）+ 文字层参数化（type/scale）===')
{
  const mkPlan = () => ({ meta: { theme: 'tea-green' }, segments: [
    { kind: 'cover', layout: 'hero', title: ['甲', '乙'], points: [['a', 'b']], imgs: [1] },
    { kind: 'feature', layout: 'split', title: ['丙', '丁'], points: [['c', 'd']], imgs: [2] },
    { kind: 'end', layout: 'sticker', title: ['戊'], points: [], imgs: [3] },
  ] })
  const picks = [{ name: '1.jpg' }, { name: '2.jpg' }, { name: '3.jpg' }]

  const r1 = applyEditBatch(mkPlan(), '排序=3,1,2', picks)
  ok(r1.ok && r1.plan.segments.map((s) => s.title[0]).join('') === '戊甲丙', '排序=3,1,2 ⇒ 段序真的换了')
  ok(r1.plan.segments[0].kind === 'cover' && r1.plan.segments[2].kind === 'end', '位置语义跟着走（首=封面、末=结尾）')
  ok(!applyEditBatch(mkPlan(), '排序=1,2', picks).ok, '排序段号写不全 ⇒ 报错（不静默乱排）')
  ok(!applyEditBatch(mkPlan(), '排序=1,1,3', picks).ok, '排序有重复 ⇒ 报错')

  // 卡片 UI 的真实顺序：**改 → 删 → 排序**（排序必须是最后一条）
  const r4 = applyEditBatch(mkPlan(), '改 1 标题=暮色/铜锅\n删 2\n排序=2,1', picks)
  ok(r4.ok, '改+删+排序 三条一起发 ⇒ 全过')
  ok(r4.plan.segments.length === 2 && r4.plan.segments.map((s) => s.title[0]).join('') === '戊暮色',
    '删掉第 2 段后，把剩下的两段对调')

  const r5 = applyEditBatch(mkPlan(), '改 2 文字层=海报式', picks)
  ok(r5.ok && r5.plan.segments[1].type === 'poster', '文字层=海报式 ⇒ type=poster')
  ok(!applyEditBatch(mkPlan(), '改 2 文字层=不存在', picks).ok, '不认识的文字层 ⇒ 报错（并列可选项）')
  const r7 = applyEditBatch(mkPlan(), '改 2 字号=1.15', picks)
  ok(r7.ok && r7.plan.segments[1].scale === 1.15, '字号档=1.15 ⇒ 写进这一段')
  ok(!applyEditBatch(mkPlan(), '改 2 字号=3', picks).ok, '不在档位里的字号 ⇒ 报错（不让它放大到破闸门）')

  // assignTextLayer：没指定的轮换、相邻不同、已指定的不动
  const segs = [{}, {}, {}, {}, {}]
  assignTextLayer(segs, 0)
  const ids = segs.map((s) => s.type)
  eq(new Set(ids).size, 4, '5 段轮换出 4 种文字层（一份里 4 张脸）')
  ok(ids.every((x, i) => i === 0 || x !== ids[i - 1]), '相邻段文字层必不同')
  const segs2 = [{ type: 'list' }, {}, { type: 'list' }]
  assignTextLayer(segs2, 0)
  ok(segs2[0].type === 'list' && segs2[2].type === 'list', '已指定的段不动（尊重 AI/用户）')
  ok(segs2[1].type !== 'list', '没指定的那段与相邻的错开')

  // 提示词要真的把新旋钮写给 AI（不然等于没加）
  const p = aiPrompt(6, '铜锅')
  ok(p.includes('【文字层】') && p.includes('poster') && p.includes('editorial') && p.includes('list'), '提示词里有文字层库（4 种）')
  ok(p.includes('【字号档】') && p.includes('1.15'), '提示词里有字号档')
  ok(p.includes('"type":"poster"'), 'JSON 样例里带 type 字段（模型照着写）')
  eq(PLAN_TEXT_TYPES.length, 4, '四个文字层（与引擎 TEXT_TYPES 同名同数）')
  eq(PLAN_TSCALES.length, 4, '四档字号（与引擎 TSCALES 同名同数）')
}

console.log('\n=== 15. V22：去同质化硬判据（借 oil-ui：任意两方向最多共享四项里的一项）===')
{
  const seg = (layout, type, place, scale) => ({ layout, type, place, scale })
  eq(sharedDims(seg('hero', 'band', 'cover', 1), seg('hero', 'band', 'cover', 1)), 4, '四项全同 ⇒ 共享 4')
  eq(sharedDims(seg('hero', 'band', 'cover', 1), seg('split', 'poster', 'mat', 1.15)), 0, '四项全不同 ⇒ 共享 0')
  eq(sharedDims(seg('hero', 'band', 'cover', 1), seg('split', 'band', 'cover', 1)), 3, '只换摆图法（其余三项一样）⇒ 共享 3（这正是"只换颜色不算新方向"的那种）')

  // 相邻全同 ⇒ 必判不合格
  const dup = [seg('hero', 'band', 'cover', 1), seg('hero', 'band', 'cover', 1), seg('hero', 'band', 'cover', 1), seg('hero', 'band', 'cover', 1)]
  const c1 = checkDiversity(dup, 1)
  ok(!c1.ok && c1.bad.length === 3, '四段一模一样 ⇒ 3 处相邻冲突')
  eq(c1.distinct, 1, '方向组合只有 1 种')

  // 错开函数：应该把冲突改成"相邻最多共享 1 项"
  const fx = fixDiversity(dup, 1)
  // 注意：不是"3 处冲突就改 3 次" —— 改中间那一段能**同时**解开它左右两对冲突（这里 4 段全同 ⇒ 2 次就够）
  ok(fx.fixed >= 2, '错开函数把冲突解掉了（改 2 段即可同时解开相邻三对）')
  ok(checkDiversity(dup, 1).ok, '错开后相邻不撞（自检通过）')
  ok(new Set(dup.map((s) => segDirection(s).type)).size >= 2 && new Set(dup.map((s) => segDirection(s).place)).size >= 2,
    '用到的不止一个旋钮（文字层与取景都被用上）')

  // 单图素材也能救：place 必须落在 cover|mat（不许自动改成 contain）
  ok(dup.every((s) => ['cover', 'mat'].includes(s.place)), '自动错开不会把 place 改成 contain（那是"整张不裁"的语义，不能被自动动）')

  // 已经错开的片子：不动手、不报改
  const good = [seg('hero', 'band', 'cover', 1), seg('split', 'poster', 'mat', 1.15), seg('grid3', 'list', 'cover', 0.9)]
  const c2 = checkDiversity(good, 1)
  ok(c2.ok, '本来就合格的片子 ⇒ 自检通过')
  eq(fixDiversity(good, 1).fixed, 0, '合格片子不被动 → 交付时不会白改')
  eq(good[1].type, 'poster', '合格片子里的取值原样保留')

  // 方向组合数（"一份里有多少张脸"）
  ok(c2.distinct === 3, '三种方向组合就报 3 种')

  // 提示词里要真写了这三条（去同质化 / 减法 / 首屏）
  const p = aiPrompt(8, '铜锅')
  ok(p.includes('【去同质化·硬要求】') && p.includes('最多只能共享一项'), '提示词写了去同质化硬要求')
  ok(p.includes('【减法·每段一个焦点】'), '提示词写了"每段一个焦点"的减法口径')
  ok(p.includes('【首屏给谁看】') && p.includes('开场版式'), '提示词写了首屏判据（说服类要有开场版式）')
}

console.log(`\n结果：通过 ${pass} · 失败 ${fail}`)
process.exit(fail ? 1 : 0)
