#!/usr/bin/env node
/**
 * engine-bin.mjs —— **引擎可执行文件解析的唯一实现**（K17 的结构性收口，不是"写进坑表"）
 *
 * 为什么单列：`hyperframes` 解析曾在 **4 处各写一份**（`check-engine-lint` / `render-deck` /
 * `check-coverage-matrix` / `measure-limits`）⇒ 只修了一处 ⇒ 另一处静默失效
 * （K17：render-deck 一直选中 PATH 上的 `hyperframes`，本机没装时**渲染静默失败**，
 *   而部署闸门走 `--no-render` 不渲染 ⇒ 一直没暴露）。
 *
 * 解析顺序：① `ENGINE_HF_BIN` ② `PATH`（交给 shell） ③ 开发回退 `<引擎根>/node_modules/.bin/hyperframes[.cmd]`
 * **全找不到 ⇒ 打印所有候选 + `exit 2`**（§25b：输入/环境错误 ≠ 判据失败，不许抛栈）。
 *
 * ★ **自断言**：本模块的候选数组定义在代码库里只允许出现 **1 次**（标记 `HF-CANDIDATES-SINGLE-DEF`）；
 *   出现 ≥2 次 ⇒ 说明又有人复制了一份 ⇒ `exit 2`。**让"人记得"变成"机器拦住"**。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 脚本目录（dev = `deck-contract/`；入库扁平后 = `html-deck/`） */
export const ENGINE_DIR = dirname(fileURLToPath(import.meta.url))
/* ★ 引擎根的推导也**收口到 paths.mjs**（同一套双布局探测；本模块只负责"bin 候选"这一件事） */
import { ENGINE_ROOT } from './paths.mjs'

// HF-DEF:ONLY-ONCE  ← 唯一一处候选定义（断言按此标记的**出现次数**计数；用法只 import，不许复制定义）
export function resolveHyperframes() {
  const root = ENGINE_ROOT
  const cands = [
    process.env.ENGINE_HF_BIN ? { p: process.env.ENGINE_HF_BIN, why: 'ENGINE_HF_BIN' } : null,
    { p: 'hyperframes', why: 'PATH（交给 shell 解析）' },
    { p: join(root, 'node_modules', '.bin', 'hyperframes' + (process.platform === 'win32' ? '.cmd' : '')), why: '开发回退 <引擎根>/node_modules/.bin' },
  ].filter(Boolean)
  // ★ 只认"**真实存在**"的候选；`PATH` 那条放**最后**兜底（否则本机没装 PATH 版时会被选中）
  // ★ 显式指定 `ENGINE_HF_BIN` 却**不存在** ⇒ **直接红**（§25b：环境不完整 ⇒ exit 2）。
  //   不许静默回退到开发副本 —— 否则"我在服务器上钉了版本"是**假话**，且"env 错误能冒泡"的自证不成立。
  if (process.env.ENGINE_HF_BIN && !existsSync(process.env.ENGINE_HF_BIN)) {
    console.error(`✗ ENGINE_HF_BIN 指向的路径不存在：${process.env.ENGINE_HF_BIN}`)
    console.error('   （**显式指定不许静默回退**；§25b：环境不完整 ⇒ exit 2，非判据失败）')
    for (const c of cands) console.error(`    · ${c.why} → ${c.p}${existsSync(c.p) ? ' ✓' : ' ✗'}`)
    process.exit(2)
  }
  const pick = cands.find((c) => existsSync(c.p)) || cands[cands.length - 1]
  if (!pick.why.startsWith('PATH') && !existsSync(pick.p)) {
    console.error('✗ 找不到 hyperframes（§25b：输入/环境不完整 ⇒ **exit 2**，非判据失败）—— 尝试过的候选：')
    for (const c of cands) console.error(`    · ${c.why} → ${c.p}${existsSync(c.p) ? ' ✓' : ' ✗'}`)
    console.error(`    （platform=${process.platform} · cwd=${process.cwd()}）`)
    console.error('    服务器上请显式设：ENGINE_HF_BIN=/opt/ppt-render/node_modules/.bin/hyperframes')
    process.exit(2)
  }
  return { p: pick.p, why: pick.why, candidates: cands }
}

/** 断言：**同一逻辑只许一处** —— **双重检测**（K17 补强）：
 *   ① **标记注释**出现次数（辅助判据）
 *   ② **候选数组的实质**出现次数（**主判据**）—— 指纹 = "`ENGINE_HF_BIN` 之后 200 字符内出现**带引号的** `hyperframes`"。
 *      ⇒ **只复制代码、不复制注释也照样被抓住**（否则断言只是"数注释"，可被绕过）。
 *  ★ 防自匹配：TOKEN 用**拼接**构造；指纹正则也**分段拼**（不写成整串字面量）。
 *  ★ 负向自证见 `README §25b`：`tmp-k17/` 两例（带标记副本 / 不带标记的裸代码副本）都必须 **exit 2**。 */
