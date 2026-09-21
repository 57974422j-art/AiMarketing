## ✅ 已解决（2026-09-21 · 素材成片两个真 bug + 中转站 403 真因 —— 均已定位并修复）

> 共同点：**状态残留**（草稿跨会话存活但没人收尾）＋**协议串没有统一入口校验**，都不是算法问题。
> 排查手段：`git log -S` 定位引入点、**实测对照**（curl/Node/Python 各发一次请求看响应码与响应体）、看真实数据（任务 JSON 的 `tail`）。

| 标记 | 症状 | 根因（代码级） | 修复 |
|---|---|---|---|
| `VF_FORM_CLAIM_V1` | 做完第一条后再提交表单 → 回「本地成片已在后台渲染中」（其实没在渲染）；或选 60 秒却出成 **200 秒** | 表单**只在 `vd.step === 'form' \|\| 'source'` 时被解析**。step 是 `running` → 被 running 分支拦下；是 **`script` → 落进「文案微调」分支，整串 `VF_FORM:{...}` 被当"改文案的要求"喂给 AI**（`dur`/`uploaded` 全丢）→ 接着点确认 → 用**旧草稿的 180 秒分镜**出片 | 表单撞上"孤儿草稿"（step 非 form/source）→ 作废 + **用本次表单参数重新起草**（一次点击到位，不必点两次） |
| `VF_RUN_CLOSE_V1` | 「做完一条，第二条要点两次」；「之后随便说句话都被回『已在后台渲染中』」 | 出片时 `vd.step='running'` 存库，**出片完成后没有任何代码改回来/清掉**（只被 30 分钟超时兜住）→ 草稿永远 running，而 `VIDEO_DRAFT.has()` 会让**后续每条消息**都进成片块 | **入队即作废草稿**（进度由 `<storage>/<uid>/video-factory/vf<ts>.json` 独立跟踪） |
| `VF_TOPIC_GUARD_V1` / `VF_TOPIC_CLEAN_V1` | 表单「主题」框被填成 `VF_FORM:{...}` 原文，并被喂进写文案的 prompt | 起稿处只剥指令词、**不认协议串**；而 `VF_TOPIC_V1` 的清洗是 `if (!vd.topic)` → 已有脏值不清 | 起稿 + 起草两处都挡协议串，并清理历史脏草稿 |
| `VF_DURFIX_NOTE_V1` | 曾以为「时长护栏」能修 60→180/200 | **素材成片最终时长 = `tts.py` 逐镜配音真实时长**（`s['dur'] = round(dur + 0.35, 2)` **覆盖**分镜 `dur`）→ 护栏打在会被覆盖的层；且 `clamp 4~15/镜` 与按比例缩放冲突（36 镜压 60 秒 → 每镜被抬回 4s = 144 秒） | 保留护栏（对无配音镜头仍有效）+ 日志写实，避免下次误判 |
| `H3_UA_V1` | 成片每镜 `[H3] 中转 提交失败: HTTP 403` → 全部降级走官方，**每镜白等一轮** | **Python `urllib` 默认 UA `Python-urllib/3.x` 被 Cloudflare 拦**（403，响应体是 `error code: 1010`、**不是 JSON** → 代码兜底只显示 "HTTP 403"，长期被误判成 key 无权）。实测对照：curl UA / Node UA 同一请求 → **400 `INVALID_PARAM`（key 有效）** | `make.py` 请求补 `User-Agent` |
| `H3_DIAG_V1` | 403 只见 "HTTP 403"，分不清"网关拦"还是"key 无权/欠费" | `_h3_http` 在响应体非 JSON 时**丢掉了原始响应体** | 非 JSON 时把原始响应体前 200 字打进日志 |

| `VF_AI_RUNCLOSE_V1` / `VF_MIX_RUNCLOSE_V1` | 点素材线的「确认」→ **回「AI 制片已在后台生成中」**（状态机接错线，AI 又"编"了） | **AI 制片线 / 混合线也是"入队写 `step='running'` 但没人收尾"** → 草稿终身 running；而它们的接管规则是「**有本线草稿 → 一定接管**」→ **僵尸草稿终身吞掉所有消息**（含别线的「确认」）→ 抢走后命中各自的 running 兜底 | 入队即作废本线草稿；接管判定里 **running 草稿一律视为僵尸：自清 + 不接管**（兜住库里已有僵尸） |

| `VF_SRC_SPLIT_V1` | 「✨ 素材+AI 混合」「🎨 全部 AI 生成」这两个按钮**在同一个界面里行为不一致**（表单卡里"混合"是死路回"还在开发中"、内联卡里"混合"却能跑；内联卡里"全 AI"被 AI 制片线接走、表单卡里"全 AI"走素材线） | **一个概念有两条路**：素材线卡里的按钮（发 `source:'mix'/'ai'`）与 AI/混合两条线各自的入口词，两套 UI 又各写一份 | 按用户定案**把这两个按钮从素材线的两套 UI 里拆掉**（含 4 处 `source==='ai'` 死分支）→ **一个概念只留一条路** |

| `VF_PROTO_V1` | AI 制片点「▶️ 下一步（排分镜）」→ **掉出状态机**，AI 自由发挥**编了一张假卡**（`VF_JSON:{"step":"ai_plan",…}` 原文 + 「（模型：qwen3.8-flash）」尾巴） | ① 卡片提交发的 `VF_FORM:`（协议串）**不是任何一条线的"入口词"** → `skipModelStep1=false` → 状态机整块跳过（是否进状态机还取决于"模型那步有没有调工具" → **时好时坏**）；② 表单里带着**文案正文**，正文含「写标题/海报」→ 命中 AI 线的"工具意图排除" → 连入口词判断也是 false | `skipModelStep1` 增加**协议串前缀**判定（卡片提交必进状态机）；两条线里"协议串不算工具意图" |

**⚠️ 四条结论记档（后来人必读）**
1. **素材成片的时长**由「文案字数 ÷ 4.5」+ `tts.py` 逐镜真实配音时长决定；**改分镜的 `dur` 不会改变最终时长**（要改就改文案字数/字幕覆盖）。
2. **一个用户只有一条成片草稿**（`AgentMemory` tag `vf_draft`，`findFirst` + 覆盖写）——不是"两个草稿叠加"，而是"**旧草稿把新输入吃掉了**"。
3. **中转站连通性判定看响应体**：JSON 错误 = 通道通（参数/权限问题）；纯 `HTTP 403` + 非 JSON = 前置网关（Cloudflare）拦 → **先查 UA / 路径，别急着换 key**。
4. **★三条线都要遵守"入队即收尾草稿"**（`VF_RUN_CLOSE_V1` / `VF_AI_RUNCLOSE_V1` / `VF_MIX_RUNCLOSE_V1`）：草稿里的 `running` 是**没有出口的状态**，而三条线的接管规则都是"有草稿必接管" → **只要有一条线的草稿卡在 running，它就会吞掉所有线的消息**（实测：素材线的「确认」被 AI 制片线抢走）。**新增一条线时，必须同时给它"入队即收尾"+"running 视为僵尸"两条规则**。

---

## ✅ 已解决（2026-09-20 成片 v1 实测暴露的 8 个问题 —— 全部定位并修复）

> 这批问题的**共性**：几乎全是"**字段/参数/路径对不上**"，不是算法问题。定位手段统一为**看真实数据**（`storyboard.voiced.json` / `render/*.srt` / 任务 JSON 的 `tail` / `vf_debug.log`），而不是猜。

| # | 症状 | 根因（代码级） | 修复 |
|---|---|---|---|
| 1 | 「帮我做一个视频」**时好时坏**：有时进状态机、有时 AI 自由发挥 | `chat/route.ts:1714` 入口条件是 `if (skipModelStep1 \|\| normCalls.length > 0)` —— 即"AI 那一步调了工具"才进状态机块；而 `skipModelStep1`（L1681）只算了**发布**草稿 + `stWordInput`（发布词），**成片草稿与入口词都没算** → AI 若不调工具则整块跳过 | `skipModelStep1` 补入 `VIDEO_DRAFT.has()` 与成片入口词（★VF_ENTRY_V1） |
| 2 | build 失败 → **pm2 没重启** → 连续几轮"改了没反应" | `prompts.ts` 红线里的**反引号**落在**模板字符串**内 → 提前闭合 → `Expected ':', got 'VF_JSON'` → `deploy-server.sh` 因 `set -e` 退出 | 去掉反引号（改用普通文本） |
| 3 | `TOOL_REJECT:未找到本地成片脚本 make.py`（脚本明明在 git 里） | pm2 跑 `.next/standalone/server.js` → `process.cwd()` = `.next/standalone` ≠ 项目根；代码写死 `process.cwd()` | 新增 `vfRootDir()`/`vfStorageRoot()`（VF_ROOT→cwd→上级→/root/AiMarketing），**4 处入口统一**（写任务/查进度/轮询/素材目录，原先后两者可能不在同一目录） |
| 4 | 10 张图，4 个镜头**全用同一张** | `parseInt(s.pick) \|\| 1` —— AI 不给 `pick` 或给无效值时全落第 1 张 | 无效/越界时**按镜头序号轮换**（`vfPickSeq++ % 图数`）+ prompt 要求 pick 尽量不同 |
| 5 | 有一镜**有配音却无字幕** | `build_srt` 只认 `text` 字段，而 `list/number/compare/chart` 卡用的是 `title/items/label/value` → `txt` 为空 → 整镜跳过 | `shot_text()` 补全所有字段并提为模块级（SRT/ASS 共用）+ 长句折行 |
| 6 | "**双字幕**"：画面大字与底部字幕同句重复 | 画面大字（drawtext）与字幕取**同一个 `text`** | prompt 改为「大字只能是 4~8 字短语，禁止整句」→ 大字=标语、字幕=配音句 |
| 7 | 选 180 秒**只出 14/50 秒**、字幕只有屏幕上几个字 | **根因（关键）**：`tts.py:292` 与 `render.py:427` 都是 `s.get('subtitle') or s.get('text')` —— AI **没给 `subtitle`** → 回落到 `text`（4~8 字大字）→ **配音念的是大字、字幕也是大字**，800 字文案**从未被念**（24 镜 × ~2 秒 = 50.8 秒，与实测吻合） | 分镜 prompt 改为**每镜必须给 `subtitle`** 且「所有 subtitle 拼起来覆盖整段文案」；**Python 侧零改动**（本来就优先读 subtitle） |
| 8 | 选 180 秒 → **排了 0 个镜头** + 报价掉到 1 点 | 一次让 AI 输出「810 字文案 + 30 镜 JSON」**超出 `max_tokens` 被截断** → `JSON.parse` 失败 → shots/script 皆空 | **拆成两次调用**（① 只写文案 ② 只排分镜，各自输出小）+ 字数不足自动补写（★VF_SPLIT_V1 / ★VF_DURLEN_V1） |
| 9 | 前端播放**每 3 秒卡一下**（像暂停） | `/api/storage/file` 把**整个视频读进 Node 内存**再吐出，且**不返回 `Accept-Ranges`** → 浏览器无法 Range 请求 → 必须整段下完才能续播 | 播放改 **302 到 OSS 签名地址**（OSS 原生 Range、服务器零内存）；下载仍走原路（`?download=1`） |

