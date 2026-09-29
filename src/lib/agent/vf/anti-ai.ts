/**
 * ★VF_ANTIAI_V1（2026-09-29 用户定案「按建议顺序执行」）——「反 AI 味清单」第一层：**服务端代码级**
 *
 * 由来：规划文档《待办与规划-20260928》4.2/4.3/4.4 的 **P0 ②**：
 *   「反 AI 味清单」出自 garden-skills 的 web-video-presentation，黑名单是——
 *     ✗ 紫粉渐变背景  ✗ 圆角卡片配彩色描边  ✗ 渐变药丸标签
 *     ✗ emoji 当图标  ✗ 假数据      ✗ 每步都挂 ken burns  ✗ 右下角角标
 *   原文把这一条判为「**全靠提示词自觉**」——本文件就是把它变成【代码级】：提示词只能"请求"，
 *   这里负责"兜住"：AI 写了 emoji / 编了数据 / 对比卡写太长，**在成片之前**就被清掉。
 *
 * 三层落地（分工，别搞混）：
 *   ① 提示词层：ANTI_AI_PROMPT —— 两个分镜 prompt（vf-video.ts 与 chat/route.ts）都拼它；
 *   ② 服务端校验层：本文件的 sanitizeAntiAiShots() —— 归一化之后、出片之前跑；
 *   ③ 渲染前校验层：render.py 的 anti_ai_check()（emoji / 连续同卡型）——最后一道网，只告警。
 *
 * 设计原则：**只做减法和降级，绝不"脑补"**。
 *   宁可这一镜朴素（标题卡、字数短一点），也不要 AI 味（emoji 图标 / 编出来的数据）。
 */

/** 拼进分镜提示词的「反 AI 味硬规矩」（两个 prompt 共用，免得两处走偏） */
export const ANTI_AI_PROMPT =
  `\n【反 AI 味硬规矩】（用户实测定过，违反即返工）\n` +
  `✗ 不许用 emoji 或符号当图标（👍✨🔥👉⭐ 之类）——画面文字只能是中文/数字/常用标点\n` +
  `✗ 不许编造数据：只有【文案里本来就出现的数字】才能做数字卡/图表卡；文案里没有数字，\n` +
  `   就【不许】用 number / chart 卡，改用 title / list / bgimage（宁可朴素，不要假数据）\n` +
  `✗ 不许"紫粉渐变背景 / 圆角卡片配彩色描边 / 渐变药丸标签"这类一眼 AI 的默认审美\n` +
  `✗ 不要每镜都用同一种运动（不要每镜都推近）——镜与镜之间要有静有动\n` +
  `✗ 不要在画面角落挂角标、水印、英文小字\n` +
  `✓ 卡型换着来：同一个卡型【不要连续超过 3 镜】（图 / 标题 / 列表 / 对比 交替出现）\n` +
  `✓ 对比卡文字要短：left 与 right 各 ≤8 字，leftDesc 与 rightDesc 各 ≤14 字（写长了画面不得不缩小字号）\n`

/** emoji / 装饰符号（不含 → ← 这类正文里常见的箭头） */
const EMOJI_RE =
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{20E3}\u{2122}\u{2139}]/gu

/** 去掉 emoji 与装饰符号（画面文字只留中文/数字/常用标点） */
export function stripEmoji(v: any): string {
  const s = String(v == null ? '' : v)
  return EMOJI_RE.test(s) ? s.replace(EMOJI_RE, '') : s
}

/** 文案里有没有"数字证据"（阿拉伯数字或百分号 —— 中文数词太常见，故意不算，避免误判成"有数据"） */
export function hasNum(v: any): boolean {
  return /[0-9０-９%％]/.test(String(v == null ? '' : v))
}

const TEXT_KEYS = ['text', 'title', 'left', 'right', 'leftDesc', 'rightDesc', 'label', 'cta', 'subtitle']

/**
 * 出片前的「反 AI 味」净化（**只减不增**）：
 *   ① 清 emoji/符号（text/title/left/right/说明/label/cta/items/subtitle）
 *   ② 对比卡限字数（left/right ≤8，说明 ≤14）——实测写长了渲染层只能把字号缩到 22px，观感差
 *   ③ 假数据兜底：number / chart 卡若【字幕里没有数字】，降级成 title 卡（不编造数据）
 * 返回新数组 + 人类可读的处理说明（调用方写进日志，便于回溯"AI 到底写了什么"）。
 */
export function sanitizeAntiAiShots(shots: any[]): { shots: any[]; notes: string[] } {
  const notes: string[] = []
  let emojiHits = 0
  let cmpShort = 0
  let numDrop = 0
  const out = (Array.isArray(shots) ? shots : []).map((s0: any) => {
    const s: any = { ...(s0 || {}) }
    // ① emoji / 符号
    for (const k of TEXT_KEYS) {
      if (typeof s[k] === 'string') {
        const nv = stripEmoji(s[k]).replace(/\s{2,}/g, ' ').trim()
        if (nv !== s[k]) { s[k] = nv; emojiHits++ }
      }
    }
    if (Array.isArray(s.items)) {
      s.items = s.items.map((it: any) => {
        if (it && typeof it === 'object') {
          const nv = typeof it.label === 'string' ? stripEmoji(it.label).trim() : it.label
          if (nv !== it.label) emojiHits++
          return { ...it, label: nv }
        }
        const nv = stripEmoji(it).trim()
        if (nv !== it) emojiHits++
        return nv
      })
    }
    // ② 对比卡限字数
    if (s.type === 'compare') {
      const cut = (v: any, n: number) => {
        const t = String(v == null ? '' : v).trim()
        if (t.length > n) { cmpShort++; return t.slice(0, n) }
        return v
      }
      s.left = cut(s.left, 8)
      s.right = cut(s.right, 8)
      s.leftDesc = cut(s.leftDesc, 14)
      s.rightDesc = cut(s.rightDesc, 14)
    }
    // ③ 假数据兜底（证据只认"字幕/标题里出现的数字"——AI 自己填的 value 不算证据）
    if (s.type === 'number' || s.type === 'chart') {
      if (!hasNum(s.subtitle) && !hasNum(s.title)) {
        numDrop++
        const t = String(s.label || s.title || s.text || '').slice(0, 12) || String(s.subtitle || '').slice(0, 10)
        s.type = 'title'
        s.text = t
        delete s.value
        delete s.suffix
        delete s.items
        delete s.chart
      }
    }
    return s
  })
  if (emojiHits) notes.push(`清掉 emoji/符号 ${emojiHits} 处（画面文字只留中文/数字）`)
  if (cmpShort) notes.push(`对比卡 ${cmpShort} 处文字超长已截短（左右 ≤8 字 / 说明 ≤14 字）`)
  if (numDrop) notes.push(`数字/图表卡 ${numDrop} 镜因【文案里没有数字】→ 已降级为标题卡（不编造数据）`)
  return { shots: out, notes }
}
