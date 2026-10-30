/**
 * ★LAB_DAILY_V1（2026-10-30）
 * =============================================================================
 * 日报「实验线」提示词 —— **完全独立**，不进 `daily.ts` 的状态机，不生成任何卡片。
 *
 * 为什么要单独一条：
 *   用户已把「日报落地页」和「HTML 成片」当成品线，**不能碰**。
 *   而这几轮验证暴露了三个必须重构的东西：
 *     ① 图/图形压字（我自己的 demo 里就犯了：锅固定在画面正中，压住标题）
 *     ② 卖点排在文案类型之后（内容与形式顺序颠倒）
 *     ③ 元素一起出现，不是逐步出现
 *
 * 这版的核心是**分区硬约束**：上区只放字、中区只放主体、下区只放小字，
 * 任何跨区元素都算不合格。这是治"图压字"最直接的办法 —— 不靠 AI 自觉，靠坐标范围。
 */

export type LabSeg = {
  /** 上区主标题（≤10 字） */
  t1: string
  /** 上区副标题（≤12 字） */
  t2: string
  /** 下区一句话（带标点，12~22 字） */
  body: string
  /** 用哪些图（1~17），空数组 = 纯排版段 */
  imgs: number[]
}

export type LabForm = {
  /** 今日卖点 / 话术（内容，优先于形式） */
  sellingPoints?: string
  /** 文案类型：auto / 探店 / 带货 / 宠物 / 旅拍 / 写真 / 品牌 */
  tone?: string
  /** 画幅：9:16 / 16:9 */
  aspect?: string
  /** 大图 vs 多图（0~10，越大越偏大图） */
  plateRatio?: number
  /** 视觉风格：'' / warm / swiss / morandi / press / neon / mag */
  designStyle?: string
  /** 强化绘制：'' / some / focus */
  drawMode?: string
  /** 设计约束：strict / loose / free */
  tier?: string
  /** 首末段是否允许不用素材 */
  noImgEnds?: boolean
  /** 素材文件名（用于提示词里点名，如 1.jpg~17.jpg） */
  imgCount?: number
  /** 思考档位：open 开 / save 省 / off 关（关 = 传 thinking:{type:'disabled'}） */
  thinkMode?: string
  /** 用户补充要求（留空 = 用默认 6 条） */
  userRules?: string
}

/* ══════════════════════════════════════════════════════════════════════════
   一、分区硬约束 —— 这是本线最重要的部分
   ══════════════════════════════════════════════════════════════════════════ */
/**
 * ★LAB_PLAN_V2 阶段0（2026-10-30 用户定案「硬坐标分区这个不要，鸡肋，影响设计」）
 *
 * 病灶（已用截图证实）：上一版写的是
 *     上区 0~480 只许放字 / 中区 480~1040 只许放主体 / 下区 1040~1220 只许放小字
 *   ⇒ AI 全部遵守（标题放 y=60、图放 y=900），但结果是 **中间 750px 全空**，
 *     而且图 top=900 + 高度 400 ⇒ 延伸到 1300 ⇒ **被 overflow 裁掉下半截**。
 *   ⇒ 结论：**硬坐标只能管"别重叠"，管不住"别空"，还限制设计**。
 *
 * 现口径（学 video-talkcraft 的 `references/layout.md`）：**不给坐标，改成"交付前自检"** ——
 *   · 包围盒不相交（文字×文字、文字×主体）
 *   · 不许靠裁切藏住越界（top + 高度 ≤ 画布高 − 40）
 *   · 同屏元素预算（8~14 个）
 *   · 纵向必须用满（最底元素下沿 ≥ 画布高 − 120）
 *   · 每个元素要么有对齐依据，要么是刻意的留白
 * ⇒ 设计自由度回来了，但错了能在自检里被抓。
 */
