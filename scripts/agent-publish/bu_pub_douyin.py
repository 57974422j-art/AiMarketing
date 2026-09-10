# -*- coding: utf-8 -*-
"""AGENT 抖音发布执行器（确定性步骤——借鉴 fp-templates/douyin-publish.js）
跑在登记的 bu_profile 浏览器（CDP 9222），不依赖 AI 决策。
用法: python bu_pub_douyin.py --video <path> --title <t> --topics <t> [--cover <path>]
"""
import sys, os, time, argparse, json
if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass
from playwright.sync_api import sync_playwright


def log(m):
    print('[PUB] ' + str(m), flush=True)


def img_orientation(p):
    """返回 portrait/landscape（读图尺寸——PIL 优先，失败读 PNG/JPEG 头）"""
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
                i += 1
                continue
            m = d[i + 1]
            if m in (0xC0, 0xC1, 0xC2):
                h, w = struct.unpack('>HH', d[i + 5:i + 9])
                return 'portrait' if h >= w else 'landscape'
            if m in (0xD8, 0xD9) or 0xD0 <= m <= 0xD7:
                i += 2
                continue
            seg = struct.unpack('>H', d[i + 2:i + 4])[0]
            i += 2 + seg
    except Exception:
        pass
    return 'portrait'


def click_by_text(page, texts, exclude=None, max_len=8):
    """按可见文本点击元素（借鉴 JS：遍历可见元素匹配文本）"""
    for t in texts:
        for sel in ['button', 'span', 'div', 'a', 'label']:
            try:
                for e in page.query_selector_all(sel):
                    try:
                        if not e.is_visible():
                            continue
                        txt = (e.inner_text() or '').strip()
                        if not txt or len(txt) > max_len + len(t):
                            continue
                        if txt == t or (len(t) >= 3 and t in txt and len(txt) <= len(t) + 6):
                            if exclude and any(x in txt for x in exclude):
                                continue
                            e.click(timeout=2500)
                            log('已点击: ' + txt)
                            return True
                    except Exception:
                        continue
            except Exception:
                continue
    return False


