#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""成片渲染器（最小可用版）★VIDEO_FACTORY_V1

输入：一个「分镜 JSON」（shots 数组）
输出：一条成片 mp4（逐镜渲染 → 拼接 → 混入配音）

为什么这么做：口径见 docs/成片工作流方案-借鉴开源研究.md
  · 只做 FFmpeg 能确定做到的动作（不追求 Remotion 那种任意 MG）
  · 每镜 = 一张"配方卡"的实例，配方卡是 JSON，可复用、可校验
  · 逐镜渲染（分段渲染）→ 改一镜只重渲那一镜

用法:
  python render.py --storyboard sb.json --out out.mp4 [--workdir temp/vf] [--audio voice.m4a]
  python render.py --selftest        # 跑一遍内置样例，验证 5 张配方卡

支持的配方卡（先 5 张）:
  title    标题卡（大字 + 淡入）
  list     列表逐项揭示（一项 = 一步，抄 garden-skills 的铁律）
  number   大数字递增
  image    图片 + Ken Burns 推拉
  video    视频片段（截取 + 缩放）

分镜 JSON 结构:
  {
    "size": [1280, 720],          # 可选，默认 1280x720
    "fps": 25,
    "theme": {                    # 主题 token（先给最小集）
      "bg": "0x0a1620", "text": "white", "accent": "0xff6b35", "font": "msyh"
    },
    "shots": [
      {"type": "title",  "text": "AI Marketing", "dur": 3},
      {"type": "list",   "items": ["做内容", "发视频", "看数据"], "dur": 6, "title": "三步走"},
      {"type": "number", "value": 300, "suffix": "+", "label": "已服务客户", "dur": 3},
      {"type": "image",  "src": "cover.jpg", "dur": 4, "kb": "zoomin"},
      {"type": "video",  "src": "clip.mp4",  "dur": 5}
    ]
  }
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

# ── FFmpeg / 字体定位（优先环境变量，其次常见路径）──
FFMPEG_CANDS = [
    os.environ.get('FFMPEG_PATH', ''),
    r'C:\ffmpeg\bin\ffmpeg.exe',
    os.path.join(os.environ.get('LOCALAPPDATA', ''), r'Microsoft\WinGet\Links\ffmpeg.exe'),
    'ffmpeg',
]
# ★VF_LINUX_V1（2026-09-18）：字体候选加 Linux/macOS。
#   原来只有 C:\Windows\Fonts\* —— 部署到服务器（Linux）后 find_font 返回 ''，
#   ffmpeg 只能用 fontconfig 默认字体 → 中文渲染成方块。
#   服务器请装中文字体：apt-get install -y fonts-noto-cjk （或 fonts-wqy-zenhei）
FONT_CANDS = {
    'msyh': [
        r'C:\Windows\Fonts\msyh.ttc', r'C:\Windows\Fonts\msyhbd.ttc',
        '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
    ],
    'simhei': [r'C:\Windows\Fonts\simhei.ttf', '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc'],
    'simsun': [r'C:\Windows\Fonts\simsun.ttc', '/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc'],
    'arial': [r'C:\Windows\Fonts\arial.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'],
    # ↓ Linux 常见中文字体（本机没有 Windows 字体时用）
    'noto': [
        '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
        '/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf',
        '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc',
        '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
        '/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc',
        '/usr/share/fonts/google-noto-cjk/NotoSansCJK-Regular.ttc',
    ],
    'wqy': [
        '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc',
        '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc',
        '/usr/share/fonts/wenquanyi/wqy-zenhei/wqy-zenhei.ttc',
    ],
    'dejavu': ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'],
}

# CJK 回退顺序（Windows 字体 → Linux 中文字体）
_FONT_FALLBACK_ORDER = ['msyh', 'noto', 'wqy', 'simhei', 'simsun', 'dejavu', 'arial']
_FONT_CACHE = {}


