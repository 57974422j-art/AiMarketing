'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/app/providers';
import { useLocale } from '@/i18n/context';

interface Project {
  id: number;
  name: string;
  description: string | null;
  createdAt: string;
  assetCount?: number;
}

const INDUSTRIES = [
  { id: 'tea', name: { zh: '茶叶', en: 'Tea' }, icon: '🍵', description: { zh: '茶叶销售、茶馆服务', en: 'Tea sales, tea house services' } },
  { id: 'clothing', name: { zh: '服装', en: 'Clothing' }, icon: '👕', description: { zh: '服装零售、定制服务', en: 'Clothing retail, custom services' } },
  { id: 'food', name: { zh: '餐饮', en: 'Food' }, icon: '🍜', description: { zh: '餐厅、咖啡厅、小吃店', en: 'Restaurants, cafes, snack shops' } },
  { id: 'beauty', name: { zh: '美妆', en: 'Beauty' }, icon: '💄', description: { zh: '化妆品、护肤品、美容院', en: 'Cosmetics, skincare, beauty salons' } },
  { id: 'education', name: { zh: '教育', en: 'Education' }, icon: '📚', description: { zh: '培训、辅导、教育机构', en: 'Training, tutoring, education institutions' } },
  { id: 'home', name: { zh: '家居', en: 'Home' }, icon: '🏠', description: { zh: '家具、家纺、装饰品', en: 'Furniture, home textiles, decorations' } },
  { id: 'digital', name: { zh: '数码', en: 'Digital' }, icon: '📱', description: { zh: '手机、电脑、数码配件', en: 'Phones, computers, digital accessories' } },
  { id: 'other', name: { zh: '其他', en: 'Other' }, icon: '✨', description: { zh: '其他行业', en: 'Other industries' } }
];

const MARKETING_GOALS = [
  { id: 'short-video', name: { zh: '短视频推广', en: 'Short Video' }, icon: '🎬', description: { zh: '抖音、快手等平台短视频营销', en: 'Short video marketing on Douyin, Kuaishou' } },
  { id: 'live-stream', name: { zh: '直播引流', en: 'Live Stream' }, icon: '📺', description: { zh: '通过直播吸引潜在客户', en: 'Attract potential customers through live streaming' } },
  { id: 'private-domain', name: { zh: '私域转化', en: 'Private Domain' }, icon: '💬', description: { zh: '微信私域流量运营转化', en: 'WeChat private domain traffic conversion' } },
  { id: 'branding', name: { zh: '品牌宣传', en: 'Branding' }, icon: '📢', description: { zh: '提升品牌知名度和美誉度', en: 'Enhance brand awareness and reputation' } }
];

