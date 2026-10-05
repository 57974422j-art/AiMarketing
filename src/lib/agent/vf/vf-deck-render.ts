import path from 'node:path'
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import { vfRootDir, vfStorageRoot } from '@/lib/agent/video-material'
import { spendTokens, checkTokens } from '@/lib/token-wallet'

/**
 * ★VF_DECKCONFIRM_V1（2026-10-04 用户定案「双轨并存：确认卡上自己选老引擎/新引擎；老的保留不退役」）
 * ——「🎬 确认出片 · 新引擎」的执行体。
 *
 *   确认卡上与原「确认出片」（老 Python 链，**一个字没改、默认仍是它**）并排一个新按钮；
 *   点它 = 发机器协议串 `VF_DECK_CONFIRM:{"skin":"v1","ori":"9:16"}`。
 *   chat/route.ts 在**四条成片线分派之前**接管该协议（线上有 step='script' 草稿时各线
 *   "有草稿必接管"，晚于此会被蹭走——与 VF_I2V_OFF 同一类防线），再调用本文件。
 *
 * 与 /api/agent/vf/deck-preview 的关系（同一引擎、同一映射、同一白名单；区别只有三点）：
 *   · preview 是审核（不扣点、quotaCheck:false）；本文件是【正式出片】：收文案费（与老链
 *     同公式：ceil(字数/20)，字数 = script 优先、无则分镜 subtitle/text 总和 —— ★VF_COSTFIX_V1
 *     的口径，报价 = 实扣），入个人仓库走配额（与老链 saveToPersonalRepo 同参）。
 *   · 任务文件 vf<ts>.json 与老链**同形状**（id/status/startedAt/finishedAt/out/cost/repoName/
 *     url/tail/error）→ make-video-status 进度轮询、完成推送、入库/签名 URL 前端展示**全复用**。
 *   · 多记 engine:'deck' + skin/ori（诊断用）。
 *
 * ⚠️ 诚实口径（★VF_AVIMG_V1 2026-10-05 用户定案「新制片也要配音和BGM」后更新）：
 *   新引擎成片 = 动态 PPT（HTML 逐帧）+ **配音（逐句 TTS，百炼→硅基→火山三级降级）+
 *   BGM（AI 音乐库选曲）+ 图片页（分镜 bgimage 素材镜注入 pageImage）**。
 *   配音/BGM/图片页**不另收费**（报价仍 = 文案费 ceil(字数/20)，与老链同公式）；
 *   动图/AI 画面那两笔钱**不收**（新引擎不调它们）。
 *   管线 = BGM选曲 → gen-deck → 注入图片页/按配音定页时长 → 逐句TTS → 自产SRT(字幕=口播,
 *   不再与页面大字同文重复) → batch-video 渲染+烧字幕 → ffmpeg 混音(配音±BGM) → 入库/扣费。
 *   老引擎（make.py）一行没改，默认仍是它。
 */

/** 皮肤白名单 = masters/ 的权威清单（与 deck-preview 路由逐字一致，防任意参数注入 spawn） */
export const DECK_SKINS = ['ecom', 'editorial', 'edu', 'festive', 'formal', 'health', 'mono', 'tech', 'v1', 'v2'] as const
const ORIS = ['9:16', '16:9'] as const
const MAX_SECTIONS = 10         // 每节 3 镜 ⇒ 最多消费 30 镜（与 deck-preview 同上限）
const BULLET_MAX = 28           // 引擎要点窗口上限（gen-deck W.iBullets，与 deck-preview 同窗）
const BULLET_MIN = 8            // ★VF_WINFIX_V1（2026-10-05 用户实测「退出码 1 · 已跑 0s」）：schema 硬约束 pageBullets.items.minLength=8
                                //   （deck.schema.json 实测：要点每条 ≥8 字，短了整节被丢 → GEN-TOO-FEW-PAGES → exit 1）。
                                //   之前过滤线是 6/4 字 ⇒ 6~7 字要点混进节里 → 节凑不齐 3 条落窗 → 整节丢弃。一律对齐 8。
const COVER_MIN = 4             // 同上：meta.title 硬性 ≥4 字（封面主标题短于 4 字 = GEN-VALIDATE-FAILED 直接红）
const TIMEOUT_MS = 420000       // 渲染步超时（与 deck-preview 同值；TTS/混音各步另有独立超时）

/** ★VF_AVIMG_V1：跑一条命令并收集输出（超时 kill；**不抛异常**，失败回 code!=0 —— 引擎各步/ffmpeg 共用） */
function runCmd(cmd: string, args: string[], opts: { cwd?: string; timeoutMs: number }): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    try {
      const ch = spawn(cmd, args, { windowsHide: true, cwd: opts.cwd })
      let s = ''
      const push = (d: any) => { s = (s + String(d)).slice(-20000) }
      ch.stdout.on('data', push)
      ch.stderr.on('data', push)
      const t = setTimeout(() => { try { ch.kill() } catch { /* ignore */ } resolve({ code: -2, out: s }) }, opts.timeoutMs)
      ch.on('error', (e: any) => { clearTimeout(t); resolve({ code: -1, out: s + '\n' + String(e?.message || e) }) })
      ch.on('close', (c: number | null) => { clearTimeout(t); resolve({ code: c, out: s }) })
    } catch (e: any) { resolve({ code: -1, out: String(e?.message || e) }) }
  })
}

