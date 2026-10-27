/* ══════════════ ★VF_FORMAPPLY_V1（2026-10-27 用户实测）设置卡表单 → 草稿的**唯一**落地实现 ══════════════
 * 病灶：草稿已经停在**分镜确认卡**（step='script'）时，用户进设置卡只想改个音色 →
 *   整单重来（又看一遍图、又写一遍文案、又排一遍分镜，烧点 + 等十几秒）。
 * 根因：`route.ts` 的表单孤儿判定
 *   `_vfOrphan = _vfIsForm && vd.step !== 'form' && vd.step !== 'source'` 把 `step==='script'` 也算孤儿
 *   ⇒ clearVfDraft 整条清掉、`vd=undefined` ⇒ 落到"新一单起稿"（重新起草）。
 *   连带把 `step==='script' && /^VF_FORM:/` 那条专门分支（VF_FORMATSCRIPT_V1，本可"只刷新确认卡"）
 *   变成**死代码**（vd 已被置空，永远走不到）。
 *
 * 现口径 = **一处解析、两处共用**（起草阶段 / 分镜卡阶段），绝不各写一份：
 *   · `mode='draft'`  —— 起草阶段（step='form'/'source'）的表单：只把参数落进草稿；
 *   · `mode='script'` —— 分镜卡阶段的表单：额外比对"文案 / 主题 / 素材名单"是否变了，
 *     用返回的 flags 决定「重排 / 退回重写 / 只刷新卡片」——**决策留在 route.ts，本函数不做任何 IO**。
 * ⚠️ 为什么必须收口：原来两块解析的字段**不一样**（script 那块漏了 aspect / bgm / pin / pin1 / pin2 /
 *   big / fx / i2v / uploaded / line / skin）⇒ 用户在分镜卡改画幅或换一批上传，卡片显示改了、草稿没改
 *   —— 与 VF_FORM_CLAIM_V1 当初那次「选 60 秒出成 200 秒」是同一类账（承诺与产出不一致）。
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */
import { normalizeDeckStyle, VF_PPTIMG_SKINS } from './anti-ai'

export type VfFormMode = 'draft' | 'script'

export interface VfFormResult {
  /** 用户这次贴/改了文案（draft 阶段 = formScript 变了；script 阶段 = vd.script 变了） */
  scriptChanged: boolean
  /** 主题变了（script 阶段才有意义：文案是围绕旧主题写的 ⇒ 旧文案不作数） */
  topicChanged: boolean
  /** 用户这次**新传了素材**（上传名单变了）⇒ 旧文案 + 旧分镜都不作数。
   *  ⚠️ 不算 `source`：那张卡的 source 是写死 'repo' 的，拿它判会误伤（见下面对应注释） */
  materialChanged: boolean
  /** 画幅变了（script 阶段）：**不能只改 `vd.aspect`** —— 出片读的是 `vd.size`
   *  （`banner.ts:288`），而 size 是按**素材最大边**算的（`route.ts` 起草处 / `vf-video.ts` 的
   *  `probeMaterialSizes`）。分镜阶段已拿不到那份信息 ⇒ 只改 aspect 会"卡片写横屏、成片还是竖屏"。
   *  所以按**内容级变更**处理：退回上一步重新起草（保留设置、重算尺寸与分镜）。 */
  aspectChanged: boolean
  /** 人话的"这次真改了哪几项"（只列**值确实变了**的，给回执/日志用） */
  notes: string[]
  /** 老引擎拒绝 deck 的标记（原样透出，卡片要用）—— 未命中为 undefined */
  engineRejected?: string
}

const _same = (a: any, b: any): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/** 上传名单比对要**不看顺序**（前端是把本次新传的拼在已有名单后面，顺序不代表语义） */
const _sameNames = (a: any, b: any): boolean => {
  const norm = (x: any) => (Array.isArray(x) ? x.map((v: any) => String(v)) : []).slice().sort()
  return _same(norm(a), norm(b))
}

