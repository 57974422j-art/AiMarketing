#!/usr/bin/env node
/**
 * ★VF_FILM2PAGE_V1 —— 「成片」生成器：风格包 + 多段镜头组 → 一条可渲染的片
 * =============================================================================
 * · pack-to-page.mjs  单页 3 秒试片（看"风格对不对"）
 * · film-to-page.mjs  **多段成片**（每段 = 一个结构/镜头组 + 自己的时长/素材/文案）
 *
 * ★ 为什么是"新入口 + 新契约"，而不是往 deck.schema.json 里加 `scene` 页型：
 *   deck 那 12 种制式页型是老线（图片成片/图视混剪/PPT+图视）在跑的契约，动它=动老线。
 *   这里走独立入口：老链路一行不改，且天然满足"新东西失败 ⇒ 调用方回退老画法"。
 *
 * ★ 多段的 CSS / DOM 约定（实测踩过才定下来的）：
 *   多段共用一个 HTML 文件 ⇒ **不能用 id**（id 会撞，`#t1` 会同时命中所有段）。
 *   所以：① 段落用**结构类名**作用域 `.st-<structure>`；② 元素一律用**类名**（.t1/.t2/.sub/.media…）；
 *        ③ 运行时按 `#sc<i> .t1` 在段内查找，互不干扰。
 *
 * film.json 契约（v0.1）：
 * { "id":"demo-30s", "pack":"pipeline-green", "fps":25,
 *   "scenes":[ { "structure":"opening-hero", "dur":4.0,
 *                "slots":{...}, "media":["a.jpg"] }, ... ] }
 * 已实现结构（6）：opening-hero / works-wall / glass-product / data-dashboard / fullbleed / grid-2x2
 */
import fs from 'node:fs'
import path from 'node:path'
// ★VF_FILMBLEEDFIX_V1：量"实拍在被压字那一条上的亮度"要用 ffmpeg（与渲染器钉同一个可执行文件的口径一致）
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const RUNTIME = path.join(HERE, 'tools', 'runtime', 'film.js')
const GSAP = path.join(HERE, 'masters', 'master-tech', 'assets', 'gsap.min.js')
const FONTS = path.join(HERE, 'fonts')
// ★VF_PLATE_V1（2026-10-10 用户定案「每 10 张图必须有 3~4 张**完整大图**」）：
//   新增两种"完整大图"结构（实拍**整张不裁**且占满画幅 93% 宽）——
//     · plate-top    大标题在上 · 完整大图在下
//     · plate-bottom 完整大图在上 · 文案在下
//   为什么是两种：用户实测「前片一律」（每页一个模子）就是"只有一个版式"害的；
//   同一结构隔页交替 ⇒ 有大图占比、又不重复。
export const FILM_STRUCTS = ['opening-hero', 'works-wall', 'glass-product', 'data-dashboard', 'fullbleed', 'grid-2x2', 'plate-top', 'plate-bottom']

// ★VF_FILMNODEMO_V1（2026-10-09 用户实测：火锅素材的片子里出现
//   「实时投放监控 / 45% / 12.4 万 / 4.8 % / 3.2 千」「数据驱动增长 / 78.5%」「一次成型」等）：
//   根因 = **这里的内置示例数据在兜底**（编排器没填的镜，渲染层自己编了一套）。
//   直接违反用户定过的反 AI 味规矩②「不许编造数据」。现口径：**只画调用方真的给了的**——
//   文案类字段全清空（不再兜底产品自夸词/示例标题），数字类清空，
//   唯一保留的是 `nums`（那是四宫格的**编号位次** 01~04，不是数据，缺了会让格子没有序号）。
const D = {
  eyebrow: '', title1: '', title2: '', title: '', sub: '',
  value: '', unit: '',
  rows: [], kpi: [], chips: [], nums: ['01', '02', '03', '04'], tail: '', foot: '',
}
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const mediaTag = (m) => m ? `<img class="fill" src="${esc(m)}" alt="" />` : `<div class="ph"><span>素材</span></div>`

/* ═════════ ★VF_SPEC_V1：风格语法层（L1 构图 / L2 动效 / L3 文本形态）═════════
   为什么有这一层（用户一句话点破的根因：「换了颜色，样式一模一样」）：
     pack 只给 **L0 皮肤（tokens）**，而"怎么排 / 怎么动 / 字长什么样"被写死在结构 CSS 里
     ⇒ 换 pack 只换色，样式必然一模一样。
   实验证据：`docs/风格语法-实验记录.md` —— **tokens 完全相同**、只换 L1/L2/L3 出三条片，
     肉眼就是三套，且**同一套闸门对三种语法都有效**（字表 ✓ / WCAG AA ✓）。
   现口径（用户 2026-10-10 定案「这四项全部让 AI 自己规划」）：
     · 规格优先级 **film.spec > pack.spec > 默认**；
     · 引擎**不写死**任何风格阈值：越界只做两件事 —— ① 夹回合法区间并**如实打印**
       ② 出片后校验"成片是否符合它自己声明的值"（declared vs actual，见 render-film 的
       `image.complete` / `pacing.minShotSec` / `gates.minImageWidth` 三条声明式校验）。
   字段（对齐实验记录 §⑧/§⑩ 草案）：
     layout.system  axis|grid|free      中轴 / 严格网格 / 自由错位
     layout.whitespace 0.08~0.55        留白档（越小越满）
     image.place    mat|mat-tape|fullbleed  相纸 | 相纸+胶带 | 满幅裁切
     image.complete true|false          是否保证整张不裁（声明式，AI 按风格定）
     pacing.minShotSec number           单图最短可见时长（0 = 不声明）
     motion.img     push|pop|fade
     motion.ease    out|back|inout
     motion.type    overlay|sticker|vertical
     motion.cross   0.06~0.8            段间交叉时长
     text.titleForm overlay|sticker|vertical
     text.ornament  rule|tape|hairline|none
     gates.minImageWidth number         最小图宽（0 = 不声明）
   ⚠ 本文件是模板字符串：注释里不许出现反引号。 */
export const SPEC_DEF = {
  layout: { system: 'axis', whitespace: 0.20 },
  image: { place: 'mat', complete: true },
  pacing: { minShotSec: 0 },
  motion: { img: 'push', ease: 'out', type: 'overlay', cross: 0.5 },
  // ★VF_SPEC_V1b（2026-10-10 用户问"要不要加些字体让设计上档次"）：**不换字体**也能提档次的三条 ——
  //   text.weight   标题字重（100~900；字体是可变字体，权重随便给）
  //   text.tracking 标题**字距**（em；大标题收紧、小标签拉开 —— 最见效的一条）
  //   text.scale    **字号倍率**（只动标题，副题不动 ⇒ 拉开"字号阶梯"）
  text: { titleForm: 'overlay', ornament: 'rule', weight: 800, tracking: 0.02, scale: 1 },
  gates: { minImageWidth: 0 },
}
const SPEC_ENUM = {
  'layout.system': ['axis', 'grid', 'free'],
  'image.place': ['mat', 'mat-tape', 'fullbleed'],
  'motion.img': ['push', 'pop', 'fade'],
  'motion.ease': ['out', 'back', 'inout'],
  'motion.type': ['overlay', 'sticker', 'vertical'],
  'text.titleForm': ['overlay', 'sticker', 'vertical'],
  'text.ornament': ['rule', 'tape', 'hairline', 'none'],
}
const SPEC_RANGE = {
  'layout.whitespace': [0.08, 0.55],
  'motion.cross': [0.06, 0.8],
  'pacing.minShotSec': [0, 9],
  'gates.minImageWidth': [0, 720],
  // ★VF_SPEC_V1b：文字排版三档（范围给得宽，但**越界会夹回并打印**）
  'text.weight': [100, 900],
  'text.tracking': [-0.04, 0.2],
  'text.scale': [0.7, 1.4],
}
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const getP = (o, p) => p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o)
const setP = (o, p, v) => { const ks = p.split('.'); let a = o; for (let i = 0; i < ks.length - 1; i++) a = a[ks[i]]; a[ks[ks.length - 1]] = v }

