# -*- coding: utf-8 -*-
import sys, json
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright
JS = """
() => {
  const vis = (e) => !!(e && e.offsetParent !== null);
  const NL = String.fromCharCode(10);
  const body = (document.body.innerText || '');
  return {
    url: location.href,
    textareas: Array.from(document.querySelectorAll('textarea')).filter(vis).map(e => ({ ph: (e.getAttribute('placeholder')||'').slice(0,30), cls: String(e.className||'').slice(0,36) })),
    editables: Array.from(document.querySelectorAll('[contenteditable="true"]')).filter(vis).map(e => ({ cls: String(e.className||'').slice(0,36), ph: (e.getAttribute('placeholder')||'').slice(0,26) })),
    inputs: Array.from(document.querySelectorAll('input')).filter(vis).map(e => ({ type: e.type, ph: (e.getAttribute('placeholder')||'').slice(0,26), cls: String(e.className||'').slice(0,30) })).slice(0, 8),
    buttons: Array.from(document.querySelectorAll('button')).filter(vis).map(e => { const r = e.getBoundingClientRect(); return { txt: (e.innerText||'').trim().slice(0,10), xy: Math.round(r.x)+','+Math.round(r.y) }; }).slice(0, 10),
    文本: body.slice(0, 350).split(NL).join(' | '),
  };
}
"""
with sync_playwright() as pw:
    b = pw.chromium.connect_over_cdp('http://127.0.0.1:9222')
    wb = [p for p in b.contexts[0].pages if 'weibo' in p.url]
    print(json.dumps(wb[0].evaluate(JS), ensure_ascii=False, indent=1) if wb else '无微博页')
