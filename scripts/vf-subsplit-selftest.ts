/**
 * ★VF_SUBSPLIT_V1（2026-09-30）自测 —— 单镜字幕上限 + 超长「按句拆镜」
 *
 * 用户实测原话：「看下错误，90 秒的样子 AI 把字幕都放在一起。为什么 30 秒的片子字幕不够用，
 *              90 秒的片子字幕好像溢出了。」
 * 事故数据（客户端留档 vf-20260930-140126-u1.json）：10 镜 / 计划 49.0 秒，成片 121.68 秒；
 *   **第 10 镜 subtitle = 257 字**（其余 9 镜 25~42 字）—— AI 把整段剩余文案全塞进最后一镜。
 *
 * 本自测**纯函数、不联网、不烧钱、不碰数据库**，证明五件事：
 *   ① 257 字按句拆分 → 段数合理、**每段 ≤ 上限**、拼回来与原文字**完全相同**（含标点）；
 *   ② 无标点长句 → 按字数硬切，仍**一字不丢**；
 *   ③ 拆分后「覆盖文案」不降（≥80% 闸门照样过）；拆镜不改变总字数；
 *   ④ 每个新镜 dur 之和 = 原 dur（可行时）、每段 ≥ 2 秒；不可行时如实抬总时长并在说明里写明；
 *   ⑤ 防回退 grep：★I2V_BILL_V1 / ★VF_TMPCLEAN_V1 / ★VF_WDCLEAN_V1 / ★VF_POOL_V1 /
 *      ★VF_FILTERJOIN_V1 各 ≥1 处仍在（这几处是队友的"钱/垃圾"修复，绝不许被误删）。
 *
 * 跑法（项目根目录）：
 *   npx ts-node --transpile-only -O '{"module":"commonjs","moduleResolution":"node"}' scripts/vf-subsplit-selftest.ts
 * 退出码：全部通过 = 0，有失败 = 1。
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  splitTextByCap, splitLongSubtitles, subCapFor,
  VF_SUB_MAX, VF_SUB_CPS, VF_SUB_SHOT_MIN_SEC,
  // ★VF_LINEBREAK_V2（2026-10-01）：中文避头尾（字幕断行）
  wrapWithKinsoku, pickKinsokuCut, isKinsokuCutOk,
  VF_KINSOKU_TAIL, VF_KINSOKU_HEAD, VF_KINSOKU_NOPAIR, VF_KINSOKU_BACK,
} from '../src/lib/agent/vf/anti-ai'

let pass = 0
let fail = 0
function ok(cond: any, name: string, extra = '') {
  if (cond) { pass++; console.log('  ✅ ' + name) }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' → ' + extra : '')) }
}
/** 数值/字符串等值断言（本套件原来只有 ok） */
function eqNum(a: any, b: any, name: string) {
  ok(a === b, name, `实际 ${JSON.stringify(a)} / 期望 ${JSON.stringify(b)}`)
}

/** ★2026-10-01：取出 Python 里某个顶层函数**到下一个顶层定义为止**的函数体。
 *  为什么：断言要"只针对这一段函数体"做语义判断（渲染层会持续改排版细节，贴死一行文本必红；
 *  扯到整文件则他改别处就误红）。⚠️ 别在本文件里写跨行嵌套量词（`(?:[^\n]*\n)*` 这种会指数级回溯）。 */
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
/** 剥掉 Python docstring（只留真代码）—— 判"代码里有没有省略号"时必须先剥，否则注释里的「…」会误判 */
function stripPyDoc(t: string): string {
  return t.replace(/"""[\s\S]*?"""/g, '""')
}

/** 真实留档 vf-20260930-140126-u1.json 第 10 镜的 subtitle（257 字，含标点） */
const LONG =
  '连建议话题标签都帮你配好。再看智能内容生成平台，它被称为爆款制造机。' +
  '左侧参数配置，中间预览区直接生成带有小红书标签的科技海报，右侧AI助手可以对话调优。' +
  '点击开始生成，系统自动匹配脑神经风格或芯片风格视觉封面。' +
  '还有整合营销方案模块，针对智能穿戴设备，它自动制定核心主题、渠道策略和促销机制，从生成到预约一气呵成。' +
  '最后是社交媒体文案与视觉生成工具。参数配置、文案生成、营销封面、AI助手四大功能区，' +
  '一键生成蓝色科技芯片海报，展示未来科技。你只需要点击下载使用，整个流程从零到一不到三分钟。' +
  'AI赋能未来营销，立即体验吧。'

