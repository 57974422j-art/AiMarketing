import { NextRequest, NextResponse } from 'next/server'
import path from 'path'
import fs from 'fs'
import { getAuthFromHeaders } from '@/lib/api-auth'

const STORAGE_BASE = '/root/AiMarketing/public/storage'
const MAX_QUOTA = 500 * 1024 * 1024 // 500MB

function userDir(userId: number): string {
  const d = path.join(STORAGE_BASE, String(userId))
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true })
  return d
}

function usedQuota(userId: number): number {
  const dir = userDir(userId)
  let total = 0
  try {
    for (const f of fs.readdirSync(dir)) {
      const fp = path.join(dir, f)
      if (fs.statSync(fp).isFile()) total += fs.statSync(fp).size
    }
  } catch {}
  return total
}

export async function GET(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })

  const dir = userDir(auth.userId)
  const files = fs.readdirSync(dir)
    .filter(f => fs.statSync(path.join(dir, f)).isFile())
    .map(f => {
      const fp = path.join(dir, f)
      return { name: f, size: fs.statSync(fp).size, mtime: fs.statSync(fp).mtime.toISOString() }
    })
    .sort((a, b) => b.mtime.localeCompare(a.mtime))

  return NextResponse.json({ success: true, data: { files, used: usedQuota(auth.userId), total: MAX_QUOTA } })
}

export async function POST(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })

  const form = await request.formData()
  const file = form.get('file') as File
  if (!file) return NextResponse.json({ success: false, message: '缺少文件' }, { status: 400 })

  const used = usedQuota(auth.userId)
  if (used + file.size > MAX_QUOTA) {
    return NextResponse.json({ success: false, message: `存储空间不足（已用 ${(used / 1024 / 1024).toFixed(1)}MB / 500MB）` }, { status: 413 })
  }

  const dir = userDir(auth.userId)
  const ext = file.name.split('.').pop() || 'mp4'
  const name = Date.now() + '_' + file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const fp = path.join(dir, name)
  fs.writeFileSync(fp, Buffer.from(await file.arrayBuffer()))

  return NextResponse.json({ success: true, data: { name, size: file.size } })
}
