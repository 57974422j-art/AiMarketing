# -*- coding: utf-8 -*-
"""Browser-use 通用执行器（2026-08-29 全链路修复版）：
1) API key 从环境变量（Electron spawn 传入）——不硬编码本机路径
2) executable_path 显式锁系统 Chrome（与扫码登录 profile 一致——防二进制混用 cookie 解密失败）
3) SingletonLock 检查——防 browser-use 退避临时目录（登录态丢主因）
"""
import asyncio, os, sys, json, io, argparse, tempfile, urllib.request, glob, time, shutil, subprocess, re
# 2026-09-08: 强制 UTF-8 输出（Windows 默认 GBK → 日志/服务器中文乱码根因）
if hasattr(sys.stdout, 'reconfigure'):
    try: sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception: pass
if hasattr(sys.stderr, 'reconfigure'):
    try: sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except Exception: pass

def read_key():
    """key 来源：环境变量优先 → 项目 .env.local（开发）"""
    k = os.environ.get('DASHSCOPE_API_KEY', '')
    if k: return k
    for env in [r'D:\AiMarketing\.env.local', r'/root/AiMarketing/.env.local']:
        try:
            for line in io.open(env, encoding='utf-8'):
                if line.startswith('DASHSCOPE_API_KEY='):
                    return line.split('=',1)[1].strip().strip('"').strip("'")
        except: pass
    return ''

def find_chrome():
    """系统 Chrome（与扫码登录 profile 一致——151）"""
    cands = [
        r'C:\Program Files\Google\Chrome\Application\chrome.exe',
        r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
        os.environ.get('LOCALAPPDATA', '') + r'\Google\Chrome\Application\chrome.exe',
    ]
    for c in cands:
        if os.path.exists(c): return c
    return None

def ensure_cdp_browser(url, profile, chrome, port=9222):
    """2026-09-08: 确保 bu_profile 浏览器已在 9222 调试端口运行（登录态常驻，不杀任何浏览器）
    不在则用登记同款方式打开（bu_profile + 调试端口 + 发布页 URL）——AI 不需要导航，页面直接到发布页
    返回 True=CDP 已就绪；False=打开失败（回退 user_data_dir 新开）"""
    def cdp_alive():
        try:
            with urllib.request.urlopen('http://127.0.0.1:%d/json/version' % port, timeout=2) as r:
                return r.status == 200
        except Exception:
            return False
    if cdp_alive():
        print('CDP: 已连接运行中的 bu_profile 浏览器（端口 %d）——复用登录态，不杀不重开' % port, flush=True)
        return True
    if chrome and profile and os.path.exists(profile):
        try:
            subprocess.Popen([chrome, '--user-data-dir=' + profile, '--remote-debugging-port=%d' % port, '--no-first-run', url or 'chrome://newtab/'])
            print('CDP: 已打开 bu_profile 浏览器（调试端口 %d）→ %s' % (port, url or ''), flush=True)
        except Exception as e:
            print('CDP_OPEN_FAIL: ' + str(e)[:100], flush=True)
    for _ in range(12):
        time.sleep(1)
        if cdp_alive():
            print('CDP: 浏览器就绪（登录态直接可用）', flush=True)
            return True
    print('CDP: 浏览器未就绪——回退 user_data_dir 新开', flush=True)
    return False

def kill_chrome():
    """2026-08-30: 发布前杀系统 Chrome（释放 Cookies 独占锁——否则 WinError 32 同步失败）"""
    try:
        if os.name == 'nt':
            # 2026-08-31: 发布前杀所有 Chrome（释放所有 profile 锁——wmic 匹配不到 browser-profile 已废弃）
            os.system('taskkill /F /IM chrome.exe >nul 2>&1')
            import time; time.sleep(2)
            print('KILL_CHROME: 系统 Chrome 已关闭（释放 Cookies 锁——发布完成后可重新打开）')
        else:
            os.system('pkill -f chrome 2>/dev/null; sleep 1')
    except Exception as e:
        print('KILL_CHROME_FAIL:', str(e)[:80])

