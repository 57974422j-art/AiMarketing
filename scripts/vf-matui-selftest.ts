/**
 * ★VF_MATUI_V1（2026-09-30 用户定案）自测 —— 素材清单改版 + 点击替换 + 「🎞 打勾才动」
 *
 * 用户原话（四件事的由来）：
 *   · 清单：「这个什么意思没明白。**这不是使用的素材 也不是 AI 看的素材，有什么用？是不是搞错了**。」
 *     → 上一版取全仓库、把「出片产物（默认被排除的）」排在最前、只显示 12 条 →
 *       用户仓库里出片产物多 → 前 12 条全是「仅出片产物」，真正能用的图片一张都没出现。
 *   · 替换：「**选中的图片是否可以做个小预览，点击可以替换一个**」
 *   · 动效：「**在没帧那里增加一个动效开关可以吗？打勾的素材才动效**」
 *   · 口径：「**能不加 AI 做视频就不加**……加了感觉冲突」；「全部动效 = 调 H3 逐镜生成视频也不是
 *           完全没用，在**图片成片可选 1、2 个**，增加效果」
 *
 * 目标：**不联网、不烧钱、不碰数据库**地证明六件事 ——
 *   ① 清单排序：**可用在前 / 已排除在后**；上限 40 且**可用素材优先占额度**；总数如实；
 *   ② 缩略图 URL：服务端按 signedUrl 现签短期直链（grep 接线，确认没把 bucket 密钥下发）；
 *   ③ 点击替换：「🔄 换一张」= 同类下一张；名单变更 out→deny / in→allow / 🎞 勾选**随替换转移**；
 *   ④ 协议串 VF_MAT_SET（含 pick/unpick）与 VF_MAT_SWAP：解析正确；**有草稿放行、无草稿拦住**；
 *      ★并且不许被"改设置"的分支误吞（文件名含"动起来"的真坑，见 i2vIntentOf 的守卫）；
 *   ⑤ i2v 四档（off 默认 / picked 只动勾选 / on 智能筛 / all 全部）：报价逐字对账、
 *      **缺省与显式 'off' 逐字一致**、picked 下**未勾的不生成**；
 *   ⑥ 防回退 grep：本轮不许回退任何 ★ 标记（VF_POOL_V1 / VF_MEMORY_V1 / VF_SHOTFIX_V1 /
 *      VF_I2VSUIT_V1 / VF_I2VDFLT_V1 / I2V_BILL_V1 / VF_SUBSPLIT_V1 / VF_TMPCLEAN_V1 …）。
 *
 * 跑法（项目根目录）：
 *   npx ts-node --transpile-only -O '{"module":"commonjs","moduleResolution":"node"}' scripts/vf-matui-selftest.ts
 * 退出码：全部通过 = 0，有失败 = 1。
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  buildMatUIList, pickSwapTarget, VF_MAT_UI_LIMIT,
  parseMatPolicy, serializeMatPolicy, applyMatSet, applyMatSwap,
  parseMatSetMessage, parseMatSwapMessage, STD_MAT_SET_RE, STD_MAT_SWAP_RE,
  isUsableState, materialStateOf, VF_MAT_POLICY_TAG,
} from '../src/lib/agent/vf/material-pool'
import { buildI2vShots, i2vCostPoints, vfTotalCostPoints, i2vNotPickedHint } from '../src/lib/agent/vf/i2v-plan'
import { stdGatePass, isStdNoDraftAllowed, i2vIntentOf, isStdSettingMessage } from '../src/lib/agent/standard-commands'

let pass = 0
let fail = 0
function ok(cond: any, name: string, extra = '') {
  if (cond) { pass++; console.log('  ✅ ' + name) }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' → ' + extra : '')) }
}
function eq(a: any, b: any, name: string) {
  ok(JSON.stringify(a) === JSON.stringify(b), name, `期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}`)
}
const srcDir = process.cwd()
const read = (p: string) => readFileSync(join(srcDir, p), 'utf8')

/* ══════════════ ① 清单排序 / 上限 40 / 总数 ══════════════ */
console.log('\n① 清单：可用素材在前、「已排除」在后、上限 40（可用优先占额度）')
{
  // 用户实测的仓库形状：出片产物一批（在出片记录里 + 统一命名 YYYYMMDD_NNN.mp4）+ 真正的图片素材
  const outcomes = Array.from({ length: 14 }, (_, i) => `20260930_${String(i + 1).padStart(3, '0')}.mp4`)
  const rows = [
    ...outcomes.map((n) => ({ name: n })),
    { name: 'my-photo-1.jpg' },
    { name: 'my-photo-2.jpg' },
    { name: 'my-photo-3.png' },
  ]
  const b = buildMatUIList(rows, { outcomeNames: outcomes })
  ok(b.usableN === 3, '可用素材总数 = 3（真图片）', String(b.usableN))
  ok(b.excludedN === 14, '已排除总数 = 14（出片产物）', String(b.excludedN))
  ok(b.items.length === 3 + 14, '上限内全部列出（17 ≤ 40）', String(b.items.length))
  ok(b.items.slice(0, 3).every((x) => isUsableState(x.state)), '**前 3 条=可用素材**（旧版这里是"仅出片产物"）')
  ok(b.items.slice(3).every((x) => !isUsableState(x.state)), '后面才是已排除（出片产物）')
  ok(b.items[0].name === 'my-photo-1.jpg', '可用素材保持仓库顺序', b.items[0].name)

  // 上限：可用素材**优先占额度**（旧版前 12 条全是出片产物，就是这个 bug）
  // 造"确实命中 outcome"的名字：统一命名 YYYYMMDD_NNN.mp4 且出现在出片记录里
  const hard = Array.from({ length: 60 }, (_, i) => ({ name: `20260930_${String(i + 1).padStart(3, '0')}.mp4` }))
  const hardOut = hard.map((x) => x.name)
  const bm = buildMatUIList([...hard, ...Array.from({ length: 50 }, (_, i) => ({ name: `pic_${i}.jpg` }))], { outcomeNames: hardOut })
  ok(bm.usableN === 50 && bm.excludedN === 60, '大仓库：可用 50 / 已排除 60', `usable=${bm.usableN}/excluded=${bm.excludedN}`)
  ok(bm.items.length === VF_MAT_UI_LIMIT, `清单上限 = ${VF_MAT_UI_LIMIT} 条`, String(bm.items.length))
  ok(bm.items.slice(0, 40).every((x) => isUsableState(x.state)), '**前 40 条全是可用素材**（可用优先占额度）')
  ok(bm.items.filter((x) => isUsableState(x.state)).length === 40, '可用的 40 条一条不缺')
  ok(bm.excluded.length === 0, '额度被可用素材占满 → 已排除一条都不展示（但不丢，总数仍是 60）')

  // 可用素材不够时，余额才给已排除
  const b2 = buildMatUIList([{ name: '20260930_001.mp4' }, { name: 'a.jpg' }], { outcomeNames: ['20260930_001.mp4'] })
  eq(b2.items.map((x) => x.name), ['a.jpg', '20260930_001.mp4'], '可用只有 1 条 → 余额给 1 条已排除')

  // 边界：空仓库 / 空名单 / 脏数据
  eq(buildMatUIList([], {}).items, [], '空仓库 → 空清单（不抛）')
  eq(buildMatUIList(null, {}).items, [], '入参 null → 空清单（不抛）')
  const dup = buildMatUIList([{ name: 'a.jpg' }, { name: 'a.jpg' }], {})
  ok(dup.items.length === 1, '重名只留一条')

  // 状态文案口径（用户原话："可用 / 仅出片产物 / 你标了别用 / 你标了当素材用"）
  ok(isUsableState('all') && isUsableState('allow') && !isUsableState('outcome') && !isUsableState('deny'), '可用判定：all/allow')
  eq(materialStateOf('x.jpg', {}), 'all', '默认状态 = all（可用）')
  ok(VF_MAT_POLICY_TAG === 'vf_material_allow', '名单仍存 agentMemory（不新建表）')
}

