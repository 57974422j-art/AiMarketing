import { NextRequest, NextResponse } from 'next/server'
import fs from 'node:fs'
import path from 'node:path'
import { getAuthFromHeaders } from '@/lib/api-auth'
import { vfTaskTraceDir, vfTaskTraceFile } from '@/lib/agent/video-material'
import { diagnoseTask } from '@/lib/agent/task-diagnose'

/**
 * ★VF_TASK_TRACE_V1-D2（2026-10-26 用户定案「看不到 AI 回复，每次要去服务器找很烦」）
 *
 * GET /api/agent/task-trace?taskId=vf1750…            ⇒ { ok, text }       原文（折叠展示 / 诊断输入）
 * GET /api/agent/task-trace?taskId=vf1750…&diag=1    ⇒ { ok, text, diagnosis:[…], diagRole }
 *
 * 安全范式**照抄** `/api/agent/daily-trace`（那个已经被线上用过）：
 *   · 文件名白名单 `^[A-Za-z0-9._-]{3,80}$`；
 *   · 禁止 `..`（防目录穿越）；
 *   · 单文件最多回 400KB（够看，不至于把接口拖死）；
 *   · **只读自己**的目录：`storage/<auth.userId>/video-factory/trace/` —— userId 只从鉴权头取，
 *     **绝不接受前端传 userId**。
 *
 * 权限（D4）：`role === 'admin'` 看全量（含 `evidence` 日志原文）；
 *            普通用户看 `what` / `why` / `fix`，**`evidence` 由服务端抹掉**
 *            （不是前端隐藏 —— 否则日志原文已经进了网络响应，藏了等于没藏）。
 *            口径取舍：文档写「只看 what + fix」，而 `why` 正是"人只看原因"的那个原因，
 *            真正会泄露内部信息的是 `evidence` 原文 ⇒ 只抹 evidence。
 */
export const maxDuration = 60
export const dynamic = 'force-dynamic'

const MAX_BYTES = 400 * 1024
const NAME_RE = /^[A-Za-z0-9._-]{3,80}$/

/** 只读自己那一单的 trace（文件名三重校验 + 前缀校验，读不到就如实说） */
function readTrace(userId: number, taskId: string): { text: string; size: number; err?: string } {
  const n = String(taskId || '').trim()
  if (!n) return { text: '', size: 0, err: '缺少 taskId' }
  if (!NAME_RE.test(n) || n.includes('..') || n.includes('/') || n.includes('\\')) {
    return { text: '', size: 0, err: 'taskId 不合法' }
  }
  const dir = vfTaskTraceDir(userId)
  const p = vfTaskTraceFile(userId, n)
  // 双保险：拼出来的路径必须仍在"自己的"trace 目录里
  if (!path.resolve(p).startsWith(path.resolve(dir) + path.sep)) {
    return { text: '', size: 0, err: '路径不合法' }
  }
  try {
    if (!fs.existsSync(p)) {
      return { text: '', size: 0, err: '这一单没有日志（只给新任务写；老任务本来就不留）' }
    }
    const st = fs.statSync(p)
    if (st.size > MAX_BYTES) {
      // 太大 ⇒ 只回**尾部** 400KB（诊断/排障看的就是最后发生了什么）
      const fd = fs.openSync(p, 'r')
      const buf = Buffer.alloc(MAX_BYTES)
      fs.readSync(fd, buf, 0, MAX_BYTES, Math.max(0, st.size - MAX_BYTES))
      fs.closeSync(fd)
      return {
        text: '……（文件 ' + Math.round(st.size / 1024) + 'KB，只显示尾部 400KB）\n' + buf.toString('utf8'),
        size: st.size,
      }
    }
    return { text: fs.readFileSync(p, 'utf8'), size: st.size }
  } catch (e: any) {
    return { text: '', size: 0, err: String(e?.message || e).slice(0, 120) }
  }
}

export async function GET(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ ok: false, message: '请先登录' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const taskId = String(searchParams.get('taskId') || '').trim()
  const wantDiag = /^(1|true|yes)$/i.test(String(searchParams.get('diag') || ''))
  if (!taskId) return NextResponse.json({ ok: false, message: '缺少 taskId' }, { status: 400 })

  const r = readTrace(auth.userId, taskId)
  const isAdmin = String(auth.role || '').toUpperCase() === 'ADMIN'

  // 不带 diag：只回原文（与文档口径一致 `{ ok, text }`）
  if (!wantDiag) {
    return NextResponse.json({ ok: !!r.text, text: r.text, size: r.size, ...(r.err ? { message: r.err } : {}) })
  }

  // 带 diag：AI 读日志出结论（诊断失败也不能 500）
  let diagnosis: any[] = []
  try {
    diagnosis = await diagnoseTask(r.text)
  } catch (e: any) {
    diagnosis = [{
      what: '诊断失败',
      why: String(e?.message || e).slice(0, 40),
      evidence: '日志里没记这一项',
      fix: '稍后再试，或直接看原始日志',
    }]
  }
  // ★权限闸门：普通用户**拿不到 evidence 原文**（服务端抹除，不是前端藏）
  const safe = isAdmin
    ? diagnosis
    : diagnosis.map((d) => ({ what: d.what, why: d.why, evidence: '', fix: d.fix }))

  return NextResponse.json({
    ok: !!r.text,
    text: r.text,
    size: r.size,
    diagnosis: safe,
    diagRole: isAdmin ? 'admin' : 'user',
    ...(r.err ? { message: r.err } : {}),
  })
}
