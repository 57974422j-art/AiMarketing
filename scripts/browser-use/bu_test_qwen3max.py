# -*- coding: utf-8 -*-
import asyncio, os
from dotenv import load_dotenv
load_dotenv('.env.local')
async def main():
    from browser_use import Agent, Browser
    from browser_use.llm.openai.chat import ChatOpenAI
    try:
        browser = Browser(headless=True)
        llm = ChatOpenAI(model='qwen3-max', api_key=os.getenv('DASHSCOPE_API_KEY'), base_url='https://dashscope.aliyuncs.com/compatible-mode/v1')
        agent = Agent(task='打开网址 https://creator.douyin.com/creator-micro/content/upload 并报告是否打开成功', llm=llm, browser=browser, use_thinking=False, max_steps=2)
        r = await agent.run()
        print('RESULT:', (r.final_result() or '')[:200])
        await agent.close()
    except Exception as e:
        print('ERROR:', str(e)[:300])
asyncio.run(main())
