#!/usr/bin/env node
/**
 * ★VF_TOOLSYNTAX_V1 —— 工具脚本语法自检（防"静默失败"）
 * =============================================================================
 * 为什么必须有：本项目 **第 3 次** 栽在同一件事上 ——
 *   生成器（pack-to-page / film-to-page）里，注释中写了**反引号**，
 *   而这两个文件整体是模板字符串 ⇒ 反引号直接截断它 ⇒ **SyntaxError**。
 *   后果比普通报错更坏：调用方（或我）**静默**把"生成"当成成功，接着去 check
 *   **旧文件**，于是"验证"验的是过期产物 —— 这种"账撒谎"最难查。
 *
 * 所以：任何一次改动 tools/ 之后，跑一下本脚本（它只做 `node --check`，秒级）。
 * 用法：node tools/selfcheck-tools.mjs
 * 退出码：0 全部通过 · 1 有文件语法错误
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dirs = [path.join(HERE, 'tools'), path.join(HERE, 'tools', 'runtime')]
const files = []
for (const d of dirs) {
  if (!fs.existsSync(d)) continue
  for (const f of fs.readdirSync(d)) if (f.endsWith('.mjs') || f.endsWith('.js')) files.push(path.join(d, f))
}
// 顺带检查风格包 / 四张表的 JSON 是否还能解析（写库之后最容易坏的地方）
const jsonFiles = []
for (const d of [path.join(HERE, 'styles'), path.join(HERE, 'elements'), path.join(HERE, 'films')]) {
  if (!fs.existsSync(d)) continue
  for (const f of fs.readdirSync(d)) if (f.endsWith('.json')) jsonFiles.push(path.join(d, f))
}

let bad = 0
for (const f of files) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' })
  const rel = path.relative(HERE, f)
  if (r.status === 0) console.log('OK   ' + rel)
  else {
    bad++
    console.log('FAIL ' + rel)
    console.log('     ' + String(r.stderr || '').split('\n').slice(0, 4).join('\n     '))
    if (/Unexpected identifier|SyntaxError/.test(String(r.stderr))) {
      console.log('     ↳ 提示：生成器类文件整体是模板字符串，**注释里出现反引号就会报这个**')
    }
  }
}
for (const f of jsonFiles) {
  try { JSON.parse(fs.readFileSync(f, 'utf8')); console.log('OK   ' + path.relative(HERE, f)) }
  catch (e) { bad++; console.log('FAIL ' + path.relative(HERE, f) + '  → ' + e.message) }
}
console.log(`\n共 ${files.length} 个脚本 + ${jsonFiles.length} 个 JSON；失败 ${bad} 个`)
process.exit(bad ? 1 : 0)
