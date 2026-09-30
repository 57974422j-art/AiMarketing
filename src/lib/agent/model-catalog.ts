/**
 * ★VF_MODELSWITCH_V1（2026-09-30）模型清单 / 档位 / 解析 —— 纯数据 + 纯函数（可自测、不联网、不烧钱）
 *
 * 为什么有这个东西（用户原话）：
 *   「先看一下是不是模型能力弱了……不行加一个模型切换，我试试，deepseek-v4.1_flash 和
 *     阿里的多模态模型 我切换这试试。**每个模型可能理解能力也不一样**。」
 * → 于是给服务端留两个「可切换槽位」：
 *     · brain  —— Agent 大脑（意图识别 / 工具调用），**必须支持 function calling**；
 *     · writer —— 分镜 / 文案书写（generateText）。
 *   用户在设置界面选档位（或自定义两个槽位），服务端按选择路由，方便逐个对比「理解能力」。
 *
 * 设计铁律（很重要）：
 *   任何非法 / 未知 / 空 / 脏输入 → 一律回落 `fast` 档（= 现状模型），**绝不抛异常**。
 *   切模型只是"试用"，绝不能因为用户手滑、或库里存了脏值，把成片 / 对话搞挂。
 *
 * 本文件只放【代码里已出现过 + 用户点名的】模型，不要自造新名字（避免路由到不存在的模型）。
 */

export type ModelSlot = 'brain' | 'writer'
export type ModelPresetId = 'fast' | 'strong-deepseek' | 'strong-qwen' | 'strong-qwen-latest' | 'custom'

export interface ModelInfo {
  /** 模型 id（直接传给各厂商 OpenAI 兼容接口的 model 字段） */
  id: string
  /** 中文名（界面展示） */
  name: string
  /** 厂商 */
  vendor: string
  /** 是否多模态（能看图） */
  multimodal: boolean
  /** 是否支持 function calling（brain 槽位必为 true，writer 无要求） */
  fc: boolean
  /** 可用的环境变量：**任一存在**即可调用（deepseek 系列在百炼 / DeepSeek 官方都有托管） */
  keyEnv: string[]
  /** 一句"适合什么" */
  fit: string
}

/** brain 槽位候选（Agent 大脑，必须支持 function calling） */
export const BRAIN_MODELS: ModelInfo[] = [
  {
    id: 'qwen3.8-flash', name: '通义千问 3.8 Flash', vendor: '阿里·百炼',
    multimodal: false, fc: true, keyEnv: ['DASHSCOPE_API_KEY'],
    fit: '默认·快，工具调用稳定（现状主模型）',
  },
  {
    id: 'qwen3-max', name: '通义千问 3 Max', vendor: '阿里·百炼',
    multimodal: true, fc: true, keyEnv: ['DASHSCOPE_API_KEY'],
    fit: '阿里多模态·更强，能看图 + 调工具（现状"带图/自由模式"用它）',
  },
  {
    // ★VF_MODELSWITCH_V1（2026-09-30 上线前实查百炼模型清单 261 个，确认本 id 存在）：
    //   阿里新一代 Max（`qwen3.8-max`），比 qwen3-max 更新 —— 用户要"阿里更好的模型"就选它。
    id: 'qwen3.8-max', name: '通义千问 3.8 Max（最新）', vendor: '阿里·百炼',
    multimodal: true, fc: true, keyEnv: ['DASHSCOPE_API_KEY'],
    fit: '阿里最新一代 Max·多模态·最强理解（比 qwen3-max 新）',
  },
  {
    id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', vendor: 'DeepSeek / 百炼',
    multimodal: false, fc: true, keyEnv: ['DASHSCOPE_API_KEY', 'DEEPSEEK_API_KEY'],
    fit: '兜底，两处都托管（现状兜底模型）',
  },
  {
    id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', vendor: 'DeepSeek / 百炼',
    multimodal: false, fc: true, keyEnv: ['DASHSCOPE_API_KEY', 'DEEPSEEK_API_KEY'],
    fit: '用户点名要试的新版，理解 / 推理更强',
  },
]

