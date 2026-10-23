import { NextRequest, NextResponse } from 'next/server'
import { getAuthFromHeaders } from '@/lib/api-auth'

/**
 * 配音稿「✨ 改这一段」
 *
 * ★VF_VOICE_REVISE_V1（2026-10-23 用户定案：第四步卡片上要能"选中某段 → 让 AI 写钩子/折扣/口语"）
 * ★VF_VOICE_REVISE_CTX_V1（2026-10-23 用户追加要求：「**不要只给一句，把图和整体文案一起给 AI**，
 *   这样改出来才不会跑远」）：
 *   现在每次都带三样东西：
 *     ① **全篇文案**（它能看到前后在讲什么 ⇒ 这一句要接得上）
 *     ② **这一段的画面字**（画面上写的什么）
 *     ③ **这一段用的图**（从个人仓库取，缩到 512 后以多模态喂进去 ⇒ 它写"图里的事"）
 *
 * POST { text, style, segTitle?, topic?, lines?: string[], index?: number, imgs?: number[] }
 * => { success, data: { text, style, styleName, sawImages } }
 */
export const maxDuration = 60
export const dynamic = 'force-dynamic'

const MAX_CHARS = 22

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
  plain: {
    name: '更直白',
    rule: '把话说**更直白**：不用比喻、不用形容词堆砌，一句话说清"这里有什么、对你有什么用"。',
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

/** 取这一段用的图，缩到 512 再转 base64（和大模型入口同口径，避免请求体过大） */
async function loadImages(uid: string, imgs: number[]): Promise<string[]> {
  const out: string[] = []
  if (!imgs.length) return out
  let sharpMod: any = null
  try { sharpMod = (await import('sharp')).default } catch { /* 没有 sharp 就用原图 */ }
  const { getObject } = await import('@/lib/oss')
  for (const n of imgs.slice(0, 4)) {
    try {
      const buf = await getObject('storage/' + uid + '/' + n + '.jpg')
      if (!buf || !buf.length) continue
      let b = buf
      if (sharpMod) {
        try { b = await sharpMod(buf).resize(512, 512, { fit: 'inside' }).jpeg({ quality: 70 }).toBuffer() } catch { b = buf }
      }
      out.push('data:image/jpeg;base64,' + b.toString('base64'))
    } catch { /* 单张取不到就跳过，不阻断 */ }
  }
  return out
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
  const lines: string[] = Array.isArray(body?.lines) ? body.lines.map((x: any) => String(x == null ? '' : x)) : []
  const index = Number(body?.index)
  const imgs: number[] = (Array.isArray(body?.imgs) ? body.imgs : []).map((x: any) => Number(x)).filter((x: number) => x > 0)

  if (!text) return NextResponse.json({ success: false, message: '这段现在是空的，先写一句再让 AI 改' }, { status: 400 })
  const rule = STYLE_RULES[style]
  if (!rule) return NextResponse.json({ success: false, message: '不认识的风格：' + style }, { status: 400 })

  /* 上下文：前后各 2 段（让它知道"这一句要接得上什么"）。
     用序号标注当前段，避免它改错对象。 */
  let ctx = ''
  if (lines.length && Number.isFinite(index) && index >= 0 && index < lines.length) {
    const from = Math.max(0, index - 2)
    const to = Math.min(lines.length - 1, index + 2)
    const rows: string[] = []
    for (let i = from; i <= to; i++) {
      const mark = i === index ? ' ← 【要改的是这一句】' : ''
      rows.push('  段' + (i + 1) + '：' + (String(lines[i] || '').trim() || '（空）') + mark)
    }
    ctx = '【全片里这一段的位置（共 ' + lines.length + ' 段）】\n' + rows.join('\n')
  }

  const prompt = [
    '你在改写一条**竖屏短视频**的口播旁白，只改其中**一句**。',
    topic ? '整条片的主题：' + topic : '',
    segTitle ? '这一段的画面文字是：「' + segTitle + '」（旁白要和它说的是同一件事的另一面，不要换成别的话题）' : '',
    ctx ? '\n' + ctx : '',
    '',
    '【现在这句】',
    text,
    '',
    '【改成什么风格】' + rule.name + '——',
    rule.rule,
    '',
    '【硬要求】',
    '1. **不超过 ' + MAX_CHARS + ' 个汉字**（这一句多长决定这一段多长）；',
    '2. ⚠️**要接得上前后**：只看你这一句和上一句、下一句连起来，应该像一个人在顺着说，不是突然插一句；',
    '3. ⚠️**每句必须"有人"**：人的动作 / 感受 / 理由 / 场景；',
    '   ❌「四个凳子摆在中间」（只有东西）  ✅「四个位子，坐下就有人招呼」；',
    '4. **不许和画面文字连续 4 个字相同**（不能照抄画面上的字）；',
    '5. **不许编造**店名 / 价格 / 评分 / 销量；',
    '6. 简体中文、不用 emoji、不堆感叹号；',
    '7. **只输出这一句**，不要解释、不要引号、不要序号。',
  ].filter(Boolean).join('\n')

  const key = pickKey()
  if (!key) return NextResponse.json({ success: false, message: '没有配置 DEEPSEEK_API_KEY' }, { status: 500 })

  // 取这一段的图（有就给，多模态；取不到就纯文本，不阻断）
  let imageUrls: string[] = []
  try {
    const uid = String((auth as any)?.userId || (auth as any)?.uid || '')
    if (uid && imgs.length) imageUrls = await loadImages(uid, imgs)
  } catch { imageUrls = [] }

  try {
    const content: any = imageUrls.length
      ? [{ type: 'text', text: prompt + '\n\n（下面几张是**这一段画面里用的图**，按顺序）' },
        ...imageUrls.map((url) => ({ type: 'image_url', image_url: { url } }))]
      : prompt

    const r = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({
        model: 'deepseek-flash',
        messages: [{ role: 'user', content }],
        temperature: 0.9,
        /* ★VF_REWRITE_NOTHINK_V1（2026-10-24 冒烟测试实锤）：
           `deepseek-flash` 带思考，会先写 5000~10000 字 reasoning 再写答案；
           实测关掉思考后 **思考 0 字、2.2 秒返回**（不关要 35~44 秒，且额度小时答案会被挤成 0 字）。
           ⇒ 单段改写同样关掉。 */
        thinking: { type: 'disabled' },
        max_tokens: 2000,
      }),
      signal: AbortSignal.timeout(45000),
    })
    const j: any = await r.json().catch(() => null)
    let out = String(j?.choices?.[0]?.message?.content || '').trim()
    out = out.replace(/^[\s"'“”‘’]+|[\s"'“”‘’]+$/g, '')
      .replace(/^\d+[.、)]\s*/, '')
      .replace(/^(改后|新版|这句)[:：]\s*/, '')
      .replace(/\s*\n+\s*/g, ' ')
      .trim()
    if (!out) {
      return NextResponse.json({ success: false, message: 'AI 没给结果（finish=' + String(j?.choices?.[0]?.finish_reason || '?') + '）' }, { status: 502 })
    }
    return NextResponse.json({
      success: true,
      data: { text: out, style, styleName: rule.name, sawImages: imageUrls.length > 0 },
    })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: '改写失败：' + String(e?.message || e).slice(0, 120) }, { status: 502 })
  }
}
