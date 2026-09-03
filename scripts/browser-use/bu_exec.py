# -*- coding: utf-8 -*-
"""Browser-use 通用执行器（2026-08-29 全链路修复版）：
1) API key 从环境变量（Electron spawn 传入）——不硬编码本机路径
2) executable_path 显式锁系统 Chrome（与扫码登录 profile 一致——防二进制混用 cookie 解密失败）
3) SingletonLock 检查——防 browser-use 退避临时目录（登录态丢主因）
"""
import asyncio, os, sys, json, io, argparse, tempfile, urllib.request, glob, time, shutil

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
        urllib.request.urlretrieve(url, dest)
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

    # 2026-08-31: 发布前杀 Chrome 释放 profile 锁（之前未调用——被占时 check_singleton 报“窗口未关闭”死锁）
    kill_chrome()
    # SingletonLock 检查（登录态保持关键）
    lock_err = check_singleton(args.profile)
    if lock_err:
        print(json.dumps({'success': False, 'error': lock_err})); return

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
    # 显式锁浏览器二进制（系统 Chrome——与 profile 一致）——防打包后 PLAYWRIGHT_BROWSERS_PATH 混用 chromium-1223
    # 2026-08-30: 不用同步复制（Chrome 不认复制登录态——bu_profile 用自己的登录态——30 天有效）
    # 发布前 kill_chrome 已释放 bu_profile 锁（浏览器可打开）
    browser = Browser(
        user_data_dir=args.profile,
        executable_path=chrome,  # 显式（None 则 browser-use 自行查找）
        headless=False,
    )
    llm = ChatOpenAI(model='qwen-plus', api_key=dsk, base_url='https://dashscope.aliyuncs.com/compatible-mode/v1')
    file_hint = ('，文件路径：' + ','.join([p.replace(chr(92), '/') for p in local_files]) + '（用正斜杠/）') if local_files else ''
    task_clean = args.task
    MANUAL = '【发布任务——严格按以下步骤执行，禁止搜索、禁止导航到任务指定之外的地址】' + chr(10) + '第1步：用 go_to_url 导航到任务里给出的完整网址（禁止搜索、禁止导航其他网址）' + chr(10) + '第2步：确认已登录（看到上传按钮=已登录；出现登录/扫码界面则停止并报告未登录）' + chr(10) + '第3步：用 upload_file 上传 available_file_paths 里扩展名 .mp4/.mov 的视频文件（这是本地文件不是网址，禁止把文件名当网址输入），再用 upload_file 上传 .jpg/.png 的封面图' + chr(10) + '第4步：等上传完成，标题框填任务里的标题、话题框填话题' + chr(10) + '第5步：点发布按钮' + chr(10) + '每步只做一个动作，完成后报告每一步做了什么'
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
        task=task_clean + file_hint,
        llm=llm, browser=browser, use_thinking=False, max_steps=args.max_steps,
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