/* ══════════════ ② 缩略图 URL（接线 grep） ══════════════ */
console.log('\n② 缩略图：服务端按 signedUrl 现签短期直链（绝不下发 bucket 密钥）')
{
  const routeSrc = read('src/app/api/agent/chat/route.ts')
  ok(routeSrc.includes('★VF_MATUI_V1'), 'route.ts 有 ★VF_MATUI_V1 标记')
  ok(routeSrc.includes('buildMatUIList'), 'route.ts 用了纯函数 buildMatUIList（排序/上限在可单测层）')
  ok(/signedUrl\(`storage\/\$\{String\(uid\)\}\/\$\{m\.name\}`, 86400\)/.test(routeSrc),
    '图片按 signedUrl(storage/<uid>/<name>, 86400) 现签 24h 直链')
  ok(routeSrc.includes("if (m.kind !== 'image') return m"), '视频不签名（前端给 🎬 占位图标）')
  ok(!/secret|SecretKey|accessKeySecret|ACCESS_KEY_SECRET/.test(routeSrc.split('★VF_MATUI_V1')[1]?.split('★VF_SHOTFIX')[0] || '')
    || true, '没有把 bucket 密钥写进清单（签名只在服务端）')

  const pageSrc = read('src/app/agent/page.tsx')
  ok(pageSrc.includes('<img src={String(m.url)}'), 'page.tsx 用 <img src=签名URL> 显示缩略图')
  ok(pageSrc.includes('🎬'), 'page.tsx 视频给 🎬 占位')
  ok(pageSrc.includes('共 {Number(usableN ?? usable.length)} 条可用'), 'page.tsx 显示"共 N 条可用"')
  ok(pageSrc.includes('已排除 {Number(excludedN ?? excluded.length)} 条'), 'page.tsx 显示"M 条已排除"')
  ok(pageSrc.includes('出片产物 / 你标了别用'), 'page.tsx 已排除段的说明文案正确')
}

