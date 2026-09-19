import { NextRequest, NextResponse } from 'next/server'
import path from 'node:path'
import fs from 'node:fs'
import { vfStorageRoot } from '@/lib/agent/video-material'

// ★VF_ASYNC_V1（2026-09-18）：本地成片任务进度查询（给前端进度卡片轮询用）
//   任务文件由 chat/route.ts 的 make_ai_video 写入：
//     <LOCAL_STORAGE>/<userId>/video-factory/vf<ts>.json
//   内容：{ id, status: running|done|failed, startedAt, finishedAt, out, cost, tail, error }
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const userId = request.nextUrl.searchParams.get('userId') || ''
    const taskId = request.nextUrl.searchParams.get('taskId') || ''
    if (!userId) return NextResponse.json({ success: false, message: '缺少 userId' }, { status: 400 })

    const dir = path.join(vfStorageRoot(), String(userId), 'video-factory')
    if (!fs.existsSync(dir)) return NextResponse.json({ success: true, tasks: [] })

    let files = (fs.readdirSync(dir) as string[])
      .filter((f) => /^vf\d+\.json$/.test(f))
      .sort()
      .reverse()
    if (taskId) files = files.filter((f) => f.indexOf(taskId) >= 0)
    files = files.slice(0, 5)

    const tasks = files.map((f) => {
      try {
        const t = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
        const dur = t.startedAt ? Math.round((Date.now() - new Date(t.startedAt).getTime()) / 1000) : 0
        return {
          id: t.id, status: t.status, elapsedSec: dur,
          out: t.out || '', cost: t.cost || 0,
          // ★VF_REPO_V1（2026-09-18）：成片入库后的仓库文件名 + 24h 签名直链（前端给下载入口）
          repoName: t.repoName || '', url: t.url || '',
          tail: (t.tail || []).slice(-6),
          error: t.error || '',
        }
      } catch (e) {
        return { id: f.replace('.json', ''), status: 'unknown' }
      }
    })
    return NextResponse.json({ success: true, tasks })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
