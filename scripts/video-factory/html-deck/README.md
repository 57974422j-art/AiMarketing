# deck-contract —— HTML 动态 PPT「AI 侧契约」v1

> 目的：让 AI 产出的是**一整套幻灯片的数据**（JSON），而不是 HTML/CSS。
> 版式 / 动效 / 字体全由母版 `master-v1` 负责；AI 只在契约允许的字段和枚举里填内容。
> 事实基准 = 已经跑通的 `../../master-v1/`（12 秒四页母版）。

> ★★ **顶格三条**（任何"绿"都必须**同时**满足；违反任一条 ⇒ 该绿不算证据）：
> 1. **判据必须能失败**：每条判据都要给 **"必红样本"** 与 **"不许红样本"**
>    （**负控防漏报 · 正控防误报 ⇒ 共同防"判据被放宽"**）；负控还要答**"为什么红"**
>    （`exit 2`=判据失败 ≠ `exit 1`=表/产物违规 ≠ `0`=没红 ⇒ 假红与假绿同罪；见 §25q）。
> 2. **结论必须带证据两件**：`命令 exit=N` **且** `命中数 = M` —— **零命中不是通过，是没测**
>    （"分母不许为零"；见 §25a / K15 / K18）。
> 3. **判据只依赖"源 + 产物"**：不许依赖上一动留下的**运行态**（运行态文件写在仓库之外；
>    同一份代码的红/绿**不许随"跑没跑过别的闸门"而变**；见 §25i / K18）。

---

## 1. 三个交付物

| 文件 | 作用 | 谁看 |
|---|---|---|
| `deck.schema.json` | **分页契约**：页型 + 字段 + **内容量下限**（要点 ≥3 条每条 ≥8 字、数据页必须有 数字+单位+解释、封面必须有 主标题+副标），机器可校验 | AI 读它来写 JSON；工程读它来做生成器 |
| `AI-PROMPT.md` | **给 AI 的提示词草案**：只输出本 schema 的 JSON（禁 HTML/CSS）、风格参数只能在枚举里选、内容下限、输出前自检清单 | 直接塞进 system prompt |
| `validate-deck.mjs` | **校验器**（零依赖 Node ≥18）：读 `deck.json` → 报"哪一页不达标、缺什么"，并给**替换页型建议** | 出片前的闸门；也可给 AI 当自检工具 |

辅助：`examples/deck.master-v1.json`（**金样例 = 母版的事实基准**）、`examples/deck.bad.json`（反例）、`examples/deck.html-injected.json`（掺 HTML 的反例）。

---

## 2. 怎么用（三步）

```bash
# 1) 让 AI 按 AI-PROMPT.md + deck.schema.json 产出 deck.json（只输出 JSON）
# 2) 过闸门
node validate-deck.mjs deck.json          # 人读报告；exit 0=PASS 1=FAIL
node validate-deck.mjs deck.json --json   # 机器可读（给流水线用）
# 3) PASS 之后，才把 deck.json 交给母版渲染（渲染侧见 ../master-v1/PARAMS.md）
```

`validate-deck.mjs` 在做的事：
1. 严格对齐 `deck.schema.json` 的字段与枚举；
2. **额外**查三件 schema 表达不了的事：
   - **首屏必须是 `cover`**（末屏建议 `end`，缺了给 warning）；
   - **字符串里出现 HTML/CSS 标记 → 判定"AI 写了 HTML"**（完整标签 / `style=` / CSS 声明式 / `javascript:`）；
   - **每个不达标项都附"替换页型建议"**（如：要点不足 3 条 → 建议改用 `data` 页或并进相邻页；数据页拿不到真实数字 → 建议改用 `bullets`）。

---

## 3. 自检结果（本目录可复现）

```bash
cd scripts/video-factory/html-deck
node validate-deck.mjs examples/deck.master-v1.json        # 期望 PASS
node validate-deck.mjs examples/deck.bad.json              # 期望 FAIL 且逐条给出建议
node validate-deck.mjs examples/deck.html-injected.json    # 期望只报 HTML 相关 3 项
```

| 样例 | 结果 | 说明 |
|---|---|---|
| `deck.master-v1.json`（金样例） | **PASS / exit 0**（0 不达标 / 0 建议） | 真实母版内容，说明"已跑通的东西"本身合规 |
| `deck.bad.json` | **FAIL / exit 1**（13 不达标 / 3 建议） | 覆盖：标题过短、缺副标、palette 非法、页数不足、要点仅 2 条、要点过短、小结过短、大数字写成"八十二"、单位空、解释过短、次指标仅 1 条、末页非 end |
| `deck.html-injected.json` | **FAIL / exit 1**（**恰好 3 项**，全是 HTML/CSS 标记） | 闸门命中精准、**不误伤其它合规字段**；同时复验金样例仍 PASS（无假阳性） |

`--json` 模式输出 `{file, pass, errorCount, warnCount, issues[], pages[]}`，便于接进流水线。

---

## 4. 与上下游的关系

```
素材/要点  ──(AI: AI-PROMPT.md + deck.schema.json)──▶  deck.json
                                                         │
                                        validate-deck.mjs（闸门，必须 PASS）
                                                         │
                                                         ▼
                                    master-v1 母版（PARAMS.md：配色/密度/节奏令牌）
                                                         │
                                                         ▼
                                    HTML 动态页 ──(逐帧 seek)──▶ 12s 片段 ──(concat + 旁白/BGM/字幕)──▶ 成片
```

**边界（v1 不做的）**：不管旁白（TTS）、不管字幕、不管素材转码（那是"HTML 线入口统一转 H.264 + bt709/tv 标签"的活）、不做多母版切换（`masterId` 目前只有 `master-v1`）。`style` 只给"选"，不给"调数值"——具体像素/色值在母版侧。

---

## 5. 样例集回归自检（D11）· `check-examples.mjs`

```bash
node check-examples.mjs          # 人读；exit 0 = 三个样例全部符合基线
node check-examples.mjs --json   # 机器可读
```

**基线数字**（改契约后必须显式改这里的数——改数即"我确认收紧了/放宽了闸门"；数量一变就红）

| 样例 | exit | 不达标 | 建议 |
|---|---|---|---|
| `deck.master-v1.json`（金样例） | 0 | 0 | 0 |
| `deck.bad.json` | 1 | **13** | 3 |
| `deck.html-injected.json` | 1 | **3**（且必须全落在"HTML/CSS 标记"上） | 0 |

**敏感性已自证（这个回归不是摆设）**：把校验器的要点下限从 3 改成 1（用 `DECK_VALIDATOR` 指向一份改松的副本）→ 回归**立刻变红**（`deck.bad.json` 不达标 13→12、exit 1）；改回正式版 → 恢复 PASS。命令见 §7。

---

## 6. 生成器 `render-deck.mjs`（D12）—— 端到端最后一环

```bash
node render-deck.mjs examples/deck.master-v1.json      # → out/deck.master-v1/
node render-deck.mjs examples/deck.full6.json          # → out/deck.full6/
node render-deck.mjs <deck.json> --no-render           # 只生成 HTML + 对账（秒级，不渲染）
```

流程 —— **任一步失败即中止，绝不渲染**：
1. **闸门**：先跑 `validate-deck.mjs`；不通过 → 打印报告并 exit 1，**拒绝渲染**；
2. **生成**：deck → **`index.html`**（复用母版的 `master.css` / `master.js` / 内嵌字体 / GSAP）。
   ★ **产物目录内只许一个 composition 文件，名字必须是 `index.html`**：引擎 CLI 的 `check`/`validate`/`inspect`
   **只接受目录**，默认入口是 `resolve(dir, "index.html")`（`lintProject(dir, entryFile)`）；
   若同时存在两个根级 composition（如 `index.html` + `deck-page.html`），lint 报
   `multiple_root_compositions` ⇒ **不许写同名副本**（team-lead 实测拍板，v0.8.111）；
3. **对账**：逐页逐字段可执行断言（§6.1）；任一非 0 → exit 1；
4. **渲染**：`--workers 1`（D10）；
5. **产物**：`output-<deck名>.mp4` + `frames/p<i>-enter|full.png` + `reconcile.md`；
6. 打印一行 **页型序列**：`cover → bullets → data → bullets → data → end （6 页 × 3s = 18s …）` 供对账。

### 6.1 对账口径（不是"打印个表"，是可执行断言）
- 把每页 HTML 切成**文本节点**后**按节点**比对（不是整片子串）—— 否则短字符串（单位"秒"、数字"4"）会在别处误命中；
- `data.metric.number` 是**滚筒渲染**（HTML 里根本没有 "82" 字面量）→ 改为校验**滚筒格数是否编码了正确数字**（末位多转一圈 = +10）；
- **跨页泄漏**检查：本页不得出现别页的字段值；
- **不做 OCR**（避免引入新误差源）；"画面上真的长这样"由 `frames/` 人眼确认。

### 6.2 `style` 枚举真的落到 CSS 令牌（否则就是 team-lead 警告的"契约能过、渲染不出来"）
| 枚举 | 落到 | 取值 |
|---|---|---|
| `palette` | `--accent` + `--accent-rgb`（连背景光晕也随主题） | warm-gold / olive / clay / mist-blue |
| `density` | `--pad` / `--gap`（**仅版心与节奏；字阶暂不随密度变**，见 §8） | airy 96/24 · normal 默认 · dense 72/16 |
| `tempo` | `--enter` / `--enter-gap` / `--xover` | calm .85/.65/.6 · normal .72/.55/.5 · brisk .55/.42/.4 |

⚠️ `tempo` 会改 `--xover`，而**页窗口是用 xover 算出来的** → 生成器必须用**同一个值**算 `data-start/data-duration`，否则 clip 窗口会与 `master.js` 的时间轴错位。本生成器把 `TEMPO` 当唯一真相源。

---

## 7. 复跑命令汇总（可直接复制）

```bash
cd scripts/video-factory/html-deck

# 契约
node validate-deck.mjs examples/deck.master-v1.json      # 期望 exit 0
node validate-deck.mjs examples/deck.bad.json            # 期望 exit 1
node check-examples.mjs                                  # 期望 exit 0（三样例合基线）

# 自证"回归会变红"（敏感性）
node -e "const fs=require('fs');let s=fs.readFileSync('validate-deck.mjs','utf8');fs.writeFileSync(process.env.TEMP+'/loose.mjs',s.split('p.items.length < 3').join('p.items.length < 1'),'utf8')"
# PowerShell: $env:DECK_VALIDATOR="$env:TEMP\loose.mjs"; node check-examples.mjs   # 期望 exit 1
# bash:       DECK_VALIDATOR=$TMPDIR/loose.mjs node check-examples.mjs              # 期望 exit 1

# 生成 + 渲染
node render-deck.mjs examples/deck.master-v1.json
node render-deck.mjs examples/deck.full6.json
```

---

## 8. 已验证（D12 的两条输入）

| 输入 | 结果 |
|---|---|
| `deck.master-v1.json`（4 页） | 300 帧 / 12.00s / h264 yuv420p / **color_range=tv · color_space=bt709**；对账 未命中 0 · 跨页泄漏 0 |
| `deck.full6.json`（6 页，新造） | **450 帧 / 18.00s**（**页数完全由 deck 决定**）；对账 未命中 0 · 跨页泄漏 0；画面见 `out/deck.full6/frames/sheet-full.png` |

**"同版式"量化**（4 页生成 vs 手写 `master-v1.mp4`，取各页"全就位帧"对比，隔离排期差异）：
| 页 | PSNR |
|---|---|
| P1 封面 | 44.67 dB（差异只来自封面小字措辞：deck 里 `meta.date="2026-10"` vs 手写母版"2026 年 10 月"） |
| P2 要点 | 51.31 dB |
| P3 数据 | 51.64 dB |
| P4 尾页 | **inf（像素完全一致）** |

**`palette` 生效的客观证据**（取底部进度线像素，y=634）：
`warm-gold` → (158,128,87) ／ `clay` → (146,112,92) —— 两者色比分别吻合各自主题真值（低饱和暖金 vs 陶土），且**同一份 HTML 模板只换了令牌**。

---

## 10. 页型 4 → 10（第三批）

新增 6 种页型：`section` 章节 / `chart` 图表 / `compare` 对比 / `quote` 引用 / `toc` 目录 / `summary` 小结。字段与**内容量下限**见 `deck.schema.json`（AI 侧口径见 `AI-PROMPT.md` §2/§4）。

**金样例**：`examples/deck.types8.json` = **8 页 × 3s = 24s**
`cover → section → bullets → chart → compare → data → quote → end`
产物：`out/deck.types8/output-deck.types8.mp4`（**600 帧 / 24.000s / h264 yuv420p / tv+bt709**）
证据：`out/deck.types8/frames/`（每页 2 帧）+ `sheet-full.png`（8 页拼图）+ `chart-closeup.png`（图表特写）+ `reconcile.md`（**未命中 0 / 大数字错 0 / 图表错 0 / 跨页重复 0**）

### 10.1 图表"真画"是**两层**证明（缺一不可）
| 层 | 工具 | 证明什么 |
|---|---|---|
| HTML 层 | `render-deck.mjs` 的 `chartCheck` | 生成的 HTML 里，**图上几何反推的数值 == 输入 series**（柱高/顶点 y/弧长都反推一遍） |
| 像素层 | `verify-chart.mjs`（抽帧） | 渲染出的**画面上真的这么高**，没被裁/没画错 |

实测（`node verify-chart.mjs out/deck.types8`，容差 ±4px，绘图区高 234px）：
| 输入值 | 期望柱高 | 实测柱高 | 差 |
|---|---|---|---|
| 62.5 | 158.5px | 159px | +0.5 |
| 70.5 | 178.7px | 179px | +0.3 |
| 92.3 | 234.0px | 235px | +1.0 |
| 29.0 | 73.5px | 74px | +0.5 |
| 24.9 | 63.1px | 63px | −0.1 |
→ **5 根柱全部 ≤±1px**，即"图上柱高 = 输入数据"。三种图表类型（`bar`/`line`/`donut`）都实现了真画：柱用 `scaleY` 生长、折线用 `strokeDashoffset` 收线、占比环用 `dasharray/dashoffset` 逐片展开，**全部是 transform/描边属性动画 ⇒ 逐帧可 seek**。

