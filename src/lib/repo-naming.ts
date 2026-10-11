/**
 * ★VF_REPOSPLIT_V1（2026-10-11 用户定案）
 * =============================================================================
 * 用户原话：「生成物还是直接进了个人仓库，如果无法不进个人仓库 就在个人仓库内分
 *   原始素材，和生成素材。**分开**。时间编码也分开。」
 *
 * 为什么不是开子目录 `_gen/`（本来更"干净"，但整条链会碎）：
 *   · 读文件 `src/app/api/storage/file/route.ts:23` 的正则是 `^[a-zA-Z0-9._\-]+$` —— **不准有 `/`**
 *   · 删除   `src/app/api/storage/delete/route.ts:17` 同款正则 —— **删不掉**
 *   · 本地镜像 `electron/main.js:1965` 用 `path.basename()` —— **目录被静默剥掉**
 *   ⇒ 换成**平铺 + 文件名前缀**：`gen_YYYYMMDD_NNN.ext`。三处闸门一行都不用改，
 *     而"分类"与"独立编码"两个诉求都满足（前缀即分类；两个前缀各自计数，互不占号）。
 *
 * 命名口径（**唯一真源**，personal-storage 与列表接口都从这里取）：
 *   原始素材：`20261011_001.jpg`
 *   生成素材：`gen_20261011_001.mp4`   ← 生成物
 *   序号规则沿用 VF_NAMESEQ_V1/V2：**当天同类已有最大序号 + 1，不复用被删的空号**。
 *
 * ⚠️ 本文件是**纯函数**（不读盘、不碰 OSS）—— 判据必须能单测（temp/_repo/test.mjs）。
 */

/** 生成物文件名前缀（分类即前缀） */
export const GEN_PREFIX = 'gen_'

/** 历史/规划中的子目录前缀：只在"识别"时兼容，**不再往这里写**（见文件头三处闸门） */
const LEGACY_DIR = '_gen/'

/** 取 basename（兼容历史 `_gen/xxx.mp4` 这种带目录的 key） */
export function baseNameOf(key: string): string {
  const s = String(key || '')
  const i = s.lastIndexOf('/')
  return i >= 0 ? s.slice(i + 1) : s
}

/** 20261011 —— 日期前缀（本地时区，与旧实现一致） */
export function datePrefixOf(d: Date = new Date()): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}

/** 这个文件名/键是不是"生成物"（看前缀；顺手认下历史 `_gen/` 目录）
 *  ⚠️ 前缀要求**完整形态** `gen_YYYYMMDD_`：用户自己上传一个叫 `gen_我的图.jpg` 的文件**不算生成物**
 *  （否则会被 UI 归到"生成素材"、还会被排除出素材池 —— 那是误伤）。 */
export function isGeneratedName(nameOrKey: string): boolean {
  const key = String(nameOrKey || '')
  if (key.includes('/' + LEGACY_DIR) || key.startsWith(LEGACY_DIR)) return true
  return /^gen_\d{8}_\d{3}\./.test(baseNameOf(key))
}

/** 组装文件名：`20261011_001.jpg` / `gen_20261011_001.mp4` */
export function buildRepoName(opts: { datePrefix: string; seq: number; ext: string; gen?: boolean }): string {
  const ext = String(opts.ext || '').replace(/^\./, '').toLowerCase()
  const stem = `${String(opts.datePrefix)}_${String(Math.max(1, Math.floor(opts.seq))).padStart(3, '0')}`
  return (opts.gen ? GEN_PREFIX : '') + stem + '.' + ext
}

/** 列表前缀：素材按日期前缀列，生成物按 `gen_日期前缀` 列 ⇒ **两个序号空间天然分开** */
export function listPrefix(opts: { uid: string | number; datePrefix: string; gen?: boolean }): string {
  return `storage/${opts.uid}/${opts.gen ? GEN_PREFIX : ''}${opts.datePrefix}`
}

