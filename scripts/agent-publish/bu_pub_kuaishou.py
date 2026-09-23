#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
快手发布（确定性脚本——逻辑参考 electron/fp-templates/kuaishou-publish.js）
流程: 导航 → 移除新手引导遮罩 → 上传(点按钮触发 filechooser) → 等上传完成
      → 填内容(标题+描述+话题合并进一个内容框；话题最多3个) → 封面(best-effort) → 发布(两步)
用法: python bu_pub_kuaishou.py --video <path> --title <t> --topics <t> [--cover <path>] [--no-publish] [--only-cover]
"""
import sys, os, re, time, argparse, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
# ★TITLE_LIMIT_V1（2026-09-23 用户定稿）：标题统一 ≤15 字（视频号 ≤16）—— 唯一真源见 _title.py
from _title import clamp_title          # noqa: E402
from playwright.sync_api import sync_playwright
try:
    from _cdp_click import cdp_click_text
except Exception:
    cdp_click_text = None

PUB_URL = 'https://cp.kuaishou.com/article/publish/video'
CDP = 'http://127.0.0.1:9222'

def connect_cdp(pw, tries=15, gap=2, log=print):
    """★2026-09-12: 等登记浏览器(9222)就绪再连——客户端刚 spawn Chrome 时端口还没监听，
    原来脚本一启动就 connect → ECONNREFUSED → 1 秒内崩（客户端日志 code=1 Traceback）"""
    import time as _t
    last = None
    for i in range(tries):
        try:
            return pw.chromium.connect_over_cdp(CDP)
        except Exception as e:
            last = e
            if i == 0:
                log('  等登记浏览器(9222)就绪…')
            _t.sleep(gap)
    raise RuntimeError('连不上登记浏览器(9222)，等了 %ds：%s' % (tries * gap, str(last)[:90]))



def log(m):
    print('[PUB] ' + str(m), flush=True)


def vis(page, sel):
    try:
        return page.evaluate("(s) => { const e = document.querySelector(s); if (!e) return false; const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; }", sel)
    except Exception:
        return False


def kill_joyride(page):
    """快手新手引导遮罩会拦截所有点击——必须移除"""
    try:
        n = page.evaluate("() => { const ns = document.querySelectorAll('.react-joyride__overlay,.react-joyride__spotlight,.react-joyride__tooltip,.react-joyride__beacon'); ns.forEach(e => e.remove()); return ns.length; }")
        if n:
            log('  已移除新手引导遮罩 x' + str(n))
    except Exception:
        pass


def body(page):
    try:
        return page.inner_text('body')[:5000]
    except Exception:
        return ''


def logged_in(page):
    """★LOGIN_HONEST_V1（2026-09-17 用户实测）：登录态失效必须【明确报未登录】，不得误报 OK。
       旧逻辑：URL 不跳登录页 + 页面没出现"扫码登录"字样 → 直接 return True。
       实测坑：登录态失效时页面可能停在 cp.kuaishou.com 且【页面刚好没渲染完】，
       文本里既没有"扫码登录"、又恰好含有"发布"字样 → 被判"已登录" →
       后面所有步骤"假成功"，直到用户以为脚本坏了（本次排查就绕了一圈）。
       新逻辑：① URL 跳登录页 → False
               ② 等页面出现实质内容（最多 6 秒）；始终空白 → 不敢确认 → False
               ③ 出现登录文案 → False
               ④ 页面明确含"上传"或"发布"字样 → True
               ⑤ 其余（无法确认）→ False，宁可让用户去登录，也不假报 OK"""
    try:
        u = page.url or ''
    except Exception:
        u = ''
    if 'passport.kuaishou.com' in u or '/login' in u:
        return False
    t = ''
    for _ in range(6):
        t = body(page)
        if t and len(t.strip()) > 40:
            break
        try:
            page.wait_for_timeout(1000)
        except Exception:
            break
    if not t or len(t.strip()) < 40:
        return False                      # 页面空白/未渲染 → 不能确认已登录
    if ('扫码登录' in t or '密码登录' in t or '机构服务' in t):
        return False
    return ('上传' in t) or ('发布' in t)


def click_text(page, texts, what=''):
    for t in texts:
        try:
            loc = page.get_by_text(t, exact=True)
            if loc.count() > 0 and loc.first.is_visible():
                loc.first.click(timeout=4000)
                log('  已点「%s」%s' % (t, what))
                return True
        except Exception:
            continue
    return False


def find_page(ctx):
    for x in ctx.pages:
        if 'cp.kuaishou.com' in x.url or 'kuaishou.com' in x.url:
            return x
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--video', required=True)
    ap.add_argument('--title', default='')
    ap.add_argument('--topics', default='')
    ap.add_argument('--cover', default='')
    ap.add_argument('--no-publish', action='store_true')
    ap.add_argument('--skips', default='', help='跳过步骤（逗号分隔）：标题,话题,封面')
    ap.add_argument('--only-cover', action='store_true')
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
        ctx = b.contexts[0]
        page = find_page(ctx) or ctx.new_page()
        page.bring_to_front()
        log('URL=' + page.url[:90])
        if 'publish/video' not in page.url:
            page.goto(PUB_URL, wait_until='domcontentloaded', timeout=40000)
            page.wait_for_timeout(4000)
        kill_joyride(page)
        if not logged_in(page):
            log('未登录（快手登录态不在）——请先在登记浏览器里登录快手')
            print(json.dumps({'success': False, 'result': '快手未登录'}))
            return
        log('登录态 OK')
        up = False
        t0 = body(page)
        if (not a.only_cover) and ('上传中' in t0 or '上传完成' in t0 or vis(page, 'video')):
            up = True
            log('页面已有视频 → 跳过上传')
        if (not up) and (not a.only_cover):
            trig = None
            for t in ['上传视频', '选择视频', '点击上传', '上传']:
                try:
                    loc = page.get_by_text(t, exact=True)
                    if loc.count() > 0 and loc.first.is_visible():
                        trig = loc.first
                        break
                except Exception:
                    continue
            if trig:
                try:
                    with page.expect_file_chooser(timeout=8000) as fc:
                        trig.click(timeout=5000)
                    fc.value.set_files(a.video)
                    up = True
                    log('视频已设置(点击按钮→文件框)')
                except Exception as e:
                    log('  按钮触发文件框失败: ' + str(e)[:70])
            if not up:
                fi = page.query_selector('input[type=file][accept*="video"]') or page.query_selector('input[type=file]')
                if fi:
                    try:
                        fi.set_input_files(a.video)
                        up = True
                        log('视频已设置(file input)')
                    except Exception as e:
                        log('  input 设置失败: ' + str(e)[:60])
        if (not up) and (not a.only_cover):
            log('上传入口未找到')
            print(json.dumps({'success': False, 'result': '未找到上传入口'}))
            return
        page.wait_for_timeout(2000)
        ready = a.only_cover
        for i in range(80):
            if ready:
                break
            page.wait_for_timeout(3000)
            kill_joyride(page)
            t = body(page)
            if '上传失败' in t or '上传出错' in t:
                log('视频上传失败')
                print(json.dumps({'success': False, 'result': '视频上传失败'}))
                return
            still = ('上传中' in t)
            has_form = ('填写作品' in t or '作品描述' in t or '发布设置' in t or '作品标题' in t)
            if (not still) and has_form:
                ready = True
                log('编辑页就绪 用时 %ds' % ((i + 1) * 3))
                break
            if i % 5 == 0:
                log('  [%ds] 上传中=%s 表单=%s' % ((i + 1) * 3, still, has_form))
        if not ready:
            log('等待超时——继续尝试')
        page.wait_for_timeout(3000)
        kill_joyride(page)
        if not a.only_cover and not (SK_TITLE and SK_TOPIC):
            desc = None
            for s in ['textarea[placeholder*="简介"]', 'textarea[placeholder*="描述"]', 'textarea[placeholder*="介绍"]', 'div[contenteditable="true"]']:
                el = page.query_selector(s)
                if el and vis(page, s):
                    desc = el
                    log('  内容框 = ' + s)
                    break
            if not desc:
                log('未找到内容输入框')
            else:
                try:
                    desc.click(timeout=3000)
                except Exception:
                    pass
                page.wait_for_timeout(400)
                txt = clamp_title(a.title, 'kuaishou')   # ★TITLE_LIMIT_V1：≤15 字（原 TITLE16）
                is_ta = False
                try:
                    is_ta = page.evaluate("(e) => e.tagName === 'TEXTAREA'", desc)
                except Exception:
                    pass
                if txt:
                    try:
                        if is_ta:
                            desc.fill(txt)
                        else:
                            page.keyboard.type(txt, delay=30)
                        log('标题已填: ' + txt[:30])
                        page.wait_for_timeout(2000)   # ★2026-09-12 步间延时
                    except Exception as e:
                        log('  标题填写失败: ' + str(e)[:60])
                tps = [x for x in re.split(r'[\s,，#]+', (a.topics or '').strip()) if x][:3]
                if tps:
                    try:
                        page.keyboard.press('End')
                        page.keyboard.type(' ', delay=10)
                        for t in tps:
                            page.keyboard.type('#' + t + ' ', delay=40)
                            page.wait_for_timeout(400)
                        log('话题已填(最多3): ' + ' '.join('#' + t for t in tps))
                    except Exception as e:
                        log('  话题填写失败: ' + str(e)[:60])
                # ★KS_FILL_VERIFY_V1（2026-09-23 用户实测反馈"标题什么都没输入 就放草稿了"）：
                #   快手在【视频上传完成前后会重渲染表单】—— 脚本填进去的内容可能被平台清掉，
                #   而脚本当时确实打出了"标题已填"（它没撒谎，是之后被清了）。
                #   现在【填完必须复验】：读回内容框，标题不在里面就重填（最多 3 次），
                #   并把每次结果写进日志 —— 这样"到底填进去没有"有据可查，不再靠猜。
                if txt:
                    try:
                        for _chk in range(3):
                            page.wait_for_timeout(1200)
                            _got = ''
                            try:
                                _got = str(page.evaluate("(e) => (e.innerText || e.value || '')", desc) or '')
                            except Exception:
                                _got = ''
                            _g = _got.replace('\n', ' ').replace(' ', '')
                            _w2 = txt.replace(' ', '')
                            if _w2 and (_w2[:8] in _g):
                                log('✅ 内容框复验通过：标题确实在里面（第 %d 次检查）' % (_chk + 1))
                                break
                            log('⚠️ 内容框里读不到标题（第 %d 次）→ 重新找框并重填' % (_chk + 1))
                            # 重渲染后旧句柄可能失效 → 重新找一次内容框
                            _d2 = None
                            for _s in ['div[contenteditable="true"]', 'textarea[placeholder*="简介"]',
                                       'textarea[placeholder*="描述"]', 'textarea[placeholder*="介绍"]']:
                                _e2 = page.query_selector(_s)
                                if _e2 and vis(page, _s):
                                    _d2 = _e2
                                    break
                            if _d2 is None:
                                log('  没找到内容框（页面可能正在跳转）→ 停止重填')
                                break
                            desc = _d2
                            try:
                                is_ta = bool(page.evaluate("(e) => e.tagName === 'TEXTAREA'", desc))
                            except Exception:
                                pass
                            try:
                                desc.click(timeout=3000)
                                page.keyboard.press('Control+A')
                                page.wait_for_timeout(150)
                                if is_ta:
                                    desc.fill(txt)
                                else:
                                    page.keyboard.type(txt, delay=30)
                                log('  已重填标题')
                            except Exception as _e4:
                                log('  重填失败: ' + str(_e4)[:60])
                        else:
                            log('⚠️ 标题复验 3 次都没通过 —— 内容可能被平台重渲染清空（继续发布，发布后请在平台核对标题）')
                    except Exception as _e5:
                        log('  内容复验异常（忽略）: ' + str(_e5)[:60])
            page.wait_for_timeout(1500)
        if SK_COVER:
            log('封面——用户勾掉，跳过（用平台默认）')
        elif a.cover and os.path.exists(a.cover):
            # ★2026-09-12 快手封面（2026-09 版）：封面区在【第 1 步·作品信息】里
            #   结构：_high-cover-editor-wrapper → _pk-upload(PK封面上传区) + _default-cover + _recommend-cover
            #   封面文件框 = input[type=file][accept*="image"]（隐藏，可直接灌）
            ck = False
            # ★★ 2026-09-13 用户定的规则：先找 PK 封面 → 有就打开 → 再上传
            #    已开就直接上传【绝不点】（点了会关掉，用户明确提醒）
            try:
                sw = page.query_selector('.ant-switch')
                if sw:
                    _cls = str(sw.get_attribute('class') or '')
                    if 'ant-switch-checked' in _cls:
                        log('PK封面：已是开 → 直接上传（不点开关）')
                    else:
                        _bb = sw.bounding_box()
                        if _bb:
                            page.mouse.move(_bb['x'] + _bb['width'] / 2, _bb['y'] + _bb['height'] / 2)
                            page.wait_for_timeout(300)
                            page.mouse.click(_bb['x'] + _bb['width'] / 2, _bb['y'] + _bb['height'] / 2)
                            page.wait_for_timeout(2500)
                            log('PK封面：已打开 ✅（再上传）')
                else:
                    log('PK封面：未找到开关（跳过）')
            except Exception as e:
                log('  PK 开关处理失败: ' + str(e)[:60])
            try:
                fi = page.query_selector('input[type=file][accept*="image"]')
                if fi:
                    fi.set_input_files(a.cover)
                    ck = True
                    log('封面已上传(image input 直传)')
            except Exception as e:
                log('  image input 直传失败: ' + str(e)[:60])
            if not ck:
                try:
                    el = page.query_selector('[class*="_pk-upload"]') or page.query_selector('[class*="cover-full-editor"]')
                    if el:
                        el.scroll_into_view_if_needed()
                        page.wait_for_timeout(600)
                        with page.expect_file_chooser(timeout=8000) as fc:
                            el.click(timeout=4000)
                        fc.value.set_files(a.cover)
                        ck = True
                        log('封面已上传(点 PK封面区→文件框)')
                except Exception as e:
                    log('  点 PK 封面区失败: ' + str(e)[:60])
            if ck:
                page.wait_for_timeout(2500)
                click_text(page, ['完成', '确定', '保存'], '（封面确认）')
            else:
                log('未找到封面入口 → 平台默认')
        else:
            log('无自定义封面 → 平台默认')
        if a.no_publish or a.only_cover:
            log('跳过发布（测试模式）')
            print(json.dumps({'success': True, 'result': '已填完（未发布）'}))
            return
        # ═══ ★KS_PUBLISH_BTN_FIX_V1（2026-09-18 本机 dump 页面抓到的真凶）═══
        #   实测页面按钮清单：
        #     · 「立即发布」(295,1092) = ant-radio-wrapper 【发布时间选项的 radio】，不是按钮！
        #     · 「定时发布」(398,1092) = 另一个 radio
        #     · 「发布」  (212,1207) = _button_primary  ← ★【真正的发布按钮】
        #     · 页面上【从来没有】「确认发布」这个按钮
        #   旧代码：先点「立即发布」(radio) → 再找「确认发布」→ 永远找不到 → 判失败（= 不点发布）。
        #   现在：① 确保选中「立即发布」radio（默认已选，失败也不影响）
        #         ② 点真正的「发布」按钮（精确匹配 + CDP 穿透兜底）
        #         ③ 不再找「确认发布」
        try:
            loc = page.get_by_text('立即发布', exact=True)
            if loc.count() > 0:
                try:
                    loc.first.click(timeout=2000)
                    log('已选「立即发布」选项（发布时间）')
                except Exception:
                    pass
        except Exception:
            pass
        page.wait_for_timeout(1200)

        # ═══ ★KS_PUB_VERIFY_V1（2026-09-23 用户定稿）═══
        #   旧代码两个问题，用户实测直接踩到：
        #     ① 【元组没解包】：cdp_click_text 返回的是 (ok, msg)，旧代码 `ok1 = cdp_click_text(...)`
        #        把【元组】赋给了 ok1 —— 非空元组恒为真 → "if not ok1" 永远不成立 →
        #        等于【完全没校验】点没点中。
        #     ② 【不校验结果就报成功】：点了之后只等 8 秒看一眼，看不到成功迹象也照样
        #        success=True（"已执行发布，请手动确认"）→ Agent 侧当成功。
        #   现在：① 元组正确解包（兼容返回 bool 的老版本）；② 点完【轮询校验】，
        #        区分"成功迹象 / 失败提示 / 看不出来"三种，如实回报，不再谎报。
        # ═══ ★KS_PUBLISH_WAIT_V1（2026-09-23 用户实测"没点中却报发布成功"）═══
        #   实测证据（日志 17:15:39→17:16:18）：
        #     脚本填完标题后 7 秒就去找「发布」→「CDP 穿透找到 <*> "发布" → 0 个」——
        #     那一刻页面上【根本还没有这个按钮】（视频还在上传／表单还没渲染完，甚至页面正在跳转）；
        #     旧代码【只尝试一次】就放弃 → 没点中 → 之后页面自己跳到作品管理页（草稿），
        #     而旧校验【只看 URL 里有没有 /article/manage】→ 于是报了"发布成功"（假成功）。
        #   现在两处都改：
        #     ① 【等按钮出现再点】：轮询最多 90 秒，确认页面上真出现了「发布」再点（连试 3 次）。
        #        注意：快手真正的「发布」是个 DIV（class=_button_3a3lq_1 _button-primary_3a3lq_60），
        #        不是 <button>，所以点击必须用 tag='' 的穿透点击（实测能定位到）。
        #     ② 【只有真的点中了，才去校验成功】：ok=False → 直接如实报失败，不再看 URL 编成功。
        _url_before = page.url
        ok1 = False
        _t0 = time.time()
        _JS_HAS_PUB = ("() => { const t = (e) => (e.innerText || '').replace(/\\s+/g, '').trim();"
                       " return [...document.querySelectorAll('div,button,span,a')].some((e) => {"
                       " const r = e.getBoundingClientRect();"
                       " return r.width > 0 && r.height > 0 && t(e) === '发布'; }); }")
        while time.time() - _t0 < 90:
            try:
                if page.evaluate(_JS_HAS_PUB):
                    break
            except Exception:
                pass
            _w = int(time.time() - _t0)
            if _w and _w % 10 < 3:
                log('  还在等「发布」按钮出现（已等 %ds）—— 视频可能还在上传；等它出来再点' % _w)
            page.wait_for_timeout(2000)
        _wait_s = int(time.time() - _t0)
        if _wait_s >= 3:
            log('  「发布」按钮已出现（等了 %ds）' % _wait_s)

        for _try in range(3):
            if cdp_click_text:
                try:
                    _r = cdp_click_text(page, '发布', tag='', log=log, exact=True, prefer_bottom_right=True)
                    if isinstance(_r, tuple):
                        ok1 = bool(_r[0])
                        log('CDP 穿透点「发布」→ ok=%s msg=%s' % (_r[0], str(_r[1])[:70] if len(_r) > 1 else ''))
                    else:
                        ok1 = bool(_r)
                except Exception as e2:
                    log('CDP 点「发布」异常: ' + str(e2)[:60])
            if not ok1:
                try:
                    ok1 = bool(click_text(page, ['发布'], '（发布按钮）'))
                except Exception as e1:
                    log('文本点「发布」异常: ' + str(e1)[:60])
            if ok1:
                break
            log('  第 %d 次没点中 → 等 3 秒再试' % (_try + 1))
            page.wait_for_timeout(3000)
        log('发布点击结果: ok=%s（true=点中了，false=没点中）' % ok1)

        # 点击后校验（最多 20 秒）：成功了没？还是弹了失败提示？
        _succ = ['发布成功', '已发布', '审核中', '作品管理', '发布完成']
        _failw = ['发布失败', '提交失败', '请重试', '上传失败', '违规', '封面异常']
        verified = False
        fail_word = ''
        draft_hint = ''
        if ok1:      # ★只有点中了才校验（没点中 → 直接失败，绝不再看 URL 编成功）
            for _i in range(10):          # 10 × 2s = 20s
                page.wait_for_timeout(2000)
                kill_joyride(page)
                t = body(page)
                for w in _failw:
                    if w in t:
                        fail_word = w
                        break
                if fail_word:
                    break
                _url_now = page.url
                # URL 判据收紧：必须是【点了之后才发生的跳转】（防止"用户自己翻到管理页"被当成成功）
                _moved = (_url_now != _url_before) and (('/publish' in _url_before and '/publish' not in _url_now)
                                                       or '/article/manage' in _url_now)
                if _moved or any(w in t for w in _succ):
                    verified = True
                    break
                if '草稿' in t:
                    draft_hint = '页面出现「草稿」字样'
        if verified:
            log('✅ 发布成功（已校验）URL=' + page.url)
            print(json.dumps({'success': True, 'result': '已发布到快手', 'url': page.url}))
        elif fail_word:
            log('❌ 发布失败（页面提示：%s）' % fail_word)
            print(json.dumps({'success': False, 'result': '发布失败（页面提示：%s）—— 请人工处理后重试' % fail_word, 'url': page.url}))
        elif not ok1:
            log('❌ 没点中「发布」按钮（等了 %ds 之后仍未点中）URL=%s' % (_wait_s, page.url))
            print(json.dumps({'success': False, 'result': '没点中「发布」按钮（等了 %d 秒仍未出现/点不动）—— 内容还在页面上，请人工确认后重试' % _wait_s, 'url': page.url}))
        else:
            log('❌ 已点发布但未检测到成功结果（%s）URL=%s' % (draft_hint or '未见成功提示', page.url))
            print(json.dumps({'success': False, 'result': '已点发布但未检测到成功结果%s，请人工确认后再重试（避免重复发布）' % (('（' + draft_hint + '）' if draft_hint else '')), 'url': page.url}))


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        log('异常: ' + str(e)[:150])
        print(json.dumps({'success': False, 'result': str(e)[:200]}))