const srcDir = process.cwd()

console.log('\n① 257 字按句拆分：每段 ≤ 上限 / 拼回来一字不差')
{
  ok(LONG.length >= 200, `留档长字幕已就位（${LONG.length} 字）`)
  // dur=5 → 上限 = min(60, ceil(5×4.3)=22) = 22
  const cap5 = subCapFor(5)
  ok(cap5 === 22, `dur=5 的上限 = 22 字（min(60, ceil(5×4.3))；实际 ${cap5}）`)
  const segs5 = splitTextByCap(LONG, cap5)
  ok(segs5.every((s) => s.length <= cap5 && s.length > 0), '每段都 ≤ 上限且非空')
  ok(segs5.join('') === LONG, '拼回来与原文字完全相同（含标点）', `${segs5.join('').length} vs ${LONG.length}`)
  ok(segs5.length >= Math.ceil(LONG.length / cap5), `段数 ≥ ceil(len/cap) = ${Math.ceil(LONG.length / cap5)}（实际 ${segs5.length}）`)
  // dur=60 → 上限 60 → 段数应明显更少
  const cap60 = subCapFor(60)
  ok(cap60 === VF_SUB_MAX, `dur=60 的上限被夹到硬上限 ${VF_SUB_MAX}（实际 ${cap60}）`)
  const segs60 = splitTextByCap(LONG, cap60)
  ok(segs60.every((s) => s.length <= cap60), 'dur=60：每段 ≤ 60 字')
  ok(segs60.join('') === LONG, 'dur=60：拼回来一字不差')
  ok(segs60.length >= Math.ceil(LONG.length / cap60), `dur=60：段数 ≥ ${Math.ceil(LONG.length / cap60)}（实际 ${segs60.length}）`)
}

console.log('\n② 无标点长句 → 按字数硬切，仍一字不丢')
{
  const noPunc = '啊'.repeat(100)                       // 没有任何标点，整段一个长句
  const cap = subCapFor(60)                             // 60
  const segs = splitTextByCap(noPunc, cap)
  ok(segs.every((s) => s.length <= cap), '硬切后每段 ≤ 上限')
  ok(segs.join('') === noPunc, '硬切后拼回来一字不丢')
  ok(segs.length === Math.ceil(100 / cap), `硬切段数 = ${Math.ceil(100 / cap)}（实际 ${segs.length}）`)
  // 边界：正文里带 { } \ 这类 ASS 元字符，也要原样保留（转义交给渲染层）
  const weird = '{括号}' + '啊'.repeat(30) + '\\反斜杠'
  ok(splitTextByCap(weird, cap).join('') === weird, '含 ASS 元字符的正文一字不差')
}

console.log('\n③ 拆镜后「覆盖文案」不降（≥80% 闸门照过）')
{
  // 模拟服务端口径：文案 = 全部字幕之和；拆镜只切片、不改总字数
  const before = LONG.length
  const { shots } = splitLongSubtitles([{ type: 'bgimage', src: '/a.jpg', text: '立即体验', subtitle: LONG, dur: 5 }])
  const after = shots.reduce((a: number, s: any) => a + String(s.subtitle || '').length, 0)
  ok(after === before, `拆镜前后总字数一致（${before} → ${after}）`)
  const cover = after / LONG.length
  ok(cover >= 0.8, `覆盖 ${Math.round(cover * 100)}% ≥ 80%（闸门通过）`)
  // 上限按【原镜 dur】算（新镜的 dur 只是 tts 前的占位：tts.py 会按真实配音回填 dur，
  // 所以不能拿"新 dur（可能是 2 秒下限）"去反推每镜上限 —— 那会自相矛盾）。
  ok(shots.every((s: any) => String(s.subtitle).length <= subCapFor(5)),
    `拆出的每一镜字幕 ≤ 原镜上限 ${subCapFor(5)} 字`)
}

