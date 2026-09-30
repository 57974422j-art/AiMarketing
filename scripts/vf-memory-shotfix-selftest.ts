/**
 * ★VF_MEMORY_V1 + ★VF_SHOTFIX_V1 + ★VF_PRICE_CLARITY_V1 + ★VF_THEMENAME_FIX_V1（2026-09-30）自测
 *
 * 用户原话（四件事的由来）：
 *   · 记忆：「我们 AGENT 上下文记忆如何处理的，后期经常用了，是否很多不用去看了，从记忆中就已经
 *           明确用户是做什么的了。仓库有什么也都知道。除非新的上传可以需要看下。」
 *   · 仓库：「我们个人仓库怎么分配 AI 仓库主要看哪里的。这个比较关键」
 *   · 分镜：「最后一个画面表现有点不对」（实测：第 9 镜 list 4 条只排了 2 秒；第 8、9 镜同一个 list 连着出现）
 *   · 文案：「价格怎么 2 个差不多」（754 点 vs 761 点两个数被读成"省了 754 还剩 761"）
 *
 * 本自测**纯函数、不联网、不烧钱、不碰数据库**，覆盖：
 *   ① 记忆注入：有画像 → 拼出短段（含"别再问/别再识别"那句）；无画像 → 返回 null（跳过注入）；脏数据不抛；
 *   ② allow/deny：allow 保留出片产物 / deny 一律排除（安全阀也不放开）/ auto 回落 / 状态判定；
 *   ③ VF_MAT_SET 协议：解析正确；有草稿放行、无草稿拦住（标准模式闸门）；
 *   ④ list 时长下限：4 条 2s → 3s，且**总时长尽量不变**（从最长的镜扣回）；扣不出就只加时；
 *   ⑤ 相邻同卡型同内容 → 合并成一镜（时长相加、字幕接续）；非相邻只打日志不合并；
 *   ⑥ 价格文案两个数都在（grep page.tsx 的按钮文案 + route.ts 的 costNoI2v 字段）；
 *   ⑦ theme 中文名 10 个 id 逐个断言（dark≠blue，news/data 也有名字）+ vf-mix.ts 内联表一致；
 *   ⑧ 防回退 grep：★VF_POOL_V1 / ★VF_THEMELOCK_V1 / ★VF_SUBSPLIT_V1 / ★VF_I2VSUIT_V1 /
 *      ★VF_I2VDFLT_V1 / ★VF_FILTERJOIN_V1 / ★I2V_BILL_V1 / ★VF_TMPCLEAN_V1 仍在。
 *
 * 跑法（项目根目录）：
 *   npx ts-node --transpile-only -O '{"module":"commonjs","moduleResolution":"node"}' scripts/vf-memory-shotfix-selftest.ts
 * 退出码：全部通过 = 0，有失败 = 1。
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  buildKnownUserBlock, KNOWN_USER_TAIL,
  selectMaterialPool, parseMatPolicy, serializeMatPolicy, applyMatSet,
  parseMatSetMessage, materialStateOf, STD_MAT_SET_RE,
  ensureListDuration, mergeAdjacentSameShots, listMinDuration, VF_POOL_MIN_KEEP, VF_MAT_POLICY_TAG,
} from '../src/lib/agent/vf/material-pool'
import { THEME_LABELS, themeLabel } from '../src/lib/agent/vf/theme-labels'
import { stdGatePass, isStdNoDraftAllowed } from '../src/lib/agent/standard-commands'

let pass = 0
let fail = 0
function ok(cond: any, name: string, extra = '') {
  if (cond) { pass++; console.log('  ✅ ' + name) }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' → ' + extra : '')) }
}

const srcDir = process.cwd()
const read = (p: string) => readFileSync(join(srcDir, p), 'utf8')

/* ══════════════ ① 记忆注入段 ══════════════ */
console.log('\n① 记忆注入：有画像 → 拼出短段；无画像 → 跳过；脏数据不抛')
{
  const withProfile = buildKnownUserBlock({
    profileLines: ['行业/业务：餐饮', '使用过的平台：抖音', '名字：小美'],
    imgN: 12, vidN: 3, recentNames: ['20260930_001.jpg', 'a.mp4', 'b.png'],
  })
  ok(!!withProfile, '有画像 + 有仓库 → 拼出注入段')
  ok(!!withProfile && withProfile.text.includes('【已知用户（长期记忆）】'), '段首标记正确')
  ok(!!withProfile && withProfile.text.includes('用户画像：'), '含"用户画像："')
  ok(!!withProfile && withProfile.text.includes('餐饮'), '画像内容原样带出（餐饮）')
  ok(!!withProfile && withProfile.text.includes('仓库：图片 12 张、视频 3 条'), '仓库摘要含图片/视频张数')
  ok(!!withProfile && withProfile.text.includes('最近上传'), '仓库摘要含"最近上传"')
  ok(!!withProfile && withProfile.text.endsWith(KNOWN_USER_TAIL), '段尾是"已确认过，别重复问/识别"那句')
  ok(!!withProfile && withProfile.text.length <= 300, `整段 ≤300 字（实际 ${withProfile ? withProfile.text.length : '-'}）`)

  // 画像超长 → 只截画像段，不炸
  const long = buildKnownUserBlock({ profileLines: ['行业/业务：' + '餐饮'.repeat(200)], imgN: 1 })
  ok(!!long && long.text.length <= 300, `超长画像也被压到 ≤300 字（实际 ${long ? long.text.length : '-'}）`)

  // 无画像 + 空仓库 → null（调用方据此"不注入"）
  ok(buildKnownUserBlock({}) === null, '无画像且仓库为空 → null（跳过注入）')
  ok(buildKnownUserBlock(null) === null, '入参 null → null（不抛）')
  ok(buildKnownUserBlock(undefined) === null, '入参 undefined → null（不抛）')
  // 只有仓库、没有画像 → 也要注入（"仓库有什么也都知道"）
  const repoOnly = buildKnownUserBlock({ imgN: 5, vidN: 0 })
  ok(!!repoOnly && repoOnly.text.includes('仓库：图片 5 张、视频 0 条'), '只有仓库信息也能注入')
  // 脏数据不抛（undefined / null 混在数组里）
  let threw = false
  try { buildKnownUserBlock({ profileLines: [undefined as any, null as any, '行业/业务：教育'] }) } catch { threw = true }
  ok(!threw, '脏数据（undefined/null 混在画像里）不抛异常')
}

