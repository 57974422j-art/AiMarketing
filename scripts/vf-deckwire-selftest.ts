/**
 * ★VF_DECK_WIRE_V1（2026-10-01）自测 —— 把「富编排 PPT 页（deck）」接进分镜链路
 *
 * 背景（用户拍板 + 原话）：
 *   渲染层 ★VF_DECK_V1 早已能把 `variant='deck'` 渲染成"一整页 PPT"（kicker 标签条 / 主标题 /
 *   副标 / 细分割线 / 2~4 条编号要点 / 数据卡 / 页码 / 页内进度线，分段入场 + 持续动效，**0 点成本**），
 *   用户的评价是「能做到这个效果啊」；要求原话：「就是做PPT也不可能一页就几个大字」。
 *   但服务端 `VF_VARIANTS.title` 里一直没有 deck 值 → AI 就算写了也会被 sanitizeAntiAiShots
 *   当非法值**删掉** → 这层能力对 AI 等于不存在。本次 = 白名单放行 + 提示词接线（两条线共用一份）。
 *
 * 本自测**纯函数、不联网、不烧钱、不碰数据库**，逐条断言：
 *   ① `VF_VARIANTS.title` 里 4 个 deck 值都在，且**顺序逐字** = 约定（center/left/chip + 4 个 deck）；
 *   ② `VF_DECK_PROMPT` 源码级硬规矩还在：什么时候用 / 什么时候不用 / 4 套风格怎么选 /
 *      items 2~4 条 / kicker ≤8 字 / text ≤12 字（防以后被谁删掉）；
 *   ③ 两条分镜线都真的 `+ VF_DECK_PROMPT +`（grep 断言，防"常量写了但没接线"）；
 *   ④ 白名单放行**没有把校验放宽**：非法 deck 值（deck-xxx / DECK / 拼错）仍被删；
 *      `deck` 写在**非 title 卡**上仍被删（variant 按卡型判）；
 *   ⑤ 4 个 deck 值的**合法性真由白名单决定**（sanitize 后仍保留原值，不被改写）。
 *
 * 跑法（项目根目录，Windows PowerShell / bash 均可）：
 *   npx ts-node --transpile-only -O '{"module":"commonjs","moduleResolution":"node"}' scripts/vf-deckwire-selftest.ts
 * 退出码：全部通过 = 0，有失败 = 1。
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { sanitizeAntiAiShots, VF_VARIANTS, VF_DECK_PROMPT,
  // ★VF_DECK_STYLES_V1（2026-10-01）：deck 风格 4 → 6 套 + 画面模版值归一化
  VF_DECK_STYLES, normalizeDeckStyle, deckStylePromptNote,
  // ★VF_NEIGHBOR_DEDUP_V1（2026-10-01）：相邻两镜同大字兜底
  dedupeAdjacentSameText } from '../src/lib/agent/vf/anti-ai'

let pass = 0
let fail = 0
function ok(cond: any, name: string, extra = '') {
  if (cond) { pass++; console.log('  ✅ ' + name) }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' → ' + extra : '')) }
}
function eq(a: any, b: any, name: string) {
  ok(JSON.stringify(a) === JSON.stringify(b), name, `实际 ${JSON.stringify(a)} / 期望 ${JSON.stringify(b)}`)
}

/** ★VF_DECK_STYLES_V1（2026-10-01）：deck 风格从 **4 套扩到 6 套**（新增 deck-glass / deck-soft）。
 *  顺序即契约（前 4 位不变，新值追加在后，与 render.py TITLE_VARIANTS 逐字一致）。 */
const DECK6 = ['deck', 'deck-grad', 'deck-mono', 'deck-mag', 'deck-glass', 'deck-soft']
/** 旧的 4 套（保留给"前 4 位顺序未变"与"非 deck 卡型仍删"等断言） */
const DECK4 = DECK6.slice(0, 4)
const EXPECTED_TITLE = ['center', 'left', 'chip', ...DECK6]

const root = process.cwd()