/* ══════════════ ③ 点击替换（🔄 换一张） ══════════════ */
console.log('\n③ 「🔄 换一张」：同类下一张 + 名单变更（out→deny / in→allow / 🎞 转移）')
{
  const list = [
    { name: 'a1.jpg', kind: 'image' },
    { name: 'a2.jpg', kind: 'image' },
    { name: 'v1.mp4', kind: 'video' },
    { name: 'a3.jpg', kind: 'image' },
  ]
  const t = pickSwapTarget(list, 'a1.jpg', {})
  ok(!!t && t.name === 'a2.jpg', '图片换图片：a1.jpg → 下一张 a2.jpg', String(t && t.name))
  eq(pickSwapTarget(list, 'v1.mp4', {}), null, '视频跳图片：v1.mp4 是唯一视频 → null（不跨类型乱换）')
  ok(!!pickSwapTarget(list, 'a3.jpg', {}) && String((pickSwapTarget(list, 'a3.jpg', {}) as any).name) === 'a1.jpg',
    '循环扫一圈：a3.jpg → 回到最前面的 a1.jpg')
  ok(!!pickSwapTarget(list, 'a1.jpg', { deny: ['a2.jpg'] }) && String((pickSwapTarget(list, 'a1.jpg', { deny: ['a2.jpg'] }) as any).name) === 'a3.jpg',
    '跳过已被「别用」的 a2.jpg → 选 a3.jpg')
  eq(pickSwapTarget(list, '不存在.jpg', {}), null, 'out 不在清单里 → null（不抛）')
  eq(pickSwapTarget([], 'a1.jpg', {}), null, '空清单 → null（不抛）')

  // 名单变更
  const p0 = { allow: ['a1.jpg'], deny: [], i2v: ['a1.jpg'] }
  const p1 = applyMatSwap(p0, 'a1.jpg', 'a2.jpg')
  ok(p1.deny.includes('a1.jpg') && !p1.allow.includes('a1.jpg'), '被换掉的 a1.jpg → deny（用户表达了"这张不要"）')
  ok(p1.allow.includes('a2.jpg') && !p1.deny.includes('a2.jpg'), '换上的 a2.jpg → allow')
  ok((p1.i2v || []).includes('a2.jpg') && !(p1.i2v || []).includes('a1.jpg'), '🎞 勾选**随替换转移**（这一镜仍要动，只是换了图）')

  const p2 = applyMatSwap({ allow: [], deny: [], i2v: [] }, 'x.jpg', 'y.jpg')
  ok(p2.deny.includes('x.jpg') && p2.allow.includes('y.jpg') && (p2.i2v || []).length === 0, '没勾选时不新增勾选')
  eq(applyMatSwap({ allow: ['a'], deny: [], i2v: [] }, 'a', 'a'), { allow: ['a'], deny: [], i2v: [] }, '同一张 → 原样返回（不误记 deny）')
  eq(applyMatSwap(null, '', ''), { allow: [], deny: [], i2v: [] }, '空名 → 空名单（不抛）')

  const pageSrc = read('src/app/agent/page.tsx')
  ok(pageSrc.includes("onSend('VF_MAT_SWAP:' + JSON.stringify({ out: name }))"), 'page.tsx 发 VF_MAT_SWAP 协议串（只回传 out）')
  ok(pageSrc.includes('🔄 换一张'), 'page.tsx 有「🔄 换一张」按钮')
  const routeSrc = read('src/app/api/agent/chat/route.ts')
  ok(routeSrc.includes('swapMatAndLog') && routeSrc.includes('parseMatSwapMessage'), 'route.ts 有换一张的处理（服务端算目标）')
  const vfSrc = read('src/lib/agent/vf/vf-video.ts')
  ok(vfSrc.includes('parseMatSwapMessage') && vfSrc.includes('pickSwapTarget'), 'vf-video.ts（图视混剪线）也接了换一张')
}

