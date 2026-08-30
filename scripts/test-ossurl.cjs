require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') })
const OSS = require('ali-oss')
;(async () => {
  const region = process.env.OSS_REGION || 'oss-cn-hangzhou'
  const bucket = process.env.OSS_BUCKET || 'aimarketing-1'
  console.log('region:', region, 'bucket:', bucket)
  const client = new OSS({ region, accessKeyId: process.env.OSS_ACCESS_KEY_ID, accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET, bucket, authorizationV4: true })
  // ① 直接读已存在的对象（video 下载成功过——第1遍）
  const list = await client.list({ prefix: 'storage/13/', 'max-keys': 3 })
  const obj = list.objects?.[0]
  console.log('① list 对象:', obj?.name)
  if (!obj) { console.log('无对象'); return }
  // ② 用 signatureUrl 生成 URL 并 fetch（看 200/403）
  const url = client.signatureUrl(obj.name, Math.floor(Date.now()/1000) + 600)
  console.log('② signatureUrl:', url.slice(0, 120))
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) })
    console.log('   fetch 结果:', r.status, r.statusText)
  } catch (e) { console.log('   fetch 失败:', e.message.slice(0, 120)) }
  // ③ 用 get 签名（client.get 内部签名）对比
  try {
    const tmp = require('os').tmpdir() + '/oss-url-test.bin'
    await client.get(obj.name, tmp)
    console.log('③ client.get 成功（内部签名 OK）')
  } catch (e) { console.log('③ client.get 失败:', e.message.slice(0, 120)) }
})()
