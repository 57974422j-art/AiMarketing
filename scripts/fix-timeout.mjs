import fs from 'fs'
const p = 'src/app/api/agent/chat/route.ts'
let c = fs.readFileSync(p, 'utf8')
// ① 视觉 fetch 加 60s 超时（30s 断根因——qwen-vl 可能挂）
const old1 = "              const vr = await fetch(at.base, {\n                method: 'POST',"
const new1 = "              const vr = await fetch(at.base, {\n                signal: AbortSignal.timeout(60000),\n                method: 'POST',"
if (c.includes(old1)) { c = c.replace(old1, new1, 1); console.log('视觉 fetch 60s 超时 OK') }
// ② ffmpeg execSync 加 timeout（抽帧——可能挂）
const cnt2 = (c.match(/execSync\(`ffmpeg/g) || []).length
console.log('ffmpeg execSync 处:', cnt2)
// 简单：给 ffmpeg execSync 都加 timeout——用正则（危险）——改为逐处（先加第一处）
const old3 = "execSync(`ffmpeg -y -ss ${t.toFixed(2)} -i \"${srcPath}\" -frames:v 1 -vf \"scale=640:-2"
if (c.includes(old3)) { c = c.replace(old3, old3, 1) } // 保持
// 找所有 execSync(`ffmpeg——加 , { timeout: 60000 })
const re = /execSync\(`ffmpeg/g
let m, n = 0
while ((m = re.exec(c)) !== null) {
  // 找该 execSync 的闭括号（`...`)——加 timeout
  const start = m.index
  const endIdx = c.indexOf('`)', start)
  if (endIdx > 0) {
    const seg = c.slice(start, endIdx + 2)
    if (!seg.includes('timeout')) {
      const newSeg = seg.slice(0, -2) + ', { timeout: 60000 })'
      c = c.slice(0, start) + newSeg + c.slice(endIdx + 2)
      n++
    }
  }
  re.lastIndex = start + 1
}
console.log('ffmpeg timeout 加:', n, '处')
fs.writeFileSync(p, c)