/** 归一化 spec：film.spec > pack.spec > 默认；非法枚举回默认、越界夹回区间 —— **都打印，不静默** */
export function normSpec(filmSpec, packSpec) {
  const warns = []
  const out = JSON.parse(JSON.stringify(SPEC_DEF))
  for (const p of [...Object.keys(SPEC_ENUM), ...Object.keys(SPEC_RANGE), 'image.complete']) {
    const fv = getP(filmSpec, p), pv = getP(packSpec, p)
    const hasF = fv !== undefined && fv !== null && fv !== ''
    const hasP = pv !== undefined && pv !== null && pv !== ''
    let v = hasF ? fv : hasP ? pv : getP(SPEC_DEF, p)
    const from = hasF ? 'film.spec' : hasP ? 'pack.spec' : '默认'
    if (SPEC_ENUM[p]) {
      const s = String(v)
      if (!SPEC_ENUM[p].includes(s)) {
        warns.push(p + ' =「' + s + '」（' + from + '）不在 ' + SPEC_ENUM[p].join('/') + ' ⇒ 退回默认 ' + getP(SPEC_DEF, p))
        v = getP(SPEC_DEF, p)
      }
    } else if (SPEC_RANGE[p]) {
      const n = Number(v)
      const [lo, hi] = SPEC_RANGE[p]
      if (!Number.isFinite(n)) { warns.push(p + ' =「' + v + '」（' + from + '）不是数字 ⇒ 退回默认 ' + getP(SPEC_DEF, p)); v = getP(SPEC_DEF, p) }
      else if (n < lo || n > hi) { const c = Math.min(hi, Math.max(lo, n)); warns.push(p + ' = ' + n + '（' + from + '）越界[' + lo + ',' + hi + '] ⇒ 夹回 ' + c); v = c }
    } else {
      v = !(v === false || v === 'false' || v === 0 || v === '0')
    }
    setP(out, p, v)
  }
  return { spec: out, warns }
}

/** L1/L2/L3 → CSS（放在结构级 CSS **之后** ⇒ 天然覆盖）。只动"能表达语法差异"的量，不重写结构。
 *  ⚠️ 缩放/旋转**不能用 transform 写在 .plate/.ttl 上** —— 运行时 GSAP 会写同一属性（y/rotate），
 *     CSS 的 transform 会被覆盖 ⇒ 所以这里一律用 width/left/top（尺寸与位置），
 *     旋转交给运行时按 spec 一起补（见 runtime/film.js 的 plateRot）。 */