### 10.2 收窄了"跨页泄漏"判据（踩了假阳性）
原判据"子串命中即泄漏"在 8 页 deck 上**误报 3 条**：
`HTML 逐帧`（对比页标签）嵌在章节副题里、`2026-10`（封面日期）嵌在引用出处里、`01`（章节编号）撞上要点页编号 —— **全是正常内容**。
→ 改为：**拦渲染**只认"别页字段在本页出现了**正好等于该值的独立节点**"（并跳过 <4 字的值）；纯粹子串命中降级为**"疑似重复（不拦）"**列，供人看。
→ 收窄后复跑 4 页 / 6 页 / 配色三条老 deck，**仍全部 0/0/0/0**（证明没有放水）。

### 10.3 `check-examples.mjs` **新基线**（9 个样例，逐字）
```
deck.master-v1.json      = exit0 / 0err / 0warn
deck.bad.json            = exit1 / 13err / 3warn
deck.html-injected.json  = exit1 / 3err / 0warn
deck.bad-section.json    = exit1 / 2err / 1warn
deck.bad-chart.json      = exit1 / 3err / 0warn
deck.bad-compare.json    = exit1 / 3err / 0warn
deck.bad-quote.json      = exit1 / 2err / 0warn
deck.bad-toc.json        = exit1 / 1err / 0warn
deck.bad-summary.json    = exit1 / 1err / 0warn
```
敏感性复验：把要点下限 3→1（指向改松副本）→ **2/9 个样例立刻变红**（`deck.bad.json` 13→12、`deck.bad-toc` 1→0）；换回正式版即 PASS。

---

## 11. 母版枚举化 + 第二套母版（第四批）

`masterId` 从单值变**枚举** `['master-v1','master-v2']`；母版资产按 **`masters/<id>/`** 组织，生成器按 `masterId` 取资产根。

**真正的"写死"不在 CSS，在生成器**：`master.css` 逐条核查后是 **100% 令牌驱动**（全文只有 `:root` 有字面色），
而 `render-deck.mjs` 里写死了 `MASTER` / `PAGE` / `GEO` / `PLOT` / `PLOT_PAD` / 绘图区上移量 / 素材名 / 配色表。
→ 这 7 类值已全部搬进 **`masters/<id>/master.json`**（母版清单）；生成器只消费清单、**不再自带任何母版数值**。

**1→1 字节级回归（三次全 PASS）**：
`F1D608EF…`（生成器 4 页 deck）· `6DB98661…`（生成器 8 页 deck）· `7F1B528D…`（手写母版 4 页片，资产搬迁后）。

**master-v2 = 浅色商务**（`--bg #f5f6f8` / `--accent #2f5fa8`），**10 页型全做**，且做了 9 处**结构级**差异
（纹理、强调条、要点页标记、数据页小指标、封面素材处理、图表柱 + **绘图区 300→344px**、章节号、引用装饰、进度线）。
详见 `masters/master-v2/PARAMS.md`。

**同一个 deck，两套母版各出一条 8 页 24 秒片**（只改 `style.masterId`）：
| | master-v1 | master-v2 |
|---|---|---|
| 产物 | `out/deck.types8/output-deck.types8.mp4` | `out-master-v2/deck.types8-master-v2/output-deck.types8-master-v2.mp4` |
| MD5 | `6DB9866126E19789F1C2A8ABAE889715` | `D4A9B0F4EC8C2F78E1A65C4E841E89B7` |
| 对账 | 0/0/0/0 | 0/0/0/0 |

**图表像素反推：两套各自几何都 ≤±1px**（v1 数据区 234px → v2 270px）。
验证器的颜色判定改为**自适应**（阈值 = 0.5 × 柱色离底距离，柱色/底色/不透明度由母版给出）——
否则写死的 `R>70` 在浅色母版上会**把所有像素判成柱**。

**"两套确实不同"的像素证明**（`verify-masters.mjs`）：亮度 V `0.117 → 0.922`、
主色相 H `28.3° → 221.2°`（归一化 `0.079 → 0.614`）、同帧逐像素平均差 `209.19 / 255`。
视觉证据 `frames-compare-v1-v2.png`（左 v1 / 右 v2；cover / chart / quote）。

**新基线（10 个样例）**：见 REPORT §13.6；新增 `deck.bad-master.json = exit1 / 1err / 0warn`（非法 masterId）。

**已知张力**：palette 是枚举、不许新增，v2 把 4 个名都映成蓝/青/紫族（母版=皮肤）。
若要求"同一 palette 名在两套母版上色相一致"，属契约变更，需 team-lead 定夺。

---

## 12. palette 由母版定义 + 竖屏整片 + line/donut 像素反推（第五批）

### 12.1 `palette` 语义：由母版清单定义（不再有"跨母版同名同色"）
- **名清单 + 色值都在 `masters/<id>/master.json`**：v1 = `warm-gold/olive/clay/mist-blue`（原 4 名不动，零回归）；v2 = `azure/steel/indigo/violet`。
- `validate-deck.mjs` **按所选母版的清单校验**；`deck.schema.json` 的 `palette` 降为 `string + pattern`（取值清单是每母版数据，写进 schema 会漂移；权威在校验器）。
- `AI-PROMPT.md`：**先选 masterId，再在该母版的 palette 清单里选**。
- 新反例 `deck.bad-palette.json = exit1/1err/0warn`。

### 12.2 4 条 8 页 24 秒片（两套母版 × 横竖屏）
`derive-decks.mjs` 派生变体并**机器断言只改了声明字段**（orientation/masterId/palette）。

| 片 | 尺寸 | 帧/时长 |
|---|---|---|
| `out/deck.types8/` | 1280×720 | 600 / 24.000s |
| `out-master-v2/deck.types8-master-v2/` | 1280×720 | 600 / 24.000s |
| `out/deck.types8-9x16/` | 720×1280 | 600 / 24.000s |
| `out-master-v2/deck.types8-9x16-master-v2/` | 720×1280 | 600 / 24.000s |

### 12.3 ★ 竖屏反推暴露的真回归（`--pad` 求值时机）
竖屏 bar 像素反推**恒定少 30px**（30 = 84−54）⇒ 竖屏 `--pad` 是 84 而非 54。
根因：**自定义属性在声明它的元素上就求值完毕** —— `:root{--pad: var(--pad-base)}` 会立刻算成 84px 并继承，`body.p{--pad-base:54px}` 改不动它。
修法：**谁设 `--pad-base` 谁在同一块里再派生 `--pad`**；`density` 只调增量 `--pad-dense`（`calc(基准+增量)`）⇒ 横竖屏都生效。

**修后双向字节回归**：手写 16:9 `7F1B528D…` ✓ · 手写 9:16 `B563588C…` ✓ · 生成器 4 页 `F1D608EF…` ✓ · 生成器 8 页 `6DB98661…` ✓。
（上一批我只做了横屏回归 → 这个 bug 漏了。**横竖屏必须各验一次**。）

### 12.4 `line`/`donut` 像素级反推（三种类型全测）
`verify-chart.mjs`：`bar` 量柱高 · `line` 量顶点 y · `donut` 量扇区角（母版给相邻扇片三档明度循环 `.ch-s0/1/2`，让边界可分辨）。
实测（实测/期望，两套母版各自几何）：`line` **≤±2px** · `donut` **≤±0.6°** · `bar` **≤±1px**。

修掉 3 个验证器缺陷：① 按"某档色最长段"找扇片 → 改按**类变化点测边界夹角**；② 边界混合像素≈第三档 → 加**短段合并**；③ **合成链算错**：扇片是叠在 `.ch-donut-track` 上而非底色上 ⇒ 让母版申报 `rule` 色，按 `shade×accent over (rule over bg)` 算。
**通用教训**：跨皮肤的颜色判据必须**沿真实渲染合成链**推导，并让母版申报参与合成的颜色。

### 12.5 新基线（13 个样例）
见 REPORT §14.5；新增 `deck.bad-palette.json`、`deck.charttypes.json`、`deck.charttypes-master-v2.json`。

---

## 13. 追加：竖屏 line/donut 反推 + density 像素验证（第六批）

### 13.1 竖屏 `line`/`donut`（两套母版）
`deck.charttypes-9x16.json` / `…-9x16-master-v2.json`（派生脚本断言只改 `orientation`，v2 另加 `masterId`+`palette`）。
结果：v1 9:16 —— line **≤±2px**、donut **≤±0.5°**（半径 170px）、bar **≤±1px**；v2 9:16 —— line **≤±1.5px**、donut **≤±0.65°**（半径 156px）、bar **≤±0.6px**。
两套的扇片边界都测出 **5 个**（符合扇片数），对账均 0/0/0/0。

### 13.2 `density` 的像素级验证（`verify-density.mjs`）
量**要点页整帧最左的强色像素列** = `--pad`（用 `.rule` 实心块作基准物；`.tex` 淡纹理用阈值排除）。

| 几何 | normal | airy | dense |
|---|---|---|---|
| 16:9 | 声称 84 / **实测 84** | 声称 96 / **实测 96** | 声称 72 / **实测 72** |
| 9:16 | 声称 54 / **实测 54** | 声称 66 / **实测 66** | 声称 42 / **实测 42** |

纯测量交叉校验：**airy−normal = +12px、dense−normal = −12px**，横竖屏都成立 ⇒ 证明 `--pad-dense` **增量方案**真的生效（即 §12.3 那个回归的正向验证）。
6 个数据点零像素误差。

### 13.3 回归
本轮未改母版 CSS/JS 与渲染路径 ⇒ 上一批 6 次字节回归结论有效；`check-examples.mjs` 基线**仍 13 个样例、未变**（无新增契约要素）。

---

## 14. 服务端调用契约（第七批）

新增 **`ENGINE-CONTRACT.md`**（v1）= `render-deck.mjs` 的**唯一真相源**（退出码 / `RESULT` 行 / 闸门顺序以它为准），覆盖：零静默降级 · 调用形式与参数 · 前置依赖 · 退出码+优先级 · 产物约定（谁读谁不读）· 日志与机器可读总结行 · 超时并发 · 契约自保护 · 已知限制。

**写契约时顺手修掉的实现问题**（契约不是描述现状，而是把承诺兑现）：
1. `style.tempo/density/palette` 的 `X || 默认值` 兜底 ⇒ 非法值**静默降级** → 改 `strictPick()` **抛错**；
2. `cover.asset` **被校验但不被消费** → 改为**明确报错** `2/asset` + 反例 `deck.covercustom.json`；
3. 异常与"校验不通过"**都是 1** → 拆为 `3`(校验)/`4`(对账)/`5`(渲染)/`6`(内部)，`2` 留前置；
4. 无机器可读输出 → 新增 **`RESULT <单行 JSON>`** + `RENDER`/`OUTPUT` 行（md5、逐帧耗时、色彩标签、对账计数）。

**退出码优先级**（契约里最容易踩的细节）：
**用法 → 母版 → palette → 封面asset → 契约校验 → 对账 → 渲染 → 内部** ——
即"前置检查先于契约校验"：同时"palette 非法 + 内容不达标"的 deck 报 `2/palette` 而非 `3`。

**自保护**：`check-exit-codes.mjs` **10 场景全 PASS**，其中 `exit 4` 天然无法由合法 deck 触发 ⇒ 用
`drillReconcile()` 现造"**故意少写一处内容**"的生成器副本跑一次断言报 4、跑完即删 —— **盲区已消除**。

**成功路径零行为变化**：真实渲染 8 页片 `OUTPUT md5=6db98661…` 与字节基线 `6DB98661…` **逐字节一致** ⇒
上述改动只影响错误路径与日志。`node --check` 通过；`check-examples.mjs` 13 样例仍 PASS。

**最难保证的一条**（已如实标注）：**"渲染时零联网"只做到"页面侧可证 + 工具链侧已配置"** ——
生成物 `https?://` 实测 0 条（给了自证命令），但**渲染器进程自身**的联网行为**未做断网实测**。

---

## 15. 页型 11~12 收口（12/12，第八批）

新增 **`image` 图片页**（`title` + `asset` + `layout: left/right/full` + 可选 `caption`/`kicker`）与 **`steps` 步骤页**（`title` + 3~6 条 `steps` + 可选 `index: number/dot`）。

**① 素材闸门 `mediaGate()`**（在 validator 里，把"入口统一转码"的接口先暴露出来）：绝对路径/`file://`/`..` 越界 → 报错；静态图只收 `jpg/jpeg/png/webp`；**视频素材 → 明确报错并指明出路**；**文件不存在 → 报错**。**绝不静默黑屏。**

**② 全幅压字的对比度规矩**：走**渐隐底衬**（`linear-gradient(to top, rgba(0,0,0,.80) → 0)`，非实心黑框）+ **强制浅色文字**（浅色母版若用深字会读不出）。

**③ 图片页像素证据（`verify-image.mjs`，两套母版）**：素材真上屏 12~14/14 点达标（中位差 3~4）；全幅压字对比度 标题 **5.38/5.35:1**、图注 **7.72/7.74:1**；媒体区外确为母版底色。

**④ ★ 抓出一个影响所有 `full` 帧的取样时刻缺陷**：页窗口 `[S-0.25, S+3.25]`，**下一页从 `S+2.75` 起淡入** ⇒ `full` 帧必须取在 `[S+2.70, S+2.75)`。原取 `S+2.85` 会混入下一页 ~10–20%，实测把图下半压暗到 0.62 倍（同一页在 2.70s 是 `(218,187,28)`、在 2.85s 变 `(119,99,15)`）。已修 4 处取样时刻并**复跑全部 10 条片**的像素验证 —— 全 PASS。
> **教训**：抽帧校验必须先把"页面独占窗口"算清楚；在转场重叠区取的帧会让任何逐像素判据得出错误结论，**且看起来像渲染缺陷**。

