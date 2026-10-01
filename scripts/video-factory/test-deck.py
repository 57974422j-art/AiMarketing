#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""★VF_DECK_V1 演示生成器（2026-10-01，deck-ui / 渲染层）

用途：**用用户自己的素材**跑一条 0 成本演示（不联网、不调 AI、不烧点），让用户直接看到
「富编排 PPT 页」+「持续型动效」到底能到什么效果，并自动抽帧留证。

产出（全部在 dist-rel/ppt-demo/）：
  deck_land.mp4        横屏 1280×720 一页 deck（竖素材 → 左图右文）
  deck_port.mp4        竖屏 720×1280 一页 deck（素材 → 上图下文）
  sustain_demo.mp4     持续动效专测：标题卡(慢生长/呼吸/进度线) + 素材卡(卡片浮动×2) + 数字卡(滚动/呼吸)
  frames/              每条的抽帧 png（文件名带 t=秒，一眼看出"哪一秒演什么"）
  sb_*.json            三条的原始分镜（可复现）

用法：
  python scripts/video-factory/test-deck.py            # 生成 + 渲染 + 抽帧
  python scripts/video-factory/test-deck.py --frames-only   # 只对已有成片重抽帧
"""
import argparse
import json
import os
import shutil
import subprocess
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(os.path.dirname(_HERE))
sys.path.insert(0, _HERE)
# Windows 控制台默认 GBK，打印 ✅/❌/中文会 UnicodeEncodeError（本机实测）→ 统一 UTF-8
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

OUT_DIR = os.path.join(_ROOT, 'dist-rel', 'ppt-demo')
FRAME_DIR = os.path.join(OUT_DIR, 'frames')
# 用户素材（真实存在；三条都是竖图）
IMG_A = 'E:/ai-marketing/storage/1/20260922_002.jpg'          # 768×1344
IMG_B = 'E:/ai-marketing/storage/1/frame_1790042537721_f3.jpg'  # 640×1138

# ── 演示分镜 ────────────────────────────────────────────────────────────────
SB_LAND = {
    'size': [1280, 720], 'fps': 25, 'theme': 'news',
    'shots': [{
        'type': 'bgimage', 'variant': 'deck', 'src': IMG_A, 'dur': 8,
        'kicker': 'AI 营销',
        'text': 'AI 营销内容系统',
        'sub': '从选题到成片，一条流水线跑完',
        'items': ['智能选题：一次生成 30 条脚本',
                  '一键成片：本地渲染零等待',
                  '自动分发：多平台同步发布'],
        'stats': [{'value': '8.5%', 'label': '平均点击率'},
                  {'value': '150', 'suffix': '万', 'label': '累计曝光'}],
        'page': '01 / 02',
        'subtitle': '一套系统跑完从选题到分发的全流程',
    }],
}

SB_PORT = {
    'size': [720, 1280], 'fps': 25, 'theme': 'data',
    'shots': [{
        'type': 'bgimage', 'variant': 'deck', 'src': IMG_B, 'dur': 8,
        'kicker': '成果数据',
        'text': '一条脚本的成本',
        'sub': 'AI 生成 + 本地渲染，零人工干预',
        'items': ['脚本开发：3 天 → 10 分钟',
                  '成片耗时：4 小时 → 6 分钟',
                  '分发覆盖：11 个平台同步'],
        'stats': [{'value': '8.5%', 'label': '平均点击率'},
                  {'value': '150', 'suffix': '万', 'label': '累计曝光'}],
        'page': '02 / 02',
        'subtitle': '把成本和耗时的变化摆在一页里',
    }],
}

# 纯文字 deck 页（无素材）—— 正好是用户说的「单独设计的 PPT 动效页」，
# 也把"deck 走 title 卡（纯色底 + stage 质感底）"这条路径真渲一遍（另一种入口）。
SB_PLAIN = {
    'size': [1280, 720], 'fps': 25, 'theme': 'tech',
    'shots': [{
        'type': 'title', 'variant': 'deck', 'dur': 8,
        'kicker': '工作流',
        'text': '三步跑通一条片',
        'sub': '不需要剪辑经验，只需要选题',
        'items': ['选题：AI 出大纲 + 钩子',
                  '成片：本地渲染，竖横都行',
                  '分发：一次发到 11 个平台'],
        'stats': [{'value': '3', 'suffix': '步', 'label': '全流程'},
                  {'value': '15', 'suffix': '分钟', 'label': '单条耗时'}],
        'page': '附页 · 流程',
        'subtitle': '三步跑通一条片',
    }],
}

# 持续动效专测：三条不同卡型各 6s，专门给 A1/A2/A3/A4 留证
SB_SUSTAIN = {
    'size': [1280, 720], 'fps': 25, 'theme': 'blue',
    'shots': [
        # ⚠️ 别在文案里用 ASCII 双引号（"）：render.py 的 cmd 是 `-vf "…"` 双引号包裹，
        #    文案里的 " 会把参数提前闭合 → ffmpeg rc=1（本机实测踩过）→ 用「」代替。
        {'type': 'title', 'text': '动效不再静止', 'dur': 6,
         'motion': 'fade', 'enter': 'up',
         'subtitle': '强调条 2.8 秒慢生长 + 大字呼吸 + 底部进度线'},
        {'type': 'bgimage', 'theme': 'news', 'src': IMG_A, 'dur': 6,
         'kicker': '卡片浮动', 'text': '素材卡一直在慢慢漂',
         'subtitle': 'B 组卡片版式浮动振幅 ×2（旧 10px → 新 20px）'},
        {'type': 'number', 'value': 150, 'suffix': '万', 'label': '累计曝光', 'dur': 4,
         'subtitle': '数字滚动到底后转入轻微呼吸'},
    ],
}

JOBS = [
    ('deck_land', SB_LAND, {'0.6': None, '1.4': None, '3.2': None, '7.4': None}),
    ('deck_port', SB_PORT, {'0.6': None, '1.4': None, '3.2': None, '7.4': None}),
    ('deck_plain', SB_PLAIN, {'0.6': None, '1.4': None, '3.2': None, '7.4': None}),
    ('sustain_demo', SB_SUSTAIN, {'1.0': None, '3.5': None, '5.5': None, '7.5': None,
                                  '9.5': None, '11.5': None, '13.0': None, '15.5': None}),
]


def find_ffmpeg():
    cands = [os.environ.get('FFMPEG_PATH', ''),
             os.path.join(os.environ.get('LOCALAPPDATA', ''), 'Microsoft', 'WinGet', 'Links', 'ffmpeg.exe'),
             'C:/ffmpeg/bin/ffmpeg.exe', '/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg']
    for c in cands:
        if c and os.path.exists(c):
            return c
    r = shutil.which('ffmpeg')
    return r or 'ffmpeg'


def run(cmd, cwd=None):
    print('  $ ' + ' '.join(cmd[:6]) + (' …' if len(cmd) > 6 else ''))
    r = subprocess.run(cmd, cwd=cwd)
    return r.returncode


def extract_frames(name, times):
    """用项目自带诊断工具抽帧（node scripts/vf-local.mjs --frames … --t … --wd …）"""
    mp4 = os.path.join(OUT_DIR, name + '.mp4')
    if not os.path.exists(mp4):
        print('  ❌ 没有成片，跳过抽帧: %s' % mp4)
        return
    wd = os.path.join(FRAME_DIR, name)
    os.makedirs(wd, exist_ok=True)
    run(['node', os.path.join(_ROOT, 'scripts', 'vf-local.mjs'),
         '--frames', mp4, '--t', ','.join(times), '--wd', wd], cwd=_ROOT)


def _rgb(ff, path, t, W, H):
    """抽一帧成 rawvideo rgb24（用于"用像素自证动效"，不依赖肉眼看）。"""
    r = subprocess.run([ff, '-v', 'error', '-ss', str(t), '-i', path, '-frames:v', '1',
                        '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True)
    return r.stdout if len(r.stdout) >= W * H * 3 else None


def _blue(p):
    r, g, b = p[0], p[1], p[2]
    return b > 150 and b > r + 60 and g > r and r < 150


def _blue_count(buf, W, y):
    return sum(1 for x in range(W) if _blue(buf[(y * W + x) * 3:(y * W + x) * 3 + 3]))


def verify():
    """★用**成片像素**自证 A1/A3/A4 真的在动（不只看滤镜串）。

    为什么值得做：drawbox 的 w/h 只在初始化求值一次 = 假动画（本项目踩过）。所以这些
    断言必须落到"抽帧后像素真的变了"上，而不是"代码里写了表达式"。
    """
    ff = find_ffmpeg()
    mp4 = os.path.join(OUT_DIR, 'sustain_demo.mp4')
    if not os.path.exists(mp4):
        print('  （没有 sustain_demo.mp4，跳过像素自证）')
        return
    W, H = 1280, 720
    print('\n' + '=' * 74)
    print('★ 像素自证（读成片；sustain_demo 1280×720）')
    ts = (0.6, 1.6, 3.0, 5.5)
    bar, prog = {}, {}
    for t in ts:
        b = _rgb(ff, mp4, t, W, H)
        if not b:
            continue
        # A1：强调条所在行 —— 在 16%~45%H 里找"从 x≈0.10W 起、连续的一段蓝"，
        #   用它的**长度**当条宽。（⚠️ 别在整个 10%~25% 里取 max(x)：VF_STAGE 的左上小装饰段
        #   也是强调色、会污染测量 —— 本机实测第一版就量出了恒定的 255。）
        bx = 0
        for y in range(int(H * 0.16), int(H * 0.45)):
            xs = [x for x in range(W) if _blue(b[(y * W + x) * 3:(y * W + x) * 3 + 3])]
            if not xs:
                continue
            _run = max(xs) - min(xs) + 1
            if 100 <= min(xs) <= 200 and _run < int(W * 0.25) and _run > bx:
                bx = _run
        bar[t] = bx
        # A4：最底一行里"蓝像素"个数 ≈ 进度线已经走了多宽
        prog[t] = _blue_count(b, W, H - 5)
    _ks = sorted(bar)
    if _ks:
        _bv = [bar[k] for k in _ks]
        _pv = [prog[k] for k in _ks]
        print('   A1 强调条右端 x   t=%s → %s   单调递增=%s'
              % ([('%.1f' % k) for k in _ks], _bv,
                 all(_bv[i] <= _bv[i + 1] for i in range(len(_bv) - 1))))
        print('   A4 底部进度像素数 t=%s → %s   单调递增=%s'
              % ([('%.1f' % k) for k in _ks], _pv,
                 all(_pv[i] <= _pv[i + 1] for i in range(len(_pv) - 1))))
    # A2 大字"呼吸"：呼吸周期 = max(2, min(3, dur/2)) = 3.0s（dur=6）→ 在镜内按相位取样。
    #   量"最亮的那 2% 像素"（= 文字笔画，背景/渐变底比它暗得多）的平均亮度：
    #   alpha 直接缩放文字像素 → 应当出现**高-低-高-低**的周期起伏。
    #   ⚠️ 别量整段平均亮度：VF_STAGE 的渐变底本身在缓慢流动（speed=0.015），会把测量搅浑
    #      （本机实测：整段平均那版读出来的相位是乱的）。
    _band = []
    for t in (0.75, 2.25, 3.75, 5.25):
        b = _rgb(ff, mp4, t, W, H)
        if not b:
            continue
        vals = []
        for y in range(int(H * 0.24), int(H * 0.56), 2):
            for x in range(0, W, 2):
                i = (y * W + x) * 3
                vals.append(max(b[i], b[i + 1], b[i + 2]))
        vals.sort(reverse=True)
        top = vals[:max(1, int(len(vals) * 0.02))]
        _band.append(round(sum(top) / float(len(top)), 2))
    if len(_band) >= 4:
        _amp = max(_band) - min(_band)
        _osc = (_band[0] > _band[1] < _band[2] > _band[3]) or (_band[0] < _band[1] > _band[2] < _band[3])
        print('   A2 文字笔画（最亮 2%%）亮度 相位 0.75/2.25/3.75/5.25s = %s   振幅=%.2f 周期起伏=%s'
              % (_band, _amp, _osc))
    # A3：第 2 镜（t=6~12，卡片版式 float=slow）—— 镜内只有浮动在动（旁路 zoompan、文字已静止），
    #     所以两帧同一行的水平最佳位移 ≈ 浮动位移（互相关）。
    b1, b2 = _rgb(ff, mp4, 7.5, W, H), _rgb(ff, mp4, 11.5, W, H)
    if b1 and b2:
        shs = []
        for y in (200, 300, 420):
            best, bd = 0, None
            for s in range(-40, 41):
                tot = 0
                for x in range(60, W - 60):
                    tot += abs(b1[(y * W + x) * 3] - b2[(y * W + x + s) * 3])
                if bd is None or tot < bd:
                    bd, best = tot, s
            shs.append(best)
        print('   A3 卡片浮动位移（t=7.5→11.5，三行互相关，像素）: %s   真在漂=%s'
              % (shs, any(abs(s) > 4 for s in shs)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--frames-only', action='store_true', help='只重抽帧（不渲染）')
    ap.add_argument('--no-verify', action='store_true', help='跳过像素自证')
    a = ap.parse_args()

    os.makedirs(OUT_DIR, exist_ok=True)
    os.makedirs(FRAME_DIR, exist_ok=True)
    print('=' * 74)
    print('★VF_DECK_V1 演示：产物目录 %s' % OUT_DIR)
    print('  ffmpeg = %s' % find_ffmpeg())
    for p in (IMG_A, IMG_B):
        print('  素材 %s  %s' % ('✅' if os.path.exists(p) else '❌', p))
    print('=' * 74)

    for name, sb, times in JOBS:
        sbp = os.path.join(OUT_DIR, 'sb_%s.json' % name)
        with open(sbp, 'w', encoding='utf-8') as f:
            json.dump(sb, f, ensure_ascii=False, indent=2)
        if not a.frames_only:
            print('\n── 渲染 %s（%dx%d，%d 镜）' % (name, sb['size'][0], sb['size'][1], len(sb['shots'])))
            rc = run([sys.executable, os.path.join(_HERE, 'render.py'),
                      '--storyboard', sbp,
                      '--out', os.path.join(OUT_DIR, name + '.mp4'),
                      '--workdir', os.path.join(OUT_DIR, 'wd_' + name),
                      '--no-subs'], cwd=_HERE)
            if rc != 0:
                print('  ❌ %s 渲染失败（退出码 %s）' % (name, rc))
                continue
        print('\n── 抽帧 %s @ t=%s' % (name, ','.join(times.keys())))
        extract_frames(name, list(times.keys()))

    if not a.no_verify:
        verify()

    print('\n完成。成片与抽帧都在：%s' % OUT_DIR)
    return 0


if __name__ == '__main__':
    sys.exit(main())