function selfCheckRules(h: number) {
  const bottomMin = Math.round(h - 120)
  return `【交付前必须自检的六条（这是**检查结果**，不是限制你排版）】
写完页面后，把下面六条逐条对照算一遍，**任意一条不通过就重排**：

  ① **包围盒不相交** —— 任意两个「有文字的元素」的矩形**不许相交**（边距 ≥ 8px）；
     任何「文字矩形」与「图片 / 图形主体的矩形」**不许相交**（边距 ≥ 24px）。
     ⇒ 这就是"别让文字和动效互相挤压"。**宁可把主体缩小或挪开，也不许压字**。
     ⚠️ 用 \`top:50%\` + 负 margin 做居中时最容易犯 —— 务必验证它没压到文字。

  ② **不许靠裁切藏住越界** —— 任何图片 / 图形的 \`top + 高度 ≤ ${h - 40}\`。
     超出画布再用 \`overflow:hidden\` 藏住，等于**用户只看到图的上半截**，这是硬伤。
     宁可缩小，不许溢出。

  ③ **同屏元素预算 8~14 个** —— 数一下本段里"看得见的东西"（字块 / 图 / 图形 / 线条 / 色块）。
     少于 8 个 ⇒ 画面会空；多于 16 个 ⇒ 画面会挤。
     （背景层、遮罩、装饰细线不算）

  ④ **纵向必须用满** —— 本段**最靠下的可见元素**，其下沿 ≥ ${bottomMin}px；
     **最靠上的可见元素**，其上沿 ≤ 100px。
     ⇒ 不许出现「标题在顶、图在底、中间几百像素什么都没有」的排法。
     中间如果确实要留白，**必须有一个元素穿过它**（一条长线 / 一个大字 / 一个色块 / 一张图的延伸）。

  ⑤ **每个元素都要有理由** —— 它要么贴着栅格 / 基准线 / 其它元素对齐，
     要么是**刻意的留白**（为了呼吸或聚焦）。
     ❌ 不许"随机放在那儿"。

  ⑥ **本段至少 3 个元素有"完整的生命周期"** —— 进场 → 停留 → 让位（或至少进场 → 停留）。
     ⇒ 否则整段就是一个静态排版，像 PPT。

  ⚠️ 这六条是**结果检查**，不是位置限制 —— 你可以把标题放中间、把图放顶上，
     只要六条都过就行。`
}

/* ══════════════════════════════════════════════════════════════════════════
   二、六种视觉风格（只给参数，不锁版式）
   ══════════════════════════════════════════════════════════════════════════ */
const STYLES: Record<string, string> = {
  warm: `【本次风格 · 暖纸宋体（中式高端餐饮）】
· 底色 #F1E7D6，正文墨 #16100C，强调朱红 #A62B1F，点缀金 #C0955A；
· 标题用衬线 900 字重、字距 0.02~0.04em；正文细字（300）字距拉开到 0.30em；
· 严格左对齐、左右留白 52px；装饰用竖排小字贴左右边缘；
· 每屏要有 6 处以上文字：主标 / 副标 / 正文 / 页眉英文 / 编号 / 页脚三小字；
· 质感：极淡颗粒 + 暖色暗角；**不要纯白、不要纯黑**。`,

  swiss: `【本次风格 · 瑞士网格（设计感 / 年轻品牌）】
· 底纯黑 #0B0B0B，文字米白 #F2F2EC，强调荧光黄 #FFE500，辅助灰 #6E6E68 —— **只用这四种**；
· **全部无衬线**，标题 900 字重、字距收紧到 -0.045em，字号落差拉到 10 倍以上；
· **严格左对齐不许居中**；内容只占左侧 1/3，右侧留空；让 56px 网格线**可见**；
· 数字当视觉元素：把「23 / 32 / 5」单独放大；
· 动效：用 clip-path 遮罩掀开或硬切，**不要缓慢淡入**；
· 质感：不加阴影、不加渐变，只用 1px 细线和实色块。`,

  morandi: `【本次风格 · 莫兰迪灰调（温柔 / 女性向）】
· 底 #E8E2DA，主文字 #4A4540，强调 #A8907E，辅助 #8E9A8C —— 全部低饱和，**不许出现鲜艳色**；
· 衬线细字（400），字距 0.06em，字号落差只到 5 倍（**不要巨字**）；
· 居中，上下各留 25% 空白，画面要"空"；
· 每屏只放 5~7 处文字；
· 动效：极慢淡入，可加轻微 blur→清晰。`,

  press: `【本次风格 · 双色套印（复古印刷 / 老字号）】
· 纸黄 #F0E4C8 + **单色**靛蓝 #1B3A5C（或墨红 #8C2318）—— 只有两色；
· 粗黑体 900，字距收紧；英文全大写、字距 0.20em；
· 满幅，图文咬合紧凑，加 2~3px 粗边框；
· 质感：halftone 网点（repeating-radial-gradient）+ 套印错位 1~2px；
· 装饰：粗横线、编号、日期、价格戳。`,

  neon: `【本次风格 · 深夜霓虹（夜宵 / 酒吧）】
· 底 #0A0612（近黑紫），霓虹青 #19E3C2，霓虹粉 #FF3D7F，文字 #EDEDED；
· 无衬线 700，字距 0.02em，标题带发光（多层 text-shadow）；
· 居中偏下，大量暗部（上 2/3 可以很暗）；
· 质感：霓虹辉光 + 扫描线 + 重暗角；
· 动效：闪烁 + 扫描线缓慢扫过 + 由暗到亮。`,

  mag: `【本次风格 · 杂志编辑（内容型 / 长文案）】
· 纯白 #FFFFFF + 纯黑 #111111，强调红 #D93A1F —— 只有三种；
· 标题无衬线 900、字距 0、字号落差 10 倍；正文 400、行高 1.6；
· 多栏（2~3 栏），图注密集贴在图下（9~11px）；
· 每屏要有图注、标尺、页码、引文。
· 动效：像翻页（横向滑入 + 轻微旋转 1°）。`,
}

