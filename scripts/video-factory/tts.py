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
                [--out-json sb.with-voice.json] [--merge out.m4a] [--xfade 0.35]
  python tts.py --text "测试一句话" --out test.mp3     # 单句测试

★VF_XFADE_V1（2026-09-29）：--xfade N = 真·交叉溶解的**音频侧**（与 render.py 的 xfade 配套）。
  默认 0 = 关闭 = 老行为（一个字节都不变）；理由与实现见 merge_audio 上方那一段注释。

★VF_DASHSCOPE_V1（2026-09-18）：主用【百炼 CosyVoice】（与 src/lib/ai-providers.ts 的 dashscopeTTS 同协议），
火山 openspeech v3 作为兜底 —— 项目 TTS 现已以百炼为主，服务器上只要有 DASHSCOPE_API_KEY 就能配音。
凭据定位（跨平台）：进程环境变量优先 → VF_ENV_FILE → 从脚本位置逐级向上找 .env.local → cwd。
  百炼：DASHSCOPE_API_KEY（音色可用 DASHSCOPE_TTS_VOICE 覆盖，默认 longxiaochun）
  火山：VOLCANO_TTS_APP_ID / VOLCANO_TTS_ACCESS_KEY / VOLCANO_TTS_RESOURCE_ID（兜底）

★VF_TTSLANG_V1（2026-10-01）：qwen3-tts 是**多语言模型**，裸调用走默认 language_type=Auto 时会
  "按文本自己猜语种" → 中英夹混的句子偶发被读成别的语言（用户实测「最后一句像日语（偶发）」）。
  现含中文的句子**显式传 language_type=Chinese** 把语种锁死；该参数若被接口拒绝会自动去参重试
  （见 dash_post_with_lang_fallback，保证"绝不因新参数没声音"）。可用 VF_TTS_LANG=off 一键关闭本特性。
