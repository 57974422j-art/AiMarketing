# AiMarketing 执行修改记录（EXECUTION_LOG）

> 每次执行操作后**必须追加**一条记录：`日期 | 操作内容 | 改动文件 | 结果`（最新在上）。
> 同步维护：PROJECT.md 六「当前进度/待办」、ISSUES.md 问题状态。
> 开始日期：2026-08-05

| 2026-09-20 | **固化"待提交/部署/验证"清单（shell 故障下我无法推送与运行时验证）**：新增 `docs/成片待提交与验证清单-20260920.md` —— ① **白名单 `git add`**（17 个路径，禁止 `-A`）+ commit message + push；② 部署命令；③ **部署后验证三件**：标记 grep（3 条，任一为 0 即某文件没 add 上）、`render.py --selftest`（★覆盖新链路：模糊铺底/Ken Burns/逐字浮现/ASS卡拉OK/底板取色，含逐行期望输出）、真实长视频流程 + `vf_debug.log` 关键行 + `storyboard.voiced.json` 判读脚本；④ **已知折中/待办 5 条如实列出**（叠化=淡入淡出、上传未接通、D1、混合/全AI、词级字幕为估算）。另**核对 `esc_text` 确认无 bug**（L149 已转义单引号 + `%` + 冒号）—— 原先怀疑"撇号会炸滤镜"不成立 | docs/成片待提交与验证清单-20260920.md(新增) | ✅ 文档写入成功；`esc_text` 逐字符核对通过 |
| 2026-09-20 | **修一个我引入的死路：表单「📤 我上传」没有对应状态分支**：B 批表单新增了「我上传」，但状态机只有 `form`/`source`/`script`/`running` 分支，原来点它会把草稿置为 `step='upload'` → **下一句话掉进兜底、且显示旧版卡片**（与新表单不一致）。修法：**不再进入无分支状态**，保持 `step='form'` 并**诚实说明"上传成片未接通（下个版本）"** + 给出可走的路（选素材合成 or 写主题）| src/app/api/agent/chat/route.ts | ✅ grep 验证：已无任何活代码把 step 置为 `'upload'`（仅剩注释）|
| 2026-09-20 | **成片自检升级：`render.py --selftest` 覆盖新链路（解决"我跑不了代码"的验证缺口）**：原 selftest 只跑 title/list/number，**新链路（模糊铺底不裁切 / Ken Burns / 逐字浮现 / ASS 卡拉OK / 底板取色）一条都验不到** → 升级为：先用 ffmpeg **造一张测试图**（`-f lavfi color`）→ 加入 `bgimage` 镜（带 `subtitle`）→ 5 镜覆盖 title/bgimage/list/number/end。**造图失败时降级成 title 卡**（bgimage 的 src 为空会让 ffmpeg 输入报错 → 自检不能因此崩）。这样用户在服务器上跑一条命令即可替我做完整验证 | scripts/video-factory/render.py | ✅ 读回验证 selftest 分支（造图 → 条件 shot → 降级保护）；`subprocess`/`tempfile` 均为模块级 import |
| 2026-09-20 | **成片一致性补丁：其余卡型不再裁切 + 配音/字幕取词对齐**：① **`card_image` / `card_video` 仍在 `increase+crop`**（我只修过 `card_bgimage`）→ 素材一旦被排成 `image`/`video` 卡（或以后接"混合"模式）同样会被切边；两者改为与 `bgimage` 一致的**模糊铺底 + 完整画面居中**（`card_image` 保留原 Ken Burns `zoompan`）。② **`tts.py` 的兜底逻辑与 `render.py` 的 `_shot_text` 对齐** —— 原先只覆盖 `list`/`number`，`compare`(left/right)/`chart`/带 `cta` 的卡会**"字幕有、配音没有"**（那镜静音、时长停在 AI 默认值）；现统一为 `title+items+label+value+suffix+left/right+cta`，**配音文本 == 字幕文本** | scripts/video-factory/render.py、scripts/video-factory/tts.py | ✅ 读回验证：`card_image` 的 `z`/`frames` 在作用域、滤镜链闭合；`tts.py` 兜底分支完整（L298-315） |
| 2026-09-20 | **成片 C3 补齐到标题卡**：`card_title` 原本是"整句淡入"，而 C3（逐字浮现）只做在了 `bgimage` 上 → 改为**同样走 `_reveal_seq()`**（与 bgimage 一致、跟着配音卡点），**拿不到 `text` 时回退原来的整句淡入**（行为不退化） | scripts/video-factory/render.py | ✅ 读回验证 `card_title` 返回值与回退分支完整；`_reveal_seq` 虽定义在文件后部，但 Python 运行时解析，调用无碍 |
| 2026-09-20 | **成片收尾：字幕字号自适应 + 补齐 `ISSUES.md` 记录**：① `--sub-size` 原默认**写死 26**，在 1920×1080 下只有屏高 2.4%（**太小**）→ 改为**未指定时按分辨率自适应** `max(26, int(H*0.042))`（≈屏高 4.2%），显式传值仍以传入为准；日志加印实际字号。② 补写 `ISSUES.md`：**本轮成片 9 个实测问题 + 自查 3 个问题**的「症状 / 代码级根因 / 修复」表格、服务器部署前提三条**已确认解除**（脚本在 git、字体齐备、python3+ffmpeg 就位、**只用标准库无需 pip**）、遗留项（D1 客户端播本地 / A~D 整批待实测）。③ **核实并纠正**我一条写错的遗留记录（ASS 字体回退：实际 `sub_font_name()` 已按存在性回退） | scripts/video-factory/render.py、ISSUES.md | ✅ 读回验证 `_sub_size` 计算与两处调用（`build_ass` / `burn_subtitles`），`H` 在作用域内 |
| 2026-09-20 | **成片收尾清理：统一音色列表 + 修两个自查发现的 bug**：① **音色列表统一** —— 新增模块级 `VF_VOICE_BASE`（百炼官方 7 个），表单/文案卡/换音色卡**共用同一份**（`vd.voiceList` 存进草稿传递），彻底清掉写死的无效 `longyuan/龙嫗` 与不适用成片链路的火山 id；音色匹配正则也按官方名重写（龙小夏/豆豆/龙书/龙陈/龙靖/龙小辉）。② **修 `vfPlanRaw` 悬空引用** —— `VF_SPLIT_V1` 拆两次调用后该变量已删，但旧日志行还在引用 → **ReferenceError 被外层 catch 吞掉**（只留一条假"异常"日志）→ 改为记录 `[分镜构成]`。③ **修表单英文 source 走错路** —— 表单发 `source:"upload"` 等英文 id，而老分支只认中文 `/上传/` → 在表单里点「📤 我上传」会被当成「素材合成」→ 新增 `vd.formSource` 参与分支判断（ai/mix/upload 三处） | src/app/api/agent/chat/route.ts | ✅ grep 验证：`longyuan` 仅存于注释、`vfPlanRaw` 仅存于修复说明；`VF_VOICE_BASE` 定义 1 处 / 使用 4 处 |
| 2026-09-20 | **成片 C 批补齐：C3 配音卡点（画面大字逐字浮现）+ C4 主色底板**：① **C3** —— 新增 `_reveal_seq()`：把每镜的 `text`（4~8 字大字）拆成**前缀序列**，每个前缀各画一次 `drawtext`（都用 `x=(w-text_w)/2` 居中，**不需测量字宽**），只在 `[t_i, t_{i+1})` 窗口 `enable` → 视觉上**从左到右逐字浮现**；因为**镜头时长 = 该镜真实配音时长**（tts.py 回填），在镜头前段逐字亮出天然**跟着配音卡点**。② **C4** —— 新增 `_avg_rgb()`（**用 ffmpeg 把图缩到 1x1 再读 3 字节原始 RGB**，**绕开服务器没装 PIL**）+ `_blend_dark()`（把素材平均色按 k=0.22 混进主题底板色）；在 main 的**渲染循环之前**改 `th['bg']` → 纯色卡（title/list/number/end）跟着素材色相走，整片视觉统一；**取色失败只打日志、不影响出片** | scripts/video-factory/render.py | ✅ 已读回验证：`f-string`+`','.join` 混用语法合法、滤镜图结构正确、**C4 改 `th` 的位置确实在 `render_shot` 循环之前** |
| 2026-09-20 | **成片 D2：BGM（AI 音乐库 + 循环铺底混音）**：链路打通 —— 表单加「🎵 自动配乐 / 🔇 不要 BGM」→ `VF_FORM.bgm` → `make_ai_video` 收到 `bgm=auto` 时**直接查 `MediaAsset`（source=public/type=audio/category=music）**取最新一首（不调 HTTP，避开服务端鉴权）→ 下载到本任务目录 → `make.py --bgm` → `render.py --bgm` 混音。**混音要点**：BGM 用 `-stream_loop -1` 循环、音量压到 **0.12**，`amix` 必须加 **`normalize=0`**（默认会把两路都按输入数除小 → 人声变轻）；无人声时 BGM 单独 0.18 铺底。可用 `--no-karaoke` 同理可关字幕 | scripts/video-factory/render.py、scripts/video-factory/make.py、src/app/api/agent/chat/route.ts、src/app/agent/page.tsx | ✅ 已读回验证：`-stream_loop` 位置、滤镜串闭合、`normalize=0` 三处正确 |
| 2026-09-20 | **成片 D 批推进：D3 克隆音色闭环 + D4 词级字幕（ASS karaoke）**：① **D3** —— 克隆音色原来只存客户端 `localStorage.dh_voice_id`，而成片跑在**服务器**根本读不到（断链）→ 补成闭环：数字人页克隆成功后额外 `PUT /api/agent/prefs {voiceClone}` → 存 `AgentMemory`(tag `voice_clone`) → 成片表单音色末尾 push「🎙 我的克隆音色（克隆）」。**顺手修**：表单音色原来写死 3 个，其中 **`longyuan/龙嫗` 不在百炼官方列表**（大概率无效），改为官方 7 个（longxiaochun/longxiaoxia/cherry/longshu/longchen/longjing/longxiaohui）。② **D4** —— 新增 `build_ass()` 生成 ASS **逐字高亮**（karaoke）：**不依赖 funasr**（服务器未必装，客户端才有），而是把每镜 `subtitle` 按**该镜真实配音时长**均分到每个字生成 `\k`（厘秒）→ 逐字扫过（已唱白 / 未唱橙）；`burn_subtitles` 支持 `.ass`（不再 `force_style` 覆盖自带样式）；**生成失败自动回落 SRT**（`--no-karaoke` 可关）；`shot_text()` 提为模块级供 SRT/ASS 共用 | scripts/video-factory/render.py、src/app/api/agent/prefs/route.ts、src/app/api/agent/chat/route.ts、src/app/digital-human/page.tsx | ✅ 已读回验证反斜杠转义（`\\N` / `{\\k}` / `replace('\\','／')` 三处均正确）|
| 2026-09-20 | **★成片根因修复：分镜缺 `subtitle` → 配音/字幕错用了"画面大字"**：用户实测「选 180 秒 → 成片仅 **50.8 秒**、字幕只有屏幕上几个字、约 2 秒一镜」。**根因（代码级，非猜测）**：`tts.py:292` 与 `render.py:427` 都是 `txt = s.get('subtitle') or s.get('text')` —— AI 没给 `subtitle` → **回落到 `text`（画面上的 4~8 字大字）** → 于是**配音念的是大字、字幕也是大字**，那 800 字文案**从头到尾没被念过**（24 镜 × ~2 秒 = 50.8 秒，与实测吻合；`tail` 里"字幕已烧入"也说明 SRT 确实生成了、只是内容是大字）。**修**：分镜 prompt 改为【**每镜都必须给 `subtitle`**，且所有 `subtitle` 拼起来**完整覆盖文案**（共约 N 字）】，并把 `text` 明确为"画面大字 4~8 字"—— **Python 侧零改动**（本来就优先读 `subtitle`）。**同时发现**：`build_srt` 的 list/number 卡补全**从未部署**（`grep -c shot_text` = 0）→ 需 `git add scripts/video-factory/render.py`。**另**：`storage/file` 播放改 302 到 OSS（原生 Range，修"每 3 秒卡一下"）| src/app/api/agent/chat/route.ts、scripts/video-factory/render.py、src/app/api/storage/file/route.ts | 预期修后：~7 秒/镜、总时长≈180 秒、**字幕=文案正文**、画面大字仍是短语 |
| 2026-09-19 | **成片 v1 实拍诊断 + 4 处修复（依据 `storyboard.voiced.json` / SRT 真实数据，非猜测）**：用户贴出任务工作目录的两个文件后定位到：① **10 张图只用 1 张** —— `storyboard.voiced.json` 里 4 个 `bgimage` 的 `src` 全是同一个 `cover_*.jpg`；根因 `parseInt(s.pick) \|\| 1`（AI 不给 pick / 给无效值时全落第 1 张）→ 改为**按镜头序号轮换**兜底，并强化 prompt"pick 尽量用不同图号" ② **有配音却无字幕** —— SRT 在 `11.19s→16.20s` 断档（"三大优势" list 卡那 5 秒）；根因 `build_srt` 只认 `text`，而 list 卡用 `title`+`items` → `txt` 空 → 整镜跳过 → 补全 `title/items/label/value/cta` 并加长句折行 ③ **"双字幕"** —— 画面大字（drawtext）与底部字幕取**同一个 text** → 同句出现两遍 → prompt 改「大字只能是 4~8 字短语，禁止整句」 ④ **时长 18.4s ≠ 30s** —— AI 文案只写 ~60 字（未照 120~150 字）→ prompt 加硬要求「必须 120~150 字，少于 100 字不合格」 ⑤ 新增 `[AI原始plan]` 日志（可回溯 AI 排镜依据）⑥ `--workdir` 改按任务独立（原来所有任务共用 `work/` → 并发互相覆盖且无法回溯）；完成卡按 `taskId` 去重（修"上次视频在下次会话重复出现"）| src/app/api/agent/chat/route.ts、scripts/video-factory/render.py、src/app/agent/page.tsx | ✅ 首次实现"**让 AI 能看到编辑逻辑**"：`work_*/storyboard.voiced.json`（每镜类型/文字/素材/真实时长）+ `render/*.srt` + `[MAKE] 分镜 N 镜` 日志 |
| 2026-09-19 | **★成片"时好时坏"真因：入口词没进 `skipModelStep1`（代码级定位）**：用户实测「用本地成片帮我做一条视频」**有时**进状态机、**有时**落到 AI 自由发挥（AI 还会自己查热点、列 3 个选题）。**根因**（`chat/route.ts:1714`）：状态机整块的入口条件是 `if (skipModelStep1 \|\| normCalls.length > 0)` —— 即「**AI 那一步调了工具**」才进块；而 `skipModelStep1`（L1681）当时只算了【发布】草稿 + `stWordInput`（发布词），**成片草稿与成片入口词都没算**。于是 AI 一旦直接开口聊天（`normCalls=0` 且 `skip=false`）→ **整块跳过** → 成片状态机（含 `[入口]` 日志、兜底1、兜底2）**一行都不跑** → AI 自由发挥。这也解释了「`grep Step2 finalResult` 无输出 + `vf_debug.log` 不存在」。**修**：`skipModelStep1` 补入 `VIDEO_DRAFT.has()` 与成片入口词 `vfEntryWord`（★VF_ENTRY_V1）| src/app/api/agent/chat/route.ts | 发布状态机早就有 `stWordInput` 兜底，成片这条此前漏了；修后成片入口不再取决于"AI 想不想调工具" |
| 2026-09-19 | **成片第 2 步：画幅自选 + 按素材自动判断 + 不裁切 + 30 秒**：① 新增 `probeImageSize()`（纯 JS 解析 PNG/JPEG/GIF 文件头，零依赖零子进程）与 `probeMaterialSizes()`（统计横/竖/方比例）② **画幅三选**（竖屏 9:16 / 横屏 16:9 / 自动）——**用户指定优先；不选则按素材判断**（素材多为横图 → 出横屏，绝不硬塞竖屏），卡片上标注"按素材定为横屏/竖屏"③ `plan.size` 随画幅走（1920×1080 / 1080×1920）④ **`render.py` 的 `card_bgimage` 不再裁切**：底层 = 放大填满 + 高斯模糊 + 压暗（做底纹，不出现突兀黑边），上层 = 完整图按 contain 居中 overlay —— 横图进竖屏不再被切左右 ⑤ 时长改 **约 30 秒**（文案 120~150 字、镜头 5~7 个、各镜头 dur 相加≈30s）| src/lib/agent/video-material.ts、src/app/api/agent/chat/route.ts、src/app/agent/page.tsx、scripts/video-factory/render.py | ⚠️ render.py 滤镜图改成 `split`+`overlay`（较复杂）；若 ffmpeg 报错，任务 JSON 的 `tail` 会给出具体原因 |
| 2026-09-19 | **★成片状态机全线打通 + 修掉两个真因（build 失败 / standalone 找不到脚本）**：① **build 挂在我手里**——`prompts.ts` 红线里写了**反引号**，而那段文本在**模板字符串内** → 提前闭合 → `Expected ':', got 'VF_JSON'` → `deploy-server.sh` 因 `set -e` 直接退出 → **pm2 没重启，服务器一直跑旧代码**（这就是连续几轮"改了没反应 / AI 自由发挥"的真相：不是状态机不生效，是压根没上线）。② **standalone 找不到脚本**——pm2 跑的是 `.next/standalone/server.js`，`process.cwd()` 指向 `.next/standalone` 而非项目根 → `scripts/video-factory/make.py` 断言失败 → `TOOL_REJECT:未找到本地成片脚本`。**修**：新增 `vfRootDir()`/`vfStorageRoot()`（候选 VF_ROOT → cwd → 上级 → `/root/AiMarketing`），`make_ai_video` / `query_make_video` / `make-video-status` / `materialDir` **全部统一**用它（原来"写任务"和"查进度"的 storage 根可能不一致）。③ **画面来源三选卡**（`素材合成` / `素材+AI 混合` / `全部 AI 生成`，后两个诚实回"开发中"）。④ **提示词加 VF_JSON 红线**（实测 AI 会模仿 `VF_JSON:{...}` 装成状态机输出） | src/lib/agent/video-material.ts、src/app/api/agent/chat/route.ts、src/app/api/agent/make-video-status/route.ts、src/app/agent/page.tsx、src/lib/agent/prompts.ts | ✅ 状态机已全线跑通（素材来源卡 → 看仓库 10 张图 → 排 5 镜 → 文案卡 → 确认入队）。待办：服务器侧 `make.py` 需 **python3 + ffmpeg + Pillow/numpy**；之后接「客户端优先/服务器兜底」双路成片 |
| 2026-09-19 | **成片状态机 v2：一键出发（素材来源卡 + 素材链路 + 视觉理解 + 自动排分镜）**：用户点「帮我做一个视频」不再要求补主题——改为**第 0 步出示素材来源卡**（`[🎞 用我的素材库]` `[📤 我上传]`），点一下就开工。**新增**：① `src/lib/agent/video-material.ts`（★VF_MATERIAL_V1）——列个人仓库(OSS `storage/{uid}/`)素材 → 下载到**服务器本地** → 复用 `describeImageWithVL`(qwen-vl-max) **看懂图片**（默认 10 张可调 20，约 0.2 点/张）② 状态机 `step:'source'`：取素材 → 视觉理解 → 读 `User.industry` 画像 → 拉今日热点（取不到就算了）→ **AI 一次调用同时出「文案 + 分镜 JSON」**（AI 出场①②）③ **AI 只给 `pick`(图号)，真实本地路径由代码替换**（防 AI 编路径）④ 确认后带 `plan`（`bgimage` 用真实素材）调 `make_ai_video`；前端 `VF_JSON.step='source'` 两按钮 + `script` 卡显示"看完 N 张图 / 排了 M 个镜头 / 素材识别结果" | src/lib/agent/video-material.ts(新增)、src/app/api/agent/chat/route.ts、src/app/agent/page.tsx | ⚠️ shell 故障未复 → 未跑 tsc（人工复查）；待 push+部署实测。**说明**：视频素材暂只列名不抽帧（用户明确"抽帧已有、发布流每次都在抽"）；AI 生成画面 / 混合留后续 |
| 2026-09-18 | **★成片状态机骨架落地（VF_FLOW_V1）——「帮我做一条视频」不再让 AI 自由发挥**：用户实测说「用本地成片帮我做一条视频」→ AI 跑去 `search_storage` 列了仓库 10 个文件、**什么都没生成**（= 没状态机 AI 就乱走，和当年发布链路同一个病）。按《成片工作流规划》3.1~3.4 + 三·补施工图，**照发布状态机那套**落地骨架：① 新增**独立草稿** `VIDEO_DRAFT`（与 `PUBLISH_DRAFT` 完全隔离）② **独立意图正则** `vfIntent`（帮我做…视频/帮我成片/本地成片/做一条视频…，并**排除"发布/发到/平台:"** 不抢发布的活）③ **AI 出场点①**：起稿时把用户一句话润色成口播文案（保留数字与术语、句末用「。」「！」便于自动切句）④ 新增卡片前缀 **`VF_JSON`**（文案 + 3 个音色 + 预估点数 +「确认出片」，仿 `WF_JSON` 写法）⑤ 用户「确认」→ **直接调既有 `make_ai_video`**（不经 AI 判断）→ 后台出片 → 前端既有 6s 轮询推结果 ⑥ `hasDraft` 纳入成片草稿（「确认」那轮不再白调一次 AI）。**AI 出场点守住**：目前只启用第 ①处（第 ②处"排分镜"待接线） | src/app/api/agent/chat/route.ts、src/app/agent/page.tsx | ⚠️ shell 故障未复 → 未跑 tsc（人工复查：变量名不冲突 / `wfEarlyReply` 在块尾 L2442 被消费 / `executeToolCall` 签名一致）。**待接线**：6.5 画面来源（我的素材/AI 生成/混合）、素材链路（个人仓库→服务器本地）、分镜编排（AI 第②处）、卡片/主题扩充、程序化逐帧、词级字幕、首镜硬节点、只重渲变更段、衔接校验 |
| 2026-09-18 | **H3 视频接入【中转站优先 + 官方降级】（★H3_RELAY_V1）**：用户提供朋友机房自建中转站 `https://h3.submodel.ai`（与官方 MiniMax H3 同构）。**实测**（服务器 + 本机各一遍）：① `GET /v2/query/video_generation/{假id}` → `TASK_NOT_FOUND`（= **key 通过鉴权**，且**不消耗额度** → 可作轻量验 key 手法）② `POST /v2/video_generation` 带 `{"model":"MiniMax-H3-Turbo","content":[{"type":"text",...}],"use_context_ir":true}` → **返回 task_id 提交成功**。确认：端点 = `POST /v2/video_generation` + `GET /v2/query/video_generation/{id}`；**顶层 `use_context_ir` 被接受**；turbo = 把 model 改成 `MiniMax-H3-Turbo`。**改动**：① `minimax-h3.ts` 重写为【中转优先 → 官方降级】（`h3Targets()` 按 `H3_BASE_URL/H3_API_KEY` 是否配置决定通道；**任务 failed = 内容问题不降级**；`use_context_ir` 默认开，`H3_USE_CONTEXT_IR=0` 可关）② `ai-providers.ts` 的 H3 分支：两端都不通 → **降级百炼 wan2.7-t2v** ③ 后台可配：`admin/config` 读写 + Settings「AI 密钥」新增「🎬 H3 视频通道（中转优先）」区块（中转地址 / 中转 Key / 模型下拉 / IR 开关）④ `test-key` 新增 `case 'h3'`（用"查不存在任务"验 key，**不花钱**），并顺带修掉原先 minimax 测试打**国际站** `api.minimax.chat` 而实际功能走**国内站** `api.minimaxi.com` 的不一致 | src/lib/minimax-h3.ts、src/lib/ai-providers.ts、src/app/api/admin/config/route.ts、src/app/admin/settings/page.tsx、src/app/admin/settings/components/ApiKeyPanel.tsx、src/app/api/admin/test-key/route.ts | ⚠️ shell 故障未复 → **未跑 tsc**（人工复查）；待后台填入中转配置后实测生成一次 |
| 2026-09-18 | **★Git 误提交事故与修复（26172 文件 / 895MB → 20 文件）**：用 `git add -A` 提交 1.0.205 时，把 `temp/` 下的 **26146 个文件**（Python 环境副本、`playwright/driver/node.exe` 88.3MB×2、`oss-check.zip` 85.5MB、`but.exe` 25.9MB 等）一并提交 → 症状：服务器 `git fetch` 要拉 **19955 对象 / 55.10 MiB**（用户及时 Ctrl+C 中止）、本地 `.git` 涨到 **894.9MB**、`.git/index` 3.8MB、`git show --stat HEAD` = "26172 files changed, 9048196 insertions"。**修复（方案 A：重做提交）**：① `git reset --soft 188ec178^` + `git reset`（撤销提交，文件无损）② 新建 `temp/.gitignore`（`*` + `!.gitignore`，**按目录整体忽略**——避开根 `.gitignore` 的 UTF-16 编码风险）③ 清掉根目录 6 个临时文件（`tsconfig.tsbuildinfo`/`viag-shot*.png`/`xhs-shot.png`/`zipsize.txt`）+ `package.json.bak-sl` 移出工作区 ④ **按路径白名单精确 `git add`**（不再用 `-A`）⑤ `git push --force-with-lease origin master` → 新提交 **`cbb9766a`：20 files changed, 1960 insertions(+), 26 deletions(-)**，push 只传 **768 bytes / 4 objects**，远端 `188ec178 → cbb9766a (forced update)` | 提交内容：`AGENTS.md`、`EXECUTION_LOG/ISSUES/PROJECT.md`、`docs/成片工作流方案/规划 ×2`、`electron/{changelog,version}.json`、`electron/platforms.generated.js`、`package.json`、`scripts/agent-publish/bu_pub_{kuaishou,shipinhao}.py`、`scripts/video-factory/{make,render,tts}.py`、`src/app/agent/page.tsx`、`src/app/api/agent/chat/route.ts`、`src/app/api/agent/make-video-status/route.ts`、`src/lib/agent/tools.ts`、`temp/.gitignore` | ✅ 远端历史已干净（服务器下次 fetch 只需几百 KB）。**教训**：`git add -A` 前必看 `git status --short`；临时目录用目录级 `.gitignore` 兜底；`--force-with-lease` 比 `--force` 安全（远端被抢先会拒绝）。本地 `.git` 仍 ~895MB（不可达对象），按需 `git gc --prune=now` 回收 |
| 2026-09-18 | **本地成片配音改走百炼 CosyVoice（★VF_DASHSCOPE_V1）**：用户明确「TTS 现在主要用百炼的、所有 API key 都在服务器后台部署」（火山已非主力）→ `tts.py` 的 `tts_one` 改为【百炼主用 → 火山兜底 → 都没有则明确警告】：新增 `_tts_dashscope()`（与 `src/lib/ai-providers.ts` 的 `dashscopeTTS` 同协议：POST `/api/v1/services/tts/generation` + `X-DashScope-Async` + 轮询 `/api/v1/tasks/{id}` + 下载 mp3），原火山实现改名 `_tts_volcano()` 作兜底并统一返回「时长秒（0.0=失败）」；音色：`--speaker` 默认改空（百炼 `longxiaochun`，可被 `DASHSCOPE_TTS_VOICE` 覆盖；火山 `zh_female_vv_uranus_bigtts`），make.py 传参加引号防空值 | scripts/video-factory/tts.py、scripts/video-factory/make.py | ⚠️ 同前：shell 故障，未编译/未实测。**服务器只需 `DASHSCOPE_API_KEY` 即可配音**（不再依赖火山） |
| 2026-09-18 | **本地成片（video-factory）Linux 服务器适配（★VF_LINUX_V1 + ★VF_REPO_V1）**：接手检查发现这套「本地成片」是按 Windows 本机写的，而 `make_ai_video` 是在 chat route 里 spawn python（= 跑在 API 所在机器）→ 用户确认成片跑在**服务器（Linux /root/AiMarketing）**，直接上服务器至少 4 处会坏，已全部修：① **tts.py 凭据**——原来硬编码 `DEFAULT_ENV = D:\AiMarketing\.env.local`，服务器读不到火山 key → 配音静默失败出无声片；改为 `环境变量优先 → VF_ENV_FILE → 从脚本位置逐级向上找 .env.local → cwd`，并加一次性明确警告。② **render.py 字体**——`FONT_CANDS` 原来只有 `C:\Windows\Fonts\*`，Linux 上 `find_font` 返回 `''` → 中文渲染成方块；补 Noto CJK / 文泉驿 / DejaVu 候选 + CJK 回退顺序 + 缓存；烧字幕的 `FontName=Microsoft YaHei` 写死 → 新增 `sub_font_name()` 按平台选（Noto Sans CJK SC / WenQuanYi）。③ **python 命令名**——make.py 内部调 tts.py/render.py 原来硬编码 `python`（Linux 通常只有 python3）→ 改 `sys.executable`；route.ts 的 `BU_PYTHON || 'python'` → 非 Windows 默认 `python3`。④ **成片交付**——原来只把服务器本地路径写进任务文件，用户在客户端根本拿不到文件 → 完成时 `saveToPersonalRepo()` 转 OSS 入个人仓库（自动日期命名 + 缩略图）+ 写 `repoName`/`url`（24h 签名直链），`make-video-status` 透出、前端完成消息与 `query_make_video` 都显示下载链接 | scripts/video-factory/{tts.py,render.py,make.py}、src/app/api/agent/chat/route.ts、src/app/api/agent/make-video-status/route.ts、src/app/agent/page.tsx | ⚠️ **本机 shell 环境故障**（bash：`shell startup/child-process check failed ... timed out (>10s)`，子代理同样）→ **无法跑 py_compile / tsc / 打包 / git push**；以上为逐处人工复查，未做编译验证。**服务器侧部署前提**：① `git push` 后 `scripts/video-factory` 才会到服务器 ② 服务器装中文字体 `apt-get install -y fonts-noto-cjk` ③ 服务器需 python3 + ffmpeg + `.env.local` 里的 `VOLCANO_TTS_*`（或设 `BU_PYTHON` / `VF_ENV_FILE`） |
| 2026-09-18 | **①快手"最后一步不点发布"真凶修复（本机 dump 页面实测）**：把快手发布页所有按钮抓出来看，发现 —— 「立即发布」其实是【发布时间选项的 radio】（ant-radio-wrapper，坐标 295,1092），点它只是选了"立即发布"这个选项；页面上【根本没有】「确认发布」这个按钮；真正的发布按钮是那个 `_button_primary` 的「发布」(212,1207)。旧代码先点「立即发布」(radio) 再找「确认发布」→ 永远找不到 → 判定失败 = 不点发布。改为：先确保选中「立即发布」选项 → 再点真正的「发布」按钮（精确匹配 + CDP 穿透兜底）。**本机实测点完 URL 变 /article/manage/video?status=2&from=publish = 已发布成功**。②**视频号"卡在分享卡片上传封面"修复**：报错 `Cannot set input files to detached element` —— 封面弹窗里的 file input 被 SPA 重渲染换掉，旧代码 `query_selector` 拿到过期元素、失败一次就放弃 → 整条脚本失败退出。改为 `locator`（自动重取元素）+ 最多 4 轮轮询重试。③**新增本地成片工具链 + 接入 AGENT**：`scripts/video-factory/{render.py,tts.py,make.py}`（10 张配方卡：title/list/number/quote/compare/chart/bgimage/end/image/video；火山 TTS 逐句配音并按真实时长回填镜头时长=唯一真相源；自动生成 SRT 并烧字幕；分段渲染可只重渲改动的镜）；`make.py` 支持 `--script`（自动切句）/`--plan`（AI 排分镜，推荐）/`--preview`（首镜先确认不花钱）。接进 AGENT：`route.ts` 新增 `case 'make_ai_video'`（报价→确认→后台 spawn→扣费）与 `case 'query_make_video'`（查进度）；`tools.ts` 注册两个工具 + 中文标签；新增 `src/app/api/agent/make-video-status/route.ts`（进度查询 API）；`page.tsx` 加自动轮询（MAKE_VIDEO_TASK 出现后每 6s 查，完成/失败都推一条结果）。**④异步化**：本地成片从"同步等 8 分钟"改为后台任务 + 任务文件（`<storage>/<userId>/video-factory/vf<ts>.json`），长片不再卡住对话 | scripts/agent-publish/bu_pub_kuaishou.py、scripts/agent-publish/bu_pub_shipinhao.py、scripts/video-factory/{render.py,tts.py,make.py}(新增)、src/app/api/agent/chat/route.ts、src/lib/agent/tools.ts、src/app/api/agent/make-video-status/route.ts(新增)、src/app/agent/page.tsx、electron/changelog.json | 快手：本机实测点「发布」后 URL 变 `/article/manage/...` = 成功；成片链路：`make.py --plan` 端到端出片（h264+aac 8.02s）；`make.py --selftest` 3 镜 11.52s；10 张配方卡全部渲染通过；tsc 对四个改动文件无新增类型错误（page.tsx 余下错误均为历史遗留，行号 164~3461，不在本次改动区间 480-560）。⚠️ **1.0.205 已 bump 三处版本号 + 补 changelog，但打包/提交因 shell 工具故障未完成** |
| 2026-09-17 | **"登记"里快手/B站打开的是纯登录页（用户以为登录态老丢的真因）**：`src/lib/agent/platforms.ts` 里快手 `loginUrl` = `passport.kuaishou.com/pc/account/login/`、B站 = `passport.bilibili.com/login` —— 都是【纯登录表单页】，无论是否已登录都显示登录框 → 用户点"打开登记"永远看到登录框，以为登录态没保住（原话："我在这里登记了3次都没用"）。实测反证：用同一 profile（browser-profile\1）打开快手【发布页】→ 页面显示「2 周涛 发布作品 首页 内容管理…」，登录态其实一直是好的。改为官网首页（`https://www.kuaishou.com/` / `https://www.bilibili.com/`）：已登录→直接能看出登录态、未登录→站点自己跳登录。**微博保持不动**（用户确认"微博必须在主页登录"）。另：验证两个脚本在"浏览器停在官网首页"时能否自己找到发布路径——**实测都能**（快手 URL=首页/reco → 脚本自 goto 发布页 → 全流程 OK；B站 URL=about:blank → 自 goto 上传页 → 全流程 OK），**无需额外加代码**（两脚本本来就有 `if 'publish/video' not in url: goto(PUB_URL)` 这类保护） | src/lib/agent/platforms.ts、electron/platforms.generated.js(重新生成)、electron/changelog.json | 快手/B站 `--no-publish` 从首首页状态实测全流程通过；generated.js 已核实两条 loginUrl 同步更新 |
| 2026-09-17 | **agent 发布链路 5 项修复**（用户逐条实测发现）：①**抖音封面段时序**——原"上传封面后死等 3500ms 就点完成"，实测(走了封面段分步记录)此时封面图还在"生成中"、点「完成」无效 → 抖音紧接着弹出【第二个窗口】「已基于横封面为你生成竖封面。效果不满意？独立编辑」，该窗口里【没有「完成」也没有可点的「发布」】→ 一直卡着（#48 失败根因；同代码等 5s 点=正常、等 3.5s 点=出第二窗口，纯时序）。改为轮询等「完成」按钮可点击（最多 20s，含 `semi-button-disabled` 这种 CSS 类判断）+ 点后【校验弹窗真关闭】+ 兜底关闭该提示层。②**bu:check 丢登录态**——python 无输出/超时时也 `return {success:true, accounts:[]}`，前端把空数组当"所有平台未登录"全清（用户实测：重登快手 3 次仍显示未登录，而 bu_check.py 单独跑输出 `kuaishou:1` 是对的）。改为：不谎报 success + 拿不到输出时回退读 `bu_login_cache.txt` + 前端空数组不再覆盖。③**6 平台登录失效明确报**：抖音/小红书/微博原来【完全没有】登录检测 → 新增；快手 `logged_in()` 原来"页面没渲染完就判已登录"→ 改为等页面出现实质内容+必须含"上传/发布"才算登录。④**选页保护**：B站 goto 后【必须复验】是否真停在上传页（登录失效会被重定向到首页，旧代码不复验 → 用户看到"B站直接跳到首页"）；视频号原来"只要 url 含 channels.weixin.qq.com 就抓"，抓到非发布页也不导航 → 改为锁死 `post/create` 并复验。⑤**新增 `scripts/keep-login-alive.mjs`**：视频号(微信) sessionid 每天换值、久不访问即作废 → 做成可由 Windows 计划任务直接调用的独立进程（独立端口 9223 不抢发布 9222 + 窗口移到屏幕外 + Chrome 单例检测「已在运行则视为正在访问→跳过」+ taskkill 兜底关闭） | scripts/agent-publish/bu_pub_{douyin,xhs,weibo,bilibili,kuaishou,shipinhao}.py、electron/main.js(bu:check)、src/app/agent/page.tsx、scripts/keep-login-alive.mjs(新增) | 抖音 --no-publish 实测 2 次通过（日志：封面已就绪 0.5s + 弹窗已关闭，无第二窗口）；快手 --no-publish 实测通过；保活脚本 dry-run + 真跑通过（账号1 判"已在运行"跳过、账号7 开+等+关）；6 脚本 py_compile + main.js node --check 全通过 |
| 2026-09-17 | **agent 发布链路 5 项修复**（用户逐条实测发现）：①**抖音封面段时序**——原"上传封面后死等 3500ms 就点完成"，实测(走了封面段分步记录)此时封面图还在"生成中"、点「完成」无效 → 抖音紧接着弹出【第二个窗口】「已基于横封面为你生成竖封面。效果不满意？独立编辑」，该窗口里【没有「完成」也没有可点的「发布」】→ 一直卡着（#48 失败根因；同代码等 5s 点=正常、等 3.5s 点=出第二窗口，纯时序）。改为轮询等「完成」按钮可点击（最多 20s，含 `semi-button-disabled` 这种 CSS 类判断）+ 点后【校验弹窗真关闭】+ 兜底关闭该提示层。②**bu:check 丢登录态**——python 无输出/超时时也 `return {success:true, accounts:[]}`，前端把空数组当"所有平台未登录"全清（用户实测：重登快手 3 次仍显示未登录，而 bu_check.py 单独跑输出 `kuaishou:1` 是对的）。改为：不谎报 success + 拿不到输出时回退读 `bu_login_cache.txt` + 前端空数组不再覆盖。③**6 平台登录失效明确报**：抖音/小红书/微博原来【完全没有】登录检测 → 新增；快手 `logged_in()` 原来"页面没渲染完就判已登录"→ 改为等页面出现实质内容+必须含"上传/发布"才算登录。④**选页保护**：B站 goto 后【必须复验】是否真停在上传页（登录失效会被重定向到首页，旧代码不复验 → 用户看到"B站直接跳到首页"）；视频号原来"只要 url 含 channels.weixin.qq.com 就抓"，抓到非发布页也不导航 → 改为锁死 `post/create` 并复验。⑤**新增 `scripts/keep-login-alive.mjs`**：视频号(微信) sessionid 每天换值、久不访问即作废 → 做成可由 Windows 计划任务直接调用的独立进程（独立端口 9223 不抢发布 9222 + 窗口移到屏幕外 + Chrome 单例检测「已在运行则视为正在访问→跳过」+ taskkill 兜底关闭） | scripts/agent-publish/bu_pub_{douyin,xhs,weibo,bilibili,kuaishou,shipinhao}.py、electron/main.js(bu:check)、src/app/agent/page.tsx、scripts/keep-login-alive.mjs(新增) | 抖音 --no-publish 实测 2 次通过（日志：封面已就绪 0.5s + 弹窗已关闭，无第二窗口）；快手 --no-publish 实测通过；保活脚本 dry-run + 真跑通过（账号1 判"已在运行"跳过、账号7 开+等+关）；6 脚本 py_compile + main.js node --check 全通过 |

