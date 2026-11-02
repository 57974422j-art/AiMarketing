/**
 * ★LAB2 · 取回产物 HTML
 */
import { NextRequest } from 'next/server'
import fs from 'node:fs'
import path from 'node:path'

export async function GET(req: NextRequest) {
  const name = String(new URL(req.url).searchParams.get('name') || '')
  if (!/^lab2_[\d]+\.html$/.test(name)) {
    return new Response('bad name', { status: 400 })
  }
  const p = path.join(process.cwd(), 'temp', '_lab2', 'out', name)
  if (!fs.existsSync(p)) return new Response('not found', { status: 404 })
  const html = fs.readFileSync(p, 'utf8')
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}
