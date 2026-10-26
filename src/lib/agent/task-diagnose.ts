/* ═══════════════════════════════════════════════════════════════════════════
 * ★VF_TASK_TRACE_V1-D3（2026-10-26 用户定案）【AI 读日志出结论】
 *
 * 用户原话（三句）：
 *   ① 「看不到 AI 回复，每次要去服务器找很烦」
 *   ② 「几万字人看不懂」
 *   ③ 「这个是否给 AI 看，人只看原因」
 * ⇒ 口径：**人看结论，AI 看原文**。日志原文只在"原始日志"折叠里给，人看的是 3~5 条人话结论。
 *
 * 硬约束（prompt 里写死，**不许改软**）：
 *   1. 每条结论**必须引用日志里的一行原文**（`evidence`）；**找不到就写「日志里没记这一项」**；
 *   2. **不许推测**日志里没出现的原因；
 *   3. 输出 3~5 条，每条 ≤40 字；
 *   4. **只诊断，不给代码改动建议**（避免 AI 乱开药方）。
 *
 * 模型：`deepseek-flash`（官方 API 实测 1.8s、便宜；见 ai-providers 的 VF_DS_DIRECT_V1）。
 * 日志过长：**只取尾部 200 行 + 首个错误行**（见 `pickLogSlice`）。
 *
 * ⚠️ 这一层绝不"编"：模型没按格式返回 / 全被过滤掉 ⇒ 走 `scanLogFindings` 的**确定性抽取**
 *    （从日志里挑出真实报错行），抽不到就如实回「日志没有异常」。
 * ═══════════════════════════════════════════════════════════════════════════ */
import { generateText } from '@/lib/ai-providers'

export interface TaskDiagnosis {
  /** 哪一步/什么现象（≤40 字） */
  what: string
  /** 为什么（≤40 字）——只写日志能支撑的原因 */
  why: string
  /** **日志原文**（必须来自日志；找不到就是「日志里没记这一项」） */
  evidence: string
  /** 怎么办（≤40 字，只给"人该做什么"，不给代码改动建议） */
  fix: string
}

/** 尾部保留行数（文档口径：200 行） */
const TAIL_LINES = 200

/** 判定"这一行是错误"的样子（确定性回退也用它 ⇒ **只认日志真有的东西**）
 *  ⚠️ 用 `new RegExp` 拼而不是长字面量：正则字面量里换行会直接语法错误（这里以前踩过）。 */
const ERR_RE = new RegExp([
  '失败', '错误', '异常', '不支持', '不存在', '超时', '拒绝', '终止', '中止', '未找到',
  '✗', '❌', '🚫', 'Traceback', 'Error', 'ERROR', 'Exception',
  'FAIL', 'fail', 'failed', 'timeout', 'Timeout', 'ENOENT', 'EACCES', 'OOM',
  'code=1\\b', 'exit=1\\b', '\\bHTTP 4\\d\\d\\b', '\\bHTTP 5\\d\\d\\b', '\\bcode=5\\d\\d\\b',
].join('|'))

/** 结论条数上下限 */
const MIN_N = 3
const MAX_N = 5
/** 单条字数上限（文档口径 40 字；`evidence` 是原文，不算在内，但也会截断防爆） */
const MAX_CHARS = 40

const clamp = (s: unknown, n = MAX_CHARS) => {
  const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n - 1) + '…' : t
}

/**
 * 取出给模型看的那一段日志：**尾部 200 行 + 首个错误行**。
 * 为什么要"首个错误行"：真凶常常在很早的位置（如闸门第 1 轮失败），只看尾部 200 行会漏掉它，
 * 但把整份日志（几万字）丢给模型既是烧钱也是截断。
 */
export function pickLogSlice(logText: string): string {
  const text = String(logText || '')
  if (!text.trim()) return ''
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  if (lines.length <= TAIL_LINES) return text
  const tail = lines.slice(-TAIL_LINES)
  const firstErr = lines.findIndex((l) => ERR_RE.test(l))
  // 首个错误行落在被丢掉的前段里 ⇒ 单独提上来（带一行上下文）
  if (firstErr >= 0 && firstErr < lines.length - TAIL_LINES) {
    const ctx = lines.slice(Math.max(0, firstErr - 1), firstErr + 2)
    return ['……（前面省略）', ...ctx, '……（中间省略）', ...tail].join('\n')
  }
  return ['……（前面省略，只保留尾部 ' + TAIL_LINES + ' 行）', ...tail].join('\n')
}

/** 日志里有没有"像错误"的行（确定性判据，不靠模型） */
export function logHasError(logText: string): boolean {
  return String(logText || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .some((l) => ERR_RE.test(l))
}

/**
 * 确定性回退：直接从日志里抽取"真实报错行"，**零编造**。
 * 用在：模型没按格式返回 / 返回全被过滤 / 没有 key 或调用失败。
 */
export function scanLogFindings(logText: string, max = MAX_N): TaskDiagnosis[] {
  const lines = String(logText || '').replace(/\r\n/g, '\n').split('\n')
  const hits: string[] = []
  for (const l of lines) {
    const t = l.trim()
    if (!t) continue
    if (!ERR_RE.test(t)) continue
    if (hits.includes(t)) continue
    hits.push(t)
    if (hits.length >= max) break
  }
  if (!hits.length) return []
  return hits.map((h) => ({
    what: clamp('日志里出现失败标记'),
    why: clamp(h.replace(/^\[[^\]]*\]\s*/, '')),
    evidence: h.slice(0, 300),
    fix: clamp('看这条日志的上下文；需要时把原始日志发给开发'),
  }))
}

