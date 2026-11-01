/**
 * ★SWITCHES（2026-11-01 用户定案 · 实验室 6 个开关）
 *
 * 每个开关都必须回答一个「我们真的不知道」的问题 —— 否则不值得加。
 * 一个开关只有在我们「两边都想试」时才保留。
 *
 *   ① 文案模式   → 换写法到底能不能变好？（我们最弱的一环）
 *   ② 大图使用率 → 图占多少才不空？
 *   ③ 视觉类型   → 它会不会自己换花样，还是永远满幅大图？
 *   ④ 装饰密度   → 装饰越多越好，还是过头反而乱？
 *   ⑤ 收尾帧     → 落版该怎么做才不像 PPT？
 *   ⑥ 动效       → 动效加不加分，还是拖后腿？
 */

export type SwitchDef = {
  key: string
  label: string
  /** 选项：value → 显示名 */
  options: [string, string][]
  /** 默认值 */
  def: string
  /** 一句话说明 */
  hint: string
}

export const SWITCHES: SwitchDef[] = [
  {
    key: 'copyMode',
    label: '文案模式',
    def: 'sell',
    options: [
      ['desc', '说明式'],
      ['sell', '卖点式'],
      ['poem', '短句诗化'],
    ],
    hint: '说明=「葱段在清汤里打转」· 卖点=「一口清汤，喝得出 8 小时」· 短句=「清。见底。」',
  },
  {
    key: 'bigImg',
    label: '大图使用率',
    def: '60',
    options: [
      ['0', '0%'],
      ['30', '30%'],
      ['60', '60%'],
      ['100', '100%'],
    ],
    hint: '满幅大图占全部段落的比例',
  },
  {
    key: 'visTypes',
    label: '视觉类型',
    def: 'rotate',
    options: [
      ['free', '自由'],
      ['rotate', '强制轮换'],
      ['musttype', '必有纯排版'],
    ],
    hint: '8 种类型：纯排版/满幅大图/图文分栏/多图错落/图切片/图形主图/数据图表/特写裁切',
  },
  {
    key: 'decoDensity',
    label: '装饰密度',
    def: 'mid',
    options: [
      ['low', '少(0-2)'],
      ['mid', '中(3-4)'],
      ['high', '多(5-6)'],
    ],
    hint: '每段装饰类数：背景纹理/徽章/小装饰/三层描边/贴纸/圆角',
  },
  {
    key: 'endFrame',
    label: '收尾帧',
    def: 'graphic',
    options: [
      ['minimal', '极简'],
      ['graphic', '有图形'],
      ['scene', '有场景'],
    ],
    hint: '极简=纯字+线 · 图形=字+几何 · 场景=小场景/产品',
  },
  {
    key: 'motion',
    label: '动效',
    def: 'on',
    options: [
      ['off', '关'],
      ['on', '开'],
    ],
    hint: '关=只做淡入+fade · 开=弹性/错峰/变形',
  },
]

/* ══════════════════════════════════════════════════════════════════════
   渲染成 prompt 段
   ══════════════════════════════════════════════════════════════════════ */

const COPY_BLOCK: Record<string, string> = {
  desc: `文案用**说明式**：描述画面里发生什么。
  例：「葱段、红枣、海带，在清汤里打转」
  要求：一句话一件事，不用形容词堆砌，不喊口号。`,
  sell: `文案用**卖点式**：说一个具体的、可验证的好处。
  例：「一口清汤，喝得出 8 小时」
  要求：每句必须有**一个数字或一个对比**；不许写「鲜香美味」这种空词。
  ❌ 反例：「汤底浓郁，回味无穷」（这是形容词，不是卖点）`,
  poem: `文案用**短句 / 诗化**：极短，留白，靠节奏。
  例：「清。见底。」
  要求：单句 ≤ 8 字；可以只有 1 个词 + 1 个标点；不许出现「的」结尾的长定语。`,
}

