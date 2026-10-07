#!/usr/bin/env bash
# 本地成片 · 一键自检（2026-09-20）
#
# 用法（服务器上）：
#   cd /root/AiMarketing && bash scripts/video-factory/selfcheck.sh
#
# 它检查 4 件事：
#   ① 三个 Python 脚本语法（tts/make/render）—— 语法错会让成片整条挂掉
#   ② 渲染自检：造 9 种卡型的测试片（title/bgimage/aivideo/list/number/compare/chart/quote/end）
#      —— 同时验证 黑遮罩/大字描边/主色底板/逐字浮现/未知卡型降级
#   ③ 配音四引擎各合成一句（dashscope / minimax / silicon / volcano）
#   ④ 关键改动是否在位（grep 标记）—— 防止"改了没生效/被回退"
#
# 退出码：0 = 全过；1 = 有失败项（具体看输出里的 FAIL）

set -u
cd "$(dirname "$0")/../.." || exit 1
ROOT="$(pwd)"
TMP="${TMPDIR:-/tmp}/vf-selfcheck"
mkdir -p "$TMP" 2>/dev/null

FAIL=0
line() { printf '\n===== %s =====\n' "$1"; }

line "① Python 语法（tts / make / render）"
for f in tts make render; do
  if python3 -c "import ast;ast.parse(open('scripts/video-factory/$f.py',encoding='utf-8').read())" 2>/dev/null; then
    echo "OK   $f.py"
  else
    echo "FAIL $f.py  ← 语法错误，成片会直接失败"
    FAIL=1
  fi
done

line "② 渲染自检（9 种卡型，逐镜打 OK）"
python3 scripts/video-factory/render.py --selftest --workdir "$TMP/render" --out "$TMP/render/selftest.mp4" 2>&1 | tail -14
if [ -f "$TMP/render/selftest.mp4" ]; then
  echo "OK   测试片已生成：$TMP/render/selftest.mp4"
else
  echo "FAIL 测试片没生成 ← 渲染链路有问题（看上面输出）"
  FAIL=1
fi

line "③ 配音四引擎（各合成一句）"
for e in dashscope minimax silicon volcano; do
  out="$TMP/tts_$e.mp3"
  rm -f "$out" 2>/dev/null
  res=$(VF_TTS_ORDER="$e" python3 scripts/video-factory/tts.py --text "自检用一句话" \
        --speaker longxiaochun --out "$out" 2>&1 | tail -1)
  if [ -f "$out" ]; then echo "OK   $e  →  $res"; else echo "WARN $e  →  $res（该引擎不可用，但默认链里有兜底）"; fi
done

