# -*- coding: utf-8 -*-
import sys, json
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright
with sync_playwright() as pw:
    b = pw.chromium.connect_over_cdp('http://127.0.0.1:9222')
    p = [x for x in b.contexts[0].pages if 'weibo' in x.url][0]
    p.bring_to_front()
    # 点「视频」按钮（真实点击）
    r = p.evaluate("""() => {
      const vis = (e) => !!(e && e.offsetParent !== null);
      const cands = Array.from(document.querySelectorAll('*')).filter(e => vis(e) && (e.innerText||'').trim() === '视频');
      return cands.map(e => { const b2 = e.getBoundingClientRect(); return { tag: e.tagName, cls: String(e.className||'').slice(0,40), xy: Math.round(b2.x)+','+Math.round(b2.y), wh: Math.round(b2.width)+'x'+Math.round(b2.height) }; });
    }""")
    print('「视频」候选元素: ' + json.dumps(r, ensure_ascii=False))
    try:
        p.get_by_text('视频', exact=True).first.click(timeout=5000)
        print('已点「视频」(first)')
    except Exception as e:
        print('点击失败: ' + str(e)[:80])
    p.wait_for_timeout(3500)
    # 点后诊断
    r2 = p.evaluate("""() => {
      const vis = (e) => !!(e && e.offsetParent !== null);
      return {
        url: location.href,
        fileInputs: Array.from(document.querySelectorAll('input[type="file"]')).map(e => ({ accept: String(e.getAttribute('accept')||'').slice(0,55), cls: String(e.className||'').slice(0,36), vis: vis(e) })),
        newBtns: Array.from(document.querySelectorAll('button, div, span')).filter(e => vis(e) && (e.innerText||'').trim().length < 10).map(e => (e.innerText||'').trim()).filter((t,i,a) => t && a.indexOf(t) === i).slice(0, 22),
      };
    }""")
    print('--- 点击后 ---')
    print(json.dumps(r2, ensure_ascii=False, indent=1))
