/**
 * ★VF_PPTSOLO_V1（2026-10-06 用户定案）——【PPT 成片】独立一线（HTML 逐帧 · 动态 PPT）。
 *
 * 用户原话（本文件存在的唯一理由）：
 *   「如果 2 者相互矛盾，你给我彻底拆开，做个 PPT 成片 / HTML 逐帧成片，原设计图视混剪和图片成片
 *     单独保留。不要混在一起。要不这个好了那个又坏了，我们调试起来很麻烦。」
 *
 * ── 它和另外几条线的关系（**时序真源不同，所以必须拆**）─────────────────────────
 *   · 图片成片 / 图视混剪 / 素材+AI / AI 制片：**分镜 `dur` = 时序真源**（确认卡上每镜 6s/7s 就是承诺），
 *     字幕 = 分镜 subtitle，配音逐镜 TTS 后按分镜时长铺满（老引擎 make.py）。
 *   · 本线：**配音 = 时序真源**（页 = PPT 版式页；页时长 = 该页旁白单元时长和 + 呼吸）。
 *     ⇒ 本线**不取素材、不排分镜、不插素材图**（素材画面是另外两条线的画面主体）。
 *
 * ── 三步流程（卡都是本线自己的）────────────────────────────────────────────
 *   ① 标准模式命令「PPT成片」→ **PPT 设置卡**（画幅 / 时长 / 音色 / BGM / 皮肤 / 主题或贴文案）
 *   ② 提交 `VF_PPT_FORM:{...}` →（没贴文案就用 AI 按主题写一段口播）→ **确认卡**
 *      （文案 + 预估页数/秒数 + 报价；**不显示逐镜时长** —— 本线没有分镜）
 *   ③ 确认卡「🎬 确认出片 · 新引擎」发的仍是既有协议 `VF_DECK_CONFIRM:{skin,ori}`
 *      → 由 route.ts 既有分派（在四条线之前）交给 `runDeckVideoTask`；本线草稿靠 `deckOnly` 标记被它认领
 *      （没有 shots 也能出片 —— 见 vf-deck-render.ts 的同名标记判断）。
 *
 * 零连累约束（与 vf-aivideo.ts / vf-mix.ts 同规矩）：**不 import 其它成片线**，依赖全部由 ctx 注入。
 */
import { VF_SUB_CPS } from './anti-ai'   // ★VF_CPSONE_V1：口播语速唯一真源（anti-ai.ts，实测 4.3 字/秒）
import { DECK_SKINS } from '@/lib/agent/vf/vf-deck-render'

export const PPT_TAG = 'vf_draft_ppt'

/** 本线草稿（落库时带中文前缀，容历史串线；读取只取 JSON 部分） */
export type PptDraft = {
  step: 'form' | 'script'
  topic: string
  script: string
  aspect: 'portrait' | 'landscape'
  dur: number
  voice: string
  bgm: string
  skin: string
  /** ★本线标记：出片端（runDeckVideoTask / findDeckConfirmDraft）靠它认"没有分镜也能出片" */
  deckOnly: true
  __savedAt?: number
}

const PPT_DRAFT = new Map<number, PptDraft>()

async function savePptDraft(db: any, uid: number | string, d: PptDraft): Promise<void> {
  PPT_DRAFT.set(Number(uid), d)
  const content = 'PPT成片草稿:' + JSON.stringify({ ...d, __savedAt: Date.now() })
  try {
    const ex = await db.agentMemory.findFirst({ where: { userId: String(uid), tags: { equals: PPT_TAG } }, orderBy: { updatedAt: 'desc' } })
    if (ex) await db.agentMemory.update({ where: { id: ex.id }, data: { content } })
    else await db.agentMemory.create({ data: { userId: String(uid), content, tags: PPT_TAG, salience: 0.5 } })
  } catch { /* 草稿存不上不影响本轮 */ }
}

