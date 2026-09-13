import fs from 'fs'
// ① 前端 select_video 卡片：点击发完整视频名（不编号）
const pf = 'src/app/agent/page.tsx'
let pc = fs.readFileSync(pf, 'utf8')
const old1 = "onClick={() => sendMessage(String(i + 1))}"
const cnt1 = pc.split(old1).length - 1
if (cnt1 >= 1) { pc = pc.replace(old1, "onClick={() => sendMessage(v.name || String(i + 1))}"); fs.writeFileSync(pf, pc); console.log('前端发完整视频名 OK（' + cnt1 + ' 处）') }
// ② pick 文件名正则放宽（含空格/中文）
const rf = 'src/app/api/agent/chat/route.ts'
let rc = fs.readFileSync(rf, 'utf8')
const old2 = "/^[A-Za-z0-9_-]+\.(?:mp4|mov|avi|mkv|webm)$/i.test(userMessage.trim())"
const new2 = "/^[A-Za-z0-9_\-\u4e00-\u9fa5 ]+\.(?:mp4|mov|avi|mkv|webm)$/i.test(userMessage.trim())"
const cnt2 = rc.split(old2).length - 1
if (cnt2 >= 1) { rc = rc.replaceAll(old2, new2); fs.writeFileSync(rf, rc); console.log('pick 正则放宽 OK（' + cnt2 + ' 处）') }
