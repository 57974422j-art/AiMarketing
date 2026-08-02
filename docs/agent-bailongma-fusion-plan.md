# BaiLongma 融合进 AiMarketing AGENT — 实施方案文档

> 创建：2026-08-02
> 来源：`vendor/BaiLongma/BaiLongma-main/`（用户手动下载放置）
> 目标：把 BaiLongma 的「功能 + 页面效果」融合进 `/agent`，而非仅 TTS。

---

## 一、用户明确的范围（来自对话）

- ✅ 要 BaiLongma 的**整体功能与页面效果**，不只是语音 TTS。
- ❌ 不要「足球 / 台风播报」那类噱头（属于它的私有定时播报业务，与营销 SaaS 无关）。
- ✅ 其余功能都要。
- TTS：我们后台**已接入火山 TTS**，直接复用，不重复接。
- 客户端更新：能用纯服务端/网页实现的，尽量不碰 Electron；必须客户端的再说。

---

## 二、BaiLongma 能力清单 × 是否融合（逐项判定）

| 模块 | 文件 | 是什么 | 融合？ | 理由 |
|------|------|--------|--------|------|
| 常驻主循环 | `main.js` `loop()` | 桌面常驻、自主 heartbeat | 部分借鉴 | 我们跑在服务器 Next.js，无"常驻进程"概念；改用**服务端定时任务 / automation** 实现主动推进 |
| 长期记忆 | `ai/memory/manager.js` + `memory/store.js` | 记忆检索/整合/唤起/降级 | ✅ 融合 | 我们的 AGENT 目前无状态，借鉴它的 MEMORY 工具集，用 Prisma 加 `AgentMemory` 表 |
| 自主心跳 Tick | `ai/scene.js` `tick` | 主动唤醒、做任务 | ✅ 借鉴 | 用我们已有的 automation 能力做"主动提醒/推进发布队列" |
| 工具系统 | `ai/tool-registry.js` `tools/*` | 50+ 工具声明式注册 | ✅ 借鉴模式 | 我们的 AGENT 已有 function calling，补齐 publish/list/搜索等工具 |
| 声纹语音环 | `voice/voice-continuous.js` `ptt.js` `wake.js` | 按住说话/唤醒词/连续语音 | ✅ 融合 | 你最早要的诉求：AGENT 可语音输入+输出 |
| 流式 TTS 输出 | `voice/tts-providers.js` `audio-output.js` `tts-fx.js` | 朗读+音效+打断 | ✅ 融合 | **复用我们火山 TTS**（`volcanoTTS`），加 Jarvis 音效 + 打断预缓冲 |
| 云端 ASR | `voice/cloud-asr.js` | 浏览器采 PCM→代理云端 ASR | ✅ 融合 | 需服务端 WS 路由中转（详见第四节） |
| 思考流可视化 | `ui/brain-ui/thought-stream.js` | 推理/工具调用实时流式展示 | ✅ 融合 | 升级 AGENT 对话体验，工具调用时显示"思考中" |
| Scene Protocol 投影 | `ai/scene.js` `ui/agent-ui/*` | Agent 用 JSON 投射原生 UI 卡片 | ✅ 融合 | 用于"引导客户发布"的表单/进度/账号选择面板（替代纯文字引导） |
| Brain UI 认知地图 | `ui/brain-ui/*` | 节点物理布局、热点、认知可视化 | ⚠️ 借鉴观感 | 重（Canvas 力导向图），先借鉴 dark 科技风样式，核心"认知地图"可后续做轻量版 |
| 微信连接 | `tools/wechat.js` | 微信渠道收发 | ✅ 融合（若项目需要） | 见第三节 |
| 飞书连接 | `tools/feishu.js` | 飞书渠道收发 | ✅ 融合（若项目需要） | 见第三节 |
| 文件读写 exec | `tools/file.js` `tools/exec.js` | 读写本地文件 / 执行系统命令 | ⚠️ 受限（见第四节） | "调用"而非"编写"；涉及服务器安全，慎接 |
| 台风/世界杯播报 | `agents/broadcast/*` | 定时热点播报 | ❌ 不要 | 噱头，与营销无关 |
| 音乐生成/歌词 | `tools/music.js` `tts-fx` 音乐 | 生成音乐/歌词 | ⚠️ 可后续 | 非核心，先不做 |

---

## 三、三个澄清问题的回答（用户提问 → 结论）

### Q1. 真实终端流是什么？
BaiLongma 的「真实终端流」= `exec_command` / `exec_quick_command` / `exec_task_command` / `exec_background_command` + `terminal_stream` 窗口。
- 它是 **Agent 调用系统命令在宿主机执行**（如跑测试、构建、安装、抓网页），并把命令输出以流式进度窗口（`terminal_stream`）实时显示给用户。
- 本质是**真在机器上跑 shell**，不是模拟。它有一套 risk 分级（high/medium/low）和权限确认。
- 我们项目里**已有类似能力**：`src/app/api/devices/[id]/execute/route.ts`（设备执行）、`src/lib/automation-providers.ts`。
- 判定：**有安全风险**（在服务器上跑任意命令），融合时只暴露"受控命令"（如跑我们的发布脚本、yt-dlp），不开放裸 shell 给用户。

### Q2. 微信 / 飞书 和项目正相关吗？
- 我们项目**检索到** `feishu`/`wechat` 出现在 15 个文件，但都是**支付/订单/分享/登录回调**层面（如 `payment-alipay`、`referral`、`login`），**没有"Agent 通过微信/飞书对话"的渠道接入**。
- BaiLongma 的微信/飞书是"把 Agent 挂到这些 IM 上当机器人，用户从 IM 发消息、Agent 回消息"。
- 判定：**与营销 SaaS 正相关，但属"增值渠道"**。优先级低于语音环/思考流/Scene 投影。建议作为**阶段四**（把 AGENT 对话能力通过 webhook 接到微信公众号/企业微信/飞书，复用现有对话内核）。不阻塞前三个阶段。

