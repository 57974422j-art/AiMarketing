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

/** 上传文件
 *  ★VF_PUTUNIQ_V1（2026-10-12 用户定案「个人仓库缩略图错乱」修复其一）：支持**条件写** ——
 *  `forbidOverwrite: true` 时带上 OSS 原生头 `x-oss-forbid-overwrite: true`：
 *  **对象已存在 ⇒ 服务端直接拒绝（409 FileAlreadyExists）**，而不是静默覆盖。
 *  用途：个人仓库的"日期+序号"命名用它堵住"先查后写"的并发空档
 *  （原实现是 HEAD 探测存在性 → 再 put，两人同时上传会互相覆盖素材与其缩略图）。 */
export async function putObject(key: string, buffer: Buffer | string, mime?: string, opt?: { forbidOverwrite?: boolean }): Promise<void> {
  const oss = await getOSSClient()
  const options: Record<string, any> = {}
  const headers: Record<string, string> = {}
  if (mime) headers['Content-Type'] = mime
  if (opt?.forbidOverwrite) headers['x-oss-forbid-overwrite'] = 'true'
  if (Object.keys(headers).length) options.headers = headers
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

/** 列出目录下所有文件（⚠️ **单次最多 1000** —— OSS 的硬上限；要全量请用 listAllObjects） */
export async function listObjects(prefix: string, maxKeys = 1000): Promise<Array<{ name: string; size: number; lastModified: Date }>> {
  const oss = await getOSSClient()
  // ★VF_OSS_MAXKEYS_V1（2026-10-12 用户实测报错「Argument max-keys must be an integer between 1 and 1000」）：
  //   OSS 的 max-keys 只能 1~1000；调用方传 2000 会**整条请求报错**（不是截断）。
  //   现口径：这里**夹到 1~1000**（把"传大了"从"报错"降级成"最多 1000 条"），要全量用下面的 listAllObjects。
  const n = Math.max(1, Math.min(1000, Math.floor(Number(maxKeys) || 1000)))
  const result = await oss.list({ prefix, 'max-keys': n }, {})
  return (result.objects || []).map(o => ({
    name: o.name,
    size: o.size || 0,
    lastModified: o.lastModified ? new Date(o.lastModified) : new Date(),
  }))
}

/**
 * ★VF_OSS_MAXKEYS_V1：**分页列全量**（一次 1000，按 marker 翻页，硬上限 hardCap 防失控）。
 * 为什么需要它：单次最多 1000 条，而"仓库里 1000 个对象"很常见（素材 + `.thumbs/` 叠加），
 *   一旦超过，配额统计会**少算**、孤儿缩略图会**漏清**、列表会**少显示**。
 */
export async function listAllObjects(prefix: string, hardCap = 5000): Promise<Array<{ name: string; size: number; lastModified: Date }>> {
  const oss = await getOSSClient()
  const cap = Math.max(1, Math.min(20000, Math.floor(Number(hardCap) || 5000)))
  const out: Array<{ name: string; size: number; lastModified: Date }> = []
  let marker: string | undefined
  for (let page = 0; page < 25 && out.length < cap; page++) {
    const result: any = await oss.list(Object.assign({ prefix, 'max-keys': 1000 }, marker ? { marker } : {}), {})
    const objs = (result.objects || []).map((o: any) => ({
      name: o.name,
      size: o.size || 0,
      lastModified: o.lastModified ? new Date(o.lastModified) : new Date(),
    }))
    out.push(...objs)
    // ali-oss：还有下一页时 isTruncated=true 且给出 nextMarker；没有对象也停（防死循环）
    if (!result.isTruncated || !result.nextMarker || !objs.length) break
    marker = String(result.nextMarker)
  }
  return out.slice(0, cap)
}

/**
 * ★VF_OSSUPLOAD_V1（2026-10-12 用户定案「有BUG 看见就修」）
 * 病灶：`src/lib/live-stream-engine.ts:469` 写的是
 *   `const { uploadOSS } = await import('@/lib/oss')` —— 而**本文件从未导出 uploadOSS**
 *   （真正的实现藏在 `app/api/digital-human/route.ts:31` 的局部函数里）⇒ 直播配音上传一旦走到就抛异常。
 * 现口径：把那份实现**搬到这里**（一处真源），两处调用共享；`public-read` ACL 与 `dh/` 前缀保持原样。
 * ⚠️ 只在"要一个**公开可访问**的直链"时用它（数字人/直播配音这类对外播放的音频）；
 *    个人仓库素材请走 `putObject`＋`signedUrl`（私有，别把用户素材设成 public-read）。
 */
export async function uploadOSS(src: Buffer | string, ext: string, dir = 'dh'): Promise<string> {
  const oss = await getOSSClient()
  const key = `${dir}/${Date.now()}_${Math.random().toString(36).substring(2, 6)}.${ext}`
  // 传本地路径（string）或 buffer 都行 —— ali-oss 的 put 两种都吃
  await oss.put(key, src as any, { headers: { 'x-oss-object-acl': 'public-read' } })
  return `https://${process.env.OSS_BUCKET}.${process.env.OSS_REGION || 'oss-cn-hangzhou'}.aliyuncs.com/${key}`
}

/** 获取签名 URL（用于内部服务端 fetch） */
export async function signedUrl(key: string, expires = 3600): Promise<string> {
  const oss = await getOSSClient()
  return oss.signatureUrl(key, { expires })
}
