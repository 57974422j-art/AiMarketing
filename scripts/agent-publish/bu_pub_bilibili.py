#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
B站（哔哩哔哩）发布（确定性脚本——参考 electron/fp-templates/bilibili-publish.js）
流程: 导航投稿页 → 登录检测 → 上传视频(file input 直传) → 等编辑页
      → 标题(先清空，B站会自动填文件名) → 简介 → 标签 → 封面(best-effort) → 投稿
用法: python bu_pub_bilibili.py --video <path> --title <t> --topics <t> [--cover <path>] [--no-publish] [--only-cover]
"""
import sys, os, re, time, argparse, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.sync_api import sync_playwright
try:
    from _cdp_click import cdp_click_text
except Exception:
    cdp_click_text = None

PUB_URL = 'https://member.bilibili.com/platform/upload/video/frame'
CDP = 'http://127.0.0.1:9222'


def log(m):
    print('[PUB] ' + str(m), flush=True)


def vis(page, sel):
    try:
        return page.evaluate("(s) => { const e = document.querySelector(s); if (!e) return false; const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; }", sel)
    except Exception:
        return False


def body(page, ctx_any=None):
    try:
        return (ctx_any or page).inner_text('body')[:6000]
    except Exception:
        return ''


def click_text(page, texts, what='', ctx_any=None):
    c = ctx_any or page
    for t in texts:
        try:
            loc = c.get_by_text(t, exact=True)
            if loc.count() > 0 and loc.first.is_visible():
                loc.first.click(timeout=4000)
                log('  已点「%s」%s' % (t, what))
                return True
        except Exception:
            continue
    return False


def logged_in(page):
    t = body(page)
    if '登录' in t[:400] and '投稿' not in t:
        return False
    return True


def find_page(ctx):
    for x in ctx.pages:
        if 'member.bilibili.com' in x.url and 'upload' in x.url:
            return x
    for x in ctx.pages:
        if 'member.bilibili.com' in x.url:
            return x
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--video', required=True)
    ap.add_argument('--title', default='')
    ap.add_argument('--topics', default='')
    ap.add_argument('--cover', default='')
    ap.add_argument('--no-publish', action='store_true')
    ap.add_argument('--only-cover', action='store_true')
    a = ap.parse_args()
    log('视频=' + a.video + ' 封面=' + (a.cover or '无'))
    with sync_playwright() as pw:
        b = pw.chromium.connect_over_cdp(CDP)
        ctx = b.contexts[0]
        page = find_page(ctx) or ctx.new_page()
        page.bring_to_front()
        log('URL=' + page.url[:95])
        if 'upload/video' not in page.url:
            page.goto(PUB_URL, wait_until='domcontentloaded', timeout=40000)
            page.wait_for_timeout(5000)
        if not logged_in(page):
            log('未登录（B站登录态不在）')
            print(json.dumps({'success': False, 'result': 'B站未登录'}))
            return
        log('登录态 OK')
        # ── 上传（B站：file input 直传；也已进编辑页则跳过）──
        up = False
        t0 = body(page)
        already_edit = False
        try:
            already_edit = page.evaluate("() => !!document.querySelector('input[placeholder*=\"标题\"]')")
        except Exception:
            pass
        if already_edit and not a.only_cover:
            up = True
            log('已在编辑页（标题框存在）→ 跳过上传')
        if (not up) and (not a.only_cover):
            fi = page.query_selector('input[type=file][accept*="video"]') or page.query_selector('input[type=file]')
            if fi:
                try:
                    fi.set_input_files(a.video)
                    up = True
                    log('视频已设置(file input 直传)')
                except Exception as e:
                    log('  上传失败: ' + str(e)[:70])
            if not up:
                try:
                    with page.expect_file_chooser(timeout=8000) as fc:
                        if not click_text(page, ['上传视频', '点击上传', '投稿'], '（上传入口）'):
                            raise RuntimeError('未找到上传入口')
                    fc.value.set_files(a.video)
                    up = True
                    log('视频已设置(点入口→文件框)')
                except Exception as e:
                    log('  上传入口失败: ' + str(e)[:70])
        if (not up) and (not a.only_cover):
            log('上传入口未找到')
            print(json.dumps({'success': False, 'result': '未找到上传入口'}))
            return
        page.wait_for_timeout(3000)
        # ── 等编辑页（标题框出现）──
        ready = a.only_cover
        for i in range(90):
            if ready:
                break
            page.wait_for_timeout(3000)
            t = body(page)
            if '上传失败' in t or '投稿失败' in t:
                log('视频上传失败')
                print(json.dumps({'success': False, 'result': '视频上传失败'}))
                return
            try:
                has_title = page.evaluate("() => { const e = document.querySelector('input[placeholder*=\"标题\"]'); if (!e) return false; const b = e.getBoundingClientRect(); return b.width > 0; }")
            except Exception:
                has_title = False
            if has_title:
                ready = True
                log('编辑页就绪 用时 %ds' % ((i + 1) * 3))
                break
            if i % 5 == 0:
                log('  [%ds] 等编辑页...' % ((i + 1) * 3))
        if not ready:
            log('等待超时——继续尝试')
        page.wait_for_timeout(3000)
        if not a.only_cover:
            # ── 标题（B站会自动填视频文件名 → 必须先全选清空）──
            try:
                ti = page.query_selector('input[placeholder*="标题"]')
                if ti and vis(page, 'input[placeholder*="标题"]'):
                    ti.click(timeout=3000)
                    page.wait_for_timeout(300)
                    page.keyboard.press('ControlOrMeta+A')
                    page.keyboard.press('Backspace')
                    page.wait_for_timeout(300)
                    tv = (a.title or '').strip()[:80]
                    ti.fill(tv)
                    page.keyboard.press('Tab')
                    log('标题已填: ' + tv[:40])
                else:
                    log('未找到标题框')
            except Exception as e:
                log('  标题填写失败: ' + str(e)[:60])
            # ── 简介（富文本 ql-editor / contenteditable）──
            try:
                ed = page.query_selector('.ql-editor') or page.query_selector('[class*="desc"] [contenteditable="true"]') or page.query_selector('[contenteditable="true"]')
                if ed:
                    ed.click(timeout=3000)
                    page.wait_for_timeout(300)
                    page.keyboard.press('ControlOrMeta+A')
                    page.keyboard.press('Backspace')
                    tps0 = [x for x in re.split(r'[\s,，#]+', (a.topics or '').strip()) if x][:8]
                    desc = (a.title or '').strip()
                    if tps0:
                        desc = (desc + '  ' if desc else '') + ' '.join('#' + t for t in tps0)
                    if desc:
                        page.keyboard.type(desc, delay=25)
                        log('简介已填(含话题): ' + desc[:50])
                else:
                    log('未找到简介框')
            except Exception as e:
                log('  简介填写失败: ' + str(e)[:60])
            # ── 标签（#tag-container input；输完按回车）──
            try:
                tg = page.query_selector('#tag-container input') or page.query_selector('input[placeholder*="回车"]') or page.query_selector('input[placeholder*="标签"]')
                if tg:
                    # 先清掉 B站自动带的标签
                    for _ in range(10):
                        cl = page.query_selector('.tag-pre-wrp .close, [class*="tag"] [class*="close"]')
                        if not cl:
                            break
                        try:
                            cl.click(timeout=1500)
                        except Exception:
                            break
                        page.wait_for_timeout(200)
                    tg.click(timeout=3000)
                    page.wait_for_timeout(300)
                    for t in [x for x in re.split(r'[\s,，#]+', (a.topics or '').strip()) if x][:6]:
                        page.keyboard.type(t, delay=40)
                        page.wait_for_timeout(400)
                        page.keyboard.press('Enter')
                        page.wait_for_timeout(400)
                    log('标签已填(含回车)')
                else:
                    log('未找到标签框')
            except Exception as e:
                log('  标签填写失败: ' + str(e)[:60])
            page.wait_for_timeout(1500)
        # ── 封面（best-effort）──
        if a.cover and os.path.exists(a.cover):
            # ★2026-09-12 B站封面（实测）：点「添加封面」→ 弹出「封面制作」对话框
            #   （智能/模版/文字/贴纸/滤镜 + 上传封面区 + 4:3/16:9 预览 + 取消/完成）
            #   封面框 = .cover-editor input[type=file][accept*="image"]（隐藏，直传）
            ck = False
            try:
                dlg_open = page.evaluate("() => !!document.querySelector('.cover-editor')")
                if not dlg_open:
                    el = page.query_selector('.cover-empty-pill') or page.query_selector('.cover-slot')
                    if el:
                        el.scroll_into_view_if_needed()
                        page.wait_for_timeout(600)
                        bb = el.bounding_box()
                        if bb:
                            page.mouse.move(bb['x'] + bb['width'] / 2, bb['y'] + bb['height'] / 2)
                            page.wait_for_timeout(400)
                            page.mouse.click(bb['x'] + bb['width'] / 2, bb['y'] + bb['height'] / 2)
                        page.wait_for_timeout(3500)
                        log('已点「添加封面」打开封面制作弹窗')
            except Exception as e:
                log('  打开封面弹窗失败: ' + str(e)[:50])
            try:
                fi = page.query_selector('.cover-editor input[type=file][accept*="image"]') or page.query_selector('input[type=file][accept*="image"]')
                if fi:
                    fi.set_input_files(a.cover)
                    ck = True
                    log('封面已上传(弹窗 image input 直传)')
                else:
                    log('未找到封面 image input → 平台默认')
            except Exception as e:
                log('  封面直传失败: ' + str(e)[:60])
            if ck:
                page.wait_for_timeout(4500)
                if click_text(page, ['完成'], '（封面完成）'):
                    log('封面已确认（弹窗已关）')
                else:
                    log('未找到「完成」按钮（可能已自动应用）')
                page.wait_for_timeout(1500)
        else:
            log('无自定义封面 → 平台默认')
        if a.no_publish or a.only_cover:
            log('跳过投稿（测试模式）')
            print(json.dumps({'success': True, 'result': '已填完（未投稿）'}))
            return
        # ── 投稿 ──
        ok = click_text(page, ['立即投稿', '投稿', '发布'], '（投稿）')
        if not ok and cdp_click_text:
            ok = cdp_click_text(page, '立即投稿', tag='', log=log, exact=True, prefer_bottom_right=True)
            if not ok:
                ok = cdp_click_text(page, '投稿', tag='', log=log, exact=True, prefer_bottom_right=True)
        page.wait_for_timeout(3000)
        click_text(page, ['确认', '确定'], '（二次确认）')
        page.wait_for_timeout(8000)
        t = body(page)
        if '投稿成功' in t or '/platform/upload/text/edit' in page.url or '稿件管理' in t or '已投稿' in t:
            log('投稿成功！')
            print(json.dumps({'success': True, 'result': '已投稿到B站'}))
        else:
            log('结果不确定 ok=%s' % ok)
            print(json.dumps({'success': True, 'result': '已执行投稿，请手动确认'}))


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        log('异常: ' + str(e)[:150])
        print(json.dumps({'success': False, 'result': str(e)[:200]}))