export function specCss(spec) {
  const ws = Number(spec.layout.whitespace)
  const t = (ws - 0.08) / 0.47                       // 0（密）→ 1（疏）
  const sys = spec.layout.system, place = spec.image.place, form = spec.text.titleForm, orn = spec.text.ornament
  const base = 1 - t * 0.30                          // 密度 → 相纸占比：1.00 → 0.70
  const sc = (sys === 'grid' ? base * 0.92 : sys === 'free' ? Math.min(1, base * 1.06) : base).toFixed(3)
  const ctr = '(720px - 696px * var(--matScale)) / 2'
  const needTape = place === 'mat-tape' || orn === 'tape'
  const L = []
  L.push('/* ---- ★VF_SPEC_V1 语法层（L1 构图 / L2 动效 / L3 文本形态）---- */')
  L.push('.sec{--matScale:' + sc + ';--ws:' + ws
    + ';--ttlW:' + Number(spec.text.weight) + ';--ttlTrack:' + Number(spec.text.tracking)
    + 'em;--ttlScale:' + Number(spec.text.scale) + '}')
  // ★VF_SPEC_V1b：**不换字体**也能提档次的三条（字重 / 字距 / 字号阶梯）——
  //   字距那条最见效：大标题**收紧**（-0.02em）会显得"贵"，小标签**拉开**（+0.08~0.15em）会显得"精致"。
  L.push('.sec .ttl{font-weight:var(--ttlW);letter-spacing:var(--ttlTrack)}')
  // 字号阶梯：只放大/缩小**标题**（副题不动 ⇒ 阶梯拉开）。各结构的标题基数见下表。
  const TTL_PX = {
    'opening-hero': [['.t1', 78], ['.t2', 78]], 'works-wall': [['.ttl', 46]], 'glass-product': [['.ttl', 46]],
    'fullbleed': [['.ttl', 56]], 'plate-top': [['.ttl', 56]], 'plate-bottom': [['.ttl', 56]],
    'grid-2x2': [['.ttl', 46]], 'data-dashboard': [['.t1', 64]],
  }
  Object.keys(TTL_PX).forEach((st) => TTL_PX[st].forEach(([sel, px]) => {
    L.push('.st-' + st + ' ' + sel + '{font-size:calc(' + px + 'px * var(--ttlScale))}')
  }))
  // ⚠️ 实测（本机首渲就被引擎 check 拦下）：标题一放大（scale 1.15）就**压住副题**
  //   （content_overlap）。这是"声明放大"的必然代价 ⇒ 语法层**自动给副题让位**：
  //   副题下移 (scale-1) × K，K 取标题基数的 ≈1.3 倍（一行行高的余量）。
  //   （标题排到两三行时仍可能压 ⇒ 引擎 check 仍是最后一道防线。）
  const SUB_PX = {
    'opening-hero': [['.sub', '436px', 101]], 'works-wall': [['.sub', '242px', 60]], 'glass-product': [['.sub', '242px', 60]],
    'fullbleed': [['.sub', '962px', 73]], 'plate-top': [['.sub', '292px', 73]],
    // plate-bottom 的副题位置**已经**吃 whitespace（见上面那两行）⇒ 这里必须把两项都写上，不能覆盖掉
    'plate-bottom': [['.sub', 'calc(880px + (1 - var(--matScale)) * 80px)', 73]],
    'grid-2x2': [['.sub', '240px', 60]], 'data-dashboard': [['.ex', '280px', 83]],
  }
  Object.keys(SUB_PX).forEach((st) => SUB_PX[st].forEach(([sel, base, k]) => {
    L.push('.st-' + st + ' ' + sel + '{top:calc(' + base + ' + (var(--ttlScale) - 1) * ' + k + 'px)}')
  }))
  // ① L1：相纸尺寸随"留白档"变；文案跟着图走（plate-bottom 文在图下）
  L.push('.st-plate-top .plate{width:calc(696px * var(--matScale));height:calc(522px * var(--matScale));'
    + 'left:calc(' + ctr + ');top:calc(378px + (1 - var(--matScale)) * 96px)}')
  L.push('.st-plate-bottom .plate{width:calc(696px * var(--matScale));height:calc(522px * var(--matScale));'
    + 'left:calc(' + ctr + ');top:calc(154px + (1 - var(--matScale)) * 60px)}')
  L.push('.st-plate-bottom .ttl{top:calc(726px + (1 - var(--matScale)) * 80px)}')
  L.push('.st-plate-bottom .sub{top:calc(880px + (1 - var(--matScale)) * 80px)}')
  // ② L1 image.complete=false ⇒ 声明"此风格固定裁切"：图改 cover（不保证完整）
  if (!spec.image.complete) {
    L.push('.sec .shot{object-fit:cover}')
    L.push('.sec .pb{opacity:0}')
  }
  // ③ L1 image.place：满幅（**只作用于"整页单图"那三类结构**）
  //   ★VF_SPEC_V2 修（2026-10-10 用户线上实测：出片被引擎 check 拦下 ——
  //     #sc5 > div:nth-of-type(1) inside div.row.r1 "作品展示" — Two text blocks overlap）：
  //     老写法把 .sec .ttl{top:832px;font-size:60px} 这类**满幅重定位**应用到**所有结构** ⇒
  //     第 6 段（works-wall「作品展示」）的标题被搬到 832px，正好压在它自己的 .row.r1{top:820px} 上
  //     ⇒ 必然重叠 ⇒ 拒渲。**根因：满幅只对"整页单图"成立；多图页（works-wall / grid-2x2 /
  //     data-dashboard）本来就该保持网格** —— place 不该跨结构乱搬字。
  //   现口径：满幅只做三件事（图铺满整页 + 压一层暗场 + 字转白加投影），
  //     **文案位置一律沿用该结构自己的排版**（沿用 = 上次能过闸门的坐标，不再自造重叠），
  //     并用 :is(...) 限定在三类整页单图结构上。
  const FB = '.sec[data-place="fullbleed"]:is(.st-fullbleed,.st-plate-top,.st-plate-bottom)'
  if (place === 'fullbleed') {
    L.push(FB + ' .plate{left:0;top:0;width:720px;height:1280px;border-radius:0;background:#0b0d10;box-shadow:none}')
    L.push(FB + ' .pb{opacity:0}')
    L.push(FB + ' .shot{object-fit:cover}')
    L.push(FB + ' .plate::after{content:"";position:absolute;left:0;top:0;width:100%;height:100%;'
      + 'background:linear-gradient(180deg,rgba(0,0,0,.52) 0%,rgba(0,0,0,.10) 40%,rgba(0,0,0,.78) 100%)}')
    L.push(FB + ' .eb,' + FB + ' .ttl,' + FB + ' .sub,' + FB + ' .foot,' + FB + ' .chips{'
      + 'z-index:4;color:#fff;text-shadow:0 2px 14px rgba(0,0,0,.5)}')
    L.push(FB + ' .chip{background:rgba(255,255,255,.16);border-color:rgba(255,255,255,.42);color:#fff}')
  }
  // ④ L1 image.place=mat-tape / L3 ornament=tape：胶带（两角贴条）
  //   ★VF_SPEC_V2：与满幅**互斥**（胶带属"相纸感"、满幅属"电影感"，而且两者都要占 .plate 的伪元素）
  //     ⇒ 满幅时**整体不生成胶带规则**（老写法是先压一条 display:none，会把满幅的暗场 ::after 一起灭掉）。
  if (needTape && place !== 'fullbleed') {
    L.push('.sec .plate::before,.sec .plate::after{content:"";position:absolute;width:104px;height:26px;'
      + 'background:rgba(240,236,222,.86);border-left:1px solid rgba(0,0,0,.08);border-right:1px solid rgba(0,0,0,.08);'
      + 'box-shadow:0 1px 3px rgba(0,0,0,.18);z-index:5}')
    L.push('.sec .plate::before{left:-26px;top:18px;transform:rotate(-38deg)}')
    L.push('.sec .plate::after{right:-26px;bottom:22px;transform:rotate(-38deg)}')
  }
  // ⑤ L1 layout.system：grid（严格网格 + 细线 + 更大留白）/ free（错位）
  if (sys === 'grid') {
    L.push('.sec .ttl{letter-spacing:2.6px;font-weight:700}')
    L.push('.sec .ttl::after{content:"";display:block;width:88px;height:2px;background:var(--accent);margin-top:16px}')
    L.push('.sec .sub{letter-spacing:.6px}')
  } else if (sys === 'free') {
    L.push('.sec .ttl{left:44px}')
    L.push('.st-plate-top .plate,.st-plate-bottom .plate{left:calc(' + ctr + ' + 12px)}')
    L.push('.sec .chips{left:52px}')
  }
  // ⑥ L3 text.titleForm：sticker（色块贴纸）/ vertical（竖排）
  //   ★VF_SPEC_V3（2026-10-10 预防性收口 —— 与满幅那条是**同一类**问题）：
  //     这两个形态会**改标题盒本身**（inline-block 撑高 / writing-mode 变竖柱）并把字挪到**右列**，
  //     而 works-wall / grid-2x2 的标题下面紧贴卡片与网格（.c3{left:472,width:180}、.g2{left:368,width:296}
  //     都伸到 x≈664 = 右列所在处）⇒ 竖排标题必然压上去（就是上一轮 content_overlap 那一类成因）。
  //     同理 glass-product / data-dashboard 有自己的内容块（.main 宽 608px 也铺到 x=664）。
  //   现口径：标题形态**只作用于"标题独占一条带"的结构**；密集页（works-wall / grid-2x2）
  //     与有内容块的结构（glass-product / data-dashboard）保持自己排版。
  const FORM_OK = ':is(.st-fullbleed,.st-plate-top,.st-plate-bottom,.st-opening-hero)'
  if (form === 'sticker') {
    L.push('.sec' + FORM_OK + ' .ttl{display:inline-block;width:auto;max-width:600px;background:var(--accent);color:#fff;'
      + 'padding:12px 20px 15px;border-radius:2px;box-shadow:0 10px 26px rgba(0,0,0,.22);letter-spacing:2px}')
  } else if (form === 'vertical') {
    // ★VF_SPEC_V1 实测（quiet 语法首渲就被引擎 check 拦下）：
    //   只写 writing-mode 会**竖排成一根长柱** ⇒ 压到副标题/图（content_overlap：ttl.t1 压 sub）。
    //   现口径：竖排**走右列**（标题在右上、副题在右下），并把相纸让到左侧 —— 竖排才不会与横排串味。
    L.push('.sec' + FORM_OK + ' .ttl{writing-mode:vertical-rl;letter-spacing:.16em;line-height:1.1;width:auto;max-height:620px;'
      + 'left:auto;right:56px;top:110px}')
    L.push('.sec' + FORM_OK + ' .ttl.t2{right:206px}')        // 开场两行：第二列再往左，避免两列互压
    L.push('.sec' + FORM_OK + ' .sub{writing-mode:vertical-rl;width:auto;max-height:470px;letter-spacing:.08em;font-size:21px;'
      + 'left:auto;right:56px;top:770px}')
    L.push('.sec' + FORM_OK + ' .eb{left:auto;right:56px;top:56px}')
    L.push('.sec' + FORM_OK + ' .plate{left:24px;width:calc(560px * var(--matScale));height:calc(420px * var(--matScale))}')
    L.push('.sec' + FORM_OK + ' .chips{left:56px}')
  }
  // ⑦ L3 ornament：rule（细线）/ hairline（无装饰）
  if (orn === 'none' || orn === 'hairline') L.push('.sec .ttl::after{display:none}')
  return L.join('\n')
}

