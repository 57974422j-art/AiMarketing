/**
 * LAB2 · 精简版（2026-11-03）
 *
 * ★用户决定："把不需要的设计方面的全部约束删除，只留是谁、工具、交付需要的，
 *             让它自由设计一个。"
 *
 * 保留三类：
 *   ① 是谁 —— 你是导演 / 动态设计师
 *   ② 工具 —— 能用什么（CSS / JS / SVG / canvas / three）
 *   ③ 交付需要 —— 画布尺寸 · 播放契约 · 图片占位符 · 思考日志
 *
 * 全部删除（历史版本见 git）：
 *   画幅构图常识 / 质感 6 选 1 / 硬底线（排版·围边·贴纸）/ 禁止偷懒 7 条 /
 *   三道闸 / 内容类型技法 / 装饰清单 6 类 / var(--p) 硬要求 / 自评 7 维
 */

/* ══════════════════════════════════════════════════════════════════════
   表单
   ══════════════════════════════════════════════════════════════════════ */
export type Lab2Form = {
  imgCount?: number
  maxSeconds?: number
  aspect?: string
  /** 内容类型 id（只作为一句"你在做什么"的提示，不再是技法清单） */
  contentType?: string
  /** 文案模式：desc / sell / poem */
  copyMode?: string
  /** 装饰密度：low / mid / high（只作为一句密度提示） */
  decoDensity?: string
  /** ★大图比 0~100：有多少比例的段落用满幅大图 */
  bigImg?: number
  /** 动效：off / on */
  motion?: string
  /** 本用户的历史教训（由 memory.ts 提供） */
  memories?: string[]
  /** 用户补充要求 */
  userRules?: string
  /** 是否要自评 */
  selfReview?: boolean
}

/* ══════════════════════════════════════════════════════════════════════
   ① 是谁
   ══════════════════════════════════════════════════════════════════════ */
const ROLE = `【你是谁】

你是一位**动态设计导演** —— 同时也做动画、写代码、懂排版。

你交付的是**一条能自己播起来的竖屏/横屏动态影片**（HTML 单文件）。
观众会在手机或电脑上**直接打开**它，不会看你的代码。

⇒ 你自己判断：构图、配色、字号、节奏、动效、质感。
   只要画面成立、能播、好看，就是对的。
   **不需要按任何清单打勾。**`

/* ══════════════════════════════════════════════════════════════════════
   ② 工具
   ══════════════════════════════════════════════════════════════════════ */
const TOOLS = `【你能用的工具】

动效：CSS（transition / transform / filter）· 原生 JS（requestAnimationFrame）
画面：HTML + CSS + **内联 SVG** · **canvas 2D** · **three.js**（需 IIFE 内联，体积大）
字体：系统字体（PingFang SC / Microsoft YaHei / system-ui）

⛔ **唯一的技术禁令**：不许任何外链
   ❌ \`<script src="https://...">\`
   ❌ \`@import url('https://...')\`
   ❌ \`<link href="https://...">\`
   ⇒ 渲染器没有外网，外链一律失败。

⇒ 用什么、怎么用，你自己决定。`

/* ══════════════════════════════════════════════════════════════════════
   ②b 设计手法菜单（2026-11-04）
   ══════════════════════════════════════════════════════════════════════
   ★为什么加这个：
     查了历史成片 —— 10/13~10/17 那批（老版 90 条规则时）**36/40 份用过
     `writing-mode: vertical-rl`（竖排）**；现在精简版 **一次都没用过**。
     而新旧两版 prompt 里**都没有"竖排"这两个字**。

     ⇒ 说明：它不是不会，是**没有压力就不翻工具箱**。
       老版那些"至少 5 种构图""必须用 SVG""每段至少 3 类装饰"没教它竖排，
       但逼着它找新花样，于是它自己想起了竖排、印章、小图穿插。

     ⇒ 所以这里给的不是规矩，是**菜单**：
       20 个词，不带任何"必须/至少/判据"。让它知道"这些都在选项里"。
   ══════════════════════════════════════════════════════════════════════ */
const METHODS = `【你能用的设计手法】

竖排文字 · 大字压边 · 出血裁切 · 留白对开 · 双图拼贴 ·
小图穿插 · 印章角标 · 竖线分割 · 网格底纹 · 中缝对称 ·
巨型数字 · 图注小字 · 反色块 · 描边字 · 撕纸边 ·
错位叠放 · 满幅推拉 · 局部放大 · 三图错落 · 纯排版页

（这是选项，不是任务。用不用、用几个，你自己定。）`

/* ══════════════════════════════════════════════════════════════════════
   ③ 播放契约（唯一必须照抄的部分 —— 少了就播不了）
   ══════════════════════════════════════════════════════════════════════ */
