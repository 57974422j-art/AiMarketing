#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""★VF_PPT_BALANCE_V1 回归护栏（2026-10-02 老板）：「每 2~3 镜至少一页 PPT」。

背景（team-lead 转述老板）：「现在 apply_style 只把 title 卡升成 deck → 那条 7 镜片只有 1~2 页 PPT，
观感'还是大字多'」→ 要从**素材镜**里挑"信息量最大"的补成 PPT 页。

硬约束（本测试逐条守）：
  ① 每 2~3 镜至少一页（间隔 ≤3）；
  ② **不连续 3 镜都是 PPT**；
  ③ **开场第 1 镜与结尾镜保持普通卡**（只在 ≥4 镜时成立）；
  ④ **不选风格 → plan 逐字节零改动**；
  ⑤ 视频镜补成**叠加页**（overlay_ppt），图片镜补成 **deck 素材页**（variant）。

用法：python scripts/video-factory/test-ppt-balance.py [--wd <目录>]
"""
import json
import os
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


def _ppt_set(sb):
    return {i for i, s in enumerate(sb.get('shots') or [])
            if isinstance(s, dict) and (bool(R.deck_style_of(s)) or bool(R.ppt_overlay_on(s)))}


def _plan(img, vid):
    """7 镜样片：①开场 title ②信息量大的图片 ③视频 ④信息量小的图片 ⑤number ⑥视频 ⑦结尾 end"""
    return {'size': [1280, 720], 'fps': 25, 'shots': [
        {'type': 'title', 'text': '开场大字', 'subtitle': '第一镜保持普通卡', 'dur': 4.0},
        {'type': 'bgimage', 'src': img, 'kicker': '图片页', 'text': '信息量大',
         'items': ['选题定位', '脚本生成', '一键成片'],
         'stats': [{'value': '128', 'suffix': '%', 'label': '转化率提升'}], 'dur': 6.0},
        {'type': 'video', 'src': vid, 'kicker': '视频页', 'text': '视频镜',
         'items': ['素材铺满', '面板压角'], 'dur': 12.0},
        {'type': 'bgimage', 'src': img, 'text': '', 'subtitle': '信息量小的一镜', 'dur': 5.0},
        {'type': 'number', 'value': 98, 'suffix': '%', 'label': '满意度', 'dur': 5.0},
        {'type': 'video', 'src': vid, 'kicker': '视频页2', 'text': '再来一镜',
         'items': ['要点'], 'dur': 12.0},
        {'type': 'end', 'text': '关注我们', 'cta': '点击咨询', 'dur': 4.0},
    ]}


def logic(wd):
    print('\n① 7 镜样片：分布约束（纯逻辑，不渲染）')
    img = os.path.join(wd, 'p.jpg')
    vid = os.path.join(wd, 'v.mp4')
    ff = R.find_ffmpeg()
    subprocess.run([ff, '-y', '-v', 'error', '-f', 'lavfi', '-i',
                    'gradients=s=768x1344:c0=0x2f2c30:c1=0x9c9284:x0=0:y0=0:x1=768:y1=1344:d=1',
                    '-frames:v', '1', img], capture_output=True)
    subprocess.run([ff, '-y', '-v', 'error', '-f', 'lavfi', '-i',
                    'gradients=s=768x1344:c0=0x1a1a1e:c1=0x3a3a42:x0=0:y0=0:x1=768:y1=1344:d=14',
                    '-t', '14', '-r', '25', '-pix_fmt', 'yuv420p', vid], capture_output=True)
    sb = _plan(img, vid)
    _before = json.dumps(sb, sort_keys=True)
    R.apply_style(sb, 'cleanlight')
    ppt = _ppt_set(sb)
    _1b = sorted(x + 1 for x in ppt)
    chk(0 not in ppt, '① 开场第 1 镜保持普通卡（没有被升级成 PPT）', '第 %s 镜是 PPT' % _1b)
    chk(6 not in ppt, '① 结尾镜保持普通卡')
    chk(2 in ppt, '② 视频镜（第 3 镜）被补成**叠加页**', sb['shots'][2])
    chk(bool(sb['shots'][2].get('overlay_ppt')) and sb['shots'][2].get('_ppt_overlay_auto') is True,
        '② 视频镜走的是 `overlay_ppt`（叠加页），不是 variant')
    chk('variant' in sb['shots'][1] and sb['shots'][1]['variant'] == 'deck-soft',
        '② 信息量大的图片镜（第 2 镜）被补成 **deck 素材页**（cleanlight → deck-soft）',
        sb['shots'][1].get('variant'))
    # 间隔 ≤3：任意位置往前看，最近的 PPT 页距离不超过 3
    _gap_ok, _gap_bad = True, []
    _last = 0
    for i in range(1, 6):
        if i in ppt:
            _last = i
        elif i - _last > 3:
            _gap_ok = False
            _gap_bad.append(i + 1)
    chk(_gap_ok, '③ 每 2~3 镜至少一页 PPT（间隔 ≤3）', '缺口在镜 %s' % _gap_bad)
    _run3 = [(i + 1, i + 2, i + 3) for i in range(len(sb['shots']) - 2)
             if {i, i + 1, i + 2} <= ppt]
    chk(not _run3, '③ 不出现连续 3 镜都是 PPT', str(_run3))
    # 零回归：不选风格 / 非法风格 → 逐字节不变
    sb2 = _plan(img, vid)
    chk(R.apply_style(sb2, '') == '' and json.dumps(sb2, sort_keys=True) == _before,
        '④ 不选风格 → plan 逐字节零改动')
    sb3 = _plan(img, vid)
    chk(R.apply_style(sb3, 'cinematic') == '' and json.dumps(sb3, sort_keys=True) == _before,
        '④ 非法风格（cinematic）→ 同样零改动')
    # ≤3 镜的片子不做"开场/结尾"例外（否则单页样张/预览会突然没版式）
    sb4 = {'shots': [{'type': 'title', 'text': 'A', 'dur': 4}]}
    R.apply_style(sb4, 'cleanlight')
    chk(R.deck_of(sb4['shots'][0]), '③ ≤3 镜的片子不做开场例外（单镜样张仍有版式）')
    return sb, sb['shots']


def real(wd, _mutated):
    print('\n② 真渲 7 镜样片（根级 style=cleanlight，由 apply_style 现场升级）→ 日志/链路')
    # ⚠️ 这里必须用**未升级过的原始分镜** + 根级 `style`：让 render.py 自己走一遍 apply_style，
    #    才验证得到"提升为 PPT 的镜=…"这条日志（升级是**幂等**的，喂已升级的 plan 不会再报）。
    sb_after = _plan(os.path.join(wd, 'p.jpg'), os.path.join(wd, 'v.mp4'))
    sb_after['style'] = 'cleanlight'
    p = os.path.join(wd, 'sb7.json')
    open(p, 'w', encoding='utf-8').write(json.dumps(sb_after, ensure_ascii=False))
    out = os.path.join(wd, 'after.mp4')
    r = subprocess.run([sys.executable, os.path.join(HERE, 'render.py'), '--storyboard', p,
                        '--out', out, '--workdir', os.path.join(wd, 'wd_after'),
                        '--no-banner', '--no-subs'],
                       capture_output=True, text=True, encoding='utf-8', errors='replace')
    chk(r.returncode == 0 and os.path.exists(out), '② 7 镜样片 rc=0 出片', 'rc=%s' % r.returncode)
    log = r.stdout or ''
    _l1 = [l.strip() for l in log.splitlines() if 'PPT 页兜底' in l]
    _l2 = [l.strip() for l in log.splitlines() if '本片 PPT 页共' in l]
    chk(bool(_l1), '② 日志有「提升为 PPT 的镜=第 x/y/z 镜」', str(_l1)[:110])
    chk(bool(_l2), '② 日志有「本片 PPT 页共 N 片」', str(_l2)[:110])
    # 改造前对照：同一分镜**不选风格**跑一遍
    p0 = os.path.join(wd, 'sb7_off.json')
    sb0 = json.loads(json.dumps(sb_after))
    for _k in ('style',):
        sb0.pop(_k, None)
    for _k in ('enter', '_float_per'):
        pass
    open(p0, 'w', encoding='utf-8').write(json.dumps(sb0, ensure_ascii=False))
    r0 = subprocess.run([sys.executable, os.path.join(HERE, 'render.py'), '--storyboard', p0,
                         '--out', os.path.join(wd, 'before.mp4'),
                         '--workdir', os.path.join(wd, 'wd_before'), '--no-banner', '--no-subs'],
                        capture_output=True, text=True, encoding='utf-8', errors='replace')
    chk('PPT 页兜底' not in (r0.stdout or ''),
        '② 改造前对照：不选风格时**没有任何 PPT 兜底**动作（零回归）')
    # 证据帧：被提升的视频镜（第 3 镜）在 t=2 / t=9 的两帧
    ff = R.find_ffmpeg()
    for t, nm in ((2.0, 'shot3_t2.png'), (9.0, 'shot3_t9.png')):
        subprocess.run([ff, '-y', '-v', 'error', '-i', out, '-ss', '%.2f' % (4.0 + 6.0 + t),
                        '-frames:v', '1', os.path.join(wd, nm)], capture_output=True)
    chk(os.path.exists(os.path.join(wd, 'shot3_t2.png'))
        and os.path.exists(os.path.join(wd, 'shot3_t9.png')),
        '② 被提升的视频镜两帧证据在（第 3 镜 t=2 / t=9）', wd)


def main():
    wd = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'dist-rel', 'ppt-demo', 'balance')
    os.makedirs(wd, exist_ok=True)
    print('★VF_PPT_BALANCE_V1 护栏   render.py=%s' % os.path.join(HERE, 'render.py'))
    sb, _ = logic(wd)
    real(wd, sb)
    print('\n输出目录：%s' % wd)
    print('===== 结果：%d PASS / %d FAIL =====' % (len(OK), len(NG)))
    for m in NG:
        print('  ✗ ' + m)
    return 1 if NG else 0


if __name__ == '__main__':
    sys.exit(main())
