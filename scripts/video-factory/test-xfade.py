# -*- coding: utf-8 -*-
"""★VF_XFADE_V1 离线自测（不联网：本地 ffmpeg 合成正弦波当"配音"）

运行： python C:\\Users\\Admin\\AppData\\Local\\Temp\\vf-xfade-test\\test_xfade.py
依赖： PATH 上的 ffmpeg / ffprobe；tts_before.py = git show HEAD:scripts/video-factory/tts.py
断言：
  T1 --xfade 0 时输出与改动前一致（逐字节；若容器 creation_time 不同则退一步比【解码 PCM】）
  T2 --xfade 0.35 时总时长 = Σ每镜 - 0.35×(段数-1)，误差 < 0.05s
  T3 段数 ≠ 镜数 → 回退【硬拼+补尾隙】并打日志，时长回到 Σ每镜
  T4 某段太短（≤ xfade）→ 回退并打日志
  T5 交叉淡化不削波（峰值 ≤ 0.0 dBFS 且与 xfade=0 相当）
  T6 make.py 会把分镜根级 xfade 透传成 tts.py 的 --xfade
  T7 tts.py CLI 认 --xfade
"""
import hashlib
import importlib.util
import io
import json
import os
import re
import subprocess
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

TH = os.path.dirname(os.path.abspath(__file__))
REPO = r'g:\AiMarketing\scripts\video-factory'
FF = 'ffmpeg'
FAIL = []


def check(name, cond, detail=''):
    print('%s %s  %s' % ('PASS' if cond else 'FAIL', name, detail))
    if not cond:
        FAIL.append(name)


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    m = importlib.util.module_from_spec(spec)
    sys.modules[name] = m
    spec.loader.exec_module(m)
    return m


def md5file(p):
    return hashlib.md5(open(p, 'rb').read()).hexdigest()


def pcm_md5(p):
    """解码成 s16le/24k/mono 的裸 PCM 再哈希 —— 内容级"逐字节"，不受容器时间戳影响"""
    r = subprocess.run([FF, '-nostdin', '-v', 'error', '-i', p, '-f', 's16le', '-ar', '24000', '-ac', '1', '-'],
                       capture_output=True)
    return hashlib.md5(r.stdout or b'').hexdigest(), len(r.stdout or b'')


def peak_db(p):
    r = subprocess.run([FF, '-nostdin', '-i', p, '-af', 'volumedetect', '-f', 'null', '-'],
                       capture_output=True, text=True, encoding='utf-8', errors='replace')
    m = re.search(r'max_volume:\s*(-?[\d.]+)', r.stderr or '')
    return float(m.group(1)) if m else None


def gen(freq, dur, out):
    """本地合成一段正弦（volume=4 → 约 -6dBFS，既不先削顶、又足够验证"淡化不放大"）"""
    subprocess.run([FF, '-nostdin', '-y', '-f', 'lavfi',
                    '-i', 'sine=frequency=%d:duration=%.3f' % (freq, dur),
                    '-af', 'volume=4', '-ar', '24000', '-ac', '1', '-c:a', 'aac', '-b:a', '96k', out],
                   capture_output=True)
    return os.path.exists(out) and os.path.getsize(out) > 2000


def run_silent(fn, *a, **kw):
    """跑 fn 并捕获它打到 stdout 的日志"""
    buf, old = io.StringIO(), sys.stdout
    sys.stdout = buf
    try:
        r = fn(*a, **kw)
    finally:
        sys.stdout = old
    return r, buf.getvalue()


