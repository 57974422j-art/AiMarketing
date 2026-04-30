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
      const response = await fetch('/api/lead-collector?type=tasks', { credentials: 'include' });
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
      const response = await fetch(url, { credentials: 'include' });
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
        credentials: 'include',
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
        credentials: 'include',
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
        credentials: 'include',
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
      const response = await fetch(`/api/lead-collector?id=${taskId}`, { method: 'DELETE', credentials: 'include' });
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
    <div className="min-h-screen bg-gray-950">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex justify-between items-center mb-8">
          <div>
            <p className="text-label mb-2">意向客户管理 / LEAD MANAGEMENT</p>
            <h1 className="text-mono-lg text-white">客户采集 / LEAD COLLECTOR</h1>
          </div>
          {activeTab === 'tasks' && (
            <button
              onClick={handleOpenAddModal}
              className="px-4 py-2 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 font-mono"
            >
              <span>+ 添加任务</span>
            <span className="text-xs opacity-70 ml-1">ADD TASK</span>
            </button>
          )}
        </div>

        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setActiveTab('tasks')}
            className={`px-4 py-2 rounded-xl font-medium font-mono transition-colors ${
              activeTab === 'tasks'
                ? 'bg-emerald-500 text-white'
                : 'bg-white/5 text-gray-400 hover:bg-white/10 border border-white/10'
            }`}
          >
            <span>任务</span>
            <span className="text-xs opacity-50 ml-1">TASKS</span>
          </button>
          <button
            onClick={() => setActiveTab('leads')}
            className={`px-4 py-2 rounded-xl font-medium font-mono transition-colors ${
              activeTab === 'leads'
                ? 'bg-emerald-500 text-white'
                : 'bg-white/5 text-gray-400 hover:bg-white/10 border border-white/10'
            }`}
          >
            <span>客户 ({leads.length})</span>
            <span className="text-xs opacity-50 ml-1">LEADS</span>
          </button>
        </div>

        {activeTab === 'tasks' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {tasks.map(task => (
              <div key={task.id} className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-6">
                <div className="flex justify-between items-start mb-3">
                  <h3 className="text-lg font-semibold text-white font-mono">{task.name}</h3>
                  <span className={`px-2 py-1 text-xs font-medium rounded-full font-mono ${
                    task.status === 'running' ? 'bg-emerald-500/20 text-emerald-400' :
                    task.status === 'completed' ? 'bg-gray-500/20 text-gray-400' :
                    'bg-yellow-500/20 text-yellow-400'
                  }`}>
                    {task.status === 'running' ? 'RUNNING' :
                     task.status === 'completed' ? 'DONE' : 'PENDING'}
                  </span>
                </div>

                <div className="flex items-center gap-2 mb-3">
                  <span className="px-2 py-0.5 bg-purple-500/20 text-purple-400 text-xs rounded font-mono">
                    {task.platform}
                  </span>
                  <span className="text-sm text-gray-400 font-mono">{task.collectedCount} LEADS</span>
                </div>

                <div className="text-sm text-gray-500 mb-3 font-mono truncate" title={task.targetUrl}>
                  {task.targetUrl}
                </div>

                <div className="flex flex-wrap gap-1 mb-4">
                  {task.keywords.map((kw, idx) => (
                    <span key={idx} className="px-2 py-0.5 bg-blue-500/20 text-blue-400 text-xs rounded font-mono">
                      {kw}
                    </span>
                  ))}
                </div>

                <div className="flex space-x-2">
                  {task.status === 'pending' && (
                    <button
                      onClick={() => handleStartTask(task.id)}
                      className="flex-1 px-3 py-1.5 text-sm bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 font-mono"
                    >
                      START
                    </button>
                  )}
                  {task.status === 'running' && (
                    <button
                      onClick={() => handleStopTask(task.id)}
                      className="flex-1 px-3 py-1.5 text-sm bg-orange-500 text-white rounded-lg hover:bg-orange-600 font-mono"
                    >
                      STOP
                    </button>
                  )}
                  <button
                    onClick={() => handleOpenEditModal(task)}
                    className="px-3 py-1.5 text-sm bg-white/10 text-gray-300 rounded-lg hover:bg-white/20 font-mono"
                  >
                    EDIT
                  </button>
                  <button
                    onClick={() => handleDeleteTask(task.id)}
                    className="px-3 py-1.5 text-sm bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 font-mono"
                  >
                    DEL
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'leads' && (
          <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 overflow-hidden">
            <div className="p-4 border-b border-white/10">
              <div className="flex gap-3">
                <select
                  value={selectedTaskId || ''}
                  onChange={(e) => {
                    const id = e.target.value ? parseInt(e.target.value) : null;
                    setSelectedTaskId(id);
                    fetchLeads(id || undefined);
                  }}
                  className="px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-white focus:outline-none focus:border-emerald-500/50 font-mono"
                >
                  <option value="" className="bg-gray-900">ALL TASKS</option>
                  {tasks.map(task => (
                    <option key={task.id} value={task.id} className="bg-gray-900">{task.name}</option>
                  ))}
                </select>
                <button
                  onClick={() => {
                    setSelectedTaskId(null);
                    fetchLeads();
                  }}
                  className="px-4 py-2 bg-white/5 text-gray-400 rounded-xl hover:bg-white/10 border border-white/10 font-mono"
                >
                  RESET
                </button>
              </div>
            </div>

            <div className="divide-y divide-white/10">
              {filteredLeads.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-gray-500 font-mono">NO LEADS DATA</p>
                </div>
              ) : (
                filteredLeads.map(lead => (
                  <div key={lead.id} className="p-4 hover:bg-white/5">
                    <div className="flex gap-4">
                      <img
                        src={lead.avatar}
                        alt={lead.username}
                        className="w-12 h-12 rounded-full object-cover"
                      />
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium text-white font-mono">{lead.username}</span>
                          <span className="px-2 py-0.5 bg-purple-500/20 text-purple-400 text-xs rounded font-mono">
                            {lead.platform}
                          </span>
                          <span className="text-xs text-gray-500 font-mono">
                            {new Date(lead.createdAt).toLocaleString('zh-CN')}
                          </span>
                        </div>
                        <p className="text-sm text-gray-400 mb-2 font-mono">{lead.content}</p>
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-gray-500 font-mono">CONTACT:</span>
                          <span className="text-sm text-emerald-400 font-mono">{lead.contact}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button className="px-3 py-1 text-sm border border-white/10 text-gray-300 rounded hover:bg-white/10 font-mono">
                          VIEW
                        </button>
                        <button className="px-3 py-1 text-sm bg-emerald-500 text-white rounded hover:bg-emerald-600 font-mono">
                          CONTACT
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
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-gray-900 rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto border border-white/10">
              <h2 className="text-xl font-bold text-white mb-4 font-mono">
                {editingTask ? 'EDIT TASK' : 'ADD TASK'}
              </h2>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1 font-mono">TASK NAME</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500/50 font-mono"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1 font-mono">PLATFORM</label>
                  <select
                    value={formData.platform}
                    onChange={(e) => setFormData({ ...formData, platform: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500/50 font-mono"
                  >
                    {platforms.map(p => (
                      <option key={p} value={p} className="bg-gray-900">{p}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1 font-mono">TARGET URL</label>
                  <input
                    type="text"
                    value={formData.targetUrl}
                    onChange={(e) => setFormData({ ...formData, targetUrl: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500/50 font-mono"
                    placeholder="https://..."
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1 font-mono">
                    KEYWORDS (COMMA SEPARATED)
                  </label>
                  <textarea
                    value={formData.keywords}
                    onChange={(e) => setFormData({ ...formData, keywords: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500/50 font-mono"
                    rows={2}
                    placeholder="想了解,多少钱,怎么买,联系方式"
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
                    {editingTask ? 'UPDATE' : 'CREATE'}
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