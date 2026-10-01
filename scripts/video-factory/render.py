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
                                     # ★VF_STYLE_V1：末尾另加 2 镜冒烟 news（title）/ data（number）两套编辑风

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
from themes import (THEMES, theme_of, STYLES, DEFAULT_STYLE,  # noqa: E402
                    style_of, style_default, style_names)

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


def _grad_speed():
    """★VF_DECK_PIXEL_V2（2026-10-01）：`stage_layer` 渐变源的动画速度（**测试钩子**）。

    默认 **'0.015'**（缓慢流动 = 生产行为，字符串与改前逐字一致）。
    环境变量 `VF_GRAD_SPEED=0` 时冻结渐变 —— 为什么测试需要它：
    lavfi `gradients` 的动画相位**随进程**变化（本机实测：同一 t、两次独立 ffmpeg 取到的帧 MD5 都不同；
    `color=` 则逐字节相同）→ 只要渐变在动，**任何"跨渲染像素相等 / 亮度差"的断言都必然时红时绿**。
    冻结后像素层才是确定性的；生产不设该变量 → 行为零变化。
    """
    _v = (os.environ.get('VF_GRAD_SPEED') or '').strip()
    if _v:
        try:
            float(_v)
            return _v
        except ValueError:
            pass
    return '0.015'


def venc_args(W, H, kind='final'):
    """★VF_BITRATE_V1（2026-10-01）出片视频编码参数 —— **按分辨率定量，不写死魔数**。

    为什么改：老板那条真片（1280×720 / 25fps / 56.64s）成片只有 **353 kbps**（2.39MB）——
    720p 只给 353kbps，画面本身就糊（老板说"素材很糊"，有一半是这个原因，不只是素材暗）。

    依据 / 公式（选 CRF 而不是固定码率）：
      · "糊"来自**复杂帧被压过头**，而固定码率恰好在复杂帧掉质量；CRF 是按"每帧画质"给比特，
        复杂帧自动多给、平坦帧自动省 → 同观感下更省、且不会在关键帧崩。
      · 分辨率越高，同一个 CRF 相对细节越粗 → 每上一档降 1：
          ≤720p（≤0.92MP）   → CRF 20
          1080p（≤1.6MP 档） → CRF 19
          ≥1440p             → CRF 18
      · preset 用 `veryfast`：比原来的 `fast` **快**（不给老板加等待）；同 CRF 下体积略大 = 我们要的。
      · `-pix_fmt yuv420p` / 帧率 `-r` / 时长 `-t` 由调用处原样保留 → 兼容性与时长逻辑**零回归**。
    实测（本机 1280×720/25fps）——**诚实结论：这条改动不是"糊"的根治，别当药吃**：
      · 同一 storyboard 旧/新各渲一遍：0.85MB/444kbps → 0.97MB/506kbps（体积 +14%）；
        渲染耗时 **6.9s → 5.6s（反而快 19%）** —— 因为 veryfast 比 fast 快。
      · 拿老板真片本身做"过 3 代"代际损失对比（出片链路是 逐镜→拼接→烧字幕→烧标题 = 4 代）：
        CRF23/fast 与 CRF20/veryfast 的成帧细节**几乎一致**（真片画面细节能量≈2.9，CRF23 已保留 99.5%）
        → **本条不会让那条片的"糊"明显改善**。
      · 密集小字（UI 截图风素材）3× 放大对比：CRF23 / CRF20 / 350kbps 三者肉眼几乎无差
        （→ 353kbps 本身不是那条片糊的原因）。
      → 定位：这是一条**零回归、略优、且更快**的改动（该给的质量给足 + 预置换更快）；
        真正"糊"的主因在**素材 / 压暗 / 模糊**那一侧（见 ★VF_TEXTCONTRAST_V1 与 _probe_material）。
        想要更高画质把 CRF 数字调小即可（如 18），但实测对本项目内容**肉眼收益极小、体积会涨**。
    ⚠️ 本函数**只**管视频编码参数：音频、帧率、时长一律不动。
    """
    crf = 20
    if W * H > 1280 * 720 * 1.6:          # ≥ ~1080p（1280×720×1.6 ≈ 1.47MP）
        crf = 19
    if W * H > 1920 * 1080 * 1.3:         # ≥ ~1440p
        crf = 18
    return '-c:v libx264 -preset veryfast -crf %d -pix_fmt yuv420p' % crf


def venc_argv(W, H):
    """`venc_args` 的**参数数组**版（★VF_ARGV_V1 起，所有 ffmpeg 调用都走 argv、不经 shell）。"""
    return venc_args(W, H).split(' ')


