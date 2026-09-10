# -*- coding: utf-8 -*-
"""只做抖音封面这一步（编辑页已就绪时用）——你看着，不发布"""
import sys, os, json
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright
COVER = 'E:/ai-marketing/storage/cover_1788928821192.jpg'
def log(m): print('[CF] ' + str(m), flush=True)
with sync_playwright() as pw:
    b = pw.chromium.connect_over_cdp('http://127.0.0.1:9222')
    page = [p for p in b.contexts[0].pages if 'douyin' in p.url and 'post/video' in p.url][0]
    page.bring_to_front()
    log('页面=' + page.url)
    # ① 点竖封面入口（coverControl 层——读文本匹配方向）
    got = False
    for e in page.query_selector_all('[class*="coverControl"]'):
        try:
            if e.is_visible() and '竖封面3:4' in (e.inner_text() or ''):
                e.click(timeout=3000); log('✅ 已点「选择封面|竖封面3:4」'); got = True; break
        except Exception: continue
    page.wait_for_timeout(2500)
    # ② 弹窗是否开
    btns = page.evaluate("() => Array.from(document.querySelectorAll('button')).filter(e=>e.offsetParent!==null).map(e=>(e.innerText||'').trim()).filter(t=>t)")[:12]
    log('弹窗按钮: ' + json.dumps(btns, ensure_ascii=False))
    # ③ 点非 custom 的上传区 → 文件框
    up = False
    for e in page.query_selector_all('.semi-upload-drag-area'):
        try:
            cls = e.get_attribute('class') or ''
            if 'custom' in cls or not e.is_visible(): continue
            with page.expect_file_chooser(timeout=8000) as fc:
                e.click()
            fc.value.set_files(COVER)
            log('✅ 封面已上传（非 custom 上传区）'); up = True; break
        except Exception as ex:
            log('  上传区尝试失败: ' + str(ex)[:70]); continue
    if not up: log('⚠️ 未走上传区')
    page.wait_for_timeout(4000)
    # ④ 点「完成」
    done = False
    for sel in ['button:has-text("完成")', 'button:has-text("保存")', 'button:has-text("确定")']:
        try:
            e = page.query_selector(sel)
            if e and e.is_visible():
                e.click(timeout=2500); log('✅ 已点「' + sel + '」'); done = True; break
        except Exception: continue
    if not done: log('⚠️ 未点中完成')
    page.wait_for_timeout(2000)
    left = page.evaluate("() => document.querySelectorAll('.semi-upload-drag-area').length")
    log('结束 剩余上传区=' + str(left) + '（弹窗关闭≈0）')
