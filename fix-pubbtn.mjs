import fs from 'fs'
let c = fs.readFileSync('D:/AiMarketing/src/lib/douyin-automation.ts', 'utf8')
c = c.replace(
  '// 坐标兜底：底部居中区域\n    await UI.tap(apiPort, 540, 1830)',
  '// 通过UI元素动态定位底部导航栏\n    const screenData = await UI.extractScreenData(apiPort)\n    const texts = (screenData.data as any)?.clickableTexts || []\n    let navY = 0; let tapX = 540\n    for (const txt of texts) {\n      if (txt.includes(\'首页\')) { const f = await UI.findByText(apiPort, txt); if (f?.center) navY = f.center.y }\n      if (txt === \'消息\' || txt === \'我\') { const f = await UI.findByText(apiPort, txt); if (f?.center) tapX = Math.round(f.center.x * 0.45) }\n    }\n    await UI.tap(apiPort, tapX, navY || 1830)'
)
fs.writeFileSync('D:/AiMarketing/src/lib/douyin-automation.ts', c)
console.log('ok')
