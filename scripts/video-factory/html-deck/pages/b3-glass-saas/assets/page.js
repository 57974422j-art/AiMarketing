/* 风格 3 · 毛玻璃渐变 SaaS —— 背景层（光斑/网格）+ 主卡环形进度
   确定性：只由时间轴时间决定；无 rAF / Date.now / Math.random（用固定种子）。 */
(function () {
  'use strict'
  var DUR = 9, W = 720, H = 1280
  var cv = document.getElementById('fx'), ctx = cv.getContext('2d')
  var rc = document.getElementById('ring'), rt = rc.getContext('2d')
  var RW = 224, RC = RW / 2, RR = 92

  function rnd(i) { var x = Math.sin(i * 59.9 + 31.1) * 43758.5453; return x - Math.floor(x) }
  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x }
  var ease = function (x) { x = clamp01(x); return x * x * (3 - 2 * x) }
  var easeOut = function (x) { x = clamp01(x); return 1 - Math.pow(1 - x, 3) }

  function blob(cx, cy, r, rgb, a) {
    var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
    g.addColorStop(0, 'rgba(' + rgb + ',' + a + ')')
    g.addColorStop(0.55, 'rgba(' + rgb + ',' + (a * 0.42) + ')')
    g.addColorStop(1, 'rgba(' + rgb + ',0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)
  }

  function drawBg(t) {
    ctx.clearRect(0, 0, W, H)
    // 深靛底
    var bg = ctx.createLinearGradient(0, 0, W * 0.35, H)
    bg.addColorStop(0, '#0b1030'); bg.addColorStop(0.55, '#121042'); bg.addColorStop(1, '#0a0c26')
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H)

    // 三团缓慢漂移的光斑 —— ⚠ 毛玻璃（backdrop-filter）**必须有东西可透**才成立：
    //   第 1 版光斑太淡（0.30）⇒ 卡片看起来只是"半透明色块"，没有磨砂质感。这里加强并加一团暖色。
    blob(180 + Math.sin(t * 0.28) * 70, 320 + Math.cos(t * 0.22) * 54, 460, '90,190,255', 0.46)
    blob(560 + Math.cos(t * 0.19) * 62, 900 + Math.sin(t * 0.25) * 66, 500, '150,120,255', 0.42)
    blob(300 + Math.sin(t * 0.16 + 1.7) * 90, 1120 + Math.cos(t * 0.21) * 46, 430, '255,150,120', 0.14)

    // 极淡网格
    ctx.save(); ctx.globalAlpha = 0.16
    ctx.strokeStyle = 'rgba(190,215,255,.30)'; ctx.lineWidth = 1
    for (var x = 60; x < W; x += 60) { ctx.beginPath(); ctx.moveTo(x + .5, 0); ctx.lineTo(x + .5, H); ctx.stroke() }
    for (var y = 60; y < H; y += 60) { ctx.beginPath(); ctx.moveTo(0, y + .5); ctx.lineTo(W, y + .5); ctx.stroke() }
    ctx.restore()

    // 大圆弧 + 斜线（**压在卡片区的近背景**：卡片背后有形状，磨砂才看得出来）
    ctx.save(); ctx.globalAlpha = 0.30
    ctx.strokeStyle = 'rgba(170,210,255,.55)'; ctx.lineWidth = 1.6
    var arcR = 300 + Math.sin(t * 0.24) * 14
    ctx.beginPath(); ctx.arc(520, 880, arcR, Math.PI * 0.62, Math.PI * 1.28); ctx.stroke()
    ctx.beginPath(); ctx.arc(520, 880, arcR + 34, Math.PI * 0.70, Math.PI * 1.20); ctx.stroke()
    ctx.globalAlpha = 0.16
    ctx.strokeStyle = 'rgba(200,225,255,.75)'; ctx.lineWidth = 1
    for (var k = 0; k < 22; k++) {
      var x0 = -180 + k * 46 + (t * 12) % 46
      ctx.beginPath(); ctx.moveTo(x0, 1280); ctx.lineTo(x0 + 150, 700); ctx.stroke()
    }
    ctx.restore()

    // 星点（固定种子）
    ctx.save(); ctx.globalAlpha = 0.5
    for (var i = 0; i < 90; i++) {
      var a = 0.20 + 0.5 * (0.5 + 0.5 * Math.sin(t * 1.4 + i))
      ctx.fillStyle = 'rgba(210,235,255,' + a.toFixed(3) + ')'
      ctx.beginPath(); ctx.arc(rnd(i) * W, rnd(i + 700) * H, 1.1 + rnd(i + 1400) * 1.5, 0, 6.2832); ctx.fill()
    }
    ctx.restore()
  }

  function drawRing(t) {
    var p = easeOut((t - 1.15) / 1.65) * 0.785     // 78.5%
    rt.clearRect(0, 0, RW, RW)
    // 轨道
    rt.strokeStyle = 'rgba(200,225,255,.20)'; rt.lineWidth = 14
    rt.beginPath(); rt.arc(RC, RC, RR, 0, 6.2832); rt.stroke()
    if (p <= 0.001) return
    // 进度（青色→紫，与 CTA 渐变呼应）
    var g = rt.createLinearGradient(0, 0, RW, RW)
    g.addColorStop(0, '#4dd7ff'); g.addColorStop(1, '#8b7bff')
    rt.strokeStyle = g; rt.lineWidth = 14; rt.lineCap = 'round'
    rt.shadowColor = 'rgba(110,200,255,.65)'; rt.shadowBlur = 16
    rt.beginPath(); rt.arc(RC, RC, RR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p); rt.stroke()
    rt.shadowBlur = 0
    // 端点
    var ea = -Math.PI / 2 + Math.PI * 2 * p
    rt.fillStyle = '#ffffff'
    rt.beginPath(); rt.arc(RC + Math.cos(ea) * RR, RC + Math.sin(ea) * RR, 6, 0, 6.2832); rt.fill()
  }

  var cur = 0
  function ready() {
    if (document.fonts && document.fonts.load) document.fonts.load('800 58px NotoSansSC').then(function () { drawBg(cur); drawRing(cur) }, function () {})
  }

  var tl = gsap.timeline({ paused: true })
  var proxy = { t: 0 }
  tl.to(proxy, {
    t: DUR, duration: DUR, ease: 'none',
    onUpdate: function () { cur = proxy.t; drawBg(cur); drawRing(cur) },
  }, 0)

  tl.from('#eyebrow', { opacity: 0, y: 14, duration: 0.7, ease: 'power2.out' }, 0.14)
  tl.from('#title', { opacity: 0, y: 30, duration: 0.9, ease: 'power3.out' }, 0.28)
  tl.from('#sub', { opacity: 0, y: 20, duration: 0.8, ease: 'power3.out' }, 0.50)

  // 卡片浮起（毛玻璃层"落位"）
  tl.from('#main', { opacity: 0, y: 44, scale: .975, duration: 0.95, ease: 'power3.out' }, 0.78)
  tl.from('#bigNum', { opacity: 0, yPercent: 26, duration: 0.8, ease: 'power3.out' }, 2.55)
  tl.from('#bigUnit', { opacity: 0, duration: 0.7, ease: 'power2.out' }, 2.78)
  tl.from('#kTtl', { opacity: 0, x: 16, duration: 0.7, ease: 'power2.out' }, 1.35)
  tl.from('#kRow .r', { opacity: 0, x: 18, duration: 0.7, stagger: 0.16, ease: 'power2.out' }, 1.55)

  tl.from('.mini', { opacity: 0, y: 34, duration: 0.8, stagger: 0.14, ease: 'power3.out' }, 2.32)

  tl.from('#cta', { opacity: 0, y: 28, duration: 0.8, ease: 'power3.out' }, 3.02)
  // CTA 高光循环扫过（长停留时画面不死）
  tl.fromTo('#ctaShine', { x: -200 }, { x: 660, duration: 1.5, ease: 'power2.inOut', repeat: -1, repeatDelay: 1.6, immediateRender: true }, 3.4)

  tl.eventCallback('onStart', function () { drawBg(0); drawRing(0) })
  window.__timelines['main'] = tl
  drawBg(0); drawRing(0); ready()
})()
