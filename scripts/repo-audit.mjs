/**
 * 个人仓库体检（只读）：翻页列全 storage/<uid>/，给出
 *   · 真实素材 vs .thumbs 缩略图 各多少、各占多少空间（配额把两者都算进去）
 *   · 孤儿缩略图（源视频已删、缩略图没删 ⇒ 删除没删干净）
 *   · 最近上传 15 个（按时间）+ 今天的素材清单（看有没有"传上去但看不见/序号跳跃")
 * 用法：node temp/_repo/audit.mjs 1
 */
import fs from 'fs'
import OSS from 'ali-oss'

const env = fs.readFileSync('.env.local', 'utf8')
const g = (k) => String(process.env[k] || ((env.match(new RegExp('^' + k + '=(.+)$', 'm')) || [])[1] || '')).trim()
const cfg = { region: g('OSS_REGION'), accessKeyId: g('OSS_ACCESS_KEY_ID'), accessKeySecret: g('OSS_ACCESS_KEY_SECRET'), bucket: g('OSS_BUCKET') }
if (!cfg.region || !cfg.accessKeyId || !cfg.bucket) {
  console.log('本地 .env.local 没有 OSS 配置 ⇒ 这条只能在服务器上跑（命令见回复）')
  process.exit(0)
}
const c = new OSS({ ...cfg, authorizationV4: true, endpoint: 'https://' + cfg.region + '.aliyuncs.com' })
const uid = String(process.argv[2] || '1')
const prefix = 'storage/' + uid + '/'

const all = []
let marker = ''
for (let i = 0; i < 25; i++) {
  const q = { prefix, 'max-keys': 1000 }
  if (marker) q.marker = marker            // 空的 marker 会让 V4 签名不匹配（实测 403 SignatureDoesNotMatch）
  const r = await c.list(q, {})
  all.push(...(r.objects || []))
  if (!r.isTruncated || !r.nextMarker) break
  marker = r.nextMarker
}
const thumbs = all.filter((o) => o.name.includes('/.thumbs/'))
const files = all.filter((o) => !o.name.includes('/.thumbs/'))
const stems = new Set(files.map((o) => o.name.replace(/\.[A-Za-z0-9]+$/, '')))
const orphans = thumbs.filter((t) => !stems.has('storage/' + uid + '/.thumbs/' + t.name.split('/.thumbs/')[1].replace(/\.jpg$/i, '')))
const MB = (n) => (n / 1024 / 1024).toFixed(1)

console.log('前缀 ' + prefix + '（翻页 ' + (marker ? '已启用' : '单页即够') + '）')
console.log('对象总数 ' + all.length + ' · 真实素材 ' + files.length + ' · 缩略图 ' + thumbs.length)
console.log('占用：素材 ' + MB(files.reduce((a, f) => a + f.size, 0)) + 'MB · 缩略图 ' + MB(thumbs.reduce((a, t) => a + t.size, 0)) + 'MB（配额检查把两者都算进去）')
console.log('孤儿缩略图（源已删、缩略图没删）' + orphans.length + ' 个' + (orphans.length ? '：' + orphans.slice(0, 8).map((o) => o.name.split('/.thumbs/')[1]).join(', ') : ''))
const bad = files.filter((o) => !/\/\d{8}_\d{3}\.[A-Za-z0-9]+$/.test(o.name))
console.log('命名规范外的对象 ' + bad.length + ' 个' + (bad.length ? '：' + bad.slice(0, 8).map((o) => o.name.replace(prefix, '')).join(', ') : ''))

console.log('—— 最近上传 15 个（按时间倒序）——')
for (const o of [...files].sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified)).slice(0, 15)) {
  console.log('  ' + new Date(o.lastModified).toISOString().slice(0, 16).replace('T', ' ') + '  ' + String(o.size).padStart(9) + '  ' + o.name.replace(prefix, ''))
}
const today = new Date().toISOString().slice(0, 10).replace(/-/g, '')
const todayFiles = files.filter((o) => o.name.includes('/' + today + '_')).map((o) => o.name.replace(prefix, '')).sort()
console.log('—— 今天的素材（' + todayFiles.length + ' 个）——')
console.log('  ' + todayFiles.join('  '))
const seqs = todayFiles.map((n) => Number((/^(\d{8})_(\d{3})/.exec(n) || [])[2])).filter(Boolean).sort((a, b) => a - b)
if (seqs.length) {
  const dup = seqs.filter((v, i) => i && v === seqs[i - 1])
  console.log('  序号区间 ' + seqs[0] + '~' + seqs[seqs.length - 1] + (dup.length ? ' ⚠️ 有重号：' + dup.join(',') : '') + '（跳跃=中间被删；重号不可能，同 key 会被覆盖）')
}
