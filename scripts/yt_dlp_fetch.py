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

def make_ydl():
    import yt_dlp
    opts = {
        'format': 'best[height<=480][ext=mp4]/best[height<=480]/best',
        'noplaylist': True,
        'quiet': True,
        'no_warnings': True,
        'outtmpl': '/tmp/indv_%(id)s.%(ext)s',
        'max_filesize': 150 * 1024 * 1024,
    }
    if PROXY:
        opts['proxy'] = PROXY
    return yt_dlp.YoutubeDL(opts)

def fetch_one(industry, keyword):
    """下载一条 → multipart 上传本地 API（API 负责截帧/OSS 私有/入库）"""
    import yt_dlp
    try:
        ydl = make_ydl()
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