def find_ffmpeg():
    for p in FFMPEG_CANDS:
        if not p:
            continue
        if p == 'ffmpeg' or os.path.exists(p):
            return p
    raise RuntimeError('找不到 ffmpeg（设 FFMPEG_PATH 或装到 C:\\ffmpeg\\bin）')


def find_font(key='msyh'):
    """按 key 找字体；找不到则按 CJK 回退顺序找任意可用字体（Linux 服务器用）"""
    if key in _FONT_CACHE:
        return _FONT_CACHE[key]
    result = ''
    for p in FONT_CANDS.get(key, []):
        if os.path.exists(p):
            result = p
            break
    if not result:
        for k in _FONT_FALLBACK_ORDER:
            if k == key:
                continue
            for p in FONT_CANDS.get(k, []):
                if os.path.exists(p):
                    print('[VF] 字体 %s 未找到，回退到 %s' % (key, k))
                    result = p
                    break
            if result:
                break
    if not result:
        print('[VF] ⚠️ 未找到任何候选字体（key=%s）→ 用 ffmpeg 默认字体；'
              'Linux 请装中文字体：apt-get install -y fonts-noto-cjk' % key)
    _FONT_CACHE[key] = result
    return result


def sub_font_name():
    """烧字幕用的字体名（libass 按字体名查找）：Windows=微软雅黑，Linux=Noto/文泉驿"""
    if os.path.exists(r'C:\Windows\Fonts\msyh.ttc'):
        return 'Microsoft YaHei'
    for name, probe in (
        ('Noto Sans CJK SC', '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'),
        ('Noto Sans CJK SC', '/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf'),
        ('WenQuanYi Zen Hei', '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc'),
        ('WenQuanYi Micro Hei', '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc'),
    ):
        if os.path.exists(probe):
            return name
    return 'Microsoft YaHei'


def esc_path(p):
    """FFmpeg filter 里 Windows 路径要转义冒号和反斜杠"""
    return p.replace('\\', '/').replace(':', r'\:')


def esc_text(t):
    """drawtext 文本转义：冒号/单引号/百分号/反斜杠"""
    return (str(t).replace('\\', '\\\\').replace(':', r'\:')
            .replace("'", r"\'").replace('%', r'\%'))


# ══════════════════ 配方卡渲染 ══════════════════

def card_title(shot, th, W, H, fps):
    """标题卡：大字居中 + 淡入"""
    font = esc_path(find_font(th.get('font', 'msyh')))
    txt = esc_text(shot.get('text', ''))
    dur = float(shot.get('dur', 3))
    fs = int(shot.get('fontsize', max(64, int(H * 0.13))))
    vf = (f"drawtext=fontfile='{font}':text='{txt}':fontsize={fs}:"
          f"fontcolor={th.get('text', 'white')}:"
          f"x=(w-text_w)/2:y=(h-text_h)/2:"
          f"alpha='min(t/0.6,1)'")
    return (f"-f lavfi -i color=c={th.get('bg', '0x0a1620')}:s={W}x{H}:d={dur}",
            vf, dur)


def card_list(shot, th, W, H, fps):
    """列表逐项揭示：一项 = 一步（严禁一次全上）"""
    font = esc_path(find_font(th.get('font', 'msyh')))
    items = shot.get('items', [])
    dur = float(shot.get('dur', max(2.5, 1.4 * len(items) + 1)))
    fs = int(shot.get('fontsize', max(40, int(H * 0.075))))
    acc, txc = th.get('accent', '0xff6b35'), th.get('text', 'white')
    parts = []
    y0 = int(H * 0.30)
    step = float(shot.get('step', 1.3))
    # 标题（可选）
    if shot.get('title'):
        parts.append(
            f"drawtext=fontfile='{font}':text='{esc_text(shot['title'])}':fontsize={int(fs * 0.9)}:"
            f"fontcolor={acc}:x={int(W * 0.10)}:y={int(H * 0.16)}:alpha='min(t/0.5,1)'")
    for i, it in enumerate(items):
        t_on = 0.5 + i * step
        # 渐入；后面项出现时前面的项【保留但变暗】= 灰化作上下文
        alpha = f"if(lt(t,{t_on:.2f}),0,min((t-{t_on:.2f})/0.4,1))"
        parts.append(
            f"drawtext=fontfile='{font}':text='{esc_text(it)}':fontsize={fs}:"
            f"fontcolor={txc}:x={int(W * 0.12)}:y={y0 + i * int(fs * 1.7)}:alpha='{alpha}'")
    vf = ','.join(parts)
    return (f"-f lavfi -i color=c={th.get('bg', '0x0a1620')}:s={W}x{H}:d={dur}",
            vf, dur)


