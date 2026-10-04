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
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE_V = dirname(fileURLToPath(import.meta.url))
/* ★ 路径收口（2026-10-03，**flat 搬迁验收抓出来的真 bug**）：母版根必须来自 `paths.mjs`。
   原写法 `join(HERE_V,'..','masters')` 写死了 bridge-dev 布局 ⇒ 入库扁平后解析成 `scripts/video-factory/masters`（不存在）
   ⇒ 校验器误报"母版资产不存在" ⇒ 渲染被硬闸门拒绝（exit=3）。
   教训：注释里那句"与 render-deck.mjs 同一约定"**就是复制了一份约定** ⇒ 一律 import，不许各自拼根。 */
import { MASTERS_DIR } from './paths.mjs'

/* ============ ★ K22：**长度上限的唯一真源 = deck.schema.json**（team-lead 裁定 (b)，2026-10-03） ============
   背景：本文件曾**手抄一份长度表**（14 处 `checkString(..., 4, 24, ...)` 加多处 `cp(x) > N`），注释还写"规则严格
   对齐 schema"，但**从不读 deck.schema.json** ⇒ **两份 enforced 互相否决**：改契约却不改这里 ⇒ 渲染器按旧表拒收
   （实测 `items[0]` 的 k=164 被 `n > 40` 拦死 ⇒ render exit=3 ⇒ 第二路"受阻"、测量能力被吃掉）。
   现规矩：**判据按 JSON 指针取**（`lim`/`adv`），不手抄、不按叶名（叶名会撞车 —— `labels/items` 曾让 I5 漏报）。 */
let SCHEMA = null
/* ★ team-lead ④-2：**仅量测**的 schema 覆盖 —— 让第二路能**真跑到 k=判据**（此时应 k 过闸、k+1 因**版式**不过，
   从而与第一路**真交叉**）。安全约束（缺一不可）：
   ① **默认关**（只有显式设 `DECK_SCHEMA_OVERRIDE` 才生效）；② 每次运行**打印告示**；
   ③ **绝不进发版闸门**（闸门不设该 env）；④ 覆盖文件**在仓库外**（由调用方写到 %TEMP%）。 */
const SCHEMA_OVERRIDE = process.env.DECK_SCHEMA_OVERRIDE || ''
function schemaNode(ptr) {
  if (SCHEMA === null) {
    const p = SCHEMA_OVERRIDE || join(HERE_V, 'deck.schema.json')
    try { SCHEMA = JSON.parse(readFileSync(p, 'utf8')) } catch { SCHEMA = {} }
    if (SCHEMA_OVERRIDE) {
      /* ⚠️ **必须走 stderr**：`--json` 模式下 stdout **只许有 JSON**（父进程 render-deck 直接 `JSON.parse(stdout)`）。
         事故（I6 的第三例）：这句曾用 `console.log` ⇒ 污染 stdout ⇒ 父进程解析失败 ⇒ 判"校验不通过"并 exit=3，
         而同一子进程稍后打印的 JSON 汇总却是 `pass:true` ⇒ **同一次运行两份结论相反**。 */
      console.error(`  ★★ **使用覆盖 schema（仅量测 · 绝不可用于发版）**：${SCHEMA_OVERRIDE}`)
    }
  }
  /* ⛔ **回归修复（team-lead 定位到一行）**：原实现只按键走、**中途不跟随 `$ref`** ⇒
     `#/$defs/pageCompare/properties/left/properties/label` 在 `left`（= `{$ref:'#/$defs/compareSide'}`）处就
     变成 `undefined` ⇒ 通用校验误报"schema 指针解析不到" ⇒ **16 个既有样例被拒渲染**（而闸门因"产物新鲜 ⇒ 跳过渲染"全绿）。
     ⇒ 修：**每走一段就解析一次 `$ref`**（`resolveRef` 函数声明提升 ⇒ 定义在后面也安全；`REF_HOPS` 防环）。 */
  let o = SCHEMA
  for (const k of ptr.split('/').slice(1)) {
    o = (o == null ? undefined : o[k])
    o = resolveRef(o)
  }
  return o
}
/** `[minLength, maxLength]`（缺省 0 / Infinity；maxLength 缺省 = **无硬上限** ⇒ 该字段只许 advisory） */
function lim(ptr, dMin = 0, dMax = Infinity) {
  const n = schemaNode(ptr) || {}
  return [n.minLength ?? dMin, n.maxLength ?? dMax]
}
/** `[minItems, maxItems]`（**条数版**；缺省 0 / Infinity ⇒ 无上限）
 *  ★ 与 `lim()` **同一真源、同一指针取法** —— 条数上限也必须从 schema 取（K22 同族第二例，见下）。 */
function limItems(ptr, dMin = 0, dMax = Infinity) {
  const n = schemaNode(ptr) || {}
  return [n.minItems ?? dMin, n.maxItems ?? dMax]
}
/** `recommendedMax`（advisory；缺省 Infinity = 无建议值） */
function adv(ptr, dflt = Infinity) {
  const n = schemaNode(ptr) || {}
  return n.recommendedMax ?? dflt
}

