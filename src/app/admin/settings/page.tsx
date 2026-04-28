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
 const loadSettings = () => {
 const savedProviders = localStorage.getItem('aiProviders');
 if (savedProviders) {
 setProviders(JSON.parse(savedProviders));
 }
 else {
 setProviders([]);
 }
 const savedDefaultProvider = localStorage.getItem('defaultAIProvider');
 if (savedDefaultProvider) {
 setSelectedProvider(savedDefaultProvider);
 }
 const savedKnowledge = localStorage.getItem('knowledgeBase');
 if (savedKnowledge) {
 setKnowledgeBase(JSON.parse(savedKnowledge));
 }
 else {
 setKnowledgeBase({
 content: '',
 updatedAt: '',
 });
 }
 };
 const saveProviders = () => {
 localStorage.setItem('aiProviders', JSON.stringify(providers));
 setSaveMessage('API配置已保存');
 setTimeout(() => setSaveMessage(''), 3000);
 };
 const saveDefaultProvider = () => {
 localStorage.setItem('defaultAIProvider', selectedProvider);
 setSaveMessage('默认模型已设置');
 setTimeout(() => setSaveMessage(''), 3000);
 };
 const saveKnowledgeBase = () => {
 const updatedKnowledge: KnowledgeBase = {
 content: knowledgeBase.content,
 updatedAt: new Date().toISOString(),
 };
 setKnowledgeBase(updatedKnowledge);
 localStorage.setItem('knowledgeBase', JSON.stringify(updatedKnowledge));
 setSaveMessage('知识库已保存');
 setTimeout(() => setSaveMessage(''), 3000);
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
 saveProviders();
 };
 const removeProvider = (index: number) => {
 const newProviders = providers.filter((_, i) => i !== index);
 setProviders(newProviders);
 if (selectedProvider === index.toString()) {
 setSelectedProvider(newProviders.length > 0 ? '0' : '');
 }
 saveProviders();
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
 return (<div className="min-h-screen bg-gray-50">
 <div className="max-w-6xl mx-auto px-4 py-8">
 <div className="flex items-center justify-between mb-8">
 <div>
 <h1 className="text-2xl font-bold text-gray-900">系统设置</h1>
 <p className="text-gray-600 mt-1">配置AI API和知识库</p>
 </div>
 {saveMessage && (<div className="px-4 py-2 bg-green-100 text-green-700 rounded-md text-sm">
 {saveMessage}
 </div>)}
 </div>

 <div className="bg-white rounded-lg shadow-sm border border-gray-200">
 <div className="flex border-b border-gray-200">
 <button onClick={() => setActiveTab('providers')} className={`flex-1 px-6 py-4 font-medium text-sm transition-colors ${activeTab === 'providers'
 ? 'text-primary border-b-2 border-primary bg-blue-50'
 : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}>
 AI API配置
 </button>
 <button onClick={() => setActiveTab('knowledge')} className={`flex-1 px-6 py-4 font-medium text-sm transition-colors ${activeTab === 'knowledge'
 ? 'text-primary border-b-2 border-primary bg-blue-50'
 : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}>
 知识库管理
 </button>
 <button onClick={() => setActiveTab('global')} className={`flex-1 px-6 py-4 font-medium text-sm transition-colors ${activeTab === 'global'
 ? 'text-primary border-b-2 border-primary bg-blue-50'
 : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}>
 全局模型选择
 </button>
 </div>

 <div className="p-6">
 {activeTab === 'providers' && (<div className="space-y-6">
 <div className="bg-gray-50 rounded-lg p-4">
 <h3 className="font-medium text-gray-900 mb-4">添加新的API配置</h3>
 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
 <div>
 <label className="block text-sm font-medium text-gray-700 mb-1">
 提供商
 </label>
 <select value={newProvider.provider} onChange={(e) => setNewProvider({ ...newProvider, provider: e.target.value, baseUrl: '', model: '' })} className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary">
 {PROVIDERS.map((p) => (<option key={p.value} value={p.value}>
 {p.label}
 </option>))}
 </select>
 </div>
 <div>
 <label className="block text-sm font-medium text-gray-700 mb-1">
 API Key
 </label>
 <input type="password" value={newProvider.apiKey} onChange={(e) => setNewProvider({ ...newProvider, apiKey: e.target.value })} placeholder="sk-xxx..." className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"/>
 </div>
 <div>
 <label className="block text-sm font-medium text-gray-700 mb-1">
 Base URL
 </label>
 <input type="text" value={newProvider.baseUrl} onChange={(e) => setNewProvider({ ...newProvider, baseUrl: e.target.value })} placeholder={getDefaultBaseUrl(newProvider.provider)} className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"/>
 </div>
 <div>
 <label className="block text-sm font-medium text-gray-700 mb-1">
 模型名称
 </label>
 <input type="text" value={newProvider.model} onChange={(e) => setNewProvider({ ...newProvider, model: e.target.value })} placeholder={getDefaultModel(newProvider.provider)} className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"/>
 </div>
 </div>
 <button onClick={addProvider} className="mt-4 px-4 py-2 bg-primary text-white rounded-md hover:bg-primary-dark transition-colors">
 添加配置
 </button>
 </div>

 <div>
 <h3 className="font-medium text-gray-900 mb-4">已配置的API ({providers.length})</h3>
 {providers.length === 0 ? (<div className="text-center py-8 text-gray-500">
 <p>暂无API配置，请添加</p>
 </div>) : (<div className="space-y-3">
 {providers.map((config, index) => (<div key={index} className="border border-gray-200 rounded-lg p-4 flex items-center justify-between">
 <div className="flex-1">
 <div className="flex items-center gap-3">
 <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-sm">
 {PROVIDERS.find((p) => p.value === config.provider)?.label || config.provider}
 </span>
 <span className="text-sm text-gray-500">
 {config.model}
 </span>
 </div>
 <div className="mt-2 text-sm text-gray-600">
 <span className="mr-4">Key: {maskApiKey(config.apiKey)}</span>
 <span>{config.baseUrl}</span>
 </div>
 </div>
 <button onClick={() => removeProvider(index)} className="px-3 py-1 text-red-600 hover:bg-red-50 rounded-md transition-colors">
 删除
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
 <textarea value={knowledgeBase.content} onChange={(e) => setKnowledgeBase({ ...knowledgeBase, content: e.target.value })} placeholder="请输入企业话术、产品资料、常见问题等内容...&#10;&#10;示例：&#10;【产品介绍】&#10;我们的产品是一款智能营销工具，帮助企业提升获客效率。&#10;&#10;【常见问题】&#10;Q: 如何收费？&#10;A: 我们提供免费试用，正式版按月订阅。&#10;&#10;【话术模板】&#10;您好，感谢您的咨询！我们的产品具有以下特点：..." className="w-full h-64 border border-gray-300 rounded-md px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary resize-none"/>
 </div>
 <div className="flex items-center justify-between">
 <span className="text-sm text-gray-500">
 {knowledgeBase.content.length} 字符
 </span>
 <button onClick={saveKnowledgeBase} className="px-4 py-2 bg-primary text-white rounded-md hover:bg-primary-dark transition-colors">
 保存知识库
 </button>
 </div>
 </div>)}

 {activeTab === 'global' && (<div className="space-y-4">
 <h3 className="font-medium text-gray-900">默认AI模型</h3>
 {providers.length === 0 ? (<div className="text-center py-8 text-gray-500">
 <p>请先在「AI API配置」中添加至少一个API配置</p>
 </div>) : (<>
 <div className="max-w-md">
 <label className="block text-sm font-medium text-gray-700 mb-2">
 选择默认使用的AI模型
 </label>
 <select value={selectedProvider} onChange={(e) => setSelectedProvider(e.target.value)} className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary">
 {providers.map((config, index) => (<option key={index} value={index.toString()}>
 {PROVIDERS.find((p) => p.value === config.provider)?.label || config.provider} - {config.model}
 </option>))}
 </select>
 </div>
 <button onClick={saveDefaultProvider} className="px-4 py-2 bg-primary text-white rounded-md hover:bg-primary-dark transition-colors">
 设置为默认模型
 </button>
 
 <div className="mt-6 p-4 bg-blue-50 rounded-lg">
 <h4 className="font-medium text-blue-900 mb-2">当前配置状态</h4>
 {selectedProvider !== '' ? (<div className="text-sm text-blue-700 space-y-1">
 <p>默认提供商: {PROVIDERS.find((p) => p.value === providers[parseInt(selectedProvider)]?.provider)?.label}</p>
 <p>默认模型: {providers[parseInt(selectedProvider)]?.model}</p>
 <p>知识库状态: {knowledgeBase.content.length > 0 ? '已配置' : '未配置'}</p>
 </div>) : (<p className="text-sm text-blue-700">未设置默认模型</p>)}
 </div>
 </>)}
 </div>)}
 </div>
 </div>
 </div>
 </div>);
}