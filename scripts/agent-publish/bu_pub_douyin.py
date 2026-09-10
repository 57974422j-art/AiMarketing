# -*- coding: utf-8 -*-
"""AGENT 抖音发布执行器（Python 版——复用客户端 buvenv 环境，与 bu_exec.py 同机制）
关键经验：
  1) React 页面必须真实鼠标点击（locator.click），JS evaluate click 无效
  2) 封面弹窗入口是 coverControl 层（hash 类名用前缀匹配）；弹窗内上传用 .semi-upload-drag-area（排除 -custom）
  3) 封面横竖按封面图实际尺寸选（竖→竖封面3:4 / 横→横封面4:3）
用法: python bu_pub_douyin.py --video <path> --title <t> --topics <t> [--cover <path>]
"""
import sys, os, time, argparse, json
if hasattr(sys.stdout, 'reconfigure'):
    try: sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception: pass
from playwright.sync_api import sync_playwright

def log(m): print('[PUB] ' + str(m), flush=True)

def img_orientation(p):
    """竖 portrait / 横 landscape（PIL 优先，失败手读 PNG/JPEG 尺寸）"""
    try:
        from PIL import Image
        w, h = Image.open(p).size
        return 'portrait' if h >= w else 'landscape'
    except Exception:
        pass
    try:
        import struct
        with open(p, 'rb') as f:
            d = f.read(300000)
        if d[:8] == b'\x89PNG\r\n\x1a\n':
            w, h = struct.unpack('>II', d[16:24])
            return 'portrait' if h >= w else 'landscape'
        i = 2
        while i < len(d) - 9:
            if d[i] != 0xFF:
                i += 1; continue
            m = d[i + 1]
            if m in (0xC0, 0xC1, 0xC2):
                h, w = struct.unpack('>HH', d[i + 5:i + 9])
                return 'portrait' if h >= w else 'landscape'
            if m in (0xD8, 0xD9) or 0xD0 <= m <= 0xD7:
                i += 2; continue
            i += 2 + struct.unpack('>H', d[i + 2:i + 4])[0]
    except Exception:
        pass
    return 'portrait'

def visible(page, sel):
    try:
        for e in page.query_selector_all(sel):
            try:
                if e.is_visible(): return e
            except Exception: continue
    except Exception: pass
    return None

def click_text(page, texts, exclude=None):
    """按文本真实点击（playwright locator——React 只认真实点击）"""
    for t in texts:
        try:
            loc = page.get_by_text(t, exact=True)
            n = loc.count()
            for i in range(min(n, 4)):
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

