# -*- coding: utf-8 -*-
# 测试 cdp_url 连接 Default profile（tao Zhou 登录态）
import asyncio, subprocess, time, os
CHROME = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
UD = os.environ['LOCALAPPDATA'] + r'\Google\Chrome\User Data'

# 1. 指定 Default profile 带调试端口启动（不弹账号选择器）
subprocess.Popen([CHROME, '--remote-debugging-port=9222', '--user-data-dir=' + UD, '--profile-directory=Default', '--no-first-run', '--no-default-browser-check'])
print('[cdp] Chrome 启动中（Default profile + 9222）')
time.sleep(8)

from browser_use import Browser, Agent
from browser_use.llm.openai.chat import ChatOpenAI
from dotenv import load_dotenv
load_dotenv('.env.local')

async def main():
    try:
        browser = Browser(cdp_url='http://127.0.0.1:9222')
        llm = ChatOpenAI(model='qwen-plus', api_key=os.getenv('DASHSCOPE_API_KEY'), base_url='https://dashscope.aliyuncs.com/compatible-mode/v1')
        agent = Agent(
            task='打开 https://creator.douyin.com/creator-micro/content/upload ，然后告诉我：页面是已登录（能看到发布/上传按钮或创作者后台），还是显示登录/扫码界面',
            llm=llm, browser=browser, use_thinking=False, max_steps=3,
        )
        r = await agent.run()
        print('RESULT:', (r.final_result() or '')[:300])
        await agent.close()
    except Exception as e:
        print('ERROR:', str(e)[:300])

asyncio.run(main())
