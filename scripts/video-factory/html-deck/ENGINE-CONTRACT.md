# ENGINE-CONTRACT.md —— `render-deck.mjs` 服务端调用契约

- 版本：v1 · 2026-10-02
- 适用对象：`<REPO>/dist-rel/probe-hf/deck-contract/render-deck.mjs`
- 读者：要调用它出片的服务端 / 接入方（`src/**` 的界面接入不在本契约范围内）
- **真相源**：退出码、`RESULT` 行、闸门顺序，一律以本文件为准；实现漂移由 §8 的回归脚本负责抓

---

## 0. 第一条纪律：**不许静默降级**（无例外）

任何"跳页 / 缩时长 / 换母版 / 改参数 / 忽略某个参数"都**必须报错退出**，不许悄悄糊过去。

这不是口号 —— 下列位置**已在实现里兑现**：
- 契约枚举**没有默认值兜底**：`style.tempo` / `style.density` / `style.palette` 取不到合法值即抛错
  （旧的 `X || 默认值` 写法已全部删除）；
- deck 里**尚未实现的字段明确报错而不被忽略**（例：自定义 `cover.asset` → `exit 2 / stage=asset`，见 §3）；
- 内容校验、对账、色彩标签三类闸门任一非 0 即 **拒渲染**（对应 §3 的 3 / 4）；
- 未预期异常给**独立退出码 6**，不与"校验不通过"混为一谈。

---

## 1. 调用形式

### 1.1 命令
```
node <REPO>/dist-rel/probe-hf/deck-contract/render-deck.mjs <deck.json> [--outdir <dir>] [--no-render]
```
脚本以**自身位置**定位母版与渲染器，**与调用时的 cwd 无关**。

### 1.2 参数全清单
| 参数 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `<deck.json>`（位置参数） | ✔ | — | 待渲的 deck，必须过 §1.3 的契约 |
| `--outdir <dir>` | ✗ | `<脚本目录>/out` | 产物根；实际产物落在 `<outdir>/<deck 文件名去掉 .json>` |
| `--no-render` | ✗ | 关 | **只生成 HTML + 对账，不渲染**（秒级）。用于"先审版式/内容"或 CI 门禁 |

环境变量：
| 变量 | 默认 | 说明 |
|---|---|---|
| `ENGINE_HF_BIN` | `<probe-hf>/node_modules/.bin/hyperframes.cmd` | 渲染器可执行文件（服务端钉版本 / 故障演练）。⚠️ 换成**非 headless-shell** 的浏览器会掉进慢路径，见 §2.3 |
| `HYPERFRAMES_FFMPEG_PATH` · `HYPERFRAMES_FFPROBE_PATH` | 渲染器自行解析 | **强烈建议显式钉到与现有 PPT 线同一个二进制**，见 §2.2 |

### 1.3 输入约定
```
<REPO>/dist-rel/probe-hf/
├── deck-contract/            ← 引擎与契约（本目录）
│   ├── render-deck.mjs       引擎入口
│   ├── validate-deck.mjs     契约校验器（被引擎以子进程调用；不过即拒渲）
│   ├── deck.schema.json      字段契约
│   ├── ENGINE-CONTRACT.md    本文件
│   └── examples/*.json       金样例 + 反例（也是回归基线）
├── masters/<masterId>/       ← **母版资产根**，由 deck 的 `style.masterId` 决定
│   ├── master.json           母版清单：画布/页边距/绘图区/配色表/时长/素材名
│   │                         （**引擎不自带任何母版数值**，全部来自这里）
│   ├── assets/               master.css · master.js · gsap.min.js · cover.jpg · 内嵌字体 woff2
│   └── hyperframes.json      渲染器配置
└── node_modules/             渲染器（hyperframes）
```
- `style` 的五个字段都是**枚举**：`masterId` 决定读哪个 `masters/<id>/`；
  **`palette` 的可选名清单由该母版提供**（`master.json` 的 `palette`）
  ⇒ 用法纪律：**先选 `masterId`，再在该母版的 palette 清单里选**。
- **素材**：封面图取母版自带的 `assets/cover.jpg`。deck 的 `cover.asset` **目前必须等于该值**，其它值报错（见 §0 / §9.1）。
- 母版 `assets/` 在每次生成时**整目录拷贝**进产物目录 ⇒ 产物自包含。

