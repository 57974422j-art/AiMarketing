# -*- coding: utf-8 -*-
# bu_profile 平台登录态检测——读 Chrome Cookies(SQLite) 查平台域名
import sqlite3, os, sys, shutil, tempfile, datetime
prof = sys.argv[1] if len(sys.argv) > 1 else 'D:/bu_profile'
PLATS = [('douyin', 'douyin.com'), ('xiaohongshu', 'xiaohongshu.com'), ('weibo', 'weibo.com'), ('bilibili', 'bilibili.com'), ('shipinhao', 'weixin.qq.com'), ('x', 'x.com')]
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
            if h.endswith(dom) and n in names and exp and exp > now_ms:
                hit = True; break
        out.append(pid + ':' + ('1' if hit else '0'))
    print('PLATS:' + ','.join(out))
except Exception as e:
    print('CHECK_ERR:' + str(e)[:120])