"""
import argparse
import base64
import json
import os
import re
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
# ★VF_TTSLANG_V1：记录"本句最终用哪个音色"，供 tts_one 打「引擎+音色+语言」一行汇总
_LAST_VOICE = ['']


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


# ★VF_TTSLANG_V1（2026-10-01，用户实测「最后一句配音像日语（偶发）」）：
#   根因 —— 默认音色映射 longxiaochun → **Cherry**，而 Cherry/Serena/Ethan/Chelsie 属于
#   **qwen3-tts（多语言模型）**：请求体不带 language_type 时走模型默认 `Auto`，
#   由模型"按文本自己猜语种"；中英夹混的句子（如「AI」）偶发被判成别的语言 → 念出来像日语。
#   修法 —— 合成前判断文本是否含中文（CJK 正则），含中文的句子**显式传 `language_type='Chinese'`**，
#   把语种锁死，不再交给模型猜。
#   参数名/取值/位置（阿里云百炼《Qwen-TTS API》官方文档核对）：HTTP 请求体里放在 **input 内**，
#   与 text / voice 同级；取值 = Auto(默认)/Chinese/English/German/Italian/Portuguese/Spanish/
#   Japanese/Korean/French/Russian。→ 中文文本传 'Chinese'。
#   ④ 结论：**不需要**给这些多语言音色另配"纯中文音色"——同一音色指定 Chinese 即为纯中文发音。
_CJK_RE = re.compile(r'[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]')


def has_cjk(text):
    """★VF_TTSLANG_V1：文本里是否含中文汉字（纯函数；None / 空 / 纯符号 → False，绝不抛异常）"""
    return bool(_CJK_RE.search(text or ''))


def lang_type_for(text):
    """★VF_TTSLANG_V1：qwen3-tts 的 input.language_type 该填什么（纯函数，可单测）。
    含中文 → 'Chinese'（**显式锁中文**）；不含中文 / 空 → ''（不传该字段，保持模型默认 Auto）。
    ★VF_TTS_LANG=off 可整体关掉本特性（万一线上要立刻回退的老开关）。"""
    if (env_get('VF_TTS_LANG') or '').strip().lower() in ('off', '0', 'false', 'no'):
        return ''
    return 'Chinese' if has_cjk(text) else ''


def lang_label(text):
    """日志用：'zh' = 含中文（已锁中文）/ '-' = 未锁"""
    return 'zh' if has_cjk(text) else '-'


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


def _dash_post(url, payload, key, async_hdr=False, timeout=30):
    """★VF_TTSLANG_V1：百炼 POST 一次。
    返回 (data, err, killed)：成功 = (dict, '', False)；失败 = (None, '一句人话原因', killed)，
    killed=True 表示 HTTP 层确定性失败（400/403 这类，值得让该引擎本轮整体停手），
    网络/超时类异常为 False（不永久停手，与既有 _DASH_DEAD 语义一致）。"""
    body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
    hdrs = {'Content-Type': 'application/json', 'Authorization': 'Bearer %s' % key}
    if async_hdr:
        # ★实测：新端点（multimodal-generation）带上这个头会 403
        #   "current user api does not support asynchronous calls" → 同步接口不能带
        hdrs['X-DashScope-Async'] = 'enable'
    req = urllib.request.Request(url, data=body, method='POST', headers=hdrs)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read() or b'{}'), '', False
    except urllib.error.HTTPError as e:
        # ★VF_TTSERR_V1：原来只打“HTTP Error 400: Bad Request”，根本看不到百炼在报什么
        try:
            _b = e.read().decode('utf-8', 'replace')[:300]
        except Exception:
            _b = ''
        return None, 'HTTP %s %s | %s' % (e.code, e.reason, _b), True
    except Exception as e:
        return None, str(e)[:140], False


def dash_post_with_lang_fallback(post_fn, url, payload, key, async_hdr=False):
    """★VF_TTSLANG_V1②（防呆，纯函数；post_fn 可注入 → 不联网即可单测）：
    先按【带 language_type 的 payload】提交；**一旦接口报错、且该字段是我们新加的 → 立即去掉它重试一次**。
    目的：新增语言参数这条改动**绝不会**把整条配音搞挂（最坏退化成改动前的行为，仍有声）。
    返回 (data, err, killed)：data is None = 两次都失败。"""
    data, err, killed = post_fn(url, payload, key, async_hdr)
    _inp = payload.get('input')
    if data is None and isinstance(_inp, dict) and _inp.get('language_type'):
        print('[TTS] ⚠️ ★VF_TTSLANG_V1 百炼拒绝 language_type（%s）→ 去掉该参数重试一次'
              '（确保配音不因新参数失败）' % err)
        _p2 = dict(payload)
        _p2['input'] = {k: v for k, v in _inp.items() if k != 'language_type'}
        data, err, killed = post_fn(url, _p2, key, async_hdr)
        if data is not None:
            print('[TTS] ✅ ★VF_TTSLANG_V1 去掉 language_type 后成功（本句未锁语言，但出声了）')
    return data, err, killed


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
        _inp = {'text': text, 'voice': v}
        # ★VF_TTSLANG_V1：含中文 → 显式锁 language_type=Chinese（不让多语言模型自己猜语种）
        _lg = lang_type_for(text)
        if _lg:
            _inp['language_type'] = _lg
            print('[TTS] 语言判定=%s（文本含中文 → 强制 language_type=%s，音色=%s）'
                  % (lang_label(text), _lg, v))
        payload = {'model': model, 'input': _inp}
    else:
        v = voice or env_get('DASHSCOPE_TTS_VOICE') or DASHSCOPE_VOICE
        payload = {'model': model, 'input': {'text': text},
                   'parameters': {'voice': v, 'format': 'mp3'}, 'action': 'run'}
    _LAST_VOICE[0] = v
    # ★VF_TTSLANG_V1②：带 language_type 提交；若被拒 → 自动去参重试一次（详见该函数注释）
    data, _err, _killed = dash_post_with_lang_fallback(_dash_post, url, payload, key,
                                                       async_hdr=(not v3))
    if data is None:
        print('  [tts] 百炼创建任务失败: %s' % _err)
        if _killed:
            _DASH_DEAD[0] = True
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
        _LAST_VOICE[0] = ''
        try:
            dur = fn()
        except Exception as e:
            print('  [tts] %s 异常: %s' % (name, str(e)[:120]))
            dur = 0.0
        if dur:
            # ★VF_TTSLANG_V1：一行看清 引擎 + 音色 + 语言判定（以后排查一眼可查）
            print('[TTS] 引擎=%s 音色=%s 语言=%s' % (name, _LAST_VOICE[0] or '-', lang_label(txt)))
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
    _LAST_VOICE[0] = spk       # ★VF_TTSLANG_V1：记录实际音色（供一行日志）
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
    _LAST_VOICE[0] = v          # ★VF_TTSLANG_V1：记录实际音色（供一行日志）
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
    _LAST_VOICE[0] = v          # ★VF_TTSLANG_V1：记录实际音色（供一行日志）
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


# ==================== ★VF_XFADE_V1（2026-09-29）：真·交叉溶解（音频侧） ====================
# 背景（**为什么这条线长期不敢做真·交叉溶解**）：
#   render.py 的 xfade 会让**每个镜头交界"吃掉" X 秒**（相邻两镜画面重叠）→
#   视频总时长缩短 X×(镜数-1)；而配音是「逐镜 TTS → 按分镜 dur 累加合并成一条连续轨」，
#   音轨长度**跟死分镜时长**。所以"只做视频侧 xfade"的结果是：**音轨比画面长 X×(n-1) 秒**
#   → 从第一个交界开始，全片音画持续错位（越往后越偏）。这是唯一的原因，不是懒。
# 音频侧的解法（本段实现）：
#   · 相邻两段**交叉淡化 X 秒**：第 i 段（i≥2）的音频**提前 X 秒开始**，与前一段重叠淡化
#     （ffmpeg `acrossfade`，等价的手工叠加也可，取 tri 线性曲线：加权和不会放大 → 不削波）；
#   · 于是音轨总时长 = **Σ每镜时长 - X×(段数-1)**，与视频侧 xfade 后的时长**完全一致**；
#   · 逐镜的"尾隙"（分镜 dur = 配音 + 0.35 秒，见下面 VF_AUDIOALIGN_V1）落在淡化区里：
#     前一段的尾隙与后一段的开头重叠 → **尾隙不会把两段音频隔开**（这正是要的效果）。
# 铁律（本项目一贯的降级原则）：acrossfade 不可用 / 段数与镜数对不上 / 任何异常
#   → **回退到既有【硬拼 + 补尾隙】**，绝不因为转场让成片失败，并打好日志说明为什么回退。
XFADE_MAX_SEC = 2.0     # 单个交界最多淡化 2 秒（再大就等于把整镜吃掉 → 按"关闭"处理）


def xfade_sec(v):
    """把 --xfade 原始值规整成可用秒数：非法 / ≤0 / 过大 → 0（= 完全的老行为）"""
    try:
        x = float(v or 0)
    except Exception:
        print('[TTS] ⚠️ ★VF_XFADE_V1 --xfade 无法解析（%r）→ 当作 0（不做交叉淡化）' % (v,))
        return 0.0
    if x <= 0:
        return 0.0
    if x > XFADE_MAX_SEC:
        print('[TTS] ⚠️ ★VF_XFADE_V1 --xfade=%.2f 过大（上限 %.1fs）→ 当作 0（不做交叉淡化，'
              '避免把整镜吃掉）' % (x, XFADE_MAX_SEC))
        return 0.0
    return x


def xfade_block_reason(parts, files, wants, xd):
    """能不能做交叉淡化？能 → ''；不能 → 返回一句**人话原因**（调用方据此回退 + 打日志）"""
    if xd <= 0:
        return '--xfade=0（未启用）'
    if len(files) != len(parts):
        return '音频段数 %d ≠ 镜数 %d（有镜没生成出音频占位）' % (len(parts), len(files))
    if len(parts) < 2:
        return '只有 %d 段，没有交界可交叉' % len(parts)
    for i, w in enumerate(wants):
        if w <= xd + 0.001:
            return '第 %d 段只有 %.2fs，不够淡化 %.2fs' % (i + 1, w, xd)
    return ''


def xfade_merge(ff, parts, out_path, xd, target):
    """★VF_XFADE_V1：把【已逐镜归一化】的 WAV 用 acrossfade 链交叉淡化 → AAC 到 out_path。

    为什么必须用归一化后的 WAV（上游已做）：混采样率直接拼会把容器头写坏
      （VF_AUDIOFIX_V1 实测头写成真实值的 240 倍）；规格统一后再叠才安全。
    长度：n 段、每交界减 xd → 总长 = Σlen - xd×(n-1)（= 视频侧 xfade 后的时长）。
    失败一律**抛异常**（调用方回退硬拼）；成功前做与既有 VF_AUDIOFIX_V1③/VF_AUDIOALIGN_V1③
    同款的两重校验（容器头 vs 真实内容 vs 预期总长）。
    """
    n = len(parts)
    ins = ' '.join('-i "%s"' % p for p in parts)
    segs, prev = [], '[0]'
    for i in range(1, n):
        lbl = '[aout]' if i == n - 1 else '[x%d]' % i
        # c1=c2=tri（线性）：两条曲线加起来恒为 1 → 淡化区是**加权和**，不会放大 → 峰值不超输入
        segs.append('%s[%d]acrossfade=d=%.4f:c1=tri:c2=tri%s' % (prev, i, xd, lbl))
        prev = lbl
    _w = out_path + '.xfade.wav'
    for _p in (out_path, _w):
        try:
            if os.path.exists(_p):
                os.remove(_p)
        except Exception:
            pass
    r = subprocess.run('"%s" -nostdin -y %s -filter_complex "%s" -map "[aout]" '
                       '-ar 24000 -ac 1 -c:a pcm_s16le "%s"'
                       % (ff, ins, ';'.join(segs), _w),
                       shell=True, capture_output=True, text=True,
                       encoding='utf-8', errors='replace')
    if (not os.path.exists(_w)) or os.path.getsize(_w) < 1024:
        raise RuntimeError('acrossfade 滤镜失败：%s' % ((r.stderr or '')[-300:]))
    r2 = subprocess.run('"%s" -nostdin -y -i "%s" -c:a aac -b:a 128k "%s"' % (ff, _w, out_path),
                        shell=True, capture_output=True, text=True,
                        encoding='utf-8', errors='replace')
    try:
        os.remove(_w)
    except Exception:
        pass
    if not os.path.exists(out_path):
        raise RuntimeError('交叉淡化后再编 AAC 失败：%s' % ((r2.stderr or '')[-300:]))
    _hdr, _real = mp3_duration(out_path), real_dur_sec(out_path)
    if _real > 0.2 and (_hdr <= 0.2 or abs(_hdr - _real) / _real > 0.02):
        raise RuntimeError('交叉淡化后时长不一致：容器头 %.2fs / 真实内容 %.2fs' % (_hdr, _real))
    if target > 0.2 and _real > 0.2 and abs(_real - target) / target > 0.02:
        raise RuntimeError('交叉淡化后总时长不符：真实 %.2fs / 预期 %.2fs'
                           '（预期 = Σ每镜 %.2fs - %.2fs×%d）'
                           % (_real, target, target + xd * (n - 1), xd, n - 1))
    print('  [tts] 交叉淡化校验通过：%d 段 / 交界 %.2fs / 头 %.2fs / 真实 %.2fs / 预期 %.2fs'
          % (n, xd, _hdr, _real, target))


def merge_audio(files, out_path, xfade=0.0):
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

    ★VF_XFADE_V1（2026-09-29·真·交叉溶解的音频侧）：`xfade=X`>0 时改成
      「相邻两段**交叉淡化 X 秒**（第 i 段提前 X 秒开始，与上一段重叠）」→
      总长 = **Σ每镜时长 - X×(段数-1)**，与 render.py 侧 xfade 后的画面长度**完全一致**；
      交界处的"尾隙"被重叠进淡化区 → 两段音频不会被尾隙隔开。
      任何条件不满足 / 任何异常 → 自动**回退下面的【硬拼 + 补尾隙】**（绝不因转场让成片失败），
      并把"为什么回退"打清楚（回退后音轨会比画面长 X×(段数-1) 秒，用于定位）。
      `xfade` 默认 `0.0` = **完全的老行为**（一个字节都不变，见参数说明）。

      `files` 参数：`[(音频路径 or None, 该镜时长秒), ...]`（也兼容只传路径字符串）。
      另加 `-nostdin`：避免 ffmpeg 误入交互模式；失败一律抛错（不再返回空串→无声片）。
    """
    ff = find_exe(FFMPEG_CANDS, 'ffmpeg')
    outdir = os.path.dirname(os.path.abspath(out_path))
    parts, _tmps, _want, _wants = [], [], 0.0, []
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
        _wants.append(want)
    if not parts:
        raise RuntimeError('没有可用的配音片段（逐镜对齐阶段全失败）')

    # ★VF_XFADE_V1（2026-09-29）：真·交叉溶解（音频侧）—— 先试；成功直接返回，
    #   任何不满足 / 异常 → 打日志说清原因，继续往下走【原硬拼 + 补尾隙】路径（绝不因转场失败）。
    _xd = xfade_sec(xfade)
    if _xd > 0:
        _why = xfade_block_reason(parts, files, _wants, _xd)
        if _why:
            print('[TTS] ⚠️ ★VF_XFADE_V1 跳过交叉淡化：%s → 回退【硬拼 + 补尾隙】' % _why)
            print('[TTS]    ↑ 后果：音轨会比（xfade 后的）画面长 %.2f 秒（%d 个交界 × %.2fs）'
                  '——请把这条日志发给开发'
                  % (_xd * (len(parts) - 1), len(parts) - 1, _xd))
        else:
            _xtgt = _want - _xd * (len(parts) - 1)
            try:
                xfade_merge(ff, parts, out_path, _xd, _xtgt)
                for _p in _tmps:
                    try:
                        os.remove(_p)
                    except Exception:
                        pass
                print('[TTS] ✅ ★VF_XFADE_V1 交叉淡化合并：%d 段 / 交界 %.2fs / 总长 %.2fs'
                      '（= Σ每镜 %.2fs - %.2fs×%d，与画面 xfade 后一致）'
                      % (len(parts), _xd, _xtgt, _want, _xd, len(parts) - 1))
                return out_path
            except Exception as e:
                print('[TTS] ⚠️ ★VF_XFADE_V1 交叉淡化失败（%s）→ 回退【硬拼 + 补尾隙】'
                      % str(e)[:200])
                print('[TTS]    ↑ 后果：音轨会比（xfade 后的）画面长 %.2f 秒，会出现音画错位；'
                      '先保证出片，请把这条日志发给开发'
                      % (_xd * (len(parts) - 1)))
                try:
                    if os.path.exists(out_path):
                        os.remove(out_path)
                except Exception:
                    pass

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
    ap.add_argument('--xfade', type=float, default=0.0,
                    help='★VF_XFADE_V1 真·交叉溶解（音频侧）：相邻两镜音频交叉淡化 N 秒；'
                         '0=关闭（默认，= 完全老行为）。需与 render.py 的 xfade 用同一数值')
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
            s['voice'] = 0    # ★VF_VOICE_WINDOW_V1：没有配音 → 字幕窗口退回镜长（render 里有兜底）
            clips.append((None, float(s.get('dur') or 0) or 5.0))
            continue
        p = os.path.join(wd, 'vo%02d.mp3' % i)
        # ★VF_TTSLANG_V1：逐镜写明语言判定（配合 tts_one 的 引擎/音色/语言 汇总，一眼可查）
        print('[TTS] 第 %d 镜 语言=%s（%s）'
              % (i + 1, lang_label(txt),
                 '文本含中文，强制中文引擎/音色' if has_cjk(txt) else '无中文，按引擎默认'))
        ok, dur = tts_one(txt, p, a.speaker)
        if not ok:
            print('[TTS] ❌ 第 %d 镜配音失败 → 该镜留静音占位: %s' % (i + 1, txt[:30]))
            s['voice'] = 0    # ★VF_VOICE_WINDOW_V1：配音失败 → 字幕窗口退回镜长
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
        # ★VF_VOICE_WINDOW_V1（2026-09-24 用户实测「配音比字幕快」）：
        #   以前这里只回填【一个】dur = 配音 + 0.35，而"字幕窗口"和"镜长"共用它 →
        #   单句层面就变成：声音已经说完，字幕还多停 0.35 秒（体感 = 配音比字幕快；
        #   36 镜累计 ≈ 12.96 秒，就是用户记得的那个"12 秒"）。
        #   现在拆成两个值（这就是本次修法的核心）：
        #     · voice = 【真实配音时长】→ 专给"字幕 / 逐字高亮"窗口用：配音说完，字幕立刻消失
        #     · dur   = 【镜长】= 配音 + 0.35 → 画面/音频的呼吸间隔，保持不变（句子不会粘连）
        s['voice'] = round(dur, 2)
        # ★VF_MINSTOP_V1（2026-10-06 用户实测 043「收尾卡一闪而过」+ 用户定案「配音字幕要准确完成」）：
        #   镜长 = 配音 + 0.35 尾隙 ⇒ **旁白很短的纯文字卡**（尤其收尾 / 标题）会短到看不清
        #   （043 收尾卡只剩 1.6 秒，就是"旁白只有几个字"直接换算出来的）。
        #   这里给纯文字卡抬一个【最短停留】：音频侧合并时本来就**按镜长 apad 补静音**
        #   （VF_AUDIOALIGN_V1），所以 A/V 仍严格对齐；字幕窗口用的是上面的 `voice`
        #   （不是 dur）—— **字幕一个字都不会因此多停**（不会把"配音比字幕快"那个病带回来）。
        #   素材镜（bgimage / video / duo / frame）**一律不抬**：它们的画面本身就是内容，抬了只会拖节奏。
        _MINSTOP = {'end': 3.0, 'title': 2.8, 'quote': 2.8, 'compare': 2.6,
                    'chart': 2.6, 'list': 2.6, 'number': 2.4}
        _ms = _MINSTOP.get(str(s.get('type') or ''), 0.0)
        s['dur'] = round(max(dur + 0.35, _ms), 2)
        s['voiceFile'] = p
        # ★VF_AUDIOALIGN_V1：连"该镜时长"一起带上 —— 合并时按它逐镜补齐（补齐尾隙）
        clips.append((p, s['dur']))
        print('[TTS] 第 %d 镜 配音 %.2fs / 镜长 %.2fs  %s' % (i + 1, s['voice'], s['dur'], txt[:26]))

    if not any(x for x, _ in clips):
        print('[TTS] 没有成功配音'); sys.exit(3)

    # ★VF_AUDIOALIGN_V1：分镜总时长 = 所有镜（含没配到音的静音占位）之和 —— 供合并校验
    total = sum(float(s.get('dur') or 0) for s in shots)
    mrg = a.merge or os.path.join(wd, 'voice.m4a')
    # ★VF_XFADE_V1（2026-09-29）：把 --xfade 交给合并阶段（>0 = 交叉淡化；0 = 老行为）
    if xfade_sec(a.xfade) > 0:
        print('[TTS] ★VF_XFADE_V1 交叉溶解已启用：%.2fs/交界（画面侧由 render.py 读分镜根级 xfade 同步）'
              % a.xfade)
    merged = merge_audio(clips, mrg, a.xfade)
    print('[TTS] 合并配音 -> %s（分镜总时长 %.1fs；已逐镜对齐）' % (merged, total))

    oj = a.out_json or a.storyboard.replace('.json', '.voiced.json')
    with open(oj, 'w', encoding='utf-8') as f:
        json.dump(sb, f, ensure_ascii=False, indent=2)
    print('[TTS] ✅ 回填时长后的分镜: %s' % oj)
    print('[TTS] 下一步: python render.py --storyboard "%s" --audio "%s" --out out.mp4' % (oj, merged))


if __name__ == '__main__':
    main()
