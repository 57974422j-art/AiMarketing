# -*- coding: utf-8 -*-
"""AGENT 视频号发布执行器（Python，2026-09-10 手动逐步跑通后固化）
实测要点：
  1) 页面 = channels.weixin.qq.com/platform/post/create（登录态）
  2) 发布器在 iframe（micro/content/post/create）——★Playwright 的 locator 在该 iframe 内【完全失效】（count=0）
  3) 上传：遍历 page.frames() 找 input[type=file]（accept video）→ set_input_files
  4) 描述：div.input-editor（contenteditable，data-placeholder="添加描述"）
  5) 短标题：input[placeholder*="短标题"]
  6) 封面：点封面区「编辑」→ 弹窗「上传封面」→ 文件框 → 点「确认」
  7) 发表：★★必须用 CDP 穿透点击（DOM.getDocument pierce → getBoxModel 准确视口坐标 → mouse.click）
     —— 用 frame.evaluate 自算坐标会偏（iframe 内有滚动，实测偏 400px 点空）
用法: python bu_pub_shipinhao.py --video <p> --title <t> --topics <t> [--cover <p>] [--no-publish]
"""
import sys, os, time, argparse, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
if hasattr(sys.stdout, 'reconfigure'):
    try: sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception: pass
from playwright.sync_api import sync_playwright
from _cdp_click import cdp_click_text

URL = 'https://channels.weixin.qq.com/platform/post/create'

def log(m): print('[PUB] ' + str(m), flush=True)

def find_frame_input(pg, accept_kw='video'):
    """遍历所有 frame 找 file input（返回 (frame, handle)）"""
    for f in pg.frames:
        try:
            for el in f.query_selector_all('input[type="file"]'):
                acc = (el.get_attribute('accept') or '')
                if accept_kw in acc:
                    return f, el
        except Exception:
            continue
    return None, None

def frame_of(pg):
    for f in pg.frames:
        if 'micro/content' in f.url:
            return f
    return pg.frames[-1]

