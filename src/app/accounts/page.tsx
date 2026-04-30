'use client';
import { useState, useEffect } from 'react'
import { useAuth } from '@/app/providers'

interface Account {
  id: number
  platform: string
  accountName: string
  accountId: string
  isBound: boolean
  bindType: 'official' | 'manual' | 'device'
  createdAt: string
}

export default function AccountsPage() {
  const { user } = useAuth()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [selectedAccounts, setSelectedAccounts] = useState<number[]>([])
  const [isPublishing, setIsPublishing] = useState(false)
  const [showAddModal, setShowAddModal] = useState(false)
  const [loading, setLoading] = useState(true)

  const [newAccount, setNewAccount] = useState({
    accountName: '',
    platform: 'douyin',
    accountId: '',
    bindType: 'official' as 'official' | 'manual' | 'device',
    remark: ''
  })

  useEffect(() => {
    loadAccounts()
  }, [])

  const loadAccounts = async () => {
    try {
      const response = await fetch('/api/accounts', { credentials: 'include' })
      const data = await response.json()
      setAccounts(Array.isArray(data) ? data : [])
    } catch (error) {
      console.error('加载账号列表失败:', error)
      setAccounts([])
    } finally {
      setLoading(false)
    }
  }

  const handleToggleAccount = (id: number) => {
    setSelectedAccounts(prev => 
      prev.includes(id) 
        ? prev.filter(accountId => accountId !== id)
        : [...prev, id]
    )
  }

  const handleAddAccount = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!user?.id) {
      alert('请先登录 / Please login')
      return
    }

    try {
      const response = await fetch('/api/accounts', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...newAccount,
          userId: user.id
        })
      })

      const data = await response.json()

      if (data.success) {
        setShowAddModal(false)
        setNewAccount({ accountName: '', platform: 'douyin', accountId: '', bindType: 'official', remark: '' })
        loadAccounts()
        alert('账号添加成功 / Account added successfully')
      } else {
        alert(data.message || '添加失败 / Add failed')
      }
    } catch (error) {
      console.error('添加账号失败:', error)
      alert('添加失败 / Add failed')
    }
  }

  const handleDeleteAccount = async (id: number) => {
    if (!confirm('确定要解绑此账号吗？/ Unbind this account?')) return

    try {
      const response = await fetch(`/api/accounts?id=${id}`, {
        method: 'DELETE',
        credentials: 'include'
      })

      const data = await response.json()

      if (data.success) {
        loadAccounts()
        alert('账号解绑成功 / Account unbound successfully')
      } else {
        alert(data.message || '解绑失败 / Unbind failed')
      }
    } catch (error) {
      console.error('解绑账号失败:', error)
      alert('解绑失败 / Unbind failed')
    }
  }

  const handlePublish = () => {
    setIsPublishing(true)
    setTimeout(() => {
      setIsPublishing(false)
      alert('发布成功！/ Published successfully!')
    }, 1500)
  }

  const getPlatformName = (platform: string) => {
    const map: Record<string, { cn: string; en: string }> = {
      'douyin': { cn: '抖音', en: 'DOUYIN' },
      'kuaishou': { cn: '快手', en: 'KUAISHOU' },
      'xiaohongshu': { cn: '小红书', en: 'XIAOHONGSHU' }
    }
    const p = map[platform] || { cn: platform, en: platform }
    return <><span>{p.cn}</span><span className="text-xs opacity-50 ml-1">{p.en}</span></>
  }

  const getBindTypeName = (bindType: string) => {
    const map: Record<string, { cn: string; en: string }> = {
      'official': { cn: '官方API', en: 'OFFICIAL API' },
      'manual': { cn: '指纹浏览器', en: 'FINGERPRINT' },
      'device': { cn: '真机群控', en: 'DEVICE' }
    }
    const t = map[bindType] || { cn: bindType, en: bindType }
    return <><span className="text-xs">{t.cn}</span><span className="opacity-60 ml-1">{t.en}</span></>
  }

  const getBindTypeColor = (bindType: string) => {
    const map: Record<string, string> = {
      'official': 'bg-blue-500/20 text-blue-400 border border-blue-500/30',
      'manual': 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30',
      'device': 'bg-green-500/20 text-green-400 border border-green-500/30'
    }
    return map[bindType] || 'bg-gray-500/20 text-gray-400 border border-gray-500/30'
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-400"></div>
          <p className="mt-2 text-gray-400 text-sm">
            <span>加载中</span>
            <span className="text-xs opacity-50 ml-1">LOADING...</span>
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex justify-between items-center mb-8">
          <div>
            <p className="text-label mb-2">平台管理 / PLATFORM MANAGEMENT</p>
            <h1 className="text-mono-lg text-white">账号管理 / ACCOUNTS</h1>
          </div>
          <button
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600"
          >
            <span>+ 添加账号</span>
            <span className="text-xs opacity-70 ml-1">ADD ACCOUNT</span>
          </button>
        </div>

        <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-label">已绑定账号 / BOUND ACCOUNTS</h2>
          </div>

          {accounts.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <p className="text-sm">
                <span>暂无绑定账号</span>
                <span className="text-xs opacity-50 ml-1">/ NO BOUND ACCOUNTS</span>
              </p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-white/10">
                  <thead className="bg-white/5">
                    <tr>
                      <th scope="col" className="px-6 py-4 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                        <input
                          type="checkbox"
                          className="rounded border-white/10 text-emerald-500 focus:ring-emerald-500 bg-transparent"
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedAccounts(accounts.map(account => account.id))
                            } else {
                              setSelectedAccounts([])
                            }
                          }}
                        />
                      </th>
                      <th scope="col" className="px-6 py-4 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                        <span>平台</span>
                        <span className="opacity-50 ml-1">PLATFORM</span>
                      </th>
                      <th scope="col" className="px-6 py-4 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                        <span>账号名称</span>
                        <span className="opacity-50 ml-1">ACCOUNT</span>
                      </th>
                      <th scope="col" className="px-6 py-4 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                        <span>绑定类型</span>
                        <span className="opacity-50 ml-1">TYPE</span>
                      </th>
                      <th scope="col" className="px-6 py-4 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                        <span>状态</span>
                        <span className="opacity-50 ml-1">STATUS</span>
                      </th>
                      <th scope="col" className="px-6 py-4 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                        <span>操作</span>
                        <span className="opacity-50 ml-1">ACTION</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {accounts.map((account) => (
                      <tr key={account.id} className="hover:bg-white/5">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <input
                            type="checkbox"
                            checked={selectedAccounts.includes(account.id)}
                            onChange={() => handleToggleAccount(account.id)}
                            className="rounded border-white/10 text-emerald-500 focus:ring-emerald-500 bg-transparent"
                          />
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-white">
                          {getPlatformName(account.platform)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-400">
                          {account.accountName}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${getBindTypeColor(account.bindType || 'official')}`}>
                            {getBindTypeName(account.bindType || 'official')}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${account.isBound ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-gray-500/20 text-gray-400 border border-gray-500/30'}`}>
                            {account.isBound ? (
                              <><span>已绑定</span><span className="opacity-60 ml-1">BOUND</span></>
                            ) : (
                              <><span>未绑定</span><span className="opacity-60 ml-1">UNBOUND</span></>
                            )}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          <button
                            onClick={() => handleDeleteAccount(account.id)}
                            className="text-red-400 hover:text-red-300"
                          >
                            <span>解绑</span>
                            <span className="text-xs opacity-50 ml-1">UNBIND</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-6 flex justify-end">
                <button
                  onClick={handlePublish}
                  disabled={isPublishing || selectedAccounts.length === 0}
                  className="px-6 py-3 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 disabled:bg-gray-700 disabled:cursor-not-allowed"
                >
                  {isPublishing ? (
                    <span>发布中... / PUBLISHING...</span>
                  ) : (
                    <span>发布到 {selectedAccounts.length} 个账号 / PUBLISH TO {selectedAccounts.length} ACCOUNTS</span>
                  )}
                </button>
              </div>
            </>
          )}
        </div>

        {showAddModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-gray-900 rounded-2xl p-6 w-full max-w-md border border-white/10">
              <h3 className="text-lg font-semibold text-white mb-4">
                <span>添加账号</span>
                <span className="text-xs opacity-50 ml-1">ADD ACCOUNT</span>
              </h3>
              <form onSubmit={handleAddAccount} className="space-y-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">
                    <span>昵称</span>
                    <span className="text-xs opacity-50 ml-1">NICKNAME *</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={newAccount.accountName}
                    onChange={(e) => setNewAccount({ ...newAccount, accountName: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500/50"
                    placeholder="账号昵称 / Account nickname..."
                  />
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-1">
                    <span>平台</span>
                    <span className="text-xs opacity-50 ml-1">PLATFORM *</span>
                  </label>
                  <select
                    value={newAccount.platform}
                    onChange={(e) => setNewAccount({ ...newAccount, platform: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500/50"
                  >
                    <option value="douyin" className="bg-gray-900">抖音 / DOUYIN</option>
                    <option value="kuaishou" className="bg-gray-900">快手 / KUAISHOU</option>
                    <option value="xiaohongshu" className="bg-gray-900">小红书 / XIAOHONGSHU</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-1">
                    <span>绑定类型</span>
                    <span className="text-xs opacity-50 ml-1">BIND TYPE *</span>
                  </label>
                  <select
                    value={newAccount.bindType}
                    onChange={(e) => setNewAccount({ ...newAccount, bindType: e.target.value as 'official' | 'manual' | 'device' })}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500/50"
                  >
                    <option value="official" className="bg-gray-900">官方API / OFFICIAL API</option>
                    <option value="manual" className="bg-gray-900">指纹浏览器 / FINGERPRINT</option>
                    <option value="device" className="bg-gray-900">真机群控 / DEVICE</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-1">
                    <span>主页链接</span>
                    <span className="text-xs opacity-50 ml-1">PROFILE LINK</span>
                  </label>
                  <input
                    type="url"
                    value={newAccount.accountId}
                    onChange={(e) => setNewAccount({ ...newAccount, accountId: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500/50"
                    placeholder="https://..."
                  />
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-1">
                    <span>备注</span>
                    <span className="text-xs opacity-50 ml-1">REMARK</span>
                  </label>
                  <textarea
                    value={newAccount.remark}
                    onChange={(e) => setNewAccount({ ...newAccount, remark: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500/50"
                    rows={3}
                    placeholder="可选备注 / Optional remark..."
                  />
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowAddModal(false)}
                    className="flex-1 px-4 py-2 border border-white/10 text-gray-400 rounded-xl hover:bg-white/10"
                  >
                    <span>取消</span>
                    <span className="text-xs opacity-50 ml-1">CANCEL</span>
                  </button>
                  <button
                    type="submit"
                    className="flex-1 px-4 py-2 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600"
                  >
                    <span>添加</span>
                    <span className="text-xs opacity-70 ml-1">ADD</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
