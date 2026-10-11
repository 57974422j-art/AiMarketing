/**
 * ★VF_QUOTA_V2（2026-10-11 用户定案）—— 个人仓库配额的**唯一真源**
 * =============================================================================
 * 用户原话：「空间是 500M 到 450 就不给传了。」
 * 旧实现的问题（实测核对）：
 *   · **6 处**各写死一个 `500 * 1024 * 1024`（`personal-storage.ts:16`、`storage/files/route.ts:6`、
 *     `storage/save-digital-human/route.ts:6`、`storage/page.tsx:13`、`agent/selfcheck:164`、
 *     `admin/users/[userId]/storage:30,53`）；改口径要改 6 处，必然分叉；
 *   · **两套统计口径**：`storage/files` 的 `usedQuota()` 与 `personal-storage` 里各算一遍；
 *   · 统计时把 **`.thumbs/` 缩略图也计入**（那是系统自己产生的，不该占用户配额）；
 *   · 客户端还自己再判一次（`storage/page.tsx:42`）⇒ 客户端放行/服务端 413 交替出现。
 * 现口径（一处常量、一个函数、所有入口共用）：
 *   · `QUOTA_TOTAL`  = 500MB（**展示**用总量）
 *   · `QUOTA_REJECT` = 450MB（**拒传阈值**：已用 + 本次 > 450MB ⇒ 不给传，留 50MB 余量）
 *   · `quotaUsed()`  统计时**排除** `.thumbs/`（缩略图）与 `_gen/`（生成物，见下一步"生成物不进仓库"）
 */

export const QUOTA_TOTAL = 500 * 1024 * 1024   // 500MB —— 展示用
export const QUOTA_REJECT = 450 * 1024 * 1024  // 450MB —— 到这个值就不给传（用户定案）

/** 不计入用户配额的三类：缩略图（系统产生）、历史 `_gen/` 目录、**生成物**（`gen_日期_序号.ext`） */
const NOT_USAGE = /\/\.thumbs\/|\/_gen\/|\/gen_\d{8}_/

export const mb = (n: number): number => Math.round((n / 1024 / 1024) * 10) / 10

/**
 * 用户已用空间（字节）——**排除** `.thumbs/`、`_gen/`。
 * ⚠️ 列目录失败时**返回 -1**（而不是 0）：调用方据此**明确报错**，
 *    绝不能像旧实现那样"失败就当 0"⇒ 配额形同虚设（用户实测的"一会能传一会不能"来源之一）。
 */
export async function quotaUsed(uid: number | string): Promise<number> {
  try {
    // 惰性引入：纯函数（quotaCheck）单测时不需要拉起 OSS 客户端，也避免循环依赖
    const { listObjects } = await import('@/lib/oss')
    const objs = await listObjects(`storage/${uid}/`)
    return objs.filter((o) => !NOT_USAGE.test(String(o.name))).reduce((a, o) => a + (o.size || 0), 0)
  } catch {
    return -1
  }
}

/**
 * 配额判定：通过 ⇒ 返回 ''；不通过 ⇒ 返回**可直接给用户看的中文原因**。
 * `used < 0` ⇒ 统计失败 ⇒ 也拦（宁可不传，也不做"静默放行"）。
 */
export function quotaCheck(used: number, addBytes: number): string {
  if (used < 0) return '暂时无法统计已用空间（列目录失败），为避免超限这次没有保存，请重试'
  if (used + addBytes > QUOTA_REJECT) {
    return `存储空间不足（已用 ${mb(used)}MB / 上限 ${mb(QUOTA_REJECT)}MB，总空间 ${mb(QUOTA_TOTAL)}MB）`
      + '——请先删除不再需要的素材，或把素材下载到客户端本地仓库后删除云端的。'
  }
  return ''
}
