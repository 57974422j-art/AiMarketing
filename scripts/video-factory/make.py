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

# ★VF_THEMES_V1（2026-09-29）：主题 token 已迁到【唯一真相源】 scripts/video-factory/themes.py
#   （原来只在这里写死 3 套，render.py 又从分镜里拿字典 —— 两处各写一份、必然漂移。
#     现在 make.py 与 render.py 都 `from themes import ...`；加主题只改 themes.py 一个文件。）
if HERE not in sys.path:
    sys.path.insert(0, HERE)
from themes import THEMES, theme_of  # noqa: E402  （放在 sys.path 处理之后，故意不置顶）


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


# ==================== ★VF_XFADE_V1（2026-09-29）：真·交叉溶解（xfade）的"同一数值"传递 ====================
# 为什么必须由 make.py 在这里读、并同时喂给两边：
#   · 画面侧：render.py 自己读分镜根级 `xfade` 做画面交叉溶解（我不传参，见其 VF_VARIANT_V1）；
#   · 音频侧：本文件调 tts.py 时**必须把同一数值传给 --xfade**。
#   原因：xfade 会让**每个镜头交界"吃掉" X 秒**（两镜画面重叠）→ 视频总时长缩短 X×(镜数-1)；
#   而配音是「逐镜 TTS → 按分镜 dur 累加合并成一条连续轨」。只做视频侧 xfade →
#   **音轨比画面长 X×(n-1) 秒 → 全片音画持续错位**（这正是这条线长期不做真溶解的唯一原因）。
#   两边用同一个 X，各自缩掉同样的 X×(n-1)，音画才继续严格对齐。
XFADE_MAX_SEC = 2.0     # 与 tts.py / render.py 的上限保持一致（超了按"不做转场"处理）


def xfade_of(sb):
    """从分镜**根级** `xfade`（秒）取交叉溶解时长：0 / 非法 / 过大 → 0（= 完全的老行为）"""
    try:
        x = float((sb or {}).get('xfade') or 0)
    except Exception:
        x = 0.0
    if x <= 0:
        return 0.0
    if x > XFADE_MAX_SEC:
        print('[MAKE] ⚠️ ★VF_XFADE_V1 分镜里的 xfade=%.2f 过大（上限 %.1fs）→ 本次不做转场'
              '（音频侧同步不淡化，音画仍然对齐）' % (x, XFADE_MAX_SEC))
        return 0.0
    _n = len((sb or {}).get('shots') or [])
    print('[MAKE] ★VF_XFADE_V1 真·交叉溶解 %.2f 秒/交界 → 音频侧同步交叉淡化'
          '（画面侧由 render.py 读同一字段；全片音画各缩 %.2f×%d = %.2f 秒）'
          % (x, x, max(0, _n - 1), x * max(0, _n - 1)))
    return x


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


# ★H3_UA_V1（2026-09-21 实测定因）：中转站前置网关（Cloudflare）会拦 Python urllib 的默认 UA
#   （`Python-urllib/x.y`）→ 直接 403、且响应体不是 JSON（实测 `error code: 1010`）。
#   同一请求换正常 UA → 正常返回 JSON。**两处都必须用**：
#     ① API 调用 `_h3_http` ② **产物下载 `_h3_download`** ——
#   漏掉 ② 的症状是"生成成功但一镜都拿不回来"（2026-09-21 用户实测：第 4 镜下载失败 403 → 0/4 镜）。
UA_H3 = 'curl/8.5.0'


def _h3_http(method, url, key, body=None, timeout=30):
    """极简 HTTP（**只用标准库**，不给客户端环境加依赖）→ 返回 dict（失败返回带 error 的 dict）"""
    from urllib.request import Request, urlopen
    from urllib.error import HTTPError
    data = json.dumps(body).encode('utf-8') if body is not None else None
    # ★H3_UA_V1（2026-09-21 实测定因）：Python 的 urllib 默认 UA 是 `Python-urllib/3.x`，
    #   中转站前置网关（Cloudflare 类）会直接 **403 且响应体不是 JSON** → 我们只看到 "HTTP 403"，
    #   很容易误判成"key 没权限"（真·权限问题会返回 JSON 错误体，不会退化成纯 "HTTP 403"）。
    #   这里补一个正常 UA 规避。
    req = Request(url, data=data, method=method,
                  headers={'Content-Type': 'application/json', 'Authorization': 'Bearer %s' % key,
                           'User-Agent': 'curl/8.5.0'})
    try:
        with urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode('utf-8', 'replace') or '{}')
    except HTTPError as e:
        # ★H3_DIAG_V1（2026-09-21）：响应体不是 JSON 时，把【原始响应体前 200 字】一起报出来
        #   ——否则日志永远只有一句 "HTTP 403"，分不清是"网关拦"还是"key 无权/欠费"。
        try:
            raw = e.read()
        except Exception:
            raw = b''
        try:
            return json.loads(raw.decode('utf-8', 'replace') or '{}')
        except Exception:
            snip = raw.decode('utf-8', 'replace').replace('\r', ' ').replace('\n', ' ')[:200]
            return {'error': {'message': 'HTTP %s%s' % (e.code, ('  body=' + snip) if snip else '  (空响应体)')}}
    except Exception as e:
        return {'error': {'message': str(e)[:150]}}


