# -*- coding: utf-8 -*-
import sys, json
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright
JS = """
() => {
  const vis = (e) => !!(e && e.offsetParent !== null);
  const R = (e) => { const b = e.getBoundingClientRect(); return Math.round(b.x)+','+Math.round(b.y)+' '+Math.round(b.width)+'x'+Math.round(b.height); };
  const out = {};
  // 标题输入框（页面顶部区域 y<200 的 input/textarea）
  out.标题候选 = Array.from(document.querySelectorAll('input:not([type=file]), textarea')).filter(vis).filter(e => e.getBoundingClientRect().y < 300).map(e => ({ tag: e.tagName, ph: String(e.getAttribute('placeholder')||'').slice(0,24), mx: e.getAttribute('maxlength'), cls: String(e.className||'').slice(0,30), at: R(e) }));
  // 类型（原创/二创/转载）
  out.类型 = Array.from(document.querySelectorAll('*')).filter(e => vis(e) && /^(原创|二创|转载)$/.test((e.innerText||'').trim())).map(e => ({ txt: (e.innerText||'').trim(), tag: e.tagName, cls: String(e.className||'').slice(0,30), at: R(e) }));
  // 封面相关
  out.封面 = Array.from(document.querySelectorAll('*')).filter(e => vis(e) && /^(上传封面|裁剪封面|可选择以下封面|设置封面|封面)$/.test((e.innerText||'').trim())).map(e => ({ txt: (e.innerText||'').trim(), tag: e.tagName, cls: String(e.className||'').slice(0,30), at: R(e) }));
  // 发布按钮
  out.发布 = Array.from(document.querySelectorAll('button')).filter(e => vis(e) && /发布/.test((e.innerText||'').trim())).map(e => ({ txt: (e.innerText||'').trim(), cls: String(e.className||'').slice(0,44), dis: e.disabled, at: R(e) }));
  // 分类
  out.分类 = Array.from(document.querySelectorAll('*')).filter(e => vis(e) && /请选择合适的频道|分类/.test((e.innerText||'').trim()) && (e.innerText||'').trim().length < 16).map(e => ({ txt: (e.innerText||'').trim(), tag: e.tagName, at: R(e) })).slice(0, 4);
  out.文件框数 = document.querySelectorAll('input[type="file"]').length;
  out.所有文件框 = Array.from(document.querySelectorAll('input[type="file"]')).map(e => String(e.getAttribute('accept')||'').slice(0,36));
  return out;
}
"""
with sync_playwright() as pw:
    b = pw.chromium.connect_over_cdp('http://127.0.0.1:9222')
    wb = [p for p in b.contexts[0].pages if 'weibo' in p.url]
    print(json.dumps(wb[0].evaluate(JS), ensure_ascii=False, indent=1) if wb else '无微博页')
