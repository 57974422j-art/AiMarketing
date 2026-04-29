'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';

interface Message {
  id: number;
  type: 'user' | 'agent';
  content: string;
  timestamp: Date;
}

interface AIAgent {
  id: number;
  name: string;
  welcomeMessage: string;
  replyStyle: string;
}

interface Document {
  id: number;
  title: string;
  content: string;
  type: string;
}

const mockReplies: Record<string, string[]> = {
  '专业': [
    '感谢您的咨询，我们将为您提供专业的服务支持。',
    '根据您的需求，建议您采取以下步骤：首先...其次...最后...',
    '关于这个问题，我需要向您说明几点关键信息：',
    '我们的服务流程是标准化的，确保每位客户都能获得一致的体验。',
    '请放心，我们有专业的团队负责处理这类情况。',
    '根据我们的数据分析，这个方案能够有效提升转化率。',
    '从行业最佳实践来看，建议您优先考虑这个方案。',
    '我们提供7x24小时的技术支持，随时为您服务。'
  ],
  '亲切': [
    '嗨~ 很高兴为您服务！有什么我能帮到您的吗？😊',
    '别担心，有什么问题都可以跟我说，我会尽力帮您解决的！',
    '好的呢，我来帮您看看这个问题~',
    '亲，感谢您的耐心等待，让我来为您解答！',
    '嗯嗯，我明白您的需求了，这就为您处理~',
    '有任何疑问随时找我哦，我一直都在的！',
    '太好了，能帮到您我也很开心！',
    '祝您今天心情愉快，有需要随时联系我~'
  ],
  '幽默': [
    '您好您好！欢迎来到我的服务频道~ 有啥尽管问！',
    '别急别急，我这就来救场！问题交给我，您放心~',
    '哇，这个问题问得好！让我来给您好好讲讲~',
    '哈哈哈，您太有趣了！不过问题我可是认真的~',
    '来来来，让我这个"智慧担当"来分析分析~',
    '放心，我可是经过专业训练的（其实是自学成才）😎',
    '没问题，包在我身上！我可是"问题杀手"~',
    '搞定！下次有问题记得还找我哦~'
  ]
};

const getRandomReply = (style: string): string => {
  const replies = mockReplies[style] || mockReplies['亲切'];
  return replies[Math.floor(Math.random() * replies.length)];
};

const mockAgents: AIAgent[] = [
  { id: 1, name: '智能客服小美', welcomeMessage: '您好！我是智能客服小美，很高兴为您服务！有什么问题都可以问我哦~', replyStyle: '亲切' },
  { id: 2, name: '专业顾问小王', welcomeMessage: '您好，我是您的专属顾问小王，请问有什么可以帮助您的？', replyStyle: '专业' },
  { id: 3, name: '欢乐助手阿乐', welcomeMessage: '哈喽！我是欢乐助手阿乐，有什么好玩的问题尽管抛过来！', replyStyle: '幽默' }
];

const documentTypes = ['话术', '产品资料', 'FAQ'];