### Q3. 文件 exec 主要看怎么用——编写还是调用？
- 结论：**调用，不是编写**。BaiLongma 的 `tools/exec.js` 是 Agent 决策后**调用**宿主机的命令/脚本（编写逻辑在 Agent 大脑里用 LLM 生成命令字符串，再 exec 执行），它本身不"编写文件"去持久化代码，而是执行。
- `tools/file.js` 才是"读写文件"（写配置、记笔记）。
- 对我们：融合时**只复用"调用我们已有脚本"**（如触发指纹浏览器发布、跑 mediacrawler 采集），**不开放任意文件写/任意命令执行**给用户，避免服务器被控。

---

## 四、融合实施路线（阶段划分，逐步做、每步汇报）

### 阶段一 · 语音环（AGENT 可语音输入 + 输出）— 不动 Electron
1. **TTS 输出**：前端 AGENT 页加「🔊 朗读 / 自动朗读」；复用 `volcanoTTS`（`ai-providers.ts`，已接火山）。
   - 现有 `/api/tts` 走 Qwen3→火山兜底，但返回 mp3 URL 非流式；AGENT 直接调 `volcanoTTS` 流式更好，或新增 `/api/agent/tts` 返回音频流。
   - 加 `tts-fx.js` 的 Jarvis 音效（开始/结束提示音）+ 打断预缓冲（`/tts/interrupted`）。
2. **ASR 输入**：浏览器 `getUserMedia` + `AudioWorklet` 采 16kHz PCM → 新增服务端 WS 路由 `/api/agent/asr`（Next.js + `ws` 依赖），服务端代理火山/阿里云 ASR（复用 `cloud-asr.js` 签名逻辑）。
   - 需服务器 `npm i ws` + 配 ASR key。
   - 提供语音悬浮球（voice-orb）、按住说话 / 唤醒词两种模式（复刻 `voice-continuous.js` / `ptt.js` / `wake.js`）。
3. 部署：服务端改动走标准三步；**客户端无需更新**。

### 阶段二 · 思考流 + Scene 投影卡片（页面效果升级）
1. 复刻 `thought-stream.js`：AGENT 调用工具（生图/生视频/查账号/发布）时，实时显示流式"思考/执行中"条，而非干等。
2. 复刻 Scene Protocol（`ui_set` 幂等 set）：让 AGENT 返回结构化 JSON，前端渲染成原生 UI 卡片——发布表单、账号多选、进度条、成片预览，而不是纯文字。
3. 借鉴 Brain UI dark 科技风样式，统一进 AGENT 页。

### 阶段三 · 长期记忆 + 主动心跳（借鉴模式，不搬常驻进程）
1. Prisma 加 `AgentMemory` 表（mem_id / content / salience / links / visibility / embedding 可选）。
2. AGENT 工具补 `search_memory` / `upsert_memory` / `recall_memory`，借鉴 `memory/manager.js` 的检索-整合-唤起-降级。
3. 主动推进：用我们 automation 能力 + BaiLongma tick 思路，做"发布队列到点自动推进 / 主动提醒"。

### 阶段四 · 微信/飞书渠道（增值，可选）
- 把 AGENT 对话内核通过 webhook 接到微信公众号/企业微信/飞书，复用阶段一~三能力。不阻塞前期。

### 阶段五（可选）· 轻量 Brain 认知地图
- 借鉴 `brain-ui` 力导向图，做 AGENT 记忆/任务节点可视化。重，放最后。

---

## 五、关键技术约束（必须遵守）
- **TTS 直接复用** `src/lib/ai-providers.ts` 的 `volcanoTTS`，不重接火山。
- **ASR 必须服务端中转**：浏览器原生 WS 不能加鉴权头，新增 `/api/agent/asr` WS 路由。
- **文件 exec 只暴露受控命令**：不开放裸 shell / 任意文件写，复用 `devices/[id]/execute` 与 `automation-providers` 的已有受控执行。
- **客户端（Electron）尽量不碰**；只有语音必须走 Electron 本地 WS 时才更新（目前方案阶段一走服务端 WS，客户端不动）。
- 每阶段改完汇报，等确认再进下一阶段（符合项目"按功能步骤分批修改"纪律）。
- 服务器部署口令固定：`cd /root/AiMarketing && git pull origin master && npm run build && pm2 restart aimarketing`（涉及新依赖时先 `npm i`）。

---

## 六、待用户提供（阻塞点）
- **ASR Key**：火山方舟 / 阿里云 ASR 的 appId+accessKey（TTS 已用火山，ASR 建议同家用火山，一家搞定）。没 Key 阶段一 ASR 先留配置位，TTS 朗读可先用。
- 是否要阶段四的微信/飞书（决定优先级，不阻塞）。

---

## 七、源码对照速查（vendor 内）
- 语音采集：`src/voice/voice-continuous.js`, `ptt.js`, `wake.js`
- ASR 代理：`src/voice/cloud-asr.js`
- TTS：`src/voice/tts-providers.js`, `tts-fx.js`, `audio-output.js`
- 思考流：`src/ui/brain-ui/thought-stream.js`
- Scene：`src/ai/scene.js`, `src/ui/agent-ui/*`
- 记忆：`src/ai/memory/manager.js`
- 工具：`src/ai/tool-registry.js`, `src/tools/*`
- Brain UI 观感：`src/ui/brain-ui/*`（dark 科技风、节点力导向）
