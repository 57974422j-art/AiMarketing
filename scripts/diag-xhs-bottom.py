# -*- coding: utf-8 -*-
import sys, json
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright
with sync_playwright() as pw:
    b = pw.chromium.connect_over_cdp('http://127.0.0.1:9222')
    for p in b.contexts[0].pages:
        if 'xiaohongshu' not in p.url:
            continue
        # 滚到底
        p.evaluate("() => { const c = document.querySelector('.publish-page'); if (c) c.scrollTop = c.scrollHeight; }")
        p.wait_for_timeout(1200)
        # 取容器最后 1200 字符 HTML（去空白）
        html = p.evaluate("""() => {
          const c = document.querySelector('.publish-page-content') || document.querySelector('.publish-page');
          if (!c) return 'NO_CONTAINER';
          const s = c.outerHTML.replace(/>\s+</g, '><');
          return s.slice(-1400);
        }""")
        print('=== 容器尾部 HTML ===')
        print(html)
