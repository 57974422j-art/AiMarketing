# -*- coding: utf-8 -*-
import sys, json
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright
JS = """
() => {
  const out = [];
  Array.from(document.querySelectorAll('button')).forEach(e => {
    const r = e.getBoundingClientRect();
    const cs = getComputedStyle(e);
    out.push({ txt: (e.innerText || '').trim().slice(0, 14), cls: String(e.className || '').slice(0, 46), xy: Math.round(r.x) + ',' + Math.round(r.y), wh: Math.round(r.width) + 'x' + Math.round(r.height), display: cs.display, vis: cs.visibility });
  });
  return out.filter(o => o.wh !== '0x0');
}
"""
with sync_playwright() as pw:
    b = pw.chromium.connect_over_cdp('http://127.0.0.1:9222')
    for p in b.contexts[0].pages:
        if 'xiaohongshu' not in p.url:
            continue
        # 找内部滚动容器并滚到底
        p.evaluate("""() => {
          const cands = Array.from(document.querySelectorAll('div')).filter(e => e.scrollHeight > e.clientHeight + 100);
          cands.forEach(e => { e.scrollTop = e.scrollHeight });
          window.scrollTo(0, document.body.scrollHeight);
        }""")
        p.wait_for_timeout(1500)
        r = p.evaluate(JS)
        print('button 总数=' + str(len(r)))
        for o in r:
            print('  ' + json.dumps(o, ensure_ascii=False))
