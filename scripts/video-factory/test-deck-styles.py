#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""★VF_DECK_STYLES_V1（2026-10-01）4 套富编排 PPT 风格的**真渲演示 + 逐像素验证**

用户原话（本轮设计依据）：
  「1-2 都要（既要接进 AI，也要多做模版）。默认一套经典通用，然后先加几个不同风格。
    注意配合配色真的不能太 AI 味。最好有渐变色。还有就是透明度。
    前面很多大字下面都有一个透明黑框（=不喜欢那个实心半透明黑框）。」

本脚本做三件事（全部纯 FFmpeg，零成本、不联网）：
  ① 用**用户真实素材**给 4 套风格各渲 1 页（8s）→ dist-rel/ppt-demo/styles/<style>.mp4
     每页再抽 2 帧：t=1.0「入场中」/ t=6.5「全就位」→ dist-rel/ppt-demo/styles/frames/
  ② 「渐变风」的**真·逐像素渐变**验证：渲一页纯文字 deck-grad（底板走 lavfi gradients），
     在同一帧上沿列取 4 点 —— 颜色值必须不同且**单调过渡**（不是两块纯色叠）。
  ③ 「大字黑框 before/after」对照帧 → dist-rel/ppt-demo/framebox/
     before = VF_TEXTBOX_LEGACY=1（还原老的 `box=1:boxcolor=black@0.30` 实心黑框）
     after  = 默认（描边 + 阴影 + 底部渐隐蒙版）
     并在文字块**上边缘**取一个像素：老黑框那里是暗的、新蒙版那里几乎全透 —— 这就是"去框"的量化证据。

跑法：
  python scripts/video-factory/test-deck-styles.py          # 渲全部（本机约 1~2 分钟）
  python scripts/video-factory/test-deck-styles.py --only deck-grad
