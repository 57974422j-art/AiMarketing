# hyperframes 渲染契约（SPEC v1）

> 本文档是**输入侧契约**：任何交给 hyperframes 逐帧渲染的页面，必须满足这里写的每一条。
> 目的：**让"页面能不能渲、渲得对不对"在写页面时就有依据**，而不是渲染完靠肉眼发现问题。
> 记录于 2026-10-22。所有条款都来自**实际踩过的坑**（见 §7 事故表）。

---

## 0. 一句话

**hyperframes 不是浏览器录屏，而是"给一个时间 t → 调页面 → 截一帧 → 拼成视频"。**
所以页面必须满足：**在任意时刻 t，画面是确定的、可复现的、不依赖动画时钟的。**

---

## 1. 结构契约（必须）

### 1.1 分段
```html
<section class="sec" data-start="0" data-duration="4.2"> … </section>
<section class="sec" data-start="4.2" data-duration="3.8"> … </section>
```
- `class` 必须含 `sec`（引擎按这个找段）；
- `data-start` / `data-duration` 单位是**秒**，可为小数；
- 段的**时间轴必须连续**（下一段 start = 上一段 start + duration），**不许重叠**（§7.4）；
- 段内所有内容必须在 **720×1280** 画布内。

### 1.2 时间驱动函数（必须原样保留）
```js
window.__seek=function(t){document.querySelectorAll(".sec").forEach(function(s){var a=+s.dataset.start||0,d=+s.dataset.duration||3;s.style.setProperty("--p",String(Math.min(1,Math.max(0,(t-a)/d))))})};window.__seek(0);
```
- 引擎**只调这一个函数**，它负责把全局时间 `t` 换算成每段的进度 `--p`；
- **必须原样出现在产物里**（改名/包一层/改成 `const` 都会失效）；
- 引擎在渲染前会调 `__seek(0)` 初始化。

### 1.3 `--p` 的语义（最容易用反）
```
--p = 0   这一段刚开始（入场）
--p = 1   这一段完全就位（**最终画面**）
```
- **`p=1` 就是该段的终态，画面要停在那里**；
- ❌ **不要**用 `(1 - var(--p))` 做"出场淡出"——那会让**每段结尾变黑**（§7.5）；
- 转场靠"下一段盖上来"，不靠本段淡出。

---

## 2. 动效契约

### 2.1 允许
| 手段 | 例子 |
|---|---|
| **CSS 属性随 `--p` 变化** | `opacity: clamp(0,calc(var(--p)*3),1)`、`transform: translateY(calc((1-var(--p))*40px))`、`filter: blur(calc((1-var(--p))*6px))`、`clip-path`、`mask-image` |
| **SVG 描边/遮罩** | `stroke-dashoffset` 随 `--p` 线性变化 |
| **代码绘制图形** | div/SVG 拼的网格、线条、点阵、几何块、印章、贴纸 |
| **多层错峰** | 逐字 `calc((var(--p) - 0.15) * 4)`（后一个更晚） |

### 2.2 禁止（技术上拍不到）
| ❌ | 原因 |
|---|---|
| `requestAnimationFrame` 循环 | 引擎**按帧截图**，rAF 被替换成空实现 ⇒ 画面停在第一帧 |
| `setTimeout` / `setInterval` | 帧不连续，定时器不一定在这帧触发 |
| `<canvas>` / WebGL | 依赖 rAF 持续重绘 ⇒ 同上 |
| CSS `@keyframes` + `animation` | **不随 `t` 定位**，同一 t 两次渲染可能不同 ⇒ **帧不确定**（§3） |
| `Math.random()` / `Date.now()` | **每次渲染结果不同** ⇒ 不可复现 |

> 结论：**动效只能由 `--p`（即 `__seek(t)`）驱动**，不许有自己的时钟。

---

## 3. 帧确定性（渲染可复现）

**要求**：同一份 HTML、同一个帧号 `t`，**渲染两次的画面必须一致**。

> **判定标准（2026-10-22 实测校准）**：
> - **像素差异 ≤1%** ⇒ 视为一致（默认阈值 `--tolerance 0.01`）；
> - **>5%** ⇒ 才有可能是真不确定源（`Math.random` / `Date.now` / 异步时序 / 首次初始化）；
> - **0%（逐字节）在实际中做不到**：Chromium 在 `transform: scale()` / `filter` 下**光栅化有亚像素差异**
>   （实测同一帧两遍差 68% 字节，但两张图**肉眼完全相同**，只有纹理与字形边缘的取样不同）。
> ⇒ 所以**不要用 0 当默认**，否则会一直误报。

为什么必须：
- 引擎是"逐帧截图再编码"，**任何不确定性都会变成画面抖动或花屏**；
- 出问题时只能靠肉眼 ⇒ 无法定位。

