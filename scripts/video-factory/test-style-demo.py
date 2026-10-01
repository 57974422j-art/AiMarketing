#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""★VF_STYLES_DEMO_V1（2026-10-01）5 套成品风格「总对照图」生成 + 自检。

为什么要有这个脚本：老板要**一眼挑**风格（5 套），而"一眼挑"必须每套都能看出差别 →
每套固定渲 **3 种页型**：① 标题+要点 ② 数据页（大数字+单位+标签+结论）③ 带素材页（左图右文）。
拼图按**套**分行（一行 = 一套的 3 页），每格角上烧「风格 · 页型」。

⚠️ 素材页为什么要显式写 `frame/shadow/float/wipe`：`render.py::plate_opts()` 的口径是
   **只有编辑风主题（news/data）默认启用"卡片版式"**；light/journal/mono 缺省 → `plate_opts=None`
   → 素材页会**回落老链路**（整幅虚化素材 + 居中大字，看不出 PPT 编排）。
   `frame:'thin'` 在白名单里（PICK_DESIGN_KEYS），显式写上就让 5 套都走"卡片 + 富编排"同一条路，
   对照才公平。（这是设计上的"编辑风专属"，不是 bug；服务端要非编辑风也出卡片版式，写 frame 即可。）

产物（默认）：`dist-rel/ppt-demo/unified/`
  · `<中文名>_1标题+要点.png` / `_2数据页.png` / `_3带素材页.png`（`<中文名>.png` = 第 1 页副本）
  · `compare.png` 5 行 × 3 列（每格 420×236，带角标）