/** 每个结构的 **类名版** CSS（作用域 = .st-<structure>，可被所有段共用） */
export function filmCssFor(st) {
  if (st === 'opening-hero') return `
.st-opening-hero .eb{left:64px;top:120px}
.st-opening-hero .t1{left:64px;top:180px;width:600px;font-size:78px}
.st-opening-hero .t2{left:64px;top:300px;width:600px;font-size:78px}
.st-opening-hero .sub{left:64px;top:436px;width:600px;font-size:26px}
.st-opening-hero .media{right:48px;top:540px;width:288px;height:500px}`.trim()
  if (st === 'works-wall') return `
.st-works-wall .ttl{left:64px;top:170px;width:600px;font-size:46px}
.st-works-wall .sub{left:64px;top:242px;width:600px;font-size:24px}
.st-works-wall .c1{left:68px;top:340px;width:180px;height:380px}
.st-works-wall .c2{left:270px;top:380px;width:180px;height:380px}
.st-works-wall .c3{left:472px;top:340px;width:180px;height:380px}
.st-works-wall .row{left:64px;width:600px;font-size:23px;color:var(--ink)}
.st-works-wall .r1{top:820px}.st-works-wall .r2{top:872px}.st-works-wall .r3{top:924px}`.trim()
  if (st === 'glass-product') return `
.st-glass-product .ttl{left:64px;top:170px;width:600px;font-size:46px}
.st-glass-product .sub{left:64px;top:242px;width:600px;font-size:24px}
.st-glass-product .main{left:56px;top:430px;width:608px;height:300px}
.st-glass-product .num{position:absolute;left:40px;top:74px;width:220px;text-align:center;font-size:58px;font-weight:900;color:var(--ink)}
.st-glass-product .num .u{font-size:26px;margin-left:4px;color:var(--at)}
/* ⚠ 这两行必须自带 position:absolute —— 选择器 .sec > * 只兜住**直接子元素**，
   .kt / .krow 在 .glass.main 里面（嵌套），只写 left/top 会被忽略 ⇒ 三行指标退回文档流叠在一起
   （实测：引擎 check 判 content_overlap，t=11.25~13.88s）。同族坑第 3 次出现，务必记住。
   ⚠⚠ 本文件是模板字符串：**注释里不许出现反引号**（第 3 次栽在这上面了，见 VF_TOOLSYNTAX）。 */
.st-glass-product .kt{position:absolute;left:300px;top:44px;font-size:24px;font-weight:700;color:var(--ink)}
.st-glass-product .krow{position:absolute;left:300px;width:250px;display:flex;justify-content:space-between;font-size:20px;color:var(--dim)}
.st-glass-product .krow b{color:var(--at)}
.st-glass-product .kr1{top:104px}.st-glass-product .kr2{top:148px}.st-glass-product .kr3{top:192px}
.st-glass-product .mini{width:296px;height:130px}
.st-glass-product .mini span{position:absolute;left:22px;top:24px;font-size:19px;color:var(--dim)}
.st-glass-product .mini b{position:absolute;left:22px;top:56px;font-size:36px;font-weight:900;color:var(--ink)}
.st-glass-product .m1{left:56px;top:766px}.st-glass-product .m2{left:368px;top:766px}.st-glass-product .m3{left:56px;top:918px}
/* ★VF_FILMGLASS_V1：调用方没给 kpi 时（主卡带 .noKpi）大数字居中，免得右边空一块 */
.st-glass-product .main.noKpi .num{left:0;width:608px;text-align:center;top:104px;font-size:96px}
.st-glass-product .cta{left:56px;top:1096px;width:608px;height:78px;border-radius:39px;overflow:hidden;
  background:linear-gradient(100deg,var(--accent),color-mix(in srgb,var(--accent) 40%,#8b7bff));
  display:flex;align-items:center;justify-content:center;font-size:27px;font-weight:800;color:#06101f;letter-spacing:3px}
.st-glass-product .shine{position:absolute;top:0;left:0;width:170px;height:100%;
  background:linear-gradient(100deg,rgba(255,255,255,0),rgba(255,255,255,.55),rgba(255,255,255,0))}`.trim()
  if (st === 'data-dashboard') return `
.st-data-dashboard .k{left:64px;top:120px;font-size:16px;font-weight:700;letter-spacing:3.4px;color:var(--at)}
.st-data-dashboard .t1{left:64px;top:176px;width:600px;font-size:64px}
.st-data-dashboard .ex{left:64px;top:280px;width:600px;font-size:25px}
.st-data-dashboard .ring{left:190px;top:430px}
.st-data-dashboard .num{left:230px;top:560px;width:260px;text-align:center;font-size:74px;font-weight:900;color:var(--ink)}
.st-data-dashboard .num .u{font-size:30px;color:var(--at)}
.st-data-dashboard .kpi{width:600px;height:96px;border-radius:var(--r);display:flex;align-items:center;justify-content:space-between;
  padding:0 26px;background:rgba(16,26,44,.78);border:1px solid rgba(140,200,255,.22)}
.st-data-dashboard .kpi span{font-size:22px;color:var(--dim)}
.st-data-dashboard .kpi b{font-size:34px;font-weight:800;color:var(--ink)}
.st-data-dashboard .kp1{left:56px;top:880px}.st-data-dashboard .kp2{left:56px;top:996px}.st-data-dashboard .kp3{left:56px;top:1112px}`.trim()
  if (st === 'fullbleed') return `
.st-fullbleed .full{left:0;top:0;width:720px;height:1280px}
.st-fullbleed .full img{width:100%;height:100%;object-fit:cover;display:block}
.st-fullbleed .scrimT{left:0;top:0;width:720px;height:360px;
  background:linear-gradient(180deg,rgba(4,8,16,.92) 0%,rgba(4,8,16,.55) 55%,rgba(4,8,16,0) 100%)}
.st-fullbleed .scrimB{left:0;bottom:0;width:720px;height:660px;
  background:linear-gradient(0deg,rgba(4,8,16,.96) 0%,rgba(4,8,16,.84) 42%,rgba(4,8,16,.30) 78%,rgba(4,8,16,0) 100%)}
.st-fullbleed .eb{left:56px;top:96px}
.st-fullbleed .ttl{left:56px;top:876px;width:608px;font-size:56px}
.st-fullbleed .sub{left:56px;top:962px;width:608px;font-size:24px}
.st-fullbleed .chips{left:56px;top:1044px}`.trim()
  // ★VF_PLATE_V1：**完整大图**的 CSS。边缘处理口径（用户把"边缘怎么处理"交给实现）：
  //   4:3 实拍放进 9:16 竖屏，四周必然留空 ⇒ 不留生硬黑边/白边，而是**同图放大模糊**补满图框，
  //   外面再套一圈 8px 白边 + 极淡投影（像一张冲洗出来的照片压在纸上）⇒ 干净、不"AI 感"。
  //   .shot 用 object-fit:contain ⇒ **整张不裁**（非 4:3 的素材也是"完整 + 两侧模糊补满"，不是硬裁）。
  //   ⚠️ 图**永远不缩放**（不做 Ken Burns）：缩放会吃掉边缘 ⇒ 就不再是"完整"了。
  if (st === 'plate-top' || st === 'plate-bottom') return `
.st-plate-top .eb{left:56px;top:86px}
.st-plate-top .ttl{left:56px;top:138px;width:608px;font-size:56px;line-height:1.16}
.st-plate-top .sub{left:56px;top:292px;width:608px;font-size:26px;line-height:1.55}
.st-plate-top .plate{left:12px;top:378px;width:696px;height:522px}
.st-plate-top .chips{left:56px;top:994px}
.st-plate-bottom .eb{left:56px;top:86px}
.st-plate-bottom .plate{left:12px;top:154px;width:696px;height:522px}
.st-plate-bottom .ttl{left:56px;top:726px;width:608px;font-size:56px;line-height:1.16}
.st-plate-bottom .sub{left:56px;top:880px;width:608px;font-size:26px;line-height:1.55}
.st-plate-bottom .chips{left:56px;top:994px}
.st-plate-top .plate,.st-plate-bottom .plate{overflow:hidden;border-radius:3px;background:#fff;
  box-shadow:0 0 0 8px #fff,0 0 0 9px rgba(16,20,24,.10),0 18px 42px rgba(16,20,24,.20)}
.st-plate-top .pb,.st-plate-bottom .pb{position:absolute;left:0;top:0;width:100%;height:100%;
  background-size:cover;background-position:center;background-repeat:no-repeat;
  filter:blur(20px) saturate(.9) brightness(1.02);transform:scale(1.16)}
.st-plate-top .shot,.st-plate-bottom .shot{position:relative;display:block;width:100%;height:100%;object-fit:contain}`.trim()
  return `
.st-grid-2x2 .ttl{left:64px;top:168px;width:600px;font-size:46px}
.st-grid-2x2 .sub{left:64px;top:240px;width:600px;font-size:24px}
.st-grid-2x2 .g{width:296px;height:322px}
.st-grid-2x2 .g1{left:56px;top:320px}.st-grid-2x2 .g2{left:368px;top:320px}
.st-grid-2x2 .g3{left:56px;top:662px}.st-grid-2x2 .g4{left:368px;top:662px}
.st-grid-2x2 .n{padding:6px 12px 7px;border-radius:8px;background:rgba(5,12,22,.86);
  border:1px solid rgba(140,200,255,.3);font-size:18px;font-weight:700;color:var(--at)}
.st-grid-2x2 .n1{left:72px;top:336px}.st-grid-2x2 .n2{left:384px;top:336px}
.st-grid-2x2 .n3{left:72px;top:678px}.st-grid-2x2 .n4{left:384px;top:678px}
.st-grid-2x2 .tail{left:64px;top:1024px;width:600px;font-size:24px;color:var(--ink)}`.trim()
}