/** 「日志没有异常」——这是**结论**，不是编（有确定性判据支撑：尾部没有错误行） */
function noAnomaly(lastLine: string): TaskDiagnosis[] {
  return [{
    what: '日志没有异常',
    why: '尾部 200 行里没有任何失败/错误标记',
    evidence: lastLine ? lastLine.slice(0, 300) : '日志里没记这一项',
    fix: '不用处理；若成片不对，请把"原始日志"复制给开发',
  }]
}

function buildPrompt(slice: string): string {
  return [
    '你是「成片任务日志诊断器」。只做一件事：**从下面这份日志里读出发生了什么**，用中文给 3~5 条结论。',
    '',
    '【硬约束（违反即作废）】',
    '1. 每条结论必须**引用日志里的一行原文**放进 `evidence` 字段；**日志里没有的，`evidence` 就写「日志里没记这一项」**。',
    '2. **不许推测**日志里没有出现的原因（不要写"可能是…""通常是…""建议检查…"这类没有依据的话）。',
    '3. 只输出 3~5 条；`what`/`why`/`fix` 每条**不超过 40 字**。',
    '4. **只诊断，不给代码改动建议**（不要说改哪个文件/加什么逻辑）。',
    '5. 每个字段都是一行纯文本，不要换行、不要 markdown。',
    '',
    '【字段含义】',
    '- `what`：哪一步 / 什么现象（人话，例：「渲染阶段失败」）',
    '- `why`：为什么会这样（**只能来自日志**）',
    '- `evidence`：日志原文（一字不改地摘一行）',
    '- `fix`：**人**该做什么（例：「把素材换小一点再试一次」）',
    '',
    '【输出格式】只输出 JSON 数组，不要任何解释，例如：',
    '[{"what":"…","why":"…","evidence":"…","fix":"…"}]',
    '',
    '【日志（可能是尾部片段）】',
    '<<<',
    slice,
    '>>>',
  ].join('\n')
}

/** 从模型回复里抠 JSON 数组（容忍 markdown 围栏 / 前后废话） */
function parseJsonArray(txt: string): any[] {
  const s = String(txt || '').trim()
  if (!s) return []
  const fenced = s.replace(/^\s*```[a-zA-Z]*\s*/m, '').replace(/```\s*$/m, '').trim()
  const tryParse = (x: string): any[] => {
    try {
      const v = JSON.parse(x)
      return Array.isArray(v) ? v : (Array.isArray(v?.items) ? v.items : (Array.isArray(v?.data) ? v.data : []))
    } catch { return [] }
  }
  const direct = tryParse(fenced) || tryParse(s)
  if (direct.length) return direct
  const m = /\[[\s\S]*\]/.exec(fenced) || /\[[\s\S]*\]/.exec(s)
  if (m) return tryParse(m[0])
  return []
}

/**
 * ★主入口：读日志 ⇒ 3~5 条人话结论（每条带日志原文当证据）。
 * 绝不抛异常（诊断本身失败也要给确定性结论，不能把接口打 500）。
 */
export async function diagnoseTask(logText: string): Promise<TaskDiagnosis[]> {
  const text = String(logText || '')
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter((l) => l.trim())
  const lastLine = lines.length ? lines[lines.length - 1].slice(0, 300) : ''

  // ① 完全没有日志 ⇒ 如实说（不调模型，省钱也不用编）
  if (!text.trim()) {
    return [{
      what: '没有这单的日志',
      why: '这一单没有留下 trace 文件（老任务本来就不写）',
      evidence: '日志里没记这一项',
      fix: '重新跑一单；新任务会自动留日志',
    }]
  }

  // ② 确定性闸门：日志里一个错误标记都没有 ⇒ 「日志没有异常」（文档验收第 2 条）
  if (!logHasError(text)) return noAnomaly(lastLine)

  const slice = pickLogSlice(text)

  // ③ 交给模型（deepseek-flash：便宜快）；失败 / 格式不对 ⇒ 确定性抽取
  let items: any[] = []
  try {
    const raw = await generateText(buildPrompt(slice), 'deepseek-flash')
    items = parseJsonArray(String(raw || ''))
  } catch { items = [] }

  const out: TaskDiagnosis[] = []
  const seen = new Set<string>()
  for (const it of items) {
    if (!it || typeof it !== 'object') continue
    const what = clamp(it.what)
    const why = clamp(it.why)
    let evidence = String(it.evidence == null ? '' : it.evidence).replace(/\s+/g, ' ').trim().slice(0, 300)
    const fix = clamp(it.fix)
    if (!what) continue
    // ★证据校验：evidence 必须是日志里真的出现过的一行（否则一律降级为"日志里没记这一项"）
    //   —— 这是"不许编"的最后一道闸：模型编一句原文也会在这里被改成诚实说法。
    if (evidence && evidence !== '日志里没记这一项') {
      const norm = (x: string) => x.replace(/\s+/g, ' ').trim()
      const flat = norm(text)
      if (!flat.includes(norm(evidence).slice(0, Math.min(60, norm(evidence).length)))) {
        evidence = '日志里没记这一项'
      }
    }
    if (!evidence) evidence = '日志里没记这一项'
    const key = what + '|' + why
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ what, why, evidence, fix })
    if (out.length >= MAX_N) break
  }

  // ④ 不足 3 条 / 模型没给 ⇒ 用确定性抽取补齐（**只补日志里真有的报错行**）
  if (out.length < MIN_N) {
    for (const f of scanLogFindings(text, MAX_N)) {
      if (out.length >= MIN_N) break
      const key = f.what + '|' + f.why
      if (seen.has(key)) continue
      // 该行已经作为 evidence 出现过就不再重复
      if (out.some((o) => o.evidence === f.evidence)) continue
      seen.add(key)
      out.push(f)
    }
  }

  if (!out.length) return noAnomaly(lastLine)
  return out.slice(0, MAX_N)
}