**⑤ 基线 13 → 21 个样例**（见 REPORT §18.4）；母版 CSS 改动后 4 次字节回归全 PASS（新选择器一律带 `.p9`/`.p10` 前缀）。

---

## 16. 补齐"母版 × 几何"矩阵（第九批）

**抓到一个只有竖屏才暴露的真 bug**：竖屏覆盖 `body.p .p9-media { height: 42% }`（给 `left/right` 的顶部横带）
**没给 `full` 单开例外** ⇒ 竖屏 `full` 退化成"顶带图 + 底部文字**压在空底上**"，与 `master.json` 里 `full`=整页 冲突。
修：`body.p .p9--full .p9-media { height: 100% }`。（横屏验得再全也发现不了 —— 横屏本来就是 100% 高。）

**竖屏图片页像素验证（两套母版 × 三版式）**
| 检查 | v1 · 9:16 | v2 · 9:16 |
|---|---|---|
| ① 素材上屏 `left/right` / `full` | **24/24** / 12/12（中位差 3~4） | 24/24 / 12/12 |
| ③ 全幅压字 标题 / 图注 | **9.14 : 1** / **7.91 : 1** | **9.04 : 1** / **11.03 : 1** |
| ④ 媒体区外 = 底色 | ✓（竖屏改判"**下侧**"） | ✓ |

**顺带改进验证器（它差点又给假结论）**：① 探针改**屏幕空间布点**再反查源图 —— 竖屏 `full` 的 cover 裁切 scale≈1.78，
按源图比例布点会**全部越界、一个点都采不到**；② **剔除源图边界处的探针**（5×5 邻域通道极差 >40）—— 压缩在硬边界处模糊，
这条让判据**对真实照片也成立**。

**竖屏 12 页整片**：`out/deck.all12-9x16/` · `out-master-v2/deck.all12-9x16-master-v2/`
= **900 帧 / 36.000s / 720×1280 / bt709+tv**、对账 **0/0/0/0**；图片页 12/12（对比度 9.13/9.07:1）、
图表数据区 334px / 298px，两套各自 **≤±0.4px**。

**字节回归**：手写竖屏母版片重渲仍 `B563588C48F92DF2DE029877DC2A29BB` ✓。

---

## 17. 第五条纪律「声明必须有断言」（第十批）

`master.json` 里每条**声明性**内容都挂一条可执行检查 —— 否则清单会变成"文档里的愿望"
（第九批的竖屏 `full` 退化就是这样：清单声明正确，实现脱节，却无断言能发现）。

**`check-master-manifest.mjs`** 四级断言，**期望值全部从清单读**（脚本里没有任何母版数值）：
| 层 | 断言 | 专抓 |
|---|---|---|
| **L1** 清单 → 元数据 | meta 里每个值 = 清单声明（canvas/pad/plot/padBox/plotTop/bg/ink/rule/barColor/barAlpha/图片矩形…） | **生成器又写死一个值** |
| **L2** 元数据 → 像素 | **复用** `verify-chart.mjs` / `verify-image.mjs`（子进程）+ "声明同带 ⇒ 实测同带" | 像素与声明不符 |
| **L3** 清单自洽 | `full`=满幅、`left/right`≠满幅且贴边、绘图区不越界、`accent↔rgb` 同源… | **为迁就实现而改清单** |
| **L4** 产物 → 清单 | 画布 / 时长=页数×`page` / 帧数 / **PNG 数=页数×2** / yuv420p / tv+bt709 | 产物脱节 · 抽帧静默失败 |

**实测 310 条断言全成立**（L1 124 / L2 16 / L3 114 / L4 56）· `2 母版 × 2 几何` × 8 条片。

**它第一次跑就抓到一个真问题**：v2 竖屏 `left`/`right` 声明同一条媒体带，实测却**差到 max 160**
（差分图上是源图内部边界处的一条竖线 = 整幅图被平移 1px）。根因：`border-right`（左页）/`border-left`（右页）
在竖屏整宽带下各占 1px 内容盒 ⇒ `object-fit: cover` 的图被挪 1px。修后 **160 → 9**（噪声级）。
> 判据用**最大通道差**（≤24）而非"不同像素比例"：平坦图 H.264 逐帧重建本来抖动 ±8（5.6% 像素），
> 而"画偏 1px"是 max≈160 量级。

**双向敏感性自证**：① 改清单 `plot.16:9.h` → `L1` 红；② 改产物 region（模拟 full 退化）→ `L1`+`L3`+**`L2` 像素 67%** 三红。

**顺带提示（不静默）**：9:16 下 `left`/`right` 是同一条带 ⇒ **竖屏"侧向"语义不成立**（处置待 team-lead 定）。

---

## 18. D15：竖屏图片页只保留 `full`（第十一批）

竖屏下 `left`/`right` 是**同一条整宽媒体带**（720×538，实测逐像素同带）⇒ "侧向"语义不成立
⇒ **契约层直接禁掉**（宁可不给选项，也不给"看起来分左右、其实一样"的版式）。横屏保留三版式。

- `validate-deck.mjs`：`9:16` 时 `image.layout` 只允许 `full`，否则报错并建议改 `full`；
- `deck.schema.json`：`pageImage.layout` 描述写明跨字段依赖（真正校验在 validator）；
- 新反例 `deck.bad-image-portrait-left.json` → `exit1/1err/0warn`；
  **契约样例新基线 = 22 个全 PASS，原有 21 个一字未动**；
- `check-master-manifest.mjs`：清单新增 `image.<几何>._allowed`，并断言
  "**产物里的图片版式必须在 `_allowed` 内**"（竖屏出现 left/right 即失败）—— **断言总数 338**；
- 派生样例同步：`deck.img3-9x16(-v2)` 把原 left/right 两页改成 `full` 的两种分支
  （`derive-decks.mjs` 新增 `pagePatch`，仍机器断言"只改声明字段"）；
- `AI-PROMPT.md` + 两套 `PARAMS.md` 写明口径。

**顺带**：清单加 `_allowed` 后重渲 `deck.all12` 仍 `FC467E01…`（不影响画面）。
**彩蛋**：我第一次重渲误传 `--outdir .`，产物落到错目录、`out/` 里还是旧产物（含 left/right）——**新断言立刻判红**（L1 2 条）：
它同时能防"产物陈旧"。

---

## 19. 平台默认值 & 抽帧静默失败（第十二批）

**不依赖平台默认 PATH**：`render-deck.mjs` / `check-master-manifest.mjs` 一律用
`resolveBin('ffmpeg'|'ffprobe')` —— `HYPERFRAMES_FFMPEG_PATH` 存在就**同目录**找同名工具，否则回退 PATH；
**拿不到就大声失败**（新增 `EXIT.MEDIA = 7`），不静默跳过产物校验 / 抽帧。

**抽帧静默失败**：旧代码不看 `spawnSync('ffmpeg')` 的返回值 ⇒ 帧少了也当成功（帧正是"给人看的证据"）。现在：
①每张检查 status；②**独立锚点**——逐张点名 `p<i>-enter|full.png` 存在且非空（不是数目录 PNG 个数：
contact sheet 也在同目录）；③不达标 `exit 7` + 机器可读 `RESULT` 写明缺哪几张。

**故障注入实测**：假 ffmpeg → `exit 5 · render`（hyperframes 先撞上，stderr 直指 "FFmpeg cannot start"）；
预建 `frames/p0-enter.png` 为目录（只坏抽帧）→ **`exit 7 · frames`**：
`抽帧不完整：期望 10 张，缺/空 [p0-enter.png]，ffmpeg 失败 1 次`。
> 注入还抓出我一个 bug：第一版缺帧检查直接 `readFileSync(png)`，遇到**目录**抛 `EISDIR` ⇒ `exit 6` + 裸栈（大声但看不懂）；
> 改 `statSync().isFile() && size>0` 后变成说人话的 exit 7。

**L5 全产物扫描（防"死规则"复活）**：扫描 `out/` 与 `out-master-v2/` 下所有带 `image-meta.json` 的产物目录，
断言每个图片页版式都在其母版/几何的 `_allowed` 内（新渲的片自动被覆盖；顺带防"产物陈旧"）。
**实测 8 个目录 · 16 个图片页 · 24 条断言全过 ⇒ 断言总数 362 条全 PASS**。

**回归**：`deck.all12` 重渲仍 `FC467E0114D84810F1EDF84564B37137` ✓。

---

## 20. 核 `hyperframes-localize-fonts`（第十三批）—— 引擎没有，**且我们的内嵌字体不"自带内容"**

**① 引擎里不存在 `localize-fonts`**（两条独立证据）：`hyperframes --help`（v0.8.111）37 条命令里没有；
整个 `node_modules/hyperframes`（555 文件）grep `localize*` → **0 命中**；内置文档也没有字体主题。
⇒ 字体本地化必须我们自己保证。

**② 真问题：内嵌子集只覆盖 437 个码点，deck 实际文本有 250~277 个汉字不在里面。**
新增 **`check-font-coverage.mjs`**（fontkit 逐字查 woff2 cmap）实测：

| 母版 | 覆盖码点 | 待覆盖字符 | 两套都没有（必然 tofu） |
|---|---|---|---|
| master-v1 | 437 / 437 | 685 | **250** |
| master-v2 | 437 / 437 | 707 | **277** |

缺的是极常用字（供/换/个/起/义/属/声/它/就/以/立/刻/并/须/增/基/准/各/都/方/放/侧/压/亮/区/清…）。
**没被发现的原因**：族是 `"Noto Sans SC", "Noto Sans CJK SC", sans-serif` → 子集缺字时浏览器**回退系统字体**，
而本机 Windows 正好装了 `NotoSerifSC-VF/NotoSansSC-VF` ⇒ 本机正常；**服务器无 CJK 字体 ⇒ 豆腐块且无声**。
敏感性自证：`--extra "龘𠮷🙂𝄞"` → 250→**254** / 277→**281** ✓。

**根因**：`subset-fonts.py` 只扫**母版源码**（中文仅来自注释）+ 安全集，**不含 deck 文本**（运行时才产出）。

**两条修法（需定）**：(A) 静态大子集（常用汉字表 ≈3500 字，重子集化；渲染期零依赖，woff2 约 1~2MB/字体）；
(B) 按 deck 现场子集化（覆盖精确、体积最小，但渲染期新增 python+fontTools 依赖）。
工具链已核实可用（源字体存在 · Python 3.14.4 · fontTools 4.62.1 · pyftsubset 存在）。
**不论选哪个**，该闸门都要当**渲染前闸门**：缺字必须是报错，不是豆腐块。

---

## 21. 共用大子集字体 + 渲染前闸门（第十四批）

**字符集**（`fonts/chars-cmn.txt`，**入库**）：**GB2312 一级字表 3755 字**（可由代码确定性枚举）+ ASCII + 中英标点
∪ 我们全部资产的文本 ⇒ **3926 码点**（11.3KB）。
**新体积**：`NotoSerifSC-sub.woff2` **1376.2KB** · `NotoSansSC-sub.woff2` **1046.6KB**（旧 176.5/133.3KB）。
**唯一一份**：放 `probe-hf/fonts/`，母版清单声明 `fonts{src,files}`，`render-deck` 渲染时拷进产物 assets（缺文件 → `exit 7`）。
**渲染前闸门**：`check-font-coverage.mjs --deck <path>` → 缺字即 **`exit 8`** + 可执行建议（改写/去 emoji/加字表重跑）。
敏感性：全量 **0 缺字 PASS**；`--extra "龘𠮷🙂𝄞"` 精确报 4 个 ✓。

**★ 新闸门当场抓住我一个假结论**：落地后 4 条整片 MD5 变了，我做"换回旧小子集"的判别、得出"字体无关" ——
**但渲染被新闸门拦下（exit 8）而我 `Out-Null` 掉了报错**，比较的是**残留产物**（假结论）。
**独立锚点拆穿**：打印产物 assets 字体大小仍是 1047/1376KB ⇒ 交换没生效。
**真因**：旧片里**有 58~277 个字不在旧子集内**（浏览器回退系统字体渲的）⇒ **MD5 变化是修复的必然结果**；
手写 4 页片与生成器 4 页片（文本本就在旧子集内）**逐字节不变** ✓ —— 变化范围精确。

**新基线（旧值作废）**：all12 `31802910…` / all12-9x16 `AA9577DA…` / all12-v2 `A52ACF60…` / all12-9x16-v2 `71726FE0…`
/ types8 `4F12D535…`；**手写 16:9 `7F1B528D…` 与生成器 4 页 `F1D608EF…` 不变** ✓。

### 21.1 退出码映射（**别把脚本的码当成引擎的码**）
| 调用 | 退出码 | 含义 |
|---|---|---|
| `check-font-coverage.mjs --deck <deck>` | 0 / **1** / 2 | 0=通过 · **1=有缺字** · 2=用法或读取错 |
| `render-deck.mjs <deck>`（内部调它） | **8**（`stage: fonts`） | 渲染入口统一映射为 `EXIT.FONT = 8` + 可执行建议 |

契约承诺的是 **8**；服务端只应看渲染入口的码。**已进退出码回归**：`check-exit-codes.mjs` 新增一格
"deck 含缺字（临时塞 emoji）→ exit 8 / stage fonts / RESULT 可解析"（deck 临时造、用完即删，不污染 examples 基线）。

### 21.2 字体二进制入库口径（team-lead 拍板）
- **woff2 只进一份**，放引擎的 `fonts/`，**随引擎走**；`masters/<id>/assets/*.woff2` 是**构建产物**
  （`fonts/sync-master-fonts.mjs` materialize，不入 git）。
- **服务器零字体依赖**：只需要我们带的两个 woff2，**不装 Noto 源文件、不装 CJK 系统字体**；
  **禁止**在服务器现场跑 `make-fonts.py`（否则绑上"服务器源 TTF 版本"，与坑 28 同类）。
- ⚠️ `dist-rel/` 整体被 `.gitignore` ⇒ `probe-hf/fonts/` 进不了 git，入库要拷到非 ignore 路径（如引擎 `scripts/video-factory/html-deck/fonts/`）。
  已用 `git check-ignore` 核实 `docs/ppt-html-probe/fonts/**` 与 `scripts/video-factory/html-deck/fonts/**` **可入库**。