**自查另外抓到 3 个**：① 表单/文案卡/换音色卡**三处各写一份音色列表**，其中两处留**无效的 `longyuan/龙嫗`**（不在百炼官方列表）→ 统一为 `VF_VOICE_BASE`（官方 7 个）② `VF_SPLIT_V1` 拆分后**旧日志行仍引用 `vfPlanRaw`** → ReferenceError 被 catch 吞掉（只留假"异常"日志）③ 表单发英文 `source:"upload"`，而分支只认中文 `/上传/` → **表单里点「我上传」会走成"素材合成"**。

---

## ✅ 已确认（2026-09-20 服务器部署前提三条 —— 原 🔴 已解除）

- **脚本已进 git**：`scripts/video-factory/{make,render,tts}.py` 早已被跟踪（`git ls-files` 有），当初的 `TOOL_REJECT` 实为**路径问题**（见上表 #3），不是没提交。
- **中文字体已装**：`fonts-noto-cjk` + `fonts-wqy-zenhei` 均为 already newest；`/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc`（`render.py` 首选路径）**存在**。
- **python3 / ffmpeg 均在 PATH**：`/usr/bin/python3`、`/usr/bin/ffmpeg`。
- **Python 依赖**：三个脚本**只用标准库**（argparse/json/os/re/subprocess/sys/tempfile/base64/time/urllib/shutil）→ **无需 pip 安装**（此前误查 `PIL` 是错的，已纠正）。

---

## 🔧 已修复待验证（2026-09-20 实测三问题：0 镜 / 主题污染 / 音色重复）

- **①【真凶·最高优先】分镜 0 镜 → 成片没有素材画面**：根因=**prompt 示例里写了 `"pick":图号`（占位符无引号），AI 一字不差照抄** → `"pick":图1` → **JSON 非法** → 解析失败 → 0 镜 → 走 `--script` 规则切句 → 全是文字卡、**没有任何素材画面**（用户："字幕配音都有，就是没画面帧"）。
  **修**：prompt 示例改合法值 `"pick":1` + 明确"pick 必须纯数字，不要写「图1」"；新增 `vfFixJsonArray()`/`vfParseShots()` 正则容错；抽出 `genVideoShots()` 并在解析失败时**自动重试一次**（回喂 AI"只修 JSON"）。
- **②【门禁】0 镜也放行出片**：新增 `★VF_GATE_V1` —— 分镜 <2 镜时**不给「确认出片」**，改为「🔄 重试分镜」/「▶️ 先出字幕版（无素材画面）」；确认分支同样拦截（除非用户明确要字幕版）。这条正是"状态机只管流程、不管门槛"的补课。
- **③【主题脏】主题被写成 `VF_FORM:{...}` 原文**：新增 `★VF_TOPIC_V1` —— 协议串（`VF_FORM:`/`VF_JSON:`/`{`/`[` 开头）与按钮文本一律不当主题（此前它还会被喂进写文案的 prompt）。
- **④【交互冗余】音色出现两次**：script 卡去掉 `voices` 列表（表单已选过），改为 hint 里显示"当前配音：X"。
- **⑤【时长/覆盖率】成片只念约 30%、只有 110 秒（不是 180 秒）**：实测 `subs.ass` 17 条 Dialogue × 5~7 秒 = 110 秒，`subtitle` 只覆盖 1370 字文案的约 30% —— **后 70% 文案从没被念、也没字幕**。根子=表单承诺「180 秒 ≈ 810 字 ≈ 36 镜」，而 AI 写 1370 字、只排 17 镜。**修（用户定案「严格 180 秒」）**：`★VF_LENFIX_V1` 超额压缩（>1.15 倍让 AI 压缩、>1.35 倍句末硬截）+ 分镜 prompt 强制镜数并覆盖全文 + `★VF_COVER_V1` 覆盖率 <80% 不给确认 + 「重试」带上"上次只覆盖 X%"。
- **⑥【分镜卡 type 被 AI 自造】实测 `[分镜构成]` 出现 `subtitle` 这种 type**（我只给 5 种）→ `render.py` 不认（丢画面）+ 覆盖率统计漏掉其文案（34% 虚低）。**根因还有一半在我**：prompt 要求"每镜 20~60 字"，**示例却只写 7 字** → AI 照写 11 字/镜。**修**：prompt 加 type 红线 + 示例 subtitle 改 28~33 字真实句子 + `★VF_TYPEFIX_V1` 未知 type 归一化为 bgimage/title 并捞出文案 + **`★VF_SUBFILL_V1` 字幕兜底**（覆盖率 <80% 时**代码把文案按顺序切成 N 段填入每镜 subtitle**，只增不减 → 覆盖率必然 ~100%）。
- **⑦【成片只有 BGM、没有人声】真因＝百炼音色名被喂给了火山** → **已升级为"TTS 四引擎实测"**：**Minimax ✅ / 硅基 ✅ 可用**；**百炼新端点 + `qwen3-tts-flash` 报 403 `"current user api does not support asynchronous calls"`（说明端点对、只是不能带 `X-DashScope-Async` 头）**；老端点 400；`cosyvoice-v3-flash` 400 `"url error"`；火山映射对但该音色返回 0 字节。**修**：`VF_TTS_ORDER` 引擎顺序可配 + 新增 Minimax/硅基引擎 + 百炼端点可配（v3 走同步）+ qwen3 音色映射 + 火山音色降级重试。**立即可用**：`VF_TTS_ORDER=minimax,silicon`：表单音色 `longxiaochun` 是**百炼 id**，`chat/route.ts:398` 原样透传 `--speaker` → 百炼链 HTTP 400（项目内同 body 的 `ai-providers.ts:1811` 也不通）→ 火山兜底**不认识这个音色名** → 每镜失败 → 无声片 + dur 停在 AI 值（**64 秒**，而卡片写"预计 182 秒"）。**修**：`★VF_VOICE_MAP_V1` 百炼→火山音色映射 + `★VF_TTSERR_V1` 打印百炼响应体 + 百炼失败即停重试 + `make.py` 失败打首尾行。**验证方法（无需 build）**：`python3 scripts/video-factory/tts.py --text "测试" --speaker longxiaochun --out /tmp/t.mp3` 应输出 `ok=True`
- **⑧【新发现·待调研】克隆音色与本轮新 TTS 冲突**：声音复刻（"我的克隆音色"）仍写 `cosyvoice-v1`（`ai-providers.ts:2391/2412`），而百炼 TTS 已换成 **`qwen3-tts-flash`**（只认 `Cherry/Serena/Ethan/Chelsie`）→ **CosyVoice 系克隆音色无法用于 qwen3-tts 合成**（官方明确"克隆音色只能用于**同族**合成"）。**待办**：查百炼是否仍提供 cosyvoice-v3 系列合成入口以支持克隆音色；否则"克隆音色"功能需在 UI 上标注限制，或单独走 cosyvoice 端点。
- **⑨【镜数/节奏】AI 排不够镜头 → 一镜 24 秒太闷**：实测 `13 镜 / 188.5 秒`，第 9 镜 **107 字字幕 = 24.4 秒**一个字幕不动；前 4 镜 24~49 字正常、后 9 镜 57~107 字（兜底按"AI 给的 13 镜"切 + `per*1.6` 阈值让长句段落攒到 100+ 字）。**修**：`★VF_SPLIT2_V1`（限长 45 + 长句二级切 + 劈最长段）+ `★VF_SHOTCOUNT_V1`（镜数 < 目标×0.7 → 按目标镜数重排）。**待验证**：应出现 `[VF] [扩镜] ... → 36 镜（每镜约 23 字 ≈ 5 秒）`
- **⑩【素材选取】按更新时间取前 N → 全是同一批相似帧**：`listRepoMaterials` 原来 `.sort(updatedAt 倒序).slice(0, limit)`，用户一次上传 32 张同一视频的切帧 → **取到的全是相似帧**（画面单调）。**修**：`★VF_MATSPREAD_V1` 封面图优先 + 按文件名批次分组 + 组间轮转交织。
- **⑬【糊 + 黑白】三层叠加，已修**：① 黑遮罩 42%（`render.py L411`）→ 压成"黑白"；② 素材混 640×304 抽帧 → 放大 3 倍极糊；③ 画布固定 1920×1080 而素材最大边 1440 → 一律放大。**修**：黑遮罩 0.42→0.15（+底部字幕区 0.30）、`★VF_HDONLY_V1` 过滤短边<640 的图、`★VF_SIZEFIT_V1` 画布跟素材走、`probeMaterialSizes` 探测 20→30 张。**待验证**：`[画布] … → 1280x720`、`[清晰度] 30 → N 张`，成片颜色回来且不再糊。
- **⑭【画面大字每条一样】已修（2026-09-20）**：根因 = **AI 照抄 prompt 示例里的文字**（示例含 `效率翻10倍`/`AI营销系统`/`三大能力`/`评论区见`…）→ 每条成片画面大字固定不变。**修**：prompt 加红线（"示例文字只是格式演示，**绝对不许照抄示例里的任何词句**"）+ **`★VF_NOCLONE_V1` 代码兜底**（命中示例词黑名单 → `text/title/label/cta/items` 一律清空，宁可这一镜没大字）。
- **⑮【多镜重复用同图】已修（2026-09-20）**：实测"6 镜只用到 2 张不同图"。根因 = AI 的 `pick` 反复给同一张，代码又直接采用。**修**：**`★VF_PICKSPREAD_V1`** 改为"**用得最少优先 + 相邻不重复**"（`usedCnt` 计数，`cap = ceil(目标镜数/图数)`），AI 的 `pick` 只当"倾向"。
- **⑯【画面风格只有一套】已修（2026-09-20）**：`make.py`/`render.py` 早有 3 套主题（`dark`/`tech`/`light`），但**表单从没暴露** → 用户永远只拿到深色。**修**：前端加「画面风格」一栏 + 后端 `f.theme` 解析（**白名单校验**，非法值回落 `dark`）+ **`★VF_TEXTSTROKE_V1`**（给压在素材照片上的画面大字加**深色描边**，否则 `light` 主题的近黑字在深照片上看不清）。
- **⑰【卡型只用上 4 种】已修（2026-09-20）**：`card_compare`（左右对比）/`card_chart`（横条生长）**渲染与 `KNOWN_TYPES` 早就就绪**，但 prompt 里写着"type 只能是这 5 种"→ **AI 从不用它们**。**修**：prompt 白名单放宽到 **7 种** + 给字段骨架；并**修掉我上一轮埋的隐患**（`notDemo` 把 `items` 一律当字符串 → chart 的对象数组 `[{label,value}]` 会被变成 `"[object Object]"` → 渲染崩；已改为**分形态处理**）。
- **⑱【自造卡型会整片挂掉】已修（2026-09-20）**：`render_shot` 对未知卡型原来 **`raise RuntimeError`**（整镜渲染失败 → 严重时整片出不来）；而 `KNOWN_TYPES` 里还摆着 **`timeline`（`CARDS` 里没有）** → AI 自造就会被放行 → 抛异常。**修**：未知卡型**降级为 title 卡**（打 `⚠️ 未知配方卡「x」→ 降级为 title 卡` 日志）+ `KNOWN_TYPES` 移除 `timeline`；同时把 `--selftest` 从 5 镜扩到 **8 镜**（覆盖 compare/chart/quote），让"上轮放开的卡型"能被自检验到。
- **⑲【看不到分镜细节】已修（2026-09-20）**：卡片只显示"排了 N 个镜头"，问"只有这一种效果吗"时**看不到用了哪些卡**。**修**：**`★VF_SHOTLIST_V1`** —— 卡片上新增**可展开的「分镜清单（N 镜 · 卡型列表）」**，逐镜列 `序号 + 卡型 + 文字`；后端 `shots[].text` 同时补上 `compare`（`left vs right`）与 `chart`（items label 串）的可读摘要。（另：`KNOWN_TYPES` 去掉 `image` —— 它要 AI 给本地 `src`，原本已被 bgimage 分支接住，属"语义清晰"非修 bug。）
- **⑳【计费多扣数倍】已修（2026-09-20，端到端推演发现）**：`make_ai_video` 的 `vfCost` 原来 `= ceil((vfScript || vfPlan).length / 20)`；而**调用处走 plan 时不传 `script`** → `vfScript` 为空 → **拿 `plan` 的 JSON 长度算价** → 36 镜 JSON ≈5.4KB ≈ **270 点**，而卡片报价只有 **41 点**（按文案 819 字）→ **实扣多出好几倍** ⚠️。**修**：**`★VF_COSTFIX_V1`**（有 `script` 用 `script`；只有 `plan` 时按**分镜 `subtitle` 总字数**估算，与卡片报价同口径）+ 调用处**补传 `script: vd.script`** 双保险。
- **㉑【任务日志只留 8 行】已修（2026-09-20）**：`tail: …slice(-8)` → 36 镜的 `[TTS] ❌ 第 N 镜配音失败` 这类关键行**全被截掉**，事后无法诊断。**修**：`tail` **8 → 40 行**、`so` 缓冲 **5000 → 20000 字符**。
- **㉒【失败时的任务日志被二次砍断 + 耗时一直涨】已修（2026-09-20，端到端推演第二段）**：① `chat/route.ts` 的 `tail` 我上轮从 8→40 行，但 **`make-video-status/route.ts` 又 `slice(-6)`** → 上层扩容白做一半；而前端（`page.tsx:736`）**失败时正是把 `tail` 拼进错误消息** → 诊断信息只剩 6 行。**修**：`★VF_TAIL_V2` → `slice(-30)`。② 已完成任务的 `elapsedSec` 用 `Date.now() - startedAt` → 前端显示"已跑 Ns"**一直在涨**。**修**：`★VF_ELAPSED_V1` 有 `finishedAt` 用它算。
- **㉓【任务状态匹配用了危险兜底 + 超时悄悄停掉】已修（2026-09-20，端到端推演第三段）**：① 前端轮询用 `find(x => x.id === taskId) || r.tasks[0]`，而状态接口只返回「**最近 5 个任务**」→ **find 没命中就拿到别的任务的状态** → **误报"成片完成/失败"**。**修**：`★VF_POLLMATCH_V1` 改成**必须精确命中**。② 轮询超时（30 分钟）原来是 `clearInterval` **悄悄退出** → 用户一直等。**修**：`★VF_POLLTIMEOUT_V1` 给明确提示。
- **㉔【"本地仓库自动同步"是无条件话术】已修（2026-09-20，端到端推演第四段）**：完成卡**无条件**显示"（本地仓库自动同步）"，而 `storageMirror` **只在客户端存在**（浏览器里没有 `electronAPI`，静默失败）→ **浏览器里这句是假的**。**修**：`★VF_MIRRORHONEST_V1` 先探测能力再决定文案（有客户端→"已同步到本地仓库"；没有→"在客户端里打开会自动同步到本地"）。
  （同段推演还**排除了一个假警报**：`persist=1` 不影响 302 —— `storage/file/route.ts:38` 只看 `isVideo && !isDownload`，所以"播放每 3 秒卡"的修复**有效**。）
