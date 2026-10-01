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

★VF_STYLE_V1（2026-09-30 用户定案「先固定新闻资讯和科技数据」）——新增 9 个【卡面 token】：
  id         主题 id（render.py 用它判断"这套是不是编辑风"，如 'news' / 'data'）
  cardBg     信息卡卡面底色（参考图里的"白色信息卡 / 深色数据卡"）
  cardText   信息卡里的主文字色
  cardSub    信息卡里的次级说明色
  barBg      "黑色半透明横条"的条底（里面放白字标题）
  barText    横条里的字色
  kickerBg   小标签条（kicker）的底色，如蓝底白字「BBC News·前线专栏」
  kickerText 小标签条里的字色
  line       细分割线颜色
  enFont     英文副标用的字体 key（★用户明确：英文小字要用无衬线，别拿中文字体去排英文）
  这 9 个 token **老主题不写也有**（见 _with_tokens 的动态兜底）→ 老分镜/老草稿绝不会坏。

★VF_TPL_B1_V1（2026-09-30 用户定案「动效 PPT 做主·B 组图片处理」）——新增 1 个 token：
  frameBg    图片相框的底色（frame='polaroid' 那条"白边"用；默认近白，浅色主题可覆盖）
  说明：圆角/相框/阴影/浮动/擦入/背景虚化这些是【分镜级字段】（frame/shadow/float/wipe/bgblur），
  不是主题 token —— 主题只决定"这一套风格看起来是什么颜色"。这里的 frameBg 只负责"拍立得白边"的颜色。
  同样有 _with_tokens 兜底 → 老主题不写也不会坏。

★VF_DECK_V1（2026-10-01 用户定案「PPT 页内容编排丰富一点」）——新增 1 个 token：
  dot       「富编排 PPT 页」（variant='deck'）里**小色块/圆点/装饰方块**的颜色
            （要点条目前的方点、分割线尾端的小方块）。默认 = accent2（没写 accent2 就是 accent）。
            同样有 _with_tokens 兜底 → 老主题不写也不会坏（渲染层 `th.get('dot') or accent2 or accent`）。
