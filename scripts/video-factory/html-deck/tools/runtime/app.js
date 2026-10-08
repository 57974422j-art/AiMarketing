/* ★VF_PACKPREVIEW_V1 —— 「风格包试片」运行时
   =============================================================================
   作用：把一份风格包（tokens + structure + motion）渲染成一段 **3 秒试片**，
        让用户在管理器页面里"点一下就看到效果"，不用懂代码。
   架构（这也是批次 2.1「scene 页型」的雏形）：
     · pack-to-page.mjs 负责"生成 HTML（结构 + 令牌 = CSS 变量）"
     · 本文件负责"动效 + Canvas 背景"：读 window.__CFG__，按 structure 播对应时间线
   ★ 确定性：只由时间轴时间决定（无 rAF / Date.now / Math.random，随机用固定种子）⇒ 可复现
   ★ 素材是**占位**（渐变块）：试片看的是"风格"，不是"内容" —— 所以预览页零外部图片、永远能渲。
   ============================================================================= */
(function () {
  'use strict'
  var CFG = window.__CFG__ || { tokens: {}, structure: 'opening-hero', pace: 1 }
  var DUR = 3.0
  var W = 720, H = 1280
  var cv = document.getElementById('prebg')
  var ctx = cv && cv.getContext('2d')

  function rnd(i) { var x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x) }
  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x }
  var ease = function (x) { x = clamp01(x); return x * x * (3 - 2 * x) }
  var easeOut = function (x) { x = clamp01(x); return 1 - Math.pow(1 - x, 3) }
  function rgba(hex, a) {
    var h = String(hex || '#000').replace('#', '')
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
    var n = parseInt(h.slice(0, 6), 16) || 0
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')'
  }
  var T = CFG.tokens || {}
  var light = (function () {   // 亮底还是深底：用 ink/bg 的明度差判断（决定网格/粒子的颜色）
    function lum(c) { var h = String(c || '#000').replace('#', ''); if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]; var n = parseInt(h.slice(0, 6), 16) || 0; return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255 }
    return lum(T.bg) > 0.6
  })()

  var DOTS = []
  for (var i = 0; i < 70; i++) DOTS.push({ x: rnd(i) * W, y: rnd(i + 300) * H, r: 0.7 + rnd(i + 600) * 1.3, ph: rnd(i + 900) * 6.2832, sp: 0.1 + rnd(i + 1200) * 0.3 })

  function draw(t) {
    if (!ctx) return
    ctx.clearRect(0, 0, W, H)
    var g = ctx.createLinearGradient(0, 0, W * 0.4, H)
    g.addColorStop(0, T.bg || '#0b0f1a')
    g.addColorStop(1, T.bg2 || T.bg || '#0b0f1a')
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)

    // 光斑（两团缓慢漂移；亮底用更淡的 alpha）
    var a1 = light ? 0.10 : 0.22
    blob(160 + Math.sin(t * 0.9) * 60, 320 + Math.cos(t * 0.8) * 50, 460, T.accent || '#4dd7ff', a1)
    blob(580 + Math.cos(t * 0.7) * 60, 960 + Math.sin(t * 0.85) * 70, 500, T.accent || '#4dd7ff', a1 * 0.8)

    // 网格
    ctx.save()
    ctx.globalAlpha = light ? 0.10 : 0.13
    ctx.strokeStyle = light ? 'rgba(20,26,34,.5)' : 'rgba(180,210,255,.35)'
    ctx.lineWidth = 1
    for (var x = 60; x < W; x += 60) { ctx.beginPath(); ctx.moveTo(x + .5, 0); ctx.lineTo(x + .5, H); ctx.stroke() }
    for (var y = 60; y < H; y += 60) { ctx.beginPath(); ctx.moveTo(0, y + .5); ctx.lineTo(W, y + .5); ctx.stroke() }
    ctx.restore()

    // 粒子
    ctx.save()
    for (var k = 0; k < DOTS.length; k++) {
      var d = DOTS[k]
      var y = (d.y - t * (10 + d.sp * 30) % H + H * 3) % H
      ctx.globalAlpha = (light ? 0.10 : 0.16) + 0.22 * (0.5 + 0.5 * Math.sin(t * 1.6 + d.ph))
      ctx.fillStyle = T.accent || '#4dd7ff'
      ctx.beginPath(); ctx.arc(d.x + Math.sin(t * d.sp * 3 + d.ph) * 8, y, d.r, 0, 6.2832); ctx.fill()
    }
    ctx.restore()

    // 扫描线（数据大屏结构才有）
    if (CFG.structure === 'data-dashboard') {
      var sy = ((t * 0.9) % 1.3) * (H + 240) - 120
      var sg = ctx.createLinearGradient(0, sy - 120, 0, sy + 120)
      sg.addColorStop(0, rgba(T.accent, 0)); sg.addColorStop(0.5, rgba(T.accent, 0.16)); sg.addColorStop(1, rgba(T.accent, 0))
      ctx.fillStyle = sg; ctx.fillRect(0, sy - 120, W, 240)
    }
  }
  function blob(cx, cy, r, color, a) {
    var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
    g.addColorStop(0, rgba(color, a)); g.addColorStop(0.55, rgba(color, a * 0.4)); g.addColorStop(1, rgba(color, 0))
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
  }

  var cur = 0
  var tl = gsap.timeline({ paused: true })
  var proxy = { t: 0 }
  tl.to(proxy, { t: DUR, duration: DUR, ease: 'none', onUpdate: function () { cur = proxy.t; draw(cur) } }, 0)
  var P = (CFG.pace || 1)          // pace>1 = 更慢

  function enterAt(sel, at, extra) {
    if (!document.querySelector(sel)) return
    tl.from(sel, Object.assign({ duration: 0.6 * P, ease: 'power3.out' }, extra || { opacity: 0, y: 26 }), at * P)
  }

  var S = CFG.structure
  var Q = function (s) { return document.querySelector(s) }

  if (S === 'opening-hero') {
    tl.fromTo('#ew', { opacity: 0, y: -10 }, { opacity: 1, y: 0, duration: 0.5 * P, ease: 'power2.out', immediateRender: true }, 0.10 * P)
    tl.fromTo('#t1', { clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)', duration: 0.75 * P, ease: 'power3.out', immediateRender: true }, 0.28 * P)
    tl.fromTo('#t2', { clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)', duration: 0.75 * P, ease: 'power3.out', immediateRender: true }, 0.46 * P)
    tl.fromTo('#sub', { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.6 * P, ease: 'power2.out', immediateRender: true }, 0.80 * P)
    tl.fromTo('#media', { x: 200, rotate: 10, opacity: 0 }, { x: 0, rotate: -4, opacity: 1, duration: 0.9 * P, ease: 'power3.out', immediateRender: true }, 0.55 * P)
    tl.to('#media', { y: -8, duration: 1.2 * P, ease: 'sine.inOut' }, 1.7 * P)
  } else if (S === 'works-wall') {
    tl.fromTo('#ttl', { opacity: 0, y: 22 }, { opacity: 1, y: 0, duration: 0.6 * P, ease: 'power3.out', immediateRender: true }, 0.12 * P)
    tl.fromTo('#sub', { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.55 * P, ease: 'power2.out', immediateRender: true }, 0.28 * P)
    tl.fromTo('.cd', { opacity: 0, y: 44, rotate: 0 }, { opacity: 1, y: 0, rotate: 0, duration: 0.7 * P, stagger: 0.12 * P, ease: 'power3.out', immediateRender: true }, 0.42 * P)
    tl.to('.cd', { y: -7, duration: 1.1 * P, stagger: 0.1, ease: 'sine.inOut' }, 1.6 * P)
    tl.fromTo('#r1', { opacity: 0, x: -18 }, { opacity: 1, x: 0, duration: 0.5 * P, stagger: 0.12 * P, ease: 'power2.out', immediateRender: true }, 1.0 * P)
  } else if (S === 'glass-product') {
    tl.fromTo('#ew', { opacity: 0, y: -10 }, { opacity: 1, y: 0, duration: 0.5 * P, ease: 'power2.out', immediateRender: true }, 0.10 * P)
    tl.fromTo('#ttl', { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.7 * P, ease: 'power3.out', immediateRender: true }, 0.24 * P)
    tl.fromTo('#sub', { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.6 * P, ease: 'power2.out', immediateRender: true }, 0.44 * P)
    tl.fromTo('#main', { opacity: 0, y: 40, scale: .98 }, { opacity: 1, y: 0, scale: 1, duration: 0.8 * P, ease: 'power3.out', immediateRender: true }, 0.62 * P)
    tl.fromTo('#num', { opacity: 0, yPercent: 40 }, { opacity: 1, yPercent: 0, duration: 0.7 * P, ease: 'power3.out', immediateRender: true }, 1.05 * P)
    tl.fromTo('.mini', { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.7 * P, stagger: 0.12 * P, ease: 'power3.out', immediateRender: true }, 1.15 * P)
    tl.fromTo('#cta', { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.7 * P, ease: 'power3.out', immediateRender: true }, 1.5 * P)
    tl.fromTo('#shine', { x: -180 }, { x: 620, duration: 1.1 * P, ease: 'power2.inOut', repeat: -1, repeatDelay: 0.8, immediateRender: true }, 1.9 * P)
  } else if (S === 'data-dashboard') {
    tl.fromTo('.k', { opacity: 0, y: -10 }, { opacity: 1, y: 0, duration: 0.5 * P, ease: 'power2.out', immediateRender: true }, 0.10 * P)
    tl.fromTo('#t1', { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.65 * P, ease: 'power3.out', immediateRender: true }, 0.24 * P)
    tl.fromTo('#ex', { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.55 * P, ease: 'power2.out', immediateRender: true }, 0.46 * P)
    tl.fromTo('#num', { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.7 * P, ease: 'power3.out', immediateRender: true }, 0.62 * P)
    tl.fromTo('#ringArc', { strokeDashoffset: 999 }, { strokeDashoffset: 999 * 0.215, duration: 1.0 * P, ease: 'power2.out', immediateRender: true }, 0.70 * P)
    tl.fromTo('.cd', { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.65 * P, stagger: 0.14 * P, ease: 'power3.out', immediateRender: true }, 1.05 * P)
  } else {
    // 未实现的结构 ⇒ 回落到 opening-hero 的动效（页面结构由生成器兜底为 opening-hero）
    tl.fromTo('#t1', { opacity: 0, y: 26 }, { opacity: 1, y: 0, duration: 0.7 * P, ease: 'power3.out', immediateRender: true }, 0.2 * P)
  }

  tl.fromTo('#barIn', { scaleX: 0 }, { scaleX: 1, duration: DUR, ease: 'none', immediateRender: true }, 0)

  function ready() {
    if (document.fonts && document.fonts.load) document.fonts.load('900 78px NotoSansSC').then(function () { draw(cur) }, function () {})
  }
  window.__timelines = window.__timelines || {}
  window.__timelines['main'] = tl
  draw(0); ready()
})()
