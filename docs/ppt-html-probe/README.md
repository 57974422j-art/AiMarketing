# ppt-html-probe（**索引**）—— 探针期文档与证据

> ⚠️ **可执行代码的唯一真源在引擎目录：`scripts/video-factory/html-deck/`**（git 跟踪）
> 本目录**不保存任何可执行代码副本**；只放**人读文档 + 证据快照**。
> **索引断言**：本文件列出的每个路径都必须**存在**且在 `git ls-files docs/ppt-html-probe` 里 ——
> 由 `node deck-contract/check-docs-fork.mjs` 校验（列出已删文件 ⇒ 红）。**改完先跑它，别手写路径。**

## 1. 本目录内容（全部 docs 独有；入库树无同名/同内容对应物）

### 1.1 探针报告与清单
| 路径 | 是什么 |
|---|---|
| `probe-REPORT.md` | 探针期**主报告**（路线选择 / 性能 / 确定性 / 坑表 K1..K18 / 结论速览）· 126.8KB |
| `LANDING-INVENTORY.md` | 入库清单终稿（在库项 / 排除项+理由 / 入库后前置 / 根目录白名单 / 发版闸门用法）· 5.3KB |
| `PALETTES.md` | 在库配色（azure/steel/indigo/violet/clay/mist-blue/olive…）与令牌口径 · 2.7KB |

### 1.2 证据快照（**豁免**分叉不变量；但**豁免 ≠ 免检**：与入库树逐字节相同仍判红）
| 路径 | 是什么 |
|---|---|
| `evidence/_measure.json` | 内容上限实测注入档的**快照** · 10.9KB · **快照日期 2026-10-03 · 判据版本 = 草案**（`(三码 ∪ content_overlap) − 白名单`）⇒ **六字段表落地后由正式表取代，别当现行** |
| `evidence/frames-compare-v1-v2.png` | v1/v2 竖屏媒体带左右差分**证据图**（坑 26 现场）· 793.2KB |

### 1.3 探针期一次性脚本（白名单 `category: experiment`，10 个）
`tools/bench.ps1` · `tools/build-seek-test.ps1` · `tools/build-seek-test.sh` · `tools/codec-check.cjs` ·
`tools/colorspace-test.ps1` · `tools/cs-extra-test.ps1` · `tools/measure-render.ps1` · `tools/subset-fonts.py` ·
`tools/tagtest.ps1` · `tools/verify-seek.ps1`

## 2. 分叉不变量（怎么守）

- **判据**：docs 任一文件 ⇒ **入库树**（`scripts/video-factory/html-deck/`，**只认 git 跟踪**）里必须有对应物（**同名**或**逐字节相同**）；
  **对应物只在 `dist-rel/probe-hf/`（被 `.gitignore` 吞掉、不可分发）⇒ exit 2：先入库，不许删、不许豁免。**
- **豁免**：`evidence/` 子树 与 `.md` 文档。
- **白名单**：`deck-contract/docs-fork-allowlist.json`；条目**必须带 `category ∈ {docs-only, experiment}`**；
  **白名单不许收留"入库树在库文件的旧版本 / 改名快照"**（命中 ⇒ exit 2）。
- **人类参数说明在库**：`masters/master-v1/PARAMS.md` · `masters/master-v2/PARAMS.md` · `cs-test/README.md` · `seek-test/expected.txt` 均在**引擎目录**，本目录**不再留副本**。
- **复跑**：`node deck-contract/check-docs-fork.mjs`（或 `node deck-contract/gate-release.mjs --fork-only`）；退出码 `0`/`1`/`2` 分档。

## 3. 精简记录（2026-10-03）

- **删除 92 个副本**：其中 **88 个与入库树逐字节相同**；**5 个同名但已过期**（附行级证据：旧产物名 `deck-page.html` ×3 ·
  `MASTERS_DIR = join(HERE_V,'..','masters')`（**K12/K13 自造路径 bug**，入库树已修）· `verify-chart.mjs`/`verify-density.mjs` 的旧时间常量）；
  另 **2 份 CSS 为"改名旧快照"**（入库树 `masters/master-v1/assets/master.css` `15DFB9DE…`、`master-v2` `AACD4E8D…`；docs 独有行 = 修色前的 `--ink-faint`）。
- **补救入库 3 项**（原本**只存在于不可分发树**，差一步就丢）：`masters/master-v1/PARAMS.md`（`51BC963F…` · 13.7KB）·
  `seek-test/`（25 文件）· `cs-test/`（21 文件）—— **逐文件 MD5 一致后**才删 docs 副本。
- **如实记录一处我的误判**：`probe-REPORT.md` 我按"≡ 探针树 ⇒ 可删"处理，但那次相等来自**我此前把探针树报告同步进了 docs**；
  `git checkout` 恢复的是 **HEAD 旧快照**（125.4KB · `54468778…`）⇒ 现把**最新版**（126.8KB · `DB1358E6…`）刷回 docs
  （最新内容只在不可分发树里，不刷则克隆者拿不到）。
- ⇒ 分叉不变量：**违反 0**（`node deck-contract/check-docs-fork.mjs` ⇒ exit=0）。
