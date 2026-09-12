# -*- coding: utf-8 -*-
"""AGENT 小红书发布执行器（Python 版——复用客户端 buvenv）
关键经验（实测）：
  1) React 页面必须真实鼠标点击（locator.click），JS evaluate click 无效
  2) 封面：先判 PK 开关状态(.pk-cover-switch-trigger .d-switch-simulator.checked —— 2026-09-12 小红书改版后新类名；仍兼容旧 .pk-title-switch)
     → ＋号(.pk-cover-list-add-btn) 触发系统文件框 → setFiles → 完成
  3) 已开 PK 时不要再点开关（会关掉）；无＋号要轮询等
用法: python bu_pub_xhs.py --video <path> --title <t> --topics <t> [--cover <path>]
"""
import sys, os, time, argparse, json
if hasattr(sys.stdout, 'reconfigure'):
    try: sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception: pass
from playwright.sync_api import sync_playwright
try:
    from _cdp_click import cdp_click_text
except Exception:
    cdp_click_text = None

URL = 'https://creator.xiaohongshu.com/publish/publish?from=menu&target=video'



def connect_cdp(pw, url='http://127.0.0.1:9222', tries=15, gap=2, log=None):
    """★2026-09-12: 等登记浏览器(9222)就绪再连——客户端刚 spawn Chrome 时端口还没监听，
    原脚本一启动就 connect → ECONNREFUSED → 1 秒内崩（客户端日志 code=1 Traceback）"""
    import time as _t
    last = None
    for i in range(tries):
        try:
            return pw.chromium.connect_over_cdp(url)
        except Exception as e:
            last = e
            if i == 0 and log:
                try: log('  等登记浏览器(9222)就绪…')
                except Exception: pass
            _t.sleep(gap)
    raise RuntimeError('连不上登记浏览器(9222)，等了 %ds：%s' % (tries * gap, str(last)[:90]))
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
            const s = (document.querySelector('.pk-cover-switch-trigger .d-switch-simulator') || document.querySelector('.pk-title-switch .d-switch-simulator'))
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
    ap.add_argument('--skips', default='', help='跳过步骤（逗号分隔）：标题,话题,封面')
    ap.add_argument('--only-cover', action='store_true', help='跳过上传/标题/话题，只做封面（页面已有内容时调试用）')
    a = ap.parse_args()
    log('视频=' + a.video + ' 封面=' + (a.cover or '无'))
    # 2026-09-12: 用户勾掉的步骤（方案卡 checkbox → main.js --skips）
    _sk = [s.strip() for s in str(getattr(a, 'skips', '') or '').replace('，', ',').split(',') if s.strip()]
    SK_TITLE = '标题' in _sk
    SK_TOPIC = '话题' in _sk
    SK_COVER = ('封面' in _sk) or ('抽帧' in _sk)
    if _sk:
        log('跳过步骤: ' + ','.join(_sk))

    with sync_playwright() as pw:
        b = connect_cdp(pw, log=log)
        ctx = b.contexts[0] if b.contexts else b.new_context()
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.bring_to_front()
        log('URL=' + page.url)
        if 'publish/publish' not in page.url:
            try:
                page.goto(URL, wait_until='domcontentloaded', timeout=30000)
                log('已导航到发布页'); page.wait_for_timeout(3000)
            except Exception as e: log('导航失败: ' + str(e)[:80])

        # 2026-09-12: 页面已有视频/且只要封面 → 跳过前四步（避免重复上传）
        skip_front = bool(a.only_cover)
        if not skip_front:
            try:
                _has = page.evaluate("() => { const t = document.body.innerText || ''; return t.indexOf('重新上传') >= 0 || t.indexOf('视频文件') >= 0; }")
                if _has and a.only_cover:
                    skip_front = True
            except Exception:
                pass

        if not skip_front:
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
            if SK_TITLE:
                log('Step3 标题——用户勾掉，跳过')
            elif a.title:
                el = visible(page, 'input[placeholder*="填写标题会有更多赞哦"]') or visible(page, 'input[placeholder*="标题"]')
                if el:
                    try:
                        el.click(); el.fill(a.title); log('✅ 标题已填: ' + a.title[:20])
                        page.wait_for_timeout(2000)   # ★2026-09-12 步间延时
                    except Exception as e: log('标题填失败: ' + str(e)[:60])
                else: log('⚠️ 未找到标题框')

            # ── Step4 正文/话题 ──
            if SK_TOPIC:
                log('Step4 话题——用户勾掉，跳过')
            elif a.topics:
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
                        page.wait_for_timeout(2000)   # ★步间延时
                    except Exception as e: log('话题填失败: ' + str(e)[:60])
                else: log('⚠️ 未找到正文区')

        # ── Step5 封面（PK 开关 → ＋号 → 文件框 → 完成）──
        if SK_COVER:
            log('Step5 封面——用户勾掉，跳过（用平台默认）')
        elif a.cover and os.path.exists(a.cover):
            add_sel = '.pk-cover-list-add-btn'
            n = count_visible(page, add_sel)
            if n == 0:
                on = pk_on(page)
                log('PK 开关状态=' + str(on))
                if on is not True:
                    try:
                        page.locator('.pk-cover-switch-trigger').first.click(timeout=4000)
                        log('已点开 PK 封面')
                    except Exception as e: log('开关点击失败: ' + str(e)[:50])
                for i in range(8):
                    page.wait_for_timeout(1000)
                    if count_visible(page, add_sel) > 0: break
                if count_visible(page, add_sel) == 0 and pk_on(page) is True:
                    try:
                        page.locator('.pk-cover-switch-trigger').first.click(timeout=3000)   # 关
                        page.wait_for_timeout(1200)
                        page.locator('.pk-cover-switch-trigger').first.click(timeout=3000)   # 再开（重置）
                    except Exception: pass
                    for i in range(6):
                        page.wait_for_timeout(1000)
                        if count_visible(page, add_sel) > 0: break
            n = count_visible(page, add_sel)
            log('封面＋号数=' + str(n) + ' PK=' + str(pk_on(page)))
            if n > 0:
                up = False
                # ★2026-09-12 小红书改版：PK 封面框是【隐藏 input.pk-cover-list-file-input】(accept=.jpg,.jpeg,.png)
                # → 直接 set_input_files（不必点＋号；＋号被 tooltip-trigger 遮挡，点了也不弹框）
                try:
                    # ★2026-09-12：PK 列表最多 3 张（默认已被智能推荐占满）→ 先点 X 删一张腾位
                    try:
                        _full = page.evaluate("() => document.querySelectorAll('.pk-cover-list-card-img').length")
                        log('PK 封面现有=' + str(_full) + ' 张')
                        for _try in range(3):
                            if (page.evaluate("() => document.querySelectorAll('.pk-cover-list-card-img').length") or 0) < 3:
                                break
                            _x = page.query_selector('.pk-cover-list-slide-close')
                            if not _x:
                                break
                            _xb = _x.bounding_box()
                            if _xb:
                                page.mouse.move(_xb['x'] + _xb['width'] / 2, _xb['y'] + _xb['height'] / 2)
                                page.wait_for_timeout(400)
                                page.mouse.click(_xb['x'] + _xb['width'] / 2, _xb['y'] + _xb['height'] / 2)
                            else:
                                _x.click(timeout=3000)
                            page.wait_for_timeout(1800)
                            log('已删一张 PK 封面（腾位）→ 剩 ' + str(page.evaluate("() => document.querySelectorAll('.pk-cover-list-card-img').length")))
                    except Exception as _e9:
                        log('删除 PK 封面失败: ' + str(_e9)[:50])
                    _pk_in = page.query_selector('input.pk-cover-list-file-input') or page.query_selector('input[type="file"][accept*=".jpg"]')
                    if _pk_in:
                        _pk_in.set_input_files(a.cover)
                        page.wait_for_timeout(4000)
                        log('✅ 封面已上传(PK 隐藏 input 直传)')
                        up = True
                except Exception as _e0:
                    log('PK input 直传失败: ' + str(_e0)[:60])
                try:
                    if up:
                        raise RuntimeError('__skip__')
                    with page.expect_file_chooser(timeout=9000) as fc:
                        # ★2026-09-12 小红书改版：.pk-cover-list-add-tooltip-trigger 盖在 .pk-cover-list-add-btn 上
                        # （点 add-btn 会被判"被遮挡"→ 超时）→ 依次尝试，最后真实鼠标点坐标兜底
                        _clicked = False
                        for _s in ['.pk-cover-list-add-tooltip-trigger', '.pk-cover-list-add-btn']:
                            _el = page.query_selector(_s)
                            if _el and _el.is_visible():
                                try:
                                    _el.scroll_into_view_if_needed()
                                    _el.click(timeout=4000)
                                    _clicked = True; log('已点＋号 ← ' + _s)
                                    break
                                except Exception as _e2:
                                    log('  ' + _s + ' 点击失败: ' + str(_e2)[:46])
                        if not _clicked:
                            _el2 = page.query_selector('.pk-cover-list-add-tooltip-trigger') or page.query_selector(add_sel)
                            _bb = _el2.bounding_box() if _el2 else None
                            if _bb:
                                page.mouse.click(_bb['x'] + _bb['width'] / 2, _bb['y'] + _bb['height'] / 2)
                                _clicked = True; log('已用真实鼠标点＋号中心')
                    fc.value.set_files(a.cover); log('✅ 封面已上传(＋→文件框)'); up = True
                except Exception as e:
                    if '__skip__' not in str(e): log('＋号文件框失败: ' + str(e)[:70])
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
                    page.wait_for_timeout(5000)   # ★封面完成后 5 秒（你要求的）
            else:
                log('⚠️ 无封面＋号（PK 未开或列表未渲染）')
        else:
            log('无自定义封面 → 平台默认')

        if a.no_publish:
            log('--no-publish：跳过发布（测试模式）')
            print(json.dumps({'success': True, 'url': page.url, 'dryRun': True}))
            return
        # ── Step6 发布 ──
        # 2026-09-10 实测：小红书提交按钮 = <xhs-publish-btn>（Vue 自定义元素，内部是 closed shadow DOM
        #   → DOM 完全查不到内部按钮；elementFromPoint 只返回宿主；只有【像素定位 + 坐标点击】有效。
        #   实测：红色按钮区 x888-981 y880-919 → 点中心(934,900) → 跳 /publish/success「发布成功」）
        page.wait_for_timeout(1000)
        pub = False
        # 2026-09-12: 优先 CDP 穿透点「发布」（xhs-publish-btn 在 closed shadow——CDP 能穿）
        if cdp_click_text is not None:
            try:
                _ok, _msg = cdp_click_text(page, '发布', tag='', log=log, exact=True, prefer_bottom_right=True)
                log('CDP 穿透点「发布」→ %s (%s)' % (_ok, _msg))
                pub = bool(_ok)
            except Exception as e_cdp:
                log('CDP 点击异常（回落像素定位）: ' + str(e_cdp)[:60])
        try:
            box = page.evaluate("() => { const el = document.querySelector('xhs-publish-btn'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }")
            if box and box.get('w', 0) > 50:
                import tempfile, os as _os
                shot = _os.path.join(tempfile.gettempdir(), 'xhs_pub_btn.png')
                page.screenshot(path=shot)
                try:
                    from PIL import Image
                    im = Image.open(shot).convert('RGB'); _px = im.load()
                    _x0, _y0 = int(box['x']), int(box['y'])
                    _x1, _y1 = int(box['x'] + box['w']), int(box['y'] + box['h'])
                    xs, ys = [], []
                    for y in range(max(0, _y0), min(im.size[1], _y1)):
                        for x in range(max(0, _x0), min(im.size[0], _x1), 2):
                            r, g, b = _px[x, y]
                            if r > 180 and g < 110 and b < 130:
                                xs.append(x); ys.append(y)
                    if xs:
                        cx, cy = sum(xs) // len(xs), sum(ys) // len(ys)
                        page.mouse.move(cx, cy); page.wait_for_timeout(300)
                        page.mouse.click(cx, cy)
                        log('✅ 已点发布按钮（像素定位 %d,%d，命中 %d 点）' % (cx, cy, len(xs)))
                        pub = True
                    else:
                        log('⚠️ 未在按钮区找到红色像素')
                except Exception as e2:
                    log('像素定位失败: ' + str(e2)[:70])
        except Exception as e1:
            log('发布按钮定位异常: ' + str(e1)[:70])
        if not pub:
            try:
                page.locator('xhs-publish-btn').first.click(timeout=4000)
                log('✅ 已点 xhs-publish-btn（元素点击兜底）'); pub = True
            except Exception:
                pass
        if pub:
            for i in range(8):
                page.wait_for_timeout(3000)
                # 2026-09-10: 发布后可能有二次确认（小红书弹「确认发布」等）——逐轮点掉
                for _t in ['确认发布', '确定', '确认']:
                    try:
                        _loc = page.get_by_text(_t, exact=True)
                        if _loc.count() > 0 and _loc.first.is_visible():
                            _loc.first.click(timeout=2500)
                            log('已点发布二次确认：「' + _t + '」')
                            break
                    except Exception:
                        continue
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

if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        # 2026-09-12: 加异常兜底——原来裸调 main()，异常直接崩、Traceback 被日志截断，看不到真因
        import traceback
        traceback.print_exc()
        try:
            print(json.dumps({'success': False, 'result': str(e)[:300]}))
        except Exception:
            print('{"success": false, "result": "脚本异常"}')
