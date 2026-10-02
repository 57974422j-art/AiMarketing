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

### 坑表 `K01…K12`（**唯一**编号；每条必须有 症状/根因/修法/规矩）

**旧号 → K-ID 映射**（历史文档/先前引用按此查）：`坑 A → K01` · `坑 B → K02` · `旧 1 → K03` · `旧 2 → K04` · `旧 3 → K05` · `旧 4 → K06` · `旧 5 → K07` · `旧 6 → K08` · `旧 7 → K09` · `旧 8 → K10` · `旧 9 → K11` · `旧 10 → K12`（旧号已废弃，**不再使用**）

**K01 源/副本分离 ⇒ 漏改**（本轮新增）
- **症状**：改路径时改了 `docs/ppt-html-probe/fonts/README.md`（副本），漏了 `dist-rel/probe-hf/fonts/README.md`（源）⇒ team-lead 用显式枚举实测出 L45/L46 仍是旧路径。
- **根因**：同一份内容存在"源 + docs 副本"两份，改完只查了一处。
- **修法**：修源 + 重同步副本。
- **规矩**：① 结论只从**显式枚举**来（`Get-ChildItem -Recurse -Include … | Select-String`）；**不要在 `dist-rel/**` 用 rg**（被 `.gitignore` 吞 ⇒ "假零残留"）；② **改完必须对「源」与「副本」各查一次**。

**K02 `.cmd` / `node_modules` 平台地雷**（本轮新增）
- **症状**：`ENGINE_HF_BIN || <引擎>/node_modules/.bin/hyperframes.cmd` —— 本地能跑，服务器必炸。
- **根因**：服务器上**没有** `<引擎>/node_modules`（hyperframes 在 `/opt/ppt-render`）；且 **`.cmd` 是 Windows 专用**（Linux 无此文件名）。
- **修法**：明确顺序 `ENGINE_HF_BIN` → `PATH` → 开发回退 `<引擎>/node_modules/.bin/hyperframes[.cmd]`；全找不到 ⇒ **红 + 打印尝试过的所有候选**（含 platform/cwd）。`render-deck.mjs` / `check-engine-lint.mjs` 同步。
- **规矩**：部署必须显式设 `ENGINE_HF_BIN`；解析结果每次打印"来源"。

**K03 `.clip` 元素会被引擎移出正常文档流**（旧 1；本文档最大坑）
- **症状**：按"正常流式排版"写的 clip 元素，渲出来标题/要点**全部重叠在左上角**、数据卡消失。
- **根因**：`class="clip"` 的元素 `margin/flow` 布局失效（引擎按绝对定位处理）。
- **修法**：每个 clip 元素写死 `position:absolute; left/top/width`；整列表做动画时把 `.clip` 放 `<ul>` 上、只对子 `<li>` 做 GSAP stagger（不要给每个 `li` 加 clip）。
- **规矩**：新增页型先渲一帧肉眼确认"没有重叠在左上角"。

**K04 中文字体静默回退**（旧 2）
- **症状**：请求 `"Microsoft YaHei"`（未装）与 `"NoSuchFont-QQQ"`（不存在）**渲染结果一模一样** ⇒ 缺失字体被静默回退；缺 CJK 时豆腐块。
- **根因**：`font-family` 只写名字、不内嵌字体文件 ⇒ 缺失**不报错**。
- **修法**：母版 `@font-face` 内嵌项目内 woff2；或服务器 `apt install fonts-noto-cjk` 且两端逐帧比对。
- **规矩**：字体只走"**内嵌 + 渲染前闸门**"（§24/§25），禁止裸 `font-family` 取名。

**K05 素材不能用 `file://` 绝对值**（旧 3）
- **症状**：`./assets/test.jpg` 成功；`file:///E:/…/xxx.jpg` 失败（`[media_load_failed] image media failed to load before capture`）。
- **根因**：页面由本地静态服务以 **http** 提供 ⇒ Chrome 禁止 http 页面加载 `file://`。
- **修法**：素材复制/硬链进项目目录（或起本地静态服务用 http URL）；外部素材必须先"登记进项目"。
- **规矩**：`mediaGate` 只收**项目内静态图**，路径必须相对。

**K06 GSAP 默认走 CDN**（旧 4）
- **症状**：脚手架默认 `https://cdn.jsdelivr.net/...` ⇒ 渲染期依赖外网、版本漂移会改像素。
- **根因**：默认脚手架引用 CDN。
- **修法**：本地内嵌 `assets/gsap.min.js`（72KB）。
- **规矩**：入库资产含 `gsap.min.js`（两套母版各一份，**不合并**）；渲染**零外网**。

**K07 无 GPU 服务器慢 ~1.34×**（旧 5）
- **症状**：强制 `PRODUCER_EXPERIMENTAL_FAST_CAPTURE=false` 后 8 秒片 10.5s → **14.1s**。
- **根因**：无 GPU 走截图模式（本机默认 `drawElement capture · hardware gpu`）。
- **修法**：按 **~1.35×** 折算。
- **规矩**：部署/发版预算按 1.35× 折算（不构成硬伤）。

**K08 默认流式编码 / 帧不落盘**（旧 6）
- **症状**：日志 `useStreamingEncode: true`、`encode (during capture)`，帧不落盘。
- **根因**：进程内 pipe 给 FFmpeg（更快更省盘，峰值内存 0.55–1.1GB 是代价）。
- **修法**：需要中间帧才用 `--format png-sequence`。
- **规矩**：抽帧自检用**"PNG 数 = 页数 × 2"**独立锚点（否则"静默失败"看不出来）。

**K09 渲染前置固定开销 + 校准偶发降 worker**（旧 7）
- **症状**：CLI 引导 ~2s + 浏览器启动/校准 ~4–7s；校准偶发失败会自动把 worker 6 → 1（首次 720p 命中：13.5s vs 10.5s）。
- **根因**：每进程固定 setup 成本 + 校准不稳定。
- **修法**：**不要按帧数线性外推小片**；避免逐镜起进程。
- **规矩**：闸门按"**档**"跑（`--deploy` 两档），不按"镜"跑。

**K10 需要能启动 Chrome**（旧 8）
- **症状**：服务器要装 Chrome/Chromium（Puppeteer 可代下）；容器里通常要 `--no-sandbox`（本探针**未验 Linux**）。
- **根因**：渲染依赖无头浏览器。
- **修法**：装 chromium + `--no-sandbox`。
- **规矩**：**第二期上线的先决条件**（契约分期已写"第二期未就绪"）。

**K11 `<video>` 素材 seek 可靠性 —— 未验证**（旧 9）
- **症状**：本轮只验了图片，视频未验。
- **根因**：seek 精度与解码状态依赖浏览器实现。
- **修法**：引擎有 `media.autoProxy`、`--video-frame-format auto|jpg|png` 与帧缓存目录，可下轮单独验。
- **规矩**：`mediaGate` **一律拒 `.mp4`**（本页型只收静态图，**有意从严**）。

**K12 运行细节三则**（旧 10）
- **症状**：`hyperframes render` 输出**无音轨**；`--output` 目录**必须已存在**；首次运行有匿名 telemetry 提示。
- **根因**：CLI 行为约定。
- **修法**：先建目录；`hyperframes telemetry disable`。
- **规矩**：入库清单逐条记录。

**K13 用 shell「哈希表 + 批量替换」做多文件文本手术 ⇒ 把脚本改坏**（本轮新增，**我犯的**）
- **症状**：一条 PowerShell 里用哈希表存"旧串→新串"做批量替换，结果 **5 个脚本被逐字符改坏**（如 `const`→`oonst`、`dist-rel`→`dmst-rel`）；`measure-limits.mjs` **无任何副本可恢复**。
- **根因**：PowerShell 的 `@(@(a,b))` **把单元素数组展平成 `(a,b)`** ⇒ `foreach($pair in …)` 里 `$pair` 变成**字符串**，`$pair[0]`/`$pair[1]` 取到了**首字符**（`c`/`o`、`i`/`m`）⇒ 实际执行的是 `Replace('c','o')`、`Replace('i','m')`（**等长替换** ⇒ 文件字节数不变，更隐蔽）。
- **修法**：从 `docs/ppt-html-probe/` 的副本恢复 4 个（**副本恰好是同步过的当前版本**：`check-master-manifest` 恢复后真跑 **PASS 362 条断言**、`--deploy` **51.0s exit=0** ✓）；`measure-limits.mjs` **无副本** ⇒ 记为**丢失**，随第 ⑤ 项「递增测临界」重写。
- **规矩**：① **禁止**用 shell 做多文件文本手术；一律用**内置编辑工具、一次一个文件**；② 任何脚本改完**立刻 `node --check` + 真跑一次闸门**（不是只看 diff）；③ **保持 `docs/` 侧同步副本**——这次正是它救回了 4 个文件（同步副本 = 备份，不是冗余）；④ 批量替换前先**小样验证**（先在一个文件上跑、看 diff 再看全量）。

