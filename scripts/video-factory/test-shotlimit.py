#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""★VF_SHOTLIMIT_V1（2026-10-01）自测：单镜字幕硬闸门（make.py 里的 enforce_shot_limits）

为什么有这个闸门：
  用户实测（2026-10-01 成片 20261001_003，242 秒）：storyboard.voiced.json 里
  **第 30 镜 subtitle 276 字 / 配音 51.84s / 镜长 52.19s**（纯文字卡）→
  ① 全片计划 198 秒被拉到 242 秒；② 那一镜画面几乎完全不动（"最后缺帧、配音字幕都没完就定格了"）；
  ③ 逐帧实测"最后 37 秒连续静止"。TS 侧的 splitLongSubtitles 当时没生效 → 这里做独立兜底。

本自测覆盖（纯函数、不联网、不花钱、不渲染）：
  ① sub_cap 边界（含 None / 'abc' / 0 / 超大）
  ② split_text_by_cap：**拼回来一字不差**（含标点）、每段 ≤ 上限、无标点时硬切
  ③ enforce_shot_limits：003 那样的 276 字镜被拆开、字段完整继承、每段 ≥2 秒、
     时长按字数比例（总和守恒）、**幂等**（第二次跑 0 改动）、不动无辜的镜、
     容错（None/非 dict/空字幕）
  ④ 源码级契约：闸门位置**必须在 tts.py 之前**（否则音画错位）