def card_number(shot, th, W, H, fps):
    """大数字递增"""
    font = esc_path(find_font(th.get('font', 'msyh')))
    val = int(shot.get('value', 100))
    suf = esc_text(shot.get('suffix', ''))
    dur = float(shot.get('dur', 3))
    fs = int(shot.get('fontsize', max(90, int(H * 0.22))))
    acc, txc = th.get('accent', '0xff6b35'), th.get('text', 'white')
    parts = [
        f"drawtext=fontfile='{font}':text='%{{eif\\:min(t*{val / max(dur * 0.66, 0.1):.1f}\\,{val})\\:d}}{suf}':"
        f"fontsize={fs}:fontcolor={acc}:x=(w-text_w)/2:y=(h-text_h)/2-40"
    ]
    if shot.get('label'):
        parts.append(
            f"drawtext=fontfile='{font}':text='{esc_text(shot['label'])}':fontsize={int(fs * 0.28)}:"
            f"fontcolor={txc}:x=(w-text_w)/2:y=(h-text_h)/2+{int(fs * 0.75)}:alpha='min(t/0.8,1)'")
    return (f"-f lavfi -i color=c={th.get('bg', '0x0a1620')}:s={W}x{H}:d={dur}",
            ','.join(parts), dur)


def card_image(shot, th, W, H, fps):
    """图片 + Ken Burns 推拉"""
    src = shot.get('src', '')
    dur = float(shot.get('dur', 4))
    kb = shot.get('kb', 'zoomin')
    frames = max(1, int(dur * fps))
    if kb == 'zoomin':
        z = f"zoom='min(1+0.15*on/{frames},1.15)'"
    elif kb == 'zoomout':
        z = f"zoom='max(1.15-0.15*on/{frames},1.0)'"
    else:  # panright 等先归一到轻微放大
        z = f"zoom='min(1+0.10*on/{frames},1.10)'"
    vf = (f"scale={W * 2}:{H * 2}:force_original_aspect_ratio=increase,"
          f"crop={W * 2}:{H * 2},zoompan={z}:d={frames}:s={W}x{H}:fps={fps},"
          f"trim=duration={dur},setpts=PTS-STARTPTS,format=yuv420p")
    return (f"-loop 1 -t {dur} -i \"{src}\"", vf, dur)


def card_video(shot, th, W, H, fps):
    """视频片段：截取 + 缩放填充"""
    src = shot.get('src', '')
    dur = float(shot.get('dur', 5))
    start = float(shot.get('start', 0))
    vf = (f"scale={W}:{H}:force_original_aspect_ratio=increase,"
          f"crop={W}:{H},trim=duration={dur},setpts=PTS-STARTPTS,format=yuv420p")
    return (f"-ss {start} -t {dur} -i \"{src}\"", vf, dur)