def _h3_download(url, dest, timeout=180):
    """下载片段到本地（成功且不是空壳才算 True）"""
    # ★H3_UA_V1（2026-09-21 实测第 2 处）：**下载这条路也必须带正常 UA** ——
    #   之前只给 `_h3_http`（API 调用）补了 UA，产物下载走这里、漏了 →
    #   同样被 Cloudflare 拦 → `HTTP Error 403: Forbidden` → 生成成功却一镜都拿不回来。
    from urllib.request import Request, urlopen
    req = Request(str(url), headers={'User-Agent': UA_H3})
    with urlopen(req, timeout=timeout) as r, open(dest, 'wb') as f:
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


# ★VF_STYLE_V1（2026-09-21，用户定案"用真正的广告/日常/影视级…成片风格"）：
#   成片风格 id → 喂给 H3 的英文关键词（与 src/lib/agent/vf/vf-aivideo.ts 的 AI_STYLES 保持一致）
H3_STYLE_EN = {
    'cinematic': 'cinematic, film grain, dramatic lighting, shallow depth of field, anamorphic',
    'commercial': 'commercial product shot, clean studio lighting, glossy, hero angle, macro detail',
    'vlog': 'casual vlog, natural light, handheld camera, real life, soft tones',
    'anime': 'anime style, 2D illustration, cel shading, vivid colors, clean line art',
    'toy3d': '3D render, claymation, toy-like, soft studio light, pastel palette',
    'tech': 'futuristic, neon glow, holographic UI, cyber, dark background with cyan accents',
    'documentary': 'documentary style, interview framing, natural skin tones, available light',
    'ink': 'ink painting, hand-drawn, oriental, minimal, rice paper texture',
}


def _ai_style_en(sb):
    """★VF_AI_STYLE_KEY_V1（2026-10-01）：AI 制片线的"画面风格"key（cinematic/commercial/…）→ H3 英文关键词。

    为什么要单独一个函数：服务端已把这个 key 从 plan 根级 **`style`** 改名成 **`ai_style`**
    （避免与渲染层"成品风格" `style` 同名撞车：`render.py::apply_style` 只认 5 个成品风格 id，
     AI 制片线的 `cinematic` 会被它**忽略**；反过来 make.py 若还只读 `style`，就会**丢 H3 风格关键词**
     → 画面风格提示词失效）。
    这里**必须带旧值兜底**：老分镜 / 旧客户端产出的 plan 里这个字段还叫 `style`。
    ⚠️ 这个 `style` 与 `render.py` 的"成品风格"是**两码事**，别把两者并到一处读。"""
    return H3_STYLE_EN.get(str(sb.get('ai_style') or sb.get('style') or ''), '')


def _h3_prompt(shot, idx, style_en=''):
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
    return '%s %s %s' % (p[:600], style_en, _H3_CAM[idx % len(_H3_CAM)])


