# AGENT 页客户旅程编排规划（要资源 → 想克隆 → 到发布）

> 状态：规划阶段，尚未改代码（2026-07-23）
> 目标：把 AGENT 页（当前即首页 `/ai-agent` 与 `/`）从「孤立聊天机器人」升级为**客户旅程的执行中枢**——客户在 AGENT 页内一步步直接把「要资源 → 想克隆 → 到发布」走完，而不是被引导跳到各个互不连通的页面。

---

## 0. 当前问题（为什么需要重新规划）

经代码核查，现状是「能力有、链路断」：

| 能力 | 现状 | 问题 |
|------|------|------|
| 资源生成 | Agent 已有 `generate_copy / generate_image / generate_video / search_web_images / search_storage / search_templates / digital_human_speak` | 工具各自为政，没有围绕一个「项目目标(brief)」聚合，用户要自己拼 |
| 克隆 | **Agent 里没有克隆工具**（路线图的 `analyze_and_clone` 未落地）；克隆能力散落在 `fetch-prompts`(视觉克隆提示词)、`trendvideo`、`prompt-templates` | 用户想「照着某条视频做一个类似的」无法在 Agent 内直接完成 |
| 发布 | Agent 的 `publish_content` 工具**只校验账号是否绑定，不真正发布**；真实发布在 Electron 指纹浏览器 `my-fingerprint` 页 | 成片后还要跳出 Agent 去指纹浏览器手动发，链路断 |
| 状态 | Agent 是无状态对话，没有「当前项目/任务」概念，各步产物不沉淀 | 每步重来，无法「上一步选好、下一步继续」 |

核心矛盾：**大量功能模块（素材库、模板、趋势、克隆、成片 auto-compile、指纹发布）已存在，但都没接到 Agent 的执行流里**。

---

## 1. 设计原则

1. **Brief 先行**：一开始就收集「行业/产品/卖点/目标平台/风格/有无参考」，形成一份 `brief` 对象，后续所有步骤都围绕它。
2. **卡片即操作**：Agent 工具返回**结构化 JSON**，前端渲染成可交互卡片（带「用这条」「下一步」按钮），点按钮=执行，不跳页。
3. **渐进式推进**：支持自然语言「下一步」或卡片按钮，Agent 依据「当前项目状态」自动决定走哪一步。
4. **产物沉淀**：每个阶段产物（文案/素材/克隆方案/成片）作为结构化 artifact 存进「项目工作区」，可回看、可复用。

---

## 2. 三阶段编排（直接落在 AGENT 页内）

### 阶段 1：要资源（Resource Gathering）
Agent 基于 `brief` 主动调用**已有能力**，在对话里以卡片汇总：

- 文案：`generate_copy` 生成 / `search_storage(type=copy)` 取素材库已有
- 图片：`search_web_images` / `generate_image` / `search_storage(images)` / `fetch-prompts` 抓图
- 视频素材：`search_storage(videos)` / `trendvideo` 热门参考
- 模板：`search_templates`（prompt-templates）
- BGM：`/api/bgm`（数据库，后续接**国内收费音乐 API** 持续扩充）
- 数字人：`digital_human_speak`

每张卡片带「选这条进下一步」；选完后进入阶段 2。

### 阶段 2：想克隆（Clone）—— 当前最大缺口
复用 `fetch-prompts` 的视觉克隆思路，**新增 `analyze_and_clone` 工具**：

- 输入：用户贴参考链接/视频，或直接从阶段 1 的 `trendvideo` 列表里选一条。
- 处理：调 vision + LLM 解析出「时长 / 分镜结构 / 核心卖点 / 话术风格 / BGM 类型 / 画面基调」。
- 产出「克隆方案」：①差异化新脚本（不是抄，是仿结构做同质内容）②所需素材清单（回指阶段 1 资源）③成片参数。
- 点「生成成片」→ 调 `auto-compile`（脚本 → 视频）。

> 注：`fetch-prompts/route.ts` 已有 `visionClonePrompt` 视觉克隆提示词能力，可作为 `analyze_and_clone` 的实现底座，不必从零造。

### 阶段 3：到发布（Publish）—— 打通真实发布
成片产出后，Agent 调发布流程：

- 选账号：`my-fingerprint` 已绑定的平台账号（当前 `publish_content` 已能列出/校验绑定）。
- 填元数据：标题 / 简介 / 话题 / 封面（可由 `generate_copy` 辅助生成）。
- 真实发布：通过 Electron 指纹浏览器（`browser/route.ts` + `fpStart`）把成片推到抖音。
- 回报状态：成功 / 失败 / 存草稿，Agent 实时回显。

> 现状 `publish_content` 只 `checkAccountBound`，需升级为真正触发 `my-fingerprint` 的发布动作。

---

## 3. 让「直接执行」成立的贯穿机制

1. **项目态（Project State）**：AGENT 页维护一个「当前项目」对象（对话级即可，后续可持久化到 `Project` 表），贯穿三阶段。
2. **工作区画布（Workspace）**：各阶段产物作为结构化 artifact 存入一个可回看的区域（可复用 `dashboard/sop` 思路或新建轻量区）。
3. **工具→卡片映射**：所有 Agent 工具返回结构化 JSON，前端统一渲染成「信息 + 操作按钮」卡片。
4. **快捷推进**：提供「下一步」指令，Agent 依据项目状态自动判断当前该走资源 / 克隆 / 发布。

---

## 4. 分阶段实施建议（待确认后再写代码）

| 阶段 | 内容 | 依赖 | 成本 |
|------|------|------|------|
| **Phase A** | 资源聚合：把已有工具在 Agent 内串成「brief → 资源卡片」，先不新增能力 | 已有工具 | 低，见效快 |
| **Phase B** | 克隆工具 `analyze_and_clone`：核心缺口，复用 `fetch-prompts` 视觉克隆底座 | Phase A + vision/LLM | 中，需新建工具 |
| **Phase C** | 发布打通：升级 `publish_content` 为真实触发 `my-fingerprint` 发布 | Electron 指纹浏览器 | 中 |
| **Phase D** | 项目态 / 工作区画布持久化，做成真正的多步骤工作流 | 前三者 | 高，可选升级 |

---

## 5. 关联文件（实施时必读）

- `src/app/api/agent/chat/route.ts`：当前 Agent 工具注册处（加 `analyze_and_clone`、升级 `publish_content`）
- `src/app/ai-agent/page.tsx`、`src/app/page.tsx`：AGENT 页 UI（渲染卡片、项目态）
- `src/app/api/fetch-prompts/route.ts`：`visionClonePrompt` 视觉克隆底座
- `src/app/auto-compile/`：脚本→成片流水线（阶段 2→3 衔接）
- `src/app/my-fingerprint/`、`src/app/api/browser/route.ts`：真实发布（指纹浏览器）
- `src/app/api/bgm/`、`src/app/api/bgm/ingest`、`src/app/api/bgm/upload`：BGM 资源（后续接国内收费 API）
