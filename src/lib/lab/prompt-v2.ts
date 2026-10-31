/**
 * ★LAB_ENGINE_V2 · 纯「仓库派」提示词（2026-10-31 用户定案）
 * =============================================================================
 * 用户原话：
 *   「在 https://ai-niuma.cc/lab 基础上开 B 做所有新功能」
 *   「只要是从这个仓库学到的方法全部都搬到 B，**不要一点日报的，除了分辨率**」
 *
 * 所以这份提示词里**没有**日报线的任何设计内容：
 *   ❌ 没有分镜表（segs）—— 段数由模型自己决定
 *   ❌ 没有"素材必须每个用一次 / used 注释"
 *   ❌ 没有"禁止元叙述 / 卖点不要写摆设"那套文案细则
 *   ❌ 没有"设计原则 14 条"、没有"自检六条 / 元素预算 / 纵向用满"
 *   ✅ **只保留 720×1280 和帧率**（物理约束，不是设计）
 *
 * 内容全部来自三个开源仓库（学思路，不拷代码）：
 *   ① `mg-styles-15`（MIT）的 **四段式 prompt**：
 *      Style / Output(fixed) / Technical route / **Creative seed** / **Signature features**
 *      关键那句：「Signature features 要**可检验**。写『弹性缓动用
 *      cubic-bezier(0.34,1.56,0.64,1)，错峰 2–4 帧』，而不是『动效要有弹性』」
 *   ② `video-shotcraft`（Apache-2.0）的 **10 类镜头卡**
 *      （Typography 25 / Light 23 / Transitions 19 / Camera 13 / Rhythm 8 / Data 9 / Opening 11 / Outro 7）
 *   ③ `mg-styles-15`（MIT）的 **rubric 自评**：
 *      7 维度打分，critical 项里有 **generic or AI-template**（正是我们要治的）
 *
 * 另加一条我们自己总结的：**撞色**（素材暖 ⇒ 画面用冷底），治"配色永远暖棕"。
 */

import { renderCardsA } from './cards-a'
import { renderCardsExtra } from './cards-extra'

export type V2Form = {
  imgCount?: number
  maxSeconds?: number
  aspect?: string
  /** 'a' = 给 25 张手法卡；'' = 不给卡（纯自由） */
  cardMode?: string
  /** 是否要求交付前自评 */
  selfReview?: boolean
  userRules?: string
}

/* ══════════════════════════════════════════════════════════════════════════ */
function beatSheet(sec: number) {
  const a = (sec * 0.08).toFixed(1)
  const b = (sec * 0.45).toFixed(1)
  const c = (sec * 0.8).toFixed(1)
  return `【Creative seed · 先写分秒节拍，再动手做页面】
**不许直接写 HTML**。先在脑子里把这条片子按秒拆开：

  · **0 ~ ${a}s｜钩子** —— 第一眼抓住人。最强的图 / 最大的字 / 最反常的动作，**三选一**，不要三个都放。
  · **${a} ~ ${b}s｜升级** —— 一层层加信息，每次只加一件事（新元素 / 新视角 / 新颜色），**不要一次倒完**。
  · **${b} ~ ${c}s｜高潮** —— 全片最强的 1~2 秒。这里可以违反常规（整屏反色 / 巨字出血 / 突然静止）。
  · **${c} ~ ${sec}s｜收尾** —— 落版，**必须有一个明确的结束帧**（不是淡出）。

⇒ 节拍定完，页面必须服从它。
   ⚠️ 最常见的失败是「每段一样长、一样节奏」—— 那是模板，不是片子。`
}

