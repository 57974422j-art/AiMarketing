# cs-test —— 色彩标签实验（"声明 vs 转换"）证据目录

> 由 `probe-html` 于 2026-10-02 生成。脚本：`../colorspace-test.ps1`、`../cs-extra-test.ps1`
> **本目录是"给服务器段E 复跑用"的自描述证据集**：每个文件的标签、真实像素、两种解码结果都写在下面。

## 0. 采样口径（复现用）
- **raw YUV**：`ffmpeg -ss <t> -i F -frames:v 1 -vf "crop=2:2:8:8,format=yuv420p" -pix_fmt yuv420p -f rawvideo -` → 前 4 字节是 Y，后 2 字节是 U、V
- **角落 RGB**：`ffmpeg -ss <t> -i F -frames:v 1 -vf "crop=160:160:8:8,scale=1:1" -pix_fmt rgb24 -f rawvideo -`（避开居中的文字框）
- 期望值：源色是 RGB(0,160,0)（绿）。理论 luma：**BT.601 → 96.7**；**BT.709 → 114.3**

## 1. 三个源 / 三种处理

| 文件 | 怎么来的 | ffprobe 标签 | **角落 raw YUV** | 真身 |
|---|---|---|---|---|
| `cs601.mp4` | 3s 绿段，源 `color=0x00A000` **用 smpte170m 编码**（`-colorspace/-color_primaries/-color_trc smpte170m -color_range tv`）→ 3 段 `concat -c copy` | `tv, smpte170m` | **Y=97** U=81 V=69 | **真身 BT.601** ✅（97 ≈ 96.7） |
| `decl-only.mp4` | 由 `cs601.mp4` **再编码**，只加声明 `-colorspace bt709 -color_range tv`（**无** scale 转换） | `tv, bt709` | **Y=113** U=74 V=64 | 像素**已被转换**成 BT.709（113 ≈ 114.3） |
| `convert.mp4` | 同上，但用 `-vf "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p"` + 同样声明 | `tv, bt709` | **Y=113** U=74 V=64 | 与 `decl-only` **逐字节相同**（86981 B） |

**结论 1**：在 **ffmpeg 8.1** 上，"再编码时只写 `-colorspace bt709`"**会真的转换像素**（Y 97→113），不是只写元数据。⇒ 所以"只声明不转换"这句机制描述在 8.1 上**不成立**。
**结论 2**：显式 `scale=out_color_matrix=…` 与"只声明"**输出完全相同** ⇒ 显式转换写法**零额外代价**，保留它是**防御性**（不依赖版本/滤镜链/像素格式行为）。

## 2. ⚠️ 但"只声明不转换"**确实存在一个可达状态**：`-c copy` 重封装

| 文件 | 怎么来的 | ffprobe 标签 | **角落 raw YUV** | 浏览器渲染（经 HTML 线） |
|---|---|---|---|---|
| `remux-declared.mp4` | `ffmpeg -i cs601.mp4 -c copy -colorspace bt709 -color_range tv …`（**只重封装，不求编码**） | **`tv, bt709`** | **Y=97** U=81 V=69（**与 cs601 完全相同 = 仍是 601 像素**） | **(0,158,1) —— 正确** |

**结论 3（重要）**：`-c copy` **不可能**转换像素，所以这条路径确实产出了"**标签说 bt709、像素是 601**"的错标文件 —— 即"只声明不转换"是**可达**的（同一 ffmpeg 版本内，不必等老版）。
**结论 4（意外）**：这个错标文件在 **ffmpeg 解码**和 **Chrome 渲染**下**都得到了正确颜色**（不是预期中的 ~(0,132,0) 偏移）。
**推断（未完全证实）**：MP4 的色彩标签有两份来源 —— 容器 `colr` atom 与 H.264 码流 **VUI**。`-c copy` + `-colorspace` **只改了容器 atom**，码流 VUI 仍是 smpte170m；`ffprobe` 报的是容器 atom（bt709），而**实际解码器（ffmpeg 的 scale 与 Chrome）用的是码流 VUI（601）**，所以颜色正确。
⇒ **也就是说：`-c copy` + 声明 主要坏在"元数据自相矛盾"（ffprobe 会被误导），在这个测试里对实际出画是**惰性**的。**

## 3. 10-bit 边界（srv-env 提到的像素格式）

| 文件 | 标签 | 角落解码 RGB |
|---|---|---|
| `ten601.mp4`（真身 601，`yuv420p10le`） | `tv, smpte170m` | (0,161,0) |
| `ten-decl.mp4`（10bit 再编码 + 只声明 bt709） | `tv, bt709` | (0,161,0) |

未测 10bit 的 raw Y（10bit 需按 2 字节小端解析），所以**"10bit 下声明是否同样触发转换"未证实**——留给服务器段E 或后续。

## 4. ⚠️ 方法论修正（给我自己也给复跑的人）
**不要用"角落 RGB 读数"判断标签问题** —— 见结论 4：`remux-declared.mp4`（标签 bt709、像素 601）经 ffmpeg 解码得到的是 **(0,161,0)** 而不是理论偏移值 → RGB 读数在"容器/码流标签打架"时会给出误导性结果。
**判定标签问题请用**：① **raw YUV 对比**（能直接看出像素有没有被改）；② **浏览器渲染**（那才是我们真正关心的解码器）。RGB 读数只适合"同一标签体系内的色彩偏移"测量。

## 5. 给服务器段E 的输入
**做"旧 ffmpeg vs 新 ffmpeg"的版本边界对比，请用 `cs601.mp4` 作为输入**（真身 601，已在此目录）：
```bash
# 在旧/新 ffmpeg 上各跑一次"只声明不转换"，然后比 raw Y
ffmpeg -v error -y -i cs601.mp4 -c:v libx264 -crf 18 -pix_fmt yuv420p -g 25 -an \
  -color_range tv -colorspace bt709 -color_primaries bt709 -color_trc bt709 decl-<ver>.mp4
ffmpeg -v error -y -ss 1.5 -i decl-<ver>.mp4 -frames:v 1 -vf "crop=2:2:8:8,format=yuv420p" \
  -pix_fmt yuv420p -f rawvideo - | xxd -l 6
```
判读：**Y≈97 ⇒ 未转换（"标错标签"成立，你的保留升级为"必须"）；Y≈113 ⇒ 已转换（保留降级为纯防御项）**。
本机 ffmpeg 8.1 的结果是 **Y=113（已转换）**。

> `probe-seek.bak2.mp4` / `probe-seek.orig.mp4` 是我在渲染测试前后做备份用的源素材副本，与色彩实验无关。