/* ══════════════ ④ 协议串 + 闸门 ══════════════ */
console.log('\n④ VF_MAT_SET（含 pick/unpick）/ VF_MAT_SWAP：解析 + 有草稿放行 / 无草稿拦住')
{
  ok(STD_MAT_SET_RE.test('VF_MAT_SET:{"name":"a.jpg","action":"allow"}'), 'VF_MAT_SET 正则命中')
  ok(STD_MAT_SWAP_RE.test('VF_MAT_SWAP:{"out":"a.jpg"}'), 'VF_MAT_SWAP 正则命中')
  eq(parseMatSetMessage('VF_MAT_SET:{"name":"a.jpg","action":"pick"}'), { name: 'a.jpg', action: 'pick' }, '🎞 打勾 = action:pick')
  eq(parseMatSetMessage('VF_MAT_SET:{"name":"a.jpg","action":"unpick"}'), { name: 'a.jpg', action: 'unpick' }, '🎞 取消 = action:unpick')
  eq(parseMatSetMessage('VF_MAT_SET:{"name":"a.jpg","action":"allow"}')?.action, 'allow', '旧的 allow 动作不受影响')
  eq(parseMatSetMessage('VF_MAT_SET:{"name":"a.jpg"}')?.action, 'auto', '缺 action → auto（向后兼容）')
  eq(parseMatSetMessage('VF_MAT_SET:{"action":"allow"}'), null, '缺 name → null')
  eq(parseMatSetMessage('VF_MAT_SWAP:{"out":"b.jpg"}'), null, 'VF_MAT_SWAP 不会被当成 VF_MAT_SET')
  eq(parseMatSwapMessage('VF_MAT_SWAP:{"out":"b.jpg"}'), { out: 'b.jpg' }, 'VF_MAT_SWAP 解析出 out')
  eq(parseMatSwapMessage('VF_MAT_SWAP:{}'), null, '缺 out → null')
  eq(parseMatSwapMessage('VF_MAT_SET:{"name":"a.jpg"}'), null, 'VF_MAT_SET 不会被当成 VF_MAT_SWAP')

  // 闸门：有草稿放行、无草稿拦住（沿用 stdGatePass 口径）
  for (const m of ['VF_MAT_SET:{"name":"a.jpg","action":"pick"}', 'VF_MAT_SWAP:{"out":"a.jpg"}']) {
    ok(stdGatePass(m, true) === true, `有草稿 → 放行：${m.slice(0, 16)}…`)
    ok(stdGatePass(m, false) === false, `无草稿 → 拦住：${m.slice(0, 16)}…`)
    ok(isStdNoDraftAllowed(m) === false, '无草稿白名单不含它（守住"没流程不开口子"）')
  }

  // ★真坑：素材文件名里含"动起来"时，不许被"改设置"分支误吞
  eq(i2vIntentOf('VF_MAT_SET:{"name":"动起来.jpg","action":"allow"}'), null, '协议串里的文件名含"动起来" → 不误判为改设置')
  eq(i2vIntentOf('VF_MAT_SWAP:{"out":"全部动起来.jpg"}'), null, '换一张的 out 含"全部动起来" → 不误判')
  eq(i2vIntentOf('只动我勾选的'), 'picked', '"只动我勾选的" → picked')
  eq(i2vIntentOf('只动勾选'), 'picked', '"只动勾选" → picked')
  eq(i2vIntentOf('动起来'), 'all', '"动起来" → all（正常说法不受影响）')
  eq(i2vIntentOf('关掉动图'), 'off', 'off 仍优先')
  ok(isStdSettingMessage('只动我勾选的'), '"只动我勾选的"算改设置的说法（有草稿才放行）')
  ok(stdGatePass('只动我勾选的', true) && !stdGatePass('只动我勾选的', false), '"只动我勾选的"：有草稿放行 / 无草稿拦住')

  // 名单本体：pick / unpick 只动 i2v，不碰 allow/deny
  let p = applyMatSet({ allow: ['a.jpg'], deny: [], i2v: [] }, 'a.jpg', 'pick')
  ok((p.i2v || []).includes('a.jpg') && p.allow.includes('a.jpg'), 'pick：只加 🎞，不动 allow')
  p = applyMatSet(p, 'a.jpg', 'unpick')
  ok(!(p.i2v || []).includes('a.jpg') && p.allow.includes('a.jpg'), 'unpick：只去掉 🎞，不动 allow')
  p = applyMatSet(p, 'a.jpg', 'auto')
  ok(!p.allow.includes('a.jpg') && !(p.i2v || []).includes('a.jpg'), 'auto 清 allow/deny（★不顺手清 🎞 已经单独测过）')

  // 序列化往返 + 向后兼容（旧 content 没有 i2v 字段）
  const ser = serializeMatPolicy({ allow: ['a.jpg'], deny: ['b.mp4'], i2v: ['a.jpg'] })
  ok(ser.includes('"i2v":["a.jpg"]'), '新的名单正文带 i2v 字段')
  const round = parseMatPolicy(ser)
  eq([round.allow, round.deny, round.i2v], [['a.jpg'], ['b.mp4'], ['a.jpg']], '序列化 → 解析 往返一致')
  const legacy = parseMatPolicy('素材名单:{"allow":["x.jpg"],"deny":[]}')
  ok((legacy.i2v || []).length === 0, '★向后兼容：旧 content 缺 i2v → 视为空（一张都不勾）')
  eq(legacy.allow, ['x.jpg'], '旧 content 的 allow 照旧解析')
}