def sync_system_login(profile):
    """2026-08-30: 同步系统 Chrome 登录态 → bu_profile（每次执行前——先杀 Chrome 释放锁——用日常登录态）"""
    kill_chrome()
    try:
        sys_default = os.path.join(os.environ.get('LOCALAPPDATA', ''), 'Google', 'Chrome', 'User Data', 'Default')
        sys_ck = os.path.join(sys_default, 'Network', 'Cookies')
        if not os.path.exists(sys_ck):
            print('SYNC: 系统 Chrome Cookies 不存在（未装 Chrome？）'); return False
        dst = os.path.join(profile, 'Default')
        os.makedirs(os.path.join(dst, 'Network'), exist_ok=True)
        shutil.copy2(sys_ck, os.path.join(dst, 'Network', 'Cookies'))  # 共享读——Chrome 运行中也常可读
        ls = os.path.join(os.path.dirname(sys_default), 'Local State')
        if os.path.exists(ls):
            os.makedirs(profile, exist_ok=True)
            shutil.copy2(ls, os.path.join(profile, 'Local State'))
        print('SYNC: 已同步系统 Chrome 登录态到 ' + profile)
        return True
    except Exception as e:
        print('SYNC_FAIL: ' + str(e)[:120]); return False

def check_singleton(profile):
    """SingletonLock 存在 = 有浏览器占用该 profile——报错（防退避临时目录丢登录态）"""
    lock = os.path.join(profile, 'SingletonLock')
    if os.path.exists(lock):
        return '浏览器窗口未关闭（bu_profile 被占用）——请先关闭 Browser Use 浏览器窗口再执行'
    return None

def download_file(url, dest_dir):
    # 2026-08-31: 文件名从 query name= 取（?name=xx.mp4 时 split('?')[0] 得 'file' 无扩展名——平台上传无法识别）
    qn = ''
    try:
        from urllib.parse import urlparse, parse_qs, unquote
        qn = unquote(parse_qs(urlparse(url).query).get('name', [''])[0])
    except Exception:
        qn = ''
    # 2026-08-31 security: 文件名清洗（去 ../ 和分隔符——防 name= 目录遍历写出）
    if qn:
        qn = qn.replace('..', '').replace('/', '').replace(chr(92), '')
    name = (qn if qn else (url.split('/')[-1].split('?')[0] or 'file_' + str(abs(hash(url)) % 10000) + '.mp4'))
    dest = os.path.join(dest_dir, name)
    try:
        # 带登录 cookie（storage/file 需鉴权——不带 401）
        req = urllib.request.Request(url, headers={'cookie': os.environ.get('BU_COOKIE', '')})
        urllib.request.urlretrieve(req, dest)
        return dest
    except Exception:
        return None

