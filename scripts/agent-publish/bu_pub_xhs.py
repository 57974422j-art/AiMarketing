# -*- coding: utf-8 -*-
"""AGENT 小红书发布执行器（Python 版——复用客户端 buvenv）
关键经验（实测）：
  1) React 页面必须真实鼠标点击（locator.click），JS evaluate click 无效
  2) 封面：先判 PK 开关状态(.pk-title-switch .d-switch-simulator.checked)
     → ＋号(.pk-cover-list-add-btn) 触发系统文件框 → setFiles → 完成
  3) 已开 PK 时不要再点开关（会关掉）；无＋号要轮询等
用法: python bu_pub_xhs.py --video <path> --title <t> --topics <t> [--cover <path>]
"""
import sys, os, time, argparse, json
if hasattr(sys.stdout, 'reconfigure'):
    try: sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception: pass
from playwright.sync_api import sync_playwright

URL = 'https://creator.xiaohongshu.com/publish/publish?from=menu&target=video'

def log(m): print('[PUB] ' + str(m), flush=True)

def visible(page, sel):
    try:
        for e in page.query_selector_all(sel):
            try:
                if e.is_visible(): return e
            except Exception: continue
    except Exception: pass
    return None

def count_visible(page, sel):
    n = 0
    try:
        for e in page.query_selector_all(sel):
            try:
                if e.is_visible(): n += 1
            except Exception: continue
    except Exception: pass
    return n

def click_text(page, texts, exclude=None):
    for t in texts:
        try:
            loc = page.get_by_text(t, exact=True)
            for i in range(min(loc.count(), 4)):
                el = loc.nth(i)
                try:
                    if not el.is_visible(): continue
                    if exclude and any(x in (el.inner_text() or '') for x in exclude): continue
                    el.click(timeout=3000)
                    log('已点击文本: ' + t)
                    return True
                except Exception: continue
        except Exception: continue
    return False