- 源字体指纹（换机器复现同一份二进制用）：`NotoSerifSC-VF.ttf` 23.97MB `82F7AB38…` ·
  `NotoSansSC-VF.ttf` 16.95MB `504ABDDA…` · Python 3.14.4 · fontTools 4.62.1。详见 `fonts/README.md`。

---

## 22. 证据目录登记（`out/_diag-lr/`）

**是什么**：竖屏 `left`/`right` 媒体带的**左右差分证据**（坑 26 那次"声明同一条带、实测差 1px"的现场图）。
**何时生成**：第十批，修 v2 竖屏发丝描边**之前**（`body.p .p9--left/--right .p9-media` 各占 1px 内容盒把图挪了 1px）。
**内容**：`lrv1-side.png` / `lrv2-side.png`（两页媒体带并排）· `lrv1-diff.png` / `lrv2-diff.png`（`blend=difference` + 提对比度）·
`lrv2-fulldiff.png`（整帧差分）· `lrv2-strip.png`（x=320..400 放大 4 倍，定位那条竖线）· `both-diff.png`（两套母版竖排对照）。
**为什么留着**：安全删除守卫拒过一次 —— **不用删除解决混乱**。要更清楚可挪到 `deck-contract/evidence/`，但挪了也要在此登记。
**看完能得到什么**：`lrv2-diff.png` 上那条竖线 = "整幅图被平移 1px"；修后（见 `check-master-manifest.mjs` 的 L2 断言）最大通道差 **160 → 9**。

---

## 23. **稳定帧契约**（对比度/几何判据的统一基准）

判据不建立在"引擎的任意采样时刻"，而建立在**稳定帧**上。取法（**必须程序化，不许人肉**）：

```
settledAt = min( max(本页入场收尾 = data-start + max(data-at) + 0.6, 页长 × 60%),
                 下一页淡入前 − 0.15s )
```

**断言（违反任一条 ⇒ 红，不许静默回退到别的时刻）**：
1. `settledAt` 必须落在本页 `[start, start+duration)` 内；
2. `settledAt` 距**下一页淡入**（下一页 `data-start`）必须 **≥ 0.15s**。

**为什么不能用 mid-page**：晚入场元素（`data-at` 大的那条）此刻还没出现 —— 实测 `t=16.5` 时结语行区域为空白 ⇒ 误测成 `1.01:1`（真值 `7.26:1`）。

**证据帧必须由闸门当场抽**（从产物 mp4 抽到系统临时目录），并打印**源 mp4 + 抽取时刻 + 帧指纹**；**产物里历史的 `frames/*.png` 不参与判据**（防"拿旧帧当证据"）。

**两条判据同口径**：对比度与溢出都以稳定帧为准 —— 对比度用**元素自身 rect** 在稳定帧上实测；溢出的几何若采样落在**过渡帧**，则须在稳定帧复测（像素无法反推容器几何 ⇒ 闸门明确判红并写出缺口，不静默放过）。

**过渡帧判定**（程序化，全部从产物 HTML 算）：
① 本页入场：`t < start + max(data-at) + 0.6`；② **页尾交叉淡入**：`t ≥ 下一页 data-start`（渲染器 S+2.75 规则；与坑 23 同源 —— 该坑这次出现在**引擎自己的采样器**里）。

---

## 24. 为什么**几何与对比度都以稳定帧为准**（+ 部署闸门档 + 引擎已知风险）

### 24.1 依据（实测数字）
引擎的采样点与**页边界结构性不对齐**（它会在入场淡入 / 页尾交叉淡入的混合帧上取样）。同一套产物的两组数字：

| 档 | 引擎原采样时刻的溢出 findings | **稳定帧**上的溢出 findings |
|---|---|---|
| `out/deck.all12` | 20 | **18** |
| `out-master-v2/deck.all12-9x16-master-v2` | 20 | **14** |

⇒ 原先各有 **2~6 条是过渡帧几何假象**（同一现象在对比度上就是 `p7-concl` 那条 2.53:1 —— 稳定帧实测 7.26:1）。
⇒ 因此：**溢出**用引擎 `check --at <各页 settledAt>` 取回稳定帧几何做判定（原采样时刻的 findings 只当**线索**）；
**对比度**用元素自身 `rect` 在**闸门当场自产**的稳定帧上实测。两套判据同口径，**一处维护**（`timingTable` / `transitionAt` / `settledAtForImpl`）。

### 24.2 闸门归属（谁跑什么，**别混**）
| 闸门 | 内容 | 预算 | 何时跑 |
|---|---|---|---|
| **部署闸门** `--deploy` | 两档（v1/v2 `deck.all12`）check | **≈51s**（实测 50.7~51.5s） | 每次部署 |
| **全矩阵 / 发版闸门** | `check-coverage-matrix.mjs`（≈171s，**独立**）＋ 17 档判据（≈348s） | **≈8.6 分钟** | **发版前必跑**（写进发版清单） |
> 覆盖矩阵**不进部署闸门**（171s ≫ 60s 预算）⇒ 现为**独立闸门**；3 个配色缺口清完后，由**发版路径**调用（不并入部署路径）。
> 排除清单 = `exclude-coverage.json`（**逐条写"目录 + 为什么"**；矩阵强制"被排除的档必须有条目" ⇒ **不许静默排除**）。

### 24.2 部署闸门：**两档** + **唯一入口**
`--at` 稳定帧让**全矩阵**闸门到 **348.2s（17 档）≈ 5.8 分钟** ⇒ **不适合每次部署**。

**唯一入口命令**（`deploy-server.sh` 只调这一条；**别在部署脚本里内联拼参数** —— 改口径会分叉）：
```
node scripts/video-factory/html-deck/check-engine-lint.mjs --deploy
```
内部固定跑**两档**（`--deploy` 里写死，见脚本顶部 `DEPLOY_DECKS`）：

| | 档 | 为什么必跑 |
|---|---|---|
| v1 | `out/deck.all12` | **唯一同时含「图表页 + 引用页 + 图片页」**（12 页 = cover/section/bullets/steps/**chart**/compare/**image**/data/**quote**/toc/summary/end），且**同时命中两条白名单**（`p8-mark` 装饰豁免 · odometer 设计性裁剪）⇒ 覆盖两类判据 + 两类豁免的全部代码路径 |
| v2 | `out-master-v2/deck.all12-master-v2` | **两套母版的 CSS 与判据路径不同**：v2 才走 `p7-concl` 那条"过渡帧→稳定帧复测"、v2 的对比度令牌取值也不同 ⇒ 只跑 v1 会**漏掉整套 v2 代码路径** |

**实测总耗时 = 49.9s**（两档 × `--at` 各 ≈12.7s + 基础 check；**＜60s 预算** ✓；超预算按契约上报 team-lead）。

**分期上线（服务器现状 = 还没有 node/chromium，段 E 推迟）**：
- **第一期（引擎入库即可用，当前状态）**：部署闸门 = `python3 scripts/video-factory/render.py --selftest`（老链路）；
- **第二期（服务器装好 node + chromium + hyperframes 之后）**：**再加**上面的 HTML 两档 check。
> ⚠️ **第二期未就绪** —— 别以为服务器已经在跑 HTML 闸门。

**口径边界（决策 B-3，硬规矩）**：
- **部署闸门 = DOM 层口径**（`--no-render` 生成 HTML ⇒ **没有 mp4** ⇒ 像素复测不做）；
- **完整像素口径 = 本机全矩阵**（17 档，`--at` 稳定帧 + 像素复测）；
- ⇒ **发版前必须跑一次本机全矩阵**（写进发版清单；否则"服务器 PASS"会被人当成完整验证）。
- 部署档的 **`pixel_skipped` 必须 = 0，否则判红**（B-2：降级必须显式且有界，不许长期靠跳过顶包；真出现请上报 team-lead）。

**机器可读前缀表（唯一）**：
| 打印者 | 前缀 | 例 |
|---|---|---|
| `render-deck.mjs`（生成器） | `RESULT ` | `RESULT {"ok":true,"code":0,"stage":"no-render",…}` |
| `check-engine-lint.mjs`（闸门） | `GATE-RESULT ` | `GATE-RESULT {"ok":true,"deploy_no_pixel":true,"pixel_skipped":0,…}` |
> **部署脚本的解析方在找不到期望前缀时必须大声失败**（不许静默回退到别的行、不许"没找到就算过"）。
> ⚠️ **前缀有包含关系**（`GATE-RESULT ` **含** `RESULT ` 子串）⇒ 双保险：
> ① **机器可读行一律从行首匹配**：`^GATE-RESULT ` / `^RESULT `（给解析方的正则就这样写）；
> ② **闸门转发内层（生成器/内层 check）输出时一律加缩进 `  | `** ⇒ 保证「**未被缩进的机器可读行只有一条**（外层 `GATE-RESULT`）」，即使解析方写成"搜 `RESULT `"也不会误配。

**`--deploy` 聚合行 = 稳定契约（解析方长期依赖）**：
```
^GATE-RESULT {"ok":<bool>,"mode":"deploy","decks":<int>,"failed":<int>,"total_ms":<int>,"over_budget":<bool>}
```
**字段名与语义冻结**：`ok`=整体判定 · `mode`=`"deploy"` · `decks`=档数 · `failed`=失败档数 · `total_ms`=总墙钟毫秒 · `over_budget`=`total_ms>60000`。
⚠️ **不许随意改这些字段名/语义** —— 改必须**同步改 `deploy-server.sh` 的解析方并报 team-lead**。
内层（缩进转发）另有两条硬约束（外层回解析内层 `GATE-RESULT`）：**内层 `pixel_skipped > 0` ⇒ 判红**；**内层无 `GATE-RESULT` ⇒ 判红**（"口径漂移"不许静默）。

**入库清单必查项（桥接必死）**：`paths.mjs` 的**开发树桥接分支**（`HERE/../masters`）① 注释标「**搬迁完成后删除**」② **每次运行都打印走了哪一支** ③ 入库清单里列一条「**删除桥接 + 重跑全部闸门**」的检查项 —— 否则它会变成**永久的双路径逻辑**（正是我们一路在防的"两份真源"）。

**引擎侧路径（服务器怎么指）**：
- `ENGINE_HF_BIN=/opt/ppt-render/node_modules/.bin/hyperframes`（**必须显式设**：服务器上没有 `<引擎>/node_modules`，且 `.cmd` 是 Windows 专用）；
- `HYPERFRAMES_FFMPEG_PATH=/usr/local/bin/ffmpeg`（我们已升级的 ffmpeg）；
- 闸门的 hyperframes 解析顺序：`ENGINE_HF_BIN` → `PATH` → 开发回退 `<引擎>/node_modules/.bin/hyperframes[.cmd]`；**全找不到 ⇒ 红 + 打印尝试过的所有候选**（含 platform/cwd）。

**机器可读 RESULT 行（B-1）**：每次运行末行打印
`RESULT {"ok":true,"deploy_no_pixel":false,"pixel_skipped":0,"contrast_findings":1,"overflow_all":18,"overflow_bad":0,"transient_json_failures":0}`
（部署脚本/以后的人据此判断"全口径 or 降级口径"）

### 24.2b 入库布局 = **扁平**（决策 A，覆盖 D14 的旧写法）
```
scripts/video-factory/html-deck/
  README.md  ENGINE-CONTRACT.md  AI-PROMPT.md  deck.schema.json
  *.mjs（check-engine-lint.mjs · render-deck.mjs · validate-deck.mjs · check-*.mjs · verify-*.mjs · derive-decks.mjs）
  masters/{master-v1,master-v2}/
  examples/*.json
  fonts/{*.woff2, chars-cmn.txt, make-fonts.py, sync-master-fonts.mjs, README.md}
```
**即把 `deck-contract/` 这一层去掉** ⇒ 入口字符串 `…/html-deck/check-engine-lint.mjs --deploy` **原样成立**（不带 `deck-contract` 层）。

**两套布局的映射表（唯一权威 · 新增/同步文件时照此，别再猜）**：

| 用途 | 布局 A：**入库树（flat）** | 布局 B：**探针工作树（bridge）** |
|---|---|---|
| 引擎根 | `scripts/video-factory/html-deck/` | `dist-rel/probe-hf/` |
| 契约脚本 / 白名单 / README | **引擎根直属**：`<flat>/check-*.mjs` · `<flat>/allowlist-*.json` · `<flat>/README.md` | `<probe>/deck-contract/check-*.mjs` · `<probe>/deck-contract/allowlist-*.json` · … |
| 母版 | `<flat>/masters/…` | `<probe>/masters/…` |
| 产物 | `<flat>/out*/…`（gitignore） | `<probe>/out*/…` |

⛔ **映射规则：`<probe>/deck-contract/X` ⇄ `<flat>/X`（去掉 `deck-contract/` 这层）**。
> **真实事故（2026-10-03）**：把 `deck-contract/decor-collision.mjs` 写进了**入库树** ⇒ 引擎根里长出 `deck-contract/`
> **冗余真源**（内含文件与根下同名文件 MD5 相同）；**是 ⓪ 根目录白名单守卫把它拦下的**（否则 `git add -A` 会一起入库）。
> **坑清单**：**"布局映射多带一层 ⇒ 引擎根长出冗余真源"** —— 新增/同步文件必须照本表；若 ⓪ 报"多出 N 项"，先查是否多带了一层。
> 原因：`probe-hf/` 多出的那一层是**开发环境的临时层**，不该带进仓库。
> ⚠️ **搬迁风险**：扁平化后 `masters/`、`fonts/` 的相对引用由 `../../` 改为 `../`（这类改动**容易漏**）
> ⇒ **搬迁后必须在引擎新路径内重跑全部闸门 + `--deploy`**（见发版清单）。
> ⚠️⚠️ **代码级必改点（否则"起不来"）**：`render-deck.mjs` 用 `ROOT = resolve(HERE, '..')` + `MASTERS_DIR = <ROOT>/masters`
> （`check-master-manifest.mjs` 同构）—— 扁平化后 `HERE = html-deck/`，则 `MASTERS_DIR` 会算成 **`scripts/video-factory/masters`**（不存在）⇒ 直接失败。
> **必须同步改成 `HERE/masters`**（以及 `fonts/`、`examples/` 的同类引用）。这类改动**编译器查不出来**，只能靠"搬迁后在新路径内跑全闸门"发现。