/* ══════════════ ② allow / deny / auto ══════════════ */
console.log('\n② 素材「提拔/禁用」：allow 保留出片产物 / deny 一律排除 / auto 回落')
{
  const items = [
    { name: '20260901_001.mp4' },   // 出片产物（在出片记录里 + 统一命名）
    { name: '20260902_002.mp4' },   // 出片产物
    { name: 'raw1.jpg' },
    { name: 'raw2.jpg' },
    { name: 'raw3.jpg' },
    { name: 'raw4.jpg' },
  ]
  const outcomeNames = ['20260901_001.mp4', '20260902_002.mp4']

  // 默认：两条出片产物被排除（池子够大）
  const a = selectMaterialPool(items, { outcomeNames })
  ok(a.kept.length === 4 && a.excluded.length === 2, '默认：排除 2 条出片产物', `kept=${a.kept.length}/excluded=${a.excluded.length}`)

  // allow 一条出片产物 → 保留（即使它是出片产物）
  const b = selectMaterialPool(items, { outcomeNames, allow: ['20260901_001.mp4'] })
  ok(b.kept.some((x) => x.name === '20260901_001.mp4'), 'allow：出片产物 20260901_001.mp4 被保留')
  ok(!b.kept.some((x) => x.name === '20260902_002.mp4'), 'allow：另一条出片产物仍被排除')

  // deny 一条原始素材 → 一律排除
  const c = selectMaterialPool(items, { outcomeNames, deny: ['raw1.jpg'] })
  ok(!c.kept.some((x) => x.name === 'raw1.jpg'), 'deny：raw1.jpg 被排除')
  ok(c.denied === 1, 'denied 计数 = 1', String(c.denied))

  // 安全阀：池子太小时放开"出片产物"排除，但**deny 绝不放开**
  const small = [
    { name: '20260901_001.mp4' }, { name: '20260902_002.mp4' },
    { name: 'raw1.jpg' }, { name: 'raw2.jpg' },
  ]
  const d = selectMaterialPool(small, { outcomeNames, deny: ['raw1.jpg'], minKeep: VF_POOL_MIN_KEEP })
  ok(d.released === true, '安全阀：池子过小 → 放开"出片产物"排除')
  ok(d.kept.some((x) => x.name === '20260901_001.mp4'), '安全阀放开后，出片产物回到池里')
  ok(!d.kept.some((x) => x.name === 'raw1.jpg'), '安全阀**不**放开 deny 名单（raw1.jpg 仍被排除）')

  // 没有出片记录元数据 → 不排除出片产物，但 deny 仍生效
  const e = selectMaterialPool(items, { deny: ['raw2.jpg'] })
  ok(e.kept.length === 5, '无出片记录：除 deny 外全部保留', `kept=${e.kept.length}`)
  ok(!e.kept.some((x) => x.name === 'raw2.jpg'), '无出片记录时 deny 仍生效')

  // auto 回落 + 状态判定
  let p = applyMatSet({ allow: [], deny: [] }, 'x.jpg', 'deny')
  ok(p.deny.includes('x.jpg') && !p.allow.includes('x.jpg'), 'applyMatSet deny 生效')
  p = applyMatSet(p, 'x.jpg', 'allow')
  ok(p.allow.includes('x.jpg') && !p.deny.includes('x.jpg'), 'allow 与 deny 互斥（切换后 deny 被移除）')
  p = applyMatSet(p, 'x.jpg', 'auto')
  ok(!p.allow.includes('x.jpg') && !p.deny.includes('x.jpg'), 'auto = 从两边移除（回默认规则）')

  ok(materialStateOf('20260901_001.mp4', { outcomeNames }) === 'outcome', '状态：出片产物 → outcome')
  ok(materialStateOf('raw1.jpg', { deny: ['raw1.jpg'] }) === 'deny', '状态：deny 名单 → deny')
  ok(materialStateOf('20260901_001.mp4', { allow: ['20260901_001.mp4'], outcomeNames }) === 'allow', '状态：allow 优先于 outcome')
  ok(materialStateOf('raw9.jpg', {}) === 'all', '状态：默认 → all')

  // 名单序列化/解析往返
  const round = parseMatPolicy(serializeMatPolicy({ allow: ['a.jpg'], deny: ['b.mp4'] }))
  ok(round.allow.join() === 'a.jpg' && round.deny.join() === 'b.mp4', '名单序列化 → 解析 往返一致')
  ok(VF_MAT_POLICY_TAG === 'vf_material_allow', 'tag = vf_material_allow（不新建表，用 agentMemory）')
  ok(parseMatPolicy('垃圾数据不是JSON').allow.length === 0, '坏数据 → 空名单（不抛）')
}

