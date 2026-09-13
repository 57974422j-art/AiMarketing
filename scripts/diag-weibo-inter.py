# -*- coding: utf-8 -*-
import sys, json
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright
with sync_playwright() as pw:
    b = pw.chromium.connect_over_cdp('http://127.0.0.1:9222')
    p = [x for x in b.contexts[0].pages if 'weibo' in x.url][0]
    p.bring_to_front()
    # ① 点「原创」
    try:
        p.get_by_text('原创', exact=True).first.click(timeout=4000)
        print('已点「原创」')
    except Exception as e:
        print('点原创失败: ' + str(e)[:60])
    p.wait_for_timeout(1500)
    # ② 点分类区域（请选择合适的频道）
    try:
        p.get_by_text('请选择合适的频道', exact=True).first.click(timeout=4000)
        print('已点「请选择合适的频道」')
    except Exception as e:
        print('点分类失败: ' + str(e)[:60])
    p.wait_for_timeout(2000)
    r = p.evaluate("""() => {
      const vis = (e) => !!(e && e.offsetParent !== null);
      const NL = String.fromCharCode(10);
      const pub = Array.from(document.querySelectorAll('button')).filter(e => /发布/.test((e.innerText||'').trim())).map(e => ({ dis: e.disabled }));
      const opts = Array.from(document.querySelectorAll('[class*="option"], [class*="item"], li, [role="option"]')).filter(vis).map(e => (e.innerText||'').trim()).filter(t => t && t.length < 12).slice(0, 18);
      return { 发布按钮: pub, 当前文本: (document.body.innerText||'').slice(0, 260).split(NL).join(' | '), 候选项: opts };
    }""")
    print(json.dumps(r, ensure_ascii=False, indent=1))
