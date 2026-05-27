import fs from 'fs'
let c = fs.readFileSync('D:/AiMarketing/src/app/auto-compile/page.tsx', 'utf8')

// Remove everything from '选择终端客户' backwards to find the {showPushDlg start
const dlgStart = c.indexOf('选择终端客户')
if (dlgStart < 0) { console.log('no dialog'); process.exit(1) }

// Find the start: walk back to find `showPushDlg && <div`
const startMarker = 'setShowPushDlg(false)}'
const st = c.lastIndexOf(startMarker, dlgStart)
if (st < 0) { console.log('bad start at', dlgStart); process.exit(1) }

// Find the actual start: {showPushDlg && <div style="fixed
const actualStart = c.lastIndexOf('showPushDlg', st)
const realStart = actualStart - 1 // the '{' before showPushDlg

// Find the end: the closing of the entire dialog: </div>}
let pos = st
let depth = 0
for (let i = st; i < c.length; i++) {
  if (c[i] === '{' || c[i] === '<') { /* ignore for simple matching */ }
  if (c[i] === '}' && depth === 0) { pos = i; break }
  if (c[i] === '}') depth--
}

// Remove the broken dialog
c = c.slice(0, realStart) + c.slice(pos + 1)

// Insert dialog in the right place - before the last </div> of root
const rootEnd = c.lastIndexOf('</div>')
const dialogHtml = `\n\n            {showPushDlg && <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center" onClick={()=>setShowPushDlg(false)}>\n              <div className="card-glass p-6 rounded-xl max-w-md w-full mx-4" onClick={e=>e.stopPropagation()}>\n                <h3 className="text-sm font-bold text-white mb-4">选择终端客户</h3>\n                {clients.length===0 ? <p className="text-xs text-gray-500 py-4">暂无终端客户</p> : (\n                  <div className="max-h-60 overflow-y-auto space-y-2 mb-4">\n                    {clients.map(cl => (\n                      <button key={cl.id} onClick={()=>setPushClient(cl)} className={\`w-full text-left p-3 rounded-lg border text-xs transition \${pushClient?.id===cl.id?"bg-emerald-500/20 border-emerald-500/30 text-emerald-400":"bg-white/5 border-white/10 text-gray-300 hover:bg-white/10"\`}>{cl.name||cl.username}<span className="text-gray-500 ml-2">(#{cl.id})</span></button>\n                    ))}\n                  </div>\n                )}\n                <div className="flex gap-2">\n                  <button onClick={()=>{setShowPushDlg(false);setPushClient(null)}} className="flex-1 py-2 bg-white/5 text-gray-400 rounded-lg text-xs">取消</button>\n                  <button disabled={!pushClient||pushLoading} onClick={async()=>{if(!pushClient)return;setPushLoading(true);try{const r=await fetch('/api/video/push-to-account',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({taskId:videoUrl.split('id=')[1]||videoUrl,endUserId:pushClient.id,remark:pushClient.name||pushClient.username})});const d=await r.json();if(d.success)showToast(\`已推送 \${d.data.pushed}/\${d.data.total} 台设备\`,'success');else showToast(d.message||'推送失败','error')}catch(e:any){showToast('推送失败: '+e.message,'error')}setShowPushDlg(false);setPushClient(null);setPushLoading(false)}} className={\`flex-1 py-2 rounded-lg text-xs \${pushClient?"bg-emerald-500/20 text-emerald-400 border border-emerald-500/30":"bg-white/5 text-gray-500"\`}>{pushLoading?'推送中...':'确认推送'}</button>\n                </div>\n              </div>\n            </div>}\n`
c = c.slice(0, rootEnd) + dialogHtml + c.slice(rootEnd)

fs.writeFileSync('D:/AiMarketing/src/app/auto-compile/page.tsx', c)
console.log('Fixed')
