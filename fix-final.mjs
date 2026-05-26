import fs from 'fs'
const base = 'D:/AiMarketing/src/app'

const files = [
  'ai-agent/page.tsx',
  'ai-agent/[id]/page.tsx',
  'ai-copy/page.tsx',
  'projects/page.tsx',
  'register/page.tsx',
  'team/page.tsx',
  'video-edit/page.tsx',
]

files.forEach(rel => {
  const p = base + '/' + rel
  let c = fs.readFileSync(p, 'utf8')
  const orig = c

  // Only fix import double brace: "} } from" or "} from" with newline
  c = c.replace(/(\}\s*)\}\s*from/g, '$1from')

  // Remove , "info" from showToast
  c = c.replace(/showToast\(([^,]+),\s*"info"\)/g, 'showToast($1)')

  // Remove any misplaced showToast import
  c = c.replace(/^import \{ showToast \} from '@\/components\/Toast'.*$/gm, '')

  // Add proper import if showToast is used but not imported
  if (c.includes('showToast(') && !c.includes("from '@/components/Toast'")) {
    c = c.replace(/^import/, "import { showToast } from '@/components/Toast'\nimport")
  }

  if (c !== orig) {
    fs.writeFileSync(p, c)
    console.log('Fixed:', rel)
  } else {
    console.log('No change:', rel)
  }
})

console.log('DONE')
