import { NextRequest, NextResponse } from 'next/server'
// 2026-08-27: 发布草稿状态（多轮确认工作流用）：userId -> { videoName, frames, selectedFrame, title, topics, cover, step }
import { listRepoMaterials, summarizeMaterials, downloadMaterials, vfLog, vfRootDir, vfStorageRoot, probeMaterialSizes } from '@/lib/agent/video-material'
// ★VF_LINES_V1（2026-09-21）：三条新线的【入口词】判断 —— 用于 skipModelStep1（把"AI 制片/混合创作"
//   也当成"状态机入口信号"）。这两个函数是**纯正则、零依赖**（两个文件都是零 import），
//   所以静态 import 不会引入循环依赖。
import { matchesAiLine, clearVfAiDraft, hasAiDraft } from '@/lib/agent/vf/vf-aivideo'
import { matchesMixLine, clearVfMixDraft, hasMixDraft } from '@/lib/agent/vf/vf-mix'
// ★STD_MODE_V1（2026-09-21，用户定案）：标准模式 = 【命令白名单，锁死】——
//   命令表唯一真相源在 `src/lib/agent/standard-commands.ts`（加/改命令只改那张表，别再往这里加正则）。
import { matchStdCommand, STD_UNSUPPORTED_REPLY, STD_WIP_REPLY } from '@/lib/agent/standard-commands'

const PUBLISH_DRAFT: Map<number, any> = new Map()
// ★VF_FLOW_V1（2026-09-18）：成片状态机草稿——与 PUBLISH_DRAFT 【完全独立】，互不干扰
const VIDEO_DRAFT: Map<number, any> = new Map()
// ★VF_VOICE_V1（2026-09-20）：百炼官方音色（与 /api/agent/prefs 的 TTS_VOICES 对齐）
//   注意：原代码写死的 longyuan/龙嫗 **不在官方列表**（无效），已全部改掉；克隆音色按用户追加
const VF_VOICE_BASE = [
  { id: 'longxiaochun', name: '龙小淳 · 女声温柔（默认）' },
  { id: 'longxiaoxia', name: '龙小夏 · 女声清亮' },
  { id: 'cherry', name: '豆豆 · 女声甜美' },
  { id: 'longshu', name: '龙书 · 男声沉稳' },
  { id: 'longchen', name: '龙陈 · 男声浑厚' },
  { id: 'longjing', name: '龙靖 · 男声知性' },
  { id: 'longxiaohui', name: '龙小辉 · 男声阳光' },
]

// ★VF_PICKFIX_V1（2026-09-20，用户实测“排了 0 个镜头”的根因）：
//   AI 把示例里的占位符照抄，输出 `"pick":图1`（带汉字、无引号）→ **JSON 非法** →
//   解析失败 → 0 镜 → 只能走规则切句 → **成片没有任何素材画面**。
//   两层保险：① prompt 给合法示例（见 genVideoShots）② 解析前用正则修回来。
function vfFixJsonArray(raw: string): string {
  return String(raw || '')
    .replace(/[“”]/g, '"')
    .replace(/"pick"\s*:\s*"?\s*(?:图|第|img|image)?\s*(\d{1,3})\s*(?:张|号)?\s*"?/gi, '"pick":$1')
    .replace(/,\s*([\]}])/g, '$1')
}

function vfParseShots(raw: string): any[] | null {
  const m = String(raw || '').match(/\[[\s\S]*\]/)
  if (!m) return null
  try { const a = JSON.parse(m[0]); if (Array.isArray(a)) return a } catch {}
  try { const a = JSON.parse(vfFixJsonArray(m[0])); if (Array.isArray(a)) return a } catch {}
  return null
}

/** ★VF_SHOTGEN_V1：生成分镜（prompt + 解析 + 正则容错 + **自动重试一次修正 JSON**）
 *  起草与“重试分镜”共用同一份逻辑，避免两处走偏；返回的镜头已把 pick 换成【真实本地路径】。
 */
async function genVideoShots(o: {
  uid: number | string; aspect: string; dur: number; shotN: number
  imgPaths: string[]; brief: string; script: string; retryHint?: string
  /** ★VF_AIVIDEO_V1（2026-09-20）：「全部 AI 生成」时，额外要求每镜给一个【英文画面描述】，
   *  作为 MiniMax H3 的生成提示词。**不传时输出与原来完全一致**（素材合成不受任何影响）。 */
  wantPrompt?: boolean
  /** ★VF_AIONLY_V1（2026-09-21 用户定案）：**AI 制片 = 文生视频** ——
   *  除了"第一步看素材猜题材"之外，**全程不碰素材库**。所以归一化时**只允许不需要素材图的卡**
   *  （title / list / number / compare / chart / end）：`bgimage` / `image` 一律降级成 `title`（不配图）。
   *  不传时行为与原来完全一致（素材线 / 混合线不受任何影响）。 */
  aiOnly?: boolean
}): Promise<any[]> {
  const imgs = (o.imgPaths || []).filter(Boolean)
  const charN = String(o.script || '').length
  const avgN = Math.max(8, Math.round(charN / Math.max(1, o.shotN)))
  const prompt = `你是短视频编导。把下面这条口播文案排成分镜。\n画幅 ${o.aspect === 'landscape' ? '横屏 16:9' : '竖屏 9:16'}，总时长约 ${o.dur} 秒，【必须切成 ${o.shotN} 个镜头左右（±3 以内）】，【各镜 dur 相加必须约等于 ${o.dur} 秒】。${o.retryHint ? '\n⚠️上次你没排好：' + o.retryHint : ''}\n【可用的图】共 ${imgs.length} 张（图号 1~${imgs.length}）${o.brief ? '，内容：\n' + o.brief : ''}\n\n只输出严格 JSON 数组（不要 markdown、不要解释），字段示例（注意 pick 是【纯数字】；subtitle 要像下面这么长）：\n[{"type":"bgimage","pick":1,"text":"效率翻10倍","subtitle":"很多营销人还在熬夜改文案、通宵盯屏幕，今天给你看一套能自动出片的系统。","dur":7},{"type":"title","text":"AI营销系统","subtitle":"它不是你想象里的概念，而是真正能在后台跑起来的营销引擎。","dur":5},{"type":"list","title":"三大能力","items":["写文案","做视频","自动发布"],"subtitle":"先看第一个能力：输入你的产品卖点，一键生成上百条不同风格的文案。","dur":6},{"type":"number","value":10,"suffix":"倍","label":"效率提升","subtitle":"这不是夸张说法，是我们内测团队跑出来的真实数据。","dur":5},{"type":"end","text":"评论区见","cta":"点击咨询","subtitle":"想要这套系统的，评论区留下你的行业，我把内测名额发给你。","dur":5}]\n★【type 只能是这 7 种：bgimage / title / list / number / compare / chart / end】——不要自造 subtitle、text、image、script 等其它 type！subtitle 是【字段名】，不是 type。\n  · 讲到【两个东西对比 / 有这个没这个】时用 compare：{"type":"compare","left":"旧做法","right":"新做法","leftDesc":"一句话说明","rightDesc":"一句话说明","subtitle":"这一镜念的文案","dur":5}\n  · 讲到【多个数据 / 占比 / 排名】时用 chart：{"type":"chart","title":"效果对比","items":[{"label":"人工","value":32},{"label":"AI","value":78}],"subtitle":"这一镜念的文案","dur":6}\n  · 其余情况用 bgimage（配你的素材图）最稳。\n★★【示例里的文字只是“字段长什么样”的演示，你必须全部换成与下面这段文案相关的新内容 —— **绝对不许照抄示例里的任何词句**（用户实测：照抄导致每条成片画面大字都一样）】★★\n要求：\n①【最关键】每个镜头都要给 subtitle，且【所有 subtitle 拼起来必须**完整覆盖**下面那段文案】（文案共 ${charN} 字，按 ${o.shotN} 镜算 → **平均每镜约 ${avgN} 字**；宁可一镜写到 60 字，也不许只写一部分）\n② text 只能是 4~8 字的短语（它是画面上的大字，不是字幕）\n③【pick 必须是纯数字】（如 1、2、3），范围 1~${imgs.length}；★不要写“图1”“图 1”“第1张”这种带汉字的写法；每个 bgimage 的 pick 尽量用不同数字\n④ 不要编造素材里没有的东西。${o.wantPrompt ? `\n★★【本片画面由 AI 逐镜生成】所以每个镜头还必须多给一个 prompt 字段：**英文**的画面生成提示词，含【主体 + 动作 + 场景 + 光影 + 镜头感（如推近/平移/航拍）】，60~80 词；只描述画面，**不要在画面里出现任何文字**（文字由字幕层负责）。prompt 必须与该镜的 subtitle 语义一致 —— 文案说什么，画面就演什么。\n  示例（注意 prompt 是英文）：{"type":"bgimage","pick":1,"text":"效率翻10倍","subtitle":"很多营销人还在熬夜改文案。","prompt":"A young marketer working late at a desk at night, laptop glow on his face, camera slowly pushes in, cinematic warm lighting, shallow depth of field","dur":7}` : ''}\n编镜依据（文案）：\n${o.script}`
  let raw = ''
  try { raw = (await generateText(prompt)) || '' } catch (e: any) { vfLog(o.uid, '[分镜生成失败] ' + String(e?.message || e).slice(0, 120)) }
  let arr = vfParseShots(raw)
  if (!arr) {
    // ★自动重试一次：把非法输出回喂给 AI，**只让它修 JSON 语法**（用户选定方案）
    try {
      vfLog(o.uid, '[分镜重试] 首次输出不合法 → 回喂修 JSON')
      const fixed = (await generateText(`下面这段本应是 JSON 数组但语法有误（常见：数字被写成了“图1”这类带汉字的字符串、中文引号、尾随逗号）。请【只修正 JSON 语法、不改内容】，只输出修正后的 JSON 数组，不要任何解释：\n${String(raw).slice(0, 6000)}`)) || ''
      arr = vfParseShots(fixed)
      vfLog(o.uid, arr ? `[分镜重试] 成功 ${arr.length} 镜` : '[分镜重试] 仍失败')
    } catch (e: any) { vfLog(o.uid, '[分镜重试异常] ' + String(e?.message || e).slice(0, 120)) }
  }
  if (!arr) { vfLog(o.uid, '[分镜] 0 镜（解析失败，已重试）'); return [] }
  // ★VF_TYPEFIX_V1：合法 type 白名单（未知 type 会归一化成 bgimage/title，别丢内容）
  // ★2026-09-20：`timeline` 已移出白名单 —— render.py 的 CARDS 派发表里没有这个卡型，
  //   放行它会让 render.py 抛"未知配方卡"（现已同时改成降级 title，见 VF_UNKNOWNCARD_V1）。
  // ★2026-09-20 收口：白名单只保留【prompt 会产出的 7 种】——
  //   原来还放着 `image`/`timeline`：`image` 卡需要 AI 给出**本地 src 路径**（它根本给不出）
  //   → 放行会让 render.py 拿到空路径 → 整镜渲染失败（与上轮 timeline 同一类问题）。
  //   移除后，自造 `image`/`video`/`quote`/`timeline` 一律走"未知 type → 归一化成 bgimage/title"，
  //   而那条路径**还会自动给它配图** —— 比放行更安全。
  const KNOWN_TYPES = ['bgimage', 'title', 'list', 'number', 'compare', 'chart', 'end']
  // ★VF_PICKSPREAD_V1（2026-09-20 用户实测“6 镜只用到 2 张图”）：
  //   AI 给的 pick 常常反复用同一张 → 画面重复。改成**“用得最少优先 + 相邻不重复”**：
  //   ① AI 的 pick 只当“倾向”；若该图已超过合理次数、或与上一镜相同 → 换用得最少的
  //   ② 每用一次计数 +1 → 天然均匀分布
  // ★VF_NOCLONE_V1（2026-09-20 用户实测“画面大字一直没变过”）：
  //   AI 会**照抄 prompt 示例里的文字**（示例：效率翻10倍/AI营销系统/三大能力/评论区见…）
  //   → 命中示例词的一律清掉：宁可这一镜没有大字，也不要每条成片都一样。
  const usedCnt = new Array(Math.max(1, imgs.length)).fill(0)
  let lastIdx = -1
  // ★VF_NOCLONE_V1：示例词黑名单（照抄的"特征词"；太通用的（如 AI / 人工）故意不收，避免误伤）
  const DEMO_WORDS = new Set([
    '效率翻10倍', 'AI营销系统', '三大能力', '效率提升', '评论区见', '点击咨询', '写文案', '做视频', '自动发布',
    '旧做法', '新做法', '一句话说明', '效果对比',
  ])
  const notDemo = (v: any): string => {
    const t = String(v == null ? '' : v).trim()
    return t && !DEMO_WORDS.has(t) ? t : ''
  }
  const nextIdx = (want: number): number => {
    const n = imgs.length
    if (!n) return -1
    const cap = Math.max(1, Math.ceil((o.shotN || 8) / n))   // 每张图的合理上限（按目标镜数摊）
    let idx = (Number.isFinite(want) && want >= 1 && want <= n) ? want - 1 : -1
    if (idx < 0 || idx === lastIdx || usedCnt[idx] > cap) {
      let best = -1
      for (let k = 0; k < n; k++) {
        if (k === lastIdx) continue
        if (best < 0 || usedCnt[k] < usedCnt[best]) best = k
      }
      idx = best >= 0 ? best : (lastIdx + 1) % n
    }
    if (idx >= 0 && idx < n) usedCnt[idx]++
    lastIdx = idx
    return idx
  }
  const shots = arr.map((s: any) => {
    const ty = String(s?.type || '')
    if (ty === 'bgimage' || ty === 'image') {
      const sub = String(s.subtitle || '').slice(0, 200)
      const idx = nextIdx(parseInt(s.pick))
      const lp = idx >= 0 ? imgs[Math.max(0, Math.min(imgs.length - 1, idx))] : ''
      // ★VF_AIVIDEO_V1（2026-09-20）：这里是**显式造对象**（不是 {...s}）→ 原来会把 AI 给的
      //   `prompt`（英文画面描述）**丢掉**，导致 make.py 只能用中文 subtitle 兜底。
      //   只在真有 prompt 时附带该字段 → 素材合成的输出结构与原来完全一致。
      const _pp = s.prompt ? { prompt: String(s.prompt).slice(0, 900) } : {}
      if (!lp || o.aiOnly) return { type: 'title', text: notDemo(s.text), subtitle: sub, dur: 3.5, ..._pp }
      // 注意：bgimage 的 text 是“画面大字”，**不能**当配音文案，所以这里只取 subtitle
      return { type: 'bgimage', src: lp, text: notDemo(s.text).slice(0, 14), subtitle: sub, dur: Math.min(8, Math.max(2, parseInt(s.dur) || 4)), ..._pp }
    }
    if (KNOWN_TYPES.includes(ty)) {
      // ★VF_NOCLONE_V1：清掉照抄的示例文字（text/title/label/cta/items）
      const o: any = { ...s }
      if (o.text !== undefined) o.text = notDemo(o.text)
      if (o.title !== undefined) o.title = notDemo(o.title)
      if (o.label !== undefined) o.label = notDemo(o.label)
      if (o.cta !== undefined) o.cta = notDemo(o.cta)
      if (Array.isArray(o.items)) {
        // ★2026-09-20 修（放开 chart 卡时核对下游发现）：items 有两种形态 ——
        //   list 卡是 string[]；**chart 卡是 [{label,value}] 对象数组**。
        //   原来一律 notDemo(x) → 对象会被 String() 成 "[object Object]" → card_chart 渲染崩。分形态处理。
        o.items = o.items
          .map((x: any) => (x && typeof x === 'object' ? { ...x, label: notDemo(x.label) } : notDemo(x)))
          .filter((x: any) => (x && typeof x === 'object' ? true : !!x))
      }
      return o
    }
    // 未知 type（AI 自造）→ 别丢内容：文案取 subtitle/text/content/script，画面用素材轮换
    const sub2 = String(s?.subtitle || s?.text || s?.content || s?.script || '').trim().slice(0, 200)
    if (!sub2) return null
    const idx2 = nextIdx(-1)
    const lp2 = idx2 >= 0 ? imgs[Math.max(0, Math.min(imgs.length - 1, idx2))] : ''
    const head2 = notDemo(s?.title) || notDemo(s?.text) || sub2.slice(0, 8)
    const dur2 = Math.min(8, Math.max(2, parseInt(s?.dur) || 5))
    if (!lp2 || o.aiOnly) return { type: 'title', text: String(head2).slice(0, 14), subtitle: sub2, dur: dur2 }
    return { type: 'bgimage', src: lp2, text: String(head2).slice(0, 14), subtitle: sub2, dur: dur2 }
  }).filter(Boolean).slice(0, Math.max(4, Math.min(40, o.shotN || 8)))
  // ★VF_SHOTCOUNT_V1（2026-09-20 用户实测“13 镜/190 秒、一镜 14.6 秒太闷”）：
  //   AI 常排不够镜头（目标 36 只给 13），而兜底又是“按现有镜数切” → 一镜 24 秒。
  //   这里直接按【目标镜数】重排：文案切 N 段 + 保留 AI 的解说卡骨架（按位置摊开）
  //   + 其余用素材图卡轮换 → 每镜回到 ~5 秒的正常节奏。
  if (shots.length >= 2 && shots.length < o.shotN * 0.7 && charN > 0) {
    const beforeN = shots.length
    const segs = vfSplitScript(o.script, o.shotN)
    if (segs.length > shots.length) {
      const specials = shots.filter((s: any) => s?.type && s.type !== 'bgimage' && s.type !== 'image')
      const slotMap = new Map<number, any>()
      specials.forEach((s: any, k: number) => {
        const slot = Math.max(0, Math.min(segs.length - 1, Math.round((k + 0.5) * segs.length / Math.max(1, specials.length))))
        slotMap.set(slot, s)
      })
      const rebuilt: any[] = []
      for (let i = 0; i < segs.length; i++) {
        const sub = String(segs[i] || '')
        const sp = slotMap.get(i)
        if (sp) rebuilt.push({ ...sp, subtitle: sub.slice(0, 300) })
        else {
          // ★A5（2026-09-22，用户要求「帧和图片素材要大致对上」）：
          //   原来是 `imgs[i % imgs.length]` —— **纯轮询**，和这一镜在讲什么毫无关系，
          //   一扩镜就必然"图文错位"（用户实测踩过）。改成复用上面的 nextIdx()：
          //   它按"AI 的 pick 优先 → 用得最少优先 → 相邻不重复"取图，
          //   在保序前提下让画面跟着文案顺序走，且不会相邻两镜撞同一张图。
          const _ri = nextIdx(-1)
          rebuilt.push({ type: 'bgimage', src: _ri >= 0 ? imgs[Math.max(0, Math.min(imgs.length - 1, _ri))] : '', text: '', subtitle: sub.slice(0, 300), dur: 5 })
        }
      }
      vfLog(o.uid, `[扩镜] AI 只排 ${beforeN} 镜（目标 ${o.shotN}）→ 按目标重排 ${rebuilt.length} 镜（每镜约 ${Math.round(charN / Math.max(1, rebuilt.length))} 字 ≈ ${Math.round(charN / Math.max(1, rebuilt.length) / 4.5)} 秒）`)
      return rebuilt
    }
  }
  vfLog(o.uid, `[分镜] ${shots.length} 镜`)
  return shots
}

/** ★VF_SUBFILL_V1 / ★VF_SPLIT2_V1：把口播文案**按顺序**切成 n 段。
 *  用于 subtitle 兜底 —— 文案本来就是连续口播稿，顺序切分自洽，覆盖率必然 ~100%。
 *  ★2026-09-20 实测修正（一镜 24 秒 / 107 字 → “画面停太久”的真因）：
 *    ① 句子超过 maxLen 时按「，、；」二级切（否则“每段限长”根本做不到）
 *    ② 装箱阈值降为 min(maxLen, per*1.35) → 段长更均匀
 *    ③ 段数不足 n 时**把最长段劈开**（原来是补空段 → 空段 = 一镜没字幕没配音）
 */
function vfSplitScript(script: string, n: number, maxLen = 45): string[] {
  // ① 一级：按句末切
  const raw: string[] = []
  let cur = ''
  for (const ch of String(script || '')) {
    cur += ch
    if ('。！？!?'.includes(ch)) { const t = cur.trim(); if (t) raw.push(t); cur = '' }
  }
  if (cur.trim()) raw.push(cur.trim())
  if (!raw.length || n <= 0) return []
  // ② 二级：超长句按「，、；」再切
  const sents: string[] = []
  for (const s of raw) {
    if (s.length <= maxLen) { sents.push(s); continue }
    let buf = ''
    for (const ch of s) {
      buf += ch
      if (buf.length >= maxLen * 0.6 && '，、；,;'.includes(ch)) { const t = buf.trim(); if (t) sents.push(t); buf = '' }
    }
    if (buf.trim()) sents.push(buf.trim())
  }
  // ③ 装箱：尽量凑到 per，但**不许超过 maxLen**
  const total = sents.reduce((a, s) => a + s.length, 0)
  const per = total / n
  const cap = Math.max(12, Math.min(maxLen, per * 1.35))
  const out: string[] = []
  let acc = ''
  for (const s of sents) {
    if (acc && (acc.length + s.length > cap) && out.length < n - 1) { out.push(acc); acc = s }
    else acc += s
  }
  if (acc) out.push(acc)
  // ④ 段数不足 → 劈最长段（不再补空段）
  let guard = 0
  while (out.length < n && guard++ < n * 4) {
    let mi = 0
    for (let i = 1; i < out.length; i++) if ((out[i] || '').length > (out[mi] || '').length) mi = i
    const long = out[mi] || ''
    if (long.length < 10) break
    const half = Math.max(1, Math.floor(long.length / 2))
    let cut = -1
    for (let i = half; i < Math.min(long.length, half + 12); i++) {
      if ('，、；,;。！？'.includes(long[i])) { cut = i + 1; break }
    }
    if (cut < 0) for (let i = half; i > Math.max(1, half - 12); i--) {
      if ('，、；,;。！？'.includes(long[i])) { cut = i + 1; break }
    }
    if (cut <= 0) cut = half
    out.splice(mi, 1, long.slice(0, cut).trim(), long.slice(cut).trim())
  }
  // ⑤ 段数过多 → 尾部合并
  while (out.length > n) { const last = out.pop() || ''; out[out.length - 1] = (out[out.length - 1] || '') + last }
  return out
}

/** ★VF_GATE_V1：拼“确认卡”。shotsFailed=true 时【不给确认出片】（用户实测：0 镜也放行 → 成片没画面） */
function vfScriptCard(vd: any, shots: any[], imgN: number, brief: string, aspect: string, cover = 1, estSec = 0): string {
  const voiceName = (vd.voiceList || VF_VOICE_BASE).find((v: any) => v.id === vd.voice)?.name || vd.voice || ''
  // ★VF_THEMENAME_V1（2026-09-20）：风格 id → 用户看得懂的名字（卡片上显示“当前风格”，
  //   否则用户选完风格，回头在确认卡上看不到自己选了哪个）
  const _THEME_NAME: Record<string, string> = { dark: '深蓝科技', tech: '深青科技', light: '浅色纸感' }
  const themeName = _THEME_NAME[String(vd.theme || 'dark')] || '深蓝科技'
  const charN = String(vd.script || '').length
  const targetSec = Math.round(Number(vd.dur) || 0)
  const aspectName = aspect === 'landscape' ? '横屏 16:9' : '竖屏 9:16'
  // ★VF_AIVIDEO_V1（2026-09-20）：「全部 AI 生成」时，卡片成本**必须与 make_ai_video 的扣费同口径**
  //   （按【秒 × 50 点】，768P）——否则就是"卡片报 7 点、实扣 500 点"，
  //   与之前那次"多扣费"是同一类事故（只是方向相反）。报价与实扣同源，是硬要求。
  const _isAI = String(vd.source || vd.mode || '') === 'ai'
  const cost = _isAI
    ? Math.max(1, Math.ceil(Math.max(4, targetSec || 30) * 50))
    : Math.max(1, Math.ceil(charN / 20))
  // ★覆盖不足也算“不给确认”（不然出来的片子只有 110 秒 / 只念 30%）
  if (!shots || shots.length < 2 || cover < 0.8) {
    const why = (!shots || shots.length < 2)
      ? '**分镜没生成成功**（已自动重试一次）'
      : `分镜只覆盖了文案的 **${Math.round(cover * 100)}%**（预计 ${estSec} 秒 / 目标 ${targetSec} 秒）——直接出片只会念一部分`
    return 'VF_JSON:' + JSON.stringify({
      step: 'script', topic: vd.topic, script: vd.script, shotsFailed: true,
      usedImages: imgN, brief: String(brief || '').slice(0, 400),
      voice: vd.voice, voiceName, cost,
      source: _isAI ? 'ai' : '',
      coverage: cover, estSec, targetSec, shotCount: (shots || []).length,
      hint: `文案好了（${charN} 字），但 ${why}。回「重试」我再排一次；若只想先要一条只有字幕配音、没有素材画面的版本，回「先出字幕版」`,
    })
  }
  return 'VF_JSON:' + JSON.stringify({
    step: 'script', topic: vd.topic, script: vd.script,
    shots: shots.map((s: any) => ({
      type: s.type,
      // ★2026-09-20：原来只取 text/title/value → compare（左右对比）与 chart（数据条）
      //   在卡片上是空的。补上这两类的可读摘要，让"分镜清单"能看出每镜讲什么。
      text: s.text || s.title
        || (s.type === 'compare' ? `${s.left || ''} vs ${s.right || ''}` : '')
        || (s.type === 'chart' && Array.isArray(s.items)
          ? s.items.map((x: any) => x && x.label).filter(Boolean).join(' / ') : '')
        || String(s.value ?? ''),
      // ★VF_SHOTDUR_V1（2026-09-20）：把【每镜时长】也传给卡片 ——
      //   用户在"分镜清单"里就能看出哪一镜偏长（如 14 秒），不必等成片、也不必跑脚本。
      dur: Math.round((Number(s.dur) || 0) * 10) / 10,
    })),
    usedImages: imgN, brief: String(brief || '').slice(0, 400),
    voice: vd.voice, voiceName, theme: vd.theme, cost,
    // ★VF_AIVIDEO_V1（2026-09-20）：把画面来源透给卡片 —— 前端可据此显示"这条是 AI 出片"
    source: _isAI ? 'ai' : '',
    aspect, aspectName,
    coverage: cover, estSec, targetSec,
    // ★VF_AIVIDEO_V1：AI 模式下措辞要变 —— 画幅不是"按素材定"（画面是 AI 生成的），
    //   并明确写出"画面由 AI 逐镜生成"，避免用户以为用的是自己的图。
    hint: `看完了你仓库里 ${imgN} 张图，排了 ${shots.length} 个镜头（覆盖文案 ${Math.round(cover * 100)}%·预计 ${estSec} 秒·${_isAI ? `${aspectName}·**画面由 AI 逐镜生成**` : (aspect === 'landscape' ? '按素材定为横屏' : '按素材定为竖屏')}·风格 ${themeName}·配音 ${voiceName}）——回复「确认」开始出片；也可说要改什么`,
  })
}

// ★VF_FLOW_V1：成片草稿持久化（仿发布 pub_draft —— 服务器重启 / 页面刷新不丢步骤）
// ★VF_DRAFT_ISOLATE_V1（2026-09-22，用户实测「AI制片/混合线走到一半就跳回前面」）：
//   原来读/写/清都用了 **子串匹配** `tags: { contains: 'vf_draft' }` ——
//   而 `vf_draft_ai` / `vf_draft_mix` **里面也含着** `vf_draft` 这几个字，于是：
//     ① 读：读到别线那一行（正文是"AI制片草稿:{...}"）→ 前缀对不上 → JSON 解析失败
//          （就是日志里那句 [草稿读取失败] Unexpected token 'A', "AI制片草稿:{...）
//     ② 写：可能把别线那一行**覆盖**掉（两条线互相踩）
//     ③ 清：deleteMany(contains) → **一句话把三条线的草稿全删了** ← 最要命的：
//          别线正在走的步骤被悄悄清空，用户感觉就是"这条线记不住、老跳回第一步"
//   现在一律【精确匹配】：本线标签 'vf_draft_base'（历史旧数据 'vf_draft' 照样命中并被迁移）。
const VF_TAGS_BASE: string[] = ['vf_draft_base', 'vf_draft']
/** 草稿正文历史上出现过串线（"AI制片草稿:{...}" 等）—— 统一只取 JSON 部分，避免解析失败 */
function vfJsonOf(raw: any): any {
  const t = String(raw || '')
  const i = t.indexOf('{')
  return JSON.parse(i >= 0 ? t.slice(i) : t)
}
async function saveVfDraft(userId: number | string, draft: any): Promise<void> {
  const content = '成片草稿:' + JSON.stringify(draft)
  try {
    const ex = await prisma.agentMemory.findFirst({ where: { userId: String(userId), tags: { in: VF_TAGS_BASE } }, orderBy: { updatedAt: 'desc' } })
    if (ex) await prisma.agentMemory.update({ where: { id: ex.id }, data: { content, tags: 'vf_draft_base' } })
    else await prisma.agentMemory.create({ data: { userId: String(userId), content, tags: 'vf_draft_base', salience: 0.5 } })
  } catch (e: any) { console.error('[成片状态机] 草稿保存失败:', e?.message || e); try { vfLog(userId, '[草稿保存失败] ' + String(e?.message || e).slice(0, 200)) } catch {} }
}
async function loadVfDraft(userId: number | string): Promise<any | null> {
  try {
    const dm = await prisma.agentMemory.findFirst({ where: { userId: String(userId), tags: { in: VF_TAGS_BASE } }, orderBy: { updatedAt: 'desc' } })
    if (dm?.content) {
      const _d = vfJsonOf(dm.content)
      // ★VF_RUN_EXPIRE_V1（2026-09-21）：带上草稿最后更新时间 —— 供「running 超时自动作废」判断。
      //   草稿存在 DB 里跨会话/跨天都活着；不判超时的话，一次残留的 running 会让用户永远做不了第二条。
      if (_d && typeof _d === 'object') _d.__savedAt = dm.updatedAt ? new Date(dm.updatedAt).getTime() : 0
      return _d
    }
  } catch (e: any) { try { vfLog(userId, '[草稿读取失败] ' + String(e?.message || e).slice(0, 200)) } catch {} }
  return null
}
async function clearVfDraft(userId: number | string): Promise<void> {
  // ★VF_DRAFT_ISOLATE_V1：只清本线（精确匹配）—— 绝不再波及 AI 制片 / 混合线的草稿
  try { await prisma.agentMemory.deleteMany({ where: { userId: String(userId), tags: { in: VF_TAGS_BASE } } }) } catch {}
}

// ═══════════════════════════════════════════════════════════════════════════
// ★STD_MODE_V1（2026-09-21，用户定案）：标准模式的两个工具函数
//   用户原话：「进去了任何一条，不管到 1.2.3.4.5 步，看到第一条（命令）就是重来」
//   → 所以命令一出现，**不允许任何旧流程存活**（发布线 + 三条成片线全部作废）。
//   这也是前几轮"上个草稿来蹭新命令"的根治手段：命令是显式路由键，草稿不再是裁判。
// ═══════════════════════════════════════════════════════════════════════════
async function stdClearAllDrafts(userId: number | string): Promise<void> {
  const uid = Number(userId) || 0
  try { PUBLISH_DRAFT.delete(uid) } catch { /* ignore */ }
  try { VIDEO_DRAFT.delete(uid) } catch { /* ignore */ }
  try { await prisma.agentMemory.deleteMany({ where: { userId: String(uid), tags: { contains: 'pub_draft' } } }) } catch { /* ignore */ }
  try { await clearVfDraft(uid) } catch { /* ignore */ }              // 素材线
  try { await clearVfAiDraft(prisma, uid) } catch { /* ignore */ }    // AI 制片线
  try { await clearVfMixDraft(prisma, uid) } catch { /* ignore */ }   // 混合线
}

/**
 * ★只读【查询类】例外（不参与流程，所以不违反"锁死"）：
 *   出片入队时草稿就被作废了（VF_RUN_CLOSE_V1），所以"任务在跑"这件事在草稿里看不出来 ——
 *   若把"视频做得怎么样了"也锁死，用户就没法查进度了。这里放行【查询进度】这一类只读问句。
 *   ⚠️ 这一条是**我主动加的**（用户原话是"发什么文字都回没有这个功能"）；要严格锁死就把这个正则清空。
 */
const STD_QUERY_RE = /视频做得怎么样了|做到哪了|进度|做完了吗|好了没|好了吗/

/** 有没有"进行中的流程"（发布 / 三条成片线任一有草稿）—— 决定"非命令"要不要锁死 */
async function stdHasAnyDraft(userId: number | string): Promise<boolean> {
  const uid = Number(userId) || 0
  if (PUBLISH_DRAFT.has(uid) || VIDEO_DRAFT.has(uid)) return true
  try { if (await hasAiDraft(prisma, uid)) return true } catch { /* ignore */ }
  try { if (await hasMixDraft(prisma, uid)) return true } catch { /* ignore */ }
  try { if ((await loadVfDraft(uid))?.step) return true } catch { /* ignore */ }
  return false
}

// ★统一入库规则（2026-09-18 用户要求：与发布/上传走同一套）：
//   生成物 → 个人仓库（OSS `storage/{userId}/日期序号.mp4`）→ 前端 `storage:mirror` 下载到本地仓库
//   返回 `/api/storage/file?name=...&persist=1`（与 agent/page.tsx 里既有 mirror 调用同形式）；失败回退原始 URL，不阻断出片
async function saveGeneratedVideoToRepo(userId: number | string, srcUrl: string): Promise<string> {
  try {
    const vr = await fetch(srcUrl, { signal: AbortSignal.timeout(180000) })
    if (!vr.ok) return srcUrl
    const buf = Buffer.from(await vr.arrayBuffer())
    const { saveToPersonalRepo } = await import('@/lib/personal-storage')
    const saved = await saveToPersonalRepo({ userId: String(userId), buffer: buf, ext: 'mp4', mime: 'video/mp4' })
    // ★2026-09-22（用户实测「播放 3~4 秒必卡一下」）：
    //   原来返回 `/api/storage/file?name=…`：该接口"播放"分支每次请求都**重新签一个 OSS URL 并 302**，
    //   而 302 响应既无缓存头也无 Accept-Ranges → Chromium 媒体元素每次续传都被打断 → 固定间隔卡顿。
    //   现在直接返回 **OSS 签名直链**（24h 有效，OSS 原生支持 Range/边下边播，不经服务器）。
    //   顺带修一个 bug：原 URL **没带 userId**，而该接口强制校验 userId → 播放会直接 400。
    try {
      const { signedUrl } = await import('@/lib/oss')
      return await signedUrl(`storage/${String(userId)}/${saved.name}`, 86400)
    } catch {
      return `/api/storage/file?userId=${encodeURIComponent(String(userId))}&name=${encodeURIComponent(saved.name)}&persist=1`
    }
  } catch (e: any) {
    console.error('[generate_video] 个人仓库入库失败（回退原始 URL）:', e?.message || e)
    return srcUrl
  }
}
import {
  generateText, generateImage, generateVideo, generateLongVideo, generateImageToVideo, queryVideoTask,
  ToolDefinition,
  agnesChat, dashscopeFunctionCall, dashscopeGenerateImageAsync, type AgentChatMessage,
} from '@/lib/ai-providers'
import { searchTrendsReal } from '@/lib/gemini'
import { getAuthFromHeaders } from '@/lib/api-auth'
import { spendTokens, checkTokens, TOKEN_COSTS } from '@/lib/token-wallet'
import { listObjects, signedUrl, getOSSClient, putObject } from '@/lib/oss'
import { createRecord, finalizeSuccessByTaskId, finalizeSuccess } from '@/lib/generation-record'
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { getSystemConfigs, checkFeatureAccess } from '@/lib/quota'
import { PrismaClient } from '@prisma/client'
import { createPublishTask, parsePublishTask } from '@/lib/agent/publish-task'
import { AGENT_TOOLS, TOOL_STEP_LABEL } from '@/lib/agent/tools'
import { buildSystemPrompt } from '@/lib/agent/prompts'
import {
  PLATFORM_NAME,
  PLATFORM_NAMES,
  PLATFORM_KEY,
} from '@/lib/agent/platforms'