**K14 闸门输入范围过宽 ⇒ 文档/注释里一个符号就触发假红**（本轮新增）
- **症状**：字体闸门 FAIL —— `master-v2 待覆盖 3927 · 缺 1`，缺字 `≠`(U+2260)；它只出现在 `masters/master-v2/assets/master.css` 的**注释**里（L135/L138）⇒ **永远不会渲染**。
- **根因**：判据输入是"**母版源码全文（含注释）**"而不是"**真会画出来的字**" ⇒ 源码里一个符号就假红，而修法昂贵（加字 ⇒ 重生成字体 + 全量重立基线）。
- **修法**：判据改建立在**产物侧**（产物 `index.html` 的文本节点/属性 + 该档 meta 里嵌的 deck 文本）；源码侧只作**预警**（点名到 `文件:行号`）；`*.md` 不进判据；保留 `--legacy` 复现旧口径。
  **实测**：新口径 **产物侧缺失 = 0 / 17 个产物 ⇒ PASS(exit=0)** · 旧口径 `--legacy` **FAIL(exit=1)**，唯一差异就是那 1 个注释里的 `≠` ✓
- **规矩**：闸门输入必须是"**真产出的东西**"；源码/注释/文档只走**预警**通道。**改判据必须同时给新旧两口径对照**（证明只消除了假红、被推翻的结论为零）。

**K15 「检查命令本身失败」≠「检查通过」**（本轮新增）
- **症状**：本会话我把检查命令写坏了**三次**（PowerShell 哈希表展平 · 正则里带引号字符 · 路径少一级）。**报错的命令没有输出** —— 只看"没命中"就会把"**命令坏了**"读成"**零命中**"（典型**假阴性**）。
- **根因**：把"扫描结果"当成唯一证据，没有把"**扫描命令自身的成功**"纳入结论。
- **修法**：任何 grep/扫描类检查**必须同时断言两件事**：① 命令 `exit=0` / 无解析错误；② **命中数 = N**。报告里**两件事都要写**（例：`命令 exit=0 且命中数 = 0`）。
- **规矩**：**"结论无效"优先于"结论为真"** —— 命令失败时，任何"看起来的零命中"一律**作废并重跑**。

**K16 「判据失败」与「输入/环境错误」必须能区分（退出码分档）**（本轮新增）
- **症状**：`--masters-root` 指向**不完整树**（只放 `master-v1`）时，脚本抛 **ENOENT 栈**；读到的 `exit=1` **不是断言触发的**，而是**崩溃** ⇒ team-lead 把"崩"读成了"红"（K15 打在他自己身上）。
- **根因**：闸门把"输入/环境不完整"与"判据不达标"混用同一个退出码，且未做**输入完整性预检**。
- **修法**：① **预检**（母版目录/`master.json`/`assets/master.js`/字体文件/`chars-cmn.txt`/产物根）⇒ 缺任何一项 **`exit 2` + 点名缺哪个路径**，**绝不留栈**；② 契约写明分档：**`0`=通过 · `1`=判据不达标 · `2`=输入/环境不完整或工具/用法错误**；部署解析方把 `2` 当**基础设施错误**（≠产物缺陷）分开处置。
- **规矩**：**"红"和"崩"不许混** —— 会同时产生**假红**与**假绿**（部署/发版时最危险）。

**（K14 补充）产物侧判据的「覆盖 / 已知缺口」—— 不许把"没扫"当"没缺"**
- **覆盖**：① HTML **文本节点**（含 SVG `<text>`）；② 会渲染的**属性值**（`title`/`alt`/`aria-label`/`placeholder`）；
  ③ inline `<style>` 与产物 `assets/master.css` 的 **`content:` 值**；④ 该档 meta 里嵌的 **deck 文本**；⑤ HTML/CSS **注释已剥离**（不渲染 ⇒ 不进判据）。
- **缺口逐条状态（"没扫 ≠ 没缺"）**：
  ① **`content: counter()/attr()` 与 CSS 变量拼接文本** ⇒ **已验：无**（17 个产物 CSS：`content…var(` 命中 **0** · `counter(`/`attr(` 命中 **0**）✓
  ② **运行期 JS 写入文本** ⇒ **已验：仅一处** —— `assets/master.js:26` 的**数字滚筒**（`html += '<span>' + (i % 10) + '</span>'`，写入内容 = **纯数字 0–9**；注释即"生成数字滚筒内容"）；**gsap.min.js 命中 0**（库本身不写我们的文本）；且**数字已在产物侧覆盖内**（闸门绿）⇒ **不构成缺口** ✓
  ③ 画在 `<canvas>` 里的字 ⇒ **未扫**（当前 17 产物无 canvas 文本；若将来引入必须补扫）
  ④ **外部图片**内的字 ⇒ **不适用**（`mediaGate` 一律拒 `.mp4`，本页型只收静态图）
  ⑤ `::marker` / 浏览器默认列表符号 ⇒ **不适用**（列表符号全部由 `::before { content: "" }` 的**图形或空串**绘制，不是文本）
- **负向自证（要求"能失败"）**：把 `龘`(U+9F98) 注入**产物副本** `index.html` 的可渲染文本 ⇒ 闸门**必须红**并**精确报出该字 + 所在文件**（命令与 exit 码见探针报告）。

### 旧号明细（**编号已废弃**，正文已折叠进上表 K01–K12；仅作历史存档）

_（旧号明细已**全部折叠进上表 K03–K12**，此处的旧编号（1–10）**已废弃、不再使用**。）_

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
- **关于 `density` × 母版的三维覆盖：已定案"不做"**（team-lead 决定）。
  **原因**：**v2 的页边距基准值与 v1 完全相同（横 84 / 竖 54），而 `--pad-dense` 增量与母版无关**
  ⇒ 再渲 v2 的 airy/dense 变体只是把同一件事再做一遍，**不增加任何信息**。
  **故：未单独渲染 master-v2 的 density 变体 —— 这是有意的决定，不是遗漏。**
  （若将来某套母版改了页边距基准值，届时才需要为它单独做 density 的像素验证。）

### 15.3 回归状态
- 本轮**未改**任何母版 CSS/JS，也未改渲染路径 ⇒ 上一批的 **6 次字节级回归结论继续有效**（不必重跑）。
- `check-examples.mjs` **基线仍为 13 个样例、未变** —— 本轮没有新增契约要素（`density` 的枚举与校验规则都没动，变的只是"增量实现方式"）。

---

## 16. 全报告「未做 / 已知限制」总清单（单一可查处）

> 本报告跨越 6 批，限制项分散在各节；此表是**唯一权威索引**，避免"以为漏了 / 以为做了"。
> 状态：**已关闭** = 后续批次补齐了证据 · **仍开放** = 确实还没做 · **已定案不做** = 有意决定，附理由。

