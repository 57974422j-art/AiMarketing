# -*- coding: utf-8 -*-
"""AGENT 微博发布执行器（2026-09-10 手动逐步跑通后固化）
跑通的 9 步（每步都验证过）：
  1) ★必须【从首页点「视频」进入上传页】（首页 → 点工具栏「视频」→ 微博自己跳到 /upload/channel）；
     ❌ 直接 goto /upload/channel 【不行】（无登录态/上下文）——2026-09-13 用户实测纠正
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

URL = 'https://weibo.com'   # HOME_CLICK_VIDEO_V7：入口就是首页（上传页必须由微博自己跳出来）
HOME = 'https://weibo.com/'

def log(m): print('[PUB] ' + str(m), flush=True)

def valid(page):
    try:
        return 'upload/channel' in page.url or '上传视频' in page.inner_text('body')[:800]
    except Exception:
        return False

def pick_video_page(ctx, page_hint=None):
    """VERIFIED_FLOW_V8（2026-09-13 手动验证成功的流程）
       首页 → 点发布框里「视频」的【图标】→ 微博自己新开 /upload/channel 标签页
       ★ 关键：点【图标】(x≈734,y≈208)，不是文字(≈220)——点文字无反应
       ★ 不能直接 goto /upload/channel（无登录态/上下文，用户实测不行）
    """
    # ① 已有带编辑区的上传页 → 直接用
    for pg in ctx.pages:
        if 'upload/channel' not in pg.url:
            continue
        try:
            if '类型' in pg.inner_text('body')[:1500]:
                return pg, '已有编辑区'
        except Exception:
            pass
    # ② ★从首页点「视频」图标 → 微博新开上传页
    home = None
    for pg in ctx.pages:
        if pg.url.rstrip('/') == 'https://weibo.com':
            home = pg
            break
    if home is None:
        home = ctx.new_page()
        home.goto(HOME, wait_until="domcontentloaded", timeout=40000)
        home.wait_for_timeout(6000)
    try:
        home.bring_to_front()
        home.wait_for_timeout(1500)
        before = len(ctx.pages)
        hit = home.evaluate("""() => {
          const vis = (e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
          const box = document.querySelector('[class*="_box_vkpry_"]');
          if (!box) return null;
          const kids = box.querySelectorAll("*");
          for (let i = 0; i < kids.length; i++) {
            const e = kids[i];
            if (!vis(e)) continue;
            if ((e.innerText || "").trim() === "视频") {
              const b = e.getBoundingClientRect();
              return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) };   // FIX_CENTER_V9：用元素中心（上次 b.y-6 点到 181 空）
            }
          }
          return null;
        }""")
        if hit:
            home.mouse.move(hit["x"], hit["y"])
            home.wait_for_timeout(400)
            home.mouse.click(hit["x"], hit["y"])
            log("  已点首页发布框「视频」图标(%d,%d)，等微博新开上传页…" % (hit["x"], hit["y"]))
        else:
            log("  ⚠️ 首页未找到发布框里的「视频」")
        home.wait_for_timeout(6000)
        if len(ctx.pages) > before:
            npg = ctx.pages[-1]
            try:
                npg.wait_for_timeout(2500)
            except Exception:
                pass
            return npg, "点「视频」新开"
        if 'upload/channel' in home.url:
            return home, "点「视频」当前页跳转"
    except Exception as e:
        log("  点「视频」失败: " + str(e)[:70])
    # ③ 兜底
    for pg in ctx.pages:
        if 'upload/channel' in pg.url:
            return pg, '兜底-任意上传页'
    return ctx.pages[0], "兜底-首页"


JS_UPLOAD_STATE = """() => {
  const NL = String.fromCharCode(10);
  const t = document.body.innerText || '';
  const vids = [];
  document.querySelectorAll('video').forEach(e => { try { vids.push(e.videoWidth); } catch (e2) {} });
  return {
    uploading: (t.indexOf('上传中') >= 0) || (t.indexOf('正在上传') >= 0) || (t.indexOf('处理中') >= 0),
    finished: (t.indexOf('上传完成') >= 0) || (t.indexOf('重新上传') >= 0) || (t.indexOf('设置封面') >= 0) || (t.indexOf('编辑封面') >= 0) || (t.indexOf('删除视频') >= 0),
    vw: vids.length ? Math.max.apply(null, vids) : 0,
    files: Array.from(document.querySelectorAll('input[type=file]')).length,
  };
}"""


def wait_video_ready(page, max_s=180, log=print):
    """WAIT_UPLOAD_V10：等视频【真上传完】——不能只看"编辑区出现"（长视频还在传）
    判定成功（任一）：① video.videoWidth > 0 且 无"上传中"  ② 出现"上传完成/重新上传/设置封面" 且 无"上传中"
    返回 True/False + 用时秒数
    """
    import time as _t
    t0 = _t.time()
    last = None
    while _t.time() - t0 < max_s:
        page.wait_for_timeout(3000)
        try:
            st = page.evaluate(JS_UPLOAD_STATE)
        except Exception as e:
            log('  等上传：页面探测失败 ' + str(e)[:50])
            continue
        last = st
        el = int(_t.time() - t0)
        if (not st['uploading']) and (st['vw'] > 0 or st['finished']):
            log('  ✅ 视频上传完成（%ds，videoWidth=%s finished=%s）' % (el, st['vw'], st['finished']))
            return True
        if el % 15 < 3:
            log('    等视频上传… %ds（上传中=%s videoWidth=%s）' % (el, st['uploading'], st['vw']))
    log('  ⚠️ 等上传超时 %ds（最后状态 %s）' % (max_s, last))
    return False


JS_COVER_STATE = """() => {
  const vis = (e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
  const NL = String.fromCharCode(10);
  const t = document.body.innerText || '';
  const imgs = Array.from(document.querySelectorAll('img')).filter(e => { try { return e.naturalWidth > 120 && vis(e); } catch (e2) { return false; } });
  return {
    coverImgs: imgs.length,
    uploadingWord: (t.indexOf('上传中') >= 0) || (t.indexOf('封面上传中') >= 0),
    okay: (t.indexOf('封面设置完成') >= 0) || (t.indexOf('更换封面') >= 0),
  };
}"""


def wait_cover_ready(page, max_s=60, log=print):
    """WAIT_UPLOAD_V10：封面上传后等【封面预览图出现】（naturalWidth>120），最多 60s"""
    import time as _t
    t0 = _t.time()
    base = None
    while _t.time() - t0 < max_s:
        page.wait_for_timeout(2500)
        try:
            st = page.evaluate(JS_COVER_STATE)
        except Exception:
            continue
        el = int(_t.time() - t0)
        if base is None:
            base = st['coverImgs']
        if (not st['uploadingWord']) and (st['okay'] or st['coverImgs'] > base):
            log('  ✅ 封面已就绪（%ds，预览图 %d→%d）' % (el, base, st['coverImgs']))
            return True
    log('  ⚠️ 等封面超时 %ds（用平台默认/先继续）' % max_s)
    return False

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
        page, how = pick_video_page(ctx)
        if page is None:
            # 兜底：新开页并导航
            page = ctx.new_page()
            page.goto(URL, wait_until='domcontentloaded', timeout=30000)
            how = '新页导航'
        page.bring_to_front()
        log('① 页面=%s（%s）' % (page.url, how))

        # ★LOGIN_HONEST_V1（2026-09-17 用户要求：登录失效必须明确报，哪个平台都要）：
        #   微博原来没有登录检测 —— 登录态失效时 pick_video_page 会兜底到首页，
        #   后面步骤"假成功"，用户看不出是登录掉了。这里明确判定并退出。
        try:
            _u = (page.url or '')
            _t = ''
            try:
                _t = page.inner_text('body')[:3000]
            except Exception:
                pass
            _nl = None
            if ('login' in _u.lower()) or ('passport' in _u.lower()):
                _nl = '页面跳到了登录页（' + _u[:70] + '）'
            else:
                for _kw in ('扫码登录', '立即登录', '登录/注册', '请先登录', '手机号登录'):
                    if _kw in _t:
                        _nl = '页面出现登录提示（' + _kw + '）'
                        break
            if _nl:
                log('❌ 微博【未登录】：' + _nl + ' —— 请在登记浏览器里重新登录微博')
                print(json.dumps({'success': False, 'result': '微博未登录（' + _nl + '），请先在登记浏览器登录微博'}))
                return
        except Exception:
            pass

        # ★ VERIFIED_FLOW_V8：优先用真按钮 button[id^=video_button_upload]（实测 882,432 一击成功）
        _done = False
        try:
            _btn = page.locator('button[id^="video_button_upload"]').first
            if _btn.count() > 0 and _btn.is_visible():
                with page.expect_file_chooser(timeout=15000) as _fc:
                    _btn.click(timeout=10000)
                _fc.value.set_files(a.video)
                _done = True
                log("② ✅ 点真按钮「上传视频」(id^=video_button_upload) → 文件框")
        except Exception as _e:
            log("  真按钮方式失败: " + str(_e)[:60])
        if _done:
            pass
        else:
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
                log('② ❌ 未找到「上传视频」真按钮（不再用图片 input 兜底，避免假成功）')
        # ★WAIT_UPLOAD_V10：等视频【真上传完】（不能只看编辑区出现——长视频还在传）
        #   判断：video.videoWidth>0 且 无「上传中」；或出现「上传完成/重新上传/设置封面」且无「上传中」
        _t_up = time.time()
        _ok_up = wait_video_ready(page, max_s=240, log=log)
        log('③ 上传阶段结束 用时 %ds（%s）' % (int(time.time() - _t_up), '成功' if _ok_up else '超时-继续'))
        page.wait_for_timeout(2000)   # 上传后稳一下再填内容
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
                el.fill(a.title[:16])
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

        # ★WAIT_UPLOAD_V10：等封面【真传完】（预览图 naturalWidth>120），最多 60s
        wait_cover_ready(page, max_s=60, log=log)
        page.wait_for_timeout(2000)   # 封面后稳一下（你要求的）

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
            log('⑨ ✅ 已点「发布」')
        except Exception as e:
            log('⑨ ❌ 发布点击失败: ' + str(e)[:70])
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

main()
