#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""★VF_STYLE_V1（2026-09-30）渲染层【风格自检】—— 纯逻辑 + 零渲染（秒级）

为什么要单独一个自检脚本：
  `render.py --selftest` 是"能不能出片"的整链回归（要真跑 ffmpeg，几十秒）；
  本脚本只校验**这批风格改动的判定逻辑**，改一行就秒级知道有没有改歪，
  不必等一条片子渲完。

覆盖（对应用户本轮 4 条反馈）：
  1) token 完整性 —— news/data 的卡面 token 到位，**8 套老主题也能拿到兜底值**（老分镜不许坏）；
  2) 文字对比度自适应 —— ①「字是黑灰色的，在图片上基本看不见」的四种正反例；
  3) 底图清晰度判定 —— ③「底图有点模糊」：接近画幅→直接裁切 / 填不满→轻模糊 / 太小→不放大；
  4) 横竖屏字号 —— ④「统一按竖屏分辨率配的字」：横屏与竖屏必须得出不同且合理的字号。

用法：
  python scripts/vf-style-selftest.py            # 全部逻辑自检（默认）
  python scripts/vf-style-selftest.py --render   # 额外真渲一次 news/data（慢，要 ffmpeg）
"""
import argparse
import json as _json
import os
import re as _re
import subprocess
import sys
import tempfile

_HERE = os.path.dirname(os.path.abspath(__file__))
_VF = os.path.join(_HERE, 'video-factory')
if _VF not in sys.path:
    sys.path.insert(0, _VF)

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

from themes import THEMES, theme_of, theme_names          # noqa: E402
import render as R                                         # noqa: E402

_OK = []
_BAD = []


def chk(cond, name, extra=''):
    # extra 允许传元组/字典等（调试信息）—— 以前直接 `+ extra`，传非 str 会 TypeError 把整个自测打断
    ((_OK if cond else _BAD)).append(name + (('  ← ' + str(extra)) if (extra and not cond) else ''))


def _mk_img(ff, path, w, h, color='0x2b4a5a'):
    try:
        subprocess.run([ff, '-v', 'error', '-y', '-f', 'lavfi',
                        '-i', 'color=c=%s:s=%dx%d' % (color, w, h), '-frames:v', '1', path],
                       capture_output=True, timeout=30)
    except Exception:
        pass
    return os.path.exists(path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--render', action='store_true', help='额外真渲 news/data 各一条（慢）')
    a = ap.parse_args()

    # ── 1. token 完整性（news/data 到位 + 老主题有兜底）────────────────────────
    _TOKENS = ('cardBg', 'cardText', 'cardSub', 'barBg', 'barText',
               'kickerBg', 'kickerText', 'line', 'enFont')
    for name in theme_names():
        t = theme_of(name)
        miss = [k for k in _TOKENS if not str(t.get(k, '')).strip()]
        chk(not miss, 'token 完整：%s' % name, '缺 %s' % miss)
        chk(t.get('id') == name, '主题 id 正确：%s' % name, '实际 %s' % t.get('id'))
    chk(themes_has_editorial(), 'news / data 已登记进 THEMES')
    _news = theme_of('news')
    chk('white' in str(_news.get('cardBg')), 'news 信息卡=白色卡面', str(_news.get('cardBg')))
    chk(R._is_editorial(_news) and R._is_editorial(theme_of('data')), 'news/data 判定为编辑风')
    chk(not R._is_editorial(theme_of('dark')) and not R._is_editorial(theme_of('light')),
        'dark/light 不是编辑风')
    # 字典路径（make.py 传的是字典）也要保住 id 与显式 token
    _nd = theme_of(THEMES['news'])
    chk(_nd.get('id') == 'news' and 'white' in str(_nd.get('cardBg')),
        'make.py 字典路径：news 的 id/卡面不丢', str(_nd.get('id')))
    _unk = theme_of({'theme': '不存在的主题', 'text': 'white'})
    chk(all(str(_unk.get(k, '')).strip() for k in _TOKENS), '未知主题字典 → token 全兜底')

    # ── 2. 文字对比度自适应（①治"字在图片上看不见"）──────────────────────────
    _darkmat = {'lum': 45, 'edge': 0.1, 'flat': 0.3}
    _brightmat = {'lum': 205, 'edge': 0.1, 'flat': 0.05}
    _th_light, _th_dark, _th_mono = theme_of('light'), theme_of('dark'), theme_of('mono')
    _c, _b, _ = R._mat_text_colors(_th_light, _darkmat, _th_light['text'], 'white@0.55')
    chk(_c == 'white' and _b == 'black@0.45',
        '暗素材 + 浅色主题(近黑字) → 大字改亮色 + 深底衬', '%s / %s' % (_c, _b))
    _c2, _b2, _ = R._mat_text_colors(_th_mono, _brightmat, _th_mono['text'], 'black@0.45')
    chk(_c2 == '0x101418' and _b2 == 'white@0.66',
        '亮素材 + 亮字主题 → 大字改暗色 + 浅底衬', '%s / %s' % (_c2, _b2))
    _c3, _b3, _ = R._mat_text_colors(_th_dark, _darkmat, _th_dark['text'], 'black@0.30')
    chk(_c3 == 'white' and _b3 == 'black@0.30', '暗素材 + 亮字主题 → 一个字都不动',
        '%s / %s' % (_c3, _b3))
    _c4, _b4, _ = R._mat_text_colors(_th_light, _brightmat, _th_light['text'], 'white@0.55')
    chk(_c4 == _th_light['text'] and _b4 == 'white@0.55', '亮素材 + 深字主题 → 一个字都不动',
        '%s / %s' % (_c4, _b4))
    chk(R._lum_of('0x1a1a1a') < 120 and R._lum_of('white') > 250, '亮度判定：近黑 <120 / 白 >250')

    # ── 2b. ★VF_TEXTCONTRAST_V1（2026-10-01）用【大字落点区】亮度判对比（老板帧 full_t0260/0502/0110）──
    _th_lightT = theme_of('light')
    # 关键：整帧平均会骗人 —— 同一素材 lum=200(亮) 但落点 region_lum=60(暗) + 浅色主题近黑字。
    _c_lie, _b_lie, _chg_lie = R._mat_text_colors(_th_lightT, {'lum': 200}, _th_lightT['text'],
                                                  'black@0.30', region_lum=60)
    chk(_chg_lie and _c_lie == 'white' and _b_lie == 'black@0.45',
        'TEXTCONTRAST：整帧亮(200)但落点暗(60) → 仍改亮字（治"整帧平均骗人"）', '%s/%s' % (_c_lie, _b_lie))
    _c_nolie, _b_nolie, _chg_nolie = R._mat_text_colors(_th_lightT, {'lum': 200}, _th_lightT['text'],
                                                        'black@0.30', region_lum=None)
    chk((not _chg_nolie) and _c_nolie == _th_lightT['text'],
        'TEXTCONTRAST：不给 region_lum 时按整帧(200)判定 → 保持原样（证明"整帧会漏判"这条真实存在）')
    # 灰字压暗底（看着有字却读不清）→ 也算低对比
    _c_gray, _b_gray, _chg_gray = R._mat_text_colors(_th_dark, {'lum': 60}, '0x707070',
                                                     'black@0.30', region_lum=60)
    chk(_chg_gray and _c_gray == 'white', 'TEXTCONTRAST：灰字(112)压暗底(60) → 判低对比 → 改亮字',
        '%s' % _c_gray)
    # 浅灰大字压浅灰卡片（full_t0502）→ 改暗字 + 浅底衬
    _c_pale, _b_pale, _chg_pale = R._mat_text_colors(_th_lightT, {'lum': 170}, '0x9aa0a6',
                                                     'black@0.30', region_lum=170)
    chk(_chg_pale and _c_pale == '0x101418' and _b_pale == 'white@0.66',
        'TEXTCONTRAST：浅灰字(≈159)压浅底(170) → 改暗字 + 浅底衬', '%s/%s' % (_c_pale, _b_pale))
    # 本来就达标 → 一个字都不动
    chk(not R._mat_text_colors(_th_dark, {'lum': 40}, 'white', 'black@0.30', region_lum=40)[2]
        and not R._mat_text_colors(_th_lightT, {'lum': 210}, '0x101418', 'white@0.66', region_lum=210)[2],
        'TEXTCONTRAST：暗底白字 / 亮底深字 本就达标 → 原样返回（零回归）')
    # 底色材质区域量测接口存在（真渲里会用到）
    chk(hasattr(R, '_avg_rgb_region') and hasattr(R, '_probe_material'),
        'TEXTCONTRAST：区域亮度量测接口 _avg_rgb_region / _probe_material 在位')
    # ★最小侧边距（治 full_t0260「大字右端几乎贴右缘」）
    _ml, _mfs = R.fit_big_text('智能营销方案', 1280, 720)
    _mok, _mw, _mm = R.big_text_margins_ok(_ml, _mfs, 1280)
    chk(_mok and _mm >= 1280 * 0.06,
        'TEXTCONTRAST：单行大字两侧最小边距 ≥6%W（居中 → 左右相等）',
        'widest=%d margin=%.1f' % (_mw, _mm))
    chk(R.big_text_margins_ok(['x' * 200], 40, 1280)[0] is False,
        'TEXTCONTRAST：越界样本被断言拦下（边距守卫有效）')
    _rendsrc = ''
    try:
        _rendsrc = open(os.path.join(_VF, 'render.py'), encoding='utf-8').read()
    except Exception:
        pass
    chk(_rendsrc.count('★VF_TEXTCONTRAST_V1') >= 1, '防回退：★VF_TEXTCONTRAST_V1 仍在 render.py 里')

    # ── 3. 底图清晰度判定（③"底图有点模糊"）─────────────────────────────────
    ff = ''
    try:
        ff = R.find_ffmpeg()
    except Exception:
        ff = ''
    if not ff:
        _BAD.append('底图铺法判定：找不到 ffmpeg（无法造测试图）')
    else:
        wd = tempfile.mkdtemp(prefix='vf-style-')
        cases = [
            ('1280x720', 1280, 720, 'cover', '接近画幅且够大 → 直接裁切铺满'),
            ('1080x1920', 1080, 1920, 'soft', '比例差很远 → 轻模糊铺底'),
            ('640x360', 640, 360, 'native', '比例接近但比画幅小 → 不放大（底色填充）'),
            ('360x640', 360, 640, 'native', '又小又不合比例 → 不放大'),
        ]
        for tag, w, h, want, desc in cases:
            p = os.path.join(wd, 'm_%s.jpg' % tag)
            if not _mk_img(ff, p, w, h):
                _BAD.append('底图铺法：造图失败 %s' % tag)
                continue
            chk(R._probe_size(p) == (w, h), '读素材分辨率：%s' % tag, str(R._probe_size(p)))
            pre, mode = R._bg_filters(p, 1280, 720)
            chk(mode == want, '底图铺法：%s → %s' % (desc, want), '实际 %s' % mode)
            chk('[smooth]' in pre, '底图链尾产出 [smooth]：%s' % tag)
        # cover 不允许出现模糊；soft 才允许
        _p_cover = os.path.join(wd, 'm_1280x720.jpg')
        if os.path.exists(_p_cover):
            _pre, _mode = R._bg_filters(_p_cover, 1280, 720)
            chk('gblur' not in _pre, 'cover 模式不含 gblur（不模糊）')
            _pre2, _m2 = R._bg_filters(os.path.join(wd, 'm_1080x1920.jpg'), 1280, 720)
            chk('gblur=sigma=16' in _pre2, 'soft 模式的 sigma 已从 32 降到 16')

    # ── 4. 横竖屏字号（④"统一按竖屏分辨率配的字"）────────────────────────────
    _fs_land = R.big_fs(1280, 720, 0.10, 44)
    _fs_port = R.big_fs(720, 1280, 0.10, 44)
    _fs_land_tall = R.big_fs(405, 720, 0.10, 44)
    chk(_fs_land == 100 and _fs_port == 128, '字号按画幅取向区分（横屏 100 / 竖屏 128）',
        '%d / %d' % (_fs_land, _fs_port))
    chk(_fs_land > _fs_land_tall, '同样高度：横屏字号 > 竖幅字号（横屏 ×1.40 生效）',
        '%d vs %d' % (_fs_land, _fs_land_tall))
    _l1, _f1 = R.fit_big_text('创作不是等出来的', 1280, 720, max_lines=2)
    _l2, _f2 = R.fit_big_text('创作不是等出来的', 720, 1280, max_lines=2)
    chk(_f1 != _f2, 'fit_big_text：同文案横竖屏字号不同', '%d vs %d' % (_f1, _f2))
    chk(_f1 > _f2, 'fit_big_text：横屏字号更大（观感不再"缩在中间"）', '%d vs %d' % (_f1, _f2))
    _maxw_l = 1280 * 0.86
    chk(all(R.est_text_w(x, _f1) <= _maxw_l for x in _l1), '横屏折行后每行都在安全边距内')

    # ── 5. 英文副标（★用户：英文用无衬线 + 超宽字距）────────────────────────
    _t = R._track('north korea deployment crisis')
    chk(_t == 'N O R T H   K O R E A   D E P L O Y M E N T   C R I S I S',
        '英文副标：全大写 + 逐字加宽字距', _t[:40])
    chk(theme_of('news').get('enFont') == 'arial', '英文副标字体 = 无衬线（arial，Linux 走 DejaVu）')

    # ── 6. 反向：老主题在竖屏上的字号不被这次改动影响 ─────────────────────────
    _old = max(44, int(1280 * 0.10))
    chk(R.big_fs(720, 1280, 0.10, 44) == _old, '竖屏字号沿用老系数（老片观感不变）',
        '%d vs %d' % (R.big_fs(720, 1280, 0.10, 44), _old))

    # ── 7. 源码级断言（收尾①②③：防回退 + 假动画不许回来 + 关键改动在位）────────
    try:
        _src = open(os.path.join(_VF, 'render.py'), encoding='utf-8').read()
    except Exception as e:
        _src = ''
        _BAD.append('读 render.py 失败：%s' % str(e)[:80])

    def _seg(text, fn_name, next_name):
        return text.split('def ' + fn_name)[1].split('def ' + next_name)[0] if text else ''

    # 注释里会提到"当年那个假动画的写法"（`w='100*min(t,1)'`）→ 断言只看**代码行**，不看注释
    _code = '\n'.join(l for l in _src.splitlines() if not l.strip().startswith('#'))
    # ① 图表卡不许再用"裸 w= 表达式"假装生长（drawbox 的 w/h 只在初始化求值一次 → 那是假动画）
    _chart = _seg(_code, 'card_chart', '_avg_rgb')   # card_chart 的下一个函数就是 _avg_rgb
    chk("enable='gte(t," in _chart, '图表卡：横条改成按时间点插入/分段递进（真的在长）')
    chk("w='" not in _chart, '图表卡：不再有裸 w= 表达式（那会退回假动画）',
        '仍有 w=\'...\'')
    # 编辑风列表横条同样必须走 enable（同一类坑）
    _list = _seg(_code, 'card_list', 'card_number')
    chk("enable='gte(t," in _list, '编辑风列表：横条按时间点插入（不是裸 w=）')
    chk("w='" not in _list, '编辑风列表：不再有裸 w= 表达式')
    # 单镜主题覆盖（自检靠它在一支片里同时冒烟 news/data）
    _rs = _seg(_src, 'render_shot', 'concat_shots_xfade')
    chk("shot.get('theme')" in _rs, 'render_shot：支持单镜覆盖主题（shot[theme]）')
    # 自检里有 news / data 两镜冒烟
    chk('"theme": "news"' in _src and '"theme": "data"' in _src,
        'render.py --selftest：已含 news/data 编辑风冒烟镜')
    # ③ 防回退：这几天线上事故修复的标记，一个都不许被误删
    for _mk in ('★VF_FILTERJOIN_V1', '★VF_MATGUARD_V3', '★VF_ENVINFO_V1',
                '★VF_MOTION_V2', '★VF_TITLEFIT_V3'):
        chk(_src.count(_mk) >= 1, '防回退：%s 仍在 render.py 里' % _mk,
            '一处都没有了')
    # 老标记也不许丢（selfcheck.sh 会查）
    for _mk in ('VF_UNKNOWNCARD_V1', 'VF_AIVIDEO_V1', 'VF_LESSDARK_V1', 'VF_SELFTEST_V2'):
        chk(_src.count(_mk) >= 1, '防回退：%s 仍在 render.py 里' % _mk)

    # ══ 8. ★VF_MOTIONPPT_V1（2026-09-30）「动态 PPT」第一批动效 ═══════════════
    # 为什么断这些：这批动效全是 ffmpeg 表达式 / enable 分段，一旦有人改回"裸 w=/x= 表达式"
    #   就退回**假动画**（drawbox 的 w/h 只在初始化求值一次）。所以每个动效都要：
    #   ① 能 grep 到逐帧机制（enable= / crop+t / %{eif}）；② 不许出现裸 w= 表达式。
    _th_d = theme_of('dark')
    _ent_up = R.ppt_enter_filters({'enter': 'up'}, _th_d, 1280, 720, 5)
    chk(len(_ent_up) == 2 and _ent_up[0].startswith('pad='), '整块入场(up)：pad 垫出偏移',
        str(_ent_up)[:70])
    chk(any('crop=' in x and 'min(t/' in x for x in _ent_up),
        '整块入场(up)：crop 的 y 用 t 表达式（逐帧 → 真在滑）')
    _ent_lf = R.ppt_enter_filters({'enter': 'left'}, _th_d, 1280, 720, 5)
    chk(any('crop=' in x and '1-min(t/' in x for x in _ent_lf),
        '整块入场(left)：crop 的 x 用 t 表达式')
    chk(R.ppt_enter_filters({'enter': 'none'}, _th_d, 1280, 720, 5) == [],
        '整块入场可单镜关闭（enter=none → 不加任何滤镜）')
    chk(R.enter_of({'enter': '乱写的值'}) == 'up',
        '入场白名单外的值 → 回默认 up（AI 自造值绝不把渲染搞挂）')

    _grow = R.grow_filters(100, 200, 300, 10, '0xff6b35@0.95', 3.0)
    chk(len(_grow) >= 2 and all("enable='gte(t," in x for x in _grow),
        '强调条生长：分段 enable 按时间点插入（真的在长）')
    chk("w='" not in ' '.join(_grow), '强调条生长：不用裸 w= 表达式（那会退化成假动画）',
        '仍有 w=\'...\'')

    # 源码级：确认三个新函数都走逐帧机制、且真的接进了渲染链路
    _gf = _seg(_code, 'grow_filters', 'card_title')
    chk("enable='gte(t," in _gf, 'grow_filters 源码：走 enable 分段')
    _ef = _seg(_code, 'ppt_enter_filters', 'grow_filters')
    chk('crop=' in _ef and 'min(t/' in _ef, 'ppt_enter_filters 源码：crop 用 t 表达式')
    _rs2 = _seg(_code, 'render_shot', 'concat_shots_xfade')
    chk('ppt_enter_filters(' in _rs2, 'render_shot：纯文字卡真的接入了整块入场滑入')
    _num = _seg(_code, 'card_number', 'card_image')
    # 源码里是 f-string，字面写的是 `%{{eif\:...`（双花括号转义）→ 只断关键词 eif 与 min(t
    chk('eif' in _num and 'min(t' in _num,
        'number 卡：数字用 eif 展开式逐帧递增（真滚动，不是静态贴图）')
    _lst = _seg(_code, 'card_list', 'card_number')
    chk('_avail' in _lst, 'list 卡：逐条插入节奏按镜长参数化（末条留 1s）')
    chk(_src.count('★VF_MOTIONPPT_V1') >= 1, '防回退：★VF_MOTIONPPT_V1 仍在 render.py 里')

    # ══ 9. ★VF_EDITBIGTEXT_V1（2026-09-30）编辑风「压在素材上的大字」═══════════════
    # 用户原话：「把「压在图片上的大字」也做成你给的那 5 张图那种（kicker 小标签 + 多色层级 + 数值排版）」
    #          「文字配色和还有每个都有渐进效果 分段插入」
    _th_news = theme_of('news')
    _th_data = theme_of('data')
    _eb_shot = {'type': 'bgimage', 'src': 'x.jpg', 'text': '库存 1700 万',
                'kicker': '前线专栏', 'en': 'stock crisis report', 'dur': 4}
    _eb_fl, _eb_band, _eb_fs = R._editorial_bigtext(
        _eb_shot, _th_news, 1280, 720, 4, R.big_fs(1280, 720, 0.10, 44), _th_news['text'])
    _eb_join = ','.join(_eb_fl)
    chk(_eb_fs > 0 and len(_eb_fl) >= 6, '编辑风图上大字：产出 kicker+正文+数值+细线等 ≥6 条滤镜',
        'fs=%s n=%d' % (_eb_fs, len(_eb_fl)))
    # ① kicker 小标签（≤8 字）+ 多色层级（≥3 种颜色：kicker 底 / 主字色 / 细分线）
    chk("'前线专栏'" in _eb_join, '编辑风图上大字：画了 kicker 小标签')
    _fb = [x for x in _eb_fl if x.startswith('drawtext')]
    _bx = [x for x in _eb_fl if x.startswith('drawbox')]
    chk(len(_bx) >= 2 and len(_fb) >= 3, '编辑风图上大字：kicker 底 + 主字 + 细分线（多层次）',
        'box=%d text=%d' % (len(_bx), len(_fb)))
    _kbg = str(_th_news.get('kickerBg'))
    _linec = str(_th_news.get('line'))
    chk(_kbg in _eb_join, '编辑风图上大字：kicker 用主题 kickerBg（强调色底）', _kbg)
    chk(_linec.split('@')[0] in _eb_join, '编辑风图上大字：细分割线用主题 line 色', _linec)
    chk(('fontcolor=' + str(_th_news['text'])) in _eb_join and 'fontcolor=0x2f7cf6' in _eb_join,
        '编辑风图上大字：主字色与强调色并存（≥2 种字色 = 多色层级）')
    # ③ 数值排版：数字比周围字更大 + 用强调色；单位小一号
    _num_dt = [x for x in _fb if "text='1700'" in x]
    _suf_dt = [x for x in _fb if '万' in x and 'text=' in x]
    _fs_of = lambda s: int(_re.search(r'fontsize=(\d+)', s).group(1))
    chk(_num_dt and _fs_of(_num_dt[0]) > _eb_fs, '编辑风图上大字：数字比正文更大（数值排版）',
        '%s vs %d' % ((_fs_of(_num_dt[0]) if _num_dt else -1), _eb_fs))
    chk(_num_dt and ('fontcolor=0x2f7cf6' in _num_dt[0]), '编辑风图上大字：数字用强调色')
    chk(_suf_dt and _fs_of(_suf_dt[0]) < _eb_fs, '编辑风图上大字：单位小一号')
    # ⑤ 入场仍是"渐进/分段插入"：文字 alpha 渐入 + 色块/细线 enable 分段
    chk(all("alpha='min(max(t-" in x for x in _fb), '编辑风图上大字：每段文字都渐入（渐进）')
    chk(any("enable='gte(t," in x for x in _bx), '编辑风图上大字：色块/细线按时间点插入（分段）')
    # 英文副标：无衬线 + 宽字距
    chk(any("fontfile='" in x and 'arial' in x for x in _fb) and 'S T O C K' in _eb_join,
        '编辑风图上大字：英文副标走无衬线 + 宽字距')
    # 缺 kicker 时改画短强调条（不硬编 title）
    _eb2 = R._editorial_bigtext({'text': '没有标签'}, _th_data, 1280, 720, 4,
                                R.big_fs(1280, 720, 0.10, 44), _th_data['text'])[0]
    chk(any(x.startswith('drawbox') for x in _eb2) and 'kicker' not in ''.join(_eb2).lower(),
        '编辑风图上大字：缺 kicker → 用强调条兜底（不硬编 title）')
    # ② 老主题不启用新样式：三处带素材的卡都被 _is_editorial(th) 门控
    for _fn, _nxt in (('card_bgimage', 'card_end'), ('card_video', 'card_aivideo'),
                      ('card_aivideo', 'card_quote')):
        _sg = _seg(_code, _fn, _nxt)
        _pre = _sg.split('_editorial_bigtext(')[0] if '_editorial_bigtext(' in _sg else ''
        chk('_editorial_bigtext(' in _sg and '_is_editorial(th)' in _pre,
            '老主题不启用：%s 的编辑风大字受 _is_editorial(th) 门控' % _fn)
    chk(not R._is_editorial(theme_of('dark')) and not R._is_editorial(theme_of('mono')),
        '老主题（dark/mono）判定为非编辑风 → 走老样式')
    # 源码级：新 token 用法 / 数值拆分 / 分段机制都在位
    _ebsrc = _seg(_code, '_editorial_bigtext', 'card_bgimage')
    chk('kickerBg' in _ebsrc and 'kickerText' in _ebsrc, '编辑风图上大字源码：用了 kickerBg/kickerText token')
    chk('_split_num_line(' in _ebsrc and 'fontcolor={acc}' in _ebsrc,
        '编辑风图上大字源码：数值排版（拆数字 + 数字用 accent）')
    chk("enable='gte(t," in _ebsrc, '编辑风图上大字源码：分段插入走 enable（不用裸 w= 假动画）')
    _snsrc = _seg(_code, '_split_num_line', '_editorial_bigtext')
    chk('_NUM_RE' in _snsrc, '数值拆分行源码：正则 _NUM_RE 在位')
    chk(_src.count('★VF_EDITBIGTEXT_V1') >= 1, '防回退：★VF_EDITBIGTEXT_V1 仍在 render.py 里')

    # ══ 10. ★VF_BANNER_EMPTY_V1 / FIT_V1（2026-09-30）顶部固定标题：空第 2 行不许画空色块 ══
    _bfont = R.esc_path(R.find_font('msyh'))
    chk(str('\u200b').strip() == '\u200b',
        '复现：Python str.strip() **不剥**零宽字符（正是"空色块"的根因）')
    _b1 = R.banner_layer({'line1': '3分钟生成爆款方案'}, _th_news, 1280, 720, 10, _bfont)
    chk('drawbox' not in _b1 and 'drawtext' in _b1, 'banner：只有第 1 行 → 不画色块')
    _b2 = R.banner_layer({'line1': '标题', 'line2': ''}, _th_news, 1280, 720, 10, _bfont)
    chk('drawbox' not in _b2, 'banner：第 2 行为空串 → 不画色块')
    _b3 = R.banner_layer({'line1': '标题', 'line2': '   '}, _th_news, 1280, 720, 10, _bfont)
    chk('drawbox' not in _b3, 'banner：第 2 行纯空白 → 不画色块')
    _b4 = R.banner_layer({'line1': '标题', 'line2': '\u200b\ufeff  '}, _th_news, 1280, 720, 10, _bfont)
    chk('drawbox' not in _b4, 'banner：第 2 行零宽/BOM 不可见字符 → 不画色块（bug 修复）')
    _b5 = R.banner_layer({'line1': '标题', 'line2': '第二行真文字'}, _th_news, 1280, 720, 10, _bfont)
    chk('drawbox' in _b5 and '第二行真文字' in _b5, 'banner：第 2 行真有字 → 正常画色块 + 文字')
    _b6 = R.banner_layer({'line1': '标题', 'line2': '超长第二行文案' * 12}, _th_news, 1280, 720, 10, _bfont)
    _m6 = _re.search(r'drawbox=x=\d+:y=\d+:w=(\d+):h=\d+', _b6)
    chk(_m6 is not None and int(_m6.group(1)) <= int(1280 * 0.94),
        'banner：超长第 2 行 → 色块宽度被压进安全边距（不溢出画幅）',
        ('w=%s' % (_m6.group(1) if _m6 else '?')))
    chk(_src.count('★VF_BANNER_EMPTY_V1') >= 1 and _src.count('★VF_BANNER_FIT_V1') >= 1,
        '防回退：★VF_BANNER_EMPTY_V1 / ★VF_BANNER_FIT_V1 仍在 render.py 里')

    # ══ 10b. ★VF_BANNER_EMPTYLINE_V1（2026-10-01）逐行判空：空行不画框、也不占行高 ══
    # 老板实测帧 dist-rel/fixbase/top_t0020.png：顶部白字下面紧贴一个"黑色实心空矩形"（第 2 行空却画了框）。
    # 口径：① 空行 → 该行 box/text 一个都不加；② 只有第 2 行 → 顶到 y1（不留空第 1 行的行距）；
    #       ③ 两行都空 → 整块返回 ''；④ 两行都真有字 → 几何与改前逐字一致（零回归）。
    _y1 = int(720 * 0.035)                                     # banner 第 1 行基准 y（= 25）
    _be1 = R.banner_layer({'line1': '\u200b', 'line2': '第二行真文字'}, _th_news, 1280, 720, 10, 'C:/f.ttf')
    _be1_y = _re.search(r"text='第二行真文字':fontsize=\d+:fontcolor=white:borderw=\d+:"
                        r"bordercolor=black@0\.6:x=\(w-text_w\)/2:y=(\d+)", _be1)
    chk(_be1_y is not None and int(_be1_y.group(1)) == _y1,
        'banner(EMPTYLINE)：只有第 2 行 → 顶到 y1，不留"空第 1 行"的档',
        ('y=%s 期望=%d' % (_be1_y.group(1) if _be1_y else '?', _y1)))
    _be2 = R.banner_layer({'line1': '\u200b\u200b', 'line2': '\ufeff   '}, _th_news, 1280, 720, 10, 'C:/f.ttf')
    chk(_be2 == '', 'banner(EMPTYLINE)：两行都是不可见字符 → 整块返回空串（不生成）', repr(_be2)[:40])
    _be3 = R.banner_layer({'line1': 'AI营销系统30秒生成', 'line2': '一键出片'}, _th_news, 1280, 720, 10, 'C:/f.ttf')
    _fs1m = _re.search(r"fontsize=(\d+):fontcolor=\S+:borderw=\d+:bordercolor=black:", _be3)
    _y2m = _re.search(r"bordercolor=black@0\.6:x=\(w-text_w\)/2:y=(\d+)", _be3)
    _fs1v = int(_fs1m.group(1)) if _fs1m else -1
    chk(_y2m is not None and int(_y2m.group(1)) == _y1 + _fs1v + int(_fs1v * 0.30),
        'banner(EMPTYLINE)：两行都有字 → 第 2 行 y 公式与改前逐字一致（零回归）',
        ('y=%s fs=%s' % (_y2m.group(1) if _y2m else '?', _fs1v)))
    chk(_be3.count('drawtext') == 2 and _be3.count('drawbox') == 1,
        'banner(EMPTYLINE)：两行都有字 → 正好 1 色块 + 2 文字',
        'dt=%d db=%d' % (_be3.count('drawtext'), _be3.count('drawbox')))
    chk(_src.count('★VF_BANNER_EMPTYLINE_V1') >= 1, '防回退：★VF_BANNER_EMPTYLINE_V1 仍在 render.py 里')

    # ══ 11. ★VF_TPL_B1_V1（2026-09-30）B 组「图片处理」模版 ═══════════════════════
    # 用户原话：「我给你拿 5 个图本身应该是不需要 AI 动视的。应该是在视频和图片上做动效 PPT 效果。」
    #          「它们做几个图片加相框一些特效也是 AI 生图吗还是特效转场就可以实现？」
    #          「只是利用 FFMPEG 加动态 PPT + AI 代码一些特效来实现，脚本增效。」
    # 断言口径（沿用第 8 节那条做法）：① 每个新模版都"真的在变"（grep 到逐帧机制，
    #   **禁止裸 w= 表达式** —— drawbox 的 w/h 只在初始化求值一次 = 假动画）；
    #   ② 老主题**不启用**新模版（字段级 + 帧级各一条）；③ 防回退 grep。
    _news2, _dark2 = theme_of('news'), theme_of('dark')
    # ① 缺省矩阵：编辑风全开 / 老主题全关 / 可显式开关 / 自造值回缺省
    _po_news = R.plate_opts({}, _news2)
    chk(_po_news == {'frame': 'thin', 'shadow': 'soft', 'float': 'slow',
                     'wipe': 'left', 'bgblur': 'soft'},
        'B 组缺省（编辑风 news）：thin/soft/slow/left/soft 全开', str(_po_news))
    chk(R.plate_opts({}, _dark2) is None, 'B 组缺省（老主题 dark）：不启用卡片版式')
    chk(R.plate_opts({}, theme_of('mono')) is None, 'B 组缺省（老主题 mono）：不启用卡片版式')
    chk(R.plate_opts({'frame': 'none'}, _news2) is None,
        'B 组可显式关掉：frame=none → 整块卡片版式关闭（一条字段就够）')
    chk(R.plate_opts({'frame': 'auto'}, _dark2) is None,
        'B 组 frame=auto 老主题 → 仍不启用')
    chk(R.plate_opts({'frame': 'thin'}, _dark2) is not None,
        'B 组也可显式打开老主题（frame=thin）')
    _po_pol = R.plate_opts({'frame': 'polaroid', 'shadow': 'strong', 'float': 'none',
                            'wipe': 'center', 'bgblur': 'none'}, _news2)
    chk(_po_pol == {'frame': 'polaroid', 'shadow': 'strong', 'float': 'none',
                    'wipe': 'center', 'bgblur': 'none'},
        'B 组字段白名单直通（polaroid/strong/none/center/none）', str(_po_pol))
    chk(R.plate_opts({'frame': '不要脸', 'shadow': '！', 'wipe': '乱写', 'float': '?'}, _news2)
        == _po_news, 'B 组自造值 → 回缺省（绝不把渲染搞挂）')
    chk(R.plate_opts({'shadow': 'none', 'float': 'none', 'wipe': 'none', 'bgblur': 'none'}, _news2)
        == {'frame': 'thin', 'shadow': 'none', 'float': 'none', 'wipe': 'none',
            'bgblur': 'none'},
        'B 组各字段可单独关掉（frame 仍在 = 卡片版式仍在）')

    # ② 每个模版"真的在变" + 老主题不启用（字段级 / 帧级）
    _wd2 = tempfile.mkdtemp(prefix='vf-tplB-')
    _timg = os.path.join(_wd2, 'b_src.jpg')
    # 帧级断言另用一张**渐变图**：纯色图会被 VF_MATGUARD 判成"深色界面截图" → 老 bgimage 会走
    #   "换质感底板"那条路，就看不到老 Ken Burns 了（第一版自检正是栽在这）。
    _timg2 = os.path.join(_wd2, 'b_src2.jpg')
    try:
        subprocess.run([ff, '-v', 'error', '-y', '-f', 'lavfi',
                        '-i', 'gradients=s=1280x720:c0=0x2b4a5a:c1=0x9ab0c0',
                        '-frames:v', '1', _timg2], capture_output=True, timeout=30)
    except Exception:
        _timg2 = ''
    _timg2 = _timg2 if os.path.exists(_timg2) else ''
    if not ff or not _mk_img(ff, _timg, 1280, 720, '0x2b4a5a'):
        _BAD.append('B 组：造测试图失败，卡片链断言跳过')
    else:
        def _chain(opts, th=_news2, layout='top', shot_extra=None):
            _s = {'type': 'bgimage', 'src': _timg, 'text': '库存 1700 万', 'kicker': '前线专栏',
                  'en': 'stock crisis', 'dur': 4, '_idx': 0}
            _s.update(shot_extra or {})
            return R._plate_pre(_timg, 1280, 720, _s, th, opts, dur=4, layout=layout) or ''

        _full = _chain(_po_news)
        chk(_full.endswith('[smooth];'), 'B 组卡片链：末尾产出 [smooth]（与 _bg_filters 同契约）')
        # 圆角 + 相框（thin）
        chk('geq=lum=' in _full and 'alphamerge' in _full,
            'B 组圆角：geq 几何 alpha 遮罩 + alphamerge（真圆角，不是贴图）')
        chk('geq=lum=' in _full and "geq=a='" not in _full,
            'B 组圆角：走 geq=lum 灰度遮罩（**不是**只写 a 那种写法 —— 实测会报'
            ' "luminance or RGB expression is mandatory"）')
        chk(_full.count('drawbox=') >= 2 and ':t=fill' in _full,
            'B 组细边框：卡边上画了细描边 drawbox（另有一块左上强调色小块 t=fill）',
            'drawbox=%d' % _full.count('drawbox='))
        # 相框 polaroid = 白边 pad
        _pol = _chain({'frame': 'polaroid', 'shadow': 'soft', 'float': 'none',
                       'wipe': 'none', 'bgblur': 'soft'})
        chk('pad=w=' in _pol and 'color=white' in _pol, 'B 组相框 polaroid：白边用 pad 落在卡片图层上')
        chk('color=white' not in _full, 'B 组相框 thin：不铺白边（与 polaroid 区分开）')
        # 阴影：变黑 + 透明画布 + 卡片压阴影（顺序敏感）
        chk('colorchannelmixer=rr=0' in _full and 'aa=' in _full,
            'B 组阴影：卡片形状复制 → colorchannelmixer 变黑 + alpha 降到半透明')
        chk('color=black@0' in _full and '[shp][cnp]overlay=x=0:y=0[lyA]' in _full,
            'B 组阴影：阴影/卡片各 pad 到同一张透明画布，且**卡片压在阴影上**（否则卡片被压暗）')
        _nos = _chain({'frame': 'thin', 'shadow': 'none', 'float': 'none',
                       'wipe': 'none', 'bgblur': 'soft'})
        chk('colorchannelmixer' not in _nos, 'B 组阴影：shadow=none → 不生成阴影层')
        # 背景分层（bgblur 可控强度）
        chk('gblur=sigma=14' in _full, 'B 组背景分层：bgblur=soft → gblur=sigma=14（可控强度）')
        chk('gblur=sigma=30' in _chain({'frame': 'thin', 'shadow': 'none', 'float': 'none',
                                        'wipe': 'none', 'bgblur': 'strong'}),
            'B 组背景分层：bgblur=strong → gblur=sigma=30')
        chk('gblur' not in _chain({'frame': 'thin', 'shadow': 'none', 'float': 'none',
                                   'wipe': 'none', 'bgblur': 'none'}).split('[bgb];')[0],
            'B 组背景分层：bgblur=none → 背景不虚化')
        # 浮动（overlay x/y 逐帧）
        chk('sin(2*PI*t/' in _full, 'B 组浮动：overlay 的 y 用逐帧 t 表达式（真在漂，不是静态偏移）')
        chk('sin(2*PI*t/' not in _chain({'frame': 'thin', 'shadow': 'none', 'float': 'none',
                                         'wipe': 'none', 'bgblur': 'soft'}),
            'B 组浮动：float=none → 不加逐帧表达式')
        _flx = _chain({'frame': 'thin', 'shadow': 'none', 'float': 'slow',
                       'wipe': 'none', 'bgblur': 'soft'}, shot_extra={'_idx': 1})
        chk('overlay=x=' in _flx and 'sin(2*PI*t/' in _flx.split('overlay=x=')[1][:80]
            and 'sin(2*PI*t/' not in _flx.split('overlay=x=')[1].split('y=')[1][:40],
            'B 组浮动：按镜序轮换方向（偶数镜上下浮 / 奇数镜左右浮）')
        # 擦入/展开（enable 分段；禁止裸 w= 假动画）
        chk("enable='gte(t," in _full, 'B 组擦入：按时间点分段插入（真动画）')
        chk("w='" not in _full, 'B 组擦入：没有裸 w= 表达式（那会退回假动画）', "w='...'")
        chk(_full.count('crop=w=') == 12 and _full.count("enable='gte(t,") == 12,
            'B 组擦入：卡片被切成 12 条、每条一个 enable（条数写死在这里防误改）',
            'crop=%d enable=%d' % (_full.count('crop=w='), _full.count("enable='gte(t,")))

        def _wtimes(chain):
            return [float(x) for x in _re.findall(r"gte\(t,(\d+\.\d+)\)", chain)]

        def _wo(wipe):
            return _chain({'frame': 'thin', 'shadow': 'none', 'float': 'none',
                           'wipe': wipe, 'bgblur': 'soft'})

        _tl, _tr, _tc = _wtimes(_wo('left')), _wtimes(_wo('right')), _wtimes(_wo('center'))
        chk(bool(_tl) and _tl == sorted(_tl),
            'B 组擦入 left：从左往右的时间序列递增（左条先亮）', str(_tl[:4]))
        chk(bool(_tr) and _tr == sorted(_tr, reverse=True),
            'B 组擦入 right：时间序列递减（右条先亮）', str(_tr[:4]))
        _ci = _tc.index(min(_tc)) if _tc else -1
        chk(bool(_tc) and 4 <= _ci <= 7 and _tc[_ci - 1] < _tc[0],
            'B 组擦入 center：中间条最先亮、再向两侧展开（argmin 落在中段）',
            'argmin=%d %s' % (_ci, str(_tc[:6])))
        chk("enable='gte(t," not in _wo('none'), 'B 组擦入：wipe=none → 不切条、不加 enable')
        # ③ 帧级：老主题不启用 / 编辑风启用 + 旁路 zoompan
        _bshot = {'type': 'bgimage', 'src': _timg2 or _timg, 'text': '标题', 'kicker': '标签',
                  'dur': 3}
        _vd = R.card_bgimage(dict(_bshot), _dark2, 1280, 720, 25)[1]
        chk('alphamerge' not in _vd and 'geq=lum=' not in _vd,
            '老主题 bgimage（帧级）：完全不启用 B 组卡片版式')
        chk('zoompan' in _vd, '老主题 bgimage（帧级）：仍走老 Ken Burns（观感不变）')
        _vn = R.card_bgimage(dict(_bshot), _news2, 1280, 720, 25)[1]
        chk('alphamerge' in _vn and "enable='gte(t," in _vn and 'sin(2*PI*t/' in _vn,
            '编辑风 bgimage（帧级）：圆角+擦入+浮动真的接进了渲染链')
        chk('zoompan' not in _vn,
            '编辑风 bgimage（帧级）：卡片版式旁路 zoompan（否则擦入会被冻在输入第 0 帧）')
        _vid = R.card_image({'type': 'image', 'src': _timg, 'dur': 3}, _news2, 1280, 720, 25)[1]
        chk('alphamerge' in _vid, '编辑风 image 卡（帧级）：启用 B 组卡片版式')
        _vid2 = R.card_image({'type': 'image', 'src': _timg, 'dur': 3}, _dark2, 1280, 720, 25)[1]
        chk('alphamerge' not in _vid2 and 'zoompan' in _vid2,
            '老主题 image 卡（帧级）：仍是老 Ken Burns（不启用 B 组）')
        _vid3 = R.card_image({'type': 'image', 'src': _timg, 'dur': 3, 'frame': 'none'},
                             _news2, 1280, 720, 25)[1]
        chk('alphamerge' not in _vid3 and 'zoompan' in _vid3,
            'B 组可显式关掉（帧级）：编辑风 + frame=none → 回到老铺法')
    # ③ 防回退：本轮点名的标记一个都不许丢
    for _mk in ('★VF_TPL_B1_V1', '★VF_FILTERJOIN_V1', '★VF_MATGUARD_V2', '★VF_MATGUARD_V3',
                '★VF_MOTION_V2', '★VF_TITLEFIT_V3', '★VF_STYLE_V1', '★VF_MOTIONPPT_V1',
                '★VF_EDITBIGTEXT_V1', '★VF_BANNER_EMPTY_V1', '★VF_BANNER_FIT_V1',
                '★VF_ENVINFO_V1', '★VF_TPL_LAND_V1'):
        chk(_src.count(_mk) >= 1, '防回退：%s 仍在 render.py 里' % _mk, '一处都没有了')
    chk('frameBg' in _src and 'frameBg' in open(os.path.join(_VF, 'themes.py'),
                                                encoding='utf-8').read(),
        'B 组主题 token：frameBg（拍立得白边色）在 themes.py 与 render.py 都在位')

    # ══ 12. ★VF_TPL_LAND_V1（2026-09-30）横屏「左图右字」 ═════════════════════════
    # 用户实测：1280×720 横屏 + 竖素材 768×1344，走老 layout='top' 时卡片只有 212×374
    #   （占 16.5%W × 52%H）→ 左右大片虚化/死黑、版面很空。
    # 新 layout='side' = 素材站左边、右侧整块留给大字。断言口径：
    #   ① 三条触发条件缺一不可（不满足 = 一行都不改 → 零回归）；② 老调用方拿到的 x 表达式逐字不变；
    #   ③ 与 TS 服务端白名单对账（防两边漂移 —— 与 vf-i2v-selftest 同思路）。
    _ROOT = os.path.dirname(_HERE)
    _wd3 = tempfile.mkdtemp(prefix='vf-land-')
    _pimg = os.path.join(_wd3, 'p_768x1344.jpg')     # 竖素材
    _wimg = os.path.join(_wd3, 'w_1920x1080.jpg')    # 横素材
    _simg = os.path.join(_wd3, 's_800x800.jpg')      # 方素材
    if not ff:
        _BAD.append('★VF_TPL_LAND_V1：找不到 ffmpeg（无法造测试图）')
    else:
        for _p, _w, _h in ((_pimg, 768, 1344), (_wimg, 1920, 1080), (_simg, 800, 800)):
            if not _mk_img(ff, _p, _w, _h):
                _BAD.append('★VF_TPL_LAND_V1：造图失败 %s' % os.path.basename(_p))
        # ① 触发条件（横屏 + 竖/方素材 + 该镜要叠大字）——缺一不可
        chk(R.plate_side_layout(_pimg, 1280, 720, True) == 'side',
            'land：横屏 + 竖素材(768x1344) + 有大字 → side')
        chk(R.plate_side_layout(_simg, 1280, 720, True) == 'side',
            'land：横屏 + 方素材(800x800，比 1.0 ≤1.15) → side')
        chk(R.plate_side_layout(_pimg, 720, 1280, True) == '',
            'land：竖屏画幅(720x1280) → 不动（零回归）')
        chk(R.plate_side_layout(_wimg, 1280, 720, True) == '',
            'land：横素材(1920x1080，比 1.78>1.15) → 不动（走老 top）')
        chk(R.plate_side_layout(_pimg, 1280, 720, False) == '',
            'land：本镜不叠大字 → 不动')
        chk(R.plate_side_layout(os.path.join(_wd3, 'not-exist.jpg'), 1280, 720, True) == '',
            'land：素材读不出尺寸 → 不动（绝不弄挂出片）')
        # ② 大字区接口：side 右移；其余 layout 一律 0（老调用方逐字不变）
        chk(R.plate_text_x(1280, 720, 'side') == int(1280 * 0.52),
            'land：side → 大字起始 x = 0.52W', str(R.plate_text_x(1280, 720, 'side')))
        chk(R.plate_text_x(1280, 720, 'top') == 0 and R.plate_text_x(1280, 720, 'center') == 0,
            'land：top/center → 大字起始 x = 0（老逻辑逐字不变）')
        # ③ 卡片链：side 下卡片落在左半区、末尾仍产出 [smooth]（与 _bg_filters 同契约）
        _sb_land = {'type': 'bgimage', 'src': _pimg, 'text': '库存 1700 万', 'kicker': '前线专栏',
                    'dur': 4, '_idx': 0}
        _side_chain = R._plate_pre(_pimg, 1280, 720, _sb_land, _news2, _po_news, dur=4,
                                   layout='side') or ''
        chk(_side_chain.endswith('[smooth];'), 'land：side 卡片链末尾产出 [smooth]')
        #   注：卡片图层最靠右的那条 overlay（擦入是 12 条 + 浮动偏移）→ 取 max 才是"卡片右缘"
        _mx_side = max([int(x) for x in _re.findall(r'overlay=x=(\d+)', _side_chain)] or [-1])
        chk(0 < _mx_side < 1280 * 0.5,
            'land：side 的卡片落在左半区', 'max overlay x=%d' % _mx_side)
        _top_chain = R._plate_pre(_pimg, 1280, 720, _sb_land, _news2, _po_news, dur=4,
                                  layout='top') or ''
        _mx_top = max([int(x) for x in _re.findall(r'overlay=x=(\d+)', _top_chain)] or [-1])
        chk(_mx_side > 0 and _mx_top > 0 and _mx_side < _mx_top,
            'land：同一素材下 side 的卡片比 top 更靠左（左图右字）', '%d vs %d' % (_mx_side, _mx_top))
        # ④ 帧级：编辑风 + 竖素材 → 大字层真的被推到右侧；老主题 → 一个像素都不动
        _lm_l = int(1280 * 0.07)                       # 老的左侧 7% 安全边
        _lm_r = _lm_l + R.plate_text_x(1280, 720, 'side')   # side：右移到 0.52W
        _ed_side, _, _fs_side = R._editorial_bigtext(
            dict(_sb_land), _news2, 1280, 720, 4, R.big_fs(1280, 720, 0.10, 44),
            _news2['text'], x_off=R.plate_text_x(1280, 720, 'side'))
        _ed_top, _, _ = R._editorial_bigtext(
            dict(_sb_land), _news2, 1280, 720, 4, R.big_fs(1280, 720, 0.10, 44), _news2['text'])
        _js = ','.join(_ed_side)
        _jt = ','.join(_ed_top)
        chk(_fs_side > 0 and ('x=%d' % _lm_r) in _js,
            'land：_editorial_bigtext(x_off) 把大字块右移到 0.52W+7%', 'x=%d' % _lm_r)
        chk(('x=%d' % _lm_l) in _jt and ('x=%d' % _lm_r) not in _jt,
            'land：x_off 缺省(0) → 大字块仍在老的 7% 左边距（逐字不变）')

        def _dt_xs(chain):
            """只从 drawtext 段里取 x=（逗号分割后每段的首片仍带 :x=NNN）"""
            out = []
            for _seg in str(chain).split(','):
                if _seg.startswith('drawtext='):
                    _m = _re.search(r':x=(\d+)', _seg)
                    if _m:
                        out.append(int(_m.group(1)))
            return out

        _vn = R.card_bgimage(dict(_sb_land), _news2, 1280, 720, 25)[1]
        _xs = _dt_xs(_vn)
        chk(bool(_xs) and min(_xs) >= 640,
            'land：编辑风图镜（帧级）的大字全部落在右半幅（x ≥ 640）', str(_xs[:6]))
        # ⚠️ 这条是"接线闸门"：光有大字右移还不够 —— 必须证明 card_bgimage 真的把 layout='side'
        #   传给了 _plate_pre（第一版就漏了这一处：大字右移了、卡片还留在中间，靠这条才发现）。
        _ovn = max([int(x) for x in _re.findall(r'overlay=x=(\d+)', _vn)] or [-1])
        chk(0 < _ovn < 640,
            'land：编辑风图镜（帧级）的卡片真的落在左半区（layout 真的传给了 _plate_pre）',
            'max overlay x=%d' % _ovn)
        _vb = R.card_bgimage({'type': 'bgimage', 'src': _wimg, 'text': '库存 1700 万',
                              'kicker': '前线专栏', 'dur': 4}, _news2, 1280, 720, 25)[1]
        _xb = _dt_xs(_vb)
        chk(bool(_xb) and min(_xb) < 640,
            'land：横素材（不满足条件，帧级）→ 大字仍走老的左侧 7% 边距（零回归）', str(_xb[:6]))
        _vd3 = R.card_bgimage(dict(_sb_land), _dark2, 1280, 720, 25)[1]
        chk('x=(w-text_w)/2+' not in _vd3 and 'x=(w-text_w)/2' in _vd3,
            'land：老主题(dark) → 大字仍是老居中表达式（x 一个字符都没改）')
    # ⑤ 与 TS 服务端白名单对账（防 render.py / anti-ai.ts 两边漂移）
    _ts_src = ''
    try:
        _ts_src = open(os.path.join(_ROOT, 'src/lib/agent/vf/anti-ai.ts'), encoding='utf-8').read()
    except Exception as e:
        _BAD.append('读 anti-ai.ts 失败：%s' % str(e)[:80])

    def _ts_arr(name):
        m = _re.search(r"%s\s*=\s*\[([^\]]*)\]" % name, _ts_src)
        return [x.strip().strip("'\"") for x in m.group(1).split(',') if x.strip()] if m else None

    for _py, _ts in (('PLATE_FRAMES', 'VF_PLATE_FRAMES'), ('PLATE_SHADOWS', 'VF_PLATE_SHADOWS'),
                     ('PLATE_FLOATS', 'VF_PLATE_FLOATS'), ('PLATE_WIPES', 'VF_PLATE_WIPES'),
                     ('PLATE_BLURS', 'VF_PLATE_BGBLURS')):
        chk(_ts_arr(_ts) == list(getattr(R, _py)),
            'land 对账：render.py %s = anti-ai.ts %s' % (_py, _ts),
            '%s vs %s' % (list(getattr(R, _py)), _ts_arr(_ts)))
    # PICK_DESIGN_KEYS 必须收下这 5 个 B 组字段（否则 AI 写的值会在归一化时被静默丢掉）
    _pdk = _ts_src.split('PICK_DESIGN_KEYS', 1)[1].split(']')[0] if 'PICK_DESIGN_KEYS' in _ts_src else ''
    for _k in ('frame', 'shadow', 'float', 'wipe', 'bgblur'):
        chk("'%s'" % _k in _pdk, 'land：PICK_DESIGN_KEYS 收了 %s（AI 写的值不会被丢）' % _k)
    # ⑥ 动效接线（★VF_MOTIONPPT_WIRE_V1）：常量 + 兜底函数两条线都真的接上了
    chk('★VF_MOTIONPPT_WIRE_V1' in _ts_src and 'VF_MOTION_PROMPT' in _ts_src
        and 'ensurePersistentMotion' in _ts_src,
        '动效接线：anti-ai.ts 有 ★VF_MOTIONPPT_WIRE_V1（VF_MOTION_PROMPT + ensurePersistentMotion）')
    for _f in ('src/lib/agent/vf/vf-video.ts', 'src/app/api/agent/chat/route.ts'):
        try:
            _s2 = open(os.path.join(_ROOT, _f), encoding='utf-8').read()
        except Exception:
            _s2 = ''
        chk('VF_MOTION_PROMPT' in _s2, '动效接线：%s 的提示词已接 VF_MOTION_PROMPT' % _f)
        chk('ensurePersistentMotion' in _s2, '动效接线：%s 已接 ensurePersistentMotion 兜底' % _f)

    # ══ 13. ★VF_SUSTAIN_V1（2026-10-01）【持续型动效】上量 ═══════════════════════
    # 用户原话：「PPT动效还是不显著，你看是不是只能如此了。到顶了。」
    # 根因（渲染层自查）：到上一版为止每一镜的动效**全是入场型**（0.25~0.5 秒做完就静止）→
    #   长镜里就是"动一下就不动"。本批补 A1 强调条慢生长 / A2 大字呼吸 / A3 卡片浮动加强 /
    #   A4 底部进度细线。断言口径沿用第 8/11 节：每条都要 grep 到**逐帧机制**
    #   （enable 分段 / sin(t)——drawbox 的 w/h 只在初始化求值一次，那是假动画），且不许出现裸 w=。
    _dark6 = theme_of('dark')
    _t6 = R.card_title({'type': 'title', 'text': '库存告急', 'dur': 6}, _dark6, 1280, 720, 25)[1]
    chk(abs(R.grow_secs(0.6) - 0.45) < 1e-6, 'A1：短镜强调条仍是 0.45s 的克制值', str(R.grow_secs(0.6)))
    chk(R.grow_secs(6.0) >= 2.0, 'A1：长镜强调条生长拉到 ≥2s（治"动一下就不动"）', str(R.grow_secs(6.0)))
    chk(_t6.count("enable='gte(t,") >= 6,
        'A1：标题卡**默认**就走慢生长（≥6 段 enable，不再只在 motion=grow 时）',
        'enable=%d' % _t6.count("enable='gte(t,"))
    _gv = R.grow_v_filters(40, 100, 8, 300, 'white@0.95', 6.0, grow=R.grow_secs(6.0), seg=12)
    chk(len(_gv) >= 8 and all("enable='gte(t," in x for x in _gv)
        and all(':h=' in x for x in _gv) and "w='" not in ' '.join(_gv),
        'A1：竖直强调条走 enable 分段长**高度**（不是横向撑宽）', 'n=%d' % len(_gv))
    chk('sin(2*PI*t/' in R.breath_alpha(6), 'A2：呼吸表达式用逐帧 sin')
    chk("alpha='min(t/0.5,1)*(" in _t6 and 'sin(2*PI*t/' in _t6,
        'A2：标题卡大字 alpha = 入场渐入 × 呼吸项（持续起伏）')
    chk(R.center_lines_drawtext('f', ['字'], 40, 'white', 1280, 720, 5)[0].count('sin(') == 0,
        'A2：breath 缺省(False) → alpha 与改动前逐字相同（老调用方零回归）')
    _pr = R.progress_filters(1280, 720, 6.0, 'white@0.5', seg=12)
    chk(len(_pr) == 12 and all("enable='gte(t," in x for x in _pr)
        and "w='" not in ' '.join(_pr),
        'A4：底部进度细线走 enable 分段（真逐帧，不是假动画）', 'n=%d' % len(_pr))
    _prx = R.progress_filters(1280, 720, 6.0, 'white@0.5', seg=6, x0=100, w=400)
    chk(bool(_prx) and all(x.startswith('drawbox=x=100:') for x in _prx),
        'A4：x0/w 支持"只在版面区域内走"（deck 素材页用）', str(_prx[:1])[:60])
    chk('progress_filters(' in _rs and 'sustain_of(shot)' in _rs,
        'A4：render_shot 已把进度细线接进纯文字卡（一处接线覆盖全部文字卡型）')
    chk(R.sustain_of({'sustain': 'none'}) is False and R.sustain_of({}) is True,
        '总开关：shot[sustain]=none 可单镜关掉持续动效；缺省开')
    if ff:
        _wdS = tempfile.mkdtemp(prefix='vf-sustain-')
        _imgS = os.path.join(_wdS, 's.jpg')
        # 素材镜（B 组卡片版式）的浮动：增强后的振幅必须明显大于老的 0.014H
        if _mk_img(ff, _imgS, 1280, 720, '0x2b4a5a'):
            _poS = R.plate_opts({'float': 'slow', 'wipe': 'none'}, theme_of('news'))
            _chS = R._plate_pre(_imgS, 1280, 720,
                                {'type': 'bgimage', 'src': _imgS, 'text': '标题', 'dur': 6, '_idx': 0},
                                theme_of('news'), _poS, dur=6, layout='top') or ''
            _amps = [int(x) for x in _re.findall(r'(\d+)\*sin\(2\*PI\*t/', _chS)]
            _old = max(4, int(720 * 0.014))
            chk(bool(_amps) and max(_amps) >= 2 * _old - 2,
                'A3：B 组卡片浮动振幅 ≈×2（旧 %dpx → 新 ≥%dpx，治"看不出动"）' % (_old, 2 * _old - 2),
                str(_amps))
    chk('★VF_SUSTAIN_V1' in _src, '防回退：★VF_SUSTAIN_V1 仍在 render.py 里')

    # ══ 13b. ★VF_LINEBREAK_V2 / ★VF_SUBTITLE_NOELLIPSIS_V1（2026-10-01）字幕断行 ══════
    # ① 规则表与 src/lib/agent/vf/anti-ai.ts **逐字对账**（硬断言，防两边漂移）。
    _m_tail = _re.search(r"VF_KINSOKU_TAIL\s*=\s*'([^']*)'", _ts_src)
    _m_head = _re.search(r"VF_KINSOKU_HEAD\s*=\s*'([^']*)'", _ts_src)
    _m_back = _re.search(r"VF_KINSOKU_BACK\s*=\s*(\d+)", _ts_src)
    chk(_m_tail and _m_tail.group(1) == R.VF_KINSOKU_TAIL,
        'LINEBREAK 对账：VF_KINSOKU_TAIL 与 anti-ai.ts 逐字一致',
        'ts=%s py=%s' % (_m_tail.group(1) if _m_tail else '?', R.VF_KINSOKU_TAIL))
    chk(_m_head and _m_head.group(1) == R.VF_KINSOKU_HEAD,
        'LINEBREAK 对账：VF_KINSOKU_HEAD 与 anti-ai.ts 逐字一致',
        'ts=%s py=%s' % (_m_head.group(1) if _m_head else '?', R.VF_KINSOKU_HEAD))
    chk(_ts_arr('VF_KINSOKU_NOPAIR') == list(R.VF_KINSOKU_NOPAIR),
        'LINEBREAK 对账：VF_KINSOKU_NOPAIR 与 anti-ai.ts 逐字一致',
        'ts=%s py=%s' % (_ts_arr('VF_KINSOKU_NOPAIR'), list(R.VF_KINSOKU_NOPAIR)))
    chk(_m_back and int(_m_back.group(1)) == R.VF_KINSOKU_BACK,
        'LINEBREAK 对账：VF_KINSOKU_BACK 与 anti-ai.ts 一致',
        'ts=%s py=%s' % (_m_back.group(1) if _m_back else '?', R.VF_KINSOKU_BACK))
    # ② 四类非法切口（行尾虚词 / 行首收尾标点 / 数字+单位·字母数字 / 成对词）
    chk(not R.kinsoku_cut_ok('这是重点的句子', 5), 'LINEBREAK：行尾落虚词「的」→ 非法')
    chk(not R.kinsoku_cut_ok('句子，后面', 2), 'LINEBREAK：行首落收尾标点「，」→ 非法')
    chk(not R.kinsoku_cut_ok('价格150万起', 5), 'LINEBREAK：切进「150万」（数字+中文单位）→ 非法')
    chk(not R.kinsoku_cut_ok('涨了8.5%哦', 4) and not R.kinsoku_cut_ok('涨了8.5%哦', 5),
        'LINEBREAK：切进「8.5%」（字母数字串）→ 非法')
    chk(not R.kinsoku_cut_ok('abcdefghij', 4), 'LINEBREAK：切进英文单词 → 非法')
    chk(not R.kinsoku_cut_ok('AI一键生成', 5) and not R.kinsoku_cut_ok('生成', 1)
        and R.kinsoku_cut_ok('AI一键生成', 3),
        'LINEBREAK：拆开成对词「生成」→ 非法（未拆开的切口放行）')
    chk(R.kinsoku_cut_ok('这是重点的句子', 4) and R.kinsoku_cut_ok('句子，后面', 3),
        'LINEBREAK：合法切口 → 放行')
    # ③ 只往回退：窗口内找不到合法点 → 保持原切口（不硬造）
    chk(R.kinsoku_cut('abcdefghij', 0, 4) == 4,
        'LINEBREAK：窗口内找不到合法点 → 保持原切口', str(R.kinsoku_cut('abcdefghij', 0, 4)))
    chk(R.kinsoku_cut('图里这款手表海报，就是AI一键生成，点击率预测高达8.5%，', 0, 16) == 15,
        'LINEBREAK：真句切口与 anti-ai.ts::pickKinsokuCut 同解（回退到 15，保住「生成」）',
        str(R.kinsoku_cut('图里这款手表海报，就是AI一键生成，点击率预测高达8.5%，', 0, 16)))
    # ④ 一字不丢 / 任何输入都不产生「…」
    _SUB_CASES = [
        '图里这款手表海报，就是AI一键生成，点击率预测高达8.5%，',
        '营销方案都能自动输出，', '转化率达到150万，30秒搞定',
        '这是一个非常长的句子需要折行处理否则会显示不全测试',
        '结尾是虚词就', 'x' * 257,
    ]
    _loss = []
    for _cs in _SUB_CASES:
        _flat = ''.join(_cs.split())
        _rows, _rfs = R._sub_rows(_flat, 1280, 26, 16)
        if '…' in ''.join(_rows) or ''.join(_rows) != _flat:
            _loss.append('rows:' + _flat[:12])
        _wt = R.wrap_subtitle(_cs, 16, 2)
        if '…' in _wt or ''.join(_wt.split('\n')) != _flat:
            _loss.append('wrap:' + _flat[:12])
    chk(not _loss, 'NOELLIPSIS：字幕折行一字不丢、任何输入都不产生「…」', str(_loss))
    _s0 = R.wrap_subtitle('图里这款手表海报，就是AI一键生成，点击率预测高达8.5%，', 16, 2)
    chk(_s0 == '图里这款手表海报，就是AI一键\n生成，点击率预测高达8.5%，',
        'NOELLIPSIS：基线真句 30 字完整显示（旧实现只显示 18 字 + 「…」）', repr(_s0))
    # ⑤ 零回归：短字幕 / 已达标字幕的 _sub_rows 输出必须与改前逐字一致
    chk(R._sub_rows('营销方案都能自动输出，', 1280, 26, 16) == (['营销方案都能自动输出，'], 26),
        'NOELLIPSIS 零回归：短字幕 _sub_rows 逐字不变')
    _r0, _f0 = R._sub_rows('图里这款手表海报，就是AI一键生成，点击率预测高达8.5%，', 1280, 26, 16)
    chk(_r0 == ['图里这款手表海报，就是AI一键', '生成，点击率预测高达8.5%，'] and _f0 == 26,
        'LINEBREAK：基线句 ASS 路径断口回退到 15（保住「生成」，不再切成"一键生/成"，旧版=16 硬切）',
        str(_r0))
    chk(''.join(_r0) == '图里这款手表海报，就是AI一键生成，点击率预测高达8.5%，',
        'NOELLIPSIS：ASS 路径 rows 拼回 === 原文（一字不丢）')
    chk("'…'" not in _seg(_code, 'wrap_subtitle', 'overlay_text_on')
        and _seg(_code, '_sub_rows', 'overlay_text_on'),
        'NOELLIPSIS：源码里 _sub_rows / wrap_subtitle 已无「…」截断分支（docstring 里的「…」不算）')
    chk(_src.count('★VF_LINEBREAK_V2') >= 1 and _src.count('★VF_SUBTITLE_NOELLIPSIS_V1') >= 1,
        '防回退：★VF_LINEBREAK_V2 / ★VF_SUBTITLE_NOELLIPSIS_V1 仍在 render.py 里')

    # ══ 13c. ★VF_BITRATE_V1（2026-10-01）出片码率：按分辨率定量、绝不写死低码率 ══════════
    # 老板真片 1280×720/25fps/56.64s = **353kbps**（2.39MB）→ 720p 给 353kbps，画面本身就糊。
    _a720 = R.venc_args(1280, 720)
    _a1080 = R.venc_args(1920, 1080)
    _a1440 = R.venc_args(2560, 1440)
    chk('-crf 20' in _a720 and '-preset veryfast' in _a720 and '-pix_fmt yuv420p' in _a720,
        'BITRATE：720p → CRF 20 + preset veryfast + yuv420p（不再用 -preset fast）', _a720)
    chk('-crf 19' in _a1080 and '-crf 18' in _a1440,
        'BITRATE：1080p→CRF19 / ≥1440p→CRF18（分辨率越高越给质量）',
        '%s | %s' % (_a1080, _a1440))
    chk('-preset fast' not in _a720 and 'veryfast' in _a720,
        'BITRATE：preset 换成 veryfast（比 fast 更快，不给老板加等待）')
    chk(R.venc_argv(1280, 720) == _a720.split(' ') and '-crf' in R.venc_argv(1280, 720),
        'BITRATE：参数数组版 venc_argv 与字符串版一致（★VF_LONGCMD_V1 超长链也吃到新参数）')
    # 源码级：6 处编码点全部改口，且**一律走 argv 数组**（★VF_ARGV_V1 2026-10-01 治本后，
    # 不再有"把编码参数拼进 shell 字符串"的写法；口径随之从 venc_args 改成 venc_argv）。
    chk("venc_argv(W, H) + ['-r', str(fps), '-t', str(dur), out]" in _code,
        'BITRATE/ARGV：逐镜编码走 venc_argv（第 1 处，参数数组）')
    chk(_code.count("venc_argv(W, H) + ['-r', str(fps), out]") == 2,
        'BITRATE/ARGV：交叉溶解 + 拼接 两处走 venc_argv（第 2/3 处）',
        str(_code.count("venc_argv(W, H) + ['-r', str(fps), out]")))
    chk(_code.count("venc_argv(W, H) + ['-c:a', 'copy', out]") == 2,
        'BITRATE/ARGV：烧标题 + 烧字幕 两处走 venc_argv（第 4/5 处；ASS/SRT 已合成一处 argv）',
        str(_code.count("venc_argv(W, H) + ['-c:a', 'copy', out]")))
    chk('{venc_args(W, H)}' not in _code,
        'ARGV：源码里已无"把编码参数拼进 shell 字符串"的写法（★VF_ARGV_V1 治本）')
    # ★VF_ARGV_V1 防回退：代码里不得再出现 shell=True / os.system / os.popen（注释行已在 _code 里剔除）
    chk('shell=True' not in _code,
        'ARGV 防回退：render.py 代码里 0 处 shell=True')
    chk('os.system(' not in _code and 'os.popen(' not in _code,
        'ARGV 防回退：render.py 代码里 0 处 os.system / os.popen')
    chk("'-preset', 'fast'" not in _code and '-preset fast -pix_fmt' not in _code,
        'BITRATE：源码里已无 `-preset fast` 编码点（零残留）')
    chk('-b:v' not in _src and '-maxrate' not in _src,
        'BITRATE：不用固定码率 / 不用 -maxrate（CRF 内容自适应；固定码率正是"复杂帧糊"的根因）')
    chk(_src.count('★VF_BITRATE_V1') >= 1, '防回退：★VF_BITRATE_V1 仍在 render.py 里')

    # ══ 13d. ★VF_DECK_PIXEL_V2（2026-10-01）渐变速度"测试钩子"：生产默认必须仍是 0.015 ══
    # 背景：lavfi `gradients` 的动画相位**随进程**变化（同 t 两次独立 ffmpeg 的帧 MD5 不同）→
    # 只要渐变在动，任何"跨渲染像素相等"的断言都必然时红时绿（team-lead 复跑撞到）。
    # 测试用 `VF_GRAD_SPEED=0` 冻结它；**生产不设 → 必须逐字仍是 0.015**（否则就是悄悄改了画面）。
    chk(R._grad_speed() == '0.015',
        '★VF_DECK_PIXEL_V2：渐变速度默认 0.015（未设 VF_GRAD_SPEED 时与改前逐字一致）',
        str(R._grad_speed()))
    chk(not os.environ.get('VF_GRAD_SPEED'),
        '★VF_DECK_PIXEL_V2：自测进程不设 VF_GRAD_SPEED（验的就是生产默认路径）')

    # ══ 13e. ★VF_STYLES_V1（2026-10-01）成品风格：10 主题 × 6 版式 → 5 套人话名字 ══════════
    # 老板原话：「目前模版有2套我是不是有点乱。能统一一下吗？」「你写的那个什么玻璃什么分类有点抽象」
    #          「我做的几个目前配色都是蓝色」（→ 默认必须 = news/蓝，逐像素不变）。
    _styles = getattr(R, 'STYLES', {})
    chk(len(_styles) == 5, '★VF_STYLES_V1：正好 5 套成品风格（不再摆 10×6=60 种组合）', len(_styles))
    _def = _styles.get(getattr(R, 'DEFAULT_STYLE', ''), {})
    chk(getattr(R, 'DEFAULT_STYLE', '') == 'bluewhite' and _def.get('theme') == 'news'
        and _def.get('deck') == 'deck',
        '★VF_STYLES_V1：默认风格 = bluewhite = news + deck（= 老板现在看到的蓝，零视觉变化）', _def)
    chk(all(s.get('deck') in R.DECK_STYLE_VARIANTS for s in _styles.values()),
        '★VF_STYLES_V1：5 套的 deck 版式**全部取自白名单**（不新增 variant 名 → anti-ai.ts 对账不受影响）',
        [s.get('deck') for s in _styles.values()])
    chk(all(s.get('theme') in R.THEMES for s in _styles.values()),
        '★VF_STYLES_V1：5 套的 theme 全部是 themes.py 里已有的主题（不新造主题）',
        [s.get('theme') for s in _styles.values()])
    chk(all(s.get('enter') in R.PPT_ENTERS and float(s.get('period') or 0) >= 2.0
            for s in _styles.values()),
        '★VF_STYLES_V1：每套都带一套动效节奏（enter ∈ PPT_ENTERS + 浮动周期 ≥2s）')
    chk([s[0] for s in R.style_names() if _styles[s[0]].get('default')] == ['bluewhite'],
        '★VF_STYLES_V1：有且只有一套标了 default')
    chk((R.style_of('蓝白科技') or {}).get('id') == 'bluewhite'
        and (R.style_of('BLUEWHITE') or {}).get('id') == 'bluewhite',
        '★VF_STYLES_V1：风格名查找接受中文名/大小写（老板只说人话名字也能命中）')
    # ★VF_STYLES_STRICT_V1（2026-10-01 style-wire 抓到的静默事故，本机已复现）：
    #   `vf-aivideo.ts` 把 AI 制片线的风格标签（AI_STYLES = cinematic/commercial/vlog/…）写进 plan 根级
    #   `style`。若 style_of 对"认不出"回落默认 → 那条线一出片就被**静默改成 news 蓝 + deck**。
    #   口径：认不出 = None = apply_style 不干预（theme/deck_style/variant 一个字段都不碰）。
    chk(R.style_of('并不存在') is None and R.style_of('') is None and R.style_of('cinematic') is None,
        '★VF_STYLES_STRICT_V1：未知/空风格名 → None（不再回落默认）',
        repr(R.style_of('cinematic')))
    chk(R.style_default()['id'] == R.DEFAULT_STYLE,
        '★VF_STYLES_STRICT_V1：要默认值必须显式走 style_default()（不许拿它兜未知输入）')
    # ★VF_DECK_LIGHTFACE_V1：柔和高级的"低饱和"必须真落在 token 上（不能只是文案里写"低饱和"）
    _slx = _styles.get('softlux') or {}
    _accS = str((_slx.get('tokens') or {}).get('accent') or '')
    _rgbS = R._rgb_alpha(_accS)[0] if _accS else (0, 0, 0)
    _satS = (max(_rgbS) - min(_rgbS)) / float(max(1, max(_rgbS)))
    chk(_accS and _satS <= 0.40,
        '★VF_DECK_LIGHTFACE_V1：柔和高级 accent=%s 是**低饱和**（%.0f%% ≤40%%，不再是 0xe11d48 亮玫红）'
        % (_accS or '?', _satS * 100))
    _sbT = {'shots': [{'type': 'title', 'text': 'A', 'dur': 5}]}
    R.apply_style(_sbT, 'softlux')
    chk(isinstance(_sbT.get('theme'), dict) and (_sbT['theme'].get('theme') == 'mono')
        and (_sbT['theme'].get('accent') == _accS),
        '★VF_DECK_LIGHTFACE_V1：apply_style 把 token 覆盖传下去（theme 字典带 theme=mono 基线）',
        _sbT.get('theme') if isinstance(_sbT.get('theme'), dict) else str(_sbT.get('theme')))
    # ★VF_STYLES_V1 ③（team-lead 2026-10-01）：「apply_style 把纯文字 title 卡升级成 deck 版式后，
    #   还会不会再另外叠一层'大字'？如果会 → 必须去掉」（老板原话「还是很多大字」）。
    #   结论：**不会**——`card_title` 遇到 deck 页**提前 return**（只返回 deck 元素层），
    #   经典"居中大字"那段代码根本走不到。这里用两条断言把它钉住（防止以后有人加回来）：
    #     ① 源码：deck 分支是先 `return (deck_base_input(...)`（提前返回）；
    #     ② 行为：deck 页里**最大字号只出现 1 次**（= 只有一处主标题）。
    _ctSrc = _seg(_code, 'card_title', 'card_list')
    chk('if deck_of(shot):' in _ctSrc and 'return (deck_base_input(' in _ctSrc,
        '③：card_title 的 deck 分支**提前 return**（不叠第二层大字）')
    _sbP = {'shots': [{'type': 'title', 'text': '三步走完一条片', 'kicker': '本地出片',
                       'items': ['A', 'B', 'C'],
                       'stats': [{'value': '128', 'suffix': '%', 'label': '转化率提升'}], 'dur': 8}]}
    R.apply_style(_sbP, 'bluewhite')
    chk(R.deck_of(_sbP['shots'][0]), '③：apply_style 后该 title 卡确实升级成 deck 页',
        _sbP['shots'][0].get('variant'))
    _inpP, _vfP, _durP = R.card_title(_sbP['shots'][0], R.theme_of(R.THEMES['news']), 1280, 720, 25)
    _fsP = [int(x) for x in _re.findall(r'fontsize=(\d+)', _vfP)]
    # ★VF_TEXTGRAD_V1 之后：主标题按**上浅下深两层**画（同字号、同文本），所以最大字号会出现 1~2 次。
    #   "没有叠第二层大字"的判据因此改成：**最大字号那几条必须是同一个文本**（= 同一标题的两层），
    #   而不是两段不同的标题文字。
    _mx = max(_fsP) if _fsP else -1
    _titles = _re.findall(r"fontsize=%d:text='([^']*)'" % _mx, _vfP) if _mx > 0 else []
    chk(bool(_fsP) and 1 <= _fsP.count(_mx) <= 2 and len(set(_titles)) <= 1,
        '③：deck 页只有**一处主标题**（最大字号 %d 出现 %d 次、且同一文本 → 没有叠第二层大字）'
        % (_mx, _fsP.count(_mx)), 'titles=%s' % (_titles[:3],))
    # ★VF_STYLES_STRICT_V1 验收（team-lead 2026-10-01 明确点名的 5 种非法输入）：
    #   非 5 套成品风格的值 → **plan 零改动**（深比较）+ 日志写明"忽略未知 style"。
    import contextlib as _ctx
    import io as _io
    _bad_keys = ('cinematic', 'ai', '', None, 123, 'commercial', 'BLUE', {'a': 1}, ['x'])
    _zero_bad = []
    _log_bad = []
    for _k in _bad_keys:
        _sbX = {'theme': 'light', 'deck_style': 'deck-mag', 'banner': {'line1': 'x'},
                'shots': [{'type': 'title', 'text': 'A', 'dur': 5},
                          {'type': 'bgimage', 'src': 'a.jpg', 'dur': 4}]}
        _before = _json.dumps(_sbX, sort_keys=True, default=str)
        _buf = _io.StringIO()
        with _ctx.redirect_stdout(_buf):
            _ret = R.apply_style(_sbX, _k)
        _log = _buf.getvalue()
        if _ret != '' or _json.dumps(_sbX, sort_keys=True, default=str) != _before:
            _zero_bad.append('%r(ret=%r)' % (_k, _ret))
        # 空字符串/None = "没传"（不走 apply_style 的日志分支）；其余未知值必须留下"忽略"日志
        if _k not in ('', None) and '忽略未知 style' not in _log:
            _log_bad.append(repr(_k))
    chk(not _zero_bad,
        '★VF_STYLES_STRICT_V1：cinematic/ai/\"\"/None/数字/字典… **plan 零改动**（深比较逐字节相同）',
        str(_zero_bad))
    chk(not _log_bad, '★VF_STYLES_STRICT_V1：未知值都留下"忽略未知 style"日志（不静默）', str(_log_bad))
    # 反向：5 个**合法** key 必须正常生效（别把严格的守卫改成"一律不动"）
    _ok_keys = []
    for _k2 in list(_styles.keys()) + [v.get('name') for v in _styles.values()]:
        _sbY = {'shots': [{'type': 'title', 'text': 'A', 'dur': 5}]}
        _buf2 = _io.StringIO()
        with _ctx.redirect_stdout(_buf2):
            _r2 = R.apply_style(_sbY, _k2)
        if _r2 and _sbY['shots'][0].get('variant') in R.DECK_STYLE_VARIANTS:
            _ok_keys.append(_k2)
    chk(len(_ok_keys) == 10,
        '★VF_STYLES_STRICT_V1：5 个 id + 5 个中文名**全部正常生效**（10/10）', str(_ok_keys))
    # ⚠️ 反向护栏：render.py **绝不许**读 `ai_style`（那是 AI 制片线给 make.py 用的标签；
    #    读进来就会重演"AI 制片被静默改成 news+deck"）
    #   口径：**只允许"收下但不用"**（`--ai-style` 无操作登记 + getattr 打一条日志）；
    #   任何**取值**写法（plan 字典取值 / args 属性）都不许出现 → 那是抢字段、就是事故。
    _grabA = [x for x in ("get('ai_style')", "['ai_style']", '.ai_style') if x in _code]
    chk(not _grabA and "add_argument('--ai-style'" in _code,
        '★VF_STYLES_STRICT_V1：render.py 0 处**取值** ai_style（只收下 --ai-style 不消费）', str(_grabA))
    chk(_code.count("sb.get('style')") <= 1,
        '★VF_STYLES_STRICT_V1：render.py 只有 1 处读 plan 根级 style（且走严格守卫）',
        str(_code.count("sb.get('style')")))
    # --list-styles 的真实 CLI 输出（服务端界面要跟它对齐）——逐字断言 id + 中文名
    try:
        _ls = subprocess.run([sys.executable, os.path.join(_VF, 'render.py'), '--list-styles'],
                             capture_output=True, text=True, encoding='utf-8', errors='replace')
        _lso = _ls.stdout or ''
    except Exception as _eLS:
        _lso = ''
        _BAD.append('--list-styles 跑不起来：%s' % str(_eLS)[:60])
    chk(all(k in _lso for k in _styles.keys())
        and all(str(v.get('name')) in _lso for v in _styles.values()),
        '★VF_STYLES_V1：`--list-styles` 输出含全部 5 个 id + 5 个中文名（服务端界面据此对齐）',
        _lso.replace('\n', ' | ')[:120])
    # apply_style 的功能断言：只动纯文字卡，素材镜一个字段都不碰
    _sb = {'shots': [
        {'type': 'title', 'text': 'A', 'dur': 5},
        {'type': 'list', 'title': 'B', 'dur': 5},
        {'type': 'bgimage', 'src': 'none.jpg', 'text': 'C', 'dur': 5},
    ]}
    _rid = R.apply_style(_sb, 'magazine')
    _s0, _s1, _s2 = _sb['shots']
    _thm = _sb.get('theme')
    # ★VF_FONTHIER_V1 之后：带 tokens 的风格（magazine/softlux）会把 theme 写成**字典**（含 fontTitle 等覆盖）
    _thv = _thm.get('theme') if isinstance(_thm, dict) else _thm
    chk(_rid == 'magazine' and _thv == 'journal' and _sb.get('deck_style') == 'deck-mag',
        'apply_style：theme/deck_style 落到分镜根上', (_thm, _sb.get('deck_style')))
    chk(_s0.get('variant') == 'deck-mag' and _s0.get('enter') == 'left'
        and abs(float(_s0.get('_float_per')) - 4.0) < 1e-6,
        'apply_style：纯文字 title 卡被**提升**为该风格的 deck 版式 + 节奏（修"选了模版没生效"）', _s0)
    # 素材镜：**不碰** variant/enter/节奏，只按 ★VF_DECK_FRAME_DEFAULT_V1 补一个 frame 缺省
    chk('variant' not in _s2 and 'enter' not in _s2 and '_float_per' not in _s2
        and _s2.get('frame') == 'thin',
        'apply_style：素材镜只补 frame=thin，不碰 variant/enter/节奏', _s2)
    _sb2 = {'shots': [{'type': 'title', 'text': 'A', 'dur': 5}]}
    chk(R.apply_style(_sb2, '') == '' and 'theme' not in _sb2 and 'variant' not in _sb2['shots'][0],
        'apply_style：不传风格 → 一个字都不改（老链路零回归）')
    chk(_src.count('★VF_STYLES_V1') >= 1 and _src.count('★VF_SUSTAIN_V2') >= 1,
        '防回退：★VF_STYLES_V1 / ★VF_SUSTAIN_V2 仍在 render.py 里')
    _thsrc = open(os.path.join(_VF, 'themes.py'), encoding='utf-8').read()
    chk(_thsrc.count('★VF_STYLES_V1') >= 1 and "'bluewhite'" in _thsrc and 'DEFAULT_STYLE' in _thsrc,
        'themes.py：STYLES 表 / DEFAULT_STYLE 在位（唯一真相源）')

    # ══ 13h. ★VF_FONTHIER_V1 / ★VF_TEXTGRAD_V1（2026-10-02 老板「字体太单调了 就一种而且没渐变」）═
    # A 层：标题拉字距（drawtext 无 letter-spacing → 逐字插 U+2009）+ 数字粗体大号 + 英文宽字距（原有）
    _tk = R._track_cjk('三步走完')
    chk('\u2009' in _tk and _tk.replace('\u2009', '') == '三步走完',
        'A 层：中文短标题插 U+2009 细空格（去掉后仍是原文，不会丢字）', repr(_tk))
    chk(R._track_cjk('这是一句很长很长的标题超过十二个字了') == '这是一句很长很长的标题超过十二个字了',
        'A 层：长标题**不插**字距（避免为插空格再缩字号）')
    chk(R._track('abc') == 'A B C', 'A 层：英文仍走全大写 + 超宽字距（原有 _track 未被改坏）')
    # ★VF_FONTHIER_V2（2026-10-02 team-lead「竖屏下字距越界检查」）——把"字距口径 + 判据"钉死：
    #   ① 细空格的**宽度口径**：`_char_w` 必须按 **0.20em** 估（本机实测 12.8px@fs64；
    #      旧口径 0.55em 会把标题高估 2.74 倍 → 字号被过度缩水，竖屏尤其明显）；
    #   ② 判据：宽敞 → 采纳字距（字号不掉）；窄幅 1 行长标题 → **退回不插**（字号 = 不插那版）。
    chk(abs(R._char_w('\u2009', 64) - 12.8) < 0.01,
        '★VF_FONTHIER_V2：细空格按 0.20em 估宽（实测 12.8px@fs64，不是 0.55em）',
        R._char_w('\u2009', 64))
    chk(abs(R.est_text_w(R._track_cjk('本地出片三步走'), 64) - 523) <= 3,
        '★VF_FONTHIER_V2：7 字标题（含 6 个细空格）估宽 ≈523px（与实测亮跨 523px 对齐）',
        R.est_text_w(R._track_cjk('本地出片三步走'), 64))
    _kA = dict(fs_max=64, max_lines=1, maxw_ratio=0.86, fs_min=18, one_line_max=9)
    _lA, _fA, _tA = R.track_fit('本地出片三步走', 1280, 720, **_kA)
    _fA0 = R.fit_big_text('本地出片三步走', 1280, 720, **_kA)[1]
    chk(_tA and _fA == _fA0, '★VF_FONTHIER_V2 判据①：横屏宽敞 → 采纳字距且**字号不掉**', _fA)
    _kB = dict(fs_max=64, max_lines=1, maxw_ratio=0.60, fs_min=18, one_line_max=12)
    _lB, _fB, _tB = R.track_fit('本地出片三步走全流程拆解', 720, 1280, **_kB)
    _fB0 = R.fit_big_text('本地出片三步走全流程拆解', 720, 1280, **_kB)[1]
    _fB1 = R.fit_big_text(R._track_cjk('本地出片三步走全流程拆解'), 720, 1280, **_kB)[1]
    chk((not _tB) and _fB == _fB0,
        '★VF_FONTHIER_V2 判据②：窄幅 1 行长标题 → 退回"不插"（字号 %d；硬插会掉到 %d）'
        % (_fB, _fB1))
    # B 层：字体家族键 + 容错
    chk(all(k in R.FONT_CANDS for k in ('serif', 'serifbd', 'num', 'numbd')),
        'B 层：FONT_CANDS 新增 serif/serifbd/num/numbd 四键（衬线 + 数字专用）')
    chk(all(_styles[k].get('tokens', {}).get('fontTitle') == 'serif' for k in ('magazine', 'softlux')),
        'B 层：杂志编辑 / 柔和高级两套的标题走**衬线**（tokens.fontTitle=serif）')
    _Tser = dict(R.theme_of(R.THEMES['journal']), fontTitle='serif')
    _p1 = R.font_title(_Tser)
    chk(bool(_p1) and str(_p1).lower().endswith(('.ttc', '.otf', '.ttf')),
        'B 层：font_title(衬线) 返回一个真实字体路径', _p1)
    _Tbad = dict(R.theme_of(R.THEMES['journal']), fontTitle='no-such-family-xyz')
    _p2 = R.font_title(_Tbad)      # 不许抛异常；静默回落
    chk(bool(_p2) and _p2 == R.font_bold(R.theme_of(R.THEMES['journal'])),
        'B 层：家族不存在时**静默回落**粗体 CJK（绝不报错、出片不受影响）', _p2)
    _fwo = R.font_title(dict(R.theme_of(R.THEMES['journal'])), bold=True)
    chk(_fwo == R.font_bold(R.theme_of(R.THEMES['journal'])),
        'B 层：主题没写 fontTitle → 逐字走原来的 font_bold（零回归）')
    # C 层：文字"上浅下深"两层（廉价近似）
    _gp = R.text_grad_pair('三步走', "C:/x/MSYH.TTC", 64, 100, 200, 'white')
    chk(len(_gp) == 2 and _gp[0] != _gp[1] and 'y=200+2' in _gp[1] and "text='三步走'" in _gp[0],
        'C 层：text_grad_pair 返回两层（同字、下层下移 2px）', [x[:58] for x in _gp])
    chk('fontcolor=0xdbdbdb' in _gp[1] and 'fontcolor=0xffffff' in _gp[0],
        'C 层：下层是同色**压暗 14%**（white→0xffffff 上 / 0xdbdbdb 下）= "上浅下深"', _gp[1][:70])
    chk(_src.count('★VF_TEXTGRAD_V1') >= 1 and _src.count('★VF_FONTHIER_V1') >= 1,
        '防回退：★VF_FONTHIER_V1 / ★VF_TEXTGRAD_V1 仍在 render.py 里')
    _bench = os.path.join(_VF, 'bench-text-gradient.py')
    chk(os.path.exists(_bench), 'C 层：耗时实测脚本在位（bench-text-gradient.py）')
    if os.path.exists(_bench):
        _bs = open(_bench, encoding='utf-8').read()
        chk(('52.0' in _bs or '+20ms' in _bs or 'alphamerge' in _bs) and 'drawtext' in _bs,
            'C 层：脚本里同时有"真渐变(alphaextract+alphamerge)"与"廉价近似"两种配方',
            '（实测数字写在汇报里：B +2.1ms/帧 / C +20.1ms/帧）')

    # ══ 14. ★VF_DECK_V1（2026-10-01）「富编排 PPT 页」 ══════════════════════════
    # 用户原话：「最好不要就几个大字，内容编排丰富一点可以吗？……你能单独根据我的素材 编辑
    #            1、2 个动效 PPT 给我看下嘛，这样我能知道最顶能到什么效果」
    # 断言口径：① 一页里元素齐全（kicker/标题/编号要点/数据块/分割线/页码）且**分段入场 + 持续动效**；
    #   ② **零回归**：非 deck（含白名单外的自造 variant）必须返回 []（一个像素都不动）；
    #   ③ `deck` 不许塞进 TITLE_VARIANTS（那会红 vf-i2v-selftest.ts 的白名单对账）。
    _thD = theme_of('news')
    _dshot = {'type': 'title', 'variant': 'deck', 'kicker': 'AI 营销', 'text': 'AI 营销内容生成系统',
              'sub': '从选题到成片，一条流水线', 'items': ['智能选题', '一键成片', '自动分发'],
              'stats': [{'value': '8.5%', 'label': '点击率'}, {'value': '150', 'suffix': '万', 'label': '曝光'}],
              'page': '01 / 02', 'dur': 8}
    _dk = R.deck_page_filters(dict(_dshot), _thD, 1280, 720, 8)
    _dkj = ','.join(_dk)
    chk(len(_dk) >= 20, 'deck：一页 ≥20 个元素层（不再是"就几个大字"）', 'n=%d' % len(_dk))
    chk('AI 营销' in _dkj, 'deck：① kicker 小标签条在位')
    chk("text='01'" in _dkj and "text='02'" in _dkj and "text='03'" in _dkj,
        'deck：③ 要点带编号 01/02/03')
    chk('8.5' in _dkj and '150' in _dkj and 'eif' in _dkj,
        'deck：④ 数据块（8.5% 静态强调色 / 150 走 eif 滚动）')
    chk('01 / 02' in _dkj, 'deck：⑥ 页码在位')
    chk("enable='gte(t," in _dkj, 'deck：元素分段入场（drawbox 走 enable 按时间点插入）')
    chk(":alpha='min(max(t-" in _dkj, 'deck：每段文字错开渐入（分段插入）')
    chk('sin(2*PI*t/' in _dkj and "enable='gte(t," in _dkj,
        'deck：持续动效在位（呼吸 sin + 慢生长 enable）')
    # ★VF_DECK_SPAN_V2（2026-10-01 team-lead 验收口径）：入场必须**铺满整段** ——
    #   原来 01/02/03+数据卡全挤在 0.85~1.8s，8s 的页从 2s 起只剩呼吸（逐帧 YAVG≈0.15~0.2）
    #   → 体检②时间轴 `#+.#...........#`、老板抱怨"看不出在动"。
    #   验收：8s 页里 0–2 / 2–4 / 4–6 / 6–8 **每个 2s 窗都至少一个元素入场**。
    _ons8 = sorted({round(float(x), 2) for x in _re.findall(r"gte\(t,([0-9.]+)\)", ','.join(_dk))})
    _q8 = [0, 0, 0, 0]
    for _t in _ons8:
        _q8[min(3, int(_t // 2))] += 1
    chk(all(_q >= 1 for _q in _q8),
        '★VF_DECK_SPAN_V2：8s deck 页入场铺满整段（每个 2s 窗都有元素入场）',
        'ons=%s quarters=%s' % (_ons8, _q8))
    chk(bool(_ons8) and max(_ons8) >= 6.0 and max(_ons8) <= 7.0,
        '★VF_DECK_SPAN_V2：数据卡落在 6.0~7.0s（覆盖 6–8s 窗，且留出滚动时间）',
        str(max(_ons8) if _ons8 else None))
    # ★VF_DECK_LIGHTFACE_V1（2026-10-01 老板/team-lead「要点行的面不要是实心白杠」）：
    #   要点行的面**不再**是 `cardBg`（white@0.93），而是【极淡主题染色面 + 1px 细边】；
    #   数据卡仍保留 `cardBg`（那是一张真"信息卡"，不是要点行）。所以断言拆成两条：
    _rowF, _rowG = R._deck_item_material('deck', _thD)
    chk(sum(1 for _x in _dk if ('color=' + str(_rowF)) in _x) >= 3,
        '★VF_DECK_LIGHTFACE_V1：3 条要点行各有一块**极淡染色面**（不是 cardBg 白杠）',
        str(sum(1 for _x in _dk if ('color=' + str(_rowF)) in _x)))
    _dkj2 = ','.join(_dk)
    chk(_dkj2.count('color=' + str(_thD.get('cardBg'))) <= 1,
        '★VF_DECK_LIGHTFACE_V1：经典 deck 里"白杠"已清零（cardBg 的面只允许剩数据卡那 1 处）',
        'n=%d' % _dkj2.count('color=' + str(_thD.get('cardBg'))))
    _short = R.deck_page_filters(dict(_dshot, dur=5), _thD, 1280, 720, 5)
    _ons5 = sorted({round(float(x), 2) for x in _re.findall(r"gte\(t,([0-9.]+)\)", ','.join(_short))})
    chk(bool(_ons5) and max(_ons5) <= 5.0,
        '★VF_DECK_SPAN_V2：短镜（5s）错峰按比例压缩，不越界',
        str(_ons5[-4:]))
    chk(_src.count('★VF_DECK_SPAN_V2') >= 3, '防回退：★VF_DECK_SPAN_V2 仍在 render.py 里')
    # ★VF_DECK_SPAN_V3（2026-10-01 team-lead 决定 1）：5 套风格页**各自给"卡面级"材质**，
    #   并把入场铺满整段（同基础版验收：8s 内每 2s 窗至少一个元素入场）。
    for _sty5 in R.DECK_STYLE_VARIANTS:
        _sk = R.deck_page_filters(dict(_dshot, variant=_sty5, dur=8), _thD, 1280, 720, 8)
        _skj = ','.join(_sk)
        _on5 = sorted({round(float(x), 2) for x in _re.findall(r"gte\(t,([0-9.]+)\)", _skj)})
        _q5 = [0, 0, 0, 0]
        for _t in _on5:
            _q5[min(3, int(_t // 2))] += 1
        chk(all(_q >= 1 for _q in _q5),
            '★VF_DECK_SPAN_V3：%s 的 8s 页入场铺满整段（0-2/2-4/4-6/6-8 各 ≥1）' % _sty5,
            'ons=%s q=%s' % (_on5, _q5))
        chk(len([_x for _x in _sk if _x.startswith('drawbox') and 'color=' in _x]) >= 4,
            '★VF_DECK_SPAN_V3：%s 有"面"（要点材质块×2 + 数据卡 + 页内元素 ≥4 块）' % _sty5,
            'n=%d' % len([_x for _x in _sk if _x.startswith('drawbox') and 'color=' in _x]))
    chk(hasattr(R, '_deck_item_material') and _src.count('★VF_DECK_SPAN_V3') >= 1,
        '防回退：★VF_DECK_SPAN_V3 / _deck_item_material 在位')

    # ══ 13e. ★VF_DECK_CONTRAST_V1（2026-10-01 team-lead 实测「浅灰面上要点字发灰、读不出」）═══
    # 口径**照用 ② 的 70**（`_mat_text_colors` 用的就是它）；判据用**帧内亮度差 / 取色逻辑**这种
    # **确定**的东西 —— 不碰跨渲染像素比对的比值型门槛（那种会抖，已经吃过一次亏）。
    _lows = [R._deck_on_face(_x)[2] for _x in range(0, 256, 2)]
    chk(min(_lows) >= 70, 'DECK-CONTRAST：面上字色与面亮度的 |Δ| 恒 ≥70（面亮度 0..255 全扫）',
        'min=%.0f' % min(_lows))
    chk(abs(R._deck_eff_lum('0xffffff@0.74', 22) - 194) <= 3,
        'DECK-CONTRAST：面亮度合成公式（white@0.74 压在暗底 22 上 → ≈194）',
        '%.1f' % R._deck_eff_lum('0xffffff@0.74', 22))
    _bgT = float(R._lum_of((_thD.get('bg') or '0x0a1620'), 160))
    for _sty6 in R.DECK_STYLE_VARIANTS:
        _mt6, _g6 = R._deck_item_material(_sty6, _thD)
        _face6 = R._deck_eff_lum(_mt6, _bgT)
        _want6, _, _dd6 = R._deck_on_face(_face6)
        _j6 = ','.join(R.deck_page_filters(dict(_dshot, variant=_sty6, dur=8), _thD, 1280, 720, 8))
        chk(('fontcolor=%s' % _want6) in _j6 and _dd6 >= 70,
            '★VF_DECK_CONTRAST_V1：%s 要点字色=%s（面亮度 %.0f → |Δ|=%.0f ≥70）'
            % (_sty6, _want6, _face6, _dd6), '')
    chk(_src.count('★VF_DECK_CONTRAST_V1') >= 1,
        '防回退：★VF_DECK_CONTRAST_V1 仍在 render.py 里')

    # ══ 13f. ★VF_BIGTEXT_KINSOKU_V1（2026-10-01 team-lead）大字折行也走避头尾 + 不留孤字 ══
    # 证据：styles2/frames/deck-glass_t7_5.png 大标题折成「AI 营销内容生成系 / 统」= 第二行孤字。
    # 判据全部是**字符串级**（确定，不用像素比）。
    chk(R._big_fix_rows('AI营销内容生成系统', ['AI营销内容生成系', '统']) == ['AI营销内容生成', '系统'],
        'BIGTEXT_KINSOKU：末行孤字 → 从上一行挪 1 字下来（不再出现"第二行只剩一个字"）',
        str(R._big_fix_rows('AI营销内容生成系统', ['AI营销内容生成系', '统'])))
    chk(R._big_fix_rows('一键生成', ['一键生', '成']) == ['一键', '生成'],
        'BIGTEXT_KINSOKU：既拆了成对词「生成」又留孤字 → 同时收口', str(R._big_fix_rows('一键生成', ['一键生', '成'])))
    chk(R._big_fix_rows('ABCD四字', ['ABCD', '四字']) == ['ABCD', '四字']
        and R._big_fix_rows('智能营销方案', ['智能营销方案']) == ['智能营销方案'],
        'BIGTEXT_KINSOKU 零回归：断点本就合法 + 非孤字 → 逐字不变')
    _bt_rows, _bt_fs = R.fit_big_text('AI 营销内容生成系统', 620, 720)
    chk(all(len(_r) >= 2 for _r in _bt_rows) and _bt_rows == ['AI 营销内容', '生成系统'],
        'BIGTEXT_KINSOKU：老板帧的标题在侧栏宽度下不再出「系统」被拆', str(_bt_rows))
    _bt_ok = True
    for _w in (560, 620, 700, 1100, 1280):
        for _s in ('AI 营销内容生成系统', '智能营销方案', 'AI营销系统30秒生成', '转化率提升8.5%', '这是150万的方案'):
            _rr, _rf = R.fit_big_text(_s, _w, 720)
            if any(len(_r) < 2 for _r in _rr) \
                    or ''.join(_rr).replace(' ', '') != _s.replace(' ', ''):
                _bt_ok = False
    chk(_bt_ok, 'BIGTEXT_KINSOKU：全宽度扫描下既不孤字、也不丢字（拼回=原文）')
    chk(not R.kinsoku_cut_ok('转化率提升8.5%', 6) and not R.kinsoku_cut_ok('价格150万起', 5),
        'BIGTEXT_KINSOKU：复用 kinsoku —— 8.5% / 150万 不拆（与字幕同一套规则，不另写）')
    chk(_src.count('★VF_BIGTEXT_KINSOKU_V1') >= 1, '防回退：★VF_BIGTEXT_KINSOKU_V1 仍在 render.py 里')

    # ══ 13g. ★VF_PAGENUM_CONTRAST_V1（2026-10-01 team-lead）页码压在浅面板上要读得清 ══
    # 判据（帧内/取色逻辑，确定）：页码字色 == `_deck_on_face(面亮度)`（浅面近黑 / 深面白，|Δ|≥70），
    # 且**满 alpha 0.85 + 1px 投影**（原来 0.60 被面一衬就发灰）。
    _THN = _thD
    _bgN = float(R._lum_of((_THN.get('bg') or '0x0a1620'), 160))
    _pn_bad = []
    for _styN in [x for x in R.DECK_STYLE_VARIANTS if x != 'deck']:   # 基础 deck 走 linec，不在此列
        _mtN, _gN = R._deck_item_material(_styN, _THN)
        _faceN = R._deck_eff_lum(_mtN, _bgN)
        _wantN, _, _ddN = R._deck_on_face(_faceN)
        _jN = ','.join(R.deck_page_filters(dict(_dshot, variant=_styN, dur=8), _THN, 1280, 720, 8))
        _pfN = R._force_alpha(_wantN, 0.85)
        if ('fontcolor=%s' % _pfN) not in _jN or 'shadowx=1:shadowy=1' not in _jN or _ddN < 70:
            _pn_bad.append('%s(%s/%s)' % (_styN, _pfN, _jN.count('fontcolor=%s' % _pfN)))
    chk(not _pn_bad,
        '★VF_PAGENUM_CONTRAST_V1：5 套风格页码都按"面"取色（|Δ|≥70）+ 满 alpha 0.85 + 1px 投影',
        str(_pn_bad))
    chk(_src.count('★VF_PAGENUM_CONTRAST_V1') >= 1, '防回退：★VF_PAGENUM_CONTRAST_V1 仍在 render.py 里')
    # 零回归：非 deck 一律 []（一个像素都不动）
    for _bad in ({'text': '老标题'}, {'variant': 'center'}, {'variant': 'rainbow'},
                 {'variant': 'deck-like'}, {'variant': 'cards'}):
        chk(R.deck_page_filters(dict(_bad), _thD, 1280, 720, 5) == [],
            'deck 零回归：%s → 一个滤镜都不加' % (str(_bad)[:34]))
    _d_ok = R.deck_page_filters({'variant': 'deck'}, _thD, 1280, 720, 5)
    chk(bool(_d_ok), 'deck：即使没有标题/要点也产出兜底版面（绝不空页）', 'n=%d' % len(_d_ok))
    # ★VF_DECK_STYLES_V1（2026-10-01）口径变更（用户拍板「1-2 都要：既要接进 AI，也要多做模版」）：
    #   4 套风格**现在必须进 TITLE_VARIANTS**（AI 可以在分镜里写 variant=deck-grad 等），
    #   由 vf-i2v-selftest.ts 与 src 的 VF_VARIANTS.title 逐项对账 —— 那边同步前会红，属**预期**。
    chk(all(v in R.TITLE_VARIANTS for v in R.DECK_STYLE_VARIANTS)
        and list(R.DECK_VARIANTS) == ['deck', 'deck-grad', 'deck-mono', 'deck-mag',
                                      'deck-glass', 'deck-soft']
        and list(R.DECK_STYLE_VARIANTS) == list(R.DECK_VARIANTS),
        'deck 6 套风格都在 TITLE_VARIANTS 里（与 anti-ai.ts 白名单对账）')
    # 素材页：横屏左图右文（内容落右半幅）/ 竖屏上图下文（内容落下半幅）
    if ff:
        _wdD = tempfile.mkdtemp(prefix='vf-deck-')
        _imgP = os.path.join(_wdD, 'p_768x1344.jpg')
        # 用**渐变图**而不是纯色图：纯色会被 VF_MATGUARD 判成"深色界面截图"→ 老主题那条
        #   零回归断言会走到"换质感底板"分支（自己先踩过一次，记在这里）。
        try:
            subprocess.run([ff, '-v', 'error', '-y', '-f', 'lavfi',
                            '-i', 'gradients=s=768x1344:c0=0x2b4a5a:c1=0x9ab0c0',
                            '-frames:v', '1', _imgP], capture_output=True, timeout=30)
        except Exception:
            pass
        if not os.path.exists(_imgP):
            _mk_img(ff, _imgP, 768, 1344, '0x2b4a5a')
        if os.path.exists(_imgP):
            def _dtxy(chain, key):
                out = []
                for _sg in str(chain).split(','):
                    if _sg.startswith('drawtext='):
                        _m = _re.search(r':%s=(\d+)' % key, _sg)
                        if _m:
                            out.append(int(_m.group(1)))
                return out

            _vdl = R.card_bgimage(dict(_dshot, src=_imgP, dur=8), _thD, 1280, 720, 25)[1]
            _xsl = _dtxy(_vdl, 'x')
            chk('alphamerge' in _vdl and bool(_xsl) and min(_xsl) >= 640,
                'deck 素材页：横屏 + 竖素材 → 左图右文（内容全在右半幅）', str(_xsl[:6]))
            _vdp = R.card_bgimage(dict(_dshot, src=_imgP, dur=8), _thD, 720, 1280, 25)[1]
            _ysp = _dtxy(_vdp, 'y')
            chk('alphamerge' in _vdp and bool(_ysp) and min(_ysp) >= int(1280 * 0.5),
                'deck 素材页：竖屏 → 上图下文（内容全在下半幅）', str(_ysp[:6]))
            _vdd = R.card_bgimage(dict(_dshot, src=_imgP, dur=8), _dark6, 1280, 720, 25)[1]
            chk('alphamerge' not in _vdd and 'zoompan' in _vdd,
                'deck 素材页：老主题（无卡片版式）→ 老实回落老链路（绝不弄挂出片）')
    chk('★VF_DECK_V1' in _src and 'dot' in open(os.path.join(_VF, 'themes.py'),
                                                encoding='utf-8').read(),
        '防回退：★VF_DECK_V1 标记 + themes.py 的 dot token 都在位')

    # ══ 15. ★VF_DECK_STYLES_V1（2026-10-01）4 套富编排风格 + 去黑框 ═════════════════════════
    # 用户原话：「1-2 都要。默认一套经典通用，然后先加几个不同风格。注意配合配色真的不能太 AI 味。
    #            最好有渐变色。还有就是透明度。前面很多大字下面都有一个透明黑框。」
    # 断言口径：① 4 套风格各自产出元素、白名单外**零回归**；②「真渐变」用**像素级单调性**证明
    #   （grad_box_filters 每段颜色单调过渡，不是两块纯色叠）；③ 透明度写死（底衬 ≤0.10、卡面 0.30~0.60、
    #   只有 kicker 标签条可到 0.95）；④ `box=1:boxcolor=…`（实心黑框）在非对照模式下必须消失。
    chk(list(R.DECK_STYLE_VARIANTS) == ['deck', 'deck-grad', 'deck-mono', 'deck-mag',
                                        'deck-glass', 'deck-soft'],
        '6 套风格白名单值逐字正确（4 套 + 追加 deck-glass / deck-soft）',
        str(list(R.DECK_STYLE_VARIANTS)))
    _dshot2 = {'type': 'title', 'kicker': 'AI 营销', 'text': 'AI 营销内容生成系统',
               'sub': '从选题到成片，一条流水线', 'items': ['智能选题', '一键成片', '自动分发'],
               'stats': [{'value': '8.5%', 'label': '点击率'},
                         {'value': '150', 'suffix': '万', 'label': '曝光'}],
               'page': '01 / 02', 'dur': 8}
    for _style in R.DECK_STYLE_VARIANTS:
        _fl = R.deck_page_filters(dict(_dshot2, variant=_style), _thD, 1280, 720, 8)
        _fj = ','.join(_fl)
        chk(len(_fl) >= 18, '%s：一页 ≥18 个元素层' % _style, 'n=%d' % len(_fl))
        chk('AI 营销' in _fj, '%s：① kicker 在位' % _style)
        chk("text='01'" in _fj and "text='02'" in _fj and "text='03'" in _fj,
            '%s：③ 编号要点 01/02/03' % _style)
        chk('8.5' in _fj and '150' in _fj and 'eif' in _fj, '%s：④ 数据块（含 eif 滚动）' % _style)
        chk('01 / 02' in _fj, '%s：⑥ 页码在位' % _style)
        chk("enable='gte(t," in _fj, '%s：元素分段入场（enable）' % _style)
        chk("alpha='min(max(t-" in _fj, '%s：每段文字错开渐入' % _style)
        chk('sin(2*PI*t/' in _fj, '%s：持续动效（呼吸 sin）在位' % _style)
        chk('box=1:boxcolor' not in _fj, '%s：画面里没有实心黑框' % _style)
        # 本机实测坑（★VF_DECK_STYLES2_V1）：f-string 漏花括号 → 滤镜串里留下 Python 原文
        #   （`h=max(2, int(H * 0.004))`）→ ffmpeg 报 "Error parsing a filter description" 整镜失败。
        chk(not _re.search(r'[:=](?:max|int)\(', _fj),
            '%s：滤镜串里没有"漏花括号"的 Python 代码原文（会让 ffmpeg 解析失败）' % _style)
    # 零回归：白名单外的值（含前缀伪装 / 大小写）→ 一个滤镜都不加
    for _bad in ('deckx', 'deck-grad2', 'deck_grad', 'cards', 'deck-monoo'):
        chk(R.deck_page_filters({'variant': _bad, 'text': 'x'}, _thD, 1280, 720, 5) == [],
            'deck 零回归：%s → 一个滤镜都不加' % _bad)
    chk(R.deck_style_of({'variant': ' deck-mono '}) == 'deck-mono', '风格值去空白 + 小写归一')
    chk(R.deck_style_of({'variant': 'DECK-GRAD'}) == 'deck-grad',
        '风格值大小写不敏感（与 variant_of 同口径：AI 写大写也能认）')
    chk(R.deck_style_of({'variant': 'deck-pink'}) == '', '自造风格 → 空（回老版式）')

    # ① 真渐变（不是两块纯色叠）：每段颜色必须单调过渡
    _gb = R.grad_box_filters(100, 200, 300, 120, '0x000000', '0xffffff', steps=12)
    _lum = [R._lum_of(_re.search(r'color=([^:]+):t=fill', x).group(1)) for x in _gb]
    chk(len(_gb) == 12, '渐变带：按 steps 产出段数', 'n=%d' % len(_gb))
    chk(_lum == sorted(_lum) and _lum[0] <= 12 and _lum[-1] >= 240 and _lum[0] != _lum[-1],
        '渐变带：颜色**单调过渡**（首段近黑 → 末段近白 = 真渐变，不是两块纯色叠）', str(_lum[:4]))
    chk(all(x.startswith('drawbox=x=') for x in _gb),
        '渐变带：全部是 drawbox 段（不动"单输入 -vf 链"的架构）')
    _gb2 = R.grad_box_filters(0, 0, 100, 40, '0x112233@0.30', '0x112233@0.70', steps=6)
    _al = [float(_re.search(r'@([\d.]+):t=fill', x).group(1)) for x in _gb2]
    chk(_al == sorted(_al) and _al[-1] > _al[0],
        '渐变带：透明度同样单调（同色也能做"由淡到实"的渐变）', str(_al))
    chk(len(R.grad_box_filters(0, 0, 10, 10, 'bad-color', '0x000000', steps=4)) == 4,
        '渐变带：颜色解析失败也不抛异常（回默认黑）')
    # ② 渐变风的底板 = 真·逐像素渐变（只有 grad 走这条路；其余 3 套逐字不变）
    _gok = bool(ff)
    if _gok:
        try:
            _gok = R._has_gradients(ff)
        except Exception:
            _gok = False
    _bi = R.deck_base_input(dict(_dshot2, variant='deck-grad'), _thD, 1280, 720, 8)
    chk((_bi.startswith('-f lavfi -i gradients=') if _gok else _bi.startswith('-f lavfi -i color=')),
        'deck-grad 底板 = lavfi gradients（真逐像素渐变；无 gradients 则回落底色）', _bi[:44])
    chk(R.deck_base_input(dict(_dshot2, variant='deck'), _thD, 1280, 720, 8)
        == '-f lavfi -i color=c=0x0b1622:s=1280x720:d=8',
        '其余 3 套底板与老版**逐字相同**（color= → 走 stage_layer，零回归）')
    # ③ 透明度写死（面积克制）：底衬几乎全透、卡面中等、只有 kicker 标签条可到 0.95
    _alph = [float(m) for m in _re.findall(r'@(0\.\d+):t=fill',
                                           ','.join(R.deck_page_filters(
                                               dict(_dshot2, variant='deck-grad'), _thD, 1280, 720, 8)))]
    chk(bool(_alph) and max(_alph) <= 0.95 and min(_alph) <= 0.10,
        '渐变风：既有"几乎全透"的底衬（≤0.10 光晕）也有唯一实底标签条（≤0.95）',
        str(sorted(_alph)[:3] + sorted(_alph)[-3:]))
    chk(any(0.30 <= x <= 0.60 for x in _alph),
        '渐变风：卡片/色带走 0.30~0.60 的中等透明度（不挡字）')
    _mono_f = R.deck_page_filters(dict(_dshot2, variant='deck-mono'), _thD, 1280, 720, 8)
    _mono_a = [float(m) for m in _re.findall(r'@(0\.\d+):t=fill', ','.join(_mono_f))]
    chk(bool(_mono_a) and max(_mono_a) <= 0.95,
        '极简风：全部元素都是低 alpha（无实底卡面）', str(sorted(_mono_a)[-4:]))
    chk(any(_re.search(r'h=[12]:', x) for x in _mono_f if ':t=fill' in x),
        '极简风：有 1~2px 的细线（发丝线）')
    _mag_f = ','.join(R.deck_page_filters(dict(_dshot2, variant='deck-mag'), _thD, 1280, 720, 8))
    chk(_mag_f.count('h=2') >= 1 and 'drawbox' in _mag_f,
        '杂志风：双线/栏线（细分割）在位')

    # ④ 去黑框：默认模式下 `box=1:boxcolor=…` 必须消失，改成【渐隐蒙版 + 描边 + 阴影】
    _sc = R._text_scrim_filters(100, 200, 400, 90, 'black@0.30', steps=7)
    _sa = [float(_re.search(r'@([\d.]+):t=fill', x).group(1)) for x in _sc]
    chk(len(_sc) == 7 and _sa == sorted(_sa) and _sa[-1] > _sa[0],
        '渐隐蒙版：7 段 alpha 自上而下单调递增（上透明 → 下压暗）', str(_sa))
    _rs = R._reveal_seq({'text': '库存告急'}, 'f', 60, 'white', 5, box='black@0.30', W=1280, H=720)
    _rsj = ','.join(_rs)
    chk('box=1:boxcolor' not in _rsj and 'shadowx=2' in _rsj and 'borderw=' in _rsj,
        '大字底衬：不再是实心黑框（改"描边 + 阴影 + 渐隐蒙版"）')
    chk(any(x.startswith('drawbox=x=') for x in _rs),
        '大字底衬：渐隐蒙版真的产出了（且排在文字之前 = 在字下层）')
    os.environ['VF_TEXTBOX_LEGACY'] = '1'
    _rs2 = ','.join(R._reveal_seq({'text': '库存告急'}, 'f', 60, 'white', 5,
                                  box='black@0.30', W=1280, H=720))
    os.environ.pop('VF_TEXTBOX_LEGACY', None)
    chk('box=1:boxcolor=black@0.30' in _rs2,
        '对照帧开关（VF_TEXTBOX_LEGACY=1）可还原老黑框（只用于 before/after 对照）')
    _rs3 = R._reveal_seq({'text': '没有底衬'}, 'f', 60, 'white', 5)
    chk(bool(_rs3) and not any('drawbox' in x for x in _rs3),
        '无 box 的调用方：一个 drawbox 都不加（零回归）')
    chk('★VF_DECK_STYLES_V1' in _src and '★VF_NOBLACKBOX_V1' in _src
        and 'gradA' in open(os.path.join(_VF, 'themes.py'), encoding='utf-8').read(),
        '防回退：★VF_DECK_STYLES_V1 / ★VF_NOBLACKBOX_V1 / gradA token 都在位')

    # ══ 16. ★VF_DECK_STYLES2_V1（2026-10-01）新建 2 套风格（玻璃拟态 / 柔和拟物）+ 根级 deck_style ══
    # 用户原话：「配色版式 就这1种吗？」「我做过一些网页UI风格效果，是否能按传统的5个网页UI风格设计。
    #            配色更讲究一些」「注意配合 配色真的不能太 AI 味。最好有渐变色。还有就是透明度」
    #            「我本次选的是新闻资讯，因为我没看到新模版」
    # 口径：① 白名单追加 2 个值（顺序在 4 套之后）；② 玻璃卡=低 alpha 染色底+细 hairline+柔光 wash，
    #   柔和卡=同色系左上亮/右下暗双投影+bevel（**全部低 alpha**，不许变成实心板）；
    #   ③ 根级 deck_style 能强制覆盖（'auto'/缺失/非法 → 逐字不改）。
    _thS2 = theme_of('news')
    chk(list(R.DECK_STYLE_VARIANTS) == ['deck', 'deck-grad', 'deck-mono', 'deck-mag',
                                        'deck-glass', 'deck-soft'],
        '6 套白名单：deck-glass / deck-soft 追加在 4 套之后（顺序逐字）',
        str(list(R.DECK_STYLE_VARIANTS)))
    _dshotS = {'type': 'title', 'kicker': 'AI 营销', 'text': 'AI 营销内容生成系统',
               'sub': '从选题到成片，一条流水线', 'items': ['智能选题', '一键成片', '自动分发'],
               'stats': [{'value': '8.5%', 'label': '点击率'},
                         {'value': '150', 'suffix': '万', 'label': '曝光'}],
               'page': '01 / 02', 'dur': 8}
    for _style in ('deck-glass', 'deck-soft'):
        _fj2 = ','.join(R.deck_page_filters(dict(_dshotS, variant=_style), _thS2, 1280, 720, 8))
        chk(len(_fj2) > 0 and 'AI 营销' in _fj2 and "text='01'" in _fj2
            and '8.5' in _fj2 and 'eif' in _fj2 and '01 / 02' in _fj2
            and "enable='gte(t," in _fj2 and "alpha='min(max(t-" in _fj2
            and 'sin(2*PI*t/' in _fj2 and 'box=1:boxcolor' not in _fj2,
            '%s：元素齐全（kicker/编号/数据 eif/页码/分段入场/呼吸）且无实心黑框' % _style)
    for _bad in ('deck-glass2', 'deck_glass', 'deck-softt', 'glass', 'soft'):
        chk(R.deck_page_filters({'variant': _bad, 'text': 'x'}, _thS2, 1280, 720, 5) == [],
            '6 套零回归：%s → 一个滤镜都不加' % _bad)
    chk(R.deck_style_of({'variant': ' DECK-GLASS '}) == 'deck-glass'
        and R.deck_style_of({'variant': 'deck-soft'}) == 'deck-soft',
        '新风格值：去空白 + 大小写不敏感')
    # 玻璃卡 / 柔和卡：透明度写死（低 alpha）+ hairline
    _gp = R._glass_panel(100, 100, 420, 130, _thS2)
    _ga = [float(x) for x in _re.findall(r'@([01]\.\d+):', ','.join(_gp))]
    chk(len(_gp) >= 9 and bool(_ga) and max(_ga) <= 0.36 and min(_ga) <= 0.10,
        '玻璃卡：≥9 层，最大 alpha ≤0.36（不变成实心板）、且有 ≤0.10 的极淡层',
        str((len(_gp), min(_ga) if _ga else None, max(_ga) if _ga else None)))
    chk(any(_re.search(r'h=[12]:', x) for x in _gp if ':t=fill' in x)
        and '0x1b3a5e' in ','.join(_gp),
        '玻璃卡：有 1~2px hairline（玻璃棱）+ 染色底取主题 cardBg2（同源不新造色）')
    _gpge = [float(x) for x in _re.findall(
        r'@([01]\.\d+):', ','.join(R.deck_page_filters(dict(_dshotS, variant='deck-glass'),
                                                       _thS2, 1280, 720, 8)))]
    chk(bool(_gpge) and min(_gpge) <= 0.10 and any(0.20 <= x <= 0.36 for x in _gpge),
        '玻璃页：有"柔光渐变 wash"(≤0.10) + 卡片/标签条走 0.20~0.36 半透明',
        str(sorted(_gpge)[:3]))
    _sp = R._soft_panel(100, 100, 420, 130, _thS2)
    _sa = [float(x) for x in _re.findall(r'@([01]\.\d+):', ','.join(_sp))]
    _sys = [int(x) for x in _re.findall(r'drawbox=x=\d+:y=(\d+):', ','.join(_sp))]
    chk(len(_sp) >= 9 and bool(_sa) and max(_sa) <= 0.36,
        '柔和卡：≥9 层，最大 alpha ≤0.36（始终是同色系表面，不是色板）',
        str((len(_sp), max(_sa) if _sa else None)))
    chk(bool(_sys) and min(_sys) < 100 < max(_sys) and '0x04090f' in ','.join(_sp),
        '柔和卡：左上亮 / 右下暗**双投影**（凹凸感）+ 暗投影取主题 shadowC')
    # 主题兜底：老主题也要能拿到 3 个新 token（老主题不写不许坏）
    _thsrc2 = open(os.path.join(_VF, 'themes.py'), encoding='utf-8').read()
    chk(all(k in _thsrc2 for k in ('cardBg2', 'shadowC', 'lineC')), 'themes.py：3 个新 token 在位')
    for _nm in theme_names():
        _t = theme_of(_nm)
        chk(all(str(_t.get(k, '')).strip() for k in ('cardBg2', 'lineC', 'shadowC')),
            'token 兜底：%s 有 cardBg2/lineC/shadowC' % _nm,
            str([k for k in ('cardBg2', 'lineC', 'shadowC') if not str(_t.get(k, '')).strip()]))
    chk(str(theme_of('light').get('lineC')) == 'black',
        'lineC 兜底按字色亮度取黑白（light 深字 → 黑发丝）', str(theme_of('light').get('lineC')))
    # 根级 deck_style（用户手动指定画面模版）
    chk(R.deck_root_style({'deck_style': 'deck-glass'}) == 'deck-glass'
        and R.deck_root_style({'deck_style': ' DECK-SOFT '}) == 'deck-soft',
        'deck_style：合法值被接受（去空白 + 大小写不敏感）')
    chk(R.deck_root_style({'deck_style': 'auto'}) == '' and R.deck_root_style({}) == ''
        and R.deck_root_style(None) == '' and R.deck_root_style({'deck_style': 'deck-pink'}) == '',
        'deck_style：auto / 缺失 / 非法 → 一律不干预（零回归）')
    _sbS = {'deck_style': 'deck-glass',
            'shots': [{'variant': 'deck-mag'}, {'variant': 'center'}, {'type': 'list'},
                      {'variant': 'deck'}]}
    chk(R.apply_deck_style(_sbS) == 'deck-glass'
        and [s.get('variant') for s in _sbS['shots']] == ['deck-glass', 'center', None, 'deck-glass'],
        'deck_style 强制覆盖：3 个 deck 页被统一成 glass，普通卡一个字不动',
        str([s.get('variant') for s in _sbS['shots']]))
    _sbS2 = {'deck_style': 'auto', 'shots': [{'variant': 'deck-mag'}]}
    chk(R.apply_deck_style(_sbS2) == '' and _sbS2['shots'][0]['variant'] == 'deck-mag',
        "deck_style='auto' → 镜内 variant 逐字保持（零回归）")
    _sbS3 = {'deck_style': 'deck-soft', 'shots': [{'variant': 'center'}, {'type': 'title'}]}
    R.apply_deck_style(_sbS3)
    chk([s.get('variant') for s in _sbS3['shots']] == ['center', None],
        'deck_style 不凭空把普通卡变成 deck 页（只统一"已经是 deck 页"的）')
    # 底板：glass 也走真渐变（"背景一层柔光渐变"）；soft 仍是 color=（零回归）
    _hasS = bool(ff)
    try:
        _hasS = R._has_gradients(ff) if ff else False
    except Exception:
        _hasS = False
    _wantS = '-f lavfi -i gradients=' if _hasS else '-f lavfi -i color='
    chk(R.deck_base_input(dict(_dshotS, variant='deck-glass'), _thS2, 1280, 720, 8).startswith(_wantS),
        'deck-glass 底板 = 真渐变（无 gradients 则回落底色）',
        R.deck_base_input(dict(_dshotS, variant='deck-glass'), _thS2, 1280, 720, 8)[:44])
    chk(R.deck_base_input(dict(_dshotS, variant='deck-soft'), _thS2, 1280, 720, 8)
        .startswith('-f lavfi -i color='),
        'deck-soft 底板仍是 color=（零回归）')
    chk('★VF_DECK_STYLES2_V1' in _src and '★VF_DECK_STYLE_V1' in _src,
        '防回退：★VF_DECK_STYLES2_V1 / ★VF_DECK_STYLE_V1 仍在 render.py 里')

    # ══ 17. ★VF_QUOTE_ESC_V1（2026-10-01）渲染层第二道「引号闸」（服务端 ★VF_QUOTE_FIX_V1 是第一道）══
    # 背景：滤镜串被包在 ASCII 双引号里进 shell（render_shot 的 `-vf "..."`、burn_banner 的
    #   `-filter_complex "..."`，最终 subprocess.run(cmd, shell=True)）→ 文案里一个裸 ASCII `"`
    #   就会让 shell 引号**提前闭合** → 那一镜整镜失败。服务端已归一化，渲染层再兜一道。
    _q1 = R.esc_text('他说"效率"了')
    chk('"' not in _q1, 'QUOTE_ESC：ASCII 双引号不再原样泄漏（否则 shell 引号提前闭合）', _q1)
    chk('“' in _q1 and '”' in _q1, 'QUOTE_ESC：双引号 → 成对中文引号', _q1)
    _q2 = R.esc_text('他说"效率了')                       # 奇数个（未闭合）也必须不留裸 "
    chk('"' not in _q2 and '“' in _q2, 'QUOTE_ESC：**奇数个**双引号也不漏出裸 "', _q2)
    chk('`' not in R.esc_text('a`rm -rf`b'), 'QUOTE_ESC：反引号（shell 命令替换符）被删除')
    chk(R.esc_text("it's") == "it\\'s",
        "QUOTE_ESC：单引号**仍是** \\' 转义（未动老行为）", R.esc_text("it's"))
    chk(R.esc_text('90%') == '90\\\\%',
        'QUOTE_ESC：百分号**仍是** \\\\%（未动老行为）', R.esc_text('90%'))
    chk(R.esc_text('a:b') == r'a\:b',
        'QUOTE_ESC：冒号**仍是** \\: 转义（未动老行为）', R.esc_text('a:b'))
    _qm = R.esc_text('说"好"`x`\\c%d')
    chk('"' not in _qm and '`' not in _qm and '\\\\%' in _qm and '\\\\c' in _qm,
        'QUOTE_ESC：引号/反引号/反斜杠/% 混合输入一次处理干净', _qm)
    chk(R.esc_text('') == '' and isinstance(R.esc_text(None), str),
        'QUOTE_ESC：空串原样、None 不抛异常（沿用改前的 str() 行为）')
    # 源码级：防回退（引号归一 + 反引号删除真的在 esc_text 函数体内）
    _esrc = _seg(_code, 'esc_text', '_big_text')
    chk("replace('`', '')" in _esrc, 'esc_text 源码：反引号删除在位（防被改回去）')
    chk('“' in _esrc and '”' in _esrc, 'esc_text 源码：中文引号归一在位（防被改回去）')
    chk(_src.count('★VF_QUOTE_ESC_V1') >= 1, '防回退：★VF_QUOTE_ESC_V1 仍在 render.py 里')
    # 覆盖面审计（源码级）：**所有**插进 drawtext 的文本都必须走 esc_text；
    #   白名单只有两种"本来安全"的：① `%{eif:...}` 故意表达式（数字滚动）；② 纯数字序号 `{_i + 1}` / `{_num}`。
    #   其余任何 `text='{变量}'` 一律视为绕过 → 直接红（例如 banner_layer / deck 元素 / list / compare）。
    _dt_all = _re.findall(r"text='\{([^}]*)\}", _code)
    _dt_bad = [x for x in _dt_all
               if 'esc_text' not in x and 'eif' not in x
               and x.strip() not in ('_i + 1', '_num')]
    chk(not _dt_bad,
        'QUOTE_ESC 覆盖面：没有绕过 esc_text 的 drawtext 文本（白名单仅 eif 表达式与纯数字序号）',
        str(_dt_bad))

    if a.render:
        _render_demo()

    print('\n' + '─' * 62)
    for x in _OK:
        print('  ✅ ' + x)
    for x in _BAD:
        print('  ❌ ' + x)
    print('─' * 62)
    print('%d 项通过 / %d 失败' % (len(_OK), len(_BAD)))
    return 1 if _BAD else 0


def themes_has_editorial():
    return ('news' in THEMES) and ('data' in THEMES)


def _photo_img(ff, path, w, h, bright):
    """造一张**照片感**素材（深/浅各一）。

    为什么不用纯色 / 平滑渐变：素材体检会把"大片纯色 / 主色占比高"的图判成**界面截图**，
    于是走"换主题质感底板"那条路 → 就看不到"压在素材上的大字"了（本 demo 的重点之一）。
    testsrc2 + 轻模糊 + 噪点 + 调亮度 → flat 低（≈0.17）、lum 可控，最接近真实照片。
    """
    vf = 'gblur=sigma=3,eq=brightness=%.2f,noise=alls=18:allf=t' % bright
    try:
        subprocess.run([ff, '-v', 'error', '-y', '-f', 'lavfi',
                        '-i', 'testsrc2=s=%dx%d' % (w, h), '-vf', vf, '-frames:v', '1', path],
                       capture_output=True, timeout=40)
    except Exception:
        pass
    return os.path.exists(path)


def _render_demo():
    """真渲三条（1280×720 横屏）：
       ① news + 深色素材（编辑风在深色素材上的观感）
       ② data + 亮色素材（两套风格必须"明显不一样"）
       ③ light + 深色素材（★①号问题的复现：浅色主题近黑字压深色素材 → 必须自动改亮字）"""
    import json
    wd = tempfile.mkdtemp(prefix='vf-style-render-')
    try:
        ff = R.find_ffmpeg()
    except Exception:
        print('[render] 找不到 ffmpeg，跳过')
        return
    dark = os.path.join(wd, 'dark.jpg')
    light = os.path.join(wd, 'light.jpg')
    _photo_img(ff, dark, 1280, 720, -0.35)
    _photo_img(ff, light, 1280, 720, 0.45)
    print('[render] 深素材体检=%s' % R._probe_material(dark))
    print('[render] 浅素材体检=%s' % R._probe_material(light))
    for thname, src in (('news', dark), ('data', light), ('light', dark)):
        sb = {
            'size': [1280, 720], 'fps': 25, 'theme': thname,
            'shots': [
                {'type': 'title', 'text': '库存告急', 'kicker': '前线专栏',
                 'en': 'north korea deployment crisis', 'dur': 3,
                 'subtitle': '库存告急，前线专栏发回报道'},
                {'type': 'bgimage', 'src': src, 'text': '供应链卡住了',
                 'dur': 3, 'subtitle': '供应链卡住了整条产线'},
                {'type': 'list', 'title': '三个信号', 'items': ['运价连续上涨', '仓库开始限提', '交期被拉长'],
                 'dur': 6, 'subtitle': '三个信号值得关注'},
                {'type': 'number', 'value': 1700, 'suffix': '%', 'label': '涨幅同比',
                 'dur': 3, 'subtitle': '涨幅同比一千七百'},
                {'type': 'compare', 'left': '手工剪辑', 'right': '本地成片',
                 'leftDesc': '一条要半天', 'rightDesc': '五分钟出片',
                 'dur': 4, 'subtitle': '对比一下两种做法'},
                {'type': 'end', 'text': '先看数据再下结论', 'cta': '点我查看',
                 'en': 'read the data first', 'dur': 3, 'subtitle': '先看数据再下结论'},
            ],
        }
        out = os.path.join(wd, 'style-%s.mp4' % thname)
        sbp = os.path.join(wd, 'sb_%s.json' % thname)
        with open(sbp, 'w', encoding='utf-8') as f:
            json.dump(sb, f, ensure_ascii=False)
        print('\n[render] %s → %s' % (thname, out))
        subprocess.run([sys.executable, os.path.join(_VF, 'render.py'),
                        '--storyboard', sbp, '--out', out, '--no-subs',
                        '--workdir', os.path.join(wd, 'wd_' + thname)],
                       cwd=_VF)
        with open(os.path.join(wd, 'FRAMES.txt'), 'a', encoding='utf-8') as f:
            f.write('%s\t%s\n' % (thname, out))
    print('\n[render] 抽帧示例：node scripts/vf-local.mjs --frames <上面的 mp4> --t 2')
    print('[render] 产物目录：%s' % wd)


if __name__ == '__main__':
    sys.exit(main())
