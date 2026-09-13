# -*- coding: utf-8 -*-
import sys, json
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright
JS = """
() => {
  const vis = (e) => !!(e && e.offsetParent !== null);
  const NL = String.fromCharCode(10);
  const txt = (document.body.innerText || '');
  const keys = ['发布成功','发布失败','请填写','不能为空','确认发布','审核','失败','请输入','上传中','正在发布','保存中'];
  const hits = keys.filter(k => txt.indexOf(k) >= 0);
  const btns = Array.from(document.querySelectorAll('button, .btn-text, [class*="publish"], [class*="submit"]'))
    .filter(vis).map(e => (e.innerText || '').trim()).filter(t => t && t.length < 14).slice(0, 10);
  const dlg = Array.from(document.querySelectorAll('[class*="dialog"], [class*="modal"], [role="dialog"]'))
    .filter(vis).map(e => (e.innerText || '').trim().slice(0, 100)).filter(Boolean).slice(0, 3);
  return { hits, btns, dlg, head: txt.slice(0, 260).split(NL).join(' | ') };
}
"""
with sync_playwright() as pw:
    b = pw.chromium.connect_over_cdp('http://127.0.0.1:9222')
    for p in b.contexts[0].pages:
        if 'xiaohongshu' not in p.url:
            continue
        print('URL=' + p.url)
        try:
            print(json.dumps(p.evaluate(JS), ensure_ascii=False, indent=1))
        except Exception as e:
            print('evaluate 失败: ' + str(e)[:150])