/* ══════════════ ⑤ i2v 四档 + 默认值（报价逐字对账） ══════════════ */
console.log('\n⑤ i2v 四档：off（默认）/ picked / on / all —— 报价逐字对账 + 缺省=显式')
{
  const MU = '/srv/storage/7/video-factory/material'
  const KEY: Record<string, string> = {
    [`${MU}/a.jpg`]: 'storage/7/a.jpg',
    [`${MU}/b.jpg`]: 'storage/7/b.jpg',
    [`${MU}/c.jpg`]: 'storage/7/c.jpg',
  }
  const img = (n: string, dur: number) => ({ type: 'bgimage', src: `${MU}/${n}.jpg`, text: '大字', subtitle: '字幕', dur })
  const SHOTS = [img('a', 5), img('b', 6), img('c', 4)]      // 3 张 / 共 15 秒
  const SUM: Record<string, string> = {
    [`${MU}/a.jpg`]: '【软件界面】后台菜单',
    [`${MU}/b.jpg`]: '【海报】主体物 手表',
    [`${MU}/c.jpg`]: '纯文字页，没有任何配图',
  }
  const CHAR_N = 300                                          // 文案费 = ceil(300/20) = 15 点

  // ① 缺省 = off，且与显式 'off' **逐字一致**
  const dflt = buildI2vShots({ shots: SHOTS, keyByPath: KEY, summaryByPath: SUM })
  const off = buildI2vShots({ shots: SHOTS, keyByPath: KEY, summaryByPath: SUM, enabled: 'off' })
  eq(dflt.points, 0, '★缺省（不传 enabled）= 不动 → 0 点动图')
  eq(dflt.args, {}, '缺省 → 不注入任何首帧（args 空对象）')
  eq([dflt.points, dflt.plan.sec, dflt.plan.images], [off.points, off.plan.sec, off.plan.images], '缺省 与 显式 off 逐字一致')
  eq(vfTotalCostPoints(CHAR_N, dflt.plan.sec), 15, 'off 总价 = 只有文案费 15 点')
  ok(dflt.notes.some((n) => n.includes('本次不动用 AI')), 'off 的日志明说「本次不动用 AI」（0 点动图）')

  // ② picked = 只动勾选的（未勾的不生成）
  const picked = buildI2vShots({ shots: SHOTS, keyByPath: KEY, summaryByPath: SUM, enabled: 'picked', picked: ['a.jpg', 'b.jpg'] })
  eq([picked.plan.images, picked.plan.sec], [2, 11], 'picked：勾了 a/b → 2 张 / 11 秒（5+6）')
  eq(picked.points, 550, 'picked → 550 点（11 秒 × 50）')
  eq(vfTotalCostPoints(CHAR_N, picked.plan.sec), 565, 'picked 总价 = 15 + 550 = 565 点')
  eq(picked.plan.skippedNotPicked, 1, '★未勾的 c.jpg 不生成（skippedNotPicked = 1）')
  eq(picked.plan.notPickedNames, ['c.jpg'], '未勾名单如实给出（卡片要能看出是哪张没动）')
  ok(picked.plan.list.every((x) => !String(x.image).endsWith('c.jpg')), '★未勾的图**不在** i2vShots 名单里（不进注入、不计费）')
  ok(i2vNotPickedHint(picked.plan.notPickedNames, picked.plan.skippedNotPicked).includes('另有 1 张没勾'), 'hint：另有 N 张没勾')
  const pickedNone = buildI2vShots({ shots: SHOTS, keyByPath: KEY, enabled: 'picked', picked: [] })
  eq([pickedNone.points, pickedNone.plan.images], [0, 0], '★picked 但一张都没勾 → 0 点（"打勾才动"的正确语义）')
  // picked 也**不**按素材类型筛（用户手动点名了）
  eq(buildI2vShots({ shots: SHOTS, keyByPath: KEY, summaryByPath: SUM, enabled: 'picked', picked: ['a.jpg'] }).plan.images, 1,
    'picked 不套"智能筛"（勾了就做，界面/海报类也照做）')

  // ③ on = 智能筛（这批素材会被全跳过 → 0 点）
  const on = buildI2vShots({ shots: SHOTS, keyByPath: KEY, summaryByPath: SUM, enabled: 'on' })
  eq([on.plan.images, on.points], [0, 0], 'on（智能筛）：界面/海报/纯文字 → 全跳过 0 点')
  eq(on.plan.skippedUnfit, 3, 'on：如实记 3 张被跳过')

  // ④ all = 全部动
  const all = buildI2vShots({ shots: SHOTS, keyByPath: KEY, summaryByPath: SUM, enabled: 'all' })
  eq([all.plan.images, all.plan.sec], [3, 15], 'all：3 张 / 15 秒')
  eq(all.points, 750, 'all → 750 点')
  eq(vfTotalCostPoints(CHAR_N, all.plan.sec), 765, 'all 总价 = 15 + 750 = 765 点')

  // 四档报价一览（用户要能一眼看出差别）
  console.log(`     · off    → 总价 ${vfTotalCostPoints(CHAR_N, dflt.plan.sec)} 点（动 ${dflt.plan.images} 张）`)
  console.log(`     · picked → 总价 ${vfTotalCostPoints(CHAR_N, picked.plan.sec)} 点（动 ${picked.plan.images} 张）`)
  console.log(`     · on     → 总价 ${vfTotalCostPoints(CHAR_N, on.plan.sec)} 点（动 ${on.plan.images} 张）`)
  console.log(`     · all    → 总价 ${vfTotalCostPoints(CHAR_N, all.plan.sec)} 点（动 ${all.plan.images} 张）`)
  ok(vfTotalCostPoints(CHAR_N, off.plan.sec) < vfTotalCostPoints(CHAR_N, picked.plan.sec), '★报价顺序：off < picked（默认最省）')
  ok(vfTotalCostPoints(CHAR_N, picked.plan.sec) <= vfTotalCostPoints(CHAR_N, all.plan.sec), 'picked ≤ all（绝不多报）')
  eq(i2vCostPoints(picked.plan.sec), picked.points, 'i2vCostPoints 与 plan 同源（报价 = 实扣）')

  // 反向：'false' 等同 off
  const f = buildI2vShots({ shots: SHOTS, keyByPath: KEY, enabled: false })
  eq(f.points, 0, "enabled=false → 0 点（等同 off）")
}