常见破坏源（都踩过）：
- `animation` / `transition`（不随 t 定位）
- `Math.random()`
- 字体异步加载（首帧字体没加载完 ⇒ 文字位置/宽度不同）
- 图片解码时序（第一帧还没 decode 完）

⇒ 自检工具：`scripts/video-factory/tools/frame-determinism-check.mjs`（见任务 A，同批交付）。

---

## 4. 字体契约（我们踩得最惨的一条）

### 4.1 只认两种
| 写法 | 说明 |
|---|---|
| **占位名** `TXT-Serif` / `TXT-Sans` | 构建时会被替换成真实内嵌字体（推荐） |
| **内嵌 `@font-face`（base64 woff2）** | 自己带字体时用 |

❌ **禁止**：`font-family: "PingFang SC"` / `"Microsoft YaHei"` / Google Fonts / `@import url(...)`
—— 服务器上没有这些字体，会**静默回退成默认字体**（版式全乱）。

### 4.2 字库只含**常用简体**
- 内嵌字体是**子集**（约 5~6MB/种，只含常用简体字）；
- **子集外的字会渲成方块（豆腐块）** ⇒ 闸门会拦：
```
stage=fonts ✗ 表外字 1 个：進
```
- 因此**用字铁律**：只用**简体常用字**；
  ❌ 繁体（進/裡/後/麵/開/門）❌ 异体字/生僻字 ❌ 日文汉字 ❌ ①★♨ 等符号 ❌ emoji 当文字

> 想支持繁体：要么扩充子集（+200~500KB/种），要么渲染前做繁→简转换。

---

## 5. 资源契约（图片/音频）

### 5.1 图片引用：三种写法都认
```html
<img src="1.jpg">                                <!-- ✅ 推荐 -->
<img src="images/1.jpg">                         <!-- ✅ 但会被归一化成 1.jpg -->
<div style="background-image:url('3.jpg')">      <!-- ✅ 引擎也认 -->
<img src="data:image/jpeg;base64,…">             <!-- ✅ 已内嵌 -->
```
- **推荐 `<img src>`**：最好识别、最好内嵌、最好调试；
- ⚠️ **不要写 `images/` 前缀**：AI 常按"网页惯例"加，而我们的图**与 HTML 同级**，加了就得归一化（已做，但少一层更稳）；
- 三种写法都要求：**文件名必须是 `N.jpg`（1-based，与素材顺序一致）**。

### 5.2 图片体积
- 内嵌有**总上限**（当前 96MB）；超了会**跳过后面的图** ⇒ 表现为"图不见了"或 `stage=media ✗`；
- **单张控制在 ≤2MB**（我们会缩到 512px 再内嵌；原图 4MB+ 时依赖 ffmpeg 兜底）。

### 5.3 音频
- 若页面引用音频，必须能解码；**解码失败会在渲染时报错**（不是静默）。

---

## 6. 四道闸门（`daily-film.mjs --check-only`）

页面在**真正渲染前**要过四道，任何一道不过就不渲：

| 道 | 名称 | 查什么 | 典型报错 |
|---|---|---|---|
| **①** | 打包 | 段数、时长、媒体引用是否存在 | `stage=media ✗ 既没有内嵌图、也没有外部图引用` / `missing_local_asset` |
| **②** | 用字 | 字体是否走白名单、有无表外字 | `stage=fonts ✗ 表外字 1 个：進` / `font_family_without_font_face` |
| **③** | 引擎校验 | **逐帧模拟**：文字重叠、对比度、溢出、`__seek` 是否生效、CSS 语法 | `content_overlap` / `need 4.5:1` / `Timeline did not advance under seek` / `css_parse_error` |
| **④** | 渲染 | 真跑一遍 | 磁盘不足 / 超时 |

### 6.1 ③ 的判据（对齐"人眼能察觉"）
| 报错 | 判定 | 性质 |
|---|---|---|
| `content_overlap` | 两块文字**矩形相交 ≥ 若干采样点**（约 0.5s 以上） | 审美（可能只是动效中间帧） |
| 对比度 | 文字与背景 **< 4.5:1**（大字可放宽） | 审美 |
| 溢出 | 元素 `top<0` 或 `bottom>1280` | 会裁字 |
| `Timeline did not advance under seek` | `__seek(t)` 调了但页面**完全没变化** | 页面是静态的 |
| `css_parse_error` | 括号/语法错（`Unclosed bracket`） | 真·渲不出来 |

### 6.2 分级处理（我们的口径）
- **致命**（渲不出来 / 满屏方块）：`css_parse_error` / `missing_local_asset` / `表外字` / `font_family_without_font_face` / `Timeline did not advance` / `stage=media` / `stage=pack` / `stage=fonts`
  ⇒ **必须拦**；
