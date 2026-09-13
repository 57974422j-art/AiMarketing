# -*- coding: utf-8 -*-
import sys, json
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright
JS = """
() => {
  const vis = (e) => !!(e && e.offsetParent !== null);
  const NL = String.fromCharCode(10);
  const R = (e) => { const b = e.getBoundingClientRect(); return Math.round(b.x)+','+Math.round(b.y)+' '+Math.round(b.width)+'x'+Math.round(b.height); };
  const body = document.body.innerText || '';
  return {
    video数: document.querySelectorAll('video').length,
    可编辑: Array.from(document.querySelectorAll('textarea, [contenteditable], input[type="text"]')).map(e => ({ tag: e.tagName, ce: e.getAttribute('contenteditable'), ph: String(e.getAttribute('placeholder')||'').slice(0,26), cls: String(e.className||'').slice(0,30), at: R(e), vis: vis(e) })),
    发表: Array.from(document.querySelectorAll('*')).filter(e => vis(e) && (e.innerText||'').trim() === '发表').map(e => { const b = e.getBoundingClientRect(); return { tag: e.tagName, cls: String(e.className||'').slice(0,32), at: R(e) }; }).slice(0, 3),
    封面元素: Array.from(document.querySelectorAll('*')).filter(e => vis(e) && (e.innerText||'').indexOf('封面') >= 0 && (e.innerText||'').trim().length < 16).map(e => ({ txt: (e.innerText||'').trim(), at: R(e) })).slice(0, 6),
    文本: body.slice(0, 400).split(NL).join(' | '),
  };
}
"""
with sync_playwright() as pw:
    b = pw.chromium.connect_over_cdp('http://127.0.0.1:9222')
    pg = [x for x in b.contexts[0].pages if 'channels.weixin' in x.url][0]
    fr = [f for f in pg.frames if 'micro/content' in f.url][0]
    print(json.dumps(fr.evaluate(JS), ensure_ascii=False, indent=1))