"""

THEMES = {
    # ── 原有的 3 套（保持向后兼容：老分镜/老草稿里写的就是这几个名字）──
    'dark': {
        'id': 'dark',
        'bg': '0x0a1620', 'bg2': '0x123043', 'text': 'white', 'sub': 'white@0.72',
        'accent': '0xff6b35', 'accent2': '0xffa06b', 'font': 'msyh',
        'box': 'black@0.30', 'band': 'black@0.30',
        'desc': '深蓝墨（默认）',
    },
    'light': {
        'id': 'light',
        'bg': '0xf5f2ea', 'bg2': '0xe4ded0', 'text': '0x1a1a1a', 'sub': '0x1a1a1a@0.68',
        'accent': '0xc0392b', 'accent2': '0xe08a3c', 'font': 'msyh',
        'box': 'white@0.55', 'band': 'black@0.18',
        'desc': '浅色纸感',
    },
    'tech': {
        'id': 'tech',
        'bg': '0x0b1c2c', 'bg2': '0x123a45', 'text': '0xe8f1f8', 'sub': '0xe8f1f8@0.70',
        'accent': '0x2ec4b6', 'accent2': '0x6ee7d8', 'font': 'msyh',
        'box': 'black@0.32', 'band': 'black@0.28',
        'desc': '深青科技',
    },
    # ── 新增 5 套 ──
    'blue': {
        'id': 'blue',
        'bg': '0x0a1a3a', 'bg2': '0x14306b', 'text': 'white', 'sub': 'white@0.74',
        'accent': '0x3b82f6', 'accent2': '0x93c5fd', 'font': 'msyh',
        'box': 'black@0.30', 'band': 'black@0.30',
        'desc': '深蓝科技',
    },
    'vivid': {
        'id': 'vivid',
        'bg': '0xfff4e6', 'bg2': '0xffd9a8', 'text': '0x1f1408', 'sub': '0x1f1408@0.70',
        'accent': '0xe8453c', 'accent2': '0xffb020', 'font': 'msyh',
        'box': 'white@0.60', 'band': 'black@0.16',
        'desc': '高饱和电商（红黄）',
    },
    'journal': {
        'id': 'journal',
        'bg': '0xf7efe0', 'bg2': '0xe9d8bd', 'text': '0x3a2a1a', 'sub': '0x3a2a1a@0.68',
        'accent': '0xd97706', 'accent2': '0x0f766e', 'font': 'msyh',
        'box': 'white@0.55', 'band': 'black@0.16',
        'desc': '手账暖色',
    },
    'mono': {
        'id': 'mono',
        'bg': '0x101010', 'bg2': '0x242424', 'text': 'white', 'sub': 'white@0.70',
        'accent': '0xe11d48', 'accent2': 'white', 'font': 'msyh',
        'box': 'black@0.45', 'band': 'black@0.35',
        'desc': '杂志黑白（红点缀）',
    },
    'mint': {
        'id': 'mint',
        'bg': '0x0e2a26', 'bg2': '0x15443c', 'text': '0xeafff8', 'sub': '0xeafff8@0.70',
        'accent': '0x34d399', 'accent2': '0xa7f3d0', 'font': 'msyh',
        'box': 'black@0.32', 'band': 'black@0.28',
        'desc': '清新薄荷',
    },
    # ── ★VF_STYLE_V1（2026-09-30）新增 2 套【编辑风】──
    #    用户原话：「我就是单独做的文字页都很空洞配色单一 不灵活」
    #             「我发了几个博主的视频截图你可以看下，它这里的文字配色和还有
    #               每个都有渐进效果 分段插入」「先固定新闻资讯和科技数据」
    #    news = 参考图那种【新闻资讯】观感：深蓝底 + 蓝色小标签条 + 白色信息卡 + 黑色半透明横条
    #    data = 【科技数据】观感：近黑青底 + 青色强调 + 深色数据卡 + 超大数字/细线
    #    注：这两套的卡面 token 是【显式写死】的（不靠兜底），因为"一屏多色层级"就是它们的卖点。
    'news': {
        'id': 'news',
        'bg': '0x0b1622', 'bg2': '0x13293d', 'text': '0xffffff', 'sub': '0xffffff@0.72',
        'accent': '0x2f7cf6', 'accent2': '0xd7263d', 'font': 'msyh',
        'box': 'black@0.34', 'band': 'black@0.30',
        'cardBg': 'white@0.93', 'cardText': '0x101418', 'cardSub': '0x4a5159',
        'barBg': 'black@0.74', 'barText': '0xffffff',
        'kickerBg': '0x2f7cf6', 'kickerText': '0xffffff',
        'line': '0x2f7cf6@0.55', 'enFont': 'arial',
        'frameBg': 'white',
        'dot': '0xd7263d',            # ★VF_DECK_V1：deck 页要点小方点（用次强调红，与蓝底形成层级）
        'desc': '新闻资讯（编辑风）',
    },
    'data': {
        'id': 'data',
        'bg': '0x071018', 'bg2': '0x0f2630', 'text': '0xeaf6ff', 'sub': '0xeaf6ff@0.70',
        'accent': '0x22d3ee', 'accent2': '0x34d399', 'font': 'msyh',
        'box': 'black@0.36', 'band': 'black@0.30',
        'cardBg': '0x0d1f28@0.92', 'cardText': '0xeaf6ff', 'cardSub': '0x9fc4d4',
        'barBg': 'black@0.66', 'barText': '0xeaf6ff',
        'kickerBg': '0x22d3ee', 'kickerText': '0x04222b',
        'line': '0x22d3ee@0.50', 'enFont': 'arial',
        'dot': '0x34d399',            # ★VF_DECK_V1：deck 页要点小方点（青底 + 薄荷绿点）
        'desc': '科技数据（编辑风）',
    },
}

DEFAULT_THEME = 'dark'


def _with_tokens(d):
    """★VF_STYLE_V1（2026-09-30）：给【任何】主题补齐新卡面 token 的兜底值。

    为什么不把 9 个 token 抄进每个老主题：抄 8 遍最容易被漏/被改歪；这里一次兜底，老主题
    （dark/light/tech/blue/vivid/journal/mono/mint）自动拿到一套"不难看"的默认卡面，
    老分镜、老草稿、老接口传进来的主题字典全都不会因为缺 key 而画不出来（render.py 里
    `th.get('cardBg')` 永远有值）。news / data 在 THEMES 里显式写了这些 key → 走它们自己的值。"""
    d = dict(d or {})
    d.setdefault('id', '')
    d.setdefault('cardBg', 'black@0.46')
    d.setdefault('cardText', d.get('text') or 'white')
    d.setdefault('cardSub', d.get('sub') or 'white@0.72')
    d.setdefault('barBg', 'black@0.70')
    d.setdefault('barText', 'white')
    d.setdefault('kickerBg', d.get('accent') or '0xff6b35')
    d.setdefault('kickerText', 'white')
    d.setdefault('line', 'white@0.30')
    d.setdefault('enFont', 'arial')      # 英文副标：无衬线（用户明确「不要用中文字体去排英文」）
    # ★VF_DECK_V1（2026-10-01）：deck 页的小色块/圆点/装饰方块色（没写就用次强调色）。
    d.setdefault('dot', d.get('accent2') or d.get('accent') or '0xff6b35')
    # ★VF_TPL_B1_V1（2026-09-30）：拍立得相框的"白边"底色。
    #   必须是**不带 alpha 的纯色**：ffmpeg `pad` 滤镜的 color 不给 rgb 之外的东西，
    #   写成 'white@0.96' 会被 pad 拒掉（这里刻意保守，保证任何本机/服务器版本都能跑）。
    d.setdefault('frameBg', 'white')
    return d


def theme_of(name_or_dict, default=DEFAULT_THEME):
    """把「主题名 / 主题字典 / 空」统一成主题字典。

    为什么要有这个函数：历史上 make.py 传的是【字典】、而草稿里 `theme` 存的是【字符串】
    （如 'dark'）——2026-09-29 本机诊断时就踩了：字符串进了 render.py，`th.get()` 直接 AttributeError。
    现在两边都走这里：字符串→查表；字典→补默认 token；不认识→回默认主题（绝不抛异常）。

    ★VF_STYLE_V1：出口统一过 _with_tokens() 补卡面 token；`id` 用来标识"是哪套主题"
    （make.py 传的是【字典】时，字典里没有主题名，只能靠 theme 里带的 id）。"""
    if isinstance(name_or_dict, dict):
        _src = name_or_dict
        base = dict(THEMES.get(str(_src.get('theme') or ''), THEMES[default]))
        base.update({k: v for k, v in _src.items() if v not in (None, '')})
        base = _with_tokens(base)
        if not base.get('id'):
            base['id'] = str(_src.get('theme') or '')
        return base
    key = str(name_or_dict or '').strip()
    base = _with_tokens(THEMES.get(key, THEMES[default]))
    if not base.get('id'):
        base['id'] = key if key in THEMES else default
    return base


def theme_names():
    return list(THEMES.keys())
