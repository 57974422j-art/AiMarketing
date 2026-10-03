#!/usr/bin/env node
/**
 * crosscheck-deck-json.mjs —— **deck JSON 真渲染路**（"双路交叉校验"的第二路；team-lead 要求）
 *
 * 为什么需要它：量表 `measure-sweep.mjs` 用的是 **HTML 注入法**（在已渲染产物里替换文字再测）。
 * 若"注入方式"本身引入偏差（例如改了 DOM 却漏了别处引用同一文案的地方），量表给出的上限就不可复核。
 * ⇒ 本工具走**源头路**：改 `examples/` 下各 deck JSON 的**字段**（如 `meta.title`）→ **真渲染** → 同一个判据闸门读结论。
 *
 * 用法：
 *   node crosscheck-deck-json.mjs --json examples/deck.master-v1.json --field meta.title \
 *        --cls cover-title --ks 36,37,38 [--outdir out-xcheck] [--pathA 37]
 *
 * 输出（每 k 一行，**两路都报原始读数**）：
 *   k · 读回长度 · 门 exit · 判据内 codes（稳定帧原文）· 结论
 * 判读规则（team-lead）：**两路不一致 ⇒ 先查"注入方式是否引入偏差"**；不许取平均、不许以某一路为准。
 */
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'   /* ★ ④-2：覆盖 schema 只写**仓库外**（%TEMP%） */
import { DECK_DIR } from './paths.mjs'
import { resolveHyperframes } from './engine-bin.mjs'
import { pageNoOfSelector, settledAt } from './timing.mjs'
import { domTarget } from './dom-target.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
/* ★ 记录每个 flag 消费掉的下标 ⇒ 事后检查**未识别参数**（这正是 `--ks 37 38` 被拆成两个 argv 时暴露的信号：
   `38` 成了没人认领的位置参数 ⇒ 必须 exit 2，而不是静默只用 37、"临界+1 恒缺"） */
const _consumed = new Set()
const arg = (k, d) => {
  const i = args.indexOf(k)
  if (i >= 0) { _consumed.add(i); _consumed.add(i + 1); return args[i + 1] }
  return d
}
const NODE = process.execPath
const JSONF = arg('--json', 'examples/deck.master-v1.json')
const FIELD = arg('--field', 'meta.title')
const CLS = arg('--cls', 'cover-title')
const KS = String(arg('--ks', '37,38')).split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n))
/* ★★ 并发安全一（team-lead ②-1）：**默认 outdir 唯一化** —— 不再默认共享 `out-xcheck`。
   事故（2026-10-03）：team-lead 与我**并发**跑同一默认 outdir ⇒ 他读到的是被并发改写的产物 ⇒
   得到一个"看起来正常但错"的数（k=37 闸门 exit 报 1，实际 0）——比报错危险得多。显式指定时才用指定值。 */
const OUT = arg('--outdir', '') || `out-tmp-xcheck-${process.pid}-${Date.now().toString(36)}`
/* ★ **工具自洁**（team-lead ①卫生）：**未显式指定 `--outdir`** 时，退出即删本进程自建的临时目录
   （显式指定 ⇒ 保留：那是调用方要的产物；`--keep` 亦可保留）。事故：`out-tmp-*` 一度 287 个 / 2.8 GB。 */
const AUTO_OUT = !arg('--outdir', '')
if (AUTO_OUT && !process.argv.includes('--keep')) {
  process.on('exit', () => { try { rmSync(OUT, { recursive: true, force: true }) } catch { /* ignore */ } })
}
/* ★ team-lead ④-2：`--raise-max <字段>=<值>` ⇒ **仅量测**地把该字段的 schema `maxLength` 临时抬到 <值>，
   让第二路**真能跑到 k=判据**（期望：k 过闸 · k+1 因**版式**（overlap/overflow）不过 ⇒ 与第一路真交叉）。
   实现：把覆盖后的 schema 写到 **仓库外**（os.tmpdir()），只给本次子进程设 `DECK_SCHEMA_OVERRIDE`；
   validate-deck 会**打印告示**。发版闸门不设该 env ⇒ 永远走真 schema。 */