function signatureFeatures() {
  return `【Signature features · 你定的风格，必须做到下面五项（**每项都要能数出来**）】
先**自己给这套风格起个名**（中文 + 英文），然后填：

  1. **配色**：给 3~6 个**具体 hex**，说明谁是底 / 主 / 强调。
     ⚠️ **必须撞色**：素材偏暖（食物/火光/木材/夕阳）⇒ 画面用**冷底**（墨绿/靛蓝/炭黑），
        让暖色自己跳出来；素材偏冷（金属/水/夜）⇒ 画面用**暖底**。
        **顺色是最容易"一个味"的做法**（这是我们踩过的坑）。
  2. **字体**：衬线 / 无衬线？只用哪几档字重（例如 400 + 900）？字距具体多少 em？
     **字号落差几倍**（例如 12 倍：24px → 288px）。
  3. **布局逻辑**：靠什么对齐（栅格 / 中线 / 出血 / 自由）？留白比例大概多少？
     主体位置的规律（永远偏左？居中？每隔一段换一次？）
  4. **动效语言**：缓动写**具体曲线**（例如 \`cubic-bezier(0.22,1,0.36,1)\`）；
     进场方式只选 1~2 种（遮罩掀开 / 位移 / 缩放 / 逐字 / 硬切）；
     **错峰间隔具体多少毫秒**（例如 80ms 一行）。
  5. **质感**：颗粒 / 暗角 / 扫描线 / 半调网点 —— 用哪个？**强度多少**（例如 grain opacity .06）。

⇒ 这五项就是这条片子的"合同"，**后面所有段落都必须服从，不许半路换**。`
}

function selfRubric() {
  return `【交付前自评 · 给自己按 1~10 打分，任何一项 ≤5 就重做那一段】
  1. **风格保真**：上面五项签名特征，**每一项都能在页面里指出来**吗？
  2. **概念冲击**：第一屏有钩子吗？全片有**明确的 hero moment**（最强 1~2 秒）吗？
  3. **动效工艺**：缓动写了具体曲线吗？有**预备—动作—跟随**吗（不是匀速滑入）？
     有没有一处**突然停住**（急停比匀速有力量）？
  4. **排版**：最大字 / 最小字 ≥ **8 倍**吗？有没有一处是**不对称**的（全对称 = 死板）？
  5. **质感**：有没有一处"多做"的细节（极淡颗粒 / 1px 线 / 0.5px 描边）？
  6. **节奏**：每段时长**不一样**吗？有快切段（<2s）和长镜段（>5s）吗？
  7. **技术**：无外部资源 / 无 emoji 图标 / 字体只用占位族名 / 首帧不空白。

评分参照：**5 = 学生作业 / 6 = 模板级 / 7 = 专业 / 8 = 高端工作室 / 9 = 获奖入围**
⚠️ **首次做出来的东西通常只值 5~7，不要给自己打 8 以上**。
   如果某一项自己都觉得"这很 AI 模板"，**就回去改那一段，别交出来**。`
}

/* ══════════════════════════════════════════════════════════════════════════
   主函数
   ══════════════════════════════════════════════════════════════════════════ */
