/**
 * ★VF_I2VSUIT_V1（2026-09-30 用户定案）——「图生视频只对『有主体可动』的素材开」的**纯函数分类器**。
 *
 * 用户原话（本文件的设计依据）：
 *   「3 张动图除了文字的没看出它动，只有一个光影闪过，**这钱花的不值**」「需要单独探讨」
 *   → 本轮定案：**i2v 只对『有主体可动』的素材开（海报 / 截图类花了钱也看不出动）**。
 *
 * 输入 = 该素材的**识别摘要文本**（summarizeMaterials / vlDescribeMaterial 的中文描述：
 *        含①主体物 ②标题/内容 ③色调 ④适合配什么文案；指纹缓存 .vl_cache.json 里存的就是它）。
 * 输出 = { ok, kind, reason } —— ok=false 表示"这一镜不注入首帧"（保持静态图 + 推拉/Ken Burns）。
 *
 * 为什么单独一个**纯函数、零依赖**文件（与 anti-ai.ts / material-pool.ts / i2v-plan.ts 同类）：
 *   · 分类是"花不花这笔钱"的规则，必须能被 scripts/vf-i2vsuit-selftest.ts 直接 import 跑
 *     （不联网、不烧钱、不碰数据库）；
 *   · i2v-plan.ts（计划/计费）与 vf-video.ts / chat/route.ts（两条成片线）必须用**同一份**关键词表
 *     —— 各写一份迟早漂移（本项目有过"报价 205 / 实扣 1500"的事故史）。
 *
 * 取舍（用户定案：**省钱优先**）：
 *   ① 命中"静态平面图"特征（界面/截图/海报/封面/图表/纯文字页/标题/logo/二维码…）→ **不做**
 *      （这些动起来也看不出，正是用户抱怨的那类）；
 *   ② 摘要缺失 / 判不出类型 → **默认不做**（宁可少花一笔，也不做"钱花了看不出动"的冤枉事）；
 *   ③ 用户想手动全开 → 设置卡可传 `i2v='all'`（见 i2v-plan.buildI2vShots），那时**完全跳过本分类器**。
 */

/** 分类结果 */
export interface I2vSuitResult {
  /** true = 这一镜值得开图生视频（有主体可动）；false = 保持静态（省钱） */
  ok: boolean
  /** 判定出的素材类型：interface / chart / poster / live / unknown（person|motion|object|scene|animal|vehicle 也归 live 桶） */
  kind: string
  /** 人类可读的判定理由（调用方原样写日志；中文、短句、可解释） */
  reason: string
}

/** 静态平面图（不做 i2v）的**强特征**：界面截图 / 数据图表 / 海报封面文字页 —— 命中一个就不做。
 *  分成 kind 三档只是为了日志好看（用户能从日志一眼看出"为什么这几张不做"）。 */
const STRONG_STATIC: Array<{ kind: string; reason: string; kw: string[] }> = [
  {
    kind: 'interface', reason: '界面/截图类 —— 动起来看不出',
    kw: ['界面', '截图', '录屏', '屏幕', '网页', '后台', '控制台', '仪表盘', '弹窗', '菜单栏', '工具栏', '状态栏'],
  },
  {
    kind: 'chart', reason: '数据图表/表格类 —— 静态平面图',
    kw: ['图表', '表格', '数据图', '看板', '折线图', '曲线图', '柱状图', '饼图'],
  },
  {
    kind: 'poster', reason: '海报/封面/文字页类 —— 动起来看不出',
    kw: ['海报', '封面', '宣传图', '拼贴', '纯文字', '文字页', '大字报', '标题卡', '二维码', 'logo', '水印'],
  },
]

/** 「有主体可动」（做 i2v）的**强特征**：人物 / 动作 / 实物 / 实拍场景 / 动物 / 车辆。 */
const SUIT: Array<{ kind: string; kw: string[] }> = [
  { kind: 'person', kw: ['人物', '真人', '模特', '员工', '顾客', '工人', '路人', '女孩', '男孩', '女士', '先生', '孩子', '团队', '人群', '店主', '服务生', '服务员', '主理人', '主播', '人'] },
  // ⚠️ 需求里的"手"没有直接收裸「手」（"二手/手续/高手/对手/随手"都会误命中）——
  //    改用安全形态：手持/手中/双手/手指/手掌（真正的"手在动"场景都跑不出这几个）。
  { kind: 'motion', kw: ['动作', '走', '跑', '跳', '挥手', '操作', '演示', '举起', '拿起', '试用', '制作', '搬运', '挥动', '转动', '手持', '手中', '双手', '手指', '手掌'] },
  { kind: 'object', kw: ['产品', '实物', '包装', '杯子', '瓶子', '盒子', '机器', '设备', '工厂', '车间', '门店', '店铺', '货架', '展台'] },
  { kind: 'scene', kw: ['街景', '风景', '天空', '水面', '海浪', '沙滩', '阳光', '山', '树', '花', '云', '夜景', '日落'] },
  { kind: 'animal', kw: ['宠物', '猫', '狗', '鸟', '鱼'] },
  { kind: 'vehicle', kw: ['汽车', '自行车', '摩托', '车'] },
]

/** 弱特征（没有强特征与 SUIT 时才算"不做"）：标题 / 参数等 —— 多是海报/说明书类。 */
const WEAK_STATIC: Array<{ kind: string; reason: string; kw: string[] }> = [
  { kind: 'poster', reason: '标题/参数类文字图 —— 静态平面图', kw: ['标题', '副标题', '参数'] },
]