const RAISE_MAX = arg('--raise-max', '')       // 形如 "pages.1.title=57"（leaf=值）
/* ★ team-lead ③-1：**读回口径换算** —— 有些字段的**元素文本 = 输入值 + 模板常量**（如 `meta.issuer` 的元素 =
   `出品：` + issuer + ` · ` + date ⇒ 常量 **13**）⇒ 判据按**输入口径**给（827），而读回按**元素口径**（840）。
   ⇒ `--readback-offset <n>`：断言 `读回 == k + n`。**offset 属该格元数据**（模板常量），不许靠"目测"绕过。 */
const RB_OFFSET = Number(arg('--readback-offset', '0') || 0)
let OVERRIDE_ENV = null
if (RAISE_MAX) {
  /* ★ team-lead ③-2：`--raise-max` 的两条**断言**（此前只判"有没有命中"，抬错/抬不动都会静默）：
     ① **只许抬不许降**：`val ≤ 现 maxLength` ⇒ 抬了个寂寞（测量仍被旧上限拒）⇒ **红**（exit 2）；
     ② **目标叶必须在命中清单里**（不在 ⇒ 红 = 抬没生效）。
     ⚠️ 裸叶名会命中**多个**（`title`/`explain`/`items`）：只抬不降 ⇒ 无害，但**必须打印命中数**让量测者确认目标在其中；
     也支持**整指针**精确指定（`--raise-max "#/$defs/meta/properties/issuer=847"`）⇒ 只命中那一个。 */
  const [leafSpec, valStr] = RAISE_MAX.split('=')
  const val = Number(valStr)
  const sp = join(DECK_DIR, 'deck.schema.json')
  const sch = JSON.parse(readFileSync(sp, 'utf8'))
  const hit = []
  const walk = (node, ptr) => {
    if (!node || typeof node !== 'object') return
    if (node.maxLength !== undefined && (ptr === leafSpec || ptr.endsWith('/' + leafSpec))) {
      if (!(val > node.maxLength)) {
        /* ★ team-lead ③-2 文案**分两支**（「抬不动」有两种完全不同的处置，别让人猜）：
           ① val < 现上限 ⇒ **只许抬**（降值 = 抬了个寂寞，测量仍会被旧上限拒）；
           ② val == 现上限 ⇒ **无需抬**：现上限已足够跑到判据+1 ⇒ **去掉 --raise-max** 直接跑。 */
        if (val === node.maxLength) {
          console.error(`✗ --raise-max **无需抬**：${ptr} 现 maxLength=${node.maxLength}，与 val 相等 ⇒ 这次抬没意义 ⇒ 请**去掉 --raise-max** 直接跑（现上限已足够）⇒ exit 2`)
        } else {
          console.error(`✗ --raise-max **只许抬、不许降**：${ptr} 现 maxLength=${node.maxLength}，而 val=${val} < 它 ⇒ **抬没生效**（测量仍会被旧上限拒）⇒ exit 2`)
        }
        process.exit(2)
      }
      node.maxLength = val; hit.push(ptr)
    }
    for (const k of Object.keys(node)) walk(node[k], `${ptr}/${k}`)
  }
  walk(sch, '#')
  if (!hit.length) { console.error(`✗ --raise-max：schema 里找不到 leaf=${leafSpec} 的 maxLength ⇒ exit 2（**抬没生效**）`); process.exit(2) }
  /* ② 目标叶在命中清单里（用整指针指定时必须**精确命中**该指针） */
  const exact = leafSpec.startsWith('#/')
  if (exact ? !hit.includes(leafSpec) : !hit.some((p) => p.endsWith('/' + leafSpec))) {
    console.error(`✗ --raise-max：目标 ${leafSpec} **不在命中清单**${'[' + hit.join(', ') + ']'} ⇒ 抬没生效 ⇒ exit 2`); process.exit(2)
  }
  const tmp = join(tmpdir(), `deck.schema.override.${process.pid}.json`)
  writeFileSync(tmp, JSON.stringify(sch, null, 2), 'utf8')
  OVERRIDE_ENV = tmp
  console.log(`  ★★ **仅量测**：把 ${hit.join(' / ')} 的 maxLength 抬到 ${val} —— 命中 **${hit.length}** 个${hit.length > 1 ? '（裸叶名会命中多个：只抬不降 ⇒ 无害，但**请确认量测目标是其中之一**；可用整指针精确指定）' : ''}（覆盖 schema 写于仓库外 ${tmp}）`)
}
const PATH_A = arg('--pathA', '')          // 第一路（HTML 注入）给出的临界，仅用于打印对照

