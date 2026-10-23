import { NextRequest, NextResponse } from 'next/server'
import { getAuthFromHeaders } from '@/lib/api-auth'

/**
 * 配音稿「✨ 让 AI 重写这一段」
 *
 * ★VF_VOICE_REVISE_V1（2026-10-23 用户定案：第四步卡片上要能"选中某段 → 让 AI 写钩子/折扣/口语"）
 *
 * 只做一件事：**把一句话改写成另一种口气**。
 *   · 不碰画面、不碰渲染、不碰草稿（前端拿到结果后自己决定要不要保存）
 *   · 3 秒返回，不需要出片
 *
 * POST { text, style, segTitle?, topic? }
 *   style: hook（开头抓人）/ promo（折扣团购）/ oral（口语）/ punch（更狠更短）
 * => { success, data: { text, style } }
 */
export const maxDuration = 30
export const dynamic = 'force-dynamic'

const STYLE_RULES: Record<string, { name: string; rule: string }> = {
  hook: {
    name: '钩子',
    rule: '写成**开头一句就抓住人**的说法：制造悬念、反常识、或直接抛出一个让人想往下看的点（别用"大家好""今天带你来"这种开场）。',
  },
  promo: {
    name: '促销',
    rule: '写成**带优惠感**的说法：突出划算、分量、性价比（比如"两个人一百出头吃到扶墙"）。\n'
      + '⚠️ **不许编具体价格/折扣数字**（素材里没有）——用"这价格""一份的量"这种模糊但有力的说法。',
  },
  oral: {
    name: '口语',
    rule: '写成**朋友聊天**的说法：短句、口头词、可以带一点语气词，念出来不别扭。',
  },
  punch: {
    name: '更狠',
    rule: '写成**更短更有冲击**的说法：砍掉所有铺垫，只留最狠的那半句（12 字以内优先）。',
  },
}

function pickKey(): string {
  return process.env.DEEPSEEK_API_KEY
    || (() => {
      try {
        const fs = require('node:fs')
        const path = require('node:path')
        const c = fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8')
        const m = c.match(/^DEEPSEEK_API_KEY=(.+)$/m)
        return m ? m[1].trim().replace(/^["']|["']$/g, '') : ''
      } catch { return '' }
    })()
}

export async function POST(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })

  let body: any = {}
  try { body = await request.json() } catch { /* ignore */ }

  const text = String(body?.text || '').trim()
  const style = String(body?.style || 'oral')
  const segTitle = String(body?.segTitle || '').trim()
  const topic = String(body?.topic || '').trim()

  if (!text) return NextResponse.json({ success: false, message: '这段现在是空的，先写一句再让 AI 改' }, { status: 400 })
  const rule = STYLE_RULES[style]
  if (!rule) return NextResponse.json({ success: false, message: '不认识的风格：' + style }, { status: 400 })

  const prompt = [
    '你在改写一条**竖屏短视频**的口播旁白，只改这一句。',
    topic ? '整条片的主题：' + topic : '',
    segTitle ? '这一段的画面文字是：「' + segTitle + '」（旁白要和它说的是同一件事的另一面，不要换成别的话题）' : '',
    '',
    '【现在这句】',
    text,
    '',
    '【改成什么风格】' + rule.name + '——',
    rule.rule,
    '',
    '【硬要求】',
    '1. **不超过 22 个汉字**（这一句多长决定这一段多长）；',
    '2. **不许和画面文字连续 4 个字相同**（不能照抄画面上的字）；',
    '3. 简体中文、不用 emoji、不堆感叹号；',
    '4. **只输出这一句**，不要解释、不要引号、不要序号。',
  ].filter(Boolean).join('\n')

  const key = pickKey()
  if (!key) return NextResponse.json({ success: false, message: '没有配置 DEEPSEEK_API_KEY' }, { status: 500 })

  try {
    const r = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({
        model: 'deepseek-flash',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.9,
      }),
      signal: AbortSignal.timeout(25000),
    })
    const j: any = await r.json().catch(() => null)
    let out = String(j?.choices?.[0]?.message?.content || '').trim()
    // 清掉模型可能加的引号/序号/前缀
    out = out.replace(/^[\s"'“”‘’]+|[\s"'“”‘’]+$/g, '')
      .replace(/^\d+[.、)]\s*/, '')
      .replace(/^(改后|新版|这句)[:：]\s*/, '')
      .replace(/\s*\n+\s*/g, ' ')
      .trim()
    if (!out) {
      return NextResponse.json({ success: false, message: 'AI 没给结果（finish=' + String(j?.choices?.[0]?.finish_reason || '?') + '）' }, { status: 502 })
    }
    return NextResponse.json({ success: true, data: { text: out, style, styleName: rule.name } })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: '改写失败：' + String(e?.message || e).slice(0, 120) }, { status: 502 })
  }
}
