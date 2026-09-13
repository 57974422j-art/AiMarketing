# -*- coding: utf-8 -*-
"""连测百炼生图：耗时 + 成功率（判断"偶发失败"还是必然失败）"""
import io, sys, json, re, time, urllib.request, urllib.error
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
env = io.open('D:/AiMarketing/.env.local', encoding='utf-8').read()
key = (re.search(r'^DASHSCOPE_API_KEY=(.*)$', env, re.M) or [None, ''])[1].strip()

def post(body):
    req = urllib.request.Request('https://dashscope.aliyuncs.com/api/v1/services/aigc/image-generation/generation',
                                 data=json.dumps(body).encode(), method='POST',
                                 headers={'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json', 'X-DashScope-Async': 'enable'})
    try:
        return json.loads(urllib.request.urlopen(req, timeout=40).read().decode('utf-8', 'replace'))
    except urllib.error.HTTPError as e:
        return {'_http': e.code, '_body': e.read(400).decode('utf-8', 'replace')}

def get(tid):
    req = urllib.request.Request('https://dashscope.aliyuncs.com/api/v1/tasks/' + tid, headers={'Authorization': 'Bearer ' + key})
    try:
        return json.loads(urllib.request.urlopen(req, timeout=30).read().decode('utf-8', 'replace'))
    except Exception as e:
        return {'_err': str(e)[:120]}

for n in range(3):
    t0 = time.time()
    r = post({'model': 'qwen-image-3.0-pro', 'input': {'messages': [{'role': 'user', 'content': [{'text': '手工音乐盒，暖光，营销封面风格'}]}]}, 'parameters': {'size': '1080*1440', 'n': 1}})
    tid = (r.get('output') or {}).get('task_id')
    if not tid:
        print('#%d 提交失败: %s' % (n + 1, json.dumps(r, ensure_ascii=False)[:250]), flush=True)
        continue
    st, d = '', {}
    while time.time() - t0 < 260:
        time.sleep(8)
        d = get(tid)
        st = ((d.get('output') or {}).get('task_status')) or '?'
        if st in ('SUCCEEDED', 'FAILED', 'UNKNOWN'):
            break
    el = int(time.time() - t0)
    extra = ''
    if st == 'SUCCEEDED':
        try:
            extra = ' url=' + str(d['output']['choices'][0]['message']['content'][0]['image'])[:60]
        except Exception:
            extra = ' ★取 url 失败（结构不同！）: ' + json.dumps(d.get('output') or {}, ensure_ascii=False)[:200]
    print('#%d %s  耗时 %ds%s' % (n + 1, st, el, extra), flush=True)
    if st in ('FAILED', 'UNKNOWN'):
        print('   详情:', json.dumps(d.get('output') or d, ensure_ascii=False)[:400], flush=True)
print('DONE', flush=True)