"""
import argparse
import json
import os
import re as _re
import subprocess
import sys
import tempfile

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)
_ROOT = os.path.dirname(os.path.dirname(_HERE))
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

import render as R                                       # noqa: E402

MAT = 'E:/ai-marketing/storage/1/20260922_002.jpg'       # 用户真实素材（768x1344 竖图）
OUT = os.path.join(_ROOT, 'dist-rel', 'ppt-demo', 'styles')
BOXDIR = os.path.join(_ROOT, 'dist-rel', 'ppt-demo', 'framebox')

# (variant, 主题, 是否强制 frame) —— 非编辑风主题（tech/light）需要显式 frame 才会走卡片版式
STYLES = [
    ('deck', 'tech', 'thin'),
    ('deck-grad', 'news', ''),
    ('deck-mono', 'light', 'thin'),
    ('deck-mag', 'data', ''),
]


def _ffmpeg():
    return R.find_ffmpeg()


def _render(sb, out_path, wd, env=None):
    os.makedirs(wd, exist_ok=True)
    sbp = os.path.join(wd, 'sb.json')
    with open(sbp, 'w', encoding='utf-8') as f:
        json.dump(sb, f, ensure_ascii=False)
    e = dict(os.environ)
    e.update(env or {})
    r = subprocess.run([sys.executable, os.path.join(_HERE, 'render.py'),
                        '--storyboard', sbp, '--out', out_path, '--no-subs',
                        '--workdir', os.path.join(wd, 'wd')],
                       cwd=_HERE, env=e, capture_output=True)
    if r.returncode != 0 or not os.path.exists(out_path):
        print('[demo] ❌ 渲染失败：%s\n%s' % (out_path, r.stderr.decode('utf-8', 'replace')[-1200:]))
        return False
    return True


def _frame(ff, video, t, out_png):
    subprocess.run([ff, '-v', 'error', '-y', '-ss', '%.2f' % t, '-i', video,
                    '-frames:v', '1', out_png], capture_output=True)
    return os.path.exists(out_png)


def _px(ff, video, t, x, y):
    """取某一秒某点的 RGB（不依赖 PIL：ffmpeg 裁出来再读 rawvideo）。

    ⚠️ 必须裁 **2x2** 而不是 1x1：本机实测 1x1 会报 `Invalid too big or non positive size`
    （yuv420p 的色度是 2x2 采样，奇数尺寸的裁剪取不出来）。取 2x2 的左上角即可。"""
    r = subprocess.run([ff, '-v', 'error', '-ss', '%.2f' % t, '-i', video,
                        '-vf', 'crop=2:2:%d:%d' % (int(x), int(y)), '-frames:v', '1',
                        '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True)
    b = r.stdout[:3]
    return tuple(b) if len(b) == 3 else None


def _lum(c):
    return R._lum_of('0x%02x%02x%02x' % c)


def _px_region(ff, video, t, x, y, w, h):
    """取一块区域的**平均** RGB（crop 出区域 → 缩到 2x2 → 读 4 个像素取均值）。

    为什么用区域均值而不是单点：素材是低频暗图，单点噪声大；"黑框在不在"要用块统计才稳。"""
    r = subprocess.run([ff, '-v', 'error', '-ss', '%.2f' % t, '-i', video,
                        '-vf', 'crop=%d:%d:%d:%d,scale=2:2' % (int(w), int(h), int(x), int(y)),
                        '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
                       capture_output=True)
    b = r.stdout
    if len(b) < 12:
        return None
    px = [tuple(b[i:i + 3]) for i in (0, 3, 6, 9)]
    return tuple(sum(p[k] for p in px) // 4 for k in range(3))


def _shot(style, theme, frame):
    s = {
        'type': 'bgimage', 'src': MAT, 'variant': style, 'theme': theme, 'dur': 8,
        'kicker': 'AI 营销', 'text': '三步跑通一条片',
        'sub': '不需要剪辑经验，只需要选题',
        'items': ['选题：AI 出大纲 + 钩子', '成片：本地渲染，竖横都行', '分发：一次发到 11 个平台'],
        'stats': [{'value': '3', 'suffix': '步', 'label': '全流程'},
                  {'value': '15', 'suffix': '分钟', 'label': '单条耗时'}],
        'page': '01 / 04',
        'subtitle': '三步跑通一条片',
    }
    if frame:
        s['frame'] = frame
    return s


def _flatbg_shot():
    """纯文字 deck-grad 页（没有素材遮拦）→ 用来在**同一帧**上验证底板是真·逐像素渐变。"""
    return {
        'type': 'title', 'variant': 'deck-grad', 'theme': 'news', 'dur': 8,
        'kicker': '渐变风', 'text': '渐变是真的',
        'sub': '上亮下暗，逐像素过渡',
        'items': ['底板走 lavfi gradients', '卡片/标签条走多段渐变色带'],
        'stats': [{'value': '2', 'suffix': '种', 'label': '渐变实现'}],
        'page': '01 / 01',
        'subtitle': '渐变是真的',
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', default='', help='只渲某一套（deck / deck-grad / deck-mono / deck-mag）')
    a = ap.parse_args()
    ff = _ffmpeg()
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(os.path.join(OUT, 'frames'), exist_ok=True)
    os.makedirs(BOXDIR, exist_ok=True)
    print('[demo] ffmpeg = %s' % ff)
    print('[demo] 素材 = %s（尺寸 %s / 体检 %s）' % (MAT, R._probe_size(MAT), R._probe_material(MAT)))

    wd = tempfile.mkdtemp(prefix='vf-deck-demo-')
    made = []
    for style, theme, frame in STYLES:
        if a.only and a.only != style:
            continue
        mp4 = os.path.join(OUT, '%s.mp4' % style)
        sb = {'size': [1280, 720], 'fps': 25, 'theme': theme, 'shots': [_shot(style, theme, frame)]}
        print('\n[demo] 渲染 %s（主题 %s）→ %s' % (style, theme, mp4))
        if not _render(sb, mp4, os.path.join(wd, style)):
            continue
        made.append((style, mp4))
        fdir = os.path.join(OUT, 'frames')
        # 入场中 = t=1.0（kicker/标题刚出来、要点还在逐条插入）；全就位 = t=7.6
        # （取 7.6 而不是 6.5：数据块的 eif 计数约在 6.6s 才跑满，否则"3 步"会抽到"2 步"）
        _frame(ff, mp4, 1.0, os.path.join(fdir, '%s_t1.0_entry.png' % style))
        _frame(ff, mp4, 7.6, os.path.join(fdir, '%s_t7.6_full.png' % style))
        print('[demo]   抽帧：t=1.0 入场中 / t=6.5 全就位 → %s' % fdir)

    # ── ② 渐变像素验证（纯文字 deck-grad 页，同一帧沿列取点）────────────────
    if not a.only or a.only == 'deck-grad':
        mp4 = os.path.join(OUT, 'deck-grad-flatbg.mp4')
        sb = {'size': [1280, 720], 'fps': 25, 'theme': 'news', 'shots': [_flatbg_shot()]}
        print('\n[demo] 渲染 deck-grad-flatbg（纯文字，验底板渐变）→ %s' % mp4)
        if _render(sb, mp4, os.path.join(wd, 'flatbg')):
            _frame(ff, mp4, 6.5, os.path.join(OUT, 'frames', 'deck-grad-flatbg_t6.5.png'))
            # 采样线取 x=40（版面左边界 0.085W 之外的**纯背景**，没有任何元素压在上面）；
            # 沿 y 从上到下 —— 底板是 lavfi gradients 的**竖向**逐像素渐变（x0,y0=0,0 → x1,y1=0,H）。
            # 取 y = 6 / 186 / 366 / 486（全在左侧纯背景列上，且都在 y≈504 起的"底部光晕带"之上
            # —— 那条带会叠一点 accent，取到里面会让最末一点亮度轻微回升，破坏单调）。
            ys = [6, 186, 366, 486]
            samples = [(y, _px(ff, mp4, 6.5, 40, y)) for y in ys]
            print('[demo] ── 逐像素证明（同一帧 t=6.5，x=40 沿 y 取 4 点；底板 = lavfi gradients）──')
            for y, c in samples:
                print('[demo]    y=%4d → RGB %s  亮度 %s' % (y, c, _lum(c) if c else '?'))
            _lums = [_lum(c) for _, c in samples if c]
            # x264 是有损编码 → 允许多 1 个亮度单位的抖动，"单调"按 ±1 判
            _mono = (all(_lums[i] >= _lums[i + 1] - 1 for i in range(len(_lums) - 1)) or
                     all(_lums[i] <= _lums[i + 1] + 1 for i in range(len(_lums) - 1)))
            _spread = (max(_lums) - min(_lums)) if _lums else 0
            print('[demo]   → 亮度序列 %s：单调(±1)=%s / 跨度=%d' % (_lums, _mono, _spread))
            print('[demo]   → %s 真渐变（跨远处两点值不同 + 整条序列单调过渡，不是两块纯色叠）'
                  % ('✅' if (_mono and _spread >= 25) else '❌'))
            # 元素层（卡片/标签条）的渐变也验一次：直接用生产的 grad_box_filters 渲一帧再采样，
            #   —— 这一段是纯 drawbox，完全确定性；证明"卡片真的不是两块纯色叠"。
            _gt = os.path.join(wd, 'gradbox_test.png')
            _gvf = ','.join(R.grad_box_filters(0, 0, 1280, 240, '0x1b3a5e', '0xe8f0f8', steps=10))
            subprocess.run([ff, '-v', 'error', '-y', '-f', 'lavfi',
                            '-i', 'color=c=black:s=1280x240:d=1', '-vf', _gvf,
                            '-frames:v', '1', _gt], capture_output=True)
            _gs = [_px(ff, _gt, 0, 640, y) for y in (10, 70, 130, 190, 235)]
            _gl = [_lum(c) for c in _gs if c]
            _gm = (all(_gl[i] <= _gl[i + 1] for i in range(len(_gl) - 1)) or
                   all(_gl[i] >= _gl[i + 1] for i in range(len(_gl) - 1)))
            print('[demo] ── 元素层渐变（生产同款 grad_box_filters=10 段，同一帧沿 y 取 5 点）──')
            print('[demo]    亮度 %s → 单调=%s / 跨度=%d → %s'
                  % (_gl, _gm, (max(_gl) - min(_gl)) if _gl else 0,
                     '✅ 卡片/标签条的渐变是真的（逐段单调过渡）' if (_gm and _gl and
                                                                  max(_gl) - min(_gl) >= 60) else '❌'))

    # ── ③ 大字黑框 before / after 对照帧 ────────────────────────────────────
    # 用**用户真实素材 + 用户真实场景**（深色素材，满字让位）—— 这正是用户看到"透明黑框"的那一镜：
    #   旧的：大字各带一个 `box=1:boxcolor=black@0.48` 实心框 + 一条 `black@0.62` 实心通栏黑带；
    #   新的：描边 + 阴影 + 底部渐隐蒙版 + 上下渐隐的蒙版带。
    box_shot = {
        'type': 'bgimage', 'src': MAT, 'theme': 'dark', 'dur': 5,
        'text': '供应链卡住了',
        'subtitle': '供应链卡住了整条产线',
    }
    sb = {'size': [1280, 720], 'fps': 25, 'theme': 'dark', 'shots': [dict(box_shot)]}
    before = os.path.join(BOXDIR, 'box_before.mp4')
    after = os.path.join(BOXDIR, 'box_after.mp4')
    print('\n[demo] 渲黑框对照帧（before/after）→ %s' % BOXDIR)
    ok_b = _render(sb, before, os.path.join(wd, 'box_b'), env={'VF_TEXTBOX_LEGACY': '1'})
    ok_a = _render(sb, after, os.path.join(wd, 'box_a'))
    if ok_b and ok_a:
        _frame(ff, before, 4.0, os.path.join(BOXDIR, 'box_before.png'))
        _frame(ff, after, 4.0, os.path.join(BOXDIR, 'box_after.png'))
        # 量化：在"文字块上边缘那一横条"取区域均值 —— 老黑框从四周等 alpha 一路盖到那里（压暗），
        #   新蒙版的上端 alpha≈amax*(1/7)²≈0.01（几乎全透）→ 该条应该明显更亮。
        fs = R.big_fs(1280, 720, 0.10, 54)
        _mat = R._probe_material(MAT)
        _busy = _mat.get('edge', 0) > 0.10 or (
            _mat.get('lum', 160) < 78 and (_mat.get('flat', 0) > 0.22 or _mat.get('edge', 0) > 0.055))
        _yoff = int(720 * 0.13) if _busy else 0
        y_top = int(720 * 0.5 + _yoff - fs * 0.78) + 2        # 文字块上边缘（与 _reveal_seq 同几何）
        rb = _px_region(ff, before, 4.0, 150, y_top, 980, 8)
        ra = _px_region(ff, after, 4.0, 150, y_top, 980, 8)
        print('[demo] ── 文字块上边缘横条（x 150~1130, y %d~%d）区域均值 ──' % (y_top, y_top + 8))
        print('[demo]   before（老：实心半透明黑框 + 实心通栏黑带）RGB %s 亮度 %s'
              % (rb, _lum(rb) if rb else '?'))
        print('[demo]   after （新：描边+阴影+底部渐隐蒙版 + 上下渐隐带）RGB %s 亮度 %s'
              % (ra, _lum(ra) if ra else '?'))
        # 定量证据 A（定义级）：滤镜串里"实心框"有没有
        os.environ['VF_TEXTBOX_LEGACY'] = '1'
        _vfb = R.card_bgimage(dict(box_shot), R.theme_of('dark'), 1280, 720, 25)[1]
        os.environ.pop('VF_TEXTBOX_LEGACY', None)
        _vfa = R.card_bgimage(dict(box_shot), R.theme_of('dark'), 1280, 720, 25)[1]
        print('[demo] ── 定量证据 ──')
        print('[demo]   before 滤镜串含 `box=1:boxcolor=black@0.48`：%s' % ('box=1:boxcolor' in _vfb))
        print('[demo]   after  滤镜串含 `box=1:boxcolor=black@0.48`：%s' % ('box=1:boxcolor' in _vfa))
        print('[demo]   after  改用渐隐蒙版（%d 段 drawbox 淡入式底衬）：%s'
              % (_vfa.count('drawbox'), 'shadowx=2' in _vfa))
        # 定量证据 B（像素级）：两帧整体 PSNR（有限 = 确实不一样；该素材本身近黑，所以差异幅度有限）
        _ps = subprocess.run([ff, '-v', 'info', '-i', before, '-i', after,
                              '-lavfi', 'psnr', '-f', 'null', '-'], capture_output=True)
        _txt = _ps.stderr.decode('utf-8', 'replace')
        _m = _re.search(r'average:([\d.inf]+)', _txt)
        print('[demo]   before/after 两帧 PSNR = %s（有限值 = 画面确实变了；'
              '素材近黑所以差异幅度不大，主要看框的形状有没有了）' % (_m.group(1) if _m else '?'))
    print('\n[demo] 产物：')
    for style, mp4 in made:
        print('   %s' % mp4)
    for f in ('deck-grad-flatbg.mp4',):
        p = os.path.join(OUT, f)
        if os.path.exists(p):
            print('   %s' % p)
    print('   %s' % os.path.join(OUT, 'frames'))
    print('   %s' % BOXDIR)
    return 0


if __name__ == '__main__':
    sys.exit(main())
