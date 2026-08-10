# -*- coding: utf-8 -*-
"""按行业拉取 YouTube 视频 → OSS 私有转存 → 截首帧封面 → 入库（2026-08-09）
服务器 crontab 夜间 00:00 触发；每行业 1 条、间隔 3 分钟、串行。
依赖：pip install yt-dlp oss2
"""
import os, sys, time, json, subprocess, hashlib, re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

def load_env():
    env = {}
    for p in [ROOT / '.env', ROOT / '.env.local']:
        if p.exists():
            for line in p.read_text(encoding='utf-8').splitlines():
                if '=' in line and not line.strip().startswith('#'):
                    k, v = line.split('=', 1)
                    env[k.strip()] = v.strip().strip('"').strip("'")
    return env

ENV = load_env()
PROXY = ENV.get('OVERSEAS_PROXY', '') or os.environ.get('OVERSEAS_PROXY', '')
API_BASE = 'http://127.0.0.1:3000'

# 行业 → 搜索关键词（8 行业，视频类型短视频）
INDUSTRY_KEYWORDS = {
    '餐饮': ['restaurant food video', 'street food asmr', 'cooking shorts'],
    '美业': ['beauty makeup tutorial', 'salon hair video', 'skincare shorts'],
    '教育': ['study tips shorts', 'educational video', 'knowledge shorts'],
    '电商': ['product unboxing', 'ecommerce tips', 'shopping shorts'],
    '房产': ['real estate tour', 'house tour video', 'property shorts'],
    '健身': ['fitness workout shorts', 'gym training video', 'home workout'],
    '旅游': ['travel vlog shorts', 'scenic travel video', 'trip shorts'],
    '服装': ['fashion outfit shorts', 'clothing try on', 'style video'],
}
PER_INDUSTRY = int(ENV.get('VIDEO_PER_INDUSTRY', '1'))
INTERVAL = int(ENV.get('VIDEO_FETCH_INTERVAL', '180'))  # 秒，3 分钟一个

def log(msg):
    print(f'[{time.strftime("%H:%M:%S")}] {msg}', flush=True)

# ── 住宅 SS 代理池（2026-08-10 实测 4/5 可下载 YouTube；38.213.66.215 被 bot 标记已排除）──
SS_POOL = [
    {'server': '38.49.38.249', 'port': 11530, 'password': '7700', 'method': 'aes-256-gcm'},
    {'server': '166.0.17.174', 'port': 11306, 'password': '7700', 'method': 'aes-256-gcm'},
    {'server': '38.60.126.30', 'port': 11639, 'password': '7700', 'method': 'aes-256-gcm'},
    {'server': '38.179.85.200', 'port': 11407, 'password': '7700', 'method': 'aes-256-gcm'},
]
# 生成 ss-local 配置并重启（切换节点用）
def switch_ss(node):
    import json, subprocess
    cfg = {'server': node['server'], 'server_port': node['port'], 'password': node['password'],
           'method': node['method'], 'local_address': '127.0.0.1', 'local_port': 1080}
    with open('/etc/shadowsocks-libev/config.json', 'w') as f:
        json.dump(cfg, f)
    subprocess.run(['pkill', '-f', 'ss-local'], capture_output=True)
    time.sleep(0.5)
    subprocess.run(['ss-local', '-c', '/etc/shadowsocks-libev/config.json', '-f', '/tmp/ss-local.pid'], capture_output=True)
    # 等待 127.0.0.1:1080 就绪（最多 3 秒），否则 yt-dlp 连 socks5 失败
    import socket
    for _ in range(15):
        try:
            s = socket.create_connection(('127.0.0.1', 1080), timeout=0.5)
            s.close(); break
        except Exception:
            time.sleep(0.2)

# ── 快代理动态住宅（fps 短效代理，2026-08-09）──
# 每条下载前自动提取新 IP（30 分钟有效）；认证 = 组合账密（可改订单号模式）
KD_SECRET_ID = ENV.get('KD_SECRET_ID', 'ouetsr2s0kvxgeb8tuot')
KD_SIGNATURE = ENV.get('KD_SIGNATURE', 'dtdj127qwjt9cmolgfo42almfwu8lxjo')
KD_AUTH = ENV.get('KD_AUTH', 'u0q1kn5euf9y0zrrh0z1:tubvkcdn4im449w84ayfm4j0yv2l7toy')
KD_REGION = ENV.get('KD_REGION', 'US')

SS_IDX = {'n': 0}
def get_proxy():
    """使用外部常驻 ss-local（socks5://127.0.0.1:1080）。
    2026-08-10：不再脚本内 pkill/重启 ss-local（会杀外部常驻实例导致 socks5 连不上）。
    节点轮换改为：外部脚本按需切换 /etc/shadowsocks-libev/config.json 后重启 ss-local。"""
    node = SS_POOL[SS_IDX['n'] % len(SS_POOL)]
    SS_IDX['n'] += 1
    log(f'  SS 节点: {node["server"]}:{node["port"]}')
    return {'proxy': 'socks5://127.0.0.1:1080', 'ip': f'{node["server"]}:{node["port"]}', 'ss': node}

def get_proxy_kd():
    """调快代理 fps 提取 API，返回 {proxy: 'http://auth@ip:port', ip: 'ip:port'}"""

