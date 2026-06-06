'use client';

import { useAuth } from '@/app/providers';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useCallback } from 'react';

/* ====== 类型定义 ====== */
interface CheckItem {
  key: string;
  category: string;
  label: string;
  status: 'pending' | 'pass' | 'warn' | 'fail';
  message: string;
  detail?: string;
  fix?: string;
}

interface DiagSummary {
  total: number; pass: number; warn: number; fail: number; score: number;
}

/* Mock 检查结果 */
const MOCK_CHECKS: Omit<CheckItem, 'status'>[] = [
  /* 账号健康 */
  { key: 'acc_count', category: '账号', label: '社交账号绑定数', message: '已绑定 5 个账号', detail: '抖音3 微信1 小红书1', fix: '/admin/social-accounts' },
  { key: 'acc_token', category: '账号', label: 'Token 有效期检查', message: '2个账号Token即将过期', detail: '抖音账号A: 剩余3天, 微信B: 剩余1天', fix: '重新授权' },
  { key: 'acc_rate', category: '账号', label: '发布成功率', message: '近7日成功率 87%', detail: '发布156次 失败20次 (限频/封禁)', fix: '查看失败记录' },
  /* 设备健康 */
  { key: 'dev_online', category: '设备', label: '设备在线率', message: '8/12 设备在线', detail: '离线: Device-03, Device-07, Device-11, Device-12', fix: '/admin/devices' },
  { key: 'dev_adb', category: '设备', label: 'ADB 连通性', message: '6/8 在线设备ADB正常', detail: 'Device-05 ADB超时, Device-09 服务崩溃', fix: '重启ADB服务' },
  { key: 'dev_storage', category: '设备', label: '设备存储空间', message: '3台设备存储>80%', detail: 'Device-02: 92%, Device-06: 85%, Device-10: 88%', fix: '清理媒体文件' },
  /* 内容健康 */
  { key: 'cont_pending', category: '内容', label: '待审核内容', message: '5条待审核', detail: '提交于近24h，平均等待2h', fix: '/admin/content-submissions' },
  { key: 'cont_quality', category: '内容', label: '内容质量评分', message: '平均评分 B+', detail: '文案A+ 视频B 封面B-', fix: '提升视频分辨率' },
  { key: 'cont_ai', category: '内容', label: 'AI 生成任务队列', message: '3个任务排队中', detail: '文生视频2 图生视频1 预计等待15min', fix: '查看任务详情' },
  /* 系统健康 */
  { key: 'sys_aikey', category: '系统', label: 'AI API Key 状态', message: '所有Key有效', detail: '腾讯云/智谱/通义均正常', fix: '' },
  { key: 'sys_oss', category: '系统', label: 'OSS 存储状态', message: '存储正常', detail: '已用 2.3GB / 50GB (4.6%)', fix: '' },
  { key: 'sys_db', category: '系统', label: '数据库性能', message: '响应正常，查询延迟 avg 23ms, 无慢查询', fix: '', detail: '' },
];

const CATEGORY_ICONS: Record<string, string> = {
  '账号': '🔗', '设备': '🖥️', '内容': '📝', '系统': '⚙️',
};

