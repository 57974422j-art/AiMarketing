# HTML → 逐帧 → MP4 可行性探针报告（probe-html）

- 日期：2026-10-02
- 机器：Windows / i7-12700F（12C·20T）/ 32GB / 有 GPU（ANGLE d3d11）
- 本机：Node v24.15.0、npm 11.12.1、FFmpeg 8.1-full（winget）、Chrome 152（系统安装）
- 沙箱目录：`G:/AiMarketing/dist-rel/probe-hf/`（**未改动** `scripts/**`、`src/**`、`package.json`、`electron/**`）

---

## 0. 结论速览

| 问题 | 答案 |
|---|---|
| 这条路在本机能不能跑通 | **能**。HyperFrames 0.8.111 装上即用，H.264+yuv420p+25fps+8s+中文全部达标 |
| 用的哪条路线 | **HyperFrames 本体**（非退化的自研实现） |
| 确定性 | **字节级完全确定**：同 HTML 两次渲染 MD5 完全相同，200 帧 PSNR 全 `inf` |
| 代价（720p/1080p，8 秒 200 帧） | 墙钟 **12.5s / 18.5s**，每帧 **62.5ms / 92.5ms**，峰值吃 **2.5–5 核**，增量内存 **0.55GB / 1.1GB** |
| 34 镜片子估算 | 逐镜起进程：**≈7.1 分钟（720p）/ 10.5 分钟（1080p）**；若 34 页放一次渲染：**≈3.2 分钟（720p）** |
| 能否与现有 ffmpeg 片拼接 | **能**，`ffmpeg -f concat -c copy` 直接拼成功（两段参数完全一致） |
| 4 核 16G 无 GPU 服务器 | **无硬伤，但有 3 个已知代价**：无 GPU 慢 ~1.34×；中文字体必须自己装/内嵌；素材不能走 `file://` |

---

## 1. 路线选择

**走 HyperFrames 官方 CLI**（`hyperframes@0.8.111`，Apache-2.0），未走自研 Playwright 兜底。理由：
- `hyperframes doctor` 在本机 13 项里只缺可选件（docker / whisper / Kokoro TTS），Chrome+FFmpeg+Node 全绿；
- 它自带我们最看重的那条契约：**headless Chrome 逐帧 seek + FFmpeg 编码**，且动画可 seek；
- CLI 默认非交互（`--non-interactive`），天然适合后面被服务端调用。

安装方式（**不碰项目 package.json**）：在沙箱目录 `npm init -y && npm i hyperframes@0.8.111`，直接调
`dist-rel/probe-hf/node_modules/.bin/hyperframes.cmd render . -c <page>.html -o <out>.mp4 --fps 25 --quality looks`。

---

## 2. 产物与证据

### 2.1 HTML 母版页（`dist-rel/probe-hf/hfprobe/`）
| 文件 | 说明 |
|---|---|
| `page-16x9.html` | 1280×720，大标题 + 3 要点 + 数据卡（25 fps / 逐帧确定性输出） |
| `page-9x16.html` | 720×1280，同上竖屏 |
| `page-1080p.html` | 1920×1080，同上（耗时对比用） |
| `page-asset.html` | 素材路径测试（相对 vs `file://`） |
| `page-font.html` | 字体回退测试（5 行不同 font-family） |
| `assets/gsap.min.js` | **本地内嵌 GSAP 3.14.2**（不依赖 CDN） |
| `assets/test.jpg` | 真实素材副本（来自 `E:/ai-marketing/storage/1/20260906_001.jpg`） |

时间轴契约（**按帧可 seek** 的写法）：
```html
<div id="stage" data-composition-id="main" data-start="0" data-duration="8"
     data-fps="25" data-width="1280" data-height="720">
  <h1 id="title" class="clip" data-start="0" data-duration="8" data-track-index="1">…</h1>
</div>
<script>
  var tl = gsap.timeline({ paused: true });      // ★ 必须 paused
  tl.from("#title", { opacity:0, y:36, duration:0.7 }, 0.4)
    .from(".bullet", { opacity:0, x:-28, duration:0.6, stagger:1.2 }, 1.6)
    .from("#card",   { opacity:0, y:28, duration:0.7 }, 5.2);
  window.__timelines["main"] = tl;                // ★ 键名 = data-composition-id
  tl.seek(0);
</script>
```
**绝不用 CSS animation 实时播放录屏** —— 那样不可复现、会丢帧；必须注册 paused 时间轴交给引擎 seek。

### 2.2 视频产物（`dist-rel/probe-hf/`）
| 文件 | 规格 |
|---|---|
| `probe-16x9.mp4` | 1280×720 h264 yuv420p 25fps 200 帧 8.00s 365KB |
| `probe-9x16.mp4` | 720×1280 h264 yuv420p 25fps 200 帧 8.00s 369KB |
| `probe-1080p.mp4` | 1920×1080 h264 yuv420p 25fps 200 帧 8.00s 657KB |
| `probe-16x9-run2.mp4` | 同 `probe-16x9.mp4`（确定性对比用） |
| `probe-16x9-screenshot.mp4` | 同上但强制截图模式（无 GPU 模拟） |
| `probe-asset.mp4` / `probe-font.mp4` | 素材 / 字体测试 |
| `old.mp4` | **现有渲染层**（`render.py --storyboard min-storyboard.json --no-subs`）8.00s 1280×720 |
| `concat-html-old.mp4` | `probe-16x9.mp4` + `old.mp4` 拼接产物，400 帧 15.92s |

抽帧证据：`frames/html16-t4.0.png`（HTML 段）、`frames/html9x16-t7.0.png`、
`frames/concat-t2.0-htmlseg.png`（拼接第 1 段=HTML）、`frames/concat-t12.0-oldseg.png`（拼接第 2 段=现有渲染层）、
`frames/asset-t1.5.png`、`frames/font-t1.5.png`。

---

## 3. 四个数字（含"怎么量的"）

**量法**：`bench.ps1` —— 直接前台调用 hyperframes（`Measure-Command` 级墙钟），同时后台 job 每 500ms 采样
`Get-Process node,chrome,ffmpeg` 的 `CPU`（累计 CPU 秒，用相邻差分 / Δt 折算等效核数）与 `WorkingSet64`；
内存取"相对渲染前基线的增量"。**基线**：本机用户自己的 Chrome 常驻约 4.5GB / 28 进程（9/28 就在跑），必须只算增量。
另有 `samples-*.txt`（原始采样）与 `bench-*.json`（结果）可复核。

### 3.1 渲染耗时（8 秒 = 200 帧，`--quality looks`，`--fps 25`）

| 分辨率 | 墙钟 | 引擎自报 | 每帧（墙钟） | 每帧（引擎） | 峰值等效核 | 内存增量 |
|---|---|---|---|---|---|---|
| 1280×720 | **12.49 s** | 10.5 s | 62.5 ms | 52.5 ms | 2.47 | 546 MB |
| 1280×720（第 2 次） | 12.65 s | 10.6 s | 63.3 ms | 53.0 ms | 2.50 | 517 MB |
| 720×1280 | 12.55 s | 10.5 s | 62.8 ms | 52.5 ms | 2.73 | 619 MB |
| 1920×1080 | **18.45 s** | 16.4 s | **92.3 ms** | 82.0 ms | 5.01 | **1088 MB** |
| 1280×720（强制截图模式=无 GPU 模拟） | 16.11 s | 14.1 s | 80.6 ms | 70.5 ms | 2.82 | 555 MB |

- **墙钟 − 引擎自报 ≈ 2.0 s**：这是 CLI 进程启动 + npm/node 引导的固定开销。
- 引擎自报的阶段拆分（首次 720p 日志）：`setup 6.8s + capture 5.7s + assemble 0.1s`。
  **setup（浏览器启动/校准/静态帧去重预判/GSAP 代理 flush）占总时长 ~50%** → 这是"逐镜起进程"最吃亏的地方。
- **一镜 8 秒要多少秒**：720p ≈ 12.5 s；1080p ≈ 18.5 s。
- **34 镜估算**（假设每镜 8 秒）：
  - 逐镜起独立渲染进程：720p `34 × 12.5 ≈ 425 s ≈ 7.1 分钟`；1080p `34 × 18.5 ≈ 629 s ≈ 10.5 分钟`。
  - 若把多页塞进**一次渲染**（setup 只付一次，按 capture 相速率 27.5ms/帧）：720p `5 + 6800×0.0275 ≈ 192 s ≈ 3.2 分钟`。
  - 4 核并行：见 3.2，建议 2 进程而非 4。

### 3.2 资源占用 / 4 核 16G 能跑几个

- CPU 峰值：720p **2.5 核**、1080p **5.0 核**（相同输入不同次之间在 2.47–5.01 波动 → 500ms 粒度的粗测，趋势可信、绝对值有 ±30% 误差）。
  一帧的 `Page.captureScreenshot`/`drawElement` 与 H.264 编码都在这一条链里，Chrome 自身又是多进程，所以**单次渲染就能吃掉 2–5 核**。
- 内存峰值增量：720p **~0.55 GB**、1080p **~1.1 GB**（若服务器上另起 Chrome，还要 + ~150–300MB 浏览器自身）。
- **结论**：4 核 16G 上，
  - 内存：跑 4 个 1080p 渲染（4×1.1 ≈ 4.4GB）绰绰有余，不是瓶颈；
  - CPU：**瓶颈**。单进程已吃 2.5–5 核，**建议并发 2 个**（各分 ~2 核）；硬上 4 个会互相抢核，总吞吐还不如 2 个。
  - `hyperframes render` 自带 `--workers` 与低内存模式（`--low-memory-mode`，总内存 ≤8GB 自动开）；4 核机上可先试 `--workers 2`。

### 3.3 确定性

| 对比 | 结果 |
|---|---|
| `probe-16x9.mp4` vs `probe-16x9-run2.mp4` MD5 | **完全相同**（修正布局前 `357CD1F6…`，修正后 `2508C906586EC0707544DA5B91CDBC03`；两次都一致） |
| 文件大小 | 两次完全相同（377992 / 364.8KB 级） |
| 逐帧像素差异（`ffmpeg psnr`） | 200 帧全部 `mse=0.00 / psnr=inf` |

→ **属"完全确定"（含编码字节）**，比我们要求的"仅帧内容一致"更强。同一输入同一输出，可用于回归测试。
（仅耗时不确定：同输入两次 10.5s vs 10.6s，属调度噪声，不影响产物。）

> **⚠️ 后续修正（见 §8.4，2026-10-02 于 `master-v1` 上实测）**：这里是**简单组合**（单 worker → `drawelement` + **流式编码**）的结果。换成**复杂母版**时默认会走**多 worker → `screenshot` 捕获 + 分块并行编码**，此时**两次渲染的 MD5 不同**（仅逐帧像素一致，PSNR 全 `inf`）。
> ⇒ 结论要收紧为：**"字节级确定"只成立在 `--workers 1`（流式编码）路径上；多 worker 并行编码路径只到"帧内容一致"。**
> ⇒ **推荐渲染设置：`--workers 1`**（实测同时更快：12 秒母版 8.7s vs 多 worker 13.1s）。

