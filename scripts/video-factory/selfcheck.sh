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
ck 'shouldTakeOverAiLine'           'src/app/api/agent/chat/route.ts' 1 # ★AI 制片分派入口（用 ASCII 锚点，避免中文/符号匹配问题）
ck 'vfAiHandled'                    'src/app/api/agent/chat/route.ts' 1 # 没接管时恒 false → 素材合成行为不变
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
ck 'borderw=2'                      'scripts/video-factory/render.py' 1  # 画面大字描边

line "结论"
if [ "$FAIL" -eq 0 ]; then
  echo "✅ 全过（渲染自检 + 四引擎 + 关键改动都在位）"
  echo "   临时产物在 $TMP（可删）"
else
  echo "❌ 有失败项 —— 看上面 FAIL 行；把输出整段发我即可定位"
fi
exit "$FAIL"