console.log('\n① VF_VARIANTS.title：6 个 deck 值都在，且顺序逐字一致（center/left/chip + 6 deck = 9 值）')
{
  eq(VF_VARIANTS.title, EXPECTED_TITLE, 'title 白名单 = center/left/chip + 6 个 deck（顺序一致）')
  const extra = VF_VARIANTS.title.filter((v) => !EXPECTED_TITLE.includes(v))
  ok(extra.length === 0, '白名单里没有多余值', extra.join('/'))
  ok(DECK6.every((v) => VF_VARIANTS.title.includes(v)), '6 个 deck 值全部命中：' + DECK6.join(' / '))
  eq(VF_VARIANTS.title.slice(0, 4), ['center', 'left', 'chip', 'deck'], '前 4 位顺序未变（center/left/chip/deck）')
  // ★VF_DECK_STYLES_V1：素材镜（bgimage/video）同样放行全部 6 个 deck 值
  eq(VF_VARIANTS.bgimage, DECK6, 'bgimage 白名单 = 6 个 deck 值（顺序一致）')
  eq(VF_VARIANTS.video, DECK6, 'video 白名单 = 6 个 deck 值（顺序一致）')
  // 别的卡型的白名单**一个都不许动**（并发期防误伤）
  eq(VF_VARIANTS.list, ['steps', 'stack'], 'list 白名单未被改动')
  eq(VF_VARIANTS.compare, ['split', 'bar'], 'compare 白名单未被改动')
}

console.log('\n①b ★VF_DECK_STYLES_V1：「🎨 画面模版」的值归一化（非法/缺省 → auto）')
{
  eq(VF_DECK_STYLES, ['auto', ...DECK6], 'VF_DECK_STYLES = auto + 6 个 deck 风格（顺序即契约）')
  for (const v of ['auto', ...DECK6]) ok(normalizeDeckStyle(v) === v, `normalizeDeckStyle('${v}') 原样返回`)
  ok(normalizeDeckStyle('DECK-GLASS') === 'deck-glass', '大小写归一（toLowerCase，与 theme/variant 同款）')
  for (const bad of ['', null, undefined, 'deck-xxx', 'DECK2', 'deckstyle', '经典']) {
    ok(normalizeDeckStyle(bad as any) === 'auto', `非法/缺省值 ${JSON.stringify(bad)} → 'auto'`)
  }
  ok(normalizeDeckStyle(123 as any) === 'auto', '数字等非字符串类型 → \'auto\'')
}

console.log('\n② VF_DECK_PROMPT：硬规矩源码级仍在（防被删）')
{
  const must = [
    ['什么时候用', '写了【什么时候用】'],
    ['什么时候不用', '写了【什么时候不用】'],
    // ★VF_DECK_STYLES_V1（2026-10-01）：风格从 4 套扩到 6 套
    ['6 套风格怎么选', '写了【6 套风格怎么选】'],
    ['items 2~4 条', '硬规矩：items 2~4 条'],
    ['kicker ≤8', '硬规矩：kicker ≤8 字'],
    ['text ≤12', '硬规矩：text ≤12 字'],
    ['空壳 deck 页', '警示：只给 text 会成"空壳 deck 页"'],
    // ★VF_DECK_STYLES_V1（2026-10-01）：口径放宽 —— 旧断言"每 4~6 镜里最多 1~2 镜"已被用户实测推翻
    //   （20261001_004 那条片 AI 只敢第 1 镜用 deck、后面 12 镜全是普通卡 → 用户「方向对了」但频率太低）。
    ['不要连续 3 镜', '节奏：只要求「不要连续 3 镜用 deck」（其余没有上限）'],
    // 6 套风格的触发条件必须逐套写清（避免 AI 乱挑）
    ['deck-grad', 'deck-grad 触发条件在'],
    ['deck-mono', 'deck-mono 触发条件在'],
    ['deck-mag', 'deck-mag 触发条件在'],
    ['deck-glass', 'deck-glass 触发条件在'],
    ['deck-soft', 'deck-soft 触发条件在'],
  ] as Array<[string, string]>
  for (const [needle, name] of must) ok(VF_DECK_PROMPT.includes(needle), name, `缺「${needle}」`)
  // 字段示例必须真的给全（kicker / items / value+suffix+label）
  ok(/items"/.test(VF_DECK_PROMPT) && /"kicker":"/.test(VF_DECK_PROMPT) && /"value":/.test(VF_DECK_PROMPT)
    && /"suffix":/.test(VF_DECK_PROMPT) && /"label":/.test(VF_DECK_PROMPT),
    '字段示例里 kicker / items / value+suffix+label 都给全了')
  ok(VF_DECK_PROMPT.length >= 300, `提示词有实质内容（${VF_DECK_PROMPT.length} 字）`)
}

