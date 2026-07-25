/**
 * 上传客户端安装包到 OSS 的 updates/ 目录（供 ai-niuma.cc/updates 下载页使用）
 * 用法（在本机设置好 OSS 环境变量后执行）：
 *   set OSS_REGION=xxx
 *   set OSS_ACCESS_KEY_ID=xxx
 *   set OSS_ACCESS_KEY_SECRET=xxx
 *   set OSS_BUCKET=xxx
 *   node scripts/upload-updates.cjs
 *
 * 说明：安装包约 400MB，超过 GitHub 单文件 100MB 限制，故不进 git，必须走 OSS。
 * 上传成功后下载页 downloadUrl 指向 https://ai-niuma.cc/updates/AI-Marketing-Setup-1.0.5.exe
 */
const OSS = require('ali-oss')
const fs = require('fs')
const path = require('path')

const { OSS_REGION: region, OSS_ACCESS_KEY_ID: accessKeyId, OSS_ACCESS_KEY_SECRET: accessKeySecret, OSS_BUCKET: bucket } = process.env
if (!region || !accessKeyId || !accessKeySecret || !bucket) {
  console.error('缺少 OSS 环境变量：请设置 OSS_REGION / OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET / OSS_BUCKET')
  process.exit(1)
}

const client = new OSS({ region, accessKeyId, accessKeySecret, bucket })

// 安装包文件名取自 package.json 的 version（0.1.0），不改 package.json，故此处硬编码基础名
const exeName = 'AI营销助手 Setup 0.1.0.exe'
const localExe = path.join(__dirname, '..', 'dist-electron', exeName)
const objectKey = 'updates/AI-Marketing-Setup-1.0.5.exe'

async function main() {
  if (!fs.existsSync(localExe)) {
    console.error('未找到安装包：', localExe, '请先运行 npm run electron:build')
    process.exit(1)
  }
  console.log(`上传安装包 -> oss://${bucket}/${objectKey}`)
  const r1 = await client.put(objectKey, localExe, {
    headers: { 'Content-Type': 'application/octet-stream' },
  })
  console.log('安装包上传完成：', r1.url || objectKey)

  const localYml = path.join(__dirname, '..', 'dist-electron', 'latest.yml')
  if (fs.existsSync(localYml)) {
    await client.put('updates/latest.yml', localYml)
    console.log('latest.yml 上传完成')
  }
  console.log('全部完成。下载地址：https://ai-niuma.cc/updates/AI-Marketing-Setup-1.0.5.exe')
}

main().catch((e) => { console.error(e); process.exit(1) })