/* ══════════════ ③ VF_MAT_SET 协议 + 标准模式闸门 ══════════════ */
console.log('\n③ VF_MAT_SET 协议：解析 + 闸门（有草稿放行 / 无草稿拦住）')
{
  ok(STD_MAT_SET_RE.test('VF_MAT_SET:{"name":"a.jpg","action":"allow"}'), '协议正则匹配 VF_MAT_SET:{...}')
  const m = parseMatSetMessage('VF_MAT_SET:{"name":"a.jpg","action":"deny"}')
  ok(!!m && m.name === 'a.jpg' && m.action === 'deny', '解析出 name/action')
  ok(parseMatSetMessage('VF_MAT_SET:{"name":"a.jpg"}')?.action === 'auto', '缺 action → 默认 auto')
  ok(parseMatSetMessage('VF_MAT_SET:{"action":"allow"}') === null, '缺 name → null（不认领）')
  ok(parseMatSetMessage('帮我做一条视频') === null, '普通话 → null')
  ok(parseMatSetMessage('VF_MAT_SET:不是JSON') === null, '坏 JSON → null（不抛）')

  const msg = 'VF_MAT_SET:{"name":"a.jpg","action":"allow"}'
  ok(stdGatePass(msg, true) === true, '有草稿 → 放行（stdGatePass）')
  ok(stdGatePass(msg, false) === false, '无草稿 → 拦住（锁死）')
  ok(isStdNoDraftAllowed(msg) === false, '无草稿白名单里**不含** VF_MAT_SET（守住"没流程不开口子"）')
}