/**
 * 把前端「设置卡」提交的表单（`VF_FORM:{…}` 里那段 JSON）落到草稿 `vd` 上。
 * 只做**白名单归一 + 写字段 + 收集"变了什么"**；不做任何分支决策、不存库、不打日志。
 */
export function applyVfFormFields(vd: any, f: any, mode: VfFormMode = 'draft'): VfFormResult {
  const notes: string[] = []
  const out: VfFormResult = {
    scriptChanged: false, topicChanged: false, materialChanged: false, aspectChanged: false, notes,
  }
  if (!vd || !f || typeof f !== 'object') return out

  const mark = (label: string, before: any, after: any) => {
    if (!_same(before, after)) notes.push(label)
  }

  // ── 成片方式：★VF_PPTSOLO_V1（2026-10-06 用户定案「彻底拆开」）──
  //   本线（图片成片 / 图视混剪 / PPT+图视）只出**老引擎**；动态 PPT（HTML 逐帧 deck）自 10-06 起
  //   独占给「PPT成片」独立线。收到 deck 一律拒绝并留标记（时序真源不同，混起来会出现
  //   "卡片承诺 6s/镜、实际一页 20 秒"这类对不上的现象）。
  //   ⚠️ 只在**起草阶段**改：分镜卡阶段本块（图片成片/PPT+图视）一直是 classic，不必再写；
  //      而「图视混剪」那条线历史上允许 deck（它自己的 form 分支照收），这里替它做决定会改行为。
  if (f.engine !== undefined && mode === 'draft') {
    if (String(f.engine) === 'deck') out.engineRejected = 'deck'
    vd.engine = 'classic'
  }

  // ── 画幅：★VF_ASPECT_V1（不硬塞竖屏，不选则按素材判断）──
  if (f.aspect) {
    const b = vd.aspect
    vd.aspect = String(f.aspect)
    const changed = !_same(b, vd.aspect)
    mark('画幅', b, vd.aspect)
    // ★分镜卡阶段改画幅 = **内容级变更**（见 VfFormResult.aspectChanged 注释）：
    //   这里只上报，具体"退回重做"由调用方决定（本函数不碰 vd.size / 不写库）。
    if (changed && mode === 'script') out.aspectChanged = true
  }

  // ── 时长：★VF_DURAUTO_V1（2026-10-06 用户定案「上传素材不给选时长，以实际素材合成剪辑为准」）──
  //   带上传素材时不接受手填秒数（否则就是"卡片写 30 秒、实际按素材走"的自相矛盾）。
  //   与 `vf-video.ts` 的 `!vd.durAuto` 同一口径 —— 两处必须一致，否则同一条规则两个结果。
  if (f.dur && !vd.durAuto) { const b = vd.dur; vd.dur = Math.max(5, Math.min(900, parseInt(f.dur) || 30)); mark('时长', b, vd.dur) }

  // ── 画面风格 / 皮肤 ──
  // ★VF_THEME_UI_V1（2026-09-20）：dark / tech / light —— 白名单（make.py 的 --theme 是 choices，
  //   传别的值 argparse 直接报错）；★VF_DEFTHEME_V1（2026-10-08）：非法/未选兜底改成 **light**，
  //   否则"没选模版就变黑乎乎"的老毛病在**脏值**这条路上还在。
  if (f.theme) { const b = vd.theme; vd.theme = ['dark', 'tech', 'light'].includes(String(f.theme)) ? String(f.theme) : 'light'; mark('画面风格', b, vd.theme) }
  // ★VF_DECK_STYLES_V1（2026-10-01 用户「我没看到新模版」）：画面模版走 normalizeDeckStyle 白名单（非法/缺省 → 'auto'）
  if (f.deckStyle !== undefined) { const b = vd.deckStyle; vd.deckStyle = normalizeDeckStyle(f.deckStyle); mark('画面模版', b, vd.deckStyle) }
  // ★VF_NOSTYLE_V1（2026-10-20 用户定案「按你说的来」）：`style` **停用** —— 设置卡上「🎨 画面风格」
  //   整块已删；无论前端/老草稿送什么，一律强制清空（否则老草稿里的 'deepblue' 会让确认卡继续显示
  //   「风格 深蓝墨」，用户实测过）。⚠️ 只影响本线三兄弟（共用 buildVideoPlan）。
  if (f.style !== undefined) vd.style = ''

  // ── 音色 ──
  if (f.voice) { const b = vd.voice; vd.voice = String(f.voice); mark('音色', b, vd.voice) }

  // ── 主题 ──
  //   起草阶段：写进 vd.topic 供写文案用（空值不覆盖，避免把已推导出来的主题冲掉）。
  //   分镜卡阶段：主题变了 ⇒ 旧文案是围绕旧主题写的 ⇒ 必须重写（由 route.ts 按 topicChanged 处理）。
  if (typeof f.topic === 'string' && f.topic.trim()) {
    const b = String(vd.topic || '')
    const t = f.topic.trim().slice(0, 300)
    if (t !== b) { vd.topic = t; mark('主题', b, t); if (mode === 'script') out.topicChanged = true }
  }

  // ── 文案 ──
  //   起草阶段：用户直接贴了文案 ⇒ 存 formScript（起草时"贴了就用他的，不再由 AI 写"）。
  //   分镜卡阶段：★VF_FORMATSCRIPT_V1 —— 用户在设置卡改了文案 ⇒ 必须重排分镜
  //     （成片的画面大字/字幕/配音**全部来自 shots**，只改 vd.script 的话出片还是旧文案）。
  if (typeof f.script === 'string' && f.script.trim()) {
    const t = f.script.trim().slice(0, 4000)
    if (mode === 'script') {
      if (t !== String(vd.script || '')) { vd.script = t; vd.formScript = t; out.scriptChanged = true; notes.push('文案') }
    } else if (t !== String(vd.formScript || '')) {
      vd.formScript = t; out.scriptChanged = true; notes.push('文案')
    }
  }

  // ── 画面来源（**只在起草阶段**才写）──
  //   ⚠️ 分镜卡阶段**不写、也不据此判"换素材"**：`page.tsx:578` 那张卡的 `source` 是 `useState('repo')`
  //   **写死的**（不读 vj.source）⇒ 任何一次"只改音色"的提交都会带 `source:'repo'`，
  //   拿它跟草稿里的 'upload'/'ai' 一比就成"换了素材"⇒ 又清一遍文案（等于没修）。
  //   分镜卡阶段真正决定画面的是 next 的 `uploaded` 名单（见下）—— 那个是"用户这次真新传了文件"的硬信号。
  if (mode === 'draft' && f.source !== undefined) {
    const b = String(vd.formSource || '')
    const s = String(f.source)
    if (s !== b) { vd.formSource = s; notes.push('画面来源') }
  }
  // ── 上传名单（★VF_UPLOAD_V2：前端把**刚上传的文件名列表**一起发，按名字精确取，不靠猜）──
  //   分镜卡阶段名单变了 = **用户真新传了素材** ⇒ 旧文案/旧分镜都不作数（route.ts 走"退回素材来源"）。
  if (Array.isArray(f.uploaded)) {
    const list = f.uploaded.map((x: any) => String(x)).slice(0, 60)
    if (!_sameNames(list, vd.uploaded)) {
      vd.uploaded = list
      notes.push('上传名单')
      if (mode === 'script') out.materialChanged = true
    }
  }

  // ── 背景音乐 / 顶部固定标题 / 画面大字 / 特效 ──
  if (f.bgm !== undefined) { const b = vd.bgm; vd.bgm = (String(f.bgm) === 'auto') ? 'auto' : ''; mark('背景音乐', b, vd.bgm) }
  // ★VF_BANNER_V1：'on' 默认自动拟两行 / 'off' 不要 —— 白名单归一
  if (f.pin !== undefined) { const b = vd.pin; vd.pin = (String(f.pin) === 'off') ? 'off' : 'on'; mark('顶部标题开关', b, vd.pin) }
  // ★VF_BANNER_PIN2_V1（2026-09-29）：手填的第 1/2 行（留空 = AI 自动拟）—— 原样存草稿，
  //   清洗/截断都在 buildBanner 里（"手填两行 → 永不覆盖"由 shouldRebuildBanner 拦）。
  if (f.pin1 !== undefined) { const b = String(vd.pin1 || ''); vd.pin1 = String(f.pin1 || '').slice(0, 60); mark('顶部标题第 1 行', b, vd.pin1) }
  if (f.pin2 !== undefined) { const b = String(vd.pin2 || ''); vd.pin2 = String(f.pin2 || '').slice(0, 80); mark('顶部标题第 2 行', b, vd.pin2) }
  // ★OVERLAY_TEXT_SWITCH_V1 补齐（2026-10-08 实测）：本线原先**连解析都没有** ⇒
  //   用户在卡上选「画面大字：不加」其实不生效。现在接上（plan 根级 overlay_text，渲染层读它）。
  if (f.big !== undefined) { const b = vd.big; vd.big = (String(f.big) === 'off') ? 'off' : 'on'; mark('画面大字', b, vd.big) }
  // ★VF_FX_SWITCH_V1（2026-10-08 用户「另加一个『特效：开 / 关』」）：'on'（默认 = 现状）/ 'off'（整片静态）。
  //   落地在 buildVideoPlan（一处覆盖全部线）+ 渲染层总闸（render.py）；这里只做白名单归一。
  if (f.fx !== undefined) { const b = vd.fx; vd.fx = (String(f.fx) === 'off') ? 'off' : 'on'; mark('特效', b, vd.fx) }

  // ── ★VF_PPTIMG_V1（2026-10-07）「PPT+图视」新线：线标识 + 新引擎皮肤（master × palette）──
  //   **卡片上真正看到的线标识才作数** —— 防"命令没匹配上 / 草稿串线"导致
  //   "卡片显示一条线、出片按另一条线走"（用户实测「还是原来的皮肤」就是这一类）。
  if (f.line !== undefined) {
    const b = String(vd.line || '')
    const raw = String(f.line)
    if (['local', 'video', 'pptimg'].includes(raw)) vd.line = raw
    mark('线标识', b, String(vd.line || ''))
  }
  //   白名单来自 anti-ai.ts 的 `VF_PPTIMG_SKINS`（真源 masters/*/master.json）。
  //   非法 skin → 回落 'tech'；palette 不在该母版的配色里 → 用该母版的**第一个配色**
  //   （绝不把脏值写进 plan 根级 `pptpage`，否则引擎会渲出意料之外的皮肤）。
  if (f.skin !== undefined) {
    const b = `${vd.skin || ''}/${vd.palette || ''}`
    const skRaw = String(f.skin || '').replace(/^master-/, '').toLowerCase()
    const hit = VF_PPTIMG_SKINS.find((s) => s.id === skRaw)
    vd.skin = hit ? hit.id : 'tech'
    const plRaw = String(f.palette || '')
    const defPl = (hit || VF_PPTIMG_SKINS[0]).palettes[0].id
    vd.palette = (hit && hit.palettes.some((p) => p.id === plRaw)) ? plRaw : defPl
    mark('皮肤', b, `${vd.skin}/${vd.palette}`)
  }

  // ── ★VF_I2V_BASELINE_V1（2026-09-29）「🎞 让图动起来」──
  //   'on' 默认 / 'off' 不注入也不额外计费；★VF_I2VSUIT_V1 追加 'all' = 手动全开（不按素材类型筛）；
  //   ★VF_MATUI_V1 追加 'picked' = 只动我勾选的那几张（四档全保留）。
  if (f.i2v !== undefined) {
    const b = String(vd.i2v || '')
    const v = String(f.i2v)
    vd.i2v = (v === 'off' || v === 'picked' || v === 'all') ? v : 'on'
    mark('图生视频', b, vd.i2v)
  }

  return out
}
