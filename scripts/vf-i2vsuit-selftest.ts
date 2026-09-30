/**
 * ★VF_I2VSUIT_V1（2026-09-30 用户定案）自测
 *
 * 用户原话（本自测要守护的结论）：
 *   「3 张动图除了文字的没看出它动，只有一个光影闪过，**这钱花的不值**」
 *   → 定案：**i2v 只对『有主体可动』的素材开（海报/截图类花了钱也看不出动）**。
 *
 * 目标：**不联网、不烧钱、不碰数据库**地证明六件事 ——
 *   ① 分类器正反例：界面/截图/海报/图表/纯文字 → **不做**；人物/产品/实拍/门店 → **做**；
 *      摘要为空 / 判不出 → **不做**（省钱优先）；陷阱词（人工智能/手机/助手）不误判；
 *   ② 过滤后 i2v 计划（images/sec/pts）**与确认卡报价逐字一致**（同源），且报价随之**下调**；
 *   ③ 被剔除的图在 notes 里**写清原因**（"为什么这几张不做"）；
 *   ④ `i2v='all'`（用户手动全开）时**完全不过滤**；
 *   ⑤ 视频混剪线的"同素材不重复"：同图不重复 / 素材不足时隔 ≥2 镜 / **绝不丢镜** / 与 route.ts 同口径；
 *   ⑥ 防回退：★I2V_BILL_V1 / ★VF_TMPCLEAN_V1 / ★VF_WDCLEAN_V1 / ★VF_POOL_V1 各 ≥1 处仍在。
 *
 * 跑法（项目根目录，任选一种；ts-node 已在 devDependencies 里）：
 *   PowerShell:  npx ts-node --transpile-only -O '{\"module\":\"commonjs\",\"moduleResolution\":\"node\"}' scripts/vf-i2vsuit-selftest.ts
 *   bash/zsh:    npx ts-node --transpile-only -O '{"module":"commonjs","moduleResolution":"node"}' scripts/vf-i2vsuit-selftest.ts
 * 退出码：全部通过 = 0，有失败 = 1。
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { classifyI2vMaterial, parseMaterialSummaries, i2vSummaryByPath } from '../src/lib/agent/vf/i2v-suit'
import { buildI2vPlan, buildI2vShots, i2vCostPoints, vfTotalCostPoints } from '../src/lib/agent/vf/i2v-plan'
import { dedupeMaterialUse } from '../src/lib/agent/vf/material-pool'

let pass = 0
let fail = 0
function ok(cond: any, name: string, extra = '') {
  if (cond) { pass++; console.log('  ✅ ' + name) }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' → ' + extra : '')) }
}
function eq(a: any, b: any, name: string) {
  ok(JSON.stringify(a) === JSON.stringify(b), name, `期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}`)
}
/** 校验"同一素材两次出现之间至少隔 gap 镜"这条不变量（与 vf-pool-selftest 同口径） */
function gapOk(ids: number[], gap = 2): boolean {
  const last = new Map<number, number>()
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]
    if (id < 0) continue
    const p = last.get(id)
    if (p !== undefined && i - p < gap) return false
    last.set(id, i)
  }
  return true
}

const MU = '/srv/storage/7/video-factory/material'
const KEY_MAP: Record<string, string> = {
  [`${MU}/a.jpg`]: 'storage/7/a.jpg',
  [`${MU}/b.jpg`]: 'storage/7/b.jpg',
  [`${MU}/c.jpg`]: 'storage/7/c.jpg',
  [`${MU}/d.jpg`]: 'storage/7/d.jpg',
  [`${MU}/e.jpg`]: 'storage/7/e.jpg',
}
const img = (n: string, dur: number) => ({ type: 'bgimage', src: `${MU}/${n}.jpg`, text: '大字', subtitle: '字幕', dur })

