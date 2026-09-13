# -*- coding: utf-8 -*-
import sys, json
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright
JS = """
() => {
  const el = document.querySelector('xhs-publish-btn');
  if (!el) return { err: 'no xhs-publish-btn' };
  const r = el.getBoundingClientRect();
  const inner = Array.from(el.querySelectorAll('*')).map(e => {
    const rr = e.getBoundingClientRect();
    return { tag: e.tagName, cls: String(e.className||'').slice(0,40), txt: (e.innerText||'').trim().slice(0,14), xy: Math.round(rr.x)+','+Math.round(rr.y), wh: Math.round(rr.width)+'x'+Math.round(rr.height) };
  }).filter(o => o.wh !== '0x0').slice(0, 8);
  return {
    容器: { xy: Math.round(r.x)+','+Math.round(r.y), wh: Math.round(r.width)+'x'+Math.round(r.height), 视口内: r.y >= 0 && r.y <= window.innerHeight, innerText: (el.innerText||'').trim().slice(0,30) },
    内部元素: inner,
  };
}
"""
with sync_playwright() as pw:
    b = pw.chromium.connect_over_cdp('http://127.0.0.1:9222')
    for p in b.contexts[0].pages:
        if 'xiaohongshu' not in p.url:
            continue
        p.evaluate("() => { const c = document.querySelector('.publish-page'); if (c) c.scrollTop = c.scrollHeight; }")
        p.wait_for_timeout(1000)
        print(json.dumps(p.evaluate(JS), ensure_ascii=False, indent=1))