/** SRT 时间戳（00:00:00,000） */
function srtTime(t: number): string {
  const tt = Math.max(0, t)
  const h = Math.floor(tt / 3600), m = Math.floor((tt % 3600) / 60), s = Math.floor(tt % 60)
  const ms = Math.round((tt - Math.floor(tt)) * 1000)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`
}

/** ffprobe 取媒体时长（秒；失败回 0） */
async function probeDur(f: string): Promise<number> {
  const r = await runCmd('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { timeoutMs: 15000 })
  const d = parseFloat(String(r.out || '').trim())
  return Number.isFinite(d) && d > 0 ? d : 0
}

/** 四条成片线的草稿 tag（★VF_DRAFT_ISOLATE_V1：一律 equals 精确匹配；素材线含历史旧 tag） */
const DRAFT_TAGS = ['vf_draft_base', 'vf_draft', 'vf_draft_ai', 'vf_draft_mix', 'vf_draft_video']

/** 解析 `VF_DECK_CONFIRM:{...}` 协议串（白名单校验；非法值回默认 v1 / 9:16，绝不透传给 spawn） */
export function deckConfirmArgsOf(m: string): { skin: string; ori: string } {
  let skin = 'v1'
  let ori = '9:16'
  try {
    const raw = String(m || '').replace(/^VF_DECK_CONFIRM\s*:\s*/, '').trim()
    const o = raw ? JSON.parse(raw) : {}
    if (typeof o?.skin === 'string' && (DECK_SKINS as readonly string[]).includes(o.skin)) skin = o.skin
    if (typeof o?.ori === 'string' && (ORIS as readonly string[]).includes(o.ori)) ori = o.ori
    // 兼容字段名 orientation（与 deck-preview 路由的入参同名）
    if (typeof o?.orientation === 'string' && (ORIS as readonly string[]).includes(o.orientation)) ori = o.orientation
  } catch { /* 解析失败用默认值 */ }
  return { skin, ori }
}

/* ---------------- ★VF_FONTFIT_V1（2026-10-05 用户实测「180s 单失败、30s 单成功」） ----------------
 * render-deck 有道**字体覆盖闸门**（exit 8）：内嵌字体是子集（fonts/chars-cmn.txt = GB2312 一级
 * 3755 字 + ASCII + 常用标点，共 3926 码点）—— deck 里出现表外字（二级字表汉字如 婷/鑫/喆、emoji、
 * 特殊符号）⇒ 闸门红 ⇒ batch-video 报 render=8 未找到产物 ⇒ **整单红**。文案越长撞表外字概率越大，
 * 所以 30 秒短文案过了、180 秒长文案炸了。
 * 闸门本身不能放宽（服务器无 CJK 系统字体，缺字真会渲豆腐块）⇒ 在 copy.md 的**两个出口**（AI 版
 * sanitizeDeckMd + 规则映射 buildRuleMd）把表外字符**删除**：硬保证必过闸门；删了哪些字收集进
 * fontRemoved，由 runDeckVideoTask 打日志/落任务文件（用户可见，不静默吞字）。
 * 后续优化（待做）：把字表扩到 GB2312 全量 6763 字（需重跑 make-fonts.py 生成 woff2），
 * 「婷/鑫」这类营销文案高频字就不必删了。 */
let FONT_SET: Set<string> | null = null
let fontRemoved: string[] = []
function fontSet(): Set<string> {
  if (FONT_SET !== null) return FONT_SET
  try {
    FONT_SET = new Set(fs.readFileSync(path.join(vfRootDir() || '', 'scripts', 'video-factory', 'html-deck', 'fonts', 'chars-cmn.txt'), 'utf8'))
  } catch { FONT_SET = new Set() }   // 引擎不在（本地开发机）⇒ 空表 = 不净化
  return FONT_SET!
}
/** 表外字符删除（换行/制表保留）；删掉的字符收集进 fontRemoved（调用方读走打日志） */
const fitFont = (t: string): string => {
  const s = fontSet()
  if (!s.size) return t
  let out = ''
  for (const ch of String(t || '')) {
    if (s.has(ch) || ch === '\n' || ch === '\r' || ch === '\t') out += ch
    else fontRemoved.push(ch)
  }
  return out
}

/**
 * ★VF_DECKCOPY_V1（2026-10-04 用户定案「两套文案：口播给配音字幕、要点给 PPT」）——
 * 校验/清洗 AI 生成的 PPT 版文案（markdown）。**不合格返回 ''**（调用方退回规则映射，不硬塞）：
 *   · 只接受从第一个 `# ` 开始的正文（剥掉代码栅栏/前后废话）；
 *   · 封面标题/副题限长（引擎窗口：标题 ≤16 字；副题 <6 字不收）；
 *   · ★VF_PAGEMIX_V1（2026-10-05 用户实测「PPT 全是 1.2.3 列表、数据/图标排版没用」）：
 *     节型从「只认 3 条要点」放行为 **5 类形状**（gen-deck 是确定性解析器——页型由 md 形状决定）：
 *     · 要点节：≥3 条条目（8~28 字）→ bullets/summary 页（段行会成 bullets.summary）
 *     · 流程节：标题含 步/阶段/流程 + 条目 → steps 页（gen-deck 判）
 *     · 对比节：标题含 对比/差别/比较/vs + ≥4 条目 + 前 2 段行=左右标签 → compare 页
 *     · 数据节：1 条短数字行（数字开头 ≤28 字）+ ≥2 条「标签：说明」段行 → data 页
 *     · 表格节：≥4 行 `| 标签 | 数值 |` → chart 页
 *     校验只管「每节身体够不够成页」；落不落窗由 gen-deck 自己判（它有降级链 + validate 兜底）。
 *   · 节 ≥2 个、上限 MAX_SECTIONS 节。
 */
export function sanitizeDeckMd(md: string): string {
  // ★VF_DECKRESCUE_V1（2026-10-05 用户实测整单红「GEN-TOO-FEW-PAGES 只生成 2 页」根因三连）：
  //   ① 表格节致死：okSec 只数「表格行 ≥4」就当图表节、且**把 items 扔了**——AI 写「表头+分隔+2 行数据」
  //     （凑 4 行）时 gen-deck 的图表分支要 **数据行 ≥4**（rows 不含表头/分隔）⇒ 图表落空 ⇒ 节里既没
  //     items 也没 paras ⇒ sectionToPage=null **整节被丢**。全篇这种节 = cover+end = 恰好 2 页。
  //     修复：数**数据行**（剥分隔行）；数据行 ≥4 才发表格、且表后**保留 items/段行**（图表落空还能救成要点页）。
  //   ② 短步骤致死：步骤/对比点窗口 min=6（schema steps.items/cmpPts），prompt 也说 6~28，但收集线
  //     一刀切 BULLET_MIN=8 ⇒ 6~7 字步骤全被丢 ⇒ 流程节凑不齐 3 条整节死。修复：≥6 就收（8~28 的
  //     强条目 ≥3 保 bullets 兜底；纯短步骤只在标题含 步/阶段/流程 时放行——gen-deck steps 窗口收 6 字起）。
  //   ③ 粗体/【标签】致死：AI 爱 `**94%…**` / 行首 `【数据节】` ⇒ 数字行不以数字开头（数据节丢）、
  //     假副题混进封面。修复：行预处理剥 `**` 和行首【…】。
  const lines = String(md || '').replace(/```[a-z]*\n?/gi, '').split('\n')
    // ★VF_FONTFIT_V1：表外字符在**判长度之前**删掉（净化后跌破窗口的条目被丢是正常收缩，不会死锁）
    .map((l) => fitFont(l.replace(/\*\*|__/g, '').replace(/^【[^】]{0,10}】\s*/, '').trim())).filter(Boolean)
  const start = lines.findIndex((l) => /^#\s+\S/.test(l))
  if (start < 0) return ''
  const body = lines.slice(start)
  // ★VF_WINFIX_V1：封面主标题 ≥4 字（meta.title 硬约束）—— 短了这版 md 直接判不合格
  const cover = body[0].replace(/^#\s+/, '').slice(0, 16).trim()
  if (cover.length < COVER_MIN) return ''
  let coverSub = ''
  // ★VF_WINFIX_V1：副题 <6 字留着也进不了任何窗口（pageEnd.line2 需 0~30 但观感差）—— 短于 6 字直接不收
  if (body[1] && !/^(##\s|[-*]\s|#\s|\||\d+[.、)])/.test(body[1]) && body[1].trim().length >= 6) coverSub = body[1].slice(0, 24).trim()
  // ★VF_PAGEMIX_V1：按形状收集节（条目/段行/表格分行保管——重建 md 时保留形状，页型交给 gen-deck）
  type Sec = { title: string; items: string[]; paras: string[]; table: string[] }
  const secs: Sec[] = []
  let cur: Sec | null = null
  const isItemL = (l: string) => /^[-*]\s+\S/.test(l) || /^\d+[.、)]\s+\S/.test(l)
  const stripItemL = (l: string) => l.replace(/^[-*]\s+/, '').replace(/^\d+[.、)]\s+/, '').trim()
  for (const l of body.slice(coverSub ? 2 : 1)) {
    const h = l.match(/^##\s+(.*)$/)
    if (h) { if (cur) secs.push(cur); cur = { title: h[1].slice(0, 16).trim(), items: [], paras: [], table: [] }; continue }
    if (!cur) continue
    if (/^\|.*\|/.test(l)) { cur.table.push(l); continue }
    // ★VF_DECKRESCUE_V1：≥6 就收（步骤/对比点窗口 min=6）；8~28 的强条目在 okSec 里单独数
    if (isItemL(l)) { const t = stripItemL(l).slice(0, BULLET_MAX); if (t.length >= 6) cur.items.push(t); continue }
    cur.paras.push(l.slice(0, 40))      // 段行：数据节的数字行/标签行、对比节的左右标签、要点节的 summary
  }
  if (cur) secs.push(cur)
  // 每节 → md 行（保留形状）或 null（不够成页）：
  //   ① 表格**数据行** ≥4 → chart 候选（表后保留段行+条目：gen-deck 图表落空时条目还能救成要点页）；
  //   ② 强条目（8~28）≥3 → bullets/steps/compare 候选（段行带上：bullets.summary/compare 左右标签从段行取）；
  //     纯短条目（6~7 字）只在标题含 步/阶段/流程 时放行（gen-deck steps 窗口 min=6）；
  //   ③ 段行 ≥3 且含数字行 → data 候选
  const tableDataRows = (rows: string[]) => rows.filter((r) => {
    const cells = r.trim().replace(/^\||\|$/g, '').split('|').map((x) => x.trim())
    return !/^[-:\s|]+$/.test(cells.join(''))          // 与 gen-deck 同口径：剥分隔行
  })
  const okSec = (s: Sec): string[] | null => {
    if (!s.title) return null
    const rows = tableDataRows(s.table)
    const itemLines = s.items.map((x) => '- ' + x)
    if (rows.length >= 4) {
      // 与 gen-deck 同口径（series ≥4 个可读数值）判图表能不能成；**成不了不丢节**：
      // 降成「- 标签：值」条目（还能救成要点/摘要页）
      const cellsOf = (r: string) => r.trim().replace(/^\||\|$/g, '').split('|').map((x) => x.trim())
      const numeric = rows.filter((r) => Number.isFinite(Number(String(cellsOf(r)[1] ?? '').replace(/[^\d.\-]/g, ''))))
      if (numeric.length >= 4) return ['## ' + s.title, ...s.table, ...s.paras.slice(0, 2), ...itemLines]
      const asItems = rows.map((r) => {
        const c = cellsOf(r)
        return '- ' + String(c[1] !== undefined && c[1] !== '' ? `${c[0]}：${c[1]}` : c[0]).slice(0, BULLET_MAX)
      }).filter((x) => x.length - 2 >= 6)
      if (asItems.length >= 3) return ['## ' + s.title, ...s.paras.slice(0, 2), ...asItems, ...itemLines]
      return null
    }
    const strong = s.items.filter((x) => x.length >= BULLET_MIN && x.length <= BULLET_MAX)
    if (strong.length >= 3) return ['## ' + s.title, ...s.paras.slice(0, 2), ...itemLines]
    if (/步|阶段|流程/.test(s.title) && s.items.length >= 3 && s.items.every((x) => x.length >= 6)) {
      return ['## ' + s.title, ...s.paras.slice(0, 2), ...itemLines]
    }
    const hasNum = s.paras.some((p) => /^[0-9][\d,.，]*\s*(%|分钟|小时|天|条|次|元|万|倍|个|人|秒|K|k)?/.test(p) && p.length <= 28)
    if (s.paras.length >= 3 && hasNum) return ['## ' + s.title, ...s.paras]
    return null
  }
  const good = secs.map(okSec).filter((x): x is string[] => !!x).slice(0, MAX_SECTIONS)
  if (good.length < 2) return ''
  // ★VF_DECKRESCUE_V1：**必须 flatMap**——上一版误写成 map（嵌套数组没摊平），join('\n') 把每个节
  //   toString 成「## 标题,要点,要点,…」**一行**⇒ gen-deck 只见到 1 行假标题 ⇒ 全部节被丢 ⇒
  //   「只生成 2 页」整单红（2026-10-05 用户实测 vf1791195178923）。端测教训：**必须过 sanitize 再喂
  //   gen-deck**（只喂手写 md 测不到这条）。
  return (['# ' + cover, coverSub, '', ...good.flatMap((ls) => [...ls, ''])]
    .filter((l) => l !== undefined).join('\n').replace(/\n{3,}/g, '\n\n').trim()) + '\n'
}

/** 草稿正文历史上串过线（"AI制片草稿:{...}"）—— 只取 JSON 部分 */
function parseDraftContent(content: string): any {
  const s = String(content || '').trim()
  try { return JSON.parse(s) } catch { /* 走下面的兜底 */ }
  const a = s.indexOf('{'), b = s.lastIndexOf('}')
  if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)) } catch { /* ignore */ } }
  return null
}

/**
 * 找该用户**任一条**停在出片确认步的草稿（step='script' 且有分镜）。
 * 四条线各查各的 tag，取 updatedAt 最新的一条 —— 正常任一时刻只有一条线在走；
 * 多条并存（历史残留）时取最新，与用户在确认卡上看到的是同一条。
 */
export async function findDeckConfirmDraft(db: any, uid: number | string): Promise<{ draft: any; tag: string } | null> {
  try {
    let best: { draft: any; tag: string; ts: number } | null = null
    for (const tag of DRAFT_TAGS) {
      const row = await db.agentMemory.findFirst({
        where: { userId: String(uid), tags: { equals: tag } },
        orderBy: { updatedAt: 'desc' },
      })
      if (!row?.content) continue
      const d = parseDraftContent(String(row.content))
      if (!d || d.step !== 'script' || !Array.isArray(d.shots) || !d.shots.length) continue
      const ts = row.updatedAt ? new Date(row.updatedAt).getTime() : 0
      if (!best || ts > best.ts) best = { draft: d, tag, ts }
    }
    return best ? { draft: best.draft, tag: best.tag } : null
  } catch { return null }
}

/**
 * 【正式出片】把同一份分镜交给 HTML 逐帧引擎后台渲染（不 await 引擎——与老链 make.py 同为后台任务）。
 * 返回 { ok:true, taskId, cost } = 已入队；{ ok:false, msg } = 人话原因（预检失败/余额不足/引擎缺失/文字太少）。
 * 扣费时机：**渲染成功入库后**才扣（失败不扣；与老链 I2V_BILL_V1 的"没生成出来不收"同精神）。
 */
export async function runDeckVideoTask({ uid, draft, skin, ori, deckMd, db, log }: {
  uid: number | string
  draft: any
  skin: string
  ori: string
  /** ★VF_DECKCOPY_V1：AI 转写的 PPT 版文案（已经 sanitizeDeckMd 校验；空/缺省 = 走规则映射兜底） */
  deckMd?: string
  /** ★VF_AVIMG_V1：prisma 句柄 —— BGM 选曲（mediaAsset 音乐库）用；缺省 = 本次不配乐 */
  db?: any
  log?: (u: any, m: string) => void
}): Promise<{ ok: boolean; taskId?: string; cost?: number; msg?: string }> {
  const uidS = String(uid)
  const uidN = Number(uid) || 0        // checkTokens/spendTokens 要 number（route.ts 老链同口径）
  const vflog = (m: string) => { try { (log || (() => {}))(uidS, m) } catch { /* ignore */ } }
  try {
    const shots: any[] = Array.isArray(draft?.shots) ? draft.shots : []
    if (!shots.length) return { ok: false, msg: '没有可出片的分镜' }

    // ── 计费（与老链 make_ai_video ★VF_COSTFIX_V1 同公式）：script 优先，无则分镜 subtitle/text 总和 ──
    let chars = String(draft?.script || '').length
    if (!chars) chars = shots.reduce((a: number, s: any) => a + String((s && (s.subtitle || s.text)) || '').length, 0)
    const cost = Math.max(1, Math.ceil(chars / 20))
    const chk = await checkTokens(uidN, cost)
    if (!chk?.allowed) return { ok: false, msg: String(chk?.message || '点数不足') }

    // ── 分镜 → copy.md（与 /api/agent/vf/deck-preview 同一映射：首 title 镜=封面；每 3 镜并一节；引擎自动尾页）──
    // ★VF_DECKCOPY_V1：有 AI 转写的 PPT 版文案（deckMd 已校验）就直接用 —— 两套文案口径：
    //   口播版（draft.script）给配音/字幕；要点版（deckMd）给 PPT。deckMd 为空才走下面的规则映射。
    let copyMd = String(deckMd || '').trim()
    let byScript = false            // 走了"文案切句"兜底（任务文件里记一笔，诊断用）
    const fromAi = !!copyMd         // ★VF_DECKRESCUE_V1：copy.md 来自 AI 转写（gen-deck 阶段整建制失败时回退规则映射重跑）
    // ★VF_DECKRESCUE_V1（2026-10-05 用户实测整单红「GEN-TOO-FEW-PAGES 只生成 2 页」）：规则映射
    //   提取成闭包——deckMd 为空时直接用；**AI 版文案在 gen-deck 整建制失败**（节形状全不合引擎胃口，
    //   如弱表格节被整节丢弃）时也用它**救援重跑一次**。规则映射产出的 md 形状固定（引擎验证过的
    //   路径），AI 文案再怪也死不了单——宁可全要点页，不整单红。
    const buildRuleMd = (): { md?: string; err?: string; byScript?: boolean } => {
    const bulletOf = (s: any): string => {
      // ★VF_FONTFIT_V1：分镜文字先过字体净化（表外字在判窗之前删，跌破窗口如实丢）
      const text = fitFont(String(s?.text || '')).trim()
      const sub = fitFont(String(s?.subtitle || '')).trim()
      let b = text && sub && text !== sub ? `${text}：${sub}` : (text || sub)
      if (b.length > BULLET_MAX) b = b.slice(0, BULLET_MAX - 1) + '…'
      return b.length >= BULLET_MIN ? b : ''       // ★VF_WINFIX_V1：≥8 字才落窗（6~7 字会被引擎整节丢弃）
    }
    const mid = shots.slice(1).map(bulletOf).filter(Boolean)
    // ★VF_DECKCONFIRM_V1（2026-10-04 用户实测「7 镜仍被拦」）：图视混剪等线的分镜里**视频镜多、文字镜少**，
    //   过滤后常 < 6 条（引擎最低 = 封面 + 2 内容节 × 3 要点 + 尾页）。分镜要点本来就把文案切走了，
    //   所以**按文案全文切句补足**（内容仍 100% 来自用户自己的文案，不编造、不凑数）。
    //   文案也切不出 6 条（文案本身太短）才如实报错 —— 此时新引擎确实做不出结构完整的 PPT。
    let viaScript = false
    if (mid.length < 6) {
      const midN = mid.length
      // ★VF_SCRIPTCHUNK_V1（2026-10-05 用户实测整单失败「可用要点 5 条，文案切句也不足 6 条」）：
      //   老切句只按句末标点切 + <8 字整句丢 —— 口播文案天然多短句（「未来已来」「立即预约」），
      //   短句被丢光就凑不齐 6 条。三步增强（内容 100% 仍来自用户文案，不编造）：
      //   ① <8 字碎句与后一句合并（逗号连接，不超 28 字窗口）
      //   ② >28 字长句按逗号/顿号二次切，片段贪心合并进 8~28 窗口（替代粗暴截断加…）
      //   ③ 合并后仍 <8 字的孤句如实丢（schema minLength=8 硬约束，短了整节被引擎丢弃）
      const raws = fitFont(String(draft?.script || ''))
        .split(/[。！？!?；;\n]+/).map((x) => x.trim()).filter(Boolean)
      const merged: string[] = []       // ★VF_SCRIPTCHUNK_V1：碎句向后合并 + 长句逗号二切
      for (const s of raws) {
        const last = merged[merged.length - 1]
        if (last !== undefined && last.length < BULLET_MIN && last.length + s.length + 1 <= BULLET_MAX) {
          merged[merged.length - 1] = `${last}，${s}`
        } else merged.push(s)
      }
      const sents: string[] = []
      for (const s of merged) {
        if (s.length <= BULLET_MAX) { if (s.length >= BULLET_MIN) sents.push(s); continue }
        let cur = ''
        for (const p of s.split(/[，、]/).map((x) => x.trim()).filter(Boolean)) {
          if (cur && cur.length + p.length + 1 > BULLET_MAX) { if (cur.length >= BULLET_MIN) sents.push(cur); cur = p }
          else cur = cur ? `${cur}，${p}` : p
        }
        if (cur && cur.length >= BULLET_MIN) sents.push(cur)
      }
      if (sents.length >= 6) {
        mid.splice(0, mid.length, ...sents)
        viaScript = true
        vflog(`[新引擎出片] 分镜要点只有 ${midN} 条不足 6 → 按文案切句（碎句合并+长句二切）得 ${sents.length} 条出 PPT（内容不变，仍是你自己的文案）`)
      }
    }
    if (mid.length < 6) {
      return { err: `分镜可用的文字太少（可用要点 ${mid.length} 条，文案切句也不足 6 条，新引擎至少需要 6 条）。回「重试」重排分镜，或在设置卡把成片方式换回「图文成片」走老引擎。` }
    }
    const lines: string[] = []
    const first = shots.find((s) => String(s?.text || '').trim() || String(s?.subtitle || '').trim())
    // ★VF_WINFIX_V1：封面主标题必须 ≥4 字（meta.title 硬约束；短了 = GEN-VALIDATE-FAILED 整单红）
    // ★VF_FONTFIT_V1：封面同样先净化（表外字删掉后短于 4 字 = 用兜底词，不让封面成为缺字源头）
    const covRaw = fitFont(String(first?.text || '')).trim() || '营销内容成片'
    const covT = covRaw.length >= COVER_MIN ? covRaw : '营销内容成片'
    lines.push(`# ${covT}`, fitFont(String(first?.subtitle || '')).trim(), '')
    let u = 0
    for (let i = 0; i + 3 <= mid.length && u < MAX_SECTIONS; i += 3, u++) {
      const grp = mid.slice(i, i + 3)
      lines.push(`## ${grp[0].split('：')[0].slice(0, 12)}`, ...grp.map((b) => `- ${b}`), '')
    }
    return { md: lines.filter((l) => l !== '').join('\n') + '\n', byScript: viaScript }
    }
    if (copyMd) {
      // ★VF_DECKRESCUE_V1：AI 版文案直接用（节型混排）；gen-deck 阶段失败才回退规则映射
    } else {
      const r = buildRuleMd()
      if (r.err) return { ok: false, msg: r.err }
      copyMd = String(r.md || '')
      byScript = !!r.byScript
    }

    // ── 引擎在位检查（standalone 部署下用 vfRootDir 多候选找，与 make_ai_video 同防线）──
    // ★VF_AVIMG_V1：不再经 make-video 一把梭（它中间不开放改 deck）——直接编排
    //   gen-deck →（注入图片页/页时长）→ batch-video →（自己混音），因此两个工具都要在位。
    const engDir = path.join(vfRootDir() || '', 'scripts', 'video-factory', 'html-deck')
    const genP = path.join(engDir, 'gen-deck.mjs')
    const batchP = path.join(engDir, 'batch-video.mjs')
    if (!fs.existsSync(genP) || !fs.existsSync(batchP)) {
      return { ok: false, msg: '服务端缺少 html-deck 引擎（scripts/video-factory/html-deck 未部署）' }
    }

    // ── 任务目录 + 任务文件（与老链同形状 → make-video-status 轮询/入库/推送全复用）──
    const outDir = path.join(vfStorageRoot(), uidS, 'video-factory')
    fs.mkdirSync(outDir, { recursive: true })
    const taskId = 'vf' + Date.now()
    const taskFile = path.join(outDir, taskId + '.json')
    const writeTask = (o: Record<string, any>) => {
      try {
        let prev: any = {}
        try { prev = JSON.parse(fs.readFileSync(taskFile, 'utf-8')) || {} } catch { /* 首次写 */ }
        fs.writeFileSync(taskFile, JSON.stringify({ ...prev, ...o }, null, 2))
      } catch { /* 任务文件写失败不阻塞渲染本体 */ }
    }
    writeTask({ id: taskId, status: 'running', startedAt: new Date().toISOString(),
      cost, script: String(draft?.script || '').slice(0, 200), engine: 'deck', skin, ori, uid: uidS,
      byScript: byScript || undefined })

    // ── 后台渲染（不 await；★VF_AVIMG_V1 分步管线：BGM选曲 → gen-deck → 注入图片页/页时长
    //    → 逐句TTS → 自产SRT → batch-video 渲染+烧字幕 → 混音(配音±BGM) → 入库/扣费。
    //    异常全部就地消化（只落任务文件，绝不炸掉聊天主流程））──
    const workDir = path.join(outDir, 'deck_' + Date.now())
    fs.mkdirSync(workDir, { recursive: true })
    const mdP = path.join(workDir, 'copy.md')
    fs.writeFileSync(mdP, copyMd, 'utf8')
    writeTask({ work: workDir })
    vflog(`[新引擎出片] 入队 ${taskId}：skin=${skin} ${ori} · 报价 ${cost} 点（=文案费；配音/BGM/图片页不另收费）`)

    let so = ''
    const push = (s: string) => { so = (so + '\n' + s).slice(-20000) }

    const finishFail = async (reason: string) => {
      // ★VF_WINFIX_V1：从引擎输出抓最后一条 ✗[XXX-YYY] 结论行当原因（退出码对人没信息量）
      const tagLine = (so.match(/✗\s*\[[A-Z][A-Z-]+\][^\n]*/g) || []).pop() || ''
      const why = tagLine ? reason + '：' + tagLine.trim().slice(0, 90) : reason
      writeTask({ status: 'failed', finishedAt: new Date().toISOString(), error: why, tail: so.split('\n').filter(Boolean).slice(-40) })
      vflog(`[新引擎出片] 失败：${why}（不扣点）`)
    }
    const finishOk = async (mp4: string, pagesN: number) => {
      const finishedAt = new Date().toISOString()
      const { readFile } = await import('node:fs/promises')
      const { saveToPersonalRepo } = await import('@/lib/personal-storage')
      const { signedUrl } = await import('@/lib/oss')
      const buf = await readFile(mp4)
      const { name } = await saveToPersonalRepo({ userId: uidS, buffer: buf, ext: 'mp4', mime: 'video/mp4' })
      const url = await signedUrl(`storage/${uidS}/${name}`, 86400)
      writeTask({ status: 'done', finishedAt, out: mp4, repoName: name, url, pages: pagesN, tail: so.split('\n').filter(Boolean).slice(-40) })
      // 扣费：渲染成功入库后才扣（失败不扣）
      spendTokens(uidN, cost, 'make_ai_video').catch(() => {})
      vflog(`[新引擎出片] 成功：${name}（skin=${skin} ${ori} · ${pagesN} 页 · 实扣 ${cost} 点）`)
      try { fs.rmSync(workDir, { recursive: true, force: true }) } catch { /* 清理失败不影响结果 */ }
    }

    const runDeck = async () => {
      // ── ⓪ ★VF_FONTFIT_V1：字体净化日志（copy.md 生成时删掉的表外字——可见、不静默吞字）──
      if (fontRemoved.length) {
        const uniq = [...new Set(fontRemoved)]
        vflog(`[字体净化] 删 ${fontRemoved.length} 个字体子集外的字符（字库没刻这些字，留着会触发字体闸门整单失败）：${uniq.slice(0, 30).map((c) => `${c}(U+${c.codePointAt(0)!.toString(16).toUpperCase()})`).join(' ')}`)
        writeTask({ fontSanitized: uniq.slice(0, 60).join('') })
        fontRemoved = []
      }
      // ── ① BGM（draft.bgm==='auto' → AI 音乐库挑最新一首下载；老链 chat/route.ts 同源逻辑）──
      let bgmP = ''
      if (String(draft?.bgm || '') === 'auto' && db) {
        try {
          const m: any = await db.mediaAsset.findFirst({ where: { source: 'public', type: 'audio', category: 'music' }, orderBy: { createdAt: 'desc' } })
          if (m?.ossUrl) {
            const rb = await fetch(String(m.ossUrl), { signal: AbortSignal.timeout(30000) })
            if (rb.ok) {
              bgmP = path.join(workDir, 'bgm.mp3')
              fs.writeFileSync(bgmP, Buffer.from(await rb.arrayBuffer()))
              push(`[BGM] 已选音乐库曲目：${String(m.title || '').slice(0, 20)}`)
            }
          } else push('[BGM] 音乐库无公开曲目 → 本次无配乐')
        } catch (e: any) { push('[BGM] 失败（不阻塞）: ' + String(e?.message || e).slice(0, 80)) }
      }

      // ── ② gen-deck：copy.md → base.json（配色取母版首项 = make-video 默认口径）──
      let pal = ''
      try {
        const mf = JSON.parse(fs.readFileSync(path.join(engDir, 'masters', 'master-' + skin, 'master.json'), 'utf8'))
        pal = String(Object.keys(mf.palette || {})[0] || '')
      } catch { /* 下一步会如实报错 */ }
      if (!pal) { await finishFail(`读取母版配色失败（masters/${skin}）`); return }
      const baseP = path.join(workDir, 'base.json')
      const genSrtP = path.join(workDir, 'gen.srt')
      const genArgs = ['--in', mdP, '--out', baseP, '--srt', genSrtP, '--master', 'master-' + skin, '--palette', pal]
      let g = await runCmd(process.execPath, [genP, ...genArgs], { cwd: engDir, timeoutMs: 180000 })
      push(g.out)
      // ★VF_DECKRESCUE_V1（2026-10-05 用户实测整单红「gen-deck 退出码 1：GEN-TOO-FEW-PAGES 只生成 2 页」）：
      //   AI 版文案的节形状若全不合引擎胃口（弱表格节整节被丢等）⇒ gen-deck 产不出 4 页。**回退规则映射
      //   文案重跑一次**（内容 100% 仍来自用户分镜/文案——宁可全要点页，不整单红）。规则映射也建不出
      //   （分镜+文案文字本来就 <6 条）才如实失败。
      if (g.code !== 0 && fromAi) {
        const r = buildRuleMd()
        if (r.md) {
          copyMd = r.md
          fs.writeFileSync(mdP, copyMd, 'utf8')
          push('[救援] AI 版文案 gen-deck 失败 → 已回退规则映射文案重跑一次（内容不变，仍是你自己的文案）')
          // ★VF_FONTFIT_V1：救援版文案的净化记录也打出来（buildRuleMd 生成时收集的表外字）
          if (fontRemoved.length) {
            const uniq = [...new Set(fontRemoved)]
            push(`[字体净化] 删 ${fontRemoved.length} 个字体子集外的字符：${uniq.slice(0, 30).join(' ')}`)
            writeTask({ fontSanitized: uniq.slice(0, 60).join('') })
            fontRemoved = []
          }
          writeTask({ rescued: true, byScript: r.byScript || undefined })
          g = await runCmd(process.execPath, [genP, ...genArgs], { cwd: engDir, timeoutMs: 180000 })
          push(g.out)
        }
      }
      if (g.code !== 0) { await finishFail(`gen-deck 退出码 ${g.code}`); return }

      // ── ③ 读 deck + 注入素材图帧（分镜 bgimage 镜 → pageImage；素材拷进派生档同目录 assets/，
      //      asset 字段用相对路径 —— validate-deck 的素材闸门按【派生档位置】解析）──
      const batchOut = path.join(workDir, 'batch')
      const assetsDir = path.join(batchOut, 'decks', 'assets')
      let deck: any = null
      try { deck = JSON.parse(fs.readFileSync(baseP, 'utf8')) } catch { await finishFail('base.json 解析失败'); return }
      // ★VF_MATDOM_V1（2026-10-05 用户定案「素材图必有、量要大于 PPT；帧是帧、不用每张图背 PPT 页」）：
      //   素材帧数 = min(可用图镜, max(句子预算, PPT页数+1))：
      //   · 句子预算 = 口播句数 − PPT 页数 —— 每帧可背 1 句配音（voice-over 快闪：旁白在图帧上继续，
      //     总时长 ≈ 音频长度 + 0.4s×页数，不再因图帧膨胀）；
      //   · 下限 = PPT 页数 + 1 —— 口播句再少也保证「素材图必有 + 量 > PPT」（分不到句子的帧 2.5s 纯快闪）。
      //   页数窗口：schema maxItems 已 12→40（deck.p40-test 40 页实测渲染通过 · exit 0）。
      const narrText = String(draft?.script || '').trim()
        || shots.map((s: any) => String(s?.subtitle || s?.text || '')).filter(Boolean).join('。')
      const narrSents: string[] = narrText.split(/[。！？!?；;\n]+/).map((x: string) => x.trim()).filter((x: string) => x.length >= 2).slice(0, 40)
      const pptN = Array.isArray(deck?.pages) ? deck.pages.length : 0
      const imgShotsAll = shots.filter((s: any) =>
        /^(bgimage|image)$/i.test(String(s?.type || '')) && /\.(jpe?g|png|webp)$/i.test(String(s?.src || '')) && fs.existsSync(String(s?.src))
      )
      const imgN = Math.min(imgShotsAll.length, Math.max(narrSents.length - pptN, Math.min(imgShotsAll.length, pptN + 1)))
      const imgShots = imgShotsAll.slice(0, imgN)
      if (imgShots.length && Array.isArray(deck?.pages) && deck.pages.length >= 2) {
        try { fs.mkdirSync(assetsDir, { recursive: true }) } catch { /* ignore */ }
        const imgPages: any[] = []
        for (let i = 0; i < imgShots.length; i++) {
          const src = String(imgShots[i].src)
          const ext = (src.match(/\.(\w+)$/)?.[1] || 'jpg').toLowerCase()
          const dst = path.join(assetsDir, 'img_' + i + '.' + ext)
          try { fs.copyFileSync(src, dst) } catch { continue }
          // ★VF_FONTFIT_V1：图片页 title/caption 也进 deck ⇒ 同样过字体净化（表外字删，短于窗口如实跳过）
          const t = fitFont(String(imgShots[i]?.text || '')).trim()
          const title = t.length >= 4 ? t.slice(0, 24) : '现场画面'      // pageImage.title 硬性 4~24
          const capRaw = fitFont(String(imgShots[i]?.subtitle || '')).trim()
          const pg: any = { type: 'image', title, asset: 'assets/img_' + i + '.' + ext, layout: ori === '9:16' ? 'full' : (i % 2 ? 'right' : 'left'), duration: 2.5 }
          if (capRaw.length >= 8) pg.caption = capRaw.slice(0, 48)        // caption 给了就 ≥8
          imgPages.push(pg)
        }
        // ★VF_FONTFIT_V1：素材帧文字的净化记录落任务 tail（copy.md 的记录已在 ⓪ 打过并清空）
        if (fontRemoved.length) {
          push(`[字体净化] 素材图帧文字删 ${fontRemoved.length} 个字体子集外的字符：${[...new Set(fontRemoved)].slice(0, 20).join(' ')}`)
          fontRemoved = []
        }
        // 穿插：素材帧均摊到各内容页后（总页数 ≤40 —— schema maxItems；end 恒最后）
        const oldPages: any[] = deck.pages
        const nGap = Math.max(1, oldPages.length - 2)      // 内容页数 = 可插帧的缝隙数
        const perGap = Math.ceil(imgPages.length / nGap)   // 每缝插几张（均摊，不堆在一个缝里）
        const np = [oldPages[0]]
        let ii = 0
        for (let i = 1; i < oldPages.length - 1; i++) {
          np.push(oldPages[i])
          for (let k = 0; k < perGap && ii < imgPages.length; k++) { np.push(imgPages[ii]); ii++ }
        }
        np.push(oldPages[oldPages.length - 1])
        deck.pages = np
        push(`[素材帧] 注入 ${ii} 张素材图（> PPT ${pptN} 页 · 多数帧背 1 句配音 voice-over · ${ori === '9:16' ? '全幅' : '左/右图'}）`)
        fs.writeFileSync(baseP, JSON.stringify(deck, null, 2) + '\n', 'utf8')
      }

      // ── ④ 逐句 TTS（口播文案 → 配音；复用老链 ttsQwen3：百炼→硅基→火山三级降级）──
      const voice = String(draft?.voice || 'longxiaochun')
      const sents = narrSents      // ★VF_MATDOM_V1：③ 已按同一口径切好（注入帧数也用它），不重复切
      type Sent = { text: string; file: string; dur: number }
      const voiceSents: Sent[] = []
      if (sents.length) {
        const { ttsQwen3 } = await import('@/lib/qwen3-tts')
        const ttsDir = path.join(workDir, 'tts')
        fs.mkdirSync(ttsDir, { recursive: true })
        for (let i = 0; i < sents.length; i++) {
          const r = await ttsQwen3(sents[i], voice, ttsDir, i)
          const est = Math.max(1.2, Math.round((sents[i].length / 4.2) * 10) / 10)   // 失败句按 4.2 字/秒估时长占位
          voiceSents.push({ text: sents[i], file: r.ok ? r.path : '', dur: r.ok ? Math.max(0.8, r.duration || est) : est })
          if (!r.ok) push(`[TTS] 第${i + 1}句合成失败 → 静默 ${est}s 占位（字幕照常）`)
        }
        push(`[配音] ${voiceSents.length} 句 · 音色 ${voice} · 总时长≈${voiceSents.reduce((a, b) => a + b.dur, 0).toFixed(1)}s`)
      } else push('[配音] 无口播文案 → 静默版（字幕用页面文案）')

      // ── ⑤ 页时长按配音分配 + 自产 SRT（字幕=口播内容 ⇒ 与页面大字不再同文重复）──
      const pages: any[] = Array.isArray(deck?.pages) ? deck.pages : []
      let srtP = genSrtP
      if (voiceSents.length && pages.length) {
        // ★VF_MATDOM_V1（2026-10-05 用户定案「素材图必有、量大于 PPT」）：句子在【全部页】上
        //   按累计时长均分 —— 素材帧页也背 ~1 句配音（voice-over：旁白在图帧上继续，观感是
        //   「PPT 讲一句 → 素材图配一句」交替推进）。总时长 ≈ 音频长度 + 0.4s×页数，不因图帧膨胀。
        //   （B+C 旧版「图帧不背旁白=静默快闪」会让 20 帧 ×2.5s 白加 50s —— 句子本来就是稀缺资源，
        //    让每帧既出画面又承接旁白，两头都赚。）
        const totalDur = voiceSents.reduce((a, b) => a + b.dur, 0)
        const target = totalDur / pages.length
        const groups: Sent[][] = pages.map(() => [])
        let k = 0, acc = 0
        for (const s of voiceSents) {
          groups[Math.min(k, pages.length - 1)].push(s); acc += s.dur
          if (k < pages.length - 1 && acc >= target) { k++; acc = 0 }
        }
        // 页时长 = 本页句子 + 0.4s 呼吸；无句页保留原时长；clamp 1~30（schema 硬窗）
        const pageDur: number[] = pages.map((p: any, i: number) => {
          const d = groups[i].reduce((a, b) => a + b.dur, 0)
          if (!d) return Math.max(1, Math.min(30, Number(p?.duration) || 3))
          return Math.max(1, Math.min(30, Math.round((d + 0.4) * 10) / 10))
        })
        pages.forEach((p: any, i: number) => { p.duration = pageDur[i] })
        fs.writeFileSync(baseP, JSON.stringify(deck, null, 2) + '\n', 'utf8')
        // SRT：句内按 竖屏≤12/横屏≤22 字切块（video-task-manager 同款节奏）
        // ★VF_SUBATOM_V1（2026-10-05 用户实测字幕三连伤：「，点击率8.5%」逗号开头条 /「出」单字条 /
        //   「3分|钟出」数字+单位拦腰切断 —— SUBCHUNK 的定宽盲切+回退在没标点的长句里防不住）：
        //   改为**原子块贪心打包**——① 数字原子（数字串+千分位+可选 %/K/万/+ +可选中文单位）词内不断；
        //   ② 英文单词按词不断；③ 标点必粘前块（块永不以句读开头）；④ 句读后块长过半即收
        //   （优先断点，宁可短块不硬撑）；⑤ <2 字碎块并回相邻块（消灭单字条）。
        const chunkSub = (t: string, max: number): string[] => {
          const UN = '个只条次倍分秒天点年月日小时张套元万'
          const atoms: string[] = []
          let i = 0
          while (i < t.length) {
            const mN = t.slice(i).match(new RegExp('^[0-9][0-9,.，]*[%％KkMmBb]?[' + UN + ']{0,2}[+＋]?'))
            if (mN && mN[0]) { atoms.push(mN[0]); i += mN[0].length; continue }
            const mE = t.slice(i).match(/^[A-Za-z][A-Za-z'.-]*/)
            if (mE) { atoms.push(mE[0]); i += mE[0].length; continue }
            atoms.push(t[i]); i++
          }
          const PUNCT = '，。、；：！？…—～,.!?;:)）】」"'
          const MAJOR = '，。、；！？'
          const out: string[] = []
          let cur = ''
          const emit = () => { const c = cur.trim(); if (c) out.push(c); cur = '' }
          for (const a of atoms) {
            if (PUNCT.includes(a)) {                    // 标点永不开头：粘当前块（空块则粘上一块尾）
              if (cur) {
                cur += a
                if (MAJOR.includes(a) && cur.length >= Math.ceil(max * 0.55)) emit()   // 句读=优先断点
              } else if (out.length) out[out.length - 1] += a
              continue
            }
            if (cur && cur.length + a.length > max) emit()   // 放不下 → 先收前块（长原子允许微超宽）
            cur += a
          }
          emit()
          const fin: string[] = []                       // 碎块合并：<2 字并给相邻块
          let pending = ''
          for (const c of out) {
            if (c.length < 2) { pending += c; continue }
            fin.push(pending ? pending + c : c); pending = ''
          }
          if (pending) { if (fin.length) fin[fin.length - 1] += pending; else fin.push(pending) }
          return fin
        }
        const subMax = ori === '9:16' ? 12 : 22
        const srtLines: string[] = []
        let tCur = 0, idx = 1
        for (let i = 0; i < pages.length; i++) {
          let inPage = 0
          for (const s of groups[i]) {
            const chunks: string[] = chunkSub(s.text, subMax)      // ★VF_SUBATOM_V1：原子块打包（数字/英文/单位不断）
            const chunkDur = s.dur / Math.max(1, chunks.length)
            for (const ch of chunks) {
              srtLines.push(`${idx}\n${srtTime(tCur + inPage)} --> ${srtTime(tCur + inPage + chunkDur)}\n${ch}`)
              idx++
              inPage += chunkDur
            }
          }
          tCur += pageDur[i]
        }
        srtP = path.join(workDir, 'voice.srt')
        fs.writeFileSync(srtP, srtLines.join('\n\n') + '\n', 'utf8')
        // 配音轨：每页 concat(句音频/静默) + apad 补齐页时长 → 全片拼接（44100 立体声统一参数）
        const pageAudioFiles: string[] = []
        for (let i = 0; i < pages.length; i++) {
          const pgOut = path.join(workDir, 'pg' + i + '.m4a')
          const inputs: string[] = []
          for (const s of groups[i]) {
            if (s.file) { inputs.push(s.file); continue }
            const sil = path.join(workDir, `sil_${i}_${inputs.length}.m4a`)
            const rSil = await runCmd('ffmpeg', ['-nostdin', '-y', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-t', String(s.dur), '-c:a', 'aac', sil], { timeoutMs: 30000 })
            if (rSil.code === 0 && fs.existsSync(sil)) inputs.push(sil)
          }
          if (!inputs.length) {
            const rS = await runCmd('ffmpeg', ['-nostdin', '-y', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-t', String(pageDur[i]), '-c:a', 'aac', pgOut], { timeoutMs: 30000 })
            if (rS.code !== 0) push(`[配音] 第${i + 1}页静默生成失败（忽略）`)
          } else {
            const fc = inputs.map((_, k) => `[${k}:a]`).join('') + `concat=n=${inputs.length}:v=0:a=1,apad=whole_dur=${pageDur[i]}[a]`
            const r = await runCmd('ffmpeg', ['-nostdin', '-y', ...inputs.flatMap((f) => ['-i', f]), '-filter_complex', fc, '-map', '[a]', '-t', String(pageDur[i]), '-ar', '44100', '-ac', '2', '-c:a', 'aac', pgOut], { timeoutMs: 60000 })
            if (r.code !== 0) push(`[配音] 第${i + 1}页音频失败（忽略）`)
          }
          if (fs.existsSync(pgOut) && fs.statSync(pgOut).size > 100) pageAudioFiles.push(pgOut)
        }
        if (pageAudioFiles.length) {
          const voiceP = path.join(workDir, 'voice.m4a')
          if (pageAudioFiles.length === 1) fs.copyFileSync(pageAudioFiles[0], voiceP)
          else {
            const fc = pageAudioFiles.map((_, k) => `[${k}:a]`).join('') + `concat=n=${pageAudioFiles.length}:v=0:a=1[a]`
            const r = await runCmd('ffmpeg', ['-nostdin', '-y', ...pageAudioFiles.flatMap((f) => ['-i', f]), '-filter_complex', fc, '-map', '[a]', '-ar', '44100', '-ac', '2', '-c:a', 'aac', voiceP], { timeoutMs: 60000 })
            if (r.code !== 0 || !fs.existsSync(voiceP)) push('[配音] 音轨拼接失败 → 本次无声（不因此判失败）')
          }
        }
      }

      // ── ⑥ batch-video：渲染 + 烧字幕（--srt；音频不交给它 —— 配音不能被当 BGM 压音量，⑦自己混）──
      const b = await runCmd(process.execPath, [batchP, '--base', baseP, '--skins', 'master-' + skin, '--orientations', ori, '--palette', pal, '--srt', srtP, '--outdir', batchOut], { cwd: engDir, timeoutMs: TIMEOUT_MS })
      push(b.out)
      if (b.code !== 0) { await finishFail(`batch-video 退出码 ${b.code}`); return }
      const finalDir = path.join(batchOut, 'final')
      const finals: string[] = fs.existsSync(finalDir)
        ? fs.readdirSync(finalDir).filter((f) => /^final-.*\.mp4$/.test(f)).map((f) => path.join(finalDir, f))
        : []
      if (finals.length !== 1 || !(() => { try { return fs.statSync(finals[0]).size > 0 } catch { return false } })()) {
        await finishFail(`产物数异常（${finals.length} 条 MP4，应恰好 1）`); return
      }

      // ── ⑦ 混音（配音 ± BGM；argv 数组不过 shell + amix normalize=0 + 时长以视频为准
      //    —— 老链 render.py mux_audio 的三条现场教训原样继承）──
      let outMp4 = finals[0]
      const voiceP2 = path.join(workDir, 'voice.m4a')
      const hasVoice = fs.existsSync(voiceP2) && fs.statSync(voiceP2).size > 100
      if (hasVoice || bgmP) {
        const vd = (await probeDur(outMp4)) || pages.reduce((a: number, p: any) => a + (Number(p?.duration) || 3), 0)
        const mixP = path.join(workDir, 'final_mix.mp4')
        let args: string[]
        if (hasVoice && bgmP) {
          args = ['-nostdin', '-y', '-i', outMp4, '-i', voiceP2, '-stream_loop', '-1', '-i', bgmP,
            '-filter_complex', '[1:a]volume=1.0[voc];[2:a]volume=0.12[bg];[voc][bg]amix=inputs=2:duration=first:normalize=0[aout]',
            '-map', '0:v', '-map', '[aout]', '-c:v', 'copy', '-c:a', 'aac', '-t', String(vd), '-movflags', '+faststart', mixP]
        } else if (hasVoice) {
          args = ['-nostdin', '-y', '-i', outMp4, '-i', voiceP2, '-map', '0:v', '-map', '1:a',
            '-c:v', 'copy', '-c:a', 'aac', '-t', String(vd), '-movflags', '+faststart', mixP]
        } else {
          args = ['-nostdin', '-y', '-i', outMp4, '-stream_loop', '-1', '-i', bgmP,
            '-filter_complex', '[1:a]volume=0.18[aout]', '-map', '0:v', '-map', '[aout]',
            '-c:v', 'copy', '-c:a', 'aac', '-t', String(vd), '-movflags', '+faststart', mixP]
        }
        const r = await runCmd('ffmpeg', args, { timeoutMs: 180000 })
        push(`[混音] ${hasVoice ? '配音' : ''}${hasVoice && bgmP ? ' + BGM(0.12)' : bgmP ? 'BGM(0.18)' : ''}${r.code === 0 ? ' ✓' : ' 失败 → 交无音版'}`)
        if (r.code === 0 && fs.existsSync(mixP) && fs.statSync(mixP).size > 0) outMp4 = mixP
      }

      // ── ⑧ 入库/扣费/收尾（成功才扣 —— 与老链同规矩）──
      await finishOk(outMp4, pages.length)
    }
    runDeck().catch(async (e: any) => {
      const msg = '管线异常: ' + String(e?.message || e).slice(0, 160)
      try { await finishFail(msg) } catch { /* ignore */ }
      vflog('[新引擎出片] 管线异常: ' + String(e?.message || e).slice(0, 120))
    })
    return { ok: true, taskId, cost }
  } catch (e: any) {
    return { ok: false, msg: String(e?.message || e).slice(0, 160) }
  }
}
