# -*- coding: utf-8 -*-
# bu_profile 平台登录态检测——读 Chrome Cookies(SQLite) 查平台域名
import sqlite3, os, sys, shutil, tempfile
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
    rows = con.execute("SELECT host_key FROM cookies").fetchall()
    con.close()
    hosts = set(r[0] for r in rows)
    out = []
    for pid, dom in PLATS:
        hit = any(h.endswith(dom) for h in hosts)
        out.append(pid + ':' + ('1' if hit else '0'))
    print('PLATS:' + ','.join(out))
except Exception as e:
    print('CHECK_ERR:' + str(e)[:120])