def find_title_input(page):
    for sel in ['input[placeholder*="作品标题"]', 'input[placeholder*="填写作品标题"]', 'input[placeholder*="标题"]']:
        try:
            el = page.query_selector(sel)
            if el and el.is_visible():
                return el
        except Exception:
            continue
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--video', required=True)
    ap.add_argument('--title', default='')
    ap.add_argument('--topics', default='')
    ap.add_argument('--cover', default='')
    ap.add_argument('--port', type=int, default=9222)
    a = ap.parse_args()
    log('视频=' + a.video + ' 封面=' + (a.cover or '无'))

    with sync_playwright() as pw:
        b = pw.chromium.connect_over_cdp('http://127.0.0.1:%d' % a.port)
        ctx = b.contexts[0] if b.contexts else b.new_context()
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        try:
            page.bring_to_front()
        except Exception:
            pass
        log('当前 URL=' + page.url)

        # Step1 上传视频
        if 'content/upload' in page.url:
            done = False
            try:
                for fi in page.query_selector_all('input[type="file"]'):
                    acc = (fi.get_attribute('accept') or '')
                    if 'video' in acc or acc == '':
                        fi.set_input_files(a.video)
                        log('✅ 视频已设置(file input)')
                        done = True
                        break
            except Exception as e:
                log('file input 失败: ' + str(e)[:80])
            if not done:
                try:
                    with page.expect_file_chooser(timeout=6000) as fc:
                        click_by_text(page, ['点击上传', '上传'])
                    fc.value.set_files(a.video)
                    log('✅ 视频已设置(filechooser)')
                except Exception as e:
                    log('❌ 视频上传失败: ' + str(e)[:100])

        # Step2 等转码/编辑页就绪（页面文字判断，借鉴 JS）
        t0 = time.time()
        ready = False
        while time.time() - t0 < 270:
            try:
                if '/post/video' in page.url and (page.inner_text('body')[:9000].find('选择封面') >= 0
                                                  or page.inner_text('body')[:9000].find('智能推荐封面') >= 0
                                                  or find_title_input(page) is not None):
                    ready = True
                    break
            except Exception:
                pass
            page.wait_for_timeout(3000)
        log(('✅ 编辑页就绪' if ready else '⚠️ 等转码超时') + ' 用时 ' + str(int(time.time() - t0)) + 's URL=' + page.url)

        # Step3 标题
        if a.title:
            el = find_title_input(page)
            if el is not None:
                try:
                    el.click()
                    el.fill(a.title)
                    log('✅ 标题已填: ' + a.title[:20])
                except Exception as e:
                    log('标题填写失败: ' + str(e)[:80])
            else:
                log('⚠️ 未找到标题框')

        # Step4 话题（contenteditable 正文区）
        if a.topics:
            try:
                ce = None
                for c in page.query_selector_all('div[contenteditable="true"]'):
                    if c.is_visible():
                        ce = c
                        break
                if ce is not None:
                    ce.click()
                    page.wait_for_timeout(300)
                    page.keyboard.type(a.topics, delay=25)
                    page.wait_for_timeout(600)
                    page.keyboard.press('Escape')
                    log('✅ 话题已填: ' + a.topics[:30])
                else:
                    log('⚠️ 未找到话题编辑区')
            except Exception as e:
                log('话题填写失败: ' + str(e)[:80])

        # Step5 封面（★修复：按封面图方向选对应 tab，不再两个都点）
        if a.cover and os.path.exists(a.cover):
            ori = img_orientation(a.cover)
            entry = '竖封面3:4' if ori == 'portrait' else '横封面4:3'
            log('封面方向=' + ori + ' → 选入口: ' + entry)
            page.wait_for_timeout(1000)
            opened = click_by_text(page, [entry], max_len=12) or click_by_text(page, ['选择封面'], max_len=12)
            if opened:
                page.wait_for_timeout(2500)
                up = False
                try:
                    for fi in page.query_selector_all('input[type="file"]'):
                        acc = (fi.get_attribute('accept') or '')
                        if 'image' in acc:
                            fi.set_input_files(a.cover)
                            log('✅ 封面已上传(input)')
                            up = True
                            break
                except Exception as e:
                    log('封面 input 失败: ' + str(e)[:60])
                if not up:
                    try:
                        with page.expect_file_chooser(timeout=6000) as fc:
                            click_by_text(page, ['上传封面', '点击上传', '上传'], max_len=10)
                        fc.value.set_files(a.cover)
                        log('✅ 封面已上传(chooser)')
                        up = True
                    except Exception as e:
                        log('❌ 封面上传失败: ' + str(e)[:100])
                if up:
                    page.wait_for_timeout(3500)
                    try:
                        cv = page.query_selector('canvas')
                        if cv and cv.is_visible():
                            cv.click(timeout=2000)
                            log('已点封面图激活裁切')
                    except Exception:
                        pass
                    page.wait_for_timeout(800)
                    if click_by_text(page, ['完成', '确定', '保存'], max_len=6):
                        log('✅ 封面已确认(完成)')
                    else:
                        log('⚠️ 未找到完成按钮')
                    page.wait_for_timeout(1500)
        else:
            log('无自定义封面 → 用平台默认')

        # Step6 发布（遍历可见按钮匹配"发布"，排除"离开/定时"）
        page.wait_for_timeout(1200)
        pub = click_by_text(page, ['发布', '立即发布'], exclude=['离开', '定时'])
        if pub:
            log('✅ 已点击发布')
            page.wait_for_timeout(6000)
            log('发布后 URL=' + page.url)
        else:
            log('⚠️ 首轮未找到发布按钮——滚动后再试')
            try:
                page.mouse.wheel(0, 1200)
                page.wait_for_timeout(1200)
                if click_by_text(page, ['发布', '立即发布'], exclude=['离开', '定时']):
                    log('✅ 已点击发布(滚动后)')
                    page.wait_for_timeout(5000)
                    log('发布后 URL=' + page.url)
                else:
                    log('❌ 未找到发布按钮')
            except Exception as e:
                log('发布失败: ' + str(e)[:80])
        print(json.dumps({'success': True, 'url': page.url}, ensure_ascii=False))


main()
