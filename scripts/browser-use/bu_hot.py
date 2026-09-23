# -*- coding: utf-8 -*-
"""
热点采集（客户端）—— 2026-09-13
用途：用户每天首次启动客户端时调用一次，采集【已登录】平台的榜单 → POST 到服务器
  · A 类（cookie 直调，不开浏览器）：微博热搜、B站热榜
  · B 类（开浏览器，需签名）：抖音、小红书、快手  —— 由 --browser 参数启用
原则：只采【已登录】的平台；采不到就跳过（不造假）

用法：
  python bu_hot.py --profile <browser-profile目录> --post <服务器地址> [--cookie <cookie>] [--browser]
"""
import argparse
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.request

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36')

# 只采这些平台（用户已登录才采；未登录直接跳过）
PLATFORM_COOKIES = {
    '微博': ('weibo.com', ['SUB']),
    'B站': ('bilibili.com', ['SESSDATA']),
    '抖音': ('douyin.com', ['sessionid', 'sessionid_ss', 'sid_tt']),
    '小红书': ('xiaohongshu.com', ['web_session', 'a1']),
    '快手': ('kuaishou.com', ['passToken', 'bUserId']),
}


def read_cookies(profile):
    """读 browser-profile 的 Cookies（带重试——Chrome 运行时锁文件）"""
    ck = os.path.join(profile, 'Default', 'Network', 'Cookies')
    if not os.path.exists(ck):
        print('NO_COOKIES:' + ck)
        return []
    # ★CDP_COOKIE_V1（方案 A）：优先用主进程通过 9222 导出的 cookie
    #   （实测：Chrome 运行时独占锁 Cookies 文件，读文件/复制/immutable 全部失败，只能问 Chrome 要）
    try:
        import json as _json
        _cdpfile = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(profile.rstrip('/')))), 'bu_cookies_cdp.json')
        if os.path.exists(_cdpfile):
            _cd = _json.load(open(_cdpfile, encoding='utf-8'))
            if _cd and _cd.get('cookies') and (time.time() * 1000 - (_cd.get('at') or 0)) < 600000:
                _rows = [(x.get('host_key', ''), x.get('name', ''), x.get('value', '')) for x in _cd['cookies']]
                if _rows:
                    print('（CDP 导出直读成功，%d 条 cookie）' % len(_rows))
                    return _rows
    except Exception as _e:
        print('CDP_COOKIES_FAIL:' + str(_e)[:80])
    # 2026-09-13: 【immutable 直读】——Chrome 运行时独占锁 Cookie 库，copy 会 WinError 32；
    #   而用 sqlite 的 immutable=1 只读模式可以绕过锁（实测有效）。失败再退回拷贝。
    uri = 'file:///' + ck.replace(os.sep, '/').lstrip('/') + '?immutable=1'
    try:
        con = sqlite3.connect(uri, uri=True)
        rows = con.execute('SELECT host_key, name, value FROM cookies').fetchall()
        con.close()
        if rows:
            print('（immutable 直读成功，%d 条 cookie）' % len(rows))
            return rows
    except Exception as e:
        print('IMMUTABLE_FAIL:' + str(e)[:80])

    tmp = os.path.join(tempfile.gettempdir(), 'bu_hot_cookies.db')
    for i in range(4):
        try:
            shutil.copy2(ck, tmp)
            break
        except Exception as e:
            if i < 3:
                time.sleep(1.5)
            else:
                print('COPY_FAIL:' + str(e)[:90])
                return []
    try:
        con = sqlite3.connect(tmp)
        rows = con.execute('SELECT host_key, name, value FROM cookies').fetchall()
        con.close()
        return rows
    except Exception as e:
        print('READ_FAIL:' + str(e)[:90])
        return []


def pick(rows, domain, names):
    out = {}
    for h, n, v in rows:
        if domain in h and n in names:
            out[n] = v
    return out


def ckstr(d):
    return '; '.join('%s=%s' % (k, v) for k, v in d.items())


