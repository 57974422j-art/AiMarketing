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
try:
    from _cdp_click import cdp_click_text
except Exception:
    cdp_click_text = None



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

def click_cover_entry(page, want_landscape):
    """按方向选封面入口（coverControl 层可点，文本含 竖封面3:4 / 横封面4:3）——取第一个会传错方向"""
    key = '横封面4:3' if want_landscape else '竖封面3:4'
    try:
        for e in page.query_selector_all('[class*="coverControl"]'):
            try:
                if not e.is_visible(): continue
                if key in (e.inner_text() or ''):
                    e.click(timeout=3000)
                    log('已点封面入口: ' + key)
                    return True
            except Exception: continue
    except Exception: pass
    # 兜底：文本定位
    return click_text(page, [key])

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
        b = connect_cdp(pw, log=log)
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

        # 处理"上次未发布的视频，是否继续编辑"弹窗（点放弃——干净开始）
        try:
            for t in ['放弃', '取消']:
                loc = page.get_by_text(t, exact=True)
                if loc.count() > 0 and loc.first.is_visible():
                    loc.first.click(timeout=2500)
                    log('已关闭"继续编辑"弹窗(点' + t + ')')
                    page.wait_for_timeout(1500)
                    break
        except Exception as e:
            log('弹窗处理跳过: ' + str(e)[:50])

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
                    page.wait_for_timeout(1500)                # 等联想下拉出现
                    page.keyboard.press('Escape')               # 先试 Esc
                    page.wait_for_timeout(400)
                    page.keyboard.type('#', delay=40)           # ★用户实测：末尾再打一个 # 联想下拉就消失
                    page.wait_for_timeout(900)
                    page.keyboard.press('Backspace')            # 删掉多余的 #
                    page.wait_for_timeout(300)
                    log('✅ 话题已填: ' + a.topics[:30] + '（已用 # 技巧关联想浮层）')
                except Exception as e: log('话题填失败: ' + str(e)[:60])
            else: log('⚠️ 未找到话题区')

        # ── Step5 封面（真实点击 coverControl → 弹窗 → 选方向 → 上传 → 点图 → 完成）──
        if a.cover and os.path.exists(a.cover):
            ori = img_orientation(a.cover)
            entry = '竖封面3:4' if ori == 'portrait' else '横封面4:3'
            log('封面方向=' + ori + ' → ' + entry)
            page.wait_for_timeout(800)
            opened = click_cover_entry(page, ori == 'landscape')
            if not opened: opened = click_text(page, ['选择封面', '设置封面'])
            if opened:
                page.wait_for_timeout(2500)
                # 点方向按钮（与入口方向一致——JS 副本同款；找不到就跳过）
                click_text(page, ['设置竖封面' if ori == 'portrait' else '设置横封面'])
                page.wait_for_timeout(600)
                # 上传：优先 semi-upload-drag-area（排除 custom=AI 参考图区）
                up = False
                for e in page.query_selector_all('.semi-upload-drag-area'):
                    try:
                        cls = e.get_attribute('class') or ''
                        # 早上实测：-custom 是 AI 参考图区（传这里封面不生效）——必须排除
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
                    done_ok = False
                    for sel in ['button:has-text("完成")', 'button:has-text("保存")', 'button:has-text("确定")']:
                        try:
                            e = page.query_selector(sel)
                            if e and e.is_visible():
                                e.click(timeout=2500); log('✅ 封面已确认（' + sel + '）'); done_ok = True; break
                        except Exception: continue
                    if not done_ok:
                        if click_text(page, ['完成', '保存', '确定']): done_ok = True
                    if not done_ok: log('⚠️ 未点中完成按钮')
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
        # 2026-09-12: 原来用 click_text 严格文本匹配 → 客户端实测"未找到发布按钮"
        #   （页面渲染差异/文本带图标/不在视口都会失败）→ 改【CDP 穿透点击】，文本点击作兜底
        page.wait_for_timeout(1500)
        pub_ok = False
        if cdp_click_text is not None:
            try:
                _ok, _msg = cdp_click_text(page, '发布', tag='button', log=log, exact=True, prefer_bottom_right=True)
                log('CDP 穿透点「发布」→ %s (%s)' % (_ok, _msg))
                pub_ok = bool(_ok)
            except Exception as e_cdp:
                log('CDP 点击异常（回退文本）: ' + str(e_cdp)[:70])
        if not pub_ok:
            pub_ok = click_text(page, ['发布', '立即发布'], exclude=['离开', '定时'])
        if pub_ok:
            log('✅ 已点发布')
            page.wait_for_timeout(8000)
            log('发布后 URL=' + page.url)
        else:
            log('❌ 未找到发布按钮（CDP + 文本都失败）')
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