| # | 项目 | 状态 | 位置 / 说明 |
|---|---|---|---|
| 1 | `chart` 的 `line`/`donut` 像素级反推（16:9） | **已关闭** | §14.4（v1 与 v2 各 ≤±2px / ≤±0.6°） |
| 2 | 竖屏 9:16 两套母版整片 | **已关闭** | §14.2（4 条片，600 帧 / 24.000s / 对账 0/0/0/0） |
| 3 | 竖屏 `line`/`donut` 像素反推 | **已关闭** | §15.1（v1 ≤±2px / ≤±0.5°，v2 ≤±1.5px / ≤±0.65°） |
| 4 | `density` 的像素级验证（横竖屏） | **已关闭** | §15.2（6 点零误差 + 增量 ±12px 纯测量验证） |
| 5 | `density` 的 **v2** 变体 | **已定案不做** | §15.2：**v2 基准值与 v1 相同（横 84 / 竖 54），`--pad-dense` 增量与母版无关** ⇒ 再渲不增加信息。**这是有意决定，不是遗漏。** |
| 6 | `density → 字阶`（`--t-*` 不随 density 变） | **仍开放（暂缓）** | §11/§12：等老板皮肤判词；目前字阶两套母版也完全一致 |
| 7 | `master.js` 两套母版共用（未做"每套带动效语言"） | **仍开放（有意）** | §13.7：成套的含义是"同一动效语言"，省成本；若将来要差异化，manifest 需再加一层 |
| 8 | `<video>` 在无头浏览器里的 **seek 可靠性** | **仍开放** | §7.6：只验了"能不能解码"；seek 精度需在服务器侧（Linux + 无 GPU）用 `seek-test/` 验 |
| 9 | Linux 侧 `chrome-headless-shell` 的编解码表 | **仍开放（待服务器）** | §7.6：win64 结果不能外推；`codec-check.cjs` 已备好 |
| 10 | "Google Fonts 代理缓存之后可离线且确定" | **仍开放（低置信）** | §7.3：只做了源码 + 缓存文件存在性验证，**未做断网端到端实测**；且 srv-env 已论证缓存淘汰会引入不确定性 ⇒ 生产不依赖它 |
| 11 | 纯单色占比环的扇区角 | **已知限制** | §14.6：扇区角**无法从像素分辨**（现用三档明度循环才可测）；若要求单色环需换可测标记（如细缝） |
| 12 | 扇区 < ~8° 的占比环 | **已知限制** | §14.6：`verify-chart.mjs` 的 `MINRUN = 30 样本 = 7.5°` 会把小扇区当噪声合并 ⇒ **不可测**（未偷偷放宽） |
| 13 | `verify-density.mjs` 的方法学依赖 | **已知依赖** | §15.2：依赖"`.rule` 是实心块且左缘精确等于 `--pad`"这一母版约定；母版若给 `.rule` 加内边距/圆角/透明度，该量法会失准 |
| 14 | HEVC / `.mov` / `.avi` 素材在浏览器不可播 | **已知约束（非缺陷）** | §7.6：素材入口（`video-edit/page.tsx:239` 白名单 `['.mp4','.mov','.avi']`）**必须统一转码成 H.264 mp4 + faststart**，这是必需项 |
| 15 | 服务器侧全部事项（Node22 / headless-shell / 字体 / ffmpeg 钉 env / 并发上限） | **不在本机范围** | 由 srv-env 负责；本报告 §7 已给出源码级结论与 env 清单供其使用 |
| 16 | 生成器 `MINRUN`/阈值等经验常数的自适应化 | **仍开放（低优先）** | 现为已知常量：`MINRUN=7.5°`、像素容差 ±4px、扇角容差 ±3°、扇片明度三档 |
| 17 | **自定义封面素材未实现**（`cover.asset` 只能等于母版自带值） | **已知限制** | §17.2：其它值**明确报错** `2/asset`，**不静默忽略**；新反例 `deck.covercustom.json` |
| 18 | `ENGINE_HF_BIN` **逃逸口**（会替换渲染器） | **已知限制** | §9.7：为服务端钉版本与故障演练而开；**生产环境不要设**，指错会掉进慢路径或直接失败 |
| 19 | 退出码 `5` **内部不再细分**（"deck 有问题"与"环境有问题"都表现为 5） | **已知限制** | §9.9：调用方只能看 `RESULT.stderr_tail`（不保证结构稳定） |
| 20 | `meta.lang` **被校验但未消费**（HTML 的 `lang` 硬编码 `zh-CN`） | **已知限制** | §17.2：schema 只允许 `zh-CN` ⇒ 当前无影响；若将来放宽需同步实现 |

**关于"契约三处同步"的唯一例外**（记录在案）：`palette` 由 schema `enum` 降为 `string + pattern`，取值清单权威在校验器（按所选母版清单查）—— 原因见 §14.1；`masterId` 仍是 schema `enum`。

---

## 18. 页型 11~12 收口（12/12）+ 一个影响所有 `full` 帧的取样时刻缺陷（第八批）

### 18.1 交付
- **契约**：`deck.schema.json` + `validate-deck.mjs` 新增 `image`（图片页）/ `steps`（步骤页）；`AI-PROMPT.md` 同步。
- **素材闸门 `mediaGate()`** —— 把"入口统一转码"的接口先暴露出来：
  绝对路径 / `file://` / `..` 越界 → 报错；静态图只收 **jpg/jpeg/png/webp**；
  **视频素材（.mov/.avi/.mkv/.ts/HEVC，实测在无头浏览器不可播）→ 明确报错并指明出路**；
  **文件不存在 → 报错**。"绝不静默黑屏"。
- **母版（两套）**：`.p9--left/right/full`（全幅走**渐隐底衬**、不用实心黑框；压字**强制浅色文字**，浅色母版也不会读不出）
  + `.p10` 步骤页（`number`/`dot` 两种序号 + 步骤间连接线）。
- **反例 6 个**；`check-examples.mjs` 基线 **13 → 21 个样例**（§18.4）。
- **12 页 / 36 秒整片**（12 种页型全用上）×2 套母版，对账 **0/0/0/0**。

### 18.2 ★ 图片页像素证据（`verify-image.mjs`，两套母版各跑一次）
源图是四象限纯色 PNG：`TL(207,32,32) TR(31,158,63) BL(32,63,208) BR(221,190,30)` —— 便于逐点比色，且**被偷偷加滤镜（去色/压暗）会立刻暴露**。

| 检查 | master-v1 | master-v2 |
|---|---|---|
| ① 素材真上屏（12 页片 full） | **12/12** 点达标 · 中位差 **4** | 12/12 · 中位差 **4** |
| ① 素材真上屏（img3 left / right） | 14/14 · 中位差 3 | 14/14 · 中位差 3 |
| ③ 全幅压字对比度（标题块，门槛 **3:1**，大字） | 最坏 **5.38:1** | 最坏 **5.35:1** |
| ③ 全幅压字对比度（图注块，门槛 **4.5:1**，正文） | 最坏 **7.72:1** | 最坏 **7.74:1** |
| ④ 版式矩形（媒体区外 = 母版底色） | 距离 3/3/3 ✓ | 距离 3~9 ✓ |

### 18.3 ★ 顺带抓出一个影响**所有 `full` 帧**的取样时刻缺陷（本批最值钱的发现）
`verify-image` 一开始报"图片页右版式**下半被压暗到 0.62 倍**"。逐列剖面 + 多时刻对比锁定真因：
**页窗口是 `[S-0.25, S+3.25]`，而下一页从 `S+2.75` 就开始淡入** —— 我原来在 `S+2.85` 取 `full` 帧，
**正好采到下一页淡入的头 0.1 秒**。同一页实测：

| 页内时刻 | 源图黄色 (221,190,30) 渲成 |
|---|---|
| 1.50s / 2.40s / **2.70s** | `(218,187,28)` ✓ 正确 |
| 2.85s（原取值） | `(119,99,15)` ✗ 被压暗 |

⇒ **修法**：`full` 帧取 **`S+2.70`**（入场动画最晚 `S+2.70`、下一页最早 `S+2.75` ⇒ 既"已落定"又"本页独显"）。
**影响面（如实说明）**：此前所有批次的 `frames/p<i>-full.png`（给人看的审阅帧），以及所有在 `+2.85` 取的像素测量，
都带了 ~10–20% 的下一页混合。已修 `render-deck.mjs` 的帧时刻与 `verify-chart/verify-density/verify-image` 的取样时刻，
并**复跑全部 10 条片的像素验证**（图表 6 条 · density 2 个几何 · 图片 4 条）—— **全部 PASS**（而且修正后更干净：素材色差从 5 降到 3~4）。

> **教训（建议入坑清单）**：**"抽帧校验"必须先把"页面独占窗口"算清楚** —— 在转场重叠区取的帧会把两页混在一起，
> 任何逐像素判据都会得出错误结论，**而且看起来像渲染缺陷**（我这次就误判成"有覆盖层"，查了 CSS 与 HTML 才回头怀疑取样时刻）。

