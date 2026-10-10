/**
 * ★VF_VLMODEL_V2（2026-10-10 用户实测：`qwen-vl-max` 返回 404 model_not_found）
 * =============================================================================
 * 病因（用真实数据核对过）：**模型 id 会随供应商改名/下线**，而本仓库把 `qwen-vl-max`
 * 写死在十几处（读图 / 抖音自动化 / 定位器…）。用户账号实测：`/models` 列表里
 * **根本没有** `qwen-vl-max` / `qwen-vl-plus` / `qwen3-vl-max`，唯一的通用视觉模型是
 * **`qwen3-vl-plus`**（另有 `*omni*` 系可看图，`qwen-vl-ocr` 是 OCR 专用不算）。
 * ⇒ 6 次 404 ⇒ 成片线"读图 0/17 张" ⇒ 文案只能瞎猜（用户看到的"文案很泛"就是这么来的）。
 *
 * 现口径（**不再靠记性猜名字**）：
 *   ① `VF_VL_MODEL` 指定 ⇒ 听你的（最高优先级）；
 *   ② 否则**问 `/models` 列出来再按优先级挑**（`pickVlModelFromList`，纯函数、可单测）；
 *   ③ 接口拿不到（网络/权限）⇒ 退回静态候选链 `VL_FALLBACKS`。
 * 排序口径：通用视觉（`-vl-`）> 版本新 > max > plus；`*omni*` 次之（能看图但偏实时/音频）；
 * `ocr / embedding / rerank / tts / asr / image / livetranslate / mt-` 一律排除。
 */

/** 静态候选链（只在"列不出来"时用；**顺序 = 尝试顺序**） */
export const VL_FALLBACKS: string[] = [
  'qwen3-vl-plus',
  'qwen-vl-max',
  'qwen-vl-max-latest',
  'qwen3-vl-max',
  'qwen-vl-plus',
  'qwen3.8-omni-flash',
  'qwen3.5-omni-plus',
  'qwen3-omni-flash',
]

/** 明确不能当"通用读图"的模型（按 id 排除） */
const VL_EXCLUDE = /ocr|embedding|rerank|tts|asr|livetranslate|^qwen-image|[^a-z]image[^a-z]|deep-research|deep-search|mt-|coder|math|longcontext|character/i

/**
 * 给一个模型 id 打分（越高越适合"看素材照片并描述"）；返回 -1 = 不能用。
 * 纯函数 ⇒ 可拿真实 `/models` 返回做回归测试（见 temp/_vlm/test.mjs）。
 */
export function rankVlModel(id: string): number {
  const s = String(id || '').trim()
  if (!s) return -1
  if (VL_EXCLUDE.test(s)) return -1
  let score = 0
  const isVl = /-vl-/i.test(s)
  const isOmni = /omni/i.test(s)
  if (!isVl && !isOmni) return -1                       // 既不是 VL 也不是 omni ⇒ 不能看图
  if (isVl) score += 100
  if (isOmni) score += 30                               // 能看图的次选（偏实时/音频场景）
  if (/max/i.test(s)) score += 20
  if (/plus/i.test(s)) score += 10
  const ver = s.match(/qwen(\d+(?:\.\d+)?)/i)           // qwen3.8 / qwen3 / qwen2.5 …
  if (ver) score += Math.min(9, Math.round(Number(ver[1]) * 2))
  if (/flash/i.test(s)) score += 1                      // 同档里"快"的略优（便宜、延迟低）
  return score
}

/** 从 `/models` 返回的 id 列表里挑一个最适合读图的（挑不到 ⇒ ''） */
export function pickVlModelFromList(ids: string[]): string {
  let best = ''
  let bestScore = 0
  for (const id of ids || []) {
    const sc = rankVlModel(id)
    if (sc > bestScore) { bestScore = sc; best = String(id) }
    // 同分时保留先出现的（列表通常是稳定顺序）
  }
  return best
}

/** 环境变量指定的模型（可钉死；也可用于临时换模型） */
export function vlEnvOverride(): string {
  return String(process.env.VF_VL_MODEL || process.env.DASHSCOPE_VL_MODEL || '').trim()
}

/** 判"模型不存在"这一类错误（只有这类才值得换名字重试） */
export function isVlModelMissing(e: any): boolean {
  const s = String((e && e.message) || e)
  return /model_not_found|Model not exist|does not exist|invalid.*model|模型不存在/i.test(s)
}
