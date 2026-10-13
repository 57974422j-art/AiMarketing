/**
 * ★VF_DAILY_V8 实件验证：拿**真实产物**（用户仓库里那份 gen_*.html）跑一遍 embedImages，
 * 确认 `images/N.jpg` 真的被换成内嵌 data URI、且没把别的引用弄坏。
 * 跑法：node temp/_exp/daily/test-inline.mjs <真实 html 路径> [另存路径]
 */
import fs from 'node:fs'
import { embedImages } from './run/daily-plan.js'

const src = process.argv[2]
const out = process.argv[3] || 'temp/_exp/daily/out/inline.html'
const html = fs.readFileSync(src, 'utf8')

// 1×1 真 JPEG（最小合法图）—— 只为验证"替换与拼接"这个动作，不验证画质
const TINY = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwcJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPDc0NP/bAEMBCQkJDAsMGA0NGDIhHCEyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhBhMUBxUhIhYjMkFiJDM0UYGRQKGxwRUk0fD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8Am/9k='

const imgs = [1, 2, 3, 4, 5, 6].map((n) => ({
  n, mime: 'image/jpeg', b64: TINY, bytes: Math.floor((TINY.length * 3) / 4),
}))
const r = embedImages(html, imgs)
fs.writeFileSync(out, r.html, 'utf8')

const left = (r.html.match(/images\/\d+\.jpg/g) || [])
console.log('  原文件段引用 images/*.jpg 次数 =', (html.match(/images\/\d+\.jpg/g) || []).length)
console.log('  内嵌张数 =', r.embedded, '｜ 跳过 =', r.skipped)
console.log('  内嵌后仍存在的相对引用 =', left.length ? left.join(',') : '（无）')
console.log('  data URI 个数 =', (r.html.match(/data:image\//g) || []).length)
console.log('  产物大小 =', (fs.statSync(out).size / 1024).toFixed(1), 'KB')
