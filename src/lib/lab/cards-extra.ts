/**
 * ★LAB_CARDS_EXTRA（2026-10-31 用户定案，补 video-shotcraft 的四大缺口）
 * =============================================================================
 * 来源：`video-shotcraft`（Apache-2.0）的 10 类镜头卡，我们只有 Typography 的一部分，
 *       缺的是：**Light & Emphasis(23) / Transitions(19) / Camera(13) / Rhythm(8)**
 *
 * 这里按我们模型（deepseek-flash + 纯 CSS）**真能实现**的挑出 27 张：
 *   · Light（打光）8 张    —— gradient + blur + mix-blend 能做到
 *   · Transition（转场）10 张 —— clip-path + transform 能做到
 *   · Camera（运镜）5 张     —— **只做推拉/平移/缩放**，3D 透视与爆炸视图做不了
 *   · Rhythm（节奏）4 张     —— 能做，但"卡点"要音频时间戳（我们还没有，先做视觉节奏）
 *
 * ⚠️ 全部按"可检验"写：给具体数值，不给形容词。
 */

export type ExtraCard = {
  id: string
  cat: 'light' | 'transition' | 'camera' | 'rhythm'
  name: string
  when: string
  how: string
  pitfall?: string
}

export const CARDS_EXTRA: ExtraCard[] = [
  /* ══════════════ Light & Emphasis · 打光（8 张） ══════════════ */
  {
    id: 'L01', cat: 'light', name: '聚光扫过',
    when: '标题需要被"发现"时（黑暗→被照亮）',
    how: '一个 `radial-gradient(circle at var(--x) 40%, rgba(255,240,200,.55), transparent 42%)` 的遮罩层，' +
      '`--x` 从 -20% 扫到 120%（`calc(var(--p) * 140% - 20%)`），底层文字平时**暗 60%**，被扫过时恢复。',
    pitfall: '光斑别做成硬边圆，必须 `blur(40px)` 以上；扫过一次就停，不要来回。',
  },
  {
    id: 'L02', cat: 'light', name: '边缘高光',
    when: '主体是深色物体 / 需要"立体感"',
    how: '`box-shadow: inset 0 0 0 1.5px rgba(255,255,255,.28), inset 0 -30px 60px rgba(0,0,0,.35)`；' +
      '再加一条 `linear-gradient(105deg, transparent 42%, rgba(255,255,255,.18) 50%, transparent 58%)` 斜向高光。',
    pitfall: '高光别超过 .25 不透明度，否则像塑料。',
  },
  {
    id: 'L03', cat: 'light', name: '辉光扩散',
    when: '霓虹 / 发光字 / 能量感',
    how: '`text-shadow: 0 0 8px 当前色, 0 0 24px 当前色, 0 0 60px 当前色`（三层，逐层更虚）；' +
      '强度用 `calc(var(--p) * 1)` 驱动，从 0 涨到满。',
    pitfall: '三层以上会糊；深色底上效果最好，浅色底几乎没有用。',
  },
  {
    id: 'L04', cat: 'light', name: '逆光剪影',
    when: '人物 / 场景 / 情绪段',
    how: '主体压暗到 `filter: brightness(.35) contrast(1.15)`，背后放一个' +
      '`radial-gradient(circle, rgba(255,200,120,.7), transparent 65%)` 加 `blur(60px)` 的光团。',
    pitfall: '光团必须在主体**后面**（z-index 更低），否则变成"贴纸"。',
  },
  {
    id: 'L05', cat: 'light', name: '光带切开',
    when: '需要"结构感" / 分割画面',
    how: '一条 `height: 3px; background: linear-gradient(90deg, transparent, 主色, transparent)` 的横带，' +
      '`filter: blur(1px); box-shadow: 0 0 24px 6px 主色`，从中间向两边生长。',
    pitfall: '一条就够；三条以上变"扫描线"。',
  },
  {
    id: 'L06', cat: 'light', name: '暗角聚焦',
    when: '任何段 —— 最便宜的"高级感"',
    how: '`radial-gradient(ellipse at center, transparent 35%, rgba(0,0,0,.55) 100%)` 盖在最上层，' +
      '`pointer-events:none`。强度 0.35~0.6 之间取。',
    pitfall: '超过 .7 会像"镜头坏了"；浅色画面用白色暗角（`rgba(255,255,255,.3)`）。',
  },
  {
    id: 'L07', cat: 'light', name: '色块反光',
    when: '画面偏平、需要"氛围色"',
    how: '在某一块放 `linear-gradient(160deg, rgba(主色,.35), transparent 60%)`，' +
      '`mix-blend-mode: screen`（深底）或 `multiply`（浅底）。',
    pitfall: 'blend-mode 用错方向会变脏；深底用 screen、浅底用 multiply。',
  },
  {
    id: 'L08', cat: 'light', name: '文字被打亮',
    when: '大字压在暗图上、需要"从暗里浮出来"',
    how: '文字初始 `color: rgba(255,255,255,.18)`，随 `--p` 过渡到 `#fff`；' +
      '同时背后加一块 `backdrop-filter: blur(6px) brightness(1.4)` 的椭圆。',
    pitfall: '`backdrop-filter` 在部分渲染器性能差，一屏最多用一处。',
  },

  /* ══════════════ Transitions · 转场（10 张） ══════════════ */
  {
    id: 'T01', cat: 'transition', name: '横向擦除',
    when: '通用 —— 最干净的转场',
    how: '下一段用 `clip-path: inset(0 calc((1 - var(--p) * 4) * 100%) 0 0)`，' +
      '像纸从左被拉开。**前 25% 的 --p 就走完**（速度感）。',
    pitfall: '擦除方向相邻两段必须相反（左→右、右→左），否则单调。',
  },
  {
    id: 'T02', cat: 'transition', name: '纵向推挤',
    when: '上下段有"承接"关系时',
    how: '上一段 `transform: translateY(calc(var(--p) * -22%))` 向上让位，' +
      '下一段从下方 `translateY(calc((1 - var(--p)*4) * 40%))` 推上来。',
    pitfall: '两段必须同时动（同一时间窗），否则会露底色。',
  },
  {
    id: 'T03', cat: 'transition', name: '缩放穿透',
    when: '进入细节 / 强调某个局部',
    how: '下一段从 `scale(1.6)` 收到 `scale(1)`，同时 `opacity` 从 0 到 1；' +
      '曲线用 `cubic-bezier(0.22, 1, 0.36, 1)`（急出缓停）。',
    pitfall: '从 1.6 开始会看到明显"糊"，最好同时加 `filter: blur(8px→0)`。',
  },
  {
    id: 'T04', cat: 'transition', name: '硬切闪白',
    when: '节奏段 / 需要"啪"的一下',
    how: '段开头 120ms 内，一层纯白 `opacity` 从 0.9 降到 0（`calc(0.9 - var(--p)*45)` 截断到 0）；' +
      '同时下一段内容直接出现（不用淡入）。',
    pitfall: '闪白只在**快节奏段**用；连着用两次会有"频闪"不适感。',
  },
  {
    id: 'T05', cat: 'transition', name: '遮罩形状开',
    when: '想要"图形感"的转场',
    how: '`clip-path: circle(calc(var(--p) * 150%) at 50% 50%)`（圆形扩张）' +
      '或 `polygon()` 三角/斜切扩张。',
    pitfall: '扩张点要落在"视觉重心"上，随机位置会显得乱。',
  },
  {
    id: 'T06', cat: 'transition', name: '条带分割',
    when: '多图段之间切换',
    how: '画面切成 5~7 条竖条，每条**错开 60ms** 分别用 `scaleY` 或 `translateY` 切换。',
    pitfall: '条数超过 8 条会闪；错峰间隔小于 40ms 看不出层次。',
  },
  {
    id: 'T07', cat: 'transition', name: '文字先行',
    when: '文字是主角的段',
    how: '下一段的第一行字**先出现**（在上一段末尾 0.3s 内），然后背景才换。' +
      '用 `z-index` 让字浮在两段之上。',
    pitfall: '字必须在新旧底色上都看得清（加描边或阴影）。',
  },
  {
    id: 'T08', cat: 'transition', name: '压黑再亮',
    when: '情绪转折 / 段落之间要"喘口气"',
    how: '上一段末尾 `brightness` 降到 0（30% 时长），下一段开头从 0 升回 1（20% 时长）。',
    pitfall: '全程压黑会像"卡了"；中间一定要有 1~2 帧纯黑作为"呼吸"。',
  },
  {
    id: 'T09', cat: 'transition', name: '旋转切入',
    when: '动感强的段',
    how: '下一段 `transform: rotate(-4deg) scale(1.15)` → `rotate(0) scale(1)`，' +
      '同时 `clip-path` 从左擦入。',
    pitfall: '旋转超过 6° 会晕；配合 clip-path 才不露边。',
  },
  {
    id: 'T10', cat: 'transition', name: '同色消融',
    when: '两段底色接近时',
    how: '上一段整体 `opacity` 降到 0 的同时，下一段从 0 升到 1，**两者有 0.25s 重叠**。',
    pitfall: '只在底色相近时用；底色差异大会出现"灰糊"。',
  },

  /* ══════════════ Camera · 运镜（5 张，只做能做的） ══════════════ */
  {
    id: 'C01', cat: 'camera', name: '极缓推进',
    when: '**每段都该有** —— 治 PPT 感最有效的一招',
    how: '整段内容 `transform: scale(calc(1 + var(--p) * 0.06))`，' +
      '从 1.0 匀速推到 1.06（全段走完）。**只看不动，但画面一直在长**。',
    pitfall: '超过 1.10 会看出"糊"；必须 `transform-origin: center` 或指定焦点。',
  },
  {
    id: 'C02', cat: 'camera', name: '极缓拉出',
    when: '收尾 / 揭示全貌',
    how: '从 `scale(1.08)` 拉到 `scale(1)`，配合 `opacity` 最后 20% 微微下降（.95）。',
    pitfall: '拉出会让边缘露底，画布必须 `overflow:hidden`。',
  },
  {
    id: 'C03', cat: 'camera', name: '横向平移',
    when: '图比画布宽 / 需要"巡视"感',
    how: '图 `width: 130%; height: 100%; object-fit: cover`，' +
      '`transform: translateX(calc(var(--p) * -22%))`，匀速从右到左。',
    pitfall: '位移量要按图实际宽度算，超过会露白边。',
  },
  {
    id: 'C04', cat: 'camera', name: '焦点转移',
    when: '一张图有前后景（前模糊→后清晰）',
    how: '两层同一张图：底层 `filter: blur(6px) brightness(.8)`，上层用 `clip-path` 圈出焦点区，' +
      '`clip-path` 的半径随 `--p` 扩大（从 18% 到 46%）。',
    pitfall: '需要图本身有明确主体；否则"焦点"落在杂乱处反而更差。',
  },
  {
    id: 'C05', cat: 'camera', name: '双层视差',
    when: '想做出"深度"（前景动得快、背景动得慢）',
    how: '背景层 `translateY(calc(var(--p) * -6%))`、前景层 `translateY(calc(var(--p) * -18%))`，' +
      '两者速度比 1:3。',
    pitfall: '两层必须同色系，否则像两张图拼的。',
  },

  /* ══════════════ Rhythm · 节奏（4 张，纯视觉节奏，不依赖音频） ══════════════ */
  {
    id: 'R01', cat: 'rhythm', name: '三段快切',
    when: '信息密集段 / 需要"爽"',
    how: '一段里塞 3 个短镜头（各 0.5~0.8s），每个用**硬切**（不用淡入）：' +
      '`opacity` 直接 0→1，靠 `--p` 的台阶（0 / 0.33 / 0.66）切换。',
    pitfall: '每镜必须有**明显不同**的构图，否则看着像"抖了一下"。',
  },
  {
    id: 'R02', cat: 'rhythm', name: '逐步加速',
    when: '升级段 / 情绪递进',
    how: '元素进场间隔从 160ms 递减到 60ms（用 `calc` 按 `--p` 计算），' +
      '越往后越快 ⇒ 制造"压迫感"。',
    pitfall: '最后不要快过 40ms，否则糊成一片。',
  },
  {
    id: 'R03', cat: 'rhythm', name: '突然静止',
    when: '高潮前的"屏息"',
    how: '在某个时间点（例如 `--p = 0.62`）让**所有动效停住**，只有一个小元素（一个点 / 一条线）继续动。' +
      '停 0.6~1s 再爆。',
    pitfall: '"停"必须是真的停（不要缓慢减速），否则没有"顿"的感觉。',
  },
  {
    id: 'R04', cat: 'rhythm', name: '闪光三连',
    when: '强调一个数字 / 一个词',
    how: '同一元素连续 3 次 `opacity` 从 1 到 .2 再回 1，间隔 120ms，' +
      '像闪光灯。之后**完全静止**。',
    pitfall: '超过 3 次会像"故障"；闪完必须静止，否则没有落点。',
  },
]

/** 按类别渲染成提示词片段 */
export function renderCardsExtra(cats: Array<ExtraCard['cat']>): string {
  const NAME: Record<string, string> = {
    light: '【打光 · Light & Emphasis】',
    transition: '【转场 · Transition】',
    camera: '【运镜 · Camera】',
    rhythm: '【节奏 · Rhythm】',
  }
  const out: string[] = []
  for (const c of cats) {
    const list = CARDS_EXTRA.filter((x) => x.cat === c)
    if (!list.length) continue
    out.push(NAME[c])
    out.push(list.map((x) =>
      `${x.id} **${x.name}**\n  用在哪：${x.when}\n  怎么做：${x.how}`
      + (x.pitfall ? `\n  ⚠️ 坑：${x.pitfall}` : '')
    ).join('\n\n'))
    out.push('')
  }
  return out.join('\n')
}
