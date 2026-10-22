/**
 * ★VF_SPEC_V2：让 AI 自己规划"风格语法"（**开关默认关闭**）
 * =============================================================================
 * 用户 2026-10-10 定案：「加开关默认关闭；开启后 AI 制作；**不要把现在的又搞坏了**」。
 *
 * · **关（默认）⇒ 零行为变化**：不调模型、不传 spec，整条线走的还是 pack / 引擎默认语法。
 * · **开（`VF_FILM_AI_SPEC=1`）⇒ 在"排骨架"之前**多一次小模型调用，让它按素材气质声明
 *   L1 构图 / L2 动效 / L3 文本形态（layout / image / pacing / motion / text / gates）。
 *   为什么必须在骨架**之前**：`image.complete` 会决定 `arrange` 允不允许用 fullbleed（满屏裁切）——
 *   声明晚了，骨架与声明就打架，出片时会被 `stage=spec` 拒渲（这条在 2026-10-10 实测抓过）。
 * · 失败**不判死**：拿不到就退回"不给 spec"（= 现状行为），并在确认卡上如实说一句。
 * · 合法性**不靠模型自觉**：① 服务端**白名单按键**（`pickSpec`，多写的字段一律丢）；
 *   ② 数值/枚举由引擎 `normSpec`（film-to-page.mjs）**夹回并打印**；
 *   ③ 最终仍由引擎闸门兜底（字表 / 对比度 / 重叠 / 完整大图比例 / 规格自相矛盾）。
 *
 * 为什么单列成模块：开关语义与白名单必须能**脱离模型单测**
 * （`temp/_spec/test.mjs`：默认关 / 开启后只放行白名单键 / 垃圾输入不崩）。
 */

/** 开关：**每次调用都读 env**（测试可切、运维可热改；默认关） */
export function aiSpecEnabled(): boolean {
  return /^(1|true|on|yes)$/i.test(String(process.env.VF_FILM_AI_SPEC || ''))
}

/** 只允许这些组、这些键（与 `film-to-page.mjs` 的 SPEC_DEF / SPEC_ENUM 一一对应） */
export const SPEC_KEYS: Record<string, string[]> = {
  layout: ['system', 'whitespace'],
  image: ['place', 'complete'],
  pacing: ['minShotSec'],
  // ★VF_FILMTRANS_V2b（2026-10-11 自检抓到）：`trans` 早就进了引擎 SPEC_ENUM，但**白名单里漏了**
  //   ⇒ AI 声明的"全图页转场"每次都被 pickSpec 丢掉（等于白声明）。补上。
  motion: ['img', 'ease', 'type', 'cross', 'trans'],
  text: ['titleForm', 'ornament', 'weight', 'tracking', 'scale'],
  gates: ['minImageWidth'],
  // ★VF_THEME_V1（2026-10-11 用户定案「AI 完全自己画 就不要参与我们模版…动效样式完全它自主安排」）：
  //   配色也能由 AI 定。合法性**不靠模型自觉** —— 引擎 tools/theme.mjs 的 normTheme 会判对比度，
  //   不达标一律丢弃并退回风格包（用户原话「直接就一个墨绿底色简直没法看」）。
  theme: ['bg', 'bg2', 'ink', 'dim', 'faint', 'accent', 'accentText', 'font', 'radius'],
}

/** 白名单化：`{spec:{…}}` 或裸 `{…}` 都收；只留白名单键；一个可用键都没有 ⇒ null */
export function pickSpec(j: any): any | null {
  const src = (j && typeof j === 'object' && j.spec && typeof j.spec === 'object') ? j.spec : j
  if (!src || typeof src !== 'object') return null
  const out: any = {}
  let n = 0
  for (const g of Object.keys(SPEC_KEYS)) {
    const s = src[g]
    if (!s || typeof s !== 'object') continue
    const o: any = {}
    for (const k of SPEC_KEYS[g]) if (s[k] !== undefined && s[k] !== null) { o[k] = s[k]; n++ }
    if (Object.keys(o).length) out[g] = o
  }
  return n ? out : null
}

