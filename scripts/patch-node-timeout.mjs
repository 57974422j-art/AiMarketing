/**
 * ★VF_NODE_TIMEOUT_V1（2026-10-26 实测：AI 出页那步 285s，Node 22 默认
 *   `server.requestTimeout = 300000`（300 秒）⇒ 请求被直接掐断，
 *   客户端**收不到任何响应**（实测：11:47 提交、11:58 才报超时，而后端 11:53 就跑完了）。
 *
 * 为什么必须 patch：`.next/standalone/server.js` 里只设了 `keepAliveTimeout`，
 *   **没有** `requestTimeout` ⇒ 走 Node 默认 300s。而 `startServer()` 不返回 server 实例，
 *   所以只能**在它创建之前拦一层** `http.createServer`，把超时改掉。
 *
 * 幂等：已经有标记就跳过（部署脚本每次 build 后都会调它）。
 * 只改超时，不动任何业务逻辑。
 */
import fs from 'node:fs'
import path from 'node:path'

const f = path.join(process.cwd(), '.next', 'standalone', 'server.js')
if (!fs.existsSync(f)) {
  console.log('  ⚠️ 找不到 .next/standalone/server.js（先 build 再 patch）')
  process.exit(0)
}

const MARK = '/* ★VF_NODE_TIMEOUT_V1 */'
let src = fs.readFileSync(f, 'utf8')

if (src.includes(MARK)) {
  console.log('  ✅ 已 patch 过，跳过')
  process.exit(0)
}

const INJECT = `${MARK}
/* 把 Node 默认的 300s 请求超时关掉（长任务要 5~6 分钟）。
   同时把 keepAlive 拉到 120s（避免代理复用连接时过早断）。 */
;(() => {
  const http = require('http')
  const orig = http.createServer
  http.createServer = function (...args) {
    const s = orig.apply(this, args)
    try {
      s.requestTimeout = 0        // 0 = 不限制
      s.headersTimeout = 0
      s.keepAliveTimeout = 120000
    } catch (e) { /* 忽略：拿不到实例就退回默认 */ }
    return s
  }
})()

`

// 插在 require('next') 之前（必须早于 Next 创建 server）
const anchor = "require('next')"
if (!src.includes(anchor)) {
  console.log('  ⚠️ server.js 里没找到 require(\'next\') 锚点，未修改')
  process.exit(0)
}
src = src.replace(anchor, INJECT + anchor)
fs.writeFileSync(f, src, 'utf8')
console.log('  ✅ 已注入 requestTimeout=0（' + f + '）')