用法：python scripts/video-factory/test-shotlimit.py
"""
import os
import sys
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import make  # noqa: E402

PASS, FAIL = [0], [0]
FAILED = []


def chk(cond, name, extra=''):
    if cond:
        PASS[0] += 1
    else:
        FAIL[0] += 1
        FAILED.append(name + (('  [' + str(extra) + ']') if extra else ''))


# ══════════════ ① sub_cap ══════════════
print('① sub_cap（单镜字幕上限 = min(60, ceil(dur×4.3))）')
chk(make.sub_cap(5) == 22, 'dur=5 → 22 字（5×4.3=21.5 向上取整）', make.sub_cap(5))
chk(make.sub_cap(3) == 13, 'dur=3 → 13 字', make.sub_cap(3))
chk(make.sub_cap(44) == 60, 'dur=44 → 命中 60 字硬上限', make.sub_cap(44))
chk(make.sub_cap(100) == 60, 'dur=100 → 仍是 60（上限封顶）', make.sub_cap(100))
chk(make.sub_cap(None) == 13, 'dur=None → 按 3 秒算 = 13', make.sub_cap(None))
chk(make.sub_cap('abc') == 13, 'dur 非法字符串 → 13', make.sub_cap('abc'))
chk(make.sub_cap(0) == 5, 'dur=0 → 下限 1 秒 → 5 字', make.sub_cap(0))
chk(make.SUB_MAX == 60 and make.SUB_CPS == 4.3 and make.SHOT_MIN_SEC == 2.0,
    '三个常量与 TS 侧同源（60 / 4.3 / 2.0）')


# ══════════════ ② split_text_by_cap ══════════════
print('\n② split_text_by_cap（标点优先；拼回来一字不差）')
s1 = '第一句话。' * 20
g = make.split_text_by_cap(s1, 30)
chk(''.join(g) == s1, '拼回来 === 原文（长句+标点）')
chk(all(len(x) <= 30 for x in g), '每段 ≤ 30 字', max(len(x) for x in g))
s2 = 'A' * 137                     # 无任何标点 → 只能硬切
g2 = make.split_text_by_cap(s2, 40)
chk(''.join(g2) == s2, '无标点长串：拼回来 === 原文')
chk([len(x) for x in g2] == [40, 40, 40, 17], '无标点长串 → 40/40/40/17', [len(x) for x in g2])
chk(make.split_text_by_cap('短句。', 60) == ['短句。'], '未超上限 → 原样一段')
chk(make.split_text_by_cap('', 60) == [], '空串 → []')
chk(make.split_text_by_cap(None, 60) == [], 'None → []')
# 标点跟在前段尾部（拼回来字节级一致）
s3 = '甲。乙！丙？丁；戊，己。'
chk(''.join(make.split_text_by_cap(s3, 4)) == s3, '混合标点：拼回来 === 原文')

# ══════════════ ③ enforce_shot_limits ══════════════
print('\n③ enforce_shot_limits（003 那种 276 字镜必须被拆开）')
big = ('这里多了Target Audience精准定向，Promotion Mechanism促销机制，'
       'Channel Strategy渠道策略，Content Generation内容生成，'
       'AI Marketing自动化营销方案一键输出，核心优势分析与目标人群画像，'
       '具体推广策略与素材投放，品牌定位与卖点提炼，全域引流与转化提升，'
       '智能代理自动生成任务，置信度高达百分之九十四，点击率预计八点五，'
       '曝光量预计一百五十万，让营销效率翻倍立即体验未来科技。')
big = big[:276] if len(big) > 276 else (big + '补' * (276 - len(big)))
sb = {
    'size': [1280, 720], 'fps': 25, 'theme': 'mint',
    'shots': [
        {'type': 'bgimage', 'src': '/tmp/a.jpg', 'text': '策略优化', 'dur': 7.63, 'subtitle': '这是一条正常长度的字幕，三十来字左右。'},
        {'type': 'title', 'text': '立即体验', 'dur': 44, 'subtitle': big},
        {'type': 'end', 'text': '结尾', 'dur': 4, 'subtitle': ''},
    ],
}
orig_shots = [dict(s) for s in sb['shots']]
changed, notes, soft = make.enforce_shot_limits(sb)
chk(changed is True, '276 字镜 → 判定超限并拆分')
chk(len(sb['shots']) == 3 - 1 + len(make.split_text_by_cap(big, 60)),
    '拆后镜数 = 原 3 镜 - 1 + 拆出的段数', len(sb['shots']))
segs = [s for s in sb['shots'] if s.get('type') == 'title']
chk(''.join(str(s.get('subtitle') or '') for s in segs) == big,
    '拆出来的字幕拼回来 === 原文（276 字一字不丢）')
chk(all(len(str(s.get('subtitle') or '')) <= 60 for s in sb['shots']),
    '拆后每段 ≤ 60 字', max(len(str(s.get('subtitle') or '')) for s in sb['shots']))
chk(all(float(s.get('dur') or 0) >= 1.99 for s in sb['shots']), '拆后每段 ≥2 秒',
    min(float(s.get('dur') or 0) for s in sb['shots']))
tot = sum(float(s.get('dur') or 0) for s in sb['shots'][1:1 + len(segs)])
chk(abs(tot - max(44.0, len(segs) * 2)) < 0.05, '拆出来的段时长总和守恒（= max(原 dur, 段数×2)）',
    round(tot, 2))
chk(all(s.get('text') == '立即体验' for s in segs), '拆出来的镜**完整继承** text/卡型（画面风格不变）')
chk(sb['shots'][0] == orig_shots[0], '没超限的镜【原样不动】')
chk(sb['shots'][-1] == orig_shots[2], '空字幕的镜【原样不动】')

print('\n③b 幂等（★关键：不能越拆越碎）')
ch2, n2, s2b = make.enforce_shot_limits(sb)
chk(ch2 is False and n2 == [], '拆过一次后再跑 → 0 改动（幂等）', n2[:1])
count_after = len(sb['shots'])

print('\n③c 容错（绝不能把出片搞挂）')
sb2 = {'shots': [
    {'type': 'title', 'text': 'x', 'dur': 3},
    None,
    'not-a-dict',
    {'type': 'title', 'dur': None, 'subtitle': None},
    {'type': 'title', 'text': 'y', 'dur': 6, 'subtitle': '嗯' * 61},
]}
try:
    c3, n3, s3b = make.enforce_shot_limits(sb2)
    chk(c3 is True and len(n3) == 1, '脏输入（None/字符串/无字幕）不崩，只处理那条 61 字镜', len(n3))
    chk(len(sb2['shots']) == 6, '脏输入下镜数正确（61 字 → 拆 2 镜）', len(sb2['shots']))
except Exception as e:
    chk(False, '脏输入不该抛异常', str(e)[:60])
c4, n4, s4 = make.enforce_shot_limits({'shots': []})
chk(c4 is False, '空分镜 → 0 改动')
c5, n5, s5 = make.enforce_shot_limits(None)
chk(c5 is False, 'sb=None → 0 改动（不抛异常）')

# ══════════════ ④ 源码级契约 ══════════════
print('\n④ 源码级契约（位置铁律 + 防回退）')
src = open(os.path.join(HERE, 'make.py'), encoding='utf-8').read()
i_gate = src.find('enforce_shot_limits(sb)')
i_tts = src.find("'逐句配音'")
chk(i_gate > 0 and i_tts > 0, '闸门与 tts 调用都能在源码里找到')
chk(i_gate < i_tts, '★闸门必须在调用 tts.py **之前**（否则音频已按老镜合并 → 音画错位）',
    'gate@%d tts@%d' % (i_gate, i_tts))
chk('storyboard.split.json' in src, '拆完写进 work 目录（不覆盖调用方传进来的文件）')
chk(src.count('def enforce_shot_limits') == 1, 'enforce_shot_limits 只定义一次')
chk('split_text_by_cap(sub, SUB_MAX)' in src and 'if len(sub) <= SUB_MAX' in src,
    '闸门用的是固定 60 字上限（幂等，不按镜长浮动）')

print('\n═══ ★VF_SHOTLIMIT_V1 自测：通过 %d / 失败 %d ═══' % (PASS[0], FAIL[0]))
if FAILED:
    print('失败项：')
    for x in FAILED:
        print('  ❌ ' + x)
sys.exit(1 if FAIL[0] else 0)