/** 一句话说清 AI 规划了什么（确认卡上给用户看，**别让它悄悄生效**） */
export function describeSpec(sp: any): string {
  const g = (a: string, k: string): string => (sp && sp[a] && sp[a][k] !== undefined ? String(sp[a][k]) : '')
  const rows: Array<[string, string]> = [
    ['排版', g('layout', 'system')], ['留白', g('layout', 'whitespace')],
    ['照片', g('image', 'place')],
    ['完整', (sp && sp.image && sp.image.complete !== undefined) ? (sp.image.complete ? '保证' : '可裁切') : ''],
    ['标题', g('text', 'titleForm')], ['字重', g('text', 'weight')],
    ['字距', g('text', 'tracking')], ['字号', g('text', 'scale')],
    ['入场', g('motion', 'img')], ['段间', g('motion', 'cross')],
    ['转场', (sp && sp.motion && sp.motion.trans && sp.motion.trans !== 'auto') ? String(sp.motion.trans) : ''],
    // ★VF_THEME_V1：AI 自定配色时，卡片上要说清"这片不用库里模板的配色"
    ['配色', (sp && sp.theme && sp.theme.bg) ? 'AI 自定(' + String(sp.theme.bg) + ')' : ''],
  ]
  return rows.filter(([, v]) => v !== '').map(([k, v]) => k + '=' + v).join(' · ')
}

/** 给模型的"一页纸"：**只问风格语法**（不写文案 —— 文案是下一步自己的活）
 *  ★VF_THEME_V1（2026-10-11 用户定案「AI 完全自己画 就不要参与我们模版…动效样式完全它自主安排」）：
 *  `paint=true`（用户勾了「AI 完全自主」）时**连配色一起要** —— 这一片不套库里风格包的皮肤；
 *  给回来的 theme 由引擎 tools/theme.mjs 判对比度，不合格**丢弃退回**（不出"墨绿一坨"）。 */
export function specPrompt(summary: string, n: number, topic: string, paint = false): string {
  return '你是竖屏短片（9:16）的**视觉导演**。这批素材共 ' + n + ' 张实拍照片。\n'
    + (topic ? '主题：' + topic + '\n' : '')
    + (summary ? '【素材读图总结】\n' + String(summary).slice(0, 1200) + '\n' : '')
    + '\n请**只**规划"版式语法"（不要写文案、不要写分镜），只回一个 JSON：\n'
    + '{"spec":{"layout":{"system":"axis|grid|free","whitespace":0.08~0.55},'
    + '"image":{"place":"mat|mat-tape|fullbleed","complete":true|false},'
    + '"motion":{"img":"push|pop|fade","ease":"out|back|inout","type":"overlay|sticker|vertical","cross":0.06~0.8},'
    + '"text":{"titleForm":"overlay|sticker|vertical","ornament":"rule|tape|hairline|none","weight":100~900,"tracking":-0.04~0.2,"scale":0.7~1.4},'
    + '"gates":{"minImageWidth":0}}}\n'
    + '含义：system 排版骨架（axis 中轴 / grid 严格网格 / free 自由错位）；whitespace 留白（越大越疏）；\n'
    + 'place 照片呈现（mat 相纸不裁 / mat-tape 相纸+胶带 / fullbleed ★满幅压字：图铺满整页 + 压一层暗场 + 标题叠在图上）；\n'
    + '★「满幅压字」只适合**主体清楚、本身好看**的实拍（横图 / 主体居中 / 画面有氛围）；'
    + '以文字截图、表格、信息图为主的素材**不要**选它（字会跟图里的字打架）；\n'
    + 'complete=true 表示"这套风格**保证图片完整**"（此时别选 fullbleed）；\n'
    + 'titleForm 标题形态；weight/tracking/scale = 标题字重 / 字距 / 字号倍率。\n'
    + '硬规矩：① 只回 JSON，不要解释、不要 markdown 围栏；② **拿不准的键就别写**（会退回默认，不会出错）；\n'
    + '③ 不许编造数据/品牌；④ 自检"同一度"——别让每一页长得一样；\n'
    // ★VF_SPEC_V2b（2026-10-10 实测：AI 只填了 text 组 4 个键 ⇒ 版式/图片/动效全走默认）：
    //   它把"拿不准就别写"执行得过于保守 ⇒ 明确点出"这三项最影响观感，尽量定下来"。
    + '⑤ **尽量**把这三项也定下来（它们最影响观感）：`layout.system`、`image.place`、`motion.img`；\n'
    + '   真拿不准才省略（省略 = 用引擎默认，不会出错）；\n'
    // ★VF_FILMTRANS_V2b：转场键早就在引擎里，之前白名单漏了 ⇒ AI 声明也被丢，现在补上并明确告诉它
    + '⑥ 可选 `motion.trans`（**只在"整张不裁的全图页"上生效**）：auto/fade/wipe/cut/push/slide-up/zoom-through/blur-dissolve/light-leak。\n'
    + (paint
      ? '\n★**本次完全自主**：连**配色**也由你定（不使用库里任何模板皮肤）。请在 JSON 里再加一组 theme：\n'
        + '"theme":{"bg":"#rrggbb","bg2":"#rrggbb","ink":"#rrggbb","dim":"#rrggbb","accent":"#rrggbb"}\n'
        + '配色硬线（不合格会被**整组丢弃**、退回默认皮肤）：\n'
        + '  ① bg 与 ink 对比度 ≥ 4.5（字必须看得清：深底配浅字，浅底配深字）；\n'
        + '  ② accent 与 bg 对比度 ≥ 2.5（强调要看得出来，别整片一坨同色）；\n'
        + '  ③ 全部用 #rrggbb；④ bg2 与 bg 要**有轻微差别**（成片拿它做第二层，同色会显平）；\n'
        + '  ⑤ 配色要**服务素材**（美食偏暖、科技偏冷、医疗偏洁净），别为了花哨牺牲可读性。\n'
      : '')
}

