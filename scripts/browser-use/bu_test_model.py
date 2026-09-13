# -*- coding: utf-8 -*-
import asyncio, json, sys, os
from dotenv import load_dotenv
load_dotenv('.env.local')

MODELS = [
    ('qwen-max', 'https://dashscope.aliyuncs.com/compatible-mode/v1', os.getenv('DASHSCOPE_API_KEY')),
    ('deepseek-chat', 'https://api.deepseek.com/v1', os.getenv('DEEPSEEK_API_KEY')),
    ('qwen-plus', 'https://dashscope.aliyuncs.com/compatible-mode/v1', os.getenv('DASHSCOPE_API_KEY')),
]

async def run_one(model, base_url, api_key):
    from browser_use import Agent, Browser
    from browser_use.llm.openai.chat import ChatOpenAI
    try:
        browser = Browser(headless=True)
        llm = ChatOpenAI(model=model, api_key=api_key, base_url=base_url)
        agent = Agent(
            task='打开网址 https://creator.douyin.com/creator-micro/content/upload （这是发布页，直接导航，不要搜索）',
            llm=llm, browser=browser, use_thinking=False, max_steps=3,
        )
        r = await agent.run()
        result = (r.final_result() or '')[:200]
        print(json.dumps({'model': model, 'ok': True, 'result': result}, ensure_ascii=False), flush=True)
        await agent.close()
    except Exception as e:
        print(json.dumps({'model': model, 'ok': False, 'error': str(e)[:250]}, ensure_ascii=False), flush=True)

async def main():
    which = sys.argv[1] if len(sys.argv) > 1 else 'all'
    for model, base, key in MODELS:
        if which != 'all' and which not in model:
            continue
        if not key:
            print(json.dumps({'model': model, 'ok': False, 'error': '无 key'}, ensure_ascii=False), flush=True)
            continue
        await run_one(model, base, key)

asyncio.run(main())
