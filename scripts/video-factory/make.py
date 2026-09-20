#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""一句话成片（★VIDEO_FACTORY_MAKE_V1）—— 把配音 + 渲染串成一条命令

用法:
  # ① 最简：给一段文案 → 自动切句成卡 → 出片
  python make.py --script "AI Marketing 帮你做内容。发布到六个平台。已经服务 300 家客户。" --out out.mp4

  # ② 高级：给现成分镜 JSON（AI 排好分镜后用这个）
  python make.py --storyboard my.json --out out.mp4

流程（与 docs/成片工作流方案 一致）:
  文案 → 分镜(按规则切句) → tts.py 逐句配音+回填时长 → render.py 渲染+字幕+混音 → 成片

为什么先做"规则切句"而不是"AI 排分镜"：
  先把【确定性链路】跑通（本文件），AI 只负责"写文案 + 排分镜"这一步，
  接进 AGENT 时只需替换 --storyboard 的来源。链路不变 → 少调试。
"""
import argparse
import json
import os
import re
import subprocess
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
HERE = os.path.dirname(os.path.abspath(__file__))

# 主题预设（先给一套；对应 docs 里"主题 JSON"的最小实现）
THEMES = {
    'dark':   {'bg': '0x0a1620', 'text': 'white', 'accent': '0xff6b35', 'font': 'msyh'},
    'light':  {'bg': '0xf5f2ea', 'text': '0x1a1a1a', 'accent': '0xc0392b', 'font': 'msyh'},
    'tech':   {'bg': '0x0b1c2c', 'text': '0xe8f1f8', 'accent': '0x2ec4b6', 'font': 'msyh'},
}


def split_sentences(text):
    """按中文标点切句，保留完整语义"""
    parts = re.split(r'(?<=[。！？!?；;])', (text or '').strip())
    return [p.strip() for p in parts if p and p.strip()]


def build_storyboard(script, theme='dark', size=(1280, 720), first_title=None):
    """规则切句 → 分镜：第 1 句做标题卡，其余做列表/数字/标题卡"""
    sents = split_sentences(script)
    if not sents:
        sents = [script or 'AI Marketing']
    shots = []
    # 第 1 句 → 标题卡
    shots.append({'type': 'title', 'text': first_title or sents[0], 'dur': 3})
    body = sents[1:] if len(sents) > 1 else []
    # 有数字的句子 → number 卡；连续短句 → list 卡
    list_buf = []
    for s in body:
        m = re.search(r'(\d[\d,\.]*)\s*(万|亿|家|个|次|%|元|人)?', s)
        if m and len(list_buf) < 2:
            if list_buf:
                shots.append({'type': 'list', 'title': '要点', 'items': list_buf, 'dur': 4})
                list_buf = []
            shots.append({'type': 'number', 'value': int(float(m.group(1).replace(',', ''))),
                          'suffix': (m.group(2) or '+'), 'label': s[:24], 'dur': 3})
        elif len(s) <= 14:
            list_buf.append(s.rstrip('。！？!?；;'))
            if len(list_buf) >= 3:
                shots.append({'type': 'list', 'title': '要点', 'items': list_buf, 'dur': 5})
                list_buf = []
        else:
            if list_buf:
                shots.append({'type': 'list', 'title': '要点', 'items': list_buf, 'dur': 4})
                list_buf = []
            shots.append({'type': 'title', 'text': s, 'dur': 3.5, 'fontsize': 56})
    if list_buf:
        shots.append({'type': 'list', 'title': '要点', 'items': list_buf, 'dur': 4})
    return {'size': list(size), 'fps': 25, 'theme': THEMES.get(theme, THEMES['dark']), 'shots': shots}


def run(cmd, label):
    print('[MAKE] %s' % label)
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True,
                       encoding='utf-8', errors='replace')
    out = (r.stdout or '') + (r.stderr or '')
    for ln in out.splitlines()[-6:]:
        if ln.strip():
            print('   ' + ln[:150])
    return r.returncode == 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--script', default='', help='一段文案（自动切句成卡）')
    ap.add_argument('--storyboard', default='', help='现成分镜 JSON 文件')
    ap.add_argument('--plan', default='', help='AI 给的分镜 JSON 字符串（或 @文件路径）——优先级最高')
    ap.add_argument('--preview', action='store_true', help='只输出分镜计划（JSON），不配音不渲染')
    ap.add_argument('--theme', default='dark', choices=list(THEMES.keys()))
    ap.add_argument('--out', default='out.mp4')
    ap.add_argument('--workdir', default='')
    ap.add_argument('--speaker', default='', help='音色，留空用引擎默认（百炼 longxiaochun / 火山 zh_female_vv_uranus_bigtts）')
    ap.add_argument('--bgm', default='', help='背景音乐文件（★VF_BGM_V1：循环铺底 + 压低音量）')
    a = ap.parse_args()

    if not a.script and not a.storyboard and not a.plan:
        print('需要 --script / --storyboard / --plan 之一'); sys.exit(2)

    wd = a.workdir or os.path.join(os.path.dirname(os.path.abspath(a.out)), 'vf-work')
    os.makedirs(wd, exist_ok=True)

    # ① 分镜（优先级：--plan > --storyboard > --script 自动切句）
    if a.plan:
        raw = a.plan
        if raw.startswith('@') and os.path.exists(raw[1:]):
            raw = open(raw[1:], encoding='utf-8').read()
        try:
            plan = json.loads(raw)
        except Exception as e:
            print('[MAKE] ❌ --plan 不是合法 JSON: %s' % str(e)[:120]); sys.exit(2)
        if isinstance(plan, list):
            sb = {'size': [1280, 720], 'fps': 25,
                  'theme': THEMES.get(a.theme, THEMES['dark']), 'shots': plan}
        else:
            plan.setdefault('size', [1280, 720])
            plan.setdefault('fps', 25)
            plan.setdefault('theme', THEMES.get(a.theme, THEMES['dark']))
            sb = plan
        sb_path = os.path.join(wd, 'storyboard.json')
        json.dump(sb, open(sb_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    elif a.storyboard:
        sb_path = a.storyboard
        sb = json.load(open(sb_path, encoding='utf-8'))
    else:
        sb = build_storyboard(a.script, a.theme)
        sb_path = os.path.join(wd, 'storyboard.json')
        json.dump(sb, open(sb_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)

    # ★ 首镜先确认（preview）：只给分镜计划，不花钱不渲染
    if a.preview:
        print('[MAKE] PREVIEW 分镜计划（未渲染）:')
        print(json.dumps(sb, ensure_ascii=False, indent=2))
        print('[MAKE] PREVIEW_JSON_FILE:%s' % sb_path)
        return
    print('[MAKE] 分镜 %d 镜: %s' % (len(sb.get('shots', [])),
                                    ', '.join(s.get('type', '?') for s in sb.get('shots', []))))

    # ② 配音（回填真实时长）
    voiced = os.path.join(wd, 'storyboard.voiced.json')
    voice = os.path.join(wd, 'voice.m4a')
    ok = run('"%s" "%s" --storyboard "%s" --workdir "%s" --speaker "%s" --out-json "%s" --merge "%s"'
             % (sys.executable, os.path.join(HERE, 'tts.py'), sb_path, os.path.join(wd, 'tts'),
                a.speaker, voiced, voice), '逐句配音')
    use_sb = voiced if (ok and os.path.exists(voiced)) else sb_path
    # ★ 只要有配音文件就混进去（原来判断漏了 --plan 分支 → 用 plan 时出的是无声片）
    use_voice = voice if os.path.exists(voice) else ''
    if not use_voice:
        print('[MAKE] ⚠️ 无配音，出无声片')

    # ③ 渲染成片
    ok2 = run('"%s" "%s" --storyboard "%s" --workdir "%s" --audio "%s" --bgm "%s" --out "%s"'
              % (sys.executable, os.path.join(HERE, 'render.py'), use_sb,
                 os.path.join(wd, 'render'), use_voice, a.bgm, a.out), '渲染成片')
    if ok2 and os.path.exists(a.out):
        sz = os.path.getsize(a.out)
        print('[MAKE] ✅ 成片: %s  (%.1f MB)' % (a.out, sz / 1048576.0))
    else:
        print('[MAKE] ❌ 渲染失败')
        sys.exit(1)


if __name__ == '__main__':
    main()
