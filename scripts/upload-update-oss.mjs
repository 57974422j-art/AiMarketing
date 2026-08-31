// 上传更新包到 OSS（发布后跑：node scripts/upload-update-oss.mjs）
// 1. 上传 exe/blockmap 到 OSS updates/
// 2. 生成 latest.yml（url 指向 OSS——下载走 OSS 不限流）
// 3. 输出服务器版 latest.yml（检查走服务器——下载走 OSS）
import fs from 'fs'
import path from 'path'
import OSS from 'ali-oss'

// 读 .env.local
function env(name) {
  const p = path.resolve('.env.local')
  if (!fs.existsSync(p)) return ''
  const m = fs.readFileSync(p, 'utf8').match(new RegExp('^' + name + '=(.*)$', 'm'))
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : ''
}

const region = env('OSS_REGION') || 'oss-cn-hangzhou'
const ak = env('OSS_ACCESS_KEY_ID')
const sk = env('OSS_ACCESS_KEY_SECRET')
const bucket = env('OSS_BUCKET') || 'aimarketing-1'
if (!ak || !sk) { console.error('OSS key 未配置（.env.local）'); process.exit(1) }

const client = new OSS({ region, accessKeyId: ak, accessKeySecret: sk, bucket, authorizationV4: true })

// 读 latest.yml 拿版本
const fromDir = process.argv[2] || 'dist-rel'
const yml = fs.readFileSync(path.join(fromDir, 'latest.yml'), 'utf8')
const ver = (yml.match(/^version:\s*(.+)$/m) || [])[1]?.trim()
if (!ver) { console.error('latest.yml 无 version'); process.exit(1) }
const exeName = `AI-Marketing-Setup-${ver}.exe`
const blockName = exeName + '.blockmap'
const OSS_URL = `https://${bucket}.oss-${region}.aliyuncs.com/updates`

const up = async (local, remote) => {
  console.log(`上传 ${local} → updates/${remote} ...`)
  await client.put('updates/' + remote, fs.readFileSync(local), { headers: { 'Content-Type': 'application/octet-stream' } })
}

const main = async () => {
  await up(path.join(fromDir, exeName), exeName)
  await up(path.join(fromDir, blockName), blockName)
  // 生成服务器版 latest.yml（url 指向 OSS——下载走 OSS）
  const newYml = yml
    .replace('url: ' + exeName, 'url: ' + OSS_URL + '/' + exeName)
    .replace('path: ' + exeName, 'path: ' + OSS_URL + '/' + exeName)
  fs.writeFileSync(path.join(fromDir, 'latest-oss.yml'), newYml)
  console.log('✅ 已上传 OSS updates/' + exeName + ' + blockmap')
  console.log('✅ 服务器版 latest.yml → dist-rel/latest-oss.yml（检查走服务器——url 指向 OSS）')
  console.log('   url: ' + OSS_URL + '/' + exeName)
}
main().catch(e => { console.error('失败:', e.message); process.exit(1) })
