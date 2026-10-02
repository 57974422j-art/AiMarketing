# 入库清单（LANDING-INVENTORY）

- 日期：2026-10-03
- 来源（开发树）：`G:/AiMarketing/dist-rel/probe-hf/`（**两个源根**：`deck-contract/` 与 `probe-hf/` 下的 `masters/`、`fonts/`）
- 目标（入库后扁平布局）：`scripts/video-factory/html-deck/{ *.mjs, masters/, fonts/, examples/, deck.schema.json }`
- ⚠️ **本文件只在 `docs/ppt-html-probe/` 存一份**（引擎目录不放，避免两份真源）

---

## 1. 入库（应拷）≈ **5.2MB**

| 项 | 细节 | 尺寸 |
|---|---|---|
| `*.mjs` | **18 个**（含 `paths.mjs` · `engine-bin.mjs` · `gate-release.mjs` · `measure-limits.mjs` · `render-deck.mjs` · `check-*.mjs` · `verify-*.mjs` · `derive-decks.mjs` · `inject-long-text.mjs`） | 260.2KB |
| `*.md` | `README.md`（契约）· `ENGINE-CONTRACT.md` · `AI-PROMPT.md` | — |
| 契约数据 | `deck.schema.json`（14.7KB · MD5 `ADF227ADCDB34014903FDD47BF6105C1`）· `allowlist-overflow.json` · `allowlist-contrast.json` · `exclude-coverage.json` | ~30KB |
| 依赖声明 | **`package.json`（显式 `fontkit` + `hyperframes`）· `package-lock.json`（63KB，锁版本；`npm install --package-lock-only` 已跑通 ⇒ 声明范围可解析）** | ~64KB |
| 仓库忽略 | **`.gitignore`（`masters/*/assets/*.woff2` · `out*/` · `evidence/` · `.state/` · `node_modules/`；**不忽略 `fonts/*.woff2`**）** | ~1KB |
| `examples/` | 46 个 `*.json` + `assets/`（2 文件） | 94.3KB + 0.07MB |
| `masters/**` | 母版清单/HTML/CSS/JS/素材（**已扣除字体副本**） | **2.33MB** |
| `fonts/**` | 6 个：`NotoSansSC-sub.woff2` · `NotoSerifSC-sub.woff2` · `chars-cmn.txt` · `make-fonts.py` · **`sync-master-fonts.mjs`** · `README.md` | 2.39MB |

## 2. 排除（逐条理由）

| 排除项 | 尺寸 | 理由 |
|---|---|---|
| `masters/master-v{1,2}/assets/{NotoSansSC-sub,NotoSerifSC-sub}.woff2`（**4 份**） | **4.73MB** | `fonts/` 里是**同 MD5 的唯一份**（`8D644BF273054D44` / `FA5CC24681624A6D` 逐字节相同）+ `fonts/sync-master-fonts.mjs` 自述"按需 materialize 到各母版 `assets/`" ⇒ **构建产物** |
| `out/` `out-master-v2/` `out-demo/` `out-exitcode/` `out-exitcode-drill/` | 257.6MB | 渲染产物（可重生成） |
| `node_modules/` | 116.76MB | 依赖 |
| `evidence/`（`tmp-k17` `tmp-rendercheck` `tmp-flat` `tmp-bright` `tmp-env` `transient-failures` + `frames-compare-v1-v2.png`） | 21.6MB | 测试/证据，本机留档（小文本证据另存 `docs/ppt-html-probe/evidence/`） |
| `out-limits-demo/`（含 `_measure.json`） | — | `measure-limits` 的注入演示目录，每次重跑重造 |
| 临时状态文件（`.gate-transient-state.json` · `transient-deck.*.txt`） | ~0.6KB | 已归入 `evidence/transient-failures/` |

> 口径对账：字体副本曾按 **4.85MB**（1000 进制）记录，实测 **4.73MB**（1024 进制），**结论不变**。

## 3. 入库后前置（**已由机器保证**，不只靠 checklist）

- 母版 `assets/*.woff2` 是 materialize 出来的（库里没有）⇒ **`render-deck.mjs` 在缺字体时自动跑 materialize**（幂等 + 字节比对 + 打印"已 materialize N 个"）；
- 手动兜底：`node fonts/sync-master-fonts.mjs`

**② 依赖（二期前置，必须**先做**、且**可验证**）**
- 本机验收时 `node_modules` 用 **junction** 指向开发树 ⇒ **只证明"代码路径对"**，**不证明"依赖齐"**（`fontkit` 缺失就是这么暴露的）
- ⇒ **服务器/净环境上线前必须先 `npm ci`**（lockfile 已随库：`package-lock.json`，63KB；`npm install --package-lock-only` 已跑通 ⇒ 声明的版本范围可解析）
- 验收命令（净环境，无 junction）：
  ```
  npm ci --no-audit --no-fund      # 用 package-lock.json 精确还原
  node check-engine-lint.mjs --deploy   # ⇒ 期望 exit=0
  ```
  > ⚠️ 本机这一条**尚未实跑**（被审批守卫拦下 `rmdir` junction + `npm ci`）⇒ **如实记为"未验收项"**，由二期在净环境完成 ✓

## 4. 根目录白名单（断言，非 checklist）

- 白名单：`*.mjs` · `*.md` · `deck.schema.json` · `allowlist-*.json` · `exclude-coverage.json` · 目录 `masters/` `examples/` `fonts/` `evidence/`
- 灰名单（允许在场、**明示不入库**）：`out*/` · `node_modules/` · 点目录
- 跑法：`node gate-release.mjs --whitelist-only`（多一个非白名单项 ⇒ **exit 1**；实测：正向 32 项 ✓ / 放一个 `.txt` ⇒ ✗ / 移走后 ✓）

## 5. 发版闸门（唯一入口）

- `node gate-release.mjs` = **全量**（主线清单 + 覆盖矩阵 + 全档判据）实测 **640.5s ≈ 10.7 分钟**（发版必须用这个）
- `node gate-release.mjs --fast` = 日常自查（覆盖矩阵 + 4 代表档）—— **不得作为发版依据**

## 6. 内容上限实测的口径（`measure-limits.mjs`）

- **主数字** = 目标元素自身 `text_box_overflow.overflow` 最大越界（本注入档 **41.58px**）
- **旁证** = `canvas_overflow` 极值（**305.48px**，多元素叠加，不代表该字段被裁多少）
- **像素层独立证据**（真抽帧）：帧差分 max 通道差 **235** · 差异像素 **184509**；**最底 4 行非背景像素：基线 [0,0,0,0] → 注入 [332,337,374,394]（合计 1437）**
- 判据应为 **溢出 ∪ 重叠**（本注入档还报了 `content_overlap`）⇒ 临界表两类都要量
