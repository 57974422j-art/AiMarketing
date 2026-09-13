# -*- coding: utf-8 -*-
import sys, json, time
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright
with sync_playwright() as pw:
    b = pw.chromium.connect_over_cdp('http://127.0.0.1:9222')
    p = [x for x in b.contexts[0].pages if 'xiaohongshu' in x.url][0]
    p.bring_to_front()
    p.evaluate("() => { const c = document.querySelector('.publish-page'); if (c) c.scrollTop = c.scrollHeight; }")
    p.wait_for_timeout(1200)
    box = p.evaluate("() => { const el = document.querySelector('xhs-publish-btn'); const r = el.getBoundingClientRect(); return {x: r.x, y: r.y, w: r.width, h: r.height}; }")
    print('容器: ' + json.dumps(box))
    # 右侧 75% 位置（推测主按钮=发布）
    tx = box['x'] + box['w'] * 0.78
    ty = box['y'] + box['h'] / 2
    print('点击坐标: %d,%d' % (tx, ty))
    p.mouse.move(tx, ty)
    p.wait_for_timeout(600)
    p.mouse.click(tx, ty)
    print('已点击')
    for i in range(6):
        p.wait_for_timeout(2500)
        u = p.url
        try:
            txt = p.inner_text('body')[:400].replace(chr(10), ' | ')
        except Exception:
            txt = ''
        hit = [k for k in ['发布成功', '发布失败', '确认发布', '审核', '不能为空', '请填写'] if k in txt]
        print('  [%ds] url=%s%s' % ((i+1)*2.5, u, (' hits=' + str(hit)) if hit else ''))
        if '发布成功' in txt or '/publish/publish' not in u:
            print('  → 页面已变化（可能发布成功）')
            break
