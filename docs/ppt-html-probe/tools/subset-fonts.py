# -*- coding: utf-8 -*-
"""
master-v1 · 内嵌字体子集化（OFL：Noto Serif SC / Noto Sans SC）
- 从本母版全部源文件里收集用到的字符（HTML/CSS/JS 全文 → 过度包含但绝对安全）
- 加上安全集：ASCII 可见字符 + 常用中文标点/符号（防 AI 后续生成时缺字）
- 输出 assets/NotoSerifSC-sub.woff2 / NotoSansSC-sub.woff2，供 master.css 的 @font-face 引用
用法: python subset-fonts.py
说明: 生产环境可把 chars 收窄到"本片实际文本"以进一步缩小；本样板取稳妥策略。
"""
import os
import sys
import subprocess

BASE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(BASE, 'assets')

SOURCES = ['master-16x9.html', 'master-9x16.html',
           os.path.join('assets', 'master.css'), os.path.join('assets', 'master.js')]

FONTS = [
    (r'C:\Windows\Fonts\NotoSerifSC-VF.ttf', 'NotoSerifSC-sub'),
    (r'C:\Windows\Fonts\NotoSansSC-VF.ttf', 'NotoSansSC-sub'),
]

SAFE = (''.join(chr(c) for c in range(0x20, 0x7f))
        + '　、。，；：？！…—～·《》〈〉「」『』（）【】〔〕“”‘’％＋－×÷≈≤≥→←↑↓°￥$€¥')


def collect_chars():
    cs = set(SAFE)
    for rel in SOURCES:
        p = os.path.join(BASE, rel)
        if os.path.exists(p):
            with open(p, encoding='utf-8') as f:
                cs |= set(f.read())
    cs -= {'\n', '\r', '\t', '\x00'}
    return cs


def main():
    cs = collect_chars()
    txt = ''.join(sorted(cs))
    tf = os.path.join(BASE, 'chars.txt')
    with open(tf, 'w', encoding='utf-8') as f:
        f.write(txt)
    print('chars collected: %d' % len(cs))

    for src, out in FONTS:
        if not os.path.exists(src):
            print('MISSING source font: %s' % src)
            continue
        done = False
        for flavor in ('woff2', 'woff'):
            target = os.path.join(ASSETS, out + '.' + flavor)
            cmd = [sys.executable, '-m', 'fontTools.subset', src,
                   '--text-file=' + tf,
                   '--output-file=' + target,
                   '--flavor=' + flavor,
                   '--layout-features=*',
                   '--no-hinting']
            r = subprocess.run(cmd, capture_output=True, text=True)
            if r.returncode == 0 and os.path.exists(target):
                print('OK  %-28s %8.1f KB   (flavor=%s)' %
                      (os.path.basename(target), os.path.getsize(target) / 1024.0, flavor))
                done = True
                break
            print('FAIL flavor=%s : %s' % (flavor, (r.stderr or '').strip()[-240:]))
        if not done:
            print('!! could not subset %s' % src)


if __name__ == '__main__':
    main()
