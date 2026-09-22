import { NextRequest, NextResponse } from 'next/server'
import path from 'path'
import fs from 'fs'
import { Readable } from 'stream'

export const dynamic = 'force-dynamic'

/** 生成物目录（服务器上固定 /root/AiMarketing/public/generated；本地开发回退 cwd/public/generated） */
function genDir(): string {
  const env = process.env.GENERATED_DIR
  if (env) return env
  if (fs.existsSync('/root/AiMarketing/public/generated')) return '/root/AiMarketing/public/generated'
  return path.join(process.cwd(), 'public', 'generated')
}

/**
 * ★2026-09-22 重写（用户实测「播放 3~4 秒必卡一下」+ 用户要求修下载/播放）：
 *
 * 原来的三个硬伤（同一段代码）：
 *   ① **路径校验是死代码**：`if (!fileId || !/^[a-zA-Z0-9._\-]+$/.test(fileId)) return …`
 *      被误写进了 `Content-Disposition` 的**模板字符串里** → 从来不会执行（`../` 可穿越）。
 *   ② **`Content-Disposition` 里含换行/注释** → Node 设非法头会抛错 → 任何已存在的文件都 500。
 *   ③ **`fs.readFileSync` 整文件读内存 + 强制 attachment + 不支持 Range**
 *      → 浏览器无法边下边播/拖动进度，长视频必卡（这正是"每 3~4 秒卡一下"的经典成因）。
 *
 * 现在：路径校验回到代码里 + 支持 `Range`（206 Partial Content）+ `inline` + 流式返回（不吃内存）。
 */
export async function GET(request: NextRequest) {
  const rawId = (request.nextUrl.searchParams.get('id') || '').trim()
  // 允许传 "xxx" 或 "xxx.mp4"；其余一律拒绝（防路径穿越）
  const base = rawId.replace(/\.mp4$/i, '')
  if (!base || !/^[a-zA-Z0-9._-]+$/.test(base)) {
    return NextResponse.json({ success: false, message: 'fileId 非法' }, { status: 400 })
  }
  const dir = path.resolve(genDir())
  const filePath = path.resolve(path.join(dir, base + '.mp4'))
  if (!filePath.startsWith(dir + path.sep)) {
    return NextResponse.json({ success: false, message: '非法路径' }, { status: 400 })
  }
  let size = 0
  try {
    size = fs.statSync(filePath).size
  } catch {
    return NextResponse.json({ success: false, message: '文件不存在' }, { status: 404 })
  }

  const common = {
    'Content-Type': 'video/mp4',
    'Accept-Ranges': 'bytes',          // ★关键：告诉浏览器"可以按段请求"（可拖动、可边下边播）
    'Cache-Control': 'public, max-age=86400',
  }

  // ── Range 请求（播放器几乎总是带 Range）→ 206 ──
  const range = request.headers.get('range')
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range)
    let start = m && m[1] ? parseInt(m[1], 10) : 0
    let end = m && m[2] ? parseInt(m[2], 10) : size - 1
    if (!Number.isFinite(start) || start < 0) start = 0
    if (!Number.isFinite(end) || end >= size) end = size - 1
    if (start > end || start >= size) {
      return new NextResponse(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
    }
    const stream = fs.createReadStream(filePath, { start, end })
    return new NextResponse(Readable.toWeb(stream) as any, {
      status: 206,
      headers: {
        ...common,
        'Content-Length': String(end - start + 1),
        'Content-Range': `bytes ${start}-${end}/${size}`,
      },
    })
  }

  // ── 无 Range → 整段流式返回（不再 readFileSync 进内存）──
  const stream = fs.createReadStream(filePath)
  return new NextResponse(Readable.toWeb(stream) as any, {
    status: 200,
    headers: { ...common, 'Content-Length': String(size) },
  })
}
