'use client';
import { useState } from 'react'

interface Account {
  id: number
  platform: string
  accountName: string
  status: string
}

const mockAccounts: Account[] = [
  { id: 1, platform: '抖音', accountName: '抖音账号1', status: '已绑定' },
  { id: 2, platform: '快手', accountName: '快手账号1', status: '已绑定' },
  { id: 3, platform: '小红书', accountName: '小红书账号1', status: '未绑定' }
]

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>(mockAccounts)
  const [selectedAccounts, setSelectedAccounts] = useState<number[]>([])
  const [isPublishing, setIsPublishing] = useState(false)

  const handleToggleAccount = (id: number) => {
    setSelectedAccounts(prev => 
      prev.includes(id) 
        ? prev.filter(accountId => accountId !== id)
        : [...prev, id]
    )
  }

  const handlePublish = () => {
    setIsPublishing(true)
    setTimeout(() => {
      setIsPublishing(false)
      alert('发布成功！')
    }, 1500)
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-6">多平台账号管理</h1>
      
      <div className="bg-white shadow rounded-lg p-6">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-semibold text-gray-900">已绑定账号</h2>
          <button className="px-4 py-2 bg-primary text-white rounded-md hover:bg-primary-dark">
            添加账号
          </button>
        </div>
        
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
                    {account.platform}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {account.accountName}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${account.status === '已绑定' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                      {account.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    <button className="text-primary hover:text-primary-dark mr-3">
                      编辑
                    </button>
                    <button className="text-red-600 hover:text-red-800">
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
      </div>
    </div>
  )
}