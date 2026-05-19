'use client'
import { useState, useEffect } from 'react'
import { useAuth } from '@/app/providers'

/**
 * ================================================================
 * 管理后台数据看板 — Dashboard
 * ================================================================
 * 
 * 三层显示逻辑：
 *    admin  → 全局数据 + 所有 editor 列表 + 窗口池 + AI用量
 *    editor → 自己的数据 + 下属 end-user 列表
 * 
 * 预留区域（有说明但无数据）：
 *  - 直播统计 (liveStreaming)
 *  - AI Token 消耗详情 (aiTokens)
 *  - 视频剪辑统计
 * ================================================================
 */

interface DashboardResponse {
  role: string
  overview: {
    todayPublished: number; totalTasks: number; successTasks: number
    failedTasks: number; successRate: number; followerGrowth: number
    videoTaskCount: number; videoTaskDone: number
  }
  devices: { total: number; online: number; offline: number; busy: number; onlineRate: number }
  accounts: { total: number; bound: number; byPlatform: Record<string, Record<string, number>> }
  windows: {
    poolTotal: number; poolUsed: number; poolDaily: number; todaySessions: number
    pools: { ownerId: number; ownerName: string; totalWindows: number; usedWindows: number; dailyQuota: number; activeSessions: number }[]
  }
  taskByType: Record<string, number>
  aiUsage: Record<string, { count: number; tokens: number }>
  subordinates: any[]
  followerTrend: { date: string; followers: number }[]
  liveStreaming: { todayStreams: number; totalDuration: number; peakViewers: number; totalViewers: number; status: string }
  aiTokens: { total: number; details: Record<string, { count: number; tokens: number }> }
}