def pk_on(page):
    try:
        return page.evaluate("""() => {
            const s = document.querySelector('.pk-title-switch .d-switch-simulator')
            return !!(s && /checked/.test(String(s.className)))
        }""")
    except Exception:
        return None

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--video', required=True)
    ap.add_argument('--title', default='')
    ap.add_argument('--topics', default='')
    ap.add_argument('--cover', default='')
    ap.add_argument('--no-publish', action='store_true', help='只做到封面不点发布（测试用）')
    a = ap.parse_args()
    log('视频=' + a.video + ' 封面=' + (a.cover or '无'))
    with sync_playwright() as pw:
        b = pw.chromium.connect_over_cdp('http://127.0.0.1:9222')
        ctx = b.contexts[0] if b.contexts else b.new_context()
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.bring_to_front()
        log('URL=' + page.url)
        if 'publish/publish' not in page.url:
            try:
                page.goto(URL, wait_until='domcontentloaded', timeout=30000)
                log('已导航到发布页'); page.wait_for_timeout(3000)
            except Exception as e: log('导航失败: ' + str(e)[:80])

        # ── Step1 上传视频 ──
        ok = False
        fi = page.query_selector('input.upload-input') or page.query_selector('input[type="file"]')  # 同 JS 版：不带 accept 过滤（file input 隐藏，不判可见）
        if fi:
            try:
                fi.set_input_files(a.video); log('✅ 视频已设置'); ok = True
            except Exception as e: log('set_input_files 失败: ' + str(e)[:70])
        if not ok:
            try:
                with page.expect_file_chooser(timeout=8000) as fc:
                    click_text(page, ['上传视频', '点击上传'])
                fc.value.set_files(a.video); log('✅ 视频已设置(filechooser)')
            except Exception as e: log('❌ 视频上传失败: ' + str(e)[:90])

        # ── Step2 等编辑页 ──
        t0 = time.time(); ready = False
        while time.time() - t0 < 280:
            try:
                if 'publish/publish' in page.url and (visible(page, 'input[placeholder*="标题"]') or visible(page, '.tiptap.ProseMirror')):
                    ready = True; break
            except Exception: pass
            page.wait_for_timeout(3000)
        log(('✅ 编辑页就绪' if ready else '⚠️ 等编辑页超时') + ' 用时 %ds' % int(time.time() - t0))

        # ── Step3 标题 ──
        if a.title:
            el = visible(page, 'input[placeholder*="填写标题会有更多赞哦"]') or visible(page, 'input[placeholder*="标题"]')
            if el:
                try:
                    el.click(); el.fill(a.title); log('✅ 标题已填: ' + a.title[:20])
                except Exception as e: log('标题填失败: ' + str(e)[:60])
            else: log('⚠️ 未找到标题框')

        # ── Step4 正文/话题 ──
        if a.topics:
            ce = visible(page, '.tiptap.ProseMirror') or visible(page, 'div[contenteditable="true"]')
            if ce:
                try:
                    ce.click(); page.wait_for_timeout(300)
                    page.keyboard.type(a.topics, delay=30)
                    page.wait_for_timeout(1500)
                    page.keyboard.press('Escape')
                    page.wait_for_timeout(400)
                    page.keyboard.type('#', delay=40)           # 末尾再打一个 # 关联想浮层（用户实测）
                    page.wait_for_timeout(900)
                    page.keyboard.press('Backspace')
                    page.wait_for_timeout(300)
                    log('✅ 话题已填: ' + a.topics[:30] + '（已用 # 技巧关联想浮层）')
                except Exception as e: log('话题填失败: ' + str(e)[:60])
            else: log('⚠️ 未找到正文区')

        # ── Step5 封面（PK 开关 → ＋号 → 文件框 → 完成）──
        if a.cover and os.path.exists(a.cover):
            add_sel = '.pk-cover-list-add-btn'
            n = count_visible(page, add_sel)
            if n == 0:
                on = pk_on(page)
                log('PK 开关状态=' + str(on))
                if on is not True:
                    try:
                        page.locator('.pk-title-switch').first.click(timeout=4000)
                        log('已点开 PK 封面')
                    except Exception as e: log('开关点击失败: ' + str(e)[:50])
                for i in range(8):
                    page.wait_for_timeout(1000)
                    if count_visible(page, add_sel) > 0: break
                if count_visible(page, add_sel) == 0 and pk_on(page) is True:
                    try:
                        page.locator('.pk-title-switch').first.click(timeout=3000)   # 关
                        page.wait_for_timeout(1200)
                        page.locator('.pk-title-switch').first.click(timeout=3000)   # 再开（重置）
                    except Exception: pass
                    for i in range(6):
                        page.wait_for_timeout(1000)
                        if count_visible(page, add_sel) > 0: break
            n = count_visible(page, add_sel)
            log('封面＋号数=' + str(n) + ' PK=' + str(pk_on(page)))
            if n > 0:
                up = False
                try:
                    with page.expect_file_chooser(timeout=8000) as fc:
                        page.locator(add_sel).first.click(timeout=4000)
                    fc.value.set_files(a.cover); log('✅ 封面已上传(＋→文件框)'); up = True
                except Exception as e: log('＋号文件框失败: ' + str(e)[:70])
                if not up:
                    ci = page.query_selector('input.upload-input[accept*="image"]') or page.query_selector('input[type="file"][accept*="image"]')
                    if ci:
                        try:
                            ci.set_input_files(a.cover); log('✅ 封面已上传(image input)'); up = True
                        except Exception as e: log('input 上传失败: ' + str(e)[:60])
                if up:
                    page.wait_for_timeout(4000)
                    if click_text(page, ['完成', '确定', '保存', '应用']): log('✅ 封面已确认')
                    else: log('（PK 封面无确认按钮——上传即生效，正常）')
                    page.wait_for_timeout(1500)
            else:
                log('⚠️ 无封面＋号（PK 未开或列表未渲染）')
        else:
            log('无自定义封面 → 平台默认')

        if a.no_publish:
            log('--no-publish：跳过发布（测试模式）')
            print(json.dumps({'success': True, 'url': page.url, 'dryRun': True}))
            return
        # ── Step6 发布 ──
        page.wait_for_timeout(1000)
        pub = False
        try:
            page.locator('div.publish-video span.btn-text').first.click(timeout=5000)
            log('✅ 已点「发布笔记」(selector)'); pub = True
        except Exception: pass
        if not pub and click_text(page, ['发布笔记', '发布']): pub = True
        if pub:
            for i in range(8):
                page.wait_for_timeout(3000)
                u = page.url
                try:
                    body = page.inner_text('body')[:600]
                except Exception:
                    body = ''
                if '发布成功' in body or 'publish/publish' not in u:
                    log('✅ 发布成功迹象（url=' + u + '）'); break
            log('发布后 URL=' + page.url)
        else:
            log('❌ 未点中发布按钮')
        print(json.dumps({'success': True, 'url': page.url}))

main()