### 3.4 与现有 ffmpeg 片无缝拼接

- 现有渲染层：`python scripts/video-factory/render.py --storyboard min-storyboard.json --out old.mp4 --no-subs --workdir wd-old`
  → 输出 **1280×720 h264 yuv420p 25fps 200 帧 8.00s**，与 HTML 段参数**完全一致**。
- 拼接：`ffmpeg -f concat -safe 0 -i list.txt -c copy concat-html-old.mp4` → **exit 0，400 帧，15.92s**。
- 音轨：**两段都没有音轨**（HTML 渲染日志明确 `audioCount: 0`；old.mp4 本测也无音频输入）。
  → 所以 `-c copy` 拼出来是纯视频。**后配音频路径**：先 concat 出纯视频，再用现有混音链路
  （`render.py` 的 remux/混音，或 `ffmpeg -i concat.mp4 -i voice.mp3 -c:v copy -c:a aac -shortest out.mp4`）套旁白+BGM，字幕同理在**拼接后**叠加。
- 小瑕疵：`-c copy` 拼接产物 duration 报 15.92s（少末帧 1/25s），是 concat demuxer 的时间戳特性，不影响播放；介意就 `-c:v libx264` 重编一次。

---

## 4. 坑清单（按重要性）

1. **★ `.clip` 元素会被引擎移出正常文档流**（本文档最大坑）。
   凡是带 `class="clip"` 的元素，`margin/flow` 布局全部失效 —— 我第一次按"正常流式排版"写，渲出来标题和要点**全部重叠在左上角**、数据卡消失（见 `frames/` 修正前现象）。
   **对策**：每个 clip 元素自己写死 `position:absolute; left/top/width`；列表要整体做动画，就把 `.clip` 放在 `<ul>` 上、只对子 `<li>` 做 GSAP stagger（不要给每个 `li` 加 clip）。
2. **★ 中文字体完全依赖本机系统字体，换台机器就会变**。
   实测（`frames/font-t1.5.png`）：请求 `"Microsoft YaHei"`（本机**未装**）与请求 `"NoSuchFont-QQQ"`（不存在）**渲染结果一模一样**，即**缺失字体被静默回退**到浏览器默认无衬线；只有请求本机真装了的 `"Noto Serif SC"` 才生效（衬线明显不同）。
   → 内网/服务器上"字体名写了但没装"= 静默变成别的字体（**不是报错**），缺 CJK 字体时直接豆腐块。
   **对策**：母版里用 `@font-face` 内嵌项目内字体文件（woff2/ttf），不要依赖 `font-family` 取名；或至少在服务器 `apt install fonts-noto-cjk` 并**用同一套字体名**（两端输出要逐帧比对）。
3. **★ 素材不能用 `file://` 绝对值**。
   实测（`frames/asset-t1.5.png`）：`./assets/test.jpg`（项目内相对路径）= **加载成功**；
   `file:///E:/ai-marketing/storage/1/20260906_001.jpg` = **失败**，渲染日志报 `[media_load_failed] image media failed to load before capture`。
   原因：页面是被 HyperFrames 的本地静态服务以 http 提供的，Chrome 禁止 http 页面加载 `file://` 资源。
   **对策**：把素材复制/硬链进项目目录（或起本地静态服务、用 http URL）；`E:/ai-marketing/storage/*.jpg` 必须先"登记进项目"。
4. **GSAP 默认走 CDN**（脚手架里是 `https://cdn.jsdelivr.net/...`）→ 渲染期依赖外网、且不同版本会改像素。
   本探针已改为**本地内嵌 `assets/gsap.min.js`（72KB）**，建议沿用。
5. **无 GPU 服务器会用截图模式，慢 ~1.34×**。
   本机默认走 `drawElement capture · hardware gpu`（更快，日志可见）；强制 `PRODUCER_EXPERIMENTAL_FAST_CAPTURE=false` 后 8 秒片从 10.5s → **14.1s**。
   4 核无 GPU 服务器上按 **~1.35×** 折算即可，**不构成硬伤**。
6. **每帧截图的形式**：HyperFrames 默认**流式编码**（日志 `useStreamingEncode: true`、`encode (during capture)`），帧**不落盘**，直接在进程内 pipe 给 FFmpeg。
   → 比"PNG 序列 + 事后编码"**更快也更省盘**（本次峰值内存 0.55–1.1GB 即为代价）。需要中间帧时才用 `--format png-sequence`（给 AE/Nuke 用）。
7. **渲染前置固定开销 ~2s（CLI 引导）+ ~4–7s（浏览器启动/校准）**；且**校准偶发失败**会自动把 worker 从 6 降到 1（首次 720p 就命中，13.5s vs 后来的 10.5s）。
   → 别按"帧数线性"外推小片；**逐镜起进程很亏**（每镜都付一次 setup）。
8. **浏览器会复用 / 需要能启动 Chrome**：服务器要装 Chrome/Chromium（Puppeteer 可代下）；容器里通常要 `--no-sandbox`（本探针未验 Linux）。
9. **`<video>` 素材在无头浏览器里 seek 的可靠性 —— 未验证**（本轮只验了图片）。风险点：视频 seek 精度与解码状态依赖浏览器实现；HyperFrames 有 `media.autoProxy`、`--video-frame-format auto|jpg|png` 与帧缓存目录。**建议下一轮单独验**。
10. 次要：`hyperframes render` 输出**无音轨**；`--output` 目录必须已存在；首次运行会有匿名 telemetry 提示（可 `hyperframes telemetry disable`）。

---

## 5. 服务器移植结论（4 核 16G 无 GPU）

**无硬伤，可上**，前提是补齐 3 件事：
1. **字体**：内嵌字体文件（最稳）或服务器装 `fonts-noto-cjk`，且与本地做一次逐帧比对（字体不同 → 折行/字号全变）。
2. **素材**：所有素材必须进项目目录/静态服务，不能 `file://` 引用 `E:/…`（Linux 上也没有 `E:`）。
3. **Chrome + Node 22+ + FFmpeg**：三件套要在服务器就位；容器环境注意 `--no-sandbox`。

时间成本：34 镜 720p ≈ **7 分钟（逐镜，单进程）/ ~3 分钟（一次渲染多页）**；1080p ≈ 10.5 分钟。内存 1.1GB/进程，4 核上**并发建议 2 个**。

---

## 6. 本轮未做 / 不确定

- `<video>` 视频素材的 seek 可靠性未测。
- Linux/无头容器环境未测（`--no-sandbox`、Puppeteer 自带 Chrome vs 系统 Chrome）。
- 未测 HyperFrames 的字幕/音频/TTS 能力（本轮刻意只测"HTML→帧→MP4+拼接"这条主链）。
- 未测"旁白驱动切镜"的具体实现（页时长与旁白对齐规则属下游设计）。
- 峰值 CPU 是 500ms 粒度采样，绝对值为估计；并发数结论按趋势给（建议 2）。
- 未做任何 AI 调用；未改服务器；未 `git add/commit`。

---

## 7. 补充核实（与 srv-env 对接后，查 `node_modules/hyperframes/dist/**` 与 `~/.cache/hyperframes` 得到）

### 7.1 Chrome 可执行文件怎么选（回答"能否喂 playwright 的 chrome"）
解析顺序：`process.env["HYPERFRAMES_BROWSER_PATH"] ?? process.env["PRODUCER_HEADLESS_SHELL_PATH"]` → 本地缓存 → 系统 Chrome 路径（Linux 走 `SYSTEM_CHROME_PATHS`/`which`）→ 可自动下载。
- 实测 `hyperframes browser path` =
  `C:\Users\Admin\.cache\hyperframes\chrome\chrome-headless-shell\win64-152.0.7977.30\chrome-headless-shell-win64\chrome-headless-shell.exe`
  → **它下载的是 `chrome-headless-shell`，不是系统 Chrome**。缓存目录共 **269 MB**（chrome 152 + fonts）。
- `hyperframes browser ensure` 可显式下载；`HYPERFRAMES_NO_AUTO_INSTALL` 可关自动装。
- **⚠️ 别把 playwright 的完整 chromium 路径喂给它**：源码里 `warnSystemFallbackOnce()` 明确警告——
  "Using system Chrome at X; **HeadlessExperimental.beginFrame is unavailable in regular Chrome builds, so the perf-optimized capture path falls back to screenshot mode**"。
  即非 headless-shell 二进制会自动掉进我们实测的那条 **1.34× 慢路径**（10.5s → 14.1s）。
  **正解**：让 HyperFrames 自己 `browser ensure` 拿 `chrome-headless-shell`（首次需外网），或用 `HYPERFRAMES_BROWSER_PATH` 指向一个 **headless-shell** 二进制，而不是完整 Chromium。

### 7.2 `--no-sandbox`：**已经在源码里硬编码，无需自己加**
`dist/capture-*.js` 的 `captureBrowserArgs()` 返回的数组开头就是：
```js
[ "--no-sandbox", "--disable-dev-shm-usage",
  ...(disableWebgl ? ["--disable-gpu"]
     : ["--enable-webgl","--ignore-gpu-blocklist","--use-gl=angle","--use-angle=swiftshader"]),
  "--disable-blink-features=AutomationControlled", ... ]
```
→ root / 容器里 **不用自己加 `--no-sandbox`**；`--disable-dev-shm-usage` 正好解容器 `/dev/shm` 过小；无 GPU 时 WebGL 默认走 **SwiftShader 软件渲染**。
另有 `--browser-gpu` / `--no-browser-gpu`（`PRODUCER_BROWSER_GPU_MODE`）可强制软件模式。

### 7.3 字体：HyperFrames **自带 Google Fonts 代理 + 本地字体缓存**
- 代理：`dist/chunk-N32ITJ7L.js` 里 `host === "fonts.googleapis.com" || host === "fonts.gstatic.com"` 的拦截逻辑，
  缓存策略由 `HYPERFRAMES_PROXY_CACHE_*` 控制 → **HTML 里用 Google Fonts 的 Noto Sans SC，首次联网后落本地缓存，之后可离线且确定**。
- 实测缓存内容（创建时间 = 我本次渲染期间 18:59）：`~/.cache/hyperframes/fonts/noto-sans-sc/100..900-normal-*.woff2`（22 KB/字重）、
  `noto-serif-sc/200..900-normal-*.woff2`（29 KB/字重）。
- `dist/.../fonts/systemFontLocator.js` 有真实平台逻辑：darwin / win32(`%WINDIR%\Fonts`, `%LOCALAPPDATA%\Microsoft\Windows\Fonts`) /
  **Linux `/usr/share/fonts`**。