用法：python scripts/video-factory/test-style-demo.py [--outdir <目录>]
"""
import argparse
import json
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, HERE)

import render as R  # noqa: E402
from themes import STYLES  # noqa: E402

PAGES = ['标题+要点', '数据页', '带素材页']
TITLE = {"type": "title", "kicker": "本地出片", "text": "三步走完一条片",
         "items": ["选题定位", "脚本生成", "一键成片"],
         "stats": [{"value": "128", "suffix": "%", "label": "转化率提升"}],
         "subtitle": "整条链路只需要三步", "dur": 8.0}
DATA = {"type": "number", "value": 128, "suffix": "%", "label": "转化率提升",
        "subtitle": "对比人工剪辑的提升幅度", "dur": 8.0}
OK, NG = [], []


def chk(cond, msg, extra=''):
    (OK if cond else NG).append(msg)
    print('  %s %s%s' % ('[PASS]' if cond else '[FAIL]', msg, ('  ← ' + str(extra)) if extra else ''))


def _png_size(p):
    import struct
    with open(p, 'rb') as f:
        head = f.read(33)
    if len(head) < 33 or head[:8] != b'\x89PNG\r\n\x1a\n':
        return (0, 0)
    return struct.unpack('>II', head[16:24])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--outdir', default=os.path.join(ROOT, 'dist-rel', 'ppt-demo', 'unified'))
    ap.add_argument('--wd', default='')
    a = ap.parse_args()
    OUT = a.outdir
    wd = a.wd or os.path.join(ROOT, 'dist-rel', 'ppt-demo', '_wd')   # 中间产物放外面，别脏了成品图目录
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(wd, exist_ok=True)
    ff = R.find_ffmpeg()

    mat = os.path.join(OUT, 'material.jpg')
    subprocess.run([ff, '-y', '-v', 'error', '-f', 'lavfi', '-i',
                    'gradients=s=768x1344:c0=0x2f2c30:c1=0x9c9284:x0=0:y0=0:x1=768:y1=1344:d=1',
                    '-frames:v', '1', mat], capture_output=True)
    chk(os.path.exists(mat), '样例素材图生成（竖图 768×1344 → 触发左图右文）')

    material_shot = {"type": "bgimage", "src": mat, "kicker": "素材页",
                     "frame": "thin", "shadow": "soft", "float": "slow", "wipe": "left",
                     "text": "左图右文", "items": ["素材铺左", "版式在右"],
                     "subtitle": "带素材的页型", "dur": 8.0}

    tiles, labels = [], []
    for sid, st in STYLES.items():
        shots = [dict(TITLE), dict(DATA), dict(material_shot, variant=st['deck'])]
        sbp = os.path.join(wd, 'sb3_%s.json' % sid)
        open(sbp, 'w', encoding='utf-8').write(json.dumps(
            {'size': [1280, 720], 'fps': 25, 'shots': shots}, ensure_ascii=False))
        od = os.path.join(wd, 'o3_%s' % sid)
        r = subprocess.run([sys.executable, os.path.join(HERE, 'render.py'), '--storyboard', sbp,
                            '--style', sid, '--ppt-preview', '--outdir', od],
                           capture_output=True, text=True, encoding='utf-8', errors='replace')
        out = r.stdout or ''
        chk('素材页：layout=' in out and '素材页条件不足' not in out,
            '%s：素材页走**卡片+富编排**（不是回落老链路）' % sid,
            [l.strip() for l in out.splitlines() if '素材页' in l][:1])
        row = []
        for k in (1, 2, 3):
            src = os.path.join(od, 'p%02d.png' % k)
            if not os.path.exists(src):
                row.append(None)
                continue
            dst = os.path.join(OUT, '%s_%d%s.png' % (st['name'], k, PAGES[k - 1]))
            shutil.copyfile(src, dst)
            row.append(dst)
            if k == 1:
                shutil.copyfile(src, os.path.join(OUT, '%s.png' % st['name']))
        tiles.append(row)
        labels.append(st['name'])
    chk(all(all(x for x in row) for row in tiles), '5 套 × 3 页 = 15 张 PNG 全部生成')
    _bad = [(labels[i], PAGES[j]) for i, row in enumerate(tiles) for j, p in enumerate(row)
            if not p or _png_size(p) != (1280, 720)]
    chk(not _bad, '15 张都是 1280×720', str(_bad))

    # ── 总对照图：一行 = 一套（3 列 = 3 页型），每格角上烧「风格 · 页型」──
    TW, TH, COLS = 420, 236, 3
    font = R.esc_path(R.find_font('msyhbd') or R.find_font('msyh'))
    fc, ins, n = [], [], 0
    for r_i, row in enumerate(tiles):
        for c_i, p in enumerate(row):
            if not p:
                continue
            fc.append("[%d:v]scale=%d:%d,drawtext=fontfile='%s':text='%s · %s':fontsize=19:"
                      "fontcolor=white:borderw=3:bordercolor=black@0.85:x=12:y=8[v%d]"
                      % (n, TW, TH, font, labels[r_i], PAGES[c_i], n))
            ins.append('[v%d]' % n)
            n += 1
    if len(ins) == 15:
        layout = '|'.join('%d_%d' % ((i % COLS) * TW, (i // COLS) * TH) for i in range(len(ins)))
        fc.append('%sxstack=inputs=%d:layout=%s:fill=0x101010[out]' % (''.join(ins), len(ins), layout))
        argv = [ff, '-y', '-v', 'error']
        for row in tiles:
            for p in row:
                argv += ['-i', p]
        cmp_png = os.path.join(OUT, 'compare.png')
        argv += ['-filter_complex', ';'.join(fc), '-map', '[out]', '-frames:v', '1', cmp_png]
        subprocess.run(argv, capture_output=True)
        chk(os.path.exists(cmp_png) and _png_size(cmp_png) == (TW * COLS, TH * 5),
            '对照图 compare.png = %d×%d（5 行 × 3 列）' % (TW * COLS, TH * 5), str(_png_size(cmp_png)))
    else:
        chk(False, '页数不足 15，跳过对照图', str(n))

    print('\n输出目录：%s' % OUT)
    print('===== 结果：%d PASS / %d FAIL =====' % (len(OK), len(NG)))
    for m in NG:
        print('  ✗ ' + m)
    return 1 if NG else 0


if __name__ == '__main__':
    sys.exit(main())
