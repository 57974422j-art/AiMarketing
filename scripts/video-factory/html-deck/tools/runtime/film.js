/* ★VF_FILMRUN_V1 —— 「成片」运行时（多段）
   =============================================================================
   读 window.__FILM__（tokens + total + scenes[{structure,start,dur}]），
   在**同一条 gsap 时间线**上按绝对时间摆放每段的动效；段间交叉淡出（不是硬切）。
   ★ 确定性：画面只由时间轴时间决定（无 rAF / Date.now / Math.random；随机用固定种子）。
   ★ 多段约定：段内元素用**类名**，运行时按 `#sc<i> .cls` 在段内查找（多段共用一份 HTML，不许用 id）。
   ============================================================================= */
(function () {
  'use strict'
  var F = window.__FILM__ || { scenes: [], total: 0, tokens: {} }
  var T = F.tokens || {}
  var W = 720, H = 1280
  var cv = document.getElementById('filmBg')
  var ctx = cv && cv.getContext('2d')

  function rnd(i) { var x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x) }
  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x }
  function rgba(hex, a) {
    var h = String(hex || '#000').replace('#', '')
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
    var n = parseInt(h.slice(0, 6), 16) || 0
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')'
  }
  var LIGHT = (function () { var h = String(T.bg || '#000').replace('#', ''); var n = parseInt(h.length === 3 ? h[0] + h[0] + h[1] + h[1] + h[2] + h[2] : h, 16) || 0; return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255 > 0.6 })()

  var DOTS = []
  for (var i = 0; i < 90; i++) DOTS.push({ x: rnd(i) * W, y: rnd(i + 300) * H, r: 0.7 + rnd(i + 600) * 1.4, ph: rnd(i + 900) * 6.2832, sp: 0.1 + rnd(i + 1200) * 0.3 })

  function blob(cx, cy, r, color, a) {
    var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
    g.addColorStop(0, rgba(color, a)); g.addColorStop(0.55, rgba(color, a * 0.4)); g.addColorStop(1, rgba(color, 0))
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
  }

  function drawBg(t) {
    if (!ctx) return
    ctx.clearRect(0, 0, W, H)
    var g = ctx.createLinearGradient(0, 0, W * 0.4, H)
    g.addColorStop(0, T.bg || '#0b0f14')
    g.addColorStop(1, T.bg2 || T.bg || '#0b0f14')
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
    var a1 = LIGHT ? 0.10 : 0.22
    blob(160 + Math.sin(t * 0.11) * 90, 300 + Math.cos(t * 0.13) * 70, 470, T.accent || '#4dd7ff', a1)
    blob(580 + Math.cos(t * 0.09) * 80, 940 + Math.sin(t * 0.12) * 90, 510, T.accent || '#4dd7ff', a1 * 0.85)
    ctx.save()
    ctx.globalAlpha = LIGHT ? 0.10 : 0.13
    ctx.strokeStyle = LIGHT ? 'rgba(20,26,34,.5)' : 'rgba(180,210,255,.35)'
    ctx.lineWidth = 1
    for (var x = 60; x < W; x += 60) { ctx.beginPath(); ctx.moveTo(x + .5, 0); ctx.lineTo(x + .5, H); ctx.stroke() }
    for (var y = 60; y < H; y += 60) { ctx.beginPath(); ctx.moveTo(0, y + .5); ctx.lineTo(W, y + .5); ctx.stroke() }
    ctx.restore()
    ctx.save()
    for (var k = 0; k < DOTS.length; k++) {
      var d = DOTS[k]
      var yy = (d.y - t * (8 + d.sp * 26) % H + H * 3) % H
      ctx.globalAlpha = (LIGHT ? 0.10 : 0.16) + 0.22 * (0.5 + 0.5 * Math.sin(t * 1.1 + d.ph))
      ctx.fillStyle = T.accent || '#4dd7ff'
      ctx.beginPath(); ctx.arc(d.x + Math.sin(t * d.sp + d.ph) * 10, yy, d.r, 0, 6.2832); ctx.fill()
    }
    ctx.restore()
  }

  var cur = 0
  var tl = gsap.timeline({ paused: true })
  var proxy = { t: 0 }
  tl.to(proxy, { t: F.total, duration: F.total, ease: 'none', onUpdate: function () { cur = proxy.t; drawBg(cur) } }, 0)

  /** 每段的动效：按结构类型，用**相对该段起点**的偏移摆放 */
  function sceneAnim(i, sc) {
    var S = sc.start, D = sc.dur, st = sc.structure
    var at = function (f) { return S + D * f }
    var has = function (sel) { return !!document.querySelector('#sc' + i + ' ' + sel) }
    var E = function (sel, f, from, dur, ease) {
      if (!has(sel)) return
      tl.from('#sc' + i + ' ' + sel, Object.assign({ duration: dur || 0.7, ease: ease || 'power3.out' }, from), at(f))
    }
    // ★VF_FILMTRANS_V1（2026-10-10 用户定案「能有转场效果最好」）：
    //   老实现只有"淡入 0.4s + 淡出 0.45s"，而且**淡出走完了下一段才开始** ⇒ 中间有约 2 帧空白
    //   （等于"暗一下再出现"，不是转场）。现口径：**入场与出场重叠**，并按 `sc.trans` 给真转场：
    //     · fade 叠化 ：出入场交叉 0.4s（两页同时可见 ⇒ 真叠化）
    //     · wipe 擦除 ：本段用 clip-path 从左往右推过来盖住上页
    //     · push 推移 ：本段整体从右侧滑入盖住上页
    //     · cut  硬切 ：上页到点立刻消失、本段立刻出现（换场景/换主体的正解）
    //   出场由**下一段的类型**决定：cut ⇒ 到点消失；fade ⇒ 交叉淡出；wipe/push ⇒ 本段不动（等被盖住）。
    var nx = (F.scenes || [])[i + 1]
    var ntr = nx ? String(nx.trans || 'fade') : ''
    var myTr = String(sc.trans || 'fade')
    if (!nx) tl.to('#sc' + i, { opacity: 0, duration: 0.5, ease: 'power2.in' }, S + D - 0.1)
    else if (ntr === 'cut') tl.set('#sc' + i, { opacity: 0 }, S + D)
    else tl.to('#sc' + i, { opacity: 0, duration: 0.5, ease: 'power1.inOut' }, S + D - 0.15)
    // 入场：**从本段起点开始**（不是提前）—— 因为上一段的窗口已被延长 0.7s（见 film-to-page 的 OVER），
    //   这段时间里上一段还在 ⇒ 出入场天然重叠 ~0.5s ⇒ 才是真叠化/真擦除。
    if (myTr === 'cut') {
      tl.set('#sc' + i, { opacity: 0 }, 0)
      tl.set('#sc' + i, { opacity: 1 }, S)
    } else if (myTr === 'wipe') {
      tl.fromTo('#sc' + i, { clipPath: 'inset(0 100% 0 0)' },
        { clipPath: 'inset(0 0% 0 0)', duration: 0.6, ease: 'power2.inOut', immediateRender: true }, S)
    } else if (myTr === 'push') {
      tl.fromTo('#sc' + i, { x: 720 }, { x: 0, duration: 0.6, ease: 'power3.out', immediateRender: true }, S)
    } else {
      tl.fromTo('#sc' + i, { opacity: 0 }, { opacity: 1, duration: 0.55, ease: 'power1.inOut', immediateRender: true }, S)
    }

    if (st === 'opening-hero') {
      E('.eb', 0.03, { opacity: 0, y: -10 }, 0.5, 'power2.out')
      if (has('.t1')) tl.fromTo('#sc' + i + ' .t1', { clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)', duration: 0.75, ease: 'power3.out', immediateRender: true }, at(0.07))
      if (has('.t2')) tl.fromTo('#sc' + i + ' .t2', { clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)', duration: 0.75, ease: 'power3.out', immediateRender: true }, at(0.16))
      E('.sub', 0.30, { opacity: 0, y: 18 }, 0.6, 'power2.out')
      if (has('.media')) {
        tl.fromTo('#sc' + i + ' .media', { x: 220, rotate: 10, opacity: 0 }, { x: 0, rotate: -4, opacity: 1, duration: 0.95, ease: 'power3.out', immediateRender: true }, at(0.20))
        tl.to('#sc' + i + ' .media', { y: -10, duration: D * 0.35, ease: 'sine.inOut' }, at(0.65))
      }
      E('.foot', 0.5, { opacity: 0 }, 0.6, 'power2.out')
    } else if (st === 'works-wall') {
      E('.ttl1', 0.04, { opacity: 0, y: 22 }, 0.65)
      E('.sub', 0.11, { opacity: 0, y: 16 }, 0.6, 'power2.out')
      tl.from('#sc' + i + ' .cd', { opacity: 0, y: 44, duration: 0.75, stagger: 0.13, ease: 'power3.out' }, at(0.16))
      tl.to('#sc' + i + ' .cd', { y: -8, duration: D * 0.3, stagger: 0.1, ease: 'sine.inOut' }, at(0.62))
      tl.from('#sc' + i + ' .row', { opacity: 0, x: -20, duration: 0.6, stagger: 0.14, ease: 'power2.out' }, at(0.42))
      E('.foot', 0.6, { opacity: 0 }, 0.6, 'power2.out')
    } else if (st === 'glass-product') {
      E('.eb', 0.03, { opacity: 0, y: -10 }, 0.5, 'power2.out')
      E('.ttl1', 0.07, { opacity: 0, y: 24 }, 0.7)
      E('.sub', 0.15, { opacity: 0, y: 16 }, 0.6, 'power2.out')
      // ★VF_PLATE_V1（2026-10-10）：这几条**必须判存在** —— 结尾卡只给 title/sub（不给 value/kpi）时
      //   没有 .main / .mini / .cta，老写法直接 gsap 目标不存在 ⇒ 每次出片刷 6 条 console_warning
      //   （引擎 check 里看得见，等于噪声掩盖真问题）。
      if (has('.main')) tl.from('#sc' + i + ' .main', { opacity: 0, y: 40, scale: 0.98, duration: 0.8, ease: 'power3.out' }, at(0.22))
      E('.num', 0.38, { opacity: 0, y: 26 }, 0.7)
      if (has('.mini')) tl.from('#sc' + i + ' .mini', { opacity: 0, y: 30, duration: 0.7, stagger: 0.12, ease: 'power3.out' }, at(0.44))
      if (has('.cta')) tl.from('#sc' + i + ' .cta', { opacity: 0, y: 24, duration: 0.7, ease: 'power3.out' }, at(0.58))
      if (has('.shine')) tl.fromTo('#sc' + i + ' .shine', { x: -180 }, { x: 620, duration: 1.2, ease: 'power2.inOut', repeat: -1, repeatDelay: 0.7, immediateRender: true }, at(0.7))
    } else if (st === 'data-dashboard') {
      E('.k', 0.03, { opacity: 0, y: -10 }, 0.5, 'power2.out')
      E('.t1', 0.08, { opacity: 0, y: 24 }, 0.65)
      E('.ex', 0.16, { opacity: 0, y: 16 }, 0.55, 'power2.out')
      E('.num', 0.24, { opacity: 0, y: 26 }, 0.7)
      if (has('.ringArc')) tl.fromTo('#sc' + i + ' .ringArc', { strokeDashoffset: 999 }, { strokeDashoffset: 999 * 0.215, duration: 1.05, ease: 'power2.out', immediateRender: true }, at(0.28))
      tl.from('#sc' + i + ' .kpi', { opacity: 0, y: 30, duration: 0.65, stagger: 0.14, ease: 'power3.out' }, at(0.44))
      E('.foot', 0.66, { opacity: 0 }, 0.6, 'power2.out')
    } else if (st === 'fullbleed') {
      if (has('.full img')) tl.fromTo('#sc' + i + ' .full img', { scale: 1.05, x: 0 }, { scale: 1.13, x: -14, duration: D, ease: 'none', immediateRender: true }, S)
      tl.from('#sc' + i + ' .scrimT, #sc' + i + ' .scrimB', { opacity: 0, duration: 0.7, ease: 'power2.out' }, at(0.04))
      E('.eb', 0.10, { opacity: 0, y: -10 }, 0.5, 'power2.out')
      E('.ttl', 0.17, { opacity: 0, y: 30 }, 0.8)
      E('.sub', 0.25, { opacity: 0, y: 18 }, 0.65, 'power2.out')
      tl.from('#sc' + i + ' .chip', { opacity: 0, y: 18, duration: 0.55, stagger: 0.1, ease: 'power2.out' }, at(0.34))
      E('.foot', 0.6, { opacity: 0 }, 0.6, 'power2.out')
    } else if (st === 'plate-top' || st === 'plate-bottom') {
      // ★VF_PLATE_V1：完整大图的动效 —— **图绝不缩放**（一缩放就不是"完整"了），
      //   改用"整块照片轻微落定 + 极慢上浮"来给动感。
      E('.eb', 0.03, { opacity: 0, y: -10 }, 0.5, 'power2.out')
      if (has('.plate')) {
        tl.from('#sc' + i + ' .plate', { opacity: 0, y: 30, duration: 0.85, ease: 'power3.out' }, at(0.05))
        tl.to('#sc' + i + ' .plate', { y: -10, duration: Math.max(1.2, D * 0.55), ease: 'sine.inOut' }, at(0.62))
      }
      E('.ttl', 0.14, { opacity: 0, y: 26 }, 0.75)
      E('.sub', 0.24, { opacity: 0, y: 16 }, 0.6, 'power2.out')
      if (has('.chip')) tl.from('#sc' + i + ' .chip', { opacity: 0, y: 16, duration: 0.5, stagger: 0.09, ease: 'power2.out' }, at(0.32))
      E('.foot', 0.58, { opacity: 0 }, 0.6, 'power2.out')
    } else {   // grid-2x2
      E('.ttl1', 0.04, { opacity: 0, y: 22 }, 0.65)
      E('.sub', 0.10, { opacity: 0, y: 16 }, 0.6, 'power2.out')
      tl.from('#sc' + i + ' .g', { opacity: 0, y: 40, scale: 0.97, duration: 0.7, stagger: 0.12, ease: 'power3.out' }, at(0.15))
      tl.from('#sc' + i + ' .n', { opacity: 0, scale: 0.7, duration: 0.45, stagger: 0.09, ease: 'back.out(2)' }, at(0.40))
      E('.tail', 0.55, { opacity: 0, y: 20 }, 0.65, 'power2.out')
      E('.foot', 0.66, { opacity: 0 }, 0.6, 'power2.out')
    }
  }

  ;(F.scenes || []).forEach(function (sc, i) { sceneAnim(i, sc) })
  tl.fromTo('#barIn', { scaleX: 0 }, { scaleX: 1, duration: F.total || 1, ease: 'none', immediateRender: true }, 0)

  function ready() {
    if (document.fonts && document.fonts.load) document.fonts.load('900 78px NotoSansSC').then(function () { drawBg(cur) }, function () {})
  }
  window.__timelines = window.__timelines || {}
  window.__timelines['main'] = tl
  drawBg(0); ready()
})()