- **㉕【AI 成片：按钮"有但没接"= `disabled`】**（2026-09-20，用户指出）：`page.tsx` 表单里「🎨 全部 AI 生成」的 `R()` **第 5 个参数传了 `true`** —— 而 `R = (cur, val, label, set, dis = false) => <button disabled={dis}>` → **按钮灰掉、点不动**（与"上传按钮点不动"同一成因）。**修**：去掉 `true`（`mix` 的 `true` 保留，因确实未实现）+ 三处文案「（开发中）」→「（约 50 点/秒）」。
- **㉖【AI 成片：报价与实扣不同源 + 两处"假话"】**（2026-09-20，端到端推演）：① **确认卡 `cost` 按文案字数**（30 秒片 ≈7 点），而 `make_ai_video` 在 AI 模式**按秒 × 50**（≈1500 点）→ **卡片报 7 点、实扣 1500 点**（"多扣费"的翻版，方向相反）。**修**：`vfScriptCard` 内同样用 `_isAI` 判断 → **报价与实扣同源**。② **`bgimage` 分支是显式造对象**（`{type,src,text,subtitle,dur}`）→ 把 AI 给的 `prompt`（英文画面描述）**丢掉**，`make.py` 只能用中文 subtitle 兜底。**修**：改为"有才附带"（`KNOWN_TYPES` 分支用 `{...s}` 本就能留）。③ **两处假话**：确认卡无条件写「（画面用你的素材）」、`hint` 写"按素材定为竖屏" → AI 模式都改为实话（「🎨 画面由 AI 逐镜生成」）。
- **㉗【★重要·非 bug·易困惑】「画面来源」有【两套 UI】，取决于有没有草稿**（2026-09-20 查清）：`page.tsx` 里有两处，由后端 `step` 字段决定显示哪个：
  | 后端发的 | 前端显示 | 什么时候 | 文件位置 |
  |---|---|---|---|
  | `step:'form'` | **`VideoFormCard`（完整表单：画面来源+画幅+时长+音色+主题+BGM+风格，一次提交）** | **只有"第一句起稿"、没有草稿时**（`route.ts:2726 if (!vd)` → L2751） | `page.tsx:2236` → `VideoFormCard`（L469-660） |
  | `step:'source'` | **内联卡片（画面来源 4 按钮 + 画幅 3 按钮）** | **已有草稿后的一切交互**（`route.ts:2793/2802/2812/3108/3117`） | `page.tsx:2267-2300` |
  **⚠️ 因为草稿持久化**（`saveVfDraft` 存 DB，刷新/重启不丢）→ **做过一条成片后，`VideoFormCard` 可能再也不出现**，用户永远看到 `source` 卡片。
  **⚠️ 教训**：**改"画面来源"相关 UI 必须【两处都改】**，否则在用户实际用的那一套上看不到效果。
- **㉘【非 bug·定位法】"前端改了不生效"怎么自查**（2026-09-20 查清）：服务器上三类东西**生效方式不同**——
  | 类型 | 生效方式 | 是否要构建 |
  |---|---|---|
  | **Python 脚本**（`scripts/video-factory/*.py`） | `git reset --hard` **立刻生效** | **不需要** |
  | **后端**（`src/app/api/**`） | `deploy-server.sh` 重建 | 需要 |
  | **前端**（`src/app/**/page.tsx`） | 同上（同一次构建） | 需要 |
  **⚠️ 症状**：**后端已是新版、前端还是旧版** → 说明 **`page.tsx` 的改动没进那次提交**（同一次 build 不可能只更新一半）。
  **自查（不改任何东西）**：`git status --short` 看 `page.tsx` 是否还在未提交列表；`git log --oneline -3` 看提交里有没有它。
  **真实案例**：2026-09-20 用户实测截图里，**后端 `hint` 已含"画面由 AI 逐镜生成"（新版）**，而**前端卡片仍写"（画面用你的素材）"（旧版）** —— 正是这个现象。
- **㉙【★严重·已修】点「确认出片」回「发布流程未开始」—— 我引入的，出片完全中断**（2026-09-21 用户实测 + git 定位）：`chat/route.ts:535` 我写的 `const _vdCur: any = VIDEO_DRAFT.get(uid) || {}` —— **`executeToolCall(name, args, auth)`（L398）签名里没有 `uid`**（同段落用 `uidVF`；`uid` 的 const 定义都在别的 case 块，如 L425）→ 调 `make_ai_video` 时**抛异常** → 被 `catch (eVF)`（L3111）**吞掉** → **成片块没能覆盖 `wfEarlyReply`**，露出**【发布状态机】L2171（8-31 老逻辑）的兜底文案**「发布流程未开始——请说『帮我发一个视频』开始任务。」
  **⚠️ 关键教训（防再犯）**：
  1. **看起来像"两个状态机混用"，实际是"成片块被一行变量错打断"** —— 那句老文案**一直都在**（每次都被成片块覆盖），所以**不能只看现象就改顺序**；先确认"成片块是否真的执行完了"。
  2. **`catch` 吞异常 = 最难查的一类**：L3111 只写一行 `console.error`，用户端只看到**上一步的旧文案**，毫无线索。**「某个功能点了没反应」时，第一件事是去日志里搜 `异常`**。
  3. **定位手段**：`git log -S "<可疑字符串>"` —— **一次就能锁定"这行是哪次提交引进的"**（本次直接锁定 `7c6f87dd`），比逐行读代码可靠得多。
  **修**：`uid` → `auth?.userId || 0`（与成片块写草稿的 key `uidVF2 = auth?.userId || 0` 一致）。