/** 深设 `a.b.c` 路径字段 */
function setPath(obj, path, val) {
  const parts = path.split('.')
  let cur = obj
  for (let i = 0; i < parts.length - 1; i++) {
    const p = /^\d+$/.test(parts[i]) ? Number(parts[i]) : parts[i]
    if (cur[p] == null) cur[p] = {}
    cur = cur[p]
  }
  const last = /^\d+$/.test(parts[parts.length - 1]) ? Number(parts[parts.length - 1]) : parts[parts.length - 1]
  cur[last] = val
}

const leftovers = args.filter((a, i) => !_consumed.has(i))
if (leftovers.length) {
  console.error(`✗ 未识别的参数：${leftovers.join(' ')}（提示：\`--ks\` 必须写成 **一个** 参数，如 \`--ks "37,38"\`；拆成两个位置参数会被静默忽略 ⇒ "临界+1 恒缺"那类错。§25b ⇒ exit 2）`)
  process.exit(2)
}
const src = resolve(DECK_DIR, JSONF)
if (!existsSync(src)) { console.error(`✗ 找不到 deck JSON：${src}（§25b ⇒ exit 2）`); process.exit(2) }
const base = JSON.parse(readFileSync(src, 'utf8'))
const outRoot = resolve(DECK_DIR, OUT)
mkdirSync(outRoot, { recursive: true })
/* ★★ 并发安全二（team-lead ②-2）：**锁文件 + 存活检测** —— 发现另一进程在用同一 outdir ⇒ exit 2（明说）。 */
const LOCK = join(outRoot, '.xcheck.lock')
const alive = (pid) => { try { process.kill(pid, 0); return true } catch (e) { return !!e && e.code === 'EPERM' } }
{
  let got = false
  for (let attempt = 0; attempt < 2 && !got; attempt++) {
    try {
      const fd = openSync(LOCK, 'wx')      // ★ 独占创建：已存在即抛 EEXIST（比"先查再写"无竞态）
      writeFileSync(fd, JSON.stringify({ pid: process.pid, t: new Date().toISOString(), outdir: OUT }))
      closeSync(fd); got = true
    } catch (e) {
      if (e.code !== 'EEXIST') { console.error(`✗ 无法创建锁文件 ${LOCK}：${e.message}（§25b ⇒ exit 2）`); process.exit(2) }
      let info = null
      try { info = JSON.parse(readFileSync(LOCK, 'utf8')) } catch { info = null }
      const other = info && Number(info.pid)
      if (other && other !== process.pid && alive(other)) {
        console.error(`✗ **另一进程正在使用同一输出目录**（${OUT} · pid=${other} · 起于 ${info.t}）⇒ 读数是并发污染的 ⇒ **exit 2**（team-lead ②-2）`)
        console.error(`   处置：换一个 outdir（本工具默认已唯一化），或等它结束。`)
        process.exit(2)
      }
      console.log(`  ⚠ 发现**陈旧锁**（pid=${other || '?'} 已不在）⇒ 清除后重试（这是并发事故的残留，不是正常状态）`)
      try { rmSync(LOCK, { force: true }) } catch { /* ignore */ }
    }
  }
  if (!got) { console.error('✗ 取锁失败（重试后仍冲突）⇒ exit 2'); process.exit(2) }
  process.on('exit', () => { try { rmSync(LOCK, { force: true }) } catch { /* ignore */ } })
}
/* ★★ 并发安全三（team-lead ②-3）：**测量期防篡改** —— 每行记产物指纹，测量期间被改写 ⇒ exit 2（不许照常出结论）。 */
const fp = (p) => { try { const s = statSync(p); return `${s.size}:${Math.round(s.mtimeMs)}` } catch { return 'missing' } }
const HF = resolveHyperframes().p        // ★ 返回 {p, why}（`resolveHyperframes().p` 才是可执行路径；与 measure-sweep 同口径）

