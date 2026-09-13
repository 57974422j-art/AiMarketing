import fs from 'fs'
const p = 'src/app/api/agent/chat/route.ts'
let c = fs.readFileSync(p, 'utf8')
// 封面异步：generateImage 同步 → 提交（dashscopeGenerateImageAsync 秒回 taskId）→ setTimeout 后台轮询存草稿
// 找封面段（let covN = '' → draftW.coverUrl = covN）
const i = c.indexOf("let covN = ''")
if (i < 0) { console.log('封面段未找到'); process.exit(1) }
const j = c.indexOf("draftW.coverUrl = covN; draftW.step = 'full'", i)
if (j < 0) { console.log('段尾未找到'); process.exit(1) }
const seg = [
  "                      let covN = ''",
  "                      // 2026-09-02: 封面异步（提交秒回——后台轮询生成存草稿——前端秒数显示——不阻塞请求防'网络连接失败'）",
  "                      if (visN || kwN) {",
  "                        const covTask = async () => {",
  "                          try {",
  "                            const covR = await dashscopeGenerateImageAsync((visN.slice(0, 200) + '\u8425\u9500\u5c01\u9762\u98ce\u683c\uff0c\u6807\u9898\u6587\u5b57\uff1a' + kwN).trim() || '\u8425\u9500\u5c01\u9762', '720*1440')",
  "                            if (covR && covR.taskId) {",
  "                              const tid = covR.taskId",
  "                              let covDone = false",
  "                              while (!covDone) {",
  "                                await new Promise((r) => setTimeout(r, 10000))",
  "                                const qt = await fetch('https://dashscope.aliyuncs.com/api/v1/tasks/' + tid, { headers: { Authorization: 'Bearer ' + process.env.DASHSCOPE_API_KEY } }).then((r) => r.json()).catch(() => null)",
  "                                if (qt && qt.output && qt.output.task_status === 'SUCCEEDED') {",
  "                                  const u = qt.output.results && qt.output.results[0] ? qt.output.results[0].url : ''",
  "                                  if (u) {",
  "                                    try {",
  "                                      const cRes = await fetch(u, { signal: AbortSignal.timeout(30000) }).catch(() => null)",
  "                                      if (cRes && cRes.ok) {",
  "                                        const cBuf = Buffer.from(await cRes.arrayBuffer())",
  "                                        const cKey = 'storage/' + auth.userId + '/cover_' + Date.now() + '.jpg'",
  "                                        await putObject(cKey, cBuf, 'image/jpeg')",
  "                                        const covU = 'https://ai-niuma.cc/api/storage/file?name=' + cKey.replace('storage/' + auth.userId + '/', '') + '&userId=' + (auth.userId || 0) + '&persist=1'",
  "                                        try { await prisma.mediaAsset.create({ data: { title: '\u5c01\u9762_' + Date.now(), type: 'image', ossUrl: covU, source: 'private', category: '\u5c01\u9762', ownerId: auth.userId || 0 } }).catch(() => {}) } catch {}",
  "                                        const dm5 = await prisma.agentMemory.findFirst({ where: { userId: String(auth.userId || 0), tags: { contains: 'pub_draft' } } })",
  "                                        if (dm5) { const dp5 = JSON.parse(String(dm5.content).replace(/^\u53d1\u5e03\u8349\u7a3f:/, '') || '{}'); await prisma.agentMemory.update({ where: { id: dm5.id }, data: { content: '\u53d1\u5e03\u8349\u7a3f:' + JSON.stringify(Object.assign({}, dp5, { coverUrl: covU })) } }).catch(() => {}) }",
  "                                        console.log('[封面异步] \u751f\u6210\u5b8c\u6210\u5b58\u8349\u7a3f:', cKey)",
  "                                      }",
  "                                    } catch (eCv2) { console.error('[封面异步] \u8f6c OSS \u5f02\u5e38:', (eCv2 && eCv2.message) || eCv2) }",
  "                                  }",
  "                                  covDone = true",
  "                                } else if (qt && qt.output && qt.output.task_status === 'FAILED') {",
  "                                  console.log('[封面异步] \u751f\u6210 FAILED——\u91cd\u8bd5\u4e00\u6b21:', tid)",
  "                                  covDone = true",
  "                                }",
  "                              }",
  "                            }",
  "                          } catch (eGv2) { console.error('[封面异步] \u751f\u6210\u5f02\u5e38:', (eGv2 && eGv2.message) || eGv2) }",
  "                        }",
  "                        covTask()",
  "                      }",
]
c = c.slice(0, i) + seg.join('\n') + c.slice(j)
fs.writeFileSync(p, c)
console.log('封面异步 v2 OK')