- **㉚【非 bug·易踩】"确认"会先被【发布状态机】写一句兜底**：`chat/route.ts:2169 stWordNoTask` 只检查 `PUBLISH_DRAFT`，**不检查 `VIDEO_DRAFT`**，而它的词表里含「确认」→ 会在 `wfEarlyReply` 里**先写**「发布流程未开始…」；**正常时会被后面的成片块覆盖**，**一旦成片块异常就会露出**（见㉙）。**改这片代码时要记住这个依赖关系**。
- **㉛【AI 制片独立线：建线过程中"逻辑核对"抓到的 4 个问题】**（2026-09-21，全部已修）：① **`@/lib/prisma` 路径不存在** —— 我最初 `import { prisma } from '@/lib/prisma'`，grep 全项目**该路径根本不存在**（`route.ts` 是 `L351 import { PrismaClient }` + `L379 const prisma = new PrismaClient()`）→ **会 build 失败**。**教训**：新文件里写 import，**必须先 grep 确认路径存在**。**修**：改为 `ctx` 注入。② **`shouldTakeOverAiLine` 致草稿永久卡住** —— 原逻辑"有草稿 + 用户随口一句（非流程词/非表单/不含'AI'）→ 返回 false" → 掉回素材合成线 → 那条线看不到本线草稿 → **AI 自由发挥，草稿永远做不完**。**修**：**有本线草稿 → 一定接管**。③ **音色列表没传 → 表单"配音音色"区空白**。**修**：`VfAiCtx` 加 `voiceList` + 起稿卡带 `voices` + `route.ts` 注入 `VF_VOICE_BASE`。④ **用户没点表单、直接在对话里说主题 → 主题被忽略**（只回"请点开始出片"，与素材合成体验不一致）。**修**：新增"第 2.5 步"（`step==='form'` 且非表单/非流程词/长度≥2/非画幅词非协议串 → 当主题直接起草）。
- **㉜【非 bug·边界铁律】AI 制片与素材合成的隔离靠三条**（改这片代码前必读）：① **`vf-aivideo.ts` 零 import**（依赖全走 `ctx` 注入）——**加新依赖时必须走注入，不要 import 项目内部路径** ② **草稿 tag 分开**（`vf_draft` vs `vf_draft_ai`）——**绝不能合并** ③ **`route.ts` 只有一处分派**，成片块条件是 `if (!vfAiHandled && …)` —— **`vfAiHandled` 没接管时必须恒为 false**（否则会连累素材合成）。
- **㉝【★入口词规则表（三条线 + 工具 + 发布）—— 2026-09-21 逐句推演验证】** 改任何入口正则前**必须对照这张表**，否则会出现"走错线"或"抢走工具/发布的活"：

  | 用户说 | 走哪条 | 状态 |
  |---|---|---|
  | 帮我发一个视频 | **发布状态机** | ✅ |
  | 帮我写一个小红书文案 | 工具 | ✅ |
  | 帮我生成一张产品海报 | 工具 | ✅ |
  | 帮我查一下今日热点 | 工具 | ✅ |
  | 帮我生成一个数字人口播 | 工具 | ✅ |
  | **用本地成片帮我做一条视频** | **素材智能成片**（`vfIntent`） | ✅ |
  | 帮我配一段背景音乐 | 工具 | ✅ |
  | 帮我搜一下小红书「奶茶」 | 工具 | ✅ |
  | 帮我记录一件事：明天要交房租 | 工具 | ✅ |
  | **用 AI 帮我做一条视频 / AI 制片 / AI 成片 / 全部AI生成** | **AI 制片**（`matchesAiLine`） | ✅ |
  | **素材+AI创作 / 素材加AI / 混合创作** | **素材+AI 创作**（`matchesMixLine`） | ✅ |
  | **帮我写一个 AI 制片文案** | **工具**（写文案）← ⚠️ 靠 `TOOL_INTENT` 排除，否则会被 `/AI\s*制片/` 抢走 | ✅ |
  | 帮我写一个 AI 成片的脚本 | **工具**（写脚本） | ✅ |

  **优先级（`route.ts` 分派顺序）**：混合线 → AI 制片 → 素材智能成片 →（都没接管则）AI 自由发挥/工具。
  **两条新线都先排除**：① 发布类词（`发布|发到|发抖音|…`）② **工具类词**（`TOOL_INTENT` 命中且不含"成片/制片/做视频/剪辑/出片"）。
  **⚠️ `vfIntent`（素材智能成片）未加工具排除** —— 用户"先不动现有的"；已核对它不误匹配工具类（它只要"做…视频/成片"）。
- **㉞【★零 import 铁律的代价·必查项】** 两条新线（`vf-aivideo.ts` / `vf-mix.ts`）是**零 import** 的 → **每一个引用的常量/函数都必须在【本文件】里定义**。**2026-09-21 就因此踩过一次**：`vf-mix.ts` 里写了 `TOOL_INTENT.test(m)`，而 `TOOL_INTENT` 定义在 `vf-aivideo.ts` → **`ReferenceError`，混合线一进门就崩**。**加新引用时立刻确认"它在本文件吗"**；改完用 `grep "^const [A-Z_]+"` + `grep "^function"` 对本文件做一次符号表核对。
- **待确认**：再跑一条（上传几张图 → 出片）——应看到：`[VF] [概要] 图N张 镜N个 风格=… 画幅=…(WxH) 配音=… 时长≈N秒`（★新增，一条看全）、`[上传] 精确使用 N/N`、画面大字**不再是那几句**、相邻镜**不同图**；选「📄 浅色纸感」应看到底色变浅且**大字仍清晰**；若文案里有对比/数据，可能看到 **compare / chart 卡**；**卡片上可展开「分镜清单」看到卡型、**每镜时长**与每镜文字**；**确认卡会显示「风格 X」（深蓝/深青/浅色纸感）与当前配音**；**渲染日志现在每镜带时长**（`第 N 镜 OK  title  5.3s -> shot00.mp4`）与 `拼接完成（共 N 镜 X 秒）`；**扣费应与卡片报价一致**（如报价 41 点就扣 41 点）；**失败时错误消息里能看到最多 30 行日志**；**任务等超 30 分钟会给明确提示**（不再静默）；**完成卡在浏览器里显示"在客户端里打开会自动同步到本地"**（不再无条件说"已同步"）。
- **★AI 成片待确认（2026-09-20 新增，建议先用 10 秒小试 ≈500 点）**：切「🎨 全部 AI 生成」后应看到 **画幅「自动」变灰（并自动落到竖屏）+ 「我上传素材」变灰且文案写"（AI 模式不用）"**；起草日志 `[画面来源] 全部 AI 生成（MiniMax H3）—— **仍按素材写文案/分镜/画幅**`；`[画布] 素材最大边 …px`（**照旧跟素材**）；确认卡显示「（🎨 画面由 AI 逐镜生成，约 50 点/秒）」+ 按钮「确认出片（约 500 点）· 🎨 AI 画面」；确认后 `[MAKE] ★画面来源=全部 AI 生成 → 调用 MiniMax H3` → 逐镜 `[H3] 第 N/M 镜 生成中…` → `[H3] ✅ 第 N 镜 OK  中转  6.0s`；**卡上报价点数应与实际扣点一致**；若某镜失败应看到 `[H3] ⚠️ 第 N 镜 AI 生成失败 → 该镜回退用原画面`（**不整片挂**）。

## 🔭 未来升级方向（2026-09-20 用户点名保留，**现在都不做**）

> 完整规划（含 11 个能力开关命名表 + 落地两步）见 `docs/能力开关与未来升级方向-20260920.md`。

- **真叠化转场**：视频 `xfade` + 音频 `acrossfade` **必须同步改** —— 只改视频会让总时长缩短 `(N-1)×d`（36 镜 ×0.5s ≈ **17.5 秒**）→ 音画错位。
- **词级字幕（真字级时间戳）**：现在按"每镜字幕字数均分"估算 `\k`；要真字级需 funasr 或 TTS 返回字级时间戳。
- **克隆音色**：百炼 `qwen3-tts-flash` 只认 `Cherry/Serena/Ethan/Chelsie`，**CosyVoice 系克隆音色不能跨族用**（官方明确）；用户定"最后集中处理"。
- **🎨 全部 AI 生成 / ✨ 素材+AI 混合**（成片的"画面来源"子开关）：需"AI 逐镜生成画面"，成本 ≈100 点/秒。
- **客户端播本地库（D1）**：要改 `electron/` → **必须重打包发版**；用户定"下个版本"。
- **能力开关表**（按套餐/客户开通）：现在只有 `EXCLUDE_FREE`（自由模式排除集）这一种形态。

## 🟡 成片遗留（2026-09-20）

- 🟡 **C 批「叠化转场」实际是"每镜淡入淡出"，不是真叠化（如实标注，不当已实现）**：当前为 `fade=t=in/out` 各 ≤0.2s（镜间一次轻微黑场过渡），**不是 xfade crossfade**。原因：`xfade` 会把总时长缩短 `(N-1)×d`，而 `voice.m4a` 是按逐镜片段拼出来的 → **音画必然失步**，必须同时对音频做等量交叉淡化并重算时间轴；在**本会话无法运行验证**的前提下动时间轴风险太高。要真叠化：拼接阶段做视频 xfade + 音频等量交叉淡化，**改完必须实跑一次**。
- ✅ **「📤 我上传素材」已接通**（2026-09-20，原为死路）：前端真上传到个人仓库（`POST /api/storage/files`）→ 后端 `listRepoMaterials(mode='recent')` **只取刚上传的**，再走同一套起草流程。**待验证**：点按钮选 3 张图 → 出片画面只用这 3 张。
- 🟡 **【时长超 18%】212.6 秒 vs 目标 180**：AI 写文案 1070 字（目标 810），压缩后仍超且**未触发硬截**（1070 < 810×1.35）。待定：把硬截阈值收紧到 1.15（会丢内容）还是容忍 ~210 秒。

- 🟡 **D1 客户端播本地库**：成片完成后客户端已镜像到本地（现有机制），但播放仍走服务器/OSS。要让 Electron 直接播 `安装目录\storage\xxx.mp4` 需改 `electron/` → **必须重打包发版** → 用户决定**放到下个版本**。
- 🟡 **A~D 整批待部署实测**：subtitle / 302 / build_srt / 表单化 / Ken Burns / 镜间过渡 / 配音卡点 / 主色底板 / BGM / 克隆音色 / 词级字幕(ASS karaoke) **代码全部完成**，但**一次都还没跑过**（本会话 shell 工具故障，无法本地验证 Python/ffmpeg）。
- ✅ **已核对（不是问题）**：ASS 与 SRT **都**经 `sub_font_name()` 取名，该函数**按文件存在性回退**（`Microsoft YaHei` → `Noto Sans CJK SC` → `WenQuanYi Zen Hei/Micro Hei`）；服务器三类字体齐备 → 无回退隐患。（我最初误记为"ASS 路径未做回退"，已核实纠正。）

---

## ✅ 已解决（2026-09-18 Minimax 测试端点不一致）

- **问题**：设置页「测试」按钮测 Minimax 打的是**国际站** `api.minimax.chat/v1/text/chatcompletion_v2`，而实际功能（AI 音乐 / H3 视频）走的是**国内站** `api.minimaxi.com` → 点测试可能误报。
- **修复**：`test-key` 新增 `case 'h3'` —— 按**实际通道**测（中转优先 → 官方），手法是"查一个不存在的任务"，**不消耗额度**。原 `minimax` 分支保留未动（仍服务于音乐）。
- **遗留（低优先）**：若要让"音乐"也测国内站，可把 `minimax` 分支改成打 `api.minimaxi.com/v1/music_generation`。

---

## ✅ 已解决（2026-09-18 Git 误提交 26146 个文件）

- **症状**：本地 `git add -A` 提交 1.0.205 时把 `temp/`（Python 环境副本、`playwright/driver/node.exe` 88.3MB×2、`oss-check.zip` 85.5MB…）**26146 个文件**一起提交 → 服务器 `git fetch` 要拉 **55.10 MiB / 19955 objects**（用户及时 Ctrl+C 中止 —— `&&` 短路，所以 `reset --hard` 没执行、服务器代码未被破坏）、本地 `.git` 涨到 **894.9MB**（`.git/index` 3.8MB）。
- **修复**：`git reset --soft 188ec178^` + `git reset`（文件无损）→ **按路径白名单**重新 `git add` → 提交 `cbb9766a`（20 files / 1960 insertions）→ `git push --force-with-lease origin master`（仅传 **768 bytes / 4 objects**）。
- **防复发**：① 新增 `temp/.gitignore`（`*` + `!.gitignore`，按目录整体忽略）② 根目录 6 个临时文件已删（`tsconfig.tsbuildinfo`/`viag-shot*.png`/`xhs-shot.png`/`zipsize.txt`）、`package.json.bak-sl` 移出工作区 ③ 规则已写进 `AGENTS.md`：**禁止 `git add -A` / `git add .`，提交前必看 `git status --short`**。
- **待办（低优先）**：本地 `.git` 那 ~895MB 不可达对象，需要时 `git gc --prune=now` 回收。

