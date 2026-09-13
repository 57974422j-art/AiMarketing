// 用 Node 重写 qwen-vl 段（无 heredoc 转义）
import fs from 'fs'
const p = 'src/app/api/agent/chat/route.ts'
const lines = fs.readFileSync(p, 'utf8').split('\n')
let start = -1
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('const f0fp = nF[0]')) { start = i; break }
}
if (start < 0) { console.log('段起未找到'); process.exit(1) }
// 段尾：下一个 "draftW.titles" 或 "let covN"
let end = -1
for (let j = start; j < lines.length; j++) {
  if (lines[j].includes('draftW.titles') || lines[j].includes('let covN')) { end = j; break }
}
if (end < 0) { console.log('段尾未找到'); process.exit(1) }
const seg = [
  "                        try {",
  "                          const f0u = String(typeof nF[0] === 'string' ? nF[0] : ((nF[0] || {}).url || ''))",
  "                          const f0p2 = f0u ? path.join(pubRoot, 'frames', f0u.replace('/api/frames/', '')) : ''",
  "                          if (f0p2 && fs.existsSync(f0p2)) {",
  "                            const f0b64 = fs.readFileSync(f0p2).toString('base64')",
  "                            const vlMsg = JSON.stringify({ model: 'qwen-vl-max', messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + f0b64 } }, { type: 'text', text: '\u770b\u56fe\u5199 3 \u4e2a\u6807\u9898' }] }], max_tokens: 300 })",
  "                            const vlR = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.DASHSCOPE_API_KEY }, body: vlMsg }).then(function(r) { return r.json() }).catch(function() { return null })",
  "                            const c0 = vlR && vlR.choices && vlR.choices[0] ? vlR.choices[0].message : null",
  "                            const vlText = c0 && c0.content ? String(c0.content) : ''",
  "                            const vlTitles = vlText.split(/\n/).map(function(s2) { return String(s2).replace(/^[0-9]+[.\u3001\uff09\uff09]\s*/, '').trim() }).filter(function(s2) { return s2.length > 4 && s2.length < 40 }).slice(0, 3)",
  "                            if (vlTitles.length >= 2) { titlesN = vlTitles; kwN = String(vlTitles[0]).slice(0, 14) }",
  "                          }",
  "                        } catch (eVL) { console.error('[qwen-vl] \u5f02\u5e38:', (eVL && eVL.message) || eVL) }",
]
lines.splice(start, end - start, ...seg)
fs.writeFileSync(p, lines.join('\n'))
console.log('qwen-vl \u91cd\u5199 OK L' + (start + 1) + '-' + (end + 1))