console.log('\n① 分类器正反例（不做：界面/截图/海报/图表/纯文字；做：人物/产品/实拍/门店）')
{
  // —— 不适合（静态平面图）——
  const bad = classifyI2vMaterial('【软件界面】AI 营销工具后台，左侧菜单 + 右侧预览框')
  eq([bad.ok, bad.kind], [false, 'interface'], '【软件界面】→ 不做')
  ok(/界面|截图/.test(bad.reason), '理由写明"界面/截图类"')
  eq(classifyI2vMaterial('这是一张网页截图，标题「数据看板」，含多个表格').ok, false, '网页截图 + 表格/标题 → 不做')
  eq(classifyI2vMaterial('【海报】主体物智能手表，标题「新品首发」，冷色调').ok, false, '【海报】→ 不做')
  eq(classifyI2vMaterial('【图表】图表主题是月度销量，关键指标 1200 单，结论上升').ok, false, '【图表】→ 不做')
  eq(classifyI2vMaterial('纯文字页，标题「限时优惠」，没有任何配图').ok, false, '纯文字页 → 不做')
  eq(classifyI2vMaterial('一张 LOGO 拼贴图，右下角有二维码').ok, false, 'logo/二维码/拼贴 → 不做')
  eq(classifyI2vMaterial('UI 设计稿，标注了每个控件的参数').ok, false, '独立单词 UI → 不做（但不误伤 guide/build）')
  eq(classifyI2vMaterial('这是一个 build 指南页面的插图').ok, false, '"build" 里的 ui 子串不误判（且判不出 → 不做）')

  // —— 适合（有主体可动）——
  const good = classifyI2vMaterial('【实拍】一位员工在门店里给顾客介绍产品，暖色调')
  eq([good.ok, good.kind], [true, 'live'], '【实拍】员工/顾客 → 做（kind=live，来自分类前缀）')
  eq([classifyI2vMaterial('一位员工在门店里给顾客介绍产品').ok,
    classifyI2vMaterial('一位员工在门店里给顾客介绍产品').kind], [true, 'person'],
    '无前缀时靠关键词命中"员工" → 做（kind=person）')
  eq(classifyI2vMaterial('产品实拍：一个包装盒放在展台上，光线明亮').ok, true, '产品/包装/展台 → 做')
  eq(classifyI2vMaterial('街景实拍，夜晚的城市街道，有汽车驶过').ok, true, '街景/车 → 做')
  eq(classifyI2vMaterial('风景照片，天空与水面，阳光洒下来').ok, true, '风景/天空/水面 → 做')
  eq(classifyI2vMaterial('一位模特手持产品，做出展示动作').ok, true, '模特/手持/动作 → 做')
  eq(classifyI2vMaterial('工厂车间里的机器设备正在运转').ok, true, '工厂/机器/设备 → 做')

  // —— 判不出 / 空 → 不做（省钱优先）——
  eq(classifyI2vMaterial('').ok, false, '摘要为空 → 不做')
  eq(classifyI2vMaterial('   ').ok, false, '摘要全是空白 → 不做')
  const unk = classifyI2vMaterial('一张图片的内容与色调说明，适合配某类文案')
  eq([unk.ok, unk.kind], [false, 'unknown'], '判不出类型 → 不做')
  ok(/省钱优先|判不出/.test(unk.reason), '理由写明"省不省钱"的取舍')

  // —— 陷阱词：含 SUIT 关键词、实际却是静态平面图 → 仍不做 ——
  eq(classifyI2vMaterial('人工智能工具的操作界面，右侧是数据图表').ok, false, '"人工智能"里的"人"不误判成人物（界面优先）')
  eq(classifyI2vMaterial('phone 界面截图，展示了一个 App 首页').ok, false, '"手机界面"里的"手"不误判（界面优先）')
}

