# AGENT 多模态改造 · 立项文档

> 立项日期：2026-07-23
> 状态：改造进行中（先走到「能产出视频」，发布单独规划）

## 一、目标

把 AGENT 从「纯文本 DeepSeek 大脑（看不到图）」改造成「多模态对话 Agent」：
用户上传参考图 / 视频，用自然语言沟通需求，最终产出成片。

## 二、核心决策（已定）

- **AGENT 大脑 = Agnes 2.5 Flash**
  - 多模态对话：图像 URL 输入 + 图像理解（能"看"懂参考图 / 视频截图）
  - 工具调用（function calling）+ 智能体工作流（agent workflow）：模型可自主规划、编排多步任务
  - 生图 / 生视频走 **Agnes 自家**端点（`agnes-image-2.1-flash` / `agnes-video-v2.0`），与大脑同生态
    → **几乎不触碰我们项目业务模块**，最贴合用户「不调项目模块」诉求
- **分工**：AI 负责页面 / 接口调用编排；用户负责搞定 Agnes API Key（含灰度名单）
- **本轮范围**：聊天（多模态）→ 能产出视频为止；**发布单独规划，暂不接入**

## 三、模型兜底链路（一个一个试）

1. **Agnes 2.5 Flash**（首选，灰度模型，key 须进灰度名单；否则回退 `agnes-2.0-flash`）
2. **Gemini Flash**（备选：需另接生成器——Agnes 或 可灵等外部，生态不如 Agnes 统一）
3. **GPT-4o**（再备选：能生图，视频仍需外部生成器）

原则：**一个模型一个模型试，通了再推进。**

## 四、改造文件清单（一次一文件，改完等确认）

1. `src/lib/ai-providers.ts`
   新增 `agnesChat()`：OpenAI 兼容 `POST /v1/chat/completions`，model = `agnes-2.5-flash`，
   支持 `image_url` 视觉输入 + 可选 `tools`（function calling）。

2. `src/app/api/agent/chat/route.ts`
   大脑从 `deepSeekFunctionCall` 换成 `agnesChat`；
   附件由「URL 字符串」改为「视觉块（image_url）」，让模型真正看到参考素材；
   保留高层工具（generate_image / generate_video 等）供模型编排。

3. `src/app/agent/page.tsx`
   前端：多模态输入（已支持图 / 视频上传）、成片触发 UI（固定按钮或模型驱动）。

4. 发布相关（独立任务，本轮不做）。

## 五、验收（用户测试）

- 上传一张参考图 → 模型能"看到"并据此对话 / 出方案；
- 自然语言要求生视频 → 模型编排调用 Agnes 生视频端点 → 返回成片。