### 1.4 产物目录布局
```
<outdir>/<deck 名>/
├── index.html              整片 HTML（自包含，人可离线直开看版式）
│                           ★ **产物目录里只许这一个 composition 文件**：引擎 CLI 的 check/validate/inspect
│                             **只接受目录**、默认入口写死 `resolve(dir,"index.html")`；多一个根级 HTML 就报
│                             `multiple_root_compositions`（lint error ⇒ check 永远 exit=1）。
├── assets/                 母版资产拷贝（0 外部引用，见 §2.5）
├── hyperframes.json
├── output-<deck 名>.mp4
├── frames/                 p<i>-enter.png · p<i>-full.png（每页 2 帧）
├── reconcile.md            输入→输出对账表
└── chart-meta.json         图表几何元数据
```

---

## 2. 前置依赖

### 2.1 运行时
- **Node ≥ 22**（渲染器 hyperframes 的要求；本机实测 v24.15.0）
- 引擎自身只用内置模块（ESM + `node:crypto` + `node:child_process`），**无第三方依赖**

### 2.2 ffmpeg / ffprobe —— **必须与 PPT 线共用同一份**
- 引擎调用 **PATH 上的 `ffmpeg` / `ffprobe`**（抽帧、产物校验）。
- 渲染器自己解析 ffmpeg ⇒ **必须用 `HYPERFRAMES_FFMPEG_PATH` / `HYPERFRAMES_FFPROBE_PATH` 显式钉死**，
  否则服务器两侧 PATH 不同会出现"HTML 线新 ffmpeg / PPT 线旧 ffmpeg"的行为差异。
- 本机实测 `ffmpeg 8.1-full_build-www.gyan.dev`（`%LOCALAPPDATA%\Microsoft\WinGet\Links\ffmpeg.exe`）；
  **本机两条链恰好同源，服务器上无此保证。**

### 2.3 渲染器 + headless-shell
- `hyperframes@0.8.111`（本机实测）；**必须让它自己 `browser ensure` 拿 `chrome-headless-shell`**（本机实测 152.0.7977.30）。
- ⚠️ **不要把 playwright 的完整 chromium 指给它**：非 headless-shell 二进制会让 `HeadlessExperimental.beginFrame`
  不可用，**自动回退到截图模式**（实测慢 **1.34×**）。
- `--no-sandbox` / `--disable-dev-shm-usage` **已在渲染器源码里硬编码**，服务器不必自己加。

### 2.4 字体
- 两套母版都**内嵌 woff2**（`NotoSansSC-sub.woff2` ~133KB、`NotoSerifSC-sub.woff2` ~176KB）
  ⇒ **不依赖系统字体，换机器字形不变**。
- 反过来说：**删掉这两个文件、或改了字体族名，浏览器会静默回退**（缺字不报错）⇒ 换母版/换字体必须两端逐帧比对。

### 2.5 网络：**渲染时零联网**（可自证）
- 生成物**完全本地**：实测 `index.html` 里 `https?://` 命中 **0 条**，只引用
  `assets/master.css` · `assets/cover.jpg` · `assets/gsap.min.js` · `assets/master.js`（字体走本地 woff2）。
  **自证命令**：`Select-String -Path <outdir>/<deck>/index.html -Pattern 'https?://'` → 应为空。
- 建议显式关闭渲染器的联网类行为：`HYPERFRAMES_NO_TELEMETRY=1`、`HYPERFRAMES_NO_UPDATE_CHECK=1`、
  `HYPERFRAMES_NO_AUTO_INSTALL=1`。⚠️ **先 `browser ensure` 装好再置 `NO_AUTO_INSTALL=1`**（否则冲突）。
- ⚠️ **如实标注**：首次安装 headless-shell 需要联网；**"装完后可离线"我未做断网端到端实测**，
  置信度低于本契约其它结论。

---

## 3. 退出码语义表（含**优先级顺序**）

**顺序（从先到后）**：用法 → 母版 → palette → 封面 asset → **契约校验** → 对账 → 渲染 → 内部。

> 即 **前置检查先于契约校验**：一个 deck 若同时"palette 非法 + 内容不达标"，报的是 `2/palette`，**不是** `3`。
> 该顺序由 `check-exit-codes.mjs` 专门守住。

