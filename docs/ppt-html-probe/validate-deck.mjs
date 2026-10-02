#!/usr/bin/env node
/**
 * validate-deck.mjs —— HTML 动态 PPT 分页契约校验器（零依赖，Node >= 18）
 *
 * 用法:
 *   node validate-deck.mjs <deck.json>           人读报告（默认）
 *   node validate-deck.mjs <deck.json> --json    机器可读 JSON
 *   node validate-deck.mjs <deck.json> --quiet   只输出结论行
 *
 * 退出码: 0 = 通过（可能有 warning）; 1 = 有 error; 2 = 用法/读文件错
 *
 * 与 deck.schema.json 的分工: schema 是"给 AI 看的约束文本"；本脚本是"可执行的判定 + 替换页型建议"。
 * 规则严格对齐 schema，并额外做 schema 表达不了的三件事：
 *   ① 首屏必须是 cover、末屏建议是 end
 *   ② 字符串里出现 HTML/CSS 标记 → 判定"AI 写了 HTML"
 *   ③ 每个不达标项都给"替换页型建议"
 */
import { readFileSync } from 'node:fs'

const STYLE_ENUMS = {
  masterId: ['master-v1'],
  palette: ['warm-gold', 'olive', 'clay', 'mist-blue'],
  density: ['airy', 'normal', 'dense'],
  tempo: ['calm', 'normal', 'brisk'],
  orientation: ['16:9', '9:16'],
}
const PAGE_TYPES = ['cover', 'bullets', 'data', 'end']
// 只匹配"真的是 HTML/CSS"的形态，避免误伤正常文案里的冒号分号
//   ① 完整标签 <div ...> / </span>
//   ② CSS 声明式：已知属性名 + 冒号 + 值 + 分号（如 color: #fff;）
//   ③ javascript: 伪协议
const HTML_MARKER = /<\/?[a-zA-Z!][^<>]*>|\b(?:color|background|font-size|font-family|margin|padding|display|position|width|height|transform|opacity|border|line-height)\s*:\s*[^;{}]+;|\bjavascript:/i

/** 字符数：去首尾空白后按 码点 计（与 Python len() / Array.from 一致） */
const cp = (s) => Array.from(String(s ?? '').trim()).length

const issues = []           // {level:'error'|'warn', path, msg, fix}
const add = (level, path, msg, fix) => issues.push({ level, path, msg, fix })

// ---------------------------------------------------------------- 基础判定
function checkString(v, path, min, max, label) {
  if (typeof v !== 'string') {
    add('error', path, `${label}缺失或不是字符串（当前: ${JSON.stringify(v)}）`, '补一个字符串字段')
    return false
  }
  const n = cp(v)
  if (n < min) {
    add('error', path, `${label}只有 ${n} 字，要求 ≥${min} 字：${JSON.stringify(v)}`, '补足信息量；若这段内容撑不起来，见下方"替换页型建议"')
    return false
  }
  if (max != null && n > max) {
    add('error', path, `${label}有 ${n} 字，超出上限 ${max} 字`, '精简文案，或拆成两页/两行')
    return false
  }
  return true
}

function checkEnum(v, path, allowed, label, hint) {
  if (!allowed.includes(v)) {
    add('error', path, `${label}取值 "${v}" 不在允许集合 [${allowed.join(', ')}] 内`, hint)
    return false
  }
  return true
}

// 递归扫 HTML 标记
function scanHtml(node, path) {
  if (typeof node === 'string') {
    if (HTML_MARKER.test(node)) {
      add('error', path, `字符串里疑似 HTML/CSS 标记：${JSON.stringify(node.slice(0, 60))}`, 'AI 只允许输出本 schema 的 JSON，不写 HTML/CSS/JS；删掉标记只留文字')
    }
    return
  }
  if (Array.isArray(node)) return node.forEach((x, i) => scanHtml(x, `${path}[${i}]`))
  if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) scanHtml(v, path ? `${path}.${k}` : k)
}

