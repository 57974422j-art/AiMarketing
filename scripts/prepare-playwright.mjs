#!/usr/bin/env node
/**
 * ★PKG_PLAYWRIGHT_V1（2026-09-28）：打包前把"本机的 Playwright 浏览器"接到项目里，
 * 供 electron-builder 打进安装包（客户端内置浏览器，装完即用）。
 *
 * ■ 为什么需要这一步（真实踩坑记录，别再改回去）：
 *   electron-builder 的 extraResources.from 是【按项目目录相对解析】的。历史写法
 *   "C:/Users/Administrator/AppData/Local/ms-playwright" 会被拼成：
 *       G:\AiMarketing\C:\Users\Administrator\AppData\Local\ms-playwright
 *   → 它只打一行警告就跳过，构建照样"成功"：
 *       • file source doesn't exist  from=G:\AiMarketing\C:\Users\...
 *   → 后果：**安装包里根本没有内置浏览器**，包体从 ~684MB 掉到 ~257MB，
 *     用户在真机上会缺浏览器（而且不看日志根本发现不了）。
 *   （2026-06-10 那次把 "../../AppData/Local/ms-playwright" 改成绝对路径，
 *     从那天起这条就失效了 —— 相对路径那版当年是能用的。）
 *
 * ■ 现在怎么做：
 *   在项目根建一个 ms-playwright 目录接点（Windows junction：不需要管理员权限、不占额外磁盘空间），
 *   指向本机的 %LOCALAPPDATA%\ms-playwright（可用 PLAYWRIGHT_BROWSERS_PATH 覆盖）。
 *   打包配置里只写相对路径 "ms-playwright" → 任何机器、任何用户名都能打。
 *
 * ■ 用法（自动）：npm run electron:build / node scripts/release-electron.mjs 会经 preelectron:build 自动执行
 *   手动：node scripts/prepare-playwright.mjs
 */
import { existsSync, lstatSync, readlinkSync, symlinkSync, unlinkSync, rmSync, mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'

const ROOT = resolve('.')
// 接点放在 build/ 下 —— build/ 已被 .gitignore 忽略（.gitignore 本身是 UTF-16 编码，不便再改），
// 这样 800MB 的内置浏览器绝不会被误提交进仓库。
const BUILD_DIR = join(ROOT, 'build')
const LINK = join(BUILD_DIR, 'ms-playwright')
const SRC = process.env.PLAYWRIGHT_BROWSERS_PATH
  ? resolve(process.env.PLAYWRIGHT_BROWSERS_PATH)
  : join(process.env.LOCALAPPDATA || '', 'ms-playwright')

const log = (m) => console.log('[打包·内置浏览器] ' + m)

function linkTarget(p) {
  try {
    const st = lstatSync(p)
    if (st.isSymbolicLink()) return readlinkSync(p)
    return null   // 真目录（不是接点）
  } catch { return undefined }
}

function main() {
  log('本机浏览器目录: ' + SRC)
  if (!existsSync(SRC)) {
    log('⚠️ 没找到本机 Playwright 浏览器 → 本次打包【不会内置浏览器】（客户端在用户机器上可能缺浏览器）。')
    log('   修复：先在打包机上跑一次 npx playwright install chromium（或设 PLAYWRIGHT_BROWSERS_PATH 指向已有目录），再重新打包。')
    return
  }
  const t = linkTarget(LINK)
  if (t === null) {
    // 项目里已经是一个真目录（例如手动拷贝进来的）→ 尊重它，不动
    log('项目里已有真实的 ms-playwright 目录（不是接点）→ 直接使用，不重建')
    return
  }
  if (t !== undefined && resolve(t) === SRC) {
    log('接点已就绪: ' + LINK + ' → ' + SRC)
    return
  }
  try {
    if (t !== undefined) {  // 旧接点指向别处 → 换掉
      try { unlinkSync(LINK) } catch { rmSync(LINK, { recursive: true, force: true }) }
      log('旧接点指向 ' + t + ' → 已移除，准备重建')
    }
    mkdirSync(BUILD_DIR, { recursive: true })
    symlinkSync(SRC, LINK, 'junction')
    log('✅ 已建立接点: ' + LINK + ' → ' + SRC)
  } catch (e) {
    console.error('[打包·内置浏览器] ❌ 建立接点失败: ' + (e && e.message || e))
    console.error('   可手动执行（在项目根）: mklink /J build\\ms-playwright "%LOCALAPPDATA%\\ms-playwright"')
    process.exitCode = 1
  }
}

main()
