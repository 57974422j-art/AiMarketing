/**
 * ★VF_BANNER_V1「顶部固定标题」自测（2026-09-29）
 *
 * 目标：**不联网、不烧钱、不碰数据库**地证明五件事 ——
 *   ① AI 返回的两行超长会被截断到 12 / 18 字；
 *   ② AI 返回空 / 抛异常时走【规则兜底】（首句前 10 字 / 次句前 16 字），绝不因此不出片；
 *   ③ 设置卡选「不要」（pin='off'）→ **一次 AI 都不调**，plan 里也不带 banner（渲染层因此不画）；
 *   ④ banner 是**根级**字段（planWithBanner 后根级有、shots 里**没有**）—— 渲染层只读根级；
 *   ⑤ AI 文案里的 emoji 会被清掉（复用 anti-ai.ts 的 stripEmoji）。
 *   另外：与渲染层 scripts/video-factory/render.py 的 ★VF_BANNER_V1 契约**逐项对账**（防漂移）。
 *
 * 跑法（项目根目录，任选一种；ts-node 已在 devDependencies 里）：
 *   PowerShell:  npx ts-node --transpile-only -O '{\"module\":\"commonjs\",\"moduleResolution\":\"node\"}' scripts/vf-banner-selftest.ts
 *   bash/zsh:    npx ts-node --transpile-only -O '{"module":"commonjs","moduleResolution":"node"}' scripts/vf-banner-selftest.ts
 * 退出码：全部通过 = 0，有失败 = 1。
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  buildBanner, bannerFieldOf, planWithBanner, fallbackBanner, parseBanner, normalizeBannerLine, splitBannerSentences,
  VF_BANNER_LINE1_MAX, VF_BANNER_LINE2_MAX, VF_BANNER_FALLBACK_LINE1, VF_BANNER_FALLBACK_LINE2,
} from '../src/lib/agent/vf/banner'

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

// 注意：这里**不带 g 标志** —— 带 g 的 RegExp.test 会在多次调用间保留 lastIndex，产生假阳/假阴
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u
const SCRIPT = '刑案想争取缓刑或不起诉，检察院的3个核心发力点是关键。第三个发力点最容易被忽略。'

/** 返回固定文本的假 generateText + 调用计数（证明"不烧钱/没调"） */
function fakeGen(reply: string | null, mode: 'ok' | 'throw' = 'ok') {
  const box = { calls: 0, prompts: [] as string[] }
  const fn = async (p: string): Promise<string | null> => {
    box.calls++; box.prompts.push(p)
    if (mode === 'throw') throw new Error('模拟网络异常')
    return reply
  }
  return { box, fn }
}

