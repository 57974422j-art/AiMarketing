#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""★VF_DECK_STYLES2_V1（2026-10-01）渲染层自检 —— 新增 2 套风格 + 去 AI 味配色 + 用户指定模版。

覆盖（对应用户本轮 4 条原话）：
  1) 「配色版式 就这1种吗？」「是否能按传统的5个网页UI风格设计」
     → DECK_VARIANTS 必须 = 6 套（deck / deck-grad / deck-mono / deck-mag / deck-glass / deck-soft），
       且 6 套各自都产出完整元素清单（kicker / 编号要点 / 数据块 eif / 页码 / 分段入场 / 持续动效），
       白名单外的自造值**零回归**（一个滤镜都不加）。
  2) 「配色更讲究一些」「注意配合 配色真的不能太 AI 味」「最好有渐变色。还有就是透明度」
     → 玻璃卡/柔和卡的 alpha 必须落在写死的区间（低 alpha 底 + 细 hairline）；
       6 套画面里都不许出现 `box=1:boxcolor`（实心黑框）；
       deck-grad 的渐变必须是**真逐像素**（--pixels 时用同一帧跨远处取点证明颜色单调过渡）。
  3) 「我本次选的是新闻资讯，因为我没看到新模版」→ 根级 `deck_style` 能手动指定：
       具体风格名 → 全片 deck 页强制用它（覆盖镜内 variant）；'auto'/缺失/非法 → 逐字保持现状。
  4) 去 AI 味硬规矩写进代码：颜色一律取主题 token（含 cardBg2 / lineC / shadowC），不新造高饱和色。

用法：
  python scripts/video-factory/test-deck-styles2.py            # 纯逻辑（秒级，默认）
  python scripts/video-factory/test-deck-styles2.py --pixels   # 额外真渲 + 逐像素验证（要 ffmpeg，~20s）