def main():
    before = load(os.path.join(TH, 'tts_before.py'), 'tts_before')
    after = load(os.path.join(REPO, 'tts.py'), 'tts_after')

    # ---------- 造 4 段本地音频（不联网） ----------
    freqs, seg_voice, tail = [440, 523, 659, 784], 1.6, 0.4
    files = []
    for i, f in enumerate(freqs):
        p = os.path.join(TH, 'vo%d.m4a' % i)
        assert gen(f, seg_voice, p), '本地合成失败: %s' % p
        files.append(p)
    clips = [(p, seg_voice + tail) for p in files]      # 每镜 2.0s = 配音 1.6 + 尾隙 0.4
    n, shot = len(clips), seg_voice + tail
    S = shot * n                                       # 8.0
    XD = 0.35
    EXP = S - XD * (n - 1)                             # 6.95
    print('夹具: %d 段 × %.2fs = %.2fs；xfade=%.2f → 预期 %.3fs' % (n, shot, S, XD, EXP))

    # ---------- T1 回归：--xfade 0 == 改动前 ----------
    o_b = os.path.join(TH, 'out_before.m4a')
    o_0 = os.path.join(TH, 'out_xfade0.m4a')
    before.merge_audio(clips, o_b)
    after.merge_audio(clips, o_0, 0.0)
    same_bytes = md5file(o_b) == md5file(o_0)
    p1, n1 = pcm_md5(o_b)
    p2, n2 = pcm_md5(o_0)
    d_b, d_0 = before.real_dur_sec(o_b), after.real_dur_sec(o_0)
    check('T1a xfade=0 输出与改动前逐字节一致',
          same_bytes, 'md5 %s vs %s' % (md5file(o_b)[:12], md5file(o_0)[:12]))
    check('T1b xfade=0 解码 PCM 与改动前逐字节一致',
          p1 == p2 and n1 == n2, 'pcm %s vs %s (%d bytes)' % (p1[:12], p2[:12], n1))
    check('T1c xfade=0 时长与改动前一致',
          abs(d_b - d_0) < 0.001 and abs(d_0 - S) < 0.05, 'before %.3fs / after %.3fs / Σ %.2fs' % (d_b, d_0, S))

    # ---------- T2 交叉淡化：总长 = Σ - X×(n-1) ----------
    o_x = os.path.join(TH, 'out_xfade035.m4a')
    _, log_x = run_silent(after.merge_audio, clips, o_x, XD)
    real_x, hdr_x = after.real_dur_sec(o_x), after.mp3_duration(o_x)
    check('T2a xfade=0.35 总时长 = Σ%.2f - %.2f×%d = %.3f'
          % (S, XD, n - 1, EXP), abs(real_x - EXP) < 0.05,
          '实测 %.3fs（误差 %+.3fs）头 %.3fs' % (real_x, real_x - EXP, hdr_x))
    check('T2b 比 xfade=0 短 恰好 %.2fs' % (XD * (n - 1)),
          abs((d_0 - real_x) - XD * (n - 1)) < 0.05, '%.3fs' % (d_0 - real_x))
    check('T2c 走了交叉淡化分支（日志含"交叉淡化合并"）', '交叉淡化合并' in log_x)
    span = re.search(r'交界 ([\d.]+)s / 总长 ([\d.]+)s', log_x)
    check('T2d 日志报了交界/总长', bool(span), (log_x.strip().splitlines() or [''])[-1][:90])

    # ---------- T3 段数 ≠ 镜数 → 回退 ----------
    clips_bad = clips + [(None, 0.0)]                  # 第 5 镜无音频且时长 0 → 不产生片段
    o_fb = os.path.join(TH, 'out_fallback_n.mp4')
    _, log_fb = run_silent(after.merge_audio, clips_bad, o_fb, XD)
    real_fb = after.real_dur_sec(o_fb)
    check('T3a 段数不匹配 → 回退（日志含"跳过交叉淡化"+"回退【硬拼 + 补尾隙】"）',
          '跳过交叉淡化' in log_fb and '回退【硬拼 + 补尾隙】' in log_fb,
          next((l.strip() for l in log_fb.splitlines() if '跳过交叉淡化' in l), '')[:100])
    check('T3b 回退后时长回到 Σ每镜 %.2fs（未缩）', abs(real_fb - S) < 0.05, '实测 %.3fs' % real_fb)

    # ---------- T4 某段太短 → 回退 ----------
    clips_short = [clips[0], (files[1], 0.2)]
    o_s = os.path.join(TH, 'out_fallback_short.m4a')
    _, log_s = run_silent(after.merge_audio, clips_short, o_s, XD)
    check('T4 段长 ≤ xfade → 回退并说明原因',
          '跳过交叉淡化' in log_s and '不够淡化' in log_s,
          next((l.strip() for l in log_s.splitlines() if '跳过交叉淡化' in l), '')[:100])

    # ---------- T5 不削波 ----------
    pk_x, pk_0 = peak_db(o_x), peak_db(o_0)
    check('T5a 交叉淡化后峰值 ≤ 0.0 dBFS（无削波）',
          pk_x is not None and pk_x <= 0.05, 'peak %.2f dB' % (pk_x if pk_x is not None else 999))
    check('T5b 峰值与 xfade=0 相当（淡化是加权和，不放大）',
          pk_x is not None and pk_0 is not None and abs(pk_x - pk_0) <= 0.6,
          'xfade %.2f dB / 无淡化 %.2f dB' % (pk_x, pk_0))

    # ---------- T6 make.py 透传 ----------
    mk = load(os.path.join(REPO, 'make.py'), 'mk')
    check('T6a make.xfade_of 读根级 xfade', abs(mk.xfade_of({'xfade': 0.35, 'shots': [{}] * 4}) - 0.35) < 1e-9)
    check('T6b xfade 过大 → 0（不做转场）', mk.xfade_of({'xfade': 9, 'shots': [{}] * 4}) == 0.0)
    check('T6c xfade 非法 → 0', mk.xfade_of({'xfade': 'abc'}) == 0.0 and mk.xfade_of({}) == 0.0)
    sb_path = os.path.join(TH, 'sb_xfade.json')
    json.dump({'size': [1280, 720], 'fps': 25, 'xfade': 0.35,
               'shots': [{'type': 'title', 'text': 'A', 'dur': 2.0},
                         {'type': 'title', 'text': 'B', 'dur': 2.0}]},
              open(sb_path, 'w', encoding='utf-8'), ensure_ascii=False)
    cap = []
    mk.run = lambda cmd, label: (cap.append((label, cmd)), False)[1]   # 假 run：只抓命令，不真执行
    mk.sys.argv = ['make.py', '--storyboard', sb_path, '--out', os.path.join(TH, 'o.mp4'),
                   '--workdir', os.path.join(TH, 'wd')]
    try:
        mk.main()
    except SystemExit:
        pass
    tts_cmd = next((c for l, c in cap if l == '逐句配音'), '')
    check('T6d make.py 把 xfade 传给 tts.py（--xfade 0.3500）',
          '--xfade 0.3500' in tts_cmd, tts_cmd.split('tts.py', 1)[-1][:120])
    json.dump({'size': [1280, 720], 'fps': 25,
               'shots': [{'type': 'title', 'text': 'A', 'dur': 2.0}]},
              open(sb_path, 'w', encoding='utf-8'), ensure_ascii=False)
    cap.clear()
    try:
        mk.main()
    except SystemExit:
        pass
    tts_cmd2 = next((c for l, c in cap if l == '逐句配音'), '')
    check('T6e 分镜里没有 xfade → 命令里不带 --xfade（老行为）',
          '--xfade' not in tts_cmd2, tts_cmd2.split('tts.py', 1)[-1][:120])

    # ---------- T7 CLI ----------
    r = subprocess.run([sys.executable, os.path.join(REPO, 'tts.py'), '--help'],
                       capture_output=True, text=True, encoding='utf-8', errors='replace')
    check('T7 tts.py --help 里有 --xfade', '--xfade' in (r.stdout or ''))

    print('\n=== %s：%d 项断言，%d 项失败 ===' % ('全过' if not FAIL else '有失败', 15, len(FAIL)))
    for f in FAIL:
        print('   FAILED: %s' % f)
    return 1 if FAIL else 0


if __name__ == '__main__':
    sys.exit(main())
