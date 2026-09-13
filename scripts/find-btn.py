# -*- coding: utf-8 -*-
"""分析 xhs-shot.png 底部按钮区，找红色（发布按钮）像素簇位置"""
import sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
try:
    from PIL import Image
except ImportError:
    print('NO_PIL'); sys.exit(1)

im = Image.open('D:/AiMarketing/xhs-shot.png').convert('RGB')
W, H = im.size
print('截图尺寸: %dx%d' % (W, H))
px = im.load()

# 底部区域扫描（容器 y≈855 起，高 90；留余量扫 800 ~ H-1）
def scan(y0, y1, label):
    rows = {}
    for y in range(y0, min(y1, H)):
        xs = []
        for x in range(0, W, 3):
            r, g, b = px[x, y]
            # 小红书红 ≈ (255, 36, 66) 附近；放宽
            if r > 180 and g < 110 and b < 130:
                xs.append(x)
        if xs:
            rows[y] = (min(xs), max(xs), len(xs))
    if not rows:
        print('%s: 未发现红色像素' % label)
        return
    ys = sorted(rows)
    print('%s: 红色行 y=%d..%d' % (label, ys[0], ys[-1]))
    for y in ys[:3] + ys[-3:]:
        a, b_, n = rows[y]
        print('   y=%d  x=%d..%d  (点数 %d)' % (y, a, b_, n))

scan(790, H, '底部区(790~底)')

# 也扫整幅，看主红色块的分布（判断按钮在左还是右）
print('--- 全图红色分布（按 x 分 8 段计数）---')
seg = [0] * 8
for y in range(700, H, 2):
    for x in range(0, W, 2):
        r, g, b = px[x, y]
        if r > 180 and g < 110 and b < 130:
            seg[min(7, x * 8 // W)] += 1
for i, c in enumerate(seg):
    x0, x1 = i * W // 8, (i + 1) * W // 8
    print('   x %d-%d: %d' % (x0, x1, c))