/* ============ ★ (A) **通用 schema 驱动校验**（team-lead：去字面量 + 语义化校验） ============
   目的：把散在 12 个 `checkXxx()` 里的**手写字面量**（本批前共 50 处）换成**一处**按 schema 走。
   ★ `$ref` **必须解析**（`pages` 的 prefixItems/items 指向各页型、`compareSide` 也是 `$ref`）
     —— team-lead 实测：不解析 ref 的遍历器会整片漏掉约束（3 处假结论），却看起来"跑过了"。
   ★ 四类对照齐全：`minLength` / `maxLength` / `minItems` / `maxItems`；`recommendedMax` ⇒ **只出 warn**（绝不影响退出码）。 */
const REF_HOPS = 8
function resolveRef(node, depth = 0) {
  if (node && typeof node === 'object' && node.$ref && depth < REF_HOPS) {
    const t = schemaNode(node.$ref)
    return t ? resolveRef(t, depth + 1) : null
  }
  return node
}
function checkAgainstSchema(value, ptr, path) {
  const s = resolveRef(schemaNode(ptr))
  if (!s) { add('error', path, `schema 指针解析不到：${ptr}`, '修 deck.schema.json 或校验器（$ref 必须解析）'); return }
  if (typeof value === 'string') {
    const n = cp(value)
    const { minLength: mn, maxLength: mx, recommendedMax: rmax } = s
    if (mn != null && n < mn) add('error', path, `${n} 字，少于下限 ${mn} 字（schema）`, `补到 ≥${mn} 字`)
    else if (mx != null && n > mx) add('error', path, `${n} 字，超过硬上限 ${mx} 字（schema）`, `精简到 ≤${mx} 字`)
    else if (rmax != null && n > rmax) add('warn', path, `${n} 字，超过建议 ${rmax} 字（advisory，不拒绝渲染）`, `建议精简到 ≤${rmax} 字`)
    return
  }
  if (Array.isArray(value)) {
    const { minItems: mn, maxItems: mx } = s
    if (mn != null && value.length < mn) add('error', path, `只有 ${value.length} 条，少于下限 ${mn} 条（schema）`, `补到 ≥${mn} 条`)
    if (mx != null && value.length > mx) add('error', path, `${value.length} 条，超过硬上限 ${mx} 条（schema）`, `精简到 ≤${mx} 条`)
    if (s.items) value.forEach((v, i) => checkAgainstSchema(v, `${ptr}/items`, `${path}[${i}]`))
    return
  }
  if (value && typeof value === 'object') {
    const props = s.properties || {}
    for (const [k, v] of Object.entries(value)) {
      if (props[k]) checkAgainstSchema(v, `${ptr}/properties/${k}`, `${path}.${k}`)
    }
  }
}
/** 页型 → schema 定义指针（`cover` ⇒ `#/$defs/pageCover`） */
function pageDefPtr(type) { return `#/$defs/page${type[0].toUpperCase()}${type.slice(1)}` }

/** 取某页型在 **schema** 里允许的字段名（唯一真源；拿不到 ⇒ null，调用方退回兜底清单）。
 *  ⚠️ `SCHEMA` 惰性加载 ⇒ 必须先 `ensureSchemaLoaded()`（否则拿到 null ⇒ 静默退回旧清单）。 */
function pageKeysFromSchema(type) {
  const ptr = pageDefPtr(type)
  let o = ensureSchemaLoaded()
  for (const k of ptr.split('/').slice(1)) { o = (o == null ? undefined : o[k]); if (!o) break }
  const props = o && o.properties ? Object.keys(o.properties) : null
  return props && props.length ? props : null
}

let DECK_DIR = null                                    // 由 main() 设为 deck 文件所在目录（素材相对它解析）

/** ★ 母版清单的**唯一真源 = deck.schema.json 的 masterId 枚举**（team-lead，2026-10-04）
 *  背景：同一份清单曾同时硬编码在 **render-deck / validate-deck / deck.schema.json** 三处 ⇒
 *  加一个新母版要改三处，漏一处就出现"schema 允许但校验器拒绝"的假分叉（本日实测）。
 *  现改为**递归搜 schema 里名为 masterId 且带 enum 的节点**（不依赖具体路径），
 *  拿不到时退回兜底清单（宁可拒绝也不静默放行）。 */
function enumOf(schema, key) {
  let found = null
  const walk = (o) => {
    if (!o || typeof o !== 'object' || found) return
    if (o[key] && Array.isArray(o[key].enum)) { found = o[key].enum; return }
    for (const k of Object.keys(o)) walk(o[k])
  }
  walk(schema)
  return found
}
/** ★ 坑（本日实测）：`SCHEMA` 是**惰性加载**的（首个 `schemaNode()` 调用时才读文件）⇒
 *  在顶层直接 `enumOf(SCHEMA, …)` 拿到的是 `null` ⇒ 静默退回兜底清单 ⇒ 新增母版仍被拒。
 *  ⇒ 这里**强制先让 schema 就绪**（复用 `schemaNode` 的加载路径，不写第二份加载逻辑），再取值。 */
function ensureSchemaLoaded() { schemaNode('/$defs'); return SCHEMA }
const MASTER_IDS_FALLBACK = ['master-v1', 'master-v2']
function masterIds() { return enumOf(ensureSchemaLoaded(), 'masterId') || MASTER_IDS_FALLBACK }

