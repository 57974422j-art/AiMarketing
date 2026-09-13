// 从 src/lib/agent/platforms.ts 生成 electron/platforms.generated.js
// 用途：Electron 主进程（asar 内）不能用 TS/alias import，故构建前生成一份 CommonJS 镜像
// 用法：node scripts/gen-platforms-js.mjs   （build-local.mjs 会自动调用）
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(process.cwd())
const SRC = path.join(ROOT, 'src/lib/agent/platforms.ts')
const OUT = path.join(ROOT, 'electron/platforms.generated.js')

if (!fs.existsSync(SRC)) {
  console.error('[gen-platforms] 找不到', SRC)
  process.exit(1)
}

const ts = fs.readFileSync(SRC, 'utf8')

// 从 TS 里抽出 PLATFORMS 数组字面量
const m = ts.match(/export const PLATFORMS:\s*PlatformDef\[\]\s*=\s*(\[[\s\S]*?\n\])/)
if (!m) {
  console.error('[gen-platforms] 未能从 platforms.ts 解析出 PLATFORMS 数组')
  process.exit(1)
}

let platforms
try {
  // 字面量是纯 JSON 结构（无函数/模板变量），可直接求值
  platforms = eval(m[1])
} catch (e) {
  console.error('[gen-platforms] PLATFORMS 求值失败:', e.message)
  process.exit(1)
}

if (!Array.isArray(platforms) || !platforms.length) {
  console.error('[gen-platforms] PLATFORMS 为空')
  process.exit(1)
}

const body = `// ⚠️ 本文件由 scripts/gen-platforms-js.mjs 自动生成 —— 请勿手改
// 源：src/lib/agent/platforms.ts（唯一真源）
// 生成时间：${new Date().toISOString()}
'use strict'

const PLATFORMS = ${JSON.stringify(platforms, null, 2)}

const PLATFORM_KEY = Object.fromEntries(PLATFORMS.map((p) => [p.name, p.id]))
const PLATFORM_NAME = Object.fromEntries(PLATFORMS.map((p) => [p.id, p.name]))
const PLATFORM_URL = Object.fromEntries(PLATFORMS.map((p) => [p.id, p.publishUrl]))
const PLATFORM_LOGIN_URL = Object.fromEntries(PLATFORMS.map((p) => [p.id, p.loginUrl]))
const PLATFORM_ICON = Object.fromEntries(PLATFORMS.map((p) => [p.id, p.icon]))
const PLATFORM_NAMES = PLATFORMS.map((p) => p.name)
const PLATFORM_IDS = PLATFORMS.map((p) => p.id)

module.exports = {
  PLATFORMS,
  PLATFORM_KEY,
  PLATFORM_NAME,
  PLATFORM_URL,
  PLATFORM_LOGIN_URL,
  PLATFORM_ICON,
  PLATFORM_NAMES,
  PLATFORM_IDS,
}
`

fs.writeFileSync(OUT, body, 'utf8')
console.log(`[gen-platforms] ✅ 生成 electron/platforms.generated.js（${platforms.length} 个平台：${platforms.map((p) => p.name).join('/')}）`)