async function loadPptDraft(db: any, uid: number | string): Promise<PptDraft | null> {
  if (PPT_DRAFT.has(Number(uid))) return PPT_DRAFT.get(Number(uid)) || null
  try {
    const dm = await db.agentMemory.findFirst({ where: { userId: String(uid), tags: { equals: PPT_TAG } }, orderBy: { updatedAt: 'desc' } })
    if (dm?.content) {
      const t = String(dm.content).trim()
      const i = t.indexOf('{')
      const d = JSON.parse(i >= 0 ? t.slice(i) : t) as PptDraft
      if (d?.step) { PPT_DRAFT.set(Number(uid), d); return d }
    }
  } catch { /* ignore */ }
  return null
}

export async function clearPptDraft(db: any, uid: number | string): Promise<void> {
  PPT_DRAFT.delete(Number(uid))
  try { await db.agentMemory.deleteMany({ where: { userId: String(uid), tags: { equals: PPT_TAG } } }) } catch { /* ignore */ }
}

export async function hasPptDraft(db: any, uid: number): Promise<boolean> {
  if (PPT_DRAFT.has(uid)) return !!PPT_DRAFT.get(uid)?.step
  const d = await loadPptDraft(db, uid)
  return !!d?.step
}

/** 本线入口词（**精确相等**，与 standard-commands.ts 的 text/alias 一一对应；不在此表内一律不认领） */
const PPT_ENTRY = /^(PPT成片|动态PPT|动态PPT成片)$/

