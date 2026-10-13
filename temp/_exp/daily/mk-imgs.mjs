/**
 * temp/_exp/daily/mk-imgs.mjs —— 造 6 张**真 JPEG** 到指定目录的 images/ 下。
 * 用途：闸门里 `img.ph` 只有"图真的加载出来"才存在（缺图会被 onerror 摘掉 ⇒ 越界/压图都测不到）。
 * 跑法：node temp/_exp/daily/mk-imgs.mjs <目标目录>
 */
import fs from 'node:fs'
import path from 'node:path'

const dir = process.argv[2] || 'temp/_exp/daily/out/imgs'
// 1×1 真 JPEG（最小合法图；只验证"加载+测量"，不验证画质）
const TINY = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwcJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPDc0NP/bAEMBCQkJDAsMGA0NGDIhHCEyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhBhMUBxUhIhYjMkFiJDM0UYGRQKGxwRUk0fD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8Am/9k='
const buf = Buffer.from(TINY, 'base64')
fs.mkdirSync(path.join(dir, 'images'), { recursive: true })
for (let i = 1; i <= 6; i++) fs.writeFileSync(path.join(dir, 'images', i + '.jpg'), buf)
console.log('  写好了 6 张：' + path.join(dir, 'images') + '（每张 ' + buf.length + ' 字节）')
