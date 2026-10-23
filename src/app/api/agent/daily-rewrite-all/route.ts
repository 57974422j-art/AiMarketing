import { NextRequest, NextResponse } from 'next/server'
import { getAuthFromHeaders } from '@/lib/api-auth'

/**
 * 配音稿「✍ 换个文案风格」—— **整篇批量重写**
 *
 * ★VF_VOICE_REWRITE_ALL_V1（2026-10-23 用户定案：第四步卡头加一个按钮，
 *   选一种文案形式就**全改**，并留一个"其它"让他自己写要求）
 *
 * 和「✨ 单段重写」的区别：
 *   · ✨ 只改**一段**（3 秒，救个别句子）
 *   · ✍ 改**全部**（一次调用，5~8 秒）⇒ 因为能**看到全篇**，所以能写出**一条线**
 *     （单段写不出主线，这是 2026-10-23 讨论里确认的根因）
 *
 * POST { lines: string[], segs: {title,points}[], style: string, extra?: string, topic?: string }
 * => { success, data: { lines: string[], style, styleName } }
 */
export const maxDuration = 60
export const dynamic = 'force-dynamic'

const MAX_CHARS = 22

const STYLES: Record<string, { name: string; rule: string }> = {
  oral: {
    name: '口语闲聊',
    rule: '像**朋友在旁边随口介绍**：短句、口头词、能听见人味儿；不要"本店""致力于"这种书面语。',
  },
  hook: {
    name: '钩子开场',
    rule: '**第一句就要抓人**（悬念 / 反常识 / 直给好处），后面每句都往"想继续看"上使劲；别用"大家好""今天带你"开场。',
  },
  seed: {
    name: '种草安利',
    rule: '像**小红书真诚安利**：先说我为什么来，再说哪里好，最后给一个"值得来"的理由；可以有"我真的会"这种真人口气。',
  },
  story: {
    name: '探店纪实',
    rule: '**跟着一条动线走**（进门 → 点单/入座 → 上手 → 收尾），像带着看的人走一遍；每句都是"走到哪、看到什么、什么感觉"。',
  },
  promo: {
    name: '促销硬广',
    rule: '突出**划算 / 分量 / 福利**：值不值、够不够、划不划算。⚠️**不许编具体价格和折扣数字**（素材里没有），用"这价格""一份的量"这种说法。',
  },
  calm: {
    name: '文艺克制',
    rule: '**少形容词、多具体物**：写光、写材质、写动作，让画面自己说话；不要滥情，不要"惊艳""治愈"这类空词。',
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
  if (!auth) return NextResponse.json({ success: false, message: '未登录' }, { status: 401 })

  let body: any = {}
  try { body = await request.json() } catch { /* ignore */ }

  const lines: string[] = Array.isArray(body?.lines) ? body.lines.map((x: any) => String(x == null ? '' : x)) : []
  const segs: any[] = Array.isArray(body?.segs) ? body.segs : []
  const style = String(body?.style || 'oral')
  const extra = String(body?.extra || '').trim()
  const topic = String(body?.topic || '').trim()

  if (!lines.length) return NextResponse.json({ success: false, message: '没有可改的口播稿' }, { status: 400 })
  if (lines.length > 40) return NextResponse.json({ success: false, message: '段数太多（>40），请先用单段重写' }, { status: 400 })

  const st = STYLES[style]
  if (!st) return NextResponse.json({ success: false, message: '不认识的风格：' + style }, { status: 400 })

  // 把"这一段画面上写的是什么"一起给它 —— 否则它不知道每段对应哪张图
  const rows = lines.map((t, i) => {
    const s = segs[i] || {}
    const tt = Array.isArray(s.title) ? s.title.filter(Boolean).join(' / ') : String(s.title || '')
    const pts = Array.isArray(s.points) && s.points.length
      ? ' ｜ 信息点：' + s.points.map((p: any) => (Array.isArray(p) ? p.join('·') : String(p))).join('·')
      : ''
    return '  段' + (i + 1) + '：画面字「' + (tt || '（无）') + '」' + pts
      + '\n     现在这句：「' + (t || '（空，这一段不配音）') + '」'
  }).join('\n')

  const prompt = [
    '你在给一条**竖屏短视频**重写口播旁白。已经有一版了，现在要**整篇换一种写法**。',
    topic ? '整条片的主题：' + topic : '',
    '',
    '【全片的分段与现有文案】',
    rows,
    '',
    '【这次要换成什么风格】' + st.name + '——',
    st.rule,
    extra ? '\n【用户额外要求（优先级最高）】\n' + extra : '',
    '',
    '【硬要求】',
    '1. **总共 ' + lines.length + ' 句，一句对一段，顺序不变**；原来留空（写"（空）"）的段，这一版**也留空**；',
    '2. 每句 **不超过 ' + MAX_CHARS + ' 个汉字**；',
    '3. ⚠️**全片要是一条线，不是 ' + lines.length + ' 条独立图注**：',
    '   · 先在脑子里定一条动线（进门→坐下→上手→收尾 / 洗→剪→吹 / 看→吃→回味），让每句**承接上一句**；',
    '   · **不许盘点式**（段1凳子、段2镜子、段3台子）——那是图片说明，不是文案；',
    /* ★VF_VOICE_SHAPE_V1（2026-10-24 用户实测「16 句全是『XX，我YY』，逗号后面永远是我，不是完整通畅的」）：
       实测产物：「推门进来，我先盯住那口铜锅 / 坐下时汤还在滚，我等着动筷子 / 点完单，我摸到虾壳还凉…」
       ⇒ 单看每句都对，连起来像 16 条独立字幕。**病根是句式套模板 + 句间无挂钩**，不是内容不够。 */
    '   · ⚠️**句式不许套模板**：不要每句都写「某个东西，我某个动作」；',
    '     换着来（短句 / 陈述 / 转折 / 递进 / 只写动作），「我」最多占一半句子；',
    '   · ⚠️**上一句要带出下一句**：锅开了→下什么；肉上来了→多薄；蘸料调好→什么味；',
    '     顺序要合乎常理（点单在坐下之前、汤滚了才下肉），画面顺序别扭时用一句话绕过去；',
    '   · **通读测试**：' + lines.length + ' 句连起来念，应该像**一个人在饭桌上连着讲**，不是 ' + lines.length + ' 条字幕；',
    '4. ⚠️**每句必须"有人"**：人的动作 / 感受 / 理由 / 场景；',
    '   ❌「四个凳子摆在中间」（只有东西）  ✅「四个位子，坐下就有人招呼」；',
    '   ❌「镜子挂在墙上」  ✅「镜子里那个人，比进来时精神」；',
    '5. **不许复读画面字**（和画面字连续 4 个字相同就算抄）；',
    '6. **不许编造**素材里没有的事实（店名 / 评分 / 价格 / 销量 / 年份）；',
    '7. 简体中文、不用 emoji、不堆感叹号。',
    '',
    '只输出 JSON（不要解释、不要 markdown 围栏）：',
    '{"lines":["第一段","第二段","……"]}',
    '⚠️ lines 数组**必须正好 ' + lines.length + ' 条**。',
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
        temperature: 0.85,
      }),
      signal: AbortSignal.timeout(50000),
    })
    const j: any = await r.json().catch(() => null)
    /* ★VF_REWRITE_ERR_VISIBLE_V1（2026-10-23 用户实测「重写失败：AI 没给出可解析的结果（finish=?）」）：
       病灶：原来**不检查 `r.ok`**，直接把 `j.choices[0]` 取内容 ⇒ API 报错时（400/429/500）
            响应体是 `{error:{...}}`，`choices` 根本不存在 ⇒ 只剩一句 `finish=?`，
            **真实原因（余额/限流/参数/超长）全被吞掉** ⇒ 用户和我都猜不出为什么。
       现口径：**先把 HTTP 状态和 API 的 error 原样报出来**，再谈"解析不出 JSON"。 */
    if (!r.ok) {
      const apiMsg = String(j?.error?.message || j?.message || '').slice(0, 200) || ('HTTP ' + r.status)
      try { console.error('[改写整篇] DeepSeek ' + r.status + '：' + apiMsg) } catch { /* ignore */ }
      return NextResponse.json({
        success: false,
        message: 'DeepSeek 返回 ' + r.status + '：' + apiMsg
          + (r.status === 429 ? '（限流，等几秒再点）' : r.status === 402 ? '（余额不足）' : ''),
      }, { status: 502 })
    }
    const raw = String(j?.choices?.[0]?.message?.content || '')
    const finish = String(j?.choices?.[0]?.finish_reason || '?')
    const m = /\{[\s\S]*\}/.exec(raw)
    if (!m) {
      try {
        console.error('[改写整篇] 无 JSON · finish=' + finish + ' · 原文前 200 字：' + raw.slice(0, 200))
      } catch { /* ignore */ }
      return NextResponse.json({
        success: false,
        message: 'AI 没给出可解析的结果（finish=' + finish + '，输出 ' + raw.length + ' 字）'
          + (finish === 'length' ? '——输出被截断，段数太多，先用单段重写' : '')
          + (raw ? '；开头：' + raw.slice(0, 80) : '；响应是空的'),
      }, { status: 502 })
    }
    let out: string[] = []
    try {
      const o = JSON.parse(m[0])
      out = Array.isArray(o?.lines) ? o.lines.map((x: any) => String(x == null ? '' : x).trim()) : []
    } catch { out = [] }
    if (out.length !== lines.length) {
      return NextResponse.json({
        success: false,
        message: 'AI 返回的条数不对（要 ' + lines.length + ' 条，给了 ' + out.length + ' 条）—— 再点一次试试',
      }, { status: 502 })
    }
    return NextResponse.json({ success: true, data: { lines: out, style, styleName: st.name } })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: '重写失败：' + String(e?.message || e).slice(0, 140) }, { status: 502 })
  }
}
