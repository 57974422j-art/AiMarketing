#!/usr/bin/env node
/**
 * temp/_exp/daily/mk-plan-v21.mjs —— 造一份**覆盖文字层 × 字号档**的自检方案（★VF_DAILY_V21）。
 * 目的：四种文字层（band/poster/editorial/list）× 四档字号（0.9/1/1.15/1.3）在**三档画幅**下都过闸门
 *   （字号下限、溢出、越界、折行、覆盖率都不能因为"放开文字参数"而破）。
 * 跑法：node temp/_exp/daily/mk-plan-v21.mjs   → 写出 temp/_exp/daily/plan-v21.json
 */
import fs from 'node:fs'
import path from 'node:path'
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))

const LAY = [
  { layout: 'hero', imgs: 1 }, { layout: 'split', imgs: 1 }, { layout: 'vertical', imgs: 1 }, { layout: 'sticker', imgs: 1 },
  { layout: 'grid3', imgs: 3 }, { layout: 'stack2', imgs: 2 }, { layout: 'grid4', imgs: 4 }, { layout: 'quote', imgs: 1 },
]
const TYPES = ['band', 'poster', 'editorial', 'list']
const SCALES = [0.9, 1, 1.15, 1.3]

const segments = []
let n = 0
for (let i = 0; i < 16; i++) {
  const L = LAY[i % LAY.length]
  const imgs = Array.from({ length: L.imgs }, () => ((n++ % 9) + 1))
  segments.push({
    kind: i === 0 ? 'cover' : (i === 15 ? 'end' : 'feature'),
    layout: L.layout,
    type: TYPES[i % TYPES.length],
    scale: SCALES[Math.floor(i / 4) % SCALES.length],
    kicker: `第 ${String(i + 1).padStart(2, '0')} 期 · 文字层自检`,
    stamp: i === 0 ? '封面故事' : '',
    title: [`第${i + 1}段标题`, '现场记录'],
    imgs,
    points: [['实拍', '原图'], ['细节', '特写']],
    place: 'cover',
  })
}
const plan = {
  meta: { issue: '第 21 期', title: '文字层参数化自检', theme: 'night-gold' },
  motion: 'normal',
  imageDir: 'images',
  segments,
}
const out = path.join(HERE, 'plan-v21.json')
fs.writeFileSync(out, JSON.stringify(plan, null, 1), 'utf8')
console.log('  写出 ' + path.relative(process.cwd(), out) + '（' + segments.length + ' 段）')
console.log('  文字层覆盖：' + Array.from(new Set(segments.map((s) => s.type))).join(' / ')
  + ' ｜ 字号档覆盖：' + Array.from(new Set(segments.map((s) => s.scale))).join(' / '))