console.log('\n③ 两条分镜线都真的接上了 VF_DECK_PROMPT（grep 断言）')
{
  const antiSrc = readFileSync(join(root, 'src/lib/agent/vf/anti-ai.ts'), 'utf-8')
  const vvSrc = readFileSync(join(root, 'src/lib/agent/vf/vf-video.ts'), 'utf-8')
  const rtSrc = readFileSync(join(root, 'src/app/api/agent/chat/route.ts'), 'utf-8')
  ok(/★VF_DECK_WIRE_V1/.test(antiSrc), 'anti-ai.ts 有 ★VF_DECK_WIRE_V1 标记（含"为什么+用户原话"）')
  ok(/export const VF_DECK_PROMPT/.test(antiSrc), 'anti-ai.ts 导出了 VF_DECK_PROMPT')
  const lines = [[vvSrc, '图视混剪 vf-video.ts'], [rtSrc, '图片成片 chat/route.ts']] as Array<[string, string]>
  for (const [src, name] of lines) {
    ok(/VF_DECK_PROMPT\s*\+/.test(src), `${name} 的 prompt 里拼了 VF_DECK_PROMPT`)
    // ★2026-10-01：import 块里 VF_DECK_PROMPT 之后多了几行注释（dedupeAdjacentSameText / deckStylePromptNote），
    //   窗口从 {0,200} 放宽到 {0,700} —— 断言本身（"确实 import 了 VF_DECK_PROMPT"）不变。
    ok(/import\s*\{[\s\S]{0,800}?VF_DECK_PROMPT[\s\S]{0,700}?\}\s*from/.test(src),
      `${name} 从 anti-ai 里 import 了 VF_DECK_PROMPT`)
  }
}