def http_get(url, cookie='', referer=''):
    cmd = ['curl', '-s', '-m', '12', '-A', UA]
    if cookie:
        cmd += ['-H', 'Cookie: ' + cookie]
    if referer:
        cmd += ['-H', 'Referer: ' + referer]
    cmd.append(url)
    r = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace')
    return r.stdout or ''


# ── A 类采集器（cookie 直调）──

def hot_weibo(cookie):
    """微博热搜（需 SUB cookie）"""
    raw = http_get('https://weibo.com/ajax/side/hotSearch', ckstr(cookie), 'https://weibo.com/')
    try:
        d = json.loads(raw)
    except Exception:
        return []
    items = (d.get('data') or {}).get('realtime') or []
    out = []
    for i, it in enumerate(items[:20]):
        t = (it.get('word') or it.get('note') or '').strip()
        if not t:
            continue
        out.append({'title': t, 'hot': str(it.get('num') or it.get('raw_hot') or '') or None, 'rank': i + 1})
    return out


def hot_bilibili(cookie):
    """B站热榜（需 SESSDATA）"""
    raw = http_get('https://api.bilibili.com/x/web-interface/ranking/v2?rid=0&type=all',
                   ckstr(cookie), 'https://www.bilibili.com/')
    try:
        d = json.loads(raw)
    except Exception:
        return []
    if d.get('code') != 0:
        return []
    lst = ((d.get('data') or {}).get('list')) or []
    out = []
    for i, it in enumerate(lst[:20]):
        t = (it.get('title') or '').strip()
        if not t:
            continue
        out.append({'title': t, 'hot': it.get('stat', {}).get('view') and str(it['stat']['view']) or None,
                    'url': it.get('short_link_v2') or it.get('bvid') and ('https://www.bilibili.com/video/' + str(it.get('bvid'))) or None,
                    'rank': i + 1})
    return out


COLLECTORS = {
    '微博': hot_weibo,
    'B站': hot_bilibili,
}



# ═══════════════════════════════════════════════════════════════
# BROWSER_COLLECT_V1（2026-09-13）：B 类采集——开标签 → 页内 fetch（签名由页面算）→ 关标签
#   抖音/快手 实测可行；小红书接口在 edith 域（跨域），改用 www 域内可见的接口
# ═══════════════════════════════════════════════════════════════
CDP_URL = 'http://127.0.0.1:9222'

JS_DOUYIN = """async () => {
  const r = await fetch('https://www.douyin.com/aweme/v1/web/hot/search/list/?device_platform=webapp&aid=6383&channel=channel_pc_web&detail_list=1', {
    headers: { 'accept': 'application/json' }, credentials: 'include',
  });
  const j = await r.json();
  const list = (j && j.data && j.data.word_list) || [];
  return JSON.stringify(list.map(function (it, i) {
    return { title: String(it.word || it.sentence_id || '').trim(), hot: it.hot_value ? String(it.hot_value) : null, rank: i + 1 };
  }).filter(function (x) { return x.title; }));
}"""

JS_KUAISHOU = """async () => {
  const r = await fetch('https://www.kuaishou.com/graphql', {
    method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'include',
    body: JSON.stringify({ operationName: 'visionHotRank', variables: {},
      query: 'query visionHotRank { visionHotRank { result items { id name hotValue } } }' })
  });
  const j = await r.json();
  const items = (j && j.data && j.data.visionHotRank && j.data.visionHotRank.items) || [];
  return JSON.stringify(items.map(function (it, i) {
    return { title: String(it.name || it.id || '').trim(), hot: it.hotValue ? String(it.hotValue) : null, rank: i + 1 };
  }).filter(function (x) { return x.title; }));
}"""

BROWSER_JOBS = [
    ('抖音', 'https://www.douyin.com/hot', JS_DOUYIN),
    ('快手', 'https://www.kuaishou.com/', JS_KUAISHOU),
]

# ★NO_LOGIN_NO_BROWSER_V1（2026-09-23）：判断"该平台在本机有没有登录 cookie"用的域名片段——
#   没登录就不为它启动浏览器（未登录时 B 类采不到任何东西，只是白开一个 about:blank 窗口）。
PF_COOKIE_HOSTS = {
    '抖音': ('douyin',),
    '快手': ('kuaishou',),
}