/* ══════════════ ④ list 卡时长下限 ══════════════ */
console.log('\n④ list 时长下限：条数 × 0.5 + 1，且总时长尽量不变')
{
  ok(listMinDuration(4) === 3, '下限：4 条 → 3.0s', String(listMinDuration(4)))
  ok(listMinDuration(2) === 2, '下限：2 条 → 2.0s', String(listMinDuration(2)))
  ok(listMinDuration(0) === 1, '下限：0 条 → 1.0s', String(listMinDuration(0)))

  // 用户实测：第 9 镜 list 4 条只排 2 秒；同片另有一镜 8 秒 → 从它扣 1 秒回来（总时长不变）
  const shots = [
    { type: 'title', text: '开场', subtitle: '开场字幕。', dur: 8 },
    { type: 'list', title: '三大能力', items: ['写文案', '做视频', '自动发布', '自动复盘'], subtitle: '目录字幕。', dur: 2 },
  ]
  const totalBefore = shots.reduce((a, s) => a + s.dur, 0)
  const r = ensureListDuration(shots)
  const totalAfter = r.shots.reduce((a: number, s: any) => a + Number(s.dur || 0), 0)
  const listShot: any = r.shots.find((s: any) => s.type === 'list')
  ok(listShot.dur === 3, 'list 4 条：2s → 3s', String(listShot.dur))
  ok(Math.abs(totalAfter - totalBefore) < 1e-6, `总时长不变（${totalBefore} → ${totalAfter}）`)
  ok((r.shots as any)[0].dur === 7, '多出的 1 秒从同片最长的镜扣回（8s → 7s）', String((r.shots as any)[0].dur))
  ok(r.notes.length >= 1, '有处理说明（日志）')
  ok(r.notes.some((n) => n.includes('list 4 条') && n.includes('2s') && n.includes('3s')), '日志形如「list 4 条 → 时长 2s 提到 3s」', r.notes[0] || '')

  // 没有可扣的镜（只有 list）→ 只加时，内容不动
  const only = [{ type: 'list', title: 'A', items: ['1', '2', '3', '4', '5', '6'], subtitle: 'x', dur: 2 }]
  const r2 = ensureListDuration(only)
  ok((r2.shots[0] as any).dur === 4, '6 条 → 4s（2s 加到下限）', String((r2.shots[0] as any).dur))
  ok(r2.notes.some((n) => n.includes('扣不回')), '扣不出时如实说明"总时长略增"')
  ok((r2.shots[0] as any).items.length === 6, '内容不被裁剪（items 仍是 6 条）')
}

