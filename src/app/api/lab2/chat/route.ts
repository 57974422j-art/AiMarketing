/**
 * LAB2 · 对话改片（2026-11-04）
 *
 * 用户：「实验2 要能跟我实现长期会话，自己有记忆。我要它能和我正常会话。」
 *
 * 分工（刻意做窄，避免和 /api/lab2 重复）：
 *   /api/lab2       → **首轮生成**（读图、拼总览、兜底、存文件）—— 不变
 *   /api/lab2/chat  → **后续对话改片**：只拿「当前 HTML + 历史对话」去改
 *
 * 为什么这么分：
 *   · 图在首轮已经内联成 base64 进 HTML 了，改片不需要再读素材
 *   · 会话历史 + 当前版本 ⇒ 它知道"我在改哪一版、之前改过什么"（这就是记忆）
 */

import { NextRequest, NextResponse } from 'next/server'
import fs from 'node:fs'
import path from 'node:path'
import { getAuthFromHeaders, getAuthFromCookie } from '@/lib/api-auth'
import { getOrCreateSession, appendMessage, listSessions, type ChatMsg } from '@/lib/lab2/session'

export const maxDuration = 900
export const dynamic = 'force-dynamic'

function repoDir(uid: string) {
  return path.join(process.cwd(), 'storage', uid)
}

/** 读当前版本的 HTML（本地 storage） */
function readHtml(uid: string, name: string): string {
  if (!name) return ''
  try {
    const p = path.join(repoDir(uid), name)
    if (!fs.existsSync(p)) return ''
    return fs.readFileSync(p, 'utf8')
  } catch { return '' }
}

/** 存新版本（沿用 uniqueName：时间戳，不覆盖） */
function writeHtml(uid: string, html: string): string {
  const d = new Date()
  const ymd = d.toISOString().slice(0, 10).replace(/-/g, '')
  const hms = String(d.getHours()).padStart(2, '0')
    + String(d.getMinutes()).padStart(2, '0')
    + String(d.getSeconds()).padStart(2, '0')
  const dir = repoDir(uid)
  fs.mkdirSync(dir, { recursive: true })
  let name = 'gen_' + ymd + '_' + hms + '.html'
  let n = 1
  while (fs.existsSync(path.join(dir, name)) && n < 100) {
    name = 'gen_' + ymd + '_' + hms + '_' + n + '.html'
    n++
  }
  fs.writeFileSync(path.join(dir, name), html, 'utf8')
  return name
}

/** 把 HTML 压到能塞进 prompt 的规模（只保留结构，去掉 base64 正文） */
function trimHtml(html: string, max = 90000): string {
  /* base64 保留前 200 字符（够识别），其余省略 —— 否则 5MB 进不了上下文 */
  let out = html.replace(
    /data:image\/([a-z]+);base64,[A-Za-z0-9+/=]+/gi,
    (_m, t) => 'data:image/' + t + ';base64,__KEEP__',
  )
  if (out.length > max) out = out.slice(0, max) + '\n<!-- 后面省略 -->'
  return out
}

/** 还原 __KEEP__（给新生成的结果回填原图） */
function restoreKeep(newHtml: string, oldHtml: string): string {
  const all = [...oldHtml.matchAll(/data:image\/([a-z]+);base64,[A-Za-z0-9+/=]+/gi)].map((m) => m[0])
  let i = 0
  return newHtml.replace(/data:image\/([a-z]+);base64,__KEEP__/gi, () => all[i++] || '')
}