/* ═════════ ★VF_PACKAI_V1（2026-10-11 用户定案「AI审图的时候就挑选可用的可以吗？」）═════════
   背景：自动挑包原来是"赛道 prefer[0]"（**永远同一个包**），轮换又会轮到不合适的（"轮上去直接没法看"）。
   现口径：**让 AI 看着素材挑**（在读图/审图那一步，一次调用），且**只能从"体检通过"的包里挑**
   （体检 = tools/check-style-packs.mjs → styles/health.json）。
   ⚠️ 校验在服务端做（`pickPackId`）：模型编的 id 一律不认 ⇒ 退回引擎兜底。 */

/** 给模型的挑包题面：**只给候选清单**（id 必须逐字来自清单） */
export function packPickPrompt(
  list: Array<{ id: string; name?: string; desc?: string; mood?: string }>,
  summary: string, topic: string): string {
  const rows = (Array.isArray(list) ? list : []).slice(0, 80)
    .map((p) => '- ' + p.id + '（' + String(p.name || '') + (p.mood ? ' · ' + p.mood : '') + '）：'
      + String(p.desc || '').slice(0, 70))
    .join('\n')
  return '你是短片的美术指导。请**看着这批素材**，从下面这份"可用风格包"清单里挑**最合适的一个**。\n'
    + (topic ? '主题：' + topic + '\n' : '')
    + (summary ? '【素材读图总结】\n' + String(summary).slice(0, 1200) + '\n' : '')
    + '\n【可用风格包】（**只能从这些 id 里挑**）\n' + rows + '\n'
    + '\n只回一个 JSON：{"pack":"<上面某个 id>","why":"一句话理由","lay":"auto|bleed|plate"}。\n'
    + '`lay`＝**图呈现**（★VF_LAY_V1，2026-10-14 用户定案「满幅压字要可选、不要改老风格」）：\n'
    + '  auto＝跟风格包自带版式（**拿不准就填它**）；\n'
    + '  bleed＝**满幅压字**（图铺满整页 + 压一层暗场 + 标题叠在图上；适合主体清楚、本身好看的实拍，尤其横图）；\n'
    + '  plate＝**相纸不裁**（图整张不裁、不压字；适合以文字截图 / 表格 / 信息图为主，或绝不能被裁的图）。\n'
    + '硬规矩：① id 必须**逐字**来自上面清单（编造的 id 会被丢弃）；② 按"素材气质 / 用途"匹配，'
    + '不要只看配色好不好看；③ 以竖屏截图为主的素材，优先信息层级清楚的（如 dark-dashboard / glass-saas）；'
    + '④ 美食/风景实拍，优先留白多、照片为主的（如 reel-showcase / paper-editorial）。'
}

