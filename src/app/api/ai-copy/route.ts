import { NextRequest, NextResponse } from 'next/server'
import { generateText, isAIConfigured } from '@/lib/ai-providers'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { keywords, platform, style } = body
    
    if (!keywords || !platform || !style) {
      return NextResponse.json(
        { success: false, message: '缺少必要参数' },
        { status: 400 }
      )
    }
    
    if (!isAIConfigured()) {
      return NextResponse.json(
        {
          success: false,
          message: 'AI 接口未配置，请在 .env.local 文件中设置 AI_PROVIDER 和 AI_API_KEY'
        },
        { status: 400 }
      )
    }
    
    // 设计专业的营销文案提示词模板
    const prompt = `请为以下产品生成 5 条适合 ${platform} 平台的营销文案，风格为 ${style}：

产品关键词：${keywords}

要求：
1. 每条文案独立成段
2. 包含相关话题标签
3. 符合 ${platform} 平台的语言风格和用户习惯
4. 突出产品特点和价值
5. 每条文案末尾添加 [字数:XX] [场景:XX] 标签

示例：
🔥 口红太绝了！我不允许你还不知道这个秘密... #口红 #好物推荐 [字数:28] [场景:日常分享]

开始生成：`
    
    const result = await generateText(prompt, {
      temperature: 0.8,
      maxTokens: 2000
    })
    
    // 解析生成的文案
    const copies = result.split('\n')
      .filter(line => line.trim() !== '')
      .map(copy => {
        // 提取字数和场景信息
        const wordCountMatch = copy.match(/\[字数:(\d+)\]/)
        const sceneMatch = copy.match(/\[场景:(.+?)\]/)
        
        return {
          content: copy,
          wordCount: wordCountMatch ? parseInt(wordCountMatch[1]) : copy.length,
          scene: sceneMatch ? sceneMatch[1] : '通用'
        }
      })
    
    return NextResponse.json({
      success: true,
      copies
    })
  } catch (error) {
    console.error('AI 文案生成错误:', error)
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : '生成文案时发生错误'
      },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  // 模拟获取文案历史
  const history = [
    { id: 1, keywords: '口红', platform: '抖音', style: '吸引人', createdAt: new Date().toISOString() },
    { id: 2, keywords: '健身', platform: '小红书', style: '专业', createdAt: new Date().toISOString() },
    { id: 3, keywords: '美食', platform: '快手', style: '幽默', createdAt: new Date().toISOString() }
  ]
  
  return NextResponse.json(history)
}