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
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">碰一碰实体推广</h1>
        <p className="text-gray-600">NFC 碰一碰触发规则配置，管理推广效果数据。适配门店物料、线下活动等多种场景。</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-white rounded-lg shadow-md p-4">
          <div className="text-3xl font-bold text-primary mb-1">{totalStats.touches.toLocaleString()}</div>
          <div className="text-sm text-gray-500">总触碰次数</div>
        </div>
        <div className="bg-white rounded-lg shadow-md p-4">
          <div className="text-3xl font-bold text-blue-600 mb-1">{totalStats.uniqueUsers.toLocaleString()}</div>
          <div className="text-sm text-gray-500">独立用户数</div>
        </div>
        <div className="bg-white rounded-lg shadow-md p-4">
          <div className="text-3xl font-bold text-green-600 mb-1">{totalStats.conversions.toLocaleString()}</div>
          <div className="text-sm text-gray-500">转化人数</div>
        </div>
        <div className="bg-white rounded-lg shadow-md p-4">
          <div className="text-3xl font-bold text-orange-500 mb-1">{totalStats.todayTouches.toLocaleString()}</div>
          <div className="text-sm text-gray-500">今日触碰</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <div className="lg:col-span-2">
          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold text-gray-900">触发规则配置</h2>
              <button
                onClick={handleOpenAddModal}
                className="px-4 py-2 bg-primary text-white rounded-md hover:bg-primary-dark"
              >
                添加规则
              </button>
            </div>

            <div className="space-y-4">
              {rules.map(rule => (
                <div key={rule.id} className="border border-gray-200 rounded-lg p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">{triggerTypes.find(t => t.id === rule.triggerType)?.icon}</span>
                      <div>
                        <h3 className="font-semibold text-gray-900">{rule.name}</h3>
                        <p className="text-sm text-gray-500">{rule.description}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleToggleStatus(rule.id)}
                        className={`px-3 py-1 text-xs font-medium rounded-full ${
                          rule.status === 'active'
                            ? 'bg-green-100 text-green-800 hover:bg-green-200'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                      >
                        {rule.status === 'active' ? '运行中' : '已暂停'}
                      </button>
                      <button
                        onClick={() => handleOpenEditModal(rule)}
                        className="text-gray-400 hover:text-gray-600"
                      >
                        编辑
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-4 gap-3 text-center">
                    <div className="bg-gray-50 rounded-lg p-2">
                      <div className="text-lg font-semibold text-gray-900">{rule.stats.touches.toLocaleString()}</div>
                      <div className="text-xs text-gray-500">触碰次数</div>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-2">
                      <div className="text-lg font-semibold text-gray-900">{rule.stats.uniqueUsers.toLocaleString()}</div>
                      <div className="text-xs text-gray-500">独立用户</div>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-2">
                      <div className="text-lg font-semibold text-gray-900">{rule.stats.conversions.toLocaleString()}</div>
                      <div className="text-xs text-gray-500">转化数</div>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-2">
                      <div className="text-lg font-semibold text-orange-500">{rule.stats.todayTouches}</div>
                      <div className="text-xs text-gray-500">今日触碰</div>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between text-sm">
                    <span className="text-gray-400">
                      创建于 {new Date(rule.createdAt).toLocaleDateString('zh-CN')}
                    </span>
                    <div className="flex gap-2">
                      <button className="text-primary hover:underline">查看详情</button>
                      <button className="text-primary hover:underline">数据报表</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow-md p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">触发类型</h3>
            <div className="space-y-3">
              {triggerTypes.map(type => (
                <div key={type.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                  <span className="text-2xl">{type.icon}</span>
                  <div>
                    <div className="font-medium text-gray-900">{type.name}</div>
                    <div className="text-xs text-gray-500">{type.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-md p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">适用场景</h3>
            <div className="grid grid-cols-2 gap-3">
              {scenarios.map(scenario => (
                <div key={scenario.id} className="text-center p-3 bg-gray-50 rounded-lg">
                  <div className="text-2xl mb-1">{scenario.icon}</div>
                  <div className="font-medium text-gray-900 text-sm">{scenario.name}</div>
                  <div className="text-xs text-gray-500 mt-1">{scenario.desc}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-gradient-to-br from-teal-500 to-cyan-600 rounded-lg shadow-md p-6 text-white">
            <h3 className="font-semibold mb-3">NFC 碰一碰优势</h3>
            <ul className="text-sm space-y-2 opacity-90">
              <li>✅ 零门槛触达 - 碰一碰即可获取内容</li>
              <li>✅ 线下线上联动 - 实体物料变流量入口</li>
              <li>✅ 数据追踪 - 实时统计触碰和转化</li>
              <li>✅ 多场景适配 - 门店/展会/包装全覆盖</li>
              <li>✅ 即装即用 - 快速部署灵活配置</li>
            </ul>
          </div>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold text-gray-900 mb-4">
              {editingRule ? '编辑规则' : '添加规则'}
            </h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">规则名称</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">触发类型</label>
                <div className="grid grid-cols-2 gap-2">
                  {triggerTypes.map(type => (
                    <button
                      key={type.id}
                      type="button"
                      onClick={() => setFormData({ ...formData, triggerType: type.id as NFCRule['triggerType'] })}
                      className={`p-3 rounded-lg border-2 text-left ${
                        formData.triggerType === type.id
                          ? 'border-primary bg-blue-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <span className="text-xl">{type.icon}</span>
                      <div className="font-medium text-sm mt-1">{type.name}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {formData.triggerType === 'video' ? '视频标题' : 
                   formData.triggerType === 'wechat' ? '引导文案' : 
                   formData.triggerType === 'review' ? '点评引导文案' : '链接标题'}
                </label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {formData.triggerType === 'video' ? '视频URL' : 
                   formData.triggerType === 'wechat' ? '微信号/二维码' : 
                   formData.triggerType === 'review' ? '点评链接' : '跳转链接'}
                </label>
                <input
                  type="text"
                  value={formData.content}
                  onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder={formData.triggerType === 'wechat' ? '输入微信号' : 'https://...'}
                  required
                />
              </div>

              <div className="flex items-center justify-between pt-4">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-md"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-primary text-white rounded-md hover:bg-primary-dark"
                >
                  {editingRule ? '更新' : '创建'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}