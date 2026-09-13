# -*- coding: utf-8 -*-
import sys, json
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright
with sync_playwright() as pw:
    b = pw.chromium.connect_over_cdp('http://127.0.0.1:9222')
    pg = [x for x in b.contexts[0].pages if 'channels.weixin' in x.url][0]
    pg.bring_to_front()
    fr = [f for f in pg.frames if 'micro/content' in f.url][0]
    # 找顶部(y<400)的「编辑」元素 + 封面相关
    r = fr.evaluate("""
    () => {
      const vis = (e) => !!(e && e.offsetParent !== null);
      const R = (e) => { const b = e.getBoundingClientRect(); return Math.round(b.x)+','+Math.round(b.y)+' '+Math.round(b.width)+'x'+Math.round(b.height); };
      const out = [];
      Array.from(document.querySelectorAll('*')).forEach(e => {
        if (!vis(e)) return;
        const t = (e.innerText||'').trim();
        if (t !== '编辑' && t !== '更换封面' && t !== '封面预览') return;
        const bb = e.getBoundingClientRect();
        out.push({ txt: t, tag: e.tagName, cls: String(e.className||'').slice(0,36), at: R(e), y: Math.round(bb.y) });
      });
      return { 元素: out.filter(o => o.y < 500), 全部编辑: out.length };
    }
    """)
    print(json.dumps(r, ensure_ascii=False, indent=1))