/** 出片确认协议（既有，本线复用） */
const DECK_CONFIRM_RE = /^VF_DECK_CONFIRM\s*[:{]/
const PPT_FORM_RE = /^VF_PPT_FORM\s*:/

const ORIS = ['portrait', 'landscape']
const DUR_OK = [30, 60, 90, 180]

/** 口播语速（字/秒）——与 vf-deck-render.ts 的 TTS 估时口径一致（4.2~4.5） */
const CPS = VF_SUB_CPS
/** 报价公式**与 runDeckVideoTask 逐字一致**（★VF_COSTFIX_V1：报价 = 实扣，不许各写一份） */
export const pptCostOf = (charN: number): number => Math.max(1, Math.ceil(charN / 20))

/** 估时/估页（**如实**：页数由 AI 分节决定，这里只给区间；实际时长以配音为准） */
export function pptEstimate(script: string, dur: number) {
  const charN = String(script || '').length
  const estSec = Math.round(charN / CPS)
  const pagesLo = 5
  const pagesHi = 14
  return { charN, estSec, pagesLo, pagesHi, targetSec: Math.max(5, Number(dur) || 60) }
}

export type PptCtx = {
  uid: number | string
  userMessage: string
  prisma: any
  /** 与 route.ts 的 genTextW 实际签名一致（可能返回 null）—— 不许写成 Promise<string>（那样接进来就报类型错） */
  generateText: (prompt: string) => Promise<string | null>
  log: (uid: any, m: string) => void
  voiceList: { id: string; name: string }[]
}

/** 设置卡（step='ppt_setup'）——客户端按它渲染「PPT 成片」配置卡 */
function setupCard(vd: PptDraft | null): string {
  return 'VF_JSON:' + JSON.stringify({
    step: 'ppt_setup',
    line: 'ppt',
    topic: vd?.topic || '',
    script: vd?.script || '',
    aspect: vd?.aspect || 'portrait',
    dur: vd?.dur || 60,
    voice: vd?.voice || 'longxiaochun',
    bgm: vd?.bgm || 'auto',
    skin: vd?.skin || 'v1',
    voices: (vd as any)?.voiceList || [],
    skins: DECK_SKINS.slice(),
    // ★VF_PPTDUR_V1（2026-10-07 用户实测「2 个矛盾」）：口径统一 —— 选的是**文案长度**，
    //   秒数**永远是配音的结果**（配音 = 唯一时序真源），页数由文案自动分节。别再出现"时长决定文案"这种说法。
    hint: 'PPT 成片：只吃「文案 + 皮肤」——你贴多少字就念多久（**秒数由配音决定**）；页 = PPT 版式页（不掺素材图）',
  })
}

/** 确认卡（step='ppt_confirm'）——文案 + 预估 + 报价；**不显示逐镜时长**（本线没有分镜） */
function confirmCard(vd: PptDraft): string {
  const est = pptEstimate(vd.script, vd.dur)
  const voiceName = (vd as any).voiceList?.find?.((v: any) => v.id === vd.voice)?.name || vd.voice
  return 'VF_JSON:' + JSON.stringify({
    step: 'ppt_confirm',
    line: 'ppt',
    // ★出片端（VfDeckConfirm / runDeckVideoTask）认的是 engine='deck'
    engine: 'deck',
    deckOnly: true,
    script: vd.script,
    charN: est.charN,
    estSec: est.estSec,
    targetSec: est.targetSec,
    pagesLo: est.pagesLo,
    pagesHi: est.pagesHi,
    cost: pptCostOf(est.charN),
    aspect: vd.aspect,
    orientation: vd.aspect === 'landscape' ? '16:9' : '9:16',
    skin: vd.skin,
    voice: vd.voice,
    voiceName,
    bgm: vd.bgm,
    topic: vd.topic,
    // ★VF_PPTDUR_V1：去掉「约 5~14 页」和"以 AI 分节为准"这种两义说法，只留唯一口径。
    hint: `文案 ${est.charN} 字 ⇒ 配音约 ${est.estSec} 秒（最终以配音为准）；页数由文案自动分节（出片后见实际页数）；不掺素材图`,
  })
}

/** 按主题写口播文案（用户没贴文案时用；**复用同一套常量**：字数 ≈ 时长 × 4.5） */
async function writeScriptFor(ctx: PptCtx, topic: string, dur: number): Promise<string> {
  const chars = Math.round(Math.max(5, dur) * CPS)
  const p = `你是一位短视频编剧。请为「${topic || '一个营销主题'}」写一条约 ${dur} 秒的中文口播文案（约 ${chars} 字）。\n`
    + '要求：① 只输出文案正文，不要标题、不要分镜、不要段落编号、不要任何解释；\n'
    + '② 口语化、句子短（每句 8~25 字），适合配音念出来；\n'
    + '③ 只用常规简体字与常规标点 —— 不要 emoji、不要生僻字、不要外文单词；\n'
    + '④ 结尾一句要有行动号召（如「立即预约体验」）。'
  const out = String(await ctx.generateText(p) || '').replace(/```[a-z]*\n?/gi, '').trim()
  return out.slice(0, 4000)
}

/**
 * 本线分派。返回 null = 本线不接（交给其它线）；
 * 返回字符串 = 本轮回复（卡片协议串或人话）。
 */
export async function handlePptLine(ctx: PptCtx): Promise<string | null> {
  const uid = Number(ctx.uid) || 0
  const msg = String(ctx.userMessage || '').trim()
  const isForm = PPT_FORM_RE.test(msg)
  const isEntry = PPT_ENTRY.test(msg.replace(/[\s\u3000]+/g, ''))
  const vdOld = await loadPptDraft(ctx.prisma, ctx.uid)

  // 出片确认协议不在这里处理（route.ts 的既有分派在四条线之前接管，且要读库里的草稿）
  if (DECK_CONFIRM_RE.test(msg)) return null

  if (isEntry) {
    // 新的一条 → 重置本线草稿（与标准模式"点哪个进哪个、看到命令就重来"同一规矩）
    await clearPptDraft(ctx.prisma, ctx.uid)
    ctx.log(uid, '[PPT成片] 进线 → 出 PPT 设置卡（只吃文案+皮肤；不取素材、不排分镜）')
    const vd: PptDraft = {
      step: 'form', topic: '', script: '', aspect: 'portrait', dur: 60,
      voice: 'longxiaochun', bgm: 'auto', skin: 'v1', deckOnly: true,
    }
    ;(vd as any).voiceList = ctx.voiceList
    // ★VF_PPTGATE_V1（2026-10-07 用户实测「点了『开始排版』回我『你这句话不在命令表里』」的**根因之一**）：
    //   改前这里**只出卡、不落草稿** ⇒ 标准模式闸门 `stdHasAnyDraft()` 认为"没有进行中的流程"
    //   ⇒ 第二步的协议串 `VF_PPT_FORM:{…}`（不是命令表里的词）被**锁死回复**拦住，流程永远走不完。
    //   这与 2026-09-28「视频混剪」、09-29「获客线」踩的是**同一个坑**（第三次）：
    //   **凡是有第二步协议串的线，第一步就必须把草稿落下来**（草稿 = 闸门眼里的"进行中流程"）。
    await savePptDraft(ctx.prisma, ctx.uid, vd)
    return setupCard(vd)
  }

  if (isForm) {
    let f: any = {}
    try { f = JSON.parse(msg.replace(PPT_FORM_RE, '')) || {} } catch { /* 非法 JSON → 用默认值 */ }
    const aspect = ORIS.includes(String(f.aspect)) ? String(f.aspect) as 'portrait' | 'landscape' : 'portrait'
    const dur = DUR_OK.includes(Number(f.dur)) ? Number(f.dur) : Math.max(5, Math.min(900, Number(f.dur) || 60))
    const voice = String(f.voice || vdOld?.voice || 'longxiaochun')
    const bgm = String(f.bgm) === 'none' ? '' : 'auto'
    const skin = (DECK_SKINS as readonly string[]).includes(String(f.skin)) ? String(f.skin) : 'v1'
    const topic = String(f.topic || '').slice(0, 300)
    let script = String(f.script || '').trim().slice(0, 4000)
    let wrote = ''
    if (!script) {
      if (!topic) {
        const vd: PptDraft = { step: 'form', topic: '', script: '', aspect, dur, voice, bgm, skin, deckOnly: true }
        ;(vd as any).voiceList = ctx.voiceList
        return 'VF_JSON:' + JSON.stringify({
          ...JSON.parse(String(setupCard(vd)).replace(/^VF_JSON:/, '')),
          err: '请先填【主题】或直接把文案贴进来 —— PPT 成片要靠文案（或主题）才能排版',
        })
      }
      try {
        script = await writeScriptFor(ctx, topic, dur)
        wrote = `（AI 按主题写了 ${script.length} 字文案）`
        ctx.log(uid, `[PPT成片] 未贴文案 → AI 按主题「${topic.slice(0, 20)}」写了 ${script.length} 字`)
      } catch (e: any) {
        ctx.log(uid, '[PPT成片] 写文案失败：' + String(e?.message || e).slice(0, 120))
        const vd: PptDraft = { step: 'form', topic, script: '', aspect, dur, voice, bgm, skin, deckOnly: true }
        ;(vd as any).voiceList = ctx.voiceList
        return 'VF_JSON:' + JSON.stringify({
          ...JSON.parse(String(setupCard(vd)).replace(/^VF_JSON:/, '')),
          err: '写文案失败（可再试一次，或直接把文案贴进来）',
        })
      }
    }
    const vd: PptDraft = { step: 'script', topic, script, aspect, dur, voice, bgm, skin, deckOnly: true }
    ;(vd as any).voiceList = ctx.voiceList
    await savePptDraft(ctx.prisma, ctx.uid, vd)
    ctx.log(uid, `[PPT成片] 确认卡：${script.length} 字 · ${aspect === 'landscape' ? '横屏 16:9' : '竖屏 9:16'} · 皮肤 ${skin} · 音色 ${voice}${wrote}`)
    return confirmCard(vd)
  }

  // 线内其它话（「重试」/改皮肤/改文案…）：本线只做两件确定的事，其余给出可做的下一步
  if (vdOld?.step) {
    if (/重试|再来一次|重新/.test(msg)) {
      if (!vdOld.script && vdOld.topic) return confirmCard({ ...vdOld, script: await writeScriptFor(ctx, vdOld.topic, vdOld.dur) })
      return confirmCard(vdOld)
    }
    if (/换文案|改文案|重新写/.test(msg)) return setupCard({ ...vdOld, script: '' })
    return confirmCard(vdOld)
  }
  return null
}
