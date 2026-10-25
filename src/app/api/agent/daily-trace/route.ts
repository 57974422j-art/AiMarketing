import { NextRequest, NextResponse } from 'next/server'
import fs from 'node:fs'
import path from 'node:path'
import { getAuthFromHeaders } from '@/lib/api-auth'

/**
 * ★VF_AIDESIGN_TRACE_V1（2026-10-25 用户「我想看到回执，不用每次去服务器找答案」）
 *
 * 交付卡上「🔍 AI 回执」按钮读这个接口：
 *   · `prompt` = 那次**发给 AI 的完整提示词**（我让它做什么）
 *   · `think`  = 那次的**思考 + 最终输出**（它怎么理解、实际写了什么）
 *
 * 为什么要存/要看：这轮定位「头尾为什么还是用了图」，唯一依据就是思考里那句
 *   "段1 和段14 可以用纯排版（允许），但为了铺满我可以用图 12 和 17"。
 *   没有它只能猜。
 *
 * GET /api/agent/daily-trace?prompt=<文件名>&think=<文件名>
 *   => { success, data: { prompt: {name, text, size}, think: {name, text, size} } }
 *
 * 安全：只允许读 `temp/aidesign-think/` 下的**单层文件**（文件名白名单 + 禁止 `..` / `/`），
 *       单文件最多回 400KB（前端够看，也不至于把接口拖死）。
 */
export const maxDuration = 30
export const dynamic = 'force-dynamic'

const MAX_BYTES = 400 * 1024
const NAME_RE = /^[A-Za-z0-9._-]{3,80}$/

function readOne(dir: string, name: string): { name: string; text: string; size: number; err?: string } {
  const n = String(name || '').trim()
  if (!n) return { name: '', text: '', size: 0 }
  if (!NAME_RE.test(n) || n.includes('..')) return { name: n, text: '', size: 0, err: '文件名不合法' }
  const p = path.join(dir, n)
  if (!p.startsWith(dir)) return { name: n, text: '', size: 0, err: '路径不合法' }
  try {
    if (!fs.existsSync(p)) return { name: n, text: '', size: 0, err: '文件不存在（可能已被轮转清理）' }
    const st = fs.statSync(p)
    if (st.size > MAX_BYTES) {
      const fd = fs.openSync(p, 'r')
      const buf = Buffer.alloc(MAX_BYTES)
      fs.readSync(fd, buf, 0, MAX_BYTES, 0)
      fs.closeSync(fd)
      return { name: n, text: buf.toString('utf8') + '\n\n…（文件 ' + Math.round(st.size / 1024) + 'KB，只显示前 400KB）', size: st.size }
    }
    return { name: n, text: fs.readFileSync(p, 'utf8'), size: st.size }
  } catch (e: any) {
    return { name: n, text: '', size: 0, err: String(e?.message || e).slice(0, 120) }
  }
}

export async function GET(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const promptName = String(searchParams.get('prompt') || '')
  const thinkName = String(searchParams.get('think') || '')
  if (!promptName && !thinkName) {
    return NextResponse.json({ success: false, message: '缺少文件名（prompt / think）' }, { status: 400 })
  }

  /* ★VF_AIDESIGN_TRACE_V1c（2026-10-25 实测：文件明明在 `/root/AiMarketing/temp/aidesign-think/`，
     接口却报"文件不存在"）：
     病灶：接口写死 `process.cwd()`，而 **PM2 / next start 的 cwd 不一定是项目根**
          （存的时候走的是 `vfRootDir()`，两者不是同一来源 ⇒ 存的目录 ≠ 读的目录）。
     现口径：**按文件名在候选目录里找**（哪个目录里真有这个文件就用哪个），
            和"存"彻底解耦，不依赖任何一方的 cwd。 */
  const cands = [
    path.join(process.cwd(), 'temp', 'aidesign-think'),
    path.join(process.env.VF_ROOT || '', 'temp', 'aidesign-think'),
    '/root/AiMarketing/temp/aidesign-think',
    path.join(process.cwd(), '..', '..', 'temp', 'aidesign-think'),
  ].filter((d) => !!d && d.length > 'temp/aidesign-think'.length)

  const pickDir = (name: string) => {
    const n = String(name || '').trim()
    if (!n || !NAME_RE.test(n)) return cands[0]
    for (const d of cands) {
      try { if (fs.existsSync(path.join(d, n))) return d } catch { /* ignore */ }
    }
    return cands[0]
  }

  return NextResponse.json({
    success: true,
    data: {
      prompt: readOne(pickDir(promptName), promptName),
      think: readOne(pickDir(thinkName), thinkName),
    },
  })
}
