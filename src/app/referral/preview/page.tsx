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
    fetch('/api/referral', { credentials: 'include' })
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
    <div className="min-h-screen bg-gray-950">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center gap-4 mb-8">
          <Link href="/referral" className="text-emerald-400 hover:text-emerald-300 font-mono">
            ← BACK
          </Link>
          <div>
            <p className="text-label mb-1">SIMULATION</p>
            <h1 className="text-mono-lg text-white">导流触发测试 / REFERRAL TRIGGER TEST</h1>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-6">
            <h2 className="text-label mb-4">SELECT CONFIG</h2>
            <div className="space-y-3">
              {referrals.map(config => (
                <button
                  key={config.id}
                  onClick={() => setSelectedConfig(config)}
                  className={`w-full text-left p-4 rounded-xl border transition-all ${
                    selectedConfig?.id === config.id
                      ? 'border-emerald-500/50 bg-emerald-500/10'
                      : 'border-white/10 bg-white/5 hover:bg-white/10'
                  }`}
                >
                  <div className="flex justify-between items-center">
                    <span className="font-medium text-white font-mono">{config.name}</span>
                    <span className={`text-xs px-2 py-1 rounded-full font-mono ${
                      config.status === 'active'
                        ? 'bg-emerald-500/20 text-emerald-400'
                        : 'bg-gray-500/20 text-gray-400'
                    }`}>
                      {config.status === 'active' ? 'ACTIVE' : 'PAUSED'}
                    </span>
                  </div>
                  <div className="text-sm text-gray-400 mt-1 font-mono">
                    {config.platform} · {config.triggerType}
                  </div>
                  {config.keyword && (
                    <div className="text-xs text-gray-500 mt-1 font-mono">
                      KW: {config.keyword}
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-6">
              <h2 className="text-label mb-4">SIMULATE INPUT</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-gray-400 uppercase tracking-wider font-mono mb-2">
                    USER MESSAGE (TEST)
                  </label>
                  <textarea
                    value={inputMessage}
                    onChange={(e) => setInputMessage(e.target.value)}
                    placeholder="INPUT TEST MESSAGE..."
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500/50 font-mono"
                    rows={4}
                  />
                </div>
                <button
                  onClick={handleTrigger}
                  disabled={!selectedConfig || !inputMessage.trim()}
                  className="w-full px-4 py-3 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 disabled:bg-gray-700 disabled:cursor-not-allowed font-medium transition-colors font-mono"
                >
                  TRIGGER SIMULATION
                </button>
              </div>
            </div>

            {showQRCode && selectedConfig && (
              <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-6 text-center">
                <h3 className="text-label mb-4">AUTO REPLY</h3>
                <p className="text-gray-300 mb-4 font-mono">{selectedConfig.responseMessage}</p>
                <div className="flex justify-center">
                  <div className="w-40 h-40 bg-white/10 rounded-xl flex items-center justify-center p-2">
                    <img
                      src={selectedConfig.qrcodeUrl}
                      alt="QR CODE"
                      className="w-full h-full object-contain rounded-lg"
                    />
                  </div>
                </div>
                <p className="text-sm text-gray-500 mt-2 font-mono">SCAN TO JOIN</p>
              </div>
            )}
          </div>
        </div>

        <div className="mt-6 bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-6">
          <h2 className="text-label mb-4">TRIGGER LOGS</h2>
          {triggerLogs.length === 0 ? (
            <p className="text-gray-500 text-center py-8 font-mono">NO LOGS YET</p>
          ) : (
            <div className="space-y-3">
              {triggerLogs.map(log => (
                <div key={log.id} className={`p-4 rounded-xl border ${
                  log.matched ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-red-500/10 border-red-500/20'
                }`}>
                  <div className="flex justify-between items-start">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-white font-mono">
                        {log.platform} · {log.triggerType}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-mono ${
                        log.matched
                          ? 'bg-emerald-500/20 text-emerald-400'
                          : 'bg-red-500/20 text-red-400'
                      }`}>
                        {log.matched ? 'MATCHED' : 'NO MATCH'}
                      </span>
                    </div>
                    <span className="text-xs text-gray-500 font-mono">
                      {log.timestamp.toLocaleString('zh-CN')}
                    </span>
                  </div>
                  {log.keyword && (
                    <div className="text-xs text-gray-500 mt-1 font-mono">
                      DETECT KW: {log.keyword}
                    </div>
                  )}
                  <div className="text-sm text-gray-300 mt-2 font-mono">
                    {log.message}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}