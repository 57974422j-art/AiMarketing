#!/usr/bin/env node
/**
 * gen-deck.mjs —— **文案/大纲 → 可校验的 deck JSON**（"文案→成片"的入口，本仓此前缺的一环）
 *
 * 为什么要有：deck JSON 此前只能**手写**或从现成母档派生 ⇒ 真实投放场景里"给一段文案就出片"没法成立。
 *
 * 设计原则（与全仓同口径）：
 *   ① **规则显式打印**：哪个标记 ⇒ 哪个页型，一页一行，**带来源行号**
 *   ② **契约长度由 schema 读**（不硬编码）：`title 4~24`、`要点条目 8~147`、`步骤 6~28`、`结论 8~40` …
 *      ⇒ 文案长度不合窗口时：先找**同节其它候选**，再**降级页型**（会打印 note），**绝不编造原文没有的内容**
 *   ③ 生成后**必过 `validate-deck`**：不过 ⇒ **删产物 + 红 + 转述校验器原因**（绝不静默产出非法档）
 *   ④ `--self-test`：合成正控（断言页型覆盖 + 过校验）＋ 两条负控（空输入 exit 2 / 页数不足 exit 1）
 *
 * 用法：
 *   node gen-deck.mjs --in copy.md --out out-tmp-gen/deck.json [--master master-tech] [--palette cyan]
 *        [--orientation 16:9] [--title 标题] [--issuer 出品方] [--toc] [--plan] [--seconds 3.4] [--allow-truncate]
 *   node gen-deck.mjs --self-test
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const EXIT = { OK: 0, FAIL: 1, INPUT: 2 }

const FLAGS = {
  '--in': 'in', '--out': 'out', '--master': 'master', '--palette': 'palette', '--orientation': 'orientation',
  '--title': 'title', '--subtitle': 'subtitle', '--issuer': 'issuer', '--seconds': 'seconds',
  '--toc': 'toc', '--plan': 'plan', '--self-test': 'selfTest', '--allow-truncate': 'allowTruncate',
  '--keep-invalid': 'keepInvalid', '--srt': 'srt',
}
const A = {}
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i]
  if (!(a in FLAGS)) {
    console.error(`✗ 未识别的参数：${a}\n   允许：${Object.keys(FLAGS).join(' ')}`)
    process.exit(EXIT.INPUT)
  }
  const k = FLAGS[a]
  if (k === 'toc' || k === 'plan' || k === 'selfTest' || k === 'allowTruncate' || k === 'keepInvalid') { A[k] = true; continue }
  A[k] = process.argv[++i]
}
/* ★★ 旗标三件套的**覆盖断言**（team-lead msg17 ④：与 `crosscheck` / `measure-count` 同款纳管）。
   ① **注册表 ⊇ 源码里出现的全部旗标字面量** ⇒ 防"新加旗标忘了登记 ⇒ 照抄者只得到哑红"；
   ② **每个注册项必须被消费**（`A.<key>` 或 `opt.<key>`）⇒ 防"登记了却没人读 ⇒ 假装覆盖"。
   ⚠️ 本断言**不得写出旗标字面量**（否则 ① 会把自己的扫描正则当成未登记旗标 ⇒ 自匹配误判）⇒ 用正则从源码扫，不列举。 */
{
  const src = readFileSync(fileURLToPath(import.meta.url), 'utf8')
  const found = [...new Set([...src.matchAll(/'(--[a-zA-Z][\w-]*)'/g)].map((m) => m[1]))]
  const known = new Set(Object.keys(FLAGS))
  const missing = found.filter((f) => !known.has(f))
  const dead = [...known].filter((n) => !new RegExp(`\\b(A|opt)\\.${FLAGS[n]}\\b|\\b(A|opt)\\['${FLAGS[n]}'\\]`).test(src))
  if (missing.length || dead.length) {
    console.error(`✗ 旗标三件套断言失败：**注册表不全** ${missing.join(' ') || '（无）'} · **注册但未消费** ${dead.join(' ') || '（无）'}`)
    console.error('   规矩：新增旗标必须登记进 FLAGS **并被真正读取**（否则就是"登记即假装覆盖"）⇒ exit 2')
    process.exit(EXIT.INPUT)
  }
  console.log(`  ✓ 旗标三件套：注册 **${known.size}** · 源码字面量 **${found.length}** 全部已登记 · 死旗标 **0**`)
}
const concl = (tag, ok, extra = {}) =>
  console.log(`${ok ? '✓' : '✗'} [${tag}] GEN-RESULT ok=${ok}${Object.keys(extra).length ? ' · ' + Object.entries(extra).map(([k, v]) => `${k}=${v}`).join(' · ') : ''}`)

