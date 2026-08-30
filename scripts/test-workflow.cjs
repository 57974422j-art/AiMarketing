// 2026-08-27: 发布工作流核心 3 遍验证——抽帧→视觉看画面→基于画面出标题/文案
const { execSync } = require('child_process')
const fs = require('fs'), path = require('path'), os = require('os')
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') })

async function runRound(i) {
  console.log(`\n===== 第 ${i} 遍 =====`)
  // ① OSS 下载视频
  const OSS = require('ali-oss')
  const client = new OSS({ region: process.env.OSS_REGION || 'oss-cn-hangzhou', accessKeyId: process.env.OSS_ACCESS_KEY_ID, accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET, bucket: process.env.OSS_BUCKET || 'aimarketing-1', authorizationV4: true })
  const vid = 'storage/13/20260826_001.mp4'
  const tmp = path.join(os.tmpdir(), `wf-test-${i}-${Date.now()}.mp4`)
  await client.get(vid, tmp)
  console.log('① 视频下载 OK:', fs.statSync(tmp).size, 'bytes')
  // ② ffmpeg 抽 4 帧
  const outDir = path.join(os.tmpdir(), `wf-frames-${i}-${Date.now()}`)
  fs.mkdirSync(outDir, { recursive: true })
  const dur = parseFloat(execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${tmp}"`, { encoding: 'utf8' }).trim())
  const pcts = [0.05, 0.35, 0.65, 0.9]
  const frames = []
  pcts.forEach((p, idx) => {
    const out = path.join(outDir, `f${idx}.jpg`)
    try { execSync(`ffmpeg -y -ss ${(dur * p).toFixed(2)} -i "${tmp}" -frames:v 1 -vf "scale=640:-2" -q:v 5 "${out}"`, { timeout: 30000 }); if (fs.existsSync(out)) frames.push(out) } catch {}
  })
  console.log('② 抽帧 OK:', frames.length, '张（时长', dur.toFixed(1), 's）')
  if (!frames.length) return { round: i, fail: '抽帧失败' }
  // ③ 帧传 OSS + DeepSeek V4 视觉看画面
  const imgs = []
  for (const f of frames) {
    const key = `frames/wf-test-${i}/${Date.now()}-${path.basename(f)}`
    await client.put(key, f)
    imgs.push({ type: 'image_url', image_url: { url: client.signatureUrl(key, Math.floor(Date.now() / 1000) + 900) } })
  }
  const v4res = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.DEEPSEEK_API_KEY },
    body: JSON.stringify({ model: 'deepseek-v4-flash', messages: [{ role: 'user', content: [{ type: 'text', text: '这是视频的4个画面帧，请用中文简洁总结：1.视频内容（主体/场景/动作）2.适合的抖音标题和文案。3-4句。' }, ...imgs] }], max_tokens: 300 }),
    signal: AbortSignal.timeout(90000),
  })
  const v4d = await v4res.json().catch(() => null)
  const desc = v4d?.choices?.[0]?.message?.content || JSON.stringify(v4d).slice(0, 200)
  console.log('③ 视觉看画面（V4）:', String(desc).slice(0, 250))
  // ④ 基于画面出标题（V4 二次调用）
  const t2 = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.DEEPSEEK_API_KEY },
    body: JSON.stringify({ model: 'deepseek-v4-flash', messages: [{ role: 'user', content: '基于以上视频内容（' + String(desc).slice(0, 200) + '），给一个 30 字内的抖音标题 + 一句话文案 + 3 个话题标签。格式：标题：xxx\n文案：xxx\n标签：#a #b #c' }], max_tokens: 200 }),
    signal: AbortSignal.timeout(60000),
  })
  const t2d = await t2.json().catch(() => null)
  console.log('④ 出标题/文案:', String(t2d?.choices?.[0]?.message?.content || '失败').slice(0, 250))
  console.log(`===== 第 ${i} 遍 完成 =====`)
  return { round: i, desc: String(desc).slice(0, 150) }
}

;(async () => {
  const results = []
  for (let i = 1; i <= 3; i++) { try { results.push(await runRound(i)) } catch (e) { results.push({ round: i, fail: e.message }) } }
  console.log('\n===== 3 遍汇总 =====')
  results.forEach(r => console.log(r.round, r.fail ? '❌ ' + r.fail : '✅', r.desc ? '画面:' + r.desc.slice(0, 80) : ''))
})()