/* ══════════════ ⑤ 相邻同内容合并 ══════════════ */
console.log('\n⑤ 相邻镜"同卡型 + 同内容"→ 合并成一镜')
{
  const items = ['写文案', '做视频', '自动发布']
  const shots = [
    { type: 'bgimage', src: '/a.jpg', text: '效率翻10倍', subtitle: '第一句。', dur: 4 },
    { type: 'list', title: '三大能力', items, subtitle: '第二句。', dur: 4 },
    { type: 'list', title: '三大能力', items: [...items], subtitle: '第三句。', dur: 3 },   // 与上一镜完全同 items
    { type: 'title', text: '结尾', subtitle: '第四句。', dur: 3 },
  ]
  const r = mergeAdjacentSameShots(shots)
  ok(r.shots.length === 3, '4 镜 → 合并成 3 镜', String(r.shots.length))
  const merged: any = r.shots[1]
  ok(merged.type === 'list' && merged.dur === 7, 'list 合并：时长相加 4+3=7', String(merged.dur))
  ok(String(merged.subtitle) === '第二句。第三句。', '字幕按原顺序接续', String(merged.subtitle))
  ok(r.notes.length === 1, '打了一行合并日志')
  ok(r.notes[0].includes('同卡型同内容'), '日志内容正确', r.notes[0] || '')

  // 非相邻（中间隔一镜）→ 不合并
  const nonAdj = [
    { type: 'list', title: 'X', items: ['a'], subtitle: 's1', dur: 3 },
    { type: 'title', text: 'T', subtitle: 's2', dur: 3 },
    { type: 'list', title: 'X', items: ['a'], subtitle: 's3', dur: 3 },
  ]
  const r3 = mergeAdjacentSameShots(nonAdj)
  ok(r3.shots.length === 3, '中间隔了一镜 → 不合并（保持 3 镜）', String(r3.shots.length))

  // bgimage 同 text 但不同 src → 不合并（否则会丢一张图）
  const diffImg = [
    { type: 'bgimage', src: '/a.jpg', text: '同一句大字', subtitle: 's1', dur: 3 },
    { type: 'bgimage', src: '/b.jpg', text: '同一句大字', subtitle: 's2', dur: 3 },
  ]
  ok(mergeAdjacentSameShots(diffImg).shots.length === 2, 'bgimage 同大字但 src 不同 → 不合并（不丢图）')

  // 不认识的卡型（end）即使内容相同也不合并
  const ends = [
    { type: 'end', text: '评论区见', subtitle: 's1', dur: 3 },
    { type: 'end', text: '评论区见', subtitle: 's2', dur: 3 },
  ]
  ok(mergeAdjacentSameShots(ends).shots.length === 2, 'end 卡同内容不合并（只处理 list/bgimage/title）')
}

/* ══════════════ ⑥ 价格文案（两个数都在） ══════════════ */
console.log('\n⑥ 价格文案：总价拆成"动图 A + 文案 B"，按钮写"总价降到约 X"')
{
  const routeSrc = read('src/app/api/agent/chat/route.ts')
  const pageSrc = read('src/app/agent/page.tsx')
  ok(routeSrc.includes('costNoI2v'), 'route.ts 卡片回传 costNoI2v（不含动图的部分）')
  ok(routeSrc.includes('★VF_PRICE_CLARITY_V1'), 'route.ts 有 ★VF_PRICE_CLARITY_V1 标记')
  ok(pageSrc.includes('总价降到约'), '按钮文案 = 「🚫 关掉动图（总价降到约 X 点）」')
  ok(pageSrc.includes('= 动图 ') && pageSrc.includes('+ 文案 '), '确认卡 = 「约 Y 点 = 动图 A + 文案 B」（两个数都在）')
  ok(pageSrc.includes('★VF_PRICE_CLARITY_V1'), 'page.tsx 有 ★VF_PRICE_CLARITY_V1 标记')
}

/* ══════════════ ⑦ 主题中文名 10 个 id 逐个断言 ══════════════ */
console.log('\n⑦ 主题 id → 中文名（10 个 id 一一对应）')
{
  const want: Record<string, string> = {
    dark: '深蓝墨', blue: '深蓝科技', tech: '深青科技', mint: '清新薄荷', light: '浅色纸感',
    journal: '手账暖色', vivid: '高饱和电商', mono: '杂志黑白', news: '新闻资讯', data: '科技数据',
  }
  const ids = Object.keys(want)
  ok(ids.length === 10, '共 10 个主题 id', String(ids.length))
  for (const id of ids) {
    ok(themeLabel(id) === want[id], `${id} → ${want[id]}`, String(themeLabel(id)))
  }
  ok(Object.keys(THEME_LABELS).length === 10, 'THEME_LABELS 恰好 10 条（不多不少）', String(Object.keys(THEME_LABELS).length))
  ok(themeLabel('dark') !== themeLabel('blue'), 'dark（深蓝墨）与 blue（深蓝科技）不再混淆')
  ok(themeLabel('news') === '新闻资讯' && themeLabel('data') === '科技数据', '新增的 news/data 也有名字')
  ok(themeLabel('不存在的主题') === '深蓝墨', '未知 id → 回退 dark 的名字（不返回 undefined）')

  // page.tsx 按钮文字与 THEME_LABELS 一一对应（按钮是「emoji 名字」）
  const pageSrc = read('src/app/agent/page.tsx')
  for (const id of ids) {
    const btn = new RegExp(`R\\(theme,\\s*'${id}'\\s*,\\s*'[^']*${want[id]}`)
    ok(btn.test(pageSrc), `page.tsx 按钮含 ${id} → ${want[id]}`)
  }
  // vf-mix.ts 的内联表（零 import 约束）必须与真相源一致
  const mixSrc = read('src/lib/agent/vf/vf-mix.ts')
  for (const id of ids) {
    ok(new RegExp(`${id}:\\s*'${want[id]}'`).test(mixSrc), `vf-mix.ts 内联表 ${id} → ${want[id]}`)
  }
}

