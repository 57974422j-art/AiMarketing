/**
 * ★VF_MODELSWITCH_V1（2026-09-30）自测 —— 模型清单 / 档位 / 解析 + 源码级契约对账
 *
 * 用户原话（设计依据）：
 *   「先看一下是不是模型能力弱了……不行加一个模型切换，我试试，deepseek-v4.1_flash 和
 *     阿里的多模态模型 我切换这试试。**每个模型可能理解能力也不一样**。」
 *
 * 本自测**纯函数、不联网、不烧钱、不碰数据库**，证明六件事：
 *   ① catalog 完整性：id 唯一、brain 全支持 function calling、keyEnv 写对（qwen=百炼；deepseek=百炼+官方）；
 *   ② resolveModelChoice 的**非法值回落**：空 / 'abc' / null / 未知 id / 数字 / 数组 / 坏 JSON → 一律 fast，不抛异常；
 *   ③ 四个档位展开正确，且 `fast` 展开后**与现状逐字一致**（qwen3.8-flash / deepseek-v4-flash）；
 *   ④ serializeModelChoice 落库 JSON 能原样 round-trip；
 *   ⑤ describeModelChoice 文案为「当前：大脑 X ｜ 书写 Y」；
 *   ⑥ 源码级契约对账（grep）：不传 model 时旧兜底链仍在；route.ts / prefs 接线存在；**schema 未新增字段**。
 *
 * 跑法（项目根目录）：
 *   npx ts-node --transpile-only -O '{"module":"commonjs","moduleResolution":"node"}' scripts/vf-model-selftest.ts
 * 退出码：全部通过 = 0，有失败 = 1。
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  BRAIN_MODELS, WRITER_MODELS, MODEL_PRESETS, MODEL_PRESET_LIST,
  resolveModelChoice, serializeModelChoice, describeModelChoice,
  isBrainModel, isWriterModel, AGENT_MODEL_CHOICE_KEY,
} from '../src/lib/agent/model-catalog'

let pass = 0
let fail = 0
function ok(cond: any, name: string, extra = '') {
  if (cond) { pass++; console.log('  ✅ ' + name) }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' → ' + extra : '')) }
}

const srcDir = process.cwd()
const read = (p: string) => readFileSync(join(srcDir, p), 'utf8')

console.log('\n① catalog 完整性：id 唯一 / brain 全支持 FC / keyEnv 写对')
{
  const brainIds = BRAIN_MODELS.map(m => m.id)
  const writerIds = WRITER_MODELS.map(m => m.id)
  ok(new Set(brainIds).size === brainIds.length, 'brain 模型 id 唯一')
  ok(new Set(writerIds).size === writerIds.length, 'writer 模型 id 唯一')
  ok(BRAIN_MODELS.every(m => m.fc === true), 'brain 候选全部支持 function calling')
  ok(BRAIN_MODELS.every(m => Array.isArray(m.keyEnv) && m.keyEnv.length > 0), 'brain 每个模型都写了 keyEnv')
  ok(WRITER_MODELS.every(m => Array.isArray(m.keyEnv) && m.keyEnv.length > 0), 'writer 每个模型都写了 keyEnv')

  // key 要求写对：qwen* 只需百炼；deepseek*（两边都托管）必须同时列 百炼 + DeepSeek 官方
  const qwenOk = [...BRAIN_MODELS, ...WRITER_MODELS].filter(m => m.id.startsWith('qwen'))
    .every(m => m.keyEnv.length === 1 && m.keyEnv[0] === 'DASHSCOPE_API_KEY')
  ok(qwenOk, 'qwen* 的 keyEnv 仅 = [DASHSCOPE_API_KEY]')
  const dsOk = [...BRAIN_MODELS, ...WRITER_MODELS].filter(m => m.id.startsWith('deepseek'))
    .every(m => m.keyEnv.includes('DASHSCOPE_API_KEY') && m.keyEnv.includes('DEEPSEEK_API_KEY'))
  ok(dsOk, 'deepseek* 的 keyEnv 同时含 DASHSCOPE + DEEPSEEK（两处都托管）')

  // 用户点名的模型必须在清单里
  ok(brainIds.includes('deepseek-v4.1-flash'), 'brain 含用户点名的 deepseek-v4.1-flash')
  ok(writerIds.includes('deepseek-v4.1-flash'), 'writer 含用户点名的 deepseek-v4.1-flash')
  ok(writerIds.includes('qwen3-max'), 'writer 含"阿里的多模态模型" qwen3-max')
  ok(BRAIN_MODELS.find(m => m.id === 'qwen3-max')?.multimodal === true, 'qwen3-max 标为多模态')
  ok([...BRAIN_MODELS, ...WRITER_MODELS].filter(m => m.id === 'deepseek-v4-flash').length === 2,
    'deepseek-v4-flash 在两个槽位各自登记（现状 brain 兜底 + writer 默认）')
}

console.log('\n② resolveModelChoice 非法值回落（绝不抛异常，一律 fast）')
{
  const FAST = { brain: 'qwen3.8-flash', writer: 'deepseek-v4-flash' }
  const isFast = (c: any) => c.brain === FAST.brain && c.writer === FAST.writer
  ok(isFast(resolveModelChoice('')), "空字符串 → fast")
  ok(isFast(resolveModelChoice('   ')), '纯空格 → fast')
  ok(isFast(resolveModelChoice('abc')), "'abc' → fast")
  ok(isFast(resolveModelChoice('gpt-4o')), '未知模型 id → fast')
  ok(isFast(resolveModelChoice(null)), 'null → fast')
  ok(isFast(resolveModelChoice(undefined)), 'undefined → fast')
  ok(isFast(resolveModelChoice(123)), '数字 → fast')
  ok(isFast(resolveModelChoice(true)), '布尔 → fast')
  ok(isFast(resolveModelChoice([])), '空数组 → fast')
  ok(isFast(resolveModelChoice({})), '空对象 → fast')
  ok(isFast(resolveModelChoice({ preset: 'hacker' })), '未知 preset → fast')
  ok(isFast(resolveModelChoice('{ bad json')), '坏 JSON 字符串 → fast')
  ok(isFast(resolveModelChoice({ brain: 'gpt-9' })), '非法 brain → 该槽位回落 fast')
  ok(isFast(resolveModelChoice({ writer: 'claude' })), '非法 writer → 该槽位回落 fast')
  let threw = false
  try { resolveModelChoice((() => { throw new Error('x') }) as any) } catch { threw = true }
  ok(!threw, '传入函数等奇怪值也不抛异常')
  ok(resolveModelChoice(null).preset === 'fast', '回落结果 preset = fast')
  // 类型守卫
  ok(isBrainModel('qwen3-max') && !isBrainModel('nope'), 'isBrainModel 正确')
  ok(isWriterModel('qwen3-max') && !isWriterModel('nope'), 'isWriterModel 正确')
}

console.log('\n③ 四个档位展开正确；fast 与现状逐字一致')
{
  ok(Object.keys(MODEL_PRESETS).length === 4, '档位共 4 个')
  ok(MODEL_PRESET_LIST.length === 4 && MODEL_PRESET_LIST.map(p => p.id).join(',') === 'fast,strong-deepseek,strong-qwen,custom',
    'MODEL_PRESET_LIST 顺序 = fast,strong-deepseek,strong-qwen,custom')

  const f = resolveModelChoice('fast')
  ok(f.preset === 'fast' && f.brain === 'qwen3.8-flash' && f.writer === 'deepseek-v4-flash',
    'fast → 大脑 qwen3.8-flash / 书写 deepseek-v4-flash（= 现状）', JSON.stringify(f))

  const sd = resolveModelChoice('strong-deepseek')
  ok(sd.preset === 'strong-deepseek' && sd.brain === 'deepseek-v4.1-flash' && sd.writer === 'deepseek-v4.1-flash',
    'strong-deepseek → 两个都 deepseek-v4.1-flash')

  const sq = resolveModelChoice('strong-qwen')
  ok(sq.preset === 'strong-qwen' && sq.brain === 'qwen3-max' && sq.writer === 'qwen3-max',
    'strong-qwen → 两个都 qwen3-max')

  const c = resolveModelChoice('custom')
  ok(c.preset === 'custom' && c.brain === 'qwen3.8-flash' && c.writer === 'deepseek-v4-flash',
    'custom（未给槽位）→ 槽位回落 fast')

  const o = resolveModelChoice({ preset: 'custom', brain: 'qwen3-max', writer: 'deepseek-v4.1-flash' })
  ok(o.preset === 'custom' && o.brain === 'qwen3-max' && o.writer === 'deepseek-v4.1-flash',
    'custom 指定两个槽位 → 原样生效')

  // 复杂：给了预设又硬塞 brain → 视为自定义（brain 生效、writer 回落 fast）
  const m = resolveModelChoice({ preset: 'strong-qwen', brain: 'deepseek-v4.1-flash' })
  ok(m.preset === 'custom' && m.brain === 'deepseek-v4.1-flash' && m.writer === 'deepseek-v4-flash',
    '预设 + 显式 brain → 转自定义（writer 回落 fast）')
}

console.log('\n④ serializeModelChoice 落库 JSON 能 round-trip')
{
  for (const pid of ['fast', 'strong-deepseek', 'strong-qwen'] as const) {
    const raw = serializeModelChoice(resolveModelChoice(pid))
    ok(typeof raw === 'string' && raw.startsWith('{'), `${pid} 落库为 JSON 字符串`)
    let parsed: any = null
    try { parsed = JSON.parse(raw) } catch {}
    ok(!!parsed, `${pid} 落库 JSON 合法`)
    const back = resolveModelChoice(raw)
    const want = MODEL_PRESETS[pid]
    ok(back.preset === pid && back.brain === want.brain && back.writer === want.writer,
      `${pid} round-trip 还原一致`)
  }
  const rawC = serializeModelChoice(resolveModelChoice({ preset: 'custom', brain: 'qwen3-max', writer: 'qwen3.8-flash' }))
  const backC = resolveModelChoice(rawC)
  ok(backC.preset === 'custom' && backC.brain === 'qwen3-max' && backC.writer === 'qwen3.8-flash',
    'custom round-trip 还原一致')
  ok(AGENT_MODEL_CHOICE_KEY === 'agent_model_choice', 'SystemConfig key = agent_model_choice')
}

console.log('\n⑤ describeModelChoice 文案')
{
  ok(describeModelChoice(resolveModelChoice('strong-qwen')) === '当前：大脑 qwen3-max ｜ 书写 qwen3-max',
    'strong-qwen 文案正确', describeModelChoice(resolveModelChoice('strong-qwen')))
  ok(describeModelChoice(resolveModelChoice('fast')) === '当前：大脑 qwen3.8-flash ｜ 书写 deepseek-v4-flash',
    'fast 文案正确')
  ok(describeModelChoice(resolveModelChoice('strong-deepseek')) === '当前：大脑 deepseek-v4.1-flash ｜ 书写 deepseek-v4.1-flash',
    'strong-deepseek 文案正确')
  // 传非法 → 也应回落 fast 文案（不抛异常）
  ok(describeModelChoice(resolveModelChoice('nonsense' as any)) === '当前：大脑 qwen3.8-flash ｜ 书写 deepseek-v4-flash',
    '非法输入的文案也回落 fast')
}

console.log('\n⑥ 源码级契约对账（防回归 grep）')
{
  const provSrc = read('src/lib/ai-providers.ts')
  const routeSrc = read('src/app/api/agent/chat/route.ts')
  const prefsSrc = read('src/app/api/agent/prefs/route.ts')
  const schemaSrc = read('prisma/schema.prisma')

  ok(provSrc.includes('★VF_MODELSWITCH_V1'), 'ai-providers.ts 有 ★VF_MODELSWITCH_V1 标记')
  ok(provSrc.includes('export async function callChatModel('), 'ai-providers.ts 有 callChatModel（按 id 选通道）')
  ok(provSrc.includes('export async function generateText(prompt: string, model?: string)'),
    'generateText 增加可选 model（旧调用方不传 = 不变）')
  // 旧兜底链必须逐字保留（不传 model 时行为不变）
  ok(provSrc.includes('await dashscopeChat(prompt, 2000)') &&
     provSrc.includes('await volcanoChat(prompt, 2000)') &&
     provSrc.includes('await siliconChat(prompt, 2000)') &&
     provSrc.includes('await deepSeekChat(prompt, 2000)'),
    'generateText 旧兜底链（百炼→火山→硅基→DeepSeek）逐字仍在')
  ok(provSrc.includes('if (model) {'), 'generateText 只在【显式指定 model】时才改链路')
  ok(provSrc.includes('async function dashscopeChat(prompt: string, maxTokens = 2000, model?: string)'),
    'dashscopeChat 新增可选 model 参数')
  ok(provSrc.includes('export async function deepSeekChat(prompt: string, maxTokens = 1000, model?: string)'),
    'deepSeekChat 新增可选 model 参数')
  ok(/forceVL = false,[\s\S]{0,400}?model\?: string/.test(provSrc), 'dashscopeFunctionCall 新增可选 model 参数')
  ok(provSrc.includes('const primaryModel = model || (useVL ?'), 'dashscopeFunctionCall 主模型可用 model 覆盖')
  ok(provSrc.includes("if (id.startsWith('qwen')) return await dashscopeChat(prompt, maxTokens, id)"),
    'callChatModel：qwen* → 百炼')
  ok(provSrc.includes("if (id.startsWith('deepseek')) {") &&
     provSrc.includes('const viaDash = getDashScopeKey() ? await dashscopeChat(prompt, maxTokens, id) : null'),
    'callChatModel：deepseek* → 先百炼，再 DeepSeek 官方')

  ok(routeSrc.includes('getModelChoiceCached'), 'route.ts 有 getModelChoiceCached（读 SystemConfig 档位）')
  ok(routeSrc.includes('AGENT_MODEL_CHOICE_KEY') && routeSrc.includes('resolveModelChoice'), 'route.ts 用 catalog 解析档位')
  ok(routeSrc.includes('console.log(`[模型] 大脑=${modelChoice.brain} ｜ 书写=${modelChoice.writer}`)'),
    'route.ts 每轮打印「[模型] 大脑=X ｜ 书写=Y」')
  ok(routeSrc.includes('2000, userTemperature, (body as any)?.mode === \'free\' || (body as any)?.agentMode === \'free\', modelChoice.brain)'),
    'route.ts:3144 一带：brain 传给 dashscopeFunctionCall（第 1 处）')
  ok(routeSrc.includes('dashscopeFunctionCall(messages as any, [], 2000, userTemperature, false, modelChoice.brain)'),
    'route.ts:3214 一带：brain 传给 dashscopeFunctionCall（第 2 处/汇总）')
  ok(routeSrc.includes('generateText(prompt, _mcWriter)'), 'route.ts 分镜生成（genVideoShotsRaw）走书写模型')
  ok(routeSrc.includes('generateText(avPrompt, _mcWriter)') && routeSrc.includes('generateText(sbPrompt, _mcWriter)'),
    'route.ts 工具内分镜（storyboard / ai_video）走书写模型')
  ok(routeSrc.includes('generateText: genTextW'), 'route.ts 三条视频线注入书写模型包装（genTextW）')
  ok(routeSrc.includes('⑤只输出文案本身，不要标题、不要解释、不要 markdown、不要引号。`, writerModel)'),
    'route.ts 素材线口播文案走书写模型')
  ok(routeSrc.includes('`把下面这段口播文案扩写到') && routeSrc.includes('`, writerModel)'),
    'route.ts 文案扩写/压缩/改写带上书写模型')
  // 普通文案（generate_copy 工具）不许被改（保持现状，避免误伤）
  ok(routeSrc.includes("const p = `为\"${product}\"生成${platform}营销文案，风格${style}。吸引眼球有卖点。输出3条，用【文案1】【文案2】【文案3】标记。`") &&
     routeSrc.includes("const copyRaw = (await generateText(p)) || ''"),
    '普通文案工具 generate_copy 保持现状（未传 model）')

  ok(prefsSrc.includes('AGENT_MODEL_CHOICE_KEY'), 'prefs 接口读写模型档位（与温度同一入口）')
  ok(prefsSrc.includes('modelChoice'), 'prefs 返回 modelChoice')

  ok(!schemaSrc.includes('agentModelChoice') && !schemaSrc.includes('agent_model_choice'),
    'prisma/schema.prisma 未新增模型档位字段（不新增表/字段）')
}

console.log(`\n═══ 通过 ${pass} / 失败 ${fail} ═══`)
process.exit(fail ? 1 : 0)