line "④ 关键改动是否在位"
# 用法：ck <要搜的标记> <文件> <期望最少出现次数>
ck() {
  # 注意：grep -c 在"无匹配"时会输出 0 但退出码为 1 —— 不能用 `|| echo 0`（会得到两行），
  # 必须先 || true 再兜底赋值，否则下面的 [ "$n" -ge N ] 会因多值报错。
  n=$(grep -c -- "$1" "$2" 2>/dev/null) || true
  n=${n:-0}
  if [ "$n" -ge "${3:-1}" ]; then echo "OK   $1  ($2 ×$n)"; else echo "FAIL $1 不在位 ($2, 找到 $n)"; FAIL=1; fi
}
ck 'VF_COSTFIX_V1'                  'src/app/api/agent/chat/route.ts' 1   # 计费口径（多扣费修复）
ck 'VF_POLLMATCH_V1'                'src/app/agent/page.tsx' 1           # 轮询精确匹配（误报修复）
ck 'VF_MIRRORHONEST_V1'             'src/app/agent/page.tsx' 1           # 同步文案按能力显示
ck 'VF_ELAPSED_V1'                  'src/app/api/agent/make-video-status/route.ts' 1
ck 'VF_UNKNOWNCARD_V1'              'scripts/video-factory/render.py' 1  # 未知卡型降级
ck 'VF_AIVIDEO_V1'                  'scripts/video-factory/render.py' 1  # ★AI 直接成片：aivideo 卡型（时长自适应）
ck 'VF_AIVIDEO_V2'                  'scripts/video-factory/render.py' 1  # ★AI 直接成片：aivideo 补齐压暗+画面大字
ck 'VF_AIVIDEO_V1'                  'scripts/video-factory/make.py' 3    # ★AI 直接成片：H3 调用/通道/生成（≥3 处）
ck 'gen_ai_clips'                   'scripts/video-factory/make.py' 1    # ★AI 直接成片：Python 侧入口
ck 'H3_BASE_URL'                    'scripts/video-factory/make.py' 1    # 与 minimax-h3.ts 同构的通道配置
ck 'VF_AILINE_V1'                   'src/lib/agent/vf/vf-aivideo.ts' 1  # ★AI 制片独立线（文件头标记）
ck 'vf_draft_ai'                    'src/lib/agent/vf/vf-aivideo.ts' 1  # AI 制片自己的草稿 tag（与素材合成不串线）
ck 'VF_MIXLINE_V1'                  'src/lib/agent/vf/vf-mix.ts' 1      # ★素材+AI 创作独立线（第三条）
ck 'vf_draft_mix'                   'src/lib/agent/vf/vf-mix.ts' 1      # 混合线自己的草稿 tag（与另两条都不同）
ck 'shouldTakeOverMixLine'          'src/app/api/agent/chat/route.ts' 1 # ★混合线分派入口（ASCII 锚点）
ck 'shouldTakeOverAiLine'           'src/app/api/agent/chat/route.ts' 1 # ★AI 制片分派入口（用 ASCII 锚点，避免中文/符号匹配问题）
ck 'vfAiHandled'                    'src/app/api/agent/chat/route.ts' 1 # 没接管时恒 false → 素材合成行为不变
ck 'vfMixHandled'                   'src/app/api/agent/chat/route.ts' 1 # 同上（三条线互不连累）
ck 'VF_MIXLINE_V1'                  'scripts/video-factory/make.py' 1   # ★混合线地基：make.py --mix（只对指定镜调 AI）
ck 'VF_SELFTEST_V2'                 'scripts/video-factory/render.py' 1  # 自检覆盖 8 卡型
ck 'VF_MATSPREAD_V1'                'src/lib/agent/video-material.ts' 1  # 素材抽样
ck 'VF_HDONLY_V2'                   'src/app/api/agent/chat/route.ts' 1  # 低清图过滤
ck 'VF_THEMENAME_V1'                'src/app/api/agent/chat/route.ts' 1  # 确认卡显示风格
ck 'VF_SHOTDUR_V1'                  'src/app/api/agent/chat/route.ts' 1  # 分镜清单带时长
ck 'VF_SUMMARY_V1'                  'src/app/api/agent/chat/route.ts' 1  # [概要] 日志
ck 'VF_SHOTCOUNT_V1'                'src/app/api/agent/chat/route.ts' 1  # 扩镜（治"一镜太长"）
ck 'VF_TYPEFIX_V1'                  'src/app/api/agent/chat/route.ts' 1  # 未知卡型归一化
ck 'VF_TAIL_V2'                     'src/app/api/agent/make-video-status/route.ts' 1  # 任务日志留 30 行
ck 'VF_LESSDARK_V1'                 'scripts/video-factory/render.py' 1  # 黑遮罩 0.42→0.15
ck 'dashscope,minimax,silicon'      'scripts/video-factory/tts.py' 1     # 默认配音引擎链
ck 'borderw='                       'scripts/video-factory/render.py' 1  # 画面大字/字幕描边（**值按字号计算** `max(2,int(fs*…))` ⇒ 只断言"存在描边参数"，不许钉字面量 `borderw=2`：钉了会让正确代码永远 FAIL，实测 0/17）
# ★VF_DECKCONFIRM_V1（2026-10-04 用户定案「双轨并存：老的保留，出片时自己选引擎」）：
#   确认卡「🎬 确认出片 · 新引擎」—— 三处接线缺一不可（协议串入口 / 前端按钮+挂载 / 执行体）。
ck 'VF_DECKCONFIRM_V1'              'src/app/api/agent/chat/route.ts' 2  # 协议串：入口判定(vfProtoWord) + 四线分派前接管（≥2 处）
ck 'VF_DECKCONFIRM_V1'              'src/app/agent/page.tsx' 2          # 前端：新按钮组件 + 确认卡挂载（≥2 处）
ck 'VF_DECKCONFIRM_V1'              'src/lib/agent/vf/vf-deck-render.ts' 1  # 执行体：找草稿/计费/后台渲染/入库/扣费
ck 'VF_DECK_CONFIRM'                'src/app/agent/page.tsx' 1          # 按钮发送的机器协议串本体（ASCII 锚点）
# ★VF_ENGINE_UI_V1（2026-10-04 用户定案「成片方式第一轮就选；确认卡只点头」）：
#   设置卡「成片方式」单选（classic 默认 / deck）→ 三条线落草稿 → 确认卡按引擎只显示对应出片按钮。
ck 'VF_ENGINE_UI_V1'               'src/app/agent/page.tsx' 3          # 设置卡单选 + 音色/BGM 置灰 + 确认卡分支（≥3 处）
ck 'VF_ENGINE_UI_V1'               'src/app/api/agent/chat/route.ts' 2 # 素材线落草稿 + vfScriptCard 透 engine（≥2 处）
ck 'VF_ENGINE_UI_V1'               'src/lib/agent/vf/vf-video.ts' 1    # 图视混剪线落草稿
ck 'VF_ENGINE_UI_V1'               'src/lib/agent/vf/vf-mix.ts' 1      # 素材+AI 线落草稿
# ★VF_DECKCOPY_V1（2026-10-04 用户定案「两套文案：口播给配音字幕、要点给 PPT」）：
#   确认时 AI 把口播文案转写为 PPT 要点版（sanitizeDeckMd 严格校验，失败退规则映射）。
ck 'VF_DECKCOPY_V1'                'src/lib/agent/vf/vf-deck-render.ts' 1  # sanitizeDeckMd + deckMd 直通
ck 'VF_DECKCOPY_V1'                'src/app/api/agent/chat/route.ts' 1    # 确认处理器里的 AI 转写
# ★VF_WINFIX_V1（2026-10-05 用户实测「新引擎出片失败 make-video.mjs 退出码 1 · 已跑 0s」）：
#   根因 = deck.schema.json 硬约束 pageBullets.items.minLength=8 / meta.title.minLength=4，
#   而映射层过滤线是 6/4 字 ⇒ 6~7 字要点进节 → 整节凑不齐 3 条落窗被丢 → GEN-TOO-FEW-PAGES。
#   本地实锤复现与修复验证：要点全 ≥8 字后 4 页 0.9MB MP4 正常产出。
ck 'VF_WINFIX_V1'                  'src/lib/agent/vf/vf-deck-render.ts' 5  # BULLET_MIN/COVER_MIN 常量 + 三处过滤线 + sanitize + 失败原因透出（≥5 处）
# ★VF_TTSFIX_V1（2026-10-05 用户实测二连：「配音把 API 读成日语腔（非首次）」+「选任何音色出来都是同一个声音」）：
#   ① prepareTextForTTS 把全大写 ≥3 字母缩写（API/ROI/KOL…）拆成「A P I」逐字母读（AI/OK/iPhone 不动；
#     已实测拆读版合成正常、ASR 识别为中文）② textToSpeech 的 speaker 参数此前被整个忽略（百炼永远默认
#     Cherry、硅基写死 alex）→ 真正传下去 + 硅基音色映射（8 音色逐一实测存在）+ 火山兜底也传。
ck 'VF_TTS_ACRONYM_V1'             'src/lib/ai-providers.ts' 1            # prepareTextForTTS 缩写拆读
ck 'VF_VOICE_PASS_V1'              'src/lib/ai-providers.ts' 4            # siliconVoice 映射 + dashscopeTTS 两处传参 + 硅基回退 alex
ck 'VF_VOICE_PASS_V1'              'src/lib/qwen3-tts.ts' 1               # volcanoTTS 兜底传音色
# ★VF_SUBCHUNK_V1：**已被 VF_SUBATOM_V1 取代（标记不再存在，见下方 SUBATOM 段）**——
#   同日先做了「定宽盲切 + 块点回退防 99|%」，当天晚些又整体改成原子块贪心打包（chunkSub 一处实现，
#   只有一个标记）。旧的 ck 行留着会让 ④ 段永远红（代码里已无该字符串），故删除，历史留在本注释。
# ★VF_SHOTIMG_V1（2026-10-05 用户实测「5 张图只排 1 张 bgimage、还排了 3 个 end 镜」）：
#   分镜提示词加两条硬规矩：⑤素材图至少排一半以上（信息卡只是点缀）⑥end 镜只许 1 个。
ck 'VF_SHOTIMG_V1'                 'src/app/api/agent/chat/route.ts' 1    # ⑤图要多用 + ⑥end 只一个（标记在 vfShotsPrompt 前注释）
# ★VF_NAMESEQ_V1（2026-10-05 用户实测「删了 001 后新片又占 001 → 客户端按文件名判重跳过同步」）：
#   个人仓库存档序号取「当天最大序号+1」，不复用被删掉的空号。
ck 'VF_NAMESEQ_V1'                 'src/lib/personal-storage.ts' 1        # 最大序号+1 命名
# ★VF_DECKRETRY_V1（2026-10-05 用户实测整单失败「可用要点 5 条，文案切句也不足 6 条」）：
#   两套文案的 AI 转写层太脆——一次未过校验/异常就整个掉规则兜底。转写重试 1 次（第二次提示点名
#   格式不合格）+ prompt 放宽（允许轻度润色扩写满足 ≥8 字窗口；数字/事实不动；用户定案「把权力
#   放大给 AI 自主编排」）。兜底切句同轮增强见 VF_SCRIPTCHUNK_V1。
ck 'VF_DECKRETRY_V1'               'src/app/api/agent/chat/route.ts' 2    # 重试循环 + prompt 放宽（两套文案转写段）
# ★VF_SCRIPTCHUNK_V1（同上单）：规则兜底切句增强——<8 字碎句与后句合并、>28 字长句按逗号二切
#   （片段贪心合并进 8~28 窗口），替代「短句直接丢、长句截断加…」。单测：上午实文案出 8 条 ✓。
ck 'VF_SCRIPTCHUNK_V1'             'src/lib/agent/vf/vf-deck-render.ts' 2 # 碎句合并+长句二切 实现+注释
# ★VF_MATDOM_V1（2026-10-05 下午定案「素材图必有、量要大于 PPT；帧是帧、不用每张图背 PPT 页」，
#   取代上午 VF_IMGFRAME_V1 的「填满 12 页窗 + 图帧不背旁白」——实测 005/006 三片 171s 里素材仅
#   3~4 帧，静默帧方案让时长白膨胀）：注帧数 = min(图镜, max(口播句数−PPT页, PPT页+1))——每帧背
#   1 句配音（voice-over：旁白在图帧上继续，总时长 ≈ 音频长度+0.4s×页数不膨胀）；分不到句子的帧
#   2.5s 纯快闪。schema pages.maxItems 12→40（deck.p40-test 40 页实测渲染 exit 0，measured-limits
#   renderedMax 同步 40、check-schema-vs-limits 绿）。单测 6 场景：003单 20帧>PPT8·28页·179s ✓。
ck 'VF_MATDOM_V1'                  'src/lib/agent/vf/vf-deck-render.ts' 1 # 仅剩 TTS 复用注释
#   ⚠️ **本条已被 ★VF_PPTSOLO_V1（2026-10-06）取代**：用户定案「彻底拆开」——
#   素材图是「图片成片/图视混剪」两条线的画面主体（那边时序真源 = 分镜 dur），**不再注入 PPT 线**；
#   实测 001 片正是它导致的（页数被撑到 13~14、旁白只有 11 句 ⇒ 前 7 页吃光旁白、后 7 页静默快闪）。
#   故"注入段 + 句子分配段"两处标记随代码删除 ⇒ 期望值 3 → 1（改数即确认，历史留在此注释）。
# ★VF_PAGEMIX_V1（同日实测「PPT 全是 1.2.3 列表、数据/图标排版没用」）：gen-deck 是确定性解析器，
#   页型由 md 形状决定——sanitizeDeckMd 从「只认 3 条要点」放行 4 种节型（要点/数据/流程/对比），
#   转写 prompt 给节型菜单让 AI 按文案选型混排。端测：混排 md → cover→bullets→data→steps→compare→end ✓。
ck 'VF_PAGEMIX_V1'                 'src/lib/agent/vf/vf-deck-render.ts' 2 # sanitizeDeckMd 实现+注释
ck 'VF_PAGEMIX_V1'                 'src/app/api/agent/chat/route.ts' 2    # 转写 prompt 节型菜单 + 注释
# ★VF_SUBATOM_V1（同日实测字幕三连伤「，点击率8.5%」逗号开头条 /「出」单字条 /「3分|钟」切断数字+
#   单位）：SUBCHUNK 定宽盲切+回退防不住 → 改原子块贪心打包（数字+单位/英文单词不断、标点粘前块、
#   句读过半即收、<2 字碎块并邻）。单测 10 例全过（含三事故原句）。
ck 'VF_SUBATOM_V1'                 'src/lib/agent/vf/vf-deck-render.ts' 2 # chunkSub 实现 + 调用点
# ★VF_DECKRESCUE_V1（2026-10-05 傍晚用户实测 vf1791195178923 整单红「gen-deck 退出码 1：
#   GEN-TOO-FEW-PAGES 只生成 2 页」——真凶 = 上一版 sanitizeDeckMd 把 flatMap 误写成 map，
#   节数组没摊平 ⇒ join('\n') 把每节 toString 成「## 标题,要点,要点」一行 ⇒ gen-deck 只见到
#   1 行假标题 ⇒ 全部节被丢 ⇒ 恰好 cover+end=2 页；且上午的「端测」只喂手写 md 绕过了 sanitize，
#   所以没测出来）。修四刀：① flatMap 修复（emit 结构单测：不得出现 /^## .*,/ 逗号行）；
#   ② sanitize 硬化——弱表格（数据行<4）不再当图表节、非数值表降「- 标签：值」条目、表后保留
#   items（图表落空还能救成要点页）、6~7 字步骤按节型放行（steps 窗口 min=6）、剥 ** 粗体与
#   行首【节型标签】；③ gen-deck 整建制失败时**回退规则映射文案重跑一次**（buildRuleMd 闭包化，
#   AI 文案再怪也死不了单）；④ prompt 数据节禁 markdown 表格。端测四场景过 sanitize 后全绿：
#   std=cover→bullets→data→steps→compare→end · chart/shortstep/bold 各 4 页 ✓。
ck 'VF_DECKRESCUE_V1'               'src/lib/agent/vf/vf-deck-render.ts' 7 # sanitize 头注/flatMap/收集线/fromAi/buildRuleMd/救援重跑/AI分支注释
# ★VF_FONTFIT_V1（2026-10-05 晚用户实测 vf1791197069965「batch-video 退出码 1：BATCH-ITEM-FAILED
#   render=8 未找到产物 mp4」且 30s 单成功、180s 单失败）：render=8 = render-deck 的**字体覆盖闸门**
#   （EXIT.FONT）—— 内嵌字体是子集（chars-cmn.txt=GB2312 一级 3755+ASCII+标点=3926 码点），deck 里
#   出现一个表外字（二级字表 婷/鑫/喆、emoji、特殊符号）整单红；文案越长撞表概率越大，故短单过、长单炸。
#   修法 = copy.md 三个出口全部先过 fitFont（表外字符删除+fontRemoved 收集）：① sanitizeDeckMd 行预处理、
#   ② buildRuleMd（bulletOf/切句/封面）、③ 图片页注入（pageImage.title/caption）。删字打日志+落任务文件
#   （fontSanitized），不静默吞字；转写 prompt 补「禁 emoji/生僻字」。闸门本身不动（服务器无 CJK 系统字体，
#   缺字真会豆腐块）。端测对照：脏文案（含😀/婷/鑫/喆/燚）→ gen-deck → render-deck = exit 8 复现；
#   同文案净化后 = ok=true 6 页 19.8s 渲染成功、reconcile 全 0；纯表内文案净化零动作（不误伤）。
#   ⚠️ 后续优化（未做）：字表扩到 GB2312 全量 6763 字（重跑 make-fonts.py 生成 woff2），高频二级字就不删了。
ck 'VF_FONTFIT_V1'                  'src/lib/agent/vf/vf-deck-render.ts' 6 # 注释块/sanitize行/bulletOf/封面/日志⓪/救援日志
#   ⚠️ 原写 8：★VF_PPTSOLO_V1（2026-10-06 拆线）删掉了**素材帧注入**（含"图片页 title/caption 净化"
#   与其字体净化日志 2 处）⇒ 实测 6。改数即确认：PPT 线不再插素材图，图片标题净化随之不再需要。
# ★VF_CHARTKIND_V1（2026-10-05 晚用户实测 008 片「PPT 从来没有曲线图、图表等」）：两个成因——
#   ① 转写 prompt 里写着「**不要写成 markdown 表格**（竖线表格会被引擎丢掉）」（修 GEN-TOO-FEW-PAGES 时加的）
#      ⇒ AI 永不写表格 ⇒ gen-deck 的 chart 入口（唯一入口就是 ≥4 行数据的 markdown 表格）被彻底堵死；
#   ② gen-deck 的 chart 分支 `chart.type` **写死 'bar'** ⇒ 即使有表也只有柱状（line/donut 只在引擎自测里出现）。
#   修复：① route.ts 的 PPT 文案 prompt 放开表格并给三种图表节（柱/折线/占比环）写法：表头第 2 列写单位、
#      数据行 ≥4 纯数字、说明行 8~39 字；② gen-deck 按节标题选图型（占比/构成/结构/比例/份额/分布→donut、
#      趋势/走势/增长/变化/曲线→line、其余→bar），并把 labels/series 改成**成对过滤**（旧写法串位）。
#   端测：三图型联测 md ⇒ 页型 cover→chart(line)→chart(donut)→chart(bar)→end · validate 0/0 ·
#      真渲染 reconcile 全 0（16:9 master-v1 与 9:16 master-v2 各一次）；sanitize→gen-deck 全链（表格保留、
#      说明行当 explain）⇒ cover→bullets→chart(line)→chart(donut)→end · 字体闸门 PASS。
ck 'VF_CHARTKIND_V1'                'scripts/video-factory/html-deck/gen-deck.mjs' 1 # chart 分支：按标题选 line/donut/bar
ck 'VF_CHARTKIND_V1'                'src/app/api/agent/chat/route.ts' 2 # 注释 + 7 节型菜单注释（prompt 放开表格）
# ★VF_ENDFIX_V1（同批 · 008 片尾页两处硬伤）：① CTA 取的是**原文行**（含 `- ` 项目符号）⇒ 成片显示
#   「- 点击生成，自动生成整体计划」——改为过 stripItem；② 写死的 `ONE SCRIPT · MANY SKINS` 与兜底
#   `下一步：挑一套皮肤，出第一条片` 是**引擎内部术语**（皮肤 = skin id）⇒ 换中性文案并开放 `--cta` / `--en`。
#   端测：含「- 点击生成，自动生成整体计划」的 md ⇒ end.cta = 「点击生成，自动生成整体计划」· en 不再是内部术语。
ck 'VF_ENDFIX_V1'                   'scripts/video-factory/html-deck/gen-deck.mjs' 2 # 尾页注释 + 旗标注释
# ★VF_CHARTDATA_V1（2026-10-06 用户实测 001 片「图表页出来了，但一根柱子都没有、y 轴全是 0」）：
#   三个坑：① 数值**写死取第 2 列**，而 AI 按示例表头写成三列 `| 社媒声量 | % | 42 |`（数值在第 3 列）
#      ⇒ 第 2 列只剩 `%` ⇒ 去非数字字符后是空串 ⇒ `Number('') === 0` ⇒ 5 行全成"有效数值 0" ⇒ 空图（还过了 validate）；
#   ② 表头第 2 列被 AI 照抄成占位词「单位」⇒ 图上单位印成"单位"两个字；③ 全 0 也能出图（没人拦）。
#   修法：数值**逐行取第一个能解析成数字的单元格**（跳过标签列，空串判 NaN 不判 0）；**全 0 不出图表页**（降级要点页）；
#   占位词表头 ⇒ 从表体里找"非数字、≤8 字、出现 ≥2 次"的真单位（如 `| 渠道 | % | 42 |` 的 `%`，不编造）。
#   端测：001 同形态（表头「项目|单位」+ 数值第 3 列）⇒ `chart(bar) series=42,78.5,15,8.5 unit=[%]` ✓；
#   全 0 空表 ⇒ **不出图表页**、降级为条目 ✓；三图表联测 & render reconcile 全 0 ✓。
ck 'VF_CHARTDATA_V1'                'scripts/video-factory/html-deck/gen-deck.mjs' 2 # chart 分支注释 + 单位兜底注释
ck 'VF_CHARTDATA_V1'                'src/lib/agent/vf/vf-deck-render.ts' 1 # sanitize 同口径 numOf（空串判 NaN、全 0 不算可画）
# ★VF_NARRCHUNK_V1（2026-10-06 拆线时上移）：口播**切块**与字幕切块**共用同一套原子块规则**（chunkSub 提到模块级）——
#   用户指示「前面调试字幕配音等如果有成熟技术可以用」。口播句 40~70 字（TTS 10~15s）会让"一页一句"、
#   页时长只能跟着句子走 ⇒ 先按原子块切成 ≤16 字（竖屏）/≤24 字（横屏）的配音单元，页分配才有细粒度。
ck 'VF_NARRCHUNK_V1'                'src/lib/agent/vf/vf-deck-render.ts' 2 # chunkSub 模块级注释 + ④ 切块注释
# ★VF_PACEFIX_V1（2026-10-06 用户实测 001 片「前面一张图 15~21 秒，后面一页一秒都没有，像插帧」）：
#   老分配「累计时长 ≥ 均值才翻页」有三个毛病：封面把开头几段旁白全吃掉（001 封面背 3 段 = 15.5s）；
#   句子比目标还长时一页只能放一句；后面的页一句都分不到 ⇒ 落回默认时长（2.5s/3.4s）= 静默快闪。
#   新规则：① 封面/尾页**各最多背 1 个单元**；② 其余按累计时长均分到**中间内容页**；
#   ③ 确实分不到单元的页 ⇒ 时长 = **平均页时长**（不再 2.5/3.4s 闪页）并在 tail 里点名（不静默）。
ck 'VF_PACEFIX_V1'                  'src/lib/agent/vf/vf-deck-render.ts' 1 # ⑤ 页分配块头注
# ★VF_LABELGUARD_V1（2026-10-06 用户实测 001 片：AI 把**提示词里的节型标签**当标题抄）：
#   实测标题出现「图表节·柱状」「要点节（本节要点）」「对比节（本节要点）」，直接印在成片上。
#   硬拦：标题里的标签词一律去掉；去完不足 4 字 ⇒ **从本节内容里**派生（第一条目/第一段行，不编造）；
#   封面标题同规则（去完不足 4 字回退原题，避免过度清洗丢好标题）。prompt 里也补了「禁止出现这些字样」。
ck 'VF_LABELGUARD_V1'               'src/lib/agent/vf/vf-deck-render.ts' 3 # 规则块 + 封面用法 + okSec 用法
# ★VF_PPTSOLO_V1（2026-10-06 用户定案「彻底拆开」）：「PPT 成片」= 独立一条线（第 6 条状态机线）。
#   用户原话：「如果 2 者相互矛盾，你给我彻底拆开，做个 PPT 成片 / HTML 逐帧成片，原设计图视混剪和
#   图片成片单独保留。不要混在一起。要不这个好了那个又坏了，我们调试起来很麻烦。」
#   · 时序真源：老四条线 = **分镜 dur**；本线 = **配音**（页 = PPT 版式页）⇒ 不取素材、不排分镜、不插素材图；
#   · 入口命令 `PPT成片`（别名 动态PPT/动态PPT成片）；提交 `VF_PPT_FORM:{…}`；出片仍走既有 `VF_DECK_CONFIRM:`
#     → runDeckVideoTask（草稿靠 `deckOnly` 标记被认领：没有分镜也能出片）；
#   · 封路：图片成片/图视混剪的 VF_FORM 收到 engine='deck' **一律拒绝并提示**（改走老引擎），前端也删掉了那个选项。
#   ⚠️ 必须登记在 standard-commands.ts（标准模式是命令白名单锁死，漏登记 = 被 STD_UNSUPPORTED_REPLY 拦死；
#      本项目已因此踩过两次坑：视频混剪线、图生视频）。
ck 'VF_PPTSOLO_V1'                  'src/lib/agent/vf/vf-ppt.ts' 1
ck 'VF_PPTSOLO_V1'                  'src/lib/agent/vf/vf-deck-render.ts' 4 # DRAFT_TAGS + findDeckConfirmDraft + 出片端 shots 判定 + 拆线注释
ck 'VF_PPTSOLO_V1'                  'src/app/api/agent/chat/route.ts' 4 # 分派块 + 素材线让位 + engine 封路 + stdClearAllDrafts
ck 'VF_PPTSOLO_V1'                  'src/lib/agent/standard-commands.ts' 1
ck 'VF_PPT_UI_V1'                   'src/app/agent/page.tsx' 2 # VfPptCard 组件 + dispatch 分支
ck 'VF_PPT_SPLIT_V1'                'src/app/agent/page.tsx' 4 # 成片方式块 + engine state 删除 + payload 写死 classic + FEATURE_TIPS
# ★VF_DECKROUTE_V1（首版 镜>12/预计>90s 就提示走老引擎；VF_MATDOM_V1 破窗 40 页后放宽到真超容量）：
#   新引擎且预计 >300s（40 页 × ~6s ≈ 5 分钟）→ 确认卡明示建议拆条或换老引擎（只提示不拦）。
ck 'VF_DECKROUTE_V1'               'src/app/api/agent/chat/route.ts' 2   # 提示拼接 + 注释
# ★VF_AVIMG_V1（2026-10-05 用户定案「加图片页 + 字幕去重 + 配音/BGM 回归新引擎」）：
#   新引擎正式出片不再走 make-video 一把梭，改为分步编排（gen-deck → 注入 pageImage 图片页/
#   按配音定页时长 → 逐句TTS(百炼→硅基→火山) → 自产SRT(字幕=口播,与页面大字不再同文) →
#   batch-video 渲染+烧字幕 → ffmpeg 混音(配音±BGM)）。老引擎一行没改。
#   本地端到端实测：注入图片页(cover,bullets,image,bullets,end)25.4s 成片 + aac 立体声混音 ✓
ck 'VF_AVIMG_V1'                  'src/lib/agent/vf/vf-deck-render.ts' 5  # 文件头口径/runCmd/prisma句柄(音乐库)/引擎分派直编排/分步管线注释
#   ⚠️ 原写 8（"管线分步注释+图片页注入+TTS+SRT+混音 ≥8 处"）——**实际只有 5 处**（HEAD 版本同样是 5），
#   4 段自检因此长期红。2026-10-05 逐处核对：这 5 处已覆盖该特性的关键落点（其余步骤复用同一条 runCmd/
#   分步管线注释），故把期望值改成实数（改数即确认），**不再虚报 8**。
ck 'VF_AVIMG_V1'                  'src/app/agent/page.tsx' 3            # 解除音色/BGM置灰 + 文案更新
#   ⚠️ 原写 4：★VF_PPT_SPLIT_V1（2026-10-06 拆线）把素材卡上的「成片方式（含动态 PPT）」整块删了，
#   那块注释里带 1 处 VF_AVIMG_V1 ⇒ 实测 3。改数即确认（拆线是有意为之：deck 已独占给「PPT成片」线）。

