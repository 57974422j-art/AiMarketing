#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""一句话成片（★VIDEO_FACTORY_MAKE_V1）—— 把配音 + 渲染串成一条命令

用法:
  # ① 最简：给一段文案 → 自动切句成卡 → 出片
  python make.py --script "AI Marketing 帮你做内容。发布到六个平台。已经服务 300 家客户。" --out out.mp4

  # ② 高级：给现成分镜 JSON（AI 排好分镜后用这个）
  python make.py --storyboard my.json --out out.mp4

流程（与 docs/成片工作流方案 一致）:
  文案 → 分镜(按规则切句) → tts.py 逐句配音+回填时长 → render.py 渲染+字幕+混音 → 成片

为什么先做"规则切句"而不是"AI 排分镜"：
  先把【确定性链路】跑通（本文件），AI 只负责"写文案 + 排分镜"这一步，
  接进 AGENT 时只需替换 --storyboard 的来源。链路不变 → 少调试。
"""
import argparse
import json
import os
import re
import subprocess
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
HERE = os.path.dirname(os.path.abspath(__file__))

# 主题预设（先给一套；对应 docs 里"主题 JSON"的最小实现）
THEMES = {
    'dark':   {'bg': '0x0a1620', 'text': 'white', 'accent': '0xff6b35', 'font': 'msyh'},
    'light':  {'bg': '0xf5f2ea', 'text': '0x1a1a1a', 'accent': '0xc0392b', 'font': 'msyh'},
    'tech':   {'bg': '0x0b1c2c', 'text': '0xe8f1f8', 'accent': '0x2ec4b6', 'font': 'msyh'},
}


def split_sentences(text):
    """按中文标点切句，保留完整语义"""
    parts = re.split(r'(?<=[。！？!?；;])', (text or '').strip())
    return [p.strip() for p in parts if p and p.strip()]


def build_storyboard(script, theme='dark', size=(1280, 720), first_title=None):
    """规则切句 → 分镜：第 1 句做标题卡，其余做列表/数字/标题卡"""
    sents = split_sentences(script)
    if not sents:
        sents = [script or 'AI Marketing']
    shots = []
    # 第 1 句 → 标题卡
    shots.append({'type': 'title', 'text': first_title or sents[0], 'dur': 3})
    body = sents[1:] if len(sents) > 1 else []
    # 有数字的句子 → number 卡；连续短句 → list 卡
    list_buf = []
    for s in body:
        m = re.search(r'(\d[\d,\.]*)\s*(万|亿|家|个|次|%|元|人)?', s)
        if m and len(list_buf) < 2:
            if list_buf:
                shots.append({'type': 'list', 'title': '要点', 'items': list_buf, 'dur': 4})
                list_buf = []
            shots.append({'type': 'number', 'value': int(float(m.group(1).replace(',', ''))),
                          'suffix': (m.group(2) or '+'), 'label': s[:24], 'dur': 3})
        elif len(s) <= 14:
            list_buf.append(s.rstrip('。！？!?；;'))
            if len(list_buf) >= 3:
                shots.append({'type': 'list', 'title': '要点', 'items': list_buf, 'dur': 5})
                list_buf = []
        else:
            if list_buf:
                shots.append({'type': 'list', 'title': '要点', 'items': list_buf, 'dur': 4})
                list_buf = []
            shots.append({'type': 'title', 'text': s, 'dur': 3.5, 'fontsize': 56})
    if list_buf:
        shots.append({'type': 'list', 'title': '要点', 'items': list_buf, 'dur': 4})
    return {'size': list(size), 'fps': 25, 'theme': THEMES.get(theme, THEMES['dark']), 'shots': shots}


def run(cmd, label):
    print('[MAKE] %s' % label)
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True,
                       encoding='utf-8', errors='replace')
    out = (r.stdout or '') + (r.stderr or '')
    lines = [ln for ln in out.splitlines() if ln.strip()]
    ok = r.returncode == 0
    # ★VF_LOGFIX_V1（2026-09-20）：原来【只打最后 6 行】→ tts.py 的失败原因
    #   （如"⚠️ 没有可用的 TTS 凭据"，只在第一镜打印一次）被截掉 → "无声片"查不到因。
    #   改成：成功打最后 6 行；**失败打前 12 行 + 后 12 行**（首尾都要，真因常在开头）。
    if ok:
        for ln in lines[-6:]:
            print('   ' + ln[:150])
    else:
        print('   ⚠️ %s 失败（退出码 %s），输出共 %d 行 —— 首 12 / 尾 12：'
              % (label, r.returncode, len(lines)))
        head, tail = lines[:12], lines[-12:]
        for ln in head:
            print('   ' + ln[:200])
        if len(lines) > 24:
            print('   …（省略 %d 行）' % (len(lines) - 24))
        for ln in (tail if lines[:12] != lines[-12:] else []):
            print('   ' + ln[:200])
    return ok


# ==================== ★VF_AIVIDEO_V1（2026-09-20）：AI 生成片段（MiniMax H3） ====================
# 「AI 直接成片」：把每镜的画面从"素材图 + Ken Burns"换成"AI 生成的视频片段"。
#
# 为什么放在 make.py 而不是 Node 端：
#   **"先配音拿每镜真实时长"这一步本来就在本文件**（tts.py 回填 storyboard.voiced.json），
#   插在同处改动最小。代价是 Python 里要重写一遍 H3 调用 —— 因此下面与
#   src/lib/minimax-h3.ts **刻意保持同构**（同样的环境变量、同样的"中转优先→官方降级"、
#   同样的 /v2/video_generation 端点与 600s 轮询上限），以后改一处要想到另一处。

H3_OFFICIAL_BASE = 'https://api.minimaxi.com'
H3_DEFAULT_MODEL = 'MiniMax-H3'
# H3 运镜指令（官方支持 [指令] 写法；同组建议 ≤3 个）——按镜轮换，避免每镜画面运动方式雷同
_H3_CAM = ['[Push in]', '[Pan right]', '[Tilt up]', '[Zoom in]',
           '[Tracking shot]', '[Pan left]', '[Pull out]', '[Static shot]']


def _h3_use_context_ir():
    """use_context_ir：默认开（自动增强提示词）；H3_USE_CONTEXT_IR=0/false 关闭"""
    v = (os.environ.get('H3_USE_CONTEXT_IR') or '').strip().lower()
    return v not in ('0', 'false', 'off')


def _h3_targets():
    """候选通道：中转优先 → 官方兜底（与 minimax-h3.ts 的 h3Targets 完全一致）"""
    relay_base = (os.environ.get('H3_BASE_URL') or '').strip().rstrip('/')
    relay_key = (os.environ.get('H3_API_KEY') or '').strip()
    official_key = (os.environ.get('MINIMAX_API_KEY') or '').strip()
    model = (os.environ.get('H3_MODEL') or H3_DEFAULT_MODEL).strip()
    out = []
    if relay_base and relay_key:
        out.append({'base': relay_base, 'key': relay_key, 'model': model, 'label': '中转'})
    if official_key and relay_base != H3_OFFICIAL_BASE:
        out.append({'base': H3_OFFICIAL_BASE, 'key': official_key,
                    'model': H3_DEFAULT_MODEL, 'label': '官方'})
    return out


def _h3_http(method, url, key, body=None, timeout=30):
    """极简 HTTP（**只用标准库**，不给客户端环境加依赖）→ 返回 dict（失败返回带 error 的 dict）"""
    from urllib.request import Request, urlopen
    from urllib.error import HTTPError
    data = json.dumps(body).encode('utf-8') if body is not None else None
    req = Request(url, data=data, method=method,
                  headers={'Content-Type': 'application/json', 'Authorization': 'Bearer %s' % key})
    try:
        with urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode('utf-8', 'replace') or '{}')
    except HTTPError as e:
        try:
            return json.loads(e.read().decode('utf-8', 'replace') or '{}')
        except Exception:
            return {'error': {'message': 'HTTP %s' % e.code}}
    except Exception as e:
        return {'error': {'message': str(e)[:150]}}


def _h3_download(url, dest, timeout=180):
    """下载片段到本地（成功且不是空壳才算 True）"""
    from urllib.request import urlopen
    with urlopen(url, timeout=timeout) as r, open(dest, 'wb') as f:
        f.write(r.read())
    return os.path.getsize(dest) > 1024


def _probe_sec(path):
    """ffprobe 拿视频秒数（拿不到返回 0）"""
    import shutil
    exe = shutil.which('ffprobe') or 'ffprobe'
    try:
        r = subprocess.run('"%s" -v error -show_entries format=duration -of default=nw=1:nk=1 "%s"'
                           % (exe, path), shell=True, capture_output=True, text=True,
                           encoding='utf-8', errors='replace', timeout=20)
        return float((r.stdout or '0').strip() or 0)
    except Exception:
        return 0.0


def _h3_prompt(shot, idx):
    """分镜 → H3 画面提示词。优先 AI 写的 prompt 字段；否则用中文文案拼一个兜底描述。
    末尾追加运镜指令（按镜轮换）。明确要求"不要出现文字"——文字由 render.py 的字幕负责。"""
    p = (shot.get('prompt') or '').strip()
    if not p:
        core = (shot.get('subtitle') or shot.get('text') or shot.get('title') or '').strip()
        items = shot.get('items') or []
        if not core and items:
            core = '、'.join(str(i.get('label') if isinstance(i, dict) else i) for i in items[:3])
        p = ('%s。短视频画面：镜头自然运动、光影真实、主体清晰、'
             '画面中下部留出空间给字幕，**画面里不要出现任何文字**' % core) if core \
            else '现代科技感的短视频实景空镜，镜头自然运动，画面里不要出现文字'
    return '%s %s' % (p[:600], _H3_CAM[idx % len(_H3_CAM)])


def _h3_gen_one(prompt, want_sec, resolution, ratio):
    """单镜生成（同步阻塞）。返回 (本地下载前的 url 或 None, 通道 label, 真实秒数)"""
    import time
    targets = _h3_targets()
    if not targets:
        return (None, '未配置', 0.0)
    last_via = '未配置'
    for t in targets:
        last_via = t['label']
        body = {
            'model': t['model'],
            'content': [{'type': 'text', 'text': prompt[:7000]}],
            'resolution': resolution,
            # H3 单段只支持 4~15 秒整数 → 按配音时长四舍五入后在范围内夹紧
            'duration': max(4, min(15, int(round(want_sec)))),
            'ratio': ratio,
        }
        if _h3_use_context_ir():
            body['use_context_ir'] = True
        d = _h3_http('POST', '%s/v2/video_generation' % t['base'], t['key'], body, timeout=30)
        task_id = (d or {}).get('task_id')
        if not task_id:
            msg = (((d or {}).get('error') or {}).get('message')) or '无 task_id'
            print('[H3] %s 提交失败: %s' % (t['label'], str(msg)[:160]))
            continue
        # 轮询：120 × 5s = 600s（实测 6 秒片约 101s，与 Node 版上限一致）
        for _ in range(120):
            time.sleep(5)
            q = _h3_http('GET', '%s/v2/query/video_generation/%s' % (t['base'], task_id),
                         t['key'], None, timeout=20)
            task = (q or {}).get('task') or {}
            st = task.get('status')
            if st == 'succeeded':
                url = ((task.get('content') or {}).get('url') or '')
                usage = task.get('usage') if isinstance(task.get('usage'), dict) else {}
                return (url or None, t['label'], float((usage or {}).get('output_seconds') or 0))
            if st == 'failed':
                # 任务失败 = 内容/prompt 问题（如敏感）→ 换通道也一样失败，**不降级**
                print('[H3] %s 生成失败: %s（内容问题，不降级）'
                      % (t['label'], str((task.get('error') or {}).get('message'))[:160]))
                return (None, '%s(不降级)' % t['label'], 0.0)
            if st == 'cancelled':
                print('[H3] %s 任务已取消' % t['label'])
                return (None, t['label'], 0.0)
        print('[H3] %s 生成超时（600s）' % t['label'])
    return (None, last_via, 0.0)


def gen_ai_clips(sb_path, wd, resolution='768P', only_idx=None):
    """★VF_AIVIDEO_V1：把故事板里每一镜的画面换成 AI 生成的视频片段。

    **必须在配音之后调用**（要按每镜真实时长决定生成几秒）。
    落盘 <wd>/clips/shotNN.mp4，并回写 shot 的 type='aivideo' / src / src_dur。
    **任一镜失败 → 该镜保留原样**（继续用素材图/原卡型），**绝不整片失败**。

    ★VF_MIXLINE_V1（2026-09-21）新增 `only_idx`：「素材 + AI 创作」这条线**只对 AI 标注过的镜**调 H3
      （1-based 镜号集合）；为空 = 全部镜（「AI 制片」那条线）。**两种调用互不影响**。
    返回 (新的故事板路径, 成功镜数, 总秒数, 最后通道)
    """
    _only = set(int(x) for x in (only_idx or []) if str(x).strip().isdigit())
    sb = json.load(open(sb_path, encoding='utf-8'))
    shots = sb.get('shots') or []
    clips = os.path.join(wd, 'clips')
    os.makedirs(clips, exist_ok=True)
    W, H = sb.get('size', [1280, 720])
    ratio = '9:16' if H > W else ('16:9' if W > H else '1:1')
    total_sec, ok_n, via_last = 0.0, 0, ''
    if _only:
        print('[H3] ★混合模式：只对第 %s 镜用 AI（其余 %d 镜沿用素材/原卡型）'
              % (','.join(str(x) for x in sorted(_only)), len(shots) - len(_only)))
    for i, shot in enumerate(shots):
        if _only and (i + 1) not in _only:
            continue          # ★混合：未被标注的镜**完全跳过**（画面保持素材/原卡型）
        want = float(shot.get('dur', 5) or 5)
        # 重跑时已生成过的直接复用（省钱）
        _s = str(shot.get('src') or '')
        if shot.get('type') == 'aivideo' and _s and os.path.exists(_s):
            ok_n += 1
            total_sec += float(shot.get('src_dur') or 0)
            continue
        prompt = _h3_prompt(shot, i)
        print('[H3] 第 %d/%d 镜 生成中…（目标 %.1fs）%s' % (i + 1, len(shots), want, prompt[:70]))
        url, via, sec = _h3_gen_one(prompt, want, resolution, ratio)
        via_last = via
        if not url:
            print('[H3] ⚠️ 第 %d 镜 AI 生成失败（%s）→ **该镜回退用原画面**（不整片失败）' % (i + 1, via))
            continue
        dest = os.path.join(clips, 'shot%02d.mp4' % i)
        try:
            if not _h3_download(url, dest):
                raise RuntimeError('下载内容过小（可能 0 字节）')
        except Exception as e:
            print('[H3] ⚠️ 第 %d 镜下载失败: %s → 回退用原画面' % (i + 1, str(e)[:120]))
            continue
        real = float(sec or 0) or _probe_sec(dest)
        shot['type'] = 'aivideo'
        shot['src'] = dest
        shot['src_dur'] = round(float(real or 0), 2)
        ok_n += 1
        total_sec += float(real or 0)
        print('[H3] ✅ 第 %d 镜 OK  %s  %.1fs -> %s' % (i + 1, via, float(real or 0), os.path.basename(dest)))
    out_path = os.path.join(wd, 'storyboard.ai.json')
    json.dump(sb, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    print('[H3] 生成完成：**%d/%d 镜**，共 %.1f 秒，通道=%s' % (ok_n, len(shots), total_sec, via_last))
    return (out_path, ok_n, total_sec, via_last)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--script', default='', help='一段文案（自动切句成卡）')
    ap.add_argument('--storyboard', default='', help='现成分镜 JSON 文件')
    ap.add_argument('--plan', default='', help='AI 给的分镜 JSON 字符串（或 @文件路径）——优先级最高')
    ap.add_argument('--preview', action='store_true', help='只输出分镜计划（JSON），不配音不渲染')
    ap.add_argument('--theme', default='dark', choices=list(THEMES.keys()))
    ap.add_argument('--out', default='out.mp4')
    ap.add_argument('--workdir', default='')
    ap.add_argument('--speaker', default='', help='音色，留空用引擎默认（百炼 longxiaochun / 火山 zh_female_vv_uranus_bigtts）')
    ap.add_argument('--bgm', default='', help='背景音乐文件（★VF_BGM_V1：循环铺底 + 压低音量）')
    # ★VF_AIVIDEO_V1（2026-09-20）：「AI 直接成片」——画面来源
    ap.add_argument('--source', default='', choices=['', 'ai', 'mix'],
                    help='画面来源：留空=素材合成（默认）；ai=全部 AI 生成（MiniMax H3）；mix=素材+AI 混合（未实现）')
    ap.add_argument('--ai-resolution', default='768P', choices=['768P', '2K'],
                    help='AI 生成清晰度（768P=50点/秒，2K=80点/秒）')
    # ★VF_MIXLINE_V1（2026-09-21）：「素材 + AI 创作」——只对指定镜号（1-based，逗号分隔）调 AI，
    #   其余镜沿用素材/原卡型。留空 = 全部镜（即「AI 制片」）。**这是【边界铁律】允许的"通过参数影响脚本"**。
    ap.add_argument('--mix', default='', help='★混合：只对这些镜号用 AI（1-based，如 1,5,9）。留空=全部镜')
    a = ap.parse_args()

    if not a.script and not a.storyboard and not a.plan:
        print('需要 --script / --storyboard / --plan 之一'); sys.exit(2)

    wd = a.workdir or os.path.join(os.path.dirname(os.path.abspath(a.out)), 'vf-work')
    os.makedirs(wd, exist_ok=True)

    # ① 分镜（优先级：--plan > --storyboard > --script 自动切句）
    if a.plan:
        raw = a.plan
        if raw.startswith('@') and os.path.exists(raw[1:]):
            raw = open(raw[1:], encoding='utf-8').read()
        try:
            plan = json.loads(raw)
        except Exception as e:
            print('[MAKE] ❌ --plan 不是合法 JSON: %s' % str(e)[:120]); sys.exit(2)
        if isinstance(plan, list):
            sb = {'size': [1280, 720], 'fps': 25,
                  'theme': THEMES.get(a.theme, THEMES['dark']), 'shots': plan}
        else:
            plan.setdefault('size', [1280, 720])
            plan.setdefault('fps', 25)
            plan.setdefault('theme', THEMES.get(a.theme, THEMES['dark']))
            sb = plan
        sb_path = os.path.join(wd, 'storyboard.json')
        json.dump(sb, open(sb_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    elif a.storyboard:
        sb_path = a.storyboard
        sb = json.load(open(sb_path, encoding='utf-8'))
    else:
        sb = build_storyboard(a.script, a.theme)
        sb_path = os.path.join(wd, 'storyboard.json')
        json.dump(sb, open(sb_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)

    # ★ 首镜先确认（preview）：只给分镜计划，不花钱不渲染
    if a.preview:
        print('[MAKE] PREVIEW 分镜计划（未渲染）:')
        print(json.dumps(sb, ensure_ascii=False, indent=2))
        print('[MAKE] PREVIEW_JSON_FILE:%s' % sb_path)
        return
    print('[MAKE] 分镜 %d 镜: %s' % (len(sb.get('shots', [])),
                                    ', '.join(s.get('type', '?') for s in sb.get('shots', []))))

    # ② 配音（回填真实时长）
    voiced = os.path.join(wd, 'storyboard.voiced.json')
    voice = os.path.join(wd, 'voice.m4a')
    ok = run('"%s" "%s" --storyboard "%s" --workdir "%s" --speaker "%s" --out-json "%s" --merge "%s"'
             % (sys.executable, os.path.join(HERE, 'tts.py'), sb_path, os.path.join(wd, 'tts'),
                a.speaker, voiced, voice), '逐句配音')
    use_sb = voiced if (ok and os.path.exists(voiced)) else sb_path
    # ★ 只要有配音文件就混进去（原来判断漏了 --plan 分支 → 用 plan 时出的是无声片）
    use_voice = voice if os.path.exists(voice) else ''
    if not use_voice:
        print('[MAKE] ⚠️ 无配音，出无声片')

    # ②.5 ★VF_AIVIDEO_V1（2026-09-20）：「AI 直接成片」——**必须在配音之后**（才能拿到每镜真实
    #   时长）、渲染之前，把每镜画面换成 AI 生成的视频片段。失败镜自动回退原画面，绝不整片失败。
    if a.source == 'ai' or str(a.mix or '').strip():
        _sb_in = use_sb if os.path.exists(use_sb) else sb_path
        _isMix = bool(str(a.mix or '').strip())
        print('[MAKE] ★画面来源=%s → 调用 MiniMax H3（清晰度 %s，%s 点/秒）%s'
              % ('素材+AI 创作（只对指定镜）' if _isMix else '全部 AI 生成（AI 制片）',
                 a.ai_resolution, '50' if a.ai_resolution == '768P' else '80',
                 (' 镜号=' + str(a.mix)) if _isMix else ''))
        try:
            _mix_idx = [x.strip() for x in str(a.mix or '').split(',') if x.strip().isdigit()]
            ai_sb, ai_n, ai_sec, ai_via = gen_ai_clips(_sb_in, wd, a.ai_resolution, _mix_idx)
        except Exception as e:
            print('[MAKE] ⚠️ AI 生成环节异常: %s → 回退成素材合成' % str(e)[:160])
            ai_sb, ai_n, ai_sec, ai_via = '', 0, 0.0, ''
        if ai_n > 0:
            use_sb = ai_sb
            print('[MAKE] AI 片段就绪：%d 镜 / %.1f 秒（通道 %s）→ 用 storyboard.ai.json 渲染'
                  % (ai_n, ai_sec, ai_via))
        else:
            print('[MAKE] ⚠️ 没有任何 AI 片段生成成功 → **自动回退成素材合成**（不整片失败）')
    elif a.source == 'mix' and not str(a.mix or '').strip():
        print('[MAKE] ⚠️ --source mix 需配 --mix 镜号（如 --mix 1,5）才有意义；本次按【素材合成】出片')

    # ③ 渲染成片
    ok2 = run('"%s" "%s" --storyboard "%s" --workdir "%s" --audio "%s" --bgm "%s" --out "%s"'
              % (sys.executable, os.path.join(HERE, 'render.py'), use_sb,
                 os.path.join(wd, 'render'), use_voice, a.bgm, a.out), '渲染成片')
    if ok2 and os.path.exists(a.out):
        sz = os.path.getsize(a.out)
        print('[MAKE] ✅ 成片: %s  (%.1f MB)' % (a.out, sz / 1048576.0))
    else:
        print('[MAKE] ❌ 渲染失败')
        sys.exit(1)


if __name__ == '__main__':
    main()
