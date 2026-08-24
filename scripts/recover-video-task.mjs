// 2026-08-24: 找回丢失的 AI 生成视频——taskId 查百炼 → 完成则下载 → 转存 OSS
// 用法: node --env-file=.env.local scripts/recover-video-task.mjs <taskId> [userId]
import OSS from 'ali-oss'
import fs from 'node:fs'
import path from 'node:path'

const taskId = process.argv[2]
const userId = process.argv[3] || '7'
if (!taskId) { console.log('用法: node --env-file=.env.local scripts/recover-video-task.mjs <taskId> [userId]'); process.exit(1) }

const key = process.env.DASHSCOPE_API_KEY
if (!key) { console.log('❌ 无 DASHSCOPE_API_KEY'); process.exit(1) }

// 1) 查百炼任务
console.log('🔍 查询百炼任务:', taskId)
const resp = await fetch(`https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`, {
  headers: { 'Authorization': `Bearer ${key}` },
  signal: AbortSignal.timeout(30000),
})
const data = await resp.json()
const status = data?.output?.task_status || data?.output?.status || 'unknown'
console.log('   状态:', status)
const videoUrl = data?.output?.video_url || data?.output?.results?.video_url || data?.output?.results?.[0]?.url || ''
if (!videoUrl) { console.log('   ⚠️ 无 video_url（任务可能未完成或已过期）——输出原始响应供参考:'); console.log(JSON.stringify(data).slice(0, 800)); process.exit(2) }
console.log('   ✅ 拿到视频 URL:', videoUrl.slice(0, 100))

// 2) 下载
console.log('⬇️ 下载视频…')
const buf = Buffer.from(await (await fetch(videoUrl, { signal: AbortSignal.timeout(180000) })).arrayBuffer())
console.log('   已下载:', (buf.length / 1048576).toFixed(1), 'MB')

// 3) 转存 OSS
console.log('☁️ 转存 OSS…')
const oss = new OSS({
  region: process.env.OSS_REGION,
  accessKeyId: process.env.OSS_ACCESS_KEY_ID,
  accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
  bucket: process.env.OSS_BUCKET,
})
const ossKey = `generations/${userId}/recover_${Date.now()}.mp4`
await oss.put(ossKey, buf)
console.log('   ✅ 已转存 OSS:', ossKey)
const signed = oss.signatureUrl(ossKey, { expires: 86400 })
console.log('   签名 URL:', signed.slice(0, 120) + '…')
console.log('\n✅ 找回成功！视频已安全存到服务器 OSS（网页可看/可入仓库）')
