'use client';

import { useState, useEffect } from 'react';

interface NFCRule {
  id: number;
  name: string;
  triggerType: 'video' | 'wechat' | 'review' | 'link';
  description: string;
  content: {
    title?: string;
    videoUrl?: string;
    wechatId?: string;
    reviewLink?: string;
    linkUrl?: string;
  };
  status: 'active' | 'paused';
  stats: {
    touches: number;
    uniqueUsers: number;
    conversions: number;
    todayTouches: number;
  };
  createdAt: string;
}

const mockRules: NFCRule[] = [
  {
    id: 1,
    name: '门店引流 - 爆款视频',
    triggerType: 'video',
    description: '客户碰一碰 NFC 标签，自动播放产品介绍视频，引导加粉',
    content: {
      title: '夏季新品发布会精彩回顾',
      videoUrl: 'https://www.example.com/video1.mp4'
    },
    status: 'active',
    stats: {
      touches: 12580,
      uniqueUsers: 8960,
      conversions: 2340,
      todayTouches: 156
    },
    createdAt: '2026-04-20T10:00:00Z'
  },
  {
    id: 2,
    name: '加微导流 - 客服号',
    triggerType: 'wechat',
    description: '碰一碰直接弹出微信二维码，引导添加客服微信号',
    content: {
      title: '添加客服领取专属福利',
      wechatId: 'ai_marketing001'
    },
    status: 'active',
    stats: {
      touches: 8920,
      uniqueUsers: 7650,
      conversions: 4560,
      todayTouches: 89
    },
    createdAt: '2026-04-22T14:30:00Z'
  },
  {
    id: 3,
    name: '大众点评导流',
    triggerType: 'review',
    description: '引导客户到大众点评写好评，提升店铺评分',
    content: {
      title: '感谢您的支持！点击写点评',
      reviewLink: 'https://www.dianping.com/shop/xxxxx'
    },
    status: 'active',
    stats: {
      touches: 4560,
      uniqueUsers: 3890,
      conversions: 890,
      todayTouches: 45
    },
    createdAt: '2026-04-25T09:00:00Z'
  },
  {
    id: 4,
    name: '活动页导流',
    triggerType: 'link',
    description: '新品上市活动页面，引导参与互动',
    content: {
      title: '618大促活动页',
      linkUrl: 'https://www.example.com/activity618'
    },
    status: 'paused',
    stats: {
      touches: 2100,
      uniqueUsers: 1890,
      conversions: 420,
      todayTouches: 0
    },
    createdAt: '2026-04-15T11:00:00Z'
  }
];

const triggerTypes = [
  { id: 'video', name: '视频分享', icon: '🎬', desc: '自动播放产品/活动视频' },
  { id: 'wechat', name: '加微信', icon: '💬', desc: '弹出微信二维码/ID' },
  { id: 'review', name: '写点评', icon: '⭐', desc: '引导到点评平台写评价' },
  { id: 'link', name: '跳转链接', icon: '🔗', desc: '跳转到指定活动页面' }
];

const scenarios = [
  { id: 1, name: '门店物料', desc: '商品包装、柜台展示、海报易拉宝', icon: '🏪' },
  { id: 2, name: '线下活动', desc: '展会、会议、快闪店、品牌发布会', icon: '🎪' },
  { id: 3, name: '产品包装', desc: '食品饮料、化妆品、数码产品包装', icon: '📦' },
  { id: 4, name: '名片物料', desc: '个人名片、企业宣传册、企业名片', icon: '💼' },
  { id: 5, name: '票券票据', desc: '演唱会门票、电影票、活动入场券', icon: '🎫' },
  { id: 6, name: '包装箱体', desc: '快递包装、家具家电、箱包箱体', icon: '📦' }
];