export default function ChatPage({ params }: { params: { id: string } }) {
  const [agent, setAgent] = useState<AIAgent | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showKnowledgePanel, setShowKnowledgePanel] = useState(false);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [documentFormData, setDocumentFormData] = useState({
    title: '',
    content: '',
    type: '话术'
  });
  const [isSubmittingDoc, setIsSubmittingDoc] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchAgent();
    fetchDocuments();
  }, [params.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const fetchAgent = async () => {
    try {
      const response = await fetch(`/api/ai-agent/${params.id}`);
      const data = await response.json();
      if (data.success && data.data) {
        setAgent(data.data);
        setMessages([{
          id: 1,
          type: 'agent',
          content: data.data.welcomeMessage,
          timestamp: new Date()
        }]);
        return;
      }
    } catch (error) {
      console.warn('API调用失败，使用模拟数据:', error);
    }
    
    const mockAgent = mockAgents.find(a => a.id === parseInt(params.id)) || mockAgents[0];
    setAgent(mockAgent);
    setMessages([{
      id: 1,
      type: 'agent',
      content: mockAgent.welcomeMessage,
      timestamp: new Date()
    }]);
  };

  const fetchDocuments = async () => {
    try {
      const response = await fetch(`/api/ai-agent/${params.id}/documents`);
      const data = await response.json();
      if (data.success) {
        setDocuments(data.data);
      }
    } catch (error) {
      console.warn('获取文档失败:', error);
    }
  };

  const handleSend = async () => {
    if (!inputValue.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now(),
      type: 'user',
      content: inputValue.trim(),
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);

    let replyContent = '';
    
    try {
      const response = await fetch(`/api/ai-agent/${params.id}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMessage.content })
      });
      
      const data = await response.json();
      if (data.success && data.data?.reply) {
        replyContent = data.data.reply;
      } else {
        throw new Error('API返回数据无效');
      }
    } catch (error) {
      console.warn('API调用失败，使用模拟回复:', error);
      replyContent = getRandomReply(agent?.replyStyle || '亲切');
    }

    const agentMessage: Message = {
      id: Date.now() + 1,
      type: 'agent',
      content: replyContent,
      timestamp: new Date()
    };
    setMessages(prev => [...prev, agentMessage]);
    setIsLoading(false);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleAddDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmittingDoc(true);

    try {
      const response = await fetch(`/api/ai-agent/${params.id}/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(documentFormData)
      });

      const data = await response.json();
      if (data.success) {
        fetchDocuments();
        setDocumentFormData({ title: '', content: '', type: '话术' });
        alert('文档添加成功！');
      } else {
        alert(data.message || '添加失败');
      }
    } catch (error) {
      alert('添加失败，请稍后重试');
    } finally {
      setIsSubmittingDoc(false);
    }
  };

  const handleDeleteDocument = async (documentId: number) => {
    if (!confirm('确定要删除这个文档吗？')) return;

    try {
      await fetch(`/api/ai-agent/${params.id}/documents/${documentId}`, {
        method: 'DELETE'
      });
      fetchDocuments();
    } catch (error) {
      alert('删除失败');
    }
  };

  if (!agent) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="flex items-center gap-4 mb-4">
          <Link href="/ai-agent" className="text-primary hover:underline">
            ← 返回列表
          </Link>
        </div>
        <div className="text-center py-12">
          <p className="text-gray-500">加载中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          <Link href="/ai-agent" className="text-primary hover:underline">
            ← 返回列表
          </Link>
          <h1 className="text-xl font-bold text-gray-900">{agent.name}</h1>
          <span className={`inline-block px-2 py-0.5 rounded-full text-xs ${
            agent.replyStyle === '专业' ? 'bg-blue-100 text-blue-800' :
            agent.replyStyle === '亲切' ? 'bg-green-100 text-green-800' :
            'bg-yellow-100 text-yellow-800'
          }`}>
            {agent.replyStyle}风格
          </span>
        </div>
        <button
          onClick={() => setShowKnowledgePanel(!showKnowledgePanel)}
          className={`px-4 py-2 rounded-md transition-colors ${
            showKnowledgePanel 
              ? 'bg-primary text-white' 
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          {showKnowledgePanel ? '隐藏知识库' : `知识库(${documents.length})`}
        </button>
      </div>

      <div className="flex gap-6">
        <div className={`flex-1 transition-all duration-300 ${showKnowledgePanel ? 'max-w-md' : 'max-w-none'}`}>
          <div className="bg-white rounded-lg shadow-md h-[500px] flex flex-col">
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.map(message => (
                <div key={message.id} className={`flex ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[70%] ${
                    message.type === 'user' 
                      ? 'bg-primary text-white rounded-2xl rounded-tr-sm' 
                      : 'bg-gray-100 text-gray-900 rounded-2xl rounded-tl-sm'
                  } p-3`}>
                    <p className="text-sm">{message.content}</p>
                    <span className={`text-xs mt-1 block ${
                      message.type === 'user' ? 'text-blue-200' : 'text-gray-400'
                    }`}>
                      {message.timestamp.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="flex justify-start">
                  <div className="bg-gray-100 rounded-2xl rounded-tl-sm p-3">
                    <div className="flex space-x-1">
                      <span className="animate-bounce w-2 h-2 bg-gray-400 rounded-full"></span>
                      <span className="animate-bounce w-2 h-2 bg-gray-400 rounded-full" style={{ animationDelay: '0.1s' }}></span>
                      <span className="animate-bounce w-2 h-2 bg-gray-400 rounded-full" style={{ animationDelay: '0.2s' }}></span>
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            <div className="p-4 border-t">
              <div className="flex gap-2">
                <textarea
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="输入消息..."
                  className="flex-1 border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                  rows={2}
                  disabled={isLoading}
                />
                <button
                  onClick={handleSend}
                  disabled={isLoading || !inputValue.trim()}
                  className="px-6 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark disabled:bg-gray-300 disabled:cursor-not-allowed"
                >
                  {isLoading ? '发送中...' : '发送'}
                </button>
              </div>
            </div>
          </div>
        </div>

        {showKnowledgePanel && (
          <div className="w-80 bg-white rounded-lg shadow-md p-4">
            <h3 className="font-semibold text-gray-900 mb-4">知识库管理</h3>
            
            <form onSubmit={handleAddDocument} className="space-y-3 mb-4">
              <input
                type="text"
                value={documentFormData.title}
                onChange={(e) => setDocumentFormData({ ...documentFormData, title: e.target.value })}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="文档标题"
                required
              />
              <select
                value={documentFormData.type}
                onChange={(e) => setDocumentFormData({ ...documentFormData, type: e.target.value })}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {documentTypes.map(type => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
              <textarea
                value={documentFormData.content}
                onChange={(e) => setDocumentFormData({ ...documentFormData, content: e.target.value })}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                rows={3}
                placeholder="粘贴文本内容（产品话术、FAQ、品牌资料等）"
                required
              />
              <button
                type="submit"
                disabled={isSubmittingDoc}
                className="w-full px-3 py-2 bg-primary text-white rounded-md text-sm hover:bg-primary-dark disabled:bg-gray-400"
              >
                {isSubmittingDoc ? '保存中...' : '添加文档'}
              </button>
            </form>

            <div className="border-t pt-4">
              <h4 className="text-sm font-medium text-gray-700 mb-2">已添加文档 ({documents.length})</h4>
              {documents.length === 0 ? (
                <p className="text-gray-500 text-sm text-center py-4">暂无文档</p>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {documents.map(doc => (
                    <div key={doc.id} className="p-2 bg-gray-50 rounded-md">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className={`px-1.5 py-0.5 rounded text-xs ${
                            doc.type === '话术' ? 'bg-purple-100 text-purple-800' :
                            doc.type === '产品资料' ? 'bg-indigo-100 text-indigo-800' :
                            'bg-pink-100 text-pink-800'
                          }`}>
                            {doc.type}
                          </span>
                          <span className="text-sm font-medium">{doc.title}</span>
                        </div>
                        <button
                          onClick={() => handleDeleteDocument(doc.id)}
                          className="text-red-500 hover:text-red-700 text-xs"
                        >
                          删除
                        </button>
                      </div>
                      <p className="text-xs text-gray-500 mt-1 line-clamp-2">{doc.content}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}