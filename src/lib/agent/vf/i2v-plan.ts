/**
 * ★VF_VIDI2V_V1（2026-09-29 用户定案「图视混剪 → 逐镜图生视频，按 50 点/秒扣点」）
 * ——**纯函数模块，零 import**（不碰 prisma / OSS / 别的线）。
 *
 * 为什么单独一个文件（而不是写在 vf-video.ts 里）：
 *   ① 「同图去重 / 每片张数上限 / 计费秒数」是**花钱**的规则，必须能被自测脚本直接跑
 *      （scripts/vf-i2v-selftest.ts：ts-node 直接 import 本文件，不联网、不烧钱）；
 *   ② 出片侧（vf-video.ts）与报价侧（chat/route.ts 的 vfScriptCard + make_ai_video 计费）
 *      必须**同一份公式** —— 本项目出过「卡片报 205 点、实扣 1500 点」的事故，报价与实扣
 *      一旦各写一份，迟早又会漂移。
 *
 * ⚠️ 这里**不做 OSS 签名**：`image` 填的是【个人仓库 key】（storage/<uid>/xxx.jpg），由
 *    chat/route.ts 的 resolveImageToPublicUrl() 在**出片那一刻**现签 24h 直链
 *    （用户可能在设置卡上停几小时才点确认，提前签会过期）。
 * ⚠️ 首帧必须是**公网可达**的地址：供应商（MiniMax H3 / 百炼 wan）拿不到 cookie，
 *    也不能读服务器本地路径 → 所以只认「个人仓库 key」或「http(s) URL」。
 */

/** 每片默认最多让几张图动起来 —— 费用硬闸（一张图 4~8 秒 ≈ 200~400 点） */
export const VF_I2V_MAX_IMAGES = 6
/** 与 AI 制片 / animate_image 工具同口径：768P = 50 点/秒 */
export const VF_I2V_POINTS_PER_SEC = 50

export interface I2vShotRef {
  /** 1-based 镜号（与 chat/route.ts 的 args.i2vShots 契约、make.py 的 --mix 镜号一致） */
  index: number
  /** 个人仓库 key（storage/<uid>/xxx.jpg）或 http(s) 图片 URL */
  image: string
}

export interface I2vPlan {
  /** 交给 make_ai_video 的 args.i2vShots —— **含同一张图的后续镜**（它们复用那段动图，见 VF_I2V_CACHE_V1） */
  list: I2vShotRef[]
  /** 这次要计费的秒数 = **唯一图**首次出现的 dur 之和（同一张图只算一次，复用镜不额外计费） */
  sec: number
  /** 要动起来的唯一图张数（= 真正调用 H3 的次数） */
  images: number
  /** 同一张图还出现在哪些镜 —— 这些镜**复用同一段动图**（不额外计费）；日志用 */
  reuse: Array<{ image: string; indices: number[] }>
  /** 图不在个人仓库里（拿不到公网地址）→ 保持静态的**图**数 */
  skippedNoKey: number
  /** 超上限（默认 6 张）→ 保持静态的**图**数 */
  overCap: number
}

/**
 * 从最终分镜里挑出「要交给图生视频的镜」。
 *
 * 规则（用户定案 + 费用可控）：
 *   ① 只挑 `bgimage`（图片镜）—— 视频镜本来就是动态的，文字卡没有图；
 *   ② **同一张图只调一次 H3**（去重按图片本地路径），但**同图的后续镜也一起注入同一个首帧**：
 *      它们的 `image` 是同一张图 → make.py 按 ref_image URL 缓存，第二处起直接复用那段动图
 *      （零额外调用、零额外计费），所以观感上不会"同一张图一会儿动一会儿不动"；
 *   ③ **计费口径 = 唯一图**（`sec` 只累加每张图首次出现的 dur，复用镜不重复扣钱）；
 *   ④ 每片最多 `max`（默认 6）张**唯一图**，超出部分保持静态（日志如实说明"为控制费用只动了 N 张"）；
 *   ⑤ 拿不到公网地址的图（不在个人仓库里）→ 那一镜不注入首帧、保持静态，**绝不因此让整片失败**。
 *
 * @param shots      归一化后的最终分镜（每镜有 type / src / dur）
 * @param keyByPath  图片本地路径 → 个人仓库 key 的映射（由 downloadMaterials 的返回值建立）
 */
