import fs from 'fs'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const OSS = require('ali-oss')
const env = fs.readFileSync('.env.local', 'utf8')
const g = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim()
const cfg = { region: g('OSS_REGION') || 'oss-cn-hangzhou', accessKeyId: g('OSS_ACCESS_KEY_ID'), accessKeySecret: g('OSS_ACCESS_KEY_SECRET'), bucket: g('OSS_BUCKET') || 'aimarketing-1' }
const c = new OSS(cfg)
// ① 签名 URL 的错误体
const url = c.signatureUrl('storage/1/20260807_001.mp4', { expires: 600 })
const r = await fetch(url)
console.log('签名URL HTTP=' + r.status)
console.log((await r.text()).slice(0, 300))
// ② 用 SDK get（服务器同款方式）
try {
  const res = await c.get('storage/1/20260807_001.mp4')
  console.log('SDK get → OK ' + (res.content?.length || 0) + ' bytes')
} catch (e) { console.log('SDK get → ' + String(e.message).slice(0, 150)) }
// ③ bucket ACL / 权限自检
try {
  const acl = await c.getBucketACL(cfg.bucket)
  console.log('bucket ACL: ' + JSON.stringify(acl.acl))
} catch (e) { console.log('ACL 读取 → ' + String(e.message).slice(0, 100)) }
