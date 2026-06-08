/**
 * 阿里云 OSS 存储封装
 * 从 SystemConfig 读取配置，提供统一的文件操作接口
 */

import { getSystemConfigs } from './system-config'
import OSS from 'ali-oss'

let client: OSS | null = null

interface OSSConfig {
  region: string
  accessKeyId: string
  accessKeySecret: string
  bucket: string
}

/** 获取 OSS 客户端（懒加载单例） */
export async function getOSSClient(): Promise<OSS> {
  if (client) return client

  const configs = await getSystemConfigs()
  const config: OSSConfig = {
    region: configs.get('oss_region') || '',
    accessKeyId: configs.get('oss_access_key_id') || '',
    accessKeySecret: configs.get('oss_access_key_secret') || '',
    bucket: configs.get('oss_bucket') || '',
  }

  if (!config.region || !config.accessKeyId || !config.accessKeySecret || !config.bucket) {
    throw new Error('OSS 未配置，请在 admin/settings 中填写完整配置')
  }

  client = new OSS(config)
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
  await oss.put(key, buffer, { headers: mime ? { 'Content-Type': mime } : undefined })
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
  const result = await oss.list({ prefix, 'max-keys': maxKeys })
  return (result.objects || []).map(o => ({
    name: o.name,
    size: o.size || 0,
    lastModified: o.lastModified || new Date(),
  }))
}

/** 获取签名 URL（用于前端直连下载/预览） */
export async function signedUrl(key: string, expires = 3600): Promise<string> {
  const oss = await getOSSClient()
  return oss.signatureUrl(key, { expires })
}
