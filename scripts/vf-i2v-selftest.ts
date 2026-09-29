/**
 * ★VF_VIDI2V_V1 / ★VF_AI_PICK_V1 自测（2026-09-29）
 *
 * 目标：**不联网、不烧钱、不碰数据库**地证明四件事 ——
 *   ① 「同一张图只生成一次」的去重 + 每片 6 张上限 + 拿不到公网地址就保持静态；
 *   ② 设置卡把「让图动起来」关掉 ⇒ **一根首帧都不注入**（也不计费）；
 *   ③ 计费把 i2v 秒数算进去，且**卡片报价 = 实扣**（同一份公式）；
 *   ④ 白名单把非法 theme/variant/motion 删掉（不属于合法值的字段直接丢，回默认渲染）。
 *   另有加分项：与渲染层（render.py / themes.py）的白名单**逐项对账**，防两边漂移。
 *
 * 跑法（项目根目录，任选一种；ts-node 已在 devDependencies 里）：
 *   PowerShell:  npx ts-node --transpile-only -O '{\"module\":\"commonjs\",\"moduleResolution\":\"node\"}' scripts/vf-i2v-selftest.ts
 *   bash/zsh:    npx ts-node --transpile-only -O '{"module":"commonjs","moduleResolution":"node"}' scripts/vf-i2v-selftest.ts
 * 退出码：全部通过 = 0，有失败 = 1。
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { buildI2vPlan, buildI2vShots, i2vCostPoints, i2vKeyMap, vfTotalCostPoints, VF_I2V_MAX_IMAGES } from '../src/lib/agent/vf/i2v-plan'
import { sanitizeAntiAiShots, pickDesignFields, VF_THEMES, VF_VARIANTS, VF_MOTIONS } from '../src/lib/agent/vf/anti-ai'
import { i2vPlanOf } from '../src/lib/agent/vf/vf-video'

let pass = 0
let fail = 0
function ok(cond: any, name: string, extra = '') {
  if (cond) { pass++; console.log('  ✅ ' + name) }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' → ' + extra : '')) }
}
function eq(a: any, b: any, name: string) {
  ok(JSON.stringify(a) === JSON.stringify(b), name,
    `期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}`)
}

const MU = '/srv/storage/7/video-factory/material'
/** 模拟 chat/route.ts 的映射：本地路径 → 个人仓库 key（vm 里没有的图 = 拿不到公网地址） */
const KEY_MAP: Record<string, string> = {
  [`${MU}/a.jpg`]: 'storage/7/a.jpg',
  [`${MU}/b.jpg`]: 'storage/7/b.jpg',
  [`${MU}/c.jpg`]: 'storage/7/c.jpg',
  [`${MU}/d.jpg`]: 'storage/7/d.jpg',
  [`${MU}/e.jpg`]: 'storage/7/e.jpg',
  [`${MU}/f.jpg`]: 'storage/7/f.jpg',
  [`${MU}/g.jpg`]: 'storage/7/g.jpg',
  [`${MU}/h.jpg`]: 'storage/7/h.jpg',
  [`${MU}/i.jpg`]: 'storage/7/i.jpg',
}
const img = (n: string, dur: number) => ({ type: 'bgimage', src: `${MU}/${n}.jpg`, text: '大字', subtitle: '字幕', dur })