---

## 🔴 服务器侧部署前提（2026-09-18 本地成片上服务器）

> 本地成片（`scripts/video-factory`）已按 **Linux 服务器** 适配（★VF_LINUX_V1 / ★VF_REPO_V1），但下面三条不做，线上依然跑不起来：

1. **必须 `git push` + 服务器部署**：`make_ai_video` 在 chat route 里 spawn `scripts/video-factory/make.py`（跑在 API 机器上）。`scripts/video-factory` 目前只在本机 → 不 push 的话服务器上 `fs.existsSync` 判定失败，直接返回 `TOOL_REJECT:未找到本地成片脚本`。
2. **服务器装中文字体**：`apt-get install -y fonts-noto-cjk`（或 `fonts-wqy-zenhei`）。不装 → 成片里的中文会渲染成方块（已加 Noto/文泉驿候选 + 回退，但没有字体文件就是没有）。
3. **服务器要有 python3 + ffmpeg + TTS 凭据**：`python3` 在 PATH（或设 `BU_PYTHON=/usr/bin/python3`）、`ffmpeg` 在 PATH（或设 `FFMPEG_PATH`）、`DASHSCOPE_API_KEY`（**主用百炼 CosyVoice**，服务器现有 key 即可；音色可用 `DASHSCOPE_TTS_VOICE` 覆盖，默认 `longxiaochun`）。火山 `VOLCANO_TTS_*` 仅作兜底、可缺。都没有时 tts.py 会明确打一行警告并出**无声片**（不再静默）。

---

## 🔴 发布链路待解决（2026-09-07）

- 🟡 **微博入口的正确写法（2026-09-13 实测定稿——修正此前误判）**：
  - ❌ 原来写成"直接打开 `weibo.com/upload/channel`"——那页的 file input 是 `accept="image/*,..."`（图片框），**塞视频会被静默忽略**，但脚本报成功（假成功）；且该地址会变。
  - ✅ **正确做法**：只 `goto https://weibo.com`（首页），然后 `query_selector('input[type=file][accept*="video"]')` **直接 set_input_files(视频)**——首页那个隐藏 input 的 accept 同时含 `image/*` 和 `video/*`，实测 3 秒内出现视频元素（720x1280）进入上传态。
  - 注意：脚本若**复用已开页面**，必须强制 `goto` 回首页（否则停在旧的上传页 → 又走图片框 → 假成功）。
  - 登记口（登录页）与发布入口是两回事：登记口用各平台**登录页**（微博 `weibo.com/login.php` 等），发布用首页。
- 🔴 **抖音封面上传与 browser-use 冲突**：browser-use 的 upload_file 是直接塞 file input（不点按钮弹窗），绕过抖音"设置封面→选择封面→弹窗→上传→完成"流程，封面保存不住。方案待定：A抖音官方API传封面 / B封面合进视频首帧 / C平台默认封面
- 🔴 **发小红书（跨平台复用）未实现**：同一视频/封面/标题/话题跨平台发布，自然语言"发小红书"不生效（full 分支只认"平台:"按钮格式）——待加自然语言平台识别+多平台循环
- 🟡 **对话内重发#N 待验证**：已实现（32fe01f，匹配 #N重新发布/重发/发布失败），用户实测未生效需排查（可能正则太窄/输入格式不符）

## 🔧 tsc 类型错误待清（2026-09-06 盘点——核心 11 处已清，剩 72 处）

**已清（cb65872）**：chat route 6 处 + ai-providers 5 处（含 3 个真 bug：videoUrl 字段名错 / uploadToOSS 不存在 / timeoutMs 不生效）。

**剩余 72 处（按文件，待分批清）**：
- 🟡 agent/page.tsx 30（SceneCard.items/frames 类型、BlobPart、asrSessionAbort、JSX 重复属性等）
- 🟡 prompt-templates/page.tsx 7（null 判断）
- 🟡 media-library/page.tsx 5
- 🟡 live-stream-engine.ts 4（uploadOSS 不存在——同类 bug，数字人/直播上传）
- 🟡 my-fingerprint/page.tsx 4
- 🟡 ApiKeyPanel.tsx 4（setMinimaxKey/musicModel 缺）
- 🟡 login/route.ts 3
- 🟡 video-task-manager.ts 2
- 🟡 GlobeTrends.tsx 2 + prompt-library 2
- 🟡 其他零散 9（middleware/Navbar/digital-human/subscription×2/music/media-library-promote/content-draft/client-info/publish-stats/agent-tools/ settings）

**待办（功能桩/缺陷，另开轮清）**：
- 🔴 自动化引擎 engine.ts 四实现全是桩（mock/官方API/真机/指纹）——功能没落地
- 🟡 opencli_run 死桩（要装命令才能用——应隐藏/删）
- 🟡 digital_human_speak 参数错位
- 🟡 热点无国内源
- 🟡 一键成片 TTS/合成间歇失败（qwen3-tts + ffmpeg）
- 🟡 标准/自由模式文件级隔离（free-flow.ts / standard-flow.ts 物理抽取）——**2026-09-12 更新**：第1步已完成（抽出 tools.ts 354行 / prompts.ts 290行 + 状态机块边界注释 L1586-2235 + freeMode 5 个分叉点清单写入 PROJECT.md）；第2步（状态机块物理搬 standard-flow.ts）待 6 平台真发验证通过后做

### ✅ 已解决
- ✅ **agent 发布链路 5 个真问题（2026-09-17 修复——用户逐条实测发现）**：
  1) **登录态"丢失"（重登 N 次登记仍显示未登录）**：`bu:check` 在 python 无输出/超时时也 `return {success:true, accounts:[]}` → 前端 `else` 分支把空数组当"所有平台都没登录"→ 全清。用户实测：重登快手 3 次登记仍显示未登录，而 `bu_check.py` 单独跑输出 `kuaishou:1` 是对的（打开浏览器的瞬间 Chrome 独占锁 Cookies，读不到即产出空）。修：① 不谎报 success ② 拿不到输出回退读 `browser-profile/bu_login_cache.txt` ③ 前端不再用空数组覆盖（`electron/main.js` bu:check + `src/app/agent/page.tsx`）。
  2) **抖音发布卡在封面（任务 #48 失败根因，本机已复现）**：旧代码"上传封面后死等 3500ms 就点完成"，实测此时封面图仍在"生成中"、这一下点击无效 → 抖音紧接着弹出【第二个窗口】「已基于横封面为你生成竖封面。效果不满意？独立编辑」，该窗口里【没有「完成」也没有可点的「发布」】→ 一直卡着（同代码等 5s 点=正常、等 3.5s 点=出第二窗口，纯时序）。修：轮询等「完成」按钮可点击（≤20s，含 `semi-button-disabled` CSS 类判断）+ 点后【校验弹窗是否真关闭】+ 重试 + 兜底关闭该提示层。
  3) **登录失效"假成功"**：抖音/小红书/微博原来【完全没有】登录检测；快手 `logged_in()` 太宽松（URL 不跳登录页 + 没出现"扫码登录"就判已登录，页面没渲染完会误判）。修：6 平台统一明确报"XX 未登录，请在登记浏览器登录"。
  4) **平台跳错页**：B站 goto 后【不复验】（登录失效被重定向到首页仍继续操作 → 用户看到"B站直接跳到首页去了"）；视频号原来"只要 url 含 channels.weixin.qq.com 就抓"、抓到首页也不导航。修：两者都导航到正确发布页 + 复验 URL。
  5) **视频号登录态每天必丢**：微信的 sessionid 每天换值、久不访问即作废（实测 cookie 有效期 395 天，不是到期失效）。新增 `scripts/keep-login-alive.mjs` + Windows 计划任务 `AiMarketing-KeepLogin`（每天 11:30；独立端口 9223 不抢发布 9222、窗口移到屏幕外、Chrome 单例检测"已在运行则跳过"、taskkill 兜底关闭）。
- 🟡 **Browser Use「打不开浏览器」问题总结（2026-08-30——以后排查速查）**：
  分层排查（L1服务器→L2执行器→L3轮询fetch→L4 Python→L5浏览器）：
  1) L3 服务器 500：getAuthFromHeaders() 没传 req（agent-tools/browser-tasks 同坑）→ request undefined → headers in undefined → 修传 req（2c14b8b）
  2) L2 执行器没跑：checkBrowserTasks serverUrl 未定义（ReferenceError——0d7f2b3）；BU_SCRIPT 路径（extraResources→resources 非 asar.unpacked——c33c2cc）；bu_exec.py 没打包（1913b2d）
  3) L3 cookie 空：getServerCookie url 精确读不到 → 多域 fallback（3381cf7）
  4) 旧任务累积：pending 全捡→连续开浏览器——需「执行/跳过/全部清除」管理（会话框显示——不弹窗）
  5) 发布仍走 publish_content（opencli 旧链——抖音 -2 定时）——应改 browser_use（待办）
- 🟡 **工具箱扩展计划（2026-08-30 定案）**：
  - **A（先做）**：内置工具集（browser_use 已验证 / P图IOPaint / 爬虫 等——由开发接入——工具箱只管开关/角色）——**仅 admin 可用**（测试成熟后开放普通用户由 AGENT 调用）
  - **B（排期——后续）**：真插件化（admin 填 git URL/脚本 → 自动安装依赖 → 自动注册+执行端点——即④ git/MCP 工具）
  - 权限：新工具默认 roles=admin——成熟才改 all
- 🟡 **工具箱扩展排期（2026-08-30）**：④git/MCP 工具接入（拉仓库→装依赖→注册→执行端点）——需设计"插件安装器"（admin 填 git URL → 克隆到 scripts/tools/ → 依赖安装 → 注册 AgentTool + endpoint 分发）——排期（非本次）
- 🟡 **更新计划（2026-08-28）**：①P 图去水印接入（IOPaint——lama/去水印——CPU 可跑——封面/素材去"AI生成"水印）——已归档（2025-08）评估 fork/自维护；②小红书/微博发布 DOM 链路待实测（#13 失败）
- 🟡 **TTS 方向定案（2026-08-28）**：先修百炼（action 已修——测试）；**后期 TTS 全部预装客户端本地调用（不走服务器）**——候选 Kokoro-82M（Apache/82M/CPU/中文——首选）/ sherpa-onnx（轻但客户端曾崩——服务器版可）。服务器只留百炼为主，本地为兜底。- 🟡 **工具链承诺缩水清单（2026-08-28 全面核查 34 工具——按优先级排，数字人/热点放最后）**：
  - 🟡 **制作发布链（先满足）**：generate_image 无参考图/i2i（封面图生图做不到——A+C 方案待做）；publish_content fromSource（版权提示）参数建任务时忽略；发布任务 pending 需客户端 3s 轮询执行（getServerCookie 已修——待实测任务闭环）
  - 🟡 digital_human_speak 参数错位（parameters 定义 imageUrl/voiceType，case 只认 avatarId 未定义——数字人说话可能调不通）
  - 🟡 search_trends 无国内热榜源 + 服务器 DDG/Reddit 访问不通（curl 空）——热点承诺落空
  - 🟡 search_storage 只搜个人素材（description 称平台级——公共搜不到）
  - 🟡 opencli_run 死桩（前端拦截已移除——返回文本无人执行——应隐藏/删）
  - 🟡 automation_check 无 create 分支（description 承诺 action=list/create——只有查询）
  - 🟡 search_web 需 SERPER_API_KEY（服务器 .env.local 无——报"未配置"）
