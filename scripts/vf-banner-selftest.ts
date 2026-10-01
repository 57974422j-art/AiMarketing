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
  // ★VF_BANNER_EMPTYLINE_V1（2026-10-01）：空行收口（用户报的"空色块"根因）
  bannerFieldLines, VF_BANNER_INVIS,
  // ★VF_SBDUMP_V2（2026-10-01）：出片/样板镜/留档共用的 plan 组装（唯一来源）
  buildVideoPlan, VF_PLAN_FPS,
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

/** ★VF_BANNER_EMPTYLINE_V1：取出 Python 里某个顶层函数**到下一个顶层定义为止**的函数体。
 *  为什么需要它：渲染层会持续改 `banner_layer` 的排版细节 —— 断言必须**只针对这段函数体**做
 *  语义判断，不能"贴死某一行的文本"，也不能牵到整文件（改别处就误红）。 */
function pyFunc(src: string, name: string): string {
  const i = src.indexOf('def ' + name + '(')
  if (i < 0) return ''
  const lines = src.slice(i).split(/\r?\n/)
  const out = [lines[0]]
  for (let k = 1; k < lines.length; k++) {
    if (/^(def |class |@)/.test(lines[k])) break
    out.push(lines[k])
  }
  return out.join('\n')
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
    // ★VF_SBDUMP_V2（2026-10-01）：第三处从"直接 planWithBanner"收口成 buildVideoPlan
    //   （其内部仍是 planWithBanner；覆盖面不减，反而多了"出片/留档同源"这层保证）
    ok(/buildBanner\(/.test(vfSrc) && /bannerFieldOf\(/.test(vfSrc) && /buildVideoPlan\(/.test(vfSrc),
      '图视混剪：提炼 / 取字段 / 挂根级(buildVideoPlan) 三处都接上')
    ok(/from '@\/lib\/agent\/vf\/banner'/.test(routeSrc), '图片成片 chat/route.ts 引入 banner 模块')
    ok(/buildBanner\(/.test(routeSrc) && /bannerFieldOf\(/.test(routeSrc) && /buildVideoPlan\(/.test(routeSrc),
      '图片成片：提炼 / 取字段 / 挂根级(buildVideoPlan) 三处都接上')
    ok(/sb\.get\('banner'\)/.test(renderSrc), 'render.py 只从分镜【根级】读 banner（与 planWithBanner 契约对齐）')
    // ★VF_BANNER_EMPTYLINE_V1（2026-10-01）：这条**从"贴死一行文本"改成"语义级"**
    //   （渲染层会持续改 banner_layer 的排版细节，贴死必红；旧正则就是因为这个红的 —— 功能没坏）。
    //   只断言我们商定的三条语义，并且**只在 banner_layer / _banner_clean 的函数体内**判：
    //     ① 逐行判空：line1 / line2 各自走 _banner_clean（剥不可见字符 + strip）；不可见字符不算"有字"
    //     ② 空行不产出任何滤镜：画第 1 行被 `if l1:` 包住、画第 2 行（box+text）被 `if l2:` 包住
    //     ③ 两行都无可见内容 → 返回空串（整块不生成 banner）
    {
      const body = pyFunc(renderSrc, 'banner_layer')
      const cleanFn = pyFunc(renderSrc, '_banner_clean')
      ok(body.length > 200, '取到 banner_layer 函数体（语义断言的作用域）', String(body.length))
      ok(/l1\s*=\s*_banner_clean\(\s*banner\.get\('line1'\)\s*\)/.test(body)
        && /l2\s*=\s*_banner_clean\(\s*banner\.get\('line2'\)\s*\)/.test(body),
        '① 逐行清洗判空：line1 / line2 各自过 _banner_clean')
      ok(/for\s+_ch\s+in\s+_BANNER_INVIS\s*:/.test(cleanFn) && /return\s+t\.strip\(\)/.test(cleanFn),
        '① _banner_clean = 剥 _BANNER_INVIS + strip()（零宽/BOM 不算"有字"）')
      ok(/if\s+l1\s*:/.test(body) && /if\s+l2\s*:/.test(body),
        '② 两行各自非空才产出滤镜（if l1: / if l2:）→ 空行不画框也不画字')
      // ⚠️ 这里**故意不用跨行正则**：`(?:[ \t]+[^\n]*\r?\n)*` 这种嵌套量词在长函数体上会指数级回溯
      //   （本机实测直接把自测卡死过一次）→ 改成"先定位这个 if，再看它后面 400 字里有没有 return ''"，
      //   线性、与 CRLF/LF 无关、也更不容易被渲染层的排版改动误伤。
      const iEmpty = body.indexOf('if not l1 and not l2:')
      const afterEmpty = iEmpty >= 0 ? body.slice(iEmpty, iEmpty + 400) : ''
      ok(iEmpty >= 0 && /return\s+''/.test(afterEmpty),
        '③ 两行都无可见内容 → 返回空串（整块不生成）')
      ok(/if\s+l1\s+else\s+y1/.test(body),
        '③ 只剩第 2 行时顶到 y1（不给"空第 1 行"留行距 —— 否则看着像漏了个框）')
    }
    ok(/'from'/.test(renderSrc) && /'to'/.test(renderSrc), 'render.py 读 from / to（镜号范围 → 秒）')
  }

  console.log('\n⑦ ★VF_BANNER_EMPTYLINE_V1：空行绝不许写进 plan（用户报的"空色块"根因）')
  {
    // ① 单行空（line2=''）→ plan 里**连 line2 键都没有**（渲染层无从画空框）
    {
      const f = bannerFieldOf({ pin: 'on', banner: { line1: 'AI营销系统30秒生成', line2: '' } })
      eq(f.banner, { line1: 'AI营销系统30秒生成', from: 1, to: 0 }, 'line2 为空 → plan 只写 line1')
      ok(!('line2' in (f.banner as any)), 'line2 键不存在（不是空串）')
    }
    // ② line1 空、line2 有值 → 非空行提到 line1（绝不留空槽）
    eq(bannerFieldOf({ pin: 'on', banner: { line1: '', line2: '30秒生成' } }).banner,
      { line1: '30秒生成', from: 1, to: 0 }, 'line1 为空 → 非空行提到 line1')
    // ③ 两行都空 → 不生成 banner
    eq(bannerFieldOf({ pin: 'on', banner: { line1: '', line2: '' } }), {}, '两行都空 → 不生成 banner')
    eq(bannerFieldOf({ pin: 'on', banner: { line1: '   ', line2: '  ' } }), {}, '全空白字符也算空 → 不生成')
    // ④ 手填单行 + 草稿另一行为空 → 仍然只写一行
    eq(bannerFieldOf({ pin: 'on', pin1: '手填第一行', banner: { line1: '旧标题', line2: '' } }).banner,
      { line1: '手填第一行', from: 1, to: 0 }, '手填一行 + 另一行为空 → 只写手填那行')
    // ⑤ 正常两行不受影响（与以前逐字一致）
    eq(bannerFieldOf({ pin: 'on', banner: { line1: '甲', line2: '乙' } }),
      { banner: { line1: '甲', line2: '乙', from: 1, to: 0 } }, '正常两行原样保留')
    // ⑥ buildBanner 侧同样不留空行：规则兜底时第 2 句只剩 emoji → 净化后为空
    {
      const { fn } = fakeGen(null)   // AI 不可用 → 走规则兜底
      const r = await buildBanner({ script: '真正的第一句。🚀', pin: 'on', generateText: fn })
      eq(r.field.banner, { line1: '真正的第一句', from: 1, to: 0 }, '兜底第 2 行净化后为空 → 只写第 1 行')
      ok(!!r.field.banner && !('line2' in (r.field.banner as any)), 'buildBanner 的 field 里没有空 line2')
      ok(r.notes.some((n) => n.includes('空行已滤掉')), '日志如实写明"空行已滤掉"：' + JSON.stringify(r.notes))
    }
    // ⑦ 序列化进 plan 后 line2 键消失 → 渲染层读不到 → 不画框
    {
      const plan = planWithBanner({ size: [1280, 720], shots: [] },
        bannerFieldOf({ pin: 'on', banner: { line1: '只有一行', line2: '' } }))
      const json = JSON.stringify(plan)
      ok(/"line1":"只有一行"/.test(json) && !/"line2"/.test(json), 'plan JSON 里没有 line2 键（空行不进渲染）')
    }
    // ⑧ 纯函数边界
    eq(bannerFieldLines('', ''), null, 'bannerFieldLines("","") = null')
    eq(bannerFieldLines('  ', '\u200b'), null, '零宽/空白也算空 → null')
    eq(bannerFieldLines('甲', ''), { line1: '甲' }, 'bannerFieldLines("甲","") = {line1:"甲"}')
    eq(bannerFieldLines('甲', '乙'), { line1: '甲', line2: '乙' }, 'bannerFieldLines 正常两行原样')
    // ⑨ 与渲染层对账：不可见字符表**逐字一致**（服务端原来漏了这一步 → 空行进 plan = 空色块）
    {
      const renderSrc = readFileSync(join(__dirname, '..', 'scripts/video-factory/render.py'), 'utf-8')
      const m = renderSrc.match(/_BANNER_INVIS\s*=\s*'([^']*)'/)
      const py = m ? m[1] : null
      // ⚠️ 不能用 JSON.stringify：U+200B 这类字符 JSON 不转义 → 自己拼 \uXXXX（小写十六进制，与 render.py 同形）
      const tsEsc = [...VF_BANNER_INVIS]
        .map((c) => '\\u' + (c.codePointAt(0) || 0).toString(16).padStart(4, '0')).join('')
      ok(!!py && py === tsEsc, 'render.py 的 _BANNER_INVIS 与服务端 VF_BANNER_INVIS 逐字一致',
        `py=${JSON.stringify(py)} / ts=${JSON.stringify(tsEsc)}`)
    }
  }

  console.log('\n⑧ ★VF_SBDUMP_V2：留档 = 渲染真正读的那一份 plan（唯一来源 + 三个落点都在）')
  {
    const vd = {
      size: [1280, 720], big: 'on', deckStyle: 'deck-soft',
      banner: { line1: 'AI营销系统30秒生成', line2: '30秒出片' }, theme: 'news', bgm: 'auto', voice: 'longxiaochun', dur: 60,
    }
    const shots = [{ type: 'title', text: '甲', dur: 3 }]
    const plan = buildVideoPlan(shots, vd, { sizeDefault: [1080, 1920] })
    eq(plan.size, [1280, 720], 'plan 根级 size = vd.size（有就用，不套默认）')
    eq(plan.fps, VF_PLAN_FPS, `plan 根级 fps = ${VF_PLAN_FPS}`)
    eq(plan.overlay_text, true, "big !== 'off' → overlay_text: true")
    eq(plan.deck_style, 'deck-soft', 'plan 根级 deck_style = 用户选的画面模版')
    eq(plan.banner, { line1: 'AI营销系统30秒生成', line2: '30秒出片', from: 1, to: 0 }, 'plan 根级 banner（钉全片）')
    ok(Array.isArray(plan.shots) && plan.shots.length === 1, 'plan.shots = 传入的分镜（同一对象，不是另拼一份）')
    ok(plan.shots[0] === shots[0], 'shots 是**同一个对象引用**（不是拷贝/重映射）')
    // 空行的 banner 不进 plan（与 ⑦ 同一条规矩，走的是同一个 bannerFieldOf）
    const p2 = buildVideoPlan([], { size: [720, 1280], banner: { line1: '只有一行', line2: '' } })
    ok(!("line2" in (p2.banner as any)) && p2.banner?.line1 === '只有一行', '空行的 banner 同样不进 plan')
    // 非法 deck_style → 'auto'（渲染层永远收到合法值）
    eq(buildVideoPlan([], { deckStyle: 'deck-xxx' }).deck_style, 'auto', '非法 deck_style → auto')
    eq(buildVideoPlan([], {}).size, [1080, 1920], '没给 size → 用 sizeDefault/兜底（不写 undefined）')
    // ── 三个落点（grep 断言：防"函数写了但没人用"）──
    const vfSrc = readFileSync(join(__dirname, '..', 'src/lib/agent/vf/vf-video.ts'), 'utf-8')
    const routeSrc2 = readFileSync(join(__dirname, '..', 'src/app/api/agent/chat/route.ts'), 'utf-8')
    const pageSrc = readFileSync(join(__dirname, '..', 'src/app/agent/page.tsx'), 'utf-8')
    const mainSrc = readFileSync(join(__dirname, '..', 'electron/main.js'), 'utf-8')
    const n = (s: string) => (s.match(/buildVideoPlan\(/g) || []).length
    ok(n(vfSrc) >= 2, `vf-video.ts：样板镜 + 出片都走 buildVideoPlan（${n(vfSrc) - 1} 处调用）`)
    ok(n(routeSrc2) >= 2, `route.ts：出片 + 留档载荷都走 buildVideoPlan（${n(routeSrc2) - 1} 处调用）`)
    ok(/sb:\s*sbPayload\(vd,\s*shots,\s*aspect\)/.test(routeSrc2), 'route.ts 确认卡带上 sb（VF_SBDUMP_V2 载荷）')
    ok(/sb:\s*\(vj as any\)\.sb/.test(pageSrc), 'page.tsx 把 sb 原样交给 vfSaveStoryboard')
    ok(/plan:\s*sb\s*\?\s*sb\.plan\s*:\s*null/.test(mainSrc), 'main.js 把 sb.plan 原样落盘（不是另拼一份）')
    ok(/version:\s*sb\s*\?\s*2\s*:\s*1/.test(mainSrc), 'main.js 写 version 2 / 缺 sb 回落 1（兼容 V1 读法）')
    // ★VF_SBDUMP_V2 载荷体积/兼容性核查（2026-10-01 team-lead 要求）
    // ① sb **只在视频确认卡**上挂（route.ts 里 `sb: sbPayload(` 只准出现 1 次 —— 别的卡片不挂）
    ok((routeSrc2.match(/sb:\s*sbPayload\(/g) || []).length === 1,
      'route.ts 里 sb 只挂 1 处（= 视频确认卡成功分支；表单/素材/文案卡都不挂）')
    // ② 旧客户端（main.js 没升级/不认 sb）→ sb 缺省为 null，写出来的仍是 V1 结构（逐字不变）
    ok(/const sb = \(p\.sb && typeof p\.sb === 'object'\) \? p\.sb : null/.test(mainSrc),
      'main.js：sb 非法/缺失 → null（旧行为，不抛错）')
    ok(/plan:\s*sb\s*\?\s*sb\.plan\s*:\s*null/.test(mainSrc)
      && /planRoot:\s*sb\s*\?\s*sb\.root\s*:\s*null/.test(mainSrc)
      && /shotsNorm:\s*sb\s*\?\s*sb\.shots\s*:\s*null/.test(mainSrc),
      'main.js：V1 结构里三个新键恒存在（缺 = null，键不省略）→ 老读法 JSON.parse 不受影响')
    ok(/Array\.isArray\(p\.shots\)/.test(mainSrc) && /if \(!shots\.length\) return \{ success: false/.test(mainSrc),
      'main.js：V1 的"没有分镜就不写盘"判据原样保留（旧行为逐字一致）')
    // ③ V1 留档仍能读：体检脚本必须带 V1 回退（j?.shots）—— 已用真 V1 留档实跑验证
    {
      const healthSrc = readFileSync(join(__dirname, 'vf-film-health.mjs'), 'utf-8')
      ok(/j\?\.shotsNorm/.test(healthSrc) && /Array\.isArray\(j\?\.shots\)/.test(healthSrc),
        'vf-film-health.mjs：读留档时 V2(plan/shotsNorm) 与 **V1(顶层 shots)** 两条路都在')
    }
    ok(/VF_SBDUMP_V2/.test(mainSrc) && /VF_SBDUMP_V2/.test(routeSrc2), '两边都标了 ★VF_SBDUMP_V2')
  }

  console.log(`\n===== 自测结果：${pass} 项通过，${fail} 项失败 =====\n`)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => { console.error('自测崩溃:', e); process.exit(1) })
