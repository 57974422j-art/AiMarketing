import fs from 'fs'
import { execSync } from 'child_process'
// ① client-info 加 buildCommit（git HEAD——每次部署变——前端校验用）
const cp = 'src/app/api/client-info/route.ts'
let cc = fs.readFileSync(cp, 'utf8')
const oldC = "        version: version.version,"
const newC = "        version: version.version,\n        buildCommit: (process.env.BUILD_COMMIT || (function(){ try { return execSync('git rev-parse --short HEAD', { cwd: process.cwd(), encoding: 'utf8' }).trim() } catch (e) { return 'dev' } })()),"
if (cc.includes(oldC)) { cc = cc.replace(oldC, newC, 1); fs.writeFileSync(cp, cc); console.log('client-info buildCommit OK') }
// ② 前端校验改 buildCommit
const pf = 'src/app/agent/page.tsx'
let pc = fs.readFileSync(pf, 'utf8')
const oldV = "        const v = vj?.data?.version || ''"
const newV = "        const v = vj?.data?.buildCommit || vj?.data?.version || ''"
if (pc.includes(oldV)) { pc = pc.replace(oldV, newV, 1); fs.writeFileSync(pf, pc); console.log('前端校验 buildCommit OK') }