→ **修正第 4 节坑② 的建议（含 srv-env 的反驳，已采纳）**：字体有三条路，**最终排队**——
  1) **`@font-face` 内嵌项目内字体文件**（最确定、零网络、与磁盘缓存无关）★首选；
  2) **fontconfig 把 Noto 装到 `/usr/share/fonts`**（`systemFontLocator.js` 有 Linux 分支，能命中；字体名用 `render.py:309-321` 的权威源 `Noto Sans CJK SC`）；
  3) **Google Fonts 代理缓存**（**降级为"服务器可联网时的便利项"**，不作生产依赖）。
  **我原本把 ③ 排第一是错的，srv-env 三条反驳成立**：① 生产机若连不上 `fonts.googleapis.com/gstatic.com` 会**静默回退**（正是第 4 节坑② 那种最危险的失败模式）；② 代理缓存受 `HYPERFRAMES_PROXY_CACHE_MAX_BYTES`/`MAX_IDLE_DAYS` 淘汰 → **缓存被淘汰即引入不确定性**，与"字节级可确定"目标冲突；③ 命中与否还取决于 HTML 里 `@import` 写法。
  **并且坦白**：我对 ③ 的"能离线且确定"只做到**源码 + 缓存文件存在性**的验证，**没有做断网端到端实测** —— 置信度低于本报告其它数字。
  三者都要**两端逐帧比对一次**（字体不同 → 折行/字号全变）。**生产 HTML 建议直接禁掉外部字体 CDN**。

### 7.4 可用环境变量清单（服务器调优用）
浏览器：`HYPERFRAMES_BROWSER_PATH`、`PRODUCER_HEADLESS_SHELL_PATH`、`PRODUCER_BROWSER_GPU_MODE`、`PRODUCER_FORCE_SCREENSHOT`、`PRODUCER_EXPERIMENTAL_FAST_CAPTURE`
工具链：`HYPERFRAMES_FFMPEG_PATH`、`HYPERFRAMES_FFPROBE_PATH`、`HYPERFRAMES_EXTRACT_CACHE_DIR`（把帧缓存挪出小分区）、`HYPERFRAMES_NO_TELEMETRY`、`HYPERFRAMES_NO_UPDATE_CHECK`、`HYPERFRAMES_NO_AUTO_INSTALL`
并发/编码：`PRODUCER_MAX_WORKERS`、`PRODUCER_CORES_PER_WORKER`、`PRODUCER_ENABLE_BROWSER_POOL`、`PRODUCER_ENABLE_STREAMING_ENCODE`、`PRODUCER_ENABLE_CHUNKED_ENCODE`、`PRODUCER_LOW_MEMORY_MODE`
超时：`PRODUCER_PUPPETEER_PROTOCOL_TIMEOUT_MS`、`PRODUCER_PAGE_NAVIGATION_TIMEOUT_MS`、`PRODUCER_PLAYER_READY_TIMEOUT_MS`
字体代理：`HYPERFRAMES_PROXY_CACHE_MAX_BYTES`、`HYPERFRAMES_PROXY_CACHE_MAX_IDLE_DAYS`
> `PRODUCER_ENABLE_BROWSER_POOL` 值得试：本次 setup（浏览器启动/校准）占总时长 ~50%，复用浏览器理论上能砍掉大部分——**未验证，建议下一轮实测**。
> `--workers` 帮助原文：每个 worker 会另起一个 Chrome 进程，**≈256 MB RAM/worker**。

### 7.5 与现有渲染层共用 ffmpeg（核实 srv-env 提出的 D 项）
结论：**本机两条链本来就已经用的是同一个 ffmpeg 二进制**，所以第 3.4 节的拼接结论没有被"双版本 ffmpeg"污染。
- `render.py` 的候选表（`render.py:61-66`）：`[FFMPEG_PATH 环境变量, C:\ffmpeg\bin\ffmpeg.exe, %LOCALAPPDATA%\Microsoft\WinGet\Links\ffmpeg.exe, 'ffmpeg']`，取第一个"存在"的。
- 本机实测：`FFMPEG_PATH` 未设；`C:\ffmpeg\bin\ffmpeg.exe` **不存在**（Test-Path=False）→ 落到 `%LOCALAPPDATA%\Microsoft\WinGet\Links\ffmpeg.exe`。
- 而 HyperFrames（doctor）解析到的也是**同一个** `…\WinGet\Links\ffmpeg.exe`（它不自带 ffmpeg，`node_modules` 里没有 ffmpeg 包）。
  → 两边同源（都是 `shutil.which('ffmpeg')` 的那一个）。
- **固定 env 复测**：`HYPERFRAMES_FFMPEG_PATH`/`HYPERFRAMES_FFPROBE_PATH` 显式指向该绝对路径后重渲 720p，
  产物 `probe-16x9-ffmpegpin.mp4` 与未固定时**MD5 完全相同**（`2508C906586EC0707544DA5B91CDBC03`）；
  用它重做 concat 得 `concat-ffmpegpin.mp4`，仍 400 帧 / 15.92s（MD5 与原 concat 相同）。
  → 两个 env **确实生效**（只是指向同一二进制时是"无变化"）。
- **对服务器的推论（采纳 srv-env 的 D）**：服务器上把 `HYPERFRAMES_FFMPEG_PATH`/`HYPERFRAMES_FFPROBE_PATH`
  **显式钉到与 `render.py` 同一个 ffmpeg**（如 `/opt/ffmpeg/new/bin/ffmpeg{probe}`）是对的——本机因为恰好同源才"隐式一致"，
  服务器上两侧 PATH 很可能不同，**不钉就会出现"HTML 线新 ffmpeg / PPT 线旧 ffmpeg"的行为差异**。

### 7.6 `chrome-headless-shell` 的编解码器支持（实测，脚本 `codec-check.cjs`）
**动机**：`chrome-headless-shell` 由 `@puppeteer/browsers` 从 Chromium 通道下载，Chromium 官方构建**可能不含 H.264/AAC**（专利）。若如此，把本地 `.mp4` 喂给 `<video>` 会"解不了码"，会让 `<video>` seek 验证出现**与 seek 无关的假阴性**。故先查。

**方法**：写 `codec-check.cjs`（puppeteer-core 25.12.0 启动该 headless-shell → `video.canPlayType()`，不渲染、约 5 秒）。

**实测结果**（本机 = win64 构建，`HeadlessChrome/152.0.7977.30`）：

| 能力 | 结果 |
|---|---|
| H.264 baseline / high | **probably ✅** |
| AAC (mp4a.40.2) | **probably ✅** |
| VP8 / VP9 / AV1 | probably ✅ |
| MP3 / Opus | probably ✅ |
| **H.265 / HEVC** | **不支持 ❌** |
| **`.mov` / `video/quicktime`** | **不支持 ❌** |
| **`.avi` / `video/x-msvideo`**（两种 mime 拼法都试过） | **不支持 ❌** |
| `.ts` / `video/mp2t` | 不支持 ❌ |
| `.mkv` / `video/x-matroska` | `maybe` —— **浏览器给的模糊提示，不代表真能解**，别当支持 |

**与 srv-env 查到的素材入口白名单对照**（`src/app/video-edit/page.tsx:239` 显式 `['.mp4','.mov','.avi']`；另三处 `accept="image/*,video/*"` 会放进 iPhone 的 `hvc1`/HEVC）：
→ **白名单里 3 种有 2 种（`.mov`/`.avi`）在 headless-shell 里根本不可播**，加上 HEVC → **"HTML 线入口统一转码成 H.264 mp4"不是优化项，是必需项**。

**结论**：
- 我担心的"Chromium 缺专有编解码器"在**本机 win64 构建上未成立**，H.264+AAC 可用 → 本地 `.mp4` 喂 `<video>` 的路线在 Windows 侧可行。
- **但 Linux 构建是另一个二进制，不能由 win64 结果外推** → 请服务器侧 `hyperframes browser ensure` 后**原样跑一次 `codec-check.cjs`**（脚本已兼容 `chrome-headless-shell-linux64` 路径自动定位，约 5 秒）。
- **新增两条真实素材约束**：① **HEVC/H.265 不行**；② **`.mov`/QuickTime 不行**。若素材是这两种，必须靠 HyperFrames 的 `media.autoProxy`（"Auto-transcode browser-hostile video codecs"）自动转码，或自己先转 H.264。
- 本项**只回答了"能不能解码"，没回答"seek 准不准"** —— §6 第 9 点（`<video>` seek 可靠性）**仍未验证**。

### 7.7 已备好的 `<video>` seek 验证素材包（`seek-test/`，本机可复现）
按 srv-env 规格造，附带我做的两处修正；**只造素材，未跑浏览器 seek 验证**（该项仍等放行）。
| 文件 | 规格 |
|---|---|
| `probe-seek.mp4` | h264 1280×720 yuv420p 25fps **75 帧 / 3.000s**，moov 前置，无音轨 |
| `probe-seek-8s.mp4` | 同上 **200 帧 / 8.000s** |
| `probe-seek.webm` / `probe-seek-8s.webm` | VP9 同内容（防 Linux 侧无 H.264 的备用素材） |
| `page-video.html` / `page-video-8s.html` | 组合 3s / 8s，`<video muted playsinline preload=auto>`，**故意不 loop** |
| `expected.txt` | 期望色/秒号对照表、判据、用法、修正说明 |
| `build-seek-test.ps1` / `build-seek-test.sh` | Windows / Linux 重建脚本（结构一致） |
| `font.ttf`、`gsap.min.js` | 构建字体副本、本地内联时间轴库 |

**自证（PASS）**：`moov@36 < mdat@1780/3300`（moov 前置）；`scale=1:1` 取整帧均值 —— t=0.5→(192,0,1) 红、t=1.5→(0,160,0) 绿、t=2.5→(1,1,193) 蓝。
**修正两处规格**：① 规格写"2s"但期望在 t=2.5 抽帧 → 2 秒文件里不存在，故实做 **3.0s**（另加 8s 版）；② 规格的 `drawtext` fontfile 是 **Linux 路径**，本机不存在 → 改用本机 `arialbd.ttf` 副本，标签设计成纯 ASCII（T0..T7）**让字体不参与结论**。
**额外坑（记录）**：Windows PowerShell 5.1 把**无 BOM 的 UTF-8 `.ps1`** 按 ANSI/GBK 解析 → 带中文注释的脚本直接**解析失败、一行都没跑**；本包脚本已强制纯 ASCII。

### 7.8 `<video>` seek 的 Windows 基线（对照组，已实测）
**这是 §6 第 9 点（seek 可靠性）在本机的答案**，供 srv-env 的 Linux 结果做对照。
- 素材：`seek-test/` v2（每秒一色 + 居中 **`%{n}` 帧计数器** → 判据是**帧级**而不只是秒级）。
- 渲染：`page-video.html`（3s）与 `page-video-8s.html`（8s），`hfprobe/` 下 `-c` 指定，`--fps 25 --quality looks`。
  日志：`drawelement capture · hardware gpu`（**没有**掉进截图模式）。
