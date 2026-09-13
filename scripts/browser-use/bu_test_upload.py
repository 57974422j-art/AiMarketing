# -*- coding: utf-8 -*-
# 验证 browser-use AI 能否正确 upload_file（上传视频+封面）
import asyncio, os, json
from dotenv import load_dotenv
load_dotenv('.env.local')

FILES = [r'E:\ai-marketing\storage\20260821_001.mp4', r'E:\ai-marketing\storage\20260821_001.jpg']

async def on_step(state, output, n):
    url = getattr(state, 'url', '') or ''
    try:
        act = getattr(output, 'action', None) or []
        acts = [str(a)[:100] for a in (act if isinstance(act, list) else [act])]
    except Exception:
        acts = [str(output)[:150]]
    print(f"[STEP {n}] url={url} action={acts}", flush=True)

async def main():
    from browser_use import Agent, Browser
    from browser_use.llm.openai.chat import ChatOpenAI
    try:
        browser = Browser(user_data_dir=os.environ.get('APPDATA', '') + r'\ai-marketingrowser-profile', executable_path=r'C:\Program Files\Google\Chrome\Application\chrome.exe', headless=False)
        llm = ChatOpenAI(model='qwen3-max', api_key=os.getenv('DASHSCOPE_API_KEY'), base_url='https://dashscope.aliyuncs.com/compatible-mode/v1')
        agent = Agent(
            task='打开 https://creator.douyin.com/creator-micro/content/upload ，然后把 available_file_paths 里的视频文件（.mp4）和封面图（.jpg）用上传动作传上去',
            llm=llm, browser=browser, use_thinking=False, max_steps=6,
            available_file_paths=FILES,
            register_new_step_callback=on_step,
        )
        r = await agent.run()
        print('FINAL:', (r.final_result() or '')[:300], flush=True)
        await agent.close()
    except Exception as e:
        print('ERROR:', str(e)[:300], flush=True)

asyncio.run(main())