/* ══════════════════════════════════════════════════════════════════════════
   三、强化绘制（只在允许的区域内画）
   ══════════════════════════════════════════════════════════════════════════ */
const DRAW_RULES: Record<string, string> = {
  some: `【强化绘制 · 少量】
· 允许在**部分段落**加一个用代码画的实物（锅 / 杯子 / 店面 / 碗 / 蒸汽）；
· 判据：**一眼能认出是什么**，否则不如不画。`,
  focus: `【强化绘制 · 重点】
· **至少 1/3 的段落**要有一个用代码画的实物当视觉主体；
· 判据：**一眼能认出是什么**。`,
}

const DRAW_HOWTO = `【可用画法（照公式写，成功率高；⚠️ 全部必须放在 y=480~1040 的中区）】
· **锅（俯视）**：border-radius:50% 外圈铜色 conic-gradient + 内圈深红 radial-gradient
  + 3~5 个白色小圆当气泡 + 一条斜向高光（伪元素 rotate(-18deg)）
· **锅（侧视）**：矩形 + border-radius:12px 12px 86px 86px/12px 12px 64px 64px 做锅身，
  顶部扁椭圆当汤面，中央竖长方形当烟囱，三条 2px 竖线 + blur(1.5px) 当蒸汽
· **房子/店面**：矩形墙体 + repeating-linear-gradient(90deg,红 0 31px,米白 31px 62px) 当雨棚，
  两个矩形当窗（linear-gradient(#FFD99D,#C97931) + box-shadow 外发光），linear-gradient 十字当窗格
· **杯子**：矩形 + border-radius:6px 6px 14px 14px 做杯身，内部分层渐变当饮料，
  底部 6~10 个 6px 小圆当珍珠，顶部圆角矩形当杯盖，右上斜插 8px 宽圆角矩形当吸管
· **碗**：border-radius:50% / 0 0 100% 100% 的半圆，内套浅色椭圆当汤面
· **蒸汽/烟**：2px 竖线 + blur(1.5px) + linear-gradient(180deg,rgba(255,255,255,.6),transparent)
· **光晕**：径向渐变圆 + blur(50~80px) + 低透明度

画的时候必须守：
· **主体 ≥3 层**（外形 / 内填 / 高光或阴影），单层色块显得廉价；
· **不要用 emoji 代替绘制**；
· **绝对不许用 \`top:50%\` + 负 margin 的"居中"写法** —— 那一定压到上区文字。
  必须写成具体值：\`top:600px; height:400px\`（落在 480~1040 内）。`

/* ══════════════════════════════════════════════════════════════════════════
   四、动效（逐步出现，不是一起出来）
   ══════════════════════════════════════════════════════════════════════════ */
