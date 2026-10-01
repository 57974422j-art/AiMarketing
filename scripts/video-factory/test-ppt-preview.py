#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""★VF_PPTPREVIEW_V1 回归护栏（2026-10-01）—— `--ppt-preview` 的 CLI/产物**契约**。

老板原话：「完全成片之前能把PPT抽出来审核一下效果吗？」
契约（服务端队友按它接线，**逐字不能飘**）：
  python scripts/video-factory/render.py --storyboard <sb.json> --ppt-preview --outdir <目录>
  产物：p01.png / p02.png …（编号 = 镜序，两位数补零）+ index.json
  index.json = [{"i":1,"file":"p01.png","type":"bgimage","variant":"deck-mag","t":4.5,
                 "text":"…","subtitle":"…"}]  ← 键名与顺序照此
三条硬口径（本测试逐条守）：
  ① 复用出片用的同一套渲染代码（render_shot(..., still=)），**不另写一份渲染**；
  ② 只渲 1 帧（不渲整段视频）；
  ③ 不烧字幕、不烧顶部固定标题。
用法：python scripts/video-factory/test-ppt-preview.py [--render] [--wd <目录>]
"""
import argparse
import json
import os
import struct
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
RENDER = os.path.join(HERE, 'render.py')
sys.path.insert(0, HERE)

import render as R  # noqa: E402

OK, NG = [], []


def chk(cond, msg, extra=''):
    (OK if cond else NG).append(msg)
    print('  %s %s%s' % ('[PASS]' if cond else '[FAIL]', msg, ('  ← ' + str(extra)) if extra else ''))


def structural():
    print('\n① 结构断言：时刻口径 / variant 解析 / 复用同一套渲染')
    # "内容全就位"时刻：落在 (1.2s, dur-0.45s) 内，且随镜长单调不减
    _durs = (1.0, 2.0, 3.0, 6.5, 8.0, 12.0)
    ts = [R._ppt_settle_t(d) for d in _durs]
    chk(all(0.0 < t <= d - 0.45 + 1e-9 for t, d in zip(ts, _durs)),
        '时刻 t 一定**早于镜尾淡出**（t ≤ dur-0.45，绝不取到黑帧）', ts)
    chk(all(t >= min(1.2, d - 0.45) - 1e-9 for t, d in zip(ts, _durs)),
        '时刻 t 尽量 ≥1.2s（过了入场位移）；短镜兜底 = dur-0.45', ts)
    chk(all(ts[i] <= ts[i + 1] + 1e-9 for i in range(len(ts) - 1)), '时刻随镜长单调不减', ts)
    chk(abs(R._ppt_settle_t(8.0) - 4.96) < 1e-6, '8s 镜 → t=4.96s（≈团队示例里的 t=4.5 量级）',
        R._ppt_settle_t(8.0))
    # variant 解析：报"渲染层实际生效"的那个（老板就是被 variant 全为 null 误导过）
    chk(R._preview_variant({'type': 'title'}, 'title') == 'center'
        and R._preview_variant({'type': 'title', 'variant': 'deck-mag'}, 'title') == 'deck-mag'
        and R._preview_variant({}, 'list') == 'steps'
        and R._preview_variant({}, 'compare') == 'split'
        and R._preview_variant({}, 'bgimage') == '',
        'variant 解析：title→center / list→steps / compare→split / 素材卡→空（如实上报生效值）')
    # 主视觉文字：number 报大数字、list/chart 报标题
    chk(R._preview_text({'value': 128, 'suffix': '%'}, 'number') == '128%'
        and R._preview_text({'title': '三步走'}, 'list') == '三步走',
        'text 解析：number→大数字 / list→标题（不是字幕兜底文字）')
    # 源码级：必须复用 render_shot 的 still 出口，不得另起炉灶
    code = open(RENDER, encoding='utf-8').read()
    _nc = '\n'.join(l for l in code.splitlines() if not l.strip().startswith('#'))
    chk('def render_shot(shot, th, workdir, idx, W, H, fps, ffmpeg, still=None)' in code,
        'render_shot 增加 still= 出口（同一函数里出 1 帧）')
    chk('render_shot(shot, th, wd, i, W, H, fps, ffmpeg, still=(_t, _png))' in code,
        '--ppt-preview 走的就是 render_shot(..., still=(t, png)) —— 同一套渲染代码')
    chk(_nc.count('trim=start=') == 1,
        '代码里只有 1 处 trim（只在 still 出口用；没有第二套抽帧实现）', _nc.count('trim=start='))
    chk('--ppt-preview' in code and '--outdir' in code, 'CLI 契约参数在位（--ppt-preview / --outdir）')


def _png_size(p):
    with open(p, 'rb') as f:
        head = f.read(33)
    if len(head) < 33 or head[:8] != b'\x89PNG\r\n\x1a\n':
        return (0, 0)
    return struct.unpack('>II', head[16:24])


def real_run(wd):
    print('\n② 真跑 CLI（逐字按契约命令）→ 校验产物与 index.json')
    os.makedirs(wd, exist_ok=True)
    sb = {'size': [1280, 720], 'fps': 25, 'shots': [
        {'type': 'title', 'text': '三大能力一次搞定', 'subtitle': '一条视频从选题到发布', 'dur': 5.0},
        {'type': 'title', 'variant': 'deck', 'kicker': '本地成片', 'text': '三步走完一条片',
         'items': ['选题定位', '脚本生成', '一键成片'], 'subtitle': '整条链路只需要三步', 'dur': 6.0},
        {'type': 'number', 'value': 128, 'suffix': '%', 'label': '转化率提升',
         'subtitle': '对比人工剪辑', 'dur': 4.0},
    ]}
    sbp = os.path.join(wd, 'sb.json')
    open(sbp, 'w', encoding='utf-8').write(json.dumps(sb, ensure_ascii=False))
    od = os.path.join(wd, 'out')
    r = subprocess.run([sys.executable, RENDER, '--storyboard', sbp, '--ppt-preview',
                        '--outdir', od], capture_output=True, text=True,
                       encoding='utf-8', errors='replace')
    chk(r.returncode == 0, 'rc=0（无异常退出）', r.returncode)
    files = ['p%02d.png' % i for i in (1, 2, 3)]
    chk(all(os.path.exists(os.path.join(od, f)) for f in files),
        '产物 p01/p02/p03.png 齐（编号=镜序，两位数补零）',
        [f for f in files if not os.path.exists(os.path.join(od, f))])
    _sizes = [_png_size(os.path.join(od, f)) for f in files]
    chk(all(s == (1280, 720) for s in _sizes), 'PNG 尺寸 = 1280×720', _sizes)
    ip = os.path.join(od, 'index.json')
    chk(os.path.exists(ip), 'index.json 存在')
    if os.path.exists(ip):
        idx = json.load(open(ip, encoding='utf-8'))
        want_keys = ['i', 'file', 'type', 'variant', 't', 'text', 'subtitle']
        chk(isinstance(idx, list) and len(idx) == 3, 'index.json 是长度=镜数的数组', len(idx))
        chk(all(list(e.keys()) == want_keys for e in idx),
            'index.json 每条的键与顺序 = %s（服务端按此接线）' % want_keys,
            list(idx[0].keys()) if idx else '')
        chk([e['i'] for e in idx] == [1, 2, 3] and [e['file'] for e in idx] == files,
            'i 从 1 起、file 与镜序一一对应')
        chk(idx[1]['variant'] == 'deck', '第 2 镜（variant=deck）如实上报 deck', idx[1]['variant'])
        chk(idx[2]['text'] == '128%', 'number 卡的 text = 大数字 128%', idx[2]['text'])
        chk(all(1.2 <= e['t'] <= 6.0 for e in idx), '每条的 t 落在合法窗口', [e['t'] for e in idx])
    # ★不烧字幕 / 不烧顶部固定标题：给一个 banner，预览里也不该出现它
    sb['banner'] = {'line1': '顶部固定标题不该出现在预览里'}
    open(sbp, 'w', encoding='utf-8').write(json.dumps(sb, ensure_ascii=False))
    r2 = subprocess.run([sys.executable, RENDER, '--storyboard', sbp, '--ppt-preview',
                         '--outdir', od], capture_output=True, text=True,
                        encoding='utf-8', errors='replace')
    chk('不带顶部固定标题' in (r2.stdout or ''), '日志明说：预览不烧字幕/不烧顶部固定标题')
    chk('banner' not in (r2.stdout or '').split('★VF_PPTPREVIEW_V1 完成')[0].split('★VF_STYLES')[0],
        '预览链路里没有走 banner_layer（顶部固定标题未参与抽帧）')


def pixel_identity(wd):
    """可选（--render）：预览 PNG vs「整段成片里同一时刻的帧」——证明预览与成片是**同一套渲染**。

    ⚠️ 两条必须绕开的坑（否则这条断言必然时红时绿）：
      1) lavfi `gradients` 的相位**随进程**变化，`speed=0` 也冻不死它（test-deck-styles2 实测过）
         → 背景**逐像素**永远对不齐 → 改成比【文字掩膜】（luma≥200），背景差异被完全忽略。
      2) 镜内还有 26px 横向浮动 → 取到相邻一帧就整体差 ~1.2px。
         → 取 t = 1.0×浮动周期（=4.0s 周期的极值点，速度=0）→ 相邻帧几乎不动。
    于是这条断言比的是"文字/版式在不在同一个位置"，结构不同会立刻红。"""
    print('\n③ 可选硬断言：预览帧 vs 成片同刻帧（文字掩膜比对）')
    os.makedirs(wd, exist_ok=True)
    os.environ['VF_GRAD_SPEED'] = '0'          # 尽量压低背景差异（阶段 1 已说明它冻不死）
    ff = R.find_ffmpeg()
    th = R.theme_of('news')
    shot = {'type': 'title', 'text': '预览与成片必须同源', 'subtitle': '同一套渲染代码', 'dur': 4.0}
    wd2 = os.path.join(wd, 'pixwd')
    os.makedirs(wd2, exist_ok=True)
    t = 3.0                                     # = 3/4 浮动周期（sin 极值，速度 0；且 < dur=4s）
    prev = os.path.join(wd2, 'p.png')
    R.render_shot(dict(shot), th, wd2, 0, 1280, 720, 25, ff, still=(t, prev))
    mp4 = R.render_shot(dict(shot), th, wd2, 0, 1280, 720, 25, ff)
    frame = os.path.join(wd2, 'frame.png')
    # `-ss` 放 -i 之后（输出端 seek）→ 取到确定的那一帧（见 test-deck-styles2 的 ★VF_DECK_PIXEL_V2）
    subprocess.run([ff, '-y', '-v', 'error', '-i', mp4, '-ss', '%.3f' % t,
                    '-frames:v', '1', frame], capture_output=True)
    if not (os.path.exists(frame) and os.path.exists(prev)):
        chk(False, '取帧失败（跳过）')
        return
    W, H = 320, 180
    _s = 'scale=%d:%d' % (W, H)

    def _gray(p):
        return subprocess.run([ff, '-v', 'error', '-i', p, '-vf', _s, '-f', 'rawvideo',
                               '-pix_fmt', 'gray', '-'], capture_output=True).stdout

    a, b = _gray(prev)[:W * H], _gray(frame)[:W * H]
    if len(a) < W * H or len(b) < W * H:
        chk(False, '取原始像素失败')
        return
    ma = [1 if v >= 200 else 0 for v in a]
    mb = [1 if v >= 200 else 0 for v in b]
    union = sum(1 for i in range(W * H) if ma[i] or mb[i])
    diff = sum(1 for i in range(W * H) if ma[i] != mb[i])
    ratio = (diff / float(union)) if union else 1.0
    chk(union > 500, '两张图都真有文字掩膜（union=%d 像素）' % union)
    chk(ratio <= 0.35, '预览 vs 成片同刻帧：文字掩膜不一致率 %.1f%%（≤35%% = 同源；'
                       '版式/位置不同会接近 100%%）' % (ratio * 100))
    print('  [INFO] 掩膜 union=%d px，不一致 %d px；这差额来自 h264 量化 + 亚像素位移' % (union, diff))


def banner_check(wd):
    """★VF_PPTPREVIEW_BANNER_V1（可选开关）：--with-banner 默认关、开了才把顶部固定标题烧进抽帧。"""
    print('\n④ 开关：--with-banner（默认不烧固定标题；开了才烧，行为可回退）')
    os.makedirs(wd, exist_ok=True)
    sb = {'size': [1280, 720], 'fps': 25,
          'banner': {'line1': '顶部固定标题 8.5% 点击率', 'line2': '曝光量150万+ 转化率90%'},
          'shots': [{'type': 'title', 'text': '预览抽帧', 'subtitle': '审 PPT 版式', 'dur': 4.0}]}
    sbp = os.path.join(wd, 'sb_banner.json')
    open(sbp, 'w', encoding='utf-8').write(json.dumps(sb, ensure_ascii=False))
    o1, o2 = os.path.join(wd, 'bn_off'), os.path.join(wd, 'bn_on')
    r1 = subprocess.run([sys.executable, RENDER, '--storyboard', sbp, '--ppt-preview', '--outdir', o1],
                        capture_output=True, text=True, encoding='utf-8', errors='replace')
    r2 = subprocess.run([sys.executable, RENDER, '--storyboard', sbp, '--ppt-preview',
                         '--with-banner', '--outdir', o2],
                        capture_output=True, text=True, encoding='utf-8', errors='replace')
    chk('--with-banner 已开' not in (r1.stdout or '') and '--with-banner 已开' in (r2.stdout or ''),
        '默认不烧固定标题；加了 --with-banner 才烧（日志自述口径）')
    p1, p2 = os.path.join(o1, 'p01.png'), os.path.join(o2, 'p01.png')
    if not (os.path.exists(p1) and os.path.exists(p2)):
        chk(False, '--with-banner 产物缺失')
        return
    ff = R.find_ffmpeg()
    W, H = 320, 180
    _s = 'scale=%d:%d' % (W, H)

    def _g(p):
        return subprocess.run([ff, '-v', 'error', '-i', p, '-vf', _s, '-f', 'rawvideo',
                               '-pix_fmt', 'gray', '-'], capture_output=True).stdout[:W * H]

    a, b = _g(p1), _g(p2)
    _top = slice(0, int(W * H * 0.16))          # 顶部 16% = 固定标题所在带
    d = sum(abs(a[i] - b[i]) for i in range(W * H)) / float(W * H)
    dt = sum(abs(a[i] - b[i]) for i in range(int(W * H * 0.16))) / float(int(W * H * 0.16))
    chk(dt > 8.0, '开了开关后**顶部条带**确实变了（平均差 %.1f > 8）→ banner 真烧进去了' % dt)
    chk(d > 1.0, '两帧整体也有差（%.1f）' % d)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--render', action='store_true', help='再加上"预览==成片同刻帧"的像素硬断言')
    ap.add_argument('--wd', default='')
    a = ap.parse_args()
    wd = a.wd or os.path.join(ROOT, 'dist-rel', 'ppt-preview', '_selftest')
    print('★VF_PPTPREVIEW_V1 护栏   render.py = %s' % RENDER)
    structural()
    real_run(wd)
    banner_check(wd)
    if a.render:
        pixel_identity(wd)
    print('\n===== 结果：%d PASS / %d FAIL =====' % (len(OK), len(NG)))
    for m in NG:
        print('  ✗ ' + m)
    return 1 if NG else 0


if __name__ == '__main__':
    sys.exit(main())