const STYLE_ENUMS = {
  get masterId() { return masterIds() },
  // palette 不在本表：它的取值清单**由所选母版的 master.json 提供**（见下面的专用校验）
  density: ['airy', 'normal', 'dense'],
  tempo: ['calm', 'normal', 'brisk'],
  orientation: ['16:9', '9:16'],
}
const PAGE_TYPES = ['cover', 'bullets', 'data', 'end', 'section', 'chart', 'compare', 'quote', 'toc', 'summary', 'image', 'steps']
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
  /* ★ K22 单源改造：眉标 32 是**版式建议**（schema `recommendedMax`），不是硬上限（schema `maxLength` = 388）。
     旧版把它写成 error ⇒ **validate-deck 比 schema 严** ⇒ 会无端拒绝 schema 允许的输入（与闸门口径分叉）。 */
  const KB = adv('#/$defs/pageCover/properties/kicker')
  if (p.kicker != null && cp(p.kicker) > KB) add('warn', `${path}.kicker`, `眉标 ${cp(p.kicker)} 字，超过**建议** ${KB} 字（advisory）`, '建议精简眉标（硬上限见 schema maxLength）')
  if (p.asset != null) {
    if (typeof p.asset !== 'string') add('error', `${path}.asset`, 'asset 必须是字符串路径', '给项目内相对路径')
    else if (/^[a-zA-Z]:[\\/]|^file:/i.test(p.asset)) add('error', `${path}.asset`, `asset 用了绝对路径/ file:// ：${p.asset}`, '素材必须拷进项目目录并用相对路径（浏览器会拦截 file://）')
  }
}

