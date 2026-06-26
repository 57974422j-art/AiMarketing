'use client'
import { useState, useEffect } from 'react'
import { useAuth } from '@/app/providers'
import { showToast } from '@/components/Toast'

interface PaymentConfig {
  wechatAppId: string; wechatMchId: string; wechatApiKey: string; wechatEnabled: boolean
  alipayAppId: string; alipayPrivateKey: string; alipayPublicKey: string; alipayEnabled: boolean
}

export default function PaymentSettingsPage() {
  const { user, loading: authLoading } = useAuth()
  const [authorized, setAuthorized] = useState(false)
  const [saving, setSaving] = useState(false)
  const [config, setConfig] = useState<PaymentConfig>({
    wechatAppId: '', wechatMchId: '', wechatApiKey: '', wechatEnabled: false,
    alipayAppId: '', alipayPrivateKey: '', alipayPublicKey: '', alipayEnabled: false,
  })

  useEffect(() => { if (!authLoading) setAuthorized(user?.role === 'admin') }, [authLoading, user])
  useEffect(() => { if (authorized) loadConfig() }, [authorized])

  const loadConfig = async () => {
    try {
      const r = await fetch('/api/admin/payment-settings')
      const d = await r.json()
      if (d.success && d.data) setConfig(d.data)
    } catch {}
  }

  const save = async () => {
    setSaving(true)
    try {
      const r = await fetch('/api/admin/payment-settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      const d = await r.json()
      if (d.success) showToast('✅ 支付配置已保存', 'success')
      else showToast(d.message, 'error')
    } catch { showToast('保存失败', 'error') }
    setSaving(false)
  }

  if (!authorized) return <div className="min-h-screen bg-gray-950 p-8 text-gray-400 text-sm">需要管理员权限</div>

  const field = (label: string, key: keyof PaymentConfig, placeholder: string, isPassword = true) => (
    <div>
      <label className="text-gray-500 text-[10px] block mb-0.5">{label}</label>
      <input className="input-dark w-full text-xs" type={isPassword ? 'password' : 'text'} placeholder={placeholder}
        value={(config as any)[key]}
        onChange={e => setConfig(prev => ({ ...prev, [key]: e.target.value }))} />
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-950 p-6">
      <div className="max-w-4xl mx-auto">
        <p className="text-label mb-1">管理中心 / 支付设置</p>
        <h1 className="text-mono-lg text-white mb-6">💰 支付配置</h1>

        {/* 微信支付 */}
        <div className="card-glass p-5 mb-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="text-lg">💚</span>
              <h3 className="text-sm text-white">微信支付</h3>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <span className="text-[10px] text-gray-500">{config.wechatEnabled ? '已启用' : '已停用'}</span>
              <button onClick={() => setConfig(p => ({ ...p, wechatEnabled: !p.wechatEnabled }))}
                className={`relative w-9 h-5 rounded-full transition ${config.wechatEnabled ? 'bg-emerald-500' : 'bg-white/15'}`}>
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition ${config.wechatEnabled ? 'left-[18px]' : 'left-0.5'}`} />
              </button>
            </label>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {field('AppID', 'wechatAppId', 'wx1234567890')}
            {field('商户号 MchID', 'wechatMchId', '1234567890')}
            {field('API v3 Key', 'wechatApiKey', '32位密钥')}
          </div>
          <p className="text-[9px] text-gray-600 mt-2">获取方式：微信支付商户平台 → 账户中心 → API安全</p>
        </div>

        {/* 支付宝 */}
        <div className="card-glass p-5 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="text-lg">💙</span>
              <h3 className="text-sm text-white">支付宝</h3>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <span className="text-[10px] text-gray-500">{config.alipayEnabled ? '已启用' : '已停用'}</span>
              <button onClick={() => setConfig(p => ({ ...p, alipayEnabled: !p.alipayEnabled }))}
                className={`relative w-9 h-5 rounded-full transition ${config.alipayEnabled ? 'bg-blue-500' : 'bg-white/15'}`}>
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition ${config.alipayEnabled ? 'left-[18px]' : 'left-0.5'}`} />
              </button>
            </label>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {field('AppID', 'alipayAppId', '2021001xxxxx')}
            {field('应用私钥', 'alipayPrivateKey', '-----BEGIN RSA PRIVATE KEY-----')}
            {field('支付宝公钥', 'alipayPublicKey', '-----BEGIN PUBLIC KEY-----')}
          </div>
          <p className="text-[9px] text-gray-600 mt-2">获取方式：支付宝开放平台 → 控制台 → 应用详情 → 开发设置</p>
        </div>

        <button onClick={save} disabled={saving}
          className="px-6 py-2.5 bg-blue-500 text-white rounded-lg text-sm disabled:opacity-50 hover:bg-blue-600 transition">
          {saving ? '...保存中' : '💾 保存配置'}
        </button>

        <div className="mt-4 p-3 bg-yellow-500/5 border border-yellow-500/20 rounded-lg text-[10px] text-yellow-300/70">
          ⚠️ 支付仅支持企业资质。微信需要服务商或直连商户号，支付宝需要签约当面付或手机网站支付。配置后用户端套餐页会自动显示支付按钮。
        </div>
      </div>
    </div>
  )
}
