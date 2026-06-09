import { NextResponse } from 'next/server'

export async function GET() {
  const steps: { step: string; ok: boolean; detail: string }[] = []

  // 1. 读取环境变量
  let region = '', akId = '', akSecret = '', bucket = ''
  try {
    const keys = ['OSS_REGION', 'OSS_ACCESS_KEY_ID', 'OSS_ACCESS_KEY_SECRET', 'OSS_BUCKET']
    for (const k of keys) {
      if (process.env[k]) { if (k === 'OSS_REGION') region = process.env[k]!; else if (k === 'OSS_ACCESS_KEY_ID') akId = process.env[k]!; else if (k === 'OSS_ACCESS_KEY_SECRET') akSecret = process.env[k]!; else if (k === 'OSS_BUCKET') bucket = process.env[k]! }
      else {
        const { readFile } = await import('fs/promises')
        const { join } = await import('path')
        const content = await readFile(join(process.cwd(), '.env.local'), 'utf-8')
        const match = content.match(new RegExp(`^${k}=(.+)$`, 'm'))
        const v = match?.[1] || ''
        if (k === 'OSS_REGION') region = v; else if (k === 'OSS_ACCESS_KEY_ID') akId = v; else if (k === 'OSS_ACCESS_KEY_SECRET') akSecret = v; else if (k === 'OSS_BUCKET') bucket = v
      }
    }
    steps.push({ step: '1.读取环境变量', ok: !!(region && akId && akSecret && bucket), detail: `region=${region || '(空)'} | bucket=${bucket || '(空)'} | akId=${akId ? akId.slice(0,8)+'...' : '(空)'} | akSecret=${akSecret ? '有值(已隐藏)' : '(空)'}` })
  } catch (e: any) {
    steps.push({ step: '1.读取环境变量', ok: false, detail: e.message?.slice(0,200) })
  }

  // 2. 初始化 OSS 客户端
  let ossClient: any = null
  if (region && akId && akSecret && bucket) {
    try {
      const { default: OSS } = await import('ali-oss')
      ossClient = new OSS({ region, accessKeyId: akId, accessKeySecret: akSecret, bucket })
      steps.push({ step: '2.初始化OSS客户端', ok: true, detail: '成功' })
    } catch (e: any) {
      steps.push({ step: '2.初始化OSS客户端', ok: false, detail: e.message?.slice(0,300) })
    }
  } else {
    steps.push({ step: '2.初始化OSS客户端', ok: false, detail: '缺少必要参数' })
  }

  // 3. 测试 listBuckets（验证账号权限）
  if (ossClient) {
    try {
      const result = await ossClient.listBuckets({ 'max-keys': 5 }) as any
      const buckets = Array.isArray(result) ? result : (result.buckets || [])
      const found = buckets.find((b: any) => b.name === bucket)
      steps.push({
        step: '3.验证Bucket存在',
        ok: !!found,
        detail: `账号下共 ${buckets.length} 个Bucket: [${buckets.map((b:any)=>b.name).join(', ')}] | 目标"${bucket}"${found ? '✅存在' : '❌不存在'}`
      })
    } catch (e: any) {
      steps.push({ step: '3.验证Bucket存在', ok: false, detail: e.message?.slice(0,400) })
    }
  }

  // 4. 测试 listObjects（列出storage目录）
  if (ossClient) {
    try {
      const files = await ossClient.list({ prefix: 'storage/', 'max-keys': 10 }, {})
      const objects = files.objects || []
      steps.push({
        step: '4.列出storage文件',
        ok: true,
        detail: `找到 ${objects.length} 个文件: ${objects.map((o:any) => `${o.name} (${(o.size/1024).toFixed(1)}KB)`).join(' | ') || '(空目录)'}`
      })
    } catch (e: any) {
      steps.push({ step: '4.列出storage文件', ok: false, detail: e.message?.slice(0,400) })
    }
  }

  // 5. 测试生成签名URL
  if (ossClient) {
    try {
      const testKey = 'storage/test.mp4'
      const url = ossClient.signatureUrl(testKey, { expires: 3600 })
      steps.push({ step: '5.生成签名URL', ok: true, detail: url.slice(0,120) + '...' })
    } catch (e: any) {
      steps.push({ step: '5.生成签名URL', ok: false, detail: e.message?.slice(0,400) })
    }
  }

  return NextResponse.json({ success: true, data: { timestamp: new Date().toISOString(), steps } })
}