export default function NFCPromoPage() {
  const [rules, setRules] = useState<NFCRule[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editingRule, setEditingRule] = useState<NFCRule | null>(null);
  
  const [formData, setFormData] = useState({
    name: '',
    triggerType: 'video' as NFCRule['triggerType'],
    title: '',
    content: ''
  });

  useEffect(() => {
    setRules(mockRules);
  }, []);

  const totalStats = {
    touches: rules.reduce((sum, r) => sum + r.stats.touches, 0),
    uniqueUsers: rules.reduce((sum, r) => sum + r.stats.uniqueUsers, 0),
    conversions: rules.reduce((sum, r) => sum + r.stats.conversions, 0),
    todayTouches: rules.reduce((sum, r) => sum + r.stats.todayTouches, 0)
  };

  const handleOpenAddModal = () => {
    setEditingRule(null);
    setFormData({ name: '', triggerType: 'video', title: '', content: '' });
    setShowModal(true);
  };

  const handleOpenEditModal = (rule: NFCRule) => {
    setEditingRule(rule);
    setFormData({
      name: rule.name,
      triggerType: rule.triggerType,
      title: rule.content.title || '',
      content: rule.triggerType === 'wechat' ? rule.content.wechatId || '' : 
              rule.triggerType === 'review' ? rule.content.reviewLink || '' :
              rule.triggerType === 'link' ? rule.content.linkUrl || '' : ''
    });
    setShowModal(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setShowModal(false);
  };

  const handleToggleStatus = (ruleId: number) => {
    setRules(prev => prev.map(r => 
      r.id === ruleId ? { ...r, status: r.status === 'active' ? 'paused' : 'active' } : r
    ));
  };

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <p className="text-label mb-2">NFC 推广 / NFC PROMO</p>
          <h1 className="text-mono-lg text-white">碰一碰推广 / NFC TAP PROMO</h1>
          <p className="text-gray-400 mt-2 font-mono">NFC TAP TRIGGER CONFIG, MANAGE PROMO EFFECT DATA.</p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-4">
            <div className="text-3xl font-bold text-emerald-400 mb-1 font-mono">{totalStats.touches.toLocaleString()}</div>
            <div className="text-xs text-gray-500 font-mono">TOTAL TOUCHES</div>
          </div>
          <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-4">
            <div className="text-3xl font-bold text-blue-400 mb-1 font-mono">{totalStats.uniqueUsers.toLocaleString()}</div>
            <div className="text-xs text-gray-500 font-mono">UNIQUE USERS</div>
          </div>
          <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-4">
            <div className="text-3xl font-bold text-green-400 mb-1 font-mono">{totalStats.conversions.toLocaleString()}</div>
            <div className="text-xs text-gray-500 font-mono">CONVERSIONS</div>
          </div>
          <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-4">
            <div className="text-3xl font-bold text-orange-400 mb-1 font-mono">{totalStats.todayTouches.toLocaleString()}</div>
            <div className="text-xs text-gray-500 font-mono">TODAY TOUCHES</div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          <div className="lg:col-span-2">
            <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-label">TRIGGER RULES</h2>
                <button
                  onClick={handleOpenAddModal}
                  className="px-4 py-2 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 font-mono text-sm"
                >
                  + ADD RULE
                </button>
              </div>

              <div className="space-y-4">
                {rules.map(rule => (
                  <div key={rule.id} className="bg-white/5 rounded-xl p-4 border border-white/10">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">{triggerTypes.find(t => t.id === rule.triggerType)?.icon}</span>
                        <div>
                          <h3 className="font-semibold text-white font-mono">{rule.name}</h3>
                          <p className="text-xs text-gray-500 font-mono">{rule.description}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleToggleStatus(rule.id)}
                          className={`px-3 py-1 text-xs font-medium rounded-full font-mono ${
                            rule.status === 'active'
                              ? 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30'
                              : 'bg-gray-500/20 text-gray-400 hover:bg-gray-500/30'
                          }`}
                        >
                          {rule.status === 'active' ? 'ACTIVE' : 'PAUSED'}
                        </button>
                        <button
                          onClick={() => handleOpenEditModal(rule)}
                          className="text-gray-400 hover:text-gray-300 text-sm font-mono"
                        >
                          EDIT
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-4 gap-3 text-center">
                      <div className="bg-white/5 rounded-lg p-2">
                        <div className="text-lg font-semibold text-white font-mono">{rule.stats.touches.toLocaleString()}</div>
                        <div className="text-xs text-gray-500 font-mono">TOUCHES</div>
                      </div>
                      <div className="bg-white/5 rounded-lg p-2">
                        <div className="text-lg font-semibold text-white font-mono">{rule.stats.uniqueUsers.toLocaleString()}</div>
                        <div className="text-xs text-gray-500 font-mono">UNIQUE</div>
                      </div>
                      <div className="bg-white/5 rounded-lg p-2">
                        <div className="text-lg font-semibold text-white font-mono">{rule.stats.conversions.toLocaleString()}</div>
                        <div className="text-xs text-gray-500 font-mono">CONVERT</div>
                      </div>
                      <div className="bg-white/5 rounded-lg p-2">
                        <div className="text-lg font-semibold text-orange-400 font-mono">{rule.stats.todayTouches}</div>
                        <div className="text-xs text-gray-500 font-mono">TODAY</div>
                      </div>
                    </div>

                    <div className="mt-3 flex items-center justify-between text-xs">
                      <span className="text-gray-500 font-mono">
                        CREATED {new Date(rule.createdAt).toLocaleDateString('zh-CN')}
                      </span>
                      <div className="flex gap-2">
                        <button className="text-emerald-400 hover:text-emerald-300 font-mono">DETAILS</button>
                        <button className="text-emerald-400 hover:text-emerald-300 font-mono">REPORTS</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-6">
              <h3 className="text-label mb-4">TRIGGER TYPES</h3>
              <div className="space-y-3">
                {triggerTypes.map(type => (
                  <div key={type.id} className="flex items-center gap-3 p-3 bg-white/5 rounded-xl">
                    <span className="text-2xl">{type.icon}</span>
                    <div>
                      <div className="font-medium text-white text-sm font-mono">{type.name}</div>
                      <div className="text-xs text-gray-500 font-mono">{type.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-6">
              <h3 className="text-label mb-4">USE CASES</h3>
              <div className="grid grid-cols-2 gap-3">
                {scenarios.map(scenario => (
                  <div key={scenario.id} className="text-center p-3 bg-white/5 rounded-xl">
                    <div className="text-2xl mb-1">{scenario.icon}</div>
                    <div className="font-medium text-white text-xs font-mono">{scenario.name}</div>
                    <div className="text-xs text-gray-500 mt-1 font-mono">{scenario.desc}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 rounded-2xl border border-emerald-500/20 p-6">
              <h3 className="font-semibold text-white mb-3 font-mono">NFC ADVANTAGES</h3>
              <ul className="text-sm space-y-2 text-gray-300">
                <li>✓ ZERO BARRIER - TAP TO GET CONTENT</li>
                <li>✓ ONLINE/OFFLINE - PHYSICAL → TRAFFIC</li>
                <li>✓ DATA TRACKING - REAL-TIME STATS</li>
                <li>✓ ALL SCENARIOS - STORE/EVENT/PACK</li>
                <li>✓ PLUG & PLAY - QUICK DEPLOY</li>
              </ul>
            </div>
          </div>
        </div>

        {showModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-gray-900 rounded-2xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto border border-white/10">
              <h2 className="text-xl font-bold text-white mb-4 font-mono">
                {editingRule ? 'EDIT RULE' : 'ADD RULE'}
              </h2>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1 font-mono">RULE NAME</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500/50 font-mono"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-2 font-mono">TRIGGER TYPE</label>
                  <div className="grid grid-cols-2 gap-2">
                    {triggerTypes.map(type => (
                      <button
                        key={type.id}
                        type="button"
                        onClick={() => setFormData({ ...formData, triggerType: type.id as NFCRule['triggerType'] })}
                        className={`p-3 rounded-xl border text-left ${
                          formData.triggerType === type.id
                            ? 'border-emerald-500/50 bg-emerald-500/10'
                            : 'border-white/10 bg-white/5 hover:bg-white/10'
                        }`}
                      >
                        <span className="text-xl">{type.icon}</span>
                        <div className="font-medium text-sm mt-1 text-white font-mono">{type.name}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-1 font-mono">
                    {formData.triggerType === 'video' ? 'VIDEO TITLE' :
                     formData.triggerType === 'wechat' ? 'GUIDE TEXT' :
                     formData.triggerType === 'review' ? 'REVIEW GUIDE' : 'LINK TITLE'}
                  </label>
                  <input
                    type="text"
                    value={formData.title}
                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500/50 font-mono"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-1 font-mono">
                    {formData.triggerType === 'video' ? 'VIDEO URL' :
                     formData.triggerType === 'wechat' ? 'WECHAT ID' :
                     formData.triggerType === 'review' ? 'REVIEW LINK' : 'TARGET LINK'}
                  </label>
                  <input
                    type="text"
                    value={formData.content}
                    onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500/50 font-mono"
                    placeholder={formData.triggerType === 'wechat' ? 'WECHAT ID' : 'https://...'}
                    required
                  />
                </div>

                <div className="flex items-center justify-between pt-4">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="px-4 py-2 text-gray-400 hover:bg-white/10 rounded-xl font-mono"
                  >
                    CANCEL
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 font-mono"
                  >
                    {editingRule ? 'UPDATE' : 'CREATE'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}