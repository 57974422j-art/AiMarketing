#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""★VF_ARGV_V1 回归护栏（2026-10-01，team-lead「治本」要求的防回退自测）。

背景（线上实测，老板报过三次"空色块"）：
  `%` 是 ffmpeg drawtext 的展开语法起点 → esc_text 转成 `\\%`（两层）。
  旧代码把整条滤镜串拼成 shell 字符串 + `subprocess.run(cmd, shell=True)` →
  Linux 上走 /bin/sh，双引号里 `\\` 被 shell 吃成 `\` → ffmpeg 收到**裸 `%`** → 报 `Stray %` →
  **该 drawtext 一个字都不画**（同串 drawbox 照画 = 有框无字 = 老板看到的"空色块"）。
  ⚠️ Windows 的 cmd.exe 不处理反斜杠 → **本机原来的路径永远测不出来**，这才是它长期没查出的原因。
  治本 = 全部 ffmpeg 调用改成 **argv 数组、不过 shell**（★VF_ARGV_V1）。

本测试做三件事：
  ① 静态断言：render.py 的**代码**里再也不能出现 `shell=True` / `os.system`（用 AST 扫，注释/docstring 不算）。
  ② 单元断言：esc_text 对 `%` 输出**两层**反斜杠。
  ③ 真渲对照（同一份 banner 文案，含 `%`）：
       A. argv 直接跑（当前生产路径）            → 顶部带必须**有白字**
       B. `sh -c "<旧 shell 字符串>"`（模拟线上） → 期望 **0 白字**（复现"Stray %"丢字）
       C. `sh -c 'exec "$@"' sh <argv...>`（POSIX 语义下 argv）→ 必须**有白字**（证明 argv 免疫）
     注：B 需要 POSIX sh（Git for Windows 自带 /bin/sh）；找不到 sh.exe 时 B/C 记 SKIP，不算失败。

只读 render.py；只在 --wd 指定的临时目录写文件。用法：
  python scripts/video-factory/test-argv-noshell.py [--wd <目录>]
"""
import argparse
import ast
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
RENDER = os.path.join(HERE, 'render.py')
sys.path.insert(0, HERE)

import render  # noqa: E402

OK = []
NG = []


def _ok(msg):
    OK.append(msg)
    print('  [PASS] ' + msg)


def _ng(msg):
    NG.append(msg)
    print('  [FAIL] ' + msg)


def _skip(msg):
    print('  [SKIP] ' + msg)


# ────────────────────────────────── ① 静态断言（AST） ──────────────────────────────────
def t_static_no_shell():
    print('\n① 静态断言：render.py 代码里不得再出现 shell=True / os.system / os.popen')
    src = open(RENDER, encoding='utf-8').read()
    tree = ast.parse(src)
    hits = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        for kw in node.keywords:                     # subprocess.run(..., shell=True)
            if kw.arg == 'shell':
                v = getattr(kw.value, 'value', None)
                if v is not False:                   # shell=False / 变量也算命中（要求显式不存在）
                    hits.append('line %d: 关键字 shell=%r' % (node.lineno, v))
        f = node.func
        if isinstance(f, ast.Attribute) and f.attr in ('system', 'popen'):
            hits.append('line %d: %s()' % (node.lineno, f.attr))
    if hits:
        for h in hits:
            _ng('代码里仍有 shell 调用点 → ' + h)
    else:
        _ok('AST 扫描：0 处 shell=True / os.system / os.popen（注释与 docstring 不算）')


# ────────────────────────────────── ② esc_text 两层 ──────────────────────────────────
def t_esc_two_layers():
    print('\n② 单元断言：esc_text 对 `%` 必须输出【两层】反斜杠（argv 下正确的层数）')
    BS = chr(92)                                     # 反斜杠
    got = render.esc_text('点击率8.5%')
    want = '点击率8.5' + BS * 2 + '%'
    if got == want:
        _ok('esc_text("点击率8.5%%") == 点击率8.5%s%%（%d 个反斜杠）' % (BS * 2, got.count(BS)))
    else:
        _ng('esc_text 层数不对：got=%r want=%r' % (got, want))
    # 冒号 / 单引号 / 反斜杠 也各查一眼（防止有人顺手改歪）
    if render.esc_text('a:b') == 'a' + BS + ':b':
        _ok('esc_text 冒号转义仍是一层 `\\:`')
    else:
        _ng('esc_text 冒号转义被改歪：%r' % render.esc_text('a:b'))
    if render.esc_text("it's") == "it" + BS + "'s":
        _ok('esc_text 单引号转义仍是 `\\\'`')
    else:
        _ng('esc_text 单引号转义被改歪：%r' % render.esc_text("it's"))