- **结果**：
  | 检查 | 结果 |
  |---|---|
  | 3s 落点秒（最近色分类） | **PASS 3/3** |
  | 8s 落点秒（最近色分类） | **PASS 8/8** |
  | 帧级读数 t=1.10 | 顶部 `T1`、居中 **`3`**（期望 round(27.5) mod 25 = 2~3）**PASS** |
  | 帧级读数 t=4.90 | 顶部 `T4`、居中 **`23`**（期望 round(122.5) mod 25 = 22~23）**PASS** |
  | 失败模式 | 无洋红（说明素材加载成功）、无纯黑（说明解码成功） |
  → **结论：在 Windows + GPU + win64 `chrome-headless-shell` 上，`<video>` 的 seek 是帧级正确的（偏差 ≤ ±1 帧，正好等于抽帧 `-ss` 的取整不确定度）。**
  → **不能外推**到 Linux / 无 GPU（SwiftShader）——那正是 srv-env 要验的。
- 产物：`baseline-win-3s.mp4`（3.0s）、`baseline-win-8s.mp4`（8.0s）、抽帧 `frames/base8-t1.10.png`、`frames/base8-t4.90.png`。
- 校验器：`verify-seek.ps1`（最近色分类，抗色彩标签偏移）。

### 7.8.1 ⚠️ 色彩标签差异（拼接方案要注意）
| 文件 | color_range | color_space |
|---|---|---|
| `seek-test/probe-seek.mp4`（源素材） | unknown | unknown |
| `old.mp4`（现有渲染层） | unknown | unknown |
| **`baseline-win-3s.mp4`（HyperFrames 产物）** | **tv** | **bt709** |

- **HyperFrames 产物带 `tv/bt709` 标签，源素材与现有渲染层都是无标签**。
- 同帧实测：源素材角落 (0,161,0) → HTML 线产物解码成 **(0,133,0)**（饱和色明显偏移，中性灰几乎不变：96→95、160→160）。**机制**：无标签时解码器对色矩阵的默认假设与产物声明的 bt709 不一致（根因已用 `tagtest.ps1` 做 A/B 对照验证：**见 §7.8.2**）。
- **拼接影响（已实测）**：`concat -c copy` 拼接后，**输出继承第一段的标签**（实测 `baseline-win-3s.mp4 + old.mp4` → 产物为 `tv/bt709`）。把旧段放到这个容器里解码，实测角点 (13,23,32) → (12,23,33)，**差 ≤1 单位 ≈ 可忽略**；但该测试内容的颜色接近中性，**饱和内容的影响未测**。
- **建议**：HTML 线素材入口统一转码时**显式写死色彩标签**（`-color_range tv -colorspace bt709 -color_primaries bt709 -color_trc bt709`），让 ffmpeg 与浏览器用同一套矩阵；是否因此消除偏移，见 §7.8.2 的实验结论。

### 7.8.2 ✅ 色彩偏移根因已定位（`tagtest.ps1`，同内容 A/B 对照）
同一段素材造两份（像素内容一致，**只差色彩标签**），分别经 HyperFrames 渲染后取同一点角落色：

| 源素材 | 源角落 RGB | 渲染产物角落 RGB | 偏移 |
|---|---|---|---|
| **无标签**（= 现状，`render.py`/素材池的产物就是这种） | (0,161,0) | **(0,133,0)** | **绿 −28（约 −17%）** |
| **显式 `-color_range tv -colorspace bt709 -color_primaries bt709 -color_trc bt709`** | (0,159,0) | **(1,156,0)** | 绿 −3（≈ 消除） |

→ **根因确认**：素材不带色彩标签时，**浏览器对色矩阵的默认假设与产物声明（bt709/tv）不一致**，饱和色明显偏移；中性色几乎不受影响（灰 96→95、160→160）。
→ **可直接落地的修复规范**：**HTML 线素材入口统一转码时，必须显式写死色彩标签（`bt709` + `tv` range）**，否则每条素材的饱和色都会偏 ~15–18%。这条要并进 srv-env 说的"一处治理"，否则"统一转码"只解决了容器/编码，没解决色彩。
→ 这也解释了 §7.6 里"HTML 段与现有段拼接"的隐性风险：**旧素材无标签、HTML 产物有标签**，两段的饱和色本就会差一截；拼接前统一标签可一并消除。
产物：`tagtest/clip-untagged.mp4`、`tagtest/clip-tagged.mp4`、`tagtest/baseline-untagged.mp4`、`tagtest/baseline-tagged.mp4`。

#### 7.8.2.1 追问：`-colorspace` 是"只声明"还是"会转换"？（srv-env 提出的风险，已用 raw YUV 判定）
**srv-env 的担心（很有道理）**：`-colorspace/-color_primaries/-color_trc/-color_range` 只是**声明**、不转换像素；若素材真身是 BT.601，直接声明 bt709 会把"没标签"变成"**标错标签**"，问题更隐蔽。

**验证方法**（`colorspace-test.ps1`）：造一份**真身就是 BT.601** 的源（`-colorspace smpte170m -color_primaries smpte170m -color_trc smpte170m -color_range tv`，从 RGB 生成 → 其 Y 值可反推真身），再做两种再编码：
- `decl-only`：只加声明 `-colorspace bt709 …`（**无** scale 转换）
- `convert`：`-vf "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p"` + 同样声明

| 文件 | tags | 角落 raw Y/U/V | ffmpeg 解码 t=1.5 | 经 HTML 线渲染 t=1.5 |
|---|---|---|---|---|
| `cs601`（真身 601） | tv, **smpte170m** | **Y=97** | (0,161,0) | (0,158,1) |
| `decl-only` | tv, bt709 | **Y=113** | (0,159,0) | (1,156,0) |
| `convert` | tv, bt709 | **Y=113** | (0,159,0) | (1,156,0) |

**判定**：目标是 RGB(0,160,0)。理论 luma：BT.601 → `16+219·0.587·160/255 = 96.7`；BT.709 → `16+219·0.7152·160/255 = 114.3`。
→ `cs601` 的 **Y=97** 证明它确实是 601 编码；`decl-only` 的 **Y=113** 恰好等于 709 的理论值 ⇒ **ffmpeg 8.1 在输出端声明 `-colorspace bt709` 时，确实做了 BT.601→BT.709 的实际矩阵转换**（不是只写元数据）。`convert` 结果与它**完全一致**（Y/U/V 逐字节相同）。
→ 因此三种文件各自的"标签 ↔ 像素"都是自洽的，渲染出来都≈正确绿（偏差 ≤4），**没有复现出"标错标签"的可测偏移**。

**结论（写进规格时的措辞）**：
1. **主因是"有没有标签"**：无标签 → 浏览器按默认矩阵解释 → 饱和色偏 **−17%**（实测 161→133）；打上标签后偏差 ≤3。
2. **`-colorspace` 在 ffmpeg 8.1 上会真的转换像素**（有 YUV 级证据），所以"只声明导致标错"这条**在本版 ffmpeg 上不成立**；但**仍推荐 srv-env 的 `convert + declare` 写法**（`scale=out_color_matrix=…` + 四个标签）——它是**防御性**的：换 ffmpeg 版本、换像素格式（10bit）、或上游滤镜链绕过自动转换时，显式转换才是稳的，且实测**零额外代价**（输出与 decl-only 逐字节相同）。
3. 验收判据用 srv-env 拟的那条即可：**ffprobe 四字段 = bt709/tv，且再渲染一次后饱和色角落偏移 ≤3**。

#### 7.8.2.2 追加：**"只声明不转换"确实有可达状态 —— 在 `-c copy` 重封装路径上**（含一条方法论修正）
srv-env 不接受"8.1 已转换"就收工，指出这**是版本相关行为**、服务器用的是老 ffmpeg。为不把结论停在推测，我找了同一版本内的**可达路径**：

| 文件 | 怎么来的 | ffprobe 标签 | **角落 raw YUV** | 浏览器渲染 |
|---|---|---|---|---|
| `cs601.mp4` | 真身 BT.601（Y=97 ≈ 601 理论 96.7） | `tv, smpte170m` | Y=97 | (0,158,1) 正确 |
| `decl-only.mp4` | **再编码** + 只声明 bt709 | `tv, bt709` | **Y=113**（709 理论 114.3） | (1,156,0) 正确 |
| **`remux-declared.mp4`** | **`-c copy`（只重封装）** + 声明 bt709 | **`tv, bt709`** | **Y=97（像素没变，仍是 601）** | **(0,158,1) —— 仍是正确** |

**三个要点**：
1. ✅ **"标签说 bt709、像素是 601"的错标文件是真实可造的**（`-c copy` 无法转换像素）⇒ **srv-env 的保留不是纯版本推测，是一个真实可达状态**；只是它出现在**重封装**路径，而不是再编码路径。**推论（可写进管线纪律）：任何"统一转码"都不许只做 remux + 改声明；要么真再编码，要么显式 `scale=out_color_matrix`。**
2. ⚠️ **但错标文件在这里是"惰性"的**：ffmpeg 解码与 Chrome 渲染**都得到了正确颜色**。推断（**未完全证实**）：MP4 色彩标签有**两份来源** —— 容器 `colr` atom 与 H.264 码流 **VUI**；`-c copy` + `-colorspace` **只改容器 atom**，码流 VUI 仍是 601，**真正解码的两方用的都是码流 VUI**，所以出画正确；被误导的只有 `ffprobe`（它报容器 atom）。⇒ 这条路径主要坏在"**元数据自相矛盾**"，而非出画。
3. 🔧 **方法论修正（对我自己上一节的判据）**：**不能用"角落 RGB 读数"判断标签问题** —— 上表 `remux-declared` 标签 bt709 / 像素 601，ffmpeg 解码给出的却是 (0,161,0)（而非理论偏移值 (0,132,0)），说明 RGB 读数在"容器/码流标签打架"时会给出误导性结果。**判标签问题只用**：① **raw YUV 对比**（像素有没有被改）② **浏览器渲染**（我们真正关心的解码器）。

**10bit 边界**：`yuv420p10le` 的真身 601 源再编码 + 只声明 → 渲染仍是 (0,161,0)；但**未测 10bit 的 raw Y**，所以"10bit 下声明是否同样触发转换"**未证实**。
证据：`cs-test/README.md`（自描述，含给服务器复跑的输入 `cs601.mp4` 与判读标准）+ `cs-extra-test.ps1`。

#### 7.8.2.3 colr atom vs H.264 VUI —— **已补实验，从"推断"升级为"事实"**
team-lead 明确要求：这条"不要升级成结论，**除非补了实验**"。补上了 —— 用 `trace_headers` 位流滤镜**直接读码流 VUI**：

| 文件 | 容器 `colr`（ffprobe） | 码流 VUI `matrix_coefficients` | 一致? |
|---|---|---|---|
| `cs601.mp4` | tv, **smpte170m** | **6 = smpte170m** | ✓ 一致 |
| **`remux-declared.mp4`**（`-c copy` + 声明 bt709） | tv, **bt709** | **6 = smpte170m** | **✗ 矛盾** |
| `decl-only.mp4`（再编码 + 声明 bt709） | tv, **bt709** | **1 = bt709** | ✓ 一致 |

