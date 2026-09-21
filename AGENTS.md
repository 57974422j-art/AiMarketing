# AiMarketing 项目指令（Reasonix）

> 本项目 = AI 营销 SaaS 平台（Next.js 14 + Electron 客户端 + SQLite）。
> 详细进度/问题以 `PROJECT.md` / `ISSUES.md` / `EXECUTION_LOG.md` 为唯一真相源。
> 另有 21 条项目背景记忆（打包部署 / 发布脚本 / 路径定案 / 架构定案等），需要时会自动召回。

## 硬规则（每次都遵守）

1. **禁止任何 Git 写入动作**：除非用户**明文说明**「可以提交」，否则不做 `git add` / `git commit` / `git push`。
   仓库里有其它 AI 制作的版本，不能搞乱。纯查看（`git status` / `git log` / `git diff`）可以。
   改动只停留在工作区，不暂存不提交。
   - **禁止 `git add -A` / `git add .`**：必须先 `git status --short` 看清待提交内容，再**按路径白名单**逐个 `git add`。
     2026-09-18 事故：`git add -A` 把 `temp/`（Python 环境副本、88MB 的 playwright driver、85MB zip 等 **26146 个文件**）一起提交 → 服务器 `fetch` 要拉 55MB / 19955 对象、`.git` 涨到 895MB。已用 `reset --soft` + 白名单重做 + `--force-with-lease` 修复（新提交 `cbb9766a`，20 文件 / 1960 行；push 仅 768 bytes）。
   - 临时产物目录（`temp/`、`_pytest*`、`backup-*`、`buvenv-test/`）一律用**目录级 `.gitignore`**（内容 `*` + `!.gitignore`）兜底；根 `.gitignore` 是 UTF-16 且有历史乱码，**别用脚本追加**，容易写坏编码。

2. **每次实质操作后必须同步三份文档**（缺一不可）：
   - `EXECUTION_LOG.md`：顶部 `---` 之后、最新在上，追加 `日期 | 操作内容 | 改动文件 | 结果`
   - `PROJECT.md` 第六节「当前进度与待办」+ 文件头「最后更新」日期
   - `ISSUES.md`：已解决的移入「已解决」区并注明日期；新问题按 🔴🟡🟢 入库；更新文件头日期
   纯查看/调研不需要更新，但调研发现的新问题仍要记入 `ISSUES.md`。

3. **永远不怀疑部署**：用户说测过 = 服务器已是最新代码。
   问题一定在代码/API/配置，直接查证（`curl` 实测 API、`pm2 logs`、必要时 `git log -1`），不要说「没部署」。

4. **Electron 主进程禁止同步阻塞**：绝不用 `spawnSync` / `execSync` 执行耗时命令（pip / 解压 / 环境探测），
   统一用异步 `spawn` + `runAsync(exe, args, {timeout})`。启动路径必须零同步阻塞。

5. **发布任务编号用 `AgentBrowserTask.seq`**（每账号独立自增），数据库 `id` 绝不外露；
   所有显示任务号的地方（含**列表查询**）都要用 `seq ?? id`。`VideoTask` / `StoryboardTask` 是另一套编号，别混改。

6. **守住既有定案，不要横跳**：
   - 纯本地架构（前端/后端/数据库全本地，不连服务器）
   - 浏览器一条线：系统 Chrome + `browser-profile`（登记 = AI 发布 = 登录态）
   - 客户端 userData = 安装目录下 `data/`
   - 内置 `python-bu.zip` 必须含 playwright/driver（删了就废）

## 关键命令

- 本地开发：`npm run dev`
- 打包：`node scripts/bump-version.mjs X.Y.Z` → `node scripts/build-local.mjs`（~13-15 分钟，产出 `dist-rel/`）
  - bump 后**必须补 `electron/changelog.json` 里那条的说明**（bump 只插"（待补充变更说明）"空占位）
  - ⚠️ 写中文说明时**不要用英文双引号**（会把 changelog.json 的 JSON 写坏 → bump 报错），用「」
- **提交推送**（★ 必须先有用户明文授权，否则禁止）：`git add <白名单路径>` → `git commit -m "…"` → `git push origin master`
- 服务器部署（唯一命令）：`cd /root/AiMarketing && git fetch origin && git reset --hard origin/master && bash scripts/deploy-server.sh`
- 发版上传 OSS：`node scripts/upload-update-oss.mjs dist-rel`
  - ★ 三件套必须同步，**latest.yml 最后传**（先传 exe + blockmap，否则客户端更新会 404/转圈）
- 成片自检：`cd /root/AiMarketing && bash scripts/video-factory/selfcheck.sh`（4 段：语法 / 9 种卡型渲染 / 4 个 TTS 引擎 / 17 个改动标记）

## 看日志（排查必备）

| 看什么 | 命令 / 路径 |
|---|---|
| 客户端日志 | `安装目录\data\bu_debug.log`（`electron/main.js` 的 `buLog` 写这里） |
| 服务器进程日志 | `pm2 logs aimarketing --lines 200 --nostream` |
| 成片任务状态 | `cat /root/AiMarketing/storage/<userId>/video-factory/vf<时间戳>.json` → 看 `status`（running/done/failed）+ `tail[]` |
| 成片入口日志 | `…/video-factory/vf_debug.log`（⚠️ 目前实际没生成，见 `docs/AI交接文档-三条成片线-20260921.md`） |
| nginx | `/var/log/nginx/access.log`、`/var/log/nginx/error.log` |

## 仓库边界

- 核心目录只有四个：`src/`（Next 页面 + API）、`src/lib/`（业务库）、`electron/`（桌面端）、`prisma/`（数据模型）
- 改 `src/` 需服务器 build 才生效；改 `electron/` 需本地重新打包；两者都改都要做
- 客户端是纯壳：打包只更新 Electron 壳与客户端脚本，页面/前端在服务器
