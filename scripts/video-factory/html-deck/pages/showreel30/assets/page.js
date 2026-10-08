/* 30 秒素材片 · Showreel —— 背景层 + 30 秒时间线
   ★ 确定性：画面只由 `gsap.timeline({paused:true})` 的当前时间决定；
     无 requestAnimationFrame / Date.now / Math.random（随机用固定种子）。
   ★ 段落表（与 index.html 的 data-start/data-duration 一致）：
     S1 0–4.6   开场（大标题 + 斜置竖卡）
     S2 4.2–9.2 作品墙（三卡错落）
     S3 8.8–14.2 特写 + HUD 四角标注
     S4 13.8–19.4 全屏横版 Ken Burns + 遮罩大字
     S5 19.0–24.4 四图网格（2×2）
     S6 24.0–30  收尾（三个大数字 + CTA）
     相邻段重叠 0.4s ⇒ 段与段之间做交叉淡出（不是硬切）。 */
(function () {
  'use strict'
  var DUR = 30, W = 720, H = 1280
  var cv = document.getElementById('bg')
  var ctx = cv.getContext('2d')

  function rnd(i) { var x = Math.sin(i * 97.3 + 13.7) * 43758.5453; return x - Math.floor(x) }
  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x }
  var ease = function (x) { x = clamp01(x); return x * x * (3 - 2 * x) }
  var easeOut = function (x) { x = clamp01(x); return 1 - Math.pow(1 - x, 3) }

  var DOTS = []
  for (var i = 0; i < 110; i++) DOTS.push({ x: rnd(i) * W, y: rnd(i + 800) * H, r: 0.7 + rnd(i + 300) * 1.5, ph: rnd(i + 600) * 6.2832, sp: 0.08 + rnd(i + 1200) * 0.26 })

  function blob(cx, cy, r, rgb, a) {
    var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
    g.addColorStop(0, 'rgba(' + rgb + ',' + a + ')')
    g.addColorStop(0.55, 'rgba(' + rgb + ',' + (a * 0.4) + ')')
    g.addColorStop(1, 'rgba(' + rgb + ',0)')
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
  }

  function drawBg(t) {
    ctx.clearRect(0, 0, W, H)
    var bg = ctx.createLinearGradient(0, 0, W * 0.4, H)
    bg.addColorStop(0, '#070c16'); bg.addColorStop(0.5, '#0a1226'); bg.addColorStop(1, '#070a16')
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H)

    // 三团缓慢漂移的光斑（给深底"呼吸"，也给卡片一点可透的东西）
    blob(160 + Math.sin(t * 0.11) * 90, 260 + Math.cos(t * 0.13) * 70, 480, '80,190,255', 0.26)
    blob(590 + Math.cos(t * 0.09) * 80, 760 + Math.sin(t * 0.12) * 90, 520, '150,120,255', 0.24)
    blob(330 + Math.sin(t * 0.07 + 2.1) * 110, 1180 + Math.cos(t * 0.1) * 60, 420, '90,220,230', 0.16)

    // 极淡网格
    ctx.save(); ctx.globalAlpha = 0.13
    ctx.strokeStyle = 'rgba(180,210,255,.35)'; ctx.lineWidth = 1
    for (var x = 60; x < W; x += 60) { ctx.beginPath(); ctx.moveTo(x + .5, 0); ctx.lineTo(x + .5, H); ctx.stroke() }
    for (var y = 60; y < H; y += 60) { ctx.beginPath(); ctx.moveTo(0, y + .5); ctx.lineTo(W, y + .5); ctx.stroke() }
    ctx.restore()

    // 粒子（缓慢上漂）
    ctx.save()
    for (var k = 0; k < DOTS.length; k++) {
      var d = DOTS[k]
      var y = (d.y - t * (5 + d.sp * 14) % H + H * 3) % H
      var xx = d.x + Math.sin(t * d.sp + d.ph) * 12
      ctx.globalAlpha = 0.14 + 0.30 * (0.5 + 0.5 * Math.sin(t * 0.9 + d.ph))
      ctx.fillStyle = k % 6 === 0 ? '#7ff2ff' : '#a9c6e8'
      ctx.beginPath(); ctx.arc(xx, y, d.r, 0, 6.2832); ctx.fill()
    }
    ctx.restore()
  }

  var cur = 0
  function ready() {
    if (document.fonts && document.fonts.load) {
      Promise.all([
        document.fonts.load('800 78px NotoSansSC'),
        document.fonts.load('600 19px NotoSansSC'),
      ]).then(function () { drawBg(cur) }, function () {})
    }
  }

  var tl = gsap.timeline({ paused: true })
  var proxy = { t: 0 }
  tl.to(proxy, {
    t: DUR, duration: DUR, ease: 'none',
    onUpdate: function () { cur = proxy.t; drawBg(cur) },
  }, 0)

  // ---------------- 段落交叉淡入淡出（不是硬切）----------------
  var SEC = [
    { id: '#s1', i: 0.05, o: 4.05 },
    { id: '#s2', i: 4.35, o: 8.65 },
    { id: '#s3', i: 8.95, o: 13.65 },
    { id: '#s4', i: 13.95, o: 18.85 },
    { id: '#s5', i: 19.15, o: 23.85 },
    { id: '#s6', i: 24.15, o: 29.5 },
  ]
  SEC.forEach(function (s) {
    tl.fromTo(s.id, { opacity: 0 }, { opacity: 1, duration: 0.5, ease: 'power2.out', immediateRender: true }, s.i)
    tl.to(s.id, { opacity: 0, duration: 0.5, ease: 'power2.in' }, s.o)
  })

  // ---------------- S1 开场 ----------------
  tl.fromTo('#s1 .t1', { clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)', duration: 0.8, ease: 'power3.out', immediateRender: true }, 0.15)
  tl.fromTo('#s1 .t2', { clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)', duration: 0.8, ease: 'power3.out', immediateRender: true }, 0.38)
  tl.from('#s1 .sub', { opacity: 0, y: 20, duration: 0.7, ease: 'power2.out' }, 0.86)
  tl.fromTo('#s1 .card', { x: 240, rotate: 9, opacity: 0 },
    { x: 0, rotate: -4, opacity: 1, duration: 1.0, ease: 'power3.out', immediateRender: true }, 0.52)
  tl.from('#s1 .tag', { opacity: 0, y: 14, duration: 0.7, ease: 'power2.out' }, 1.30)
  tl.to('#s1 .card', { y: -10, duration: 1.6, ease: 'sine.inOut' }, 2.2)
  tl.to('#s1 .card', { y: 0, duration: 1.5, ease: 'sine.inOut' }, 3.0)

  // ---------------- S2 作品墙 ----------------
  tl.from('#s2 .ttl', { opacity: 0, y: 26, duration: 0.75, ease: 'power3.out' }, 4.45)
  tl.from('#s2 .sub', { opacity: 0, y: 18, duration: 0.7, ease: 'power2.out' }, 4.62)
  tl.from(['#s2 .c1', '#s2 .c2', '#s2 .c3'], { opacity: 0, y: 46, duration: 0.8, stagger: 0.16, ease: 'power3.out' }, 4.78)
  tl.from(['#s2 .l1', '#s2 .l2', '#s2 .l3'], { opacity: 0, y: 14, duration: 0.6, stagger: 0.16, ease: 'power2.out' }, 5.35)
  tl.from(['#s2 .r1', '#s2 .r2', '#s2 .r3'], { opacity: 0, x: -20, duration: 0.65, stagger: 0.17, ease: 'power2.out' }, 5.95)
  // 卡片微浮动（长停留不死板）
  tl.to('#s2 .c1', { y: -8, duration: 1.8, ease: 'sine.inOut' }, 6.6)
  tl.to('#s2 .c2', { y: -8, duration: 1.8, ease: 'sine.inOut' }, 6.9)
  tl.to('#s2 .c3', { y: -8, duration: 1.8, ease: 'sine.inOut' }, 7.2)

  // ---------------- S3 特写 + HUD ----------------
  tl.fromTo('#s3 .card', { opacity: 0, scale: .975 }, { opacity: 1, scale: 1, duration: 0.85, ease: 'power3.out', immediateRender: true }, 9.00)
  tl.from(['#s3 .cnr'], { opacity: 0, scale: .6, duration: 0.5, stagger: 0.09, ease: 'back.out(2.2)' }, 9.55)
  tl.from('#s3 .mk', { opacity: 0, y: -10, duration: 0.55, ease: 'power2.out' }, 10.05)
  tl.from('#s3 .ttl', { opacity: 0, y: 30, duration: 0.8, ease: 'power3.out' }, 10.35)
  tl.from('#s3 .sub', { opacity: 0, y: 20, duration: 0.75, ease: 'power2.out' }, 10.60)
  tl.from(['#s3 .chips > *'], { opacity: 0, y: 22, duration: 0.7, stagger: 0.14, ease: 'power2.out' }, 10.85)
  // 卡内缓慢推近
  tl.fromTo('#s3 .card img', { scale: 1.0 }, { scale: 1.05, duration: 5.4, ease: 'none', immediateRender: true }, 8.8)

  // ---------------- S4 全屏横版 ----------------
  tl.fromTo('#s4 .full img', { scale: 1.05, x: 0 }, { scale: 1.13, x: -14, duration: 5.6, ease: 'none', immediateRender: true }, 13.8)
  tl.from(['#s4 .scrimT', '#s4 .scrimB'], { opacity: 0, duration: 0.8, ease: 'power2.out' }, 13.95)
  tl.from('#s4 .eb', { opacity: 0, y: -12, duration: 0.6, ease: 'power2.out' }, 14.15)
  tl.from('#s4 .ttl', { opacity: 0, y: 34, duration: 0.85, ease: 'power3.out' }, 14.42)
  tl.from('#s4 .sub', { opacity: 0, y: 22, duration: 0.75, ease: 'power2.out' }, 14.68)
  tl.from(['#s4 .steps > *'], { opacity: 0, y: 20, duration: 0.7, stagger: 0.13, ease: 'power2.out' }, 14.92)

  // ---------------- S5 四图网格 ----------------
  tl.from('#s5 .ttl', { opacity: 0, y: 26, duration: 0.75, ease: 'power3.out' }, 19.20)
  tl.from('#s5 .sub', { opacity: 0, y: 18, duration: 0.7, ease: 'power2.out' }, 19.36)
  tl.from(['#s5 .g1', '#s5 .g2', '#s5 .g3', '#s5 .g4'], { opacity: 0, y: 40, scale: .97, duration: 0.75, stagger: 0.15, ease: 'power3.out' }, 19.52)
  tl.from(['#s5 .n1', '#s5 .n2', '#s5 .n3', '#s5 .n4'], { opacity: 0, scale: .7, duration: 0.45, stagger: 0.1, ease: 'back.out(2)' }, 20.35)
  tl.from('#s5 .tail', { opacity: 0, y: 20, duration: 0.7, ease: 'power2.out' }, 20.95)

  // ---------------- S6 收尾 ----------------
  tl.from('#s6 .ttl', { opacity: 0, y: 30, duration: 0.8, ease: 'power3.out' }, 24.25)
  tl.from(['#s6 .num'], { opacity: 0, yPercent: 60, duration: 0.85, stagger: 0.15, ease: 'power4.out' }, 24.62)
  tl.from(['#s6 .k1', '#s6 .k2', '#s6 .k3'], { opacity: 0, y: 16, duration: 0.6, stagger: 0.12, ease: 'power2.out' }, 25.18)
  tl.from('#s6 .cta', { opacity: 0, y: 26, duration: 0.75, ease: 'power3.out' }, 25.62)
  tl.fromTo('#shine', { x: -190 }, { x: 660, duration: 1.4, ease: 'power2.inOut', repeat: -1, repeatDelay: 1.5, immediateRender: true }, 26.1)
  tl.from('#s6 .note', { opacity: 0, duration: 0.8, ease: 'power2.out' }, 26.4)

  // 全片进度条
  tl.fromTo('#barIn', { scaleX: 0 }, { scaleX: 1, duration: DUR, ease: 'none', immediateRender: true }, 0)

  tl.eventCallback('onStart', function () { drawBg(0) })
  window.__timelines['main'] = tl
  drawBg(0)
  ready()
})()
