# -*- coding: utf-8 -*-
"""AGENT 微博发布执行器（2026-09-10 手动逐步跑通后固化）
跑通的 9 步（每步都验证过）：
  1) 页面必须锁定 weibo.com/upload/channel（视频发布页）——绝不在首页发布框操作
  2) 若没有视频页：从首页点工具栏「视频」按钮 → 会新开标签页
  3) 点【真按钮】button「上传视频」→ 系统文件框 → setFiles
  4) 等「上传完成」
  5) 点「原创」→ 校验 radio 选中
  6) 点「标题」区域 → 出现 input[type=text] → fill → 校验 value
  7) 点「上传封面」→ 文件框 → setFiles → 弹窗点「完成」关闭
  8) 正文 textarea（placeholder 含"新鲜事"）→ fill 话题 → 校验 value
  9) 点「发布」→ 校验出现「已上传成功/将在转码后发布」
注意：分类「请选择合适的频道」不必选（发布按钮仍可用）；微博无 iframe、正文是 textarea。
用法: python bu_pub_weibo.py --video <p> --title <t> --topics <t> [--cover <p>] [--no-publish]
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

URL = 'https://weibo.com/upload/channel'
HOME = 'https://weibo.com/'



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

def valid(page):
    try:
        return 'upload/channel' in page.url or '上传视频' in page.inner_text('body')[:800]
    except Exception:
        return False

def pick_video_page(ctx, page_hint=None):
    """严格选【视频发布页】：优先已有编辑区的 → 任意视频页 → 从首页点「视频」新开"""
    for pg in ctx.pages:
        if 'upload/channel' not in pg.url:
            continue
        try:
            if '类型' in pg.inner_text('body')[:1500]:
                return pg, '已有编辑区'
        except Exception:
            continue
    for pg in ctx.pages:
        if 'upload/channel' in pg.url:
            return pg, '空白视频页'
    # 没有视频页 → 找首页点「视频」按钮新开
    for pg in ctx.pages:
        try:
            if 'weibo.com' in pg.url and 'upload' not in pg.url:
                pg.bring_to_front()
                loc = pg.get_by_text('视频', exact=True)
                n = loc.count()
                for i in range(min(n, 5)):
                    try:
                        el = loc.nth(i)
                        box = el.bounding_box()
                        # 工具栏的「视频」在页面上方（y<300）
                        if box and box['y'] < 300:
                            before = len(ctx.pages)
                            el.click(timeout=4000)
                            for _ in range(6):
                                pg.wait_for_timeout(1000)
                                if len(ctx.pages) > before:
                                    return ctx.pages[-1], '点「视频」新开'
                            break
                    except Exception:
                        continue
        except Exception:
            continue
    return None, '未找到/未能打开视频页'

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
        b = connect_cdp(pw, log=log)
        ctx = b.contexts[0] if b.contexts else b.new_context()
        page, how = pick_video_page(ctx)
        if page is None:
            # 兜底：新开页并导航
            page = ctx.new_page()
            page.goto(URL, wait_until='domcontentloaded', timeout=30000)
            how = '新页导航'
        page.bring_to_front()
        log('① 页面=%s（%s）' % (page.url, how))

        # ── ② 上传视频（已有编辑区则跳过）──
        has_editor = False
        try:
            body0 = page.inner_text('body')[:800]
            has_editor = ('类型' in body0 and '标题' in body0)
        except Exception:
            pass
        if has_editor:
            log('② 已有视频/编辑区 → 跳过上传')
        else:
            up = False
            try:
                with page.expect_file_chooser(timeout=12000) as fc:
                    page.locator('button:has-text("上传视频")').first.click(timeout=8000)
                fc.value.set_files(a.video)
                up = True
                log('② ✅ 已点「上传视频」真按钮 → 选文件')
            except Exception as e:
                log('② 真按钮失败（' + str(e)[:50] + '）→ file input 兜底')
            if not up:
                fi = page.query_selector('input[type="file"]')
                if fi:
                    fi.set_input_files(a.video, timeout=60000)
                    log('② ✅ file input 兜底上传')
        # 等编辑区
        t0 = time.time()
        while time.time() - t0 < 240:
            page.wait_for_timeout(3000)
            try:
                bd = page.inner_text('body')[:800]
            except Exception:
                bd = ''
            if '类型' in bd and '标题' in bd:
                break
        log('③ 编辑区就绪 用时 %ds' % int(time.time() - t0))

        # ── ④ 类型：原创（校验 radio）──
        try:
            page.get_by_text('原创', exact=True).first.click(timeout=5000)
            page.wait_for_timeout(800)
            ok = page.evaluate("""() => { const rs = Array.from(document.querySelectorAll('input[type=radio]')); return rs.length ? rs[0].checked : false; }""")
            log('④ 类型=原创（radio checked=%s）' % ok)
        except Exception as e:
            log('④ 类型选择失败: ' + str(e)[:60])

        # ── ⑤ 标题（点「标题」→ input[type=text] → 校验 value）──
        if a.title:
            try:
                page.get_by_text('标题', exact=True).first.click(timeout=5000)
                page.wait_for_timeout(1000)
                el = page.locator('input[type="text"]').first
                el.click(timeout=4000)
                el.fill(a.title[:30])
                page.wait_for_timeout(600)
                v = page.evaluate("""() => { const i = document.querySelector('input[type=text]'); return i ? i.value : null; }""")
                log('⑤ 标题已填（value=%s）' % repr(v))
            except Exception as e:
                log('⑤ 标题失败: ' + str(e)[:60])

        # ── ⑥ 封面（上传 → 点「完成」关弹窗）──
        if a.cover and os.path.exists(a.cover):
            try:
                with page.expect_file_chooser(timeout=10000) as fc:
                    page.get_by_text('上传封面', exact=True).first.click(timeout=6000)
                fc.value.set_files(a.cover)
                page.wait_for_timeout(4000)
                done = False
                for t in ['完成', '确定', '保存']:
                    try:
                        loc = page.get_by_text(t, exact=True)
                        if loc.count() > 0 and loc.first.is_visible():
                            loc.first.click(timeout=4000); done = True
                            log('⑥ 封面已上传 + 点「%s」关弹窗' % t); break
                    except Exception:
                        continue
                if not done:
                    log('⑥ ⚠️ 封面已上传但未找到「完成」')
            except Exception as e:
                log('⑥ 封面失败: ' + str(e)[:60])
        else:
            log('⑥ 无自定义封面 → 用平台截帧')

        # ── ⑦ 话题（正文 textarea → 校验 value）──
        if a.topics:
            try:
                ta = page.locator('textarea').last
                ta.fill(a.topics, timeout=8000)
                page.wait_for_timeout(600)
                v = page.evaluate("""() => { const t = document.querySelectorAll('textarea'); return t.length ? t[t.length-1].value : null; }""")
                log('⑦ 话题已填（value=%s）' % repr(v))
            except Exception as e:
                log('⑦ 话题失败: ' + str(e)[:60])

        # ── 发布按钮状态 ──
        st = page.evaluate("""() => { const b = Array.from(document.querySelectorAll('button')).find(e => /发布/.test((e.innerText||'').trim())); return b ? !!b.disabled : null; }""")
        log('⑧ 发布按钮 disabled=' + str(st))

        if a.no_publish:
            log('--no-publish：跳过发布（测试模式）')
            print(json.dumps({'success': True, 'url': page.url, 'dryRun': True}))
            return

        # ── ⑨ 发布 + 校验 ──
        try:
            page.locator('button:has-text("发布")').first.click(timeout=8000)
            log('⑨ ✅ 已点「发布」(locator)')
        except Exception as e:
            log('⑨ locator 点击失败（试 CDP 穿透）: ' + str(e)[:60])
            if cdp_click_text is not None:
                try:
                    _ok, _msg = cdp_click_text(page, '发布', tag='button', log=log, exact=True, prefer_bottom_right=True)
                    log('⑨ CDP 穿透点「发布」→ %s (%s)' % (_ok, _msg))
                except Exception as e2:
                    log('⑨ ❌ CDP 也失败: ' + str(e2)[:60])
        ok_pub = False
        for i in range(9):
            page.wait_for_timeout(3000)
            try:
                bd = page.inner_text('body')[:600]
            except Exception:
                bd = ''
            if any(k in bd for k in ['已上传成功', '将在转码后发布', '发布成功', '再发一条视频']):
                log('⑨ ✅ 发布成功迹象（%ds）' % ((i + 1) * 3)); ok_pub = True; break
        print(json.dumps({'success': ok_pub, 'url': page.url}))

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
