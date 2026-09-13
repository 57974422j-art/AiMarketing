# -*- coding: utf-8 -*-
import sys, json
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright
SHOT = 'D:/AiMarketing/xhs-shot.png'
with sync_playwright() as pw:
    b = pw.chromium.connect_over_cdp('http://127.0.0.1:9222')
    p = [x for x in b.contexts[0].pages if 'xiaohongshu' in x.url][0]
    p.bring_to_front()
    p.evaluate("() => { const c = document.querySelector('.publish-page'); if (c) c.scrollTop = c.scrollHeight; }")
    p.wait_for_timeout(1200)
    p.screenshot(path=SHOT)
    print('截图已存: ' + SHOT)
    info = p.evaluate("""() => {
      const el = document.querySelector('xhs-publish-btn');
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
               display: cs.display, position: cs.position, parentCls: String(el.parentElement.className||'').slice(0,50) };
    }""")
    print('容器: ' + json.dumps(info, ensure_ascii=False))
    probe = p.evaluate("""() => {
      const el = document.querySelector('xhs-publish-btn');
      const r = el.getBoundingClientRect();
      const res = [];
      const NL = String.fromCharCode(10);
      for (const fx of [0.2, 0.4, 0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.95]) {
        const x = r.x + r.width * fx, y = r.y + r.height / 2;
        const t = document.elementFromPoint(x, y);
        res.push({ fx: fx, hit: t ? (t.tagName + '.' + String(t.className||'').slice(0,32)) : 'null', txt: t ? (t.innerText||'').trim().slice(0,12) : '' });
      }
      return res;
    }""")
    for o in probe:
        print('  ' + json.dumps(o, ensure_ascii=False))
