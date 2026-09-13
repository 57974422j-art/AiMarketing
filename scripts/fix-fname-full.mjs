import fs from 'fs'
const p = 'src/app/api/agent/chat/route.ts'
const lines = fs.readFileSync(p, 'utf8').split('\n')
// 找文件名分支（draftW.videoName = userMessage.trim() 后——L2368-2370 临时标记）
let idx = -1
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('draftW.videoName = userMessage.trim()')) { idx = i; break }
}
if (idx < 0) { console.log('未找到'); process.exit(1) }
// L2368-2370（临时标记）→ 完整一次全做（复用编号分支逻辑）
const seg = [
  "                draftW.videoName = userMessage.trim()",
  "                vPick = userMessage.trim()",
  "                try {",
  "                  const frN = await executeToolCall('extract_video_frames', { videoName: vPick }, auth).catch(() => '')",
  "                  const frNs = String(frN)",
  "                  let framesN = []; let visN = ''",
  "                  if (frNs.startsWith('FRAMES_OK:')) { try { const pN = JSON.parse(frNs.slice(10)); framesN = Array.isArray(pN.frames) ? pN.frames : []; visN = pN.visualDesc || '' } catch {} }",
  "                  const nF = []",
  "                  for (const fIt of framesN) {",
  "                    let fpN = String(typeof fIt === 'string' ? fIt : ((fIt || {}).url || ''))",
  "                    try {",
  "                      const fReln = fpN.replace('/api/frames/', '')",
  "                      const fFpn = [path.join(pubRoot, 'frames', fReln), path.join(pubRoot, 'frames', String(auth.userId || 0), fReln)].find((x) => fs.existsSync(x))",
  "                      if (fFpn) { const fKn = 'storage/' + auth.userId + '/frame_' + Date.now() + '_' + path.basename(fReln); await putObject(fKn, fs.readFileSync(fFpn), 'image/jpeg'); fpN = 'https://ai-niuma.cc/api/storage/file?name=' + fKn.replace('storage/' + auth.userId + '/', '') + '&userId=' + (auth.userId || 0) + '&persist=1' }",
  "                    } catch {}",
  "                    nF.push(typeof fIt === 'string' ? fpN : Object.assign({}, fIt, { url: fpN }))",
  "                  }",
  "                  draftW.frames = nF; draftW.visualDesc = visN",
  "                  const vdT2 = String(visN || vPick).replace(/\s+/g, ' ').slice(0, 40)",
  "                  const kwM2 = vdT2.match(/(?:展示|演示|是一个|呈现|画面)[::：]?\s*([^，。；\n]{2,20})/) || vdT2.match(/([^，。；\n]{4,16})/)",
  "                  const kwN2 = (kwM2 && kwM2[1] ? kwM2[1] : vdT2).slice(0, 14)",
  "                  const titlesN2 = ['【文案1】' + kwN2 + '——3秒看懂核心', '【文案2】' + kwN2 + '，原来还能这样用', '【文案3】揭秘' + kwN2 + '的细节']",
  "                  const topicsN2 = '#短视频 #精品内容 #AI工具'",
  "                  draftW.titles = titlesN2.join('\n'); draftW.topics = topicsN2",
  "                  let covN2 = ''",
  "                  try { const covR2 = await dashscopeGenerateImageAsync((visN.slice(0, 200) + '，营销封面风格，标题文字：' + kwN2).trim() || '营销封面', '720*1440'); if (covR2 && covR2.taskId) { const tid2 = covR2.taskId; setTimeout(async () => { try { let w2 = 0; while (w2 < 120) { w2 += 10; await new Promise((r) => setTimeout(r, 10000)); const qt2 = await fetch('https://dashscope.aliyuncs.com/api/v1/tasks/' + tid2, { headers: { Authorization: 'Bearer ' + process.env.DASHSCOPE_API_KEY }, signal: AbortSignal.timeout(20000) }).then((r) => r.json()).catch(() => null); if (qt2 && qt2.output && qt2.output.task_status === 'SUCCEEDED') { const u2 = qt2.output.results && qt2.output.results[0] ? qt2.output.results[0].url : ''; if (u2) { try { const cR2 = await fetch(u2, { signal: AbortSignal.timeout(30000) }).catch(() => null); if (cR2 && cR2.ok) { const cB2 = Buffer.from(await cR2.arrayBuffer()); const cK2 = 'storage/' + (auth.userId || 0) + '/cover_' + Date.now() + '.jpg'; await putObject(cK2, cB2, 'image/jpeg'); const cU2 = 'https://ai-niuma.cc/api/storage/file?name=' + cK2.replace('storage/' + (auth.userId || 0) + '/', '') + '&userId=' + (auth.userId || 0) + '&persist=1'; const dm6 = await prisma.agentMemory.findFirst({ where: { userId: String(auth.userId || 0), tags: { contains: 'pub_draft' } } }); if (dm6) { const dp6 = JSON.parse(String(dm6.content).replace(/^发布草稿:/, '') || '{}'); if (dp6.videoName === vPick) { await prisma.agentMemory.update({ where: { id: dm6.id }, data: { content: '发布草稿:' + JSON.stringify(Object.assign({}, dp6, { coverUrl: cU2 })) } }).catch(() => {}) } } } } catch {} } break } else if (qt2 && qt2.output && qt2.output.task_status === 'FAILED') break } } catch {} }, 10) } } catch {}",
  "                  draftW.coverUrl = covN2; draftW.step = 'full'",
  "                  try { prisma.agentMemory.updateMany({ where: { userId: String(auth.userId || 0), tags: { contains: 'pub_draft' } }, data: { content: '发布草稿:' + JSON.stringify(draftW) } }).catch(() => {}) } catch {}",
  "                  wfEarlyReply = 'WF_JSON:' + JSON.stringify({ step: 'full', videoName: vPick, frames: nF, titles: titlesN2, topics: topicsN2, coverUrl: covN2, hint: '发布方案一次生成完成——确认或「换一批」全重做，最后确认平台发布' })",
  "                } catch (eF2) { console.error('[状态机] 文件名一次全做异常:', (eF2 && eF2.message) || eF2); wfEarlyReply = '素材生成失败——请回「换一批」重做。' }",
]
lines.splice(idx, 4, ...seg)
fs.writeFileSync(p, lines.join('\n'))
console.log('文件名分支一次全做 OK')