# ★VF_ONELAYER_V1（2026-10-06 用户定案「目的只有一套 PPT 选择…确定重复内容冗余 删除」，先做图片成片/图视混剪）：
#   病根：图片成片卡上并列三层视觉选项 —— ①「🎨 画面风格」5 套（style）②「高级：主题」10 个（theme）
#   ③「高级：PPT 版式」7 项（deck_style）；而 themes.py 的 STYLES **内部就是 theme+deck 的打包**
#   （bluewhite=news+deck / darkgrad=data+deck-grad / cleanlight=light+deck-soft / magazine=journal+deck-mag
#   / softlux=mono+deck-glass，见 themes.py:194-234）⇒ 同一件事的三个旋钮，原本靠"选了风格就把后两层置灰"
#   （VF_STYLELOCK_ADV_V1）回避冲突，用户当然觉得乱（原话「我感觉很乱。其实都是一个东西」）。
#   修法（本轮只动图片成片/图视混剪共用的 VideoFormCard，**PPT 成片线零改动**）：删掉「高级：主题」+「高级：PPT 版式」
#   两段 + 置灰逻辑 styleOn + 折叠按钮 openStyleAdv + 「成片方式」死段落 ⇒ 只剩「🎨 画面风格」一层 + 5 张样张。
#   theme / deckStyle 改为普通常量但**仍照原值提交**（默认 vj / 'dark' / 'auto'）⇒ 服务端契约与「跟随 AI」零回归。
#   能力去向：news/data/light/journal/mono 这 5 个主题**就是**5 套风格内部用的那 5 个（未丢）；另 5 个裸主题
#   （dark/blue/tech/mint/vivid）暂无入口，待「皮肤扩库」（升级成正式皮肤 + 与新引擎 10 母版并列表）时回归。
ck 'VF_ONELAYER_V1'                 'src/app/agent/page.tsx' 6 # 状态注释/成片方式删除说明/风格块过渡说明×2/高级删除块/提交注释
# ★VF_UPLOADWHITELIST_V1 / ★VF_MATWARN_V1 / ★VF_LINETAG_V1 / ★VF_NEARDUP_V1 / ★VF_PREVIEWTXT_V1
#   （2026-10-06 用户实测「图视混剪这里上传的完全不走上传，还是走库」+「几个制片上传素材打开的路径不一致」）：
#   ① 【真 bug】图视混剪取素材写死 listRepoMaterials(uid,30,'spread')，而 vd.uploaded 只在 :906 初始化 /
#      :953 赋值、**全文件零消费** ⇒ 刚上传的素材被丢进全仓库 30 条里打散抽样，大概率挑不到
#      （用户观感"上传了没用 / 它还是走库"）。修：有上传名单 ⇒ 'recent' + 名单精确过滤 + 不打散不降权
#      （对齐既有范式：素材+AI vf-mix.ts:342-357、图片成片 route.ts:4446-4460、AI 制片 vf-aivideo.ts:370-374）。
#   ② 【误导文案】设置卡两线共用，而"视频暂时不会被画出来"是**替图片成片写的硬编码** ⇒ 图视混剪也被误告。
#      修：formCard 下发结构化 line（'video'=图视混剪 / 'local'=图片成片）+ 客户端按线出文案。
#      ⚠️ 顺带钉死一个事实：上传目标与读取目录**四条线本来就是同一个**（POST /api/storage/files →
#      OSS storage/<uid>/）；用户感知的"两个路径"= 两张不同的卡 + accept 不同 + 本次上传名单认不认（即①）。
#   ③ 【静默丢弃】过大/过长（>400MB / >30min）的视频原来只写服务端日志 ⇒ 现在写 vd.matWarn → 确认卡上显示。
#   ④ 【近重复漏网】dedupeAdjacentSameText 原来只认**完全相等** ⇒ 第3/4页「从封面到方案」近重复漏网。
#      修：忽略标点后相等，或短句(≥6字)是长句前缀且尾巴 ≤6 字（上限防误并"真不相同的页"）。
#   ⑤ 【预览误判】老引擎逐镜预览把每页文字 .slice(0,8) ⇒ 出现「AIConfid」「标题直接写着：A」被当成片子坏了。
#      修：放宽到 14 字 + 悬停看全文（title）。
#   端测：去重例（近似页被改 /「智能营销方案落地三个月见效果」不动 / 完全相等照改）✓；tsc 0 新增。
ck 'VF_UPLOADWHITELIST_V1'      'src/lib/agent/vf/vf-video.ts' 3
ck 'VF_MATWARN_V1'              'src/lib/agent/vf/vf-video.ts' 2
ck 'VF_MATWARN_V1'              'src/app/api/agent/chat/route.ts' 1
ck 'VF_LINETAG_V1'              'src/lib/agent/vf/vf-video.ts' 1
ck 'VF_LINETAG_V1'              'src/app/api/agent/chat/route.ts' 1
ck 'VF_NEARDUP_V1'              'src/lib/agent/vf/anti-ai.ts' 2
ck 'VF_PREVIEWTXT_V1'           'src/app/agent/page.tsx' 1
# ★VF_VDUP_V1（2026-10-06 用户实拍反馈 20261006_043「同一段画面连放 2~3 格」）：分镜里第 2/3 镜同
#   vstart=7、第 4/5 镜同 vstart=23 ⇒ 成片观感"画面卡住不动"（一镜 2.6~3s，两镜 = 5~6s 同一画面）。
#   AI 常给相邻镜写同一个取样点（提示词管不住）⇒ 服务端硬兜底：同一条视频内，本镜起点若落在
#   【上一镜已用区间】里就顺延到区间之后；顺延不动（已到片尾）则退到该视频还没用过的最前一段；
#   顺延几次如实写日志（不删镜、不改文案、不硬造画面）。
ck 'VF_VDUP_V1'                     'src/lib/agent/vf/vf-video.ts' 2
# ★VF_BIGCUT_V1（2026-10-06 用户实拍 20261006_043 成片里出现大字「真正价值在6」——原句含「6.1MB」）：
#   画面大字原来一律 `String(t).slice(0,14)` ⇒ 会切在**数字/英文串中间**，一眼露机器味。
#   修法 = 避词边界截断（窗口末尾落在字母数字串（含 . % - /）中间 ⇒ 回退到串首；再剥末尾悬挂标点；
#   剥空则保留硬切）。**三处刻意同口径（改一处必须三处一起改）**：
#     TS `anti-ai.bigTextCut`（route.ts 图片成片线 4 个调用点 + vf-video 混剪线）
#     / `vf-mix.cutBig`（该文件契约是"零 import、三条线互不 import"，故自带一份重复实现）
#     / Python `render.py::_cut_big_text`（渲染侧最后一道闸）。
#   端测：直接 import 真函数 ——「真正价值在6.1MB背后的逻辑。」→「真正价值在6.1MB背后的逻」✓、
#   「96.5%的企业都忽略了这个细节」→「96.5%的企业都忽略了这个」✓（% 保住）、长纯英文串仍硬切（无法避免）。
ck 'VF_BIGCUT_V1'                   'src/lib/agent/vf/anti-ai.ts' 1
ck 'VF_BIGCUT_V1'                   'src/app/api/agent/chat/route.ts' 2
ck 'VF_BIGCUT_V1'                   'src/lib/agent/vf/vf-video.ts' 2
ck 'VF_BIGCUT_V1'                   'src/lib/agent/vf/vf-mix.ts' 1
ck 'VF_BIGCUT_V1'                   'scripts/video-factory/render.py' 2
# ★VF_BIGSUB_V1（2026-10-06 用户实拍 043：同一镜大字「4个认知升级的关键帧」= 字幕「4个认知升级的关键帧。」）：
#   根因 = AI 把同一句既填 text（画面大字）又填 subtitle（字幕），提示词没拦住（bgimage/video 尤其爱照抄）。
#   治法（保守、只减不增、**字幕一个字不动**）：只治 bgimage/image/video（大字是叠加层）——大字若是该镜
#   字幕前缀（忽略标点、≥4 字）⇒ ① 有 kicker/label 就换成它；② 没有就清掉大字（只留字幕，画面更干净）。
#   ⚠️ 独立文字卡（title/list/number/compare/chart/end）一律不动（它们的大字=卡的全部内容，清掉会空屏）。
#   接线：图片成片线两处（首次起草 + 重排分镜，紧邻 dedupeAdjacentSameText）+ 图视混剪线一处。
#   端测：直接 import 真函数 —— 同文无 kicker ⇒ 清掉 ✓ / 同文有 kicker ⇒ 换 kicker ✓ / 不同文 ⇒ 不动 ✓ /
#   title 卡同文 ⇒ **不动** ✓ / video 镜同文 ⇒ 清掉 ✓。
ck 'VF_BIGSUB_V1'                   'src/lib/agent/vf/anti-ai.ts' 1
ck 'VF_BIGSUB_V1'                   'src/app/api/agent/chat/route.ts' 3
ck 'VF_BIGSUB_V1'                   'src/lib/agent/vf/vf-video.ts' 2
# ★VF_LINETAG_V1（A2 续）：上传卡的两处文案/accept 也按线分（图片成片只吃图片、图视混剪吃图+视频；
#   素材+AI 保持只吃图片但**注明**，回显统一成"本次只从这几张取，不掺仓库"）
ck 'VF_LINETAG_V1'                  'src/app/agent/page.tsx' 4
# ★VF_DURAUTO_V1（2026-10-06 用户定案「上传素材不给选时长，已实际素材合成剪辑为准，可以轻微调整」）：
#   本次**带了上传素材**（uploaded 非空）⇒ ① 客户端「时长」整行置灰，改显示"以素材合成剪辑后的实际时长为准"；
#   ② 服务端 form 解析**不再接受手填秒数**；③ 起草完把 vd.dur 回填成**分镜实际合计**，让 planRoot.duration
#   与之一致 —— 于是"卡片显示的秒数 = 成片秒数"，且**尾镜不再被目标秒数裁掉**
#   （043 实测：分镜 32.0s / 目标 30s / 成片 29.6s，收尾卡只剩 1.6s）。
#   ⚠️ 纯仓库模式（没上传）durAuto=false ⇒ 行为与改前一字不差（零回归）。
ck 'VF_DURAUTO_V1'                  'src/lib/agent/vf/vf-video.ts' 4
ck 'VF_DURAUTO_V1'                  'src/app/agent/page.tsx' 1
# ★VF_SCRIM_V1（2026-10-06 老板「注意审美」+「我的素材都是海报截图、文字多的很」）：
#   视频/AI 片段镜原来是 **整幅 `black@0.15` 均匀压暗 + 0.72H 以下一块 `black@0.30` 硬边黑板**
#   ⇒ 文字多的截图被整体压灰、72% 处还有一条可见水平分界线（观感"糊 + 脏"）。
#   改为**带状渐变遮罩** `scrim_boxes()`：顶部由 0.42 渐隐到 0（承托固定标题/大字）、中段只留 0.05
#   （保对比不发灰）、底部由 0 渐到 0.52（承托字幕）；深色素材（lum<78）三条 alpha 整体 ×0.35
#   （沿用 ★VF_MATGUARD_V1 口径）。实现 = steps 条 drawbox 近似（单输入链内确定性可做，
#   不引第二输入、不用慢的 geq；alpha 3 位小数、绝不输出 0/科学计数法）。
#   端测：`python render.py --selftest` 12 镜全过、成片 41.56s（视频镜/AI 片段镜/素材镜都跑到）。
#   ★已覆盖全部素材页路径：`card_video` 两处（视频片段 + AI 片段）+ `card_bgimage` 两处（正常素材页 +
#     "素材不适合当背景→改用质感底板"那条）+ 删掉只服务硬边黑板、已成死变量的 `_bar_y`。
#     （残留的 `black@0.30` 都是**文字底衬** `_boxc`，属另一功能，不要误删。）
ck 'VF_SCRIM_V1'                    'scripts/video-factory/render.py' 6
# ★VF_DUO_V1（2026-10-06 用户定案 B3）双幅拼版 / 相框多幅（"素材不够：2 副拼一副 / 加相框多副排版"）：
#   做法 = **不新增第二套素材页管线**：先用 ffmpeg 把 2~4 张素材拼成**一张合成 PNG**（等比缩放 +
#   统一底色留边 + 细缝；竖屏 2 张走上下、横屏 2 张走左右、3~4 张走 2×2），补 `pad` 到画幅尺寸
#   （否则合成图比画布小一圈 → 会走"不放大保清晰"分支，整张拼版缩成一小块居中、观感散了），
#   再把这张 PNG 交给既有 `card_bgimage` ⇒ ★VF_SCRIM_V1 渐变遮罩 / ★VF_MATGUARD_* 大字避让 /
#   动效 / 字幕**全部自动继承**。注册为卡型 `duo`（2 张）与 `frame`（3~4 张）。
#   ⚠️ 拼版镜**豁免** `_screen`（"又深又满字 → 改用质感底板"）判据：那几张图是用户点名要拼的，
#      换成空底板等于把画面弄丢；只按"满字素材"让位（大字 0.72 + 落"下三分之一 + 渐隐底衬带"）。
#   兜底：凑不齐 2 张或拼版失败 ⇒ 老实回落单图（宁可少，不让整镜崩）。
#   端测：本机真渲 `--storyboard`（duo 2 张 + frame 3 张）⇒ 两镜 OK、成片 8.00s；抽帧核对
#      上行蓝图/下行橙图、2×2 网格右下留白、大字渐隐底衬与上下渐变遮罩都在。
ck 'VF_DUO_V1'                      'scripts/video-factory/render.py' 10
# ★VF_DUO_WIRE_V1（2026-10-06 批 4 接线）：把引擎已就绪的 `duo`/`frame` 拼版接进两条线的分镜 ——
#   图片成片（route.ts：提示词从"7 种 type"放开到 9 种 + `picks`→本地路径取材；取不到 2 张**不接管**，
#   走"未知 type → 归一化成 bgimage/title"那条已验证的兜底路）与图视混剪（vf-video.ts：同口径，
#   取材用本线的图片清单）。**刻意不把 duo/frame 加进 KNOWN_TYPES** —— 加了会让"取不到图"的 duo
#   原样透给渲染层（srcs 空 ⇒ 白镜）。渲染侧另有兜底：凑不齐 2 张 = 回落单图（见 ★VF_DUO_V1）。
ck 'VF_DUO_WIRE_V1'                 'src/app/api/agent/chat/route.ts' 1
ck 'VF_DUO_WIRE_V1'                 'src/lib/agent/vf/vf-video.ts' 2
# ★VF_KINOKU_V1（2026-10-06 批 5 / C4）：`make.py::split_text_by_cap` 的"硬切"加**禁则回退** ——
#   与 TS 侧 `anti-ai.pickKinsokuCut` 同口径：不许切在 ASCII 字母数字串 / 数字+中文单位 / 小数点百分号
#   两侧 / 标点落到段首。回退救不回来（整个窗口就是一个超长数字串，如 `96.5%` 占满 cap）⇒
#   **宁可让这段超 cap 一点（最多 +6 字），也绝不把它切坏**（数字被切 = 配音念错 + 字幕断词）。
#   ⚠️ 两个坑都踩过并已修：① `str.isalnum()` 对**汉字也为真** ⇒ 判据必须 `isascii()` 限定，
#      否则"前向补齐"会把整句中文当成一个词吃掉（实测 cap=6 第一段变 10 字，等于废掉 cap）；
#      ② 只护数字不护字母 ⇒ `ABCDEFG` 仍被切开（现整串 ASCII 字母数字都护）。
#   契约：`''.join(segs) === 原文` **永不破坏**（单测 7 例 join 全等、破坏数 0）。
ck 'VF_KINOKU_V1'                   'scripts/video-factory/make.py' 2
# ★VF_MINSTOP_V1（2026-10-06 用户实测 043「收尾卡一闪而过」）：镜长 = 配音 + 0.35 尾隙 ⇒
#   **旁白很短的纯文字卡**（尤其 end / title）会短到看不清（043 收尾卡只剩 1.6s）。
#   给纯文字卡抬【最短停留】：end 3.0 / title·quote 2.8 / compare·chart·list 2.6 / number 2.4；
#   素材镜（bgimage/video/duo/frame）一律不抬（画面本身就是内容）。
#   ✅ 不破坏既有对齐：音频侧合并时**按镜长 apad 补静音**（VF_AUDIOALIGN_V1）⇒ A/V 仍严格对齐；
#      字幕窗口用的是 `voice`（不是 dur）⇒ **字幕一个字都不会因此多停**（不会带回"配音比字幕快"）。
ck 'VF_MINSTOP_V1'                  'scripts/video-factory/tts.py' 1
# ★VF_PPTPAGE_V1（2026-10-07 用户定案「先做 P0」）——图片成片/图视混剪的【纯文字镜】换成
#   **新引擎（html-deck）渲出的整页版式图**，再当素材贴回原镜（先做静帧版）。
#   为什么不是"一镜一个 deck"：新引擎 deck **下限 4 页**（deck.schema.json:27）+ 首屏必须 cover，
#   且 render-deck **没有"只渲某页"的开关**（CLI 仅 <deck.json>/--outdir/--no-render）⇒ 校验先 exit 3。
#   所以：**把一条片的文字镜合成一个 deck 渲一次**（cover 占位 + 逐镜映射 + 不足 4 页补占位），
#   再把 `frames/pN-full.png`（**0 基**：p0=封面）按序贴回 ⇒ 顺带白拿 schema 校验/字体闸门/对账。
#   落点：`scripts/video-factory/ppt-pages.mjs`（映射 + 窗口硬校验 + 字表预筛 + 内容 hash 缓存 + 兜底日志），
#   由 `make.py::_pptpage_swap` 在**配音之后、渲染之前**调用（失败/跳过 ⇒ 回落原 storyboard，绝不影响出片）；
#   只对 **图片成片/图视混剪**生效（`--source ai` 与 `--mix` 一律跳过 = 用户「PPT 成片单独放着」）；
#   `VF_PPTPAGE=0` 可一键回全老画法。
#   贴回时四个"必要姿态"（本机实测缺一就不对）：`frame:'none'`（否则编辑风把它缩成圆角卡片 + 背景虚化）、
#   `kb:'none'`（否则每镜推近=逐帧裁切，切掉页面安全边）、`_pptpage`（否则深色母版页面被 `_screen` 判废换空底板）、
#   删 `text`（页面已有标题层级，再叠老引擎大字=字压字）。
#   本机端到端实测：映射窗口判定正确（bgimage 不换 / 短条目与 3 字标题明确拒绝并给原因 / 3 镜可换 ⇒ deck 4 页）；
#   真渲 4 页 ~20s；换页后交老引擎渲染 **7 镜全 OK、成片 31.00s**，抽帧确认**整屏满幅**。
ck 'VF_PPTPAGE_V1'                  'scripts/video-factory/ppt-pages.mjs' 1
ck 'VF_PPTPAGE_V1'                  'scripts/video-factory/make.py' 8
ck 'VF_PPTPAGE_V1'                  'scripts/video-factory/render.py' 2
# ★VF_KBSTATIC_V1（2026-10-07 P0 配套）：`kb` 增加**真正的静止档**（none/off/static → zoom 1.0）。
#   改前任何非 zoomin/zoomout 的值都落到 else 的"轻微放大 1.10" ⇒ 没有静止档；
#   而"整页设计图"（PPT 版式页/已排版的整页图）不该再被推近（推近=逐帧裁切，切掉标题/页码/进度线）。
ck 'VF_KBSTATIC_V1'                 'scripts/video-factory/render.py' 1
# ★2026-10-07 四件小事（用户定案顺序：①日志重复 ②卡片时长口径 ③render.py:3501 补遮罩 ④版式页逐镜关顶部标题）
#   ★VF_MERGELOG_V1：合并日志的镜号口径修正。改前用 `out.length` 报号，而合并分支**不 push**（长度不前进）
#     ⇒ 连续 3 张以上同卡型同内容时，第 3 张又并进同一镜、把**同一对镜号**再打一遍（用户实测
#     「第 20 与 21 镜连出两次」误以为合并了两遍）。改成「并入原始第 N 镜 → 合并进第 M 镜」；
#     ⚠️ 数据层**本来就没有**重复合并（被并镜一律 continue 丢弃）。
#   ★VF_CPSONE_V1：口播语速**唯一真源** = anti-ai.ts 的 VF_SUB_CPS(4.3 字/秒)。改前四处不一致
#     （卡片预估 4.5 / anti-ai 4.3 / make.py 4.3 / vf-deck-render 占位 4.2）⇒ 同一段文案在"卡片上"
#     与"成片里"给出两个秒数（"承诺 30 / 成片 29.6"那类对不上的根源）。本轮把 12 处 `chars / 4.5`
#     统一成 `chars / VF_SUB_CPS`，卡片三个数字（预估/目标/概要）收成一句
#     「最终以配音为准（约 N 秒）」；`targetSec` 只留给成本公式。真时长仍只有 tts.py 跑完才有。
#   ★VF_DECKSCRIM_V1：`card_bgimage` 的 **deck 卡片版式分支**补 `scrim_boxes` —— 改前它在这之前就
#     return，是全库**唯一一处没有渐变压暗**的素材画面（视频镜 1845/1911、素材镜主链 3673 都已有）。
#   ★VF_BANNERSKIP_V1：顶部固定标题支持**逐镜跳过**（分镜根级 `banner.skip` = 1-based 镜号数组，
#     render.py 按每镜 dur 累加换算成绝对秒区间，enable 写 `base*not(...)` 做减法）。
#     `ppt-pages.mjs` 换页时**自动写入** ⇒ 整页版式图不再被横幅压住（横幅在顶部 16% 以内，
#     正好压住页面的 kicker/标题 = 字压字）。本机实测：素材镜/老画法镜**有**横幅、换页镜**无**横幅。
ck 'VF_MERGELOG_V1'                 'src/lib/agent/vf/material-pool.ts' 1
ck 'VF_CPSONE_V1'                   'src/lib/agent/vf/anti-ai.ts' 1
ck 'VF_CPSONE_V1'                   'src/lib/agent/vf/vf-aivideo.ts' 1
ck 'VF_CPSONE_V1'                   'src/lib/agent/vf/vf-mix.ts' 1
ck 'VF_CPSONE_V1'                   'src/lib/agent/vf/vf-ppt.ts' 1
ck 'VF_DECKSCRIM_V1'                'scripts/video-factory/render.py' 2
ck 'VF_BANNERSKIP_V1'               'scripts/video-factory/ppt-pages.mjs' 1
ck 'VF_BANNERSKIP_V1'               'scripts/video-factory/render.py' 3
# ★2026-10-07 新线「PPT+图视」第一步（引擎侧）：页型编排 + 皮肤贯通 + 两道闸门
#   ★VF_PAGEMIX_V1（用户定案：「**不要让 AI 总是只用最简单的『一页三排字』去画重点**」）：
#     每个镜改为返回**候选页型列表**，由编排器按"内容信号 + 去单调闸门"挑一个。改前是 1:1 机械映射
#     （list→bullets）⇒ 一条片的文字页全长一个样。闸门三条：① 同页型**连续上限 2 页**；
#     ② `bullets`/`toc`（"三排字"家族）各自**配额 ≤ 已定页数的 40%**；③ 违反就换下一个候选，
#     无候选可换时才让位并写日志。选型信号：整句→quote／有序号词或标题含"步骤/流程"→steps／
#     条目均长≥15→bullets／条目短→toc／大数字→section(number)／多条数值→chart／两条副卡→data。
#     `--no-mix` = 退回改前那套 1:1 机械映射（对照/排障用）。
#     本机实测（11 镜样例）：编排版 **种类 5（section×4 bullets×1 steps×1 toc×2 quote×1）**；
#     对照组 --no-mix 种类 3（section×5 bullets×1 toc×3）⇒ "一页三排字"显著减少。
#   ★VF_BULLETSUM_V1（本机实测抓到的真 bug）：`summary` 是 bullets 页的 **schema 必填**，改前只在
#     副标刚好 6~334 字时才补 ⇒ 副标太短（如「这就是差距」5 字）时产出**非法 deck** → 校验 FAIL →
#     渲染失败 → 换页白做（线上只看到"换页未生效"）。现在拿不到合规 summary 就不提供 bullets 候选。
#   ★VF_DECKGATE_V1：**渲染前先过 validate-deck.mjs**，不过就直接不换页（回落老画法）并原样打出原因
#     —— 避免"白渲一遍 + 日志只写渲染失败"。
#   ★VF_PPTSKIN_V1：plan 根级 `pptpage{master,palette,mix}` → make.py 传给 ppt-pages.mjs
#     （新线用新引擎 10 母版 × 4 配色；**老线不写这两个键 ⇒ 行为与今天逐字一致，零回归**）。
ck 'VF_PAGEMIX_V1'                  'scripts/video-factory/ppt-pages.mjs' 3
ck 'VF_BULLETSUM_V1'                'scripts/video-factory/ppt-pages.mjs' 2
ck 'VF_DECKGATE_V1'                 'scripts/video-factory/ppt-pages.mjs' 1
ck 'VF_PPTSKIN_V1'                  'scripts/video-factory/make.py' 2
line "结论"
if [ "$FAIL" -eq 0 ]; then
  echo "✅ 全过（渲染自检 + 四引擎 + 关键改动都在位）"
  echo "   临时产物在 $TMP（可删）"
else
  echo "❌ 有失败项 —— 看上面 FAIL 行；把输出整段发我即可定位"
fi
exit "$FAIL"