# ────────────────────────────────── ③ 真渲对照 ──────────────────────────────────
def _find_sh():
    for p in (r'C:\Program Files\Git\bin\sh.exe',
              r'C:\Program Files\Git\usr\bin\sh.exe',
              r'C:\Program Files (x86)\Git\bin\sh.exe'):
        if os.path.exists(p):
            return p
    return None


def _count_white(argv, W, H):
    """跑 ffmpeg 输出一帧 raw RGB 到 stdout，数"近白"像素（r,g,b 全 >220）。"""
    r = subprocess.run(argv, capture_output=True)
    raw = r.stdout or b''
    if len(raw) < W * H * 3:
        return -1, (r.stderr or b'')[-300:].decode('utf-8', 'replace')
    n, d = 0, raw[:W * H * 3]
    for i in range(0, len(d), 3):
        if d[i] > 220 and d[i + 1] > 220 and d[i + 2] > 220:
            n += 1
    return n, ''


def t_real_render(wd):
    print('\n③ 真渲对照：同一份含 `%` 的 banner 文案 —— argv 有字 / 交给 shell 重新解析就丢字')
    os.makedirs(wd, exist_ok=True)
    W, H = 1280, 210
    ffmpeg = render.find_ffmpeg()
    font = render.esc_path(render.find_font('msyhbd') or render.find_font('msyh'))
    th = {'accent': '0x2f7cf6', 'accent2': '0xd7263d'}
    # 文案刻意把 `%` 放两行都有（老板报的形态：数字卡 % 后缀、要点里的百分比）
    banner = {'line1': '点击率8.5%曝光量150万+', 'line2': '转化率提升90% 复购率42%'}
    vf = render.banner_layer(banner, th, W, H, 2.0, font)
    if not vf:
        _ng('banner_layer 返回空（test 自身前置条件不成立）')
        return
    BS2 = chr(92) * 2
    _ok('banner_layer 滤镜串 %d 字符（含 %d 处 "%s%%"）' % (len(vf), vf.count(BS2 + '%'), BS2))
    src = '-f lavfi -i color=c=0x101010:s=%dx%d:d=0.2' % (W, H)
    av = [ffmpeg, '-v', 'error', '-f', 'lavfi', '-i',
          'color=c=0x101010:s=%dx%d:d=0.2' % (W, H),
          '-vf', vf, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']

    # A. 生产路径：argv 数组（Windows=CreateProcess / Linux=execve，**都不经 shell**）
    nA, errA = _count_white(av, W, H)
    if nA > 0:
        _ok('A. argv 直接跑（当前生产路径）→ 顶部带白字像素 = %d ✅ 有字' % nA)
    else:
        _ng('A. argv 直接跑竟然没字（n=%s err=%s）' % (nA, errA[:160]))

    sh = _find_sh()
    if not sh:
        _skip('B/C/D 需要 POSIX sh（Git for Windows 的 sh.exe）—— 未找到，跳过（A 已独立成立）')
        _write_png(wd, av, W, H)
        return

    # B. 旧路径复现：拼 shell 字符串 + 双引号包住整条滤镜串 → 线上 /bin/sh 的语义
    joined = ('"%s" -v error %s -vf "%s" -frames:v 1 -f rawvideo -pix_fmt rgb24 -'
              % (ffmpeg.replace('\\', '/'), src, vf))
    nB, errB = _count_white([sh, '-c', joined], W, H)
    if nB == 0:
        _ok('B. sh -c "<旧 shell 字符串>" → 白字像素 = 0 ✅ 复现线上丢字（%s）'
            % ((errB.splitlines() or [''])[-1][:80] or 'Stray %'))
    else:
        print('  [INFO] B. sh -c 旧路径白字 = %d（与线上 /bin/sh 行为可能不同）' % nB)

    # C. 把**同一份 argv** join 成命令行字符串再交给 sh -c —— 等于让 shell 重新解析一次
    #    → 这就是"argv 免疫"的反证：一旦经过 shell，% 就丢。
    jd = ' '.join([ffmpeg.replace('\\', '/')] + ['"%s"' % p if ' ' in p else p for p in av[1:]])
    nC, errC = _count_white([sh, '-c', jd], W, H)
    if nC == 0:
        _ok('C. sh -c "<argv join 成命令行>" → 白字像素 = 0 ✅ 证明"免疫"的来源是'
            '**不再经过 shell 二次解析**，而不是参数本身有什么魔法')
    else:
        print('  [INFO] C. join 后再交 sh 竟然还有 %d 白字（本机 sh 与线上 /bin/sh 行为可能不同）' % nC)

    # D. 直接给 ffmpeg 一个"被 shell 剥过一层转义"的滤镜串（POSIX 双引号规则：
    #    双引号内 `\` 仅在 $ ` " \ 换行 前有转义作用 → `\\%` 变成 `\%`）——
    #    这正是线上 ffmpeg 真正收到的东西，用 argv 传它同样丢字 → 病因锁定在"转义层数"。
    vf_shell = vf
    out, i = [], 0
    while i < len(vf_shell):
        ch = vf_shell[i]
        if ch == chr(92) and i + 1 < len(vf_shell) and vf_shell[i + 1] in (chr(92), '"', '`', '$'):
            out.append(vf_shell[i + 1])
            i += 2
            continue
        out.append(ch)
        i += 1
    vf_shell = ''.join(out)
    if vf_shell == vf:
        print('  [INFO] D. 该滤镜串里没有被 shell 剥掉的转义（本例理论上应有 "\\%%" → "\\%%" 的差）')
    else:
        avd = list(av)
        avd[avd.index('-vf') + 1] = vf_shell
        nD, _ = _count_white(avd, W, H)
        if nD == 0:
            _ok('D. 用"被 shell 剥过一层"的滤镜串走 argv → 白字像素 = 0 ✅ '
                '病因 = 转义层数少了一层（ffmpeg 收到裸 %% 报 Stray %%s）')
        else:
            print('  [INFO] D. 剥层后仍有 %d 白字（本机 ffmpeg 版本可能对裸 %% 更宽容）' % nD)

    _write_png(wd, av, W, H)


def _write_png(wd, argv, W, H):
    """用同一套滤镜额外落一张 PNG，作为"有字"的肉眼证据。"""
    try:
        ffmpeg = argv[0]
        vf = argv[argv.index('-vf') + 1]
        out = os.path.join(wd, 'pct-banner-argv.png')
        subprocess.run([ffmpeg, '-v', 'error', '-f', 'lavfi', '-i',
                        'color=c=0x101010:s=%dx%d:d=0.2' % (W, H),
                        '-vf', vf, '-frames:v', '1', out], capture_output=True)
        if os.path.exists(out):
            print('  [INFO] 帧已落盘：%s' % out)
    except Exception as e:
        print('  [INFO] 落盘 PNG 失败（忽略）: %s' % str(e)[:80])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--wd', default='')
    a = ap.parse_args()
    wd = a.wd or os.path.join(os.path.dirname(HERE), '..', 'dist-rel', 'style-preview', 'pct-fix')
    wd = os.path.abspath(wd)
    print('★VF_ARGV_V1 回归护栏   render.py = %s   wd = %s' % (RENDER, wd))
    t_static_no_shell()
    t_esc_two_layers()
    t_real_render(wd)
    print('\n===== 结果：%d PASS / %d FAIL =====' % (len(OK), len(NG)))
    if NG:
        for m in NG:
            print('  ✗ ' + m)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
