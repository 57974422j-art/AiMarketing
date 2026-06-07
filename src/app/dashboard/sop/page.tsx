'use client';

import { useState } from 'react';

interface WorkflowStep {
  id: number;
  title: string;
  desc: string;
  href?: string;
  status: 'done' | 'active' | 'pending';
}

interface Workflow {
  id: string;
  title: string;
  subtitle: string;
  icon: string;
  color: string;
  steps: WorkflowStep[];
}

const workflows: Workflow[] = [
  {
    id: 'content',
    title: '内容生产 SOP',
    subtitle: 'CONTENT PRODUCTION WORKFLOW',
    icon: '📝',
    color: 'from-emerald-500/20 to-teal-500/10',
    steps: [
      { id: 1, title: '行业洞察', desc: '查看热门话题，选择内容方向', href: '/dashboard/insights', status: 'done' },
      { id: 2, title: 'AI 文案生成', desc: '输入关键词，AI 生成多个候选文案', href: '/ai-copy', status: 'done' },
      { id: 3, title: '数字人形象克隆', desc: '上传真人视频训练数字人形象（极速版3分钟/精品版24小时）', href: '/digital-human', status: 'active' },
      { id: 4, title: '视频制作', desc: '方式A：一键成片合成视频 / 方式B：数字人口播视频生成', href: '/auto-compile', status: 'pending' },
      { id: 5, title: '存入素材库', desc: '将制作好的视频统一存入仓库，供直播推流或手机推送使用', href: '/storage', status: 'pending' },
      { id: 6, title: '发布推送', desc: '指纹浏览器发布 / Q1 手机自动发布 / 推送到设备', href: '/my-fingerprint', status: 'pending' },
      { id: 7, title: '数据追踪', desc: 'Dashboard 查看播放量 / 互动数据 / 转化漏斗', href: '/dashboard', status: 'pending' },
    ],
  },
  {
    id: 'live',
    title: '直播运营 SOP',
    subtitle: 'LIVE OPERATION WORKFLOW',
    icon: '📺',
    color: 'from-red-500/20 to-orange-500/10',
    steps: [
      { id: 1, title: '素材准备', desc: '数字人口播视频 / 一键成片视频 → 存入素材库', href: '/storage', status: 'done' },
      { id: 2, title: '组建播放列表', desc: '从素材库导入视频到直播 Playlist，设置播放顺序和类型', href: '/live', status: 'active' },
      { id: 3, title: '直播配置与开播', desc: '配置 RTMP 推流地址、码率、分辨率等参数，启动 FFmpeg 推流', href: '/live', status: 'pending' },
      { id: 4, title: '直播中控', desc: '实时监控推流状态 / 手动自动回复 / 商品上下架 / 人工介入', href: '/live', status: 'pending' },
      { id: 5, title: '直播后复盘', desc: '本场推流时长/流量统计 / 对比历史场次 / 导出报告', href: '/live', status: 'pending' },
    ],
  },
  {
    id: 'acquisition',
    title: '客户获取 SOP',
    subtitle: 'CUSTOMER ACQUISITION WORKFLOW',
    icon: '🎯',
    color: 'from-blue-500/20 to-indigo-500/10',
    steps: [
      { id: 1, title: '创建采集任务', desc: '选择平台 + 关键词 + 数据源', href: '/lead-collector', status: 'done' },
      { id: 2, title: '自动采集', desc: 'MediaCrawler 爬取 + AI 提取联系方式 + 意向打分', href: '/lead-collector', status: 'active' },
      { id: 3, title: '线索分配', desc: 'Editor 审核高意向线索 → 分配给 end-user', href: '/lead-collector', status: 'pending' },
      { id: 4, title: '跟进转化', desc: 'end-user 手动联系 / 记录转化状态', href: '/referral', status: 'pending' },
      { id: 5, title: '导流配置', desc: '配置导流文案 + 落地方式', href: '/referral', status: 'pending' },
      { id: 6, title: '效果追踪', desc: 'ReferralLog 统计转化漏斗', href: '/referral', status: 'pending' },
    ],
  },
];

const actionLabels: Record<string, string> = {
  done: '已完成',
  active: '进行中',
  pending: '待执行',
};

const statusStyles: Record<string, string> = {
  done: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
  active: 'bg-blue-500/15 text-blue-400 border-blue-500/25 animate-pulse',
  pending: 'bg-gray-500/10 text-gray-500 border-gray-500/20',
};

