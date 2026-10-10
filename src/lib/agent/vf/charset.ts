/**
 * ★VF_CHARSET_V1（2026-10-09 用户实测「动不动就出问题 · 出片被 fonts 闸门拦」）
 * =============================================================================
 * 引擎内嵌字体是**子集**（GB2312 一级 3755 + ASCII + 中文标点，字表见
 * `scripts/video-factory/html-deck/fonts/chars-cmn.txt`）：缺字在开发机上有系统字体兜底
 * （**看不出来**），**服务器上直接渲成豆腐块** ⇒ 引擎用 `check-page-fonts.mjs` 把出片拦死。
 *
 * 但"拦死"对用户就是"出片失败"。本次实测的连环坑：
 *   AI 写了「珍馐」（馐 表外）⇒ 校验拦下 ⇒ 降级去**读图总结**里取词 ⇒ 取到「涮羊肉片」
 *   ⇒ **还是表外字**（涮 也不在字表里，提示词里专门禁过）⇒ 出片被 fonts 闸门拦。
 *
 * ⇒ 口径：凡是**我们自己产的文案**（AI 写的 / 降级拼句的 / 别的入口传进来的），出片前先
 *   **压回字表内**，而不是等引擎拦：
 *     · 表外字：**删掉那个字**（只做减法，绝不新增词句 —— 反 AI 味规矩：不许编造）；
 *     · 删完做一次清理（连续/首尾的分隔符）。
 * ★扩表 B（2026-10-10 用户定案）：字表已从「GB2312 一级 3755」扩到「**GB2312 全集 6763**」
 *   （`fonts/chars-cmn.txt` 6940 码点）⇒ 原来那张"同义替换表（涮→烫）"**清空** ——
 *   它是当时字表缺字的补救，而「涮」是正经火锅用词，**不该被改词**（改了反而不专业）。
 *   将来若真撞到表外字，正确做法是**扩表重算子集**（`fonts/make-fonts.py`），而不是改文案。
 * ⚠️ 本模块是这条口径的**唯一实现**：确认卡那侧（vf-htmlfilm）与出片前兜底（vf-film）都调它。
 *    引擎那道 fonts 闸门**保持不动** —— 它是最后一道防线，不是干活的。
 */
import fs from 'node:fs'

/** 同义替换表：**已清空**（扩表 B 后字表覆盖了「涮/糍/粑」这类词，不再需要改词补救）。
 *  保留结构：万一将来必须临时替换某个字，在这里加一项即可（改词只做最小必要）。 */
const SWAP: Record<string, string> = {}

const SEP = '[，、·:：|｜\\s]'

let cachedPath = ''
let cachedSet: Set<string> | null = null

/** 读字表（进程内缓存）。路径由调用方给：`filmToolsDir()/fonts/chars-cmn.txt` */
export function loadCharset(charsFile: string): Set<string> {
  if (cachedSet && cachedPath === charsFile) return cachedSet
  const set = new Set<string>()
  try {
    const txt = fs.readFileSync(charsFile, 'utf8')
    for (const ch of txt) if (ch !== '\n' && ch !== '\r' && ch !== '\uFEFF') set.add(ch)
  } catch { /* 读不到字表 ⇒ 空集（调用方据此跳过压缩，不误删） */ }
  cachedPath = charsFile
  cachedSet = set
  return set
}

/** 单个字符串 → 压回字表内。返回 [新串, 被删/被换的字]（无变化时第二项为空串） */
export function sanitizeText(s: string, set: Set<string>): [string, string] {
  const src = String(s || '')
  if (!src || !set.size) return [src, '']
  let dropped = ''
  let out = ''
  for (const ch of src) {
    if ((ch.codePointAt(0) || 0) < 128) { out += ch; continue }   // ASCII 一律放行（可见 ASCII 100% 在表内）
    if (set.has(ch)) { out += ch; continue }
    const rep = SWAP[ch]
    if (rep && set.has(rep)) { out += rep; dropped += ch + '→' + rep; continue }
    dropped += ch                                                  // 表外字：只做减法，绝不换词编造
  }
  out = out.replace(new RegExp(SEP + '{2,}', 'g'), (m) => m[0])
    .replace(new RegExp('^' + SEP + '+|' + SEP + '+$', 'g'), '')
    .trim()
  return [out, dropped]
}

/** slots（含字符串数组）→ 压回字表内；返回新对象与"改了哪些键"的清单（供日志/如实告知） */
export function sanitizeSlots(slots: any, set: Set<string>): { slots: any; drops: Array<{ k: string; from: string; to: string; dropped: string }> } {
  const drops: Array<{ k: string; from: string; to: string; dropped: string }> = []
  if (!slots || typeof slots !== 'object' || !set.size) return { slots, drops }
  const out: any = {}
  for (const k of Object.keys(slots)) {
    const v: any = slots[k]
    if (typeof v === 'string') {
      const [nv, d] = sanitizeText(v, set)
      if (d) drops.push({ k, from: v, to: nv, dropped: d })
      out[k] = nv
    } else if (Array.isArray(v)) {
      out[k] = v.map((x: any) => {
        if (typeof x !== 'string') return x
        const [nv, d] = sanitizeText(x, set)
        // ★数组项（chips / rows 这类**短标签**）：删字后只剩 1 个字就"读不成词"了（如「微膻」→「微」）
        //   ⇒ **整条丢掉**更干净；字符串字段则保留删字结果（那常是该镜唯一的文案，不能丢空）
        if (d && nv.length < 2) {
          drops.push({ k, from: x, to: '（整条去掉）', dropped: d })
          return null
        }
        if (d) drops.push({ k, from: x, to: nv, dropped: d })
        return nv
      }).filter((x: any) => x !== null)
    } else {
      out[k] = v
    }
  }
  return { slots: out, drops }
}
