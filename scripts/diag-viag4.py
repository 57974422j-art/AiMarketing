# -*- coding: utf-8 -*-
import sys, json
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright
with sync_playwright() as pw:
    b = pw.chromium.connect_over_cdp('http://127.0.0.1:9222')
    pg = [x for x in b.contexts[0].pages if 'channels.weixin' in x.url][0]
    fr = [f for f in pg.frames if 'micro/content' in f.url][0]
    r = fr.evaluate("""
    () => {
      const vis = (e) => !!(e && e.offsetParent !== null);
      const R = (e) => { const b = e.getBoundingClientRect(); const fe = window.frameElement; const fb = fe ? fe.getBoundingClientRect() : {x:0,y:0};
        return Math.round(fb.x + b.x + b.width/2) + ',' + Math.round(fb.y + b.y + b.height/2); };
      const NL = String.fromCharCode(10);
      // 弹窗区域（y 300~800）内的所有可点元素文本
      const dlg = Array.from(document.querySelectorAll('*')).filter(e => {
        if (!vis(e)) return false;
        const b = e.getBoundingClientRect();
        return b.y > 300 && b.y < 800 && b.x > 700;
      }).map(e => ({ txt: (e.innerText||'').trim().slice(0,18), tag: e.tagName, cls: String(e.className||'').slice(0,30), xy: R(e) }))
        .filter(o => o.txt);
      const seen = new Set();
      return { 弹窗内元素: dlg.filter(o => { const k = o.txt + o.xy; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 16), 弹窗文本: (document.body.innerText||'').slice(0,300).split(NL).join(' | ') };
    }
    """)
    print(json.dumps(r, ensure_ascii=False, indent=1))