**结论**：
1. ⇒ **事实**：`-c copy` + `-colorspace bt709` **只改了容器 `colr` atom**，**码流 VUI 的 `matrix_coefficients` 仍是 smpte170m** ⇒ 两份标签**自相矛盾**。
2. ⇒ 该文件解码结果 **(0,158,1)** 与 **VUI（601）**一致、而非与容器（709）一致 ⇒ **实际解码走的是码流 VUI**。（"各解码器按什么优先级读"未逐一定证，但**行为层面**已由解码结果反证；`ffprobe` 读容器 → 所以只有它被误导。）
3. ⇒ **srv-env 关于 `concat -c copy` 的推论得到了机制支撑**：混拼时输出容器只留一份 `colr`（继承首段），而各段**码流 VUI 各是各的** → 必然制造同一种自相矛盾。**所以"D9 让两个生产者都真再编码"不只是修色偏，也是消除拼接后的元数据矛盾。**
4. ⇒ 也解释了为什么**再编码是干净修法**：再编码会**重写 SPS/VUI**，容器与码流同时变成 bt709。
5. 附加观察：`cs601` 的 VUI 里 `colour_primaries=2`、`transfer_characteristics=2`（都是 **unspecified**），只有 `matrix_coefficients` 被我显式设成 6 —— 这解释了 ffprobe 对它的 primaries/transfer 报 `unknown`。

命令：`ffmpeg -v trace -i F -c copy -bsf:v trace_headers -f null -`（在输出里找 `matrix_coefficients` / `colour_primaries` / `video_full_range_flag`）


### 7.8.3 我自己的一个真 bug（v1 → v2 已修，务必用 v2 素材）
v1 素材帧上显示的是 **`T=220`** 而不是 `T1`（字号也塌了）。根因：PowerShell 双引号串里写
`"text=T$i:fontsize=220"` → PS 把 `$i:fontsize` 解析成 **scope `i` 下的变量 `fontsize`** → 下标 `$i` 被吃掉、`=220` 并进文本。
修法：一律写 `"text=T${i}"`。**`.sh`/bash 不受影响**（`$i` 后遇 `:` 正常结束变量名）。
教训与 §7.5/§7.6 同源：**"我以为写对了"必须落到"看一眼渲染出来的像素"**。

---

## 8. `master-v1` —— 第一套四页母版样板（team-lead 拍板的下一件）

目录：`dist-rel/probe-hf/master-v1/`；参数清单见其中的 **`PARAMS.md`**（本节的数字都来自那里）。

### 8.1 交付与实测
| 产物 | 规格 |
|---|---|
| `master-v1.mp4` | **12.0s / 300 帧 / 1280×720 / 25fps / H.264 yuv420p** — 4 页 × 3s（封面 / 要点 / 数据 / 尾页） |
| `master-v1-9x16.mp4` | 同上，**720×1280** 竖屏，复用同一套 CSS 变量 + `body.p` 覆盖 |
| `frames/` | 每页 2 张抽帧（`seq_1..8.png` = 4 页 × 入场中/全就位）+ 拼图 `contact-16x9.png` + 转场帧 `trans-3.02.png` |
| `frames/portrait/` + `contact-9x16.png` | 竖屏抽帧 |
| `PARAMS.md` | 可调参数清单（配色/版心/字阶/节奏/页型契约/素材与字体规则/实测成本/改动同步表） |

- 成本（本机 12 核）：
  | 设置 | 16:9 | 9:16 | 捕获模式 |
  |---|---|---|---|
  | **`--workers 1`（推荐）** | 引擎自报 **8.7s** | **8.6s** | `drawelement capture · hardware gpu` + **流式编码**（encode during capture） |
  | 默认（自动多 worker，本机取 6） | 13.1s | 14.6s | `screenshot capture` + setup 3.0s / capture 7.2s / encode 2.3s |
  ⇒ **`--workers 1` 同时更快且可复现**（见 §8.4），推荐作为母版默认渲染设置。

### 8.2 关键技术决定（都为了"逐帧可 seek + 可复现"）
1. **动效全部走 paused GSAP 时间轴**（`window.__timelines["main"]`），排期数据化在 `data-at`/`data-anim` 上 → **同一组动作四页共用，只是顺序不同**。
2. **数据页数字滚动用"按位滚筒"（odometer）而非 JS 改文本**：每个数字是一列 `0..9` 的堆叠，用 `yPercent` 位移到目标位。**纯 transform ⇒ 逐帧 seek 100% 确定**，不依赖 `onUpdate` 在 seek 时是否触发。抽帧实测能抓到中途值（`frames/seq_3.png` 抓到 "70"，最终 "82"）。
3. **字体内嵌 + 子集化**：`Noto Serif SC`(24MB→**176KB**) / `Noto Sans SC`(16.9MB→**133KB**)，`@font-face` + 项目内 woff2，**不用外部 CDN**、**不用 msyh**（授权）。脚本 `subset-fonts.py` 可从本母版全部源文件自动收集字符。
4. **页间转场经量化验证**（不靠肉眼）：标题区平均亮度 t=2.7→**59.7**、t=3.30→**27.9**（谷底）、t=3.9→**33.9** 回升 ⇒ 确实是"淡出→淡入"的过渡，且**全程无空屏/黑帧**。（我最初看 t=3.02 的抽帧"以为没转场"，实测才发现是 10% 进度看不出。）
5. 封面素材：从 `E:/ai-marketing/storage/1/20260906_001.jpg` **拷进 `assets/cover.jpg`** 并以相对路径引用（**证明素材能正常进 HTML**，非 `file://`）。

### 8.3 这次踩到的两个新坑
1. **封面"出品方/日期"原本放在右下，正好压在素材高亮区上读不清** → 移到左下（深色底）。**版式不能只按"对称"排，要按"底下有没有画面"排**。
2. 纹理层 `opacity:.28` 偏重（"持续微动"变成了"看得见竖条纹"）→ 降到 `.16`；同时把 `--photo-dim` 加强到 `grayscale(.82) brightness(.40) saturate(.55)` 才真正低饱和。

### 8.4 ⚠️ 重要修正：**"字节级确定"只成立在单 worker 路径**（收紧 §3.3 的结论）
在 `master-v1` 上复核确定性时发现：**默认（自动多 worker）两次渲染的 MD5 不同**。

| 对比 | MD5 | 逐帧像素 |
|---|---|---|
| 默认多 worker，渲染两次 | **不同**（`04A7C818…` vs `A1E76271…`） | **PSNR 全 `inf`（像素完全一致）** |
| **`--workers 1`，渲染两次** | **完全相同**（`7F1B528DD953316644A621054861EA03`） | 一致 |
| 6 worker 产物 vs 1 worker 产物 | 不同 | PSNR **55.34 dB**（mse 0.19，肉眼不可分辨，但**不是同一批像素**） |

**根因（有日志证据）**：worker 数决定捕获与编码路径——
- `--workers 1` → `drawelement capture · hardware gpu` + **流式编码**（`encode (during capture)`）⇒ 单线程顺序 ⇒ **字节级可复现**
- 多 worker → `screenshot capture` + 分块并行编码 ⇒ 帧到达/分块顺序不定 ⇒ **只到"帧内容一致"**
（日志里的 `streaming-encode gate {enabled:true, reason:"single_worker"}` 就是这个开关。）

**结论与建议**：
1. §3.3 的"字节级完全确定"**必须限定为 `--workers 1`**；多 worker 路径只保证帧内容一致。（这不推翻 §3.3 的实测——那批简单页确实走的是单 worker + 流式路径，MD5 相同；但那不是默认行为。）
2. **推荐渲染设置：`--workers 1`**。
3. **附带好处：单 worker 更快**——12 秒母版 **8.7s** vs 多 worker **13.1s**，因为它走的是快的 `drawelement`+流式路径，而不是慢的 `screenshot` 截图路径。
4. 交付的抽帧/拼图/转场复测都已用**最终交付的那一版（单 worker）**重出，避免"证据与交付物不是同一批像素"。
证据：`master-v1/determinism/`（`multiworker-a/b.mp4`、`singleworker-a/b.mp4`）+ `psnr-master.log`、`psnr-6w-1w.log`。

---

## 9. `deck-contract` —— AI 侧分页契约 v1（team-lead 拍板的第二件）

目录：`dist-rel/probe-hf/deck-contract/`（文本资产另按约定拷了一份到 `docs/ppt-html-probe/`）。
目标：**让 AI 产出"一整套幻灯片的数据"，而不是 HTML/CSS**；版式/动效/字体全由母版负责。

| 交付物 | 内容 |
|---|---|
| `deck.schema.json` | 分页契约：4 页型（cover/bullets/data/end）+ 字段 + **内容量下限写进约束**（要点 3~5 条且每条 ≥8 字、数据页必须有 数字+单位+解释 + 恰好 2 个次指标、封面必须有 主标题+副标）；`style` 五个字段全是枚举 |
| `AI-PROMPT.md` | 提示词草案：只输出本 schema 的 JSON（**禁 HTML/CSS/JS**）、**风格参数只能在枚举里选不能给数值**、内容下限表、**输出前自检清单**、用户输入→页型决策路径（宁少勿虚，撑不起下限就减页而不是硬凑） |
| `validate-deck.mjs` | **零依赖校验器**（Node ≥18）：报"哪一页不达标、缺什么"，**每项附替换页型建议**；额外查 schema 表达不了的三件事：首屏必须 cover、字符串里出现 HTML/CSS 标记即判违规、不达标时给替代页型 |

**自检（可复现，跑在 `deck-contract/`）**：
| 样例 | 结果 |
|---|---|
| `examples/deck.master-v1.json`（**金样例 = 母版事实基准**） | **PASS / exit 0**（0 不达标 / 0 建议） |
| `examples/deck.bad.json` | **FAIL / exit 1**（13 不达标 / 3 建议，逐条带修法） |
| `examples/deck.html-injected.json`（金样例掺 HTML/CSS） | **FAIL / exit 1**（**恰好 3 项**，全是 HTML 标记）→ 闸门精准、不误伤其它字段；同时复验金样例仍 PASS（无假阳性） |

**为什么用真实母版内容当金样例**：这样"契约"和"已跑通的东西"互为验证——金样例 PASS 说明契约没把 v1 判死，反例 FAIL 说明下限真的拦得住。
**边界（v1 不做）**：旁白/TTS、字幕、素材转码（那属"入口统一转 H.264 + bt709/tv"）、多母版切换（`masterId` 只有 `master-v1`）。

---

## 10. `deck-contract` 第二批：样例集回归（D11）+ 生成器（D12）

### 10.1 D11 样例集回归（`check-examples.mjs`）
一条命令跑三个样例，断言 **exit code + 不达标项数 + 建议项数** 与基线**完全相同**（数量一变就红），专防"改 schema 把闸门改松"。

