/**
 * 阿里云 OSS 存储封装
 * 从 SystemConfig 读取配置，提供统一的文件操作接口
 */

import OSS from 'ali-oss'

/** 从 .env.local 读取环境变量（兼容热重载） */
async function readEnv(key: string): Promise<string> {
  if (process.env[key]) return process.env[key]!
  try {
    const { readFile } = await import('fs/promises')
    const { join } = await import('path')
    const content = await readFile(join(process.cwd(), '.env.local'), 'utf-8')
    const match = content.match(new RegExp(`^${key}=(.+)$`, 'm'))
    return match?.[1] || ''
  } catch { return '' }
}

let client: OSS | null = null

/** 获取 OSS 客户端（懒加载单例） */
export async function getOSSClient(): Promise<OSS> {
  if (client) return client

  const region = await readEnv('OSS_REGION')
  const accessKeyId = await readEnv('OSS_ACCESS_KEY_ID')
  const accessKeySecret = await readEnv('OSS_ACCESS_KEY_SECRET')
  const bucket = await readEnv('OSS_BUCKET')

  if (!region || !accessKeyId || !accessKeySecret || !bucket) {
    throw new Error('OSS 未配置，请在 admin/settings 中填写完整配置')
  }

  // 2026-08-06 修:2024 年后新建 bucket 强制 V4 签名。ali-oss 6.20+ 支持 V4,需显式 authorizationV4:true
  // 不加此配置 → 默认 V1 签名 → 对 V4-only bucket 报 SignatureDoesNotMatch
  client = new OSS({
    region,
    accessKeyId,
    accessKeySecret,
    bucket,
    authorizationV4: true,
    endpoint: `https://${region}.aliyuncs.com`,
  })
  return client
}

/** 重置客户端（配置变更后调用） */
export function resetOSSClient(): void {
  client = null
}

// ====== 便捷方法 ======

/** 上传文件 */
export async function putObject(key: string, buffer: Buffer | string, mime?: string): Promise<void> {
  const oss = await getOSSClient()
  const options: Record<string, any> = {}
  if (mime) options.headers = { 'Content-Type': mime }
  await oss.put(key, buffer, options)
}

/** 上传本地文件到 OSS，返回签名 URL（数字人等用文件路径上传的场景） */
export async function uploadToOSS(filePath: string, key: string, mime?: string): Promise<string | null> {
  try {
    const { readFile } = await import('fs/promises')
    const buf = await readFile(filePath)
    await putObject(key, buf, mime)
    return await signedUrl(key, 86400)
  } catch (e) {
    console.error('[uploadToOSS] 上传失败:', e)
    return null
  }
}

/** 删除文件 */
export async function deleteObject(key: string): Promise<void> {
  const oss = await getOSSClient()
  await oss.delete(key)
}

/** 获取文件（Buffer） */
export async function getObject(key: string): Promise<Buffer> {
  const oss = await getOSSClient()
  const result = await oss.get(key)
  return result.content as Buffer
}

/** 检查文件是否存在 */
export async function objectExists(key: string): Promise<boolean> {
  const oss = await getOSSClient()
  try {
    await oss.head(key)
    return true
  } catch {
    return false
  }
}

/** 列出目录下所有文件 */
export async function listObjects(prefix: string, maxKeys = 1000): Promise<Array<{ name: string; size: number; lastModified: Date }>> {
  const oss = await getOSSClient()
  const result = await oss.list({ prefix, 'max-keys': maxKeys }, {})
  return (result.objects || []).map(o => ({
    name: o.name,
    size: o.size || 0,
    lastModified: o.lastModified ? new Date(o.lastModified) : new Date(),
  }))
}

/** 获取签名 URL（用于内部服务端 fetch） */
export async function signedUrl(key: string, expires = 3600): Promise<string> {
  const oss = await getOSSClient()
  return oss.signatureUrl(key, { expires })
}