def _h3_gen_one(prompt, want_sec, resolution, ratio, ref_image=''):
    """单镜生成（同步阻塞）。返回 (本地下载前的 url 或 None, 通道 label, 真实秒数)

    ★VF_I2V_V1（2026-09-29 用户要求「视频能力全部做」）：新增 ref_image —— **图生视频首帧**。
      · ref_image 必须是**公网 URL**：由 Node 侧签好 OSS 直链后写进分镜的 `ref_image` 字段透传过来；
        Python 侧没有 OSS 签名能力，**绝不在本文件里签 URL**（那会把密钥带进内置运行时）。
      · 与 src/lib/minimax-h3.ts 的 submitAndPoll **刻意保持同构**：
        content 追加 {'type':'image_url','image_url':{'url':...},'role':'first_frame'}；
        带首帧时 ratio 用 'adaptive'（画面跟着首帧构图走，避免拉伸变形）。
    """
    import time
    targets = _h3_targets()
    if not targets:
        return (None, '未配置', 0.0)
    last_via = '未配置'
    _ref = str(ref_image or '').strip()
    for t in targets:
        last_via = t['label']
        _content = [{'type': 'text', 'text': prompt[:7000]}]
        if _ref:
            _content.append({'type': 'image_url', 'image_url': {'url': _ref}, 'role': 'first_frame'})
        body = {
            'model': t['model'],
            'content': _content,
            'resolution': resolution,
            # H3 单段只支持 4~15 秒整数 → 按配音时长四舍五入后在范围内夹紧
            'duration': max(4, min(15, int(round(want_sec)))),
            'ratio': 'adaptive' if _ref else ratio,
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
    # ★VF_I2V_CACHE_V1（2026-09-29 用户定案「逐镜开图生视频」配套）：
    #   同一张图在多个镜里出现时，H3 只调【一次】，后面几镜直接复用那段已生成的片段
    #   （拷贝成本地文件）——不然"一张图用 3 镜"会花 3 倍的钱，而且观感会变成
    #   "同一张图一会儿动一会儿不动"。计费在 Node 侧按【唯一图】算，所以复用镜不额外计费。
    _i2v_cache = {}
    _i2v_reuse = 0
    _only = set(int(x) for x in (only_idx or []) if str(x).strip().isdigit())
    sb = json.load(open(sb_path, encoding='utf-8'))
    shots = sb.get('shots') or []
    # ★VF_STYLE_V1：成片风格（顶层字段，由 vf-aivideo.ts 写进 plan）→ 每镜 prompt 都会带上
    # ★VF_AI_STYLE_KEY_V1：字段现在是 `ai_style`（旧 plan 里仍叫 `style`）→ 统一走 `_ai_style_en()`
    _style_en = _ai_style_en(sb)
    if _style_en:
        print('[H3] 成片风格=%s → %s'
              % (sb.get('ai_style') or sb.get('style'), _style_en[:50]))
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
        prompt = _h3_prompt(shot, i, _style_en)
        # ★VF_I2V_V1（2026-09-29）：该镜是否用"它自己的图"当首帧（图生视频）。
        #   ref_image 由 Node 侧签好 OSS 直链后写进分镜透传过来（本文件不签 URL）。
        _ref = str(shot.get('ref_image') or '').strip()
        # ★VF_I2V_CACHE_V1：这张图前面已经生成过 → 直接复用那段片段（不再调 H3、不额外计费）
        #   若缓存里是空串 = 前面【已经试过并且失败】→ 这一镜也保持静态图，不再重试
        #   （否则同一张图会在 N 个镜上各失败一次、白等 N 次；计费在 Node 侧按唯一图算，不受影响）。
        if _ref and _ref in _i2v_cache and not _i2v_cache[_ref]:
            shot['i2v_fallback'] = True
            print('[H3] ⚠️ 第 %d/%d 镜 同一张图前面已失败 → 这一镜保持静态图（不重复重试）'
                  % (i + 1, len(shots)))
            continue
        if _ref and _ref in _i2v_cache:
            _src0 = _i2v_cache[_ref]
            dest = os.path.join(clips, 'shot%02d.mp4' % i)
            try:
                import shutil
                shutil.copyfile(_src0, dest)
            except Exception:
                dest = _src0          # 拷贝失败就直接引用同一文件（渲染层只读它，不修改）
            shot['type'] = 'aivideo'
            shot['src'] = dest
            shot['src_dur'] = round(float(_probe_sec(dest) or 0), 2)
            _i2v_reuse += 1
            ok_n += 1
            total_sec += float(shot.get('src_dur') or 0)
            print('[H3] ♻️ 第 %d/%d 镜 复用同一张图的动图（不再调用、不额外计费）-> %s'
                  % (i + 1, len(shots), os.path.basename(dest)))
            continue
        if _ref:
            print('[H3] 第 %d/%d 镜 图生视频中…（首帧=%s）%s'
                  % (i + 1, len(shots), _ref[:60], prompt[:50]))
        else:
            print('[H3] 第 %d/%d 镜 生成中…（目标 %.1fs）%s' % (i + 1, len(shots), want, prompt[:70]))
        url, via, sec = _h3_gen_one(prompt, want, resolution, ratio, _ref)
        via_last = via
        if not url:
            # ★VF_AIFAIL_V1（2026-09-21）：不再承诺"该镜回退用原画面" ——
            #   素材线/混合线本来就有素材图，退回素材是它们的正常行为；
            #   但 **AI 制片是"文生视频"、没有素材**，缺镜就是"AI 制作失败"（由 main() 统一判定）。
            # ★VF_I2V_V1：**例外** —— 带首帧图的镜（图生视频）失败时可退回它自己的静态图
            #   （render.py 的 bgimage/image 本来就做 Ken Burns 缓动）→ 打标记，由 main() 放行，
            #   不让"让图动起来失败"把整片判死（用户的成片降级原则）。
            if _ref:
                shot['i2v_fallback'] = True
                _i2v_cache[_ref] = ''      # ★VF_I2V_CACHE_V1：记下"这张图试过且失败"，复用镜别再白试
                print('[H3] ⚠️ 第 %d 镜图生视频没拿到（%s）→ 退回它自己的静态图 + Ken Burns（不算整片失败）'
                      % (i + 1, via))
            else:
                print('[H3] ⚠️ 第 %d 镜 AI 画面没拿到（%s）→ 素材线/混合线可回退素材；'
                      'AI 制片线这一镜**算失败**（最后由 main 统一判定）' % (i + 1, via))
            continue
        dest = os.path.join(clips, 'shot%02d.mp4' % i)
        try:
            if not _h3_download(url, dest):
                raise RuntimeError('下载内容过小（可能 0 字节）')
        except Exception as e:
            # ★H3_DLDIAG_V1（2026-09-21）：把**失败的 URL** 一起打出来 ——
            #   原来只有 "HTTP Error 403: Forbidden"，看不出是哪个地址失败（换 key/换站时没法验证）。
            print('[H3] ⚠️ 第 %d 镜下载失败: %s  url=%s（AI 制片线这一镜**算失败**）'
                  % (i + 1, str(e)[:120], str(url)[:110]))
            # ★VF_I2V_V1：带首帧图的镜退回静态图（Ken Burns），同样不判死整片
            if _ref:
                shot['i2v_fallback'] = True
            continue
        real = float(sec or 0) or _probe_sec(dest)
        shot['type'] = 'aivideo'
        shot['src'] = dest
        shot['src_dur'] = round(float(real or 0), 2)
        ok_n += 1
        total_sec += float(real or 0)
        if _ref:
            _i2v_cache[_ref] = dest      # ★VF_I2V_CACHE_V1：登记，后面同图的镜直接复用
        print('[H3] ✅ 第 %d 镜 OK  %s  %.1fs -> %s' % (i + 1, via, float(real or 0), os.path.basename(dest)))
    out_path = os.path.join(wd, 'storyboard.ai.json')
    json.dump(sb, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    if _i2v_reuse:
        print('[H3] ♻️ 其中 %d 镜复用同一张图的动图（不额外计费；计费按唯一图算）' % _i2v_reuse)
    print('[H3] 生成完成：**%d/%d 镜**，共 %.1f 秒，通道=%s' % (ok_n, len(shots), total_sec, via_last))
    # ★I2V_BILL_V1（2026-09-30 用户实测质疑「3 张动图看不出动、这钱花的不值」后核查发现）：
    #   **计费漏洞** —— 图生视频失败时我们【静默退回静态图】（见上面的 i2v_fallback，刻意的，
    #   不让"让图动起来失败"判死整片）；但 Node 侧（route.ts）的扣费是按**计划秒数**算的
    #   （整片成功就扣 vfCost）→ **没生成出来也照扣 = 多扣用户的钱**。
    #   这里把【真实成功】的图数/秒数打成一行机器可读日志；Node 侧解析后【只少收、不多收】。
    #   口径提示：sec 只统计**成功生成的那些唯一图**的片段秒数（复用镜不重复计）。
    try:
        _ok_n, _ok_sec, _fail_n = 0, 0.0, 0
        for _v in _i2v_cache.values():
            if _v:
                _ok_n += 1
                try:
                    _ok_sec += float(_probe_sec(_v) or 0)
                except Exception:
                    pass
            else:
                _fail_n += 1
        print('[VF] ★I2V_REAL:{"images":%d,"sec":%.2f,"reuse":%d,"fail":%d}'
              % (_ok_n, _ok_sec, _i2v_reuse, _fail_n))
    except Exception as _eI:
        print('[VF] ★I2V_REAL 统计异常（忽略，按原价扣）: %s' % str(_eI)[:80])
    return (out_path, ok_n, total_sec, via_last)


# ══════════════════ ★VF_SHOTLIMIT_V1（2026-10-01）单镜硬闸门（出片前最后一道）══════════════════
# 用户实测事故（2026-10-01，成片 20261001_003，242 秒）：
#   `storyboard.voiced.json` 里 **第 30 镜：subtitle 276 字 / 配音 51.84s / 镜长 52.19s**（title 卡）→
#   ① 全片计划 198 秒被拉到 242 秒；② 那一镜是纯文字卡 → 52 秒画面几乎完全不动（用户："最后缺帧、
#   配音字幕都没完就定格了"）；③ 我逐帧实测"最后 37 秒连续静止"完全吻合。
#
# 为什么还要在 make.py 再做一道（TS 侧已经有 splitLongSubtitles 了）：
#   事故当时 TS 侧的拆镜**没有生效**（服务端任务文件里还是 30 镜、第 30 镜 276 字）——
#   不论根因是"版本没部署到"还是"某条路径没走到"，**出片链路都不该依赖单一环节**。
#   这里做成**与 TS 侧版本无关的独立兜底**，口径与 src/lib/agent/vf/anti-ai.ts 严格同源：
#     · 上限 = min(60, ceil(dur × 4.3))（4.3 字/秒是实测中文口播速度）
#     · 标点优先断句 → 再按字数硬切；**segs 拼回来必须 === 原文（一字不丢）**
#     · 各段 dur 按字数比例分、每段 ≥2 秒；不足则整镜总时长抬到 段数×2（时长本就由配音决定）
#
# ⚠️ 位置铁律：**必须在调 tts.py 之前**。因为音频是"逐镜 TTS 后按各镜 dur 拼成一条轨"——
#   若放到 render.py（音频已合并完）再拆，字幕/配音就会与画面错位。
SUB_CPS = 4.3        # 中文口播速度（字/秒，实测）—— 与 anti-ai.ts 的 VF_SUB_CPS 同源
SUB_MAX = 60         # 单镜字幕硬上限（字）—— 60 字 ≈ 14 秒口播
SHOT_MIN_SEC = 2.0   # 拆出来的每一镜最短时长（秒）
SUB_PUNC = '。！？；，'   # 中文断句标点（标点跟在前一段尾部，保证拼回来一字不差）


def sub_cap(dur):
    """单镜字幕上限 = min(60, ceil(dur × 4.3))；dur 非法 → 按 3 秒算（= 上限 13 字）"""
    try:
        d = float(dur)
    except Exception:
        d = 3.0
    if d < 1:
        d = 1.0
    return max(1, min(SUB_MAX, int(d * SUB_CPS + 0.9999)))


def split_text_by_cap(text, cap):
    """把一段文字按「每段 ≤ cap 字」切分（标点优先，切不出来再按字数硬切）。
    **返回值是原文的连续子串，''.join(segs) === 原文**（一字不少，含标点）。"""
    s = '' if text is None else str(text)
    c = max(1, int(cap or 1))
    if not s:
        return []
    if len(s) <= c:
        return [s]
    pieces, cur = [], ''
    for ch in s:
        cur += ch
        if ch in SUB_PUNC:
            pieces.append(cur)
            cur = ''
    if cur:
        pieces.append(cur)
    out, buf = [], ''
    for p in pieces:
        if len(p) > c:
            if buf:
                out.append(buf)
                buf = ''
            # ★VF_KINOKU_V1（2026-10-06）：硬切时**不许切在"字母数字串 / 数字+单位"中间**。
            #   同源问题在成片里眼见为实过（大字被切成「真正价值在6」，原句含「6.1MB」）——
            #   字幕侧同样会中招：`12400人`/`6.1MB` 被切开 ⇒ TTS 念错、字幕断词。
            #   做法 = 与 TS 侧 `anti-ai.pickKinsokuCut` 同口径的"禁则回退"（最多往回挪 4 字）；
            #   挪不动就原样切 —— 本函数契约 `''.join(segs) === 原文` **永不破坏**（一字不少）。
            i = 0
            while i < len(p):
                j = min(len(p), i + c)
                if j < len(p):
                    k, back = j, 0
                    while k > i + 1 and back < 4:
                        prev, nxt = p[k - 1], p[k]
                        bad = False
                        # (a) ASCII 字母数字串不许切开（6|1、A|B、6|.）；⚠️ 必须限定 isascii ——
                        #     `isalnum()` 对**汉字也为真**，不限定就会把整句中文都当成"一个词"而拒绝切分。
                        if (prev.isascii() and nxt.isascii()
                                and (prev.isalnum() or prev in '.%') and (nxt.isalnum() or nxt in '.%')):
                            bad = True
                        # (b) 数字 + 中文单位（1|万、2|人）
                        if prev.isdigit() and nxt in '万亿千百十个条次天元秒%':
                            bad = True
                        # (c) 小数点 / 百分号两侧（6|. 与 %|的）
                        if prev in '.%' or nxt in '.%':
                            bad = True
                        # (d) 标点不许落在下一段段首
                        if nxt in '，。！？；、：,.;:!?）)】」》':
                            bad = True
                        if not bad:
                            break
                        k -= 1
                        back += 1
                    if k > i + 1 and back < 4:
                        j = k
                    else:
                        # ★VF_KINOKU_V1：回退救不回来（整个窗口就是一个超长数字/英文串，如 "96.5%" 占满 cap）
                        #   ⇒ **宁可让这一段超 cap 一点，也绝不把它切坏**（数字/英文被切 = 配音念错 + 字幕断词，
                        #   比"字幕多一个字"严重得多）。最多往后多吃 6 字；仍要保证 j > i（有进展，不死循环）。
                        lim = min(len(p), i + c + 6)
                        # ⚠️ 必须限定 ASCII：Python 的 `str.isalnum()` 对**汉字也为真** ——
                        #   首版写成 `ch.isalnum()` 会让"前向补齐"一路把整句汉字都当成同一个词吃掉
                        #   （实测 cap=6 时第一段变成 10 个字，等于把 cap 废掉）。只认 ASCII 字母数字与 `.` `%`。
                        _w = lambda ch: (ch.isascii() and ch.isalnum()) or ch in '.%'  # noqa: E731
                        while j < lim and j > i and _w(p[j - 1]) and _w(p[j]):
                            j += 1
                out.append(p[i:j])
                i = j
            continue
        if len(buf) + len(p) <= c:
            buf += p
        else:
            if buf:
                out.append(buf)
            buf = p
    if buf:
        out.append(buf)
    return out


def enforce_shot_limits(sb):
    """★VF_SHOTLIMIT_V1：把字幕超长的镜【按句拆成多镜】（就地改 sb['shots']）。
    返回 (是否有改动, 说明 list, "读不完但未超上限"的镜数)。**绝不上抛**：异常由调用方兜住，不影响出片。
    只换 subtitle + dur，其余字段（type/src/text/主题/版式…）原样继承 → 画面风格不变。

    ⚠️ 用【固定 60 字】硬上限，而不是"按镜长算"的上限 —— 后者**不幂等**：
      TS 侧已经按 `min(60, dur×4.3)` 拆过一次后，拆出来的段 dur 也变小了 →
      这里按新 dur 再算会算出一个更小的上限 → **把已经拆好的段再拆一遍**（越拆越碎）。
      固定 60 字则：拆一次之后每段都 ≤60 → 第二次跑必然 0 改动（幂等），
      而 003 那种 276 字的灾难镜照样被拆开。"""
    shots = (sb or {}).get('shots') or []
    out, notes, soft = [], [], 0
    for i, sh in enumerate(shots):
        s = sh if isinstance(sh, dict) else {}
        sub = '' if s.get('subtitle') is None else str(s.get('subtitle'))
        if len(sub) <= SUB_MAX:
            # 没超硬上限：只统计"按这镜的时长明显读不完"的（≥2 字差距）→ 提示，绝不改
            if len(sub) > sub_cap(s.get('dur')) + 2:
                soft += 1
            out.append(s)
            continue
        segs = split_text_by_cap(sub, SUB_MAX)
        if len(segs) <= 1:
            out.append(s)
            continue
        # 各段时长：按字数比例分（用"厘秒"整数分配，保证各段之和精确等于总时长）
        try:
            orig = float(s.get('dur') or 3)
        except Exception:
            orig = 3.0
        orig = max(1.0, orig)
        min_total = len(segs) * SHOT_MIN_SEC
        use_total = max(orig, min_total)
        total_len = sum(len(x) for x in segs) or 1
        total_cs = int(round(use_total * 100))
        min_cs = int(SHOT_MIN_SEC * 100)
        remain_cs = max(0, total_cs - len(segs) * min_cs)
        acc, prev, durs = 0.0, 0, []
        for sg in segs:
            acc += remain_cs * (len(sg) / float(total_len))
            cur = int(round(acc))
            durs.append((min_cs + (cur - prev)) / 100.0)
            prev = cur
        for k, sg in enumerate(segs):
            item = dict(s)
            item['subtitle'] = sg
            item['dur'] = durs[k]
            out.append(item)
        notes.append('第 %d 镜字幕 %d 字 / %.1fs → 拆成 %d 镜（每段 ≤%d 字、≥%.0fs%s）'
                     % (i + 1, len(sub), orig, len(segs), SUB_MAX, SHOT_MIN_SEC,
                        ('' if use_total <= orig + 0.01 else '；总时长 %.1fs→%.1fs' % (orig, use_total))))
    if notes:
        sb['shots'] = out
        return True, notes, soft
    return False, [], soft


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--script', default='', help='一段文案（自动切句成卡）')
    ap.add_argument('--storyboard', default='', help='现成分镜 JSON 文件')
    ap.add_argument('--plan', default='', help='AI 给的分镜 JSON 字符串（或 @文件路径）——优先级最高')
    ap.add_argument('--preview', action='store_true', help='只输出分镜计划（JSON），不配音不渲染')
    # ★VF_THEMES_V1（2026-09-29）：**故意不加 choices** —— 以前写死 3 个主题名，用户/前端传了新主题名
    #   会被 argparse 直接拒绝（exit 2，整条出片失败）。现在任何名字都收下，theme_of() 查不到就用默认主题。
    ap.add_argument('--theme', default='dark')
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
    # ★VF_EDIT_V1（2026-09-24 用户定案「分镜/大字要可编辑」）：
    #   只重渲染 —— 跳过 TTS，直接用 workdir 里已有的 storyboard.voiced.json + voice.m4a。
    #   改一个画面大字没必要重新配音（配音要 2~4 分钟且花 TTS 钱）→ 这条路径只花渲染时间。
    ap.add_argument('--render-only', action='store_true',
                    help='★只重渲染：复用 workdir 里已有的分镜+配音，不重新 TTS（改大字/卡型后用）')
    a = ap.parse_args()

    if not a.script and not a.storyboard and not a.plan and not a.render_only:
        print('需要 --script / --storyboard / --plan 之一'); sys.exit(2)

    wd = a.workdir or os.path.join(os.path.dirname(os.path.abspath(a.out)), 'vf-work')
    os.makedirs(wd, exist_ok=True)

    # ★VF_EDIT_V1：只重渲染分支 —— 在【分镜构建/配音/AI 片段】之前就返回
    if a.render_only:
        _voiced = os.path.join(wd, 'storyboard.voiced.json')
        _ai = os.path.join(wd, 'storyboard.ai.json')
        _plain = os.path.join(wd, 'storyboard.json')
        # 优先 ai（AI 线/混合线出片时用的就是它），再 voiced（素材线，含每镜真实配音时长），再 plain
        _use = _ai if os.path.exists(_ai) else (_voiced if os.path.exists(_voiced) else _plain)
        if not os.path.exists(_use):
            print('[MAKE] ❌ --render-only 但 work 目录里找不到分镜文件: %s' % wd); sys.exit(2)
        _vpath = os.path.join(wd, 'voice.m4a')
        _use_v = _vpath if os.path.exists(_vpath) else ''
        try:
            _sbj = json.load(open(_use, encoding='utf-8'))
            _n = len(_sbj.get('shots', []) or [])
        except Exception as e:
            print('[MAKE] ❌ --render-only 读分镜失败: %s' % str(e)[:160]); sys.exit(2)
        print('[MAKE] ★只重渲染（复用已有分镜与配音，不重新 TTS）：%s / %d 镜 / 音频 %s'
              % (os.path.basename(_use), _n, 'voice.m4a' if _use_v else '（无）'))
        ok2 = run('"%s" "%s" --storyboard "%s" --workdir "%s" --audio "%s" --bgm "%s" --out "%s"'
                  % (sys.executable, os.path.join(HERE, 'render.py'), _use,
                     os.path.join(wd, 'render'), _use_v, a.bgm, a.out), '渲染成片')
        if ok2 and os.path.exists(a.out):
            print('[MAKE] ✅ 成片（重渲染）: %s  (%.1f MB)'
                  % (a.out, os.path.getsize(a.out) / 1048576.0))
        else:
            print('[MAKE] ❌ 渲染失败')
            sys.exit(1)
        return

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

    # ★VF_SHOTLIMIT_V1（2026-10-01）单镜硬闸门 —— **必须在 tts.py 之前**：
    #   用户实测事故：第 30 镜 276 字 / 52 秒（纯文字卡）→ 全片超 44 秒、末段 37 秒画面静止。
    #   TS 侧的 splitLongSubtitles 当时没生效（不论原因是版本还是路径），所以这里做**独立兜底**。
    #   拆完把分镜写进 work 目录（不动调用方传进来的文件），后续 tts/render 都用这一份。
    try:
        _changed, _notes, _soft = enforce_shot_limits(sb)
        if _changed:
            _split_path = os.path.join(wd, 'storyboard.split.json')
            json.dump(sb, open(_split_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
            sb_path = _split_path
            print('[MAKE] ★单镜硬闸门（★VF_SHOTLIMIT_V1）：%d 镜超限 → 拆后共 %d 镜'
                  % (len(_notes), len(sb.get('shots', []))))
            for _n in _notes[:8]:
                print('   ' + _n)
            if len(_notes) > 8:
                print('   …（还有 %d 镜超限，已同样拆分）' % (len(_notes) - 8))
            print('[MAKE] 拆后分镜 → %s' % _split_path)
        if _soft:
            print('[MAKE] ℹ️ 另有 %d 镜字幕按"该镜时长"读不完（但未超 %d 字硬上限）→ 未改动；'
                  '真实镜长会由配音回填（片长随之变长）' % (_soft, SUB_MAX))
    except Exception as _eL:
        print('[MAKE] ⚠️ 单镜硬闸门异常（忽略，按原分镜出片）: %s' % str(_eL)[:140])
    # 顺带如实提示"没字幕但很长的镜"（那种镜配音为空 → 画面会长时间不动；只提示不修改）
    try:
        for _j, _s in enumerate(sb.get('shots') or []):
            _d = float(_s.get('dur') or 0)
            if _d > 15 and not str(_s.get('subtitle') or '').strip():
                print('[MAKE] ⚠️ 第 %d 镜 dur=%.1fs 且没有字幕 → 画面会长时间不动（建议分镜侧拆开）'
                      % (_j + 1, _d))
    except Exception:
        pass

    # ② 配音（回填真实时长）
    voiced = os.path.join(wd, 'storyboard.voiced.json')
    voice = os.path.join(wd, 'voice.m4a')
    # ★VF_XFADE_V1（2026-09-29）：分镜根级 `xfade`（真·交叉溶解）→ 必须把**同一数值**传给音频侧，
    #   否则音轨比 xfade 后的画面长 X×(n-1) 秒 → 全片音画持续错位（详见 xfade_of 上方注释）。
    _xf = xfade_of(sb)
    ok = run('"%s" "%s" --storyboard "%s" --workdir "%s" --speaker "%s" --out-json "%s" --merge "%s"%s'
             % (sys.executable, os.path.join(HERE, 'tts.py'), sb_path, os.path.join(wd, 'tts'),
                a.speaker, voiced, voice, (' --xfade %.4f' % _xf) if _xf > 0 else ''), '逐句配音')
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
            # ★VF_AIFAIL_V1（2026-09-21 用户定案：「AI 制片就是除了第一步看用户，其它都不拿个人仓库素材；
            #   失败了就是 AI 制作失败」「不要什么降级」）：
            #   **AI 制片必须每一镜都是 AI 画面** —— 缺任何一镜都不许用素材/文字卡顶替 → 直接判失败。
            _tot = len(sb.get('shots', []) or [])
            # ★VF_I2V_V1（2026-09-29）：带首帧图的镜（图生视频）失败时可退回它自己的静态图
            #   （Ken Burns）→ 从"必须成功"的硬指标里剔除，**不让"让图动起来失败"判死整片**。
            #   （纯文生视频的镜没有图可退 → 仍按 VF_AIFAIL_V1：缺镜即失败。）
            _fb = 0
            try:
                _sbj2 = json.load(open(ai_sb, encoding='utf-8'))
                _fb = len([s for s in (_sbj2.get('shots') or []) if s.get('i2v_fallback')])
            except Exception:
                _fb = 0
            if (not _isMix) and a.source == 'ai' and (ai_n + _fb) < _tot:
                print('[MAKE] ❌ AI 制片：只拿到 %d/%d 镜的 AI 画面 → **不用素材顶、不降级 = AI 制作失败**'
                      % (ai_n, _tot))
                print('[MAKE]    ↑ 病因看上面的 [H3] 行；这是"文生视频"，缺镜不能拿素材凑。')
                sys.exit(5)
            if _fb:
                print('[MAKE] ⚠️ %d 镜图生视频没拿到 → 退回各自的静态图 + Ken Burns（其余 %d 镜是 AI 画面）'
                      % (_fb, ai_n))
            use_sb = ai_sb
            print('[MAKE] AI 片段就绪：%d 镜 / %.1f 秒（通道 %s）→ 用 storyboard.ai.json 渲染'
                  % (ai_n, ai_sec, ai_via))
        elif _isMix:
            # 混合线本来就是"素材 + AI"：AI 镜全失败 → 回退纯素材合成是**合理的**（本线有素材画面）
            print('[MAKE] ⚠️ 混合线的 AI 镜一镜都没成功 → 回退成素材合成（本线本来就有素材画面）')
        else:
            # ★VF_AIFAIL_V1（2026-09-21 用户实测 + 用户定案：**"AI 直接不就出了"**）：
            #   「AI 制片」= 整片画面由 AI 生成 → **一镜都没成功时不该回退素材合成**：
            #     ① 用户要的是 AI 画面，回退出来的是"素材拼片"，根本不是他要的东西；
            #     ② 实测更糟：AI 制片通常【没有素材】（用户仓库 0 张图）→ 分镜里的 bgimage
            #        没有图片路径 → render.py 抛 `No such file or directory` → **整片失败**，
            #        界面上还堆一大堆"渲染错误"（把真正的病因"下载 403"埋在下面，极具误导性）。
            #   → 直接失败，并把**真正的病因**说清楚，不再产生误导性的渲染报错。
            print('[MAKE] ❌ AI 画面一镜都没生成成功 → **不回退素材合成，直接失败**')
            print('[MAKE]    ↑ 病因看上面的 [H3] 行（多为"中转产物下载 403 / 超时 / key 失效"）——'
                  '把这几行发出来即可定位；修好后回「重试」重跑（已生成的镜会复用，不重复扣费）。')
            sys.exit(5)
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