/** writer 槽位候选（分镜 / 文案书写） */
export const WRITER_MODELS: ModelInfo[] = [
  {
    id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', vendor: 'DeepSeek / 百炼',
    multimodal: false, fc: false, keyEnv: ['DASHSCOPE_API_KEY', 'DEEPSEEK_API_KEY'],
    fit: '默认，现状分镜 / 文案书写就用它',
  },
  {
    id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', vendor: 'DeepSeek / 百炼',
    multimodal: false, fc: false, keyEnv: ['DASHSCOPE_API_KEY', 'DEEPSEEK_API_KEY'],
    fit: '用户点名要试的新版，分镜 / 文案理解更强',
  },
  {
    id: 'qwen3-max', name: '通义千问 3 Max', vendor: '阿里·百炼',
    multimodal: true, fc: false, keyEnv: ['DASHSCOPE_API_KEY'],
    fit: '阿里多模态·更强（用户点名的"阿里模型"）',
  },
  {
    id: 'qwen3.8-max', name: '通义千问 3.8 Max（最新）', vendor: '阿里·百炼',
    multimodal: true, fc: false, keyEnv: ['DASHSCOPE_API_KEY'],
    fit: '阿里最新一代 Max·多模态（比 qwen3-max 新，理解更强）',
  },
  {
    id: 'qwen3.8-flash', name: '通义千问 3.8 Flash', vendor: '阿里·百炼',
    multimodal: false, fc: false, keyEnv: ['DASHSCOPE_API_KEY'],
    fit: '阿里·快，便宜',
  },
]

export interface ModelPreset {
  id: ModelPresetId
  name: string
  desc: string
  /** 该档位展开后的大脑模型（custom 为空 = 由用户分别指定） */
  brain: string
  /** 该档位展开后的书写模型（custom 为空 = 由用户分别指定） */
  writer: string
}

/**
 * 四个档位（界面上一键切换）。
 * ★ `fast` 必须与【现状】逐字一致（brain=qwen3.8-flash / writer=deepseek-v4-flash）——
 *   这样"没选过任何东西"= 保持原样，零回归。
 */
export const MODEL_PRESETS: Record<ModelPresetId, ModelPreset> = {
  fast: {
    id: 'fast', name: '默认·快',
    desc: '现状：大脑 qwen3.8-flash ｜ 书写 deepseek-v4-flash',
    brain: 'qwen3.8-flash', writer: 'deepseek-v4-flash',
  },
  'strong-deepseek': {
    id: 'strong-deepseek', name: 'DeepSeek 强',
    desc: '大脑 + 书写都用 deepseek-v4.1-flash（用户点名要试）',
    brain: 'deepseek-v4.1-flash', writer: 'deepseek-v4.1-flash',
  },
  'strong-qwen': {
    id: 'strong-qwen', name: '阿里多模态强',
    desc: '大脑 + 书写都用 qwen3-max（阿里多模态）',
    brain: 'qwen3-max', writer: 'qwen3-max',
  },
  'strong-qwen-latest': {
    // ★VF_MODELSWITCH_V1（2026-09-30 上线前实查百炼模型清单 261 个，确认 qwen3.8-max 存在）：
    //   与用户"阿里更好的模型"对齐 —— 新增"最新"档（**不改动 strong-qwen**，方便对比两代）。
    id: 'strong-qwen-latest', name: '阿里·最新',
    desc: '大脑 + 书写都用 qwen3.8-max（阿里最新一代 Max，比 qwen3-max 新）',
    brain: 'qwen3.8-max', writer: 'qwen3.8-max',
  },
  custom: {
    id: 'custom', name: '自定义',
    desc: '大脑 / 书写分别指定',
    brain: '', writer: '',
  },
}

/** 供界面按顺序渲染的档位列表（含 custom） */
export const MODEL_PRESET_LIST: ModelPreset[] = [
  MODEL_PRESETS.fast, MODEL_PRESETS['strong-deepseek'], MODEL_PRESETS['strong-qwen'],
  MODEL_PRESETS['strong-qwen-latest'], MODEL_PRESETS.custom,
]

export interface ModelChoice {
  preset: ModelPresetId
  /** 实际生效的大脑模型 id */
  brain: string
  /** 实际生效的书写模型 id */
  writer: string
}

