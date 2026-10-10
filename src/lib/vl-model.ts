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

/** 同 isVlModelMissing —— 名字更中性（**写字/工具调用**那条线也用同一个判据，别再抄一遍正则） */
export function isModelMissing(e: any): boolean {
  return isVlModelMissing(e)
}

/* ═════════ ★VF_TEXTHEAL_V1（2026-10-10 用户线上实测）═════════
   病灶：`[模型] 大脑=qwen3.8-flash ｜ 书写=deepseek-v4-flash` —— 而
     **本账号百炼里没有 deepseek-v4-flash**（列表里只有 deepseek-r1-distill-qwen-1.5b）
     ⇒ [DashScope] 404 model_not_found + [DashScope FC] 404 + [deepseek] 400
     ⇒ 文案只写出一半 ⇒ 卡片上出现「第四张 · 第五张」这种降级拼句。
   口径：**文本书写模型也要能"缺失即换"** —— 换的规则写在这里（纯函数，可单测）。 */

/** 明确不能拿来"写文案"的模型（图/音/嵌/检索/翻译/代码/实时/超长上下文专用） */
const TEXT_EXCLUDE = /ocr|-vl-|omni|embedding|rerank|tts|asr|livetranslate|realtime|image|mt-|coder|math|longcontext|qwen-long|character|deep-research|deep-search|audio/i

/** 参数规模型开源 id（qwen2-7b / qwen3.5-35b-a3b / deepseek-r1-distill-qwen-1.5b）——
 *  这些是"小/开源档"，**不拿它当文案书写**（质量差、还会写跑偏） */
const TEXT_SMALL_OPEN = /distill|-\d+(\.\d+)?b($|-)|-\d+b-a\d+b/i

/** 首选顺序（都是纯文本对话模型；**只在"目标名字不存在"时才用它挑**） */
export const TEXT_MODEL_PREF = [
  'qwen3.8-flash', 'qwen3.8-plus', 'qwen3.8-max',
  'qwen3.7-flash', 'qwen3.7-plus', 'qwen3.7-max',
  'qwen3.6-flash', 'qwen3.6-plus', 'qwen3.5-flash', 'qwen3.5-plus',
  'qwen-max', 'qwen-plus', 'qwen-flash',
]

/** 给一个模型 id 打分（越高越适合"写文案"）；-1 = 不能当书写模型 */
export function rankTextModel(id: string): number {
  const s = String(id || '').trim()
  if (!s) return -1
  if (TEXT_EXCLUDE.test(s) || TEXT_SMALL_OPEN.test(s)) return -1
  const i = TEXT_MODEL_PREF.indexOf(s)
  if (i >= 0) return 1000 - i                     // 首选表内：越靠前越高
  if (/^deepseek/i.test(s)) return 500            // 表外但同族（若账号真托管 deepseek 文本模型，优先它）
  if (/^qwen/i.test(s)) return 200                // 其它 qwen 文本模型
  return 50
}

/** 从 `/models` 列表里挑一个能写文案的;`prefer` 真在列表里 ⇒ 原样返回（不自作主张换掉能用的） */
export function pickTextModelFromList(ids: string[], prefer = ''): string {
  const want = String(prefer || '').trim()
  const list = Array.isArray(ids) ? ids : []
  if (want && list.includes(want)) return want
  let best = '', bestScore = 0
  for (const id of list) {
    const sc = rankTextModel(id)
    if (sc > bestScore) { bestScore = sc; best = String(id) }
  }
  return best
}