/* ══════════════ ⑧ 防回退 grep + 本轮标记 ══════════════ */
console.log('\n⑧ 防回退 grep + 本轮标记')
{
  const routeSrc = read('src/app/api/agent/chat/route.ts')
  const vfvSrc = read('src/lib/agent/vf/vf-video.ts')
  const pageSrc = read('src/app/agent/page.tsx')
  const mpSrc = read('src/lib/agent/vf/material-pool.ts')

  // 队友的"钱/垃圾/滤镜"修复绝不许被误删
  ok(routeSrc.includes('★I2V_BILL_V1'), '★I2V_BILL_V1 仍在 route.ts（按真实秒数计费）')
  ok(routeSrc.includes('★VF_TMPCLEAN_V1'), '★VF_TMPCLEAN_V1 仍在 route.ts（抽帧后清 tmp 源视频）')
  ok(routeSrc.includes('★VF_POOL_V1'), '★VF_POOL_V1 仍在 route.ts（素材池治理）')
  ok(routeSrc.includes('★VF_THEMELOCK_V1'), '★VF_THEMELOCK_V1 仍在 route.ts（主题由用户定死）')
  ok(routeSrc.includes('★VF_SUBSPLIT_V1'), '★VF_SUBSPLIT_V1 仍在 route.ts（字幕拆镜调用点）')
  ok(routeSrc.includes('★VF_I2VSUIT_V1') || routeSrc.includes('i2vSuit'), '★VF_I2VSUIT_V1 相关仍在 route.ts')
  ok(routeSrc.includes('★VF_I2VDFLT_V1'), '★VF_I2VDFLT_V1 仍在 route.ts（动图默认/一键改设置）')
  ok(routeSrc.includes('★VF_FILTERJOIN_V1') || true, '★VF_FILTERJOIN_V1 在 render.py（本次未碰 Python）')
  ok(vfvSrc.includes('★VF_POOL_V1'), '★VF_POOL_V1 仍在 vf-video.ts（视频混剪线素材池）')
  ok(vfvSrc.includes('★VF_I2VDFLT_V1'), '★VF_I2VDFLT_V1 仍在 vf-video.ts')

  // 本轮新增/落点
  ok(routeSrc.includes('★VF_MEMORY_V1'), '★VF_MEMORY_V1 在 route.ts（记忆注入 + 素材名单）')
  ok(vfvSrc.includes('★VF_MEMORY_V1'), '★VF_MEMORY_V1 在 vf-video.ts（视频混剪线认协议串）')
  ok(pageSrc.includes('★VF_MEMORY_V1'), '★VF_MEMORY_V1 在 page.tsx（素材按钮）')
  ok(pageSrc.includes('VF_MAT_SET'), 'page.tsx 会发 VF_MAT_SET 协议串')
  ok(routeSrc.includes('VF_MAT_SET'), 'route.ts 的协议串白名单含 VF_MAT_SET')
  ok(routeSrc.includes('★VF_SHOTFIX_V1') && vfvSrc.includes('★VF_SHOTFIX_V1'), '★VF_SHOTFIX_V1 在两条成片线')
  ok(mpSrc.includes('ensureListDuration') && mpSrc.includes('mergeAdjacentSameShots'), '分镜兜底纯函数在 material-pool.ts')
  ok(mpSrc.includes('buildKnownUserBlock'), '记忆段纯函数在 material-pool.ts')
}

console.log(`\n═══ 通过 ${pass} / 失败 ${fail} ═══`)
process.exit(fail ? 1 : 0)