console.log('\n① 去重 / 上限 / 拿不到公网地址 → 保持静态')
{
  const shots = [
    img('a', 5),                                    // 第 1 镜：要动
    img('b', 6),                                    // 第 2 镜：要动
    { type: 'title', text: '标题', subtitle: '字幕', dur: 4 },   // 文字卡：不动
    { type: 'video', src: '/v/x.mp4', dur: 6 },     // 视频镜：本来就动态 → 不动
    img('a', 5),                                    // 第 5 镜：**同一张图** → 不再调 H3，复用那段动图
  ]
  const p = buildI2vPlan(shots, KEY_MAP)
  // ★VF_I2V_CACHE_V1（2026-09-29 main 定案）：第 5 镜**也进 list**（带同一个首帧 key）——
  //   make.py 按 ref_image URL 缓存 → 复用第 1 镜那段动图（零额外调用、零额外计费）。
  //   这样"同一张图"在该片里始终是动的，不会一会儿动一会儿静。
  eq(p.list.map((x) => x.index), [1, 2, 5], '只挑图片镜；同图的后续镜也进 list（复用动图，不再调 H3）')
  eq(p.list.map((x) => x.image), ['storage/7/a.jpg', 'storage/7/b.jpg', 'storage/7/a.jpg'],
    '首帧用【个人仓库 key】（不是本地路径）；复用镜用同一个 key')
  eq(p.sec, 11, '计费秒数 = **唯一图**首次出现的 dur 之和（5+6=11；第 5 镜复用不重复算）')
  eq(p.images, 2, '唯一图张数 = 2（= 真正调用 H3 的次数）')
  eq(p.reuse, [{ image: `${MU}/a.jpg`, indices: [1, 5] }], '第 5 镜与第 1 镜同图 → 复用同一段动图（不额外计费）')
  eq(p.skippedNoKey, 0, '没有"拿不到公网地址"的图')
  eq(p.overCap, 0, '未触上限')
}
{
  const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']   // 9 张 > 上限 6
  const p = buildI2vPlan(names.map((n) => img(n, 5)), KEY_MAP)
  eq(p.list.length, VF_I2V_MAX_IMAGES, `超过上限时只取前 ${VF_I2V_MAX_IMAGES} 张（费用可控）`)
  eq(p.images, 6, '动起来的图 = 6 张')
  eq(p.overCap, 3, '超上限而保持静态的图 = 3 张（日志要如实说"为控制费用只动了 N 张"）')
  eq(p.sec, 30, '计费只算这 6 张（6 × 5 秒）')
}
{
  const shots = [img('a', 5), { type: 'bgimage', src: '/srv/disk/only-local.jpg', dur: 5 }, img('b', 5)]
  const p = buildI2vPlan(shots, KEY_MAP)
  eq(p.list.map((x) => x.index), [1, 3], '拿不到仓库 key 的那一镜**不注入首帧**（第 2 镜被跳过）')
  eq(p.skippedNoKey, 1, '如实记下"有 1 张图拿不到公网地址"')
}

console.log('\n② 设置卡关掉「让图动起来」⇒ 一根首帧都不注入')
{
  const shots = [img('a', 5), img('b', 6)]
  const on: any = { i2v: 'on', shots, i2vKeys: KEY_MAP }
  const off: any = { i2v: 'off', shots, i2vKeys: KEY_MAP }
  const dflt: any = { shots, i2vKeys: KEY_MAP }        // 老草稿没有 i2v 字段 → 默认"开"（老板定案）
  eq(i2vPlanOf(on).list.map((x) => x.index), [1, 2], '开关开 → 正常注入两镜')
  eq(i2vPlanOf(off).list, [], '开关关 → i2vShots 为空（chat/route.ts 里就不会写 ref_image）')
  eq(i2vPlanOf(off).sec, 0, '开关关 → 计费秒数 0（不额外扣一分钱）')
  eq(i2vPlanOf(dflt).list.map((x) => x.index), [1, 2], '老草稿（无 i2v 字段）按"开"处理')
}

console.log('\n②.5 通用入口 buildI2vShots（别的线要开图生视频就调它，不许写死在一条线里）')
{
  const shots = [img('a', 5), img('b', 6)]
  const r = buildI2vShots({ shots, keyByPath: KEY_MAP })
  eq(r.args.i2vShots.map((x: any) => x.index), [1, 2], 'args.i2vShots 直接可拼进 make_ai_video')
  eq([r.args.source, r.args.mix], ['mix', '1,2'], '默认同时声明 source=mix + mix=镜号（过护栏）')
  eq(r.points, 550, '返回报价点数（与卡片/实扣同公式）')
  ok(r.notes.some((n) => n.includes('让 2 张图动起来')), 'notes 说明动了几张（调用方原样写日志）')
  const off = buildI2vShots({ shots, keyByPath: KEY_MAP, enabled: 'off' })
  eq(off.args, {}, '开关关 → args 为空对象（一个首帧都不注入）')
  eq(off.points, 0, '开关关 → 0 点')
  ok(off.notes[0].includes('保持静态'), '开关关 → notes 写清原因')
  const noMix = buildI2vShots({ shots, keyByPath: KEY_MAP, declareMix: false })
  ok(!('source' in noMix.args) && noMix.args.i2vShots.length === 2, 'declareMix:false 时不带 source/mix（给其它计费口径留口子）')
  const cap = buildI2vShots({ shots: ['a', 'b', 'c', 'd'].map((n) => img(n, 5)), keyByPath: KEY_MAP, max: 2 })
  eq([cap.plan.images, cap.plan.overCap], [2, 2], 'max 可覆盖（别的线想更省可以调小）')
  ok(cap.notes.some((n) => n.includes('上限 2 张')), 'notes 如实说明"为控制费用只动了 N 张"')
  const noKey = buildI2vShots({ shots: [img('a', 5), { type: 'bgimage', src: '/x/no-such.jpg', dur: 5 }], keyByPath: KEY_MAP })
  eq(noKey.args.mix, '1', '拿不到公网地址的那一镜**不进 mix 名单** → 它保持静态图')
  // ★VF_I2V_CACHE_V1：同图复用镜进名单，但**计费仍只按唯一图**（否则报价≠实扣）
  const dup = buildI2vShots({ shots: [img('a', 5), img('b', 6), img('a', 5)], keyByPath: KEY_MAP })
  eq(dup.args.mix, '1,2,3', '同图的后续镜也在注入名单里（make.py 按首帧 URL 复用那段动图）')
  eq(dup.points, 550, '但计费只按唯一图算（5+6=11 秒，第 3 镜复用不重复扣钱）')
  ok(noKey.notes.some((n) => n.includes('拿不到公网地址')), 'notes 写清原因（那一镜不注入首帧）')
  eq(i2vKeyMap([{ localPath: '/a.jpg', key: 'storage/7/a.jpg' }, { localPath: '/b.jpg' }, null]),
    { '/a.jpg': 'storage/7/a.jpg' }, 'i2vKeyMap：只用有 key 的素材建映射')
}

