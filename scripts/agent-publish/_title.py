# -*- coding: utf-8 -*-
# ═══ ★TITLE_LIMIT_V1（2026-09-23 用户定稿）═══════════════════════════════
#   用户原话：「所有标题固定 15 个字不超过 16 个字。视频号标题不让超过 16 个字」
#   ⇒ 规则（唯一真源，别再各自写死数字）：
#        · 其它平台：标题 ≤ 15 个字
#        · 视频号  ：标题 ≤ 16 个字（短标题字段平台硬限 16）
#   为什么要有这个文件：以前每个脚本各写各的（16 / 20 / 30 / 有的干脆不截断），
#   结果是"同一个标题在不同平台被砍成不同长度"，改一次要改七八处、还容易漏。
#
#   计数口径：按【字】算（一个汉字 = 1，一个 emoji = 1）。
#   Python 的字符串切片本身就是按 Unicode 码点，和"字"一致，所以直接用 s[:n]。
#   ⚠️ 与 JS 侧对齐：JS 的 slice() 按 UTF-16 码元算，emoji 会被当成 2 个 →
#      JS 侧必须用 Array.from(s).slice(0, n).join('')（见 electron/main.js 的 clampTitle 与
#      electron/fp-templates/*.js 里的同款注释）。

LIMITS = {
    'douyin': 15,       # 抖音
    'xiaohongshu': 15,  # 小红书
    'weibo': 15,        # 微博
    'bilibili': 15,     # B站
    'kuaishou': 15,     # 快手
    'shipinhao': 16,    # 视频号（平台短标题硬限 16）
}


def title_limit(platform):
    """该平台的标题上限（字）。未知平台按 15 保守处理。"""
    return LIMITS.get(str(platform or '').strip().lower(), 15)


def clamp_title(title, platform):
    """把标题裁到该平台允许的字数内；顺带去掉首尾空白。返回 str（永不返回 None）。"""
    s = '' if title is None else str(title)
    s = s.strip()
    n = title_limit(platform)
    if len(s) <= n:
        return s
    return s[:n]


def clamp_title_log(title, platform, log=None, what='标题'):
    """裁标题并（可选）打日志说明被裁了 —— 便于用户/开发从日志一眼看出。"""
    s = '' if title is None else str(title).strip()
    out = clamp_title(s, platform)
    if log and len(s) > len(out):
        try:
            log('⚠️ %s超 %d 字已截断（%d→%d）：%s' % (what, title_limit(platform), len(s), len(out), out))
        except Exception:
            pass
    return out
