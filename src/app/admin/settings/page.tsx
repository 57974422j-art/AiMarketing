'use client';
import { useState, useEffect } from 'react';
interface AIConfig {
 provider: string;
 apiKey: string;
 baseUrl: string;
 model: string;
}
interface KnowledgeBase {
 content: string;
 updatedAt: string;
}
const PROVIDERS = [
 { value: 'openai', label: 'OpenAI' },
 { value: 'deepseek', label: 'DeepSeek' },
 { value: 'tongyi', label: '通义千问' },
 { value: 'zhipu', label: '智谱' },
 { value: 'ollama', label: 'Ollama' },
];
export default function SettingsPage() {
 const [providers, setProviders] = useState<AIConfig[]>([]);
 const [selectedProvider, setSelectedProvider] = useState<string>('');
 const [newProvider, setNewProvider] = useState<AIConfig>({
 provider: 'openai',
 apiKey: '',
 baseUrl: '',
 model: '',
 });
 const [knowledgeBase, setKnowledgeBase] = useState<KnowledgeBase>({
 content: '',
 updatedAt: '',
 });
 const [activeTab, setActiveTab] = useState<'providers' | 'knowledge' | 'global'>('providers');
 const [saveMessage, setSaveMessage] = useState('');
 useEffect(() => {
    loadSettings();
  }, []);
  const loadSettings = async () => {
    try {
      const response = await fetch('/api/config', { credentials: 'include' });
      const result = await response.json();
      if (result.success && result.data) {
        setProviders(result.data.providers || []);
        setSelectedProvider(result.data.defaultProvider || '');
        setKnowledgeBase(result.data.knowledgeBase || { content: '', updatedAt: '' });
      }
    } catch (error) {
      console.error('加载配置失败:', error);
      // 降级到 localStorage
      const savedProviders = localStorage.getItem('aiProviders');
      setProviders(savedProviders ? JSON.parse(savedProviders) : []);
      setSelectedProvider(localStorage.getItem('defaultAIProvider') || '');
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
          providers,
          defaultProvider: selectedProvider,
          knowledgeBase
        }),
      });
      const result = await response.json();
      if (result.success) {
        setSaveMessage(result.message);
        // 同步保存到 localStorage 作为备份
        localStorage.setItem('aiProviders', JSON.stringify(providers));
        localStorage.setItem('defaultAIProvider', selectedProvider);
        localStorage.setItem('knowledgeBase', JSON.stringify(knowledgeBase));
        // 重新加载配置以刷新页面状态
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
 const addProvider = () => {
 if (!newProvider.apiKey.trim()) {
 setSaveMessage('请填写API Key');
 setTimeout(() => setSaveMessage(''), 3000);
 return;
 }
 const config: AIConfig = {
 ...newProvider,
 apiKey: newProvider.apiKey,
 baseUrl: newProvider.baseUrl || getDefaultBaseUrl(newProvider.provider),
 model: newProvider.model || getDefaultModel(newProvider.provider),
 };
 setProviders([...providers, config]);
    setNewProvider({
      provider: 'openai',
      apiKey: '',
      baseUrl: '',
      model: '',
    });
    saveAllSettings();
  };
 const removeProvider = (index: number) => {
 const newProviders = providers.filter((_, i) => i !== index);
 setProviders(newProviders);
    if (selectedProvider === index.toString()) {
      setSelectedProvider(newProviders.length > 0 ? '0' : '');
    }
    saveAllSettings();
  };
 const getDefaultBaseUrl = (provider: string): string => {
 switch (provider) {
 case 'openai':
 return 'https://api.openai.com/v1';
 case 'deepseek':
 return 'https://api.deepseek.com/v1';
 case 'tongyi':
 return 'https://dashscope.aliyuncs.com/api/compatible/v1';
 case 'zhipu':
 return 'https://api.zhipuai.cn/v4';
 case 'ollama':
 return 'http://localhost:11434/v1';
 default:
 return '';
 }
 };
 const getDefaultModel = (provider: string): string => {
 switch (provider) {
 case 'openai':
 return 'gpt-3.5-turbo';
 case 'deepseek':
 return 'deepseek-chat';
 case 'tongyi':
 return 'qwen-turbo';
 case 'zhipu':
 return 'glm-4';
 case 'ollama':
 return 'llama3';
 default:
 return '';
 }
 };
 const maskApiKey = (key: string): string => {
 if (key.length <= 8)
 return key;
 return key.substring(0, 4) + '****' + key.substring(key.length - 4);
 };
 const formatDate = (dateStr: string): string => {
 if (!dateStr)
 return '从未更新';
 const date = new Date(dateStr);
 return date.toLocaleString('zh-CN', {
 year: 'numeric',
 month: '2-digit',
 day: '2-digit',
 hour: '2-digit',
 minute: '2-digit',
 });
 };
 return (<div className="min-h-screen bg-gray-950">
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <p className="text-label mb-2">系统 / SYSTEM</p>
            <h1 className="text-mono-lg text-white">设置 / SETTINGS</h1>
          </div>
          {saveMessage && (<div className="px-4 py-2 bg-emerald-500/20 text-emerald-400 rounded-xl text-sm font-mono">
            {saveMessage}
          </div>)}
        </div>

        <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10">
          <div className="flex border-b border-white/10">
            <button onClick={() => setActiveTab('providers')} className={`flex-1 px-6 py-4 font-medium text-sm transition-colors font-mono ${activeTab === 'providers'
             ? 'text-emerald-400 border-b-2 border-emerald-400 bg-emerald-500/5'
             : 'text-gray-400 hover:text-gray-300 hover:bg-white/5'}`}>
              AI API CONFIG
            </button>
            <button onClick={() => setActiveTab('knowledge')} className={`flex-1 px-6 py-4 font-medium text-sm transition-colors font-mono ${activeTab === 'knowledge'
             ? 'text-emerald-400 border-b-2 border-emerald-400 bg-emerald-500/5'
             : 'text-gray-400 hover:text-gray-300 hover:bg-white/5'}`}>
              KNOWLEDGE BASE
            </button>
            <button onClick={() => setActiveTab('global')} className={`flex-1 px-6 py-4 font-medium text-sm transition-colors font-mono ${activeTab === 'global'
             ? 'text-emerald-400 border-b-2 border-emerald-400 bg-emerald-500/5'
             : 'text-gray-400 hover:text-gray-300 hover:bg-white/5'}`}>
              GLOBAL MODEL
            </button>
          </div>

 <div className="p-6">
 {activeTab === 'providers' && (<div className="space-y-6">
 <div className="bg-white/5 rounded-xl p-4">
 <h3 className="font-medium text-white mb-4 font-mono">ADD NEW API CONFIG</h3>
 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
 <div>
 <label className="block text-xs text-gray-400 mb-1 font-mono">
 PROVIDER
 </label>
 <select value={newProvider.provider} onChange={(e) => setNewProvider({ ...newProvider, provider: e.target.value, baseUrl: '', model: '' })} className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-emerald-500/50 font-mono">
 {PROVIDERS.map((p) => (<option key={p.value} value={p.value} className="bg-gray-900">
 {p.label}
 </option>))}
 </select>
 </div>
 <div>
 <label className="block text-xs text-gray-400 mb-1 font-mono">
 API KEY
 </label>
 <input type="password" value={newProvider.apiKey} onChange={(e) => setNewProvider({ ...newProvider, apiKey: e.target.value })} placeholder="sk-xxx..." className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500/50 font-mono"/>
 </div>
 <div>
 <label className="block text-xs text-gray-400 mb-1 font-mono">
 BASE URL
 </label>
 <input type="text" value={newProvider.baseUrl} onChange={(e) => setNewProvider({ ...newProvider, baseUrl: e.target.value })} placeholder={getDefaultBaseUrl(newProvider.provider)} className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500/50 font-mono"/>
 </div>
 <div>
 <label className="block text-xs text-gray-400 mb-1 font-mono">
 MODEL NAME
 </label>
 <input type="text" value={newProvider.model} onChange={(e) => setNewProvider({ ...newProvider, model: e.target.value })} placeholder={getDefaultModel(newProvider.provider)} className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500/50 font-mono"/>
 </div>
 </div>
 <button onClick={addProvider} className="mt-4 px-4 py-2 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 transition-colors font-mono">
 ADD CONFIG
 </button>
 </div>

 <div>
 <h3 className="font-medium text-white mb-4 font-mono">CONFIGURED APIS ({providers.length})</h3>
 {providers.length === 0 ? (<div className="text-center py-8 text-gray-500 font-mono">
 <p>NO API CONFIG, PLEASE ADD</p>
 </div>) : (<div className="space-y-3">
 {providers.map((config, index) => (<div key={index} className="bg-white/5 rounded-xl p-4 flex items-center justify-between border border-white/10">
 <div className="flex-1">
 <div className="flex items-center gap-3">
 <span className="px-2 py-1 bg-emerald-500/20 text-emerald-400 rounded text-sm font-mono">
 {PROVIDERS.find((p) => p.value === config.provider)?.label || config.provider}
 </span>
 <span className="text-sm text-gray-400 font-mono">
 {config.model}
 </span>
 </div>
 <div className="mt-2 text-sm text-gray-500 font-mono">
 <span className="mr-4">KEY: {maskApiKey(config.apiKey)}</span>
 <span>{config.baseUrl}</span>
 </div>
 </div>
 <button onClick={() => removeProvider(index)} className="px-3 py-1 text-red-400 hover:bg-red-500/20 rounded-lg transition-colors font-mono">
 DEL
 </button>
 </div>))}
 </div>)}
 </div>
 </div>)}

 {activeTab === 'knowledge' && (<div className="space-y-4">
 <div className="flex items-center justify-between">
 <h3 className="font-medium text-gray-900">企业知识库</h3>
 <span className="text-sm text-gray-500">
 最后更新: {formatDate(knowledgeBase.updatedAt)}
 </span>
 </div>
 <div>
 <textarea value={knowledgeBase.content} onChange={(e) => setKnowledgeBase({ ...knowledgeBase, content: e.target.value })} placeholder="ENTERPRISE SCRIPTS, PRODUCT INFO, FAQ..." className="w-full h-64 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500/50 resize-none font-mono"/>
 </div>
 <div className="flex items-center justify-between">
 <span className="text-sm text-gray-500 font-mono">
 {knowledgeBase.content.length} CHARS
 </span>
 <button onClick={saveKnowledgeBase} className="px-4 py-2 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 transition-colors font-mono">
 SAVE KNOWLEDGE BASE
 </button>
 </div>
 </div>)}

 {activeTab === 'global' && (<div className="space-y-4">
 <h3 className="font-medium text-white font-mono">DEFAULT AI MODEL</h3>
 {providers.length === 0 ? (<div className="text-center py-8 text-gray-500 font-mono">
 <p>PLEASE ADD AT LEAST ONE API CONFIG</p>
 </div>) : (<>
 <div className="max-w-md">
 <label className="block text-sm text-gray-400 mb-2 font-mono">
 SELECT DEFAULT MODEL
 </label>
 <select value={selectedProvider} onChange={(e) => setSelectedProvider(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-emerald-500/50 font-mono">
 {providers.map((config, index) => (<option key={index} value={index.toString()} className="bg-gray-900">
 {PROVIDERS.find((p) => p.value === config.provider)?.label || config.provider} - {config.model}
 </option>))}
 </select>
 </div>
 <button onClick={saveAllSettings} className="px-4 py-2 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 transition-colors font-mono">
 SET AS DEFAULT
 </button>

 <div className="mt-6 p-4 bg-emerald-500/10 rounded-xl border border-emerald-500/20">
 <h4 className="font-medium text-emerald-400 mb-2 font-mono">CURRENT CONFIG STATUS</h4>
 {selectedProvider !== '' ? (<div className="text-sm text-gray-300 space-y-1 font-mono">
 <p>DEFAULT PROVIDER: {PROVIDERS.find((p) => p.value === providers[parseInt(selectedProvider)]?.provider)?.label}</p>
 <p>DEFAULT MODEL: {providers[parseInt(selectedProvider)]?.model}</p>
 <p>KNOWLEDGE BASE: {knowledgeBase.content.length > 0 ? 'CONFIGURED' : 'NOT CONFIGURED'}</p>
 </div>) : (<p className="text-sm text-gray-500 font-mono">NO DEFAULT MODEL SET</p>)}
 </div>
 </>)}
 </div>)}
 </div>
 </div>
 </div>
 </div>);
}