### 24.3 引擎 CLI 的**已知风险**：JSON 偶发不可解析
实测 17 档批次里出现 **1 次**（`out-master-v2/deck.img3-9x16-master-v2`，同一档单跑 3/3 通过）。
**处置（五道约束，已在闸门实现）**：① 只重试 **1** 次；② 打印 `⚠ 首次调用 JSON 不可解析，已重试`（**不许静默**）；
③ **留证**：不可解析的原始输出（前 400 字）**落盘**并打印路径（`deck-contract/transient-failures/`）；
④ **计数进报告**：每次运行打印 `瞬时解析失败计数`；⑤ **连续两次运行同一档都瞬时失败 ⇒ 红**（防"引擎/环境真有问题"被一次重试掩盖；状态存在 `.gate-transient-state.json`）。
> 服务器上若出现异常，**先看瞬时失败计数**再怀疑产物。

---

## 25b. **退出码分档（所有闸门统一）**：判据失败 vs 输入/环境错误（K16）

| 码 | 含义 | 说明 |
|---|---|---|
| `0` | **通过** | 判据全部成立 |
| `1` | **判据不达标**（红） | 产物/断言本身不满足（真缺陷） |
| `2` | **输入/环境不完整 · 工具/用法错误** | 缺文件/目录、清单解析失败、未知母版、参数错 |

**硬规矩**：闸门**不允许**把"输入/环境错误"表现为 `1`，也不允许抛 **ENOENT 栈**（"崩"和"红"混在一起会同时产生**假红**与**假绿**）。
不完整输入一律 **`exit 2` + 点名缺哪个路径**（例：`✗ 输入/环境不完整（exit 2，非判据失败）：缺母版目录：…`）。
**部署侧解析方**：`2` 视为**基础设施/输入错误**（不是产物缺陷），必须与 `1` 分开处置与告警。
> 教训（K16）：team-lead 复现负向自证时，`--masters-root` 指向**只放了 master-v1 的临时树** ⇒ 脚本 ENOENT 崩溃，读到的 `exit=1` **不是断言触发的** ⇒ **"崩"被读成"红"**。

---

## 25c. **"内容上限"的判据 = 闸门判据（同一套；否则上限不可复核）**

**规矩**：`deck.schema.json` 里任何"内容上限"（如字段 `maxLength`）**必须**用**闸门同一判据**定义 ——
**稳定帧上的 `(text_box_overflow ∪ container_overflow ∪ canvas_overflow ∪ content_overlap)` − (`allowlist-overflow` ∪ `allowlist-overlap`) = 0**，
以 `check-engine-lint.mjs --assert-overlap`（`gate-release` **恒带**此旗）为准；量表的 `measure-sweep.mjs` 用**同一集合**。
**理由（team-lead ③ 抓到的真实分叉）**：闸门原先只判三码，而量表判 `∪ content_overlap` ⇒ **上限用了比闸门更严的判据**
⇒ 会出现"**deck 过闸门、却违反写进 schema 的上限**"，上限就变成一纸声明。
> 设计性重叠 ⇒ 进 `allowlist-overlap.json`（**同构白名单**：`selector` + `reason` + `_evidence.nonDesign`；**无证据不许登记**）。
> **残留差异（明示，不许含糊）**：**采样时刻**不同 —— 闸门在**多个 settle 时刻**聚合，量表按"该字段所在页的稳定帧"单点采样；
> **码集与白名单必须一字一致**，采样时刻的差异属"按页测量"的必要性，须在表里写明该格用的是哪个时刻。

---

## 25f. **交付到服务器（全新克隆）的口径** —— 一条命令 + 依赖解析顺序 + junction 只是本机便利

**唯一命令**（全新克隆 / 服务器首次跑）：
```
npm ci --no-audit --no-fund                 # 用 lockfile 精确还原依赖（引擎依赖随库：package.json + package-lock.json）
node gate-release.mjs --render              # ①先渲"缺产物 / 陈旧"的**声明档** ②再跑全套闸门（逐档打印 render exit）
```
**判据口径（退出码分档）**：`0` = 全绿 · `1` = **判据失败** · `2` = 环境/输入不完整 · **`4` = 需先渲染**（"还没渲染"与"真不合格"必须能区分）。

**渲染器解析顺序**（`engine-bin.mjs` 唯一实现）：① `ENGINE_HF_BIN`（显式钉版本；**指向不存在 ⇒ exit 2，不许静默回退**）→ ② `PATH` 里的 `hyperframes` → ③ 开发回退 `<引擎根>/node_modules/.bin/hyperframes[.cmd]`；全找不到 ⇒ 列出候选并 **exit 2**。
- 服务器推荐显式钉：`ENGINE_HF_BIN=/opt/ppt-render/node_modules/.bin/hyperframes`。
- ⚠️ 本机 `scripts/video-factory/html-deck/node_modules` 是指向 `dist-rel/probe-hf/node_modules` 的 **junction** —— 那是**本机便利**，**不是要求**（探针树不可分发）；服务器上 `npm ci` 后即为真实目录。
- `--deploy` **必须打印**：**解析到的引擎路径 + 来源** · **node 版本/platform** · **chrome / ffmpeg 路径（或"未显式设置"）** —— 服务器排障命门。

---

## 25h. **"同构"的定义（跨树 / 跨机）** —— 逐文件口径 + **列理由的例外**

> **行尾口径（**双面**，2026-10-03 核清，team-lead ②）**：
> · **工作区行尾：CRLF（本机约定）** —— 本机 `core.autocrlf=true` 的检出结果，**不是仓库口径**；
> · **git 索引与服务器克隆 = LF** —— 由仓库根 `.gitattributes` 的 `* text=auto eol=lf` **钉死**（二进制逐类 `binary`）。
> `git ls-files --eol` 实测三份抽样均为 `i/lf w/crlf attr/text=auto eol=lf`。
> ⇒ **本节的通用比较规矩（升级为契约级）**：
> ① **文本文件**比 **行尾归一后的内容**（CRLF/LF 差异**不构成**"两份不同"）—— docs 分叉检查器早已这么做，现推广到所有"是否同一份"的判定；
> ② **二进制文件**（mp4 / png / woff2 / jpg …）比**原始字节**。
> ⚠️ **副作用（写给服务器）**：`git reset --hard` / 全新克隆检出的是 **LF** ⇒ **任何"本机 CRLF、服务器 LF"的行尾假设都不许写进断言**
> （否则服务器必假红）。我们的**漂移守卫 / 分叉检查比的是"本机两棵树"** ⇒ 不受影响 ✓；**产物是二进制** ⇒ 不受影响 ✓。
> ⚠️ **由来 + 择版理由纠正（team-lead ②裁定）**：我曾据本机行尾差异判 v1 `PARAMS.md`"CRLF 版为权威" ——
> 该理由**建立在错前提上**（以为"既有文件都是 CRLF ⇒ 入库树以 CRLF 为准"；实际**仓库权威形式一直是 LF**，`w/crlf`
> 只是本机 `core.autocrlf=true` 的检出产物）。**好在当时两版内容 diff = 0 行，且 git 提交统一归一成 LF
> ⇒ 这次择版对仓库内容无实际影响（无害），但理由错已如实纠正**；本规矩即为防这一类。

**定义**：同一档在两棵树（或两台机）渲出的产物 **"同构" ⇔**
- `output-<deck>.mp4` —— **逐字节相同**；
- `index.html` · `assets/**`（CSS/JS）· 内嵌字体 —— **逐字节相同**。

**例外（打包器嵌**绝对路径**，必然不同；每条必须写理由 —— 否则"例外"会变成"什么都能解释"）：**

| 文件 | 为什么允许不同（理由必填） |
|---|---|
| `reconcile.md` | 对账报告里写的是**产物绝对路径**与抽帧清单（路径随树/机而变） |
| `image-meta.json` | 素材元数据里记录了**源文件绝对路径** |

**已实测证据**：`deck.master-v1` 用当前代码在**两树**重渲均得 `B002C69BB0D2` · `deck.types8-airy` 均 `333A65AE2BBC` ·
`deck.full6` 均 `C60716981550` · `deck.all12-master-v2` 两树既有产物均 `936428BA0ADB`。
> ⚠️ **判"不一致"之前先看新鲜度**（`check-product-freshness.mjs`，闸门 ②b）：**旧产物不是证据**
> （本次 `deck.master-v1` 的"跨树不一致"= 探针侧产物 mtime 22:44 < 输入改动 23:09，**非回归**）。

---

## 25e. **装饰×内容碰撞（`decor_content_collision`）：装饰层只许在内容安全区之外**

**不变量**：母版 `--pad-deco < --pad`；装饰层（进度线/纹理/底衬/动画层）不得压到内容盒；内容（文字/图表/媒体）
必须留在 `--pad` inset 之内。**判据**（唯一实现 `decor-collision.mjs`，闸门与量表**同一模块**）：
在**稳定帧**上，引擎 `text_occluded` 的遮挡者（`containerSelector`，实测定案：隐藏 `.progress` 后该 finding 消失）
命中**装饰白名单**（`allowlist-decor.json`，每条 selector + reason）⇒ 红，码名 `decor_content_collision`；
未命中的遮挡者只进**观察清单**（记录 + 计数），并作为**独立锚点交叉校验**：我们判"无装饰碰撞"而引擎仍报
`text_occluded` ⇒ 打印提醒（**装饰白名单可能不全**）。每次运行打印计数。
> 事故（2026-10-03）：`.progress` 原 `bottom: var(--pad)` 与内容区同边界 ⇒ 封面标题加长时副标行框移到
> 进度线上 ⇒ 金线穿字。修复：`bottom: var(--pad-deco)`；该判据进闸门（`--assert-decor` **恒带**）。
> ⚠️ **一次已纠正的误判（同日）**：曾据 `verify-image` 报的 **1.10:1** 判"9:16 装饰线不得下移" ⇒ **依据是假阳性**：
> `verify-image.mjs` 的"文字行"启发式（行内最亮 >0.72 且**连续 ≥6 行**）把 **2px 进度线 + 抗锯齿 ≈ 7 行**当成了"文字块"，
> 再拿它算对比度。**修判据、不迁就假阳性**：`verify-image` 现加 ①**最小文字高度**（带高 < `--t-tiny` 字号令牌不算文字块）、
> ②**装饰白名单 rect 排除**（几何由 `decor-collision.mjs` 解析 CSS：`--pad`/`--pad-deco` → `.progress` rect）。
> 修后 9:16 **PASS** ⇒ 横竖屏**统一** `--pad-deco = calc(var(--pad) / 2)`。
> 坑清单：**"像素启发式把装饰当内容"**（亮/细装饰须进白名单或加最小高度；同族审计：`verify-chart` 无该启发式，
> `render-deck` 的 `0.72` 是**动效时长常量**、非像素判据）。

---

## 25g. **K19：像素启发式把装饰当内容**（会把自己的守卫假阳性固化成设计约束）

**实例（2026-10-03，7 行 / 2px 线）**：`verify-image.mjs` 找"文字行"的启发式 = 行内最亮 > 0.72 且**连续 ≥6 行**；
`.progress` 的 **2px 装饰线 + 抗锯齿 ≈ 7 行亮像素** ⇒ 被当成"文字块"，再拿它算对比度 ⇒ 9:16 报 **1.10:1 假失败**
⇒ 我据此写了"9:16 装饰线不得下移"并进契约 —— **把守卫的假阳性固化成设计约束**（且当时如实记了"装饰压字风险仍在"，
等于承认没闭环）。
**判据修法（只减少误判对象，**阈值本身不许放松**）**：
1. **最小文字高度**：连续亮带总高 < 该母版**最小字号令牌**（`--t-tiny`，从产物 CSS 解析）⇒ 不算文字块；
2. **显式装饰排除**：装饰白名单（`allowlist-decor.json`）元素的 **rect** 内的亮带不参与文字判据 ——
   几何**复用唯一实现** `decor-collision.mjs`（`decorRects`），不许在验证器里再写一套装饰知识；
3. 两类跳过都**计数并打印**（`跳过非文字亮带：高<16px N 条 · 落装饰 rect N 条`）—— 不静默。
**✓ 复判结果**：修后 9:16 **PASS** ⇒ 那条约束**删除**，横竖屏统一 `--pad-deco = calc(var(--pad) / 2)`。
**同族审计**：`verify-chart.mjs` **无**该启发式；全仓 `0.72` 仅两处 —— `verify-image.mjs`（本次已加约束）与
`render-deck.mjs`（**动效时长常量**，非像素判据）。
**规矩**：**像素启发式（亮行/暗行/连通域）必须能区分"内容"与"装饰"**（最小尺寸 + 装饰白名单 rect），
**且不许为了让它闭嘴而放松它本该把住的阈值**；发现"判据假象绑住设计"时，**先证伪判据**。

---

## 25l. **K20：测量类工具在"输入非独占 / 可被改写"时会给"看起来合理但错"的数**（比崩溃危险）

**现象（2026-10-03）**：同一格（16:9 `.cover-title`）读到 `闸门 exit=1`，而该产物**实际 PASS**（直接跑闸门 = 0）。
**机制（两条候选 —— 必须分开标注，不许合并成事实）**：
- **(a) `shell:true` 把闸门进程拆坏** ⇒ 进程以 1 退出 ⇒ **已证实**（Windows 下 `process.execPath` 含空格；
  `f82686a` 修复：改数组直传 + **解析闸门自打的 `GATE-RESULT`**）；
