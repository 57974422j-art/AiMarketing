# AiMarketing 能力清单（AGENT「甲」知识库）

> 用途：AGENT（乙）面对用户时，**先查本清单**确认「项目里有没有这个能力、怎么调」。
> 维护方式：每新增/修改一个工具或接口，就更新本文件对应条目。最后更新：2026-07-23
> 设计定位：本清单即「甲」（项目专家）的知识载体；乙是面对用户的单一 Agent，按需检索本清单后自由调用工具。

---

## 一、资源类（要资源阶段可用）

| 能力 | 接口 / Agent 工具 | 用途 | Agent 现可用 | 备注 |
|------|------------------|------|--------------|------|
| 搜图/搜视频 | `/api/search-images`（agent 工具 `search_web_images`） | Pixabay 免版税图/视频，国内友好 | ✅ | 失败回退 DDG→picsum |
| AI 生文 | `/api/agent/chat` → `generate_copy` | 多平台营销文案（抖音/小红书/快手） | ✅ | 支持风格/字数 |
| AI 生图 | `generate_image` | 文生图（Agnes 主用 + 百炼/硅基兜底） | ✅ | 可带 `refImage` 参考图 |
| AI 生视频 | `generate_video` | 文生视频 | ✅ | |
| 数字人播报 | `digital_human_speak`（需 `imageUrl`） | 形象 + 文案生成口播视频 | ✅ | 需先有形象图 URL |
| 搜素材库 | `search_storage`（→ `/api/media-library`） | 搜个人仓库/公共素材（图/视频） | ✅ | 可按 type/category/source 过滤 |
| 搜模板 | `search_templates`（→ `/api/templates/video`、`/api/fetch-prompts`） | 视频模板 / prompt 模板 | ✅ | |
| 抓取提示词 | `/api/fetch-prompts?type=image\|video\|scene`（admin） | 从站外源抓 prompt 模板 | ⚠️ admin | 另含 `visionClonePrompt` 视觉克隆 |
| BGM | `/api/bgm`(GET 列表) `/api/bgm/ingest`(Pixabay转存) `/api/bgm/upload`(文件上传) | 背景音乐资源 | ⚠️ 部分 | 后续接国内收费音乐 API |
| 趋势视频 | `/api/trendvideo/*` | 热门参考 + 真实抓视频 + 克隆 | ⚠️ | download 抓真实视频依赖 yt-dlp |

## 二、仓库 / 上传类（个人仓库 = 制作素材池）

| 能力 | 接口 | 用途 | Agent 现可用 | 备注 |
|------|------|------|--------------|------|
| 上传文件到个人仓库 | `/api/storage/files`（POST multipart `file`） | 图/视频上传 OSS `storage/{userId}/`，视频自动截缩略图，限 500MB | ❌ **断点** | **AGENT 当前接不住用户上传的图/视频** |
| 登记素材到素材库 | `/api/media-library`（POST `{ossUrl,title,...}`） | 把 OSS 链接登记为 MediaAsset（图/视频），可收藏/分类 | ⚠️ 间接 | auto-compile 产出会调它存库 |
| 个人仓库列表 | `/api/storage/files`（GET） `/api/media-library`（GET） | 列已上传/已登记素材 | ✅(search_storage) | |

## 三、制作 / 成片类（制作空间 = 一键成片）

| 能力 | 接口 / 页面 | 用途 | Agent 现可用 | 备注 |
|------|------------|------|--------------|------|
| 一键成片 | `/api/video/auto-compile`（页面 `/auto-compile`） | 文案+图片自动合成视频，TTS 配音/字幕/多比例 | ⚠️ 未包成工具 | **克隆流程的目标装配点** |
| 文生视频(强) | `/api/video/text-to-video`（页面 `/text-to-video`） | 文生视频，**支持 `refImage` 参考图**、长视频分段 | ⚠️ 未包成工具 | **克隆的最佳发动机**（参考图同源风格） |
| 视频后处理 | `/api/video/post-process` | 剪辑/合成 | ⚠️ | |
| 推送账号 | `/api/video/push-to-account` | 推到绑定账号 | ⚠️ | |

## 四、发布类（到发布阶段）

| 能力 | 接口 / 页面 | 用途 | Agent 现可用 | 备注 |
|------|------------|------|--------------|------|
| 指纹浏览器发布 | `/api/browser/route.ts` + 页面 `/my-fingerprint` | Electron 本地 Chromium 多窗口，抖音/小红书/快手/B站真实发布 | ❌ 仅校验 | agent 工具 `publish_content` 只 `checkAccountBound`，**不真发** |
| 扫码登录 | `/my-fingerprint` 扫码面板 | 用户扫码绑定抖音等账号 | ❌ | 用户自助 |

## 五、账户 / 套餐类

| 能力 | 接口 / 页面 | 用途 | Agent 现可用 |
|------|------------|------|--------------|
| 我的套餐 | `/my-subscription` | 用量/购买/升级 | ⚠️ |
| 工作台 | `/workspace` | 终端用户 6 入口（AI文案/一键成片/个人仓库/套餐/指纹浏览器/...） | ⚠️ |

---

## 六、AGENT 当前真实可调的工具（来自 `src/app/api/agent/chat/route.ts` AGENT_TOOLS）

`generate_copy` · `search_web_images` · `search_storage` · `generate_image` · `generate_video` · `digital_human_speak` · `search_templates` · `publish_content`(仅校验) · `automation_check`

**缺口（本次要补）**：
1. **上传资产工具**：用户贴/传图视频 → 调 `/api/storage/files` 上传 OSS → 登记 `/api/media-library` → 返回可用 URL 供后续步骤引用。**这是当前断点。**
2. **克隆工具** `analyze_and_clone`：参考 → 视觉解析 → 差异化脚本 → 调 text-to-video(带 refImage) → 存媒体库。
3. **真发布工具**：升级 `publish_content` 为真正触发 `/my-fingerprint` 发布。
