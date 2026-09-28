# -*- coding: utf-8 -*-
"""★LOGIN_UNIFY_V1（2026-09-28，用户定案「不要再东一块西一块」）：
  登录态的【唯一平台表 + 唯一路径规则 + 唯一读取器】。

■ 为什么要有这个文件（改之前是怎样的）：
  同一份平台登录态，原来是 6 个地方【各自判断】，口径互不相同：
    ① bu_check.py        —— cookie 名命中 + 未过期（最全，13 个关键名）
    ② bu_hot.py          —— 只看 SUB/SESSDATA，且只认微博/B站（窄，会漏判）
    ③ agent-publish/*.py —— 按"URL 里有没有 login"判（页面级，和 cookie 级结论不一致）
    ④ fp-templates       —— 指纹浏览器模板又一套 URL 关键字
    ⑤ 服务端 browser-status —— 内存 Map（前端从没上报过 → 恒空）
    ⑥ 前端 buAccounts     —— 自己一份（刷新即丢）
  → 同一个"我明明登录了"，各处结论不一样，用户看到的永远是"未登录"。
  现在：**任何"这个平台登录了没"的判断，都必须调本模块**（新增消费方只准 import 这里）。

■ 路径也一并统一（原来同一个目录被 8 处各自拼字符串）：
  登录态唯一位置 = <userData>/browser-profile/<账号>/Default/Network/Cookies
  ★两个中间产物也放进【账号目录】（原来放在共用层 → 多账号互相覆盖对方的登录态）：
      <账号>/bu_cookies_cdp.json   —— 主进程通过 9222 导出的 cookie（Chrome 锁库时唯一通路）
      <账号>/bu_login_cache.json   —— 检测缓存（读不到库时的兜底，绝不返回空）

■ 命令行协议（electron/main.js 解析这几行；前三行与旧版完全兼容）：
      PLATS:douyin:1,xiaohongshu:0,...      是否登录（旧格式，不变）
      REASON:douyin:ok,xiaohongshu:expired  原因：ok / expired（有但过期了）/ missing（从没登过）
      EXP:douyin:1793...,xiaohongshu:0      最近到期时间（毫秒；0 = 会话型或未知）
      FROM:cdp|file|copy|cache|none         结果来自哪条通路
      CACHED:1                              本次结果来自缓存
      CHECK_ERR:...                         读不到库（附原因）
      NO_COOKIES_FILE:...                   该账号目录还没登录过（连库文件都没有）
"""
import os
import sys
import json
import time
import shutil
import sqlite3
import tempfile
import datetime

try:  # 让中文日志在 Windows 控制台也正常（旧脚本直接 print 中文，会乱码但不影响 ASCII 协议行）
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

# ══════════════════════════════════════════════════════════════════════════
#  唯一平台表：id / 域名后缀 / 中文名 / 关键 cookie（命中且未过期才算"已登录"）
#  ★改动这里就等于改动所有消费方的口径 —— 这是本文件存在的意义。
#  ★关键 cookie 的取法：**必须是登录后才有的会话凭据**；
#    像 a1 / webId / acw_tc 这类"游客标识"不能算（历史上 bu_hot 把 a1 当登录 → 误判）。
# ══════════════════════════════════════════════════════════════════════════
PLATFORMS = [
    ('douyin',      'douyin.com',      '抖音',   ['sessionid', 'sessionid_ss', 'uid_tt', 'sid_tt']),
    ('xiaohongshu', 'xiaohongshu.com', '小红书', ['web_session', 'acw_tc', 'xsecappid']),
    ('weibo',       'weibo.com',       '微博',   ['SUB', 'SUB2', 'WBPSESS']),
    ('bilibili',    'bilibili.com',    'B站',    ['SESSDATA', 'bili_jct']),
    ('shipinhao',   'weixin.qq.com',   '视频号', ['wxuin', 'wxsid']),
    ('kuaishou',    'kuaishou.com',    '快手',   ['kuaishou.session.web', 'userId', 'passToken', 'bUserId']),
    ('x',           'x.com',           'X',      ['auth_token', 'ct0']),
    # Google（登记卡片里有这个按钮，标注"连带YouTube"）——原来没人检测它，
    # 卡片上永远显示"未登录"，容易让人以为登记失败。这里补上，让状态如实显示。
    ('google',      'google.com',      'Google', ['SID', 'HSID', 'SSID', 'SAPISID', '__Secure-1PSID']),
]

