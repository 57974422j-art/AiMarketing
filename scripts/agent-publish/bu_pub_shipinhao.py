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
    ap.add_argument('--skips', default='', help='跳过步骤（逗号分隔）：标题,话题,封面')
    a = ap.parse_args()
    log('视频=' + a.video + ' 标题=' + (a.title or '(无)') + ' 封面=' + (a.cover or '(无)'))

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
        # ★★ 2026-09-13 登录态检测（用户实测：登录态丢时页面=login.html，导致后面每步都"假成功"）
        try:
            page.wait_for_timeout(1500)
            _u = page.url
            if 'login' in _u or 'login.html' in _u:
                log('❌ 视频号【未登录】（页面=' + _u[:70] + '）——请在登记浏览器里重新扫码登录视频号')
                print(json.dumps({'success': False, 'result': '视频号未登录（页面跳到了登录页），请先在登记浏览器登录视频号'}))
                return
            _t = ''
            try: _t = page.inner_text('body')[:300]
            except Exception: pass
            if '扫码登录' in _t or '请使用微信扫码' in _t:
                log('❌ 视频号【未登录】（页面显示扫码登录）')
                print(json.dumps({'success': False, 'result': '视频号未登录（显示扫码登录），请先登录'}))
                return
            log('✅ 登录态 OK')
        except Exception as e:
            log('  登录态检测异常（继续）: ' + str(e)[:60])
        log('① 页面=' + page.url)

        # ── 上传视频（★2026-09-12 改用 locator：视频号页面会重渲染，旧 handle 会 detached，
        #    报 "Cannot set input files to detached element"；locator 每次操作前自动重新解析，不怕 detached）──
        up_ok = False
        for f in page.frames:
            try:
                loc = f.locator('input[type="file"][accept*="video"]').first
                if loc.count() == 0:
                    continue
                loc.set_input_files(a.video, timeout=15000)
                up_ok = True
                log('② ✅ 视频已设置（locator，frame=' + str(f.url[:48]) + '）')
                break
            except Exception as e:
                log('  该 frame 上传失败: ' + str(e)[:60])
                continue
        if not up_ok:
            # 兜底：旧方式（frame + handle），每次重新查找
            for _try in range(4):
                page.wait_for_timeout(1500)
                f2, el2 = find_frame_input(page, 'video')
                if el2 is None:
                    continue
                try:
                    el2.set_input_files(a.video)
                    up_ok = True
                    log('② ✅ 视频已设置（重试 %d 次成功）' % (_try + 1))
                    break
                except Exception as e:
                    log('  重试 %d 失败: %s' % (_try + 1, str(e)[:50]))
        if not up_ok:
            log('② ❌ 未能设置视频 file input（frame 遍历 + 重试都失败）')
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
        if SK_TOPIC:
            log('④ 描述(话题)——用户勾掉，跳过')
        elif a.topics:
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
                    page.wait_for_timeout(2000)   # ★2026-09-12 步间延时
                else:
                    log('④ ⚠️ 未找到描述框(.input-editor)')
            except Exception as e:
                log('④ 描述失败: ' + str(e)[:70])
        # ── 短标题 ──
        if SK_TITLE:
            log('⑤ 短标题——用户勾掉，跳过')
        elif a.title:
            try:
                xy2 = fr.evaluate("""() => { const i = document.querySelector('input[placeholder*="短标题"]'); if (!i) return null; i.scrollIntoView({block:'center'}); const b = i.getBoundingClientRect(); return Math.round(b.x+40)+','+Math.round(b.y+b.height/2); }""")
                if xy2:
                    off2 = fr.evaluate("() => { const fe = window.frameElement; const b = fe ? fe.getBoundingClientRect() : {x:0,y:0}; return Math.round(b.x)+','+Math.round(b.y); }")
                    ox2, oy2 = [int(v) for v in off2.split(',')]
                    x2, y2 = [int(v) for v in xy2.split(',')]
                    page.mouse.click(ox2 + x2, oy2 + y2)
                    page.wait_for_timeout(400)
                    page.keyboard.type(a.title[:16], delay=25)
                    page.wait_for_timeout(600)
                    v2 = fr.evaluate("""() => { const i = document.querySelector('input[placeholder*="短标题"]'); return i ? i.value : null; }""")
                    log('⑤ 短标题已填（值=%s）' % repr(v2))
                    page.wait_for_timeout(2000)   # ★步间延时
                else:
                    log('⑤ ⚠️ 未找到短标题框')
            except Exception as e:
                log('⑤ 短标题失败: ' + str(e)[:70])

        # ── 封面（COVER_TWO_SLOTS_V1：视频号两个封面位都要传）──
        #   页面：封面预览 | 编辑 | 个人主页卡片 3:4 | 编辑 | 分享卡片 4:3
        #   原来只传一张 → 只进「分享卡片」，「个人主页卡片(3:4 竖)」空着（用户实测）
        if SK_COVER:
            log('⑥ 封面——用户勾掉，跳过（用平台默认）')
        elif a.cover and os.path.exists(a.cover):
            JS_EDIT_BTN = """(name) => {
              const vis = (e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
              let blk = null;
              document.querySelectorAll('div').forEach(e => {
                if (blk || !vis(e)) return;
                const t = (e.innerText || '').trim();
                if (t.length < 60 && t.indexOf(name) >= 0) blk = e;
              });
              if (!blk) return null;
              let btn = null;
              blk.querySelectorAll('*').forEach(e => {
                if (btn || !vis(e)) return;
                if ((e.innerText || '').trim() === '编辑') btn = e;
              });
              if (!btn) return null;
              const b = btn.getBoundingClientRect();
              return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) };
            }"""
            for _nm in ['个人主页卡片', '分享卡片']:
                hit = None
                for fr in page.frames:
                    try:
                        hit = fr.evaluate(JS_EDIT_BTN, _nm)
                    except Exception:
                        hit = None
                    if hit:
                        break
                if not hit:
                    log('⑥ %s：未找到「编辑」按钮（跳过）' % _nm)
                    continue
                try:
                    page.mouse.click(hit['x'], hit['y'])
                    log('⑥ %s：已点「编辑」(%d,%d)' % (_nm, hit['x'], hit['y']))
                except Exception as e:
                    log('⑥ %s：点「编辑」失败 %s' % (_nm, str(e)[:44]))
                    continue
                page.wait_for_timeout(2500)
                # 弹窗里直传 image input
                done = False
                for fr2 in page.frames:
                    try:
                        fi = fr2.query_selector('input[type=file][accept*="image"]')
                        if fi:
                            fi.set_input_files(a.cover)
                            done = True
                            break
                    except Exception as e:
                        log('   直传失败(%s): %s' % (_nm, str(e)[:40]))
                if done:
                    log('⑥ ✅ %s 封面已上传' % _nm)
                    page.wait_for_timeout(2500)
                    for t in ['确认', '完成', '确定']:
                        try:
                            loc = page.get_by_text(t, exact=True)
                            if loc.count() > 0 and loc.first.is_visible():
                                loc.first.click(timeout=3000)
                                log('   已点「%s」' % t)
                                break
                        except Exception:
                            continue
                    page.wait_for_timeout(2000)
                else:
                    log('⑥ ⚠️ %s 未找到上传入口' % _nm)
        else:
            log('⑥ 无自定义封面 → 平台默认')

        

# MAIN_ENTRY_V1（2026-09-14）：★原来这里【漏了 main() 调用】——
#   导致 python 执行本文件只做"定义"就退出：exit 0 / stdout&stderr 全空 / 不做任何事。
#   客户机日志表现：[走确定性脚本 bu_pub_shipinhao.py] 与 [脚本执行失败 code=0] 同一秒、无任何 [PUB] 输出。
if __name__ == '__main__':
    main()
