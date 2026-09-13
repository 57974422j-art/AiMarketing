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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--profile', required=True, help='browser-profile 目录')
    ap.add_argument('--post', default='', help='服务器地址，如 http://127.0.0.1:3000（空=只打印不提交）')
    ap.add_argument('--cookie', default='', help='登录 cookie（HTTP 头形式），用于提交上报')
    ap.add_argument('--only', default='', help='只采指定平台（逗号分隔）')
    a = ap.parse_args()

    rows = read_cookies(a.profile)
    if not rows:
        print('采集失败：读不到 cookie')
        return
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

    print()
    print('采集结果：', ', '.join('%s(%d条)' % (k, len(v['items'])) for k, v in result.items()) or '（空）')

    # 提交到服务器
    if a.post and result:
        try:
            req = urllib.request.Request(
                a.post.rstrip('/') + '/api/agent/hotspot-report',
                data=json.dumps(result).encode('utf-8'),
                headers={'Content-Type': 'application/json',
                         'Cookie': a.cookie or '',
                         'Authorization': 'Bearer ' + (a.cookie or '')},
                method='POST')
            with urllib.request.urlopen(req, timeout=20) as resp:
                print('上报结果:', resp.read().decode('utf-8')[:200])
        except Exception as e:
            print('上报失败:', str(e)[:150])
    elif a.post and not result:
        print('无采集结果，不上报')


if __name__ == '__main__':
    main()
