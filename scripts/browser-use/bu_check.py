# -*- coding: utf-8 -*-
# bu_profile 平台登录态检测——读 Chrome Cookies(SQLite) 查平台域名
import sqlite3, os, sys, shutil, tempfile, datetime
prof = sys.argv[1] if len(sys.argv) > 1 else 'D:/bu_profile'
def sync_system_login(profile):
    try:
        sys_default = os.path.join(os.environ.get('LOCALAPPDATA', ''), 'Google', 'Chrome', 'User Data', 'Default')
        sys_ck = os.path.join(sys_default, 'Network', 'Cookies')
        if not os.path.exists(sys_ck): return
        dst = os.path.join(profile, 'Default')
        os.makedirs(os.path.join(dst, 'Network'), exist_ok=True)
        shutil.copy2(sys_ck, os.path.join(dst, 'Network', 'Cookies'))
        ls = os.path.join(os.path.dirname(sys_default), 'Local State')
        if os.path.exists(ls):
            os.makedirs(profile, exist_ok=True)
            shutil.copy2(ls, os.path.join(profile, 'Local State'))
        print('SYNC: OK')
    except Exception as e:
        print('SYNC_FAIL:', str(e)[:100])

PLATS = [('douyin', 'douyin.com'), ('xiaohongshu', 'xiaohongshu.com'), ('weibo', 'weibo.com'), ('bilibili', 'bilibili.com'), ('shipinhao', 'weixin.qq.com'), ('kuaishou', 'kuaishou.com'), ('x', 'x.com')]
# sync_system_login(prof)  # 2026-08-31: 预检不覆盖（防死循环——bu_profile 自己的登录态优先）
ck = os.path.join(prof, 'Default', 'Network', 'Cookies')
if not os.path.exists(ck):
    print('NO_COOKIES_FILE:' + ck); sys.exit(0)
# Chrome 锁——复制读（防锁）
tmp = os.path.join(tempfile.gettempdir(), 'bu_cookies_copy.db')
try:
    shutil.copy2(ck, tmp)
    con = sqlite3.connect(tmp)
    # 2026-08-30: 有效期判断——过期 cookie 不算登录（会话 cookie 24h 失效——之前只看存在误导）
    # 关键会话 cookie（a1/webId 等游客标识不算登录——acw_tc/sessionid/SUB/uid 等会话才算）
    KEY_NAMES = {'douyin': ['sessionid', 'sessionid_ss', 'uid_tt', 'sid_tt'], 'xiaohongshu': ['web_session', 'acw_tc', 'xsecappid'], 'weibo': ['SUB', 'SUB2', 'WBPSESS'], 'bilibili': ['SESSDATA', 'bili_jct'], 'shipinhao': ['wxuin', 'wxsid'], 'x': ['auth_token', 'ct0']}
    rows = con.execute("SELECT host_key, name, expires_utc FROM cookies").fetchall()
    con.close()
    now_ms = (datetime.datetime.now(datetime.timezone.utc).timestamp() * 1000000) + 11644473600000000
    out = []
    for pid, dom in PLATS:
        names = KEY_NAMES.get(pid, [])
        hit = False
        for h, n, exp in rows:
            if h.endswith(dom) and n in names and (exp == 0 or (exp and exp > now_ms)):  # exp=0 会话 cookie 本会话有效
                hit = True; break
        out.append(pid + ':' + ('1' if hit else '0'))
    print('PLATS:' + ','.join(out))
except Exception as e:
    print('CHECK_ERR:' + str(e)[:120])