console.log('\n② 过滤后计划与报价逐字一致，且报价随之下调（同源）')
{
  const shots = [img('a', 5), img('b', 6), img('c', 4)]
  const summary: Record<string, string> = {
    [`${MU}/a.jpg`]: '【软件界面】AI 营销工具后台，左侧菜单 + 右侧预览框',
    [`${MU}/b.jpg`]: '【实拍】一位员工在门店里给顾客介绍产品，暖色调',
    [`${MU}/c.jpg`]: '【海报】主体物智能手表，标题「新品首发」，冷色调',
  }

  // 过滤开启（传了 map）
  const plan = buildI2vPlan(shots, KEY_MAP, 6, summary)
  eq(plan.list.map((x: any) => x.index), [2], '只有"有主体可动"的第 2 镜进 i2v 名单')
  eq(plan.images, 1, '唯一图 = 1 张（界面/海报两张被跳过）')
  eq(plan.sec, 6, '计费秒数 = 6（只算第 2 镜；界面 5 秒 + 海报 4 秒不再计费）')
  eq(plan.skippedUnfit, 2, '如实记下"跳过 2 张"')
  // ★VF_I2VDFLT_V1（2026-09-30）：智能筛现在是**用户显式选**（enabled='on'）；缺省已改成 'all'（全部动）
  eq(buildI2vShots({ shots, keyByPath: KEY_MAP, summaryByPath: summary, enabled: 'on' }).points, 300,
    '显式选「智能筛」(enabled=on) 的让图动起来点数 = 6 × 50 = 300（过滤后）')

  // ★报价 = 实扣：卡片用 vfTotalCostPoints(字数, plan.sec)；i2v 明细用 i2vCostPoints(plan.sec)
  const charN = 300
  eq(vfTotalCostPoints(charN, plan.sec), 315, '总价 = 15(素材费) + 300(i2v) = 315 点（过滤后）')
  eq(i2vCostPoints(plan.sec), 300, '卡片"含让 1 张图动起来：约 300 点"= 明细口径')

  // 不过滤（旧行为 / 其它未接线的线）→ 报价明显更高，证明"过滤真的省钱"
  const raw = buildI2vPlan(shots, KEY_MAP, 6)
  eq([raw.images, raw.sec], [3, 15], '不过滤时 3 张 / 15 秒')
  eq(buildI2vShots({ shots, keyByPath: KEY_MAP }).points, 750, '不过滤时 750 点')
  eq(vfTotalCostPoints(charN, raw.sec), 765, '不过滤时总价 765 点')
  ok(raw.sec > plan.sec && vfTotalCostPoints(charN, raw.sec) > vfTotalCostPoints(charN, plan.sec),
    '过滤让报价随之下调（750 → 300；总价 765 → 315）—— 不许报高价实扣低价或反过来')

  // 同源铁证：报价与实扣都只用 plan.sec（没有第二份公式）
  eq(buildI2vShots({ shots, keyByPath: KEY_MAP, summaryByPath: summary, enabled: 'on' }).plan.sec, plan.sec,
    '报价用的 plan.sec 与出片再算一次得到的 plan.sec 完全一致（同一份摘要 → 同源）')
}

console.log('\n③ 被剔除的图在 notes 里写清原因')
{
  const shots = [img('a', 5), img('b', 6), img('c', 4)]
  const summary: Record<string, string> = {
    [`${MU}/a.jpg`]: '【软件界面】AI 营销工具后台',
    [`${MU}/b.jpg`]: '【实拍】员工给顾客介绍产品',
    [`${MU}/c.jpg`]: '【海报】智能手表新品首发',
  }
  // ★VF_I2VDFLT_V1：智能筛要**显式**选（enabled='on'）才会跳过；缺省是 'all'
  const r = buildI2vShots({ shots, keyByPath: KEY_MAP, summaryByPath: summary, enabled: 'on' })
  ok(r.notes.some((n) => n.includes('跳过 2 张')), 'notes 含"跳过 2 张"')
  ok(r.notes.some((n) => n.includes('界面/截图类')), 'notes 写清"界面/截图类"原因')
  ok(r.notes.some((n) => n.includes('海报/封面/文字页类')), 'notes 写清"海报/封面/文字页类"原因')
  ok(r.notes.some((n) => n.includes('a.jpg') && n.includes('c.jpg')), 'notes 列出被跳过的素材名（可解释）')
  ok(r.notes.some((n) => n.includes('让 1 张图动起来')), 'notes 同时如实报告"真正动了几张"')
}