- **(b) 默认 outdir 被两进程共用** ⇒ **未证实假设**（当时那次读数被**截断**、未观测到该列真值 ⇒ 不能当事实）。
**危险点**：它**不报错** —— 给出的是"看起来合理的数"（比崩溃危险得多），差点让一条已成立的结论被撤回。
**规矩三件套（预防）**：① 默认输出目录**唯一化**（`out-xcheck-<pid>-<时间戳>`）；
② **独占锁 + 存活检测**（`openSync(lock,'wx')`；活进程在用 ⇒ `exit 2` 并明说；陈旧锁 ⇒ 清除+提示）；
③ **测量期防篡改**（**渲染完成即取**产物指纹 `size:mtimeMs`，读完再比对；不一致 ⇒ `exit 2`，不许照常出结论）。
同族纪律：**对拍断言**（两处不许各说各的）· **读回校验**（先过读回再谈读数）· 本条的**读数不许被并发/输入改写污染**。

> ⛔ **元规矩（K20 的"元"，比本条本身值钱）**：坑条目的**"实例"必须标注「已证实 / 未定」**；
> **未证实的归因不许写成事实**。同类前例：把"页边界假阳性"写成"入场淡入"、把 `.p5-num` 当红点、把装饰当文字。
> 本条自身就是一次"未证实归因"——**而且是靠"截断输出"掩盖的**：那次复现把工具输出截到 **126 字符**，正好截在
> `exit` 列之前 ⇒ **从未真正观察到该列真值** ⇒ **"截断输出会隐藏关键列"**一并记为实例（见 §25a：失败输出原样保留）。

---

## 25m. **K21：一次"0 findings"背后是**两条独立缺陷**（先质疑"我看的是不是那一页/那个元素"）

**现象（2026-10-03）**：量表对 `pages.1.items[0]`（检测点 `.t`）跑正控 ⇒ `k=120` **判据 0 条** ⇒ 看起来像"量具坏了"。
**两条**独立缺陷（缺一条都解释不通，故必须分开记）**：
- **A（更深）裸子串找页**：`pageNoOfSelector` 用 `secs[i].includes(cls)` ⇒ 单字母 class `.t` 撞上 `tex` ⇒ 判成**封面页**
  ⇒ 在**错的帧**上看注入的溢出 ⇒ 自然 0 findings。修：class token 匹配（唯一实现 `dom-target.mjs`，含常驻负控 ⓪i）。
- **B（也真）正控 k 太小**：列表项盒子靠**换行撑开**，120 字既不溢出也不重叠 ⇒ 需**逐字段倍增上探**。
  修：正控 `120 → 240 → 480 …`，到 `K_MAX` 仍不触发 ⇒ `exit 2`「该字段正控未证明」并报"上限 > K_MAX"。
  **旁证**：复刻 `k=120` 产物、把首个 `.t` 换成 **300 汉** ⇒ 闸门 **FAIL(1)** 且 `content_overlap ×2` ⇒ 触发点 ≤300。
> **教训（写给任何人，包括我）**：在质疑"容量/阈值"之前，**先质疑"我看的是不是那一页/那个元素"** ——
> 当时 diag 已经打出"页号 = ?"这一行，而我们都在看"判据为什么 0 条"。
> 元规矩（同 §25l）：**未证实的归因不许写成事实**；这次两条缺陷是**分别证实**后才记的。

---

## 25n. **K22：enforced 上限只许一处真源**（"两份 enforced 互相否决"会吃掉测量能力）

**事故链（2026-10-03，K 级）**：enforced 上限曾有**三处真源** —— `deck.schema.json`（契约）·
`validate-deck.mjs`（**手抄** 14 处 `checkString(..., 4, 24, ...)` 加多处 `cp(x) > N`，注释还写"规则严格对齐 schema"）
· `AI-PROMPT.md`（12 处"N 字"）。
> **表象**是"第二路受阻 / 量不出"；**实为两份 enforced 在互相否决**：改契约却不改可执行那份 ⇒ 渲染器按**旧表**拒收。
> 实测：`items[0]` 的 k=164 被 `n > 40` 拦死 ⇒ `render exit=3` ⇒ 第二路三格全"受阻"（**测量能力被吃掉**）。

**规矩**：
1. **可执行那份**（`validate-deck.mjs`）⇒ **一律读 `deck.schema.json`**，按 **JSON 指针**取（`lim()` / `adv()`），
   **不手抄、不按叶名**（叶名会撞车：`pageChart…labels/items` 曾让断言漏报）。判据：`error` 级 = `maxLength`；
   `warn` 级 = `recommendedMax`。**"enforced 松、advisory 紧"是设计**（AI 看到 advisory 会写短，管线不会因
   "写了 300 字签发方"就炸）。
2. **文档那份**（`AI-PROMPT.md`）⇒ `check-schema-vs-limits.mjs` 的 **I5-文档** 断言：文档里每个"N 字"必须是
   某个 schema 约束值（否则陈旧/自造 ⇒ 红）；**观感建议**需**白名单 + 理由**。
3. **双保险**：**I5**（validate-deck 的硬编码必须与 schema 同源，**等级敏感** + **指针守卫**：`lim('#/…')` 指错
   ⇒ 静默变"无上限" ⇒ 红）。
4. **I3 的语义细分**：`judgeLimit=null` 有**两种**情况 —— ① **已测、到 K_MAX 不触发** ⇒ 该字段真无硬上限（有
   `maxLength` 就红）；② **未测**（含**量具缺陷**）⇒ 只是"还没量"，归 `--strict-coverage` 的覆盖清单，**不判红**
   （否则会把"量具坏了"误当"无上限"）。

---

## 25o. **目录层级会影响判据（两层 = 空 findings 假绿）** · **类前缀是位置式的**

```
① 临时产物必须**一层**：`<引擎根>/out-tmp-sweep-kN` ✓ ；`<引擎根>/out-tmp/sweep-kN`（**两层**）⇒ 引擎给**空 findings 的假绿** ✗
   ⇒ 清理只能靠**统一前缀**（`out-tmp-*`，一次 glob 清完），**不能**做嵌套的"单一临时根"。
② 类前缀 `.p6-explain` 是**位置式**（与 deck 内页序绑定）：实测它在 `deck.all12` 里属于**第 5 页**
   ⇒ 选择器**必须从目标 deck 的产物解析**，禁止用 `p6-*` 套"第 6 页"。
③ 临时目录统一前缀还带来一条卫生好处：清理命令只需**一次审批**（带删除的命令会被拦，别与测量捆在一条）。
```

---

## 25a. **报告/日志禁止过滤失败输出**（K15 家族第三次后的硬规矩）

**规矩**：报告与日志里**不许把失败信息过滤掉** —— 命令的 `stderr`/失败原因必须**原样保留**；
确需截断时要**明确标注"已截断"**（并给出可复现命令）。
**理由（三次踩坑）**：① 我用 PowerShell 写坏命令 ⇒ "命令坏了"被读成"零命中"；② 我把 `stderr_tail` 用 `✗|对账` 过滤掉 ⇒ 真正的引擎报错（`'hyperframes' is not recognized`）看不见，白查一轮；③ 反向：只看"看起来的零命中"下结论。
**配套**：任何扫描/闸门的结论必须写**两件事** —— `命令 exit=0` **且** `命中数 = N`（见 K15）。
> 落地：本仓库所有命令输出**保留失败行**；报告贴"关键行 + exit 码"，不贴"筛过的漂亮行"。

---

## 25i. **K18：依赖运行态文件的判据 = 不稳定判据**（team-lead 拍板入坑表）

**事故**：根目录白名单断言把 `.gate-transient-state.json`（**闸门自己每次运行写出的状态文件**）判为"多出的杂项"⇒
**同一份代码，判据随"跑了没跑闸门"而红/绿** ✗。我一度报 `exit=0`、team-lead 复跑得 `exit=1` —— 差别只在**时间窗**
（我先移走文件、之后某次运行又写回；我的那次恰在两个事件之间）✗。
**规矩**：
1. **判据只依赖"源 + 产物"，不依赖"上一动留下的运行态"**；运行态文件必须写在**仓库之外**（本项目 = 系统临时目录 `<tmp>/html-deck-gate/`）；
2. **"上次为什么绿"必须答到时间窗级别**（"当时它恰好不在场"= 时间窗巧合，不是稳定绿）；
3. 新增任何"扫目录/看文件"的断言，**必须先在真源上连跑多次（含"中间跑一次别的闸门"）都绿**才算成立。

---

## 25j. 入库/上线**前置**：依赖必须锁版本（`npm ci`）

- **随库**：`package.json`（显式 `hyperframes` + 依赖 `fontkit`）· **`package-lock.json`**（锁版本；`npm install --package-lock-only` 已跑通 ⇒ 声明的版本范围**可解析**）
- **上线/净环境第一步必须**（否则"本机一套、服务器一套"）：
  ```
  npm ci --no-audit --no-fund                    # 用 lockfile 精确还原依赖
  node check-engine-lint.mjs --deploy            # ⇒ 期望 exit=0
  node gate-release.mjs --whitelist-only         # ⇒ 期望 exit=0
  ```
- ⚠️ **本机这条"干净安装"尚未实跑**（`node_modules` 是 junction ⇒ 只证明"代码路径对"，不证明"依赖齐"；`fontkit` 缺失就是这么暴露的）⇒ 记为**二期净环境必做项**（清单 §3② 有同一份判据）✓

---

## 25k. 两条恢复/同步纪律（K13 事故的直接产物）

1. **`docs/` 同步副本的时序 = "验证通过之后才同步"**：同步副本就是**备份**（K13 里正是它救回了 4 个脚本）；
   若在验证通过前同步，**副本会跟着一起坏** ⇒ 备份失效。契约口径：**同步 = 备份，只在验证通过后做**。
2. **恢复文件后不能只看 `node --check`**：语法通过 ≠ 版本正确（**旧版本也能过语法检查**）。
   必须**逐文件核对"语义版本特征"** —— 该文件应具备的**新逻辑/新字段/新输出行**是否在
   （例：`check-engine-lint` 应有 `GATE-RESULT`/`pixel_skipped`/`settledAt`；`check-master-manifest` 真跑应仍 **PASS 362 条断言**）。

> 关联：**K13**（shell 批量文本手术改坏脚本）· **K14**（闸门输入范围过宽 ⇒ 注释里的符号假红；判据必须建在**产物**上，源码侧只预警）。

---

## 25p. **K23：结构性断言的三条伴随纪律**（"同判据只许一处"这类断言，光加不够）

**背景**：为堵"同一判据两份实现"（K17 的教训），本轮给 `check-schema-vs-limits` 加了
`sameCriterionVerdicts`（调用点计数 + **禁止串表** + **区间抽样**）。落地时暴露三条**通用**纪律：

1. **禁止串表必须"按区间"判**，不能"全文命中就红" —— 因为**纯函数自己就会写出那条文案**
   （本轮内联的"口径不全"文案，纯函数返回值里**也有**）⇒ 全文命中法会把**真源判红** ✗。
   正解：先**自动定位**判据函数的行区间（列 0 函数头 + 大括号配平，**不手写行号**），
   禁止串**出现在区间之外**才算违规。
2. **能力边界必须写明**（否则断言会被读成"已彻底堵死"）：本断言防 **"原样回写"**，
   **不防"等价改写"** —— `const cal = it.capacityAtLeast; if (cap > cal) …`（**别名**）或换措辞写回内联
   ⇒ **抓不到**；彻底堵死需**别名/数据流**分析（成本高，暂不做）。
   ⇒ 口径：**"能抓什么 / 不能抓什么"本身就是可判伪的知识**（与"判据要能失败"同族）。
3. **判据必须同时给"必红样本"与"不许红样本"**（**成对**）：
   **负控防漏报**（该红的没红 ⇒ 判据没接线）· **正控防误报**（不该红的红了 ⇒ 将来有人为让闸门绿而**放宽判据**）
   ⇒ 两者**共同防"判据被放宽"**。实例（`--self-test-synth`，15 例 · 失败 0）：
   旧内联比较/旧推送 ⇒ 必红 · **旧文案落在判据区间内（纯函数合法输出）⇒ 不许红** ·
   同一文案落在区间外 ⇒ 必红 · 区间外比较 ⇒ 必红 · `!== undefined`（存在性检查）⇒ 不许红。

---

## 25q. **负控 / 验证的元纪律**（K23 的配套 · 全部是本轮实测踩出来的）

**事故（我）**：给上述指纹断言做"临时副本负控"时，副本放到了 `out-tmp-ctl/` ⇒ 得到 **`exit=1`（不是 2）** ——
追因：**检查器按自身位置解析真表**，副本换了目录就**找不到表**，失败原因**与判据无关** ✗（**假红**，
差点被当成"负控成功"）。改放**同目录**后：注入禁止串 ⇒ `✗ 判据区间外出现 capacityAtLeast 的比较（L943）` · **exit=2** ✓。

**四条**：

1. **负控必须"同上下文"，且必须核对"为什么红"**：
   `exit 2`=判据失败 · `exit 1`=表/产物违规 · `0`=没红 —— **只看"有没有红"是仪式**（与"哑 catch"同族：
   只看"有没有抛"不看"为什么抛"）。
2. **验证动作必须对着一个"还没被否证"的假设**：否则是仪式。
   （例：team-lead 曾为**一个已被推翻的结论**去复核；我做过一次**多余的文件负控**——合成样本已足够证伪。）
3. **能力缺口的分档规则**（决定"修"还是"挂债"）：
   **命中 1 格且修法通用 ⇒ 直接修** · **1 格但修法专美 ⇒ 挂可见债务** · **≥2 格 ⇒ 必修**。
   新机制（如 `kind:"notExpressible"`）**等到第 2 例**再建 —— 1 例就建机制是**过度设计**
   （正是"机制比用例先到"的反面）；且**两套记账 = 将来对不上**（可见机制 `I10「只记录未断言」` 已够用）。
4. **正例（值得学）**：`measure-count.mjs` L122 明示边界「只支持两层」、L125 `不是数组 ⇒ 停手（不许猜）`
   —— 这不是 bug，**是正控在工作**（拒绝对它不理解的输入做猜测）⇒ 遇到"工具拒绝"先分清
   **"工具坏了"** 还是 **"工具在正确地拒绝"**。

---

## 25r. **K24：编排器不得"只声明意图"**（下游会重派生 ⇒ 上游变量当场失效）