export default function AdminDashboardPage() {
  const { user, loading: authLoading } = useAuth()
  const [data, setData] = useState<DashboardResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const isAdmin = user?.role === 'admin'

  useEffect(() => {
    if (!authLoading && user && user.role !== 'end-user') load()
    else if (!authLoading) setLoading(false)
  }, [authLoading, user])

  const load = async () => {
    try { const r = await fetch('/api/admin/dashboard', { credentials: 'include' }); if (r.ok) setData((await r.json()).data) }
    catch {} finally { setLoading(false) }
  }

  if (authLoading || loading) return <div className="min-h-screen bg-gray-950 flex items-center justify-center"><div className="text-gray-400">加载中...</div></div>
  if (!user || user.role === 'end-user') return <div className="min-h-screen bg-gray-950 flex items-center justify-center"><div className="text-red-400">无权限</div></div>

  const d = data
  const ov = d?.overview
  const dev = d?.devices
  const acc = d?.accounts

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* 标题 */}
        <div className="mb-8">
          <p className="text-label mb-2">管理后台 / DASHBOARD</p>
          <h1 className="text-mono-lg text-white">数据统计 / DASHBOARD</h1>
          <p className="text-gray-400 text-sm mt-2">
            {isAdmin ? '全局数据概览' : '我的团队数据'}
            <span className="ml-2 text-emerald-400/50">| {user?.username}</span>
          </p>
        </div>

        {/* ================================================================ */}
        {/* 上部：核心概览卡片 */}
        {/* ================================================================ */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <OverviewCard icon="📤" label="今日发布" value={ov?.todayPublished ?? 0} color="from-emerald-500/20 border-emerald-500/30" />
          <OverviewCard icon="📈" label={`粉丝增长${isAdmin ? '(7天)' : ''}`} value={(ov?.followerGrowth ?? 0) > 0 ? `+${ov?.followerGrowth}` : '0'} color="from-blue-500/20 border-blue-500/30" />
          <OverviewCard icon="✅" label="任务成功率" value={`${ov?.successRate ?? 0}%`} sub={`${ov?.successTasks ?? 0}/${ov?.totalTasks ?? 0}`} color="from-purple-500/20 border-purple-500/30" />
          <OverviewCard icon="🖥" label="设备在线率" value={`${dev?.onlineRate ?? 0}%`} sub={`${dev?.online ?? 0}/${dev?.total ?? 0}台`} color="from-amber-500/20 border-amber-500/30" />
        </div>

        {/* 第二行统计卡片 */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <MiniCard icon="🎬" label="视频剪辑" value={`${ov?.videoTaskDone ?? 0}/${ov?.videoTaskCount ?? 0}`} desc="已完成/总数" />
          <MiniCard icon="🔗" label="已绑定账号" value={acc?.bound ?? 0} sub={`${acc?.total ?? 0} 总计`} />
          <MiniCard icon="📋" label="总任务数" value={ov?.totalTasks ?? 0} sub={`失败 ${ov?.failedTasks ?? 0}`} />
          <MiniCard icon="📊" label="任务类型" value={Object.keys(d?.taskByType || {}).length} sub="种类型" />
        </div>

        {/* ================================================================ */}
        {/* 中部：账号 + 窗口池 + AI用量 */}
        {/* ================================================================ */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-8">
          {/* 账号平台分布 */}
          <div className="card-glass p-4">
            <h3 className="text-white font-bold mb-3 text-sm">账号平台分布</h3>
            {acc?.byPlatform && Object.keys(acc.byPlatform).length > 0
              ? <div className="space-y-2">
                  {Object.entries(acc.byPlatform).map(([platform, statuses]) => (
                    <div key={platform} className="flex items-center justify-between text-xs">
                      <span className="text-gray-300">{platform}</span>
                      <div className="flex gap-2">
                        <span className="text-emerald-400">已绑定 {(statuses as any)['已绑定'] || 0}</span>
                        <span className="text-gray-500">未绑定 {(statuses as any)['未绑定'] || 0}</span>
                      </div>
                    </div>
                  ))}
                </div>
              : <div className="text-gray-500 text-xs py-4 text-center">暂无账号绑定数据</div>}
          </div>

          {/* 窗口池 */}
          <div className="card-glass p-4">
            <h3 className="text-white font-bold mb-3 text-sm">
              窗口池
              <span className="text-gray-500 font-normal text-xs ml-1">| 今日会话 {d?.windows?.todaySessions ?? 0}</span>
            </h3>
            <div className="flex items-center gap-4 mb-3">
              <div><span className="text-2xl font-bold text-white">{d?.windows?.poolUsed ?? 0}</span><span className="text-gray-500 text-xs ml-1">/ {d?.windows?.poolTotal ?? 0}</span></div>
              <div className="text-xs text-gray-400">日配额 {d?.windows?.poolDaily ?? 0}</div>
            </div>
            {d?.windows?.pools && d.windows.pools.length > 0 && (
              <div className="space-y-1.5 max-h-32 overflow-y-auto text-xs">
                {d.windows.pools.map(p => (
                  <div key={p.ownerId} className="flex justify-between text-gray-400">
                    <span>{p.ownerName}</span>
                    <span>{p.usedWindows}/{p.totalWindows} 窗口 | 活跃 {p.activeSessions}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* AI 工具用量 */}
          <div className="card-glass p-4">
            <h3 className="text-white font-bold mb-3 text-sm">
              AI 工具用量
              <span className="text-gray-500 font-normal text-xs ml-1">| Token {d?.aiTokens?.total ?? 0}</span>
            </h3>
            {d?.aiUsage && Object.keys(d.aiUsage).length > 0
              ? <div className="space-y-1.5 text-xs">
                  {Object.entries(d.aiUsage).map(([action, u]) => (
                    <div key={action} className="flex justify-between text-gray-400">
                      <span>{action}</span>
                      <span>{u.count} 次 / {u.tokens} tokens</span>
                    </div>
                  ))}
                </div>
              : <div className="text-gray-500 text-xs py-4 text-center">
                  {/* 暂无AI用量数据 */}
                  {/* 【AI 用量统计方式】UsageLog 表记录每次 AI 调用 */}
                  {/* 接入 AI Provider 后自动统计 token 消耗 */}
                  暂无 AI 用量数据
                </div>}
          </div>
        </div>

        {/* ================================================================ */}
        {/* 中下部：任务类型分布 */}
        {/* ================================================================ */}
        <div className="card-glass p-4 mb-8">
          <h3 className="text-white font-bold mb-3 text-sm">任务类型分布</h3>
          <div className="flex flex-wrap gap-2">
            {d?.taskByType && Object.entries(d.taskByType).map(([type, count]) => (
              <div key={type} className="px-3 py-1.5 bg-white/5 rounded-lg flex items-center gap-2 text-xs">
                <span className="text-gray-300">{type}</span>
                <span className="text-white font-bold">{count}</span>
              </div>
            ))}
            {(!d?.taskByType || Object.keys(d.taskByType).length === 0) && (
              <div className="text-gray-500 text-xs py-2">暂无任务数据</div>
            )}
          </div>
        </div>

        {/* ================================================================ */}
        {/* 下级列表（admin 看 editor, editor 看 end-user） */}
        {/* ================================================================ */}
        <div className="card-glass p-4 mb-8">
          <h3 className="text-white font-bold mb-3 text-sm">
            {isAdmin ? '下级客户列表' : '终端客户列表'}
            <span className="text-gray-500 font-normal text-xs ml-1">({d?.subordinates?.length ?? 0})</span>
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-gray-500 border-b border-white/10">
                <tr>
                  <th className="text-left py-2 px-2">用户名</th>
                  {isAdmin ? (
                    <>
                      <th className="text-left py-2 px-2">窗口配额</th>
                      <th className="text-left py-2 px-2">日配额</th>
                    </>
                  ) : (
                    <th className="text-left py-2 px-2">绑定账号</th>
                  )}
                  <th className="text-left py-2 px-2">任务数</th>
                </tr>
              </thead>
              <tbody>
                {d?.subordinates?.map((s: any) => (
                  <tr key={s.id} className="border-b border-white/5 hover:bg-white/5">
                    <td className="py-2 px-2 text-white">{s.name || s.username}</td>
                    {isAdmin ? (
                      <>
                        <td className="py-2 px-2 text-gray-400">{s.usedWindows}/{s.totalWindows}</td>
                        <td className="py-2 px-2 text-gray-400">{s.dailyQuota}</td>
                      </>
                    ) : (
                      <td className="py-2 px-2 text-gray-400">{(s.accounts || []).join(', ') || '-'}</td>
                    )}
                    <td className="py-2 px-2 text-gray-400">{s.taskCount || 0}</td>
                  </tr>
                ))}
                {(!d?.subordinates || d.subordinates.length === 0) && (
                  <tr><td colSpan={3} className="text-gray-500 text-center py-4">暂无下级用户</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ================================================================ */}
        {/* 预留区域 */}
        {/* ================================================================ */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* 直播统计（预留） */}
          <div className="card-glass p-4 border border-dashed border-white/10">
            <h3 className="text-white font-bold mb-3 text-sm flex items-center gap-2">
              📡 直播统计
              <span className="text-[10px] text-gray-500 bg-white/5 px-2 py-0.5 rounded">coming soon</span>
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div><div className="text-gray-500 text-xs">今日开播</div><div className="text-white font-bold">{d?.liveStreaming?.todayStreams ?? 0}</div></div>
              <div><div className="text-gray-500 text-xs">总时长</div><div className="text-white font-bold">{d?.liveStreaming?.totalDuration ?? 0} min</div></div>
              <div><div className="text-gray-500 text-xs">最高在线</div><div className="text-white font-bold">{d?.liveStreaming?.peakViewers ?? 0}</div></div>
              <div><div className="text-gray-500 text-xs">总观众</div><div className="text-white font-bold">{d?.liveStreaming?.totalViewers ?? 0}</div></div>
            </div>
            {/* 【直播接入说明】使用 Q1 流管理功能 RTMP 推流 */}
            {/* 步骤: 1. Q1 傅管理配置推流地址  2. uiautomator 点击抖音开播  3. 统计写入此区域 */}
          </div>

          {/* Token消耗详情（预留） */}
          <div className="card-glass p-4 border border-dashed border-white/10">
            <h3 className="text-white font-bold mb-3 text-sm flex items-center gap-2">
              🤖 AI Token 消耗
              <span className="text-[10px] text-gray-500 bg-white/5 px-2 py-0.5 rounded">数据录入中</span>
            </h3>
            <div className="text-gray-500 text-xs space-y-1">
              <p>总消耗: {d?.aiTokens?.total ?? 0} tokens</p>
              <p className="text-gray-600 mt-2">
                【数据来源】UsageLog.tokens 字段记录每次 AI 调用消耗。<br />
                AI文案/生图/视频生成等功能的 token 用量后续接入统计。<br />
                模型分类: GPT-4o / Qwen / StableDiffusion / HunyuanVideo
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ================================================================
// 子组件
// ================================================================

function OverviewCard({ icon, label, value, sub, color }: { icon: string; label: string; value: string | number; sub?: string; color: string }) {
  return (
    <div className={`card-glass p-4 border bg-gradient-to-br ${color}`}>
      <div className="text-2xl mb-1">{icon}</div>
      <div className="text-2xl font-bold text-white">{value}</div>
      <div className="text-xs text-gray-400 mt-0.5">{label}</div>
      {sub && <div className="text-[11px] text-gray-500">{sub}</div>}
    </div>
  )
}

function MiniCard({ icon, label, value, desc, sub }: { icon: string; label: string; value: string | number; desc?: string; sub?: string }) {
  return (
    <div className="card-glass p-3 border border-white/5 flex items-center gap-3">
      <div className="text-xl">{icon}</div>
      <div>
        <div className="text-sm font-bold text-white">{value}</div>
        <div className="text-[11px] text-gray-500">{sub || label}</div>
        {desc && <div className="text-[10px] text-gray-600">{desc}</div>}
      </div>
    </div>
  )
}