console.log('\n④ i2v="all"（用户手动全开）时不过滤')
{
  const shots = [img('a', 5), img('b', 6), img('c', 4)]
  const summary: Record<string, string> = {
    [`${MU}/a.jpg`]: '【软件界面】后台',
    [`${MU}/b.jpg`]: '【实拍】员工',
    [`${MU}/c.jpg`]: '【海报】手表',
  }
  const all = buildI2vShots({ shots, keyByPath: KEY_MAP, enabled: 'all', summaryByPath: summary })
  eq([all.plan.images, all.plan.sec, all.points], [3, 15, 750], "'all' → 不过滤（3 张 / 15 秒 / 750 点）")
  eq(all.plan.skippedUnfit, 0, "'all' → 跳过数 = 0")
  ok(all.notes.some((n) => n.includes('全部动起来')), "notes 说明选了「全部动起来」")
  // 'off' 仍然一个都不注入
  eq(buildI2vShots({ shots, keyByPath: KEY_MAP, enabled: 'off', summaryByPath: summary }).args, {},
    "'off' → 不注入首帧（与 all 区分开）")
  // 未传 summaryByPath（旧调用方）→ 不过滤，保持旧行为（向后兼容）
  eq(buildI2vShots({ shots, keyByPath: KEY_MAP }).plan.images, 3,
    '未传 summaryByPath → 不过滤（向后兼容，未接线的调用方行为不变）')
  // ★VF_I2VDFLT_V1（2026-09-30 用户定案）：**缺省 = 'all'（全部动起来）** ——
  //   即使传了 summaryByPath，**不显式选 'on' 就不筛**（默认回到"每张都动"，与用户"和以前一样"的定案一致）。
  const dflt = buildI2vShots({ shots, keyByPath: KEY_MAP, summaryByPath: summary })
  eq([dflt.plan.images, dflt.plan.sec, dflt.points], [3, 15, 750],
    "缺省（未传 enabled）= 'all' → 不过滤（3 张 / 15 秒 / 750 点）")
  eq(dflt.plan.skippedUnfit, 0, "缺省 = 'all' → 跳过数 = 0（不再默认智能筛）")
}

console.log('\n⑤ "图片本地路径 → 识别摘要"映射（brief → summaryByPath）')
{
  const brief = '图1（a.jpg）：【软件界面】后台\n图2（b.jpg）：【实拍】员工\n图3（c.jpg）：【海报】手表\n（以上共看了 3 张图）'
  const byName = parseMaterialSummaries(brief)
  eq(Object.keys(byName).sort(), ['a.jpg', 'b.jpg', 'c.jpg'], '解析出 素材名 → 摘要')
  eq(byName['b.jpg'], '【实拍】员工', '摘要是"图N（name）："后面的原文')
  const mats = [{ name: 'a.jpg', localPath: `${MU}/a.jpg` }, { name: 'b.jpg', localPath: `${MU}/b.jpg` }, { name: 'x.jpg', localPath: `${MU}/x.jpg` }]
  eq(i2vSummaryByPath(brief, mats), { [`${MU}/a.jpg`]: '【软件界面】后台', [`${MU}/b.jpg`]: '【实拍】员工' },
    '按本地路径建映射；brief 里没有的素材（x.jpg）不出现 → 判不出 → 不做')
  eq(i2vSummaryByPath('用户手改的一段结论，没有图N结构', mats), {}, '用户手改版 brief 解析不出 → 空映射（提示：route.ts 用 AI 原始结论建映射）')
}

