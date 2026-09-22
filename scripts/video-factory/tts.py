#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""分句配音（★VIDEO_FACTORY_TTS_V1）

作用：把分镜里每镜的文案【逐句合成 mp3】，并把【真实时长】回填到分镜
      —— 这是"唯一真相源"：镜头时长由配音时长决定，不靠猜。

为什么这么做：见 docs/成片工作流方案-借鉴开源研究.md
  · 抄 creator-pipeline 的 SRT 思路（按实际合成音频计时）
  · 抄 video-talkcraft 的"声音锁"（画面跟着声音走）

用法:
  python tts.py --storyboard sb.json --workdir temp/vf [--speaker zh_female_vv_uranus_bigtts]
                [--out-json sb.with-voice.json] [--merge out.m4a]
  python tts.py --text "测试一句话" --out test.mp3     # 单句测试

★VF_DASHSCOPE_V1（2026-09-18）：主用【百炼 CosyVoice】（与 src/lib/ai-providers.ts 的 dashscopeTTS 同协议），
火山 openspeech v3 作为兜底 —— 项目 TTS 现已以百炼为主，服务器上只要有 DASHSCOPE_API_KEY 就能配音。
凭据定位（跨平台）：进程环境变量优先 → VF_ENV_FILE → 从脚本位置逐级向上找 .env.local → cwd。
  百炼：DASHSCOPE_API_KEY（音色可用 DASHSCOPE_TTS_VOICE 覆盖，默认 longxiaochun）
  火山：VOLCANO_TTS_APP_ID / VOLCANO_TTS_ACCESS_KEY / VOLCANO_TTS_RESOURCE_ID（兜底）
