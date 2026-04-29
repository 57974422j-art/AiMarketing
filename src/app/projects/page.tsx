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

const INDUSTRY_TEMPLATES = [
  { id: 'ecommerce', name: '电商带货', description: '适合商品展示、直播引流', icon: '🛒' },
  { id: 'education', name: '教育培训', description: '适合课程推广、知识付费', icon: '📚' },
  { id: 'local', name: '本地生活', description: '适合餐饮、休闲娱乐商家', icon: '🏪' },
  { id: 'beauty', name: '美妆护肤', description: '适合化妆品、护肤品推广', icon: '💄' },
  { id: 'tech', name: '科技数码', description: '适合3C产品、智能硬件', icon: '📱' },
  { id: 'finance', name: '金融理财', description: '适合理财产品推广', icon: '💰' },
  { id: 'entertainment', name: '娱乐综艺', description: '适合娱乐内容、明星周边', icon: '🎬' },
  { id: 'custom', name: '自定义', description: '从空白项目开始', icon: '✨' }
];

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [user, setUser] = useState<{ id: number; username: string; role: string } | null>(null);
  const [newProject, setNewProject] = useState({ name: '', description: '', template: 'custom' });

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

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!user) {
      alert('请先登录');
      return;
    }

    try {
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...newProject,
          userId: user.id
        })
      });

      const data = await response.json();

      if (data.success) {
        setShowCreateModal(false);
        setNewProject({ name: '', description: '', template: 'custom' });
        loadProjects();
        alert('项目创建成功');
      } else {
        alert(data.message || '创建失败');
      }
    } catch (error) {
      alert('创建失败，请稍后重试');
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
            onClick={() => setShowCreateModal(true)}
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
              onClick={() => setShowCreateModal(true)}
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
            <h3 className="text-lg font-semibold text-gray-900 mb-4">创建新项目</h3>
            
            <form onSubmit={handleCreateProject} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  项目名称 *
                </label>
                <input
                  type="text"
                  value={newProject.name}
                  onChange={(e) => setNewProject({ ...newProject, name: e.target.value })}
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
                  value={newProject.description}
                  onChange={(e) => setNewProject({ ...newProject, description: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
                  rows={3}
                  placeholder="可选的项目描述"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  行业模板
                </label>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {INDUSTRY_TEMPLATES.map((template) => (
                    <button
                      key={template.id}
                      type="button"
                      onClick={() => setNewProject({ ...newProject, template: template.id })}
                      className={`p-3 rounded-lg border-2 text-left transition-all ${
                        newProject.template === template.id
                          ? 'border-primary bg-blue-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <div className="text-2xl mb-1">{template.icon}</div>
                      <div className="font-medium text-gray-900 text-sm">{template.name}</div>
                      <div className="text-xs text-gray-500 mt-1">{template.description}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-primary text-white rounded-md hover:bg-primary-dark"
                >
                  创建项目
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}