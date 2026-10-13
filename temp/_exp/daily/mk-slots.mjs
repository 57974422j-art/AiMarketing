#!/usr/bin/env node
/**
 * temp/_exp/daily/mk-slots.mjs —— 把产物里**每个段位的图槽单独抽出来**排成一页。
 * 为什么：用户报"缺几张图"，但代码里数不出来（图都在、data: 也没被拦）。
 *   只有把"段位 → 图槽"的对应关系**摊平**给人看，才能一次指认是哪几段空。
 * 做法：复用原文件的整段 <style>（含 :root 的 --imgN 与 .fig/.vc 规则），逐段只保留
 *   `<div class="figs ...">…</div>`（把 h2/cols 丢掉），并强制 --sp:1（静止、全展开）。
 *   每段标出：段号 / 结构 / 效果 / 标题 / 图槽类型（img 内嵌 / img 外链 / 切分块 / 无）。
 * 跑法：node temp/_exp/daily/mk-slots.mjs <产物.html> <输出.html>
 */
import fs from 'node:fs'

const [src, out] = process.argv.slice(2)
const html = fs.readFileSync(src, 'utf8')

const style = (html.match(/<style>[\s\S]*?<\/style>/) || [''])[0]
const secs = html.match(/<section class="sec"[\s\S]*?<\/section>/g) || []
console.log('  段数 = ' + secs.length)

const rows = secs.map((s, i) => {
  const seg = (s.match(/data-seg="(\d+)"/) || [, String(i + 1)])[1]
  const layout = (s.match(/data-layout="([^"]*)"/) || [, '-'])[1]
  const fx = (s.match(/data-fx="([^"]*)"/) || [, '-'])[1]
  const form = (s.match(/data-form="([^"]*)"/) || [, '-'])[1]
  const title = ((s.match(/<h2>([\s\S]*?)<\/h2>/) || [, ''])[1] || '')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 26)
  const figs = (s.match(/<div class="figs[^"]*">[\s\S]*?<\/div>\s*(?=<div class="cols|<div class="head|<\/section>)/) || [''])[0]
  const isImg = /<img class="ph"/.test(figs)
  const imgCount = (figs.match(/<img class="ph"/g) || []).length
  const vc = (figs.match(/class="vc"/g) || []).length
  const kinds = [
    isImg ? `img ×${imgCount}（${/src="data:/.test(figs) ? '内嵌' : '外链'}）` : '',
    vc ? `切分块 ×${vc}` : '',
    !isImg && !vc ? '⚠️ 空图槽（没有 img、也没有切分块）' : '',
  ].filter(Boolean).join(' + ')
  const imgsAttr = (s.match(/data-imgs="([^"]*)"/) || [, ''])[1]
  return `<section class="slot">
  <div class="lab"><b>段${seg}</b> ${layout} · ${fx} · ${form} ｜ 标题：${title} ｜ 图槽：${kinds}${imgsAttr ? ' ｜ imgs=' + imgsAttr : ''}</div>
  <div class="stage">${figs || '<i>（这段没有图槽）</i>'}</div>
</section>`
})

const page = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>逐段图槽单独抽出来看</title>
${style}
<style>
  body{background:#0b0b0c;color:#eee;font:14px/1.5 system-ui;padding:14px}
  h1{font-size:18px;margin:0 0 4px} .hint{color:#9aa;font-size:13px;margin:0 0 14px}
  .slot{margin:0 0 18px;border-bottom:1px solid #2a2a2c;padding-bottom:14px}
  .lab{font-size:13px;color:#cfd3d6;margin:0 0 6px}
  .lab b{color:#ffd479}
  .stage{position:relative;width:720px;height:420px;background:#000;overflow:hidden;
         --sp:1; display:grid}
  .stage > .figs{position:relative;width:100%;height:100%;display:grid;grid-template-columns:1fr}
  .stage .fig{height:100%;min-height:0}
</style></head><body>
<h1>逐段图槽（静止态、全部展开）</h1>
<p class="hint">每行 = 一个段位，只留图槽（把标题/信息点去掉了）。<strong>哪几行是黄色/空白底 ⇒ 那几段就是"缺图"。</strong></p>
${rows.join('\n')}
</body></html>`
fs.writeFileSync(out, page, 'utf8')
console.log('  输出：' + out + '（' + Math.round(fs.statSync(out).size / 1024) + 'KB）')
const emptyish = rows.filter((r) => r.includes('空图槽')).length
console.log('  代码层面就"没有图槽"的段 = ' + emptyish)