const BIGIMG_BLOCK: Record<string, string> = {
  '0': `**大图使用率 0%**：全片不使用满幅图片。所有画面靠**排版 + 图形 + 色彩**构成。
  ⇒ 考验排版功力。字要够大（占宽 60~85%），图形要有形状变化。`,
  '30': `**大图使用率约 30%**：约 1/3 的段落用满幅图，其余靠排版/图形。
  ⇒ 适合"图文交替"的节奏。`,
  '60': `**大图使用率约 60%**：多数段落用满幅图，少量纯排版做呼吸。
  ⇒ 最稳的比例。注意：**图的处理必须守图片硬底线**（不许压暗）。`,
  '100': `**大图使用率 100%**：全部段落都是满幅图片。
  ⇒ 全靠**图的裁切/位置/文字层级**做变化（图切片、特写裁切、图文分栏）。
  ⚠️ 不许用"压暗图"来解决文字可读性 —— 必须用围边或局部色块。`,
}

const VISTYPE_BLOCK: Record<string, string> = {
  free: `**视觉类型自由**：你自己决定每段怎么构图。`,
  rotate: `**视觉类型必须轮换**：
  8 种类型 = 纯排版 / 满幅大图 / 图文分栏 / 多图错落 / 图切片 / 图形主图 / 数据图表 / 特写裁切
  规则：① 相邻三段不许同类型 ② 全片至少用到 **5 种** ③ 开头和收尾不许都用"满幅大图"`,
  musttype: `**必须有一段"纯排版"**：至少一段**完全不用图片**，只靠大字 + 图形 + 色彩。
  ⇒ 这一段是"呼吸点"，放在中段（避免全片都是图）。`,
}

const DECO_BLOCK: Record<string, string> = {
  low: `**装饰密度：少（每段 0~2 类）**。
  只允许：圆角 + 一个徽章（或一条细线）。其余全部克制。
  ⇒ 适合"高级 / 冷静"的调性，但**不能一段都没有**。`,
  mid: `**装饰密度：中（每段 3~4 类）**。
  从这 6 类里挑 3 类以上：背景纹理 / 徽章胶囊 / 小装饰（星星汗滴箭头）/ 三层描边 / 贴纸撕纸 / 圆角。`,
  high: `**装饰密度：多（每段 5~6 类）**。
  6 类全上：背景纹理（条纹/网格/放射线）+ 徽章 + 2~4 个小装饰 + 三层描边 + 贴纸 + 圆角。
  ⇒ 适合"综艺 / 热闹"的调性。⚠️ 装饰不能盖住主体（主体区域留空）。`,
}

const END_BLOCK: Record<string, string> = {
  minimal: `**收尾帧：极简**。只有 1~2 行字 + 一条细线。
  ⇒ 前 1s 元素就位，后 2~3s 只做微动（opacity 呼吸 / 线慢慢展开）。`,
  graphic: `**收尾帧：有图形**。大字 + 一个几何形状（圆/方/三角）作背景或装饰。
  ⇒ 形状在字的后面或侧面，不要抢主体。`,
  scene: `**收尾帧：有场景**。落版坐在一个小场景里（产品/桌子/地面/光影）。
  ⇒ 场景要简，占画面下半，字压在上半或压在场景留白处。`,
}

const MOTION_BLOCK: Record<string, string> = {
  off: [
    '**动效关闭**：只允许 opacity 淡入 + 8px 位移。',
    '❌ 不许弹性 / overshoot / 旋转 / 变形 / 大幅位移。',
  ].join('\n'),
  on: [
    '**动效开启**：',
    '· 入场：0 → 1.15 → 1.0（约 8 帧），逐字错帧 2 帧',
    '· 缓动用 spring 或 easeOutBack，**不许线性**',
    '· 驻留时轻微 wiggle（rotate(sin(t*5)*2deg)）',
    '· 允许变形 / 切片 / 视差',
  ].join('\n'),
}

export function renderSwitches(f: Record<string, unknown>): string {
  const out: string[] = []
  out.push('【实验开关（这一版按下面的设定做，不要自己改）】')

  const push = (label: string, block?: string) => {
    if (!block) return
    out.push('')
    out.push(`· ${label}`)
    out.push(block)
  }

  push('文案模式', COPY_BLOCK[String(f.copyMode || 'sell')])
  push('大图使用率', BIGIMG_BLOCK[String(f.bigImg ?? '60')])
  push('视觉类型', VISTYPE_BLOCK[String(f.visTypes || 'rotate')])
  push('装饰密度', DECO_BLOCK[String(f.decoDensity || 'mid')])
  push('收尾帧', END_BLOCK[String(f.endFrame || 'graphic')])
  push('动效', MOTION_BLOCK[String(f.motion || 'on')])

  return out.join('\n')
}