function checkBullets(p, path) {
  let ok = checkString(p.title, `${path}.title`, ...lim('#/$defs/pageBullets/properties/title'), '要点页标题')
  if (!Array.isArray(p.items)) {
    add('error', `${path}.items`, 'items 缺失或不是数组', '补 3~5 条要点')
    return
  }
  /* ★ **K22 同族复发**（2026-10-04，被**条数构造器实跑**揪出）：这两行曾**手写** `3` 与 `5` ⇒ **无视 schema** ——
     我把 `maxItems` 覆盖到 8 后，渲染仍被这里的 `> 5` 拒死 ⇒ **条数测量根本做不了**（上限吃掉测量，与 K22 一字不差）。
     ⇒ 现改为**读 schema**（`limItems`，与 `lim()` 同一真源、同一指针）。 */
  const [iMinC, iMaxC] = limItems('#/$defs/pageBullets/properties/items')
  const nItems = p.items.length
  if (nItems < iMinC) {
    add('error', `${path}.items`, `只有 ${nItems} 条要点，硬性要求 ≥${iMinC} 条（schema）`,
      nItems === 0 ? `这一页没有内容：请补 ≥${iMinC} 条要点；若这一页只有一句收束语，改用 end 页`
                   : `补到 ≥${iMinC} 条；若确实只有 1~2 条要点，改用 data 页（有真实数字时）或把它们并进相邻 bullets 页`)
  }
  if (nItems > iMaxC) add('error', `${path}.items`, `有 ${nItems} 条，超过硬上限 ${iMaxC} 条（schema · 条数）`, `精简到 ≤${iMaxC} 条，或拆成两页 bullets`)
  p.items.forEach((it, i) => {
    if (typeof it !== 'string') { add('error', `${path}.items[${i}]`, '不是字符串', '改成字符串'); return }
    const n = cp(it)
    const [iMin, iMax] = lim('#/$defs/pageBullets/properties/items/items')
    if (n < iMin) add('error', `${path}.items[${i}]`, `该条只有 ${n} 字，要求 ≥${iMin} 字：${JSON.stringify(it)}`, '补足信息量（"一句话讲清一件事"）；若实在补不动，把它降级成标题的一部分')
    /* ★ 2026-10-03：**上限一律从 schema 取**（K22 单源）—— `iMax` 现在是硬上限（= ⌊0.9×判据 164⌋ = 147）；
       `recommendedMax 40` 才有资格做 advisory 提醒。 */
    else if (n > iMax) add('error', `${path}.items[${i}]`, `该条 ${n} 字，超过硬上限 ${iMax} 字（schema · ⌊0.9×判据 164⌋）`, '精简该条（超硬上限会被渲染闸门拒收）')
    else if (n > adv('#/$defs/pageBullets/properties/items/items')) add('warn', `${path}.items[${i}]`, `该条 ${n} 字，超过**建议** ${adv('#/$defs/pageBullets/properties/items/items')} 字（advisory，不拒绝渲染）`, '建议精简该条（要点用短句更稳）')
  })
  if (!checkString(p.summary, `${path}.summary`, ...lim('#/$defs/pageBullets/properties/summary'), '底部小结')) {
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
  /* ★ (A)：上限一律**读 schema**（`lim()`）—— 手写字面量会**否决量测 override**（实测：unit 的 `> 8` 让 `--raise-max` 白做）
     另：`unit` 的 kind = **editorial**（上限由编辑意图定；几何判据 99 只用来证 `8 ≤ 99`）⇒ 不套 ⌊0.9×判据⌋。 */
  const [uMin, uMax] = lim('#/$defs/pageData/properties/metric/properties/unit')
  if (cp(m.unit) < uMin) add('error', `${path}.metric.unit`, `单位只有 ${cp(m.unit)} 字，要求 ≥${uMin} 字`, '补单位（ms / 帧、%、元、分钟…）')
  else if (cp(m.unit) > uMax) add('error', `${path}.metric.unit`, `单位 ${cp(m.unit)} 字，上限 ${uMax}（schema）`, '精简单位写法，如 "毫秒/帧" → "ms / 帧"')
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
  checkString(p.line1, `${path}.line1`, ...lim('#/$defs/pageEnd/properties/line1'), '尾页主句第 1 行')
  const [l2min, l2max] = lim('#/$defs/pageEnd/properties/line2')
  if (p.line2 != null && cp(p.line2) > l2max) add('error', `${path}.line2`, `第 2 行 ${cp(p.line2)} 字，上限 ${l2max}`, '精简')
  const [cMin, cMax] = lim('#/$defs/pageEnd/properties/cta')
  if (!checkString(p.cta, `${path}.cta`, cMin, cMax, '尾页 CTA')) {
    add('warn', `${path}.cta`, '尾页缺 CTA', `补一句 ≥${cMin} 字行动号召；若本片是纯知识型收束，可去掉 end 页`)
  }
  const [eMin, eMax] = lim('#/$defs/pageEnd/properties/en')
  if (!checkString(p.en, `${path}.en`, eMin, eMax, '尾页英文行')) {
    add('warn', `${path}.en`, '尾页缺一行英文小字', `补一行 ${eMin}~${eMax} 字英文（如 HTML-DRIVEN SLIDES · FRAME-ACCURATE）`)
  }
  void l2min
}

// ---------------------------------------------------------------- 新页型 5~8
function checkSection(p, path) {
  if (cp(p.number) > 12) add('error', `${path}.number`, `编号 ${cp(p.number)} 字，上限 12`, '精简编号，如 "01" 或 "第二章"')
  if (!checkString(p.title, `${path}.title`, 4, 24, '章节页标题')) {
    add('warn', `${path}.title`, '章节页只有编号、没有标题 → 违反"不许只有编号"',
      '补一个 ≥4 字的标题；若这一页想强调一个概念/一句话，改用 quote（一句完整的话）；若有一个真实数字，改用 data')
  }
  if (p.subtitle != null) checkString(p.subtitle, `${path}.subtitle`, 6, 40, '章节页副题')
}

function checkChart(p, path) {
  checkString(p.title, `${path}.title`, 4, 24, '图表页标题')
  const c = p.chart
  if (!c || typeof c !== 'object') {
    add('error', `${path}.chart`, 'chart 缺失', '补 chart{type, series}；series 至少 4 个真实数字')
    return
  }
  checkEnum(c.type, `${path}.chart.type`, ['line', 'bar', 'donut'], 'chart.type', '只允许 line / bar / donut')
  if (!Array.isArray(c.series)) {
    add('error', `${path}.chart.series`, 'series 缺失或不是数组', '补 ≥4 个 number 数据点；拿不到真实数据 → 改用 bullets 页')
  } else {
    if (c.series.length < 4) {
      add('error', `${path}.chart.series`, `只有 ${c.series.length} 个数据点，硬性要求 ≥4`,
        '补到 ≥4 个点；若确实只有 2~3 个数，改用 data 页（大数字 + 单位 + 解释）或 bullets 页')
    }
    if (c.series.length > 12) add('error', `${path}.chart.series`, `${c.series.length} 个点，上限 12`, '拆成两页，或改用 line 只画趋势')
    c.series.forEach((v, i) => {
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        add('error', `${path}.chart.series[${i}]`, `数据点不是合法 number：${JSON.stringify(v)}`,
          '数据点必须是真实数字（不许字符串、不许编造）；拿不到 → 改用 bullets 页')
      }
    })
  }
  if (Array.isArray(c.labels) && Array.isArray(c.series) && c.labels.length !== c.series.length) {
    add('warn', `${path}.chart.labels`, `labels ${c.labels.length} 个 ≠ series ${c.series.length} 个`,
      '让标签数与数据点数一致，或直接删掉 labels')
  }
  /* ★ (A)：同 data 页 —— 读 schema（override 才生效）；kind = editorial（不套 0.9×判据） */
  const [cuMin, cuMax] = lim('#/$defs/pageChart/properties/unit')
  if (cp(p.unit) < cuMin) add('error', `${path}.unit`, `单位只有 ${cp(p.unit)} 字，要求 ≥${cuMin} 字`, '补单位（% / 秒 / 万 …）')
  else if (cp(p.unit) > cuMax) add('error', `${path}.unit`, `单位 ${cp(p.unit)} 字，上限 ${cuMax}（schema）`, '精简单位')
  if (cp(p.explain) < 8) add('error', `${path}.explain`, `解释只有 ${cp(p.explain)} 字，要求 ≥8 字`,
    '补一句解释：这张图在说明什么、口径是什么')
  if (p.source != null && cp(p.source) > 40) add('error', `${path}.source`, `来源 ${cp(p.source)} 字，上限 40`, '精简来源')
}