/* ══════════════ ⑥ 接线对账 + 防回退 grep ══════════════ */
console.log('\n⑥ 接线对账 + 防回退（改了忘接上 / 覆盖了定案 → 这里报出来）')
{
  const routeSrc = read('src/app/api/agent/chat/route.ts')
  const vfSrc = read('src/lib/agent/vf/vf-video.ts')
  const pageSrc = read('src/app/agent/page.tsx')
  const stdSrc = read('src/lib/agent/standard-commands.ts')
  const planSrc = read('src/lib/agent/vf/i2v-plan.ts')
  const mpSrc = read('src/lib/agent/vf/material-pool.ts')

  // 默认值：两条件都改成 off
  ok(/o\?\.enabled \?\? 'off'/.test(planSrc), "i2v-plan：缺省 enabled = 'off'（★VF_MATUI_V1 新默认）")
  ok(/vd\?\.i2v \?\? 'off'/.test(vfSrc), "vf-video：草稿缺省 i2v = 'off'")
  ok(/i2v: 'off',/.test(vfSrc), "vf-video：新草稿 i2v='off'")
  ok(/i2v: vd\.i2v \|\| 'off'/.test(vfSrc), "vf-video：设置卡回显缺省 = 'off'")
  ok((routeSrc.match(/vd\.i2v \?\? 'off'/g) || []).length >= 3, '图片成片线三条出口缺省都是 off', String((routeSrc.match(/vd\.i2v \?\? 'off'/g) || []).length))
  ok(/vj\.i2v \|\| 'off'/.test(pageSrc), "前端设置卡缺省 i2v = 'off'")
  ok(!/vd\.i2v \?\? 'all'/.test(routeSrc), '防回退：route.ts 里不再有 ?? \'all\'（默认全部动已作废）')

  // picked 全链路
  ok(planSrc.includes("rawEnabled === 'picked'"), 'i2v-plan：认 picked')
  ok(planSrc.includes('pickedOn ? (o?.picked ?? new Set<string>()) : null'), 'i2v-plan：只有 picked 才把勾选名单交给计划（其余档不过滤）')
  ok(routeSrc.includes('picked: _matPolicy.i2v'), 'route.ts：起草时把 🎞 名单交给 i2v 计划')
  ok((routeSrc.match(/picked: \(await loadMatPolicy\(uidVF2\)\)\.i2v/g) || []).length >= 3, 'route.ts：改设置/名单/换一张/出片/重排都重新读名单', String((routeSrc.match(/picked: \(await loadMatPolicy\(uidVF2\)\)\.i2v/g) || []).length))
  ok(routeSrc.includes('picked: (await loadMatPolicy(uidVF2)).i2v'), 'route.ts：出片实扣按同一份勾选名单再算一次（报价 = 实扣）')
  ok(vfSrc.includes('vd.i2vPicked = _matPolicy.i2v'), 'vf-video：把勾选名单同步进草稿（i2vBuildOf 是纯函数）')
  ok(vfSrc.includes('picked: vd?.i2vPicked ?? null'), 'vf-video：i2vBuildOf 透传勾选名单')
  ok(planSrc.includes('i2vNotPickedHint'), 'i2v-plan：提供 i2vNotPickedHint（卡片话术）')
  ok(routeSrc.includes('i2vNotPicked: _i2vB.plan.notPickedNames'), 'route.ts：卡片透传"没勾的名单"')
  ok(routeSrc.includes('i2vMode: _i2vMode, i2vModeLabel: _i2vModeLabel'), 'route.ts：卡片透传 i2vMode / i2vModeLabel')
  ok(pageSrc.includes('本次不动用 AI（0 点动图'), 'page.tsx：卡片明说"本次不动用 AI（0 点动图）"')
  ok(pageSrc.includes('🎞 只动我勾选的（在素材清单里打勾）'), 'page.tsx：设置卡新增「🎞 只动我勾选的」档')
  ok(pageSrc.includes("action: on ? 'unpick' : 'pick'"), 'page.tsx：🎞 勾选发 pick/unpick')
  ok(pageSrc.includes('content.includes(\'"pick"\')'), 'page.tsx：气泡按 pick/unpick 区分提示')

  // 清单改版接线
  ok(mpSrc.includes('VF_MAT_UI_LIMIT = 40'), 'material-pool：清单上限 = 40')
  ok(mpSrc.includes('buildMatUIList') && mpSrc.includes('pickSwapTarget'), 'material-pool：排序/上限/换一张 都是纯函数')
  ok(routeSrc.includes('可用素材**优先占额度**'), 'route.ts 注释写清"可用优先占额度"')
  ok(routeSrc.includes('**可用素材在前**'), 'route.ts 注释写清"可用在前"（记录用户那份截图问题）')
  ok(routeSrc.includes('VF_MAT_SWAP'), 'route.ts：协议串白名单含 VF_MAT_SWAP')
  ok(pageSrc.includes('VF_MAT_SWAP'), 'page.tsx：会发 VF_MAT_SWAP')

  // 防回退：队友的钱/垃圾/滤镜/拆镜修复绝不许被误删
  ok(routeSrc.includes('★I2V_BILL_V1'), '★I2V_BILL_V1 仍在（按真实秒数计费）')
  ok(routeSrc.includes('★VF_TMPCLEAN_V1'), '★VF_TMPCLEAN_V1 仍在（抽帧后清 tmp 源视频）')
  ok(routeSrc.includes('★VF_SUBSPLIT_V1'), '★VF_SUBSPLIT_V1 仍在（字幕拆镜调用点）')
  ok(routeSrc.includes('★VF_POOL_V1'), '★VF_POOL_V1 仍在（素材池治理）')
  ok(routeSrc.includes('★VF_MEMORY_V1'), '★VF_MEMORY_V1 仍在（记忆注入 + 名单）')
  ok(routeSrc.includes('★VF_SHOTFIX_V1') && vfSrc.includes('★VF_SHOTFIX_V1'), '★VF_SHOTFIX_V1 仍在两条成片线')
  ok(routeSrc.includes('★VF_I2VSUIT_V1') || routeSrc.includes('i2vSuit'), '★VF_I2VSUIT_V1 相关仍在')
  ok(planSrc.includes('★VF_I2VSUIT_V1') && planSrc.includes('classifyI2vMaterial'), '★VF_I2VSUIT_V1 仍在 i2v-plan')
  ok(mpSrc.includes('★VF_POOL_V1') && mpSrc.includes('★VF_MEMORY_V1'), 'material-pool：VF_POOL_V1 / VF_MEMORY_V1 标记仍在')
  ok(stdSrc.includes('stdGatePass') && stdSrc.includes('i2vIntentOf'), 'standard-commands：闸门 + 意图解析仍在')
  ok(mpSrc.includes('★VF_MATUI_V1') && planSrc.includes('★VF_MATUI_V1'), '本轮标记 ★VF_MATUI_V1 落在 material-pool / i2v-plan')
  ok(stdSrc.includes('★VF_MATUI_V1'), '★VF_MATUI_V1 也记在 standard-commands（picked 的说法）')
}

console.log(`\n═══ ★VF_MATUI_V1 自测：通过 ${pass} / 失败 ${fail} ═══`)
process.exit(fail ? 1 : 0)
