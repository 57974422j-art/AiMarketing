/**
 * ★VF_DAILY_V19（A′）单测：`src/lib/html-rewrite.ts` —— HTML 相对图名 → 本站签名短链。
 * 为什么值得单测：这条规则错了，客户端预览里就是**一片占位黄底**（闸门完全看不见 ——
 * 它测的是"几何/字号/溢出"，不测"这张图的 URL 能不能被 sandbox iframe 取到"）。
 *
 * 跑法：
 *   npx tsc src/lib/html-rewrite.ts src/lib/file-link.ts --module commonjs --target es2022 --skipLibCheck --outDir temp/_exp/daily/run2
 *   node temp/_exp/daily/test-htmlrewrite.mjs
 * （file-link.ts 只依赖 node:crypto ⇒ 能脱离 Next 运行时单测。）
 */
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { rewriteRelativeRefs, isRelativeRef, refFileName, REF_NAME_OK } = require('./run2/html-rewrite.js')

let pass = 0
let fail = 0
const ok = (c, msg) => { if (c) { pass++; console.log('  ✓ ' + msg) } else { fail++; console.log('  ✗ ' + msg) } }

console.log('\n=== 1. isRelativeRef：哪些该改写、哪些坚决不碰 ===')
ok(isRelativeRef('gen_x_p1.jpg') === true, '同级扁平名 ⇒ 改写')
ok(isRelativeRef('images/1.jpg') === true, '带子目录的相对名 ⇒ 也改写（旧档兼容）')
ok(isRelativeRef('https://a.com/x.jpg') === false, 'http(s) 绝对地址 ⇒ 不碰')
ok(isRelativeRef('//cdn.a.com/x.jpg') === false, '协议相对地址 ⇒ 不碰')
ok(isRelativeRef('data:image/jpeg;base64,AAA') === false, 'data: 内嵌 ⇒ 不碰（免得把单文件版改坏）')
ok(isRelativeRef('blob:abc') === false, 'blob: ⇒ 不碰')
ok(isRelativeRef('#sec2') === false, '页内锚点 ⇒ 不碰')
ok(isRelativeRef('/f/1/x.jpg?t=1.abc') === false, '已经是站内绝对路径（改写过）⇒ 不碰（保证幂等）')
ok(isRelativeRef('') === false, '空串 ⇒ 不碰')
ok(isRelativeRef('   ') === false, '纯空白 ⇒ 不碰')

console.log('\n=== 2. refFileName：与"镜像拍平"同口径取文件名 ===')
ok(refFileName('gen_x_p1.jpg') === 'gen_x_p1.jpg', '扁平名原样')
ok(refFileName('images/1.jpg') === '1.jpg', '子目录被拍平（客户端镜像就是这么拍的）')
ok(refFileName('a/b/1.jpg?v=2') === '1.jpg', '带 query ⇒ 去掉 query 再取文件名')
ok(refFileName('../1.jpg') === '1.jpg', '带 .. 也只取文件名（防目录穿越）')
ok(REF_NAME_OK.test('gen_20261013_016.jpg') === true, '仓库合法名通过')
ok(REF_NAME_OK.test('a/b.jpg') === false, '带斜杠的名字**不许**当参数（读/删接口同款口径）')

console.log('\n=== 3. rewriteRelativeRefs：只改该改的、结果可被 iframe 用 ===')
{
  const r = rewriteRelativeRefs('<img class="ph" src="gen_x_p1.jpg" alt="">', 1)
  ok(r.done === 1, 'img src 被改写 1 处')
  ok(/src="\/f\/1\/gen_x_p1\.jpg\?t=\d+\.[0-9a-f]{16}"/.test(r.html), '改成了站内签名短链（无 cookie 也能取）')
  ok(r.names.join() === 'gen_x_p1.jpg', '报出用到的图名（供日志）')

  const r2 = rewriteRelativeRefs('<div class="fig" style="background:var(--g1);--img:var(--img1)"></div>'
    + '<style>:root{--img1:url(gen_x_p1.jpg);--img2:url(\'gen_x_p2.jpg\');--img3:url("gen_x_p3.jpg")}</style>', 1)
  ok(r2.done === 3, '三种 url() 写法都改到（裸引号/单引号/双引号）')
  ok(!/url\((gen_x_p\d\.jpg)\)/.test(r2.html), '不再残留相对名')
  ok((r2.html.match(/\/f\/1\/gen_x_p\d\.jpg\?t=/g) || []).length === 3, '三处都换成了短链')

  const mixed = rewriteRelativeRefs('<img src="https://a.com/x.jpg"><img src="data:image/png;base64,AA">'
    + '<a href="#top">t</a><img src="/f/1/already.jpg?t=1.aa">', 1)
  ok(mixed.done === 0 && mixed.html.includes('https://a.com/x.jpg'), '绝对/data:/锚点/已改写 ⇒ 一处都不动（幂等）')

  const base = rewriteRelativeRefs('<img src="gen_x_p1.jpg">', 1)
  ok(rewriteRelativeRefs(base.html, 1).done === 0, '对已改写的结果再跑一遍 ⇒ 0 处（幂等，重复预览不会把链接叠成两层）')

  const sub = rewriteRelativeRefs('<img src="images/1.jpg">', 7)
  ok(sub.html.includes('/f/7/1.jpg?t='), '子目录引用 ⇒ 按**拍平后的文件名**出短链（与本地镜像同口径）')
  const oth = rewriteRelativeRefs('<img src="gen_x_p1.jpg">', 1, 60)
  ok(/\/f\/1\//.test(oth.html), 'uid 作为短链的第一段（个人仓库根）')
  const bad = rewriteRelativeRefs('<img src="a b.jpg">', 1)
  ok(bad.done === 0, '文件名含空格（非法）⇒ 不改写（宁可留原样，也不生成打不开的链接）')
}

console.log('\n结果：通过 ' + pass + ' · 失败 ' + fail)
process.exit(fail ? 1 : 0)
