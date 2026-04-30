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

const roleLabels: Record<string, { cn: string; en: string }> = {
  leader: { cn: '团长', en: 'LEADER' },
  manager: { cn: '管理员', en: 'MANAGER' },
  operator: { cn: '运营', en: 'OPERATOR' },
  viewer: { cn: '观察者', en: 'VIEWER' }
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
    if (!confirm('确定要移除该成员吗？/ Remove this member?')) return
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
      alert('代理邀请码已复制 / Agent code copied')
    }
  }

  const getRoleLabel = (role: string) => {
    const r = roleLabels[role]
    return r ? <><span>{r.cn}</span><span className="text-xs opacity-50 ml-1">{r.en}</span></> : role
  }

  const canManage = userRole === 'leader' || userRole === 'manager'

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-400"></div>
          <p className="mt-2 text-gray-400 text-sm">
            <span>加载中</span>
            <span className="text-xs opacity-50 ml-1">/ LOADING...</span>
          </p>
        </div>
      </div>
    )
  }

  if (!team) {
    return (
      <div className="min-h-screen bg-gray-950 p-8">
        <div className="max-w-2xl mx-auto">
          <p className="text-label mb-2">团队管理 / TEAM MANAGEMENT</p>
          <h1 className="text-mono-lg text-white mb-8">团队 / TEAM</h1>
          <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-8 text-center">
            <p className="text-gray-400 mb-2">
              <span>暂无团队</span>
              <span className="opacity-50 ml-1">/ NO TEAM YET</span>
            </p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-6 py-3 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600"
            >
              <span>创建团队</span>
              <span className="text-xs opacity-70 ml-1">CREATE TEAM</span>
            </button>
          </div>
        </div>

        {showCreateModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center">
            <div className="bg-gray-900 rounded-2xl p-6 w-96 border border-white/10">
              <h2 className="text-xl font-bold text-white mb-4">
                <span>创建团队</span>
                <span className="text-sm opacity-50 ml-1">CREATE TEAM</span>
              </h2>
              <input
                type="text"
                value={newTeamName}
                onChange={(e) => setNewTeamName(e.target.value)}
                placeholder="团队名称... / Team name..."
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white mb-4 focus:outline-none focus:border-emerald-500/50"
              />
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 text-gray-400 hover:bg-white/10 rounded-xl"
                >
                  <span>取消</span>
                  <span className="text-xs opacity-50 ml-1">CANCEL</span>
                </button>
                <button
                  onClick={createTeam}
                  className="px-4 py-2 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600"
                >
                  <span>创建</span>
                  <span className="text-xs opacity-70 ml-1">CREATE</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-950 p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <div>
            <p className="text-label mb-2">团队管理 / TEAM MANAGEMENT</p>
            <h1 className="text-mono-lg text-white">
              <span>团队</span>
              <span className="text-sm opacity-50 ml-1">/ TEAM</span> - {team.name}
            </h1>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => {
                setShowAddMemberModal(true)
                setNewMemberUsername('')
                setNewMemberRole('viewer')
              }}
              className="px-4 py-2 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600"
            >
              <span>+ 添加成员</span>
              <span className="text-xs opacity-70 ml-1">ADD MEMBER</span>
            </button>
            {canManage && (
              <button
                onClick={generateAgentCode}
                className="px-4 py-2 bg-purple-500 text-white rounded-xl hover:bg-purple-600"
              >
                <span>生成邀请码</span>
                <span className="text-xs opacity-70 ml-1">CODE</span>
              </button>
            )}
          </div>
        </div>

        {agentCode && (
          <div className="bg-purple-500/10 border border-purple-500/20 rounded-2xl p-4 mb-6">
            <p className="text-purple-400 font-medium mb-2">
              <span>代理邀请码</span>
              <span className="text-sm opacity-70 ml-1">/ AGENT INVITE CODE</span>
            </p>
            <div className="flex items-center gap-3">
              <code className="text-2xl font-bold text-purple-400">{agentCode}</code>
              <button
                onClick={copyAgentCode}
                className="px-3 py-1 text-sm bg-purple-500/20 text-purple-300 rounded-lg hover:bg-purple-500/30"
              >
                <span>复制</span>
                <span className="text-xs opacity-50 ml-1">COPY</span>
              </button>
              <button
                onClick={() => setAgentCode(null)}
                className="text-purple-400 hover:text-purple-300"
              >
                <span>关闭</span>
                <span className="text-xs opacity-50 ml-1">CLOSE</span>
              </button>
            </div>
            <p className="text-purple-400 text-sm mt-2">
              <span>使用此码注册的用户将加入您的团队</span>
              <span className="opacity-70 ml-1">/ USERS WITH THIS CODE WILL JOIN YOUR TEAM</span>
            </p>
          </div>
        )}

        <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 overflow-hidden">
          <table className="w-full">
            <thead className="bg-white/5">
              <tr>
                <th className="px-6 py-4 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                  <span>成员</span>
                  <span className="opacity-50 ml-1">MEMBER</span>
                </th>
                <th className="px-6 py-4 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                  <span>角色</span>
                  <span className="opacity-50 ml-1">ROLE</span>
                </th>
                <th className="px-6 py-4 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                  <span>邮箱</span>
                  <span className="opacity-50 ml-1">EMAIL</span>
                </th>
                <th className="px-6 py-4 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                  <span>加入日期</span>
                  <span className="opacity-50 ml-1">JOIN DATE</span>
                </th>
                {canManage && (
                  <th className="px-6 py-4 text-right text-xs font-medium text-gray-400 uppercase tracking-wider">
                    <span>操作</span>
                    <span className="opacity-50 ml-1">ACTION</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {team.members?.map((member) => (
                <tr key={member.id} className="hover:bg-white/5">
                  <td className="px-6 py-4">
                    <div className="font-medium text-white">{member.user.name || member.user.username}</div>
                    <div className="text-sm text-gray-500">@{member.user.username}</div>
                  </td>
                  <td className="px-6 py-4">
                    {canManage && member.role !== 'leader' ? (
                      <select
                        value={member.role}
                        onChange={(e) => updateMemberRole(member.id, e.target.value)}
                        className="px-2 py-1 bg-white/5 border border-white/10 rounded text-white text-sm"
                      >
                        <option value="viewer" className="bg-gray-900">观察者 / VIEWER</option>
                        <option value="operator" className="bg-gray-900">运营 / OPERATOR</option>
                        <option value="manager" className="bg-gray-900">管理员 / MANAGER</option>
                      </select>
                    ) : (
                      <span className={`px-2 py-1 rounded text-sm ${
                        member.role === 'leader' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' :
                        member.role === 'manager' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' :
                        'bg-gray-500/20 text-gray-400 border border-gray-500/30'
                      }`}>
                        {getRoleLabel(member.role)}
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-gray-400">{member.user.email}</td>
                  <td className="px-6 py-4 text-gray-400">
                    {new Date(member.user.createdAt).toLocaleDateString()}
                  </td>
                  {canManage && (
                    <td className="px-6 py-4 text-right">
                      {member.role !== 'leader' && (
                        <button
                          onClick={() => removeMember(member.id)}
                          className="text-red-400 hover:text-red-300"
                        >
                          <span>移除</span>
                          <span className="text-xs opacity-50 ml-1">REMOVE</span>
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
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center">
          <div className="bg-gray-900 rounded-2xl p-6 w-96 border border-white/10">
            <h2 className="text-xl font-bold text-white mb-4">
              <span>添加团队成员</span>
              <span className="text-sm opacity-50 ml-1">ADD MEMBER</span>
            </h2>
            <div className="mb-4">
              <label className="block text-sm text-gray-400 mb-1">
                <span>用户名</span>
                <span className="opacity-50 ml-1">USERNAME</span>
              </label>
              <input
                type="text"
                value={newMemberUsername}
                onChange={(e) => setNewMemberUsername(e.target.value)}
                placeholder="输入用户名... / Enter username..."
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white focus:outline-none focus:border-emerald-500/50"
              />
            </div>
            <div className="mb-4">
              <label className="block text-sm text-gray-400 mb-1">
                <span>角色</span>
                <span className="opacity-50 ml-1">ROLE</span>
              </label>
              <select
                value={newMemberRole}
                onChange={(e) => setNewMemberRole(e.target.value)}
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white focus:outline-none focus:border-emerald-500/50"
              >
                <option value="viewer" className="bg-gray-900">观察者 / VIEWER</option>
                <option value="operator" className="bg-gray-900">运营 / OPERATOR</option>
                <option value="manager" className="bg-gray-900">管理员 / MANAGER</option>
              </select>
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowAddMemberModal(false)}
                className="px-4 py-2 text-gray-400 hover:bg-white/10 rounded-xl"
              >
                <span>取消</span>
                <span className="text-xs opacity-50 ml-1">CANCEL</span>
              </button>
              <button
                onClick={addMember}
                className="px-4 py-2 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600"
              >
                <span>添加</span>
                <span className="text-xs opacity-70 ml-1">ADD</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
