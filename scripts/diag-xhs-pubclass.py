# -*- coding: utf-8 -*-
import sys, json
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright
JS = """
() => {
  const vis = (e) => !!(e && e.offsetParent !== null);
  const out = [];
  Array.from(document.querySelectorAll('[class*="publish" i], [class*="submit" i]')).forEach(e => {
    const r = e.getBoundingClientRect();
    if (r.width < 10) return;
    out.push({ tag: e.tagName, cls: String(e.className || '').slice(0, 60), txt: (e.innerText || '').trim().slice(0, 16), xy: Math.round(r.x) + ',' + Math.round(r.y), wh: Math.round(r.width) + 'x' + Math.round(r.height), vis: vis(e) });
  });
  // 页面总高 + 滚动容器
  const scrollers = Array.from(document.querySelectorAll('div')).filter(e => e.scrollHeight > e.clientHeight + 200)
    .map(e => ({ cls: String(e.className||'').slice(0,40), sh: e.scrollHeight, ch: e.clientHeight })).slice(0, 5);
  return { 元素: out.slice(0, 14), 滚动容器: scrollers, body高: document.body.scrollHeight, 视口高: window.innerHeight };
}
"""
with sync_playwright() as pw:
    b = pw.chromium.connect_over_cdp('http://127.0.0.1:9222')
    for p in b.contexts[0].pages:
        if 'xiaohongshu' not in p.url:
            continue
        print(json.dumps(p.evaluate(JS), ensure_ascii=False, indent=1))
