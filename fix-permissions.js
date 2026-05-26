const fs = require('fs')
const base = 'D:/AiMarketing'

function fix(path, ...replaces) {
  let c = fs.readFileSync(base + path, 'utf8')
  for (const [from, to] of replaces) c = c.replace(from, to)
  fs.writeFileSync(base + path, c)
  console.log('done: ' + path)
}

// 1
fix('/src/app/api/video/route.ts',
  ["['viewer', 'editor', 'admin'].includes(role)", "['end-user', 'viewer', 'editor', 'admin'].includes(role)"])

// 2
fix('/src/app/api/ai-agent/route.ts',
  ["['viewer', 'editor', 'admin'].includes(role)", "['end-user', 'viewer', 'editor', 'admin'].includes(role)"],
  ["['editor', 'admin'].includes(role)", "['end-user', 'editor', 'admin'].includes(role)"])

// 3
fix('/src/app/api/dashboard/route.ts',
  ["['viewer', 'editor', 'admin'].includes(role)", "['end-user', 'viewer', 'editor', 'admin'].includes(role)"])

// 4
fix('/src/app/api/projects/route.ts',
  ["['viewer', 'editor', 'admin'].includes(role)", "['end-user', 'viewer', 'editor', 'admin'].includes(role)"],
  ["['editor', 'admin'].includes(role)", "['end-user', 'editor', 'admin'].includes(role)"])

// 5
fix('/src/app/api/ai-copy/route.ts',
  ["['editor', 'admin'].includes(role)", "['end-user', 'editor', 'admin'].includes(role)"])

// 6 - automation-tasks: check if end-user is blocked
let c = fs.readFileSync(base + '/src/app/api/automation-tasks/route.ts', 'utf8')
const blockStart = c.indexOf("auth.role === 'end-user'")
if (blockStart >= 0) {
  const blockEnd = c.indexOf('}', blockStart) + 1
  c = c.slice(0, blockStart) + c.slice(blockEnd)
  fs.writeFileSync(base + '/src/app/api/automation-tasks/route.ts', c)
  console.log('done: automation-tasks (removed end-user block)')
} else {
  console.log('automation-tasks: no end-user block found')
}

console.log('ALL DONE')
