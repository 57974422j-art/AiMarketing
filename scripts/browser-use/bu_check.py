# -*- coding: utf-8 -*-
# bu_profile 平台登录态检测——读 Chrome Cookies(SQLite) 查平台域名
import sqlite3, os, sys, shutil, tempfile, datetime, time
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
# ★IMMUTABLE_READ_FIX_V1（2026-09-16）：与 bu_hot.py 统一 —— 用 sqlite 【immutable=1 只读直读】，
#   绕过 Chrome 对 Cookies 的【独占锁】。
#   背景：原来用 shutil.copy2 复制读 → Chrome 一开着就必然 WinError 32 →
#         自检显示"平台登录态：检测未返回结果"（采集那边早就用 immutable 所以没事）。
#   顺序：① immutable 直读（Chrome 开着也能读） ② 复制读（Chrome 没开时可用） ③ 缓存（绝不返回空）
CACHE = os.path.join(os.path.dirname(os.path.abspath(prof.rstrip('/'))), 'bu_login_cache.txt')
tmp = os.path.join(tempfile.gettempdir(), 'bu_cookies_copy.db')
_last_err = ''

def _query_cookies(conn):
    _r = conn.execute("SELECT host_key, name, expires_utc FROM cookies").fetchall()
    conn.close()
    return _r

rows = None
try:   # ① immutable 直读
    _uri = 'file:///' + ck.replace(os.sep, '/').lstrip('/') + '?immutable=1'
    rows = _query_cookies(sqlite3.connect(_uri, uri=True))
except Exception as _e:
    _last_err = 'immutable: ' + str(_e)[:90]
    rows = None

if rows is None:   # ② 复制读（回退）
    for _try in range(4):
        try:
            shutil.copy2(ck, tmp)
            rows = _query_cookies(sqlite3.connect(tmp))
            break
        except Exception as _e:
            _last_err = str(_e)[:110]
            if _try < 3:
                time.sleep(1.5)
            else:
                rows = None

if rows is None:   # ③ 缓存（回退，绝不返回空）
    try:
        if os.path.exists(CACHE):
            _cached = open(CACHE, 'r', encoding='utf-8').read().strip()
            if _cached:
                print('PLATS:' + _cached)
                print('CACHED:1')
                print('COPY_ERR:' + _last_err)
                sys.exit(0)
    except Exception:
        pass
    print('CHECK_ERR:' + _last_err)
    sys.exit(0)

try:
    # 2026-08-30: 有效期判断——过期 cookie 不算登录（会话 cookie 24h 失效——之前只看存在误导）
    # 关键会话 cookie（a1/webId 等游客标识不算登录——acw_tc/sessionid/SUB/uid 等会话才算）
    KEY_NAMES = {'douyin': ['sessionid', 'sessionid_ss', 'uid_tt', 'sid_tt'], 'xiaohongshu': ['web_session', 'acw_tc', 'xsecappid'], 'weibo': ['SUB', 'SUB2', 'WBPSESS'], 'bilibili': ['SESSDATA', 'bili_jct'], 'shipinhao': ['wxuin', 'wxsid'], 'kuaishou': ['kuaishou.session.web', 'userId'], 'x': ['auth_token', 'ct0']}
    now_ms = (datetime.datetime.now(datetime.timezone.utc).timestamp() * 1000000) + 11644473600000000
    out = []
    for pid, dom in PLATS:
        names = KEY_NAMES.get(pid, [])
        hit = False
        for h, n, exp in rows:
            if h.endswith(dom) and n in names and (exp == 0 or (exp and exp > now_ms)):  # exp=0 会话 cookie 本会话有效
                hit = True; break
        out.append(pid + ':' + ('1' if hit else '0'))
    _result = ','.join(out)
    print('PLATS:' + _result)
    try:
        open(CACHE, 'w', encoding='utf-8').write(_result)
    except Exception:
        pass
except Exception as e:
    print('CHECK_ERR:' + str(e)[:120])