// 已接入的发布平台（其余视为"未接入需求"收集）
// 2026-09-13: 改为从 platforms.ts 派生（原来手写只有 5 个、漏了微博）
const SUPPORTED_PLATFORMS: Record<string, string> = PLATFORM_NAME
// 用户可能提的、我们暂未接入的平台（识别为未接入需求）
const UNMET_PLATFORM_ALIAS: Record<string, string> = {
  tiktok: 'TikTok', tik: 'TikTok', '抖音国际版': 'TikTok',
  youtube: 'YouTube', '油管': 'YouTube',
  weibo: '微博', '微博': '微博',
  instagram: 'Instagram', ins: 'Instagram', ig: 'Instagram', '照片墙': 'Instagram',
  facebook: 'Facebook', fb: 'Facebook', '脸书': 'Facebook',
  twitter: 'X(Twitter)', x: 'X(Twitter)', '推特': 'X(Twitter)',
  threads: 'Threads', reddit: 'Reddit', pinterest: 'Pinterest',
  kwai: '快手国际版', '快手海外': '快手国际版',
  '淘宝': '淘宝', taobao: '淘宝', '京东': '京东', jd: '京东',
  '大众点评': '大众点评', '知乎': '知乎', zhihu: '知乎',
}

export const runtime = 'nodejs'
const prisma = new PrismaClient()

// 2026-09-09: 建浏览器任务——每账号独立编号 seq（该用户第 N 个从 1 起，跨账号不混）
async function buCreate(uid: number, task: string, filesStr: string, status = 'pending') {
  const last = await prisma.agentBrowserTask.findFirst({ where: { userId: uid }, orderBy: { seq: 'desc' }, select: { seq: true } }).catch(() => null)
  const seq = (last?.seq ?? 0) + 1
  return prisma.agentBrowserTask.create({ data: { userId: uid, task, files: filesStr, status, seq } })
}

// ==================== 工具定义 ====================

// 2026-08-21: 发布抽帧暂存（userId → 帧列表，"用第N帧"取用）
const frameStore = new Map<number, { frames: { idx: number; url: string }[]; videoName: string; orientation?: 'landscape' | 'portrait' }>()
// 2026-08-29: 生图异步化——提交后立即返回，后台轮询+转存（避免长请求被网络层掐断"网络连接失败"）
// 2026-09-06: pendingImages 抽到 globalThis——image-task-status API 跨模块读结果（生图轮询闭环）
const pendingImages: Map<number, { taskId: string; ts: number; url?: string; fileName?: string; done: boolean }> =
  (globalThis as any).__pendingImages || ((globalThis as any).__pendingImages = new Map())


