import fs from 'fs'
const p = 'src/app/agent/page.tsx'
let c = fs.readFileSync(p, 'utf8')
// ① 前端启动版本校验——版本变自动 reload（不用手动刷新——拿新 chunk）
const anchor = "  useEffect(() => {"
const i = c.indexOf(anchor)
if (i < 0) { console.log('锚点未找到'); process.exit(1) }
const verCheck = `  // 2026-09-02: 版本校验自动刷新（部署后新前端——自动 reload 拿新 chunk——不用手动 Ctrl+F5）
  useEffect(() => {
    try {
      fetch('/api/client-info', { credentials: 'include' }).then(r => r.json()).then((vj: any) => {
        const v = vj?.data?.version || ''
        if (v) {
          const oldV = localStorage.getItem('agent_version')
          if (oldV && oldV !== v) { localStorage.setItem('agent_version', v); location.reload() }
          else if (!oldV) localStorage.setItem('agent_version', v)
        }
      }).catch(() => {})
    } catch {}
  }, [])

` + anchor
c = c.slice(0, i) + verCheck + c.slice(i + anchor.length)
fs.writeFileSync(p, c)
console.log('版本校验自动刷新 OK')
