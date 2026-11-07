/**
 * ★★★ 2026-11-07 用户：「技法都编辑成按钮 勾选必须使用」「出错不怕，有截图二次修」
 *
 * 核心思想：把「倾向」换成「清单 + 必须」。
 *   现在（旧）：装饰密度"中"、强提示词 8000 字 ⇒ 它当"随便"，实测 <svg> 常为 0
 *   新的：20 个勾选框，**勾了就必须做到**，代码在报告里逐条验收
 *
 * 每个技法带四样东西：
 *   ① must     —— 写进 prompt 的"必须"描述（带落点：几段、几处）
 *   ② judge    —— 人读的判据（UI 悬停显示）
 *   ③ check    —— 代码验收用的正则 + 最少处数（做不到就在报告里标 ❌）
 *   ④ conflict —— 和谁互斥（勾了 A 就灰掉 B，避免它自相矛盾）
 *
 * ⚠️ 题材无关：技法属于"手艺"，餐饮/产品/知识科普都能用。
 *    题材只影响配色倾向、文案语气、禁忌（见 CONTENT_TYPE 那一侧）。
 */

export type TechGroup = '构图' | '文字' | '图形' | '质感'

export type Tech = {
  id: string
  name: string
  group: TechGroup
  /** 很短的一句话（挂在勾选框后面） */
  hint: string
  /** 写进 prompt 的必须条款（要带落点和数量） */
  must: string
  /** 人读的判据（hover 显示） */
  judge: string
  /** 代码验收：正则 + 至少几处 */
  check?: { re: RegExp; min: number }
  /** 额外验收条件（需要同时满足） */
  check2?: { re: RegExp; min: number }
  /** 和这些 id 互斥 */
  conflict?: string[]
  /** 适合 / 不适合（也写进 prompt） */
  fit?: string
  /** 是否参与"第一版验收"（先只开 5 个，验证机制） */
  stable?: boolean
}