def esc_text(t):
    """drawtext 文本转义：冒号/单引号/百分号/反斜杠 + ★VF_QUOTE_ESC_V1 引号归一

    ★VF_PCT_ESCAPE_FIX_V1（2026-09-24 发现；★VF_ARGV_V1 2026-10-01 后定稿）：
      `%` 是 ffmpeg drawtext 的**展开语法起点**（如 `%{eif:...}`）→ 必须转义成字面百分号。
      **转义层数取决于调用方是否经过 shell**：
        · ★VF_ARGV_V1（2026-10-01 起，当前唯一路径）：调用方是 **argv 数组、不过 shell** →
          正好需要 **2 层**（ffmpeg 滤镜图解析 1 层 + drawtext 文本 1 层）→ 本函数输出的 `\\%` 正确。
        · 旧版是"拼 shell 字符串 + 打开 subprocess 的 shell 开关"：shell 先吃掉一层（双引号里两个反斜杠被吃成一个）→
          ffmpeg 收到**裸 `%`** → 报 `Stray %` → **该 drawtext 一个字都不画**（同串 drawbox 照画
          = "有框无字"的"空色块"，老板报过三次；Windows cmd 不吃反斜杠所以本机永远测不出来）。
          ⚠️ 那条路已在 ★VF_ARGV_V1 里**彻底删除**——**谁把 shell 加回来，`%` 就会再次丢字**。
      注：`%{eif:...}` 这类**故意**的展开语法不走本函数，不受影响。

    ★VF_QUOTE_ESC_V1（2026-10-01）——**渲染层第二道引号闸**（服务端 ★VF_QUOTE_FIX_V1 是第一道）：
      为什么必须干掉 ASCII 双引号：整条滤镜串要过 **ffmpeg 自己的滤镜解析器**
      （`-vf <串>` 现在作为**一个 argv 元素**整体传入，不再经 shell）。文案里只要出现一个
      **裸的 ASCII `"`**，滤镜解析器的引号就会**提前闭合** → 命令被拆坏 → **那一镜整镜失败**
      （本机实测撞到过：当时只能手工把文案里的 `"` 换成「」）。
      服务端已归一化，但分镜可能来自别的入口 / 用户手改 → 这里是兜底。
      做法：
        · `"` → **成对交替** `“` / `”`（奇数个时最后一个也换成 `”` —— **绝不允许漏出一个裸 `"`**）；
        · `` ` ``（反引号）→ 直接删除（历史上是 shell 命令替换符；即便不过 shell，它也只会坏解析，删掉最稳）。
      ⚠️ 不动 `'` 的 `\\'` 转义（drawtext 需要它）、不动 `\\ : %` 的既有行为。
    """
    s = str(t)
    s = s.replace('`', '')                                  # ① 反引号：命令替换符 → 删
    if '"' in s:                                            # ② 裸 " 会让滤镜解析器引号提前闭合 → 归一
        _buf, _open = [], True
        for _ch in s:
            if _ch == '"':
                _buf.append('“' if _open else '”')
                _open = not _open
            else:
                _buf.append(_ch)
        s = ''.join(_buf)
    return (s.replace('\\', '\\\\').replace(':', r'\:')
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


def _big_fix_rows(s, rows, min_last=2, back=3):
    """★VF_BIGTEXT_KINSOKU_V1（2026-10-01）：把**大字**折行结果按两条规矩收口 ——
    ① 断点走避头尾（**复用** kinsoku_cut_ok：不落虚词 / 不落收尾标点 / 不拆数字+单位/字母数字 / 不拆成对词）；
    ② **不留孤字**（末行至少 min_last 字；中文排版里"第二行只剩一个字"最难看）。
    只在"断点非法"或"末行孤字"时改动；**原本合法的断点逐字不变**（零回归）。拼回 === 原文（一字不丢）。"""
    if len(rows) < 2:
        return rows
    cuts, i = [], 0
    for r in rows[:-1]:
        i += len(r)
        cuts.append(i)
    for k, c in enumerate(cuts):                       # ① 非法断点 → 往回退找最近合法点
        if kinsoku_cut_ok(s, c):
            continue
        lo = cuts[k - 1] if k else 0
        for b in range(1, back + 1):
            cc = c - b
            if cc <= lo:
                break
            if kinsoku_cut_ok(s, cc):
                cuts[k] = cc
                break
    last = len(s) - cuts[-1]                           # ② 末行孤字 → 从上一行挪字下来（保持合法）
    if last < min_last:
        lo = cuts[-2] if len(cuts) > 1 else 0
        want = cuts[-1] - (min_last - last)
        while want > lo and not kinsoku_cut_ok(s, want):
            want -= 1
        if want > lo:
            cuts[-1] = want
    out, prev = [], 0
    for c in cuts:
        out.append(s[prev:c])
        prev = c
    out.append(s[prev:])
    return [x for x in out if x]


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
        # ★VF_BIGTEXT_KINSOKU_V1：字符均分也可能留下孤字（n=3 → 2+1）→ 同样收口
        return _big_fix_rows(s, [x for x in out if x])
    # ★VF_BIGTEXT_KINSOKU_V1（2026-10-01）：宽度贪心折行后按避头尾 + 不留孤字收口
    #   （老板帧 styles2/frames/deck-glass_t7_5.png：大标题被拆成「…生成系 / 统」= 第二行孤字）。
    return _big_fix_rows(s, wrap_by_width(s, fs, maxw, max_lines))


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
    # ★VF_STYLE_V1（2026-09-30）：默认字号改为**按画幅取向**取（横屏 ×1.40）——
    #   用户实测「统一按竖屏分辨率配的字」；横屏 1280×720 下 0.10H=72 太小。
    fs_max = int(fs_max or big_fs(W, H, 0.10, 44))
    fs_min = int(fs_min or big_fs(W, H, 0.052, 30))
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


def big_text_margins_ok(lines, fs, W, min_margin_ratio=0.06):
    """★VF_TEXTCONTRAST_V1（2026-10-01）大字【最小侧边距】断言：老板帧 full_t0260 里大字右端几乎贴右缘。
    大字是居中的（x=(w-text_w)/2），所以左右边距相等 = (W − 最宽行宽)/2；
    这里给"单行超安全区"兜底口径：最宽行不得超过 W×(1−2×min_margin_ratio)（默认两侧各 ≥6%）。
    返回 (是否达标, 最宽行像素, 单侧边距像素)。"""
    widest = max((est_text_w(l, fs) for l in (lines or [])), default=0)
    margin = (float(W) - widest) / 2.0
    return (margin >= float(W) * float(min_margin_ratio), widest, margin)


def center_lines_drawtext(font, lines, fs, txc, W, H, dur, y_off=0, stroke=True, fade=True,
                          motion='fade', x_off=0, breath=False):
    """多行文字各自居中（固定 y，行距 1.34×字号）—— 不用 ASS 覆盖层，也不必测宽。

    ★VF_MOTION_V3（2026-09-29 P1）：新增 motion —— 'fade'（默认，只淡入）/ 'slide'（从下方滑入同时淡入）。
      slide 的 y 是**表达式且含逗号**，所以必须整体加引号写进滤镜串（否则逗号会被当成滤镜分隔符）。
    ★VF_TPL_LAND_V1（2026-09-30）：新增 x_off —— 把"居中"改为在【右侧大字区】居中。
      数学上等价于在原居中式上 +x_off/2（因为 w == W）：块心从 W/2 挪到 (W+x_off)/2。
      **x_off=0（缺省）时表达式逐字不变** —— 老调用方一个像素都不动。
    ★VF_SUSTAIN_V1 A2（2026-10-01）：新增 breath —— 入场渐入**再乘一个极小的周期起伏**（"呼吸"）。
      breath=False（缺省）时 alpha 表达式与改动前**逐字相同** → 没传的调用方零回归。
    """
    lines = [l for l in (lines or []) if str(l).strip()]
    if not lines:
        return []
    gap = int(fs * 1.34)
    y0 = int(H * 0.5 - gap * len(lines) * 0.5 + y_off)
    _dx = int(x_off) // 2
    out = []
    for li, ln in enumerate(lines):
        st = (f":borderw={max(2, int(fs * 0.06))}:bordercolor=black@0.72" if stroke else '')
        if not fade:
            a = ''
        elif breath:
            # breath_alpha 自带括号（见它的 docstring：漏括号会漏出 0.06 的底噪 alpha）
            a = ":alpha='min(t/0.5,1)*%s'" % breath_alpha(dur)
        else:
            a = ":alpha='min(t/0.5,1)'"
        _y = y0 + li * gap
        _ys = _slide_y(_y, fs, dur) if motion == 'slide' else str(_y)
        _x = 'x=(w-text_w)/2' if not _dx else f'x=(w-text_w)/2+{_dx}'
        out.append(
            f"drawtext=fontfile='{font}':text='{esc_text(ln)}':fontsize={fs}:"
            f"fontcolor={txc}{st}:{_x}:y='{_ys}'{a}"
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


# ══════════════ ★VF_LINEBREAK_V2（2026-10-01）字幕中文避头尾（kinsoku）══════════════
# 与 src/lib/agent/vf/anti-ai.ts 的 VF_KINSOKU_* **逐字一致**（常量表 + 算法），由
# scripts/vf-style-selftest.py 硬断言（表字符串对账 + 行为对账）。
# 口径（用户 + team-lead 拍板）：**只往回退、不做双向**（行宽是硬限制）；窗口内找不到合法点 → 保持原切口
#   （不硬造）。非法 = ①行尾落虚词 ②行首落收尾标点 ③切进"字母数字/数字+中文单位"（8.5% / 150万 / 30秒）
#   ④拆开成对词（只放明确点名的，见 VF_KINSOKU_NOPAIR —— 宁缺勿假，不猜词）。
VF_KINSOKU_TAIL = '的了是和与就都也在把被而或及等这那有无为之其你我他'
VF_KINSOKU_HEAD = '。，、！？；：）」』》'
VF_KINSOKU_NOPAIR = ['生成']
VF_KINSOKU_BACK = 4
_KIN_ALNUM = set('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz.%')


def _kin_is_alnum(ch):
    return ch in _KIN_ALNUM


def _kin_is_cn(ch):
    return '\u4e00' <= ch <= '\u9fa5'


def kinsoku_cut_ok(s, e):
    """★VF_LINEBREAK_V2：切口（s[e-1] | s[e] 之间）是否合法 —— 与 anti-ai.ts::isKinsokuCutOk 逐字一致。"""
    if e <= 0 or e >= len(s):
        return True
    a, b = s[e - 1], s[e]
    if a in VF_KINSOKU_TAIL:                                  # ① 行尾不许落在虚词之后
        return False
    if b in VF_KINSOKU_HEAD:                                  # ② 行首不许是收尾标点
        return False
    if _kin_is_alnum(a) and _kin_is_alnum(b):                 # ③ 不许切在 8.5% / 150 里
        return False
    if _kin_is_alnum(a) and _kin_is_cn(b):                    # ③ 数字 + 中文单位（150万 / 30秒）
        return False
    for p in VF_KINSOKU_NOPAIR:                               # ④ 成对词不许拆
        L = len(p)
        if L >= 2 and e - L + 1 >= 0 and s[e - L + 1:e + 1] == p:
            return False
    return True


def kinsoku_cut(s, start, cap):
    """★VF_LINEBREAK_V2：在 [start+1 .. start+cap] 里往回找最近的合法切口（最多 VF_KINSOKU_BACK 字）；
    找不到就返回原切口 —— 与 anti-ai.ts::pickKinsokuCut 逐字一致。"""
    c = max(1, int(cap))
    target = min(len(s), start + c)
    for e in range(target - 1, max(start + 1, target - VF_KINSOKU_BACK) - 1, -1):
        if kinsoku_cut_ok(s, e):
            return e
    return target


def wrap_subtitle(txt, limit=16, max_lines=2):
    """字幕折行（SRT 兜底路径）：中文避头尾（kinsoku），**一字不能丢、绝不插「…」**。

    ★VF_LINEBREAK_V2（2026-10-01 用户实测「字幕断行难看」）：断口用 kinsoku "只往回退" 避开
      虚词/收尾标点/数字单位/成对词（与 anti-ai.ts::wrapWithKinsoku 同口径、表逐字一致）。
    ★VF_SUBTITLE_NOELLIPSIS_V1（2026-10-01）：**删除旧的「…」截断分支**。老板原话「字幕好像都没读完
      就卡住不换帧」—— 根因就是旧实现把 max_lines 之外的字用「…」吃掉（本机实测：28 字的原句只显示
      18 字、丢 10 字）。字幕是配音原文，**不许显示不全** → 这里改成"需要几行就排几行"；
      max_lines 仅作**目标提示**（真正降行数：ASS 路径 _sub_rows 缩字号 / 服务端超长拆镜）。
    一行宽度 16 字（limit）为硬限制，故只做"往回退"，不做双向。
    """
    _ = max_lines                                          # 目标提示，不做截断（保留形参兼容老调用方）
    s = ''.join(str(txt or '').split())                    # 与 anti-ai.ts::wrapWithKinsoku 同口径：去所有空白
    if not s:
        return ''
    if len(s) <= limit:
        return s
    rows, i = [], 0
    while i < len(s):
        target = min(len(s), i + limit)
        end = target if target >= len(s) else kinsoku_cut(s, i, limit)
        if end <= i:                                       # 防御：绝不允许零推进（否则死循环）
            end = min(len(s), i + limit)
        rows.append(s[i:end])
        i = end
    return '\n'.join(rows)


def _kin_rows(s, cpl):
    """★VF_LINEBREAK_V2：按 ≤cpl 字断行，**断口走 kinsoku（只往回退）**；一字不丢。
    为什么 ASS 路径也要用它：屏幕上的两行字幕是 build_ass 走 _sub_rows 排的（不是 wrap_subtitle），
    旧的 `s[i:i+cpl]` 硬切会把「生成」/「8.5%」/行尾虚词切得难看 —— 这里统一收口。
    ⚠️ kinsoku 只往回退，行可能变短、行数略增（调用方用 len(rows)<=nl 判，放不下就换更多行）。"""
    cpl = max(1, int(cpl))
    rows, i = [], 0
    while i < len(s):
        target = min(len(s), i + cpl)
        end = target if target >= len(s) else kinsoku_cut(s, i, cpl)
        if end <= i:                                   # 防御：绝不允许零推进
            end = target
        rows.append(s[i:end])
        i = end
    return rows


def _sub_rows(flat, W, base_fs, wrap=16, max_lines=2, min_ratio=0.6):
    """★VF_SUBSPLIT_V1（2026-09-30）：字幕行数要克制（不许铺满屏）。
    事故：留档里有一镜 subtitle 257 字 → 旧逻辑按"每行 16 字"硬排 = 17 行 → 整屏被字幕糊住。

    ★VF_SUBTITLE_NOELLIPSIS_V1（2026-10-01）——**末行「…」截断分支删除**：
      老板原话「字幕好像都没读完就卡住不换帧」= 观感上"没读完"。字幕是配音原文，一字不许丢。
      新口径（team-lead 拍板）：**优先缩一点字号 → 再允许 3 行 → 都不行才继续缩字号（下限之下）**，
      全程**绝不产生「…」**、绝不删字（rows 拼回 === 原文）。
    步骤（依次）：
      ① 从 max_lines(2) 起，目标行数 nl 逐个试到 hard=max(max_lines,3)（先 2 行、再 3 行）；
         每行容量 cpl = max(wrap, ceil(总字/nl)) —— 短字幕行为与改前**逐字一致**（该一行就一行、16 字/行）；
      ② 一行太长（cpl×字号 超安全宽）→ 降字号（下限 min_ratio×基准字号）；
      ③ 下限字号顶住还塞不进 nl 行 → 换更多行（nl+1）；
      ④ 3 行仍塞不进 → **继续缩字号**（低于下限）直到 3 行放下（宁可字小，也不丢内容）。
    返回 (rows, 实际字号)；rows 是**原文连续子串**（未转义，调用方负责 _ass_esc）。
    """
    s = str(flat or '')
    if not s:
        return [], int(base_fs)
    max_lines = max(1, int(max_lines))
    base_fs = int(base_fs)
    hard = max(max_lines, 3)                           # ★允许到 3 行（口径：先 2 行、再放 3 行）
    safe = float(W) * 0.92                             # 左右各留 4% 安全边（与顶部 banner 同口径）
    fs_floor = max(1, int(base_fs * float(min_ratio)))
    for nl in range(max_lines, hard + 1):
        cpl = max(1, max(int(wrap), -(-len(s) // nl)))  # ceil 除法（不 import math）
        if cpl * base_fs <= safe:                       # 基准字号就放得下
            rows = _kin_rows(s, cpl)
            if len(rows) <= nl:
                return rows, base_fs
        fs = max(1, int(safe / cpl))                    # 基准放不下 → 缩字号（不低于下限）
        if fs >= fs_floor:
            rows = _kin_rows(s, cpl)
            if len(rows) <= nl:
                return rows, fs
        cpl2 = max(1, int(safe / fs_floor))             # 字号被下限顶住 → 用下限字号重算容量再判
        if -(-len(s) // cpl2) <= nl:
            return _kin_rows(s, cpl2), fs_floor
    # ★VF_SUBTITLE_NOELLIPSIS_V1：3 行 + 下限字号仍排不下（超长）→ 继续缩字号，绝不删字 / 绝不「…」。
    cpl = max(1, -(-len(s) // hard))
    fs = max(1, min(base_fs, int(safe / cpl)))
    return _kin_rows(s, cpl), fs


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
# ★VF_DECK_STYLES_V1（2026-10-01 用户定案「1-2 都要：既要接进 AI，也要多做模版」）：
#   4 套「富编排 PPT 页」风格**现在也进 AI 白名单**（AI 可以在分镜里写 variant=deck-grad 等）——
#   所以它们必须出现在 TITLE_VARIANTS 里，与 src/lib/agent/vf/anti-ai.ts 的 VF_VARIANTS.title 逐项对账。
#   渲染侧的分派见 deck_style_of()/deck_page_filters()：每套各自一套元素层，其余 variant 一个像素都不动。
# ★VF_DECK_STYLES2_V1（2026-10-01 用户定案「配色真的不能太 AI 味」「最好有渐变色」「还有就是透明度」）
#   —— 再补 2 套（deck-glass 玻璃拟态 / deck-soft 柔和拟物），合计 6 套，同样都进 TITLE_VARIANTS。
#   ⚠️ TITLE_VARIANTS 的顺序 = 与 src/lib/agent/vf/anti-ai.ts 的 VF_VARIANTS.title / VF_DECK_VARIANTS
#      逐字对账的**唯一真相源**（scripts/vf-i2v-selftest.ts 会比对）—— 改动本行必须同步 src 侧。
TITLE_VARIANTS = ('center', 'left', 'chip', 'deck', 'deck-grad', 'deck-mono', 'deck-mag',
                  'deck-glass', 'deck-soft')
LIST_VARIANTS = ('steps', 'stack')
COMPARE_VARIANTS = ('split', 'bar')
MOTIONS = ('fade', 'slide', 'typewriter', 'grow')


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


# ══════════════════ ★VF_MOTIONPPT_V1（2026-09-30）「动态 PPT」渲染层动效 ══════════════════
# 用户本轮定案原话：「「动态 PPT」（版式/文字动效，渲染层、不花钱）」「每个都有渐进效果 分段插入」。
# 定位：**只做 FFmpeg 能确定做到的动作**（不追求 Remotion 那种任意 MG），全部成本为 0
#       —— 只用 ffmpeg 滤镜，不联网、不调 AI、不烧点。
#
# 三层动效模型（每层都有的已实现 / 新增）：
#   ① 入场：文字淡入（fade）/ 上滑淡入（slide）/ 逐字浮现（typewriter=_reveal_seq）
#           + 【新】整块版式滑入（enter = up / left，见 ppt_enter_filters）
#   ② 强调：数字滚动（number 卡，drawtext 的 %{eif} 逐帧递增，已实测）
#           + 逐条插入（list 卡，节奏本轮参数化）
#           + 【新】强调条从左往右生长（motion='grow'，见 grow_filters）
#   ③ 离场与转场：镜尾淡出（fade out）/ soft·cut·fade 转场 / 真交叉溶解（xfade，video+audio 两侧）
#
# ⚠️ 两条【必须记住】的 ffmpeg 实测结论（第一批就是踩它们才稳）：
#   1) `drawbox` 的 `w/h` 表达式**只在初始化求值一次、不逐帧** → 想做"生长"只能用
#      `enable='gte(t,起点)'` 分段（本机实测宽度 0→300→600，真在长）。
#   2) `pad/crop` 的 `x/y` 是**逐帧**求值的（本机实测白块 y 230→178→120，真在滑），
#      且 `drawtext` 的 `%{eif:...}` 也是逐帧的（数字真的从 0 往上跳）。
#   所以：尺寸/位置类"生长"用 enable 分段；整块位移用 pad+crop；数字滚动用 eif。
PPT_ENTERS = ('none', 'up', 'left')     # 整块版式入场方式白名单
PPT_ENTER_ON = True                     # 总开关（默认开，但极度克制；shot['enter']='none' 可单镜关）


def enter_of(shot):
    """★VF_MOTIONPPT_V1：纯文字卡【整块版式】入场方式。
    'up'  = 从下往上滑入（默认，最克制，像 PPT 版式轻轻推上来）
    'left'= 从左侧滑入（内容自左边归位）
    'none'/off 显式关闭；白名单外的自造值 → 回默认 'up'（绝不让 AI 自造值把渲染搞挂）。"""
    e = str((shot or {}).get('enter') or '').strip().lower()
    if e in ('none', 'off', 'false', '0'):
        return 'none'
    return e if e in PPT_ENTERS else 'up'


def ppt_enter_filters(shot, th, W, H, dur):
    """★VF_MOTIONPPT_V1：纯文字卡【整块版式】入场滑入（pad 垫出偏移 + crop 用 t 表达式逐帧归位）。

    ⚠️ 为什么不用 overlay 的 x/y 表达式：overlay 是**双输入**滤镜，必须走 filter_complex →
       会动到【所有卡型】的 `-vf` 单链渲染架构，改动面大、回归风险高。pad/crop 是**纯线性**滤镜，
       接在卡链尾部即可，一处接线、风险最小。
    ⚠️ 为什么这个位移是"真动画"：`drawbox` 的 w/h 只初始化求值一次（线上踩过的假动画），
       但 pad/crop 的 x/y 是**逐帧**求值的 —— 本机实测白块 y 230→178→120（真的在滑）。
    返回 filter 片段 list（空 list = 本镜不动）。"""
    e = enter_of(shot)
    if not PPT_ENTER_ON or e == 'none':
        return []
    _d = max(0.25, min(0.5, float(dur) * 0.12))      # 0.25~0.5s，克制
    _bg = th.get('bg', '0x0a1620')
    if e == 'left':
        _dl = max(8, int(W * 0.045))
        _dl += _dl % 2                                # yuv420p 要求偶数尺寸
        return [
            f"pad=w={W + _dl}:h={H}:x=0:y=0:color={_bg}",
            f"crop=w={W}:h={H}:x='{_dl}*(1-min(t/{_d:.2f},1))':y=0",
        ]
    _dl = max(6, int(H * 0.035))
    _dl += _dl % 2
    return [
        f"pad=w={W}:h={H + _dl}:x=0:y={_dl}:color={_bg}",
        f"crop=w={W}:h={H}:x=0:y='{_dl}*min(t/{_d:.2f},1)'",
    ]


def grow_filters(x, y, w, h, color, dur, delay=0.15, grow=0.45, seg=6):
    """★VF_MOTIONPPT_V1：一条"从左往右生长"的强调条（关键词下划线 / 色块）。
    用线上已验证的写法：**分段 drawbox + enable='gte(t,起点)'**。
    ⚠️ 绝不能给 drawbox 写"带 t 的宽度表达式"（那会让宽度只在初始化求值一次＝假动画，
       vf-style-selftest.py 已加断言拦它）；只有 enable 是逐帧的（本机实测宽度 0→300→600）。"""
    out = []
    _seg = max(2, int(seg))
    for _k in range(_seg):
        _wk = max(1, int(w * (_k + 1) / float(_seg)))
        _tk = float(delay) + float(grow) * _k / float(_seg)
        if _tk >= float(dur):
            break
        out.append(f"drawbox=x={x}:y={y}:w={_wk}:h={h}:color={color}:t=fill:enable='gte(t,{_tk:.2f})'")
    return out


# ══════════════════ ★VF_SUSTAIN_V1（2026-10-01）【持续型动效】上量 ══════════════════
# 用户原话：「PPT动效还是不显著，你看是不是只能如此了。到顶了。」
# 渲染层自查根因：到上一版为止，每一镜的动效**全是入场型**（0.25~0.5 秒做完就静止）——
#   入场再干净，长镜里也是"动一下就不动"，所以用户看到的就是"不显著"。
# 本批补的是【持续型】动效（整镜都在微微变化），四条（全部只用 ffmpeg 滤镜，零成本、不联网）：
#   A1 强调条慢生长   ：0.45s → 随镜长 0.45~2.8s（长镜才有持续感）—— grow_secs()
#   A2 大字轻微"呼吸" ：alpha 做 2~3 秒一轮的极小起伏（drawtext 的 alpha 是逐帧表达式）—— breath_alpha()
#   A3 卡片浮动加强   ：B 组卡片版式的浮动振幅 ×2（原 0.014H≈10px，实测"看不出动"）
#   A4 底部进度细线   ：整镜从左往右走完（drawbox 的 w 只初始化求值一次 → 只能 enable 分段）—— progress_filters()
# 总开关：shot['sustain']='none' / 'off' 可单镜关掉（默认开）；老主题同样受益（这是全局观感诉求）。
SUSTAIN_ON = True


def sustain_of(shot):
    """★VF_SUSTAIN_V1：本镜要不要持续动效。白名单外的自造值 → 按"开"处理（绝不把渲染搞挂）。"""
    s = str((shot or {}).get('sustain') or '').strip().lower()
    if s in ('none', 'off', 'false', '0'):
        return False
    return bool(SUSTAIN_ON)


def grow_secs(dur, lo=0.45, hi=2.8, k=0.55):
    """★VF_SUSTAIN_V1 A1：强调条"长满"所需秒数。

    短镜（≤0.8s）仍是 0.45s 的克制值；长镜（≥5s）拉到 2~3 秒 —— 这是用户说的"持续感"。
    0.55 系数是"差不多在镜长一半处长满"（后半段留给别的元素）。"""
    return max(float(lo), min(float(hi), float(dur or 0) * float(k)))


def breath_alpha(dur, amp=0.06, per=None):
    """★VF_SUSTAIN_V1 A2：整块文字的"呼吸"——返回 alpha 的**乘数**表达式。

    drawtext 的 alpha 是逐帧求值的（与本文件其它 t 表达式同机制），所以能做出真正连续的起伏。
    amp=0.06 → 亮度在 0.94~1.00 之间周期波动；周期默认 clamp(2.0, dur/2, 3.0)（"2~3 秒一轮"）。
    用法：`:alpha='min(t/0.5,1)*(0.940+0.060*sin(2*PI*t/2.60))'` —— 入场渐入乘上呼吸。

    ⚠️【本机抽帧实测踩过的坑，别把括号去掉】返回值**必须自带外层括号**：
      ffmpeg 表达式里 `A*0.94+0.06*sin(...)` 的乘法优先级高 → 展开成 `A*0.94 + 0.06*sin(...)`，
      于是"入场渐入 A=0"的元素仍然拿到 **0.06 的底噪 alpha** → 在入场前**隐约可见**
      （deck 页实测：t=0.6 本应只有 kicker+标题，却能看到淡淡的副标/要点/数字"0"）。
      带括号后才是真正的"入场渐入 × 呼吸"。"""
    _amp = abs(float(amp))
    _p = float(per or max(2.0, min(3.0, float(dur or 3) / 2.0)))
    return '(%.3f+%.3f*sin(2*PI*t/%.2f))' % (1.0 - _amp, _amp, _p)


def grow_v_filters(x, y_top, w, h, color, dur, delay=0.12, grow=0.45, seg=8):
    """★VF_SUSTAIN_V1 A1：**竖直**强调条"从上往下缓慢长高"（同样走 enable 分段）。

    为什么要单独一个：`grow_filters` 长的是**宽度**（横向条用），拿它去长一根竖条会变成
    "一个方块横向撑开"，观感是错的。竖条必须长高度。"""
    out = []
    _seg = max(2, int(seg))
    for _k in range(_seg):
        _hk = max(1, int(h * (_k + 1) / float(_seg)))
        _tk = float(delay) + float(grow) * _k / float(_seg)
        if _tk >= float(dur):
            break
        out.append(f"drawbox=x={x}:y={y_top}:w={w}:h={_hk}:color={color}:t=fill:enable='gte(t,{_tk:.2f})'")
    return out


def progress_filters(W, H, dur, color, seg=16, y=None, h=None, x0=0, w=None):
    """★VF_SUSTAIN_V1 A4：一条【走完整镜】的进度细线（常驻动效）。

    ⚠️ 与 grow_filters 同一类坑：drawbox 的 `w/h` 表达式只在初始化求值一次（假动画），
       所以"从左到右走完"只能把线**分段**（每段一个更宽的 drawbox）+ `enable='gte(t,起点)'`。
    seg=16 → 长镜里约每 0.3~0.4 秒进一格，看着是"线在走"，不是"闪一下"。
    x0/w：★VF_DECK_V1 的页内进度线用 —— 只在【版面区域】里走（不给 = 整幅从 x=0 到 W）。"""
    _h = max(2, int(h if h is not None else max(2, int(H * 0.0055))))
    _y = int(y if y is not None else (H - _h - max(1, int(H * 0.004))))
    _w = max(2, int(w if w is not None else W))
    _x = max(0, int(x0))
    _seg = max(4, int(seg))
    out = []
    for _k in range(_seg):
        _wk = max(1, int(_w * (_k + 1) / float(_seg)))
        _tk = float(dur or 0) * _k / float(_seg)
        out.append(f"drawbox=x={_x}:y={_y}:w={_wk}:h={_h}:color={color}:t=fill:enable='gte(t,{_tk:.2f})'")
    return out


# ══════════════════ ★VF_SUSTAIN_V2（2026-10-01）纯文字卡"绝不长时间静止" ══════════════════
# 老板原话：「（整页只有几个大字）后面 5~6.5 秒完全静止」。
# 实测（team-lead 给的硬数字）：007 静止 45.1% / 006 48.1%（基线 004 只有 24.7%）。
# 渲染层自查根因：A1/A2/A4 全是**小面积**动效（一条 2~4px 细线 / 大字 alpha 6% 呼吸），
#   帧间差分（`tblend=all_mode=difference` 的 YAVG）只有 0.0x~0.2 →
#   在官方 scripts/vf-film-health.mjs 里仍被算成「静止」（阈值 <0.30）。
#   ★ 关键认知：YAVG 量的是【相邻两帧】的差 → 只有"整幅在动"才能把它抬到 ≥1.0；
#     "一小块在动"无论怎么加都抬不动（本机用静帧底板实测过：移动光带 = 依旧 100% 静止）。
# 本版补一个**整块版式**的持续运动 —— 极慢的**横向**浮动（整幅一起动）：
#   · 幅度/周期（★ 全部本机对 8s title 卡真渲 + vf-film-health 量化过的，不是拍脑袋）：
#       26px(=2.03%W) / 周期 4s → 时间轴 `#++##++##++##++#`（6 个 #，0-2/2-4/4-6/6-8 四窗全覆盖，静止 0s）
#       18px                       → `#++#+++##++#+++#`（6 个 #，也过）
#       12px                       → `++++++.++++++++.+`（**无 #，不达标**）→ 下限定在 ~1.4%W
#     取 26px 留余量（内容更稀的卡一般帧间差更小）。
#   · 只用【横向】：scale 横向放大 2×amp 再 crop 平移 —— **上下内容一个像素都不丢**
#     （顶部强调条 / 底部分部线 / 底部装饰都在原位）。试过"纵向浮动/整体 zoompan"：
#     会把顶部强调细条裁掉，观感反而变差。
#   · 周期按镜序轮换（4.0 / 3.6 / 4.4s）→ 整片不会"每一镜同一个节奏"（反 AI 味清单的一条）。
#   ⚠️ 拼接位置：必须**接在进度线之前**（progress_filters 之后再接 → 进度线会被一起缩放平移并裁出画面）。
FLOAT_ON = True
# ★VF_SUSTAIN_V3（2026-10-01 晚，配合 ★VF_DECK_LIGHTFACE_V1 "淡染面"）：幅度 26px → **40px(3.13%W)**。
#   为什么要加：白杠改成"极淡染色面"后，整页**纹理/对比**都变低 → 同样的横向位移产生的帧间差更小。
#   本机复测 6 套 deck 页 8s 时间轴：26px 下 `deck-glass` `#+.+++.+#+++#++#`（2–4s 窗不达标）、
#   `deck-grad` 也不稳；**40px 下 6/6 全达标**（见报告里的时间轴表）。
#   40px@4s 周期 = 逐帧约 2.5px 的缓慢漂移（team-lead 看过 26px 的 t=1/t=3 两帧，判定"不抖"；
#   40px 是同一种运动、只是幅度大一点）；
#   裁切量仍只有 3.1%（关键元素安全边距 ≥7%：大字 maxw_ratio 0.86、deck 区域右沿 1170 < 1240）。
#   12px(0.94%W) 实测完全无 `#` → 硬下限；18/26px 在"白杠"时代够用，淡染面时代不够。
FLOAT_AMP_RATIO = 0.0313
FLOAT_PERIODS = (4.0, 3.6, 4.4)
# A6 背景渐变"流动"加速（只给纯文字卡；`_grad_speed()` 的生产默认 0.015 一个字都不动）。
#   为什么还需要它：横向浮动吃的是**画面纹理**，纹理少的卡（compare / chart / end：大色块 + 少量字）
#   帧间差偏小 → 26px 浮动只把时间轴抬到 `#++++++++++++++#`（2 个 #，不达标）。
#   本机实测（compare 卡 8s，只改这一个变量）：speed 0.015(现状) → 2 个 #；0.05 → 8 个 #；
#   0.15 → 10 个 #（四窗全覆盖）。取 **0.12**（≈现状 8 倍，肉眼仍是"氛围光在缓慢流动"，
#   见 dist-rel/_t2/f_gc04_t1.png / t3.png 的观感对照）。
FLOAT_GRAD_SPEED = '0.12'


def float_motion_filters(shot, th, W, H, dur):
    """★VF_SUSTAIN_V2：纯文字卡的**整块横向浮动**（整镜持续、极慢、极克制）。
    返回 filter 片段 list（空 list = 本镜不动）；shot['sustain']='none' 可单镜关。"""
    if not FLOAT_ON or not sustain_of(shot):
        return []
    d = float(dur or 0)
    if d < 1.2:                                   # 太短的镜不值得（会显得"抖"）
        return []
    amp = max(4, int(round(W * FLOAT_AMP_RATIO)))
    amp += amp % 2                                # yuv420p 要偶数
    # ★VF_STYLES_V1：成品风格可以指定这一套的节奏周期（`_float_per`）；没选风格 → 按镜序轮换
    try:
        per = float(shot.get('_float_per') or 0) or FLOAT_PERIODS[int(shot.get('_idx') or 0)
                                                                 % len(FLOAT_PERIODS)]
    except Exception:
        per = FLOAT_PERIODS[int(shot.get('_idx') or 0) % len(FLOAT_PERIODS)]
    sw = W + amp * 2
    sw += sw % 2
    # t=0 时 sin=0 → crop x=amp = 缩放后画面正中，与"完全不浮动"的版式逐像素对齐（入场那 0.5s 不跳）
    return [
        'scale=%d:%d' % (sw, H),
        "crop=%d:%d:x='%d+%d*sin(2*PI*t/%.2f)':y=0" % (W, H, amp, amp, per),
    ]


def card_title(shot, th, W, H, fps):
    """标题卡：大字居中 + 逐字浮现 + 主题色装饰

    ★VF_BIGTEXT_FALLBACK_V1：大字为空时用【该镜字幕首句】兜底 —— 否则这卡就是"整屏空白"
      （用户实测：36 镜里 6 镜没有大字，其中一镜空屏 5 秒）。
    ★VF_CARDSTYLE_V1（2026-09-24 用户："成片的文字画面有点简陋"）：大字上方加一条主题色
      短线 + 通栏细线 —— 纯色底只有一行字太素，靠这条装饰拉开层次，但不喧哗。
    """
    font = font_bold(th)          # ★VF_FONTWEIGHT_V1：标题用粗体（层级感）
    dur = float(shot.get('dur', 3))
    fs = int(shot.get('fontsize', big_fs(W, H, 0.13, 64)))   # ★VF_STYLE_V1：按画幅取向取字号
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
    # ══════════════ ★VF_DECK_V1（2026-10-01）「富编排 PPT 页」══════════════
    # 用户原话：「单独设计的PPT动效页 最好不要就几个大字，内容编排丰富一点可以吗？」
    #   「就是做PPT也不可能一页就几个大字。你能单独根据我的素材 编辑 1、2 个动效 PPT 给我看下嘛」
    # 只有 shot['variant']=='deck' 才走这里；**不进 TITLE_VARIANTS**（那会破坏 render.py↔anti-ai.ts
    #   的白名单对账），白名单外的自造值一律回落老版式（零回归）。背景仍交给 render_shot 的
    #   stage_layer（渐变质感底），所以这里只返回"元素层"。
    if deck_of(shot):
        _dk = deck_page_filters(shot, th, W, H, dur, font=font)
        if _dk:
            print('[VF] ★VF_DECK_V1 富编排 PPT 页（%s）：%d 个元素层（分段入场 + 持续动效）'
                  % (th.get('id'), len(_dk)))
            return (deck_base_input(shot, th, W, H, dur), ','.join(_dk), dur)
    # ══════════════ ★VF_STYLE_V1（2026-09-30 ②「先固定新闻资讯和科技数据」）══════════════
    # 用户原话：「我就是单独做的文字页都很空洞配色单一 不灵活」
    #          「我发了几个博主的视频截图…它这里的【文字配色】和还有【每个都有渐进效果 分段插入】」
    # 参考图的设计语言 → 本分支（只对 news/data 两套编辑风主题生效）：
    #   ① 小标签条 kicker（蓝底白字，如「BBC News·前线专栏」）
    #   ② 信息卡：顶部强调色条 + 大标题 + 细分割线 + 灰字副标（"每块字都有壳"）
    #   ③ 中文标题 + 英文全大写小字（★用户明确：英文用无衬线 + 超宽字距，别拿中文字体排英文）
    #   ④ 分段渐次出现：kicker → 标题逐行 → 分割线 → 英文副标，各自错开入场
    #   注：FFmpeg 的 drawbox 不支持 alpha 表达式（只能 enable 硬切），所以"壳"静态、文字分段渐入。
    if _is_editorial(th) and _var == 'center' and txt:
        _card_bg = th.get('cardBg', 'black@0.46')
        _card_fg = th.get('cardText', txc)
        _card_sub = th.get('cardSub', txc)
        _kbg, _kfg = th.get('kickerBg', acc), th.get('kickerText', 'white')
        _linec = th.get('line', 'white@0.30')
        _enfont = esc_path(find_font(th.get('enFont', 'arial')))
        _kick = str(shot.get('kicker') or shot.get('tag') or shot.get('eyebrow') or '').strip()[:18]
        _en = str(shot.get('en') or shot.get('enTitle') or shot.get('enSub')
                  or shot.get('sub_en') or '').strip()[:48]
        _pad = max(18, int(fs * 0.44))
        _ratio = max(0.40, (int(W * 0.86) - 2 * _pad) / float(W))
        _lines, fs = fit_big_text(txt, W, H, fs_max=fs, max_lines=2, maxw_ratio=_ratio)
        _rows = max(1, len(_lines))
        _gl = int(fs * 1.34)
        _kfs = max(20, int(fs * 0.30))
        _kpad = max(8, int(_kfs * 0.40))
        _kbar_h = _kfs + 2 * _kpad
        _efs = max(18, int(fs * 0.32))
        # ★英文副标必须放得进信息卡（实测 'NORTH KOREA DEPLOYMENT CRISIS' 会顶出卡的右边）：
        #   先逐档缩字号，实在还长就截断 —— 宁可短一点，也不许溢出卡面。
        _etrack = _track(_en)
        _ew = max(80, int(W * 0.86) - 2 * _pad)
        while _efs > 12 and est_text_w(_etrack, _efs) > _ew:
            _efs = int(_efs * 0.94)
        while _etrack and est_text_w(_etrack, _efs) > _ew:
            _etrack = _etrack[:-2]
        _kick_h = (_kbar_h + int(fs * 0.30)) if _kick else 0
        _en_h = int(_efs * 1.9) if _en else 0
        _cx, _cw = int(W * 0.07), int(W * 0.86)
        _ch = _pad * 2 + _gl * _rows + _kick_h + _en_h
        _cy = int(H * 0.5 - _ch * 0.5)
        em = [
            f"drawbox=x={_cx}:y={_cy}:w={_cw}:h={_ch}:color={_card_bg}:t=fill",
            f"drawbox=x={_cx}:y={_cy}:w={_cw}:h={max(6, int(fs * 0.10))}:color={acc}@0.95:t=fill",
        ]
        _y = _cy + _pad
        if _kick:
            _kbw = int(est_text_w(_kick, _kfs) + _kpad * 2)
            em.append(f"drawbox=x={_cx + _pad}:y={_y}:w={_kbw}:h={_kbar_h}:color={_kbg}@0.95:t=fill")
            em.append(
                f"drawtext=fontfile='{font}':text='{esc_text(_kick)}':fontsize={_kfs}:"
                f"fontcolor={_kfg}:x={_cx + _pad + _kpad}:y={_y + _kpad}:"
                f"alpha='min(max(t-0.15,0)/0.4,1)'")
            _y += _kbar_h + int(fs * 0.30)
        for _i, _ln in enumerate(_lines):
            em.append(
                f"drawtext=fontfile='{font}':text='{esc_text(_ln)}':fontsize={fs}:"
                f"fontcolor={_card_fg}:x={_cx + _pad}:y={_y + _i * _gl}:"
                f"alpha='min(max(t-{0.35 + 0.22 * _i:.2f},0)/0.5,1)'")
        _y += _gl * _rows
        if _en:
            em.append(f"drawbox=x={_cx + _pad}:y={_y + int(_efs * 0.35)}:w={int(_cw * 0.26)}:"
                      f"h={max(2, int(fs * 0.03))}:color={_linec}:t=fill")
            em.append(
                f"drawtext=fontfile='{_enfont}':text='{esc_text(_etrack)}':fontsize={_efs}:"
                f"fontcolor={_card_sub}:x={_cx + _pad}:y={_y + int(_efs * 0.95)}:"
                f"alpha='min(max(t-0.75,0)/0.5,1)'")
        print('[VF] 编辑风标题卡（%s）：信息卡 + 顶部强调条%s%s'
              % (th.get('id'), ' + 小标签条' if _kick else '', ' + 英文副标（无衬线/宽字距）' if _en else ''))
        return (f"-f lavfi -i color=c={th.get('bg', '0x0a1620')}:s={W}x{H}:d={dur}",
                ','.join([p for p in em if str(p).strip()]), dur)
    _gap_line = int(fs * 1.34)
    _block_top = int(H * 0.5 - _gap_line * len(_lines or [txt]) * 0.5)
    _bar_h = max(6, int(fs * 0.09))
    if _var == 'left':
        # 左对齐：强调竖条 + 每行左端对齐（不再居中）——同一条片里"有对齐关系"看着更高级
        _x0 = int(W * 0.12)
        _bar_x = max(int(W * 0.06), _x0 - int(fs * 0.28))
        # ★VF_SUSTAIN_V1 A1：左侧强调竖条改为"缓慢长高"（长镜里一直在长，不再一入场就定格）
        if sustain_of(shot):
            _gs = grow_secs(dur)
            _bvbar = grow_v_filters(_bar_x, _block_top, max(6, int(fs * 0.10)),
                                    _gap_line * len(_lines or [txt]) + int(fs * 0.2),
                                    acc + '@0.95', dur, delay=0.12, grow=_gs,
                                    seg=max(6, int(_gs * 5)))
        else:
            _bvbar = [f"drawbox=x={_bar_x}:y={_block_top}:w={max(6, int(fs * 0.10))}:"
                      f"h={_gap_line * len(_lines or [txt]) + int(fs * 0.2)}:color={acc}@0.95:t=fill"]
        parts = list(_bvbar)
        # ★VF_SUSTAIN_V1 A2：大字"呼吸"（alpha 乘一个小幅周期起伏）
        _bren = '*' + breath_alpha(dur) if sustain_of(shot) else ''
        for _i, _ln in enumerate(_lines or [txt]):
            _y = _block_top + _i * _gap_line
            _ys = _slide_y(_y, fs, dur) if _motion == 'slide' else str(_y)
            parts.append(
                f"drawtext=fontfile='{font}':text='{esc_text(_ln)}':fontsize={fs}:"
                f"fontcolor={txc}:borderw={max(2, int(fs * 0.05))}:bordercolor=black@0.6:"
                f"x={_x0}:y='{_ys}':alpha='min(t/0.45,1){_bren}'")
        body = ','.join(parts)
        deco = ''
    elif _var == 'chip':
        # 色块版式：强调色半透明宽带垫在大字块后面（"标签条"观感）
        _band_y = _block_top - int(fs * 0.22)
        _band_h = _gap_line * len(_lines or [txt]) + int(fs * 0.30)
        deco = (f"drawbox=x={int(W * 0.07)}:y={_band_y}:w={int(W * 0.86)}:h={_band_h}:"
                f"color={acc}@0.82:t=fill")
        body = ','.join(center_lines_drawtext(font, _lines or [txt], fs, 'white', W, H, dur,
                                              motion=_motion, breath=sustain_of(shot)))
    else:
        # center：老样式（短线 + 通栏细线，放在大字块正上方）
        _dy = max(int(H * 0.05), _block_top - int(fs * 0.66))
        # ★VF_MOTIONPPT_V1（2026-09-30）：motion='grow' → 强调色短线【从左往右生长】
        #   （用户要的"渐进/分段插入"里的"强调"层；opt-in，默认不动，避免成片变闹）。
        # ★VF_SUSTAIN_V1 A1（2026-10-01）：**默认也走"慢生长"**（不再只有 motion='grow' 才长）——
        #   用户实测反馈「动效还是不显著」，根因是"0.45 秒长完就静止"；现在长镜拉到 2~3 秒
        #   （grow_secs），短镜仍是 0.45 秒的克制值。
        if _motion == 'grow' or sustain_of(shot):
            _gs = grow_secs(dur)
            _grow_deco = grow_filters(int(W * 0.10), _dy, int(W * 0.10), _bar_h, acc + '@0.95',
                                      dur, delay=0.12, grow=_gs, seg=max(6, int(_gs * 6)))
        else:
            _grow_deco = []
        _line_deco = f"drawbox=x={int(W * 0.22)}:y={_dy + _bar_h // 2}:w={int(W * 0.68)}:h=2:color={txc}@0.16:t=fill"
        deco = ','.join(_grow_deco + [_line_deco]) if _grow_deco else ','.join([
            f"drawbox=x={int(W * 0.10)}:y={_dy}:w={int(W * 0.10)}:h={_bar_h}:color={acc}@0.95:t=fill",
            _line_deco,
        ])
        _rev = []
        if _motion == 'typewriter' and len(_lines) <= 1:
            _rev = _reveal_seq(shot, font, fs, txc, dur, text=(_lines[0] if _lines else txt))
        body = ','.join(_rev) if _rev else ','.join(
            center_lines_drawtext(font, _lines or [txt], fs, txc, W, H, dur, motion=_motion,
                                  breath=sustain_of(shot)))
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
    fs = int(shot.get('fontsize', big_fs(W, H, 0.075, 40)))   # ★VF_STYLE_V1：按画幅取向取字号
    acc, txc = th.get('accent', '0xff6b35'), th.get('text', 'white')
    parts = []
    y0 = int(H * 0.30)
    # ★VF_MOTIONPPT_V1（2026-09-30）：逐条插入的【节奏参数化】——不再写死 1.3s。
    #   用户原话：「每个都有渐进效果 分段插入」；节奏要跟镜长走，而不是固定值。
    #   规则（本轮定案）：每条间隔 = (本镜时长 − 起手 0.35s − 尾留 1.0s) / (条数−1)，
    #   且**最后一条必须留够 1 秒**展示（短镜不会被"闪一下就没"）。区间夹在 0.5~2.5s。
    #   AI/分镜显式写了 shot['step'] 时优先用它（向后兼容老分镜）。
    if shot.get('step') not in (None, '', 0):
        step = float(shot['step'])
    else:
        _n = len(items)
        _avail = max(0.4, float(dur) - 0.35 - 1.0)          # 尾留 1.0s 给最后一条
        step = max(0.5, min(2.5, _avail / max(1, _n - 1))) if _n > 1 else max(0.5, _avail)
    # 标题（可选）
    if shot.get('title'):
        parts.append(
            f"drawtext=fontfile='{font}':text='{esc_text(shot['title'])}':fontsize={int(fs * 0.9)}:"
            f"fontcolor={acc}:x={int(W * 0.10)}:y={int(H * 0.16)}:alpha='min(t/0.5,1)'")
    # ★VF_VARIANT_V1（2026-09-29 P1）：列表卡两种版式（AI 可写 variant，白名单外的值回 steps）
    #   steps（默认，老样式）= 一项=一步、逐项揭示（讲解节奏）· stack = 整板同时出现 + 每项前强调色方块（"清单"观感）
    _var = variant_of(shot, LIST_VARIANTS, 'steps')
    # ★VF_SUSTAIN_V1 A2（2026-10-01）：条目文字在"逐条插入"之后继续轻微呼吸（长镜里有持续感）
    _lst_br = '*' + breath_alpha(dur) if sustain_of(shot) else ''
    # ══════════════ ★VF_STYLE_V1（2026-09-30 ②编辑风列表：超大编号 + 黑色横条 + 逐条插入）══════════════
    # 参考图设计：左侧【超大编号】(1/2/3…) + 右侧【黑色半透明横条】里放白字标题，逐条出现。
    # 用户明确「每个都有渐进效果 分段插入」→ 新风格里**默认就是逐条**（不依赖 AI 写 variant）。
    # 实现说明（★2026-09-30 现场实测修正，别改回去）：
    #   **drawbox 的 w/h 表达式只在初始化时求值一次，不逐帧** —— 本机用
    #   `drawbox=w='100*min(t,1)'` 实测：t=0.3s 时就已经是满宽（不是"生长"）。
    #   所以横条改用 `enable='gte(t,起点)'` **按时间点插入**（drawbox 支持 enable，已实测有效），
    #   文字用 alpha 表达式错后 0.22s 淡入 —— 合起来就是"编号/横条先插进来，字随后跟上"。
    if _is_editorial(th) and items:
        _bar_bg = th.get('barBg', 'black@0.70')
        _bar_fg = th.get('barText', 'white')
        _kbg, _kfg = th.get('kickerBg', acc), th.get('kickerText', 'white')
        _bar_x = int(W * 0.19)
        _bar_maxw = int(W * 0.86) - _bar_x
        _padb = max(14, int(fs * 0.42))
        _maxw = max(int(W * 0.20), _bar_maxw - 2 * _padb)
        _lw = max([est_text_w(it, fs) for it in items] or [0])
        if _lw > _maxw:
            fs = max(18, int(fs * _maxw / float(_lw)))          # 最长那条也放得下（不溢出色条）
        _nfs = max(30, int(fs * 1.15))
        _num_x = int(W * 0.07)
        _y0 = int(H * 0.30)
        _avail = max(int(H * 0.40), int(H * 0.92) - _y0)
        _rowh = max(int(fs * 1.25), _avail // max(1, len(items)))
        _rowoff = max(0, (_avail - _rowh * len(items)) // 2)
        _bh = min(int(fs * 1.30), max(24, _rowh - max(4, int(_rowh * 0.10))))
        ep = []
        if shot.get('title'):
            _tfs = max(20, int(fs * 0.44))
            _tpad = max(8, int(_tfs * 0.40))
            _tw = int(est_text_w(str(shot['title'])[:16], _tfs) + _tpad * 2)
            ep.append(f"drawbox=x={_num_x}:y={int(H * 0.15)}:w={_tw}:h={_tfs + 2 * _tpad}:"
                      f"color={_kbg}@0.95:t=fill")
            ep.append(
                f"drawtext=fontfile='{font}':text='{esc_text(str(shot['title'])[:16])}':fontsize={_tfs}:"
                f"fontcolor={_kfg}:x={_num_x + _tpad}:y={int(H * 0.15) + _tpad}:alpha='min(t/0.5,1)'")
        for _i, _it in enumerate(items):
            _ry = _y0 + _rowoff + _i * _rowh
            _t_on = 0.35 + _i * step
            _bw = max(int(W * 0.26), min(int(est_text_w(_it, fs) + _padb * 2), _bar_maxw))
            ep.append(
                f"drawtext=fontfile='{font_bold(th)}':text='{_i + 1}':fontsize={_nfs}:"
                f"fontcolor={acc}:x={_num_x}:y={_ry - int(fs * 0.16)}:"
                f"alpha='min(max(t-{_t_on:.2f},0)/0.4,1)'")
            ep.append(
                f"drawbox=x={_bar_x}:y={_ry}:w={_bw}:h={_bh}:color={_bar_bg}:t=fill"
                f":enable='gte(t,{_t_on:.2f})'")
            ep.append(
                f"drawtext=fontfile='{font}':text='{esc_text(_it)}':fontsize={fs}:"
                f"fontcolor={_bar_fg}:x={_bar_x + _padb}:y={_ry + (_bh - fs) // 2}:"
                f"alpha='min(max(t-{_t_on + 0.22:.2f},0)/0.4,1){_lst_br}'")
        print('[VF] 编辑风列表卡（%s）：超大编号 + 横条 + 逐条插入（%d 条）' % (th.get('id'), len(items)))
        return (f"-f lavfi -i color=c={th.get('bg', '0x0a1620')}:s={W}x{H}:d={dur}",
                ','.join([p for p in ep if str(p).strip()]), dur)
    for i, it in enumerate(items):
        t_on = 0.5 + i * step
        if _var == 'stack':
            _iy = y0 + i * int(fs * 1.5)
            alpha = "min(max(t-0.35,0)/0.45,1)" + _lst_br
            parts.append(
                f"drawbox=x={int(W * 0.10)}:y={_iy + int(fs * 0.40)}:w={int(fs * 0.34)}:h={int(fs * 0.34)}:"
                f"color={acc}@0.95:t=fill")
            parts.append(
                f"drawtext=fontfile='{font}':text='{esc_text(it)}':fontsize={fs}:"
                f"fontcolor={txc}:x={int(W * 0.19)}:y={_iy}:alpha='{alpha}'")
            continue
        # 渐入；后面项出现时前面的项【保留但变暗】= 灰化作上下文
        alpha = f"if(lt(t,{t_on:.2f}),0,min((t-{t_on:.2f})/0.4,1)){_lst_br}"
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
    fs = int(shot.get('fontsize', big_fs(W, H, 0.22, 90)))   # ★VF_STYLE_V1：按画幅取向取字号
    acc, txc = th.get('accent', '0xff6b35'), th.get('text', 'white')
    # ★VF_TEXTFIT_V1：数字+后缀一起按字数反算字号（实测 '1700%' 在 fs=281 时宽约 1000px
    #   > 720px，两边都被切掉；`%` 修好之后这个溢出才暴露出来）
    _ntxt = str(val) + str(shot.get('suffix', ''))
    fs = min(fs, max(int(H * 0.06), int(W * 0.86 / max(1, len(_ntxt)))))
    # ★VF_VARIANT_V1（2026-09-29 P1「number 卡版式变体」）：center（默认居中）/ left（左对齐）
    _var = variant_of(shot, ('center', 'left'), 'center')
    # ★VF_SUSTAIN_V1 A2（2026-10-01）：数字滚动（eif）在 dur*0.66 就停 → 之后补"轻微呼吸"，
    #   让大数字在长镜里一直是"活的"（alpha 是逐帧表达式，零成本）。
    _num_br = (":alpha='%s'" % breath_alpha(dur)) if sustain_of(shot) else ''
    # ══════════════ ★VF_STYLE_V1（2026-09-30 ②编辑风数字卡）══════════════
    # 参考图设计：数字当主角 —— 【超大数字】+【小字单位（同色系）】+【细分隔线】+ 说明小字。
    # 老实现把单位直接拼在数字后面、同样大小（"300+" 一串），层级全平；这里把单位降为小字。
    if _is_editorial(th) and _var == 'center':
        _bfont = font_bold(th)
        _suf_txt = str(shot.get('suffix') or '').strip()
        _ufs = max(18, int(fs * 0.30))
        _numw = int(est_text_w(str(val), fs))
        _sufw = int(est_text_w(_suf_txt, _ufs)) if _suf_txt else 0
        _gap = int(fs * 0.12) if _suf_txt else 0
        _x0 = max(int(W * 0.06), int((W - (_numw + _gap + _sufw)) / 2))
        _ny = int(H * 0.5) - int(fs * 0.62)
        _rate = val / max(dur * 0.66, 0.1)
        dp = [
            f"drawtext=fontfile='{_bfont}':text='%{{eif\\:min(t*{_rate:.1f}\\,{val})\\:d}}':"
            f"fontsize={fs}:fontcolor={acc}:x={_x0}:y={_ny}{_num_br}",
        ]
        if _suf_txt:
            dp.append(
                f"drawtext=fontfile='{_bfont}':text='{esc_text(_suf_txt)}':fontsize={_ufs}:"
                f"fontcolor={acc}@0.85:x={_x0 + _numw + _gap}:"
                f"y={_ny + int(fs * 0.72) - int(_ufs * 0.72)}")
        _dvy = _ny + int(fs * 1.06)
        _dvw = int(W * 0.26)
        dp.append(f"drawbox=x={(W - _dvw) // 2}:y={_dvy}:w={_dvw}:h={max(2, int(fs * 0.030))}:"
                  f"color={th.get('line', 'white@0.30')}:t=fill")
        if shot.get('label'):
            dp.append(
                f"drawtext=fontfile='{_bfont}':text='{esc_text(shot['label'])}':"
                f"fontsize={max(20, int(fs * 0.26))}:fontcolor={txc}:x=(w-text_w)/2:"
                f"y={_dvy + int(H * 0.045)}:alpha='min(max(t-0.35,0)/0.6,1)'")
        print('[VF] 编辑风数字卡（%s）：超大数字 + 小字单位 + 细分隔线' % th.get('id'))
        return (f"-f lavfi -i color=c={th.get('bg', '0x0a1620')}:s={W}x{H}:d={dur}",
                ','.join([p for p in dp if str(p).strip()]), dur)
    if _var == 'left':
        _x0 = int(W * 0.10)
        _lparts = [
            f"drawtext=fontfile='{font}':text='%{{eif\\:min(t*{val / max(dur * 0.66, 0.1):.1f}\\,{val})\\:d}}{suf}':"
            f"fontsize={fs}:fontcolor={acc}:x={_x0}:y=(h-text_h)/2-{int(H * 0.06)}{_num_br}",
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
        f"fontsize={fs}:fontcolor={acc}:x=(w-text_w)/2:y=(h-text_h)/2-40{_num_br}"
    ]
    if shot.get('label'):
        parts.append(
            f"drawtext=fontfile='{font}':text='{esc_text(shot['label'])}':fontsize={int(fs * 0.28)}:"
            f"fontcolor={txc}:x=(w-text_w)/2:y=(h-text_h)/2+{int(fs * 0.75)}:alpha='min(t/0.8,1)'")
    return (f"-f lavfi -i color=c={th.get('bg', '0x0a1620')}:s={W}x{H}:d={dur}",
            ','.join(parts), dur)


def card_image(shot, th, W, H, fps):
    """图片 + Ken Burns 推拉

    ★VF_TPL_B1_V1（2026-09-30 B 组「图片处理」）：编辑风（news/data）默认走【卡片版式】
      （圆角 / 相框 / 阴影 / 浮动 / 擦入 / 背景分层虚化），图片从"糊满屏"变成"排版好的卡片"。
      老 8 套主题缺省 frame=none → 一个像素都不动。见 _plate_pre 的文件头。
    """
    src = shot.get('src', '')
    dur = float(shot.get('dur', 4))
    # ★VF_TPL_B1_V1：卡片版式优先（有素材且文件存在时才走；否则老实回落 Ken Burns）
    _po = plate_opts(shot, th)
    if _po and str(src).strip() and os.path.exists(str(src)):
        _pp = _plate_pre(src, W, H, shot, th, _po, dur=dur, layout='center')
        if _pp:
            # 卡片版式下**不再叠 Ken Burns**：整卡缓慢浮动已经提供了"活"，
            # 再推近会和圆角/阴影的几何打架（卡边会漂到画框外）。
            vf = _pp + f"[smooth]trim=duration={dur},setpts=PTS-STARTPTS,format=yuv420p"
            return (f"-loop 1 -t {dur} -i \"{src}\"", vf, dur)
    kb = shot.get('kb', 'zoomin')
    frames = max(1, int(dur * fps))
    if kb == 'zoomin':
        z = f"zoom='min(1+0.15*on/{frames},1.15)'"
    elif kb == 'zoomout':
        z = f"zoom='max(1.15-0.15*on/{frames},1.0)'"
    else:  # panright 等先归一到轻微放大
        z = f"zoom='min(1+0.10*on/{frames},1.10)'"
    # ★VF_STYLE_V1（2026-09-30 ③底图清晰度）：老代码一律 sigma=32 高斯模糊铺底（"底图有点模糊"）。
    #   现在交给 _bg_filters 三选一：接近画幅→直接裁切（清晰）/ 填不满→轻模糊(sigma=16) / 太小→不放大。
    _pre, _mode = _bg_filters(src, W, H)
    vf = (
        _pre +
        # ★2026-09-20：与 card_bgimage 一致 —— 不再 increase+crop 裁切，改用铺底 + 完整图居中
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
    fs = int(shot.get('fontsize', big_fs(W, H, 0.10, 54)))   # ★VF_STYLE_V1（④）：按画幅取向取字号
    txc = th.get('text', 'white')
    # ★VF_STYLE_V1（2026-09-30 ①治"字在图片上看不见"）：素材亮度 × 主题字色 → 自动改亮/改暗 + 换底衬
    _mat = _probe_material(src)
    txc, _boxc, _ = _mat_text_colors(th, _mat, txc, 'black@0.30', region_lum=_mat.get('lum_mid'))
    # ★VF_TEXTFIT_V2（2026-09-28）：折行优先（最多 2 行），放不下才缩字号 ——
    #   不再"长句一路缩成小字"（那是"同片里大字忽大忽小"的根因）。
    _band_v = ''
    if _is_editorial(th):
        # ★VF_EDITBIGTEXT_V1（2026-09-30）：编辑风视频镜同样走"编辑风大字"（与 bgimage 观感统一）
        _ed_rev, _ed_band, _ed_fs = _editorial_bigtext(shot, th, W, H, dur, fs, txc)
        _reveal = _ed_rev if (_ed_fs and overlay_text_on()) else []
        _band_v = _ed_band if (_ed_fs and overlay_text_on()) else ''
    else:
        _lines, fs = fit_big_text(str(shot.get('text') or ''), W, H, fs_max=fs, max_lines=2)
        _rev = _reveal_seq(shot, font, fs, txc, dur, text=_lines[0], box=_boxc, W=W, H=H) if len(_lines) <= 1 else []
        # ★OVERLAY_TEXT_SWITCH_V1：开关关闭 → 这一镜不叠大字（压暗与字幕照旧）
        _reveal = (_rev if _rev else center_lines_drawtext(font, _lines, fs, txc, W, H, dur)) if overlay_text_on() else []
    _bar_y = int(H * 0.72)
    # ★VF_MATGUARD_V1 同款口径：素材本来就暗（深色录屏）就别再压 15%（否则"一片黑"）
    _dim = 0.06 if int(_mat.get('lum', 160) or 160) < 78 else 0.15
    _chain = [
        f"drawbox=x=0:y=0:w={W}:h={H}:color=black@{_dim}:t=fill",
        f"drawbox=x=0:y={_bar_y}:w={W}:h={H - _bar_y}:color=black@0.30:t=fill",
    ] + ([_band_v] if _band_v else []) + _reveal
    # ★VF_FILTERJOIN_V1（2026-09-30 线上事故防御）：拼滤镜前丢掉空串/纯逗号 ——
    #   事故现场：第 8 镜 bgimage 崩「No such filter: ''」（空滤镜）；根因是某处拼进了空串或尾逗号。
    #   这里统一清洗，以后任何一处忘了判空都不会再让整条片崩掉。
    _chain = [x for x in _chain if str(x).strip().strip(',')]
    # ★VF_STYLE_V1（③底图清晰度）：视频片段同样不再一律 sigma=32 模糊（用户实测"底图有点模糊"）
    _pre, _mode = _bg_filters(src, W, H)
    vf = (
        _pre +
        # ★2026-09-20：视频片段同样不再裁切（铺底 + 完整画面居中）
        f"[smooth]{_slow}" + ','.join(_chain) + ','
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
    fs = int(shot.get('fontsize', big_fs(W, H, 0.10, 54)))   # ★VF_STYLE_V1（④）：按画幅取向取字号
    txc = th.get('text', 'white')
    # ★VF_STYLE_V1（2026-09-30 ①）：AI 片段的亮度完全不可控 → 同样按素材体检自动改字色/底衬
    _mat = _probe_material(src)
    txc, _boxc, _ = _mat_text_colors(th, _mat, txc, 'black@0.30', region_lum=_mat.get('lum_mid'))
    _band_v = ''
    if _is_editorial(th):
        # ★VF_EDITBIGTEXT_V1（2026-09-30）：AI 片段镜同样走"编辑风大字"（与 bgimage/video 观感统一）
        _ed_rev, _ed_band, _ed_fs = _editorial_bigtext(shot, th, W, H, dur, fs, txc)
        _reveal = _ed_rev if (_ed_fs and overlay_text_on()) else []
        _band_v = _ed_band if (_ed_fs and overlay_text_on()) else ''
    else:
        _rev = _reveal_seq(shot, font, fs, txc, dur, box=_boxc) if overlay_text_on() else []   # ★OVERLAY_TEXT_SWITCH_V1
        _reveal = _rev
    _bar_y = int(H * 0.72)
    _dim = 0.06 if int(_mat.get('lum', 160) or 160) < 78 else 0.15
    _chain = [
        f"drawbox=x=0:y=0:w={W}:h={H}:color=black@{_dim}:t=fill",
        f"drawbox=x=0:y={_bar_y}:w={W}:h={H - _bar_y}:color=black@0.30:t=fill",
    ] + ([_band_v] if _band_v else []) + _reveal
    # ★VF_FILTERJOIN_V1（2026-09-30 线上事故防御）：拼滤镜前丢掉空串/纯逗号 ——
    #   事故现场：第 8 镜 bgimage 崩「No such filter: ''」（空滤镜）；根因是某处拼进了空串或尾逗号。
    #   这里统一清洗，以后任何一处忘了判空都不会再让整条片崩掉。
    _chain = [x for x in _chain if str(x).strip().strip(',')]
    # ★VF_STYLE_V1（③底图清晰度）：AI 片段同样按素材与画幅的关系选铺法（不再一律糊）
    _pre, _mode = _bg_filters(src, W, H)
    vf = (
        _pre +
        f"[smooth]{_slow}" + ','.join(_chain) + ','
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
    fs = int(shot.get('fontsize', big_fs(W, H, 0.085, 46)))   # ★VF_STYLE_V1：按画幅取向取字号
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
    fs0 = int(shot.get('fontsize', big_fs(W, H, 0.07, 40)))   # ★VF_STYLE_V1：按画幅取向取字号
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
    # ★VF_STYLE_V1（2026-09-30 ②）：编辑风这里**只加"细线 + 强调色"，不重排版式**（用户要求别大改）
    if _is_editorial(th):
        parts.append(f"drawbox=x={int(W * 0.12)}:y={int(H * 0.13)}:w={int(W * 0.76)}:"
                     f"h={max(2, int(H * 0.0035))}:color={th.get('line', 'white@0.30')}:t=fill")
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
    fs = int(shot.get('fontsize', big_fs(W, H, 0.055, 32)))   # ★VF_STYLE_V1：按画幅取向取字号
    acc, txc = th.get('accent', '0xff6b35'), th.get('text', 'white')
    mx = max([float(i.get('value', 0)) for i in items] or [1]) or 1
    bar_max = int(W * 0.62)
    parts = []
    if shot.get('title'):
        parts.append(f"drawtext=fontfile='{font}':text='{esc_text(shot['title'])}':fontsize={int(fs * 1.15)}:"
                     f"fontcolor={acc}:x={int(W * 0.08)}:y={int(H * 0.12)}:alpha='min(t/0.5,1)'")
    y0 = int(H * 0.30)
    # ★VF_STYLE_V1（2026-09-30 ②）：编辑风图表只补一条"底部细线"（强调色细线，别大改版式）
    if _is_editorial(th):
        parts.append(f"drawbox=x={int(W * 0.08)}:y={int(H * 0.885)}:w={int(W * 0.84)}:"
                     f"h={max(2, int(H * 0.003))}:color={th.get('line', 'white@0.30')}:t=fill")
    # ★VF_VARIANT_V1（2026-09-29 P1「chart 卡版式变体」）：bars（默认，左起向右生长）/
    #   rtl（从右往左生长；标签在右、数值在左 —— 排名类数据"从右往左"更符合阅读直觉）
    _var = variant_of(shot, ('bars', 'rtl'), 'bars')
    _fb = font_bold(th)
    # ★VF_STYLE_V1（2026-09-30 收尾①：修掉图表卡的【假生长动画】）
    #   老代码写 `w='{bw}*min(max(t-起点,0)/0.8,1)'`，但本机实测：**drawbox 的 w/h 表达式只在
    #   初始化时求值一次、不逐帧**（`drawbox=w='100*min(t,1)'` 在 t=0.3s 就已经满宽）→ 所谓"生长"
    #   一直是假的（横条从第 0 帧就满宽）。现在改成 **分段递进 + `enable` 按时间点插入**
    #   （drawbox 的 `enable` 是逐帧生效的，已实测）：一条横条拆成 _NSEG 段，
    #   第 k 段宽 = bw*(k+1)/_NSEG，且只在 `t >= 起点 + k*步长` 才出现 → 屏幕上真的在长。
    #   ⚠️ 别改回"裸 w= 表达式"：那样又变回假动画（vf-style-selftest.py 里已加断言拦它）。
    # ★VF_SUSTAIN_V1 A1（2026-10-01）：横条"长满"的秒数从写死 0.5s 改为**随镜长**（长镜 2.4s）——
    #   用户实测「动效不显著」的根因就是"长一下就不动"；段数同步加密（6→8）让生长更连续。
    _NSEG = 8
    _GROW = grow_secs(dur, 0.5, 2.4) if sustain_of(shot) else 0.5
    _bh_bar = int(fs * 0.7)

    def _bar_filters(x_left, bw, y, rtl=False):
        """分段递进的一条横条（rtl=True 时从右往左长）"""
        out = []
        for _k in range(_NSEG):
            _wk = max(1, int(bw * (_k + 1) / float(_NSEG)))
            _tk = t_on + _GROW * _k / float(_NSEG)
            _x = (x_left - _wk) if rtl else x_left
            out.append(f"drawbox=x={_x}:y={y}:w={_wk}:h={_bh_bar}:"
                       f"color={acc}@0.85:t=fill:enable='gte(t,{_tk:.2f})'")
        return out

    for i, it in enumerate(items):
        v = float(it.get('value', 0))
        t_on = 0.2 + i * 0.5
        _bw = max(2, int(bar_max * v / mx))
        yb = y0 + i * int(fs * 2.1)
        if _var == 'rtl':
            parts += _bar_filters(int(W * 0.92), _bw, yb, rtl=True)
            parts.append(f"drawtext=fontfile='{_fb}':text='{esc_text(it.get('label', ''))}':fontsize={fs}:"
                         f"fontcolor={txc}:x={int(W * 0.94)}-text_w:y={yb - int(fs * 0.05)}:alpha='min(max(t-%.2f,0)/0.5,1)'" % t_on)
            parts.append(f"drawtext=fontfile='{_fb}':text='{esc_text(str(it.get('value', '')))}':fontsize={int(fs * 0.9)}:"
                         f"fontcolor={txc}:x={int(W * 0.06)}:y={yb - int(fs * 0.1)}:alpha='min(max(t-%.2f,0)/0.5,1)'"
                         % (t_on + 0.3))
            continue
        parts += _bar_filters(int(W * 0.32), _bw, yb)
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


def _avg_rgb_region(path, ffmpeg, crop):
    """★VF_TEXTCONTRAST_V1（2026-10-01）：取素材**某个区域**的平均色（crop 后再缩到 1×1）。
    为什么要按区域量：老板帧 `full_t0260.png` 是"整帧不算暗、但大字落点那一条很暗"——
    整帧平均会把对比度判反。这里给"大字落点常去的带"各量一次。"""
    try:
        r = subprocess.run([ffmpeg, '-v', 'error', '-i', path, '-vf', crop + ',scale=1:1',
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
# ★VF_STYLE_V1（2026-09-30）：底图清晰度 / 文字对比度自适应用的小缓存与常量
_SIZE_CACHE = {}          # 素材原始分辨率缓存（ffprobe 只跑一次）
_BG_LOG_CACHE = set()     # 底图铺法日志去重（同一素材同一铺法只打一条，不刷屏）
_MAT_TEXT_LOG = set()     # 对比度自适应日志去重（同一主题同一方向只打一条）
EDITORIAL_THEMES = ('news', 'data')   # 编辑风主题 id（见 themes.py）


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
    # ★VF_TEXTCONTRAST_V1（2026-10-01）：再量"大字落点常去的两条带"的亮度——
    #   mid = 画面中间 1/3（默认落点，大字居中/card_video 用）；low = 下 1/3（满字素材落点用）。
    lum_mid, lum_low = lum, lum
    try:
        _rmid = _avg_rgb_region(path, ff, 'crop=iw:ih/3:0:ih/3')
        if _rmid:
            lum_mid = int(0.299 * _rmid[0] + 0.587 * _rmid[1] + 0.114 * _rmid[2])
        _rlow = _avg_rgb_region(path, ff, 'crop=iw:ih/3:0:2*ih/3')
        if _rlow:
            lum_low = int(0.299 * _rlow[0] + 0.587 * _rlow[1] + 0.114 * _rlow[2])
    except Exception:
        pass
    out = {'lum': lum, 'edge': edge, 'flat': flat, 'band': band,
           'lum_mid': lum_mid, 'lum_low': lum_low}
    if key:
        _MAT_CACHE[key] = out
    return out


def _probe_size(path):
    """素材原始分辨率 (w, h)；读不到 → (0, 0)。★VF_STYLE_V1（③底图清晰度：判断"能不能填满画幅"）"""
    key = str(path)
    hit = _SIZE_CACHE.get(key)
    if hit:
        return hit
    w = h = 0
    try:
        r = subprocess.run([find_ffprobe(), '-v', 'error', '-select_streams', 'v:0',
                            '-show_entries', 'stream=width,height',
                            '-of', 'default=noprint_wrappers=1:nokey=1', key],
                           capture_output=True, text=True, encoding='utf-8',
                           errors='replace', timeout=30)
        _v = [x.strip() for x in (r.stdout or '').replace('\r', '').split('\n') if x.strip()]
        if len(_v) >= 2:
            w, h = int(float(_v[0])), int(float(_v[1]))
    except Exception:
        w = h = 0
    _SIZE_CACHE[key] = (w, h)
    return (w, h)


def _bg_filters(src, W, H):
    """★VF_STYLE_V1（2026-09-30，③底图清晰度）

    用户原话：「它这个生动效还行，就是底图有点模糊。底图能清晰一点吗，因为这次做的是大分辨率」

    老做法（本函数覆盖前，4 个带素材的卡型都这么写）：不管素材多大、比例多接近画幅，
    一律 `scale=increase,crop,gblur=sigma=32,eq=brightness=-0.18` 当底纹 —— 糊得厉害。
    现在按素材与画幅的关系三选一（返回 (prefix, mode)，prefix 末尾一定产出 [smooth]）：
      · cover  素材宽高比≈画幅（差 <15%）且尺寸够大 → **直接裁切铺满**（清晰，全程不模糊）
      · soft   素材填不满画幅（如竖图进横屏）→ **轻模糊**铺底（sigma 32→16、压暗 0.18→0.10）
      · native 素材比画幅还小（放大一定糊）→ **不放大**：原尺寸居中 + 底面用素材平均色填充
    """
    sw, sh = _probe_size(src)
    if sw <= 0 or sh <= 0:
        mode, desc = 'soft', '素材尺寸未知 → 轻模糊铺底（sigma=16）'
    else:
        _close = abs((sw / float(sh)) - (W / float(H))) / (W / float(H)) < 0.15
        _small = (sw < W) or (sh < H)              # 想铺满就得放大
        _tiny = (sw < W * 0.6) or (sh < H * 0.6)   # 小到放大一定糊（>1.6 倍）
        if _close and not _small:
            mode, desc = 'cover', '素材接近画幅 → 直接裁切铺满（不模糊）'
        elif _close and _small:
            # 比例对得上、就是分辨率不够 → 放大必糊，宁可"原尺寸居中 + 底色填充"
            mode, desc = 'native', '素材分辨率低于画幅 → 不放大（保清晰）：原尺寸居中 + 底色填充'
        elif _tiny:
            # 又小又不合比例 → 同样不放大
            mode, desc = 'native', '素材太小 → 不放大（保清晰）：原尺寸居中 + 底色填充'
        else:
            # 比例差很远（竖图进横屏那种）→ 当底纹用，轻模糊（不再 32 那么糊）
            mode, desc = 'soft', '素材填不满 → 轻模糊铺底（sigma=16）'
    if mode == 'cover':
        pre = (f"scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H}[smooth];")
    elif mode == 'native':
        # 不放大：按 min(1, 画幅/素材) 缩到不超画幅（yuv420p 要偶数宽高）
        _k = min(1.0, W / float(sw), H / float(sh))
        nw = max(2, int(sw * _k) // 2 * 2)
        nh = max(2, int(sh * _k) // 2 * 2)
        pre = (f"split=2[bg0][fg0];"
               f"[bg0]scale=2:2,scale={W}:{H},eq=brightness=-0.06[bgb];"
               f"[fg0]scale={nw}:{nh}[fgs];"
               f"[bgb][fgs]overlay=(W-w)/2:(H-h)/2[smooth];")
    else:
        pre = (f"split=2[bg0][fg0];"
               f"[bg0]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},"
               f"gblur=sigma=16,eq=brightness=-0.10[bgb];"
               f"[fg0]scale={W}:{H}:force_original_aspect_ratio=decrease[fgs];"
               f"[bgb][fgs]overlay=(W-w)/2:(H-h)/2[smooth];")
    _tag = (str(src), mode)
    if _tag not in _BG_LOG_CACHE:
        _BG_LOG_CACHE.add(_tag)
        print('[VF] %s（%s）' % (desc, os.path.basename(str(src))[:28] or '(空)'))
    return pre, mode


# ══════════════════ ★VF_TPL_B1_V1（2026-09-30）B 组「图片处理」模版 ══════════════════
# 用户原话（本轮定案「动效 PPT 翻身做主」）：
#   「我给你拿 5 个图**本身应该是不需要 AI 动视的**。应该是在**视频和图片上做动效 PPT 效果**。」
#   「它们做几个图片**加相框一些特效**也是 AI 生图吗还是**特效转场就可以实现**？」
#   「只是利用 FFMPEG 加动态 PPT + AI 代码一些特效来实现，脚本增效。」
#   「你要的（相框/圆角/阴影/浮动、分栏、信息卡、拼贴、编号、逐词高亮、元素弹入、转场）」
# → 铁律：**合成线里绝不调 AI 生成视频**（AI 视频另有「AI 制片」「图生视频」两个独立功能）。
#   本组 = **纯 FFmpeg**：让"压在画面里的素材图"看起来像**排版好的卡片**，而不是"糊满屏的图"。
#
# 字段（分镜级，AI 可写；服务端白名单见 src/lib/agent/vf/anti-ai.ts 的 PICK_DESIGN_KEYS）：
#   frame   相框：'auto'(缺省) / 'none' / 'thin' / 'polaroid'   ← **本组主开关**
#   shadow  投影：'none' / 'soft' / 'strong'
#   float   浮动：'none' / 'slow'
#   wipe    擦入：'none' / 'left' / 'right' / 'center'
#   bgblur  背景虚化强度：'none' / 'soft' / 'strong'
#   缺省矩阵：**编辑风（news/data）全开**（thin / soft / slow / left / soft）；
#            **其余 8 套老主题全关**（一个像素都不动 —— 用户已习惯老观感）。
#            显式关闭：`frame='none'` 一条即关掉**整块**卡片版式（图片回到老的全幅铺法）。
#
# ⚠️ 本机实测结论（写进代码防止以后有人"想当然"改回去）：
#   1) `geq` **不允许只写 a 表达式**（报 `A luminance or RGB expression is mandatory`）
#      → 必须 r/g/b/a 四个都写；rgba 下用 r(X,Y)/g(X,Y)/b(X,Y) 透传原像素。
#      （首版探路时正因为只写了 a，5 条实测全崩。）
#   2) `geq` 很贵（900x520 全分辨率 ≈ 16ms/帧；4s 镜 ≈ 1.6s）。→ **圆角遮罩降到 1/2 分辨率算、
#      再 scale 回来**：本机实测 1.59s → 0.72s（4 倍提速），且灰片放大天然抗锯齿、圆角更柔。
#   3) `overlay` 的 x/y **是逐帧求值的**（本机实测：卡顶 y 应随 60*sin(2πt/2) 变，
#      t=0 是图片 / t=0.5 是背景 / t=1.5 又是图片，完全吻合）→ 浮动直接用 t 表达式。
#   4) `drawbox` 的 w/h **只求值一次**（假动画，见 VF_STYLE_V1 图表卡那段踩坑记录）
#      → 擦入/展开绝不能写 `w='…t…'`，只能 `enable='gte(t,..)'` 分段。
PLATE_FRAMES = ('auto', 'none', 'thin', 'polaroid')
PLATE_SHADOWS = ('none', 'soft', 'strong')
PLATE_FLOATS = ('none', 'slow')
PLATE_WIPES = ('none', 'left', 'right', 'center')
PLATE_BLURS = ('none', 'soft', 'strong')
_PLATE_BLUR_SIGMA = {'none': 0, 'soft': 14, 'strong': 30}
_PLATE_LOG = set()          # 同一(主题,参数组合)只打一条日志，不刷屏


def _plate_raw(shot, key):
    return str((shot or {}).get(key) or '').strip().lower()


def _even(n):
    """yuv420p / 条带切开都要求偶数尺寸 → 统一取偶"""
    return max(2, int(n) // 2 * 2)


def plate_opts(shot, th):
    """★VF_TPL_B1_V1：解析 B 组「图片处理」字段。返回 dict；**返回 None = 本镜不启用卡片版式**。

    白名单外的自造值 → 按"缺省"走（绝不抛异常、绝不把渲染搞挂，口径同 variant_of/enter_of）。
    """
    ed = _is_editorial(th)
    raw = _plate_raw(shot, 'frame')
    if raw in ('none', 'off', 'false', '0'):
        return None                        # 显式关闭：一条字段关掉整块卡片版式
    if raw in ('thin', 'polaroid'):
        fr = raw
    else:
        fr = 'thin' if ed else ''          # 缺省 / 'auto' / 自造值：编辑风 thin、老主题不启用
    if not fr:
        return None

    def pick(key, allowed, default):
        v = _plate_raw(shot, key)
        if v in allowed:
            return v
        if v in ('off', 'false', '0'):
            return 'none'
        return default

    return {
        'frame': fr,
        'shadow': pick('shadow', PLATE_SHADOWS, 'soft' if ed else 'none'),
        'float': pick('float', PLATE_FLOATS, 'slow' if ed else 'none'),
        'wipe': pick('wipe', PLATE_WIPES, 'left' if ed else 'none'),
        'bgblur': pick('bgblur', PLATE_BLURS, 'soft'),
    }


# ══════════════════ ★VF_TPL_LAND_V1（2026-09-30）横屏「左图右字」 ══════════════════
# 用户实测（1280×720 横屏 / news / 竖素材 768×1344）：走老 layout='top' 时卡片只有 212×374
#   （占 16.5%W × 52%H）→ 左右大片虚化/死黑，版面很空；用户原话「第一个图片应该是个 PPT
#   没有动效或者是不明显，时间过长」。
# 触发条件（三条**同时**满足才走 side，任何一条不满足 → 一行都不改，走老逻辑 = 零回归）：
#   ① 画幅是横屏（W > H）② 素材宽高比 ≤ PLATE_SIDE_MAX_AR(1.15)（竖图/方图）
#   ③ 本镜要在图上叠大字（shot['text'] 非空 且 画面大字开关为开）
# 老调用方兼容承诺：plate_text_x() 对非 side 一律返回 **0** → 所有 drawtext 的 x 表达式与改动前逐字相同。
PLATE_SIDE_MAX_AR = 1.15


def plate_side_layout(src, W, H, over_text):
    """★VF_TPL_LAND_V1：这一镜要不要走【左图右字】。返回 'side' 或 ''（'' = 一行都不改）。

    刻意做成**纯判定函数**（只 probe 一下素材尺寸）：① 自检脚本可单测；
    ② 调用方拿到 '' 就走老逻辑 → 老分镜 / 老主题的行为**逐字不变**（零回归）。"""
    if not over_text:
        return ''
    if not (W > H):                                   # 竖屏 / 方形画幅：不动（竖屏塞竖图本来就顺）
        return ''
    sw, sh = _probe_size(src)
    if sw <= 0 or sh <= 0:
        return ''
    if sw / float(sh) > PLATE_SIDE_MAX_AR:            # 横素材 / 超宽素材：不动（走老 top 更合适）
        return ''
    return 'side'


def plate_text_x(W, H, layout):
    """★VF_TPL_LAND_V1：这个 layout 下"压在素材上的大字"该从哪个 x 开始（**0 = 沿用老居中逻辑**）。

    side = 素材站左边，大字只能在**右侧**排版 → 返回 0.52W 作为大字块左边界；
    其余 layout（top / center）→ 返回 0。向后兼容承诺：老调用方拿到的行为逐字不变。"""
    if layout == 'side':
        return int(W * 0.52)
    return 0


def _plate_mask_expr(w, h, r):
    """圆角矩形的 alpha 表达式：角外 → 0，其余 → 255（r=圆角半径）"""
    dx = "max(max(%d-X,X-(%d-1)),0)" % (r, w)
    dy = "max(max(%d-Y,Y-(%d-1)),0)" % (r, h)
    return "if(lte(%s*%s+%s*%s,%d),255,0)" % (dx, dx, dy, dy, r * r)


def _plate_round(w, h, r):
    """圆角 alpha 遮罩（灰片）：1/2 分辨率算几何 → 放大回原尺寸（见文件头实测 ② ）。"""
    hw, hh = _even(max(2, w // 2)), _even(max(2, h // 2))
    r2 = max(2, int(r) // 2)
    return ("scale=%d:%d,format=gray,geq=lum='%s',scale=%d:%d,format=gray"
            % (hw, hh, _plate_mask_expr(hw, hh, r2), w, h))


def _plate_pre(src, W, H, shot, th, opts, dur=0.0, layout='center'):
    """★VF_TPL_B1_V1：B 组「卡片版式」铺法。

    返回 filter 前缀（**末尾一定产出 [smooth]**，与 _bg_filters 同契约，调用方原样接
    zoompan / 自己的文字层即可）；返回 None = 本镜放弃卡片版式（调用方回落 _bg_filters）。

    画面结构（自上而下 = 后叠前）：
      素材铺满 + 背景虚化(bgblur) + 压暗   ← "主体清晰、背景退后"的分层
        └ 阴影层（卡片形状复制 → 变黑 → 模糊 → 偏移）
             └ 卡片层（等比缩进画框 → 圆角 → 相框/白边）→ 浮动(t) / 擦入(enable 分段)

    layout='center'：图片卡（整张居中，最大 84%W × 76%H）
    layout='top'   ：素材卡（图片落上半，底部留给大字 + 字幕条）
    layout='side'  ：★VF_TPL_LAND_V1（2026-09-30）【左图右字】—— 横屏 + 竖/方素材 + 本镜要叠大字时，
                     卡片站左半区（垂直居中、高约 0.64H），右侧整块留给大字（起始 x 见 plate_text_x）。
                     调用方仍按老契约收字符串（末尾 [smooth]），**接口零变化**。
    """
    sw, sh = _probe_size(src)
    if sw <= 0 or sh <= 0:
        return None
    _fit = 'contain'
    if layout == 'side':
        # ★VF_TPL_LAND_V1：竖/方素材塞进横屏时不再"缩成中间一小张、左右大片虚化"——
        #   靠左站住，右侧给大字排版（用户实测横屏成片"版面很空"）。
        boxw, boxh = int(W * 0.44), int(H * 0.64)
        cy = int(H * 0.5)
        k = min(boxw / float(sw), boxh / float(sh))
        cw, ch = _even(max(2, sw * k)), _even(max(2, sh * k))
    elif layout == 'top':
        # 素材卡（图上 + 文下，"大图压题"那种博主资讯版式）：卡落上半，底部留给我们的大字。
        #   卡框取 **0.62W × 0.52H** 并居上（cy=0.29H）：横图得到一张"杂志主图"大小的卡，
        #   竖图也不会被压成一条；底部约 0.44H 之后留给大字/字幕条，互不打架。
        boxw, boxh = int(W * 0.62), int(H * 0.52)
        cy = int(H * 0.29)
        # 只有**超宽全景**（宽高比 ≥2.2）才裁切填满：那时等比装入会变成一条细缝。
        if sw / float(sh) >= 2.2:
            cw, ch, _fit = _even(boxw), _even(boxh), 'cover'
        else:
            k = min(boxw / float(sw), boxh / float(sh))
            cw, ch = _even(max(2, sw * k)), _even(max(2, sh * k))
    else:
        # 图片卡：整张居中、等比装入（不裁内容）
        boxw, boxh = int(W * 0.84), int(H * 0.76)
        cy = int(H * 0.5)
        k = min(boxw / float(sw), boxh / float(sh))
        cw, ch = _even(max(2, sw * k)), _even(max(2, sh * k))
    fr = opts['frame']
    frame_bg = th.get('frameBg') or 'white'
    line_c = str(th.get('line') or 'white@0.35')
    acc = str(th.get('accent') or '0xff6b35')
    b = 0
    if fr == 'polaroid':
        b = max(10, int(min(cw, ch) * 0.030))
        bb = max(b, int(b * 2.4))
        pw, ph = cw + 2 * b, ch + b + bb
        rad = max(6, int(min(pw, ph) * 0.022))
    else:
        pw, ph = cw, ch
        rad = max(8, int(min(cw, ch) * 0.055))
    if layout == 'side':
        # ★VF_TPL_LAND_V1：卡片在【左半区】居中（留 3%W 安全边）→ 右侧 0.5W 之后全是背景 + 大字
        x0 = int((int(W * 0.5) - pw) / 2.0)
        x0 = max(int(W * 0.03), x0)
    else:
        x0 = int((W - pw) / 2)
    y0 = int(cy - ph / 2.0)
    y0 = max(int(H * 0.03), min(y0, int(H * 0.97) - ph))

    parts = []
    # ① 输入拆两路：背景 / 卡片
    parts.append("split=2[bg0][card0]")
    # ② 背景：铺满 + 虚化（bgblur 控强度）+ 压暗 —— "主体清晰、背景退后"
    _sig = _PLATE_BLUR_SIGMA.get(opts['bgblur'], 14)
    _bgd = "scale=%d:%d:force_original_aspect_ratio=increase,crop=%d:%d" % (W, H, W, H)
    if _sig > 0:
        _bgd += ",gblur=sigma=%d" % _sig
    _bgd += ",eq=brightness=-0.16"
    parts.append("[bg0]" + _bgd + "[bgb]")
    # ③ 卡片：等比缩到画框内 →（拍立得）白边 /（thin）细边框+强调色小块 → 圆角 alpha 遮罩
    #    ⚠️ 边框/装饰一律画在**卡片图层自己身上**（在圆角遮罩之前）——
    #       这样它们跟着浮动/擦入一起动；若画到合成后的整帧上（drawbox 的 x/y 只求值一次），
    #       卡片一浮动边框就会跟卡片脱开（"假动画"那类坑的变体）。
    _cd = ("[card0]scale=%d:%d:force_original_aspect_ratio=increase,crop=%d:%d"
           % (cw, ch, cw, ch)) if _fit == 'cover' else ("[card0]scale=%d:%d" % (cw, ch))
    if fr == 'polaroid':
        # 拍立得：白边（底部更宽），像一张冲印出来的照片
        _cd += ",pad=w=%d:h=%d:x=%d:y=%d:color=%s" % (pw, ph, b, b, frame_bg)
    else:
        # thin：细边框（主题 line 色）+ 左上强调色小块（编辑风签名）；圆角遮罩会把四角切开 = 四角小切角
        _t = max(3, int(min(pw, ph) * 0.006))
        _cd += ",drawbox=x=0:y=0:w=%d:h=%d:color=%s:t=%d" % (pw, ph, line_c, _t)
        _ins = max(14, int(rad * 0.35))
        _bw = max(28, int(pw * 0.10))
        _bh = max(4, int(min(pw, ph) * 0.012))
        _cd += ",drawbox=x=%d:y=%d:w=%d:h=%d:color=%s@0.95:t=fill" % (_ins, _ins, _bw, _bh, acc)
        print('[VF] B 组细边框：%dpx（%s）+ 左上强调色小块 %dx%d' % (_t, line_c, _bw, _bh))
    _cd += (",split=2[imgA][mk0];"
            "[mk0]%s[mask];"
            "[imgA]format=rgba[imgR];"
            "[imgR][mask]alphamerge[cardA]" % _plate_round(pw, ph, rad))
    parts.append(_cd)
    # ④ 把「卡片 + 阴影」合成成**一个图层**（阴影在卡片下面）—— 这里踩过两个坑：
    #    ① 阴影必须在卡片**之下**：做法是把"变黑模糊后的卡片"和"卡片本体"各自 pad 到同一张
    #       **透明画布**（本机实测 pad 的 color=black@0 真的产出 alpha=0 的区域），再把卡片压在阴影上。
    #       若图省事把阴影直接 overlay 到画布上 → 卡片被压暗（实测卡片中心 (1,0,107) → (94,0,0)）。
    #    ② 阴影与卡片**必须同一个图层**：早期版本把阴影单独叠在背景上 → 擦入开始时阴影整块先亮出来，
    #       画面左右各冒出一块"鬼影"（t=0.35 抽帧复现）。合成一个图层后，浮动/擦入两者永远同步。
    n_sh = 1 if opts['shadow'] != 'none' else 0
    offx, offy = 0, 0
    if n_sh:
        _soft = opts['shadow'] == 'soft'
        _sa = 0.42 if _soft else 0.62
        _ss = max(6, int(min(pw, ph) * 0.045)) if _soft else max(10, int(min(pw, ph) * 0.075))
        offx = max(8, int(W * 0.014))
        offy = max(8, int(H * 0.020))
        _lw, _lh = _even(pw + offx), _even(ph + offy)
        parts.append("[cardA]split=2[shA][caA]")
        # 阴影 pad 到 (offx,offy)（= 往右下挪）；卡片 pad 到 (0,0)。两者同处一张画布 →
        # 阴影只在卡片右下缘露出来（若把阴影 pad 到 (0,0)、卡片 pad 到 (offx,offy)，
        # 阴影会跑到卡片左上方露出一条黑边 —— 本机抽帧就是这个症状）。
        parts.append("[shA]format=rgba,colorchannelmixer=rr=0:gg=0:bb=0:aa=%.2f,gblur=sigma=%d,"
                     "pad=w=%d:h=%d:x=%d:y=%d:color=black@0[shp]"
                     % (_sa, _ss, _lw, _lh, offx, offy))
        parts.append("[caA]pad=w=%d:h=%d:x=0:y=0:color=black@0[cnp]" % (_lw, _lh))
        parts.append("[shp][cnp]overlay=x=0:y=0[lyA]")
        print('[VF] B 组合成图层：阴影偏移 (%d,%d) 强度 %.2f 模糊 %d（图层 %dx%d）'
              % (offx, offy, _sa, _ss, _lw, _lh))
    else:
        parts.append("[cardA]null[lyA]")
    # 图层里卡片位于 (0,0) → 图层左上角就是卡片的位置 (x0,y0)
    _lay_w, _lay_h = _even(pw + offx), _even(ph + offy)
    _lay_x, _lay_y = x0, y0
    # ⑤ 浮动：overlay 的 x/y 逐帧求值（本机实测）→ 极缓慢漂移，方向按镜序轮换
    #   ★VF_SUSTAIN_V1 A3（2026-10-01）：振幅 0.014H(≈10px) → 0.028H(≈20px)，周期也从 2×镜长
    #   缩到 1.5×镜长。原因（用户实测"动效不显著"）：B 组卡片版式当初刻意取消了 Ken Burns、
    #   只留这点浮动，而这点幅度在 1280×720 上**基本看不出来**。二选一里选了"加强浮动"
    #   （另一条路是恢复极缓推拉，但那会和圆角/阴影几何打架，且自检明确禁止卡片链上 zoompan）。
    fx, fy = '0', '0'
    if opts['float'] == 'slow':
        amp = max(8, int(H * 0.028))
        per = max(3.0, float(dur or 4.0) * 1.5)
        if int(shot.get('_idx') or 0) % 2 == 0:
            fy = "%d*sin(2*PI*t/%.2f)" % (amp, per)          # 上下浮
        else:
            fx = "%d*sin(2*PI*t/%.2f)" % (amp, per)          # 左右浮
    # ⑥ 擦入/展开：drawbox 的 w 只算一次 → 只能把图层按条切开 + enable 分段（真动画）
    _wipe = opts['wipe']
    _n = 0
    _cur = '[bgb]'
    if _wipe != 'none':
        _nseg = 12
        _swid = _even(max(2, _lay_w // _nseg))
        _order = list(range(_nseg))
        _mid = (_nseg - 1) / 2.0
        if _wipe == 'left':
            _seq = _order
        elif _wipe == 'right':
            _seq = _order[::-1]
        else:                                                # center：中间先亮、向两侧展开
            _seq = sorted(_order, key=lambda kk: abs(kk - _mid))
        _rank = {kk: i for i, kk in enumerate(_seq)}
    if _wipe == 'none':
        parts.append("%s[lyA]overlay=x=%d+(%s):y=%d+(%s),format=yuv420p[smooth]"
                     % (_cur, _lay_x, fx, _lay_y, fy))
    else:
        parts.append("[lyA]split=%d%s" % (_nseg, ''.join('[w%d]' % kk for kk in range(_nseg))))
        for kk in range(_nseg):
            _sx = kk * _swid
            _wid = min(_swid, _lay_w - _sx)
            _tk = 0.12 + 0.62 * _rank[kk] / float(_nseg)
            parts.append("[w%d]crop=w=%d:h=%d:x=%d:y=0[cs%d]" % (kk, _wid, _lay_h, _sx, kk))
            parts.append("%s[cs%d]overlay=x=%d+(%s):y=%d+(%s):enable='gte(t,%.2f)'[m%d]"
                         % (_cur, kk, _lay_x + _sx, fx, _lay_y, fy, _tk, _n))
            _cur = '[m%d]' % _n
            _n += 1
        parts.append("%sformat=yuv420p[smooth]" % _cur)
    _tag = (str(th.get('id') or ''), fr, opts['shadow'], opts['float'], _wipe, opts['bgblur'])
    if _tag not in _PLATE_LOG:
        _PLATE_LOG.add(_tag)
        print('[VF] B 组图片模版：相框=%s 阴影=%s 浮动=%s 擦入=%s 背景虚化=%s（卡片 %dx%d @%d,%d，布局=%s）'
              % (fr, opts['shadow'], opts['float'], _wipe, opts['bgblur'], pw, ph, x0, y0, layout))
    return ';'.join(parts) + ';'


def _mat_text_colors(th, mat, txc, box='black@0.30', region_lum=None):
    """★VF_STYLE_V1（2026-09-30，①【最高优先·治线上问题】文字对比度自适应）

    用户原话：「我们本次输入可能是因为我选模版的问题字是黑灰色的，在图片上基本看不见」
    根因：主题 token 的 text/box 是**固定值** —— 用户选了 light 浅色纸感（字近黑 + 白底衬），
    压在深色素材上 → 黑字在暗画面上基本看不见。**主题不该决定看不看得见** → 渲染层兜底。

    判定（用已有的素材体检 lum，不做任何新依赖）：
      · 素材偏暗（lum < 110）且主题字色也偏暗（亮度 < 120）→ 大字改【近白】+ 底衬改【深色】
      · 素材偏亮（lum ≥ 110）且主题字色偏亮（亮度 ≥ 190）→ 大字改【近黑】+ 底衬改【浅色】
      · 其余（本来就有反差）→ 原样返回，一个字都不动
    只改"压在素材上的大字与其底衬"；纯文字卡的底板/字号一律不碰。

    ★VF_TEXTCONTRAST_V1（2026-10-01 team-lead）：
      · 判据改用**大字落点区**亮度 `region_lum`（不给才退回整帧 lum）—— "半亮半暗"素材上整帧平均会骗人
        （老板帧 full_t0260：整帧不算暗、但大字落点那一条很暗 → 原来判反、灰字压暗底发糊）。
      · 新增"低对比"判据：|落点亮度 − 字色亮度| < 70 一律算"读不出"（含"灰字压暗底"这种看着有字却读不清，
        以及 full_t0502 的"浅灰大字压浅灰卡片"）。
    返回 (文字色, 底衬色, 是否改过)；`region_lum=None` 时行为与改前**逐字一致**（零回归）。
    """
    lum = int((mat or {}).get('lum', 160) or 160)
    rl = lum if region_lum is None else int(region_lum)      # ★VF_TEXTCONTRAST_V1：优先用"大字落点区"亮度
    tl = _lum_of(txc, 255)
    _low = abs(rl - tl) < 70                                 # ★VF_TEXTCONTRAST_V1：低对比（含"灰字压暗底"）
    if (rl < 110 and tl < 120) or (_low and rl < 128):
        _tag = (str((th or {}).get('id') or ''), 'dark')
        if _tag not in _MAT_TEXT_LOG:
            _MAT_TEXT_LOG.add(_tag)
            print('[VF] ★VF_TEXTCONTRAST_V1 落点偏暗(%.0f)/字色偏暗(%.0f) → 大字改亮色 + 深底衬' % (rl, tl))
        return 'white', 'black@0.45', True
    if (rl >= 110 and tl >= 190) or (_low and rl >= 128):
        _tag = (str((th or {}).get('id') or ''), 'bright')
        if _tag not in _MAT_TEXT_LOG:
            _MAT_TEXT_LOG.add(_tag)
            print('[VF] ★VF_TEXTCONTRAST_V1 落点偏亮(%.0f)/字色偏亮(%.0f) → 大字改暗色 + 浅底衬' % (rl, tl))
        return '0x101418', 'white@0.66', True
    return txc, box, False


def big_fs(W, H, ratio=0.10, floor=44):
    """★VF_STYLE_V1（2026-09-30，④文字按实际画幅算）

    用户原话：「就是有一点它可能不知道分辨率多少，统一按竖屏分辨率配的字。这个也值得注意。」

    老做法：所有卡型都是 `int(H * ratio)` —— 竖屏 720×1280 出来 128px 很合适，
    但横屏 1280×720 同样系数只给 72px，字在宽画幅里"缩在中间"，观感就是"按竖屏配的字"。
    现在按取向分档：横屏（宽高比 ≥1.2）系数 ×1.40，竖屏/方形沿用原系数
    （8 套老主题在竖屏上的观感**完全不变**，只把横屏补回来）。"""
    _k = 1.40 if (W / float(H or 1)) >= 1.2 else 1.0
    return max(int(floor), int(H * float(ratio) * _k))


def _is_editorial(th):
    """这套主题是不是【编辑风】（news / data）—— 决定 title/list/number/end 走不走新卡面设计"""
    return str((th or {}).get('id') or '').strip().lower() in EDITORIAL_THEMES


def _track(s):
    """英文副标：全大写 + 超宽字距。
    FFmpeg 的 drawtext 没有 letter-spacing，用"逐字插空格"实现（用户要的就是
    `NORTH KOREA DEPLOYMENT CRISIS` 那种全大写、拉开字距的观感）。"""
    t = str(s or '').strip().upper()
    return ' '.join(t) if t else ''


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


def stage_layer(th, W, H, dur, accent_bar=True, grad_speed=None):
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
    # ★VF_SUSTAIN_V2（2026-10-01）：允许调用方指定渐变**流动速度**（纯文字卡要更快：见 FLOAT_GRAD_SPEED）。
    #   不给（None）→ 仍走 `_grad_speed()` 的生产默认 0.015 → 其它调用方（素材卡）**一个字节都不变**。
    # ⚠️ 测试钩子 `VF_GRAD_SPEED` 必须**优先于**调用方的加速值：否则纯文字卡（会传 FLOAT_GRAD_SPEED）
    #   就冻不住了 → 跨渲染的像素断言会时红时绿（test-deck-styles2 / test-ppt-preview 都靠它）。
    _spd = (os.environ.get('VF_GRAD_SPEED') or '').strip() or (grad_speed or '') or _grad_speed()
    if _has_gradients(_ff):
        inp = ['-f', 'lavfi', '-i',
               'gradients=s=%dx%d:c0=%s:c1=%s:d=%s:speed=%s'
               % (W, H, c0, c1, max(1.0, float(dur)), _spd)]
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


def _reveal_seq(shot, font, fs, txc, dur, text=None, box=None, y_off=0, x_off=0, W=0, H=0):
    """★VF_SYNC_V1（2026-09-20，C3 配音卡点）：画面大字【逐字浮现】。

    镜头时长 = 该镜配音真实时长（tts.py 回填），所以在镜头前段逐字亮出 = 跟着配音走。
    做法：对每个前缀（第 1 字、前 2 字…）各画一次 drawtext，各自只在 [t_i, t_{i+1}) 窗口
    enable —— 因为前缀是嵌套的，看起来就是从左向右逐字浮现；且每个都用
    x=(w-text_w)/2 居中，不需测量字宽（这是不用 ASS 覆盖层的原因）。

    `text`：显式指定要浮现的文字（不给就取 shot['text']）—— title 卡用它传兜底文字。
    `box`：给文字加一圈半透明底衬（形如 'black@0.30'），压在照片上时更清楚、也更像"设计过"。
    ★VF_TPL_LAND_V1（2026-09-30）：`x_off` = 把整块文字挪到【右侧大字区】（同 center_lines_drawtext
      的做法：块心 +x_off/2）。缺省 0 → 表达式逐字不变（老调用方零回归）。
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
    # ★VF_TPL_LAND_V1：x_off>0 → 整块文字移到右侧大字区（w == W，故 +x_off/2 即块心右移）
    _dx = int(x_off) // 2
    _x = 'x=(w-text_w)/2' if not _dx else f'x=(w-text_w)/2+{_dx}'
    # ★VF_NOBLACKBOX_V1（2026-10-01 用户点名「前面很多大字下面都有一个透明黑框」）：
    #   老做法 = drawtext 的 `box=1:boxcolor=black@0.30:boxborderw=…` → 一个**四周等 alpha 的实心
    #   半透明黑框**（用户最反感的那条）。新做法 = **底部渐隐蒙版**（_text_scrim_filters）+
    #   加粗描边 + 阴影；字照样清楚，但画面上再没有"方框"。
    #   `VF_TEXTBOX_LEGACY=1` 只为**对照帧**保留老写法（生产链路不设这个环境变量 → 老行为不回流）。
    _legacy_box = bool(os.environ.get('VF_TEXTBOX_LEGACY'))
    _bx = ''
    _scrim = []
    if box:
        if _legacy_box:
            _bx = f"box=1:boxcolor={box}:boxborderw={max(12, int(fs * 0.24))}:"
        elif W and H:
            # drawbox 的 x/y/w/h **不支持表达式**（只 enable 逐帧）→ 蒙版位置必须在 Python 里算成像素：
            #   块心 = W/2 + x_off/2（与 drawtext 的 x=(w-text_w)/2+dx 同一几何）。
            _spad = max(14, int(fs * 0.26))
            _fw = int(est_text_w(_full, fs))
            _scrim = _text_scrim_filters(
                int(W) / 2.0 + _dx - _fw / 2.0 - _spad,
                int(H) / 2.0 + int(y_off) - int(fs * 0.78),
                _fw + 2 * _spad, int(fs * 1.56),
                box, steps=7, amax=_rgb_alpha(box)[1])
            print('[VF] ★VF_NOBLACKBOX_V1 大字底衬：实心黑框 → 底部渐隐蒙版（%d 段 alpha 渐增）'
                  % len(_scrim))
    _stroke = f"borderw={max(2, int(fs * 0.07))}:bordercolor=black@0.72:"
    out = list(_scrim)
    for i in range(1, nch + 1):
        st = t0 + step * (i - 1)
        en = dur if i == nch else (t0 + step * i)
        # 已亮的字 + 用表意空格补齐的"未亮的字"（占位保持整块宽度不变）
        _shown = _full[:i] + _pad * (nch - i)
        # ★VF_TEXTSTROKE_V1（2026-09-20）：画面大字是压在【素材照片】上的，底色不可控 ——
        #   加一圈深色描边，浅色主题 / 亮底素材也能看清
        #   （加"浅色纸感"主题后才发现：light 主题字色近黑，压在深色照片上会糊）
        # ★VF_NOBLACKBOX_V1：描边加粗一档 + 加右下阴影 —— 这是"去掉黑框后仍然看得清"的保证。
        out.append(
            f"drawtext=fontfile='{font}':text='{esc_text(_shown)}':fontsize={fs}:"
            f"fontcolor={txc}:{_stroke}shadowx=2:shadowy=3:shadowcolor=black@0.55:{_bx}"
            f"{_x}:y=(h-text_h)/2+{int(y_off)}:enable='between(t,{st:.2f},{en:.2f})'"
        )
    return out


# ══════════════════ ★VF_EDITBIGTEXT_V1（2026-09-30）编辑风「压在素材上的大字」 ══════════════════
# 用户原话（多次强调）：「我发的 5 张博主截图……【文字配色】和【每个都有渐进效果 分段插入】」
#   「我就是单独做的文字页都很空洞配色单一 不灵活」
#   「把「压在图片上的大字」也做成你给的那 5 张图那种（kicker 小标签 + 多色层级 + 数值排版）」
# 设计语言（照 5 张参考图）：① kicker 小标签条（强调色底 + ≤8 字）
#   ② 多色层级（kicker 底 / 主大字 / 数字 / 细分线 ≥3 层）③ 数值排版（大字含数字 → 数字更大 + 强调色，
#   单位小一号）④ 大字下方细分割线 ⑤ 入场仍"渐进/分段插入"（alpha 渐入 + enable 分段，不动 MOTIONS）。
# 只对编辑风主题（news/data）生效；老 8 套主题一个像素都不动（用户已习惯老观感）。
# kicker 缺省策略（★用户让我定，理由）：**绝不硬编** —— 把 title 再当 kicker 写一遍 = 同一句话上下两次、
#   观感廉价；编辑风的 kicker 语义是"栏目标签/来源/分类"，与标题不是一回事，硬编会误导。
#   → 缺 kicker 时改画一条【短强调条】顶上，保住编辑风签名又不造假。
_NUM_RE = re.compile(r'\d[\d,\.]*')


def _split_num_line(t):
    """把一行拆成 (前缀, 数字, 后缀)；没有数字返回 None。★VF_EDITBIGTEXT_V1
    例：'涨幅 1700%' → ('涨幅 ', '1700', '%')；'1700' → ('', '1700', '')。"""
    s = str(t or '')
    m = _NUM_RE.search(s)
    if not m:
        return None
    return s[:m.start()], m.group(0), s[m.end():]


def _editorial_bigtext(shot, th, W, H, dur, fs_max, txc, busy=False, x_off=0):
    """★VF_EDITBIGTEXT_V1：编辑风【压在素材上的大字】层。

    返回 (filters, band, fs)：
      · filters = 文字层（kicker 标签 + 主大字/数值排版 + 细分线 + 英文副标，各自错开入场）；
      · band    = busy（满字素材）时另铺的【全宽底衬带】滤镜串（不需要则 ''）；
      · fs      = 实际主字号；0 表示没画出（调用方回退老样式）。
    busy=True → 整块落【下三分之一】（与 VF_MATGUARD_V2 口径一致），远离素材自身文字，避免"字压字"。
    ★VF_TPL_LAND_V1（2026-09-30）：x_off>0 = 【左图右字】的右侧大字区 —— 大字块左边界右移、
      可用宽度按右侧剩余宽度重算（否则大字会横穿到左边的素材卡片上）。x_off=0 → 逐字不变。
    """
    txt = clean_big_text(shot.get('text'))
    if not txt:
        return [], '', 0
    font = font_bold(th)                       # 编辑风大标题用粗体（参考图那种"厚"的层级感）
    acc = th.get('accent', '0xff6b35')
    _kbg = th.get('kickerBg', acc)
    _kfg = th.get('kickerText', 'white')
    _linec = th.get('line', 'white@0.30')
    _subc = th.get('cardSub', txc)
    _enfont = esc_path(find_font(th.get('enFont', 'arial')))
    _kick = str(shot.get('kicker') or shot.get('tag') or shot.get('eyebrow') or '').strip()[:8]
    _en = str(shot.get('en') or shot.get('enTitle') or shot.get('enSub')
              or shot.get('sub_en') or '').strip()[:48]
    _lm = int(W * 0.07)                        # 编辑风左对齐：左留 7% 安全边（与 title 卡同口径）
    # ★VF_TPL_LAND_V1（2026-09-30）：左图右字 → 大字块左边界右移到 x_off、宽度按右侧剩余重算
    _mwr = 0.86
    if x_off:
        _lm += int(x_off)
        _mwr = max(0.30, (W - int(x_off) - int(W * 0.06)) / float(W))
    _lines, fs = fit_big_text(txt, W, H, fs_max=fs_max, max_lines=2, maxw_ratio=_mwr)
    if not _lines:
        return [], '', 0
    # 数值排版：仅【单行且含数字】时启用（多行时各段对不齐，反而不美）
    _num = _split_num_line(_lines[0]) if len(_lines) == 1 else None
    if _num:
        _pre, _dn, _suf = _num
        _fs_p, _fs_n = fs, int(fs * 1.30)
        _fs_s = max(18, int(fs * 0.60))
        # 数字放大后仍不许溢出安全宽（放不下就整体缩，宁可小一点也不出画）
        # ★VF_TPL_LAND_V1：数值排版的安全宽同样按"右侧大字区"算（x_off=0 时等价于老的 W*0.86）
        _wlim = int(W * 0.86) if not x_off else max(int(W * 0.30), _mwr * W)
        for _ in range(14):
            _tot = (est_text_w(_pre, _fs_p) + est_text_w(_dn, _fs_n) + est_text_w(_suf, _fs_s))
            if _tot <= _wlim or _fs_n <= 20:
                break
            _fs_n, _fs_p = int(_fs_n * 0.93), int(_fs_p * 0.93)
            _fs_s = max(16, int(_fs_s * 0.93))
        _main_h = int(_fs_n * 1.34)
    else:
        _main_h = int(fs * 1.34) * len(_lines)
    # ── 组件度量（自上而下：kicker/强调条 → 主行 → 细分线 → 英文副标）──
    _gapk = int(fs * 0.34)
    _kfs = max(20, int(fs * 0.30))
    _kpad = max(8, int(_kfs * 0.40))
    _kbar_h = _kfs + 2 * _kpad
    _abar_h = max(5, int(fs * 0.06))
    _top_h = (_kbar_h + _gapk) if _kick else (_abar_h + _gapk)
    _div_h = max(3, int(fs * 0.035))
    _div_gap = int(fs * 0.30)
    _efs = max(18, int(fs * 0.30)) if _en else 0
    _en_h = int(_efs * 1.9) if _en else 0
    _blk_h = _top_h + _main_h + _div_gap + _div_h + _en_h
    # ── 整块位置：busy(满字素材) 落到下三分之一；底部不许顶进底部字幕区（H*0.72）──
    _cy = int(H * (0.5 + (0.13 if busy else 0.0)))
    _blk_top = _cy - _blk_h // 2
    _blk_top = min(_blk_top, int(H * 0.70) - _blk_h)
    _blk_top = max(int(H * 0.06), _blk_top)
    # ★VF_EDITBIGTEXT_V1 补丁（2026-09-30 本机满字素材抽帧发现）：busy 会铺一条【深色底衬带】，
    #   而 _mat_text_colors 在"亮素材"上会把大字自动改成近黑 → 深色带 + 深色字 = 又看不见。
    #   修法：busy 分支若有自动改暗，统一改回主题【亮字/亮副标】（band 本身就是对比保证）。
    if busy and _lum_of(txc, 255) < 128:
        _bt = th.get('text') or 'white'
        txc = _bt if _lum_of(_bt, 255) >= 128 else 'white'
        _bs = th.get('sub') or ''
        if _bs and _lum_of(_bs, 255) >= 128:
            _subc = _bs
    out = []
    _y = _blk_top
    # ① kicker 小标签条（强调色底 + 文字，≤8 字）；缺 kicker → 短强调条顶上（见文件头策略）
    if _kick:
        _kbw = int(est_text_w(_kick, _kfs) + _kpad * 2)
        out.append(f"drawbox=x={_lm}:y={_y}:w={_kbw}:h={_kbar_h}:color={_kbg}@0.95:t=fill:"
                   f"enable='gte(t,0.10)'")
        out.append(
            f"drawtext=fontfile='{font}':text='{esc_text(_kick)}':fontsize={_kfs}:"
            f"fontcolor={_kfg}:x={_lm + _kpad}:y={_y + _kpad}:"
            f"alpha='min(max(t-0.10,0)/0.40,1)'")
    else:
        out.append(f"drawbox=x={_lm}:y={_y + max(0, (_top_h - _abar_h) // 2)}:w={int(W * 0.12)}:"
                   f"h={_abar_h}:color={acc}@0.95:t=fill:enable='gte(t,0.10)'")
    _y += _top_h
    # ② 主大字 / 数值排版（数字更大 + 强调色，单位小一号；各段错开入场 = 分段插入）
    if _num:
        _x = _lm
        _base = _y
        if _pre:
            out.append(
                f"drawtext=fontfile='{font}':text='{esc_text(_pre)}':fontsize={_fs_p}:"
                f"fontcolor={txc}:borderw={max(2, int(fs * 0.05))}:bordercolor=black@0.55:"
                f"x={_x}:y={_base + (_fs_n - _fs_p)}:alpha='min(max(t-0.35,0)/0.5,1)'")
            _x += est_text_w(_pre, _fs_p)
        out.append(
            f"drawtext=fontfile='{font}':text='{esc_text(_dn)}':fontsize={_fs_n}:"
            f"fontcolor={acc}:borderw={max(3, int(fs * 0.06))}:bordercolor=black@0.55:"
            f"x={_x}:y={_base}:alpha='min(max(t-0.55,0)/0.5,1)'")
        _x += est_text_w(_dn, _fs_n)
        if _suf:
            out.append(
                f"drawtext=fontfile='{font}':text='{esc_text(_suf)}':fontsize={_fs_s}:"
                f"fontcolor={acc}:borderw={max(2, int(fs * 0.05))}:bordercolor=black@0.55:"
                f"x={_x}:y={_base + (_fs_n - _fs_s)}:alpha='min(max(t-0.75,0)/0.5,1)'")
    else:
        # 折行后的多行：逐行画；行内**含数字仍拆出来用强调色**（保住"数值换色"这条，
        #   不至于因为折行就把数字的强调色丢掉）。左对齐 → 各段 x 依次右推，不用测整行宽。
        _gl = int(fs * 1.34)
        _stroke = f"borderw={max(2, int(fs * 0.05))}:bordercolor=black@0.55"
        for _i, _ln in enumerate(_lines):
            _a = f"alpha='min(max(t-{0.35 + 0.18 * _i:.2f},0)/0.5,1)'"
            _yy = _y + _i * _gl
            _sp = _split_num_line(_ln)
            if _sp and (str(_sp[0]).strip() or str(_sp[2]).strip()):
                _px, _dx, _sx = _sp
                _x = _lm
                if _px:
                    out.append(f"drawtext=fontfile='{font}':text='{esc_text(_px)}':fontsize={fs}:"
                               f"fontcolor={txc}:{_stroke}:x={_x}:y={_yy}:{_a}")
                    _x += est_text_w(_px, fs)
                out.append(f"drawtext=fontfile='{font}':text='{esc_text(_dx)}':fontsize={fs}:"
                           f"fontcolor={acc}:{_stroke}:x={_x}:y={_yy}:{_a}")
                _x += est_text_w(_dx, fs)
                if _sx:
                    out.append(f"drawtext=fontfile='{font}':text='{esc_text(_sx)}':fontsize={fs}:"
                               f"fontcolor={txc}:{_stroke}:x={_x}:y={_yy}:{_a}")
            else:
                out.append(
                    f"drawtext=fontfile='{font}':text='{esc_text(_ln)}':fontsize={fs}:"
                    f"fontcolor={txc}:{_stroke}:x={_lm}:y={_yy}:{_a}")
    _y += _main_h
    # ③ 大字下方细分割线（克制；分段插入）
    _y += _div_gap
    out.append(f"drawbox=x={_lm}:y={_y}:w={int(W * 0.20)}:h={_div_h}:color={_linec}:t=fill:"
               f"enable='gte(t,1.05)'")
    _y += _div_h
    # ④ 英文副标（无衬线 + 超宽字距；★用户明确「英文用无衬线，别拿中文字体排英文」）
    if _en:
        _etrack = _track(_en)
        _elim = int(W * 0.86) if not x_off else max(int(W * 0.30), _mwr * W)   # ★VF_TPL_LAND_V1
        while _efs > 12 and est_text_w(_etrack, _efs) > _elim:
            _efs = int(_efs * 0.94)
        while _etrack and est_text_w(_etrack, _efs) > _elim:
            _etrack = _etrack[:-2]
        out.append(
            f"drawtext=fontfile='{_enfont}':text='{esc_text(_etrack)}':fontsize={_efs}:"
            f"fontcolor={_subc}:x={_lm}:y={_y + int(_efs * 0.55)}:"
            f"alpha='min(max(t-1.20,0)/0.5,1)'")
    # busy：全宽底衬带（把我们的字与素材自带文字在视觉上分开，同 VF_MATGUARD_V2）
    band = ''
    if busy:
        # ★VF_TPL_LAND_V1：左图右字时底衬带只铺【右侧大字区】（别把左边的素材卡片糊掉）
        _bx0, _bw = 0, W
        if x_off:
            _bx0 = max(0, int(x_off) - int(W * 0.03))
            _bw = min(W - _bx0, W - int(x_off) + int(W * 0.03))
        # ★VF_NOBLACKBOX_V1（2026-10-01 用户点名「很多大字下面都有一个透明黑框」）：
        #   老做法 = 一条 `black@0.62` 的**实心通栏黑带**（"膏药"感）→ 换成【上下渐隐的蒙版带】
        #   （'center' 模式：两边淡、中间实，alpha 峰值仍 0.62 保证"满字素材上字压不花"）。
        band = ','.join(_text_scrim_filters(
            _bx0, max(0, _blk_top - int(fs * 0.24)), _bw,
            int(_blk_h + int(fs * 0.48)), 'black@0.62', steps=9, amax=0.62, fade='center'))
    print('[VF] 编辑风图上大字（%s）：kicker%s + 多色层级%s + 细分线（入场=分段渐入）'
          % (th.get('id'), '有' if _kick else '缺(用强调条)',
             ' + 数值排版' if _num else ''))
    return out, band, fs


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
    # ★VF_DECK_V1（2026-10-01）「富编排 PPT 页」的**素材页**：
    #   横屏 + 竖/方素材 → 左图右文（复用 ★VF_TPL_LAND_V1 的 side）；其余（竖屏 / 横素材）→ 上图下文。
    #   素材交给 B 组卡片版式排成"排版好的卡片"，另一侧整块交给 deck_page_filters 编排。
    #   条件不足（老主题 plate_opts=None / 素材尺寸读不出）→ 老实回落下面老链路（绝不弄挂出片）。
    if deck_of(shot):
        _dpo = plate_opts(shot, th)
        _dsrc_ok = bool(str(src).strip()) and os.path.exists(str(src))
        if _dpo and _dsrc_ok:
            _dlay = 'side' if plate_side_layout(src, W, H, True) else 'top'
            _dpre = _plate_pre(src, W, H, shot, th, _dpo, dur=dur, layout=_dlay)
            if _dpre:
                if _dlay == 'side':
                    # 素材卡在左半区 → 右侧整块留给富编排内容（与 plate_text_x 同口径：0.52W 起）
                    _drx, _dry = int(W * 0.52), int(H * 0.10)
                    _drw, _drh = int(W * 0.42), int(H * 0.80)
                else:
                    # 上图下文：素材卡落上半（_plate_pre 的 top 口径），内容排在下半
                    _drx, _dry = int(W * 0.07), int(H * 0.60)
                    _drw, _drh = int(W * 0.86), int(H * 0.34)
                # ★VF_DECK_STYLES_V1（2026-10-01 本机抽帧实测「deck-mono + light 主题整页看不见字」）：
                #   素材页的富编排内容直接读主题的 text/sub/line 色 —— 浅色主题（字近黑）压在深色素材上
                #   会**整页看不见字**（老链路的"压在素材上的大字"早有 _mat_text_colors 兜底，这里没有）。
                #   修法：复用同款兜底 —— 素材与主题字色"反了"就整页翻转（字改亮/改暗），
                #   并让**同色系渐变两端一起压暗/提亮**（否则会出现"亮字压在亮卡片上"的二次问题）。
                _ph2 = th
                _chg = False
                try:
                    _matd = _probe_material(src)
                    _tc2, _bx2, _chg = _mat_text_colors(th, _matd, str(th.get('text') or 'white'),
                                                        'black@0.30')
                except Exception:
                    _tc2, _chg = str(th.get('text') or 'white'), False
                if _chg:
                    _ph2 = dict(th)
                    _light = _lum_of(_tc2, 255) >= 128
                    _gk = (0.22, 0.16) if _light else (1.60, 1.90)
                    _ph2['text'] = _tc2
                    _ph2['sub'] = _tc2
                    _ph2['cardText'] = _tc2
                    _ph2['cardSub'] = _tc2
                    _ph2['line'] = _tc2
                    _ph2['gradA'] = _shade(str(th.get('gradA') or th.get('bg2') or th.get('bg')), _gk[0])
                    _ph2['gradB'] = _shade(str(th.get('gradB') or th.get('bg')), _gk[1])
                    print('[VF] ★VF_DECK_STYLES_V1 素材页对比度兜底：主题字色与素材反差不足 → 整页翻转'
                          '（字=%s）' % _tc2)
                _dk = deck_page_filters(shot, _ph2, W, H, dur, region=(_drx, _dry, _drw, _drh))
                if _dk:
                    print('[VF] ★VF_DECK_V1 素材页：layout=%s → 内容区 %dx%d@%d,%d'
                          % (_dlay, _drw, _drh, _drx, _dry))
                    _dvf = _dpre + '[smooth]null,' + ','.join(
                        _dk + [f"trim=duration={dur},setpts=PTS-STARTPTS,format=yuv420p"])
                    return (f"-loop 1 -t {dur} -i \"{src}\"", _dvf, dur)
        print('[VF] ★VF_DECK_V1 素材页条件不足（卡片版式=%s / 素材可用=%s）→ 回落老链路'
              % ('有' if _dpo else '无', '是' if _dsrc_ok else '否'))
    font = esc_path(find_font(th.get('font', 'msyh')))
    fs = int(shot.get('fontsize', big_fs(W, H, 0.10, 54)))   # ★VF_STYLE_V1（④）：按画幅取向取字号
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
    # ★VF_MATGUARD_V3（2026-09-30 用户实测「只有第五条遮挡了」后，用他的素材实跑发现**漏判**）：
    #   实测两张真素材：拼贴海报 lum=149/flat=0.021/edge=0.179 → 判得出（edge 命中）；
    #   但**深色界面截图 lum=45/flat=0.319/edge=0.072** → 老门槛（flat>0.42 或 edge>0.10）**都够不到**
    #   → 被判成"普通素材"→ 照旧居中压大字 → 就成了用户截图里那张"黑底上字压字"（第 5 镜）。
    #   修法：**深色素材**单独放宽一条（深色 + 主色占比>0.22 或 边缘>0.055 就算"界面/截图"），
    #   并且把"又深又满字 → 换质感底板"的门槛从 flat>0.42 降到 >0.28（深色实拍照片通常 flat<0.10，
    #   不会被误判；只有"大片纯色底的界面/海报"才会过）。
    _busy = _graphic or (_edge > 0.10) or (_dark and (_flat > 0.22 or _edge > 0.055))
    _screen = _dark and _flat > 0.28       # 深色 + 大片纯色底 = 典型"深色界面截图/黑底海报"
    # ★VF_TPL_B1_V1（2026-09-30 B 组「图片处理」）：卡片版式一旦启用（编辑风缺省启用），
    #   本镜的图**不再"糊满屏"**，上面两条老判定要让位：
    #     · `_screen`（深色截图 → 干脆不用这张图、换质感底板）：**不再降级** ——
    #       图已经缩进卡片里了，不再当满屏背景，"黑底上字压字"的前提本身就没了；
    #       这正是用户要的"素材图也能当排版好的卡片"。
    #     · `_busy`（满字素材）**强制为真**：卡片占住上半，我们的大字一律让到【下三分之一 + 全宽底衬带】，
    #       与卡片互不纠缠（沿用 VF_MATGUARD_V2 那套已验证的让位写法）。
    #   老 8 套主题缺省 frame=none → _plate 为 None → 上面两条判定原样保留（一个像素都不动）。
    _plate = plate_opts(shot, th)
    # ★VF_TPL_LAND_V1（2026-09-30）：横屏 + 竖/方素材 + 本镜要叠大字 → 走【左图右字】。
    #   三条不同时满足 → _land=False → 后面一律走老的 layout='top'（一个像素都不动 = 零回归）。
    _land = False
    if _plate:
        _screen = False
        _land = bool(plate_side_layout(
            src, W, H, bool(str(shot.get('text') or '').strip()) and overlay_text_on()))
        # 左图右字时素材与大字**互不重叠** → 不套"满字素材"的让位/全宽底衬带（大字能吃满右侧）
        _busy = (not _land)
        if _land:
            print('[VF] ★VF_TPL_LAND_V1 横屏 + 竖/方素材 → 左图右字：%s'
                  % os.path.basename(str(src))[:24])
    if _screen:
        # 又深又满字 = 典型"深色界面截图" → 【不硬塞这张图】，改用主题质感底板 + 大字
        #（规划文档 P2「缺就承认缺」：宁可出一张设计过的文字卡，也不要一张看不清的截图）
        print('[VF] 素材不适合当背景（亮度 %d / 主色 %.2f / 边缘 %.2f）→ 本镜改用主题质感底板：%s'
              % (_lum, _flat, _edge, os.path.basename(str(src))[:24]))
        # ★VF_EDITBIGTEXT_V1（2026-09-30）：编辑风主题 → 质感底板上同样走"编辑风大字"（kicker/数值/细分线）
        if _is_editorial(th):
            _ed_rev, _ed_band, _ed_fs = _editorial_bigtext(shot, th, W, H, dur, fs, txc)
            _reveal = _ed_rev if (_ed_fs and overlay_text_on()) else []
        else:
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
    # ★VF_TPL_LAND_V1：左图右字时大字只能吃【右侧那半幅】→ 可用宽度按右侧重算（x_off=0 时逐字不变）
    _tx = plate_text_x(W, H, 'side' if _land else 'top')
    _mwr = 0.86 if not _tx else max(0.30, (W - _tx - int(W * 0.06)) / float(W))
    _lines, fs = fit_big_text(str(shot.get('text') or ''), W, H, fs_max=fs, max_lines=2,
                              maxw_ratio=_mwr)
    # ★VF_SYNC_V1（C3）：画面大字逐字浮现（跟配音卡点）；拿不到 text 就不加这些滤镜
    #   ★VF_CARDSTYLE_V1：压在照片上的大字加半透明底衬（与素材自带的字在视觉上分开）
    #   ★VF_MATGUARD_V1：素材字多 → 底衬更实（0.30→0.48），否则仍会被素材的字吃掉
    _boxc = 'black@0.48' if _busy else 'black@0.30'
    # ★VF_STYLE_V1（2026-09-30 ①【最高优先·治线上问题】文字对比度自适应）
    #   用户原话：「我选模版的问题字是黑灰色的，在图片上基本看不见」——主题的 text/box 是固定值，
    #   浅色主题（近黑字）压深色素材 = 看不见。这里用素材体检的亮度做兜底（只动大字与底衬）。
    # ★VF_TEXTCONTRAST_V1：落点用"大字实际会去的带"。大字**始终在画面纵向中部附近**
    #   （非满字居中；满字时 _yoff=+0.13H 也仍落在中间 1/3 内）→ 一律取中间 1/3（lum_mid）。
    #   （真渲踩过：用 lum_low 会把"半亮半暗、落点在中间暗带"的材料判反。）
    _rlum = _mat.get('lum_mid')
    txc, _boxc, _lowc = _mat_text_colors(th, _mat, txc, _boxc, region_lum=_rlum)
    # ★VF_MATGUARD_V2（2026-09-29 P1「更聪明的素材避让」）——**踩过一次，改成可靠方案**：
    #   第一版做法：量素材上/中/下三条哪条最"空"，把大字挪过去。
    #   实测失败（亮色满字海报）：band 是在**素材原图**上量的，而画布上是"模糊铺底 + 等比缩放居中"，
    #   位置对不上 → 判成"上部最空"，偏偏海报的大字也在上部 → 还是压字。
    #   第二版（现在）：**不挪位置，改"让我们的字一眼看得出是我们加的"**——
    #   满字素材 → 大字固定放【下三分之一】（海报类素材文字多在中上），并加一条**全宽实底衬带**，
    #   像电视字幕条一样把我们的字与素材的字在视觉上彻底分开（比"猜哪儿空"稳得多）。
    _yoff = 0
    _band_box = ''
    _reveal = []
    if _is_editorial(th):
        # ★VF_EDITBIGTEXT_V1（2026-09-30）：编辑风图上大字 = kicker 小标签 + 多色层级 + 数值排版 + 细分线，
        #   入场仍是"渐进/分段插入"。只对 news/data 生效，老主题走下面的老分支（一个像素都不动）。
        # ★VF_TPL_LAND_V1：x_off=_tx（左图右字时大字块右移到右侧；_tx=0 时逐字不变）
        _ed_rev, _ed_band, _ed_fs = _editorial_bigtext(shot, th, W, H, dur, fs, txc,
                                                       busy=_busy, x_off=_tx)
        if _ed_fs and overlay_text_on():
            _reveal, _band_box = _ed_rev, _ed_band
            if _busy:
                print('[VF] 编辑风 + 满字素材 → 大字块落【下三分之一 + 全宽底衬带】')
            elif _land:
                print('[VF] ★VF_TPL_LAND_V1 编辑风大字 → 落【右侧大字区】（左图右字）')
    else:
        if _busy:
            _yoff = int(H * 0.13)
            _gap_b = int(fs * 1.34)
            _rows_b = max(1, len(_lines))
            _btop = int(H * 0.5 + _yoff - _gap_b * _rows_b * 0.5) - int(fs * 0.30)
            _bh = _gap_b * _rows_b + int(fs * 0.60)
            # ⚠️ 2026-09-30 线上事故（用户第 8 镜 bgimage 崩：「No such filter: ''」）：
            #   这里原来结尾多了一个逗号（`...,t=fill,`），而 _chain 又是 `','.join(...)` 拼的
            #   → 拼出来是 `...,drawbox=...:t=fill,,drawbox=...` → ffmpeg 把中间那个空串当成滤镜名
            #   → 「No such filter: ''」整镜失败。**逗号必须在 join 时统一加，元素自己不许带尾逗号。**
            # ★VF_NOBLACKBOX_V1：同 _editorial_bigtext —— 实心通栏黑带 → 上下渐隐的蒙版带
            _band_box = ','.join(_text_scrim_filters(0, max(0, _btop), W, int(_bh),
                                                    'black@0.62', steps=9, amax=0.62, fade='center'))
            print('[VF] 素材自带内容多 → 大字走【下三分之一 + 全宽底衬带】（避免与素材文字纠缠）')
        elif _lowc:
            # ★VF_TEXTCONTRAST_V1（2026-10-01）：落点低对比（灰字压暗底 / 白字压亮底）→ 加一条**渐隐底衬带**
            #   把字托出来。**绝不实心黑框**（老板明确讨厌）—— 走 _text_scrim_filters 的上下渐隐蒙版。
            #   字改亮（落点暗）→ 深底衬；字改暗（落点亮）→ 浅底衬。
            _sc = 'black@0.45' if _lum_of(txc, 255) >= 128 else 'white@0.55'
            _gap_b = int(fs * 1.34)
            _rows_b = max(1, len(_lines))
            _btop = int(H * 0.5 - _gap_b * _rows_b * 0.5) - int(fs * 0.30)
            _bh = _gap_b * _rows_b + int(fs * 0.60)
            _band_box = ','.join(_text_scrim_filters(0, max(0, _btop), W, int(_bh),
                                                     _sc, steps=9, amax=0.45, fade='center'))
            print('[VF] ★VF_TEXTCONTRAST_V1 落点低对比 → 大字加【渐隐底衬带】(%s)，绝不实心黑框' % _sc)
        _rev = _reveal_seq(shot, font, fs, txc, dur, text=_lines[0], box=_boxc, y_off=_yoff,
                           x_off=_tx, W=W, H=H) if len(_lines) <= 1 else []   # ★VF_TPL_LAND_V1：右侧大字区
        # ★OVERLAY_TEXT_SWITCH_V1：开关关闭 → 这一镜不叠大字（压暗与字幕照旧）
        _reveal = (_rev if _rev else
                   center_lines_drawtext(font, _lines, fs, txc, W, H, dur, y_off=_yoff, x_off=_tx)
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
    # ★VF_FILTERJOIN_V1（2026-09-30 线上事故防御）：拼滤镜前**统一丢掉空串与纯逗号**。
    #   事故根因见上面 _band_box 的注释（非满字素材时它是空串 + 曾经带尾逗号 → `,,` → 空滤镜）。
    #   加这一层"值不值得丢"的清洗，以后任何一处忘了判空都不会再让整条片崩掉。
    _chain = [x for x in _chain if str(x).strip().strip(',')]
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
    # ★VF_STYLE_V1（③底图清晰度）：本镜素材该"直接裁切铺满"还是"轻模糊铺底"（日志里会写明）
    # ★VF_TPL_B1_V1（2026-09-30 B 组）：卡片版式优先 —— 图缩进画框、背景虚化分层；
    #   拿不到素材分辨率（_probe_size 失败）时 _plate_pre 返回 None，老实回落老铺法（绝不弄挂出片）。
    _pre, _mode = None, None
    if _plate:
        # ★VF_TPL_LAND_V1（2026-09-30）：_land（横屏 + 竖/方素材 + 叠大字）→ layout='side'（左图右字）；
        #   否则沿用老的 layout='top'（一个像素都不动）。
        _pre = _plate_pre(src, W, H, shot, th, _plate, dur=dur,
                          layout=('side' if _land else 'top'))
    if not _pre:
        _pre, _mode = _bg_filters(src, W, H)
    # ★VF_TPL_B1_V1（2026-09-30）卡片版式下【必须旁路 zoompan】—— 这是一条非常隐蔽的坑，写在这里：
    #   zoompan 的 `d=N` 表示"输入的每个帧展开成 N 帧"，而后续 `trim=duration` 只保留最前面那一段
    #   → 整镜画面实际被**冻在 [smooth] 的输入第 0 帧**上。
    #   老链路里 [smooth] 之后没有任何"随时间变化"的东西（_chain 的文字动画在 zoompan **之后**），
    #   所以一直没暴露；但 B 组的【擦入】是画在 [smooth] **之前**的 → 一上 zoompan 就永远停在
    #   "一条都还没亮"（本机实测：bgimage 的卡片整镜不出现，只剩虚化底图）。
    #   卡片版式本身已有"极缓慢浮动"提供运动 → 这里直接旁路 zoompan，行为才是对的。
    if _plate:
        _zoomstage = '[smooth]null,'
    else:
        # ★VF_KENBURNS_V1（2026-09-20）：静图缓慢推近——只让画面“活”起来，不改时长
        # ★VF_MOTION_V2（2026-09-29）：改为按镜序轮换（推近 / 拉远 / 静止）
        _zoomstage = f"[smooth]zoompan={_z}:d={_frames}:s={W}x{H}:fps={fps},"
    vf = (
        # ★VF_STYLE_V1（2026-09-30 ③底图清晰度）：老代码一律 sigma=32 高斯模糊铺底（"底图有点模糊"）。
        #   现在交给 _bg_filters 三选一：接近画幅→直接裁切铺满（清晰）/ 填不满→轻模糊(sigma=16) / 太小→不放大。
        _pre + _zoomstage + ','.join(_chain)
    )
    return (f"-loop 1 -t {dur} -i \"{src}\"", vf, dur)


def card_end(shot, th, W, H, fps):
    """结尾卡：主标语 + 行动号召（CTA，做成"按钮"样式），带轻微上浮

    ★VF_BIGTEXT_FALLBACK_V1：主标语为空时用字幕首句兜底（否则结尾卡也是空白屏）。
    ★VF_CARDSTYLE_V1：CTA 从"一行橙字"改成【主题色实心按钮 + 深色字】，更像能点的入口。
    """
    font = font_bold(th)          # ★VF_FONTWEIGHT_V1：结尾主标语用粗体（收尾要有力）
    dur = float(shot.get('dur', 3.5))
    fs = int(shot.get('fontsize', big_fs(W, H, 0.11, 56)))   # ★VF_STYLE_V1：按画幅取向取字号
    acc, txc = th.get('accent', '0xff6b35'), th.get('text', 'white')
    _main = _big_text(shot)
    # ★VF_TEXTFIT_V2（2026-09-28）：折行优先（最多 2 行），放不下才缩字号
    _lines, fs = fit_big_text(_main, W, H, fs_max=fs, max_lines=2)
    # ★VF_VARIANT_V1（2026-09-29 P1「end 卡版式变体」）：center（默认）/ card（票根卡）
    _var = variant_of(shot, ('center', 'card'), 'center')
    # ══════════════ ★VF_STYLE_V1（2026-09-30 ②编辑风结尾卡：CTA 按钮 + 英文副标）══════════════
    if _is_editorial(th) and _var == 'center' and (_lines or _main):
        _efont = esc_path(find_font(th.get('enFont', 'arial')))
        _en = str(shot.get('en') or shot.get('enCta') or shot.get('enTitle') or '').strip()[:48]
        _cta = str(shot.get('cta') or '').strip()[:18]
        _cfs = max(22, int(fs * 0.44))
        _cpx = max(24, int(_cfs * 1.10))
        _cpy = max(12, int(_cfs * 0.50))
        _bh2 = _cfs + 2 * _cpy
        _cy2 = int(H * 0.5) + int(fs * 0.72)
        fp = [
            f"drawbox=x={int(W * 0.10)}:y={int(H * 0.18)}:w={int(W * 0.10)}:"
            f"h={max(6, int(H * 0.006))}:color={acc}@0.95:t=fill",
        ] + center_lines_drawtext(font, _lines or [_main], fs, txc, W, H, dur, y_off=-int(H * 0.08),
                                  breath=sustain_of(shot))
        if _cta:
            _cw2 = int(est_text_w(_cta, _cfs) + 2 * _cpx)
            _cx2 = max(int(W * 0.04), (W - _cw2) // 2)
            # "圆角做不了就用方角 + 细边线"：先垫一圈淡色 3px 边，再压实心按钮（零新依赖）
            fp.append(f"drawbox=x={_cx2 - 3}:y={_cy2 - 3}:w={_cw2 + 6}:h={_bh2 + 6}:"
                      f"color={acc}@0.35:t=fill")
            fp.append(f"drawbox=x={_cx2}:y={_cy2}:w={_cw2}:h={_bh2}:color={acc}@0.95:t=fill")
            fp.append(
                f"drawtext=fontfile='{font}':text='{esc_text(_cta)}':fontsize={_cfs}:"
                f"fontcolor=0x0a1620:x={_cx2 + _cpx}:y={_cy2 + _cpy}:"
                f"alpha='min(max(t-0.45,0)/0.5,1)'")
        if _en:
            _efs2 = max(18, int(fs * 0.30))
            _etrack2 = _track(_en)
            while _efs2 > 12 and est_text_w(_etrack2, _efs2) > W * 0.88:
                _efs2 = int(_efs2 * 0.94)     # 英文副标不许超出安全边距（与标题卡同口径）
            while _etrack2 and est_text_w(_etrack2, _efs2) > W * 0.88:
                _etrack2 = _etrack2[:-2]
            _ey = (_cy2 + _bh2 + int(H * 0.035)) if _cta else int(H * 0.72)
            fp.append(
                f"drawtext=fontfile='{_efont}':text='{esc_text(_etrack2)}':fontsize={_efs2}:"
                f"fontcolor={th.get('cardSub', txc)}:x=(w-text_w)/2:y={_ey}:"
                f"alpha='min(max(t-0.75,0)/0.5,1)'")
        print('[VF] 编辑风结尾卡（%s）：CTA 按钮%s' % (th.get('id'), ' + 英文副标' if _en else ''))
        return (f"-f lavfi -i color=c={th.get('bg', '0x0a1620')}:s={W}x{H}:d={dur}",
                ','.join([p for p in fp if str(p).strip()]), dur)
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
    # ★VF_MOTIONPPT_V1（2026-09-30）：motion='grow' → 结尾卡顶部强调条从左往右生长（opt-in）
    # ★VF_SUSTAIN_V1 A1（2026-10-01）：默认也长（慢生长，长镜 2~3 秒），不再只在 motion='grow' 时。
    if motion_of(shot) == 'grow' or sustain_of(shot):
        _egs = grow_secs(dur)
        _end_grow = grow_filters(int(W * 0.10), int(H * 0.20), int(W * 0.10),
                                 max(6, int(H * 0.006)), acc + '@0.95', dur,
                                 delay=0.12, grow=_egs, seg=max(6, int(_egs * 6)))
    else:
        _end_grow = []
    parts = (_end_grow or [
        f"drawbox=x={int(W * 0.10)}:y={int(H * 0.20)}:w={int(W * 0.10)}:h={max(6, int(H * 0.006))}:color={acc}@0.95:t=fill",
    ]) + center_lines_drawtext(font, _lines or [_main], fs, txc, W, H, dur, y_off=-30,
                               breath=sustain_of(shot))
    if shot.get('cta'):
        parts.append(f"drawtext=fontfile='{font}':text='{esc_text(shot['cta'])}':fontsize={int(fs * 0.5)}:"
                     f"fontcolor=0x0a1620:box=1:boxcolor={acc}@0.95:boxborderw={max(10, int(fs * 0.26))}:"
                     f"x=(w-text_w)/2:y=(h-text_h)/2+{int(fs * 0.9)}:alpha='min(max(t-0.6,0)/0.6,1)'")
    return (f"-f lavfi -i color=c={th.get('bg', '0x0a1620')}:s={W}x{H}:d={dur}",
            ','.join(parts), dur)


# ══════════════════ ★VF_DECK_V1（2026-10-01）「富编排 PPT 页」══════════════════
# 用户原话：「单独设计的PPT动效页 最好不要就几个大字，内容编排丰富一点可以吗？
#            就是做PPT也不可能一页就几个大字。你能单独根据我的素材 编辑 1、2 个动效 PPT
#            给我看下嘛，这样我能知道最顶能到什么效果」
# 旧观感：纯文字卡只有"大字 + 底线 + 字幕" → 一页就几个大字，"空"。
# 本版式（shot['variant'].startswith('deck')，共 4 套风格）一页里同时编排：
#   ① kicker 小标签条（强调色实底 + 文字）        ② 主标题（大字粗体 ≤2 行）+ 副标题（一行小字）
#   ③ 2~4 条要点：编号 01/02/03 + 小色块 + 文字    ④ 数据块：大数字 + 单位 + 说明（半透明卡面）
#   ⑤ 细分割线 + 装饰几何（小方块 / 数据块左侧强调条）  ⑥ 右下角页码 + 页内进度细线
# 动效（呼应 ★VF_SUSTAIN_V1）：
#   · 所有元素**分段入场**（kicker 0.10s → 标题 0.30s 起逐行 0.18s → 副标 → 分割线 → 要点每条 0.28s
#     → 数据块 → 页码），像 PPT 逐元素出现；
#   · 持续动效：kicker 下强调条**慢生长**（A1）/ 主标题与数据块**轻微呼吸**（A2）/
#     页内进度线**走完整页**（A4）。
# 零回归（硬约束）：只有 variant ∈ DECK_VARIANTS 才生效，其余（含白名单外自造值）一律返回 []
#   → 老分镜/老主题一个像素都不动。
# ⚠️ 2026-10-01 口径变更（★VF_DECK_STYLES_V1，用户「1-2 都要：既要接进 AI，也要多做模版」）：
#   这 4 个值**现在必须进 TITLE_VARIANTS**（AI 才写得出来），并且 src 侧同步进 VF_VARIANTS.title
#   —— 两边由 vf-i2v-selftest.ts / vf-deckwire-selftest.ts 逐项对账。原文"不放进 TITLE_VARIANTS"作废。
# ★VF_DECK_STYLES_V1（2026-10-01）：4 套富编排风格（用户原话「默认一套经典通用，然后先加几个不同风格」）。
#   deck      默认·经典通用（= 上一版 ★VF_DECK_V1，留白与层级打磨过）
#   deck-grad 渐变风（页面底板走真·逐像素渐变；卡片/标签条/装饰条用多段渐变色带）
#   deck-mono 极简留白（无卡片、无框；细线 + 大留白，靠排版与字号层级）
#   deck-mag  杂志/编辑风（左对齐、压边大标题、栏线/细分割/双线；配 news/data 主题最好看）
# ★VF_DECK_STYLES2_V1（2026-10-01 用户定案「配色真的不能太 AI 味」「最好有渐变色」「还有就是透明度」）：
#   deck-glass 玻璃拟态（半透明毛玻璃卡：低 alpha 染色底 + 细白 hairline + 顶部柔光高光；
#              背景一层主题同源的柔光渐变 wash，元素像悬浮玻璃片）
#   deck-soft  柔和拟物（Neumorphism 方向：同色系"左上亮 / 右下暗"双投影 + bevel，
#              卡面走"同色系半透明凸起"，颜色极低饱和，靠凹凸感分层、不靠亮色）
#   ⚠️ 这 6 个值 = **AI 白名单口径**，与 src/lib/agent/vf/anti-ai.ts 的 VF_VARIANTS.title
#      （以及本文件的 TITLE_VARIANTS）逐字一致 —— vf-i2v-selftest.ts / vf-deckwire-selftest.ts 都会对账。
#      ★新增 2 个值后，src 侧未同步前 vf-i2v-selftest.ts 会红 1 条（预期，由 src 侧队友同步）。
DECK_VARIANTS = ('deck', 'deck-grad', 'deck-mono', 'deck-mag', 'deck-glass', 'deck-soft')
# 渲染层内部沿用 `DECK_STYLE_VARIANTS` 这个名字（= 同一个元组，别名，不是第二份数据）
DECK_STYLE_VARIANTS = DECK_VARIANTS


def deck_style_of(shot):
    """这一镜属于哪套富编排风格；返回 '' = 不是（老分镜 / 白名单外的自造值 → 回老版式，零回归）。"""
    v = str((shot or {}).get('variant') or '').strip().lower()
    return v if v in DECK_STYLE_VARIANTS else ''


def deck_of(shot):
    """这一镜是不是「富编排 PPT 页」（6 套风格之一）。白名单外的值一律 False（回老版式）。"""
    return bool(deck_style_of(shot))


# ══════════════ ★VF_DECK_STYLE_V1（2026-10-01）【用户手动指定画面模版】══════════════
# 用户原话：「我本次选的是新闻资讯，因为我没看到新模版」→ 本轮让他能**手动指定**。
# 约定（与 src 侧逐字一致）：plan（storyboard JSON）**根级**字段 `deck_style`：
#   · 'auto'（默认）或缺失或非法值 → **逐字保持现状**（零回归：AI 在镜里写的 variant 说了算）；
#   · 6 个风格名之一 → 该片**所有 deck 页强制用它**（覆盖 AI 在镜里写的 variant）。
# 注意"deck 页"的判定 = 该镜 variant 已经 ∈ DECK_STYLE_VARIANTS（AI 已把它写成 deck 页）。
#   → 本字段**不会凭空把普通卡变成 deck 页**（那样风险太大），只统一"已经是 deck 页"的风格。
def deck_root_style(sb):
    """把 plan 根级 deck_style 归一化成风格名；'auto'/缺失/非法 → ''（= 不干预）。"""
    v = str((sb or {}).get('deck_style') or '').strip().lower()
    return v if v in DECK_STYLE_VARIANTS else ''


def apply_deck_style(sb):
    """★VF_DECK_STYLE_V1：把根级 deck_style 强制套到该片所有 deck 页（覆盖镜内 variant）。

    返回生效的风格名（'' = 未干预）。就地在 sb 的 shots 上改 variant（render_shot 会各自 copy）。
    日志一行：`[VF] ★VF_DECK_STYLE_V1 用户指定画面模版=deck-glass → 本片 deck 页统一用它`。"""
    st = deck_root_style(sb)
    if not st:
        return ''
    _n = 0
    for s in (sb.get('shots') or []):
        if isinstance(s, dict) and deck_style_of(s):
            if str(s.get('variant') or '').strip().lower() != st:
                s['variant'] = st
            _n += 1
    if _n:
        print('[VF] ★VF_DECK_STYLE_V1 用户指定画面模版=%s → 本片 deck 页统一用它（共 %d 镜）' % (st, _n))
    else:
        print('[VF] ★VF_DECK_STYLE_V1 用户指定画面模版=%s，但本片没有 deck 页（不影响普通卡）' % st)
    return st


# ══════════════ ★VF_STYLES_V1（2026-10-01）「成品风格」：把 10 主题 × 6 版式收成 5 套 ══════════════
# 老板原话：「目前模版有2套我是不是有点乱。能统一一下吗？」「你写的那个什么玻璃什么分类有点抽象」
#          「我做的几个目前配色都是蓝色，和你直接给我做的几个视频效果配色不太一样」。
# 定义表在 themes.py 的 STYLES（唯一真相源）。这里只负责**把选中的风格落到分镜上**：
#   ① `theme`      → 整片主题色（默认 bluewhite = news = 老板现在的蓝，逐像素不变）
#   ② `deck_style` → 画面模版（deck 版式）
#   ③ 动效节奏     → 纯文字卡的入场方式 enter + 横向浮动周期 _float_per
# 并且**顺手修掉老板实测的"选了画面模版却一条片都没生效"**：
#   根因是渲染侧旧规则"只覆盖**已经是 deck 的镜**"，可服务端送来的分镜里那些镜的 variant 是 null
#   → 没有任何镜可覆盖 → 模版白选。所以这里在**明确选了成品风格**时，把该片的纯文字卡
#   **提升**成这套风格的 deck 版式（仍在白名单内，不新增 variant 名）。
#   ⚠️ 只在传了 style 时才这么做；老的 `deck_style` 路径（apply_deck_style）**保持原样** → 老片子零回归。
def apply_style(sb, name=''):
    """把成品风格落到分镜上（就地修改 sb）。返回生效的 style id（'' = **未干预**）。

    ★VF_STYLES_STRICT_V1（2026-10-01 style-wire 抓到的静默事故）：
      `style_of` 现在对**认不出**的名字返回 `None` → 这里**直接不干预**（theme/deck_style/variant 一个字段都不碰），
      并且**打一条明确日志**（绝不静默）。
      为什么必须这样：`vf-aivideo.ts` 把 AI 制片线的风格标签（`cinematic/commercial/vlog/…`）写进
      plan 根级 `style`；如果这里"认不出就回落默认"，那条线会被悄悄改成 news 蓝 + deck。
      换句话说：**只有真的命中 5 套成品风格（英文 id 或中文名）才动手。**
    """
    key = str(name or '').strip()
    if not key:
        return ''
    st = style_of(key)
    if not st:
        print('[VF] ★VF_STYLES_STRICT_V1 **忽略未知 style**=%r（不在 5 套成品风格里）→ 一个字段都不动'
              '（保留 theme=%r / deck_style=%r 原样；AI 制片线的风格标签 cinematic/commercial 走 '
              'make.py 的 ai_style，与本字段无关）'
              % (key, sb.get('theme'), sb.get('deck_style')))
        return ''
    sb['style'] = st['id']
    # ★VF_STYLES_V1：风格可以带**少量主题 token 覆盖**（例：柔和高级把 mono 的高饱和玫红换成低饱和灰玫瑰）。
    #   传字典时**必须带上 'theme' 键**：`theme_of()` 是拿它当基线再叠加覆盖的（见 themes.theme_of）。
    _tok = st.get('tokens') or {}
    sb['theme'] = dict(_tok, theme=st['theme']) if _tok else st['theme']
    sb['deck_style'] = st['deck']
    _per = float(st.get('period') or 4.0)
    _ent = str(st.get('enter') or 'up')
    _n = 0
    _mat_n = 0
    _mat_noop = 0
    for s in (sb.get('shots') or []):
        if not isinstance(s, dict):
            continue
        t = str(s.get('type') or 'title').strip().lower()
        # ★VF_DECK_FRAME_DEFAULT_V1（2026-10-01 team-lead）：**显式选了成品风格时**给"素材镜"补卡片版式缺省。
        #   为什么必须做：`plate_opts()` 的既有口径是"**只有编辑风主题（news/data）默认开卡片版式**"，
        #   light/journal/mono 缺省 → 素材镜回落老链路（整幅虚化素材 + 居中大字）→ 老板选了
        #   「清爽浅色/杂志编辑/柔和高级」后会看到"**纯文字页是新风格，但图片镜/视频镜还是老样子**"
        #   （素材镜通常占全片大多数）。
        #   为什么在这里补、而不是让上游手写：真实出片**没人会手写 frame**（样例是对照图才手写的）。
        #   三条边界（与 apply_style 的严格守卫一致）：
        #     ① 只有 apply_style 真生效（显式选了合法风格）才走这里 → 不选风格 = 零改动；
        #     ② 只补**缺失**的：显式写过 frame（含 `frame:'none'` 想关掉卡片版式）→ **一律不覆盖**；
        #     ③ 只补 frame（不顺手改 shadow/float/wipe）→ 其余按 `plate_opts()` 各主题自己的缺省走。
        #   ⚠️ 已知边界（本轮**如实上报**，不在这轮改）：`card_video` / `card_aivideo` 目前**不读**
        #   `frame`（它们走 `_bg_filters` 的"整幅素材 + 大字"链路，没有卡片版式）→ 这两个卡型上补
        #   该字段**暂不生效**（等把卡片版式接进视频卡型再说）。字段照写 = 前向兼容，并把条数单独打出来。
        if t in ('bgimage', 'image', 'video', 'aivideo'):
            if not str(s.get('frame') or '').strip():
                s['frame'] = 'thin'
                _mat_n += 1
                if t in ('video', 'aivideo'):
                    _mat_noop += 1
            continue
        if t not in ('title', 'list', 'number', 'compare', 'chart', 'end'):
            continue
        # 单镜显式写的 enter 优先（AI/用户有想法就听他的）
        if not str(s.get('enter') or '').strip():
            s['enter'] = _ent
        s['_float_per'] = _per          # 风格节奏优先（它就是"这一套看起来什么节奏"）
        # 纯文字卡提升成这套风格的 deck 版式（白名单内的值）——修"选了模版没生效"
        if t == 'title' and str(s.get('variant') or '').strip().lower() not in DECK_STYLE_VARIANTS:
            s['variant'] = st['deck']
            _n += 1
    print('[VF] ★VF_STYLES_V1 成品风格=%s（%s）：theme=%s / 画面模版=%s / 节奏(enter=%s,浮动%.1fs)'
          ' / 提升为 deck 版式的镜=%d'
          % (st['id'], st.get('name'), st['theme'], st['deck'], _ent, _per, _n))
    if _mat_n:
        print('[VF] ★VF_DECK_FRAME_DEFAULT_V1 素材镜补 frame=thin：%d 镜（其中 video/aivideo %d 镜'
              '——该卡型暂未接入卡片版式，字段先写上=前向兼容）' % (_mat_n, _mat_noop))
    print('[VF] ★VF_STYLES_V1 说明：%s' % (st.get('desc') or ''))
    return st['id']


def _deck_stats(shot):
    """★VF_DECK_V1：数据块条目 —— 兼容 stats=[{value,suffix,label}] / dict / number 卡的 value+suffix+label。"""
    out = []
    v = shot.get('stats') or shot.get('stat') or shot.get('data')
    if isinstance(v, (list, tuple)):
        for it in list(v)[:3]:
            if isinstance(it, dict):
                out.append((str(it.get('value', '')), str(it.get('suffix') or it.get('unit') or ''),
                            str(it.get('label') or it.get('desc') or it.get('title') or '')))
            else:
                out.append((str(it or ''), '', ''))
    elif isinstance(v, dict):
        out.append((str(v.get('value', '')), str(v.get('suffix') or v.get('unit') or ''),
                    str(v.get('label') or v.get('desc') or '')))
    if not out and shot.get('value') is not None:
        out.append((str(shot.get('value')), str(shot.get('suffix') or ''), str(shot.get('label') or '')))
    return [(a.strip()[:12], b.strip()[:4], c.strip()[:14])
            for a, b, c in out if str(a).strip() or str(c).strip()]


def deck_page_filters(shot, th, W, H, dur, font=None, region=None):
    """★VF_DECK_V1：富编排 PPT 页的**元素层**（不含底板 —— 底板仍由 render_shot 的 stage_layer 铺）。

    region=(x, y, w, h)：素材镜（横屏左图右文 / 竖屏上图下文）时**只在这块区域里排版**；
    不给 = 整幅排版（纯文字 deck 页）。
    返回 filter 片段 list；**非 deck 镜一律返回 []**（调用方据此保证"一个像素都不动"）。"""
    _style = deck_style_of(shot)
    if not _style:
        return []
    if _style != 'deck':
        # ★VF_DECK_STYLES_V1：另外三套风格走各自的元素层（同一套元素清单，换配色/透明度/留白/对齐）。
        return _deck_styled_filters(shot, th, W, H, dur, _style, font=font, region=region)
    _bold = font or font_bold(th)
    _reg = esc_path(find_font(th.get('font', 'msyh')))
    acc = str(th.get('accent') or '0xff6b35')
    dot = str(th.get('dot') or th.get('accent2') or acc)
    txc = str(th.get('text') or 'white')
    subc = str(th.get('sub') or txc)
    panel = str(th.get('cardBg') or 'black@0.46')
    pfg = str(th.get('cardText') or txc)
    psb = str(th.get('cardSub') or subc)
    kbg = str(th.get('kickerBg') or acc)
    kfg = str(th.get('kickerText') or 'white')
    linec = str(th.get('line') or 'white@0.30')
    _sus = sustain_of(shot)

    if region:
        rx, ry, rw, rh = [int(v) for v in region]
    else:
        rx, ry = int(W * 0.07), int(H * 0.075)
        rw, rh = int(W * 0.86), int(H * 0.845)
    rx = max(0, min(rx, max(0, W - 60)))
    rw = max(60, min(rw, W - rx - max(6, int(W * 0.02))))
    ry = max(0, min(ry, max(0, H - 60)))
    rh = max(60, min(rh, H - ry - max(6, int(H * 0.02))))

    main = _big_text(shot, limit=18) or clean_big_text(shot.get('title'))[:18] or 'PPT 内容页'
    kicker = str(shot.get('kicker') or shot.get('tag') or shot.get('eyebrow') or '').strip()[:14]
    subtitle = str(shot.get('sub') or shot.get('desc') or shot.get('subtitle_en') or '').strip()[:28]
    items = _norm_items(shot)[:4]
    stats = _deck_stats(shot)
    page = str(shot.get('page') or shot.get('pageno') or shot.get('pageNo') or '').strip()[:12]
    _plh = max(2, int(H * 0.0042))            # 页内进度线高度

    # ── 自适应排版：先按区域大小取基准字号，一档档往下缩，直到总高装得进区域 ──
    _M = {}
    _tfs = max(22, int(min(rw * 0.105, rh * 0.185)))
    for _ in range(10):
        _lines, _t2 = fit_big_text(main, W, H, fs_max=_tfs, max_lines=2,
                                   maxw_ratio=max(0.30, rw / float(W)),
                                   fs_min=max(18, int(_tfs * 0.62)), one_line_max=9)
        _tfs = _t2
        _M = {
            'lines': _lines,
            'kfs': max(15, int(_tfs * 0.38)),
            'sfs': max(13, int(_tfs * 0.34)),
            'ifz': max(14, int(_tfs * 0.42)),
            'nfz': max(16, int(_tfs * 0.50)),
            'vfz': max(24, int(_tfs * 0.86)),
            'lfz': max(12, int(_tfs * 0.30)),
            'pfs': max(12, int(_tfs * 0.28)),
        }
        _M['kpad'] = max(6, int(_M['kfs'] * 0.42))
        _M['kbar'] = (_M['kfs'] + 2 * _M['kpad']) if kicker else 0
        _M['g1'] = int(_tfs * 0.32) if kicker else 0
        _M['tg'] = int(_tfs * 1.30)
        _M['th'] = _M['tg'] * max(1, len(_lines))
        _M['sh'] = int(_M['sfs'] * 1.9) if subtitle else 0
        _M['dvh'] = max(2, int(_tfs * 0.035))
        _M['dvg'] = int(_tfs * 0.32)
        # ★VF_DECK_SPAN_V2：行距放大 + 高度下限 9.2%H —— 卡面要够大才"看得出在动"
        #   （0.5s 分箱是**均值**：一次性出现会被 12.5 帧摊薄；本机实测 ~47px 高的卡面 → 分箱只到 0.77）
        _M['rhit'] = max(int(_M['ifz'] * 1.55), int(_M['nfz'] * 1.28), int(H * 0.092))
        _M['ih'] = _M['rhit'] * len(items)
        _M['sh2'] = (int(_M['vfz'] * 1.24) + int(_M['lfz'] * 1.9)) if stats else 0
        _M['g2'] = int(_tfs * 0.30) if stats else 0
        _M['ph'] = (max(12, int(_tfs * 0.30)) + _plh) if page else 0
        _M['tot'] = (_M['kbar'] + _M['g1'] + _M['th'] + _M['sh'] + 2 * _M['dvg'] + _M['dvh']
                     + _M['ih'] + _M['g2'] + _M['sh2'] + _M['ph'])
        if _M['tot'] <= rh or _tfs <= 20:
            break
        _tfs = max(18, int(_tfs * 0.92))

    _kfs, _sfs, _ifz, _nfz = _M['kfs'], _M['sfs'], _M['ifz'], _M['nfz']
    _vfz, _lfz, _pfs = _M['vfz'], _M['lfz'], _M['pfs']
    _kbar, _kpad, _g1, _tg, _th = _M['kbar'], _M['kpad'], _M['g1'], _M['tg'], _M['th']
    _sh, _dvh, _dvg, _rhit, _ih = _M['sh'], _M['dvh'], _M['dvg'], _M['rhit'], _M['ih']
    _sh2, _g2, _ph, _tot, _lines = _M['sh2'], _M['g2'], _M['ph'], _M['tot'], _M['lines']

    out = []
    _y = ry + max(0, int((rh - _tot) * 0.5))          # 有富余就整块在区域里居中
    _x = rx
    _br = ('*' + breath_alpha(dur)) if _sus else ''   # A2 呼吸（乘在 alpha 上）

    # ★VF_DECK_SPAN_V2（2026-10-01 team-lead 验收口径）——**把入场铺满整段**。
    #   为什么：原来 01/02/03 + 数据卡全挤在 t=0.85~1.8s，8s 的页从 2s 到 8s 只剩呼吸项
    #   （逐帧 YAVG≈0.15~0.2，人眼看不出在动）→ 体检②的运动量时间轴 `#+.#...........#`，
    #   老板抱怨"不明显"。口径（团队定）：8s 页里 `#`(≥1.0) 至少 4 格、且
    #   0–2 / 2–4 / 4–6 / 6–8 各至少 1 格。做法 = 按镜长线性错峰（短镜按比例压缩，不跳变）：
    #     要点 i 的入场 = 0.45 + i × (镜长×0.72/要点数)；数据卡接在要点之后。
    #   8s/3 要点 → 要点 @0.45 / 2.37 / 4.29，数据卡 @6.41 → 四个 2s 窗各有一记"看得出"的事件。
    #   为什么还要给要点加**卡面**（下面 ⑤ 处）：单靠文字入场的逐帧 YAVG 只有 ~0.1~0.3，
    #   数学上到不了 1.0（0.5s 分箱是**均值**，一次性出现会被 12.5 帧摊薄 12.5 倍），
    #   而"与数据卡同主题的整条卡面"入场的量级 ≈ 数据卡（实测 2.16），才是"看得出在动"。
    _n_it = max(1, len(items or []))
    _span = max(1.2, float(dur) * 0.72)
    _it_gap = _span / _n_it
    _it_t0 = 0.45

    def _it_on(_k):
        return _it_t0 + _k * _it_gap

    _st_on_t = _it_t0 + _span + (0.35 if stats else 0.0)   # 数据卡接在要点之后

    # ① kicker 小标签条（缺 kicker → 用一条慢生长的强调条顶上，**不硬编 title**）
    if kicker:
        _kw = int(est_text_w(kicker, _kfs) + 2 * _kpad)
        out.append(f"drawbox=x={_x}:y={_y}:w={_kw}:h={_kbar}:color={kbg}@0.95:t=fill"
                   f":enable='gte(t,0.10)'")
        out.append(
            f"drawtext=fontfile='{_bold}':text='{esc_text(kicker)}':fontsize={_kfs}:"
            f"fontcolor={kfg}:x={_x + _kpad}:y={_y + _kpad}:"
            f"alpha='min(max(t-0.10,0)/0.35,1)'")
        _y += _kbar + _g1
    else:
        _bhh = max(5, int(_M['tg'] * 0.045))
        if _sus:
            _gs = grow_secs(dur)
            out += grow_filters(_x, _y, max(40, int(rw * 0.16)), _bhh, acc + '@0.95', dur,
                                delay=0.10, grow=_gs, seg=max(6, int(_gs * 6)))
        else:
            out.append(f"drawbox=x={_x}:y={_y}:w={max(40, int(rw * 0.16))}:h={_bhh}:"
                       f"color={acc}@0.95:t=fill")
        _y += _bhh + _g1

    # ② 主标题（逐行错开 + 呼吸）
    #   ★VF_DECK_STYLES2_V1 去 AI 味：黑描边从 0.55 降到 0.42（"刺眼黑边"变"托底描边"），
    #   并补一道极淡投影（字在亮/花素材上更稳，但不出现硬黑框）。
    for _i, _ln in enumerate(_lines):
        _t_on = 0.30 + 0.18 * _i
        out.append(
            f"drawtext=fontfile='{_bold}':text='{esc_text(_ln)}':fontsize={_tfs}:"
            f"fontcolor={txc}:borderw={max(2, int(_tfs * 0.038))}:bordercolor=black@0.42:"
            f"shadowx=1:shadowy=1:shadowcolor=black@0.30:"
            f"x={_x}:y={_y + _i * _tg}:alpha='min(max(t-{_t_on:.2f},0)/0.45,1){_br}'")
    _y += _th

    # ③ 副标题（一行小字）
    if subtitle:
        out.append(
            f"drawtext=fontfile='{_reg}':text='{esc_text(subtitle)}':fontsize={_sfs}:"
            f"fontcolor={subc}:x={_x}:y={_y + int(_sfs * 0.35)}:"
            f"alpha='min(max(t-0.55,0)/0.45,1)'")
        _y += _sh

    # ④ 细分割线 + 装饰小方块（克制几何）
    _y += _dvg
    _divw = int(rw * 0.30)
    out.append(f"drawbox=x={_x}:y={_y}:w={_divw}:h={_dvh}:color={linec}:t=fill"
               f":enable='gte(t,0.75)'")
    _sq = max(6, int(_dvh * 2.2))
    out.append(f"drawbox=x={_x + _divw + max(6, int(rw * 0.012))}:y={_y - max(0, (_sq - _dvh) // 2)}:"
               f"w={_sq}:h={_sq}:color={dot}@0.95:t=fill:enable='gte(t,0.85)'")
    _y += _dvh + _dvg

    # ⑤ 要点：编号 01/02 + 小色块 + 文字（★VF_DECK_SPAN_V2：按镜长**整段错峰**）
    # ★VF_DECK_LIGHTFACE_V1（2026-10-01 老板/team-lead）：「蓝白科技 那套尤其明显」的就是这里 ——
    #   原来每条要点直接铺 `panel`（= `cardBg` = white@0.93）→ 整页最亮的东西变成三条白杠，
    #   主标题反被压下去。现在改成【极淡主题染色面 + 1px 细边】，并且**字色按"面"重算**（过 |Δ|≥70，
    #   口径同 VF_DECK_CONTRAST_V1）—— 面变暗了以后 `cardText`（深色）就不能再直接用。
    _rowMat, _rowGloss = _deck_item_material('deck', th)
    _rowEdge = _deck_face_edge('deck', th)
    _rowBgL = float(_lum_of(str(th.get('bg') or '0x0a1620'), 160))
    _rowTx, _rowFL, _rowDD = _deck_on_face(_deck_eff_lum(_rowMat, _rowBgL))
    for _i, _it in enumerate(items):
        _t_on = _it_on(_i)
        _iy = _y + _i * _rhit
        #   这层"面"除了"编排更丰富"（老板原话要"不要就几个大字"），也负责把该 2s 窗的
        #   运动量抬到量级线 —— 面积/出现时刻**一个都没动**，只换了色（宽度不足时由
        #   ★VF_SUSTAIN_V2 的整块浮动 + 背景渐变流动补足，见 float_motion_filters / FLOAT_GRAD_SPEED）。
        if not region:
            _rh1 = max(_rhit - 6, int(H * 0.078))
            out.append(f"drawbox=x={_x}:y={_iy + 2}:w={rw}:h={_rh1}:"
                       f"color={_rowMat}:t=fill:enable='gte(t,{_t_on:.2f})'")
            out.append(f"drawbox=x={_x}:y={_iy + 2}:w={rw}:h=1:"
                       f"color={_rowEdge}:t=fill:enable='gte(t,{_t_on:.2f})'")
            out.append(f"drawbox=x={_x}:y={_iy + 2 + _rh1 - 1}:w={rw}:h=1:"
                       f"color={_rowEdge}:t=fill:enable='gte(t,{_t_on:.2f})'")
        _num = '%02d' % (_i + 1)
        out.append(
            f"drawtext=fontfile='{_bold}':text='{_num}':fontsize={_nfz}:fontcolor={acc}:"
            f"x={_x}:y={_iy + max(0, (_rhit - _nfz) // 2)}:"
            f"alpha='min(max(t-{_t_on:.2f},0)/0.35,1)'")
        _dx = _x + int(est_text_w(_num, _nfz)) + max(8, int(_nfz * 0.30))
        _sqb = max(6, int(_ifz * 0.32))
        out.append(f"drawbox=x={_dx}:y={_iy + max(0, (_rhit - _sqb) // 2)}:w={_sqb}:h={_sqb}:"
                   f"color={dot}@0.95:t=fill:enable='gte(t,{_t_on + 0.08:.2f})'")
        _tx = _dx + _sqb + max(8, int(_ifz * 0.34))
        out.append(
            f"drawtext=fontfile='{_reg}':text='{esc_text(_it)}':fontsize={_ifz}:"
            f"fontcolor={_rowTx}:x={_tx}:y={_iy + max(0, (_rhit - _ifz) // 2)}:"
            f"alpha='min(max(t-{_t_on + 0.14:.2f},0)/0.40,1){_br}'")
    _y += _ih
    if region and items:
        # ★VF_DECK_SPAN_V3：**素材页只排右半幅**，单条卡面的面积只有半幅 → 2–4s 窗掉到 `+`
        #   （本机实测演示片 0.69）。这里改成"面板按要点**步进往下长**"：每步新增 rw×_segHB，
        #   足够 1.15e7；后面的步进会被数据卡最后盖住（数据卡 6.4s 才出现 → 在那之前都算可见）。
        _segHB = max(_rhit - 6, int(1.15e7 / max(1, rw) / 150))
        _segY0 = _y - _ih - 4
        for _i2 in range(min(3, len(items))):
            # ★VF_DECK_LIGHTFACE_V1：素材页的步进面板同样换成**极淡染色面**（不再是白杠）
            out.append(f"drawbox=x={_x}:y={_segY0 + _i2 * _segHB}:w={rw}:h={_segHB}:color={_rowMat}:t=fill"
                       f":enable='gte(t,{_it_on(_i2):.2f})'")

    # ⑥ 数据块：半透明卡面 + 左侧强调条 +（整数走 eif 滚动）大数字 + 单位 + 说明
    if stats:
        _y += _g2
        _st_on = _st_on_t          # ★VF_DECK_SPAN_V2：数据卡接在要点之后（8s 页 ≈6.4s）
        out.append(f"drawbox=x={_x}:y={_y}:w={rw}:h={_sh2}:color={panel}:t=fill"
                   f":enable='gte(t,{_st_on:.2f})'")
        # ★VF_DECK_STYLES2_V1 去 AI 味：卡面上沿补一条 hairline（用主题 lineC）——
        #   把"一整块平色"变成"有边界的卡面"，比加高光/发光更克制。
        _lcD = str(th.get('lineC') or ('white' if _lum_of(txc, 255) >= 128 else 'black'))
        out.append(f"drawbox=x={_x}:y={_y}:w={rw}:h=1:color={_force_alpha(_lcD, 0.22)}:t=fill"
                   f":enable='gte(t,{_st_on:.2f})'")
        out.append(f"drawbox=x={_x}:y={_y}:w={max(3, int(rw * 0.007))}:h={_sh2}:"
                   f"color={acc}@0.95:t=fill:enable='gte(t,{_st_on:.2f})'")
        _colw = rw / float(max(1, len(stats)))
        _ufs = max(13, int(_vfz * 0.46))
        for _j, (_jv, _js, _jl) in enumerate(stats):
            _cx = _x + int(_colw * _j)
            _jv = str(_jv)
            _plain = str(_jv) + str(_js)
            _vw = int(est_text_w(_plain, _vfz))
            _vx = _cx + max(6, int((_colw - _vw) / 2))
            _vy = _y + int(_sh2 * 0.16)
            _int_ok = bool(re.fullmatch(r'\d+', _jv or '')) and int(_jv or 0) >= 3
            if _int_ok:
                _iv = int(_jv)
                # ★VF_DECK_SPAN_V2：计数滚动 0.8~2.5s（团队口径②），且**必须在镜结束前滚完**——
                #   数据卡按新口径落在 6.4s，若还按老的固定时长，成片结束时数字还没跳到终值
                #   （"150万"永远显示不全）。所以按"离镜结束还剩多久"自适应，留 5% 余量。
                _roll = max(0.8, min(2.5, max(0.0, float(dur) - _st_on) * 0.75))
                _rate2 = _iv / max(_roll, 0.1)
                # ⚠️ 计数起点必须是**数据块入场那一刻**（t-_st_on），不能从 t=0 起算：
                #   否则卡面刚出现时数字已经跳到一半（本机抽帧实测 t=3.2 时本应 2 却显示 1）。
                out.append(
                    f"drawtext=fontfile='{_bold}':"
                    f"text='%{{eif\\:min(max(t-{_st_on:.2f}\\,0)*{_rate2:.1f}\\,{_iv})\\:d}}':"
                    f"fontsize={_vfz}:fontcolor={acc}:x={_vx}:y={_vy}:"
                    f"alpha='min(max(t-{_st_on + 0.10:.2f},0)/0.4,1){_br}'")
            else:
                out.append(
                    f"drawtext=fontfile='{_bold}':text='{esc_text(_jv)}':fontsize={_vfz}:"
                    f"fontcolor={acc}:x={_vx}:y={_vy}:"
                    f"alpha='min(max(t-{_st_on + 0.10:.2f},0)/0.4,1){_br}'")
            if _js:
                out.append(
                    f"drawtext=fontfile='{_bold}':text='{esc_text(_js)}':fontsize={_ufs}:"
                    f"fontcolor={acc}@0.85:"
                    f"x={_vx + int(est_text_w(_jv, _vfz)) + max(2, int(_vfz * 0.08))}:"
                    f"y={_vy + int(_vfz * 0.72) - int(_ufs * 0.72)}:"
                    f"alpha='min(max(t-{_st_on + 0.22:.2f},0)/0.4,1)'")
            if _jl:
                out.append(
                    f"drawtext=fontfile='{_reg}':text='{esc_text(_jl)}':fontsize={_lfz}:"
                    f"fontcolor={psb}:x={_cx + max(6, int((_colw - int(est_text_w(_jl, _lfz))) / 2))}:"
                    f"y={_y + int(_sh2 * 0.60)}:alpha='min(max(t-{_st_on + 0.30:.2f},0)/0.4,1)'")
        _y += _sh2

    # ⑦ 右下角页码 + 页内进度细线（常驻动效：线走完这一页）
    if page:
        _pwy = ry + rh - _plh - int(_pfs * 1.5)
        # ★VF_PAGENUM_CONTRAST_V1（2026-10-01 team-lead）：页码加 1px 投影 ——
        #   素材页/浅色材质面上"细字直接压在图上"读不清（深色给黑投影、浅色给白投影）。
        _pcf = linec if '@' in linec else linec + '@0.85'
        out.append(
            f"drawtext=fontfile='{_reg}':text='{esc_text(page)}':fontsize={_pfs}:"
            f"fontcolor={_pcf}:shadowcolor="
            f"{'black@0.45' if _lum_of(_pcf, 255) >= 128 else 'white@0.35'}:shadowx=1:shadowy=1:"
            f"x={rx + rw - int(est_text_w(page, _pfs))}:y={_pwy}:"
            f"alpha='min(max(t-0.90,0)/0.45,1)'")
    # 纯文字 deck 页（region 未给）**不重复**画页内进度线 —— render_shot 已经给全部纯文字卡
    #   加了一条走完整镜的 A4 进度线；只有"素材 deck 页"（走 bgimage 通道，拿不到那条）才在这里补。
    if region:
        out += progress_filters(W, H, dur, acc + '@0.80', seg=max(6, int(min(20, dur * 3))),
                                y=ry + rh - _plh, h=_plh, x0=rx, w=rw)
    # 装饰几何（克制）：版面左上角一根极短强调竖发丝，收住整块排版的边界
    out.append(f"drawbox=x={rx}:y={ry}:w={max(2, int(rw * 0.004))}:h={max(10, int(rh * 0.16))}:"
               f"color={acc}@0.55:t=fill")
    print('[VF] ★VF_DECK_V1 版面：kicker=%s 标题%d行 要点%d条 数据%d块 页码=%s（区域 %dx%d@%d,%d）'
          % ('有' if kicker else '无', len(_lines), len(items), len(stats), page or '无',
             rw, rh, rx, ry))
    return [p for p in out if str(p).strip()]


# ══════════════════ ★VF_DECK_STYLES_V1/V2（2026-10-01）6 套富编排风格：共用工具 + 实现 ══════
# 用户原话：「1-2 都要（既要接进 AI，也要多做模版）。默认一套经典通用，然后先加几个不同风格。
#            注意配合配色真的不能太 AI 味。最好有渐变色。还有就是透明度。
#            前面很多大字下面都有一个透明黑框（=不喜欢那个实心半透明黑框）。」
#            「配色版式 就这1种吗？」「是否能按传统的5个网页UI风格设计。配色更讲究一些」
# ★VF_DECK_STYLES2_V1 再加 2 套：deck-glass（玻璃拟态）/ deck-soft（柔和拟物）→ 合计 6 套。
# 硬规矩（"去 AI 味"的具体落地，改本段前先读）：
#   ① 颜色**一律从主题 token 取**（accent / text / sub / cardBg / cardBg2 / line / lineC /
#      dot / shadowC / gradA / gradB）——绝不新造高饱和色，也就不可能再出现
#      "高饱和紫蓝渐变 + 俗套科技蓝发光板"那套 AI 味；
#   ② **面积克制**：强调色只出现在 kicker / 数字 / 色点 / 细线（**面积要小**）；
#      其余一律走中性灰阶（由 text/sub 的 alpha 梯度派生 4 档：0.86 / 0.55 / 0.30 / 0.14）；
#   ③ **透明度写死并注明理由**（每个数字旁都有注释）——"用透明度做设计"而不是"用颜色刷面积"；
#   ④ **层级靠"字号 / 颜色 / 字距"三处一起拉开**（大标题 vs 副标 vs 要点），留白别省；
#   ⑤ 禁止：居中通栏黑条 / 纯黑底配纯白字（刺眼）/ 高饱和紫蓝渐变 / 发光板。


def _rgb_alpha(c, default=((0, 0, 0), 1.0)):
    """把 'white' / 'black@0.3' / '0xRRGGBB' / '0xRRGGBB@0.42' 解析成 ((r,g,b), alpha)。
    解析不出来就回 default —— 颜色写错绝不许把出片弄挂（口径同 variant_of / enter_of）。"""
    try:
        s = str(c or '').strip()
        a = 1.0
        if '@' in s:
            s, _a = s.split('@', 1)
            a = max(0.0, min(1.0, float(_a)))
        s = s.strip().lower()
        s = {'white': '0xffffff', 'black': '0x000000'}.get(s, s)
        h = s.replace('0x', '').replace('#', '')
        if len(h) == 3:
            h = ''.join(ch * 2 for ch in h)
        return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)), a
    except Exception:
        return default[0], default[1]


def _css(c, a):
    """把 ((r,g,b), alpha) 写成 ffmpeg 颜色串 '0xRRGGBB@0.NNN'。"""
    return '0x%02x%02x%02x@%.3f' % (c[0], c[1], c[2], max(0.0, min(1.0, float(a))))


def _force_alpha(c, a):
    """★透明度唯一入口：**丢掉原色自带的 alpha**，换成我们要的 a（理由写在各调用点）。

    为什么要强制：主题 line token 可能是 '0x2f7cf6@0.55'，直接拿它画分割线会太实（>0.4），
    而本轮的规矩是"分割线 0.14~0.20 只做暗示" —— 所以这里统一改 alpha，不靠主题自觉。"""
    return _css(_rgb_alpha(c)[0], a)


def grad_box_filters(x, y, w, h, c0, c1, steps=24, a0=None, a1=None, vertical=True, enable=None):
    """★VF_DECK_STYLES_V1「真渐变色带」：用 N 段 drawbox 拼出**单调过渡**的渐变块。

    为什么不直接用 lavfi `gradients`：它是**独立输入源**，只能铺"整幅底板"，铺不了"卡片/标签条"；
    为什么不用 geq 逐像素：全帧 geq 在 720p/1080p 上明显变慢，且本项目踩过 `geq=a=` 的写法坑。
    N=24 段时每段约 h/24 像素 —— 同一帧上下两点的颜色值不同且单调（自测里有断言），肉眼即连续渐变。
    a0/a1：渐变两端的透明度（不给 = 用 c0/c1 自带的 alpha）。enable：整块按时间点插入（分段入场）。
    返回 filter 片段 list。"""
    steps = max(3, int(steps))
    (r0, g0, b0), da0 = _rgb_alpha(c0)
    (r1, g1, b1), da1 = _rgb_alpha(c1)
    A0 = da0 if a0 is None else float(a0)
    A1 = da1 if a1 is None else float(a1)
    _en = (":enable='gte(t,%.2f)'" % float(enable)) if enable is not None else ''
    out = []
    for i in range(steps):
        k0 = i / float(steps)
        k1 = (i + 1) / float(steps)
        mid = (k0 + k1) / 2.0
        _c = (int(r0 + (r1 - r0) * mid), int(g0 + (g1 - g0) * mid), int(b0 + (b1 - b0) * mid))
        _a = A0 + (A1 - A0) * mid
        if vertical:
            _x, _y = int(x), int(y) + int(h * k0)
            _w, _hh = int(w), max(2, int(h * k1) - int(h * k0) + 1)
        else:
            _x, _y = int(x) + int(w * k0), int(y)
            _w, _hh = max(2, int(w * k1) - int(w * k0) + 1), int(h)
        out.append('drawbox=x=%d:y=%d:w=%d:h=%d:color=%s:t=fill%s'
                   % (_x, _y, _w, _hh, _css(_c, _a), _en))
    return out


def _text_scrim_filters(x, y, w, h, color, steps=7, amax=None, fade='down'):
    """★VF_NOBLACKBOX_V1（2026-10-01 用户点名）「前面很多大字下面都有一个透明黑框」的替代方案。

    老做法：`drawtext` 的 `box=1:boxcolor=black@0.30:boxborderw=...` → 一个**四周等 alpha 的实心
      半透明黑框**（观感 = 贴了块膏药，正是用户最反感的那条）。
    新做法（本函数）：**底部渐隐蒙版** —— N 段 drawbox 做"上透明 → 下压暗"的连续淡出，只覆盖文字块
      那一带（不是通栏）；下端把字托住、上端几乎全透（不遮素材）。配合 drawtext 自身的描边
      （borderw）与阴影（shadowx/y）→ 字在任何素材上都清楚，但画面上再也看不到一个"方框"。
    透明度（写死 + 理由）：
      · amax 默认 = 传入底衬色自带的 alpha（主题给的 0.30 / 0.48）；夹在 0.10~0.72：
        低于 0.10 托不住白字，高于 0.72 就是"黑条"（用户不要的那条）。
      · 逐段 alpha 走平方曲线（k²）→ 上端更淡、下端更实，像"渐隐"而不是"渐变块"。
      · 每段最低留 0.015，避免整段被 ffmpeg 当成透明而出现"断带"。
    返回 filter 片段 list（**必须排在文字之前** —— 蒙版在字下层）。"""
    (r, g, b), da = _rgb_alpha(color)
    if amax is None:
        amax = da
    amax = max(0.10, min(0.72, float(amax)))
    steps = max(3, int(steps))
    _h = max(steps, int(h))
    bh = max(2, int(_h / steps))
    out = []
    for i in range(steps):
        k = (i + 1) / float(steps)
        if fade == 'down':
            _a = amax * k * k
            _yy = int(y) + i * bh
        elif fade == 'up':
            _a = amax * (1.0 - k) * (1.0 - k)
            _yy = int(y) + (_h - (i + 1) * bh)
        else:
            # 'center'：两边淡、中间实 —— 给"底衬带"用（托住大字，又不出现上下两条硬边）
            _a = amax * (1.0 - abs(2.0 * (i + 0.5) / steps - 1.0))
            _yy = int(y) + i * bh
        out.append('drawbox=x=%d:y=%d:w=%d:h=%d:color=%s:t=fill'
                   % (int(x), max(0, _yy), int(w), bh + 1, _css((r, g, b), max(0.015, _a))))
    return out


def deck_base_input(shot, th, W, H, dur):
    """★VF_DECK_STYLES_V1：deck 页的**底板输入**（card_title 用）。

    · deck-grad  → 真·逐像素渐变（lavfi `gradients`；不可用则退回主题底色）
      —— 所以"渐变风"的渐变是真的逐像素，不是两块纯色叠。
    · deck-glass → 同走真·逐像素渐变（★VF_DECK_STYLES2_V1）：用户要的"背景一层**柔光渐变**"，
      两端色仍取主题同源的 gradA（亮）/ gradB（暗）—— 低饱和、不是高饱和紫蓝；
      玻璃卡的"半透明"再叠在柔光渐变之上，元素才像悬浮玻璃片。
    · 其余 4 套（deck / deck-mono / deck-mag / deck-soft）→ 与老版**逐字相同**的 color= 输入
      （之后交给 render_shot 的 stage_layer 铺主题质感底，零回归：老分镜/老主题一个像素都不动）。
    """
    _style = deck_style_of(shot)
    _c0 = str(th.get('gradA') or th.get('bg2') or th.get('bg') or '0x0a1620')
    _c1 = str(th.get('gradB') or th.get('bg') or '0x0a1620')
    if _style in ('deck-grad', 'deck-glass'):
        try:
            _ff = find_ffmpeg()
        except Exception:
            _ff = ''
        if _ff and _has_gradients(_ff):
            # ★显式给渐变方向（x0,y0 → x1,y1 = 画面正上方 → 正下方）：
            #   ① 观感上是"上亮下暗"的竖向渐变（比滤镜默认的斜向更稳、更像设计稿）；
            #   ② 也让本机的像素级验证可复现（同一帧沿一条线采样必单调 —— 见 test-deck-styles.py）。
            # ★speed=0（刻意不旋转）：滤镜默认 speed=0.01 会让整幅渐变**持续转动**——长镜里表现为
            #   "背景色慢慢跑色"（不是设计感），而且像素级验证不可复现。渐变风的"持续动效"由
            #   大字呼吸 + 页内进度线 + 分段入场承担，底板保持静止。
            return ('-f lavfi -i gradients=s=%dx%d:c0=%s:c1=%s:x0=0:y0=0:x1=0:y1=%d:d=%s:speed=0'
                    % (W, H, _c0, _c1, int(H), max(1.0, float(dur))))
    return '-f lavfi -i color=c=%s:s=%dx%d:d=%s' % (th.get('bg', '0x0a1620'), W, H, dur)


# ══════════════ ★VF_DECK_STYLES2_V1（2026-10-01）玻璃拟态 / 柔和拟物 的两个面板原语 ══════════════
# 用户原话：「配色版式 就这1种吗？」「我做过一些网页UI风格效果，是否能按传统的5个网页UI效果设计」
#          「配色更讲究一些」「注意配合 配色真的不能太 AI 味。最好有渐变色。还有就是透明度」
# 硬规矩（与 ★VF_NOBLACKBOX_V1 一脉相承，改本段前先读）：
#   ① **颜色一律从主题 token 取**（cardBg2 / lineC / shadowC / gradA / gradB / accent / text / sub）；
#      绝不新造高饱和色 —— 也就不可能再出现"高饱和紫蓝渐变 + 科技蓝发光板"那套 AI 味；
#   ② **面积克制**：强调色只出现在 kicker / 数字 / 色点 / 细线；面板与底衬一律"同色系 + 低 alpha"；
#   ③ **透明度写死并注明理由**（下一段每个数字旁都有）——"用透明度做设计"而不是"用颜色刷面积"。
#   ⚠️ ffmpeg 的 `drawbox` **没有圆角参数**，且 boxblur/gblur 是整帧算子（接进单 -vf 链会把文字一起糊）
#      → 内容面板**不做真圆角、不做真模糊**，靠"低 alpha 染色底 + hairline + 双投影 + bevel"**暗示**
#      玻璃/凸起材质。素材照片卡的真圆角由 B 组 `_plate_round` 负责（素材页里同时成立）。


def _glass_panel(x, y, w, h, th, enable=None):
    """★VF_DECK_STYLES2_V1：一块【半透明毛玻璃卡】的滤镜片段 = 染色玻璃底 + 顶部柔光高光 + 细白边。

    透明度（写死 + 理由）：
      · 染色玻璃底：`cardBg2`（主题同源的低饱和色）0.32 → 0.24 两段微渐变
        —— 低于 0.20 挡不住背后素材、大字读不清；高于 0.36 就变成**实心板**（正是用户讨厌的黑框翻版）；
        留一点上下差（0.32→0.24）让"玻璃片"有厚度感但不成块。
      · 顶部柔光高光：白 0.055（几乎不可见）—— 只在暗底上给一点"玻璃反光"，绝不刷面积。
      · 细白边（hairline）：上/左 `lineC` 0.22、下/右 0.16；边缘暗侧 `shadowC` 0.24~0.30
        —— 一深一浅 = 玻璃棱的方向感；太实（>0.3）就成一圈描边框。
    返回 filter 片段 list（enable 给了就整块按时间点分段入场）。"""
    tint = str(th.get('cardBg2') or th.get('bg2') or th.get('bg') or '0x1b3a5e')
    lc = str(th.get('lineC') or 'white')
    sc = str(th.get('shadowC') or 'black')
    _en = (":enable='gte(t,%.2f)'" % float(enable)) if enable is not None else ''
    _x, _y, _w, _h = int(x), int(y), int(w), int(h)
    _t = max(1, int(min(_w, _h) * 0.010))
    out = []
    out += grad_box_filters(_x, _y, _w, _h, _force_alpha(tint, 0.32), _force_alpha(tint, 0.24),
                            steps=4, enable=enable)
    out.append("drawbox=x=%d:y=%d:w=%d:h=%d:color=%s:t=fill%s"
               % (_x, _y, _w, max(2, int(_h * 0.34)), _force_alpha('white', 0.055), _en))
    out.append("drawbox=x=%d:y=%d:w=%d:h=%d:color=%s:t=fill%s"
               % (_x, _y, _w, _t, _force_alpha(lc, 0.22), _en))
    out.append("drawbox=x=%d:y=%d:w=%d:h=%d:color=%s:t=fill%s"
               % (_x, _y, _t, _h, _force_alpha(lc, 0.16), _en))
    out.append("drawbox=x=%d:y=%d:w=%d:h=%d:color=%s:t=fill%s"
               % (_x, _y + _h - _t, _w, _t, _force_alpha(sc, 0.30), _en))
    out.append("drawbox=x=%d:y=%d:w=%d:h=%d:color=%s:t=fill%s"
               % (_x + _w - _t, _y, _t, _h, _force_alpha(sc, 0.24), _en))
    return out


def _soft_panel(x, y, w, h, th, enable=None):
    """★VF_DECK_STYLES2_V1：一块【柔和拟物（Neumorphism 方向）卡】的滤镜片段。

    做法 = 同色系"左上亮 / 右下暗"双投影 + 同色半透明卡面 + 亮暗 bevel（**凹凸感**分层）：
      · 左上亮投影：`lineC` 0.10（低 alpha，只做"受光面"的暗示）
      · 右下暗投影：`shadowC` 0.34（凸起的背光面；偏移 = min(w,h)*0.045，够看清又不夸张）
      · 卡面：`cardBg2` 0.26 → 0.18 三段微渐变（从底板"微微凸起"，**不用亮色**）
      · bevel：上/左亮线 0.16/0.12、下/右暗线 0.30/0.22 —— 一深一浅才有凹凸，这是拟物的关键
    透明度写死的理由：面板整体低于 0.36 → 仍然是"同色系表面"而不是"贴了块色板"；
      bevel 一律 ≤0.30 → 只做边缘暗示，不画出"描边框"（那又是另一种 AI 味）。
    ⚠️ 不做真圆角（drawbox 无圆角参数）：靠"双投影 + bevel"给出**圆润凸起**的观感。
    返回 filter 片段 list。"""
    face = str(th.get('cardBg2') or th.get('bg2') or th.get('bg') or '0x1b3a5e')
    lc = str(th.get('lineC') or 'white')
    sc = str(th.get('shadowC') or 'black')
    _en = (":enable='gte(t,%.2f)'" % float(enable)) if enable is not None else ''
    _x, _y, _w, _h = int(x), int(y), int(w), int(h)
    _t = max(1, int(min(_w, _h) * 0.012))
    _d = max(3, int(min(_w, _h) * 0.045))
    out = []
    out.append("drawbox=x=%d:y=%d:w=%d:h=%d:color=%s:t=fill%s"
               % (max(0, _x - _d), max(0, _y - _d), _w + _d, _h + _d, _force_alpha(lc, 0.10), _en))
    out.append("drawbox=x=%d:y=%d:w=%d:h=%d:color=%s:t=fill%s"
               % (_x + _d, _y + _d, _w + _d, _h + _d, _force_alpha(sc, 0.34), _en))
    out += grad_box_filters(_x, _y, _w, _h, _force_alpha(face, 0.26), _force_alpha(face, 0.18),
                            steps=3, enable=enable)
    out.append("drawbox=x=%d:y=%d:w=%d:h=%d:color=%s:t=fill%s"
               % (_x, _y, _w, _t, _force_alpha(lc, 0.16), _en))
    out.append("drawbox=x=%d:y=%d:w=%d:h=%d:color=%s:t=fill%s"
               % (_x, _y, _t, _h, _force_alpha(lc, 0.12), _en))
    out.append("drawbox=x=%d:y=%d:w=%d:h=%d:color=%s:t=fill%s"
               % (_x, _y + _h - _t, _w, _t, _force_alpha(sc, 0.30), _en))
    out.append("drawbox=x=%d:y=%d:w=%d:h=%d:color=%s:t=fill%s"
               % (_x + _w - _t, _y, _t, _h, _force_alpha(sc, 0.22), _en))
    return out


def _deck_eff_lum(c, bg_lum):
    """★VF_DECK_CONTRAST_V1（2026-10-01 team-lead）：把带 alpha 的颜色合到给定"底"亮度上
    → 得到这个"面"**实际看起来多亮**（例：white@0.74 铺在暗底 24 上 → 0.74×255+0.26×24 ≈ 195）。"""
    _rgb, _a = _rgb_alpha(c)
    _hex = '0x%02x%02x%02x' % (_rgb[0], _rgb[1], _rgb[2])      # _lum_of 收的是色串，不是 RGB 元组
    _l = float(_lum_of(_hex, bg_lum))
    _a = float(_a)
    return _l * _a + float(bg_lum) * (1.0 - _a)


def _deck_on_face(face_lum):
    """★VF_DECK_CONTRAST_V1：按"面"的亮度挑字色 —— **口径照用 ② `_mat_text_colors` 的 70**，
    不新造阈值：`|字色亮度 − 面亮度| ≥ 70`。浅面（≥128）→ 近黑 `0x101418`；深面 → 白。
    返回 (字色, 面亮度, 亮度差)；两分支的差值恒 ≥ 100（128 处：近黑 108 / 白 127）→ 永不擦边。"""
    _fl = float(face_lum)
    if _fl >= 128.0:
        return '0x101418', _fl, abs(_fl - _lum_of('0x101418', 255))
    return 'white', _fl, abs(_fl - 255.0)


def _deck_item_material(style, th):
    """★VF_DECK_LIGHTFACE_V1（2026-10-01 老板 + team-lead 观感意见）：5 套风格页**各自的**"面"。

    老板/team-lead 原话：「要点行的『面』不要是实心白杠」→ 换成
    **【极淡染色面（同主题色、alpha 更低）】+【1px 细边】**，强度不够**靠面更高/更长补，不靠刷白**。
    为什么原来的白杠会"刺眼"：`white@0.72~0.93` 铺在暗底上 → 面亮度 195~238，
    整页最亮的东西变成三条横杠（尤其 `蓝白科技`/`柔和高级`），主标题反而被压下去。
    为什么现在敢把 alpha 降到 0.09~0.42：
      · 运动量（体检②的 1.15e7 = 面积×ΔL）**已经由 ★VF_SUSTAIN_V2 的整块浮动 + 背景渐变流动承担**
        （见 float_motion_filters / FLOAT_GRAD_SPEED），不再需要靠"面刷白"去抬帧间差；
      · 结构上的"面"仍然在（每套仍有 A 块盖要点 1-2、B 块盖要点 3，见 _deck_styled_filters），
        只是改成"淡染 + 细边"的克制作法 —— 6 套 8s 页的时间轴本机复测仍达标（报告里有）。
    设计口径（低饱和 / 色块面积小 / 有中性灰阶 / 不要实心黑框）：
      · deck-glass → 同色系**柔和拟物**（`cardBg2` 淡染 + 面内纵向渐变 + 上高光 / 下暗棱）
      · deck-soft  → 同色系最淡的一块（`cardBg2` 0.38，无描边，只留柔和边）
      · deck-mono  → **中性灰阶**（白 0.09 = 近黑底上的一层灰），不再"黑底 + 亮红字 + 白杠"
      · deck-mag   → 纸色淡淡一层（`cardBg` 0.14）+ 细线
      · deck-grad  → 主题色极淡一层（accent 0.15）
    返回 (面色, 是否加"玻璃/拟物"装饰) —— **保持 2 元组**（自测里有解包调用）。
    """
    _cb = str(th.get('cardBg') or 'white@0.93')
    _cb2 = str(th.get('cardBg2') or th.get('bg2') or th.get('accent') or _cb)
    _acc = str(th.get('accent') or '0x2f7cf6')
    _ink = str(th.get('cardText') or '0x101418')
    _dark = _lum_of(str(th.get('bg') or '0x0a1620'), 160) < 128
    if _dark:
        _tab = {'deck-glass': (_force_alpha(_cb2, 0.42), True),
                'deck-soft': (_force_alpha(_cb2, 0.38), True),
                'deck-mono': (_force_alpha('white', 0.09), True),
                'deck-mag': (_force_alpha(_cb, 0.14), False),
                'deck-grad': (_force_alpha(_acc, 0.15), False),
                # ★VF_DECK_LIGHTFACE_V1：**经典 deck（= 蓝白科技）的要点行**也走这一套
                #   （老板在这套上看得最明显：原来是三条白杠 → 现在极淡主题染色 + 1px 细边）
                'deck': (_force_alpha(_acc, 0.16), False)}
    else:
        # 浅底：用"同源深墨的极淡一层"（纸上的一块淡影），不再用重墨 0.54~0.64
        _tab = {'deck-glass': (_force_alpha(_ink, 0.12), True),
                'deck-soft': (_force_alpha(_ink, 0.10), True),
                'deck-mono': (_force_alpha(_ink, 0.10), True),
                'deck-mag': (_force_alpha(_ink, 0.09), False),
                'deck-grad': (_force_alpha(_acc, 0.13), False),
                'deck': (_force_alpha(_ink, 0.10), False)}
    _c, _g = _tab.get(style, (_force_alpha(_cb, 0.16), False))
    return _c, bool(_g)


def _deck_face_edge(style, th):
    """★VF_DECK_LIGHTFACE_V1：面的 **1px 细边** —— 面的"存在感"靠边线，不靠把它刷白。
    同主题色（accent）/ 中性（mono、glass 走白·黑），alpha 0.16~0.45，肉眼是"一条细线"而不是框。"""
    _dark = _lum_of(str(th.get('bg') or '0x0a1620'), 160) < 128
    if style in ('deck-mono', 'deck-glass'):
        return _force_alpha('white' if _dark else 'black', 0.20 if style == 'deck-mono' else 0.16)
    return _force_alpha(str(th.get('accent') or '0x2f7cf6'), 0.45 if _dark else 0.38)


def _deck_styled_filters(shot, th, W, H, dur, style, font=None, region=None):
    """★VF_DECK_STYLES_V1：6 套风格里除"经典 deck"外的 5 套（grad/mono/mag/glass/soft）的**元素层**。

    与经典 deck 是同一套"元素清单"（kicker 标签 / 主标题 / 副标 / 细线 / 2~4 条编号要点 /
    数据卡 / 页码 / 页内进度线），只把【配色 · 透明度 · 留白 · 对齐 · 装饰】换一套解法 ——
    所以六套能在同一条片里轮换而不违和（用户要的"多做几个模版"）。
    动效与经典一致（不许退化）：所有元素**分段入场**（错开 alpha + enable）+ 持续动效
    （呼吸 sin / 强调条慢生长 / 页内进度线走完整页）。
    region=(x,y,w,h)：素材页（左图右文 / 上图下文）时只在这块区域里排版；不给 = 整幅排版。
    返回 filter 片段 list；白名单外的 variant 由 deck_page_filters 提前拦掉（绝不走到这里）。
    """
    _bold = font or font_bold(th)
    _reg = esc_path(find_font(th.get('font', 'msyh')))
    acc = str(th.get('accent') or '0xff6b35')
    dotc = str(th.get('dot') or th.get('accent2') or acc)
    txc = str(th.get('text') or 'white')
    subc = str(th.get('sub') or txc)
    linec = str(th.get('line') or 'white@0.30')
    gA = str(th.get('gradA') or th.get('bg2') or th.get('bg') or '0x0a1620')
    gB = str(th.get('gradB') or th.get('bg') or '0x0a1620')
    kfg = str(th.get('kickerText') or 'white')
    # ★VF_DECK_STYLES2_V1：玻璃/柔和两张新卡面的 token（同源于主题，低饱和）
    lcC = str(th.get('lineC') or ('white' if _lum_of(txc, 255) < 128 else 'black'))
    scC = str(th.get('shadowC') or 'black')
    _sus = sustain_of(shot)
    grad = (style == 'deck-grad')
    mono = (style == 'deck-mono')
    mag = (style == 'deck-mag')
    glass = (style == 'deck-glass')
    soft = (style == 'deck-soft')
    _plh = max(2, int(H * 0.0042))

    if region:
        rx, ry, rw, rh = [int(v) for v in region]
    else:
        # 留白比经典 deck 更足（用户点名"经典通用"要打磨留白与层级）
        rx, ry = int(W * 0.085), int(H * 0.105)
        rw, rh = int(W * 0.83), int(H * 0.79)
    rx = max(0, min(rx, max(0, W - 60)))
    rw = max(60, min(rw, W - rx - max(6, int(W * 0.02))))
    ry = max(0, min(ry, max(0, H - 60)))
    rh = max(60, min(rh, H - ry - max(6, int(H * 0.02))))

    main = _big_text(shot, limit=18) or clean_big_text(shot.get('title'))[:18] or 'PPT 内容页'
    kicker = str(shot.get('kicker') or shot.get('tag') or shot.get('eyebrow') or '').strip()[:14]
    subtitle = str(shot.get('sub') or shot.get('desc') or shot.get('subtitle_en') or '').strip()[:28]
    items = _norm_items(shot)[:4]
    stats = _deck_stats(shot)
    page = str(shot.get('page') or shot.get('pageno') or shot.get('pageNo') or '').strip()[:12]

    # ── 自适应字号（与经典 deck 同口径；mag 行距更紧 = "压边大标题"的编辑感）──
    #   ★VF_DECK_STYLES2_V1：soft（拟物）行距更松 1.42 —— 拟物靠"留白 + 凹凸"分层，字挤了就不像
    _tgap_k = 1.16 if mag else (1.42 if soft else 1.30)
    _M = {}
    _tfs = max(22, int(min(rw * 0.105, rh * 0.185)))
    for _ in range(10):
        _lines, _t2 = fit_big_text(main, W, H, fs_max=_tfs, max_lines=2,
                                   maxw_ratio=max(0.30, rw / float(W)),
                                   fs_min=max(18, int(_tfs * 0.62)), one_line_max=9)
        _tfs = _t2
        _M = {
            'lines': _lines,
            'kfs': max(15, int(_tfs * 0.36)),
            'sfs': max(13, int(_tfs * 0.32)),
            'ifz': max(14, int(_tfs * 0.40)),
            'nfz': max(16, int(_tfs * 0.48)),
            'vfz': max(24, int(_tfs * 0.86)),
            'lfz': max(12, int(_tfs * 0.28)),
            'pfs': max(12, int(_tfs * 0.26)),
        }
        _M['kpad'] = max(6, int(_M['kfs'] * 0.42))
        _M['kbar'] = (_M['kfs'] + 2 * _M['kpad']) if kicker else 0
        _M['g1'] = int(_tfs * (0.42 if mag else 0.34)) if kicker else int(_tfs * 0.12)
        _M['tg'] = int(_tfs * _tgap_k)
        _M['th'] = _M['tg'] * max(1, len(_lines))
        _M['sh'] = int(_M['sfs'] * 1.9) if subtitle else 0
        _M['dvh'] = max(2, int(_tfs * 0.032))
        _M['dvg'] = int(_tfs * (0.42 if (mono or soft) else 0.34))
        _M['rhit'] = max(int(_M['ifz'] * (1.95 if (mono or soft) else 1.62)), int(_M['nfz'] * 1.30))
        _M['ih'] = _M['rhit'] * len(items)
        _M['sh2'] = (int(_M['vfz'] * 1.30) + int(_M['lfz'] * 1.9)) if stats else 0
        _M['g2'] = int(_tfs * 0.38) if stats else 0
        _M['ph'] = (max(12, int(_tfs * 0.28)) + _plh) if page else 0
        _M['tot'] = (_M['kbar'] + _M['g1'] + _M['th'] + _M['sh'] + 2 * _M['dvg'] + _M['dvh']
                     + _M['ih'] + _M['g2'] + _M['sh2'] + _M['ph'])
        if _M['tot'] <= rh or _tfs <= 20:
            break
        _tfs = max(18, int(_tfs * 0.92))
    _kfs, _sfs, _ifz, _nfz = _M['kfs'], _M['sfs'], _M['ifz'], _M['nfz']
    _vfz, _lfz, _pfs = _M['vfz'], _M['lfz'], _M['pfs']
    _kbar, _kpad, _g1, _tg = _M['kbar'], _M['kpad'], _M['g1'], _M['tg']
    _sh, _dvh, _dvg, _rhit, _ih = _M['sh'], _M['dvh'], _M['dvg'], _M['rhit'], _M['ih']
    _sh2, _g2, _ph, _tot, _lines = _M['sh2'], _M['g2'], _M['ph'], _M['tot'], _M['lines']

    out = []
    _y = ry + max(0, int((rh - _tot) * 0.5))
    _x = rx
    _br = ('*' + breath_alpha(dur)) if _sus else ''

    # ① kicker 标签条（三套风格三种做法：渐变条 / 无底色细线 / 强调色 + 下划线）
    if kicker:
        _kw = int(est_text_w(kicker, _kfs) + 2 * _kpad)
        if mono:
            # 极简留白：不给底色，只在文字左下压一条 2px 强调短线（alpha 0.90 = 唯一一处强调色）
            out.append(f"drawbox=x={_x}:y={_y + _kbar - max(2, int(_kfs * 0.16))}:"
                       f"w={max(20, int(_kw * 0.46))}:h={max(2, int(_kfs * 0.13))}:"
                       f"color={_force_alpha(acc, 0.90)}:t=fill:enable='gte(t,0.10)'")
            out.append(f"drawtext=fontfile='{_bold}':text='{esc_text(kicker)}':fontsize={_kfs}:"
                       f"fontcolor={acc}:x={_x}:y={_y}:alpha='min(max(t-0.10,0)/0.35,1)'")
        elif mag:
            # 杂志/编辑风：栏目名用强调色 + 下面一条 2px 实线（masthead 观感），无底色块
            out.append(f"drawtext=fontfile='{_bold}':text='{esc_text(kicker)}':fontsize={_kfs}:"
                       f"fontcolor={acc}:x={_x}:y={_y}:alpha='min(max(t-0.10,0)/0.35,1)'")
            out.append(f"drawbox=x={_x}:y={_y + int(_kfs * 1.25)}:w={max(24, int(_kw * 0.72))}:"
                       f"h={max(2, int(_kfs * 0.10))}:color={_force_alpha(acc, 0.88)}:t=fill:"
                       f"enable='gte(t,0.20)'")
        elif glass:
            # 玻璃拟态：一块"悬浮玻璃片"标签 —— 染色玻璃底(0.32/0.24) + 细白边 + 顶部柔光；面积很小
            out += _glass_panel(_x, _y, _kw, _kbar, th, enable=0.10)
            out.append(f"drawtext=fontfile='{_bold}':text='{esc_text(kicker)}':fontsize={_kfs}:"
                       f"fontcolor={kfg}:x={_x + _kpad}:y={_y + _kpad}:"
                       f"alpha='min(max(t-0.10,0)/0.35,1)'")
        elif soft:
            # 柔和拟物：标签做成"凸起的小胶囊" —— 双投影 + 同色卡面；文字走中性色（不刷强调色）
            out += _soft_panel(_x, _y, _kw, _kbar, th, enable=0.10)
            out.append(f"drawtext=fontfile='{_bold}':text='{esc_text(kicker)}':fontsize={_kfs}:"
                       f"fontcolor={_force_alpha(txc, 0.86)}:x={_x + _kpad}:y={_y + _kpad}:"
                       f"alpha='min(max(t-0.10,0)/0.35,1)'")
        else:
            # 渐变风：标签条本身就是"真渐变"（acc 亮端 → 压暗 30% 的暗端），alpha 0.95→0.88
            #   （面积很小，所以可以稍实；这是"面积克制"下的唯一实底元素）
            out += grad_box_filters(_x, _y, _kw, _kbar, acc, _shade(acc, 0.70), steps=6,
                                    a0=0.95, a1=0.88)
            out.append(f"drawtext=fontfile='{_bold}':text='{esc_text(kicker)}':fontsize={_kfs}:"
                       f"fontcolor={kfg}:x={_x + _kpad}:y={_y + _kpad}:"
                       f"alpha='min(max(t-0.10,0)/0.35,1)'")
        _y += _kbar + _g1
    else:
        # 没有 kicker 也不硬编标题：改为一条"强调记号"（与经典 deck 同策略）
        _bhh = max(4, int(_tg * 0.045))
        _bw = max(36, int(rw * 0.14))
        if _sus:
            _gs = grow_secs(dur)
            out += grow_filters(_x, _y, _bw, _bhh, _force_alpha(acc, 0.92), dur,
                                delay=0.10, grow=_gs, seg=max(6, int(_gs * 6)))
        else:
            out.append(f"drawbox=x={_x}:y={_y}:w={_bw}:h={_bhh}:"
                       f"color={_force_alpha(acc, 0.92)}:t=fill")
        _y += _bhh + _g1

    # ② 主标题（逐行错开 + 描边 + 阴影 + 呼吸；mag 左边界"压边"）
    #   ★VF_DECK_STYLES2_V1：glass/soft 去掉"重黑描边"（贴膏药的观感），只留极淡阴影；
    #   其余 4 套显式拼接的字符串与改动前**逐字相同**（零回归）。
    _tbd = '' if (glass or soft) else (
        f"borderw={max(2, int(_tfs * 0.045))}:bordercolor={_force_alpha('black', 0.40)}:")
    _tsh = (f"shadowx=1:shadowy=1:shadowcolor={_force_alpha('black', 0.30)}:" if (glass or soft)
            else f"shadowx=2:shadowy=2:shadowcolor={_force_alpha('black', 0.38)}:")
    _lx = _x - (int(rw * 0.035) if mag else 0)
    for _i, _ln in enumerate(_lines):
        _t_on = 0.30 + 0.18 * _i
        out.append(
            f"drawtext=fontfile='{_bold}':text='{esc_text(_ln)}':fontsize={_tfs}:"
            f"fontcolor={txc}:{_tbd}{_tsh}"
            f"x={_lx}:y={_y + _i * _tg}:alpha='min(max(t-{_t_on:.2f},0)/0.45,1){_br}'")
    _y += _M['th']

    # ③ 副标题（一行小字）
    if subtitle:
        out.append(
            f"drawtext=fontfile='{_reg}':text='{esc_text(subtitle)}':fontsize={_sfs}:"
            f"fontcolor={subc}:x={_x}:y={_y + int(_sfs * 0.35)}:"
            f"alpha='min(max(t-0.55,0)/0.45,1)'")
        _y += _sh

    # ④ 细分割线（三套的"透明度分量"完全不同 —— 这是各风格气质的主要差别）
    _y += _dvg
    if mono:
        # 极简：一条通栏 hairline，alpha 0.14 —— 只做"分割暗示"，绝不参与强调
        out.append(f"drawbox=x={_x}:y={_y}:w={rw}:h={max(1, int(_dvh * 0.5))}:"
                   f"color={_force_alpha(txc, 0.14)}:t=fill:enable='gte(t,0.75)'")
    elif mag:
        # 杂志：双线（2px 主 + 1px 次，中间留 3px）+ 右端强调色短横（"栏目分栏"的编辑味）
        out.append(f"drawbox=x={_x}:y={_y}:w={int(rw * 0.52)}:h={max(2, _dvh)}:"
                   f"color={_force_alpha(txc, 0.30)}:t=fill:enable='gte(t,0.75)'")
        out.append(f"drawbox=x={_x}:y={_y + _dvh + 3}:w={int(rw * 0.30)}:h={max(1, int(_dvh * 0.5))}:"
                   f"color={_force_alpha(txc, 0.18)}:t=fill:enable='gte(t,0.85)'")
        out.append(f"drawbox=x={_x + int(rw * 0.52) + max(8, int(rw * 0.014))}:y={_y}:"
                   f"w={int(rw * 0.10)}:h={max(2, _dvh)}:color={_force_alpha(acc, 0.85)}:t=fill:"
                   f"enable='gte(t,0.85)'")
    elif glass:
        # 玻璃拟态：一条细白 hairline（0.20，只做"玻璃棱"暗示）+ 尾端一枚小玻璃方块
        out.append(f"drawbox=x={_x}:y={_y}:w={int(rw * 0.30)}:h={max(1, int(_dvh * 0.6))}:"
                   f"color={_force_alpha(lcC, 0.20)}:t=fill:enable='gte(t,0.75)'")
        _sq = max(6, int(_dvh * 2.0))
        _sx = _x + int(rw * 0.30) + max(8, int(rw * 0.014))
        _sy = _y - max(0, (_sq - _dvh) // 2)
        out.append(f"drawbox=x={_sx}:y={_sy}:w={_sq}:h={_sq}:"
                   f"color={_force_alpha(str(th.get('cardBg2') or gA), 0.50)}:t=fill:"
                   f"enable='gte(t,0.85)'")
        out.append(f"drawbox=x={_sx}:y={_sy}:w={_sq}:h=1:"
                   f"color={_force_alpha(lcC, 0.24)}:t=fill:enable='gte(t,0.85)'")
    elif soft:
        # 柔和拟物：一条"凹槽"—— 上沿暗 0.28 + 下沿亮 0.14（同色系深浅 = 凹下去的感觉）
        out.append(f"drawbox=x={_x}:y={_y}:w={int(rw * 0.34)}:h={max(2, int(_dvh * 0.5))}:"
                   f"color={_force_alpha(scC, 0.28)}:t=fill:enable='gte(t,0.75)'")
        out.append(f"drawbox=x={_x}:y={_y + max(1, int(_dvh * 0.5))}:w={int(rw * 0.34)}:"
                   f"h={max(1, int(_dvh * 0.4))}:color={_force_alpha(lcC, 0.14)}:t=fill:"
                   f"enable='gte(t,0.78)'")
    else:
        # 渐变风：一条 accent 细线（alpha 0.20 只做暗示）+ 尾端一个小色点
        out.append(f"drawbox=x={_x}:y={_y}:w={int(rw * 0.34)}:h={max(2, int(_dvh * 0.8))}:"
                   f"color={_force_alpha(acc, 0.20)}:t=fill:enable='gte(t,0.75)'")
        _sq = max(6, int(_dvh * 2.0))
        out.append(f"drawbox=x={_x + int(rw * 0.34) + max(8, int(rw * 0.014))}:"
                   f"y={_y - max(0, (_sq - _dvh) // 2)}:w={_sq}:h={_sq}:"
                   f"color={_force_alpha(dotc, 0.92)}:t=fill:enable='gte(t,0.85)'")
    _y += _dvh + _dvg

    # ★VF_DECK_SPAN_V2（2026-10-01 team-lead 验收口径）：5 套风格页与基础 deck 页**同口径** ——
    #   原来 01/02/03 + 数据卡全挤在 0.85~1.8s，8s 的页从 2s 起只剩呼吸（逐帧 YAVG≈0.15~0.2，
    #   体检②全是"."）。这里按镜长**整段错峰**（要点 i @0.45+i×gap，数据卡接在最后一段），
    #   短镜按比例压缩、不跳变。
    # ★VF_DECK_SPAN_V3（2026-10-01 team-lead 决定 1）：5 套风格页**各自给"卡面级"材质**，并据此重排入场：
    #   · 标题                 @0.45      → 负责 0–2s 窗
    #   · 材质块A（要点 1-2）  @≈dur×0.30 → 负责 2–4s 窗
    #   · 材质块B（要点 3）    @≈dur×0.54 → 负责 4–6s 窗
    #   · 数据卡               @≈dur−1.6  → 负责 6–8s 窗（留 1.6s 给"数字在滚"这个可见动效）
    #   量级算式（team-lead 认可的口径）：体检②的 0.5s 分箱是**均值**，一次性出现会被 12.5 帧摊薄
    #   → 一块面要 A×ΔL ≥ 921600×12.5 ≈ 1.15e7（px·luma）才折算到 ≥1.0。
    _bAS = max(0.8, float(dur) * 0.30)
    _bBS = _bAS + max(1.0, float(dur) * 0.24)

    def _itOnS(_k):
        return _bAS + _k * 0.7 if _k < 2 else _bBS

    _stOnS = max(0.0, float(dur) - 1.6)

    # ★VF_DECK_SPAN_V3：**按本风格材质**的两块面（要点区底）—— 它们就是这一页"看得出在动"的那两记。
    #   A 块盖要点 1-2、B 块盖要点 3（B 往下多伸 32px，够到 1.15e7 的量级线，但不碰数据卡）。
    _matC, _gloss = _deck_item_material(style, th)
    # ★VF_DECK_CONTRAST_V1（2026-10-01 team-lead 实测「浅灰面上要点字发灰、读不出」）：
    #   要点区现在有"面"了 → 字色**必须按面的亮度算**（浅面近黑 / 深面白），并过 ② 的 |Δ|≥70。
    _bgL = float(_lum_of(str(th.get('bg') or '0x0a1620'), 160))
    _faceL = _deck_eff_lum(_matC, _bgL)
    _onFace, _faceL2, _ddFace = _deck_on_face(_faceL)
    _onMat = _onFace
    print('[VF] ★VF_DECK_CONTRAST_V1 风格=%s 要点面亮度=%.0f → 字色=%s（|Δ|=%.0f ≥70）'
          % (style, _faceL2, _onFace, _ddFace))
    _rhit2 = 2 * _rhit
    # ★VF_DECK_SPAN_V3：**素材页只排右半幅**（region 给了 → rw≈半幅）→ 同样高度的面面积只剩一半，
    #   量级会掉回 `+`（本机实测：6 套演示片素材页里有 4 套 2–4s 窗不达标）。
    #   所以面的高度按"够 1.15e7"反算：h ≥ 1.15e7/(rw×ΔL)，ΔL 取保守值 150。
    #   纯文字页 rw≈1100 → 反算 h≈70，比现有块矮 → 保持原样（零回归）。
    #   纯文字页 rw≈1100 → 反算 h≈116，比现有块略高；素材页 rw≈600 → h≈213。
    _needh = int(1.15e7 / max(1, rw) / 80)
    _avail = max(0, (ry + rh) - _y - 8)          # 要点区顶 → 区域底：两块面总共能用的高度
    _hTot = min(_needh * 2 + 90, _avail) if _avail else (_needh * 2 + 90)
    _hA = max(_rhit2 + 4, min(_needh, int(_hTot * 0.5)))
    # 素材页 grad/glass 还有一层"柔光 wash"盖在面上 → 同几何下 4–6s 只剩 0.96（mono/mag 同几何 2.28/1.24）
    # → 把 B 做高（A+B 仍在 _avail 之内），B 的出现面积就够量级；观感仍是"面板分两步长开"。
    _hB = max(_rhit + 44, int(_hTot) - _hA)
    _gcv = _rgb_alpha(_matC)[0]
    _ghex = '0x%02x%02x%02x' % (_gcv[0], _gcv[1], _gcv[2])   # 材质色去掉 alpha 的纯色串
    _matA = _rgb_alpha(_matC)[1]                              # 面的 alpha（现在很淡：0.09~0.42）
    _edgeC = _deck_face_edge(style, th)
    if _gloss:
        # ★VF_DECK_LIGHTFACE_V1：同色系**柔和拟物**（玻璃/软面）—— 面内亮→暗的极淡渐变（凸起感）
        #   + 上沿高光 + 下沿暗棱。全部是"面内/贴边"效果（1~3px），不刷面积、不改出现时刻。
        out += grad_box_filters(_x, _y - 4, rw, _hA, _force_alpha(_ghex, min(0.95, _matA * 1.30)),
                                _force_alpha(_ghex, _matA * 0.80), steps=4, enable=_bAS)
        out += grad_box_filters(_x, _y - 4 + _hA, rw, _hB, _force_alpha(_ghex, min(0.95, _matA * 1.30)),
                                _force_alpha(_ghex, _matA * 0.80), steps=4, enable=_bBS)
        out.append(f"drawbox=x={_x}:y={_y - 4 + _hA + _hB - 1}:w={rw}:h=1:"
                   f"color={_force_alpha(scC, 0.30)}:t=fill:enable='gte(t,{_bBS:.2f})'")
    else:
        out.append(f"drawbox=x={_x}:y={_y - 4}:w={rw}:h={_hA}:color={_matC}:t=fill"
                   f":enable='gte(t,{_bAS:.2f})'")
        out.append(f"drawbox=x={_x}:y={_y - 4 + _hA}:w={rw}:h={_hB}:color={_matC}:t=fill"
                   f":enable='gte(t,{_bBS:.2f})'")
    # ★VF_DECK_LIGHTFACE_V1：**1px 细边** —— 上面两块"淡染面"靠边线立住（A 上沿 / B 上沿 / B 下沿）
    out.append(f"drawbox=x={_x}:y={_y - 4}:w={rw}:h=1:color={_edgeC}:t=fill"
               f":enable='gte(t,{_bAS:.2f})'")
    out.append(f"drawbox=x={_x}:y={_y - 4 + _hA}:w={rw}:h=1:color={_edgeC}:t=fill"
               f":enable='gte(t,{_bBS:.2f})'")
    out.append(f"drawbox=x={_x}:y={_y - 4 + _hA + _hB - 1}:w={rw}:h=1:color={_edgeC}:t=fill"
               f":enable='gte(t,{_bBS:.2f})'")
    print('[VF] ★VF_DECK_LIGHTFACE_V1 风格=%s 淡染面 2 块 @%.2f/%.2f（%s，alpha=%.2f）+ 1px 细边（%s）'
          % (style, _bAS, _bBS, _matC, _matA, _edgeC))

    # ⑤ 编号要点（mono 用中性编号 + 大行距，mag 用竖栏线，grad 用小色点）
    for _i, _it in enumerate(items):
        _t_on = _itOnS(_i)
        _iy = _y + _i * _rhit
        _num = '%02d' % (_i + 1)
        #   ★VF_DECK_STYLES2_V1：编号色 —— mono/soft 走中性（拟物/极简都"不刷亮色"），其余用 accent
        # ★VF_DECK_CONTRAST_V1：编号色也过对比判据 —— accent 在"面"上不达标就退回面上字色
        #   （原来 mono/soft 用 _onMat@0.55，合成后 |Δ| 只有 ~55 < 70 → 一律换成满 alpha）
        # ★VF_DECK_LIGHTFACE_V1：mono（柔和高级）的**编号**强制走中性（面上字色）——
        #   这一套的定位是"纯中性灰阶"，编号刷色会把它拉回"科技感"（team-lead「别再是黑底+亮红字」）。
        _nc = _onMat if style == 'deck-mono' \
            else (acc if abs(_lum_of(acc, 255) - _faceL2) >= 70 else _onMat)
        out.append(f"drawtext=fontfile='{_bold}':text='{_num}':fontsize={_nfz}:fontcolor={_nc}:"
                   f"x={_x}:y={_iy + max(0, (_rhit - _nfz) // 2)}:"
                   f"alpha='min(max(t-{_t_on:.2f},0)/0.35,1)'")
        _dx = _x + int(est_text_w(_num, _nfz)) + max(8, int(_nfz * 0.30))
        if mono:
            _tx = _dx + max(10, int(_ifz * 0.50))
        elif mag:
            out.append(f"drawbox=x={_dx}:y={_iy + max(0, (_rhit - int(_ifz * 1.1)) // 2)}:w=2:"
                       f"h={int(_ifz * 1.1)}:color={_force_alpha(acc, 0.85)}:t=fill:"
                       f"enable='gte(t,{_t_on + 0.08:.2f})'")
            _tx = _dx + max(10, int(_ifz * 0.42))
        elif glass:
            # 玻璃拟态：要点前一枚"小玻璃片"（染色 0.55 + 上沿白 hairline）—— 比实心色点更"悬浮"
            _sqb = max(5, int(_ifz * 0.30))
            _my = _iy + max(0, (_rhit - _sqb) // 2)
            out.append(f"drawbox=x={_dx}:y={_my}:w={_sqb}:h={_sqb}:"
                       f"color={_force_alpha(str(th.get('cardBg2') or gA), 0.55)}:t=fill:"
                       f"enable='gte(t,{_t_on + 0.08:.2f})'")
            out.append(f"drawbox=x={_dx}:y={_my}:w={_sqb}:h=1:"
                       f"color={_force_alpha(lcC, 0.26)}:t=fill:enable='gte(t,{_t_on + 0.08:.2f})'")
            _tx = _dx + _sqb + max(8, int(_ifz * 0.34))
        elif soft:
            # 柔和拟物：要点前一枚"小凸点"（右下暗 0.30 + 左上亮面 + 上沿亮线）—— 不刷强调色
            _sqb = max(5, int(_ifz * 0.34))
            _my = _iy + max(0, (_rhit - _sqb) // 2)
            out.append(f"drawbox=x={_dx + 1}:y={_my + 1}:w={_sqb}:h={_sqb}:"
                       f"color={_force_alpha(scC, 0.30)}:t=fill:enable='gte(t,{_t_on + 0.08:.2f})'")
            out.append(f"drawbox=x={_dx}:y={_my}:w={_sqb}:h={_sqb}:"
                       f"color={_force_alpha(str(th.get('cardBg2') or gA), 0.42)}:t=fill:"
                       f"enable='gte(t,{_t_on + 0.08:.2f})'")
            out.append(f"drawbox=x={_dx}:y={_my}:w={_sqb}:h=1:"
                       f"color={_force_alpha(lcC, 0.18)}:t=fill:enable='gte(t,{_t_on + 0.08:.2f})'")
            _tx = _dx + _sqb + max(8, int(_ifz * 0.34))
        else:
            _sqb = max(5, int(_ifz * 0.30))
            out.append(f"drawbox=x={_dx}:y={_iy + max(0, (_rhit - _sqb) // 2)}:w={_sqb}:h={_sqb}:"
                       f"color={_force_alpha(dotc, 0.92)}:t=fill:enable='gte(t,{_t_on + 0.08:.2f})'")
            _tx = _dx + _sqb + max(8, int(_ifz * 0.34))
        out.append(f"drawtext=fontfile='{_reg}':text='{esc_text(_it)}':fontsize={_ifz}:"
                   f"fontcolor={_onMat}:x={_tx}:y={_iy + max(0, (_rhit - _ifz) // 2)}:"
                   f"alpha='min(max(t-{_t_on + 0.14:.2f},0)/0.40,1){_br}'")
    _y += _ih

    # ⑥ 数据块（整数走 eif 滚动，与经典 deck 同款"真动效"）
    if stats:
        _y += _g2
        _st_on = _stOnS          # ★VF_DECK_SPAN_V2：数据卡接在要点之后（8s 页 ≈6.4s）
        # ★VF_DECK_CONTRAST_V1（2026-10-01 team-lead 实测「数据卡标签在深底上太暗」）：
        #   卡面**先铺本风格的材质面 `_matC`**（与要点面同源）→ 卡面亮度确定可算；数字/标签一律
        #   按"面"取色、过 ② 的 |Δ|≥70（accent/卡面副色不达标就退回面上字色）。
        #   各风格仍保留自己的**细装饰**（hairline / 高光 / 暗棱 / 强调栏线），但不再用会把卡面压暗的
        #   大块半透明填充 —— 原来卡面落在中灰 105~149，蓝数字只有 |Δ|=34、灰标签 |Δ|=69，读不出。
        _faceS = _deck_eff_lum(_matC, _bgL)
        _onS, _faceS2, _dS = _deck_on_face(_faceS)
        _psbTok = str(th.get('cardSub') or subc)     # 卡面副色（数据卡标签用）
        _hw = max(2, int(_dvh * 0.6))
        _bw2 = max(3, int(rw * 0.007))
        out.append(f"drawbox=x={_x}:y={_y}:w={rw}:h={_sh2}:color={_matC}:t=fill"
                   f":enable='gte(t,{_st_on:.2f})'")
        if mono:
            # 极简：无填充装饰 —— 上下两条 hairline 框住数据行（"留白才是主角"）
            out.append(f"drawbox=x={_x}:y={_y}:w={rw}:h={_hw}:"
                       f"color={_force_alpha(_onS, 0.16)}:t=fill:enable='gte(t,{_st_on:.2f})'")
            out.append(f"drawbox=x={_x}:y={_y + _sh2 - _hw}:w={rw}:h={_hw}:"
                       f"color={_force_alpha(_onS, 0.12)}:t=fill:enable='gte(t,{_st_on + 0.20:.2f})'")
        elif mag:
            # 杂志（纸块）：上下两条细墨线当"纸张切边" + 左侧 3px 强调栏线
            out.append(f"drawbox=x={_x}:y={_y}:w={rw}:h=2:color={_force_alpha(_onS, 0.28)}:t=fill"
                       f":enable='gte(t,{_st_on:.2f})'")
            out.append(f"drawbox=x={_x}:y={_y + _sh2 - 2}:w={rw}:h=2:"
                       f"color={_force_alpha(_onS, 0.20)}:t=fill:enable='gte(t,{_st_on:.2f})'")
            out.append(f"drawbox=x={_x}:y={_y}:w={_bw2}:h={_sh2}:"
                       f"color={_force_alpha(acc, 0.92)}:t=fill:enable='gte(t,{_st_on:.2f})'")
        elif glass:
            # 玻璃：上沿高光 + 右下柔和暗棱（都是 1~3px 的"面内"效果）+ 左侧 accent 细栏线 ——
            #   既保住"玻璃片"的观感，又不把卡面压暗（team-lead 已同意"可读性优先于更透"）
            out.append(f"drawbox=x={_x}:y={_y}:w={rw}:h=2:"
                       f"color={_force_alpha('white', 0.24)}:t=fill:enable='gte(t,{_st_on:.2f})'")
            out.append(f"drawbox=x={_x + rw - _bw2}:y={_y + _sh2 - 3}:w={_bw2}:h=3:"
                       f"color={_force_alpha(scC, 0.18)}:t=fill:enable='gte(t,{_st_on:.2f})'")
            out.append(f"drawbox=x={_x}:y={_y}:w={_bw2}:h={_sh2}:"
                       f"color={_force_alpha(acc, 0.55)}:t=fill:enable='gte(t,{_st_on:.2f})'")
        elif soft:
            # 柔和拟物（同色系凸起块）：左上亮面 + 右下暗投影（各 3px）+ 细 accent 栏线
            out.append(f"drawbox=x={_x}:y={_y}:w={rw}:h=3:"
                       f"color={_force_alpha('white', 0.20)}:t=fill:enable='gte(t,{_st_on:.2f})'")
            out.append(f"drawbox=x={_x}:y={_y + _sh2 - 3}:w={rw}:h=3:"
                       f"color={_force_alpha(scC, 0.20)}:t=fill:enable='gte(t,{_st_on:.2f})'")
            out.append(f"drawbox=x={_x}:y={_y}:w={_bw2}:h={_sh2}:"
                       f"color={_force_alpha(acc, 0.50)}:t=fill:enable='gte(t,{_st_on:.2f})'")
        else:
            # 渐变风：面内一条**极淡**的纵向渐变（同色系，只做"有厚度"的暗示，不压暗卡面）
            #   + 顶部 accent 发丝 + 左侧 accent 栏线
            _gc = _rgb_alpha(_matC)[0]
            out += grad_box_filters(_x, _y, rw, _sh2, _force_alpha(_gc, 0.07),
                                    _force_alpha(_gc, 0.0), steps=6, enable=_st_on)
            out.append(f"drawbox=x={_x}:y={_y}:w={rw}:h=2:color={_force_alpha(acc, 0.80)}:t=fill:"
                       f"enable='gte(t,{_st_on:.2f})'")
            out.append(f"drawbox=x={_x}:y={_y}:w={_bw2}:h={_sh2}:"
                       f"color={_force_alpha(acc, 0.92)}:t=fill:enable='gte(t,{_st_on:.2f})'")
        _colw = rw / float(max(1, len(stats)))
        _ufs = max(13, int(_vfz * 0.44))
        #   ★VF_DECK_CONTRAST_V1：大数字 / 单位 / 标签一律按"面"取色（过 |Δ|≥70）；accent 或卡面副色
        #   不达标就退回面上字色 —— 原来固定 acc/psb，在卡面 105~149 时只有 |Δ|=34/69，读不出。
        _ncol = acc if abs(_lum_of(acc, 255) - _faceS2) >= 70 else _onS
        _ucol = _ncol
        _lcol = _psbTok if abs(_lum_of(_psbTok, 255) - _faceS2) >= 70 else _force_alpha(_onS, 0.85)
        print('[VF] ★VF_DECK_CONTRAST_V1 风格=%s 数据卡面亮度=%.0f → 数字=%s 标签=%s（|Δ|≥70）'
              % (style, _faceS2, _ncol, _lcol))
        for _j, (_jv, _js, _jl) in enumerate(stats):
            _cx = _x + int(_colw * _j)
            _jv = str(_jv)
            _plain = _jv + str(_js)
            _vw = int(est_text_w(_plain, _vfz))
            _vx = _cx + max(6, int((_colw - _vw) / 2))
            _vy = _y + int(_sh2 * 0.16)
            _int_ok = bool(re.fullmatch(r'\d+', _jv or '')) and int(_jv or 0) >= 3
            if _int_ok:
                _iv = int(_jv)
                # ★VF_DECK_SPAN_V2：滚动 0.8~2.5s，且**必须在镜结束前滚完**（数据卡后移到 6.4s 后，
                #   固定时长会让成片结束时数字还没跳到终值 → "150万"永远显示不全）。
                _rollS = max(0.8, min(2.5, max(0.0, float(dur) - _st_on) * 0.75))
                _rate2 = _iv / max(_rollS, 0.1)
                # ⚠️ 计数起点必须是数据块入场那一刻（t-{_st_on}），不能从 t=0 起算
                out.append(
                    f"drawtext=fontfile='{_bold}':"
                    f"text='%{{eif\\:min(max(t-{_st_on:.2f}\\,0)*{_rate2:.1f}\\,{_iv})\\:d}}':"
                    f"fontsize={_vfz}:fontcolor={_ncol}:x={_vx}:y={_vy}:"
                    f"alpha='min(max(t-{_st_on + 0.10:.2f},0)/0.4,1){_br}'")
            else:
                out.append(f"drawtext=fontfile='{_bold}':text='{esc_text(_jv)}':fontsize={_vfz}:"
                           f"fontcolor={_ncol}:x={_vx}:y={_vy}:"
                           f"alpha='min(max(t-{_st_on + 0.10:.2f},0)/0.4,1){_br}'")
            if _js:
                out.append(f"drawtext=fontfile='{_bold}':text='{esc_text(_js)}':fontsize={_ufs}:"
                           f"fontcolor={_force_alpha(_ncol, 0.85)}:"
                           f"x={_vx + int(est_text_w(_jv, _vfz)) + max(2, int(_vfz * 0.08))}:"
                           f"y={_vy + int(_vfz * 0.72) - int(_ufs * 0.72)}:"
                           f"alpha='min(max(t-{_st_on + 0.22:.2f},0)/0.4,1)'")
            if _jl:
                out.append(f"drawtext=fontfile='{_reg}':text='{esc_text(_jl)}':fontsize={_lfz}:"
                           f"fontcolor={subc}:"
                           f"x={_cx + max(6, int((_colw - int(est_text_w(_jl, _lfz))) / 2))}:"
                           f"y={_y + int(_sh2 * 0.60)}:"
                           f"alpha='min(max(t-{_st_on + 0.30:.2f},0)/0.4,1)'")
        _y += _sh2

    # ⑦ 右下角页码 + 页内进度细线
    if page:
        _pwy = ry + rh - _plh - int(_pfs * 1.5)
        # ★VF_DECK_CONTRAST_V1 + ★VF_PAGENUM_CONTRAST_V1（2026-10-01 team-lead 实测
        #   「页码压在浅色玻璃面板上读不清」）：① 按"面"取色（`_deck_on_face`，|Δ|≥70）；
        #   ② alpha 提到 0.85（原来 0.60 被面一衬就发灰）；③ 加 1px 投影 → 任何面上都清楚。
        _pcol = _force_alpha(_onFace, 0.85)
        _psh = 'black@0.45' if _lum_of(_onFace, 255) >= 128 else 'white@0.35'
        out.append(f"drawtext=fontfile='{_reg}':text='{esc_text(page)}':fontsize={_pfs}:"
                   f"fontcolor={_pcol}:shadowcolor={_psh}:shadowx=1:shadowy=1:"
                   f"x={rx + rw - int(est_text_w(page, _pfs))}:y={_pwy}:"
                   f"alpha='min(max(t-0.90,0)/0.45,1)'")
    # 纯文字页里，render_shot 只会给"color= 底板"的卡补 A4 进度线；渐变风/玻璃的底板不是 color=（走
    #   gradients 源），所以这里自己补一条 —— 保证 6 套都有"页内进度线走完整页"这条持续动效。
    if region or grad or glass:
        out += progress_filters(W, H, dur, _force_alpha(acc, 0.78),
                                seg=max(6, int(min(14, dur * 3))),
                                y=ry + rh - _plh, h=_plh, x0=rx, w=rw)

    # ⑧ 版面"签名"装饰（三套各一个记号；全部低 alpha / 小面积）
    if grad:
        # 渐变风：底部一条极淡的强调色光晕（5 段 alpha 0.015→0.075）——
        #   面积虽大但几乎不可见，只在暗底上给一点暖色倾向：这就是"用透明度做设计"。
        _ah = max(6, int(H * 0.30 / 5))
        for _k in range(5):
            out.append(f"drawbox=x=0:y={max(0, H - (_k + 1) * _ah)}:w={W}:h={_ah + 1}:"
                       f"color={_force_alpha(acc, 0.015 * (_k + 1))}:t=fill")
        # 左上两条细发丝（一条 accent / 一条中性）：极克制的版面锚点
        out.append(f"drawbox=x={rx}:y={max(0, ry - int(H * 0.03))}:"
                   f"w={max(30, int(rw * 0.08))}:h={max(3, int(H * 0.006))}:"
                   f"color={_force_alpha(acc, 0.90)}:t=fill")
        out.append(f"drawbox=x={rx}:y={max(0, ry - int(H * 0.03) + max(6, int(H * 0.010)))}:"
                   f"w={max(18, int(rw * 0.05))}:h=2:color={_force_alpha(txc, 0.20)}:t=fill")
        out.append(f"drawbox=x={rx}:y={ry}:w={max(2, int(rw * 0.004))}:h={max(10, int(rh * 0.14))}:"
                   f"color={_force_alpha(acc, 0.50)}:t=fill")
    elif mono:
        # 极简：整版只有这一个 6px 强调色小方块（唯一一处颜色，面积最小 —— 留白才是主角）
        _sq = max(6, int(H * 0.010))
        out.append(f"drawbox=x={rx}:y={ry}:w={_sq}:h={_sq}:"
                   f"color={_force_alpha(acc, 0.95)}:t=fill")
    elif glass:
        # ★VF_DECK_STYLES2_V1「背景一层柔光渐变」：整幅一条极淡的竖向渐变 wash
        #   （gradA 0.08 → gradB 0.02；面积大但几乎不可见 —— 这就是"用透明度做设计"）。
        #   在素材页上它压住照片杂色、统一色调；在纯文字页上它叠在 gradients 底板上，更柔。
        #   ⚠️ 必须**插到最前**（out[:0] = ...）：drawbox 是"后画的压前面的"，
        #      若追加在末尾，wash 会盖在文字与卡片之上 → 整页被蒙一层（本机抽样会立刻看出来）。
        out[:0] = grad_box_filters(0, 0, W, H, _force_alpha(gA, 0.08), _force_alpha(gB, 0.02), steps=6)
        # 玻璃：左上两条发丝（一条 accent 0.55 / 一条白 0.16）+ 一枚小玻璃片 —— 全部小面积
        out.append(f"drawbox=x={rx}:y={max(0, ry - int(H * 0.03))}:"
                   f"w={max(30, int(rw * 0.075))}:h={max(2, int(H * 0.004))}:"
                   f"color={_force_alpha(acc, 0.55)}:t=fill")
        out.append(f"drawbox=x={rx}:y={max(0, ry - int(H * 0.03) + max(5, int(H * 0.008)))}:"
                   f"w={max(18, int(rw * 0.045))}:h=1:color={_force_alpha(lcC, 0.16)}:t=fill")
        _gsq = max(6, int(H * 0.012))
        out.append(f"drawbox=x={rx}:y={ry}:w={_gsq}:h={_gsq}:"
                   f"color={_force_alpha(str(th.get('cardBg2') or gA), 0.45)}:t=fill")
        out.append(f"drawbox=x={rx}:y={ry}:w={_gsq}:h=1:"
                   f"color={_force_alpha(lcC, 0.22)}:t=fill")
    elif soft:
        # 柔和拟物：一枚"凸起小方块"（右下暗 0.32 + 亮面 0.30 + 上沿亮线）+ 一条极淡栏线
        _ssq = max(6, int(H * 0.014))
        out.append(f"drawbox=x={rx + 1}:y={ry + 1}:w={_ssq}:h={_ssq}:"
                   f"color={_force_alpha(scC, 0.32)}:t=fill")
        out.append(f"drawbox=x={rx}:y={ry}:w={_ssq}:h={_ssq}:"
                   f"color={_force_alpha(str(th.get('cardBg2') or gA), 0.30)}:t=fill")
        out.append(f"drawbox=x={rx}:y={ry}:w={_ssq}:h=1:"
                   f"color={_force_alpha(lcC, 0.18)}:t=fill")
        out.append(f"drawbox=x={max(0, rx - int(rw * 0.03))}:y={ry}:w=1:h={rh}:"
                   f"color={_force_alpha(lcC, 0.10)}:t=fill")
    else:
        # 杂志：左侧一条通高细栏线（alpha 0.35）+ 顶部一条短粗线（栏目"标尺"）
        out.append(f"drawbox=x={max(0, rx - int(rw * 0.03))}:y={ry}:w=2:h={rh}:"
                   f"color={_force_alpha(acc, 0.35)}:t=fill")
        out.append(f"drawbox=x={rx}:y={max(0, ry - int(H * 0.025))}:w={max(30, int(rw * 0.10))}:"
                   f"h={max(3, int(H * 0.006))}:color={_force_alpha(txc, 0.55)}:t=fill")
    print('[VF] ★VF_DECK_STYLES_V1 风格=%s：kicker=%s 标题%d行 要点%d条 数据%d块 页码=%s（区域 %dx%d@%d,%d）'
          % (style, '有' if kicker else '无', len(_lines), len(items), len(stats), page or '无',
             rw, rh, rx, ry))
    return [p for p in out if str(p).strip()]


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


def _argv_of(inp):
    """★VF_LONGCMD_V1（2026-10-01）：「卡片给的输入参数字符串」→ argv 列表。

    为什么不用 shlex.split：posix 模式下反斜杠被当转义吃掉（`"C:\\Users\\a.jpg"` → `C:Usersa.jpg`），
    Windows 素材路径会直接找不到文件。这里只做"空格分词 + 剥掉成对双引号"，反斜杠原样保留；
    对本项目现有的三种 inp（lavfi / `-loop 1 -t N -i "图片"` / `-ss N -i "视频"`）都成立。"""
    out, cur, q = [], '', False
    for ch in str(inp or ''):
        if ch == '"':
            q = not q
            continue
        if ch == ' ' and not q:
            if cur:
                out.append(cur)
                cur = ''
            continue
        cur += ch
    if cur:
        out.append(cur)
    return out


def render_shot(shot, th, workdir, idx, W, H, fps, ffmpeg, still=None):
    # ★VF_MOTION_V2（2026-09-29）：把镜序注入 shot —— 各配方卡据此轮换运动（推近/拉远/静止），
    #   不再"每一镜都挂 ken burns"（反 AI 味清单里的一条）。用副本，不改调用方的数据。
    shot = dict(shot)
    shot['_idx'] = idx
    # ★VF_STYLE_V1（2026-09-30 收尾②）：允许**单镜覆盖主题**（shot['theme'] 写主题名/主题字典）。
    #   为什么要：自检要在一支片里同时冒烟 news / data 两套编辑风（不同主题的卡面 token 不一样）；
    #   正常链路（make.py / 服务端分镜）不写这个字段 → 行为与以前完全一致。
    #   查不到的名字走 theme_of 的兜底（绝不抛异常、绝不把整镜弄挂）。
    if shot.get('theme'):
        _th2 = theme_of(shot.get('theme'))
        if str(_th2.get('id') or '') or _th2.get('bg'):
            th = _th2
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
    # ★VF_SUSTAIN_V3（2026-10-01）：**纯文字卡**的定义要含"卡片自带的渐变底"。
    #   为什么：`deck-grad` / `deck-glass` 的底板是**卡片自己**给的
    #   （`-f lavfi -i gradients=...`，见 `_deck_board_inp`），原来只认 `color=` → 这两套 deck 页
    #   整段 ★VF_SUSTAIN_V2（入场/浮动/进度线）**全被跳过**；白杠一改成"极淡染色面"，
    #   它们的 8s 时间轴立刻掉到 `#..............#`（只剩首尾淡入淡出）。实测就是这条。
    #   现在的口径：`color=` 底 → 换 stage 质感底；`gradients=` 底 → **保留卡片自己的底板**
    #   （deck-grad 的"真渐变"是设计，不许被换掉），但入场/浮动/进度线**照加**。
    _pure_color = (isinstance(inp, str) and inp.startswith('-f lavfi -i color='))
    _pure_grad = (isinstance(inp, str) and inp.startswith('-f lavfi -i gradients='))
    if typ in ('title', 'list', 'number', 'compare', 'chart', 'end') and (_pure_color or _pure_grad):
        if _pure_color:
            _inp2, _deco = stage_layer(th, W, H, dur, grad_speed=FLOAT_GRAD_SPEED)
            inp = ' '.join(_inp2)
            vf = _deco + ',' + vf
            print('[VF] 文字卡 %s → 主题质感底（渐变 + 强调色装饰；★A6 渐变流速=%s）'
                  % (typ, FLOAT_GRAD_SPEED))
        else:
            print('[VF] 文字卡 %s → 保留卡片自带渐变底（deck 版式底板），照加入场/浮动/进度线' % typ)
        # ★VF_MOTIONPPT_V1（2026-09-30）：纯文字卡的【整块版式】入场滑入（pad+crop，逐帧）。
        #   只加在纯文字卡（有素材的镜已有 Ken Burns 轮换，再整体位移会打架）；默认开但极克制
        #   （0.25~0.5s / 位移 3.5%H），shot['enter']='none' 可单镜关。拼在【卡链尾部】：
        #   这样连同 stage 装饰一起滑入 = "整块版式推上来"，再往后才是 render_shot 的 fade in/out。
        _ef = ppt_enter_filters(shot, th, W, H, dur)
        if _ef:
            vf = vf + ',' + ','.join(_ef)
            print('[VF] 文字卡 %s → 整块版式入场滑入（enter=%s）' % (typ, enter_of(shot)))
        # ★VF_SUSTAIN_V2（2026-10-01）A5：整块版式**横向浮动**（整镜持续）——治"整页几个大字、后面 5 秒不动"。
        #   位置刻意选在【进度线之前】：进度线是"钉在画面底部"的，先浮动再画线，线就不会被裁出画面。
        _fm = float_motion_filters(shot, th, W, H, dur)
        if _fm:
            _per = float(_fm[1].split('/')[-1].split(')')[0])
            print('[VF] 文字卡 %s → 整块横向浮动（持续动效 A5，幅度 %dpx / 周期 %.1fs %s）'
                  % (typ, int(round(W * FLOAT_AMP_RATIO)), _per,
                     '· 成品风格指定' if shot.get('_float_per') else '· 按镜序轮换'))
            vf = vf + ',' + ','.join(_fm)
        # ★VF_SUSTAIN_V1 A4（2026-10-01）：纯文字卡底部一条**走完整镜**的进度细线（常驻动效）。
        #   为什么放在 render_shot 这一层：一处接线就覆盖全部纯文字卡（title/list/number/compare/
        #   chart/end 以及 deck 页），不必去改 6 个卡型；有素材的镜不加（那边靠浮动/Ken Burns）。
        if sustain_of(shot):
            _pfs = progress_filters(W, H, dur, str(th.get('accent') or '0xff6b35') + '@0.80',
                                    seg=max(6, int(min(20, float(dur or 3) * 3))))
            if _pfs:
                vf = vf + ',' + ','.join(_pfs)
                print('[VF] 文字卡 %s → 底部进度细线（持续动效 A4，%d 段走完整镜）' % (typ, len(_pfs)))
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
    # ★VF_ARGV_V1（2026-10-01 team-lead 定案「治本」）：ffmpeg 调用一律走**参数数组、不经过 shell**。
    #   为什么必须治本（线上实测，老板报过三次"空色块"）：原来把整条滤镜串拼成 shell 字符串 + `shell=True`
    #   走 /bin/sh，双引号里 `\\%` 被 shell 吃成 `\%` → ffmpeg 收到**裸 `%`** → 报 `Stray %` →
    #   该 drawtext 一个字都不画（**同串的 drawbox 照画 = 有框无字**，正是"空色块"）。
    #   ⚠️ Windows 的 cmd.exe **不处理反斜杠** → 本机怎么测都正常，这是它长期没被查出的根因。
    #   esc_text 的 `%` 仍是**两层** `\\%`（不改）——argv 下没有 shell 那一层，两层正好是
    #   ffmpeg 滤镜解析（第 1 层）+ drawtext 展开语法（第 2 层）所需要的转义层数。
    # ★VF_LONGCMD_V1（2026-10-01「deck-grad 素材页整镜渲染失败」的 cmd.exe 8191 上限问题）
    #   也一并被这次改动**根治**：argv 走 CreateProcess（上限 32767），所以"超长才切数组"的分支删掉了。
    # ★VF_SHOT_GUARD_V1（2026-09-22，用户实测「180 秒出 30 秒」）保持不变：
    #   返回码 + ffprobe 真实时长双校验；异常自动重试一次；仍不行就明确报错。
    _argv = ([ffmpeg, '-y'] + _argv_of(inp) + ['-vf', vf2]
             + (['-an'] if typ in ('video', 'aivideo') else [])
             + venc_argv(W, H) + ['-r', str(fps), '-t', str(dur), out])
    # ★VF_PPTPREVIEW_V1（2026-10-01 老板：「完全成片之前能把PPT抽出来审核一下效果吗？」）：
    #   `still=(秒, png路径)` → 不渲整段视频，只在"内容全就位"那一帧求值、落一张 PNG。
    #   关键：**复用上面那条一模一样的滤镜链**（同一个函数、同一份 deck_*/stage/enter/float/进度线逻辑），
    #   只在**链尾**加 `trim=start=T`（trim 之前的所有 t 表达式都还在**原始时间轴**上求值 →
    #   浮动相位 / enable 分段 / 入场位移 / 数字滚动 都是 T 时刻的真实状态），再出 1 帧。
    #   ⚠️ 不能用 `-ss T -i`（输入端 seek）：那会把帧时间戳重置到 0 → sin(t/4) 之类的相位全错。
    if still:
        _st = float(still[0])
        _png = still[1]
        _vfs = vf2 + ',trim=start=%.3f,setpts=PTS-STARTPTS' % _st
        _sargv = ([ffmpeg, '-y'] + _argv_of(inp) + ['-vf', _vfs]
                  + ['-frames:v', '1', _png])
        _sr = subprocess.run(_sargv, capture_output=True, text=True,
                             encoding='utf-8', errors='replace')
        if _sr.returncode != 0 or not os.path.exists(_png):
            print('[VF] ⚠️ PPT 抽帧失败（第 %d 镜 / t=%.2fs）：%s'
                  % (idx + 1, _st, err_lines(_sr.stderr) or ('rc=%s' % _sr.returncode)))
        return _png
    _target = float(dur)
    for _try in (1, 2):
        if os.path.exists(out):
            try:
                os.remove(out)
            except Exception:
                pass
        r = subprocess.run(_argv, capture_output=True, text=True,
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
    # ★VF_ARGV_V1：输入也用参数数组（不走 shell）—— 见 render_shot 的 ★VF_ARGV_V1 说明
    _ins = []
    for p in files:
        _ins += ['-i', os.path.abspath(p).replace('\\', '/')]
    parts, prev, acc = [], '0:v', float(durs[0])
    for i in range(1, n):
        off = max(0.0, acc - xd)
        lab = 'x%d' % i
        parts.append('[%s][%d:v]xfade=transition=fade:duration=%.2f:offset=%.2f[%s]'
                     % (prev, i, xd, off, lab))
        prev, acc = lab, off + float(durs[i])
    fc = ';'.join(parts)
    exp = acc
    # ★VF_ARGV_V1：参数数组（不过 shell）
    _argv = ([ffmpeg, '-y'] + _ins + ['-filter_complex', fc, '-map', '[%s]' % prev]
             + venc_argv(W, H) + ['-r', str(fps), out])
    try:
        r = subprocess.run(_argv, capture_output=True, text=True,
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
    # ★VF_ARGV_V1：写 **绝对路径**。concat 解复用器把 list 里的相对路径按【list 文件所在目录】
    #   解析（不是按 cwd）→ workdir 一旦是相对路径就会被拼两遍 → `Impossible to open`。
    #   （本机实测：--workdir dist-rel/_x 时 list 里出现 dist-rel/_x\dist-rel/_x\shot00.mp4）
    with open(lst, 'w', encoding='utf-8') as f:
        for p in files:
            f.write("file '%s'\n" % os.path.abspath(p).replace('\\', '/'))
    out = os.path.join(workdir, 'merged.mp4')
    # ★VF_ARGV_V1：参数数组（不过 shell）
    _argv = ([ffmpeg, '-y', '-f', 'concat', '-safe', '0', '-i', lst]
             + venc_argv(W, H) + ['-r', str(fps), out])
    _exp = float(expect_sec or 0)
    _keystr = ('Impossible to open', 'Invalid data found', 'Input/output error', 'No such file')
    for _try in (1, 2):
        if os.path.exists(out):
            try:
                os.remove(out)
            except Exception:
                pass
        r = subprocess.run(_argv, capture_output=True, text=True,
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


# ★VF_BANNER_EMPTY_V1（2026-09-30）：不可见字符集合（零宽/BOM/变体选择符/软连字符）——
#   Python 的 str.strip() **不认**它们（'\u200b'.strip() == '\u200b'），这正是"空色块"的根因。
_BANNER_INVIS = '\u200b\u200c\u200d\u200e\u200f\u2060\ufeff\ufe0e\ufe0f\u00ad'


def _banner_clean(s):
    """顶部固定标题的"可见内容"判空：剥掉零宽/BOM/变体选择符 + 普通空白。
    返回剥完的字符串；为空 = 这行没有"看得见的内容"→ 调用方整块不画。★VF_BANNER_EMPTY_V1"""
    t = str(s or '')
    for _ch in _BANNER_INVIS:
        t = t.replace(_ch, '')
    return t.strip()


def banner_layer(banner, th, W, H, dur, font):
    """顶部固定两行标题的滤镜串（第 1 行大号+黑描边；第 2 行半透明色块+白字）。
    返回 '' 表示不画。范围用 banner['_range']=(start秒, end秒)，不给=整片。"""
    if not isinstance(banner, dict):
        return ''
    # ★VF_BANNER_EMPTY_V1（2026-09-30 修用户实测 bug：第 2 行只剩一个【空色块】、字没了）：
    #   根因：判空只做了 .strip()；而 AI/上游可能给出【零宽/不可见字符】（U+200B / U+FEFF 等）——
    #   str.strip() 不认它们 → l2 非空 → 走"画色块 + 画白字"：色块画出来了，白字是零宽字符 = 看不见
    #   → 用户看到的就是一个挂在第 1 行下面的空色块。修法：先 _banner_clean 剥掉所有不可见字符再判空；
    #   剥完为空 → 色块与文字【整块都不画】。
    #
    # ★VF_BANNER_EMPTYLINE_V1（2026-10-01 team-lead 要求"逐行判空"）——把"整行判空"做成**逐行**口径：
    #   ① 每一行各自判空（剥不可见字符 + strip()）——为空的行：不画 box、不画 text、**也不占行高**；
    #   ② 【只有一行非空】：非空行**顶到 y1**（不再在它上面留出"空第 1 行"的行距，否则看着像漏了个框）；
    #   ③ 【两行都空】：整块不生成 —— 返回 ''，并打一行日志（便于排查"留档里有 banner、出片却没画"）。
    #   ⚠️ 只有"两行都真有字"时的输出必须与改前**逐字一致**（自测 vf-style-selftest.py 有硬断言）。
    #   历史背景：老板两次报"顶部白字下面紧贴一个黑色实心空矩形"（dist-rel/fixbase/top_t0020.png）；
    #   根因就是空行照样被画了底衬框（框宽 = est_text_w(l2)+2*pad，l2 为空/零宽时退化成一个小固定宽度黑块）。
    l1 = _banner_clean(banner.get('line1'))
    l2 = _banner_clean(banner.get('line2'))
    _raw1 = str(banner.get('line1') or '')
    _raw2 = str(banner.get('line2') or '')
    if not l1 and _raw1:
        print('[VF] 固定标题第 1 行只有空白/不可见字符 → 不画（原值=%r）' % _raw1[:24])
    if not l2 and _raw2:
        print('[VF] 固定标题第 2 行只有空白/不可见字符 → 不画色块（原值=%r）' % _raw2[:24])
    if not l1 and not l2:
        print('[VF] 固定标题：两行都无可见内容 → 整块不生成（line1=%r line2=%r）' % (_raw1[:24], _raw2[:24]))
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
        # ★VF_BANNER_EMPTYLINE_V1：「只有第 2 行」时不要再在它上面留出"空第 1 行"的行距（顶到 y1）；
        #   两行都有字 → _y2 表达式与改前**逐字一致**（零回归）。
        _y2 = (y1 + fs1 + int(fs1 * 0.30)) if l1 else y1
        # ★VF_BANNER_FIT_V1（2026-09-30）：超长第 2 行**先缩字号、再截断**，绝不让色块/文字溢出画幅。
        #   旧写法宽度直接按 est_text_w 算 → 长文案时色块宽过画布被裁、白字跑到画外（用户要的"折行或缩字号"）。
        _pad2 = _pad
        while fs2 > 16 and est_text_w(l2, fs2) + 2 * _pad2 > W * 0.94:
            fs2 = int(fs2 * 0.94)
            _pad2 = max(8, int(fs2 * 0.32))
        while l2 and est_text_w(l2, fs2) + 2 * _pad2 > W * 0.94:
            l2 = l2[:-1]
        _bw = int(est_text_w(l2, fs2) + _pad2 * 2)
        _bx = max(0, int((W - _bw) / 2))
        parts.append(f"drawbox=x={_bx}:y={max(0, _y2 - _pad2 // 2)}:w={_bw}:h={fs2 + _pad2}:"
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
    # ★VF_ARGV_V1：参数数组（不过 shell）
    _argv = ([ffmpeg, '-y', '-i', src, '-vf', vf]
             + venc_argv(W, H) + ['-c:a', 'copy', out])
    try:
        r = subprocess.run(_argv, capture_output=True, text=True,
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
                # ★VF_SUBSPLIT_V1（2026-09-30）：字幕**最多 2 行**（超长先降字号、还不行就截断+「…」）
                #   旧逻辑 `flat[i:i+wrap]` 行数无上限 → 257 字 / 16 字一行 = 17 行 → 铺满整屏。
                rows, _rf = _sub_rows(flat, W, font_size, wrap)
                if len(flat) > max(1, int(wrap)) * 2:
                    print('[VF] ⚠️ 第 %d 镜字幕过长（%d 字）→ 缩字号/最多 3 行压缩显示（★不截断、不丢字）'
                          % (_i + 1, len(flat)))
                segs = []
                for ri, r in enumerate(rows):
                    if ri:
                        segs.append('\\N')
                    segs.extend(['{\\k%d}%s' % (per, c) for c in _ass_esc(r)])
                _fs_tag = ('{\\fs%d}' % int(_rf)) if int(_rf) != int(font_size) else ''
                lines.append('Dialogue: 0,%s,%s,Def,,0,0,0,,%s%s'
                             % (_ass_ts(_st), _ass_ts(_en), _fs_tag, ''.join(segs)))
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


def burn_subtitles(video, srt, out, ffmpeg, font_size=26, W=0, H=0):
    """把字幕烧进画面（SRT 白字黑描边；ASS 保留自带样式与逐字高亮）

    ★VF_BITRATE_V1：这里也是**最后一道视频重编码**（烧字幕），所以同样走 `venc_args(W,H)`
      —— 否则前面给足了质量、最后一道又压回 353kbps，等于白改。W/H 缺省 0 → CRF 20。"""
    sp = esc_path(os.path.abspath(srt))
    # ★VF_ARGV_V1：参数数组（不过 shell）—— 整条 -vf 作为**一个 argv 元素**传给 ffmpeg，
    #   不再被 shell 二次解析（这正是 `%` 会丢字的根因，见 render_shot 的 ★VF_ARGV_V1 说明）。
    if str(srt).lower().endswith('.ass'):
        # ★VF_KARAOKE_V1：ASS 自带样式（含 \\k 逐字高亮与字体名），不能再 force_style 覆盖
        _vf = "subtitles='%s'" % sp
    else:
        # ★VF_LINUX_V1：字幕字体名按平台选（Linux 上没有 Microsoft YaHei → 中文会变方块）
        style = ("FontName=%s,FontSize=%d,PrimaryColour=&H00FFFFFF,"
                 "OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=0,"
                 "Alignment=2,MarginV=40") % (sub_font_name(), font_size)
        _vf = "subtitles='%s':force_style='%s'" % (sp, style)
    _argv = ([ffmpeg, '-y', '-i', video, '-vf', _vf]
             + venc_argv(W, H) + ['-c:a', 'copy', out])
    r = subprocess.run(_argv, capture_output=True, text=True,
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
    # ★VF_ARGV_V1：-t / -movflags 都改成**参数数组片段**（不过 shell）
    _targv = (['-t', '%.3f' % _t]) if _pin else []
    # ★VF_FASTSTART_V1（2026-09-22，用户实测「播放 3~4 秒必卡一下」）：
    #   生成的 mp4 默认把 moov（索引）写在**文件尾部** → 浏览器边下边播时必须先 Range 取文件尾，
    #   取不到就周期性停顿（"播几秒卡一下"）。`+faststart` 把 moov 挪到文件开头，
    #   这是渐进式播放的标准做法；只搬索引、不重编码，2~3MB 的片子几乎零耗时。
    _fargv = ['-movflags', '+faststart']
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
            # ★VF_ARGV_V1：参数数组（不过 shell）
            _rc = subprocess.run([ffmpeg, '-nostdin', '-y', '-i', video, '-c', 'copy']
                                 + _fargv + [out],
                                 capture_output=True, text=True,
                                 encoding='utf-8', errors='replace')
            if (not os.path.exists(out)) or os.path.getsize(out) < 1024:
                raise RuntimeError(err_lines(_rc.stderr) or 'remux 失败')
            print('[VF] 无人声无 BGM → remux（+faststart）')
        except Exception as eF:
            print('[VF] ⚠️ faststart remux 失败（%s）→ 退回直接复制' % str(eF)[:80])
            shutil.copyfile(video, out)
        _verify_dur()
        return out
    # ★VF_ARGV_V1：全部改成**参数数组**（不过 shell），语义与旧 shell 字符串逐项等价。
    _vg = [ffmpeg, '-nostdin', '-y', '-i', video]
    if has_voice and has_bgm:
        # ★2026-09-20：把走过的分支打出来 —— 否则“选了配乐到底混没混进去”无法从日志判定
        print('[VF] 混音：人声 + BGM（BGM 音量 0.12，-stream_loop 循环铺底）')
        _voc = '[1:a]apad[voc]' if _pin else '[1:a]volume=1.0[voc]'
        _argv = (_vg + ['-i', audio, '-stream_loop', '-1', '-i', bgm,
                        '-filter_complex',
                        _voc + ';[2:a]volume=0.12[bg];'
                               '[voc][bg]amix=inputs=2:duration=first:'
                               'dropout_transition=0:normalize=0[aout]',
                        '-map', '0:v', '-map', '[aout]', '-c:v', 'copy', '-c:a', 'aac']
                 + _targv + _fargv + [out])
    elif has_voice:
        if _pin:
            print('[VF] 混音：仅人声（无 BGM）')
            _argv = (_vg + ['-i', audio,
                            '-filter_complex', '[1:a]apad[aout]',
                            '-map', '0:v', '-map', '[aout]',
                            '-c:v', 'copy', '-c:a', 'aac']
                     + _targv + _fargv + [out])
        else:
            print('[VF] 混音：仅人声（无 BGM）')
            _argv = (_vg + ['-i', audio, '-c:v', 'copy', '-c:a', 'aac', '-shortest']
                     + _fargv + [out])
    else:
        print('[VF] 混音：仅 BGM（无人声，音量 0.18）')
        _argv = (_vg + ['-stream_loop', '-1', '-i', bgm,
                        '-filter_complex', '[1:a]volume=0.18[aout]',
                        '-map', '0:v', '-map', '[aout]', '-c:v', 'copy', '-c:a', 'aac']
                 + (_targv if _pin else ['-shortest']) + _fargv + [out])
    r = subprocess.run(_argv, capture_output=True, text=True,
                       encoding='utf-8', errors='replace')
    if not os.path.exists(out):
        raise RuntimeError('混音失败: ' + (err_lines(r.stderr) or (r.stderr or '')[-400:]))
    # ★VF_MUX_FIX_V1：校验成片真实时长 ≈ 分镜总时长（差 >1% 拒绝交付）
    _verify_dur()
    return out


# ══════════════ ★VF_PPTPREVIEW_V1（2026-10-01）「完全成片之前能把PPT抽出来审核一下效果吗？」══════════════
# 老板原话就是这一句。落法：`--ppt-preview` → 每镜出一张 **PNG**（编号 = 镜序，p01/p02…）+ 一份 index.json。
# 三条硬口径：
#   ① **复用出片用的同一套渲染代码**（直接调 `render_shot(..., still=(t, png))`，同函数、同 deck_*/stage/
#      enter/float/进度线逻辑）—— 绝不另写一份"预览专用渲染"，否则预览与成片必然漂移。
#   ② 只渲 **1 帧**（链尾 trim 到"内容全就位时刻"求值），不渲整段视频 → 快。
#   ③ 不烧字幕、不烧顶部固定标题（那两者是出片后另加的覆盖层；审的是画面/PPT 版式本身）。
SETTLE_RATIO = 0.62          # "内容全就位"≈ 镜长的 62%（入场 0.5s + 逐条插入 + 数字滚动 0.66×dur 都已完成）
SETTLE_MIN = 1.2
SETTLE_TAIL = 0.45           # 留出镜尾淡出的余量（不要取到 fade out 里）


def ppt_burn_banner_still(png, banner, th, W, H, dur, ffmpeg, t_global):
    """★VF_PPTPREVIEW_BANNER_V1（2026-10-01 team-lead，可选）：把**顶部固定标题**烧到抽帧 PNG 上。

    为什么要：老板要审"整体观感"时 banner 也在画面里（他那个"空色块"事故就是 banner 的）；
    但 `--ppt-preview` 默认**不含** banner（口径：审的是 PPT 版式本身）→ 所以做成 `--with-banner` 开关，
    **默认不加、不破坏现有行为**。
    实现要点：**复用同一个 `banner_layer()`**（绝不另写一份 banner 绘制），只是把"时间区间"
    换成"这一帧落在区间里就按整段可见求值"（单帧不需要 between 表达式）。
    就地覆盖 png（先写临时文件再 replace，避免半截文件）。
    """
    if not isinstance(banner, dict):
        return png
    _rng = banner.get('_range')
    try:
        if isinstance(_rng, (list, tuple)) and len(_rng) == 2 \
                and not (float(_rng[0]) <= float(t_global) <= float(_rng[1])):
            return png                       # 这一镜不在固定标题的显示区间 → 这一帧也不该有
    except Exception:
        pass
    _b2 = {k: v for k, v in banner.items() if k != '_range'}
    _vf = banner_layer(_b2, th, W, H, dur, esc_path(find_font(th.get('font', 'msyh'))))
    if not _vf:
        return png
    _tmp = png + '.bn.png'
    try:
        r = subprocess.run([ffmpeg, '-y', '-i', png, '-vf', _vf, '-frames:v', '1', _tmp],
                           capture_output=True, text=True, encoding='utf-8', errors='replace')
        if r.returncode == 0 and os.path.exists(_tmp):
            os.replace(_tmp, png)
        else:
            print('[VF] ⚠️ 预览抽帧烧固定标题失败（第 %s 帧）：%s'
                  % (os.path.basename(png), err_lines(r.stderr) or ('rc=%s' % r.returncode)))
    except Exception as _e:
        print('[VF] ⚠️ 预览抽帧烧固定标题异常（忽略）：%s' % str(_e)[:90])
    return png


def _ppt_settle_t(dur):
    """★VF_PPTPREVIEW_V1：「内容全就位」时刻（秒）。
    口径：入场位移（≤0.5s）、要点逐条插入、数字滚动（≈0.66×镜长）都已完成，但还没进镜尾淡出。
    短镜兜底 ≥1.2s、且必须早于 `dur-0.45`（否则会取到淡出/黑帧）。"""
    d = max(0.6, float(dur or 3))
    return round(min(max(SETTLE_MIN, d * SETTLE_RATIO), d - SETTLE_TAIL), 2)


def _preview_text(shot, typ):
    """★VF_PPTPREVIEW_V1：index.json 里的 `text` = 这一页**真正的主视觉文字**。
    为什么要单独判：number 卡的主视觉是【大数字】，list/chart 的主视觉是【标题】——
    直接套 `_big_text()` 会给出"字幕兜底文字"，老板审图时会以为画面画错了。"""
    if typ == 'number':
        return (str(shot.get('value')) + str(shot.get('suffix') or '')).strip()
    if typ in ('list', 'chart'):
        return str(shot.get('title') or _big_text(shot))
    return _big_text(shot)


def _preview_variant(shot, typ):
    """★VF_PPTPREVIEW_V1：index.json 里报**渲染层实际生效**的 variant。
    为什么不直接照抄 shot['variant']：老板就是被"留档里 variant 全为 null"误导过
    （他选了画面模版却看不到，因为那些镜根本不是 deck 页）→ 预览必须告诉他"这一镜实际按哪套画"。"""
    if typ == 'title':
        return variant_of(shot, TITLE_VARIANTS, 'center')
    if typ == 'list':
        return variant_of(shot, LIST_VARIANTS, 'steps')
    if typ == 'compare':
        return variant_of(shot, COMPARE_VARIANTS, 'split')
    return str(shot.get('variant') or '').strip().lower()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--storyboard', default='')
    ap.add_argument('--out', default='')
    ap.add_argument('--workdir', default='')
    # ★VF_PPTPREVIEW_V1：出片前抽帧审图（每镜 1 张 PNG + index.json；不渲整段视频）
    ap.add_argument('--ppt-preview', action='store_true',
                    help='出片前把每一镜抽成 p01.png/p02.png… + index.json（复用出片同一套渲染代码）')
    ap.add_argument('--outdir', default='', help='--ppt-preview 的输出目录（默认 <工作目录>/ppt-preview）')
    # ★VF_PPTPREVIEW_BANNER_V1：预览是否连"顶部固定标题"一起出（**默认关** → 老行为零变化）
    ap.add_argument('--with-banner', action='store_true',
                    help='--ppt-preview 时把顶部固定标题也烧进抽帧（默认不烧；老板审"整体观感"时用）')
    # ★VF_AI_STYLE_KEY_V1（2026-10-01 防御纵深）：AI 制片线的"画面风格"标签（cinematic/commercial/…）。
    #   ⚠️ 渲染层**不消费**它（它只影响 make.py 的 H3 画面风格提示词，见 make.py::_ai_style_en）。
    #   这里唯一目的 = **别让 argparse 把它当 unknown argument 直接 exit 2**：上游（服务端/脚本）若顺手
    #   透传下来，整片渲染会当场失败。所以"收下但不用"：不改 theme、不改 deck_style
    #   （成品风格只认 apply_style 的 5 套 key）。
    ap.add_argument('--ai-style', default='',
                    help='（收下但忽略）AI 制片线画面风格标签；渲染层不消费，仅供 make.py 的 H3 用')
    # ★VF_STYLES_V1（2026-10-01）：成品风格（10 主题 × 6 版式 → 5 套人话名字）。
    #   不给则看分镜根级 `style`；都没有 → 老行为（只认 theme / deck_style 两个字段）。
    ap.add_argument('--style', default='',
                    help='成品风格（5 套）：%s；可用中文名。**不传 / 认不出 = 不干预**'
                         '（保留分镜自己的 theme/deck_style，绝不回落默认）'
                         % '/'.join([s[0] for s in style_names()]))
    ap.add_argument('--list-styles', action='store_true', help='列出 5 套成品风格后退出')
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

    # ★VF_STYLES_V1：`--list-styles` 只打印、不渲染（不需要 ffmpeg/字体，方便服务端与老板直接看）
    if a.list_styles:
        print('★VF_STYLES_V1 成品风格（theme × deck 版式 × 动效节奏）：')
        for _sid, _nm, _ds in style_names():
            _st = STYLES[_sid]
            print('  %-11s %-6s theme=%-8s deck=%-10s period=%.1fs enter=%-4s%s'
                  % (_sid, _nm, _st['theme'], _st['deck'], _st['period'], _st['enter'],
                     '  ← 默认' if _st.get('default') else ''))
            print('              %s' % _ds)
        return

    ffmpeg = find_ffmpeg()
    # ★VF_ENVINFO_V1（2026-09-30 用户定案「出片改本地我们仔细讨论一下」的**第 1 步：可观测**）：
    #   "能不能本地出片"不该靠猜 —— 每次渲染把【真正用到的执行环境】打进行日志（会进任务文件 tail）：
    #   python / ffmpeg / ffprobe / 中文字体（常规 + 粗体）/ 操作系统。
    #   为什么先做这个、而不是直接做"本地渲染"：本地化最大的坑是【两端字体不同 → 折行与字号都变】
    #   与【脚本版本漂移】；先把这五条打成"可比较的字符串"，两端跑同一份分镜就能一眼看出差异。
    #   注：只打印、不改行为（找不到的项如实写"未找到"，绝不抛错）。
    try:
        print('[VF][环境] python=%s  os=%s' % (sys.version.split()[0], sys.platform))
        print('[VF][环境] ffmpeg=%s' % (ffmpeg or '未找到 ❌'))
        _fdir = os.path.dirname(ffmpeg or '')
        _fp = ''
        if _fdir:
            _cand = os.path.join(_fdir, 'ffprobe' + ('.exe' if os.name == 'nt' else ''))
            _fp = _cand if os.path.exists(_cand) else ''
        print('[VF][环境] ffprobe=%s' % (_fp or '（与 ffmpeg 同目录未找到 → 用 PATH）'))
        for _fk in ('msyh', 'msyhbd'):
            print('[VF][环境] 字体 %s=%s' % (_fk, find_font(_fk) or '未找到 ❌'))
    except Exception as _eEnv:
        print('[VF][环境] 打印失败（忽略）: %s' % str(_eEnv)[:80])

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
        # ★VF_FILTERJOIN_V1（2026-09-30 线上事故后补的自检盲区）：
        #   事故：用户第 8 镜 bgimage 崩「No such filter: ''」。查下来**自检从来抓不到**，原因很讽刺 ——
        #   自检用的测试图是 ffmpeg 画的**纯色**（flat≈1.0）→ 被判「素材自带内容多」→ 永远走"底衬带"那条路；
        #   而崩的是**普通照片（非满字）**那条路（`_band_box` 为空串 + 当时带尾逗号 → 拼出空滤镜）。
        #   现在再造一张**渐变图**（非满字 → 走另外半条路），两条路都纳进自检 —— 以后任一条断了自检就红。
        _testimg2 = ''
        try:
            _tp2 = os.path.join(wd, 'selftest-src2.jpg')
            subprocess.run([ffmpeg, '-v', 'error', '-y', '-f', 'lavfi',
                            '-i', 'gradients=s=640x360:c0=0x2b4a5a:c1=0x9ab0c0', '-frames:v', '1', _tp2],
                           capture_output=True, timeout=30)
            if os.path.exists(_tp2):
                _testimg2 = _tp2
        except Exception:
            _testimg2 = ''
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
        # ★VF_FILTERJOIN_V1：第二张素材图 = **渐变图**（非满字）→ 走"没有全宽底衬带"的那条滤镜链，
        #   也就是 2026-09-30 线上崩「No such filter: ''」的那条。造图失败就降级成 title，不能把自检弄崩。
        _bgshot2 = ({"type": "bgimage", "src": _testimg2, "text": "普通照片",
                     "subtitle": "这一镜验证非满字素材（无底衬带）的滤镜链", "dur": 3.0}
                    if _testimg2 else
                    {"type": "title", "text": "普通照片（造图失败，已跳过）",
                     "subtitle": "这一镜验证非满字素材（无底衬带）的滤镜链", "dur": 3.0})
        sb = {
            "size": [1280, 720], "fps": 25,
            "theme": {"bg": "0x0a1620", "text": "white", "accent": "0xff6b35", "font": "msyh"},
            "shots": [
                {"type": "title", "text": "AI Marketing 自检", "subtitle": "这是一条自检视频", "dur": 2.5},
                _bgshot,
                # ★VF_FILTERJOIN_V1：非满字素材镜（渐变图）—— 覆盖"无底衬带"的滤镜链（线上崩过那条）
                _bgshot2,
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
                # ★VF_STYLE_V1（2026-09-30 收尾②）：news / data 两套编辑风的**最小冒烟**。
                #   目的不是审美，而是"这两套风格进了自检，以后谁改坏了（kicker/信息卡/大数字/英文副标）立刻红"。
                #   ⚠️ 故意**加在最后 2 镜** → 前面 10 镜的镜序不变、第 3 镜"非满字素材"回归完全不受影响。
                #   单镜主题靠 shot['theme'] 覆盖（render_shot 已支持 theme_of 兜底）。
                {"type": "title", "theme": "news", "text": "编辑风自检", "kicker": "自检",
                 "en": "style smoke test", "dur": 2.5, "subtitle": "新闻资讯风格冒烟自检"},
                {"type": "number", "theme": "data", "value": 128, "suffix": "%", "label": "自检覆盖",
                 "dur": 2.5, "subtitle": "科技数据风格冒烟自检"},
            ],
        }
        print('[VF] 自检分镜 = %d 镜（第 2/3 镜=素材链路回归；末 2 镜=news/data 编辑风冒烟）'
              % len(sb.get('shots', [])))
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
    # ★VF_STYLES_V1（2026-10-01）：成品风格（--style 或分镜根级 `style`）——
    #   **必须在 theme_of / apply_deck_style 之前**：它要先把 theme + deck_style + 动效节奏落到分镜上。
    #   不传 → 一个字都不动（老链路零回归）。
    # ⚠️ ★VF_STYLES_STRICT_V1：这里**只**读"成品风格"（`--style` CLI 或 plan 根级 `style`），
    #   而且 `apply_style` 只认 5 个 id/中文名 —— 认不出就一个字段都不动。
    #   **绝对不要**在这里读 `ai_style`：那是 AI 制片线（make.py / vf-aivideo.ts）的"画面风格"标签
    #   （cinematic/commercial/…），与本层的 5 套成品风格是两码事。加进来就会把 AI 制片线
    #   静默改成 news 蓝 + deck（2026-10-01 撞车事故就是这条，别再犯）。
    _style = str(a.style or sb.get('style') or '').strip()
    if _style and not a.selftest:
        apply_style(sb, _style)
    # ★VF_AI_STYLE_KEY_V1：给了 --ai-style 只打一条"我不消费"的日志（绝不落进 theme/deck_style）
    if str(getattr(a, 'ai_style', '') or '').strip():
        print('[VF] ★VF_AI_STYLE_KEY_V1 收到 --ai-style=%r → **渲染层不消费**'
              '（它只影响 make.py 的 H3 画面风格提示词；成品风格只认 --style/根级 style 的 5 套 key）'
              % str(getattr(a, 'ai_style')).strip())
    # ★VF_THEMES_V1（2026-09-29）：主题名/主题字典都接受（字符串走 themes.py 查表，不认识回默认主题）
    th = theme_of(sb.get('theme'))
    # ★VF_STYLE_V1（2026-09-30 ②）：打一行主题日志 —— 一眼看出这次到底走了哪套风格（news/data = 编辑风版式）
    print('[VF] 主题 = %s（%s）%s' % (th.get('id') or '?', th.get('desc') or '',
                                     ' · 编辑风版式（kicker/横条/大编号/细线）' if _is_editorial(th) else ''))

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
    # ★VF_STYLE_V1（2026-09-30 ④文字按实际画幅算）：把【画幅 + 素材原始分辨率 + 最终字号】打一条日志
    #   （只打一条，不刷屏）—— 用户实测"统一按竖屏分辨率配的字"，这条日志能直接对比横竖屏的字号差。
    try:
        _or = '横屏' if (W / float(H or 1)) >= 1.2 else ('竖屏' if W < H else '方形')
        _sw, _sh = (0, 0)
        for _s in sb.get('shots', []):
            _p = _s.get('src')
            if _p and os.path.exists(str(_p)):
                _sw, _sh = _probe_size(_p)
                if _sw:
                    break
        print('[VF][字号] 画幅=%dx%d（%s）· 素材原始分辨率=%s · 默认大字=%dpx%s'
              % (W, H, _or, ('%dx%d' % (_sw, _sh)) if _sw else '无素材',
                 big_fs(W, H, 0.10, 44), '（横屏系数 ×1.40）' if _or == '横屏' else ''))
    except Exception as _eFs:
        print('[VF][字号] 打印失败（忽略）: %s' % str(_eFs)[:80])
    files = []
    _total_dur = 0.0
    anti_ai_check(sb.get('shots', []))   # ★VF_ANTIAI_V1：渲染前"反 AI 味"自检（只告警，不改画面）
    # ★VF_VARIANT_V1（2026-09-29 P1「转场」）：把分镜级/镜头级的过渡方式注入每镜
    #   （分镜根上的 "transition" 当默认值，单镜自己的 transition 覆盖它）
    _sb_trans = str(sb.get('transition') or '').strip().lower()
    if _sb_trans in ('cut', 'fade', 'soft'):
        print('[VF] 过渡方式 = %s（分镜级）' % _sb_trans)
    # ★VF_DECK_STYLE_V1（2026-10-01）：用户手动指定的画面模版（plan 根级 `deck_style`）——
    #   在逐镜渲染**之前**统一覆盖 deck 页的 variant；'auto'/缺失/非法 → 一个字段都不动（零回归）。
    apply_deck_style(sb)
    # ★VF_PPTPREVIEW_V1（2026-10-01）：--ppt-preview —— 出片前把 PPT 抽成图给老板审。
    #   位置刻意选在 `apply_deck_style(sb)` **之后**：这样"用户选的画面模版有没有生效"在预览里一眼可见
    #   （老板实测的坑就是"选了模版但一条片都没生效"）。
    if a.ppt_preview:
        _od = a.outdir or os.path.join(wd, 'ppt-preview')
        os.makedirs(_od, exist_ok=True)
        _shots = sb.get('shots', [])
        print('[VF] ★VF_PPTPREVIEW_V1 抽帧审图：%d 镜 → %s' % (len(_shots), _od))
        print('[VF] ★VF_PPTPREVIEW_V1 口径：每镜只出 1 张【内容全就位】PNG（不渲整段视频）；'
              '默认不带底部字幕、不带顶部固定标题（那两者是出片后另烧的覆盖层）%s'
              % ('；**--with-banner 已开** → 固定标题照出片口径烧进这一帧' if a.with_banner else ''))
        # ★VF_PPTPREVIEW_BANNER_V1：--with-banner 时算出固定标题的全局区间（口径与出片那段逐字一致）
        _bnPrev = sb.get('banner')
        _bnRng = None
        if a.with_banner and isinstance(_bnPrev, dict):
            try:
                _f = int((_bnPrev or {}).get('from') or 1)
                _t2 = int((_bnPrev or {}).get('to') or 0)
                _ds = [float(x.get('dur', 0) or 0) for x in _shots]
                _st2 = sum(_ds[:_f - 1]) if _f > 1 else 0.0
                _en3 = sum(_ds[:_t2]) if _t2 > 0 else sum(_ds)
                if _en3 > _st2:
                    _bnRng = (_st2, _en3)
            except Exception:
                _bnRng = None
        _idx = []
        _off = 0.0
        for i, shot in enumerate(_shots):
            shot['_trans'] = str(shot.get('transition') or _sb_trans or '').strip().lower()
            _typ = str(shot.get('type') or 'title')
            _t = _ppt_settle_t(shot.get('dur', 3))
            _png = os.path.join(_od, 'p%02d.png' % (i + 1))
            render_shot(shot, th, wd, i, W, H, fps, ffmpeg, still=(_t, _png))
            if a.with_banner and isinstance(_bnPrev, dict):
                _b3 = dict(_bnPrev)
                if _bnRng:
                    _b3['_range'] = _bnRng
                ppt_burn_banner_still(_png, _b3, th, W, H, float(shot.get('dur', 3) or 3),
                                      ffmpeg, _off + _t)
            _off += float(shot.get('dur', 3) or 3)
            _idx.append({
                'i': i + 1,
                'file': 'p%02d.png' % (i + 1),
                'type': _typ,
                'variant': _preview_variant(shot, _typ),
                't': _t,
                'text': _preview_text(shot, _typ),
                'subtitle': str(shot.get('subtitle') or ''),
            })
            print('[VF] PPT 抽帧 %d/%d  %-8s t=%.2fs  ->  %s'
                  % (i + 1, len(_shots), _typ, _t, os.path.basename(_png)))
        _ip = os.path.join(_od, 'index.json')
        with open(_ip, 'w', encoding='utf-8') as _f:
            json.dump(_idx, _f, ensure_ascii=False, indent=2)
        print('[VF] ★VF_PPTPREVIEW_V1 完成：%d 张 PNG + index.json → %s' % (len(_idx), _ip))
        return
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
                                             ffmpeg, _sub_size, W=W, H=H)
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