/** 结构 → 段落 DOM（**只用类名，不用 id** —— 多段共用一份 HTML） */
function sceneBody(st, sc, i) {
  const s = Object.assign({}, D, sc.slots || {})
  const md = sc.__media || []
  if (st === 'opening-hero') return `
    <div class="eb">${esc(s.eyebrow)}</div>
    <div class="ttl t1">${esc(s.title1)}</div>
    <div class="ttl t2 accent">${esc(s.title2)}</div>
    <div class="sub">${esc(s.sub)}</div>
    <div class="card media">${mediaTag(md[0])}</div>
    <div class="foot">${esc(s.foot)}</div>`
  if (st === 'works-wall') return `
    <div class="ttl ttl1">${esc(s.title)}</div>
    <div class="sub">${esc(s.sub)}</div>
    <div class="card cd c1">${mediaTag(md[0])}</div>
    <div class="card cd c2">${mediaTag(md[1])}</div>
    <div class="card cd c3">${mediaTag(md[2])}</div>
    ${s.rows.slice(0, 3).map((r, k) => `<div class="row r${k + 1}">${esc(r)}</div>`).join('')}
    <div class="foot">${esc(s.foot)}</div>`
  if (st === 'glass-product') {
    // ★VF_FILMGLASS_V1（2026-10-09 用户定案「反 AI 味 ②不许编造数据」时实测抓到）：
    //   病灶：老版本**无条件**渲染「关键指标（曝光 12.4万 / 点击率 4.8% / 下单 3.2千）」+
    //   三张**写死的迷你卡**（倍率 3 倍 / 耗时 6 分 / 成本 -62%）——
    //   火锅店片子里冒出"成本 -62%"这种经营数据，属于典型的"AI 脑补数据"（用户实测定过不许）。
    //   现口径：**只画调用方真的给了的**（给了才画，没给就不画；只做减法，绝不脑补）——
    //     · kpi   给了（3 组）才画「关键指标」块，标题可用 slots.kpiTitle 改（默认"关键指标"）；
    //     · mini  给了（3 组）才画三张迷你卡（老版本这三张是写死的）；
    //     · value/unit 也**必须来自 slots**（不再吃默认值，避免漏成 78.5% 这种示例数据）；
    //     · cta 给了才画（默认不再塞"立即体验"）。
    //   ⚠️ 没给 kpi 时主卡加 `.noKpi`（大数字居中），免得右边空一大块。
    const raw = sc.slots || {}
    const kpi = Array.isArray(raw.kpi) && raw.kpi.length >= 3 ? raw.kpi.slice(0, 3) : null
    const mini = Array.isArray(raw.mini) && raw.mini.length >= 3 ? raw.mini.slice(0, 3) : null
    const cta = raw.cta ? String(raw.cta) : ''
    const num = (raw.value !== undefined && raw.value !== null && String(raw.value) !== '')
      ? `<div class="num">${esc(raw.value)}<span class="u">${esc(raw.unit || '')}</span></div>` : ''
    // ★VF_FILMGLASS_V2（2026-10-09 用户实测「结尾卡是个空白卡片框」）：
    //   上一版（V1）只改了"没给就不画内容"，但**玻璃主卡那个框还是照画** ⇒ 结尾卡只剩一个
    //   淡粉圆角空框（实测：最后 3 秒满屏就这一个空格子）。现口径：**框里啥都没有就整块不画**
    //   （title/sub/eyebrow 照旧 —— 那是文案，不属于"编造数据"）。
    const hasBox = !!(num || kpi)
    return `
    <div class="eb">${esc(s.eyebrow)}</div>
    <div class="ttl ttl1">${esc(s.title)}</div>
    <div class="sub">${esc(s.sub)}</div>
    ${hasBox ? `<div class="glass main${kpi ? '' : ' noKpi'}">
      ${num}
      ${kpi ? `<div class="kt">${esc(raw.kpiTitle || '关键指标')}</div>` + kpi.map((k, i) => `<div class="krow kr${i + 1}"><span>${esc(k[0])}</span><b>${esc(k[1])}</b></div>`).join('') : ''}
    </div>` : ''}
    ${mini ? mini.map((m, i) => `<div class="glass mini m${i + 1}"><span>${esc(m[0])}</span><b>${esc(m[1])}</b></div>`).join('') : ''}
    ${cta ? `<div class="cta">${esc(cta)}<span class="shine"></span></div>` : ''}`
  }
  if (st === 'data-dashboard') {
    // ★VF_FILMDASH_V1（2026-10-09 用户实测：火锅片里出现「实时投放监控 / 45% / 12.4万 / 4.8% / 3.2千」）：
    //   与 glass-product 同一条红线（反 AI 味②不许编造数据）。旧实现**无条件**读 `s.kpi` / `s.value`，
    //   而 `s` 会吃到上面 D 的示例数据 ⇒ 假数据必然出现（上次只修了 glass，**漏了这里**，这次补齐）。
    //   现口径：**给了才画** —— kpi 给满 3 组才画指标条；value 给了才画大数字与圆环。
    const raw = sc.slots || {}
    const kpi = Array.isArray(raw.kpi) && raw.kpi.length >= 3 ? raw.kpi.slice(0, 3) : null
    const hasNum = raw.value !== undefined && raw.value !== null && String(raw.value) !== ''
    const num = hasNum
      ? `<div class="num">${esc(raw.value)}<span class="u">${esc(raw.unit || '')}</span></div>` : ''
    const ring = hasNum
      ? `<div class="ring"><svg width="340" height="340" viewBox="0 0 340 340">
      <circle cx="170" cy="170" r="152" fill="none" stroke="rgba(150,185,215,.16)" stroke-width="13"/>
      <circle class="ringArc" cx="170" cy="170" r="152" fill="none" stroke="var(--accent)" stroke-width="13"
        stroke-linecap="round" stroke-dasharray="955" stroke-dashoffset="999" transform="rotate(-90 170 170)"/>
    </svg></div>` : ''
    return `
    <div class="k">${esc(s.eyebrow)}</div>
    <div class="ttl t1">${esc(s.title)}</div>
    <div class="sub ex">${esc(s.sub)}</div>
    ${ring}
    ${num}
    ${kpi ? kpi.map((k, i) => `<div class="cd kpi kp${i + 1}"><span>${esc(k[0])}</span><b>${esc(k[1])}</b></div>`).join('') : ''}
    <div class="foot">${esc(s.foot)}</div>`
  }
  if (st === 'fullbleed') return `
    <div class="full">${mediaTag(md[0])}</div>
    <div class="scrimT"></div><div class="scrimB"></div>
    <div class="eb">${esc(s.eyebrow)}</div>
    <div class="ttl">${esc(s.title)}</div>
    <div class="sub">${esc(s.sub)}</div>
    <div class="chips">${s.chips.slice(0, 4).map((c) => `<div class="chip">${esc(c)}</div>`).join('')}</div>
    <div class="foot">${esc(s.foot)}</div>`
  // ★VF_PLATE_V1：完整大图段（同一份 DOM，靠 .st-plate-top / .st-plate-bottom 决定文在图下还是图上）
  if (st === 'plate-top' || st === 'plate-bottom') {
    const raw = md[0] || ''
    const inner = raw
      ? `<div class="pb" style="background-image:url('${esc(raw)}')"></div><img class="shot" src="${esc(raw)}" alt="" />`
      : `<div class="ph"><span>素材</span></div>`
    return `
    <div class="eb">${esc(s.eyebrow)}</div>
    <div class="ttl">${esc(s.title)}</div>
    <div class="sub">${esc(s.sub)}</div>
    <div class="plate">${inner}</div>
    <div class="chips">${(s.chips || []).slice(0, 4).map((c) => `<div class="chip">${esc(c)}</div>`).join('')}</div>
    <div class="foot">${esc(s.foot)}</div>`
  }
  return `
    <div class="ttl ttl1">${esc(s.title)}</div>
    <div class="sub">${esc(s.sub)}</div>
    <div class="card g g1">${mediaTag(md[0])}</div>
    <div class="card g g2">${mediaTag(md[1])}</div>
    <div class="card g g3">${mediaTag(md[2])}</div>
    <div class="card g g4">${mediaTag(md[3])}</div>
    ${s.nums.slice(0, 4).map((n, k) => `<div class="n n${k + 1}">${esc(n)}</div>`).join('')}
    <div class="tail">${esc(s.tail)}</div>
    <div class="foot">${esc(s.foot)}</div>`
}

