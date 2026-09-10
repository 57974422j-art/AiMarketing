import fs from 'fs'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const OSS = require('ali-oss')
const env = fs.readFileSync('.env.local', 'utf8')
const g = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim()
const c = new OSS({ region: g('OSS_REGION') || 'oss-cn-hangzhou', accessKeyId: g('OSS_ACCESS_KEY_ID'), accessKeySecret: g('OSS_ACCESS_KEY_SECRET'), bucket: g('OSS_BUCKET') || 'aimarketing-1' })
// 用法: node scripts/upload-python-bu.mjs [本地zip路径]  默认 public/python-bu.zip
const src = process.argv[2] || 'public/python-bu.zip'
const buf = fs.readFileSync(src)
console.log('上传 ' + src + ' (' + (buf.length / 1048576).toFixed(1) + ' MB) → OSS updates/python-bu.zip')
const r = await c.put('updates/python-bu.zip', buf, { timeout: 900000 })
console.log('✅ 上传完成 HTTP=' + r.res.status)