console.log(`=== deck JSON 真渲染路（第二路）===`)
console.log(`  源 = ${JSONF} · 字段 = ${FIELD} · 检测点 = .${CLS} · 变体 k = [${KS.join(', ')}] · 出目录 = ${OUT}${PATH_A ? ` · 第一路(HTML 注入)临界 = ${PATH_A}` : ''}`)
const rows = []
const tamper = []                       // ★ 测量期产物被改写的行（⇒ 结论作废）
for (const k of KS) {
  const variant = JSON.parse(JSON.stringify(base))
  setPath(variant, FIELD, '汉'.repeat(k))
  /* ★ team-lead ③（更省事、假设更少）：变体**写在源档同目录**（前缀 `__tmp_`、**不匹配 `deck*.json` 声明档 glob**）
     ⇒ **天然免疫相对素材语义**：`cover.asset`（相对**母版**目录）与 `image.asset`（相对**源档**目录）都按原语义解析。
     事故回顾：写在 `out-tmp-xcheck-*` 时，image 页报"素材文件不存在：<临时目录>/assets/test-media.png" ⇒ **整档被拒渲染
     ⇒ 我的自证出现假红**（团队 lead 把同一变体放到源档同目录 ⇒ render exit=0 定死了这一点）。跑完即删（`exit` 钩子兜底）。 */
  const srcAbs = resolve(DECK_DIR, JSONF)
  const vj = join(dirname(srcAbs), `__tmp_xcheck-k${k}.json`)
  process.on('exit', () => { try { rmSync(vj, { force: true }) } catch { /* ignore */ } })
  writeFileSync(vj, JSON.stringify(variant, null, 2), 'utf8')
  const deckName = basename(vj).replace(/\.json$/, '')
  /* ⚠️ **不许** `shell: true`：Windows 下 `process.execPath` 含空格（`C:\Program Files\nodejs\…`）
     ⇒ shell 拼接会把路径拆坏（实测：三行全"渲染 ✗"）。传数组、不用 shell 即可（§25a：失败原因要原样打印）。 */
  const r = spawnSync(NODE, [join(HERE, 'render-deck.mjs'), vj, '--outdir', join(DECK_DIR, OUT)], {
    cwd: HERE, encoding: 'utf8',
    /* ★ ④-2：只在 **--raise-max** 时把覆盖 schema 传给子进程（validate-deck 会打印告示） */
    env: OVERRIDE_ENV ? { ...process.env, DECK_SCHEMA_OVERRIDE: OVERRIDE_ENV } : process.env,
  })
  /* ★ 渲染是变体的**唯一消费者** ⇒ 渲染一结束就删（`exit` 钩子只作兜底）。
     实测：只靠 exit 钩子会残留 `__tmp_xcheck-k37/k38.json` 在 `examples/`（会污染声明档/锚点扫描）。 */
  try { rmSync(vj, { force: true }) } catch { /* ignore */ }
  const prod = join(DECK_DIR, OUT, deckName)
  const renderOk = r.status === 0 && existsSync(join(prod, 'index.html'))
  const fpRender = renderOk ? fp(join(prod, 'index.html')) : 'n/a'   // ★ 渲染完成即取指纹（防篡改基线）
  if (!renderOk) {
    const raw = (r.stdout || '') + (r.stderr || '')
    const tail = raw.split('\n').map((s) => s.trim()).filter(Boolean).slice(-4)
    console.log(`  k=${k} 渲染失败 exit=${r.status} ⇒ 原样末 4 行：`)
    for (const l of tail) console.log(`      ${l.slice(0, 170)}`)
    /* ★ team-lead ④-1：**拒绝原因必须归属正确** —— 末 4 行常常是 JSON 回显（无用），
       这里把校验器的**错误消息**单独抽出来（`"msg": "…"` / `"path": "…"`）⇒ 让"是不是 schema 上限拦的"可判。 */
    const msgs = [...raw.matchAll(/"path"\s*:\s*"([^"]+)"[\s\S]{0,200}?"msg"\s*:\s*"([^"]+)"/g)].slice(0, 6)
    if (msgs.length) {
      console.log(`      拒绝原因（校验器 error/msg，共 ${msgs.length} 条，最多列 6）：`)
      for (const mm of msgs) console.log(`        · ${mm[1]} ⇒ ${mm[2].slice(0, 150)}`)
    } else {
      console.log('      拒绝原因：**未解析到 path/msg**（若是 schema 上限，应看到"超出上限 N 字"）')
    }
  }
  // ① 读回（注入是否生效）：产物 HTML 里目标元素文本长度
  let back = -1, selCount = -1
  if (renderOk) {
    /* ★ 读回也走 **唯一实现** `dom-target.mjs`（支持 `li:first-child .t` 这类唯一形态），并把**命中数**带回：
       `count !== 1` ⇒ 目标不明确 ⇒ 读数无意义（与量表的"唯一命中断言"同一口径）。 */
    const html = readFileSync(join(prod, 'index.html'), 'utf8')
    const tg = domTarget(html, CLS)
    selCount = tg.count
    back = tg.count ? html.slice(tg.openEnd, tg.closeStart).replace(/<[^>]+>/g, '').trim().length : -1
  }
  // ② 判据码：在"该字段所在页的稳定帧"上直接问引擎（`timing.mjs` 唯一实现）
  let codes = [], at = '', no = ''
  if (renderOk) {
    const n = pageNoOfSelector(prod, CLS) || 1
    const st = settledAt(prod, n)
    if (st) {
      no = n; at = st.at.toFixed(3)
      const cr = spawnSync(HF, ['check', prod, '--json', '--at', at, '--no-contrast'], { encoding: 'utf8', shell: true })
      const out = String(cr.stdout || '')
      const i = out.indexOf('{')
      try {
        const j = JSON.parse(out.slice(i))
        codes = (j.layout?.findings || []).map((f) => String(f.code))
      } catch { codes = ['(JSON 不可解析)'] }
    }
  }
  // ③ 闸门口径（与量表的判据**同一套**：--assert-overlap --assert-decor）
  /* ⚠️ 两个坑都要躲（team-lead 实测抓到）：
     ① **不许 `shell: true`** —— Windows 下 `process.execPath` 含空格（"Program Files"）⇒ shell 拼接把命令拆坏
        ⇒ 进程以 1 退出 ⇒ **闸门 exit 列变成假红**（k=37 报 1，而直接跑闸门是 0）；
     ② 机器可读真源 = **闸门自己打印的 `GATE-RESULT {...}`**（二手 `status` 只作对拍，不作结论）。 */
  let gateExit = null, gateResult = null, gateRaw = '(未跑)', gateVerdict = ''
  if (renderOk) {
    const g = spawnSync(NODE, [join(HERE, 'check-engine-lint.mjs'), prod, '--assert-overlap', '--assert-decor', '--no-contrast'], { cwd: HERE, encoding: 'utf8' })
    gateExit = g.status
    const gout = String(g.stdout || '') + String(g.stderr || '')
    gateVerdict = gout.split('\n').map((s) => s.trim()).filter((s) => /^结论:/.test(s)).pop() || ''
    const m = /GATE-RESULT\s+(\{[^\n]*\})/.exec(gout)
    if (m) { gateRaw = `GATE-RESULT ${m[1]}`; try { gateResult = JSON.parse(m[1]) } catch { gateResult = null } }
    else gateRaw = '(无 GATE-RESULT 行) ⇒ 闸门末 3 行：' + gout.split('\n').map((s) => s.trim()).filter(Boolean).slice(-3).join(' ｜ ')
  }
  /* ★ 对拍断言（team-lead ③："两处不得各说各的"）：进程 status 与闸门自报 ok 必须互推（status==0 ⇔ ok） */
  let pairViol = null
  if (renderOk && gateResult) {
    const expectStatus = gateResult.ok ? 0 : 1
    if (gateExit !== expectStatus) pairViol = `工具捕获 exit=${gateExit} ↔ 闸门自报 ok=${gateResult.ok}（应为 exit=${expectStatus}）`
  } else if (renderOk && !gateResult) pairViol = '闸门未打印 GATE-RESULT（拿不到机器可读真源）'
  /* ★ 指纹防篡改：**渲染完成即取**，读完（引擎 + 闸门）再取一次 —— 两次不一致 ⇒ 本轮读数作废（并发改写） */
  const fpAfter = renderOk ? fp(join(prod, 'index.html')) : 'n/a'
  const tampered = renderOk && fpAfter !== fpRender
  if (tampered) tamper.push(`k=${k}：测量期间产物被改写（${fpRender} → ${fpAfter}）`)
  rows.push({ k, renderOk, back, at, no, codes, gateExit, gateResult, gateRaw, gateVerdict, pairViol, fpBefore: fpRender, fpAfter })
  console.log(`  k=${String(k).padStart(3)} · 渲染 ${renderOk ? 'ok' : '✗'} · 读回 ${back}/${k}${back === k + RB_OFFSET ? ' ✓' : ' ✗'}${RB_OFFSET ? `（口径：元素 = k + offset ${RB_OFFSET}）` : ''} · 页 ${no || '-'} · 稳定帧 t=${at || '-'} · 判据内 codes = [${codes.join(', ')}]`)
  console.log(`       闸门真源：${gateRaw}${gateVerdict ? ' ⇒ ' + gateVerdict : ''}`)
  if (pairViol) console.error(`       ✗ 对拍不一致：${pairViol}`)
}
/* 双路对照（只对"临界 / 临界+1"两个点做定论；多 k 只是旁证） */
/* ★ **参数自检**（team-lead ③）：要求"打印出的行数 == 期望点数" —— 防 `--ks 37 38` 被拆成两个 argv 那类
   "参数错导致恒定缺行"（我踩过一次：临界+1 恒缺、而报表面上看不出）。 */
