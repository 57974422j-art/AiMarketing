// 本地验证封面生成链路（generateImage——image-generator 同款）
import { generateImage } from '../src/lib/ai-providers.ts'
import { config } from 'dotenv'
config({ path: '.env.local' })
const t0 = Date.now()
console.log('[test-cover] 开始生成封面...')
try {
  const r = await generateImage('marketing cover, blue tech style', '768*1344', 'auto')
  console.log('[test-cover] 结果:', r ? JSON.stringify({ url: String(r.url).slice(0, 80), model: r.model }) : 'null（失败）')
  console.log('[test-cover] 耗时:', ((Date.now() - t0) / 1000).toFixed(1) + 's')
} catch (e) { console.error('[test-cover] 异常:', e?.message || e) }
