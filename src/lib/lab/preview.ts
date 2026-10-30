/**
 * ★LAB_DAILY_V1 · 强制注入「预览模式」
 *
 * 为什么要在**接口层**注入，而不是只写进提示词：
 *   这个坑我踩了两次 —— demo 只写了 film 模式 ⇒ 浏览器打开只有第一屏。
 *   让模型"照抄一段 60 行的 CSS+JS"是不可靠的，漏一行就白搭。
 *   ⇒ 这里在落盘前**确定性地**补上，不依赖模型。
 *
 * 注入三样：
 *   ① `<html data-mode="preview">`
 *   ② `<style id="ai-preview-guard">` —— 所有段纵向铺开、可滚动
 *   ③ `<script id="ai-preview-guard-js">` —— 滚到哪段，那段自动播
 *
 * ⚠️ 只影响 `data-mode !== "film"`。出片时引擎会把模式改成 film，这两段整段失效。
 */

export function injectPreviewMode(html: string, w = 720, h = 1280): string {
  let out = String(html || '')

  /* ① data-mode */
  if (!/data-mode\s*=/.test(out)) {
    out = out.replace(/<html\b/i, '<html data-mode="preview"')
  } else {
    /* 已有别的值（比如 AI 自己写了 dark）⇒ 统一改成 preview，避免灰度不可控 */
    out = out.replace(/<html\b([^>]*?)data-mode\s*=\s*["'][^"']*["']/i, '<html$1data-mode="preview"')
  }

  /* ② style guard */
  if (out.indexOf('ai-preview-guard') < 0) {
    const style = '<style id="ai-preview-guard">'
      + ':root{--daily-cw:' + w + 'px;--daily-ch:' + h + 'px}'
      + 'html:not([data-mode="film"]),html:not([data-mode="film"]) body{height:auto!important;overflow-y:auto!important;background:#000}'
      + 'html:not([data-mode="film"]) body>*{height:auto!important;max-height:none!important;overflow:visible!important}'
      + 'html:not([data-mode="film"]) #stage{height:auto!important;overflow:visible!important}'
      + 'html:not([data-mode="film"]) .sec{'
      + 'display:flex!important;visibility:visible!important;position:relative!important;'
      + 'inset:auto!important;left:auto!important;top:auto!important;'
      + 'width:var(--daily-cw,' + w + 'px)!important;height:var(--daily-ch,' + h + 'px)!important;'
      + 'overflow:hidden!important;opacity:1!important;margin:0 auto 12px}'
      + '</style>'
    if (/<\/head>/i.test(out)) out = out.replace(/<\/head>/i, style + '</head>')
    else out = style + out
  }

  /* ③ script guard */
  if (out.indexOf('ai-preview-guard-js') < 0) {
    const script = '<script id="ai-preview-guard-js">(function(){'
      + 'var root=document.documentElement;'
      + 'if(root.getAttribute("data-mode")==="film")return;'
      + 'function boot(){'
      + 'var secs=[].slice.call(document.querySelectorAll(".sec"));'
      + 'if(!secs.length)return;'
      + 'for(var i=0;i<secs.length;i++){'
      + 'var s0=secs[i];s0.style.visibility="visible";'
      + 'if(window.getComputedStyle(s0).display==="none")s0.style.display="flex";'
      + 'var a=s0.parentElement;'
      + 'while(a&&a!==document.body){a.style.overflow="visible";a.style.height="auto";a.style.maxHeight="none";a=a.parentElement;}'
      + 'if(a){a.style.overflowY="auto";a.style.height="auto";}'
      + '}'
      + 'var t0=[],wasIn=[];'
      + 'function tick(){'
      + 'var vh=window.innerHeight||' + h + ';'
      + 'for(var i=0;i<secs.length;i++){'
      + 'var s=secs[i],r=s.getBoundingClientRect();'
      + 'var inView=(r.top<vh*0.85)&&(r.bottom>0);'
      + 'if(inView&&!wasIn[i]){wasIn[i]=true;t0[i]=window.performance.now();}'
      + 'if(!inView){wasIn[i]=false;t0[i]=null;}'
      + 'var du=(+s.dataset.duration||3)*1000;'
      + 'if(wasIn[i]&&t0[i]!=null){'
      + 'var e=(window.performance.now()-t0[i])/du;'
      + 's.style.setProperty("--p",String(Math.min(1,Math.max(0,e))));'
      + '}'
      + '}'
      + 'requestAnimationFrame(tick);'
      + '}'
      + 'tick();'
      + '}'
      + 'if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot);'
      + 'else boot();'
      + '})();</script>'
    if (/<\/body>/i.test(out)) out = out.replace(/<\/body>/i, script + '</body>')
    else out = out + script
  }

  /* ④ 兜底：如果模型没给 .sec 加不透明背景，补一条（否则叠字） */
  if (out.indexOf('ai-preview-guard') >= 0 && !/\.sec\s*\{[^}]*background/.test(out)) {
    const fix = '<style id="ai-preview-guard-fix">.sec{background:#0B0B0B}</style>'
    if (/<\/head>/i.test(out)) out = out.replace(/<\/head>/i, fix + '</head>')
  }

  return out
}
