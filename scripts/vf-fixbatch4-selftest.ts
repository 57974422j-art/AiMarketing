/**
 * ★VF_FIXBATCH4_SELFTEST_V1（2026-09-29）——「视频未做项 1~8」中 vfix 负责的 4 项自测。
 *
 * 目标：**不联网、不烧钱、不碰数据库**地证明四件事 ——
 *   ① 固定标题「手动覆盖两行」：用户填了就用用户的（两行都填 → **一次 AI 都不调**）；
 *      超长截断 / emoji 清洗；pin='off' 不注入；只填一行 → 另一行走 AI 且手填的永不被覆盖。
 *   ② 「图片成片」线开逐镜图生视频：用同一个通用函数 buildI2vShots（同图去重 / 拿不到公网地址保持静态 /
 *      开关关 → 空 args 且 0 点）；**报价 = 实扣同源**（卡片用的 vfTotalCostPoints 与 make_ai_video 的
 *      mix 口径手工对账）。
 *   ③ 「改文案后重算标题」：shouldRebuildBanner 的边界（开关关 / 空文案 / 两行手填 → 不重算）。
 *   ④ 「只重渲第 N 镜」通路对账（源码级契约，防漂移）：make.py 有 --render-only、vf-edit.ts 会复用配音、
 *      route.ts 有"无草稿 → 只重渲染"分支、page.tsx 完成卡有入口、tools.ts 登记了 edit_video_shot。
 *
 * 跑法（项目根目录，PowerShell）：
 *   npx ts-node --transpile-only --compiler-options "{\"module\":\"commonjs\",\"moduleResolution\":\"node\"}" scripts/vf-fixbatch4-selftest.ts
 * 退出码：全部通过 = 0，有失败 = 1。
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  buildBanner, bannerFieldOf, hasManualBanner, shouldRebuildBanner,
  VF_BANNER_LINE1_MAX, VF_BANNER_LINE2_MAX,
} from '../src/lib/agent/vf/banner'
import { buildI2vShots, i2vCostPoints, i2vKeyMap, vfTotalCostPoints } from '../src/lib/agent/vf/i2v-plan'

let pass = 0
let fail = 0
function ok(cond: any, name: string, extra = '') {
  if (cond) { pass++; console.log('  ✅ ' + name) }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' → ' + extra : '')) }
}
function eq(a: any, b: any, name: string) {
  ok(JSON.stringify(a) === JSON.stringify(b), name, `期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}`)
}
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u

/** 假 generateText：返回固定文本 + 调用计数（证明"没调"用） */
function fakeGen(reply: string | null, mode: 'ok' | 'throw' = 'ok') {
  const box = { calls: 0 }
  const fn = async (_p: string): Promise<string | null> => {
    box.calls++
    if (mode === 'throw') throw new Error('不该被调用')
    return reply
  }
  return { box, fn }
}

const SCRIPT = '刑案想争取缓刑或不起诉，检察院的3个核心发力点是关键。第三个发力点最容易被忽略。'