console.log('\n⑥ 视频混剪线的"同素材不重复"（同图不重复 / 隔 ≥2 镜 / 不丢镜 / 与 route.ts 同口径）')
{
  // 素材充足：重复的镜换成还没用过的
  const d1 = dedupeMaterialUse([0, 0, 1, 2], 3, 2)
  eq(d1.ids.length, 4, '去重不改镜头数（绝不丢镜）')
  ok(gapOk(d1.ids, 2), '同图不重复时满足"间隔 ≥2 镜"')
  ok(d1.reassigned >= 1, '重复镜被换成未用素材')

  // 素材不足（2 个素材 4 镜）→ 允许重复，但保证间隔
  const d2 = dedupeMaterialUse([0, 0, 0, 1], 2, 2)
  eq(d2.ids.length, 4, '素材不足也不丢镜')
  ok(gapOk(d2.ids, 2), '素材不足时同一素材仍间隔 ≥ 2 镜')
  eq(d2.unreplaceable, 0, '素材不足也无需"保留原样"')

  // 只有一个素材 → 无法满足间隔 → 保留原样 + 计数（绝不静默丢弃）
  const d3 = dedupeMaterialUse([0, 0], 1, 2)
  eq(d3.ids, [0, 0], '只有 1 个素材 → 保留原样（丢镜比重复更糟）')
  ok(d3.unreplaceable >= 1, 'unreplaceable 计数 ≥ 1')

  // 与 route.ts（图片成片线）同口径：minGap 都是 2
  const routeSrc = readFileSync(join(__dirname, '..', 'src/app/api/agent/chat/route.ts'), 'utf-8')
  const vfSrc = readFileSync(join(__dirname, '..', 'src/lib/agent/vf/vf-video.ts'), 'utf-8')
  ok(/dedupeMaterialUse\(ids, imgs\.length, 2\)/.test(routeSrc), 'route.ts 去重口径 = dedupeMaterialUse(ids, total, 2)')
  ok(/dedupeMaterialUse\(_imgIdx, imgPaths\.length, 2\)/.test(vfSrc), '视频线：图片镜去重（minGap=2，与 route.ts 同口径）')
  ok(/dedupeMaterialUse\(_vidIdx, clips\.length, 2\)/.test(vfSrc), '视频线：视频镜按片段来源（_ci）各自去重')
  const vfCalls = (vfSrc.match(/dedupeMaterialUse\(/g) || []).length
  ok(vfCalls >= 2, `视频线图片/视频两条通道都接了去重（实际 ${vfCalls} 处调用）`)
}

console.log('\n⑦ 接线对账 + 防回退（改了忘接上 / 覆盖了线上事故修复 → 这里报出来）')
{
  const routeSrc = readFileSync(join(__dirname, '..', 'src/app/api/agent/chat/route.ts'), 'utf-8')
  const vfSrc = readFileSync(join(__dirname, '..', 'src/lib/agent/vf/vf-video.ts'), 'utf-8')
  const planSrc = readFileSync(join(__dirname, '..', 'src/lib/agent/vf/i2v-plan.ts'), 'utf-8')
  const vmSrc = readFileSync(join(__dirname, '..', 'src/lib/agent/video-material.ts'), 'utf-8')
  const vtmSrc = readFileSync(join(__dirname, '..', 'src/lib/video-task-manager.ts'), 'utf-8')

  // 新接线
  ok(/classifyI2vMaterial\(/.test(planSrc) && /skippedUnfit/.test(planSrc), 'i2v-plan 已接入分类器（并记录 skippedUnfit）')
  ok(/from '\.\/i2v-suit'/.test(planSrc), 'i2v-plan 从 i2v-suit 引入（共用同一份关键词表）')
  ok(/i2vSummaryByPath\(/.test(vfSrc) && /vd\.i2vSuit = i2vSuitByPath/.test(vfSrc), '视频线：已建摘要映射并存进草稿')
  ok(/summaryByPath: vd\?\.i2vSuit/.test(vfSrc), '视频线：i2vBuildOf 把摘要透给通用函数')
  ok(/summaryByPath: vd\.i2vSuit/.test(routeSrc), '图片成片线：buildI2vShots 传入摘要映射')
  const routeSuitCalls = (routeSrc.match(/summaryByPath: vd\.i2vSuit/g) || []).length
  ok(routeSuitCalls >= 3, `图片成片线三条出口（起草/出片/重排）都传了摘要（实际 ${routeSuitCalls} 处）`)
  ok(/vd\.i2vSuit = i2vSummaryByPath\(_vfBriefAI, vfLocal\)/.test(routeSrc), '图片成片线：用 AI 原始看图结论建映射（不受用户手改影响）')
  ok(/【\$\{hit \? hit\.kw : '其他'\}】/.test(vmSrc), 'video-material：识别摘要带上分类前缀（分类器可靠判据）')
  ok(/=== 'all' \? 'all' : 'on'/.test(vfSrc) && /=== 'all' \? 'all' : 'on'/.test(routeSrc), "两条线表单都支持 i2v='all'（手动全开）")

  // 防回退：team-lead 的三段"钱/垃圾"修复 + 素材池治理
  ok(routeSrc.includes('★I2V_BILL_V1'), '★I2V_BILL_V1 仍在 route.ts（按真实秒数计费）')
  ok(routeSrc.includes('★VF_TMPCLEAN_V1'), '★VF_TMPCLEAN_V1 仍在 route.ts（抽帧后清 tmp 源视频）')
  ok(vtmSrc.includes('★VF_WDCLEAN_V1'), '★VF_WDCLEAN_V1 仍在 video-task-manager.ts（失败也清工作目录）')
  ok(routeSrc.includes('★VF_POOL_V1') && vfSrc.includes('★VF_POOL_V1'), '★VF_POOL_V1 仍在 route.ts + vf-video.ts')
}

console.log(`\n===== 自测结果：${pass} 项通过，${fail} 项失败 =====\n`)
process.exit(fail ? 1 : 0)