async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--task', required=True)
    ap.add_argument('--files', default='')
    ap.add_argument('--profile', default=r'D:\bu_profile')
    ap.add_argument('--max-steps', type=int, default=15)
    ap.add_argument('--storage-dir', default='')  # 本地仓库目录（exe/storage——持久镜像，复用不重复下载）
    args = ap.parse_args()

    # 2026-09-08: 不杀任何浏览器、不做 SingletonLock 检查——CDP 连接已登记的 bu_profile 浏览器（登记=发布同一条线）
    # 浏览器没开时 ensure_cdp_browser 用登记同款方式打开（bu_profile + 调试端口 + 发布页），登录态直接复用

    dsk = read_key()
    if not dsk:
        print(json.dumps({'success': False, 'error': '未找到 DASHSCOPE_API_KEY（环境变量或 .env.local）'})); return

    from browser_use import Agent, Browser
    from browser_use.llm.openai.chat import ChatOpenAI

    local_files = []
    # 本地仓库目录（持久镜像——优先复用本地已有文件，没有才下载；不下载临时目录）
    storage_dir = args.storage_dir or tempfile.mkdtemp(prefix='bu_files_')
    try:
        os.makedirs(storage_dir, exist_ok=True)
    except Exception:
        pass
    for f in [x.strip() for x in args.files.split(',') if x.strip()]:
        if f.startswith('http'):
            # 从 URL 取文件名，先查本地仓库是否已有（复用，不重复下载）
            try:
                from urllib.parse import urlparse, parse_qs, unquote
                _qn = unquote(parse_qs(urlparse(f).query).get('name', [''])[0])
            except Exception:
                _qn = ''
            _cached = os.path.join(storage_dir, _qn) if _qn else ''
            if _cached and os.path.exists(_cached):
                local_files.append(_cached)
            else:
                p = download_file(f, storage_dir)
                if p: local_files.append(p)
        elif os.path.exists(f):
            local_files.append(f)

    chrome = find_chrome()
    # 2026-09-08: 不再杀浏览器/不再 user_data_dir 新开——CDP 连接已登记的 bu_profile 浏览器（9222 端口）
    # 页面由登记通道直接开到发布页（带调试端口），AI 不做导航，登录态常驻复用
    # 2026-09-09: 平台发布页 URL 内置（task 极简后不含 URL——按平台名取，浏览器直接开对地址）
    _PLAT_URLS = {'抖音': 'https://creator.douyin.com/creator-micro/content/upload', '小红书': 'https://creator.xiaohongshu.com/publish/publish', '快手': 'https://cp.kuaishou.com/creator/video/upload', '视频号': 'https://channels.weixin.qq.com/platform/post/create', 'B站': 'https://member.bilibili.com/platform/upload/video/frame', 'bilibili': 'https://member.bilibili.com/platform/upload/video/frame', '微博': 'https://weibo.com/upload'}
    _t = str(args.task)
    _u = next((u for k, u in _PLAT_URLS.items() if k in _t), '')
    if not _u:
        _mm = re.search(r'https?://[A-Za-z0-9._\-/:?&=%#]+', _t)
        _u = _mm.group(0) if _mm else ''
    cdp_ok = ensure_cdp_browser(_u, args.profile, chrome)
    browser = Browser(cdp_url='http://127.0.0.1:9222') if cdp_ok else Browser(
        user_data_dir=args.profile,
        executable_path=chrome,
        headless=False,
    )
    llm = ChatOpenAI(model='qwen3.8-max', api_key=dsk, base_url='https://dashscope.aliyuncs.com/compatible-mode/v1')
    file_hint = ('，文件路径：' + ','.join([p.replace(chr(92), '/') for p in local_files]) + '（用正斜杠/）') if local_files else ''
    # 2026-09-08: 封面方向确定性——读封面图片实际尺寸，注入方向指令（不让 AI 猜横竖/乱切）
    cover_dir_hint = ''
    try:
        from PIL import Image as _PILImage
        for _f in local_files:
            if _f.lower().endswith(('.jpg', '.jpeg', '.png', '.webp')):
                _im = _PILImage.open(_f)
                _w, _h = _im.size
                _ratio = _w / float(_h)
                if _ratio > 1.1:
                    cover_dir_hint = '【封面方向提示】封面图是横屏4:3（' + str(_w) + 'x' + str(_h) + '）——抖音封面编辑器选「横屏4:3」选项卡再上传；若发布页强制竖屏(跟随竖视频)，横封面会被裁竖属正常，点图激活选区即可'
                elif _ratio < 0.9:
                    cover_dir_hint = '【封面方向提示】封面图是竖屏3:4（' + str(_w) + 'x' + str(_h) + '）——抖音封面编辑器选「竖屏3:4」选项卡再上传'
                else:
                    cover_dir_hint = '【封面方向提示】封面图近似方形（' + str(_w) + 'x' + str(_h) + '）——按发布页默认方向上传'
                break
    except Exception:
        cover_dir_hint = ''
    task_clean = args.task
    MANUAL = '发布这个视频到抖音：上传视频文件，等转码后填标题和话题，设置封面（按封面方向提示选方向，上传封面，图出现后点完成关弹窗），最后点发布。封面必须先完成再发布。'
    async def on_step(state, output, n):
        url = getattr(state, 'url', '') or ''
        try:
            act = getattr(output, 'action', None) or []
            acts = [str(a)[:100] for a in (act if isinstance(act, list) else [act])]
        except Exception:
            acts = [str(output)[:150]]
        print('[BU_STEP] ' + str(n) + ' url=' + url + ' action=' + json.dumps(acts, ensure_ascii=False), flush=True)
    # 2026-08-30 实测: qwen3.8 必须 use_thinking=False（思考模式 AgentOutput 验证失败——flash/无思考模式成功）
    agent = Agent(
        available_file_paths=[p.replace(chr(92), '/') for p in local_files],
        task=task_clean + file_hint + cover_dir_hint,
        llm=llm, browser=browser, use_thinking=False, use_vision=False, max_steps=args.max_steps,  # 2026-09-09: 关视觉(DOM 模式)——每步截图太慢(20分钟/单)，qwen3.8-max 读 DOM 决策快
        extend_system_message=MANUAL,
        register_new_step_callback=on_step,
    )
    print('[BU_START] task=' + str(args.task)[:200] + ' files=' + ','.join(local_files), flush=True)
    r = await agent.run()
    result = r.final_result() or ''
    print('[BU_DONE] result=' + str(result)[:800], flush=True)
    print(json.dumps({'success': True, 'result': str(result)[:3000]}))
    try: await agent.close()
    except Exception: pass

asyncio.run(main())