CHROME_CANDS = [
    r'C:\Program Files\Google\Chrome\Application\chrome.exe',
    r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
]


def cdp_alive(timeout=2):
    try:
        import urllib.request
        with urllib.request.urlopen(CDP_URL + '/json/version', timeout=timeout) as r:
            return r.status == 200
    except Exception:
        return False


def start_chrome(profile):
    """AUTO_START_CHROME_V1（2026-09-13）：客户端启动时浏览器通常没开——
    原来只 connect 已开的 9222，连不上就跳过 → 永远不会自己开。
    现在：找不到 chrome 就自己起一个（同 profile + 9222）。

    ★SELF_CHROME_CLEANUP_V1（2026-09-23 用户实测）：返回值由 True/False 改为【pid】——
      因为"采完由调用方关不关都行"这句注释当年埋了坑：调用方从来没关，于是每次采集都留下一个
      about:blank 空浏览器；它占住 browser-profile（登录态目录）→ 用户删客户端目录删不掉
      （报 journal.baj / MessageDB / LOCK 正被另一进程使用），还可能和发布抢同一个 profile。
      现在返回 pid，由 collect_by_browser 在采集结束【关掉这个自己启的】。
      0 = 没启成功（或没找到 Chrome）→ 调用方就什么都不用关。
    """
    import subprocess as _sp
    ch = next((p for p in CHROME_CANDS if os.path.exists(p)), None)
    if not ch:
        print('  未找到 Chrome（无法自动启动）')
        return 0
    p = None
    try:
        p = _sp.Popen([ch, '--user-data-dir=' + str(profile), '--remote-debugging-port=9222',
                       '--remote-allow-origins=*', '--no-first-run', 'about:blank'],
                      stdout=_sp.DEVNULL, stderr=_sp.DEVNULL)
        print('  已启动浏览器（9222 + profile）等待就绪…')
    except Exception as e:
        print('  启动浏览器失败:', str(e)[:80])
        return 0
    for _ in range(15):
        time.sleep(1)
        if cdp_alive():
            print('  浏览器就绪')
            try:
                return int(p.pid)
            except Exception:
                return 0
    print('  浏览器等待超时')
    if p is not None:
        try:   # 超时也别留孤儿
            _sp.run(['taskkill', '/PID', str(p.pid), '/T', '/F'], capture_output=True)
            print('  已结束超时的浏览器进程')
        except Exception:
            pass
    return 0


def pid_alive(pid):
    """进程是否还活着（用来决定要不要 taskkill 兜底）。"""
    try:
        import subprocess as _sp
        r = _sp.run(['tasklist', '/FI', 'PID eq ' + str(pid), '/NH'], capture_output=True, text=True)
        return str(pid) in (r.stdout or '')
    except Exception:
        return False


def close_own_browser(pid):
    """★SELF_CHROME_CLEANUP_V1：结束【本次采集自己启动的】浏览器（只在 CDP 关不掉时用）。

    铁律：只关【自己启的】—— 别人已经开着的 9222（用户自己开的 / 登记发布浏览器）绝不动。
    """
    if not pid:
        return
    try:
        import subprocess as _sp
        _sp.run(['taskkill', '/PID', str(pid), '/T', '/F'], capture_output=True)
        print('  已结束本次采集启动的浏览器（pid=%d）' % pid)
    except Exception as e:
        print('  结束浏览器失败:', str(e)[:60])


def _has_pf_cookie(rows, name):
    """该平台在本机有没有 cookie（= 有没有登录）。没有就不值得为它启动浏览器。"""
    frags = PF_COOKIE_HOSTS.get(name) or ()
    for r in (rows or []):
        try:
            h = str(r[0]).lower()
        except Exception:
            continue
        for f in frags:
            if f in h:
                return True
    return False