/** SystemConfig.key —— 模型档位存这里（JSON 字符串），**不新增数据库表 / 字段** */
export const AGENT_MODEL_CHOICE_KEY = 'agent_model_choice'

const BRAIN_IDS = BRAIN_MODELS.map(m => m.id)
const WRITER_IDS = WRITER_MODELS.map(m => m.id)

export function isBrainModel(id: unknown): id is string {
  return typeof id === 'string' && BRAIN_IDS.includes(id)
}
export function isWriterModel(id: unknown): id is string {
  return typeof id === 'string' && WRITER_IDS.includes(id)
}
export function isPresetId(id: unknown): id is ModelPresetId {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(MODEL_PRESETS, id)
}
/** 取模型信息（brain / writer 两个清单里找第一个匹配） */
export function getModelInfo(id: string): ModelInfo | undefined {
  return [...BRAIN_MODELS, ...WRITER_MODELS].find(m => m.id === id)
}

/**
 * 解析「模型档位」输入 → 永远合法的 ModelChoice。**绝不抛异常。**
 * 接受的输入形态：
 *   · 预设 id 字符串：'fast' / 'strong-deepseek' / 'strong-qwen'
 *   · JSON 字符串（SystemConfig 里存的就是这个）：'{"preset":"custom","brain":"qwen3-max","writer":"deepseek-v4-flash"}'
 *   · 对象：{ preset?, brain?, writer? }
 *   · 任何非法值（'' / 'abc' / null / undefined / 未知 id / 奇怪对象）→ 回落 fast
 * 规则：
 *   ① 已知预设且没另给 brain/writer → 直接用预设的两个模型；
 *   ② 另给了 brain/writer（或 preset='custom'）→ 逐个校验，非法的那个槽位回落 fast 对应值，preset='custom'；
 *   ③ 什么都没给 / 给的全非法 → fast。
 */
export function resolveModelChoice(input: unknown): ModelChoice {
  const fast = MODEL_PRESETS.fast

  // ① 归一化成一个"候选对象"
  let obj: any = null
  if (input && typeof input === 'object') {
    obj = input
  } else if (typeof input === 'string') {
    const s = input.trim()
    if (s.startsWith('{')) {
      try { obj = JSON.parse(s) } catch { obj = { preset: s } } // JSON 坏了 → 当预设 id 再试
    } else if (s) {
      obj = { preset: s }
    }
  }

  // ② 已知预设 → 直接用预设展开。
  //    · 未给 brain/writer：直接用；
  //    · 给了但与预设一致（serialize 出来的形态）：也认（否则 round-trip 会被误判成 custom）。
  const pid = obj?.preset
  if (isPresetId(pid) && pid !== 'custom') {
    const p = MODEL_PRESETS[pid]
    const brainOk = !obj?.brain || obj.brain === p.brain
    const writerOk = !obj?.writer || obj.writer === p.writer
    if (brainOk && writerOk) return { preset: pid, brain: p.brain, writer: p.writer }
  }

  // ③ 显式指定了 brain/writer（或 preset='custom'）→ 逐个校验，非法的槽位回落 fast
  if (obj && (obj.brain || obj.writer || pid === 'custom')) {
    return {
      preset: 'custom',
      brain: isBrainModel(obj.brain) ? obj.brain : fast.brain,
      writer: isWriterModel(obj.writer) ? obj.writer : fast.writer,
    }
  }

  // ④ 兜底：空 / 非法 / 未知 → fast（= 现状）
  return { preset: 'fast', brain: fast.brain, writer: fast.writer }
}

/** 落库用的 JSON 字符串（SystemConfig.value） */
export function serializeModelChoice(choice: ModelChoice): string {
  const c = resolveModelChoice(choice)
  return JSON.stringify({ preset: c.preset, brain: c.brain, writer: c.writer })
}

/** 一行日志 / 卡片文案：「当前：大脑 qwen3-max ｜ 书写 deepseek-v4.1-flash」 */
export function describeModelChoice(choice: ModelChoice): string {
  const c = resolveModelChoice(choice)
  return `当前：大脑 ${c.brain} ｜ 书写 ${c.writer}`
}
