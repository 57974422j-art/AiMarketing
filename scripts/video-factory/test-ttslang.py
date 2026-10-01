#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""★VF_TTSLANG_V1 自测（**纯函数 / 不联网 / 不花钱**）

背景：成片 `20261001_001` 最后一句配音"像日语"（用户实测·偶发）。根因 = qwen3-tts 是多语言模型，
裸调用走默认 language_type=Auto 时由模型"按文本自己猜语种"，中英夹混句（如「AI」）偶发读成别的语言。
本测试验证修复：含中文 → 显式锁 language_type=Chinese；参数被拒 → 自动去参重试；不锁时保持老行为。

跑法：
  python -m py_compile scripts/video-factory/tts.py scripts/video-factory/test-ttslang.py
  python scripts/video-factory/test-ttslang.py
"""
import importlib.util
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
TTS_PATH = os.path.join(HERE, 'tts.py')

_passed = 0
_failed = 0


def check(name, cond):
    global _passed, _failed
    if cond:
        _passed += 1
        print('  OK   %s' % name)
    else:
        _failed += 1
        print('  FAIL %s' % name)


def load_tts():
    """加载 tts.py（不执行 main；仅模块级代码：读 .env.local / 编译正则，均不联网）"""
    spec = importlib.util.spec_from_file_location('vf_tts_lang_under_test', TTS_PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def main():
    t = load_tts()

    # ── ① 含中文（含中英夹混）→ 强制锁 Chinese ──────────────────────────────
    print('\n[1] 含中文 / 中英夹混 → 锁 language_type=Chinese')
    check('事故那句「立即体验，让AI帮你写出能引爆市场的初稿！」→ Chinese',
          t.lang_type_for('立即体验，让AI帮你写出能引爆市场的初稿！') == 'Chinese')
    check('has_cjk(中英夹混) is True', t.has_cjk('让AI帮你写') is True)
    check('has_cjk(纯中文) is True', t.has_cjk('你好世界') is True)
    check('lang_label(含中文) == "zh"', t.lang_label('你好') == 'zh')

    # ── ② 不含中文 → 不锁（保持模型默认 Auto，不改变老行为）────────────────
    print('\n[2] 纯英文 / 纯数字符号 → 不强制 zh')
    check('纯英文「Hello AI world」→ 不锁', t.lang_type_for('Hello AI world') == '')
    check('has_cjk(纯英文) is False', t.has_cjk('Hello AI world') is False)
    check('纯数字符号「123 456!!」→ 不锁', t.lang_type_for('123 456!!') == '')
    check('lang_label(纯英文) == "-"', t.lang_label('Hello') == '-')

    # ── ③ 空 / None / 纯符号 → 不崩且不锁 ─────────────────────────────────
    print('\n[3] 空串 / None / 纯符号 → 不崩、不锁')
    for bad in ('', None, '   ', '\n\t', '！@#￥%……&*（）', '。。。，、；：', '……——!!??'):
        try:
            ok = (t.has_cjk(bad) is False
                  and t.lang_type_for(bad) == ''
                  and t.lang_label(bad) == '-')
        except Exception as e:                       # noqa: BLE001
            ok = False
            print('       （异常：%s）' % str(e)[:80])
        check('输入 %r 不崩且不锁' % (bad,), ok)

    # ── ④ 回退路径：language_type 被拒 → 自动去参重试 ─────────────────────
    print('\n[4] ★新增参数被拒时的回退（mock post_fn，不联网）')
    calls = []

    def fake_post_fail_then_ok(url, payload, key, async_hdr=False):
        calls.append(json.loads(json.dumps(payload)))       # 深拷贝留证据
        if 'language_type' in (payload.get('input') or {}):
            return None, 'HTTP 400 Bad Request | {"code":"InvalidParameter"}', True
        return {'output': {'task_id': 'ok-1'}}, '', False

    p1 = {'model': 'qwen3-tts-flash',
          'input': {'text': '让AI帮你', 'voice': 'Cherry', 'language_type': 'Chinese'}}
    d1, e1, k1 = t.dash_post_with_lang_fallback(fake_post_fail_then_ok, 'http://x', p1, 'k')
    check('带 language_type 被拒 → 去参重试后成功', d1 is not None and e1 == '')
    check('共提交 2 次（1 失败 + 1 重试）', len(calls) == 2)
    check('第 1 次确实带了 language_type=Chinese',
          calls[0]['input'].get('language_type') == 'Chinese')
    check('第 2 次已去掉 language_type', 'language_type' not in calls[1]['input'])
    check('其余字段未被破坏（text/voice 仍在）',
          calls[1]['input'].get('text') == '让AI帮你' and calls[1]['input'].get('voice') == 'Cherry')
    check('原始 payload 未被就地改动', p1['input'].get('language_type') == 'Chinese')

    # 无 language_type → 只提交一次（不无谓重试）
    calls2 = []

    def fake_post_ok(url, payload, key, async_hdr=False):
        calls2.append(payload)
        return {'output': {'task_id': 'ok-2'}}, '', False

    p2 = {'model': 'm', 'input': {'text': 'Hello', 'voice': 'Cherry'}}
    d2, e2, k2 = t.dash_post_with_lang_fallback(fake_post_ok, 'http://x', p2, 'k')
    check('无 language_type 时只提交 1 次', d2 is not None and e2 == '' and len(calls2) == 1)

    # 两次都失败 → 返回 (None, 原因, killed=True)，不抛异常（交给下一引擎兜底）
    calls3 = []

    def fake_post_always_fail(url, payload, key, async_hdr=False):
        calls3.append(1)
        return None, 'HTTP 400 | boom', True

    p3 = {'model': 'm', 'input': {'text': '让AI', 'voice': 'Cherry', 'language_type': 'Chinese'}}
    d3, e3, k3 = t.dash_post_with_lang_fallback(fake_post_always_fail, 'http://x', p3, 'k')
    check('两次都失败 → (None, 原因, killed=True)，不抛异常',
          d3 is None and bool(e3) and k3 is True and len(calls3) == 2)

    # ── ⑤ VF_TTS_LANG=off 总开关 ──────────────────────────────────────────
    print('\n[5] VF_TTS_LANG=off 一键回退老行为')
    os.environ['VF_TTS_LANG'] = 'off'
    try:
        check('VF_TTS_LANG=off → 含中文也不锁', t.lang_type_for('你好') == '')
    finally:
        os.environ.pop('VF_TTS_LANG', None)
    check('取消开关后恢复锁中文', t.lang_type_for('你好') == 'Chinese')

    # ── ⑥ 源码级接线断言：语言逻辑确实在"合成提交"之前 ─────────────────────
    print('\n[6] 源码级接线断言（语言逻辑接在合成调用之前）')
    src = open(TTS_PATH, encoding='utf-8').read()
    check('源码：v3 请求体 input 里写入 language_type', "inp['language_type'] = _lg" in src)
    check('源码：用 lang_type_for(text) 判定语言', 'lang_type_for(text)' in src)
    check('源码：提交走防呆函数', 'dash_post_with_lang_fallback(_dash_post' in src)
    check('源码：防呆函数会去掉 language_type 重试',
          "_inp.items() if k != 'language_type'" in src)
    check('源码：每镜一行 引擎+音色+语言', "'[TTS] 引擎=%s 音色=%s 语言=%s'" in src)
    check('源码：逐镜打印语言判定', '第 %d 镜 语言=%s' in src)

    i_def = src.index('def dash_post_with_lang_fallback')
    i_setlang = src.index("inp['language_type'] = _lg")
    i_call = src.index('dash_post_with_lang_fallback(_dash_post')
    check('顺序：防呆函数定义 < 实际调用（先定义后用）', i_def < i_call)
    check('顺序：语言强制（设 language_type） < 提交调用（合成之前生效）', i_setlang < i_call)
    i_v3 = src.index('v3 = (style ==')
    check('顺序：v3 分支判定 < 语言强制', i_v3 < i_setlang)

    print('\n%d 项通过 / %d 失败' % (_passed, _failed))
    return 1 if _failed else 0


if __name__ == '__main__':
    sys.exit(main())