**事故（编排器级真 bug）**：`make-video --palette-index 3 …` ⇒ 报告写 `palette=inkblue`（mono）· `蜜绿`（ecom），
**产物却是母版默认配色**（`final-mono-black-9x16.mp4`，抽帧强调色=近黑 `#111`）。
根因（读码）：
① `batch-video` 对每条**再次派生**（`d.style = {...d.style, masterId, palette, orientation}`），而它的配色**只认自己的旗标**；
② `make-video` 只把配色喂给 `gen-deck`、**没把 `--palette` 透传给 batch-video** ⇒ 下游按母版默认配色重派生
   ⇒ **`--palette-index > 0` 在成片内容上静默无效**（旗标"接受了"，效果却是 0）；
③ 派生档与产物名**不带配色** ⇒ 同一皮肤换索引跑四次**互相覆盖**（报告 n=8 全绿，实际只活 2 条）。

**规矩**：若一个工具把"身份"（皮肤 / 配色 / 方向 / 母版）交给**下游再派生**，它必须
① 把身份**透传**下去；② 在**产物侧回读**同一身份（读**下游真正消费的那份**派生档 / 产物名）；
③ **名字必须含全部维度**（否则跨索引互相覆盖）。
★ 这比"改完要能被读回的证据证明"**多一层**：读回的对象必须是**下游实际用的那份**，**不是自己刚写的那份**。
★ 配套断言（`make-video`）：`[MAKE-PALETTE-MISMATCH]` · `[MAKE-DECK-AMBIGUOUS]`（**0 或 ≥2 都红**，并列出该方向现有档）·
  `[MAKE-NAME-MISMATCH]` · `[MAKE-OUTPUT-COLLISION]`；**负控已跑**（撤掉透传 ⇒ 立刻红并点名现有派生档 ⇒ exit=1）
  —— 断言**可被证伪**，不是装饰。

**附一条同轮教训**：改这段时把一个 `for` 的单行体换成块，变量落在循环外 ⇒ **`node --check` 照样绿**、
**真跑才炸** `ReferenceError` ⇒ **"改完必须真跑一次"对"编辑器改代码"同样适用**（不止改数据）。

---

## 25s. **K25a：宣称的维度必须能被"读数"证实**（且**量尺本身要先被验证** —— 见 §25t K25b）

**数值档（报数口径）**：**ΔE < 10 几乎不可辨 · 10~20 弱 · > 20 明显** ⇒ 报数**按档报**，不许笼统说"32 种观感"。

**修复前 → 修复后（同最近一对 · 用**同一把尺** `palette-distance.mjs --min-de 25` 量的）**：

| 皮肤（最近一对） | 修复前 ΔE76 | **修复后 ΔE76** | ΔRGB(后) | 判定 |
|---|---|---|---|---|
| master-v1（warm-gold ↔ clay） | 19.7（**弱**） | **34.7** | 64.9 | 明显 |
| master-v2（azure ↔ indigo） | 14.3（**弱**） | **25.9** | 67.0 | 可辨 |
| master-mono（graphite ↔ inkblue） | 22.0 | **26.2** | 75.3 | 可辨 |
| master-formal（绛红 ↔ 焦棕） | 24.4 | **36.1** | 35.5 | 明显 |
| master-festive / editorial / tech / ecom | 30.7 / 36.0 / 50.3 / 62.8（**未动**） | 同左 | — | 明显 |

⇒ **修后结论**：**全 8 套最弱 = 25.9（v2）** ⇒ **"8 皮肤 × 4 配色 = 32 组合"站得住**（每套都 ≥ 弱档上限）。
★ **闭环：本条的验收就是量尺本身** —— `node palette-distance.mjs --min-de 25` **当闸门**（`exit 0` = 全达标、
`exit 1` = 不达标并点名）⇒ 从此**配色改动有客观验收**，不再靠肉眼（本次即**按该闸门做过一次真实修复**：
上表 before → after；修复只改**非默认色**、**键名与色相保持一致** ⇒ 不制造"名字与内容不符"）。
（修复前的判断是"只有 v1/v2 明显**弱**" ⇒ **该表述已过期**，以上表为准。）

★ **撤回记录（如实）**：本条**曾**按 **ΔRGB** 写成"**8 套里 6 套是名义维度**"（连带"可辨约 10~12 组合"的报数口径）——
  **那是坏尺的产物**（ΔRGB 对**深色 / 低饱和**配色**天然低估**）⇒ team-lead 用 **ΔE76** 复量后 **4/8 套判定翻转**
  ⇒ 上述"6 套名义 + 10~12"**两处均已撤回**（**仓库知识库里的错结论，比没写更危险** ⇒ 必须显式撤回，不许悄悄改掉）。
★ 可复跑：ΔRGB / ΔE76 两把尺的脚本由 team-lead 持有（**待入库后本表数字即可独立复跑**）。

---

## 25t. **K25b（元纪律）：量尺本身必须先被验证** —— 同一事实用两把不同严格度的尺量，判定不一致处 = 尺的适用边界

**实证（本次）**：**ΔRGB 与 ΔE76 在 4/8 套皮肤上给出相反判定** ⇒ 若直接拿 ΔRGB 下结论，就会**冤枉 4 套皮肤**，
并把一条**错结论写进仓库知识库**（§25s 的撤回记录就是那次）。
★ 与我们既有条目**同族但对象不同**：「**夹具必须能区分两个假设**」讲的是**实验**；本条讲的是**仪器**（量尺 / 判据**本身**）。
⇒ **规矩**：凡"差异类"结论（可辨性 / 观感 / 强弱）**必须** ① 用**感知度量**（ΔE76 / 或像素级同帧比对）；
  ② **换一把尺复量**（不一致 ⇒ 报"**尺的适用边界**"，不许挑一把顺手的）；③ 把"**用哪把尺 + 数值档**"写进结论。
★ 附带（供将来配色自动化避坑）：`master-mono` 默认色 `#111111` **饱和度 = 0** ⇒"同 S/L 旋转色相"是**恒等变换**
  （机械候选四色全等，minΔRGB = 0.0）⇒ 无饱和基色必须换策略（改 S/L 或按"色温"分档）；
  且机械候选的验收**必须用 ΔE76**（ΔRGB 对深色低估：formal 仅 51.2 而 ΔE76 = 24.4）。

---

## 25u. **I9 是"有意的两层"**（能力不同的两层 · 附**可判伪的边界实验**）

**裁定过程（team-lead 的要法）**：I9 此前**两处实现**（`check-syntax-and-json` 的**平衡扫描** + `commit-safe` 的**窄判据**）
⇒ **不靠偏好合并**，先做**可判伪实验**："**造一个窄判据抓得到、宽扫描抓不到**的必红样本"。

**实验（`--self-test` 合成样本 · 零文件依赖 · 新克隆可复跑）**：

```
node check-syntax-and-json.mjs --self-test-i9   ⇒ ✓ 4 例：平衡 / 未闭合 / ★**边界样本（宽判据 depth 仍 0 = 抓不到）** / glob 在字符串里
node commit-safe.mjs --dry --fast               ⇒ ✓ I9 **明细**步（窄判据 · 其 4 条**合成样本**含同一形状 ⇒ 分类正确）
```

**边界样本（合成 · 运行期拼串）**：`/* 说明` + 换行 + ` * 你要写 <闭合符> const y = 2` ——
续行里**引述**了闭合符**且后面还有字**，**其余是合法 JS** ⇒ 外层注释在**那一处提前闭合**，
而"本该闭合"的那一个变成**多余** ⇒ **一多一少相抵 ⇒ 平衡仍成立** ⇒ **宽判据原理上抓不到**（这正是它的**适用边界**）；
而**窄判据**按"续行 + 闭合符 + 有后文"**必红并定格行号**。

★ 两面都改成**运行期拼串**（源码里不出现连续探针）⇒ 与仓库里其它合成样本（哑 catch 分类器 / 区间指纹）**同款**；
   ⇒ 此前那套"`evidence/` 文件 + 豁免 + gitignore"的**三重麻烦整根去掉** ✓
★ **另一处实证（我自己踩的）**：早前版本的复跑命令写着"它**会红**"，可它当时正被**豁免** ⇒ **复跑路径与判据不自洽** ✗
  ⇒ 口径：**判据与它声称的复跑路径必须自洽**（"说好会红"就要能红 ✓）。

**形状**：续行里引述了块注释闭合符，**且它后面还有文字** ⇒ 外层注释在**那一处提前闭合**，而"本该闭合"的那一个
变成**多余** —— **一多一少相抵 ⇒ 平衡依然成立** ⇒ 宽判据在**原理上**抓不到（这正是它的**适用边界**）。

**结论 + 三条纪律**：
1. **I9 是有意的两层**（不是重复实现）：**宽 = 结论来源**（"块注释不平衡"）·
   **窄 = 明细**（"续行引述闭合符"，能**定格到行号**）—— 两者**能力不同**，故都留。
2. 两处**互相引用**：各自注释里写清"谁是谁的兜底"（见两文件内注释）。
3. **样本一律"运行期拼串"**（**不落文件**）：边界样本既能复跑、又**零文件依赖** ⇒ **不需要**任何"扫描面豁免"，
   也不再受 `evidence/`（gitignore）牵连 ⇒ **新克隆即可复跑** ✓
   ★ 早前版本曾走"落一个 `evidence/` 文件 + 豁免它"的路 ⇒ 那会牵出**三重麻烦**：豁免清单 / gitignore / 复跑路径不自洽 ✗；
   team-lead ② 的加强把这条路**整根去掉**（宽判据抽成纯函数 `blockCommentBalance()` + `--self-test-i9` 合成样本）✓

★ 元纪律（与 **K25b** 同族）：**"两处实现该不该合并"是个可判伪的问题，不该靠偏好** —— **先造边界样本，再按能力裁**。

---

## 25v. **K26：交付的最后一步（提交 / 推送）也必须被核对**（只读前一步的 exit 码不够）

**事故（现场留痕）**：`commit-safe --files` 里含**被 `.gitignore` 的文件**（`evidence/…`）⇒ `git add` 报错
⇒ 但**已 add 的留在暂存区** ⇒ **"看起来提交了，其实没提交"**（靠 `git log` 才发现）✗。

**判据（结构性守卫 · 两步缺一不可）**：
① **HEAD 必须前进**（`after ≠ before`）—— 抓"提交根本没发生"；
② **暂存区必须为空**（提交后 `git diff --cached --name-only` 为空）—— 抓"add 了却没进这次提交"。
⇒ 失败 ⇒ `✗ [COMMIT-NOT-ADVANCED]` + **点名原因**。

★ 口径：**闸门说"前置全过" ≠ 提交发生了**（与"改完要能被读回"同族：**凡结论都要有产物侧证据**）。
★ **根因也一并改**：`git add` / `git commit` 的退出码改为"**捕获**"而不是"遇错即 exit"——
  否则守卫**永远没机会跑**（这正是事故里"exit 得太早"的形状）。

---

## 25w. **K27：渲染失败**不得升级为"容量证据"**（幻影容量 = 假绿）

**事故**：`measure-count` 的容量扫描里，某 N **渲染失败（产物缺失）**时，旧实现仍打印
`⏳ 到 N_MAX **未触发任何判据** ⇒ 记 capacityAtLeast: N_MAX` ✗ —— 且**同屏**还有"读数无效 ⇒ exit 2" ✗（**两条结论并存**）
⇒ 这是**幻影容量**（把"**没测到**"当成"**测到能装**"）⇒ 与 **I10「分母不许为零」**同族。

**修法（两条）**：
1. **归因分开**：`渲染失败（产物缺失）`（`counted === -1`）与"切片 / 注入错"（其它 ≠ N）**各自点名**
   —— 此前把渲染失败甩给"注入或切片出错" = **报错原因** ✗（与"核对**为什么**红"同族）。
2. **容量声明作废**：只要有**任何**读数无效 ⇒ **不记 `capacityAtLeast`**，只打一条
   `⛔ 容量声明作废：… 不构成容量证据（幻影容量 = 假绿）` ⇒ **结论单一来源**（与 **K24** 的收紧 ② 同族）。

★ **必红证据（实测）**：`--nmax 10` 的 compare 扫描 ⇒ `✗ 渲染失败（产物缺失）1 行（N=10）⇒ **读数无效** ⇒ exit 2`
  + `⛔ 容量声明作废`，且全文 `记 capacityAtLeast` 出现 **0** 次 ✓

---

## 25x. **K28：校验强度必须"分级 + 明写"**（"弱档"不许沉默，也不许按缺读数**误红**）

**事实现场**：`measured-limits` 的 count 格里，`pages`（页数）格的 `source` 是 **`render-deck`**（不是 `measure-count`）
⇒ `--verify-cell` 的读数核对（`N= … 页内=` 对账）**根本不适用** ⇒ 旧实现报
`✗ 输出里没有 N= … 页内= 行（条数读数缺失）` = **误红**（把"工具不适用"读成"表与实测不同源"）✗。

**修法（两级 + 明写）**：
· **强档**（source = `measure-count`）⇒ **核对读数**（逐行 `页内 == N` + 与 `sweepMax` / `capacityAtLeast` 对账）；
· **弱档**（source 是别的工具）⇒ 只断言"**源可跑通**"（`exit 0` / 无 tag），并**打强度标签**：
  `[VERIFY-CELL-WEAK] <格>：source 工具 = \`X\`（非 measure-count）⇒ **不核对读数**`。

★ 口径：**校验强度是结论的一部分** —— 不许把"弱档通过"读成"读数已核对"（与"结论要带证据"同族）；
  也不许把"工具不适用"判成"表与实测矛盾"（**归因要对** ← 与 **K27** 的"渲染失败 ≠ 切片错"同一条纪律）。
★ **实测**：`--verify-cell pages` ⇒ **exit=0** + `[VERIFY-CELL-WEAK]` ✓ ·
  `--verify-cell pages.7.secondary` ⇒ **强档仍逐项对账** ✓

---

## 25y. **K29：清扫完成后必须补"结构性断言"**（否则第 11 处只靠"人记得"）

