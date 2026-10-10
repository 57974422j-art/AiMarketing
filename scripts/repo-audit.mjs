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
// ★修 V2（2026-10-10 首次运行的**假警报**）：孤儿判据原来拼成 storage/<uid>/.thumbs/<stem>（多带了一层
//   .thumbs/）⇒ 永远匹配不上 ⇒ **每个缩略图都被误报成孤儿**（那次报"98 个孤儿"是脚本 bug，不是事实）。
//   正确：拿缩略图基名去比**源对象** storage/<uid>/<stem>。
const srcStems = new Set(files.map((o) => o.name.replace(/\.[A-Za-z0-9]+$/, '')))
const orphans = thumbs.filter((t) => {
  const stem = t.name.split('/.thumbs/')[1].replace(/\.jpg$/i, '')
  return !srcStems.has(prefix + stem)
})
const MB = (n) => (n / 1024 / 1024).toFixed(1)
const videos = files.filter((o) => /\.(mp4|mov|avi|mkv|webm)$/i.test(o.name))
const videoNoThumb = videos.filter((v) => !thumbs.some(
  (t) => t.name.split('/.thumbs/')[1] === v.name.replace(prefix, '').replace(/\.[A-Za-z0-9]+$/, '') + '.jpg'
))
const zero = files.filter((o) => !o.size)

console.log('前缀 ' + prefix + '（翻页 ' + (marker ? '已启用' : '单页即够') + '）')
console.log('对象总数 ' + all.length + ' · 真实素材 ' + files.length + ' · 缩略图 ' + thumbs.length + ' · 视频 ' + videos.length)
console.log('占用：素材 ' + MB(files.reduce((a, f) => a + f.size, 0)) + 'MB · 缩略图 ' + MB(thumbs.reduce((a, t) => a + t.size, 0)) + 'MB（配额检查把两者都算进去）')
console.log('孤儿缩略图（源已删、缩略图没删）' + orphans.length + ' 个' + (orphans.length ? '：' + orphans.slice(0, 10).map((o) => o.name.split('/.thumbs/')[1]).join(', ') : ''))
console.log('视频缺缩略图 ' + videoNoThumb.length + ' 个' + (videoNoThumb.length ? '：' + videoNoThumb.slice(0, 10).map((o) => o.name.replace(prefix, '')).join(', ') : ''))
console.log('⚠️ 0 字节对象 ' + zero.length + ' 个（上传中断/失败留下的半成品：列表里能看见、打不开）'
  + (zero.length ? '：' + zero.map((o) => o.name.replace(prefix, '') + ' @ ' + new Date(o.lastModified).toISOString().slice(0, 16).replace('T', ' ')).join(' | ') : ''))
const genList = files.filter((o) => /^(cover_|ai_|copy_|frame_)/.test(o.name.replace(prefix, '')))
const byKind = {}
for (const o of genList) { const k = o.name.replace(prefix, '').split('_')[0]; byKind[k] = (byKind[k] || 0) + 1 }
console.log('命名规范外的**生成物** ' + genList.length + ' 个（混在个人仓库里 ⇒ 列表与素材池被污染）'
  + (genList.length ? '：' + Object.keys(byKind).sort().map((k) => k + '_* ' + byKind[k] + ' 个').join(' · ') : ''))
const junk = files.filter((o) => !/\/\d{8}_\d{3}\.[A-Za-z0-9]+$/.test(o.name) && !/^(cover_|ai_|copy_|frame_)/.test(o.name.replace(prefix, '')))
console.log('其它不在命名规范内的 ' + junk.length + ' 个' + (junk.length ? '：' + junk.slice(0, 8).map((o) => o.name.replace(prefix, '')).join(', ') : ''))

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
  const miss = []
  for (let v = seqs[0]; v <= seqs[seqs.length - 1]; v++) if (!seqs.includes(v)) miss.push(v)
  console.log('  序号区间 ' + seqs[0] + '~' + seqs[seqs.length - 1] + (dup.length ? ' ⚠️ 有重号：' + dup.join(',') : '') + '（跳跃=中间被删；重号不可能，同 key 会被覆盖）')
  if (miss.length) console.log('  ⚠️ 今天缺号 ' + miss.join(',') + '（被删 or 那次上传失败留下的痕迹）')
}