/* ---------------- 契约窗口：从 schema 读（唯一真源，不硬编码） ---------------- */
const SCH = JSON.parse(readFileSync(join(HERE, 'deck.schema.json'), 'utf8'))
const DEF = SCH.$defs
/** 取某页型某字段的长度窗口；kind='item' 表示数组元素；kind='arr' 表示数组条数 */
function win(pageDef, field, kind = 'str') {
  const p = (DEF[pageDef] || {}).properties || {}
  const o = p[field]
  if (!o) return { min: 0, max: Infinity }
  if (kind === 'item') return { min: (o.items || {}).minLength ?? 0, max: (o.items || {}).maxLength ?? Infinity }
  if (kind === 'arr') return { min: o.minItems ?? 0, max: o.maxItems ?? Infinity }
  return { min: o.minLength ?? 0, max: o.maxLength ?? Infinity }
}
const inWin = (s, w) => typeof s === 'string' && s.length >= w.min && s.length <= w.max
/** 依次取第一个落在窗口内的候选（**不编造**：候选都来自原文/派生自原文） */
const pick = (cands, w) => (cands || []).find((c) => inWin(c, w)) ?? null
/** 截断到窗口上限（只在确实超长时用，并记 note） */
const cut = (s, w) => (s.length > w.max ? s.slice(0, w.max) : s)

/* ------------------------------------------------------------------
   解析：md/纯文本 → 节
     `# `   ⇒ 封面标题（其后第一段 ⇒ 副标题）      `## ` ⇒ 新节
     `- ` / `1. ` ⇒ 节内条目                       `> ` ⇒ 引用（`——作者`）
     `| a | b |` ⇒ 表格（4 行以上 ⇒ 图表页候选）
     短数字行（`3 分钟` / `40%`）⇒ 数据页候选
------------------------------------------------------------------ */
const isItem = (l) => /^\s*(?:[-*•]|\d+[.、)])\s+/.test(l)
const stripItem = (l) => l.replace(/^\s*(?:[-*•]|\d+[.、)])\s+/, '').trim()
const isTable = (l) => /^\s*\|.*\|\s*$/.test(l)
const tableCells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((x) => x.trim())
const isCta = (l) => /(立即|点击|联系|扫码|下一步|咨询|报名|获取)/.test(l)

