#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""★VF_THEMES_V1（2026-09-29 用户定案「挑一些模版给 AI 套」）主题 token —— **唯一真相源**

用户实测原话：「字体很干，也没什么动效色彩啊渐变 什么都没 就几个白字……
             单独文字设计能不能挑一些模版去给 AI 去套动效文字排版这些」

原来主题只有 3 套（dark/light/tech）且**写死在 make.py 里**：每张卡都靠默认值 → 观感"像 PPT 第一版"。
本文件把主题升级成【一套设计变量】，make.py 与 render.py 都从这里取（避免两处漂移）。

token 说明（都在 render.py 里被读取，缺省有兜底 → 老分镜不受影响）：
  bg       卡片底板色（无素材时的底色 / 渐变起色）
  bg2      渐变第二色（不给则按 bg 自动提亮 1.55 倍）——有渐变才有"设计感"
  text     主文字色（画面大字、标题）
  sub      次级文字色（说明小字；不给则用 text 的 75%）
  accent   强调色（装饰条、对比卡右列、CTA）
  accent2  次强调色（数字/图表条的第二色；不给则用 accent）
  font     字体 key（msyh = 微软雅黑；服务器上还有 Noto CJK 兜底）
  box      压在【素材】上的大字底衬（黑底透明度的写法，如 'black@0.30'）
  band     底部字幕区压暗（保字幕可读）
"""

THEMES = {
    # ── 原有的 3 套（保持向后兼容：老分镜/老草稿里写的就是这几个名字）──
    'dark': {
        'bg': '0x0a1620', 'bg2': '0x123043', 'text': 'white', 'sub': 'white@0.72',
        'accent': '0xff6b35', 'accent2': '0xffa06b', 'font': 'msyh',
        'box': 'black@0.30', 'band': 'black@0.30',
        'desc': '深蓝墨（默认）',
    },
    'light': {
        'bg': '0xf5f2ea', 'bg2': '0xe4ded0', 'text': '0x1a1a1a', 'sub': '0x1a1a1a@0.68',
        'accent': '0xc0392b', 'accent2': '0xe08a3c', 'font': 'msyh',
        'box': 'white@0.55', 'band': 'black@0.18',
        'desc': '浅色纸感',
    },
    'tech': {
        'bg': '0x0b1c2c', 'bg2': '0x123a45', 'text': '0xe8f1f8', 'sub': '0xe8f1f8@0.70',
        'accent': '0x2ec4b6', 'accent2': '0x6ee7d8', 'font': 'msyh',
        'box': 'black@0.32', 'band': 'black@0.28',
        'desc': '深青科技',
    },
    # ── 新增 5 套 ──
    'blue': {
        'bg': '0x0a1a3a', 'bg2': '0x14306b', 'text': 'white', 'sub': 'white@0.74',
        'accent': '0x3b82f6', 'accent2': '0x93c5fd', 'font': 'msyh',
        'box': 'black@0.30', 'band': 'black@0.30',
        'desc': '深蓝科技',
    },
    'vivid': {
        'bg': '0xfff4e6', 'bg2': '0xffd9a8', 'text': '0x1f1408', 'sub': '0x1f1408@0.70',
        'accent': '0xe8453c', 'accent2': '0xffb020', 'font': 'msyh',
        'box': 'white@0.60', 'band': 'black@0.16',
        'desc': '高饱和电商（红黄）',
    },
    'journal': {
        'bg': '0xf7efe0', 'bg2': '0xe9d8bd', 'text': '0x3a2a1a', 'sub': '0x3a2a1a@0.68',
        'accent': '0xd97706', 'accent2': '0x0f766e', 'font': 'msyh',
        'box': 'white@0.55', 'band': 'black@0.16',
        'desc': '手账暖色',
    },
    'mono': {
        'bg': '0x101010', 'bg2': '0x242424', 'text': 'white', 'sub': 'white@0.70',
        'accent': '0xe11d48', 'accent2': 'white', 'font': 'msyh',
        'box': 'black@0.45', 'band': 'black@0.35',
        'desc': '杂志黑白（红点缀）',
    },
    'mint': {
        'bg': '0x0e2a26', 'bg2': '0x15443c', 'text': '0xeafff8', 'sub': '0xeafff8@0.70',
        'accent': '0x34d399', 'accent2': '0xa7f3d0', 'font': 'msyh',
        'box': 'black@0.32', 'band': 'black@0.28',
        'desc': '清新薄荷',
    },
}

DEFAULT_THEME = 'dark'


def theme_of(name_or_dict, default=DEFAULT_THEME):
    """把「主题名 / 主题字典 / 空」统一成主题字典。

    为什么要有这个函数：历史上 make.py 传的是【字典】、而草稿里 `theme` 存的是【字符串】
    （如 'dark'）——2026-09-29 本机诊断时就踩了：字符串进了 render.py，`th.get()` 直接 AttributeError。
    现在两边都走这里：字符串→查表；字典→补默认 token；不认识→回默认主题（绝不抛异常）。"""
    if isinstance(name_or_dict, dict):
        base = dict(THEMES.get(str(name_or_dict.get('theme') or ''), THEMES[default]))
        base.update({k: v for k, v in name_or_dict.items() if v not in (None, '')})
        return base
    key = str(name_or_dict or '').strip()
    return dict(THEMES.get(key, THEMES[default]))


def theme_names():
    return list(THEMES.keys())
