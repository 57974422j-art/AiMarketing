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
    m_url = re.search(r'https?://[A-Za-z0-9._\-/:?&=%#]+', args.task)
    cdp_ok = ensure_cdp_browser(m_url.group(0) if m_url else '', args.profile, chrome)
    browser = Browser(cdp_url='http://127.0.0.1:9222') if cdp_ok else Browser(
        user_data_dir=args.profile,
        executable_path=chrome,
        headless=False,
    )
    llm = ChatOpenAI(model='qwen3.8-flash', api_key=dsk, base_url='https://dashscope.aliyuncs.com/compatible-mode/v1')  # 2026-09-09: flash(快，browser_use 大 DOM 不超时)  # 2026-09-08: qwen3.8-max 旗舰(原生多模态看图+强agentic)——browser_use use_vision 每步截图看页面，认上传框/封面按钮/方向tab——browser_use 每步截图给模型看（认抖音封面按钮/方向tab/问号 vs 真按钮），比 qwen3-max 看 DOM 文本准
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
    MANUAL = '按任务描述执行发布：页面已由登记通道打开到目标平台的发布页（登录态在），【绝对不要打开/导航/输入任何网址】，直接从上传开始。发布顺序固定为：①upload_file 上传视频 ②等转码跳编辑页 ③填标题 ④填话题（填完按 Escape 关联想浮层）⑤设置封面（选方向→传封面→点图激活→点完成）⑥点发布——【按这个顺序一步接一步往下做，不要回看菜单/不要反复犹豫】。若连续 2 步页面没变化，按 Escape 或直接做下一步，绝不原地傻等。每步只做一个动作。填完标题或话题后如果弹出联想下拉框/浮层挡住内容：【按 Escape 键关闭】——用 send_keys 发 Escape（抖音页面空白处无可点击元素，点空白无效）；按一次没关再按第二次，关掉再继续。上传封面必须严格按此顺序（缺一步封面就会不生效/错乱）：①点「设置封面」打开封面弹窗 ②【先选方向】——严格按任务说明里【封面方向提示】选对应选项卡（提示横屏4:3就点「横屏4:3」，提示竖屏3:4就点「竖屏3:4」，先看提示再操作，不要自己猜视频横竖、不要乱切方向）；方向选项在封面弹窗/编辑器顶部或比例图标处，必须先选方向再上传③选好方向后点「上传封面」上传封面文件 ④上传后封面图出现在编辑器里：【点击一下封面图片中央】激活裁切选区（图比例与选区不一致时可点图微调，不强行拖拽） ⑤封面图在编辑器显示后【直接点「完成」】关闭封面弹窗——抖音封面弹窗收尾按钮就叫「完成」，没有「下一步」或「保存」按钮，不要去找 ⑥封面弹窗关闭后、发布页封面已变成上传的图 → 最后点【发布】按钮（发布按钮在编辑页底部，可能需滚动页面才可见——DOM 里找文本含「发布」的按钮点，不靠截图猜位置）；点发布后若弹确认/定时/推荐选项，按页面默认或点「确认/发布」。填标题话题若字数超限，删超出部分再提交，不要反复重试输入。同一目标连点超过2次没变化就停下换思路；不要点问号/帮助图标（无用且会开浮层）。若页面弹手机短信/滑块/扫码等人工验证→立即停止，报告「需要人工验证码，请用户处理」，绝不反复点击或假装成功。'
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
