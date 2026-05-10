import { NextRequest, NextResponse } from 'next/server';
import { getAuthFromHeaders } from '@/lib/api-auth';
import { generateText } from '@/lib/ai-providers';

export async function POST(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })

  try {
    const { description } = await request.json();
    if (!description) {
      return NextResponse.json({ success: false, message: '缺少需求描述' }, { status: 400 })
    }

    // 调用百炼通义千问自动生成 AI 员工配置
    const prompt = `根据以下需求描述，为一个AI客服员工生成完整的配置信息，以JSON格式返回（只返回JSON，不要任何解释）：

需求描述：${description}

返回以下 JSON 字段：
- name: 员工名字（2-6个字）
- welcomeMessage: 欢迎语（20字以内）
- replyStyle: 回复风格（亲切/专业/幽默/正式 四选一）
- promptTemplate: 角色设定提示词（50-100字，描述角色定位和回复准则）
- trainingDocuments: 培训文档数组，每个包含 title（标题）、content（内容）、type（话术/FAQ）

示例输出格式：
{"name":"价格咨询客服","welcomeMessage":"您好！我是价格咨询客服...","replyStyle":"亲切","promptTemplate":"你是一个...","trainingDocuments":[{"title":"价格引导话术","content":"具体价格需要...","type":"话术"}]}`

    const result = await generateText(prompt)
    if (!result) {
      return NextResponse.json({ success: false, message: 'AI 服务不可用' }, { status: 503 })
    }

    // 解析 JSON
    const jsonMatch = result.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return NextResponse.json({ success: false, message: 'AI 返回格式错误' }, { status: 500 })
    }
    const generated = JSON.parse(jsonMatch[0])

    return NextResponse.json({ success: true, data: generated })
  } catch (error) {
    console.error('生成AI员工错误:', error)
    return NextResponse.json({ success: false, message: '生成失败' }, { status: 500 })
  }
}
