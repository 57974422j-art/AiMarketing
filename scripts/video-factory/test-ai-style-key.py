#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""★VF_AI_STYLE_KEY_V1 回归护栏（2026-10-01）：「AI 制片线画面风格」字段改名 `style` → `ai_style`
之后，**三处口径必须同时对**（任何一处错都会出线上事故）：

  ① `make.py` 读 `ai_style`（**带旧值 `style` 兜底**）→ H3 画面风格关键词不丢；
     漏了 → AI 制片线出片丢风格提示词（画面变成"没风格的实景空镜"）。
  ② `render.py` **不读** `ai_style`；它读的 plan 根级 `style` 走"只认 5 套成品风格"的严格守卫
     → AI 制片线的 `cinematic` 必须被**忽略**；若被当成成品风格 → 整条线被静默改成 news 蓝 + deck。
  ③ 两边互不误伤 + 合法的成品风格 key 仍照常生效（别把守卫改成"一律不动"）。

用法：python scripts/video-factory/test-ai-style-key.py
"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, HERE)

import make  # noqa: E402
import render as R  # noqa: E402

OK, NG = [], []


def chk(cond, msg, extra=''):
    (OK if cond else NG).append(msg)
    print('  %s %s%s' % ('[PASS]' if cond else '[FAIL]', msg, ('  ← ' + str(extra)) if extra else ''))


def lookup():
    print('\n① make.py 的 H3 风格查表：新字段 ai_style / 旧字段 style 都要查到')
    _cine = make.H3_STYLE_EN.get('cinematic', '')
    chk(bool(_cine), 'cinematic 在 H3_STYLE_EN 里（查表基线）', _cine[:40])
    chk(make._ai_style_en({'ai_style': 'cinematic'}) == _cine,
        "① 新字段：{'ai_style':'cinematic'} → 关键词", make._ai_style_en({'ai_style': 'cinematic'})[:40])
    chk(make._ai_style_en({'style': 'cinematic'}) == _cine,
        "① **旧值兜底**：{'style':'cinematic'}（老分镜）→ 同一个关键词",
        make._ai_style_en({'style': 'cinematic'})[:40])
    chk(make._ai_style_en({'ai_style': 'commercial', 'style': 'vlog'})
        == make.H3_STYLE_EN.get('commercial'),
        '① 两个字段都在时 ai_style 优先（新口径说了算）')
    chk(make._ai_style_en({}) == '' and make._ai_style_en({'ai_style': 'nope'}) == '',
        '① 都没有 / 认不出的值 → 空（绝不抛异常）')
    src = open(os.path.join(HERE, 'make.py'), encoding='utf-8').read()
    chk("sb.get('ai_style') or sb.get('style')" in src,
        '① 源码口径在位：`sb.get(\'ai_style\') or sb.get(\'style\')`')


def guard():
    print('\n② render.py 不读 ai_style；plan 根级 style 走严格守卫')
    code = '\n'.join(l for l in open(os.path.join(HERE, 'render.py'), encoding='utf-8').read().splitlines()
                     if not l.strip().startswith('#'))
    #   口径：**只允许**"收下但不用"（`--ai-style` 无操作登记 + getattr 打日志）；
    #   任何**取值**写法（plan 字典 / args 属性）都不许有 → 那就是抢字段、就是事故。
    _grab = [x for x in ("get('ai_style')", "['ai_style']", '.ai_style', "['ai_style']") if x in code]
    chk(not _grab and "add_argument('--ai-style'" in code,
        '② render.py 只**收下**--ai-style（opt-in 无操作），0 处取值 ai_style', str(_grab))
    chk(code.count("sb.get('style')") == 1,
        '② render.py 只 1 处读 plan 根级 style（且走 apply_style 严格守卫）',
        str(code.count("sb.get('style')")))
    _sb = {'theme': 'light', 'deck_style': 'deck-mag',
           'shots': [{'type': 'title', 'text': 'A', 'dur': 4}]}
    before = json.dumps(_sb, sort_keys=True)
    chk(R.apply_style(_sb, 'cinematic') == '' and json.dumps(_sb, sort_keys=True) == before,
        "② apply_style('cinematic') → plan 零改动（深比较）")
    chk(R.apply_style(dict(_sb), 'magazine') == 'magazine',
        "② apply_style('magazine')（自己的 key）→ 正常生效")


