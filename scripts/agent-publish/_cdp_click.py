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


def cdp_click_text(page, text, tag='button', log=print):
    """按标签+文本穿透查找并真实鼠标点击；返回 (ok, 说明)"""
    client = page.context.new_cdp_session(page)
    try:
        def pred(node):
            name = (node.get('localName') or '').lower()
            if tag and name != tag:
                return False
            t = _subtree_text(node).strip()
            return t == text or (text in t and len(t) <= len(text) + 4)
        nodes = collect(client, pred)
        log('CDP 穿透找到 <%s> "%s" → %d 个' % (tag, text, len(nodes)))
        for n in nodes:
            nid = n.get('nodeId')
            if not nid:
                continue
            try:
                client.send('DOM.scrollIntoViewIfNeeded', {'nodeId': nid})
            except Exception:
                pass
            m = client.send('DOM.getBoxModel', {'nodeId': nid})
            q = (m.get('model') or {}).get('border') or (m.get('model') or {}).get('content')
            if not q or len(q) < 8:
                continue
            cx = (q[0] + q[2] + q[4] + q[6]) / 4
            cy = (q[1] + q[3] + q[5] + q[7]) / 4
            cls = _attr_map(n).get('class', '')[:44]
            log('  点击 nodeId=%s class=%s 中心=(%d,%d)' % (nid, cls, cx, cy))
            page.mouse.move(cx, cy)
            page.wait_for_timeout(250)
            page.mouse.click(cx, cy)
            return True, 'clicked:%s@%d,%d' % (cls, cx, cy)
        return False, 'not-found'
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
