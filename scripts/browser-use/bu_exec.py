# -*- coding: utf-8 -*-
"""Browser-use 通用执行器：接收任务描述+文件 → AI 浏览器执行 → 输出 JSON 结果
用法: python bu_exec.py --task "..." --files "url1,url2" --profile "D:/bu_profile"
"""
import asyncio, os, sys, json, io, argparse, tempfile, urllib.request

def read_key():
    # 百炼 key（本地 .env.local——测试用；生产走环境变量）
    for env in [r'D:\AiMarketing\.env.local', r'/root/AiMarketing/.env.local']:
        try:
            for line in io.open(env, encoding='utf-8'):
                if line.startswith('DASHSCOPE_API_KEY='):
                    return line.split('=',1)[1].strip().strip('"').strip("'")
        except: pass
    return os.environ.get('DASHSCOPE_API_KEY', '')

def download_file(url, dest_dir):
    """下载文件（OSS 签名 URL 等）到本地——browser-use 上传用"""
    name = url.split('/')[-1].split('?')[0] or 'file_' + str(abs(hash(url)) % 10000) + '.mp4'
    dest = os.path.join(dest_dir, name)
    try:
        urllib.request.urlretrieve(url, dest)
        return dest
    except Exception as e:
        return None

async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--task', required=True)
    ap.add_argument('--files', default='')
    ap.add_argument('--profile', default=r'D:\bu_profile')
    ap.add_argument('--max-steps', type=int, default=15)
    args = ap.parse_args()

    dsk = read_key()
    if not dsk:
        print(json.dumps({'success': False, 'error': '未找到 DASHSCOPE_API_KEY'})); return

    from browser_use import Agent, Browser
    from browser_use.llm.openai.chat import ChatOpenAI

    # 下载文件到临时目录
    local_files = []
    tmp = tempfile.mkdtemp(prefix='bu_files_')
    for f in [x.strip() for x in args.files.split(',') if x.strip()]:
        if f.startswith('http'):
            p = download_file(f, tmp)
            if p: local_files.append(p)
        elif os.path.exists(f):
            local_files.append(f)

    browser = Browser(user_data_dir=args.profile, headless=False)
    llm = ChatOpenAI(model='qwen3.8-flash', api_key=dsk, base_url='https://dashscope.aliyuncs.com/compatible-mode/v1')
    # 文件路径提示（正斜杠——browser-use 严格匹配）
    file_hint = ('，文件路径：' + ','.join([p.replace(chr(92), '/') for p in local_files]) + '（用正斜杠/）') if local_files else ''
    agent = Agent(
        available_file_paths=[p.replace(chr(92), '/') for p in local_files],
        task=args.task + file_hint,
        llm=llm, browser=browser, max_steps=args.max_steps,
    )
    r = await agent.run()
    result = r.final_result() or ''
    print(json.dumps({'success': True, 'result': str(result)[:3000]}))
    try: await browser.close()
    except: pass

asyncio.run(main())