/** 从模型回答里取包 id：**必须在 allowed 里**（编的 id / 空 / 非字符串一律不认 ⇒ null） */
export function pickPackId(j: any, allowed: string[]): string | null {
  const id = String((j && typeof j === 'object' && j.pack !== undefined && j.pack !== null) ? j.pack : '').trim()
  if (!id) return null
  return (Array.isArray(allowed) ? allowed : []).includes(id) ? id : null
}

/* ═════════ ★VF_LAY_V1（2026-10-14 用户定案「满幅压字要**可选**，而不是改老风格；AI 也可选」）═════════
   背景：用户看到"动效字压在素材图上"的小样，觉得这样**图片面积更完整**。
   查证结论（先查再改，不重造）：这能力**引擎早就有** —— `image.place='fullbleed'` +
   `text.titleForm='overlay'`，实现在 `tools/film-to-page.mjs` 的 `specCss` ③ 段
   （图铺满整页 + 压一层暗场 + 字转白加投影）。
   ⇒ 所以**不加新风格包**（那只覆盖一个方案），而是把它做成**正交于风格包的一个声明**：
     51 个风格包都能套；老包一个字节不改 ⇒ 不选 `bleed` 时**出片与今天完全一致**。
   两条 AI 通道（都不额外烧点）：① 用户勾了"让 AI 自己规划版式" ⇒ `specPrompt` 里声明 image.place；
   ② 没勾（默认）⇒ 在已有的"审图挑包"那一次调用里顺带问 `lay`（`packPickPrompt`）。
   两条人的通道：第 2 步卡上的三选（用户手选**压倒** AI 的建议）。
   边界（引擎已定，这里不改）：fullbleed **只作用于"整页单图"三类结构**
   （fullbleed / plate-top / plate-bottom）；多图页保持网格 —— 想让多图页也压字要新增页型，是另一个活。 */

/** 图呈现（用户在第 2 步卡上选；'auto' = 跟风格包 / 交给 AI 判） */
export const LAY_IDS = ['auto', 'bleed', 'plate'] as const

/** 只认这三个值（编的值 / 空 ⇒ null，调用方**保持原值**，不静默改） */
export function pickLayId(v: any): string | null {
  const s = String(v === undefined || v === null ? '' : v).trim()
  return (LAY_IDS as readonly string[]).includes(s) ? s : null
}

/** 一句话（卡片 / 日志用） */
export function describeLay(lay: string): string {
  return lay === 'bleed' ? '满幅压字' : lay === 'plate' ? '相纸不裁' : '跟风格'
}

/** lay ⇒ spec 覆盖（**只在这一处翻译**；返回 null = 不覆盖任何键）
 *  ⚠️ `bleed` 必须**同时**给 `complete:false`：满幅必然裁切，只改 place 不改 complete
 *     就是"声明自相矛盾"，arrange 与骨架会打架（出片被 stage=spec 拒渲）。 */
export function laySpec(lay: string): any | null {
  const s = pickLayId(lay)
  if (!s || s === 'auto') return null
  if (s === 'bleed') {
    return {
      image: { place: 'fullbleed', complete: false },
      text: { titleForm: 'overlay' },
      motion: { type: 'overlay' },
    }
  }
  // plate：强制"相纸不裁"（用来**压过** AI / 风格包可能选的 fullbleed）
  return { image: { place: 'mat', complete: true } }
}

/** 把 lay 覆盖**合并进** spec —— 优先级：**用户手选 > AI 规划 > 风格包 spec > 引擎默认**
 *  ⚠️ 必须发生在 `planFilm`（排骨架）**之前**：`image.complete` 决定 arrange 允不允许 fullbleed，
 *     声明晚了骨架与声明就打架 ⇒ 出片时被 stage=spec 拒渲（2026-10-10 实测抓过这条）。 */
export function mergeLay(spec: any, lay: string): any {
  const ov = laySpec(lay)
  if (!ov) return spec
  const out: any = (spec && typeof spec === 'object') ? JSON.parse(JSON.stringify(spec)) : {}
  for (const g of Object.keys(ov)) {
    out[g] = { ...((out[g] && typeof out[g] === 'object') ? out[g] : {}), ...ov[g] }
  }
  return out
}