def get_proxy_kd():
    """调快代理 fps 提取 API，返回 {proxy: 'http://auth@ip:port', ip: 'ip:port'}"""
    try:
        import urllib.request, urllib.parse
        url = ('https://fps.kdlapi.com/api/getfpsip/?secret_id=' + urllib.parse.quote(KD_SECRET_ID)
               + '&signature=' + urllib.parse.quote(KD_SIGNATURE)
               + '&region=' + KD_REGION + '&period=30&format=text&sep=1&num=3&ut=1&gt=1')
        with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'}), timeout=20) as r:
            ips = [l.strip() for l in r.read().decode().splitlines() if l.strip()]
        if not ips:
            return None
        ip = ips[0]
        return {'proxy': f'http://{KD_AUTH}@{ip}', 'ip': ip}
    except Exception as e:
        log(f'  代理提取失败: {str(e)[:60]}')
        return None

def make_ydl():
    import yt_dlp
    opts = {
        'format': 'best[height<=480]/best',
        'noplaylist': True,
        'quiet': True,
        'no_warnings': True,
        'outtmpl': '/tmp/indv_%(id)s.%(ext)s',
        'max_filesize': 150 * 1024 * 1024,
    }
    if PROXY:
        opts['proxy'] = PROXY
    return yt_dlp.YoutubeDL(opts)

def ydl_with_proxy(proxy_url):
    """带代理的 yt-dlp（优先快代理动态住宅，回退 OVERSEAS_PROXY）"""
    import yt_dlp
    opts = {
        'format': 'best[height<=480]/best',
        'noplaylist': True, 'quiet': True, 'no_warnings': True,
        'outtmpl': '/tmp/indv_%(id)s.%(ext)s',
        'max_filesize': 150 * 1024 * 1024,
    }
    if proxy_url:
        opts['proxy'] = proxy_url
    elif PROXY:
        opts['proxy'] = PROXY
    return yt_dlp.YoutubeDL(opts)

def fetch_one(industry, keyword):
    """下载一条 → multipart 上传本地 API（API 负责截帧/OSS 私有/入库）"""
    import yt_dlp
    try:
        # 每次下载前取新代理（快代理动态住宅 30 分钟有效，自动续）
        proxy_info = get_proxy()
        ydl = ydl_with_proxy(proxy_info['proxy'] if proxy_info else '')
        info = ydl.extract_info(f'ytsearch1:{keyword}', download=False)['entries'][0]
        vid_id = info.get('id', '')
        title = (info.get('title') or keyword)[:80]
        if not vid_id:
            log(f'  [{industry}] 无结果: {keyword}')
            return None
        ydl2 = make_ydl()
        ydl2.params['outtmpl'] = f'/tmp/indv_{vid_id}.%(ext)s'
        info2 = ydl2.extract_info(f'https://www.youtube.com/watch?v={vid_id}', download=True)
        file_path = ydl2.prepare_filename(info2)
        if not os.path.exists(file_path):
            candidates = [f'/tmp/indv_{vid_id}.mp4', f'/tmp/indv_{vid_id}.webm', f'/tmp/indv_{vid_id}.mkv']
            file_path = next((f for f in candidates if os.path.exists(f)), None)
        if not file_path or not os.path.exists(file_path):
            log(f'  [{industry}] 下载失败: {title}')
            return None
        # multipart 上传到本地 API（截帧 + OSS 私有转存 + 入库都在 API 端）
        import mimetypes
        CRLF = chr(13) + chr(10)
        boundary = '----indv' + str(int(time.time() * 1000))
        def field(name, value):
            return (f'--{boundary}' + CRLF + f'Content-Disposition: form-data; name="{name}"' + CRLF + CRLF + str(value) + CRLF).encode()
        def file_part(name, path):
            ct = mimetypes.guess_type(path)[0] or 'application/octet-stream'
            head = (f'--{boundary}' + CRLF + f'Content-Disposition: form-data; name="{name}"; filename="{os.path.basename(path)}"' + CRLF + f'Content-Type: {ct}' + CRLF + CRLF).encode()
            with open(path, 'rb') as fp:
                return head + fp.read() + CRLF.encode()
        body = field('industry', industry) + field('title', title) + field('keyword', keyword) + field('duration', str(info.get('duration') or ''))
        body += file_part('file', file_path) + (f'--{boundary}--' + CRLF).encode()
        import urllib.request
        req = urllib.request.Request(f'{API_BASE}/api/admin/industry-videos/upload', data=body,
            headers={'Content-Type': f'multipart/form-data; boundary={boundary}'}, method='POST')
        with urllib.request.urlopen(req, timeout=120) as resp:
            res = json.loads(resp.read().decode())
        try: os.remove(file_path)
        except: pass
        return res
    except Exception as e:
        log(f'  [{industry}] 异常: {str(e)[:80]}')
        return None

def main():
    log(f'开始按行业拉取：{len(INDUSTRY_KEYWORDS)} 行业 × {PER_INDUSTRY} 条，间隔 {INTERVAL}s')
    total = 0
    for industry, kws in INDUSTRY_KEYWORDS.items():
        for i in range(PER_INDUSTRY):
            kw = kws[i % len(kws)]
            log(f'[{industry}] 拉取 {kw} ...')
            r = fetch_one(industry, kw)
            if r and r.get('success'):
                total += 1
                log(f'  ✅ 入库: {(r.get("data") or {}).get("title", "")[:40]}')
            else:
                log(f'  ❌ 失败: {(r or {}).get("message", "无结果/下载失败")[:60]}')
            time.sleep(INTERVAL)
    log(f'完成，共入库 {total} 条')

if __name__ == '__main__':
    main()