"""
import argparse
import base64
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.request
import urllib.error

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

HERE = os.path.dirname(os.path.abspath(__file__))
SPEAKER = ''                     # 留空 = 用所选引擎的默认音色（百炼 longxiaochun / 火山 zh_female_vv_uranus_bigtts）
VOLCANO_SPEAKER = 'zh_female_vv_uranus_bigtts'
# ★VF_VOICE_MAP_V1（2026-09-20，用户实测“成片只有 BGM、没有人声”的根因）：
#   网页表单里的音色是【百炼】id（longxiaochun…），TS 侧原样透传成 --speaker，
#   火山兜底收到百炼音色名 → 火山不认识 → **每一镜都失败** → 无声片（时长停在 AI 默认值）。
#   这里把百炼音色映射到项目内已在用的火山音色（清单见 src/app/video-edit/page.tsx）。
VOLCANO_VOICE_MAP = {
    'longxiaochun': 'zh_female_vv_magic_bigtts',    # 女声温柔
    'longxiaoxia': 'zh_female_vv_uranus_bigtts',   # 女声清亮（通用女声）
    'cherry': 'zh_female_vv_yuheng_bigtts',        # 女声甜美
    'longshu': 'zh_male_vv_shuhao_bigtts',         # 男声沉稳
    'longchen': 'zh_male_vv_yezhu_bigtts',         # 男声浑厚（磁性）
    'longjing': 'zh_male_vv_uranus_bigtts',        # 男声知性（通用男声）
    'longxiaohui': 'zh_male_xiaoming_bigtts',      # 男声阳光
}


def volcano_speaker(sp):
    """把音色名规整成【火山】能认的：已是火山 id（zh_/en_ 开头）或为空 → 原样/默认；
    否则按百炼→火山映射（认不出的克隆音色 → 默认女声，宁可出声也不静音）。"""
    s = (sp or '').strip()
    if not s:
        return VOLCANO_SPEAKER
    if s.startswith('zh_') or s.startswith('en_'):
        return s
    m = VOLCANO_VOICE_MAP.get(s)
    if m:
        print('[TTS] 音色映射: %s（百炼）→ %s（火山）' % (s, m))
        return m
    print('[TTS] ⚠️ 未知音色「%s」→ 用火山默认 %s（克隆音色火山不支持，宁可出声不静音）' % (s, VOLCANO_SPEAKER))
    return VOLCANO_SPEAKER


DASHSCOPE_VOICE = os.environ.get('DASHSCOPE_TTS_VOICE') or 'longxiaochun'
URL = 'https://openspeech.bytedance.com/api/v3/tts/unidirectional'
# ★VF_DASH_DEFAULT_V1（2026-09-20 实测）：百炼 TTS 已换代——
#   老：services/tts/generation + cosyvoice-v1（异步）→ **实测 400 "task can not be null"**（已下线）
#   新：services/aigc/multimodal-generation/generation + qwen3-tts-flash（**同步**，不能带 X-DashScope-Async）
DASHSCOPE_TTS_URL = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation'
DASHSCOPE_TTS_MODEL_DEFAULT = 'qwen3-tts-flash'
DASHSCOPE_TTS_STYLE_DEFAULT = 'v3'
DASHSCOPE_TASK_URL = 'https://dashscope.aliyuncs.com/api/v1/tasks/%s'
FFMPEG_CANDS = [os.environ.get('FFMPEG_PATH', ''), r'C:\ffmpeg\bin\ffmpeg.exe', 'ffmpeg']
FFPROBE_CANDS = [os.environ.get('FFPROBE_PATH', ''), r'C:\ffmpeg\bin\ffprobe.exe', 'ffprobe']


def find_exe(cands, name):
    for p in cands:
        if not p:
            continue
        if p == name or os.path.exists(p):
            return p
    return name


# ★VF_LINUX_V1（2026-09-18）：凭据定位改为【跨平台】。
#   原来硬编码 D:\AiMarketing\.env.local —— 部署到 Linux 服务器（/root/AiMarketing）后读不到火山 key，
#   配音静默失败 → 出无声片。现在按顺序找：
#     ① 进程环境变量（PM2 / DOTENV_CONFIG_PATH 注入的 .env 会传给子进程，服务器首选）
#     ② VF_ENV_FILE 显式指定
#     ③ 从脚本位置逐级向上找 .env.local（本地 =D:\AiMarketing\.env.local，服务器 =/root/AiMarketing/.env.local）
#     ④ 当前工作目录 .env.local
def _env_file_candidates():
    cands = []
    if os.environ.get('VF_ENV_FILE'):
        cands.append(os.environ['VF_ENV_FILE'])
    d = HERE
    for _ in range(4):
        cands.append(os.path.join(d, '.env.local'))
        nd = os.path.dirname(d)
        if nd == d:
            break
        d = nd
    cands.append(os.path.join(os.getcwd(), '.env.local'))
    return cands


def load_env(paths=None):
    d = {}
    for p in (paths if paths is not None else _env_file_candidates()):
        if not p or not os.path.exists(p):
            continue
        try:
            for line in open(p, encoding='utf-8'):
                line = line.strip()
                if not line or line.startswith('#') or '=' not in line:
                    continue
                k, v = line.split('=', 1)
                d[k.strip()] = v.strip().strip('"').strip("'")
            print('[TTS] 环境变量文件: %s' % p)
            return d
        except Exception:
            continue
    return d


ENV = load_env()
_CRED_WARNED = [False]
# ★VF_TTSERR_V1：百炼失败一次后，本次运行不再重试（否则每一镜都白跑一遍、还刷一堆日志）
_DASH_DEAD = [False]


def env_get(key, default=''):
    """凭据读取：进程环境变量优先（服务器注入），其次 .env.local"""
    return (os.environ.get(key) or ENV.get(key) or default)


def _tts_order():
    """★VF_TTS_ORDER_V1（2026-09-20）：配音引擎顺序可配（不用改代码）。
    默认 'dashscope,minimax,silicon' = **百炼(qwen3-tts-flash，音质最好) → Minimax → 硅基**。
    ★火山已从默认链移除（用户定案）；要启用就在 .env.local 写 VF_TTS_ORDER=...,volcano"""
    return [x.strip() for x in (env_get('VF_TTS_ORDER') or 'dashscope,minimax,silicon').split(',') if x.strip()]


# 跨引擎音色映射：表单里用户选的是【百炼】id → 各引擎认自己的名字
# 火山已实测可用；Minimax 的 voice_id 需按官方列表核对（可用 MINIMAX_TTS_VOICE 直接覆盖）
MINIMAX_VOICE_MAP = {
    'longxiaochun': 'female-shaonv',
    'longxiaoxia': 'female-yujie',
    'cherry': 'female-tianmei',
    'longshu': 'male-qn-qingse',
    'longchen': 'male-qn-jingying',
    'longjing': 'male-qn-badao',
    'longxiaohui': 'male-qn-daxuesheng',
}


def minimax_voice(sp):
    """百炼音色 → Minimax voice_id（认不出 → 用 MINIMAX_TTS_VOICE 或默认女声）"""
    s = (sp or '').strip()
    if s and not s.startswith('zh_') and not s.startswith('en_'):
        m = MINIMAX_VOICE_MAP.get(s)
        if m:
            return m
    return env_get('MINIMAX_TTS_VOICE') or 'female-shaonv'


# ★VF_QWEN3_VOICE_V1（2026-09-20 实测）：百炼新端点（multimodal-generation）+ qwen3-tts-flash
#   只认 Cherry / Serena / Ethan / Chelsie 这几个音色。
QWEN3_VOICE_MAP = {
    'longxiaochun': 'Cherry',    # 女声温柔（默认）
    'longxiaoxia': 'Serena',     # 女声清亮
    'cherry': 'Chelsie',         # 女声甜美
    'longshu': 'Ethan',          # 男声沉稳
    'longchen': 'Ethan',         # 男声浑厚
    'longjing': 'Ethan',         # 男声知性
    'longxiaohui': 'Ethan',      # 男声阳光
}


def qwen3_voice(sp):
    """百炼音色 → qwen3-tts 音色"""
    s = (sp or '').strip()
    if s in ('Cherry', 'Serena', 'Ethan', 'Chelsie'):
        return s
    m = QWEN3_VOICE_MAP.get(s)
    if m:
        print('[TTS] 音色映射: %s（百炼）→ %s（qwen3-tts）' % (s, m))
        return m
    return 'Cherry'


def _dig_audio_url(obj, depth=0):
    """在返回 JSON 里“挖”出音频 url（兼容“同步直出”与各种嵌套）"""
    if depth > 6:
        return ''
    if isinstance(obj, dict):
        for k in ('url', 'audio_url', 'audio'):
            v = obj.get(k)
            if isinstance(v, str) and v.startswith('http'):
                return v
        for v in obj.values():
            r = _dig_audio_url(v, depth + 1)
            if r:
                return r
    elif isinstance(obj, list):
        for v in obj:
            r = _dig_audio_url(v, depth + 1)
            if r:
                return r
    return ''


def _write_audio(buf, out_path):
    """写音频文件 → 返回时长秒（失败 0.0）"""
    if not buf or len(buf) < 200:
        return 0.0
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    with open(out_path, 'wb') as f:
        f.write(buf)
    return mp3_duration(out_path)


def _tts_dashscope(text, out_path, voice):
    """百炼（异步提交 + 轮询 + 下载 mp3）。未配 key / 失败 时返回 0.0（交给下一引擎兜底）。

    ★VF_DASH_CFG_V1（2026-09-20）：端点/模型/请求体风格**全可配**（填 .env.local 即可，不用改代码）：
      DASHSCOPE_TTS_URL    默认 https://dashscope.aliyuncs.com/api/v1/services/tts/generation
                           （★实测该路径 400；百炼文档路径是
                             https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation）
      DASHSCOPE_TTS_MODEL  默认 cosyvoice-v1（官方已推荐迁移到 cosyvoice-v3-flash / qwen3-tts-flash）
      DASHSCOPE_TTS_STYLE  'v1'（parameters.voice，老协议）| 'v3'（input.voice，新协议）
      DASHSCOPE_TTS_VOICE  音色
    """
    if _DASH_DEAD[0]:
        return 0.0
    key = env_get('DASHSCOPE_API_KEY')
    if not key:
        return 0.0
    url = env_get('DASHSCOPE_TTS_URL') or DASHSCOPE_TTS_URL
    model = env_get('DASHSCOPE_TTS_MODEL') or DASHSCOPE_TTS_MODEL_DEFAULT
    style = (env_get('DASHSCOPE_TTS_STYLE') or DASHSCOPE_TTS_STYLE_DEFAULT).lower()
    v3 = (style == 'v3')
    if v3:
        # ★v3 = 新协议（同步）：音色必须是 qwen3 的 Cherry/Serena/Ethan/Chelsie
        v = env_get('DASHSCOPE_TTS_VOICE') or qwen3_voice(voice)
        payload = {'model': model, 'input': {'text': text, 'voice': v}}
    else:
        v = voice or env_get('DASHSCOPE_TTS_VOICE') or DASHSCOPE_VOICE
        payload = {'model': model, 'input': {'text': text},
                   'parameters': {'voice': v, 'format': 'mp3'}, 'action': 'run'}
    body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
    hdrs = {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer %s' % key,
    }
    if not v3:
        # ★实测：新端点（multimodal-generation）带上这个头会 403
        #   "current user api does not support asynchronous calls" → 同步接口不能带
        hdrs['X-DashScope-Async'] = 'enable'
    req = urllib.request.Request(url, data=body, method='POST', headers=hdrs)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e:
        # ★VF_TTSERR_V1：原来只打“HTTP Error 400: Bad Request”，根本看不到百炼在报什么
        try:
            _b = e.read().decode('utf-8', 'replace')[:300]
        except Exception:
            _b = ''
        print('  [tts] 百炼创建任务失败: HTTP %s %s | %s' % (e.code, e.reason, _b))
        _DASH_DEAD[0] = True
        return 0.0
    except Exception as e:
        print('  [tts] 百炼创建任务失败: %s' % str(e)[:140])
        return 0.0
    task_id = (data.get('output') or {}).get('task_id')
    if not task_id:
        # ★VF_DASH_SYNC_V1：有的端点同步直出（没 task_id）→ 尽力从返回里“挖”音频 url 直接用
        u = _dig_audio_url(data)
        if u:
            try:
                with urllib.request.urlopen(u, timeout=60) as ar:
                    d = _write_audio(ar.read(), out_path)
                if d:
                    return d
            except Exception as e:
                print('  [tts] 百炼音频下载失败: %s' % str(e)[:140])
        print('  [tts] 百炼未返回 task_id: %s' % json.dumps(data, ensure_ascii=False)[:200])
        return 0.0
    for _ in range(60):                      # 最多约 2 分钟
        time.sleep(2)
        try:
            preq = urllib.request.Request(DASHSCOPE_TASK_URL % task_id,
                                          headers={'Authorization': 'Bearer %s' % key})
            with urllib.request.urlopen(preq, timeout=15) as pr:
                pd = json.loads(pr.read() or b'{}')
        except Exception:
            continue
        st = (pd.get('output') or {}).get('task_status')
        if st == 'SUCCEEDED':
            murl = ((pd.get('output') or {}).get('results') or [{}])[0].get('url')
            if not murl:
                return 0.0
            try:
                with urllib.request.urlopen(murl, timeout=60) as ar:
                    audio = ar.read()
            except Exception as e:
                print('  [tts] 百炼音频下载失败: %s' % str(e)[:140])
                return 0.0
            os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
            with open(out_path, 'wb') as f:
                f.write(audio)
            return mp3_duration(out_path)
        if st in ('FAILED', 'UNKNOWN'):
            print('  [tts] 百炼任务失败: %s' % json.dumps(pd, ensure_ascii=False)[:200])
            return 0.0
    print('  [tts] 百炼轮询超时（任务 %s）' % task_id)
    return 0.0


def tts_one(text, out_path, speaker=''):
    """合成一句 → 写 mp3，返回 (ok, 时长秒)。

    ★VF_TTS_ORDER_V1（2026-09-20）：引擎顺序由 VF_TTS_ORDER 决定
      （默认 **dashscope,minimax,silicon** = 百炼 qwen3-tts-flash → Minimax → 硅基；
       要启用火山就填 dashscope,minimax,silicon,volcano）
      可选：dashscope（百炼）/ minimax / silicon（硅基）/ volcano（火山）
      音色：表单选的是【百炼 id】，各引擎自己映射。"""
    txt = (text or '').strip()
    if not txt:
        return False, 0.0
    engines = {
        'dashscope': lambda: _tts_dashscope(txt, out_path, speaker),
        'minimax': lambda: _tts_minimax(txt, out_path, speaker),
        'silicon': lambda: _tts_silicon(txt, out_path, speaker),
        'volcano': lambda: _tts_volcano(txt, out_path, speaker or VOLCANO_SPEAKER),
    }
    for name in _tts_order():
        fn = engines.get(name)
        if not fn:
            print('  [tts] 未知引擎「%s」（可选：%s）' % (name, '/'.join(engines.keys())))
            continue
        try:
            dur = fn()
        except Exception as e:
            print('  [tts] %s 异常: %s' % (name, str(e)[:120]))
            dur = 0.0
        if dur:
            print('[TTS] 引擎=%s' % name)
            return True, dur
    if not _CRED_WARNED[0]:
        _CRED_WARNED[0] = True
        print('[TTS] ⚠️ 全部引擎都失败（顺序 %s）→ 本次将出无声片。'
              '可配 VF_TTS_ORDER 换引擎；凭据查 .env.local' % ','.join(_tts_order()))
    return False, 0.0


def _tts_volcano(text, out_path, speaker=''):
    """火山 openspeech v3（兜底）。先试映射音色；**没出声就用已验证可用的默认音色重试**。
    ★VF_VOLCANO_RETRY_V1（2026-09-20 实测）：zh_female_vv_magic_bigtts 返回 0 字节
      （账号音色包可能不含它）→ 降级用 VOLCANO_SPEAKER，宁可音色不理想也要有声。"""
    spk = volcano_speaker(speaker)
    dur = _volcano_once(text, out_path, spk)
    if dur:
        return dur
    if spk != VOLCANO_SPEAKER:
        print('  [tts] 火山「%s」没出声 → 用默认音色 %s 重试' % (spk, VOLCANO_SPEAKER))
        return _volcano_once(text, out_path, VOLCANO_SPEAKER)
    return 0.0


def _volcano_once(text, out_path, spk):
    """火山单次合成（返回【时长秒，0.0 = 失败】）"""
    app_id = env_get('VOLCANO_TTS_APP_ID')
    ak = env_get('VOLCANO_TTS_ACCESS_KEY')
    rid = env_get('VOLCANO_TTS_RESOURCE_ID')
    if not (app_id and ak and rid):
        return 0.0
    txt = (text or '').strip()
    if not txt:
        return 0.0
    body = json.dumps({
        'user': {'uid': app_id},
        'req_params': {
            'text': txt, 'speaker': spk,
            'audio_params': {'format': 'mp3', 'sample_rate': 24000},
            'volume': 2.0,
        },
    }, ensure_ascii=False).encode('utf-8')
    req = urllib.request.Request(URL, data=body, method='POST', headers={
        'Content-Type': 'application/json',
        'X-Api-App-Id': app_id, 'X-Api-Access-Key': ak, 'X-Api-Resource-Id': rid,
    })
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            raw = r.read()
    except Exception as e:
        print('  [tts] 火山请求失败: %s' % str(e)[:120])
        return 0.0
    audio = b''
    if raw[:1] == b'{':
        for ln in raw.split(b'\n'):
            s = ln.strip()
            if not s:
                continue
            try:
                j = json.loads(s)
            except Exception:
                continue
            d = j.get('data')
            if isinstance(d, str) and len(d) > 20:
                try:
                    audio += base64.b64decode(d)
                except Exception:
                    pass
    else:
        audio = raw
    if len(audio) < 200:
        print('  [tts] 火山音频过短(%d 字节)，判定失败' % len(audio))
        return 0.0
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    with open(out_path, 'wb') as f:
        f.write(audio)
    return mp3_duration(out_path)


def _tts_minimax(text, out_path, voice):
    """★Minimax 语音合成（/v1/t2a_v2，与 minimax-music.ts 同一个 MINIMAX_API_KEY）。
    端点/模型/音色可配：MINIMAX_TTS_URL / MINIMAX_TTS_MODEL / MINIMAX_TTS_VOICE；
    若把 MINIMAX_TTS_URL 指向你的中转，则走后转。未配 key → 0.0。
    返回 JSON，音频为 hex（output_format=hex）或 url。"""
    key = env_get('MINIMAX_API_KEY')
    if not key:
        return 0.0
    url = env_get('MINIMAX_TTS_URL') or 'https://api.minimaxi.com/v1/t2a_v2'
    model = env_get('MINIMAX_TTS_MODEL') or 'speech-02-hd'
    v = voice if (voice or '').startswith('female-') or (voice or '').startswith('male-') else minimax_voice(voice)
    body = json.dumps({
        'model': model,
        'text': text,
        'stream': False,
        'voice_setting': {'voice_id': v, 'speed': 1.0, 'vol': 1.0, 'pitch': 0},
        'audio_setting': {'sample_rate': 32000, 'bitrate': 128000, 'format': 'mp3', 'channel': 1},
        'output_format': 'hex',
    }, ensure_ascii=False).encode('utf-8')
    req = urllib.request.Request(url, data=body, method='POST', headers={
        'Content-Type': 'application/json',
        'Authorization': 'Bearer %s' % key,
    })
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            data = json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e:
        try:
            _b = e.read().decode('utf-8', 'replace')[:300]
        except Exception:
            _b = ''
        print('  [tts] Minimax HTTP %s %s | %s' % (e.code, e.reason, _b))
        return 0.0
    except Exception as e:
        print('  [tts] Minimax 请求失败: %s' % str(e)[:140])
        return 0.0
    br = data.get('base_resp') or {}
    if br.get('status_code') not in (0, None):
        print('  [tts] Minimax 报错: %s' % json.dumps(br, ensure_ascii=False)[:200])
        return 0.0
    hexa = (data.get('data') or {}).get('audio')
    if isinstance(hexa, str) and len(hexa) > 400:
        try:
            return _write_audio(bytes.fromhex(hexa), out_path)
        except Exception as e:
            print('  [tts] Minimax hex 解码失败: %s' % str(e)[:120])
            return 0.0
    u = _dig_audio_url(data)
    if u:
        try:
            with urllib.request.urlopen(u, timeout=60) as ar:
                return _write_audio(ar.read(), out_path)
        except Exception as e:
            print('  [tts] Minimax 音频下载失败: %s' % str(e)[:140])
    print('  [tts] Minimax 未返回音频: %s' % json.dumps(data, ensure_ascii=False)[:200])
    return 0.0


def _tts_silicon(text, out_path, voice):
    """★硅基流动 TTS（OpenAI 兼容 /v1/audio/speech，与 ai-providers.ts 的 siliconTTS 一致）。
    ★这条正好是 textToSpeech（AGENT 语音）的兜底 —— 若 AGENT 语音能出声，这条就是活的。"""
    key = env_get('SILICONFLOW_API_KEY')
    if not key:
        return 0.0
    url = env_get('SILICON_TTS_URL') or 'https://api.siliconflow.cn/v1/audio/speech'
    model = env_get('SILICON_TTS_MODEL') or 'FunAudioLLM/CosyVoice2-0.5B'
    v = voice if (voice or '').startswith('FunAudioLLM/') else (env_get('SILICON_TTS_VOICE') or 'FunAudioLLM/CosyVoice2-0.5B:alex')
    body = json.dumps({'model': model, 'input': text, 'voice': v,
                       'response_format': 'mp3', 'sample_rate': 44100}, ensure_ascii=False).encode('utf-8')
    req = urllib.request.Request(url, data=body, method='POST', headers={
        'Content-Type': 'application/json',
        'Authorization': 'Bearer %s' % key,
    })
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            return _write_audio(r.read(), out_path)
    except urllib.error.HTTPError as e:
        try:
            _b = e.read().decode('utf-8', 'replace')[:300]
        except Exception:
            _b = ''
        print('  [tts] 硅基 HTTP %s %s | %s' % (e.code, e.reason, _b))
        return 0.0
    except Exception as e:
        print('  [tts] 硅基请求失败: %s' % str(e)[:140])
        return 0.0


def mp3_duration(path):
    ff = find_exe(FFPROBE_CANDS, 'ffprobe')
    try:
        r = subprocess.run(
            [ff, '-v', 'error', '-show_entries', 'format=duration',
             '-of', 'default=noprint_wrappers=1:nokey=1', path],
            capture_output=True, text=True, timeout=20)
        return float((r.stdout or '0').strip() or 0)
    except Exception:
        return 0.0


def real_dur_sec(path, sr=24000, ch=1):
    """真实内容时长 = 把音频**解码成裸 PCM 后按字节数算**（秒）。

    ★VF_AUDIOFIX_V1（2026-09-22，用户实测「成片时长显示 10 小时 52 分」）：
      实测 voice.m4a 的头写着 40580 秒，真实内容只有 168.83 秒（**240 倍**）——
      容器的 duration 会骗人，所以校验不能信头。
      为什么不用"帧数 × 每帧采样数"：**每帧采样数随编码/版本变**（AAC=1024；
      MP3 在 32/44.1/48kHz 是 1152，在 24kHz 这类 MPEG-2 只有 576）——
      本机实测用 1152 去算 24kHz 的 mp3 会把时长算成 **2 倍**（测试脚本抓到）。
      解码成 PCM 后按 `字节数 ÷ (2 × 声道 × 采样率)` 算，对容器头、时间戳、编码器**全都不敏感**。
      读不到 → 返回 0.0（调用方视为"没法校验"，不阻塞）。
    """
    ff = find_exe(FFMPEG_CANDS, 'ffmpeg')
    try:
        r = subprocess.run([ff, '-nostdin', '-v', 'error', '-i', path,
                            '-f', 's16le', '-ar', str(sr), '-ac', str(ch), '-'],
                           capture_output=True, timeout=600)
        return len(r.stdout or b'') / float(2 * ch * sr)
    except Exception:
        return 0.0


def merge_audio(files, out_path):
    """把逐镜音频拼成一条**与画面逐镜对齐、且时长可信**的音轨

    ★VF_AUDIOFIX_V1（2026-09-22，用户实测「成片显示 10:52:31 / 10 小时」）：
      根因 1（时长元数据炸坏）—— TTS 返回的 36 段里 **1 段采样率 44100、其余 35 段 24000**，
      原来 `-f concat -c:a aac` 直接拼、不重采样不校验 → 时间戳被搅乱，
      `voice.m4a` 的头写成 **40580 秒（真实 168.83 秒的 240 倍）** → 成片头也变 39151 秒。

    ★VF_AUDIOALIGN_V1（2026-09-22，用户实测「片尾没配音、字幕还在」）：
      根因 2（逐镜没对齐）—— 分镜里每镜 `dur = 配音 + 0.35 秒尾隙`，但合并时**只把配音拼起来、
      没补那 0.35 秒** → 音频比画面短 镜数×0.35（36 镜 = 12.96 秒），而且误差是**逐镜累积**的：
      第 k 镜的配音比它的画面早 0.35k 秒 → 越往后字幕越超前、**片尾那段画面完全没声音**。
      （上一版用 apad 把"总时长"补够了，但没解决"逐镜对齐" → 症状从"成片被砍短"变成"片尾静音"。）

      修法（逐镜补齐 → 统一规格 → 再拼）：
        ① 每镜先归一化成 WAV（24000Hz / 单声道 / 16bit）并**补齐到该镜时长**：
           有配音 → 不足补静音、超出截到 dur；没配音 → 整段静音占位。
        ② 所有 WAV 规格完全一致 → concat → 再编 AAC。
           WAV 长度由"数据字节数"表达、且规格统一 → 既不怕混采样率，也不怕时间戳。
        ③ 拼完复核两件事：容器头 vs **real_dur_sec**（解码成 PCM 数字节）；
           真实总长 vs **分镜应得总长**（差 >2% 说明逐镜对齐失败）→ 不符就明确报错。

      `files` 参数：`[(音频路径 or None, 该镜时长秒), ...]`（也兼容只传路径字符串）。
      另加 `-nostdin`：避免 ffmpeg 误入交互模式；失败一律抛错（不再返回空串→无声片）。
    """
    ff = find_exe(FFMPEG_CANDS, 'ffmpeg')
    outdir = os.path.dirname(os.path.abspath(out_path))
    parts, _tmps, _want = [], [], 0.0
    for i, item in enumerate(files):
        p, want = (item if isinstance(item, (tuple, list)) else (item, 0.0))
        p = p or ''
        try:
            want = float(want or 0)
        except Exception:
            want = 0.0
        _want += max(0.0, want)
        w = os.path.join(outdir, 'mix%03d.wav' % i)
        if p and os.path.exists(p):
            # apad=whole_dur=want 把配音补静音到该镜时长；-t want 防超长 → 恰好 == 该镜时长
            c = ('"%s" -nostdin -y -i "%s" -af "apad=whole_dur=%.3f" -t %.3f '
                 '-ar 24000 -ac 1 -c:a pcm_s16le "%s"' % (ff, p, want, want, w))
        elif want > 0.02:
            c = ('"%s" -nostdin -y -f lavfi -i "anullsrc=r=24000:cl=mono" -t %.3f '
                 '-ar 24000 -ac 1 -c:a pcm_s16le "%s"' % (ff, want, w))
        else:
            continue
        r = subprocess.run(c, shell=True, capture_output=True, text=True,
                           encoding='utf-8', errors='replace')
        if (not os.path.exists(w)) or os.path.getsize(w) < 512:
            raise RuntimeError('配音对齐失败（第 %d 段）：%s' % (i + 1, (r.stderr or '')[-300:]))
        parts.append(w)
        _tmps.append(w)
    if not parts:
        raise RuntimeError('没有可用的配音片段（逐镜对齐阶段全失败）')
    lst = os.path.join(outdir, 'audio-list.txt')
    with open(lst, 'w', encoding='utf-8') as f:
        for p in parts:
            f.write("file '%s'\n" % p.replace('\\', '/'))
    _wav = out_path + '.all.wav'
    for _p in (out_path, _wav):
        try:
            if os.path.exists(_p):
                os.remove(_p)
        except Exception:
            pass
    r1 = subprocess.run('"%s" -nostdin -y -f concat -safe 0 -i "%s" -c:a pcm_s16le "%s"'
                        % (ff, lst, _wav), shell=True, capture_output=True, text=True,
                        encoding='utf-8', errors='replace')
    for _p in _tmps:
        try:
            os.remove(_p)
        except Exception:
            pass
    if (not os.path.exists(_wav)) or os.path.getsize(_wav) < 1024:
        raise RuntimeError('合并配音失败（拼接阶段）：%s' % ((r1.stderr or '')[-400:]))
    r2 = subprocess.run('"%s" -nostdin -y -i "%s" -c:a aac -b:a 128k "%s"' % (ff, _wav, out_path),
                        shell=True, capture_output=True, text=True,
                        encoding='utf-8', errors='replace')
    try:
        os.remove(_wav)
    except Exception:
        pass
    if not os.path.exists(out_path):
        raise RuntimeError('合并配音失败（AAC 编码）：%s' % ((r2.stderr or '')[-400:]))
    # ★VF_AUDIOFIX_V1③ + ★VF_AUDIOALIGN_V1③：两重校验，任一不符就明确失败（不静默交付）
    _hdr, _real = mp3_duration(out_path), real_dur_sec(out_path)
    if _real > 0.2 and (_hdr <= 0.2 or abs(_hdr - _real) / _real > 0.02):
        try:
            os.remove(out_path)
        except Exception:
            pass
        raise RuntimeError('合并配音时长不一致：容器头 %.2fs / 真实内容 %.2fs'
                           '（头不可信 → 混音会把成片时长也带坏；请把这一行发给开发）'
                           % (_hdr, _real))
    if _want > 0.2 and _real > 0.2 and abs(_real - _want) / _want > 0.02:
        try:
            os.remove(out_path)
        except Exception:
            pass
        raise RuntimeError('合并配音与分镜总时长不一致：真实 %.2fs / 分镜应得 %.2fs'
                           '（逐镜对齐失败 → 会出现片尾无声/字幕超前；请把这一行发给开发）'
                           % (_real, _want))
    print('  [tts] 合并音频校验通过：%d 段 / 头 %.2fs / 真实 %.2fs / 分镜应得 %.2fs（已逐镜对齐）'
          % (len(parts), _hdr, _real or _hdr, _want))
    return out_path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--storyboard', default='')
    ap.add_argument('--workdir', default='')
    ap.add_argument('--speaker', default=SPEAKER, help='音色，留空用引擎默认（百炼 longxiaochun / 火山 zh_female_vv_uranus_bigtts）')
    ap.add_argument('--out-json', default='', help='回填配音时长后的分镜 JSON')
    ap.add_argument('--merge', default='', help='合并后的整条配音文件')
    ap.add_argument('--text', default='', help='单句测试模式')
    ap.add_argument('--out', default='', help='单句测试输出 mp3')
    a = ap.parse_args()

    if a.text:
        out = a.out or os.path.join(tempfile.gettempdir(), 'tts-one.mp3')
        ok, dur = tts_one(a.text, out, a.speaker)
        print('单句测试: ok=%s 时长=%.2fs -> %s' % (ok, dur, out))
        sys.exit(0 if ok else 1)

    if not a.storyboard or not os.path.exists(a.storyboard):
        print('缺少 --storyboard'); sys.exit(2)
    sb = json.load(open(a.storyboard, encoding='utf-8'))
    wd = a.workdir or os.path.join(os.path.dirname(os.path.abspath(a.storyboard)), 'vf-tts')
    os.makedirs(wd, exist_ok=True)

    shots = sb.get('shots', [])
    # ★VF_AUDIOALIGN_V1：[(音频路径 or None, 该镜时长)] —— None = 该镜留静音占位
    clips = []
    print('[TTS] 共 %d 镜，逐镜配音（每镜时长 = 该镜配音真实时长）' % len(shots))
    for i, s in enumerate(shots):
        txt = (s.get('subtitle') or s.get('text') or '').strip()
        # ★2026-09-20：兜底逻辑与 render.py 的 `_shot_text` **对齐**。
        #   原先只覆盖 list/number → compare(left/right)/chart/带 cta 的卡会出现
        #   “字幕有、配音没有” → 那一镜静音（且时长停在 AI 默认值）。
        #   现在统一：title + items + label + value+suffix + left/right + cta，
        #   这样【配音文本 == 字幕文本】，不会再对不上。
        if not txt:
            _p = []
            if s.get('title'):
                _p.append(str(s['title']).strip())
            if isinstance(s.get('items'), list):
                _p.extend([str(x).strip() for x in s['items'] if str(x).strip()])
            if s.get('label'):
                _p.append(str(s['label']).strip())
            if s.get('value') is not None:
                _p.append((str(s.get('value')) + str(s.get('suffix') or '')).strip())
            if s.get('left') or s.get('right'):
                _p.append((str(s.get('left') or '') + ' vs ' + str(s.get('right') or '')).strip())
            if s.get('cta'):
                _p.append(str(s['cta']).strip())
            txt = '，'.join([x for x in _p if x])[:80]
        if not txt:
            print('[TTS] 第 %d 镜无文案 → 该镜留静音占位（保持与画面同一时间轴）' % (i + 1))
            clips.append((None, float(s.get('dur') or 0) or 5.0))
            continue
        p = os.path.join(wd, 'vo%02d.mp3' % i)
        ok, dur = tts_one(txt, p, a.speaker)
        if not ok:
            print('[TTS] ❌ 第 %d 镜配音失败 → 该镜留静音占位: %s' % (i + 1, txt[:30]))
            clips.append((None, float(s.get('dur') or 0) or 5.0))
            continue
        # ★VF_AUDIOFIX_V1③（2026-09-22）：单镜时长用"解码成 PCM 数字节"复核一次 ——
        #   容器头会骗人（实测拼完的头是真实值的 240 倍）。只有在头与真实差 >2% 时才改，
        #   否则完全照旧（不打扰既有时长节奏）。
        try:
            _real = real_dur_sec(p)
            if _real > 0.2 and abs(dur - _real) / _real > 0.02:
                print('[TTS] ⚠️ 第 %d 镜音频头 %.2fs 与真实 %.2fs 不一致 → 用真实值'
                      % (i + 1, dur, _real))
                dur = _real
        except Exception:
            pass
        # ★ 回填真实时长（留 0.35s 尾隙，避免字幕/画面切太急）
        s['dur'] = round(dur + 0.35, 2)
        s['voiceFile'] = p
        # ★VF_AUDIOALIGN_V1：连"该镜时长"一起带上 —— 合并时按它逐镜补齐（补齐尾隙）
        clips.append((p, s['dur']))
        print('[TTS] 第 %d 镜 %.2fs  %s' % (i + 1, s['dur'], txt[:26]))

    if not any(x for x, _ in clips):
        print('[TTS] 没有成功配音'); sys.exit(3)

    # ★VF_AUDIOALIGN_V1：分镜总时长 = 所有镜（含没配到音的静音占位）之和 —— 供合并校验
    total = sum(float(s.get('dur') or 0) for s in shots)
    mrg = a.merge or os.path.join(wd, 'voice.m4a')
    merged = merge_audio(clips, mrg)
    print('[TTS] 合并配音 -> %s（分镜总时长 %.1fs；已逐镜对齐）' % (merged, total))

    oj = a.out_json or a.storyboard.replace('.json', '.voiced.json')
    with open(oj, 'w', encoding='utf-8') as f:
        json.dump(sb, f, ensure_ascii=False, indent=2)
    print('[TTS] ✅ 回填时长后的分镜: %s' % oj)
    print('[TTS] 下一步: python render.py --storyboard "%s" --audio "%s" --out out.mp4' % (oj, merged))


if __name__ == '__main__':
    main()
