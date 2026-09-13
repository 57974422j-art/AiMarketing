# -*- coding: utf-8 -*-
import sys, json
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright
JS = """
() => {
  const vis = (e) => !!(e && e.offsetParent !== null);
  const out = { url: location.href, title: document.title, iframes: [], inputs: [], editables: [], pubBtns: [] };
  out.iframes = Array.from(document.querySelectorAll('iframe')).map(e => ({ id: e.id || '', cls: String(e.className||'').slice(0,30), src: String(e.src||'').slice(0, 80), vis: vis(e) }));
  out.inputs = Array.from(document.querySelectorAll('input[type="file"]')).map(e => ({ accept: e.getAttribute('accept'), name: e.getAttribute('name'), cls: String(e.className||'').slice(0,40), vis: vis(e) }));
  out.editables = Array.from(document.querySelectorAll('[contenteditable="true"], textarea')).filter(vis).map(e => ({ tag: e.tagName, cls: String(e.className||'').slice(0,40), ph: (e.getAttribute('placeholder')||'').slice(0,30), wh: Math.round(e.getBoundingClientRect().width)+'x'+Math.round(e.getBoundingClientRect().height) })).slice(0, 6);
  out.pubBtns = Array.from(document.querySelectorAll('button, div, span, a')).filter(e => vis(e) && /^(发布|发送|发表)$/.test((e.innerText||'').trim())).map(e => { const r = e.getBoundingClientRect(); return { tag: e.tagName, cls: String(e.className||'').slice(0,36), txt: (e.innerText||'').trim(), xy: Math.round(r.x)+','+Math.round(r.y) }; }).slice(0, 6);
  return out;
}
"""
with sync_playwright() as pw:
    b = pw.chromium.connect_over_cdp('http://127.0.0.1:9222')
    ctx = b.contexts[0]
    print('页面数=' + str(len(ctx.pages)))
    for i, p in enumerate(ctx.pages):
        print('  [%d] %s' % (i, p.url[:100]))
    wb = [p for p in ctx.pages if 'weibo' in p.url]
    if not wb:
        print('!! 没有微博页面 —— 请确认已打开微博发布页')
    else:
        p = wb[0]
        print('=== 微博页面诊断 ===')
        print(json.dumps(p.evaluate(JS), ensure_ascii=False, indent=1))
