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

★VF_DECK_STYLES_V1（2026-10-01 用户定案「最好有渐变色」「配色不能太 AI 味」「多弄几个模版」）
  ——新增 2 个 token（4 套富编排风格：deck / deck-grad / deck-mono / deck-mag 共用）：
  gradA     渐变风（variant='deck-grad'）的**渐变亮端**（页面底板 + 卡片色带的起点）
  gradB     渐变风的**渐变暗端**（终点）
            兜底刻意取**主题自己那对底色**（bg2→bg）——不新造高饱和色，配色永远与主题同源，
            这就是"去 AI 味"的做法：只用低饱和的一档做层次，其余走中性。
            同样有 _with_tokens 兜底 → 老主题不写也不会坏。

★VF_DECK_STYLES2_V1（2026-10-01 用户定案「配色真的不能太 AI 味」「最好有渐变色」「还有就是透明度」）
  ——新增 3 个 token（6 套富编排风格共用；deck-glass / deck-soft 依赖最重）：
  cardBg2   玻璃拟态 / 柔和拟物**两张新卡面的底色**（→ glass 卡"染色玻璃"的 tint、soft 卡"凸起面"的亮面）
            注意与已有的 cardBg 区分：cardBg 是【编辑风的不透明信息卡】，cardBg2 是【半透明/同色系新卡面】。
  shadowC   投影色（→ soft 的"右下暗面"、glass 的边缘暗侧；一律在 render.py 里强制低 alpha）
  lineC     hairline 色（发丝线 / 玻璃细白边 / 柔和亮边；比 line 更细更淡，只做"边界暗示"）
            兜底策略：cardBg2 = 主题自己的 bg2（同源）；shadowC = 近黑；
            lineC = 按 text 亮度自动取"白"或"黑"（浅字配白发丝、深字配黑发丝）——
            依旧是"只用主题自己的色阶"，绝不新造高饱和色（这就是"去 AI 味"的硬规矩）。
            同样有 _with_tokens 兜底 → 老主题不写也不会坏。
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
        # ★VF_DECK_STYLES_V1：渐变风的两端色（比 bg/bg2 略提亮一档，让"真渐变"看得出来但不刺眼）
        'gradA': '0x1b3a5e', 'gradB': '0x0a1420',
        # ★VF_DECK_STYLES2_V1（2026-10-01）：玻璃/柔和两张新卡面 —— 全部**与主题同源**，不引入新色相
        'cardBg2': '0x1b3a5e',        # = gradA（比 bg2 亮一档的蓝灰）→ glass 染色玻璃 / soft 凸起面
        'shadowC': '0x04090f',        # 近黑偏蓝（右下暗面 / 玻璃边缘暗侧）
        'lineC': '0xffffff',          # 玻璃细白边 / 柔和亮边（render 里只给 0.14~0.24 的 alpha）
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
        # ★VF_DECK_STYLES_V1：渐变风的两端色（近黑青 → 深青，低饱和、不"科技蓝"）
        'gradA': '0x123540', 'gradB': '0x06121a',
        # ★VF_DECK_STYLES2_V1：同 news —— 同源色阶，低饱和，绝不"科技蓝发光"
        'cardBg2': '0x123540',        # = gradA
        'shadowC': '0x030a0d',
        'lineC': '0xeaf6ff',          # 近白的青灰（与 data 的 text 同族）
        'desc': '科技数据（编辑风）',
    },
}

DEFAULT_THEME = 'dark'