const lum = (hex) => { const h = String(hex || '#000').replace('#', ''); const n = parseInt(h.length === 3 ? h[0] + h[0] + h[1] + h[1] + h[2] + h[2] : h, 16) || 0; return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255 }

/** ★VF_FILMBLEEDFIX_V1（2026-10-09 用户实测「全幅实拍上字看不见 / 深色渐变很丑」）用：
 *  量一张图某个**横带**（y 用 0~1 比例）的平均亮度（0~255，ffmpeg signalstats 的 YAVG）。
 *  · 失败返回 −1 ⇒ 调用方**一个字都不改**（量不出来就维持原样式，绝不瞎猜）。
 *  · 按 文件+区间 缓存（同一张图常被多段复用）。 */
const _lumaCache = new Map()
function bandLuma(file, y0, y1) {
  const key = file + '|' + y0 + '|' + y1
  if (_lumaCache.has(key)) return _lumaCache.get(key)
  let v = -1
  try {
    const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-vf',
      `crop=iw:ih*${(y1 - y0).toFixed(4)}:0:ih*${y0.toFixed(4)},signalstats,metadata=print:file=-`,
      '-f', 'null', '-'], { encoding: 'utf8', timeout: 20000 })
    const m = /lavfi\.signalstats\.YAVG=([\d.]+)/.exec(String(r.stdout || ''))
    if (m) v = parseFloat(m[1])
  } catch { v = -1 }
  _lumaCache.set(key, v)
  return v
}

/** ★VF_FILMBLEEDFIX_V1：全幅实拍段（fullbleed）的"按**实测亮度**自动改字色 + 自动选遮罩"。
 *  为什么要它（用户实拍的病）：这个 pack 的字色是**为浅色纸面**设计的（ink=深字、accent=暗红），
 *  一旦 fullbleed 把**任意实拍**铺满整屏，就变成"深字压深图" ⇒ 看不见；而两条 scrim 又是**写死的深色**，
 *  压到暗图上既没用、又把画面弄脏（用户原话："渐变效果怎么出现非常不好"）。
 *  口径（对齐老引擎 ★VF_DECK_CONTRAST_V1：字色 vs 底的实际亮度 |Δ| ≥ 70）：
 *   · 底暗（YAVG < 120）⇒ **亮字**（ink→白、dim→浅灰、accent 太暗就换白）+ 遮罩**减淡**（用户定过"餐饮要亮"）
 *   · 底亮（YAVG ≥ 120）⇒ **深字** + **亮遮罩**（不把图压黑，自然也就"亮"）
 *   · 量不到 ⇒ 返回空串（零回归）
 *  ⚠️ 只动**这一段的字色 + 两条 scrim + chip 底色**；版式/位置/动效一律不动。 */
