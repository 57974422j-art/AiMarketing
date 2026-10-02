# deck-contract —— HTML 动态 PPT「AI 侧契约」v1

> 目的：让 AI 产出的是**一整套幻灯片的数据**（JSON），而不是 HTML/CSS。
> 版式 / 动效 / 字体全由母版 `master-v1` 负责；AI 只在契约允许的字段和枚举里填内容。
> 事实基准 = 已经跑通的 `../../master-v1/`（12 秒四页母版）。

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
cd dist-rel/probe-hf/deck-contract
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
cd dist-rel/probe-hf/deck-contract

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

## 25. 两条恢复/同步纪律（K13 事故的直接产物）

1. **`docs/` 同步副本的时序 = "验证通过之后才同步"**：同步副本就是**备份**（K13 里正是它救回了 4 个脚本）；
   若在验证通过前同步，**副本会跟着一起坏** ⇒ 备份失效。契约口径：**同步 = 备份，只在验证通过后做**。
2. **恢复文件后不能只看 `node --check`**：语法通过 ≠ 版本正确（**旧版本也能过语法检查**）。
   必须**逐文件核对"语义版本特征"** —— 该文件应具备的**新逻辑/新字段/新输出行**是否在
   （例：`check-engine-lint` 应有 `GATE-RESULT`/`pixel_skipped`/`settledAt`；`check-master-manifest` 真跑应仍 **PASS 362 条断言**）。

> 关联：**K13**（shell 批量文本手术改坏脚本）· **K14**（闸门输入范围过宽 ⇒ 注释里的符号假红；判据必须建在**产物**上，源码侧只预警）。

---

## 9'. 已知限制（v1）
1. `density` 目前只改 `--pad`/`--gap`，**字阶不随密度变** —— 因为改字号需要把 3~5 条要点 × 三种密度的组合逐一目视验证，未做前不放开（宁可不做也不放任溢出）。
2. 大数字：**整数位滚筒、小数/负号静态**（如 `12.5` 的"."是静态字符）。
3. 页数上限沿用契约的 4~12；`tempo=calm` 下单页仍 3s（时长不随 tempo 变，只变入场节奏）。
4. 不做 OCR，画面正确性依赖人眼看 `frames/`。
5. `style` 的四个可选 palette 只做了"渲染侧生效"验证（两个主题），**另外两个未逐一目视**。
