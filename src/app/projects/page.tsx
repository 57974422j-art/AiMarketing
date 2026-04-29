'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';

interface Project {
  id: number;
  name: string;
  description: string | null;
  createdAt: string;
  assetCount?: number;
}

const INDUSTRIES = [
  { id: '茶叶', name: '茶叶', icon: '🍵', description: '茶叶销售、茶馆服务' },
  { id: '服装', name: '服装', icon: '👕', description: '服装零售、定制服务' },
  { id: '餐饮', name: '餐饮', icon: '🍜', description: '餐厅、咖啡厅、小吃店' },
  { id: '美妆', name: '美妆', icon: '💄', description: '化妆品、护肤品、美容院' },
  { id: '教育', name: '教育', icon: '📚', description: '培训、辅导、教育机构' },
  { id: '家居', name: '家居', icon: '🏠', description: '家具、家纺、装饰品' },
  { id: '数码', name: '数码', icon: '📱', description: '手机、电脑、数码配件' },
  { id: '其他', name: '其他', icon: '✨', description: '其他行业' }
];

const MARKETING_GOALS = [
  { id: '短视频推广', name: '短视频推广', icon: '🎬', description: '抖音、快手等平台短视频营销' },
  { id: '直播引流', name: '直播引流', icon: '📺', description: '通过直播吸引潜在客户' },
  { id: '私域转化', name: '私域转化', icon: '💬', description: '微信私域流量运营转化' },
  { id: '品牌宣传', name: '品牌宣传', icon: '📢', description: '提升品牌知名度和美誉度' }
];

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [user, setUser] = useState<{ id: number; username: string; role: string } | null>(null);
  const [step, setStep] = useState(1);
  const [isCreating, setIsCreating] = useState(false);

  const [formData, setFormData] = useState({
    industry: '',
    goals: [] as string[],
    projectName: '',
    projectDescription: ''
  });

  useEffect(() => {
    checkAuth();
    loadProjects();
  }, []);

  const checkAuth = async () => {
    try {
      const response = await fetch('/api/auth/login');
      const data = await response.json();
      if (data.authenticated && data.user) {
        setUser(data.user);
      } else {
        window.location.href = '/login';
      }
    } catch (error) {
      window.location.href = '/login';
    }
  };

  const loadProjects = async () => {
    try {
      const response = await fetch('/api/projects');
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
      alert('请选择一个行业');
      return;
    }
    if (step === 2 && formData.goals.length === 0) {
      alert('请至少选择一个营销目标');
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
    if (!user) {
      alert('请先登录');
      return;
    }

    if (!formData.projectName.trim()) {
      alert('请输入项目名称');
      return;
    }

    setIsCreating(true);

    try {
      const response = await fetch('/api/projects/create-with-ai', {
        method: 'POST',
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
        alert(`项目创建成功！\n\n已自动生成：\n- ${data.data.copyTasks} 条营销文案\n- 1 个AI员工"${data.data.agent.name}"\n- ${data.data.keywords} 个意向关键词`);
      } else {
        alert(data.message || '创建失败');
      }
    } catch (error) {
      console.error('创建项目失败:', error);
      alert('创建失败，请稍后重试');
    } finally {
      setIsCreating(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/login');
      document.cookie = 'token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
      window.location.href = '/login';
    } catch (error) {
      window.location.href = '/login';
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          <p className="mt-2 text-gray-600">加载中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <nav className="bg-white shadow-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <Link href="/projects" className="text-xl font-bold text-primary">
              AiMarketing
            </Link>
            <div className="flex items-center space-x-4">
              <span className="text-gray-700">
                {user?.username || '用户'} ({user?.role === 'admin' ? '管理员' : user?.role === 'editor' ? '编辑' : '普通用户'})
              </span>
              <button
                onClick={handleLogout}
                className="px-3 py-1 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50"
              >
                退出
              </button>
            </div>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold text-gray-900">项目管理</h1>
          <button
            onClick={handleOpenModal}
            className="px-4 py-2 bg-primary text-white rounded-md hover:bg-primary-dark"
          >
            创建项目
          </button>
        </div>

        {projects.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-12 text-center">
            <div className="text-6xl mb-4">📁</div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">暂无项目</h3>
            <p className="text-gray-500 mb-4">创建您的第一个项目，开始使用 AiMarketing</p>
            <button
              onClick={handleOpenModal}
              className="px-4 py-2 bg-primary text-white rounded-md hover:bg-primary-dark"
            >
              创建项目
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {projects.map((project) => (
              <div key={project.id} className="bg-white rounded-lg shadow hover:shadow-lg transition-shadow p-6">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">{project.name}</h3>
                    <p className="text-sm text-gray-500 mt-1">
                      创建于 {new Date(project.createdAt).toLocaleDateString('zh-CN')}
                    </p>
                  </div>
                  <span className="text-2xl">📁</span>
                </div>
                {project.description && (
                  <p className="mt-3 text-gray-600 text-sm">{project.description}</p>
                )}
                <div className="mt-4 flex gap-2">
                  <Link
                    href={`/projects/${project.id}/assets`}
                    className="flex-1 px-3 py-2 text-center text-sm bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200"
                  >
                    素材管理
                  </Link>
                  <Link
                    href={`/projects/${project.id}/edit`}
                    className="flex-1 px-3 py-2 text-center text-sm bg-primary text-white rounded-md hover:bg-primary-dark"
                  >
                    进入项目
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold text-gray-900">创建新项目</h3>
              <button
                onClick={handleCloseModal}
                className="px-3 py-1 text-gray-600 hover:bg-gray-100 rounded"
              >
                ×
              </button>
            </div>

            <div className="flex items-center justify-center mb-6">
              <div className="flex items-center">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                  step >= 1 ? 'bg-primary text-white' : 'bg-gray-200 text-gray-500'
                }`}>
                  1
                </div>
                <div className={`w-16 h-0.5 ${step >= 2 ? 'bg-primary' : 'bg-gray-200'}`} />
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                  step >= 2 ? 'bg-primary text-white' : 'bg-gray-200 text-gray-500'
                }`}>
                  2
                </div>
                <div className={`w-16 h-0.5 ${step >= 3 ? 'bg-primary' : 'bg-gray-200'}`} />
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                  step >= 3 ? 'bg-primary text-white' : 'bg-gray-200 text-gray-500'
                }`}>
                  3
                </div>
              </div>
            </div>

            <div className="mb-6">
              <h4 className="text-center text-lg font-medium text-gray-900 mb-4">
                {step === 1 && '第一步：选择您的行业'}
                {step === 2 && '第二步：选择营销目标'}
                {step === 3 && '第三步：确认项目信息'}
              </h4>

              {step === 1 && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {INDUSTRIES.map((industry) => (
                    <button
                      key={industry.id}
                      onClick={() => handleIndustrySelect(industry.id)}
                      className={`p-4 rounded-lg border-2 text-center transition-all ${
                        formData.industry === industry.id
                          ? 'border-primary bg-blue-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <div className="text-3xl mb-2">{industry.icon}</div>
                      <div className="font-medium text-gray-900">{industry.name}</div>
                      <div className="text-xs text-gray-500 mt-1">{industry.description}</div>
                    </button>
                  ))}
                </div>
              )}

              {step === 2 && (
                <div>
                  <p className="text-center text-gray-600 mb-4">可多选，选择您想要的营销效果</p>
                  <div className="grid grid-cols-2 gap-4">
                    {MARKETING_GOALS.map((goal) => (
                      <button
                        key={goal.id}
                        onClick={() => handleGoalToggle(goal.id)}
                        className={`p-4 rounded-lg border-2 text-center transition-all ${
                          formData.goals.includes(goal.id)
                            ? 'border-primary bg-blue-50'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <div className="text-3xl mb-2">{goal.icon}</div>
                        <div className="font-medium text-gray-900">{goal.name}</div>
                        <div className="text-xs text-gray-500 mt-1">{goal.description}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {step === 3 && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      项目名称 *
                    </label>
                    <input
                      type="text"
                      value={formData.projectName}
                      onChange={(e) => setFormData({ ...formData, projectName: e.target.value })}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
                      placeholder="请输入项目名称"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      项目描述
                    </label>
                    <textarea
                      value={formData.projectDescription}
                      onChange={(e) => setFormData({ ...formData, projectDescription: e.target.value })}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
                      rows={3}
                      placeholder="可选的项目描述"
                    />
                  </div>

                  <div className="bg-blue-50 rounded-lg p-4">
                    <h5 className="font-medium text-gray-900 mb-2">AI 将自动创建以下内容：</h5>
                    <ul className="text-sm text-gray-600 space-y-1">
                      <li>✅ {INDUSTRIES.find(i => i.id === formData.industry)?.name}行业营销文案模板</li>
                      <li>✅ {INDUSTRIES.find(i => i.id === formData.industry)?.name}专业AI员工</li>
                      <li>✅ {formData.goals.length} 个意向客户关键词</li>
                    </ul>
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-3">
              {step > 1 && (
                <button
                  onClick={handlePrevStep}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50"
                >
                  上一步
                </button>
              )}
              {step < 3 && (
                <button
                  onClick={handleNextStep}
                  className="flex-1 px-4 py-2 bg-primary text-white rounded-md hover:bg-primary-dark"
                >
                  下一步
                </button>
              )}
              {step === 3 && (
                <button
                  onClick={handleCreateProject}
                  disabled={isCreating}
                  className="flex-1 px-4 py-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-md hover:from-purple-600 hover:to-pink-600 disabled:opacity-50"
                >
                  {isCreating ? '创建中...' : '✨ 一键创建项目'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}