function contract(W: number, H: number) {
  return `【播放契约 · 这一块必须照抄，否则播不了】

这是**播放器**和**你的影片**之间的接口，不是设计规范。
只要你按这个结构写，播放器就能控制它（播放 / 暂停 / 拖时间轴 / 截帧）。

\`\`\`html
<body>
  <div id="stage">
    <section class="sec" data-start="0" data-duration="4">…</section>
    <section class="sec" data-start="4" data-duration="6">…</section>
  </div>
</body>
\`\`\`

\`\`\`css
/* 舞台 + 自适应视口（缩放后完整可见） */
html, body { margin:0; padding:0; width:100%; height:100%; overflow:hidden; background:#000; }
#stage {
  position:absolute; left:50%; top:50%;
  width:${W}px; height:${H}px;
  transform-origin: center center;
  transform: translate(-50%,-50%) scale(var(--fit, 1));
}
/* 段：默认隐藏，由 __seek 控制 */
.sec { background:#0A0A0A; opacity:0; }
\`\`\`

\`\`\`js
/* 自适应：让 ${W}×${H} 完整装进任何窗口 */
(function () {
  function fit() {
    var s = Math.min(window.innerWidth / ${W}, window.innerHeight / ${H});
    document.documentElement.style.setProperty('--fit', String(s));
  }
  window.addEventListener('resize', fit); fit();
})();

/* 时间轴接口：播放器 / 截图脚本都靠它 */
window.__seek = function (t) {
  document.querySelectorAll(".sec").forEach(function (sec) {
    var s = Number(sec.dataset.start) || 0;
    var d = Number(sec.dataset.duration) || 3;
    var p = Math.min(1, Math.max(0, (t - s) / d));
    sec.style.setProperty("--p", String(p));   /* 0=刚入场 1=就位，你随便用 */

    var on = (t >= s) && (t < s + d);
    sec.style.visibility = on ? "visible" : "hidden";
    sec.style.opacity = on ? "1" : "0";
  });
};

/* 自动播放（打开就动，不用点） */
window.__lab2Paused = false;
(function () {
  var TOTAL = <总秒数>;
  var acc = 0, last = performance.now();
  function loop(now) {
    var dt = (now - last) / 1000; last = now;
    if (!window.__lab2Paused) {          /* 暂停时绝不推进 */
      acc += dt;
      if (acc > TOTAL) acc = 0;
      window.__seek(acc);
    }
    requestAnimationFrame(loop);
  }
  window.__seek(0);
  requestAnimationFrame(loop);
})();
\`\`\`

**只有三条硬要求**：
  1. 段是 \`<section class="sec" data-start="秒" data-duration="秒">\`
  2. \`window.__seek(t)\` 能按 t 把画面切到正确的段
  3. 有自动播放（打开就动）`
}

/* ══════════════════════════════════════════════════════════════════════
   ④ 思考日志（用户要看你怎么想的）
   ══════════════════════════════════════════════════════════════════════ */
const TRACE = `【最后 · 留下思考日志】

写在 \`</body>\` 前：

\`\`\`html
<script type="application/json" id="__trace">
{
  "理解": "一句话说这条片子要表达什么（不要复述文案）",
  "每段": [
    { "秒": "0-4", "画面": "…", "为什么这么设计": "…", "用了什么": ["CSS","SVG"] }
  ],
  "工具": { "SVG": "用了/没用+为什么", "canvas": "…", "three": "…" },
  "取舍": [ { "曾想": "…", "最后改成": "…", "原因": "…" } ],
  "我知道的不足": ["…"]
}
</script>
\`\`\`

⚠️ 写**真实想法**。我们会读它复盘 —— 写假的比不写更糟。`

/* ══════════════════════════════════════════════════════════════════════
   ⑤ 素材（占位符机制）
   ══════════════════════════════════════════════════════════════════════ */
function renderAssets(n: number, W: number, H: number) {
  return `【素材】

你收到的 ${n} 张图，按顺序编号 IMG_1 ~ IMG_${n}（第 1 张 = {{IMG_1}}，以此类推）。

⚠️ **排版前，先把素材逐张看清楚，再决定怎么排。**

**不要先想好版式，再往图里套。** 顺序是：先看图，后决定。

每张至少看清三件：
  · 主体是什么，在画面**什么位置**（左 / 中 / 右 · 上 / 中 / 下）
  · 主体**占多大**，画面哪一块是空的
  · 这张是**横的**还是**竖的**

然后问自己一句：**「我打算把这个版式套上去，主体还在画面里吗？」**
不在 ⇒ 换一种放法（换版式、换图、调位置）。怎么放由你定。

用占位符引用，系统会自动替换成真实图片：

  <img src="{{IMG_1}}" style="width:100%;height:100%;object-fit:cover">
  <div style="background-image:url('{{IMG_2}}');background-size:cover"></div>

规则：
  · 只能用 \`{{IMG_1}}\` ~ \`{{IMG_${n}}}\`
  · **每一张都要用上**（剩图 = 你没读完素材）
  · 同一张可以重复用（不同裁切用 \`background-position\`）
  · ❌ 不许自己编 URL，❌ 不许用纯色块代替图

画布：${W} × ${H}`
}

