'use client';

import { useAuth } from '@/app/providers';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useCallback } from 'react';

/* ====== 类型定义 ====== */
interface AgentStats {
  totalClients: number;
  activeClients: number;
  totalLeads: number;
  convertedLeads: number;
  pendingSubmissions: number;
  publishedCount: number;
  monthlyRevenue: number;
  commissionRate: number;
}

interface ClientItem {
  id: number; username: string; email: string; plan: string;
  status: string; lastLogin: string; taskCount: number;
}

interface RecentActivity {
  id: number; type: string; desc: string; user: string; time: string;
}

const AGENT_MENU = [
  { title: '我的客户', desc: '管理下属 end-user 客户', href: '/admin/users?filter=my-clients', icon: '👥' },
  { title: '线索池', desc: '查看和分配营销线索', href: '/admin?scroll=leads', icon: '🎯' },
  { title: '素材审核', desc: '审核客户提交的内容', href: '/admin/content-submissions', icon: '📋' },
  { title: '数据看板', desc: '查看团队运营数据', href: '/admin/dashboard', icon: '📊' },
  { title: '话术模板', desc: '管理AI话术模板库', href: '/admin/script-templates', icon: '💬' },
  { title: '直播间中控', desc: '直播管理+Q1设备控制', href: '/live', icon: '📺' },
];

