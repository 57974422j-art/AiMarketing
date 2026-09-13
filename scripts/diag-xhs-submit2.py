# -*- coding: utf-8 -*-
import sys, json
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright
JS = """
() => {
  const vis = (e) => !!(e && e.offsetParent !== null);
  const out = [];
  Array.from(document.querySelectorAll('*')).forEach(e => {
    if (!vis(e)) return;
    const t = (e.innerText || '').trim();
    const cls = String(e.className || '');
    const isPubCls = /submit|publish-btn|publishBtn|btn-submit/i.test(cls);
    const isPubTxt = t === '发布' || t === '发布笔记' || t === '立即发布' || t === '提交';
    if (!isPubCls && !isPubTxt) return;
    const r = e.getBoundingClientRect();
    if (r.width < 10) return;
    out.push({ txt: t.slice(0, 12), tag: e.tagName, cls: cls.slice(0, 50), xy: Math.round(r.x) + ',' + Math.round(r.y), wh: Math.round(r.width) + 'x' + Math.round(r.height), 视口内: r.y >= 0 && r.y <= window.innerHeight });
  });
  const seen = new Set();
  return { 视口: window.innerWidth + 'x' + window.innerHeight, 滚动Y: Math.round(window.scrollY), 元素: out.filter(o => { const k = o.txt + o.xy; if (seen.has(k)) return false; seen.add(k); return true; }) };
}
"""
with sync_playwright() as pw:
    b = pw.chromium.connect_over_cdp('http://127.0.0.1:9222')
    for p in b.contexts[0].pages:
        if 'xiaohongshu' not in p.url:
            continue
        # 滚到底
        p.evaluate("() => window.scrollTo(0, document.body.scrollHeight)")
        p.wait_for_timeout(1500)
        print(json.dumps(p.evaluate(JS), ensure_ascii=False, indent=1))