function bleedCss(i, lm, T, AT) {
  const bot = Number(lm && lm.bot)
  if (!(bot >= 0)) return ''
  const sel = '#sc' + i
  const dark = bot < 120
  const out = []
  if (dark) {
    if (lum(T.ink) < 0.6) out.push(`${sel}{--ink:#ffffff;--dim:#e9f0f8}`)
    if (lum(AT) < 0.55) out.push(`${sel}{--at:#ffffff}`)
    out.push(`${sel} .scrimT{background:linear-gradient(180deg,rgba(0,0,0,.55) 0%,rgba(0,0,0,.22) 60%,rgba(0,0,0,0) 100%)}`)
    out.push(`${sel} .scrimB{background:linear-gradient(0deg,rgba(0,0,0,.62) 0%,rgba(0,0,0,.42) 42%,rgba(0,0,0,.12) 78%,rgba(0,0,0,0) 100%)}`)
    out.push(`${sel} .ttl{text-shadow:0 2px 12px rgba(0,0,0,.6)}`)
    out.push(`${sel} .chip{background:rgba(255,255,255,.16);border-color:rgba(255,255,255,.42);color:#fff}`)
  } else {
    if (lum(T.ink) > 0.35) out.push(`${sel}{--ink:#15181c;--dim:#3a4048}`)
    // ★VF_PLATE_V1（2026-10-10 实测：全幅页的 eyebrow 用**强调红字**压在实拍上只有 3.96:1
    //   （need 4.5:1）被引擎闸门拦下。红字在照片上随像底起伏，压不住 ⇒ 亮底实拍一律改**深墨字**，
    //   并刻意把顶部遮罩加厚一档（.95/.70）—— 这样照片还是亮的，字也稳过 4.5:1。）
    out.push(`${sel}{--at:#15181c}`)
    out.push(`${sel} .scrimT{background:linear-gradient(180deg,rgba(255,255,255,.95) 0%,rgba(255,255,255,.70) 55%,rgba(255,255,255,0) 100%)}`)
    out.push(`${sel} .scrimB{background:linear-gradient(0deg,rgba(255,255,255,.95) 0%,rgba(255,255,255,.86) 42%,rgba(255,255,255,.42) 78%,rgba(255,255,255,0) 100%)}`)
    out.push(`${sel} .chip{background:rgba(255,255,255,.9);border-color:rgba(0,0,0,.14);color:#1b1f24}`)
  }
  return out.join('\n')
}

/** film → index.html（纯函数，不读盘） */
export function makeFilmHtml(film) {
  const pack = film.packObj || {}
  const T = Object.assign({ bg: '#0b0f14', bg2: '', ink: '#f0f5fa', dim: '#b8c6d6', accent: '#4dd7ff', font: 'sans-900', radius: 16, density: 'normal', grain: 0.04 }, pack.tokens || {})
  const serif = T.font === 'serif-700'
  const AT = T.accentText || T.accent
  const LIGHT = lum(T.bg) > 0.6
  // ★VF_SPEC_V1：语法层（film.spec > pack.spec > 默认）。越界/非法**打印出来**（不静默）
  const { spec, warns } = normSpec(film.spec, pack.spec)
  warns.forEach((w) => console.log('  ⚠ spec: ' + w))

  let t = 0
  const scenes = (film.scenes || []).map((sc, i) => {
    const st = FILM_STRUCTS.includes(sc.structure) ? sc.structure : 'opening-hero'
    const start = t; t += Number(sc.dur || 4)
    return { st, start, dur: Number(sc.dur || 4), sc }
  })
  const total = +t.toFixed(2)
  // ★VF_FILMTRANS_V1（2026-10-10 用户定案「能有转场效果最好」）：
  //   实测病灶（本机逐帧看出来的）：渲染器**按每段的 data-start/data-duration 掐窗口** ——
  //   上一段到 `S+D` 就被整段掐掉。于是「淡出还没走完/下一段还没铺上来」⇒ 3.9s 画面还在、
  //   4.0s 整页消失 ⇒ 中间空 0.5 秒。**任何转场都活不过这一掐**（叠化/擦除/推移全被掐成"黑一下"）。
  //   现口径：给每段窗口**多留 0.7s**（= 转场重叠区），段间由运行时按 trans 做真转场。
  const OVER = 0.7
  // ★VF_SPEC_V1：每段带上语法属性（CSS 靠 data-sys / data-place / data-form / data-complete 覆盖；
  //   这样"同一套结构"在不同语法下长相不同 ⇒ 治"换了颜色、样式一模一样"）
  const specAttr = `data-sys="${spec.layout.system}" data-place="${spec.image.place}" data-form="${spec.text.titleForm}" data-complete="${spec.image.complete ? 1 : 0}"`
  const body = scenes.map((x, i) => `<section class="sec clip st-${x.st}" ${specAttr} id="sc${i}" data-start="${x.start.toFixed(2)}" data-duration="${(x.dur + OVER).toFixed(2)}">\n${sceneBody(x.st, x.sc, i)}\n  </section>`).join('\n')
  const usedStructs = [...new Set(scenes.map((x) => x.st))]
  // ★VF_FILMBLEEDFIX_V1：按"实测亮度"给全幅段做**局部**字色/遮罩修正（量不到的段一段都不改）
  const bleedFix = scenes.map((x, i) => bleedCss(i, x.sc.__luma, T, AT)).filter(Boolean).join('\n')

  return `<!doctype html>
<html lang="zh-CN">
<!-- 由 tools/film-to-page.mjs 生成（film=${esc(film.id)} · 风格包=${esc(pack.id || 'inline')} · ${scenes.length} 段 · ${total}s）
     独立入口：**不改 deck 契约**；新东西失败时调用方回退老画法。 -->
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=720, height=1280" />
<title>${esc(film.name || film.id)}</title>
<style>
  @font-face{font-family:'NotoSansSC';src:url('assets/NotoSansSC-sub.woff2') format('woff2');font-weight:100 900;font-display:block}
  ${serif ? "@font-face{font-family:'NotoSerifSC';src:url('assets/NotoSerifSC-sub.woff2') format('woff2');font-weight:200 900;font-display:block}" : ''}
  :root{ --bg:${T.bg}; --bg2:${T.bg2 || T.bg}; --ink:${T.ink}; --dim:${T.dim}; --accent:${T.accent}; --at:${AT}; --r:${T.radius}px; }
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{width:720px;height:1280px;background:var(--bg)}
  body{font-family:${serif ? "'NotoSerifSC'" : "'NotoSansSC'"},system-ui,sans-serif;overflow:hidden}
  .clip{position:absolute}
  #filmBg{left:0;top:0;width:720px;height:1280px}
  #stage{position:relative;width:720px;height:1280px;overflow:hidden}
  .sec{position:absolute;left:0;top:0;width:720px;height:1280px}
  .sec > *{position:absolute}
  .eb{font-size:16px;font-weight:700;letter-spacing:3.4px;color:var(--at)}
  .ttl{font-weight:800;color:var(--ink);letter-spacing:1px;line-height:1.2}
  .ttl.accent{color:var(--at)}
  .sub{color:var(--dim)}
  .foot{left:64px;top:1180px;font-size:18px;color:var(--dim)}
  .card{overflow:hidden;border-radius:var(--r);border:1px solid color-mix(in srgb, var(--accent) 34%, transparent);box-shadow:0 16px 38px rgba(0,0,0,.45)}
  .ph{width:100%;height:100%;display:flex;align-items:center;justify-content:center;
      background:${LIGHT ? 'linear-gradient(135deg,color-mix(in srgb, var(--accent) 18%, #ffffff) 0%, #e6ebf2 100%)' : 'linear-gradient(135deg,color-mix(in srgb, var(--accent) 26%, #0a1020) 0%, rgba(10,16,32,.9) 100%)'}}
  .ph span{font-size:20px;font-weight:700;color:var(--ink);opacity:.85}
  .fill{width:100%;height:100%;object-fit:cover;display:block}
  .glass{position:absolute;border-radius:calc(var(--r) + 8px);background:rgba(255,255,255,.10);
    border:1px solid rgba(255,255,255,.22);backdrop-filter:blur(16px) saturate(1.2);
    box-shadow:0 18px 46px rgba(2,6,24,.42),inset 0 1px 0 rgba(255,255,255,.14)}
  .chip{padding:10px 16px 11px;border-radius:10px;background:rgba(10,22,36,.8);
    border:1px solid rgba(140,200,255,.3);font-size:19px;color:#eaf3ff;margin-right:12px;display:inline-block}
  #barIn{display:block;width:100%;height:100%;background:var(--accent);transform-origin:left center}
  #bar{position:absolute;left:0;bottom:0;width:720px;height:4px;background:rgba(130,180,230,.16)}

  /* ---------- 结构级（每个结构自带作用域 .st-xxx，多段共用不会串味） ---------- */
${usedStructs.map(filmCssFor).join('\n')}
  /* ---------- ★VF_SPEC_V1 语法层（放在结构级之后 ⇒ 天然覆盖；L1 构图 / L2 动效 / L3 文本形态） ---------- */
${specCss(spec)}
  /* ---------- ★VF_FILMBLEEDFIX_V1：全幅段按**实测亮度**局部改字色/遮罩（量不到的段没有这几行） ---------- */
${bleedFix}
</style>
</head>
<body>
<div id="stage" data-composition-id="main" data-start="0" data-duration="${total}"
     data-fps="${film.fps || 25}" data-width="720" data-height="1280">
  <canvas id="filmBg" class="clip" data-start="0" data-duration="${total}" data-track-index="0" width="720" height="1280"></canvas>
${body}
  <div id="bar" class="clip" data-start="0" data-duration="${total}" data-track-index="9"><i id="barIn"></i></div>
</div>
<script>window.__FILM__ = ${JSON.stringify({ tokens: T, total, spec, scenes: scenes.map((x) => ({ structure: x.st, start: x.start, dur: x.dur, trans: String(x.sc.trans || '') })) })};</script>
<script>window.__timelines = window.__timelines || {}; window.__timelines["main"] = { seek: function () {}, duration: function () { return ${total}; }, pause: function () {}, play: function () {} };</script>
<script src="assets/gsap.min.js"></script>
<script src="assets/film.js"></script>
</body>
</html>
`
}

