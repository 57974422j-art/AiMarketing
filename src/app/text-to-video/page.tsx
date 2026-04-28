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
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Sora 文生视频</h1>
        <p className="text-gray-600">输入文字描述，AI 帮你生成创意视频。支持多种风格和镜头运镜方式。</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">创建新视频</h2>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">视频标题（选填）</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="给视频起个名字..."
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">视频描述（必填）</label>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="描述你想要生成的视频场景、情节、风格等...例如：一个繁华都市的夜景，霓虹闪烁，车流如织，航拍视角 slowly tracking shot"
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
                  rows={4}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">视频时长</label>
                  <select
                    value={duration}
                    onChange={(e) => setDuration(parseInt(e.target.value))}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    {durations.map(d => (
                      <option key={d} value={d}>{d} 秒</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">视频风格</label>
                  <select
                    value={style}
                    onChange={(e) => setStyle(e.target.value)}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    {styles.map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">镜头运镜方式</label>
                <select
                  value={cameraMove}
                  onChange={(e) => setCameraMove(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  {cameraMoves.map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>

              <button
                onClick={handleGenerate}
                disabled={isGenerating || !prompt.trim()}
                className="w-full px-4 py-3 bg-primary text-white rounded-md hover:bg-primary-dark disabled:bg-gray-300 disabled:cursor-not-allowed font-medium"
              >
                {isGenerating ? '生成中...' : '生成视频'}
              </button>
            </div>
          </div>

          {generatingId && (
            <div className="bg-white rounded-lg shadow-md p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">生成进度</h3>
              <div className="space-y-3">
                <div className="flex justify-between text-sm text-gray-600">
                  <span>正在生成视频...</span>
                  <span>{Math.round(progress)}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-3">
                  <div 
                    className="bg-primary h-3 rounded-full transition-all duration-300"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <div className="text-xs text-gray-500">
                  {progress < 30 && '正在理解描述内容，生成场景脚本...'}
                  {progress >= 30 && progress < 60 && '正在渲染关键帧，生成画面序列...'}
                  {progress >= 60 && progress < 90 && '正在进行光影处理和画面优化...'}
                  {progress >= 90 && '正在合成音频，生成最终视频...'}
                </div>
              </div>
            </div>
          )}

          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">提示词技巧</h2>
            <div className="space-y-3 text-sm text-gray-600">
              <div className="flex items-start gap-2">
                <span className="text-primary font-bold">1.</span>
                <span>详细描述场景：地点、时间、天气、光线等环境因素</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-primary font-bold">2.</span>
                <span>说明镜头语言：航拍、特写、平移等运镜方式</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-primary font-bold">3.</span>
                <span>描述主体动作：人物/物体的运动状态和变化</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-primary font-bold">4.</span>
                <span>指定风格氛围：电影感、纪录片、动画等</span>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">场景推荐</h2>
            <div className="space-y-3">
              {[
                { title: '城市天际线', desc: '航拍城市全景，日落余晖' },
                { title: '产品展示', desc: '3D产品360度旋转展示' },
                { title: '自然风光', desc: '云海日出，山川湖泊' },
                { title: '美食特写', desc: '慢动作美食制作过程' }
              ].map((item, idx) => (
                <button
                  key={idx}
                  onClick={() => setPrompt(item.desc)}
                  className="w-full text-left p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  <div className="font-medium text-gray-900">{item.title}</div>
                  <div className="text-sm text-gray-500">{item.desc}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg shadow-md p-6 text-white">
            <h3 className="font-semibold mb-2">使用场景</h3>
            <ul className="text-sm space-y-2 opacity-90">
              <li>• 社交媒体内容创作</li>
              <li>• 电商产品展示视频</li>
              <li>• 品牌宣传片制作</li>
              <li>• 教学课程视频</li>
              <li>• 个人 IP 视频素材</li>
            </ul>
          </div>
        </div>
      </div>

      <div className="mt-8">
        <h2 className="text-xl font-bold text-gray-900 mb-4">历史生成记录</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {videos.map(video => (
            <div key={video.id} className="bg-white rounded-lg shadow-md overflow-hidden">
              <div className="relative">
                <img 
                  src={video.thumbnail} 
                  alt={video.title}
                  className="w-full h-40 object-cover"
                />
                {video.status === 'generating' && (
                  <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center">
                    <div className="text-center text-white">
                      <div className="animate-spin w-8 h-8 border-2 border-white border-t-transparent rounded-full mx-auto mb-2" />
                      <span className="text-sm">生成中 {video.progress ? Math.round(video.progress) : 0}%</span>
                    </div>
                  </div>
                )}
                <span className="absolute top-2 right-2 px-2 py-1 bg-black bg-opacity-50 text-white text-xs rounded">
                  {video.duration}秒
                </span>
                <span className="absolute bottom-2 left-2 px-2 py-1 bg-primary text-white text-xs rounded">
                  {video.style}
                </span>
              </div>
              <div className="p-4">
                <h3 className="font-semibold text-gray-900 mb-1 truncate">{video.title}</h3>
                <p className="text-sm text-gray-500 mb-2 line-clamp-2">{video.description}</p>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">
                    {new Date(video.createdAt).toLocaleDateString('zh-CN')}
                  </span>
                  <div className="flex gap-2">
                    <button className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded hover:bg-gray-200">
                      预览
                    </button>
                    <button className="text-xs px-2 py-1 bg-primary text-white rounded hover:bg-primary-dark">
                      下载
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}