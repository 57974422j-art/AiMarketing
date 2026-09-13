/**
 * 发布运行环境自检（2026-09-10）
 * 用户要求：① 打开客户端时自检 + 后台静默安装 ② 装完弹窗告知"已安装哪些组件"
 *          ③ 发布时只检查不安装（不打断发布）
 * 2026-09-10 修复：环境探测改用【异步 spawn】——原来用 spawnSync 同步调 python 3 次
 *   （每次 timeout 25s）会阻塞 Electron 主进程，最长 ~75s 界面"未响应"（另一台机器实测卡死）
 */
module.exports = function createBuEnv(deps) {
  const { BUILTIN_PY, getBuPython, getServerCookie, ensureBuPython, buLog } = deps
  let cached = null

  /** 异步跑 python（不阻塞主进程） */
  function runPy(py, args, timeoutMs) {
    return new Promise((resolve) => {
      let done = false
      const finish = (r) => { if (!done) { done = true; resolve(r) } }
      try {
        const { spawn } = require('child_process')
        const p = spawn(py, args, { windowsHide: true })
        let out = '', err = ''
        const t = setTimeout(() => { try { p.kill() } catch (e) {} finish({ code: -1, stdout: out, stderr: 'timeout' }) }, timeoutMs)
        p.stdout.on('data', (d) => { out += String(d) })
        p.stderr.on('data', (d) => { err += String(d) })
        p.on('close', (code) => { clearTimeout(t); finish({ code, stdout: out, stderr: err }) })
        p.on('error', (e) => { clearTimeout(t); finish({ code: -9, stdout: '', stderr: String((e && e.message) || e) }) })
      } catch (e) {
        finish({ code: -9, stdout: '', stderr: String((e && e.message) || e) })
      }
    })
  }

  async function getBuEnvInfo(pyOverride) {
    const py = pyOverride || getBuPython()
    const info = {
      py, pythonPath: py, pythonVersion: '', playwright: '', browserUse: '',
      ok: false, builtin: py === BUILTIN_PY,
    }
    try {
      const r3 = await runPy(py, ['-c', 'import sys; print(sys.version.split()[0])'], 20000)
      if (r3.code === 0) info.pythonVersion = String(r3.stdout || '').trim()
      const r1 = await runPy(py, ['-c', 'import playwright; print(getattr(playwright, "__version__", "ok"))'], 25000)
      if (r1.code === 0) info.playwright = String(r1.stdout || '').trim() || 'ok'
      const r2 = await runPy(py, ['-c', 'import browser_use'], 25000)
      if (r2.code === 0) info.browserUse = 'ok'
      info.ok = !!(info.playwright && info.browserUse)
    } catch (e) { info.error = String((e && e.message) || e) }
    return info
  }

  async function reportBuEnv(info) {
    try {
      const serverUrl = process.env.SERVER_URL || 'https://ai-niuma.cc'
      const cookie = await getServerCookie().catch(() => '')
      if (!cookie) return
      await fetch(serverUrl.replace(/\/$/, '') + '/api/agent/client-env', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({
          pythonVersion: info.pythonVersion || '', pythonPath: info.pythonPath || '',
          builtin: !!info.builtin, playwright: info.playwright || '',
          browserUse: info.browserUse || '', ok: !!info.ok,
        }),
      })
    } catch (e) { /* 忽略 */ }
  }

  async function ensureBuEnvOnStartup() {
    try {
      buLog('[bu-env] 启动自检：检查发布环境...')
      let info = await getBuEnvInfo()
      if (info.ok) {
        buLog('[bu-env] 环境已就绪：' + JSON.stringify(info))
      } else {
        buLog('[bu-env] 缺组件 → 后台安装：' + JSON.stringify(info))
        const r = await ensureBuPython()
        info = await getBuEnvInfo(r && r.py ? r.py : undefined)
        buLog('[bu-env] 安装后：' + JSON.stringify(info))
        // 2026-09-13: 【删除白色弹窗】（用户要求）——原来装完会弹 dialog 说"Python 3.14.0/playwright/browser_use"
        //   ① 与自检重复：下面 reportBuEnv(info) 已上报服务器，AGENT 自检的「发布运行环境」项直接读它
        //   ② 与自动更新抢焦点：更新小窗弹出时被它插一脚，看着乱
        //   ③ 用户原话："感觉很怪"、"和自检在一起已经够了"
        //   现在：只写 buLog（日志可查）+ 上报服务器（自检展示）；环境未就绪时也不再弹窗打断
        buLog('[bu-env] 环境状态（不弹窗）：' + JSON.stringify(info))
      }
      cached = info
      try { await reportBuEnv(info) } catch (e3) { buLog('[bu-env] 上报失败：' + String((e3 && e3.message) || e3)) }
      return info
    } catch (e) {
      buLog('[bu-env] 启动自检异常：' + String((e && e.message) || e))
      return { ok: false, error: String((e && e.message) || e) }
    }
  }

  function getCached() { return cached }

  return { getBuEnvInfo, ensureBuEnvOnStartup, reportBuEnv, getCached }
}
