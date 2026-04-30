'use client';

import { useState, useEffect } from 'react';

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

const mockVideos: VideoItem[] = [
  {
    id: 1,
    title: '城市夜景延时摄影',
    description: '展示城市霓虹灯下的车水马龙，营造现代都市感',
    prompt: '一个繁华都市的夜景，霓虹闪烁，车流如织，航拍视角 slowly tracking shot',
    duration: 30,
    style: '电影感',
    thumbnail: 'https://images.unsplash.com/photo-1514565131-fce0801e5785?w=400&h=225&fit=crop',
    videoUrl: '',
    status: 'completed',
    createdAt: '2026-04-28T10:30:00Z'
  },
  {
    id: 2,
    title: '日出云海翻涌',
    description: '高山之巅看云海日出，气势磅礴',
    prompt: '壮阔的山顶云海日出景观，云层翻涌，金色阳光穿透云层，航拍 drone shot',
    duration: 60,
    style: '自然风光',
    thumbnail: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=400&h=225&fit=crop',
    videoUrl: '',
    status: 'completed',
    createdAt: '2026-04-27T15:20:00Z'
  },
  {
    id: 3,
    title: '产品3D展示',
    description: '精致的科技产品360度旋转展示',
    prompt: '一款极简风格的蓝牙耳机在纯白背景下360度旋转展示，光线流转，产品3D render',
    duration: 15,
    style: '3D产品',
    thumbnail: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=400&h=225&fit=crop',
    videoUrl: '',
    status: 'completed',
    createdAt: '2026-04-26T09:45:00Z'
  },
  {
    id: 4,
    title: '美食制作过程',
    description: '慢镜头展示精致甜点的制作过程',
    prompt: '法式马卡龙制作过程特写，慢动作展示原料混合、烘焙、装饰，浅景深 cinematic macro',
    duration: 45,
    style: '美食',
    thumbnail: 'https://images.unsplash.com/photo-1558628217-9d2c9e6b0e77?w=400&h=225&fit=crop',
    videoUrl: '',
    status: 'completed',
    createdAt: '2026-04-25T18:10:00Z'
  }
];

const durations = [15, 30, 45, 60, 90, 120];
const styles = ['电影感', '自然风光', '3D产品', '美食', '动画风', '纪录片', '广告感'];
const cameraMoves = ['固定镜头', '缓慢推进', '拉远展示', '平移跟随', '航拍环绕', '手持晃动感', '希区柯克'];

export default function TextToVideoPage() {
  const [videos, setVideos] = useState<VideoItem[]>([]);
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
    setVideos(mockVideos);
  }, []);

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      alert('请输入视频描述');
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
          <h1 className="text-mono-lg text-white">文生视频 / TEXT-TO-VIDEO</h1>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-6">
              <h2 className="text-label mb-4">CREATE NEW VIDEO</h2>

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
                  <label className="block text-label mb-1">PROMPT (REQUIRED)</label>
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="DESCRIBE YOUR VIDEO SCENE..."
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500/50"
                    rows={4}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-label mb-1">DURATION</label>
                    <select
                      value={duration}
                      onChange={(e) => setDuration(parseInt(e.target.value))}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-3 text-white focus:outline-none focus:border-emerald-500/50"
                    >
                      {durations.map(d => (
                        <option key={d} value={d} className="bg-gray-900">{d} SEC</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-label mb-1">STYLE</label>
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
                  <label className="block text-label mb-1">CAMERA MOVEMENT</label>
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
                    {progress < 30 && 'ANALYZING PROMPT CONTENT...'}
                    {progress >= 30 && progress < 60 && 'RENDERING KEY FRAMES...'}
                    {progress >= 60 && progress < 90 && 'PROCESSING LIGHT AND SHADOW...'}
                    {progress >= 90 && 'SYNTHESIZING AUDIO...'}
                  </div>
                </div>
              </div>
            )}

            <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-6">
              <h2 className="text-label mb-4">PROMPT TIPS</h2>
              <div className="space-y-3 text-sm text-gray-400">
                <div className="flex items-start gap-2">
                  <span className="text-emerald-400 font-bold">1.</span>
                  <span>DESCRIBE SCENE: LOCATION, TIME, WEATHER, LIGHTING</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-emerald-400 font-bold">2.</span>
                  <span>SPECIFY CAMERA: AERIAL, CLOSE-UP, PAN, ETC.</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-emerald-400 font-bold">3.</span>
                  <span>DESCRIBE SUBJECT MOTION: MOVEMENT AND CHANGES</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-emerald-400 font-bold">4.</span>
                  <span>SPECIFY STYLE: CINEMATIC, DOCUMENTARY, ANIMATION</span>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-6">
              <h2 className="text-label mb-4">SCENE SUGGESTIONS</h2>
              <div className="space-y-3">
                {[
                  { title: 'CITY SKYLINE', desc: 'AERIAL VIEW OF CITY AT SUNSET' },
                  { title: 'PRODUCT DISPLAY', desc: '3D PRODUCT 360 ROTATION' },
                  { title: 'NATURE SCENERY', desc: 'SEA OF CLOUDS AT SUNRISE' },
                  { title: 'FOOD CLOSE-UP', desc: 'SLOW MOTION COOKING PROCESS' }
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
              <h3 className="font-semibold mb-2">USE CASES</h3>
              <ul className="text-sm space-y-2 text-gray-300">
                <li>• SOCIAL MEDIA CONTENT</li>
                <li>• E-COMMERCE PRODUCT VIDEO</li>
                <li>• BRAND PROMOTION</li>
                <li>• EDUCATIONAL COURSES</li>
                <li>• PERSONAL IP VIDEO</li>
              </ul>
            </div>
          </div>
        </div>

        <div className="mt-8">
          <h2 className="text-label mb-4">HISTORY RECORDS</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {videos.map(video => (
              <div key={video.id} className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 overflow-hidden">
                <div className="relative">
                  <img
                    src={video.thumbnail}
                    alt={video.title}
                    className="w-full h-40 object-cover"
                  />
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
                  <span className="absolute bottom-2 left-2 px-2 py-1 bg-emerald-500 text-white text-xs rounded">
                    {video.style}
                  </span>
                </div>
                <div className="p-4">
                  <h3 className="font-semibold text-white mb-1 truncate font-mono text-sm">{video.title}</h3>
                  <p className="text-xs text-gray-500 mb-2 line-clamp-2">{video.description}</p>
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