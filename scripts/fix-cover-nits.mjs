import fs from 'fs'
const p = 'src/app/api/agent/chat/route.ts'
let c = fs.readFileSync(p, 'utf8')
const old1 = "                              while (!covDone) {"
const new1 = "                              let covWait = 0\n                              while (!covDone && covWait < 120) {"
if (c.includes(old1)) { c = c.replace(old1, new1, 1); console.log('轮询上限 OK') }
const old2 = "console.log('[封面异步] \u751f\u6210 FAILED\u2014\u2014\u91cd\u8bd5\u4e00\u6b21:', tid)"
const new2 = "console.log('[封面异步] \u751f\u6210 FAILED\u2014\u2014\u8bf7\u6362\u4e00\u6279\u91cd\u505a:', tid)"
if (c.includes(old2)) { c = c.replace(old2, new2, 1); console.log('FAILED 注释 OK') }
const old3 = "if (dm5) { const dp5 = JSON.parse(String(dm5.content).replace(/^\u53d1\u5e03\u8349\u7a3f:/, '') || '{}'); await prisma.agentMemory.update({ where: { id: dm5.id }, data: { content: '\u53d1\u5e03\u8349\u7a3f:' + JSON.stringify(Object.assign({}, dp5, { coverUrl: covU })) } }).catch(() => {}) }"
const new3 = "if (dm5) { const dp5 = JSON.parse(String(dm5.content).replace(/^\u53d1\u5e03\u8349\u7a3f:/, '') || '{}'); if (dp5.videoName === vPick) { await prisma.agentMemory.update({ where: { id: dm5.id }, data: { content: '\u53d1\u5e03\u8349\u7a3f:' + JSON.stringify(Object.assign({}, dp5, { coverUrl: covU })) } }).catch(() => {}) } }"
if (c.includes(old3)) { c = c.replace(old3, new3, 1); console.log('竞态校验 OK') }
const old4 = "await new Promise((r) => setTimeout(r, 10000))"
if (c.includes(old4)) { c = c.replace(old4, "covWait += 10\n                                await new Promise((r) => setTimeout(r, 10000))", 1); console.log('wait 计数 OK') }
fs.writeFileSync(p, c)