// ---------------------------------------------------------------- 页型判定
function checkCover(p, path) {
  if (p.kicker != null && cp(p.kicker) > 32) add('error', `${path}.kicker`, `眉标 ${cp(p.kicker)} 字，上限 32`, '精简眉标')
  if (p.asset != null) {
    if (typeof p.asset !== 'string') add('error', `${path}.asset`, 'asset 必须是字符串路径', '给项目内相对路径')
    else if (/^[a-zA-Z]:[\\/]|^file:/i.test(p.asset)) add('error', `${path}.asset`, `asset 用了绝对路径/ file:// ：${p.asset}`, '素材必须拷进项目目录并用相对路径（浏览器会拦截 file://）')
  }
}

function checkBullets(p, path) {
  let ok = checkString(p.title, `${path}.title`, 4, 24, '要点页标题')
  if (!Array.isArray(p.items)) {
    add('error', `${path}.items`, 'items 缺失或不是数组', '补 3~5 条要点')
    return
  }
  if (p.items.length < 3) {
    const n = p.items.length
    add('error', `${path}.items`, `只有 ${n} 条要点，硬性要求 ≥3 条`,
      n === 0 ? '这一页没有内容：请补 ≥3 条要点；若这一页只有一句收束语，改用 end 页'
              : '补到 ≥3 条；若确实只有 1~2 条要点，改用 data 页（有真实数字时）或把它们并进相邻 bullets 页')
  }
  if (p.items.length > 5) add('error', `${path}.items`, `有 ${p.items.length} 条，上限 5 条`, '拆成两页 bullets')
  p.items.forEach((it, i) => {
    if (typeof it !== 'string') { add('error', `${path}.items[${i}]`, '不是字符串', '改成字符串'); return }
    const n = cp(it)
    if (n < 8) add('error', `${path}.items[${i}]`, `该条只有 ${n} 字，要求 ≥8 字：${JSON.stringify(it)}`, '补足信息量（"一句话讲清一件事"）；若实在补不动，把它降级成标题的一部分')
    else if (n > 40) add('error', `${path}.items[${i}]`, `该条 ${n} 字，上限 40 字`, '精简该条')
  })
  if (!checkString(p.summary, `${path}.summary`, 6, 40, '底部小结')) {
    add('warn', `${path}.summary`, '要点页缺"底部小结"会显得没收口', '补一句 ≥6 字小结；或用 end 页承担收束')
  }
  return ok
}

function checkData(p, path) {
  checkString(p.title, `${path}.title`, 4, 24, '数据页标题')
  const m = p.metric
  if (!m || typeof m !== 'object') {
    add('error', `${path}.metric`, 'metric 缺失', '数据页必须有 数字+单位+解释；拿不到真实数字 → 改用 bullets 页')
    return
  }
  if (typeof m.number !== 'number' || !Number.isFinite(m.number)) {
    add('error', `${path}.metric.number`, `大数字不是合法 number：${JSON.stringify(m.number)}`,
      '大数字必须是真实数字（不许写成中文数字/字符串、不许编造）；拿不到真实数字 → 改用 bullets 页')
  }
  if (cp(m.unit) < 1) add('error', `${path}.metric.unit`, '单位为空', '补单位（ms / 帧、%、元、分钟…）')
  else if (cp(m.unit) > 8) add('error', `${path}.metric.unit`, `单位 ${cp(m.unit)} 字，上限 8`, '精简单位写法，如 "毫秒/帧" → "ms / 帧"')
  if (cp(m.explain) < 8) add('error', `${path}.metric.explain`, `解释只有 ${cp(m.explain)} 字，要求 ≥8 字`,
    '补一句解释，写清这个数字的"口径/来源/时间点"；若讲不清口径，说明这个数字不该拿来做数据页')
  if (!Array.isArray(p.secondary)) {
    add('error', `${path}.secondary`, 'secondary 缺失或不是数组', '补恰好 2 个次要指标')
  } else {
    if (p.secondary.length !== 2) {
      add('error', `${path}.secondary`, `次要指标 ${p.secondary.length} 条，硬性要求恰好 2 条`,
        p.secondary.length < 2 ? '再补 1 条；若凑不出，把唯一那条并进 metric.explain'
                               : '删到 2 条（第 3 条起观众记不住）')
    }
    p.secondary.forEach((s, i) => {
      if (!s || typeof s !== 'object') { add('error', `${path}.secondary[${i}]`, '不是对象', '改成 {label, note?}'); return }
      if (cp(s.label) < 2) add('error', `${path}.secondary[${i}].label`, 'label 过短', '补 key，2~20 字')
      else if (cp(s.label) > 20) add('error', `${path}.secondary[${i}].label`, `label ${cp(s.label)} 字，上限 20`, '精简')
      if (s.note != null && cp(s.note) > 30) add('error', `${path}.secondary[${i}].note`, `note ${cp(s.note)} 字，上限 30`, '精简')
    })
  }
}

