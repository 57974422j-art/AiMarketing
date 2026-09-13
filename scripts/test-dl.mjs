import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const OSS = require('ali-oss')
const env = fs.readFileSync('.env.local', 'utf8')
const g = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim()
const c = new OSS({ region: 'oss-cn-hangzhou', accessKeyId: g('OSS_ACCESS_KEY_ID'), accessKeySecret: g('OSS_ACCESS_KEY_SECRET'), bucket: 'aimarketing-1' })
const LOCAL_STORAGE = 'E:/ai-marketing/storage'
const fu = c.signatureUrl('storage/1/20260807_001.mp4', { expires: 600 })
console.log('URL=' + fu.slice(0, 110))
// 模拟 main.js 的解析
const uu = new URL(fu)
let fn = uu.searchParams.get('name') || decodeURIComponent(uu.pathname.split('/').pop() || '')
fn = String(fn).split('/').filter(Boolean).pop() || ''
console.log('fn=' + fn)
const dest = path.join(LOCAL_STORAGE, fn)
console.log('dest=' + dest + ' 已存在=' + fs.existsSync(dest))
if (!fs.existsSync(dest)) {
  const r = await fetch(fu, {})
  console.log('fetch HTTP=' + r.status)
  if (r.ok) { fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer())); console.log('写入 OK ' + fs.statSync(dest).size + ' bytes') }
} else console.log('本地已有（镜像下过）→ 直接用')