def click_selector_prefix(page, prefix, exclude=None):
    """按 class 前缀真实点击（hash 类名——coverControl-xxxx）"""
    try:
        for e in page.query_selector_all('[class*="' + prefix + '"]'):
            try:
                if not e.is_visible(): continue
                cls = e.get_attribute('class') or ''
                if exclude and any(x in cls for x in exclude): continue
                e.click(timeout=3000)
                log('已点击 [class*=' + prefix + ']')
                return True
            except Exception: continue
    except Exception: pass
    return False

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
        # 不在 upload 页则导航（保险）
        if 'content/upload' not in page.url:
            try:
                page.goto('https://creator.douyin.com/creator-micro/content/upload', wait_until='domcontentloaded', timeout=30000)
                log('已导航到上传页')
                page.wait_for_timeout(3000)
            except Exception as e: log('导航失败: ' + str(e)[:80])

        # ── Step1 上传视频 ──
        ok = False
        fi = page.query_selector('input[type="file"]')  # file input 隐藏——不判可见
        if fi:
            try:
                fi.set_input_files(a.video); log('✅ 视频已设置(input)'); ok = True
            except Exception as e: log('set_input_files 失败: ' + str(e)[:80])
        if not ok:
            try:
                with page.expect_file_chooser(timeout=8000) as fc:
                    click_text(page, ['上传视频', '点击上传', '上传'])
                fc.value.set_files(a.video); log('✅ 视频已设置(filechooser)')
            except Exception as e: log('❌ 视频上传失败: ' + str(e)[:100])

        # ── Step2 等转码/编辑页 ──
        t0 = time.time(); ready = False
        while time.time() - t0 < 280:
            try:
                body = page.inner_text('body')[:9000]
                if '选择封面' in body or '作品标题' in body or '发布时间' in body:
                    ready = True; break
            except Exception: pass
            page.wait_for_timeout(3000)
        log(('✅ 编辑页就绪' if ready else '⚠️ 等转码超时') + ' 用时 %ds URL=%s' % (int(time.time() - t0), page.url))

        # ── Step3 标题 ──
        if a.title:
            for sel in ['input[placeholder*="作品标题"]', 'input[placeholder*="填写作品标题"]', 'input[placeholder*="标题"]']:
                el = visible(page, sel)
                if el:
                    try:
                        el.click(); el.fill(a.title); log('✅ 标题已填: ' + a.title[:20]); break
                    except Exception as e: log('标题填失败: ' + str(e)[:60])
            else: log('⚠️ 未找到标题框')

        # ── Step4 话题（contenteditable 正文）──
        if a.topics:
            ce = visible(page, 'div[contenteditable="true"]')
            if ce:
                try:
                    ce.click(); page.wait_for_timeout(300)
                    page.keyboard.type(a.topics, delay=30)
                    page.wait_for_timeout(600)
                    page.keyboard.press('Escape')
                    log('✅ 话题已填: ' + a.topics[:30])
                except Exception as e: log('话题填失败: ' + str(e)[:60])
            else: log('⚠️ 未找到话题区')

        # ── Step5 封面（真实点击 coverControl → 弹窗 → 选方向 → 上传 → 点图 → 完成）──
        if a.cover and os.path.exists(a.cover):
            ori = img_orientation(a.cover)
            entry = '竖封面3:4' if ori == 'portrait' else '横封面4:3'
            log('封面方向=' + ori + ' → ' + entry)
            page.wait_for_timeout(800)
            opened = click_selector_prefix(page, 'coverControl')
            if not opened: opened = click_text(page, ['选择封面', '设置封面'])
            if opened:
                page.wait_for_timeout(2500)
                # 方向 tab（在弹窗内——真实点击）
                click_text(page, [entry])
                page.wait_for_timeout(800)
                # 上传：优先 semi-upload-drag-area（排除 custom=AI 参考图区）
                up = False
                for e in page.query_selector_all('.semi-upload-drag-area'):
                    try:
                        cls = e.get_attribute('class') or ''
                        if 'custom' in cls or not e.is_visible(): continue
                        with page.expect_file_chooser(timeout=8000) as fc:
                            e.click()
                        fc.value.set_files(a.cover); log('✅ 封面已上传(drag-area)'); up = True
                        break
                    except Exception: continue
                if not up:
                    for fi2 in page.query_selector_all('input[type="file"]'):
                        try:
                            acc = fi2.get_attribute('accept') or ''
                            if 'image' in acc:
                                fi2.set_input_files(a.cover); log('✅ 封面已上传(image input)'); up = True; break
                        except Exception: continue
                if up:
                    page.wait_for_timeout(3500)
                    try:
                        cv = visible(page, 'canvas') or visible(page, '[class*="cover"] img')
                        if cv: cv.click(timeout=2000); log('已点封面图激活裁切')
                    except Exception: pass
                    page.wait_for_timeout(1000)
                    if click_text(page, ['完成', '确定', '保存']): log('✅ 封面已确认')
                    else: log('⚠️ 未找到完成按钮')
                    page.wait_for_timeout(1500)
            else:
                log('⚠️ 未找到封面入口（coverControl/选择封面）')
        else:
            log('无自定义封面 → 平台默认')

        if a.no_publish:
            log('--no-publish：跳过发布（测试模式）')
            print(json.dumps({'success': True, 'url': page.url, 'dryRun': True}))
            return
        # ── Step6 发布 ──
        page.wait_for_timeout(1000)
        if click_text(page, ['发布', '立即发布'], exclude=['离开', '定时']):
            log('✅ 已点发布')
            page.wait_for_timeout(8000)
            log('发布后 URL=' + page.url)
        else:
            log('❌ 未找到发布按钮')
        print(json.dumps({'success': True, 'url': page.url}))

main()
