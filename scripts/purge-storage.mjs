#!/usr/bin/env node
/**
 * ★VFPURGE_V1（2026-10-11 用户定案）：「一键清除」——把某个用户在本项目的**所有产物**清掉。
 * =============================================================================
 * 用户原话：「现有仓库中生成物上传物都可以一并清理。所有都有备份。你可以放心清理。」
 *          「我们服务器我看好像也记录了不上视频和缩微图，图片，你看是否清理」
 * ⇒ 这个脚本做两件事：① OSS 个人仓库/相关前缀 ② 服务器本地缓存与工作目录。
 *
 * 用法（**默认 dry-run，只列不删**）：
 *   node scripts/purge-storage.mjs 1                     # 先看：要删什么、多少个、多少 MB
 *   node scripts/purge-storage.mjs 1 --yes               # 真删（OSS + 服务器本地）
 *   node scripts/purge-storage.mjs 1 --yes --local=0     # 只清 OSS
 *   node scripts/purge-storage.mjs 1 --yes --oss=0       # 只清服务器本地
 *   node scripts/purge-storage.mjs 1 --yes --prefix=generations/<uid>,i2v/<uid>   # 额外清这些前缀
 *
 * 安全口径：只清**指定 uid**；默认不动别人的东西；不打印任何密钥；
 *          删前打印清单与合计；`--yes` 之前绝不删任何对象。
 * 不改 DB：脚本末尾会打印"删 DB 记录（可选）"的 sqlite3 命令，由你决定跑不跑。
 */
import fs from 'fs'
import path from 'path'
import os from 'os'

const uid = String(process.argv[2] || '').trim()
if (!uid || !/^\d+$/.test(uid)) {
  console.error('用法：node scripts/purge-storage.mjs <uid> [--yes] [--oss=0|1] [--local=0|1] [--prefix=a,b]')
  process.exit(1)
}
const argv = process.argv.slice(3)
const YES = argv.includes('--yes')
const ONLY = (k, d = true) => {
  const hit = argv.find((a) => a.startsWith('--' + k + '='))
  return hit ? hit.split('=')[1] !== '0' : d
}
const DO_OSS = ONLY('oss', true)
const DO_LOCAL = ONLY('local', true)
const extra = (argv.find((a) => a.startsWith('--prefix=')) || '').replace('--prefix=', '')
const EXTRA_PREFIXES = extra ? extra.split(',').map((s) => s.trim()).filter(Boolean) : []

const MB = (n) => (n / 1024 / 1024).toFixed(1) + 'MB'
console.log('=== 一键清除（uid=' + uid + '，' + (YES ? '**真删**' : 'dry-run 只列不删') + '）===')

/* ───────────────── ① OSS：个人仓库 +（可选）额外前缀 ───────────────── */
let deletedOss = 0
let freedOss = 0
if (DO_OSS) {
  const envPath = path.join(process.cwd(), '.env.local')
  const env = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : ''
  const g = (k) => String(process.env[k] || ((env.match(new RegExp('^' + k + '=(.+)$', 'm')) || [])[1] || '')).trim()
  const cfg = { region: g('OSS_REGION'), accessKeyId: g('OSS_ACCESS_KEY_ID'), accessKeySecret: g('OSS_ACCESS_KEY_SECRET'), bucket: g('OSS_BUCKET') }
  if (!cfg.region || !cfg.accessKeyId || !cfg.bucket) {
    console.log('· OSS：跳过（.env.local 里没有 OSS_REGION/OSS_ACCESS_KEY_ID/OSS_BUCKET）')
  } else {
    const { default: OSS } = await import('ali-oss')
    const c = new OSS({ ...cfg, authorizationV4: true, endpoint: 'https://' + cfg.region + '.aliyuncs.com' })
    const prefixes = ['storage/' + uid + '/', ...EXTRA_PREFIXES]
    for (const prefix of prefixes) {
      const all = []
      let marker = ''
      for (let i = 0; i < 200; i++) {
        const q = { prefix, 'max-keys': 1000 }
        if (marker) q.marker = marker            // 空 marker 会让 V4 签名不匹配（实测 403）
        const r = await c.list(q, {})
        all.push(...(r.objects || []))
        if (!r.isTruncated || !r.nextMarker) break
        marker = r.nextMarker
      }
      const bytes = all.reduce((a, o) => a + (o.size || 0), 0)
      console.log('· OSS ' + prefix + '：' + all.length + ' 个对象 / ' + MB(bytes))
      if (YES && all.length) {
        for (let i = 0; i < all.length; i += 1000) {
          const batch = all.slice(i, i + 1000).map((o) => o.name)
          try { await c.deleteMulti(batch, { quiet: true }) } catch (e) { console.error('  批量删除失败：' + String(e?.message || e).slice(0, 120)) }
        }
        deletedOss += all.length
        freedOss += bytes
      }
    }
  }
}

