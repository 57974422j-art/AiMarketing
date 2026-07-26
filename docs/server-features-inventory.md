# AiMarketing 服务器功能清单 / 复盘档案

> 目的：把长期没人动、容易忘记的服务端功能、配置机制、第三方依赖一次性建档。
> 维护方式：每理清一处就更新本节。最后更新：2026-07-22

---

## 1. 海外 API 代理（OVERSEAS_PROXY）

- **本质**：一个 Cloudflare Worker 转发器（URL 转发型，非标准 HTTP 代理）。
- **地址**：`https://01.0o0o0.shop`（用户从阿里云新加坡 8.219.154.55 迁过来的）。
- **用法**：代码里 `proxiedFetch(url)` 把目标拼成 `<PROXY>?url=<encodeURIComponent(url)>` 再去抓。
  - 见 `src/app/api/fetch-prompts/route.ts` 第 8-12 行、`src/app/api/search-images/route.ts` 第 6-10 行。
- **是否常驻**：✅ CF Worker 永远在线，**不需要每次启动**。
- **配置位置（两处，等价）**：
  1. `.env.local` 的 `OVERSEAS_PROXY=...`
  2. 后台 `admin/settings` → "海外 API 代理" 输入框 → 保存写回 `.env.local`
- **生效机制（重要，易踩坑）**：
  - Next.js 启动时把 `.env.local` 读进 `process.env`（运行时赋值）。
  - `admin/config/route.ts` POST 保存时会**同时**写 `.env.local` 并 `process.env.OVERSEAS_PROXY = value`（第 243 行）→ **保存即生效，无需重启**。
  - 改 `.env.local` 后若没走 UI 保存，需 `pm2 restart aimarketing` 让新进程重读。
- **⚠️ 验证陷阱**：`cat /proc/$PID/environ` **看不到** Next 运行时注入的 env（只显示 exec 启动环境）。判断代理是否生效，应看运行日志 `[FetchPrompts] 抓取来源:` 或用 `pm2 logs`。
- **实测（2026-07-22）**：`curl "<PROXY>?url=<civitai>"` 成功返回 `{"items":[...]}`，代理可用。
- **当前风险**：Lexica API 已死（返回 500），PromptHero 是 React 页正则抓不到。

---

## 2. Pixabay（免版税图片 + 音乐，国内友好）

- **Key**：`PIXABAY_API_KEY`（已在 settings 配 ✓）。
- **用途**：
  - `/api/search-images`：搜图 + 搜视频（`searchPixabay`，第 87-125 行），失败回退 DuckDuckGo → picsum 占位图。
  - `/api/bgm`：直接返回一组 Pixabay CDN 免版税 BGM 直链（第 11-15 行），无需 Key 即可放。
- **是否走代理**：`search-images` 里 Pixabay 请求走 `proxiedFetch`（即走 OVERSEAS_PROXY）。
- **待验证（2026-07-22）**：Pixabay 在国内是否直连可达（决定要不要走代理）。验证命令见对话。
- **商业合规**：全部免版税可商用，适合做"智能成片"素材。

---

## 3. MediaCrawler（/opt/MediaCrawler）

- **安装位置**：`/opt/MediaCrawler`（用户确认已装，[ ] 待上服务器核实版本/状态）。
- **作用**：数据采集引擎，支撑数据中心（视频搜索/评论/用户/详情/热门）。
- **调用链**：`src/lib/automation-providers.ts` → `viaMediaCrawler()` → `src/app/api/mediacrawler/lib/crawler-client.ts`。
- **配置项**（在 `.env.local` / settings）：
  - `AUTOMATION_ENGINE=mediacrawler`（默认）
  - `MEDIA_CRAWLER_PATH`（默认 `/opt/MediaCrawler`）
  - `PYTHON_BIN`
  - `ACTION_ENGINE`（默认 `q1-adb`）
- **前置条件**：需部署 MediaCrawler 服务 + 扫码登录拿 Cookie（settings 页有"扫码登录"面板）。
- **状态**：[ ] 待核实是否已部署 + Cookie 是否过期。

---

## 4. 指纹浏览器（自动发布）

- **位置/脚本**：记忆中有 `douyin-publish.js`（指纹浏览器自动发布脚本），后台有"自动选择音乐/封面"开关思路。
- **引擎类型**：`automation-providers.ts` 里引擎含 `'fingerprint'`。
- **状态**：[ ] 待核实脚本现状与可用账号。

---

## 5. 域名绑定

- **域名**：`ai-niuma.cc`（已备案 + HTTPS，记忆）。
- **对抓取功能影响**：❌ 无。服务端出站 fetch 与域名前置无关。
- **注意区分**：`IP:3000` 仅用于 electron 客户端内连与后端回环；对外只用 `ai-niuma.cc`。

---

## 6. 「抓取」四个按钮现状（prompt-templates 页）

接口：`POST /api/fetch-prompts?type=image|video|scene`（admin 权限）。
数据源：`PROMPT_SOURCES`（默认 `civitai,lexica,prompthero`）。
写入：`promptTemplate` 表 `{title, prompt, category}`。

| 按钮 | type | 现状 | 根因 |
|---|---|---|---|
| 🌄 抓取文生图 | image | ❌ 0 条 | 第 46 行 `meta.negativePrompt ? '文生图':'文生视频'`，Civitai 的 `meta` 常为 null → 全标成`文生视频`，对不上 image 过滤 |
| 🎬 抓取文生视频 | video | ⚠️ 代理通了应能入库 | Civitai 恰被标成`文生视频`，对得上；前提是运行进程有代理 |
| 🏞️ 抓取场景 | scene | ❌ 恒 0 | 三个源都不产`场景`分类，第 116 行过滤必空 |
| 📦 预设 | — | 独立 | 调 `/api/seed-prompt-templates`（纯本地，不走代理） |

**根因分层**：
1. 运行进程若没加载 `OVERSEAS_PROXY` → 三个 `proxiedFetch` 直连超时 → 被 `catch {}` 静默吞 → 全 0。
2. 文生图错标 bug（第 46 行）。
3. 场景无源 bug（第 116 行）。
4. Lexica 死 / PromptHero 抓不到，且 `catch {}` 吞错。

**改造方向（待讨论定稿）**：
- A. 修代理加载（重启 / UI 保存）→ 救「文生视频」。
- B. 第 46 行：Civitai 静态图提示词直接标 `文生图`；视频抓取改为同时收纳（文本提示词图文视频通用）。
- C. 场景：用场景类关键词走 Civitai/Pixabay 搜索并打 `场景` 标签。
- D. 数据源换 Pixabay（国内友好、免版税）作图片/视频素材抓取主源，弃用 Lexica/PromptHero。
- E. 把 `catch {}` 改成打印真实错误，前端能看到"为什么 0 条"。

---

## 待办核实清单
- [ ] Pixabay 国内直连是否可达（决定走不走代理）
- [ ] MediaCrawler 部署状态 + Cookie 是否过期
- [ ] 指纹浏览器脚本现状
- [ ] 「预设」按钮是否独立可用（本地接口）
- [ ] 重启/UI 保存后「抓取文生视频」真实入库数（看 pm2 logs）
