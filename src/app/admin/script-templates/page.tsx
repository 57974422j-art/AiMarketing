'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/app/providers';
import { showToast } from '@/components/Toast';

/* ====== 类型定义 ====== */

interface ScriptItem {
  id: number;
  title: string;
  type: string;
  content: string;
  tags: string;
  ownerId: number;
  owner?: { id: number; username: string };
  createdAt: string;
}

const SCRIPT_TYPES = [
  { id: '评论', icon: '💬', desc: '视频/图文评论区回复话术' },
  { id: '私信', icon: '✉️', desc: '1v1 私聊沟通话术' },
  { id: '直播互动', icon: '🎤', desc: '直播间互动回复' },
  { id: '欢迎语', icon: '👋', desc: '新粉丝自动欢迎' },
  { id: '售后', icon: '🛎️', desc: '售后问题处理模板' },
];

const AI_SCENARIOS = [
  '美业-美容院拓客话术',
  '餐饮-外卖好评引导',
  '教育-课程咨询转化',
  '医美-项目介绍+预约',
  '零售-促销活动推广',
  '电商-催单/追评话术',
  '本地服务-到店核销',
  '知识付费-体验课引流',
];

/* ====== 组件 ====== */

export default function AdminScriptTemplatesPage() {
  const { user, loading: authLoading } = useAuth();
  const [items, setItems] = useState<ScriptItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState<ScriptItem | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('all');

  /* 表单字段 */
  const [title, setTitle] = useState('');
  const [type, setType] = useState('评论');
  const [content, setContent] = useState('');
  const [tagsStr, setTagsStr] = useState('');

  /* AI 生成状态 */
  const [showAIPanel, setShowAIPanel] = useState(false);
  const [aiScenario, setAiScenario] = useState('');
  const [aiCustomPrompt, setAiCustomPrompt] = useState('');
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiResults, setAiResults] = useState<string[]>([]);

  useEffect(() => {
    if (!authLoading && user && user.role !== 'end-user') loadItems();
    else if (!authLoading) setLoading(false);
  }, [authLoading, user]);

  const loadItems = async () => {
    try {
      const res = await fetch('/api/script-templates', { credentials: 'include' });
      if (res.ok) { const d = await res.json(); setItems(d.data || []); }
    } catch { console.error('加载失败'); }
    finally { setLoading(false); }
  };

  /* 过滤逻辑 */
  const filteredItems = items.filter(item => {
    const matchType = filterType === 'all' || item.type === filterType;
    const matchSearch = !searchQuery ||
      item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.content.toLowerCase().includes(searchQuery.toLowerCase());
    return matchType && matchSearch;
  });

  const resetForm = () => { setTitle(''); setType('评论'); setContent(''); setTagsStr(''); };
  const openCreate = () => { resetForm(); setEditItem(null); setShowForm(true); };

  const openEdit = (item: ScriptItem) => {
    setEditItem(item);
    setTitle(item.title);
    setType(item.type);
    setContent(item.content);
    try { setTagsStr(JSON.parse(item.tags).join(', ')); } catch { setTagsStr(''); }
    setShowForm(true);
  };

  const handleSubmit = async () => {
    if (!title || !content) { showToast('请填写完整', 'error'); return; }
    const tags = tagsStr.split(',').map(t => t.trim()).filter(Boolean);
    try {
      const method = editItem ? 'PUT' : 'POST';
      const body = editItem
        ? { id: editItem.id, title, type, content, tags }
        : { title, type, content, tags };
      const res = await fetch('/api/script-templates', {
        method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setShowForm(false);
        loadItems();
        showToast(editItem ? '更新成功' : '创建成功', 'success');
      } else {
        const d = await res.json();
        showToast(d.message || '操作失败', 'error');
      }
    } catch { showToast('操作失败', 'error'); }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('确定删除？')) return;
    const res = await fetch('/api/script-templates?id=' + id, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (res.ok) { loadItems(); showToast('已删除', 'success'); }
    else showToast('删除失败', 'error');
  };

  /* ====== AI 生成功能 ====== */

  const handleAIGenerate = async () => {
    const prompt = aiCustomPrompt || aiScenario;
    if (!prompt.trim()) { showToast('请选择场景或输入自定义提示', 'error'); return; }

    setAiGenerating(true);
    setAiResults([]);

    try {
      const res = await fetch('/api/script-templates', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'ai-generate', prompt, scriptType: type }),
      });

      const data = await res.json();

      if (data.success && data.data?.scripts) {
        setAiResults(data.data.scripts);
        showToast('AI 生成了 ' + data.data.scripts.length + ' 条话术', 'success');
      } else if (data.success && Array.isArray(data.data)) {
        setAiResults(data.data);
        showToast('AI 生成了 ' + data.data.length + ' 条话术', 'success');
      } else {
        const mockScripts = generateMockScripts(prompt, type);
        setAiResults(mockScripts);
        showToast('AI(Mock)生成了 ' + mockScripts.length + ' 条话术', 'success');
      }
    } catch (e) {
      console.log('AI 生成调用失败，使用 Mock 数据');
      const mockScripts = generateMockScripts(prompt, type);
      setAiResults(mockScripts);
      showToast('AI(Mock)生成了 ' + mockScripts.length + ' 条话术', 'success');
    } finally {
      setAiGenerating(false);
    }
  };

  /** Mock AI 话术生成器 */
  const generateMockScripts = (prompt: string, scriptType: string): string[] => {
    const templates: Record<string, string[]> = {
      '评论': [
        prompt + '-亲，感谢关注！我们这边是专业做这个的哦，有什么想了解的可以随时问我~',
        prompt + '-宝宝你好呀！看到你感兴趣就忍不住想多聊两句。我们家主打就是...需要的话私我发资料给你！',
        prompt + '-同款在这！很多姐妹都在用，效果真的绝了！不懂的问我，知无不言~',
      ],
      '私信': [
        prompt + '-私信版：您好！很高兴认识您，我是您的专属顾问。请问您是想了解哪方面内容呢？可以根据您的需求给您推荐最适合的方案~',
        prompt + '-私信版：亲爱的，收到您的咨询啦！这边帮您整理了一份详细资料，包括产品介绍、价格方案、真实案例。您方便的时候我发给您看看？',
      ],
      '直播互动': [
        prompt + '-直播版：欢迎新进来的宝宝！今天直播有超多福利。想了解XX的扣1，想看效果的扣2~',
        prompt + '-直播版：有人问到XX好不好用，我来给大家实拍一下！看清楚了哈...演示完毕，怎么样是不是很心动？今天下单还有优惠！',
        prompt + '-直播版：宝宝们别急啊，一个个来！客服在后台回复大家呢～先给大家发个红包，抢到了记得回来下单哦！',
      ],
      '欢迎语': [
        prompt + '-欢迎版：欢迎宝宝加入我们的大家庭！这里是XX官方账号，每天分享行业干货、好物推荐、粉丝专属福利。有任何问题随时私信我哦～',
      ],
      '售后': [
        prompt + '-售后版：亲，收到您的反馈了！非常抱歉给您带来不好的体验。这边马上帮您处理：1.订单号发给我确认 2.安排专员跟进 3.预计24小时内答复。感谢您的理解和支持！',
      ],
    };

    let result = templates[scriptType];
    if (!result) {
      result = [
        prompt + '-' + scriptType + '-定制话术1，可根据实际情况灵活调整使用~',
        prompt + '-' + scriptType + '-定制话术2，建议配合表情包一起发送效果更佳！',
        prompt + '-' + scriptType + '-定制话术3，适用于高频场景的快速回复~',
      ];
    }

    return result.map((s, i) => s + '\n\n--- AI生成 #' + (i + 1) + ' | 场景:' + prompt + ' | 类型:' + scriptType + ' ---');
  };

  /* 应用 AI 结果到表单 */
  const applyAIResult = (r: string) => {
    const cleanContent = r.replace(/\n?---.*?---\s*$/g, '').trim();
    setTitle(type + ' - ' + (aiScenario || aiCustomPrompt || 'AI生成'));
    setContent(cleanContent);
    setTagsStr('AI生成,' + (aiScenario || aiCustomPrompt || 'custom'));
    setShowForm(true);
    setShowAIPanel(false);
  };

  const parseTags = (raw: string): string[] => {
    try { return JSON.parse(raw); } catch { return []; }
  };

  /* ====== 权限检查 ====== */
  if (authLoading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <p className="text-gray-400">加载中...</p>
      </div>
    );
  }

  if (!user || user.role === 'end-user') {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <p className="text-red-400 text-xl">无权限访问</p>
      </div>
    );
  }

  /* ====== 主渲染 ====== */
  return (
    <div className="min-h-screen bg-gray-950">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-8 gap-4">
          <div>
            <p className="text-label mb-2">管理后台 / ADMIN</p>
            <h1 className="text-mono-lg text-white">话术模板库 / SCRIPT TEMPLATES</h1>
            <p className="text-gray-400 text-sm mt-2 font-mono">
              总数：<span className="text-emerald-400 font-bold">{items.length}</span> 条
              <span className="mx-2">|</span>
              支持AI智能生成
            </p>
          </div>
          <div className="flex gap-3">
            {/* AI 生成按钮 */}
            <button
              onClick={() => setShowAIPanel(!showAIPanel)}
              className={
                showAIPanel
                  ? 'px-4 py-2 rounded-xl font-mono text-sm bg-purple-500 text-white flex items-center gap-2'
                  : 'px-4 py-2 rounded-xl font-mono text-sm bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 border border-purple-500/30 flex items-center gap-2'
              }
            >
              <span>✨</span>
              <span>AI GENERATE</span>
            </button>
            <button onClick={openCreate} className="btn-primary">+ NEW SCRIPT</button>
          </div>
        </div>

        {/* AI 生成面板 */}
        {showAIPanel && (
          <div className="bg-gradient-to-br from-purple-500/10 to-blue-500/10 backdrop-blur-sm rounded-2xl border border-purple-500/20 p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-white font-mono flex items-center gap-2">
                <span>✨</span> AI 话术生成器
              </h3>
              <button onClick={() => setShowAIPanel(false)} className="text-gray-400 hover:text-white">
                ✕
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1.5 font-mono">场景预设</label>
                <select
                  value={aiScenario}
                  onChange={e => { setAiScenario(e.target.value); }}
                  className="input-dark"
                  size={4}
                >
                  <option value="" className="bg-gray-900">-- 选择预设场景 --</option>
                  {AI_SCENARIOS.map(s => (
                    <option key={s} value={s} className="bg-gray-900">{s}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1.5 font-mono">自定义描述（可选）</label>
                <textarea
                  value={aiCustomPrompt}
                  onChange={e => setAiCustomPrompt(e.target.value)}
                  className="input-dark h-24 resize-y"
                  placeholder="描述你的产品/服务、目标客户、期望语气..."
                />
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-xs text-gray-400 mb-1.5 font-mono">话术类型</label>
              <div className="flex flex-wrap gap-2">
                {SCRIPT_TYPES.map(t => (
                  <button
                    key={t.id}
                    onClick={() => setType(t.id)}
                    className={
                      type === t.id
                        ? 'px-3 py-1.5 rounded-lg text-xs font-mono bg-purple-500 text-white'
                        : 'px-3 py-1.5 rounded-lg text-xs font-mono bg-white/5 text-gray-400 hover:bg-white/10 border border-white/10'
                    }
                  >
                    {t.icon} {t.id}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={handleAIGenerate}
                disabled={aiGenerating}
                className="px-6 py-2.5 bg-gradient-to-r from-purple-500 to-blue-500 text-white rounded-xl font-mono text-sm hover:opacity-90 disabled:opacity-50 flex items-center gap-2"
              >
                {aiGenerating ? (
                  <>
                    <span className="animate-spin">⟳</span> GENERATING...
                  </>
                ) : (
                  <>
                    <span>🚀</span> GENERATE SCRIPTS
                  </>
                )}
              </button>
            </div>

            {/* AI 生成结果 */}
            {aiResults.length > 0 && (
              <div className="mt-6 space-y-3">
                <h4 className="text-sm text-gray-300 font-mono">生成结果：</h4>
                {aiResults.map((r, i) => (
                  <div key={i} className="bg-black/30 rounded-xl p-4 border border-white/10 group relative">
                    <pre className="text-sm text-gray-300 whitespace-pre-wrap font-sans leading-relaxed">{r}</pre>
                    <button
                      onClick={() => applyAIResult(r)}
                      className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity px-3 py-1 bg-emerald-500 text-white text-xs rounded-lg font-mono hover:bg-emerald-600"
                    >
                      USE THIS →
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 搜索 + 过滤栏 */}
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <div className="relative flex-1">
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="搜索话术标题或内容..."
              className="w-full bg-white/5 border border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500/50 font-mono text-sm"
            />
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">🔍</span>
          </div>
          <div className="flex gap-1 overflow-x-auto pb-1">
            <button
              onClick={() => setFilterType('all')}
              className={'px-3 py-2 rounded-lg text-xs font-mono whitespace-nowrap ' + (filterType === 'all' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-white/5 text-gray-400')}
            >ALL</button>
            {SCRIPT_TYPES.map(t => (
              <button
                key={t.id}
                onClick={() => setFilterType(t.id)}
                className={'px-3 py-2 rounded-lg text-xs font-mono whitespace-nowrap ' + (filterType === t.id ? 'bg-emerald-500/20 text-emerald-400' : 'bg-white/5 text-gray-400')}
              >
                {t.icon} {t.id}
              </button>
            ))}
          </div>
        </div>

        {/* 创建/编辑表单 */}
        {showForm && (
          <div className="card-glass p-6 mb-6">
            <h3 className="text-white font-bold mb-4 font-mono">{editItem ? '编辑话术' : '新建话术'}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <input
                className="input-dark"
                placeholder="标题 *"
                value={title}
                onChange={e => setTitle(e.target.value)}
              />
              <select
                className="input-dark"
                value={type}
                onChange={e => setType(e.target.value)}
              >
                {SCRIPT_TYPES.map(t => (
                  <option key={t.id} value={t} className="bg-gray-900">{t.icon} {t.id}</option>
                ))}
              </select>
              <input
                className="input-dark md:col-span-2"
                placeholder="标签（逗号分隔）"
                value={tagsStr}
                onChange={e => setTagsStr(e.target.value)}
              />
            </div>
            <textarea
              className="input-dark mb-4 h-40 resize-y"
              placeholder="话术内容 *"
              value={content}
              onChange={e => setContent(e.target.value)}
            />
            <div className="flex gap-3">
              <button onClick={handleSubmit} className="btn-primary">保存</button>
              <button onClick={() => setShowForm(false)} className="btn-secondary">取消</button>
            </div>
          </div>
        )}

        {/* 话术列表 */}
        {loading ? (
          <div className="text-center text-gray-400 py-12">
            <div className="animate-spin w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full mx-auto" />
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="card-glass p-12 text-center">
            <div className="text-4xl mb-3">📝</div>
            <p className="text-gray-400 font-mono">暂无话术</p>
            <p className="text-gray-500 text-sm mt-2">点击 &quot;AI GENERATE&quot; 智能生成，或手动创建</p>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredItems.map(item => (
              <div key={item.id} className="card-glass p-6 group hover:border-emerald-500/20 transition-colors">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <h3 className="text-white font-bold font-mono flex items-center gap-2">{item.title}</h3>
                    <div className="flex gap-2 mt-1.5 text-xs">
                      <span className="bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded font-mono">{item.type}</span>
                      {parseTags(item.tags).map((tag, i) =>
                        tag.startsWith('AI') ? (
                          <span key={i} className="bg-purple-500/20 text-purple-400 px-2 py-0.5 rounded">✨{tag}</span>
                        ) : (
                          <span key={i} className="bg-white/5 text-gray-400 px-2 py-0.5 rounded">#{tag}</span>
                        )
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => openEdit(item)}
                      className="px-3 py-1 text-xs bg-white/10 text-gray-300 rounded hover:bg-white/20 font-mono"
                    >EDIT</button>
                    <button
                      onClick={() => handleDelete(item.id)}
                      className="px-3 py-1 text-xs bg-red-500/20 text-red-400 rounded hover:bg-red-500/30 font-mono"
                    >DEL</button>
                  </div>
                </div>
                <div className="bg-black/30 rounded-lg p-4 mt-3 max-h-32 overflow-y-auto">
                  <p className="text-gray-300 text-sm whitespace-pre-wrap leading-relaxed">{item.content}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