console.log('\n④ 白名单放行没有把校验放宽（非法值/错卡型仍被丢）')
{
  const run = (s: any) => sanitizeAntiAiShots([s]).shots[0]
  //   ⚠️ 'DECK' 不在这里 —— 服务端会 toLowerCase 归一，它其实是**合法**的（下面单独断言）
  for (const bad of ['deck-xxx', 'deck2', 'deckgrad', 'deck-', '', 'deckstyle', 'richdeck']) {
    const r = run({ type: 'title', text: '标题', variant: bad })
    ok(r.variant === undefined, `非法 variant「${bad || '(空)'}」仍被删掉`, JSON.stringify(r))
  }
  // 大小写：服务端会 toLowerCase 归一 → 'DECK' 归一后是 'deck'，属**合法**（与其它白名单字段一致）
  const up = run({ type: 'title', text: '标题', variant: 'DECK' })
  ok(up.variant === 'deck', 'variant="DECK" → 归一化成 "deck"（与 theme/motion 同款 toLowerCase 行为）')
  // variant 按【这一镜最终的卡型】判。
  // ★2026-10-01 team-lead 修正（my own spec change，不是放宽）：
  //   **素材镜（bgimage / video）现在也放行 deck 系列** —— 渲染层 card_bgimage / card_video
  //   本来就有"deck 素材页"实现（横屏左图右文 / 竖屏上图下文）；原先白名单只定义 title/list/compare
  //   → AI 写的素材页 deck 被当非法删掉 → 素材页 deck 永远用不上（用户会以为"AI 说用了、出片却没变"）。
  //   规则：
  //     · deck 系列 + title        → 保留（纯文字页）
  //     · deck 系列 + bgimage/video → 保留 + **自动补 frame='thin'**（不补的话非编辑风主题会回落老版式）
  //     · deck 系列 + list/compare/end/number → 仍删（渲染层没有对应实现，宁缺勿假）
  //     · **非 deck 的值**（center/left/chip/steps/split…）+ 素材镜 → 仍删（它们是纯文字卡的版式）
  //   ⚠️ subtitle 里带数字，免得 number/chart 卡先被"假数据兜底"降级成 title（那是另一条规则）
  for (const t of ['list', 'compare', 'end', 'number']) {
    const r = run({ type: t, variant: 'deck', items: ['a', 'b'], text: 'x', subtitle: '增长 10%' })
    ok(r.variant === undefined, `variant="deck" 写在 ${t} 卡上仍被删（渲染层无对应实现）`, JSON.stringify(r))
  }
  // 素材镜：deck 保留 + 自动补 frame
  for (const t of ['bgimage', 'video']) {
    const r = run({ type: t, variant: 'deck', items: ['a', 'b'], text: 'x', subtitle: '增长 10%' })
    ok(r.variant === 'deck', `variant="deck" 写在 ${t} 卡上【保留】（deck 素材页）`, JSON.stringify(r))
    ok(r.frame === 'thin', `${t} + deck 未写 frame → 自动补 'thin'（否则非编辑风主题回落老版式）`, JSON.stringify(r))
    const r2 = run({ type: t, variant: 'deck-mag', frame: 'none', items: ['a', 'b'], text: 'x', subtitle: '增长 10%' })
    ok(r2.frame === 'none', `${t} + deck 已显式写 frame='none' → 【不覆盖】`, JSON.stringify(r2))
  }
  // 非 deck 的版式值写在素材镜上 → 仍删（没有放宽）
  for (const t of ['bgimage', 'video']) {
    const r = run({ type: t, variant: 'center', text: 'x', subtitle: '增长 10%' })
    ok(r.variant === undefined, `variant="center" 写在 ${t} 卡上仍被删（它只是纯文字卡的版式）`, JSON.stringify(r))
  }
  // 4 个合法值全部原样保留（不被改写）
  for (const v of DECK4) {
    const r = run({ type: 'title', text: '标题', subtitle: '副标', variant: v })
    ok(r.variant === v, `合法 variant「${v}」原样保留`)
  }
}

console.log('\n⑤ 参考：渲染层对账（不算本自测失败，归 vf-i2v-selftest.ts 硬对账）')
{
  try {
    const renderSrc = readFileSync(join(root, 'scripts/video-factory/render.py'), 'utf-8')
    const m = renderSrc.match(/DECK_VARIANTS\s*=\s*\(([^)]*)\)/)
    const py = m ? m[1].split(',').map((x) => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean) : null
    // ★VF_DECK_STYLES_V1（2026-10-01）：约定值从 4 套升到 6 套（与 VF_VARIANTS 三处对齐）
    if (py && JSON.stringify(py) === JSON.stringify(DECK6)) {
      console.log('  ✅ render.py DECK_VARIANTS 已跟上：' + py.join(' / '))
    } else {
      console.log('  ⚠️ render.py DECK_VARIANTS 尚未跟上：当前 ' + JSON.stringify(py)
        + ' / 约定 ' + JSON.stringify(DECK6) + '（并发中，由 team-lead 对账；不算本自测失败）')
    }
  } catch (e: any) {
    console.log('  ⚠️ 读不到 render.py（' + String(e?.message || e).slice(0, 60) + '）—— 跳过参考项')
  }
}

