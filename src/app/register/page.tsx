'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function RegisterPage() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
    inviteCode: ''
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (formData.password !== formData.confirmPassword) {
      setError('两次密码不一致 / Passwords do not match');
      return;
    }

    if (formData.password.length < 6) {
      setError('密码太短（至少6位）/ Password too short (min 6 chars)');
      return;
    }

    if (!formData.inviteCode) {
      setError('邀请码不能为空 / Invite code required');
      return;
    }

    setLoading(true);

    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          username: formData.username,
          email: formData.email,
          password: formData.password,
          name: formData.username,
          inviteCode: formData.inviteCode
        })
      });

      const data = await response.json();

      if (data.success) {
        alert('注册成功 / Registration Successful');
        router.push('/login');
      } else {
        setError(data.message || '注册失败 / Registration Failed');
      }
    } catch (err) {
      setError('连接错误 / Connection Error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 via-transparent to-transparent"></div>
      <div className="absolute top-1/4 right-1/4 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl"></div>
      <div className="absolute bottom-1/4 left-1/4 w-96 h-96 bg-emerald-500/5 rounded-full blur-3xl"></div>

      <div className="relative z-10 w-full max-w-md px-4">
        <div className="text-center mb-8">
          <Link href="/" className="text-mono text-2xl font-bold tracking-wider">
            <span className="text-emerald-400">AI</span>
            <span className="text-white">MARKETING</span>
          </Link>
          <p className="text-mono-sm text-gray-500 mt-2">// 新用户注册 / NEW USER REGISTRATION</p>
        </div>

        <div className="card-glass p-8">
          <h2 className="text-mono text-xl text-white mb-2 text-center">
            <span>注册账号</span>
          </h2>
          <p className="text-center text-xs text-gray-500 mb-6 tracking-wider">CREATE ACCOUNT</p>

          {error && (
            <div className="mb-6 p-3 bg-red-500/20 border border-red-500/30 rounded-lg text-red-400 text-sm text-center">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm text-gray-400 mb-2">
                <span>用户名</span>
                <span className="text-xs opacity-50 ml-1">USERNAME</span>
              </label>
              <input
                type="text"
                name="username"
                value={formData.username}
                onChange={handleChange}
                className="input-dark font-mono"
                placeholder="请输入用户名 / Enter username"
                required
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-2">
                <span>邮箱</span>
                <span className="text-xs opacity-50 ml-1">EMAIL</span>
              </label>
              <input
                type="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                className="input-dark font-mono"
                placeholder="请输入邮箱 / Enter email"
                required
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-2">
                <span>密码</span>
                <span className="text-xs opacity-50 ml-1">PASSWORD</span>
              </label>
              <input
                type="password"
                name="password"
                value={formData.password}
                onChange={handleChange}
                className="input-dark font-mono"
                placeholder="至少6位 / Min 6 chars"
                required
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-2">
                <span>确认密码</span>
                <span className="text-xs opacity-50 ml-1">CONFIRM PASSWORD</span>
              </label>
              <input
                type="password"
                name="confirmPassword"
                value={formData.confirmPassword}
                onChange={handleChange}
                className="input-dark font-mono"
                placeholder="再次输入密码 / Confirm password"
                required
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-2">
                <span>邀请码</span>
                <span className="text-xs opacity-50 ml-1">INVITE CODE</span>
              </label>
              <input
                type="text"
                name="inviteCode"
                value={formData.inviteCode}
                onChange={handleChange}
                className="input-dark font-mono"
                placeholder="请输入邀请码 / Enter invite code"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-emerald-500 hover:bg-emerald-600 text-white font-mono tracking-wider rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span>创建中... / Creating...</span>
              ) : (
                <span>创建账号 → / CREATE →</span>
              )}
            </button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-sm text-gray-500">
              <span>已有账号？</span>
              <span className="text-xs opacity-50 ml-1">Have account?</span>
              <br />
              <Link href="/login" className="text-emerald-400 hover:text-emerald-300">
                <span>立即登录 → / LOGIN →</span>
              </Link>
            </p>
          </div>
        </div>

        <div className="mt-8 text-center">
          <p className="text-xs text-gray-600">© 2026 AIMARKETING SYSTEM / 系统</p>
        </div>
      </div>
    </div>
  );
}
