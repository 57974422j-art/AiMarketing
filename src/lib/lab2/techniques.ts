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

export type TechGroup = '构图' | '文字' | '图形' | '质感' | '绘制'

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
    id: 'sticker',
    name: '贴纸化围框',
    group: '构图',
    hint: '照片加白边+投影，像贴纸',
    must: '贴纸化：**至少 3 张照片**套上"白边 + 投影"的卡片效果 —— '
      + '白边 8~10px（`box-shadow: 0 0 0 9px #fff` 最省事），圆角 14~22px，'
      + '再配 `0 18px 36px rgba(60,74,90,.28)` 的投影。'
      + '⛔ 白边 <6px 会被吞掉（看不出是贴纸），>12px 像画框',
    judge: 'box-shadow: 0 0 0 8~12px，或 border: 8~12px solid #fff，≥3 处',
    check: { re: /box-shadow\s*:\s*0\s+0\s+0\s+(\d+)px/gi, min: 3 },
    fit: '餐饮/产品/手作感；满幅推拉时用不了（互斥）',
    stable: true,
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
    id: 'papercut',
    name: '剪纸窗花',
    group: '图形',
    hint: 'SVG 画团花/生肖/吉祥纹',
    must: '剪纸窗花：至少 1 处用内联 SVG **画出**中式剪纸纹样 —— '
      + '对称团花（圆形 + 6~12 个花瓣阵列）、生肖剪影、吉祥纹（回字/缠枝）、窗格。'
      + '用 `<path>` 或 `<circle>` 配合 `transform: rotate()` 阵列；'
      + '颜色用正红 `#C8352B` 或描金 `#D4AF37`。'
      + '✅ 可以只露一半挂在画面边角当"角花"，不要整张铺满',
    judge: '<svg> 内 ≥3 个 path/circle/ellipse，且呈对称或旋转阵列',
    check: { re: /<(?:path|circle|ellipse|polygon)\b/g, min: 3 },
    fit: '中式/年节/老字号；"马到成功""福""囍"这类吉祥主题天然适合',
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

  /* ══════════ 绘制（★2026-11-09 概念片专用：没有素材时用这些讲概念）══════════
     ⚠️ 这一组和上面四组根本不同：
       上面四组讲「照片怎么处理」，这一组讲「形状怎么长出来」
       参考片：一条 30 秒服务器管理软件宣传片（1280×720 / 24fps / 带音轨）
         0-4s   点阵 1 → 101 + 数字递增
         6-8s   炸开 → 聚成 logo
         16-22s 透视网格铺满
         22-27s 环形阵列 + 标签
         27-30s 数据面板 + 开箱 + 落版
       ⇒ 全片零素材，全靠几何 + 动效
     */

  {
    id: 'dotgrow',
    name: '点阵生长',
    group: '绘制',
    hint: '1 个点 → 一片阵列（讲规模）',
    must: '点阵生长：画面元素数量**从少到多递增**（1 → 10 → 30 → 100），'
      + '同时用巨型数字同步滚动。'
      + '用 CSS grid / flex 铺 N 个小方块（或 canvas 画点），'
      + '每个元素 `opacity: calc((var(--p) - index*0.008) * 20)` 错峰出现。'
      + '⛔ 不是"淡入一段文字"，是**画面真的从 1 个点长成一片**',
    judge: '同段内 ≥20 个小元素 + 数字递增 + 错峰出现',
    check: { re: /opacity\s*:\s*calc\(/g, min: 2 },
    fit: '讲规模 / 效率 / 覆盖数；概念片开场最强的笔',
  },
  {
    id: 'morph',
    name: '粒子重组',
    group: '绘制',
    hint: '炸开 → 聚成一个形（讲品牌）',
    must: '粒子重组：一段里的元素先**炸开/散乱**，再**收拢成一个可辨认的形状**'
      + '（logo / 图标 / 文字轮廓）。'
      + '用 canvas 最省（每个粒子一个目标坐标 + 缓动），或用 50+ 个 div 逐个 transition。'
      + '⛔ 不许只是"缩放淡出淡入"——必须有**位置迁移**',
    judge: 'canvas 逐帧 或 ≥30 个元素各自 transform 位移',
    check: { re: /<canvas/g, min: 1 },
    fit: '品牌揭示 / 产品登场；全片只用 1 次，位置放在 6~9 秒',
  },
  {
    id: 'ring',
    name: '环形阵列',
    group: '绘制',
    hint: '中央对象 + 环绕元素（讲一对多）',
    must: '环形阵列：中央放一个主体（方块/图标），'
      + '周围 **8~16 个元素沿圆周均分角度**（`rotate(i*360/n) translateY(-R)`），'
      + '按角度顺序**逐一延迟**出现（相差 0.03~0.06 的 --p）。',
    judge: '≥8 个元素环绕 + 逐个延迟',
    check: { re: /rotate\(\s*calc\(/g, min: 1 },
    fit: '一对一 → 一对多（一台管 100 台）',
  },
  {
    id: 'grid3d',
    name: '透视网格',
    group: '绘制',
    hint: '3D 透视铺满（讲容量）',
    must: '透视网格：用 `transform: perspective(900px) rotateX(60deg)` '
      + '把一片网格推到纵深，或 canvas 画等距网格；'
      + '网格单元 ≥ 60 个，可带明暗差（近亮远暗）。'
      + '⛔ 不要用平面方格纸，必须有**纵深**',
    judge: 'perspective + rotateX 出现，或 canvas 画等距网格',
    check: { re: /perspective\(/g, min: 1 },
    fit: '机房 / 仓库 / 阵列 / 容量；科技概念片核心镜头',
  },
  {
    id: 'datapanel',
    name: '数据面板',
    group: '绘制',
    hint: '数字滚动 + 折线（讲性能）',
    must: '数据面板：至少 3 组指标（百分比 / 温度 / 数量），'
      + '每个数值**从 0 滚动到目标值**（`--p` 驱动，不是直接显示），'
      + '配一条折线或柱状（canvas / SVG path 都行）。'
      + '⚠️ 数字要有单位，字号要大（占画布宽 8%+）',
    judge: '数字插值 + 折线/柱状 + 单位',
    check: { re: /(?:line|polyline|path)\b/g, min: 1 },
    fit: '性能 / 监控 / 参数；概念片"专业感"的来源',
  },
  {
    id: 'reveal',
    name: '遮罩揭示',
    group: '绘制',
    hint: '从一条缝推开（不是淡入）',
    must: '遮罩揭示：用 `clip-path: inset()` 或 `mask` 从 **0 宽/0 高** 推到满，'
      + '像"开门/开箱/撕开"。至少 2 段用这个进场。'
      + '⛔ 不要用 opacity 淡入代替',
    judge: 'clip-path: inset / mask 出现 ≥2 处',
    check: { re: /clip-path\s*:\s*inset/g, min: 2 },
    fit: '产品登场 / 段落切换；比淡入"有重量"',
  },
  {
    id: 'wire',
    name: '线框构建',
    group: '绘制',
    hint: '线条自己画出来',
    must: '线框构建：用 SVG `stroke-dasharray` + `stroke-dashoffset` 让'
      + '图形轮廓**自己画出来**（盒子/图标/边框），至少 1 处。',
    judge: 'stroke-dasharray + stroke-dashoffset 成对出现',
    check: { re: /stroke-dash(?:array|offset)/g, min: 2 },
    fit: '技术感 / 蓝图感 / 产品线稿',
  },
  {
    id: 'sweep',
    name: '色块扫过',
    group: '绘制',
    hint: '整块推入作转场',
    must: '色块扫过：用一个铺满画布的纯色块，'
      + '从一侧**整块推入再推出**，作为段与段之间的转场（至少 2 次）。'
      + '⛔ 不要用淡入淡出转场 —— 那是模板味',
    judge: '全屏色块 + translateX/Y 驱动，≥2 处',
    fit: '段落硬切转场；概念片最省力的节奏工具',
  },
]

/**
 * ★★★ 2026-11-07 用户：「内容类型 9 个按钮还有用吗」
 *
 * 查证：contentType **从来没进过 prompt**（11-03 精简时把「内容类型技法」全删了）
 *   ⇒ 9 个按钮是死的
 *
 * 现在改成「技法预设」：点一个类型 ⇒ 自动勾上对应的技法组合，你还能手动加减。
 *   ⇒ 内容类型终于真的影响输出了
 */
export const TYPE_PRESETS: Record<string, { label: string; techs: string[]; note: string }> = {
  none: { label: '不指定', techs: [], note: '不预设，你自己勾' },
  food: {
    label: '餐饮探店',
    techs: ['full', 'sticker', 'stroke', 'vertical', 'seal', 'papercut', 'grain'],
    note: '满幅+贴纸化+描边字+竖排+印章+颗粒（让人饿）',
  },
  product: {
    label: '产品科技',
    techs: ['full', 'gridbg', 'svgshape', 'glow', 'bignum', 'grain'],
    note: '满幅+网格+SVG图形+光晕+巨型数字（冷、精密）',
  },
  knowledge: {
    label: '知识科普',
    techs: ['gridbg', 'svgshape', 'bignum', 'pill', 'particle'],
    note: '网格+SVG图形+巨型数字+胶囊+粒子（讲清楚）',
  },
  talking: {
    label: '老板口播',
    techs: ['split', 'sticker', 'stroke', 'pill', 'grain'],
    note: '左右对开+贴纸化+描边字+胶囊（人 + 话）',
  },
  promo: {
    label: '活动促销',
    techs: ['full', 'boom', 'bignum', 'sticker', 'vignette'],
    note: '满幅+爆炸字+巨型数字+贴纸化（冲击）',
  },
  tutorial: {
    label: '教程演示',
    techs: ['gridbg', 'svgshape', 'pill', 'grow', 'bignum'],
    note: '网格+SVG图形+胶囊+路径生长（步骤感）',
  },
  brand: {
    label: '品牌落版',
    techs: ['typeonly', 'seal', 'vertical', 'svgshape', 'papercut', 'grain'],
    note: '纯排版+印章+竖排+SVG图形+颗粒（收束）',
  },
  mood: {
    label: '情绪空镜',
    techs: ['full', 'grain', 'vignette', 'glow', 'paper'],
    note: '满幅+颗粒+暗角+光晕+纸纹（氛围）',
  },
}

/** 按组取 */
export function byGroup(): Record<TechGroup, Tech[]> {
  const out = { 构图: [], 文字: [], 图形: [], 质感: [], 绘制: [] } as Record<TechGroup, Tech[]>
  for (const t of TECHNIQUES) out[t.group].push(t)
  return out
}

/** 概念片（无素材）专属：只留"能画出来的"技法 */
export const CONCEPT_TECH_IDS = [
  'dotgrow', 'morph', 'ring', 'grid3d', 'datapanel', 'reveal', 'wire', 'sweep',
]

/** 按组取（概念片：只显示绘制组） */
export function conceptGroups(): Record<string, Tech[]> {
  const out: Record<string, Tech[]> = { 绘制: [] }
  for (const t of TECHNIQUES) {
    if (t.group === '绘制') out['绘制'].push(t)
  }
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
  L.push(`【技法 · 勾的是**下限**，不是上限】`)
  L.push('')
  L.push(`本次勾了 ${picked.length} 个。**每一个都要在成片里真的出现**，`)
  L.push('代码会在报告里逐条验收（找不到就算了没做）。')
  L.push('')
  /**
   * ★★★ 2026-11-12 用户实测（114615）：
   *   「我觉得应该是增加更多的绘画，但他好像都是按你自动勾选的做的」
   *
   * 根因：我原来写「这些是必须做到的」⇒ 它理解成「只做这些」
   *   ⇒ 勾 4 个就只做 4 个，未勾的（环形/线框/扫过/揭示）全放弃
   *   ⇒ 结果画面元素极少 ⇒ 90% 黑底 ⇒ "空"
   *
   * ⇒ 现在明确：勾的是**下限**，你必须自己再加。
   */
  L.push(`⚠️ 但这 ${picked.length} 个**只是下限**，不是全部。`)
  L.push('  你还**必须自己再加 3~5 种手法**（从技法库里挑，或你自己发明）——')
  L.push('  只做勾的这几个 ⇒ 画面元素会太少 ⇒ 看起来空。')
  L.push('')
  L.push('⛔ **每段至少 3 个视觉元素**（图 / 字 / 图形 / 数据 / 装饰，任选三类以上）')
  L.push('⛔ **任一段的空白面积 ≤ 55%** —— 黑底超过一半就是"空"，不是"留白"')
  L.push('⛔ **至少 2 处"元素延续"**：上一段的元素**不消失**，变形进入下一段')
  L.push('   （位置移动 / 数量增减 / 形状改变 —— 不是"换一张新画面"）')
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