| 2026-09-12 | 客户端瘦身（547MB→333MB）：build.files 去 .next + 17 条 node_modules 排除（next/@next/prisma/@prisma/sherpa/@img/react/three/@capacitor/ali-oss 等）；electronLanguages 只留中英；extraResources 去 models/sherpa。保留 ms-playwright（指纹内核）/scrcpy+platform-tools（群控）/browser-use/agent-publish | package.json、scripts/build-local.mjs | 1.0.142~144 打包验证；启动实测无模块缺失 |
| 2026-09-12 | 4 平台发布统一 CDP 穿透点击：抖音（原纯文本严格匹配→客户端"未找到发布按钮"）/小红书（像素定位改 CDP 优先）/微博（locator+CDP 兜底）/视频号（原 CDP） | scripts/agent-publish/bu_pub_*.py、_cdp_click.py | 任务#15 显示 CDP 命中 25 个"发布"点了左侧导航 → 已升级精确匹配+右下优先+候选日志 |
| 2026-09-12 | 封面硬等：服务器轮询 180s→570s（3 处）、前端 fetch 240s→600s；修 topics 分支取值字段（results[0].url → choices[0].message.content[0].image）。实测百炼生图 81/105/81 秒 | src/app/api/agent/chat/route.ts、src/app/agent/page.tsx | nginx 已由用户改 600s；待部署验证 |
| 2026-09-10 | **发布脚本四平台全通（抖音/小红书/微博/视频号）**：抖音(封面 coverControl 层+按图方向+排除 semi -custom+button完成+话题#技巧)｜小红书(封面 PK开关判断+加号+系统文件框；发表按钮 xhs-publish-btn closed shadow → 像素定位)｜微博(严格锁定 upload/channel 视频页不在首页操作；类型原创+标题 input[type=text]+封面完成+正文)｜视频号(iframe 内 locator 全失效→遍历 frames 传文件+描述 .input-editor/短标题 input；发表用 CDP 穿透点击) | scripts/agent-publish/bu_pub_{douyin,xhs,weibo,shipinhao}.py、_cdp_click.py、electron/main.js(scriptMap) | 四平台均实测发布成功；1.0.139 打包 |
| 2026-09-10 | **CDP 穿透点击（Python 移植 _cdp_click.py）**：移植 electron/fp-templates/_cdpClick.js——DOM.getDocument(pierce) 穿透 closed shadow+iframe → getBoxModel 准确视口坐标 → mouse.click。解决视频号 iframe 内自算坐标偏 400px 点空的问题（发表一击成功 (1496,801)→跳 post/list） | scripts/agent-publish/_cdp_click.py | 视频号发表验证有效 |
| 2026-09-10 | 微博/视频号发布流程手动逐步跑通（用户要求先跑明白再写脚本）：微博 9 步（页面锁定→真按钮上传→类型原创→标题 input[type=text]→封面完成→正文→发布校验）｜视频号 6 步（frame 遍历上传→描述/短标题坐标输入→封面编辑上传确认→CDP 穿透发表） | scripts/agent-publish/bu_pub_weibo.py、bu_pub_shipinhao.py | 均发布成功 |
| 2026-09-10 | **发布环境自检改造**（用户要求：不要在发布时装/弹窗）：①客户端启动 8s 后静默自检+后台安装（ensureBuEnvOnStartup，electron/bu-env.js 新模块）②装完弹窗告知已安装组件（Python版本内置/系统 + playwright + browser_use + 位置）③发布时只检查不安装（未就绪报错提示重启）④AGENT 自检新增「发布运行环境」项 + 新 API /api/agent/client-env（客户端上报）| electron/bu-env.js、electron/main.js、src/app/api/agent/client-env/route.ts、selfcheck/route.ts | ✅ 1.0.134 打包 |
| 2026-09-10 | **任务编号统一 seq**（用户二次反馈：创建显示#15、查询显示#76 混编）：BROWSER_TASKS/PUBLISH_TASKS 列表查询加 select seq + 显示改 seq；API rebuild 返回改 seq（之前只改了创建处，漏了查询处）| src/app/api/agent/chat/route.ts、browser-tasks/route.ts | ✅ 已推送（部署后生效 + 需回填历史 seq）|
| 2026-09-10 | **客户端 Python 环境三层自动就绪**：①内置环境 ②系统 python 缺库自动 pip 补装 ③都没有则下载内置 zip（不再弹窗）｜buPythonReady 改为必须校验 playwright（之前只查 browser_use → 系统 python 有 browser_use 无 playwright 被误判就绪 → 脚本 ModuleNotFoundError，任务74/75 实测）| electron/main.js | ✅ 1.0.132 |
| 2026-09-10 | **python-bu.zip 补 playwright**：OSS 上的内置环境 zip（88MB）根本没有 playwright/greenlet/pyee → 客户机器自动装完照样跑不了；追加 284 条目（playwright 1.62 + greenlet cp314 + pyee）→ 新 zip 89.5MB | scripts/add-pw-to-zip.py、upload-python-bu.mjs、python-bu.zip | ⏳ 待上传 OSS（本地 key 无写权限，需服务器跑 upload 脚本）|
| 2026-09-10 | **Chrome 路径转义修复**（浏览器不打开根因）：'C:\Program Files\...' 在 JS 里 \P 等无效转义 → 路径变 C:ProgramFilesGoogle... → existsSync 永远 false → 日志「未找到 Chrome」→ 脚本连不上 CDP；修正斜杠 + BROWSER_CANDIDATES 五处 | electron/main.js | ✅ 1.0.133 |
| 2026-09-10 | **files 下载 basename 修复**：name 参数带子路径（storage/1/xxx.mp4）导致本地仓库 0/1 落地 → 脚本拿不到视频；只取文件名 | electron/main.js | ✅ 1.0.130 |
| 2026-09-10 | **AGENT 发布确定性脚本（抖音+小红书）**：三层接线（chat route 任务 JSON → main.js 按平台分发 → bu_pub_douyin/xhs.py）；抖音封面 coverControl 层+按图方向+排除 semi -custom+button完成；小红书 PK 开关判断+＋号+系统文件框；话题 # 技改关联想浮层 | chat/route.ts、electron/main.js、scripts/agent-publish/*.py、build-local.mjs | ✅ 两平台 --no-publish 实测通过；用户实测「非常丝滑」|
| 2026-09-10 | **AGENT 发布确定性脚本（抖音+小红书）**：三层接线（chat route 任务带 JSON 结构化参数 kind/platform/videoName/title/topics/cover → main.js checkBrowserTasks 按平台分发 → Python 脚本 bu_pub_douyin.py/bu_pub_xhs.py，无脚本平台回退 bu_exec.py）+ 抖音封面（coverControl 层点击/按图方向选入口/排除 semi custom AI参考图区/button 完成）+ 小红书封面（PK 开关状态判断→＋号→系统文件框）+ 话题 # 技改关联想浮层 | src/app/api/agent/chat/route.ts、electron/main.js、scripts/agent-publish/bu_pub_douyin.py、bu_pub_xhs.py、scripts/build-local.mjs、package.json | ✅ 两平台 --no-publish 实测通过；1.0.129 打包（脚本进包已验证）|
| 2026-09-10 | 打包遗漏修复：build-local.mjs 自己生成 build.local.json（extraResources 硬编码）——package.json 的 extraResources 不生效 → 在 build-local.mjs 加 scripts/agent-publish | scripts/build-local.mjs | ✅ 包内校验脚本存在 |
| 2026-09-10 | 客户端更新保数据：electron-builder 自动更新会 RMDir /r 整个安装目录（data/python/storage 全删）→ installer.nsh customInit 备份 data/python/storage 到 $TEMP + customInstall 恢复 | electron/installer.nsh | ✅ 已打包（1.0.117 起）|
| 2026-09-07 | ①视频落个人仓库+本地镜像+技术标记剥离 ②封面尺寸跟随横竖屏+过抖音1000x752 ③订阅周期读durationMonths+周卡7天 ④浏览器统一系统Chrome+删Playwright CDP残留 ⑤AI打开外部网页走link卡片 ⑥发布顺序纠正(视频→等转码→标题→话题→封面) ⑦对话内重发#N ⑧userData改回安装目录data/ ⑨BU_STEP落盘 | chat route/ai-providers/selfcheck/notify/my-usage/claim-weekly/electron main+preload/page.tsx/bu_exec.py | 打包v1.0.113；封面browser-use上传与抖音弹窗冲突待解决 |
| 2026-09-06 | ①自由模式独立线：header 分流（自由模式极简宽松 header，只留发布红线+诚实；标准 header 不动）②多模态 forceVL→qwen3-max（图片不再乱码）③图生视频 t2v→i2v ④一键成片 userId 提顶层 ⑤封面尺寸 720×960 | ai-providers.ts / chat route / auto-compile route / page.tsx | 已提交 b22d106 |
| 2026-08-14 | API key 根因修复：①config 读写 .env.local 统一 DOTENV_CONFIG_PATH（之前写 cwd/standalone 被 rm -rf 删）；②16 段保存排除 ******** 掩码覆盖；③statusMap 加 minimax（配置后显示已配置）；④settings 分页 Tab（密钥/媒体/引擎/系统 4 组）；⑤Minimax 音乐测试命令 | config/route.ts / settings/page.tsx | 服务器验证 MINIMAX_API_KEY 保存成功；settings 语法 0；分页提交 2c18a72 |
| 2026-08-14 | Minimax AI 音乐生成接入：/api/music/generate（api.minimax.io music-3.0-free 同步返回 URL，2061 提示充值）+ 媒体舞台「AI 生成 BGM」（输入描述→生成→试听→用做背景乐） | minimax-music.ts / api/music/generate/route.ts / agent/page.tsx | 本地验证 401/400/key未配 链路通过；用户充值后即用 |
| 2026-08-14 | TTS 统一百炼：textToSpeech 去火山兜底（百炼 CosyVoice→硅基）；qwen3-tts 去火山 fallback（DASHSCOPE 缺失明确报错）——用户已删火山配置，防止一键成片/朗读因火山缺失失败 | ai-providers.ts / qwen3-tts.ts | 本地 agent TTS 百炼合成成功 |
| 2026-08-14 | settings 保存按钮移到 Tab 栏下方全局可见（分页后按钮误入 engine Tab→密钥 Tab 无法保存→key 一直不更新根因）；TTS 火山残留调用修复（ttsVolcanoFallback is not defined）| settings/page.tsx / qwen3-tts.ts | 本地验证 语法 0；服务器 curl 保存实测根目录 .env.local 写入成功 |
| 2026-08-14 | 音乐库完整功能：Minimax 音乐生成→OSS+MediaAsset 入库（type=audio/category=music）；/api/music/library（我的+公共/admin 公开/删除）；/music-library 页面（生成/试听/设公开）；/api/bgm 改公共音乐库+可用免费兜底（去掉失效 Pixabay 3 首）；Agent APPS+媒体舞台入口 | minimax-music/generate/library/bgm 路由 + music-library 页面 + agent 页 | 本地全链路验证通过（login/音乐库/BGM/页面 200）| 
| 2026-08-14 | 一键成片 BGM 全 AI 音乐库：/api/bgm 去 Pixabay（只公共音乐库）+ 前端去硬编码 4 首/文案改 AI 音乐库；媒体舞台 BGM 统一公共音乐库（原 BgmTrack 空表）；音乐库全链路验证通过（生成→OSS→入库→设公开→BGM 列表出现）| bgm 路由 / auto-compile 页 / agent media 路由 | 服务器验证 count 2（AI 音乐+免费）→改后纯 AI |
| 2026-08-14 | Agent 实时数据（画像/媒体舞台初始加载+对话后刷新）+ Minimax 音乐模型选择（settings free/music-3.0）+ 音乐计费（music-3.0=100点/首 先查后扣；free=0）| agent 页 / ApiKeyPanel / settings / config / music-generate | 语法 0；待部署 |
| 2026-08-14 | H3 接入（前端可选）：minimax-h3.ts 提交+轮询+图生首帧；generateVideo H3 分支；扣费 768P=50点/秒 2K=80点/秒；text-to-video 模型选项 | minimax-h3/ai-providers/text-to-video | key 验证通过（bad_request=权限过）；待部署 |
| 2026-08-14 | text-to-video 模型联动：选模型自动切换控件（H3 固定分辨率/时长4-15/禁长视频与参考视频）+ 实时成本预估（wan 100点/秒 H3 768P 50 2K 80）| text-to-video/page.tsx | 语法 0；待部署 |
| 2026-08-14 | 提示词库学习库独立 Tab（source=cheerselfai）+ API source 参数 + 抓取放宽（35 条入库）| prompt-templates/api/脚本 | 待部署 |
| 2026-08-14 | 抓取脚本封面入 OSS（poster/img 提取→下载→OSS→previewUrl；已入库无封面自动补转）——本地无 OSS 配置，服务器跑生效 | fetch-cheerself-prompts.mjs | 待服务器验证 |
| 2026-08-14 | ③提示词资源库独立页 admin/prompt-library（分页20/页+来源/模型筛选+封面卡片+复制/原文）+ API 分页 + admin 首页入口 | prompt-library/api/admin 页 | ea874f3 |
| 2026-08-14 | ④cheerselfai 内置源卡（prompt-sources 同步按钮+入库状态，后台 spawn 脚本）+ ⑤manage Tab 只显示自建（source=self）学习库走 learn Tab | prompt-sources/api/cheerself-sync/prompt-templates | b3fe5e3 |
| 2026-08-15 | 生成意图风格模板卡片：后端挑 3 条（图像带封面图/视频带视频，随机起点支持换一批）+ scene template 卡片 + 前端图/视频可看可播 +「用这个生成」回填 prompt +「换一批」| chat route / agent 页 | 本地 scene 空（本地库无学习库数据）；待服务器部署后测 |
| 2026-08-16 | 公共素材库改造：去删除/管理；卡片悬浮放大+推送(🤖推AGENT带media参数自动发附件 / 🎨推生图)；image-generator 读?media=下载转参考图 | media-library/image-generator/agent 页 | 0aff4b9/3b60b23 |
| 2026-08-16 | 封面自动转 OSS（prompt-sync 定时同步自动 migrateCover 外链→OSS）+ 抽公共 lib/cover.ts——6 源封面失效根因 | cover.ts/prompt-sync/prompt-sources | 待部署 |
---
| 2026-08-26 | 视频内容分析链路修复：①帧传OSS(公网URL给视觉模型,治根瞄编)②重新分析=回去看原视频+诚实③热榜只结合相关④上传不再自动切帧 | src/app/api/agent/chat/route.ts · src/app/api/storage/files/route.ts | 已推送 7b91d3e，语法 0 |
| 2026-08-25 | 浏览器通道登记中心（A内置Chromium优先/B前端平台清单+C平台能力表+D设计入档+引导⑥发布通道）| main.js/preload/agent页/TourGuide/chat route/PROJECT | 全部语法0已推送；待打包1.0.55 |
| 2026-08-24 | 视频/图片生成防丢 + #301修复 + 找回丢失视频 + 封面3选1 + 生成中反馈 + 自动轮询 + 一键成片入仓库 + 附件视频卡片 + frames API + 视觉理解前置 + 登录态注入 + 自动入库/自检80% | chat route / agent页 / video-task-manager / auto-compile / selfcheck / recover脚本 / video-task-status API / frames API / generate-image | 全部语法0已推送；服务器待部署；v1.0.51打包中 |
| 2026-08-14 | 数字人全链路 wan2.2-s2v：TTS 改百炼 CosyVoice(edge-tts 弃用)、异步提交+查询(修复504)、live 直播片段适配(照片+文案→口播)、Minimax 后台接入(key 输入+测试+保存)、crawl4ai B/C 方案(文本抓取修复 markdown dict+阈值；截图+视觉读图) | ai-providers/digital-human/live-stream-engine/live 页/settings/ApiKeyPanel/config/test-key/crawl4ai | 数字人异步提交验证通过(taskId+PENDING)；待部署测试 |
| 2026-08-13 | 客户端改回纯壳 v1.0.30（彻底解决 code14/数据空/两套）：根因=Next standalone 把后端+管理后台+API key+本地库配置(.env.local 含 DATABASE_URL/全部 key)全打包进客户端→login 本地执行+代理与本地路由互相干扰。方案 A 纯壳：main.js 直接 loadURL(https://ai-niuma.cc)，build-local 不再 next build/不打包 standalone，本地能力(指纹/语音/摄像头)走 preload 桥，管理后台仅网页。另修 login cookie secure 按 x-forwarded-proto 判断(f86ba55) | electron/main.js / scripts/build-local.mjs / src/app/api/auth/login/route.ts | v1.0.30 打包 275MB，CDP 验证页面加载 ai-niuma.cc/login；待部署 |
| 2026-08-12 | 25 条隐患批量修复（v1.0.29）：#1 JWT_SECRET 去 fallback+代理模式跳过本地验签; #2 Agent 工具链前移扣费(文生图12点/张/视频100点/秒/成片, 不足 TOOL_REJECT 弹套餐); #3-6 debug-oss admin-only/proxy-download 防SSRF/storage IDOR/video-get 路径遍历; #7 adb:shell 防注入+will-navigate 拦 file://; #9 token-wallet 异常拒绝+两步查询容错; #10 storyboard retry 防并发; #12-16/18-21/24 中低危; 套餐额度显示修复(年卡 500 点) | middleware/login/token-wallet/chat/storage/video-get/debug-oss/proxy-download/main.js/export/tts/prompts-public/digital-human/agent/PromptLibraryDialog | 本地验证通过(对话扣费/selfcheck 499点/全页面 200); 打包 v1.0.29 待完成

## 2026-08-10
| 2026-08-29 | AGENT工具箱+BrowserUse融合：AgentTool注册表/API/注入/管理页/browser_use_execute注册（admin）/AgentBrowserTask/客户端执行器（Electron→Python browser-use）+ bu_exec.py | prisma/schema.prisma, src/app/api/admin/agent-tools/*, src/app/api/agent/chat/route.ts, src/app/admin/agent-tools/page.tsx, src/app/api/agent/browser-tasks/route.ts, scripts/browser-use/bu_exec.py, scripts/seed-agent-tool.cjs, electron/main.js | 本地语法全过+db push成功；待部署/打包验证 |
| 2026-08-29 | Browser Use 全链路修复：bu_exec key/Chrome锁定/SingletonLock + main.js spawn传key/bu:open改Chrome + browser-config API——本地实测小红书登录态正常 | scripts/browser-use/bu_exec.py, electron/main.js, src/app/api/agent/browser-config/route.ts | 通过（小红书发布页登录态） |
| 日期 | 操作内容 | 改动文件 | 结果 |
2026-08-18 | 发布流程v3：四步流程（确认视频含版权规则→推荐封面/标题/标签可跳过→确认参数→建任务多平台自动执行）+ publish_content 多平台/topics提取/coverUrl + 前端自动启动浏览器 | chat/route.ts、my-fingerprint/page.tsx、schema（AgentPublishTask.coverUrl） | ✅ 12ea0b2+c40dde2+已推
2026-08-18 | 隐患②③④⑤：spendTokens 事务化；checkout 惰性清理过期订单；删 subscription-guard 死代码；周卡防重复确认 | token-wallet.ts、payment-config.ts、两 checkout、subscription-guard 删除 | ✅ 已推
2026-08-18 | ②数据中台+③发布真执行：my-fingerprint 3s 轮询接 Agent 任务+平台绑定+自动执行+平台校验；dispatcher publish→agentPublishTask；Agent 新增 query_publish_tasks；MediaCrawler trending 真实现（抖音热榜+入库 CrawledTrending） | my-fingerprint/page.tsx、engine-dispatcher.ts、agent/chat/route.ts、crawler-client.ts、mediacrawler/trending/route.ts | ✅ 781b8e1+1e6b3f0 已推，待部署验证
|---|---|---|---|
| 2026-09-13 | 登录态两条硬需求：①卸载器保住 data/python/storage（重装不丢登录态）②bu_check 加 Cookie 复制重试+缓存回退（打开浏览器时 Chrome 独占锁→WinError 32→原来返回空导致平台✓全消失）③前端 detect 空结果保留上次 | electron/installer.nsh, scripts/browser-use/bu_check.py, src/app/agent/page.tsx | ✅ 实测通过（Chrome 运行+锁定时仍返回 6 平台登录态 CACHED:1）| v1.0.155 |
| %s | 标题统一16字（状态机模板拼满/视觉提示严格16字/6平台脚本截16）+ 视频号双封面（个人主页卡片3:4+分享卡片4:3）+ 微博上传完成判断(240s)+封面完成判断(60s) + 快手PK开关已开则不点 + v1.0.153 打包 | chat/route.ts, scripts/agent-publish/bu_pub_{douyin,xhs,weibo,shipinhao,kuaishou,bilibili}.py, electron/changelog.json | ✅ 1.0.153 打包完成(333MB)
| 2026-09-13 | 发布链路大修（用户实测纠正）：微博入口改首页+隐藏 input 直传 / 登记口 6 平台改登录页 / 6 脚本 connect_cdp 自我递归 BUG / 快手 PK 封面先开后传 / 视频号登录态检测 / 统一延时 / 打勾 skips 生效 | scripts/agent-publish/*.py, src/app/agent/page.tsx, src/lib/agent/publish-task.ts, electron/main.js | ✅ 提交 4681013，打包 1.0.151 |
| 2026-09-12 | 发布链路大修 8 项（浏览器不打开/视频号 detached/脚本秒崩/点B站开抖音/打勾不生效/延时统一/平台按钮补视频号/文案过时）+ 模式隔离第1步（抽 tools.ts + prompts.ts + 状态机块边界注释 + 文档） | electron/main.js, scripts/agent-publish/*.py, src/lib/agent/{tools,prompts,publish-task}.ts, src/app/api/agent/chat/route.ts, src/app/agent/page.tsx, PROJECT.md | ✅ 已提交，打包 1.0.150 |
| 08-11 | 修复下载 404：上传更新文件到 public/updates 后需 cp 进 .next/standalone/public/updates + pm2 restart（否则 standalone 服务旧快照）；v1.0.20 发布（landing/左栏重构/头部三卡片/指纹发布/热点去 vvhan/历史恢复） | 多文件 | ✅ 已记录流程 |
| 08-11 | admin/settings 改造：修 Serper 保存无效 + statusMap 全量状态 + 顶部汇总条 + vvhan/Serper 徽章/测试 + test-key 加 serper/vvhan；selfcheck 优化（点数显示套餐额度/ASR 改 8765/热点 401 修复）；热点白名单；spendTokens 下限 0；套餐编辑 PUT 修复；sync-db.cmd | 多文件 | ✅ 0dde31c 已推送，待部署 |
| 08-10 | 生成历史+查看提示词（/api/generation-records + image/text-to-video 历史区：prompt 复制/模型/复用）+ 文生图升级 qwen-image-3.0-pro（修中文乱码）+ 用户画像登记表单（首登 → AgentMemory） | src/app/api/generation-records、image-generator、text-to-video、ai-providers、agent/page.tsx、memories | ✅ 已推送（见 git log） |
| 08-10 | 提示词发布到素材库：PromptTemplate.published（默认不推）+ publish API + admin 发布/下架按钮 + media-library「提示词」Tab（复制/用这个生成）+ 封面转存 OSS（migrate-covers）+ 标签筛选修复 | prisma/schema.prisma、api/admin/prompt-templates/publish、api/prompts-public、media-library/page.tsx、prompt-sources 等 | ✅ 已推送，验证发布/下架即时生效 |
| 08-10 | 提示词源独立页 /admin/prompt-sources（6 内置源/条数/状态/间隔/单源刷新/自定义/服务端定时拉取 + PromptSource 表）+ prompt-templates 移除同步区块收口 | src/app/admin/prompt-sources/page.tsx、src/app/api/admin/prompt-sources/route.ts、prisma/schema.prisma、src/app/admin/prompt-templates/page.tsx | ✅ 已推送，本地验证 6 源 1201 条 |
| 08-10 | 二期B：/ai-video-tasks 分镜节点链页（列表+节点链/缩略图/预览/重试/prompt编辑/成品/轮询/admin全部）+ storyboard list+PATCH + 提示词库升级（表扩展 tags/author/coverUrl/imageMode/sourceKey + prompt-sync 多源同步 jsdelivr + 标签筛选/封面/作者，验证 323 条入库） | src/app/ai-video-tasks/page.tsx、src/app/api/agent/storyboard/route.ts、src/app/api/admin/prompt-sync/route.ts、prisma/schema.prisma、admin/prompt-templates/page.tsx | ✅ 已推送（见 git log） |
| 08-10 | 二期B：create_ai_video 一句话成片（自动分镜→创建任务→后台生成，两段式费用确认）+ 修复 storyboard 动态 import 路径致服务器 build 失败 | src/app/api/agent/chat/route.ts | ✅ 已推送，服务器部署验证通过（/api/agent/storyboard 401 正常） |
| 08-10 | 二期A：AI 全自动成片——generate_video >15s 自动走 generateLongVideo（首尾帧接力）+ 成本预估两段式确认 + generate_storyboard 分镜协议 + 分镜任务引擎（StoryboardTask 表/后台逐镜/单镜重试/进度，Agent 工具 create_storyboard_task/query_storyboard） | src/app/api/agent/chat/route.ts、src/app/api/agent/storyboard/{route,retry/route}.ts、prisma/schema.prisma | ✅ c08031f 已推送，本地端到端验证通过（创建/进度/失败路径），待部署 |
|---|---|---|---|
| 08-10 | 成片诚实协议：chat prompt 加「成片诚实协议」（先查库/禁编素材/BGM/预填、提议句式）+ search_storage 描述禁编 + 免费素材站引导 | src/app/api/agent/chat/route.ts | ✅ 推送 f269c22，待部署 |
| 08-10 | 二期规划定稿：AI 文生视频全自动成片（分镜→generateLongVideo 首尾帧接力→成本提示→三期 BGM/发布）+ 中转站调研清单（OpenRouter/fal/Replicate/infistar，须覆盖文生图/图生视频/克隆视频） | PROJECT.md 六、记忆 | ✅ 规划入库，待执行 |

## 2026-08-05

| 操作 | 改动文件 | 结果 |
|---|---|---|
| AI 自检 A+B + 角色化应用卡片 + 左侧信息面板（2026-08-08）：① /api/agent/selfcheck 一键体检 8 项（账号/订阅/点数/记忆/语音/TTS/热点/模型）② 打开自动静默自检+首次弹窗+按钮/语音「自检」触发 ③ 声纹球下应用卡片按角色过滤（admin 全量/editor 中量/end-user 核心）+颜色区分字体边框+文字宽度自适应+错落排列 ④ 左栏信息面板（角色徽章/订阅/点数/模型/记忆/会话统计） | src/app/api/agent/selfcheck/route.ts、src/app/agent/page.tsx | ✅ 端到端验证（8 项返回、本地环境项正常标❌、逻辑正确）；dev 200、语法 0 |
| admin 后台减负（2026-08-08）：删除 8 个无实际作用页面+6 个 API（tasks 死链/briefings 一次性/review 无 API/social-accounts+account-groups 发布未落地/poi-addresses 低频/diagnosis-reports+diagnostics 脚本诊断摆设——依赖未落地设备生态）+ 清理 admin 首页 7 处入口；无残留引用 | src/app/admin/{tasks,briefings,review,social-accounts,account-groups,poi-addresses,diagnosis-reports,diagnostics}、src/app/api/{social-accounts,account-groups,poi-addresses,admin/diagnostics,admin/diagnosis-reports,admin/briefings}、src/app/admin/page.tsx | ✅ 删除完成、语法 0、无残留引用、dev 200；数据表保留（自动化落地可重建） |
| prompt-templates 页面重构（逻辑分组 4 Tab）：📚模板管理 / 🌐素材抓取（来源+数量+【抓取日志】逐条反馈成功/失败原因）/ 🤖AI生成 / 🧹数据维护；每个操作 confirm 说明「抓什么/多少/从哪抓」；AiShort 导入明确标注"约800条非抓图"防混淆 | src/app/admin/prompt-templates/page.tsx | ✅ 语法 0、dev 200 |
| 抓取日志后端：/api/fetch-prompts 返回逐条 logs（✅成功/❌失败+原因/⏭重复），前端实时显示 | src/app/api/fetch-prompts/route.ts | ✅ 语法 0 |
| 真相澄清：那 129 条 = AiShort 批量导入的 AI 工具 prompt（非抓图），保留 | 服务器库 | ✅ 不删 |
| media-library 改版（promptbase 风格）：搜索框 + 卡片悬停高亮 + admin「🔧 管理」模式（全选/批量删除仅 admin 可见，普通用户无删除入口）+ 后端 DELETE ?ids= 批量 | src/app/media-library/page.tsx、src/app/api/media-library/route.ts | ✅ 语法 0、dev 200 |
| promptbase 免费区抓取源（方案 A）：列表页解析卡片（标题+缩略图）→ 转存 OSS → qwen-vl 生成提示词；Pixabay 无新素材时自动兜底；无 Pixabay key 时 image 也可抓 | src/app/api/fetch-prompts/route.ts | ✅ 端到端验证：候选解析成功、批量循环正常（本地无 OSS key 跳过属预期） |
| 抓取数量可配（2026-08-07）：admin/prompt-templates 加「条/批」输入（默认 10，上限 20）+ /api/fetch-prompts?count=N 批量循环（每条独立转存 OSS/去重，失败跳过不中断）；Pixabay 关键词池扩展 8 组减重复 | src/app/api/fetch-prompts/route.ts、src/app/admin/prompt-templates/page.tsx | ✅ 语法 0、dev 200、count 参数验证通过（400=本地无 Pixabay key 正常拦截）；Lexica API 已关闭(500)/Civitai 限流(503)，暂不加免费源 |
| 服务器清理（2026-08-07）：删除误建空库 dev.db（相对路径导致）+ 删 AgentSessionBrain 表（其它 AI 遗留、代码 0 引用）→ schema 与库一致，prisma db push 恢复可用 | 服务器 /root/AiMarketing | ✅ system-config HTTP 401（连真库正常）；文档已改「db push 可用」 |
| 服务器部署完成（2026-08-07）：git reset 到我们版本 + standalone 启动（server.js + DATABASE_URL 绝对路径）+ 手动 SQL 加 User 5 字段 + AgentPublishTask；修复 500 根因（standalone 不读 .env → pm2 注入 env）；网页验证通过 | 服务器 /root/AiMarketing | ✅ system-config HTTP 401（连上真库）、error log 无 P2021、网页 500 全消；更新流程已写入 PROJECT.md 八 |
| 安装包 1.0.19 打包完成（连服务器版）：dist-rel/AI-Marketing-Setup-1.0.19.exe（342.9MB）| 本地打包 | ✅ API 全走 ai-niuma.cc，可去其它机器测试 |
| 服务器关键坑记录：⚠️ 禁用 prisma db push（会删 AgentSessionBrain 表）；pm2 启动必须带 DATABASE_URL；.next/static+public 需复制进 standalone | PROJECT.md 八 | 已写入文档防遗忘 |
| Serper（Google 搜索）接入：key 实测可用（网页/视频/新闻）→ admin/settings 加 Serper key 输入（.env.local SERPER_API_KEY）+ /api/agent/search（web/videos/news）+ Agent 新增 search_web 工具（语音「帮我搜XX」呼出）| src/app/api/admin/config/route.ts、src/app/admin/settings/page.tsx、src/app/api/agent/search/route.ts、src/app/api/agent/chat/route.ts、.env.local | ✅ 实测：语音链路 AI 自动搜到 5 个 B站/油管视频教程；语法 0 诊断、dev 200；前台 UI 未动（待讨论）|
| AI 设置第一批（白龙马设置对标）：用户级 音色选择+试听（7 个百炼 CosyVoice 音色）/ 回复温度滑块（0~1.5）/ 语音灵敏度（VAD 阈值+停顿时长）→ schema 4 字段 + /api/agent/prefs + agent 页 ⚙️ 弹窗 + chat 温度注入 + speak 带音色 | prisma/schema.prisma、src/app/api/agent/prefs/route.ts、src/app/api/agent/chat/route.ts、src/lib/ai-providers.ts、src/app/agent/page.tsx | ✅ db push+generate、GET/PUT 验证通过、语法 0 诊断、dev 200 |
| 语音三项优化：① 百炼热词表（文生视频/一键成片等 30 词防同音误识）+ prompt 同音兜底；② TTS 播放音量 WebAudio 分析驱动声纹球波动（朗读/说话都动）；③ 朗读不读 URL（过滤为「链接已发到对话」）+ 视频卡片嵌入播放器（B站/油管 iframe，其他本地 video）| scripts/dashscope_asr_server.py、src/app/api/agent/chat/route.ts、src/app/agent/page.tsx | ✅ 语法 0 诊断、dev 200；代理已重启（热词生效）|
| 语音回复无声修复：TTS 接口验证正常（真实 mp3），根因=浏览器/Electron 自动播放策略拦截 → main.js 加 autoplay-policy no-user-gesture-required + 前端 play 失败二次重试 | electron/main.js、src/app/agent/page.tsx | ✅ 语法 OK；客户端重启后生效 |
| 语音循环 bug 修复：orbStateRef TDZ（补回时放错位置）+ asrTimer 作用域泄漏（try 内声明 finally 引用）| src/app/agent/page.tsx | ✅ tsc 0 未定义引用、语法 0 诊断 |
| 语音对话循环（白龙马式）：点声纹球进入对话模式 → 说话停顿自动发送 → AI 回复自动朗读 → 朗读完自动再听 → 插话打断朗读；说「停/退出对话」退出 | src/app/agent/page.tsx（startVoiceListen/stopVoiceListen/dialogMode/barge-in 回声基线） | ✅ 语法 0 诊断、dev 200；修复了此前多轮转义破坏的 
 正则（split/resRe 等 6 处） |
| 语音边说边执行：百炼流式 sentence_end 自动发送（不用点停止）+ 停止词拦截（停/算了）+ TTS 朗读中语音打断 | src/app/agent/page.tsx、scripts/dashscope_asr_server.py、src/app/api/agent/asr-config/route.ts | ✅ 语法通过、dev 200；测试脚本验证 0 错误消息（百炼链路通） |
| 自定义 AI 名称：User.agentName（schema 新字段）+ SystemConfig.agent_name 全局兜底 + chat prompt 注入 + 标题栏 ✎ 改名弹窗 | prisma/schema.prisma、src/app/api/agent/name/route.ts、src/app/api/agent/chat/route.ts、src/app/agent/page.tsx | ✅ PUT/GET 验证（麦子）成功；db push+generate 完成 |
| 语音 ASR 换百炼实时：弃讯飞（未开通 RTASR 10105），Python 双向 ws 代理（127.0.0.1:8766）连百炼 paraformer-realtime-v2 | scripts/dashscope_asr_server.py、src/app/agent/page.tsx、src/app/api/agent/asr-config/route.ts | ✅ 代理链路通（run-task/finish 带 payload+task_id 修复），FunASR 兜底保留 |
| 讯飞 RTASR 流式语音接入：用户提供讯飞凭据（APPID/APIKey）→ .env.local 配置（明文不落文档）→ /api/agent/asr-config（后端生成 signa=HMAC-SHA1(apiKey, MD5(appid+ts))，apiKey 不下发前端）→ 前端 startRecording 改流式（getUserMedia + AudioContext 16k + ScriptProcessor → PCM → wss://rtasr.xfyun.cn/v1/ws，实时文本上屏，停止即发送），FunASR 兜底；Python 实测 RTASR 认证通过（code 10105=空音频业务错，非认证错） | .env.local、src/app/api/agent/asr-config/route.ts（新）、src/app/agent/page.tsx | ✅ 认证验证通过，待用户实测语音 |
| 记忆写入闭环验证通过：发现并修复「AI 口头答应不实际调工具」问题（百炼对写入型工具触发弱）→ 新增后端自动画像提取（用户消息含行业/平台关键词自动写 AgentMemory，不依赖模型判断）；实测 AgentMemory 2 条（admin/餐饮/抖音）、客户画像接口返回、read_knowledge 工具调用正常、媒体舞台 BGM 4 首；修复 read_knowledge 模板字符串 heredoc 换行 bug + 工具定义括号错位 | src/app/api/agent/chat/route.ts、prisma/dev.db | ✅ 端到端验证通过 |
| 右栏四功能真通：①修复记忆 userId 不一致 bug（写入用数字 id/查询用 username → 永不匹配 → 画像空；4 个记忆工具统一改 username）②新增 read_knowledge 工具+prompt 引导（AI 读 AIAgent 训练文档，回答引用项目知识）③seed 4 首 Pixabay BGM 入库（媒体舞台音乐库有内容） | src/app/api/agent/chat/route.ts、prisma/dev.db（seed） | ✅ 语法通过，dev 200 |
| 语音链路修复+球修正：①DATABASE_URL 改绝对路径（相对路径 sqlite 打不开库→登录失败→全站401→热点空，根因修复后登录+热点正常）②funasr_asr.py 改本地模型路径（零下载）③新增 scripts/funasr_server.py 常驻识别服务（模型加载一次秒级识别，asr 路由优先调服务自动 spawn）④录音 MediaRecorder 明确 opus codec + 最短 700ms 提示⑤VoiceOrb 去拖拽（点击录音优先）+ rotX 0.1 平视正圆⑥三栏卡片化（白龙马 panel 边框+圆角）⑦声纹球 240px 光晕 -inset-3 | src/app/api/agent/asr/route.ts、scripts/funasr_asr.py、scripts/funasr_server.py（新）、src/app/agent/page.tsx、src/components/VoiceOrb.tsx、src/app/globals.css、.env.local | ✅ funasr 服务 ready 验证通过 |
| 语音 UI 精简（用户确认）：去品牌区🎤话筒、输入区🎤话筒、输入区🔊自动朗读按钮、声纹球下「开启连续聆听」按钮；完全去掉自动朗读（回复不再自动朗读）；彻底去掉连续聆听功能；声纹球 128→200px（保留点击=说话，拖拽旋转）；删 orbStateRef 残留 | src/app/agent/page.tsx | ✅ 语法通过，dev 编译 200 |
| ✅ 纯本地架构全部验证通过：客户端启动（3377）、本地登录成功（admin id=1 role=admin，纯本地库）、热点/对话/语音走本地；PROJECT.md 顶部新增「架构定案」章节 + 新记忆 aimarketing-local-first 防失忆 | 全部本地组件 | ✅ 验证通过 |
| 纯本地架构定案（2026-08-06）：移除 API 代理（next.config.js）、数据库打包进 standalone（build-local.mjs 复制 dev.db）、main.js 注入 DATABASE_URL 绝对路径、schema 改 env("DATABASE_URL")+generate+本地 .env.local 配置；验证本地登录成功（admin id=1 role=admin 纯本地库）；修复 .env.local 换行拼接 bug、main.js 正则转义 bug | next.config.js、scripts/build-local.mjs、electron/main.js、prisma/schema.prisma、.env.local | ✅ 本地登录验证通过，打包 365.5MB |
| 最终打包成功（363.7MB，含全部规划 C1-C4 与所有功能）；修复打包期 3 个 bug：prisma dll 被 dev 占用（停 dev 后重打）、my-fingerprint 回写 reportAgentTask 两处插入位置（移出 map 回调）、addToQueue 重复声明 | dist-rel/AI-Marketing-Setup-1.0.19.exe | ✅ 客户端已启动（生产模式 3377） |
| C3+C4 完成：①新增 project_overview 工具（项目概况：套餐/点数/绑定平台/素材/AI生成）+ prompt 引导「了解项目」②修复百炼 qwen tool_calls OpenAI 格式兼容（{function:{name}} vs 扁平）——工具调用此前全 undefined ③C4 多步编排 prompt（追热点→出文案→做成片→发布四步） | src/app/api/agent/chat/route.ts | ✅ C3 实测成功（AI 基于项目数据回答）、C4 编译通过 |
| C2 发布闭环完成：①新模型 AgentPublishTask（platform/videoName/title/description/topics/status）+ prisma generate②API /api/agent/publish-tasks（创建/查询待发布）+ [id]/done 回写③publish_content 增强（账号已绑定+视频/文案齐备→创建任务返回 PUBLISH_QUEUED）④my-fingerprint 自动导入待发布任务入队 + 执行完成回写（复用 7 平台脚本） | prisma/schema.prisma、src/app/api/agent/publish-tasks/（新）、src/app/api/agent/chat/route.ts、src/app/my-fingerprint/page.tsx | ✅ API 实测创建/查询成功 |
| C1 连续聆听+打断完成：①提取共用 handleRecordingBlob（点按/连续共用 ASR+识别即发送）②连续聆听开关（声纹球下方）③常开麦克风 VAD（音量阈值 0.045，静音 2s 自动断句发送）④barge-in（TTS 播放中连续 3 帧高音量→打断进入聆听）；修复 orbStateRef TDZ（移到 orbState 定义后） | src/app/agent/page.tsx | ✅ 语法通过，dev 200 |
| TTS 弃火山改百炼：textToSpeech 链调整为百炼(CosyVoice)优先→火山兜底→硅基；/api/agent/tts 改走 textToSpeech（不再强制火山）；实测朗读成功（百炼 CosyVoice 未开通→火山失败→硅基 CosyVoice2 兜底发声 200）；一键成片/后期本就走百炼 qwen-tts 无需改 | src/lib/ai-providers.ts、src/app/api/agent/tts/route.ts | ✅ 实测可发声 |
| 语音控制三件事：①B 识别即发送（ASR 成功后语音文本直接 sendMessage 进 LLM，AI 用 open_page 开应用/生成/查询）②A1 本地 FunASR 安装完成（funasr 1.4.1 + torchaudio 2.9.1 + paraformer/vad 模型下载，离线可用）③后台 admin/settings 新增「火山引擎 ASR（语音识别）」配置区块（API Key/AppKey/AccessKey/ResourceID → .env.local VOLC_ASR_*，config/route.ts 读写 + 页面状态链路） | src/app/agent/page.tsx、src/app/admin/settings/{page.tsx, components/ApiKeyPanel.tsx, types.ts}、src/app/api/admin/config/route.ts、Python 环境（funasr/torchaudio/模型） | ✅ 全部完成；A2 火山 ASR 待用户提供凭据后接 /api/agent/asr 云端分支 |
| 应用随行体验修复：①纯聊天分支回复为空且有场景时给自然引导语（AI 自由度）②autoSpeak 默认开启（自动朗读）③紧凑模式小窗实体化（不透明背景）并 top 52px 避让标题栏（展开/关闭按钮可用）④本地 npx prisma db push 同步新表（suggestions 500 修复）⑤memories 路由 userId→username 修复 | src/app/api/agent/chat/route.ts、src/app/api/agent/memories/route.ts、src/app/agent/page.tsx、src/app/globals.css、prisma/dev.db | ✅ 语法通过、接口实测成功 |
| 应用随行（AI 工作区）完成：agent 页左面板「📱 应用」列表（一键成片/文生视频/AI文案/素材库/指纹浏览器/数据看板/AI生图）→ 打开为 iframe 大屏（左 2/3）+ AI 对话栏右 1/3 常驻（body.app-mode）；紧凑模式 AI 收右下角悬浮小窗（body.app-compact）；与热点大屏互斥；打开时 currentApp 注入 system prompt（AI 知道你在哪个应用）；语音「关闭应用」 | src/app/agent/page.tsx、src/app/api/agent/chat/route.ts、src/app/globals.css | ✅ 语法通过，dev 编译正常，待用户客户端测试 |
| Agent 大脑改百炼：新增 ai-providers.dashscopeFunctionCall（qwen-plus，OpenAI 兼容 function calling）；chat/route.ts 默认大脑 DeepSeek→百炼（图片多模态仍 Agnes）；实测：DeepSeek key 无效(401, 尾581a)、百炼 key 有效(尾e0b3)、对话接口成功返回 | src/lib/ai-providers.ts、src/app/api/agent/chat/route.ts | ✅ 端到端验证通过 |
| agent 页面已登录态增加「⚙ 管理」入口（仅 admin 角色显示，router.push('/admin') 进管理后台配 API Key） | src/app/agent/page.tsx | ✅ 语法通过，HMR 生效（登录后显示） |
| 本地数据库添加测试账号：admin / admin123（role=admin，enterprise，paidFeatures 全开；scrypt 哈希与 login/route.ts 一致）；登录接口实测成功、错误密码拒绝 | prisma/dev.db（User 表） | ✅ 可登录 |
| 修复登录/注册入口丢失：agent 页面根容器 fixed inset-0 z-50 全屏盖住全局 Navbar（登录/注册/语言切换不可见）→ 在左面板品牌区直接加登录/注册/用户名/退出按钮（useAuth logout + router.push） | src/app/agent/page.tsx | ✅ HMR 生效，首页已含登录/注册 |
| 本地部署测试环境：npm run dev（无 API_TARGET，页面+API 全本地，含 media/suggestions 新 API）+ 客户端 SERVER_URL=http://localhost:3000 启动（dev 模式）；本地 dev.db 无用户需注册；git fetch 失败（无凭证）但本地 origin/master=HEAD=9c617e9（远程无新提交，其他 AI 改动不在 master） | 本地 dev 服务 + 客户端 | ✅ 就绪供用户测试 |
| ⚠️ 重要修复：阶段0 的 API 代理实际未生效——Next.js 默认 rewrites() 是 afterFiles（文件系统路由优先），本地 standalone 含全部 API 路由 → 在本地执行连本地空库（suggestions 报 User 表不存在）。改为 beforeFiles 强制 /api/* 代理到服务器；验证：suggestions 远程 404（不再本地执行）、hotspots 返回远程真实数据 | next.config.js | ✅ 修复并重新打包验证 |
| 阶段2 主动推送完成：新 /api/agent/suggestions（画像缺失/任务进度/热点/成片 4 类规则建议）+ 前端登录后 8s+每 10 分钟轮询 + 欢迎区建议条（点击发送/✕关闭） | src/app/api/agent/suggestions/route.ts（新）、src/app/agent/page.tsx | ✅ 语法通过、构建打包验证 |
| 阶段1 终端流完成：右栏「🖥 终端流」面板（chat 请求耗时/工具步数/失败日志，等宽字体，保留 60 条） | src/app/agent/page.tsx | ✅ |
| 阶段1 UI 补齐（白龙马克隆）：①语音打断（朗读中点击声纹球停止）②Scene 卡片完善（SceneCard 接口扩展 video/confirm/link/task + 渲染 + .scene-in 动画 + chat prompt 场景类型说明）③媒体舞台（新 /api/agent/media 聚合 BGM+生成记录；右栏面板音乐试听/AI视频播放）④文档面板（右栏智能体知识库，调 /api/ai-agent）⑤main.js 外链走系统浏览器（setWindowOpenHandler+will-navigate） | src/app/agent/page.tsx、src/app/api/agent/media/route.ts（新）、src/app/api/agent/chat/route.ts、src/app/globals.css、electron/main.js | ✅ 构建成功、打包 304.6MB、客户端启动验证通过（终端流未做，后续） |
| 阶段0 客户端本地化完成：next.config.js（output:standalone + API_TARGET 条件 rewrites）、electron/main.js（生产模式内置本地 server 端口3377 + 回退远程 + 退出清理）、build-local.mjs（standalone 构建 + 清理 public/updates + extraResources）；端到端验证：页面本地渲染、/api 代理返回远程真实热点、客户端内置 server Ready 229ms、关闭零残留、打包 304.8MB | next.config.js、electron/main.js、scripts/build-local.mjs | ✅ 完成 |
| 修复打包卡死：Next standalone 自动复制 public/updates（4.7GB 旧安装包）导致 electron-builder 压缩/签名卡死（7za CPU 3557s）→ build 后强制清理 standalone/public/updates；用户已删除 public/updates 旧包 | scripts/build-local.mjs | ✅ |
| 一键打包脚本全流程验证：node scripts/build-local.mjs 6 步全自动跑通（退出码 0，产物 AI-Marketing-Setup-1.0.19.exe 209.2MB）；修复 spawnSync npx 需 shell:true 的 Windows 兼容问题 | scripts/build-local.mjs | ✅ 验证通过 |
| 新客户端退出逻辑验证：SERVER_URL=localhost:3000 启动新打包客户端 → CloseMainWindow 优雅关闭 → 8 秒后残留进程=0；rm -rf win-unpacked 成功（不再 Device busy） | 新打包的 win-unpacked | ✅ 残留问题彻底解决（before-quit 修复生效） |
| 彻底解决打包/残留问题：① 新增 scripts/build-local.mjs 一键打包脚本（taskkill 清残留 + 7za 补丁自动应用 + zip 缓存校验 + build.local.json 动态生成 + 镜像打包）；② 7za wrapper 持久化到 scripts/7za-wrapper-win-x64.exe；③ 修复 electron/main.js before-quit（async 不被 await 导致 Playwright 残留 → preventDefault+await+app.exit，需重新打包生效） | scripts/build-local.mjs（新）、scripts/7za-wrapper-win-x64.exe（新）、electron/main.js、PROJECT.md | ✅ 语法验证通过；完整打包验证待客户端关闭后执行 |
| 本地部署+打包+启动：npm run build 成功 → npm start 启动后端(:3000) → electron-builder 打包成功(dist-rel/AI-Marketing-Setup-1.0.19.exe, 219MB) → SERVER_URL=localhost:3000 启动客户端测试 | 后端构建产物 .next、dist-rel/ 打包产物；临时文件 build.local.json 已删 | ✅ 客户端窗口运行正常(Responding=True)，页面渲染正常 |
| 修复打包环境问题：electron zip 缓存损坏(手动重下+镜像)；winCodeSign 解压 darwin 符号链接失败(Windows 无权限) → Rust 包装器替换 7za.exe(-snld→-snl-) | node_modules/7zip-bin/win/x64/7za.exe(临时 hack，npm install 后需重建)、electron/winCodeSign 缓存 | ✅ 打包通过，详见 PROJECT.md「本地打包指南」 |
| 修复 ISSUES #1（🔴 架构级）：middleware 只解 JWT payload 不验签 → 用 Edge Web Crypto（HMAC-SHA256）验签，密钥与 login/route.ts 一致（JWT_SECRET 环境变量或默认值）；篡改/错误密钥/损坏 token 均 401 | src/middleware.ts | ✅ 4 用例本地测试通过 + 语法通过，未提交 git（需服务端 build 部署生效） |
| 修复 ISSUES #6：/api/admin/editor-quota 恒 403（(request as any).user 从未注入）→ 改 getAuthFromHeaders 标准鉴权（401/403） | src/app/api/admin/editor-quota/route.ts | ✅ 语法通过，未提交 git |
| 修复 ISSUES #3：#/api/admin/usage-stats 无角色校验 → 加 admin 鉴权（401/403） | src/app/api/admin/usage-stats/route.ts | ✅ 语法通过，未提交 git |
| 修复 ISSUES #4：/api/admin/ai-generate-title 无角色校验 → 加 admin 鉴权（401/403） | src/app/api/admin/ai-generate-title/route.ts | ✅ 语法通过，未提交 git |
| 修复 ISSUES #5：/api/subscription/buy 无鉴权免费开通后门 → 按用户确认删除路由（全项目无调用方） | src/app/api/subscription/buy/route.ts（删除） | ✅ 未提交 git |
| 修复 ISSUES #2（安全隐患）：/api/admin/seed-plans 无鉴权 — 添加 getAuthFromHeaders 鉴权（未认证 401 / 非管理员 403），采用项目标准模式 | src/app/api/admin/seed-plans/route.ts | ✅ 语法检查通过，未提交 git |
| 清理根目录冗余：删除垃圾文件（UTF8/addsnap.mjs/console.log(e.message))/{const/deploy.bat/fix-pubbtn.mjs/fix_prisma.sh/temp_query.*）、全部构建/运行日志（*.log ×11）、空文件（dev.err/server.err）、编译缓存（tsconfig.tsbuildinfo）、打包临时目录（.asar_tmp/.wrangler）、temp/longseg_*.mp4×3、抖音发布截图/ 目录、全部 .bak 备份（electron/fp-templates/*.bak.*、src/app/agent/page.tsx.bak.*、src/lib/*.bak） | 根目录 20+ 文件 + 3 目录 | ✅ 完成，未提交 git（仅工作区） |
| 清理文档体系：删除作废/过期/重复 MD 文档（PROJECT_REPORT.md + docs/ 全部 25 个，git 历史可恢复） | PROJECT_REPORT.md、docs/*.md（26 个删除） | ✅ 完成，未提交 git |
| 新建唯一权威项目文档（替代旧报告，含进度/待办/运维/文档体系） | PROJECT.md（新，207 行） | ✅ |
| 新建问题清单（已知问题/风险/隐患，与项目文档分开） | ISSUES.md（新，56 行） | ✅ |
| 新建执行修改记录（本文件，每次操作后追加） | EXECUTION_LOG.md（新） | ✅ |
| 更新长期记忆：项目总览/模块索引/当前状态 3 条 + 新增「操作后更新记录」规则 + 新增「禁止 git 提交」硬规则 | —（记忆） | ✅ |

## 2026-09-14 账号绝对隔离 + 客户机环境可见性 + 热点上报 401

用户要求（原话）：
- 「账号要绝对隔离 任何信息都不要串 包括个人仓库和本地仓库」
- 「那个账号调那个账号的登陆态」
- 「a 自动迁移一次」
- 起因：Administrator 机器实测——登记簿显示未登录（点开浏览器其实是登着的）、点发抖音没反应、热点不更新

### 根因（那台机器，一锤定音）
```
python --version      → 零输出，EXIT=9009
where.exe python      → C:\Users\Administrator\AppData\Local\Microsoft\WindowsApps\python.exe（★ 应用商店存根，不是真 Python）
内置环境               → 安装目录\python\buvenv-test\Scripts\python.exe 不存在
bu_debug.log          → 【只有轮询】，一条 [bu-env] / [bu-python] 都没有
```
→ **一个根因解释三个现象**：没有可用 Python + 环境自检静默失败（加载失败只 console.log，不写文件）

### 改动（均已提交推送）
| # | 内容 | commit |
|---|---|---|
| 改1+改2 | browser-profile 按账号分 `userData\browser-profile\{userId}\`；本地仓库按账号分 `安装目录\storage\{userId}\`。手法：**getter 对象**替代字符串常量（15 处调用点零改动）。启动 did-finish-load 后从登录 cookie 解 JWT 取 userId → setClientUserId。**一次性自动迁移**旧 profile（写 `.profile-migrated-v1` 防重复）。顺带去掉重复启动 setTimeout（自检/采集原来跑两次）| `1e996bb` |
| 改3 | 热点上报 401：`bu_hot.py` 原来发 `Authorization: Bearer <完整cookie串>`（形如 `Bearer token=eyJ...; other=...`）→ 服务端解析不出 token → 401 → 数据进不了服务器。改为只发 Cookie 头 | `80a33f0` |
| 改4 | 环境可见性：`bu-env` 模块加载失败原来只 `console.log`（不写 bu_debug.log）→ 客户机上毫无痕迹。改 `buLog`+堆栈；自检跳过（buEnv 未加载）/抛异常都记账 | `1be752e` |
| 改5+改6 | 假 Python 识别：新增 `isRealPython()` 用 `-c print(1)` 真执行校验（`--version` 不可靠——存根可能返回 9009 或 0），`resolveBuPythonAsync`/`ensureBuPython` 两处改用；内置环境下载/解压每步记日志（HTTP 状态/包体大小/解压退出码+stderr）| `a90bdeb` |

### 验证
- `node --check electron/main.js` 每步都过
- `npx tsc --noEmit`：无【新增】错误（报的都是预先存在的 backup-* / admin\prompt-* / .next\types）
- `py_compile bu_hot.py` 通过；已同步到本机客户端

### 待验证（装 1.0.159 后观察）
```
[iso] 当前账号 userId=xxx | profile=... | storage=...
[iso] 旧 browser-profile 已迁移到 ...（N 项）
[bu-env] 模块加载成功
[bu-python] ...（真探测/下载/解压各步）
[hot] 采集结果：... → 上报成功（不再 401）
```

### 未做（用户明确暂缓）
- 打包 1.0.159（用户要求"打包时等我确认"）
- 旧目录清理（D:\aimarketing-data 等；已备份 data-backup-20260914）
- 小红书热点跨域；真自检 TTS/ASR 探活；登记簿知乎入口；白窗剩余 2 个


## 2026-09-14 第二轮 ★「点平台按钮没反应」真因（我自己引入的）+ 点平台一律建任务

用户现象（客户机 Administrator）：**点小红书正常、点微博没反应（不建任务、不打开浏览器）**；
客户机日志：`轮询：HTTP=200 任务数=0` 一直不变。

### 排查过程（用证据一步步排掉）
1. 客户机 `bu_debug.log` 里出现 `[iso] 当前账号 userId=7 | profile=...\browser-profile\7 | storage=...\storage\7`
   → **账号隔离在客户机生效**；`[bu-env] 模块加载成功` 也在 → 装的是含改动的包
2. 客户机 exe 时间 `2026-09-14 11:41` = 本地 `dist-rel/AI-Marketing-Setup-1.0.160.exe` 时间
   → **客户机就是 1.0.160**，包内含 `getLocalStorageDir()` 8 处（getter 修复在）→ 所以 `任务#33 files 下载：2/2` 没崩
3. 任务#33（小红书）从建任务→启动 Chrome→跑 `bu_pub_xhs.py` 全链路走通 → **客户端执行链路本身是好的**
4. `npx tsc --noEmit` → **抓到真凶**：
   ```
   src/app/api/agent/chat/route.ts(1885,75): error TS2552: Cannot find name 'PLATFORM_NAMES'
   src/app/api/agent/chat/route.ts(1888,49): error TS2552: Cannot find name 'PLATFORM_NAMES'
   ```

### 根因（2026-09-13 收拢平台名单时我留下的）
`chat/route.ts` 的 `draftW.step === 'plat'` 分支用了 `PLATFORM_NAMES`（L1885/L1888），
但 import 只加了 `PLATFORM_NAME, PLATFORM_KEY` →**运行时 `ReferenceError` → API 500 → 前端什么都不显示**。
- 点**小红书**那次草稿 `step='full'` → 走 L2051（不经过该分支）→ 正常 ✅
- 点**微博**那次草稿 `step='plat'` → 命中该分支 → 崩 ❌
→ 完美解释"有的平台行、有的没反应"。

### 修复（commit `513d831`，仅服务端代码）
| # | 内容 |
|---|---|
| ① | **补 `PLATFORM_NAMES` import**（真因修复）|
| ② | **点平台按钮一律建任务**：原来是 `draftW.step === 'full'` 才建；草稿从 AgentMemory/最近任务恢复出来的 step 可能是 `pick`/`abc`，此时点平台会掉到最后的 `else` 只回一句提示 → 改为 `step === 'full' \|\| /^平台:/.test(msg)` |
| ③ | **素材兜底**：草稿 `videoName` 为空时，用**最近一条发布任务**补齐 title/topics/cover |
| ④ | **不再静默**：素材实在拿不到 → 明确回「发布素材缺失——请先说『帮我发一个视频』生成方案，再点平台按钮。」|

### ⚠️ 生效前提（重要）
- `chat/route.ts` 是 **Next.js 服务端代码** → **必须部署服务器**才生效：
  `cd /root/AiMarketing && git fetch origin && git reset --hard origin/master && bash scripts/deploy-server.sh`
- **客户端不需要重新打包**（main.js 本次零改动，1.0.160 已含全部客户端修复）

### 客户机已验证正常的部分
账号隔离（userId=7 / 迁移 44 项）、环境自检（系统 python 3.14.4 + playwright ok + browser_use ok）、
登录态预检（`PLATS:douyin:1,xiaohongshu:1,weibo:1,bilibili:0,shipinhao:1,kuaishou:1,x:0`）、
任务创建与执行、6 平台 URL 映射齐全（`platUrlMap2`）。

### 仍未解决（用户明确"先不管"）
- **小红书脚本**：`PK 开关状态=True` 但 `封面＋号数=0` → `⚠️ 无封面＋号`，最后
  `Target page, context or browser has been closed` 失败；用户反馈还有"一直显示禁止笔记"（输入格式问题）
  → **用户要求：等他本地手动实测跑通后再改脚本**


## 2026-09-14 第三轮 ★账号隔离竞态（用户实测："更新后所有登录态没有了，又变成点一次才能默认登录态"）

### 根因（我 2026-09-14 账号隔离引入）
```
userId 由 syncClientUser() 在【页面加载之后】异步解析：
   createWindow() → loadURL → page.tsx 挂载 → useEffect → buCheck() → IPC bu:check
                                              ↑ 此刻 __clientUserId 仍是 ''
   → getProfileDir() 退回 'default' → 读 browser-profile\default（不存在）→ Cookies 读不到
   → 登记簿【所有平台】显示未登录（bu:check 返回 6 个账号但 loggedIn 全 false）
   → 用户"点一次/刷新检测"时 userId 已就绪 → 读 browser-profile\{userId} → 恢复正常
```
改动前 profile 路径是**写死常量**，任何时刻都正确 → 所以这个竞态是账号隔离新引入的。

### 影响面盘点（9 个消费方，全部逐一核对）
| 位置 | 用途 | 时机 | 风险 |
|---|---|---|---|
| `bu:check` L1393 | 登记簿登录态 | ★ 页面挂载即调 | 🔴 本次现象 |
| `browser:accounts` L2205 | 账号列表 | 前端加载 | 🔴 高 |
| `browser:open-url` L2190 | 打开登记浏览器 | 用户点击 | 🟡 会开 default 空 profile |
| `storage:mirror` L878 | 本地仓库下载 | 前端触发 | 🟡 中 |
| `checkBrowserTasks` L604 | 轮询（预检/素材） | 启动即轮询 | 🟡 低 |
| 发布脚本 `--profile` L751 | 发布 | 有任务时 | 🟢 低 |
| `collectHotspotsDaily` L1874 | 热点采集 | 启动后 8s | 🟢 低（也加了等待）|
| `ensureChromeForPublish` L2890 | 启动 Chrome | 发布/登记 | 🟡 中 |
| `migrateProfileOnce` | 一次性迁移 | did-finish-load | 🟢 |

### 修复（commit `86457bc`）—— A(治本) + C(兜底)
**A**
1. 新增 `ensureUserResolved(ms)`：**幂等 + 硬超时（默认 2500ms）** 的账号就绪门
2. `createWindow()` 改 `async`；在 **`loadURL` 之前** `await preloadClientUserOnce()`（解析 + 迁移）
   → 前端首帧请求就拿到正确 profile（此时 `global.__mainWin` 已赋值、页面 JS 还没跑）
   → dev 分支顺带补 `global.__mainWin`（原来只有打包分支有 → dev 下 getServerCookie 一直返回 ''）
3. `did-finish-load` 回调改为调用幂等门（不再重复解析）
4. 6 个消费方统一 `await ensureUserResolved(2500)` 兜底：checkBrowserTasks / bu:check /
   collectHotspotsDaily / browser:open-url / browser:accounts / storage:mirror

**C**
5. `page.tsx` `detect()`：首次"**一个平台都没登录**"→ 1.5s 后自动重查一次（只重试一次，防循环）

### 不变式（为什么不会 Again 改坏）
- 不动 getter 结构 / `bu_check.py` / 浏览器启动方式 —— 只"加等待"，不改行为
- 未登录场景：解析返回 '' → 仍用 `'default'`（与旧行为完全一致）
- 已解析后 `Promise.resolve` → 零成本；未解析最多等 2.5s（超时不阻塞）
- `createWindow` 变 async：调用处（L1913/L1955）不依赖返回值 → 无副作用
- 不自动杀 Chrome（换账号只更新路径 + 记日志）

### 验证
- `node --check electron/main.js` ✅
- `npx tsc --noEmit`：无【新增】错误（报的都是既有：SceneCard 类型/BlobPart/asrSessionAbort 等）
- 打包 **v1.0.161**（`cd33271`）

### 待用户验证
重启客户端（1.0.161）→ 日志应出现 `[iso] 启动前预解析完成 userId=N | profile=...`；
且**首次打开登记簿就有登录态**（不再"点一次"）。


## 2026-09-14 第四轮 ★视频号"网页打开但不上传/不执行脚本"（脚本入口缺失）

用户实测：微博✅（9 步全过、发布成功）；**视频号网页正常打开，但好像上传失败**。

### 日志铁证（客户机 14:35 起，已装 1.0.161）
```
[14:35:06] [iso] 启动前预解析完成 userId=7 | profile=...\browser-profile\7   ← ★ 上一轮 A 修复已生效 ✅
[14:58:36] 任务#35 走确定性脚本 bu_pub_weibo.py       → 同秒即 [PUB] 输出 → 9 步全过 → 发布成功 ✅
[15:00:04] 任务#36 走确定性脚本 bu_pub_shipinhao.py   → ★ 同秒 "脚本执行失败 code=0"，【没有任何 [PUB] 输出】
```

### 根因
`scripts/agent-publish/bu_pub_shipinhao.py` 文件末尾**漏了 `main()` 调用**：
```
微博末尾：  print(json.dumps({...}))  ⏎⏎  main()        ← 有调用 ✅
视频号末尾：log('⑥ 无自定义封面 → 平台默认')  ⏎(空行+8空格)  ← 【没有调用】❌
```
→ python 执行该文件只做"定义"就退出：**exit code 0 / stdout & stderr 全空 / 任何步骤都不执行**。
→ 所以**不是"上传失败"，而是脚本压根没跑**；网页能打开是 `main.js ensureChromeForPublish` 干的，与脚本无关。

### 修复（commit `6f59379`）
补标准入口：
```python
if __name__ == '__main__':
    main()
```
自检：`python bu_pub_shipinhao.py --help` 正常输出 argparse 帮助（修复前零输出）→ 证明 main 已被调用。
其余 5 个脚本核对：douyin/xhs/kuaishou/bilibili 有 `if __name__` 入口、weibo 用裸 `main()`，**均可正常执行**，仅 shipinhao 缺失。

### 打包
**v1.0.162**（`03bc328`）

---

## 2026-09-14 讨论记录：客户端"内嵌浏览器" vs 现状"外部打开"（未实施，仅记录）

**用户观察**：打开浏览器的操作现在是**外部弹出窗口**，看起来怪；IDE 跑测试可以内嵌，是否能改成客户端内执行、有什么好处。

**现状原因（不是随便写的）**：定稿「浏览器一条线」= 唯一引擎系统 Chrome + 唯一 profile；发布脚本用
`Playwright connect_over_cdp('127.0.0.1:9222')` 驱动那个 Chrome → 必须有**独立可连 CDP 的 Chrome 进程**。

**内嵌的硬障碍**：
1. Electron 的 webview/BrowserView 的 session 只能落在 **Electron userData 下的 Partitions/**，
   而登录态在 `安装目录\data\browser-profile`（真 Chrome 目录）→ **读不到现有登录态** → 回到"两套浏览器两套登录态"老路
2. Electron 33 内置 Chromium ≈130，系统 Chrome 版本更高；内嵌视图**不提供独立 CDP 端口**，
   Playwright 连的是 Electron 而非 Chrome → **6 个发布脚本 + _cdp_click.py 全部要重写驱动层**
3. Chromium 大版本差异 → profile（含 Cookies 加密）可能互相迁移/破坏（项目已踩过）

**好处**（真实痛点）：观感统一、用户能看见 AI 在做什么（现在窗口可能被盖住→以为卡住）、
登录/扫码同窗口完成、不会被最小化而"消失"、多账号可 tab 并排。

**代价**：重做「浏览器一条线」+ 重写 6 个脚本驱动层 + 全平台重测 + 内嵌视图崩溃会带崩客户端 + CDP 暴露面变大。

**低成本折中（建议优先）**：
- A. Chrome 用 `--app=<url>` 启动（无地址栏，像个独立应用窗口）+ `--window-position` 贴靠 → 改 1 行
- B. 客户端内做"实时预览"（CDP `Page.captureScreenshot` 定期截图显示）→ 观感接近内嵌、只读不接管、不动驱动层
- C. 打开时把 Chrome 定位到客户端窗口旁（视觉分栏）

**结论**：**不是 UI 优化，是架构选择** → 等 6 平台发布全部稳定后再做独立版本评估，不要混在修 bug 里。


## 2026-09-14 第五轮 ★窗口分栏（LAYOUT_V1）：打开浏览器时客户端缩左 + 浏览器靠右

用户要求与动机（原话要点）：
- 现状"打开浏览器"是外部窗口，而且**停在客户端窗口背后，看不到**；
- 希望**客户端自动缩窄**、浏览器在一边（像 IDE 分栏）；
- **动机不只是发布**：后期闲暇时要让工具**采集更多数据**（采集回复等）会有**很多新任务**，
  届时同样需要"看得见浏览器" → 所以要做成**通用能力**，不能只绑发布流程。

### 实现（commit `6b6d598`）
| # | 内容 |
|---|---|
| ① | `layoutSideBySide()`：按 `screen.primaryDisplay.workAreaSize` 计算——客户端左侧 58%（≥880px），浏览器区右侧（≥620px）；**全屏先 `setFullScreen(false)`、最大化先 `unmaximize()` 再 `setBounds`**（否则系统忽略尺寸修改）；记录原 bounds 供恢复 |
| ② | `ensureChromeForPublish` 启动时给 Chrome 带 `--window-position=<x>,0 --window-size=<w>,<h>`；**复用已有浏览器时不改布局**（避免无谓打扰） |
| ③ | `restoreClientLayout()` + `scheduleClientLayoutRestore()`：`checkBrowserTasks` 处理完任务后 **15s 内无新任务** → 恢复客户端原大小；**内部守卫：没分栏过直接 no-op**（否则每 8s 轮询会不断重置计时器 → 永不恢复） |
| ④ | **不改 `--app`**（无地址栏会改变"新建标签"行为，可能破坏已验证的微博发布流程），本次仅定位 |

### 安全性核对
- `ensureChromeForPublish` 的 4 个调用处：任务未登录要开登录页 / 发布任务 / 两个用户主动点击的 IPC
  → **全部是"有任务或用户主动"**，`keepaliveBrowser` 不走这条路 → **不会一启动就缩窄窗口** ✅
- `node --check` 通过

### 已知局限（已向用户说明）
- 浏览器**已在运行**时（9222 已通）我们只是**复用** → **无法改它的窗口位置**（Chrome 单例：再 spawn 只把参数交给已有进程）
- 首次由我们启动时定位一次；之后 Chrome 通常自己记住位置
- 若需要"每次强制到位"，得加 Win32 `SetWindowPos`（复杂、有误移其它窗口风险）→ 暂不做

### 打包
**v1.0.163**（`45f936c`）—— 含视频号脚本入口修复（`6f59379`）


## 2026-09-14 第六轮 ★小红书风控应对：脚本拟人化（P0，仅改小红书）

用户实测：**小红书账号被"限制发布"**（其它功能正常）→ 怀疑"纯脚本"风险大，问有无办法。

### 查证：我们脚本的"机器特征"（改动前）
```
✗ 标题用 fill()                        → 瞬间填值，人不可能这样打字
△ 话题用 keyboard.type(delay=30)       → 逐字但间隔固定
△ mouse.move 只用于 CDP 点击前"定位"    → 不是鼠标轨迹
✗ 步间固定 wait_for_timeout(3000/2000…) → 节奏规律
✗ 固定 --remote-debugging-port=9222 + CDP mouse.click(x,y) → 瞬移点击
✗ electron/fp-templates 里【没有任何反检测/拟人化】实现（grep webdriver/stealth/bezier 全空）
```

### 风险分析（诚实结论）
- 脚本本身不是"必封"：同批脚本下 抖音/微博/视频号 未被限制；**小红书风控业内公认最严**
- 被限制通常是**多因素叠加**：账号（新号/无浏览行为/纯营销）、内容（AI 感强、话题批量雷同）、
  行为（自动化特征暴露）、环境（**同 IP/设备多账号=强关联**）、频率（短时间连发）
- ★ **拟人化只能"降低"被识别概率，不能保证不被封**；账号已有的"限制发布"也不会因脚本改动而解除

### 本次实现（commit `ec30ded`，HUMANIZE_V1）
**只改 `scripts/agent-publish/bu_pub_xhs.py`；`_cdp_click.py` 是共享模块（微博/视频号/B站/快手共用）→ 绝不改；其它平台零改动。**
| # | 内容 |
|---|---|
| ① | 标题 `fill()`（瞬间填值）→ `human_type` 逐字输入 + 随机间隔；**带 `input_value()` 校验，拟人输入未生效自动回退 `fill`**（保证功能不丢） |
| ② | 话题 / 末尾 `#` 的固定 `delay=30/40` → 随机 28~95ms |
| ③ | `human_move_click`：先 4~8 段轨迹移动再点击，坐标带 ±3px 抖动（用于：删 PK 封面 / 封面＋号 / 像素定位发布按钮） |
| ④ | 发布前 `human_scroll` 拟人浏览（随机滚动 + 停留），不再"一进来就点发布" |
| ⑤ | 关键固定 `wait_for_timeout` → `human_pause` 随机区间 |

### 记录·未做（后续可选）
| 层 | 内容 | 说明 |
|---|---|---|
| P1 环境 | CDP 端口随机化；**一号一 IP（住宅代理）** | 同 IP 多账号是最容易被关联的 |
| P2 根本解 | **官方开放平台 API**：小红书（专业号/企业号内容发布）、抖音开放平台、微博开放平台、B站投稿 | 合规、零网页风控，需认证审核 |
| P3 流程 | **半自动：脚本准备完毕，停在"差一步发布"，人工点发布** | 风控最敏感的是"发布"动作；且与项目"用户确认式发布"一致 |
| P1 复用 | 已有 `electron/fp-templates/*.js`（6 平台 JS 版，另一条指纹线） | 可参考/移植 |

### 打包
**v1.0.164**（`831bcac`）

### 注意（给验证者）
- 被限制的账号**即使脚本完美也发不出去**（是账号限制，不是脚本问题）→ 建议用**未受限的号**测，或等限制期结束
- 拟人化会让流程**变慢**（逐字输入 + 随机停顿，约多 10~30 秒），属预期


## 2026-09-14 第七轮 ★排查范式：多客户端同账号 → 抢任务（"某台不打开浏览器"的真因）

**现象**：前端显示"已创建任务（#37）"，但某台客户端日志只有 `轮询：HTTP=200 任务数=0`，
**通篇没有任何 `任务#` 行** → 表现为"点了没反应 / 浏览器不打开"。

**真因（用户 2026-09-14 实测确认）**：
- **两台客户端用同一个账号**登录（userId 相同）
- 服务端 pending 队列**按 userId 共享、无客户端归属** → 谁先轮询（每 8s）谁拿走
- → 另一台抢走并执行；本台之后查 `?status=pending` 必然 0 条 → 浏览器自然不开
- 而那台抢走的机器**缺 Python 环境** → 执行失败

**数据库铁证**：
```
134|7|37|failed|2026-09-14 16:41:07   error="缺 Python 运行环境："     ← 被另一台抢走并失败
133|7|36|failed|2026-09-14 14:59:52   error="脚本失败 code=0"          ← 视频号脚本入口缺失(已修 6f59379)
132|7|35|done  |2026-09-14 14:58:34                                     ← 微博 ✅
```

**判定方法（三步，速查）**：
1. 客户端日志**没有** `任务#N files 下载` / `任务#N 走确定性脚本` → 任务没到这台
2. 到服务器查状态：
   ```bash
   cd /root/AiMarketing && sqlite3 prisma/dev.db \
     "SELECT seq,status,datetime(updatedAt/1000,'unixepoch','localtime') AS t,substr(error,1,180) AS err FROM AgentBrowserTask ORDER BY id DESC LIMIT 6;"
   ```
3. `status=failed` + `error` 文本 → 直接看出是哪台执行失败的、失败在哪个环境

**注意**：`error` 字段能区分失败原因——`缺 Python 运行环境：` / `脚本失败 code=0 （入口缺失/秒退）` /
`xxx 未登录`（登录态预检拦下）/ `客户端关闭中断（启动回收孤儿任务）`。

**暴露的架构问题（未修，记录备选）**：
| 方案 | 说明 |
|---|---|
| ① 一账号只开一台客户端 | 最直接；使用约定 |
| ② 任务绑定 clientId | 客户端启动上报 clientId → 建任务时记录目标 → 轮询按 clientId 过滤（要改前后端） |
| ③ 客户端单实例锁 | 同账号只允许一个在线（心跳 + 抢占） |

**附**：那台"缺 Python"的机器装 **v1.0.164** 后，环境会自动安装（`isRealPython` 真执行校验 + 每步日志，
`[bu-python]` 可见过程）；v1.0.164 还修了视频号脚本入口缺失（`6f59379`）。


## 2026-09-15 ★启动自检（STARTUP_CHECK_V1）+ 登录态自愈（ACCOUNT_PROFILE_V1）+ 内置环境根因

用户要求（原话要点）：
- 「打开客户端就自检」「这个插件自检要真自检，出现问题最好有反馈错误」
- 「都自检完留一个确认键，点确认再启动客户端」
- 「能弥补我们更新完客户端重启、改桌面标签、再启动需要等 2-3 分钟的问题」

### 一、启动自检（`9b6cd24`，v1.0.167）
| 项 | 内容 |
|---|---|
| 形态 | 新增 `electron/splash.html`（**本地页，秒开**，不依赖网络）；`createWindow` 改为**先 `loadFile(splash.html)`**，失败则兜底直接 `loadURL` |
| 6 项【真检】 | ① 版本 ② **运行环境**（实际执行 Python + `import playwright.sync_api/browser_use`，不是看文件在不在）③ 关键脚本/插件（6 平台脚本 + `_cdp_click.py` 存在且非空）④ 目录可写（`data\`/`storage\` 实际写文件再删）⑤ 当前账号（userId + profile 路径）⑥ 平台登录态（`bu_check` 逐个平台真读 Cookies）|
| 进度 | 每项经 IPC `startup-check:progress` 实时推给自检页（✅/⏳/⚠️/❌ + 具体错误原文）|
| 确认键 | 全部完成后启用「确认进入」→ `startup-check:enter` → 才 `loadURL` 主界面；**失败也允许「仍要继续」**（绝不把用户卡死）|
| 附带价值 | 覆盖"更新后重启需等 2~3 分钟"的**无感空等**（那段时间现在显示自检进度）|
| preload | 暴露 `startupCheckRun` / `startupCheckEnter` / `onStartupProgress` |

### 二、账号登录态自愈（`3b75072`，v1.0.166）—— 修"登录态反复消失"
**根因**：账号隔离把 profile 从【共用】改为【按账号 `browser-profile\{userId}`】，迁移用一次性复制，代码三处缺陷：
① 见 `.profile-migrated-v1` 标记就 return（**一次性，失败永不重试**）
② 子项复制失败 `catch (e) {}` **静默吞掉**
③ **不校验结果就写标记**（Cookies 没复制成功也算"已迁移"）
④ 不检查 Chrome 是否在运行（Cookies 被独占 → 复制必失败）→ 客户机 `\7` 缺 Cookies 正是如此。

**修复**：换成幂等的 `ensureAccountProfile()`：每次启动都检查（不依赖一次性标记）；已就绪零成本；缺而共用目录有则补；**Chrome 在跑（9222 通）则本次跳过、下次再补**；复制后**校验 `\Default\Network\Cookies` 真到位才写标记**，否则告警 + 下次重试；逐项失败写日志；旧共用目录**保留不删**作兜底源。
→ 对**任意 userId / 任意机器**都成立（用户要求"项目不是给一个人用，不要换机器账号又出问题"）。

### 三、内置 Python 环境两个根因（`b17c59d`，v1.0.165）
1. **不可移植**：内置环境 zip 是 `python -m venv` 建的虚拟环境，其 `Scripts\python.exe` 只是**转发器**，靠 `pyvenv.cfg` 的 `home` 找基础 Python（硬编码为打包机 `C:\Users\wo'shen\...\Python314`）→ 任何别的机器报 `did not find executable at 'C:\Users\wo'shen\...'`
   **已修**：改用**官方 embeddable Python 3.14.4** 重打 zip（自包含：真解释器 + `python314.zip` 标准库 + `vcruntime140.dll`），实测解压到独立目录 `prefix` 跟随目录、`import playwright.sync_api/browser_use` OK、`sync_playwright` 可用，**69.3MB**；产物在 `dist-rel/python-bu.zip`（**待用户上传 OSS**：`node scripts/upload-python-bu.mjs <zip>` 必须在服务器跑）
2. **顺序错误**：`ensureBuPython` 里先 `writeFileSync`(标记) 再 `mkdirSync`(父目录) → 干净机器父目录不存在 → `ENOENT` → 安装从未成功（日志连"开始下载"都打不出）
   **已修**：先建目录、再写标记；并加 ①已装过不再重下 85MB ②文案不再显示误导的"用户取消一键安装" ③`let _insR` 作用域修正

### 待用户操作
- 上传 `dist-rel/python-bu.zip` 到 OSS；客户机删一次 `安装目录\python` 后重启（自动装新版）
- 部署服务器（点平台修复 `513d831` + 前端兜底）
- 装 v1.0.167 验证启动自检


## 2026-09-15 ★启动自检四步改造（微信 v1.0.174~177）+ 两个重要纠正

### 一、四步改造（用户定的设计：独立窗口 → 逐项真检 → 完成才开真客户端）
| 步骤 | commit | 内容 |
|---|---|---|
| 第1步 | `4832171` | **独立窗口化 SPLASH_WINDOW_V1**：自检从"客户端内覆盖页"改成"先弹出的独立窗口"（`createSplashWindow`，680x780，沿用现有暗色卡片设计）；`mainWindow` 改为 `{show:false}` 隐藏创建（session 仍需供自检读 cookie）`+ loadURL('about:blank')` 占位（否则它的 did-finish-load 不触发）；`enterMainApp()` 关闭自检窗 + 加载主界面 + `mainWindow.show()` |
| 第2步 | `1c64f1d` | **每项进度条 STEP2_PROGRESS_V1**：自检页每项含独立进度条；`item()` 增加第 5 参 progress(0-100)；脚本项逐文件、采集项逐平台、环境项分步推进；拿不到百分比的阶段走流动动效(indeterminate)；加 30 秒兜底 |
| 第3步 | `be9f6fc` | **真检测 STEP3_REALCHECK_V1**：① 关键脚本项加"与上次比对变化"（大小+mtime 签名存 `data/scripts-state.json`）② 运行环境 import 通过后再**真执行 playwright start/stop** ③ **新增"发布前置预检"项**（系统 Chrome / 网络到服务器 / 9222 / 本账号 Cookies） |
| 第4步 | `8adc0b9` | **统一更新入口 STEP4_UNIFY_UPDATE_V1**：更新进度并入自检窗（`toSplash()`）——update-available/下载百分比(第1段)/下载完成提示"正在安装，窗口会自动重开，请勿手动启动"(第2段)；老的 `updWin`(renderer/update.html) 仅作兜底 |

**现状**：自检共 8 项 = 版本(含更新检测) / 运行环境 / 关键脚本插件 / 目录可写 / **发布前置预检** / 账号(可选) / 平台登录态 / 热点采集

### 二、★★ 重要纠正：playwright/driver【必须保留】（我删错了）
```
我重打 python-bu.zip 时删掉 playwright/driver（101MB），理由"只连系统 Chrome、不需要自带 driver"
→ ★ 这个判断是错的：
  · Playwright 的 Python 端必须靠 driver（它自己的 node 服务）才能工作
  · sync_playwright().start() 就必须启动 driver；connect_over_cdp 也走 driver
  · 删掉 driver = playwright 整套不可用 → 发布脚本 bu_pub_*.py 全部失败
★ 而 OSS 上的 python-bu.zip（72637453 字节）就是我打的那个【坏版本】
  → 必须【重打（含 driver，体积回到 ~170MB）→ 重新上传 OSS 覆盖】
★ 是被第 3 步的"真执行 start/stop"照出来的（说明真检测有价值）
★ 之前我的"验证"只测了 import + callable(sync_playwright)，漏了 .start() → 没发现
```

### 三、已知问题：点快捷方式先出现【白色客户端】
```
现象：点快捷图标 → 先弹出白色客户端窗口 → 关掉再打开才好
原因（第 1 步引入）：mainWindow 现在是 {show:false} + loadURL('about:blank')（纯白占位页）
 · 而 electron/main.js 的单实例逻辑：app.on('second-instance', ...) 会 mainWindow.show() + focus()
 · 客户端已在运行时，用户再点快捷方式（或任务栏图标）→ 触发它 → 把主窗口显示出来
 → 此时主窗口还是 about:blank → ★ 屏幕上就是"一个白色客户端"
待修：把 second-instance / app.on('activate') 等"显示已有窗口"的路径改为——
      自检窗还在 → 只把【自检窗】提到前面；已进主界面 → 才显示主窗口
```

### 四、待办
```
① 重打 python-bu.zip（含 driver）→ 用户上传 OSS 覆盖 → 环境异常机器删 python 目录后重启
② 修白窗（second-instance 显示 about:blank）
③ 小红书 B 类采集（接口在 edith 域跨域，需改走 www 域）；视频号未纳入 B 类
④ 服务器部署（点平台修复 513d831 + 前端兜底）—— 一直没做
⑤ 下一版才能验证"自动更新"（本版是装上它的那一版）
```


## 2026-09-15 ★自检【编号化 + 顺序修复】（v1.0.183~185）

### 用户报的三个问题（原话）
1. 「更新次序都搞不明白，你就加个标记 1.2.3.4，第一就是先更新，现在乱的一塌糊涂」
2. 「账号都没选，登陆状态没验证就开始搜热点了」
3. 「你刚才自己打开一次更新又失败」+「自从你改了白屏问题就错乱了」

### 根因（三条，均已修）
| 现象 | 真正原因 | 修复 |
|---|---|---|
| 账号没选/登录态没验就采热点 | 自检改【独立窗口】后，mainWindow 加载占位页 → 它的 did-finish-load 在**自检窗刚打开时就触发** → 挂在上面的 3 秒环境自检 / 8 秒采集定时任务**抢先执行** | did-finish-load 只解析账号/profile；环境自检与采集**交给自检页按序**；进主界面后仅"今日未采"时兜底补采一次 |
| 检查更新失败 | setupAutoUpdater 在 L701，排在 createSplashWindow(L691) **之后** → 自检第一项调 checkForUpdates 时 feedURL 可能没配好；且其内部 5 秒定时**又查一次** → 并发 | 更新器**提前**到自检窗之前初始化；新增 checkUpdateOnce() 闸门，自检与定时**共用**（只查一次）；开发环境跳过 |
| 看不出顺序 | 自检项无序号 | splash.html 每项加 1. 2. 3.… 序号 |

### 自检最终顺序（定稿）
```
1. 版本（★先检查更新：有新版→该项显示下载进度；15s 超时不会一直转圈）
2. 运行环境（真执行 playwright；缺环境/缺依赖→【后台】装，不阻塞自检）
3. 关键脚本/插件（含与上次比对）
4. 目录可写
5. 发布前置预检（Chrome/网络/9222/登录文件）
6. 账号（★必须选择，不 done）
7. 平台登录态（选账号后 detectLoginState）
8. 热点采集（限时 100s，超时转后台）
```

### 其他本轮修复（v1.0.183）
- 内置 python 改为**动态定位** findBuiltinPy()（不再写死 buvenv-test/Scripts、不再用不可靠的 Move-Item 迁移）—— 修"python.exe 在但缺库"的半残环境
- 自检报错**不再截断**（优先显示 ModuleNotFoundError / No module named 关键行）
- 内置环境缺依赖 → **后台** pip 补装

### 验证
- 源码版 electron . 实测：console 只有 winshow 事件，**没有** [hot] 采集、**没有** [bu-env] 抢跑 ✅
- findBuiltinPy 实测正确定位 D:\AiMarketing\python\buvenv-test\Scripts\python.exe ✅


## 2026-09-16 ★画像清理 + 热点按主题搜索（第 1~3 批，用户定稿方向）

### 起因
用户："现在获得的热点没意义，大家都一样的，不如服务器都采集好给用户推了；让它有意义应该是**按用户设置的行业去推热点**，而不是全推一个总榜。"
另：用户发现画像数据乱（"主要平台：X" 6 条并列、标签与内容不符、"未接入需求"重复）。

### 体检结论（服务器 DB 实测，14 个账号）
```
★ User.industry 字段【14 个账号全部为 null】——该字段 2026-08-09 就为"视频/热点按行业推送"预留，但没人写过
★ admin 画像 = 6 条"主要平台：X"（标签却写 '画像,行业'）+ 2 条重复的"未接入需求"，零行业信息
★ 只有 zhoutao02/zhoutao05 的 onboarding 4 条、liushanshan 1 条是规范的
```
**三个 bug（写入口）**：
① `chat/route.ts` 自动提取：标签写死 `'画像,行业'`（内容是"主要平台：X"）→ 标签与内容不符
② 同处查重只比 `content.substring(0,8)` → 每提一个平台就新建一条，越积越多
③ 同处把"对话里提过的平台"当永久画像；另 `collect_unmet_need` 无幂等 → 重复
④ **补洞**：自动提取只认【纯中文 2~12 字】的正则 → "AI" 这类英文主题永远不会被记下

### 数据处理（用户授权，已执行，有备份）
```
备份：/root/db-backup/dev-20260916-0828.db
清理：平台噪音 18 条 / 误提取 1 条 / 重复需求 1 条
写入 admin 画像 4 条（行业=AI / 关注主题=AI,大模型,智能体,AI 应用 / 需求=只看 AI 新闻 / 平台）
并把 User.industry 设为 'AI'
★ 技巧：写库时【借用现有行的 createdAt/updatedAt】，避免猜 Prisma 的时间格式
```

### 第 1 批（服务端，已提交）
- `api/agent/memories/route.ts`：登记成功后**同步写 User.industry**；新增 `topics`（我关心的主题）→ 写 `画像,主题,onboarding`
- `api/agent/chat/route.ts`：标签与内容匹配（平台→`画像,平台`）；查重改内容完全相同；平台降权为 0.4 的"使用过的平台"；提取到行业时补 `User.industry`
- `collect_unmet_need`：加幂等

### 第 2 批（服务端页面，已提交）
- 后端 `memories` POST 改为**按标签独立更新**（只动本次传的字段 → 设置页只改主题不会删掉行业/需求）
- 登记表单 + **设置页**都加「🎯 我关心的主题」输入框（设置页可随时改、打开时回填、保存时写入画像）
- ★ 自查修错：首次实现误用变量名 `hotTopics`，与"热榜数据数组"重名（TS2451）→ 改名 `myTopics`
- 补：客户画像面板**分组显示**（📇 画像 / 📝 未接入需求 / 其它只显示条数）

### 第 3 批（已提交）：热点按主题搜索
- `api/agent/hotspots`：新增 `getUserKeywords()`（User.industry + `画像,主题`）+ `searchByKeywords()`
- 主题结果**排最前**且**不进全局缓存**（每人主题不同）；通用源仍走缓存
- 先接 **HackerNews Algolia 搜索**（实测服务器可访问、官方 API、JSON）
- **摘掉 Reddit 调用**：实测服务器网络到不了（HTTP 000 超时），每次白等拖慢链路
- 无主题的账号 → 完全保持现状（不影响任何人）

### 数据源实测（服务器网络）
```
✅ HackerNews（hn.algolia.com 搜索）  → 可用
🟡 今日头条（so.toutiao.com 搜索）   → HTTP 200，需解析、可能有反爬
✅ 百度（现有热搜接口）              → HTTP 200（搜索接口待找）
❌ Reddit                            → 超时（网络不可达）→ 已摘掉
```

### 待办
- 验证第 1~3 批（部署服务器后）：admin 打开热点大屏应看到 `HN·AI` 等按主题的源
- 中文源（头条/百度）搜索接口的解析试探
- 发布接画像（用户提过：常用平台默认勾选）—— 单独排期
- OSS 上传待办仍在（python-bu.zip 正确结构 + exe/latest.yml 同步）
