# 四套配色留证 —— 证明 `style.palette` 真的生效（数值 + 帧两样）

**方法**：用**完全相同的 deck 内容**（只改 `style.palette`）各渲一条 12s / 300 帧，取
① **数值**：底部进度线像素（取色点 `(300,634)` @ t=2.85，2×2 均值，避开居中文字）
② **帧**：各条第 3 页（数据页）的"全就位帧"，拼成 `palette-compare.png`（每格带文字标签）

## ① 数值证据

| palette | measured RGB | expected RGB（CSS 令牌真值） | measured 归一 (g/r, b/r) | expected 归一 |
|---|---|---|---|---|
| `warm-gold` | (158,128, 87) | (200,160,106) | **0.81, 0.55** | **0.80, 0.53** |
| `olive` | (138,141,129) | (168,176,160) | **1.02, 0.93** | **1.05, 0.95** |
| `clay` | (152,110, 94) | (185,140,122) | **0.72, 0.62** | **0.76, 0.66** |
| `mist-blue` | (115,131,155) | (143,163,184) | **1.14, 1.35** | **1.14, 1.29** |

**判读（如实）**：
- **归一化后（= 色相方向）四套与各自令牌真值吻合到 0.06 以内** ⇒ 配色确实落到了 CSS 令牌上，不是"看起来差不多"；
- 四套彼此**显著可分**：`g/r` 从 0.72（clay 偏红）到 1.14（mist-blue 偏蓝），`b/r` 从 0.55 到 1.35 ⇒ 是可区分的四套，不是同一套换名字；
- ⚠️ **绝对值约为真值的 0.80×**（四条几乎同一个系数）—— 这是"2px 细线 + 取 2×2 均值 + H.264 压缩"导致的**系统性偏暗**，**不影响色相判断**，但**不能拿绝对 RGB 当色彩验收**（要绝对色值请用 raw YUV 或渲染整块色块）。
- ⚠️ 本表**只证"配色生效"**，**不评价好看与否**（观感由老板定）。

## ② 帧证据

`out/palette-compare.png` —— 2×2，每格都是**同一个数据页的全就位帧**：
左上 `warm-gold` · 右上 `olive` · 左下 `clay` · 右下 `mist-blue`

## 产物

| 目录 | palette |
|---|---|
| `out/deck.master-v1/` | warm-gold（= 金样例，母版默认） |
| `out/palette-olive/` | olive |
| `out/palette-clay/` | clay |
| `out/palette-mist-blue/` | mist-blue |

每条目录含：`output-palette-*.mp4`（**300 帧 / 12.00s / h264 yuv420p / color_range=tv · color_space=bt709**）·
`frames/p0..p3-enter|full.png`（每页 2 帧）· `reconcile.md`（对账：未命中 0 / 跨页泄漏 0）

## 输入

`examples/palette-{olive,clay,mist-blue}.json` —— 与 `examples/deck.master-v1.json`
**内容逐字相同，只改 `style.palette`**（这样对比才是"只差一个变量"）。

## 复现命令

```bash
cd dist-rel/probe-hf/deck-contract
node render-deck.mjs examples/palette-olive.json
node render-deck.mjs examples/palette-clay.json
node render-deck.mjs examples/palette-mist-blue.json
```
