# -*- coding: utf-8 -*-
import json, urllib.request, io, os
from dotenv import load_dotenv
load_dotenv('.env.local')

TASK = "你现在是一个浏览器操作机器人。任务：发布视频到抖音创作者中心。视频文件是 001.mp4，封面是 cover.jpg，标题是「AI营销」，话题是「#短视频」。请告诉我你应该按什么步骤操作（先做什么、再做什么、最后做什么）。"

MODELS = [
    ('qwen-plus', 'https://dashscope.aliyuncs.com/compatible-mode/v1', os.getenv('DASHSCOPE_API_KEY')),
    ('qwen-max', 'https://dashscope.aliyuncs.com/compatible-mode/v1', os.getenv('DASHSCOPE_API_KEY')),
    ('qwen3-flash', 'https://dashscope.aliyuncs.com/compatible-mode/v1', os.getenv('DASHSCOPE_API_KEY')),
    ('qwen3-max', 'https://dashscope.aliyuncs.com/compatible-mode/v1', os.getenv('DASHSCOPE_API_KEY')),
    ('deepseek-chat', 'https://api.deepseek.com/v1', os.getenv('DEEPSEEK_API_KEY')),
    ('deepseek-reasoner', 'https://api.deepseek.com/v1', os.getenv('DEEPSEEK_API_KEY')),
]

for model, base, key in MODELS:
    if not key:
        print(f"[{model}] 无 key，跳过")
        continue
    body = json.dumps({"model": model, "messages": [{"role":"user","content": TASK}], "max_tokens": 400}).encode('utf-8')
    req = urllib.request.Request(base + '/chat/completions', data=body, headers={"Authorization":"Bearer "+key, "Content-Type":"application/json"})
    try:
        d = json.load(urllib.request.urlopen(req, timeout=60))
        reply = d['choices'][0]['message']['content']
        print(f"\n===== {model} =====")
        print(reply[:400])
    except Exception as e:
        print(f"\n===== {model} ===== 错误: {str(e)[:120]}")