- 2026-08-14 API key 保存后丢失/未配置：根因 ① config 写 cwd/standalone 被 rm -rf 删（修：DOTENV_CONFIG_PATH 统一）② 16 段保存没排除 ******** 掩码覆盖（修）③ statusMap minimax 未初始化显示未配置（修）——服务器验证 MINIMAX 保存成功
- 2026-08-14 settings 一页堆叠全部配置难用（修：分页 Tab 密钥/媒体/引擎/系统）

## ✅ 已解决（2026-08-25）
- **"＋打开浏览器登记"弹启动超时**：系统 Chrome 在跑时 spawn 附加失败（同 profile 锁）——bind-mine 优先内置 Chromium（独立 profile 必通 CDP）
- **登记账号无反应**：绑定成功后需刷新检测——现在登记中心每行平台卡实时绿点
- **浏览器找不到（跨机器）**：写死 Program Files + 注册表 App Paths + 内置 Chromium 兜底（三层）
- **AI 发布话术不一致**：平台能力表 4c3 注入（先登记任何平台→支持就发/不支持如实）
## ✅ 已解决（2026-08-24）
- **#301 无限重渲染**（Application error，mbb 会话118 触发）：renderTaskCard 渲染期调 openVideoFromUrl(setState)→循环；已改顶层 useEffect + ref 防重复
- **视频生成不落库不转存**（taskId 只在消息文本，视频做完即丢）：generate_video 生成即落库 + query_video_task 完成即转存 storage/ + 入仓库
- **丢失视频找回**：recover-video-task.mjs（taskId→百炼→下载→转存 OSS）；mbb 12秒"数字员工宣传片"已找回入仓库
- **frames 封面破碎图 404**：standalone 静态目录不服务运行时文件；改写 standalone public + /api/frames 读盘 API 兜底
- **附件视频显示链接**：renderContent 渲染 📎 视频为 video 卡片
- **一键成片不自动入仓库**：完成后自动上传 storage/{userId}/
- **浏览器账号一键启动崩溃**：补 bindMyChrome/browserNeedBind/bindingMine 定义
- **二次打开显示昨天记录**：恢复历史检查 updatedAt 非今天不恢复
- **服务器回调 401 静默失败**（done/download-url）：主进程读 session cookie 带上
- **agent 生成图片不转存**：generate_image 转存 storage/ + 入仓库 + 落记录

## 🟡 已知（2026-08-24）
- 视频任务提交即扣费、百炼最终失败不退点——自动退有漏洞风险，暂人工审核退点（待做：失败标记+人工退）
- 一键成片旧成片（修复前）在 public/generated 不在仓库——新成片自动上传
- frames 运行时文件在 standalone public——重启保留，但部署 rm -rf .next 会清（重新抽帧即可）
- 封面"AI生成封面"按钮已加，i2i 后端待接（generateImage 无参考图参数）
# AiMarketing 问题清单（ISSUES）

> 已知问题 / Bug / 风险 / 隐患。与 PROJECT.md 分开维护。
> 最后更新：2026-08-10 ｜ 状态图例：🔴 高（需尽快处理）🟡 中 🟢 低 ✅ 已解决（保留存档）
> 维护规则：每次操作后更新状态；问题解决后移到「已解决」区并注明日期。

## 〇、新规划待办（2026-08-10 起）

- 🟢 二期 A 已完成（c08031f）：generate_video >15s 首尾帧接力 + 成本两段式确认 + 分镜协议 + 任务引擎，待部署；二期 B（分镜视图/一句话成片）+ 三期（BGM/发布）待执行——见 PROJECT.md 六
- 🟡 中转站选型调研（OpenRouter/fal/Replicate/infistar）——必须覆盖文生图/图生视频/克隆视频能力，按用户实际需求定，勿盲目指引

## 一、支付 / 计费（🟡）

| # | 问题 | 位置 | 状态 |
|---|---|---|---|
| 7 | 点卡 checkout 读 process.env.ALIPAY_*，套餐 checkout 读 systemConfig（payment-config.ts），配置来源不一致，后台改配置后点卡可能走旧配置 | src/app/api/point-cards/checkout/route.ts | 🟡 |
| 8 | checkTokens/spendTokens 非事务（先查后扣，分步写），极端并发可能超扣 | src/lib/token-wallet.ts | 🟡 |
| 9 | 免费周卡 durationMonths=1 与代码实际 7 天口径不一致（schema 注释 vs 实现） | src/app/api/subscription/claim-weekly/route.ts | 🟢 |
| 10 | 微信 Native 支付未建（缺商户号，qrCode 字段已预留） | — | 🟢 待商户号 |
| 11 | 订单过期自动关闭定时任务未实现（过期订单滞留 pending） | — | 🟢 |

## 二、死代码 / 未启用（🟢）

