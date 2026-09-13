# -*- coding: utf-8 -*-
import sys, json
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright
JS = """
() => {
  const vis = (e) => !!(e && e.offsetParent !== null);
  const out = [];
  const all = Array.from(document.querySelectorAll('*')).filter(e => vis(e) && (e.innerText || '').trim() === '发布笔记');
  all.forEach((e, i) => {
    const r = e.getBoundingClientRect();
    // 往上找可点祖先
    let anc = e, chain = [];
    for (let k = 0; k < 4 && anc; k++) { chain.push(anc.tagName + '.' + String(anc.className || '').slice(0, 40)); anc = anc.parentElement; }
    out.push({
      idx: i, tag: e.tagName, cls: String(e.className || '').slice(0, 50),
      xy: Math.round(r.x) + ',' + Math.round(r.y) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height),
      链: chain,
      兄弟数: e.parentElement ? e.parentElement.children.length : 0,
      pointerEvents: getComputedStyle(e).pointerEvents,
    });
  });
  return out;
}
"""
with sync_playwright() as pw:
    b = pw.chromium.connect_over_cdp('http://127.0.0.1:9222')
    for p in b.contexts[0].pages:
        if 'xiaohongshu' not in p.url:
            continue
        print('URL=' + p.url)
        print(json.dumps(p.evaluate(JS), ensure_ascii=False, indent=1))