function checkSide(side, path, sideName) {
  if (!side || typeof side !== 'object') {
    add('error', path, `${sideName}缺失`, `补 {label, points[]}（2~4 条，每条 ≥6 字）`)
    return
  }
  if (cp(side.label) < 2) add('error', `${path}.label`, `${sideName}标签只有 ${cp(side.label)} 字，要求 ≥2 字`, '补 2~12 字的标签')
  else if (cp(side.label) > 12) add('error', `${path}.label`, `${sideName}标签 ${cp(side.label)} 字，上限 12`, '精简标签')
  if (!Array.isArray(side.points)) {
    add('error', `${path}.points`, `${sideName}points 缺失或不是数组`, '补 2~4 条，每条 ≥6 字')
    return
  }
  if (side.points.length < 2) {
    add('error', `${path}.points`, `${sideName}只有 ${side.points.length} 条，硬性要求 2~4 条`,
      '补到 ≥2 条；若确实只有 1 条，改用 bullets 页（每条 ≥8 字）或把这条并进 conclusion')
  }
  if (side.points.length > 4) {
    add('error', `${path}.points`, `${sideName}有 ${side.points.length} 条，上限 4 条`,
      '拆成两页 compare，或改用 bullets 页（最多 5 条）')
  }
  side.points.forEach((t, i) => {
    if (typeof t !== 'string') { add('error', `${path}.points[${i}]`, '不是字符串', '改成字符串'); return }
    const n = cp(t)
    if (n < 6) add('error', `${path}.points[${i}]`, `该条只有 ${n} 字，要求 ≥6 字：${JSON.stringify(t)}`,
      '补足信息量；若两边内容都撑不起来，改用 bullets 页')
  })
}

function checkCompare(p, path) {
  checkString(p.title, `${path}.title`, 4, 24, '对比页标题')
  checkSide(p.left, `${path}.left`, '左栏')
  checkSide(p.right, `${path}.right`, '右栏')
  if (cp(p.conclusion) < 8) add('error', `${path}.conclusion`, `结论只有 ${cp(p.conclusion)} 字，要求 ≥8 字`,
    '补一句结论：对比完到底说明什么；若说不出结论，说明这页不该用 compare')
  else if (cp(p.conclusion) > 40) add('error', `${path}.conclusion`, `结论 ${cp(p.conclusion)} 字，上限 40`, '精简结论')
}

