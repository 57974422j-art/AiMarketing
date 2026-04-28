'use client';

import { useState, useEffect } from 'react';

interface CollectionTask {
  id: number;
  name: string;
  platform: string;
  targetUrl: string;
  keywords: string[];
  status: 'pending' | 'running' | 'completed';
  collectedCount: number;
  createdAt: string;
  updatedAt: string;
}

interface Lead {
  id: number;
  taskId: number;
  taskName: string;
  username: string;
  avatar: string;
  content: string;
  contact: string;
  platform: string;
  createdAt: string;
}

const platforms = ['抖音', '快手', '小红书', 'B站', '微博', '视频号'];

export default function LeadCollectorPage() {
  const [tasks, setTasks] = useState<CollectionTask[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [activeTab, setActiveTab] = useState<'tasks' | 'leads'>('tasks');
  const [showModal, setShowModal] = useState(false);
  const [editingTask, setEditingTask] = useState<CollectionTask | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  
  const [formData, setFormData] = useState({
    name: '',
    platform: '抖音',
    targetUrl: '',
    keywords: '想了解,多少钱,怎么买,联系方式'
  });

  useEffect(() => {
    fetchTasks();
    fetchLeads();
  }, []);

  const fetchTasks = async () => {
    try {
      const response = await fetch('/api/lead-collector?type=tasks');
      const data = await response.json();
      if (data.success) {
        setTasks(data.data.map((task: any) => {
          const kw = Array.isArray(task.keywords) 
            ? task.keywords.map((k: any) => String(k).trim()).filter((k: string) => k)
            : (task.keywords || '').split(',').map((k: string) => k.trim()).filter((k: string) => k);
          return { ...task, keywords: kw };
        }));
      }
    } catch (error) {
      console.error('获取任务失败:', error);
    }
  };

  const fetchLeads = async (taskId?: number) => {
    try {
      const url = taskId 
        ? `/api/lead-collector?type=leads&taskId=${taskId}`
        : '/api/lead-collector?type=leads';
      const response = await fetch(url);
      const data = await response.json();
      if (data.success) {
        setLeads(data.data);
      }
    } catch (error) {
      console.error('获取意向客户失败:', error);
    }
  };

  const handleOpenAddModal = () => {
    setEditingTask(null);
    setFormData({
      name: '',
      platform: '抖音',
      targetUrl: '',
      keywords: '想了解,多少钱,怎么买,联系方式'
    });
    setShowModal(true);
  };

  const handleOpenEditModal = (task: CollectionTask) => {
    setEditingTask(task);
    setFormData({
      name: task.name,
      platform: task.platform,
      targetUrl: task.targetUrl,
      keywords: task.keywords.join(',')
    });
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const url = editingTask ? '/api/lead-collector' : '/api/lead-collector';
    const method = editingTask ? 'PUT' : 'POST';
    
    const body = editingTask
      ? { ...formData, id: editingTask.id, keywords: formData.keywords.split(',').map(k => k.trim()).filter(k => k) }
      : { ...formData, keywords: formData.keywords.split(',').map(k => k.trim()).filter(k => k) };
    
    try {
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      
      const data = await response.json();
      if (data.success) {
        fetchTasks();
        setShowModal(false);
      }
    } catch (error) {
      console.error('保存失败:', error);
    }
  };

  const handleStartTask = async (taskId: number) => {
    try {
      const response = await fetch('/api/lead-collector', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: taskId, status: 'running' })
      });
      
      const data = await response.json();
      if (data.success) {
        fetchTasks();
      }
    } catch (error) {
      console.error('启动任务失败:', error);
    }
  };

  const handleStopTask = async (taskId: number) => {
    try {
      const response = await fetch('/api/lead-collector', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: taskId, status: 'completed' })
      });
      
      const data = await response.json();
      if (data.success) {
        fetchTasks();
      }
    } catch (error) {
      console.error('停止任务失败:', error);
    }
  };

  const handleDeleteTask = async (taskId: number) => {
    try {
      const response = await fetch(`/api/lead-collector?id=${taskId}`, { method: 'DELETE' });
      const data = await response.json();
      if (data.success) {
        fetchTasks();
        if (selectedTaskId === taskId) {
          setSelectedTaskId(null);
          fetchLeads();
        }
      }
    } catch (error) {
      console.error('删除任务失败:', error);
    }
  };

  const filteredLeads = selectedTaskId 
    ? leads.filter(l => l.taskId === selectedTaskId)
    : leads;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">意向客户采集</h1>
        {activeTab === 'tasks' && (
          <button
            onClick={handleOpenAddModal}
            className="px-4 py-2 bg-primary text-white rounded-md hover:bg-primary-dark"
          >
            添加采集任务
          </button>
        )}
      </div>

      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setActiveTab('tasks')}
          className={`px-4 py-2 rounded-md font-medium ${
            activeTab === 'tasks'
              ? 'bg-primary text-white'
              : 'bg-white text-gray-700 hover:bg-gray-50'
          }`}
        >
          采集任务
        </button>
        <button
          onClick={() => setActiveTab('leads')}
          className={`px-4 py-2 rounded-md font-medium ${
            activeTab === 'leads'
              ? 'bg-primary text-white'
              : 'bg-white text-gray-700 hover:bg-gray-50'
          }`}
        >
          意向客户 ({leads.length})
        </button>
      </div>

      {activeTab === 'tasks' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {tasks.map(task => (
            <div key={task.id} className="bg-white rounded-lg shadow-md p-6">
              <div className="flex justify-between items-start mb-3">
                <h3 className="text-lg font-semibold text-gray-900">{task.name}</h3>
                <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                  task.status === 'running' ? 'bg-green-100 text-green-800' :
                  task.status === 'completed' ? 'bg-gray-100 text-gray-600' :
                  'bg-yellow-100 text-yellow-800'
                }`}>
                  {task.status === 'running' ? '采集ing' :
                   task.status === 'completed' ? '已完成' : '待启动'}
                </span>
              </div>
              
              <div className="flex items-center gap-2 mb-3">
                <span className="px-2 py-0.5 bg-purple-100 text-purple-800 text-xs rounded">
                  {task.platform}
                </span>
                <span className="text-sm text-gray-500">{task.collectedCount} 个意向客户</span>
              </div>
              
              <div className="text-sm text-gray-600 mb-3">
                <div className="truncate" title={task.targetUrl}>{task.targetUrl}</div>
              </div>
              
              <div className="flex flex-wrap gap-1 mb-4">
                {task.keywords.map((kw, idx) => (
                  <span key={idx} className="px-2 py-0.5 bg-blue-50 text-blue-700 text-xs rounded">
                    {kw}
                  </span>
                ))}
              </div>
              
              <div className="flex space-x-2">
                {task.status === 'pending' && (
                  <button
                    onClick={() => handleStartTask(task.id)}
                    className="flex-1 px-3 py-1.5 text-sm bg-green-500 text-white rounded hover:bg-green-600"
                  >
                    启动采集
                  </button>
                )}
                {task.status === 'running' && (
                  <button
                    onClick={() => handleStopTask(task.id)}
                    className="flex-1 px-3 py-1.5 text-sm bg-orange-500 text-white rounded hover:bg-orange-600"
                  >
                    停止采集
                  </button>
                )}
                <button
                  onClick={() => handleOpenEditModal(task)}
                  className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
                >
                  编辑
                </button>
                <button
                  onClick={() => handleDeleteTask(task.id)}
                  className="px-3 py-1.5 text-sm bg-red-100 text-red-700 rounded hover:bg-red-200"
                >
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'leads' && (
        <div className="bg-white rounded-lg shadow-md overflow-hidden">
          <div className="p-4 border-b">
            <div className="flex gap-3">
              <select
                value={selectedTaskId || ''}
                onChange={(e) => {
                  const id = e.target.value ? parseInt(e.target.value) : null;
                  setSelectedTaskId(id);
                  fetchLeads(id || undefined);
                }}
                className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">全部任务</option>
                {tasks.map(task => (
                  <option key={task.id} value={task.id}>{task.name}</option>
                ))}
              </select>
              <button
                onClick={() => {
                  setSelectedTaskId(null);
                  fetchLeads();
                }}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200"
              >
                重置筛选
              </button>
            </div>
          </div>
          
          <div className="divide-y divide-gray-200">
            {filteredLeads.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-gray-500">暂无意向客户数据</p>
              </div>
            ) : (
              filteredLeads.map(lead => (
                <div key={lead.id} className="p-4 hover:bg-gray-50">
                  <div className="flex gap-4">
                    <img 
                      src={lead.avatar} 
                      alt={lead.username}
                      className="w-12 h-12 rounded-full object-cover"
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-gray-900">{lead.username}</span>
                        <span className="px-2 py-0.5 bg-purple-100 text-purple-800 text-xs rounded">
                          {lead.platform}
                        </span>
                        <span className="text-xs text-gray-400">
                          {new Date(lead.createdAt).toLocaleString('zh-CN')}
                        </span>
                      </div>
                      <p className="text-sm text-gray-600 mb-2">{lead.content}</p>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-gray-500">联系方式:</span>
                        <span className="text-sm text-primary font-medium">{lead.contact}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50">
                        查看详情
                      </button>
                      <button className="px-3 py-1 text-sm bg-primary text-white rounded hover:bg-primary-dark">
                        联系客户
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold text-gray-900 mb-4">
              {editingTask ? '编辑采集任务' : '添加采集任务'}
            </h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">任务名称</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
                  required
                />
              </div>
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
                <label className="block text-sm font-medium text-gray-700 mb-1">目标链接</label>
                <input
                  type="text"
                  value={formData.targetUrl}
                  onChange={(e) => setFormData({ ...formData, targetUrl: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="https://..."
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  关键词（用逗号分隔，匹配到任一关键词即采集）
                </label>
                <textarea
                  value={formData.keywords}
                  onChange={(e) => setFormData({ ...formData, keywords: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
                  rows={2}
                  placeholder="想了解,多少钱,怎么买,联系方式"
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
                  {editingTask ? '更新' : '创建'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}