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
  python render.py --selftest        # 跑一遍内置样例，验证 8 种卡型（含 compare/chart/quote）

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
    dur = float(shot.get('dur', 3))
    fs = int(shot.get('fontsize', max(64, int(H * 0.13))))
    # ★VF_SYNC_V1（C3，2026-09-20）：标题卡也用【逐字浮现】（与 bgimage 一致，跟着配音卡点）
    #   拿不到 text 时回退到原来的“整句淡入”，行为不退化。
    _rev = _reveal_seq(shot, font, fs, th.get('text', 'white'), dur)
    vf = ','.join(_rev) if _rev else (
        f"drawtext=fontfile='{font}':text='{esc_text(shot.get('text', ''))}':fontsize={fs}:"
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
    vf = (
        f"split=2[bg0][fg0];"
        f"[bg0]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},gblur=sigma=32,eq=brightness=-0.18[bgb];"
        f"[fg0]scale={W}:{H}:force_original_aspect_ratio=decrease[fgs];"
        f"[bgb][fgs]overlay=(W-w)/2:(H-h)/2[smooth];"
        # ★2026-09-20：与 card_bgimage 一致 —— 不再 increase+crop 裁切，改用模糊铺底 + 完整图居中
        f"[smooth]zoompan={z}:d={frames}:s={W}x{H}:fps={fps},"
        f"trim=duration={dur},setpts=PTS-STARTPTS,format=yuv420p"
    )
    return (f"-loop 1 -t {dur} -i \"{src}\"", vf, dur)


def card_video(shot, th, W, H, fps):
    """视频片段：截取 + 缩放填充"""
    src = shot.get('src', '')
    dur = float(shot.get('dur', 5))
    start = float(shot.get('start', 0))
    vf = (
        f"split=2[bg0][fg0];"
        f"[bg0]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},gblur=sigma=32,eq=brightness=-0.18[bgb];"
        f"[fg0]scale={W}:{H}:force_original_aspect_ratio=decrease[fgs];"
        f"[bgb][fgs]overlay=(W-w)/2:(H-h)/2,"
        # ★2026-09-20：视频片段同样不再裁切（模糊铺底 + 完整画面居中）
        f"trim=duration={dur},setpts=PTS-STARTPTS,format=yuv420p"
    )
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


def _avg_rgb(path, ffmpeg):
    """★VF_TINT_V1（2026-09-20）：取一张图的平均色 —— 用 ffmpeg 缩到 1x1 再读 3 字节。
    不需要 PIL（服务器上没装），也不改依赖。"""
    try:
        r = subprocess.run([ffmpeg, '-v', 'error', '-i', path, '-vf', 'scale=1:1',
                            '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
                           capture_output=True, timeout=20)
        b = r.stdout or b''
        if len(b) >= 3:
            return (b[0], b[1], b[2])
    except Exception:
        pass
    return None


def _blend_dark(base_hex, rgb, k=0.22):
    """把素材平均色混进主题底板色（保留主题基调，只带一点素材色相）→ 整片色调统一"""
    try:
        h = str(base_hex).replace('0x', '')
        base = (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))
    except Exception:
        base = (10, 22, 32)
    r, g, b = rgb
    return '0x%02x%02x%02x' % (
        max(0, min(255, int(base[0] * (1 - k) + r * k))),
        max(0, min(255, int(base[1] * (1 - k) + g * k))),
        max(0, min(255, int(base[2] * (1 - k) + b * k))))


def _reveal_seq(shot, font, fs, txc, dur):
    """★VF_SYNC_V1（2026-09-20，C3 配音卡点）：画面大字【逐字浮现】。

    镜头时长 = 该镜配音真实时长（tts.py 回填），所以在镜头前段逐字亮出 = 跟着配音走。
    做法：对每个前缀（第 1 字、前 2 字…）各画一次 drawtext，各自只在 [t_i, t_{i+1}) 窗口
    enable —— 因为前缀是嵌套的，看起来就是从左向右逐字浮现；且每个都用
    x=(w-text_w)/2 居中，不需测量字宽（这是不用 ASS 覆盖层的原因）。
    """
    chars = list(str(shot.get('text') or ''))
    nch = len(chars)
    if nch <= 0:
        return []
    t0 = max(0.12, min(0.6, dur * 0.06))
    t1 = max(t0 + 0.5, dur * 0.55)
    step = (t1 - t0) / float(nch)
    out = []
    for i in range(1, nch + 1):
        st = t0 + step * (i - 1)
        en = dur if i == nch else (t0 + step * i)
        # ★VF_TEXTSTROKE_V1（2026-09-20）：画面大字是压在【素材照片】上的，底色不可控 ——
        #   加一圈深色描边，浅色主题 / 亮底素材也能看清
        #   （加"浅色纸感"主题后才发现：light 主题字色近黑，压在深色照片上会糊）
        out.append(
            f"drawtext=fontfile='{font}':text='{esc_text(''.join(chars[:i]))}':fontsize={fs}:"
            f"fontcolor={txc}:borderw=2:bordercolor=black@0.65:"
            f"x=(w-text_w)/2:y=(h-text_h)/2:enable='between(t,{st:.2f},{en:.2f})'"
        )
    return out


def card_bgimage(shot, th, W, H, fps):
    """图片背景 + 文字叠加 + 暗化（适合"实景底 + 标语"）

    ★2026-09-19 改（用户实测：横屏素材被收窄/切边）：
      老做法 = scale(force_original_aspect_ratio=increase) + crop → 放大到填满画布再切掉超出
               ⇒ 横图放进竖屏会被切掉左右，竖图放进横屏会被切掉上下。
      新做法（不裁切）：
        底层 [bg0] 放大填满 + 高斯模糊 + 压暗  → 做画布底纹（不出现突兀黑边）
        上层 [fg0] 按 contain 缩放（完整图，不裁切）→ 居中 overlay
    """
    src = shot.get('src', '')
    dur = float(shot.get('dur', 4))
    font = esc_path(find_font(th.get('font', 'msyh')))
    fs = int(shot.get('fontsize', max(54, int(H * 0.10))))
    txc = th.get('text', 'white')
    _frames = max(1, int(dur * fps))
    # ★VF_SYNC_V1（C3）：画面大字逐字浮现（跟配音卡点）；拿不到 text 就不加这些滤镜
    _reveal = _reveal_seq(shot, font, fs, txc, dur)
    # ★VF_LESSDARK_V1（2026-09-20 用户实测"整体黑白/发灰"）：黑遮罩 0.42 → 0.15
    #   原来整幅盖 42% 黑（为保字幕可读）→ 图片颜色全被压掉、观感"黑白"。
    #   现在改成：全屏只轻压 15%（保色彩）+【底部字幕区】单独再压 30%（保字幕对比度）。
    _bar_y = int(H * 0.72)
    _chain = [
        f"drawbox=x=0:y=0:w={W}:h={H}:color=black@0.15:t=fill",
        f"drawbox=x=0:y={_bar_y}:w={W}:h={H - _bar_y}:color=black@0.30:t=fill",
    ] + _reveal + [
        f"trim=duration={dur},setpts=PTS-STARTPTS,format=yuv420p"]
    vf = (
        f"split=2[bg0][fg0];"
        f"[bg0]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},gblur=sigma=32,eq=brightness=-0.18[bgb];"
        f"[fg0]scale={W}:{H}:force_original_aspect_ratio=decrease[fgs];"
        f"[bgb][fgs]overlay=(W-w)/2:(H-h)/2[smooth];"
        # ★VF_KENBURNS_V1（2026-09-20）：静图缓慢推近（1.0→1.06）——不改时长，只让画面“活”起来
        f"[smooth]zoompan=zoom='min(1+0.06*on/{_frames},1.06)':d={_frames}:s={W}x{H}:fps={fps},"
        + ','.join(_chain)
    )
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
        # ★VF_UNKNOWNCARD_V1（2026-09-20）：AI 可能自造卡型（实测出现过 `subtitle` 卡）——
        #   原来直接 raise → **整镜渲染失败**（严重时整片出不来）。
        #   改为**降级成 title 卡**：宁可这一镜样式朴素，也不要整条视频挂掉。
        print('[VF] ⚠️ 未知配方卡「%s」→ 降级为 title 卡' % typ)
        shot = dict(shot)
        shot['type'] = 'title'
        shot['text'] = str(shot.get('text') or shot.get('title') or shot.get('subtitle') or '')[:24]
        fn = card_title
        typ = 'title'
    inp, vf, dur = fn(shot, th, W, H, fps)
    out = os.path.join(workdir, 'shot%02d.mp4' % idx)
    # ★VF_TRANS_V1（2026-09-20）：每镜首尾轻微淡入淡出（≤0.2s）——比硬切自然；
    #   不改时长（不碰音频时间轴），拼接后就是“柔和的镜间过渡”
    _fd = min(0.2, max(0.05, dur / 10.0))
    vf2 = f"{vf},fade=t=in:st=0:d={_fd:.2f},fade=t=out:st={max(0.0, dur - _fd):.2f}:d={_fd:.2f}"
    cmd = (f'"{ffmpeg}" -y {inp} -vf "{vf2}" -c:v libx264 -preset fast '
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


def _shot_text(s):
    """镜头的可读文本（SRT / ASS 共用）：优先 subtitle/text，其次 title+items+label+value+cta。

    ★2026-09-19 修（用户实测：有一镜有配音却没字幕）：
      list/number/compare/chart 这些卡**没有 text 字段**（用 title/items/label/value），
      老逻辑只看 text → txt 为空 → 整镜被跳过 → 该镜有配音但没字幕。
    """
    t0 = (s.get('subtitle') or s.get('text') or '').strip()
    if t0:
        return t0
    parts = []
    if s.get('title'):
        parts.append(str(s['title']).strip())
    if isinstance(s.get('items'), list):
        parts.extend([str(x).strip() for x in s['items'] if str(x).strip()])
    if s.get('label'):
        parts.append(str(s['label']).strip())
    if s.get('value') is not None:
        parts.append((str(s.get('value')) + str(s.get('suffix') or '')).strip())
    if s.get('left') or s.get('right'):
        parts.append((str(s.get('left') or '') + ' vs ' + str(s.get('right') or '')).strip())
    if s.get('cta'):
        parts.append(str(s['cta']).strip())
    return '，'.join([p for p in parts if p])[:60]


def _ass_ts(t):
    """ASS 时间戳：H:MM:SS.cc"""
    h = int(t // 3600)
    m = int((t % 3600) // 60)
    s = t % 60
    return '%d:%02d:%05.2f' % (h, m, s)


def _ass_esc(t):
    """ASS 文本转义（{} 是覆盖标签、\\ 是转义符，必须换掉）"""
    return t.replace('\\', '／').replace('{', '(').replace('}', ')')


def build_ass(shots, path, W, H, font_name='Noto Sans CJK SC', font_size=26, wrap=16):
    """★VF_KARAOKE_V1（2026-09-20，用户要的“词级字幕”）：ASS 逐字高亮（karaoke）

    为什么不用 funasr 取字级时间戳：服务器未必装 funasr（那是客户端环境），
    而每镜的 subtitle 与**真实配音时长**（tts.py 回填的 dur）都已经有了 ——
    于是把该镜时长按字数均分给每个字，生成 \\k（厘秒）就能得到逐字扫过的效果：
    零依赖、零额外成本、不会因为没有 funasr 而挂。
    样式：已唱=白（PrimaryColour），未唱=主题橙（SecondaryColour）。
    """
    head = (
        '[Script Info]\nScriptType: v4.00+\nPlayResX: %d\nPlayResY: %d\n'
        'WrapStyle: 2\nScaledBorderAndShadow: yes\n\n'
        '[V4+ Styles]\n'
        'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, '
        'Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, '
        'Alignment, MarginL, MarginR, MarginV, Encoding\n'
        'Style: Def,%s,%d,&H00FFFFFF,&H00356BFF,&H00000000,&H80000000,'
        '0,0,0,0,100,100,0,0,1,2.5,0,2,50,50,%d,1\n\n'
        '[Events]\n'
        'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n'
    ) % (W, H, font_name, font_size, max(28, int(H * 0.045)))

    lines = []
    t = 0.0
    for s in shots:
        dur = float(s.get('dur', 3))
        txt = _shot_text(s)
        if txt:
            flat = ''.join(txt.split())
            if flat:
                n = max(1, len(flat))
                per = max(1, int(round(dur * 100.0 / n)))   # 每个字占多少厘秒
                rows = [_ass_esc(flat[i:i + wrap]) for i in range(0, len(flat), wrap)]
                segs = []
                for ri, r in enumerate(rows):
                    if ri:
                        segs.append('\\N')
                    segs.extend(['{\\k%d}%s' % (per, c) for c in r])
                lines.append('Dialogue: 0,%s,%s,Def,,0,0,0,,%s' % (_ass_ts(t), _ass_ts(t + dur), ''.join(segs)))
        t += dur
    if not lines:
        return ''
    with open(path, 'w', encoding='utf-8') as f:
        f.write(head + '\n'.join(lines) + '\n')
    return path


def build_srt(shots, path):
    """从分镜生成 SRT（build_ass 失败时的兜底）。时间 = 各镜时长累加，不另算。"""
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
        txt = _shot_text(s)
        if txt:
            n += 1
            # 长句自动折行（SRT 原生多行，subtitles 滤镜支持）
            if len(txt) > 18:
                txt = '\n'.join([txt[i:i + 18] for i in range(0, len(txt), 18)])
            out.append('%d\n%s --> %s\n%s\n' % (n, fmt(t), fmt(t + dur), txt))
        t += dur
    if out:
        with open(path, 'w', encoding='utf-8') as f:
            f.write('\n'.join(out))
        return path
    return ''


def burn_subtitles(video, srt, out, ffmpeg, font_size=26):
    """把字幕烧进画面（SRT 白字黑描边；ASS 保留自带样式与逐字高亮）"""
    sp = esc_path(os.path.abspath(srt))
    if str(srt).lower().endswith('.ass'):
        # ★VF_KARAOKE_V1：ASS 自带样式（含 \\k 逐字高亮与字体名），不能再 force_style 覆盖
        cmd = (f'"{ffmpeg}" -y -i "{video}" -vf "subtitles=\'{sp}\'" '
               f'-c:v libx264 -preset fast -pix_fmt yuv420p -c:a copy "{out}"')
    else:
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


def mux_audio(video, audio, out, ffmpeg, bgm=''):
    """混音：人声（+ 可选 BGM 低音量铺底）→ 输出；两样都没有就直接复制。

    ★VF_BGM_V1（2026-09-20，用户要的 BGM）：
      BGM 用 -stream_loop -1 循环铺底，音量压到 0.12；amix 加 normalize=0
      （默认 amix 会把人声也按输入数除小 → 人声变轻，必须关掉归一化）。
    """
    has_voice = bool(audio) and os.path.exists(audio)
    has_bgm = bool(bgm) and os.path.exists(bgm)
    # ★2026-09-20：BGM 传了但文件不存在时要明说 —— 否则"选了自动配乐却没混进去"会静默发生
    if bgm and not has_bgm:
        print('[VF] ⚠️ BGM 文件不存在，已跳过配乐: %s' % bgm)
    if not has_voice and not has_bgm:
        import shutil
        shutil.copyfile(video, out)
        return out
    if has_voice and has_bgm:
        # ★2026-09-20：把走过的分支打出来 —— 否则“选了配乐到底混没混进去”无法从日志判定
        print('[VF] 混音：人声 + BGM（BGM 音量 0.12，-stream_loop 循环铺底）')
        cmd = (f'"{ffmpeg}" -y -i "{video}" -i "{audio}" -stream_loop -1 -i "{bgm}" '
               f'-filter_complex "[1:a]volume=1.0[voc];[2:a]volume=0.12[bg];'
               f'[voc][bg]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]" '
               f'-map 0:v -map "[aout]" -c:v copy -c:a aac -shortest "{out}"')
    elif has_voice:
        print('[VF] 混音：仅人声（无 BGM）')
        cmd = (f'"{ffmpeg}" -y -i "{video}" -i "{audio}" -c:v copy -c:a aac '
               f'-shortest "{out}"')
    else:
        print('[VF] 混音：仅 BGM（无人声，音量 0.18）')
        cmd = (f'"{ffmpeg}" -y -i "{video}" -stream_loop -1 -i "{bgm}" '
               f'-filter_complex "[1:a]volume=0.18[aout]" '
               f'-map 0:v -map "[aout]" -c:v copy -c:a aac -shortest "{out}"')
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
    ap.add_argument('--bgm', default='', help='背景音乐文件（会循环铺底并压低音量）')
    ap.add_argument('--no-subs', action='store_true', help='不烧字幕')
    ap.add_argument('--no-karaoke', action='store_true', help='不生成 ASS 逐字高亮（回落 SRT）')
    ap.add_argument('--sub-size', default='0', help='字幕字号（0 = 按分辨率自适应）')
    ap.add_argument('--selftest', action='store_true')
    a = ap.parse_args()

    ffmpeg = find_ffmpeg()

    if a.selftest:
        wd = a.workdir or os.path.join(tempfile.gettempdir(), 'vf-selftest')
        os.makedirs(wd, exist_ok=True)
        # ★VF_SELFTEST_V1（2026-09-20）：自检要能覆盖**新链路**，否则等它只是"能跑老卡"。
        #   这里先用 ffmpeg 造一张测试图 → 让 selftest 走到 bgimage 的完整滤镜链
        #   （split / 模糊铺底 / contain overlay / Ken Burns / 逐字浮现）+ ASS 卡拉OK + 底板取色。
        _testimg = ''
        try:
            _tp = os.path.join(wd, 'selftest-src.jpg')
            subprocess.run([ffmpeg, '-v', 'error', '-y', '-f', 'lavfi',
                            '-i', 'color=c=0x2b6cb0:s=640x360', '-frames:v', '1', _tp],
                           capture_output=True, timeout=30)
            if os.path.exists(_tp):
                _testimg = _tp
        except Exception:
            _testimg = ''
        # 造图失败时不能让自检直接崩（bgimage 的 src 为空会让 ffmpeg 输入报错）→ 降级成 title 卡
        _bgshot = ({"type": "bgimage", "src": _testimg, "text": "素材合成",
                    "subtitle": "这一镜用来验证素材合成链路是否正常", "dur": 3.0}
                   if _testimg else
                   {"type": "title", "text": "素材合成（造图失败，已跳过 bgimage）",
                    "subtitle": "这一镜用来验证素材合成链路是否正常", "dur": 3.0})
        sb = {
            "size": [1280, 720], "fps": 25,
            "theme": {"bg": "0x0a1620", "text": "white", "accent": "0xff6b35", "font": "msyh"},
            "shots": [
                {"type": "title", "text": "AI Marketing 自检", "subtitle": "这是一条自检视频", "dur": 2.5},
                _bgshot,
                {"type": "list", "title": "三步走", "subtitle": "做内容，发视频，看数据",
                 "items": ["做内容", "发视频", "看数据"], "dur": 6},
                {"type": "number", "value": 300, "suffix": "+", "label": "已服务客户",
                 "subtitle": "已经服务三百家客户", "dur": 3},
                # ★VF_SELFTEST_V2（2026-09-20）：把【compare / chart / quote】也纳入自检 ——
                #   上轮刚把 prompt 白名单放开到 7 种（新增 compare/chart），却从没验证过它们能渲染；
                #   quote 属"兜底归一化"路径，一并验证渲染器没坏。
                {"type": "compare", "left": "手工剪辑", "right": "本地成片",
                 "leftDesc": "一条要半天", "rightDesc": "五分钟出片",
                 "subtitle": "对比一下两种做法的耗时", "dur": 4},
                {"type": "chart", "title": "出片效率",
                 "items": [{"label": "手工", "value": 32}, {"label": "本地成片", "value": 78}],
                 "subtitle": "效率差距大约是这个比例", "dur": 5},
                {"type": "quote", "text": "省下来的时间就是钱",
                 "from": "某位内测用户", "subtitle": "有位内测用户这么说", "dur": 4},
                {"type": "end", "text": "开始出片", "cta": "点击咨询", "subtitle": "现在就试试", "dur": 2.5},
            ],
        }
        if not _testimg:
            print('[VF] ⚠️ selftest 造图失败，bgimage 链路不会被覆盖（已降级 title 卡）')
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

    # ★VF_TINT_V1（2026-09-20，C4 主色底板）：取前几张素材的平均色，混进“卡片底板色”
    #   → 纯色卡（title/list/number/end）跟着素材色相走，整片视觉统一。取色失败不影响出片。
    try:
        _srcs = []
        for _s in sb.get('shots', []):
            _p = _s.get('src')
            if _p and os.path.exists(_p):
                _srcs.append(_p)
            if len(_srcs) >= 3:
                break
        _rgbs = [c for c in (_avg_rgb(_p, ffmpeg) for _p in _srcs) if c]
        if _rgbs:
            _ar = sum(c[0] for c in _rgbs) // len(_rgbs)
            _ag = sum(c[1] for c in _rgbs) // len(_rgbs)
            _ab = sum(c[2] for c in _rgbs) // len(_rgbs)
            th = dict(th)
            th['bg'] = _blend_dark(th.get('bg', '0x0a1620'), (_ar, _ag, _ab), 0.22)
            print('[VF] 底板色跟随素材: %s' % th['bg'])
    except Exception as eT:
        print('[VF] 底板取色跳过: %s' % str(eT)[:100])

    print('[VF] ffmpeg=%s  字体=%s' % (ffmpeg, find_font(th.get('font', 'msyh')) or '(无)'))
    files = []
    _total_dur = 0.0
    for i, shot in enumerate(sb.get('shots', [])):
        p = render_shot(shot, th, wd, i, W, H, fps, ffmpeg)
        # ★VF_SHOTLOG_V1（2026-09-20）：日志带上【本镜时长】—— 不必再跑 Python 脚本查"每镜几秒"
        #   （对"一镜 14 秒太闷"这类问题，一眼就能从日志看出是否正常）
        _d = float(shot.get('dur', 0) or 0)
        _total_dur += _d
        print('[VF] 第 %d 镜 OK  %-8s %5.1fs -> %s' % (i + 1, shot.get('type'), _d, os.path.basename(p)))
        files.append(p)
    if not files:
        print('[VF] 没有镜头'); sys.exit(3)
    merged = concat_shots(files, wd, ffmpeg, W, H, fps)
    print('[VF] 拼接完成 -> %s（共 %d 镜 %.1f 秒）' % (merged, len(files), _total_dur))

    # ★ 字幕（默认开）：由分镜时长累加生成 SRT —— 唯一真相源，不另算时间
    video_for_audio = merged
    # ★VF_SUBSIZE_V1（2026-09-20）：字幕字号原来写死 26 —— 在 1920x1080 下只有屏高 2.4%，太小。
    #   改为未指定时按分辨率自适应（约屏高 4.2%）；显式传 --sub-size 仍以传入值为准。
    _sub_size = int(a.sub_size) if str(a.sub_size).isdigit() and int(a.sub_size) > 0 else max(26, int(H * 0.042))
    if not a.no_subs:
        shots = sb.get('shots', [])
        sub_file = ''
        # ★VF_KARAOKE_V1（2026-09-20）：优先 ASS 逐字高亮；生成失败/无文本则回落 SRT（保证一定有字幕）
        if not a.no_karaoke:
            try:
                sub_file = build_ass(shots, os.path.join(wd, 'subs.ass'), W, H, sub_font_name(), _sub_size)
            except Exception as eSA:
                print('[VF] ASS 生成失败，回落 SRT: %s' % str(eSA)[:140])
                sub_file = ''
        if not sub_file:
            sub_file = build_srt(shots, os.path.join(wd, 'subs.srt'))
        if sub_file:
            video_for_audio = burn_subtitles(merged, sub_file, os.path.join(wd, 'subbed.mp4'),
                                             ffmpeg, _sub_size)
            print('[VF] 字幕已烧入 -> %s (字号 %d)' % (sub_file, _sub_size))
        else:
            print('[VF] 无字幕文本，跳过')
    final = mux_audio(video_for_audio, a.audio, out, ffmpeg, a.bgm)
    print('[VF] ✅ 成片: %s' % final)


if __name__ == '__main__':
    main()
