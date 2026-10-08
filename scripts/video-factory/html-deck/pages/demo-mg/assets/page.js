/* MG 演示片 · 「字母散布 / 光点扩散」「素材卡散落 → 收拢成时间线」
   ★ 确定性：画面只由时间轴时间决定；无 rAF / Date.now / Math.random（固定种子）。
   ★ 这条片的核心命题：**造型表现力 = 元素 + 排布规则 + 编排动作**（不是模板）。
     同一批素材、同一条时间轴，只换"排布（错开/倾斜/叠层）"与"动作（散开/收拢）"，观感完全不同。 */
(function () {
  'use strict'
  var DUR = 15, W = 720, H = 1280
  var cv = document.getElementById('bg')
  var ctx = cv.getContext('2d')

  function rnd(i) { var x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x) }
  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x }
  var ease = function (x) { x = clamp01(x); return x * x * (3 - 2 * x) }
  var easeOut = function (x) { x = clamp01(x); return 1 - Math.pow(1 - x, 3) }

  var DOTS = []
  for (var i = 0; i < 90; i++) DOTS.push({ x: rnd(i) * W, y: rnd(i + 500) * H, r: 0.7 + rnd(i + 300) * 1.4, ph: rnd(i + 800) * 6.2832, sp: 0.08 + rnd(i + 1500) * 0.22 })

  /* 光点扩散（镜头组 A 的主角之一）：从中心向四周炸开，半径随 prog 增长、亮度衰减 */
  var BURST = []
  for (var b = 0; b < 130; b++) BURST.push({ a: rnd(b + 2000) * 6.2832, d: 60 + rnd(b + 3000) * 330, s: 0.7 + rnd(b + 4000) * 2.4 })

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
    bg.addColorStop(0, '#05080f'); bg.addColorStop(0.5, '#08101f'); bg.addColorStop(1, '#05070d')
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H)

    blob(170 + Math.sin(t * 0.14) * 80, 300 + Math.cos(t * 0.11) * 60, 470, '80,190,255', 0.20)
    blob(560 + Math.cos(t * 0.12) * 70, 900 + Math.sin(t * 0.10) * 80, 500, '150,120,255', 0.18)

    // 极淡网格
    ctx.save(); ctx.globalAlpha = 0.11
    ctx.strokeStyle = 'rgba(180,210,255,.35)'; ctx.lineWidth = 1
    for (var x = 60; x < W; x += 60) { ctx.beginPath(); ctx.moveTo(x + .5, 0); ctx.lineTo(x + .5, H); ctx.stroke() }
    for (var y = 60; y < H; y += 60) { ctx.beginPath(); ctx.moveTo(0, y + .5); ctx.lineTo(W, y + .5); ctx.stroke() }
    ctx.restore()

    // 常驻粒子（缓慢上漂）
    ctx.save()
    for (var k = 0; k < DOTS.length; k++) {
      var d = DOTS[k]
      var y = (d.y - t * (4 + d.sp * 12) % H + H * 3) % H
      ctx.globalAlpha = 0.10 + 0.24 * (0.5 + 0.5 * Math.sin(t * 0.8 + d.ph))
      ctx.fillStyle = k % 6 === 0 ? '#7ff2ff' : '#a9c6e8'
      ctx.beginPath(); ctx.arc(d.x + Math.sin(t * d.sp + d.ph) * 10, y, d.r, 0, 6.2832); ctx.fill()
    }
    ctx.restore()

    // ★ 光点扩散（0.9–3.0s；画面中心 = 字母所在处）
    var bp = clamp01((t - 0.9) / 2.1)
    if (bp > 0.001 && bp < 0.999) {
      var e = easeOut(bp)
      ctx.save()
      for (var j = 0; j < BURST.length; j++) {
        var p = BURST[j]
        var rr = p.d * e
        var px = 360 + Math.cos(p.a) * rr
        var py = 596 + Math.sin(p.a) * rr * 0.62
        ctx.globalAlpha = (1 - e) * 0.95
        ctx.fillStyle = j % 5 === 0 ? '#ffffff' : '#7ff2ff'
        ctx.beginPath(); ctx.arc(px, py, p.s * (0.55 + e * 0.9), 0, 6.2832); ctx.fill()
      }
      ctx.restore()
    }
  }

  var cur = 0
  function ready() {
    if (document.fonts && document.fonts.load) {
      Promise.all([document.fonts.load('900 88px NotoSansSC'), document.fonts.load('600 22px NotoSansSC')])
        .then(function () { drawBg(cur) }, function () {})
    }
  }

  var tl = gsap.timeline({ paused: true })
  var proxy = { t: 0 }
  tl.to(proxy, { t: DUR, duration: DUR, ease: 'none', onUpdate: function () { cur = proxy.t; drawBg(cur) } }, 0)

  // ---------------- 段间交叉淡入淡出 ----------------
  tl.fromTo('#s1', { opacity: 0 }, { opacity: 1, duration: 0.4, ease: 'power2.out', immediateRender: true }, 0.05)
  tl.to('#s1', { opacity: 0, duration: 0.5, ease: 'power2.in' }, 3.30)
  tl.fromTo('#s2', { opacity: 0 }, { opacity: 1, duration: 0.5, ease: 'power2.out', immediateRender: true }, 3.45)
  tl.to('#s2', { opacity: 0, duration: 0.5, ease: 'power2.in' }, 11.95)
  tl.fromTo('#s3', { opacity: 0 }, { opacity: 1, duration: 0.5, ease: 'power2.out', immediateRender: true }, 12.15)
  tl.to('#s3', { opacity: 0, duration: 0.5, ease: 'power2.in' }, 14.55)

  // ---------------- 镜头组 A：字母散布 ----------------
  tl.from('#s1 .tag', { opacity: 0, y: -10, duration: 0.6, ease: 'power2.out' }, 0.10)
  var LTS = gsap.utils.toArray('#letters .lt')
  LTS.forEach(function (el, i) {
    // 先在中心聚拢出现
    tl.fromTo(el, { x: 0, y: 0, rotate: 0, rotateY: 0, scale: .82, opacity: 0 },
      { scale: 1, opacity: 1, duration: 0.55, ease: 'power2.out', immediateRender: true }, 0.18 + i * 0.03)
    // 再**错开散向四周**（3D 透视 + 随机方向/距离/旋转；固定种子 ⇒ 可复现）
    // ★ 实测修正：第 1 版半径 130~380 ⇒ 字母飞出画布（画面里只剩几个字，观感反而变差）。
    //   收紧到 70~150 并压缩纵向量 ⇒ 全部字母留在安全区内，"散开"仍然一眼可见。
    var ang = rnd(i + 20) * 6.2832
    var dist = 70 + rnd(i + 120) * 80
    tl.to(el, {
      x: Math.cos(ang) * dist,
      y: Math.sin(ang) * dist * 0.72,
      rotate: (rnd(i + 220) - 0.5) * 44,
      rotateY: (rnd(i + 320) - 0.5) * 96,
      scale: 0.9 + rnd(i + 420) * 0.24,
      duration: 1.6, ease: 'power3.out',
    }, 0.85 + i * 0.045)
  })
  tl.from('#s1 .cap', { opacity: 0, y: 16, duration: 0.7, ease: 'power2.out' }, 2.55)

  // ---------------- 镜头组 B：素材卡散落 → 收拢成时间线 ----------------
  // 散落：位置错开 + 轻微倾斜（照抄博主的三条规则）
  // ★ 散落位置：y 一律 ≥400 —— 改前 #k2 在 y=312 会**压住标题**（引擎 `check` 判 `text_occluded`，
  //   实测 4.17–5.83s 命中）。素材卡属于"02 中间动画层"，标题属于"04 文字层" ⇒ **层不能打架**，
  //   这是博主那条视频里"分层组合、时序独立"的具体落地：素材层不许压文字层。
  var CARDS = [
    { id: '#k1', sx: 56, sy: 420, rot: -9 },
    { id: '#k2', sx: 300, sy: 400, rot: 6 },
    { id: '#k3', sx: 484, sy: 452, rot: -5 },
    { id: '#k4', sx: 120, sy: 660, rot: 7 },
    { id: '#k5', sx: 364, sy: 620, rot: -4 },
  ]
  var SC = 112 / 180                      // 收拢后的缩放（180 → 112）
  var GY = 560, GX0 = 56, GSTEP = 122     // 收拢后的位置：等距排成一条线

  tl.from('#s2 .ttl', { opacity: 0, y: 22, duration: 0.7, ease: 'power3.out' }, 3.55)
  CARDS.forEach(function (c, i) {
    tl.fromTo(c.id, { x: c.sx, y: c.sy + 80, rotate: 0, scale: 1, opacity: 0 },
      { x: c.sx, y: c.sy, rotate: c.rot, scale: 1, opacity: 1, duration: 0.85, ease: 'power3.out', immediateRender: true }, 3.70 + i * 0.12)
  })
  tl.fromTo('#s2 .ruleA', { scaleX: 0 }, { scaleX: 1, duration: 0.6, ease: 'power2.out', immediateRender: true }, 4.60)
  tl.fromTo('#s2 .ruleB', { scaleX: 0 }, { scaleX: 1, duration: 0.6, ease: 'power2.out', immediateRender: true }, 4.72)
  tl.fromTo('#s2 .ruleC', { scaleX: 0 }, { scaleX: 1, duration: 0.6, ease: 'power2.out', immediateRender: true }, 4.84)
  tl.fromTo('#s2 .capA', { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.7, ease: 'power2.out', immediateRender: true }, 4.95)
  tl.to('#s2 .capA', { opacity: 0, duration: 0.5, ease: 'power2.in' }, 7.30)
  // 轻微浮动（长停留不死板）
  CARDS.forEach(function (c, i) {
    tl.to(c.id, { y: c.sy - 8, duration: 1.7, ease: 'sine.inOut' }, 5.60 + i * 0.18)
    tl.to(c.id, { y: c.sy, duration: 1.6, ease: 'sine.inOut' }, 7.30 + i * 0.18)
  })
  tl.fromTo('#s2 .capB', { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.7, ease: 'power2.out', immediateRender: true }, 7.75)

  // ★ 收拢：陆续飞入 → 排成一条时间线（旋转归零、等距对齐）
  CARDS.forEach(function (c, i) {
    tl.to(c.id, {
      x: GX0 + i * GSTEP, y: GY, rotate: 0, scale: SC,
      duration: 1.15, ease: 'power3.inOut',
    }, 8.35 + i * 0.1)
  })
  tl.fromTo('#s2 .tl', { scaleX: 0 }, { scaleX: 1, duration: 0.7, ease: 'power2.out', immediateRender: true }, 9.70)
  // 播放头扫过整条时间线
  tl.fromTo(['#s2 .ph', '#s2 .phd'], { x: 0 }, { x: 552, duration: 1.9, ease: 'none', immediateRender: true }, 10.00)

  // ---------------- 收尾 ----------------
  tl.from('#s3 .brand', { opacity: 0, y: 26, duration: 0.8, ease: 'power3.out' }, 12.30)
  tl.fromTo('#s3 .rule2', { scaleX: 0 }, { scaleX: 1, duration: 0.6, ease: 'power2.out', immediateRender: true }, 12.55)
  tl.from('#s3 .sub2', { opacity: 0, y: 16, duration: 0.7, ease: 'power2.out' }, 12.75)

  tl.fromTo('#barIn', { scaleX: 0 }, { scaleX: 1, duration: DUR, ease: 'none', immediateRender: true }, 0)

  tl.eventCallback('onStart', function () { drawBg(0) })
  window.__timelines['main'] = tl
  drawBg(0)
  ready()
})()
