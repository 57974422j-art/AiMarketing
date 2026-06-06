'use client';

import { useState, useEffect } from 'react';

// ====== 类型定义 ======

interface PromoTemplate {
  id: number;
  name: string;
  category: 'nfc' | 'qr' | 'link' | 'miniapp' | 'card';
  triggerType: string;
  description: string;
  contentTitle?: string;
  contentUrl?: string;
  contentValue?: string;
  status: string;
  usageCount: number;
  createdAt: string;
}

const CATEGORIES = [
  { id: 'nfc', name: 'NFC 碰一碰', icon: '📱', desc: '物理触碰触发，零门槛' },
  { id: 'qr', name: '二维码', icon: '🔲', desc: '扫码跳转，通用性强' },
  { id: 'link', name: '短链接', icon: '🔗', desc: '短信/社交分发' },
  { id: 'miniapp', name: '小程序卡片', icon: '📨', desc: '微信生态内分享' },
  { id: 'card', name: '电子名片', icon: '💳', desc: '个人/企业名片' },
] as const;

const TRIGGERS = [
  { id: 'video', name: '视频播放', icon: '▶️', desc: '自动播放产品视频' },
  { id: 'wechat', name: '加微信', icon: '💬', desc: '弹出微信二维码' },
  { id: 'review', name: '写评价', icon: '⭐', desc: '引导到点评平台' },
  { id: 'form', name: '填表单', icon: '📋', desc: '收集用户信息' },
  { id: 'coupon', name: '领优惠券', icon: '🎫', desc: '发放优惠码' },
  { id: 'landing', name: '落地页', icon: '🌐', desc: '跳转到活动页' },
] as const;

const SCENARIOS = [
  { id: 'retail', name: '门店零售', icon: '🏪', tags: ['美业', '餐饮', '零售'] },
  { id: 'event', name: '线下活动', icon: '🎪', tags: ['展会', '快闪', '发布会'] },
  { id: 'product', name: '产品包装', icon: '📦', tags: ['食品', '化妆品', '数码'] },
  { id: 'business', name: '商务场景', icon: '💼', tags: ['名片', '宣传册', '礼品'] },
  { id: 'service', name: '服务行业', icon: '🛎️', tags: ['医美', '教育', '咨询'] },
  { id: 'ecommerce', name: '电商物流', icon: '🚚', tags: ['快递', '包装箱', '售后卡'] },
];

// 预置模板数据（Mock 模式下的示例）
const BUILTIN_TEMPLATES: Omit<PromoTemplate, 'id' | 'createdAt'>[] = [
  { name: '门店引流-加微信领券', category: 'nfc', triggerType: 'coupon', description: '客户到店碰一碰，自动弹出微信加好友+领取首单优惠券', contentTitle: '扫码添加店长微信，领取新人专属9折券！', contentValue: 'wxid_shop_001', status: 'active', usageCount: 128 },
  { name: '产品包装-视频介绍', category: 'nfc', triggerType: 'video', description: '贴在产品包装上，碰一碰自动播放产品演示视频', contentTitle: 'XX产品使用教程', contentUrl: 'https://example.com/video.mp4', status: 'active', usageCount: 256 },
  { name: '展会-收集意向客户', category: 'qr', triggerType: 'form', description: '展台二维码，扫描后填写信息进入线索池', contentTitle: '留下联系方式，获取产品资料+样品', contentUrl: 'https://example.com/form', status: 'active', usageCount: 89 },
  { name: '评价引导-好评返现', category: 'nfc', triggerType: 'review', description: '消费完成后碰一碰，引导写好评获取小红包', contentTitle: '好评有礼！写评价截图发给客服领5元红包~', contentUrl: 'https://example.com/review', status: 'active', usageCount: 342 },
  { name: '电子名片-个人版', category: 'card', triggerType: 'landing', description: '替代传统纸质名片，一键保存到通讯录', contentTitle: '张三 | 高级美容顾问', contentValue: '{"name":"张三","title":"高级美容顾问","phone":"138xxxx","company":"XX美容院"}', status: 'active', usageCount: 512 },
  { name: '快递包裹-售后服务', category: 'qr', triggerType: 'wechat', description: '快递面单附带二维码，扫码添加售后微信', contentTitle: '收货后如有问题，扫码联系专属客服', contentValue: 'wxid_service_001', status: 'active', usageCount: 1024 },
  { name: '小红书种草-跳转下单', category: 'link', triggerType: 'landing', description: '社交媒体短链接，直接跳转到商品购买页', contentTitle: '同款好物在这里👇限时特惠', contentUrl: 'https://example.com/product', status: 'active', usageCount: 78 },
  { name: '直播预约-提前锁客', category: 'miniapp', triggerType: 'form', description: '直播前分享小程序卡片，预约提醒+福利预告', contentTitle: '今晚8点开播！预约送正装礼品🎁', contentUrl: 'https://example.com/booking', status: 'active', usageCount: 167 },
];

