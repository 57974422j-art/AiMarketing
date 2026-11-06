/**
 * LAB2 · 取回产物 HTML
 *
 * ★★★ 2026-11-06 用户：「你说救活了，这2单在哪里？怎么看？你救到哪里去了。」
 *
 * 之前三次「救活」只在本地 temp 里验证，**线上原文件没动** ⇒ 用户看不到效果。
 * 现在：**读取时自动跑一遍 repairHtml**
 *   · 打开历史旧单（比如 gen_20261106_114737 / 120702）⇒ 直接是修好的样子
 *   · 想看原始坏的样子 ⇒ 加 `&raw=1`
 */
import { NextRequest } from 'next/server'
import fs from 'node:fs'
import path from 'node:path'
import { repairHtml } from '@/lib/lab2/repair'

export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams
  const name = String(sp.get('name') || '')
  const repoId = String(sp.get('repoId') || '1')
  /** raw=1 ⇒ 不修，看原件（对照用） */
  const raw = sp.get('raw') === '1'

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

  let html = fs.readFileSync(p, 'utf8')
  const headers: Record<string, string> = {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  }

  if (!raw) {
    const r = repairHtml(html)
    if (r.total > 0) {
      html = r.html
      console.log('[lab2-file] 读时修复 ' + name
        + '：死锁 ' + r.deadlock + ' / 段落id ' + r.ids + ' / 终态 ' + r.animIn)
      headers['X-Repaired'] = 'deadlock=' + r.deadlock + ',ids=' + r.ids + ',animIn=' + r.animIn
    }
  }

  return new Response(html, { headers })
}
