/* 阶段 3 原型 B · 亮底编辑风 —— 时间驱动绘制
   确定性口径同 A：画面只由时间线当前时间决定；无 rAF / 无 Date.now / 无 Math.random。 */
(function () {
  'use strict'
  var DUR = 9, W = 720, H = 1280
  var cv = document.getElementById('fx')
  var ctx = cv.getContext('2d')

  // 曲线区（与 HTML 里留白的版心对齐）
  var X0 = 72, X1 = 648, Y0 = 540, Y1 = 900
  var SER_A = [12, 26, 34, 52, 61, 78.5]      // 智能投放
  var SER_B = [10, 14, 17, 20, 23, 26]        // 自然流量
  var MAXV = 86

  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x }
  var ease = function (x) { x = clamp01(x); return x * x * (3 - 2 * x) }
  var easeOut = function (x) { x = clamp01(x); return 1 - Math.pow(1 - x, 3) }
  function rnd(i) { var x = Math.sin(i * 91.7 + 41.3) * 43758.5453; return x - Math.floor(x) }

  function px(i) { return X0 + (X1 - X0) * (i / (SER_A.length - 1)) }
  function py(v) { return Y1 - (Y1 - Y0) * (v / MAXV) }

  /* 平滑折线（Catmull-Rom → 三次贝塞尔）：只画到 prog（0~1）处，
     末端做**段内插值**，所以"生长"是连续的、不是一节节跳。 */
  function smoothPath(series, prog) {
    var n = series.length
    var pts = []
    for (var i = 0; i < n; i++) pts.push({ x: px(i), y: py(series[i]) })

    // 每条曲线总长参数化：按 x 轴比例取 prog（视觉上"从左往右长"）
    var xEnd = X0 + (X1 - X0) * prog
    ctx.beginPath()
    ctx.moveTo(pts[0].x, pts[0].y)
    var tip = pts[0]
    for (var j = 0; j < n - 1; j++) {
      var p0 = pts[j - 1] || pts[j], p1 = pts[j], p2 = pts[j + 1], p3 = pts[j + 2] || pts[j + 1]
      var c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6
      var c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6
      if (xEnd >= p2.x) {
        ctx.bezierCurveTo(c1x, c1y, c2x, c2y, p2.x, p2.y)
        tip = p2
      } else {
        // 段内截断：二分找 t 使 x(t) ≈ xEnd
        var lo = 0, hi = 1, bt = 0
        for (var it = 0; it < 22; it++) {
          var mt = (lo + hi) / 2
          var xx = bez(p1.x, c1x, c2x, p2.x, mt)
          if (xx < xEnd) { lo = mt; bt = mt } else hi = mt
        }
        var tx = bez(p1.x, c1x, c2x, p2.x, bt), ty = bez(p1.y, c1y, c2y, p2.y, bt)
        ctx.bezierCurveTo(
          bez(p1.x, c1x, c2x, p2.x, bt / 3), bez(p1.y, c1y, c2y, p2.y, bt / 3),
          bez(p1.x, c1x, c2x, p2.x, bt * 2 / 3), bez(p1.y, c1y, c2y, p2.y, bt * 2 / 3),
          tx, ty)
        tip = { x: tx, y: ty }
        break
      }
    }
    return tip
  }
  function bez(a, b, c, d, t) { var u = 1 - t; return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d }

  function draw(t) {
    ctx.clearRect(0, 0, W, H)

    // ① 纸底 + 两团极淡的色晕（缓慢漂移，给亮底"空气感"）
    ctx.fillStyle = '#f5f6f8'
    ctx.fillRect(0, 0, W, H)
    var b1x = 250 + Math.sin(t * 0.21) * 46, b1y = 330 + Math.cos(t * 0.17) * 34
    var g1 = ctx.createRadialGradient(b1x, b1y, 10, b1x, b1y, 430)
    g1.addColorStop(0, 'rgba(27,92,240,.085)')
    g1.addColorStop(1, 'rgba(27,92,240,0)')
    ctx.fillStyle = g1; ctx.fillRect(0, 0, W, H)
    var b2x = 560 + Math.cos(t * 0.15) * 40, b2y = 980 + Math.sin(t * 0.19) * 40
    var g2 = ctx.createRadialGradient(b2x, b2y, 10, b2x, b2y, 380)
    g2.addColorStop(0, 'rgba(255,168,84,.075)')
    g2.addColorStop(1, 'rgba(255,168,84,0)')
    ctx.fillStyle = g2; ctx.fillRect(0, 0, W, H)

    // ② 淡网格（只在曲线区，很淡）
    var ga = ease((t - 0.5) / 1.0)
    if (ga > 0) {
      ctx.save(); ctx.globalAlpha = 0.5 * ga
      ctx.strokeStyle = 'rgba(16,20,24,.055)'; ctx.lineWidth = 1
      for (var k = 0; k <= 4; k++) {
        var gy = Y0 + (Y1 - Y0) * (k / 4)
        ctx.beginPath(); ctx.moveTo(X0, gy + 0.5); ctx.lineTo(X1, gy + 0.5); ctx.stroke()
      }
      ctx.restore()
      // 横轴
      ctx.save(); ctx.globalAlpha = ga
      ctx.strokeStyle = 'rgba(16,20,24,.18)'; ctx.lineWidth = 1.4
      ctx.beginPath(); ctx.moveTo(X0, Y1 + 0.5); ctx.lineTo(X1, Y1 + 0.5); ctx.stroke()
      // 周标签
      ctx.fillStyle = '#6d7886'; ctx.font = '400 19px NotoSansSC, sans-serif'; ctx.textAlign = 'center'
      for (var i = 0; i < SER_A.length; i++) ctx.fillText((i + 1) + '周', px(i), Y1 + 34)
      ctx.restore()
    }

    // ③ 第二条线（自然流量，灰，先画，作背景对照）
    var pB = easeOut((t - 1.35) / 1.5)
    if (pB > 0.01) {
      ctx.save(); ctx.globalAlpha = 0.95
      ctx.strokeStyle = '#b9c1cc'; ctx.lineWidth = 3.5; ctx.lineJoin = 'round'; ctx.lineCap = 'round'
      smoothPath(SER_B, pB); ctx.stroke()
      ctx.restore()
    }

    // ④ 第一条线（智能投放，主角）：面积渐变 + 主线 + 端点光点
    var pA = easeOut((t - 1.0) / 1.7)
    if (pA > 0.01) {
      var tip = smoothPath(SER_A, pA)
      ctx.save()
      // 面积
      ctx.lineTo(tip.x, Y1); ctx.lineTo(X0, Y1); ctx.closePath()
      var ag = ctx.createLinearGradient(0, Y0, 0, Y1)
      ag.addColorStop(0, 'rgba(27,92,240,.22)')
      ag.addColorStop(1, 'rgba(27,92,240,0)')
      ctx.fillStyle = ag; ctx.fill()
      ctx.restore()
      // 主线
      ctx.save()
      ctx.strokeStyle = '#1b5cf0'; ctx.lineWidth = 5; ctx.lineJoin = 'round'; ctx.lineCap = 'round'
      ctx.shadowColor = 'rgba(27,92,240,.28)'; ctx.shadowBlur = 12
      smoothPath(SER_A, pA); ctx.stroke()
      ctx.restore()
      // 端点
      ctx.save()
      ctx.fillStyle = '#ffffff'
      ctx.beginPath(); ctx.arc(tip.x, tip.y, 10.5, 0, 6.2832); ctx.fill()
      ctx.fillStyle = '#1b5cf0'
      ctx.beginPath(); ctx.arc(tip.x, tip.y, 6.5, 0, 6.2832); ctx.fill()
      ctx.restore()
    }

    // ⑤ 数据点（在曲线长到之后依次点亮）
    ctx.save()
    for (var m = 0; m < SER_A.length; m++) {
      var a = ease((t - (1.0 + 1.7 * (m / (SER_A.length - 1))) ) / 0.35)
      if (a <= 0.01) continue
      ctx.globalAlpha = a
      ctx.fillStyle = '#1b5cf0'
      ctx.beginPath(); ctx.arc(px(m), py(SER_A[m]), 4.6, 0, 6.2832); ctx.fill()
      ctx.globalAlpha = a * 0.75
      ctx.fillStyle = '#b9c1cc'
      ctx.beginPath(); ctx.arc(px(m), py(SER_B[m]), 3.6, 0, 6.2832); ctx.fill()
    }
    ctx.restore()

    // ⑥ 纸纹颗粒（极淡；固定种子 ⇒ 可复现）
    ctx.save()
    ctx.globalAlpha = 0.05
    for (var q = 0; q < 260; q++) {
      var qx = rnd(q) * W, qy = rnd(q + 5000) * H
      ctx.fillStyle = '#101418'
      ctx.fillRect(qx, qy, 1.4, 1.4)
    }
    ctx.restore()
  }

  var cur = 0
  function ready() {
    if (document.fonts && document.fonts.load) {
      document.fonts.load('400 19px NotoSansSC').then(function () { draw(cur) }, function () {})
    }
  }

  var tl = gsap.timeline({ paused: true })
  var proxy = { t: 0 }
  tl.to(proxy, { t: DUR, duration: DUR, ease: 'none', onUpdate: function () { cur = proxy.t; draw(cur) } }, 0)

  tl.from('#eyebrow', { opacity: 0, y: 14, duration: 0.8, ease: 'power2.out' }, 0.12)
  tl.fromTo('#h1', { clipPath: 'inset(0 100% 0 0)', y: 16 }, { clipPath: 'inset(0 0% 0 0)', y: 0, duration: 0.95, ease: 'power3.out', immediateRender: true }, 0.34)
  tl.fromTo('#h2', { clipPath: 'inset(0 100% 0 0)', y: 16 }, { clipPath: 'inset(0 0% 0 0)', y: 0, duration: 0.95, ease: 'power3.out', immediateRender: true }, 0.56)
  tl.fromTo('#hairline', { scaleX: 0 }, { scaleX: 1, duration: 0.7, ease: 'power2.out', immediateRender: true }, 0.92)
  tl.from('#sub', { opacity: 0, y: 18, duration: 0.8, ease: 'power2.out' }, 1.02)

  tl.from('#callout', { opacity: 0, y: 26, scale: .94, duration: 0.8, ease: 'back.out(1.5)' }, 3.05)
  tl.from('#legend .row', { opacity: 0, x: -18, duration: 0.75, stagger: 0.16, ease: 'power2.out' }, 3.15)

  tl.fromTo('#rule-l', { scaleX: 0 }, { scaleX: 1, duration: 1.0, ease: 'power2.out', immediateRender: true }, 3.6)
  tl.from('#foot', { opacity: 0, duration: 0.9, ease: 'power2.out' }, 3.8)

  // 末端轻浮（长停留不死板）
  tl.to('#callout', { y: -6, duration: 2.4, ease: 'sine.inOut' }, 4.2)
  tl.to('#callout', { y: 0, duration: 2.4, ease: 'sine.inOut' }, 6.6)

  tl.eventCallback('onStart', function () { draw(0) })
  window.__timelines['main'] = tl
  draw(0)
  ready()
})()
