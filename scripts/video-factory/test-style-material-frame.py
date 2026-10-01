#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""★VF_DECK_FRAME_DEFAULT_V1 回归护栏（2026-10-01 team-lead）。

**问题**：`plate_opts()` 的既有口径是"只有编辑风主题（news/data）默认开卡片版式" →
老板选「清爽浅色/杂志编辑/柔和高级」后，**纯文字 PPT 页是新风格，但图片镜/视频镜还是老样子**
（整幅虚化素材 + 居中大字）。

**修法**：在 `apply_style()`（只在显式选了合法成品风格时才生效）里补缺省 ——
素材镜（bgimage/image/video/aivideo）**若没写 `frame`** 就补 `frame='thin'`。

三条边界（本测试逐条守）：
  ① 选了风格 + 素材镜无 frame → **补上**；
  ② **没选风格 → plan 逐字节零改动**（deep compare）；
  ③ 显式写了 `frame`（含 `frame:'none'` 想关掉卡片版式）→ **不覆盖**。

真渲 A/B（同一套 cleanlight、同一镜、同一时刻）：
  · AFTER  = `--style cleanlight`（自动补 frame=thin）→ 素材**走卡片版式**
  · BEFORE = `--style cleanlight` + 显式 `frame:'none'` → 老的"整幅虚化素材 + 居中大字"
两帧文字掩膜布局明显不同（BEFORE 只有居中大字，AFTER 有卡片 + 右栏编排）。