def card_quote(shot, th, W, H, fps):
    """引用卡：大引号 + 引文 + 出处（适合"客户说/专家说"）"""
    font = esc_path(find_font(th.get('font', 'msyh')))
    dur = float(shot.get('dur', 4))
    fs = int(shot.get('fontsize', max(46, int(H * 0.085))))
    acc, txc = th.get('accent', '0xff6b35'), th.get('text', 'white')
    parts = [
        # 大引号（用中文引号字符放大当装饰）
        f"drawtext=fontfile='{font}':text='“':fontsize={int(fs * 2.6)}:fontcolor={acc}:"
        f"x={int(W * 0.08)}:y={int(H * 0.10)}:alpha='min(t/0.5,1)'",
        f"drawtext=fontfile='{font}':text='{esc_text(shot.get('text', ''))}':fontsize={fs}:"
        f"fontcolor={txc}:x={int(W * 0.14)}:y={int(H * 0.32)}:"
        f"alpha='min(max(t-0.5,0)/0.6,1)'",
    ]
    if shot.get('from'):
        parts.append(
            f"drawtext=fontfile='{font}':text='—— {esc_text(shot['from'])}':fontsize={int(fs * 0.6)}:"
            f"fontcolor={acc}:x={int(W * 0.14)}:y={int(H * 0.62)}:alpha='min(max(t-1.2,0)/0.6,1)'")
    return (f"-f lavfi -i color=c={th.get('bg', '0x0a1620')}:s={W}x{H}:d={dur}",
            ','.join(parts), dur)


def card_compare(shot, th, W, H, fps):
    """对比分屏：左右两栏 + 中间分隔线生长的动画"""
    font = esc_path(find_font(th.get('font', 'msyh')))
    dur = float(shot.get('dur', 5))
    fs = int(shot.get('fontsize', max(40, int(H * 0.07))))
    acc, txc = th.get('accent', '0xff6b35'), th.get('text', 'white')
    left = esc_text(shot.get('left', ''))
    right = esc_text(shot.get('right', ''))
    mid = W // 2
    parts = [
        # 左右标题
        f"drawtext=fontfile='{font}':text='{left}':fontsize={fs}:fontcolor={txc}:"
        f"x={int(W * 0.06)}:y={int(H * 0.16)}:alpha='min(t/0.5,1)'",
        f"drawtext=fontfile='{font}':text='{right}':fontsize={fs}:fontcolor={acc}:"
        f"x={int(W * 0.56)}:y={int(H * 0.16)}:alpha='min(max(t-0.4,0)/0.5,1)'",
        # 中间竖线：高度随时间生长（用 drawbox，h 支持表达式）
        f"drawbox=x={mid - 2}:y={int(H * 0.14)}:w=4:h='{int(H * 0.72)}*min(max(t-0.2,0)/0.6,1)':"
        f"color={acc}@0.9:t=fill",
        # 左右说明（小字）
        f"drawtext=fontfile='{font}':text='{esc_text(shot.get('leftDesc', ''))}':fontsize={int(fs * 0.55)}:"
        f"fontcolor={txc}@0.75:x={int(W * 0.06)}:y={int(H * 0.30)}:alpha='min(max(t-0.8,0)/0.5,1)'",
        f"drawtext=fontfile='{font}':text='{esc_text(shot.get('rightDesc', ''))}':fontsize={int(fs * 0.55)}:"
        f"fontcolor={txc}@0.75:x={int(W * 0.56)}:y={int(H * 0.30)}:alpha='min(max(t-1.2,0)/0.5,1)'",
    ]
    return (f"-f lavfi -i color=c={th.get('bg', '0x0a1620')}:s={W}x{H}:d={dur}",
            ','.join(parts), dur)


