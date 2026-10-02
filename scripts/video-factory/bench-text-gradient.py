#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""★VF_TEXTGRAD_V1 耗时实测（2026-10-02 老板「字体太单调了 就一种而且没渐变」）。

老板要求：**先给"单页多花多少毫秒"的实测数字，再决定铺到哪些元素**。

三种画法（都在 1280×720 / 单帧、只测"文字这一层"的增量）：
  A 基线      ：1 条 drawtext（现状）
  B 廉价近似  ：同字 2 条 drawtext（上层浅色 + 下层本色下移 2px）＝"上浅下深"
  C 真渐变    ：白字 → `alphaextract` 取字形遮罩 → 与 `gradients` 源 `alphamerge` → `blend` 叠回
                （两路输入 + 四段滤镜；只有这个能做出真正的多色渐变）

用法：python scripts/video-factory/bench-text-gradient.py [--n 6]
"""
import argparse
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import render as R  # noqa: E402

W, H = 1280, 720
FONT = R.esc_path(R.find_font('msyhbd') or R.find_font('msyh'))
TXT = '三步走完一条片'
FS = 96
BASE = 'color=c=0x0b1622:s=%dx%d:d=1' % (W, H)
DT = ("drawtext=fontfile='%s':text='%s':fontsize=%d:fontcolor=%%s:"
      "x=(w-text_w)/2:y=(h-text_h)/2") % (FONT, TXT, FS)


def recipes():
    _lo = R._shade('0xffffff', 0.86)
    return {
        'A 基线(1 条 drawtext)': {
            'argv': ['-f', 'lavfi', '-i', BASE, '-vf', DT % 'white'],
            'n_filter': 1,
        },
        'B 廉价近似(同字 2 条，上浅下深)': {
            'argv': ['-f', 'lavfi', '-i', BASE, '-vf',
                     (DT % 'white') + ',' + (DT % _lo).replace('y=(h-text_h)/2', 'y=(h-text_h)/2+2')],
            'n_filter': 2,
        },
        'C 真渐变(alphaextract+alphamerge+blend)': {
            'argv': ['-f', 'lavfi', '-i', BASE,
                     '-f', 'lavfi', '-i',
                     'gradients=s=%dx%d:c0=0xffffff:c1=0x2f7cf6:x0=0:y0=0:x1=%d:y1=%d:d=1' % (W, H, W, H),
                     '-filter_complex',
                     '[0:v]%s,format=gray,alphaextract[mk];[1:v][mk]alphamerge[gt];'
                     '[0:v][gt]blend=all_mode=screen,format=yuv420p' % (DT % 'white'),
                     '-map', '[mk]' if False else '0:v:0'],
            'n_filter': 4,
        },
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--n', type=int, default=6)
    a = ap.parse_args()
    ff = R.find_ffmpeg()
    print('★VF_TEXTGRAD_V1 实测  帧=%dx%d 字号=%d 文本=%s  每档跑 %d 次取中位数\n'
          % (W, H, FS, TXT, a.n))
    rows = []
    for name, r in recipes().items():
        # C 档要用 -filter_complex（两路输入）；A/B 走 -vf
        if 'C' in name:
            # 正确配方（三轮才调对）：① 真实底 ② **透明底上的白字**（必须有 alpha 才能取遮罩）
            #   ③ gradients 源；`[1:v]drawtext→alphaextract` 得到字形遮罩 → 与渐变 alphamerge
            #   → overlay 盖回底图。alphaextract 在"无 alpha 的输入"上会报
            #   `Requested planes not available`（第一版就这么挂的，已在本文件里留痕）。
            argv = [ff, '-y', '-v', 'error',
                    '-f', 'lavfi', '-i', BASE,
                    '-f', 'lavfi', '-i',
                    'color=c=black@0.0:s=%dx%d:d=1,format=rgba' % (W, H),
                    '-f', 'lavfi', '-i',
                    'gradients=s=%dx%d:c0=0xffffff:c1=0x2f7cf6:x0=0:y0=0:x1=%d:y1=%d:d=1' % (W, H, W, H),
                    '-filter_complex',
                    '[1:v]%s,format=rgba[tx];[tx]alphaextract[mk];[2:v][mk]alphamerge[gt];'
                    '[0:v][gt]overlay,format=yuv420p[out]' % (DT % 'white'),
                    '-map', '[out]']
        else:
            argv = [ff, '-y', '-v', 'error'] + r['argv']
        argv += ['-frames:v', '1', '-f', 'null', '-']
        ts = []
        err = ''
        for _ in range(a.n):
            t0 = time.perf_counter()
            p = subprocess.run(argv, capture_output=True)
            ts.append((time.perf_counter() - t0) * 1000.0)
            if p.returncode != 0:
                err = (p.stderr or b'').decode('utf-8', 'replace')[:160]
        ts.sort()
        med = ts[len(ts) // 2]
        rows.append((name, med, ts[0], ts[-1], err))
    base = rows[0][1]
    print('%-42s %9s %9s %9s %10s' % ('画法', '中位 ms', '最快', '最慢', '相对基线'))
    for name, med, lo, hi, err in rows:
        print('%-42s %9.1f %9.1f %9.1f %9s%s'
              % (name, med, lo, hi, ('+%.1f%%' % ((med - base) / base * 100.0)) if base else '-',
                 ('  ❌ ' + err) if err else ''))
    print('\n⚠️ 说明：C 档多一路 lavfi 输入与 alphamerge/blend —— 上表是**单帧**增量；'
          '整片要 ×(镜数×帧数) 才是总开销（例：60s/25fps=1500 帧）。')


if __name__ == '__main__':
    main()
