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
2. **生成**：deck → `deck-page.html`（复用母版的 `master.css` / `master.js` / 内嵌字体 / GSAP）；
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

## 9'. 已知限制（v1）
1. `density` 目前只改 `--pad`/`--gap`，**字阶不随密度变** —— 因为改字号需要把 3~5 条要点 × 三种密度的组合逐一目视验证，未做前不放开（宁可不做也不放任溢出）。
2. 大数字：**整数位滚筒、小数/负号静态**（如 `12.5` 的"."是静态字符）。
3. 页数上限沿用契约的 4~12；`tempo=calm` 下单页仍 3s（时长不随 tempo 变，只变入场节奏）。
4. 不做 OCR，画面正确性依赖人眼看 `frames/`。
5. `style` 的四个可选 palette 只做了"渲染侧生效"验证（两个主题），**另外两个未逐一目视**。