const MOTION_RULES = `【动效 · 必须逐步出现，不许一起蹦出来】
· 每段给**每个元素**不同的起始阈值：主标 0.00 / 副标 0.12 / 主体 0.20 / 正文 0.30 / 小字 0.40 / 装饰 0.50；
· 读数一律用 \`var(--p)\`：opacity: clamp(0, calc((var(--p) - 0.12) * 4), 1)；
· **位移 + 透明度至少两种属性一起变**（只有 opacity 不算动）；
· ⚠️ 不许用 \`@keyframes\` 承载 \`--p\`（引擎只改 --p 的值，不会重算动画）；
· ⚠️ 不许用 \`(1 - var(--p))\` 做出场淡出（那会让每段末尾变黑）。`

/* ══════════════════════════════════════════════════════════════════════════
   五、输出契约（技术项，必须照抄）
   ══════════════════════════════════════════════════════════════════════════ */
const CONTRACT = `【输出契约 · 技术项，必须照抄】
1) 页面按**时间播放**，不是滚动浏览。用若干：
   <section class="sec" data-start="秒" data-duration="秒"> 组成，**首帧不能空白**。
   ⚠️ **时长与段数（硬性，不达标算不合格）**：
     · **总时长 40~60 秒**（这是短视频的合理长度；低于 35 秒算不合格）
     · **段数 10~16 段**（每段 2.5~5 秒，**不要每段一样长**）
     · 素材少就多出「文字主导段」（大字页 / 金句页 / 清单页 / 数字页 / 收尾页），
       **但每段仍然要通过下面那六条自检**（尤其第④条"纵向必须用满"）。
2) **必须原样照抄**这段（唯一接口）：
   <script>
   window.__seek = function (t) {
     document.querySelectorAll(".sec").forEach(function (sec) {
       var s = Number(sec.dataset.start) || 0, d = Number(sec.dataset.duration) || 3;
       sec.style.setProperty("--p", String(Math.min(1, Math.max(0, (t - s) / d))));
     });
   };
   window.__seek(0);
   </script>
3) **每段必须有背景色**（不透明），并且**整段的 opacity 由 --p 控制**：
   .sec{background:<底色>; opacity:clamp(0, calc(var(--p) * 20), 1)}
   .sec:first-child{opacity:1}
   ⚠️ 这两行缺一不可：没有背景 ⇒ 段透明会叠字；没有整段 opacity ⇒ 后段盖死前段。
4) **零外部资源**：禁止 http(s):// 引用；图片用相对路径 \`1.jpg\`~\`17.jpg\`；
   字体只用 \`--font-serif: "TXT-Serif", serif;\` 和 \`--font-sans: "TXT-Sans", sans-serif;\`
   （不要写 Noto Serif SC 这种真实家族名，渲染器会整份拉取爆内存）。
5) 画布 ${'{W}'}×${'{H}'}；安全区左右 56px、上下 56px。
6) 禁止：emoji 当图标、编造数据、写"第几帧/底片/构图/留白/光影"这类谈照片本身的话。

7) ⚠️⚠️ **必须带「预览模式」—— 否则浏览器打开只能看到第一屏（这条最容易漏）**

   这个页面有**两种模式**：
     · \`data-mode="film"\`  → 出片用，引擎逐帧调 \`__seek\`，**不自动播**
     · \`data-mode="preview"\`（默认）→ 人看用，**所有段纵向铺开 + 可滚动**

   ⇒ 你要写的是 **preview 作为默认**，并且把下面这段**原样照抄**进页面（放在 </head> 前和 </body> 前）：

   \`\`\`
   <html data-mode="preview" lang="zh-CN">
   ...
   <style id="ai-preview-guard">
   :root{--daily-cw:${'{W}'}px;--daily-ch:${'{H}'}px}
   html:not([data-mode="film"]),html:not([data-mode="film"]) body{height:auto!important;overflow-y:auto!important;background:#000}
   html:not([data-mode="film"]) body>*{height:auto!important;max-height:none!important;overflow:visible!important}
   html:not([data-mode="film"]) #stage{height:auto!important;overflow:visible!important}
   html:not([data-mode="film"]) .sec{
     display:flex!important;visibility:visible!important;position:relative!important;
     inset:auto!important;left:auto!important;top:auto!important;
     width:var(--daily-cw,${'{W}'}px)!important;height:var(--daily-ch,${'{H}'}px)!important;
     overflow:hidden!important;opacity:1!important;margin:0 auto 12px
   }
   </style>
   ...
   <script id="ai-preview-guard-js">(function(){
     var root=document.documentElement;
     if(root.getAttribute("data-mode")==="film")return;
     function boot(){
       var secs=[].slice.call(document.querySelectorAll(".sec"));
       if(!secs.length)return;
       for(var i=0;i<secs.length;i++){
         var s0=secs[i];
         s0.style.visibility="visible";
         if(window.getComputedStyle(s0).display==="none")s0.style.display="flex";
         var a=s0.parentElement;
         while(a&&a!==document.body){a.style.overflow="visible";a.style.height="auto";a.style.maxHeight="none";a=a.parentElement;}
         if(a){a.style.overflowY="auto";a.style.height="auto";}
       }
       var t0=[],wasIn=[];
       function tick(){
         var vh=window.innerHeight||${'{H}'};
         for(var i=0;i<secs.length;i++){
           var s=secs[i],r=s.getBoundingClientRect();
           var inView=(r.top<vh*0.85)&&(r.bottom>0);
           if(inView&&!wasIn[i]){wasIn[i]=true;t0[i]=window.performance.now();}
           if(!inView){wasIn[i]=false;t0[i]=null;}
           var du=(+s.dataset.duration||3)*1000;
           if(wasIn[i]&&t0[i]!=null){
             var e=(window.performance.now()-t0[i])/du;
             s.style.setProperty("--p",String(Math.min(1,Math.max(0,e))));
           }
         }
         requestAnimationFrame(tick);
       }
       tick();
     }
     if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot);
     else boot();
   })();</script>
   \`\`\`

   **三条必须做对**：
     ① \`<html data-mode="preview">\` 写在最外层；
     ② preview guard 的 \`<style>\` 和 \`<script>\` **两个都要有**（只写 style 不会自动播，只写 script 排版会乱）；
     ③ 每段必须**自带不透明背景**，且**整段 opacity 由 --p 控制**：
        \`.sec{background:<底色>;opacity:clamp(0, calc(var(--p) * 20), 1)}\` 和 \`.sec:first-child{opacity:1}\`
        （缺背景 ⇒ 段透明会叠字；缺整段 opacity ⇒ 后段把前段盖死，只看到最后一段）

   ⇒ 判据：**在浏览器里打开，往下滚能逐段看完**。只能看到第一屏就是不合格。`