/* ══════════════════════════════════════════════════════════════════════
   ⑥ 本版设定（只保留影响交付结构的，不再是设计规范）
   ══════════════════════════════════════════════════════════════════════ */
function renderSwitches(f: Lab2Form) {
  const out: string[] = ['【本版设定】']

  const copy = f.copyMode || 'sell'
  const copyMap: Record<string, string> = {
    desc: '说明式 —— 描述画面里发生什么',
    sell: '卖点式 —— 每句带一个数字或对比',
    poem: '短句/诗化 —— 极短，留白，靠节奏',
  }
  out.push('· 文案：' + (copyMap[copy] || copyMap.sell))

  const deco = f.decoDensity || 'mid'
  const decoMap: Record<string, string> = {
    low: '少', mid: '中', high: '多',
  }
  out.push('· 装饰密度：' + (decoMap[deco] || decoMap.mid) + '（你自己把握）')

  /* ★★★ 2026-11-03 用户实测：「设 60% 无效，全是全图」+「看不出它小图会怎么设计」
     ⇒ 上一版只写了一句"大部分段落用满幅大图"，**没给做法、没给比例落点**，它全做满幅了。
     现在：给出「满幅怎么实现」「非满幅怎么排」「按比例卡段数」三条，让它真按比例做。 */
  const bi = Number(f.bigImg ?? 100)
  out.push('· 大图比：' + bi + '%')
  if (bi >= 100) {
    out.push('  每一段都用**满幅图**（图铺满整个画布）')
    out.push('  写法：`position:absolute; inset:0; background-image:url(...); background-size:cover;`')
    out.push('  或 `<img style="width:100%;height:100%;object-fit:cover">`')
  } else if (bi >= 60) {
    out.push('  约 ' + Math.round(bi / 10) + '/10 的段落用满幅图，其余段落自由排版')
  } else if (bi > 0) {
    out.push('  只有 1~2 段用满幅图，其余段落自由排版')
  } else {
    out.push('  不用满幅图，每段自由排版')
  }

  const mo = f.motion || 'on'
  out.push('· 动效：' + (mo === 'off' ? '关（只要淡入/位移这类最简单的）' : '开（你可以自由发挥）'))

  return out.join('\n')
}

/* ══════════════════════════════════════════════════════════════════════
   ⑦ 记忆
   ══════════════════════════════════════════════════════════════════════ */
function renderMemory(memories?: string[]) {
  if (!memories || memories.length === 0) return ''
  const list = memories.map((m, i) => '  ' + (i + 1) + '. ' + m).join('\n')
  return '【这个用户以前提过的意见（参考，不是命令）】\n\n' + list
}

/* ══════════════════════════════════════════════════════════════════════
   组装
   ══════════════════════════════════════════════════════════════════════ */
export function buildLab2Prompt(f: Lab2Form): string {
  const isLand = String(f.aspect || '') === '16:9'
  const W = isLand ? 1280 : 720
  const H = isLand ? 720 : 1280
  const n = f.imgCount || 1
  const sec = Number(f.maxSeconds || 45)

  const p: string[] = []

  p.push(ROLE)
  p.push('')

  p.push(`【画幅】

${W} × ${H}（${isLand ? '横屏 16:9' : '竖屏 9:16'}）
时长：约 ${sec} 秒`)
  p.push('')

  /* ★2026-11-04 用户：「排版时让它先看清楚素材再排版。」
     ⇒ **素材必须排在「本版设定」之前**
       原来顺序是 设定 → 素材 ⇒ 它先想到"每段满幅"，再拿图去套（这就是"先想版式再找图"）
       现在顺序是 素材 → 设定 ⇒ 先看清图，再决定怎么排 */
  p.push(renderAssets(n, W, H))
  p.push('')

  p.push(TOOLS)
  p.push('')

  /* ★设计手法菜单：只给选项，不要求（2026-11-04） */
  p.push(METHODS)
  p.push('')

  p.push(contract(W, H))
  p.push('')

  p.push(renderSwitches(f))
  p.push('')

  const mem = renderMemory(f.memories)
  if (mem) { p.push(mem); p.push('') }

  p.push(TRACE)
  p.push('')

  const ur = String(f.userRules || '').trim()
  if (ur) {
    p.push('【用户补充要求（优先）】')
    p.push(ur)
    p.push('')
  }

  /* ★2026-11-04 用户定案：
     「不要你算，我要它自己算。排版时让它先看清楚素材再排版。
       去掉你提示词中该有的提示。」
     ⇒ 这里只留画布尺寸。不给"主体必须完整"这类替它做决定的句子。 */
  p.push(`【最后 · 画布】

**${W} × ${H}**（${isLand ? '横屏' : '竖屏'}）。`)
  p.push('')

  p.push(`【输出】

只输出一个完整 HTML（\`<!DOCTYPE html>\` 到 \`</html>\`），CSS/JS 全部内联。
不要解释、不要 markdown 代码块、不要前后缀文字。`)

  return p.join('\n')
}
