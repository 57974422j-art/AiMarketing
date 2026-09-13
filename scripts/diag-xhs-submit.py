# -*- coding: utf-8 -*-
import sys, json
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright
JS = """
() => {
  const vis = (e) => !!(e && e.offsetParent !== null);
  const out = [];
  Array.from(document.querySelectorAll('button, div, span, a')).forEach(e => {
    if (!vis(e)) return;
    const t = (e.innerText || '').trim();
    if (!t || t.length > 8) return;
    if (!/发布|提交|发布笔记/.test(t)) return;
    const r = e.getBoundingClientRect();
    if (r.width < 20 || r.height < 14) return;
    out.push({ txt: t, tag: e.tagName, cls: String(e.className || '').slice(0, 44), xy: Math.round(r.x) + ',' + Math.round(r.y), wh: Math.round(r.width) + 'x' + Math.round(r.height) });
  });
  // 去重（同坐标同文本）
  const seen = new Set();
  return out.filter(o => { const k = o.txt + o.xy; if (seen.has(k)) return false; seen.add(k); return true; });
}
"""
with sync_playwright() as pw:
    b = pw.chromium.connect_over_cdp('http://127.0.0.1:9222')
    for p in b.contexts[0].pages:
        if 'xiaohongshu' not in p.url:
            continue
        print('页面尺寸: ' + json.dumps(p.evaluate("() => ({w: window.innerWidth, h: window.innerHeight})")))
        print(json.dumps(p.evaluate(JS), ensure_ascii=False, indent=1))
