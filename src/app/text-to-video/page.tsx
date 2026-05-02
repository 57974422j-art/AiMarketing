'use client';

import { useState, useEffect } from 'react';
import { useLocale } from '@/i18n/context';

interface VideoItem {
  id: number;
  title: string;
  description: string;
  prompt: string;
  duration: number;
  style: string;
  thumbnail: string;
  videoUrl: string;
  status: 'completed' | 'generating' | 'failed';
  progress?: number;
  createdAt: string;
}

interface VideoTemplate {
  id: number;
  title: string;
  description?: string;
  prompt: string;
  duration: number;
  style: string;
  thumbnail?: string;
  videoUrl?: string;
  isActive: boolean;
  createdAt: string;
}

const durations = [15, 30, 45, 60, 90, 120];
const styles = ['电影感', '自然风光', '3D产品', '美食', '动画风', '纪录片', '广告感'];
const cameraMoves = ['固定镜头', '缓慢推进', '拉远展示', '平移跟随', '航拍环绕', '手持晃动感', '希区柯克'];

export default function TextToVideoPage() {
  const { t } = useLocale();
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [templates, setTemplates] = useState<VideoTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [prompt, setPrompt] = useState('');
  const [title, setTitle] = useState('');
  const [duration, setDuration] = useState(30);
  const [style, setStyle] = useState('电影感');
  const [cameraMove, setCameraMove] = useState('缓慢推进');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatingId, setGeneratingId] = useState<number | null>(null);
  const [progress, setProgress] = useState(0);
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    fetchTemplates();
  }, []);

  const fetchTemplates = async () => {
    try {
      const res = await fetch('/api/templates/video');
      if (res.ok) {
        const data = await res.json();
        setTemplates(data);
      }
    } catch (error) {
      console.error('获取模板失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      alert(t.textToVideo.pleaseInputPrompt);
      return;
    }

    setIsGenerating(true);
    const newId = Date.now();

    const newVideo: VideoItem = {
      id: newId,
      title: title || `视频_${new Date().toLocaleTimeString('zh-CN')}`,
      description: prompt.substring(0, 50) + (prompt.length > 50 ? '...' : ''),
      prompt,
      duration,
      style,
      thumbnail: 'https://images.unsplash.com/photo-1536240478700-b869ad10e128?w=400&h=225&fit=crop',
      videoUrl: '',
      status: 'generating',
      progress: 0,
      createdAt: new Date().toISOString()
    };

    setVideos(prev => [newVideo, ...prev]);
    setGeneratingId(newId);
    setProgress(0);

    const progressInterval = setInterval(() => {
      setProgress(prev => {
        if (prev >= 95) {
          clearInterval(progressInterval);
          return prev;
        }
        return prev + Math.random() * 15;
      });
    }, 500);

    await new Promise(resolve => setTimeout(resolve, 6000 + Math.random() * 4000));

    clearInterval(progressInterval);
    setProgress(100);

    setVideos(prev => prev.map(v =>
      v.id === newId
        ? { ...v, status: 'completed', progress: undefined, thumbnail: 'https://images.unsplash.com/photo-1536240478700-b869ad10e128?w=400&h=225&fit=crop' }
        : v
    ));

    setGeneratingId(null);
    setIsGenerating(false);
    setShowPreview(true);
    setPrompt('');
    setTitle('');
  };

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <p className="text-label mb-2">AI 工作区 / AI WORKSPACE</p>
          <h1 className="text-mono-lg text-white">{t.textToVideo.title} / TEXT-TO-VIDEO</h1>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-6">
              <h2 className="text-label mb-4">{t.textToVideo.createNew}</h2>

              <div className="space-y-4">
                <div>
                  <label className="block text-label mb-1">{t.textToVideo.titleOptional}</label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="VIDEO TITLE..."
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500/50"
                  />
                </div>

                <div>
                  <label className="block text-label mb-1">{t.textToVideo.promptRequired}</label>
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder={t.textToVideo.describeVideo}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500/50"
                    rows={4}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-label mb-1">{t.textToVideo.duration}</label>
                    <select
                      value={duration}
                      onChange={(e) => setDuration(parseInt(e.target.value))}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-3 text-white focus:outline-none focus:border-emerald-500/50"
                    >
                      {durations.map(d => (
                        <option key={d} value={d} className="bg-gray-900">{d} {t.textToVideo.seconds}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-label mb-1">{t.textToVideo.style}</label>
                    <select
                      value={style}
                      onChange={(e) => setStyle(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-3 text-white focus:outline-none focus:border-emerald-500/50"
                    >
                      {styles.map(s => (
                        <option key={s} value={s} className="bg-gray-900">{s}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-label mb-1">{t.textToVideo.cameraMovement}</label>
                  <select
                    value={cameraMove}
                    onChange={(e) => setCameraMove(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-3 text-white focus:outline-none focus:border-emerald-500/50"
                  >
                    {cameraMoves.map(m => (
                      <option key={m} value={m} className="bg-gray-900">{m}</option>
                    ))}
                  </select>
                </div>

                <button
                  onClick={handleGenerate}
                  disabled={isGenerating || !prompt.trim()}
                  className="w-full px-4 py-3 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 disabled:bg-gray-700 disabled:cursor-not-allowed font-medium transition-colors"
                >
                  {isGenerating ? t.textToVideo.generating : t.textToVideo.generate}
                </button>
              </div>
            </div>

            {generatingId && (
              <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-6">
                <h3 className="text-label mb-4">{t.textToVideo.generatingProgress}</h3>
                <div className="space-y-3">
                  <div className="flex justify-between text-sm text-gray-400">
                    <span>{t.textToVideo.generating}...</span>
                    <span className="font-mono">{Math.round(progress)}%</span>
                  </div>
                  <div className="w-full bg-white/10 rounded-full h-3">
                    <div
                      className="bg-emerald-500 h-3 rounded-full transition-all duration-300"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <div className="text-xs text-gray-500 font-mono">
                    {progress < 30 && t.textToVideo.analyzingPrompt}
                    {progress >= 30 && progress < 60 && t.textToVideo.renderingFrames}
                    {progress >= 60 && progress < 90 && t.textToVideo.processingLight}
                    {progress >= 90 && t.textToVideo.synthesizingAudio}
                  </div>
                </div>
              </div>
            )}

            <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-6">
              <h2 className="text-label mb-4">{t.textToVideo.promptTips}</h2>
              <div className="space-y-3 text-sm text-gray-400">
                <div className="flex items-start gap-2">
                  <span className="text-emerald-400 font-bold">1.</span>
                  <span>{t.textToVideo.describeScene}</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-emerald-400 font-bold">2.</span>
                  <span>{t.textToVideo.specifyCamera}</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-emerald-400 font-bold">3.</span>
                  <span>{t.textToVideo.describeMotion}</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-emerald-400 font-bold">4.</span>
                  <span>{t.textToVideo.specifyStyle}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-6">
              <h2 className="text-label mb-4">{t.textToVideo.sceneSuggestions}</h2>
              <div className="space-y-3">
                {[
                  { title: t.textToVideo.citySkyline, desc: t.textToVideo.citySkylineDesc },
                  { title: t.textToVideo.productDisplay, desc: t.textToVideo.productDisplayDesc },
                  { title: t.textToVideo.natureScenery, desc: t.textToVideo.natureSceneryDesc },
                  { title: t.textToVideo.foodCloseUp, desc: t.textToVideo.foodCloseUpDesc }
                ].map((item, idx) => (
                  <button
                    key={idx}
                    onClick={() => setPrompt(item.desc)}
                    className="w-full text-left p-3 bg-white/5 rounded-xl hover:bg-white/10 transition-colors"
                  >
                    <div className="font-medium text-white text-sm">{item.title}</div>
                    <div className="text-xs text-gray-500 font-mono">{item.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 rounded-2xl border border-emerald-500/20 p-6 text-white">
              <h3 className="font-semibold mb-2">{t.textToVideo.useCases}</h3>
              <ul className="text-sm space-y-2 text-gray-300">
                <li>• {t.textToVideo.socialMedia}</li>
                <li>• {t.textToVideo.ecommerce}</li>
                <li>• {t.textToVideo.brandPromotion}</li>
                <li>• {t.textToVideo.educational}</li>
                <li>• {t.textToVideo.personalIp}</li>
              </ul>
            </div>
          </div>
        </div>

        <div className="mt-8">
          <h2 className="text-label mb-4">{t.textToVideo.historyRecords}</h2>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full" />
            </div>
          ) : templates.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10">
              <div className="text-4xl mb-4">📽️</div>
              <p className="text-gray-400 font-mono text-center">暂无模板，去模板库看看</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {templates.map(template => (
                <div key={template.id} className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 overflow-hidden">
                  <div className="relative">
                    <img
                      src={template.thumbnail || 'https://images.unsplash.com/photo-1536240478700-b869ad10e128?w=400&h=225&fit=crop'}
                      alt={template.title}
                      className="w-full h-40 object-cover"
                    />
                    <span className="absolute top-2 right-2 px-2 py-1 bg-black/50 text-white text-xs font-mono rounded">
                      {template.duration}S
                    </span>
                    <span className="absolute bottom-2 left-2 px-2 py-1 bg-emerald-500 text-white text-xs rounded">
                      {template.style}
                    </span>
                  </div>
                  <div className="p-4">
                    <h3 className="font-semibold text-white mb-1 truncate font-mono text-sm">{template.title}</h3>
                    <p className="text-xs text-gray-500 mb-2 line-clamp-2">{template.description || template.prompt}</p>
                    <div className="flex items-center justify-end">
                      <button 
                        onClick={() => {
                          setPrompt(template.prompt);
                          setStyle(template.style);
                          setDuration(template.duration);
                          if (template.title) setTitle(template.title);
                        }}
                        className="text-xs px-3 py-1.5 bg-emerald-500 text-white rounded hover:bg-emerald-600"
                      >
                        使用模板
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}