PLATFORM_LABEL = {p[0]: p[2] for p in PLATFORMS}


def profile_paths(profile):
    """★唯一路径规则：给定账号 profile 目录 → 返回该账号的三个关键文件（别再自己拼）。"""
    p = os.path.abspath(str(profile).rstrip('\\/'))
    return {
        'dir': p,
        'cookies': os.path.join(p, 'Default', 'Network', 'Cookies'),
        'cdp': os.path.join(p, 'bu_cookies_cdp.json'),
        'cache': os.path.join(p, 'bu_login_cache.json'),
    }


def _now_ms():
    """Chrome 内部时间：Unix 秒 * 1e6 + 11644473600000000（1601 基准）"""
    return int(datetime.datetime.now(datetime.timezone.utc).timestamp() * 1000000) + 11644473600000000


def read_rows(profile, with_value=False, cdp_max_age_ms=600000):
    """读 cookie 明细。返回 (rows, source, err)。
       rows = [(host_key, name, expires_utc)] 或带 value 的四元组
       顺序：① 9222 导出文件 → ② immutable 直读（Chrome 开着也能读）→ ③ 复制读
       （与旧 bu_check.py 完全一致的三级回退，只是路径改成了账号目录）
    """
    P = profile_paths(profile)
    err = ''
    # ① 主进程通过 9222 导出的 cookie（Chrome 独占锁库时的唯一通路）
    try:
        if os.path.exists(P['cdp']):
            cd = json.load(open(P['cdp'], encoding='utf-8'))
            if cd and cd.get('cookies') and (time.time() * 1000 - (cd.get('at') or 0)) < cdp_max_age_ms:
                rows = [
                    (str(x.get('host_key', '')), str(x.get('name', '')), int(x.get('expires_utc') or 0),
                     str(x.get('value', '')))
                    for x in cd['cookies']
                ]
                if rows:
                    return (rows if with_value else [r[:3] for r in rows]), 'cdp', ''
    except Exception as e:
        err = 'cdp: ' + str(e)[:80]
    ck = P['cookies']
    if not os.path.exists(ck):
        return None, 'none', 'NO_COOKIES_FILE'
    # ② immutable 只读直读（绕过 Chrome 的独占锁）
    try:
        uri = 'file:///' + ck.replace(os.sep, '/').lstrip('/') + '?immutable=1'
        con = sqlite3.connect(uri, uri=True)
        cols = 'host_key, name, expires_utc, value' if with_value else 'host_key, name, expires_utc'
        rows = con.execute('SELECT ' + cols + ' FROM cookies').fetchall()
        con.close()
        if rows:
            return rows, 'file', ''
    except Exception as e:
        err = 'immutable: ' + str(e)[:90]
    # ③ 复制读（Chrome 没开时可用）
    tmp = os.path.join(tempfile.gettempdir(), 'bu_cookies_copy_%d.db' % os.getpid())
    for i in range(4):
        try:
            shutil.copy2(ck, tmp)
            con = sqlite3.connect(tmp)
            cols = 'host_key, name, expires_utc, value' if with_value else 'host_key, name, expires_utc'
            rows = con.execute('SELECT ' + cols + ' FROM cookies').fetchall()
            con.close()
            try:
                os.remove(tmp)
            except Exception:
                pass
            if rows:
                return rows, 'copy', ''
        except Exception as e:
            err = str(e)[:110]
            if i < 3:
                time.sleep(1.5)
    return None, 'none', err