export function assertSingleHfDefinition() {
  const TOKEN = 'HF-DEF:' + 'ONLY-ONCE'
  // 指纹：候选数组的"实质"（ENGINE_HF_BIN 选项 + 紧跟的**带引号** hyperframes）
  // ★ 防自匹配（第一版踩过）：三片**不相邻**地拼 —— 否则本行源码自己就构成完整指纹 ⇒ 真源被误判 2 次 ✗
  const P1 = 'ENGINE_HF_'
  const P2 = 'BIN'
  const P3 = "'hyper" + "frames'"
  const FINGER = new RegExp(P1 + P2 + '[\\s\\S]{0,200}?' + P3, 'g')
  let files = []
  try { files = readdirSync(ENGINE_DIR).filter((f) => f.endsWith('.mjs')) } catch { return true }
  const occ = []
  const sub = []
  for (const f of files) {
    try {
      const t = readFileSync(join(ENGINE_DIR, f), 'utf8')
      const n = t.split(TOKEN).length - 1
      if (n) occ.push(`${f}×${n}`)
      const m = t.match(FINGER)
      if (m) sub.push(`${f}×${m.length}`)
    } catch { /* ignore */ }
  }
  const sum = (a) => a.reduce((s, x) => s + Number(x.split('×')[1] || 0), 0)
  const total = sum(occ)
  const subTotal = sum(sub)
  if (total !== 1 || subTotal !== 1) {
    console.error(`✗ K17 断言失败：**同一逻辑只能一处** —— 标记注释 ${total} 次（应 1）· **候选数组实质 ${subTotal} 次（应 1）**`)
    console.error(`   标记命中：${occ.join(', ') || '(无)'}`)
    console.error(`   实质命中：${sub.join(', ') || '(无)'}`)
    console.error('   规矩：解析只许一处（`engine-bin.mjs`）；其它脚本**只 import**，不许复制候选数组（**复制代码不复制注释同样会被抓住**）。')
    process.exit(2)
  }
  return { total, occ, subTotal, sub }
}

/* ★★ team-lead msg16 ①（K17 扩展 · ffmpeg 收口）：**外部媒体工具的解析也只许一处**。
   此前 ffmpeg 解析散在 **4 处**（`render-deck` 自带的 resolveBin · `check-master-manifest` 同款自带 ·
   `mux-video` 同款自带 · `batch-video` 直接写裸 `ffmpeg`）⇒ 与 hyperframes 那次同族（"只修一处 ⇒ 另一处静默失效"）。
   解析顺序：① `HYPERFRAMES_FFMPEG_PATH`（**显式指定却不存在 ⇒ 红，不许静默回退**）② 与之**同目录**的兄弟工具（ffprobe 与 ffmpeg 一般同目录）
   ③ `PATH`（交给 shell，**最后兜底**）。 */
// 本行标记 = `FF-DEF` 加 `:ONLY-ONCE`（唯一一处 ffmpeg/ffprobe 候选定义；断言按此标记 + 候选实质指纹计数）
// ⚠️ 注释里**不写完整标记字面量**：写了会让标记计数变成 2 ⇒ **断言把自己的真源判红**（与 HF 那次同款自匹配坑）。
export function resolveFfmpeg() { return resolveMediaBin('ffmpeg') }
/* ★「读该环境变量」**也走唯一实现**：否则别的文件为了"把渲染器用的 ffmpeg 报进 RESULT"而直接 `process.env…`
   ⇒ 断言会（正确地）判红。⇒ 需要它的人调本函数（**同一真源、同一处字面量**）。 */
export function ffmpegEnvPath() { return process.env.HYPERFRAMES_FFMPEG_PATH || null }
export function resolveFfprobe() { return resolveMediaBin('ffprobe') }
function resolveMediaBin(name) {
  const env = process.env.HYPERFRAMES_FFMPEG_PATH
  const extM = env ? /\.(exe|cmd|bat)$/i.exec(env) : null
  const cands = [
    env ? { p: env, why: '环境变量（渲染器同一个）' } : null,
    env ? { p: join(dirname(env), name + (extM ? extM[1] : '')), why: '与渲染器 ffmpeg **同目录的兄弟工具**' } : null,
    { p: name, why: 'PATH（交给 shell 解析）' },
  ].filter(Boolean)
  /* ★ 显式指定却**不存在** ⇒ **直接红**（§25b：环境不完整 ⇒ exit 2）—— 不许静默回退到 PATH，
     否则"我在服务器上钉了同一个 ffmpeg"是**假话**（与 resolveHyperframes 同一条纪律）。 */
  if (env && name === 'ffmpeg' && !existsSync(env)) {
    console.error(`✗ HYPERFRAMES_FFMPEG_PATH 指向的路径不存在：${env}`)
    for (const c of cands) console.error(`    · ${c.why} → ${c.p}${existsSync(c.p) ? ' ✓' : ' ✗'}`)
    console.error('    （显式指定不许静默回退；§25b ⇒ exit 2，非判据失败）')
    process.exit(2)
  }
  const hit = cands.find((c) => existsSync(c.p))
  if (hit) return { p: hit.p, why: hit.why, candidates: cands }
  const last = cands[cands.length - 1]      /* PATH 兜底：existsSync 判不了 shell 解析 ⇒ 交给它 */
  return { p: last.p, why: last.why, candidates: cands }
}

