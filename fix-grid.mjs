import fs from 'fs'
let c = fs.readFileSync('D:/AiMarketing/src/app/auto-compile/page.tsx', 'utf8')

// Find the broken grid section
const grid = 'card-glass p-4 grid grid-cols-2 gap-2'
const i = c.indexOf(grid)
if (i < 0) { console.log('Not found'); process.exit() }

// Find the opening <div
const start = c.lastIndexOf('<div', i)
// Find closing </div> of grid
const end = c.indexOf('</div>', i) + 6

const newGrid = [
  '<div className="card-glass p-4 grid grid-cols-2 gap-2">',
  '<div><label className="text-[10px] text-gray-400 mb-1 block">画面比例</label><select className="input-dark w-full text-xs" value={ratio} onChange={e=>setRatio(e.target.value)}><option value="16:9">横屏 16:9</option><option value="9:16">竖屏 9:16</option><option value="1:1">方形 1:1</option><option value="4:3">4:3</option></select></div>',
  '<div><label className="text-[10px] text-gray-400 mb-1 block">分辨率</label><select className="input-dark w-full text-xs" value={resolution} onChange={e=>setResolution(e.target.value)}><option value="1080p">1080p</option><option value="720p">720p</option></select></div>',
  '<div><label className="text-[10px] text-gray-400 mb-1 block">字幕大小</label><select className="input-dark w-full text-xs" value={subtitleSize} onChange={e=>setSubtitleSize(Number(e.target.value))}><option value={28}>小</option><option value={36}>中</option><option value={44}>大</option></select></div>',
  '<div><label className="text-[10px] text-gray-400 mb-1 block">视频时长</label><select className="input-dark w-full text-xs" value={duration} onChange={e=>setDuration(Number(e.target.value))}><option value={15}>15秒</option><option value={30}>30秒</option><option value={45}>45秒</option><option value={60}>60秒</option></select></div>',
  '</div>'
].join('\n            ')

c = c.slice(0, start) + '\n            ' + newGrid + c.slice(end)
fs.writeFileSync('D:/AiMarketing/src/app/auto-compile/page.tsx', c)
console.log('Grid fixed')