def platform_state(rows):
    """唯一判定：给定 cookie 明细 → {平台: {loggedIn, reason, expireAt}}"""
    now = _now_ms()
    out = {}
    for pid, dom, _label, keys in PLATFORMS:
        hit = False
        has_key = False
        expired = False
        near = 0
        for r in rows:
            h, n, exp = str(r[0]), str(r[1]), int(r[2] or 0)
            if not (h == dom or h.endswith('.' + dom) or h.endswith(dom)):
                continue
            if n not in keys:
                continue
            has_key = True
            if exp == 0 or exp > now:      # exp=0 = 会话 cookie（本会话有效）
                hit = True
                if exp and (near == 0 or exp < near):
                    near = exp
            else:
                expired = True
        if hit:
            reason = 'ok'
        elif has_key and expired:
            reason = 'expired'             # 有登录 cookie 但都过期了 → 前端提示"重新登记"
        else:
            reason = 'missing'             # 一个关键 cookie 都没有 → 从没在这个账号下登过
        out[pid] = {'loggedIn': hit, 'reason': reason, 'expireAt': near}
    return out


def plats_line(state):
    return ','.join('%s:%d' % (pid, 1 if state.get(pid, {}).get('loggedIn') else 0) for pid, _d, _l, _k in PLATFORMS)


def reason_line(state):
    return ','.join('%s:%s' % (pid, state.get(pid, {}).get('reason', 'missing')) for pid, _d, _l, _k in PLATFORMS)


def exp_line(state):
    return ','.join('%s:%d' % (pid, int(state.get(pid, {}).get('expireAt') or 0)) for pid, _d, _l, _k in PLATFORMS)


def read_state(profile, use_cache=True):
    """唯一入口：读某账号的登录态。返回 dict：
       {ok, from, err, plats, reasons, exps, platforms, cached}
       ★读不到库时【回退缓存】（绝不返回空 → 免得前端把"读不到"当成"全未登录"）。
    """
    rows, src, err = read_rows(profile)
    if rows:
        st = platform_state(rows)
        res = {
            'ok': True, 'from': src, 'err': '', 'platforms': st, 'cached': False,
            'plats': plats_line(st), 'reasons': reason_line(st), 'exps': exp_line(st),
        }
        try:
            P = profile_paths(profile)
            json.dump({'at': time.time() * 1000, 'from': src, 'plats': res['plats'],
                       'reasons': res['reasons'], 'exps': res['exps']},
                      open(P['cache'], 'w', encoding='utf-8'), ensure_ascii=False)
        except Exception:
            pass
        return res
    # 回退缓存 —— ★只认【本账号目录】里的缓存
    #   ⚠️LOGIN_UNIFY_V1 实测踩过一次：原来还回退读"共用层"的 bu_login_cache.txt →
    #      一个不存在的账号目录也能"读出"上一个账号的登录态（账号串线，正是要消灭的东西）。
    #      改完后：该账号没登记过就是 NO_COOKIES_FILE，绝不借别人的结果。
    if use_cache:
        P = profile_paths(profile)
        try:
            if os.path.exists(P['cache']):
                j = json.loads(open(P['cache'], encoding='utf-8').read() or '{}')
                plats = str(j.get('plats') or '')
                if ':' in plats:
                    return {'ok': True, 'from': 'cache', 'err': err, 'cached': True, 'platforms': {},
                            'plats': plats, 'reasons': str(j.get('reasons') or ''),
                            'exps': str(j.get('exps') or '')}
        except Exception:
            pass
    return {'ok': False, 'from': 'none', 'err': err, 'platforms': {}, 'cached': False,
            'plats': '', 'reasons': '', 'exps': ''}


def main():
    profile = sys.argv[1] if len(sys.argv) > 1 else ''
    if not profile:
        print('USAGE: login_state.py <profile_dir>')
        return
    r = read_state(profile)
    if r['ok']:
        print('PLATS:' + r['plats'])
        if r['reasons']:
            print('REASON:' + r['reasons'])
        if r['exps']:
            print('EXP:' + r['exps'])
        print('FROM:' + r['from'])
        if r['cached']:
            print('CACHED:1')
        return
    if r['err'] == 'NO_COOKIES_FILE':
        print('NO_COOKIES_FILE:' + profile_paths(profile)['cookies'])
    else:
        print('CHECK_ERR:' + (r['err'] or 'unknown'))


if __name__ == '__main__':
    main()