console.log('\n④ dur 分配：总和 = 原 dur（可行时）、每段 ≥ 2 秒')
{
  // 可行：原 dur=60 ≥ 段数×2 → 总和必须精确等于 60
  const { shots: s60 } = splitLongSubtitles([{ type: 'title', text: '长镜', subtitle: LONG, dur: 60 }])
  const sum60 = s60.reduce((a: number, s: any) => a + Number(s.dur || 0), 0)
  ok(Math.abs(sum60 - 60) < 0.011, `dur=60 拆分后各段之和 = 60（实际 ${Math.round(sum60 * 100) / 100}）`)
  ok(s60.every((s: any) => Number(s.dur) >= VF_SUB_SHOT_MIN_SEC - 1e-9), `每段 ≥ ${VF_SUB_SHOT_MIN_SEC} 秒`)
  ok(s60.length > 1, `确实拆成了多镜（${s60.length} 镜）`)
  ok(s60.every((s: any) => s.type === 'title' && s.text === '长镜'), '卡型/画面/大字等字段被继承（只换 subtitle+dur）')

  // 不可行：原 dur=5 < 段数×2 → 抬总时长，并在说明里写明
  const r5 = splitLongSubtitles([{ type: 'bgimage', src: '/a.jpg', text: '立即体验', subtitle: LONG, dur: 5 }])
  const sum5 = r5.shots.reduce((a: number, s: any) => a + Number(s.dur || 0), 0)
  ok(sum5 >= r5.shots.length * VF_SUB_SHOT_MIN_SEC - 1e-9, `每段 ≥2 秒优先：总和抬到 ${Math.round(sum5 * 100) / 100}（段数×2 = ${r5.shots.length * 2}）`)
  ok(r5.notes.length === 1 && r5.notes[0].includes('按句拆成') && r5.notes[0].includes('文案 0 丢失'),
    '处理说明格式正确', r5.notes[0] || '(无说明)')
  ok(r5.notes[0].includes(`第 1 镜字幕 ${LONG.length} 字`), '说明里如实写了原镜字数')

  // 未超上限的镜：原样返回（同一对象引用，不动任何字段）
  const normal = { type: 'bgimage', src: '/b.jpg', text: '正常', subtitle: '这是一句正常的短字幕。', dur: 5 }
  const rn = splitLongSubtitles([normal])
  ok(rn.shots.length === 1 && rn.shots[0] === normal, '未超上限的镜原样返回（零改动）')
}