export default function ProjectsPage() {
  const { user, loading: authLoading } = useAuth();
  const { t } = useLocale();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [step, setStep] = useState(1);
  const [isCreating, setIsCreating] = useState(false);

  const [formData, setFormData] = useState({
    industry: '',
    goals: [] as string[],
    projectName: '',
    projectDescription: ''
  });

  useEffect(() => {
    if (!authLoading) {
      loadProjects();
    }
  }, [authLoading]);

  const loadProjects = async () => {
    try {
      const response = await fetch('/api/projects', { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        setProjects(data);
      }
    } catch (error) {
      console.error('加载项目失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setStep(1);
    setFormData({
      industry: '',
      goals: [],
      projectName: '',
      projectDescription: ''
    });
  };

  const handleOpenModal = () => {
    resetForm();
    setShowCreateModal(true);
  };

  const handleCloseModal = () => {
    setShowCreateModal(false);
    resetForm();
  };

  const handleIndustrySelect = (industryId: string) => {
    setFormData({ ...formData, industry: industryId });
  };

  const handleGoalToggle = (goalId: string) => {
    const newGoals = formData.goals.includes(goalId)
      ? formData.goals.filter(g => g !== goalId)
      : [...formData.goals, goalId];
    setFormData({ ...formData, goals: newGoals });
  };

  const handleNextStep = () => {
    if (step === 1 && !formData.industry) {
      alert('请选择一个行业 / Please select an industry');
      return;
    }
    if (step === 2 && formData.goals.length === 0) {
      alert('请至少选择一个营销目标 / Please select at least one goal');
      return;
    }
    if (step === 2) {
      const industryName = INDUSTRIES.find(i => i.id === formData.industry)?.name || '营销';
      const goalNames = formData.goals.join('、');
      setFormData({
        ...formData,
        projectName: `${industryName}营销项目`,
        projectDescription: `专注于${industryName}行业的${goalNames}营销项目，为客户提供专业服务`
      });
    }
    setStep(step + 1);
  };

  const handlePrevStep = () => {
    setStep(step - 1);
  };

  const handleCreateProject = async () => {
    if (!user?.id) {
      alert('请先登录 / Please login');
      return;
    }

    if (!formData.projectName.trim()) {
      alert('请输入项目名称 / Please enter project name');
      return;
    }

    setIsCreating(true);

    try {
      const response = await fetch('/api/projects/create-with-ai', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          industry: formData.industry,
          goals: formData.goals,
          projectName: formData.projectName,
          projectDescription: formData.projectDescription,
          userId: user.id
        })
      });

      const data = await response.json();

      if (data.success) {
        handleCloseModal();
        loadProjects();
        alert(`项目创建成功！\n项目名称: ${formData.projectName || data.project?.name || ''}`);
      } else {
        alert(data.message || '创建失败 / Creation failed');
      }
    } catch (error) {
      console.error('创建项目失败:', error);
      alert('创建失败 / Creation failed');
    } finally {
      setIsCreating(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-950">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-400"></div>
          <p className="mt-4 text-sm text-gray-500">{t.common.loading}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="container-main max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <div>
            <p className="text-label mb-2">{t.projects.workspace}</p>
            <h1 className="text-mono-lg text-white">{t.projects.title}</h1>
          </div>
          <button
            onClick={handleOpenModal}
            className="btn-primary"
          >
            {t.common.add} {t.projects.newProject}
          </button>
        </div>

        {projects.length === 0 ? (
          <div className="card-bento text-center py-16">
            <div className="text-6xl mb-4 opacity-50">📁</div>
            <h3 className="text-xl font-semibold text-white mb-2">{t.projects.projectList}</h3>
            <p className="text-sm text-gray-500 mb-6">{t.common.noData}</p>
            <button
              onClick={handleOpenModal}
              className="btn-primary"
            >
              {t.common.create} {t.projects.newProject}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {projects.map((project) => (
              <div key={project.id} className="card-bento hover:border-emerald-500/30">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="text-lg font-semibold text-white">{project.name}</h3>
                    <p className="text-xs text-gray-500 mt-1">
                      {new Date(project.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <span className="text-2xl opacity-50">📁</span>
                </div>
                {project.description && (
                  <p className="text-sm text-gray-400 mb-4">{project.description}</p>
                )}
                <div className="flex gap-3 mt-auto">
                  <Link
                    href={`/projects/${project.id}/assets`}
                    className="flex-1 px-3 py-2 text-center text-sm bg-white/5 border border-white/10 text-gray-300 rounded-lg hover:bg-white/10"
                  >
                    {t.common.edit}
                  </Link>
                  <Link
                    href={`/projects/${project.id}/edit`}
                    className="flex-1 px-3 py-2 text-center text-sm bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 rounded-lg hover:bg-emerald-500/30"
                  >
                    {t.common.open} →
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showCreateModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-gray-900/95 border border-white/10 rounded-2xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg text-white">
                <span>创建新项目</span>
                <span className="text-xs opacity-50 ml-1">CREATE NEW PROJECT</span>
              </h3>
              <button
                onClick={handleCloseModal}
                className="text-gray-500 hover:text-white transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex items-center justify-center mb-8">
              <div className="flex items-center">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm ${
                  step >= 1 ? 'bg-emerald-500 text-white' : 'bg-white/10 text-gray-500'
                }`}>
                  1
                </div>
                <div className={`w-16 h-0.5 ${step >= 2 ? 'bg-emerald-500' : 'bg-white/10'}`} />
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm ${
                  step >= 2 ? 'bg-emerald-500 text-white' : 'bg-white/10 text-gray-500'
                }`}>
                  2
                </div>
                <div className={`w-16 h-0.5 ${step >= 3 ? 'bg-emerald-500' : 'bg-white/10'}`} />
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm ${
                  step >= 3 ? 'bg-emerald-500 text-white' : 'bg-white/10 text-gray-500'
                }`}>
                  3
                </div>
              </div>
            </div>

            <div className="mb-6">
              <h4 className="text-center text-lg text-white mb-4">
                {step === 1 && (
                  <><span>步骤 1：选择行业</span><span className="text-xs opacity-50 ml-1">/ SELECT INDUSTRY</span></>
                )}
                {step === 2 && (
                  <><span>步骤 2：选择营销目标</span><span className="text-xs opacity-50 ml-1">/ SELECT GOALS</span></>
                )}
                {step === 3 && (
                  <><span>步骤 3：确认项目信息</span><span className="text-xs opacity-50 ml-1">/ CONFIRM INFO</span></>
                )}
              </h4>

              {step === 1 && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {INDUSTRIES.map((industry) => (
                    <button
                      key={industry.id}
                      onClick={() => handleIndustrySelect(industry.id)}
                      className={`p-4 rounded-xl border text-center transition-all ${
                        formData.industry === industry.id
                          ? 'border-emerald-500 bg-emerald-500/20 text-emerald-400'
                          : 'border-white/10 bg-white/5 text-gray-300 hover:border-white/30'
                      }`}
                    >
                      <div className="text-3xl mb-2">{industry.icon}</div>
                      <div className="font-medium text-sm">{String(industry.name.zh)}</div>
                    </button>
                  ))}
                </div>
              )}

              {step === 2 && (
                <div>
                  <p className="text-center text-gray-500 mb-4 text-sm">
                    <span>支持多选</span>
                    <span className="text-xs opacity-50 ml-1">/ MULTI-SELECT</span>
                  </p>
                  <div className="grid grid-cols-2 gap-4">
                    {MARKETING_GOALS.map((goal) => (
                      <button
                        key={goal.id}
                        onClick={() => handleGoalToggle(goal.id)}
                        className={`p-4 rounded-xl border text-center transition-all ${
                          formData.goals.includes(goal.id)
                            ? 'border-emerald-500 bg-emerald-500/20 text-emerald-400'
                            : 'border-white/10 bg-white/5 text-gray-300 hover:border-white/30'
                        }`}
                      >
                        <div className="text-3xl mb-2">{goal.icon}</div>
                        <div className="font-medium text-sm">{String(goal.name.zh)}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {step === 3 && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm text-gray-400 mb-2">
                      <span>项目名称</span>
                      <span className="text-xs opacity-50 ml-1">PROJECT NAME *</span>
                    </label>
                    <input
                      type="text"
                      value={formData.projectName}
                      onChange={(e) => setFormData({ ...formData, projectName: e.target.value })}
                      className="input-dark font-mono"
                      placeholder="输入项目名称 / Enter project name"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm text-gray-400 mb-2">
                      <span>项目描述</span>
                      <span className="text-xs opacity-50 ml-1">DESCRIPTION</span>
                    </label>
                    <textarea
                      value={formData.projectDescription}
                      onChange={(e) => setFormData({ ...formData, projectDescription: e.target.value })}
                      className="input-dark font-mono"
                      rows={3}
                      placeholder="可选描述 / Optional description"
                    />
                  </div>

                  <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4">
                    <h5 className="text-emerald-400 mb-3">
                      <span>AI将自动生成</span>
                      <span className="text-xs opacity-70 ml-1">/ AI WILL AUTO-GENERATE:</span>
                    </h5>
                    <ul className="text-sm text-gray-400 space-y-1">
                      <li>✅ {INDUSTRIES.find(i => i.id === formData.industry)?.name?.zh || ""} <span className="opacity-50">industry</span> 营销文案模板</li>
                      <li>✅ {INDUSTRIES.find(i => i.id === formData.industry)?.name?.zh || ""} <span className="opacity-50">industry</span> 专业AI员工</li>
                      <li>✅ {formData.goals.length} 个意向客户关键词 <span className="opacity-50">keywords</span></li>
                    </ul>
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-3">
              {step > 1 && (
                <button
                  onClick={handlePrevStep}
                  className="flex-1 px-4 py-3 border border-white/10 text-gray-300 rounded-lg hover:bg-white/5"
                >
                  <span>← 上一步</span>
                  <span className="text-xs opacity-50 ml-1">PREV</span>
                </button>
              )}
              {step < 3 && (
                <button
                  onClick={handleNextStep}
                  className="flex-1 px-4 py-3 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600"
                >
                  <span>下一步 →</span>
                  <span className="text-xs opacity-70 ml-1">NEXT</span>
                </button>
              )}
              {step === 3 && (
                <button
                  onClick={handleCreateProject}
                  disabled={isCreating}
                  className="flex-1 px-4 py-3 bg-gradient-to-r from-emerald-500 to-teal-500 text-white rounded-lg hover:from-emerald-600 hover:to-teal-600 disabled:opacity-50"
                >
                  {isCreating ? (
                    <span>创建中... / CREATING...</span>
                  ) : (
                    <span>✨ 创建项目 / CREATE</span>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