export default function SopPage() {
  const [expandedWorkflow, setExpandedWorkflow] = useState<string | null>('content');

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-10">
          <p className="text-label mb-2">标准化流程 / STANDARD OPERATING PROCEDURES</p>
          <h1 className="text-mono-lg text-white mb-2">SOP 工作流</h1>
          <p className="text-gray-400 text-sm max-w-2xl">
            将分散的功能串联成完整的业务流程，每一步均可点击跳转到对应功能页面。
          </p>
        </div>

        {/* Workflows */}
        <div className="space-y-6">
          {workflows.map((wf) => (
            <div
              key={wf.id}
              className={`bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 overflow-hidden transition-all duration-300 ${expandedWorkflow === wf.id ? 'ring-1 ring-white/15' : ''}`}
            >
              {/* Header - clickable to expand/collapse */}
              <button
                onClick={() => setExpandedWorkflow(expandedWorkflow === wf.id ? null : wf.id)}
                className="w-full flex items-center gap-5 p-6 hover:bg-white/5 transition-colors text-left"
              >
                <div className={`w-14 h-14 rounded-xl bg-gradient-to-br ${wf.color} flex items-center justify-center text-2xl shrink-0`}>
                  {wf.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-lg font-semibold text-white">{wf.title}</h2>
                  <p className="text-xs text-gray-500 mt-0.5">{wf.subtitle}</p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-xs text-gray-400 bg-white/5 px-2.5 py-1 rounded-full">
                    {wf.steps.filter(s => s.status === 'done').length}/{wf.steps.length} 步完成
                  </span>
                  <svg
                    className={`w-5 h-5 text-gray-400 transition-transform duration-300 ${expandedWorkflow === wf.id ? 'rotate-180' : ''}`}
                    fill="none" stroke="currentColor" viewBox="0 0 24 24"
                  ><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                </div>
              </button>

              {/* Steps */}
              {expandedWorkflow === wf.id && (
                <div className="px-6 pb-6">
                  {/* Progress bar */}
                  <div className="mb-6">
                    <div className="flex justify-between text-xs text-gray-500 mb-2">
                      <span>进度 / PROGRESS</span>
                      <span>{Math.round((wf.steps.filter(s => s.status === 'done').length / wf.steps.length) * 100)}%</span>
                    </div>
                    <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-blue-500 to-purple-500 rounded-full transition-all duration-500"
                        style={{ width: `${(wf.steps.filter(s => s.status === 'done').length / wf.steps.length) * 100}%` }}
                      />
                    </div>
                  </div>

                  {/* Steps list */}
                  <div className="space-y-3">
                    {wf.steps.map((step, idx) => (
                      <a
                        key={step.id}
                        href={step.href || '#'}
                        onClick={(e) => { if (!step.href) e.preventDefault(); }}
                        className="group flex items-start gap-4 p-4 rounded-xl bg-white/[0.02] border border-white/5 hover:bg-white/[0.06] hover:border-white/10 transition-all"
                      >
                        {/* Step number */}
                        <div className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                          step.status === 'done' ? 'bg-emerald-500/20 text-emerald-400' :
                          step.status === 'active' ? 'bg-blue-500/20 text-blue-400' :
                          'bg-gray-500/10 text-gray-500'
                        }`}>
                          {step.status === 'done' ? (
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                          ) : (
                            idx + 1
                          )}
                        </div>

                        {/* Connector line */}
                        {idx < wf.steps.length - 1 && (
                          <div className="absolute left-[calc(1rem+1.125rem)] top-[3.5rem] w-px h-[calc(100%-0.5rem)] bg-white/5 ml-3.5 mt-[-8px]" />
                        )}

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-white group-hover:text-blue-300 transition-colors">{step.title}</span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded border ${statusStyles[step.status]}`}>
                              {actionLabels[step.status]}
                            </span>
                          </div>
                          <p className="text-xs text-gray-500 mt-1">{step.desc}</p>
                        </div>

                        {/* Arrow */}
                        {step.href && (
                          <svg className="w-4 h-4 text-gray-600 group-hover:text-gray-400 shrink-0 mt-1 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        )}
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Footer tips */}
        <div className="mt-10 p-5 bg-blue-500/5 rounded-xl border border-blue-500/10">
          <p className="text-sm text-blue-300/80 font-medium mb-1">💡 使用提示</p>
          <ul className="text-xs text-gray-400 space-y-1 ml-4 list-disc">
            <li>点击每个步骤可跳转到对应功能页面</li>
            <li>状态标记：✅ 已完成 → 🔵 进行中 → ⏳ 待执行</li>
            <li>工作流按实际业务顺序排列，建议从 Step 1 开始依次执行</li>
            <li>管理员可在「诊断与工具」中检查各模块运行状态</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
