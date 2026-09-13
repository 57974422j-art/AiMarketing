# -*- coding: utf-8 -*-
import sys, json
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright
with sync_playwright() as pw:
    b = pw.chromium.connect_over_cdp('http://127.0.0.1:9222')
    p = [x for x in b.contexts[0].pages if 'xiaohongshu' in x.url][0]
    p.bring_to_front()
    p.evaluate("() => { const c = document.querySelector('.publish-page'); if (c) c.scrollTop = c.scrollHeight; }")
    p.wait_for_timeout(1000)
    # 先 hover 确认命中元素
    p.mouse.move(934, 900)
    p.wait_for_timeout(700)
    hit = p.evaluate("() => { const t = document.elementFromPoint(934, 900); return t ? (t.tagName + '.' + String(t.className||'').slice(0,30)) : 'null'; }")
    print('hover 命中: ' + hit)
    p.mouse.click(934, 900)
    print('已点 (934,900)')
    for i in range(8):
        p.wait_for_timeout(2500)
        u = p.url
        try:
            txt = p.inner_text('body')[:500]
        except Exception:
            txt = ''
        hits = [k for k in ['发布成功', '发布失败', '确认发布', '不能为空', '请填写', '审核'] if k in txt]
        print('  [%ds] url=%s%s' % ((i + 1) * 2.5, u, ('  hits=' + str(hits)) if hits else ''))
        if '发布成功' in txt or '/publish/publish' not in u:
            print('  → ✅ 页面变化（发布已触发）')
            break
