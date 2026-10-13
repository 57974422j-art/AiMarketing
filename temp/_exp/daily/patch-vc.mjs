#!/usr/bin/env node
/**
 * temp/_exp/daily/patch-vc.mjs —— 把**已生成的产物**里切分块的"半尺寸"就地补全（★VF_DAILY_V18）。
 * =============================================================================
 * 已被引擎修好（figHTML 里 slats/blinds 现在都写全四边）；本脚本是**存量文件**的补救：
 *   用户在盘上已有的 gen_*.html 不用重跑 AI，一条命令就能让 4/5/10/11 段出图。
 * 规则（只看内联 style，不动别的）：
 *   · `width:` 有、`height:` 无 ⇒ 是条分 ⇒ 补 `top:0;height:100%;`
 *   · `height:` 有、`width:` 无 ⇒ 是百叶 ⇒ 补 `left:0;width:100%;`
 *   · 两者都有（拼片）⇒ 不动
 * 用法：node temp/_exp/daily/patch-vc.mjs <a.html> [b.html ...]
 */
import fs from 'node:fs'

let total = 0
for (const f of process.argv.slice(2)) {
  if (!fs.existsSync(f)) { console.log('  跳过（不存在）：' + f); continue }
  const src = fs.readFileSync(f, 'utf8')
  let n1 = 0
  let n2 = 0
  const out = src.replace(/<i class="vc"([^>]*?)style="([^"]*)"/g, (m, mid, st) => {
    const hasW = /(^|;)width:/.test(st)
    const hasH = /(^|;)height:/.test(st)
    if (hasW && !hasH) { n1++; return `<i class="vc"${mid}style="top:0;height:100%;${st}"` }
    if (hasH && !hasW) { n2++; return `<i class="vc"${mid}style="left:0;width:100%;${st}"` }
    return m
  })
  if (n1 + n2 === 0) { console.log('  ' + f.split(/[\\/]/).pop() + '：没有需要补的切分块'); continue }
  fs.writeFileSync(f, out, 'utf8')
  total += n1 + n2
  console.log(`  ${f.split(/[\\/]/).pop()}：条分补高 ${n1} 条 · 百叶补宽 ${n2} 条`)
}
console.log('  合计修补 ' + total + ' 个切分块' + (total ? '' : '（无需修补）'))