### 18.4 新基线（`check-examples.mjs`，**21 个样例**；原 13 个一字未动）
```
deck.all12.json                 = exit0 / 0err / 0warn      ← 新增：12 页整片（12 种页型）
deck.img3.json                  = exit0 / 0err / 0warn      ← 新增：图片页三版式
deck.bad-image-missing.json     = exit1 / 1err / 0warn      ← 新增：素材文件不存在
deck.bad-image-video.json       = exit1 / 1err / 0warn      ← 新增：给了视频素材（入口统一转码）
deck.bad-image-short.json       = exit1 / 2err / 0warn      ← 新增：标题过短 + 图注过短
deck.bad-steps-2.json           = exit1 / 1err / 0warn      ← 新增：只有 2 条
deck.bad-steps-7.json           = exit1 / 1err / 0warn      ← 新增：有 7 条
deck.bad-steps-short.json       = exit1 / 1err / 0warn      ← 新增：某条只有 1 字
```

### 18.5 字节级回归（母版 CSS 改动后）
手写 16:9 `7F1B528D…` ✓ · 手写 9:16 `B563588C…` ✓ · 生成器 4 页 `F1D608EF…` ✓ · 生成器 8 页 `6DB98661…` ✓
（新选择器一律带 `.p9`/`.p10` 前缀 ⇒ 不匹配任何既有元素 ⇒ 输出字节不变。）

### 18.6 未做 / 不确定
1. **竖屏（9:16）的图片页未渲** —— `.p9` 的竖屏覆盖规则已写（媒体改顶部横带 42%、文案 48%），但**没有像素证据**；`deck.img3` 只有 16:9。
2. 图片页只支持 `left/right/full` 三种版式，**没有做"图片满底 + 半透明卡片"等更多版式**。
3. `mediaGate` **只按扩展名判可播性**（不做真实编解码探测）：`.mp4` 一律拒绝，即使它其实是可播的 H.264 —— **有意从严**（本页型只收静态图）。
4. `verify-image` 的对比度判据要求"该文字块里存在无文字的列"；若文字占满整行则**无法测量并明确失败**（不静默放过）。

---

## 19. 补齐"母版 × 几何"矩阵：竖屏图片页 + 竖屏 12 页整片（第九批）

### 19.1 ★ 竖屏 `full` 版式的真 bug（只有把竖屏渲出来才暴露）
竖屏覆盖 `body.p .p9-media { height: 42% }`（本意给 left/right 做"顶部横带"）**没有给 `full` 单开例外**
⇒ `full` 在竖屏退化成"顶带图 + 底部文字**压在空底上**"，与 `master.json` 里 `full` = 整页 的声明**冲突**。
修法：`body.p .p9--full .p9-media { height: 100%; }`。
> 这条与坑 17（"契约里承诺的参数，必须在横屏/竖屏各验一次生效"）是同一类：
> **横屏验得再全也发现不了** —— 横屏的 `.p9-media` 本来就是 100% 高。

### 19.2 竖屏图片页像素验证（两套母版 × 三版式）
| 检查 | master-v1 · 9:16 | master-v2 · 9:16 |
|---|---|---|
| ① 素材真上屏 `left`/`right` | **24/24** · 中位差 3 · 最大差 4 | 24/24 · 中位差 3 · 最大差 4 |
| ① 素材真上屏 `full` | 12/12 · 中位差 4 | 12/12 · 中位差 4 |
| ③ 全幅压字（标题块，门槛 3:1） | 最坏 **9.14:1** | 最坏 **9.04:1** |
| ③ 全幅压字（图注块，门槛 4.5:1） | 最坏 **7.91:1** | 最坏 **11.03:1** |
| ④ 媒体区外 = 母版底色 | 距离 3~7 ✓ | 距离 3~10 ✓ |

竖屏的媒体是**整宽顶带** ⇒ ④ 改判"**下侧**"（旁侧已被媒体占满，取不到样）；横屏仍判"旁侧"。
> 横屏两条同步复跑仍 PASS（24/24、12/12；5.38/5.35:1 与 7.72/7.74:1）—— 验证器重构没有改变横屏结论。

### 19.3 顺带改进验证器本身（它差点又给我一个假结论）
1. **探针改在"屏幕空间"布点**，再反查源图坐标 —— 竖屏 `full` 的 cover 裁切极重
   （源 1280×720 → 画面 720×1280，scale≈1.78），**按源图比例布的点会全部落在可视区之外**
   （实测 4 个 fx 全部越界 ⇒ **一个点都采不到**）。改后稳定：left/right 24 点、full 12 点。
2. **剔除"源图边界处"的探针**（5×5 邻域通道极差 >40 就不参与比色）—— 压缩会在**硬边界**处模糊，
   这类点天生不可比。**这条让判据对真实照片也成立**，不再依赖我那张四象限测试图的"避开 0.5"经验。

### 19.4 竖屏 12 页整片（两套母版）
| | master-v1 · 9:16 | master-v2 · 9:16 |
|---|---|---|
| 路径 | `out/deck.all12-9x16/output-deck.all12-9x16.mp4` | `out-master-v2/deck.all12-9x16-master-v2/output-…mp4` |
| 规格 | **900 帧 / 36.000s / 720×1280** / h264 yuv420p / bt709+tv | 同 |
| 对账 | **未命中 0 / 大数字 0 / 图表 0 / 跨页 0** | 同 |
| 图片页 ①（`full`） | 12/12 · 中位差 4 | 12/12 · 中位差 4 |
| 图片页 ③ 标题 / 图注 | **9.13 : 1** / **10.64 : 1** | **9.07 : 1** / **10.78 : 1** |
| 图表 `bar`（数据区高） | **334px** · 5 根 **≤±0.2px** | **298px** · 5 根 **≤±0.4px** |

→ **"12 页 × 2 母版 × 2 几何"矩阵补齐**。（另：`deck.img3-9x16` ×2 母版 = 5 页 15s 竖屏图片页片。）

### 19.5 字节级回归
母版 CSS 新增 `body.p .p9--full .p9-media`（`body.p` 作用域 ⇒ **只可能影响竖屏**）：
**手写竖屏母版片重渲 = `B563588C48F92DF2DE029877DC2A29BB`（一致）** ✓。
16:9 侧不受影响（`body.p` 作用域的规则在横屏不可达，且既有 deck 均无图片页）。

### 19.6 未做 / 不确定
1. 竖屏 `left`/`right` 的**观感**没有像素判据（只验了"素材上屏 / 外侧是底"）；文案与图是否重叠、字号是否合适仍属观感范畴。
2. `deck.img3-9x16` 每版式各一页，未覆盖"caption 缺失 / 有 kicker"等分支。
3. 竖屏 `verify-image` 的 ③ 只对 `full` 生效 —— `left`/`right` 无渐隐底衬（文字在底色上），其对比度由母版令牌保证，未做像素判据。

---

## 20. 第五条纪律「声明必须有断言」：`check-master-manifest.mjs`（第十批）

### 20.1 为什么要有它
第九批抓到"竖屏 `full` 退化成顶带图"，但 `master.json` 里 `image.9:16.full = 整页` 的声明**完全正确** ——
问题出在"清单说的"与"实际做的"脱节，而**没有任何断言能发现这类脱节**。
team-lead 据此立第五条纪律：清单里每条**声明性**内容都要挂一条可执行检查，否则清单会慢慢变成"文档里的愿望"。

### 20.2 四级断言（**期望值全部从清单读**，脚本里没有任何母版数值）
| 层 | 断言对象 | 专抓什么 |
|---|---|---|
| **L1 清单 → 元数据** | 生成器写出的 `chart-meta.json` / `image-meta.json` 里每个值都必须等于清单声明（`masterId`/`orientation`/`canvas`/`pad`/`plot`/`padBox`/`plotTop`/`bg`/`ink`/`rule`/`barColor`/`barAlpha`/`donutShades`/图片矩形） | **"生成器又写死一个值"**（若 `plotTop` 写死成 `pad+110`，v2 立刻红） |
| **L2 元数据 → 像素** | 直接**复用** `verify-chart.mjs` / `verify-image.mjs`（子进程，避免两处实现漂移），另加"声明 left/right 同一条带 ⇒ 实测必须同一条带" | 像素与声明不符 |
| **L3 清单自洽** | 声明性含义：`full` 必须 = 满幅；`left/right` 必须 ≠ 满幅且贴边（或上下分列）；绘图区不越界；`palette.accent ↔ rgb` 同源；`bg/ink` 合法；`page>0` | **"为了迁就实现而改清单"**（把 full 改成 720×538 会红） |
| **L4 产物 → 清单** | ffprobe 画布 / 时长 = 页数 × `page` / 帧数 / **抽帧 PNG 数 = 页数×2** / yuv420p / tv+bt709 | 产物与声明脱节；抽帧静默失败 |