| code | stage | 含义 | 调用方应做什么 |
|---|---|---|---|
| `0` | `done` / `no-render` | 成功（`--no-render` 时 stage=`no-render`、`rendered:false`） | 读 `RESULT` 取产物 |
| `2` | `usage` | 缺路径参数 / deck 文件不存在 / deck.json 非法 JSON | **不改 deck，改调用** |
| `2` | `master` | `style.masterId` 缺失或不在枚举内 | 从可用清单里选（`RESULT.error` 里列出） |
| `2` | `palette` | `style.palette` **不属于所选母版**的清单 | **先看 masterId，再选 palette**（`RESULT.error` 里有该母版可用名） |
| `2` | `asset` | deck 指定了**尚未实现**的封面素材 | 去掉 `cover.asset` 或改成母版自带值 |
| `3` | `validate` | **契约校验不通过**（内容量不足 / 字段非法 / HTML 注入…） | **改 deck 内容**；`RESULT.detail[]` 逐条给。**不是引擎问题** |
| `4` | `reconcile` | **对账不通过**（内容丢失 / 串页 / 图表几何与数据不符） | **报引擎缺陷**（生成器或母版模板），**不是 deck 问题**；`RESULT` 给到具体页 |
| `5` | `render` | 渲染器失败（非 0 退出 / 二进制不可用 / 环境缺依赖） | 查环境与依赖（§2）；`RESULT` 有 `hyperframes_exit` 与 `stderr_tail` |
| `6` | `internal` | 未预期内部异常（母版资产缺失、模板抛错等） | 报引擎缺陷，附 `RESULT.stack` |

**契约保证**：同一失败场景**永远给同一个码**（不允许"有时 1 有时 3"这类模糊）。
> 历史说明：加细之前 `1` 同时表示"校验不过 / 对账不过 / 渲染失败"，调用方无法区分 —— 现已拆为 `3 / 4 / 5`。

---

## 4. 产物约定（**谁读、谁不读**）

| 文件 | 谁读 | 说明 |
|---|---|---|
| `output-<deck>.mp4` | **服务端 / 下游**（拼接、配音、上字幕） | h264 + yuv420p + 25fps；色彩标签必须是 **`tv` + `bt709`**（引擎会打印并写进 RESULT）；**无音轨**（音频在拼接后配） |
| `frames/p<i>-{enter,full}.png` | **人和审计** | 每页 2 帧：`enter` = `S+0.75`、`full` = `S+2.70`（`S = i × page`）。给人眼看版式，**不做 OCR** |
| ⚠ 取样时刻的硬约束 | — | 页窗口是 `[S-0.25, S+3.25]`，而**下一页从 `S+2.75` 就开始淡入**；入场动画最晚到 `S+2.70` ⇒ **`full` 帧只能取在 `[S+2.70, S+2.75)` 里**（取 `S+2.85` 会混入下一页 ~10–20% 的淡入，实测把图下半压暗到 0.62 倍 —— 任何逐像素校验都会被它带偏，且看起来像渲染缺陷） |
| `reconcile.md` | **人和审计** | 逐字段"输入→输出"对账 + 跨页重复检查。服务端**不必解析**（要机器可读请读 `RESULT.reconcile_counts`） |
| `chart-meta.json` | **只给验证脚本**（`verify-chart.mjs`） | 图表几何/颜色元数据。**业务侧不要读**（结构随验证器演进） |
| `index.html` | 人（直开看）/ 排障 / **引擎 CLI 的默认入口** | 自包含、可离线打开；**必须叫这个名字，且目录内只许一个** |
| `assets/` · `hyperframes.json` | 渲染器 | 每次生成整目录重拷 |

---

## 5. 日志与机器可读总结行

stdout 上**保证**出现的可解析行（服务端应只依赖这些 + `RESULT`）：
```
母版: <id>（<name>）→ masters/<id>/
页型序列: cover → … （<n> 页 × <page>s = <total>s，画布 <w>×<h>，style=<palette>/<density>/<tempo>）
对账: 未命中 <a> / 大数字错 <b> / 图表错 <c> / 跨页泄漏 <d>
RENDER total_s=<秒> per_frame_ms=<毫秒> frames=<帧数>
OUTPUT md5=<md5> bytes=<字节>
RESULT <单行 JSON>
```

- **`RESULT` 是唯一的机器契约**：以 `RESULT ` 前缀 + 一行合法 JSON。
  **不要用正则去猜那些人话日志。**
- **每页耗时不可得**：渲染是**单趟整片**，渲染器不提供逐页耗时 ⇒ 只给 `total_s` 与 `per_frame_ms`（如实说明，不伪造）。
- **成功** RESULT 字段：
  `ok · code · stage · rendered · deck · deck_path · master_id · orientation · density · palette · pages · page_s · fps · frames · duration_s · width · height · codec · pix_fmt · color_range · color_space · mp4 · frames_dir · reconcile · reconcile_counts{missing,num_bad,chart_bad,leaks} · md5 · render_ms`
- **失败** RESULT 字段：`ok:false · code · stage · error`，并按阶段补充：
  校验 → `detail[]` + `errors`/`warns`/`validator_ran`；对账 → `missing/num_bad/chart_bad/leaks/detail[]`；
  渲染 → `hyperframes_exit` + `stderr_tail[]`；内部 → `stack[]`。
- **stderr 只放人话与堆栈，不要解析它。**

---

