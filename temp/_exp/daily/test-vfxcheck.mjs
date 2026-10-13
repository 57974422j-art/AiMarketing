#!/usr/bin/env node
/**
 * temp/_exp/daily/test-vfxcheck.mjs —— 单测「切分块四边齐全」这条**生成期自检规则**（★VF_DAILY_V18）。
 * 规则（与 daily-page.mjs 里的内联体检逐条一致）：
 *   `<i class="vc" ... style="…">` 的 style 必须同时出现 left / top / width / height。
 * 为什么单测它：这条规则就是用来防"用户实测 4/5/10/11 只显示黄底"那种事故的 ——
 *   规则本身写错（比如只看 width）等于白加，所以用**正反例**各验一遍。
 */
const RULE = (st) => ['left', 'top', 'width', 'height'].filter((k) => !new RegExp('(^|;)' + k + ':').test(st))

let pass = 0
let fail = 0
const ok = (c, msg) => { if (c) { pass++; console.log('  ✓ ' + msg) } else { fail++; console.log('  ✗ ' + msg) } }

// 反例 1：条分（老代码的真样子）—— 只有 left/width
ok(RULE('left:0.000%;width:20.000%;--d:0.000;background-size:500% 100%').join('/') === 'top/height',
  '抓到 条分缺 top/height（这正是 4/10 段空掉的写法）')
// 反例 2：百叶（老代码的真样子）—— 只有 top/height
ok(RULE('top:0.000%;height:25.000%;--d:0.000;background-size:100% 400%').join('/') === 'left/width',
  '抓到 百叶缺 left/width（这正是 5/11 段空掉的写法）')
// 正例：修好后的条分
ok(RULE('top:0;height:100%;left:0.000%;width:20.000%;--d:0.000').length === 0, '修好的条分判为合格')
// 正例：修好后的百叶
ok(RULE('left:0;width:100%;top:0.000%;height:25.000%;--d:0.000').length === 0, '修好的百叶判为合格')
// 正例：拼片（一直都是四边给全 ⇒ 从来没坏过）
ok(RULE('left:33.333%;top:33.333%;width:33.333%;height:33.333%;--d:0.030').length === 0, '拼片判为合格')
// 边界：值里带别的关键字（比如 background-position 里的 left）不能算数
ok(RULE('width:20%;height:100%;background-position:left top').join('/') === 'left/top',
  '不能把 background-position 的 left/top 误当成定位（必须匹配属性名开头）')

console.log('\n结果：通过 ' + pass + ' · 失败 ' + fail)
process.exit(fail ? 1 : 0)
