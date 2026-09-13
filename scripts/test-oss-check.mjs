import fs from 'fs'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const OSS = require('ali-oss')
// 读 .env.local 的 OSS 配置
const env = fs.readFileSync('.env.local', 'utf8')
const g = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim()
const cfg = { region: g('OSS_REGION') || 'oss-cn-hangzhou', accessKeyId: g('OSS_ACCESS_KEY_ID'), accessKeySecret: g('OSS_ACCESS_KEY_SECRET'), bucket: g('OSS_BUCKET') || 'aimarketing-1' }
console.log('OSS:', cfg.region, cfg.bucket, cfg.accessKeyId ? 'key✓' : 'key✗')
const c = new OSS(cfg)
for (const key of ['storage/1/20260807_001.mp4', 'storage/1/20260821_001.mp4', 'storage/7/20260821_001.mp4']) {
  try {
    const url = c.signatureUrl(key, { expires: 600 })
    const r = await fetch(url, { method: 'HEAD' })
    console.log(key + ' → HTTP ' + r.status + ' (' + (r.headers.get('content-length') || '?') + ' bytes)')
  } catch (e) { console.log(key + ' → 异常 ' + String(e.message).slice(0, 80)) }
}