/* ═════════ ★VF_FILM_PITCH_V1（2026-10-22 用户原话「**不是改画面上的，改的是口播**。AI 出 3 条可以选、可以修改」）═════════
   背景：老流程是"AI 按骨架各写一句 ≤18 字的口播句"⇒ 拼起来是一串**碎句**（各写各的，语意不接），
   而且提示词里完全没有"钩子 / 开场抓人 / 优惠"的要求（全仓 grep 0 命中）。
   现口径：先出 **3 条完整口播营销稿**（不同角度）⇒ 用户选 1 条、可手工改 ⇒ 定稿那条再按段切开。

   为什么放在本文件：`film-spec.ts` **只有 HTML 成片线引用**（已全仓核对），题面与解析放这里天然隔离，
   而且都是纯函数 ⇒ 能脱离模型单测（见 temp/_spec/test.mjs）。 */

/** 口播营销稿的题面（3 条不同角度：钩子型 / 优惠型 / 口碑型）
 *  ⚠️ 硬线①：**没有优惠就不许编优惠**（模型最爱自己发明"立减 20"）；
 *  ⚠️ 硬线②：零 emoji、不许自创品牌名、不许编数据。 */
export function pitchPrompt(summary: string, topic: string, planTxt: string): string {
  return '你是短视频口播稿写手。素材是一组餐饮/美食实拍。\n'
    + '【素材总结（视觉模型读图所得）】\n'
    + (summary ? String(summary).slice(0, 1200) : '（这次没有读图结果 ⇒ 只写能确定的内容，拿不准的细节一律不写）') + '\n'
    + '【用户给的主题/卖点】'
    + (topic ? topic : '（用户没给 ⇒ 只依据素材，不许自创品牌、不许编数据）') + '\n'
    + '【这条片的段落骨架】\n' + String(planTxt || '').slice(0, 600) + '\n\n'
    + '请写 **3 条不同角度的口播营销稿**，每条 120~180 字（口播 30~45 秒）：\n'
    + '① 钩子型：第 1 句必须是钩子（≤15 字，用具体细节抓人，不许"超值""必吃""一口上瘾"这类空话）\n'
    + '② 优惠型：把活动说清楚（**只在素材或主题里真的出现打折/活动时才写；没有就换一个角度，绝不许编优惠**）\n'
    + '③ 口碑型：用真实可见的细节立信（现切、卖完就收、几点开门这类）\n'
    + '三条都必须：\n'
    + '· 口语化，能直接念（不要书面语、不要排比句堆砌）\n'
    + '· 第 1 句就能立住（不要"大家好""今天给大家介绍"）\n'
    + '· 结尾给一个落点（到店/留言/收藏，三选一，不要每条都"评论区见"）\n'
    + '· **零 emoji、零表情符号**\n'
    + '· **不许编造数据、不许编不存在的优惠、不许自创品牌名**\n'
    + '只输出严格 JSON：\n'
    + '{"candidates":[{"angle":"钩子型","text":"…"},{"angle":"优惠型","text":"…"},{"angle":"口碑型","text":"…"}]}'
}

/** 从模型回答里取口播稿候选（**白名单式**：只认 text/script/content 三种键；不编、不去重不漏）
 *  · 条数不足**不补**（有几条给几条，调用方如实告知）；超过 3 条只取前 3；
 *  · 顺手清掉 emoji 与换行（口播要能直接念）；过短的丢掉（多半是角度标签而不是稿子）。 */
export function pickPitchCandidates(j: any): string[] {
  const raw = Array.isArray(j) ? j
    : (j && typeof j === 'object' && Array.isArray((j as any).candidates)) ? (j as any).candidates
    : (j && typeof j === 'object' && Array.isArray((j as any).pitches)) ? (j as any).pitches
    : []
  const out: string[] = []
  for (const x of raw) {
    const src = (typeof x === 'string') ? x
      : String((x && (x.text || x.script || x.content)) || '')
    const t = src
      .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2190}-\u{21FF}]/gu, '')   // 零 emoji / 零箭头符号
      .replace(/\s+/g, ' ')
      .trim()
    if (t.length < 10) continue          // 太短 = 角度标签，不是稿子
    if (out.includes(t)) continue        // 三条必须各不相同（用户"选"的前提）
    out.push(t.slice(0, 400))
    if (out.length >= 3) break
  }
  return out
}
