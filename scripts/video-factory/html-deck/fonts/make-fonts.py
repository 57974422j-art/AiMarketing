# -*- coding: utf-8 -*-
"""
fonts/make-fonts.py —— 内嵌字体（**两套母版共用的唯一一份**）生成器

背景（坑 28 / 第六条纪律）：内嵌字体是**子集**，若某字的字形不在子集里，浏览器会**静默回退系统字体** ——
开发机（装了 CJK 字体）永远看不出来，服务器上直接渲成豆腐块。
旧做法只从"母版源码"收字（中文仅来自注释）⇒ 只覆盖 437 个码点，而 deck 实际文本有 250+ 常用字不在其中。

本脚本的字符集（**方案 A：静态大子集**）：
  1. **GB2312 一级字表 3755 字**（区 0xB0–0xD7 × 位 0xA1–0xFE，可由代码**确定性枚举**；
     与《通用规范汉字表》一级字表 ≈3500 字的量级一致。若将来要换成官方字表，直接替换 chars-cmn.txt 即可）
  2. ASCII 可见字符（0x20–0x7E）
  3. 中英标点与常用符号（与旧 subset-fonts.py 的安全集一致，并补 ～ ° ⇒ ← → ↑ ↓ 等）

产物：fonts/NotoSerifSC-sub.woff2 · fonts/NotoSansSC-sub.woff2 · fonts/chars-cmn.txt（**字表入库**）
用法：python make-fonts.py
"""
import os
import sys
import subprocess

BASE = os.path.dirname(os.path.abspath(__file__))

SOURCES = [
    (r'C:\Windows\Fonts\NotoSerifSC-VF.ttf', 'NotoSerifSC-sub'),
    (r'C:\Windows\Fonts\NotoSansSC-VF.ttf', 'NotoSansSC-sub'),
]

PUNCT = ('　、。，；：？！…—～·《》〈〉「」『』（）【】〔〕“”‘’％＋－×÷≈≤≥→←↑↓°￥$€¥'
         '·•‰′″№＆＊＋－＝／＼｜＠＃＆％±§¶†‡※○●△▲□■☆★')


def gb2312_level1():
    """GB2312 一级汉字（3755 字）：高字节 0xB0–0xD7，低字节 0xA1–0xFE"""
    out = []
    for hi in range(0xB0, 0xD8):
        for lo in range(0xA1, 0xFF):
            try:
                out.append(bytes([hi, lo]).decode('gb2312'))
            except UnicodeDecodeError:
                pass
    return out


def collect():
    cs = set()
    cs.update(chr(c) for c in range(0x20, 0x7F))          # ASCII 可见
    cs.update(PUNCT)
    lv1 = gb2312_level1()
    cs.update(lv1)
    # ★ 再并上"我们自己全部资产的文本"（母版源码 + 全部 examples/*.json）：
    #   常用表之外的字（如"渲 / 浏 / ⇒"这类只在注释里出现的二级字）也一并纳入，
    #   这样"我们已有的东西"覆盖是**构造性 100%**，闸门就专治**新 deck 的文本**（那才是真正的风险源）。
    for p in asset_texts():
        if os.path.exists(p):
            with open(p, encoding='utf-8') as f:
                cs.update(f.read())
    cs -= {'\n', '\r', '\t', '\x00'}
    return cs, len(lv1)


def asset_texts():
    root = os.path.dirname(BASE)                       # dist-rel/probe-hf
    out = []
    for mid in ('master-v1', 'master-v2'):
        mdir = os.path.join(root, 'masters', mid)
        out += [os.path.join(mdir, 'master-16x9.html'), os.path.join(mdir, 'master-9x16.html'),
                os.path.join(mdir, 'assets', 'master.css'), os.path.join(mdir, 'assets', 'master.js')]
    ex = os.path.join(root, 'deck-contract', 'examples')
    if os.path.isdir(ex):
        out += [os.path.join(ex, f) for f in sorted(os.listdir(ex)) if f.endswith('.json')]
    return out


def main():
    cs, n_lv1 = collect()
    txt = ''.join(sorted(cs))
    tf = os.path.join(BASE, 'chars-cmn.txt')
    with open(tf, 'w', encoding='utf-8') as f:
        f.write(txt)
    print('GB2312 一级字表: %d 字' % n_lv1)
    print('字符集合计    : %d 个码点 → %s' % (len(cs), os.path.basename(tf)))

    for src, out in SOURCES:
        if not os.path.exists(src):
            print('!! 缺源字体: %s' % src)
            continue
        target = os.path.join(BASE, out + '.woff2')
        cmd = [sys.executable, '-m', 'fontTools.subset', src,
               '--text-file=' + tf,
               '--output-file=' + target,
               '--flavor=woff2',
               '--layout-features=*',
               '--no-hinting']
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode == 0 and os.path.exists(target):
            print('OK  %-26s %8.1f KB' % (out + '.woff2', os.path.getsize(target) / 1024.0))
        else:
            print('FAIL %s : %s' % (out, (r.stderr or '').strip()[-300:]))
            sys.exit(1)


if __name__ == '__main__':
    main()
