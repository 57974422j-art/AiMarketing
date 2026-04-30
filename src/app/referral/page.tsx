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
      const response = await fetch('/api/referral', { credentials: 'include' });
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
        credentials: 'include',
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
        credentials: 'include',
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
      const response = await fetch(`/api/referral?id=${id}`, { method: 'DELETE', credentials: 'include' });
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
    <div className="min-h-screen bg-gray-950">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex justify-between items-center mb-8">
          <div>
            <p className="text-label mb-2">导流管理 / REFERRAL MANAGEMENT</p>
            <h1 className="text-mono-lg text-white">导流配置 / REFERRAL CONFIG</h1>
          </div>
          <div className="flex gap-3">
            <Link
              href="/referral/preview"
              className="px-4 py-2 border border-white/10 text-white rounded-xl hover:bg-white/5 transition-colors"
            >
              SIMULATE TEST
            </Link>
            <button
              onClick={handleOpenAddModal}
              className="px-4 py-2 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 transition-colors"
            >
              ADD CONFIG
            </button>
          </div>
        </div>

        <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 overflow-hidden">
          <table className="w-full">
            <thead className="bg-white/5">
              <tr>
                <th className="px-6 py-4 text-left text-xs font-medium text-gray-400 uppercase tracking-wider font-mono">NAME</th>
                <th className="px-6 py-4 text-left text-xs font-medium text-gray-400 uppercase tracking-wider font-mono">PLATFORM</th>
                <th className="px-6 py-4 text-left text-xs font-medium text-gray-400 uppercase tracking-wider font-mono">TRIGGER</th>
                <th className="px-6 py-4 text-left text-xs font-medium text-gray-400 uppercase tracking-wider font-mono">KEYWORD</th>
                <th className="px-6 py-4 text-left text-xs font-medium text-gray-400 uppercase tracking-wider font-mono">TODAY</th>
                <th className="px-6 py-4 text-left text-xs font-medium text-gray-400 uppercase tracking-wider font-mono">STATUS</th>
                <th className="px-6 py-4 text-left text-xs font-medium text-gray-400 uppercase tracking-wider font-mono">ACTION</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {referrals.map(item => (
                <tr key={item.id} className="hover:bg-white/5">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-white">{item.name}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-purple-500/20 text-purple-400">
                      {item.platform}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-400 font-mono">
                    {item.triggerType}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-400 font-mono">
                    {item.keyword || '-'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-white font-mono">{item.todayCount}</div>
                    <div className="text-xs text-gray-500 font-mono">/ {item.dailyLimit}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <button
                      onClick={() => handleToggleStatus(item)}
                      className={`px-3 py-1 text-xs font-medium rounded-full ${
                        item.status === 'active'
                          ? 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30'
                          : 'bg-gray-500/20 text-gray-400 hover:bg-gray-500/30'
                      }`}
                    >
                      {item.status === 'active' ? 'ACTIVE' : 'PAUSED'}
                    </button>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                    <div className="flex gap-3">
                      <button
                        onClick={() => handleOpenEditModal(item)}
                        className="text-emerald-400 hover:text-emerald-300"
                      >
                        EDIT
                      </button>
                      <button
                        onClick={() => setShowDeleteConfirm(item.id)}
                        className="text-red-400 hover:text-red-300"
                      >
                        DELETE
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {showModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-gray-900 rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto border border-white/10">
              <h2 className="text-xl font-bold text-white mb-4 font-mono">
                {editingItem ? 'EDIT CONFIG' : 'ADD CONFIG'}
              </h2>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-label mb-1">CONFIG NAME</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500/50"
                    required
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-label mb-1">PLATFORM</label>
                    <select
                      value={formData.platform}
                      onChange={(e) => setFormData({ ...formData, platform: e.target.value })}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-3 text-white focus:outline-none focus:border-emerald-500/50"
                    >
                      {platforms.map(p => (
                        <option key={p} value={p} className="bg-gray-900">{p}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-label mb-1">TRIGGER TYPE</label>
                    <select
                      value={formData.triggerType}
                      onChange={(e) => setFormData({ ...formData, triggerType: e.target.value })}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-3 text-white focus:outline-none focus:border-emerald-500/50"
                    >
                      {triggerTypes.map(t => (
                        <option key={t} value={t} className="bg-gray-900">{t}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-label mb-1">KEYWORD (OPTIONAL)</label>
                  <input
                    type="text"
                    value={formData.keyword}
                    onChange={(e) => setFormData({ ...formData, keyword: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500/50"
                  />
                </div>
                <div>
                  <label className="block text-label mb-1">AUTO REPLY MESSAGE</label>
                  <textarea
                    value={formData.responseMessage}
                    onChange={(e) => setFormData({ ...formData, responseMessage: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500/50"
                    rows={3}
                    required
                  />
                </div>
                <div>
                  <label className="block text-label mb-1">DAILY LIMIT</label>
                  <input
                    type="number"
                    value={formData.dailyLimit}
                    onChange={(e) => setFormData({ ...formData, dailyLimit: parseInt(e.target.value) || 100 })}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white font-mono focus:outline-none focus:border-emerald-500/50"
                    min="1"
                    required
                  />
                </div>
                <div className="flex items-center justify-between pt-4">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="px-4 py-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-xl transition-colors"
                  >
                    CANCEL
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 transition-colors"
                  >
                    {editingItem ? 'UPDATE' : 'CREATE'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {referrals.map(item => showDeleteConfirm === item.id && (
          <div key={item.id} className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-gray-900 rounded-2xl p-6 w-full max-w-sm border border-white/10">
              <h3 className="text-lg font-semibold text-white mb-2 font-mono">CONFIRM DELETE</h3>
              <p className="text-gray-400 mb-4">DELETE CONFIG: {item.name}?</p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setShowDeleteConfirm(null)}
                  className="px-4 py-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-xl transition-colors"
                >
                  CANCEL
                </button>
                <button
                  onClick={() => handleDelete(item.id)}
                  className="px-4 py-2 bg-red-500 text-white rounded-xl hover:bg-red-600 transition-colors"
                >
                  CONFIRM
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}