/** 断言：**ffmpeg/ffprobe 的解析也只许一处** —— 与 `assertSingleHfDefinition` 同构的**双重检测**：
 *   ① 标记注释 `FF-DEF:ONLY-ONCE` 出现次数 == 1；
 *   ② **其它文件里**出现该环境变量字面量 / 候选实质指纹 ⇒ 红（"复制代码不复制注释"同样被抓住）。
 *  ★ 为什么"其它文件里必须为 0"而不是"全局必须为 1"：本模块自己要多次提到该环境变量（代码 + 报错文案）⇒
 *    "全局 == 1"会把**正常用法**判红（假阳性）。⇒ 判据落在**"别人有没有复制"**上。 */
export function assertSingleFfDefinition() {
  const TOKEN = 'FF-DEF:' + 'ONLY-ONCE'
  const P1 = 'HYPERFRAMES_FFMPEG_'
  const P2 = 'PATH'
  const P3 = "'ff" + "mpeg'"
  const FINGER = new RegExp(P1 + P2 + '[\\s\\S]{0,200}?' + P3, 'g')
  let files = []
  let readFail = 0                                  /* ★ 会说话：读失败要计数（哑 catch 会被棘轮咬 —— 实测被咬） */
  try { files = readdirSync(ENGINE_DIR).filter((f) => f.endsWith('.mjs')) } catch { readFail++ }
  const self = 'engine-bin.mjs'
  const occ = [], sub = [], envHit = [], bareHit = []
  /* ★ **第三条检测（team-lead ⑤ 的"清扫后加断言"）**：其它文件里**裸调用两个媒体工具**的次数必须为 **0**
     —— 断言若只数环境变量字面量，**裸用法**（无视渲染器钉住的那个 ffmpeg）就漏掉 ⇒ "有的工具尊重、有的不尊重" ✗。
     ⚠️ 注释里**不写完整字面量**（写了会被任何一次朴素 grep 命中，我本人已第三次踩这条）
     ⚠️ **防自匹配**：模式**分片拼接**（源码里从不出现连续的裸调用字面量）—— 与上面 FINGER 同款。 */
  const B1 = 'spa' + 'wnSync\\('      /* ⚠️ `(` 必须转义（第一次漏了 ⇒ `new RegExp` 抛 Unterminated group） */
  const B2 = "'ff" + "mpeg'"
  const B3 = "'ff" + "probe'"
  const BARE = new RegExp(B1 + B2 + '|' + B1 + B3, 'g')
  for (const f of files) {
    try {
      const t = readFileSync(join(ENGINE_DIR, f), 'utf8')
      if (f === self) continue                      /* 本模块 = 唯一实现所在地 ⇒ 只看别人 */
      const n = t.split(P1 + P2).length - 1
      if (n) envHit.push(`${f}×${n}`)
      const m = t.match(FINGER)
      if (m) sub.push(`${f}×${m.length}`)
      const b = t.match(BARE)
      if (b) bareHit.push(`${f}×${b.length}`)
    } catch { readFail++ }
  }
  const bareTotal = bareHit.reduce((s, x) => s + Number(x.split('×')[1] || 0), 0)
  try { const t = readFileSync(join(ENGINE_DIR, self), 'utf8'); const n = t.split(TOKEN).length - 1; if (n !== 1) occ.push(`${self}×${n}`) } catch { readFail++ }
  if (readFail) console.error(`   （K17-ff 自检：有 ${readFail} 处文件读取失败 ⇒ 计数可能不完整）`)
  const envTotal = envHit.reduce((s, x) => s + Number(x.split('×')[1] || 0), 0)
  const subTotal = sub.reduce((s, x) => s + Number(x.split('×')[1] || 0), 0)
  if (occ.length || envTotal !== 0 || subTotal !== 0 || bareTotal !== 0) {
    console.error('✗ K17-ff 断言失败：**ffmpeg 解析只许一处**（`engine-bin.mjs`）')
    console.error(`   标记注释：${occ.join(', ') || '1 ✓'}（应恰为 1）· **其它文件的候选定义/环境变量引用：${envTotal} 处（应 0）** · 候选实质指纹：${subTotal} 处（应 0）`)
    console.error(`   **裸调用（绕过唯一实现）：${bareTotal} 处（应 0）** —— 裸用法会**无视**渲染器钉住的同一个 ffmpeg`)
    if (envHit.length) console.error(`   环境变量命中：${envHit.join(', ')}`)
    if (sub.length) console.error(`   实质命中：${sub.join(', ')}`)
    if (bareHit.length) console.error(`   裸调用命中：${bareHit.join(', ')}`)
    console.error('   规矩：其它脚本**只 import `resolveFfmpeg` / `resolveFfprobe`**，不许复制候选数组、直接读该环境变量、或裸调 `ffmpeg`/`ffprobe`。')
    process.exit(2)
  }
  return { envTotal, subTotal, bareTotal, occ }
}

// 导入即自检（任何消费者都会触发 ⇒ 结构上拦住"复制一份"）
assertSingleHfDefinition()
assertSingleFfDefinition()
