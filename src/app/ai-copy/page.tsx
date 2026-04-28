'use client';
import { useState } from 'react'

export default function AICopyPage() {
  const [keywords, setKeywords] = useState('')
  const [platform, setPlatform] = useState('douyin')
  const [style, setStyle] = useState('catchy')
  const [isGenerating, setIsGenerating] = useState(false)
  const [copyContent, setCopyContent] = useState<string[]>([])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setIsGenerating(true)
    
    // 模拟 AI 生成过程
    setTimeout(() => {
      const mockCopies = [
        `🔥 ${keywords} 太绝了！我不允许你还不知道这个秘密... #${keywords} #好物推荐`,
        `姐妹们！${keywords} 真的yyds，用过就再也回不去了！#${keywords} #生活必备`,
        `别再花冤枉钱了，${keywords} 让你的生活品质提升10倍！#${keywords} #省钱攻略`
      ]
      setCopyContent(mockCopies)
      setIsGenerating(false)
    }, 1500)
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-6">AI 文案生成</h1>
      
      <div className="bg-white shadow rounded-lg p-6">
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              关键词
            </label>
            <input 
              type="text" 
              value={keywords} 
              onChange={(e) => setKeywords(e.target.value)}
              placeholder="输入关键词，如：口红、健身、美食"
              className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                平台
              </label>
              <select 
                value={platform} 
                onChange={(e) => setPlatform(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="douyin">抖音</option>
                <option value="xiaohongshu">小红书</option>
                <option value="kuaishou">快手</option>
                <option value="weibo">微博</option>
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                风格
              </label>
              <select 
                value={style} 
                onChange={(e) => setStyle(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="catchy">吸引人</option>
                <option value="professional">专业</option>
                <option value="humorous">幽默</option>
                <option value="emotional">情感</option>
              </select>
            </div>
          </div>
          
          <div>
            <button 
              type="submit" 
              disabled={isGenerating}
              className="w-full py-3 bg-primary text-white rounded-md hover:bg-primary-dark disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {isGenerating ? '生成中...' : '生成文案'}
            </button>
          </div>
        </form>
        
        {copyContent.length > 0 && (
          <div className="mt-8">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">生成的文案</h2>
            <div className="space-y-4">
              {copyContent.map((copy, index) => (
                <div key={index} className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                  <p className="text-gray-800">{copy}</p>
                  <button className="mt-2 text-sm text-primary hover:text-primary-dark">
                    复制
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}