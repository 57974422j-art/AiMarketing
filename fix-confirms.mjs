import fs from 'fs'
import path from 'path'

const dir = 'D:/AiMarketing/src/app'
const files = []

function walk(d) {
  fs.readdirSync(d).forEach(f => {
    const p = path.join(d, f)
    if (fs.statSync(p).isDirectory() && !f.startsWith('.')) walk(p)
    else if (f.endsWith('.tsx') || f.endsWith('.ts')) files.push(p)
  })
}
walk(dir)

// collect file content
const fileData = files.map(f => ({ path: f, content: fs.readFileSync(f, 'utf8') }))

// Find all if(!confirm( patterns
fileData.forEach(({ path: file, content: c }) => {
  const matches = [...c.matchAll(/if\s*\(!confirm\s*\([^)]+\)\)\s*return/g)]
  if (matches.length > 0) {
    console.log('\n' + path.relative(dir, file))
    matches.forEach(m => console.log('  ' + m[0].slice(0, 80)))
  }
})

console.log('\n--- Manual replacement needed for', fileData.reduce((s,{content:c}) => s + [...c.matchAll(/if\s*\(!confirm\s*\([^)]+\)\)\s*return/g)].length, 0), 'occurrences ---')
