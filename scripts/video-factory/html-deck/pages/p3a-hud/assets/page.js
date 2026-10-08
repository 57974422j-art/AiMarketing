/* 阶段 3 原型 A · 深色数据大屏 —— 时间驱动绘制
   ★ 确定性：画面只由 `gsap.timeline({paused:true})` 的当前时间决定（引擎逐帧 seek）。
     不用 requestAnimationFrame / Date.now / Math.random —— 随机用固定种子伪随机，
     同一 t 永远画出同一像素，两次渲染字节级一致。 */
(function () {
  'use strict'
  var DUR = 9, W = 720, H = 1280
  var cv = document.getElementById('fx')
  var ctx = cv.getContext('2d')

  // ---- 固定种子伪随机（可复现）----
  function rnd(i) { var x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x) }
  var DOTS = []
  for (var i = 0; i < 96; i++) {
    DOTS.push({
      x: rnd(i) * W, y: rnd(i + 900) * H,
      r: 0.7 + rnd(i + 300) * 1.5,
      ph: rnd(i + 600) * 6.2832,
      sp: 0.10 + rnd(i + 1200) * 0.34,
    })
  }
  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x }
  var ease = function (x) { x = clamp01(x); return x * x * (3 - 2 * x) }          // smoothstep
  var easeOut = function (x) { x = clamp01(x); return 1 - Math.pow(1 - x, 3) }

  var CX = 360, CY = 470, R = 152

  function draw(t) {
    ctx.clearRect(0, 0, W, H)

    // ① 底色：径向渐层（中心略亮）
    var g = ctx.createRadialGradient(CX, CY - 40, 30, CX, CY - 40, H * 0.78)
    g.addColorStop(0, '#0e1c2e')
    g.addColorStop(0.55, '#0a1422')
    g.addColorStop(1, '#060b14')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)

    // ② 网格：0~0.8s 淡入，整体极淡
    var ga = ease(t / 0.8)
    if (ga > 0) {
      ctx.save()
      ctx.globalAlpha = 0.42 * ga
      ctx.strokeStyle = 'rgba(126,165,205,.10)'
      ctx.lineWidth = 1
      for (var x = 24; x <= W; x += 48) { ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, H); ctx.stroke() }
      for (var y = 24; y <= H; y += 48) { ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); ctx.stroke() }
      ctx.restore()
    }

    // ③ 粒子：缓慢漂移 + 亮度呼吸（确定性）
    ctx.save()
    for (var i = 0; i < DOTS.length; i++) {
      var d = DOTS[i]
      var y = (d.y - t * (6 + d.sp * 16) % H + H * 2) % H
      var x = d.x + Math.sin(t * d.sp + d.ph) * 13
      var a = 0.16 + 0.32 * (0.5 + 0.5 * Math.sin(t * 1.15 + d.ph)) * clamp01(t / 1.2)
      ctx.globalAlpha = a
      ctx.fillStyle = i % 7 === 0 ? '#7ef0e8' : '#9fc4dd'
      ctx.beginPath(); ctx.arc(x, y, d.r, 0, 6.2832); ctx.fill()
    }
    ctx.restore()

    // ④ 扫描线：每 3s 由上至下扫一次（很淡，不抢主体）
    var sy = ((t % 3) / 3) * (H + 260) - 130
    var sg = ctx.createLinearGradient(0, sy - 90, 0, sy + 90)
    sg.addColorStop(0, 'rgba(41,211,201,0)')
    sg.addColorStop(0.5, 'rgba(41,211,201,.055)')
    sg.addColorStop(1, 'rgba(41,211,201,0)')
    ctx.fillStyle = sg
    ctx.fillRect(0, sy - 90, W, 180)

    // ⑤ 生长环：0.35s 起 1.4s 长到 78.5%（数据驱动；环上带刻度与端点光点）
    var p = easeOut((t - 0.35) / 1.4) * 0.785
    var breathe = 1 + 0.008 * Math.sin(t * 1.25)                       // 呼吸：整体极轻微
    ctx.save()
    ctx.translate(CX, CY)
    // 轨道（虚线刻度）
    ctx.globalAlpha = 0.5 * ease(t / 0.9)
    ctx.strokeStyle = 'rgba(150,185,215,.22)'
    ctx.lineWidth = 2
    ctx.setLineDash([2, 10])
    ctx.beginPath(); ctx.arc(0, 0, R + 26, 0, 6.2832); ctx.stroke()
    ctx.setLineDash([])
    // 内轨道
    ctx.globalAlpha = 0.65
    ctx.strokeStyle = 'rgba(150,185,215,.13)'
    ctx.lineWidth = 13
    ctx.beginPath(); ctx.arc(0, 0, R, 0, 6.2832); ctx.stroke()
    ctx.restore()

    if (p > 0.001) {
      ctx.save()
      ctx.translate(CX, CY)
      ctx.scale(breathe, breathe)
      // 光晕
      ctx.globalAlpha = 1
      ctx.shadowColor = 'rgba(41,211,201,.55)'
      ctx.shadowBlur = 22
      ctx.strokeStyle = '#29d3c9'
      ctx.lineWidth = 13
      ctx.lineCap = 'round'
      ctx.beginPath(); ctx.arc(0, 0, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p); ctx.stroke()
      // 端点光点
      var ea = -Math.PI / 2 + Math.PI * 2 * p
      ctx.shadowBlur = 20
      ctx.fillStyle = '#c9fffa'
      ctx.beginPath(); ctx.arc(Math.cos(ea) * R, Math.sin(ea) * R, 6.5, 0, 6.2832); ctx.fill()
      ctx.restore()
    }

    // ⑥ 中心底辉（把大数字"托"起来）
    var cg = ctx.createRadialGradient(CX, CY, 4, CX, CY, 150)
    cg.addColorStop(0, 'rgba(41,211,201,.10)')
    cg.addColorStop(1, 'rgba(41,211,201,0)')
    ctx.fillStyle = cg
    ctx.beginPath(); ctx.arc(CX, CY, 150, 0, 6.2832); ctx.fill()
  }

  // ---- 字体就绪后强制重画一次（避免首帧用回退字体）----
  function ready() {
    if (document.fonts && document.fonts.load) {
      document.fonts.load('800 132px NotoSansSC').then(function () { draw(cur) }, function () {})
    }
  }
  var cur = 0

  // ---- 时间线（paused：由引擎 seek 驱动）----
  var tl = gsap.timeline({ paused: true })
  var proxy = { t: 0 }
  tl.to(proxy, {
    t: DUR, duration: DUR, ease: 'none',
    onUpdate: function () { cur = proxy.t; draw(cur) },
  }, 0)

  tl.from('#kicker .en', { opacity: 0, y: 18, duration: 0.7, ease: 'power3.out' }, 0.10)
  tl.from('#kicker .cn', { opacity: 0, y: 24, duration: 0.8, ease: 'power3.out' }, 0.22)
  tl.fromTo('#kicker .rule', { scaleX: 0 }, { scaleX: 1, duration: 0.7, ease: 'power2.out', immediateRender: true }, 0.42)

  // ★ 只动内层：外层 #numWrap 用 left/top 定位（(64,386)+(592,168) 的中心 = (360,470) 与画布环同心），
  //   一旦对"用 CSS transform 居中的元素"做 GSAP 动画，居中会被 GSAP 写的 transform 冲掉。
  tl.from('#numInner', { yPercent: 118, opacity: 0, duration: 1.05, ease: 'power4.out' }, 0.85)

  tl.from('#title', { opacity: 0, y: 30, duration: 0.85, ease: 'power3.out' }, 1.42)
  tl.from('#explain', { opacity: 0, y: 22, duration: 0.85, ease: 'power3.out' }, 1.64)

  tl.from('.card', { opacity: 0, y: 36, duration: 0.85, stagger: 0.18, ease: 'power3.out' }, 1.92)
  tl.fromTo(['#b1'], { scaleX: 0 }, { scaleX: 0.92, duration: 0.9, ease: 'power2.out', immediateRender: true }, 2.30)
  tl.fromTo(['#b2'], { scaleX: 0 }, { scaleX: 0.48, duration: 0.9, ease: 'power2.out', immediateRender: true }, 2.48)
  tl.fromTo(['#b3'], { scaleX: 0 }, { scaleX: 0.32, duration: 0.9, ease: 'power2.out', immediateRender: true }, 2.66)

  tl.from('#footer', { opacity: 0, duration: 0.9, ease: 'power2.out' }, 2.85)

  // 数字轻微呼吸（长时间停留时画面不死）
  tl.to('#num', { textShadow: '0 0 48px rgba(41,211,201,.62)', duration: 2.6, ease: 'sine.inOut' }, 3.4)
  tl.to('#num', { textShadow: '0 0 30px rgba(41,211,201,.32)', duration: 2.6, ease: 'sine.inOut' }, 6.0)

  tl.fromTo('#barIn', { scaleX: 0 }, { scaleX: 1, duration: DUR, ease: 'none', immediateRender: true }, 0)

  tl.eventCallback('onStart', function () { draw(0) })
  window.__timelines['main'] = tl
  draw(0)
  ready()
})()
