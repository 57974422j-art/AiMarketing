import fs from 'fs'
let c = fs.readFileSync('D:/AiMarketing/src/app/auto-compile/page.tsx', 'utf8')

// 1. Add useAuth import
c = c.replace("import { showToast } from '@/components/Toast'", "import { showToast } from '@/components/Toast'\nimport { useAuth } from '@/app/providers'")

// 2. Add state vars after colorFilter
c = c.replace(
  "const [colorFilter, setColorFilter] = useState('')",
  "const [colorFilter, setColorFilter] = useState('')\n  const { user } = useAuth()\n  const [showPushDlg, setShowPushDlg] = useState(false)\n  const [clients, setClients] = useState<any[]>([])\n  const [pushClient, setPushClient] = useState<any>(null)\n  const [pushLoading, setPushLoading] = useState(false)"
)

// 3. Add push button after save button
c = c.replace(
  '<button onClick={()=>saveToStorage(videoUrl)} className="flex-1 py-2 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-lg hover:bg-emerald-500/30 text-xs">📦 保存到仓库</button>',
  '<button onClick={()=>saveToStorage(videoUrl)} className="flex-1 py-2 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-lg hover:bg-emerald-500/30 text-xs">📦 保存到仓库</button>\n            {user?.role !== \'end-user\' && <button onClick={()=>{fetch(\'/api/clients\').then(r=>r.json()).then(d=>{if(d.success){setClients(d.data);setShowPushDlg(true)}}).catch(()=>showToast(\'获取客户列表失败\',\'error\'))}} className="flex-1 py-2 bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded-lg hover:bg-blue-500/30 text-xs">📤 推送到账号</button>}'
)

// 4. Add push dialog before last </div> of root
const rootEnd = c.lastIndexOf('</div>')
const dialog = `
            {showPushDlg && <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center" onClick={()=>setShowPushDlg(false)}>
              <div className="card-glass p-6 rounded-xl max-w-md w-full mx-4" onClick={e=>e.stopPropagation()}>
                <h3 className="text-sm font-bold text-white mb-4">选择终端客户</h3>
                {clients.length===0 ? <p className="text-xs text-gray-500 py-4">暂无终端客户</p> : (
                  <div className="max-h-60 overflow-y-auto space-y-2 mb-4">
                    {clients.map(cl => (
                      <button key={cl.id} onClick={()=>setPushClient(cl)} className={\`w-full text-left p-3 rounded-lg border text-xs transition \${pushClient?.id===cl.id?"bg-emerald-500/20 border-emerald-500/30 text-emerald-400":"bg-white/5 border-white/10 text-gray-300 hover:bg-white/10"\`}>{cl.name||cl.username}<span className="text-gray-500 ml-2">(#{cl.id})</span></button>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <button onClick={()=>{setShowPushDlg(false);setPushClient(null)}} className="flex-1 py-2 bg-white/5 text-gray-400 rounded-lg text-xs">取消</button>
                  <button disabled={!pushClient||pushLoading} onClick={async()=>{
                    if(!pushClient)return;setPushLoading(true);
                    try{const r=await fetch('/api/video/push-to-account',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({taskId:videoUrl.split('id=')[1]||videoUrl,endUserId:pushClient.id,remark:pushClient.name||pushClient.username})});const d=await r.json();if(d.success)showToast(\`已推送 \${d.data.pushed}/\${d.data.total} 台设备\`,'success');else showToast(d.message||'推送失败','error')}catch(e:any){showToast('推送失败: '+e.message,'error')}
                    setShowPushDlg(false);setPushClient(null);setPushLoading(false)
                  }} className={\`flex-1 py-2 rounded-lg text-xs \${pushClient?"bg-emerald-500/20 text-emerald-400 border border-emerald-500/30":"bg-white/5 text-gray-500"\`}>{pushLoading?'推送中...':'确认推送'}</button>
                </div>
              </div>
            </div>}
`
c = c.slice(0, rootEnd) + dialog + c.slice(rootEnd)

fs.writeFileSync('D:/AiMarketing/src/app/auto-compile/page.tsx', c)
console.log('Done')
