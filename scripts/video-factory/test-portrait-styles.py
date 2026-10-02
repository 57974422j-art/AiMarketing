#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""★VF_PORTRAIT_SAMPLES_V1（2026-10-02）竖屏（9:16）5 套成品风格样张 + 总对照图（可复跑护栏）。

老板的产品**横竖屏都支持**（早期那几条片就是 720×1280），而 `public/style-preview/` 那 15 张是
**横屏**（界面按横屏引用）→ 竖屏只作"作证"用，刻意**不写 public/**（归属规则见 test-style-demo.py 头部）。

产物：`dist-rel/ppt-demo/portrait/<key>-portrait.png`（720×1280 ×5）+ `compare.png`（5 页并排）。
判据：① 每张都是 720×1280；② 5 个 key 齐全（= `VF_STYLES` 顺序）；③ 对照图存在且宽=5×300；
      ④ 每套的 `--style` 都真的生效（跑起来日志里有 `★VF_STYLES_V1 成品风格=<id>`）。

用法：python scripts/video-factory/test-portrait-styles.py [--outdir <目录>]
"""
import argparse
import json
import os
import shutil
import struct
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, HERE)

import render as R  # noqa: E402
from themes import STYLES  # noqa: E402

OK, NG = [], []


def chk(cond, msg, extra=''):
    (OK if cond else NG).append(msg)
    print('  %s %s%s' % ('[PASS]' if cond else '[FAIL]', msg, ('  ← ' + str(extra)) if extra else ''))


def png_size(p):
    with open(p, 'rb') as f:
        b = f.read(33)
    return struct.unpack('>II', b[16:24]) if b[:8] == b'\x89PNG\r\n\x1a\n' else (0, 0)


PLAN = {'size': [720, 1280], 'fps': 25,
        'shots': [{'type': 'title', 'variant': 'deck', 'kicker': '本地出片',
                   'text': '三步走完一条片', 'subtitle': '选题 / 脚本 / 成片',
                   'items': ['选题定位', '脚本生成', '一键成片'], 'page': '01', 'dur': 6.0}]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--outdir', default=os.path.join(ROOT, 'dist-rel', 'ppt-demo', 'portrait'))
    a = ap.parse_args()
    od = a.outdir
    os.makedirs(od, exist_ok=True)
    ff = R.find_ffmpeg()
    sbp = os.path.join(od, 'sb_portrait.json')
    with open(sbp, 'w', encoding='utf-8') as f:
        json.dump(PLAN, f, ensure_ascii=False)

    print('★VF_PORTRAIT_SAMPLES_V1 竖屏样张（720×1280 ×%d 套）→ %s' % (len(STYLES), od))
    made = []
    for sid, st in STYLES.items():
        _wd = os.path.join(od, '_od_' + sid)
        r = subprocess.run([sys.executable, os.path.join(HERE, 'render.py'), '--storyboard', sbp,
                            '--ppt-preview', '--outdir', _wd, '--style', sid],
                           capture_output=True, text=True, encoding='utf-8', errors='replace')
        log = (r.stdout or '') + (r.stderr or '')
        src = os.path.join(_wd, 'p01.png')
        dst = os.path.join(od, '%s-portrait.png' % sid)
        if r.returncode == 0 and os.path.exists(src):
            shutil.copyfile(src, dst)
            made.append((sid, st.get('name'), dst))
        shutil.rmtree(_wd, ignore_errors=True)
        chk('★VF_STYLES_V1 成品风格=%s' % sid in log,
            '--style %s（%s）真的生效（日志确认，不是静默回落）' % (sid, st.get('name')))
    chk(len(made) == len(STYLES) == 5, '5 套竖屏样张全部生成', [m[0] for m in made])
    chk(all(png_size(p) == (720, 1280) for _, _, p in made),
        '每张都是 720×1280（竖屏）', [png_size(p) for _, _, p in made])

    if made:
        _fc = ''.join("[%d:v]scale=300:533,drawtext=fontfile='%s':text=%s:fontsize=22:fontcolor=white:"
                      'box=1:boxcolor=black@0.55:boxborderw=8:x=10:y=10[v%d];'
                      % (i, R.font_bold(R.theme_of('news')),
                         R.esc_text('%s %s' % (nm, sid)), i)
                      for i, (sid, nm, p) in enumerate(made))
        _fc += ''.join('[v%d]' % i for i in range(len(made))) + 'hstack=inputs=%d[out]' % len(made)
        cmd = [ff, '-y', '-v', 'error']
        for _, _, p in made:
            cmd += ['-i', p]
        cmp_png = os.path.join(od, 'compare.png')
        cmd += ['-filter_complex', _fc, '-map', '[out]', cmp_png]
        r = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace')
        chk(r.returncode == 0 and png_size(cmp_png) == (1500, 533),
            '总对照图 compare.png = 5×300 并排（1500×533）',
            (r.returncode, png_size(cmp_png) if os.path.exists(cmp_png) else None))
    print('\n===== 结果：%d PASS / %d FAIL =====' % (len(OK), len(NG)))
    for m in NG:
        print('  ✗ %s' % m)
    return 1 if NG else 0


if __name__ == '__main__':
    sys.exit(main())