console.log('\n⑥ ★VF_DECK_STYLES_V1：提示词新口径（源码级断言 —— 防以后被改回保守版）')
{
  ok(!VF_DECK_PROMPT.includes('最多 1~2 镜'), '提示词里已无旧口径「最多 1~2 镜」')
  ok(!VF_DECK_PROMPT.includes('每 4~6 镜里最多'), '提示词里已无旧口径「每 4~6 镜里最多」')
  ok(VF_DECK_PROMPT.includes('不要连续 3 镜'), '提示词新口径「不要连续 3 镜」在')
  ok(/【6 套风格怎么选】/.test(VF_DECK_PROMPT), '标题已是【6 套风格怎么选】')
  ok(VF_DECK_PROMPT.includes('deck-glass') && VF_DECK_PROMPT.includes('deck-soft'),
    '新增 2 套风格名（deck-glass / deck-soft）已写进提示词')
  ok(deckStylePromptNote('auto') === '' && deckStylePromptNote(undefined) === '' && deckStylePromptNote('') === '',
    "deckStylePromptNote('auto'|'') = 空串（等于没加，保持 AI 自选现状）")
  ok(deckStylePromptNote('deck-soft').includes('deck-soft')
    && deckStylePromptNote('deck-soft').includes('必须用'), '指定值时提示词加一句「必须用用户选的」')
}

console.log('\n⑦ ★VF_NEIGHBOR_DEDUP_V1：相邻同大字兜底（纯函数逐条断言）')
{
  const big = (s: any) => String(s?.text ?? s?.title ?? '')
  // ① 相邻同 text → 只改后一镜；优先用 kicker
  {
    const r = dedupeAdjacentSameText([
      { type: 'title', text: '智能营销方案', subtitle: '第一句文案。第二句。' },
      { type: 'bgimage', text: '智能营销方案', kicker: '要点', subtitle: '后半句文案。' },
    ])
    ok(big(r.shots[0]) === '智能营销方案', '前一镜【不动】')
    ok(big(r.shots[1]) === '要点', '后一镜改用它的 kicker：' + big(r.shots[1]))
    ok(r.notes.length === 1 && /第 1\/2 镜/.test(r.notes[0]), 'notes 写清改了哪两镜：' + r.notes[0])
    const r2 = dedupeAdjacentSameText(r.shots)
    ok(r2.notes.length === 0, '改完再跑一次 0 改动（幂等）')
  }
  // ② 没有 kicker/label → 用 subtitle 首句前 10 字
  {
    const r = dedupeAdjacentSameText([
      { type: 'title', text: '效率提升' },
      { type: 'title', text: '效率提升', subtitle: '真正拉开差距的是流程。第二句。' },
    ])
    ok(big(r.shots[1]) === '真正拉开差距的是流程', '回退到 subtitle 首句前 10 字：' + big(r.shots[1]))
  }
  // ③ A A A 三连排 → 第二个、第三个都改
  {
    const r = dedupeAdjacentSameText([
      { type: 'title', text: 'A' },
      { type: 'title', text: 'A', subtitle: '第二镜的话。' },
      { type: 'title', text: 'A', subtitle: '第三镜的话。' },
    ])
    ok(big(r.shots[1]) !== 'A' && big(r.shots[2]) !== 'A', 'A/A/A → 第 2、第 3 镜都被改')
    ok(r.notes.length === 2, 'notes 记了两处改动')
  }
  // ④ 空 / 只有一镜 / 非相邻 → 不动
  eq(dedupeAdjacentSameText([]).shots, [], '空数组原样返回')
  eq(dedupeAdjacentSameText([{ type: 'title', text: 'A' }]).shots.length, 1, '只有一镜 → 不动')
  {
    const r = dedupeAdjacentSameText([
      { type: 'title', text: 'A' }, { type: 'title', text: 'B' }, { type: 'title', text: 'A' },
    ])
    ok(r.notes.length === 0 && big(r.shots[2]) === 'A', '非相邻（A B A）→ 不动')
  }
  // ⑤ 无可替换文案 → 保留原样、不硬造
  {
    const r = dedupeAdjacentSameText([{ type: 'title', text: 'A' }, { type: 'title', text: 'A' }])
    ok(r.notes.length === 0 && big(r.shots[1]) === 'A', '无 kicker/label/subtitle → 保留原样（宁缺勿假）')
  }
  // ⑥ 一字不丢：subtitle 原样
  {
    const sub = '这句字幕一个字都不能少，标点也在。'
    const r = dedupeAdjacentSameText([{ type: 'title', text: 'X' }, { type: 'title', text: 'X', subtitle: sub }])
    ok(r.shots[1].subtitle === sub, 'subtitle 一字不丢（原样返回）')
  }
  // ⑦ title 也参与比对（text 为空时取 title）
  {
    const r = dedupeAdjacentSameText([
      { type: 'list', title: '三大能力', items: ['a'] },
      { type: 'list', title: '三大能力', items: ['b'], subtitle: '第二镜的说明句。' },
    ])
    ok(String(r.shots[1].title) !== '三大能力' && r.shots[0].title === '三大能力',
      'text 为空时用 title 比对（前一镜不动 / 后一镜被改）')
  }
}

