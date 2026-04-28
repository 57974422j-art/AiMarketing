'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface AIAgent {
  id: number;
  name: string;
  welcomeMessage: string;
  replyStyle: string;
  promptTemplate: string;
  createdAt: string;
  trainingDocuments: { id: number; title: string; type: string }[];
}

interface Document {
  id: number;
  title: string;
  content: string;
  type: string;
}

const replyStyles = ['专业', '亲切', '幽默'];
const documentTypes = ['话术', '产品资料', 'FAQ'];

export default function AIAgentPage() {
  const [agents, setAgents] = useState<AIAgent[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [showDocumentModal, setShowDocumentModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<number | null>(null);
  const [editingAgent, setEditingAgent] = useState<AIAgent | null>(null);
  const [currentAgentId, setCurrentAgentId] = useState<number | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  
  const [formData, setFormData] = useState({
    name: '',
    welcomeMessage: '',
    replyStyle: '专业',
    promptTemplate: '你是一个专业的客服助手，请根据提供的上下文信息回复用户的问题。'
  });

  const [documentFormData, setDocumentFormData] = useState({
    title: '',
    content: '',
    type: '话术'
  });

  useEffect(() => {
    fetchAgents();
  }, []);

  const fetchAgents = async () => {
    const response = await fetch('/api/ai-agent');
    const data = await response.json();
    if (data.success) {
      setAgents(data.data);
    }
  };

  const fetchDocuments = async (agentId: number) => {
    const response = await fetch(`/api/ai-agent/${agentId}/documents`);
    const data = await response.json();
    if (data.success) {
      setDocuments(data.data);
    }
  };

  const handleOpenAddModal = () => {
    setEditingAgent(null);
    setFormData({
      name: '',
      welcomeMessage: '',
      replyStyle: '专业',
      promptTemplate: '你是一个专业的客服助手，请根据提供的上下文信息回复用户的问题。'
    });
    setShowModal(true);
  };

  const handleOpenEditModal = (agent: AIAgent) => {
    setEditingAgent(agent);
    setFormData({
      name: agent.name,
      welcomeMessage: agent.welcomeMessage,
      replyStyle: agent.replyStyle,
      promptTemplate: agent.promptTemplate
    });
    setShowModal(true);
  };

  const handleOpenDocumentModal = (agentId: number) => {
    setCurrentAgentId(agentId);
    fetchDocuments(agentId);
    setDocumentFormData({ title: '', content: '', type: '话术' });
    setShowDocumentModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const url = editingAgent ? `/api/ai-agent/${editingAgent.id}` : '/api/ai-agent';
    const method = editingAgent ? 'PUT' : 'POST';
    
    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData)
    });
    
    const data = await response.json();
    if (data.success) {
      fetchAgents();
      setShowModal(false);
    }
  };

  const handleDelete = async (id: number) => {
    const response = await fetch(`/api/ai-agent/${id}`, { method: 'DELETE' });
    const data = await response.json();
    if (data.success) {
      fetchAgents();
      setShowDeleteConfirm(null);
    }
  };

  const handleAddDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!currentAgentId) return;
    
    const response = await fetch(`/api/ai-agent/${currentAgentId}/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(documentFormData)
    });
    
    const data = await response.json();
    if (data.success) {
      fetchDocuments(currentAgentId);
      setDocumentFormData({ title: '', content: '', type: '话术' });
    }
  };

  const handleDeleteDocument = async (documentId: number) => {
    if (!currentAgentId) return;
    
    await fetch(`/api/ai-agent/${currentAgentId}/documents/${documentId}`, {
      method: 'DELETE'
    });
    
    fetchDocuments(currentAgentId);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">AI 员工管理</h1>
        <button
          onClick={handleOpenAddModal}
          className="px-4 py-2 bg-primary text-white rounded-md hover:bg-primary-dark"
        >
          添加员工
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {agents.map(agent => (
          <div key={agent.id} className="bg-white rounded-lg shadow-md p-6">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">{agent.name}</h3>
                <span className={`inline-block mt-1 px-2 py-0.5 rounded-full text-xs ${
                  agent.replyStyle === '专业' ? 'bg-blue-100 text-blue-800' :
                  agent.replyStyle === '亲切' ? 'bg-green-100 text-green-800' :
                  'bg-yellow-100 text-yellow-800'
                }`}>
                  {agent.replyStyle}风格
                </span>
              </div>
              <div className="flex space-x-2">
                <Link
                  href={`/ai-agent/${agent.id}`}
                  className="px-2 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50"
                >
                  测试
                </Link>
              </div>
            </div>
            
            <p className="text-gray-600 text-sm mb-4 line-clamp-2">{agent.welcomeMessage}</p>
            
            <div className="flex items-center justify-between text-sm text-gray-500 mb-4">
              <span>{agent.trainingDocuments.length} 个培训文档</span>
              <span>{new Date(agent.createdAt).toLocaleDateString()}</span>
            </div>
            
            <div className="flex space-x-2">
              <button
                onClick={() => handleOpenEditModal(agent)}
                className="flex-1 px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
              >
                编辑
              </button>
              <button
                onClick={() => handleOpenDocumentModal(agent.id)}
                className="flex-1 px-3 py-1.5 text-sm bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
              >
                培训文档
              </button>
              <button
                onClick={() => setShowDeleteConfirm(agent.id)}
                className="px-3 py-1.5 text-sm bg-red-100 text-red-700 rounded hover:bg-red-200"
              >
                删除
              </button>
            </div>
            
            {showDeleteConfirm === agent.id && (
              <div className="mt-3 p-3 bg-red-50 rounded">
                <p className="text-sm text-red-700 mb-2">确定要删除这个AI员工吗？</p>
                <div className="flex space-x-2">
                  <button
                    onClick={() => setShowDeleteConfirm(null)}
                    className="flex-1 px-2 py-1 text-sm bg-gray-200 rounded"
                  >
                    取消
                  </button>
                  <button
                    onClick={() => handleDelete(agent.id)}
                    className="flex-1 px-2 py-1 text-sm bg-red-600 text-white rounded"
                  >
                    确认删除
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold text-gray-900 mb-4">
              {editingAgent ? '编辑AI员工' : '添加AI员工'}
            </h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">名称</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">欢迎语</label>
                <textarea
                  value={formData.welcomeMessage}
                  onChange={(e) => setFormData({ ...formData, welcomeMessage: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
                  rows={3}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">回复风格</label>
                <select
                  value={formData.replyStyle}
                  onChange={(e) => setFormData({ ...formData, replyStyle: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  {replyStyles.map(style => (
                    <option key={style} value={style}>{style}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">提示词模板</label>
                <textarea
                  value={formData.promptTemplate}
                  onChange={(e) => setFormData({ ...formData, promptTemplate: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
                  rows={4}
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
                  {editingAgent ? '更新' : '创建'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showDocumentModal && currentAgentId && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-gray-900">培训文档管理</h2>
              <button
                onClick={() => setShowDocumentModal(false)}
                className="px-3 py-1 text-gray-600 hover:bg-gray-100 rounded"
              >
                ×
              </button>
            </div>
            
            <form onSubmit={handleAddDocument} className="space-y-4 mb-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">标题</label>
                  <input
                    type="text"
                    value={documentFormData.title}
                    onChange={(e) => setDocumentFormData({ ...documentFormData, title: e.target.value })}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">类型</label>
                  <select
                    value={documentFormData.type}
                    onChange={(e) => setDocumentFormData({ ...documentFormData, type: e.target.value })}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    {documentTypes.map(type => (
                      <option key={type} value={type}>{type}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">内容</label>
                <textarea
                  value={documentFormData.content}
                  onChange={(e) => setDocumentFormData({ ...documentFormData, content: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
                  rows={4}
                  required
                />
              </div>
              <button
                type="submit"
                className="px-4 py-2 bg-primary text-white rounded-md hover:bg-primary-dark"
              >
                添加文档
              </button>
            </form>
            
            <div className="space-y-3">
              <h3 className="font-semibold text-gray-700">已有文档</h3>
              {documents.length === 0 ? (
                <p className="text-gray-500 text-center py-4">暂无培训文档</p>
              ) : (
                documents.map(doc => (
                  <div key={doc.id} className="p-3 bg-gray-50 rounded-lg flex justify-between items-start">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded text-xs ${
                          doc.type === '话术' ? 'bg-purple-100 text-purple-800' :
                          doc.type === '产品资料' ? 'bg-indigo-100 text-indigo-800' :
                          'bg-pink-100 text-pink-800'
                        }`}>
                          {doc.type}
                        </span>
                        <span className="font-medium">{doc.title}</span>
                      </div>
                      <p className="text-sm text-gray-600 mt-1 line-clamp-2">{doc.content}</p>
                    </div>
                    <button
                      onClick={() => handleDeleteDocument(doc.id)}
                      className="text-red-500 hover:text-red-700"
                    >
                      删除
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}