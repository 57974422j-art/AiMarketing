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
import os
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
    ((_OK if cond else _BAD)).append(name + (('  ← ' + extra) if (extra and not cond) else ''))


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