**实测：310 条断言全成立**（L1 124 / L2 16 / L3 114 / L4 56），覆盖 `2 母版 × 2 几何`、8 条片。

### 20.3 ★ 它立刻又抓到一个真问题：v2 竖屏 `left`/`right` 同一条带被画偏 1px
新加的 L2 断言在 v2 竖屏**红**：
```
媒体带 720×538：最大通道差 160 · 不同像素 39927/387360 (10.3%)
```
差分可视化（`out/_diag-lr/lrv2-diff.png` + `both-diff.png`，对比度 ×6~10）显示：**源图内部边界处有一条竖线** —— 典型的"整幅图被平移 1px"。根因（**查 CSS 得到，不是猜**）：
```css
.p9--left  .p9-media { border-right: 1px solid var(--rule); }   /* 内容盒右缘少 1px */
.p9--right .p9-media { border-left:  1px solid var(--rule); }   /* 内容盒左缘多 1px */
body.p     .p9-media { left: 0; right: 0; width: 100%; … }      /* 竖屏整宽带：描边落到页边 */
```
横屏的"发丝描边"在竖屏整宽带下**落在页边、无视觉意义**，却把 `object-fit: cover` 的内容盒挪了 1px
⇒ 同一张图两页相差 1px。**修法**：竖屏取消这两条描边
（`body.p .p9--left/.p9--right .p9-media { border-left: none; border-right: none }`）。
修后 v2 竖屏媒体带最大通道差 **160 → 9**（v1 = 8，同为编解码噪声级）。

> 这不是"断言定太严"，而是**实现让声明不成立**。判据用**最大通道差**（噪声级 ≤24）而非"不同像素比例"：
> 平坦图在 H.264 下逐帧重建本来就会抖动（v1 实测 5.6% 像素差 ±8，肉眼不可见），而"画偏 1px"是 max≈160 的量级 —— 两者量级完全不同。

**手术性回归**（证明修得准，不是"顺手改了别的"）：
| 产物 | 结果 |
|---|---|
| v2 **16:9** 图片页片 | **不变** `43A0A22D…` —— `body.p` 作用域在横屏不可达 |
| v2 竖屏 12 页片（无 left/right 页） | **不变** `F94B06C3…` |
| v2 竖屏图片页片 | **改变** `232CF2B0…` → `DA0E6CB3…`（预期内的行为修复） |
| 手写竖屏母版片 | **不变** `B563588C…` |
| 4 条 12 页片（`chart-meta` 加 `canvas` 后重渲） | **全不变** `FC467E01…`/`91ABFF99…`/`BAB7F451…`/`F94B06C3…` |

### 20.4 双向敏感性自证（纪律要求"两个方向都必须红"）
| 方向 | 手法 | 结果 |
|---|---|---|
| **清单改了、实现没改** | 清单副本 `plot.16:9.h` 300→360（`--masters` 指向副本，不动真资产） | **红**：`L1 meta.plot = 清单 plot.16:9`，exit 1 |
| **实现改了、清单没改** | 把产物的图片页 `region` 改成 720×538（模拟竖屏 full 退化回顶带） | **红 3 条**：`L1 region` + `L3 full 覆盖整页` + **`L2 verify-image` 达标 12/18 = 67%、最大差 193**（像素层直接抓住"图摆放与声明不符"），exit 1 |
| 还原 | — | **PASS 310 条** |

### 20.5 顺带提示（不计失败）—— 一条真实的语义缺口
两个母版在 **9:16** 下 `image.left` 与 `image.right` 是**同一条媒体带**（720×538）⇒
**竖屏的"侧向"语义不成立**：left/right 两页的文案位置相同、媒体带相同（清单已**如实**声明为相同矩形，故不算"声明不实"）。
→ 处置留给 team-lead：要么竖屏只用 `full`，要么给竖屏的 left/right 定义真正不同的版式。
（断言器**每次运行都会打印这条**，不会静默。）

### 20.6 未做 / 不确定
1. L2 依赖产物已存在：只检查 `MATRIX` 里列出的 8 条片（新渲但未入表的片不会被自动覆盖）。
2. `master.js`（动效语言）与字阶 `--t-*` **仍不在清单里** ⇒ 本断言器覆盖不到（属已知的"两套共用动效"范围）。
3. "上下分列"断言分支（整宽上下带）已写但**当前无母版用到**，属预防性断言，未被真实产物验证过。
4. `check-examples.mjs` 基线**未变**（21 样例，本轮改动不涉及契约校验逻辑）。

---

## 21. D15：竖屏图片页只保留 `full`（第十一批）

### 21.1 决定与理由
竖屏下 `image.left` 与 `image.right` 是**同一条整宽媒体带**（720×538，实测逐像素同带）⇒ "侧向"语义不成立。
**宁可在契约层禁掉一个没意义的选项，也不让 AI/用户选到"看起来分左右、其实一样"的版式**。横屏保留三版式。

### 21.2 落地的五处（契约 · 校验器 · 反例 · 提示升失败 · 文档）
| # | 位置 | 改动 |
|---|---|---|
| 1 | `validate-deck.mjs` | `checkImage(p, path, style)`：`orientation === '9:16'` 时 `layout` 只允许 `full`，否则报错**并建议改 `full`**（并提示"确实要左右分栏请改用 16:9"） |
| 2 | `deck.schema.json` | `pageImage.layout` 描述写明跨字段依赖（`9:16` 只允许 `full`）—— JSON Schema 表达不了跨字段，真正的校验在 validator |
| 3 | `examples/deck.bad-image-portrait-left.json` | **新反例**（竖屏给 `left`）→ `exit1 / 1err / 0warn` |
| 4 | `check-master-manifest.mjs` | 清单新增 `image.<几何>._allowed` 声明；断言"**产物里出现的图片版式必须在 `_allowed` 内**"（竖屏出现 left/right = 失败）；原来那条"侧向语义不成立"的**提示降级为解释性信息**（不再是缺口） |
| 5 | `AI-PROMPT.md` / 两套 `PARAMS.md` | 口径写明"**竖屏图片页只有 `full`**"（与"按几何选版式"并列） |

### 21.3 派生样例必须同步（否则契约一改，样例自己就不合法）
`deck.img3-9x16(-master-v2)` 原是把 16:9 的三版式直接搬到竖屏 ⇒ **D15 后自身不合法**。
改法：`derive-decks.mjs` 新增 **`pagePatch`**（逐页 `set`/`del`），把原 `left`/`right` 两页改成 `full` 的**两种分支**
（有角标无图注 / 有图注），页数仍 5、且顺带覆盖 `image` 页的 `kicker` 与 `caption` 分支。
派生器仍**机器断言"只改了声明字段"**（把 style/meta/页改动逐条还原 → 与母 deck 语义必须完全一致）。

### 21.4 实测
- **契约样例新基线：22 个全 PASS**，新增 `deck.bad-image-portrait-left.json = exit1/1err/0warn`（**原有 21 个一字未动**）；
- 竖屏图片页片重渲：`out/deck.img3-9x16` = `93D6046D8D95B7871F847D36C4D228EE`、
  `out-master-v2/deck.img3-9x16-master-v2` = `05885C4480D9A295D361074EDB1CBBE4`
  （5 页 / 15s / 720×1280 / 对账 0/0/0/0）；三个 `full` 页像素验证 **12/12**（中位差 4），
  全幅压字对比度 **9.14 / 7.91 : 1**（v1）、**10.55 / 10.52 : 1**（v2）；
- 清单断言器：**338 条全成立**（L1 140 / L2 12 / L3 130 / L4 56）；
- **清单加 `_allowed` 不影响画面**：`deck.all12`（deck 未变）重渲仍 `FC467E0114D84810F1EDF84564B37137` ✓。