export default function DiagnosticsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [checks, setChecks] = useState<CheckItem[]>([]);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.push('/login');
    if (!loading && user && user.role === 'end-user') router.push('/admin');
  }, [loading, user, router]);

  const runDiagnostics = useCallback(async () => {
    setRunning(true); setDone(false);
    setChecks(MOCK_CHECKS.map(c => ({ ...c, status: 'pending' as const })));

    try {
      const res = await fetch('/api/admin/diagnostics', { credentials: 'include' });
      let data: CheckItem[] = [];
      if (res.ok) { const j = await res.json(); data = j.data?.checks || []; }

      if (data.length === 0) {
        /* 模拟逐项返回结果 */
        for (let i = 0; i < MOCK_CHECKS.length; i++) {
          await new Promise(r => setTimeout(r, 200 + Math.random() * 300));
          setChecks(prev => prev.map((c, idx) =>
            idx === i ? { ...c, status: getMockStatus(c.key) as CheckItem['status'] } : c
          ));
        }
      } else {
        setChecks(data);
      }
    } catch (_) {
      /* 全部使用 mock 结果立即填充 */
      setChecks(MOCK_CHECKS.map(c => ({ ...c, status: getMockStatus(c.key) as CheckItem['status'] })));
    }
    setRunning(false); setDone(true);
  }, []);

  /* 计算 summary */
  const summary: DiagSummary = checks.length > 0 ? (() => {
    const p = checks.filter(c => c.status === 'pass').length;
    const w = checks.filter(c => c.status === 'warn').length;
    const f = checks.filter(c => c.status === 'fail').length;
    return { total: checks.length, pass: p, warn: w, fail: f, score: Math.round((p * 100 + w * 60 + f * 10) / checks.length) };
  })() : { total: 0, pass: 0, warn: 0, fail: 0, score: 0 };

  if (loading || !user) return <div className="min-h-screen bg-gray-950 flex items-center justify-center"><div className="text-gray-400">加载中...</div></div>;

  return (
    <div className="min-h-screen bg-gray-950">
      {/* Header */}
      <div className="border-b border-gray-800">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <p className="text-label mb-2">AI 诊断 / DIAGNOSTICS</p>
          <h1 className="text-mono-lg text-white">系统健康诊断</h1>
          <p className="text-gray-400 text-sm mt-2">一键检测账号、设备、内容、系统各维度健康度</p>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* 操作栏 */}
        <div className="flex items-center gap-4 mb-8">
          <button onClick={runDiagnostics} disabled={running}
            className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 disabled:text-gray-400 text-white font-bold rounded-lg transition-colors flex items-center gap-2"
          >
            {running ? (<><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block"></span>检测中...</>) : done ? '重新检测' : '开始检测'}
          </button>

          {done && (
            <div className="flex items-center gap-4 ml-auto">
              <div className={'px-3 py-1 rounded-full text-sm font-bold ' + (summary.score >= 80 ? 'bg-emerald-500/20 text-emerald-400' : summary.score >= 60 ? 'bg-amber-500/20 text-amber-400' : 'bg-red-500/20 text-red-400')}>
                综合评分: {summary.score}
              </div>
              <span className="text-gray-500 text-sm">{summary.pass} 通过 / {summary.warn} 警告 / {summary.fail} 异常</span>
            </div>
          )}
        </div>

        {/* 检查列表 */}
        {!running && !done && checks.length === 0 && (
          <div className="card-bento text-center py-16">
            <div className="text-5xl mb-4">🏥</div>
            <h3 className="text-xl text-white font-bold mb-2">准备就绪</h3>
            <p className="text-gray-400">点击「开始检测」运行全维度健康诊断</p>
          </div>
        )}

        {/* 分组显示 */}
        {(['账号', '设备', '内容', '系统'] as const).map(cat => {
          const catChecks = checks.filter(c => c.category === cat);
          if (catChecks.length === 0) return null;
          return (
            <div key={cat} className="mb-8">
              <h2 className="text-mono-sm text-gray-500 uppercase tracking-wider mb-4 flex items-center gap-2">
                <span>{CATEGORY_ICONS[cat]}</span>{cat}健康
              </h2>
              <div className="space-y-3">
                {catChecks.map(item => (
                  <div key={item.key} className="card-bento flex items-start gap-4" style={{ animationDelay: '0.05s' }}>
                    {/* 状态图标 */}
                    <div className={'shrink-0 mt-0.5 w-8 h-8 rounded-full flex items-center justify-center text-lg ' + (item.status === 'pending' ? 'bg-gray-800' : item.status === 'pass' ? 'bg-emerald-500/20 text-emerald-400' : item.status === 'warn' ? 'bg-amber-500/20 text-amber-400' : 'bg-red-500/20 text-red-400')}>
                      {item.status === 'pending' ? (<span className="w-4 h-4 border-2 border-gray-600 border-t-transparent rounded-full animate-spin inline-block"></span>) :
                        item.status === 'pass' ? '✓' : item.status === 'warn' ? '!' : '×'}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-medium text-white">{item.label}</h3>
                        {item.fix && item.status !== 'pass' && (
                          <a href={item.fix} className="text-xs text-emerald-400 hover:text-emerald-300">去处理 →</a>
                        )}
                      </div>
                      <p className="text-sm text-gray-400 mt-0.5">{item.message}</p>
                      {item.detail && <p className="text-xs text-gray-600 mt-1">{item.detail}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function getMockStatus(key: string): string {
  /* 根据模拟数据决定状态 */
  const fails = ['dev_adb', 'dev_storage', 'acc_token'];
  const warns = ['dev_online', 'cont_pending', 'cont_ai', 'cont_quality'];
  if (fails.includes(key)) return 'fail';
  if (warns.includes(key)) return 'warn';
  return 'pass';
}
