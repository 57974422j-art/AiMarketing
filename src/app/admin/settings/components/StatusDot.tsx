import { type StatusMap } from '../types'

interface StatusDotProps {
  name: string
  statusMap: StatusMap
}

export default function StatusDot({ name, statusMap }: StatusDotProps) {
  const s = statusMap[name]
  if (!s) return <span className="inline-flex items-center gap-1 text-xs text-gray-500 ml-2 px-2 py-0.5 rounded-full bg-white/5"><span className="w-1.5 h-1.5 rounded-full bg-gray-500" /><span>未配置</span><span className="text-[10px] opacity-50 ml-1">/ OFF</span></span>
  if (s === 'ok') return <span className="inline-flex items-center gap-1 text-xs text-emerald-400 ml-2 px-2 py-0.5 rounded-full bg-emerald-500/10"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /><span>已连接</span><span className="text-[10px] opacity-50 ml-1">/ OK</span></span>
  if (s === 'fail') return <span className="inline-flex items-center gap-1 text-xs text-red-400 ml-2 px-2 py-0.5 rounded-full bg-red-500/10"><span className="w-1.5 h-1.5 rounded-full bg-red-400" /><span>连接失败</span><span className="text-[10px] opacity-50 ml-1">/ FAIL</span></span>
  return null
}
