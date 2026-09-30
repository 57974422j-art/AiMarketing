/**
 * ★VF_POOL_V1（2026-09-30）「成片素材池治理」自测
 *
 * 目标：**不联网、不烧钱、不碰数据库**地证明六件事 ——
 *   ① 成片判定：只对「出片记录 + 统一入库命名」两条同时成立的素材排除，用户自己导入的原片不误伤；
 *   ② 池子安全阀：排除后剩余 < 3 条 → 自动放开排除（绝不让用户没素材可用）；
 *   ③ 同素材不重复：重复的镜换成还没用过的素材；素材不够时保证同一素材间隔 ≥ 2 镜；
 *   ④ 最近用过降权：把最近 1~2 次用过的素材排到后面（不是排除）；
 *   ⑤ 指纹缓存：键 = `key@size`，命中复用、大小变了失效、识别失败不写缓存；
 *   ⑥ 与源码接线对账（改代码忘了接上会在这里报出来）。
 *
 * 跑法（项目根目录，任选一种；ts-node 已在 devDependencies 里）：
 *   PowerShell:  npx ts-node --transpile-only -O '{\"module\":\"commonjs\",\"moduleResolution\":\"node\"}' scripts/vf-pool-selftest.ts
 *   bash/zsh:    npx ts-node --transpile-only -O '{"module":"commonjs","moduleResolution":"node"}' scripts/vf-pool-selftest.ts
 * 退出码：全部通过 = 0，有失败 = 1。
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  isOutcomeName, selectMaterialPool, VF_POOL_MIN_KEEP,
  dedupeMaterialUse, shuffleDeterministic, demoteRecent, recentNamesOf, mergeRecentRuns,
  vlCacheKey, cacheGet, cacheSet, vlClipCacheKey, cacheGetRaw, cacheSetRaw,
} from '../src/lib/agent/vf/material-pool'

let pass = 0
let fail = 0
function ok(cond: any, name: string, extra = '') {
  if (cond) { pass++; console.log('  ✅ ' + name) }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' → ' + extra : '')) }
}
function eq(a: any, b: any, name: string) {
  ok(JSON.stringify(a) === JSON.stringify(b), name, `期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}`)
}
const OUTCOME = '20260929_004.mp4'

/** 校验"同一素材两次出现之间至少隔 gap 镜"这条不变量 */
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