**事实**：K17-ff 那批清扫了 **10 处裸媒体工具调用**（measure-limits 2 · verify-chart 2 · verify-density 2 ·
verify-image 3 · verify-masters 1），但**没有断言守着** ⇒ 下一个新工具照样能写裸 `spawnSync` 而无人察觉。
**判据（第 2 层收口）**：`check-syntax-and-json.mjs` 扫描全部 `.mjs`，**裸的媒体工具字面量 = 0** 才绿
（`--self-test-bare-media` 给"必红 / 不许红"样本；**探针分段拼** ⇒ 判定器不自匹配）⇒ 实测
`✓ 裸媒体工具调用 = 0（44 个 .mjs 全走 resolveFfmpeg/resolveFfprobe）`。

★ 口径：**"清扫"是一次性的，"断言"才是常设的** —— 与"纪律要做成断言、而不是靠记得"同族；
  凡做完一轮清扫，**必须**留下"再出现即红"的断言（否则清扫会**缓慢回潮**）。

---

## 25z. **K30：判据也会"误伤真源"** —— 判据要么修，要么**用它自己 sanctioned 的写法绕开**

**现场（我）**：给上面那条断言写**块注释**说明时，被闸门 **⓪c（注释安全）**判红 —— 但我的注释**本身没错** ✗：
⓪c 是**行级朴素扫描**（进入块注释后，任何含"块注释起始符"的行即判红）⇒ 它**误伤了真源**。
它的判据文案里**自带解法**：`命中必须修（引用路径分段写 / **改用行注释**）` ⇒ 我**照它 sanctioned 的写法**改成 `//` 行注释 ⇒ 绿 ✓。

★ 口径：**判据误伤真源时，先看判据自己规定的替代写法**（这类"窄判据 + 明确替代路径"是**可接受**的设计：
  代价是偶尔误伤，收益是零假阴性）；**不要**直接把它塞进白名单了事（白名单是"允许分叉"，会累积 ✗）。
★ 与 **K25b（量尺本身要先被验证）**同族：**判据的适用边界要能被说清** —— 说清了才知道该"改真源"还是"改判据"。

---

## 26a. **K31：扫描器必须对"注释"免疫**（否则**规则的文档会触发规则**）· 且**侦测"裸调用"时要保字符串**

**血现场（活的红 · 全链停摆）**：给 K17-ff 的断言补了一条**说明注释**（注释里写了那个**禁用字面量**，
用来解释"为什么必须走唯一实现"）⇒ 该断言是**朴素文本匹配**（**不解注释**）⇒ **它被自己的文档触发** ✗
⇒ 而 `engine-bin` 是"**导入即自检**" ⇒ **凡 import 它的工具（mux / batch / render-deck …）全部在启动时 exit 2**
⇒ **整条渲染链被堵死** ✗（同族：哑 catch 扫描器把"样本字符串"计入 · ⓪c 把样本字符串计入 —— **自指涉陷阱**）。

**修法（改扫描器，不改文档措辞）**：
1. **抽共享 `maskSource(src, { maskStrings })`**（`engine-bin.mjs` 导出）：把**注释**（及可选：**字符串**）内容换成**空格**，
   **等长替换 + 保留换行** ⇒ **行号不乱**；两个扫描器（K17-ff 的裸调用检查 · `check-syntax-and-json` 的裸媒体检查）**共用** ✓
2. ★ **`maskStrings` 默认 true，但侦测"裸调用"必须传 false** —— 裸调用的**实参本身就是字符串**
   （`spawnSync('<媒体工具>', …)`）⇒ 若把字符串也剥掉 ⇒ **真裸调用反而看不见**（**假阴性**，比假阳性更危险）✗
3. **必红 / 不许红成对样本**：真裸调用 ⇒ 命中 · **注释里出现完整字面量 ⇒ 不许命中**（= 本次假红的**回归样本**）✓
4. **废止旧约定**（"注释里不写完整字面量"）—— **约定不该承担这个责任**，由**扫描器免疫**保证 ✓

★ 口径：**"规则的文档"与"规则本身"必须能共存** —— 判据若把文档管死，作者就会为过闸门而**不敢把规矩写清楚** ✗
  （与 **K30** 同族：判据要么修、要么用它自己 sanctioned 的写法；此处**选"修判据"**，因为**文档更有价值** ✓）。

---

## 22b. 证据目录登记（`tmp-k17/` · `tmp-rendercheck/`）

### 22b.0 总表（team-lead 要求收敛成一张表 —— 以后**只查这里**）

> 📁 **路径已更新（2026-10-03，遵循"根目录白名单"硬要求）**：下表所有测试/证据目录**已移入 `evidence/`** ——
> `evidence/tmp-k17/` · `evidence/tmp-rendercheck/` · `evidence/tmp-flat/` · `evidence/tmp-bright/` · `evidence/tmp-env/`；
> 证据图 `frames-compare-v1-v2.png` 与 3 个瞬时失败留证（`transient-deck.*.txt` · `.gate-transient-state.json`）在 **`evidence/` 与 `evidence/transient-failures/`**。
> 复跑命令里的 `./tmp-*` 请相应改为 `./evidence/tmp-*`；断言：`node gate-release.mjs --whitelist-only`（根目录只许白名单 ⇒ 多一个即红）。

| 目录名 | 是什么 | 何时生成 | 为什么保留 | 复跑命令 |
|---|---|---|---|---|
| `tmp-k17/a/` | K17 断言负向自证：**含标记**的定义副本 | 2026-10-03（断言补强后） | 证明"定义只许一处"**能失败**（期望 exit 2 · 标记 2 · 实质 2） | `node -e "import('./tmp-k17/a/engine-bin.mjs')"` |
| `tmp-k17/b/` | 同上，但**只复制候选数组代码、不带标记** | 同上 | **关键**：期望 exit 2 而**标记=1 · 实质=2** ⇒ 证明断言测**代码实质**、不是"数注释" | `node -e "import('./tmp-k17/b/engine-bin.mjs')"` |
| `tmp-rendercheck/` | "真渲染路径"验证产物（`deck.master-v1`：成片 1948.6KB + `frames/` 8 张 + `reconcile.md`） | 2026-10-03（改过 `engine-bin.mjs` 之后） | K17 教训：部署闸门走 `--no-render` ⇒ 渲染路径**从没被测过**；这是唯一一次真渲染证据 | `node render-deck.mjs examples/deck.master-v1.json --outdir tmp-rendercheck` |
| `tmp-flat/` | `flat` 布局分支工程内模拟（`paths.mjs` 副本 + `masters/` + `fonts/` + `examples/` + `deck.schema.json`） | 2026-10-03（迁移前"不许盲搬"） | `flat` 分支**唯一可跑证据**（搬迁后才发现 bug 的回滚成本高）；且它自带副本 ⇒ 真源仍 `bridge-dev`（隔离性同时成立） | `node -e "import('./tmp-flat/paths.mjs').then(m=>m.selfCheck())"` ⇒ `布局 = flat` · exit 0 |
| `tmp-bright/` | "最亮素材"最坏情况验收（均匀近白 `#F2F0EB` + `deck.bright.json` / `deck.bright-v1.json`） | 2026-10-03（小字令牌整改期间） | v1/v2 最坏情况**双 PASS** 的证据；待转正为常驻闸门资产（独立基线，不动 `check-examples`） | `node render-deck.mjs tmp-bright/deck.bright.json --outdir tmp-bright` + `node check-engine-lint.mjs tmp-bright/deck.bright --assert-contrast` |
| `tmp-env/` | `check-examples` 的 env 冒泡自证桩（`validator-exit2.mjs`，故意 exit 2） | 2026-10-03（K16/K15 家族修法） | 证明 **子进程 exit 2 ⇒ 本脚本 exit 2 + "不是基线回归"**（不许伪装成基线偏离） | `set DECK_VALIDATOR=…\tmp-env\validator-exit2.mjs && node check-examples.mjs` ⇒ 期望 exit 2 |
| `out/_diag-lr/` | 竖屏 `left/right` 媒体带左右差分（见 §22） | 第十批（修 v2 描边**之前**） | 坑 26 现场图；安全删除守卫拒过一次 ⇒ 不删只登记 | 见 §22 |



> ⚠️ 全部**只读保留、不许删**（`Remove-Item -Recurse` 会被审批守卫拦下）；以下各节是**详述**（总表为准）。

**`tmp-k17/`（K17 断言"**能失败**"的负向自证）**
- **是什么**：`a/`（含标记的定义副本 `dup.mjs` + 刷新的 `engine-bin.mjs`）· `b/`（`engine-bin.mjs` + **只复制候选数组代码、不带标记**的 `naked.mjs`）
- **何时生成**：2026-10-03（team-lead 指出"只数注释可绕过"⇒ 补强断言后）
- **为什么保留**：**"能失败"的证据**；`b` 是关键 —— **标记=1 · 实质=2 ⇒ exit 2**，证明断言测的是**代码实质**而不是注释
- **注意**：断言扫描**只读顶层文件（不递归）** ⇒ `tmp-k17/` 不进真源检测（真源恒为 标记 1 / 实质 1 ⇒ exit 0）
- 复跑：`node -e "import('./tmp-k17/b/engine-bin.mjs')"` ⇒ 期望 **exit 2**

**`tmp-rendercheck/`（"真渲染路径"验证产物）**
- **是什么**：`deck.master-v1/`（成片 `output-deck.master-v1.mp4` **1948.6KB** + `frames/` 8 张 + `reconcile.md`）
- **何时生成**：2026-10-03（改过 `engine-bin.mjs` 之后；K17 的教训正是"部署闸门走 `--no-render` ⇒ 渲染路径从没被测过"）
- **为什么保留**：它是**真渲染（非 `--no-render`）** 唯一一次证据 —— **不许删**
- **实测不被计入渲染目标**（不靠推断）：`node check-coverage-matrix.mjs` ⇒ exit=0 · 输出里 `tmp-rendercheck` 命中 **0**、`deck.master-v1` 命中 **0**；代码事实 = 目标枚举 `readdirSync(join(HERE,'examples')).filter(*.json)`

**`tmp-flat/`（`flat` 布局分支的工程内模拟 —— 迁移前必须先证它可跑）**
- **是什么**：`paths.mjs` 副本 + `masters/` + `fonts/` + `examples/` + `deck.schema.json`（后四者只需存在）
- **何时生成**：2026-10-03（team-lead 要求"**不许盲搬**：flat 从没被真实执行过"）
- **为什么保留**：**flat 分支唯一的可跑证据**（搬迁失败会在"已搬完"之后才发现，回滚成本高）
- **实测**：`node -e "import('./tmp-flat/paths.mjs').then(m=>m.selfCheck())"` ⇒ `布局 = flat` · `ENGINE_ROOT/DECK_DIR/MASTERS_DIR/FONTS_DIR/EXAMPLES_DIR/SCHEMA` **全部落在 `tmp-flat` 下** · **exit=0** ✓
- **隔离性**：`tmp-flat/` 自带一份 `paths.mjs` **副本**（`DECK_DIR` = 它自己）⇒ 真源 `selfCheck` 仍打印 **`布局 = bridge-dev`** · exit=0 ✓（**在 tmp-flat 存在的前提下**同时成立 ⇒ 比"删掉再验"更强的证据）
- ⚠️ **未删**：`Remove-Item -Recurse` 被审批守卫拦下（超时取消）⇒ 按"**不许删、只登记**"处理；**它是子目录 + 自带副本，不影响真源**（复跑已证）

## 22c. 有意变更清单（v2 CSS 三处，**不是静默像素漂移**）

| 变更 | 为什么 | 证据 |
|---|---|---|
| `.p8-mark` → `font-size: 34px; line-height: 62px` | 引用页装饰引号是 62×62 块，70px 字形度量盒 70×101 **溢出** | **A/B**：70px ⇒ FAIL（`rect 70×101`）· 34px ⇒ PASS（20/20 全白名单） |
| `--ink-faint` → `--ink-dim` ×3（`.p6-explain`/`.p6-src`/`.p8-context`/两条 `--t-tiny`） | 信息性小字必须 ≥4.5:1；实测 `--ink-faint` = v1 **3.75** / v2 **2.8** ⇒ 真缺陷 | 令牌对账 + 全矩阵复测 17/17 PASS |
| `.ch-tick` → `fill: var(--ink-dim)`（**两套母版**） | 图表刻度是**信息性**小字，原 `--ink-faint` 不够 | 同上；`out/deck.all12` 装饰豁免 1 + 待修 0 ⇒ PASS |

**受影响档（因果）**：两套母版的 CSS 都改过 ⇒ **受影响面 = 含"图表刻度 / 解释来源 / 上下文行 / 数据页次指标 / 引用页装饰引号"页型的档**（`types8` / `all12` / `charttypes` 三族 × 横竖屏 × 两母版）。
**已实测的具体影响**：`deck.all12-master-v2` `73CD8776…` → **`936428BA…`**（产物里 `steel` 出现 **0** 次、`53,104,143` 出现 **0** 次 ⇒ **与 steel 改色无关**，是本清单所致）· `deck.all12-palette-indigo` `9B3838BC…` / `-violet` `1AFC3121…` **未变** · `deck.all12-palette-steel` `178AFD53…` → **`998EA2E6…`**（steel 修色，新值 `#35688f`/`53,104,143` 已注入产物 `index.html` L8 ✓）

---

## 9'. 已知限制（v1）
1. `density` 目前只改 `--pad`/`--gap`，**字阶不随密度变** —— 因为改字号需要把 3~5 条要点 × 三种密度的组合逐一目视验证，未做前不放开（宁可不做也不放任溢出）。
2. 大数字：**整数位滚筒、小数/负号静态**（如 `12.5` 的"."是静态字符）。
3. 页数上限沿用契约的 4~12；`tempo=calm` 下单页仍 3s（时长不随 tempo 变，只变入场节奏）。
4. 不做 OCR，画面正确性依赖人眼看 `frames/`。
5. `style` 的四个可选 palette 只做了"渲染侧生效"验证（两个主题），**另外两个未逐一目视**。