export function buildLabPromptV2(f: V2Form): string {
  const isLand = String(f.aspect || '') === '16:9'
  const W = isLand ? 1280 : 720
  const H = isLand ? 720 : 1280
  const n = f.imgCount || 1
  const sec = Number(f.maxSeconds || 45)

  const p: string[] = []

  /* ── 角色（不是"设计师"，是"导演"，学 mg-styles-15 的定性） ── */
  p.push(`你是**导演 + 动效设计师 + 前端工程师**三个人合一。
交付一条竖屏 ${W}×${H} 的片子（会被逐帧渲染成 mp4，不是给人滚动浏览的网页）。

用户给你 ${n} 张实拍照片（文件名 1.jpg ~ ${n}.jpg，与 HTML 同目录）。
**怎么用这些图由你决定** —— 可以做主图、可以做局部、可以切条、也可以某一屏完全不用图。`)

  /* ── 第一段：定风格（四段式的 Style） ── */
  p.push('')
  p.push('【第 1 步 · 先定风格（不要先想版面）】')
  p.push('看这批素材的气质（主体 / 光线 / 色彩 / 情绪），定一个**贯穿全片**的视觉方向。')
  p.push('然后按下面这张表把风格写出来 —— **写不出具体数字就是没想清楚**：')
  p.push(signatureFeatures())

  /* ── 第二段：定节拍（Creative seed） ── */
  p.push('')
  p.push(beatSheet(sec))

  /* ── 第三段：技术路线（Technical route） ── */
  p.push('')
  p.push(`【第 3 步 · 技术路线（只用这些）】
  · 纯 HTML + CSS + 少量 JS，**全部内联在一个文件里**
  · 画布 **${W}×${H}**，25fps
  · 可用：transform / clip-path / filter / mix-blend-mode / gradient / mask /
    conic-gradient / repeating-linear-gradient / backdrop-filter / writing-mode
  · ❌ 不用外部资源（图片、字体、CDN 一律不许）
  · ❌ 不用 WebGL / Three.js / Canvas 逐帧绘制（渲染器跑不动）
  · 字体只用两个**占位族名**：\`--font-serif: "TXT-Serif", serif\` / \`--font-sans: "TXT-Sans", sans-serif\`
    （真实字体我们后续注入，**不要写 Noto Sans SC 这类真名**）`)

  /* ── 第四段：手法库（可选） ── */
  if (String(f.cardMode || '') === 'a') {
    p.push('')
    p.push('【第 4 步 · 手法库（**每段挑一张**，不是遵守规则）】')
    p.push('下面是一个**武器库**，每张都是"可以这么做"的许可，不是命令：')
    p.push('')
    p.push('**怎么用**：')
    p.push('· 每段挑 **1 张主手法**（排版类），可以再叠 **1 张辅助**（打光/运镜）')
    p.push('· 转场卡用在**段与段之间**，相邻两段换一种')
    p.push('· **相邻三段不许用同一张主手法**')
    p.push('· 运镜卡（C 系列）建议**每段都用一张** —— 它治"PPT 感"最有效')
    p.push('· 你有更好的想法就用你的；这些只是"至少可以这么玩"')
    p.push('')
    p.push('════ 一、排版手法（25 张）════')
    p.push(renderCardsA())
    p.push('')
    p.push('════ 二、打光 / 转场 / 运镜 / 节奏（27 张）════')
    p.push(renderCardsExtra(['light', 'transition', 'camera', 'rhythm']))
  }

  /* ── 第五段：技术契约（只留必要的，学 output(fixed)） ── */
  p.push('')
  p.push(`【第 5 步 · 技术底线（这几条必须守，其余全部自由）】
  1. 页面按**时间播放**。用 <section class="sec" data-start="秒" data-duration="秒"> 组成。
     **首帧不能空白**。
  2. **原样照抄**这段（唯一接口）：
     <script>
     window.__seek = function (t) {
       document.querySelectorAll(".sec").forEach(function (sec) {
         var s = Number(sec.dataset.start) || 0, d = Number(sec.dataset.duration) || 3;
         sec.style.setProperty("--p", String(Math.min(1, Math.max(0, (t - s) / d))));
       });
     };
     window.__seek(0);
     </script>
  3. 所有动效读 \`var(--p)\`（0 = 刚入场，1 = 就位）。
     ❌ 不许用 \`animation\` / \`@keyframes\` 承载 \`--p\`（引擎只改值，不重算动画）。
  4. **每段必须有不透明背景**，且整段 opacity 由 \`--p\` 控制：
     \`.sec{background:<底色>; opacity:clamp(0, calc(var(--p) * 20), 1)}\`
     \`.sec:first-child{opacity:1}\`
     （缺背景 ⇒ 段透明会叠字；缺整段 opacity ⇒ 后段盖死前段）
  5. **图别超出画布**（top + 高度 ≤ ${H - 20}），超了会被裁掉半截。
     **故意出血是允许的**，但你要自己确认裁掉的部分不影响主体。
  6. 文字压在图上**完全可以** —— 只要背后有遮罩 / 描边 / 对比色保证看得清。
     判据：**把页面缩到 30% 还认得出字** ⇒ 合格。`)

  /* ── 第五点五段：装饰清单（★LAB_DECO 2026-10-31 用户定案） ──
   *
   * 来源：拆 hanazi 原片（1080×1920 · 10s），逐帧数出 9 类装饰。
   * 实测我们的历史产出：
   *   gen_20261031_001（AI 两轮）  6/10 类
   *   gen_20261030_009（AI B 档）  7/10 类
   *   我手作版                     2/10 类
   * ⇒ **不是完全没有，是"缺 4 个高杠杆类 + 数量稀"**：
   *     ❌ 放射线/爆炸条纹（1 行 CSS，冲击力最强）
   *     ❌ 斜条纹/网格底纹（1 行 CSS，治"背景空"）
   *     ❌ 手绘小装饰（星星/汗滴/箭头 —— 密度的主要来源）
   *     ❌ 多层描边字（花字核心）
   *   而且 gen_001 里 `border-radius` 只出现 **1 次**（原片满地都是）。
   *
   * ⇒ 写成**清单**（不是"禁止"，是"至少挑 3 个"）—— 和 A/B 卡一个思路。
   */
  p.push('')
  p.push(`【第 5 步 · 装饰清单（每段**至少挑 3 类**，不是禁令）】

下面 6 类装饰是"设计感"的地基。**每段至少挑 3 类**，同一类不要连续三段都用。

  ① **背景纹理**（治"背景空"）
     · 斜条纹：\`repeating-linear-gradient(45deg,#2EE6E6 0 14px,#FFF 14px 28px)\`
     · 网格：\`repeating-linear-gradient(0deg,...)\` + \`repeating-linear-gradient(90deg,...)\`
     · 放射线：\`repeating-conic-gradient(from 0deg,#FFE45C 0 10deg,#FF7AC8 10deg 20deg)\`

  ② **一个徽章 / 胶囊标签**（治"没有栏目感"）
     · 左上角常驻角标（如 \`EP.03\`、栏目名），**全片不变**
     · 圆角 pill + 白字 + 深描边
     · 或"已解锁 xxx"这类小徽章

  ③ **2~4 个小装饰**（治"密度不够"）
     · 四角星 / 汗滴 / 箭头 / 闪电 / 火花
     · 尺寸占短边 **3~7%**（太小看不见）
     · **必须至少 2 个**，分布在不同角落

  ④ **文字三层描边**（治"字太普通"）
     · 填充渐变 + 粗白描边（16px）+ 彩色外描边（32px）
     · SVG 用 \`paint-order="stroke"\`，或 CSS 用 8 向 \`text-shadow\`
     · ⚠️ 用了 \`background-clip:text\` 就**必须写 \`background-image\`**，不能写 \`background\`（简写会重置 clip）

  ⑤ **一个贴纸 / 撕纸元素**（治"太干净"）
     · 撕纸边：\`feTurbulence + feDisplacementMap(scale 5~11)\`
     · 或白描边贴纸：四向 \`drop-shadow(2.6px 0 0 #FFF)\`

  ⑥ **圆角**（治"廉价感"）
     · 几乎所有块级元素都该有圆角（\`border-radius: 14~44px\`）
     · 判据：**把页面缩到 30%，如果满屏都是直角 ⇒ 太便宜**

⚠️ 这 6 类是**许可**，不是命令。如果你有更合适的做法，用你的。
   但**每段至少 3 类**这条要守 —— 少于 3 类，画面就是"半成品"。`)

  /* ── 第六段：自评 ── */
  if (f.selfReview !== false) {
    p.push('')
    p.push(selfRubric())
  }

  /* ── 用户补充要求 ── */
  const ur = String(f.userRules || '').trim()
  if (ur) {
    p.push('')
    p.push('【用户补充要求（优先于上面所有偏好，但不得违反技术底线）】')
    p.push(ur)
  }

  /* ── 输出 ── */
  p.push('')
  p.push(`【输出】只输出一个完整 HTML 文件（<!DOCTYPE html> 到 </html>），CSS/JS 全部内联。
不要解释、不要 markdown 围栏、不要额外说明。

⚠️ 最后提醒三件最容易犯的事：
  ① **不要每段一样长、一样节奏**（那是模板）
  ② **不要顺色**（素材暖就用冷底，这是拉开差距最快的一步）
  ③ **不要把自己做成"安全模板"** —— 越不像通用模板越好。`)

  return p.join('\n')
}