function checkQuote(p, path) {
  const q = typeof p.quote === 'string' ? p.quote.trim() : ''
  if (!q) { add('error', `${path}.quote`, 'quote 缺失或不是字符串', '补一句完整的话（≥12 字）'); return }
  const n = cp(q)
  if (n < 12) {
    add('error', `${path}.quote`, `引用只有 ${n} 字，要求 ≥12 字：${JSON.stringify(q)}`,
      n < 8 ? '太短了：若这是一句口号/名词短语，改用 section 页或 bullets 页' : '补足到 ≥12 字的一句完整的话')
    return
  }
  if (n > 80) add('error', `${path}.quote`, `引用 ${n} 字，上限 80`, '截取其中最有力量的一句')
  // "是不是一句完整的话" 的结构化判据：以句末标点收尾（名词短语通常不会）
  if (!/[。！？…]["”』」]?$/.test(q)) {
    add('error', `${path}.quote`, `引用不是一句完整的话（缺句末标点）：${JSON.stringify(q.slice(0, 40))}`,
      '把它写成完整一句并以 。/！/？/… 收尾；若它本来就是名词短语，改用 section 页（标题）或 bullets 页')
  } else if (!/[，、；：]/.test(q) && n < 20) {
    add('warn', `${path}.quote`, `这句较短且无停顿，确认它是不是一句完整的话：${JSON.stringify(q)}`,
      '可加一处停顿让语气完整，或换一句信息量更大的引用')
  }
  if (p.author != null) {
    if (cp(p.author) < 2) add('error', `${path}.author`, '作者过短', '补 2~20 字的出处/作者')
    else if (cp(p.author) > 20) add('error', `${path}.author`, `作者 ${cp(p.author)} 字，上限 20`, '精简')
  }
  if (p.context != null && cp(p.context) > 40) add('error', `${path}.context`, `补充 ${cp(p.context)} 字，上限 40`, '精简')
}

function checkToc(p, path) {
  checkString(p.title, `${path}.title`, 4, 24, '目录页标题')
  if (!Array.isArray(p.items)) { add('error', `${path}.items`, 'items 缺失或不是数组', '补 3~6 条，每条 ≥4 字'); return }
  /* ★ K22 同族：toc 条数改**读 schema**（`limItems`） */
  const [tMin, tMax] = limItems('#/$defs/pageToc/properties/items')
  if (p.items.length < tMin) add('error', `${path}.items`, `只有 ${p.items.length} 条，要求 ${tMin}~${tMax} 条（schema）`, `补到 ≥${tMin} 条`)
  if (p.items.length > tMax) add('error', `${path}.items`, `${p.items.length} 条，超过硬上限 ${tMax} 条（schema · 条数）`, `精简到 ${tMax} 条以内（目录超过 ${tMax} 条观众记不住）`)
  p.items.forEach((t, i) => {
    if (typeof t !== 'string') { add('error', `${path}.items[${i}]`, '不是字符串', '改成字符串'); return }
    if (cp(t) < 4) add('error', `${path}.items[${i}]`, `该条只有 ${cp(t)} 字，要求 ≥4 字：${JSON.stringify(t)}`, '补足')
    else if (cp(t) > 24) add('error', `${path}.items[${i}]`, `该条 ${cp(t)} 字，上限 24`, '精简')
  })
}

function checkSummary(p, path) {
  checkString(p.title, `${path}.title`, 4, 24, '小结页标题')
  if (!Array.isArray(p.items)) { add('error', `${path}.items`, 'items 缺失或不是数组', '补恰好 3 条，每条 ≥8 字'); return }
  /* ★ K22 同族：summary 的"恰好 3 条"（min == max == 3）也**读 schema** */
  const [sMinC, sMaxC] = limItems('#/$defs/pageSummary/properties/items')
  if (p.items.length < sMinC || p.items.length > sMaxC) {
    add('error', `${path}.items`, `有 ${p.items.length} 条，硬性要求 ${sMinC}~${sMaxC} 条（schema）`,
      p.items.length < sMinC ? `补到 ${sMinC} 条；若凑不出，改用 bullets 页（≥3 条即可）` : `删到 ${sMaxC} 条（小结超过 ${sMaxC} 条就不是小结了）`)
  }
  p.items.forEach((t, i) => {
    if (typeof t !== 'string') { add('error', `${path}.items[${i}]`, '不是字符串', '改成字符串'); return }
    if (cp(t) < 8) add('error', `${path}.items[${i}]`, `该条只有 ${cp(t)} 字，要求 ≥8 字：${JSON.stringify(t)}`, '补足信息量')
    else if (cp(t) > 28) add('error', `${path}.items[${i}]`, `该条 ${cp(t)} 字，上限 28`, '精简')
  })
  if (p.closing != null && cp(p.closing) > 40) add('error', `${path}.closing`, `收束 ${cp(p.closing)} 字，上限 40`, '精简')
}

// ---------------------------------------------------------------- 新页型 11~12：图片 / 步骤
/**
 * 素材闸门 —— 把"**入口统一转码**"这条接口先在这里暴露出来。
 * 现实约束：生产上素材是用户自己的（iPhone 的 hvc1/HEVC、相机 .mov 都会进来），
 * 而 headless-shell 实测**不可播** .mov / .avi / HEVC ⇒ 绝不能静默黑屏，必须**大声拒绝**并指明出路。
 */
function mediaGate(assetPath, at) {
  const a = String(assetPath).trim()
  if (/^[a-zA-Z]:[\\/]/.test(a) || isAbsolute(a) || a.startsWith('\\\\') || /file:\/\//i.test(a)) {
    add('error', at, `asset 是绝对路径或 file://：${JSON.stringify(a)}`,
      '必须是**相对 deck 文件**的项目内路径（file:// 会被浏览器安全策略拦掉，实测如此）')
    return
  }
  if (a.split(/[\\/]/).includes('..')) {
    add('error', at, `asset 用 .. 越出 deck 目录：${JSON.stringify(a)}`, '素材必须落在项目目录内')
    return
  }
  const ext = ((a.match(/\.([A-Za-z0-9]+)$/) || [null, ''])[1] || '').toLowerCase()
  const STILL = ['jpg', 'jpeg', 'png', 'webp']
  const VIDEO_UNPLAYABLE = ['mov', 'avi', 'mkv', 'ts', 'hevc', 'h265', 'wmv', 'flv']
  const VIDEO_MAYBE = ['mp4', 'webm']
  if (STILL.includes(ext)) {
    const abs = DECK_DIR ? join(DECK_DIR, a) : null
    if (abs && !existsSync(abs)) {
      add('error', at, `素材文件不存在：${abs}`,
        '把素材放进项目目录（路径相对 deck 文件解析）；**素材缺失必须报错，绝不静默黑屏**')
    }
    return
  }
  if (VIDEO_MAYBE.includes(ext) || VIDEO_UNPLAYABLE.includes(ext)) {
    add('error', at, `素材是视频（.${ext}），本页型暂不支持`,
      `★ 视频素材必须走「**入口统一转码**」：转成 H.264 mp4 后改用 bullets/steps 页，或先抽静帧再走 image 页。`
      + `（实测 headless-shell 不可播 .mov/.avi/HEVC；本页型只收静态图片，明确报错而不是渲成黑屏）`)
    return
  }
  add('error', at, `不支持的素材扩展名 .${ext || '(无)'}`, '静态图片只支持 jpg / jpeg / png / webp')
}

function checkImage(p, path, style) {
  checkString(p.title, `${path}.title`, 4, 24, '图片页标题')
  checkEnum(p.layout, `${path}.layout`, ['left', 'right', 'full'], 'image.layout', '只允许 left / right / full')
  // ★ D15：**竖屏图片页只有 full**。
  //   竖屏下 left/right 是同一条整宽媒体带（清单里 image.9:16.left 与 .right 的矩形相同，实测也证明同一条带），
  //   "侧向"语义不成立 ⇒ 宁可在契约层禁掉一个没意义的选项，也不让 AI/用户选到"看起来分左右、其实一样"的版式。
  if (style && style.orientation === '9:16' && p.layout && p.layout !== 'full') {
    add('error', `${path}.layout`, `竖屏（9:16）不允许 layout="${p.layout}"`,
      '竖屏图片页只有 full —— 把 layout 改成 "full"；竖屏下 left/right 与 full 无从区分（已在契约层禁用）。确实要左右分栏版式请改用 16:9')
  }
  if (p.caption != null) checkString(p.caption, `${path}.caption`, 8, 48, '图片页图注')
  if (p.kicker != null && cp(p.kicker) > 32) add('error', `${path}.kicker`, `角标 ${cp(p.kicker)} 字，上限 32`, '精简角标')
  if (typeof p.asset !== 'string' || !p.asset.trim()) {
    add('error', `${path}.asset`, 'asset 缺失或不是字符串', '给一个项目内的相对路径（静态图片 jpg/jpeg/png/webp）')
    return
  }
  mediaGate(p.asset, `${path}.asset`)
}

function checkSteps(p, path) {
  checkString(p.title, `${path}.title`, 4, 24, '步骤页标题')
  if (p.index != null) checkEnum(p.index, `${path}.index`, ['number', 'dot'], 'steps.index', '只允许 number / dot')
  if (!Array.isArray(p.steps)) {
    add('error', `${path}.steps`, 'steps 缺失或不是数组', '补恰好 3~6 条，每条 ≥6 字')
    return
  }
  /* ★ **K22 同族**（条数构造器的正控实测踩到）：这两条曾**手写** `3` 与 `6` ⇒ 覆盖 `maxItems` 后仍被拒死 ⇒
     条数**测量做不了**。⇒ 改读 schema（`limItems`，与 `lim()` 同一真源/同一指针）。 */
  const [sMin, sMax] = limItems('#/$defs/pageSteps/properties/steps')
  if (p.steps.length < sMin) {
    add('error', `${path}.steps`, `只有 ${p.steps.length} 条，硬性要求 ${sMin}~${sMax} 条（schema）`,
      p.steps.length === 2 ? '若确实是「两件事」，改用 compare 页（左右对照）或 bullets 页（≥3 条）' : `补到 ≥${sMin} 条`)
  }
  if (p.steps.length > sMax) {
    add('error', `${path}.steps`, `${p.steps.length} 条，超过硬上限 ${sMax} 条（schema · 条数）`,
      `步骤超过 ${sMax} 条观众记不住：拆成两页 steps，或改用 bullets 页（最多 5 条）`)
  }
  p.steps.forEach((t, i) => {
    if (typeof t !== 'string') { add('error', `${path}.steps[${i}]`, '不是字符串', '改成字符串'); return }
    if (cp(t) < 6) add('error', `${path}.steps[${i}]`, `该步只有 ${cp(t)} 字，要求 ≥6 字：${JSON.stringify(t)}`, '补足信息量；写不清说明这步不该在这里')
    else if (cp(t) > 28) add('error', `${path}.steps[${i}]`, `该步 ${cp(t)} 字，上限 28`, '精简到一句动作')
  })
}

// ---------------------------------------------------------------- 主流程
function main() {
  const args = process.argv.slice(2)
  const jsonMode = args.includes('--json')
/* ★ team-lead ③（"静默降级"族）：**参数组合无效不许静默** ——
   `--json-out` 只在 `--json` 分支里写文件 ⇒ 单给 `--json-out` 会**什么都不做且无提示**（实测）。
   ⇒ 二者必须同用；只给其一 ⇒ **exit 2**（与 §25b"输入/环境不完整 ⇒ exit 2"同族）。 */
{
  const i = args.indexOf('--json-out')
  if (i >= 0 && !jsonMode) { console.error('✗ --json-out 必须与 --json 同用（否则静默无效 ⇒ 参数组合无效，exit 2）'); process.exit(2) }
  if (i >= 0 && !args[i + 1]) { console.error('✗ --json-out 缺文件路径（exit 2）'); process.exit(2) }
}
  const quiet = args.includes('--quiet')
  const file = args.find((a) => !a.startsWith('--'))
  if (!file) {
    console.error('用法: node validate-deck.mjs <deck.json> [--json] [--quiet]')
    process.exit(2)
  }
  DECK_DIR = dirname(resolve(file))      // 素材路径相对 deck 文件解析（与 render-deck.mjs 同约定）

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
    /* ★ (A)：meta 的 title / subtitle / issuer / date 长度**全部交给通用 schema 校验**
       （原先这里有两处手抄**分叉**：`4,40` 比 schema 33 松、`6,60` 比 schema 203 严 —— 均已在 K22 定性；
       现在不再有 `lim/adv` 逐点调用，改由 `checkAgainstSchema` 一处驱动：maxLength ⇒ error、recommendedMax ⇒ warn）。 */
    checkAgainstSchema(meta, '#/$defs/meta', 'meta')
    if (!meta.subtitle || !cp(meta.subtitle)) {
      add('warn', 'meta.subtitle', '封面没有副标 → 违反"封面必须有主标题+副标"', '补一句 ≥6 字副标；若这层信息不适合放标题区，改用 bullets 页开篇')
    }
    checkEnum(meta.lang, 'meta.lang', ['zh-CN'], 'meta.lang', 'v1 只支持 zh-CN')
  }

  const style = deck.style
  if (!style || typeof style !== 'object') {
    add('error', 'style', 'style 缺失', '补 style{masterId, palette, density, tempo, orientation}')
  } else {
    // 母版必须在磁盘上真存在 —— 否则"枚举里有、资产不在"要到渲染时才炸（且报错看不懂）
    if (style.masterId && STYLE_ENUMS.masterId.includes(style.masterId)) {
      const mp = join(MASTERS_DIR, style.masterId, 'master.json')
      if (!existsSync(mp)) {
        add('error', 'style.masterId', `枚举里有 ${style.masterId}，但 ${mp} 不存在`,
          '母版资产要真存在（masters/<id>/master.json + assets/）；在磁盘上补齐，不要改枚举')
      } else {
        // palette 的取值清单由**所选母版**提供（不同母版命名不同）→ 必须按母版校验，不能用全局枚举
        let names = []
        try { names = Object.keys(JSON.parse(readFileSync(mp, 'utf8')).palette || {}) } catch { names = [] }
        if (!names.length) {
          add('error', 'style.masterId', `母版 ${style.masterId} 的 master.json 没有 palette 清单`, '母版必须声明自己的 palette 名清单')
        } else if (style.palette == null) {
          add('error', 'style.palette', 'style.palette 缺失', `从母版 ${style.masterId} 的清单里选一个: [${names.join(', ')}]`)
        } else if (!names.includes(style.palette)) {
          add('error', 'style.palette', `母版 ${style.masterId} 没有配色 "${style.palette}"`,
            `该母版可用: [${names.join(', ')}] —— ★ 先选 masterId，再在该母版的 palette 清单里选（不同母版命名不同）`)
        }
      }
    }
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
      /* ★ 允许字段的**唯一真源 = deck.schema.json**（team-lead，2026-10-04）：
         这里曾硬编码一份 12 页型的字段清单 ⇒ 与 schema 各存一份 = **又一处"多真源"**（实测踩到：
         给 schema 加页级 `duration` 后，本清单没跟上 ⇒ 新字段被拒、错误信息还指向"本页型只允许 [...]"，
         离真实原因很远）。现改为从 schema 的 `$defs.page<Type>.properties` 取键；拿不到才退回兜底清单。 */
      const FALLBACK_KEYS = { cover: ['type', 'kicker', 'asset'],
                            bullets: ['type', 'title', 'items', 'summary'],
                            data: ['type', 'title', 'metric', 'secondary'],
                            end: ['type', 'line1', 'line2', 'cta', 'en'],
                            section: ['type', 'number', 'title', 'subtitle'],
                            chart: ['type', 'title', 'chart', 'unit', 'explain', 'source'],
                            compare: ['type', 'title', 'left', 'right', 'conclusion'],
                            quote: ['type', 'quote', 'author', 'context'],
                            toc: ['type', 'title', 'items'],
                            summary: ['type', 'title', 'items', 'closing'],
                            image: ['type', 'title', 'asset', 'layout', 'caption', 'kicker'],
                            steps: ['type', 'title', 'steps', 'index'] }
      const allowedKeys = pageKeysFromSchema(p.type) || FALLBACK_KEYS[p.type]
      for (const k of Object.keys(p)) {
        if (!allowedKeys.includes(k)) add('error', `${path}.${k}`, `页面多出未定义字段 "${k}"`, `本页型只允许 [${allowedKeys.join(', ')}]`)
      }
      /* ★ (A)：**先按 schema 通用校验**（唯一真源；`$ref` 已解析；四类对照 + advisory 只出 warn），
         再做各页型的**结构性/语义性**检查（类型、条数上下界之外的建议、换页型建议、句末标点、素材扩展名…）。 */
      checkAgainstSchema(p, pageDefPtr(p.type), path)
      if (p.type === 'cover') checkCover(p, path)
      if (p.type === 'bullets') checkBullets(p, path)
      if (p.type === 'data') checkData(p, path)
      if (p.type === 'end') checkEnd(p, path)
      if (p.type === 'section') checkSection(p, path)
      if (p.type === 'chart') checkChart(p, path)
      if (p.type === 'compare') checkCompare(p, path)
      if (p.type === 'quote') checkQuote(p, path)
      if (p.type === 'toc') checkToc(p, path)
      if (p.type === 'summary') checkSummary(p, path)
      if (p.type === 'image') checkImage(p, path, deck.style)
      if (p.type === 'steps') checkSteps(p, path)
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
    const payload = JSON.stringify({
      file, pass: errors.length === 0,
      errorCount: errors.length, warnCount: warns.length,
      issues,
      pages: Array.isArray(pages) ? pages.map((p, i) => ({ index: i, type: p && p.type })) : [],
    }, null, 2)
    /* ★ team-lead ①(b)：**机器通道走文件**（`--json-out <file>`）⇒ stdout/stderr 被谁污染都无所谓；
       与 sweep 那边"结论走文件"同口径。stdout 仍打印 JSON（向后兼容；调用方优先读文件）。 */
    const jo = args.indexOf('--json-out')
    if (jo >= 0 && args[jo + 1]) {
      /* ★ team-lead ③-2：写失败**必须判红（exit 2）** —— 否则调用方会**静默回落到 stdout 解析**，
         即把"文件通道"悄悄降级成"流通道"（正是花一轮才修掉的那类事故 ⇒ 通道降级必须显式可见）。 */
      try { writeFileSync(args[jo + 1], payload, 'utf8') } catch (e) {
        console.error(`✗ --json-out 写失败（${args[jo + 1]}）：${e.message} ⇒ exit 2（**不许静默降级到 stdout 通道**）`)
        process.exit(2)
      }
    }
    console.log(payload)
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