export function buildI2vPlan(
  shots: any[],
  keyByPath: Record<string, string> | Map<string, string>,
  max = VF_I2V_MAX_IMAGES,
): I2vPlan {
  const get = (p: string): string =>
    keyByPath instanceof Map ? (keyByPath.get(p) || '') : ((keyByPath || {})[p] || '')
  const arr = Array.isArray(shots) ? shots : []
  const seen = new Set<string>()                   // 已经处理过的图片路径（去重）
  const chosen = new Map<string, number[]>()       // 被选中生成的那张图 → 用到它的所有镜号
  const list: I2vShotRef[] = []
  let sec = 0
  let uniq = 0                                     // 真正要调用 H3 的【唯一图】张数（计费按它）
  let skippedNoKey = 0
  let overCap = 0

  for (let k = 0; k < arr.length; k++) {
    const s: any = arr[k]
    if (!s || s.type !== 'bgimage') continue
    const p = String(s.src || '').trim()
    if (!p) continue
    if (seen.has(p)) {                             // ★同一张图：第二处起【不再调用 H3】（省钱）
      const g = chosen.get(p)
      if (g) {
        g.push(k + 1)
        // ★VF_I2V_CACHE_V1（2026-09-29，main 定案）：这些镜**也带上同一个首帧**放进 list ——
        //   make.py 按 ref_image URL 缓存，第二次起直接复用那段已生成的动图（零额外调用、零额外计费）。
        //   以前这里是"跳过"→ 同一张图一会儿动一会儿不动，观感很突兀。
        list.push({ index: k + 1, image: String(get(p) || '') })
      }
      continue
    }
    seen.add(p)
    const key = get(p)
    if (!key) { skippedNoKey++; continue }         // ★拿不到公网地址 → 保持静态（不失败）
    if (uniq >= max) { overCap++; continue }       // ★上限保护（按【唯一图】算张数，费用可控）
    uniq++
    list.push({ index: k + 1, image: key })
    sec += Number(s.dur) || 0
    chosen.set(p, [k + 1])
  }

  const reuse = [...chosen.entries()]
    .filter(([, idx]) => idx.length > 1)
    .map(([image, indices]) => ({ image, indices }))
  return { list, sec: Math.round(sec * 100) / 100, images: uniq, reuse, skippedNoKey, overCap }
}

/* ══════════════════════ ★VF_I2V_REUSE_V1（2026-09-29 team-lead 要求）══════════════════════
 * 「构造 i2vShots」必须是一个**可复用的小函数**，不许写死在「图视混剪」那条线的出片分支里 ——
 * 老板在用「图片成片」（那条线也是素材镜 + 本地路径），后面可能要一并开图生视频。
 *
 * 怎么在别的线开（**默认只在图视混剪开启**，其它线要开就照下面三步调用同一个函数）：
 *   ① 那条线拿到"图片镜"的 shots（bgimage，src = 服务器本地路径）；
 *   ② const keyByPath = i2vKeyMap(await downloadMaterials(uid, imgs))   // 本地路径 → 仓库 key
 *   ③ const r = buildI2vShots({ shots, keyByPath, enabled: 用户开关 })
 *      → 出片时 { ...r.args } 拼进 make_ai_video；r.notes 直接写日志；
 *        r.plan.sec / r.points 给确认卡报价（与实扣同源）。
 *   注意：**签名（OSS 直链）统一由 chat/route.ts 的 resolveImageToPublicUrl 在出片那一刻做**，
 *   这里只负责"挑哪几镜、计多少秒"，所以不需要 uid，也不需要任何网络/OSS 依赖。
 * ══════════════════════════════════════════════════════════════════════════════════════════ */

/** downloadMaterials() 的返回值 → 「图片本地路径 → 个人仓库 key」映射（缺 key 的图会被跳过） */
export function i2vKeyMap(mats: any[] | null | undefined): Record<string, string> {
  const m: Record<string, string> = {}
  for (const it of Array.isArray(mats) ? mats : []) {
    if (it?.localPath && it?.key) m[String(it.localPath)] = String(it.key)
  }
  return m
}

export interface I2vBuildResult {
  /** 直接 `{ ...r.args }` 拼进 make_ai_video（没有可动的图时是空对象） */
  args: Record<string, any>
  plan: I2vPlan
  /** 让图动起来的点数（50 点/秒，同一张图只算一次） */
  points: number
  /** 人类可读的说明（调用方原样写日志：动了几张 / 为什么没动 / 哪些拿不到公网地址） */
  notes: string[]
}