/** film → 磁盘项目（拷素材/运行时/字体）。返回 { dir,file,total,structs,missing } */
export function buildFilm(film, outDir, filmDir) {
  const missing = []
  const picked = []            // [{src,name}] —— 实际要拷进 assets 的文件（**名字统一改成 s{i}_{k}**）
  const scenes = (film.scenes || []).map((sc, i) => {
    const media = (sc.media || []).map((m, k) => {
      const src = path.resolve(filmDir || '.', m)
      if (!fs.existsSync(src)) { missing.push(m); return null }
      const name = `s${i}_${k}${path.extname(src).toLowerCase() || '.jpg'}`
      picked.push({ src, name })
      return name
    })
    return { ...sc, media, __media: media.map((x) => (x ? 'assets/' + x : '')) }
  })
  // ★VF_FILMBLEEDFIX_V1：给 fullbleed 段量"字压在什么亮度上"（上带 = eyebrow / 下带 = 标题·副题·chips）
  //   —— 量的是**源图**；量不到就留 −1（makeFilmHtml 那边一个字都不改 ⇒ 零回归）
  for (let i = 0; i < scenes.length; i++) {
    const st = FILM_STRUCTS.includes(scenes[i].structure) ? scenes[i].structure : 'opening-hero'
    if (st !== 'fullbleed') continue
    const raw0 = String((((film.scenes || [])[i] || {}).media || [])[0] || '')
    if (!raw0) continue
    const src = path.resolve(filmDir || '.', raw0)
    if (!fs.existsSync(src)) continue
    scenes[i].__luma = { top: bandLuma(src, 0.03, 0.16), bot: bandLuma(src, 0.66, 0.95) }
  }
  const f2 = { ...film, scenes }
  const assets = path.join(outDir, 'assets')
  fs.mkdirSync(assets, { recursive: true })
  fs.writeFileSync(path.join(outDir, 'hyperframes.json'), JSON.stringify({
    $schema: 'https://hyperframes.heygen.com/schema/hyperframes.json',
    paths: { blocks: 'compositions', components: 'compositions/components', assets: 'assets' },
    media: { autoProxy: true },
  }, null, 2), 'utf8')
  fs.writeFileSync(path.join(outDir, 'index.html'), makeFilmHtml(f2), 'utf8')
  fs.copyFileSync(GSAP, path.join(assets, 'gsap.min.js'))
  fs.copyFileSync(RUNTIME, path.join(assets, 'film.js'))
  fs.copyFileSync(path.join(FONTS, 'NotoSansSC-sub.woff2'), path.join(assets, 'NotoSansSC-sub.woff2'))
  if (((film.packObj || {}).tokens || {}).font === 'serif-700') fs.copyFileSync(path.join(FONTS, 'NotoSerifSC-sub.woff2'), path.join(assets, 'NotoSerifSC-sub.woff2'))
  // ★ 素材用**改名后**的名字拷进 assets（与 makeFilmHtml 里生成的 src="assets/s{i}_{k}.jpg" 严格一致 ——
  //   实测踩过：一处按原名拷、一处按改名引用 ⇒ 素材全丢，页面只剩占位块。
  for (const x of picked) fs.copyFileSync(x.src, path.join(assets, x.name))
  const total = scenes.reduce((a, s) => a + Number(s.dur || 4), 0)
  // ★VF_FILMFORK_V1（2026-10-10）：**不许静默降级** —— 引擎只实现 FILM_STRUCTS 这 8 种结构，
  //   喂进来一个没实现的结构（例如库里名叫 `fullbleed-kenburns`、而引擎只认 `fullbleed`），
  //   老实现会**悄悄把它渲成开场卡**（用户就会看到"某一页莫名其妙变成封面"，且没有任何报错）。
  //   现口径：把没实现的结构**列出来**交给调用方（render-film 会据此拒渲并报 stage=structure）。
  const unknown = [...new Set((film.scenes || []).map((s) => String(s.structure || ''))
    .filter((s) => s && !FILM_STRUCTS.includes(s)))]
  return {
    dir: outDir,
    file: path.join(outDir, 'index.html'),
    total: +total.toFixed(2),
    structs: scenes.map((s) => FILM_STRUCTS.includes(s.structure) ? s.structure : 'opening-hero'),
    unknown,   // ← 非空即"有结构没实现"，调用方应拒渲（可用结构见 FILM_STRUCTS）
    missing,
  }
}

/* CLI */
import { pathToFileURL } from 'node:url'
const isCli = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
if (isCli) {
  const args = process.argv.slice(2)
  const arg = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d }
  const filmPath = args.find((a) => !a.startsWith('--'))
  if (!filmPath) { console.error('用法: node tools/film-to-page.mjs <film.json> --out <目录>'); process.exit(2) }
  const film = JSON.parse(fs.readFileSync(filmPath, 'utf8'))
  const outDir = path.resolve(HERE, arg('out', path.join('out', 'film', film.id)))
  const r = buildFilm(film, outDir, path.dirname(path.resolve(filmPath)))
  console.log(`生成：${path.relative(HERE, r.file)}（${r.structs.length} 段 · ${r.total}s · 结构 ${r.structs.join('/')}）`)
  if (r.missing.length) console.log('  ⚠ 缺素材：' + r.missing.join(', '))
  if (r.unknown && r.unknown.length) console.log('  ✗ 引擎没实现这些结构（会被 render-film 拒渲）：' + r.unknown.join('、'))
}