**基线数字（已登记，复跑就用这组）**
| 样例 | exit | 不达标 | 建议 |
|---|---|---|---|
| `deck.master-v1.json`（金样例） | 0 | 0 | 0 |
| `deck.bad.json` | 1 | **13** | 3 |
| `deck.html-injected.json` | 1 | **3**（且必须全部落在"HTML/CSS 标记"上） | 0 |

**敏感性已自证（回归不是摆设）**：把校验器要点下限 3→1（用 `DECK_VALIDATOR` 指向一份改松副本）→ 立刻变红（`deck.bad.json` 13→12、exit 1）；换回正式版 → 恢复 PASS。

### 10.2 D12 生成器（`render-deck.mjs`）—— 端到端最后一环
`deck.json` →（**闸门**）→ 母版 HTML →（`--workers 1`）→ 整条 MP4 + 每页抽帧 + **输入→输出对账表**。
**任一步失败即中止、绝不渲染**：校验不过 / 有未命中 / 有跨页泄漏 / 大数字编码错 → 全部 exit 1。

**两条输入都跑通（这就是"真由数据驱动"的证明）**
| 输入 | 产物 | 结果 |
|---|---|---|
| `examples/deck.master-v1.json`（4 页） | 300 帧 / 12.00s | h264 yuv420p 25fps · **tv/bt709**；对账 0 未命中 / 0 泄漏 |
| `examples/deck.full6.json`（6 页，我新造） | **450 帧 / 18.00s** | 同上；画面 `out/deck.full6/frames/sheet-full.png` |

→ **页数 / 顺序 / 时长完全由 deck 决定**（4→300 帧、6→450 帧），并打印页型序列日志 `cover → bullets → data → bullets → data → end` 供对账。

**"同版式"量化**（4 页生成 vs 手写 `master-v1.mp4`，取各页"全就位帧"以隔离排期差异）：
**P1 44.67 dB · P2 51.31 dB · P3 51.64 dB · P4 `inf`（像素完全一致）**。
（P1 的差只来自封面小字措辞：deck 的 `date="2026-10"` vs 手写母版的"2026 年 10 月"。）

**对账口径（关键，且我中途修过一次）**：初版用"整片 HTML 子串比对"，**立刻被自己的闸门拦下**——① 大数字是**滚筒渲染**，HTML 里根本没有 "82" 字面量；② 短字符串（单位"秒"、数字"4"）在别处误命中 → 报出 4 条**假泄漏**。
改为：**按"文本节点"比对** + `data.metric.number` 单独校验**滚筒格数是否编码了正确数字**（末位多转一圈 = +10）。**不做 OCR**（避免引入新误差源），画面正确性由 `frames/` 人眼确认。

**顺手抓到并修掉一个"契约能过、渲染不出来"的隐患**：deck 的 `style.palette/density/tempo` 起初**能过校验但渲染侧完全没消费**——正是 team-lead 警告的那类失败模式。已补映射：`palette`→`--accent`/`--accent-rgb`（连背景光晕）、`density`→`--pad`/`--gap`、`tempo`→`--enter`/`--enter-gap`/`--xover`。
⚠️ 其中 `tempo` 会改 `--xover`，而**页窗口正是用 xover 算出来的** → 生成器必须用**同一个值**算 `data-start/data-duration`，否则 clip 窗口与 `master.js` 时间轴错位（已把 `TEMPO` 定为唯一真相源）。
**客观验证 palette 真生效**：底部进度线像素 `warm-gold`=(158,128,87) vs `clay`=(146,112,92)，色比分别吻合各自主题真值 ⇒ **同一份模板、只换令牌**。

**改动母版资产的代价做了字节级回归**：母版的暖光时长从写死 12s 改成"页数 × 单页"推导（为支持任意页数），并新增 `--accent-rgb`、`.digitstatic` —— 重渲 `master-v1.mp4` 的 **MD5 与改动前完全相同**（`7F1B528DD953316644A621054861EA03`）⇒ 对已批准的母版**零行为变化**。

### 10.3 新增/改动文件
`deck-contract/`：新增 `check-examples.mjs`、`render-deck.mjs`、`examples/deck.full6.json`；`out/<deck名>/`（生成 HTML + mp4 + frames + `reconcile.md`）。
`master-v1/assets/`：`master.js`（暖光时长参数化）、`master.css`（+`--accent-rgb`、+`.digitstatic`）——均经字节级回归确认零影响。

---

## 11. 方法论纪律（本轮沉淀的 6 条）—— **下一批沿用同一套**

> 归拢在此，避免散在消息/文档各处。每条都对应本轮一次真实的判断失误或验证成功。

1. **判据要选对量具（同一件事不能混用一条判据）**
   | 要判什么 | 用什么量具 | 不能用什么 |
   |---|---|---|
   | "标签/像素有没有被改" | **raw YUV** + 浏览器渲染 | RGB 读数（容器/码流标签打架时会误导） |
   | "seek 落点在第几秒" | **最近色分类**（同一标签体系内、8 个差异极大的饱和色） | —— |
   | "配色的绝对色值" | **raw YUV / 整块色块** | 角落 RGB 读数（2px 细线 + 取均值 + H.264 有**系统性 0.80× 偏暗**） |
2. **先有锚点，再谈别的**：造一份"真身已知"的源再去测量。（本轮的锚点 = 真身 BT.601 源，`Y=97 ≈ 601 理论 96.7`；`C5b` 就是这条的产物。）
3. **受控对照：只差一个变量**（team-lead 2026-10-02 定为**风格类对比的强制做法**）。本轮例子：为比 palette 专门补 `palette-clay.json` 四页版 —— 与金样例**逐字相同、只改 `style.palette`**；否则"换了配色也换了文案"的差异无法归因。
4. **闸门在前、结论只从产物取**：校验不过**不渲染**；结论从 **抽帧 PNG / ffprobe / MD5 / raw YUV / reconcile 表**取，**不从"脚本没报错"取**。
5. **推断与事实必须分开写，并标注置信度**。本轮例子：colr atom vs VUI 起初标"推断"，补了 `trace_headers` 实验后升级为事实；解码器优先级仍标"未逐个定证、由解码结果反证"。
6. **改已批准资产 → 必须做字节级回归**。本轮两次：母版暖光时长参数化后重渲 `master-v1.mp4` MD5 **不变**；`--accent-rgb`/`.digitstatic` 新增后同样 MD5 **不变** ⇒ 对已批准母版零行为变化。

**已知会复用的自检组合**（team-lead 已确认下一批沿用）：**闸门在前 + 对账在侧 + 抽帧给人眼 + 字节级回归**（另有样例集回归 `check-examples.mjs` 的"基线数字断言"防闸门被改松）。

---

## 12. 页型 4 → 10（第三批）

### 12.1 交付
- **契约与校验器同步扩展**：`deck.schema.json` + `validate-deck.mjs` 新增 6 种页型（`section`/`chart`/`compare`/`quote`/`toc`/`summary`）的字段与**内容量下限**，并对每种都给了"不达标 → **建议替换页型**"的映射；`AI-PROMPT.md` 的页型表与下限表同步。
- **金样例 = 8 页 / 24 秒整片**：`examples/deck.types8.json`
  `cover → section → bullets → chart → compare → data → quote → end`
  产物 `out/deck.types8/output-deck.types8.mp4` = **600 帧 / 24.000s / 1280×720 / 25fps / h264 yuv420p / tv+bt709**；
  证据：每页 2 帧（16 张）+ `sheet-full.png`（8 页拼图）+ `chart-closeup.png` + `reconcile.md`（**未命中 0 / 大数字错 0 / 图表错 0 / 跨页重复 0**）。
- **6 个新反例**（每种新页型各 1 个）+ `check-examples.mjs` 基线更新（见 §12.4）。

### 12.2 图表"真画"做了**两层**证明（team-lead 要求"用抽帧证明图上数值=输入"）
| 层 | 工具 | 证明 | 结果 |
|---|---|---|---|
| HTML 层 | `render-deck.mjs / chartCheck` | 生成的 HTML 里，从图上几何（柱高 / 折线顶点 y / 弧长）**反推数值**再与输入 series 逐点比 | **0 错** |
| 像素层 | `verify-chart.mjs`（抽帧 → 逐柱量高度） | 画面上的柱**真的这么高**，没被裁/没画错 | **5 根柱全部 ≤±1px** |

像素层明细（绘图区高 234px，容差 ±4px）：
| 输入值 | 期望柱高 | 实测柱高 | 差 |
|---|---|---|---|
| 62.5 | 158.5px | 159px | +0.5 |
| 70.5 | 178.7px | 179px | +0.3 |
| 92.3 | 234.0px | 235px | +1.0 |
| 29.0 | 73.5px | 74px | +0.5 |
| 24.9 | 63.1px | 63px | −0.1 |

三种类型都真画：`bar` 用 `scaleY` 生长、`line` 用 `strokeDashoffset` 收线、`donut` 用 `dasharray/dashoffset` 逐片展开 —— **全是 transform/描边属性动画 ⇒ 逐帧可 seek、无 JS 数值插值**。
（生成器还给每个图表页写出 `chart-meta.json`（绘图区几何 + 每点坐标），验证器读它而不重复常量，避免"两处 PLOT 漂移"。）

### 12.3 两个我被自己的闸门/回归拦下的问题（都属"判据太宽"）
1. **"跨页泄漏"判据误报 3 条**：`HTML 逐帧`（对比页标签）嵌在章节副题里、`2026-10`（封面日期）嵌在引用出处里、`01`（章节编号）撞上要点页编号 —— 全是**正常内容**，原判据"子串命中即泄漏"太宽。
   → 收窄为：**拦渲染**只认"别页字段在本页出现了**正好等于该值的独立节点**"（并跳过 <4 字的值）；纯子串命中降级为**"疑似重复（不拦）"**列。
   → 收窄后复跑 4 页 / 6 页 / 配色三条老 deck **仍全 0/0/0/0**（证明是修判据、不是放水）。
2. **`body.p` 直接覆盖 `--pad`** → 导致契约里的 `density` 在**竖屏下完全失效**（横屏才生效）。改为 `--pad-base` 基准 + `--pad: var(--pad-base)` 派生，`density` 横竖屏一致生效。
   → 该 CSS 改动经**字节级回归**：重渲 `master-v1.mp4` MD5 **仍为 `7F1B528DD953316644A621054861EA03`**（与改动前完全相同）⇒ 对已批准母版零行为变化。
   （本轮共做 3 次字节级回归：新增页型样式/动效、图表动效分支、`--pad-base` 重构 —— 三次均 PASS。）

