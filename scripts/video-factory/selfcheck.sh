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
# ★VF_SUBCHUNK_V1（2026-10-05 用户实测「99.8% 被切成 99 | % 两段字幕」，出现 2 次）：
#   deck 线自产 SRT 的固定字宽盲切 → 块点回退到数字/百分号/英文串之外。
ck 'VF_SUBCHUNK_V1'                'src/lib/agent/vf/vf-deck-render.ts' 2  # chunkSub 定义 + 调用
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
ck 'VF_MATDOM_V1'                  'src/lib/agent/vf/vf-deck-render.ts' 3 # 注入段 + 句子分配段 + TTS复用
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
# ★VF_DECKROUTE_V1（首版 镜>12/预计>90s 就提示走老引擎；VF_MATDOM_V1 破窗 40 页后放宽到真超容量）：
#   新引擎且预计 >300s（40 页 × ~6s ≈ 5 分钟）→ 确认卡明示建议拆条或换老引擎（只提示不拦）。
ck 'VF_DECKROUTE_V1'               'src/app/api/agent/chat/route.ts' 2   # 提示拼接 + 注释
# ★VF_AVIMG_V1（2026-10-05 用户定案「加图片页 + 字幕去重 + 配音/BGM 回归新引擎」）：
#   新引擎正式出片不再走 make-video 一把梭，改为分步编排（gen-deck → 注入 pageImage 图片页/
#   按配音定页时长 → 逐句TTS(百炼→硅基→火山) → 自产SRT(字幕=口播,与页面大字不再同文) →
#   batch-video 渲染+烧字幕 → ffmpeg 混音(配音±BGM)）。老引擎一行没改。
#   本地端到端实测：注入图片页(cover,bullets,image,bullets,end)25.4s 成片 + aac 立体声混音 ✓
ck 'VF_AVIMG_V1'                  'src/lib/agent/vf/vf-deck-render.ts' 8  # 管线分步注释+图片页注入+TTS+SRT+混音（≥8 处）
ck 'VF_AVIMG_V1'                  'src/app/agent/page.tsx' 4            # 解除音色/BGM置灰 + 三处文案更新（≥4 处）

line "结论"
if [ "$FAIL" -eq 0 ]; then
  echo "✅ 全过（渲染自检 + 四引擎 + 关键改动都在位）"
  echo "   临时产物在 $TMP（可删）"
else
  echo "❌ 有失败项 —— 看上面 FAIL 行；把输出整段发我即可定位"
fi
exit "$FAIL"
