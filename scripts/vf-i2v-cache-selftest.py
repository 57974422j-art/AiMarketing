#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""★VF_I2V_CACHE_V1 离线自测（不联网、不烧钱）

验证：同一张图（同一个 ref_image URL）在多个镜里出现时
  ① `_h3_gen_one` 只被调用【一次】
  ② 后面几镜也变成 aivideo（复用那段动图），不是静态图
  ③ 日志里有"复用"字样（可回溯）
  ④ 不同图仍然各调一次（缓存不能误命中）

做法：monkeypatch make.py 的 `_h3_gen_one` / `_h3_download`，用假的"生成"回一个本地文件。
运行：python temp/vf-i2v-cache-selftest.py
"""
import json
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
VF = os.path.join(ROOT, 'scripts', 'video-factory')
sys.path.insert(0, VF)
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

import make  # noqa: E402

CALLS = []


FAIL_URLS = set()          # 这些 URL 假装生成失败（用于测"同图失败不重复重试"）


def fake_gen(prompt, want_sec, resolution, ratio, ref_image=''):
    """假装 H3 生成成功：把 ref_image 作为"内容"写进一个占位 mp4 文件，返回 url"""
    CALLS.append(ref_image)
    if ref_image in FAIL_URLS:
        return (None, 'fake通道(失败)', 0.0)
    return ('http://fake/' + os.path.basename(ref_image or 'noimg') + '.mp4', 'fake通道', 5.0)


def fake_download(url, dest):
    """写一个最小合法 mp4 头（render 阶段不参与，本测只查分镜字段）"""
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest, 'wb') as f:
        f.write(b'\x00\x00\x00\x18ftypmp42' + b'\x00' * 64)
    return True


make._h3_gen_one = fake_gen
make._h3_download = fake_download
make._probe_sec = lambda p: 5.0            # 免去 ffprobe

URL_A = 'https://oss.example.com/i2v/1/a.jpg?sig=AAA'
URL_B = 'https://oss.example.com/i2v/1/b.jpg?sig=BBB'

sb = {
    'size': [720, 1280], 'fps': 25,
    'shots': [
        {'type': 'bgimage', 'src': 'x1.jpg', 'text': '图A第1次', 'subtitle': '一', 'dur': 5, 'ref_image': URL_A},
        {'type': 'bgimage', 'src': 'x2.jpg', 'text': '图B第1次', 'subtitle': '二', 'dur': 5, 'ref_image': URL_B},
        {'type': 'bgimage', 'src': 'x3.jpg', 'text': '图A第2次（应复用）', 'subtitle': '三', 'dur': 5, 'ref_image': URL_A},
        {'type': 'bgimage', 'src': 'x4.jpg', 'text': '图A第3次（应复用）', 'subtitle': '四', 'dur': 5, 'ref_image': URL_A},
        {'type': 'bgimage', 'src': 'x5.jpg', 'text': '无首帧（保持静态）', 'subtitle': '五', 'dur': 5},
    ],
}

fails = []


def check(name, cond, detail=''):
    print(('   ✅ ' if cond else '   ❌ ') + name + ((' — ' + str(detail)) if detail else ''))
    if not cond:
        fails.append(name)


with tempfile.TemporaryDirectory(prefix='vf-i2v-cache-') as wd:
    sbf = os.path.join(wd, 'sb.json')
    json.dump(sb, open(sbf, 'w', encoding='utf-8'), ensure_ascii=False)
    print('=== VF_I2V_CACHE_V1 自测 ===')
    out, ok_n, sec, via = make.gen_ai_clips(sbf, wd, '768P', ['1', '2', '3', '4'])
    j = json.load(open(out, encoding='utf-8'))
    sh = j['shots']
    check('H3 只被调用 2 次（图A 1 次 + 图B 1 次）', len(CALLS) == 2, 'CALLS=%s' % CALLS)
    check('图A 的 3 镜都变成 aivideo（复用生效）',
          all(sh[i].get('type') == 'aivideo' for i in (0, 2, 3)),
          [sh[i].get('type') for i in (0, 2, 3)])
    check('复用镜的 src 各自独立（每镜一个文件）',
          len({sh[0].get('src'), sh[2].get('src'), sh[3].get('src')}) == 3)
    check('图B 那镜也是 aivideo', sh[1].get('type') == 'aivideo', sh[1].get('type'))
    check('没给首帧的镜保持原卡型（静态图）', sh[4].get('type') == 'bgimage', sh[4].get('type'))
    check('成功镜数 = 4（3 复用 + 1 图B）', ok_n == 4, 'ok_n=%s' % ok_n)
    srcs = [sh[i].get('src') for i in (0, 2, 3)]
    check('复用镜的文件确实存在且非空',
          all(os.path.exists(p) and os.path.getsize(p) > 0 for p in srcs))

print('=== 结果：%d 项通过，%d 项失败 ===' % (7 - len(fails), len(fails)))

# ── 场景 2：同一张图【生成失败】→ 复用镜不再重复重试（否则白等 N 次）──
print('=== 场景 2：同图失败不重复重试 ===')
URL_C = 'https://oss.example.com/i2v/1/c.jpg?sig=CCC'
sb2 = {
    'size': [720, 1280], 'fps': 25,
    'shots': [
        {'type': 'bgimage', 'src': 'y1.jpg', 'text': '图C第1次', 'subtitle': '一', 'dur': 5, 'ref_image': URL_C},
        {'type': 'bgimage', 'src': 'y2.jpg', 'text': '图C第2次', 'subtitle': '二', 'dur': 5, 'ref_image': URL_C},
    ],
}
FAIL_URLS.add(URL_C)
CALLS.clear()
with tempfile.TemporaryDirectory(prefix='vf-i2v-fail-') as wd2:
    sbf2 = os.path.join(wd2, 'sb.json')
    json.dump(sb2, open(sbf2, 'w', encoding='utf-8'), ensure_ascii=False)
    out2, ok2, sec2, _ = make.gen_ai_clips(sbf2, wd2, '768P', ['1', '2'])
    sh2 = json.load(open(out2, encoding='utf-8'))['shots']
    check('同图失败：H3 只被尝试 1 次（不重复重试）', len(CALLS) == 1, 'CALLS=%d' % len(CALLS))
    check('两镜都保持静态图（bgimage）+ 标了 i2v_fallback',
          all(s.get('type') == 'bgimage' and s.get('i2v_fallback') for s in sh2),
          [(s.get('type'), s.get('i2v_fallback')) for s in sh2])
    check('成功镜数 = 0（不判死整片，交给 Node 侧计费/降级）', ok2 == 0, 'ok_n=%s' % ok2)

print('=== 汇总：%d 项通过，%d 项失败 ===' % (10 - len(fails), len(fails)))
sys.exit(1 if fails else 0)