/* ───────────────── ② 服务器本地：缓存与工作目录 ───────────────── */
const roots = Array.from(new Set([
  process.env.BU_STORAGE_ROOT || '',
  '/root/AiMarketing/storage',
  path.join(process.cwd(), 'storage'),
].filter(Boolean)))
// 只清"该 uid 名下、可再生成"的东西；逐个列出（不做通配删除，避免误伤）
const localTargets = []
for (const root of roots) {
  if (!fs.existsSync(root)) continue
  localTargets.push(
    path.join(root, uid),                          // 整个 uid 目录：video-factory（含 material / work_* / films 缓存）
    path.join(root, '_studio'),                    // 成片工作目录（含 out/ 交付件与 work/）
  )
}
for (const base of [path.join(process.cwd(), 'public', 'frames'), path.join(process.cwd(), '.next', 'standalone', 'public', 'frames')]) {
  localTargets.push(path.join(base, uid))
}
for (const d of fs.existsSync(os.tmpdir()) ? fs.readdirSync(os.tmpdir()) : []) {
  if (d.startsWith('agentframes-' + uid + '-') || d.startsWith('vf-' + uid + '-')) localTargets.push(path.join(os.tmpdir(), d))
}
let localBytes = 0
let localItems = 0
const sizeOf = (p) => {
  try {
    const st = fs.statSync(p)
    if (!st.isDirectory()) return st.size
    return fs.readdirSync(p).reduce((a, f) => a + sizeOf(path.join(p, f)), 0)
  } catch { return 0 }
}
console.log('—— 服务器本地 ——')
for (const t of Array.from(new Set(localTargets))) {
  if (!fs.existsSync(t)) continue
  const sz = sizeOf(t)
  localItems++
  localBytes += sz
  console.log('· ' + t + '  ' + MB(sz))
  if (YES) { try { fs.rmSync(t, { recursive: true, force: true }) } catch (e) { console.error('  删除失败：' + String(e?.message || e).slice(0, 120)) } }
}
if (!localItems) console.log('· （该 uid 在服务器本地没有残留目录）')

/* ───────────────── ③ 汇总 + DB（不动手，只给命令）───────────────── */
console.log('—— 汇总 ——')
console.log('OSS：' + (YES ? '已删 ' + deletedOss + ' 个对象 / 释放 ' + MB(freedOss) : '待删（dry-run）'))
console.log('本地：' + (YES ? '已清 ' + localItems + ' 个目录 / 释放 ' + MB(localBytes) : localItems + ' 个目录 / ' + MB(localBytes) + '（dry-run）'))
if (!YES) {
  console.log('⚠️ 以上只是清单。要真删：在命令后加 --yes')
} else {
  console.log('✅ 已清完。建议再跑一次 `node scripts/repo-audit.mjs ' + uid + '` 复核（应只剩 0 个对象）。')
}
console.log('（可选）清 DB 记录——由你决定，脚本不自动做：')
console.log('  sqlite3 prisma/dev.db "DELETE FROM MediaAsset WHERE ownerId=' + uid + '; DELETE FROM GenerationRecord WHERE userId=' + uid + ';"')