def card_chart(shot, th, W, H, fps):
    """横条生长：每项一条，长度按 value 比例增长（适合"数据/排名"）"""
    font = esc_path(find_font(th.get('font', 'msyh')))
    items = shot.get('items', [])          # [{label, value}]
    dur = float(shot.get('dur', max(3.0, 1.5 * len(items))))
    fs = int(shot.get('fontsize', max(32, int(H * 0.055))))
    acc, txc = th.get('accent', '0xff6b35'), th.get('text', 'white')
    mx = max([float(i.get('value', 0)) for i in items] or [1]) or 1
    bar_max = int(W * 0.62)
    parts = []
    if shot.get('title'):
        parts.append(f"drawtext=fontfile='{font}':text='{esc_text(shot['title'])}':fontsize={int(fs * 1.15)}:"
                     f"fontcolor={acc}:x={int(W * 0.08)}:y={int(H * 0.12)}:alpha='min(t/0.5,1)'")
    y0 = int(H * 0.30)
    for i, it in enumerate(items):
        v = float(it.get('value', 0))
        t_on = 0.4 + i * 0.5
        w_expr = '%d*min(max(t-%.2f,0)/0.8,1)' % (int(bar_max * v / mx), t_on)
        yb = y0 + i * int(fs * 2.1)
        parts.append(f"drawbox=x={int(W * 0.32)}:y={yb}:w='{w_expr}':h={int(fs * 0.7)}:"
                     f"color={acc}@0.85:t=fill")
        parts.append(f"drawtext=fontfile='{font}':text='{esc_text(it.get('label', ''))}':fontsize={fs}:"
                     f"fontcolor={txc}:x={int(W * 0.08)}:y={yb - int(fs * 0.05)}:alpha='min(max(t-%.2f,0)/0.5,1)'" % t_on)
        parts.append(f"drawtext=fontfile='{font}':text='{esc_text(str(it.get('value', '')))}':fontsize={int(fs * 0.9)}:"
                     f"fontcolor={txc}:x={int(W * 0.96)}:y={yb - int(fs * 0.1)}:alpha='min(max(t-%.2f,0)/0.5,1)'"
                     % (t_on + 0.3))
    return (f"-f lavfi -i color=c={th.get('bg', '0x0a1620')}:s={W}x{H}:d={dur}",
            ','.join(parts), dur)


def card_bgimage(shot, th, W, H, fps):
    """图片背景 + 文字叠加 + 暗化（适合"实景底 + 标语"）"""
    src = shot.get('src', '')
    dur = float(shot.get('dur', 4))
    font = esc_path(find_font(th.get('font', 'msyh')))
    fs = int(shot.get('fontsize', max(54, int(H * 0.10))))
    txc = th.get('text', 'white')
    frames = max(1, int(dur * fps))
    vf = (f"scale={W * 2}:{H * 2}:force_original_aspect_ratio=increase,crop={W * 2}:{H * 2},"
          f"zoompan=zoom='min(1+0.08*on/{frames},1.08)':d={frames}:s={W}x{H}:fps={fps},"
          f"drawbox=x=0:y=0:w={W}:h={H}:color=black@0.45:t=fill,"
          f"drawtext=fontfile='{font}':text='{esc_text(shot.get('text', ''))}':fontsize={fs}:"
          f"fontcolor={txc}:x=(w-text_w)/2:y=(h-text_h)/2:alpha='min(max(t-0.3,0)/0.7,1)',"
          f"trim=duration={dur},setpts=PTS-STARTPTS,format=yuv420p")
    return (f"-loop 1 -t {dur} -i \"{src}\"", vf, dur)


def card_end(shot, th, W, H, fps):
    """结尾卡：主标语 + 行动号召（CTA），带轻微上浮"""
    font = esc_path(find_font(th.get('font', 'msyh')))
    dur = float(shot.get('dur', 3.5))
    fs = int(shot.get('fontsize', max(56, int(H * 0.11))))
    acc, txc = th.get('accent', '0xff6b35'), th.get('text', 'white')
    parts = [
        f"drawtext=fontfile='{font}':text='{esc_text(shot.get('text', ''))}':fontsize={fs}:"
        f"fontcolor={txc}:x=(w-text_w)/2:y=(h-text_h)/2-30:alpha='min(t/0.6,1)'",
    ]
    if shot.get('cta'):
        parts.append(f"drawtext=fontfile='{font}':text='{esc_text(shot['cta'])}':fontsize={int(fs * 0.5)}:"
                     f"fontcolor={acc}:x=(w-text_w)/2:y=(h-text_h)/2+{int(fs * 0.9)}:alpha='min(max(t-0.6,0)/0.6,1)'")
    return (f"-f lavfi -i color=c={th.get('bg', '0x0a1620')}:s={W}x{H}:d={dur}",
            ','.join(parts), dur)


