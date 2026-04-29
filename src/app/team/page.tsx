'use client'

import { useState, useEffect } from 'react'

interface TeamMember {
  id: number
  role: string
  user: {
    id: number
    username: string
    name: string | null
    email: string
    createdAt: string
  }
}

interface Team {
  id: number
  name: string
  ownerId: number
  owner: { id: number; username: string; name: string | null }
  members: TeamMember[]
}

export default function TeamPage() {
  const [team, setTeam] = useState<Team | null>(null)
  const [loading, setLoading] = useState(true)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showAddMemberModal, setShowAddMemberModal] = useState(false)
  const [newTeamName, setNewTeamName] = useState('')
  const [newMemberUsername, setNewMemberUsername] = useState('')
  const [newMemberRole, setNewMemberRole] = useState('viewer')
  const [agentCode, setAgentCode] = useState<string | null>(null)
  const [userRole, setUserRole] = useState<string | null>(null)
  const [currentUserId, setCurrentUserId] = useState<number | null>(null)

  useEffect(() => {
    fetchTeam()
  }, [])

  const fetchTeam = async () => {
    try {
      const res = await fetch('/api/team', {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' }
      })
      const data = await res.json()
      if (data.success) {
        setTeam(data.data)
        if (data.data?.members) {
          const currentMember = data.data.members.find((m: any) => m.user?.id)
          setUserRole(currentMember?.role || null)
        }
      }
    } catch (error) {
      console.error('获取团队失败:', error)
    } finally {
      setLoading(false)
    }
  }

  const createTeam = async () => {
    if (!newTeamName.trim()) return
    try {
      const res = await fetch('/api/team', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newTeamName })
      })
      const data = await res.json()
      if (data.success) {
        setShowCreateModal(false)
        setNewTeamName('')
        fetchTeam()
      } else {
        alert(data.message)
      }
    } catch (error) {
      console.error('创建团队失败:', error)
    }
  }

  const addMember = async () => {
    if (!newMemberUsername.trim() || !team) return
    try {
      const res = await fetch('/api/team/members', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teamId: team.id,
          username: newMemberUsername,
          role: newMemberRole
        })
      })
      const data = await res.json()
      if (data.success) {
        setShowAddMemberModal(false)
        setNewMemberUsername('')
        setNewMemberRole('viewer')
        fetchTeam()
      } else {
        alert(data.message)
      }
    } catch (error) {
      console.error('添加成员失败:', error)
    }
  }

  const updateMemberRole = async (memberId: number, newRole: string) => {
    try {
      const res = await fetch('/api/team/members', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId, role: newRole })
      })
      const data = await res.json()
      if (data.success) {
        fetchTeam()
      } else {
        alert(data.message)
      }
    } catch (error) {
      console.error('修改角色失败:', error)
    }
  }

  const removeMember = async (memberId: number) => {
    if (!confirm('确定要移除该成员吗？')) return
    try {
      const res = await fetch(`/api/team/members?memberId=${memberId}`, {
        method: 'DELETE',
        credentials: 'include'
      })
      const data = await res.json()
      if (data.success) {
        fetchTeam()
      } else {
        alert(data.message)
      }
    } catch (error) {
      console.error('移除成员失败:', error)
    }
  }

  const generateAgentCode = async () => {
    if (!team) return
    try {
      const res = await fetch('/api/team', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId: team.id, generateAgentCode: true })
      })
      const data = await res.json()
      if (data.success) {
        setAgentCode(data.agentCode)
      } else {
        alert(data.message)
      }
    } catch (error) {
      console.error('生成代理码失败:', error)
    }
  }

  const copyAgentCode = () => {
    if (agentCode) {
      navigator.clipboard.writeText(agentCode)
      alert('代理邀请码已复制')
    }
  }

  const getRoleLabel = (role: string) => {
    const labels: Record<string, string> = {
      leader: '团长',
      manager: '管理员',
      operator: '运营',
      viewer: '观察者'
    }
    return labels[role] || role
  }

  const canManage = userRole === 'leader' || userRole === 'manager'

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-gray-500">加载中...</div>
      </div>
    )
  }

  if (!team) {
    return (
      <div className="p-8">
        <div className="max-w-2xl mx-auto">
          <h1 className="text-2xl font-bold mb-8">团队管理</h1>
          <div className="bg-white rounded-lg shadow p-8 text-center">
            <p className="text-gray-500 mb-6">您还没有创建或加入团队</p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              创建团队
            </button>
          </div>
        </div>

        {showCreateModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center">
            <div className="bg-white rounded-lg p-6 w-96">
              <h2 className="text-xl font-bold mb-4">创建团队</h2>
              <input
                type="text"
                value={newTeamName}
                onChange={(e) => setNewTeamName(e.target.value)}
                placeholder="请输入团队名称"
                className="w-full px-3 py-2 border rounded-lg mb-4"
              />
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
                >
                  取消
                </button>
                <button
                  onClick={createTeam}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  创建
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-2xl font-bold">团队管理 - {team.name}</h1>
          <div className="flex gap-3">
            <button
              onClick={() => {
                setShowAddMemberModal(true)
                setNewMemberUsername('')
                setNewMemberRole('viewer')
              }}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
            >
              添加成员
            </button>
            {canManage && (
              <button
                onClick={generateAgentCode}
                className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
              >
                生成代理邀请码
              </button>
            )}
          </div>
        </div>

        {agentCode && (
          <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 mb-6">
            <p className="text-purple-800 font-medium mb-2">代理邀请码</p>
            <div className="flex items-center gap-3">
              <code className="text-2xl font-bold text-purple-600">{agentCode}</code>
              <button
                onClick={copyAgentCode}
                className="px-3 py-1 text-sm bg-purple-200 text-purple-800 rounded hover:bg-purple-300"
              >
                复制
              </button>
              <button
                onClick={() => setAgentCode(null)}
                className="text-purple-600 hover:text-purple-800"
              >
                关闭
              </button>
            </div>
            <p className="text-purple-600 text-sm mt-2">使用此邀请码注册的用户将自动加入您的团队</p>
          </div>
        )}

        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">成员</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">角色</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">邮箱</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">加入时间</th>
                {canManage && <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">操作</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {team.members?.map((member) => (
                <tr key={member.id}>
                  <td className="px-6 py-4">
                    <div className="font-medium">{member.user.name || member.user.username}</div>
                    <div className="text-sm text-gray-500">@{member.user.username}</div>
                  </td>
                  <td className="px-6 py-4">
                    {canManage && member.role !== 'leader' ? (
                      <select
                        value={member.role}
                        onChange={(e) => updateMemberRole(member.id, e.target.value)}
                        className="px-2 py-1 border rounded"
                      >
                        <option value="viewer">观察者</option>
                        <option value="operator">运营</option>
                        <option value="manager">管理员</option>
                      </select>
                    ) : (
                      <span className={`px-2 py-1 rounded text-sm ${
                        member.role === 'leader' ? 'bg-blue-100 text-blue-800' :
                        member.role === 'manager' ? 'bg-green-100 text-green-800' :
                        'bg-gray-100 text-gray-800'
                      }`}>
                        {getRoleLabel(member.role)}
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-gray-500">{member.user.email}</td>
                  <td className="px-6 py-4 text-gray-500">
                    {new Date(member.user.createdAt).toLocaleDateString()}
                  </td>
                  {canManage && (
                    <td className="px-6 py-4 text-right">
                      {member.role !== 'leader' && (
                        <button
                          onClick={() => removeMember(member.id)}
                          className="text-red-600 hover:text-red-800"
                        >
                          移除
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showAddMemberModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center">
          <div className="bg-white rounded-lg p-6 w-96">
            <h2 className="text-xl font-bold mb-4">添加团队成员</h2>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">用户名</label>
              <input
                type="text"
                value={newMemberUsername}
                onChange={(e) => setNewMemberUsername(e.target.value)}
                placeholder="请输入用户名"
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">角色</label>
              <select
                value={newMemberRole}
                onChange={(e) => setNewMemberRole(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg"
              >
                <option value="viewer">观察者</option>
                <option value="operator">运营</option>
                <option value="manager">管理员</option>
              </select>
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowAddMemberModal(false)}
                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
              >
                取消
              </button>
              <button
                onClick={addMember}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
              >
                添加
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}