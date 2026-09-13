# -*- coding: utf-8 -*-
import sys, json
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright
JS = """
() => {
  const vis = (e) => !!(e && e.offsetParent !== null);
  const NL = String.fromCharCode(10);
  const ifr = Array.from(document.querySelectorAll('iframe')).map(e => ({ id: e.id||'', src: String(e.src||'').slice(0,70), vis: vis(e) }));
  const files = Array.from(document.querySelectorAll('input[type="file"]')).map(e => ({ accept: String(e.getAttribute('accept')||'').slice(0,50), cls: String(e.className||'').slice(0,40), vis: vis(e) }));
  const body = (document.body.innerText || '');
  const keys = ['上传视频','上传图片','视频','添加','封面','标题','进度','上传中','完成'];
  const hits = keys.filter(k => body.indexOf(k) >= 0);
  // 视频相关区域文本
  const vids = Array.from(document.querySelectorAll('video')).length;
  return { iframes: ifr, fileInputs: files, 关键词命中: hits, video元素数: vids,
           页面文本头部: body.slice(0, 300).split(NL).join(' | ') };
}
"""
with sync_playwright() as pw:
    b = pw.chromium.connect_over_cdp('http://127.0.0.1:9222')
    wb = [p for p in b.contexts[0].pages if 'weibo' in p.url]
    if not wb:
        print('无微博页'); sys.exit()
    p = wb[0]
    print('URL=' + p.url[:110])
    print(json.dumps(p.evaluate(JS), ensure_ascii=False, indent=1))
