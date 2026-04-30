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
    <div className="min-h-screen bg-gray-950">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <p className="text-label mb-2">AI 工作区 / AI WORKSPACE</p>
          <h1 className="text-mono-lg text-white">文案生成 / COPY WRITER</h1>
        </div>

        <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-6">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-label mb-2">
                <span>关键词</span>
                <span className="opacity-50 ml-1">KEYWORDS</span>
              </label>
              <input
                type="text"
                value={keywords}
                onChange={(e) => setKeywords(e.target.value)}
                placeholder="输入关键词... / Input keywords..."
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500/50"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-label mb-2">
                  <span>平台</span>
                  <span className="opacity-50 ml-1">PLATFORM</span>
                </label>
                <select
                  value={platform}
                  onChange={(e) => setPlatform(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-3 text-white focus:outline-none focus:border-emerald-500/50"
                >
                  <option value="douyin" className="bg-gray-900">抖音 / DOUYIN</option>
                  <option value="xiaohongshu" className="bg-gray-900">小红书 / XIAOHONGSHU</option>
                  <option value="kuaishou" className="bg-gray-900">快手 / KUAISHOU</option>
                  <option value="weibo" className="bg-gray-900">微博 / WEIBO</option>
                </select>
              </div>

              <div>
                <label className="block text-label mb-2">
                  <span>风格</span>
                  <span className="opacity-50 ml-1">STYLE</span>
                </label>
                <select
                  value={style}
                  onChange={(e) => setStyle(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-3 text-white focus:outline-none focus:border-emerald-500/50"
                >
                  <option value="catchy" className="bg-gray-900">吸睛 / CATCHY</option>
                  <option value="professional" className="bg-gray-900">专业 / PROFESSIONAL</option>
                  <option value="humorous" className="bg-gray-900">幽默 / HUMOROUS</option>
                  <option value="emotional" className="bg-gray-900">情感 / EMOTIONAL</option>
                </select>
              </div>
            </div>

            <button
              type="submit"
              disabled={isGenerating}
              className="w-full py-3 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 disabled:bg-gray-700 disabled:cursor-not-allowed font-medium transition-colors"
            >
              {isGenerating ? (
                <span>生成中... / GENERATING...</span>
              ) : (
                <span>生成文案 / GENERATE COPY</span>
              )}
            </button>
          </form>

          {copyContent.length > 0 && (
            <div className="mt-8">
              <h2 className="text-label mb-4">
                <span>生成结果</span>
                <span className="opacity-50 ml-1">/ GENERATED COPY</span>
              </h2>
              <div className="space-y-4">
                {copyContent.map((copy, index) => (
                  <div key={index} className="bg-white/5 backdrop-blur-sm rounded-xl border border-white/10 p-4">
                    <p className="text-gray-300 font-mono text-sm">{copy}</p>
                    <button className="mt-2 text-sm text-emerald-400 hover:text-emerald-300">
                      <span>复制到剪贴板</span>
                      <span className="opacity-50 ml-1">/ COPY</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