async function main() {
  /* ══════════════ ① 固定标题「手动覆盖两行」 ══════════════ */
  console.log('\n① 固定标题「手动覆盖两行」（用户填优先 / 截断 / emoji / off 不注入）')
  {
    // 两行都填 → 一次 AI 都不调（用 throw 版 generateText 证明它绝不会被调用）
    const g = fakeGen(null, 'throw')
    const r = await buildBanner({ script: SCRIPT, pin: 'on', pin1: '缓刑争取要点', pin2: '检察院3个发力点', generateText: g.fn })
    eq(g.box.calls, 0, '两行都手填 → generateText 调用次数 = 0（完全不调 AI）')
    eq(r.lines, { line1: '缓刑争取要点', line2: '检察院3个发力点' }, '两行都手填 → 原样采用')
    eq(r.field.banner, { line1: '缓刑争取要点', line2: '检察院3个发力点', from: 1, to: 0 }, 'field.banner 形状正确（from=1/to=0）')

    // 手填超长 → 截断到 12 / 18
    const r2 = await buildBanner({ script: SCRIPT, pin: 'on',
      pin1: '这是一个超过十二个字的第一行', pin2: '这是一个超过十八个字的第二行核心承诺',
      generateText: fakeGen(null).fn })
    ok((r2.lines?.line1.length || 0) <= VF_BANNER_LINE1_MAX, `手填第 1 行被截断到 ≤${VF_BANNER_LINE1_MAX}`)
    ok((r2.lines?.line2.length || 0) <= VF_BANNER_LINE2_MAX, `手填第 2 行被截断到 ≤${VF_BANNER_LINE2_MAX}`)

    // emoji 清洗 + 结尾标点
    const r3 = await buildBanner({ script: SCRIPT, pin: 'on', pin1: '🔥缓刑争取要点。', pin2: '✨3个发力点！',
      generateText: fakeGen(null).fn })
    ok(!EMOJI_RE.test(r3.lines?.line1 || '') && !EMOJI_RE.test(r3.lines?.line2 || ''), '手填内容里的 emoji 被清掉')
    eq(r3.lines, { line1: '缓刑争取要点', line2: '3个发力点' }, 'emoji + 结尾标点都被去掉')

    // 只填一行 → 另一行交给 AI，手填的永不被覆盖
    const g4 = fakeGen('{"line1":"AI拟的第一行","line2":"AI拟的第二行"}')
    const r4 = await buildBanner({ script: SCRIPT, pin: 'on', pin1: '我定的第一行', pin2: '  ', generateText: g4.fn })
    eq(g4.box.calls, 1, '只填一行 → 仍调一次 AI 补另一行')
    eq(r4.lines?.line1, '我定的第一行', '手填的第 1 行永不被 AI 覆盖')
    eq(r4.lines?.line2, 'AI拟的第二行', '没填的第 2 行用 AI 结果')

    // pin='off' → 一次都不调、不带字段
    const g5 = fakeGen('{"line1":"不该用到","line2":"不该用到"}')
    const r5 = await buildBanner({ script: SCRIPT, pin: 'off', pin1: '甲', pin2: '乙', generateText: g5.fn })
    eq(r5.field, {}, "pin='off' → field 为空对象（渲染层不画）")
    eq(g5.box.calls, 0, "pin='off' → 一次 AI 都不调")

    // bannerFieldOf 也认手填（防"手填了出片却是旧标题"）
    eq(bannerFieldOf({ pin: 'on', pin1: '甲', pin2: '乙', banner: { line1: '旧1', line2: '旧2' } }).banner,
      { line1: '甲', line2: '乙', from: 1, to: 0 }, 'bannerFieldOf：手填优先于草稿里旧的 AI 两行')
    eq(bannerFieldOf({ pin: 'off', pin1: '甲', pin2: '乙' }), {}, 'bannerFieldOf：开关关 → 啥都不带')
  }

  /* ══════════════ ② 图片成片线：图生视频 + 报价=实扣同源 ══════════════ */
  console.log('\n② 「图片成片」线开逐镜图生视频（同图去重 / 降级 / 报价=实扣）')
  {
    const shots = [
      { type: 'bgimage', src: '/a.jpg', dur: 5 },
      { type: 'bgimage', src: '/b.jpg', dur: 4 },
      { type: 'bgimage', src: '/a.jpg', dur: 3 },   // 同一张图（复用，不额外计费）
      { type: 'video', src: '/v.mp4', dur: 5 },      // 视频镜不参与
      { type: 'bgimage', src: '/c.jpg', dur: 6 },    // 不在仓库里（拿不到公网地址）→ 保持静态
    ]
    const keyByPath = i2vKeyMap([
      { localPath: '/a.jpg', key: 'storage/1/a.jpg' },
      { localPath: '/b.jpg', key: 'storage/1/b.jpg' },
    ])
    eq(keyByPath, { '/a.jpg': 'storage/1/a.jpg', '/b.jpg': 'storage/1/b.jpg' }, 'i2vKeyMap：本地路径 → 仓库 key')

    const r = buildI2vShots({ shots, keyByPath, enabled: 'on' })
    eq(r.plan.images, 2, '唯一图 = 2 张（a / b）')
    eq(r.plan.sec, 9, '计费秒数 = a(5) + b(4) = 9（同图的第 3 镜复用、不重复计费）')
    eq(r.plan.list.map((x) => x.index), [1, 2, 3], '注入名单含同图的后续镜（第 1/2/3 镜）')
    eq(r.plan.skippedNoKey, 1, '不在仓库的图（1 张）保持静态、不注入')
    eq(r.points, i2vCostPoints(9), 'points = ceil(9 × 50)')
    eq(r.args.source, 'mix', "args 声明 source='mix'（护栏要求，否则 make_ai_video 直接 TOOL_REJECT）")
    eq(r.args.mix, '1,2,3', 'args.mix = 镜号名单')

    // 开关关 → 空 args、0 点
    const off = buildI2vShots({ shots, keyByPath, enabled: 'off' })
    eq(off.args, {}, "enabled='off' → args 为空对象（不注入首帧）")
    eq(off.points, 0, "enabled='off' → 0 点")
    ok(off.notes.some((n) => /保持静态/.test(n)), "enabled='off' 的 notes 如实说明「保持静态」")

    // ★报价 = 实扣同源：卡片用 vfTotalCostPoints(chars, sec)；make_ai_video 的 mix 口径是
    //   Math.max(1, i2vCostPoints(sec) + Math.ceil(chars/20)) —— 两者必须逐字相等。
    const mixCost = (chars: number, sec: number) => Math.max(1, i2vCostPoints(sec) + Math.ceil(chars / 20))
    for (const [chars, sec] of [[810, 9], [300, 0], [60, 12], [0, 0], [1500, 25.5]] as number[][]) {
      eq(vfTotalCostPoints(chars, sec), mixCost(chars, sec), `报价=实扣同源：chars=${chars} sec=${sec}`)
    }
  }

  /* ══════════════ ③ 改文案后重算标题 ══════════════ */
  console.log('\n③ 「改文案后重算标题」的判定边界')
  {
    eq(hasManualBanner('甲', '乙'), true, '两行都手填 → hasManualBanner=true')
    eq(hasManualBanner('甲', ''), false, '只填一行 → false（另一行可重算）')
    eq(hasManualBanner('', ''), false, '都没填 → false')
    eq(shouldRebuildBanner({ pin: 'on' }, '新文案'), true, '开关开 + 有文案 → 要重算')
    eq(shouldRebuildBanner({ pin: 'off' }, '新文案'), false, "开关关 → 不重算（本来就没标题）")
    eq(shouldRebuildBanner({ pin: 'on' }, ''), false, '新文案为空 → 不重算')
    eq(shouldRebuildBanner({ pin: 'on', pin1: '甲', pin2: '乙' }, '新文案'), false, '两行手填 → 不重算（手填永不覆盖）')
    eq(shouldRebuildBanner({ pin: 'on', pin1: '甲' }, '新文案'), true, '只填一行 → 仍重算（补另一行，手填那行不受影响）')
  }

  /* ══════════════ ④ + 接线契约对账（源码级，防两边漂移） ══════════════ */
  console.log('\n④ 四条线的接线/通路对账（源码契约）')
  {
    const routeSrc = readFileSync(join(__dirname, '..', 'src/app/api/agent/chat/route.ts'), 'utf-8')
    const pageSrc = readFileSync(join(__dirname, '..', 'src/app/agent/page.tsx'), 'utf-8')
    const vfVideoSrc = readFileSync(join(__dirname, '..', 'src/lib/agent/vf/vf-video.ts'), 'utf-8')
    const vfEditSrc = readFileSync(join(__dirname, '..', 'src/lib/agent/vf/vf-edit.ts'), 'utf-8')
    const toolsSrc = readFileSync(join(__dirname, '..', 'src/lib/agent/tools.ts'), 'utf-8')
    const makePy = readFileSync(join(__dirname, '..', 'scripts/video-factory/make.py'), 'utf-8')

    // ① 接线：设置卡传 pin1/pin2；两条线解析并交给 buildBanner（buildBanner 里手填优先）
    ok(/pin1,\s*pin2,/.test(pageSrc), 'page.tsx 设置卡把 pin1/pin2 随 VF_FORM 提交')
    ok(/pin1: vd\.pin1, pin2: vd\.pin2/.test(vfVideoSrc), '图视混剪：手填两行传给 buildBanner')
    ok(/pin1: vd\.pin1, pin2: vd\.pin2/.test(routeSrc), '图片成片：手填两行传给 buildBanner')
    ok(/from '\.\/banner'/.test(vfVideoSrc) && /hasManualBanner|shouldRebuildBanner/.test(routeSrc),
      '两线共用 banner.ts 的同一份清洗/截断/覆盖规则')

    // ② 接线：图片成片线引入并调用通用图生视频函数（报价与出片都接上）
    ok(/buildI2vShots, i2vKeyMap/.test(routeSrc), 'route.ts 引入 buildI2vShots / i2vKeyMap')
    ok(/vd\.i2vKeys = i2vKeyMap\(vfLocal\)/.test(routeSrc), '图片成片线建"本地路径→仓库 key"映射')
    ok(/buildI2vShots\(\{[\s\S]{0,120}shots: vd\.shots/.test(routeSrc), '出片时算 i2v 并填进 make_ai_video args')
    ok(/i2vSec: _i2vB\.plan\.sec, i2vImages: _i2vB\.plan\.images/.test(routeSrc),
      '确认卡报价用同一份计划（i2vSec/i2vImages）')
    ok(/f\.i2v !== undefined/.test(routeSrc), '图片成片线解析设置卡的 i2v 开关')

    // ③ 接线：文案被修改的路径上重算 banner
    ok(/_maybeRebuildBanner\(vd, String\(vd\.script/.test(routeSrc), '文案微调分支调用重算 banner')
    ok(/shouldRebuildBanner/.test(routeSrc), '重算前先过 shouldRebuildBanner（手填/关开关 → 不覆盖）')

    // ④ 只重渲染：通路完整性（客户端入口 → 协议 → 服务端 → make.py --render-only → 复用配音）
    ok(/VfReRenderShot/.test(pageSrc) && /VF_EDIT:/.test(pageSrc), 'page.tsx 成片完成卡有「只重渲第 N 镜」入口（发 VF_EDIT）')
    const nVfEditProto = routeSrc.split('/^VF_EDIT\\s*[:{]/').length - 1
    ok(nVfEditProto >= 2, 'route.ts 两处放行 VF_EDIT 协议串（标准模式锁死 + 成片块入口）',
      `实际命中 ${nVfEditProto} 处`)
    ok(/片已出、无草稿 → VF_EDIT/.test(routeSrc), 'route.ts 有"无草稿 → 只重渲染"分支')
    ok(/editVfShots\(String\(uidVF2\), _editsR, _tidR\)/.test(routeSrc), '该分支真的调用 editVfShots')
    ok(/--render-only/.test(vfEditSrc) && /--render-only/.test(makePy), 'vf-edit 与 make.py 共用 --render-only')
    ok(/'--render-only', '--workdir', work, '--out', newOut/.test(vfEditSrc), '只重渲染复用 work 目录（不重新 TTS）')
    ok(/storyboard\.voiced\.json/.test(makePy) && /voice\.m4a/.test(makePy),
      'make.py --render-only 复用 storyboard.voiced.json + voice.m4a（复用旧配音）')
    ok(/name: 'edit_video_shot'/.test(toolsSrc), 'tools.ts 登记了 edit_video_shot（对话"第 3 镜大字改成 X"这条路）')
  }

  console.log(`\n===== 自测结果：${pass} 项通过，${fail} 项失败 =====\n`)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => { console.error('自测崩溃:', e); process.exit(1) })
