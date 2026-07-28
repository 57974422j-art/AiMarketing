#!/usr/bin/env node
/**
 * 商业化 Electron 发布流程（行业标准自动化）
 *
 * 设计原则：
 *  - 单一事实源：electron/version.json（人工维护，每次发布前递增）
 *  - 自动同步：构建前把 version.json 的 version 同步进 package.json，
 *    彻底消除「安装包名 / exe 版本 / 显示版本」三处不一致的历史问题
 *  - 可重复、可审计：构建后输出 SHA256 校验和，供发布说明与完整性核对
 *
 * 用法：
 *   node scripts/release-electron.mjs patch     # 1.0.8 -> 1.0.9
 *   node scripts/release-electron.mjs minor     # 1.0.8 -> 1.1.0
 *   node scripts/release-electron.mjs major     # 1.0.8 -> 2.0.0
 *   node scripts/release-electron.mjs 1.2.3     # 指定精确版本
 *   node scripts/release-electron.mjs --dry     # 仅演示将做什么，不写文件、不构建
 *
 * 流程：bump version.json → 同步 package.json → 生成 downloadUrl
 *      → 提醒更新 changelog.json → 构建 → 计算 SHA256 → 输出上传指引
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { resolve, basename } from 'node:path'

const ROOT = resolve('.')
const VERSION_JSON = resolve('electron/version.json')
const PKG_JSON = resolve('package.json')
const CHANGELOG = resolve('electron/changelog.json')
const DOMAIN = 'https://ai-niuma.cc/updates'

const DRY = process.argv.includes('--dry')
const args = process.argv.slice(2).filter(a => !a.startsWith('--'))
const arg = args[0] || 'patch'

function readJson(p) {
  return JSON.parse(readFileSync(p, 'utf-8'))
}
function writeJson(p, o) {
  writeFileSync(p, JSON.stringify(o, null, 2) + '\n')
}

function bumpVersion(cur, type) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(cur)
  if (!m) throw new Error(`当前版本格式非法: ${cur}`)
  let [maj, min, pat] = m.slice(1).map(Number)
  if (type === 'major') { maj++; min = 0; pat = 0 }
  else if (type === 'minor') { min++; pat = 0 }
  else if (type === 'patch') { pat++ }
  else if (/^\d+\.\d+\.\d+$/.test(type)) { [maj, min, pat] = type.split('.').map(Number) }
  else throw new Error(`未知 bump 类型: ${type}（用 patch/minor/major 或 x.y.z）`)
  return `${maj}.${min}.${pat}`
}

// ---- 预检 ----
if (!existsSync(VERSION_JSON)) { console.error('❌ 找不到', VERSION_JSON); process.exit(1) }
if (!existsSync(PKG_JSON)) { console.error('❌ 找不到', PKG_JSON); process.exit(1) }

const curVj = readJson(VERSION_JSON)
const next = bumpVersion(curVj.version, arg)
const today = new Date().toISOString().slice(0, 10)
const exeName = `AI-Marketing-Setup-${next}.exe`
const downloadUrl = `${DOMAIN}/${exeName}`

if (DRY) {
  console.log('[DRY-RUN] 不会写文件、不会构建')
  console.log(`  当前版本:        ${curVj.version}`)
  console.log(`  将发布版本:      ${next}  (${today})`)
  console.log(`  将写 version.json | version=${next} downloadUrl=${downloadUrl}`)
  console.log(`  将同步 package.json | version=${next}`)
  console.log(`  将构建产物:      dist-electron/${exeName}`)
  console.log(`  将输出 SHA256 校验和`)
  console.log('\n请确认后去掉 --dry 再执行。')
  process.exit(0)
}

// ---- 1) 写 version.json（单一事实源）----
const vj = {
  version: next,
  buildDate: today,
  channel: curVj.channel || 'stable',
  minSupportedVersion: curVj.minSupportedVersion || '1.0.0',
  downloadUrl,
  notes: curVj.notes || '',
}
writeJson(VERSION_JSON, vj)

// ---- 2) 同步 package.json 的 version（保证安装包名/exe 版本一致）----
const pkg = readJson(PKG_JSON)
pkg.version = next
writeJson(PKG_JSON, pkg)

console.log(`\n✅ 版本已推进: ${curVj.version} -> ${next}  (${today})`)
console.log(`   version.json | version=${vj.version}  downloadUrl=${vj.downloadUrl}`)
console.log(`   package.json | version=${pkg.version}  (已自动同步)`)

// ---- 3) 提醒 changelog ----
console.log(`\n📝 请确认 electron/changelog.json 顶部已有对应条目（如没有请新增）:`)
console.log(JSON.stringify({ version: next, date: today, title: '本次更新标题', changes: ['变更点1', '变更点2'] }, null, 2))

// ---- 4) 构建 ----
console.log(`\n🔨 开始构建 (npm run electron:build) ...`)
execSync('npm run electron:build', { stdio: 'inherit', cwd: ROOT })

// ---- 5) 产物 + 校验和 ----
const exePath = resolve(`dist-electron/${exeName}`)
if (!existsSync(exePath)) {
  console.error('❌ 未找到构建产物:', exePath)
  process.exit(1)
}
const buf = readFileSync(exePath)
const sha = createHash('sha256').update(buf).digest('hex')
const sizeMB = (buf.length / 1024 / 1024).toFixed(1)
console.log(`\n✅ 构建完成: dist-electron/${exeName}  (${sizeMB} MB)`)
console.log(`   SHA256: ${sha}`)

// ---- 6) 上传指引 ----
console.log(`\n🚀 发布到生产更新服务器:`)
console.log(`   1) 复制 exe 到 public/updates/ 并提交（或仅由服务器托管）`)
console.log(`   2) 上传到 ${downloadUrl}`)
console.log(`   3) 将上方 SHA256 记入发布说明，供用户校验完整性`)
console.log(`\n🎉 发布流程结束。`)
