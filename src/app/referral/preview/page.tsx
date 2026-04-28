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
}

interface TriggerLog {
  id: number;
  platform: string;
  triggerType: string;
  keyword: string;
  message: string;
  matched: boolean;
  timestamp: Date;
}

export default function ReferralPreviewPage() {
  const [referrals, setReferrals] = useState<ReferralConfig[]>([]);
  const [selectedConfig, setSelectedConfig] = useState<ReferralConfig | null>(null);
  const [inputMessage, setInputMessage] = useState('');
  const [triggerLogs, setTriggerLogs] = useState<TriggerLog[]>([]);
  const [showQRCode, setShowQRCode] = useState(false);

  useEffect(() => {
    fetch('/api/referral')
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setReferrals(data.data);
          const activeConfig = data.data.find((r: ReferralConfig) => r.status === 'active');
          if (activeConfig) {
            setSelectedConfig(activeConfig);
          }
        }
      });
  }, []);

  const handleTrigger = () => {
    if (!selectedConfig || !inputMessage.trim()) return;

    const matched = !selectedConfig.keyword || 
      inputMessage.includes(selectedConfig.keyword);

    const log: TriggerLog = {
      id: Date.now(),
      platform: selectedConfig.platform,
      triggerType: selectedConfig.triggerType,
      keyword: selectedConfig.keyword || '(无)',
      message: matched ? selectedConfig.responseMessage : '未匹配到触发条件',
      matched,
      timestamp: new Date()
    };

    setTriggerLogs(prev => [log, ...prev].slice(0, 10));
    setInputMessage('');
    
    if (matched) {
      setShowQRCode(true);
      setTimeout(() => setShowQRCode(false), 5000);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex items-center gap-4 mb-6">
        <Link href="/referral" className="text-primary hover:underline">
          ← 返回管理
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">导流触发模拟测试</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">选择导流配置</h2>
          <div className="space-y-3">
            {referrals.map(config => (
              <button
                key={config.id}
                onClick={() => setSelectedConfig(config)}
                className={`w-full text-left p-4 rounded-lg border-2 transition-colors ${
                  selectedConfig?.id === config.id
                    ? 'border-primary bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="flex justify-between items-center">
                  <span className="font-medium">{config.name}</span>
                  <span className={`text-xs px-2 py-1 rounded-full ${
                    config.status === 'active' 
                      ? 'bg-green-100 text-green-800' 
                      : 'bg-gray-100 text-gray-600'
                  }`}>
                    {config.status === 'active' ? '运行中' : '已暂停'}
                  </span>
                </div>
                <div className="text-sm text-gray-500 mt-1">
                  {config.platform} · {config.triggerType}
                </div>
                {config.keyword && (
                  <div className="text-xs text-gray-400 mt-1">
                    关键词: {config.keyword}
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">模拟用户输入</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  用户消息（模拟评论/私信内容）
                </label>
                <textarea
                  value={inputMessage}
                  onChange={(e) => setInputMessage(e.target.value)}
                  placeholder="输入测试消息，如：福利、加群、666 等"
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
                  rows={4}
                />
              </div>
              <button
                onClick={handleTrigger}
                disabled={!selectedConfig || !inputMessage.trim()}
                className="w-full px-4 py-2 bg-primary text-white rounded-md hover:bg-primary-dark disabled:bg-gray-300 disabled:cursor-not-allowed"
              >
                模拟触发
              </button>
            </div>
          </div>

          {showQRCode && selectedConfig && (
            <div className="bg-white rounded-lg shadow-md p-6 text-center">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">自动回复内容</h3>
              <p className="text-gray-600 mb-4">{selectedConfig.responseMessage}</p>
              <div className="flex justify-center">
                <div className="w-40 h-40 bg-gray-100 rounded-lg flex items-center justify-center">
                  <img 
                    src={selectedConfig.qrcodeUrl} 
                    alt="二维码" 
                    className="w-full h-full object-contain rounded-lg"
                  />
                </div>
              </div>
              <p className="text-sm text-gray-500 mt-2">扫码加入社群</p>
            </div>
          )}
        </div>
      </div>

      <div className="mt-6 bg-white rounded-lg shadow-md p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">触发日志</h2>
        {triggerLogs.length === 0 ? (
          <p className="text-gray-500 text-center py-8">暂无触发记录</p>
        ) : (
          <div className="space-y-3">
            {triggerLogs.map(log => (
              <div key={log.id} className={`p-4 rounded-lg ${
                log.matched ? 'bg-green-50 border border-green-200' : 'bg-gray-50 border border-gray-200'
              }`}>
                <div className="flex justify-between items-start">
                  <div>
                    <span className="text-sm font-medium text-gray-900">
                      {log.platform} · {log.triggerType}
                    </span>
                    <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${
                      log.matched 
                        ? 'bg-green-100 text-green-800' 
                        : 'bg-red-100 text-red-800'
                    }`}>
                      {log.matched ? '已匹配' : '未匹配'}
                    </span>
                  </div>
                  <span className="text-xs text-gray-400">
                    {log.timestamp.toLocaleString('zh-CN')}
                  </span>
                </div>
                {log.keyword && (
                  <div className="text-xs text-gray-500 mt-1">
                    检测关键词: {log.keyword}
                  </div>
                )}
                <div className="text-sm text-gray-700 mt-2">
                  {log.message}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}