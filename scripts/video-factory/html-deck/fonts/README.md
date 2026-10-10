# fonts/ —— 内嵌字体（**唯一真源**）与生成口径

> 坑 28 / 第六条纪律：**自带内容的资产必须验证"内容覆盖"**。内嵌字体是子集，缺字时浏览器会**静默回退系统字体** ——
> 开发机（装了 CJK 字体）永远看不出来，**服务器上直接渲成豆腐块**。所以：字体进仓库 + 渲染前闸门。

## 1. 目录里有什么（**入库**的文本资产 + **入库的唯一一份二进制**）
| 文件 | 大小 | MD5 | 说明 |
|---|---|---|---|
| `NotoSerifSC-sub.woff2` | 2462.3KB | `2D7260FEF1DB0D25BAA3625728C10C68` | 衬线子集（标题用）—— **随引擎入库** |
| `NotoSansSC-sub.woff2` | 1841.5KB | `47E799063F8B7F0E56207F145EEA475C` | 无衬线子集（正文用）—— **随引擎入库** |
| `chars-cmn.txt` | 20.1KB | `7402CD96CF7B088FBBA672862F19C7B7` | **字表**（生成字符集，入库；不然以后没人知道覆盖了什么） |
| `LICENSE-OFL-Noto.txt` | — | — | **字体许可**：SIL OFL 1.1 全文 + 字体 name 表里**逐字**取出的版权/许可声明 + 我们的合规口径 —— **必须随字体一起分发**（OFL 第 2 条） |
| `make-fonts.py` | — | — | 生成器（本机可重算同一份二进制，见 §3） |
| `sync-master-fonts.mjs` | — | — | 把共用字体**按需** materialize 到 `masters/<id>/assets/`（幂等 + 字节比对） |

**服务器零字体依赖**（硬口径）：服务器**不需要装任何 Noto 源文件、也不需要装 CJK 字体系统字体** ——
只需要我们带的这两个 woff2（它们随引擎一起走）。**禁止**靠在服务器现场跑 `make-fonts.py`（那会绑上"服务器上源 TTF 的版本"，
与我们拔掉的坑同类）。

## 2. 字符集（`chars-cmn.txt`，6940 个码点 · ★扩表 B 2026-10-10）
> ★为什么扩：用户反复遇到「这字不能用」（「**涮** / 糍 / 粑 / 檐 / 黛 / 匾」…）—— 这些都是**二级字**，
> 却是正经的菜名/地名词。原字表只收「GB2312 **一级** 3755 字」⇒ 撞到就出片失败。
> **实测代价**（同参数只换字符集，脚本 `temp/_fontsize/measure.py`）：
> sans 1046.6→**1841.5KB**（+0.8MB）、serif 1376.2→**2462.3KB**（+1.1MB）⇒ 两份合计 **4.3MB**（本地渲染，无感）。
> 参考：若扩到「CJK 基本区全量 20902 字」= sans 5522KB + serif 7927KB（+10.6MB）——**不值**，除非要做生僻字内容。

1. **GB2312 全集汉字 6763 字**（一级 `0xB0–0xD7` + 二级 `0xD8–0xF7`，低字节 `0xA1–0xFE`，**可由代码确定性枚举**）
   （要换成《通用规范汉字表》等其它表：直接替换 `chars-cmn.txt` 后重跑 `make-fonts.py` 即可）；
2. ASCII 可见字符（`0x20–0x7E`）；
3. 中英标点与常用符号（`、。，；：？！…—～·《》〈〉「」『』（）【】〔〕“”‘’` 等）；
4. ∪ **我们自己全部资产的文本**（母版源码 + `deck-contract/examples/*.json`）—— 让"已存在的东西"覆盖是**构造性 100%**。

## 3. 可复现生成（换台机器也要得到**同一份**二进制）
```bash
# 前置：Python + fonttools；两个源 TTF 必须是下面这两个版本
python -m pip install fonttools==4.62.1
python make-fonts.py
```
| 生成机 | 路径 | 大小 | MD5 |
|---|---|---|---|
| Python | `C:\Python314\python.exe` | Python **3.14.4** | — |
| fontTools | — | **4.62.1** | — |
| 衬线源 | `C:\Windows\Fonts\NotoSerifSC-VF.ttf` | 23.97MB | `82F7AB38C892B1140BAAE7BAF857D364` |
| 无衬线源 | `C:\Windows\Fonts\NotoSansSC-VF.ttf` | 16.95MB | `504ABDDA545478632820C606A577B4A3` |

**换源字体 = 换二进制**：源 TTF 的版本/实例不同，子集化结果就不同 ⇒ 必须用上表指纹核对（或把指纹一起更新）。

## 4. 二进制入库口径（team-lead 拍板）
- **woff2 只进一份，放引擎的 `fonts/`，随引擎走**；`masters/<id>/assets/*.woff2` 是**构建产物**
  （由 `sync-master-fonts.mjs` materialize，**不入 git**）；`render-deck.mjs` 渲染时自动从 `fonts/` 拷进产物 assets。
- ⚠️ 注意：仓库里 `dist-rel/` **整体被 .gitignore**（`.gitignore:63`）⇒ 本目录（`dist-rel/probe-hf/fonts/`）的内容
  **进不了 git**；入库要拷到可入库路径（引擎清单里约定的 `scripts/video-factory/html-deck/fonts/`，或其它非 ignore 位置）。
  已核实：`docs/ppt-html-probe/fonts/*.woff2` 与 `scripts/video-factory/html-deck/fonts/*.woff2` **可入库**（`git check-ignore` 判定）。

## 5. 退出码映射（**必须写清**，否则直接调脚本的人会误判）
| 调用 | 退出码 | 含义 |
|---|---|---|
| `node check-font-coverage.mjs --deck <deck>` | **0 / 1 / 2** | 0=覆盖通过 · **1=有缺字** · 2=用法或读取错 |
| `node render-deck.mjs <deck>`（内部调用上面的闸门） | **8**（`stage: fonts`） | 渲染入口把"缺字"统一映射为 `EXIT.FONT=8`，并给出可执行建议；RESULT 行可解析 |

即：**脚本自身的 1 ≠ 渲染入口的 8**，两者都对；服务端只应看渲染入口的码（契约 `ENGINE-CONTRACT.md` 承诺的是 8）。
