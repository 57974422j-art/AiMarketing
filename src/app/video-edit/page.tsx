'use client';
import { useState } from 'react'

export default function VideoEditPage() {
  const [template, setTemplate] = useState('mix')
  const [duration, setDuration] = useState(30)
  const [style, setStyle] = useState('dynamic')
  const [progress, setProgress] = useState(0)
  const [isProcessing, setIsProcessing] = useState(false)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setIsProcessing(true)
    setProgress(0)
    
    // 模拟处理过程
    const interval = setInterval(() => {
      setProgress(prev => {
        if (prev >= 100) {
          clearInterval(interval)
          setIsProcessing(false)
          return 100
        }
        return prev + 10
      })
    }, 500)
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-6">视频批量剪辑</h1>
      
      <div className="bg-white shadow rounded-lg p-6">
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              上传视频
            </label>
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
              <input type="file" multiple className="hidden" id="video-upload" />
              <label htmlFor="video-upload" className="cursor-pointer text-primary hover:text-primary-dark">
                <div className="flex flex-col items-center">
                  <svg className="w-12 h-12 text-gray-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  <span>点击或拖拽视频文件到此处</span>
                </div>
              </label>
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                模板类型
              </label>
              <select 
                value={template} 
                onChange={(e) => setTemplate(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="mix">混剪</option>
                <option value="quick">快剪</option>
                <option value="story">故事板</option>
                <option value="loop">循环</option>
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                视频时长 (秒)
              </label>
              <input 
                type="number" 
                value={duration} 
                onChange={(e) => setDuration(Number(e.target.value))}
                min="1" 
                max="60"
                className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
              />
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
                <option value="dynamic">动感</option>
                <option value="elegant">优雅</option>
                <option value="vintage">复古</option>
                <option value="minimal">极简</option>
              </select>
            </div>
          </div>
          
          <div>
            <button 
              type="submit" 
              disabled={isProcessing}
              className="w-full py-3 bg-primary text-white rounded-md hover:bg-primary-dark disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {isProcessing ? '处理中...' : '开始剪辑'}
            </button>
          </div>
          
          {isProcessing && (
            <div className="mt-4">
              <div className="w-full bg-gray-200 rounded-full h-4">
                <div 
                  className="bg-primary h-4 rounded-full" 
                  style={{ width: `${progress}%` }}
                ></div>
              </div>
              <p className="text-sm text-gray-600 mt-2">处理进度: {progress}%</p>
            </div>
          )}
        </form>
      </div>
    </div>
  )
}