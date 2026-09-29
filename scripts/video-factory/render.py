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
  python render.py --selftest        # 跑一遍内置样例，验证 9 种卡型（含 compare/chart/quote/aivideo）

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
import re
import subprocess
import sys
import tempfile

# ★VF_THEMES_V1（2026-09-29）：主题 token 的【唯一真相源】是同目录 themes.py。
#   本文件原来要求分镜里的 `theme` 必须是字典；而草稿/接口里存的其实是字符串（如 'dark'）——
#   2026-09-29 本机诊断就把字符串喂进来过 → `th.get()` 直接 AttributeError。现在统一走 theme_of()。
_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)
from themes import THEMES, theme_of  # noqa: E402

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
    # ★VF_FONTWEIGHT_V1（2026-09-29 用户定案 P1「字体字重体系」）：
    #   原来所有字都是同一套常规字重 —— 大字/标题/数字看着"轻"，缺层级。
    #   这里单独给【粗体】一个键：大字、标题、数字、固定标题第 1 行用粗体，正文/字幕仍用常规体。
    #   为什么不用"字体缩放/描边"假装粗：那会糊边；直接用真粗体文件最干净。
    #   Windows 自带 msyhbd.ttc；Linux 需要 Noto CJK Bold（apt 装 fonts-noto-cjk 就有）。
    'msyhbd': [
        r'C:\Windows\Fonts\msyhbd.ttc',
        '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc',
        '/usr/share/fonts/opentype/noto/NotoSansCJKsc-Bold.otf',
        '/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc',
        '/usr/share/fonts/noto-cjk/NotoSansCJK-Bold.ttc',
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
_FONT_FALLBACK_ORDER = ['msyh', 'msyhbd', 'noto', 'wqy', 'simhei', 'simsun', 'dejavu', 'arial']
_FONT_CACHE = {}

# ★VF_RENDER_GUARD_V1（2026-09-22，用户实测「选了 180 秒，成片只有 30 秒」）：
#   实测根因 —— 第 6 镜 shot05.mp4 只写了一半（缺 moov atom）→ 拼接时 ffmpeg 到它就
#   `Impossible to open` 中断；而 render_shot / concat_shots **都只看"文件在不在"**，
#   于是 190.4 秒的分镜被静默拼成 30.36 秒（只剩前 5 镜）并当成品交付。
#   这里补一个 ffprobe 真实时长探针，供【逐镜校验 / 拼接校验】用（读不到 = 坏文件）。
FFPROBE_CANDS = [
    os.environ.get('FFPROBE_PATH', ''),
    'C:/ffmpeg/bin/ffprobe.exe',
    os.path.join(os.environ.get('LOCALAPPDATA', ''), 'Microsoft/WinGet/Links/ffprobe.exe'),
    'ffprobe',
]
_FFPROBE_CACHE = {'exe': ''}


def find_ffprobe():
    """定位 ffprobe：优先与 ffmpeg 同目录（服务器自带包可能不在 PATH），其次常见路径。"""
    if _FFPROBE_CACHE['exe']:
        return _FFPROBE_CACHE['exe']
    cand = ''
    try:
        ff = find_ffmpeg()
        d = os.path.dirname(ff)
        if d:
            exe = os.path.join(d, 'ffprobe.exe' if ff.lower().endswith('.exe') else 'ffprobe')
            if os.path.exists(exe):
                cand = exe
    except Exception:
        pass
    if not cand:
        for p in FFPROBE_CANDS:
            if p and (p == 'ffprobe' or os.path.exists(p)):
                cand = p
                break
    _FFPROBE_CACHE['exe'] = cand or 'ffprobe'
    return _FFPROBE_CACHE['exe']


def probe_sec(path):
    """ffprobe 读文件真实时长（秒）；读不到（不存在 / 半截文件 / 坏容器）→ 0.0"""
    if not path or not os.path.exists(path):
        return 0.0
    try:
        r = subprocess.run([find_ffprobe(), '-v', 'error', '-show_entries', 'format=duration',
                            '-of', 'default=noprint_wrappers=1:nokey=1', path],
                           capture_output=True, text=True, encoding='utf-8',
                           errors='replace', timeout=30)
        return float((r.stdout or '').strip() or 0)
    except Exception:
        return 0.0


def probe_stream_sec(path, spec='v:0'):
    """ffprobe 读【指定流】自己的时长（秒）；读不到（无该流 / 值为 N/A）→ 0.0。

    ★VF_MUX_FIX_V1（2026-09-22）：为什么还要单独看"视频轨时长"——
      混音会用 `apad` 把音频补到目标长度，于是一个"画面本来就不够长"的成片，
      **容器时长照样等于目标值**（被补长的音频撑着）→ 只校验容器就漏判。
      实测（本机）：视频 8 秒 + 目标 20 秒 → 容器 20.00 秒（假象），视频轨只有 8 秒。
    """
    if not path or not os.path.exists(path):
        return 0.0
    try:
        r = subprocess.run([find_ffprobe(), '-v', 'error', '-select_streams', spec,
                            '-show_entries', 'stream=duration',
                            '-of', 'default=noprint_wrappers=1:nokey=1', path],
                           capture_output=True, text=True, encoding='utf-8',
                           errors='replace', timeout=60)
        return float((r.stdout or '').strip() or 0)
    except Exception:
        return 0.0


def err_lines(txt, n=3):
    """从 ffmpeg 的 stderr 里挑出【错误行】。

    ffmpeg 就算成功也会往 stderr 打编码统计，直接取尾部（[-300:]）只会看到统计噪音、
    真正的病因（如 `Impossible to open ...` / `Invalid data found`）被截掉 —— 这正是
    "180 秒出 30 秒"当初查不出来的原因之一。
    """
    keys = ('rror', 'Impossible', 'Invalid', 'No such', 'failed', 'Failed')
    ls = [l.strip() for l in str(txt or '').splitlines() if l.strip() and any(k in l for k in keys)]
    return ' | '.join(ls[:n])


def find_ffmpeg():
    for p in FFMPEG_CANDS:
        if not p:
            continue
        if p == 'ffmpeg' or os.path.exists(p):
            return p
    raise RuntimeError('找不到 ffmpeg（设 FFMPEG_PATH 或装到 C:\\ffmpeg\\bin）')


def font_bold(th):
    """★VF_FONTWEIGHT_V1：取【粗体】字体路径（大字/标题/数字/固定标题第 1 行用）。
    找不到粗体文件时**回退到普通字体**（绝不因为少一个字体文件就让整镜失败）。"""
    try:
        p = find_font('msyhbd')
        if p:
            return esc_path(p)
    except Exception:
        pass
    return esc_path(find_font((th or {}).get('font', 'msyh')))


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
    """drawtext 文本转义：冒号/单引号/百分号/反斜杠

    ★VF_PCT_ESCAPE_FIX_V1（2026-09-24 本地实测发现的老 bug）：
      百分号原来只转义一层（`\\%`），但字符串要过【两层解析】（ffmpeg 滤镜参数 → drawtext 文本），
      一层转义会被滤镜参数那层吃掉 → drawtext 看到裸 `%` 就当成展开语法起点 →
      **整条 drawtext 什么都画不出来**。实测：`转化率90%` 的画面是纯空；number 卡的 `%` 后缀
      会让整个大数字消失（`1700%` 递增卡片 = 空白卡）。写成 `\\\\%` 才正确。
      注：`%{eif:...}` 这类**故意**的展开语法不走本函数，不受影响。
    """
    return (str(t).replace('\\', '\\\\').replace(':', r'\:')
            .replace("'", r"\'").replace('%', r'\\%'))


def _big_text(shot, limit=14):
    """取这一镜的"画面大字"。★VF_BIGTEXT_FALLBACK_V1（2026-09-24 服务端实测事故）

    事故：36 镜里有 6 镜【没有大字】，其中一镜是 title 卡 → 整屏只有底色 + 底部字幕，
    连续空白 5 秒，看着像坏掉。根因：上游为治"每条成片画面大字都一样"，把照抄提示词示例
    的词清成了空串（黑名单里就有 AI营销系统/三大能力/效率提升 这类主题词），清完【没有补上】。

    这里做渲染侧的最后一道闸：text/title 都为空时，用【该镜字幕的首句前 10 字】顶上 ——
    保证画面永远有主视觉。只给"没有图、靠大字撑画面"的卡用（title/end）；
    bgimage 已有图，再把字幕前 10 字放大字会与底部字幕重复，故不做兜底。
    """
    t = clean_big_text(shot.get('text') or shot.get('title') or '')
    if t:
        return t[:limit]
    s = ''.join(str(shot.get('subtitle') or '').split())
    if not s:
        return ''
    for sep in ('。', '！', '？', '；', '，', '、', '!', '?', ';', ','):
        if sep in s:
            s = s.split(sep)[0]
            break
    return s[:10]


# ══════════════════ ★VF_TEXTFIT_V2（2026-09-28 用户实测：「成片的文字看着怪怪的」）══════════════════
# 三个"怪"的根因（都在本文件，已逐条定位）：
#   ① 逐字浮现：每个前缀都 x=(w-text_w)/2 重新居中 → 字一边出现一边左右漂移（像在抖）；
#   ② 长句不是折行，而是【一路缩字号】（旧的 VF_TEXTFIT_V1）→ 同一条片里大字忽大忽小；
#   ③ 字幕按 18 字【硬切】换行 → 数字/英文/词被切断，断点看着怪。
# 现在统一：按"估算字宽"量宽 → 折行（大字最多 2 行）→ 真放不下才缩字号（有下限）；
#           逐字浮现用【固定起点】（不再漂移）；字幕优先在标点处断句。
# 说明：drawtext 无法量宽，只能按字符类别估算（CJK/全角≈1 倍字号，半角≈0.55 倍）。


def _char_w(ch, fs):
    return fs * (1.0 if ord(ch) > 0x2E7F else 0.55)


def est_text_w(s, fs):
    return sum(_char_w(c, fs) for c in str(s or ''))


def clean_big_text(s):
    """画面大字清理：去空白 / 成对引号 / 句末标点（AI 偶尔带「，」「。」）"""
    t = str(s or '').strip().strip('“”"\'「」『』【】')
    return t.strip('，。！？；、,.!?;:：').strip()


def wrap_by_width(s, fs, maxw, max_lines=2):
    """按估算宽度折行：中文按字断、英文/数字成串不断；最多 max_lines 行。"""
    s = str(s or '').strip()
    if not s:
        return []
    lines, cur, i, n = [], '', 0, len(s)
    while i < n:
        w = s[i]
        if ord(w) <= 0x2E7F and w.isalnum():
            j = i
            while j < n and ord(s[j]) <= 0x2E7F and s[j].isalnum():
                j += 1
            seg = s[i:j]
        else:
            seg, j = w, i + 1
        if cur and est_text_w(cur + seg, fs) > maxw:
            lines.append(cur)
            cur = ''
            if len(lines) >= max_lines:
                lines.append(s[i:])
                break
            continue
        cur += seg
        i = j
    if cur:
        lines.append(cur)
    return lines


def wrap_balanced(s, fs, maxw, max_lines=2):
    """折行并尽量让各行【等宽】（★VF_TITLEFIT_V3）。
    为什么：旧的"按宽度贪心折行"会产出 `创作不是` + `等`（4+1）这种"尾巴一个字"的难看结果
    （2026-09-29 用户实测原话：「五个字都是下面拖一个字。不是一排」）。
    策略：短句（≤ 每行 4 字）按【字符数均分】；长句才退回按宽度贪心（英文/数字要成串不断）。"""
    s = str(s or '').strip()
    if not s:
        return []
    if max_lines <= 1 or len(s) <= 1:
        return [s]
    if len(s) <= max_lines * 4:
        n = len(s)
        base, extra = divmod(n, max_lines)
        out, i = [], 0
        for k in range(max_lines):
            ln = base + (1 if k < extra else 0)
            if ln <= 0:
                continue
            out.append(s[i:i + ln])
            i += ln
        return [x for x in out if x]
    return wrap_by_width(s, fs, maxw, max_lines)


def fit_big_text(s, W, H, maxw_ratio=0.86, max_lines=2, fs_max=None, fs_min=None, one_line_max=8):
    """画面大字的统一排版：返回 (lines, fs)。

    ★VF_TITLEFIT_V3（2026-09-29 用户实测「不知道控制字大小。五个字都是下面拖一个字。不是一排」）：
      旧逻辑是「先折行，两行都放不下才缩字号」→ 5 个字（128px×5 > 画布宽）必然折成 4+1。
      新规则（按优先级）：
        ① **≤ one_line_max(8) 个字：必须一行** —— 优先缩字号把整句塞进一行（不低于 fs_min）；
        ② 一个字都放不下 / 字数更多 → 折 max_lines 行，且各行**尽量等宽**（wrap_balanced）；
        ③ 仍然放不下才继续缩字号。
      实测（720×1280 竖屏）：4 字→1 行 128px；**5 字→1 行 123px**；6 字→1 行 105px；
      8 字→1 行 77px；10 字→2 行 5+5。"""
    txt = clean_big_text(s)
    fs_max = int(fs_max or max(44, int(H * 0.10)))
    fs_min = int(fs_min or max(30, int(H * 0.052)))
    if not txt:
        return [], fs_max
    maxw = W * maxw_ratio
    # ① 优先一行（本次修的重点）
    if len(txt) <= one_line_max:
        fs = fs_max
        while fs > fs_min:
            if est_text_w(txt, fs) <= maxw:
                return [txt], fs
            fs = max(fs_min, int(fs * 0.96))
        if est_text_w(txt, fs_min) <= maxw:
            return [txt], fs_min
    # ② 折行（尽量等宽）+ 必要时缩字号
    fs = fs_max
    for _ in range(24):
        lines = wrap_balanced(txt, fs, maxw, max_lines)
        if lines and len(lines) <= max_lines and all(est_text_w(l, fs) <= maxw for l in lines):
            return lines, fs
        if fs <= fs_min:
            break
        fs = max(fs_min, int(fs * 0.92))
    return wrap_balanced(txt, fs_min, maxw, max_lines) or [txt], fs_min


def center_lines_drawtext(font, lines, fs, txc, W, H, dur, y_off=0, stroke=True, fade=True,
                          motion='fade'):
    """多行文字各自居中（固定 y，行距 1.34×字号）—— 不用 ASS 覆盖层，也不必测宽。

    ★VF_MOTION_V3（2026-09-29 P1）：新增 motion —— 'fade'（默认，只淡入）/ 'slide'（从下方滑入同时淡入）。
      slide 的 y 是**表达式且含逗号**，所以必须整体加引号写进滤镜串（否则逗号会被当成滤镜分隔符）。
    """
    lines = [l for l in (lines or []) if str(l).strip()]
    if not lines:
        return []
    gap = int(fs * 1.34)
    y0 = int(H * 0.5 - gap * len(lines) * 0.5 + y_off)
    out = []
    for li, ln in enumerate(lines):
        st = (f":borderw={max(2, int(fs * 0.06))}:bordercolor=black@0.72" if stroke else '')
        a = ":alpha='min(t/0.5,1)'" if fade else ''
        _y = y0 + li * gap
        _ys = _slide_y(_y, fs, dur) if motion == 'slide' else str(_y)
        out.append(
            f"drawtext=fontfile='{font}':text='{esc_text(ln)}':fontsize={fs}:"
            f"fontcolor={txc}{st}:x=(w-text_w)/2:y='{_ys}'{a}"
        )
    return out


def big_text_layer(shot, th, W, H, dur, fs_max=None, y_off=0, box=None, stroke=True):
    """统一的【画面大字层】：短句逐字浮现（固定起点、不漂移），长句折两行淡入。"""
    font = esc_path(find_font(th.get('font', 'msyh')))
    txc = th.get('text', 'white')
    txt = _big_text(shot)
    if not txt:
        return [], font, 0
    lines, fs = fit_big_text(txt, W, H, fs_max=fs_max)
    if len(lines) <= 1:
        rev = _reveal_seq(shot, font, fs, txc, dur, text=lines[0], box=box)
        if rev:
            return rev, font, fs
    return center_lines_drawtext(font, lines, fs, txc, W, H, dur, y_off=y_off, stroke=stroke), font, fs


def wrap_subtitle(txt, limit=16, max_lines=2):
    """字幕折行：优先在标点处断（每行 ≤limit 字，最多 max_lines 行），避免把词/数字切断。"""
    s = str(txt or '').strip()
    if not s:
        return ''
    if len(s) <= limit:
        return s
    lines, cur = [], ''
    for ch in s:
        cur += ch
        if ch in '。！？；，、,.!?;:：' and len(cur) >= limit * 0.5:
            lines.append(cur)
            cur = ''
            if len(lines) >= max_lines:
                break
        elif len(cur) >= limit:
            lines.append(cur)
            cur = ''
            if len(lines) >= max_lines:
                break
    if cur:
        lines.append(cur)
    if len(lines) > max_lines:
        lines = lines[:max_lines]
        lines[-1] = ''.join(lines[-1:]) + s[sum(len(x) for x in lines):]
    return '\n'.join(lines[:max_lines])


# ══════════════════ ★VF_OVERLAY_TEXT_SWITCH（2026-09-29 用户定案）══════════════════
# 用户原话：「在视频图片上直接加大字，加一个开关……有的视频不一定要，特别是在视频上直接加大字主要关这个。
#            单独加几帧都行。」
# 语义（重要，别做偏）：
#   · 只关【压在素材上的大字】（bgimage / video / aivideo 三类卡上的 text 叠加层）；
#   · 【独立文字卡】（title / end / list / number / compare / chart / quote）照旧 —— 需要文字时
#     就用这种"单独几帧的文字卡"，等于用户说的"单独加几帧都行"；
#   · 字幕（底部）不受影响。
# 控制方式（两处任选，JSON 优先）：storyboard JSON 的 "overlay_text": false ／ CLI 的 --no-bigtext
SHOW_OVERLAY_TEXT = True


def overlay_text_on():
    return SHOW_OVERLAY_TEXT


# ══════════════════ 配方卡渲染 ══════════════════

# ══════════════════ ★VF_VARIANT_V1 / VF_MOTION_V3（2026-09-29 用户定案 P1）══════════════════
# 用户原话：「单独文字设计能不能挑一些模版去给 AI 去套动效文字排版这些。这个 PPT 风格模版中应该有很多。」
#   上一批做了【主题】（色彩/渐变）；这一批做另外两层：
#     · variant = 版式（同一个卡型的多种排法，如标题卡：居中 / 左对齐 / 色块）
#     · motion  = 入场动效（淡入 / 上滑淡入 / 逐字浮现）
#   AI 可以在分镜里写 theme / variant / motion 三个字段（服务端白名单已兜底，不认识就丢），
#   渲染层这里再做一次白名单 —— AI 自造的值绝不允许把渲染搞挂。
TITLE_VARIANTS = ('center', 'left', 'chip')
LIST_VARIANTS = ('steps', 'stack')
COMPARE_VARIANTS = ('split', 'bar')
MOTIONS = ('fade', 'slide', 'typewriter')


def variant_of(shot, allowed, default):
    v = str((shot or {}).get('variant') or '').strip().lower()
    return v if v in allowed else default


def motion_of(shot):
    """⚠️ 不能复用 variant_of —— 那个读的是 `variant` 字段；motion 要读 `motion`。
    （2026-09-29 自测踩到：写成 variant_of(shot, MOTIONS, 'fade') → motion 永远是 fade。）"""
    m = str((shot or {}).get('motion') or '').strip().lower()
    return m if m in MOTIONS else 'fade'


def _slide_y(base_y, fs, dur):
    """slide 动效：文字从下方约 0.35×字号处滑到位（前 0.4~0.6 秒）。
    drawtext 的 y 支持表达式（含 t），所以不用改别的层。"""
    d = max(0.25, min(0.6, float(dur) * 0.12))
    return f"{base_y}+{int(fs * 0.35)}*max(0,1-t/{d:.2f})"


def card_title(shot, th, W, H, fps):
    """标题卡：大字居中 + 逐字浮现 + 主题色装饰

    ★VF_BIGTEXT_FALLBACK_V1：大字为空时用【该镜字幕首句】兜底 —— 否则这卡就是"整屏空白"
      （用户实测：36 镜里 6 镜没有大字，其中一镜空屏 5 秒）。
    ★VF_CARDSTYLE_V1（2026-09-24 用户："成片的文字画面有点简陋"）：大字上方加一条主题色
      短线 + 通栏细线 —— 纯色底只有一行字太素，靠这条装饰拉开层次，但不喧哗。
    """
    font = font_bold(th)          # ★VF_FONTWEIGHT_V1：标题用粗体（层级感）
    dur = float(shot.get('dur', 3))
    fs = int(shot.get('fontsize', max(64, int(H * 0.13))))
    txc = th.get('text', 'white')
    acc = th.get('accent', '0xff6b35')
    txt = _big_text(shot)
    # ★VF_TEXTFIT_V2（2026-09-28 用户实测「文字看着怪怪的」）：
    #   旧写法是【一路缩字号】——长句字很小、短句字很大，同片里大字忽大忽小、版式不统一。
    #   现在：先折行（最多 2 行，字号基本不变），真放不下才缩字号（有下限）。
    _lines, fs = fit_big_text(txt, W, H, fs_max=fs, max_lines=2)
    # ★VF_VARIANT_V1（2026-09-29 P1「版式变体」）：标题卡三种排法（AI 可写 variant，白名单外的值回 center）
    #   center = 居中大字 + 上方短线（老样式，默认）· left = 左对齐 + 左侧强调竖条（杂志感）
    #   chip   = 强调色色块垫在大字后面（像标签条，适合短口号）
    _var = variant_of(shot, TITLE_VARIANTS, 'center')
    _motion = motion_of(shot)
    _gap_line = int(fs * 1.34)
    _block_top = int(H * 0.5 - _gap_line * len(_lines or [txt]) * 0.5)
    _bar_h = max(6, int(fs * 0.09))
    if _var == 'left':
        # 左对齐：强调竖条 + 每行左端对齐（不再居中）——同一条片里"有对齐关系"看着更高级
        _x0 = int(W * 0.12)
        _bar_x = max(int(W * 0.06), _x0 - int(fs * 0.28))
        parts = [f"drawbox=x={_bar_x}:y={_block_top}:w={max(6, int(fs * 0.10))}:"
                 f"h={_gap_line * len(_lines or [txt]) + int(fs * 0.2)}:color={acc}@0.95:t=fill"]
        for _i, _ln in enumerate(_lines or [txt]):
            _y = _block_top + _i * _gap_line
            _ys = _slide_y(_y, fs, dur) if _motion == 'slide' else str(_y)
            parts.append(
                f"drawtext=fontfile='{font}':text='{esc_text(_ln)}':fontsize={fs}:"
                f"fontcolor={txc}:borderw={max(2, int(fs * 0.05))}:bordercolor=black@0.6:"
                f"x={_x0}:y='{_ys}':alpha='min(t/0.45,1)'")
        body = ','.join(parts)
        deco = ''
    elif _var == 'chip':
        # 色块版式：强调色半透明宽带垫在大字块后面（"标签条"观感）
        _band_y = _block_top - int(fs * 0.22)
        _band_h = _gap_line * len(_lines or [txt]) + int(fs * 0.30)
        deco = (f"drawbox=x={int(W * 0.07)}:y={_band_y}:w={int(W * 0.86)}:h={_band_h}:"
                f"color={acc}@0.82:t=fill")
        body = ','.join(center_lines_drawtext(font, _lines or [txt], fs, 'white', W, H, dur,
                                              motion=_motion))
    else:
        # center：老样式（短线 + 通栏细线，放在大字块正上方）
        _dy = max(int(H * 0.05), _block_top - int(fs * 0.66))
        deco = ','.join([
            f"drawbox=x={int(W * 0.10)}:y={_dy}:w={int(W * 0.10)}:h={_bar_h}:color={acc}@0.95:t=fill",
            f"drawbox=x={int(W * 0.22)}:y={_dy + _bar_h // 2}:w={int(W * 0.68)}:h=2:color={txc}@0.16:t=fill",
        ])
        _rev = []
        if _motion == 'typewriter' and len(_lines) <= 1:
            _rev = _reveal_seq(shot, font, fs, txc, dur, text=(_lines[0] if _lines else txt))
        body = ','.join(_rev) if _rev else ','.join(
            center_lines_drawtext(font, _lines or [txt], fs, txc, W, H, dur, motion=_motion))
    if _var != 'center':
        print('[VF] 标题卡版式 = %s（motion=%s）' % (_var, _motion))
    vf = ','.join([p for p in (deco, body) if p])
    return (f"-f lavfi -i color=c={th.get('bg', '0x0a1620')}:s={W}x{H}:d={dur}",
            vf, dur)


def _norm_items(shot):
    """取出"列表类"卡的条目，并做健壮化（★VF_EMPTYITEMS_V1，2026-09-24 服务端实测事故）。

    事故：AI 排出的 list 卡，条目全是照抄提示词示例的词（写文案/做视频/自动发布…）→
    服务端"示例词黑名单"(VF_NOCLONE_V1) 把它们全清掉 → `items` 变成**空数组** →
    card_list 返回**空滤镜串** → ffmpeg 报 `No such filter: ''` → 整镜失败 → 整片出不来。

    这里只做"把条目读出来并洗干净"，不含任何内容过滤（那是服务端的事）：
      ① 兼容 dict 条目（取 text/label/title/value）
      ② 兼容别名（points / lines / bullets / list / steps）
      ③ 空条目、空白条目直接丢掉
    """
    for k in ('items', 'points', 'lines', 'bullets', 'list', 'steps'):
        v = shot.get(k)
        if not isinstance(v, list) or not v:
            continue
        out = []
        for it in v:
            if isinstance(it, dict):
                t = it.get('text') or it.get('label') or it.get('title') or it.get('value')
            else:
                t = it
            t = str(t or '').strip()
            if t:
                out.append(t)
        if out:
            return out
    return []


def _fallback_big_text(shot, th, W, H, fs):
    """列表/图表卡【没有可用条目】时的兜底滤镜：把该镜的 text/title/subtitle 画成居中大字。

    ★VF_EMPTYITEMS_V1：宁可这一镜样式朴素，也绝不能让滤镜串为空导致【整镜失败、整片不出片】。
    """
    txt = str(shot.get('text') or shot.get('title') or shot.get('subtitle') or '').strip()
    if not txt:
        return []
    font = esc_path(find_font(th.get('font', 'msyh')))
    acc = th.get('accent', '0xff6b35')
    _t20 = txt[:20]
    # ★VF_TEXTFIT_V1：同样按字数反算字号，避免长句被切边
    _fs = min(int(fs * 1.2), max(int(H * 0.05), int(W * 0.86 / max(1, len(_t20)))))
    return [
        f"drawtext=fontfile='{font}':text='{esc_text(_t20)}':fontsize={_fs}:"
        f"fontcolor={acc}:x=(w-text_w)/2:y=(h-text_h)/2:alpha='min(t/0.5,1)'"
    ]


def card_list(shot, th, W, H, fps):
    """列表逐项揭示：一项 = 一步（严禁一次全上）"""
    font = esc_path(find_font(th.get('font', 'msyh')))
    items = _norm_items(shot)      # ★VF_EMPTYITEMS_V1：兼容 dict/别名/空，绝不再让 items 为空数组坑到滤镜
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
    # ★VF_VARIANT_V1（2026-09-29 P1）：列表卡两种版式（AI 可写 variant，白名单外的值回 steps）
    #   steps（默认，老样式）= 一项=一步、逐项揭示（讲解节奏）· stack = 整板同时出现 + 每项前强调色方块（"清单"观感）
    _var = variant_of(shot, LIST_VARIANTS, 'steps')
    for i, it in enumerate(items):
        t_on = 0.5 + i * step
        if _var == 'stack':
            _iy = y0 + i * int(fs * 1.5)
            alpha = "min(max(t-0.35,0)/0.45,1)"
            parts.append(
                f"drawbox=x={int(W * 0.10)}:y={_iy + int(fs * 0.40)}:w={int(fs * 0.34)}:h={int(fs * 0.34)}:"
                f"color={acc}@0.95:t=fill")
            parts.append(
                f"drawtext=fontfile='{font}':text='{esc_text(it)}':fontsize={fs}:"
                f"fontcolor={txc}:x={int(W * 0.19)}:y={_iy}:alpha='{alpha}'")
            continue
        # 渐入；后面项出现时前面的项【保留但变暗】= 灰化作上下文
        alpha = f"if(lt(t,{t_on:.2f}),0,min((t-{t_on:.2f})/0.4,1))"
        parts.append(
            f"drawtext=fontfile='{font}':text='{esc_text(it)}':fontsize={fs}:"
            f"fontcolor={txc}:x={int(W * 0.12)}:y={y0 + i * int(fs * 1.7)}:alpha='{alpha}'")
    if _var == 'stack':
        print('[VF] 列表卡版式 = stack（整板出现 + 强调色方块）')
    vf = ','.join(parts)
    if not vf:
        # ★VF_EMPTYITEMS_V1：没有标题也没有条目 → 绝不许返回空串（那会让整镜 ffmpeg 报
        #   `No such filter: ''` → 整片不出）。降级成"把该镜文案画成大标题"。
        print('[VF] ⚠️ list 卡没有可用条目 → 降级为居中大字（%s）' % str(shot.get('subtitle') or shot.get('text') or '')[:24])
        vf = ','.join(_fallback_big_text(shot, th, W, H, fs))
    return (f"-f lavfi -i color=c={th.get('bg', '0x0a1620')}:s={W}x{H}:d={dur}",
            vf, dur)


def card_number(shot, th, W, H, fps):
    """大数字递增（★VF_NUMBERGUARD_V1：数字无意义时降级为标题卡）"""
    # ★VF_NUMBERGUARD_V1（2026-09-24 用户实拍"0↑ 策略"那种画面）：
    #   AI 偶尔给 `value: 0`（或写成非数字）→ 0 递增出来的还是 0，画面等于没信息；
    #   非数字还会让 int() 抛错 → 整镜失败。这两种情况都当标题卡处理（用 label/text/字幕撑画面）。
    try:
        _v = float(str(shot.get('value', 100)).strip())
    except Exception:
        _v = -1.0
    if _v < 2:
        print('[VF] ⚠️ number 卡的数字无意义（value=%s）→ 降级为标题卡' % str(shot.get('value'))[:20])
        _s2 = dict(shot)
        _s2['text'] = str(shot.get('label') or shot.get('text') or '').strip()
        return card_title(_s2, th, W, H, fps)

    font = font_bold(th)          # ★VF_FONTWEIGHT_V1：大数字用粗体（数字粗细最影响观感）
    val = int(_v)
    suf = esc_text(shot.get('suffix', ''))
    dur = float(shot.get('dur', 3))
    fs = int(shot.get('fontsize', max(90, int(H * 0.22))))
    acc, txc = th.get('accent', '0xff6b35'), th.get('text', 'white')
    # ★VF_TEXTFIT_V1：数字+后缀一起按字数反算字号（实测 '1700%' 在 fs=281 时宽约 1000px
    #   > 720px，两边都被切掉；`%` 修好之后这个溢出才暴露出来）
    _ntxt = str(val) + str(shot.get('suffix', ''))
    fs = min(fs, max(int(H * 0.06), int(W * 0.86 / max(1, len(_ntxt)))))
    # ★VF_VARIANT_V1（2026-09-29 P1「number 卡版式变体」）：center（默认居中）/ left（左对齐）
    _var = variant_of(shot, ('center', 'left'), 'center')
    if _var == 'left':
        _x0 = int(W * 0.10)
        _lparts = [
            f"drawtext=fontfile='{font}':text='%{{eif\\:min(t*{val / max(dur * 0.66, 0.1):.1f}\\,{val})\\:d}}{suf}':"
            f"fontsize={fs}:fontcolor={acc}:x={_x0}:y=(h-text_h)/2-{int(H * 0.06)}",
            f"drawbox=x={_x0}:y={int(H * 0.5) + int(fs * 0.42)}:w={int(W * 0.18)}:"
            f"h={max(6, int(fs * 0.06))}:color={acc}@0.95:t=fill",
        ]
        if shot.get('label'):
            _lparts.append(
                f"drawtext=fontfile='{font}':text='{esc_text(shot['label'])}':fontsize={int(fs * 0.28)}:"
                f"fontcolor={txc}:x={_x0}:y={int(H * 0.5) + int(fs * 0.62)}:alpha='min(t/0.8,1)'")
        print('[VF] 数字卡版式 = left（左对齐）')
        return (f"-f lavfi -i color=c={th.get('bg', '0x0a1620')}:s={W}x{H}:d={dur}",
                ','.join(_lparts), dur)
    _cy = int(H * 0.5)
    parts = [
        # ★VF_CARDSTYLE_V1：数字下方一条主题色短线 —— 别让一个数字孤零零悬在黑底上
        f"drawbox=x={int(W * 0.38)}:y={_cy + int(fs * 0.30)}:w={int(W * 0.24)}:h={max(6, int(fs * 0.06))}:color={acc}@0.95:t=fill",
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
    """视频片段：截取 + 缩放（不裁切）+ 压暗/大字（与 bgimage/aivideo 观感统一）

    ★VF_VIDEOLINE_V1（2026-09-24 用户定案「视频混剪」——把用户的视频**完整片段**插进成片）：
      1) 起点字段兼容 `start` / `vstart`（视频混剪线写的是 vstart）。
      2) **片段比镜短时的兜底**：原来只 `trim` 到 dur，片段不够长就会【黑尾/冻帧】——
         现在与 card_aivideo 同款：先轻微放慢（≤1.35 倍，避免明显慢动作），再 `-stream_loop -1` 循环补足。
         （理想情况：视频混剪线会在排分镜时把该镜文案写到与视频等长 → 这里只是兜底。）
      3) 观感统一：全屏轻压 15% + 底部字幕区再压 30% + 画面大字逐字浮现（与 bgimage 同款），
         避免"图片镜有压暗/大字、视频镜没有"的割裂感。
    """
    src = shot.get('src', '')
    dur = float(shot.get('dur', 5))
    start = float(shot.get('vstart', shot.get('start', 0)) or 0)
    src_dur = float(shot.get('src_dur', 0) or 0)      # 片段自身秒数（视频混剪线写入）
    avail = max(0.0, src_dur - start) if src_dur > 0.2 else 0.0
    k = 1.0
    if avail > 0.2 and dur > avail:
        k = min(1.35, dur / avail)
    _slow = '' if k <= 1.001 else 'setpts=PTS*%.4f,' % k
    font = esc_path(find_font(th.get('font', 'msyh')))
    fs = int(shot.get('fontsize', max(54, int(H * 0.10))))
    txc = th.get('text', 'white')
    # ★VF_TEXTFIT_V2（2026-09-28）：折行优先（最多 2 行），放不下才缩字号 ——
    #   不再"长句一路缩成小字"（那是"同片里大字忽大忽小"的根因）。
    _lines, fs = fit_big_text(str(shot.get('text') or ''), W, H, fs_max=fs, max_lines=2)
    _rev = _reveal_seq(shot, font, fs, txc, dur, text=_lines[0], box='black@0.30') if len(_lines) <= 1 else []
    # ★OVERLAY_TEXT_SWITCH_V1：开关关闭 → 这一镜不叠大字（压暗与字幕照旧）
    _reveal = (_rev if _rev else center_lines_drawtext(font, _lines, fs, txc, W, H, dur)) if overlay_text_on() else []
    _bar_y = int(H * 0.72)
    _chain = [
        f"drawbox=x=0:y=0:w={W}:h={H}:color=black@0.15:t=fill",
        f"drawbox=x=0:y={_bar_y}:w={W}:h={H - _bar_y}:color=black@0.30:t=fill",
    ] + _reveal
    vf = (
        f"split=2[bg0][fg0];"
        f"[bg0]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},gblur=sigma=32,eq=brightness=-0.18[bgb];"
        f"[fg0]scale={W}:{H}:force_original_aspect_ratio=decrease[fgs];"
        f"[bgb][fgs]overlay=(W-w)/2:(H-h)/2,"
        # ★2026-09-20：视频片段同样不再裁切（模糊铺底 + 完整画面居中）
        f"{_slow}" + ','.join(_chain) + ','
        f"trim=duration={dur},setpts=PTS-STARTPTS,format=yuv420p"
    )
    if k > 1.001:
        print('[VF]   视频镜时长对齐：可用 %.1fs → 镜 %.1fs（放慢 %.2f 倍）' % (avail, dur, k))
    elif avail > 0.2 and dur > avail:
        print('[VF]   视频镜时长对齐：可用 %.1fs < 镜 %.1fs → 循环补足' % (avail, dur))
    # -stream_loop -1：片段不够长时循环补足（配合上面的放慢，双保险不出现黑尾/冻帧）
    return (f"-ss {start} -stream_loop -1 -t {dur} -i \"{src}\"", vf, dur)


def card_aivideo(shot, th, W, H, fps):
    """★VF_AIVIDEO_V1（2026-09-20）：AI 生成的视频片段（MiniMax H3 / 百炼 wan 降级）

    与 card_video 的区别（这是「AI 直接成片」的镜头源）：
      1) **时长自适应**：AI 片段是**整数秒**（H3 支持 4~15s），而配音是小数秒
         （如 7.2s）→ 片段比目标短时用 setpts **轻微放慢**补足（上限 1.35 倍，避免明显慢动作）；
         若放慢到上限仍不够，用 -stream_loop -1 **循环**兜底（宁可循环也不要黑尾/冻结）。
      2) **不加 Ken Burns 推拉**：画面本身在动，再推拉会晕。
      3) **不带声音**：AI 片段自带音轨 → 渲染时统一 `-an`（音频由后面 mux_audio 铺人声+BGM）。
    """
    src = shot.get('src', '')
    dur = float(shot.get('dur', 5))
    # src_dur：片段自身秒数（由 make.py 生成时用 ffprobe 写入；缺省 0 = 未知，则不放慢只循环兜底）
    src_dur = float(shot.get('src_dur', 0) or 0)
    k = 1.0
    if src_dur > 0.2 and dur > src_dur:
        k = min(1.35, dur / src_dur)
    _slow = '' if k <= 1.001 else 'setpts=PTS*%.4f,' % k
    # ★VF_AIVIDEO_V2（2026-09-20）：**补齐「压暗 + 画面大字」** ——
    #   原来这里只有"视频 + 模糊铺底"，导致 AI 模式成片：① **没有画面标语**（素材合成有，AI 模式没有）
    #   ② **字幕没对比度**（AI 片段的亮度完全不受控，字幕压在亮画面上会看不清）。
    #   现复用 card_bgimage 的同款处理：全屏压 15% + 底部字幕区压 30% + 画面大字逐字浮现。
    #   大字取 shot['text']（gen_ai_clips 只改 type/src/src_dur，text 本就保留）。
    font = esc_path(find_font(th.get('font', 'msyh')))
    fs = int(shot.get('fontsize', max(54, int(H * 0.10))))
    txc = th.get('text', 'white')
    _reveal = _reveal_seq(shot, font, fs, txc, dur) if overlay_text_on() else []   # ★OVERLAY_TEXT_SWITCH_V1
    _bar_y = int(H * 0.72)
    _chain = [
        f"drawbox=x=0:y=0:w={W}:h={H}:color=black@0.15:t=fill",
        f"drawbox=x=0:y={_bar_y}:w={W}:h={H - _bar_y}:color=black@0.30:t=fill",
    ] + _reveal
    vf = (
        f"split=2[bg0][fg0];"
        f"[bg0]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},gblur=sigma=32,eq=brightness=-0.18[bgb];"
        f"[fg0]scale={W}:{H}:force_original_aspect_ratio=decrease[fgs];"
        f"[bgb][fgs]overlay=(W-w)/2:(H-h)/2,"
        f"{_slow}" + ','.join(_chain) + ','
        f"trim=duration={dur},setpts=PTS-STARTPTS,format=yuv420p"
    )
    if k > 1.001:
        print('[VF]   aivideo 时长对齐：片段 %.0fs → 镜 %.1fs（放慢 %.2f 倍）' % (src_dur, dur, k))
    # -stream_loop -1：片段不够长时循环补足（配合上面的放慢，双保险不出现黑尾）
    return (f"-stream_loop -1 -t {dur} -i \"{src}\"", vf, dur)


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
    fs0 = int(shot.get('fontsize', max(40, int(H * 0.07))))
    acc, txc = th.get('accent', '0xff6b35'), th.get('text', 'white')
    mid = W // 2
    # ★VF_COMPARE_FIT_V1（2026-09-29 用户实测「排版有很多问题」；本机成片逐帧量到：
    #   t≈49~53s 一根贯穿全屏的橙竖线、x=360（720 宽画布正中）、左右两列文字互相压着）：
    #   老实现左右两列是【固定 x、完全不限宽】（左 x=0.06W、右 x=0.56W）——
    #   文字一长，左列就【越过中线压到右列】上；再叠上中间那根"设计用竖线"，
    #   观感就是"橙竖线穿过互相压着的白字/橙字"（与代码 mid=W//2 完全吻合）。
    #   修法：左右各自限宽（≤42% 画布宽）→ 超宽先折行、再缩字号；两列各自在半个画面内居中。
    col_w = int(W * 0.42)
    lcx, rcx = int(W * 0.26), int(W * 0.74)
    # ★VF_VARIANT_V1（2026-09-29 P1）：对比卡两种版式 —— split（默认，左右分栏）/ bar（上下两条）
    #   ⚠️ 诚实说明：上一批我先把 'bar' 写进了白名单却没实现渲染（会被静默忽略），这里补上。
    #   为什么需要 bar：竖屏 720 宽时左右分栏每列只有 0.42 宽（≈302px），稍长的词就要缩字号；
    #   上下堆叠每条能吃满宽度，字更大、更清楚。
    _var = variant_of(shot, COMPARE_VARIANTS, 'split')

    def _wrap_hard(t, fs, max_lines):
        """★硬上限折行：wrap_by_width 在"到上限后把剩余全塞进最后一行"（会多出一行），
           这里传 max_lines-1 抵消，保证【最多 max_lines 行】。"""
        return wrap_by_width(t, fs, col_w, max(1, max_lines - 1))

    def _fit(text, fs0, max_lines, fs_min=22):
        """折行 + 逐步缩字号 + 兜底截断 → (lines, fs, cut)，保证 ≤ max_lines 行且每行 ≤ col_w"""
        t = str(text or '').strip().strip('“”"\'「」')
        if not t:
            return [], fs0, False
        fs = fs0
        while fs > fs_min:
            lines = _wrap_hard(t, fs, max_lines)
            if lines and all(est_text_w(l, fs) <= col_w for l in lines):
                return lines, fs, False
            fs -= 2
        lines = _wrap_hard(t, fs_min, max_lines)
        out = []
        for ln in lines:
            s = ''
            for c in ln:
                if est_text_w(s + c + '…', fs_min) > col_w:
                    s = s.rstrip() + '…'
                    break
                s += c
            out.append(s or ln[:1])
        return out, fs_min, True

    # ★VF_COMPARE_FIT_V2（2026-09-29 本机就地渲染实测发现，工具见 scripts/vf-local.mjs）：
    #   ① 两列【各自】缩字号 → 左 59 / 右 75，左右大小不一、看着不齐；
    #   ② 说明小字写死 y=0.30H → 主文字块折到 4 行时会【被压住】。
    #   现在：两列共用【同一个字号】（取各自能放下的较小值）重新折行；说明小字排在主块【下方】。
    _l0, _f_l, _ = _fit(shot.get('left'), fs0, 3)
    _r0, _f_r, _ = _fit(shot.get('right'), fs0, 3)
    fs_main = min([x for x in (_f_l, _f_r) if x] or [fs0])
    left_lines = _wrap_hard(str(shot.get('left') or '').strip().strip('“”"\'「」'), fs_main, 3)
    right_lines = _wrap_hard(str(shot.get('right') or '').strip().strip('“”"\'「」'), fs_main, 3)
    for _t, _ls in ((shot.get('left'), left_lines), (shot.get('right'), right_lines)):
        if _ls and any(est_text_w(l, fs_main) > col_w for l in _ls):
            print('[VF] ⚠️ 对比卡文字偏长 → 已按列宽尽量折行：%s' % str(_t)[:24])

    def _col(lines, cx, color, y, fs, alpha, center_at=True):
        """把若干行文字在本列中心居中输出（center_at=False 时 y 视为首行顶部）"""
        if not lines:
            return []
        gap = int(fs * 1.35)
        y0 = (y - (gap * (len(lines) - 1)) // 2) if center_at else y
        out = []
        for i, ln in enumerate(lines):
            st = f":borderw={max(2, int(fs * 0.06))}:bordercolor=black@0.72"
            out.append(
                f"drawtext=fontfile='{font}':text='{esc_text(ln)}':fontsize={fs}:"
                f"fontcolor={color}{st}:x={cx}-text_w/2:y={y0 + i * gap}{alpha}"
            )
        return out

    if _var == 'bar':
        # 上下两条版式：上=左项（强调色），中间细分割线，下=右项（正文色）。
        # ★2026-09-29 自测发现：一开始把说明小字写成固定 y → 它**压在主文字块上**（与上次对比卡折行
        #   压字是同一类问题）。现在把 [主文字块 + 说明小字] 当成**一个整体**垂直居中，
        #   小字永远贴在主块真实底部之下。
        _fsd = max(20, int(fs0 * 0.55))
        _ld2, _f3, _ = _fit(shot.get('leftDesc'), _fsd, 2)
        _rd2, _f4, _ = _fit(shot.get('rightDesc'), _fsd, 2)
        _fsd2 = min([x for x in (_f3, _f4) if x] or [_fsd])
        _gapb = int(fs_main * 1.35)
        _gapd = int(_fsd2 * 1.45)

        def _bgroup(lines, desc, cy, color, alpha, delay):
            """[主块 + 说明] 作为整体居中在 cy；返回该组滤镜"""
            rows = max(1, len(lines))
            dn = len([x for x in (desc or [])])
            total = _gapb * rows + (_gapd * dn if dn else 0)
            top = cy - total // 2
            out = _col(lines, int(W * 0.5), color, top + (_gapb * (rows - 1)) // 2, fs_main, alpha)
            if dn:
                out += _col(desc, int(W * 0.5), txc + '@0.75',
                            top + _gapb * rows + int(_gapd * 0.2), _fsd2,
                            ":alpha='min(max(t-%s,0)/0.5,1)'" % delay, center_at=False)
            return out

        bparts = []
        bparts += _bgroup(left_lines, _ld2, int(H * 0.27), acc, ":alpha='min(t/0.5,1)'", '0.50')
        bparts.append(f"drawbox=x={int(W * 0.10)}:y={int(H * 0.50)}:w={int(W * 0.80)}:h=3:"
                      f"color={acc}@0.55:t=fill")
        bparts += _bgroup(right_lines, _rd2, int(H * 0.73), txc,
                          ":alpha='min(max(t-0.35,0)/0.5,1)'", '0.70')
        print('[VF] 对比卡版式 = bar（上下两条）')
        return (f"-f lavfi -i color=c={th.get('bg', '0x0a1620')}:s={W}x{H}:d={dur}",
                ','.join(bparts), dur)
    parts = []
    _y_main = int(H * 0.22)
    parts += _col(left_lines, lcx, txc, _y_main, fs_main, ":alpha='min(t/0.5,1)'")
    parts += _col(right_lines, rcx, acc, _y_main, fs_main, ":alpha='min(max(t-0.4,0)/0.5,1)'")
    # ★VF_COMPARE_NOLINE_V1（2026-09-29 用户定案）：**去掉中轴竖线**。
    #   原设计是"高度随时间生长"的分隔线，但实测成片里它就是一条【贯穿大半个屏幕的橙线】，
    #   观感像"画面被劈开 / 渲染坏了"（用户第一次截图报的就是它）。左右两列靠对齐本就分得清，
    #   不需要这根线。哪天想恢复：把下面这段 drawbox 放回来即可（`mid` 变量仍在）。
    # parts.append(
    #     f"drawbox=x={mid - 2}:y={int(H * 0.14)}:w=4:h='{int(H * 0.72)}*min(max(t-0.2,0)/0.6,1)':"
    #     f"color={acc}@0.9:t=fill")
    # 说明小字：排在主文字块【下方】（实测踩过：写死 0.30H 会被折行后的主块压住）
    _gap_main = int(fs_main * 1.35)
    _rows = max(1, max(len(left_lines), len(right_lines)))
    _y0_main = _y_main - (_gap_main * (_rows - 1)) // 2
    _main_bottom = _y0_main + _gap_main * (_rows - 1) + int(fs_main * 1.05)
    _y_desc = min(int(H * 0.74), _main_bottom + int(fs_main * 0.5))
    _fs2 = max(20, int(fs0 * 0.55))
    _ld, _f_ld, _ = _fit(shot.get('leftDesc'), _fs2, 2)
    _rd, _f_rd, _ = _fit(shot.get('rightDesc'), _fs2, 2)
    _fsd = min([x for x in (_f_ld, _f_rd) if x] or [_fs2])
    parts += _col(_ld, lcx, txc + '@0.75', _y_desc, _fsd, ":alpha='min(max(t-0.8,0)/0.5,1)'", center_at=False)
    parts += _col(_rd, rcx, txc + '@0.75', _y_desc, _fsd, ":alpha='min(max(t-1.2,0)/0.5,1)'", center_at=False)
    return (f"-f lavfi -i color=c={th.get('bg', '0x0a1620')}:s={W}x{H}:d={dur}",
            ','.join(parts), dur)


def card_chart(shot, th, W, H, fps):
    """横条生长：每项一条，长度按 value 比例增长（适合"数据/排名"）"""
    font = esc_path(find_font(th.get('font', 'msyh')))
    items = shot.get('items', [])          # [{label, value}]
    # ★VF_EMPTYITEMS_V1：健壮化 —— 非 list（AI 偶尔给对象/字符串）、或条目不是 dict 的情况都兜住，
    #   空条目会让 parts 为空 → 滤镜串为空 → ffmpeg 报 `No such filter: ''` → 整片出不来。
    if not isinstance(items, list):
        items = []
    items = [it if isinstance(it, dict) else {'label': str(it or ''), 'value': 0}
             for it in items if str(it or '').strip() or isinstance(it, dict)]
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
    # ★VF_VARIANT_V1（2026-09-29 P1「chart 卡版式变体」）：bars（默认，左起向右生长）/
    #   rtl（从右往左生长；标签在右、数值在左 —— 排名类数据"从右往左"更符合阅读直觉）
    _var = variant_of(shot, ('bars', 'rtl'), 'bars')
    _fb = font_bold(th)
    for i, it in enumerate(items):
        v = float(it.get('value', 0))
        t_on = 0.4 + i * 0.5
        _bw = int(bar_max * v / mx)
        w_expr = '%d*min(max(t-%.2f,0)/0.8,1)' % (_bw, t_on)
        yb = y0 + i * int(fs * 2.1)
        if _var == 'rtl':
            _x_r = int(W * 0.92)
            parts.append(f"drawbox=x='{_x_r}-{w_expr}':y={yb}:w='{w_expr}':h={int(fs * 0.7)}:"
                         f"color={acc}@0.85:t=fill")
            parts.append(f"drawtext=fontfile='{_fb}':text='{esc_text(it.get('label', ''))}':fontsize={fs}:"
                         f"fontcolor={txc}:x={int(W * 0.94)}-text_w:y={yb - int(fs * 0.05)}:alpha='min(max(t-%.2f,0)/0.5,1)'" % t_on)
            parts.append(f"drawtext=fontfile='{_fb}':text='{esc_text(str(it.get('value', '')))}':fontsize={int(fs * 0.9)}:"
                         f"fontcolor={txc}:x={int(W * 0.06)}:y={yb - int(fs * 0.1)}:alpha='min(max(t-%.2f,0)/0.5,1)'"
                         % (t_on + 0.3))
            continue
        parts.append(f"drawbox=x={int(W * 0.32)}:y={yb}:w='{w_expr}':h={int(fs * 0.7)}:"
                     f"color={acc}@0.85:t=fill")
        parts.append(f"drawtext=fontfile='{_fb}':text='{esc_text(it.get('label', ''))}':fontsize={fs}:"
                     f"fontcolor={txc}:x={int(W * 0.08)}:y={yb - int(fs * 0.05)}:alpha='min(max(t-%.2f,0)/0.5,1)'" % t_on)
        parts.append(f"drawtext=fontfile='{_fb}':text='{esc_text(str(it.get('value', '')))}':fontsize={int(fs * 0.9)}:"
                     f"fontcolor={txc}:x={int(W * 0.96)}:y={yb - int(fs * 0.1)}:alpha='min(max(t-%.2f,0)/0.5,1)'"
                     % (t_on + 0.3))
    if _var == 'rtl':
        print('[VF] 图表卡版式 = rtl（从右往左）')
    vf = ','.join(parts)
    if not vf:
        # ★VF_EMPTYITEMS_V1：chart 卡同样兜底（空条目 → 降级成居中大字，绝不返回空串）
        print('[VF] ⚠️ chart 卡没有可用条目 → 降级为居中大字（%s）'
              % str(shot.get('subtitle') or shot.get('text') or '')[:24])
        vf = ','.join(_fallback_big_text(shot, th, W, H, fs))
    return (f"-f lavfi -i color=c={th.get('bg', '0x0a1620')}:s={W}x{H}:d={dur}",
            vf, dur)


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


# ══════════════════ ★VF_MATGUARD_V1（2026-09-29）素材体检 ══════════════════
# 用户实测原话：「都是图片加打字……字体很干，也没什么动效色彩啊渐变 什么都没 就几个白字」
#   根因之一：素材本身是【深色界面截图 / 自带大字的拼贴海报】，我们却一律"模糊铺底+压暗+居中白字"，
#   于是同一条片成了"黑底白字轮播"。这里给素材做一次体检，据此决定怎么用：
#     ① 深色（平均亮度 < 78）→ 少压暗，让素材的色透出来（否则成片发黑）
#     ② 满字（边缘密度 > 0.11）→ 我们的大字缩小 + 加实底衬（避免"字压字"打架）
#    ③ 又深又满字（典型：深色 UI 截图）→ 【换主题质感底板】，不硬塞这张图（= 规划里"缺就承认缺"）
_MAT_CACHE = {}


def _probe_material(path):
    """素材体检：返回 {'lum','edge','flat'} ——
      · lum  平均亮度 0~255（深色素材 → 少压暗，否则成片发黑）
      · edge 边缘密度 0~1（字/图案多不多）
      · flat 【主色占比】0~1 —— 照片 vs 截图/海报的经典判别：截图/海报有大片纯色底（UI 背景、海报底色），
             照片则颜色连续、主色占比很低。比 edge 稳得多（2026-09-29 用合成图实测 edge 会误判）。
    注：卡片函数拿不到 render_shot 的 ffmpeg 参数 → 这里自己 find_ffmpeg()（只做路径检查，无子进程）。"""
    try:
        key = str(path)
        hit = _MAT_CACHE.get(key)
        if hit:
            return hit
    except Exception:
        key = ''
    lum, edge, flat = 160, 0.0, 0.0
    try:
        ff = find_ffmpeg()
    except Exception:
        return {'lum': lum, 'edge': edge, 'flat': flat}
    try:
        rgb = _avg_rgb(path, ff)
        if rgb:
            lum = int(0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2])
    except Exception:
        pass
    try:
        # 缩小到 240 宽再检测边缘：文件越小越快，够判断"有没有很多字/图案"。
        r = subprocess.run([ff, '-v', 'error', '-i', path,
                            '-vf', 'scale=240:-2,format=gray,edgedetect=low=0.08:high=0.25',
                            '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'],
                           capture_output=True, timeout=25)
        b = r.stdout or b''
        if b:
            hits = sum(1 for x in b if x > 40)
            edge = hits / float(len(b))
    except Exception:
        pass
    try:
        # 64×64 灰度直方图 → 主色占比（只需 4096 字节，极快）
        r = subprocess.run([ff, '-v', 'error', '-i', path, '-vf', 'scale=64:64,format=gray',
                            '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'],
                           capture_output=True, timeout=20)
        b = r.stdout or b''
        if b:
            hist = {}
            for x in b:
                hist[x] = hist.get(x, 0) + 1
            flat = max(hist.values()) / float(len(b))
    except Exception:
        pass
    # ★VF_MATGUARD_V2（2026-09-29 P1「更聪明的素材避让」）：把素材竖切成 3 条分别量"内容密度"，
    #   挑【最空】的一条当大字落点 —— 一律居中压在大字海报正中间最容易"字压字"。
    band = 1
    try:
        _dens = []
        for _bi in range(3):
            _rb = subprocess.run([ff, '-v', 'error', '-i', path,
                                  '-vf', 'crop=iw:ih/3:0:ih*%d/3,scale=240:-2,format=gray,'
                                         'edgedetect=low=0.08:high=0.25' % _bi,
                                  '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'],
                                 capture_output=True, timeout=20)
            _bb = _rb.stdout or b''
            _dens.append((sum(1 for x in _bb if x > 40) / float(len(_bb))) if _bb else 1.0)
        band = int(min(range(3), key=lambda k: _dens[k]))
    except Exception:
        band = 1
    out = {'lum': lum, 'edge': edge, 'flat': flat, 'band': band}
    if key:
        _MAT_CACHE[key] = out
    return out


def _shade(hex_color, k):
    """把颜色变暗（k<1）或变亮（k>1）——用于"渐变第二色"没给时按底板色推一个（主题质感底板用）"""
    try:
        h = str(hex_color).replace('0x', '').replace('#', '')
        r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    except Exception:
        r, g, b = 10, 22, 32
    f = lambda v: max(0, min(255, int(v * k)))
    return '0x%02x%02x%02x' % (f(r), f(g), f(b))


_HAS_GRAD = None


def _has_gradients(ffmpeg):
    """探测本机 ffmpeg 是否支持 gradients 源滤镜（支持→用它做渐变底板；不支持→退回纯色+几何装饰）。
    只探测一次并缓存；服务器 ffmpeg 版本不一，不能假设它一定有。"""
    global _HAS_GRAD
    if _HAS_GRAD is None:
        try:
            r = subprocess.run([ffmpeg, '-hide_banner', '-v', 'error',
                                '-f', 'lavfi', '-i', 'gradients=s=8x8:c0=black:c1=white:d=0.1',
                                '-frames:v', '1', '-f', 'null', '-'],
                               capture_output=True, timeout=15)
            _HAS_GRAD = (r.returncode == 0)
        except Exception:
            _HAS_GRAD = False
        print('[VF] gradients 滤镜可用: %s' % ('是' if _HAS_GRAD else '否（退回纯色底板）'))
    return _HAS_GRAD


def stage_layer(th, W, H, dur, accent_bar=True):
    """★VF_STAGE_V1（2026-09-29）**主题质感底板**：渐变底 + 几何装饰（替代"黑底白字"）。

    用途：① 素材不适合当背景时（深色 UI 截图 / 满字海报）② 纯文字卡（title/list/compare…）
    做法：
      · 支持 gradients → 两色渐变（缓慢流动，speed 很小，避免"花哨"）；不支持 → 主题底色
      · 装饰只用**极小的几何块**（顶部细色条 + 左上一小段强调色 + 底部分割线）——
        这是反 AI 味清单里允许的"克制的设计"，不是渐变药丸/圆角彩边那一类。
    返回 (input_args, filter_prefix)：调用方把 filter_prefix 拼到自己的文字层前面即可。
    """
    c0 = th.get('bg', '0x0a1620')
    c1 = th.get('bg2') or _shade(c0, 1.55)
    acc = th.get('accent', '0xff6b35')
    try:
        _ff = find_ffmpeg()
    except Exception:
        _ff = 'ffmpeg'
    if _has_gradients(_ff):
        inp = ['-f', 'lavfi', '-i',
               'gradients=s=%dx%d:c0=%s:c1=%s:d=%s:speed=0.015' % (W, H, c0, c1, max(1.0, float(dur)))]
    else:
        inp = ['-f', 'lavfi', '-i', 'color=c=%s:s=%dx%d:d=%s' % (c0, W, H, max(1.0, float(dur)))]
    deco = []
    if accent_bar:
        deco.append('drawbox=x=0:y=0:w=%d:h=%d:color=%s@0.95:t=fill' % (W, max(4, int(H * 0.008)), acc))
        deco.append('drawbox=x=%d:y=%d:w=%d:h=%d:color=%s@0.85:t=fill'
                    % (int(W * 0.08), int(H * 0.155), int(W * 0.12), max(3, int(H * 0.005)), acc))
    deco.append('drawbox=x=%d:y=%d:w=%d:h=%d:color=white@0.10:t=fill'
                % (int(W * 0.08), int(H * 0.925), int(W * 0.84), max(2, int(H * 0.0016))))
    return inp, ','.join(deco)


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


def _reveal_seq(shot, font, fs, txc, dur, text=None, box=None, y_off=0):
    """★VF_SYNC_V1（2026-09-20，C3 配音卡点）：画面大字【逐字浮现】。

    镜头时长 = 该镜配音真实时长（tts.py 回填），所以在镜头前段逐字亮出 = 跟着配音走。
    做法：对每个前缀（第 1 字、前 2 字…）各画一次 drawtext，各自只在 [t_i, t_{i+1}) 窗口
    enable —— 因为前缀是嵌套的，看起来就是从左向右逐字浮现；且每个都用
    x=(w-text_w)/2 居中，不需测量字宽（这是不用 ASS 覆盖层的原因）。

    `text`：显式指定要浮现的文字（不给就取 shot['text']）—— title 卡用它传兜底文字。
    `box`：给文字加一圈半透明底衬（形如 'black@0.30'），压在照片上时更清楚、也更像"设计过"。
    """
    chars = list(str(text if text is not None else (shot.get('text') or '')))
    nch = len(chars)
    if nch <= 0:
        return []
    # ★VF_TEXTFIT_V2（2026-09-28）：原来每个前缀都 x=(w-text_w)/2 重新居中 →
    #   字一边出现一边左右漂移（用户说的"文字看着怪怪的"）。
    #   现在用【块不动、字在块内从左往右亮】：未出现的字用表意空格 U+3000 占位（等宽、不可见），
    #   于是整块宽度恒定、始终居中；底衬（box）也不会从窄到宽地长出来。
    _full = ''.join(chars)
    _pad = '\u3000'
    t0 = max(0.12, min(0.6, dur * 0.06))
    t1 = max(t0 + 0.5, dur * 0.55)
    step = (t1 - t0) / float(nch)
    _bx = (f"box=1:boxcolor={box}:boxborderw={max(12, int(fs * 0.24))}:") if box else ''
    out = []
    for i in range(1, nch + 1):
        st = t0 + step * (i - 1)
        en = dur if i == nch else (t0 + step * i)
        # 已亮的字 + 用表意空格补齐的"未亮的字"（占位保持整块宽度不变）
        _shown = _full[:i] + _pad * (nch - i)
        # ★VF_TEXTSTROKE_V1（2026-09-20）：画面大字是压在【素材照片】上的，底色不可控 ——
        #   加一圈深色描边，浅色主题 / 亮底素材也能看清
        #   （加"浅色纸感"主题后才发现：light 主题字色近黑，压在深色照片上会糊）
        out.append(
            f"drawtext=fontfile='{font}':text='{esc_text(_shown)}':fontsize={fs}:"
            f"fontcolor={txc}:borderw=2:bordercolor=black@0.65:{_bx}"
            f"x=(w-text_w)/2:y=(h-text_h)/2+{int(y_off)}:enable='between(t,{st:.2f},{en:.2f})'"
        )
    return out


def card_bgimage(shot, th, W, H, fps):  # noqa: C901
    """图片背景 + 文字叠加 + 暗化（适合"实景底 + 标语"）

    ★2026-09-19 改（用户实测：横屏素材被收窄/切边）：
      老做法 = scale(force_original_aspect_ratio=increase) + crop → 放大到填满画布再切掉超出
               ⇒ 横图放进竖屏会被切掉左右，竖图放进横屏会被切掉上下。
      新做法（不裁切）：
        底层 [bg0] 放大填满 + 高斯模糊 + 压暗  → 做画布底纹（不出现突兀黑边）
        上层 [fg0] 按 contain 缩放（完整图，不裁切）→ 居中 overlay
    """
    src = shot.get('src', '')
    # ★VF_NOIMG_V1（2026-09-21 用户实测：AI 制片在"仓库 0 张图"时排到 bgimage 卡 → ffmpeg 拿到
    #   **空文件名** → stderr `: No such file or directory` → 第 0 镜渲染失败 → **整片失败**，
    #   界面上还堆一大堆"渲染错误"，把真正的病因埋掉）：
    #   无图 / 图片文件不存在 → **降级为 title 卡**（纯文字卡，不需要素材）。
    #   原则同 VF_UNKNOWNCARD_V1：宁可这一镜样式朴素，也不要整条视频挂掉。
    if (not str(src).strip()) or (not os.path.exists(str(src))):
        print('[VF] ⚠️ bgimage 没有可用图片（src=%s）→ 降级为 title 卡'
              % (str(src)[:60] or '(空)'))
        return card_title(shot, th, W, H, fps)
    dur = float(shot.get('dur', 4))
    font = esc_path(find_font(th.get('font', 'msyh')))
    fs = int(shot.get('fontsize', max(54, int(H * 0.10))))
    txc = th.get('text', 'white')
    _frames = max(1, int(dur * fps))
    _bar_y = int(H * 0.72)
    # ★VF_MATGUARD_V1（2026-09-29 用户实测「图片加打字…没色彩，就几个白字」）：先体检素材。
    _mat = _probe_material(src)
    _lum = _mat.get('lum', 160)
    _edge = _mat.get('edge', 0.0)
    _flat = _mat.get('flat', 0.0)
    _dark = _lum < 78                      # 深色素材（深色录屏/黑底图）
    _graphic = _flat > 0.42                # 截图/海报（大片纯色底）—— 照片主色占比通常 < 0.25
    _busy = _graphic or (_edge > 0.10)     # "素材自己已经有字/图案"
    if _dark and _graphic:
        # 又深又满字 = 典型"深色界面截图" → 【不硬塞这张图】，改用主题质感底板 + 大字
        #（规划文档 P2「缺就承认缺」：宁可出一张设计过的文字卡，也不要一张看不清的截图）
        print('[VF] 素材不适合当背景（亮度 %d / 主色 %.2f / 边缘 %.2f）→ 本镜改用主题质感底板：%s'
              % (_lum, _flat, _edge, os.path.basename(str(src))[:24]))
        _lines, fs = fit_big_text(str(shot.get('text') or ''), W, H, fs_max=fs, max_lines=2)
        _rev = _reveal_seq(shot, font, fs, txc, dur, text=_lines[0]) if len(_lines) <= 1 else []
        _reveal = (_rev if _rev else
                   center_lines_drawtext(font, _lines, fs, txc, W, H, dur, y_off=-int(H * 0.06))
                   ) if overlay_text_on() else []
        _inp, _stage = stage_layer(th, W, H, dur)
        _vf = _stage + ',' + ','.join([
            f"drawbox=x=0:y={_bar_y}:w={W}:h={H - _bar_y}:color=black@0.28:t=fill",
        ] + _reveal + [f"trim=duration={dur},setpts=PTS-STARTPTS,format=yuv420p"])
        return (' '.join(_inp), _vf, dur)
    if _busy:
        # 素材自带大量文字（海报/截图）→ 我们的大字缩小让位，别"字压字"
        fs = max(int(fs * 0.72), int(H * 0.045))
    # ★VF_TITLEFIT_V3（2026-09-29）：≤8 字保一行（优先缩字号），超出才均衡折两行
    _lines, fs = fit_big_text(str(shot.get('text') or ''), W, H, fs_max=fs, max_lines=2)
    # ★VF_SYNC_V1（C3）：画面大字逐字浮现（跟配音卡点）；拿不到 text 就不加这些滤镜
    #   ★VF_CARDSTYLE_V1：压在照片上的大字加半透明底衬（与素材自带的字在视觉上分开）
    #   ★VF_MATGUARD_V1：素材字多 → 底衬更实（0.30→0.48），否则仍会被素材的字吃掉
    _boxc = 'black@0.48' if _busy else 'black@0.30'
    # ★VF_MATGUARD_V2（2026-09-29 P1「更聪明的素材避让」）——**踩过一次，改成可靠方案**：
    #   第一版做法：量素材上/中/下三条哪条最"空"，把大字挪过去。
    #   实测失败（亮色满字海报）：band 是在**素材原图**上量的，而画布上是"模糊铺底 + 等比缩放居中"，
    #   位置对不上 → 判成"上部最空"，偏偏海报的大字也在上部 → 还是压字。
    #   第二版（现在）：**不挪位置，改"让我们的字一眼看得出是我们加的"**——
    #   满字素材 → 大字固定放【下三分之一】（海报类素材文字多在中上），并加一条**全宽实底衬带**，
    #   像电视字幕条一样把我们的字与素材的字在视觉上彻底分开（比"猜哪儿空"稳得多）。
    _yoff = 0
    _band_box = ''
    if _busy:
        _yoff = int(H * 0.13)
        _gap_b = int(fs * 1.34)
        _rows_b = max(1, len(_lines))
        _btop = int(H * 0.5 + _yoff - _gap_b * _rows_b * 0.5) - int(fs * 0.30)
        _bh = _gap_b * _rows_b + int(fs * 0.60)
        _band_box = (f"drawbox=x=0:y={max(0, _btop)}:w={W}:h={int(_bh)}:"
                     f"color=black@0.62:t=fill,")
        print('[VF] 素材自带内容多 → 大字走【下三分之一 + 全宽底衬带】（避免与素材文字纠缠）')
    _rev = _reveal_seq(shot, font, fs, txc, dur, text=_lines[0], box=_boxc, y_off=_yoff) if len(_lines) <= 1 else []
    # ★OVERLAY_TEXT_SWITCH_V1：开关关闭 → 这一镜不叠大字（压暗与字幕照旧）
    _reveal = (_rev if _rev else
               center_lines_drawtext(font, _lines, fs, txc, W, H, dur, y_off=_yoff)
               ) if overlay_text_on() else []
    # ★VF_LESSDARK_V1（2026-09-20 用户实测"整体黑白/发灰"）：黑遮罩 0.42 → 0.15
    # ★VF_MATGUARD_V1（2026-09-29）：素材本身很暗（深色录屏/黑底图）时再降到 0.05 ——
    #   深色素材上再压 15% 就是"一片黑"，那正是用户说的"很干、没色彩"。
    _dim = 0.05 if _dark else 0.15
    _chain = [
        f"drawbox=x=0:y=0:w={W}:h={H}:color=black@{_dim}:t=fill",
        _band_box,
        f"drawbox=x=0:y={_bar_y}:w={W}:h={H - _bar_y}:color=black@0.30:t=fill",
    ] + _reveal + [
        f"trim=duration={dur},setpts=PTS-STARTPTS,format=yuv420p"]
    # ★VF_MOTION_V2（2026-09-29 反 AI 味清单·「运动做减法」）：
    #   原来【每一镜静图都匀速推近 1.0→1.06】——而反 AI 味清单里明确写着 ✗「每步都挂 ken burns」。
    #   现在按【镜序】轮换三种运动：推近 / 拉远 / 完全静止（静止那镜让画面"稳"一下，节奏才有呼吸）。
    #   注：`_idx` 由 render_shot() 注入（它本来就有镜序参数）。
    _kbi = int(shot.get('_idx') or 0)
    if _kbi % 3 == 0:
        _z = f"zoom='min(1+0.06*on/{_frames},1.06)'"      # 缓慢推近
    elif _kbi % 3 == 1:
        _z = f"zoom='max(1.06-0.06*on/{_frames},1.0)'"    # 缓慢拉远
    else:
        _z = "zoom='1.0'"                                 # 静止（时长不变，只是不动）
    vf = (
        f"split=2[bg0][fg0];"
        f"[bg0]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},gblur=sigma=32,eq=brightness=-0.18[bgb];"
        f"[fg0]scale={W}:{H}:force_original_aspect_ratio=decrease[fgs];"
        f"[bgb][fgs]overlay=(W-w)/2:(H-h)/2[smooth];"
        # ★VF_KENBURNS_V1（2026-09-20）：静图缓慢推近——只让画面“活”起来，不改时长
        # ★VF_MOTION_V2（2026-09-29）：改为按镜序轮换（推近 / 拉远 / 静止）
        f"[smooth]zoompan={_z}:d={_frames}:s={W}x{H}:fps={fps},"
        + ','.join(_chain)
    )
    return (f"-loop 1 -t {dur} -i \"{src}\"", vf, dur)


def card_end(shot, th, W, H, fps):
    """结尾卡：主标语 + 行动号召（CTA，做成"按钮"样式），带轻微上浮

    ★VF_BIGTEXT_FALLBACK_V1：主标语为空时用字幕首句兜底（否则结尾卡也是空白屏）。
    ★VF_CARDSTYLE_V1：CTA 从"一行橙字"改成【主题色实心按钮 + 深色字】，更像能点的入口。
    """
    font = font_bold(th)          # ★VF_FONTWEIGHT_V1：结尾主标语用粗体（收尾要有力）
    dur = float(shot.get('dur', 3.5))
    fs = int(shot.get('fontsize', max(56, int(H * 0.11))))
    acc, txc = th.get('accent', '0xff6b35'), th.get('text', 'white')
    _main = _big_text(shot)
    # ★VF_TEXTFIT_V2（2026-09-28）：折行优先（最多 2 行），放不下才缩字号
    _lines, fs = fit_big_text(_main, W, H, fs_max=fs, max_lines=2)
    # ★VF_VARIANT_V1（2026-09-29 P1「end 卡版式变体」）：center（默认）/ card（票根卡）
    _var = variant_of(shot, ('center', 'card'), 'center')
    if _var == 'card':
        _rows = max(1, len(_lines or [_main]))
        _gap1 = int(fs * 1.34)
        _card_h = _gap1 * _rows + int(fs * 1.5)
        _card_y = int(H * 0.5 - _card_h * 0.58)
        cparts = [
            f"drawbox=x={int(W * 0.08)}:y={_card_y}:w={int(W * 0.84)}:h={_card_h}:color={acc}@0.14:t=fill",
            f"drawbox=x={int(W * 0.08)}:y={_card_y}:w={int(W * 0.84)}:h=3:color={acc}@0.90:t=fill",
            f"drawbox=x={int(W * 0.08)}:y={_card_y + _card_h - 3}:w={int(W * 0.84)}:h=3:color={acc}@0.90:t=fill",
        ] + center_lines_drawtext(font, _lines or [_main], fs, txc, W, H, dur, y_off=-int(H * 0.02))
        if shot.get('cta'):
            cparts.append(
                f"drawtext=fontfile='{font}':text='{esc_text(shot['cta'])}':fontsize={int(fs * 0.5)}:"
                f"fontcolor=0x0a1620:box=1:boxcolor={acc}@0.95:boxborderw={max(10, int(fs * 0.26))}:"
                f"x=(w-text_w)/2:y={_card_y + _card_h + int(H * 0.035)}:alpha='min(max(t-0.6,0)/0.6,1)'")
        print('[VF] 结尾卡版式 = card（票根卡）')
        return (f"-f lavfi -i color=c={th.get('bg', '0x0a1620')}:s={W}x{H}:d={dur}",
                ','.join(cparts), dur)
    parts = [
        f"drawbox=x={int(W * 0.10)}:y={int(H * 0.20)}:w={int(W * 0.10)}:h={max(6, int(H * 0.006))}:color={acc}@0.95:t=fill",
    ] + center_lines_drawtext(font, _lines or [_main], fs, txc, W, H, dur, y_off=-30)
    if shot.get('cta'):
        parts.append(f"drawtext=fontfile='{font}':text='{esc_text(shot['cta'])}':fontsize={int(fs * 0.5)}:"
                     f"fontcolor=0x0a1620:box=1:boxcolor={acc}@0.95:boxborderw={max(10, int(fs * 0.26))}:"
                     f"x=(w-text_w)/2:y=(h-text_h)/2+{int(fs * 0.9)}:alpha='min(max(t-0.6,0)/0.6,1)'")
    return (f"-f lavfi -i color=c={th.get('bg', '0x0a1620')}:s={W}x{H}:d={dur}",
            ','.join(parts), dur)


CARDS = {
    'title': card_title,
    'list': card_list,
    'number': card_number,
    'image': card_image,
    'video': card_video,
    # ★VF_AIVIDEO_V1（2026-09-20）：AI 生成的视频片段（「AI 直接成片」的镜头源）
    'aivideo': card_aivideo,
    'quote': card_quote,
    'compare': card_compare,
    'chart': card_chart,
    'bgimage': card_bgimage,
    'end': card_end,
}


# ★VF_ANTIAI_V1（2026-09-29 反 AI 味清单·第三层：渲染前校验）
#   分工：① 提示词层（src/lib/agent/vf/anti-ai.ts 的 ANTI_AI_PROMPT）
#         ② 服务端归一化层（同文件的 sanitizeAntiAiShots：清 emoji / 对比卡限字数 / 假数据降级）
#         ③ 这里（渲染前最后一道网）：只【告警】不改画面 —— 万一别的入口喂进脏分镜，日志里能看见。
#   为什么只告警：渲染层改画面容易把"用户故意要的效果"一起改掉；治理放在前两层，这里负责留痕。
_EMOJI_RE = re.compile('[\U0001F000-\U0001FAFF\u2600-\u27BF\u2B00-\u2BFF\uFE0F\u200D]')


def anti_ai_check(shots):
    """渲染前自检：emoji / 连续同一卡型过多。有问题就打日志（不影响出片）。"""
    warns = []
    try:
        for i, s in enumerate(shots or []):
            for k in ('text', 'title', 'left', 'right', 'leftDesc', 'rightDesc', 'label', 'cta'):
                v = s.get(k)
                if isinstance(v, str) and _EMOJI_RE.search(v):
                    warns.append('第 %d 镜 %s 里有 emoji/符号（应为中文/数字）：%s' % (i + 1, k, v[:16]))
        run = 1
        for i in range(1, len(shots or [])):
            if shots[i].get('type') == shots[i - 1].get('type'):
                run += 1
                if run == 4:
                    warns.append('第 %d~%d 镜连续同一卡型「%s」（建议换着来）'
                                 % (i - 2, i + 1, shots[i].get('type')))
            else:
                run = 1
        for w in warns[:8]:
            print('[VF][反AI味] ⚠️ ' + w)
        if len(warns) > 8:
            print('[VF][反AI味] ⚠️ …另有 %d 条同类提示' % (len(warns) - 8))
        if warns:
            print('[VF][反AI味] 共 %d 条提示（提示词层已约束，这里是渲染前的最后一道校验；不阻断出片）' % len(warns))
    except Exception as e:
        print('[VF][反AI味] 自检异常（忽略）: %s' % str(e)[:80])


def render_shot(shot, th, workdir, idx, W, H, fps, ffmpeg):
    # ★VF_MOTION_V2（2026-09-29）：把镜序注入 shot —— 各配方卡据此轮换运动（推近/拉远/静止），
    #   不再"每一镜都挂 ken burns"（反 AI 味清单里的一条）。用副本，不改调用方的数据。
    shot = dict(shot)
    shot['_idx'] = idx
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
    # ★VF_STAGE_V2（2026-09-29 用户实测「没色彩没渐变、就几个白字」）：**纯文字卡**（无素材）的底色
    #   从"一块纯色"升级成【主题质感底】：两色渐变 + 顶部强调色细条 + 底部分割线。
    #   做法刻意选在 render_shot 这一层做（而不是去改 6 个卡型）：只拦"卡片返回的是 lavfi 纯色底"这一种，
    #   其余（有素材的 bgimage/video、以及卡片自己的文字/装饰层）一律不动 → 一处改动、风险最小。
    if typ in ('title', 'list', 'number', 'compare', 'chart', 'end') \
            and isinstance(inp, str) and inp.startswith('-f lavfi -i color='):
        _inp2, _deco = stage_layer(th, W, H, dur)
        inp = ' '.join(_inp2)
        vf = _deco + ',' + vf
        print('[VF] 文字卡 %s → 主题质感底（渐变 + 强调色装饰）' % typ)
    out = os.path.join(workdir, 'shot%02d.mp4' % idx)
    # ★VF_TRANS_V1（2026-09-20）：每镜首尾轻微淡入淡出（≤0.2s）——比硬切自然；
    #   不改时长（不碰音频时间轴），拼接后就是“柔和的镜间过渡”
    # ★VF_VARIANT_V1（2026-09-29 P1「转场」）：现在可显式选过渡方式（AI 可写 transition，白名单外=默认）：
    #   · '' 或 'soft'（默认）= 各镜首尾轻微淡入淡出（老行为，最自然）
    #   · 'cut'  = **真硬切**（完全不淡，适合快节奏/卡点）
    #   · 'fade' = **加长的柔化过渡**（0.12~0.4s，观感接近"溶解"）
    #   ⚠️ 为什么不做真·交叉溶解（xfade）：它会让每个交界"吃掉"一段时长 → 视频时间轴变短，
    #      而配音是一条【连续轨】不会跟着变短 → **全片音画持续错位**。真溶解必须同时做
    #      "音频逐镜切分 + 交叉淡化"，是独立的一摊活（已记进 docs 附录 E 未做项）。
    _trans = str(shot.get('_trans') or '').strip().lower()
    if _trans == 'cut':
        _fd = 0.0
    elif _trans == 'fade':
        _fd = min(0.4, max(0.12, dur / 6.0))
    else:
        _fd = min(0.2, max(0.05, dur / 10.0))
    # ★VF_EMPTYVF_V1（2026-09-24 服务端实测「第 7 镜 list 渲染失败」）：
    #   卡型返回空滤镜串时，旧代码直接 f"{vf},fade=..." 拼 → 链子变成【以逗号开头】→
    #   ffmpeg 报 `No such filter: ''` → 整镜失败 → 重试 2 次仍失败 → 抛错 → 整片出不来。
    #   实测触发链：list 卡的 items 被服务端"示例词黑名单"清空 → card_list 返回空串。
    #   这里做【全卡型通用兜底】：只拼非空段；万一全空就用 null（无操作滤镜）保证链子合法。
    vf2 = ','.join([str(p) for p in (
        vf,
        (f"fade=t=in:st=0:d={_fd:.2f}" if _fd > 0.001 else ''),
        (f"fade=t=out:st={max(0.0, dur - _fd):.2f}:d={_fd:.2f}" if _fd > 0.001 else ''),
    ) if p]) or 'null'
    if not str(vf or '').strip():
        print('[VF] ⚠️ 第 %d 镜(%s) 的配方没有产出任何滤镜 → 用 null 兜底（避免 No such filter: \'\'）'
              % (idx + 1, typ))
    # ★VF_AIVIDEO_V1（2026-09-20）：video / aivideo 的输入**自带音轨**（AI 片段可能有环境音/人声）——
    #   单镜统一 `-an` 静音，音频由最后的 mux_audio 阶段铺【配音 + BGM】，
    #   否则 concat 时各镜音轨错乱。
    _an = '-an ' if typ in ('video', 'aivideo') else ''
    cmd = (f'"{ffmpeg}" -y {inp} -vf "{vf2}" {_an}-c:v libx264 -preset fast '
           f'-pix_fmt yuv420p -r {fps} -t {dur} "{out}"')
    # ★VF_SHOT_GUARD_V1（2026-09-22，用户实测「180 秒出 30 秒」）：原来**只看文件在不在**
    #   → ffmpeg 中途挂掉留下的半截文件（缺 moov atom）也算"成功" → 拼接时整片断在那一镜。
    #   现在：返回码 + ffprobe 真实时长双校验；异常自动重试一次；仍不行就明确报错
    #   （宁可这一条不出片，也绝不交付一条"静默变短"的废片）。
    _target = float(dur)
    for _try in (1, 2):
        if os.path.exists(out):
            try:
                os.remove(out)
            except Exception:
                pass
        r = subprocess.run(cmd, shell=True, capture_output=True, text=True,
                           encoding='utf-8', errors='replace')
        _got = probe_sec(out)
        if r.returncode == 0 and _got >= _target * 0.9:
            if _try > 1:
                print('[VF] ⚠️ 第 %d 镜(%s) 首次异常、重试成功：实际 %.2fs / 目标 %.2fs'
                      % (idx + 1, typ, _got, _target))
            return out
        print('[VF] ⚠️ 第 %d 镜(%s) 渲染异常（第 %d 次）：rc=%s 实际 %.2fs / 目标 %.2fs%s'
              % (idx + 1, typ, _try, r.returncode, _got, _target,
                 ('  病因=' + err_lines(r.stderr)) if err_lines(r.stderr) else ''))
    raise RuntimeError('第 %d 镜渲染失败(%s)：实际 %.2fs / 目标 %.2fs（重试 2 次仍异常，文件可能是半截的）'
                       % (idx, typ, probe_sec(out), _target))


def concat_shots_xfade(files, workdir, ffmpeg, W, H, fps, durs, xd=0.35):
    """★VF_XFADE_V1（2026-09-29 用户定案「真·交叉溶解」）—— **视频侧**。

    ⚠️ 为什么这个功能拖到现在才做（必须写清，避免以后有人乱改）：
      交叉溶解会让**每个交界"吃掉" xd 秒**（两镜重叠）→ 视频总时长 = Σdur - xd×(镜数-1)。
      而配音是一条**连续音轨**（tts.py 逐镜合成后合并），它的长度按各镜 dur 累加 ——
      只做视频侧 → 音轨比画面长 → **全片音画持续错位**。
      所以：**音频侧必须做同样的交叉淡化**（`tts.py --xfade`，由 make.py 把分镜根级 `xfade` 透传过去），
      两边数值必须一致。任何失败/时长对不上 → 返回 None，调用方回落硬切（绝不因为转场让片出不来）。
    """
    n = len(files)
    if n < 2:
        return None
    out = os.path.join(workdir, 'merged_xfade.mp4')
    ins = ' '.join('-i "%s"' % p.replace('\\', '/') for p in files)
    parts, prev, acc = [], '0:v', float(durs[0])
    for i in range(1, n):
        off = max(0.0, acc - xd)
        lab = 'x%d' % i
        parts.append('[%s][%d:v]xfade=transition=fade:duration=%.2f:offset=%.2f[%s]'
                     % (prev, i, xd, off, lab))
        prev, acc = lab, off + float(durs[i])
    fc = ';'.join(parts)
    exp = acc
    cmd = (f'"{ffmpeg}" -y {ins} -filter_complex "{fc}" -map "[{prev}]" '
           f'-c:v libx264 -preset fast -pix_fmt yuv420p -r {fps} "{out}"')
    try:
        r = subprocess.run(cmd, shell=True, capture_output=True, text=True,
                           encoding='utf-8', errors='replace')
    except Exception as e:
        print('[VF] ⚠️ 交叉溶解异常 → 回落硬切: %s' % str(e)[:100])
        return None
    got = probe_sec(out) if os.path.exists(out) else 0.0
    if r.returncode != 0 or got <= 0 or got < exp * 0.90:
        print('[VF] ⚠️ 交叉溶解失败（rc=%s 实际 %.2fs / 预期 %.2fs）→ 回落硬切'
              % (r.returncode, got, exp))
        return None
    print('[VF] 交叉溶解拼接完成：%d 镜 共 %.2fs（每处重叠 %.2f 秒）' % (n, got, xd))
    return out


def concat_shots(files, workdir, ffmpeg, W, H, fps, expect_sec=0.0):
    """拼接（复用 encodeClips 思路：先统一参数再 concat）

    ★VF_CONCAT_GUARD_V1（2026-09-22，用户实测「180 秒出 30 秒」）：
      实测根因 = 某一镜文件写坏（缺 moov atom）→ concat 到它 `Impossible to open` 中断，
      但这里原来**只看 out 是否存在、不看返回码、也不校验总时长** → 半截成片被当成品返回
      （190.4 秒 → 30.36 秒，且日志照打"共 36 镜 190.4 秒"）。
      现在：① 返回码/stderr 关键错误码检查 + 重试一次；
            ② 拼完 ffprobe **真实总时长**与预期 Σ每镜比对（<95% 视为被截断 → 抛出明确错误）。
    """
    lst = os.path.join(workdir, 'list.txt')
    with open(lst, 'w', encoding='utf-8') as f:
        for p in files:
            f.write("file '%s'\n" % p.replace('\\', '/'))
    out = os.path.join(workdir, 'merged.mp4')
    cmd = (f'"{ffmpeg}" -y -f concat -safe 0 -i "{lst}" '
           f'-c:v libx264 -preset fast -pix_fmt yuv420p -r {fps} "{out}"')
    _exp = float(expect_sec or 0)
    _keystr = ('Impossible to open', 'Invalid data found', 'Input/output error', 'No such file')
    for _try in (1, 2):
        if os.path.exists(out):
            try:
                os.remove(out)
            except Exception:
                pass
        r = subprocess.run(cmd, shell=True, capture_output=True, text=True,
                           encoding='utf-8', errors='replace')
        _err = r.stderr or ''
        _got = probe_sec(out)
        if (r.returncode == 0 and _got > 0 and not any(k in _err for k in _keystr)
                and (_exp <= 0 or _got >= _exp * 0.95)):
            if _try > 1:
                print('[VF] ⚠️ 拼接首次异常、重试成功：实际 %.2fs / 预期 %.2fs' % (_got, _exp))
            return out
        print('[VF] ⚠️ 拼接异常（第 %d 次）：rc=%s 实际 %.2fs / 预期 %.2fs%s'
              % (_try, r.returncode, _got, _exp,
                 ('  病因=' + err_lines(_err)) if err_lines(_err) else ''))
    raise RuntimeError('拼接失败：实际 %.2fs / 预期 %.2fs（重试 2 次仍异常；'
                       '常见原因=某一镜文件写坏，请看上面的 [VF] ⚠️ 逐镜日志）'
                       % (probe_sec(out), _exp))


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


def _shot_window(s):
    """这一镜的【字幕窗口】该多长（★VF_VOICE_WINDOW_V1，2026-09-24）。

    用户实测症状：「配音比字幕快」（声音先说完、字幕还挂着）。
    根因：`tts.py` 过去只回填一个 `dur = 配音 + 0.35`，而**字幕窗口和镜长共用它** →
    单句层面字幕就比声音多停 0.35 秒（36 镜累计 ≈12.96 秒，即用户记得的"12 秒"）。

    现在 `tts.py` 额外回填 `voice`（真实配音时长），于是两者分开：
      · **字幕/逐字高亮窗口 = `voice`**（配音说完，字幕立刻消失）← 本函数返回值
      · **时间游标推进    = `dur`**（镜长，含 0.35 秒呼吸间隔）← 调用方照旧 +dur

    `voice` 缺失或过小（静音占位镜、配音失败的镜、旧工程文件）→ 退回 `dur`：
    向后兼容，绝不因为缺字段把老片子/静音镜弄坏。
    """
    try:
        v = float(s.get('voice') or 0)
    except Exception:
        v = 0.0
    try:
        d = float(s.get('dur', 3) or 3)
    except Exception:
        d = 3.0
    if v <= 0.2:
        return d
    return min(v, d) if d > 0.05 else v


# ══════════════════ ★VF_BANNER_V1（2026-09-29 用户定案）顶部固定标题 ══════════════════
# 用户原话：「固定标题（你截图那种：黄字黑边 + 半透明色块白字，全程钉在顶部不动）……
#           第 1 行颜色：随机颜色可以吗？位置固定全片。可选文案提炼，一切都要都可以默认这样，
#           后期集成自动化比较方便。」
# 实现口径：
#   · 位置：**钉住整片**（分镜根级 banner.from/to 可限范围，默认整片），在顶部 16% 以内，
#     压在画面之上、底部字幕之外 —— 所以它**不随镜头变化、不参与逐镜渲染**（逐镜渲染每镜都要画一遍，
#     既慢又容易在交界处闪）；这里在【字幕之后、混音之前】一次性烧上去。
#   · 颜色：用户要"随机" → 但**不是任意随机**：任意随机会撞出难看组合、也会和背景撞色。
#     这里从【设计过的高对比候选色 + 主题 accent】里挑，并用**文案哈希**做种子 →
#     同一条分镜反复渲染得到同一组颜色（逐镜重渲 / 重跑不会闪色）。
#   · 文案：默认由服务端 AI 提炼两行（≤12 / ≤18 字），渲染层只负责画。

def _banner_pick(th, seed_text):
    """从主题色板里挑两行颜色（稳定哈希：同一分镜结果一致）"""
    l1_pool = [th.get('accent'), th.get('accent2'), '0xffd400', '0xffe066', '0xff9f43',
               '0x3ddc97', '0x00d1ff', '0xff5c8a', '0xffffff']
    l2_pool = ['black@0.72', '0x111827@0.80', '0x1f2937@0.82',
               (str(th.get('accent') or '0x111827') + '@0.78')]
    l1_pool = [c for c in l1_pool if c]
    seed = 0
    for i, ch in enumerate(str(seed_text or '')):
        seed = (seed * 131 + ord(ch) * (i + 1)) % 1000003      # 稳定哈希（不能用内置 hash：进程间随机）
    return l1_pool[seed % len(l1_pool)], l2_pool[(seed // 7) % len(l2_pool)]


def banner_layer(banner, th, W, H, dur, font):
    """顶部固定两行标题的滤镜串（第 1 行大号+黑描边；第 2 行半透明色块+白字）。
    返回 '' 表示不画。范围用 banner['_range']=(start秒, end秒)，不给=整片。"""
    if not isinstance(banner, dict):
        return ''
    l1 = str(banner.get('line1') or '').strip()
    l2 = str(banner.get('line2') or '').strip()
    if not l1 and not l2:
        return ''
    c1, c2 = _banner_pick(th, l1 + '|' + l2)
    fs1 = max(34, int(H * 0.055))
    # ★2026-09-29 自测发现：第 1 行 11 个字在 720 宽上按 0.055H(≈70px) 会**左右被裁**。
    #   这里用与其它大字同一套排版逻辑：**先缩字号保证一行放得下**（下限比正文更低，标题允许小一点）。
    try:
        _ls, _fs = fit_big_text(l1, W, H, maxw_ratio=0.92, max_lines=1, fs_max=fs1,
                                fs_min=max(24, int(H * 0.030)), one_line_max=99)
        if _ls:
            l1, fs1 = _ls[0], _fs
    except Exception:
        pass
    fs2 = max(24, int(fs1 * 0.62))
    y1 = int(H * 0.035)
    _pad = max(10, int(fs2 * 0.32))
    _en = ''
    _rng = banner.get('_range')
    try:
        if isinstance(_rng, (list, tuple)) and len(_rng) == 2 and float(_rng[1]) > float(_rng[0]):
            _en = ":enable='between(t,%.2f,%.2f)'" % (float(_rng[0]), float(_rng[1]))
    except Exception:
        _en = ''
    parts = []
    if l1:
        # ★VF_FONTWEIGHT_V1：固定标题第 1 行用粗体（用户在参考图里要的就是这种"厚"的观感）
        _fb = font_bold(th)
        parts.append(
            f"drawtext=fontfile='{_fb}':text='{esc_text(l1)}':fontsize={fs1}:fontcolor={c1}:"
            f"borderw={max(4, int(fs1 * 0.10))}:bordercolor=black:x=(w-text_w)/2:y={y1}{_en}")
    if l2:
        _y2 = y1 + fs1 + int(fs1 * 0.30)
        _bw = int(est_text_w(l2, fs2) + _pad * 2)
        _bx = max(0, int((W - _bw) / 2))
        parts.append(f"drawbox=x={_bx}:y={max(0, _y2 - _pad // 2)}:w={_bw}:h={fs2 + _pad}:"
                     f"color={c2}:t=fill{_en}")
        parts.append(
            f"drawtext=fontfile='{font}':text='{esc_text(l2)}':fontsize={fs2}:fontcolor=white:"
            f"borderw={max(2, int(fs2 * 0.06))}:bordercolor=black@0.6:x=(w-text_w)/2:y={_y2}{_en}")
    print('[VF] 固定标题：第 1 行色=%s / 第 2 行底=%s（范围=%s）'
          % (c1, c2, ('整片' if not _en else _en[16:-1])))
    return ','.join(parts)


def burn_banner(src, out, banner, th, W, H, dur, ffmpeg):
    """把固定标题烧到成片上（失败不阻断出片）"""
    font = esc_path(find_font(th.get('font', 'msyh')))
    vf = banner_layer(banner, th, W, H, dur, font)
    if not vf:
        return src
    cmd = (f'"{ffmpeg}" -y -i "{src}" -vf "{vf}" -c:v libx264 -preset fast '
           f'-pix_fmt yuv420p -c:a copy "{out}"')
    try:
        r = subprocess.run(cmd, shell=True, capture_output=True, text=True,
                           encoding='utf-8', errors='replace')
    except Exception as e:
        print('[VF] ⚠️ 固定标题异常 → 跳过（不影响出片）: %s' % str(e)[:100])
        return src
    if r.returncode == 0 and os.path.exists(out) and probe_sec(out) > 0:
        return out
    print('[VF] ⚠️ 固定标题烧入失败 → 跳过（不影响出片）: %s'
          % (err_lines(r.stderr)[:120] if err_lines(r.stderr) else 'rc=%s' % r.returncode))
    return src


def _ass_color(c, default='&H00FFFFFF'):
    """★VF_THEMES_V1（2026-09-29）：把主题色（0xRRGGBB / white / black / '0x1a1a1a@0.68'）转成 ASS 的 &HAABBGGRR。
    为什么需要：字幕原来是**写死的"白字 + 黑描边"** —— 2026-09-29 实测在【浅色主题】下白字根本看不清
    （米黄底上的白色字幕带黑边，糊成一片）。现在字幕跟随主题。"""
    s = str(c or '').strip()
    if '@' in s:
        s = s.split('@')[0]
    s = {'white': '0xffffff', 'black': '0x000000', 'red': '0xff0000'}.get(s, s)
    try:
        h = s.replace('0x', '').replace('#', '')
        if len(h) == 3:
            h = ''.join(ch * 2 for ch in h)
        r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
        return '&H00%02X%02X%02X' % (b, g, r)
    except Exception:
        return default


def _lum_of(c, default=255):
    """主题色亮度（决定字幕描边用黑还是白：深色字配白边、浅色字配黑边）"""
    s = str(c or '').strip().split('@')[0]
    s = {'white': '0xffffff', 'black': '0x000000'}.get(s, s)
    try:
        h = s.replace('0x', '').replace('#', '')
        if len(h) == 3:
            h = ''.join(ch * 2 for ch in h)
        return int(0.299 * int(h[0:2], 16) + 0.587 * int(h[2:4], 16) + 0.114 * int(h[4:6], 16))
    except Exception:
        return default


def build_ass(shots, path, W, H, font_name='Noto Sans CJK SC', font_size=26, wrap=16, th=None,
              overlap=0.0):
    """★VF_KARAOKE_V1（2026-09-20，用户要的“词级字幕”）：ASS 逐字高亮（karaoke）

    为什么不用 funasr 取字级时间戳：服务器未必装 funasr（那是客户端环境），
    而每镜的 subtitle 与**真实配音时长**（tts.py 回填的 dur）都已经有了 ——
    于是把该镜时长按字数均分给每个字，生成 \\k（厘秒）就能得到逐字扫过的效果：
    零依赖、零额外成本、不会因为没有 funasr 而挂。
    样式（★VF_THEMES_V1 起跟随主题）：已唱=主题文字色（PrimaryColour），
    未唱=主题强调色（SecondaryColour），描边=与文字反色（浅色主题上白字配黑边会糊）。
    """
    head = (
        '[Script Info]\nScriptType: v4.00+\nPlayResX: %d\nPlayResY: %d\n'
        'WrapStyle: 2\nScaledBorderAndShadow: yes\n\n'
        '[V4+ Styles]\n'
        'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, '
        'Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, '
        'Alignment, MarginL, MarginR, MarginV, Encoding\n'
        'Style: Def,%s,%d,%s,%s,%s,&H80000000,'
        '0,0,0,0,100,100,0,0,1,2.5,0,2,50,50,%d,1\n\n'
        '[Events]\n'
        'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n'
    ) % (W, H, font_name, font_size,
         _ass_color((th or {}).get('text'), '&H00FFFFFF'),                            # 已唱（主色）= 主题文字色
         _ass_color((th or {}).get('accent'), '&H00356BFF'),                          # 未唱（次色）= 主题强调色
         _ass_color('black' if _lum_of((th or {}).get('text'), 255) > 128 else 'white', '&H00000000'),
         max(28, int(H * 0.045)))                                                     # 描边：深字配白边/浅字配黑边

    lines = []
    t = 0.0
    _nsh = max(1, len(shots))
    for _i, s in enumerate(shots):
        dur = float(s.get('dur', 3))
        vd = _shot_window(s)     # ★VF_VOICE_WINDOW_V1：字幕窗口 = 真实配音时长（不是镜长）
        txt = _shot_text(s)
        # ★VF_XFADE_V1（2026-09-29）：真·交叉溶解时每个交界会"吃掉" overlap 秒 →
        #   第 i 镜的实际起点 = 原始累加 - i×overlap；它的结尾也被下一镜吃掉 overlap
        #   （不做这一步，字幕会随镜数越漂越多 —— 这正是逐镜拼接与交叉溶解最容易踩的坑）。
        _st = max(0.0, t - _i * overlap)
        _en = _st + max(0.10, vd - (overlap if _i < _nsh - 1 else 0.0))
        if txt:
            flat = ''.join(txt.split())
            if flat:
                n = max(1, len(flat))
                per = max(1, int(round(max(0.1, _en - _st) * 100.0 / n)))   # 每字厘秒（逐字高亮跟得上声音）
                rows = [_ass_esc(flat[i:i + wrap]) for i in range(0, len(flat), wrap)]
                segs = []
                for ri, r in enumerate(rows):
                    if ri:
                        segs.append('\\N')
                    segs.extend(['{\\k%d}%s' % (per, c) for c in r])
                lines.append('Dialogue: 0,%s,%s,Def,,0,0,0,,%s' % (_ass_ts(_st), _ass_ts(_en), ''.join(segs)))
        t += dur                  # 镜长推进（含 0.35 呼吸间隔，位置不变）
    if not lines:
        return ''
    with open(path, 'w', encoding='utf-8') as f:
        f.write(head + '\n'.join(lines) + '\n')
    return path


def build_srt(shots, path):
    """从分镜生成 SRT（build_ass 失败时的兜底）。

    时间基准（★VF_VOICE_WINDOW_V1）：每条字幕的**起始时刻**按各镜 `dur` 累加（位置不变），
    但**显示时长**用该镜的真实配音时长 `voice` —— 声音说完字幕就消失（不再多挂 0.35 秒）。
    """
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
        vd = _shot_window(s)     # ★VF_VOICE_WINDOW_V1：显示时长 = 真实配音时长
        txt = _shot_text(s)
        if txt:
            n += 1
            # ★VF_SUBWRAP_V1（2026-09-28）：原来按 18 字【硬切】——数字/英文/词被切断，
            #   看着"断得怪"。现在优先在标点处断，每行 ≤16 字、最多 2 行。
            txt = wrap_subtitle(txt, 16, 2)
            out.append('%d\n%s --> %s\n%s\n' % (n, fmt(t), fmt(t + vd), txt))
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


def mux_audio(video, audio, out, ffmpeg, bgm='', total_sec=0.0):
    """混音：人声（+ 可选 BGM 低音量铺底）→ 输出；两样都没有就直接复制。

    ★VF_BGM_V1（2026-09-20，用户要的 BGM）：
      BGM 用 -stream_loop -1 循环铺底，音量压到 0.12；amix 加 normalize=0
      （默认 amix 会把人声也按输入数除小 → 人声变轻，必须关掉归一化）。

    ★VF_MUX_FIX_V1（2026-09-22，用户实测「成片显示 10:52:31（10 小时）」+「成片比拼接短 12.96 秒」）：
      原来三个分支都用 `-shortest` —— 等于**无条件信任音频**：
        ① 音频头被写坏（36 段里 1 段 44.1k / 35 段 24k 混拼 → 头 = 40580 秒）
           → 成片头也跟着变 39151 秒 → 播放器显示 10 小时+
        ② 音频比画面短 36×0.35 = 12.96 秒（每帧尾隙只写进分镜、没进音频）
           → -shortest 把成片砍到音频长度 → 尾部 13 秒无声 + 字幕比配音慢半拍
      修法：**以分镜总时长（total_sec）为准**——
        · 人声侧 `apad` 补静音到目标长度（尾隙不再丢，字幕/配音严格对齐）
        · `-t total_sec` 显式定长（不再被音频头牵着走）
        · **去掉 -shortest**
        · 输出后 ffprobe 校验 ≈ total_sec（差 >1% 报错，拒绝交付时长不对的成片）
        · `-nostdin`：避免 ffmpeg 误入交互模式
      实测（用户素材 work_1790054625694，目标 183.52 秒）：有 BGM / 无 BGM 两条分支都输出 **183.520 秒** ✅
    """
    has_voice = bool(audio) and os.path.exists(audio)
    has_bgm = bool(bgm) and os.path.exists(bgm)
    # ★2026-09-20：BGM 传了但文件不存在时要明说 —— 否则"选了自动配乐却没混进去"会静默发生
    if bgm and not has_bgm:
        print('[VF] ⚠️ BGM 文件不存在，已跳过配乐: %s' % bgm)
    # ★VF_MUX_FIX_V1：以【分镜总时长】为准。没拿到目标时长时不硬来（apad 会无限补），
    #   退回旧行为并明说风险 —— 但正常链路一定会传 total_sec。
    _t = float(total_sec or 0)
    _pin = _t > 0.05
    _topt = (' -t %.3f' % _t) if _pin else ''
    # ★VF_FASTSTART_V1（2026-09-22，用户实测「播放 3~4 秒必卡一下」）：
    #   生成的 mp4 默认把 moov（索引）写在**文件尾部** → 浏览器边下边播时必须先 Range 取文件尾，
    #   取不到就周期性停顿（"播几秒卡一下"）。`+faststart` 把 moov 挪到文件开头，
    #   这是渐进式播放的标准做法；只搬索引、不重编码，2~3MB 的片子几乎零耗时。
    _fast = ' -movflags +faststart'
    if _pin:
        print('[VF] 混音目标时长 = 分镜总时长 %.2f 秒（apad 补尾隙 + -t 定长，不用 -shortest）' % _t)
    else:
        print('[VF] ⚠️ 未拿到分镜总时长 → 退回 -shortest（成片时长以音频为准，可能被带偏）')

    def _verify_dur():
        """成片真实时长必须 ≈ 分镜总时长（差 >1% 拒绝交付）—— 所有分支（含"直接复制"）都过这一关。

        两个都要查（★VF_MUX_FIX_V1）：
          · 容器时长 —— 抓"音频头被写坏 → 成片头跟着变成 10 小时"这类
          · **视频轨时长** —— 抓"画面本来就不够长"（apad 会把容器时长补到目标值，只看容器会漏判）
        """
        g = probe_sec(out)
        v = probe_stream_sec(out, 'v:0')
        if _pin:
            if g > 0 and abs(g - _t) / _t > 0.01:
                raise RuntimeError('混音后时长不符：容器 %.2fs / 分镜总时长 %.2fs（差超 1%%）'
                                   '—— 拒绝交付时长不对的成片' % (g, _t))
            if v > 0 and v < _t * 0.99:
                raise RuntimeError('混音后【视频轨】只有 %.2fs < 分镜总时长 %.2fs（画面不够长，'
                                   '容器时长是被补长的音频撑的）—— 拒绝交付' % (v, _t))
        print('[VF] 混音完成：成片时长 %.2f 秒%s%s'
              % (g, ('（= 分镜总时长 %.2f）' % _t) if _pin else '',
                 ('，视频轨 %.2f 秒' % v) if v > 0 else ''))

    if not has_voice and not has_bgm:
        import shutil
        # ★VF_FASTSTART_V1：原来是 shutil.copyfile —— 直接把 subbed.mp4 拷成成片，
        #   既没把 moov 挪到文件头，也绕过了统一输出参数。改成一次 remux（-c copy + faststart），
        #   只搬索引不重编码；万一 remux 失败再退回原样复制（保住出片）。
        try:
            _rc = subprocess.run(f'"{ffmpeg}" -nostdin -y -i "{video}" -c copy{_fast} "{out}"',
                                 shell=True, capture_output=True, text=True,
                                 encoding='utf-8', errors='replace')
            if (not os.path.exists(out)) or os.path.getsize(out) < 1024:
                raise RuntimeError(err_lines(_rc.stderr) or 'remux 失败')
            print('[VF] 无人声无 BGM → remux（+faststart）')
        except Exception as eF:
            print('[VF] ⚠️ faststart remux 失败（%s）→ 退回直接复制' % str(eF)[:80])
            shutil.copyfile(video, out)
        _verify_dur()
        return out
    if has_voice and has_bgm:
        # ★2026-09-20：把走过的分支打出来 —— 否则“选了配乐到底混没混进去”无法从日志判定
        print('[VF] 混音：人声 + BGM（BGM 音量 0.12，-stream_loop 循环铺底）')
        _voc = '[1:a]apad[voc]' if _pin else '[1:a]volume=1.0[voc]'
        cmd = (f'"{ffmpeg}" -nostdin -y -i "{video}" -i "{audio}" -stream_loop -1 -i "{bgm}" '
               f'-filter_complex "{_voc};[2:a]volume=0.12[bg];'
               f'[voc][bg]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]" '
               f'-map 0:v -map "[aout]" -c:v copy -c:a aac{_topt}{_fast} "{out}"')
    elif has_voice:
        if _pin:
            print('[VF] 混音：仅人声（无 BGM）')
            cmd = (f'"{ffmpeg}" -nostdin -y -i "{video}" -i "{audio}" '
                   f'-filter_complex "[1:a]apad[aout]" -map 0:v -map "[aout]" '
                   f'-c:v copy -c:a aac{_topt}{_fast} "{out}"')
        else:
            print('[VF] 混音：仅人声（无 BGM）')
            cmd = (f'"{ffmpeg}" -nostdin -y -i "{video}" -i "{audio}" -c:v copy -c:a aac '
                   f'-shortest{_fast} "{out}"')
    else:
        print('[VF] 混音：仅 BGM（无人声，音量 0.18）')
        cmd = (f'"{ffmpeg}" -nostdin -y -i "{video}" -stream_loop -1 -i "{bgm}" '
               f'-filter_complex "[1:a]volume=0.18[aout]" '
               f'-map 0:v -map "[aout]" -c:v copy -c:a aac{_topt or " -shortest"}{_fast} "{out}"')
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True,
                       encoding='utf-8', errors='replace')
    if not os.path.exists(out):
        raise RuntimeError('混音失败: ' + (err_lines(r.stderr) or (r.stderr or '')[-400:]))
    # ★VF_MUX_FIX_V1：校验成片真实时长 ≈ 分镜总时长（差 >1% 拒绝交付）
    _verify_dur()
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
    ap.add_argument('--no-bigtext', action='store_true',
                    help='★OVERLAY_TEXT_SWITCH_V1：不把画面大字压在素材/视频上（独立文字卡与字幕照旧）')
    ap.add_argument('--sub-size', default='0', help='字幕字号（0 = 按分辨率自适应）')
    ap.add_argument('--selftest', action='store_true')
    # ★VF_BANNER_V1：顶部固定标题总开关（storyboard 里的 banner 字段优先；CLI 关掉则一律不画）
    ap.add_argument('--no-banner', action='store_true')
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
        # ★VF_AIVIDEO_V1（2026-09-20）：「AI 直接成片」用的 aivideo 卡型必须纳入自检 ——
        #   否则要等真实 H3 生成才能验证（贵且慢，一条 600 点起）。
        #   这里造一段 **2 秒**测试视频，故意让它**短于**镜时长（3.5s），
        #   用来验证"时长对齐"这条路（放慢 + -stream_loop 循环兜底）。
        _testvid = ''
        try:
            _vp = os.path.join(wd, 'selftest-src.mp4')
            subprocess.run([ffmpeg, '-v', 'error', '-y', '-f', 'lavfi',
                            '-i', 'testsrc=duration=2:size=640x360:rate=25',
                            '-pix_fmt', 'yuv420p', _vp],
                           capture_output=True, timeout=60)
            if os.path.exists(_vp):
                _testvid = _vp
        except Exception:
            _testvid = ''
        # ★VF_AIVIDEO_V2（2026-09-20）：给镜加 text —— 这样自检能一起验证"压暗 + 画面大字"两层
        #   （否则 aivideo 只验证到"铺视频"，而不会发现大字缺失）
        _aishot = ({"type": "aivideo", "src": _testvid, "src_dur": 2.0, "text": "AI 生成画面",
                    "subtitle": "这一镜用来验证 AI 生成片段的渲染链路", "dur": 3.5}
                   if _testvid else
                   {"type": "title", "text": "AI 生成（造视频失败，已跳过 aivideo）",
                    "subtitle": "这一镜用来验证 AI 生成片段的渲染链路", "dur": 3.5})
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
                # ★VF_AIVIDEO_V1（2026-09-20）：第 3 镜 = AI 生成片段（素材合成 / AI 生成 两条链路都在自检里）
                _aishot,
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
    # ★VF_THEMES_V1（2026-09-29）：主题名/主题字典都接受（字符串走 themes.py 查表，不认识回默认主题）
    th = theme_of(sb.get('theme'))

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
    anti_ai_check(sb.get('shots', []))   # ★VF_ANTIAI_V1：渲染前"反 AI 味"自检（只告警，不改画面）
    # ★VF_VARIANT_V1（2026-09-29 P1「转场」）：把分镜级/镜头级的过渡方式注入每镜
    #   （分镜根上的 "transition" 当默认值，单镜自己的 transition 覆盖它）
    _sb_trans = str(sb.get('transition') or '').strip().lower()
    if _sb_trans in ('cut', 'fade', 'soft'):
        print('[VF] 过渡方式 = %s（分镜级）' % _sb_trans)
    for i, shot in enumerate(sb.get('shots', [])):
        shot['_trans'] = str(shot.get('transition') or _sb_trans or '').strip().lower()
        p = render_shot(shot, th, wd, i, W, H, fps, ffmpeg)
        # ★VF_SHOTLOG_V1（2026-09-20）：日志带上【本镜时长】—— 不必再跑 Python 脚本查"每镜几秒"
        #   （对"一镜 14 秒太闷"这类问题，一眼就能从日志看出是否正常）
        _d = float(shot.get('dur', 0) or 0)
        _total_dur += _d
        print('[VF] 第 %d 镜 OK  %-8s %5.1fs -> %s' % (i + 1, shot.get('type'), _d, os.path.basename(p)))
        files.append(p)
    if not files:
        print('[VF] 没有镜头'); sys.exit(3)
    # ★VF_XFADE_V1：分镜根级 `xfade: 0.35` → 真·交叉溶解（视频侧；音频侧由 tts.py --xfade 同步）
    _xd = 0.0
    try:
        _xd = float(sb.get('xfade') or 0)
    except Exception:
        _xd = 0.0
    merged = None
    if _xd > 0.05 and len(files) >= 2:
        _durs = [float(x.get('dur', 0) or 0) for x in (sb.get('shots') or [])]
        if len(_durs) == len(files) and min(_durs) > _xd + 0.25:
            _xd = min(0.6, _xd)
            merged = concat_shots_xfade(files, wd, ffmpeg, W, H, fps, _durs, _xd)
            if merged:
                _total_dur = sum(_durs) - _xd * (len(files) - 1)   # 字幕/混音按"缩短后"的新时长
        else:
            print('[VF] ⚠️ 分镜要求交叉溶解，但每镜时长不全或过短 → 回落硬切')
            _xd = 0.0
    if not merged:
        _xd = 0.0
        merged = concat_shots(files, wd, ffmpeg, W, H, fps, _total_dur)
    # ★VF_CONCAT_GUARD_V1：日志同时打【目标】与【实际】—— 以前只打目标时长，
    #   所以"190.4 秒的分镜拼成 30.36 秒"这件事在日志里完全看不出来（用户实测踩坑点）。
    print('[VF] 拼接完成 -> %s（共 %d 镜 目标 %.1f 秒 / 实际 %.1f 秒）'
          % (merged, len(files), _total_dur, probe_sec(merged)))

    # ★ 字幕（默认开）：由分镜时长累加生成 SRT —— 唯一真相源，不另算时间
    video_for_audio = merged
    # ★VF_SUBSIZE_V1（2026-09-20）：字幕字号原来写死 26 —— 在 1920x1080 下只有屏高 2.4%，太小。
    #   改为未指定时按分辨率自适应（约屏高 4.2%）；显式传 --sub-size 仍以传入值为准。
    # ★OVERLAY_TEXT_SWITCH_V1（2026-09-29 用户定案）：画面大字总开关 ——
    #   storyboard JSON 的 "overlay_text": false，或 CLI 的 --no-bigtext（任一为关即关）。
    #   只关【压在素材/视频上的大字】（bgimage/video/aivideo 三类卡）；
    #   独立文字卡（title/end/list/number/compare/chart/quote）与底部字幕【不受影响】——
    #   需要文字时就用这种"单独几帧的文字卡"，也就是用户说的"单独加几帧都行"。
    global SHOW_OVERLAY_TEXT
    if a.no_bigtext or (sb.get('overlay_text') is False):
        SHOW_OVERLAY_TEXT = False
        print('[VF] ★画面大字=关（本次不把大字压在素材/视频上；独立文字卡与字幕保留）')

    _sub_size = int(a.sub_size) if str(a.sub_size).isdigit() and int(a.sub_size) > 0 else max(26, int(H * 0.042))
    if not a.no_subs:
        shots = sb.get('shots', [])
        sub_file = ''
        # ★VF_KARAOKE_V1（2026-09-20）：优先 ASS 逐字高亮；生成失败/无文本则回落 SRT（保证一定有字幕）
        if not a.no_karaoke:
            try:
                sub_file = build_ass(shots, os.path.join(wd, 'subs.ass'), W, H,
                                     sub_font_name(), _sub_size, th=th, overlap=_xd)
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
    # ★VF_BANNER_V1（2026-09-29 用户定案）：顶部固定标题（钉住整片）。
    #   放在【字幕之后、混音之前】：一次性烧上去，不参与逐镜渲染（每镜都画会慢、且交界处容易闪）。
    #   范围：分镜根级 banner.from/to（1-based 镜号）→ 这里换算成秒（按每镜 dur 累加）。
    _bn = sb.get('banner')
    if _bn and not a.no_banner:
        _rng = None
        try:
            _f = int((_bn or {}).get('from') or 1)
            _t = int((_bn or {}).get('to') or 0)
            _ds = [float(x.get('dur', 0) or 0) for x in (sb.get('shots') or [])]
            _st = sum(_ds[:_f - 1]) if _f > 1 else 0.0
            _en2 = sum(_ds[:_t]) if _t > 0 else sum(_ds)
            if _en2 > _st:
                _rng = (_st, _en2)
        except Exception:
            _rng = None
        if isinstance(_bn, dict) and _rng:
            _bn = dict(_bn)
            _bn['_range'] = _rng
        video_for_audio = burn_banner(video_for_audio, os.path.join(wd, 'banner.mp4'),
                                      _bn, th, W, H, _total_dur, ffmpeg)
    # ★VF_MUX_FIX_V1：把【分镜总时长】交给混音 —— 成片时长以它为准（不再被音频头/长度带偏）
    final = mux_audio(video_for_audio, a.audio, out, ffmpeg, a.bgm, _total_dur)
    print('[VF] ✅ 成片: %s' % final)


if __name__ == '__main__':
    main()