/**
 * 归一化（**先拆掉"含 SUIT 关键词、实际却是静态平面图"的陷阱词**）：
 *   · 「手机界面」里的"手" → 会被 SUIT 的"手"…wait 不，SUIT 里没有裸"手"。真正要防的是👇：
 *   · 「人工智能」/「机器人」里的"人"、"手工/助手"里的"手"、"无人」—— 这些不是"人物"，
 *     会把界面截图误判成"有主体可动"（= 白花钱），所以先替换掉。
 * 归一化只做"替换"，绝不删除整段文本（保证关键词表仍能命中真正的静态特征）。
 */
function normalizeForSuit(s: string): string {
  return String(s == null ? '' : s)
    .toLowerCase()
    .replace(/人工智能/g, 'ai')
    .replace(/机器人/g, 'robot')
    .replace(/无人/g, 'nobody')
    .replace(/手机/g, 'phone')
    .replace(/助手/g, 'helper')
    .replace(/手工/g, 'handmade')
}

/** 命中任一关键词就返回该档（按数组顺序优先） */
function hitBucket<T extends { kw: string[] }>(t: string, buckets: T[]): T | null {
  for (const b of buckets) {
    for (const kw of b.kw) if (t.includes(kw)) return b
  }
  return null
}

/**
 * 核心分类器：**识别摘要文本 → 这一镜值不值得开图生视频**。
 *
 * 判定顺序（先"确定不做"、再"确定要做"、最后"弱特征/判不出 → 不做"）：
 *   ① 两段式识别的**分类前缀**（★VF_VLM_2STAGE_V1 的 【软件界面】/【海报】/【图表】/【实拍】）—— 最可靠；
 *   ② STRONG_STATIC 关键词（界面/截图/图表/海报/封面/纯文字/标题卡/二维码/logo…）→ 不做；
 *   ③ SUIT 关键词（人物/动作/产品/门店/街景/宠物…）→ 做；
 *   ④ WEAK_STATIC 关键词（标题/参数）→ 不做；
 *   ⑤ 都没有（含摘要为空）→ **不做**（省钱优先，用户定案）。
 */
export function classifyI2vMaterial(summary: string | null | undefined): I2vSuitResult {
  const raw = String(summary == null ? '' : summary).trim()
  if (!raw) return { ok: false, kind: 'unknown', reason: '没有识别摘要（判不出素材类型）—— 省钱优先，默认不做' }
  const t = normalizeForSuit(raw)

  // ① 分类前缀（最可靠：模型在第一段就把它归了类）
  if (t.includes('【实拍】')) return { ok: true, kind: 'live', reason: '实拍素材（有主体/场景）—— 动起来看得出效果' }
  if (t.includes('【软件界面】')) return { ok: false, kind: 'interface', reason: '界面/截图类 —— 动起来看不出' }
  if (t.includes('【海报】')) return { ok: false, kind: 'poster', reason: '海报/封面/文字页类 —— 动起来看不出' }
  if (t.includes('【图表】')) return { ok: false, kind: 'chart', reason: '数据图表/表格类 —— 静态平面图' }

  // ② 强静态特征（界面 / 图表 / 海报封面文字页）→ 不做
  //   先单独处理英文 "UI"：作为**独立单词**才认（子串匹配会误命中 guide/build 之类）。
  if (/(^|[^a-z])ui([^a-z]|$)/.test(t)) return { ok: false, kind: 'interface', reason: '界面/截图类 —— 动起来看不出' }
  const st = hitBucket(t, STRONG_STATIC)
  if (st) return { ok: false, kind: st.kind, reason: st.reason }

  // ③ 有主体可动 → 做
  const su = hitBucket(t, SUIT)
  if (su) return { ok: true, kind: su.kind, reason: '有主体可动（人物/产品/实拍场景）—— 动起来看得出效果' }

  // ④ 弱静态特征（标题/参数）→ 不做（多半是海报/说明书）
  const wk = hitBucket(t, WEAK_STATIC)
  if (wk) return { ok: false, kind: wk.kind, reason: wk.reason }

  // ⑤ 判不出 → 不做（省钱优先）
  return { ok: false, kind: 'unknown', reason: '判不出素材类型 —— 省钱优先，默认不做' }
}

/* ══════════════════ 摘要文本 → 「图片本地路径 → 摘要」映射 ══════════════════ */

/**
 * 从 summarizeMaterials 的输出里解析「素材名 → 识别摘要」。
 * 输出行形如：`图3（cover_a.jpg）：<中文描述>`（见 video-material.ts summarizeMaterials）。
 * 解析不出来的行直接忽略（宁可少几条 → 那几张判不出就不做，也不会串味）。
 */
export function parseMaterialSummaries(brief: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of String(brief || '').split(/\r?\n/)) {
    const m = /^图\s*\d+\s*[（(]([^）)]+)[）)]\s*[:：]\s*(.*)$/.exec(line.trim())
    if (m) {
      const name = m[1].trim()
      const desc = m[2].trim()
      if (name && desc) out[name] = desc
    }
  }
  return out
}

/**
 * `summarizeMaterials` 的 brief + downloadMaterials 的结果 → 「图片本地路径 → 识别摘要」映射。
 * 为什么按**本地路径**索引：i2v-plan.buildI2vPlan 拿到的 shots[].src 就是 downloadMaterials 的 localPath。
 * 为什么按**素材名**去 brief 里找：brief 里不含路径，只含 `图N（name）`。
 */
export function i2vSummaryByPath(brief: string, mats: any[] | null | undefined): Record<string, string> {
  const byName = parseMaterialSummaries(brief)
  const out: Record<string, string> = {}
  for (const m of Array.isArray(mats) ? mats : []) {
    const p = String(m?.localPath || '')
    const n = String(m?.name || '')
    if (p && n && byName[n]) out[p] = byName[n]
  }
  return out
}