function checkEnd(p, path) {
  checkString(p.line1, `${path}.line1`, 4, 30, '尾页主句第 1 行')
  if (p.line2 != null && cp(p.line2) > 30) add('error', `${path}.line2`, `第 2 行 ${cp(p.line2)} 字，上限 30`, '精简')
  if (!checkString(p.cta, `${path}.cta`, 6, 40, '尾页 CTA')) {
    add('warn', `${path}.cta`, '尾页缺 CTA', '补一句 ≥6 字行动号召；若本片是纯知识型收束，可去掉 end 页')
  }
  if (!checkString(p.en, `${path}.en`, 6, 60, '尾页英文行')) {
    add('warn', `${path}.en`, '尾页缺一行英文小字', '补一行 6~60 字英文（如 HTML-DRIVEN SLIDES · FRAME-ACCURATE）')
  }
}

// ---------------------------------------------------------------- 主流程
function main() {
  const args = process.argv.slice(2)
  const jsonMode = args.includes('--json')
  const quiet = args.includes('--quiet')
  const file = args.find((a) => !a.startsWith('--'))
  if (!file) {
    console.error('用法: node validate-deck.mjs <deck.json> [--json] [--quiet]')
    process.exit(2)
  }

  let deck
  try {
    deck = JSON.parse(readFileSync(file, 'utf8'))
  } catch (e) {
    console.error(`✗ 读/解析失败: ${e.message}`)
    process.exit(2)
  }

  // 结构
  if (deck.version !== '1.0') add('error', 'version', `version 应为 "1.0"，当前 ${JSON.stringify(deck.version)}`, '写 "1.0"')
  const meta = deck.meta
  if (!meta || typeof meta !== 'object') {
    add('error', 'meta', 'meta 缺失', '补 meta{title, subtitle, lang}')
  } else {
    checkString(meta.title, 'meta.title', 4, 40, '封面主标题')
    if (!checkString(meta.subtitle, 'meta.subtitle', 6, 60, '封面副标')) {
      add('warn', 'meta.subtitle', '封面没有副标 → 违反"封面必须有主标题+副标"', '补一句 ≥6 字副标；若这层信息不适合放标题区，改用 bullets 页开篇')
    }
    if (meta.issuer != null && cp(meta.issuer) > 40) add('error', 'meta.issuer', '出品方过长', '≤40 字')
    checkEnum(meta.lang, 'meta.lang', ['zh-CN'], 'meta.lang', 'v1 只支持 zh-CN')
  }

  const style = deck.style
  if (!style || typeof style !== 'object') {
    add('error', 'style', 'style 缺失', '补 style{masterId, palette, density, tempo, orientation}')
  } else {
    for (const [k, allowed] of Object.entries(STYLE_ENUMS)) {
      if (style[k] == null) add('error', `style.${k}`, `style.${k} 缺失`, `从 [${allowed.join(', ')}] 里选一个`)
      else checkEnum(style[k], `style.${k}`, allowed, `style.${k}`,
        k === 'palette' ? '配色只允许低饱和四选一（禁高饱和紫蓝）' : `只允许 [${allowed.join(', ')}]`)
    }
  }

  const pages = deck.pages
  if (!Array.isArray(pages)) {
    add('error', 'pages', 'pages 缺失或不是数组', '补 pages 数组，第 1 页是 cover')
  } else {
    if (pages.length < 4) add('error', 'pages', `只有 ${pages.length} 页，硬性要求 ≥4 页（封面/要点/数据/尾页）`, '补到 4~12 页')
    if (pages.length > 12) add('error', 'pages', `${pages.length} 页，上限 12 页`, '拆成多支片子')
    if (!pages[0] || pages[0].type !== 'cover') {
      add('error', 'pages[0]', `第 1 页是 "${pages[0] && pages[0].type}"，硬性要求是 cover`,
        '把 cover 放到第 1 页（封面文案由 meta.title/subtitle 提供，cover 页本身不写文案）')
    }
    if (pages.length && (!pages[pages.length - 1] || pages[pages.length - 1].type !== 'end')) {
      add('warn', 'pages[last]', '最后一页不是 end', '补一个 end 页做收束（主句 + CTA + 一行英文）')
    }
    pages.forEach((p, i) => {
      const path = `pages[${i}]`
      if (!p || typeof p !== 'object') { add('error', path, '不是对象', '改成页对象'); return }
      if (!PAGE_TYPES.includes(p.type)) {
        add('error', `${path}.type`, `未知页型 "${p.type}"`, `只允许 [${PAGE_TYPES.join(', ')}]`)
        return
      }
      const allowedKeys = { cover: ['type', 'kicker', 'asset'],
                            bullets: ['type', 'title', 'items', 'summary'],
                            data: ['type', 'title', 'metric', 'secondary'],
                            end: ['type', 'line1', 'line2', 'cta', 'en'] }[p.type]
      for (const k of Object.keys(p)) {
        if (!allowedKeys.includes(k)) add('error', `${path}.${k}`, `页面多出未定义字段 "${k}"`, `本页型只允许 [${allowedKeys.join(', ')}]`)
      }
      if (p.type === 'cover') checkCover(p, path)
      if (p.type === 'bullets') checkBullets(p, path)
      if (p.type === 'data') checkData(p, path)
      if (p.type === 'end') checkEnd(p, path)
    })
  }

  scanHtml(deck, '')

  // 汇总
  const errors = issues.filter((i) => i.level === 'error')
  const warns = issues.filter((i) => i.level === 'warn')
  const byPath = new Map()
  for (const i of issues) {
    const key = i.path.replace(/\.[a-zA-Z]+$/, '') || i.path
    byPath.set(key, (byPath.get(key) || 0) + 1)
  }

  if (jsonMode) {
    console.log(JSON.stringify({
      file, pass: errors.length === 0,
      errorCount: errors.length, warnCount: warns.length,
      issues,
      pages: Array.isArray(pages) ? pages.map((p, i) => ({ index: i, type: p && p.type })) : [],
    }, null, 2))
    process.exit(errors.length ? 1 : 0)
  }

  if (!quiet) {
    console.log(`\n=== deck 契约校验 ===\n文件: ${file}`)
    const styleLine = style ? `${style.masterId} / ${style.palette} / ${style.density} / ${style.tempo} / ${style.orientation}` : '(style 缺失)'
    console.log(`风格: ${styleLine}`)
    console.log(`页序: ${Array.isArray(pages) ? pages.map((p) => (p && p.type) || '?').join(' → ') : '(pages 缺失)'}`)
    console.log('')
    if (issues.length === 0) console.log('  ✓ 全部达标')
    for (const i of issues) {
      const tag = i.level === 'error' ? '✗ 不达标' : '△ 建议'
      console.log(`  ${tag}  ${i.path}`)
      console.log(`            ${i.msg}`)
      if (i.fix) console.log(`             → ${i.fix}`)
    }
    console.log('')
  }
  console.log(`结论: ${errors.length === 0 ? 'PASS' : 'FAIL'}（不达标 ${errors.length} 项 / 建议 ${warns.length} 项）`)
  process.exit(errors.length ? 1 : 0)
}

main()
