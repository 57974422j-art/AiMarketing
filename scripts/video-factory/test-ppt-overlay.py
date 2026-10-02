#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""★VF_PPT_OVERLAY_V1 回归护栏（2026-10-02 老板）：「PPT 元素压在素材上（视频也要能压）」。

老板原话：「PPT设计不要单帧，你前面本地设计是PPT压在视频或者图片上。可以设计单帧。但视频上也可以压。
特别是长视频合成模式。譬如180秒视频时有20-30秒视频合成，肯定需要在视频上压些东西，不让它太单调」
「图片按 1-3 张一个。视频按时长 10-15 秒一个」。

本测试守三件：
  ① 字段 `overlay_ppt`：`true/on/ppt` 强制开、`false/off/none` 强制关、缺省看 `_ppt_overlay_auto`；
     没有可压内容（无 kicker/items/stats）→ 不画空面板；
  ② 接线覆盖 `video` / `aivideo` / `bgimage`（**视频镜此前完全没有版式链**）；
  ③ 真渲双帧证明：12s **视频镜**在 t=2.5 与 t=10.0 两帧 → 叠加元素**依次出现**（后一帧文字更多）+
     两帧不同（持续在动）；图片镜同样能压。

用法：python scripts/video-factory/test-ppt-overlay.py [--wd <目录>]
"""
import json
import os
import re as _re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, HERE)

import render as R  # noqa: E402

OK, NG = [], []


def chk(cond, msg, extra=''):
    (OK if cond else NG).append(msg)
    print('  %s %s%s' % ('[PASS]' if cond else '[FAIL]', msg, ('  ← ' + str(extra)) if extra else ''))


def strings():
    print('\n① 字段语义 + 面板滤镜（纯逻辑，不渲染）')
    chk(R.ppt_overlay_on({'overlay_ppt': True}) and R.ppt_overlay_on({'overlay_ppt': 'on'})
        and R.ppt_overlay_on({'overlay_ppt': 'ppt'}),
        "overlay_ppt = true/'on'/'ppt' → 强制开")
    chk(not R.ppt_overlay_on({'overlay_ppt': False}) and not R.ppt_overlay_on({'overlay_ppt': 'off'})
        and not R.ppt_overlay_on({'overlay_ppt': 'none'}),
        "overlay_ppt = false/'off'/'none' → 强制关")
    chk(not R.ppt_overlay_on({}), '缺省且无自动标记 → 不压（零回归）')
    chk(R.ppt_overlay_on({'_ppt_overlay_auto': True}), '缺省 + 自动规则标记 → 压（② 的钩子）')
    _th = R.theme_of(R.THEMES['news'])
    _shot = {'type': 'video', 'overlay_ppt': True, 'kicker': '视频叠加',
             'items': ['要点一', '要点二', '要点三'],
             'stats': [{'value': '128', 'suffix': '%', 'label': '转化率提升'}], 'dur': 12.0}
    f = R.ppt_overlay_filters(_shot, _th, 1280, 720, 12.0, src='', font=None)
    _j = ','.join(f)
    chk(len(f) >= 8, '面板片段数 ≥8（面+细边+kicker块+文字+3条编号要点+数据卡+进度线）', len(f))
    chk(_j.count('drawtext') >= 6, '面板里 ≥6 处 drawtext（kicker+3编号+3要点+数据）', _j.count('drawtext'))
    chk("enable='gte(t,0.12)'" in _j and "alpha='min(max(t-" in _j,
        '分段入场：面/边用 enable，文字用 alpha 渐显')
    chk('drawbox' in _j and '0.62' in _j, '半透明实底（主题底色 alpha=0.62）+ 细边')
    # 错峰：12s / 3 条要点 → 出现时刻应铺开（不是全挤在开头）
    _ons = sorted({round(float(x), 2) for x in
                   __import__('re').findall(r"gte\(t,([0-9.]+)\)", _j)})
    chk(len(_ons) >= 3 and max(_ons) >= 4.0,
        '12s 镜的元素出现时刻**整段铺开**（最晚 ≥4s，不是全挤在开头）', _ons[:6])
    chk(R.ppt_overlay_filters({'overlay_ppt': True, 'dur': 12}, _th, 1280, 720, 12.0) == [],
        '没有可压内容（无 kicker/items/stats）→ 不画空面板')
    chk(R.ppt_overlay_side({'overlay_side': 'left'}, _th, '') == 'left'
        and R.ppt_overlay_side({'overlay_side': 'right'}, _th, '') == 'right',
        "overlay_side 可显式指定 left/right")
    code = open(os.path.join(HERE, 'render.py'), encoding='utf-8').read()
    _wired = [k for k in ('def card_video', 'def card_aivideo', 'def card_bgimage')
              if 'ppt_overlay_filters(shot, th, W, H, dur, src=src, font=font)' in
              code.split(k)[1].split('def card_')[0]]
    chk(len(_wired) == 3, '接线覆盖 video / aivideo / bgimage（3/3）', str(_wired))


def _mask(png, ff, W=320, H=180):
    """取缩略灰度的"亮字掩膜"像素数（视频底图很暗 → 亮像素≈叠加元素）。"""
    b = subprocess.run([ff, '-v', 'error', '-i', png, '-vf', 'scale=%d:%d' % (W, H),
                        '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], capture_output=True).stdout
    b = b[:W * H]
    return sum(1 for v in b if v >= 170), b


def frames(wd):
    print('\n② 真渲：视频镜双帧（元素依次出现）+ 图片镜叠加')
    os.makedirs(wd, exist_ok=True)
    ff = R.find_ffmpeg()
    vid = os.path.join(wd, 'mat.mp4')
    img = os.path.join(wd, 'mat.jpg')
    # 底图/底片都用**静态**渐变（低对比、深色）→ 帧间差异只可能来自叠加面板，证据更干净
    subprocess.run([ff, '-y', '-v', 'error', '-f', 'lavfi', '-i',
                    'gradients=s=768x1344:c0=0x1a1a1e:c1=0x3a3a42:x0=0:y0=0:x1=768:y1=1344:d=1',
                    '-frames:v', '1', img], capture_output=True)
    subprocess.run([ff, '-y', '-v', 'error', '-f', 'lavfi', '-i',
                    'gradients=s=768x1344:c0=0x1a1a1e:c1=0x3a3a42:x0=0:y0=0:x1=768:y1=1344:d=14',
                    '-t', '14', '-r', '25', '-pix_fmt', 'yuv420p', vid], capture_output=True)
    cases = {
        'video': {'type': 'video', 'src': vid, 'overlay_ppt': True, 'kicker': '视频叠加',
                  'items': ['选题定位', '脚本生成', '一键成片'],
                  'stats': [{'value': '128', 'suffix': '%', 'label': '转化率提升'}],
                  'text': '长视频合成', 'dur': 12.0},
        'image': {'type': 'bgimage', 'src': img, 'overlay_ppt': True, 'kicker': '图片叠加',
                  'items': ['素材铺满', '面板压角'],
                  'subtitle': '图片镜也能压', 'dur': 6.0},
        'off': {'type': 'video', 'src': vid, 'overlay_ppt': False, 'kicker': '不该出现',
                'items': ['A', 'B'], 'text': '关掉叠加', 'dur': 12.0},
        # 图片镜的**对照**（同镜、只把 overlay_ppt 关掉）→ 用相对判据证明"面板确实是新加的"
        'image_off': {'type': 'bgimage', 'src': img, 'overlay_ppt': False, 'kicker': '不该出现',
                      'items': ['素材铺满', '面板压角'], 'subtitle': '对照', 'dur': 6.0},
    }
    logs, shots = {}, {}
    for tag, shot in cases.items():
        p = os.path.join(wd, 'sb_%s.json' % tag)
        open(p, 'w', encoding='utf-8').write(json.dumps(
            {'size': [1280, 720], 'fps': 25, 'shots': [shot]}, ensure_ascii=False))
        mp4 = os.path.join(wd, 'out_%s.mp4' % tag)
        r = subprocess.run([sys.executable, os.path.join(HERE, 'render.py'), '--storyboard', p,
                            '--out', mp4, '--workdir', os.path.join(wd, 'wd_%s' % tag),
                            '--no-banner', '--no-subs'],
                           capture_output=True, text=True, encoding='utf-8', errors='replace')
        logs[tag] = r.stdout or ''
        shots[tag] = mp4
    chk('VF_PPT_OVERLAY_V1 叠加面板' in logs['video'],
        '② 视频镜走了叠加面板（日志自述）',
        [l.strip()[:78] for l in logs['video'].splitlines() if 'OVERLAY' in l][:1])
    chk('VF_PPT_OVERLAY_V1 叠加面板' in logs['image'],
        '② 图片镜也走了叠加面板（显式 overlay_ppt=true）')
    chk('VF_PPT_OVERLAY_V1' not in logs['off'],
        "② 显式 overlay_ppt=false → 一片面板都不画（老板要关能关）")
    # 视频镜两帧：t=2.5（早期）vs t=10.0（晚期）→ 元素更多 + 两帧不同
    fa, fb = os.path.join(wd, 'video_t2_5.png'), os.path.join(wd, 'video_t10.png')
    for t, dst in ((2.5, fa), (10.0, fb)):
        subprocess.run([ff, '-y', '-v', 'error', '-i', shots['video'], '-ss', '%.2f' % t,
                        '-frames:v', '1', dst], capture_output=True)
    _na, ba = _mask(fa, ff)
    _nb, _bb = _mask(fb, ff)
    _d = sum(abs(ba[i] - _bb[i]) for i in range(min(len(ba), len(_bb)))) / float(max(1, min(len(ba), len(_bb))))
    chk(_nb > _na * 1.15,
        '③ 视频镜 t=2.5 → t=10.0 亮字像素 %d → %d（**元素依次出现**，晚期更多）' % (_na, _nb))
    chk(_d > 3.0, '③ 两帧确实不同（平均差 %.1f > 3）→ 面板持续在动（另有底部进度线）' % _d)
    _fc = os.path.join(wd, 'image_overlay.png')
    _f0 = os.path.join(wd, 'image_overlay_off.png')
    for _src_tag, _dst in (('image', _fc), ('image_off', _f0)):
        subprocess.run([ff, '-y', '-v', 'error', '-i', shots[_src_tag], '-ss', '3.0',
                        '-frames:v', '1', _dst], capture_output=True)
    _nc, _ = _mask(_fc, ff)
    _n0, _ = _mask(_f0, ff)
    # 用**相对判据**（同镜、只差 overlay_ppt）：图片镜的底图很暗，亮像素基本只来自面板文字
    chk(_nc > _n0 + 30, '③ 图片镜：开叠加亮字 %d vs 关叠加 %d（面板确实画上去了）' % (_nc, _n0))
    chk(os.path.exists(fa) and os.path.exists(fb) and os.path.exists(_fc),
        '③ 三张证据帧都在', (os.path.basename(fa), os.path.basename(fb), os.path.basename(_fc)))


def portrait(wd):
    """★VF_PPT_OVERLAY_V2（2026-10-02 team-lead）：**竖屏几何** —— 老板的片子横竖屏都出。

    竖屏难在三种内容抢同一根竖轴：面板（要露素材脸）/ **画面大字**（居中）/ **底部字幕带**（≥72%H）。
    判据（本函数逐条守）：
      ① 面板四边留白 ≥ 安全边（左右各 ≥5.5%W、上 ≥5%H）；
      ② 面板底边 ≤ 40%H（把中部让给大字）+ 底部字幕带（>72%H）零叠加元素；
      ③ 面板里的字不撑爆面板宽（按面板宽取字号，而不是只按 H）；
      ④ 横屏几何**逐字不变**（pw=40%W / ph=60%H / px=5.5%W / py=20%H）——零回归。
    """
    print('\n④ 竖屏（720×1280）几何 + 真渲两帧')
    ff = R.find_ffmpeg()
    th = R.theme_of('news')
    Wp, Hp = 720, 1280
    shot = {'type': 'video', 'overlay_ppt': True, 'kicker': '竖屏叠加', 'text': '竖屏也能压',
            'items': ['素材铺满', '面板靠上', '字幕不被压'], 'dur': 12.0}
    f = R.ppt_overlay_filters(shot, th, Wp, Hp, 12.0, src='', font=R.font_bold(th))
    _box = [x for x in f if x.startswith('drawbox=')][0]
    px = int(_re.search(r'x=(\d+)', _box).group(1))
    py = int(_re.search(r'y=(\d+)', _box).group(1))
    pw = int(_re.search(r'w=(\d+)', _box).group(1))
    ph = int(_re.search(r'h=(\d+)', _box).group(1))
    _l = px
    _r = Wp - (px + pw)
    chk(_l >= int(Wp * 0.055) and _r >= int(Wp * 0.055) and py >= int(Hp * 0.05),
        '④ 竖屏面板四边留白达标（左 %d / 右 %d ≥ %.0fpx，上 %d ≥ %.0fpx）'
        % (_l, _r, Wp * 0.055, py, Hp * 0.05), '面板 %dx%d@%d,%d' % (pw, ph, px, py))
    chk(py + ph <= int(Hp * 0.40),
        '④ 竖屏面板底边 %d ≤ 40%%H=%d（把中部让给画面大字）' % (py + ph, int(Hp * 0.40)))
    chk(pw >= int(Wp * 0.80), '④ 竖屏面板做成**通栏**（≥80%%W=%d，竖屏窄，侧栏放不下字）' % int(Wp * 0.80), pw)
    _fit = all(int(_re.search(r'fontsize=(\d+)', x).group(1)) <= int(pw * 0.09)
               for x in f if 'drawtext' in x and 'fontsize=' in x)
    chk(_fit, '④ 竖屏面板里的字号 ≤ 面板宽的 9%%（不会撑爆通栏面板；竖屏 H 大，只按 H 取字号会溢出）')
    chk(R._overlay_text_x(shot, th, Wp, Hp, '') == 0,
        '④ 竖屏不做"大字让位"（面板通栏靠上，没有某一侧可让）')
    # 横屏零回归：几何与改动前逐字相同
    _fl = R.ppt_overlay_filters(dict(shot, text=''), th, 1280, 720, 12.0, src='', font=R.font_bold(th))
    _bl = [x for x in _fl if x.startswith('drawbox=')][0]
    chk('w=512' in _bl and 'h=432' in _bl and 'y=144' in _bl,
        '④ 横屏几何**逐字不变**（pw=40%%W=512 / ph=60%%H=432 / py=20%%H=144）→ 零回归', _bl[:70])
    # 真渲：竖屏视频镜两帧
    vid = os.path.join(wd, 'mat_portrait.mp4')
    subprocess.run([ff, '-y', '-v', 'error', '-f', 'lavfi', '-i',
                    'gradients=s=768x1344:c0=0x1a1a1e:c1=0x3a3a42:x0=0:y0=0:x1=768:y1=1344:d=14',
                    '-t', '14', '-r', '25', '-pix_fmt', 'yuv420p', vid], capture_output=True)
    sbp = os.path.join(wd, 'sb_portrait.json')
    open(sbp, 'w', encoding='utf-8').write(json.dumps(
        {'size': [Wp, Hp], 'fps': 25, 'theme': 'news',
         'shots': [dict(shot, src=vid)]}, ensure_ascii=False))
    mp4 = os.path.join(wd, 'out_portrait.mp4')
    r = subprocess.run([sys.executable, os.path.join(HERE, 'render.py'), '--storyboard', sbp,
                        '--out', mp4, '--workdir', os.path.join(wd, 'wd_portrait'),
                        '--no-banner', '--no-subs'],
                       capture_output=True, text=True, encoding='utf-8', errors='replace')
    chk(r.returncode == 0 and os.path.exists(mp4), '④ 竖屏叠加真渲 rc=0', 'rc=%s' % r.returncode)
    # 命名按 team-lead 口径：`portrait_video_t*.png`（旧名 video_portrait_t* 同时保留，方便对照）
    _pw_png = os.path.join(wd, 'portrait_video_t2.png')
    _pw2 = os.path.join(wd, 'portrait_video_t9.png')
    for t, dst in ((2.5, _pw_png), (9.0, _pw2)):
        subprocess.run([ff, '-y', '-v', 'error', '-i', mp4, '-ss', '%.2f' % t,
                        '-frames:v', '1', dst], capture_output=True)
    if os.path.exists(_pw_png):
        # 行分布：竖屏 720×1280 → 缩到 90×160 后按行数亮像素
        _b = subprocess.run([ff, '-v', 'error', '-i', _pw_png, '-vf', 'scale=90:160',
                             '-f', 'rawvideo', '-pix_fmt', 'gray', '-'],
                            capture_output=True).stdout
        _rows = [sum(1 for x in _b[y * 90:(y + 1) * 90] if x >= 170) for y in range(160)]
        _top = sum(_rows[:int(160 * 0.40)])
        _bot = sum(_rows[int(160 * 0.72):])
        _tot = sum(_rows)
        chk(_tot > 0, '④ 竖屏帧上确实有叠加元素（亮像素 %d）' % _tot)
        chk(_bot == 0, '④ **底部字幕带（>72%%H）零叠加元素**（不会被面板压住字幕）', 'bottom=%d' % _bot)
        # ⚠️ "亮像素占比"不能用来判"面板靠上"：**画面大字**是最亮的元素、它在中部（0.44H 起）。
        #   真正要证的是"面板与大字不打架" → 直接量它们之间的**空隙行**（0 亮像素）。
        #   ⚠️ 空隙只量"面板底边往下 5%H"这一小段：再往下就是**编辑风大字块自己的 kicker**
        #      （它比大字主体更靠上，约 36%H），不是重叠 —— 面板底边 26%H 到它还有 10%H 的空隙。
        _g0 = int(160.0 * (py + ph) / Hp) + 1
        _g1 = int(160.0 * (py + ph + Hp * 0.05) / Hp)
        _gap = sum(_rows[_g0:_g1])
        chk(_gap == 0, '④ 面板底边(%.0f%%H) 往下 5%%H 是一条**干净空隙**（行 %d~%d 零亮像素）'
            % ((py + ph) * 100.0 / Hp, _g0, _g1), 'gap=%d' % _gap)
        chk(_top > 0, '④ 上半部（面板区）确实有叠加元素（top=%d / 总 %d）' % (_top, _tot))
    else:
        chk(False, '④ 竖屏抽帧失败')
    # ── ⑤ 竖屏**标题页**（deck 版式）：字距 + 上浅下深两层都在这一页上 → 查"越界/裁字" ──
    #   判据（横竖屏同一套）：文字**亮像素包围盒**必须落在安全边内（左/右 ≥3%W、上/下 ≥3%H）。
    #   为什么这条能同时守"字距"和"渐变"：
    #     · 字距：`_track_cjk` 逐字插 U+2009 → 整串变宽（实测 7 字 +17.3%），越界就会在左右边被切；
    #     · 渐变：`text_grad_pair` 的下层字**下移 dy=2px** → 越界会在底边多出 2px 亮边。
    #   本机实测这条口径能抓到真事故（★VF_SUSTAIN_V3 那次 magazine 压边标题被浮动裁字）。
    print('\n⑤ 竖屏标题页：字距/渐变越界检查（亮像素包围盒）')
    sbt = os.path.join(wd, 'sb_portrait_title.json')
    open(sbt, 'w', encoding='utf-8').write(json.dumps(
        {'size': [Wp, Hp], 'fps': 25, 'theme': 'news',
         'shots': [{'type': 'title', 'variant': 'deck', 'text': '本地出片三步走',
                    'subtitle': '横竖屏都支持',
                    'items': ['选题定位', '脚本生成', '一键成片'], 'kicker': '本地出片',
                    'dur': 6.0}]}, ensure_ascii=False))
    #   ⚠️ 必须 `variant='deck'`：字距（`track_fit`）与上浅下深（`text_grad_pair`）都在 **deck 版式页**
    #   这条路径上。用普通 title 卡会走到老 `card_title` 的"浅色信息卡"分支 → 亮像素包围盒量到的是
    #   **卡面本身**（整块浅色），而不是字（本机实测过：bbox = 卡面矩形，会误报"越界 1px"）。
    _od = os.path.join(wd, 'pp_portrait_title')
    _r = subprocess.run([sys.executable, os.path.join(HERE, 'render.py'), '--storyboard', sbt,
                         '--ppt-preview', '--outdir', _od],
                        capture_output=True, text=True, encoding='utf-8', errors='replace')
    _png = os.path.join(_od, 'p01.png')
    _logn = (_r.stdout or '') + (_r.stderr or '')
    chk('字距=' in _logn, '⑤ 日志里报了字距决定（插/不插 + 理由）',
        [_x.strip() for _x in _logn.splitlines() if '字距=' in _x][:1])
    if os.path.exists(_png):
        _raw = subprocess.run([ff, '-v', 'error', '-i', _png, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'],
                             capture_output=True).stdout
        _W, _H = Wp, Hp
        if len(_raw) >= _W * _H:
            _px = [x for y in range(_H) for x in range(_W) if _raw[y * _W + x] >= 128]
            _py = [y for y in range(_H) for x in range(_W) if _raw[y * _W + x] >= 128]
            _x0, _x1, _y0, _y1 = min(_px), max(_px), min(_py), max(_py)
            chk(_x0 >= int(_W * 0.03) and _x1 <= int(_W * 0.97) and _y0 >= int(_H * 0.03)
                and _y1 <= int(_H * 0.97),
                '⑤ 竖屏标题页**不越界/不裁字**：字号盒 x[%d,%d] y[%d,%d] ∈ 安全边'
                ' [%.0f,%.0f]×[%.0f,%.0f]'
                % (_x0, _x1, _y0, _y1, _W * 0.03, _W * 0.97, _H * 0.03, _H * 0.97))
            # ⚠️ 不能拿"包围盒高度"当"标题块高度"：它覆盖**整页所有亮字**（kicker/标题/要点/页码）。
            #   真正要证的"字距没把标题挤坏" → 看**标题仍是 1 行**（7 字 ≤ one_line_max=9）。
            _m = _re.search(r'标题(\d+)行', _logn)
            chk(bool(_m) and int(_m.group(1)) == 1,
                '⑤ 竖屏 7 字标题仍排成**一行**（字距没把它挤成两行）',
                _m.group(0) if _m else '日志里没找到"标题N行"')
            chk('字距=插细空格' in _logn or '字距=不插' in _logn,
                '⑤ 字距决定是"插细空格"或"不插（损失>10%）"之一（判据生效）',
                [_x.strip() for _x in _logn.splitlines() if '字距=' in _x][:1])
        else:
            chk(False, '⑤ 竖屏标题页取原始像素失败')
    else:
        chk(False, '⑤ 竖屏标题页抽帧失败')
    # ── 判据的**反向**证明：长标题在竖屏下必然"插不下" → 必须自动退回"不插"（而不是硬插到字号变小）──
    sbl = os.path.join(wd, 'sb_portrait_long.json')
    open(sbl, 'w', encoding='utf-8').write(json.dumps(
        {'size': [Wp, Hp], 'fps': 25, 'theme': 'news',
         'shots': [{'type': 'title', 'variant': 'deck', 'text': '本地出片三步走全流程拆解',
                    'items': ['选题定位'], 'dur': 6.0}]}, ensure_ascii=False))
    _odl = os.path.join(wd, 'pp_portrait_long')
    _rl = subprocess.run([sys.executable, os.path.join(HERE, 'render.py'), '--storyboard', sbl,
                          '--ppt-preview', '--outdir', _odl],
                         capture_output=True, text=True, encoding='utf-8', errors='replace')
    _llog = (_rl.stdout or '') + (_rl.stderr or '')
    _ln = [_x.strip() for _x in _llog.splitlines() if '字距=' in _x]
    chk(bool(_ln), '⑤ 长标题页也报了字距决定', _ln[:1])
    #   **判据本身**（纯逻辑，两个方向都验；比"某条真片恰好触发"更硬）：
    #     ① 宽敞（1280 横屏 1 行）→ 采纳字距，且**字号与不插时相同**（说明字距确实"白捡"）；
    #     ② 窄幅 1 行（720 竖屏 + 60% 可用宽）→ **退回不插**，且字号 = 不插那版（退出得干净，无中间态）。
    _kwA = dict(fs_max=64, max_lines=1, maxw_ratio=0.86, fs_min=18, one_line_max=9)
    _lA, _fsA, _trA = R.track_fit('本地出片三步走', 1280, 720, **_kwA)
    _lA0, _fsA0 = R.fit_big_text('本地出片三步走', 1280, 720, **_kwA)
    chk(_trA and _fsA == _fsA0,
        '⑤ 判据①：横屏宽敞 → 采纳字距且字号不掉（fs=%d）' % _fsA, 'tracked=%s' % _trA)
    _kwB = dict(fs_max=64, max_lines=1, maxw_ratio=0.60, fs_min=18, one_line_max=12)
    _lB, _fsB, _trB = R.track_fit('本地出片三步走全流程拆解', 720, 1280, **_kwB)
    _lB0, _fsB0 = R.fit_big_text('本地出片三步走全流程拆解', 720, 1280, **_kwB)
    _lB1, _fsB1 = R.fit_big_text(R._track_cjk('本地出片三步走全流程拆解'), 720, 1280, **_kwB)
    chk((not _trB) and _fsB == _fsB0,
        '⑤ 判据②：窄幅 1 行长标题 → 退回"不插"，字号 %d（若硬插会掉到 %d，损失 %.0f%%）'
        % (_fsB, _fsB1, (1 - _fsB1 / float(_fsB0)) * 100), 'tracked=%s' % _trB)
    _pngl = os.path.join(_odl, 'p01.png')
    if os.path.exists(_pngl):
        _rawl = subprocess.run([ff, '-v', 'error', '-i', _pngl, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'],
                               capture_output=True).stdout
        if len(_rawl) >= Wp * Hp:
            _lx = [x for y in range(Hp) for x in range(Wp) if _rawl[y * Wp + x] >= 128]
            _ly = [y for y in range(Hp) for x in range(Wp) if _rawl[y * Wp + x] >= 128]
            chk(min(_lx) >= int(Wp * 0.03) and max(_lx) <= int(Wp * 0.97)
                and min(_ly) >= int(Hp * 0.03) and max(_ly) <= int(Hp * 0.97),
                '⑤ 长标题页同样不越界（x[%d,%d] y[%d,%d]）'
                % (min(_lx), max(_lx), min(_ly), max(_ly)))
        else:
            chk(False, '⑤ 长标题页取原始像素失败')
    else:
        chk(False, '⑤ 长标题页抽帧失败')


def main():
    wd = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'dist-rel', 'ppt-demo', 'overlay')
    print('★VF_PPT_OVERLAY_V1 护栏   render.py=%s' % os.path.join(HERE, 'render.py'))
    strings()
    frames(wd)
    portrait(wd)
    print('\n证据帧目录：%s' % wd)
    print('===== 结果：%d PASS / %d FAIL =====' % (len(OK), len(NG)))
    for m in NG:
        print('  ✗ ' + m)
    return 1 if NG else 0


if __name__ == '__main__':
    sys.exit(main())
