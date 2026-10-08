#!/usr/bin/env node
/**
 * ★VF_PAGEFONT_V1 —— 「页面级 HTML」的**用字闸门**（与 check-font-coverage.mjs 同级）
 * =============================================================================
 * 为什么必须有（用户 2026-10-08 定："这个你定"）：
 *   引擎内嵌字体是**子集**（GB2312 一级 3755 + ASCII + 中英标点，见 `fonts/chars-cmn.txt`）。
 *   缺字时浏览器会**静默回退系统字体** —— 开发机（装了 CJK 字体）永远看不出来，
 *   **服务器上直接渲成豆腐块**（详见 fonts/README.md 的坑 28 / 第六条纪律）。
 *   制式母版的用字是**构造性覆盖**的（字表里专门 union 了我们全部资产文本）；
 *   但「页面级 HTML」是**AI 现写**的，用字不受控 ⇒ 必须在上线前逐字判一次。
 *
 * 与 check-font-coverage.mjs 的分工：
 *   · check-font-coverage.mjs  —— 判 **deck.json 的字段值**是否缺字（制式页链路）
 *   · check-page-fonts.mjs     —— 判 **任意项目的 HTML/JS/CSS 里会渲染的字**是否缺字（可编程页链路）
 *
 * 口径（宁可保守，不可放过）：
 *   1. 只看"**会渲染出来的**"文本：HTML 文本节点 + 属性值；JS 去掉注释后的字符串字面量。
 *   2. 纯 ASCII 一律跳过（ASCII 可见字符 100% 在字表内）。
 *   3. 出字集合里任何一个码点不在字表 ⇒ 退出码 1，并**逐字符列出**与所属文件。
 *
 * 用法：
 *   node check-page-fonts.mjs <项目目录>        # 单个项目（目录内含 index.html 与 assets/）
 *   node check-page-fonts.mjs --all             # 扫描 pages/ 下所有项目
 *   node check-page-fonts.mjs <目录> --json     # 机器可读输出
 *
 * 退出码（与 check-font-coverage.mjs 保持同一约定）：
 *   0 = 覆盖通过   1 = 有缺字   2 = 用法或读取错误
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CHARS = path.join(HERE, 'fonts', 'chars-cmn.txt')

const args = process.argv.slice(2)
const asJson = args.includes('--json')
const all = args.includes('--all')
const target = args.find((a) => !a.startsWith('--'))

if (!all && !target) {
  console.error('用法: node check-page-fonts.mjs <项目目录> | --all  [--json]')
  process.exit(2)
}
if (!fs.existsSync(CHARS)) {
  console.error(`读不到字表: ${CHARS}`)
  process.exit(2)
}

const set = new Set([...fs.readFileSync(CHARS, 'utf8')])
for (const drop of ['\n', '\r', '\uFEFF']) set.delete(drop)

/** 源文件 → "会渲染的字符串"列表 */
function renderedStrings(src, ext) {
  const out = []
  if (ext === '.html' || ext === '.htm') {
    let s = src.replace(/<!--[\s\S]*?-->/g, ' ')
    // ★ 2026-10-08 实测修正（第一次跑就报了一个**误报**：把 `<style>` 里的 CSS 注释
    //   `/* ⚠ ... */` 当成了会渲染的文字 —— 注释里的字永远不会渲出来）。
    //   闸门"报错一次是误报"就会失去信任，所以这里按**内容归属**分别处理：
    //   `<style>` 内容 → 走 CSS 口径（只认 content: 里的字）；`<script>`（内联）内容 → 走 JS 口径。
    const styles = [...s.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1])
    const scripts = [...s.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1])
    const body = s.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    // 文本节点
    for (const m of body.matchAll(/>([^<>]+)</g)) out.push(m[1])
    // 会显示在界面上的属性
    for (const m of body.matchAll(/\b(?:alt|title|placeholder|aria-label|value)\s*=\s*"([^"]*)"/g)) out.push(m[1])
    for (const st of styles) out.push(...renderedStrings(st, '.css'))
    for (const sc of scripts) out.push(...renderedStrings(sc, '.js'))
    return out
  }
  if (ext === '.js' || ext === '.mjs' || ext === '.ts') {
    // 去注释（块注释先删、再删行注释；不追求完美解析，宁严勿松）
    const noComment = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"\\])\/\/[^\n\r]*/g, '$1 ')
    for (const m of noComment.matchAll(/'([^'\\\n]*)'|"([^"\\\n]*)"|`([^`\\]*)`/g)) {
      out.push(m[1] ?? m[2] ?? m[3] ?? '')
    }
    return out
  }
  if (ext === '.css') {
    // CSS 里唯一会渲出文字的只有 content: —— 注释与选择器都不渲染（注释里出现 ⚠ 是**合法**的）
    const noComment = src.replace(/\/\*[\s\S]*?\*\//g, ' ')
    for (const m of noComment.matchAll(/content\s*:\s*'([^']*)'|content\s*:\s*"([^"]*)"/g)) out.push(m[1] ?? m[2] ?? '')
    return out
  }
  return out
}

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'snapshots' || e.name === 'renders') continue
      walk(p, acc)
    } else if (/\.(html?|js|mjs|css)$/i.test(e.name)) acc.push(p)
  }
  return acc
}

function checkProject(dir) {
  const files = walk(dir)
  const miss = {}       // 码点 → { ch, files:Set }
  let seen = 0
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8')
    for (const s of renderedStrings(src, path.extname(f).toLowerCase())) {
      for (const ch of s) {
        if (ch === '\n' || ch === '\r' || ch === '\t') continue
        if (ch.codePointAt(0) < 0x80) continue              // 纯 ASCII 必在字表内
        seen++
        if (!set.has(ch)) {
          const k = ch
          if (!miss[k]) miss[k] = { ch, files: new Set() }
          miss[k].files.add(path.relative(dir, f))
        }
      }
    }
  }
  return { dir, files: files.length, chars: seen, miss: Object.values(miss) }
}

const dirs = all
  ? (fs.existsSync(path.join(HERE, 'pages'))
      ? fs.readdirSync(path.join(HERE, 'pages'), { withFileTypes: true })
          .filter((e) => e.isDirectory())
          .map((e) => path.join(HERE, 'pages', e.name))
      : [])
  : [path.resolve(target)]

if (!dirs.length) {
  console.error('没找到要检查的项目目录')
  process.exit(2)
}

let bad = 0
const results = []
for (const d of dirs) {
  if (!fs.existsSync(d)) { console.error(`目录不存在: ${d}`); process.exit(2) }
  const r = checkProject(d)
  results.push(r)
  if (r.miss.length) bad++
  if (!asJson) {
    const rel = path.relative(HERE, d).replace(/\\/g, '/')
    if (r.miss.length === 0) {
      console.log(`OK   ${rel.padEnd(24)} ${r.files} 个文件 · ${r.chars} 个非 ASCII 字符 全部在字表内`)
    } else {
      console.log(`FAIL ${rel.padEnd(24)} ${r.files} 个文件 · **${r.miss.length} 个表外字**：`)
      for (const m of r.miss) console.log(`       ${m.ch}  ← ${[...m.files].join(', ')}`)
    }
  }
}

if (asJson) console.log(JSON.stringify({ ok: bad === 0, results }, null, 2))
else if (bad) {
  console.log('\n修复：① 改文案避开表外字（首选） ② 或往字表/字体子集里补字后重跑 make-fonts.py（会影响全链路，慎用）')
}
process.exit(bad ? 1 : 0)
