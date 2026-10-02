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