### 21.5 一个"抓到自己"的插曲
第一次重渲 v1 竖屏片时我误传了 `--outdir .` ⇒ 工作目录落到 `deck-contract/deck.img3-9x16/`，
而 `out/deck.img3-9x16/` 仍是 D15 之前的旧产物（含 left/right）。**新加的 `_allowed` 断言立刻把它判红**（L1 2 条）
—— 这条断言不仅能防"实现脱节"，还能防"产物陈旧"。清掉误落目录、按默认 `outdir` 重渲后全绿。

### 21.6 未做 / 不确定
1. 竖屏 `left`/`right` 的 CSS 规则**保留**（跨几何一致性 + 清单仍要比对），但本母版下**已无 deck 能用到** —— 属"死规则"，若确认不需要可删（删了要同步 `_allowed` 与断言）。
2. 竖屏 `image` 页只验证了 `full` 的三种内容分支（有/无 kicker、有/无 caption），**未覆盖"长文案溢出"边界**。

---

## 22. 平台默认值 & 抽帧静默失败：`resolveBin` + 逐张点名的锚点（第十二批）

### 22.1 不依赖平台默认 PATH
`render-deck.mjs` 与 `check-master-manifest.mjs` 一律改用 `resolveBin('ffmpeg' | 'ffprobe')`：
`HYPERFRAMES_FFMPEG_PATH` 存在 → **同目录**找同名工具（引擎自带/指定者优先）；否则回退 PATH。
**拿不到就大声失败**（`EXIT.MEDIA = 7`），不再"装作成功"：
- ffprobe 拿不到 → `exit 7 · stage probe`（产物规格 / 色彩标签校验是硬要求，不许静默跳过）；
- 抽帧不完整 → `exit 7 · stage frames`。

### 22.2 抽帧静默失败：把"目录里有几个 PNG"换成**逐张点名**
旧代码 `spawnSync('ffmpeg', …)` **完全不看返回值** —— ffmpeg 不在、参数错、磁盘满，都只表现为"帧少了几张"，
而帧正是**给人看的证据**（结论只从产物取）。现在：
1. 每张帧都检查 `status`；
2. **独立锚点**：逐张点名 `p<i>-enter|full.png` 是否存在且**非空**（不是"目录里 PNG 个数" —— 人做的 contact sheet 也在同目录，按个数会假阳性）；
3. 不达标 → `exit 7`，并把"缺哪几张 / ffmpeg 失败几次 / 试过哪个 bin"写进机器可读 `RESULT` 行。

**故障注入实测**（两种都把失败逼出来）：
| 注入 | 结果 |
|---|---|
| `HYPERFRAMES_FFMPEG_PATH` 指向"一跑就退 1"的假 ffmpeg | **退出码 5 · stage render**（hyperframes 自己先撞上，`stderr_tail` 直指 `FFmpeg cannot start / Failed to run …fakebin\ffmpeg.cmd`） |
| 预建 `frames/p0-enter.png` 为**目录**（只让抽帧失败，不动渲染） | **退出码 7 · stage frames**：`抽帧不完整：期望 10 张，缺/空 [p0-enter.png]，ffmpeg 失败 1 次（试过：ffmpeg）` |

**注入又抓出我一个 bug**：第一版"缺帧检查"直接 `readFileSync(png)`，遇到**目录**抛 `EISDIR` ⇒ 报成 `exit 6 internal` + 裸栈
（**大声但看不懂**）。改成 `statSync().isFile() && size > 0` 后，同一注入变成上面那条**说人话**的 `exit 7`。

### 22.3 L5 全产物扫描：防"死规则"悄悄复活（team-lead 的护栏要求）
`check-master-manifest.mjs` 新增 **L5**：扫描 `out/` 与 `out-master-v2/` 下**所有**带 `image-meta.json` 的产物目录，
按各自 `masterId × orientation` 取该母版清单 `image.<几何>._allowed`，断言**每个图片页的版式都在允许集内**。
- 竖屏 left/right 规则**刻意保留**（想复活不用重写）⇒ 更需要这条护栏：`_allowed` 之外**一律不得出现在任何产物里**；
- 扫描的是**产物目录本身**（不是脚本里的表）⇒ 新渲的片自动被覆盖；
- 顺带防"产物陈旧"（本轮 `--outdir .` 事故就是它先判红）。

**实测：扫 8 个产物目录 · 16 个图片页 · 24 条断言全过**；断言总数 **338 → 362**。

### 22.4 回归
- `deck.all12` 重渲仍 `FC467E0114D84810F1EDF84564B37137` ✓（改 resolveBin / 抽帧校验不影响画面）；
- 新校验打印：`抽帧: 24 张（= 12 页 × 2，逐张点名校验通过）`。

### 22.5 未做 / 不确定
1. 故障注入残留目录 `deck-contract/out-faulttest/`：安全删除拒绝了回收站操作、未能清理（**它不在 L5 扫描的 `out`/`out-master-v2` 之下，不会干扰断言**）；如需清理请人工删。
2. `EXIT.MEDIA` 的**服务端语义**（是否单独重试策略）属"可入库引擎清单"范围，未定。
3. `resolveBin` 只按"同目录同名"找 ffprobe；若某平台把 ffprobe 放在别处，需再补一条环境变量（已在清单里记为待定）。

---

## 23. 核 `hyperframes-localize-fonts`：引擎没有这个能力，**且我们自己的内嵌字体并不"自带内容"**（第十三批）

### 23.1 结论一：引擎里**不存在** `localize-fonts`
两条独立证据：
1. `hyperframes --help`（**v0.8.111**）列出 37 条命令，**没有** `localize-fonts`（也没有任何字体相关命令）；
2. 在整个 `node_modules/hyperframes`（555 个文件）grep `localize-fonts | localizeFonts | localize_fonts | localize` → **0 命中**；
   内置文档主题只有 `data-attributes / examples / rendering / gsap / troubleshooting / compositions` —— **没有字体主题**。
⇒ **字体本地化不能指望引擎**，必须由我们自己在管道里保证（引擎只保证"你把字体文件放进项目就能用"—— 那是"自带"的一半）。

### 23.2 结论二（真问题）：内嵌子集**只覆盖 437 个码点**，而 deck 实际文本有 **250~277 个汉字不在里面**
新增闸门 `check-font-coverage.mjs`（用 `fontkit` 逐字查 woff2 的 cmap）实测：
| 母版 | 字体 | 大小 | 覆盖码点 | 待覆盖字符 | **两套都没有（必然 tofu）** |
|---|---|---|---|---|---|
| master-v1 | NotoSerifSC-sub / NotoSansSC-sub | 176.5KB / 133.3KB | 437 / 437 | 685 | **250** |
| master-v2 | 同上 | 176.5KB / 133.3KB | 437 / 437 | 707 | **277** |

缺的字里**全是极常用字**：供 / 换 / 个 / 起 / 义 / 属 / 声 / 它 / 就 / 以 / 立 / 刻 / 并 / 须 / 增 / 基 / 准 / 各 / 都 / 方 / 放 / 侧 / 压 / 亮 / 区 / 清 …

**为什么一直没被发现**：`master.css` 的族是 `"Noto Sans SC", "Noto Sans CJK SC", sans-serif` —— 子集缺字时浏览器**回退到系统字体**，
而本机（Windows）**正好装了 `NotoSerifSC-VF.ttf` / `NotoSansSC-VF.ttf`**（已实测存在）⇒ 本机渲染完全正常。
**服务器上没有 CJK 字体 ⇒ 这些字直接渲成豆腐块，而且无声无息**（像素验证用的是纯色四象限测试图；对比度检查也看不出缺字）。
这正是"平台默认值"地雷 + 静默降级，**而且发生在我们自己的产物上**。

**敏感性自证**：`--extra "龘𠮷🙂𝄞"` ⇒ 缺字数 250 → **254**（v1）、277 → **281**（v2）✓ 闸门确实"逐字查"，不是恒真。

### 23.3 根因
`subset-fonts.py` 的字符来源是**母版源码**（HTML/CSS/JS 全文）+ 安全集，**不含 deck 的文本**（deck 是运行时才由 AI 产出的）。
源码里的中文只来自注释 ⇒ 子集只有 437 个码点；**片子里真正要显示的字，大半不在其中**。

