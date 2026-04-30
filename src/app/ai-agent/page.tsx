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

const replyStyles = [
  { cn: '专业', en: 'PROFESSIONAL' },
  { cn: '亲切', en: 'FRIENDLY' },
  { cn: '幽默', en: 'HUMOROUS' }
];

const documentTypes = [
  { cn: '话术', en: 'SCRIPT' },
  { cn: '产品资料', en: 'PRODUCT' },
  { cn: 'FAQ', en: 'FAQ' }
];

export default function AIAgentPage() {
  const [agents, setAgents] = useState<AIAgent[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [showNLModal, setShowNLModal] = useState(false);
  const [showDocumentModal, setShowDocumentModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<number | null>(null);
  const [editingAgent, setEditingAgent] = useState<AIAgent | null>(null);
  const [currentAgentId, setCurrentAgentId] = useState<number | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [nlInput, setNlInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  
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
    const response = await fetch('/api/ai-agent', { credentials: 'include' });
    const data = await response.json();
    if (data.success) {
      setAgents(data.data);
    }
  };

  const fetchDocuments = async (agentId: number) => {
    const response = await fetch(`/api/ai-agent/${agentId}/documents`, { credentials: 'include' });
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

  const handleOpenNLModal = () => {
    setNlInput('');
    setShowNLModal(true);
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
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData)
    });
    
    const data = await response.json();
    if (data.success) {
      fetchAgents();
      setShowModal(false);
    }
  };

  const handleNLCreate = async () => {
    if (!nlInput.trim()) {
      alert('请输入您的需求描述 / Please describe your requirements');
      return;
    }

    setIsGenerating(true);

    try {
      const response = await fetch('/api/ai-agent/generate', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: nlInput })
      });

      const data = await response.json();
      
      if (data.success && data.data) {
        const generated = data.data;
        
        setFormData({
          name: generated.name || '智能客服',
          welcomeMessage: generated.welcomeMessage || '您好！很高兴为您服务！',
          replyStyle: generated.replyStyle || '亲切',
          promptTemplate: generated.promptTemplate || '你是一个专业的客服助手，请根据提供的上下文信息回复用户的问题。'
        });
        
        setShowNLModal(false);
        setShowModal(true);
        
        if (generated.trainingDocuments && generated.trainingDocuments.length > 0) {
          alert('AI已帮您解析需求！请检查并确认生成的员工信息。/ AI has parsed your requirements!');
        }
      } else {
        alert(data.message || 'AI解析失败，请重试 / AI parsing failed');
      }
    } catch (error) {
      console.error('NL create error:', error);
      alert('创建失败，请稍后重试 / Create failed');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDelete = async (id: number) => {
    const response = await fetch(`/api/ai-agent/${id}`, { method: 'DELETE', credentials: 'include' });
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
      credentials: 'include',
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
      method: 'DELETE',
      credentials: 'include'
    });
    
    fetchDocuments(currentAgentId);
  };

  const getReplyStyleName = (style: string) => {
    const s = replyStyles.find(r => r.cn === style);
    return s ? `${s.cn} / ${s.en}` : style;
  };

  const getReplyStyleColor = (style: string) => {
    switch(style) {
      case '专业': return 'bg-blue-500/20 text-blue-400 border border-blue-500/30';
      case '亲切': return 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30';
      case '幽默': return 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30';
      default: return 'bg-gray-500/20 text-gray-400 border border-gray-500/30';
    }
  };

  const getDocTypeColor = (type: string) => {
    switch(type) {
      case '话术': return 'bg-purple-500/20 text-purple-400';
      case '产品资料': return 'bg-indigo-500/20 text-indigo-400';
      case 'FAQ': return 'bg-pink-500/20 text-pink-400';
      default: return 'bg-gray-500/20 text-gray-400';
    }
  };

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex justify-between items-center mb-8">
          <div>
            <p className="text-label mb-2">AI 员工管理 / AI EMPLOYEE</p>
            <h1 className="text-mono-lg text-white">智能体 / AI AGENTS</h1>
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleOpenNLModal}
              className="px-4 py-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-xl hover:from-purple-600 hover:to-pink-600 transition-all"
            >
              <span>✨ 智能创建</span>
              <span className="text-xs opacity-70 ml-1">SMART</span>
            </button>
            <button
              onClick={handleOpenAddModal}
              className="px-4 py-2 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600"
            >
              <span>+ 添加智能体</span>
              <span className="text-xs opacity-70 ml-1">ADD AGENT</span>
            </button>
          </div>
        </div>

        {agents.length === 0 ? (
          <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-12 text-center">
            <p className="text-gray-400 mb-2">
              <span>暂无 AI 智能体</span>
              <span className="opacity-50 ml-1">/ NO AI AGENTS YET</span>
            </p>
            <p className="text-gray-500 text-sm">
              <span>创建您的第一个 AI 员工开始使用</span>
              <span className="opacity-50 ml-1">/ CREATE YOUR FIRST AI EMPLOYEE</span>
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {agents.map(agent => (
            <div key={agent.id} className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-6">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="text-lg font-semibold text-white">{agent.name}</h3>
                  <span className={`inline-block mt-1 px-2 py-0.5 rounded-full text-xs ${getReplyStyleColor(agent.replyStyle)}`}>
                    {agent.replyStyle} STYLE
                  </span>
                </div>
                <div className="flex space-x-2">
                  <Link
                    href={`/ai-agent/${agent.id}`}
                    className="px-3 py-1 text-sm border border-white/10 text-gray-300 rounded-lg hover:bg-white/10"
                  >
                    <span>测试</span>
                    <span className="text-xs opacity-50 ml-1">TEST</span>
                  </Link>
                </div>
              </div>
              
              <p className="text-gray-400 text-sm mb-4 line-clamp-2">{agent.welcomeMessage}</p>
              
              <div className="flex items-center justify-between text-sm text-gray-500 mb-4">
                <span>{agent.trainingDocuments.length} <span className="opacity-70">文档/DOCS</span></span>
                <span>{new Date(agent.createdAt).toLocaleDateString()}</span>
              </div>
              
              <div className="flex space-x-2">
                <button
                  onClick={() => handleOpenEditModal(agent)}
                  className="flex-1 px-3 py-1.5 text-sm bg-white/5 text-gray-300 rounded-lg hover:bg-white/10"
                >
                  <span>编辑</span>
                  <span className="text-xs opacity-50 ml-1">EDIT</span>
                </button>
                <button
                  onClick={() => handleOpenDocumentModal(agent.id)}
                  className="flex-1 px-3 py-1.5 text-sm bg-purple-500/20 text-purple-300 rounded-lg hover:bg-purple-500/30"
                >
                  <span>文档</span>
                  <span className="text-xs opacity-50 ml-1">DOCS</span>
                </button>
                <button
                  onClick={() => setShowDeleteConfirm(agent.id)}
                  className="px-3 py-1.5 text-sm bg-red-500/20 text-red-300 rounded-lg hover:bg-red-500/30"
                >
                  <span>删除</span>
                  <span className="text-xs opacity-50 ml-1">DEL</span>
                </button>
              </div>
              
              {showDeleteConfirm === agent.id && (
                <div className="mt-3 p-3 bg-red-500/10 rounded-xl border border-red-500/20">
                  <p className="text-sm text-red-400 mb-2">
                    <span>确认删除此 AI 智能体?</span>
                    <span className="opacity-70 ml-1">/ CONFIRM DELETE?</span>
                  </p>
                  <div className="flex space-x-2">
                    <button
                      onClick={() => setShowDeleteConfirm(null)}
                      className="flex-1 px-2 py-1 text-sm bg-white/10 text-gray-300 rounded"
                    >
                      <span>取消</span>
                      <span className="text-xs opacity-50 ml-1">CANCEL</span>
                    </button>
                    <button
                      onClick={() => handleDelete(agent.id)}
                      className="flex-1 px-2 py-1 text-sm bg-red-500 text-white rounded"
                    >
                      <span>确认</span>
                      <span className="text-xs opacity-70 ml-1">CONFIRM</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
        )}

        {showModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-gray-900 rounded-2xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto border border-white/10">
              <h2 className="text-xl font-bold text-white mb-4">
                {editingAgent ? (
                  <><span>编辑智能体</span><span className="text-sm opacity-50 ml-1">EDIT AI AGENT</span></>
                ) : (
                  <><span>添加智能体</span><span className="text-sm opacity-50 ml-1">ADD AI AGENT</span></>
                )}
              </h2>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">
                    <span>名称</span>
                    <span className="opacity-50 ml-1">NAME</span>
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-emerald-500/50"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">
                    <span>欢迎语</span>
                    <span className="opacity-50 ml-1">WELCOME MESSAGE</span>
                  </label>
                  <textarea
                    value={formData.welcomeMessage}
                    onChange={(e) => setFormData({ ...formData, welcomeMessage: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-emerald-500/50"
                    rows={3}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">
                    <span>回复风格</span>
                    <span className="opacity-50 ml-1">STYLE</span>
                  </label>
                  <select
                    value={formData.replyStyle}
                    onChange={(e) => setFormData({ ...formData, replyStyle: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-emerald-500/50"
                  >
                    {replyStyles.map(style => (
                      <option key={style.cn} value={style.cn} className="bg-gray-900">{style.cn} / {style.en}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">
                    <span>提示模板</span>
                    <span className="opacity-50 ml-1">PROMPT TEMPLATE</span>
                  </label>
                  <textarea
                    value={formData.promptTemplate}
                    onChange={(e) => setFormData({ ...formData, promptTemplate: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-emerald-500/50"
                    rows={4}
                    required
                  />
                </div>
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="px-4 py-2 text-gray-400 hover:bg-white/10 rounded-xl"
                  >
                    <span>取消</span>
                    <span className="text-xs opacity-50 ml-1">CANCEL</span>
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600"
                  >
                    {editingAgent ? (
                      <span>更新 / UPDATE</span>
                    ) : (
                      <span>创建 / CREATE</span>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {showNLModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-gray-900 rounded-2xl p-6 w-full max-w-lg border border-white/10">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold text-white">
                  <span>✨ 智能创建 AI 智能体</span>
                  <span className="text-sm opacity-50 ml-1">SMART CREATE</span>
                </h2>
                <button
                  onClick={() => setShowNLModal(false)}
                  className="px-3 py-1 text-gray-400 hover:bg-white/10 rounded"
                >
                  ×
                </button>
              </div>
              
              <p className="text-gray-400 mb-4 text-sm">
                <span>用自然语言描述您想创建的 AI 员工</span>
                <span className="opacity-50 ml-1">/ DESCRIBE IN NATURAL LANGUAGE</span>
              </p>
              
              <div className="space-y-3 mb-4">
                <div className="p-3 bg-white/5 rounded-xl">
                  <p className="text-sm text-gray-500">示例 / EXAMPLE:</p>
                  <p className="text-sm text-gray-300 mt-1">
                    "我想要一个当客户询问价格时，引导他们添加微信的客服助手"
                  </p>
                </div>
                <div className="p-3 bg-white/5 rounded-xl">
                  <p className="text-sm text-gray-300">
                    "创建一个专业的产品销售助手，能详细介绍产品并引导下单"
                  </p>
                </div>
              </div>
              
              <textarea
                value={nlInput}
                onChange={(e) => setNlInput(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500/50"
                rows={4}
                placeholder="描述您的需求... / Describe your requirements..."
              />
              
              <div className="flex justify-end gap-3 mt-4">
                <button
                  onClick={() => setShowNLModal(false)}
                  className="px-4 py-2 text-gray-400 hover:bg-white/10 rounded-xl"
                >
                  <span>取消</span>
                  <span className="text-xs opacity-50 ml-1">CANCEL</span>
                </button>
                <button
                  onClick={handleNLCreate}
                  disabled={isGenerating || !nlInput.trim()}
                  className="px-4 py-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-xl hover:from-purple-600 hover:to-pink-600 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isGenerating ? (
                    <span>AI 思考中... / THINKING...</span>
                  ) : (
                    <span>生成 / GENERATE</span>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {showDocumentModal && currentAgentId && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-gray-900 rounded-2xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto border border-white/10">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold text-white">
                  <span>文档管理</span>
                  <span className="text-sm opacity-50 ml-1">DOCUMENT MANAGEMENT</span>
                </h2>
                <button
                  onClick={() => setShowDocumentModal(false)}
                  className="px-3 py-1 text-gray-400 hover:bg-white/10 rounded"
                >
                  ×
                </button>
              </div>
              
              <form onSubmit={handleAddDocument} className="space-y-4 mb-6">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">
                      <span>标题</span>
                      <span className="opacity-50 ml-1">TITLE</span>
                    </label>
                    <input
                      type="text"
                      value={documentFormData.title}
                      onChange={(e) => setDocumentFormData({ ...documentFormData, title: e.target.value })}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-emerald-500/50"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">
                      <span>类型</span>
                      <span className="opacity-50 ml-1">TYPE</span>
                    </label>
                    <select
                      value={documentFormData.type}
                      onChange={(e) => setDocumentFormData({ ...documentFormData, type: e.target.value })}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-emerald-500/50"
                    >
                      {documentTypes.map(type => (
                        <option key={type.cn} value={type.cn} className="bg-gray-900">{type.cn} / {type.en}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">
                    <span>内容</span>
                    <span className="opacity-50 ml-1">CONTENT</span>
                  </label>
                  <textarea
                    value={documentFormData.content}
                    onChange={(e) => setDocumentFormData({ ...documentFormData, content: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-emerald-500/50"
                    rows={4}
                    required
                  />
                </div>
                <button
                  type="submit"
                  className="px-4 py-2 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600"
                >
                  <span>添加文档</span>
                  <span className="text-xs opacity-70 ml-1">ADD DOCUMENT</span>
                </button>
              </form>
              
              <div className="space-y-3">
                <h3 className="font-semibold text-gray-300">
                  <span>现有文档</span>
                  <span className="opacity-50 ml-1">/ EXISTING DOCUMENTS</span>
                </h3>
                {documents.length === 0 ? (
                  <p className="text-gray-500 text-center py-4">
                    <span>暂无文档</span>
                    <span className="opacity-50 ml-1">/ NO DOCUMENTS YET</span>
                  </p>
                ) : (
                  documents.map(doc => (
                    <div key={doc.id} className="p-3 bg-white/5 rounded-xl flex justify-between items-start border border-white/10">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 rounded text-xs ${getDocTypeColor(doc.type)}`}>
                            {doc.type}
                          </span>
                          <span className="font-medium text-white">{doc.title}</span>
                        </div>
                        <p className="text-sm text-gray-400 mt-1 line-clamp-2">{doc.content}</p>
                      </div>
                      <button
                        onClick={() => handleDeleteDocument(doc.id)}
                        className="text-red-400 hover:text-red-300 text-sm"
                      >
                        <span>删除</span>
                        <span className="text-xs opacity-50 ml-1">DEL</span>
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