### 12.4 `check-examples.mjs` **新基线（9 个样例，逐字）**
```
deck.master-v1.json      = exit0 / 0err / 0warn
deck.bad.json            = exit1 / 13err / 3warn
deck.html-injected.json  = exit1 / 3err / 0warn
deck.bad-section.json    = exit1 / 2err / 1warn     （只有编号无标题 + 副题过短）
deck.bad-chart.json      = exit1 / 3err / 0warn     （点数<4 + 非数字 + 解释过短）
deck.bad-compare.json    = exit1 / 3err / 0warn     （左栏 1 条 + 右栏 5 条 + 结论过短）
deck.bad-quote.json      = exit1 / 2err / 0warn     （名词短语缺句末标点 + 作者过短）
deck.bad-toc.json        = exit1 / 1err / 0warn     （仅 2 条）
deck.bad-summary.json    = exit1 / 1err / 0warn     （4 条，要求恰好 3 条）
```
**敏感性复验**：要点下限 3→1（指向改松副本）→ **2/9 个样例立刻变红**（`deck.bad.json` 13→12、`deck.bad-toc` 1→0）；换回正式版 → PASS。
**未做/不确定**：`chart` 的 `line`/`donut` 只做了 HTML 层几何反推 + 目视，**没做像素级反推**（像素反推脚本只实现了柱状）；`density→字阶` 按 team-lead 指示仍未做（已写进 `PARAMS.md` 已知限制）。

---

## 13. 母版枚举化 + 第二套母版（第四批）

### 13.1 `masterId` 由单值变枚举，母版资产迁到 `masters/<id>/`
```
dist-rel/probe-hf/
├── masters/
│   ├── master-v1/   master.json · assets/{master.css,master.js,gsap.min.js,cover.jpg,字体}
│   │                master-16x9.html · master-9x16.html · hyperframes.json · package.json
│   └── master-v2/   同上结构（浅色商务风）
└── master-v1/       ← 只留产出与评审件：master-v1.mp4 / master-v1-9x16.mp4 / frames / PARAMS.md …
```
**搬迁没有动老板要看的两条母版 mp4 与 frames**（仍在 `master-v1/`）。

### 13.2 最关键的发现：真正的"写死"不在 CSS，在生成器
- `master.css` 逐条核查：**100% 令牌驱动** —— 全文只有 `:root` 有字面色，另两处是纯 alpha 蒙版（`#000`）。
  → **CSS 侧没有任何硬编码深色**（这也是浅色母版能低成本落地的原因）。
- 写死的全在 `render-deck.mjs`：`MASTER`（资产根）、`PAGE`（单页时长）、`GEO`（画布尺寸）、
  `PLOT` / `PLOT_PAD`（绘图区几何）、绘图区上移量 `110/146`、素材名 `assets/cover.jpg`、配色表。
  → **不修这些，"换母版"在结构上不可能**（正是 team-lead 要验的那件事）。
- 修法：新增 **`masters/<id>/master.json`**（母版清单），把这 7 类值全部搬进去；
  生成器只消费清单、**不再自带任何母版数值**（静态扫描确认只剩注释与 `MASTER_IDS` 枚举）。

### 13.3 1→1 字节级回归（三次，全 PASS）
| 回归对象 | 基线 MD5 | 结果 |
|---|---|---|
| 生成器 · `deck.master-v1.json`（4 页） | `F1D608EFA5A6DF7027AE67D6C6B1EDB3` | **一致** |
| 生成器 · `deck.types8.json`（8 页） | `6DB9866126E19789F1C2A8ABAE889715` | **一致** |
| 手写母版 4 页片（**资产搬迁后**） | `7F1B528DD953316644A621054861EA03` | **一致** |

### 13.4 第二套母版 `master-v2`（浅色商务）
`--bg #f5f6f8` / `--ink #1b2430` / `--accent #2f5fa8`；**10 页型全做**。
**不是换色** —— 做了 9 处结构级差异：纹理（竖条纹→点阵）、强调条（短粗→长细）、要点页分隔（底部横线→左侧竖线）、
数据页小指标（左竖线→上横线）、封面素材（右缘出血+柔化蒙版→内缩硬边相框）、图表（半透明→实心柱 + **绘图区 300→344px、上移 110→128px**）、
章节号（描边空心→浅色实心）、引用装饰（大引号→蓝底方块）、进度线。详见 `masters/master-v2/PARAMS.md`。
> **图表几何刻意改掉**，用来证明这些值确实来自母版：若还写死 300/110，v2 的像素反推必然全线失败。

### 13.5 两套母版各出一条 8 页 24 秒片（同一个 deck，只改 masterId）
派生 `examples/deck.types8-master-v2.json`，脚本断言"除 `style.masterId` 外与源文件**语义完全一致**"。
| | master-v1 | master-v2 |
|---|---|---|
| 产物 | `out/deck.types8/output-deck.types8.mp4` | `out-master-v2/deck.types8-master-v2/output-deck.types8-master-v2.mp4` |
| 规格 | 600 帧 / 24.000s / 1280×720 / 25fps / h264 yuv420p / tv+bt709 | 同 |
| 对账 | 未命中 0 / 大数字 0 / 图表 0 / 跨页 0 | 未命中 0 / 大数字 0 / 图表 0 / 跨页 0 |
| MD5 | `6DB9866126E19789F1C2A8ABAE889715` | `D4A9B0F4EC8C2F78E1A65C4E841E89B7` |

**图表像素反推：两套各自几何、都 ≤±1px**
| | 绘图区 | 数据区高 | 离底阈值（自适应） | 5 根柱 实测 vs 期望 |
|---|---|---|---|---|
| master-v1 | 1112×300 | 234px | 60.1（亮柱叠深底） | 159/158.5 · 179/178.7 · 235/234 · 74/73.5 · 63/63.1 |
| master-v2 | 1112×**344** | 270px | 130.8（亮底实心蓝柱） | 183/182.8 · 207/206.2 · 270/270 · 85/84.8 · 73/72.8 |

→ 验证器的颜色判定改为**自适应**：阈值 = 0.5 × 柱色离底距离，柱色/底色/不透明度由母版给出。
  否则写死的 `R>70` 在浅色母版上会**把所有像素判成柱**（阈值失效）。

**"两套确实不同"的像素证明**（`verify-masters.mjs`，同时间戳 8 帧）
| | 亮度 V | 饱和 S | 主色相 H（归一化） |
|---|---|---|---|
| master-v1 | 0.117 | 0.221 | 28.3°（0.079） |
| master-v2 | 0.922 | 0.058 | 221.2°（0.614） |

`|ΔV| = 0.805`、`|ΔH| = 192.9°`、**同帧逐像素平均差 = 209.19 / 255** → PASS（不是"同一份渲两遍"）。
视觉证据：`frames-compare-v1-v2.png`（左 v1 / 右 v2；cover / chart / quote 三行）。

### 13.6 新基线（`check-examples.mjs`，10 个样例，逐字）
```
deck.master-v1.json           = exit0 / 0err / 0warn
deck.bad.json                 = exit1 / 13err / 3warn
deck.html-injected.json       = exit1 / 3err / 0warn
deck.bad-section.json         = exit1 / 2err / 1warn
deck.bad-chart.json           = exit1 / 3err / 0warn
deck.bad-compare.json         = exit1 / 3err / 0warn
deck.bad-quote.json           = exit1 / 2err / 0warn
deck.bad-toc.json             = exit1 / 1err / 0warn
deck.bad-summary.json         = exit1 / 1err / 0warn
deck.bad-master.json          = exit1 / 1err / 0warn   ← 新增：非法 masterId（枚举外）
```
validator 另加一条：**枚举里有、磁盘上没有**的母版资产 → 报错（防"能过校验、渲染时才炸"）。

### 13.7 未做 / 不确定（如实）
1. **`palette` 语义张力（需定夺）**：契约里 4 个 palette 名是枚举，v2 把 4 个名都映成蓝/青/紫族（母版=皮肤）。
   若要求"同一 palette 名在两套母版上色相一致"，属**契约变更**，需 team-lead 决定（已写进 `master.json` 的 `_paletteNote`）。
2. 只做了 **16:9** 的两套母版出片；**竖屏 9:16 两套母版未出整片**（几何与覆盖规则已按 manifest 写全，未渲染验证）。
3. `line`/`donut` 仍只到 HTML 层几何反推 + 目视，**无像素级反推**。
4. `density→字阶` 仍未做。
5. `assets/master.js` 两套**共用**（动效语言相同）。若将来要求"母版各带动效语言"，manifest 需再加一层。
6. 字阶（`--t-*`）两套母版完全一致 —— 未做母版差异化。

---

## 14. palette 由母版定义 + 竖屏整片 + line/donut 像素反推（第五批）

### 14.1 `palette` 语义改为"由母版清单定义"（team-lead 定案）
问题不是"谁决定色相"，而是**名字荒谬**：`warm-gold` 在浅色母版上渲成蓝色，会误导 AI/用户。
- **palette 名清单与实际色值都搬进 `masters/<id>/master.json`**：v1 = `warm-gold`/`olive`/`clay`/`mist-blue`（**原 4 名一字未动 ⇒ 零回归**）；v2 = `azure`/`steel`/`indigo`/`violet`。
- `validate-deck.mjs` **按所选母版的清单校验**（枚举里有、母版清单里没有 → 报错，并列出该母版可用名）；另加"**母版必须声明 palette 清单**"的检查。
- `deck.schema.json` 的 `palette` 由 `enum` 降为 `string + pattern` —— **原因如实说明**：取值清单是**每母版数据**，抄进 schema 会与 `master.json` 漂移；跨字段依赖 JSON Schema 也表达不了 ⇒ **权威在校验器**，schema 只校验形状。
- `AI-PROMPT.md` 写明"**先选 masterId，再在该母版的 palette 清单里选**"，并列出两套母版的可用名。
- 新反例 `deck.bad-palette.json`（master-v1 + `azure`）= `exit1 / 1err / 0warn`。

### 14.2 竖屏整片 ×2 套母版（4 条片齐了）
| 片 | 尺寸 | 帧 / 时长 | 对账 |
|---|---|---|---|
| `out/deck.types8/` | 1280×720 | 600 / 24.000s | 0 / 0 / 0 / 0 |
| `out-master-v2/deck.types8-master-v2/` | 1280×720 | 600 / 24.000s | 0 / 0 / 0 / 0 |
| `out/deck.types8-9x16/` | 720×1280 | 600 / 24.000s | 0 / 0 / 0 / 0 |
| `out-master-v2/deck.types8-9x16-master-v2/` | 720×1280 | 600 / 24.000s | 0 / 0 / 0 / 0 |

派生变体由 `derive-decks.mjs` 生成，并**机器断言"只改了声明字段"**（`orientation` / `masterId` / `palette`），4 个变体全 PASS。

### 14.3 ★ 竖屏像素反推暴露了我上一轮引入的真回归（本节最该看）
竖屏 bar 的像素反推**恒定少 30px**（5 根柱全错、两套母版一致）→ 30 = 84−54 ⇒ **竖屏 `--pad` 实际是 84，不是应有的 54**。

根因：第 13 批把 `--pad` 改成由 `--pad-base` 派生时写成了
```css
:root  { --pad-base: 84px; --pad: var(--pad-base); }
body.p { --pad-base: 54px; }        /* ← 无效 */
```
**自定义属性在"声明它的元素"上就求值完毕**：`:root` 上的 `--pad` 立刻算成 `84px` 并向下继承，子孙再改 `--pad-base` 不会重算 `--pad`。⇒ 竖屏一直用 84 的页边距。
而第 13 批我只做了**横屏**字节回归（4 页 / 8 页 / 手写 16:9），**没测竖屏** —— 正是 team-lead 坑清单 17「契约里承诺的参数必须在横屏/竖屏各验一次生效」所指的那类漏洞，**我第二次踩了**。

