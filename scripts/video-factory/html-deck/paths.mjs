#!/usr/bin/env node
/**
 * paths.mjs —— **引擎路径的唯一来源**（入库后所有脚本都 import 它，不再各自 `resolve(HERE,'..')`）。
 *
 * 入库布局是**扁平**的（见 README §24.2b / 破题文档 D14 的"决策 A"）：
 *   scripts/video-factory/html-deck/{ *.mjs, masters/, fonts/, examples/, deck.schema.json }
 * 当前开发树则多一层：`probe-hf/{ deck-contract/*.mjs, masters/, fonts/ }`。
 * ⇒ 本模块做**双布局探测**，启动自检**打印解析后的绝对路径**，缺任何一个 ⇒ **红**。
 *
 * ★★ 桥接分支（`bridge-dev`）**搬迁完成后必须删除**：入库清单里有
 *    「删除桥接 + 重跑全部闸门」的检查项；自检每次都会打印走了哪一支。
 */
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 本模块所在目录 = 脚本目录（dev: `deck-contract/`；flat: `html-deck/`） */
export const DECK_DIR = dirname(fileURLToPath(import.meta.url))
const hasLocalMasters = existsSync(join(DECK_DIR, 'masters'))
/** 布局：`flat`（入库后的目标）| `bridge-dev`（当前开发树，**桥接、会死**） */
export const LAYOUT = hasLocalMasters ? 'flat' : 'bridge-dev'
/** 引擎根：flat = 脚本目录本身；dev = 上一级（**桥接分支**） */
export const ENGINE_ROOT = hasLocalMasters ? DECK_DIR : resolve(DECK_DIR, '..')
export const MASTERS_DIR = join(ENGINE_ROOT, 'masters')
export const FONTS_DIR = join(ENGINE_ROOT, 'fonts')
export const EXAMPLES_DIR = join(DECK_DIR, 'examples')
export const SCHEMA = join(DECK_DIR, 'deck.schema.json')
export const OUT_DIR = join(DECK_DIR, 'out')

/**
 * 启动自检：**打印解析后的绝对路径** + 逐个 `existsSync`；缺任何一个 ⇒ **红**。
 * 目的：把"相对路径算错 ⇒ 跑一半炸"变成"**一开头就指名报错**"。
 * @param {{ quiet?: boolean }} [opt]
 */
export function selfCheck(opt = {}) {
  const req = [
    ['ENGINE_ROOT', ENGINE_ROOT],
    ['DECK_DIR', DECK_DIR],
    ['MASTERS_DIR', MASTERS_DIR],
    ['FONTS_DIR', FONTS_DIR],
    ['EXAMPLES_DIR', EXAMPLES_DIR],
    ['SCHEMA', SCHEMA],
  ]
  if (!opt.quiet) {
    console.log(`  [paths] 布局 = ${LAYOUT}${LAYOUT === 'bridge-dev' ? '  ★（桥接分支：**搬迁完成后删除**）' : ''}`)
    for (const [k, v] of req) console.log(`  [paths] ${k} = ${v}${existsSync(v) ? '' : '   ✗ 缺失'}`)
  }
  const missing = req.filter(([, v]) => !existsSync(v))
  if (missing.length) {
    console.error('  ✗ paths.mjs 自检失败：以下路径不存在（布局/相对引用写错了）：')
    for (const [k, v] of missing) console.error(`      · ${k} = ${v}`)
    console.error(`      （LAYOUT=${LAYOUT} · DECK_DIR=${DECK_DIR} ⇒ 若是入库后出现：检查是否已扁平化、masters/fonts 是否在引擎根内）`)
    process.exit(2)
  }
  return { LAYOUT, ENGINE_ROOT, MASTERS_DIR, FONTS_DIR, EXAMPLES_DIR, SCHEMA }
}
