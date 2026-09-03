// 一键发版（2026-09-03 定稿）：bump + commit + 打包 + 上传 OSS
// 用法: node scripts/release.mjs 1.0.96 "修复描述"
import { execSync } from 'child_process'
import { readFileSync, writeFileSync } from 'fs'
import path from 'path'

const v = process.argv[2]
const desc = process.argv[3] || ''
if (!/^\d+\.\d+\.\d+$/.test(v || '')) { console.log('用法: node scripts/release.mjs 1.0.96 "描述"'); process.exit(1) }
const root = path.resolve('.')
const run = (cmd) => { console.log('> ' + cmd); execSync(cmd, { stdio: 'inherit', cwd: root }) }

run(`node scripts/bump-version.mjs ${v}`)
if (desc) {
  const chPath = path.join(root, 'electron', 'changelog.json')
  const ch = JSON.parse(readFileSync(chPath, 'utf8'))
  if (ch[0]?.version === v) { ch[0].title = desc; writeFileSync(chPath, JSON.stringify(ch, null, 2) + '\n') }
}
run('git add package.json electron/version.json electron/changelog.json')
run(`git commit -m "chore: bump ${v}" || echo "无变更跳过"`)
run('git push origin master')
run('node scripts/build-local.mjs')
run('node scripts/upload-update-oss.mjs dist-rel')
console.log(`\n✅ 发版 ${v} 完成。最后: cd /root/AiMarketing && bash scripts/deploy-server.sh`)
console.log('   验证: curl -s https://ai-niuma.cc/updates/latest.yml | head -4')