async function main() {
  console.log('\n① 超长两行 → 截断到 12 / 18 字')
  {
    const { fn } = fakeGen('{"line1":"这是一个超过十二个字的第一行标题文案","line2":"这是一个超过十八个字的第二行核心承诺文案内容"}')
    const r = await buildBanner({ script: SCRIPT, pin: 'on', generateText: fn })
    ok(!!r.lines, 'AI 合法返回 → 有 lines')
    ok(!r.fallback, '合法返回 → 不走兜底')
    eq(r.lines?.line1, '这是一个超过十二个字的第一行标题文案'.slice(0, VF_BANNER_LINE1_MAX), `第 1 行截断到 ${VF_BANNER_LINE1_MAX} 字`)
    eq(r.lines?.line2, '这是一个超过十八个字的第二行核心承诺文案内容'.slice(0, VF_BANNER_LINE2_MAX), `第 2 行截断到 ${VF_BANNER_LINE2_MAX} 字`)
    ok((r.lines?.line1.length || 0) <= VF_BANNER_LINE1_MAX && (r.lines?.line2.length || 0) <= VF_BANNER_LINE2_MAX, '两行长度均在上限内')
    eq(r.field.banner, { line1: r.lines!.line1, line2: r.lines!.line2, from: 1, to: 0 }, 'field.banner 形状正确（from=1 / to=0 = 钉全片）')
    // 尾部标点 / markdown 记号会被去掉
    eq(normalizeBannerLine('  标题文案。 ', VF_BANNER_LINE1_MAX), '标题文案', '结尾标点被去掉 + 首尾空白清理')
    eq(parseBanner('{"line1":"甲","line2":"乙"}'), { line1: '甲', line2: '乙' }, 'parseBanner 直接解析合法 JSON')
    eq(parseBanner('不是 JSON'), null, '非 JSON → 返回 null（交给兜底）')
    eq(parseBanner('{"line1":"只有一行","line2":""}'), null, '缺一行 → 返回 null（交给兜底）')
  }

  console.log('\n② AI 空 / 抛异常 → 规则兜底（首句前 10 字 / 次句前 16 字）')
  {
    const a = fakeGen(null)
    const r1 = await buildBanner({ script: SCRIPT, pin: 'on', generateText: a.fn })
    ok(r1.fallback, 'AI 返回空 → fallback=true')
    const want1 = normalizeBannerLine(splitBannerSentences(SCRIPT)[0], VF_BANNER_FALLBACK_LINE1)
    const want2 = normalizeBannerLine(splitBannerSentences(SCRIPT)[1], VF_BANNER_FALLBACK_LINE2)
    eq(r1.lines, { line1: want1, line2: want2 }, '兜底 = 首句前 10 字 / 次句前 16 字')
    ok((r1.lines?.line1.length || 0) <= VF_BANNER_FALLBACK_LINE1 && (r1.lines?.line2.length || 0) <= VF_BANNER_FALLBACK_LINE2, '兜底两行在保守长度内')
    ok(!!r1.field.banner, '兜底也照常带 banner（绝不因此不出片）')

    const b = fakeGen(null, 'throw')
    const r2 = await buildBanner({ script: SCRIPT, pin: 'on', generateText: b.fn })
    ok(r2.fallback && !!r2.field.banner?.line1, 'AI 抛异常 → 仍走兜底并带上 banner')
    ok(r2.notes.some((n) => n.includes('规则兜底')), 'notes 如实写"规则兜底"')
    eq(fallbackBanner(''), { line1: '', line2: '' }, '空文案 → 兜底也是空（上层据此不带字段）')
    const r3 = await buildBanner({ script: '', pin: 'on', generateText: fakeGen(null).fn })
    eq(r3.field, {}, '空文案 → field 为空对象（不带 banner）')
  }

  console.log('\n③ 开关关（pin=off）→ 一次 AI 都不调、不带 banner')
  {
    const g = fakeGen('{"line1":"不该用到","line2":"不该用到"}')
    const r = await buildBanner({ script: SCRIPT, pin: 'off', generateText: g.fn })
    eq(r.field, {}, "pin='off' → field 为空对象（渲染层不画）")
    eq(r.lines, null, "pin='off' → 不产出两行")
    eq(g.box.calls, 0, "pin='off' → generateText 调用次数 = 0（不烧钱）")
    eq(bannerFieldOf({ pin: 'off', banner: { line1: 'x', line2: 'y' } }), {}, 'bannerFieldOf：开关关 → 即便有残留文案也不带')
    eq(bannerFieldOf({ pin: false as any, banner: { line1: 'x', line2: 'y' } }), {}, 'bannerFieldOf：pin=false 同样不带')
    // 默认（缺 pin）按"自动"处理
    ok(!!bannerFieldOf({ banner: { line1: 'x', line2: 'y' } }).banner, 'bannerFieldOf：缺 pin 字段 → 默认按"自动"处理')
    eq(bannerFieldOf({ pin: 'on' }), {}, 'bannerFieldOf：没有两行 → 不带（不硬塞空标题）')
  }

  console.log('\n④ banner 是根级字段（不在 shots 里）')
  {
    const field = bannerFieldOf({ pin: 'on', banner: { line1: '刑案想争取缓刑', line2: '3个核心发力点' } })
    const plan = { size: [720, 1280], fps: 25, shots: [{ type: 'title', text: '大字' }, { type: 'bgimage', src: '/a.jpg' }] }
    const p = planWithBanner(plan, field)
    eq(p.banner, { line1: '刑案想争取缓刑', line2: '3个核心发力点', from: 1, to: 0 }, '根级出现 banner（from=1/to=0）')
    ok(!('banner' in (p.shots[0] as any)) && !('banner' in (p.shots[1] as any)), 'shots 里【没有】banner（不会被逐镜重画）')
    ok(!('banner' in (plan as any)), 'planWithBanner 不改原 plan（返回新对象）')
    // 空 field → plan 原样、没有 banner 键
    const p2 = planWithBanner({ shots: [] }, {})
    ok(!('banner' in (p2 as any)), 'field 为空 → plan 里不出现 banner 键（渲染层因此不画）')
  }

  console.log('\n⑤ emoji 被清掉（AI 返回 / 规则兜底两路都清）')
  {
    const r = await buildBanner({ script: SCRIPT, pin: 'on', generateText: fakeGen('{"line1":"🔥刑案想争取缓刑","line2":"✨3个核心发力点"}').fn })
    ok(!EMOJI_RE.test(r.lines?.line1 || '') && !EMOJI_RE.test(r.lines?.line2 || ''), 'AI 返回的 emoji 被清掉')
    eq(r.lines, { line1: '刑案想争取缓刑', line2: '3个核心发力点' }, '清 emoji 后内容不变')
    const fb = fallbackBanner('🚀第一条带 emoji 的句子。✅第二条也有 emoji。')
    ok(!EMOJI_RE.test(fb.line1) && !EMOJI_RE.test(fb.line2), '规则兜底两路也不带 emoji')
    ok(fb.line1.startsWith('第一条带'), '兜底首句 = 清 emoji 后的首句前 10 字')
  }

  console.log('\n⑥ 与渲染层对账（防两边契约漂移）')
  {
    const vfSrc = readFileSync(join(__dirname, '..', 'src/lib/agent/vf/vf-video.ts'), 'utf-8')
    const routeSrc = readFileSync(join(__dirname, '..', 'src/app/api/agent/chat/route.ts'), 'utf-8')
    const renderSrc = readFileSync(join(__dirname, '..', 'scripts/video-factory/render.py'), 'utf-8')
    ok(/from '\.\/banner'/.test(vfSrc), '图视混剪 vf-video.ts 引入 banner 模块')
    ok(/buildBanner\(/.test(vfSrc) && /bannerFieldOf\(/.test(vfSrc) && /planWithBanner\(/.test(vfSrc),
      '图视混剪：提炼 / 取字段 / 挂根级 三处都接上')
    ok(/from '@\/lib\/agent\/vf\/banner'/.test(routeSrc), '图片成片 chat/route.ts 引入 banner 模块')
    ok(/buildBanner\(/.test(routeSrc) && /bannerFieldOf\(/.test(routeSrc) && /planWithBanner\(/.test(routeSrc),
      '图片成片：提炼 / 取字段 / 挂根级 三处都接上')
    ok(/sb\.get\('banner'\)/.test(renderSrc), 'render.py 只从分镜【根级】读 banner（与 planWithBanner 契约对齐）')
    ok(/_bn\.get\('line1'\)[\s\S]*_bn\.get\('line2'\)/.test(renderSrc)
      || /l1 = str\(banner\.get\('line1'\)/.test(renderSrc), 'render.py 读 line1 / line2')
    ok(/'from'/.test(renderSrc) && /'to'/.test(renderSrc), 'render.py 读 from / to（镜号范围 → 秒）')
  }

  console.log(`\n===== 自测结果：${pass} 项通过，${fail} 项失败 =====\n`)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => { console.error('自测崩溃:', e); process.exit(1) })