def click_by_text_cdp_any(pg, text, logf=log):
    """CDP 穿透点击（优先 button 标签，再任意标签）"""
    ok, msg = cdp_click_text(pg, text, tag='button', log=logf)
    if ok:
        return True
    ok2, msg2 = cdp_click_text(pg, text, tag='', log=logf)
    return ok2

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--video', required=True)
    ap.add_argument('--title', default='')
    ap.add_argument('--topics', default='')
    ap.add_argument('--cover', default='')
    ap.add_argument('--no-publish', action='store_true')
    a = ap.parse_args()
    log('视频=' + a.video + ' 标题=' + (a.title or '(无)') + ' 封面=' + (a.cover or '(无)'))

    with sync_playwright() as pw:
        b = pw.chromium.connect_over_cdp('http://127.0.0.1:9222')
        ctx = b.contexts[0] if b.contexts else b.new_context()
        # ── 锁定视频号发布页 ──
        page = None
        for pg in ctx.pages:
            if 'channels.weixin.qq.com' in pg.url:
                page = pg; break
        if page is None:
            page = ctx.new_page()
            page.goto(URL, wait_until='domcontentloaded', timeout=40000)
            page.wait_for_timeout(5000)
        page.bring_to_front()
        log('① 页面=' + page.url)

        # ── 上传视频（遍历 frame 找 file input）──
        f, el = find_frame_input(page, 'video')
        if el is not None:
            try:
                el.set_input_files(a.video)
                log('② ✅ 视频已设置（frame=' + str(f.url[:50]) + '）')
            except Exception as e:
                log('② 直接设置失败（detached）→ 重试: ' + str(e)[:60])
                page.wait_for_timeout(1500)
                f2, el2 = find_frame_input(page, 'video')
                if el2 is not None:
                    el2.set_input_files(a.video)
                    log('② ✅ 视频已设置（重试成功）')
        else:
            log('② ❌ 未找到视频 file input')
        # 等编辑区
        t0 = time.time()
        while time.time() - t0 < 240:
            page.wait_for_timeout(3000)
            try:
                fr = frame_of(page)
                t = fr.evaluate("() => (document.body.innerText||'').slice(0,600)")
            except Exception:
                t = ''
            if '添加描述' in t or '短标题' in t or '视频描述' in t:
                break
        log('③ 编辑区就绪 用时 %ds' % int(time.time() - t0))
        fr = frame_of(page)

        # ── 描述（contenteditable）——用 CDP 取准确坐标点击 + 键盘输入 ──
        if a.topics:
            try:
                xy = fr.evaluate("""() => { const e = document.querySelector('.input-editor'); if (!e) return null; e.scrollIntoView({block:'center'}); const b = e.getBoundingClientRect(); return Math.round(b.x+b.width/2)+','+Math.round(b.y+b.height/2); }""")
                if xy:
                    # iframe 偏移换算（frame 顶格时为 0,0；有偏移则加上）
                    off = fr.evaluate("() => { const fe = window.frameElement; const b = fe ? fe.getBoundingClientRect() : {x:0,y:0}; return Math.round(b.x)+','+Math.round(b.y); }")
                    ox, oy = [int(v) for v in off.split(',')]
                    x, y = [int(v) for v in xy.split(',')]
                    page.mouse.click(ox + x, oy + y)
                    page.wait_for_timeout(400)
                    page.keyboard.type(a.topics, delay=30)
                    page.wait_for_timeout(700)
                    v = fr.evaluate("() => { const e = document.querySelector('.input-editor'); return e ? (e.innerText||'').trim() : null; }")
                    log('④ 描述已填（值=%s）' % repr(v))
                else:
                    log('④ ⚠️ 未找到描述框(.input-editor)')
            except Exception as e:
                log('④ 描述失败: ' + str(e)[:70])
        # ── 短标题 ──
        if a.title:
            try:
                xy2 = fr.evaluate("""() => { const i = document.querySelector('input[placeholder*="短标题"]'); if (!i) return null; i.scrollIntoView({block:'center'}); const b = i.getBoundingClientRect(); return Math.round(b.x+40)+','+Math.round(b.y+b.height/2); }""")
                if xy2:
                    off2 = fr.evaluate("() => { const fe = window.frameElement; const b = fe ? fe.getBoundingClientRect() : {x:0,y:0}; return Math.round(b.x)+','+Math.round(b.y); }")
                    ox2, oy2 = [int(v) for v in off2.split(',')]
                    x2, y2 = [int(v) for v in xy2.split(',')]
                    page.mouse.click(ox2 + x2, oy2 + y2)
                    page.wait_for_timeout(400)
                    page.keyboard.type(a.title[:30], delay=25)
                    page.wait_for_timeout(600)
                    v2 = fr.evaluate("""() => { const i = document.querySelector('input[placeholder*="短标题"]'); return i ? i.value : null; }""")
                    log('⑤ 短标题已填（值=%s）' % repr(v2))
                else:
                    log('⑤ ⚠️ 未找到短标题框')
            except Exception as e:
                log('⑤ 短标题失败: ' + str(e)[:70])

        # ── 封面（封面区「编辑」→ 弹窗「上传封面」→ 文件框 → 「确认」）──
        if a.cover and os.path.exists(a.cover):
            try:
                # 点封面区「编辑」（CDP 找 button/div 文本"编辑"——取最靠上的）
                edit_xy = fr.evaluate("""() => { const vis=(e)=>!!(e&&e.offsetParent!==null);
                  const els = Array.from(document.querySelectorAll('.edit-btn')).filter(vis);
                  if (!els.length) return null; const b = els[0].getBoundingClientRect();
                  return Math.round(b.x+b.width/2)+','+Math.round(b.y+b.height/2); }""")
                if edit_xy:
                    off3 = fr.evaluate("() => { const fe = window.frameElement; const b = fe ? fe.getBoundingClientRect() : {x:0,y:0}; return Math.round(b.x)+','+Math.round(b.y); }")
                    ox3, oy3 = [int(v) for v in off3.split(',')]
                    x3, y3 = [int(v) for v in edit_xy.split(',')]
                    page.mouse.click(ox3 + x3, oy3 + y3)
                    page.wait_for_timeout(2500)
                    up_xy = fr.evaluate("""() => { const vis=(e)=>!!(e&&e.offsetParent!==null);
                      const el = Array.from(document.querySelectorAll('*')).find(e => vis(e) && (e.innerText||'').trim() === '上传封面');
                      if (!el) return null; const b = el.getBoundingClientRect();
                      return Math.round(b.x+b.width/2)+','+Math.round(b.y+b.height/2); }""")
                    if up_xy:
                        off4 = fr.evaluate("() => { const fe = window.frameElement; const b = fe ? fe.getBoundingClientRect() : {x:0,y:0}; return Math.round(b.x)+','+Math.round(b.y); }")
                        ox4, oy4 = [int(v) for v in off4.split(',')]
                        x4, y4 = [int(v) for v in up_xy.split(',')]
                        with page.expect_file_chooser(timeout=12000) as fc:
                            page.mouse.click(ox4 + x4, oy4 + y4)
                        fc.value.set_files(a.cover)
                        log('⑥ ✅ 封面已上传')
                        page.wait_for_timeout(3000)
                        if click_by_text_cdp_any(page, '确认'):
                            log('⑥ ✅ 已点「确认」关封面弹窗')
                    else:
                        log('⑥ ⚠️ 未找到「上传封面」')
                else:
                    log('⑥ ⚠️ 未找到封面「编辑」按钮')
            except Exception as e:
                log('⑥ 封面失败: ' + str(e)[:70])
        page.wait_for_timeout(1500)

        if a.no_publish:
            log('--no-publish：跳过发表（测试模式）')
            print(json.dumps({'success': True, 'url': page.url, 'dryRun': True}))
            return

        # ── 发表（★CDP 穿透点击——frame.evaluate 自算坐标会偏）──
        ok = click_by_text_cdp_any(page, '发表')
        log('⑦ 发表点击 → ' + str(ok))
        done = False
        for i in range(10):
            page.wait_for_timeout(3000)
            u = page.url
            if '/post/create' not in u:
                log('⑦ ✅ 页面跳转（发表成功）: ' + u[:70]); done = True; break
            try:
                fr2 = frame_of(page)
                t = fr2.evaluate("() => (document.body.innerText||'').slice(0,300)")
            except Exception:
                t = ''
            if any(k in t for k in ['发表成功', '已提交', '审核']):
                log('⑦ ✅ 发表成功迹象'); done = True; break
        print(json.dumps({'success': done, 'url': page.url}))

main()