if (rows.length !== KS.length) {
  console.error(`✗ 参数自检：期望 ${KS.length} 个 k（[${KS.join(', ')}]），实际取到 ${rows.length} 行 ⇒ 参数/解析不符（§25b ⇒ exit 2）`)
  process.exit(2)
}
const bad = rows.filter((r) => !r.renderOk || r.back !== r.k + RB_OFFSET)
if (bad.length) { console.error(`✗ 有 ${bad.length} 行渲染失败或读回不符 ⇒ **读数无意义**（§25b：先过读回再谈读数）⇒ exit 2`); process.exit(2) }
const pair = rows.filter((r) => r.pairViol)
if (pair.length) { console.error(`✗ 有 ${pair.length} 行"工具 exit ↔ 闸门自报"对拍不一致 ⇒ 该列不可信 ⇒ **不许据此下结论**（exit 2）`); process.exit(2) }
if (tamper.length) { console.error(`✗ 有 ${tamper.length} 行**测量期产物被改写**（并发写同一 outdir）⇒ 读数不可信 ⇒ exit 2：`); for (const t of tamper) console.error(`     · ${t}`); process.exit(2) }
/* 结论行只在"三关都过"之后才允许输出（读回 / 对拍 / 防篡改）—— 这也是并发事故的教训：宁可不出结论。 */
console.log(`\n  判读：每行都以 **闸门同一判据**（--assert-overlap --assert-decor）在**该字段所在页的稳定帧**上读结论；`)
console.log(`        第一路（HTML 注入）临界 = ${PATH_A || '(未提供)'}；两路不一致 ⇒ **先查注入方式是否引入偏差**（不许取平均/不许以某一路为准）。`)
/* 退出码：本工具只负责"把第二路的原始读数取回来"（读数可信 = 渲染成功且读回 == k，否则上面已 exit 2）；
   两路是否一致由**人/表**判定（不许工具替我们下"哪一路为准"的结论）。 */
process.exit(0)