- **审美**：`content_overlap` / 对比度 ⇒ **放行**，写进日志让用户看片后自己判断；
- ⚠️ **判定原则**：先取"所有错误行"，**只有每一条都在审美白名单里**才放行（不能"排除黑名单就放行"，否则未知错误会被放过）。

---

## 7. 事故表（每条都是真踩的）

| # | 现象 | 真因 | 契约条款 |
|---|---|---|---|
| 7.1 | 整页文字变方块 | 写了繁体「進」，不在字体子集 | §4.2 |
| 7.2 | 图全不见 / `stage=media` | AI 写 `images/1.jpg`，内嵌只换文件名 ⇒ 残留 `images/data:image/…` | §5.1 |
| 7.3 | `stage=media ✗ 没有图` | 页面全用 `background-image:url()`、0 个 `<img>`，旧检查只扫 `src="…"` | §5.1 |
| 7.4 | `content_overlap` 反复被判失败 | **段间做了叠化**（上一段未消失、下一段已出现）⇒ 两段文字矩形相交 | §1.1 |
| 7.5 | 每段结尾黑屏 | 用 `(1 - var(--p))` 做出场淡出（把"入场进度"当"段落进度") | §1.3 |
| 7.6 | 页面完全不动 | `__seek` 被改写/缺 `--p` 驱动 ⇒ 引擎判 `Timeline did not advance` | §1.2 / §2 |
| 7.7 | 首屏全黑打不开 | 所有段 `opacity:0`，等 `__seek` 才显示；直接打开不会有 `__seek` | 预览兜底（见 §8） |
| 7.8 | 渲染被拦 `Low disk space` | 每次渲染留 1~2GB 中间产物 + 数据库备份永不清理 | §9 |

---

## 8. 本地预览兜底（`ai-preview-guard`）

AI 生成的页面**默认所有段都隐藏**（等 `__seek` 驱动）。直接双击打开 ⇒ **全黑**。

⇒ 需要注入一段**预览兜底脚本**（产品里已有）：
- 强制所有 `.sec` 可见（`visibility/display/opacity`）；
- 给高度、允许滚动；
- 每段进入视口时开始播（用 `IntersectionObserver` 或滚动位置模拟 `--p`）；
- 顺便**替换 AI 可能抄错的 `__seek`** 为标准版。

> ⚠️ 兜底脚本**只用于预览**，进渲染前要移除（否则会和 `__seek` 打架）。

---

## 9. 运行环境约束

| 项 | 要求 |
|---|---|
| **磁盘** | 一次渲染需 **1~2GB** 临时空间；**剩余 <3GB 会被拦**（这是保护，不是 bug） |
| **Chrome** | headless chromium（hyperframes 自带或系统装） |
| **Node** | ≥ 22 |
| **ffmpeg** | 必须有（合帧/编码/抽音） |
| **内存** | 内嵌 base64 过大会在加载时崩 ⇒ §5.2 的体积上限就是为此 |

---

## 10. 验收清单（给未来的工具/窗口用）

一份新页面交给 hyperframes 前，逐条确认：

- [ ] `<section class="sec" data-start data-duration>` 分段，时间轴连续不重叠
- [ ] `window.__seek` **原样**存在
- [ ] 所有动画属性由 `var(--p)` 驱动；**无 rAF / setTimeout / canvas / @keyframes / Math.random**
- [ ] `--p=1` 是终态（没有 `1-p` 做出的出场淡出）
- [ ] 字体只用 `TXT-Serif`/`TXT-Sans` 或内嵌 `@font-face`；**全文简体常用字**
- [ ] 图片用 `<img src="N.jpg">`（不加 `images/` 前缀），单张 ≤2MB，全部素材都用上
- [ ] 所有内容在 720×1280 内，无溢出
- [ ] 压字处有遮罩，对比度 ≥4.5:1（大标题 ≥3:1）
- [ ] 段与段**硬切**（不做叠化）
- [ ] 本地用预览兜底打开能看到完整画面（不是全黑）
- [ ] 跑一次 `--check-only`，四道门全过

---

## 11. 版本与变更

| 版本 | 日期 | 变更 |
|---|---|---|
| v1 | 2026-10-22 | 首版。沉淀 §7 八类事故、四道闸门判据、字体/媒体/动效契约 |

> 本文档**只描述契约**，不含实现。实现与演进见：
> `scripts/video-factory/html-deck/tools/daily-film.mjs`（闸门与渲染）
> `scripts/video-factory/html-deck/tools/daily-page.mjs`（模板档生成）
> `src/lib/agent/daily-plan.ts`（AI 自由档提示词）