## 6. 超时与并发建议
- 本机实测（8 页 / 24s）：**1280×720 约 13.5s**、**720×1280 约 13.6s**（均含渲染器 setup）。
- 建议调用方**超时 ≥ 单页时长 × 8**（留冷启动与 IO 抖动余量）：8 页片给 **120s**。
- 并发：**4 核 16G 无 GPU 服务器建议 2 个渲染进程**（实测峰值 2.5~5 核、内存增量 0.55~1.1GB）。

---

## 7. 调用方判定流程（建议）
```
exit 0         → 成功，读 RESULT（认 exit 0 + RESULT.md5 双条件）
exit 2         → 调用方/deck 的**前置错误** → 不重试；按 stage 定位（改 deck 字段或改调用方式）
exit 3         → deck **内容**不达标 → 不重试；把 RESULT.detail 交给内容侧
exit 4 / 5 / 6 → **引擎或环境**问题 → 可重试一次；仍失败则报缺陷（附整行 RESULT）
```
**绝对不要**：exit 非 0 时把 `frames/` 或上一次留下的 mp4 当成果交付；
也不要因为"目录里有 mp4"就判成功 —— **只认 `exit 0` + `RESULT.md5`**。

---

## 8. 契约的自我保护（回归）
| 脚本 | 保证什么 | 现状 |
|---|---|---|
| `check-exit-codes.mjs` | §3 的退出码 / stage / **优先级顺序**；含 **1 个故障演练**（现造"故意少写内容"的生成器副本 → 断言 `4`） | **10 场景全 PASS** |
| `check-examples.mjs` | 契约校验器对 13 个样例的基线（11 个反例） | **PASS** |
| `verify-chart.mjs` | "图上几何 = 输入数据"（bar/line/donut × 两母版 × 横竖屏） | 全部 PASS |
| `verify-density.mjs` | `density` 真的改了页边距（横屏 + 竖屏） | 全部 PASS |
| `verify-masters.mjs` | 两套母版确实不同（像素：亮度/主色相/逐像素差） | PASS |
| 字节级回归 | 改母版资产后既有产物 MD5 不变（`7F1B528D…`/`B563588C…`/`F1D608EF…`/`6DB98661…`） | 6 次全 PASS |

> 退出码 **4** 天然无法由"合法 deck"触发（闸门在前面，这是好事）⇒ 它在"按文档写"的测试里天然是盲区。
> 消法：`check-exit-codes.mjs` 的 `drillReconcile()` 会**现造一份"故意少写一处内容"的生成器副本**跑一次，
> 断言它报 `4 / reconcile`，跑完即删。**盲区已消除，不再依赖"间接守护"。**

---

## 9. 已知限制（服务端需知情）
1. **自定义封面素材未实现**：`cover.asset` 只能等于母版自带值，其它值**明确报错**（不静默忽略）。
2. **`meta.lang` 被校验但未消费**：HTML 的 `lang` 硬编码 `zh-CN`，而 schema 只允许 `zh-CN` ⇒ 当前无影响；若将来放宽需同步实现。
3. **每页耗时不可得**（单趟渲染），只给整片时长与每帧耗时。
4. **占比环 < 8° 的小扇区在验证器下不可测**（`MINRUN=7.5°`）—— 这是**验证能力**限制，不影响出片。
5. **"装完 headless-shell 后可离线"未做断网实测**。
6. `verify-density.mjs` 依赖"`.rule` 是实心块、且左缘精确等于 `--pad`"这一母版约定；
   母版若给 `.rule` 加内边距/圆角/透明度，该量法会失准。
7. **`ENGINE_HF_BIN` 是个逃逸口**（为服务端钉版本与故障演练而开）：指错会让渲染掉进慢路径或直接失败。
   生产环境**不要设**它，除非明确要换渲染器。
8. **"渲染时零联网"只做到"页面侧可证 + 工具链侧已配置"**：生成物 0 外部引用是实测结论（§2.5），
   但渲染器进程自身的联网行为**未做断网实测** —— 这是本契约**最难保证的一条**（见 §2.5 的如实标注）。
9. 退出码 `5` 内部**不再细分**："deck 有问题"与"环境有问题"在渲染阶段都表现为 5；
   调用方若要区分，只能看 `RESULT.stderr_tail`（不保证结构稳定）。
8. `master.js`（动效语言）两套母版**共用**；若将来要"每套母版带自己的动效"，manifest 需再加一层。
9. 契约中 **"契约三处同步"的唯一例外**：`palette` 在 `deck.schema.json` 里是 `string + pattern`（不是 `enum`），
   取值清单权威在校验器（按所选母版的 `master.json` 查）。`masterId` 仍是 schema `enum`。
