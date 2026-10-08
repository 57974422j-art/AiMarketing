/* 风格 2 · 双色印刷拼贴 —— 主图形（半调网点圆盘 / 网点带 / 纸面颗粒）
   确定性：只由时间轴时间决定；无 rAF / Date.now / Math.random（用固定种子）。 */
(function () {
  'use strict'
  var DUR = 9, W = 720, H = 1280
  var cv = document.getElementById('fx')
  var ctx = cv.getContext('2d')
  var INK = '21,22,26', IND = '27,42,107', MAG = '212,0,58'

  function rnd(i) { var x = Math.sin(i * 73.3 + 19.7) * 43758.5453; return x - Math.floor(x) }
  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x }
  var ease = function (x) { x = clamp01(x); return x * x * (3 - 2 * x) }
  var easeOut = function (x) { x = clamp01(x); return 1 - Math.pow(1 - x, 3) }

  var HALF = { cx: 498, cy: 640, r: 214, t0: 1.25 }

  /* 半调圆盘：在圆内铺网点，点半径随"到圆心的归一距离"变化（= 印刷的渐变网点） */
  function halftone(prog) {
    var step = 13
    for (var gx = HALF.cx - HALF.r; gx <= HALF.cx + HALF.r; gx += step) {
      for (var gy = HALF.cy - HALF.r; gy <= HALF.cy + HALF.r; gy += step) {
        var dx = gx - HALF.cx, dy = gy - HALF.cy
        var d = Math.sqrt(dx * dx + dy * dy) / HALF.r
        if (d > 1) continue
        // 出现顺序：由中心向外（prog 控制"擦除半径"）
        if (d > prog) continue
        var appear = clamp01((prog - d) / 0.08)
        var rr = (1.05 + 2.9 * (1 - d)) * appear
        if (rr <= 0.2) continue
        ctx.beginPath()
        ctx.fillStyle = d < 0.62 ? 'rgba(' + MAG + ',' + (0.92 * appear) + ')' : 'rgba(' + IND + ',' + (0.85 * appear) + ')'
        ctx.arc(gx, gy, rr, 0, 6.2832)
        ctx.fill()
      }
    }
  }

  /* 网点带：横向滚动（印刷网点的"传送带"） */
  function band(y, h, off, color) {
    var step = 9
    ctx.save()
    ctx.beginPath(); ctx.rect(0, y, W, h); ctx.clip()
    for (var x = -step; x < W + step; x += step) {
      var xx = (((x + off) % (W + step)) + (W + step)) % (W + step) - step
      for (var yy = y; yy < y + h; yy += step) {
        var k = 1 - Math.abs((yy - (y + h / 2)) / (h / 2))
        var r = 1.0 + 2.2 * k
        ctx.beginPath(); ctx.fillStyle = 'rgba(' + color + ',' + (0.30 + 0.5 * k) + ')'
        ctx.arc(xx, yy, r, 0, 6.2832); ctx.fill()
      }
    }
    ctx.restore()
  }

  function draw(t) {
    ctx.clearRect(0, 0, W, H)

    // ① 纸底
    ctx.fillStyle = '#f2efe6'; ctx.fillRect(0, 0, W, H)

    // ② 顶部与底部网点带（缓慢滚动 ⇒ 画面"在走"）
    band(126, 62, t * 22, IND)
    // ★ 两次挪位：1120 → 1032 会压住第三行小字（逐帧可复现…）⇒ 最终放**页面最底、落款之下**（1198），
    //   页内所有文字都在它上方 ⇒ 无论文案多长都不会再打架。
    band(1198, 58, -t * 18, MAG)

    // ③ 半调圆盘（由内向外显现）
    var p = easeOut((t - HALF.t0) / 1.5)
    if (p > 0.001) halftone(p)

    // ④ 纸面颗粒（固定种子）
    ctx.save(); ctx.globalAlpha = 0.055
    for (var q = 0; q < 340; q++) {
      ctx.fillStyle = q % 3 === 0 ? 'rgba(' + MAG + ',1)' : 'rgba(' + INK + ',1)'
      ctx.fillRect(rnd(q) * W, rnd(q + 4000) * H, 1.5, 1.5)
    }
    ctx.restore()

    // ⑤ 圆盘外围的两道装饰弧（印刷描边感）
    if (p > 0.35) {
      var ap = ease((p - 0.35) / 0.5)
      ctx.save(); ctx.globalAlpha = 0.9 * ap
      ctx.strokeStyle = 'rgba(' + INK + ',.85)'; ctx.lineWidth = 3
      ctx.beginPath(); ctx.arc(HALF.cx, HALF.cy, HALF.r + 18, -1.15, 1.15); ctx.stroke()
      ctx.beginPath(); ctx.arc(HALF.cx, HALF.cy, HALF.r + 30, 2.0, 4.2); ctx.stroke()
      ctx.restore()
    }
  }

  var cur = 0
  function ready() {
    if (document.fonts && document.fonts.load) document.fonts.load('900 100px NotoSansSC').then(function () { draw(cur) }, function () {})
  }

  var tl = gsap.timeline({ paused: true })
  var proxy = { t: 0 }
  tl.to(proxy, { t: DUR, duration: DUR, ease: 'none', onUpdate: function () { cur = proxy.t; draw(cur) } }, 0)

  // 排印：粗黑体两行"擦入"（clip-path 从左到右）
  tl.fromTo('#h1', { clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)', duration: 0.75, ease: 'power3.out', immediateRender: true }, 0.30)
  tl.fromTo('#h2', { clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)', duration: 0.75, ease: 'power3.out', immediateRender: true }, 0.52)
  tl.fromTo('#rule1', { scaleX: 0 }, { scaleX: 1, duration: 0.7, ease: 'power2.out', immediateRender: true }, 0.16)
  tl.from('#eyebrow', { opacity: 0, y: -10, duration: 0.6, ease: 'power2.out' }, 0.10)

  // 印章：盖章（放大落下 + 回正）
  tl.fromTo('#stamp', { scale: 1.9, rotate: -24, opacity: 0 },
    { scale: 1, rotate: -8, opacity: 1, duration: 0.5, ease: 'back.out(2.1)', immediateRender: true }, 0.86)
  tl.fromTo('#stamp', { scale: 1 }, { scale: 1.02, duration: 0.16, ease: 'power1.out' }, 1.36)

  tl.from('#num', { opacity: 0, y: 40, duration: 0.85, ease: 'power3.out' }, 1.70)
  tl.from('#lead', { opacity: 0, y: 24, duration: 0.8, ease: 'power3.out' }, 1.94)
  tl.from('#meta .row', { opacity: 0, x: -22, duration: 0.7, stagger: 0.16, ease: 'power2.out' }, 2.22)
  tl.fromTo('#rule2', { scaleX: 0 }, { scaleX: 1, duration: 0.9, ease: 'power2.out', immediateRender: true }, 2.60)
  tl.from('#foot', { opacity: 0, duration: 0.8, ease: 'power2.out' }, 2.80)

  tl.eventCallback('onStart', function () { draw(0) })
  window.__timelines['main'] = tl
  draw(0); ready()
})()
