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

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

HERE = os.path.dirname(os.path.abspath(__file__))
SPEAKER = ''                     # 留空 = 用所选引擎的默认音色（百炼 longxiaochun / 火山 zh_female_vv_uranus_bigtts）
VOLCANO_SPEAKER = 'zh_female_vv_uranus_bigtts'
DASHSCOPE_VOICE = os.environ.get('DASHSCOPE_TTS_VOICE') or 'longxiaochun'
URL = 'https://openspeech.bytedance.com/api/v3/tts/unidirectional'
DASHSCOPE_TTS_URL = 'https://dashscope.aliyuncs.com/api/v1/services/tts/generation'
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


def env_get(key, default=''):
    """凭据读取：进程环境变量优先（服务器注入），其次 .env.local"""
    return (os.environ.get(key) or ENV.get(key) or default)


def _tts_dashscope(text, out_path, voice):
    """百炼 CosyVoice（异步提交 + 轮询 + 下载 mp3）—— 与 ai-providers.ts 的 dashscopeTTS 同协议。
    未配 key / 失败 时返回 0.0（交给下一引擎兜底）。"""
    key = env_get('DASHSCOPE_API_KEY')
    if not key:
        return 0.0
    body = json.dumps({
        'model': 'cosyvoice-v1',
        'input': {'text': text},
        'parameters': {'voice': voice or DASHSCOPE_VOICE, 'format': 'mp3'},
        'action': 'run',
    }, ensure_ascii=False).encode('utf-8')
    req = urllib.request.Request(DASHSCOPE_TTS_URL, data=body, method='POST', headers={
        'Content-Type': 'application/json',
        'Authorization': 'Bearer %s' % key,
        'X-DashScope-Async': 'enable',
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.loads(r.read() or b'{}')
    except Exception as e:
        print('  [tts] 百炼创建任务失败: %s' % str(e)[:140])
        return 0.0
    task_id = (data.get('output') or {}).get('task_id')
    if not task_id:
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
    ★VF_DASHSCOPE_V1：百炼 CosyVoice 主用 → 火山兜底 → 都没有则明确警告（无声片）。"""
    txt = (text or '').strip()
    if not txt:
        return False, 0.0
    dur = _tts_dashscope(txt, out_path, speaker)
    if dur:
        return True, dur
    dur = _tts_volcano(txt, out_path, speaker or VOLCANO_SPEAKER)
    if dur:
        return True, dur
    if not _CRED_WARNED[0]:
        _CRED_WARNED[0] = True
        print('[TTS] ⚠️ 没有可用的 TTS 凭据（需 DASHSCOPE_API_KEY，或火山 VOLCANO_TTS_*）'
              '（已查环境变量与 .env.local）→ 本次将出无声片')
    return False, 0.0


def _tts_volcano(text, out_path, speaker=''):
    """火山 openspeech v3（兜底）。合成一句 → 写 mp3，返回【时长秒，0.0 = 失败】"""
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
            'text': txt, 'speaker': speaker,
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


def merge_audio(files, out_path):
    """把多段 mp3 顺序拼成一条音轨"""
    ff = find_exe(FFMPEG_CANDS, 'ffmpeg')
    lst = os.path.join(os.path.dirname(os.path.abspath(out_path)), 'audio-list.txt')
    with open(lst, 'w', encoding='utf-8') as f:
        for p in files:
            f.write("file '%s'\n" % p.replace('\\', '/'))
    cmd = ('"%s" -y -f concat -safe 0 -i "%s" -c:a aac -b:a 128k "%s"' % (ff, lst, out_path))
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True,
                       encoding='utf-8', errors='replace')
    if not os.path.exists(out_path):
        print('  [tts] 合并失败: %s' % (r.stderr or '')[-300:])
        return ''
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
    clips, total = [], 0.0
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
            print('[TTS] 第 %d 镜无文案，跳过配音' % (i + 1))
            continue
        p = os.path.join(wd, 'vo%02d.mp3' % i)
        ok, dur = tts_one(txt, p, a.speaker)
        if not ok:
            print('[TTS] ❌ 第 %d 镜配音失败: %s' % (i + 1, txt[:30]))
            continue
        # ★ 回填真实时长（留 0.35s 尾隙，避免字幕/画面切太急）
        s['dur'] = round(dur + 0.35, 2)
        s['voiceFile'] = p
        clips.append(p)
        total += s['dur']
        print('[TTS] 第 %d 镜 %.2fs  %s' % (i + 1, s['dur'], txt[:26]))

    if not clips:
        print('[TTS] 没有成功配音'); sys.exit(3)

    mrg = a.merge or os.path.join(wd, 'voice.m4a')
    merged = merge_audio(clips, mrg)
    print('[TTS] 合并配音 -> %s（总时长约 %.1fs）' % (merged, total))

    oj = a.out_json or a.storyboard.replace('.json', '.voiced.json')
    with open(oj, 'w', encoding='utf-8') as f:
        json.dump(sb, f, ensure_ascii=False, indent=2)
    print('[TTS] ✅ 回填时长后的分镜: %s' % oj)
    print('[TTS] 下一步: python render.py --storyboard "%s" --audio "%s" --out out.mp4' % (oj, merged))


if __name__ == '__main__':
    main()