console.log('\n⑤ 防回退 grep（队友的"钱/垃圾/滤镜"修复 + 本轮新增标记）')
{
  const read = (p: string) => readFileSync(join(srcDir, p), 'utf8')
  const routeSrc = read('src/app/api/agent/chat/route.ts')
  const vtmSrc = read('src/lib/video-task-manager.ts')
  const renderSrc = read('scripts/video-factory/render.py')
  const makeSrc = read('scripts/video-factory/make.py')
  const antiSrc = read('src/lib/agent/vf/anti-ai.ts')
  const vfvSrc = read('src/lib/agent/vf/vf-video.ts')

  ok(routeSrc.includes('★I2V_BILL_V1'), '★I2V_BILL_V1 仍在 route.ts（按真实秒数计费）')
  ok(routeSrc.includes('★VF_TMPCLEAN_V1'), '★VF_TMPCLEAN_V1 仍在 route.ts（抽帧后清 tmp 源视频）')
  ok(vtmSrc.includes('★VF_WDCLEAN_V1'), '★VF_WDCLEAN_V1 仍在 video-task-manager.ts（失败也清工作目录）')
  ok(routeSrc.includes('★VF_POOL_V1'), '★VF_POOL_V1 仍在 route.ts（素材池治理）')
  ok(renderSrc.includes('★VF_FILTERJOIN_V1'), '★VF_FILTERJOIN_V1 仍在 render.py（拼滤镜前丢空串）')
  ok(makeSrc.includes('★I2V_REAL:'), '★I2V_REAL: 仍在 make.py（真实成功张数/秒数日志）')

  ok(antiSrc.includes('★VF_SUBSPLIT_V1'), '★VF_SUBSPLIT_V1 在 anti-ai.ts（本轮的共享纯函数）')
  ok(vfvSrc.includes('★VF_SUBSPLIT_V1'), '★VF_SUBSPLIT_V1 在 vf-video.ts（视频混剪线兜底）')
  ok(routeSrc.includes('★VF_SUBSPLIT_V1'), '★VF_SUBSPLIT_V1 在 route.ts（素材线兜底）')
  ok(renderSrc.includes('★VF_SUBSPLIT_V1'), '★VF_SUBSPLIT_V1 在 render.py（字幕 ≤2 行兜底）')
  ok(renderSrc.includes('_sub_rows('), 'render.py 有 _sub_rows（字幕行数/字号的降级链实现）')
  // ═══ ★VF_SUBTITLE_NOELLIPSIS_V1（2026-10-01）：旧断言 "render.py 有『已按最多 2 行压缩显示』日志"
  //   已**过期**（那条日志文本随"删掉「…」截断"一起改口径了）→ 改成**语义级 + 确定性**断言：
  //     ① 截断路径**真的不存在**（剥掉 docstring/注释后，代码里一个省略号都没有；旧的 `[:-1]` 也没了）
  //     ② 降级链在：先 2 行 → 再 3 行（hard = max(max_lines,3)）→ 缩字号（safe/cpl，带 fs_floor 下限）
  //     ③ 一字不丢：折行循环推进到末尾 + 只做原文连续切片（拼回 === 原文）
  //     ④ 日志口径必须是"★不截断、不丢字"，旧口径必须消失
  //   ⚠️ 只在这三个函数体里判（不扯整文件）；已逐条对着 render.py L646-743 的现码核过（不是"为变绿放水"）。
  {
    const bodies = ['_sub_rows', 'wrap_subtitle', '_kin_rows'].map((n) => pyFunc(renderSrc, n))
    const code = bodies
      .map(stripPyDoc)
      .join('\n')
      .split(/\r?\n/)
      .filter((l) => !/^\s*#/.test(l))          // 去掉整行注释
      .join('\n')
    ok(bodies.every((b) => b.length > 120), '取到字幕折行的三个函数体（断言作用域）',
      bodies.map((b) => b.length).join('/'))
    ok(!/…/.test(code), '① 代码里已无「…」→ 截断路径**确实被删**（不是改名/换字符串）')
    ok(!/\[:-1\]/.test(code), '① 旧"砍掉末字给省略号腾位"的 `[:-1]` 也不存在')
    ok(/hard\s*=\s*max\(\s*max_lines\s*,\s*3\s*\)/.test(code), '② 降级链：行数放宽到 3（hard = max(max_lines, 3)）')
    ok(/for\s+nl\s+in\s+range\(max_lines,\s*hard\s*\+\s*1\)/.test(code), '② 目标行数逐个试（2 → 3）')
    ok(/fs_floor\s*=\s*max\(\s*1\s*,\s*int\(base_fs\s*\*\s*float\(min_ratio\)\s*\)\s*\)/.test(code)
      && /int\(safe\s*\/\s*cpl\)/.test(code), '② 降级链：缩字号（safe/cpl）+ 有 fs_floor 下限')
    ok((code.match(/while i < len\(s\):/g) || []).length >= 2, '③ 折行循环推进到末尾（while i < len(s)）')
    ok((code.match(/rows\.append\(s\[i:end\]\)/g) || []).length >= 2, '③ 只做原文连续切片 → 拼回 === 原文（一字不丢）')
    ok(renderSrc.includes('★不截断、不丢字'), '④ 日志口径已改成"★不截断、不丢字"')
    ok(!/最多 2 行压缩显示/.test(renderSrc), '④ 旧的"最多 2 行压缩显示"口径已不存在（改了就必须同步这条）')
  }
  ok(antiSrc.includes('每镜字幕 ≤ 60 字'), 'ANTI_AI_PROMPT 已写「每镜字幕 ≤ 60 字」规矩')
}

console.log('\n⑥ ★VF_LINEBREAK_V2：中文避头尾（虚词/标点/数字单位/成对词不许落在断口）')
{
  // ① 用户实测那条（帧 full_t0170.png）：不得断成「…就是AI一键生 | 成的…」
  {
    const s = '图里这款手表海报，就是AI一键生成的，点击率预测高达8.5%，'
    const rows = wrapWithKinsoku(s, 16, 2)
    ok(rows.join('') === s, '折行一字不减（拼回原文）')
    ok(rows.every((r) => r.length <= 16), `每行 ≤ 16 字（实际 ${rows.map((r) => r.length).join('/')}）`)
    ok(!/一键生$/.test(rows[0]), `不得断成「…一键生 | 成…」（实际 ${JSON.stringify(rows)}）`)
    ok(rows.join('').includes('8.5%'), '8.5% 保持完整（数字+百分号不被拆）')
  }
  // ② 规则表本身
  ok(VF_KINSOKU_TAIL.includes('的') && VF_KINSOKU_TAIL.includes('你我他'), '行尾禁则含虚词表（的/你/我/他…）')
  ok(VF_KINSOKU_HEAD.includes('，') && VF_KINSOKU_HEAD.includes('。') && VF_KINSOKU_HEAD.includes('》'),
    '行首禁则含收尾标点/括号（。，》…）')
  ok(VF_KINSOKU_NOPAIR.includes('生成'), '成对词表含「生成」（用户点名，宁缺勿假）')
  ok(VF_KINSOKU_BACK === 4, `最多回退 ${VF_KINSOKU_BACK} 字（用户定案 3~4 字）`)
  // ③ 逐类切口判定（s[e-1] | s[e]）
  ok(!isKinsokuCutOk('一句的x', 3), '① 行尾是虚词「的」→ 非法断点')
  ok(!isKinsokuCutOk('好看。下', 2), '② 行首是「。」→ 非法断点')
  ok(!isKinsokuCutOk('曝光150万', 5), '③ 数字 + 中文单位「0|万」→ 非法断点')
  ok(!isKinsokuCutOk('高达8.5%', 4), '③ 百分号数字「.|5」→ 非法断点')
  ok(!isKinsokuCutOk('一键生成', 3), '④ 成对词「生|成」→ 非法断点')
  ok(isKinsokuCutOk('人工智能', 2), '普通位置（能|智）→ 合法断点（不误伤）')
  // ④ 回退有上限：全是虚词 → 找不到合法点就保持原切口（不许无限回退/丢字）
  eqNum(pickKinsokuCut('的'.repeat(10), 0, 5), 5, '窗口内无合法点 → 保持原切口（不硬造）')
  ok(pickKinsokuCut('图里这款手表海报，就是AI一键生成的，', 0, 16) >= 1
    && pickKinsokuCut('图里这款手表海报，就是AI一键生成的，', 0, 16) <= 16, '切口始终在 [start+1, start+cap] 内')
  // ⑤ 零回归：原本就是合法断点的句子，输出逐字不变
  {
    const r = splitTextByCap('第一句。第二句。', 5)
    eqNum(r.length, 2, '标点优先的短句仍按句切（段数不变）')
    ok(r.join('') === '第一句。第二句。', '标点优先路径输出逐字不变')
    ok(wrapWithKinsoku('短句不用折', 16).join('\u0000') === '短句不用折', '不超限 → 单行原样返回')
    const noPunc = '啊'.repeat(100)
    ok(splitTextByCap(noPunc, 60).join('') === noPunc, '硬切路径仍一字不丢')
    eqNum(splitTextByCap(noPunc, 60).length, 2, '硬切段数不变（无虚词可回退时不乱挪）')
    ok(splitTextByCap(noPunc, 60).every((x) => x.length <= 60), '硬切每段仍 ≤ 上限（回退不会撑爆）')
  }
}

console.log('\n⑦ 信息性对账：屏幕上那两行的折行在渲染层（不在服务端）')
{
  try {
    const renderSrc = readFileSync(join(srcDir, 'scripts/video-factory/render.py'), 'utf8')
    if (/★VF_LINEBREAK_V2/.test(renderSrc)) {
      console.log('  ✅ render.py 的 wrap_subtitle 已跟上 ★VF_LINEBREAK_V2（避头尾表逐字一致）')
    } else {
      console.log('  ⚠️ render.py 尚未跟上 ★VF_LINEBREAK_V2：屏幕上的 2 行折行在 ' +
        'render.py::wrap_subtitle()（不在服务端）—— 规则表已在 anti-ai.ts 导出，由渲染层同学照搬（不算本自测失败）')
    }
  } catch (e: any) {
    console.log('  ⚠️ 读不到 render.py（' + String(e?.message || e).slice(0, 60) + '）')
  }
}

console.log(`\n═══ 通过 ${pass} / 失败 ${fail} ═══`)
process.exit(fail ? 1 : 0)