async function executeToolCall(name: string, args: Record<string, any>, auth: any): Promise<string> {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || ''

  switch (name) {
    // ── 文案 ──
    case 'generate_copy': {
      const product = args.product || '产品'
      const platform = args.platform || '多平台'
      const style = args.style || '专业'
      const p = `为"${product}"生成${platform}营销文案，风格${style}。吸引眼球有卖点。输出3条，用【文案1】【文案2】【文案3】标记。`
      const copyRaw = (await generateText(p)) || ''
      if (copyRaw && copyRaw !== '文案生成暂不可用') {
        try {
          const uidC = auth?.userId
          if (uidC) {
            const cKey = 'storage/' + uidC + '/copy_' + Date.now() + '.txt'
            await putObject(cKey, Buffer.from(copyRaw, 'utf8'), 'text/plain')
            console.log('[generate_copy] 文案已转存:', cKey)
            return copyRaw + String.fromCharCode(10, 10) + '[OK] 已存入个人仓库: copy_' + cKey.split('_').pop()
          }
        } catch (eCp) { console.error('[generate_copy] 转存失败:', eCp?.message || eCp) }
      }
      return copyRaw || '文案生成暂不可用'
    }

    // ── 图片（#2 2026-08-12: 工具前移扣费——执行前 check，成功后 spend）──
    case 'generate_image': {
      const uid = auth?.userId
      if (!uid) return 'TOOL_REJECT:未登录'
      // 2026-08-29: featureCode 对齐——周卡/套餐 paidFeatures 写入 'image-generator'（之前查 'generate_image' 永远不匹配→'需要充值'）
      const gChk = await checkFeatureAccess(uid, 'image-generator')
      if (!gChk.allowed) return `TOOL_REJECT:${gChk.message}`
      const gCost = 12
      // 2026-08-29: 异步化——提交即返回（长轮询被网络层掐→"网络连接失败"）；后台轮询+转存
      const sub = await dashscopeGenerateImageAsync(String(args.prompt || 'AI生成图片'), String(args.size || '1280*1280').replace(/\*/g, 'x'))
      if (!sub?.taskId) return '图片生成失败（提交被拒）——请稍后重试'
      pendingImages.set(uid, { taskId: sub.taskId, ts: Date.now(), done: false })
      // 后台轮询（不阻塞 chat）——完成转存 OSS + 入仓库
      ;(async () => {
        try {
          const deadline = Date.now() + 240000
          while (Date.now() < deadline) {
            await new Promise((r2) => setTimeout(r2, 5000))
            const q = await fetch('https://dashscope.aliyuncs.com/api/v1/tasks/' + sub.taskId, { headers: { 'Authorization': 'Bearer ' + process.env.DASHSCOPE_API_KEY } }).then((r3) => r3.json()).catch(() => null)
            const img = q?.output?.choices?.[0]?.message?.content?.[0]?.image
            const st = q?.output?.task_status || q?.task_status
            if (img) {
              const imgBuf = Buffer.from(await (await fetch(img, { signal: AbortSignal.timeout(60000) })).arrayBuffer())
              const imgKey = 'storage/' + uid + '/ai_' + Date.now() + '.png'
              await putObject(imgKey, imgBuf, 'image/png')
              const url = await signedUrl(imgKey, 86400)
              await prisma.mediaAsset.create({ data: { title: String(args.prompt || 'AI生成图片').slice(0, 30), ossUrl: url, type: 'image', prompt: String(args.prompt || '').slice(0, 200), category: 'AI生成', source: 'private', ownerId: uid, orientation: 'landscape' } }).catch(() => {})
              pendingImages.set(uid, { taskId: sub.taskId, ts: Date.now(), url, fileName: imgKey.replace('storage/' + uid + '/', ''), done: true })
              console.log('[生图异步] 完成转存:', imgKey)
              break
            }
            if (st === 'FAILED' || st === 'UNKNOWN') { pendingImages.set(uid, { taskId: sub.taskId, ts: Date.now(), done: true }); break }
          }
        } catch (eBk) { console.error('[生图异步] 后台轮询异常:', eBk?.message || eBk) }
      })()
            return 'IMAGE_PENDING:' + sub.taskId + '|封面生成中（约1-3分钟）——生成后自动出现'
    }

    // ── 视频 ──
    case 'generate_video': {
      const gvDuration = parseInt(args.duration) || 5
      const gvPrompt = args.prompt || '产品展示'
      const gvRatio = args.ratio || '16:9'
      // ★H3_RELAY_V1：标记是否走 H3（只用于生成记录的 provider，**不参与计费**）
      //   计费按用户 2026-09-18 指示【暂时不动，后面统一设计】→ 仍按 100 点/秒预估
      const gvIsH3 = args.model === 'h3-768p' || args.model === 'h3-2k'
      const gvCost = Math.ceil(gvDuration * 100) // 100 点/秒
      // A2 成本确认：未确认只报预估
      if (!args.confirmed) {
        return `VIDEO_COST_ESTIMATE:时长${gvDuration}秒 × 100点/秒 = ${gvCost}点（约¥${(gvCost / 100).toFixed(1)}）。请先向用户明确报价并等确认（用户说"确认/生成吧/可以"等即视为确认），确认后再次调用本工具并带 confirmed=true 才开始生成。${gvDuration > 15 ? '（超过15秒将自动分段拼接，每段用上一段尾帧做参考保证衔接，费用按总时长计）' : ''}`
      }
      // A1: >15s 走长视频拼接（首尾帧接力）
      // #2 扣费：执行前 check（confirmed 后才真正生成）
      const uid2 = auth?.userId
      if (!uid2) return 'TOOL_REJECT:未登录'
      const gvChk = await checkTokens(uid2, gvCost)
      if (!gvChk.allowed) return `TOOL_REJECT:${gvChk.message}`
      if (gvDuration > 15) {
        const segModel = args.segModel === 'wan2.7-t2v' ? 'wan2.7-t2v' : undefined // 缺省用引擎默认
        const lv = await generateLongVideo([gvPrompt], gvDuration, '720P', gvRatio, undefined, 5, segModel)
        if (lv?.videoUrl) { await spendTokens(uid2, gvCost, 'agent_generate_video'); const u = await saveGeneratedVideoToRepo(uid2, lv.videoUrl); return `VIDEO_RESULT:${u}|DURATION:${gvDuration}s|COST:${gvCost}点` }
        return '长视频生成失败（分段模型可能不可用，可重试或换 wan2.7-t2v）'
      }
      if (args.refImage) {
        const i2vR = await generateImageToVideo(gvPrompt, String(args.refImage), gvDuration, '720P', gvRatio)
        if (i2vR?.taskId && i2vR.status === 'running') {
          try { await createRecord({ userId: uid2, type: 'image2video', provider: 'dashscope', prompt: gvPrompt, costPoints: gvCost, platformTaskId: String(i2vR.taskId) }) } catch {}
          return `VIDEO_TASK:${i2vR.taskId}|PROMPT:${gvPrompt}|COST:${gvCost}点（成片完成后扣费）`
        }
        return '图生视频生成暂不可用（参考图处理失败，可重试）'
      }
      // ★H3_RELAY_V1：带上 model（h3-768p / h3-2k → 走 H3 中转优先；缺省=百炼 wan2.7）
      const result = await generateVideo(gvPrompt, gvDuration, '720P', gvRatio, args.model ? String(args.model) : undefined)
      if (result?.taskId && result.status === 'running') {
        // 2026-08-24: 生成即落库（可追踪/断网可恢复）
        // 2026-08-26 B方案：提交不扣——成片成功（query_video_task 查到成功）才扣
        try { await createRecord({ userId: uid2, type: 'text2video', provider: gvIsH3 ? 'minimax' : 'dashscope', prompt: gvPrompt, costPoints: gvCost, platformTaskId: String(result.taskId) }) } catch {}
        return `VIDEO_TASK:${result.taskId}|PROMPT:${gvPrompt}|COST:${gvCost}点（成片完成后扣费）`
      }
      if (result?.videoUrl) {
        await spendTokens(uid2, gvCost, 'agent_generate_video')
        // ★统一入库：先落个人仓库（H3 的视频在中转站域名上，必须转存），再交给前端 mirror 到本地
        const u = await saveGeneratedVideoToRepo(uid2, result.videoUrl)
        return `VIDEO_RESULT:${u}|COST:${gvCost}点`
      }
      return '视频生成暂不可用'
    }

    // ── 本地成片（★VF_AGENT_V1）：文案 → 分镜 → 配音 → FFmpeg 渲染（全本地）──
    //   与 create_ai_video 的区别：那个走 AI 逐镜生成画面（贵、慢）；
    //   这个走【本地渲染】（tts.py + render.py），快、便宜、画面是模板化卡片/图文。
    case 'make_ai_video': {
      const vfScript = String(args.script || args.topic || '').trim()
      // ★VF_PLAN_V1：允许 AI 直接给分镜（plan），比"按标点自动切句"好得多
      const vfPlan = args.plan ? (typeof args.plan === 'string' ? args.plan : JSON.stringify(args.plan)) : ''
      if (!vfScript && !vfPlan) return 'TOOL_REJECT:缺少 script（文案/主题）或 plan（分镜 JSON）'
      const vfTheme = String(args.theme || 'dark')
      // ★VF_COSTFIX_V1（2026-09-20 端到端推演发现）：计费**不能用 plan 的 JSON 长度**（它比文案长一个量级）——
      //   调用处走 plan 时**不传 script** → vfScript 为空 → 原来用 vfPlan.length 算价 →
      //   36 镜的 JSON 约 5.4KB → 约 270 点，而卡片报价只有 41 点 → **实扣多出好几倍**。
      //   现在：有 script 就用 script；只有 plan 时按【分镜 subtitle 总字数】估算 —— 与卡片报价同口径。
      let vfBillChars = vfScript.length
      if (!vfBillChars && vfPlan) {
        try {
          const _p = JSON.parse(vfPlan)
          const _sh = Array.isArray(_p) ? _p : (_p && _p.shots) || []
          vfBillChars = (Array.isArray(_sh) ? _sh : []).reduce(
            (a: number, s: any) => a + String((s && (s.subtitle || s.text)) || '').length, 0)
        } catch { vfBillChars = 0 }
      }
      // ★VF_AIVIDEO_V1（2026-09-20）：「全部 AI 生成」判定 —— 工具参数（AI 主动传）或表单草稿
      //   （用户在表单里选的）任一为 ai 即算。
      //   ★2026-09-21 修（用户在客户端实测「点确认出片 → 回『发布流程未开始』」）：
      //     这里我原来写的是 `VIDEO_DRAFT.get(uid)`，而本函数签名是 executeToolCall(name, args, auth)
      //     —— **根本没有 uid**（同段落用的是 uidVF）；uid 的 const 定义都在别的 case 块（如 L425）。
      //     → 这一行抛异常 → 被外层 catch 吞掉 → 成片块没能覆盖发布状态机的兜底文案
      //       （"发布流程未开始——请说「帮我发一个视频」开始任务。"）→ 出片直接中断。
      //     改用 auth?.userId || 0，**与成片块写草稿时用的 key（uidVF2 = auth?.userId || 0）完全一致**。
      const _vdCur: any = VIDEO_DRAFT.get(auth?.userId || 0) || {}
      // ★A1（2026-09-22，用户实测「卡片报 205 点、实扣 1500 点」）：
      //   混合线传的是 `source:'ai'` + `mix:'1,5'`；一旦 `mix` 为空（AI 一镜都没标），这里就把它
      //   当成「AI 制片」→ 按【整片时长 × 50】扣费（30 秒 = 1500 点），而卡片是按"AI 镜秒数"报价的
      //   （205 点）→ 报价与实扣差 1295 点。
      //   修法：把 'mix' 当**独立口径** —— mix 镜号有 → 只算这些镜的秒数；mix 镜号为空 →
      //         **只收素材部分，绝不按整片时长收 AI 费**。
      const _srcRaw = String(args.source || args.mode || _vdCur.source || '')
      const _mixIdx = String(args.mix || '').split(',').map((x) => parseInt(String(x).trim())).filter((n) => n > 0)
      const _isMixLine = _srcRaw === 'mix' || _mixIdx.length > 0
      const vfSrcAI = _srcRaw === 'ai' || _srcRaw === 'mix' || _mixIdx.length > 0
      // ★VF_AIVIDEO_V1：**计费口径分三种** ——
      //   素材合成：按文案字数（ceil(字数/20)），30 秒片约 7 点；
      //   全部 AI 生成（AI 制片）：按【秒 × 50 点】（768P；2K 为 80），30 秒片约 1500 点；
      //   ★素材+AI 创作（混合）：**只算"被 AI 生成的那些镜"的秒数**（+ 素材部分按字数），
      //     不能按"全片时长 × 50" —— 否则只 2 镜 AI 却扣全片的钱（又是"多扣费"）。
      //   （上次"多扣费数倍"的教训：报价与实扣必须同口径。）
      let _mixAiSec = 0
      if (_isMixLine && _mixIdx.length) {
        try {
          const _pp = JSON.parse(vfPlan || '{}')
          const _sh = Array.isArray(_pp) ? _pp : (_pp && _pp.shots) || []
          _sh.forEach((s: any, i: number) => { if (_mixIdx.includes(i + 1)) _mixAiSec += Number((s && s.dur) || 0) })
          if (!_mixAiSec) {
            const _full = Math.max(4, Number(args.duration || args.dur || _vdCur.dur || 30) || 30)
            _mixAiSec = Math.round(_full * (_mixIdx.length / Math.max(1, _sh.length)))
          }
        } catch { _mixAiSec = 0 }
      }
      const vfCost = _isMixLine
        ? (_mixIdx.length
          ? Math.max(1, Math.ceil(_mixAiSec * 50) + Math.ceil(vfBillChars / 20))
          : Math.max(1, Math.ceil(vfBillChars / 20)))   // ← 没有 AI 镜：只收素材部分（不再按整片 ×50）
        : (vfSrcAI
          ? Math.max(1, Math.ceil(Math.max(4, Number(args.duration || args.dur || _vdCur.dur || 30) || 30) * 50))
          : Math.max(1, Math.ceil(vfBillChars / 20)))
      if (!args.confirmed) {
        const what = _isMixLine
          ? `素材 + AI 创作（只对第 ${_mixIdx.join('、') || '（无）'} 镜调 AI 生成画面，共约 ${Math.round(_mixAiSec)} 秒）`
          : (vfSrcAI
            ? `全部 AI 生成（MiniMax H3 逐镜生成画面，约 ${Math.max(4, Number(args.duration || args.dur || _vdCur.dur || 30) || 30)} 秒）`
            : (vfPlan ? 'AI 分镜' : `文案 ${vfScript.length} 字`))
        const _aiNote = _isMixLine
          ? (vfCost > 0 && _mixIdx.length
            ? ' ⚠️ 只对上面这几镜按【秒 × 50 点】计费（其余镜用你的素材，不额外收费）—— 请确认。'
            : ' ⚠️ 这次没有任何镜要 AI 生成 → 只收素材合成费。')
          : (vfSrcAI
            ? ' ⚠️ 这条是【AI 逐镜生成画面】（约 50 点/秒），比素材合成贵两个数量级 —— 请务必先确认。'
            : '')
        return `MAKE_VIDEO_COST:${what} → 本地配音+成片约 ${vfCost} 点（约¥${(vfCost / 100).toFixed(1)}）。${_aiNote}请向用户报价并等确认（用户说"确认/生成吧/可以"即确认），确认后带 confirmed=true 开始生成。`
      }
      const uidVF = auth?.userId
      if (!uidVF) return 'TOOL_REJECT:未登录'
      const vfChk = await checkTokens(uidVF, vfCost)
      if (!vfChk.allowed) return `TOOL_REJECT:${vfChk.message}`
      const { spawn } = await import('child_process')
      const pathVF = await import('path')
      const fsVF = await import('fs')
      // ★VF_ROOT_V1（2026-09-19）：pm2 跑的是 next standalone（cwd = .next/standalone），
      //   写死 process.cwd() 会找不到脚本 → 用 vfRootDir() 多候选向上找。
      const rootVF = vfRootDir()
      if (!rootVF) return 'TOOL_REJECT:未找到本地成片脚本 scripts/video-factory/make.py（已试 VF_ROOT / cwd / 上级 / /root/AiMarketing）'
      const mkPy = pathVF.join(rootVF, 'scripts', 'video-factory', 'make.py')
      const outDir = pathVF.join(vfStorageRoot(), String(uidVF), 'video-factory')
      fsVF.mkdirSync(outDir, { recursive: true })
      const vfOut = pathVF.join(outDir, `vf_${Date.now()}.mp4`)
      // ★VF_LINUX_V1（2026-09-18）：解释器名跨平台 —— Linux 服务器通常只有 python3，
      //   原来默认 'python' → spawn ENOENT → 成片直接失败。服务器可显式设 BU_PYTHON。
      const py = process.env.BU_PYTHON || (process.platform === 'win32' ? 'python' : 'python3')
      // ★2026-09-19：workdir 按任务独立（原来所有任务共用 work/ → 并发会互相覆盖，
      //   也导致事后无法回溯"这次到底怎么排的镜"；独立后可直接读该任务的 storyboard.voiced.json）
      const vfWorkDir = pathVF.join(outDir, 'work_' + Date.now())
      const vfSpeaker = String(args.speaker || args.voice || '')
      const argsVF = vfPlan
        ? [mkPy, '--plan', vfPlan, '--theme', vfTheme, '--out', vfOut, '--workdir', vfWorkDir, '--speaker', vfSpeaker]
        : [mkPy, '--script', vfScript, '--theme', vfTheme, '--out', vfOut, '--workdir', vfWorkDir, '--speaker', vfSpeaker]
      // ★VF_AIVIDEO_V1（2026-09-20）：「全部 AI 生成」→ 让 make.py 在【配音之后、渲染之前】
      //   逐镜调 MiniMax H3 生成画面（768P=50点/秒）。单镜失败 make.py 会自动回退成素材图，不整片挂。
      // ★A1（2026-09-22）：混合线必须传 `--source mix`（不是 'ai'）—— make.py 里
      //   `source==='ai'` 表示"**全部**镜由 H3 生成"，`source==='mix'` 才会按 `--mix 镜号` 只生成那几镜。
      //   原来一律传 'ai' → 混合线被当成 AI 制片（全镜 AI + 整片计费）。
      if (vfSrcAI) argsVF.push('--source', _isMixLine ? 'mix' : 'ai', '--ai-resolution', '768P')
      // ★VF_MIXLINE_V1（2026-09-21）：「素材+AI 创作」只对**指定镜号**调 AI —— 必须把镜号透给 make.py。
      //   ⚠️ 漏了这行的后果：混合片会退化成"全片每一镜都调 H3"（用户以为只 2 镜 ≈600 点，
      //   实际全片 ≈1500+ 点）→ 成本失控。所以这里**有就必传**。
      const _mixShots = String(args.mix || '').trim()
      if (_mixShots) argsVF.push('--mix', _mixShots)
      // ★VF_BGM_V1（2026-09-20）：BGM —— args.bgm==='auto' 时从【AI 音乐库】挑一首
      //   并下载到本地（render.py 要的是本地文件）。直接查库不调 HTTP（避开服务端鉴权）
      // ★VF_STYLE_V1（2026-09-21）：用户定案「配乐牵扯版权，让 AI 自己配，**能留个音乐类型就行**」
      //   → 若带了 musicType（由成片风格推出来，如"史诗感/弦乐""轻快电子"），**优先按它挑**；
      //     库里没有匹配的 → 回退"最新一首"（行为与以前一致）。
      if (String(args.bgm || '') === 'auto') {
        try {
          const _mt = String(args.musicType || '').trim()
          let _m: any = null
          if (_mt) {
            _m = await prisma.mediaAsset.findFirst({
              where: { source: 'public', type: 'audio', category: 'music', OR: [{ title: { contains: _mt } }, { prompt: { contains: _mt } }] },
              orderBy: { createdAt: 'desc' },
            })
            if (_m) vfLog(String(uidVF), `[BGM] 按音乐类型「${_mt}」命中：${String(_m.title || '').slice(0, 20)}`)
            else vfLog(String(uidVF), `[BGM] 音乐类型「${_mt}」库里没有 → 回退最新一首`)
          }
          if (!_m) _m = await prisma.mediaAsset.findFirst({ where: { source: 'public', type: 'audio', category: 'music' }, orderBy: { createdAt: 'desc' } })
          if (_m?.ossUrl) {
            const _rb = await fetch(String(_m.ossUrl), { signal: AbortSignal.timeout(30000) })
            if (_rb.ok) {
              const _bp = pathVF.join(outDir, 'bgm_' + Date.now() + '.mp3')
              fsVF.writeFileSync(_bp, Buffer.from(await _rb.arrayBuffer()))
              argsVF.push('--bgm', _bp)
              vfLog(String(uidVF), `[BGM] 已下载音乐库曲目 -> ${pathVF.basename(_bp)}`)
            }
          } else {
            vfLog(String(uidVF), '[BGM] 音乐库没公开曲目，跳过')
          }
        } catch (eB: any) { console.error('[成片] BGM 准备失败:', eB?.message || eB); vfLog(String(uidVF), '[BGM] 失败: ' + String(eB?.message || eB).slice(0, 100)) }
      }
      // ★VF_ASYNC_V1（2026-09-18）：改成【后台任务】——不再同步等 8 分钟。
      //   长片（3 分钟以上）同步等会超时/卡住对话；改后台跑 + 落任务文件，用户可随时问进度。
      const vfTaskId = 'vf' + Date.now()
      const vfTaskFile = pathVF.join(outDir, vfTaskId + '.json')
      const vfStarted = new Date().toISOString()
      const writeVfTask = (o: Record<string, any>) => {
        try { fsVF.writeFileSync(vfTaskFile, JSON.stringify(o, null, 2)) } catch (e) {}
      }
      writeVfTask({ id: vfTaskId, status: 'running', startedAt: vfStarted,
                    out: vfOut, cost: vfCost, script: String(vfScript || '').slice(0, 200) })
      try {
        const ch = spawn(py, argsVF, { windowsHide: true })
        let so = ''
        const push = (d: any) => { so = (so + String(d)).slice(-20000) }
        ch.stdout.on('data', push)
        ch.stderr.on('data', push)
        ch.on('close', async (code: number | null) => {
          const okDone = code === 0 && fsVF.existsSync(vfOut)
          // ★VF_REPO_V1（2026-09-18）：成片转 OSS + 入个人仓库。
          //   原来只把服务器本地路径写进任务文件 → 用户在客户端根本拿不到文件。
          let repoExtra: Record<string, any> = {}
          if (okDone) {
            try {
              const { readFile } = await import('fs/promises')
              const { saveToPersonalRepo } = await import('@/lib/personal-storage')
              const { signedUrl } = await import('@/lib/oss')
              const buf = await readFile(vfOut)
              const { name } = await saveToPersonalRepo({
                userId: String(uidVF), buffer: buf, ext: 'mp4', mime: 'video/mp4',
              })
              repoExtra = { repoName: name, url: await signedUrl(`storage/${uidVF}/${name}`, 86400) }
            } catch (e: any) {
              repoExtra = { repoError: String(e?.message || e).slice(0, 200) }
            }
          }
          writeVfTask({ id: vfTaskId, status: okDone ? 'done' : 'failed',
                        startedAt: vfStarted, finishedAt: new Date().toISOString(),
                        out: vfOut, cost: vfCost, code: code,
                        tail: so.split('\n').filter(Boolean).slice(-40),
                        ...repoExtra })
          if (okDone) { spendTokens(uidVF, vfCost, 'make_ai_video').catch(() => {}) }
        })
        ch.on('error', (e: any) => {
          writeVfTask({ id: vfTaskId, status: 'failed', startedAt: vfStarted,
                        finishedAt: new Date().toISOString(), error: String(e).slice(0, 300) })
        })
      } catch (e: any) {
        writeVfTask({ id: vfTaskId, status: 'failed', startedAt: vfStarted,
                      finishedAt: new Date().toISOString(), error: String(e).slice(0, 300) })
        return 'MAKE_VIDEO_FAIL:后台启动失败 ' + String(e).slice(0, 120)
      }
      return `MAKE_VIDEO_TASK:${vfTaskId} 本地成片已在后台开始（配音 + 字幕 + 画面）。过程中可随时问我"视频做得怎么样了"查看进度。`
    }

    // ── 查询本地成片任务进度（★VF_ASYNC_V1 配套）──
    case 'query_make_video': {
      const uidQ = auth?.userId
      if (!uidQ) return 'TOOL_REJECT:未登录'
      const pathQ = await import('path')
      const fsQ = await import('fs')
      const outDirQ = pathQ.join(vfStorageRoot(), String(uidQ), 'video-factory')
      const wantId = String(args.taskId || '').trim()
      try {
        let files: string[] = fsQ.existsSync(outDirQ)
          ? (fsQ.readdirSync(outDirQ) as string[]).filter((f) => /^vf\d+\.json$/.test(f)).sort().reverse()
          : []
        if (wantId) files = files.filter((f) => f.indexOf(wantId) >= 0)
        if (!files.length) return 'MAKE_VIDEO_PROGRESS:没有找到本地成片任务（可让我"帮我做一条视频"开始）'
        const t = JSON.parse(fsQ.readFileSync(pathQ.join(outDirQ, files[0]), 'utf8'))
        const icon = t.status === 'done' ? '✅ 已完成' : (t.status === 'failed' ? '❌ 失败' : '⏳ 进行中')
        const dur = t.startedAt ? Math.round((Date.now() - new Date(t.startedAt).getTime()) / 1000) : 0
        let msg = `MAKE_VIDEO_PROGRESS:任务 ${t.id} ${icon}（已跑 ${dur}s）`
        if (t.status === 'done') {
          msg += `\n成片文件：${t.repoName || t.out}`
          if (t.url) msg += `\n个人仓库下载链接（24h 有效）：${t.url}`
          if (t.repoError) msg += `\n（入库失败：${t.repoError}）`
        }
        if (t.status === 'failed') msg += `\n失败原因/日志尾部：\n${t.error || (t.tail || []).join('\n')}`
        if (t.status === 'running') msg += `\n（还在渲染，稍后再问我一次）`
        return msg
      } catch (e: any) {
        return 'MAKE_VIDEO_PROGRESS:查询失败 ' + String(e).slice(0, 120)
      }
    }

    // ── 分镜协议（A3）──
    case 'generate_storyboard': {
      const sbDuration = Math.min(180, parseInt(args.duration) || 30)
      const sbRatio = args.ratio || '16:9'
      const sbShots = Math.max(2, Math.ceil(sbDuration / 5))
      const sbCost = Math.ceil(sbDuration * 100)
      const sbPrompt = `你是短视频分镜导演。根据主题「${args.topic || ''}」生成 ${sbShots} 个镜头的分镜脚本（总时长约${sbDuration}秒，每镜约5秒，${sbRatio}画面）。只输出 JSON 数组（不要任何其它文字或代码块标记），每镜对象：{shot:序号, desc:"中文画面描述", prompt:"英文视频生成提示词，含主体/动作/场景/光影/运镜，80词内", duration:5, camera:"镜头感（如推近/航拍/慢动作）"}。风格要求：${args.style || '通用写实'}。`
      const sbRaw = await generateText(sbPrompt)
      if (!sbRaw) return '分镜生成失败，请稍后重试'
      const m = sbRaw.match(/\[[\s\S]*\]/)
      if (!m) return '分镜格式异常，请重试'
      return `STORYBOARD:${m[0]}|TOTAL:${sbDuration}秒|SHOTS:${sbShots}|COST:${sbCost}点（约¥${(sbCost / 100).toFixed(1)}）。分镜仅供确认：请向用户展示并确认费用，确认后调用 create_storyboard_task 创建任务（后台逐镜生成）。`
    }

    // ── 一句话成片（二期B）──
    case 'create_ai_video': {
      const avDuration = Math.min(180, parseInt(args.duration) || 30)
      const avRatio = args.ratio || '16:9'
      const avCost = Math.ceil(avDuration * 100)
      if (!args.confirmed) {
        return `AI_VIDEO_COST:时长${avDuration}秒 × 100点/秒 = ${avCost}点（约¥${(avCost / 100).toFixed(1)}）。请向用户报价并等确认（用户说"确认/生成吧/可以"即确认），确认后带 confirmed=true 自动分镜并创建任务。`
      }
      // #2 扣费：confirmed 后执行前 check，建任务成功后 spend
      const uid3 = auth?.userId
      if (!uid3) return 'TOOL_REJECT:未登录'
      const avChk = await checkTokens(uid3, avCost)
      if (!avChk.allowed) return `TOOL_REJECT:${avChk.message}`
      // 2026-08-26 B方案：提交不扣——成片成功（query_storyboard 查到 videoUrl）才扣
      // 分镜：调 LLM 出分镜 JSON
      const avShots = Math.max(2, Math.ceil(avDuration / 5))
      const avPrompt = `你是短视频分镜导演。根据主题「${args.topic || ''}」生成 ${avShots} 个镜头的分镜脚本（总时长约${avDuration}秒，每镜约5秒，${avRatio}画面）。只输出 JSON 数组（不要任何其它文字或代码块标记），每镜对象：{shot:序号, desc:"中文画面描述", prompt:"英文视频生成提示词，含主体/动作/场景/光影/运镜，80词内", duration:5, camera:"镜头感"}。风格：${args.style || '通用写实'}。`
      const avRaw = await generateText(avPrompt)
      const avMatch = avRaw ? avRaw.match(/\[[\s\S]*\]/) : null
      if (!avMatch) return '自动分镜失败，请用 generate_storyboard 手动分镜或重试'
      let avShotsArr = []
      try { avShotsArr = JSON.parse(avMatch[0]) } catch { return '分镜 JSON 解析失败' }
      if (!Array.isArray(avShotsArr) || avShotsArr.length === 0) return '分镜为空'
      // 建任务
      const { PrismaClient } = await import('@prisma/client')
      const p4 = new PrismaClient()
      const normalized = avShotsArr.map((s: any, i: number) => ({
        shot: s.shot ?? (i + 1), desc: s.desc || '', prompt: s.prompt || '', duration: Math.min(5, Math.max(2, parseInt(s.duration) || 5)),
        camera: s.camera || '', status: 'pending', videoUrl: null, error: null,
      }))
      const task = await p4.storyboardTask.create({
        data: { userId: auth?.userId || 0, title: (args.topic || '').substring(0, 80), topic: args.topic || '',
          ratio: avRatio, style: args.style || null, duration: avDuration, shots: JSON.stringify(normalized),
          status: 'pending', totalShots: normalized.length, costPoints: avCost },
      })
      // 2026-08-26 B：不再提交扣（query_storyboard 完成扣）
      const mod = await import('../storyboard/route')
      mod.runShots(task.id, normalized, avRatio).catch(e => console.error('[Storyboard]', e))
      return `AI_VIDEO_TASK:${task.id}|SHOTS:${normalized.length}|COST:${avCost}点（约¥${(avCost / 100).toFixed(1)}）。已自动分镜并开始后台生成，约每镜1-3分钟，可随时问我进度。`
    }

    // ── 分镜任务（A4）──
    case 'create_storyboard_task': {
      const { PrismaClient } = await import('@prisma/client')
      const p2 = new PrismaClient()
      const sbShots = Array.isArray(args.shots) ? args.shots : []
      if (sbShots.length === 0) return '缺少分镜数组'
      const ratio = args.ratio || '16:9'
      const duration = parseInt(args.duration) || sbShots.reduce((s: number, x: any) => s + (parseInt(x.duration) || 5), 0)
      const costPoints = Math.ceil(duration * 100)
      const normalized = sbShots.map((s: any, i: number) => ({
        shot: s.shot ?? (i + 1), desc: s.desc || '', prompt: s.prompt || '', duration: Math.min(5, Math.max(2, parseInt(s.duration) || 5)),
        camera: s.camera || '', status: 'pending', videoUrl: null, error: null,
      }))
      // #2 扣费：创建前 check，成功后 spend
      const uid4 = auth?.userId
      if (!uid4) return 'TOOL_REJECT:未登录'
      const sbChk = await checkTokens(uid4, costPoints)
      if (!sbChk.allowed) return `TOOL_REJECT:${sbChk.message}`
      const task = await p2.storyboardTask.create({
        data: { userId: auth?.userId || 0, title: (args.topic || '').substring(0, 80), topic: args.topic || '',
          ratio, style: args.style || null, duration, shots: JSON.stringify(normalized), status: 'pending',
          totalShots: normalized.length, costPoints },
      })
      await spendTokens(uid4, costPoints, 'agent_storyboard')
      const mod = await import('../storyboard/route')
      mod.runShots(task.id, normalized, ratio).catch(e => console.error('[Storyboard]', e))
      return `STORYBOARD_TASK:${task.id}|SHOTS:${normalized.length}|COST:${costPoints}点（约¥${(costPoints / 100).toFixed(1)}）。已开始后台逐镜生成，请告知用户任务已创建、约每镜1-3分钟，可随时问进度。`
    }
    case 'query_storyboard': {
      const { PrismaClient } = await import('@prisma/client')
      const p3 = new PrismaClient()
      const tid = parseInt(args.id || '0')
      if (!tid) return '缺少任务ID'
      const task = await p3.storyboardTask.findFirst({ where: { id: tid, userId: auth?.userId || 0 } })
      if (!task) return '任务不存在'
      const shots = JSON.parse(task.shots || '[]')
      const progress = shots.map((s: any) => `${s.shot}镜:${s.status === 'done' ? '✅' : s.status === 'failed' ? '❌' : '⏳'}${s.error ? '(' + s.error + ')' : ''}`).join(' ')
      const base = `分镜任务#${task.id} 状态:${task.status} 完成:${task.doneShots}/${task.totalShots} ${progress}`
      // 2026-08-26 B方案：成片出现才扣费（收到成片后扣）；costPoints 扣完置 0 防重复
      if (task.videoUrl && task.costPoints > 0) {
        try { await spendTokens(task.userId, task.costPoints, 'agent_video_complete'); await p3.storyboardTask.update({ where: { id: tid }, data: { costPoints: 0 } }) } catch (e6) { console.error('[charge] 成片扣费失败:', e6) }
      }
      return task.videoUrl ? `${base} 成品:${task.videoUrl}` : `${base}（未完成/无成品，可稍后问我或重试失败镜）`
    }

    // ── 网络搜图 ──
    case 'search_web_images': {
      try {
        const res = await fetch(`${baseUrl}/api/search-images?keyword=${encodeURIComponent(args.keyword)}&limit=${args.count || 3}`)
        const data = await res.json()
        if (data.success && data.data?.length) {
          return `IMAGE_LIST:${JSON.stringify(data.data.slice(0, args.count || 4).map((i: any) => ({ url: i.url, title: i.title || '' })))}`
        }
        return '未找到相关图片，换个关键词试试？'
      } catch { return '网络搜图暂不可用' }
    }

    case 'search_web': {
      try {
        const sk = process.env.SERPER_API_KEY
        if (!sk) return '未配置搜索服务（SERPER_API_KEY），请管理员在后台设置后重试'
        const q = String(args.query || '').slice(0, 200)
        const type = args.type === 'videos' || args.type === 'news' ? args.type : 'web'
        const hasCJK = /[一-鿿]/.test(q)
        const body: Record<string, any> = { q, num: 5, hl: hasCJK ? 'zh-cn' : 'en', gl: hasCJK ? 'cn' : 'us' }
        if (type !== 'web') body.type = type
        const res = await fetch('https://google.serper.dev/search', {
          method: 'POST',
          headers: { 'X-API-KEY': sk, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(15000),
        })
        if (!res.ok) return '搜索服务暂时不可用（HTTP ' + res.status + '）'
        const data = await res.json()
        if (type === 'videos') {
          const vs = (data.videos || []).slice(0, 5).map((v: any) => ({ title: v.title || '', url: v.link || '', channel: v.channel || '', duration: v.duration || '' }))
          if (!vs.length) return '没有搜到相关视频'
          return 'VIDEO_WEB:' + JSON.stringify(vs)
        }
        if (type === 'news') {
          const ns = (data.news || []).slice(0, 5).map((n: any) => ({ title: n.title || '', url: n.link || '', source: n.source || '', date: n.date || '' }))
          if (!ns.length) return '没有搜到相关新闻'
          return 'NEWS:' + JSON.stringify(ns)
        }
        const ws = (data.organic || []).slice(0, 5).map((r: any) => ({ title: r.title || '', url: r.link || '', snippet: r.snippet || '' }))
        if (!ws.length) return '没有搜到相关内容'
        return 'WEB_RESULT:' + JSON.stringify(ws)
      } catch (e: any) {
        return '搜索失败：' + (e?.message || '网络错误')
      }
    }

    // ── 数字人口播 ──
    case 'crawl_web': {
      const crawlUrl = String(args.url || '').trim()
      if (!/^https?:\/\//.test(crawlUrl)) return 'CRAWL_INVALID:URL 无效（仅支持 http/https 链接）'
      const { crawlWeb, crawlScreenshot, isBlockedCrawlUrl } = await import('@/lib/crawl4ai')
      if (isBlockedCrawlUrl(crawlUrl)) return 'CRAWL_FAIL:目标地址不允许访问（内网/保留地址）'
      // 2026-08-14 C 方案：vision=true 时截图+视觉模型读图（需用户先确认，扣 20 点）
      if (args.vision === true) {
        const uidV = auth?.userId
        if (!uidV) return 'TOOL_REJECT:未登录'
        const VISION_COST = 20
        const vChk = await checkTokens(uidV, VISION_COST)
        if (!vChk.allowed) return `TOOL_REJECT:${vChk.message}`
        try {
          const shot = await crawlScreenshot(crawlUrl)
          if (!shot.ok || !shot.base64) return 'CRAWL_FAIL:' + (shot.error || '截图失败')
          const { describeImageWithVL } = await import('@/lib/ai-providers')
          const desc = await describeImageWithVL(shot.base64, args.purpose ? `用户想看：${args.purpose}。请用中文描述这张网页截图的主要内容和关键信息（只描述图中可见的）。` : undefined)
          if (!desc) return 'CRAWL_FAIL:视觉模型读图失败'
          await spendTokens(uidV, VISION_COST, 'agent_crawl_vision')
          return `CRAWL_VISION_RESULT:${desc.substring(0, 8000)}|URL:${crawlUrl}`
        } catch (e: any) {
          return 'CRAWL_FAIL:' + (e?.message || '截图读图异常')
        }
      }
      try {
        const cr = await crawlWeb(crawlUrl)
        if (!cr.ok) return 'CRAWL_FAIL:' + (cr.error || '抓取失败')
        if (!cr.markdown) return 'CRAWL_NEED_VISION:该页面没有可提取的文本内容。可用「截图+AI视觉扫描」查看整页（约20点/次）。请先向用户确认是否使用，用户同意后再调用本工具并带 vision:true 参数。'
        const purpose = args.purpose ? `。抓取目的：${args.purpose}` : ''
        return `CRAWL_RESULT:${cr.markdown.substring(0, 15000)}|URL:${crawlUrl}${purpose}`
      } catch (e: any) {
        return 'CRAWL_FAIL:' + (e?.message || '抓取异常')
      }
    }

    case 'digital_human_speak': {
      const text = (args.text || '').trim()
      if (!text) return '请提供口播文案内容'
      const avatarId = args.avatarId
      if (!avatarId) return 'DH_NEED_AVATAR:请先指定数字人形象ID（去「数字人」页查看已创建形象）。也可以先让我用 generate_image 生成一张形象照，再去数字人页创建形象。'
      try {
        const res = await fetch(`${baseUrl}/api/digital-human`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth?.userId}` },
          body: JSON.stringify({ action: 'avatar-speak', avatarId, text }),
        })
        const data = await res.json()
        if (data.success && data.taskId) return `DH_TASK:${data.taskId}|TEXT:${text.substring(0, 50)}`
        return `DH_NEED_AVATAR:${data.message || '数字人口播创建失败'}`
      } catch (e: any) {
        return `DH_NEED_AVATAR:数字人口播接口调用失败（${e.message}）`
      }
    }

    // ── 数字人任务进度查询 ──
    case 'query_digital_human': {
      const taskId = args.taskId
      if (!taskId) return '缺少 taskId'
      try {
        const res = await fetch(`${baseUrl}/api/digital-human`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth?.userId}` },
          body: JSON.stringify({ action: 'query', taskId }),
        })
        const data = await res.json()
        if (data.avatarUrl) return `DH_RESULT:${data.avatarUrl}`
        return `DH_PROGRESS:${data.status || '处理中'}|TASK:${taskId}`
      } catch { return `DH_PROGRESS:查询失败|TASK:${taskId}` }
    }

    // ── 一键成片进度查询（AGENT 不主动发起一键成片，仅当用户从一键成片页带参数回来问进度时查询）──
    case 'query_video_task': {
      const taskId = args.taskId
      // ★A6 / VF_PROGRESS_V1（2026-09-22，用户实测「问进度却回『发布流程处理中』」）：
      //   本地成片的任务号形如 `vf<时间戳>`，它的进度只写在
      //   `<storage>/<uid>/video-factory/vf<ts>.json`（含 tail 逐镜日志），
      //   而本 case 下面查的是 **DB 的生成记录表** → 本地成片永远"查不到" → 空回复
      //   → 命中块尾那句给【发布线】写的兜底文案 → 用户看到的"编了一句不相干的话"。
      //   修法：`vf*` 任务号直接交给【本地任务读取器】（query_make_video，读同一个 JSON），
      //   读到就给真实进度（第 N/M 镜 / 已用 Xs / 成片文件名）。
      if (/^vf/i.test(String(taskId || ''))) {
        try {
          const _local = String(await executeToolCall('query_make_video', { taskId: String(taskId) }, auth))
          if (!/没有找到本地成片任务/.test(_local)) {
            return '🎬 ' + _local.replace(/^MAKE_VIDEO_PROGRESS:\s*/, '')
          }
        } catch (eL: any) { console.error('[query_video_task] 本地任务读取失败:', eL?.message || eL) }
      }
      if (!taskId) {
        // 2026-08-23: 用户问"最近任务进度"无 ID——查最近 5 条生成任务返回状态
        try {
          const recent = await prisma.videoTask.findMany({
            where: { userId: auth?.userId },
            orderBy: { createdAt: 'desc' }, take: 5,
            select: { id: true, status: true, outputPath: true, createdAt: true },
          })
          if (recent.length) {
            const lines = recent.map((t, i) => i + 1 + '. 任务#' + t.id + ' 状态:' + (t.status || '处理中') + (t.outputPath ? ' 已完成' : ''))
            return 'VIDEO_PROGRESS:最近 ' + recent.length + ' 个生成任务： ' + lines.join(' | ')
          }
          return 'VIDEO_PROGRESS:暂无生成任务（可让我"生成一段视频"开始）'
        } catch { return 'VIDEO_PROGRESS:任务查询失败' }
      }
      try {
        const r = await queryVideoTask(taskId)
        if (!r) return `VIDEO_PROGRESS:查询失败|TASK:${taskId}`
        if (r.status === 'completed' || r.status === 'SUCCEEDED' || r.status === 'succeeded' || r.status === 'success' || r.status === 'done') { // 2026-08-28: 火山返回小写 succeeded
          // 2026-08-24: 防丢——完成即转存 OSS + 自动入个人仓库 + 落生成记录（URL 不再是一次性的）
          let finalUrl = r.videoUrl || ''
          try {
            if (r.videoUrl && auth?.userId) {
              const key = 'storage/' + auth.userId + '/ai_' + Date.now() + '.mp4'  // 2026-08-24: AI生成视频直接进个人仓库目录(storage/{userId}/)，/storage页可见
              const buf = Buffer.from(await (await fetch(r.videoUrl, { signal: AbortSignal.timeout(120000) })).arrayBuffer())
              const oss = await getOSSClient()
              await oss.put(key, buf)
              finalUrl = await signedUrl(key, 86400)
              // 2026-08-26 B方案：成片完成才扣（finalizeSuccessByTaskId 原子认领——pending→processing→扣款，防重复）
              try { await finalizeSuccessByTaskId(String(taskId), finalUrl) } catch (e7) { console.error('[charge] 成片扣费失败:', e7) }
              await prisma.mediaAsset.create({
                data: { title: 'AI生成视频', ossUrl: finalUrl, type: 'video', prompt: String(args.prompt || 'AI生成视频').slice(0, 100), category: 'AI生成', source: 'private', ownerId: auth.userId, orientation: 'landscape' },
              })
              try {
                const rec = await createRecord({ userId: auth.userId, type: 'text2video', provider: 'dashscope', prompt: String(args.prompt || 'AI生成视频'), costPoints: 0 })
                await finalizeSuccess(rec, auth.userId, { platformUrl: r.videoUrl, costPoints: 0, reason: 'text2video' })
              } catch {}
            }
          } catch (e) { console.error('[query_video_task] 视频转存失败:', e) }
          return `VIDEO_RESULT:${finalUrl}`
        }
        return `VIDEO_PROGRESS:${r.status || '处理中'}|TASK:${taskId}`
      } catch { return `VIDEO_PROGRESS:查询失败|TASK:${taskId}` }
    }

    // ── 项目素材库 ──
    case 'search_storage': {
      try {
        const where: any = { ownerId: auth?.userId }
        if (args.type && args.type !== 'all') where.type = args.type
        if (args.keyword) where.title = { contains: args.keyword }
        const items = await prisma.mediaAsset.findMany({ where, orderBy: { createdAt: 'desc' }, take: 8 })
        if (items.length) {
          const list = items.map((m, i) => `${i + 1}. ${m.title} [${m.type}] ${m.ossUrl || m.url || ''}`).join('\n')
          return `STORAGE_RESULT:项目素材库找到${items.length}个素材（URL可直接用于配图/发布）:\n${list}`
        }
        return 'STORAGE_RESULT:项目素材库暂无匹配内容。可以试试个人仓库(list_personal_files)、网上找图，或让我AI生成。'
      } catch { return 'STORAGE_RESULT:素材查询失败' }
    }

    // ── 找视频播放（路线1·真播放：本地库 + 外站 web 播放）──
    case 'search_video': {
      try {
        const kw = (args.keyword || '').trim()
        const scope = (args.scope || 'all') as string
        let found: { url: string; title: string }[] = []

        // 1) 个人仓库视频
        if ((scope === 'all' || scope === 'personal') && auth?.userId) {
          try {
            const prefix = `storage/${auth.userId}/`
            const objects = await listObjects(prefix)
            const vids = objects
              .filter(o => !o.name.includes('/.thumbs/'))
              .map(o => {
                const name = o.name.replace(prefix, '')
                const isVideo = /\.(mp4|mov|avi|mkv|webm)$/i.test(name)
                return { name, isVideo, url: `/api/storage/file?userId=${auth.userId}&name=${encodeURIComponent(name)}` }
              })
              .filter(v => v.isVideo)
              .filter(v => !kw || v.name.includes(kw))
              .sort((a, b) => b.name.localeCompare(a.name))
              .slice(0, 5)
            found.push(...vids.map(v => ({ url: v.url, title: v.name })))
          } catch { /* 忽略个人仓库错误 */ }
        }

        // 2) 项目素材库视频
        if (scope === 'all' || scope === 'storage') {
          try {
            const where: any = { type: 'video' }
            if (kw) where.title = { contains: kw }
            const items = await prisma.mediaAsset.findMany({ where, orderBy: { createdAt: 'desc' }, take: 5 })
            found.push(...items.map(m => ({ url: m.ossUrl || m.url || '', title: m.title }))) // 2026-08-28: 同上——AI 可见
          } catch { /* 忽略 */ }
        }

        if (found.length && scope !== 'web') {
          // 返回首个可播放视频（VIDEO_RESULT 触发前端播放器），并列出全部候选
          const first = found[0]
          const list = found.map((f, i) => `${i + 1}. ${f.title}`).join('\n')
          return `VIDEO_RESULT:${first.url}|TITLE:${first.title}\n其它候选:\n${list}`
        }

        // 3) 外站播放（web scope 或 本地无结果时，返回可直接 iframe 真播的外站链接）
        if (scope === 'web' || !found.length) {
          const q = encodeURIComponent(kw || '热门视频')
          const bili = `https://search.bilibili.com/all?keyword=${q}`
          const yt = `https://www.youtube.com/results?search_query=${q}`
          if (kw) {
            return `VIDEO_WEB:${bili}|TITLE:在B站搜索「${kw}」\n备选YouTube:${yt}\n(前端播放器已支持B站/YouTube直链真播放；也可把具体视频链接发给我直接播)`
          }
          return 'VIDEO_RESULT_EMPTY:未指定视频关键词。请告诉我具体想看什么，例如"播放白龙马的视频"。'
        }
        return 'VIDEO_RESULT_EMPTY:未找到匹配的视频。可去【个人仓库】上传视频，或让我用 generate_video 生成一段。'
      } catch (e: any) {
        return 'VIDEO_RESULT_EMPTY:视频搜索失败'
      }
    }

    // ── 个人仓库（OSS 私有存储）──
    case 'list_personal_files': {
      if (!auth?.userId) return 'PERSONAL_RESULT:请先登录后再查看个人仓库'
      try {
        const prefix = `storage/${auth.userId}/`
        const objects = await listObjects(prefix)
        let files = objects
          .filter(o => !o.name.includes('/.thumbs/'))
          .map(o => {
            const name = o.name.replace(prefix, '')
            const isVideo = /\.(mp4|mov|avi|mkv|webm)$/i.test(name)
            const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(name)
            return {
              name,
              type: isVideo ? 'video' : isImage ? 'image' : 'file',
              sizeMB: (o.size / 1024 / 1024).toFixed(1),
              mtime: o.lastModified.toISOString().substring(0, 10),
              url: `/api/storage/file?userId=${auth.userId}&name=${encodeURIComponent(name)}`,
            }
          })
        if (args.type === 'video') files = files.filter(f => f.type === 'video')
        if (args.type === 'image') files = files.filter(f => f.type === 'image')
        if (args.keyword) files = files.filter(f => f.name.includes(args.keyword))
        files = files.sort((a, b) => b.mtime.localeCompare(a.mtime)).slice(0, 10)
        if (!files.length) return 'PERSONAL_RESULT:个人仓库暂无匹配文件。可以去【个人仓库】页上传，或让我AI生成内容。'
        const list = files.map((f, i) => `${i + 1}. ${f.name} [${f.type}] ${f.sizeMB}MB ${f.mtime} URL:${f.url}`).join('\n')
        return `PERSONAL_RESULT:个人仓库找到${files.length}个文件（URL可直接作为发布内容）:\n${list}`
      } catch { return 'PERSONAL_RESULT:个人仓库读取失败' }
    }

    // ── 模板 ──
    case 'add_knowledge_site': {
      try {
        if (!args?.url) return 'KNOWLEDGE_RESULT:缺少 URL'
        const r = await fetch(`${baseUrl}/api/knowledge-sites`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth.userId}` } : {}) },
          body: JSON.stringify({ url: args.url, title: args.title || '', desc: args.desc || '', category: args.category || '' }),
        })
        const d = await r.json()
        return d.success ? `KNOWLEDGE_RESULT:已加入知识库（${args.url}）` : `KNOWLEDGE_RESULT:${d.message || '加入失败'}`
      } catch (e: any) { return `KNOWLEDGE_RESULT:加入失败 ${e?.message}` }
    }
    case 'search_knowledge': {
      try {
        const q = new URLSearchParams()
        if (args?.category) q.set('category', args.category)
        const r = await fetch(`${baseUrl}/api/knowledge-sites?${q}`, { headers: auth ? { Authorization: `Bearer ${auth.userId}` } : {} })
        const d = await r.json()
        if (!d.success) return 'KNOWLEDGE_RESULT:查询失败'
        const list = (d.data || [])
        const kw = (args?.keyword || '').toLowerCase()
        const filtered = kw ? list.filter((s: any) => (s.title + s.desc + s.category + s.url).toLowerCase().includes(kw)) : list
        if (!filtered.length) return 'KNOWLEDGE_RESULT:知识库暂无匹配站点'
        return 'KNOWLEDGE_RESULT:知识库站点（可用 crawl_web 抓取查看内容）：\n' + filtered.slice(0, 8).map((s: any, i: number) => `${i + 1}. ${s.title || s.url} [${s.category || '未分类'}] ${s.url}`).join('\n')
      } catch (e: any) { return `KNOWLEDGE_RESULT:查询失败 ${e?.message}` }
    }
    case 'search_templates': {
      // 2026-08-18: 数据源改为公共素材库 MediaAsset（含提示词的素材）——prompt-library 后台不再对普通用户开放
      try {
        const kw = args.keyword || ''
        const cat = args.category || ''
        const where: any = { source: 'public', prompt: { not: '' } }
        if (kw) where.prompt = { contains: kw }
        const rows = await prisma.mediaAsset.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: 8,
          select: { id: true, title: true, prompt: true, type: true, category: true },
        })
        const filtered = rows.filter(r => !cat || (r.category || '').includes(cat) || (r.type || '').includes(cat))
        if (filtered.length) {
          const items = filtered.slice(0, 6).map((t: any, i: number) =>
            `${i + 1}. ${(t.title || t.prompt || '').substring(0, 30)}${t.category ? ` [${t.category}]` : ''}${t.type ? ` (${t.type})` : ''}`
          ).join('\n')
          return `TEMPLATE_RESULT:公共素材库找到${filtered.length}个相关素材:\n${items}\n（提示：回复用户"用第几个生成"即可直接生成）`
        }
        return 'TEMPLATE_RESULT:公共素材库暂无匹配素材'
      } catch (e: any) { return 'TEMPLATE_RESULT:模板查询失败（' + e.message + '）' }
    }

    case 'read_knowledge': {
      try {
        if (!auth?.userId) return 'KNOWLEDGE_NEED_LOGIN:请先登录。'
        const { PrismaClient } = await import('@prisma/client')
        const prisma = new PrismaClient()
        const user = await prisma.user.findUnique({ where: { id: auth.userId }, select: { username: true } })
        const uid = user?.username || String(auth.userId)
        const agents = await prisma.aIAgent.findMany({
          where: { userId: uid as any },
          include: { trainingDocuments: true },
          take: 5,
        })
        await prisma.$disconnect()
        if (!agents.length) return 'KNOWLEDGE_EMPTY:你的知识库还没有文档。可以到「AI 智能体」页创建一个智能体并上传训练文档（产品介绍/项目说明），我就能真正了解你的项目了。'
        const docs = agents.flatMap((a: any) => (a.trainingDocuments || []).map((d: any) => ({ agent: a.name, title: d.title, content: (d.content || '').slice(0, 1200) })))
        if (!docs.length) return 'KNOWLEDGE_EMPTY:智能体还没有训练文档，请先到「AI 智能体」页上传。'
        return docs.map((d: any) => `【${d.agent} · ${d.title}】\n${d.content}`).join('\n---\n')
      } catch (e: any) { return 'KNOWLEDGE_ERR:' + e.message }
    }

    case 'project_overview': {
      try {
        if (!auth?.userId) return 'PROJECT_NEED_LOGIN:请先登录。'
        const uid = auth.userId
        const [socialCount, socials, assetCount, assets, genCount, recentGens, user] = await Promise.all([
          prisma.socialAccount.count({ where: { userId: uid } }),
          prisma.socialAccount.findMany({ where: { userId: uid }, select: { platform: true, username: true, status: true }, take: 10 }),
          prisma.mediaAsset.count({ where: { ownerId: uid } }),
          prisma.mediaAsset.findMany({ where: { ownerId: uid }, select: { title: true, type: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 5 }),
          prisma.generationRecord.count({ where: { userId: uid } }),
          prisma.generationRecord.findMany({ where: { userId: uid }, select: { type: true, prompt: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 5 }),
          prisma.user.findUnique({ where: { id: uid }, select: { username: true, plan: true, pointBalance: true } }),
        ])
        const platformSet = [...new Set(socials.map(s => s.platform))]
        return [
          `【项目概况 · ${user?.username || ''}】`,
          `- 套餐：${user?.plan || 'free'} ｜ 点数余额：${user?.pointBalance ?? 0}`,
          `- 绑定平台账号：${socialCount} 个（${platformSet.join('、') || '无'}——登记用于状态跟踪，发布不依赖登记，任务建好后客户端自动执行）`,
          `- 素材库：${assetCount} 条${assets.length ? '（最近：' + assets.map(a => a.title).join('、') + '）' : ''}`,
          `- AI 生成记录：${genCount} 条${recentGens.length ? '（最近：' + recentGens.map(g => g.type + (g.prompt ? '「' + g.prompt.slice(0, 12) + '」' : '')).join('、') + '）' : ''}`,
          `- 已发布任务可查客户端【指纹浏览器】队列。`,
          `- 浏览器登录态：以客户端自检为准（登记页查看）。`,
        ].join('\n')
      } catch (e: any) { return 'PROJECT_OVERVIEW_ERROR:' + e.message }
    }

    // ── 发布 ──
    // 2026-08-29: 工具箱第一条——browser_use_execute（AI 驱动浏览器操作——admin 添加注册）
    case 'browser_use_execute': {
      const uidB = auth?.userId
      if (!uidB) return 'TOOL_REJECT:未登录'
      // 工具必须注册且 enabled（admin 关闭则不可见——这里再兜底）
      const regT = await prisma.agentTool.findUnique({ where: { name: 'browser_use_execute' } }).catch(() => null)
      if (!regT || !regT.enabled) return 'TOOL_REJECT:工具未启用'
      const taskB = String(args.task || '').trim()
      if (!taskB) return 'TOOL_REJECT:缺少任务描述（task）'
      const filesB = Array.isArray(args.files) ? args.files.map((f: any) => String(f)) : []
      const tB = await buCreate(uidB, taskB, JSON.stringify(filesB))
      console.log('[browser_use] 任务已建 #' + tB.id + ':', taskB.slice(0, 50))
      return 'BROWSER_TASK_QUEUED:已创建浏览器自动化任务（#' + (tB.seq ?? tB.id) + '）——客户端将用 AI 浏览器（browser-use）执行，稍后说"查任务状态"看结果。任务：' + taskB
    }

    case 'query_browser_tasks': {
        try {
          const bt = await prisma.agentBrowserTask.findMany({ where: { userId: auth?.userId || 0 }, orderBy: { id: 'desc' }, take: 10, select: { id: true, seq: true, status: true, task: true, error: true, createdAt: true } })
          if (!bt.length) return 'BROWSER_TASKS:no browser tasks yet.'
          return 'BROWSER_TASKS:' + '\n' + '\n' + bt.map((t: any) => '#' + (t.seq ?? t.id) + ' [' + (t.status || 'pending') + '] ' + String(t.task || '').slice(0, 60) + (t.error ? '(' + String(t.error).slice(0, 80) + ')' : '') + (t.result ? ' -> ' + String(t.result).slice(0, 60) : '')).join('\n')
        } catch (eQ: any) { return 'BROWSER_TASKS_ERROR:' + String(eQ?.message || eQ).slice(0, 100) }
      }
    case 'publish_content': {
      const pubRoot = fs.existsSync(path.join(process.cwd(), '.next', 'standalone', 'public')) ? path.join(process.cwd(), '.next', 'standalone', 'public') : path.join(process.cwd(), 'public')

      {
        // 2026-08-30: OPENCLI 发布链已清除——发布走 AI 浏览器（browser_use 状态机⑤）。AI 若仍调此工具 → 提示改走状态机
        if (!args._wf) {
          return 'PUBLISH_MIGRATED: 发布已迁移至 AI 浏览器（browser_use）——请按状态机走：先提供视频（如“发布 20260821_001.mp4 到抖音”），确认后系统自动创建 AI 浏览器发布任务。'
        }
        // 2026-08-23: 发布前查浏览器登录态（客户端上报）——未登录平台告知用户，不盲发
        // 2026-08-23: 发布前查浏览器登录态（客户端上报）——未登录平台告知用户，不盲发
        try {
          const { getBrowserStatus } = await import('@/lib/browser-status')
          const accts = getBrowserStatus(Number(auth?.userId || 0))
          const plat = String(args.platform || '').toLowerCase()
          const hit = accts.find((a) => a.id === plat)
          if (hit && !hit.loggedIn) {
            return 'BROWSER_LOGIN_REQUIRED:' + plat + '——你的浏览器未登录该平台，发布时会自动打开登录页，扫码登录后继续'
          }
        } catch {}
      }

      try {
        // 平台名归一化（中文/英文 -> 统一 key）
        const raw = String(args.platform || 'douyin').toLowerCase()
        const PLATFORM_ALIAS: Record<string, string> = {
          douyin: 'douyin', '抖音': 'douyin',
          xiaohongshu: 'xiaohongshu', '小红书': 'xiaohongshu', xhs: 'xiaohongshu',
          kuaishou: 'kuaishou', '快手': 'kuaishou',
          shipinhao: 'shipinhao', '视频号': 'shipinhao', weixin: 'shipinhao', '微信视频号': 'shipinhao',
          bilibili: 'bilibili', 'b站': 'bilibili', 'B站': 'bilibili', 'bili': 'bilibili', '哔哩哔哩': 'bilibili',
        }
        // 2026-09-13: 中文名映射从 platforms.ts 补（英文别名保留上面手写的）
        const platform = PLATFORM_ALIAS[raw] || PLATFORM_KEY[String(args.platform)] || PLATFORM_ALIAS[args.platform] || raw
        const PLATFORM_LABEL: Record<string, string> = PLATFORM_NAME   // 2026-09-13: 取自 platforms.ts
        const label = PLATFORM_LABEL[platform] || args.platform

        if (!auth?.userId) return 'PUBLISH_NEED_LOGIN:请先登录平台账号后再发布。'

        // 2026-08-18: 不再检查账号登记——默认用户已在指纹浏览器登录，直接建任务；
        // 若执行时客户端检测到未登录（fp 脚本 needLogin），任务会标记失败并提示扫码
        const accts = await prisma.socialAccount.findMany({
          where: { userId: auth.userId, platform },
          take: 5,
        })
        const list = accts.map(a => `- ${a.username}（${label}）`).join('\n')
        // C2 发布闭环（2026-08-05）：视频/文案齐备 → 创建发布任务，客户端自动发布（复用 7 平台脚本）
        // 2026-08-27: V4 flash 可能用 file/title/desc 参数名——兼容别名（videoName=file，caption=desc/title）
        const videoName = args.videoName || args.file || (typeof args.contentUrl === 'string' ? args.contentUrl.split('/').pop()?.split('?')[0] : '')
        // 2026-08-27 发布工作流：视频是日期+编号命名——用户没说具体哪个 → 列仓库最新3个编号让选（绝不问"视频叫什么名字"）
        if (!videoName) {
          try {
            const { listObjects } = await import('@/lib/oss')
            const objs = await listObjects('storage/' + auth.userId + '/')
            const vids = (objs || []).filter((o: any) => /\.(mp4|mov|avi|mkv|webm)$/i.test(o.name || '')).sort((a: any, b: any) => (b.lastModified || 0) - (a.lastModified || 0)).slice(0, 3)
            if (vids.length) return `WORKFLOW_NEED_VIDEO:发布工作流——你的仓库最近 ${vids.length} 个视频（日期+编号命名）：${vids.map((v: any, i: number) => i + 1 + '. ' + v.name.split('/').pop()).join(' | ')} —— 回复编号（如 1）或说“用最新”即发布。若都不对，可到个人仓库页选或本地上传。`
          } catch {}
          return 'WORKFLOW_NEED_VIDEO:发布工作流——未指定视频。请到个人仓库页选择要发布的视频，或直接本地上传后告诉我。'
        }
        const pubCaption = args.caption || args.desc || args.title || '' // V4 别名兼容
        const captionLine0 = pubCaption ? `
📝 文案：${pubCaption}` : ''
        if (videoName && (args.caption || true)) { // 2026-08-27: caption 空也建任务（用视频名作标题）——用户只说“发布抖音xx.mp4”不说文案也要建
          try {
            // 2026-08-18: 话题从文案提取 #标签（或用户显式传 topics）
            const hashTags = String(pubCaption || '').match(/#[^\s#，,。]+/g) || []
            const topicsArr = args.topics
              ? String(args.topics).split(/[,，]/).map((t: string) => t.trim()).filter(Boolean)
              : hashTags.map((t: string) => t.replace('#', ''))
            // 多平台：platforms 数组（或单 platform）
            const platformList: string[] = Array.isArray(args.platforms) && args.platforms.length
              ? args.platforms.map((pl: string) => PLATFORM_ALIAS[String(pl).toLowerCase()] || String(pl).toLowerCase())
              : [platform]
            const taskIds: number[] = []
            // 2026-08-28: 封面持久化——args.coverUrl 若是 /api/frames/ 临时帧（1h 后清理）→ 转存 OSS 永久代理 URL（克端可读不过期）
            let coverPersist = args.coverUrl || null
            if (coverPersist && coverPersist.includes('/api/frames/')) {
              try {
                // 2026-08-31 security: 路径遍历防护（去 ../ 和分隔符——限死 frames 目录）
                const cRel = String(coverPersist).replace('/api/frames/', '').replace(/\.\./g, '').replace(/[\/]/g, '')
                const cFp = path.join(pubRoot, 'frames', cRel)
                if (fs.existsSync(cFp)) {
                  const cBuf = fs.readFileSync(cFp)
                  const cKey = 'storage/' + auth.userId + '/cover_' + Date.now() + '.jpg'
                  await putObject(cKey, cBuf, 'image/jpeg')
                  coverPersist = '/api/storage/file?name=' + cKey.replace('storage/' + auth.userId + '/', '') + '&persist=1'
                  console.log('[publish] 封面已转 OSS 永久:', cKey)
                }
              } catch (eCov) { console.error('[publish] 封面转 OSS 失败:', eCov?.message || eCov) }
            }
            for (const pl of platformList) {
              const plLabel = PLATFORM_LABEL[pl] || pl
              const task = await prisma.agentPublishTask.create({
                data: {
                  userId: auth.userId,
                  platform: pl,
                  socialAccountId: null,
                  videoName,
                  title: String(pubCaption || videoName).slice(0, 16),  // ★TITLE16_V1：全平台标题统一 16 字 // 2026-08-27: 抖音标题限 30 字——自动截断防“标题超长”失败（#10 根因）
                  description: (args.test === true ? '[TEST] ' : '') + String(pubCaption || videoName),
                  topics: JSON.stringify(topicsArr),
                  coverUrl: coverPersist,
                  status: 'pending',
                },
              })
              taskIds.push(task.id)
            }
            const idTxt = taskIds.map((id, i) => `${PLATFORM_LABEL[platformList[i]] || platformList[i]} #${id}`).join('、')
            if (args.test === true) return `PUBLISH_QUEUED:已为「${idTxt}」创建【测试发布任务】（视频：${videoName}）——客户端将执行到"发布按钮前"停止（不上传不真发），找到发布按钮即测试通过。查结果说「查发布状态」。`
            return `PUBLISH_QUEUED:已为「${idTxt}」创建发布任务（视频：${videoName}）${topicsArr.length ? '，话题：#' + topicsArr.join(' #') : ''}。客户端【指纹浏览器】页会自动执行发布（自动启动浏览器+上传+填标题+发布）；若执行时提示账号未登录，到指纹浏览器页扫码后任务会自动重试。${captionLine0}`
          } catch (e: any) {
            return `PUBLISH_READY:创建发布任务失败（${e.message}）。
👉 可手动去客户端【指纹浏览器】页发布。`
          }
        }
        const contentLine = args.contentUrl ? `\n📎 待发内容：${args.contentUrl}` : '\n📎 待发内容：还未确定，可从个人仓库选一个成片'
        const captionLine = args.caption ? `\n📝 文案：${pubCaption}` : ''
        return `PUBLISH_READY:${label}发布准备:${contentLine}${captionLine}\n\n👉 告诉我要发哪个视频（素材仓库名）和文案，我直接创建发布任务；或去客户端【指纹浏览器】页手动发布。\n⚠️ 如果发布时提示「该账号未登录平台」，点账号卡片上的「🔓 去登录」扫码登录后重试（我不代你登录）。`
      } catch { return 'PUBLISH_READY:账号查询失败，请稍后重试' }
    }

    case 'cancel_publish_task': {
      try {
        const { PrismaClient } = await import('@prisma/client')
        const pc = new PrismaClient()
        const tid = parseInt(args.taskId || '0')
        if (!tid) return 'CANCEL_REJECT:缺少任务编号'
        const t = await pc.agentPublishTask.findFirst({ where: { id: tid, userId: auth?.userId || 0 } })
        if (!t) return 'CANCEL_REJECT:任务#' + tid + ' 不存在'
        if (t.status !== 'pending') return 'CANCEL_REJECT:任务#' + tid + ' 当前状态为 ' + t.status + '（只能取消未执行任务）'
        await pc.agentPublishTask.update({ where: { id: tid }, data: { status: 'cancelled', error: '用户取消' } })
        return 'CANCEL_OK:已取消发布任务#' + tid + '（客户端不再执行）。需要重新发布可随时说“发布…”重新建任务。'
      } catch (e9) { return 'CANCEL_REJECT:取消异常: ' + (e9.message || e9) }
    }
    case 'query_publish_tasks': {
      // 2026-08-31: 发布已统一 AI 浏览器——查 AgentBrowserTask（旧表 agentPublishTask 无新任务）
      try {
        const bt2 = await prisma.agentBrowserTask.findMany({ where: { userId: auth?.userId || 0 }, orderBy: { id: 'desc' }, take: 5, select: { id: true, seq: true, status: true, task: true, createdAt: true } })
        if (!bt2.length) return 'PUBLISH_TASKS:暂无发布/浏览器任务。'
        return 'PUBLISH_TASKS:' + '\n' + '\n' + bt2.map((t: any) => '#' + (t.seq ?? t.id) + ' [' + (t.status || 'pending') + '] ' + String(t.task || '').slice(0, 50) + (t.error ? '（' + String(t.error).slice(0, 80) + '）' : '') + (t.result ? ' → ' + String(t.result).slice(0, 50) : '')).join('\n')
      } catch (eQ: any) { return 'PUBLISH_TASKS_ERROR:' + String(eQ?.message || eQ).slice(0, 100) }
    }

    // ── 自动化 ──
    case 'automation_check': {
      try {
        const tasks = await prisma.automationTask.findMany({
          where: auth?.userId ? { createdBy: auth.userId } : {},
          orderBy: { createdAt: 'desc' }, take: 5,
        })
        if (tasks.length) {
          const list = tasks.map(t => `- [${t.status}] ${t.type}: ${t.params?.substring(0, 40)}`).join('\n')
          return `你有${tasks.length}个自动化任务:\n${list}`
        }
        return '暂无自动化任务。要创建吗？'
      } catch { return '自动化查询失败' }
    }

    // ── 长期记忆（融合 BaiLongma memory 模块）──
    case 'search_memory': {
      try {
        const { PrismaClient } = await import('@prisma/client')
        const prisma = new PrismaClient()
        const kw = (args.query || '').trim()
        const user = await prisma.user.findUnique({ where: { id: auth.userId }, select: { username: true } })
        const uid = user?.username || String(auth.userId)
        const rows = await prisma.agentMemory.findMany({
          where: {
            userId: uid,
            OR: kw ? [
              { content: { contains: kw } },
              { tags: { contains: kw } },
            ] : undefined,
          },
          orderBy: { salience: 'desc' },
          take: 8,
        })
        await prisma.$disconnect()
        if (!rows.length) return JSON.stringify({ found: false, hint: '没有相关记忆' })
        return JSON.stringify({ found: true, items: rows.map((r: any) => ({ content: r.content, tags: r.tags, salience: r.salience })) })
      } catch (e: any) {
        return JSON.stringify({ found: false, error: e.message })
      }
    }
    case 'upsert_memory': {
      try {
        const { PrismaClient } = await import('@prisma/client')
        const prisma = new PrismaClient()
        const content = (args.content || '').trim()
        if (!content) return JSON.stringify({ ok: false, error: '缺少内容' })
        const tags = Array.isArray(args.tags) ? args.tags.join(',') : (args.tags || '')
        const salience = Number(args.salience) || 0.5
        // 2026-08-06：AgentMemory.userId 存 username（非数字 id），统一口径才能查到
        const user = await prisma.user.findUnique({ where: { id: auth.userId }, select: { username: true } })
        const uid = user?.username || String(auth.userId)
        const existing = await prisma.agentMemory.findFirst({
          where: { userId: uid, content: { contains: content.substring(0, 20) } },
        })
        if (existing) {
          await prisma.agentMemory.update({ where: { id: existing.id }, data: { content, tags, salience, updatedAt: new Date() } })
        } else {
          await prisma.agentMemory.create({ data: { userId: uid, content, tags, salience } })
        }
        await prisma.$disconnect()
        return JSON.stringify({ ok: true })
      } catch (e: any) {
        return JSON.stringify({ ok: false, error: e.message })
      }
    }

    // ── 未接入需求收集 ──
    case 'collect_unmet_need': {
      try {
        const { PrismaClient } = await import('@prisma/client')
        const p = new PrismaClient()
        const user = await p.user.findUnique({ where: { id: auth.userId }, select: { username: true } })
        const userId = user?.username || String(auth.userId)
        const need = (args.need || '').trim()
        const platform = (args.platform || '').trim()
        const detail = (args.detail || '').trim()
        const content = `【未接入需求】平台/功能：${platform}；需求：${need}${detail ? `；细节：${detail}` : ''}`
        // ★PROFILE_FIX_V1：加幂等（同用户同内容只留一条，之前会重复两条）
        const existNeed = await p.agentMemory.findFirst({ where: { userId, tags: { contains: '未接入需求' }, content } })
        if (existNeed) {
          await p.agentMemory.update({ where: { id: existNeed.id }, data: { updatedAt: new Date() } })
        } else {
          await p.agentMemory.create({
            data: { userId, content, tags: '未接入需求,平台', salience: 0.9 },
          })
        }
        await p.$disconnect()
        return `UNMET_NEED:已记录|PLATFORM:${platform}|NEED:${need}`
      } catch (e: any) {
        return `UNMET_NEED_ERR:${e.message}`
      }
    }

    // ── 清空记忆（重新定义画像用）──
    case 'clear_memory': {
      try {
        const { PrismaClient } = await import('@prisma/client')
        const p = new PrismaClient()
        const user = await p.user.findUnique({ where: { id: auth.userId }, select: { username: true } })
        const userId = user?.username || String(auth.userId)
        const tag = (args.tag || '').trim()
        const where: any = { userId }
        if (tag) where.tags = { contains: tag }
        const n = await p.agentMemory.deleteMany({ where })
        await p.$disconnect()
        return JSON.stringify({ ok: true, deleted: n.count })
      } catch (e: any) {
        return JSON.stringify({ ok: false, error: e.message })
      }
    }

    // ── 设定助手名字/人设 ──
    case 'set_agent_profile': {
      try {
        const { PrismaClient } = await import('@prisma/client')
        const p = new PrismaClient()
        const userId = auth?.userId || ''
        const name = (args.name || '').trim()
        const persona = (args.persona || '').trim()
        if (!name && !persona) return JSON.stringify({ ok: false, error: '缺少名字或人设' })
        const content = `【助手人设】名字: ${name || '（未设）'}；人设: ${persona || '（未设）'}`
        // 更新或新建 agent_profile 记忆
        const existing = await p.agentMemory.findFirst({ where: { userId, tags: { contains: 'agent_profile' } } })
        if (existing) {
          await p.agentMemory.update({ where: { id: existing.id }, data: { content, updatedAt: new Date() } })
        } else {
          await p.agentMemory.create({ data: { userId, content, tags: 'agent_profile', salience: 1.0 } })
        }
        await p.$disconnect()
        return `AGENT_PROFILE_SET:名字=${name || '（通用）'}|人设=${persona || '（默认）'}`
      } catch (e: any) {
        return `AGENT_PROFILE_ERR:${e.message}`
      }
    }

    // ── 搜索全球真实热点（舆情，带降级）──
    case 'extract_video_frames': {
      if (!auth?.userId) return '请先登录'
      try {
        const videoName = String(args.videoName || '').trim()
        if (!videoName) return '缺少视频文件名'
        const prefix = `storage/${auth.userId}/`
        const objects = await listObjects(prefix)
        const hit = objects.find(o => o.name === prefix + videoName || o.name.endsWith('/' + videoName))
        if (!hit) return '仓库中未找到视频 ' + videoName
        const url = await signedUrl(hit.name)
        const tmp = path.join(os.tmpdir(), 'agentframes-' + auth.userId + '-' + Date.now())
        fs.mkdirSync(tmp, { recursive: true })
        const srcPath = path.join(tmp, 'src.mp4')
        execSync(`curl -s -o "${srcPath}" "${url}"`, { timeout: 60000 })
        if (!fs.existsSync(srcPath) || fs.statSync(srcPath).size < 1000) return '视频下载失败'
        const ts = String(Date.now())
        // 2026-08-23: frames 输出到真实静态目录——standalone 部署用 .next/standalone/public（否则 /frames/... 404 破碎图），dev 用 public
        const pubRoot = fs.existsSync(path.join(process.cwd(), '.next', 'standalone', 'public'))
          ? path.join(process.cwd(), '.next', 'standalone', 'public')
          : path.join(process.cwd(), 'public')
        const outDir = path.join(pubRoot, 'frames', String(auth.userId), ts)
        fs.mkdirSync(outDir, { recursive: true })
        let dur = 5
        let orientation: 'landscape' | 'portrait' | undefined = undefined
        try {
          const wh = execSync(`ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "${srcPath}"`).toString().trim()
          const whp = wh.split(',').map(Number)
          if (whp[0] && whp[1]) orientation = whp[0] > whp[1] ? 'landscape' : 'portrait'
        } catch {}
        try { dur = parseFloat(execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${srcPath}"`, { timeout: 15000, encoding: 'utf8' })) || 5 } catch {}
        const pcts = [0, 25, 75, 99]
        const frames: string[] = []
        for (let i = 0; i < pcts.length; i++) {
          const t = (dur * pcts[i]) / 100
          const out = path.join(outDir, 'f' + i + '.jpg')
          try {
            execSync(`ffmpeg -y -ss ${t.toFixed(2)} -i "${srcPath}" -frames:v 1 -vf "scale=640:-2" -q:v 5 "${out}"`, { timeout: 30000 })
            if (fs.existsSync(out)) frames.push(`/api/frames/${auth.userId}/${ts}/f${i}.jpg`)
          } catch {}
        }
        if (!frames.length) return '抽帧失败，视频可能无法解码'
        frameStore.set(auth.userId, { frames: frames.map((u, idx) => ({ idx: idx + 1, url: u })), videoName, orientation })
        try {
          const base = path.join(pubRoot, 'frames', String(auth.userId))
          if (fs.existsSync(base)) for (const d of fs.readdirSync(base)) {
            const p = path.join(base, d)
            if (Date.now() - fs.statSync(p).mtimeMs > 3600000) fs.rmSync(p, { recursive: true, force: true })
          }
        } catch {}
        const grid = ''
        const recommended = frames.length >= 4 ? 3 : 1  // 规则：75% 帧（idx3）暂代 AI 推荐
        // 2026-08-23: 视觉理解前置——百炼 qwen-vl-max 看帧总结内容（AI 基于真实内容写标题/推荐封面，杜绝瞎编）
        let visualDesc = ''
        try {
          // 2026-08-28: DEEPSEEK_API_KEY 优先（官方 vision-exp 支持图片）→ 无则百炼 qwen-vl-max 兑底
          const dsVisKey = process.env.DEEPSEEK_API_KEY
          const dsVisBase = 'https://api.deepseek.com/v1/chat/completions'
          const qwKey = process.env.DASHSCOPE_API_KEY
          const qwBase = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'
          const visAttempts: { base: string; key: string; model: string; thinking: boolean }[] = []
          if (dsVisKey) visAttempts.push({ base: dsVisBase, key: dsVisKey, model: 'deepseek-v4-flash-vision-exp', thinking: true })
          if (qwKey) visAttempts.push({ base: qwBase, key: qwKey, model: 'qwen-vl-max', thinking: false })
          if (visAttempts.length && frames.length) {
            // 2026-08-26: 帧读本地 → 传 OSS（signedUrl 公网可达）→ 视觉模型才能真正看到画面
            // 2026-08-27: 视觉改 V4（deepseek-v4-flash 多模态自己看）——再不依赖 qwen-vl（之前写死 ai-niuma.cc 本地帧 404 → visualDesc 空 → AI 瞎编）
            // 2026-08-28: base64 内联（DeepSeek 官方推荐——不依赖 OSS URL；海外访问国内 OSS 超时导致无输出）
            const images: any[] = []
            for (const u of frames.slice(0, 6)) {
              try {
                const rel = String(u).replace('/api/frames/', '')
                const fp = path.join(pubRoot, 'frames', rel)
                if (fs.existsSync(fp)) {
                  const buf = fs.readFileSync(fp)
                  images.push({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + buf.toString('base64') } })
                }
              } catch (e3) { console.error('[visual] 帧读取/base64 失败:', e3?.message || e3) }
            }
            if (!images.length) { console.error('[visual] 无帧可传（本地帧缺失）——视觉分析跳过') }
            for (const at of visAttempts) {
              const body: any = {
                model: at.model,
                messages: [{ role: 'user', content: [...images, { type: 'text', text: '这是视频的几个画面帧。请用中文完成并严格按格式返回（三段，用分号分隔）：总结：画面内容总结（主体/场景/动作，50字内）；标题：一个吸引人的发布标题（★严格16个字，尽量用满16字、不得少于12字，直接标题文字，不要前缀）；话题：3个话题标签（#开头，空格分隔）' }] }],
                max_tokens: 300,
                }
                if (at.thinking) body.thinking = { type: 'disabled' }
                const vr = await fetch(at.base, {
                  signal: AbortSignal.timeout(60000),
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + at.key },
                  body: JSON.stringify(body),
                }).then((r) => r.json())
              visualDesc = vr?.choices?.[0]?.message?.content?.[0]?.text || vr?.choices?.[0]?.message?.content || vr?.choices?.[0]?.message?.reasoning_content || ''
              if (visualDesc) { visualDesc = String(visualDesc).trim().replace(/^[\s\S]*?thinking process[\s\S]*?:\s*/, '').slice(0, 500); break }
              console.error('[visual] ' + at.model + ' 无输出，响应:', JSON.stringify(vr).slice(0, 300))
            }          }
        } catch (e2) { console.error('[visual] 视觉分析异常:', e2) }
        return 'FRAMES_OK:' + JSON.stringify({ frames, videoName, grid, recommended, visualDesc })
      } catch (e: any) { return '抽帧失败: ' + (e.message || e) }
    }
    case 'opencli_run': {
      const site = String(args.site || '').trim().toLowerCase()
      const command = String(args.command || '').trim().toLowerCase()
      const cmdArgs = String(args.args || '').trim()
      // 白名单
      const READ_CMDS = ['hot', 'search', 'comments', 'feed', 'videos', 'web2md', 'account']
      const PUBLISH_CMDS = ['publish']
      const readOk = READ_CMDS.includes(command)
      const pubOk = PUBLISH_CMDS.includes(command) && ['douyin', 'xiaohongshu', 'weibo'].includes(site)
      if (!readOk && !pubOk) return 'CLIENT_OPENCLI:不支持的命令（site=' + site + ' command=' + command + '）——白名单：热点/搜索/评论/feed/视频/web2md/账户；发布限抖音/小红书/微博'
      if (pubOk && command === 'publish') {
        // 发布须用户确认（工具描述已约束）；返回指令由客户端执行
        return 'CLIENT_OPENCLI:site=' + site + '|command=publish|args=' + cmdArgs + '|needConfirm=1'
      }
      return 'CLIENT_OPENCLI:site=' + site + '|command=' + command + '|args=' + cmdArgs
    }
    case 'search_trends': {
      try {
        const keyword = (args.keyword || '').trim()
        if (!keyword) return JSON.stringify({ ok: false, error: '缺少关键词' })
        const scope = (args.platforms === 'domestic' || args.platforms === 'global') ? args.platforms : 'all'
        const { items, source } = await searchTrendsReal(keyword, scope as any, Number(args.count) || 8)
        const list = items.map((it, i) =>
          `${i + 1}. [${it.platform}] ${it.title}\n   ${it.description || ''}\n   链接: ${it.url}`
        ).join('\n')
        return `TRENDS_RESULT:来源=${source}\n${list}`
      } catch (e: any) {
        return `TRENDS_ERR:${e.message}`
      }
    }

    default: {
      // 2026-08-30: 动态工具（工具箱注册）——查 endpoint 分发
      const regT = await prisma.agentTool.findUnique({ where: { name } }).catch(() => null)
      if (regT?.enabled) {
        if (regT.endpoint === 'browser_use') {
          const uidB2 = auth?.userId
          const taskB2 = String(args?.task || '').trim()
          if (!uidB2) return 'TOOL_REJECT:未登录'
          if (!taskB2) return 'TOOL_REJECT:缺少任务描述（task）'
          const filesB2 = Array.isArray(args?.files) ? args.files.map((f: any) => String(f)) : []
          const tB2 = await buCreate(uidB2, taskB2, JSON.stringify(filesB2))
          return 'BROWSER_TASK_QUEUED:已创建浏览器自动化任务（#' + (tB2.seq ?? tB2.id) + '）——客户端 AI 浏览器执行，稍后说"查任务状态"看结果。任务：' + taskB2
        }
        return `DYNAMIC_TOOL_NOT_IMPLEMENTED:工具「${regT.title || name}」已注册但执行端点未接入（endpoint=${regT.endpoint || '无'}）——请开发接入`
      }
      return `未知工具: ${name}`
    }
  }
}