/**
 * ★通用入口（任何成片线都能调）：分镜 → `make_ai_video` 的 i2v 入参 + 报价 + 日志话术。
 *
 * @param o.shots     归一化后的最终分镜
 * @param o.keyByPath 图片本地路径 → 个人仓库 key（用 i2vKeyMap() 从 downloadMaterials 结果建）
 * @param o.enabled   用户的「让图动起来」开关：'off'/false = 完全不开（**默认 'on'**）
 * @param o.max       每片最多几张图（默认 6，费用硬闸）
 * @param o.declareMix 是否顺带声明 source='mix' + mix=镜号（默认 true）——
 *                    chat/route.ts 的护栏要求：给了 i2vShots 却不声明来源会直接 TOOL_REJECT。
 *                    （声明 mix 同时让计费走"只算这几镜的秒数"口径 → 报价 = 实扣。）
 */
export function buildI2vShots(o: {
  shots: any[]
  keyByPath?: Record<string, string> | Map<string, string>
  enabled?: string | boolean
  max?: number
  declareMix?: boolean
}): I2vBuildResult {
  const enabled = o?.enabled !== false && String(o?.enabled ?? 'on') !== 'off'
  const max = Number(o?.max) > 0 ? Number(o.max) : VF_I2V_MAX_IMAGES
  const plan: I2vPlan = enabled
    ? buildI2vPlan(o?.shots || [], o?.keyByPath || {}, max)
    : { list: [], sec: 0, images: 0, reuse: [], skippedNoKey: 0, overCap: 0 }
  const notes: string[] = []
  if (!enabled) {
    notes.push('设置卡选了「保持静态」→ 一个首帧都不注入（也不额外计费）')
  } else if (plan.images) {
    // 注意措辞：注入的镜数 ≥ 唯一图张数（同图的后续镜也在名单里，靠 make.py 缓存复用同一段动图）
    notes.push(`让 ${plan.images} 张图动起来（注入第 ${plan.list.map((x) => x.index).join('、')} 镜；` +
      `计费按**唯一图** ${plan.images} 张 = ${plan.sec} 秒 ≈ ${i2vCostPoints(plan.sec)} 点，50 点/秒）`)
  } else {
    notes.push('本次没有要动的图（没有图片镜 / 图都不在个人仓库里）→ 全部静态图（0 点）')
  }
  // ★VF_I2V_CACHE_V1：第 2 处起是**复用同一段动图**（make.py 按 URL 缓存），不额外计费。
  if (plan.reuse.length) {
    notes.push('同一张图只生成一次、后面几镜复用同一段动图（不额外计费）：' +
      plan.reuse.map((r) => `第 ${r.indices.join('、')} 镜用同一张图`).join('；'))
  }
  if (plan.overCap) {
    notes.push(`上限 ${max} 张 → 为控制费用只动了 ${plan.images} 张，另有 ${plan.overCap} 张保持静态`)
  }
  if (plan.skippedNoKey) {
    notes.push(`有 ${plan.skippedNoKey} 张图不在个人仓库里（拿不到公网地址）→ 那一镜不注入首帧，保持静态图`)
  }
  const args: Record<string, any> = plan.list.length
    ? {
      i2vShots: plan.list,
      ...(o?.declareMix === false ? {} : { source: 'mix', mix: plan.list.map((x) => x.index).join(',') }),
    }
    : {}
  return { args, plan, points: i2vCostPoints(plan.sec), notes }
}

/** 让图动起来的点数（与 make_ai_video 的混合口径**逐字一致**：ceil(秒 × 50)） */
export function i2vCostPoints(sec: number): number {
  return Math.ceil(Math.max(0, Number(sec) || 0) * VF_I2V_POINTS_PER_SEC)
}

/**
 * 出片总价（★与 chat/route.ts 的 make_ai_video【混合口径】逐字一致，别改这里的加法顺序）：
 *   素材合成费 ceil(文案字数 / 20) + 让图动起来的秒数 × 50
 * 为什么抽出来：卡片报价与实扣必须同源（见本文件头部说明）。
 */
export function vfTotalCostPoints(charN: number, i2vSec = 0): number {
  return Math.max(1, Math.ceil(Math.max(0, Number(charN) || 0) / 20) + i2vCostPoints(i2vSec))
}