CARDS = {
    'title': card_title,
    'list': card_list,
    'number': card_number,
    'image': card_image,
    'video': card_video,
    'quote': card_quote,
    'compare': card_compare,
    'chart': card_chart,
    'bgimage': card_bgimage,
    'end': card_end,
}


def render_shot(shot, th, workdir, idx, W, H, fps, ffmpeg):
    typ = shot.get('type', 'title')
    fn = CARDS.get(typ)
    if not fn:
        raise RuntimeError('未知配方卡: ' + typ)
    inp, vf, dur = fn(shot, th, W, H, fps)
    out = os.path.join(workdir, 'shot%02d.mp4' % idx)
    cmd = (f'"{ffmpeg}" -y {inp} -vf "{vf}" -c:v libx264 -preset fast '
           f'-pix_fmt yuv420p -r {fps} -t {dur} "{out}"')
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True,
                       encoding='utf-8', errors='replace')
    if not os.path.exists(out):
        raise RuntimeError('第 %d 镜渲染失败(%s): %s' % (idx, typ, (r.stderr or '')[-400:]))
    return out


def concat_shots(files, workdir, ffmpeg, W, H, fps):
    """拼接（复用 encodeClips 思路：先统一参数再 concat）"""
    lst = os.path.join(workdir, 'list.txt')
    with open(lst, 'w', encoding='utf-8') as f:
        for p in files:
            f.write("file '%s'\n" % p.replace('\\', '/'))
    out = os.path.join(workdir, 'merged.mp4')
    cmd = (f'"{ffmpeg}" -y -f concat -safe 0 -i "{lst}" '
           f'-c:v libx264 -preset fast -pix_fmt yuv420p -r {fps} "{out}"')
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True,
                       encoding='utf-8', errors='replace')
    if not os.path.exists(out):
        raise RuntimeError('拼接失败: ' + (r.stderr or '')[-400:])
    return out


