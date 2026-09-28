# -*- coding: utf-8 -*-
"""bu_check.py —— 平台登录态检测（CLI 薄壳）

★★ LOGIN_UNIFY_V1（2026-09-28，用户定案「不要再东一块西一块」）：
   判定逻辑、平台表、关键 cookie 名、路径规则【全部搬到 login_state.py】（唯一读取器）。
   本文件从此只做一件事：按命令行协议输出，供 electron/main.js 与其它脚本调用。

   为什么要把"判断"搬走：原来同一份登录态被 6 个地方各自判断（bu_check 的 cookie 名、
   bu_hot 只看 SUB/SESSDATA、agent-publish 看 URL、指纹模板另一套、服务端内存 Map、
   前端自己一份）→ 口径不一致，用户看到的结论互相打架。现在只准 import login_state。

   用法（与旧版完全相同，路径不变）：
       python bu_check.py <账号profile目录>

   输出行（前三行与旧版兼容，后三行是新加的"说得清为什么"）：
       PLATS:douyin:1,xiaohongshu:0,...      是否登录
       REASON:douyin:ok,xiaohongshu:expired  原因 ok / expired（过期了）/ missing（从没登过）
       EXP:douyin:1793...,xiaohongshu:0      最近到期时间（毫秒，0=会话型/未知）
       FROM:cdp|file|copy|cache              结果来自哪条通路
       CACHED:1                              本次结果来自缓存（读不到库时的兜底）
       NO_COOKIES_FILE:<路径>                该账号目录还没登录过
       CHECK_ERR:<原因>                      读不到库
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from login_state import main as _login_state_main, read_state, profile_paths  # noqa: E402

__all__ = ['read_state', 'profile_paths']


if __name__ == '__main__':
    _login_state_main()