console.log('\n③ 计费：i2v 秒数算进总价，且卡片报价 = 实扣')
{
  eq(i2vCostPoints(11), 550, '11 秒 × 50 点 = 550 点')
  eq(vfTotalCostPoints(300, 11), 565, '300 字(15 点) + 11 秒动图(550 点) = 565 点')
  // 与 make_ai_video【混合】分支逐字同形：max(1, ceil(秒×50) + ceil(字数/20))
  for (const [chars, sec] of [[300, 11], [0, 0], [600, 30], [1234, 7.5], [20, 4]] as number[][]) {
    eq(vfTotalCostPoints(chars, sec), Math.max(1, i2vCostPoints(sec) + Math.ceil(chars / 20)),
      `报价 = 实扣口径：${chars} 字 + ${sec} 秒`)
  }
  // 源码级对账：出片区与报价区必须调**同一个**公式，不许各写一份（历史事故：卡片 205 / 实扣 1500）
  const routeSrc = readFileSync(join(__dirname, '..', 'src/app/api/agent/chat/route.ts'), 'utf-8')
  ok(/i2vCostPoints\(_mixAiSec\)/.test(routeSrc), 'make_ai_video 混合口径实扣用 i2vCostPoints(_mixAiSec)')
  ok(/vfTotalCostPoints\(charN, _i2vSec\)/.test(routeSrc), '确认卡成本用 vfTotalCostPoints(charN, _i2vSec)')
  ok(/含让 \$\{_i2vN\} 张图动起来：约 \$\{_i2vPts\} 点/.test(routeSrc), '分镜卡 hint 如实写出"含让 N 张图动起来：约 M 点"')
  ok(/\.\.\._i2vB\.args/.test(
    readFileSync(join(__dirname, '..', 'src/lib/agent/vf/vf-video.ts'), 'utf-8')),
    'vf-video.ts 直接把通用函数给的 args 拼进 make_ai_video（不再自己拼 → 别的线可复用）')
  ok(/source: 'mix', mix: plan\.list\.map\(\(x\) => x\.index\)\.join\(','\)/.test(
    readFileSync(join(__dirname, '..', 'src/lib/agent/vf/i2v-plan.ts'), 'utf-8')),
    '通用函数默认**同时声明** source=mix + mix=镜号（chat/route.ts 的护栏要求，不许绕过）')
  // 拿不到首帧的镜必须剔除：否则 make.py 对"在名单里但没有 ref_image"的镜会退化成**纯文生视频**，
  // 画面被整段换掉还照扣钱（用户要的是"自己的图动起来"）
  ok(/_mixIdxAll\.filter\(\(n\) => _i2vOkIdx!\.includes\(n\)\)/.test(routeSrc),
    '拿不到首帧的镜被剔除出 --mix 名单（保持静态图，且只少收不多收）')
  // ★VF_I2V_CACHE_V1：实扣必须按【唯一 ref_image】去重，且必须读**注入后的** plan（否则看不到 ref_image）
  ok(/JSON\.parse\(vfPlanInj \|\| vfPlan \|\| '\{\}'\)/.test(routeSrc),
    '实扣读的是注入后的 plan（vfPlanInj）—— 否则 ref_image 看不到、"同图只算一次"失效')
  ok(/const _seenRef = new Set<string>\(\)/.test(routeSrc) && /if \(_seenRef\.has\(_ref\)\) return/.test(routeSrc),
    '实扣按唯一 ref_image 去重（复用镜不重复扣钱 → 报价 = 实扣）')
  ok(/_mixShots = _i2vOkIdx \? _mixIdx\.join\(','\)/.test(routeSrc),
    '透给 make.py 的 --mix 与计费名单同源')
}

