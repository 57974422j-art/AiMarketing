// 2026-08-24: 版本三处一键同步（根治漏 changelog）
// 用法: node scripts/bump-version.mjs 1.0.54
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
const v = process.argv[2]
if (!/^\d+\.\d+\.\d+$/.test(v || '')) { console.log('用法: node scripts/bump-version.mjs 1.0.54'); process.exit(1) }
const root = join(process.cwd())
// ① package.json
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
pkg.version = v
writeFileSync(join(root, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')
// ② electron/version.json（version + downloadUrl）
const ver = JSON.parse(readFileSync(join(root, 'electron', 'version.json'), 'utf8'))
ver.version = v
ver.downloadUrl = 'https://aimarketing-1.oss-cn-hangzhou.aliyuncs.com/updates/AI-Marketing-Setup-' + v + '.exe'
writeFileSync(join(root, 'electron', 'version.json'), JSON.stringify(ver, null, 2) + '\n')
// ③ electron/changelog.json（自动插新条目——title 需手动补描述）
const ch = JSON.parse(readFileSync(join(root, 'electron', 'changelog.json'), 'utf8'))
// ★LOCAL_DATE_FIX_V1（2026-09-23）：原来用 toISOString()（UTC）→ 【凌晨打包会把日期写成前一天】。
//   实测：中国时区 2026-09-23 07:25 打包，changelog 日期被写成 2026-09-22。
//   改为按【本地时区】取日期（用户看到的日期就是本地日期）。
const localDate = () => {
  const d = new Date(); const p = (n) => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
}
if (ch[0]?.version !== v) ch.unshift({ version: v, date: localDate(), title: '版本 ' + v, items: ['（待补充变更说明）'] })
writeFileSync(join(root, 'electron', 'changelog.json'), JSON.stringify(ch, null, 2) + '\n')
console.log('✅ 版本已同步三处 →', v)
console.log('   ⚠️ 记得补 changelog.json 第一条的 title/items 描述')