console.log('\n⑧ ★VF_NEIGHBOR_DEDUP_V1 / ★VF_DECK_STYLES_V1：三处调用点与 deck_style 链路（grep）')
{
  const vv = readFileSync(join(root, 'src/lib/agent/vf/vf-video.ts'), 'utf-8')
  const rt = readFileSync(join(root, 'src/app/api/agent/chat/route.ts'), 'utf-8')
  const cnt = (s: string) => (s.match(/dedupeAdjacentSameText\(/g) || []).length
  ok(/import\s*\{[\s\S]{0,900}?dedupeAdjacentSameText[\s\S]{0,300}?\}\s*from/.test(vv),
    'vf-video.ts 从 anti-ai import 了 dedupeAdjacentSameText')
  ok(/import\s*\{[\s\S]{0,900}?dedupeAdjacentSameText[\s\S]{0,300}?\}\s*from/.test(rt),
    'route.ts 从 anti-ai import 了 dedupeAdjacentSameText')
  ok(cnt(vv) >= 1, `vf-video.ts 真的调用了 dedupeAdjacentSameText（${cnt(vv)} 处）`)
  ok(cnt(rt) >= 2, `route.ts 两批都调用了 dedupeAdjacentSameText（${cnt(rt)} 处）`)
  // deck_style → plan 根级（★VF_SBDUMP_V2 起收口到 banner.ts 的 buildVideoPlan —— 唯一来源，
  //   两条线的出片与"本地留档"都走它；所以这里改断言 banner.ts + 两条线都在调它）
  {
    const bn = readFileSync(join(root, 'src/lib/agent/vf/banner.ts'), 'utf-8')
    ok(/deck_style:\s*normalizeDeckStyle\(vd\?\.deckStyle\)/.test(bn),
      'banner.ts 的 buildVideoPlan：plan 根级带 deck_style（normalizeDeckStyle 归一）')
    ok(/export function buildVideoPlan\(shots: any\[\], vd: any/.test(bn),
      'banner.ts 导出 buildVideoPlan（出片/样板镜/留档共用）')
    ok(/buildVideoPlan\(vd\.shots,\s*vd/.test(vv), 'vf-video.ts：用 buildVideoPlan 组 plan')
    ok(/buildVideoPlan\(vd\.shots,\s*vd/.test(rt), 'route.ts：用 buildVideoPlan 组 plan')
  }
  ok(/deckStylePromptNote\(vd\.deckStyle\)/.test(vv), 'vf-video.ts 提示词拼了 deckStylePromptNote')
  ok(/deckStylePromptNote\(o\.deckStyle\)/.test(rt), 'route.ts 提示词拼了 deckStylePromptNote')
  ok(/if \(f\.deckStyle !== undefined\) vd\.deckStyle = normalizeDeckStyle/.test(vv),
    'vf-video.ts：表单解析带 deckStyle（白名单归一）')
  ok(/if \(f\.deckStyle !== undefined\) vd\.deckStyle = normalizeDeckStyle/.test(rt),
    'route.ts：表单解析带 deckStyle（白名单归一）')
  ok(/deckStyle\?: string/.test(vv), 'vf-video.ts 的 VfVideoDraft 有 deckStyle 字段')
}

console.log(`\n${pass} 项通过 / ${fail} 项失败`)
process.exit(fail ? 1 : 0)
