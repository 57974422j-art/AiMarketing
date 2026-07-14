import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Search, 
  TrendingUp, 
  BrainCircuit, 
  CheckCircle2, 
  Play, 
  Download, 
  ChevronRight, 
  Filter,
  Globe,
  Youtube,
  Twitter,
  Instagram,
  RefreshCw,
  Video,
  List as ListIcon
} from 'lucide-react';
import { searchTrends, analyzeTrends, extractVideoInsights, TrendingItem } from './services/geminiService';
import axios from 'axios';

type View = 'search' | 'results' | 'analysis' | 'synthesis' | 'player' | 'intel';

export default function App() {
  const [view, setView] = useState<View>('search');
  const [keyword, setKeyword] = useState('');
  const [selectedPlatforms, setSelectedPlatforms] = useState(['YouTube', 'TikTok', 'Twitter', 'Bilibili', 'Douyin']);
  const [results, setResults] = useState<TrendingItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isSearching, setIsSearching] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [generatedVideoUrl, setGeneratedVideoUrl] = useState<string | null>(null);
  const [intelData, setIntelData] = useState<{ summary: string; script: string; pptStructure: any[] } | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);

  const handleExtractIntel = async (item: TrendingItem) => {
    setIsExtracting(true);
    setView('intel');
    const data = await extractVideoInsights(item);
    setIntelData(data);
    setIsExtracting(false);
  };

  const handleExportJSON = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(results, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href",     dataStr);
    downloadAnchorNode.setAttribute("download", `trend_data_${Date.now()}.json`);
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  };

  const platformsList = [
    { name: 'YouTube', icon: <Youtube className="w-4 h-4" /> },
    { name: 'TikTok', icon: <div className="w-4 h-4 font-bold text-[10px]">TT</div> },
    { name: 'Twitter', icon: <Twitter className="w-4 h-4" /> },
    { name: 'Instagram', icon: <Instagram className="w-4 h-4" /> },
    { name: 'Douyin', icon: <div className="w-4 h-4 font-bold text-[10px]">DY</div> },
    { name: 'Bilibili', icon: <div className="w-4 h-4 font-bold text-[10px]">BZ</div> },
  ];

  const handleSearch = async () => {
    if (!keyword) return;
    setIsSearching(true);
    const data = await searchTrends(keyword, selectedPlatforms);
    setResults(data);
    setIsSearching(false);
    setView('results');
  };

  const handleAnalyze = async () => {
    setIsAnalyzing(true);
    const analyzed = await analyzeTrends(results);
    setResults(analyzed);
    setIsAnalyzing(false);
    setView('analysis');
  };

  const toggleSelection = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === results.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(results.map(r => r.id)));
    }
  };

  const handleSynthesize = async () => {
    if (selectedIds.size === 0) return;
    setIsSynthesizing(true);
    setView('synthesis');
    
    const selectedItems = results.filter(item => selectedIds.has(item.id));
    
    try {
      const response = await axios.post('/api/synthesize', {
        items: selectedItems,
        title: keyword || 'Viral Trends'
      }, {
        timeout: 180000, // 3 minutes timeout for heavy processing
        headers: {
          'Content-Type': 'application/json'
        }
      });
      setGeneratedVideoUrl(response.data.videoUrl);
      setView('player');
    } catch (error: any) {
      console.error("Synthesis failed", error);
      let userMsg = "网络连接异常，可能是合成耗时过长导致连接断开。";
      
      if (error.response) {
        userMsg = error.response.data?.error || `服务器错误 (${error.response.status})`;
      } else if (error.code === 'ECONNABORTED') {
        userMsg = "合成超时（超过3分钟），请尝试减少勾选的条目数量后再试。";
      }
      
      alert(`视频合成失败: ${userMsg}\n\n建议尝试：\n1. 只勾选 3-5 个最核心的条目\n2. 检查网络环境是否稳定\n3. 稍后再试`);
      setView('analysis');
    } finally {
      setIsSynthesizing(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-cyan-500 selection:text-white">
      {/* Mobile-first Container */}
      <div className="max-w-md mx-auto min-h-screen flex flex-col pt-safe pb-safe shadow-2xl bg-slate-900 overflow-hidden">
        
        {/* Header */}
        <header className="p-6 border-b border-white/5 flex items-center justify-between sticky top-0 bg-slate-900/80 backdrop-blur-md z-10">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-cyan-500 rounded-lg flex items-center justify-center">
              <TrendingUp className="text-slate-950 w-5 h-5" />
            </div>
            <h1 className="text-xl font-bold tracking-tight">TrendVideo</h1>
          </div>
          {view !== 'search' && (
            <button 
              onClick={() => setView('search')}
              className="text-xs font-semibold px-3 py-1 bg-white/5 rounded-full hover:bg-white/10 transition-colors"
            >
              重置
            </button>
          )}
        </header>

        <main className="flex-1 overflow-y-auto p-4">
          <AnimatePresence mode="wait">
            
            {/* View 1: Search */}
            {view === 'search' && (
              <motion.div 
                key="search"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-8 py-4"
              >
                <div className="space-y-4">
                  <h2 className="text-2xl font-bold leading-tight">发现全球<br/><span className="text-cyan-400">最新爆款趋势</span></h2>
                  <p className="text-slate-400 text-sm">输入关键词，AI 将在全球主流平台为您实时搜寻热门内容。</p>
                </div>

                <div className="space-y-6">
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-500 ml-1">关键词或主题</label>
                    <div className="relative">
                      <input 
                        type="text" 
                        value={keyword}
                        onChange={(e) => setKeyword(e.target.value)}
                        placeholder="例如：AI新工具、TikTok爆款..."
                        className="w-full bg-slate-800 border-none rounded-2xl py-4 pl-12 pr-4 text-white placeholder:text-slate-600 focus:ring-2 focus:ring-cyan-500 transition-all shadow-lg"
                      />
                      <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 w-5 h-5" />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-500 ml-1">选择搜寻平台</label>
                    <div className="grid grid-cols-3 gap-2">
                      {platformsList.map((p) => (
                        <button
                          key={p.name}
                          onClick={() => {
                            if (selectedPlatforms.includes(p.name)) {
                              setSelectedPlatforms(selectedPlatforms.filter(item => item !== p.name));
                            } else {
                              setSelectedPlatforms([...selectedPlatforms, p.name]);
                            }
                          }}
                          className={`flex items-center justify-center gap-2 py-3 rounded-xl border text-xs font-medium transition-all ${
                            selectedPlatforms.includes(p.name) 
                            ? 'bg-cyan-500/10 border-cyan-500 text-cyan-400' 
                            : 'bg-slate-800 border-white/5 text-slate-400'
                          }`}
                        >
                          {p.icon}
                          {p.name}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <button 
                  onClick={handleSearch}
                  disabled={isSearching || !keyword}
                  className="w-full bg-cyan-500 text-slate-950 font-bold py-4 rounded-2xl flex items-center justify-center gap-2 shadow-lg shadow-cyan-500/20 active:scale-[0.98] transition-transform disabled:opacity-50"
                >
                  {isSearching ? (
                    <>
                      <RefreshCw className="w-5 h-5 animate-spin" />
                      正在搜寻全球趋势...
                    </>
                  ) : (
                    <>
                      <Globe className="w-5 h-5" />
                      开始全球搜寻
                    </>
                  )}
                </button>
              </motion.div>
            )}

            {/* View 2: Results */}
            {view === 'results' && (
              <motion.div 
                key="results"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-6 pb-24"
              >
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <h2 className="text-lg font-bold">搜寻结果 ({results.length})</h2>
                    <button 
                      onClick={toggleSelectAll}
                      className="text-[10px] font-bold text-cyan-400 flex items-center gap-1 uppercase tracking-wider"
                    >
                      {selectedIds.size === results.length ? '取消全选' : '选择全部结果'}
                    </button>
                  </div>
                  <button onClick={handleAnalyze} className="text-xs flex items-center gap-1 text-cyan-400 bg-cyan-400/10 px-4 py-2 rounded-full font-bold border border-cyan-400/20 shadow-lg shadow-cyan-400/5">
                    <BrainCircuit className="w-3 h-3" />
                    AI 深度分析
                  </button>
                </div>

                <div className="space-y-4">
                  {results.map((item) => (
                    <div 
                      key={item.id}
                      onClick={() => toggleSelection(item.id)}
                      className={`group relative bg-slate-800 rounded-2xl overflow-hidden border transition-all duration-300 cursor-pointer ${
                        selectedIds.has(item.id) 
                        ? 'border-cyan-500 ring-1 ring-cyan-500 shadow-cyan-500/20' 
                        : 'border-white/5 hover:border-white/10'
                      }`}
                    >
                      {/* Selection Badge */}
                      <div className={`absolute top-3 left-3 z-10 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${
                        selectedIds.has(item.id) 
                        ? 'bg-cyan-500 border-cyan-500' 
                        : 'bg-black/20 border-white/40 backdrop-blur-md'
                      }`}>
                        {selectedIds.has(item.id) && <CheckCircle2 className="text-slate-950 w-4 h-4" />}
                      </div>

                      <div className="relative aspect-[16/9]">
                        <img 
                          src={item.image} 
                          alt={item.title} 
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                          referrerPolicy="no-referrer"
                        />
                        <div className="absolute top-3 right-3 flex gap-1">
                          <span className="bg-slate-950/80 backdrop-blur-sm text-[9px] uppercase tracking-wider font-black px-2 py-1 rounded text-cyan-400">{item.platform}</span>
                        </div>
                        <div className="absolute bottom-3 right-3 flex items-center gap-2">
                          <button 
                            onClick={(e) => { e.stopPropagation(); handleExtractIntel(item); }}
                            className="bg-slate-900/80 backdrop-blur-md text-cyan-400 p-2 rounded-full hover:bg-cyan-500 hover:text-slate-950 transition-colors"
                            title="深度洞察"
                          >
                            <BrainCircuit className="w-4 h-4" />
                          </button>
                          <a 
                            href={item.url} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="bg-slate-900/80 backdrop-blur-md text-white p-2 rounded-full hover:bg-cyan-500 hover:text-slate-950 transition-colors"
                          >
                            <Globe className="w-4 h-4" />
                          </a>
                          <span className="bg-cyan-500 text-slate-950 text-[10px] font-black px-2 py-1 rounded-full flex items-center gap-1 shadow-lg">
                            <TrendingUp className="w-3 h-3" />
                            {item.hotness}%
                          </span>
                        </div>
                      </div>
                      <div className="p-4 space-y-2">
                        <h3 className="font-bold text-sm leading-snug line-clamp-2">{item.title}</h3>
                        <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed opacity-80">{item.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {/* View 3: Analysis */}
            {view === 'analysis' && (
              <motion.div 
                key="analysis"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-6 pb-32"
              >
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <h2 className="text-xl font-bold">AI 爆款核心分析</h2>
                    <p className="text-xs text-slate-400">选择条目合成视频，或点击图标查看详细拆解</p>
                  </div>
                  <button onClick={handleExportJSON} className="p-2 bg-slate-800 rounded-lg text-slate-400">
                    <Download className="w-4 h-4" />
                  </button>
                </div>

                <div className="space-y-4">
                  {results.map((item) => (
                    <div 
                      key={item.id}
                      className={`relative p-4 rounded-2xl border transition-all cursor-pointer ${
                        selectedIds.has(item.id) 
                        ? 'bg-cyan-500/10 border-cyan-500' 
                        : 'bg-slate-800 border-white/5'
                      }`}
                    >
                      <div className="flex gap-4" onClick={() => toggleSelection(item.id)}>
                        <div className="w-16 h-16 rounded-xl overflow-hidden flex-shrink-0 relative">
                          <img 
                            src={item.image} 
                            alt="" 
                            className="w-full h-full object-cover" 
                            referrerPolicy="no-referrer"
                          />
                          {selectedIds.has(item.id) && (
                            <div className="absolute inset-0 bg-cyan-500/40 flex items-center justify-center">
                              <CheckCircle2 className="text-white w-6 h-6" />
                            </div>
                          )}
                        </div>
                        <div className="flex-1 space-y-1">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-black bg-cyan-500/20 text-cyan-400 px-1.5 py-0.5 rounded uppercase">{item.category}</span>
                              <span className="text-[10px] font-bold text-slate-500">{item.platform}</span>
                            </div>
                            <button 
                              onClick={(e) => { e.stopPropagation(); handleExtractIntel(item); }}
                              className="p-1.5 bg-slate-900 rounded-lg text-cyan-400 hover:bg-cyan-500 hover:text-slate-950 transition-colors"
                            >
                              <BrainCircuit className="w-4 h-4" />
                            </button>
                          </div>
                          <h3 className="text-sm font-bold line-clamp-1">{item.title}</h3>
                          <p className="text-xs italic text-cyan-200/70">"{item.aiComment}"</p>
                        </div>
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2">
                        {item.viralFactors?.map((f) => (
                          <span key={f} className="text-[9px] bg-slate-900/50 text-slate-400 px-2 py-0.5 rounded-full"># {f}</span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {/* View 6: Intel/Report */}
            {view === 'intel' && (
              <motion.div 
                key="intel"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="space-y-6 pb-24"
              >
                <div className="flex items-center gap-3">
                  <button onClick={() => setView('analysis')} className="p-2 bg-slate-800 rounded-xl"><ChevronRight className="w-5 h-5 rotate-180" /></button>
                  <h2 className="text-xl font-bold">趋势深度洞察</h2>
                </div>

                {isExtracting ? (
                  <div className="py-20 flex flex-col items-center gap-4 text-center">
                    <RefreshCw className="w-10 h-10 text-cyan-400 animate-spin" />
                    <p className="text-slate-400 animate-pulse">正在利用 Gemini 1.5 提炼爆款基因与 PPT 结构...</p>
                  </div>
                ) : (
                  <div className="space-y-8">
                    <div className="flex gap-4">
                       <button onClick={handleExportJSON} className="flex-1 bg-slate-800 text-xs font-bold py-3 rounded-xl flex items-center justify-center gap-2 border border-white/5">
                         <Download className="w-4 h-4" /> 导出数据
                       </button>
                       <button onClick={() => window.print()} className="flex-1 bg-cyan-500 text-slate-950 text-xs font-bold py-3 rounded-xl flex items-center justify-center gap-2">
                         <ListIcon className="w-4 h-4" /> 生成报告
                       </button>
                    </div>

                    <section className="bg-slate-800/50 p-5 rounded-2xl border border-white/5 space-y-3">
                      <h3 className="text-cyan-400 text-xs font-bold uppercase tracking-widest flex items-center gap-2">
                        <BrainCircuit className="w-4 h-4" /> 爆款逻辑拆解
                      </h3>
                      <p className="text-sm leading-relaxed text-slate-300">{intelData?.summary}</p>
                    </section>

                    <section className="space-y-3">
                      <h3 className="text-slate-500 text-xs font-bold uppercase tracking-widest flex items-center gap-2">
                        <ListIcon className="w-4 h-4" /> 核心文案脚本提炼
                      </h3>
                      <div className="bg-slate-950 p-4 rounded-xl border border-white/5">
                        <p className="text-xs font-mono text-slate-400 whitespace-pre-wrap leading-relaxed">
                          {intelData?.script}
                        </p>
                      </div>
                    </section>

                    <section className="space-y-4">
                      <h3 className="text-slate-500 text-xs font-bold uppercase tracking-widest flex items-center gap-2">
                        <Play className="w-4 h-4" /> PPT/报告 结构建议
                      </h3>
                      <div className="space-y-3">
                        {intelData?.pptStructure.map((slide, i) => (
                          <div key={i} className="p-4 bg-slate-800 rounded-xl border-l-4 border-cyan-500">
                            <p className="text-[10px] text-cyan-500 font-bold mb-1">PAGE {i + 1}</p>
                            <h4 className="font-bold text-sm mb-2">{slide.title}</h4>
                            <ul className="space-y-1">
                              {slide.content?.map((point: string, j: number) => (
                                <li key={j} className="text-xs text-slate-400 flex items-start gap-2">
                                  <div className="w-1 h-1 bg-slate-600 rounded-full mt-1.5" />
                                  {point}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    </section>
                  </div>
                )}
              </motion.div>
            )}

            {/* View 4: Synthesis Loading */}
            {view === 'synthesis' && (
              <motion.div 
                key="synthesis"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col items-center justify-center h-[60vh] text-center space-y-8"
              >
                <div className="relative">
                  <motion.div 
                    animate={{ rotate: 360 }}
                    transition={{ repeat: Infinity, duration: 4, ease: "linear" }}
                    className="w-32 h-32 rounded-full border-2 border-dashed border-cyan-500/30"
                  />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Video className="w-12 h-12 text-cyan-400 animate-pulse" />
                  </div>
                </div>
                <div className="space-y-4">
                  <h2 className="text-2xl font-bold">正在合成视频</h2>
                  <div className="space-y-2">
                    <p className="text-sm text-slate-400">正在下载选定的 {selectedIds.size} 项趋势素材...</p>
                    <p className="text-sm text-slate-400 font-mono">FFmpeg: Encoding frame sequence...</p>
                    <div className="w-48 h-1 bg-slate-800 rounded-full mx-auto overflow-hidden">
                      <motion.div 
                        initial={{ x: "-100%" }}
                        animate={{ x: "100%" }}
                        transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
                        className="w-full h-full bg-cyan-500"
                      />
                    </div>
                  </div>
                </div>
                <p className="text-xs text-slate-500 px-12">合成过程大约需要 30-60 秒，系统正在应用 Ken Burns 动态效果与 AI 推荐字幕。</p>
              </motion.div>
            )}

            {/* View 5: Video Player */}
            {view === 'player' && (
              <motion.div 
                key="player"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="space-y-6"
              >
                <div className="text-center space-y-1">
                  <h2 className="text-xl font-bold">视频合成完成</h2>
                  <p className="text-xs text-slate-400">点击下方播放并预览</p>
                </div>

                <div className="aspect-[9/16] bg-black rounded-3xl overflow-hidden shadow-2xl relative">
                  {generatedVideoUrl ? (
                    <video 
                      src={generatedVideoUrl} 
                      controls 
                      className="w-full h-full object-contain"
                      autoPlay
                    />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center space-y-4 p-8 text-center text-slate-500">
                      <Video className="w-16 h-16 opacity-20" />
                      <p>加载视频失败，请重试</p>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <a 
                    href={generatedVideoUrl || '#'} 
                    download={`viral_trends_${Date.now()}.mp4`}
                    className="flex-1 bg-white text-slate-950 font-bold py-4 rounded-2xl flex items-center justify-center gap-2 shadow-lg"
                  >
                    <Download className="w-5 h-5" />
                    下载视频
                  </a>
                  <button 
                    onClick={() => setView('search')}
                    className="flex-1 bg-slate-800 text-white font-bold py-4 rounded-2xl flex items-center justify-center gap-2 border border-white/5"
                  >
                    <RefreshCw className="w-5 h-5" />
                    再次制作
                  </button>
                </div>
              </motion.div>
            )}

          </AnimatePresence>
        </main>

        {/* Footer Navigation Overlay */}
        {(view === 'results' || view === 'analysis') && (
          <div className="p-6 fixed bottom-0 left-0 right-0 max-w-md mx-auto z-20 pointer-events-none">
            <div className="bg-slate-900/90 backdrop-blur-xl border border-white/10 rounded-3xl p-4 shadow-2xl pointer-events-auto flex items-center justify-between gap-4">
              <div className="px-2">
                <p className="text-[10px] uppercase font-black tracking-widest text-slate-500">已选择</p>
                <p className="text-lg font-bold text-cyan-400">{selectedIds.size} <span className="text-xs text-slate-400 italic">项</span></p>
              </div>
              
              <button 
                onClick={handleSynthesize}
                disabled={selectedIds.size === 0}
                className="flex-1 bg-cyan-500 text-slate-950 font-bold py-3.5 rounded-2xl flex items-center justify-center gap-2 shadow-lg shadow-cyan-500/20 active:scale-[0.98] transition-transform disabled:opacity-30"
              >
                <Video className="w-5 h-5" />
                立即合成视频
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
