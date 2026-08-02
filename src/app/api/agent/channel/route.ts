import { NextRequest, NextResponse } from 'next/server'

// 阶段四·微信/飞书渠道（融合 BaiLongma 的 IM 连接能力，轻量骨架）
// 把 AGENT 对话内核通过 webhook 接到微信公众号/企业微信/飞书。
// 配置：环境变量 AGENT_WEBHOOK_WECHAT / AGENT_WEBHOOK_FEISHU（机器人 webhook URL）
export async function POST(request: NextRequest) {
  try {
    const { channel, text } = await request.json()
    if (!channel || !text) return NextResponse.json({ success: false, message: '缺少 channel/text' }, { status: 400 })
    const url =
      channel === 'wechat' ? process.env.AGENT_WEBHOOK_WECHAT :
      channel === 'feishu' ? process.env.AGENT_WEBHOOK_FEISHU : null
    if (!url) {
      return NextResponse.json({ success: false, message: `未配置 ${channel} webhook（设置 AGENT_WEBHOOK_${channel.toUpperCase()} 环境变量）` })
    }
    // 飞书/企业微信机器人 webhook 通用格式
    const payload = channel === 'feishu'
      ? { msg_type: 'text', content: { text } }
      : { msgtype: 'text', text: { content: text } }
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const out = await r.text()
    return NextResponse.json({ success: r.ok, status: r.status, echo: out.slice(0, 200) })
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