def collect_by_browser(only=None, profile=None, rows=None):
    """开标签 → 页内 fetch → 关标签（只有浏览器可用时才做）

    ★两处 2026-09-23 的改动（用户实测反馈）：
      ① NO_LOGIN_NO_BROWSER_V1：**该平台没登录就不为它启动浏览器** ——
         用户实测：全新机器、还没登录，点「确认进入」后也会弹出一个 about:blank 空浏览器
         （采不到任何东西，纯属多余）。
      ② SELF_CHROME_CLEANUP_V1：**自己启动的浏览器，采集完必须自己关掉** ——
         以前注释写"由调用方关不关都行"，结果调用方从来没关 → 每次留一个空窗口，
         还占住 browser-profile（登录态目录）。复用别人开的 9222 时【绝不关】。
    """
    try:
        from playwright.sync_api import sync_playwright
    except Exception as e:
        print('  浏览器采集跳过（无 playwright）:', str(e)[:60])
        return {}
    # ① 先按"有没有该平台 cookie"筛作业（rows 为 None（老调用）= 不筛，保持原行为）
    jobs = []
    for name, url, js in BROWSER_JOBS:
        if only and name not in only:
            continue
        if rows is not None and not _has_pf_cookie(rows, name):
            print('  [%s] 未登录（本机没有该平台 cookie）→ 跳过，不启动浏览器' % name)
            continue
        jobs.append((name, url, js))
    if not jobs:
        print('  没有已登录的平台可采 → 不启动浏览器')
        return {}
    # ② 没开就自己开（★记下 pid：这是"我启的"，采完要自己关）
    own_pid = 0
    if not cdp_alive():
        print('  CDP 9222 不通 → 自动启动浏览器（采完会自动关掉）')
        own_pid = start_chrome(profile)
        if not own_pid:
            return {}
    out = {}
    try:
        with sync_playwright() as pw:
            b = pw.chromium.connect_over_cdp(CDP_URL)
            ctx = b.contexts[0]
            for name, url, js in jobs:
                pg = None
                try:
                    pg = ctx.new_page()
                    pg.goto(url, wait_until='domcontentloaded', timeout=25000)
                    pg.wait_for_timeout(4000)
                    raw = pg.evaluate(js)
                    items = json.loads(raw) if isinstance(raw, str) else (raw or [])
                    if items:
                        out[name] = {'items': items[:20], 'fetchedAt': int(time.time() * 1000)}
                        print('  [%s] ✅ 采到 %d 条（例：%s）' % (name, len(items), items[0]['title'][:26]))
                    else:
                        print('  [%s] 未采到' % name)
                except Exception as e:
                    print('  [%s] 失败: %s' % (name, str(e)[:80]))
                finally:
                    try:
                        if pg:
                            pg.close()
                    except Exception:
                        pass
            # ★关掉"我启的那个"（必须在 playwright 还活着时做）：
            #   ① 首选 CDP 的 Browser.close —— 让 Chrome【自己有序退出】，
            #      这样下次打开不会弹"未正常关闭/恢复页面"（实测 b.close() 只断开连接，进程还活着）
            #   ② 拿不到 CDP 会话 → 退回 b.close()（断开）
            #   ③ 都失败/中途异常 → 交给 finally 的 taskkill 兜底
            if own_pid:
                closed = False
                try:
                    cdp = b.new_browser_cdp_session()
                    cdp.send('Browser.close')
                    closed = True
                    print('  已通知本次采集启动的浏览器退出（Browser.close）')
                except Exception as e:
                    print('  Browser.close 不可用（退回断开连接）:', str(e)[:70])
                if not closed:
                    try:
                        b.close()
                        print('  已断开与本次采集浏览器的连接（等它自己退）')
                    except Exception as e:
                        print('  CDP 断开失败（稍后用 taskkill 兜底）:', str(e)[:60])
    except Exception as e:
        print('  浏览器不可用（跳过）:', str(e)[:90])
    finally:
        # 兜底（只针对"我启的"）：
        #   ① 先给它最多 8 秒自己退 —— 干净退出，下次打开不会弹"恢复页面/未正常关闭"
        #   ② 8 秒还没退（或中途异常）才强杀
        if own_pid and pid_alive(own_pid):
            for _ in range(16):
                time.sleep(0.5)
                if not pid_alive(own_pid):
                    break
            if pid_alive(own_pid):
                close_own_browser(own_pid)
            else:
                print('  本次采集启动的浏览器已自行退出 ✅')
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--profile', required=True, help='browser-profile 目录')
    ap.add_argument('--post', default='', help='服务器地址，如 http://127.0.0.1:3000（空=只打印不提交）')
    ap.add_argument('--cookie', default='', help='登录 cookie（HTTP 头形式），用于提交上报')
    ap.add_argument('--only', default='', help='只采指定平台（逗号分隔）')
    ap.add_argument('--browser', action='store_true', help='启用浏览器采集（抖音/快手，需 9222 可用）')
    a = ap.parse_args()

    rows = read_cookies(a.profile)
    if not rows:
        # 2026-09-13: 【不能因此中止】——读不到 cookie 只影响 A 类（微博/B站）；
        #   B 类（抖音/快手）走浏览器页内 fetch，用的是浏览器自己的登录态，不需要读 cookie 文件
        #   （Chrome 运行时锁 Cookie 库 → copy 失败是常态）
        print('读不到 cookie（Chrome 可能正锁着）→ 跳过 A 类，继续 B 类（浏览器采集）')
    else:
        print('cookie 总数:', len(rows))

    only = [s.strip() for s in a.only.split(',') if s.strip()] if a.only else None
    result = {}
    for name, (domain, names) in PLATFORM_COOKIES.items():
        if only and name not in only:
            continue
        ck = pick(rows, domain, names)
        if not ck:
            print('  [%s] 未登录 → 跳过' % name)
            continue
        fn = COLLECTORS.get(name)
        if not fn:
            print('  [%s] 已登录，但需开浏览器采集（暂未实现）' % name)
            continue
        try:
            items = fn(ck)
        except Exception as e:
            print('  [%s] 采集异常: %s' % (name, str(e)[:70]))
            continue
        if items:
            result[name] = {'items': items, 'fetchedAt': int(time.time() * 1000)}
            print('  [%s] ✅ 采到 %d 条（例：%s）' % (name, len(items), items[0]['title'][:26]))
        else:
            print('  [%s] 已登录但没采到（接口可能改版/风控）' % name)

    # ★BROWSER_COLLECT_V1：浏览器采集（抖音/快手）——只在 --browser 且 9222 可用时做
    if a.browser:
        print()
        print('浏览器采集（开标签→页内 fetch→关标签）…')
        try:
            # ★NO_LOGIN_NO_BROWSER_V1：把已读到的 cookie 传进去，让它在"没登录"时不启动浏览器
            result.update(collect_by_browser(only, a.profile, rows))
        except Exception as e:
            print('  浏览器采集异常:', str(e)[:90])

    print()
    print('采集结果：', ', '.join('%s(%d条)' % (k, len(v['items'])) for k, v in result.items()) or '（空）')

    # 提交到服务器
    if a.post and result:
        try:
            # FIX_401_V1（2026-09-14）：原来发 `Authorization: Bearer <完整cookie串>`
            #   （形如 `Bearer token=eyJxxx; other=yyy`）→ 服务端解析不出有效 token → 401
            #   正确：只发 Cookie 头（middleware 会从 cookie 里取 token 验签）
            _hdr = {'Content-Type': 'application/json'}
            if a.cookie:
                _hdr['Cookie'] = a.cookie
            req = urllib.request.Request(
                a.post.rstrip('/') + '/api/agent/hotspot-report',
                data=json.dumps(result).encode('utf-8'),
                headers=_hdr,
                method='POST')
            with urllib.request.urlopen(req, timeout=20) as resp:
                print('上报结果:', resp.read().decode('utf-8')[:200])
        except Exception as e:
            print('上报失败:', str(e)[:150])
    elif a.post and not result:
        print('无采集结果，不上报')


if __name__ == '__main__':
    main()