// ====== 组件 ======

export default function PromoTemplatesPage() {
  const [templates, setTemplates] = useState<PromoTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<PromoTemplate | null>(null);

  // 表单状态
  const [formData, setFormData] = useState({
    name: '',
    category: 'nfc' as PromoTemplate['category'],
    triggerType: 'video',
    title: '',
    content: '',
    description: '',
  });
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => { loadTemplates(); }, []);

  const loadTemplates = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/templates/nfc', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          setTemplates(data.map((t: any) => ({
            ...t,
            category: t.category || 'nfc',
            usageCount: t.usageCount || 0,
          })));
          return;
        }
      }
      // Mock 模式：使用预置模板
      setTemplates(BUILTIN_TEMPLATES.map((t, i) => ({ ...t, id: i + 1, createdAt: new Date().toISOString() })));
    } catch (e) {
      console.error('加载失败:', e);
      setTemplates(BUILTIN_TEMPLATES.map((t, i) => ({ ...t, id: i + 1, createdAt: new Date().toISOString() })));
    } finally {
      setLoading(false);
    }
  };

  // 过滤逻辑
  const filtered = templates.filter(t => {
    const matchCat = activeCategory === 'all' || t.category === activeCategory;
    const matchSearch = !searchQuery ||
      t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.description.toLowerCase().includes(searchQuery.toLowerCase());
    return matchCat && matchSearch;
  });

  const totalUsage = templates.reduce((s, t) => s + t.usageCount, 0);
  const activeCount = templates.filter(t => t.status === 'active').length;

  // 使用模板
  const handleUseTemplate = (tpl: PromoTemplate) => {
    setSelectedTemplate(tpl);
    setFormData({
      name: tpl.name,
      category: tpl.category,
      triggerType: tpl.triggerType,
      title: tpl.contentTitle || '',
      content: tpl.contentValue || tpl.contentUrl || '',
      description: tpl.description,
    });
    setShowModal(true);
  };

  // 创建新模板
  const handleCreateNew = () => {
    setSelectedTemplate(null);
    setFormData({ name: '', category: 'nfc', triggerType: 'video', title: '', content: '', description: '' });
    setShowModal(true);
  };

  // 提交表单
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsCreating(true);
    try {
      const body = selectedTemplate?.id
        ? { id: selectedTemplate.id, name: formData.name, triggerType: formData.triggerType, description: formData.description, contentTitle: formData.title, contentValue: formData.content, category: formData.category }
        : { name: formData.name, triggerType: formData.triggerType, description: formData.description, contentTitle: formData.title, contentValue: formData.content, category: formData.category };

      const res = await fetch('/api/templates/nfc', {
        method: selectedTemplate ? 'PUT' : 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        setShowModal(false);
        loadTemplates();
      }
    } catch (e) {
      console.error('保存失败:', e);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-8 gap-4">
          <div>
            <p className="text-label mb-2">推广工具 / PROMO TOOLS</p>
            <h1 className="text-mono-lg text-white">推广模板库 / TEMPLATE LIBRARY</h1>
            <p className="text-gray-400 text-sm mt-2 font-mono">NFC / 二维码 / 短链接 / 小程序 / 电子名片 — 统一管理</p>
          </div>
          <button onClick={handleCreateNew}
            className="px-5 py-2.5 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 font-mono text-sm flex items-center gap-2"
          >
            <span>+ NEW TEMPLATE</span>
          </button>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-5">
            <div className="text-2xl font-bold text-emerald-400 font-mono">{templates.length}</div>
            <div className="text-xs text-gray-500 font-mono mt-1">TOTAL TEMPLATES</div>
          </div>
          <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-5">
            <div className="text-2xl font-bold text-blue-400 font-mono">{activeCount}</div>
            <div className="text-xs text-gray-500 font-mono mt-1">ACTIVE</div>
          </div>
          <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-5">
            <div className="text-2xl font-bold text-purple-400 font-mono">{totalUsage.toLocaleString()}</div>
            <div className="text-xs text-gray-500 font-mono mt-1">TOTAL USES</div>
          </div>
          <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-5">
            <div className="text-2xl font-bold text-orange-400 font-mono">{CATEGORIES.length}</div>
            <div className="text-xs text-gray-500 font-mono mt-1">CATEGORIES</div>
          </div>
        </div>

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Left: Template List */}
          <div className="lg:col-span-3 space-y-6">

            {/* Search + Filter Bar */}
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                  placeholder="搜索模板名称或描述..."
                  className="w-full bg-white/5 border border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500/50 font-mono text-sm"
                />
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">🔍</span>
              </div>
              {/* Category Filter Tabs */}
              <div className="flex gap-1 overflow-x-auto pb-1">
                <button onClick={() => setActiveCategory('all')}
                  className={`px-3 py-2 rounded-lg text-xs font-mono whitespace-nowrap transition-colors ${activeCategory === 'all' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-white/5 text-gray-400 hover:bg-white/10'}`}>
                  ALL
                </button>
                {CATEGORIES.map(cat => (
                  <button key={cat.id} onClick={() => setActiveCategory(cat.id)}
                    className={`px-3 py-2 rounded-lg text-xs font-mono whitespace-nowrap transition-colors ${activeCategory === cat.id ? 'bg-emerald-500/20 text-emerald-400' : 'bg-white/5 text-gray-400 hover:bg-white/10'}`}>
                    {cat.icon} {cat.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Template Cards Grid */}
            {loading ? (
              <div className="flex items-center justify-center py-16"><div className="animate-spin w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full" /></div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-16 bg-white/5 rounded-2xl border border-white/10">
                <div className="text-4xl mb-3">📋</div>
                <p className="text-gray-400 font-mono">NO TEMPLATES FOUND</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filtered.map(tpl => {
                  const cat = CATEGORIES.find(c => c.id === tpl.category);
                  const trig = TRIGGERS.find(t => t.id === tpl.triggerType);
                  return (
                    <div key={tpl.id} className="group bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-5 hover:border-emerald-500/30 transition-all">
                      {/* Header */}
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <span className="text-2xl">{cat?.icon || '📱'}</span>
                          <div>
                            <h3 className="font-semibold text-white font-mono group-hover:text-emerald-400 transition-colors">{tpl.name}</h3>
                            <div className="flex gap-1.5 mt-1">
                              <span className={`px-1.5 py-0.5 text-[10px] rounded font-mono ${cat ? `bg-${tpl.category === 'nfc' ? 'emerald' : tpl.category === 'qr' ? 'blue' : 'purple'}-500/20 text-${tpl.category === 'nfc' ? 'emerald' : tpl.category === 'qr' ? 'blue' : 'purple'}-400` : 'bg-gray-500/20 text-gray-400'}`}>{cat?.name || tpl.category}</span>
                              <span className="px-1.5 py-0.5 bg-yellow-500/20 text-yellow-400 text-[10px] rounded font-mono">{trig?.icon} {trig?.name}</span>
                            </div>
                          </div>
                        </div>
                        <span className={`w-2 h-2 rounded-full shrink-0 ${tpl.status === 'active' ? 'bg-emerald-400' : 'bg-gray-500'}`} />
                      </div>

                      {/* Description */}
                      <p className="text-sm text-gray-400 mb-4 line-clamp-2">{tpl.description}</p>

                      {/* Preview */}
                      {tpl.contentTitle && (
                        <div className="bg-black/30 rounded-lg p-3 mb-4">
                          <p className="text-sm text-gray-300 line-clamp-2">{tpl.contentTitle}</p>
                        </div>
                      )}

                      {/* Footer */}
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-500 font-mono">Used {tpl.usageCount} times</span>
                        <button onClick={() => handleUseTemplate(tpl)}
                          className="px-3 py-1.5 bg-emerald-500/20 text-emerald-400 text-xs font-mono rounded-lg hover:bg-emerald-500/30 transition-colors">
                          USE TEMPLATE →
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right Sidebar */}
          <div className="space-y-6">
            {/* Categories Overview */}
            <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-5">
              <h3 className="text-label mb-4">CATEGORY</h3>
              <div className="space-y-2">
                {CATEGORIES.map(cat => {
                  const count = templates.filter(t => t.category === cat.id).length;
                  return (
                    <button key={cat.id} onClick={() => setActiveCategory(cat.id)}
                      className={`w-full flex items-center gap-3 p-2.5 rounded-xl text-left transition-colors ${activeCategory === cat.id ? 'bg-emerald-500/10 border border-emerald-500/20' : 'hover:bg-white/5 border border-transparent'}`}
                    >
                      <span className="text-xl">{cat.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-white font-medium">{cat.name}</div>
                        <div className="text-[10px] text-gray-500 truncate">{cat.desc}</div>
                      </div>
                      <span className="text-xs text-gray-400 font-mono">{count}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Trigger Types */}
            <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-5">
              <h3 className="text-label mb-4">TRIGGER TYPES</h3>
              <div className="space-y-2">
                {TRIGGERS.map(trig => (
                  <div key={trig.id} className="flex items-center gap-3 p-2 bg-white/5 rounded-xl">
                    <span>{trig.icon}</span>
                    <div>
                      <div className="text-xs text-white font-mono font-medium">{trig.name}</div>
                      <div className="text-[10px] text-gray-500">{trig.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Scenarios */}
            <div className="bg-gradient-to-br from-emerald-500/10 to-cyan-500/10 rounded-2xl border border-emerald-500/20 p-5">
              <h3 className="font-semibold text-white mb-3 font-mono text-sm">USE CASES</h3>
              <div className="space-y-2">
                {SCENARIOS.map(s => (
                  <div key={s.id} className="flex items-center gap-2 p-2 bg-white/5 rounded-lg">
                    <span>{s.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-white font-mono">{s.name}</div>
                      <div className="text-[10px] text-gray-500 truncate">{s.tags.join('/')}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Create/Edit Modal */}
        {showModal && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-gray-900 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto border border-white/10">
              <div className="p-6">
                <h2 className="text-xl font-bold text-white mb-1 font-mono">
                  {selectedTemplate ? 'EDIT TEMPLATE' : 'NEW TEMPLATE'}
                </h2>
                <p className="text-xs text-gray-500 mb-5 font-mono">{selectedTemplate ? '修改现有推广模板配置' : '创建新的推广触达模板'}</p>

                <form onSubmit={handleSubmit} className="space-y-4">
                  {/* Name */}
                  <div>
                    <label className="block text-label mb-1.5">TEMPLATE NAME *</label>
                    <input type="text" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })}
                      className="input-dark" required placeholder="如：门店引流-加微信领券" />
                  </div>

                  {/* Category + Trigger Row */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-label mb-1.5">CATEGORY</label>
                      <select value={formData.category} onChange={e => setFormData({ ...formData, category: e.target.value as any })} className="input-dark">
                        {CATEGORIES.map(c => <option key={c.id} value={c.id} className="bg-gray-900">{c.icon} {c.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-label mb-1.5">TRIGGER TYPE</label>
                      <select value={formData.triggerType} onChange={e => setFormData({ ...formData, triggerType: e.target.value })} className="input-dark">
                        {TRIGGERS.map(t => <option key={t.id} value={t.id} className="bg-gray-900">{t.icon} {t.name}</option>)}
                      </select>
                    </div>
                  </div>

                  {/* Description */}
                  <div>
                    <label className="block text-label mb-1.5">DESCRIPTION</label>
                    <textarea value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })}
                      className="input-dark h-20 resize-y" placeholder="描述这个模板的用途和使用场景..." />
                  </div>

                  {/* Content Title */}
                  <div>
                    <label className="block text-label mb-1.5">CONTENT TITLE</label>
                    <input type="text" value={formData.title} onChange={e => setFormData({ ...formData, title: e.target.value })}
                      className="input-dark" placeholder="展示给用户看的标题文字" />
                  </div>

                  {/* Content Value */}
                  <div>
                    <label className="block text-label mb-1.5">CONTENT VALUE</label>
                    <textarea value={formData.content} onChange={e => setFormData({ ...formData, content: e.target.value })}
                      className="input-dark h-24 resize-y" placeholder="根据触发类型填写：微信号/链接URL/JSON数据..." />
                  </div>

                  {/* Actions */}
                  <div className="flex justify-end gap-3 pt-2">
                    <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">CANCEL</button>
                    <button type="submit" disabled={isCreating}
                      className="btn-primary disabled:opacity-50">
                      {isCreating ? 'SAVING...' : selectedTemplate ? 'UPDATE' : 'CREATE'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