def real_run(wd):
    print('\n③ 真跑 CLI：三份 plan（新字段 / 旧字段 / 成品风格）行为必须各自正确')
    os.makedirs(wd, exist_ok=True)
    base = {'size': [1280, 720], 'fps': 25, 'theme': 'light',
            'shots': [{'type': 'title', 'text': '风格字段口径', 'dur': 4.0}]}
    cases = [('new_ai_style', dict(base, ai_style='cinematic')),
             ('legacy_style', dict(base, style='cinematic')),
             ('own_style', dict(base, style='magazine'))]
    seen = {}
    for name, sb in cases:
        p = os.path.join(wd, 'sb_%s.json' % name)
        open(p, 'w', encoding='utf-8').write(json.dumps(sb, ensure_ascii=False))
        od = os.path.join(wd, 'out_%s' % name)
        r = subprocess.run([sys.executable, os.path.join(HERE, 'render.py'), '--storyboard', p,
                            '--ppt-preview', '--outdir', od],
                           capture_output=True, text=True, encoding='utf-8', errors='replace')
        out = r.stdout or ''
        idxp = os.path.join(od, 'index.json')
        idx = json.load(open(idxp, encoding='utf-8')) if os.path.exists(idxp) else []
        seen[name] = (out, idx, dict(sb))
        print('     %-14s 主题日志=%s  variant=%s'
              % (name, [l.split('主题 = ')[-1][:12] for l in out.splitlines() if '主题 = ' in l],
                 idx[0]['variant'] if idx else '?'))
    o1, i1, _ = seen['new_ai_style']
    o2, i2, _ = seen['legacy_style']
    o3, i3, _ = seen['own_style']
    chk('主题 = light' in o1 and i1 and i1[0]['variant'] == 'center'
        and '忽略未知 style' not in o1,
        '③ 新字段 ai_style=cinematic：render.py **根本没看**（theme 仍 light / 标题没升 deck / 无忽略日志）')
    chk('主题 = light' in o2 and i2 and i2[0]['variant'] == 'center'
        and '忽略未知 style' in o2,
        "③ 旧字段 style='cinematic'（AI 制片老 plan）：被**忽略**（theme 仍 light / 没升 deck）+ 有忽略日志")
    chk('主题 = journal' in o3 and i3 and i3[0]['variant'] == 'deck-mag'
        and '成品风格=magazine' in o3,
        "③ 自己的 key style='magazine'：正常生效（theme=journal / 升成 deck-mag）")
    # 防御纵深：上游把 AI 标签当 CLI 参数透传下来时，**绝不能**因为 unknown argument 把整片渲染搞挂
    p = os.path.join(wd, 'sb_ai_arg.json')
    open(p, 'w', encoding='utf-8').write(json.dumps(
        {'size': [1280, 720], 'fps': 25, 'theme': 'light',
         'shots': [{'type': 'title', 'text': '透传 ai-style', 'dur': 4.0}]}, ensure_ascii=False))
    od = os.path.join(wd, 'out_ai_arg')
    r = subprocess.run([sys.executable, os.path.join(HERE, 'render.py'), '--storyboard', p,
                        '--ppt-preview', '--ai-style', 'cinematic', '--outdir', od],
                       capture_output=True, text=True, encoding='utf-8', errors='replace')
    out = r.stdout or ''
    idxp = os.path.join(od, 'index.json')
    idx = json.load(open(idxp, encoding='utf-8')) if os.path.exists(idxp) else []
    chk(r.returncode == 0 and idx and idx[0]['variant'] == 'center' and '主题 = light' in out
        and '★VF_AI_STYLE_KEY_V1 收到 --ai-style' in out and '成品风格=' not in out,
        '② `--ai-style cinematic` 透传进来：rc=0（不因 unknown argument 挂）+ 主题仍 light + 不触发成品风格',
        'rc=%s' % r.returncode)


def main():
    wd = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'dist-rel', 'style-preview',
                                                            'ai-style-key')
    print('★VF_AI_STYLE_KEY_V1 护栏   make.py=%s' % os.path.join(HERE, 'make.py'))
    lookup()
    guard()
    real_run(wd)
    print('\n===== 结果：%d PASS / %d FAIL =====' % (len(OK), len(NG)))
    for m in NG:
        print('  ✗ ' + m)
    return 1 if NG else 0


if __name__ == '__main__':
    sys.exit(main())