**修法**：谁设 `--pad-base`，谁就在同一块里再派生一次 `--pad`；并且 `density` 只调**增量** `--pad-dense`（`calc(基准 + 增量)`），这样横竖屏都生效：
```css
:root  { --pad-dense: 0px; --pad-base: calc(84px + var(--pad-dense)); --pad: var(--pad-base); }
body.p { --pad-base: calc(54px + var(--pad-dense)); --pad: var(--pad-base); }
```
**修后双向字节回归（这次横竖屏都验了）**
| 回归对象 | 基线 | 结果 |
|---|---|---|
| 手写母版 **16:9** | `7F1B528DD953316644A621054861EA03` | **一致** |
| 手写母版 **9:16**（第 2 批产物，早于本次回归） | `B563588C48F92DF2DE029877DC2A29BB` | **一致** ← 证明竖屏被修回正确值 |
| 生成器 4 页 16:9 | `F1D608EFA5A6DF7027AE67D6C6B1EDB3` | **一致** |
| 生成器 8 页 16:9 | `6DB9866126E19789F1C2A8ABAE889715` | **一致** |

竖屏 8 页片 MD5 因此次修复而变（`out/deck.types8-9x16` = `632542DAA4F2A55E116B2EA6C3D66A52`）——**那是修 bug，不是回归**。
另：修复后竖屏的 `density` 也真正生效了（横 96/72、竖 66/42）。

### 14.4 `line` / `donut` 像素级反推（关掉最后一条"未做"）
`verify-chart.mjs` 扩到三种：`bar` 量**柱高**、`line` 量**折线顶点 y**（顶点处 r=4.5 实心点，取连续段中心）、`donut` 量**扇区角**。
为让占比环的扇区角**能从像素上分辨**，两套母版给相邻扇片加了三档明度循环（`.ch-s0/1/2` ↔ 生成器 emit 的 `ch-s{index%3}`）—— 既是可读性改进，也让边界可测；**v1 既有产物不含 donut ⇒ 零回归**（4 次字节回归均一致）。

**实测**（`deck.charttypes.json` = cover + line + donut + bar + end；柱/顶点容差 ±4px、扇角 ±3°；格式 **实测/期望**）
| 类型 | master-v1 | master-v2 |
|---|---|---|
| `line` 顶点 y (px) | 104.5/105.5 · 84.5/85.3 · 32.0/30.0 · 189.5/190.5 · 200.0/200.9 → **≤±2px** | 120.5/121.2 · 97.0/97.8 · 36.0/34.0 · 218.0/219.2 · 230.5/231.2 → **≤±2px** |
| `donut` 扇角 (°) | 80.25/80.59 · 91.5/90.9 · 119/119.01 · 37.25/37.39 · 32/32.11 → **≤±0.6°** | 80.25/80.59 · 91.5/90.9 · 119.25/119.01 · 37/37.39 · 32/32.11 → **≤±0.6°** |
| `bar` 柱高 (px) | 159/158.5 · 179/178.7 · 235/234 · 74/73.5 · 63/63.1 → **≤±1px** | 183/182.8 · 207/206.2 · 270/270 · 85/84.8 · 73/72.8 → **≤±1px** |

两套母版**各自几何**都对上：v1 数据区 234px / v2 270px；占比环半径 v1 120px / v2 142px。
扇片边界实测：v1 `81.75/200.75/238/270/350.25°`、v2 `81.75/201/238/270/350.25°`（都为 5 个，符合扇片数）。

**过程中修掉三个我自己的验证器缺陷（都属"判据/模型不对"，不是片子不对）**
1. **按"某档色最长段"找扇片 → 挑到别的扇片**：三档明度循环下同一档会出现两次（5 片 → 0,1,2,0,1）。改为**按"类变化点"测扇区边界夹角**（相邻扇片必不同色 ⇒ 变化点即边界），与"是哪一档"无关。
2. **边界处凭空多出小段**：相邻两档的**混合像素色 ≈ 第三档色**（v2 的 comp2+comp0 中点恰≈ comp1）→ 多出 1~2 个小段、边界数 > 扇片数。加"**短段合并**"（<7.5° 的类段视为噪声并入邻段）。
3. **合成链算错（最隐蔽）**：占比环扇片是叠在 `.ch-donut-track` 上的，**不是叠在底色上**。我按"叠底色"算期望色 → 偏 11~21 → 边界混合像素被判成第三档。实测数据锁死真因：v2 扇片实测 `(118,146,190)` == `.58 × accent over 轨道色(215,217,220)`，**逐通道吻合**。⇒ 让母版申报 `rule` 色，验证器按 `shade × accent over (rule over bg)` 算。
   **通用教训（建议入坑清单）**：**跨皮肤的颜色判据必须沿真实渲染合成链推导，并让"被判断的对象"（母版）申报参与合成的颜色**；只要漏掉一层中间合成层，判据就会在某个皮肤上系统性偏 —— 而它偏偏只在"深底/亮底"之一上暴露。

### 14.5 新基线（`check-examples.mjs`，13 个样例，逐字）
```
deck.master-v1.json            = exit0 / 0err / 0warn
deck.bad.json                  = exit1 / 13err / 3warn
deck.html-injected.json        = exit1 / 3err / 0warn
deck.bad-section.json          = exit1 / 2err / 1warn
deck.bad-chart.json            = exit1 / 3err / 0warn
deck.bad-compare.json          = exit1 / 3err / 0warn
deck.bad-quote.json            = exit1 / 2err / 0warn
deck.bad-toc.json              = exit1 / 1err / 0warn
deck.bad-summary.json          = exit1 / 1err / 0warn
deck.bad-master.json           = exit1 / 1err / 0warn
deck.bad-palette.json          = exit1 / 1err / 0warn    ← 新增：palette 不属于所选母版
deck.charttypes.json           = exit0 / 0err / 0warn    ← 新增：三图表类型验证用
deck.charttypes-master-v2.json = exit0 / 0err / 0warn    ← 新增
```

### 14.6 未做 / 不确定（如实）
1. `density` 现在横竖屏都生效（横 96/72、竖 66/42），但**没有金样例用 airy/dense** ⇒ 只验了"生成器算法 = CSS 算法"，**未做像素级验证**。
2. 占比环的**三档明度循环是为可验证性加的**；若将来要求"纯单色环"，扇区角就**无法从像素分辨**（需换可测标记，如扇片间细缝）。
3. `verify-chart.mjs` 的 `MINRUN = 30 样本 = 7.5°` 是经验阈值 ⇒ **小于 ~8° 的扇区会被当噪声合并、不可测**（将来要么在契约层限制最小占比，要么按扇片数自适应缩小 MINRUN）。
4. 竖屏两套母版**只验了 bar**（8 页片）；**line/donut 的竖屏未验**（charttypes 只有 16:9）。→ **已在 §15.1 补上**。

---

## 15. 追加：竖屏 line/donut 反推 + density 像素验证（第六批）

### 15.1 竖屏 `line`/`donut` 像素反推（两套母版 × 两种图型）
用 `derive-decks.mjs` 派生 `deck.charttypes-9x16.json` / `…-9x16-master-v2.json`（机器断言只改 `orientation`，v2 另加 `masterId`+`palette`）。**格式 = 实测/期望**：

| | master-v1 · 9:16 | master-v2 · 9:16 |
|---|---|---|
| 绘图区 | 612×400 @ y=200（数据区 **334px**） | 612×372 @ y=222（数据区 **298px**） |
| `line` 顶点 y (px) | 137.0/137.8 · 108.5/108.9 · 32.0/30.0 · 258.5/259.1 · 273.0/273.9 → **≤±2px** | 129.5/130.2 · 103.5/104.4 · 32.5/34.0 · 238.0/238.4 · 251.0/251.6 → **≤±1.5px** |
| `donut` 扇角 (°)（半径） | 80.25/80.59 · 91.25/90.9 · 119.5/119.01 · 37/37.39 · 32/32.11（**170px**）→ **≤±0.5°** | 80.25/80.59 · 91.5/90.9 · 119.25/119.01 · 36.75/37.39 · 32.25/32.11（**156px**）→ **≤±0.65°** |
| `bar` 柱高 (px) | 226/226.2 · 255/255.1 · 335/334 · 105/104.9 · 90/90.1 → **≤±1px** | 202/201.8 · 228/227.6 · 298/298 · 94/93.6 · 81/80.4 → **≤±0.6px** |
| 扇片边界 | `81.5 / 201 / 238 / 270 / 350.25°`（5 个 ✓） | `81.75 / 201 / 237.75 / 270 / 350.25°`（5 个 ✓） |

→ **"浅色 + 竖屏 + 占比环"** 这个最容易暴露"阈值/几何写死"的组合，两套母版都 **≤±0.65° / ≤±2px** ⇒ 阈值与几何确实都来自母版。两条片对账均 0/0/0/0。

### 15.2 `density` 的像素级验证（关掉坑 17 最后一个口子）
新增 **`verify-density.mjs`**：量**要点页整帧最左的强色像素列** = 页边距 `--pad`。
- 取 `.rule` 作为基准物：它是**实心块**且 `transform-origin: left center` ⇒ 左缘**精确**等于 `--pad`（文字会有 side bearing，量不准）；
- `.tex` 纹理很淡，用「离底色距离 ≥ 0.5 × 强调色离底色距离」排除掉。

| 几何 | normal | airy | dense | 纯测量交叉校验（不依赖生成器自报） |
|---|---|---|---|---|
| **16:9** | 声称 84 / **实测 84** | 声称 96 / **实测 96** | 声称 72 / **实测 72** | airy−normal = **+12px** · dense−normal = **−12px** ✓ |
| **9:16** | 声称 54 / **实测 54** | 声称 66 / **实测 66** | 声称 42 / **实测 42** | airy−normal = **+12px** · dense−normal = **−12px** ✓ |

- 6 个数据点**零像素误差**（实测 == 生成器声称），四个增量**全部精确**。
- 交叉校验直接由**实测值相减**得出 ⇒ 证明 `--pad-dense` 增量方案在**横屏与竖屏都真的生效**（这正是 §14.3 那个回归的正向验证）。
- **未做**：`density` 的 **v2 变体未单独渲**（v2 的基准值与 v1 相同：84 / 54，而增量与母版无关）；如需可再补 4 条片。

### 15.3 回归状态
- 本轮**未改**任何母版 CSS/JS，也未改渲染路径 ⇒ 上一批的 **6 次字节级回归结论继续有效**（不必重跑）。
- `check-examples.mjs` **基线仍为 13 个样例、未变** —— 本轮没有新增契约要素（`density` 的枚举与校验规则都没动，变的只是"增量实现方式"）。
