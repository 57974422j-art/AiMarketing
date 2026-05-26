import fs from 'fs'
const base = 'D:/AiMarketing/src/app'
const files = ['ai-agent/page.tsx','ai-agent/[id]/page.tsx','ai-copy/page.tsx','projects/page.tsx','register/page.tsx','team/page.tsx','video-edit/page.tsx']
files.forEach(rel => {
  const p = base + '/' + rel
  let c = fs.readFileSync(p, 'utf8')
  const o = c
  // Remove ,"info"
  c = c.replace(/showToast\(([^,]+),\s*"info"\)/g, 'showToast($1)')
  // Fix }}
  c = c.replace(/}\s+}/g, '}')
  // Ensure import
  c = c.replace(/^import \{ showToast \} from '@\/components\/Toast'.*$/gm, '')
  if (c.includes('showToast(') && !c.includes("from '@/components/Toast'"))
    c = c.replace(/^(import [^;]+;)/m, "$1\nimport { showToast } from '@/components/Toast'")
  if (c !== o) { fs.writeFileSync(p, c); console.log('Fixed:', rel) }
})
console.log('Done')