const SYSTEM = `你是一位**动态设计导演**，正在和客户一起改一条已经做好的动态影片（HTML 单文件）。

规则：
· 只改客户说的那部分。**没提到的地方一律不动**（尤其是图片、段落时长、播放脚本）。
· 图片是 data:image/...;base64,__KEEP__ 占位 —— **原样保留这个字符串**，系统会填回真图。
  绝不要改写、缩短或删掉它。
· 每次改完，先用 2~4 行说清「改了什么、为什么」，再给完整 HTML。

输出格式（严格）：
<<<REPLY>>>
改了什么（2~4 行，说人话）
<<<HTML>>>
<!DOCTYPE html>
...完整 HTML（含所有原有内容）...`

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const authUser = getAuthFromHeaders(req) || getAuthFromCookie(req)
    const userId = String(authUser?.userId || body?.userId || '1')

    /* ── 只读会话（前端打开页面时拉历史）── */
    if (body?.action === 'list') {
      return NextResponse.json({ ok: true, sessions: listSessions(userId) })
    }
    /* ── 读某个会话的历史消息（页面打开时恢复对话）── */
    if (body?.action === 'history') {
      const sid0 = String(body?.sessionId || 'main')
      const s0 = getOrCreateSession(userId, sid0)
      return NextResponse.json({
        ok: true,
        sessionId: sid0,
        messages: s0.messages.map((m) => ({ role: m.role, text: m.text, htmlName: m.htmlName || '' })),
        currentHtmlName: s0.currentHtmlName,
        brief: s0.brief,
        url: s0.currentHtmlName
          ? '/api/lab2/file?name=' + encodeURIComponent(s0.currentHtmlName) + '&repoId=' + encodeURIComponent(userId)
          : '',
      })
    }

    const sid = String(body?.sessionId || 'main')
    const text = String(body?.text || '').trim()
    if (!text) return NextResponse.json({ ok: false, error: '请说点什么' }, { status: 400 })

    const s = getOrCreateSession(userId, sid)

    /* ── 读当前版本 ── */
    const curHtml = readHtml(userId, s.currentHtmlName)
    if (!curHtml) {
      return NextResponse.json({
        ok: false,
        error: '这个会话还没有成片 —— 先在左边点「生成」做一版，再聊着改',
      }, { status: 400 })
    }

    /* ── 记下用户这句 ── */
    appendMessage(userId, sid, { role: 'user', text, ts: new Date().toISOString() })

    /* ── 拼历史（最近 12 条，只带文字，不带 HTML）── */
    const hist = s.messages.slice(-12).map((m: ChatMsg) =>
      (m.role === 'user' ? '【客户】' : '【你】') + m.text
    ).join('\n')

    const brief = s.brief
    const ask = [
      '【这条片子的基本信息】',
      `画布：${brief.W} × ${brief.H}（${brief.aspect}）· 素材 ${brief.imgCount || brief.imgs.length} 张`,
      brief.contentType ? '内容类型：' + brief.contentType : '',
      '',
      '【之前聊过的】',
      hist || '(这是第一次对话)',
      '',
      '【当前这一版的完整 HTML】',
      '```html',
      trimHtml(curHtml),
      '```',
      '',
      '【客户这次的要求】',
      text,
      '',
      '按上面的格式输出（先 REPLY 说改了什么，再给完整 HTML）。',
    ].filter(Boolean).join('\n')

    const key = String(process.env.DEEPSEEK_API_KEY || '').trim()
    if (!key) return NextResponse.json({ ok: false, error: '缺少 DEEPSEEK_API_KEY' }, { status: 500 })

    const r = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: ask },
        ],
        temperature: 0.5,
        max_tokens: 64000,
      }),
    })

    if (!r.ok) {
      const err = await r.text().catch(() => '')
      return NextResponse.json({ ok: false, error: 'AI 调用失败 ' + r.status + ' ' + err.slice(0, 200) }, { status: 500 })
    }

    const j = await r.json()
    const raw = String(j?.choices?.[0]?.message?.content || '')

    /* ── 解析 <<<REPLY>>> / <<<HTML>>> ── */
    let reply = ''
    let newHtml = ''
    const mR = raw.match(/<<<REPLY>>>([\s\S]*?)(?=<<<HTML>>>|$)/)
    if (mR) reply = mR[1].trim()
    const mH = raw.match(/<<<HTML>>>([\s\S]*)/)
    if (mH) newHtml = mH[1].trim()

    if (!newHtml) {
      /* 没按格式 ⇒ 兜底：取完整的 html 文档 */
      const m2 = raw.match(/<!DOCTYPE html>[\s\S]*<\/html>/i)
      if (m2) {
        newHtml = m2[0]
        if (!reply) reply = raw.slice(0, raw.indexOf(m2[0])).trim() || '已按你的要求改好。'
      }
    }
    if (!newHtml) {
      return NextResponse.json({ ok: false, error: 'AI 没返回完整 HTML，请再试一次' }, { status: 500 })
    }

    /* 回填图片 */
    newHtml = restoreKeep(newHtml, curHtml)

    /* 存新版本 */
    const name = writeHtml(userId, newHtml)

    /* 同步 OSS（让仓库页能看到） */
    let ossMsg = ''
    try {
      const { putObject } = await import('@/lib/oss')
      await putObject('storage/' + userId + '/' + name, Buffer.from(newHtml, 'utf8'), 'text/html')
      ossMsg = '（已同步 OSS）'
    } catch { ossMsg = '（OSS 未同步）' }

    appendMessage(userId, sid, {
      role: 'assistant',
      text: reply || '已改好',
      htmlName: name,
      ts: new Date().toISOString(),
    })

    return NextResponse.json({
      ok: true,
      reply: reply || '已改好',
      name,
      url: '/api/lab2/file?name=' + encodeURIComponent(name) + '&repoId=' + encodeURIComponent(userId),
      savedTo: 'storage/' + userId + '/' + name + ossMsg,
      sessionId: sid,
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message || e) }, { status: 500 })
  }
}
