# -*- coding: utf-8 -*-
"""CDP 穿透点击（Python 版）——移植 electron/fp-templates/_cdpClick.js
穿透 closed shadow DOM + iframe：CDP DOM.getDocument(pierce=True) → 递归找节点 → getBoxModel → mouse.click
"""
import sys, json, time
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright


def _attr_map(node):
    a = node.get('attributes') or []
    o = {}
    for i in range(0, len(a) - 1, 2):
        o[a[i]] = a[i + 1] or ''
    return o


def _kids(node):
    kids = []
    for k in ('children', 'shadowRoots'):
        v = node.get(k)
        if isinstance(v, list):
            kids.extend(v)
    v = node.get('contentDocument')
    if isinstance(v, dict):
        kids.append(v)
    v = node.get('templateContent')
    if isinstance(v, dict):
        kids.append(v)
    return kids


def _subtree_text(node, depth=0):
    if depth > 40 or not isinstance(node, dict):
        return ''
    if node.get('nodeType') == 3:
        return node.get('nodeValue') or ''
    s = ''
    for c in _kids(node):
        s += _subtree_text(c, depth + 1)
    return s


def collect(client, pred):
    root = client.send('DOM.getDocument', {'depth': -1, 'pierce': True})
    out = []

    def walk(node, depth=0):
        if depth > 80 or not isinstance(node, dict):
            return
        if node.get('nodeType') == 1:
            try:
                if pred(node):
                    out.append(node)
            except Exception:
                pass
        for c in _kids(node):
            walk(c, depth + 1)

    walk(root.get('root'))
    return out


def cdp_click_text(page, text, tag='button', log=print, exact=True, prefer_bottom_right=True):
    """按标签+文本穿透查找并真实鼠标点击；返回 (ok, 说明)
    2026-09-12 升级：①exact=True 只匹配【文本精确等于】（避免"发布"命中导航/菜单等 25 个）
                    ②prefer_bottom_right 多候选时取【最靠右下】（提交按钮通常在右下角）
                    ③点击前打印候选清单（文本/class/坐标），便于定位点错对象
    """
    client = page.context.new_cdp_session(page)
    try:
        def pred(node):
            name = (node.get('localName') or '').lower()
            if tag and name != tag:
                return False
            t = _subtree_text(node).strip()
            return t == text if exact else (t == text or (text in t and len(t) <= len(text) + 4))
        nodes = collect(client, pred)
        log('CDP 穿透找到 <%s> "%s" → %d 个（exact=%s）' % (tag or '*', text, len(nodes), exact))
        # 收集候选（含坐标）用于筛选/日志
        cands = []
    finally:
        try:
            client.detach()
        except Exception:
            pass


if __name__ == '__main__':
    with sync_playwright() as pw:
        b = pw.chromium.connect_over_cdp('http://127.0.0.1:9222')
        pg = [x for x in b.contexts[0].pages if 'channels.weixin' in x.url][0]
        pg.bring_to_front()
        ok, msg = cdp_click_text(pg, '发表')
        print('发表点击 → %s (%s)' % (ok, msg))
        for i in range(10):
            pg.wait_for_timeout(3000)
            u = pg.url
            print('  [%ds] url=%s' % ((i + 1) * 3, u[:70]))
            if 'post/create' not in u:
                print('  → ✅ 页面跳转（发表成功）'); break
        pg.screenshot(path='D:/AiMarketing/viag-shot3.png')
        print('截图: D:/AiMarketing/viag-shot3.png')