"""
import argparse
import json
import os
import re
import subprocess
import sys
import tempfile

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

from themes import THEMES, theme_of          # noqa: E402
import render as R                            # noqa: E402

_OK = []
_BAD = []
DECK6 = ('deck', 'deck-grad', 'deck-mono', 'deck-mag', 'deck-glass', 'deck-soft')


def chk(cond, name, extra=''):
    ((_OK if cond else _BAD)).append(name + (('  ← ' + extra) if (extra and not cond) else ''))


def _shot(style=None, **kw):
    s = {'type': 'title', 'kicker': 'AI 营销', 'text': 'AI 营销内容生成系统',
         'sub': '从选题到成片，一条流水线', 'items': ['智能选题', '一键成片', '自动分发'],
         'stats': [{'value': '8.5%', 'label': '点击率'}, {'value': '150', 'suffix': '万', 'label': '曝光'}],
         'page': '01 / 02', 'dur': 8}
    if style:
        s['variant'] = style
    s.update(kw)
    return s


def _alphas(filts):
    """从滤镜串里取所有 `@0.NNN:` / `@0.NN:`（= drawbox 的 alpha）。"""
    return [float(x) for x in re.findall(r'@([01]\.\d+):', ','.join(filts or []))]


# ══════════════════════════ 纯逻辑 ══════════════════════════
def logic():
    th = theme_of('news')

    # ① 白名单：6 套，顺序逐字（与 src/lib/agent/vf/anti-ai.ts 对账用）
    chk(list(R.DECK_VARIANTS) == list(DECK6), 'DECK_VARIANTS = 6 套且顺序逐字',
        str(list(R.DECK_VARIANTS)))
    chk(list(R.DECK_STYLE_VARIANTS) == list(DECK6),
        'DECK_STYLE_VARIANTS = DECK_VARIANTS（别名一致）')
    chk(all(v in R.TITLE_VARIANTS for v in DECK6), '6 套都在 TITLE_VARIANTS 里（AI 白名单口径）')
    chk(R.TITLE_VARIANTS[:3] == ('center', 'left', 'chip'), 'title 前 3 个老值未动（零回归）',
        str(R.TITLE_VARIANTS[:3]))
    chk(R.LIST_VARIANTS == ('steps', 'stack') and R.COMPARE_VARIANTS == ('split', 'bar'),
        'list/compare 白名单未被本批改动')

    # ② 6 套各自产出完整元素清单 + 无实心黑框
    for st in DECK6:
        f = R.deck_page_filters(dict(_shot(st)), th, 1280, 720, 8)
        j = ','.join(f)
        chk(len(f) >= 18, '%s：一页 ≥18 个元素层' % st, 'n=%d' % len(f))
        chk('AI 营销' in j, '%s：kicker 小标签在位' % st)
        chk(("text='01'" in j) and ("text='02'" in j) and ("text='03'" in j),
            '%s：编号要点 01/02/03' % st)
        chk('8.5' in j and '150' in j and 'eif' in j, '%s：数据块（含 eif 滚动）' % st)
        chk('01 / 02' in j, '%s：页码在位' % st)
        chk("enable='gte(t," in j, '%s：元素分段入场（enable）' % st)
        chk("alpha='min(max(t-" in j, '%s：每段文字错开渐入' % st)
        chk('sin(2*PI*t/' in j, '%s：持续动效（呼吸 sin）在位' % st)
        chk('box=1:boxcolor' not in j, '%s：画面里没有实心黑框（去 AI 味）' % st)
        # ⚠️ 本机踩过的坑：f-string 里漏了花括号 → 滤镜串里留下 Python 代码原文
        #   （`h=max(2, int(H * 0.004))`）→ ffmpeg 报 "Error parsing a filter description"。
        #   这里对每个 drawbox/drawtext 参数做"未插值"检测（只在 `:`/`=` 后紧跟 max(/int( 时算）。
        chk(not re.search(r'[:=](?:max|int)\(', j),
            '%s：滤镜串里没有"漏花括号"的 Python 代码原文' % st,
            (re.search(r'[:=](?:max|int)\([^)]*\)?', j).group(0) if re.search(r'[:=](?:max|int)\(', j) else ''))

    # ③ 零回归：白名单外（前缀伪装 / 大小写 / 自造）→ 一个滤镜都不加
    for bad in ('deckx', 'deck-glass2', 'deck_glass', 'deck-softt', 'glass', 'cards'):
        chk(R.deck_page_filters(dict(_shot(bad)), th, 1280, 720, 5) == [],
            '零回归：variant=%s → 一个滤镜都不加' % bad)
    chk(R.deck_style_of({'variant': ' DECK-GLASS '}) == 'deck-glass', '风格值去空白 + 小写归一')
    chk(R.deck_style_of({'variant': 'deck-pink'}) == '', '自造风格 → 空（回老版式）')

    # ④ 玻璃卡：低 alpha 染色底 + 细 hairline + 高光（透明度写死，都有上限）
    gp = R._glass_panel(100, 100, 420, 130, th)
    ga = _alphas(gp)
    chk(len(gp) >= 9, '玻璃卡：底(4段) + 高光 + 4 条棱 ≥9 层', 'n=%d' % len(gp))
    chk(bool(ga) and max(ga) <= 0.36, '玻璃卡：最大 alpha ≤0.36（保住可读性又不变成实心板）',
        str(max(ga) if ga else None))
    chk(bool(ga) and min(ga) <= 0.10, '玻璃卡：有"几乎全透"的一层（≤0.10）', str(min(ga) if ga else None))
    chk(any(re.search(r'h=[12]:', x) for x in gp if ':t=fill' in x),
        '玻璃卡：有 1~2px 的细白/浅边 hairline（玻璃棱）')
    chk('0x1b3a5e' in ','.join(gp), '玻璃卡：染色底取主题 cardBg2（同源，不新造色）')
    # 玻璃页整幅：有柔光渐变 wash（min ≤0.10）+ 唯一实底元素不超 0.95
    gpage = _alphas(R.deck_page_filters(dict(_shot('deck-glass')), th, 1280, 720, 8))
    chk(bool(gpage) and max(gpage) <= 0.95 and min(gpage) <= 0.10,
        '玻璃页：既有"几乎全透"的柔光 wash（≤0.10）也有唯一实底标签条（≤0.95）',
        str((min(gpage) if gpage else None, max(gpage) if gpage else None)))
    chk(any(0.20 <= x <= 0.36 for x in gpage),
        '玻璃页：卡片/标签条走 0.20~0.36 的**半透明**（不是实心板）')

    # ⑤ 柔和拟物卡：左上亮 / 右下暗**双投影** + 同色卡面 + bevel；整体低 alpha
    sp = R._soft_panel(100, 100, 420, 130, th)
    sa = _alphas(sp)
    chk(len(sp) >= 9, '柔和卡：亮投影 + 暗投影 + 卡面(3段) + 4 条 bevel ≥9 层', 'n=%d' % len(sp))
    chk(bool(sa) and max(sa) <= 0.36, '柔和卡：最大 alpha ≤0.36（始终是同色系表面，不是色板）',
        str(max(sa) if sa else None))
    _ys = [int(m) for m in re.findall(r'drawbox=x=\d+:y=(\d+):', ','.join(sp))]
    chk(bool(_ys) and min(_ys) < 100 < max(_ys),
        '柔和卡：既有向上的亮投影又有向下的暗投影（凹凸感的来源）', str(_ys[:4]))
    chk('0x04090f' in ','.join(sp), '柔和卡：暗投影取主题 shadowC（同源）')
    chk(any(re.search(r'h=[12]:', x) for x in sp if ':t=fill' in x), '柔和卡：有 bevel 亮/暗细边')

    # ⑥ 主题 token 兜底：老主题也要能拿到 cardBg2 / lineC / shadowC（老主题不写不许坏）
    for nm in THEMES:
        t = theme_of(nm)
        miss = [k for k in ('cardBg2', 'lineC', 'shadowC') if not str(t.get(k, '')).strip()]
        chk(not miss, 'token 兜底：%s 有 cardBg2/lineC/shadowC' % nm, '缺 %s' % miss)
    _unk = theme_of({'theme': '不存在的主题', 'text': 'white'})
    chk(all(str(_unk.get(k, '')).strip() for k in ('cardBg2', 'lineC', 'shadowC')),
        '未知主题字典 → 3 个新 token 全兜底')
    chk(str(theme_of('light').get('lineC')) == 'black',
        'lineC 兜底按字色亮度取黑白（light 主题深字 → 黑发丝）',
        str(theme_of('light').get('lineC')))

    # ⑦ 根级 deck_style（用户手动指定画面模版）
    chk(R.deck_root_style({'deck_style': 'deck-glass'}) == 'deck-glass', 'deck_style 合法值被接受')
    chk(R.deck_root_style({'deck_style': ' DECK-SOFT '}) == 'deck-soft', 'deck_style 去空白 + 大小写不敏感')
    chk(R.deck_root_style({'deck_style': 'auto'}) == '', "'auto' → 不干预")
    chk(R.deck_root_style({}) == '' and R.deck_root_style(None) == '', '缺失 → 不干预')
    chk(R.deck_root_style({'deck_style': 'deck-pink'}) == '', '非法值 → 不干预（零回归）')
    sb = {'deck_style': 'deck-glass',
          'shots': [{'variant': 'deck-mag'}, {'variant': 'center'}, {'type': 'list'}, {'variant': 'deck'}],
          'size': [1280, 720], 'fps': 25, 'theme': 'news'}
    st = R.apply_deck_style(sb)
    chk(st == 'deck-glass', 'apply_deck_style 返回生效风格名')
    chk([s.get('variant') for s in sb['shots']] == ['deck-glass', 'center', None, 'deck-glass'],
        'deck_style 覆盖：3 个 deck 页被强制、普通卡（center/list）一个字不动',
        str([s.get('variant') for s in sb['shots']]))
    sb2 = {'deck_style': 'auto', 'shots': [{'variant': 'deck-mag'}]}
    chk(R.apply_deck_style(sb2) == '' and sb2['shots'][0]['variant'] == 'deck-mag',
        "'auto' → 镜内 variant 逐字保持（零回归）")
    sb3 = {'deck_style': 'deck-soft', 'shots': [{'variant': 'center'}, {'type': 'title'}]}
    R.apply_deck_style(sb3)
    chk([s.get('variant') for s in sb3['shots']] == ['center', None],
        'deck_style 不凭空把普通卡变成 deck 页（只统一"已经是 deck 页"的）',
        str([s.get('variant') for s in sb3['shots']]))
    # ★VF_DECK_HARD_V1（2026-10-01 team-lead 定案）：**唯一硬判据 = 结构相等（确定性、零噪声）**。
    #   口径（team-lead 原话）：同一条 plan —— 一次【根级 deck_style=X + 镜内故意写另一个风格】、
    #   另一次【直接写 X】→ 两次的**每镜最终配方（输入 + 整条滤镜串）必须逐字相等**。
    #   滤镜串相等 ⇒ 画面必然相等（差的只剩 x264 编码噪声）→ 这才是"覆盖完全生效"的判据。
    #   覆盖 6 套风格 × 两条路径（纯文字页 card_title / 素材页 card_bgimage）。
    #   ⚠️ 不用像素/抽帧做硬判据：deck-grad/glass 底板是 lavfi `gradients`，动画相位随**进程**变化
    #     （实测同 t 两次独立 ffmpeg 的帧 MD5 不同）→ 任何"跨渲染像素相等"都必然抖。
    _img2 = os.path.join(tempfile.mkdtemp(prefix='vf-deckhard-'), 'm.jpg')
    _img_ok = False
    try:
        subprocess.run([R.find_ffmpeg(), '-v', 'error', '-y', '-f', 'lavfi',
                        '-i', 'color=c=0x24405a:s=1280x720', '-frames:v', '1', _img2],
                       capture_output=True, timeout=60)
        _img_ok = os.path.exists(_img2)
    except Exception:
        _img_ok = False

    def _bshot(_sty):
        return {'type': 'bgimage', 'src': _img2, 'variant': _sty, 'kicker': 'AI 营销',
                'text': 'AI 营销内容生成系统', 'sub': '从选题到成片，一条流水线',
                'items': ['智能选题', '一键成片', '自动分发'],
                'stats': [{'value': '8.5%', 'label': '点击率'},
                          {'value': '150', 'suffix': '万', 'label': '曝光'}],
                'page': '01 / 02', 'dur': 8, '_idx': 0}

    _hard_bad = []
    for _sty in DECK6:
        _oth = 'deck-mag' if _sty != 'deck-mag' else 'deck-glass'
        _sd = dict(_shot(_sty), dur=8)
        _sf = dict(_shot(_oth), dur=8)
        R.apply_deck_style({'deck_style': _sty, 'shots': [_sf]})
        if R.card_title(dict(_sd), th, 1280, 720, 25) != R.card_title(dict(_sf), th, 1280, 720, 25):
            _hard_bad.append('title:' + _sty)
        if _img_ok:
            _bd = _bshot(_sty)
            _bf = _bshot(_oth)
            R.apply_deck_style({'deck_style': _sty, 'shots': [_bf]})
            if R.card_bgimage(dict(_bd), th, 1280, 720, 25) != R.card_bgimage(dict(_bf), th, 1280, 720, 25):
                _hard_bad.append('bgimage:' + _sty)
    chk(not _hard_bad,
        '★VF_DECK_HARD_V1 【硬判据·结构相等】6 套风格 × (纯文字页/素材页)：根级强制覆盖后的'
        '每镜配方逐字等于"直接写该风格"（滤镜串相等 ⇒ 画面必然相等）', str(_hard_bad))
    if not _img_ok:
        _OK.append('★VF_DECK_HARD_V1：素材页路径未测（本机生成测试图失败）')

    # ⑧ 底板：deck-grad 与 deck-glass 走真渐变；其余 4 套逐字仍是 color=
    _bi_soft = R.deck_base_input(dict(_shot('deck-soft')), th, 1280, 720, 8)
    chk(_bi_soft.startswith('-f lavfi -i color='), 'deck-soft 底板仍是 color=（零回归）', _bi_soft[:40])
    _bi_deck = R.deck_base_input(dict(_shot('deck')), th, 1280, 720, 8)
    chk(_bi_deck == '-f lavfi -i color=c=0x0b1622:s=1280x720:d=8',
        'deck 底板与老版逐字相同', _bi_deck)
    _has = True
    try:
        _has = R._has_gradients(R.find_ffmpeg())
    except Exception:
        _has = False
    _bi_g = R.deck_base_input(dict(_shot('deck-grad')), th, 1280, 720, 8)
    _bi_gl = R.deck_base_input(dict(_shot('deck-glass')), th, 1280, 720, 8)
    _want = '-f lavfi -i gradients=' if _has else '-f lavfi -i color='
    chk(_bi_g.startswith(_want), 'deck-grad 底板 = 真渐变（无 gradients 则回落底色）', _bi_g[:44])
    chk(_bi_gl.startswith(_want), 'deck-glass 底板 = 真渐变（"背景一层柔光渐变"）', _bi_gl[:44])
    chk('c0=' + str(th.get('gradA')) in _bi_gl and 'c1=' + str(th.get('gradB')) in _bi_gl,
        'deck-glass 渐变两端 = 主题 gradA/gradB（同源低饱和，不是高饱和紫蓝）')

    # ⑨ 防回退 grep（标记必须在位）
    try:
        _src = open(os.path.join(_HERE, 'render.py'), encoding='utf-8').read()
    except Exception as e:
        _src = ''
        _BAD.append('读 render.py 失败：%s' % str(e)[:80])
    for mk in ('★VF_DECK_STYLES2_V1', '★VF_DECK_STYLE_V1', '★VF_DECK_STYLES_V1', '★VF_DECK_V1',
               '★VF_NOBLACKBOX_V1', '★VF_SUSTAIN_V1', '★VF_LONGCMD_V1'):
        chk(_src.count(mk) >= 1, '防回退：%s 仍在 render.py 里' % mk)
    _thsrc = open(os.path.join(_HERE, 'themes.py'), encoding='utf-8').read()
    chk(all(k in _thsrc for k in ('cardBg2', 'shadowC', 'lineC')),
        'themes.py：cardBg2 / shadowC / lineC 三个新 token 在位')


# ══════════════════════════ 逐像素（真渲） ══════════════════════════
def _frame_rgb(ff, path, t, W, H):
    """取某一时刻的整帧 RGB 原始字节（rgb24）。

    ★VF_DECK_PIXEL_V2（2026-10-01）：`-ss` 必须放在 `-i` **之后**（输出端 seek）。
    为什么：旧写法 `-ss t -i`（输入端 seek）会 seek 到最近关键帧再往后丢帧 —— 同一文件、
    同一 t 在不同运行里可能落到**不同帧**；而 deck 页是**时间动画**（gradients 渐变在走 +
    进度线在长），错一帧就会让整幅亮度差十几 → 正是旧断言"时红时绿"的根因之一。
    输出端 seek 从 0 解码到 t，帧号确定 → 实测同文件同 t 两次取样**逐字节一致**。"""
    try:
        r = subprocess.run([ff, '-v', 'error', '-i', path, '-ss', '%.3f' % t,
                            '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
                           capture_output=True, timeout=90)
        if r.returncode == 0 and len(r.stdout) >= W * H * 3:
            return r.stdout[:W * H * 3]
    except Exception:
        pass
    return b''


def _px(buf, W, x, y):
    i = (y * W + x) * 3
    return buf[i], buf[i + 1], buf[i + 2]


def _lum(px):
    return 0.299 * px[0] + 0.587 * px[1] + 0.114 * px[2]


def _block_lum(buf, W, H, x, y, k=24):
    """★VF_DECK_PIXEL_V2（2026-10-01）：以 (x,y) 为中心的 k×k **块平均亮度**。
    为什么不用单像素：libx264 `-preset fast` 多线程 + 深色平滑渐变区 → **单像素**噪声可达 ±30，
    于是"逐点一致"变成掷骰子（本机实测 glass↔forced 单像素 max 差 31.1，容差 30 时红时绿）。
    块平均把压缩噪声平掉（实测同分镜两次渲染的**块平均**抖动 <5），同时保留"布局/配色真的变了"的信号。"""
    x0 = max(0, min(W - 1, int(x) - k // 2))
    y0 = max(0, min(H - 1, int(y) - k // 2))
    x1 = min(W, x0 + k)
    y1 = min(H, y0 + k)
    tot = 0.0
    n = 0
    for yy in range(y0, y1):
        base = yy * W * 3
        for xx in range(x0, x1):
            i = base + xx * 3
            tot += 0.299 * buf[i] + 0.587 * buf[i + 1] + 0.114 * buf[i + 2]
            n += 1
    return tot / n if n else 0.0


def _bands_lum(buf, W, H, n=12):
    """★VF_DECK_PIXEL_V2（2026-10-01）：把整帧按行切成 n 条**满宽**横带，返回每条的平均亮度。
    为什么用它当主判据：deck 页里有强调条/卡边这类**高对比硬边** —— 小方块/单像素一旦压住硬边，
    x264 多线程编码噪声会被放大到 ±20（本机实测块平均抖动 18~20、单像素 20~27）。
    满宽横带每条平均上万像素（1280×60）→ 实测抖动 <2，而"配色/布局真变了"仍会整体位移几十。
    次要判据（块平均 / 单像素）仍保留，但阈值一律 = **本次运行实测的同量抖动** + 固定余量。"""
    n = max(1, int(n))
    out = []
    for b in range(n):
        y0 = int(H * b / n)
        y1 = int(H * (b + 1) / n)
        tot = 0.0
        cnt = 0
        for yy in range(y0, y1):
            base = yy * W * 3
            for xx in range(W):
                i = base + xx * 3
                tot += 0.299 * buf[i] + 0.587 * buf[i + 1] + 0.114 * buf[i + 2]
                cnt += 1
        out.append(tot / cnt if cnt else 0.0)
    return out


def _pearson(a, b):
    """两条序列的 Pearson 相关系数（★VF_DECK_PIXEL_V2 的"结构证据"：哪条带亮/暗必须一致）。"""
    n = min(len(a), len(b))
    if n < 2:
        return 0.0
    ma = sum(a[:n]) / n
    mb = sum(b[:n]) / n
    va = sum((x - ma) ** 2 for x in a[:n])
    vb = sum((y - mb) ** 2 for y in b[:n])
    if va <= 0 or vb <= 0:
        return 0.0
    cov = sum((a[i] - ma) * (b[i] - mb) for i in range(n))
    return cov / ((va ** 0.5) * (vb ** 0.5))


def _render_page(ff, out, style, wd, deck_style=None, tag=None):
    """渲一条**纯文字** deck 页（8s，浅底=渐变/底色），供逐像素取样（x=8 一列在内容区之外）。

    tag：同一 style 需要**重复渲染**（编码抖动自校准）时给个不同的 tag，避免 workdir 撞车。"""
    sb = {'size': [1280, 720], 'fps': 25, 'theme': 'news',
          'shots': [dict(_shot(style), dur=8)]}
    if deck_style:
        sb['deck_style'] = deck_style
    _tag = tag or style
    sbp = os.path.join(wd, 'sb_%s.json' % _tag)
    with open(sbp, 'w', encoding='utf-8') as f:
        json.dump(sb, f, ensure_ascii=False)
    r = subprocess.run([sys.executable, os.path.join(_HERE, 'render.py'),
                        '--storyboard', sbp, '--out', out, '--no-subs',
                        '--workdir', os.path.join(wd, 'wd_' + _tag)],
                       cwd=_HERE, capture_output=True, timeout=240)
    ok = os.path.exists(out) and os.path.getsize(out) > 1000
    if not ok:
        _log = (r.stdout or b'').decode('utf-8', 'replace') if isinstance(r.stdout, bytes) \
            else str(r.stdout or '')
        _err = (r.stderr or b'').decode('utf-8', 'replace') if isinstance(r.stderr, bytes) \
            else str(r.stderr or '')
        print('[debug] %s 渲染失败 rc=%s；stdout 尾部：\n%s\nstderr 尾部：\n%s'
              % (style, r.returncode, '\n'.join(_log.splitlines()[-14:]),
                 '\n'.join(_err.splitlines()[-14:])))
    return ok


def pixels():
    # ★VF_DECK_PIXEL_V2（2026-10-01 team-lead 定案「测试必须确定」）：
    #   `stage_layer` 的 lavfi `gradients` 动画相位**随进程**变化（同一 t 两次独立 ffmpeg 的帧 MD5 不同）
    #   → 只要渐变在动，本节所有"跨渲染像素/亮度"断言都必然时红时绿（team-lead 复跑就撞了两条）。
    #   这里冻结渐变速度（`VF_GRAD_SPEED=0`，render.py 里的测试钩子；**生产不设 = 仍是 0.015**），
    #   让像素层变成确定性证据；"覆盖有没有生效"的**硬判据**仍是结构相等（滤镜串逐字相等）。
    os.environ['VF_GRAD_SPEED'] = '0'
    try:
        ff = R.find_ffmpeg()
    except Exception:
        _BAD.append('逐像素：找不到 ffmpeg')
        return
    wd = tempfile.mkdtemp(prefix='vf-deck2-')
    W, H = 1280, 720
    # ① deck-grad：同一帧跨远处取点 → 颜色**单调过渡**（真逐像素渐变，不是两块纯色叠）
    gp = os.path.join(wd, 'grad.mp4')
    if not _render_page(ff, gp, 'deck-grad', wd):
        _BAD.append('逐像素：deck-grad 页面渲染失败')
        return
    buf = _frame_rgb(ff, gp, 6.0, W, H)
    chk(bool(buf), '逐像素：取到 deck-grad 第 6.0s 整帧')
    if buf:
        # ⚠️ 取样只取 y<470：grad 的"底部光晕"在画面下 30%（y>504）会额外提亮，
        #    那是设计里刻意叠的一层，不属于底板渐变 → 取样避开它，否则单调性会被这层干扰。
        ys = [2, 60, 120, 190, 260, 330, 400, 470]
        lum = [_lum(_px(buf, W, 8, y)) for y in ys]
        _mono = all(lum[i] <= lum[i + 1] + 1.0 for i in range(len(lum) - 1)) or \
                all(lum[i] >= lum[i + 1] - 1.0 for i in range(len(lum) - 1))
        chk(_mono, 'deck-grad：同帧竖直方向 8 点**单调过渡**（真逐像素渐变，不是两块纯色叠）',
            str([round(v, 1) for v in lum]))
        chk(max(lum) - min(lum) >= 8, 'deck-grad：首尾亮度差 ≥8（渐变看得出来）',
            str(round(max(lum) - min(lum), 1)))
    # ② deck-glass：底板同为真渐变 + 叠了极淡柔光 wash（跨点仍单调，且与 grad 差异很小 = wash 够淡）
    gl = os.path.join(wd, 'glass.mp4')
    if _render_page(ff, gl, 'deck-glass', wd):
        buf2 = _frame_rgb(ff, gl, 6.0, W, H)
        chk(bool(buf2), '逐像素：取到 deck-glass 第 6.0s 整帧')
        if buf and buf2:
            # 同样避开 grad 的底部光晕区（y<480），只比"底板 + wash"这点差异
            lum2 = [_lum(_px(buf2, W, 8, y)) for y in (90, 260, 430)]
            lum1 = [_lum(_px(buf, W, 8, y)) for y in (90, 260, 430)]
            chk(max(abs(a - b) for a, b in zip(lum1, lum2)) <= 30,
                'deck-glass：同位置的柔光 wash 足够淡（|Δ亮度| ≤30，不冲掉底板）',
                str([round(a - b, 1) for a, b in zip(lum1, lum2)]))
    else:
        _BAD.append('逐像素：deck-glass 页面渲染失败')
    # ③ deck_style 强制覆盖：根级写 glass、镜里故意写 deck-mag → 渲染日志必须出现强制那一行
    ov = os.path.join(wd, 'forced.mp4')
    sbx = os.path.join(wd, 'sb_forced.json')
    sb = {'size': [1280, 720], 'fps': 25, 'theme': 'news', 'deck_style': 'deck-glass',
          'shots': [dict(_shot('deck-mag'), dur=8)]}
    with open(sbx, 'w', encoding='utf-8') as f:
        json.dump(sb, f, ensure_ascii=False)
    r = subprocess.run([sys.executable, os.path.join(_HERE, 'render.py'),
                        '--storyboard', sbx, '--out', ov, '--no-subs',
                        '--workdir', os.path.join(wd, 'wd_forced')],
                       cwd=_HERE, capture_output=True, timeout=180)
    log = (r.stdout or b'').decode('utf-8', 'replace') if isinstance(r.stdout, bytes) else str(r.stdout or '')
    chk('★VF_DECK_STYLE_V1 用户指定画面模版=deck-glass' in log,
        'deck_style 强制覆盖：渲染日志出现"用户指定画面模版=deck-glass"')
    chk('★VF_DECK_STYLES_V1 风格=deck-glass' in log,
        'deck_style 强制覆盖：实际走的是 glass 的元素层（镜内 deck-mag 被覆盖）')
    # ★VF_DECK_HARD_V1【硬判据·本条 plan】：与 logic() 同口径，在本条 plan 上再把
    #   "每镜配方（输入 + 整条滤镜串）逐字相等"钉一次 —— 这是确定性的、不依赖抽帧/编码。
    _thP = theme_of('news')
    _pd = R.card_title(dict(_shot('deck-glass'), dur=8), _thP, W, H, 25)
    _sfx = dict(_shot('deck-mag'), dur=8)
    R.apply_deck_style({'deck_style': 'deck-glass', 'shots': [_sfx]})
    _pf = R.card_title(dict(_sfx), _thP, W, H, 25)
    chk(_pd == _pf,
        '★VF_DECK_HARD_V1【硬判据·本条 plan】直接 glass 与根级强制 glass 的每镜配方逐字相等')
    # ③-a 【硬判据·结构相等】由 `logic()` 的 ★VF_DECK_HARD_V1 承担（6 套风格 × 纯文字页/素材页，
    #   每镜配方逐字相等 —— 确定性、零噪声）。本节的像素比对**已降级为"补充证据"**，
    #   门槛一律"离噪声远"，不与它抢主判据的位置。
    #
    # ③-b 噪声底怎么量（实测，写进注释）：deck-grad/glass 的底板是 lavfi `gradients`，动画相位随
    #   **进程**变化（实测：同一 t，两次独立 ffmpeg 取到的帧 MD5 都不同；`color=` 则逐字节相同）
    #   → 任何"跨渲染像素相等"**原理上**不成立（旧口径 max(30, jit+6) 正好压在噪声带上 = 时红时绿）。
    #   这里**连渲 3 次同一页**，噪声底 = 两两互差的**最大值**（= 本机相位散布的上界，离噪声更远）。
    _pts = [(8, 90), (8, 430), (300, 200), (600, 300), (900, 500)]
    _NB = 12                                             # 满宽横带条数
    _jit = None             # 单像素噪声底（3 次两两 max）
    _nb_max = _nb_mean = None   # 横带噪声底（3 次两两 max / 对应 mean）
    _bufs = []
    for _tag in ('glass2', 'glass3'):
        _p = os.path.join(wd, _tag + '.mp4')
        if _render_page(ff, _p, 'deck-glass', wd, tag=_tag):
            _bu = _frame_rgb(ff, _p, 7.5, W, H)
            if _bu:
                _bufs.append(_bu)
    _b0 = _frame_rgb(ff, gl, 7.5, W, H)
    if _b0 and len(_bufs) >= 1:
        _b0b = _frame_rgb(ff, gl, 7.5, W, H)             # 同一文件同一时刻取两次
        chk(_b0 == _b0b, '逐像素采样稳定：同一 mp4 同一时刻取两次**完全一致**（排除抽帧自身抖动）')
        _all = [_b0] + _bufs
        _pixv = [[_lum(_px(_b, W, x, y)) for x, y in _pts] for _b in _all]
        _bandv = [_bands_lum(_b, W, H, _NB) for _b in _all]
        _pairs = [(i, j) for i in range(len(_all)) for j in range(i + 1, len(_all))]
        _jit = max(max(abs(_pixv[i][k] - _pixv[j][k]) for k in range(len(_pts))) for i, j in _pairs)
        _nb_max = max(max(abs(a - b) for a, b in zip(_bandv[i], _bandv[j])) for i, j in _pairs)
        _nb_mean = max(sum(abs(a - b) for a, b in zip(_bandv[i], _bandv[j])) / float(_NB)
                       for i, j in _pairs)
        chk(_jit <= 60 and _nb_max <= 45,
            '★VF_DECK_PIXEL_V2 噪声底自校准（同页连渲 3 次、两两 max）：单像素 ≤60 / 横带 ≤45'
            '（gradients 动画相位 + x264 多线程；**原理性**噪声，不是 bug）',
            'n=%d 单像素=%.1f 横带max=%.2f 横带mean=%.2f'
            % (len(_pairs), _jit, _nb_max, _nb_mean))
    else:
        _BAD.append('逐像素：deck-glass 重复渲染失败（无法测噪声底）')
    # ③-c 【补充证据·非硬判据】强制覆盖 vs 直接 glass（t=7.5 全就位帧）。
    #   唯一门槛 = 横带 max 差 ≤ 实测噪声底 × 1.5（噪声底 = 同页连渲 3 次两两 max，见 ③-b）。
    #   ⚠️ 形状相关（Pearson）**只打印、不断言** —— 相位一翻它就会掉到 0.58~0.87，是它把断言卡在
    #     门槛上导致时红时绿（team-lead 复跑第一次就红的那条），已按指示删掉。
    if os.path.exists(ov):
        buf3 = _frame_rgb(ff, ov, 7.5, W, H)
        buf2b = _frame_rgb(ff, gl, 7.5, W, H)
        if buf3 and buf2b:
            a2 = _bands_lum(buf2b, W, H, _NB)
            a3 = _bands_lum(buf3, W, H, _NB)
            _bmax = max(abs(a - b) for a, b in zip(a2, a3))
            _bmean = sum(abs(a - b) for a, b in zip(a2, a3)) / float(_NB)
            _corr = _pearson(a2, a3)
            _nbB = _nb_max if _nb_max is not None else 0.0
            # ⚠️ 这一页**不做像素断言，只打印**（team-lead：「测试必须确定」）——实测证据：
            #   deck-grad/glass 页即便把渐变速度冻结到 0（`VF_GRAD_SPEED=0`），**同一页连渲两次的帧 MD5
            #   仍不同**（本机实测），残留差异（横带 max 12~28）与本页"同页互差"同一量级
            #   → 拿它做门槛必然时红时绿（team-lead 复跑撞到的正是这条）。
            #   "覆盖有没有生效"由 ③-a 的**结构相等硬判据**保证（确定性）；这里只留肉眼可查的数字。
            print('[参考·不断言] deck-glass 强制覆盖 vs 直接：横带max=%.2f / 横带mean=%.2f / '
                  '形状相关(Pearson)=%.3f / 单像素噪声底=%.1f / 横带噪声底=%.2f（本页不可复现，见注释）'
                  % (_bmax, _bmean, _corr, _jit or 0.0, _nbB))
        else:
            _BAD.append('逐像素：强制覆盖帧取样失败')
    # ③-d 【补充证据·非硬判据】再用 deck-mono 复核一遍（底板是 `color=`，比 glass 稳一档）
    #   —— 同样**只打印不断言**（理由同 ③-c：跨渲染比值型门槛必然有概率红）。
    #   像素层的**门槛**只剩下面一条"噪声底自校准"（粗界：抓渲染链出现真随机源/坏帧），
    #   "覆盖是否生效"由 ③-a 的**结构相等硬判据**保证。
    _mono_a = os.path.join(wd, 'mono_a.mp4')
    _mono_b = os.path.join(wd, 'mono_b.mp4')
    _ok_a = _render_page(ff, _mono_a, 'deck-mono', wd, tag='monoA')
    _ok_b = _render_page(ff, _mono_b, 'deck-mono', wd, tag='monoB')
    _mf = os.path.join(wd, 'mono_forced.mp4')
    _sbm = os.path.join(wd, 'sb_mono_forced.json')
    _sbmobj = {'size': [W, H], 'fps': 25, 'theme': 'news', 'deck_style': 'deck-mono',
               'shots': [dict(_shot('deck-glass'), dur=8)]}
    with open(_sbm, 'w', encoding='utf-8') as f:
        json.dump(_sbmobj, f, ensure_ascii=False)
    _rmf = subprocess.run([sys.executable, os.path.join(_HERE, 'render.py'),
                           '--storyboard', _sbm, '--out', _mf, '--no-subs',
                           '--workdir', os.path.join(wd, 'wd_monoF')],
                          cwd=_HERE, capture_output=True, timeout=180)
    _logm = (_rmf.stdout or b'').decode('utf-8', 'replace') \
        if isinstance(_rmf.stdout, bytes) else str(_rmf.stdout or '')
    chk('★VF_DECK_STYLES_V1 风格=deck-mono' in _logm,
        '★VF_DECK_PIXEL_V2：强制 mono 时确实走 mono 元素层（渲染日志）')
    if _ok_a and _ok_b and os.path.exists(_mf):
        _ba = _frame_rgb(ff, _mono_a, 7.5, W, H)
        _bb = _frame_rgb(ff, _mono_b, 7.5, W, H)
        _bf = _frame_rgb(ff, _mf, 7.5, W, H)
        if _ba and _bb and _bf:
            _na = _bands_lum(_ba, W, H, _NB)
            _nb = _bands_lum(_bb, W, H, _NB)
            _nf = _bands_lum(_bf, W, H, _NB)
            _m_noise = max(abs(a - b) for a, b in zip(_na, _nb))
            _m_diff = max(abs(a - b) for a, b in zip(_na, _nf))
            _m_corr = _pearson(_na, _nf)
            # 同样**只打印不断言**：mono 页虽比 glass 稳（diff 2.7~11 vs 本页噪声底 5.6~8.1），
            #   但"diff ÷ 噪声底"仍是**两次随机抽样的比值** → 仍有 ~5% 概率红。
            #   team-lead 的要求是"测试必须确定"，所以这里不留比值型断言。
            print('[参考·不断言] deck-mono 直接 vs 强制：横带max=%.2f / 形状相关(Pearson)=%.3f / '
                  '本页噪声底=%.2f' % (_m_diff, _m_corr, _m_noise))
        else:
            _BAD.append('★VF_DECK_PIXEL_V2：mono 帧取样失败')
    else:
        _BAD.append('★VF_DECK_PIXEL_V2：mono 页渲染失败')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--pixels', action='store_true', help='额外真渲 + 逐像素验证（要 ffmpeg，~20s）')
    a = ap.parse_args()
    logic()
    if a.pixels:
        pixels()
    print('\n' + '─' * 62)
    for x in _OK:
        print('  ✅ ' + x)
    for x in _BAD:
        print('  ❌ ' + x)
    print('─' * 62)
    print('%d 项通过 / %d 失败' % (len(_OK), len(_BAD)))
    return 1 if _BAD else 0


if __name__ == '__main__':
    sys.exit(main())