export default function AgentDashboardPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [stats, setStats] = useState<AgentStats | null>(null);
  const [clients, setClients] = useState<ClientItem[]>([]);
  const [activities, setActivities] = useState<RecentActivity[]>([]);
  const [activeTab, setActiveTab] = useState<'overview' | 'clients' | 'activity'>('overview');
  const [loadingData, setLoadingData] = useState(false);

  useEffect(() => {
    if (!loading && !user) { router.push('/login'); return; }
    if (!loading && user && user.role === 'end-user') { router.push('/admin'); return; }
  }, [loading, user, router]);

  /* 加载代理数据 */
  const loadAgentData = useCallback(async () => {
    if (loadingData || !user) return;
    setLoadingData(true);
    try {
      const res = await fetch('/api/admin/agent?userId=' + user.id, { credentials: 'include' });
      if (res.ok) {
        const json = await res.json();
        setStats(json.data?.stats || null);
        setClients(json.data?.clients || []);
        setActivities(json.data?.activities || []);
      }
      /* Mock 数据兜底 */
      else {
        setStats({
          totalClients: 12, activeClients: 8, totalLeads: 45,
          convertedLeads: 18, pendingSubmissions: 5, publishedCount: 67,
          monthlyRevenue: 12800, commissionRate: 15,
        });
        setClients([
          { id: 1, username: 'zhang_san', email: 'zs@client.com', plan: 'pro', status: 'active', lastLogin: '2026-06-05', taskCount: 23 },
          { id: 2, username: 'li_si', email: 'ls@client.com', plan: 'basic', status: 'active', lastLogin: '2026-06-04', taskCount: 15 },
          { id: 3, username: 'wang_wu', email: 'ww@client.com', plan: 'free', status: 'inactive', lastLogin: '2026-05-20', taskCount: 3 },
        ]);
        setActivities([
          { id: 1, type: 'publish', desc: '客户 zhang_san 发布了3条视频', user: 'zhang_san', time: '10分钟前' },
          { id: 2, type: 'submit', desc: 'li_si 提交了素材待审核', user: 'li_si', time: '30分钟前' },
          { id: 3, type: 'lead', desc: '新线索: 某餐饮品牌询价', user: '系统', time: '1小时前' },
          { id: 4, type: 'convert', desc: 'wang_wu 升级到 Pro 套餐', user: 'wang_wu', time: '2小时前' },
        ]);
      }
    } catch (_) {
      /* 静默失败，使用默认值 */
    } finally {
      setLoadingData(false);
    }
  }, [user, loadingData]);

  useEffect(() => { loadAgentData(); }, [loadAgentData]);

  if (loading || !user) {
    return <div className="min-h-screen bg-gray-950 flex items-center justify-center"><div className="text-gray-400">加载中...</div></div>;
  }

  return (
    <div className="min-h-screen bg-gray-950">
      {/* Header */}
      <div className="border-b border-gray-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <p className="text-label mb-2">代理工作台 / AGENT DASHBOARD</p>
          <h1 className="text-mono-lg text-white">
            欢迎，<span className="text-emerald-400">{user.username}</span>
            {' '}<span className="text-sm font-normal text-gray-500">| {user.role}</span>
          </h1>
          <p className="text-gray-400 text-sm mt-2">管理您的客户、跟踪业绩、查看实时动态</p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* 统计卡片区 */}
        {stats ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            {[
              { label: '总客户数', value: stats.totalClients, sub: '活跃 ' + stats.activeClients, color: 'emerald' },
              { label: '营销线索', value: stats.totalLeads, sub: '转化 ' + stats.convertedLeads, color: 'blue' },
              { label: '已发布内容', value: stats.publishedCount, sub: '待审核 ' + stats.pendingSubmissions, color: 'purple' },
              { label: '本月预估收入', value: '\u00A5' + stats.monthlyRevenue, sub: '佣金率 ' + stats.commissionRate + '%', color: 'amber' },
            ].map((card) => (
              <div key={card.label} className="card-bento">
                <p className="text-label text-xs mb-1">{card.label}</p>
                <p className={'text-2xl font-bold text-' + card.color + '-400'}>{card.value}</p>
                <p className="text-gray-500 text-xs mt-1">{card.sub}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            {[1,2,3,4].map((i) => (
              <div key={i} className="card-bento animate-pulse"><div className="h-12 bg-gray-800 rounded"></div></div>
            ))}
          </div>
        )}

        {/* 快捷操作区 */}
        <div className="mb-8">
          <h2 className="text-mono-sm text-gray-500 uppercase tracking-wider mb-4">快捷操作</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {AGENT_MENU.map((item) => (
              <a key={item.href} href={item.href} className="card-bento group cursor-pointer block p-4 text-center hover:border-emerald-600 transition-colors">
                <div className="text-2xl mb-2">{item.icon}</div>
                <h3 className="text-white text-sm font-bold group-hover:text-emerald-400 transition-colors">{item.title}</h3>
                <p className="text-gray-500 text-xs mt-1 hidden md:block">{item.desc}</p>
              </a>
            ))}
          </div>
        </div>

        {/* Tab 切换 */}
        <div className="flex gap-2 mb-6 border-b border-gray-800 pb-0">
          {[{key:'overview' as const,label:'概览'},{key:'clients' as const,label:'客户列表'},{key:'activity' as const,label:'最近动态'}].map((tab) => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className={'px-4 py-2 text-sm font-medium transition-colors border-b-2 '
                + (activeTab === tab.key ? 'border-emerald-500 text-emerald-400' : 'border-transparent text-gray-400 hover:text-white')}>
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab 内容 */}
        {activeTab === 'overview' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* 最近动态 */}
            <div className="card-bento">
              <h3 className="text-mono-sm text-gray-400 uppercase tracking-wider mb-4">最近动态</h3>
              {activities.length > 0 ? activities.slice(0, 5).map((act) => (
                <div key={act.id} className="flex items-start gap-3 py-3 border-b border-gray-800 last:border-0">
                  <span className="text-lg">{act.type === 'publish' ? '🚀' : act.type === 'submit' ? '📤' : act.type === 'lead' ? '🎯' : '💰'}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white">{act.desc}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{act.user} · {act.time}</p>
                  </div>
                </div>
              )) : (
                <div className="text-center py-8 text-gray-500">暂无动态</div>
              )}
            </div>

            {/* 业绩图表占位 */}
            <div className="card-bento">
              <h3 className="text-mono-sm text-gray-400 uppercase tracking-wider mb-4">业绩趋势</h3>
              <div className="h-64 flex items-end justify-around gap-2 pt-4">
                {[65,45,80,55,90,70,85,60,95,75,88,92].map((h, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full bg-emerald-500/30 rounded-t" style={{ height: h + '%' }}></div>
                    <span className="text-[10px] text-gray-600">{i + 1}月</span>
                  </div>
                ))}
              </div>
              <p className="text-center text-xs text-gray-500 mt-4">2026 年度发布量趋势</p>
            </div>
          </div>
        )}

        {activeTab === 'clients' && (
          <div className="card-bento overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left border-b border-gray-800">
                <th className="py-3 px-4 text-label font-medium">客户</th><th className="py-3 px-4 text-label font-medium">套餐</th>
                <th className="py-3 px-4 text-label font-medium">状态</th><th className="py-3 px-4 text-label font-medium">任务数</th><th className="py-3 px-4 text-label font-medium">最后登录</th></tr></thead>
              <tbody>
                {clients.map((c) => (<tr key={c.id} className="border-b border-gray-800/50 hover:bg-gray-900/50">
                  <td className="py-3 px-4"><div className="text-white font-medium">{c.username}</div><div className="text-gray-500 text-xs">{c.email}</div></td>
                  <td className="py-3 px-4"><span className={'px-2 py-0.5 rounded text-xs ' + (c.plan === 'pro' ? 'bg-purple-500/20 text-purple-400' : c.plan === 'basic' ? 'bg-blue-500/20 text-blue-400' : 'bg-gray-700 text-gray-300')}>{c.plan}</span></td>
                  <td className="py-3 px-4"><span className={'w-2 h-2 rounded-full inline-block mr-1 ' + (c.status === 'active' ? 'bg-emerald-400' : 'bg-gray-600')}></span>{c.status === 'active' ? '在线' : '离线'}</td>
                  <td className="py-3 px-4 text-gray-400">{c.taskCount}</td>
                  <td className="py-3 px-4 text-gray-500 text-xs">{c.lastLogin}</td>
                </tr>))}
                {clients.length === 0 && <tr><td colSpan={5} className="py-8 text-center text-gray-500">暂无客户数据</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'activity' && (
          <div className="card-bento">
            {activities.map((act) => (
              <div key={act.id} className="flex items-start gap-3 py-4 border-b border-gray-800 last:border-0">
                <span className="text-xl w-10 text-center shrink-0">{act.type === 'publish' ? '🚀' : act.type === 'submit' ? '📤' : act.type === 'lead' ? '🎯' : '💰'}</span>
                <div className="flex-1 min-w-0"><p className="text-sm text-white">{act.desc}</p><p className="text-xs text-gray-500 mt-1">{act.user} · {act.time}</p></div>
              </div>
            ))}
            {activities.length === 0 && <div className="text-center py-12 text-gray-500">暂无活动记录</div>}
          </div>
        )}
      </div>
    </div>
  );
}