console.log('\n④ 白名单：非法 theme / variant / motion 直接删掉')
{
  const { shots, notes } = sanitizeAntiAiShots([
    { type: 'title', text: '短句', theme: 'DARK', variant: 'chip', motion: 'typewriter' },   // 合法（theme 大写→归一化）
    { type: 'title', text: '短句', theme: 'neon', variant: 'rainbow', motion: 'spin' },      // 全非法 → 三个字段删掉
    { type: 'list', title: '清单', items: ['一', '二'], variant: 'stack', motion: 'fade' },   // 合法
    { type: 'compare', left: '旧', right: '新', variant: 'bar' },                            // 合法
    { type: 'bgimage', src: '/a.jpg', theme: 'mint', motion: 'slide', variant: 'left' },      // bgimage 无 variant → 只删 variant
    { type: 'number', value: 1, label: '效率', subtitle: '没有数字的句子', variant: 'center' }, // 无据数字卡→降级 title，variant 按最终卡型判
  ] as any[])
  eq(shots[0].theme, 'dark', '合法 theme 保留（顺便小写归一化）')
  eq(shots[0].variant, 'chip', 'title 卡的合法 variant 保留')
  eq(shots[0].motion, 'typewriter', '合法 motion 保留')
  ok(!('theme' in shots[1]) && !('variant' in shots[1]) && !('motion' in shots[1]),
    '非法值（neon / rainbow / spin）被直接删掉 → 回默认渲染')
  // 非法的一共 4 处：第 2 镜的 theme/variant/motion 3 处 + 第 5 镜 bgimage 上的 variant 1 处
  ok(notes.some((n) => n.includes('非法值已删 4 处')), '处理明细写进 notes（可回溯 AI 写了什么）')
  eq([shots[2].variant, shots[2].motion], ['stack', 'fade'], 'list 卡的 steps/stack 与 fade/slide 放行')
  eq(shots[3].variant, 'bar', 'compare 卡的 split/bar 放行')
  eq(shots[4].theme, 'mint', 'bgimage 的 theme 保留')
  eq(shots[4].motion, 'slide', 'bgimage 的 motion 保留')
  ok(!('variant' in shots[4]), 'bgimage 没有版式变体 → variant 删掉（免得渲染层拿到不认识的组合）')
  eq(shots[5].type, 'title', '无据数字卡先降级成 title（原有规则不变）')
  eq(shots[5].variant, 'center', 'variant 按**最终卡型**判（title 的 center 仍合法）')
}
{
  eq(pickDesignFields({ theme: 'dark', variant: 'left', motion: '  ', transition: {} }),
    { theme: 'dark', variant: 'left' }, '字段透传只收非空字符串（空串/对象不收）')
  const r = sanitizeAntiAiShots([{ type: 'title', text: 'x', transition: 'dissolve' }] as any[])
  ok(!('transition' in r.shots[0]), '非法 transition 同样删掉')
}

console.log('\n⑤ 与渲染层对账（防两边白名单漂移）')
{
  const renderSrc = readFileSync(join(__dirname, '..', 'scripts/video-factory/render.py'), 'utf-8')
  const pyTuple = (name: string): string[] | null => {
    const m = renderSrc.match(new RegExp(`${name}\\s*=\\s*\\(([^)]*)\\)`))
    return m ? m[1].split(',').map((x) => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean) : null
  }
  eq(pyTuple('TITLE_VARIANTS'), VF_VARIANTS.title, 'render.py TITLE_VARIANTS = 服务端 title 白名单')
  eq(pyTuple('LIST_VARIANTS'), VF_VARIANTS.list, 'render.py LIST_VARIANTS = 服务端 list 白名单')
  eq(pyTuple('COMPARE_VARIANTS'), VF_VARIANTS.compare, 'render.py COMPARE_VARIANTS = 服务端 compare 白名单')
  eq(pyTuple('MOTIONS'), VF_MOTIONS, 'render.py MOTIONS = 服务端 motion 白名单')
  ok(/in \('cut', 'fade', 'soft'\)/.test(renderSrc), 'render.py 的 transition 白名单 = soft/cut/fade')
  const themesSrc = readFileSync(join(__dirname, '..', 'scripts/video-factory/themes.py'), 'utf-8')
  ok(VF_THEMES.every((t) => new RegExp(`['"]${t}['"]\\s*:`).test(themesSrc)),
    `themes.py 里能找到全部 ${VF_THEMES.length} 套主题（与 VF_THEMES 对齐）`)
}

console.log(`\n===== 自测结果：${pass} 项通过，${fail} 项失败 =====\n`)
process.exit(fail ? 1 : 0)
