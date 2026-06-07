'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/app/providers';
import { showToast } from '@/components/Toast';

/* ====== 类型定义 ====== */

interface LiveRoom {
  id: number;
  name: string;
  platform: string;
  roomId?: string;
  accountId?: number;
  deviceId?: number;
  status: string; // offline/live/reconnecting/ended
  title?: string;
  coverImage?: string;
  welcomeMessage?: string;
  autoReplyRules: string;
  startTime?: string;
  endTime?: string;
  viewerCount: number;
  totalViewers: number;
  likeCount: number;
  commentCount: number;
  productCount: number;
  ownerId: number;
  createdAt: string;
}

interface LiveProduct {
  id: number;
  roomId: number;
  name: string;
  price?: number;
  image?: string;
  url?: string;
  sortOrder: number;
  status: string;
}

interface LiveScript {
  id: number;
  roomId: number;
  category: string; // welcome/product/intro/qa/close
  content: string;
  triggerKeyword?: string;
  sortOrder: number;
  isActive: boolean;
}

/* ====== 组件 ====== */

export default function LivePage() {
  const { user, loading: authLoading } = useAuth();
  const [rooms, setRooms] = useState<LiveRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRoom, setSelectedRoom] = useState<LiveRoom | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editRoom, setEditRoom] = useState<LiveRoom | null>(null);

  /* 表单字段 */
  const [name, setName] = useState('');
  const [platform, setPlatform] = useState('抖音');
  const [title, setTitle] = useState('');
  const [welcomeMessage, setWelcomeMessage] = useState('');

  /* Tab 切换 */
  const [activeTab, setActiveTab] = useState<'rooms' | 'products' | 'scripts' | 'console' | 'stats' | 'stream'>('rooms');

  /* ====== 推流控制相关状态 ====== */
  const [showStreamPanel, setShowStreamPanel] = useState(false);
  const [rtmpUrl, setRtmpUrl] = useState('');
  const [streamStatus, setStreamStatus] = useState<'idle' | 'preparing' | 'streaming' | 'stopping' | 'error'>('idle');
  const [currentSession, setCurrentSession] = useState<any>(null);
  const [streamLoading, setStreamLoading] = useState(false);
  const [genLoading, setGenLoading] = useState(false);
  const [genProgress, setGenProgress] = useState({ done: 0, total: 0 });
  const [avatarId, setAvatarId] = useState('');
  const [clips, setClips] = useState<any[]>([]);

  /* 商品列表 */
  const [products, setProducts] = useState<LiveProduct[]>([]);
  /* 话术列表 */
  const [scripts, setScripts] = useState<LiveScript[]>([]);

  /* 控制台 */
  const [consoleOutput, setConsoleOutput] = useState<string[]>([]);
  const [commandInput, setCommandInput] = useState('');

  /* ====== 素材仓库导入状态 ====== */
  const [showStorageModal, setShowStorageModal] = useState(false);
  const [storageFiles, setStorageFiles] = useState<Array<{ name: string; size: number; duration: number; isVideo: boolean }>>([]);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [storageLoading, setStorageLoading] = useState(false);

  useEffect(() => {
    if (!authLoading && user) loadRooms();
    else if (!authLoading) setLoading(false);
  }, [authLoading, user]);

  /* 加载直播间列表 */
  const loadRooms = async () => {
    try {
      const res = await fetch('/api/live', { credentials: 'include' });
      if (res.ok) {
        const d = await res.json();
        setRooms(d.data || []);
        if ((d.data || []).length > 0 && !selectedRoom) setSelectedRoom(d.data[0]);
      }
    } catch (e) {
      console.error('加载失败:', e);
    } finally {
      setLoading(false);
    }
  };

  /* 加载商品 */
  const loadProducts = async (roomId: number) => {
    try {
      const res = await fetch('/api/live/products?roomId=' + roomId, { credentials: 'include' });
      if (res.ok) { const d = await res.json(); setProducts(d.data || []); }
    } catch {}
  };

  /* 加载话术 */
  const loadScripts = async (roomId: number) => {
    try {
      const res = await fetch('/api/live/scripts?roomId=' + roomId, { credentials: 'include' });
      if (res.ok) { const d = await res.json(); setScripts(d.data || []); }
    } catch {}
  };

  /* 选择房间时切换数据 */
  const handleSelectRoom = (room: LiveRoom) => {
    setSelectedRoom(room);
    setActiveTab('rooms');
    if (room.id) {
      loadProducts(room.id);
      loadScripts(room.id);
    }
  };

  /* 创建/编辑直播间 */
  const handleSubmit = async () => {
    if (!name) { showToast('请输入直播间名称', 'error'); return; }

    const body = editRoom ? { id: editRoom.id, name, platform, title, welcomeMessage } : { name, platform, title, welcomeMessage };
    try {
      const res = await fetch('/api/live', {
        method: editRoom ? 'PUT' : 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setShowForm(false);
        loadRooms();
        showToast(editRoom ? '更新成功' : '创建成功', 'success');
      } else {
        const d = await res.json();
        showToast(d.message || '操作失败', 'error');
      }
    } catch {
      showToast('网络错误', 'error');
    }
  };

  const openCreate = () => { resetForm(); setEditRoom(null); setShowForm(true); };
  const openEdit = (room: LiveRoom) => {
    setEditRoom(room);
    setName(room.name);
    setPlatform(room.platform);
    setTitle(room.title || '');
    setWelcomeMessage(room.welcomeMessage || '');
    setShowForm(true);
  };
  const resetForm = () => { setName(''); setPlatform('抖音'); setTitle(''); setWelcomeMessage(''); };

  /* 直播控制命令 */
  const executeCommand = async (cmdType: string, payload?: Record<string, unknown>) => {
    if (!selectedRoom) { showToast('请先选择直播间', 'error'); return; }
    addLog('> ' + cmdType + (payload ? ' ' + JSON.stringify(payload) : ''));

    try {
      const res = await fetch('/api/live/command', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId: selectedRoom.id,
          command: cmdType,
          payload: payload || {},
        }),
      });

      const result = await res.json();

      if (result.success) {
        addLog('[OK] ' + (result.message || '执行成功'));
        showToast(result.message || '执行成功', 'success');
        if (cmdType === 'start_live' || cmdType === 'end_live') loadRooms();
      } else {
        addLog('[FAIL] ' + (result.message || '执行失败'));
        showToast(result.message || '执行失败', 'error');
      }
    } catch (e) {
      addLog('[ERROR] 网络异常');
      showToast('网络错误', 'error');
    }
  };

  const addLog = (msg: string) => {
    setConsoleOutput(prev => [...prev.slice(-50), '[' + new Date().toLocaleTimeString() + '] ' + msg]);
  };

  /* ====== 推流控制函数 ====== */

  /** 格式化秒数为 HH:MM:SS */
  const formatDuration = (seconds: number): string => {
    if (!seconds || seconds < 0) return '00:00:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  /** 启动推流 */
  const handleStartStream = async () => {
    if (!rtmpUrl.trim()) { showToast('请输入 RTMP 推流地址', 'error'); return; }
    setStreamLoading(true);
    addLog('[STREAM] 正在启动推流...');
    try {
      // 如果有已生成的 clips，直接用；否则让后端自动查找
      const body: any = { action: 'start-stream', rtmpUrl: rtmpUrl.trim() };
      if (clips.length > 0) body.clips = clips;

      const res = await fetch('/api/live/stream', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = await res.json();
      if (result.success) {
        setStreamStatus('streaming');
        setCurrentSession(result.data);
        addLog(`[OK] 推流启动成功 session=${result.data.id}`);
        showToast(result.message, 'success');
      } else {
        setStreamStatus('error');
        addLog(`[FAIL] ${result.message}`);
        showToast(result.message, 'error');
      }
    } catch (e: any) {
      setStreamStatus('error');
      addLog(`[ERROR] ${e.message}`);
      showToast('网络错误', 'error');
    } finally {
      setStreamLoading(false);
    }
  };

  /** 停止推流 */
  const handleStopStream = async () => {
    if (!currentSession?.id) return;
    addLog('[STREAM] 正在停止推流...');
    try {
      const res = await fetch('/api/live/stream', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop-stream', sessionId: currentSession.id }),
      });
      const result = await res.json();
      if (result.success) {
        setStreamStatus('idle');
        setCurrentSession(result.data);
        addLog('[OK] 推流已停止');
        showToast('推流已停止', 'success');
      } else {
        addLog(`[FAIL] ${result.message}`);
        showToast(result.message, 'error');
      }
    } catch (e: any) {
      addLog(`[ERROR] ${e.message}`);
    }
  };

  /** AI 一键生成内容 */
  const handleAIGenerate = async () => {
    if (!avatarId.trim()) { showToast('请先填写数字人形象 ID（从数字人板块获取）', 'error'); return; }

    setGenLoading(true);
    setGenProgress({ done: 0, total: 1 });
    addLog('[AI-GEN] 开始 AI 内容生成...');
    try {
      // 解析商品输入
      const productEl = document.getElementById('ai-products-input') as HTMLTextAreaElement;
      const toneEl = document.getElementById('ai-tone-select') as HTMLSelectElement;
      const rawProducts = productEl?.value || '';
      const products = rawProducts.split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => {
          const parts = line.split('|').map(s => s.trim());
          return {
            name: parts[0] || '未知商品',
            price: parts[1] || '待定价',
            features: parts[2]?.split(',').map(s => s.trim()).filter(Boolean) || [],
          };
        });

      const res = await fetch('/api/live/stream', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'ai-generate',
          avatarId: avatarId.trim(),
          brandTone: toneEl?.value || '亲切热情',
          products: products.length > 0 ? products : undefined,
        }),
      });

      const result = await res.json();
      if (result.success) {
        const task = result.data;
        setGenProgress(task.progress);
        addLog(`[OK] AI 生成完成: ${task.progress.done}/${task.progress.total} 条`);

        // 刷新素材列表
        const clipRes = await fetch('/api/live/stream?action=clips&taskId=' + task.id, { credentials: 'include' });
        const clipData = await clipRes.json();
        if (clipData.success && clipData.data.length > 0) {
          setClips(clipData.data);
          addLog(`[INFO] 已加载 ${clipData.data.length} 个素材片段`);
        }
        showToast(`成功生成 ${task.progress.done} 个视频片段`, 'success');
      } else {
        addLog(`[FAIL] ${result.message}`);
        showToast(result.message, 'error');
      }
    } catch (e: any) {
      addLog(`[ERROR] ${e.message}`);
      showToast('生成失败', 'error');
    } finally {
      setGenLoading(false);
    }
  };

  /* ====== 从素材仓库导入 ====== */

  /** 打开仓库选择弹窗，加载文件列表 */
  const handleOpenStorageModal = async () => {
    setShowStorageModal(true);
    setStorageLoading(true);
    setSelectedFiles(new Set());
    try {
      const res = await fetch('/api/live/stream?action=storage-videos', { credentials: 'include' });
      const d = await res.json();
      if (d.success) {
        setStorageFiles(d.data || []);
        addLog(`[STORAGE] 仓库中有 ${(d.data || []).length} 个视频文件`);
      } else {
        addLog(`[FAIL] 加载仓库失败: ${d.message}`);
      }
    } catch (e: any) {
      addLog(`[ERROR] ${e.message}`);
    } finally {
      setStorageLoading(false);
    }
  };

  /** 切换选中/取消选中文件 */
  const toggleFileSelect = (fileName: string) => {
    setSelectedFiles(prev => {
      const next = new Set(prev);
      if (next.has(fileName)) next.delete(fileName); else next.add(fileName);
      return next;
    });
  };

  /** 执行导入 */
  const handleImportFromStorage = async () => {
    if (selectedFiles.size === 0) { showToast('请至少选择一个文件', 'error'); return; }
    setStorageLoading(true);
    try {
      const fileNames = Array.from(selectedFiles);
      addLog(`[IMPORT] 正在导入 ${fileNames.length} 个文件...`);
      const res = await fetch('/api/live/stream', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'import-storage', fileNames }),
      });
      const result = await res.json();
      if (result.success) {
        // 将新 clips 合并到现有列表
        setClips(prev => [...prev, ...result.data]);
        addLog(`[OK] 导入成功: ${result.message}`);
        showToast(result.message, 'success');
        setShowStorageModal(false);
      } else {
        addLog(`[FAIL] ${result.message}`);
        showToast(result.message, 'error');
      }
    } catch (e: any) {
      addLog(`[ERROR] ${e.message}`);
    } finally {
      setStorageLoading(false);
    }
  };

  /** 权限检查 */
  if (authLoading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <p className="text-gray-400">加载中...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <p className="text-red-400 text-xl">请先登录</p>
      </div>
    );
  }

  /* ====== 主渲染 ====== */
  const STATUS_MAP: Record<string, { label: string; color: string }> = {
    offline: { label: '未开播', color: 'bg-gray-500/20 text-gray-400' },
    live: { label: '直播中', color: 'bg-red-500/20 text-red-400 animate-pulse' },
    reconnecting: { label: '重连中', color: 'bg-yellow-500/20 text-yellow-400' },
    ended: { label: '已结束', color: 'bg-blue-500/20 text-blue-400' },
  };

  const SCRIPT_CATEGORIES = [
    { id: 'welcome', icon: '👋', label: '欢迎语' },
    { id: 'product', icon: '📦', label: '产品介绍' },
    { id: 'intro', icon: '🎤', label: '开场话术' },
    { id: 'qa', icon: '❓', label: '问答回复' },
    { id: 'close', icon: '🔚', label: '结束语' },
  ];

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <p className="text-label mb-2">直播管理 / LIVE ROOM</p>
            <h1 className="text-mono-lg text-white">直播中控台 / LIVE CONTROL CENTER</h1>
            <p className="text-gray-400 text-sm mt-2 font-mono">
              共 <span className="text-emerald-400 font-bold">{rooms.length}</span> 个直播间
              {rooms.filter(r => r.status === 'live').length > 0 && (
                <span className="ml-3 text-red-400">
                  ● {rooms.filter(r => r.status === 'live').length} 个直播中
                </span>
              )}
            </p>
          </div>
          <button onClick={openCreate} className="btn-primary">+ NEW LIVE ROOM</button>
        </div>

        {/* 房间选择器 */}
        {rooms.length > 0 && (
          <div className="flex gap-3 mb-6 overflow-x-auto pb-1">
            {rooms.map(room => (
              <button
                key={room.id}
                onClick={() => handleSelectRoom(room)}
                className={'shrink-0 px-4 py-2.5 rounded-xl border transition-all ' +
                  (selectedRoom?.id === room.id
                    ? 'border-emerald-500/50 bg-emerald-500/10 text-white'
                    : 'border-white/10 bg-white/5 text-gray-400 hover:border-white/20')
                }
              >
                <div className="flex items-center gap-2">
                  <span className={STATUS_MAP[room.status]?.color + ' px-2 py-0.5 rounded-full text-xs'}>
                    {room.name}
                  </span>
                  <span className={'w-2 h-2 rounded-full ' +
                    (room.status === 'live' ? 'bg-red-500 shadow-lg shadow-red-500/50' : 'bg-gray-600')}
                  />
                </div>
                <div className="text-xs mt-1 font-mono opacity-70">
                  {room.status === 'live' ? room.viewerCount + '人在线' : STATUS_MAP[room.status]?.label}
                </div>
              </button>
            ))}
          </div>
        )}

        {/* 创建/编辑表单 */}
        {showForm && (
          <div className="card-glass p-6 mb-6">
            <h3 className="text-white font-bold mb-4 font-mono">{editRoom ? '编辑直播间' : '新建直播间'}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <input className="input-dark" placeholder="直播间名称 *" value={name} onChange={e => setName(e.target.value)} />
              <select className="input-dark" value={platform} onChange={e => setPlatform(e.target.value)}>
                <option value="抖音" className="bg-gray-900">抖音</option>
                <option value="快手" className="bg-gray-900">快手</option>
                <option value="视频号" className="bg-gray-900">微信视频号</option>
              </select>
              <input className="input-dark md:col-span-2" placeholder="直播标题（可选）" value={title} onChange={e => setTitle(e.target.value)} />
              <textarea
                className="input-dark md:col-span-2"
                placeholder="自动欢迎语（可选）：新进来的观众会收到这条消息..."
                rows={2}
                value={welcomeMessage}
                onChange={e => setWelcomeMessage(e.target.value)}
              />
            </div>
            <div className="flex gap-3">
              <button onClick={handleSubmit} className="btn-primary">保存</button>
              <button onClick={() => setShowForm(false)} className="btn-secondary">取消</button>
            </div>
          </div>
        )}

        {/* 无房间时显示空状态 */}
        {!showForm && rooms.length === 0 && !loading && (
          <div className="card-glass p-12 text-center">
            <div className="text-5xl mb-4">📺</div>
            <p className="text-gray-400 font-mono text-lg">暂无直播间</p>
            <p className="text-gray-500 text-sm mt-2">点击上方按钮创建你的第一个直播间</p>
          </div>
        )}

        {/* ====== 已选房间的详情面板 ====== */}
        {selectedRoom && !showForm && (
          <>
            {/* 房间统计卡片 */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
              <div className="card-glass p-4">
                <div className="text-xs text-gray-500 font-mono mb-1">观看人数</div>
                <div className="text-2xl font-bold text-white font-mono">{selectedRoom.viewerCount}</div>
              </div>
              <div className="card-glass p-4">
                <div className="text-xs text-gray-500 font-mono mb-1">累计观众</div>
                <div className="text-2xl font-bold text-white font-mono">{selectedRoom.totalViewers}</div>
              </div>
              <div className="card-glass p-4">
                <div className="text-xs text-gray-500 font-mono mb-1">点赞数</div>
                <div className="text-2xl font-bold text-pink-400 font-mono">{selectedRoom.likeCount}</div>
              </div>
              <div className="card-glass p-4">
                <div className="text-xs text-gray-500 font-mono mb-1">评论数</div>
                <div className="text-2xl font-bold text-emerald-400 font-mono">{selectedRoom.commentCount}</div>
              </div>
              <div className="card-glass p-4">
                <div className="text-xs text-gray-500 font-mono mb-1">上架商品</div>
                <div className="text-2xl font-bold text-orange-400 font-mono">{selectedRoom.productCount}</div>
              </div>
            </div>

            {/* Tab 导航 */}
            <div className="flex gap-1 mb-6 border-b border-white/10 pb-px overflow-x-auto">
              {[
                { key: 'rooms' as const, label: '🏠 概览', sub: '控制台+快捷操作' },
                { key: 'stream' as const, label: '📡 推流控制', sub: 'FFmpeg RTMP 推流' },
                { key: 'products' as const, label: '📦 商品管理', sub: products.length + '个商品' },
                { key: 'scripts' as const, label: '📝 话术库', sub: scripts.length + '条话术' },
                { key: 'console' as const, label: '⌨️ 命令控制台', sub: 'Q1 ADB 命令' },
                { key: 'stats' as const, label: '📊 数据统计', sub: '直播数据报表' },
              ].map(tab => (
                <button
                  key={tab.key}
                  onClick={() => { setActiveTab(tab.key); }}
                  className={'px-4 py-2.5 text-left rounded-t-lg transition-colors ' +
                    (activeTab === tab.key
                      ? 'bg-white/10 text-white border-t border-l border-r border-white/10 -mb-px'
                      : 'text-gray-500 hover:text-gray-300')
                  }
                >
                  <div className="font-mono text-sm">{tab.label}</div>
                  <div className="text-xs opacity-60 mt-0.5">{tab.sub}</div>
                </button>
              ))}
            </div>

            {/* ====== Tab: 概览/控制台 ====== */}
            {activeTab === 'rooms' && (
              <div className="space-y-6">
                {/* 快捷操作区 */}
                <div className="card-glass p-6">
                  <h3 className="text-white font-bold font-mono mb-4 flex items-center gap-2">
                    <span>🎮</span> 快捷操作
                  </h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {selectedRoom.status !== 'live' ? (
                      <button
                        onClick={() => executeCommand('start_live')}
                        className="px-4 py-3 bg-gradient-to-r from-red-500 to-pink-500 text-white rounded-xl font-mono text-sm hover:opacity-90 transition-opacity"
                      >
                        📹 开始直播
                      </button>
                    ) : (
                      <button
                        onClick={() => executeCommand('end_live')}
                        className="px-4 py-3 bg-gray-700 text-white rounded-xl font-mono text-sm hover:bg-gray-600 transition-colors"
                      >
                        ⏹ 结束直播
                      </button>
                    )}
                    <button
                      onClick={() => executeCommand('send_welcome')}
                      className="px-4 py-3 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-xl font-mono text-sm hover:bg-emerald-500/30 transition-colors"
                    >
                      👋 发送欢迎语
                    </button>
                    <button
                      onClick={() => executeCommand('refresh_stats')}
                      className="px-4 py-3 bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded-xl font-mono text-sm hover:bg-blue-500/30 transition-colors"
                    >
                      🔄 刷新数据
                    </button>
                    <button
                      onClick={() => openEdit(selectedRoom)}
                      className="px-4 py-3 bg-white/5 text-gray-300 border border-white/10 rounded-xl font-mono text-sm hover:bg-white/10 transition-colors"
                    >
                      ✏️ 编辑信息
                    </button>
                  </div>
                </div>

                {/* 当前状态 */}
                <div className="card-glass p-6">
                  <h3 className="text-white font-bold font-mono mb-4">当前状态</h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                    <div><span className="text-gray-500">名称：</span><span className="text-white font-mono">{selectedRoom.name}</span></div>
                    <div><span className="text-gray-500">平台：</span><span className="text-white font-mono">{selectedRoom.platform}</span></div>
                    <div>
                      <span className="text-gray-500">状态：</span>
                      <span className={(STATUS_MAP[selectedRoom.status]?.color || '') + ' ml-1 px-2 py-0.5 rounded text-xs'}>
                        {STATUS_MAP[selectedRoom.status]?.label || selectedRoom.status}
                      </span>
                    </div>
                    {selectedRoom.title && <div className="md:col-span-3"><span className="text-gray-500">标题：</span><span className="text-white font-mono">{selectedRoom.title}</span></div>}
                    {selectedRoom.startTime && <div><span className="text-gray-500">开始时间：</span><span className="text-white font-mono">{new Date(selectedRoom.startTime).toLocaleString()}</span></div>}
                    {selectedRoom.welcomeMessage && <div className="md:col-span-3"><span className="text-gray-500">欢迎语：</span><span className="text-emerald-400 font-mono">{selectedRoom.welcomeMessage}</span></div>}
                  </div>
                </div>
              </div>
            )}

            {/* ====== Tab: 推流控制 (FFmpeg RTMP) ====== */}
            {activeTab === 'stream' && (
              <div className="space-y-6">
                {/* 推流配置 + 启停控制 */}
                <div className="card-glass p-6">
                  <h3 className="text-white font-bold font-mono mb-4 flex items-center gap-2">
                    <span>📡</span> 推流引擎
                    {streamStatus === 'streaming' && (
                      <span className="ml-auto text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full animate-pulse">● 直播中</span>
                    )}
                    {(streamStatus === 'idle' || streamStatus === 'error') && (
                      <span className="ml-auto text-xs bg-gray-500/20 text-gray-400 px-2 py-0.5 rounded-full">○ 待命</span>
                    )}
                  </h3>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div>
                      <label className="text-xs text-gray-500 font-mono block mb-1">RTMP 推流地址 *</label>
                      <input
                        className="input-dark w-full"
                        placeholder="rtmp://push.douyin.com/live/xxxxx"
                        value={rtmpUrl}
                        onChange={e => setRtmpUrl(e.target.value)}
                        disabled={streamStatus === 'streaming' || streamStatus === 'preparing'}
                      />
                      <p className="text-xs text-gray-600 mt-1 font-mono">从抖音/快手直播后台获取推流地址</p>
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 font-mono block mb-1">数字人形象 ID</label>
                      <input
                        className="input-dark w-full"
                        placeholder="千寻训练后的 avatarId（数字人板块获取）"
                        value={avatarId}
                        onChange={e => setAvatarId(e.target.value)}
                      />
                      <p className="text-xs text-gray-600 mt-1 font-mono">在数字人板块克隆形象后获取</p>
                    </div>
                  </div>

                  <div className="flex gap-3 flex-wrap">
                    {(streamStatus === 'idle' || streamStatus === 'error') && (
                      <button
                        onClick={handleStartStream}
                        disabled={streamLoading || !rtmpUrl}
                        className="px-5 py-2.5 bg-gradient-to-r from-red-500 to-pink-500 text-white rounded-xl font-mono text-sm hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {streamLoading ? (
                          <><span className="inline-block animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full mr-2" />启动中...</>
                        ) : '📹 开始推流'}
                      </button>
                    )}
                    {streamStatus === 'streaming' && (
                      <button
                        onClick={handleStopStream}
                        className="px-5 py-2.5 bg-gray-700 text-white rounded-xl font-mono text-sm hover:bg-gray-600 transition-colors"
                      >
                        ⏹ 停止推流
                      </button>
                    )}
                    {currentSession && (
                      <button
                        onClick={() => fetch('/api/live/stream?action=clips', { credentials: 'include' }).then(r => r.json()).then(d => setClips(d.data || []))}
                        className="px-3 py-2 bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded-lg font-mono text-sm hover:bg-blue-500/30"
                      >
                        🔄 刷新素材 ({clips.length}个)
                      </button>
                    )}
                    <button
                      onClick={handleOpenStorageModal}
                      className="px-3 py-2 bg-orange-500/20 text-orange-400 border border-orange-500/30 rounded-lg font-mono text-sm hover:bg-orange-500/30"
                    >
                      📦 从仓库导入
                    </button>
                  </div>

                  {/* 当前会话信息 */}
                  {currentSession && (
                    <div className="mt-4 p-3 bg-black/30 rounded-lg border border-white/5">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs font-mono">
                        <div><span className="text-gray-500">Session:</span> <span className="text-emerald-400">{currentSession.id.slice(0, 12)}...</span></div>
                        <div><span className="text-gray-500">状态:</span> <span className={
                          currentSession.status === 'streaming' ? 'text-red-400' :
                          currentSession.status === 'error' ? 'text-red-400' : 'text-gray-300'
                        }>{currentSession.status}</span></div>
                        <div><span className="text-gray-500">时长:</span> <span className="text-white">{formatDuration(currentSession.durationSeconds)}</span></div>
                        <div><span className="text-gray-500">PID:</span> <span className="text-yellow-400">{currentSession.pid || '-'}</span></div>
                        {currentSession.startTime && (
                          <div className="md:col-span-2"><span className="text-gray-500">开始:</span> <span className="text-gray-300">{new Date(currentSession.startTime).toLocaleString()}</span></div>
                        )}
                        {currentSession.error && (
                          <div className="md:col-span-2 text-red-400"><span className="text-gray-500">错误:</span> {currentSession.error}</div>
                        )}
                      </div>
                    </div>
                  )}

                  {streamStatus === 'error' && !currentSession?.id && (
                    <p className="mt-3 text-red-400 text-sm font-mono">⚠️ 上次推流出错，请检查 RTMP 地址或重试</p>
                  )}
                </div>

                {/* AI 一键生成内容 */}
                <div className="card-glass p-6">
                  <h3 className="text-white font-bold font-mono mb-4 flex items-center gap-2">
                    <span>🤖</span> AI 一键生成直播内容
                    <span className="text-xs text-gray-500 font-normal ml-1">(商品 → 话术 → 数字人视频)</span>
                  </h3>

                  <p className="text-xs text-gray-500 mb-4 font-mono">
                    输入商品信息和品牌调性，AI 自动生成欢迎语、产品介绍、问答、逼单、结束语等全套口播内容，并调用数字人生成视频素材。
                  </p>

                  <div className="flex items-end gap-3 flex-wrap">
                    <div className="flex-1 min-w-[200px]">
                      <label className="text-xs text-gray-500 font-mono block mb-1">商品信息（每行一个，格式: 名称|价格|特点）</label>
                      <textarea
                        className="input-dark w-full"
                        rows={3}
                        placeholder={"示例:\n面膜补水保湿|99元|深层补水,敏感肌可用\n精华液抗老|199元|烟酰胺,提亮肤色"}
                        id="ai-products-input"
                      />
                    </div>
                    <div className="w-40">
                      <label className="text-xs text-gray-500 font-mono block mb-1">品牌调性</label>
                      <select className="input-dark" id="ai-tone-select">
                        <option value="亲切热情">亲切热情</option>
                        <option value="专业严谨">专业严谨</option>
                        <option value="幽默活泼">幽默活泼</option>
                        <option value="高端奢华">高端奢华</option>
                      </select>
                    </div>
                    <button
                      onClick={handleAIGenerate}
                      disabled={genLoading || !avatarId}
                      className="px-5 py-2.5 bg-purple-500/20 text-purple-400 border border-purple-500/30 rounded-xl font-mono text-sm hover:bg-purple-500/30 transition-colors disabled:opacity-40 h-[42px]"
                    >
                      {genLoading ? (
                        <><span className="inline-block animate-spin w-4 h-4 border-2 border-purple-400 border-t-transparent rounded-full mr-2" />{genProgress.done}/{genProgress.total}</>
                      ) : '🎬 AI 生成'}
                    </button>
                  </div>

                  {/* 已生成的素材预览 */}
                  {clips.length > 0 && (
                    <div className="mt-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs text-gray-500 font-mono">已生成素材 ({clips.length} 个片段)</span>
                        <span className="text-xs text-emerald-400 font-mono">
                          总时长约 {Math.floor(clips.reduce((s, c) => s + (c.duration || 30), 0) / 60)} 分钟
                        </span>
                      </div>
                      <div className="max-h-48 overflow-y-auto space-y-1.5">
                        {clips.map((clip, i) => (
                          <div key={i} className="flex items-center justify-between p-2 bg-black/20 rounded-lg text-xs">
                            <div className="flex items-center gap-2">
                              <span className="text-gray-500 font-mono w-6">{i + 1}.</span>
                              <span className="text-gray-300 truncate max-w-[200px]">{clip.type}</span>
                              <span className="text-emerald-400 font-mono">{clip.duration || '?'}s</span>
                            </div>
                            <span className="text-gray-600 font-mono">{clip.id?.slice(0, 8)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* 使用说明 */}
                <div className="card-glass p-6 border-dashed">
                  <h3 className="text-white font-bold font-mono mb-3 flex items-center gap-2">
                    <span>📖</span> 使用流程
                  </h3>
                  <div className="space-y-2 text-sm text-gray-400">
                    <div className="flex items-start gap-2">
                      <span className="bg-emerald-500/20 text-emerald-400 px-1.5 rounded text-xs font-mono mt-0.5">1</span>
                      <span>去 <strong className="text-white">数字人板块</strong> 克隆一个主播形象 → 获取 avatarId 填入上方</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="bg-emerald-500/20 text-emerald-400 px-1.5 rounded text-xs font-mono mt-0.5">2</span>
                      <span>选择素材来源: <strong className="text-white">「AI 生成」</strong> 自动制作 / <strong className="text-orange-400">「从仓库导入」</strong> 用已有视频</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="bg-emerald-500/20 text-emerald-400 px-1.5 rounded text-xs font-mono mt-0.5">3</span>
                      <span>填入抖音/快手给你的 <strong className="text-white">RTMP 推流地址</strong></span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="bg-emerald-500/20 text-emerald-400 px-1.5 rounded text-xs font-mono mt-0.5">4</span>
                      <span>点击 <strong className="text-white">「开始推流」</strong> — FFmpeg 自动循环播放素材并推送到直播间</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="bg-yellow-500/20 text-yellow-400 px-1.5 rounded text-xs font-mono mt-0.5">!</span>
                      <span>当前模式：预渲染录播轮播。未来升级 GPU 后切换为实时互动数字人。</span>
                    </div>
                  </div>
                </div>

                {/* ====== 素材仓库导入弹窗 ====== */}
                {showStorageModal && (
                  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowStorageModal(false)}>
                    <div className="bg-gray-900 border border-white/10 rounded-2xl w-full max-w-lg max-h-[70vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
                      {/* Header */}
                      <div className="flex items-center justify-between p-5 border-b border-white/10">
                        <div>
                          <h3 className="text-white font-bold font-mono">📦 从素材库导入</h3>
                          <p className="text-xs text-gray-500 mt-0.5">选择要加入直播播放列表的视频文件</p>
                        </div>
                        <button onClick={() => setShowStorageModal(false)} className="text-gray-500 hover:text-white transition-colors text-xl leading-none">&times;</button>
                      </div>

                      {/* File list */}
                      <div className="flex-1 overflow-y-auto p-4 min-h-[200px]">
                        {storageLoading && storageFiles.length === 0 ? (
                          <div className="flex items-center justify-center py-12">
                            <div className="animate-spin w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full" />
                          </div>
                        ) : storageFiles.length === 0 ? (
                          <div className="text-center py-12 text-gray-500">
                            <p className="text-3xl mb-2">📂</p>
                            <p className="font-mono">素材库为空</p>
                            <p className="text-xs mt-1">先在「数字人」或「一键成片」制作视频并存入仓库</p>
                          </div>
                        ) : (
                          <div className="space-y-1.5">
                            {storageFiles.map(file => (
                              <label
                                key={file.name}
                                className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all ${
                                  selectedFiles.has(file.name)
                                    ? 'bg-orange-500/15 border border-orange-500/30'
                                    : 'bg-black/20 border border-white/5 hover:border-white/10'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={selectedFiles.has(file.name)}
                                  onChange={() => toggleFileSelect(file.name)}
                                  className="w-4 h-4 rounded accent-orange-500"
                                />
                                <div className="flex-1 min-w-0">
                                  <div className="text-sm text-white truncate font-medium">{file.name}</div>
                                  <div className="text-xs text-gray-500 font-mono mt-0.5">
                                    {(file.size / 1024 / 1024).toFixed(1)} MB {file.duration > 0 ? `· ~${file.duration}s` : ''}
                                  </div>
                                </div>
                                <span className={`shrink-0 w-2 h-2 rounded-full ${file.isVideo ? 'bg-emerald-400' : 'bg-gray-600'}`} />
                              </label>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Footer */}
                      <div className="p-4 border-t border-white/10 flex items-center justify-between">
                        <span className="text-xs text-gray-500 font-mono">
                          已选 {selectedFiles.size} 个文件
                        </span>
                        <div className="flex gap-2">
                          <button
                            onClick={() => setShowStorageModal(false)}
                            className="px-4 py-2 bg-white/5 text-gray-400 rounded-lg text-sm hover:bg-white/10 transition-colors"
                          >
                            取消
                          </button>
                          <button
                            onClick={handleImportFromStorage}
                            disabled={selectedFiles.size === 0 || storageLoading}
                            className="px-5 py-2 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            {storageLoading ? (
                              <><span className="inline-block animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full mr-2" />导入中...</>
                            ) : `✅ 导入 ${selectedFiles.size} 个`}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ====== Tab: 商品管理 ====== */}
            {activeTab === 'products' && (
              <div className="card-glass p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-white font-bold font-mono flex items-center gap-2"><span>📦</span> 商品列表</h3>
                  <button
                    onClick={() => addLog('[INFO] 添加商品功能 - Mock模式')}
                    className="px-3 py-1.5 bg-orange-500/20 text-orange-400 text-xs rounded-lg font-mono hover:bg-orange-500/30 border border-orange-500/30"
                  >
                    + ADD PRODUCT
                  </button>
                </div>
                {products.length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    <p className="text-3xl mb-2">📦</p>
                    <p className="font-mono">暂无商品，点击上方添加</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {products.map(p => (
                      <div key={p.id} className="flex items-center justify-between p-3 bg-black/20 rounded-lg border border-white/5">
                        <div className="flex items-center gap-3">
                          <span className="text-2xl">🛍️</span>
                          <div>
                            <div className="text-white font-medium font-mono">{p.name}</div>
                            {p.price && <div className="text-orange-400 text-sm font-mono">¥{p.price}</div>}
                          </div>
                        </div>
                        <span className={'px-2 py-0.5 rounded text-xs font-mono ' +
                          (p.status === 'active' ? 'bg-green-500/20 text-green-400' :
                          p.status === 'sold_out' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-gray-500/20 text-gray-400')}
                        >
                          {p.status === 'active' ? '在售' : p.status === 'sold_out' ? '已售罄' : '下架'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ====== Tab: 话术库 ====== */}
            {activeTab === 'scripts' && (
              <div className="card-glass p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-white font-bold font-mono flex items-center gap-2"><span>📝</span> 话术脚本</h3>
                  <button
                    onClick={() => addLog('[INFO] 添加话术功能 - Mock模式')}
                    className="px-3 py-1.5 bg-purple-500/20 text-purple-400 text-xs rounded-lg font-mono hover:bg-purple-500/30 border border-purple-500/30"
                  >
                    + ADD SCRIPT
                  </button>
                </div>

                {/* 分类筛选 */}
                <div className="flex gap-2 mb-4 flex-wrap">
                  {SCRIPT_CATEGORIES.map(cat => (
                    <span key={cat.id} className="px-2.5 py-1 bg-white/5 text-gray-400 rounded-lg text-xs font-mono cursor-default">
                      {cat.icon} {cat.label}
                    </span>
                  ))}
                </div>

                {scripts.length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    <p className="text-3xl mb-2">📝</p>
                    <p className="font-mono">暂无语术，点击上方添加或从模板库导入</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {scripts.map(s => (
                      <div key={s.id} className="p-3 bg-black/20 rounded-lg border border-white/5 group">
                        <div className="flex items-center justify-between mb-2">
                          <span className={'px-2 py-0.5 rounded text-xs font-mono ' +
                            (s.isActive ? 'bg-purple-500/20 text-purple-400' : 'bg-gray-500/20 text-gray-500')}>
                            {SCRIPT_CATEGORIES.find(c => c.id === s.category)?.icon || '📋'} {s.category}
                          </span>
                          {s.triggerKeyword && (
                            <span className="text-yellow-400/70 text-xs font-mono">
                              触发词: &quot;{s.triggerKeyword}&quot;
                            </span>
                          )}
                        </div>
                        <p className="text-gray-300 text-sm leading-relaxed whitespace-pre-wrap">{s.content}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ====== Tab: Q1 命令控制台 ====== */}
            {activeTab === 'console' && (
              <div className="card-glass p-6">
                <h3 className="text-white font-bold font-mono mb-4 flex items-center gap-2">
                  <span>⌨️</span> Q1 ADB 命令控制台
                  <span className="text-xs text-gray-500 font-normal">(Mock 模式)</span>
                </h3>

                {/* 预设命令按钮 */}
                <div className="mb-4">
                  <p className="text-xs text-gray-500 font-mono mb-2">预设命令:</p>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { cmd: 'start_live', label: '📹 开播', color: 'from-red-500 to-red-600' },
                      { cmd: 'end_live', label: '⏹ 下播', color: 'from-gray-600 to-gray-700' },
                      { cmd: 'add_product', label: '📦 上架商品', color: 'from-orange-500 to-orange-600' },
                      { cmd: 'remove_product', label: '❌ 下架商品', color: 'from-yellow-600 to-yellow-700' },
                      { cmd: 'send_comment', label: '💬 发评论', color: 'from-blue-500 to-blue-600' },
                      { cmd: 'like', label: '👍 点赞', color: 'from-pink-500 to-pink-600' },
                      { cmd: 'share', label: '↗️ 分享', color: 'from-emerald-500 to-emerald-600' },
                      { cmd: 'follow_host', label: '+ 关注主播', color: 'from-purple-500 to-purple-600' },
                      { cmd: 'open_fans_club', label: '👥 粉丝团', color: 'from-indigo-500 to-indigo-600' },
                      { cmd: 'send_gift', label: '🎁 送礼', color: 'from-amber-500 to-amber-600' },
                      { cmd: 'switch_camera', label: '📷 切镜头', color: 'from-cyan-500 to-cyan-600' },
                      { cmd: 'mute_mic', label: '🔇 静音', color: 'from-slate-500 to-slate-600' },
                    ].map(item => (
                      <button
                        key={item.cmd}
                        onClick={() => executeCommand(item.cmd)}
                        className={'px-3 py-1.5 text-xs font-mono rounded-lg bg-gradient-to-r ' + item.color + ' text-white hover:opacity-90 transition-opacity'}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 输入框 */}
                <div className="flex gap-2 mb-4">
                  <input
                    type="text"
                    value={commandInput}
                    onChange={e => setCommandInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && commandInput.trim()) { executeCommand(commandInput.trim()); setCommandInput(''); } }}
                    placeholder="输入自定义命令..."
                    className="flex-1 bg-black/30 border border-white/10 rounded-lg px-4 py-2 text-white placeholder-gray-500 font-mono text-sm focus:outline-none focus:border-emerald-500/50"
                  />
                  <button
                    onClick={() => { if (commandInput.trim()) { executeCommand(commandInput.trim()); setCommandInput(''); } }}
                    className="px-4 py-2 bg-emerald-500 text-white rounded-lg font-mono text-sm hover:bg-emerald-600"
                  >
                    EXECUTE
                  </button>
                </div>

                {/* 日志输出 */}
                <div className="bg-black/40 rounded-lg p-4 h-64 overflow-y-auto font-mono text-xs">
                  {consoleOutput.length === 0 ? (
                    <p className="text-gray-600">// 等待执行命令...</p>
                  ) : consoleOutput.map((line, i) => (
                    <div key={i} className={
                      line.startsWith('[OK]') ? 'text-emerald-400' :
                      line.startsWith('[FAIL]') || line.startsWith('[ERROR]') ? 'text-red-400' :
                      line.startsWith('[INFO]') ? 'text-blue-400' :
                      line.startsWith('>') ? 'text-yellow-400' : 'text-gray-400'
                    }>
                      {line}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ====== Tab: 数据统计 ====== */}
            {activeTab === 'stats' && (
              <div className="space-y-6">
                {/* 实时数据卡片 */}
                <div className="card-glass p-6">
                  <h3 className="text-white font-bold font-mono mb-4">实时数据概览</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-black/20 rounded-xl p-4 text-center">
                      <div className="text-3xl font-bold text-white font-mono">{selectedRoom.totalViewers}</div>
                      <div className="text-xs text-gray-500 mt-1">累计观众</div>
                    </div>
                    <div className="bg-black/20 rounded-xl p-4 text-center">
                      <div className="text-3xl font-bold text-pink-400 font-mono">{selectedRoom.likeCount}</div>
                      <div className="text-xs text-gray-500 mt-1">总点赞</div>
                    </div>
                    <div className="bg-black/20 rounded-xl p-4 text-center">
                      <div className="text-3xl font-bold text-emerald-400 font-mono">{selectedRoom.commentCount}</div>
                      <div className="text-xs text-gray-500 mt-1">总评论</div>
                    </div>
                    <div className="bg-black/20 rounded-xl p-4 text-center">
                      <div className="text-3xl font-bold text-orange-400 font-mono">{selectedRoom.productCount}</div>
                      <div className="text-xs text-gray-500 mt-1">商品数</div>
                    </div>
                  </div>
                </div>

                {/* 数据指标说明 */}
                <div className="card-glass p-6">
                  <h3 className="text-white font-bold font-mono mb-4">数据指标</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-white/10">
                          <th className="text-left py-2 px-3 text-gray-500 font-mono">指标</th>
                          <th className="text-left py-2 px-3 text-gray-500 font-mono">当前值</th>
                          <th className="text-left py-2 px-3 text-gray-500 font-mono">说明</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {[
                          { label: '在线观众', value: selectedRoom.viewerCount, desc: '当前同时在线人数' },
                          { label: '累计观众', value: selectedRoom.totalViewers, desc: '本场直播总进入人次' },
                          { label: '点赞总数', value: selectedRoom.likeCount, desc: '累计点赞次数' },
                          { label: '评论总数', value: selectedRoom.commentCount, desc: '累计评论数量' },
                          { label: '互动率', value: selectedRoom.totalViewers > 0 ? ((selectedRoom.likeCount + selectedRoom.commentCount) / selectedRoom.totalViewers * 100).toFixed(1) + '%' : 'N/A', desc: '(点赞+评论)/观众' },
                        ].map(row => (
                          <tr key={row.label}>
                            <td className="py-2.5 px-3 text-white font-mono">{row.label}</td>
                            <td className="py-2.5 px-3 text-emerald-400 font-bold">{row.value}</td>
                            <td className="py-2.5 px-3 text-gray-500">{row.desc}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <p className="text-center text-gray-600 text-xs font-mono py-4">
                  * 当前为 Mock 模式，接入抖音直播 API 后显示真实数据
                </p>
              </div>
            )}
          </>
        )}

        {/* Loading 状态 */}
        {loading && rooms.length === 0 && (
          <div className="text-center py-16">
            <div className="animate-spin w-10 h-10 border-2 border-emerald-500 border-t-transparent rounded-full mx-auto mb-4" />
            <p className="text-gray-500 font-mono">加载直播间...</p>
          </div>
        )}

      </div>
    </div>
  );
}
