# -*- coding: utf-8 -*-
"""百炼流式 ASR 双向代理（2026-08-07）
前端 ws 连 127.0.0.1:8766 → 本服务转发到百炼（paraformer-realtime-v2，Bearer 认证）
前端发 PCM binary 帧；百炼结果解析后转发 {action:result,text,final}；前端发 {action:finish} 结束
"""
import asyncio, json, os, sys
import websockets

# 读 DASHSCOPE_API_KEY（环境变量 → .env.local）
def get_key():
    k = os.environ.get('DASHSCOPE_API_KEY', '')
    if k: return k
    try:
        envp = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '.env.local')
        for line in open(envp, encoding='utf-8'):
            if line.startswith('DASHSCOPE_API_KEY='):
                return line.split('=', 1)[1].strip().strip('"').strip("'")
    except Exception: pass
    return ''

KEY = get_key()
WS_URL = 'wss://dashscope.aliyuncs.com/api-ws/v1/inference/'
PORT = int(os.environ.get('DASHASR_PORT', '8766'))

print(f'[dashscope-asr] key loaded: {bool(KEY)}', flush=True)

async def proxy(peer):
    if not KEY:
        await peer.send(json.dumps({'action': 'error', 'desc': 'DASHSCOPE_API_KEY 未配置'}))
        return
    try:
        async with websockets.connect(WS_URL, extra_headers={'Authorization': f'bearer {KEY}'}, max_size=1 << 22) as ds:
            task_id = os.urandom(16).hex()
            # run-task 初始化
            await ds.send(json.dumps({
                'header': {'action': 'run-task', 'task_id': task_id, 'streaming': 'duplex'},
                'payload': {
                    'task_group': 'audio', 'task': 'asr', 'function': 'recognition',
                    'model': 'paraformer-realtime-v2',
                    'parameters': {'sample_rate': 16000, 'format': 'pcm', 'language_hints': ['zh'],
                                   'punctuation_prediction': True, 'inverse_text_normalization': True,
                                   # 2026-08-07 热词：产品词注入识别层，防同音误识（纹身视频→文生视频）
                                   'hotwords': ['文生视频', '文生图', '一键成片', '热点大屏', '数字人', '素材库',
                                                '指纹浏览器', '数据看板', 'AI文案', 'AI生图', '抖音', '小红书',
                                                '快手', '视频号', 'B站', '百家号', '今日头条', '自动发布',
                                                '发布视频', '口播', '配音', '字幕', '混剪', '口型', '换脸',
                                                '翻译', '贴纸', '标题', '热点', '爆款', '文案', '脚本', '音乐']},
                    'input': {},
                },
            }))

            async def pump():
                # 百炼 → 前端
                async for msg in ds:
                    try:
                        j = json.loads(msg)
                        ev = j.get('header', {}).get('event')
                        if ev == 'result-generated':
                            s = j.get('payload', {}).get('output', {}).get('sentence', {})
                            if s and s.get('text'):
                                print(f"[dashscope-asr] result status={s.get('status')} text={s['text'][:40]}", flush=True)
                                await peer.send(json.dumps({'action': 'result', 'text': s['text'],
                                    'final': s.get('status') == 'sentence_end'}))
                        elif ev == 'task-failed':
                            await peer.send(json.dumps({'action': 'error', 'desc': j.get('header', {}).get('error_message', '')}))
                    except Exception:
                        pass

            async def push():
                # 前端 → 百炼
                async for msg in peer:
                    if isinstance(msg, bytes):
                        await ds.send(msg)
                    else:
                        try:
                            j = json.loads(msg)
                            if j.get('action') == 'finish':
                                await ds.send(json.dumps({'header': {'action': 'finish-task', 'task_id': task_id, 'streaming': 'duplex'}, 'payload': {'input': {}}}))
                        except Exception:
                            pass

            await asyncio.gather(pump(), push())
    except Exception as e:
        try:
            await peer.send(json.dumps({'action': 'error', 'desc': str(e)}))
        except Exception:
            pass

async def main():
    async with websockets.serve(proxy, '127.0.0.1', PORT, max_size=1 << 22):
        print(f'[dashscope-asr] listening 127.0.0.1:{PORT}', flush=True)
        await asyncio.Future()

if __name__ == '__main__':
    asyncio.run(main())