/**
 * 从"当天同类的已有对象名"里算下一个序号（**纯函数**，便于单测）。
 * 口径 = 旧实现的 VF_NAMESEQ_V1/V2：
 *   · 只认与本次**同类**的名字（gen 只看 gen_ 开头；素材只看非 gen_ 开头）
 *   · 取"当天已有最大序号 + 1"，**不复用被删掉的空号**（否则客户端按文件名判重会漏同步）
 *   · 都不带规范序号时退回 count + 1（老口径兜底）
 */
export function nextSeq(names: string[], opts: { datePrefix: string; gen?: boolean }): number {
  const gen = !!opts.gen
  const dp = String(opts.datePrefix)
  const re = new RegExp('^' + (gen ? 'gen_' : '') + dp + '_(\\d{3})\\.[A-Za-z0-9]+$')
  let seq = 1
  let sameKind = 0
  for (const raw of (Array.isArray(names) ? names : [])) {
    const base = baseNameOf(raw)
    if (isGeneratedName(base) !== gen) continue      // 两类互不干扰
    if (base.startsWith(dp) === false && !(gen && base.startsWith(GEN_PREFIX + dp))) continue
    sameKind++
    const m = re.exec(base)
    if (m) seq = Math.max(seq, Number(m[1]) + 1)
  }
  if (seq === 1 && sameKind > 0) seq = sameKind + 1     // 兜底：命名规范外的遗留
  return seq
}

/** 给列表接口用的一句话分类（前端按它分组显示） */
export function repoKind(nameOrKey: string): 'gen' | 'asset' {
  return isGeneratedName(nameOrKey) ? 'gen' : 'asset'
}

/* ═════════ ★VF_THUMBGC_V1（2026-10-12 收口「缩略图孤儿」）═════════
   病灶：删除接口 2026-10-10 才补上"连缩略图一起删"（VF_THUMBDEL_V1）⇒ **在那之前删掉的素材**，
   缩略图全都留在 `.thumbs/` 里（用户实测：真删了 70 个素材、缩略图全在，9.9MB 里大半是这种垃圾）；
   另外 `analyze/` 这类**别的线写的缩略图**（`.thumbs/analyze/xxx.jpg`）删除时也没人清。
   判定口径（纯函数）：`.thumbs/` 下的对象，若其"主文件"在仓库里**不存在** ⇒ 孤儿。
   主文件判定按**文件名主干 + 任意扩展名**（缩略图不一定是 .jpg、主文件可能被换过扩展名）。 */

/** 从 OSS 对象名列表里挑出**孤儿缩略图**（可直接 deleteObject 的完整 key） */
export function orphanThumbs(allKeys: string[]): string[] {
  const keys = (Array.isArray(allKeys) ? allKeys : []).map(String)
  const mains = new Set<string>()
  for (const k of keys) if (!k.includes('/.thumbs/')) mains.add(k)
  const exts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.mp4', '.mov', '.avi', '.mkv', '.webm']
  const out: string[] = []
  for (const k of keys) {
    const i = k.indexOf('/.thumbs/')
    if (i < 0) continue
    const rel = k.slice(i + '/.thumbs/'.length)          // 20261011_001.jpg ｜ analyze/x.jpg ｜ _gen/x.jpg
    const base = k.slice(0, i)
    // 主干可能有多种写法：`20261011_001`（去掉 .jpg）、或历史遗留的 `20261011_001.mp4`（缩略图名里带原扩展名）
    const stem = rel.replace(/\.[A-Za-z0-9]+$/, '')
    const stems = [stem]
    for (const e of exts) if (stem.toLowerCase().endsWith(e)) stems.push(stem.slice(0, -e.length))
    const hit = stems.some((s) => mains.has(base + '/' + s) || exts.some((e) => mains.has(base + '/' + s + e)))
    if (!hit) out.push(k)
  }
  return out
}
