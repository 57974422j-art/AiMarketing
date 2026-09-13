# -*- coding: utf-8 -*-
import sys, json
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright
JS = """
() => {
  const vis = (e) => !!(e && e.offsetParent !== null);
  const R = (e) => { const b = e.getBoundingClientRect(); return Math.round(b.x)+','+Math.round(b.y)+' '+Math.round(b.width)+'x'+Math.round(b.height); };
  const all = Array.from(document.querySelectorAll('textarea, [contenteditable], input'));
  return {
    可见输入: all.filter(vis).map(e => ({ tag: e.tagName, type: e.type || '', ce: e.getAttribute('contenteditable'), ph: String(e.getAttribute('placeholder')||'').slice(0,24), cls: String(e.className||'').slice(0,32), at: R(e) })),
    video数: document.querySelectorAll('video').length,
    描述标签位置: Array.from(document.querySelectorAll('*')).filter(e => vis(e) && (e.innerText||'').trim() === '视频描述').map(e => R(e)),
    短标题标签位置: Array.from(document.querySelectorAll('*')).filter(e => vis(e) && (e.innerText||'').trim() === '短标题').map(e => R(e)),
  };
}
"""
with sync_playwright() as pw:
    b = pw.chromium.connect_over_cdp('http://127.0.0.1:9222')
    pg = [x for x in b.contexts[0].pages if 'channels.weixin' in x.url][0]
    fr = [f for f in pg.frames if 'micro/content' in f.url][0]
    print(json.dumps(fr.evaluate(JS), ensure_ascii=False, indent=1))