| # | 问题 | 位置 | 状态 |
|---|---|---|---|
| 12 | quota-checker.ts 的 checkQuota 无任何调用方（死代码）；getUserMonthlyStats 仅 my-usage 使用 | src/lib/quota-checker.ts | 🟢 |
| 13 | subscription-guard.ts 封装 hasActiveSubscription，未见调用方 | src/lib/subscription-guard.ts | 🟢 |
| 14 | automation/engine.ts 四个实现（mock/official-api/real-device/fingerprint-browser）全是桩，返回假成功 | src/lib/automation/*.ts | 🟢 已知桩 |
| 15 | preload 暴露 adbBridge/adbBridgeStop，但 main.js 无对应 handler（调用会 reject） | electron/preload.js | 🟢 |

## 三、功能缺陷 / 待完善（🟡）

| # | 问题 | 位置 | 状态 |
|---|---|---|---|
| 16 | data-center 定时调度为内存 setInterval，服务重启丢失、不跨实例 | src/app/api/data-center/schedule/route.ts | 🟡 |
| 17 | MediaCrawler trending 未接 DouYinClient（crawler-client 返回提示走 main.py） | src/app/api/mediacrawler/lib/crawler-client.ts | 🟡 |
| 18 | Crawled* 数据写入端只有 lead-collector；mediacrawler 路由本身不落库仅透传 | — | 🟢 |
| 19 | agent publish_content 工具只校验账号绑定，不真实发布 | src/app/api/agent/chat/route.ts | 🟡 已知范围 |
| 20 | agent IM 渠道仅单向 webhook 推送，无收发对话循环 | src/app/api/agent/channel/route.ts | 🟡 |
| 21 | 热点大屏「情绪指数」为 mock 硬编码 72；关注度排序仅 localStorage 埋点 | src/app/agent/page.tsx | 🟢 |
| 22 | agent 对话非流式（一次性 JSON 返回），思考流为前端脉冲卡模拟 | src/app/agent/page.tsx | 🟢 |
| 23 | referral/preview 为纯前端模拟；nfc-promo API 失败回退内置 mock 模板 | src/app/referral/preview | 🟢 |
| 24 | 指纹浏览器：抖音改版后发布脚本坐标/选择器需重测维护 | electron/fp-templates/douyin-publish.js | 🟡 持续项 |
| 25 | douyin-official 开放平台适配器标注「申请资质后激活」，当前不可用 | src/lib/automation-providers.ts | 🟢 |

## 四、客户端本地化（阶段0）后待适配

| # | 问题 | 说明 | 状态 |
|---|---|---|---|
| 27 | 支付跳转适配：支付宝 checkout 返回的支付/回跳 URL 指向 ai-niuma.cc 域名，客户端本地模式下 window 跳转会离开本地壳 | 需改为 Electron 新窗口/外部浏览器打开支付，回跳后回到客户端（阶段 1 处理） | 🟡 |
| 28 | 生产环境 JWT_SECRET 未显式设置（默认 aimarketing-secret-key-2024，实测伪造 token 可通过远程验签） | 建议服务器设 JWT_SECRET 环境变量；客户端本地 middleware 与服务器需同步更新 | 🟡 运维建议 |
| 30 | 本地 .env.local 的 DEEPSEEK_API_KEY（尾 581a）无效（401），已改百炼 qwen 为 Agent 大脑默认；如需用 DeepSeek 需更换有效 key 并改回 | src/lib/ai-providers.ts dashscopeFunctionCall | 🟡 待用户提供有效 DeepSeek key |
| 31 | 打包版曾出现热点/地球/配置全空 + 「账号不存在」（根因：代理远程 + 客户端无本地库） | 2026-08-06 已解决：纯本地架构（无代理 + dev.db 打包 + DATABASE_URL），本地登录验证通过 | ✅ 已解决 |
| 29 | 客户端已引用新 API（/api/agent/media、/api/agent/suggestions），**服务器尚未部署**（当前返回 404）；且服务器未设 JWT_SECRET | 服务器 `git pull && npx next build && pm2 restart` 后生效；建议同时设置 JWT_SECRET | 🟡 待部署 |

## 五、已解决（存档）

| # | 问题 | 解决日期 | 说明 |
|---|---|---|---|
| 2 | /api/admin/seed-plans 完全无鉴权，任何人可初始化套餐 | 2026-08-05 | 已加 getAuthFromHeaders 鉴权（未认证 401 / 非管理员 403），语法检查通过 |
| 3 | /api/admin/usage-stats 无角色校验（仅 token 存在性） | 2026-08-05 | 已加 admin 鉴权（401/403），语法检查通过 |
| 4 | /api/admin/ai-generate-title 无角色校验 | 2026-08-05 | 已加 admin 鉴权（401/403），语法检查通过 |
| 5 | /api/subscription/buy 无鉴权可直接免费开通任意套餐 | 2026-08-05 | 全项目无调用方，按用户确认已删除该路由 |
| 6 | /api/admin/editor-quota 恒 403（(request as any).user 从未注入） | 2026-08-05 | 改为 getAuthFromHeaders 标准鉴权（401/403），语法通过；前端暂无页面调用（配额管理走 admin/users） |
| 1 | middleware 只解 JWT payload 不验签名，可伪造 X-User-* 头提权 | 2026-08-05 | 方案A：Edge Web Crypto HMAC-SHA256 验签，密钥与 login 一致；本地 4 用例测试通过（真token放行/篡改拒绝/错误密钥拒绝/损坏拒绝） |
| 26 | Windows 本地打包反复失败（7za 符号链接/zip 损坏/win-unpacked 占用需重建） | 2026-08-05 | 已脚本化根治：scripts/build-local.mjs 一键打包（清残留+7za补丁+zip校验+镜像）；main.js 退出残留修复待重新打包生效；根治需开开发者模式重启 |
| 🔴 | 2026-08-18 | Agent 发布链路认知错误：AI 编造任务 ID/已唤起发布页/预填（真实：任务建好客户端自动发）；open_page 不能带参唤起发布页，AI 禁承诺 | chat route 系统提示 + 前端 scene | 待修 |

## 已知问题
- 🟡 **发布工作流规格（用户确认式，用户于 2026-08-27 定）**：
  - ①抽帧：抽 4 帧 → 显示 4 张 + 选择键/编号 → 用户选帧
  - ②用户选帧后 → AI 基于画面推荐【3 个标题】 → 用户选/确认标题 → 留档（标题确认在封面前——封面要加标题文字，标题未确认无法制作封面）
  - ③话题标签：AI 推荐 → 用户确认 → 留档
  - ④封面：AI 根据【用户选帧 + 确认标题】制作封面（文生图输入=选帧+标题）→ 反馈 → 确认 → 留档
  - ⑤全部确认后 → 显示【确认发布】按键 → 用户点 → 进入发布流程（建任务→客户端执行）
  - 每步必须 反馈+确认+留档；封面/标题/话题缺一不可；不可跳过（规格要求全流程确认后才发）
  - 原则：发布前必须给用户看到 切片+标题+话题+封面，不然不发（反“什么都没有就发”）- 🟡 **发布流程重构（待一起修，2026-08-27）**：
  - ①状态机被 `!calledPublish` 跳过（AGENT 调 publish_content 就绕过抽帧/标题/确认）→ 应去掉该条件（发布必走状态机）
  - ②抽帧“时有时无”（依赖 AGENT 行为）→ 状态机无条件抽帧
  - ③视觉用 qwen-vl（百炼）——历史遗留（qwen 时代）；**V4（deepseek-v4-flash）多模态自己能看→视觉应改 V4 自己看**
  - ④封面/标题/话题缺失（建任务时 coverUrl/topics 空）→ 发布前必须三要素（封面+标题+话题）基于画面生成
  - ⑤展示审核环节缺失（应给用户看 切片+封面+标题+话题→确认→才发）- 🟡 **AI 文案内容生成误差**（无人机穿越视频被写成军训/燕麦）：抽帧+封面推荐正常，但文案环节 ①qwen-vl-max visualDesc 可能未注入（catch 吞失败）②或 visualDesc 正确但被“结合今日热榜”指令覆盖硬套（最可能——燕麦/军训=热榜拼接）。跨天已重置会话（非昨天记忆干扰）。待发布步统一修：visualDesc 强制注入 prompt（只能基于画面描述，禁止编造画面没有的题材）+ 热榜拼接弱化。用户暂不修改（2026-08-26）
- 🟡 **点平台卡偶发多窗口**（历史实例/profile 锁累积；v1.0.62 已含 __bindInProgress 防抖+getTargetPage 复用+同平台合并仍偶发）——**不影响发布功能**（发布复用已登录 tab 操作）；用户决定暂缓修复（2026-08-25）

| 2026-09-10 | 🟡 设计缺陷 | **同账号多台机器抢任务（跨机器执行）**——`/api/agent/browser-tasks` 只按 `userId` 过滤（无机器维度）→ 同账号登录的每台客户端都轮询同一队列，**谁先轮到谁执行**。用户实测：在另一台（外网）点发布，任务被开发机客户端抢先执行（打开开发机浏览器发布）。**正解**：任务绑定机器 ID（客户端上报 machineId，任务只投给建它的机器） | electron/main.js、src/app/api/agent/browser-tasks/route.ts |
| 2026-09-10 | 🟢 已解决(v1.0.135) | **客户端更新后「未响应」（卡死）**——疑似 `ensureBuEnvOnStartup` 里 `getBuEnvInfo()` 用 **spawnSync（同步）** 调 python 3 次（每次超时 25s）→ **阻塞 Electron 主进程**（最长 ~75s 界面无响应）。修法：改异步 spawn / 或用已缓存结果（不阻塞 UI）。另一台机器用户先自查 C 盘残留 | electron/bu-env.js |
| 2026-09-10 | 🟢 已解决(v1.0.135) | **自检首次误报（重开即正常）**——用户点开自检看到 1 项 ❌，没做任何操作关闭再开 → 全 ✅。疑似**时序**：启动 8s 后台自检/环境上报未完成时，`selfcheck` 的「发布运行环境」读到未上报状态 → 显示 ❌。修法：客户端未上报时不判 fail（显示「检测中」） | src/app/api/agent/selfcheck/route.ts、agent/page.tsx |
| 2026-09-10 | 🟡 待确认 | **开机自检未自动弹出**——AGENT 页自检弹窗只在**首次**弹（`localStorage.agent_selfcheck_done` 标记），之后静默。用户期望「开机自检」每次可见？需确认是「每次启动都弹」还是「仅首次」 | src/app/agent/page.tsx（L774-777）|
| 2026-09-10 | 🟢 已解决 | **AGENT 发布慢/不稳**（browser_use 每步喂整页 DOM + 超长 MANUAL，qwen3.8-max 每步 75s）→ 改确定性 Playwright 脚本（抖音/小红书已实测通）；browser_use 退为无脚本平台兜底 |

## 🟢 已解决（2026-09-13）

- **微博入口**（此前我误判为"入口错"）：真相是入口本来对，但 ① 点「视频」必须点【图标中心 (734,208)】不是文字(734,220) ② 不能直接 goto /upload/channel（要首页点视频让微博自己跳）③ 上传用真按钮 `button[id^=video_button_upload]` ④ 禁止 file input 兜底（accept=image/* 是图片框，塞视频=假成功）。实测 2 轮均 3 秒到编辑页 ✅
- **微博上传太快**：加 wait_video_ready(240s，看 video.videoWidth>0 且无「上传中」) + wait_cover_ready(60s，看预览图) ✅
- **视频号封面**：视频号有【两个封面位】——「个人主页卡片 3:4 竖」+「分享卡片 4:3 横」；原来只传一张 → 只进分享卡片、竖位空着 → 改为两个位都传 ✅
- **标题长度**：状态机标题是模板拼的（kw 最长 14 字 + 后缀）→ 忽长忽短、只写 20 字；已改为拼满 16 字 + 前缀「【文案1】」→「1. 」（省 5 字）+ 视觉提示严格 16 字 + 6 平台脚本统一截 16 ✅
- **快手封面**：PK 开关已开则不点（避免被关掉）✅
- **6 脚本 connect_cdp 自我递归** BUG（快手/B站永远连不上浏览器）✅

## 🟢 已解决（2026-09-13 登录态专项）

- **重装丢登录态**：卸载器 `customRemoveFiles` 的手动卸载分支原来是 `RMDir /r "$INSTDIR"`（连 data/python/storage 全删）→ 改为只删程序文件、保留三目录。**用户决策 B：data 继续放安装目录内，只改卸载器保住它**
- **打开浏览器 → 平台 ✓ 标记 1 秒后全消失**：根因 = `bu_check.py` 用 `shutil.copy2` 读 `browser-profile/Default/Network/Cookies`，而打开浏览器时 Chrome **独占锁定**该文件 → `WinError 32` → 打印 `CHECK_ERR`（不返回任何数据）→ 前端 `setBuAccounts([])` 清空。
  修法三层：① bu_check 复制重试 4 次×1.5s ② 读成功写 `bu_login_cache.txt`、读失败回退该缓存 ③ 前端拿到空结果时保留上次显示。
  **实测**：Chrome 运行且文件锁定下仍输出 `PLATS:douyin:1,...,kuaishou:1` + `CACHED:1` ✅
- **参考**：OpenCLIApp 的做法（AppData\Local\BrowserBridge，自带 EBWebView + 常驻服务 tcp://127.0.0.1:19826 + account-archive.sqlite3 落库）——它"不登录也能拿到登录态"的本质是【用自己的浏览器 + 结果落库】，我们学的是"缓存/不因一次失败清空"。

## ✅ 已修（2026-09-14 热点采集上报 401）

- **现象**：客户端热点采集【全部成功】（微博20/B站20/抖音49/快手49，日志已证），
  但上报服务器失败：`上报失败: HTTP Error 401: Unauthorized` → 数据进不了服务器 → 热点大屏看不到新增
- **根因（代码定位）**：`scripts/browser-use/bu_hot.py` 上报请求头写法错——
  ```python
  headers={'Cookie': a.cookie, 'Authorization': 'Bearer ' + (a.cookie or '')}
  ```
  `a.cookie` 是完整 Cookie 字符串（形如 `token=eyJxxx; other=yyy`），
  拼成 `Authorization: Bearer token=eyJxxx; other=yyy` → 服务端解析不出有效 token → 401
- **修法（1~2 行）**：二选一——
  ① 只发 `Cookie` 头（middleware 会从 cookie 取 token）→ 删掉 Authorization 那行
  ② 或 `Authorization: Bearer <纯 token 值>`（不能带 `token=` 前缀、不能夹其它 cookie）
- **影响**：热点功能"看得见采集、看不见结果"；服务端 `data/hotspot-report.json` 始终为空
- **状态**：✅ 已修（`80a33f0`）——改为只发 Cookie 头。待装 1.0.159 验证

## 🔴 待观察（2026-09-14 客户机环境）

- **根因**：客户机常【没有真 Python】（只有 Windows 应用商店存根）+ 内置环境没装成功
- **已修**：`1be752e`（环境自检不再静默）+ `a90bdeb`（假 Python 真探测 + 安装每步记日志）
- **待验证**：装 1.0.159 后，客户机上应能看到 `[bu-python]` / `[bu-env]` 完整日志，
  若仍失败，日志会直接给出原因（HTTP 状态 / 解压退出码 / 哪个候选不是真 python）
- **仍缺**：环境不可用时【用户可见提示 + 一键安装】（前端自检项目前只上报，未做交互按钮）

## 🟡 待讨论（2026-09-14 同机换账号）

- 已按用户要求实现【绝对隔离】（`1e996bb`）
- 遗留：`D:\aimarketing-data`、`D:\...\Programs\aimarketing-data` 等旧残留目录
  （不影响运行；Administrator 机器上的一份 browser-profile 含登录态，另一份没有）


## ✅ 已修（2026-09-14 「点平台没反应」）

- **真因**：`chat/route.ts` L1885/L1888 用 `PLATFORM_NAMES` 但漏 import → 运行时 ReferenceError → API 500 → 前端无任何显示（2026-09-13 收拢平台名单时引入）
- **修复**：`513d831`（补 import + 点平台一律建任务 + 素材兜底 + 不再静默）
- **状态**：⏳ **代码已推送，等部署服务器生效**（客户端无需重新打包）
- **验证方法**：部署后点一次微博 → 日志应出现 `任务#N 走确定性脚本 bu_pub_weibo.py`

## 🔴 待处理（2026-09-14 小红书脚本 —— 用户要求等他本地实测）

- **现象**：`PK 开关状态=True` → `封面＋号数=0` → `⚠️ 无封面＋号（PK 未开或列表未渲染）` → 最后
  `{"success": false, "result": "Page.wait_for_timeout: Target page, context or browser has been closed"}`
- **另有**：用户反馈"一直显示禁止笔记"（疑似**输入格式/标题正文标签格式**问题）
- **处理方式（用户定）**：**先不写脚本**，用户在本地**手动逐步实测跑通**，拿到确定的选择器/格式后再改
- **相关**：`scripts/agent-publish/bu_pub_xhs.py`、`scripts/agent-publish/_cdp_click.py`、参考 `electron/fp-templates/*.js`


## ✅ 已修（2026-09-14 账号隔离竞态：「更新后所有登录态没有了、点一次才恢复」）

- **现象**：客户端更新后首次打开，登记簿**所有平台**显示未登录；点一次（刷新检测）恢复正常
- **根因**：`userId` 在页面加载**之后**才异步解析，而前端一挂载就调 `bu:check` → 读到 `browser-profile\default`（不存在）
- **修复**：`86457bc` —— A：`ensureUserResolved()` 幂等门 + `loadURL` **之前**解析 + 6 个消费方 await；C：前端首次全未登录自动重查一次
- **状态**：代码完成，**1.0.161 已打包** → 待用户安装验证
- **验证点**：重启后日志出现 `[iso] 启动前预解析完成 userId=N`；首次打开登记簿即显示正确登录态

## ⚠️ 注意（部署与服务端）

- `chat/route.ts` 的「点平台没反应」修复（`513d831`：补 `PLATFORM_NAMES` import + 点平台一律建任务）**尚未部署服务器**
- 客户端修复已到 **1.0.161**；v1.0.159 含 getter bug，**不要发**


## ✅ 已修（2026-09-14 视频号"网页打开但不上传/不执行脚本"）

- **现象**：点视频号发布 → 网页正常打开，但脚本完全不动（用户以为"上传失败"）
- **根因**：`bu_pub_shipinhao.py` 末尾**漏了 `main()` 调用** → python 只做"定义"即退出（exit 0、零输出、不执行任何步骤）
- **判定特征（下次遇到类似"秒退"直接套用）**：日志里"走确定性脚本"与"脚本执行失败 code=0"**同一秒**、且**没有任何 `[PUB]` 输出**
- **修复**：`6f59379` —— 补 `if __name__ == '__main__': main()`
- **状态**：✅ 已修 + **v1.0.162 已打包**，待安装验证
- **微博对照**：同一次实测**微博全流程 9 步 + 发布成功** ✅（微博脚本有 `main()` 调用）

## 🟡 待讨论（2026-09-14 客户端内嵌浏览器 —— 用户提出，仅记录未实施）

- 现状"打开浏览器"是外部弹窗；用户希望像 IDE 那样内嵌到客户端内
- **障碍**：内嵌视图 session 落不到真 Chrome 的 `browser-profile`（登录态读不到）+ 需重写 6 个脚本的 CDP 驱动层 + Chromium 版本差异
- **低成本折中**：① Chrome `--app=` 无地址栏 + 窗口贴靠 ② 客户端内 CDP 截图"实时预览"
- **结论**：属架构选择，等 6 平台发布稳定后单独评估（详见 EXECUTION_LOG.md 同轮记录）


## ✅ 已实现（2026-09-14 窗口可见性 —— 内嵌讨论的低成本折中）

- **需求**：打开浏览器时能"看得见"（原来停在客户端背后），且后期大量**采集类任务**也要用
- **已实现**：`6b6d598` —— 打开浏览器时**客户端自动缩到左侧**、浏览器放右侧；任务结束 15s 后恢复
- **仍未做（真正内嵌）**：webview/BrowserContentsView 内嵌 → 属架构选择（读不到真 Chrome profile + 要重写脚本驱动层），等发布稳定后单独评估
- **局限**：浏览器已开着（复用）时改不了它的窗口位置（Chrome 单例）


## 🟡 风控（2026-09-14 小红书账号被限制发布）

- **现象**：小红书账号**仅"限制发布"**，其它功能正常（用户实测确认）
- **已做（P0）**：`ec30ded` 小红书脚本拟人化（标题逐字输入、打字间隔随机、鼠标轨迹点击、发布前拟人浏览）——**只改小红书**
- **根本局限**：拟人化只降低概率，**不能保证不被封**；账号现有"限制发布"不会因脚本改动解除
- **未做方向**：① P1 端口随机化/一号一 IP ② P2 **官方开放平台 API**（小红书专业号/抖音/微博/B站，合规零风控）③ P3 **半自动：脚本准备好 + 人工点发布**
- **参考**：EXECUTION_LOG.md 同轮记录（含"机器特征"清单与风控因素分析）


## ✅ 已定位（2026-09-14 "客户端收不到任务/浏览器不打开" = 多客户端同账号抢任务）

- **现象**：前端显示"已创建任务#N"，但某台客户端日志只有 `任务数=0`（无任何 `任务#` 行）
- **真因**：**两台客户端同一账号** → 服务端 pending 队列按 userId 共享、**无客户端归属** → 谁先轮询谁拿走
  → 另一台抢走并执行（那台**缺 Python** → 失败）→ 本台查 pending 恒为 0
- **判定**：`sqlite3 prisma/dev.db "SELECT seq,status,updatedAt,substr(error,1,180) FROM AgentBrowserTask ORDER BY id DESC LIMIT 6;"`
  看到 `status=failed` + `error='缺 Python 运行环境：'` 即确认
- **不需修**（用户确认属使用约定问题）；根治可选：任务绑定 clientId / 客户端单实例锁（详见 EXECUTION_LOG 同轮）
- **配套**：那台机器装 v1.0.164 后环境会自装；视频号脚本入口缺失已修（`6f59379`）


## ✅ 已修（2026-09-15 启动自检 + 登录态自愈 + 内置环境根因）

- **启动自检**（`9b6cd24` / v1.0.167）：新增本地 `splash.html` 自检页，6 项真检（版本/运行环境/脚本插件/目录可写/账号/平台登录态），
  失败显示具体错误、允许"仍要继续"，全部完成点「确认进入」才进主界面
- **登录态反复消失**（`3b75072` / v1.0.166）：根因是迁移逻辑"一次性 + 静默失败 + 不校验就写标记"；已改为幂等 `ensureAccountProfile`
- **内置环境**（`b17c59d` / v1.0.165）：① venv 不可移植 → 换官方 embeddable 重打；② 目录创建顺序错误 → 先建目录再写标记

## 🔴 待做（2026-09-15 已讨论定方向，未开工）

1. **客户端采集（微博/B站/抖音/小红书/快手）**：用户定稿——"登记了就一个一个采集"，已登录的逐个采（进度按平台推进：
   抖音完成→小红书完成→…），未登录的提示"打开客户端登录，下次启动自动采集"。
   **前置**：B 类（抖音/小红书/快手页内取数）目前是"暂未实现"，是主要工作量；还要处理"与发布抢 9222"。
2. **「为你推荐」里的"把文案变成视频（一键成片）"**：用户认为已过时（方向是 AI 推荐文生视频）→ 待改（服务端 `/api/agent/suggestions`）
3. **热点"前天的"**：服务器侧（头条/百度/HN/Reddit）实测为**实时**；`data/hotspot-report.json` **不存在**（客户端上报从未成功）→
   待用户指出"在哪里看到旧数据"以定位


## ✅ 已完成（2026-09-15 启动自检四步改造）

- **独立窗口**（`4832171`）：点客户端先弹"启动自检"独立窗口 → 全部完成点「确认进入」才开主界面
- **每项进度条**（`1c64f1d`）：脚本逐文件/采集逐平台/环境分步；未知百分比走流动动效
- **真检测**（`be9f6fc`）：脚本与上次比对变化 · 环境真执行 playwright start/stop · 发布前置预检（Chrome/网络/9222/Cookies）
- **统一更新入口**（`8adc0b9`）：更新进度并入自检窗（第1段下载%、第2段安装提示"窗口会自动重开"）

## 🔴 待修（2026-09-15）

1. **内置环境 driver 缺失**（我删错）：`python-bu.zip` 少了 `playwright/driver` → `sync_playwright().start()` 失败 → 发布脚本全废。
   **OSS 上现在就是坏版本**（72637453 字节）。→ 重打（含 driver，~170MB）+ 重新上传 OSS。
   ★ 结论：内置环境【必须含 playwright/driver】
2. **点快捷方式先出白色客户端**：`mainWindow` 现在是 `{show:false}` + `about:blank`（白页）；
   而单实例逻辑 `app.on('second-instance')` 会 `mainWindow.show()` → 显示白页。
   → 改：自检窗在场时只前置自检窗；已进主界面才显示主窗口
3. **小红书 B 类采集未实现**（edith 域跨域 → 需走 www 域）；视频号未纳入
4. **服务器未部署**（点平台修复 `513d831`）


## ✅ 已解决（2026-09-15 顺序/编号修复，v1.0.183~185）
- **账号没选、登录态没验就采热点** → mainWindow 占位页的 did-finish-load 触发定时任务抢跑；已改为交给自检页按序执行（进主界面后仅"今日未采"兜底补采）
- **检查更新失败 / 一直转圈** → 更新器初始化晚于自检窗 + 两处并发 checkForUpdates；已提前初始化 + checkUpdateOnce 闸门 + 15s 超时
- **自检项无序号** → 已加 1.2.3.… 编号，第一项就是检查更新
- **内置环境"python.exe 在、库缺"** → 动态定位 findBuiltinPy()，去掉 Move-Item 迁移
- **报错被截断看不到病因** → 改为显示真正的错误行 + 后台 pip 补装
- **白屏/黑屏** → 主窗口补深色底色 + 自检窗 ready-to-show + second-instance 占位页走 enterMainApp + 关自检窗自动进入

## 🔴 仍待办
1. **上传 OSS**（本地 OSS key 只读，403）：dist-rel/python-bu.zip（85.8MB 正确结构）+ AI-Marketing-Setup-1.0.18x.exe + .blockmap + latest.yml（最后传）
2. 小红书 B 类采集（edith→www 域）；视频号未纳入 B 类
3. 服务器部署（点平台修复 513d831）
4. 首启"更新 → 安装 → 重启 → 继续自检"完整链路待真机验证（需 OSS 上有新版）


## ✅ 已解决（2026-09-16 画像清理 + 按主题搜热点）
- **画像数据乱**（平台冒充行业、重复、标签错配）→ 清噪音（服务器已执行，有备份）+ 修三个写入口 bug + 加幂等
- **User.industry 全表为 null** → 登记与自动提取都会同步写它了
- **"AI" 这类英文主题记不下来** → 改为用户显式填写（设置页「我关心的主题」），不再依赖自动提取
- **热点只有总榜** → 新增"按主题搜索"（HN 先行）；无主题账号不受影响
- **Reddit 源一直超时** → 已摘掉（服务器网络不可达）

## 🟡 待验证
- 部署后：admin 热点大屏应出现按主题的源（`HN·AI` / `HN·大模型` …）
- 画像面板分组显示是否正常

## 🔴 仍待办
1. **iOS/OSS 上传**：dist-rel/python-bu.zip（正确结构）+ exe/.blockmap/latest.yml 三者同步（本地 OSS key 只读 403）
2. 中文字段源（头条/百度）搜索接口解析试探
3. 发布接画像（常用平台默认勾选）
4. 小红书 B 类采集；服务器部署（点平台修复 513d831）