# ══════════════ ★VF_STYLES_V1（2026-10-01）「成品风格」= theme + deck 版式 + 动效节奏 ══════════════
# 老板原话：「目前模版有2套我是不是有点乱。能统一一下吗？或者删减不成熟的」
#          「你写的那个什么玻璃什么分类有点抽象」
#          「我做的几个目前配色都是蓝色，和你直接给我做的几个视频效果配色不太一样」
#
# 病根：老板要选的是【2 个下拉 × 10 主题 × 6 版式 = 60 种组合】——"玻璃/柔和/渐变"这种**实现词**
#   被当成产品名摆在他面前，他当然觉得抽象；而且他的观感基准（news 蓝）藏在一堆主题里。
# 治法（本表就是这个唯一真相源）：把「10 主题 × 6 版式」在**渲染侧**收敛成 **5 套成品风格**，
#   每套 = 一个 theme + 一个 deck 版式 + 一套动效节奏（enter + 浮动周期）。老板只需要从 5 个
#   人话名字里挑一个。`deck-glass` / `deck-soft` 不再单独摆出来（收进 ⑤ / ③ 内部）。
#
# ⚠️ 硬约束：`deck` 一律取自 render.py 的 TITLE_VARIANTS / DECK_VARIANTS（与 src/lib/agent/vf/anti-ai.ts
#   逐字一致）。本表**不新增任何 variant 名**，只做"挑一个已有的"。
#
# 配色口径（老板：「更讲究」= 低饱和 / 色块面积小 / 有中性灰阶 / 不要实心黑框）：
#   · 默认必须 = 他现在看到的蓝（news）→ ① 蓝白科技 = news + deck（经典），**零视觉变化**。
#   · 深色渐变 = data（近黑青，低饱和）——不是"科技蓝发光"，渐变端色同源（gradA/gradB）。
#   · 清爽浅色 = light（米白纸感）+ deck-soft（拟物靠留白与极淡阴影分层，没有实心黑框）。
#   · 杂志编辑 = journal（暖米）+ deck-mag（大留白 + 编号 + 细线）。
#   · 柔和高级 = mono（**纯中性灰阶**，只有极小面积的玫瑰点缀）+ deck-glass（深灰玻璃 + 白细边）。
STYLES = {
    # ① 默认：与老板现有观感**逐像素一致**（news + 经典 deck 编排）
    'bluewhite': {
        'id': 'bluewhite', 'name': '蓝白科技', 'theme': 'news', 'deck': 'deck',
        'period': 4.0, 'enter': 'up', 'default': True,
        'desc': '深蓝底 + 蓝标签条 + 极淡信息行（1px 细边分层）—— 老板在用/基准，低饱和、色块小而克制',
    },
    # ② 深色渐变：近黑青底 + 真·逐像素渐变带（不用"高饱和紫蓝"那套 AI 味）
    'darkgrad': {
        'id': 'darkgrad', 'name': '深色渐变', 'theme': 'data', 'deck': 'deck-grad',
        'period': 4.4, 'enter': 'up',
        'desc': '近黑青 + 同源渐变带（低饱和），适合科技/数据内容，光感强但不刺眼',
    },
    # ③ 清爽浅色：米白纸感 + 柔和拟物（deck-soft 收进这里，不再单列）
    'cleanlight': {
        'id': 'cleanlight', 'name': '清爽浅色', 'theme': 'light', 'deck': 'deck-soft',
        'period': 3.6, 'enter': 'up',
        'desc': '米白纸感 + 柔和拟物卡（靠留白与极淡阴影分层，无实心黑框），适合干货/教程',
    },
    # ④ 杂志编辑：暖米底 + 大留白 + 编辑编号/细线
    'magazine': {
        'id': 'magazine', 'name': '杂志编辑', 'theme': 'journal', 'deck': 'deck-mag',
        'period': 4.0, 'enter': 'left',
        # ★VF_FONTHIER_V1（2026-10-02 老板「字体太单调了」）：杂志风的主标题走**衬线**族
        #   （Windows simsun/STSONG；Linux NotoSerifCJK）。找不到 → 静默回落粗体 CJK（见 font_title）。
        'tokens': {'fontTitle': 'serif'},
        'desc': '暖米 + 大留白 + 编号/发丝线 + 衬线大标题，像杂志跨页；文字层级最清楚',
    },
    # ⑤ 柔和高级：纯中性灰阶 + 深灰玻璃（deck-glass 收进这里，不再单列）
    #   tokens 覆盖的理由（team-lead 2026-10-01）：「别再是黑底 + **亮红字** + 白杠」——
    #   mono 主题自带的 accent 是 0xe11d48（高饱和玫红），在"柔和高级"这套里显得扎眼 →
    #   换成**低饱和灰玫瑰 0xb0808a**（饱和度 27%，亮度 143，压在中性灰阶上是一点点暖调）。
    #   只覆盖这一套风格（不动 themes.py 的 mono 本体 → 其它用到 mono 的片子零变化）。
    'softlux': {
        'id': 'softlux', 'name': '柔和高级', 'theme': 'mono', 'deck': 'deck-glass',
        'period': 4.4, 'enter': 'up',
        # ★VF_FONTHIER_V1：高级感同样靠**衬线主标题**（与无衬线的数字/要点拉开层级）
        'tokens': {'accent': '0xb0808a', 'fontTitle': 'serif'},
        'desc': '中性灰阶 + 深灰玻璃卡 + 白细边 + 衬线大标题，低饱和灰玫瑰点缀；最"高级"的一套',
    },
}

