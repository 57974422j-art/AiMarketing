'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface ReferralConfig {
  id: number;
  name: string;
  platform: string;
  triggerType: string;
  keyword: string;
  responseMessage: string;
  qrcodeUrl: string;
  status: 'active' | 'paused';
  dailyLimit: number;
  todayCount: number;
  createdAt: string;
  updatedAt: string;
}

const platforms = ['抖音', '快手', '小红书', 'B站', '微博', '视频号'];
const triggerTypes = ['直播间评论', '私信关键词', '视频评论', '置顶评论', '自动回复'];

export default function ReferralPage() {
  const [referrals, setReferrals] = useState<ReferralConfig[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editingItem, setEditingItem] = useState<ReferralConfig | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<number | null>(null);
  
  const [formData, setFormData] = useState({
    name: '',
    platform: '抖音',
    triggerType: '直播间评论',
    keyword: '',
    responseMessage: '',
    dailyLimit: 100
  });

  useEffect(() => {
    fetchReferrals();
  }, []);

  const fetchReferrals = async () => {
    try {
      const response = await fetch('/api/referral');
      const data = await response.json();
      if (data.success) {
        setReferrals(data.data);
      }
    } catch (error) {
      console.error('获取导流配置失败:', error);
    }
  };

  const handleOpenAddModal = () => {
    setEditingItem(null);
    setFormData({
      name: '',
      platform: '抖音',
      triggerType: '直播间评论',
      keyword: '',
      responseMessage: '',
      dailyLimit: 100
    });
    setShowModal(true);
  };

  const handleOpenEditModal = (item: ReferralConfig) => {
    setEditingItem(item);
    setFormData({
      name: item.name,
      platform: item.platform,
      triggerType: item.triggerType,
      keyword: item.keyword,
      responseMessage: item.responseMessage,
      dailyLimit: item.dailyLimit
    });
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const url = editingItem ? '/api/referral' : '/api/referral';
    const method = editingItem ? 'PUT' : 'POST';
    
    const body = editingItem 
      ? { ...formData, id: editingItem.id }
      : formData;
    
    try {
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      
      const data = await response.json();
      if (data.success) {
        fetchReferrals();
        setShowModal(false);
      }
    } catch (error) {
      console.error('保存失败:', error);
    }
  };

  const handleToggleStatus = async (item: ReferralConfig) => {
    try {
      const response = await fetch('/api/referral', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...item, status: item.status === 'active' ? 'paused' : 'active' })
      });
      
      const data = await response.json();
      if (data.success) {
        fetchReferrals();
      }
    } catch (error) {
      console.error('更新状态失败:', error);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      const response = await fetch(`/api/referral?id=${id}`, { method: 'DELETE' });
      const data = await response.json();
      if (data.success) {
        fetchReferrals();
        setShowDeleteConfirm(null);
      }
    } catch (error) {
      console.error('删除失败:', error);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">导流配置管理</h1>
        <div className="flex gap-3">
          <Link
            href="/referral/preview"
            className="px-4 py-2 border border-primary text-primary rounded-md hover:bg-blue-50"
          >
            模拟触发测试
          </Link>
          <button
            onClick={handleOpenAddModal}
            className="px-4 py-2 bg-primary text-white rounded-md hover:bg-primary-dark"
          >
            添加配置
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-md overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">名称</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">平台</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">触发方式</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">关键词</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">今日触发</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">状态</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {referrals.map(item => (
              <tr key={item.id} className="hover:bg-gray-50">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm font-medium text-gray-900">{item.name}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-purple-100 text-purple-800">
                    {item.platform}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                  {item.triggerType}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                  {item.keyword || '-'}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm text-gray-900">{item.todayCount}</div>
                  <div className="text-xs text-gray-500">/ {item.dailyLimit} 次</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <button
                    onClick={() => handleToggleStatus(item)}
                    className={`px-3 py-1 text-xs font-medium rounded-full ${
                      item.status === 'active'
                        ? 'bg-green-100 text-green-800 hover:bg-green-200'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {item.status === 'active' ? '运行中' : '已暂停'}
                  </button>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleOpenEditModal(item)}
                      className="text-primary hover:text-primary-dark"
                    >
                      编辑
                    </button>
                    <button
                      onClick={() => setShowDeleteConfirm(item.id)}
                      className="text-red-500 hover:text-red-700"
                    >
                      删除
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold text-gray-900 mb-4">
              {editingItem ? '编辑导流配置' : '添加导流配置'}
            </h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">配置名称</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">平台</label>
                  <select
                    value={formData.platform}
                    onChange={(e) => setFormData({ ...formData, platform: e.target.value })}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    {platforms.map(p => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">触发方式</label>
                  <select
                    value={formData.triggerType}
                    onChange={(e) => setFormData({ ...formData, triggerType: e.target.value })}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    {triggerTypes.map(t => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">触发关键词（留空则不限制）</label>
                <input
                  type="text"
                  value={formData.keyword}
                  onChange={(e) => setFormData({ ...formData, keyword: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">自动回复消息</label>
                <textarea
                  value={formData.responseMessage}
                  onChange={(e) => setFormData({ ...formData, responseMessage: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
                  rows={3}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">每日触发上限</label>
                <input
                  type="number"
                  value={formData.dailyLimit}
                  onChange={(e) => setFormData({ ...formData, dailyLimit: parseInt(e.target.value) || 100 })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
                  min="1"
                  required
                />
              </div>
              <div className="flex items-center justify-between">
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
                  {editingItem ? '更新' : '创建'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {referrals.map(item => showDeleteConfirm === item.id && (
        <div key={item.id} className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-sm">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">确认删除</h3>
            <p className="text-gray-600 mb-4">确定要删除「{item.name}」这个导流配置吗？</p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowDeleteConfirm(null)}
                className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-md"
              >
                取消
              </button>
              <button
                onClick={() => handleDelete(item.id)}
                className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}