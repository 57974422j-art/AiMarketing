#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""★VF_SUSTAIN_V2 回归护栏（2026-10-01）——「纯文字卡不得长时间静止」。

老板原话：「（整页只有几个大字）后面 5~6.5 秒完全静止」。
量化口径（官方 scripts/vf-film-health.mjs，团队给的硬指标）：
  8 秒的纯文字卡 → 镜内**不存在 ≥1.5s 的静止段**，且时间轴 `#`(YAVG≥1.0) **≥4 个**、
  **覆盖 0-2 / 2-4 / 4-6 / 6-8 四个 2s 窗**（bin 0-3 / 4-7 / 8-11 / 12-15 各至少一个 #）。

默认只跑**结构断言**（秒级、不渲染）；加 `--render` 再跑真渲 + film-health 硬断言（约 1~2 分钟）。
用法：
  python scripts/video-factory/test-sustain-motion.py [--render] [--wd <目录>]
"""
import argparse
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, HERE)

import render as R  # noqa: E402

OK, NG = [], []


def chk(cond, msg, extra=''):
    (OK if cond else NG).append(msg)
    print('  %s %s%s' % ('[PASS]' if cond else '[FAIL]', msg, ('  ← ' + str(extra)) if extra else ''))


def structural():
    print('\n① 结构断言：横向浮动参数 / 门控 / 镜序轮换')
    W, H = 1280, 720
    sh = {'_idx': 0}
    got = R.float_motion_filters(sh, {}, W, H, 8.0)
    want = ['scale=1360:720', "crop=1280:720:x='40+40*sin(2*PI*t/4.00)':y=0"]
    chk(got == want, '40px(=3.13%%W) 横向浮动 + 4.0s 周期（idx=0）', got)
    # 幅度必须是"实测达标"的那一档：12px(0.94%W) 时 film-health 完全无 #；26px 在"白杠"时代够用，
    # 但 ★VF_DECK_LIGHTFACE_V1 把面改成极淡染色后纹理变低 → 40px 才是 6 套 deck 全达标的档位。
    chk(R.FLOAT_AMP_RATIO >= 0.031, 'FLOAT_AMP_RATIO ≥3.1%%W（26px 在"淡染面"下 glass/grad 不达标）',
        R.FLOAT_AMP_RATIO)
    chk(R.FLOAT_ON is True, 'FLOAT_ON 默认开')
    # 镜序轮换：三条一循环
    _p = [R.float_motion_filters({'_idx': i}, {}, W, H, 8.0)[1].split('/')[-1].split(')')[0]
          for i in range(3)]
    chk(_p == ['4.00', '3.60', '4.40'], '周期按镜序轮换 4.0/3.6/4.4s（整片不同频，反 AI 味）', _p)
    chk(R.float_motion_filters({'_idx': 1}, {}, W, H, 1.0) == [], '短镜(dur<1.2s)不动（避免"抖"）')
    chk(R.float_motion_filters({'_idx': 1, 'sustain': 'none'}, {}, W, H, 8.0) == [],
        "shot['sustain']='none' 可单镜关")
    # 只用横向：纵向尺寸必须仍是 H（否则上下内容会被裁掉 —— 顶部强调条/底部分割线）
    chk(got[0].endswith(':%d' % H) and got[1].startswith('crop=%d:%d:' % (W, H)),
        '只做横向：scale 只加宽、crop 高度=原 H（上下内容一个像素都不丢）', got)


def source_guards():
    print('\n② 源码断言：接线位置 / 只给文字卡加速（不动全局默认）')
    code = '\n'.join(l for l in open(os.path.join(HERE, 'render.py'), encoding='utf-8').read().splitlines()
                     if not l.strip().startswith('#'))
    chk('grad_speed=FLOAT_GRAD_SPEED' in code,
        '纯文字卡的 stage_layer 走 FLOAT_GRAD_SPEED（A6：低纹理卡靠背景流动补足帧间差）')
    chk("'_grad_speed()'" in code or '_grad_speed()' in code,
        '其它调用方仍走 _grad_speed() 生产默认（素材卡零变化）')
    chk(R._grad_speed() == '0.015', '★VF_DECK_PIXEL_V2 的全局默认**仍是 0.015**（没有被顺手改掉）',
        R._grad_speed())
    # 浮动必须接在进度线**之前**（否则进度线会被一起缩放平移并裁出画面）
    i_float = code.find("','.join(_fm)")
    i_prog = code.find("','.join(_pfs)")
    chk(0 < i_float < i_prog, '横向浮动接在进度线**之前**（进度线才不会被裁出画面）',
        'float@%d prog@%d' % (i_float, i_prog))
    chk(code.count('float_motion_filters(') >= 2, 'float_motion_filters 已定义且被 render_shot 调用')


def render_check(wd):
    print('\n③ 真渲硬断言：8s 纯文字卡 → vf-film-health 时间轴 # ≥4 且覆盖四个 2s 窗')
    os.makedirs(wd, exist_ok=True)
    cards = {
        'title': {"type": "title", "text": "三大能力一次搞定",
                  "subtitle": "一条视频从选题到发布，全程本地完成", "dur": 8.0},
        'compare': {"type": "compare", "left": "手工剪辑", "right": "本地成片",
                    "leftDesc": "一条要半天", "rightDesc": "五分钟出片",
                    "subtitle": "两种做法的耗时对比", "dur": 8.0},
        'end': {"type": "end", "text": "开始出片", "cta": "点击咨询",
                "subtitle": "现在就试试", "dur": 8.0},
        'deck': {"type": "title", "variant": "deck", "kicker": "本地成片",
                 "text": "三大能力一次搞定", "items": ["选题定位", "脚本生成", "一键成片"],
                 "subtitle": "整条链路只需要三步", "dur": 8.0},
    }
    health = os.path.join(ROOT, 'scripts', 'vf-film-health.mjs')
    for name, shot in cards.items():
        sb = os.path.join(wd, 'sb_%s.json' % name)
        open(sb, 'w', encoding='utf-8').write(json.dumps(
            {'size': [1280, 720], 'fps': 25, 'theme': 'news', 'shots': [shot]}, ensure_ascii=False))
        mp4 = os.path.join(wd, 'card_%s.mp4' % name)
        subprocess.run([sys.executable, os.path.join(HERE, 'render.py'), '--storyboard', sb,
                        '--out', mp4, '--workdir', os.path.join(wd, 'wd_%s' % name), '--no-banner'],
                       capture_output=True, text=True, encoding='utf-8', errors='replace')
        if not os.path.exists(mp4):
            chk(False, '%s：渲染失败' % name)
            continue
        r = subprocess.run(['node', health, '--v', os.path.abspath(mp4),
                            '--wd', os.path.join(wd, 'fh')],
                           capture_output=True, text=True, encoding='utf-8', errors='replace')
        tl, still = '', ''
        for ln in (r.stdout or '').splitlines():
            s = ln.strip()
            if s and set(s) <= set('#+.') and len(s) > 6:
                tl = s
            if '分箱口径' in s:
                still = s
        n = tl.count('#')
        win = all('#' in tl[i * 4:(i + 1) * 4] for i in range(4))
        chk(n >= 4 and win, '%s：8s 时间轴 %s（#=%d，四窗覆盖=%s）'
            % (name, tl, n, ''.join('#' if '#' in tl[i * 4:(i + 1) * 4] else '.' for i in range(4))))
        chk('0s = 0%' in still, '%s：静止段 0s（无 ≥1.5s 静止）' % name, still.strip()[:60])

    # ★对照组 = **改动前行为**（A5 浮动关 + A6 渐变速度回 0.015）→ 必须**不达标**，
    #   否则说明"本来就在动"，这次改动并没有真正解决问题。
    sb = os.path.join(wd, 'sb_off.json')
    open(sb, 'w', encoding='utf-8').write(json.dumps(
        {'size': [1280, 720], 'fps': 25, 'theme': 'news', 'shots': [cards['title']]},
        ensure_ascii=False))
    mp4 = os.path.join(wd, 'card_off.mp4')
    drv = ("import sys\n"
           "sys.path.insert(0, %r)\n"
           "import render as R\n"
           "R.FLOAT_ON = False\n"
           "R.FLOAT_GRAD_SPEED = '0.015'\n"
           "sys.argv = ['render.py', '--storyboard', %r, '--out', %r, '--workdir', %r, '--no-banner']\n"
           "R.main()\n") % (HERE, sb, mp4, os.path.join(wd, 'wd_off'))
    subprocess.run([sys.executable, '-c', drv], capture_output=True, text=True,
                   encoding='utf-8', errors='replace')
    if os.path.exists(mp4):
        r = subprocess.run(['node', health, '--v', os.path.abspath(mp4),
                            '--wd', os.path.join(wd, 'fh')],
                           capture_output=True, text=True, encoding='utf-8', errors='replace')
        tl = ''
        for ln in (r.stdout or '').splitlines():
            s = ln.strip()
            if s and set(s) <= set('#+.') and len(s) > 6:
                tl = s
        chk(tl.count('#') < 4,
            "对照组（FLOAT_ON=False + 渐变回 0.015 = 改动前）→ 时间轴 %s（#=%d，不达标 ✅ 改动确实有效）"
            % (tl, tl.count('#')))


def deck_check(wd):
    """★VF_DECK_LIGHTFACE_V1（2026-10-01 晚）硬底线：**6 套 deck 页**改成"淡染面 + 1px 细边"后，
    8s 的运动量时间轴必须仍然达标（`#`≥4 且覆盖 0-2/2-4/4-6/6-8 四个 2s 窗）。
    为什么单列一节：白杠时代靠"面的面积×ΔL"扛运动量；面变淡之后要靠 ★VF_SUSTAIN_V2 的
    整块浮动（40px）+ 背景渐变流动 —— 这条断言就是"淡染没把动效改坏"的守门员。"""
    print('\n★6 套 deck 页 8s 时间轴（淡染面之后必须仍达标）')
    shot = {"type": "title", "kicker": "本地出片", "text": "三步走完一条片",
            "items": ["选题定位", "脚本生成", "一键成片"],
            "stats": [{"value": "128", "suffix": "%", "label": "转化率提升"}],
            "subtitle": "整条链路只需要三步", "dur": 8.0}
    health = os.path.join(ROOT, 'scripts', 'vf-film-health.mjs')
    for st in R.DECK_STYLE_VARIANTS:
        sb = os.path.join(wd, 'sb_dk_%s.json' % st)
        open(sb, 'w', encoding='utf-8').write(json.dumps(
            {'size': [1280, 720], 'fps': 25, 'theme': 'news',
             'shots': [dict(shot, variant=st)]}, ensure_ascii=False))
        mp4 = os.path.join(wd, 'deck_%s.mp4' % st)
        subprocess.run([sys.executable, os.path.join(HERE, 'render.py'), '--storyboard', sb,
                        '--out', mp4, '--workdir', os.path.join(wd, 'wd_dk_%s' % st), '--no-banner'],
                       capture_output=True, text=True, encoding='utf-8', errors='replace')
        if not os.path.exists(mp4):
            chk(False, '%s：deck 页渲染失败' % st)
            continue
        r = subprocess.run(['node', health, '--v', os.path.abspath(mp4),
                            '--wd', os.path.join(wd, 'fhdk')],
                           capture_output=True, text=True, encoding='utf-8', errors='replace')
        tl = ''
        for ln in (r.stdout or '').splitlines():
            s = ln.strip()
            if s and set(s) <= set('#+.') and len(s) > 6:
                tl = s
        win = ''.join('#' if '#' in tl[i * 4:(i + 1) * 4] else '.' for i in range(4))
        chk(tl.count('#') >= 4 and win == '####',
            '%s：8s 时间轴 %s（#=%d，四窗=%s）' % (st, tl, tl.count('#'), win))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--render', action='store_true', help='再跑真渲 + film-health 硬断言（慢）')
    ap.add_argument('--wd', default='')
    a = ap.parse_args()
    print('★VF_SUSTAIN_V2 护栏   render.py = %s' % os.path.join(HERE, 'render.py'))
    structural()
    source_guards()
    if a.render:
        render_check(a.wd or os.path.join(ROOT, 'dist-rel', 'style-preview', 'sustain'))
        deck_check(os.path.join(ROOT, 'dist-rel', 'style-preview', 'unified-decks'))
    print('\n===== 结果：%d PASS / %d FAIL =====' % (len(OK), len(NG)))
    for m in NG:
        print('  ✗ ' + m)
    return 1 if NG else 0


if __name__ == '__main__':
    sys.exit(main())
