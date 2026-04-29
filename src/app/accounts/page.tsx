'use client';
import { useState, useEffect } from 'react'

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
  const [accounts, setAccounts] = useState<Account[]>([])
  const [selectedAccounts, setSelectedAccounts] = useState<number[]>([])
  const [isPublishing, setIsPublishing] = useState(false)
  const [showAddModal, setShowAddModal] = useState(false)
  const [loading, setLoading] = useState(true)
  const [userId, setUserId] = useState<number | null>(null)

  const [newAccount, setNewAccount] = useState({
    accountName: '',
    platform: 'douyin',
    accountId: '',
    bindType: 'official' as 'official' | 'manual' | 'device',
    remark: ''
  })

  useEffect(() => {
    loadAccounts()
    loadUserId()
  }, [])

  const loadUserId = async () => {
    try {
      const response = await fetch('/api/auth/login')
      const data = await response.json()
      if (data.authenticated && data.user) {
        setUserId(data.user.id)
      }
    } catch (error) {
      console.error('获取用户信息失败:', error)
    }
  }

  const loadAccounts = async () => {
    try {
      const response = await fetch('/api/accounts')
      const data = await response.json()
      setAccounts(data)
    } catch (error) {
      console.error('加载账号列表失败:', error)
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
    
    if (!userId) {
      alert('请先登录')
      return
    }

    try {
      const response = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...newAccount,
          userId
        })
      })

      const data = await response.json()

      if (data.success) {
        setShowAddModal(false)
        setNewAccount({ accountName: '', platform: 'douyin', accountId: '', bindType: 'official', remark: '' })
        loadAccounts()
        alert('账号添加成功')
      } else {
        alert(data.message || '添加失败')
      }
    } catch (error) {
      console.error('添加账号失败:', error)
      alert('添加失败，请稍后重试')
    }
  }

  const handleDeleteAccount = async (id: number) => {
    if (!confirm('确定要解绑此账号吗？')) return

    try {
      const response = await fetch(`/api/accounts?id=${id}`, {
        method: 'DELETE'
      })

      const data = await response.json()

      if (data.success) {
        loadAccounts()
        alert('账号解绑成功')
      } else {
        alert(data.message || '解绑失败')
      }
    } catch (error) {
      console.error('解绑账号失败:', error)
      alert('解绑失败，请稍后重试')
    }
  }

  const handlePublish = () => {
    setIsPublishing(true)
    setTimeout(() => {
      setIsPublishing(false)
      alert('发布成功！')
    }, 1500)
  }

  const getPlatformName = (platform: string) => {
    const map: Record<string, string> = {
      'douyin': '抖音',
      'kuaishou': '快手',
      'xiaohongshu': '小红书'
    }
    return map[platform] || platform
  }

  const getBindTypeName = (bindType: string) => {
    const map: Record<string, string> = {
      'official': '官方API',
      'manual': '指纹浏览器',
      'device': '真机群控'
    }
    return map[bindType] || bindType
  }

  const getBindTypeColor = (bindType: string) => {
    const map: Record<string, string> = {
      'official': 'bg-blue-100 text-blue-800',
      'manual': 'bg-yellow-100 text-yellow-800',
      'device': 'bg-green-100 text-green-800'
    }
    return map[bindType] || 'bg-gray-100 text-gray-800'
  }

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          <p className="mt-2 text-gray-600">加载中...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-6">多平台账号管理</h1>
      
      <div className="bg-white shadow rounded-lg p-6">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-semibold text-gray-900">已绑定账号</h2>
          <button 
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2 bg-primary text-white rounded-md hover:bg-primary-dark"
          >
            添加账号
          </button>
        </div>
        
        {accounts.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <p>暂无绑定账号，点击上方按钮添加</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      <input 
                        type="checkbox" 
                        className="rounded border-gray-300 text-primary focus:ring-primary"
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedAccounts(accounts.map(account => account.id))
                          } else {
                            setSelectedAccounts([])
                          }
                        }}
                      />
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      平台
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      账号名称
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      对接方式
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      状态
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      操作
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {accounts.map((account) => (
                    <tr key={account.id}>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <input 
                          type="checkbox" 
                          checked={selectedAccounts.includes(account.id)}
                          onChange={() => handleToggleAccount(account.id)}
                          className="rounded border-gray-300 text-primary focus:ring-primary"
                        />
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {getPlatformName(account.platform)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {account.accountName}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getBindTypeColor(account.bindType || 'official')}`}>
                          {getBindTypeName(account.bindType || 'official')}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${account.isBound ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                          {account.isBound ? '已绑定' : '未绑定'}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        <button 
                          onClick={() => handleDeleteAccount(account.id)}
                          className="text-red-600 hover:text-red-800"
                        >
                          解绑
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
                className="px-6 py-2 bg-primary text-white rounded-md hover:bg-primary-dark disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                {isPublishing ? '发布中...' : `发布到 ${selectedAccounts.length} 个账号`}
              </button>
            </div>
          </>
        )}
      </div>

      {showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">添加账号</h3>
            <form onSubmit={handleAddAccount} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  昵称 *
                </label>
                <input
                  type="text"
                  required
                  value={newAccount.accountName}
                  onChange={(e) => setNewAccount({ ...newAccount, accountName: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="请输入账号昵称"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  平台 *
                </label>
                <select
                  value={newAccount.platform}
                  onChange={(e) => setNewAccount({ ...newAccount, platform: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="douyin">抖音</option>
                  <option value="kuaishou">快手</option>
                  <option value="xiaohongshu">小红书</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  对接方式 *
                </label>
                <select
                  value={newAccount.bindType}
                  onChange={(e) => setNewAccount({ ...newAccount, bindType: e.target.value as 'official' | 'manual' | 'device' })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="official">官方API</option>
                  <option value="manual">指纹浏览器</option>
                  <option value="device">真机群控</option>
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  主页链接
                </label>
                <input
                  type="url"
                  value={newAccount.accountId}
                  onChange={(e) => setNewAccount({ ...newAccount, accountId: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="https://..."
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  备注
                </label>
                <textarea
                  value={newAccount.remark}
                  onChange={(e) => setNewAccount({ ...newAccount, remark: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
                  rows={3}
                  placeholder="可选备注信息"
                />
              </div>
              
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-primary text-white rounded-md hover:bg-primary-dark"
                >
                  添加
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}