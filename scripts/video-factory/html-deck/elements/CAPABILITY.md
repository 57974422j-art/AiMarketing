# 能力清单（Capability Sheet）v0.1

> **给 AI 看的一页纸**。为什么必须有：用户实测反馈「有些 AI 不联网、不了解 HyperFrames / Remotion 的真实能力，因为引擎比较新」——
> 那就**不指望它去了解引擎**，每次生成时把这一页塞给它，让它"照着单子点菜"即可。
> 用法：与 `elements/*.json`（元素/结构/动效/镜头组）、`styles/<id>.json`（风格包）**一起投喂**。

## 1. 我们用什么渲染（事实口径）

| 项 | 值 |
|---|---|
| 引擎 | HyperFrames（HTML/CSS/JS 逐帧渲染，等价于"可编程 PPT + MG 动画"） |
| 画布 | 固定容器：**720×1280（9:16）** 或 1280×720（16:9）；页内坐标一律 **px**，不用 vw/vh/% |
| 帧率 | 25fps（可 30） |
| 时间模型 | **`gsap.timeline({paused:true})` 按绝对时间摆放**，由引擎逐帧 seek ⇒ **画面只由时间决定** |
| 可复现 | 同输入同输出（**禁止** `Math.random` / `Date.now` / 自由 `requestAnimationFrame`；随机用**固定种子**） |
| 依赖 | 只用本地资产：`gsap.min.js` + 字体子集 + Canvas2D + CSS（含 CSS3D）。**禁外网、禁 WebGL/Three**（当前） |
| 速度 | 约 **1.5~1.7 秒渲染 1 秒成片**（720p，本机/服务器实测） |

## 2. 能用什么（能力白名单）

- **CSS**：布局/定位/transform（含 3D：`perspective` + `rotateY/translateZ`）/ 过渡 / `backdrop-filter`（毛玻璃）/ `clip-path`（擦入）/ 渐变 / 阴影 / `mix-blend-mode`
- **Canvas 2D**：网格、粒子、光斑、噪点、扫描线、半调网点、波形、环形/条形/曲线（数据可视化）
- **GSAP**：时间线、stagger、缓动、`yPercent/xPercent/scale/rotate/skew`、`clipPath`、`textShadow`、`repeat/yoyo`
- **文本**：拆字（每字一个 span 单独 transform）⇒ **字母散布/逐字入场**
- **动效资源**：见 `motions.json`（入场/强调/持续/退场四类）

## 3. 不能用 / 不要尝试

- ❌ 外网请求（CDN、字体、图片外链）、`fetch` 外部资源
- ❌ WebGL / Three.js / 3D 建模 / 骨骼动画 / 动作捕捉
- ❌ 让 AI 即兴写复杂 JS 动画（会不可复现、易崩）⇒ **必须从 `motions.json` 里选 + 排时间**
- ❌ 使用字体子集外的字（会被闸门拦成整单失败）；**不许**用 emoji 当画面元素

## 4. 硬闸门（生成后自动跑，必须全过）

| 闸门 | 判什么 | 不过怎么办 |
|---|---|---|
| 用字闸门 `check-page-fonts.mjs` | 会渲染的字是否都在字体子集内 | 改文案（首选）或补字表 |
| 对比度 `hyperframes check` | 文字 vs **实际渲出像素** ≥ 4.5:1（WCAG AA） | 加深遮罩 / 提亮文字（**名义值不算数**） |
| 版面重叠 | `content_overlap`（文字块互相压）/ `text_occluded`（不透明元素压住文字） | 移开；**刻意的叠层**加 `data-layout-allow-overlap` |
| 结构 | 单一 composition、产物只有一个 `index.html`、时间线**内联注册** | 按模板生成 |

## 5. 已经验证过的"坑"（写进契约，别重犯）

1. 页内元素**必须自带 `position:absolute`**（只写 left/top 会被浏览器忽略 ⇒ 整页错位）
2. **不要让 GSAP 动的元素同时用 CSS transform 居中**（transform 会被冲掉）⇒ 定位用外层、动效用内层
3. **满页 Canvas 会被判"盖住文字"** ⇒ Canvas 只覆盖它真正画图的区域，且**永远放最底层**
4. 亮素材/光斑会把有效对比度拉低（名义 9:1 实测 4.39:1）⇒ 文字区必须加压暗层
5. 装饰带（网点带/波浪带）必须放在**所有文字之外**
6. 大字号两行按**字形框**判重叠 ⇒ 行距 ≥1.28 倍

## 6. AI 的活只有三件（其余都从库里点）

1. **读素材** → 输出 tokens（主色/明度/风格倾向）与 **vertical（赛道）候选**
2. **选** → 从 `shotgroups.json` 选 N 条镜头组、从 `styles/` 选 1 张风格包
3. **填** → 把文案填进槽位、给每条镜头组标**素材帧区间**（视频素材）

**输出必须是结构化 JSON 且只能引用库里已有 id**；引用越界 ⇒ 回退默认风格包 + 默认镜头组。