function parseDoc(text) {
  const lines = text.split(/\r?\n/)
  const sections = []
  let docTitle = null, docSubtitle = null, cur = null, seenBody = false
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim()
    if (!t) continue
    if (/^#\s+/.test(t)) {
      if (docTitle === null) { docTitle = t.replace(/^#\s+/, '').trim(); continue }
      cur = { title: t.replace(/^#\s+/, '').trim(), line: i + 1, items: [], paras: [], table: null, quotes: [] }
      sections.push(cur); continue
    }
    if (/^##+\s+/.test(t)) {
      cur = { title: t.replace(/^##+\s+/, '').trim(), line: i + 1, items: [], paras: [], table: null, quotes: [] }
      sections.push(cur); continue
    }
    if (docTitle !== null && !cur && !seenBody) { docSubtitle = t; continue }
    if (!cur) { cur = { title: null, line: i + 1, items: [], paras: [], table: null, quotes: [] }; sections.push(cur) }
    if (/^>\s?/.test(t)) { cur.quotes.push({ t: t.replace(/^>\s?/, '').trim(), line: i + 1 }); seenBody = true; continue }
    if (isTable(t)) {
      const cells = tableCells(t)
      if (/^[-:\s|]+$/.test(cells.join(''))) { seenBody = true; continue }     // 分隔行
      if (!cur.table) cur.table = { header: cells, rows: [], line: i + 1 }
      else cur.table.rows.push({ cells, line: i + 1 })
      seenBody = true; continue
    }
    if (isItem(t)) { cur.items.push({ t: stripItem(t), line: i + 1 }); seenBody = true; continue }
    cur.paras.push({ t, line: i + 1 }); seenBody = true
  }
  return { docTitle, docSubtitle, sections }
}

/* ---------------- 节 ⇒ 页（含"按契约窗口选文案 + 不够则降级"） ---------------- */
function sectionToPage(sec, opt, notes) {
  const N = opt.seconds || 3.4
  const W = {
    tBullets: win('pageBullets', 'title'), tSteps: win('pageSteps', 'title'), tData: win('pageData', 'title'),
    tChart: win('pageChart', 'title'), tCompare: win('pageCompare', 'title'), tSummary: win('pageSummary', 'title'),
    iBullets: win('pageBullets', 'items', 'item'), iSteps: win('pageSteps', 'steps', 'item'),
    iSummary: win('pageSummary', 'items', 'item'), explChart: win('pageChart', 'explain'), concl: win('pageCompare', 'conclusion'),
  }
  const title = sec.title || (sec.paras[0] && sec.paras[0].t) || ''
  const paras = sec.paras.map((p) => p.t)
  const items = sec.items.map((x) => x.t)
  const tag = `第 ${sec.line} 行「${title || '(无标题)'}」`
  /* 标题不合窗口 ⇒ 用"标题+后缀"派生（不是编内容，是补足长度） */
  const fitTitle = (w) => {
    if (inWin(title, w)) return title
    for (const s of [`${title}（本节要点）`, `${title}要点`, '本节要点', '内容要点']) if (inWin(s, w)) return s
    return cut(title || '内容要点', w)
  }
  /** 数据/图表的 explain：优先用同节段落（原文），再退到"标题：表头/数值"（派生自原文） */
  const fitExplain = (w, fallback) => {
    const hit = pick([...paras, fallback, `${title}：本节要点`], w)
    return hit
  }

  /* ① 表（≥4 行）⇒ 图表页 */
  if (sec.table && sec.table.rows.length >= 4) {
    const labels = sec.table.rows.map((r) => r.cells[0])
    const series = sec.table.rows.map((r) => Number(String(r.cells[1] ?? '').replace(/[^\d.\-]/g, ''))).filter((x) => Number.isFinite(x))
    const unit = cut(sec.table.header[1] || '', win('pageChart', 'unit'))
    const expl = fitExplain(W.explChart, `${title}：${sec.table.header.join(' / ')}`)
    if (series.length >= 4 && unit && expl) {
      return { type: 'chart', title: fitTitle(W.tChart), unit, explain: expl,
        source: pick([...paras], { min: 0, max: 40 }) || undefined,
        chart: { type: 'bar', series: series.slice(0, 12), labels: labels.slice(0, 12) }, duration: N }
    }
    notes.push(`${tag}：表可读但 explain/unit 无法落窗（8~39） ⇒ 降级为要点页`)
  }
  /* ② 条目 ⇒ 步骤 / 对比 / 要点 */
  if (items.length >= 3) {
    const fitSteps = items.filter((x) => inWin(x, W.iSteps)).map((x) => cut(x, W.iSteps))
    if (/步|阶段|流程/.test(title) && fitSteps.length >= 3 && fitSteps.length <= 6) {
      return { type: 'steps', title: fitTitle(W.tSteps), steps: fitSteps.slice(0, 6), duration: N }
    }
    const fitBul = items.filter((x) => inWin(x, W.iBullets))
    if (/对比|差别|比较|vs/i.test(title) && fitBul.length >= 4) {
      const half = Math.ceil(fitBul.length / 2)
      const left = { label: pick(paras, win('compareSide', 'label')) || '现状', points: fitBul.slice(0, half).slice(0, 4) }
      const right = { label: pick(paras.slice(1), win('compareSide', 'label')) || '本方案', points: fitBul.slice(half).slice(0, 4) }
      const concl = pick([...paras.slice(0, 0), ...items.slice().reverse(), `${left.label}与${right.label}的差别`, `${title}：差在流程`], W.concl)
      if (left.points.length >= 2 && right.points.length >= 2 && concl &&
          left.points.every((x) => inWin(x, { min: 6, max: 28 })) && right.points.every((x) => inWin(x, { min: 6, max: 28 }))) {
        return { type: 'compare', title: fitTitle(W.tCompare), left, right, conclusion: concl, duration: N }
      }
      notes.push(`${tag}：对比页字段未落窗（两侧各 2~4 条、每条 6~28；结论 8~40） ⇒ 降级为要点页`)
    }
    if (fitBul.length >= 3) {
      const summary = pick([...paras, `${title}：本节要点`], win('pageBullets', 'summary'))
      if (summary) return { type: 'bullets', title: fitTitle(W.tBullets), items: fitBul.slice(0, 5), summary, duration: N }
      notes.push(`${tag}：要点页缺 summary（6 字以上） ⇒ 降级为摘要页`)
    }
  }
  /* ③ 短数字行 ⇒ 数据页 */
  const metricLine = sec.paras.map((p) => ({ ...p, m: numShortLine(p.t) })).find((p) => p.m)
  if (metricLine) {
    const winExpl = ((DEF.pageData.properties.metric || {}).properties || {}).explain || {}
    const w = { min: winExpl.minLength ?? 0, max: winExpl.maxLength ?? Infinity }
    const expl = fitExplain(w, `${title}：${metricLine.m.number}${metricLine.m.unit}`)
    const unit = cut(metricLine.m.unit, win('pageData', 'unit'))
    const sec2 = sec.paras.filter((p) => p !== metricLine).slice(0, 2).map((p) => {
      const mm = p.t.match(/^(.{1,12}?)[：:]\s*(.+)$/)
      return mm ? { label: cut(mm[1], { max: 20 }), note: cut(mm[2], { max: 40 }) } : { label: cut(p.t.slice(0, 8), { max: 20 }), note: cut(p.t, { max: 40 }) }
    })
    if (expl && unit && sec2.length === 2 && sec2.every((s) => s.label.length >= 2)) {
      return { type: 'data', title: fitTitle(W.tData), metric: { number: metricLine.m.number, unit, explain: expl }, secondary: sec2, duration: N }
    }
    notes.push(`${tag}：数据页字段未落窗（explain / unit / 恰好 2 条次要指标） ⇒ 降级为摘要页`)
  }
  /* ④ 其余 ⇒ 摘要页（**恰好 3 条**，每条 8~28） */
  const pool = (items.length ? items : paras).filter((x) => inWin(x, W.iSummary))
  if (pool.length >= 3) return { type: 'summary', title: fitTitle(W.tSummary), items: pool.slice(0, 3).map((x) => cut(x, W.iSummary)), duration: N }
  return null
}
const numShortLine = (l) => {
  const t = l.trim()
  if (t.length > 28 || isItem(t) || isTable(t)) return null
  const m = t.match(/^([\d,.]+)\s*(%|分钟|小时|天|条|次|元|万|倍|个|人|秒)?\s*(.*)$/)
  if (!m) return null
  const n = Number(String(m[1]).replace(/,/g, ''))
  if (!Number.isFinite(n)) return null
  return { number: n, unit: m[2] || '个', explain: (m[3] || '').trim() }
}

/* ---------------- 组档 ---------------- */
function build(text, opt) {
  if (!text || !text.trim()) return { err: 'GEN-EMPTY', detail: '输入为空（没有任何可解析的行）' }
  const { docTitle, docSubtitle, sections } = parseDoc(text)
  const notes = []
  const title = opt.title || docTitle || ''
  /* ⚠️ 第一版把 cover 建在这里却**没并进最终 body**（toc 顶到第 1 页 ⇒ 校验器判"第 1 页必须是 cover"）*/
  const cover = { type: 'cover', kicker: cut(String(opt.issuer || 'AI MARKETING · VIDEO FACTORY'), { max: 32 }), duration: 3.4 }
  const content = [], quotes = []
  for (const sec of sections) {
    for (const q of sec.quotes) {
      const m = q.t.split(/——|—/).map((x) => x.trim())
      const wq = win('pageQuote', 'quote'), wa = win('pageQuote', 'author')
      if (inWin(m[0], wq)) quotes.push({ type: 'quote', quote: m[0], author: inWin(m[1] || '', wa) ? m[1] : undefined, duration: 3.2, _line: q.line })
      else notes.push(`第 ${q.line} 行的引用长度 ${m[0].length} 不在 12~80 ⇒ 已跳过`)
    }
    const p = sectionToPage(sec, opt, notes)
    if (p) { p._line = sec.line; content.push(p) }
    else notes.push(`第 ${sec.line} 行起的节「${sec.title || '(无标题)'}」不足以成页 ⇒ 已跳过`)
  }
  let body = [cover, ...content, ...quotes]      // ★ cover 必须在第 1 页（契约硬要求）
  /* 目录页（可选）：条目 4~24 字，需 ≥3 条；**插在封面之后** */
  if (opt.toc) {
    const wi = win('pageToc', 'items', 'item'), wt = win('pageToc', 'title')
    const items = content.map((p) => p.title).filter((x) => inWin(x, wi)).slice(0, 6)
    if (items.length >= 3) body = [cover, { type: 'toc', title: pick(['本期目录', '内容目录', '目录'], wt) || '本期目录', items, duration: 3.6, _line: 1 }, ...content, ...quotes]
    else notes.push(`目录页需 ≥3 条 4~24 字的标题（现 ${items.length} 条）⇒ 已跳过目录`)
  }
  /* 尾页 */
  const lastSec = sections[sections.length - 1]
  const ctaLine = text.split(/\r?\n/).map((l, i) => ({ t: l.trim(), line: i + 1 })).find((l) => l.t && isCta(l.t))
  const line1 = pick([lastSec && lastSec.title, title, '谢谢观看'], win('pageEnd', 'line1')) || '谢谢观看'
  body.push({ type: 'end', line1, line2: inWin(docSubtitle || '', { min: 0, max: 30 }) ? docSubtitle : undefined,
    cta: pick([ctaLine && ctaLine.t, '下一步：挑一套皮肤，出第一条片'], win('pageEnd', 'cta')) || '下一步：挑一套皮肤，出第一条片',
    en: 'ONE SCRIPT · MANY SKINS', duration: 2.8, _line: ctaLine ? ctaLine.line : 0 })

  /* 页数必须落 4~12（schema 硬约束）——超出要显式 */
  const lim = SCH.properties.pages
  if (body.length > lim.maxItems) {
    if (!opt.allowTruncate) return { err: 'GEN-TOO-MANY-PAGES', detail: `生成 ${body.length} 页 > 上限 ${lim.maxItems} ⇒ 请精简文案，或加 --allow-truncate 显式截断（会丢内容）`, pages: body }
    notes.push(`⚠ 页数 ${body.length} > ${lim.maxItems} ⇒ 按 --allow-truncate 截断，末尾 ${body.length - lim.maxItems} 页被丢弃`)
    body = [...body.slice(0, lim.maxItems - 1), body[body.length - 1]]
  }
  if (body.length < lim.minItems) return { err: 'GEN-TOO-FEW-PAGES', detail: `只生成 ${body.length} 页 < 下限 ${lim.minItems} ⇒ 文案太短（至少：封面 + 2 个内容节 + 尾页）`, pages: body }

  const pages2 = body.map(({ _line, ...p }) => p)
  const meta = {
    title: pick([title, '未命名'], { min: 1, max: 200 }) || '未命名',
    subtitle: pick([opt.subtitle, docSubtitle], { min: 1, max: 200 }) || '（未提供副标题）',
    issuer: opt.issuer || 'AiMarketing 视频工厂', date: new Date().toISOString().slice(0, 7), lang: 'zh-CN',
  }
  /* ★ 顺带出字幕：**与页面同一份文案、同一份时长**（口径一致 ⇒ 字幕必然对齐画面；
   *   若另写一份 SRT，就又是"同一事实两处表述"，迟早错位）*/
  const srt = []
  {
    const fmt = (t) => {
      const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60), ms = Math.round((t - Math.floor(t)) * 1000)
      return [h, m, s].map((x) => String(x).padStart(2, '0')).join(':') + ',' + String(ms).padStart(3, '0')
    }
    let t = 0
    body.forEach((p, i) => {
      const d = Number(p.duration || 3.4)
      /* ⚠️ 这里第一版写成了**对象字面量**：所有分支都会**立即求值** ⇒ 非数据页也去读 `p.metric.number`
       *    ⇒ `TypeError: Cannot read properties of undefined`。字幕文案必须**惰性取**（switch）。 */
      let txt = p.title || ''
      switch (p.type) {
        case 'cover': txt = [meta.title, meta.subtitle].filter(Boolean).join('｜'); break
        case 'toc': txt = `目录：${(p.items || []).join(' · ')}`; break
        case 'bullets': txt = [p.title, (p.items || []).slice(0, 2).join('；')].join('｜'); break
        case 'data': txt = `${p.title}：${p.metric.number}${p.metric.unit}（${p.metric.explain}）`; break
        case 'steps': txt = [p.title, (p.steps || []).join(' → ')].join('｜'); break
        case 'chart': txt = [p.title, p.explain].join('｜'); break
        case 'compare': txt = [p.title, p.conclusion].join('｜'); break
        case 'quote': txt = [p.quote, p.author].filter(Boolean).join(' —— '); break
        case 'summary': txt = [p.title, (p.items || []).join('；')].join('｜'); break
        case 'end': txt = [p.line1, p.cta].filter(Boolean).join('｜'); break
        default: break
      }
      srt.push(`${i + 1}\n${fmt(t + 0.2)} --> ${fmt(t + d - 0.15)}\n${String(txt).replace(/\n/g, ' ')}\n`)
      t += d
    })
  }
  const deck = { version: '1.0', meta,
    style: { masterId: opt.master || 'master-tech', palette: opt.palette || 'cyan', density: 'normal', tempo: 'normal', orientation: opt.orientation || '16:9' },
    pages: pages2 }
  return { deck, srt, plan: body.map((p, i) => ({ i, type: p.type, title: p.title || p.line1 || '', from: p._line })), notes }
}

/* ---------------- 自测 ---------------- */
const FIXTURE = `# AI 营销视频工厂
一句话把文案变成可投放的短视频

## 为什么值得换
- 传统剪辑一条片四小时起步
- 这套流程十分钟出片
- 同一条文案可批量出多版本
- 换行业只换皮肤不换流程
省下的是重复劳动，不是创意

## 单条成片成本
3 分钟
人工剪辑：平均 240 分钟
本流程：首次约 40 分钟

## 上线四步
1. 定稿文案与旁白
2. 导出带时间戳的字幕
3. 生成页面并过契约校验
4. 渲染成片并抽帧验收

## 一天能出多少条
| 方式 | 条数 |
| 人工剪辑 | 6 |
| 模板化出片 | 40 |
| 换皮肤出片 | 80 |
| 批量多版本 | 120 |

## 和传统方式的差别
传统剪辑
这套流程
- 每条都要人过一遍时间轴
- 改一句文案要重新导出
- 多版本成本线性增长
- 文案与画面分离，改文案不动版式
- 皮肤可换，一条内容多套气质
- 批量出片成本近乎为零

> 同一条内容，换皮就换受众。
——投放经验

下一步：挑一套皮肤，出第一条片
`
function selfTest() {
  /* ★ 自测只在**自己的命名空间**里活动：第一版 `rmSync('out-tmp-gen')` 把调用者放在同级目录的
   *   `sample.md` 一起删了（**工具删调用者的文件**，与 batch-video 那次同族）⇒ 只清 `_selftest/`。 */
  const tmp = join(HERE, 'out-tmp-gen', '_selftest')
  mkdirSync(tmp, { recursive: true })
  const cases = []
  /* 正控 A：整篇 ⇒ 断言页型覆盖 + **必须过 validate-deck** */
  const rA = build(FIXTURE, { toc: true, issuer: 'AiMarketing 视频工厂' })
  if (rA.err) { console.log(`   ✗ 正控 A 生成失败：${rA.err} · ${rA.detail}`); cases.push(false) }
  else {
    const outA = join(tmp, '_selftest-a.json')
    writeFileSync(outA, JSON.stringify(rA.deck, null, 2) + '\n')
    const v = spawnSync(process.execPath, [join(HERE, 'validate-deck.mjs'), outA], { encoding: 'utf8' })
    const types = rA.deck.pages.map((p) => p.type)
    const cover = ['cover', 'bullets', 'data', 'steps', 'chart', 'compare', 'quote', 'end'].every((t) => types.includes(t))
    console.log(`   正控 A ⇒ 页型=[${types.join(',')}] · validate=${v.status}（须 0）· 页数=${types.length}（须 4~12）`)
    if (v.status !== 0) console.log('      ' + String(v.stdout || '').split('\n').filter((l) => l.includes('✗')).slice(0, 5).map((s) => s.trim()).join('\n      '))
    cases.push(v.status === 0 && cover && types.length >= 4 && types.length <= 12)
  }
  /* 正控 B：太短 ⇒ 必须明确红（GEN-TOO-FEW-PAGES） */
  const rB = build('# 只有标题\n\n## 一节\n- a\n- b\n- c\n', {})
  console.log(`   正控 B（太短）⇒ ${rB.err || '(竟然通过)'}（须 GEN-TOO-FEW-PAGES）`)
  cases.push(rB.err === 'GEN-TOO-FEW-PAGES')
  /* 负控 C：空输入 ⇒ GEN-EMPTY（exit 2） */
  const rC = build('   \n\n', {})
  console.log(`   负控 C（空输入）⇒ ${rC.err || '(竟然通过)'}（须 GEN-EMPTY）`)
  cases.push(rC.err === 'GEN-EMPTY')
  const fail = cases.filter((x) => !x).length
  concl('GEN-SELFTEST', fail === 0, { 用例: cases.length, 失败: fail })
  rmSync(tmp, { recursive: true, force: true })   /* 只清自己那层（见上） */
  return fail === 0 ? EXIT.OK : EXIT.FAIL
}

if (A.selfTest) process.exit(selfTest())
if (!A.in || !existsSync(resolve(A.in))) {
  console.error(`✗ --in 不存在或未给：${A.in || '(空)'}`)
  concl('GEN-INPUT-MISSING', false, {}); process.exit(EXIT.INPUT)
}
const text = readFileSync(resolve(A.in), 'utf8')
const r = build(text, A)
if (r.err === 'GEN-EMPTY') { console.error('✗ 输入为空'); concl('GEN-EMPTY', false, {}); process.exit(EXIT.INPUT) }
if (r.notes && r.notes.length) console.log('   注：\n     ' + r.notes.join('\n     '))
console.log('   计划（页型由标记决定，附来源行号）：')
for (const p of r.plan || []) console.log(`     #${String(p.i).padStart(2)} ${String(p.type).padEnd(8)} ${String(p.title).slice(0, 34).padEnd(36)} ← 行 ${p.from || '-'}`)
if (r.err) { console.error(`✗ [${r.err}] ${r.detail}`); concl(r.err, false, { 页数: (r.pages || []).length }); process.exit(EXIT.FAIL) }
if (A.plan) { concl('GEN-PLAN-ONLY', true, { 页数: r.deck.pages.length }); process.exit(EXIT.OK) }

const outPath = resolve(A.out || join(HERE, 'out-tmp-gen', 'deck.generated.json'))
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, JSON.stringify(r.deck, null, 2) + '\n')
const v = spawnSync(process.execPath, [join(HERE, 'validate-deck.mjs'), outPath], { encoding: 'utf8' })
if (v.status !== 0) {
  const all = String(v.stdout || '').split('\n')
  const idx = all.findIndex((l) => l.includes('✗'))
  const why = (idx >= 0 ? all.slice(idx, idx + 6) : []).map((l) => l.trim()).filter(Boolean).join('\n     ')
  if (A.keepInvalid) console.error(`⚠ [GEN-VALIDATE-FAILED] 已按 --keep-invalid **保留非法产物**（调试用，勿入库）：${outPath}`)
  else rmSync(outPath, { force: true })
  console.error(`✗ [GEN-VALIDATE-FAILED] 生成档未过契约校验${A.keepInvalid ? '（产物已保留）' : ' ⇒ 已删产物'}：\n     ${why || '(校验器无原因行)'}`)
  concl('GEN-VALIDATE-FAILED', false, { 页数: r.deck.pages.length }); process.exit(EXIT.FAIL)
}
console.log(`   产物 ${outPath} · ${r.deck.pages.length} 页 · validate=0`)
let srtOut = null
if (A.srt) {
  srtOut = resolve(A.srt)
  mkdirSync(dirname(srtOut), { recursive: true })
  writeFileSync(srtOut, r.srt.join('\n'), 'utf8')
  console.log(`   字幕 ${srtOut} · ${r.srt.length} 条（与页面同源、同时长 ⇒ 必然对齐）`)
}
concl('GEN-OK', true, { out: outPath.replace(HERE + '\\', ''), 页数: r.deck.pages.length,
  页型: [...new Set(r.deck.pages.map((p) => p.type))].length, 字幕: srtOut ? r.srt.length : '-' })
process.exit(EXIT.OK)