def build_srt(shots, path):
    """从分镜生成 SRT：每镜的 text（或 subtitle）覆盖该镜时间区间。
       ★ 这是"唯一真相源"的落地：字幕时间 = 各镜时长累加，不另算。"""
    def fmt(t):
        h = int(t // 3600)
        m = int((t % 3600) // 60)
        s = t % 60
        return '%02d:%02d:%02d,%03d' % (h, m, int(s), int(round((s - int(s)) * 1000)))
    out = []
    t = 0.0
    n = 0
    for s in shots:
        dur = float(s.get('dur', 3))
        txt = (s.get('subtitle') or s.get('text') or '').strip()
        if txt:
            n += 1
            out.append('%d\n%s --> %s\n%s\n' % (n, fmt(t), fmt(t + dur), txt))
        t += dur
    if out:
        with open(path, 'w', encoding='utf-8') as f:
            f.write('\n'.join(out))
        return path
    return ''


def burn_subtitles(video, srt, out, ffmpeg, font_size=26):
    """把 SRT 烧进画面（白字 + 黑描边，确保任何底色都看得清）"""
    sp = esc_path(os.path.abspath(srt))
    # ★VF_LINUX_V1：字幕字体名按平台选（Linux 上没有 Microsoft YaHei → 中文会变方块）
    style = ("FontName=%s,FontSize=%d,PrimaryColour=&H00FFFFFF,"
             "OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=0,"
             "Alignment=2,MarginV=40") % (sub_font_name(), font_size)
    cmd = (f'"{ffmpeg}" -y -i "{video}" -vf "subtitles=\'{sp}\':force_style=\'{style}\'" '
           f'-c:v libx264 -preset fast -pix_fmt yuv420p -c:a copy "{out}"')
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True,
                       encoding='utf-8', errors='replace')
    if not os.path.exists(out):
        raise RuntimeError('烧字幕失败: ' + (r.stderr or '')[-400:])
    return out


def mux_audio(video, audio, out, ffmpeg):
    if not audio or not os.path.exists(audio):
        import shutil
        shutil.copyfile(video, out)
        return out
    cmd = (f'"{ffmpeg}" -y -i "{video}" -i "{audio}" -c:v copy -c:a aac '
           f'-shortest "{out}"')
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True,
                       encoding='utf-8', errors='replace')
    if not os.path.exists(out):
        raise RuntimeError('混音失败: ' + (r.stderr or '')[-400:])
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--storyboard', default='')
    ap.add_argument('--out', default='')
    ap.add_argument('--workdir', default='')
    ap.add_argument('--audio', default='')
    ap.add_argument('--no-subs', action='store_true', help='不烧字幕')
    ap.add_argument('--sub-size', default='26', help='字幕字号（默认 26）')
    ap.add_argument('--selftest', action='store_true')
    a = ap.parse_args()

    ffmpeg = find_ffmpeg()

    if a.selftest:
        sb = {
            "size": [1280, 720], "fps": 25,
            "theme": {"bg": "0x0a1620", "text": "white", "accent": "0xff6b35", "font": "msyh"},
            "shots": [
                {"type": "title", "text": "AI Marketing", "dur": 2.5},
                {"type": "list", "title": "三步走", "items": ["做内容", "发视频", "看数据"], "dur": 6},
                {"type": "number", "value": 300, "suffix": "+", "label": "已服务客户", "dur": 3},
            ],
        }
        wd = a.workdir or os.path.join(tempfile.gettempdir(), 'vf-selftest')
        out = a.out or os.path.join(wd, 'selftest.mp4')
    else:
        if not a.storyboard or not os.path.exists(a.storyboard):
            print('缺少 --storyboard'); sys.exit(2)
        sb = json.load(open(a.storyboard, encoding='utf-8'))
        wd = a.workdir or os.path.join(os.path.dirname(os.path.abspath(a.storyboard)), 'vf-work')
        out = a.out or 'output.mp4'

    os.makedirs(wd, exist_ok=True)
    W, H = sb.get('size', [1280, 720])
    fps = int(sb.get('fps', 25))
    th = sb.get('theme', {}) or {}

    print('[VF] ffmpeg=%s  字体=%s' % (ffmpeg, find_font(th.get('font', 'msyh')) or '(无)'))
    files = []
    for i, shot in enumerate(sb.get('shots', [])):
        p = render_shot(shot, th, wd, i, W, H, fps, ffmpeg)
        print('[VF] 第 %d 镜 OK  %-8s -> %s' % (i + 1, shot.get('type'), os.path.basename(p)))
        files.append(p)
    if not files:
        print('[VF] 没有镜头'); sys.exit(3)
    merged = concat_shots(files, wd, ffmpeg, W, H, fps)
    print('[VF] 拼接完成 -> %s' % merged)

    # ★ 字幕（默认开）：由分镜时长累加生成 SRT —— 唯一真相源，不另算时间
    video_for_audio = merged
    if not a.no_subs:
        srt = build_srt(sb.get('shots', []), os.path.join(wd, 'subs.srt'))
        if srt:
            video_for_audio = burn_subtitles(merged, srt, os.path.join(wd, 'subbed.mp4'),
                                             ffmpeg, int(a.sub_size))
            print('[VF] 字幕已烧入 -> %s' % srt)
        else:
            print('[VF] 无字幕文本，跳过')
    final = mux_audio(video_for_audio, a.audio, out, ffmpeg)
    print('[VF] ✅ 成片: %s' % final)


if __name__ == '__main__':
    main()