// ==================== 结果格式化 ====================

// 清理模型偶发吐出的工具调用 XML 脏标签（不同模型命名不一）
function stripToolCallTags(text: string): string {
  if (!text) return text
  return text
    .replace(/<function_calls?>/gi, '')
    .replace(/<\/function_calls?>/gi, '')
    .replace(/<tool_call(s)?>/gi, '')
    .replace(/<\/tool_call(s)?>/gi, '')
    .replace(/<invoke>/gi, '')
    .replace(/<\/invoke>/gi, '')
    .replace(/<tool_call\s+name="[^"]*">/gi, '')
    .replace(/<function_call\s+[^>]*>/gi, '')
    .replace(/<\/?tool_name>/gi, '')
    .replace(/<\/?parameters>/gi, '')
    .replace(/<parameter\s+name="[^"]*">/gi, '')
    .replace(/<\/parameter>/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function formatToolResult(output: string): string {
  if (output.startsWith('IMAGE_RESULT:')) {
    const url = output.split('|')[0]?.replace('IMAGE_RESULT:', '') || ''
    return `✅ 图片已生成！\n\n![图片](${url})\n\n[查看原图](${url})`
  }
  if (output.startsWith('IMAGE_LIST:')) {
    const data = output.replace('IMAGE_LIST:', '')
    try {
      const imgs = JSON.parse(data)
      return `🔍 找到以下图片:\n\n${imgs.map((i: any, n: number) => `${n + 1}. ${i.title || '图片'}\n   ![预览](${i.url})`).join('\n\n')}`
    } catch { return `🔍 找到相关图片\n${data}` }
  }
  if (output.startsWith('VIDEO_TASK:')) {
    const parts = output.split('|'); const taskId = parts[0]?.replace('VIDEO_TASK:', '') || ''; const prompt = parts.find(p => p.startsWith('PROMPT:'))?.replace('PROMPT:', '') || ''
    return `⏳ 视频正在生成...\n\n描述：${prompt}\n稍等2-5分钟后来问我"视频好了吗"查看`
  }
  if (output.startsWith('VIDEO_RESULT:')) {
    return `🎬 视频完成！\n\n[📥 下载](${output.replace('VIDEO_RESULT:', '')})`
  }
  if (output.startsWith('VIDEO_WEB:')) {
    const parts = output.replace('VIDEO_WEB:', '').split('\n')
    const url = parts[0]?.replace('TITLE:', '') || ''
    const yt = parts.find(p => p.startsWith('备选YouTube:'))?.replace('备选YouTube:', '') || ''
    return `📺 已为你打开外站视频播放（B站/YouTube 支持真播放）：\n\n🔗 ${url}${yt ? `\n🔗 ${yt}` : ''}\n\n（也可把具体视频链接发给我，我直接帮你播）`
  }
  if (output.startsWith('STORAGE_RESULT:')) return output.replace('STORAGE_RESULT:', '')
  if (output.startsWith('PERSONAL_RESULT:')) return output.replace('PERSONAL_RESULT:', '')
  if (output.startsWith('TEMPLATE_RESULT:')) return output.replace('TEMPLATE_RESULT:', '')
  if (output.startsWith('PUBLISH_NEED_LOGIN:')) return `⚠️ ${output.replace('PUBLISH_NEED_LOGIN:', '')}`
  if (output.startsWith('PUBLISH_READY:')) return output.replace('PUBLISH_READY:', '')
  if (output.startsWith('UNMET_NEED:')) {
    const plat = output.split('|').find(p => p.startsWith('PLATFORM:'))?.replace('PLATFORM:', '') || ''
    return `✅ 已记录你对「${plat}」的需求。该平台/能力目前还在接入中，我已为你登记，人工客服会尽快与你联系～\n\n（稍后我会把客服微信二维码推给你，方便直接沟通）`
  }
  if (output.startsWith('DH_TASK:')) { const taskId = output.split('|')[0]?.replace('DH_TASK:', '') || ''
    return `🤖 数字人口播已提交！\n任务ID: ${taskId}\n稍后问我"口播好了吗"查看进度`
  }
  if (output.startsWith('DH_NEED_MEDIA:')) return `📷 ${output.replace('DH_NEED_MEDIA:', '')}`
  if (output.startsWith('AGENT_PROFILE_SET:')) {
    const name = output.split('|').find(p => p.startsWith('名字='))?.replace('名字=', '') || ''
    const persona = output.split('|').find(p => p.startsWith('人设='))?.replace('人设=', '') || ''
    return `✅ 好的，以后我就是「${name}」啦${persona && persona !== '（默认）' ? `，性格：${persona}` : ''}～有什么运营上的事尽管吩咐！`
  }
  if (output.startsWith('TRENDS_RESULT:')) {
    const src = output.split('\n')[0]?.replace('TRENDS_RESULT:', '') || ''
    const list = output.split('\n').slice(1).join('\n')
    return `🌐 为你搜到以下真实热点（数据来源：${src}）：\n\n${list}\n\n需要我针对哪条帮你写文案或做成视频吗？`
  }
  if (output.startsWith('TRENDS_ERR:')) return `⚠️ 海外舆情服务暂不可用：${output.replace('TRENDS_ERR:', '')}`
  return output
}

// ==================== API 入口 ====================

// 从回复中提取并剥离 SCENE_JSON 场景卡片（2026-08-05：工具分支与纯聊天分支共用，
// 避免模型未调工具直接输出场景卡片时前端显示原文）
async function extractSceneFromReply(raw: string): Promise<{ reply: string; scene: any; scenes: any[] }> {
  let reply = raw
  let scene: any = null
  const scenes: any[] = []
  // 2026-08-23: 提取所有 SCENE_JSON（AI 可能一次输出多个封面候选）→ scenes 数组，前端全部渲染
  const all = reply.matchAll(/\[SCENE_JSON\]([\s\S]*?)\[\/SCENE_JSON\]/g)
  for (const m of all) {
    try { scenes.push(JSON.parse(m[1])) } catch {}
    reply = reply.replace(m[0], '').trim()
  }
  scene = scenes[0] || null
  // 客服二维码场景：从 SystemConfig 读取 service_qrcode 并注入为图片卡片
  if (scene && scene.type === 'service_qrcode') {
    try {
      const cfg = await getSystemConfigs(['service_qrcode'])
      const qr = cfg?.service_qrcode || ''
      if (qr) {
        scene = { type: 'image', title: scene.title || '扫码联系客服', desc: scene.desc || '人工客服会尽快与你联系', url: qr }
      } else {
        scene = null // 未配置则不渲染，避免空图
      }
    } catch {
      scene = null
    }
  }
  return { reply, scene, scenes }
}

function _isSafeImgUrl(u: string): boolean { try { const h = String(u || '').match(/^https?:\/\/([^\/]+)/i); return !!h && /(?:aliyuncs\.com|dashscope|oss-)/i.test(h[1]) } catch { return false } }

export async function DELETE(request: NextRequest) {
  // 2026-08-31: 清除键全量清——清发布草稿（PUBLISH_DRAFT + AgentMemory pub_draft）+ 删会话（sessionId 参数）——方便重新测试
  try {
    const auth2 = await getAuthFromHeaders(request)
    if (!auth2) return NextResponse.json({ success: false, message: '请登录' }, { status: 401 })
    const url2 = new URL(request.url)
    const sessionId = parseInt(url2.searchParams.get('sessionId') || '')
    if (sessionId) await prisma.chatSession.deleteMany({ where: { id: sessionId, userId: auth2.userId } })
    PUBLISH_DRAFT.delete(auth2.userId)
    prisma.agentMemory.deleteMany({ where: { userId: String(auth2.userId), tags: { contains: 'pub_draft' } } }).catch(() => {})
    return NextResponse.json({ success: true })
  } catch { return NextResponse.json({ ok: false }) }
}

export const maxDuration = 300 // 2026-09-01: 一次全做封面硬等（300s）——防请求超时

export async function POST(request: NextRequest) {
  const auth = getAuthFromHeaders(request)

  try {
    const body = await request.json()
    const { message, history = [], sessionId: sid, attachments, hotContext, onboarding, currentApp } = body

    if (!message || typeof message !== 'string' || !message.trim()) {
      return NextResponse.json({ success: false, message: '请输入消息' }, { status: 400 })
    }

    let userMessage = message.trim()

    // ═══ 2026-08-20: "打开/去/进入+功能名" 前缀拦截（方案 A——代码层 100% 命中，不依赖 AI 理解）═══
    const OPEN_NAV: Array<[RegExp, string, string]> = [
      [/文生视频|AI视频|视频生成页/, '/text-to-video', '文生视频'],
      [/一键成片|做成片|剪成片/, '/auto-compile', '一键成片'],
      [/AI生图|生图页|图片生成/, '/image-generator', 'AI生图'],
      [/AI文案|文案页/, '/ai-copy', 'AI文案'],
      [/素材仓库|个人仓库|我的素材|打开仓库/, '/storage', '个人仓库'],
      [/指纹浏览器|发布工作台/, '/my-fingerprint', '指纹浏览器'],
      [/数据看板|仪表盘/, '/dashboard', '数据看板'],
      [/视频剪辑|后期处理|配音字幕/, '/video-edit', '视频剪辑'],
      [/我的套餐|套餐|充值|购买点数/, '/my-subscription', '我的套餐'],
      [/数字人|AI主播|口播/, '/digital-human', '数字人'],
      [/账号管理|我的账号|绑定账号/, '/accounts', '账号管理'],
      [/音乐库|BGM|配乐|背景音乐/, '/music-library', '音乐库'],
      [/公共素材/, '/media-library', '公共素材库'],
    ]
    // 匹配"打开/去/进入 + 功能名"；若后面紧跟生成指令（如"打开文生视频，帮我生成奶茶广告"）→ 不短路，走 AI（跳转+生成都由模型处理）
    const navMatch = userMessage.match(/^(打开|跳转|进入|去|带我去|看下)\s*(一下|下)?\s*(.{1,24})/)
    if (navMatch && !/生成|做|制作|写|帮我|做一个|生成一/.test(userMessage.slice(navMatch[0].length))) {
      const rest = navMatch[3] || ''
      for (const [re, path, title] of OPEN_NAV) {
        if (re.test(rest)) {
          return NextResponse.json({ success: true, data: {
            reply: `已为你打开「${title}」，我一直在旁边。想让我帮你做什么？比如：结合当前页面给建议、生成内容、或告诉我下一步。`,
            intent: 'nav_open', toolUsed: false,
            scene: { type: 'open_page', path, params: {} },
            sessionId: sid || null, pointsSpent: 0,
          } })
        }
      }
    }

    // 2026-08-21: "用第N帧"——用户从 video_frames 卡片选帧 → 注入该帧为 image_url，让视觉模型看画面（识别内容/推荐标题/设计封面）
    const framePick = userMessage.match(/^用第([一二三四五1-4])帧/)
    if (framePick && auth?.userId && frameStore.has(auth.userId)) {
      const picked = ['一', '二', '三', '四', '五', '1', '2', '3', '4'].indexOf(framePick[1]) % 5 + 1
      const store = frameStore.get(auth.userId)!
      const frame = store.frames.find(f => f.idx === picked)
      if (frame) {
        const host = request.headers.get('host') || 'ai-niuma.cc'
        const proto = request.headers.get('x-forwarded-proto') || 'https'
        const abs = `${proto}://${host}${frame.url}`
        userMessage = userMessage + `（选中第${picked}帧：${abs}）`
      }
    }

    // 组装附件：图像作为视觉块(image_url)让模型"看到"，视频等非图像以文本说明
    let userContent: any = userMessage
    if (attachments?.length) {
      const blocks: any[] = [{ type: 'text', text: userMessage }]
      for (const a of attachments as any[]) {
        if (typeof a.url === 'string' && (a.type || '').startsWith('image')) {
          // 2026-08-28: URL 转 OSS 签名（/api/storage/file 需登录——V4 fetch 不了）→ 模型真能下载看图
          let imgUrl = a.url
          try {
            const nm = String(a.url).match(/name=([^&]+)/)
            if (nm) {
              const { signedUrl } = await import('@/lib/oss')
              const key = 'storage/' + (auth?.userId || 0) + '/' + decodeURIComponent(nm[1])
              imgUrl = await signedUrl(key, 600).catch(() => a.url)
            }
          } catch {}
          blocks.push({ type: 'image_url', image_url: { url: imgUrl } })
          blocks.push({ type: 'text', text: '\n[图片URL：' + imgUrl + '（图生视频/克隆时 generate_video 的 refImage 参数传这个 URL）]' })
        } else if (Array.isArray((a as any).frames) && (a as any).frames.length) {
          // 2026-08-15: 视频已抽帧——帧图作为视觉块，AI 能"看"视频内容（提取提示词/描述）
          blocks.push({ type: 'text', text: '\n[视频URL：' + String((a as any).url || '') + ']' })
          blocks.push({ type: 'text', text: '\n[用户上传了视频，以下是视频关键帧（请分析画面内容）]' })
          for (const f of (a as any).frames) blocks.push({ type: 'image_url', image_url: { url: f } })
        } else {
          blocks.push({ type: 'text', text: '\n[用户上传了附件，请直接分析素材内容，回复中不要引用/重复素材 URL 或链接]' })
        }
      }
      userContent = blocks
    }

    // 读取用户给助手设定的名字/人设（agent_profile 记忆）
    // 用户级 AI 设置（2026-08-07：温度）
    let userTemperature = 0.7
    try {
      const u0 = await prisma.user.findUnique({ where: { id: auth?.userId || 0 }, select: { agentTemperature: true } })
      if (typeof u0?.agentTemperature === 'number') userTemperature = u0.agentTemperature
    } catch {}
    let agentProfile: { name?: string; persona?: string } | undefined
    try {
      const profMem = await prisma.agentMemory.findFirst({
        where: { userId: String(auth?.userId || 0), tags: { contains: 'agent_profile' } },
        orderBy: { updatedAt: 'desc' },
      })
      if (profMem) {
        const m = profMem.content.match(/名字[:：]\s*([^\n;；]+)/)
        const p = profMem.content.match(/人设[:：]\s*([^\n;；]+)/)
        agentProfile = { name: m?.[1]?.trim(), persona: p?.[1]?.trim() }
  
      // 2026-08-31: 发布草稿恢复（AgentMemory pub_draft——重启不丢——hasDraft 时序）
      try {
        const dMem = await prisma.agentMemory.findFirst({ where: { userId: String(auth?.userId || 0), tags: { contains: 'pub_draft' } }, orderBy: { updatedAt: 'desc' } })
        if (dMem) {
          const dp = JSON.parse(String(dMem.content).replace(/^发布草稿:/, ''))
          if (dp?.videoName) PUBLISH_DRAFT.set(auth?.userId || 0, dp)
        }
      } catch {}    }
    } catch {}
    // 自定义名称兜底（2026-08-07）：用户级 User.agentName > 全局 SystemConfig.agent_name
    try {
      if (!agentProfile?.name && auth?.userId) {
        const u = await prisma.user.findUnique({ where: { id: auth.userId }, select: { agentName: true } })
        if (u?.agentName) agentProfile = { name: u.agentName, persona: agentProfile?.persona }
      }
      if (!agentProfile?.name) {
        const cfg = await prisma.systemConfig.findUnique({ where: { key: 'agent_name' } })
        if (cfg?.value) agentProfile = { name: cfg.value, persona: agentProfile?.persona }
      }
    } catch {}

    // 2026-08-06：自动画像提取（不依赖模型调用工具——模型常口头答应但实际不写记忆）
    try {
      const pt = String(message || '')
      const platforms = ['抖音','快手','小红书','视频号','B站','微博','微信公众号','公众号','淘宝','拼多多','美团','饿了么','知乎','闲鱼']
      const foundPlat = platforms.find(p => pt.includes(p))
      const indMatch = pt.match(/(?:我|我们)(?:是|做|主营|主做|在(?:做|搞|经营))([\u4e00-\u9fa5]{2,12})(?:的|行业|生意|业务)?/)
      if (foundPlat || indMatch) {
        const { PrismaClient } = await import('@prisma/client')
        const pm = new PrismaClient()
        const u = await pm.user.findUnique({ where: { id: auth?.userId || 0 }, select: { username: true } })
        const uid = u?.username || String(auth?.userId || 0)
        // ★PROFILE_FIX_V1（2026-09-16）修三个 bug：
        //   ① 标签与内容不匹配（"主要平台：X" 曾被打上 '画像,行业' → 任何按"行业"取画像的地方都读到平台）
        //   ② 查重太粗（只比前 8 字符）→ 每提一个平台就新建一条，越积越多
        //   ③ "对话里提过的平台" ≠ 永久画像（可能只是一次性动作）
        //   现在：只有【行业/业务】写成画像（标签 '画像,行业'）；平台单独归 '画像,平台' 且低权重
        if (indMatch) {
          const icontent = '行业/业务：' + indMatch[1]
          const iexist = await pm.agentMemory.findFirst({ where: { userId: uid, tags: { contains: '画像,行业' }, content: icontent } })
          if (iexist) {
            await pm.agentMemory.update({ where: { id: iexist.id }, data: { salience: 0.9, updatedAt: new Date() } })
          } else {
            await pm.agentMemory.create({ data: { userId: uid, content: icontent, tags: '画像,行业', salience: 0.9 } })
          }
          // 若 User.industry 还空着，顺手补上（这是"视频/热点按行业推送"读的字段）
          try {
            const uu = await pm.user.findUnique({ where: { id: auth?.userId || 0 }, select: { industry: true } })
            if (uu && !uu.industry) {
              await pm.user.update({ where: { id: auth?.userId || 0 }, data: { industry: String(indMatch[1]).slice(0, 40) } })
            }
          } catch (e) {}
        }
        if (foundPlat) {
          const pcontent = '使用过的平台：' + foundPlat
          const pexist = await pm.agentMemory.findFirst({ where: { userId: uid, tags: { contains: '画像,平台' }, content: pcontent } })
          if (!pexist) {
            await pm.agentMemory.create({ data: { userId: uid, content: pcontent, tags: '画像,平台', salience: 0.4 } })
          }
        }
        await pm.$disconnect()
      }
    } catch {}

    // 构建消息（Agnes 多模态对话格式）
    const sysBlocks: string[] = [buildSystemPrompt(agentProfile, onboarding === true, (body as any)?.mode === 'free' || (body as any)?.agentMode === 'free')]
    // 2026-08-05：应用随行模式——用户在当前功能大屏内，让 AI 结合场景回答
    if (currentApp) sysBlocks.push(`【当前页面】用户正在使用「${currentApp}」应用（左侧功能大屏内操作）。请结合该应用场景简洁指导/回答，必要时给出下一步操作建议。`)
    if (hotContext && typeof hotContext === 'string' && hotContext.trim()) {
      sysBlocks.push(
        `\n【今日热点上下文（用户主页展示的真实热榜，可主动结合做内容，但只在相关时提及，不要每条都硬塞）】\n${hotContext}`
      )
    }
    // 2026-08-15: 生成意图 → 挑 3 条风格模板（图像库带封面图 / 视频库带视频）+ 后端兜底 scene 卡片
    let templateScene: any = null
    try {
      const GEN_IMG = /海报|生图|生成图|生成图片|广告图|产品图|设计图|封面|图片/
      const GEN_VID = /视频|广告片|短片|生视频/
      const uc = String(userContent || '')
      if (GEN_IMG.test(uc) || GEN_VID.test(uc) || /换一批|换风格|换几个/.test(uc)) {
        const isVid = GEN_VID.test(uc)
        const skip = Math.floor(Math.random() * 6) // 随机起点——「换一批」出不同风格
        const tpls = isVid
          ? await prisma.promptTemplate.findMany({ where: { source: 'cheerselfai', videoUrl: { not: null } }, orderBy: { id: 'desc' }, skip, take: 12 }).catch(() => [])
          : await prisma.promptTemplate.findMany({ where: { source: 'cheerselfai', coverUrl: { not: null } }, orderBy: { id: 'desc' }, skip, take: 12 }).catch(() => [])
        const cards = tpls.slice(0, 3).map((t: any) => ({
          type: isVid ? 'video' : 'image',
          url: isVid ? t.videoUrl : t.coverUrl,
          title: (t.title || '风格模板').substring(0, 18),
          prompt: t.prompt,
          model: t.model || '通用',
        }))
        if (cards.length) {
          templateScene = { type: 'template', items: cards }
          sysBlocks.push('\n【可参考风格模板（用户生成任务——回复时引导选 1/2/3 或用「换一批」，每条是真实库里的风格，标注模型；不要编造库里没有的风格）】\n'
            + cards.map((t: any, i: number) => `${i + 1}. ${t.title} (${t.model})`).join('\n'))
        }
      }
    } catch {}
    // 2026-08-18: 注入用户上下文（登录/套餐/点数）——AI 回复生成/发布类请求前必须参考真实数据
    try {
      if (auth?.userId) {
        const { getTokenWallet } = await import('@/lib/token-wallet')
        const w = await getTokenWallet(auth.userId)
        const subTxt = !w.hasSubscription ? '无套餐' : (w.subRemaining < 0 ? '套餐：' + (w.planName || '') + '（无限额度）' : '套餐：' + (w.planName || '') + '（剩 ' + w.subRemaining + '/' + w.allowance + ' 点）')
        const ctx = [
          '【用户上下文（真实数据，回复生成/发布类请求前必须参考）】',
          '- 用户已登录系统（能对话即已登录，禁止说用户未登录）',
          '- ' + subTxt + '；点卡余额 ' + w.pointBalance + ' 点；当前可用 ' + w.remaining + ' 点',
          '- 生成类操作会扣点数（生图12点/张、视频按秒、对话1点/条）；可用点数不足以完成请求时：先告知"点数不足（可用X点，需要Y点）"并引导去 /my-subscription 充值——不要先答应做再失败',
        ].join('\n')
        sysBlocks.push(ctx)
      }
    } catch {}

    const messages: AgentChatMessage[] = [
      { role: 'system', content: sysBlocks.join('\n') },
    ]
    for (const h of history.slice(-10)) {
      messages.push({ role: h.role === 'assistant' ? 'assistant' : 'user', content: h.content })
    }
    // 2026-08-19: ASR 纠错——"纹身"多为"文生"误识别（文生图/文生视频），替换避免误解
    let corrected: any
    if (Array.isArray(userContent)) {
      // 2026-09-06: 有图片附件（blocks 数组含 image_url 视觉块）——只对 text 块做 ASR 纠错，保留视觉块（String() 会毁掉 image_url）
      corrected = userContent.map((b: any) => {
        if (b && b.type === 'text' && typeof b.text === 'string') {
          return { ...b, text: b.text.replace(/纹身图/g, '文生图').replace(/纹身视频/g, '文生视频').replace(/纹身/g, '文生') }
        }
        return b
      })
    } else {
      corrected = String(userContent)
        .replace(/纹身图/g, '文生图')
        .replace(/纹身视频/g, '文生视频')
        .replace(/纹身/g, '文生')
    }
    // 2026-08-23: 附件解析——用户发本地视频附件（📎 URL）→ 提取仓库视频文件名注入 AI，AI 就能识别走发布流程
    let attachNote = ''
    try {
      if (Array.isArray(attachments)) {
        const vids = attachments
          .filter((a: any) => a && (String(a.type || '').includes('video') || /\.(mp4|mov|avi|mkv|webm)$/i.test(String(a.name || ''))))
          .map((a: any) => {
            const m = String(a.url || '').match(/[?&]name=([^&]+)/)
            return decodeURIComponent(m ? m[1] : String(a.name || ''))
          })
          .filter(Boolean)
        if (vids.length) attachNote = '\n【用户附件视频：' + [...new Set(vids)].join('、') + '——来自个人仓库，可确认后走发布流程（抽帧/发布）】'
      }
    } catch {}
    if (Array.isArray(corrected)) {
      if (attachNote) {
        const lastText = [...corrected].reverse().find((b: any) => b && b.type === 'text')
        if (lastText) lastText.text = (lastText.text || '') + attachNote
        else corrected.push({ type: 'text', text: attachNote })
      }
      messages.push({ role: 'user', content: corrected })
    } else {
      messages.push({ role: 'user', content: corrected + attachNote })
    }

    // Step 1: 多模态 + 工具调用
    // 2026-08-05：默认使用 DeepSeek（用户要求，本地无需海外代理）；仅当用户上传图片时
    // 才用 Agnes（多模态视觉），否则 DeepSeek 纯文本模型无法处理 image_url
    const hasImage = messages.some(m => Array.isArray(m.content) && (m.content as any[]).some((b: any) => b?.type === 'image_url'))
    // 2026-08-27: DeepSeek V4 flash 支持图片识别→图片/文本均走 dashscopeFunctionCall（内部 DeepSeek 优先）
    // 2026-08-29: 工具箱——注册表工具合并（enabled + 角色过滤）——admin 添加的工具自动可用/关闭不可见
    let toolsAll = AGENT_TOOLS
    try {
      const regTools = await prisma.agentTool.findMany({ where: { enabled: true }, orderBy: { id: 'asc' } })
      if (regTools.length) {
        const uRole = auth?.role || ''
        const visible = regTools.filter((rt) => rt.roles === 'all' || rt.roles === uRole || (rt.roles === 'admin' && uRole === 'admin'))
        if (visible.length) {
          toolsAll = [...AGENT_TOOLS, ...visible.map((rt) => {
            let params = {}
            try { params = JSON.parse(rt.parameters || '{}') } catch {}
            return { name: rt.name, description: rt.description || rt.title, parameters: { type: 'object', properties: params } }
          }) as any]
        }
      }
    } catch (eT) { console.error('[工具箱] 注册工具加载失败:', eT?.message || eT) }
    // 2026-09-06: 自由模式不暴露标准模式发布流程/状态机专用工具（干扰 AI 判断——如抽帧选封面）
    if ((body as any)?.mode === 'free') {
      const EXCLUDE_FREE = new Set(['extract_video_frames', 'publish_content', 'cancel_publish_task', 'automation_check', 'collect_unmet_need'])
      toolsAll = toolsAll.filter((t: any) => !EXCLUDE_FREE.has(t.name))
    }
    // 2026-08-31 完全隔离 Step1：标准模式 + 有发布草稿 → 模型不碰工具（直接状态机——FRAMES_OK 不再由模型产生）
    // 2026-09-01: 状态机词（\d|abc|换|重|确认|选|发）standard 无条件跳过模型（不依赖草稿恢复——彻底防'1'模型自由）
    const stWordInput = /^\d{1,2}$/.test(userMessage.trim()) || /^[abc]$/i.test(userMessage.trim()) || /换一批|重抽|重试|重来|用推荐|平台:|确认|选第|帮我发|发一个视频|发一条|发布|直接发/.test(userMessage) && !/发我看|发我|发群里|发给你|发一份|发过去/.test(userMessage)
    // ★VF_ENTRY_V1（2026-09-19，用户实测"时好时坏"的根因）：
    //   下面入口条件是 `if (skipModelStep1 || normCalls.length > 0)` ——
    //   即"AI 那一步调了工具"才进状态机块。成片入口词原本没算进 skipModelStep1，
    //   于是 AI 若直接开口聊天（不调工具）→ normCalls=0 → 整块跳过 → 成片状态机一行不跑
    //   → 落到 AI 自由发挥（时好时坏）。这里把【成片草稿 + 成片入口词】补进去。
    // ═══════════════════════════════════════════════════════════════════════
    // ★STD_MODE_V1（2026-09-21，用户定案）【标准模式 = 命令白名单，锁死】
    //   用户原话：
    //     · 「这些虽然是文字，它也是一个完整命令。进入这个命令，就没有别的路可以走」
    //     · 「少一个字 错一个字都不执行」
    //     · 「标准模式就给我锁死，每一个独立状态机。点哪个进哪个；进去了任何一条，
    //        不管到 1.2.3.4.5 步，看到第一条就是重来」
    //     · 「除了这些按键，发什么文字 都可以回复没有这个功能，请切换去自由模式尝试或联系客服咨询」
    //   三条出口（先到先赢）：
    //     ① 命中命令（去空格后一字不差，表在 standard-commands.ts）
    //          machine → 清掉【所有】流程草稿（=重来）+ 强制进状态机（跳过 AI 那一步）
    //          tool    → 照旧交给 AI 带工具跑一次（参数得从话里提；批2 会收窄成"只给这一个工具"）
    //          wip     → 直接回「开发中」
    //     ② 非命令 + 有进行中的流程 → 交给该流程（按它自己的 step 走）
    //     ③ 非命令 + 没有任何流程 → 固定回复（锁死）★带图消息除外（图像问答不是"命令流程"）
    //   ⚠️ 命令判定放在"入口词/草稿"判断【之前】—— 所以"看到命令就重来"是天然成立的。
    // ═══════════════════════════════════════════════════════════════════════
    let stdEnterMachine = false
    if ((body as any)?.mode !== 'free' && (body as any)?.agentMode !== 'free') {
      const stdHit = matchStdCommand(userMessage)
      if (stdHit) {
        console.log('[标准模式] 命中命令:', stdHit.id, '|', stdHit.text, '| kind=', stdHit.kind)
        try { vfLog(auth?.userId || 0, `[标准模式] 命中命令 ${stdHit.id}「${stdHit.text}」（kind=${stdHit.kind}）`) } catch { /* ignore */ }
        if (stdHit.kind === 'wip') {
          return NextResponse.json({ success: true, data: {
            reply: STD_WIP_REPLY(stdHit.text), intent: 'chat', toolUsed: false, sessionId: sid || null, scene: null, scenes: [],
            pointsSpent: 0,
          } })
        }
        if (stdHit.kind === 'machine') {
          // ★命令 = 重来：把发布线 + 三条成片线的草稿全部作废（旧流程一律不许存活）
          await stdClearAllDrafts(auth?.userId || 0)
          stdEnterMachine = true
        }
      } else if (!hasImage && !STD_QUERY_RE.test(userMessage) && !(await stdHasAnyDraft(auth?.userId || 0))) {
        // ★标准模式锁死：没有命令、也没有进行中的流程 → 不参与任何流程，也不让 AI 自由发挥
        console.log('[标准模式] 非命令且无进行中流程 → 固定回复')
        try { vfLog(auth?.userId || 0, `[标准模式] 非命令「${String(userMessage).slice(0, 30)}」且无流程 → 锁死回复`) } catch { /* ignore */ }
        return NextResponse.json({ success: true, data: {
          reply: STD_UNSUPPORTED_REPLY, intent: 'chat', toolUsed: false, sessionId: sid || null, scene: null, scenes: [],
          pointsSpent: 0,
        } })
      }
    }
    const vfEntryWord = /帮我做.{0,3}(一条|个|条)?视频|帮我成片|帮我做视频|本地成片|做一条视频|做个视频|做成片|做个宣传片/.test(userMessage)
    // ★VF_LINES_V1（2026-09-21）：**三条新线的入口词也必须算"状态机入口信号"** ——
    //   否则用户说「AI 制片」「素材+AI创作」时 skipModelStep1=false → 走 dashscopeFunctionCall
    //   → **AI 自由发挥**（实测它会把「AI 制片」理解成"打开一键成片网页"）→ **状态机整块都没进**。
    //   加上这两个判断后：这几句话会直接进状态机块 → 由下面的【三分派】接管。
    const vfLineWord = matchesAiLine(userMessage) || matchesMixLine(userMessage)
    // ★VF_PROTO_V1（2026-09-21，用户实测：AI 制片走到「▶️ 下一步（排分镜）」时掉出状态机 →
    //   AI 自由发挥，自己**编了一张假卡**（`step:'ai_plan'` —— 这个卡型代码里根本不存在），
    //   还带上了「（模型：qwen3.8-flash）」尾巴（那个尾巴只加在 AI 自由发挥的回复上，是铁证））。
    //   **根因**：卡片提交发的是 `VF_FORM:{...}`（协议串），它**不是任何一条线的"入口词"**
    //   → `skipModelStep1=false` → 整个状态机块被跳过（模型那步是否调工具又是不确定的，
    //     所以表现为"时好时坏"：卡1 侥幸进了、卡2 没进）。
    //   → 把【协议串本身】也算"状态机入口信号"：**卡片提交一定由状态机接管**，不再看模型脸色。
    //   （这些前缀只有卡片/工具会产生，用户不会手打；若三条线都不认领，行为退回现状，不会更坏。）
    const vfProtoWord = /^(VF_FORM|VF_JSON|FRAMES_OK|MAKE_VIDEO_TASK|MAKE_VIDEO_COST|MAKE_VIDEO_FAIL|BROWSER_TASK|TOOL_REJECT|VIDEO_RESULT)\s*[:{]/.test(userMessage.trim())
    // ★STD_MODE_V1：命中 machine 命令（发布 / 三条成片线）→ 强制进状态机（跳过 AI 那一步）
    const skipModelStep1 = (PUBLISH_DRAFT.has(auth?.userId || 0) || VIDEO_DRAFT.has(auth?.userId || 0) || vfEntryWord || stWordInput || vfLineWord || vfProtoWord || stdEnterMachine) && (body as any)?.mode !== 'free' && (body as any)?.agentMode !== 'free'
    // 2026-09-01: 草稿恢复提前到 Step1 前（原在状态机块内——Step1 模型先跑（hasDraft false→模型自由失败"繁忙"）——恢复太晚）
    if (!PUBLISH_DRAFT.has(auth?.userId || 0) && (/\d/.test(userMessage) || /[abc]/i.test(userMessage.trim()) || /换一批|重抽|重试|重来|用推荐|平台:|确认|选|发布|发一个视频|发一条|帮我发|发/i.test(userMessage))) {
      try {
        const dmR0 = await prisma.agentMemory.findFirst({ where: { userId: String(auth?.userId || 0), tags: { contains: 'pub_draft' } }, orderBy: { updatedAt: 'desc' } })
        if (dmR0?.content) { const dpR0 = JSON.parse(dmR0.content); if (dpR0?.videoName || dpR0?.step) { PUBLISH_DRAFT.set(auth?.userId || 0, dpR0); console.log('[状态机] Step1前恢复草稿——step=', dpR0.step) } }
      } catch {}
    }
    // 2026-09-07: 重发历史发布任务（#N 重新发布 / 发布失败 / 重发）——复制 task+files 建新任务，客户端自动重跑
    const rePubN = userMessage.match(/^#(\d+)\s*(重新发布|重发|再发|重新发|重跑)/i)
    const rePubRecent = /^(发布失败|重新发布|重发|再发一次|重来一次|重跑)$/i.test(userMessage.trim())
    if ((rePubN || rePubRecent) && (body as any)?.mode !== 'free') {
      try {
        const oldTask = rePubN
          ? await prisma.agentBrowserTask.findFirst({ where: { userId: auth?.userId || 0, OR: [{ seq: parseInt(rePubN[1]) }, { seq: null, id: parseInt(rePubN[1]) }] } })
          : await prisma.agentBrowserTask.findFirst({ where: { userId: auth?.userId || 0 }, orderBy: { id: 'desc' } })
        if (oldTask) {
          const nu = await buCreate(auth?.userId || 0, oldTask.task, oldTask.files)
          return NextResponse.json({ success: true, data: { reply: '已重新创建发布任务（#' + (nu.seq ?? nu.id) + '）——复用 #' + (oldTask.seq ?? oldTask.id) + ' 的视频/封面/标题/话题，客户端 AI 浏览器会重新执行。', toolUsed: true, steps: [], sessionId: sid || null, pointsSpent: TOKEN_COSTS.CHAT_PER_MSG } })
        }
        return NextResponse.json({ success: true, data: { reply: '未找到可重发的发布任务' + (rePubN ? '（#' + rePubN[1] + '）' : '') + '——请先发一个视频。', toolUsed: false, sessionId: sid || null, pointsSpent: TOKEN_COSTS.CHAT_PER_MSG } })
      } catch (eR) { console.error('[重发] 异常:', eR?.message || eR) }
    }
    const fcResult = skipModelStep1 ? { toolCalls: [], content: '' } : await dashscopeFunctionCall(messages as any, toolsAll, 2000, userTemperature, (body as any)?.mode === 'free' || (body as any)?.agentMode === 'free')
    const toolCalls = (fcResult as any)?.toolCalls || []
    // 2026-08-05：兼容 OpenAI 格式 tool_calls（百炼 qwen：{function:{name,arguments}}）与扁平格式（{name,arguments}）
    const normTool = (tc: any) => ({
      id: tc.id || '',
      name: tc.name || tc.function?.name || '',
      arguments: typeof tc.arguments === 'string' ? tc.arguments : (tc.function?.arguments ? String(tc.function.arguments) : '{}'),
    })
    const normCalls = toolCalls.map(normTool)

    if (skipModelStep1 || normCalls.length > 0) {  // 2026-09-01: skip 直接进状态机块（伪 normCalls 会被工具执行报错——改入口条件）
      // 按 OpenAI 兼容格式回传 assistant(tool_calls) + tool(tool_call_id)
      messages.push({
        role: 'assistant',
        content: fcResult.content || '',
        tool_calls: normCalls.map((tc: any) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: tc.arguments },
        })),
      } as any)

      const steps: { tool: string; label: string; args?: string }[] = []
      let videoTaskId = '' // 2026-09-06: 提取视频任务ID（不靠 AI 汇总保留 VIDEO_TASK 标记——前端从 data.videoTaskId 轮询）
      for (const tc of normCalls) {
        let args: Record<string, any> = {}
        try { args = JSON.parse(tc.arguments) } catch { args = {} }
        const stepLabel = TOOL_STEP_LABEL[tc.name] || tc.name
        let argsSum = ''
        try { const a = JSON.parse(tc.arguments || '{}'); argsSum = JSON.stringify(a).slice(0, 100) } catch {}
        steps.push({ tool: tc.name, label: stepLabel, args: argsSum })
        console.log(`[Agent] 🔧 ${tc.name}`, JSON.stringify(args).substring(0, 100))
        const result = await executeToolCall(tc.name, args, auth)
        const vtM = typeof result === 'string' ? result.match(/VIDEO_TASK:([^|]+)/) : null
        if (vtM) videoTaskId = vtM[1].trim()
        // 2026-08-13: 网页抓取失败拦截——直接如实返回失败（禁止模型用知识编造网页内容冒充抓取结果）
        if (typeof result === 'string' && (result.startsWith('CRAWL_FAIL:') || result.startsWith('CRAWL_EMPTY:') || result.startsWith('CRAWL_INVALID:'))) {
          const cwMsg = result.substring(result.indexOf(':') + 1).trim()
          return NextResponse.json({ success: true, data: {
            reply: '⚠️ ' + cwMsg + '。需要我换一个网址再试，或者用搜索（"帮我搜一下XX"）查相关内容吗？',
            intent: 'crawl_failed', toolUsed: false, scene: null, sessionId: sid || null, pointsSpent: 0,
          } })
        }
        // #2 2026-08-12: 点数不足拦截（跳过模型，直接回复 + 弹「我的套餐」）
        if (typeof result === 'string' && result.startsWith('TOOL_REJECT:')) {
          const rejMsg = result.substring('TOOL_REJECT:'.length)
          return NextResponse.json({ success: true, data: {
            reply: '⚠️ ' + rejMsg + '——已为你打开「我的套餐」页面，可在其中开通套餐或购买点卡补充点数。',
            intent: 'no_quota', toolUsed: false, scene: { type: 'open_page', path: '/my-subscription', params: {} }, sessionId: undefined || null, pointsSpent: 0,
          } })
        }
        messages.push({ role: 'tool', tool_call_id: tc.id, content: result } as any)
      }

      // Step 2: 回传结果（不再让模型二次决定调工具，直接用结果文本，避免脏标签）
      // 2026-08-31 根治: 有发布草稿时跳过 AI 汇总（状态机直接处理——AI 不自由——否则 qwen3.8 自由回复覆盖 wfEarlyReply）
      // ★VF_FLOW_V1（2026-09-18）：成片草稿也算「有草稿」——否则「确认」那一轮会多调一次 AI
      //   （虽然 wfEarlyReply 最终会覆盖它，但白花 token、还慢一拍）
      const hasDraft = PUBLISH_DRAFT.has(auth?.userId || 0) || VIDEO_DRAFT.has(auth?.userId || 0)
      let finalResult: any = null
      console.log('[chat] Step2 finalResult 状态——hasDraft=', hasDraft, '任务词=', /帮我发|帮我写|帮我做|帮我生成|帮我配|帮我搜|帮我查|帮我记录|帮我开/.test(userMessage), '模式=', (body as any)?.mode)
      // 2026-08-31 完全隔离：标准模式 + 任务词（帮我发/帮我写/帮我做/帮我生成/帮我配/帮我搜/帮我查/帮我记录/帮我开）——状态机是唯一路径——绝不 AI 兜底
      const isTaskCmd = /帮我发|帮我写|帮我做|帮我生成|帮我配|帮我搜|帮我查|帮我记录|帮我开/.test(userMessage)
      if (hasDraft || (isTaskCmd && (body as any)?.mode !== 'free' && (body as any)?.agentMode !== 'free')) {
        console.log('[chat] 任务模式——跳过 AI 汇总（状态机唯一路径——AI 不自由）')
        finalResult = ''
      } else {
        try {
          finalResult = hasImage
            ? await agnesChat(messages, [])
            : await dashscopeFunctionCall(messages as any, [], 2000, userTemperature)
        } catch (eChat) {
          console.error('[chat] AI 汇总失败（状态机兜底）:', eChat?.message || eChat)
          finalResult = ''
        }
      }
      // 2026-08-27 强制发布工作流：用户发布意图 + 本轮未调 publish_content → 代码强制补调（不依赖模型调工具，模型再也无法编“已创建/已抽帧”）
      let wfEarlyReply = ''
      let createdTaskThisTurn = false   // 2026-09-12: 本轮是否真建了发布任务（防 AI 编造） // 2026-08-27 函数级（必须在 try 外，2119 reply 处读用）
      const isFreeMode = (body as any)?.mode === 'free' || (body as any)?.agentMode === 'free' // 2026-09-06: 状态机块整体跳过（自由模式不碰任何状态机逻辑）
      // ═══════════════════════════════════════════════════════════════════════════
      // ★★★ 标准模式专属：发布状态机（规则①-⑤：选视频 → 抽帧 → 标题 → 话题 → 封面 → 点平台）★★★
      //   自由模式（mode/agentMode === 'free'）时【整块跳过】——AI 自由发挥，无状态机、无 WF_JSON 卡片
      //   本块内容：发布意图识别 / 草稿恢复与推进 / 建发布任务（createPublishTask）
      //   ★ 改动本块只影响标准模式；涉及 freeMode 的分叉只有【这一处 if】
      //   ★ 文件级拆分规划见 PROJECT.md「未来更新计划」——本块将来搬 standard-flow.ts
      // ═══════════════════════════════════════════════════════════════════════════
      if (!isFreeMode) {
      try {

        const pubIntent = /发布|发抖音|发小红书|发微博|发视频号|平台:|发到|发一条|发个视频|发一个视频|发条|帮我发|发个|直接发|快速发/.test(userMessage) && !/发我看|发我|发群里|发给你|发一份|发过去/.test(userMessage)
        console.log('[状态机] 发布意图=', pubIntent, '草稿=', PUBLISH_DRAFT.has(auth?.userId || 0), '消息=', String(userMessage).slice(0, 30))
        const calledPublish = normCalls.some((tc: any) => tc.name === 'publish_content' || tc.name === 'cancel_publish_task')
        // 2026-08-31: 块外先恢复草稿（内存丢（服务器重启）——AgentMemory 有 pub_draft 也恢复——"1"才能进状态机）
        if (!PUBLISH_DRAFT.has(auth?.userId || 0) && (/\d/.test(userMessage.trim()) || /[abc]/i.test(userMessage.trim()) || /换一批|重抽|重试|重来|用推荐|平台:|确认|选|发布|发一个视频|发一条|帮我发|^平台:|发/i.test(userMessage.trim()))) {
          try {
            const dmR = await prisma.agentMemory.findFirst({ where: { userId: String(auth?.userId || 0), tags: { contains: 'pub_draft' } }, orderBy: { updatedAt: 'desc' } })
            if (dmR?.content) { const dpR = JSON.parse(dmR.content); if (dpR?.videoName || dpR?.step) { PUBLISH_DRAFT.set(auth?.userId || 0, dpR); console.log('[状态机] 块外恢复草稿——step=', dpR.step) } }
          } catch {}
          // 2026-09-12 ★兜底：AgentMemory 也没有草稿 → 用【最近一条发布任务】重建
          //   目的：点「平台:小红书」时即使草稿丢了，也能用上次那套内容继续发到别的平台（"连续发多平台"不再依赖内存草稿）
          if (!PUBLISH_DRAFT.has(auth?.userId || 0) && /平台:/.test(String(userMessage))) {
            try {
              const lastT = await prisma.agentBrowserTask.findFirst({ where: { userId: auth?.userId || 0 }, orderBy: { id: 'desc' } })
              const lp = lastT ? parsePublishTask(String(lastT.task || '')) : null
              if (lp && lp.videoName) {
                PUBLISH_DRAFT.set(auth?.userId || 0, { step: 'full', videoName: lp.videoName, title: lp.title || '', topics: lp.topics || '', coverUrl: lp.coverUrl || '', coverFrames: lp.coverFrames || [], skips: lp.skips || [], platform: lp.platform || 'douyin' } as any)
                console.log('[状态机] 草稿丢失 → 用最近任务重建: ' + lp.videoName + ' / ' + lp.platform)
              }
            } catch (e) { console.log('[状态机] 最近任务重建失败: ' + String(e).slice(0, 80)) }
          }
        }
        // 2026-08-27 发布状态机（代码全自动——AGENT 不参与流程，只生成文案）
        // 2026-08-30: 自由模式（mode=free）→ 状态机完全跳过——AI 自己调工具发挥（测试用）
        // 2026-08-31: 状态机词（编号/换一批/重抽/重试/重来/abc/确认/用推荐）无任务 → 块外拦截（不 AI 自由）
        const stWordNoTask = !pubIntent && !PUBLISH_DRAFT.has(auth?.userId || 0) && /^\d$/.test(userMessage.trim()) || !pubIntent && !PUBLISH_DRAFT.has(auth?.userId || 0) && /换一批|重抽|重试|重来|用推荐|平台:|确认|^[abc]$/i.test(userMessage.trim())
        if (stWordNoTask) {
          wfEarlyReply = '发布流程未开始——请说「帮我发一个视频」开始任务。'
          finalResult = wfEarlyReply
          console.log('[状态机] 状态机词无任务——拦截（不 AI 自由）')
        } else if (pubIntent || PUBLISH_DRAFT.has(auth?.userId || 0)) {
          // 2026-08-27 发布工作流（多轮确认，草稿 Map 持久）——①抽帧选帧 → ②标题 → ③话题 → ④封面 → ⑤确认发布
          try {
            const uidW = auth?.userId || 0
            let draftW = PUBLISH_DRAFT.get(uidW)
            // 2026-08-31: 草稿持久化——内存无时从 AgentMemory 读（刷新/重启不丢）
            if (!draftW) {
              try {
                const dm = await prisma.agentMemory.findFirst({ where: { userId: String(uidW), tags: { contains: 'pub_draft' } }, orderBy: { updatedAt: 'desc' } })
                if (dm?.content) { try { draftW = JSON.parse(dm.content); PUBLISH_DRAFT.set(uidW, draftW) } catch {} }
              } catch {}
            }
            // 2026-08-31: 新发布指令（发一条/发布/发视频/发个——非"继续/重试/重来"）→ 重置旧草稿（重新开始——防旧草稿 step 错位 → AI 自由）
            if (draftW && /发一条|发布|发视频|发个|发到|帮我发/.test(userMessage) && !/继续|重试|重来/.test(userMessage)) {
              PUBLISH_DRAFT.delete(uidW)
              prisma.agentMemory.deleteMany({ where: { userId: String(uidW), tags: { contains: 'pub_draft' } } }).catch(() => {})
              draftW = undefined
              console.log('[状态机] 新发布指令——重置旧草稿（重新开始）')
            }
            const vfMatchW = userMessage.match(/([A-Za-z0-9_-]+\.(?:mp4|mov|avi|mkv|webm))/i)
            const vfNameW = vfMatchW ? vfMatchW[1] : ''
            // 2026-08-30: 快速发布通道——用户“直接发/跳过/确认发布”→ 抽帧看画面→自动标题→直接建任务（跳过中间确认）
            let quickPub = /(直接发|跳过|直接发布|确认发布|发吧|别问|不用选|直接吧|^c$|全默认|确认|发这条|就这个|发布它|默认发|随便发)/i.test(userMessage.trim())
            if (quickPub && !vfNameW) {
              // 无视频名时自动取仓库最新视频（C 全默认使用）
              try {
                const lstQ = await executeToolCall('list_personal_files', { type: 'video' }, auth).catch(() => '')
                const vq = String(lstQ || '').match(/([A-Za-z0-9_-]+\.(?:mp4|mov|avi|mkv|webm))/i)
                if (vq) { ((global as any).__quickVideoByUid = (global as any).__quickVideoByUid || {})[auth?.userId || 0] = vq[1] }
              } catch {}
            }
            const quickVideoUid = ((global as any).__quickVideoByUid || {})[auth?.userId || 0] || ''
            const pubRoot = fs.existsSync(path.join(process.cwd(), '.next', 'standalone', 'public')) ? path.join(process.cwd(), '.next', 'standalone', 'public') : path.join(process.cwd(), 'public')
            if (quickPub && (vfNameW || quickVideoUid)) {
              const vfNameW2 = vfNameW || quickVideoUid
              delete (global as any).__quickVideoByUid?.[auth?.userId || 0]
              try {
                const frQ = await executeToolCall('extract_video_frames', { videoName: vfNameW2 }, auth).catch((e: any) => '')
                const frTxtQ = String(frQ)
                let visQ = ''
                if (frTxtQ.startsWith('FRAMES_OK:')) { try { visQ = (JSON.parse(frTxtQ.slice(10))?.visualDesc || '') } catch {} }
                let titleQ = vfNameW2.replace(/\.mp4$/, '')
                if (visQ) {
                  const cpQ = await executeToolCall('generate_copy', { theme: visQ.slice(0, 300), style: '严格基于视频画面写标题——不得编造', count: 1 }, auth).catch(() => '')
                  if (cpQ && !String(cpQ).startsWith('ERROR')) titleQ = String(cpQ).slice(0, 60)
                }
                let fileUrlsQ: string[] = []
                try {
                  const vCands = [path.join(pubRoot, 'storage', String(auth?.userId || 0), vfNameW2), path.join(pubRoot, 'generated', vfNameW2), path.join(pubRoot, vfNameW2)]
                  const vFpQ = vCands.find((fp: string) => fs.existsSync(fp))
                  if (vFpQ) {
                    const vKeyQ = 'storage/' + auth?.userId + '/pub_' + Date.now() + '_' + vfNameW2
                    await putObject(vKeyQ, fs.readFileSync(vFpQ), 'video/mp4')
                    fileUrlsQ.push('https://ai-niuma.cc/api/storage/file?name=' + vKeyQ.replace('storage/' + auth?.userId + '/', '') + '&persist=1')
                  }
                } catch {}
                const buTaskQ = 'https://creator.douyin.com/creator-micro/content/upload' + String.fromCharCode(10) + '1. 导航到上面的 URL（地址栏只输 URL）' + String.fromCharCode(10) + '2. 上传视频文件（files 提供的路径）' + String.fromCharCode(10) + '3. 标题栏填入：' + titleQ + String.fromCharCode(10) + '4. 点发布'
                const buTQ = await buCreate(auth?.userId || 0, buTaskQ, JSON.stringify(fileUrlsQ))
                wfEarlyReply = '已创建 AI 浏览器发布任务（#' + (buTQ.seq ?? buTQ.id) + '）——客户端自动执行：打开抖音→上传→标题「' + titleQ.slice(0, 40) + '」→发布。'
                PUBLISH_DRAFT.delete(uidW)
              } catch (eQp) { console.error('[快速发布] 异常:', eQp?.message || eQp); wfEarlyReply = '快速发布失败：' + String(eQp?.message || eQp).slice(0, 100) }
            }
            // 2026-08-31: 重试/重来——测试卡住时（'重来'重置回①/'重试'当前步）
            if (/重来|重新开始|从头/.test(userMessage)) {
              PUBLISH_DRAFT.delete(uidW)
              prisma.agentMemory.deleteMany({ where: { userId: String(uidW), tags: { contains: 'pub_draft' } } }).catch(() => {})
              wfEarlyReply = '已重置发布流程——请重新说「发布一条视频」或选视频。'
            } else if (/重试|再来一次|重新试/.test(userMessage)) {
              if (draftW?.step === 'frame' && draftW?.videoName) {
                const frR = await executeToolCall('extract_video_frames', { videoName: draftW.videoName }, auth).catch(() => '')
                if (String(frR).startsWith('FRAMES_OK:')) { try { const pR = JSON.parse(String(frR).slice(10)); draftW.frames = Array.isArray(pR.frames) ? pR.frames : []; draftW.visualDesc = pR.visualDesc || ''; wfEarlyReply = '已重试抽帧——' + draftW.frames.map((f: any, i: number) => '![' + (i + 1) + '](' + String(typeof f === 'string' ? f : (f?.url || '')).trim() + ')  ').join('') + '回复编号选帧。' } catch {} }
                else wfEarlyReply = '重试抽帧失败——请回「重来」重置。'
              } else wfEarlyReply = '重试当前步——' + (draftW?.step === 'abc' ? '回复 A/B/C 继续。' : draftW?.step === 'title' ? '回复编号选标题。' : '回复「重来」重置或继续操作。')
            } else if (/取消发布|不发了|放弃/.test(userMessage)) {
              PUBLISH_DRAFT.delete(uidW)

              wfEarlyReply = '已取消发布草稿。'
            } else if (!draftW && /^\d$/.test(userMessage.trim()) || !draftW && /换一批|重抽|重试|重来|用推荐|平台:|确认|^[abc]$/i.test(userMessage.trim())) {
              // 2026-08-31: 状态机词无草稿——拦截（AI 不自由吐帧图/文案）
              wfEarlyReply = '发布流程未开始——请说「发布一条视频」或选视频。'
            } else if (!draftW) {
              // ① 无草稿：抽帧看视频
              if (!vfNameW) {
                // 2026-08-30: 无视频名 → 列仓库视频让用户选（不再 publish_content 废弃提示）
                const lstR = await executeToolCall('list_personal_files', { type: 'video' }, auth).catch(() => '')
                const lstTxt = String(lstR || '')
                const vids = Array.from(new Set((lstTxt.match(/([A-Za-z0-9_-]+\.(?:mp4|mov|avi|mkv|webm))/gi) || []))).slice(0, 5)
                wfEarlyReply = vids.length
                  // 2026-08-31 v2: 列视频返回 JSON（前端卡片渲染）+ 思维链
                  ? 'WF_JSON:' + JSON.stringify({ step: 'select_video', videos: vids.map((v: string) => ({ name: v, url: '/api/storage/file?userId=' + (auth?.userId || 0) + '&name=' + v })), hint: '选视频：回复编号/文件名，或 C 全默认直接发（勾掉自定义=平台默认）' })
                  : '仓库暂无视频——请先上传视频（个人仓库），或提供视频文件名（如“发布 xx.mp4 到抖音”）。'
                PUBLISH_DRAFT.set(uidW, { step: 'pick', wf2: { step: 'select_video', chain: [{ t: 'select_video', at: new Date().toISOString() }] } })
                // 2026-08-31: 持久化改 await（原 .then 异步——"1"下一请求时可能没写完→恢复失败→落纯聊天"繁忙"）
                try {
                  const em0 = await prisma.agentMemory.findFirst({ where: { userId: String(uidW), tags: { contains: 'pub_draft' } } })
                  const dContent0 = JSON.stringify({ videoName: vfNameW, step: 'pick', wf2: { step: 'select_video' } })
                  if (em0) await prisma.agentMemory.update({ where: { id: em0.id }, data: { content: dContent0 } })
                  else await prisma.agentMemory.create({ data: { userId: String(uidW), content: dContent0, tags: 'pub_draft', salience: 0.5 } })
                } catch {}
              } else {
                console.log('[发布工作流] ①抽帧:', vfNameW)
                const frW = await executeToolCall('extract_video_frames', { videoName: vfNameW }, auth).catch((e: any) => '抽帧失败: ' + (e.message || e))
                const frTxtW = String(frW)
                if (!frTxtW.startsWith('FRAMES_OK:')) {
                  // 2026-08-27: 抽帧失败显示原因（不再“发布未进入工作流”误导）
                  wfEarlyReply = '① 抽帧失败：' + frTxtW.slice(0, 150) + '。请检查视频文件/服务器 ffmpeg/仓库访问。'
                } else {
                const frJsonW = frTxtW.slice(10)
                let frParsedW: any = {}
                try { frParsedW = JSON.parse(frJsonW) } catch {}
                const framesW = Array.isArray(frParsedW.frames) ? frParsedW.frames : []
                PUBLISH_DRAFT.set(uidW, { videoName: vfNameW, frames: framesW, visualDesc: frParsedW.visualDesc || '', step: 'abc' })
                wfEarlyReply = `① 视频确认：${vfNameW}（个人仓库 storage/${uidW}/）——封面/标题/标签，你选哪种？
A. 我推荐（抽帧选封面 + 推荐标题/标签）
B. 用你自己的文案（发我标题+正文+标签）
C. 全默认直接发（平台智能封面 + 自动标题——跳过所有选择）
回复 A / B / C（C 直接发，A 走完整流程）`
                }
              }
            } else if (draftW.step === 'pick') {
              console.log('[状态机] 分支进入 pick——消息=', String(userMessage).slice(0, 10), '草稿step=', (draftW as any)?.step, 'frames=', (draftW as any)?.frames?.length || 0)
              const pickM = userMessage.trim().match(/^([1-5])$/)
              if (pickM) {
                try {
                  const lstP = await executeToolCall('list_personal_files', { type: 'video' }, auth).catch(() => '')
                  const vidsP = (String(lstP || '').match(/([A-Za-z0-9_-]+\.(?:mp4|mov|avi|mkv|webm))/gi) || [])
                  const vPick = vidsP[Number(pickM[1]) - 1]
                  if (vPick) {
                    // 2026-09-01 新方法: 选视频后一次全做（抽帧→标题模板→话题→封面图→WF_JSON full——完整方案）
                    draftW.videoName = vPick
                    try {
                      const frN = await executeToolCall('extract_video_frames', { videoName: vPick }, auth).catch(() => '')
                      const frNs = String(frN)
                      let framesN: any[] = []; let visN = ''
                      if (frNs.startsWith('FRAMES_OK:')) { try { const pN = JSON.parse(frNs.slice(10)); framesN = Array.isArray(pN.frames) ? pN.frames : []; visN = pN.visualDesc || '' } catch {} }
                      const nF: any[] = []
                      for (const fIt of framesN) {
                        let fpN = String(typeof fIt === 'string' ? fIt : (fIt?.url || ''))
                        try {
                          const fReln = fpN.replace('/api/frames/', '')
                          const fFpn = [path.join(pubRoot, 'frames', fReln), path.join(pubRoot, 'frames', String(auth?.userId || 0), fReln)].find((x: string) => fs.existsSync(x))
                          if (fFpn) { const fKn = 'storage/' + auth?.userId + '/frame_' + Date.now() + '_' + path.basename(fReln); await putObject(fKn, fs.readFileSync(fFpn), 'image/jpeg'); fpN = 'https://ai-niuma.cc/api/storage/file?name=' + fKn.replace('storage/' + auth?.userId + '/', '') + '&userId=' + (auth?.userId || 0) + '&persist=1' }
                        } catch {}
                        nF.push(typeof fIt === 'string' ? fpN : { ...fIt, url: fpN })
                      }
                      draftW.frames = nF; draftW.visualDesc = visN
                      const vdT = String(visN || vPick).replace(/[\s]+/g, ' ').slice(0, 40)
const kwM = vdT.match(/[“"\「『]([^”"\」』]{2,20})[”"\」』]/) || vdT.match(/名为[::：]?\s*([^，。；\n]{2,20})/) || vdT.replace(/内容总结|主体|场景|动作|文字|总结要素|\*\*/g, '').match(/(AI|AR|VR|短视频|营销|工具|平台|创作|展示)[^，。；\n]{0,12}/) || vdT.match(/([^，。；\n]{4,16})/)
                      const kwN = (kwM?.[1] || vdT).slice(0, 14)
                      const _tt = String(visN || '')
                      const _titleM = _tt.match(/标题[::：]?\s*([^；;\n]+)/)
                      const _topicM = _tt.match(/话题[::：]?\s*([^；;\n]+)/)
                      const _title = String(_titleM && _titleM[1] ? _titleM[1] : kwN).replace(/[【】\[\]]/g, '').slice(0, 30)
                      const titlesN = [_title]
                      const topicsN = String(_topicM && _topicM[1] ? _topicM[1] : '#短视频 #精品内容 #AI工具')
                      draftW.titles = titlesN.join('\n'); draftW.topics = topicsN
                                            let covN = ''
                      const uidC = auth?.userId || 0
                      // 2026-09-02: 封面同步（await 等生成完成——covN 生效——full 卡带封面图）
                      if (visN || kwN) {
                        const covTask = async () => {
                          try {
                            const covR = await dashscopeGenerateImageAsync((visN.slice(0, 200) + '营销封面风格，标题文字：' + kwN).trim() || '营销封面', (frameStore.get(auth?.userId || 0)?.orientation === 'landscape' ? '1280*960' : '1080*1440'))
                            if (covR && covR.taskId) {
                              const tid = covR.taskId
                              let covDone = false
                              let covWait = 0
                              while (!covDone && covWait < 570) {   // 2026-09-12 硬等：180→570s（官方不说失败就一直等）
                                covWait += 10
                                await new Promise((r) => setTimeout(r, 10000))
                                const qt = await fetch('https://dashscope.aliyuncs.com/api/v1/tasks/' + tid, { headers: { Authorization: 'Bearer ' + process.env.DASHSCOPE_API_KEY }, signal: AbortSignal.timeout(20000) }).then((r) => r.json()).catch(() => null)
                                if (qt && qt.output && qt.output.task_status === 'SUCCEEDED') {
                                  const u = qt.output.choices && qt.output.choices[0] && qt.output.choices[0].message && qt.output.choices[0].message.content ? (qt.output.choices[0].message.content[0] ? qt.output.choices[0].message.content[0].image : '') : ''
                                  if (u) {
                                    try {
                                      const cRes = await fetch(u, { signal: AbortSignal.timeout(30000) }).catch(() => null)
                                      if (cRes && cRes.ok) {
                                        const cBuf = Buffer.from(await cRes.arrayBuffer())
                                        const cKey = 'storage/' + uidC + '/cover_' + Date.now() + '.jpg'
                                        await putObject(cKey, cBuf, 'image/jpeg')
                                        const covU = 'https://ai-niuma.cc/api/storage/file?name=' + cKey.replace('storage/' + uidC + '/', '') + '&userId=' + (uidC || 0) + '&persist=1'; covN = covU
                                        try { await prisma.mediaAsset.create({ data: { title: '封面_' + Date.now(), type: 'image', ossUrl: covU, source: 'private', category: '封面', ownerId: uidC } }).catch(() => {}) } catch {}
                                        const dm5 = await prisma.agentMemory.findFirst({ where: { userId: String(uidC), tags: { contains: 'pub_draft' } } })
                                        if (dm5) { const dp5 = JSON.parse(String(dm5.content).replace(/^发布草稿:/, '') || '{}'); if (dp5.videoName === vPick) { await prisma.agentMemory.update({ where: { id: dm5.id }, data: { content: '发布草稿:' + JSON.stringify(Object.assign({}, dp5, { coverUrl: covU })) } }).catch(() => {}) } }
                                        console.log('[封面异步] 生成完成存草稿:', cKey)
                                      }
                                    } catch (eCv2) { console.error('[封面异步] 转 OSS 异常:', (eCv2 && eCv2.message) || eCv2) }
                                  }
                                  covDone = true
                                } else if (qt && qt.output && qt.output.task_status === 'FAILED' || qt.output.task_status === 'UNKNOWN') {
                                  console.log('[封面异步] 生成 FAILED——请换一批重做:', tid)
                                  covDone = true
                                }
                              }
                            }
                          } catch (eGv2) { console.error('[封面异步] 生成异常:', (eGv2 && eGv2.message) || eGv2) }
                          if (!covN) { console.log('[封面同步] 封面轮询结束——covN 空（dashscope 180s 内未出图/失败）') }
                        }
                        await covTask()
                      }draftW.coverUrl = covN; draftW.step = 'full'
                    try { prisma.agentMemory.updateMany({ where: { userId: String(auth?.userId || 0), tags: { contains: 'pub_draft' } }, data: { content: '发布草稿:' + JSON.stringify(draftW) } }).catch(() => {}) } catch {}
                      wfEarlyReply = 'WF_JSON:' + JSON.stringify({ step: 'full', videoName: vPick, frames: nF, titles: titlesN, topics: topicsN, coverUrl: covN, hint: '发布方案一次生成完成——封面/标题/话题均做好，确认或「换一批」全重做，最后确认平台发布' })
                    } catch (eFull: any) { console.error('[状态机] 一次全做异常:', eFull?.message || eFull); wfEarlyReply = '素材生成失败——请回「重试」或「换一批」。' }
                  } else wfEarlyReply = '编号无效，回复 1-' + vidsP.length + ' 或文件名。'
                } catch (ePk: any) { console.error('[状态机] pick 分支异常:', ePk?.message || ePk); wfEarlyReply = '选视频失败（仓库读取异常）——请回复「重试」或「帮我发一个视频」重新开始。' }
              } else if (/^[A-Za-z0-9_\-一-龥 ]+\.(?:mp4|mov|avi|mkv|webm)$/i.test(userMessage.trim())) {
                draftW.videoName = userMessage.trim()
                const vPickF = userMessage.trim()
                try {
                  const frN = await executeToolCall('extract_video_frames', { videoName: vPickF }, auth).catch(() => '')
                  const frNs = String(frN)
                  let framesN: any[] = []; let visN = ''
                  if (frNs.startsWith('FRAMES_OK:')) { try { const pN = JSON.parse(frNs.slice(10)); framesN = Array.isArray(pN.frames) ? pN.frames : []; visN = pN.visualDesc || '' } catch {} }
                  const nF: any[] = []
                  for (const fIt of framesN) {
                    let fpN = String(typeof fIt === 'string' ? fIt : ((fIt || {}).url || ''))
                    try {
                      const fReln = fpN.replace('/api/frames/', '')
                      const fFpn = [path.join(pubRoot, 'frames', fReln), path.join(pubRoot, 'frames', String((auth && auth.userId) || 0), fReln)].find((x) => fs.existsSync(x))
                      if (fFpn) { const fKn = 'storage/' + (auth && auth.userId) + '/frame_' + Date.now() + '_' + path.basename(fReln); await putObject(fKn, fs.readFileSync(fFpn), 'image/jpeg'); fpN = 'https://ai-niuma.cc/api/storage/file?name=' + fKn.replace('storage/' + (auth && auth.userId) + '/', '') + '&userId=' + ((auth && auth.userId) || 0) + '&persist=1' }
                    } catch {}
                    nF.push(typeof fIt === 'string' ? fpN : Object.assign({}, fIt as any, { url: fpN }))
                  }
                  draftW.frames = nF; draftW.visualDesc = visN
                  const vdT2 = String(visN || vPickF).replace(/\s+/g, ' ').slice(0, 40)
                  const kwM2 = vdT2.match(/[“"「『]([^”"」』]{2,20})[”"」』]/) || vdT2.match(/(?:展示了一个名为|名为|是同一个|是一款|是一个)[::：]?\s*([^，。；]{2,20})/) || vdT2.match(/([^，。；]{4,16})/)
                  const kwN2 = (kwM2 && kwM2[1] ? kwM2[1] : vdT2).slice(0, 14)
                  const _tt2 = String(visN || '')
                  const _titleM2 = _tt2.match(/标题[::：]?\s*([^；;\n]+)/)
                  const _topicM2 = _tt2.match(/话题[::：]?\s*([^；;\n]+)/)
                  const _title2 = String(_titleM2 && _titleM2[1] ? _titleM2[1] : kwN2).replace(/[【】\[\]]/g, '').slice(0, 30)
                  const titlesN2 = [_title2]
                  const topicsN2 = String(_topicM2 && _topicM2[1] ? _topicM2[1] : '#短视频 #精品内容 #AI工具')
                  draftW.titles = titlesN2.join(''); draftW.topics = topicsN2
                  let covN2 = ''
                  try { const covR2 = await dashscopeGenerateImageAsync((visN.slice(0, 200) + '，营销封面风格，标题文字：' + kwN2).trim() || '营销封面', (frameStore.get(auth?.userId || 0)?.orientation === 'landscape' ? '1280*960' : '1080*1440')); if (covR2 && covR2.taskId) { const tid2 = covR2.taskId; try { let w2 = 0; while (w2 < 570) { w2 += 10; if (w2 % 60 === 0) console.log('[封面] 仍在生成中 ' + w2 + 's'); await new Promise((r) => setTimeout(r, 10000)); const qt2 = await fetch('https://dashscope.aliyuncs.com/api/v1/tasks/' + tid2, { headers: { Authorization: 'Bearer ' + process.env.DASHSCOPE_API_KEY }, signal: AbortSignal.timeout(20000) }).then((r) => r.json()).catch(() => null); if (qt2 && qt2.output && qt2.output.task_status === 'SUCCEEDED') { const u2 = qt2.output.choices && qt2.output.choices[0] && qt2.output.choices[0].message && qt2.output.choices[0].message.content ? (qt2.output.choices[0].message.content[0] ? qt2.output.choices[0].message.content[0].image : '') : ''; if (u2 && _isSafeImgUrl(String(u2))) { try { const cR2 = await fetch(u2, { signal: AbortSignal.timeout(30000) }).catch(() => null); if (cR2 && cR2.ok) { const cB2 = Buffer.from(await cR2.arrayBuffer()); const cK2 = 'storage/' + ((auth && auth.userId) || 0) + '/cover_' + Date.now() + '.jpg'; await putObject(cK2, cB2, 'image/jpeg'); const cU2 = 'https://ai-niuma.cc/api/storage/file?name=' + cK2.replace('storage/' + ((auth && auth.userId) || 0) + '/', '') + '&userId=' + ((auth && auth.userId) || 0) + '&persist=1'; covN2 = cU2; try { await prisma.mediaAsset.create({ data: { title: '封面_' + Date.now(), type: 'image', ossUrl: cU2, source: 'private', category: '封面', ownerId: (auth && auth.userId) || 0 } }).catch(() => {}) } catch {}; const dm6 = await prisma.agentMemory.findFirst({ where: { userId: String((auth && auth.userId) || 0), tags: { contains: 'pub_draft' } } }); if (dm6) { const dp6 = JSON.parse(String(dm6.content).replace(/^发布草稿:/, '') || '{}'); if (dp6.videoName === vPickF) { await prisma.agentMemory.update({ where: { id: dm6.id }, data: { content: '发布草稿:' + JSON.stringify(Object.assign({}, dp6, { coverUrl: cU2 })) } }).catch(() => {}) } } } } catch {} } break } else if (qt2 && qt2.output && qt2.output.task_status === 'FAILED' || qt2.output.task_status === 'UNKNOWN') break } } catch {} } } catch {}
                  if (!covN2) { console.log('[封面同步] 文件名分支 covN2 空（dashscope 180s 内未出图/失败）') }
                  draftW.coverUrl = covN2; draftW.step = 'full'
                  try { prisma.agentMemory.updateMany({ where: { userId: String((auth && auth.userId) || 0), tags: { contains: 'pub_draft' } }, data: { content: '发布草稿:' + JSON.stringify(draftW) } }).catch(() => {}) } catch {}
                  wfEarlyReply = 'WF_JSON:' + JSON.stringify({ step: 'full', videoName: vPickF, frames: nF, titles: titlesN2, topics: topicsN2, coverUrl: covN2, hint: '发布方案一次生成完成——确认或「换一批」全重做，最后确认平台发布' })
                } catch (eF2) { console.error('[状态机] 文件名一次全做异常:', (eF2 && eF2.message) || eF2); wfEarlyReply = '素材生成失败——请回「换一批」重做。' }
              } else if ((/^c$/i.test(userMessage.trim()) || /全默认|默认发|直接发|跳过|就这个|发布它/.test(userMessage)) && !/^(不要|先|别|不|等一下|等等)/.test(userMessage.trim())) {
                // C 全默认：直接建 AI 浏览器发布任务
                const lstC = await executeToolCall('list_personal_files', { type: 'video' }, auth).catch(() => '')
                const vqC = String(lstC || '').match(/([A-Za-z0-9_-]+\.(?:mp4|mov|avi|mkv|webm))/i)
                if (vqC) {
                  ((global as any).__quickVideoByUid = (global as any).__quickVideoByUid || {})[auth?.userId || 0] = vqC[1]
                  const qc = await executeToolCall('browser_use_execute', { task: '快速发布：' + vqC[1] + ' 到抖音（全默认）' }, auth).catch(() => '')
                  wfEarlyReply = String(qc).startsWith('BROWSER_TASK_QUEUED') ? 'C 全默认——已直接创建 AI 浏览器发布任务。' : ('C 全默认——' + String(qc).slice(0, 120))
                } else wfEarlyReply = '仓库暂无视频，请先上传。'
                PUBLISH_DRAFT.delete(uidW)
              } else wfEarlyReply = '回复编号 1-5 选视频，或 C 全默认直接发。'
              // 2026-09-01: pick 分支末尾兑底（任何路径都设回复——防块尾空）
              if (!wfEarlyReply) wfEarlyReply = '回复编号 1-5 选视频，或 C 全默认直接发。'
            } else if (draftW.step === 'plat') {
              // 平台确认：编号 → 平台（2026-09-13: 从 platforms.ts 动态生成，原来只写 4 个、漏视频号/快手）
              const platMap2: Record<string, string> = Object.fromEntries(PLATFORM_NAMES.map((nm, i) => [String(i + 1), PLATFORM_KEY[nm]]))
              const pk = userMessage.trim()
              if (platMap2[pk]) { draftW.platform = platMap2[pk]; draftW.step = 'abc'; wfEarlyReply = '已选平台（' + ({ douyin: '抖音', xiaohongshu: '小红书', weibo: '微博', bilibili: 'B站' } as Record<string, string>)[draftW.platform] + '）——A 我推荐 / B 你的文案 / C 全默认（回复 A/B/C）' }
              else wfEarlyReply = '回复编号选择平台：' + PLATFORM_NAMES.map((nm, i) => (i + 1) + ' ' + nm).join(' / ') + '。'
            } else if (draftW.step === 'abc') {
              if (/^c$/i.test(userMessage.trim()) || /全默认|默认发|直接发|跳过/.test(userMessage)) {
                ((global as any).__quickVideoByUid = (global as any).__quickVideoByUid || {})[auth?.userId || 0] = draftW.videoName || ''
                // 2026-08-31: 视频转 OSS → files 传 URL（之前没传——AI 无法上传）
                let fileUrlsA: string[] = []
                try {
                  const vCandsA = [path.join(pubRoot, 'storage', String(auth?.userId || 0), String(draftW.videoName || '')), path.join(pubRoot, 'generated', String(draftW.videoName || '')), path.join(pubRoot, String(draftW.videoName || ''))]
                  const vFpA = vCandsA.find((fp: string) => fs.existsSync(fp))
                  if (vFpA) {
                    const vKeyA = 'storage/' + auth?.userId + '/pub_' + Date.now() + '_' + (draftW.videoName || '')
                    await putObject(vKeyA, fs.readFileSync(vFpA), 'video/mp4')
                    fileUrlsA.push('https://ai-niuma.cc/api/storage/file?name=' + vKeyA.replace('storage/' + auth?.userId + '/', '') + '&persist=1')
                  }
                } catch {}
                const q2 = await executeToolCall('browser_use_execute', { task: '快速发布：' + (draftW.videoName || '') + ' 到抖音（全默认）', files: fileUrlsA }, auth).catch(() => '')
                wfEarlyReply = String(q2).startsWith('BROWSER_TASK_QUEUED') ? 'C 全默认——已直接创建 AI 浏览器发布任务，客户端自动执行。' : ('C 全默认——' + String(q2).slice(0, 120))
                PUBLISH_DRAFT.delete(uidW)
              } else if (/^b$/i.test(userMessage.trim()) || /自己/.test(userMessage)) {
                draftW.step = 'usercopy'
                wfEarlyReply = 'B 收到——把你的标题+正文+标签发我（一次发全），我直接建任务。'
              } else {
                // 2026-08-31: A=完整流程——frames 空时自动抽帧显示切片（不再只提示"换一批"）
                if (!draftW.frames?.length && draftW.videoName) {
                  const frA = await executeToolCall('extract_video_frames', { videoName: draftW.videoName }, auth).catch((e: any) => '')
                  const frA2 = String(frA)
                  if (frA2.startsWith('FRAMES_OK:')) {
                    try { const pA = JSON.parse(frA2.slice(10)); draftW.frames = Array.isArray(pA.frames) ? pA.frames : []; draftW.visualDesc = pA.visualDesc || '' } catch {}
                  }
                }
                if (draftW.frames?.length) {
                  draftW.step = 'frame'
                  // 2026-08-31: prep 分支内直接持久化（选帧"1"时草稿必在 frame 步——不再因持久化失败 AI 自由）
                  try { prisma.agentMemory.updateMany({ where: { userId: String(auth?.userId || 0), tags: { contains: 'pub_draft' } }, data: { content: '发布草稿:' + JSON.stringify(draftW) } }).catch(() => {}) } catch {}
                  // 2026-08-31: prep 前统一转 OSS（无论新旧 frames——帧图放个人仓库——链接保险）
                  const newFrames: any[] = []
                  for (const frIt of (draftW.frames || [])) {
                    let fp = String(typeof frIt === 'string' ? frIt : (frIt?.url || ''))
                    try {
                      const fRel = fp.replace('/api/frames/', '')
                      const fCand = [path.join(pubRoot, 'frames', fRel), path.join(pubRoot, 'frames', String(auth?.userId || 0), fRel), path.join(pubRoot, fRel)]
                      const fFp = fCand.find((x: string) => fs.existsSync(x))
                      if (fFp) {
                        const fKey = 'storage/' + auth?.userId + '/frame_' + Date.now() + '_' + path.basename(fRel)
                        await putObject(fKey, fs.readFileSync(fFp), 'image/jpeg')
                        fp = 'https://ai-niuma.cc/api/storage/file?name=' + fKey.replace('storage/' + auth?.userId + '/', '') + '&persist=1'
                        console.log('[prep] 帧转 OSS:', fKey)
                      }
                    } catch {}
                    newFrames.push(typeof frIt === 'string' ? fp : { ...frIt, url: fp })
                  }
                  draftW.frames = newFrames
                  // 2026-08-31 A: prep 步 WF_JSON（切片数据——前端渲染+面板亮①）
                  wfEarlyReply = 'WF_JSON:' + JSON.stringify({ step: 'prep', frames: draftW.frames.map((f: any, i: number) => ({ name: String(typeof f === 'string' ? f : (f?.url || '')), url: String(typeof f === 'string' ? f : (f?.url || '')).trim().startsWith('/') ? 'https://ai-niuma.cc' + String(typeof f === 'string' ? f : (f?.url || '')).trim() : String(typeof f === 'string' ? f : (f?.url || '')).trim() })), hint: 'A 推荐——已抽帧，选封面帧（点击切片选——回复编号 1-' + draftW.frames.length + ' 或换一批）' })
                }
                else { draftW.step = 'frame'; wfEarlyReply = 'A 推荐——抽帧失败，请回复“换一批”重试。' }
              }
            } else if (draftW.step === 'usercopy') {
              ((global as any).__quickVideoByUid = (global as any).__quickVideoByUid || {})[auth?.userId || 0] = draftW.videoName || ''
              // 2026-08-31: 视频转 OSS → files
              let fileUrlsB: string[] = []
              try {
                const vCandsB = [path.join(pubRoot, 'storage', String(auth?.userId || 0), String(draftW.videoName || '')), path.join(pubRoot, 'generated', String(draftW.videoName || '')), path.join(pubRoot, String(draftW.videoName || ''))]
                const vFpB = vCandsB.find((fp: string) => fs.existsSync(fp))
                if (vFpB) {
                  const vKeyB = 'storage/' + auth?.userId + '/pub_' + Date.now() + '_' + (draftW.videoName || '')
                  await putObject(vKeyB, fs.readFileSync(vFpB), 'video/mp4')
                  fileUrlsB.push('https://ai-niuma.cc/api/storage/file?name=' + vKeyB.replace('storage/' + auth?.userId + '/', '') + '&persist=1')
                }
              } catch {}
              const q3 = await executeToolCall('browser_use_execute', { task: '发布视频 ' + (draftW.videoName || '') + ' 到抖音，标题/正文：' + userMessage.slice(0, 100) + '（全默认封面）', files: fileUrlsB }, auth).catch(() => '')
              wfEarlyReply = String(q3).startsWith('BROWSER_TASK_QUEUED') ? 'B 收到——已创建 AI 浏览器发布任务（含你的文案）。' : ('建任务失败：' + String(q3).slice(0, 120))
              PUBLISH_DRAFT.delete(uidW)
            } else if (draftW.step === 'frame') {
              // 用户选帧 / 换一批重抽
              if (/换一批|重抽/.test(userMessage)) {
                const frW2 = await executeToolCall('extract_video_frames', { videoName: draftW.videoName }, auth).catch((e: any) => '抽帧失败: ' + (e.message || e))
                const frTxt2 = String(frW2)
                if (frTxt2.startsWith('FRAMES_OK:')) {
                  try { const p2 = JSON.parse(frTxt2.slice(10)); draftW.frames = Array.isArray(p2.frames) ? p2.frames : []; draftW.visualDesc = p2.visualDesc || '' } catch {}
                  // 2026-08-31: 换一批也转 OSS（帧图保险——不再 /api/frames/）
                  const nF2: any[] = []
                  for (const fr2 of (draftW.frames || [])) {
                    let fp2 = String(typeof fr2 === 'string' ? fr2 : (fr2?.url || ''))
                    try {
                      const fRel2 = fp2.replace('/api/frames/', '')
                      const fFp2 = [path.join(pubRoot, 'frames', fRel2), path.join(pubRoot, 'frames', String(auth?.userId || 0), fRel2)].find((x: string) => fs.existsSync(x))
                      if (fFp2) { const fK2 = 'storage/' + auth?.userId + '/frame_' + Date.now() + '_' + path.basename(fRel2); await putObject(fK2, fs.readFileSync(fFp2), 'image/jpeg'); fp2 = 'https://ai-niuma.cc/api/storage/file?name=' + fK2.replace('storage/' + auth?.userId + '/', '') + '&persist=1' }
                    } catch {}
                    nF2.push(typeof fr2 === 'string' ? fp2 : { ...fr2, url: fp2 })
                  }
                  draftW.frames = nF2
                  wfEarlyReply = 'WF_JSON:' + JSON.stringify({ step: 'prep', frames: draftW.frames.map((f: any, i: number) => ({ name: String(typeof f === 'string' ? f : (f?.url || '')), url: String(typeof f === 'string' ? f : (f?.url || '')).trim() })), hint: '已重新抽帧——选封面帧（回复编号 1-' + (draftW.frames?.length || 4) + '）' })
                } else wfEarlyReply = '重抽失败，请重试。'
              } else {
              const pickW = userMessage.trim().match(/^([1-4])$/);
              if (pickW && draftW.frames && draftW.frames[Number(pickW[1]) - 1]) {
                draftW.selectedFrame = draftW.frames[Number(pickW[1]) - 1]
                draftW.step = 'title'
                // ② 推荐 3 标题（基于 visualDesc）
                // 2026-08-30: 画面分析空 → 不编标题（防 AI 凭文件名睡编）
                if (!draftW.visualDesc) {
                  wfEarlyReply = '② 画面分析失败（visualDesc 空）——请回复“重新分析”重抽帧，或换个视频。'
                  PUBLISH_DRAFT.delete(uidW)
                } else {
                  // 2026-09-01: 标题用画面关键词模板（不调 generate_copy——AI 会编——跟视频无关）
                  const vdTxt = String(draftW.visualDesc || draftW.videoName || '视频').replace(/[\s]+/g, ' ').slice(0, 40)
                  const kwMatch = vdTxt.match(/(?:展示|演示|是一个|呈现|画面)[:：]?\s*([^，。；\n]{2,20})/) || vdTxt.match(/([^，。；\n]{4,16})/)
                  // ★TITLE16_V1（2026-09-13 用户要求）：标题统一 16 字（必须达到，不能只写几个字）
                  //   原来 kw 最长 14 字 + 后缀 → 长度不定、还会很短；还有「【文案N】」前缀不是纯标题
                  const kw = (kwMatch?.[1] || vdTxt).replace(/^[\s:：]+|[\s:：]+$/g, '').slice(0, 6)
                  const _k = kw || '这条视频'
                  const _mk16 = (s: string) => { const x = String(s).replace(/\s+/g, ''); return x.length > 16 ? x.slice(0, 16) : x }
                  // ★TITLE16_V2：前缀改「1. 」——「【文案1】」占 5 字会让真标题只剩 11 字
                  const titlesW = '1. ' + _mk16(_k + '——3秒看懂核心内容') + '\n2. ' + _mk16(_k + '，原来还能这样用真的绝') + '\n3. ' + _mk16('揭秘' + _k + '背后的关键细节')
                }
                } else wfEarlyReply = '请回复帧编号 1-4 选帧，或“换一批”重抽。'
              }
            } else if (draftW.step === 'title') {
              const pickT = userMessage.trim().match(/^([1-3])$/)
              if (pickT) {
                // 2026-08-31: 从 titlesW 提取第 N 个标题（不再存'标题N'字面量）
                const tSegs = String(draftW.titles || '').split(/[\n\r]+/).map((s: string) => s.replace(/^\d+[.、、）)]*\s*/, '').trim()).filter((s: string) => s.length > 3)

                draftW.title = tSegs[Number(pickT[1]) - 1] || ('标题' + pickT[1])
                draftW.step = 'topics'
                draftW.topics = '#短视频技巧 #素材分享 #AI营销'
                wfEarlyReply = 'WF_JSON:' + JSON.stringify({ step: 'topics', topics: ['#短视频技巧', '#素材分享', '#AI营销'], hint: '③ 话题标签——点击选或回复“确认/换一批”' })
              } else wfEarlyReply = '请回复标题编号 1-3，或“换一批”重推。'
            } else if (draftW.step === 'topics') {
              if (/确认|可以|好|行/.test(userMessage.trim())) {
                draftW.step = 'cover'
                // 2026-08-31 v2③: ④ 真生成封面（文生图——visualDesc+标题 → 封面）——不再等 ⑤
                let covU = draftW.coverUrl || ''
                if (!covU && draftW.visualDesc) {
                  try {
                    const covR = await dashscopeGenerateImageAsync((draftW.visualDesc.slice(0, 200) + '，营销封面风格，标题文字：' + (draftW.title || '')).trim(), (frameStore.get(auth?.userId || 0)?.orientation === 'landscape' ? '1280*960' : '1080*1440')).catch(() => null)
                    if (covR?.taskId) {
                      // 2026-09-12 修：①轮询 16 秒太短（百炼生图实测 ~47 秒）→ 改 18×10s=180s
                      //            ②取值字段错（results[0].url 不存在）→ 正确为 choices[0].message.content[0].image
                      for (let pi = 0; pi < 57; pi++) {   // 18→57（×10s = 570s 硬等）
                        await new Promise((res) => setTimeout(res, 10000))
                        const qt = await fetch('https://dashscope.aliyuncs.com/api/v1/tasks/' + covR.taskId, { headers: { Authorization: 'Bearer ' + process.env.DASHSCOPE_API_KEY } }).then((r) => r.json()).catch(() => null)
                        const st2 = qt?.output?.task_status
                        if (st2 === 'SUCCEEDED') {
                          const u = qt?.output?.choices?.[0]?.message?.content?.[0]?.image
                          if (u) { covU = u; draftW.coverUrl = u; console.log('[封面] topics 分支生成成功') }
                          else console.log('[封面] SUCCEEDED 但未取到图片 URL:', JSON.stringify(qt?.output || {}).slice(0, 200))
                          break
                        }
                        if (st2 === 'FAILED' || st2 === 'UNKNOWN') { console.log('[封面] 生成 FAILED/UNKNOWN（请换一批重做）'); break }
                      }
                    }
                  } catch {}
                }
                wfEarlyReply = 'WF_JSON:' + JSON.stringify({ step: 'cover', coverUrl: covU, hint: '④ 封面已生成' + (covU ? '' : '（失败——可重试）') + '——确认或换一批' })
              } else wfEarlyReply = '请回复“确认”话题。'
            } else if (draftW.step === 'cover') {
              if (/确认|可以|好|行/.test(userMessage.trim())) {
                // 2026-08-31 v2④: ⑤ 确认发布——先吐 WF_JSON publish（报告预览——确认键）——用户确认后再建任务
                draftW.step = 'publish'
                wfEarlyReply = 'WF_JSON:' + JSON.stringify({ step: 'publish', videoName: draftW.videoName, title: draftW.title || '', topics: draftW.topics || '', coverUrl: draftW.coverUrl || '', hint: '⑤ 确认发布到抖音——检查素材包，点「确认发布」执行' })
              } else wfEarlyReply = '请回复“确认”封面。'
            } else if (draftW.step === 'full' || /^平台:/.test(String(userMessage).trim())) {
              // 2026-09-03: 点平台按钮（"发布到X"）→ 直接建任务（视频+封面+标题+话题全打包——不再问编号）
              // ★2026-09-14 放宽条件（用户实测"点微博没反应、客户机日志任务数一直是 0"）：
              //   原来只有 draftW.step === 'full' 才建任务。但草稿恢复出来（服务端重启 → 从 AgentMemory /
              //   最近一条任务重建）的 step 可能是 pick/abc/...，此时点平台按钮会掉到最后那个 else，
              //   只回一句"回复「确认」进平台选择…" —— 表现为【点了没反应、不建任务、不打开浏览器】。
              //   现在：只要用户点平台按钮（消息形如 `平台:抖音`），不论草稿在哪一步，都直接建任务。
              const pkM = userMessage.match(/^平台:(.+)/)
              // ★素材兜底：草稿里 videoName 为空（如 step=pick 只存了选择项）时，用最近一条发布任务补齐
              if (pkM && !draftW.videoName) {
                try {
                  const lt2 = await prisma.agentBrowserTask.findFirst({ where: { userId: auth?.userId || 0 }, orderBy: { id: 'desc' } })
                  const lp2 = lt2 ? parsePublishTask(String(lt2.task || '')) : null
                  if (lp2 && lp2.videoName) {
                    draftW.videoName = lp2.videoName
                    if (!draftW.title) draftW.title = lp2.title || ''
                    if (!draftW.topics) draftW.topics = lp2.topics || ''
                    if (!draftW.coverUrl) draftW.coverUrl = lp2.coverUrl || ''
                    console.log('[状态机] 点平台——草稿素材不全，已用最近任务补齐: ' + lp2.videoName)
                  }
                } catch (eFB) { console.log('[状态机] 素材兜底失败: ' + String(eFB).slice(0, 80)) }
              }
              if (pkM && draftW.videoName) {
                const platName = pkM[1].replace(/&skip=.*$/, '').trim()
                const skM = pkM[1].match(/&skip=([^&]+)/)
                const skips = skM ? String(skM[1]).split(/[,，]/).map((s: string) => s.trim()).filter(Boolean) : []
                const platMapF: Record<string, string> = PLATFORM_KEY   // 2026-09-13: 取自 platforms.ts
                draftW.platform = platMapF[platName] || platName
                const wfA: any = { platform: draftW.platform, videoName: draftW.videoName, caption: draftW.title || (typeof draftW.titles === 'string' ? draftW.titles : (Array.isArray(draftW.titles) ? draftW.titles[0] : '')) || draftW.videoName, topics: draftW.topics, coverUrl: draftW.coverUrl || '' }
                let fileUrls: string[] = []
                // 视频已在个人仓库 OSS——直接构造 storage URL（不在服务器本地 fs，之前 fs.existsSync 找不到→没 push 视频→browser-use 只有封面没视频）
                if (wfA.videoName) { try { const vKey2 = 'storage/' + (auth?.userId || 0) + '/' + wfA.videoName; fileUrls.push(await signedUrl(vKey2, 86400)) } catch { fileUrls.push('https://ai-niuma.cc/api/storage/file?name=' + encodeURIComponent(wfA.videoName) + '&userId=' + (auth?.userId || 0) + '&persist=1') } }
                if (wfA.coverUrl && !skips.includes('封面') && !skips.includes('抽帧')) fileUrls.push(wfA.coverUrl)
                const platUrlMap: Record<string, string> = { douyin: 'https://creator.douyin.com/creator-micro/content/upload', xiaohongshu: 'https://creator.xiaohongshu.com/publish/publish', weibo: 'https://weibo.com/upload', bilibili: 'https://member.bilibili.com/platform/upload/video/frame', kuaishou: 'https://cp.kuaishou.com/creator/video/upload' }
                const pubUrl = platUrlMap[draftW.platform] || platUrlMap.douyin
                let _stp = 1
const _steps = ['用浏览器把这条视频发布到' + platName + '。页面已打开在该平台发布页（登录态在），视频与封面文件路径已给出。流程：上传视频->等转码->填标题->填话题->设置封面（按提示选方向）->点发布。']
                if (!skips.includes('标题')) _steps.push('第' + _stp++ + '步：标题框填「' + wfA.caption + '」')
                if (!skips.includes('话题')) _steps.push('第' + _stp++ + '步：话题框填「' + (wfA.topics || '') + '」')
                if (!skips.includes('封面') && !skips.includes('抽帧')) _steps.push('第' + _stp++ + '步：点「设置封面」→ 点「选择封面」（横封面4:3 或 竖封面3:4）→ 等封面弹窗出现（页面显示优质封面示例/上传封面按钮）→ 在弹窗里点「上传封面」上传封面文件(.jpg) → 点「完成」')
                _steps.push('最后：点发布按钮')
                const buTask = '发布视频到' + platName + '。\n' + _steps.join('\n')
                // 2026-09-10: 任务带结构化参数（客户端优先走确定性脚本；无脚本平台回退 browser_use）
                // 2026-09-12: ★统一入口（点平台/重发同一函数——task 格式、files 签名、编号只有一处实现）
                const buR = await createPublishTask(auth?.userId || 0, {
                  platform: draftW.platform,
                  videoName: wfA.videoName || '',
                  title: wfA.caption || '',
                  topics: wfA.topics || '',
                  coverUrl: wfA.coverUrl || '',
                  coverFrames: draftW.coverFrames || [],
                  skips,
                }, buTask)
                const buT = buR.task
                createdTaskThisTurn = true
                wfEarlyReply = 'BROWSER_TASK_QUEUED:已创建 AI 浏览器发布任务（#' + (buT.seq ?? buT.id) + '）——客户端 AI 浏览器自动执行发布到' + platName + '。\n\n💡 同一套内容还能继续发其它平台——直接点下面的平台按钮即可；要全部重做请点「换一批」。\n' + 'WF_JSON:' + JSON.stringify({ step: 'full', videoName: draftW.videoName, title: draftW.title || '', topics: draftW.topics || '', coverUrl: draftW.coverUrl || '', coverFrames: draftW.coverFrames || [], skips: draftW.skips || [], platform: draftW.platform })
                // 2026-09-12: ★不再清草稿——支持"同一套内容连续发多个平台"（之前建完任务就删草稿，导致点第二个平台提示"发布流程未开始"）
                // 仅「换一批」时重置（见下面分支）
              } else if (pkM) {
                // ★2026-09-14：草稿和最近任务都拿不到素材 → 明确提示（原来这里静默无响应）
                console.log('[状态机] 点平台但素材缺失——已明确提示用户')
                wfEarlyReply = '发布素材缺失——请先说「帮我发一个视频」生成方案，再点平台按钮。'
              } else if (/换一批|重做/.test(userMessage)) {
                PUBLISH_DRAFT.delete(uidW)
                prisma.agentMemory.deleteMany({ where: { userId: String(uidW), tags: { contains: 'pub_draft' } } }).catch(() => {})
                draftW = undefined
                wfEarlyReply = '已重置——请重新说「发一个视频」选视频重做。'
              } else wfEarlyReply = '回复「确认」进平台选择，或「换一批」全部重做。'
            }
            else if (draftW.step === 'publish') {
              if (/确认发布|确认|发|好|行/.test(userMessage.trim())) {
                const wfA: any = { platform: 'douyin', videoName: draftW.videoName, caption: draftW.title || draftW.videoName, topics: draftW.topics, coverUrl: draftW.coverUrl || '' }
                let fileUrls: string[] = []
                try {
                  const vRel = String(wfA.videoName || '')
                  const vCands = [path.join(pubRoot, 'storage', String(auth?.userId || 0), vRel), path.join(pubRoot, 'generated', vRel), path.join(pubRoot, vRel)]
                  const vFp = vCands.find((fp: string) => fs.existsSync(fp))
                  if (vFp) {
                    const vBuf = fs.readFileSync(vFp)
                    const vKey = 'storage/' + auth?.userId + '/pub_' + Date.now() + '_' + vRel
                    await putObject(vKey, vBuf, 'video/mp4')
                    fileUrls.push('https://ai-niuma.cc/api/storage/file?name=' + vKey.replace('storage/' + auth?.userId + '/', '') + '&persist=1')
                    console.log('[发布⑤] 视频已转 OSS:', vKey)
                  } else { console.log('[发布⑤] 视频本地未找到（可能已在 OSS）:', vRel) }
                } catch (ePv: any) { console.error('[发布⑤] 视频转 OSS 失败:', ePv?.message || ePv) }
                const buTask = '发布视频到' + (PLATFORM_NAME[wfA.platform] || wfA.platform || PLATFORM_NAME.douyin) + '：客户端已打开到 https://creator.douyin.com/creator-micro/content/upload （如返回登录页说明未登录，直接告知结束），上传视频，标题：' + (wfA.caption || '') + '，话题：' + (wfA.topics || '') + '，用平台智能封面，然后点击发布'
                // 2026-09-10: 任务带结构化参数（客户端优先走确定性脚本）
                const buTaskJson2 = JSON.stringify({ kind: 'publish', platform: wfA.platform || 'douyin', videoName: wfA.videoName || '', title: wfA.caption || '', topics: wfA.topics || '', cover: wfA.coverUrl || '', task: buTask })
                const buT = await buCreate(auth?.userId || 0, buTaskJson2, JSON.stringify(fileUrls))
                // 2026-08-31 v2④: 完整报告（MD——封面/标题/话题/视频——跨平台素材包）
                const reportMd = '## 发布素材包（reportId: ' + buT.id + '）' + '\n' + '- 视频：' + (wfA.videoName || '') + '\n' + '- 封面：' + (wfA.coverUrl ? '![](' + wfA.coverUrl + ')' : '平台智能封面') + '\n' + '- 标题：' + (wfA.caption || '') + '\n' + '- 话题：' + (wfA.topics || '') + '\n' + '- 平台：' + (wfA.platform || 'douyin') + '\n' + '\n' + '- 此素材包已存库——后续说「发小红书/微博」即可复用（AI 读取 reportId 直接用）'

                const wfR3 = 'BROWSER_TASK_QUEUED:已创建 AI 浏览器发布任务（#' + (buT.seq ?? buT.id) + '）——客户端 AI 浏览器自动执行。' + (fileUrls.length ? '视频已就绪。' : '') + '\n' + '\n' + reportMd
                messages.push({ role: 'tool', tool_call_id: 'wf-' + Date.now(), content: String(wfR3) } as any)
PUBLISH_DRAFT.delete(uidW)
              } else wfEarlyReply = '请回复“确认”发布。'
            }
          } catch (eWF2) { console.error('[发布工作流] 异常:', eWF2) }
        }

        // ═══════════════ 成片状态机（★VF_FLOW_V1，2026-09-18）═══════════════
        //   与发布状态机【完全独立】：独立草稿 VIDEO_DRAFT / 独立意图正则 / 独立卡片前缀 VF_JSON
        //   目的：用户说「帮我做一条视频」→ 确定性状态机接管（AI 只在 2 处出场：①润色文案 ②排分镜）
        //   最小闭环（复用现有 make.py 链路）：起稿 → 确认（文案+音色）→ 后台出片 → 进度 → 成品
        //   ⏳ 待接线（见 PROJECT.md 成片规划，按顺序）：6.5 画面来源（我的素材/AI 生成/混合）、
        //      分镜编排（AI 出场②）、卡片/主题扩充、程序化逐帧、词级字幕、首镜硬节点
        const uidVF2 = auth?.userId || 0
        // ★2026-09-19 修（用户实测：点音色被当成确认 + 点确认又回到第一步）：
        //   ① 流程词（确认/开始/生成吧/出片…）不算“新的成片指令”→ 否则会把草稿重置回第 0 步
        //   ② 草稿恢复必须放在【块外】（仿发布状态机 L1773）——否则服务器重启后内存 Map 为空，
        //      hasDraft=false 会让这一轮走 AI 自由发挥（用户看到“✅ 配音已选定…”那种话术）
        const vfFlowWord = /确认|开始|生成吧|出片|就这个|^行$|^好$|^OK$/i.test(userMessage.trim())
        const vfIntent = (/帮我做.{0,3}(一条|个|条)?视频|帮我成片|帮我做视频|本地成片|做一条视频|做个视频|做成片|做个宣传片/.test(userMessage)
          && !/发布|发到|发抖音|发小红书|发微博|发视频号|平台:/.test(userMessage)) && !vfFlowWord // 不抢发布状态机的活；流程词不算新指令
        if (!VIDEO_DRAFT.has(uidVF2)) {
          try {
            const _r0 = await loadVfDraft(uidVF2)
            if (_r0?.step) { VIDEO_DRAFT.set(uidVF2, _r0); console.log('[成片状态机] 块外恢复草稿——step=', _r0.step) }
          } catch {}
        }
        // ★VF_LOG_V1（2026-09-19）：成片入口日志（服务器侧 <storage>/<uid>/video-factory/vf_debug.log）——排查用
        vfLog(uidVF2, `[入口] msg="${String(userMessage).slice(0, 60)}" vfIntent=${vfIntent} 内存草稿=${VIDEO_DRAFT.has(uidVF2) ? '有' : '无'} 自由模式=${isFreeMode} 任务词=${isTaskCmd}`)
        // ═══════════════════════════════════════════════════════════════════════
        // ★VF_AILINE_V1（2026-09-21）【AI 制片】独立线分派（用户定案：
        //   「把现在的视频状态机**先不动**，抽你需要的做 AI 制片。不用制作牵涉太广。」）
        //   · 只有 AI 制片那套自己说"该我接管"（`shouldTakeOverAiLine`）时才进它；
        //   · 它【内部绝不 throw】（异常转成人话），所以**不会连累素材合成**；
        //   · 本分派放在成片入口之前，为的是**先分流**；下面的素材合成状态机一行没改，
        //     只是多了一个 `!vfAiHandled` —— 没接管时该标记恒为 false，行为与之前完全一致。
        //   （这次事故的教训：两条线共用一段可执行代码 → 一条坏两条全坏。这里改为"各写各的"。）
        // ═══════════════════════════════════════════════════════════════════════
        let vfAiHandled = false
        let vfMixHandled = false
        const _parseVfForm = (msg: string) => {
          const m = String(msg || '').trim().match(/^VF_FORM:(\{[\s\S]*\})/)
          try { return m ? JSON.parse(m[1]) : null } catch { return null }
        }
        try {
          // ★VF_MIXLINE_V1（2026-09-21）【素材+AI 创作】第三条独立线 —— **放在 AI 制片之前**
          //   （它的词更具体："素材+AI/混合创作"；而"素材+AI"里含"AI"，先说清归属更稳）
          const { shouldTakeOverMixLine, handleMixLine } = await import('@/lib/agent/vf/vf-mix')
          if (await shouldTakeOverMixLine(prisma, uidVF2, userMessage)) {
            vfMixHandled = true
            wfEarlyReply = await handleMixLine({
              uid: uidVF2, userMessage, auth, prisma,
              executeToolCall, generateText,
              log: (u: any, m: string) => vfLog(u, m),
              voiceList: VF_VOICE_BASE,
              listRepoMaterials, summarizeMaterials, probeMaterialSizes, downloadMaterials,
              splitScript: vfSplitScript,
              parseForm: _parseVfForm,
            })
            finalResult = wfEarlyReply
          }
        } catch (eMX: any) {
          vfMixHandled = false
          try { vfLog(uidVF2, '[VF-X] 分派异常: ' + String(eMX?.message || eMX).slice(0, 200)) } catch { /* ignore */ }
        }
        if (!vfMixHandled) {
          try {
            const { shouldTakeOverAiLine, handleAiLine } = await import('@/lib/agent/vf/vf-aivideo')
            if (await shouldTakeOverAiLine(prisma, uidVF2, userMessage)) {
              vfAiHandled = true
              wfEarlyReply = await handleAiLine({
                uid: uidVF2, userMessage, auth,
                prisma,
                executeToolCall, genVideoShots, generateText, vfScriptCard,
                log: (u: any, m: string) => vfLog(u, m),
                voiceList: VF_VOICE_BASE,
                listRepoMaterials, summarizeMaterials, probeMaterialSizes,
                splitScript: vfSplitScript,
                parseForm: _parseVfForm,
              })
              finalResult = wfEarlyReply
            }
          } catch (eAI: any) {
            // 分派本身出错也要"可见"，并且【不能】影响素材合成 → 放开这条路让它照常走
            vfAiHandled = false
            try { vfLog(uidVF2, '[VF-A] 分派异常: ' + String(eAI?.message || eAI).slice(0, 200)) } catch { /* ignore */ }
          }
        }
        if (!vfMixHandled && !vfAiHandled && (vfIntent || VIDEO_DRAFT.has(uidVF2))) {
          try {
            let vd = VIDEO_DRAFT.get(uidVF2)
            // 内存没有 → 从 AgentMemory 恢复（仿发布：服务器重启/刷新不丢）
            if (!vd) { const _r = await loadVfDraft(uidVF2); if (_r?.step) { vd = _r; VIDEO_DRAFT.set(uidVF2, vd) } }
            // 新的成片指令 → 重置旧草稿（防 step 错位 → 又跑回 AI 自由调工具）
            // ★VF_RUN_RESET_V1（2026-09-21，用户实测：上传图片模式下第二次提交回「已在后台渲染中」）：
            //   草稿停在 step='running' 时，用户【再提交一次表单】= 想再做一条 → 旧草稿必须作废，
            //   否则会落到下面 L3211 的 running 拦截（回「已在后台渲染中」，其实什么都没在渲染）。
            // ★只清 running：step='form'/'script' 时的表单提交是「改选项」，绝不能清（否则会把正在进行的流程打断）。
            const _vfIsForm = /^VF_FORM:/.test(String(userMessage || '').trim())
            // ★VF_RUN_EXPIRE_V1（2026-09-21）：第三重保险 —— running 草稿超过 30 分钟 = 早就结束的任务残留 → 直接作废。
            //   （出片是分钟级；一条片不可能 running 半小时。有了这道，即使前两条都没覆盖也不会永久卡死。）
            const _vfStale = (vd?.step === 'running') && !!vd.__savedAt && (Date.now() - Number(vd.__savedAt) > 30 * 60 * 1000)
            if (_vfStale) vfLog(uidVF2, `[草稿过期] running 草稿已停留 ${Math.round((Date.now() - Number(vd.__savedAt)) / 60000)} 分钟 → 自动作废`)
            // ★VF_FORM_CLAIM_V1（2026-09-21，用户实测「选 60 秒出成 200 秒」＋「第二条被拦」）：
            //   表单提交（VF_FORM:）撞上【不是 form/source 的孤儿草稿】时，旧行为有三种错法：
            //     · running → 回「已在后台渲染中」（其实什么都没在渲染）
            //     · script  → 落到「文案微调」分支，被当成"改文案的要求"喂给 AI（时长/上传名单全丢）
            //     · 未知    → 兜底出"素材来源卡"（参数同样丢）
            //   三种都会让"我选的时长/上传没生效" → 现在一律【作废旧草稿】并用本次表单重新起草。
            //   ★仍然只清"孤儿"：step=form/source 时的表单提交是「改选项」，绝不能清。
            const _vfOrphan = _vfIsForm && !!vd && vd.step !== 'form' && vd.step !== 'source'
            if (_vfOrphan) vfLog(uidVF2, `[草稿认领] 本次是表单提交，旧草稿 step=${vd?.step} → 作废，用本次表单重新起草`)
            if (vd && (vfIntent || _vfStale || _vfOrphan)) { VIDEO_DRAFT.delete(uidVF2); clearVfDraft(uidVF2); vd = undefined }

            // ★VF_FORM_CLAIM_V1（第二段）：草稿刚被作废、而本次正是表单提交 → 直接起一条干净草稿，
            //   交给下面 `else if (vd.step === 'form' || 'source')` 去解析本次表单并一路起草到底。
            //   不这么做就会走「第 1 步 起稿」→ 只回一张空表单卡 → 用户得再点一次，且这次填的全丢。
            if (!vd && _vfIsForm) {
              vd = { step: 'form', topic: '', voice: 'longxiaochun', theme: 'dark', aspect: 'auto', dur: 30, voiceList: VF_VOICE_BASE.slice() }
              VIDEO_DRAFT.set(uidVF2, vd)
              vfLog(uidVF2, '[草稿认领] 已按本次表单参数重新起草（不再回表单卡）')
            }

            if (!vd) {
              // ── 第 1 步 起稿（★AI 出场①：润色成口播文案，保留数字/术语，不改写）──
              // ★2026-09-19 修：先剥指令词，再剥开头的“用/请/帮我”等——原来漏剥开头“用”，
              //   只发指令不带主题时会把“用”当成主题（文案变成“用，才是最强的生产力！”）
              // ── 第 0 步 素材来源（★一键出发：不问文字，只给两个按钮；用户顺手写了主题就带过来）──
              const vfTopic0 = String(userMessage)
                .replace(/本地成片|模板成片|帮我做.{0,3}(一条|个|条)?视频|帮我成片|帮我做视频|做一条视频|做个视频|做成片|做个宣传片|做视频/g, '')
                .replace(/^(用|请用|请|来|帮我|帮忙|给我|麻烦)\s*/, '')
                .replace(/^(用|请|来)\s*/, '')
                .replace(/^[\s:：,，,。、]+/, '').trim()
              // ★VF_TOPIC_GUARD_V1（2026-09-21）：协议串绝不能当主题（与 2026-09-20 那次
              //   "主题被写成 VF_FORM:{...} 原文" 是同一类事故）—— 起稿这条路也要挡。
              const _vfTopic0Clean = (/^(VF_FORM|VF_JSON|MAKE_VIDEO|BROWSER_TASK|FRAMES_OK|TOOL_REJECT|VIDEO_RESULT)/i.test(vfTopic0)
                || vfTopic0.startsWith('{') || vfTopic0.startsWith('[')) ? '' : vfTopic0
              vd = { step: 'form', topic: _vfTopic0Clean, voice: 'longxiaochun', theme: 'dark', aspect: 'auto', dur: 30 }
              VIDEO_DRAFT.set(uidVF2, vd)
              await saveVfDraft(uidVF2, vd)
              // ★VF_FORM_V1（2026-09-20，用户要求）：改成【一张表单、一次提交】——
              //   老流程“点一个返回一次”要 3~4 轮（用户原话：“感觉有点怪”）；
              //   现在表单一次选完（含默认值，什么都不改也能直接点开始）
              // ★VF_VOICE_V1（2026-09-20）：音色列表 = 百炼官方音色 + 我的克隆音色
              //   原来写死的 3 个里「龙嫗/longyuan」并不在官方列表（可能无效），改为官方 7 个
              const _vcM = await prisma.agentMemory.findFirst({ where: { userId: String(uidVF2), tags: { contains: 'voice_clone' } }, orderBy: { updatedAt: 'desc' } }).catch(() => null)
              const _vList: any[] = VF_VOICE_BASE.slice()
              try {
                const _vc = _vcM?.content ? JSON.parse(String(_vcM.content).replace(/^声音克隆:/, '')) : null
                if (_vc?.id) _vList.push({ id: String(_vc.id), name: '🎙 ' + String(_vc.name || '我的克隆音色') + '（克隆）' })
              } catch {}
              vd.voiceList = _vList   // ★存进草稿：文案卡/换音色卡都用同一份，不再各写一份
              wfEarlyReply = 'VF_JSON:' + JSON.stringify({
                step: 'form', topic: _vfTopic0Clean, aspect: 'auto', dur: 30, voice: 'longxiaochun',
                voices: _vList,
                hint: '选好点「🚀 开始出片」（都有默认值，不改也能直接开始）',
              })
              finalResult = wfEarlyReply
              console.log('[成片状态机] 素材来源——topic=', _vfTopic0Clean.slice(0, 20))
            } else if (vd.step === 'form' || vd.step === 'source') {
              // ── 用户选了【画面来源】→ 素材合成 / 素材+AI 混合 / 全部 AI / 上传 ──
              // ★VF_FORM_V1：表单一次性提交（前端发 VF_FORM:{aspect,dur,source,voice,topic}）
              const _mForm = userMessage.trim().match(/^VF_FORM:(\{[\s\S]*\})/)
              if (_mForm) {
                try {
                  const f = JSON.parse(_mForm[1]) || {}
                  if (f.aspect) vd.aspect = String(f.aspect)
                  if (f.dur) vd.dur = Math.max(5, Math.min(900, parseInt(f.dur) || 30))
                  // ★VF_THEME_UI_V1（2026-09-20）：画面风格（dark / tech / light）—— 之前表单没暴露，只能默认 dark
                  //   ★白名单校验：make.py 的 --theme 是 choices=[dark,light,tech]，传别的值 argparse 会直接报错
                  if (f.theme) vd.theme = ['dark', 'tech', 'light'].includes(String(f.theme)) ? String(f.theme) : 'dark'
                  if (f.voice) vd.voice = String(f.voice)
                  if (typeof f.topic === 'string' && f.topic.trim()) vd.topic = f.topic.trim().slice(0, 300)
                  if (f.script && String(f.script).trim()) vd.formScript = String(f.script).trim().slice(0, 4000) // 用户直接贴了文案
                  if (f.source) vd.formSource = String(f.source)   // ★表单选的画面来源（repo/upload/mix/ai）——下面分支要按它走
                  if (f.bgm !== undefined) vd.bgm = (String(f.bgm) === 'auto') ? 'auto' : ''
                  // ★VF_UPLOAD_V2（2026-09-20，用户实测“上传 8 张却用了旧图”）：前端把**刚上传的文件名列表**
                  //   一起发过来 → 后端按名字精确取，不再靠“按时间猜最近”。确定性优先。
                  if (Array.isArray(f.uploaded)) vd.uploaded = f.uploaded.map((x: any) => String(x)).slice(0, 60)
                  vfLog(uidVF2, `[表单] aspect=${vd.aspect} dur=${vd.dur} voice=${vd.voice} source=${f.source || 'repo'} topic="${String(vd.topic).slice(0, 30)}"`)
                } catch (e: any) { vfLog(uidVF2, '[表单解析失败] ' + String(e?.message || e).slice(0, 120)) }
              }
              // ★2026-09-20 修：表单发的是英文 id（repo/upload/mix/ai），老分支只认中文词
              //   → 在表单里选“我上传”会被当成“素材合成”（走错路）。这里把 formSource 一起纳入判断。
              const vfPickAI = (vd.formSource === 'ai') || /全部\s*AI|全\s*AI|纯\s*AI|AI\s*生成|AI\s*制作/.test(userMessage)
              const vfPickMix = (vd.formSource === 'mix') || /混合|素材\s*\+\s*AI|素材加\s*AI/.test(userMessage)
              // ★VF_DUR_V1（2026-09-20，用户要求）：时长可设（30/60/90/180 或自定义秒数）
              //   为什么必须让 AI 知道时长：它不知道时长 → 不知道文案写多长、排几镜
              //   （用户实测：要 30 秒却只出 14 秒，因为 AI 只写了 ~60 字）
              const _mDur = userMessage.trim().match(/^时长\s*(\d{1,4})/)
              if (_mDur) {
                vd.dur = Math.min(900, Math.max(5, parseInt(_mDur[1]) || 30))
                VIDEO_DRAFT.set(uidVF2, vd); await saveVfDraft(uidVF2, vd)
                vfLog(uidVF2, `[时长] 用户设 ${vd.dur}s（文案约 ${Math.round(vd.dur * 4.5)} 字）`)
                wfEarlyReply = 'VF_JSON:' + JSON.stringify({ step: 'source', topic: vd.topic || '', aspect: vd.aspect || 'auto', dur: vd.dur,
                  hint: `时长已设为 ${vd.dur} 秒（AI 会按约 ${Math.round(vd.dur * 4.5)} 字写文案）——现在点【🎞 素材合成】开始出片` })
                finalResult = wfEarlyReply
              } else if (/^竖屏|^横屏|^自动/.test(userMessage.trim())) {
                vd.aspect = /竖屏/.test(userMessage) ? 'portrait' : (/横屏/.test(userMessage) ? 'landscape' : 'auto')
                VIDEO_DRAFT.set(uidVF2, vd); await saveVfDraft(uidVF2, vd)
                const _asName = vd.aspect === 'portrait' ? '竖屏 9:16' : (vd.aspect === 'landscape' ? '横屏 16:9' : '自动（按素材判断）')
                vfLog(uidVF2, `[画幅] 用户选了 ${vd.aspect}`)
                wfEarlyReply = 'VF_JSON:' + JSON.stringify({
                  step: 'source', topic: vd.topic || '', aspect: vd.aspect,
                  dur: vd.dur || 30,
                  hint: `画幅已设为「${_asName}」——现在点【🎞 素材合成】开始出片`,
                })
                finalResult = wfEarlyReply
              } else if (vfPickMix) {
                // ★VF_SRC_SPLIT_V1（2026-09-21，用户定案）：本卡的「素材+AI 混合」按钮**已拆掉** ——
                //   混合是【独立的一条线】（`src/lib/agent/vf/vf-mix.ts`，入口词「素材+AI创作做一条视频」）。
                //   这里只作为【老前端 / 历史消息】的兜底：不再说"开发中"（那是假话），改为指路，
                //   并且**不改草稿**（原实现会写 vd.mode='mix' 存库，纯属污染）。
                vfLog(uidVF2, '[画面来源] mix（老入口）→ 已指路到混合线')
                wfEarlyReply = '「素材+AI 混合」现在是**独立的一条线**：直接说「素材+AI创作做一条视频」就行（AI 只挑该动的镜用 AI，其余用你的素材）。\n本卡只有两个来源：素材合成 / 我上传素材。'
                finalResult = wfEarlyReply
              } else {
                // ★VF_AIVIDEO_V1（2026-09-20）：「全部 AI 生成」**已接通**（原来这里是"暂未实现"占位）。
                //   与素材合成走**同一条起草流程**（文案 → 分镜 → 确认卡 → make.py），差别只在四处：
                //     ① 不取素材图（画面由 make.py 调 MiniMax H3 逐镜生成）
                //     ② 画幅默认竖屏（没有素材可判）
                //     ③ 画布按 AI 清晰度定（768P）
                //     ④ 确认卡显示 AI 成本（按秒计价，比素材合成贵几十倍 → 必须让用户确认）
                const vfAI = vfPickAI || (vd.formSource === 'ai')
                if (vfAI) {
                  // ★VF_AIVIDEO_V1（2026-09-20，用户定案）：AI 模式**只标记**，其余一切照旧 ——
                  //   **仍然看素材**（文案/分镜/画幅/画布都按素材走，用户原话"看了素材让它自己决定"），
                  //   差别只在最后：`--source ai` 让 make.py 把画面换成 AI 逐镜生成的片段。
                  //   （早前版本在这里跳过取素材、并把画幅强制成竖屏 —— 已撤回：那会把素材合成的
                  //    判断链污染，而用户明确要求"不要修改别把现在素材成片给搞乱了"。）
                  vd.mode = 'ai'; vd.source = 'ai'
                  VIDEO_DRAFT.set(uidVF2, vd); await saveVfDraft(uidVF2, vd)
                  vfLog(uidVF2, '[画面来源] 全部 AI 生成（MiniMax H3）—— 仍按素材写文案/分镜/画幅，画面改由 AI 逐镜生成')
                }
                // 默认走【个人仓库素材】
                // ★VF_UPLOAD_V1（2026-09-20）：上传素材**真的接通**了——
                //   前端「📤 我上传素材」直接把文件传到个人仓库（POST /api/storage/files），
                //   这里只标记“本次从【最近上传】取素材”，然后走同一套起草流程（不再有死路）。
                if ((vd.formSource === 'upload') || /上传|我传|我自己|本地传/.test(userMessage)) {
                  vd.useRecent = true
                  vfLog(uidVF2, '[上传] 本次成片只用【最近上传】的素材')
                }
                // ★VF_TOPIC_CLEAN_V1（2026-09-21）：草稿里若已存着协议串主题（历史 bug 留的脏值）就清掉 ——
                //   下面 `if (!vd.topic)` 只在【空】时才重新推导，脏值会一直被带进写文案的 prompt。
                if (vd.topic && (/^(VF_FORM|VF_JSON|MAKE_VIDEO|BROWSER_TASK|FRAMES_OK|TOOL_REJECT|VIDEO_RESULT)/i.test(String(vd.topic).trim())
                  || String(vd.topic).trim().startsWith('{') || String(vd.topic).trim().startsWith('['))) {
                  vfLog(uidVF2, '[主题清洗] 草稿主题是协议串 → 已清空')
                  vd.topic = ''
                }
                if (!vd.topic) {
                  const _t = String(userMessage).replace(/^[\s:：,，,。、]+/, '').trim()
                  // 排除按钮文本（"用我的素材库"/"我上传素材"）——它不是主题
                  // ★2026-09-19：排除【所有按钮文本】——它们是操作指令，不是主题
                  // ★VF_TOPIC_V1（2026-09-20，用户实测：主题被写成 `VF_FORM:{...}` 原文）：
                  //   协议串 / 按钮文本一律不算主题 —— 否则会污染卡片显示，还会被喂进写文案的 prompt
                  vd.topic = (/^(用我的素材库|我上传|上传素材|素材库|用素材库|素材合成|素材加AI混合|素材加ai混合|素材AI混合|全部AI生成|全AI生成|素材和AI混合|混合)$/.test(_t)
                    || /^(VF_FORM|VF_JSON|MAKE_VIDEO|BROWSER_TASK|FRAMES_OK|TOOL_REJECT|VIDEO_RESULT)/i.test(_t)
                    || _t.startsWith('{') || _t.startsWith('[')) ? '' : _t
                }
                // ★VF_UPLOAD_V2：若前端带了“刚上传的文件名”，就**精确只用这些**（确定性）；
                //   否则回退到“最近上传”（兼容老前端）。
                const _wanted: string[] = Array.isArray(vd.uploaded) ? vd.uploaded.map((x: any) => String(x)) : []
                const vfMatsAll = await listRepoMaterials(uidVF2, Math.max(40, _wanted.length + 20), vd.useRecent ? 'recent' : 'spread')
                let vfMats = vfMatsAll
                if (vd.useRecent && _wanted.length) {
                  const _byName = new Map(vfMatsAll.map((m: any) => [String(m.name), m]))
                  const _picked = _wanted.map((n: string) => _byName.get(n)).filter(Boolean) as any[]
                  if (_picked.length) {
                    vfMats = _picked
                    vfLog(uidVF2, `[上传] 精确使用刚上传的 ${_picked.length}/${_wanted.length} 张：${_picked.map((m: any) => m.name).slice(0, 6).join('、')}${_picked.length > 6 ? '…' : ''}`)
                  } else {
                    vfLog(uidVF2, `[上传] ⚠️ 名单里 ${_wanted.length} 个文件在仓库里没找到 → 回退“最近上传”`)
                  }
                }
                const _dur0 = Math.max(5, Math.min(900, parseInt(vd.dur) || 30))
                // ★VF_MATN_V1（2026-09-20，用户要求）：素材张数跟时长走——【每 30 秒约 5 张】
                //   30s→5 张、60s→10 张、90s→15 张、180s→30 张；仓库不够就有多少用多少。
                //   视觉理解张数（喂 VL）单独限：8~20 张（成本控制，每张约 0.2 点）
                const vfVisN = Math.max(8, Math.min(20, Math.round(_dur0 / 30) * 5))
                const vfBrief = await summarizeMaterials(uidVF2, vfMats, vfVisN)
                // ★VF_ASPECT_V1：定画布——用户指定优先，否则按素材判断（素材多为横图 → 出横屏，绝不硬塞竖屏）
                // ★VF_AIVIDEO_V1（2026-09-20，用户定案）：**AI 模式也照常看素材**——"看了素材让它自己决定"。
                //   素材在这里的用途是【给 AI 依据】：AI 因此知道你在卖什么，写出的文案与画面描述才贴合。
                //   （注意：AI 出片是"AI 画全新画面"，不是"把素材图动起来"——两者不同。）
                const vfSz = await probeMaterialSizes(uidVF2, vfMats)
                const vfAspect = (vd.aspect && vd.aspect !== 'auto') ? vd.aspect : (vfSz.landscape > vfSz.portrait ? 'landscape' : 'portrait')
                // ★VF_SIZEFIT_V1（2026-09-20 用户实测“图片都是糊的”）：**画布分辨率跟素材走**——
                //   素材最大边不到 1920 就别硬上 1080p（640×304 铺到 1920 要放大 3 倍 = 极糊）。
                const _ms = vfSz.maxSide || 0
                // ★VF_AIVIDEO_V1（2026-09-20，用户定案）：**画布照旧跟素材走**（AI 模式一样）。
                //   为什么不按"AI 生成 768P"定画布：那会让素材合成的判断被污染，而用户明确要求
                //   "不要修改，别把现在素材成片给搞乱了"。AI 片段由 render.py 的 aivideo 卡
                //   缩放裁切到画布（小幅放大可接受），不反过来改画布。
                const vfSize = vfAspect === 'landscape'
                  ? (_ms >= 1920 ? [1920, 1080] : (_ms >= 1280 ? [1280, 720] : [960, 540]))
                  : (_ms >= 1920 ? [1080, 1920] : (_ms >= 1280 ? [720, 1280] : [540, 960]))
                vfLog(uidVF2, `[画布] 素材最大边 ${_ms}px → 输出 ${vfSize[0]}x${vfSize[1]}（不放大）`)
                vd.aspectResolved = vfAspect; vd.size = vfSize
                // ★VF_DUR_V1：时长驱动【文案字数 + 镜头数】——用户要求"让 AI 知道时长"
                //   （中文配音约 4.5 字/秒；镜头按 5 秒一个估）
                const vfDur = Math.max(5, Math.min(900, parseInt(vd.dur) || 30))
                const vfShotN = Math.max(4, Math.min(40, Math.round(vfDur / 5)))
                vfLog(uidVF2, `[画幅] 判定=${vfAspect}（横${vfSz.landscape}/竖${vfSz.portrait}/方${vfSz.square}，探测${vfSz.total}张） 时长=${vfDur}s`)
                vd.dur = vfDur
                let vfProfile = ''
                try {
                  const u: any = await prisma.user.findUnique({ where: { id: uidVF2 }, select: { industry: true, name: true } as any })
                  vfProfile = (u?.industry ? `行业：${u.industry}` : '') + (u?.name ? `；账号：${u.name}` : '')
                } catch {}
                let vfHot = ''
                try {
                  const hr = await fetch('https://ai-niuma.cc/api/agent/hotspots', { signal: AbortSignal.timeout(8000) })
                  if (hr.ok) {
                    const hj: any = await hr.json()
                    const arr: any[] = (hj?.data || hj?.items || hj?.list || []).slice(0, 6)
                    vfHot = arr.map((x: any) => String(x?.title || x?.word || '')).filter(Boolean).slice(0, 5).join('｜').slice(0, 180)
                  }
                } catch {}
                // ★VF_SPLIT_V1（2026-09-20，用户实测：选 180 秒 →“排了 0 个镜头”+报价 1 点）：
                //   根因：一次让 AI 输出「810 字文案 + 30 镜 JSON」太大 → 被 max_tokens 截断
                //   → JSON.parse 失败 → shots 空 + script 空 → 0 镜、报价 fallback 到 1 点。
                //   改成【两次调用】：① 只写文案（输出小）  ② 只排分镜（输出小）
                // ★VF_UPLOAD_V2：上传模式下**以用户上传的张数为准**（他传了 8 张就该用 8 张，
                //   不被“每 30 秒 5 张”的配比截断）；上限 40 张防极端。
                const _vfMatN0 = Math.max(5, Math.min(40, Math.round(vfDur / 30) * 5))
                const vfMatN = (_wanted.length ? Math.max(_vfMatN0, Math.min(40, _wanted.length)) : _vfMatN0)
                // ★VF_HDONLY_V1（2026-09-20 用户实测“图片都是糊的”）：**低清图不进画面**——
                //   仓库里混着发布时抽的帧 `frame_*.jpg`（640×304），铺到画布要放大数倍 = 极糊。
                //   做法：① 用上面探测到的 sizes 给每张图打“短边”分 ② 过滤掉短边 < 640 的
                //        ③ 其余按短边降序（高清优先）④ 过滤后不足 5 张 → 放弃过滤（宁可糊也别没图）
                const _szMap = new Map<string, number>()
                for (const s of (vfSz.sizes || [])) _szMap.set(s.key, Math.min(s.w, s.h))
                const _allImg = vfMats.filter((m: any) => m.kind === 'image')
                // ★VF_HDONLY_V2（2026-09-20 用户实测“上传 8 张却用了旧图”）：**只过滤、不重排** ——
                //   原来这里多了个“按分辨率降序”，把 recent（最新优先）的顺序打乱 →
                //   刚上传的图被高分旧图挤掉（实测：用的是 1280×1280/1280×960 两张旧图）。
                const _hdImg = _allImg.filter((m: any) => {
                  const mn = _szMap.get(String(m.key))
                  return mn == null ? true : mn >= 640
                })
                const vfImgList = (_hdImg.length >= 5 ? _hdImg : _allImg).slice(0, vfMatN)
                if (_hdImg.length < _allImg.length) vfLog(uidVF2, `[清晰度] 低清图过滤：${_allImg.length} → ${_hdImg.length} 张（短边 < 640 的不进画面）`)
                const vfLocal = await downloadMaterials(uidVF2, vfImgList)
                vfLog(uidVF2, `[素材配比] 时长${vfDur}s → 取图上限 ${vfMatN} 张（仓库实际 ${vfMats.filter((m: any) => m.kind === 'image').length} 张，可用 ${vfLocal.length} 张）`)
                const vfNeed = Math.round(vfDur * 4.5)
                const vfCtx = `【用户画像】${vfProfile || '（未知）'}\n【今日热点（可参考，不结合也行）】${vfHot || '（无）'}\n【他的素材】${vfBrief ? '\n' + vfBrief : '（仓库里没有可用图片）'}`
                // ① 文案：用户在表单里直接贴了文案就用他的（★VF_FORM_V1），否则 AI 写
                let vfScript2 = String(vd.formScript || '').slice(0, 4000)
                if (vfScript2) {
                  vfLog(uidVF2, `[文案] 用用户贴的文案 ${vfScript2.length} 字（目标 ${vfNeed}）`)
                } else {
                  try {
                    const vfS1 = await generateText(`你是短视频口播文案写手。写一条约 ${vfDur} 秒的中文口播文案。\n${vfCtx}\n【主题】${vd.topic || '（自行决定，贴合素材与画像）'}\n要求：①【必须 ${vfNeed} 字左右，不得少于 ${Math.round(vfDur * 3)} 字】②开头 3 秒抓人 ③句子用「。」「！」断句 ④保留数字与专业术语 ⑤只输出文案本身，不要标题、不要解释、不要 markdown、不要引号。`) || ''
                    vfScript2 = String(vfS1).replace(/[*#`]/g, '').replace(/^[\s"'“”「」『』]+|[\s"'“”「」『』]+$/g, '').trim().slice(0, 4000)
                    vfLog(uidVF2, `[文案] AI 写 ${vfScript2.length} 字（目标 ${vfNeed}）`)
                  } catch (e: any) { vfLog(uidVF2, '[文案失败] ' + String(e?.message || e).slice(0, 120)) }
                }
                // 字数不足 → 补一次（用户自己贴的文案不擅自扩写）
                if (!vd.formScript && vfScript2 && vfScript2.length < vfNeed * 0.75) {
                  try {
                    const vfEx = await generateText(`把下面这段口播文案扩写到 ${vfNeed} 字左右（现在只有 ${vfScript2.length} 字）。要求：保留全部数字与专业术语、不改主题、不啰嗦重复、句子仍用「。」「！」断句、只输出文案本身。\n原文：${vfScript2}`)
                    const vfEx2 = String(vfEx || '').replace(/[*#`]/g, '').replace(/^[\s"'“”「」『』]+|[\s"'“”「」『』]+$/g, '').trim().slice(0, 4000)
                    if (vfEx2.length > vfScript2.length) { vfLog(uidVF2, `[扩写] ${vfScript2.length} → ${vfEx2.length} 字（目标 ${vfNeed}）`); vfScript2 = vfEx2 }
                  } catch {}
                }
                // ★VF_LENFIX_V1（2026-09-20，**用户定案“严格 180 秒”**）：
                //   实测：目标 810 字，AI 写了 1370 字（+69%）→ 分镜根本覆盖不完 → 成片只念 30%、
                //   时长也只有 110 秒。所以**超额必须压回来**（用户自己贴的文案不动）。
                if (!vd.formScript && vfScript2 && vfScript2.length > vfNeed * 1.15) {
                  try {
                    const vfSh = await generateText(`把下面这段口播文案【压缩】到 ${vfNeed} 字（现在 ${vfScript2.length} 字，必须删掉约 ${vfScript2.length - vfNeed} 字）。要求：① 保留核心卖点、数字、术语 ② 删掉重复表达与铺垫 ③ 保持原顺序和「。」「！」断句 ④ 只输出压缩后的文案本身，不要解释。\n原文：${vfScript2}`)
                    const vfSh2 = String(vfSh || '').replace(/[*#`]/g, '').replace(/^[\s"'“”「」『』]+|[\s"'“”「」『』]+$/g, '').trim().slice(0, 4000)
                    if (vfSh2.length >= vfNeed * 0.6 && vfSh2.length < vfScript2.length) {
                      vfLog(uidVF2, `[压缩] ${vfScript2.length} → ${vfSh2.length} 字（目标 ${vfNeed}）`)
                      vfScript2 = vfSh2
                    } else vfLog(uidVF2, `[压缩] 无效（得到 ${vfSh2.length} 字），保留原文`)
                  } catch (e: any) { vfLog(uidVF2, '[压缩失败] ' + String(e?.message || e).slice(0, 100)) }
                }
                // 兼底：压缩后仍远超目标（AI 不听话）→ 在句末硬截到 ~1.1 倍（用户定案“超额就压缩”）
                if (!vd.formScript && vfScript2.length > vfNeed * 1.35) {
                  const cut = vfScript2.slice(0, Math.round(vfNeed * 1.1))
                  const lastP = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('！'), cut.lastIndexOf('？'))
                  vfScript2 = lastP > vfNeed * 0.6 ? cut.slice(0, lastP + 1) : cut
                  vfLog(uidVF2, `[硬截] → ${vfScript2.length} 字（目标 ${vfNeed}）`)
                }
                // ② 分镜（★VF_SHOTGEN_V1：prompt 给合法示例 + 解析正则容错 + **自动重试一次修 JSON**）
                const vfImgs = vfLocal.map((m: any) => m.localPath).filter(Boolean)
                const vfShots = await genVideoShots({
                  uid: uidVF2, aspect: vfAspect, dur: vfDur, shotN: vfShotN,
                  imgPaths: vfImgs, brief: String(vfBrief || ''), script: vfScript2,
                  // ★VF_AIVIDEO_V1（2026-09-20）：AI 模式额外要一镜一个英文画面描述（喂 H3）。
                  //   非 AI 模式不传 → 输出与原来完全一致（素材合成零影响）。
                  wantPrompt: vfAI,
                })
                // 存进草稿：**「重试分镜」时不用重新取素材/看图**（直接复用）
                vd.imgs = vfImgs
                vd.brief = String(vfBrief || '').slice(0, 1500)
                // ★VF_COVER_V1（2026-09-20，用户定案“严格 180 秒 = 文案要写成 ~810 字且被念完”）：
                //   实测 1370 字文案 + 17 镜 → subtitle 只覆盖 ~30% → 成片 110 秒、后 70% 文案从没被念。
                //   → 这里算**覆盖率**，不达标就不给出片（状态机门槛）。
                let vfSubLen = vfShots.reduce((a: number, s: any) => a + String(s.subtitle || '').length, 0)
                let vfCover = vfScript2 ? vfSubLen / vfScript2.length : 0
                vfLog(uidVF2, `[覆盖率] subtitle ${vfSubLen} 字 / 文案 ${vfScript2.length} 字 = ${Math.round(vfCover * 100)}%`)
                // ★VF_SUBFILL_V1（2026-09-20）：AI 常把 subtitle 写太短（实测 11 字/镜 → 只覆盖 34%）。
                //   兜底（确定性）：**把文案按顺序切成 N 段，逐镜填进 subtitle**（type/画面都不动）。
                if (vfShots.length >= 2 && vfCover < 0.8 && String(vfScript2 || '').length > 0) {
                  const before = Math.round(vfCover * 100)
                  const segs = vfSplitScript(vfScript2, vfShots.length)
                  let sum = 0
                  for (let i = 0; i < vfShots.length; i++) {
                    const curSub = String(vfShots[i]?.subtitle || '')
                    const seg = String(segs[i] || '')
                    const useIt = seg.length > curSub.length ? seg : curSub   // 只增不减
                    vfShots[i] = { ...vfShots[i], subtitle: useIt.slice(0, 300) }
                    sum += useIt.length
                  }
                  vfSubLen = sum
                  vfCover = vfScript2 ? vfSubLen / vfScript2.length : 0
                  vfLog(uidVF2, `[字幕兜底] AI 只覆盖 ${before}% → 按顺序切成 ${vfShots.length} 段填入 → 覆盖 ${Math.round(vfCover * 100)}%（预计 ${Math.round(vfSubLen / 4.5)} 秒）`)
                }
                // ★A8（2026-09-22）：原「[时长护栏] 分镜合计偏离目标 >25% 就缩放到目标秒数」**已删除**。
                //   理由（也是原代码自己的注释）：素材成片的最终时长 = tts.py 逐镜配音真实时长之和
                //   （tts.py 会 `s['dur'] = round(配音+0.35, 2)` 覆盖这里的 dur），
                //   所以缩放 dur 对成片**毫无作用**，只会让日志/卡片给出"目标 180 秒"的假承诺
                //   （用户实测：选 180 秒被这行误导成"护栏生效了"）。现在只**如实打一行对比**，不做任何改写。
                {
                  const _dfTarget = Math.max(5, Math.min(900, Number(vfDur) || 30))
                  const _dfSum = vfShots.reduce((a: number, s: any) => a + (Number(s?.dur) || 0), 0)
                  if (_dfSum > 0) {
                    vfLog(uidVF2, `[时长] 分镜预估合计 ${Math.round(_dfSum)} 秒 / 目标 ${_dfTarget} 秒（仅供参考：最终时长由逐镜配音决定，不再按目标缩放）`)
                  }
                }
                const vfEstSec = Math.round(vfSubLen / 4.5)
                const vfHasPlan = vfShots.length >= 2 && !!vfScript2 && vfCover >= 0.8
                vd.script = vfScript2 || vd.topic || '看这条视频'
                vd.shots = vfHasPlan ? vfShots : undefined
                vd.cover = vfCover
                vd.subLen = vfSubLen
                vd.shotN = vfShotN
                vd.dur = vfDur
                vd.step = 'script'
                VIDEO_DRAFT.set(uidVF2, vd); await saveVfDraft(uidVF2, vd)
                if (!vfHasPlan) vfLog(uidVF2, `[分镜门禁] ${vfShots.length} 镜 / 覆盖 ${Math.round(vfCover * 100)}% → **不给确认出片**`)
                wfEarlyReply = vfScriptCard(vd, vfShots, vfImgs.length, String(vfBrief || ''), vfAspect, vfCover, vfEstSec)
                // ★VF_SUMMARY_V1（2026-09-20）：一条日志看全本次成片参数（省得每次再跑 Python 脚本查分镜）
                // ★VF_SUMMARY_V1（2026-09-20）：一条日志看全本次成片参数（省得每次再跑 Python 脚本查分镜）
                vfLog(uidVF2, `[概要] 图${vfImgs.length}张 镜${vfShots.length}个 风格=${vd.theme || 'dark'} 画幅=${vfAspect}(${vfSize[0]}x${vfSize[1]}) 配音=${vd.voice || '-'} 时长≈${Math.round(vfSubLen / 4.5)}秒${vfAI ? ' 画面来源=全部AI生成' : ''}`)
                finalResult = wfEarlyReply
                vfLog(uidVF2, `[起草] 图${vfImgs.length}张 镜头${vfShots.length}个 主题="${String(vd.topic).slice(0, 20)}" 素材摘要=${String(vfBrief).replace(/\n/g, ' ').slice(0, 150)}`)
                vfLog(uidVF2, `[分镜构成] ${vfShots.map((x: any) => x.type).join(',')}`)
              }
            } else if (vd.step === 'script' && /确认|可以|开始|生成吧|出片|就这个|^行$|^好$|^OK$|先出字幕版|强制出片/i.test(userMessage.trim())) {
              const vfForce = /先出字幕版|强制出片|就这样出/.test(userMessage)
              // ★VF_GATE_V1（2026-09-20，用户实测：0 镜也放行 → 成片没有素材画面）：
              //   没有分镜就**不许出片**；只有用户明确要“字幕版”时才放行走 --script。
              if (!vd.shots?.length && !vfForce) {
                vfLog(uidVF2, '[分镜门禁] 无分镜，已拦下“确认出片”')
                wfEarlyReply = '分镜还没成功，先不出片（否则出来的片子没有素材画面）。\n回「重试」我再排一次；若你只想先要一条**只有字幕配音、没有素材画面**的版本，回「先出字幕版」。'
                finalResult = wfEarlyReply
              } else {
                // ── 确认 → 后台出片（确定性，走现有 make_ai_video）──
                const vfRun = await executeToolCall('make_ai_video', (vd.shots?.length && !vfForce)
                  ? { plan: JSON.stringify({ size: vd.size || [1080, 1920], fps: 25, shots: vd.shots }), script: vd.script, theme: vd.theme || 'dark', speaker: vd.voice || '', bgm: vd.bgm || '', confirmed: true }
                  : { script: vd.script, theme: vd.theme || 'dark', speaker: vd.voice || '', bgm: vd.bgm || '', confirmed: true }, auth)
                // ★VF_RUN_CLOSE_V1（2026-09-21，用户实测「做完一条第二条要点两次」＋「之后随便说句话都被回
                //   『已在后台渲染中』」）：任务一旦入队就【立即作废草稿】——进度已由独立的
                //   <storage>/<uid>/video-factory/vf<ts>.json 跟踪，草稿留着只会挡住下一条（最长挡 30 分钟）。
                vfLog(uidVF2, '[草稿收尾] 已入队 → 旧草稿作废（下一条不必再点两次）')
                VIDEO_DRAFT.delete(uidVF2)
                await clearVfDraft(uidVF2)
                wfEarlyReply = String(vfRun)
                finalResult = wfEarlyReply
                vfLog(uidVF2, `[入队] ${String(vfRun).slice(0, 100)}`)
              }
            } else if (vd.step === 'script' && !vd.shots?.length && /^重试|重新排|再排一次|重排分镜/.test(userMessage.trim())) {
              // ★「重试分镜」：复用草稿里存的素材清单（vd.imgs/vd.brief），只重跑分镜
              vfLog(uidVF2, '[重试分镜] 用户要求重排')
              const vfShotN2 = Math.max(4, Math.min(40, Math.round((vd.dur || 30) / 5)))
              const vfAgain = await genVideoShots({
                uid: uidVF2,
                aspect: vd.aspectResolved || (vd.aspect === 'landscape' ? 'landscape' : 'portrait'),
                dur: vd.dur || 30,
                shotN: vfShotN2,
                imgPaths: (vd.imgs || []), brief: String(vd.brief || ''), script: String(vd.script || ''),
                // ★VF_AIVIDEO_V1（2026-09-20）：重试时也要（重试分支不在 vfAI 的作用域，用草稿上的 source）
                wantPrompt: vd.source === 'ai',
                // ★把上次失败原因带上：AI 这次才知道“要覆盖全文、要排够镜数”
                retryHint: vd.cover != null
                  ? `上次 subtitle 一共只写了 ${vd.subLen || 0} 字，文案共 ${String(vd.script || '').length} 字，只覆盖了 ${Math.round((vd.cover || 0) * 100)}%。这次**必须覆盖全文**（平均每镜约 ${Math.round(String(vd.script || '').length / vfShotN2)} 字），镜头数 ${vfShotN2} 个。`
                  : '上次没排出合规 JSON。这次只输出严格 JSON 数组，pick 用纯数字。',
              })
              const vfAgainSub = vfAgain.reduce((a: number, s: any) => a + String(s.subtitle || '').length, 0)
              const vfAgainCover = vd.script ? vfAgainSub / String(vd.script).length : 0
              const vfAgainEst = Math.round(vfAgainSub / 4.5)
              vd.shots = (vfAgain.length >= 2 && vfAgainCover >= 0.8) ? vfAgain : undefined
              vd.cover = vfAgainCover; vd.subLen = vfAgainSub
              VIDEO_DRAFT.set(uidVF2, vd); await saveVfDraft(uidVF2, vd)
              vfLog(uidVF2, `[重试分镜] ${vfAgain.length} 镜，覆盖 ${Math.round(vfAgainCover * 100)}%（预计 ${vfAgainEst} 秒 / 目标 ${vd.dur} 秒）`)
              wfEarlyReply = vfScriptCard(vd, vfAgain, (vd.imgs || []).length, String(vd.brief || ''), vd.aspectResolved || 'portrait', vfAgainCover, vfAgainEst)
              finalResult = wfEarlyReply
            } else if (vd.step === 'script') {
              // ── 文案微调 / 换音色 / 换主题（★AI 出场①）──
              const vfIsVoice = /音色|声音|女声|男声|龙小淳|龙小夏|豆豆|龙书|龙陈|龙靖|龙小辉/.test(userMessage)
              if (vfIsVoice) {
                const vid = /龙小夏|清亮/.test(userMessage) ? 'longxiaoxia'
                  : /豆豆|甜美/.test(userMessage) ? 'cherry'
                  : /龙书|沉稳/.test(userMessage) ? 'longshu'
                  : /龙陈|浑厚/.test(userMessage) ? 'longchen'
                  : /龙靖|知性/.test(userMessage) ? 'longjing'
                  : /龙小辉|阳光/.test(userMessage) ? 'longxiaohui'
                  : 'longxiaochun'
                vd.voice = vid
                VIDEO_DRAFT.set(uidVF2, vd)
                const _vn = (vd.voiceList || VF_VOICE_BASE).find((v: any) => v.id === vid)?.name || vid
                wfEarlyReply = 'VF_JSON:' + JSON.stringify({ step: 'script', topic: vd.topic, script: vd.script, voice: vd.voice, voiceName: _vn, theme: vd.theme, cost: Math.max(1, Math.ceil(vd.script.length / 20)), hint: `已换成「${_vn}」——回复「确认」出片` })
              } else {
                const vfNew = await generateText(`按用户要求修改下面这段口播文案，保留数字与专业术语，仍用「。」「！」断句，只输出文案：\n原文：${vd.script}\n用户要求：${userMessage}`)
                const vfNewScript = String(vfNew || '').replace(/[*#`]/g, '').replace(/^[\s"'“”「」『』]+|[\s"'“”「」『』]+$/g, '').trim().slice(0, 600)
                if (vfNewScript) vd.script = vfNewScript
                VIDEO_DRAFT.set(uidVF2, vd)
                wfEarlyReply = 'VF_JSON:' + JSON.stringify({ step: 'script', topic: vd.topic, script: vd.script, voice: vd.voice, voiceName: vd.voice, theme: vd.theme, cost: Math.max(1, Math.ceil(vd.script.length / 20)), hint: '文案已更新——回复「确认」出片' })
              }
              finalResult = wfEarlyReply
              console.log('[成片状态机] 文案轮——', String(userMessage).slice(0, 20))
            } else if (vd.step === 'running') {
              // 出片中：拦下 AI（进度由前端轮询 make-video-status 推）
              wfEarlyReply = '本地成片已在后台渲染中——完成后会自动推结果给你（也可问「视频做得怎么样了」）。'
              finalResult = wfEarlyReply
            } else {
              // ★兜底1（2026-09-19）：草稿 step 不认识（如 upload / 异常残留）→ 也出卡，绝不让这轮落到 AI 自由发挥
              vfLog(uidVF2, `[兜底-块内] step=${vd?.step} 未匹配分支——强制出素材来源卡`)
              wfEarlyReply = 'VF_JSON:' + JSON.stringify({ step: 'source', topic: vd?.topic || '', hint: '这条视频用什么素材？（点一下就走）' })
              finalResult = wfEarlyReply
            }
          } catch (eVF: any) { console.error('[成片状态机] 异常:', eVF?.message || eVF); vfLog(uidVF2, '[异常] ' + String(eVF?.message || eVF).slice(0, 200)) }
        }
        // ★兜底2（2026-09-19）：消息明显是“做视频”意图、但状态机没给回复 → 强制出素材来源卡
        //   目的：即使进块条件/分支判断出了意外，也绝不让这一轮落到 AI 自由发挥（用户实测过的现象）
        // ★STD_QUERY_V1（2026-09-21 用户实测 22:07）：**查询/进度类消息绝不触发** ——
        //   用户问「查询任务 vf… 的最新进度」时，消息里**带着 MAKE_VIDEO_TASK 的整段文案**
        //   （含"本地成片已在后台开始/视频做得怎么样了"）→ 命中下面的 `成片` → 被这条兜底抢走，
        //   回了「这条视频用什么素材？」（完全不相干的卡片）→ 看起来像"状态机又乱接"。
        const _isQueryMsg = /进度|做得怎么样|怎么样了|查询任务|query_video_task|最新进度/.test(userMessage)
        // ★A6 / VF_PROGRESS_V1（2026-09-22，用户定案）：「查询进度」必须是【确定性】的 ——
        //   用户要求原话：「查询进度应该是确定性地回真实进度，不许编（不能出卡片、不能出发布话术、
        //   宁可"仍在渲染中·第 12/36 镜"原地待着）」。
        //   以前只做到"不被兜底抢走"（STD_QUERY_V1），但**没有"给出对回复"** ——
        //   模型没想起来调工具时 reply 为空 → 露出块尾那句给发布线写的兜底 → 看起来像乱接。
        //   现在：识别到查询类消息 → 直接读本地任务 JSON（query_make_video）→ 回真实进度；
        //   读不到就明说"还没查到"，绝不编。
        if (!wfEarlyReply && _isQueryMsg) {
          try {
            const _p = String(await executeToolCall('query_make_video', {}, auth))
              .replace(/^MAKE_VIDEO_PROGRESS:\s*/, '🎬 ')
            wfEarlyReply = _p
            vfLog(uidVF2, `[进度] 确定性回本地任务进度（读 vf*.json）: ${_p.slice(0, 60).replace(/\n/g, ' ')}`)
          } catch (eP: any) {
            wfEarlyReply = '查进度时出错了：' + String(eP?.message || eP).slice(0, 120)
            vfLog(uidVF2, '[进度] 读取失败: ' + String(eP?.message || eP).slice(0, 120))
          }
          finalResult = wfEarlyReply
        }
        if (!wfEarlyReply && !_isQueryMsg && /做.{0,4}视频|成片|做视频/.test(userMessage)) {
          vfLog(uidVF2, '[兜底-块外] 状态机未出回复，已强制出素材来源卡')
          wfEarlyReply = 'VF_JSON:' + JSON.stringify({ step: 'source', topic: '', hint: '这条视频用什么素材？（点一下就走，不用打字）' })
          finalResult = wfEarlyReply
        }
        if (false && pubIntent && !calledPublish) { // 旧强制段已禁        if (false && pubIntent && !calledPublish) { // 旧强制段已禁
          // 从用户消息提取平台+视频文件名
          const platMatch = userMessage.match(/(抖音|小红书|微博|视频号)/)
          const platMap: Record<string, string> = PLATFORM_KEY   // 2026-09-13: 取自 platforms.ts（原只 4 个、漏 B站/快手）
          const platform = platMatch ? (platMap[platMatch![1] || ''] || 'douyin') : 'douyin'
          const vfMatch = userMessage.match(/([A-Za-z0-9_-]+\.(?:mp4|mov|avi|mkv|webm))/i)
          const vfName = vfMatch ? (vfMatch![1] || '') : ''
          const wfArgs: any = { platform }
          if (vfName) wfArgs.videoName = vfName
          const isConfirm = userMessage.trim().length <= 6 && /(发|确认|可以|就这样|好|行|发吧)/.test(userMessage.trim())
          if (vfName && !isConfirm) {
            // 首轮：只强制抽帧看视频（visualDesc 注入→AGENT 基于真实画面出标题/文案）——不建任务
            console.log('[发布工作流] 首轮看视频:', vfName)
            const frResult = await executeToolCall('extract_video_frames', { videoName: vfName }, auth).catch((e: any) => '抽帧失败: ' + (e.message || e))
            messages.push({ role: 'tool', tool_call_id: 'wf-fr-' + Date.now(), content: String(frResult) } as any)
          } else {
            // 确认轮/没视频：强制建任务（caption 从对话上轮标题提取，无则用视频名兕底）
            if (vfName) {
              try {
                const prevAsst = [...messages].reverse().find((m: any) => m.role === 'assistant' && typeof m.content === 'string' && m.content.indexOf('标题') >= 0)
                const tm = prevAsst ? String((prevAsst as any).content).match(/标题[\s:]*[：:]?([^\n]{2,40})/) : null
                if (tm) wfArgs.caption = (tm![1] || '').trim()
              } catch {}
            }
            console.log('[发布工作流] 确认建任务（browser_use 发布——opencli 链已清除）:', JSON.stringify(wfArgs))
            // 2026-08-30: 发布统一走 browser_use（AI 浏览器）——不再 opencli（create_v2 定时-2/旧 DOM）
            const buTask = '发布视频到' + (PLATFORM_NAME[wfArgs.platform] || wfArgs.platform || PLATFORM_NAME.douyin) + '：在客户端已打开的创作者中心发布页上传个人仓库视频 ' + (wfArgs.videoName || '') + '，标题：' + (wfArgs.caption || wfArgs.title || '') + '，话题：' + (wfArgs.topics || '') + (wfArgs.coverUrl ? '，封面：' + wfArgs.coverUrl : '，用平台智能封面') + '，然后点击发布'
            const buT = await buCreate(auth?.userId || 0, buTask, '[]')
            const wfResult = 'BROWSER_TASK_QUEUED:已创建 AI 浏览器发布任务（#' + (buT.seq ?? buT.id) + '）——客户端 AI 浏览器自动执行（打开平台→上传→填标题→发布）。任务：' + buTask
            messages.push({ role: 'tool', tool_call_id: 'wf-' + Date.now(), content: String(wfResult) } as any)
            if (normCalls.length === 0) normCalls.push({ id: 'wf-' + Date.now(), name: 'browser_use_execute', arguments: JSON.stringify({ task: buTask }) } as any)
            if (vfName) {
              try { const fr2 = await executeToolCall('extract_video_frames', { videoName: vfName }, auth).catch((e: any) => '抽帧失败'); messages.push({ role: 'tool', tool_call_id: 'wf-fr-' + Date.now(), content: String(fr2) } as any) } catch {}
            }
          }
        }
      } catch (ePub2) { console.error('[发布工作流] 异常:', ePub2) }
      console.log('[状态机] 块尾——step=', (PUBLISH_DRAFT.get(auth?.userId || 0) as any)?.step, 'wfEarlyReply=', wfEarlyReply ? String(wfEarlyReply).slice(0, 60) : '(空——未设回复)', '消息=', String(userMessage).slice(0, 20))
 }
      const toolMsg = messages.filter(m => (m as any).role === 'tool').pop() as AgentChatMessage | undefined
      const toolRaw = toolMsg?.content
      const toolText = typeof toolRaw === 'string' ? toolRaw : (toolRaw ? JSON.stringify(toolRaw) : '')

      let reply: string
      if (wfEarlyReply) { reply = wfEarlyReply; console.log('[状态机] wfEarlyReply 已设:', String(wfEarlyReply).slice(0, 60)) } else
      // 若模型在 Step2 又返回了 tool_calls（异常），忽略它，用工具结果兜底，避免死循环与脏输出
      if (finalResult && finalResult.toolCalls && finalResult.toolCalls.length > 0) {
        reply = formatToolResult(toolText)
      } else {
        reply = (typeof finalResult === 'string' ? finalResult : finalResult?.content) || formatToolResult(toolText)
        // 2026-09-12: ★防 AI 编造「已创建任务」（本轮没真建任务却声称已创建 → 拦掉——用户会被误导以为发出去了）
        if (!createdTaskThisTurn && /已创建|已提交|任务已建|已发布到|发布任务/.test(String(reply))) {
          console.log('[防编造] AI 声称已创建任务但本轮未建——已拦下：', String(reply).slice(0, 60))
          reply = '⚠️ 纠正一下：我刚才说的「已创建任务」并不准确——本轮**没有真正创建发布任务**。' + String.fromCharCode(10) + '要发布请说「帮我发一个视频」走完整流程（选视频 → 标题 → 话题 → 封面 → 点平台按钮）。'
        }
      // ★A6 / VF_PROGRESS_V1（2026-09-22）：这句原来是**给发布线写**的（"发布流程处理中——请回复重试"），
      //   却被当成**通用**兜底 → 用户问"成片进度"时看到的正是它（看起来像乱接/编造）。
      //   改成中性话术，并且查询类消息已在上面有了确定性分支（不会再落到这里）。
      if (!reply) reply = '我没拿到这一轮的结果——请稍等再试一次；如果是在问成片进度，直接说「视频做得怎么样了」。'
      }
      // 2026-08-27: 发布话术强制校验——模型说“已创建”但工具未真返回 PUBLISH_QUEUED → 强制纠正（不信模型话术，信工具结果）
      try {
        const userWantsPublish = /发布|发抖音|发小红书|发微博|发视频号|发到/.test(userMessage)
        const hasPublishToolResult = /PUBLISH_QUEUED|WORKFLOW_NEED_VIDEO|CANCEL_OK|FRAMES_OK|测试发布任务/.test(toolText) // 2026-08-27: FRAMES_OK(首轮看视频)也算工作流进行中——不误拦
        const claimsCreated = /已创建|创建发布任务|发布任务已创建|已为「/.test(reply)
        if (userWantsPublish && !wfEarlyReply && claimsCreated && !hasPublishToolResult) {
          console.error('[发布校验] 模型话术“已创建”但工具未返回，强制纠正:', userMessage.slice(0, 50))
          reply = toolText.includes('WORKFLOW_NEED_VIDEO')
            ? '⚠️ 发布任务未真正创建。' + toolText
            : '⚠️ 发布任务未真正创建。请说“发布抖音 XX 视频”（XX 为仓库视频编号），或到个人仓库页选择要发布的视频。'
        }
        // 2026-08-27 扩大校验：用户发布意图 + 本轮未真调发布工具（无 PUBLISH_QUEUED/WORKFLOW_NEED_VIDEO）→ 不管模型说什么（“检测到 pending”/“打开指纹浏览器”等）均强制走工作流
        if (userWantsPublish && !wfEarlyReply && !hasPublishToolResult && !/CANCEL_OK/.test(toolText)) {
          console.error('[发布校验] 用户要发布但本轮未调发布工具，强制引导工作流:', userMessage.slice(0, 50))
          reply = toolText.includes('WORKFLOW_NEED_VIDEO')
            ? '⚠️ 发布未进入工作流（本轮未触发发布工具）。' + toolText
            : '⚠️ 发布未进入工作流。请说“发布抖音 XX 视频”（XX=仓库视频编号），或到个人仓库页选择。已启用发布工作流，不再使用指纹浏览器流程。'
        }
      } catch (ePub) { console.error('[发布校验]异常:', ePub) }
      // 清理模型偶发吐出的工具调用 XML 脏标签（<tool_call> <function_calls> <invoke> 等）
      reply = stripToolCallTags(reply)
      // 解析 Scene 投影协议（工具分支，2026-08-05 提取共用函数）
      const extracted = await extractSceneFromReply(reply)
      reply = extracted.reply
      let scene = extracted.scene

      // 存DB
      let sessionId = sid
      if (auth?.userId) {
        if (!sessionId) {
          const s = await prisma.chatSession.create({
            data: { userId: auth.userId, title: userMessage.substring(0, 30) },
          })
          sessionId = s.id
        }
        await prisma.chatMessage.createMany({
          data: [
            { sessionId, role: 'user', content: userMessage },
            { sessionId, role: 'assistant', content: reply, toolUsed: true, intent: normCalls.map((t: any) => t.name).join(',') },
          ],
        })
        await prisma.chatSession.update({ where: { id: sessionId }, data: { updatedAt: new Date() } })
      }

      // 2026-08-12: 对话前先检查点数（无套餐且点卡0/额度不足 -> 主动弹「我的套餐」）
      if (auth?.userId) {
        const tok = await checkTokens(auth.userId, TOKEN_COSTS.CHAT_PER_MSG)
        if (!tok.allowed) {
          return NextResponse.json({ success: true, data: {
            reply: '⚠️ ' + (tok.message || '点数不足') + '——已为你打开「我的套餐」页面，可在其中开通套餐或购买点卡。',
            intent: 'no_quota', toolUsed: false, scene: { type: 'open_page', path: '/my-subscription', params: {} }, sessionId: sessionId, pointsSpent: 0,
          } })
        }
        await spendTokens(auth.userId, TOKEN_COSTS.CHAT_PER_MSG, 'agent_chat')
      }
      return NextResponse.json({
        success: true,
        data: { reply, intent: toolCalls.map((t: any) => t.name), toolUsed: true, steps, scene: scene || templateScene, scenes: extracted.scenes.length > 1 ? extracted.scenes : undefined, sessionId, pointsSpent: TOKEN_COSTS.CHAT_PER_MSG, videoTaskId },
      })
    }
      // ═══ 标准模式专属：发布状态机 结束（下面是共用逻辑 / 自由模式也走）═══

    // 纯聊天
    let reply = fcResult.content || '抱歉，AI服务暂时繁忙。'
    // 纯聊天分支同样解析 SCENE_JSON（2026-08-05：模型可能不调工具直接输出场景卡片）
    const extractedChat = await extractSceneFromReply(reply)
    reply = extractedChat.reply
    const scene = extractedChat.scene
    const scenes = extractedChat.scenes.length > 1 ? extractedChat.scenes : undefined
    // 2026-08-05：AI 自由度——仅输出场景卡片而无正文时，给一句自然引导（不让回复为空）
    if (!reply.trim() && scene) {
      if (scene.type === 'open_page') {
        const p = scene.path || ''
        const title = (p.split('/').filter(Boolean).pop() || '功能')
        reply = `已为你打开「${title}」，我一直在旁边。想让我帮你做什么？比如：结合当前页面给建议、生成内容、或告诉我下一步。`
      } else if (scene.type === 'image') {
        reply = scene.desc || '已为你生成，看看这张卡片～'
      } else {
        reply = '已为你处理，还有什么需要帮忙的吗？'
      }
    }
    let sessionId = sid
    if (auth?.userId) {
      if (!sessionId) {
        const s = await prisma.chatSession.create({
          data: { userId: auth.userId, title: userMessage.substring(0, 30) },
        })
        sessionId = s.id
      }
      await prisma.chatMessage.createMany({
        data: [
          { sessionId, role: 'user', content: userMessage },
          { sessionId, role: 'assistant', content: reply, toolUsed: false },
        ],
      })
      await prisma.chatSession.update({ where: { id: sessionId }, data: { updatedAt: new Date() } })
    }

    if (auth?.userId) {
      const tok = await checkTokens(auth.userId, TOKEN_COSTS.CHAT_PER_MSG)
      if (!tok.allowed) {
        return NextResponse.json({ success: true, data: {
          reply: '⚠️ ' + (tok.message || '点数不足') + '——已为你打开「我的套餐」页面。',
          intent: 'no_quota', toolUsed: false, scene: { type: 'open_page', path: '/my-subscription', params: {} }, sessionId: null, pointsSpent: 0,
        } })
      }
      await spendTokens(auth.userId, TOKEN_COSTS.CHAT_PER_MSG, 'agent_chat')
    }
    // #5 模型标注 + #6 敏感过滤（2026-08-21：回复末尾标注实际模型；剔除后台链接/IP/API key）
    const usedModel = (fcResult as any)?.model || (hasImage ? 'qwen3.8-flash' : 'qwen3.8-flash') // 2026-08-30: 统一 qwen3.8（不切 qwen-plus）
    reply = String(reply || '')
    if (reply && !/（模型：/.test(reply)) {
      reply = reply + String.fromCharCode(10, 10) + '（模型：' + usedModel + '）'
    }
    reply = reply
      .replace(/https?:\/\/[^\s）)]*(?:admin|120\.55\.43\.195)[^\s）)]*/g, '[内部链接已隐藏]')
      .replace(/\/admin/g, '')
      .replace(/sk-[A-Za-z0-9_-]{10,}/g, '******')
    return NextResponse.json({
      success: true,
      data: { reply, intent: 'chat', toolUsed: false, sessionId, scene: scene || templateScene, scenes, pointsSpent: TOKEN_COSTS.CHAT_PER_MSG },
    })
  } catch (error: any) {
    console.error('[Agent API]', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}

// GET: 聊天历史
export async function GET(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '请登录' }, { status: 401 })

  const url = new URL(request.url)
  const action = url.searchParams.get('action') || 'sessions'
  const sessionId = parseInt(url.searchParams.get('sessionId') || '')
  // 2026-08-21: 30 天自动清理旧会话（非收藏的 30 天前会话——懒清理，查询时触发）
  try {
    await prisma.chatSession.deleteMany({
      where: { userId: auth.userId, favorite: false, updatedAt: { lt: new Date(Date.now() - 30 * 24 * 3600 * 1000) } },
    })
  } catch {}
  // 2026-08-21 日历：按天查会话（回档用）
  if (action === 'sessionsByDate') {
    try {
      const sessions = await prisma.chatSession.findMany({
        where: { userId: auth.userId },
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: { id: true, title: true, favorite: true, createdAt: true, updatedAt: true, _count: { select: { messages: true } } },
      })
      const byDate: Record<string, any[]> = {}
      for (const s of sessions) {
        const d = s.createdAt.toISOString().slice(0, 10)
        ;(byDate[d] = byDate[d] || []).push({ id: s.id, title: s.title, favorite: s.favorite, msgCount: s._count.messages, updatedAt: s.updatedAt.toISOString() })
      }
      return NextResponse.json({ success: true, data: byDate, favorites: sessions.filter(s => s.favorite).map(s => ({ id: s.id, title: s.title, date: s.createdAt.toISOString().slice(0, 10) })) })
    } catch (e: any) { return NextResponse.json({ success: false, message: e.message }, { status: 500 }) }
  }
  // 2026-08-21 日历：收藏/取消收藏会话
  if (action === 'favoriteToggle') {
    try {
      const id = parseInt(url.searchParams.get('id') || '0')
      const fav = url.searchParams.get('fav') === '1'
      await prisma.chatSession.updateMany({ where: { id, userId: auth.userId }, data: { favorite: fav } })
      return NextResponse.json({ success: true, favorite: fav })
    } catch (e: any) { return NextResponse.json({ success: false, message: e.message }, { status: 500 }) }
  }

  try {
    if (action === 'sessions') {
      const sessions = await prisma.chatSession.findMany({
        where: { userId: auth.userId },
        orderBy: { updatedAt: 'desc' },
        take: 30,
        select: { id: true, title: true, updatedAt: true },
      })
      return NextResponse.json({ success: true, data: sessions })
    }
    if (action === 'messages' && sessionId) {
      const session = await prisma.chatSession.findFirst({ where: { id: sessionId, userId: auth.userId } })
      if (!session) return NextResponse.json({ success: false, message: '会话不存在' }, { status: 404 })
      const messages = await prisma.chatMessage.findMany({
        where: { sessionId },
        orderBy: { createdAt: 'asc' },
        select: { id: true, role: true, content: true, toolUsed: true, intent: true, createdAt: true },
      })
      return NextResponse.json({ success: true, data: { session, messages } })
    }
    return NextResponse.json({ success: false, message: '未知操作' }, { status: 400 })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
