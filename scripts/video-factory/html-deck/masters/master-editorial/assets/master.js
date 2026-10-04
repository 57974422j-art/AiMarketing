/* ============================================================
   master-v1 · 动效语言（四页共用同一组动作，只是顺序不同）
   契约：window.__timelines["main"] = gsap.timeline({paused:true})
   全部时长/节奏从 CSS 变量读 → 改 CSS 即改节奏（见 PARAMS.md）
   ★ 坑：不带 .clip 的普通子元素照常用；带 .clip 的会被引擎移出文档流
   ============================================================ */
(function () {
  var cs = getComputedStyle(document.documentElement);
  var num = function (k, d) { var v = parseFloat(cs.getPropertyValue(k)); return isNaN(v) ? d : v; };
  var ENTER = num('--enter', .72);       // 单元素入场时长
  var GAP = num('--enter-gap', .55);     // 错峰间隔（未在 data-at 里写死时用于自动排布）
  var XOVER = num('--xover', .5);        // 页间转场
  var PAGE = num('--page', 3);           // 单页时长
  var ROLL = num('--roll', 1.6);         // 数字滚动
  var PUSH = num('--push', 1.4);         // 素材缓推
  var DRIFT = num('--drift', 12);        // 页内持续微动幅度
  var CHART = num('--chart', 1.1);       // 图表元素生长时长（柱/折线/占比）
  var STRIP_N = 21;                      // 数字滚筒格子数（0-9 两轮 + 收尾 0）
  var STEPP = 100 / STRIP_N;             // 每格占滚筒高度的百分比（yPercent 与字号无关）

  // 生成数字滚筒内容（0..9, 0..9, 0）
  document.querySelectorAll('.strip').forEach(function (st) {
    if (st.children.length) return;
    var html = '';
    for (var i = 0; i < STRIP_N; i++) html += '<span>' + (i % 10) + '</span>';
    st.innerHTML = html;
  });

  var pages = Array.prototype.slice.call(document.querySelectorAll('.page'));
  var tl = gsap.timeline({ paused: true });

  // ---------- 全局层：极轻的暖光缓慢漂移（整片内往返，确定性可 seek） ----------
  // ★ 时长由"页数 × 单页"推出（而不是写死 12s），这样生成器可以出任意页数的 deck。
  //   4 页 × 3s = 12s → 与母版原行为逐帧一致（HALF=6s，两段各 6s）。
  var TOTAL = PAGE * pages.length;
  var HALF = TOTAL / 2;
  var glow = document.querySelector('.glow');
  if (glow) {
    tl.fromTo(glow, { x: 0, y: 0 }, { x: 26, y: -18, duration: HALF, ease: 'sine.inOut', immediateRender: true }, 0)
      .to(glow, { x: 0, y: 0, duration: HALF, ease: 'sine.inOut' }, HALF);
  }

  var first = 0, last = pages.length - 1;

  pages.forEach(function (pg, i) {
    var S = i * PAGE;                              // 本页时间原点
    var fadeInAt = S - XOVER / 2;
    var fadeOutAt = S + PAGE - XOVER / 2;

    // ---------- 页间转场：淡入 + 缓推（不是硬切） ----------
    if (i === first) {
      tl.set(pg, { opacity: 1, y: 0 }, 0);
    } else {
      tl.fromTo(pg, { opacity: 0, y: 18 },
        { opacity: 1, y: 0, duration: XOVER, ease: 'power2.out', immediateRender: true }, fadeInAt);
    }
    if (i !== last) {
      tl.to(pg, { opacity: 0, y: -14, duration: XOVER, ease: 'power2.in' }, fadeOutAt);
    }

    // ---------- 页内持续微动：纹理层整页缓慢上移 ----------
    var tex = pg.querySelector('.tex');
    if (tex) tl.fromTo(tex, { y: 0 }, { y: -DRIFT, duration: PAGE, ease: 'none', immediateRender: true }, S);

    // ---------- 底部细进度线：走完本页 ----------
    var bar = pg.querySelector('.progress > i');
    if (bar) tl.fromTo(bar, { scaleX: 0 }, { scaleX: 1, duration: PAGE, ease: 'none', immediateRender: true }, S);

    // ---------- 元素分层错峰入场 ----------
    var order = 0;
    pg.querySelectorAll('[data-anim]').forEach(function (el) {
      var at = el.hasAttribute('data-at') ? S + parseFloat(el.getAttribute('data-at')) : S + 0.35 + order * GAP;
      order++;
      var kind = el.getAttribute('data-anim');
      if (kind === 'rule') {
        tl.fromTo(el, { scaleX: 0 }, { scaleX: 1, duration: .7, ease: 'power2.out', immediateRender: true }, at);
      } else if (kind === 'fade') {
        tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: ENTER, ease: 'power2.out', immediateRender: true }, at);
      } else if (kind === 'push') {          /* ★ SKIN(editorial)：素材缓推 ⇒ **左→右纸面擦显 + 缓推**
                                                 （皮肤重新解释动作词汇 ⇒ 生成器零改动 ⇒ v1/v2 输出逐字节不变） */
        tl.fromTo(el, { opacity: 0, scale: 1.05, clipPath: 'inset(0 100% 0 0)' },
          { opacity: 1, scale: 1, clipPath: 'inset(0 0% 0 0)', duration: PUSH * 1.25, ease: 'power3.out', immediateRender: true }, at);
      } else if (kind === 'roll') {          // 数字滚筒（纯 transform，逐帧确定性）
        tl.fromTo(el, { yPercent: 0 },
          { yPercent: -1 * parseFloat(el.getAttribute('data-roll-steps')) * STEPP,
            duration: ROLL, ease: 'power3.out', immediateRender: true }, at);
      } else if (kind === 'bar') {           // 图表·柱：从底部生长（纯 transform ⇒ 逐帧可 seek）
        tl.fromTo(el, { scaleY: 0 },
          { scaleY: 1, duration: CHART, ease: 'power2.out', immediateRender: true }, at);
      } else if (kind === 'line') {          // 图表·折线：整条 polyline 收线（长度用 getTotalLength 实测）
        var L = 0;
        try { if (el.getTotalLength) L = el.getTotalLength(); } catch (e) { L = 0; }
        if (!isFinite(L) || L <= 0) L = parseFloat(el.getAttribute('data-len') || '800');
        el.style.strokeDasharray = L + 'px';
        tl.fromTo(el, { strokeDashoffset: L },
          { strokeDashoffset: 0, duration: CHART, ease: 'power2.out', immediateRender: true }, at);
      } else if (kind === 'dash') {          // 图表·占比环每一片：dasharray/dashoffset 由生成器算好写在属性上
        var arr = el.getAttribute('data-dash') || '';
        var off = parseFloat(el.getAttribute('data-off') || '0');
        if (arr) el.style.strokeDasharray = arr;
        tl.fromTo(el, { strokeDashoffset: isFinite(off) ? off : 0 },
          { strokeDashoffset: 0, duration: CHART, ease: 'power2.out', immediateRender: true }, at);
      } else if (kind === 'slideL') {        // 对比页：左栏自左侧滑入
        tl.fromTo(el, { opacity: 0, x: -28 },
          { opacity: 1, x: 0, duration: ENTER, ease: 'power2.out', immediateRender: true }, at);
      } else if (kind === 'slideR') {        // 对比页：右栏自右侧滑入
        tl.fromTo(el, { opacity: 0, x: 28 },
          { opacity: 1, x: 0, duration: ENTER, ease: 'power2.out', immediateRender: true }, at);
      } else {                               /* ★ SKIN(editorial)：默认 rise ⇒ **纸面裁切揭示**（clip 左→右 + 轻上移）
                                                 比"整体淡入上浮"更有编辑感，且纯 transform/clip ⇒ 逐帧可 seek */
        tl.fromTo(el, { opacity: 0, clipPath: 'inset(0 100% 0 0)', y: 12 },
          { opacity: 1, clipPath: 'inset(0 0% 0 0)', y: 0, duration: ENTER * 1.15, ease: 'power3.out', immediateRender: true }, at);
      }
    });
  });

  window.__timelines = window.__timelines || {};
  window.__timelines['main'] = tl;
  tl.seek(0);
})();
