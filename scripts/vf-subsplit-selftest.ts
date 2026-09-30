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
} from '../src/lib/agent/vf/anti-ai'

let pass = 0
let fail = 0
function ok(cond: any, name: string, extra = '') {
  if (cond) { pass++; console.log('  ✅ ' + name) }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' → ' + extra : '')) }
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
  ok(renderSrc.includes('_sub_rows('), 'render.py 有 _sub_rows（字幕 2 行压缩实现）')
  ok(/最多 2 行压缩显示/.test(renderSrc), 'render.py 有"已按最多 2 行压缩显示"日志')
  ok(antiSrc.includes('每镜字幕 ≤ 60 字'), 'ANTI_AI_PROMPT 已写「每镜字幕 ≤ 60 字」规矩')
}

console.log(`\n═══ 通过 ${pass} / 失败 ${fail} ═══`)
process.exit(fail ? 1 : 0)