function main() {
  console.log('\n① 成片判定（正/反例）')
  {
    ok(isOutcomeName('20260929_004.mp4'), '统一入库命名 .mp4 → 像出片产物')
    ok(isOutcomeName('20260929_004.MOV'), '大小写不敏感（.MOV）')
    ok(!isOutcomeName('20260929_004.jpg'), '图片不算出片产物（只排视频）')
    ok(!isOutcomeName('20260929_04.mp4'), '序号只有 2 位 → 不是系统命名')
    ok(!isOutcomeName('cover_a.jpg'), 'cover_ 封面图 → 不是出片产物')
    ok(!isOutcomeName('我的素材.mp4'), '中文名原片 → 不是出片产物')

    const items = [
      { name: OUTCOME, kind: 'video' },
      { name: 'a.jpg', kind: 'image' },
      { name: 'b.jpg', kind: 'image' },
      { name: 'c.jpg', kind: 'image' },
      { name: 'd.jpg', kind: 'image' },
    ]
    // 有出片记录 → 排除该条
    const r1 = selectMaterialPool(items, { outcomeNames: [OUTCOME] })
    eq(r1.excluded.map((x) => x.name), [OUTCOME], '有出片记录 + 命名成立 → 排除 1 条')
    eq(r1.kept.length, 4, '其余 4 条保留')
    ok(!r1.released, '数量足够 → 不放开')
    ok(r1.notes.some((n) => n.includes('本系统出片产物')), '日志如实写"本系统出片产物"')
    ok(r1.notes.some((n) => n.includes('不是原始素材')), '日志写清"它们是用户自己的成片，不是原始素材"')

    // 强判据有名字、但文件名不是统一入库命名 → 两条不同时成立 → 不排除（宁可不排，别错排）
    const r2 = selectMaterialPool(items, { outcomeNames: ['我的素材.mp4'] })
    eq(r2.excluded.length, 0, '出片记录里的名字不符合入库命名 → 不排除（两条必须同时成立）')

    // 没有任何出片记录元数据 → 一条都不排
    const r3 = selectMaterialPool(items, { outcomeNames: [] })
    eq(r3.kept.length, items.length, '没有出片记录 → 一条都不排')
    ok(r3.notes.some((n) => n.includes('不排除任何素材')), '日志说明"没有元数据 → 不排"')
    ok(selectMaterialPool(items, { outcomeNames: null }).excluded.length === 0, 'outcomeNames=null → 不排除')
  }

  console.log('\n② 池子安全阀（排除后 < 3 条 → 自动放开）')
  {
    const items = [
      { name: OUTCOME, kind: 'video' },
      { name: 'a.jpg', kind: 'image' },
      { name: 'b.jpg', kind: 'image' },
    ] // 排除后只剩 2 条 < 3
    const r = selectMaterialPool(items, { outcomeNames: [OUTCOME] })
    ok(r.released, '排除后仅剩 2 条（< 3）→ released=true')
    eq(r.kept.length, items.length, '放开后 kept = 全部素材（不被排空）')
    eq(r.excluded.length, 0, '放开后不再排除任何素材')
    ok(r.notes.some((n) => n.includes('放开排除')), '日志如实写"已放开排除"')
    eq(VF_POOL_MIN_KEEP, 3, '默认安全阈值 = 3')

    // 刚好 3 条（>= minKeep）→ 仍排除
    const items4 = [...items, { name: 'c.jpg', kind: 'image' }]
    const r2 = selectMaterialPool(items4, { outcomeNames: [OUTCOME] })
    ok(!r2.released && r2.excluded.length === 1, '排除后剩 3 条（= minKeep）→ 仍排除')
    // 自定义阈值
    const r3 = selectMaterialPool(items4, { outcomeNames: [OUTCOME], minKeep: 5 })
    ok(r3.released, '自定义 minKeep=5 → 剩 3 条 < 5 → 放开')
  }

  console.log('\n③ 同素材不重复（归一化兜底）')
  {
    // 素材充足：重复的镜换成还没用到的
    const d1 = dedupeMaterialUse([0, 0, 1, 2, 3], 5, 2)
    ok(d1.ids[0] !== d1.ids[1], '前两镜重复被拆开')
    ok(d1.reassigned >= 1, '重复镜被换成未用素材（reassigned ≥ 1）')
    ok(gapOk(d1.ids, 2), '结果满足"同一素材间隔 ≥ 2 镜"')
    eq(new Set(d1.ids).size, 5, '素材够时 5 镜用 5 个不同素材')
    // 只有一个重复：精确验证 reassigned 计数
    const dExact = dedupeMaterialUse([0, 1, 2, 3, 3], 6, 2)
    eq(dExact.reassigned, 1, '单个重复镜 → reassigned 恰为 1')
    eq(new Set(dExact.ids).size, 5, '换成未用素材后各不相同')

    // 素材不足（2 个素材 4 镜）→ 允许重复但保证间隔
    const d2 = dedupeMaterialUse([0, 0, 0, 1], 2, 2)
    ok(gapOk(d2.ids, 2), '素材不足时仍满足间隔 ≥ 2 镜')
    eq(d2.unreplaceable, 0, '素材不足也无需"保留原样"（间隔可满足）')

    // 只有一个素材 → 无法满足间隔 → 保留原样 + 计数
    const d3 = dedupeMaterialUse([0, 0], 1, 2)
    eq(d3.ids, [0, 0], '只有 1 个素材 → 保留原样')
    ok(d3.unreplaceable >= 1, 'unreplaceable 计数 ≥ 1')
    ok(d3.notes.some((n) => n.includes('保留原样')), '日志写"保留原样（素材数 < 镜头数）"')

    // 越界 / null 视为"这一镜不用素材"，不消耗素材
    const d4 = dedupeMaterialUse([0, null as any, 0 as any], 1, 2)
    eq(d4.ids[1], -1, 'null → -1（该镜不用素材）')

    // 视频重排的典型场景：4 镜里 0 出现两次
    const d5 = dedupeMaterialUse([0, 1, 2, 0, 3], 4, 2)
    ok(gapOk(d5.ids, 2), '5 镜 4 素材：重复的 0 被挪开，间隔 ≥ 2')
    eq(d5.reassigned + d5.gapFixed, 2, '共修正 2 处（1 换新素材 + 1 调间隔）')
  }

  console.log('\n④ 最近用过降权 + 确定性打乱')
  {
    const items = [
      { name: 'a.jpg' }, { name: 'b.jpg' }, { name: 'c.jpg' }, { name: 'd.jpg' },
    ]
    const dm = demoteRecent(items, ['b.jpg'])
    eq(dm.demoted, 1, '最近用过的 1 条被降权')
    eq(dm.items.map((x) => x.name), ['a.jpg', 'c.jpg', 'd.jpg', 'b.jpg'], '降权 = 排到后面（不是排除）')
    eq(demoteRecent(items, []).demoted, 0, '没有历史 → 不降权')
    eq(demoteRecent(items, []).items.length, items.length, '降权不改条目数（绝不排除）')

    const set = recentNamesOf([['x.jpg', 'y.jpg'], ['z.jpg']])
    ok(set.has('x.jpg') && set.has('z.jpg'), 'recentNamesOf 摊平多轮记录')
    eq(recentNamesOf(null).size, 0, 'null → 空集合')

    const merged = mergeRecentRuns([['a.jpg', 'b.jpg'], ['c.jpg']], ['d.jpg', 'd.jpg'], 2)
    eq(merged, [['d.jpg'], ['a.jpg', 'b.jpg']], '合并：新的在最前、最多留 2 轮、轮内去重')
    eq(mergeRecentRuns(null, [], 2), [], '本轮没用素材 → 不新增记录')

    // 确定性打乱：同 seed 一致、是重排、不改条目集合
    const s1 = shuffleDeterministic([1, 2, 3, 4, 5, 6, 7, 8], 42)
    const s2 = shuffleDeterministic([1, 2, 3, 4, 5, 6, 7, 8], 42)
    eq(s1, s2, '同 seed → 结果一致（可复现）')
    eq(s1.slice().sort((x, y) => x - y), [1, 2, 3, 4, 5, 6, 7, 8], '打乱是重排（不丢不增）')
    ok(shuffleDeterministic([1, 2, 3, 4, 5, 6, 7, 8], 1).join(',') !== s1.join(','), '不同 seed → 顺序不同（每轮都变）')
  }

  console.log('\n⑤ 指纹缓存（key@size：命中复用 / 失效重算）')
  {
    const k1 = vlCacheKey('storage/1/20260906_002.jpg', 12345)
    ok(k1.includes('12345'), '键里带文件大小')
    eq(cacheGet({}, 'a', 1), null, '空缓存 → 未命中')
    const cache: Record<string, string> = {}
    ok(cacheSet(cache, 'a', 1, '这是一张工具界面的截图'), '写入摘要 → 成功')
    eq(cacheGet(cache, 'a', 1), '这是一张工具界面的截图', '同 key+size → 命中')
    eq(cacheGet(cache, 'a', 2), null, '大小变了 → 失效（重算）')
    eq(cacheGet(cache, 'b', 1), null, '改名字（key 变）→ 未命中（重算，不串味）')
    ok(!cacheSet(cache, 'c', 1, ''), '识别失败（空）→ 不写缓存（下次重试）')
    ok(!cacheSet(cache, 'c', 1, null), '识别失败（null）→ 不写缓存')
    eq(cacheGet(cache, 'c', 1), null, '未写进去 → 查不到')
  }

  console.log('\n⑤b 视频多帧理解缓存（键要能表达"这条视频的哪一段"）')
  {
    const cc: Record<string, string> = {}
    const KEY = 'storage/1/20260929_004.mp4'
    const k30 = vlClipCacheKey(KEY, 5_000_000, 0, 30)
    ok(k30.includes('5000000') && k30.endsWith('@0@30'), '键 = 仓库key@字节大小@起始秒@时长')
    ok(cacheSetRaw(cc, k30, '视频1（a.mp4）：总长 30 秒\n  · 第 3 秒：咖啡馆门口\n  ★推荐片段：第12~18秒'), '写入视频理解文本 → 成功')
    ok(!!cacheGetRaw(cc, k30), '同键 → 命中（不重抽帧、不重调多图）')
    eq(cacheGetRaw(cc, vlClipCacheKey(KEY, 5_000_001, 0, 30)), null, 'size 变（文件被换）→ miss')
    eq(cacheGetRaw(cc, vlClipCacheKey(KEY, 5_000_000, 0, 31)), null, '时长（片段）变 → miss（绝不串味）')
    eq(cacheGetRaw(cc, vlClipCacheKey(KEY, 5_000_000, 12, 30)), null, '起始秒变 → miss（将来按 vstart 抽帧也不串味）')
    eq(cacheGetRaw(cc, vlClipCacheKey('storage/1/b.mp4', 5_000_000, 0, 30)), null, '换视频（key 变）→ miss')
    ok(!cacheSetRaw(cc, vlClipCacheKey(KEY, 1, 0, 5), ''), '空结果 → 不写缓存（下次重试）')
    ok(!cacheSetRaw(cc, vlClipCacheKey(KEY, 1, 0, 5), null), 'null → 不写缓存')
    ok(vlClipCacheKey(KEY, 5_000_000, 0, 30) !== vlCacheKey(KEY, 5_000_000), '视频键与图片键形状不同（不会互相覆盖）')
  }

  console.log('\n⑥ 与源码接线对账（防"改了代码忘接上"）')
  {
    const vfSrc = readFileSync(join(__dirname, '..', 'src/lib/agent/vf/vf-video.ts'), 'utf-8')
    const vmSrc = readFileSync(join(__dirname, '..', 'src/lib/agent/video-material.ts'), 'utf-8')
    ok(/from '\.\/material-pool'/.test(vfSrc), 'vf-video.ts 引入 material-pool')
    ok(/shuffleDeterministic\(/.test(vfSrc) && /demoteRecent\(/.test(vfSrc), '图视混剪：起草前"打乱 + 降权"已接上')
    ok(/dedupeMaterialUse\(/.test(vfSrc), '图视混剪：归一化去重兜底已接上')
    ok(/saveRecentUsedRuns\(|loadRecentUsedRuns\(/.test(vfSrc), '图视混剪：最近用过读写已接上')
    ok(/素材不许重复用/.test(vfSrc), '提示词里写了"素材不许重复用"硬规矩')
    ok(/VF_RECENT_TAG\s*=\s*'vf_recent_used'/.test(vfSrc), '最近用过用共享 tag vf_recent_used（图片成片线也读同一份）')
    ok(/export async function loadRecentUsedRuns/.test(vfSrc) && /export async function saveRecentUsedRuns/.test(vfSrc), '最近用过读写 helper 已导出（供图片成片线复用）')
    ok(/from '\.\/vf\/material-pool'/.test(vmSrc), 'video-material.ts 引入 material-pool')
    ok(/selectMaterialPool\(/.test(vmSrc) && /readOutcomeNames\(/.test(vmSrc), '素材池排除 + 出片记录已接上')
    ok(/loadVlCache\(/.test(vmSrc) && /saveVlCache\(/.test(vmSrc) && /cacheGet\(/.test(vmSrc) && /cacheSet\(/.test(vmSrc), '视觉摘要指纹缓存已接上')
    ok(/\.vl_cache\.json/.test(vmSrc), '缓存落盘到该用户素材目录（.vl_cache.json）')
    ok(/mode === 'recent'/.test(vmSrc), "mode='recent'（本次上传）不排除 —— 仍按原逻辑返回")
    // ★VF_POOL_V1 扩展：视频多帧理解并入同一缓存通道 + _vl.jpg 垃圾清理
    ok(/vlClipCacheKey\(/.test(vmSrc) && /cacheGetRaw\(/.test(vmSrc) && /cacheSetRaw\(/.test(vmSrc),
      '视频多帧理解（describeVideoClips）已接入同一缓存通道')
    ok(vmSrc.includes('视频多帧理解命中缓存'), '命中时打日志"视频多帧理解命中缓存 X 条"')
    ok(vmSrc.includes('（抽帧失败|（探不到|（没识别出来'), '视频理解失败文本不写缓存（下次重试）')
    ok(vmSrc.includes('fs.unlinkSync(p)'), '_vl.jpg 用完即删（缩图失败时不删原图）')
    ok(/cleanupVlThumbs\(/.test(vmSrc) && vmSrc.includes('_vl\\.jpg'), '_vl.jpg 残留 TTL 兜底清理已接上')
    ok(/const merged: Record<string, string> = \{ \.\.\.loadVlCache/.test(vmSrc), '缓存落盘前先读盘合并（图片/视频并行不互相覆盖）')
  }

  console.log('\n⑦ 图片成片 / 素材线（route.ts）接线对账')
  {
    const routeSrc = readFileSync(join(__dirname, '..', 'src/app/api/agent/chat/route.ts'), 'utf-8')
    ok(/from '@\/lib\/agent\/vf\/material-pool'/.test(routeSrc), 'route.ts 引入 material-pool')
    ok(/loadRecentUsedRuns, saveRecentUsedRuns/.test(routeSrc), 'route.ts 复用 vf-video 的最近用过读写（共享同一份 tag）')
    ok(/dedupeMaterialUse\(/.test(routeSrc), 'route.ts 调 dedupeMaterialUse（同素材不重复）')
    ok(/async function vfSpreadMats/.test(routeSrc) && /function vfDedupeImageShots/.test(routeSrc) && /async function vfRememberUsedImages/.test(routeSrc),
      'route.ts 三条 helper 都在（打乱+降权 / 去重 / 记最近用过）')
    ok(/vfMats = await vfSpreadMats\(uidVF2, vfMats\)/.test(routeSrc), '素材线起草前已调用"打乱 + 降权"')
    ok(/_uploadMode/.test(routeSrc) && /不打乱\/不降权/.test(routeSrc), '上传意图（含回退"最近上传"）不打乱/不降权（尊重用户选择）')
    // 两条分镜出口都接上：首次起草 + 重试分镜
    const dedupeCalls = (routeSrc.match(/vfDedupeImageShots\(uidVF2, vf(Shots|Again),/g) || []).length
    ok(dedupeCalls >= 2, `首次起草与重试分镜两条出口都接了去重（实际 ${dedupeCalls} 处）`)
    ok(routeSrc.includes('★VF_POOL_V1'), '本次改动标记 ★VF_POOL_V1 已在 route.ts')
    // 认出"素材线"的代码依据（③：怎么判定这条线的）
    ok(/vf_draft_base/.test(routeSrc), '素材线草稿 tag = vf_draft_base（判定该线的依据①）')
    ok(/const vfAI = vfPickAI \|\| \(vd\.formSource === 'ai'\)/.test(routeSrc), "判定依据②：formSource 分 ai/mix 后，剩下走【个人仓库素材】的就是本线")
  }

  console.log('\n⑧ team-lead 的三段"钱/垃圾"修复仍在（防被本次改动覆盖）')
  {
    const routeSrc = readFileSync(join(__dirname, '..', 'src/app/api/agent/chat/route.ts'), 'utf-8')
    const makeSrc = readFileSync(join(__dirname, '..', 'scripts/video-factory/make.py'), 'utf-8')
    const vtmSrc = readFileSync(join(__dirname, '..', 'src/lib/video-task-manager.ts'), 'utf-8')
    ok(makeSrc.includes('★I2V_REAL:'), '★I2V_REAL: 仍在 make.py（真实成功的张数/秒数日志）')
    ok(routeSrc.includes('★I2V_BILL_V1'), '★I2V_BILL_V1 仍在 route.ts（按真实秒数计费）')
    ok(routeSrc.includes('★VF_TMPCLEAN_V1'), '★VF_TMPCLEAN_V1 仍在 route.ts（抽帧后清 tmp 源视频）')
    ok(vtmSrc.includes('★VF_WDCLEAN_V1'), '★VF_WDCLEAN_V1 仍在 video-task-manager.ts（失败也清工作目录）')
  }

  console.log(`\n===== 自测结果：${pass} 项通过，${fail} 项失败 =====\n`)
  process.exit(fail ? 1 : 0)
}

main()