DEFAULT_STYLE = 'bluewhite'


def style_of(name):
    """★VF_STYLES_V1 / ★VF_STYLES_STRICT_V1：成品风格名 → 风格字典；**未命中就返回 None**。

    ⚠️ 为什么必须是"严格匹配 + None"而不是"回落默认"（style-wire 2026-10-01 抓到的事故）：
      `src/lib/agent/vf/vf-aivideo.ts` 早就把 **AI 制片线的风格标签**（`AI_STYLES`：
      `cinematic / commercial / vlog / …`）写进 plan 根级 `style`。如果这里对不认识的字符串
      "回落默认风格"，那条线一出片就会被**静默改成 news 蓝 + deck 版式**（老板会看到"我选的风格被换了"）。
      所以口径是：**认不出 = 不干预**（`apply_style` 直接 return ''，theme/deck_style 一个字段都不碰）。
    接受：英文 id（'bluewhite'）/ 中文名（'蓝白科技'）/ 带空格或大小写差异的写法。
    """
    key = str(name or '').strip()
    if not key:
        return None
    k = key.lower().replace(' ', '').replace('-', '').replace('_', '')
    for sid, st in STYLES.items():
        if k in (sid.lower(), str(st.get('name') or '').strip().lower().replace(' ', '')):
            return dict(st)
    return None


def style_default():
    """★VF_STYLES_STRICT_V1：默认成品风格（= 老板现在看到的 news 蓝）。
    只在"我们**主动**要一个默认值"时用（例如 UI 下拉框预选），**不要**拿它兜"认不出的输入"。"""
    return dict(STYLES[DEFAULT_STYLE])


def style_names():
    return [(sid, STYLES[sid].get('name'), STYLES[sid].get('desc')) for sid in STYLES]


def _lum_hex(c, default=255):
    """颜色串（'white' / '0xRRGGBB' / '0xRRGGBB@0.5'）的感知亮度；解析失败回 default。

    ★VF_DECK_STYLES2_V1 用它决定 hairline（lineC）兜底取白还是取黑 ——
    浅色字主题配白发丝、深色字主题配黑发丝，**只取黑白两端**，不新造色相。"""
    s = str(c or '').strip().split('@')[0].lower()
    s = {'white': '0xffffff', 'black': '0x000000'}.get(s, s)
    try:
        h = s.replace('0x', '').replace('#', '')
        if len(h) == 3:
            h = ''.join(ch * 2 for ch in h)
        return int(0.299 * int(h[0:2], 16) + 0.587 * int(h[2:4], 16) + 0.114 * int(h[4:6], 16))
    except Exception:
        return default


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
    # ★VF_DECK_STYLES_V1（2026-10-01）：「渐变风」（deck-grad）的渐变两端色。
    #   兜底 = 主题自己的 bg2（亮端）→ bg（暗端）：同源、低饱和，绝不引入"高饱和紫蓝"那套 AI 味。
    d.setdefault('gradA', d.get('bg2') or d.get('bg') or '0x123043')
    d.setdefault('gradB', d.get('bg') or '0x0a1620')
    # ★VF_DECK_STYLES2_V1（2026-10-01）：玻璃拟态 / 柔和拟物 的两张新卡面 token（老主题走这套兜底）。
    #   cardBg2 = 主题自己的 bg2（同源、低饱和；没 bg2 就退 bg）—— 与 gradA 同族，绝不新造色。
    d.setdefault('cardBg2', d.get('bg2') or d.get('bg') or '0x123043')
    d.setdefault('shadowC', '0x000000')
    #   hairline：浅色字 → 白发丝；深色字 → 黑发丝（只取黑白两端，不引入色相）
    d.setdefault('lineC', 'white' if _lum_hex(d.get('text')) >= 128 else 'black')
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
