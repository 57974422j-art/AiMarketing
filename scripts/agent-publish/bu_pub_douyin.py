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
    ap.add_argument('--skips', default='', help='跳过步骤（逗号分隔）：标题,话题,封面')
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
        # 不在 upload 页则导航（保险）
        if 'content/upload' not in page.url:
            try:
                page.goto('https://creator.douyin.com/creator-micro/content/upload', wait_until='domcontentloaded', timeout=30000)
                log('已导航到上传页')
                page.wait_for_timeout(3000)
            except Exception as e: log('导航失败: ' + str(e)[:80])
        # ★LOGIN_HONEST_V1（2026-09-17 用户要求：登录失效必须明确报，哪个平台都要）：
        #   抖音原来【没有登录检测】→ 登录态失效时会继续往下跑、报一堆看不懂的错。
        #   这里明确判定：URL 跳登录页 或 页面出现登录提示 → 直接报"未登录"退出。
        try:
            _u = (page.url or '')
            _t = ''
            try:
                _t = page.inner_text('body')[:3000]
            except Exception:
                pass
            _notlogin = None
            if ('login' in _u.lower()) or ('passport' in _u.lower()):
                _notlogin = '页面跳到了登录页（' + _u[:70] + '）'
            else:
                for _kw in ('扫码登录', '密码登录', '登录后即可', '请先登录', '登录/注册', '手机号登录'):
                    if _kw in _t:
                        _notlogin = '页面出现登录提示（' + _kw + '）'
                        break
            if _notlogin:
                log('❌ 抖音【未登录】：' + _notlogin + ' —— 请在登记浏览器里重新登录抖音')
                print(json.dumps({'success': False, 'result': '抖音未登录（' + _notlogin + '），请先在登记浏览器登录抖音'}))
                return
        except Exception:
            pass

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
        if SK_TITLE:
            log('③ 标题——用户勾掉，跳过（用平台默认）')
        elif a.title:
            for sel in ['input[placeholder*="作品标题"]', 'input[placeholder*="填写作品标题"]', 'input[placeholder*="标题"]']:
                el = visible(page, sel)
                if el:
                    try:
                        el.click(); el.fill(a.title); log('✅ 标题已填: ' + a.title[:16]); page.wait_for_timeout(2000)
                        # ★FILL_DONE_BREAK_V1（2026-09-17）：原来 break 被写进了注释（"; break"）→ 循环不中断 →
                        #   会依次试 3 个选择器、每个都填一遍标题（日志里"标题已填 ×3"就是这个），
                        #   而且 for...else 会在循环正常走完后误报"未找到标题框"。恢复 break：填中一个就停。
                        break
                    except Exception as e: log('标题填失败: ' + str(e)[:60])
            else: log('⚠️ 未找到标题框')

        # ── Step4 话题（contenteditable 正文）──
        if SK_TOPIC:
            log('④ 话题——用户勾掉，跳过')
        elif a.topics:
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
                    page.wait_for_timeout(2000)   # ★步间延时
                except Exception as e: log('话题填失败: ' + str(e)[:60])
            else: log('⚠️ 未找到话题区')

        # ── Step5 封面（真实点击 coverControl → 弹窗 → 选方向 → 上传 → 点图 → 完成）──
        if SK_COVER:
            log('⑤ 封面——用户勾掉，跳过（用平台默认）')
        elif a.cover and os.path.exists(a.cover):
            # ★NO_COVER_ORIENT_V1（2026-09-14 用户要求）：
            #   抖音上传封面后【它自己会识别横竖】——脚本不需要判断方向、更不该去点「设置横封面」。
            #   旧逻辑的 click_text('设置横封面', exact=True) 会和「设置横封面获更多流量」引导弹窗里
            #   的同名按钮撞车 → 点错 → 弹窗弹出挡住上传区 → 后续操作卡死（用户实测反复出现）。
            #   今天全部删除：只保留"打开封面设置 → 上传 → 点完成"。
            log('⑤ 封面上传（不判断横竖，抖音自动识别）')
            page.wait_for_timeout(800)
            opened = click_text(page, ['选择封面', '设置封面'])
            if opened:
                page.wait_for_timeout(2500)
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
                    # ★COVER_READY_WAIT_V1（2026-09-17 用户实测找到的真凶，本机复现）：
                    #   原来这里【死等 3500ms】就点「完成」。实测：3.5 秒时封面图还在"生成中"，
                    #   点「完成」不生效 → 抖音紧接着弹出【第二个窗口】
                    #   「已基于横封面为你生成竖封面。效果不满意？独立编辑」。
                    #   那个窗口里【既没有「完成」也没有可点的「发布」】→ 脚本一直卡着（#48 失败就是这么来的）。
                    #   同一份代码：等 5 秒点=正常，等 3.5 秒点=出第二窗口 → 纯时序问题。
                    #   改为：轮询等「完成」按钮【可点击】（最多 20 秒），再点。
                    def _cover_done_btn():
                        for s in ['button:has-text("完成")', 'button:has-text("保存")', 'button:has-text("确定")']:
                            for e in page.query_selector_all(s):
                                try:
                                    if not e.is_visible():
                                        continue
                                    cls = (e.get_attribute('class') or '')
                                    # semi-button-disabled 只是 CSS 类，不是 HTML disabled → 两个都要判
                                    if e.is_disabled() or 'disabled' in cls:
                                        continue
                                    return s, e
                                except Exception:
                                    continue
                        return None, None

                    sel_ok, btn_ok = None, None
                    for _i in range(40):          # 40 × 500ms = 20s
                        sel_ok, btn_ok = _cover_done_btn()
                        if btn_ok:
                            log('✅ 封面已就绪（等了 %.1fs，按钮=%s）' % ((_i + 1) * 0.5, sel_ok))
                            break
                        page.wait_for_timeout(500)
                    if not btn_ok:
                        log('⚠️ 封面 20s 仍未就绪（继续尝试点击）')

                    try:
                        cv = visible(page, 'canvas') or visible(page, '[class*="cover"] img')
                        if cv: cv.click(timeout=2000); log('已点封面图激活裁切')
                    except Exception: pass
                    page.wait_for_timeout(1000)

                    # 点「完成」并【真校验】：弹窗里按钮消失 = 弹窗已关；否则重试
                    done_ok = False
                    for _try in range(3):
                        sel_ok, btn_ok = _cover_done_btn()
                        if not btn_ok:
                            done_ok = True
                            log('✅ 封面已确认（弹窗已关闭，第 %d 次确认）' % (_try + 1))
                            break
                        try:
                            btn_ok.click(timeout=2500)
                            log('已点「%s」（第 %d 次）' % (sel_ok or '完成', _try + 1))
                        except Exception as e:
                            log('  点完成异常: ' + str(e)[:60])
                        page.wait_for_timeout(3000)
                    if not done_ok:
                        log('⚠️ 封面确认后弹窗仍未关闭（已重试 3 次）')
                    # ★COVER_DONE_BREAK_V1 保留说明：旧代码此处 "; break" 被写进注释导致循环不中断，
                    #   点完「完成」还会去点「保存」/「确定」→ 命中上层横竖弹窗的按钮 → 挡住发布按钮。
                    #   现在改为"点后校验弹窗是否关闭"，从根上避免连点。

                    # ★COVER_ALT_MODAL_V1：抖音可能弹「已基于横封面为你生成竖封面…」提示层，
                    #   它盖住发布按钮 → 主动关掉，避免后续找不到发布按钮
                    try:
                        alt = page.query_selector('.semi-portal')
                        if alt and alt.is_visible():
                            txt = (alt.inner_text() or '')
                            if ('竖封面' in txt) or ('横封面' in txt):
                                log('⚠️ 检测到封面提示层：' + txt.replace('\n', ' ')[:40])
                                for cs in ['.semi-portal .semi-modal-close',
                                           '.semi-portal button[aria-label="关闭"]',
                                           'button:has-text("知道了")',
                                           'button:has-text("我知道了")']:
                                    try:
                                        ce2 = page.query_selector(cs)
                                        if ce2 and ce2.is_visible():
                                            ce2.click(timeout=1500)
                                            log('已关闭封面提示层（' + cs + '）')
                                            break
                                    except Exception:
                                        continue
                    except Exception: pass
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
        page.wait_for_timeout(3000)   # ★2026-09-12 发布前统一等 3 秒
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
