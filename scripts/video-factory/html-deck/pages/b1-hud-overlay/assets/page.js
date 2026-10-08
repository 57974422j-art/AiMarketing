/* 风格 1 · 霓虹 HUD 素材叠加（第 3 版）—— HUD 绘制层
   ★ 第 3 版的结构变化（由引擎闸门逼出来的，属**正向改进**）：
     画布从"满页 720×1280"缩到"**只覆盖素材卡 608×690**" ⇒ ① 不再与任何 DOM 文字图层重叠
     （引擎 `check` 会把满页画布判成 `text_occluded`）② 画布更小、渲染更快
     ③ 卡内的标注（主视觉区 / 数据面板）改由画布绘制（label()）。
   确定性：画面只由时间轴时间决定；无 rAF / Date.now / Math.random（噪点/故障条用固定种子）。 */
(function () {
  'use strict'
  var DUR = 9
  var W = 608, H = 690                       // ← 画布 = 素材卡尺寸（local 坐标）
  var cv = document.getElementById('fx')
  var ctx = cv.getContext('2d')
  var tcEl = document.getElementById('tc')

  function rnd(i) { var x = Math.sin(i * 113.7 + 71.3) * 43758.5453; return x - Math.floor(x) }
  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x }
  var ease = function (x) { x = clamp01(x); return x * x * (3 - 2 * x) }
  var easeOut = function (x) { x = clamp01(x); return 1 - Math.pow(1 - x, 3) }

  // 两个标注框（local 坐标；固定几何 ⇒ 可复现）
  var BOX = [
    { x: 44, y: 106, w: 300, h: 200, c: '#4df0e4', label: '主视觉区', t0: 0.60 },
    { x: 332, y: 410, w: 224, h: 172, c: '#ff5fa2', label: '数据面板', t0: 1.10 },
  ]

  function clipFrame() {
    ctx.beginPath()
    if (ctx.roundRect) ctx.roundRect(0, 0, W, H, 20)
    else ctx.rect(0, 0, W, H)
    ctx.clip()
  }

  /* 卡内标注（画布绘制：避免 DOM 文字与画布图层的遮挡判据冲突） */
  function label(x, y, text, color) {
    ctx.font = '600 19px NotoSansSC, sans-serif'
    var w = ctx.measureText(text).width + 22
    ctx.fillStyle = 'rgba(5,12,20,.82)'
    ctx.beginPath()
    if (ctx.roundRect) ctx.roundRect(x, y, w, 33, 7)
    else ctx.rect(x, y, w, 33)
    ctx.fill()
    ctx.strokeStyle = color; ctx.globalAlpha = 0.55; ctx.lineWidth = 1; ctx.stroke(); ctx.globalAlpha = 1
    ctx.fillStyle = color
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
    ctx.fillText(text, x + 11, y + 18)
  }

  function brackets(b, p) {
    var seg = Math.min(4, Math.floor(p / 0.25 + 0.0001))
    var segP = clamp01((p - seg * 0.25) / 0.25)
    ctx.strokeStyle = b.c
    ctx.lineWidth = 2.5
    var L = Math.min(b.w, b.h) * 0.28
    function edge(i, prog) {
      var x0, y0, x1, y1
      if (i === 0) { x0 = b.x; y0 = b.y; x1 = b.x; y1 = b.y + L }
      else if (i === 1) { x0 = b.x + b.w; y0 = b.y; x1 = b.x + b.w; y1 = b.y + L }
      else if (i === 2) { x0 = b.x; y0 = b.y; x1 = b.x + L; y1 = b.y }
      else { x0 = b.x; y0 = b.y + b.h; x1 = b.x + L; y1 = b.y + b.h }
      ctx.beginPath(); ctx.moveTo(x0, y0)
      ctx.lineTo(x0 + (x1 - x0) * prog, y0 + (y1 - y0) * prog); ctx.stroke()
    }
    for (var i = 0; i < seg; i++) edge(i, 1)
    if (seg < 4) edge(seg, easeOut(segP))
    ctx.globalAlpha = ease(p)
    function corner(x, y, dx, dy) {
      var L2 = 26
      ctx.beginPath(); ctx.moveTo(x, y + dy * L2); ctx.lineTo(x, y); ctx.lineTo(x + dx * L2, y); ctx.stroke()
    }
    corner(b.x, b.y, 1, 1); corner(b.x + b.w, b.y, -1, 1)
    corner(b.x, b.y + b.h, 1, -1); corner(b.x + b.w, b.y + b.h, -1, -1)
    ctx.globalAlpha = 1
  }

  function draw(t) {
    ctx.clearRect(0, 0, W, H)

    // ① 网格（卡内，很淡）
    var ga = ease((t - 0.15) / 0.7)
    if (ga > 0) {
      ctx.save(); clipFrame(); ctx.globalAlpha = 0.30 * ga
      ctx.strokeStyle = 'rgba(140,225,235,.16)'; ctx.lineWidth = 1
      for (var x = 48; x < W; x += 48) { ctx.beginPath(); ctx.moveTo(x + .5, 0); ctx.lineTo(x + .5, H); ctx.stroke() }
      for (var y = 48; y < H; y += 48) { ctx.beginPath(); ctx.moveTo(0, y + .5); ctx.lineTo(W, y + .5); ctx.stroke() }
      ctx.restore()
    }

    // ② 标注框 + 标注文字
    for (var i = 0; i < BOX.length; i++) {
      var p = easeOut((t - BOX[i].t0) / 1.0)
      if (p > 0.001) {
        brackets(BOX[i], p)
        if (p > 0.72) { ctx.save(); clipFrame(); ctx.globalAlpha = ease((p - 0.72) / 0.28); label(BOX[i].x, BOX[i].y - 36, BOX[i].label, BOX[i].c); ctx.restore() }
      }
    }

    // ③ 扫描线（卡内循环）
    var sy = ((t * 0.62) % 1.35) * (H + 240) - 120
    ctx.save(); clipFrame()
    var sg = ctx.createLinearGradient(0, sy - 120, 0, sy + 120)
    sg.addColorStop(0, 'rgba(77,240,228,0)')
    sg.addColorStop(0.5, 'rgba(77,240,228,.16)')
    sg.addColorStop(1, 'rgba(77,240,228,0)')
    ctx.fillStyle = sg; ctx.fillRect(0, sy - 120, W, 240)
    ctx.strokeStyle = 'rgba(200,255,252,.55)'; ctx.lineWidth = 1.4
    ctx.beginPath(); ctx.moveTo(0, sy + .5); ctx.lineTo(W, sy + .5); ctx.stroke()
    ctx.restore()

    // ④ 噪点（固定种子 ⇒ 可复现）
    ctx.save(); clipFrame(); ctx.globalAlpha = 0.05
    for (var q = 0; q < 380; q++) {
      var qx = (rnd(q) * W + t * 7) % W, qy = rnd(q + 9000) * H
      ctx.fillStyle = q % 5 === 0 ? '#4df0e4' : '#cfe9f5'
      ctx.fillRect(qx, qy, 1.3, 1.3)
    }
    ctx.restore()

    // ⑤ 轻微故障条（每 3.2s 出现 0.14s）
    var ph = t % 3.2
    if (ph < 0.14) {
      var k = ph / 0.14
      var by = 96 + Math.floor(rnd(Math.floor(t * 25)) * (H - 200))
      ctx.save(); clipFrame()
      ctx.globalAlpha = 0.42 * (1 - k)
      ctx.fillStyle = 'rgba(255,95,162,.30)'; ctx.fillRect(0, by, W, 7)
      ctx.fillStyle = 'rgba(77,240,228,.26)'; ctx.fillRect(0, by + 13, W, 5)
      ctx.fillStyle = 'rgba(255,255,255,.10)'; ctx.fillRect(0, by + 24, W, 22)
      ctx.restore()
    }
  }

  // ---- 时间码（确定性：由 t 反推 25fps 时间码）----
  function paintTC(t) {
    var f = Math.floor((t % 1) * 25)
    var s = Math.floor(t) % 60
    var m = Math.floor(t / 60)
    tcEl.textContent = '00:' + (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s + ':' + (f < 10 ? '0' : '') + f
  }

  var cur = 0
  function ready() {
    if (document.fonts && document.fonts.load) {
      Promise.all([
        document.fonts.load('800 58px NotoSansSC'),
        document.fonts.load('600 19px NotoSansSC'),
      ]).then(function () { draw(cur) }, function () {})
    }
  }

  var tl = gsap.timeline({ paused: true })
  var proxy = { t: 0 }
  tl.to(proxy, {
    t: DUR, duration: DUR, ease: 'none',
    onUpdate: function () { cur = proxy.t; draw(cur); paintTC(cur) },
  }, 0)

  // ★ Ken Burns：素材"活"起来（B-roll 的基本盘 —— 画面不僵死）
  tl.fromTo('#shot', { scale: 1.0, x: 0, y: 0 }, { scale: 1.075, x: -12, y: -16, duration: DUR, ease: 'none', immediateRender: true }, 0)

  tl.from('#rec', { opacity: 0, x: -22, duration: 0.7, ease: 'power2.out' }, 0.22)
  tl.from('#live', { opacity: 0, y: -16, duration: 0.6, ease: 'power2.out' }, 0.34)

  tl.from('#title', { opacity: 0, y: 34, duration: 0.85, ease: 'power3.out' }, 2.06)
  tl.from('#sub', { opacity: 0, y: 22, duration: 0.8, ease: 'power3.out' }, 2.30)
  tl.from('.chip', { opacity: 0, y: 30, duration: 0.75, stagger: 0.14, ease: 'power3.out' }, 2.56)
  tl.from('#foot', { opacity: 0, duration: 0.8, ease: 'power2.out' }, 3.10)

  tl.to('#rec .blink', { opacity: 0.25, duration: 0.45, ease: 'none', repeat: -1, yoyo: true }, 0)
  tl.fromTo('#barIn', { scaleX: 0 }, { scaleX: 1, duration: DUR, ease: 'none', immediateRender: true }, 0)

  tl.eventCallback('onStart', function () { draw(0); paintTC(0) })
  window.__timelines['main'] = tl
  draw(0); paintTC(0); ready()
})()