### 23.4 两条修法（**需 team-lead 定**）
| 方案 | 做法 | 优点 | 代价 |
|---|---|---|---|
| **A 静态大子集** | 字符集扩到"常用汉字表（约 3500 字）+ ASCII + 标点"，重新子集化进 `masters/*/assets/` | 渲染期**零额外依赖**（字体仍是静态资产） | 需一份常用字表；woff2 预计 1~2MB/字体 |
| **B 按 deck 子集化** | `render-deck.mjs` 渲染前收集该 deck **全部文本** → 现场子集化 → 放进产物 assets | 覆盖**精确**、体积最小、不需要字表 | 渲染期**新增 python + fontTools 依赖**（又一个"平台默认值"，要写进引擎清单） |

（工具链可行性已核实：源字体 `NotoSerifSC-VF.ttf` / `NotoSansSC-VF.ttf` 存在 · Python 3.14.4 · fontTools 4.62.1 · `pyftsubset` 存在。）
**不论选哪个**，`check-font-coverage.mjs` 都要作为**渲染前闸门**（deck 文本 ⊆ 内嵌覆盖），让"缺字"永远是**报错**而不是豆腐块。

### 23.5 未做 / 不确定
1. 闸门目前把"只被一套字体覆盖"记为**警告**（实测 0 个）；是否升级为错误取决于"允不允许 serif/sans 覆盖不一致"（当前两套子集码点相同）。
2. 未验证 **woff2 变量字体在 Chrome 里的实例化**是否与静态子集一致 —— 本机看不出差别，因为缺的字都走了系统回退。
3. **"豆腐块"没有像素级证据**：本机装了 CJK 字体 ⇒ 无法复现缺字渲染。因此本条结论**只靠 cmap 量化**，不靠画面（这点如实说明，避免"看起来验过了"）。

---

## 24. 方案 A 落地：共用大子集字体 + 渲染前闸门（第十四批）

