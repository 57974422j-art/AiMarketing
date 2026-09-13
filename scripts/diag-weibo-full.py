# -*- coding: utf-8 -*-
import sys, json
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright
JS = """
() => {
  const vis = (e) => !!(e && e.offsetParent !== null);
  const NL = String.fromCharCode(10);
  const r = (e) => { const b = e.getBoundingClientRect(); return { xy: Math.round(b.x)+','+Math.round(b.y), wh: Math.round(b.width)+'x'+Math.round(b.height) }; };
  return {
    url: location.href,
    输入框类: Array.from(document.querySelectorAll('input:not([type=file]), textarea, [contenteditable="true"]')).filter(vis).map(e => Object.assign({ tag: e.tagName, type: e.type||'', ph: String(e.getAttribute('placeholder')||e.getAttribute('data-placeholder')||'').slice(0,30), cls: String(e.className||'').slice(0,34) }, r(e))).slice(0, 12),
    区域标题: Array.from(document.querySelectorAll('*')).filter(e => vis(e) && /^(标题|封面|视频|图片|正文|简介|描述|封面图|设置封面)$/.test((e.innerText||'').trim())).map(e => Object.assign({ txt: (e.innerText||'').trim(), tag: e.tagName, cls: String(e.className||'').slice(0,30) }, r(e))).slice(0, 12),
    文件框: Array.from(document.querySelectorAll('input[type="file"]')).map(e => ({ accept: String(e.getAttribute('accept')||'').slice(0,40), cls: String(e.className||'').slice(0,30) })),
    按钮: Array.from(document.querySelectorAll('button')).filter(vis).map(e => Object.assign({ txt: (e.innerText||'').trim().slice(0,10) }, r(e))).slice(0, 10),
    视频数: document.querySelectorAll('video').length,
    文本: (document.body.innerText||'').slice(0, 300).split(NL).join(' | '),
  };
}
"""
with sync_playwright() as pw:
    b = pw.chromium.connect_over_cdp('http://127.0.0.1:9222')
    wb = [p for p in b.contexts[0].pages if 'weibo' in p.url]
    print(json.dumps(wb[0].evaluate(JS), ensure_ascii=False, indent=1) if wb else '无微博页')
