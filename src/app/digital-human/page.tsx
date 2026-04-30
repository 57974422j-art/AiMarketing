'use client';

import { useState, useEffect } from 'react';

interface DigitalHuman {
  id: number;
  name: string;
  avatar: string;
  gender: 'male' | 'female' | 'cartoon';
  voice: string;
  description: string;
}

interface VideoItem {
  id: number;
  title: string;
  script: string;
  human: DigitalHuman | null;
  background: string;
  duration: number;
  status: 'completed' | 'generating' | 'failed';
  progress?: number;
  thumbnail: string;
  createdAt: string;
}

const mockHumans: DigitalHuman[] = [
  { id: 1, name: '知性姐姐小雅', avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&h=200&fit=crop&crop=face', gender: 'female', voice: '温柔女声', description: '适合知识分享、美妆教程、生活分享' },
  { id: 2, name: '商务型男阿峰', avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&h=200&fit=crop&crop=face', gender: 'male', voice: '磁性男声', description: '适合商务演讲、专业分享、产品介绍' },
  { id: 3, name: '可爱萌妹小糖', avatar: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=200&h=200&fit=crop&crop=face', gender: 'female', voice: '甜美女声', description: '适合才艺展示、搞笑段子、萌宠内容' },
  { id: 4, name: '成熟女神苏雅', avatar: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=200&h=200&fit=crop&crop=face', gender: 'female', voice: '知性女声', description: '适合情感话题、女性成长、生活方式' },
  { id: 5, name: '阳光男孩小杰', avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200&h=200&fit=crop&crop=face', gender: 'male', voice: '活力男声', description: '适合运动健身、科技数码、游戏电竞' },
  { id: 6, name: '卡通形象小AI', avatar: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=200&h=200&fit=crop', gender: 'cartoon', voice: '可爱AI音', description: '适合品牌代言、吉祥物、虚拟主播' }
];

const backgrounds = [
  { id: 1, name: '简约纯色', url: 'https://images.unsplash.com/photo-1557683316-973673baf926?w=600&h=400&fit=crop', color: '渐变蓝' },
  { id: 2, name: '办公场景', url: 'https://images.unsplash.com/photo-1497366216548-37526070297c?w=600&h=400&fit=crop', color: '办公室' },
  { id: 3, name: '咖啡厅', url: 'https://images.unsplash.com/photo-1554118811-1e0d58224f24?w=600&h=400&fit=crop', color: '咖啡馆' },
  { id: 4, name: '城市天台', url: 'https://images.unsplash.com/photo-1514565131-fce0801e5785?w=600&h=400&fit=crop', color: '天台夜景' },
  { id: 5, name: '自然风光', url: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=600&h=400&fit=crop', color: '山川' },
  { id: 6, name: '科技感', url: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=600&h=400&fit=crop', color: '科技' }
];

const mockVideos: VideoItem[] = [
  {
    id: 1,
    title: '夏季护肤指南',
    script: '夏天到了，皮肤容易出油脱妆。今天来教大家几个控油小技巧...',
    human: mockHumans[0],
    background: backgrounds[0].url,
    duration: 45,
    status: 'completed',
    thumbnail: 'https://images.unsplash.com/photo-1558628217-9d2c9e6b0e77?w=400&h=225&fit=crop',
    createdAt: '2026-04-28T11:00:00Z'
  },
  {
    id: 2,
    title: '新品发布会预告',
    script: '各位粉丝朋友们，期待已久的新品即将发布...',
    human: mockHumans[1],
    background: backgrounds[1].url,
    duration: 30,
    status: 'completed',
    thumbnail: 'https://images.unsplash.com/photo-1505236858219-8359eb29e329?w=400&h=225&fit=crop',
    createdAt: '2026-04-27T14:30:00Z'
  },
  {
    id: 3,
    title: '职场沟通技巧',
    script: '职场中，高效沟通是成功的关键。今天分享三个实用技巧...',
    human: mockHumans[3],
    background: backgrounds[2].url,
    duration: 60,
    status: 'completed',
    thumbnail: 'https://images.unsplash.com/photo-1552664730-d307ca884978?w=400&h=225&fit=crop',
    createdAt: '2026-04-26T09:15:00Z'
  }
];

export default function DigitalHumanPage() {
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [script, setScript] = useState('');
  const [title, setTitle] = useState('');
  const [selectedHuman, setSelectedHuman] = useState<DigitalHuman | null>(null);
  const [selectedBg, setSelectedBg] = useState<typeof backgrounds[0] | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [generatingId, setGeneratingId] = useState<number | null>(null);

  useEffect(() => {
    setVideos(mockVideos);
  }, []);

  const handleGenerate = async () => {
    if (!script.trim()) {
      alert('请输入口播文案');
      return;
    }
    if (!selectedHuman) {
      alert('请选择数字人形象');
      return;
    }

    setIsGenerating(true);
    const newId = Date.now();

    const newVideo: VideoItem = {
      id: newId,
      title: title || `口播视频_${new Date().toLocaleTimeString('zh-CN')}`,
      script,
      human: selectedHuman,
      background: selectedBg?.url || backgrounds[0].url,
      duration: Math.max(15, Math.ceil(script.length / 5)),
      status: 'generating',
      progress: 0,
      thumbnail: selectedBg?.url || backgrounds[0].url,
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
        return prev + Math.random() * 12;
      });
    }, 400);

    await new Promise(resolve => setTimeout(resolve, 5000 + Math.random() * 3000));

    clearInterval(progressInterval);
    setProgress(100);

    setVideos(prev => prev.map(v =>
      v.id === newId
        ? { ...v, status: 'completed', progress: undefined }
        : v
    ));

    setGeneratingId(null);
    setIsGenerating(false);
    setScript('');
    setTitle('');
    setSelectedHuman(null);
    setSelectedBg(null);
  };

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <p className="text-label mb-2">AI 工作区 / AI WORKSPACE</p>
          <h1 className="text-mono-lg text-white">数字人视频 / DIGITAL HUMAN</h1>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-6">
              <h2 className="text-label mb-4">CREATE VIDEO</h2>

              <div className="space-y-4">
                <div>
                  <label className="block text-label mb-1">TITLE (OPTIONAL)</label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="VIDEO TITLE..."
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500/50"
                  />
                </div>

                <div>
                  <label className="block text-label mb-1">SCRIPT (REQUIRED)</label>
                  <textarea
                    value={script}
                    onChange={(e) => setScript(e.target.value)}
                    placeholder="INPUT YOUR SCRIPT..."
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500/50"
                    rows={6}
                  />
                  <div className="text-xs text-gray-500 mt-1 font-mono">
                    ~{Math.max(15, Math.ceil(script.length / 5))} SEC / {script.length} CHARS
                  </div>
                </div>

                <div>
                  <label className="block text-label mb-2">SELECT HUMAN</label>
                  <div className="grid grid-cols-3 gap-3">
                    {mockHumans.map(human => (
                      <button
                        key={human.id}
                        onClick={() => setSelectedHuman(human)}
                        className={`p-3 rounded-xl border-2 transition-all ${
                          selectedHuman?.id === human.id
                            ? 'border-emerald-500 bg-emerald-500/10'
                            : 'border-white/10 hover:border-white/20'
                        }`}
                      >
                        <img
                          src={human.avatar}
                          alt={human.name}
                          className="w-16 h-16 rounded-full mx-auto mb-2 object-cover"
                        />
                        <div className="text-sm font-medium text-white text-center">{human.name}</div>
                        <div className="text-xs text-gray-500 text-center font-mono">{human.voice}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-label mb-2">SELECT BACKGROUND</label>
                  <div className="grid grid-cols-3 gap-3">
                    {backgrounds.map(bg => (
                      <button
                        key={bg.id}
                        onClick={() => setSelectedBg(bg)}
                        className={`relative rounded-xl overflow-hidden border-2 transition-all ${
                          selectedBg?.id === bg.id
                            ? 'border-emerald-500'
                            : 'border-white/10 hover:border-white/20'
                        }`}
                      >
                        <img
                          src={bg.url}
                          alt={bg.name}
                          className="w-full h-20 object-cover"
                        />
                        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-1">
                          <span className="text-white text-xs font-mono">{bg.color}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  onClick={handleGenerate}
                  disabled={isGenerating || !script.trim() || !selectedHuman}
                  className="w-full px-4 py-3 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 disabled:bg-gray-700 disabled:cursor-not-allowed font-medium transition-colors"
                >
                  {isGenerating ? 'GENERATING...' : 'GENERATE VIDEO'}
                </button>
              </div>
            </div>

            {generatingId && (
              <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-6">
                <h3 className="text-label mb-4">GENERATING PROGRESS</h3>
                <div className="space-y-3">
                  <div className="flex justify-between text-sm text-gray-400">
                    <span>GENERATING VIDEO...</span>
                    <span className="font-mono">{Math.round(progress)}%</span>
                  </div>
                  <div className="w-full bg-white/10 rounded-full h-3">
                    <div
                      className="bg-emerald-500 h-3 rounded-full transition-all duration-300"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <div className="text-xs text-gray-500 font-mono">
                    {progress < 20 && 'UPLOADING SCRIPT...'}
                    {progress >= 20 && progress < 50 && 'SYNCING LIP MOVEMENT...'}
                    {progress >= 50 && progress < 80 && 'RENDERING BACKGROUND...'}
                    {progress >= 80 && 'SYNTHESIZING AUDIO...'}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-6">
            <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-6">
              <h3 className="text-label mb-4">HUMAN TYPES</h3>
              <div className="space-y-4">
                <div className="p-3 bg-blue-500/10 rounded-xl border border-blue-500/20">
                  <div className="font-medium text-blue-400 mb-1">IP CREATION</div>
                  <p className="text-sm text-gray-400">BUILD PERSONAL IP, 24/7 ONLINE</p>
                </div>
                <div className="p-3 bg-green-500/10 rounded-xl border border-green-500/20">
                  <div className="font-medium text-green-400 mb-1">KNOWLEDGE SHARING</div>
                  <p className="text-sm text-gray-400">EDUCATION, TRAINING CONTENT</p>
                </div>
                <div className="p-3 bg-purple-500/10 rounded-xl border border-purple-500/20">
                  <div className="font-medium text-purple-400 mb-1">E-COMMERCE</div>
                  <p className="text-sm text-gray-400">PRODUCT INTRODUCTION, LIVE CLIPS</p>
                </div>
                <div className="p-3 bg-orange-500/10 rounded-xl border border-orange-500/20">
                  <div className="font-medium text-orange-400 mb-1">BRAND PROMO</div>
                  <p className="text-sm text-gray-400">BRAND VIDEO, LOWER COST</p>
                </div>
              </div>
            </div>

            <div className="bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 rounded-2xl border border-emerald-500/20 p-6 text-white">
              <h3 className="font-semibold mb-3">WHY DIGITAL HUMAN?</h3>
              <ul className="text-sm space-y-2 text-gray-300">
                <li>✓ NO FILMING TEAM NEEDED</li>
                <li>✓ BREAK TIME LIMITS</li>
                <li>✓ CONSISTENT IP IMAGE</li>
                <li>✓ MULTI-LANGUAGE SUPPORT</li>
                <li>✓ 80% COST REDUCTION</li>
              </ul>
            </div>
          </div>
        </div>

        <div className="mt-8">
          <h2 className="text-label mb-4">HISTORY RECORDS</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {videos.map(video => (
              <div key={video.id} className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 overflow-hidden">
                <div className="relative">
                  <img
                    src={video.thumbnail}
                    alt={video.title}
                    className="w-full h-40 object-cover"
                  />
                  {video.human && (
                    <img
                      src={video.human.avatar}
                      alt={video.human.name}
                      className="absolute bottom-2 right-2 w-12 h-12 rounded-full border-2 border-white object-cover"
                    />
                  )}
                  {video.status === 'generating' && (
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                      <div className="text-center text-white">
                        <div className="animate-spin w-8 h-8 border-2 border-white border-t-transparent rounded-full mx-auto mb-2" />
                        <span className="text-sm font-mono">{video.progress ? Math.round(video.progress) : 0}%</span>
                      </div>
                    </div>
                  )}
                  <span className="absolute top-2 right-2 px-2 py-1 bg-black/50 text-white text-xs font-mono rounded">
                    {video.duration}S
                  </span>
                </div>
                <div className="p-4">
                  <h3 className="font-semibold text-white mb-1 truncate font-mono text-sm">{video.title}</h3>
                  <p className="text-xs text-gray-500 mb-2 line-clamp-2">{video.script}</p>
                  {video.human && (
                    <div className="text-xs text-emerald-400 mb-2 font-mono">
                      {video.human.name} · {video.human.voice}
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500 font-mono">
                      {new Date(video.createdAt).toLocaleDateString('zh-CN')}
                    </span>
                    <div className="flex gap-2">
                      <button className="text-xs px-2 py-1 bg-white/10 text-gray-300 rounded hover:bg-white/20">
                        PREVIEW
                      </button>
                      <button className="text-xs px-2 py-1 bg-emerald-500 text-white rounded hover:bg-emerald-600">
                        DOWNLOAD
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}