用法：python scripts/video-factory/test-style-material-frame.py [--wd <目录>]
"""
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


def pure():
    print('\n① 纯逻辑：补缺省的三条边界（不渲染，秒级）')
    sb = {'theme': 'light', 'shots': [
        {'type': 'title', 'text': 'A', 'dur': 5},
        {'type': 'bgimage', 'src': 'a.jpg', 'dur': 5},                      # 该补
        {'type': 'video', 'src': 'v.mp4', 'dur': 5},                        # 也补（字段前向兼容）
        {'type': 'bgimage', 'src': 'b.jpg', 'frame': 'none', 'dur': 5},     # 显式关 → 不覆盖
        {'type': 'bgimage', 'src': 'c.jpg', 'frame': 'polaroid', 'dur': 5},  # 显式开 → 不动
    ]}
    R.apply_style(sb, 'cleanlight')
    s1, s2, s3, s4 = sb['shots'][1], sb['shots'][2], sb['shots'][3], sb['shots'][4]
    chk(s1.get('frame') == 'thin', '① 素材镜没写 frame → 补 frame=thin', s1)
    chk(s2.get('frame') == 'thin', '① video 镜同样补上（字段前向兼容）', s2)
    chk(s3.get('frame') == 'none', "③ 显式 frame='none'（老板要关掉卡片版式）→ **不覆盖**", s3)
    chk(s4.get('frame') == 'polaroid', '③ 显式 frame=polaroid → 原样保留', s4)
    # ② 不选风格 → 逐字节零改动
    sb2 = {'theme': 'light', 'shots': [{'type': 'bgimage', 'src': 'a.jpg', 'dur': 5}]}
    _before = json.dumps(sb2, sort_keys=True)
    chk(R.apply_style(sb2, '') == '' and json.dumps(sb2, sort_keys=True) == _before
        and 'frame' not in sb2['shots'][0],
        '② 不选风格 → plan 逐字节零改动（素材镜不补 frame）')
    sb3 = {'theme': 'light', 'shots': [{'type': 'bgimage', 'src': 'a.jpg', 'dur': 5}]}
    _b3 = json.dumps(sb3, sort_keys=True)
    chk(R.apply_style(sb3, 'cinematic') == '' and json.dumps(sb3, sort_keys=True) == _b3,
        '② 非法风格（cinematic）→ 同样零改动（严格守卫 + 不补 frame）')
    chk('★VF_DECK_FRAME_DEFAULT_V1' in open(os.path.join(HERE, 'render.py'),
                                           encoding='utf-8').read(),
        '防回退：★VF_DECK_FRAME_DEFAULT_V1 标记在位')


def frames(wd):
    print('\n② 真渲 A/B（cleanlight：AFTER 卡片版式 / BEFORE 老链路）')
    os.makedirs(wd, exist_ok=True)
    ff = R.find_ffmpeg()
    mat = os.path.join(wd, 'material.jpg')
    subprocess.run([ff, '-y', '-v', 'error', '-f', 'lavfi', '-i',
                    'gradients=s=768x1344:c0=0x2f2c30:c1=0x9c9284:x0=0:y0=0:x1=768:y1=1344:d=1',
                    '-frames:v', '1', mat], capture_output=True)
    # 素材镜要走到"卡片 + 富编排"（左图右文）需要**两件**：① `variant` ∈ 6 套 deck（哪几镜是 PPT 页，由 AI 写）
    # + ② `plate_opts()` 有值（本轮的 frame 缺省负责这一半）。A/B 只变 ②，① 固定 = deck-soft（cleanlight 的版式）。
    shots = {'after': {"type": "bgimage", "src": mat, "variant": "deck-soft", "kicker": "素材页",
                       "text": "左图右文", "items": ["素材铺左", "版式在右"],
                       "subtitle": "带素材的页型", "dur": 8.0},
             'before': {"type": "bgimage", "src": mat, "variant": "deck-soft", "frame": "none",
                        "kicker": "素材页", "text": "左图右文", "items": ["素材铺左", "版式在右"],
                        "subtitle": "带素材的页型", "dur": 8.0}}
    logs = {}
    for tag, shot in shots.items():
        p = os.path.join(wd, 'sb_%s.json' % tag)
        open(p, 'w', encoding='utf-8').write(json.dumps(
            {'size': [1280, 720], 'fps': 25, 'shots': [shot]}, ensure_ascii=False))
        od = os.path.join(wd, 'o_%s' % tag)
        r = subprocess.run([sys.executable, os.path.join(HERE, 'render.py'), '--storyboard', p,
                            '--style', 'cleanlight', '--ppt-preview', '--outdir', od],
                           capture_output=True, text=True, encoding='utf-8', errors='replace')
        logs[tag] = r.stdout or ''
        png = os.path.join(od, 'p01.png')
        if os.path.exists(png):
            import shutil
            shutil.copyfile(png, os.path.join(wd, 'cleanlight-material-%s.png' % tag))
    chk('素材页：layout=' in logs['after'] and 'DECK_FRAME_DEFAULT_V1' in logs['after'],
        '② AFTER（选了风格、没写 frame）：补了缺省 **且素材走卡片版式**',
        [l.strip()[:70] for l in logs['after'].splitlines()
         if 'FRAME_DEFAULT' in l or '素材页' in l][:2])
    chk('素材页条件不足' in logs['before'] and 'FRAME_DEFAULT_V1' not in logs['before'],
        "② BEFORE（显式 frame:'none'）：**不补** → 老实回落老链路（老板要关就能关）")
    pa = os.path.join(wd, 'cleanlight-material-after.png')
    pb = os.path.join(wd, 'cleanlight-material-before.png')
    chk(os.path.exists(pa) and os.path.exists(pb), '两帧都在（A/B 证据）', (pa, pb))


def main():
    wd = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'dist-rel', 'ppt-demo',
                                                            'material-frame')
    print('★VF_DECK_FRAME_DEFAULT_V1 护栏   render.py=%s' % os.path.join(HERE, 'render.py'))
    pure()
    frames(wd)
    print('\n输出目录：%s' % wd)
    print('===== 结果：%d PASS / %d FAIL =====' % (len(OK), len(NG)))
    for m in NG:
        print('  ✗ ' + m)
    return 1 if NG else 0


if __name__ == '__main__':
    sys.exit(main())