/* ══════════════════════════════════════════════════════════════════════════
   六、组装提示词
   ══════════════════════════════════════════════════════════════════════════ */
export function buildLabPrompt(segs: LabSeg[], f: LabForm): string {
  const isLand = String(f.aspect || '') === '16:9'
  const W = isLand ? 1280 : 720
  const H = isLand ? 720 : 1280
  const n = f.imgCount || 17

  const parts: string[] = []

  parts.push(`你是**顶级动效视觉设计师**兼前端工程师。请交付**一条竖屏 ${W}×${H} 视频的页面**，
它会被逐帧渲染成 mp4（不是给人滚动浏览的网页）。`)

  /* 分镜表 —— 逐段列出，让模型不用自己编 */
  parts.push('【分镜表 · 就按这个排】（共 ' + segs.length + ' 段）')
  segs.forEach((s, i) => {
    const imgs = s.imgs.length ? ('｜用图 ' + s.imgs.join(',')) : '｜**不用图（纯排版）**'
    parts.push('  段' + (i + 1) + '：' + s.t1 + ' / ' + s.t2 + ' ' + imgs
      + '\n        正文：' + s.body)
  })
  parts.push('⚠️ 文案就照上面这份，排版/动效/图形/字号全部自由；**段数保持 ' + segs.length + ' 段**。')
  parts.push('· 每段**必须同时出现「主标题」「副标题」「正文那一句」**三者，缺一个算不合格。')

  /* ★ 内容先于形式：卖点排在文案类型之前 */
  if (String(f.sellingPoints || '').trim()) {
    parts.push('')
    parts.push('【① 今日卖点 · 用户给的原文（**这是"说什么"，优先级最高**）】')
    parts.push(String(f.sellingPoints).trim())
    parts.push('⚠️ **只写这里写了的东西**。没写的价格 / 折扣 / 日期 / 销量，**绝对不许编**。')
    parts.push('⚠️ 卖点要落到画面字和口播里，但不许为了塞卖点破坏上面的分区约束。')
  }

  const toneMap: Record<string, string> = {
    '探店': '门店探店（第一人称体验、写现场感）',
    '带货': '产品带货（讲卖点、讲为什么值）',
    '宠物': '宠物日常（温柔、有互动）',
    '旅拍': '风景旅拍（写环境与心境）',
    '写真': '人物写真（写气质与状态）',
    '品牌': '品牌宣传（讲态度、讲招牌）',
  }
  parts.push('')
  parts.push('【② 文案类型 · 这是"用什么腔调说"（形式，服从上面的内容）】')
  parts.push(f.tone && toneMap[f.tone] ? toneMap[f.tone] : '按素材自己判断（不预设腔调）')
  parts.push('（只影响画面字与口播的写法，**不影响排版**）')

  /* 风格 */
  if (f.designStyle && STYLES[f.designStyle]) {
    parts.push('')
    parts.push(STYLES[f.designStyle])
  }

  /* 绘制 */
  if (f.drawMode && DRAW_RULES[f.drawMode]) {
    parts.push('')
    parts.push(DRAW_RULES[f.drawMode])
    parts.push(DRAW_HOWTO)
  }

  /* 构图偏好 */
  parts.push('')
  const pr = Number(f.plateRatio ?? 6)
  parts.push('【图片呈现】大图 : 多图 = ' + pr.toFixed(1) + ' : ' + (10 - pr).toFixed(1)
    + '（全片里约 ' + Math.round(pr * 10) + '% 的段用单图满幅、其余用 2~3 张多图）')
  parts.push('· 单图段用满幅 cover；多图段一屏 2~3 张；**相邻两段不要用同一种**。')
  if (f.noImgEnds) {
    parts.push('· **首段和末段不用实拍图**（纯排版），但**纯排版也要守住分区**：上区大字、中区图形或色块、下区小字。')
  }

  /* 素材说明 */
  parts.push('')
  parts.push('【素材】用户提供 ' + n + ' 张实拍照片，文件名 `1.jpg` ~ `' + n + '.jpg`（与 HTML 同目录）。')
  parts.push('· **尽量每张各出现 1 次**；确实不够铺时才重复，单张最多 2 次、不要连续两段用同一张。')
  parts.push('· 在 `</html>` 之前留一行注释 `<!-- used: 1,2,… -->`，列出实际用到的图号。')

  /* ★ 交付前自检六条（取代原来的硬坐标分区；这里把结果检查放在显眼位置） */
  parts.push('')
  parts.push(selfCheckRules(H))

  /* 动效 */
  parts.push('')
  parts.push(MOTION_RULES)

  /* 契约 */
  parts.push('')
  parts.push(CONTRACT.replace(/\{W\}/g, String(W)).replace(/\{H\}/g, String(H)))

  /* 约束档 */
  if (String(f.tier || '') === 'loose') {
    parts.push('')
    parts.push('【约束档位 · 宽松】上面硬契约照守，但风格细节可以自由发挥，不必逐条对照。')
  } else if (String(f.tier || '') === 'free') {
    parts.push('')
    parts.push('【约束档位 · 自由】风格细节全部由你决定。**但「分区硬约束」和「输出契约」必须守**（那是技术底线，不是审美偏好）。')
  }

  parts.push('')
  parts.push('【输出】只输出一个完整 HTML 文件（<!DOCTYPE html> 到 </html>），CSS/JS 全部内联；不要解释、不要 markdown 围栏。')

  /* 用户补充要求（和成品线同一套：有就原样贴，没有就用默认 6 条） */
  const ur = String(f.userRules || '').trim()
  if (ur) {
    parts.push('')
    parts.push('【用户本次的附加要求 —— **优先于上面所有（设计偏好）**，但**不得违反分区硬约束与输出契约**】')
    parts.push(ur)
  }

  return parts.join('\n')
}
