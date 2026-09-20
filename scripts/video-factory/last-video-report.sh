#!/usr/bin/env bash
# 最后一条成片 · 报告（2026-09-20）
#
# 用法（服务器上）：
#   cd /root/AiMarketing && bash scripts/video-factory/last-video-report.sh
#   （默认看 userId=1；要看别的账号：bash scripts/video-factory/last-video-report.sh 2）
#
# 它一次性打出「做完一条视频后该看的所有东西」：
#   ① 起草+渲染日志（[VF]/[TTS]/[MAKE]）—— 覆盖率/扩镜/上传/画幅/画布/概要/每镜时长
#   ② 成片实际参数（时长/分辨率/有没有音轨）
#   ③ 任务 JSON（cost = 实际扣点、tail = 渲染日志尾部）
#   ④ 本次分镜（镜数/卡型/每镜时长/每镜字数/用到哪几张图）

set -u
cd "$(dirname "$0")/../.." || exit 1
UID_="${1:-1}"

echo "===== ① 起草 + 渲染日志（含 [VF] [概要]/[覆盖率]/[扩镜]/[上传]/[画幅]/[画布]）====="
# ★2026-09-20 修：原来写 `2>/dev/null` —— 但 pm2 logs 有内容走 stderr，会被整段丢掉
#   （用户实测：① 段是空的）→ 必须 `2>&1` 把 stderr 合并进来。
_LOG=$(pm2 logs aimarketing --lines 800 --nostream 2>&1 | grep -E "\[VF\]|\[TTS\]|\[MAKE\]" | tail -80)
if [ -n "$_LOG" ]; then
  echo "$_LOG"
else
  echo "（空）可能原因：① 这条视频是在【部署之前】做的 —— deploy-server.sh 会 pm2 flush 清日志"
  echo "  ② pm2 日志轮转/重启清空。补救：看下面 ③ 段的任务 JSON（tail 里含渲染阶段日志）；"
  echo "  想补看起草阶段，再做一条视频后立刻跑本脚本。"
fi

echo
echo "===== ② 最近成片的实际参数（时长 / 分辨率 / 音轨）====="
F=$(ls -t "storage/$UID_"/video-factory/vf_*.mp4 2>/dev/null | head -1)
if [ -n "${F:-}" ]; then
  echo "文件: $F"
  ffprobe -v error -show_entries format=duration,size -of default=nw=1 "$F" 2>/dev/null
  ffprobe -v error -show_entries stream=codec_type,codec_name,width,height -of default=nw=1 "$F" 2>/dev/null
else
  echo "（没找到成片文件）"
fi

echo
echo "===== ③ 任务 JSON（cost=实际扣点，应与卡片报价一致；tail=渲染日志尾部）====="
J=$(ls -t "storage/$UID_"/video-factory/vf*.json 2>/dev/null | head -1)
if [ -n "${J:-}" ]; then
  echo "文件: $J"
  cat "$J"
else
  echo "（没找到任务文件）"
fi

echo
echo "===== ④ 本次分镜（镜数/卡型/每镜时长/每镜字数/用到的图）====="
W=$(ls -td "storage/$UID_"/video-factory/work_*/ 2>/dev/null | head -1)
if [ -n "${W:-}" ] && [ -f "${W}storyboard.voiced.json" ]; then
  echo "workdir: $W"
  python3 - "$W" <<'PY'
import json, sys, os
from collections import Counter
w = sys.argv[1]
d = json.load(open(os.path.join(w, 'storyboard.voiced.json'), encoding='utf-8'))
s = d.get('shots', [])
print('镜数', len(s), '总时长', round(sum(float(x.get('dur', 0) or 0) for x in s), 1))
print('卡型', dict(Counter(x.get('type') for x in s)))
print('每镜时长', [round(float(x.get('dur', 0) or 0), 1) for x in s])
print('每镜字数', [len(str(x.get('subtitle') or '')) for x in s])
imgs = []
for x in s:
    p = x.get('src')
    if p and p not in imgs:
        imgs.append(os.path.basename(p))
print('用到的不重复图', len(imgs), imgs[:12])
PY
else
  echo "（没找到 storyboard.voiced.json）"
fi