### 24.1 做了什么
| # | 项 | 结果 |
|---|---|---|
| 1 | **字符集**（`fonts/chars-cmn.txt`，**入库**） | **GB2312 一级字表 3755 字**（高字节 0xB0–0xD7 × 低字节 0xA1–0xFE，**可由代码确定性枚举**）+ ASCII 可见 + 中英标点/常用符号 ∪ **我们自己全部资产的文本**（母版源码 + 全部 examples/*.json）⇒ 共 **3926 个码点**（11.3KB） |
| 2 | **新体积** | `NotoSerifSC-sub.woff2` **1376.2KB** · `NotoSansSC-sub.woff2` **1046.6KB**（旧：176.5KB / 133.3KB） |
| 3 | **两套母版共用唯一一份** | 放在 `probe-hf/fonts/`；母版清单声明 `fonts{src:"../../fonts", files:[…]}`；**母版 assets 里不再各存一份**；`render-deck.mjs` 渲染时拷进产物 assets（缺文件 → `exit 7` 大声失败） |
| 4 | **闸门升级** | `check-font-coverage.mjs` 支持 `--deck <path>`：**渲染前**验该 deck 文本 ⊆ 覆盖，缺字 → **`exit 8`** + 可执行建议（改写/换近义字/去 emoji/加进 chars-cmn.txt 重跑 make-fonts.py）。emoji 由同一闸门拦下（不另立规则） |
| 5 | **敏感性自证** | 全量体检 **0 缺字 PASS**；`--extra "龘𠮷🙂𝄞"` → 精确报出这 4 个 ✓ |

### 24.2 ★ 意外收获：新闸门**当场抓住我自己的一个假结论**
落地后 4 条整片的 MD5 与历史基线不符（`FC467E01…` → `31802910…`）。我做了"把 fonts.src 换回旧小子集"的判别，**结论是"字体无关"** —— 但那个测试**是无效的**：
换字体后渲染被**新闸门**拦下（`exit 8`：`deck.types8` 有 **58 个字符**两套内嵌字体都没有），我只看了 MD5 却把输出 `Out-Null` 掉了，
比较的其实是**上一次残留的产物**（假结论）。**是"打印产物 assets 里的字体大小"这个独立锚点拆穿了我**：字体仍是 1047/1376KB，说明交换根本没生效。

**真因（一旦看清就一目了然）**：
| 影片 | 文本覆盖情况 | MD5 |
|---|---|---|
| 手写 4 页母版片 · 生成器 4 页片 | 文本**本来就在**旧子集内（旧子集就是从这些源码收的字） | **逐字节不变** ✓ |
| `all12` / `types8` 等含"新页型"的片 | 有 **58 ~ 277 个字不在**旧子集内 ⇒ 旧片里这些字是**浏览器回退系统字体**渲的 | **变了** ✓ |

⇒ **MD5 变化是修复的必然结果，不是回归**：那些字过去由系统字体"兜底"、现在由我们内嵌字体渲染 —— 这正是"内嵌字体终于自足"的证据。
并且**变化范围精确**：只落在"曾发生回退"的影片上，4 页经典片与手写片逐字节不变。

### 24.3 新基线（字体修复后的 MD5，**旧值全部作废**）
| 影片 | 新 MD5 | 旧 MD5 |
|---|---|---|
| `out/deck.all12` | `3180291092FDFD2C70FB7216A4ACC706` | `FC467E0114D84810F1EDF84564B37137` |
| `out/deck.all12-9x16` | `AA9577DA56CBE4FD3637D350B23BB115` | `91ABFF998968064242485B3309F2EC3C` |
| `out-master-v2/deck.all12-master-v2` | `A52ACF6000FBB650AF53715CE4A653C5` | `BAB7F451026D199C882CFC2707887096` |
| `out-master-v2/deck.all12-9x16-master-v2` | `71726FE05B9E4E4828854FC7585A7CE0` | `F94B06C3B3E922CA03D6D75876C76F36` |
| `out/deck.types8` | `4F12D5353DD8ED649E46FBA285EDB7D3` | `6DB9866126E19789F1C2A8ABAE889715` |
| `out/deck.img3` | `4852209AD5331A8F438B41A3F51135C0` | （无历史基线） |
| `out/deck.charttypes` | `9D9277703EE6BFB1EAD72B80B7D792D0` | （无历史基线） |
| **手写 16:9 片（换新字体后重渲）** | **`7F1B528DD953316644A621054861EA03`（不变）** ✓ | 同 |
| **生成器 `deck.master-v1`（4 页）** | **`F1D608EFA5A6DF7027AE67D6C6B1EDB3`（不变）** ✓ | 同 |

### 24.4 纪律收获（已建议进坑清单）
1. **"换资产后 MD5 变了"不等于回归** —— 要先分清"输入变了"还是"实现变了"；本例是**输入（字体覆盖）变了**，而它正是要修的东西。
2. **测试必须是"能失败"的**：判别脚本如果把渲染错误 `Out-Null` 掉，比较的就是**残留产物**（我这次就中了）。
   → **独立锚点救场**：打印"产物 assets 里的字体大小"立刻暴露交换没生效。
3. **新闸门会拦住旧产物**：这正是"不许静默降级"的代价与价值 —— 旧片子在今天已**无法复现**（因为它们的渲染依赖系统兜底）。

### 24.5 未做 / 不确定
1. 两套母版的 `assets/` 里**仍需"按需 materialize"**共用字体才能直接渲手写母版（手写 HTML 里写的是相对路径 `assets/*.woff2`）；本轮我手工拷了一次并已做字节回归。待办：给一个 `fonts/sync-master-fonts.mjs`（幂等）并在 PARAMS 注明"渲手写母版前先 sync"。
2. **GB2312 一级字表 ≈《通用规范汉字表》一级字表**（我无法离线复现官方表）；若要精确对齐，直接替换 `fonts/chars-cmn.txt` 重跑 `make-fonts.py` 即可（脚本已参数化）。
3. `check-font-coverage.mjs` 尚未接进 `check-examples.mjs` 的样例基线（它是独立闸门 + 渲染前调用）；是否需要"样例集基线"另议。

---

## 25. 字体口径补完：退出码映射 + 二进制入库（第十五批）

### 25.1 退出码映射（两套码都对，但**必须写清**）
| 调用 | 退出码 | 含义 |
|---|---|---|
| `check-font-coverage.mjs --deck <deck>`（脚本自身） | **0 / 1 / 2** | 0=覆盖通过 · **1=有缺字** · 2=用法或读取错 |
| `render-deck.mjs <deck>`（内部调用它） | **8**（`stage: fonts`） | 渲染入口统一映射为 `EXIT.FONT = 8`，附可执行建议，RESULT 行可解析 |

⇒ 契约（`ENGINE-CONTRACT.md`）承诺的是 **8**；服务端只看渲染入口的码。映射已写进 `fonts/README.md §5`、
`check-font-coverage.mjs` 头注释、`README.md §21.1`、两套 `PARAMS.md`。

**并已进退出码回归**：`check-exit-codes.mjs` 新增一格
`字体覆盖闸门：deck 含缺字（emoji）→ exit 8 / stage fonts / RESULT 可解析`
（deck **临时造、用完即删**，不污染 `examples` 基线；`CASES` 9 → **10**，连同 1 个对账故障演练共 **11 格**）。
> 计数口径说明：脚本打印的行是 `CASES.length + 1`（含故障演练）。改动前打印"10 个场景"（=9 用例+1 演练），
> 改动后为 **11 格**（=10 用例+1 演练）—— 若按"用例数"数，正是你要求的 **10**。

### 25.2 字体二进制入库口径（team-lead 拍板，已落文档）
- **只进一份**：放引擎的 `fonts/`，**随引擎走**；`masters/<id>/assets/*.woff2` 是**构建产物**
  （`fonts/sync-master-fonts.mjs` 幂等 materialize，**不入 git**）。
- **服务器零字体依赖**（硬理由）：只需要我们带的这两个 woff2；**不装 Noto 源文件、不装 CJK 系统字体**。
  **禁止**在服务器现场跑 `make-fonts.py` —— 那等于绑上"服务器上源 TTF 的版本"，与坑 28 同类（本机一套、服务器一套）。
- ⚠️ **实测到的 git 陷阱**：`.gitignore:63` 是 `dist-rel/` ⇒ `probe-hf/fonts/` 里的 woff2 **进不了 git**。
  用 `git check-ignore` 核实：`docs/ppt-html-probe/fonts/**` 与 `scripts/video-factory/html-deck/fonts/**` **可入库** ⇒
  入库时必须把这两个 woff2 拷到非 ignore 路径（引擎清单约定 `scripts/video-factory/html-deck/fonts/`）。
- **可复现生成**（换机也得同一份二进制）：`fonts/README.md §3` 记了源字体**绝对路径 + 大小 + MD5** 与工具链版本 ——
  `NotoSerifSC-VF.ttf` 23.97MB `82F7AB38C892B1140BAAE7BAF857D364` ·
  `NotoSansSC-VF.ttf` 16.95MB `504ABDDA545478632820C606A577B4A3` · Python 3.14.4 · fontTools 4.62.1；
  产物 `NotoSerifSC-sub.woff2` 1376.2KB `FA5CC24681624A6DF7BE7EC76ECC200F` ·
  `NotoSansSC-sub.woff2` 1046.6KB `8D644BF273054D44F5C9CCCC413D0F96`。**换源字体 = 换二进制**，必须核对指纹。

### 25.3 未做 / 不确定
1. 两个 woff2 **尚未**拷到可入库路径（`scripts/video-factory/html-deck/fonts/`）—— 该目录属"可入库引擎清单"范围（下一项），
   且我按纪律不写 `scripts/**`；等你确认清单路径后由清单动作带过去（或授权我拷）。
2. `sync-master-fonts.mjs` 属"按需 materialize"：谁能直接渲手写母版，谁就必须先跑它（已写入两套 PARAMS）。

---

## 17. 服务端调用契约 `ENGINE-CONTRACT.md`（第七批）

### 17.1 交付
`deck-contract/ENGINE-CONTRACT.md`（v1，2026-10-02），并作为 `render-deck.mjs` 的**唯一真相源**：退出码 / `RESULT` 行 / 闸门顺序以它为准。
覆盖 9 节：零静默降级 · 调用形式与参数全清单 · 前置依赖 · **退出码+优先级** · 产物约定（谁读谁不读）· 日志与机器可读总结行 · 超时与并发 · 契约自保护 · 已知限制。

### 17.2 写契约时**发现并修掉的实现问题**（契约不是描述现状，而是真的把承诺兑现了）
| # | 问题 | 处理 |
|---|---|---|
| 1 | `style.tempo/density/palette` 用 `X \|\| 默认值` 兜底 ⇒ 非法值会**静默降级** | 改为 `strictPick()`：取不到合法值即抛错（与"不许静默降级"一致） |
| 2 | `cover.asset` **被校验但不被消费**（永远用母版自带封面）⇒ "能过校验但不生效" | 改为**明确报错** `exit 2 / stage=asset` + 新反例 `deck.covercustom.json` |
| 3 | 异常退出码与"校验不通过"**都是 1**，调用方无法区分 | 拆为 `3`(校验) / `4`(对账) / `5`(渲染) / `6`(内部)，`2` 保留给前置 |
| 4 | 无机器可读输出 ⇒ 服务端只能正则猜 | 新增 **`RESULT <单行 JSON>`** + `RENDER/OUTPUT` 行（含 md5、逐帧耗时、色彩标签、对账计数） |
| 5 | `meta.lang` 被校验但 HTML 里 `lang` 硬编码 | **未改**（schema 只允许 `zh-CN`，当前无影响）→ 写进契约已知限制 |

### 17.3 退出码语义（**含优先级顺序**，这是契约里最容易踩的细节）
**顺序：用法 → 母版 → palette → 封面asset → 契约校验 → 对账 → 渲染 → 内部。**
即**前置检查先于契约校验**：一个 deck 若同时"palette 非法 + 内容不达标"，报的是 `2/palette` 而不是 `3`。
> 这个顺序是**写测试时才发现的**（`deck.bad.json` 恰好带着非法 palette `neon-purple`）—— 若不定死并写进文档，服务端一定会误判。

| code | stage | 含义 |
|---|---|---|
| `0` | `done` / `no-render` | 成功 |
| `2` | `usage` / `master` / `palette` / `asset` | 前置不满足（改调用或改 deck 字段，**不重试**） |
| `3` | `validate` | **deck 内容**不达标（改内容，不重试） |
| `4` | `reconcile` | **引擎缺陷**信号（内容丢失/串页/图表几何不符）|
| `5` | `render` | 渲染器/环境失败 |
| `6` | `internal` | 未预期异常 |

### 17.4 契约自保护：**10 个退出码场景全 PASS**（含 1 个故障演练）
新增 `check-exit-codes.mjs`。其中 **`exit 4` 天然无法由"合法 deck"触发**（闸门在前），
⇒ 用 `drillReconcile()` **现造一份"故意少写一处内容"的生成器副本**跑一次、断言报 4、跑完即删 —— **把唯一盲区消掉了**（而非在文档里写"未覆盖"）。

### 17.5 成功路径**零行为变化**（契约硬化的副产品验证）
真实渲染 8 页片：`OUTPUT md5=6db9866126e19789f1c2a8abae889715` —— 与字节基线 `6DB98661…` **逐字节一致** ⇒
strictPick / 退出码拆分 / RESULT 行这些改动**只影响错误路径与日志，不影响出片**。
`node --check render-deck.mjs` 通过；`check-examples.mjs` 13 样例仍 PASS。

### 17.6 本契约**最难保证的一条**（已在 §9 如实标注）
**"渲染时零联网"只做到"页面侧可证 + 工具链侧已配置"**：
- **可证**：生成物里 `https?://` 实测 **0 条**，只引用本地 `assets/`（字体为内嵌 woff2）—— 这条我给了自证命令；
- **未证**：**渲染器进程自身**的联网行为（更新检查/遥测/首次下载 headless-shell）只用 env（`NO_TELEMETRY`/`NO_UPDATE_CHECK`/`NO_AUTO_INSTALL`）配置过，**没做断网端到端实测**。
⇒ 所以契约第 2.5 节把它标为"低置信"，而不是写成"保证离线"。
（次要一条：我为了可测性与服务端钉版本，自己开了 `ENGINE_HF_BIN` 这个**逃逸口**，已写进已知限制并注明"生产不要设"。）
