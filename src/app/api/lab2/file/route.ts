/**
 * ★LAB2 · 取回产物 HTML
 */
import { NextRequest } from 'next/server'
import fs from 'node:fs'
import path from 'node:path'

export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams
  const name = String(sp.get('name') || '')
  const repoId = String(sp.get('repoId') || '1')
  /* 只允许仓库命名（gen_YYYYMMDD_HHMMSS[_N].html 或旧 gen_YYYYMMDD_NNN.html）或旧 lab2_ 命名 */
  if (
    !/^gen_\d{8}_\d{6}(_\d+)?\.html$/.test(name)
    && !/^gen_\d{8}_\d{3}\.html$/.test(name)
    && !/^lab2_[\d]+\.html$/.test(name)
  ) {
    return new Response('bad name', { status: 400 })
  }
  if (!/^\d+$/.test(repoId)) return new Response('bad repoId', { status: 400 })
  let p = path.join(process.cwd(), 'storage', repoId, name)
  if (!fs.existsSync(p)) p = path.join(process.cwd(), 'temp', '_lab2', 'out', name)
  if (!fs.existsSync(p)) return new Response('not found', { status: 404 })
  const html = fs.readFileSync(p, 'utf8')
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}
