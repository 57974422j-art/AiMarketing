/**
 * ★VF_I2VDFLT_V1（2026-09-30 用户定案）自测
 *
 * 用户原话（本自测要守护的结论）：
 *   「**前面 1500 的动效是可以的，质量不错。后面这 280 和 25 的确实差很多**」
 *   「其他按你规划动手。」
 *   → 定案：i2v 默认回到「**全部动起来**」；智能筛（只动有主体可动的图）改为用户主动选；
 *     跳过名单要**可见**（进卡片 JSON）；分镜卡加「🚫 关掉动图重出」；标准模式放行"改设置"的说法 + 协议串。
 *
 * 目标：**不联网、不烧钱、不碰数据库**地证明六件事 ——
 *   ① 缺省 = 全部动（未传 enabled 也做满），报价与显式 'all' **逐字一致**（给出前后两个数）；
 *   ② 智能筛（显式 enabled='on'）仍可选中并让报价**下调**；'off' = 0 点；
 *   ③ 跳过名单进入卡片（hint 最多列 3 个 + "等"；结构化 `[{name,reason}]`）；
 *   ④ 协议串 `VF_I2V_OFF:` 的放行**正反例**：有草稿放行、无草稿仍被拦；
 *   ⑤ "改设置"关键词的放行**正反例** + `i2vIntentOf` 取值映射；
 *   ⑥ `VF_I2V_OFF` 后草稿 i2v='off' 且卡片金额变小；防回退（接线标记仍在）。
 *
 * 跑法（项目根目录，任选一种；ts-node 已在 devDependencies 里）：
 *   PowerShell:  npx ts-node --transpile-only -O '{\"module\":\"commonjs\",\"moduleResolution\":\"node\"}' scripts/vf-i2vdefault-selftest.ts
 *   bash/zsh:    npx ts-node --transpile-only -O '{"module":"commonjs","moduleResolution":"node"}' scripts/vf-i2vdefault-selftest.ts
 * 退出码：全部通过 = 0，有失败 = 1。
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { buildI2vShots, i2vCostPoints, vfTotalCostPoints, i2vSkipHint, i2vSkippedList } from '../src/lib/agent/vf/i2v-plan'
import { isStdSettingMessage, isStdNoDraftAllowed, stdGatePass, i2vIntentOf } from '../src/lib/agent/standard-commands'

let pass = 0
let fail = 0
function ok(cond: any, name: string, extra = '') {
  if (cond) { pass++; console.log('  ✅ ' + name) }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' → ' + extra : '')) }
}
function eq(a: any, b: any, name: string) {
  ok(JSON.stringify(a) === JSON.stringify(b), name, `期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}`)
}

const MU = '/srv/storage/7/video-factory/material'
const KEY_MAP: Record<string, string> = {
  [`${MU}/a.jpg`]: 'storage/7/a.jpg',
  [`${MU}/b.jpg`]: 'storage/7/b.jpg',
  [`${MU}/c.jpg`]: 'storage/7/c.jpg',
}
const img = (n: string, dur: number) => ({ type: 'bgimage', src: `${MU}/${n}.jpg`, text: '大字', subtitle: '字幕', dur })
// 三张"界面/海报/纯文字"截图 —— 正是用户那类素材（智能筛会把它们全跳过）
const summary: Record<string, string> = {
  [`${MU}/a.jpg`]: '【软件界面】AI 营销工具后台，左侧菜单 + 右侧预览框',
  [`${MU}/b.jpg`]: '【海报】主体物智能手表，标题「新品首发」，冷色调',
  [`${MU}/c.jpg`]: '纯文字页，标题「限时优惠」，没有任何配图',
}
const SHOTS = [img('a', 5), img('b', 6), img('c', 4)]
const CHAR_N = 300

console.log('\n① 缺省 = 全部动（报价与显式 all 逐字一致）—— 给出前后两个数')
{
  const dflt = buildI2vShots({ shots: SHOTS, keyByPath: KEY_MAP, summaryByPath: summary })   // 未传 enabled
  const all = buildI2vShots({ shots: SHOTS, keyByPath: KEY_MAP, summaryByPath: summary, enabled: 'all' })
  eq([dflt.plan.images, dflt.plan.sec], [3, 15], '缺省 = 全部动：3 张图 / 15 秒')
  eq(dflt.points, 750, '缺省 → 让图动起来 750 点（= 15 秒 × 50）')
  eq(dflt.points, all.points, '缺省报价 = 显式 all 报价（同一份结果）')
  eq(dflt.plan.sec, all.plan.sec, '缺省 sec = 显式 all sec（同源）')
  eq(vfTotalCostPoints(CHAR_N, dflt.plan.sec), 765, '缺省总价 = 15(素材费) + 750 = 765 点')
  eq(dflt.plan.skippedUnfit, 0, '缺省 = 全部动 → 跳过数 = 0')
  ok(dflt.notes.some((n) => n.includes('全部动起来')), 'notes 说明「全部动起来」（默认）')
}

console.log('\n② 智能筛显式选中 → 报价下调；off = 0 点（前后对比）')
{
  const smart = buildI2vShots({ shots: SHOTS, keyByPath: KEY_MAP, summaryByPath: summary, enabled: 'on' })
  eq([smart.plan.images, smart.plan.sec], [0, 0], '三张都是界面/海报/纯文字 → 智能筛全跳过（0 张 / 0 秒）')
  eq(smart.points, 0, '智能筛 → 让图动起来 0 点')
  eq(smart.plan.skippedUnfit, 3, '智能筛 → 跳过 3 张（如实记账）')
  const off = buildI2vShots({ shots: SHOTS, keyByPath: KEY_MAP, summaryByPath: summary, enabled: 'off' })
  eq([off.points, off.args], [0, {}], "'off' → 0 点且不注入首帧（args 为空对象）")

  // 前后两个数（用户要能一眼看出差别）：以前默认 smart=0 点，现在默认 all=750 点
  console.log(`     · 旧默认（智能筛）报价：${vfTotalCostPoints(CHAR_N, smart.plan.sec)} 点（动 ${smart.plan.images} 张）`)
  console.log(`     · 新默认（全部动）报价：${vfTotalCostPoints(CHAR_N, dfltSec())} 点（动 3 张）`)
  ok(vfTotalCostPoints(CHAR_N, dfltSec()) > vfTotalCostPoints(CHAR_N, smart.plan.sec),
    '新默认报价 > 旧默认报价（回到"以前那种量级"—— 用户实测 1500 点的观感）')
}
function dfltSec(): number {
  return buildI2vShots({ shots: SHOTS, keyByPath: KEY_MAP, summaryByPath: summary }).plan.sec
}

console.log('\n③ 跳过名单进入卡片：hint 一句（最多 3 个 + "等"）+ 结构化 [{name,reason}]')
{
  const smart = buildI2vShots({ shots: SHOTS, keyByPath: KEY_MAP, summaryByPath: summary, enabled: 'on' })
  const list = i2vSkippedList(smart.plan)
  eq(list.length, 3, '结构化清单 3 条')
  eq(list.map((x) => x.name), ['a.jpg', 'b.jpg', 'c.jpg'], '结构化清单带素材名')
  ok(list.every((x) => !!x.reason), '每条都带 reason（可解释）')

  const hint3 = i2vSkipHint(list.map((x) => x.name), smart.plan.skippedUnfit)
  ok(hint3.includes('跳过 3 张'), 'hint 含"跳过 3 张"')
  ok(hint3.includes('界面/截图') === false, 'hint 文案是"动了也看不出"（原因另由结构化字段给）')
  ok(hint3.includes('a.jpg') && hint3.includes('b.jpg') && hint3.includes('c.jpg'), 'hint 列出 3 个素材名')
  ok(!hint3.includes(' 等'), '正好 3 个 → 不加"等"')

  const hint4 = i2vSkipHint(['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg'], 4)
  ok(hint4.includes('跳过 4 张'), '4 张 → "跳过 4 张"')
  ok(hint4.includes(' 等'), '超过 3 个 → 加"等"')
  ok(hint4.indexOf('c.jpg') >= 0 && hint4.indexOf('d.jpg') < 0, '最多只列 3 个（第 4 个不进 hint）')

  eq(i2vSkipHint([], 0), '', '没有跳过 → 空串（调用方可直接拼接）')
  eq(i2vSkippedList(null), [], 'plan 为空 → 空清单（不抛异常）')
}

console.log('\n④ 协议串 VF_I2V_OFF 放行正反例（有草稿放行 / 无草稿仍被拦）')
{
  const proto = 'VF_I2V_OFF:' + JSON.stringify({ taskId: '' })
  ok(isStdSettingMessage(proto), '协议串被识别为"改设置"消息')
  ok(stdGatePass(proto, true), '有草稿 → 协议串放行')
  ok(!stdGatePass(proto, false), '无草稿 → 协议串仍被拦（保持命令白名单锁死）')
  ok(!isStdNoDraftAllowed(proto), '协议串不在"无草稿也放行"的名单里')

  // 对照：只读查询 / VF_EDIT 只重渲 —— 无草稿也放行（现状不变）
  ok(stdGatePass('视频做得怎么样了', false), '只读查询：无草稿也放行')
  ok(stdGatePass('VF_EDIT:{edits:[]}', false), 'VF_EDIT 只重渲：无草稿也放行')
  // 对照：普通非命令 —— 无草稿锁死
  ok(!stdGatePass('帮我写一个小红书文案', false), '普通非命令：无草稿锁死')
  ok(stdGatePass('帮我写一个小红书文案', true), '普通非命令：有草稿放行')
}

console.log('\n⑤ "改设置"关键词放行正反例 + i2vIntentOf 取值映射')
{
  for (const w of ['关掉图转视频', '关掉动图', '不要动图', '保持静态', '全部动起来', '让图动起来', '智能筛']) {
    ok(isStdSettingMessage(w), `关键词「${w}」被识别为改设置`)
    ok(stdGatePass(w, true), `关键词「${w}」：有草稿放行`)
    ok(!stdGatePass(w, false), `关键词「${w}」：无草稿仍被拦`)
  }
  ok(!isStdSettingMessage('今天天气不错'), '普通话不是改设置（反例）')
  ok(!isStdSettingMessage('关掉音乐'), '"关掉音乐"不误命中（反例：限词）')

  eq(i2vIntentOf('关掉图转视频'), 'off', '"关掉图转视频" → off')
  eq(i2vIntentOf('关掉动图'), 'off', '"关掉动图" → off')
  eq(i2vIntentOf('保持静态'), 'off', '"保持静态" → off')
  eq(i2vIntentOf('VF_I2V_OFF:{}'), 'off', '协议串 → off')
  eq(i2vIntentOf('全部动起来'), 'all', '"全部动起来" → all')
  eq(i2vIntentOf('让图动起来'), 'all', '"让图动起来" → all')
  eq(i2vIntentOf('智能筛'), 'on', '"智能筛" → on')
  eq(i2vIntentOf('今天天气不错'), null, '不是这类话 → null（反例）')
  // 顺序陷阱：off 必须**先判**（"关掉图转视频"里含"图"、"让图动起来"里含"动起来"）
  eq(i2vIntentOf('关掉图转视频'), 'off', 'off 优先于 all（顺序正确）')
}

console.log('\n⑥ VF_I2V_OFF 之后：草稿 i2v=off 且卡片金额变小（模拟两条线的处理）')
{
  // 草稿（缺省没有 i2v 字段 → 走 'all'）
  const vd: any = { shots: SHOTS, i2vKeys: KEY_MAP, i2vSuit: summary }
  const mk = (v: string) => buildI2vShots({ shots: vd.shots, keyByPath: vd.i2vKeys, summaryByPath: vd.i2vSuit, enabled: v })
  const before = mk(vd.i2v ?? 'all')                         // 用户点按钮之前
  const cardBefore = vfTotalCostPoints(CHAR_N, before.plan.sec)
  const intent = i2vIntentOf('VF_I2V_OFF:' + JSON.stringify({ taskId: '' }))
  eq(intent, 'off', '协议串解析为 off')
  vd.i2v = intent as string                                   // 服务端：把当前草稿的 i2v 置为 off
  const after = mk(vd.i2v)
  const cardAfter = vfTotalCostPoints(CHAR_N, after.plan.sec)
  eq(after.points, 0, '置 off 后：让图动起来 0 点')
  ok(cardAfter < cardBefore, `卡片金额变小（${cardBefore} → ${cardAfter}，省 ${cardBefore - cardAfter} 点）`)
  eq(cardAfter, Math.max(1, Math.ceil(CHAR_N / 20)), '关掉动图后只剩素材费（15 点）')
  // 反向：一键回到"全部动起来"
  vd.i2v = i2vIntentOf('全部动起来') as string
  const back = mk(vd.i2v)
  eq(back.points, 750, '一键回到"全部动起来" → 750 点（金额变大）')
  eq(i2vCostPoints(back.plan.sec), 750, 'i2vCostPoints 与 plan 同源')
}

console.log('\n⑦ 接线对账 + 防回退（改了忘接上 / 覆盖了定案 → 这里报出来）')
{
  const routeSrc = readFileSync(join(__dirname, '..', 'src/app/api/agent/chat/route.ts'), 'utf-8')
  const vfSrc = readFileSync(join(__dirname, '..', 'src/lib/agent/vf/vf-video.ts'), 'utf-8')
  const pageSrc = readFileSync(join(__dirname, '..', 'src/app/agent/page.tsx'), 'utf-8')
  const stdSrc = readFileSync(join(__dirname, '..', 'src/lib/agent/standard-commands.ts'), 'utf-8')
  const planSrc = readFileSync(join(__dirname, '..', 'src/lib/agent/vf/i2v-plan.ts'), 'utf-8')

  // 默认值（缺省 = all）
  ok(/enabled \?\? 'all'/.test(planSrc), "i2v-plan：缺省 enabled = 'all'")
  ok(/vd\?\.i2v \?\? 'all'/.test(vfSrc), "vf-video：草稿缺省 i2v = 'all'")
  ok(/i2v: 'all'/.test(vfSrc), "vf-video：新草稿 i2v='all'（默认全部动）")
  ok((routeSrc.match(/vd\.i2v \?\? 'all'/g) || []).length >= 3, '图片成片线三条出口缺省都是 all')
  ok(/vj\.i2v \|\| 'all'/.test(pageSrc), "前端设置卡缺省 i2v = 'all'")

  // 跳过名单进卡片
  ok(planSrc.includes('i2vSkipHint') && planSrc.includes('i2vSkippedList'), 'i2v-plan：提供 i2vSkipHint / i2vSkippedList')
  ok(routeSrc.includes('i2vSkipped: _i2vSkip, i2vSkippedN: _i2vSkipN'), 'vfScriptCard：卡片 JSON 带 i2vSkipped/i2vSkippedN')
  ok(routeSrc.includes('_i2vSkipHint ?'), 'vfScriptCard：hint 里拼上跳过名单')
  ok(vfSrc.includes('i2vSkipped: _i2vB.plan.unfitSamples'), 'vf-video：分镜卡透传跳过名单')
  ok(/i2vSkipped: _i2vB2\.plan\.unfitSamples/.test(routeSrc), '图片成片线：重排后同样透传跳过名单')

  // 新按钮协议串 + 服务端处理
  ok(pageSrc.includes("sendMessage('VF_I2V_OFF:' + JSON.stringify("), '前端：分镜卡「关掉动图重出」发 VF_I2V_OFF 协议串')
  ok(routeSrc.includes('VF_I2V_OFF'), 'route.ts：vfProtoWord 认 VF_I2V_OFF')
  ok(/\bi2vIntentOf\(userMessage\)/.test(routeSrc), 'route.ts：处理 i2vIntentOf（改设置 → 重出卡）')
  ok(/\bi2vIntentOf\(String\(userMessage\)\)/.test(vfSrc), 'vf-video：处理 i2vIntentOf（改设置 → 重出卡）')

  // 闸门
  ok(stdSrc.includes('STD_SETTING_RE') && stdSrc.includes('isStdSettingMessage'), 'standard-commands：STD_SETTING_RE / isStdSettingMessage')
  ok(stdSrc.includes('export function stdGatePass'), 'standard-commands：stdGatePass（可单测的闸门判定）')
  ok(stdSrc.includes('export function i2vIntentOf'), 'standard-commands：i2vIntentOf（与闸门共用规则）')
  ok(/stdGatePass\(userMessage, await stdHasAnyDraft/.test(routeSrc), 'route.ts：闸门改用 stdGatePass')
  ok(/stdSettingWord/.test(routeSrc), 'route.ts：stdSettingWord 进入 skipModelStep1（确定性进状态机）')

  // 防回退：不得把默认改回 'on'
  ok(!/String\(o\?\.enabled \?\? 'on'\)/.test(planSrc), "防回退：i2v-plan 不再把缺省写成 'on'")
  ok(!/i2v: 'on',/.test(vfSrc), "防回退：vf-video 草稿不再默认 'on'")
}

console.log(`\n===== 自测结果：${pass} 项通过，${fail} 项失败 =====\n`)
process.exit(fail ? 1 : 0)