export const TECHNIQUES: Tech[] = [
  /* ══════════ 构图 ══════════ */
  {
    id: 'full',
    name: '满幅推拉',
    group: '构图',
    hint: '图铺满 + 缓慢推拉',
    must: '满幅大图：图铺满整个画布（inset:0 或 object-fit:cover），并用 --p 做缓慢推拉（scale 1.0→1.08 或反向），至少 3 段',
    judge: '段内有 inset:0 / object-fit:cover，且有 transform: scale(calc(...var(--p)...))',
    check: { re: /inset\s*:\s*0|object-fit\s*:\s*cover/gi, min: 3 },
    conflict: ['collage', 'circle'],
    fit: '任何题材；餐饮/产品最容易出效果',
  },
  {
    id: 'bleed',
    name: '出血裁切',
    group: '构图',
    hint: '主体被裁到画面外',
    must: '出血裁切：至少 1 段让主体（人的头/产品/食材）**故意超出画布边缘**（负 margin 或 translate 超过 15%），制造张力',
    judge: '出现负 margin/top 或 translate 超过画布 15% 的元素',
    fit: '冲击力段落；老字号慎用',
  },
  {
    id: 'split',
    name: '左右对开',
    group: '构图',
    hint: '一半图一半文',
    must: '左右对开：至少 1 段是"左图右文"或"右图左文"，中缝留 24~48px 空隙',
    judge: '段内两个子块各占约 50% 宽（flex 或 grid）',
    fit: '横屏优先；竖屏要改上下对开',
  },
  {
    id: 'collage',
    name: '多图错位',
    group: '构图',
    hint: '2~3 张图错落叠放',
    must: '多图错位：至少 1 段放 2~3 张图错落叠放（不同 top/left + 不同旋转 ±3deg），**不允许并排平铺**',
    judge: '段内 2+ 张图，且有 rotate 或不同 top/left',
    check: { re: /rotate\(\s*-?[1-9]/g, min: 1 },
    conflict: ['full'],
    fit: '需要"丰富感"（多道菜/多个产品）',
  },
  {
    id: 'circle',
    name: '圆窗/斜切',
    group: '构图',
    hint: '圆形或斜切的图窗',
    must: '图窗变形：至少 1 段用 border-radius:50%（圆窗）或 clip-path 斜切来裁图，不要全是矩形',
    judge: 'border-radius:50% 或 clip-path: polygon/inset',
    check: { re: /clip-path|border-radius\s*:\s*50%/g, min: 1 },
    conflict: ['full'],
    fit: '局部特写；圆窗很"中式"',
  },
  {
    id: 'typeonly',
    name: '纯排版页',
    group: '构图',
    hint: '至少 1 段不用图',
    must: '纯排版页：至少 1 段**完全不用图片**，全部由字 + 线条 + 图形构成（开场或收尾最合适）',
    judge: '段内没有 img / background-image:url(data:image)',
    fit: '开场/收尾/转场',
  },

  /* ══════════ 文字 ══════════ */
  {
    id: 'stroke',
    name: '描边字',
    group: '文字',
    hint: '花字：彩色边+白边+字芯',
    must: '描边字（花字）：至少 2 段的主标题用 SVG <text> 做三层描边 —— '
      + 'paint-order="stroke"、外层 stroke-width ≈ 字号 10%、中层 ≈ 5%、字芯用渐变填充。'
      + '⛔ 描边太粗会把字芯吃掉（字号 120 时外层别超 12）',
    judge: '<text> ≥ 2 个 且 paint-order 出现 且 stroke-width 出现',
    check: { re: /<text/g, min: 2 },
    check2: { re: /paint-order/g, min: 2 },
    fit: '卖点短句/价格/标题；小字不要用（会糊）',
    stable: true,
  },
  {
    id: 'boom',
    name: '爆炸字',
    group: '文字',
    hint: '巨字+放射线（强情绪）',
    must: '爆炸字：全片**最多 1 处**，用在高潮句（如"8小时！"），配放射线背景或强烈旋转',
    judge: '存在 transform:rotate + 超大字号的文本块',
    fit: '年轻化/促销；老字号/高端慎用',
  },
  {
    id: 'vertical',
    name: '竖排',
    group: '文字',
    hint: '竖排文字（中式）',
    must: '竖排文字：至少 1 段用 writing-mode: vertical-rl 做竖排（中文招牌感）',
    judge: 'writing-mode: vertical-rl 出现 ≥1 次',
    check: { re: /writing-mode\s*:\s*vertical/g, min: 1 },
    fit: '中式/老字号/书店/茶馆',
    stable: true,
  },
  {
    id: 'bignum',
    name: '巨型数字',
    group: '文字',
    hint: '数字占短边 25%+',
    must: '巨型数字：至少 2 段出现巨型数字（字号 ≥ 画布短边的 25%，竖屏约 320px），可半透明做背景肌理',
    judge: 'font-size ≥ 短边 25% 的数字块',
    fit: '卖点式文案天然适合（几小时/几道/几折）',
  },
  {
    id: 'seal',
    name: '印章',
    group: '文字',
    hint: '红底圆/方印章',
    must: '印章：至少 1 处做一个印章元素（红色方块或圆形 + 白字 + 轻微旋转 -3deg ~ +3deg），可只露一半在画面边缘',
    judge: '存在 红底 + 文字 + rotate 的块',
    check: { re: /rotate\(\s*-?[0-9.]+deg/g, min: 1 },
    fit: '中式/老字号/品牌落版',
    stable: true,
  },
  {
    id: 'pill',
    name: '胶囊标签',
    group: '文字',
    hint: '圆角标签（品牌/分类）',
    must: '胶囊标签：至少 2 段用 border-radius ≥ 999px 的胶囊标签（品牌名/分类/价格），位置全片统一',
    judge: 'border-radius: 999px 或 40px+ 的小标签 ≥2 处',
    check: { re: /border-radius\s*:\s*(?:999|99|\d{2,3})px/g, min: 2 },
    fit: '所有题材（栏目包装感）',
  },

  /* ══════════ 图形 ══════════ */
  {
    id: 'svgshape',
    name: 'SVG 图形',
    group: '图形',
    hint: '真的画一个图形',
    must: 'SVG 图形：至少 1 处用内联 SVG **画出**一个真实图形（印章/纹样/铜锅/图标/路径生长），'
      + '⛔ 不是空 <svg> 占位，也不能只是 <text>',
    judge: '<svg> 内有 path/circle/rect/polygon 等图元',
    check: { re: /<(?:path|circle|rect|polygon|line|ellipse)\b/g, min: 2 },
    fit: '收尾落版 / 装饰纹样 / 图标',
    stable: true,
  },
  {
    id: 'torn',
    name: '撕纸边',
    group: '图形',
    hint: '撕纸/胶带边',
    must: '撕纸边：至少 1 处用 feTurbulence + feDisplacementMap 或 clip-path 做撕纸/胶带边缘',
    judge: 'feDisplacementMap 或复杂 clip-path',
    fit: '手作感/拼贴风',
  },
  {
    id: 'gridbg',
    name: '网格底纹',
    group: '图形',
    hint: '网格/斜条纹底',
    must: '背景纹理：至少 2 段有可见底纹（网格/斜条纹/放射线），用 repeating-linear-gradient 或 SVG pattern',
    judge: 'repeating-linear-gradient 或 pattern ≥2 处',
    check: { re: /repeating-linear-gradient|pattern/g, min: 2 },
    fit: '所有题材；科技/知识类更合适',
  },
  {
    id: 'glow',
    name: '光晕',
    group: '图形',
    hint: '柔光溢出',
    must: '光晕：至少 1 处用 drop-shadow 或 radial-gradient 做柔光（紧 4px + 散 30px）',
    judge: 'drop-shadow ≥1 或 radial-gradient ≥1',
    check: { re: /drop-shadow|radial-gradient/g, min: 2 },
    fit: '高端/夜间/氛围段落',
  },
  {
    id: 'particle',
    name: 'canvas 粒子',
    group: '图形',
    hint: '真 canvas 动画',
    must: 'canvas：至少 1 个 <canvas>，用 2D context 画粒子/噪点/光斑，**必须随 --p 或 rAF 每帧变化**，'
      + '⛔ 不许放一个不动的 canvas 充数',
    judge: '<canvas> ≥1 且 JS 里有 getContext + 逐帧更新',
    check: { re: /<canvas/g, min: 1 },
    check2: { re: /getContext\s*\(\s*['"]2d/g, min: 1 },
    fit: '氛围/热气/星空；餐饮的"热气"很合适',
  },
  {
    id: 'grow',
    name: '路径生长',
    group: '图形',
    hint: '线条"画"出来',
    must: '路径生长：至少 1 条 SVG 线用 stroke-dasharray + stroke-dashoffset 随 --p 生长',
    judge: 'stroke-dasharray + stroke-dashoffset 出现',
    check: { re: /stroke-dash(?:array|offset)/g, min: 2 },
    fit: '开场钩子 / 标题下划线 / 引导线',
  },

  /* ══════════ 质感 ══════════ */
  {
    id: 'grain',
    name: '胶片颗粒',
    group: '质感',
    hint: 'SVG 噪点，opacity ≤.12',
    must: '胶片颗粒：用 SVG feTurbulence 做噪点，opacity 0.02~0.04，mix-blend-mode: overlay。'
      + '⛔ 不许 inset:0 全屏盖住照片（会像蒙了层热气）—— 要做进背景或只盖纯色区',
    judge: 'feTurbulence ≥1 且 opacity ≤ 0.12',
    check: { re: /feTurbulence/g, min: 1 },
    fit: '所有题材（防"AI 默认干净"）',
    stable: true,
  },
  {
    id: 'vignette',
    name: '带色暗角',
    group: '质感',
    hint: '边缘压暗（带色相）',
    must: '暗角：至少 2 段用 radial-gradient 压边缘（0.18~0.25），颜色**带色相**（不要纯黑）',
    judge: 'radial-gradient 边缘压暗 ≥2 处',
    check: { re: /radial-gradient/g, min: 2 },
    fit: '所有题材',
  },
  {
    id: 'scan',
    name: '扫描线',
    group: '质感',
    hint: '细横线，opacity ≤.12',
    must: '扫描线：用 repeating-linear-gradient(180deg, rgba(0,0,0,.12) 0 1px, transparent 1px 3px)，'
      + 'opacity ≤ 0.12，**且不许盖在照片上**',
    judge: 'repeating-linear-gradient 180deg + opacity ≤.12',
    fit: '复古/科技/CRT',
  },
  {
    id: 'paper',
    name: '纸纹',
    group: '质感',
    hint: '纸纹/布纹 multiply',
    must: '纸纹：feTurbulence baseFrequency 0.04 + mix-blend-mode: multiply，只盖纯色区',
    judge: 'feTurbulence baseFrequency .04 + multiply',
    fit: '手作/中式/书卷气',
  },
]

/** 按组取 */
export function byGroup(): Record<TechGroup, Tech[]> {
  const out = { 构图: [], 文字: [], 图形: [], 质感: [] } as Record<TechGroup, Tech[]>
  for (const t of TECHNIQUES) out[t.group].push(t)
  return out
}

export function techById(id: string): Tech | undefined {
  return TECHNIQUES.find((t) => t.id === id)
}

/** 勾选后的互斥集（勾了 A，B 就不该再勾） */
export function conflictSet(ids: string[]): Set<string> {
  const s = new Set<string>()
  for (const id of ids) {
    const t = techById(id)
    t?.conflict?.forEach((c) => s.add(c))
  }
  return s
}

/** 生成 prompt 片段：勾了的必须做 */
export function renderTechMust(ids: string[]): string {
  if (!ids.length) return ''
  const picked = ids.map(techById).filter(Boolean) as Tech[]
  const L: string[] = []
  L.push(`【技法 · 这些是**必须做到**的，不是"可以试试"】`)
  L.push('')
  L.push(`本次勾了 ${picked.length} 个。**每一个都要在成片里真的出现**，`)
  L.push('代码会在报告里逐条验收（找不到就算了没做）。')
  L.push('')
  picked.forEach((t, i) => {
    L.push(`${i + 1}. **${t.name}**（${t.group}）`)
    L.push(`   ${t.must}`)
    if (t.fit) L.push(`   适用：${t.fit}`)
  })
  L.push('')
  L.push('⛔ **不许用"一个空标签充数"的方式交差**：')
  L.push('   · 写了 <svg> 但没有 path/circle 等图元 ⇒ 不算用了 SVG')
  L.push('   · 写了 <canvas> 但没有 getContext 和逐帧 ⇒ 不算用了 canvas')
  L.push('   · 写了 paint-order 但 stroke-width < 字号 5% ⇒ 不算描边字')
  L.push('')
  L.push('⇒ 宁可做得克制但**真的做到**，也不要塞一堆空标签。')
  return L.join('\n')
}
