# -*- coding: utf-8 -*-
# 测试：正确 profile（browser-profile 登记登录态）+ 发布手册 + 每步日志
import asyncio, os, json
from dotenv import load_dotenv
load_dotenv('.env.local')

PROFILE = os.environ.get('APPDATA', '') + r'\AI-Marketing\browser-profile'
MANUAL = """【发布任务——严格按以下步骤执行，禁止搜索、禁止导航到任何非指定地址】
第1步：用 go_to_url 导航到 https://creator.douyin.com/creator-micro/content/upload
第2步：报告页面是已登录状态还是登录页，然后停在发布页即可"""

async def on_step(state, output, n):
    url = getattr(state, 'url', '') or ''
    try:
        act = getattr(output, 'action', None) or []
        acts = [str(a)[:80] for a in (act if isinstance(act, list) else [act])]
    except Exception:
        acts = [str(output)[:120]]
    print(f"[STEP {n}] url={url} action={acts}", flush=True)

async def main():
    from browser_use import Agent, Browser
    from browser_use.llm.openai.chat import ChatOpenAI
    try:
        browser = Browser(user_data_dir=PROFILE, executable_path=r'C:\Program Files\Google\Chrome\Application\chrome.exe', headless=False)
        llm = ChatOpenAI(model='qwen-plus', api_key=os.getenv('DASHSCOPE_API_KEY'), base_url='https://dashscope.aliyuncs.com/compatible-mode/v1')
        agent = Agent(
            task='打开发布页并报告登录状态',
            llm=llm, browser=browser, use_thinking=False, max_steps=3,
            extend_system_message=MANUAL,
            register_new_step_callback=on_step,
        )
        r = await agent.run()
        print('FINAL:', (r.final_result() or '')[:300], flush=True)
        await agent.close()
    except Exception as e:
        print('ERROR:', str(e)[:300], flush=True)

asyncio.run(main())
