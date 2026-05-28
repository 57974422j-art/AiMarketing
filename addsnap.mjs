import fs from 'fs'
let c = fs.readFileSync('D:/AiMarketing/src/app/admin/devices/page.tsx', 'utf8')
c = c.replace('编辑</button>', '<button onClick={()=>window.open(`/api/devices/${d.id}/snap`,"_blank")} className="text-[10px] px-1.5 py-0.5 bg-blue-500/20 text-blue-400 rounded hover:bg-blue-500/30" title="远程截图">🖥️</button>编辑</button>')
fs.writeFileSync('D:/AiMarketing/src/app/admin/devices/page.tsx', c)
console.log('Done')
