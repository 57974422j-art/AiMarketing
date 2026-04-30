'use client';
import { useState, useEffect } from 'react';

interface KnowledgeBase {
  content: string;
  updatedAt: string;
}

export default function SettingsPage() {
  const [knowledgeBase, setKnowledgeBase] = useState<KnowledgeBase>({
    content: '',
    updatedAt: '',
  });
  const [saveMessage, setSaveMessage] = useState('');

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const response = await fetch('/api/config', { credentials: 'include' });
      const result = await response.json();
      if (result.success && result.data) {
        setKnowledgeBase(result.data.knowledgeBase || { content: '', updatedAt: '' });
      }
    } catch (error) {
      console.error('加载配置失败:', error);
      const savedKnowledge = localStorage.getItem('knowledgeBase');
      setKnowledgeBase(savedKnowledge ? JSON.parse(savedKnowledge) : { content: '', updatedAt: '' });
    }
  };

  const saveAllSettings = async () => {
    try {
      const response = await fetch('/api/config', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          providers: [],
          defaultProvider: '',
          knowledgeBase
        }),
      });
      const result = await response.json();
      if (result.success) {
        setSaveMessage(result.message);
        localStorage.setItem('knowledgeBase', JSON.stringify(knowledgeBase));
        await loadSettings();
      } else {
        setSaveMessage('保存失败: ' + result.message);
      }
    } catch (error) {
      console.error('保存配置失败:', error);
      setSaveMessage('保存失败，请检查网络连接');
    }
    setTimeout(() => setSaveMessage(''), 3000);
  };

  const saveKnowledgeBase = () => {
    const updatedKnowledge: KnowledgeBase = {
      content: knowledgeBase.content,
      updatedAt: new Date().toISOString(),
    };
    setKnowledgeBase(updatedKnowledge);
    saveAllSettings();
  };

  const formatDate = (dateStr: string): string => {
    if (!dateStr) return '从未更新';
    const date = new Date(dateStr);
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <p className="text-label mb-2">系统 / SYSTEM</p>
            <h1 className="text-mono-lg text-white">设置 / SETTINGS</h1>
          </div>
          {saveMessage && (
            <div className="px-4 py-2 bg-emerald-500/20 text-emerald-400 rounded-xl text-sm font-mono">
              {saveMessage}
            </div>
          )}
        </div>

        <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10">
          <div className="p-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-medium text-white font-mono">知识库 / KNOWLEDGE BASE</h3>
                <span className="text-sm text-gray-500 font-mono">
                  最后更新: {formatDate(knowledgeBase.updatedAt)}
                </span>
              </div>
              <div>
                <textarea
                  value={knowledgeBase.content}
                  onChange={(e) => setKnowledgeBase({ ...knowledgeBase, content: e.target.value })}
                  placeholder="企业话术、产品介绍、FAQ..."
                  className="w-full h-64 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500/50 resize-none font-mono"
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500 font-mono">
                  {knowledgeBase.content.length} 字符
                </span>
                <button
                  onClick={saveKnowledgeBase}
                  className="px-4 py-2 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 transition-colors font-mono"
                >
                  保存知识库
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}