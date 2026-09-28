// 2026-08-23: 客户端浏览器登录态（内存，5 分钟有效）——agent 页上报，AI publish_content 查询
const globalMap = new Map<number, { accounts: { id: string; name: string; loggedIn: boolean }[]; updatedAt: number }>()
const TTL = 5 * 60 * 1000

/**
 * ★LOGIN_UNIFY_V1（2026-09-28）：同一账号可能【在 2 台机器同时登录】——
 *   原来是"整份覆盖"，两台机器上报会互相把对方的结果盖掉（AI 看到的永远是最后上报那台），
 *   于是出现"机器 A 登了抖音、机器 B 没登 → AI 说请先登录平台"这种自相矛盾。
 *   现在改成【按平台合并】：同一平台取更新的那份，不同平台互补（任一台登录了就算登录）。
 */
export function setBrowserStatus(userId: number, accounts: any[]) {
  const prev = globalMap.get(userId)
  const merged = new Map<string, any>()
  for (const a of (prev?.accounts || [])) if (a && a.id) merged.set(String(a.id), a)
  for (const a of (accounts || [])) {
    if (!a || !a.id) continue
    merged.set(String(a.id), { ...(merged.get(String(a.id)) || {}), ...a, updatedAt: Date.now() })
  }
  globalMap.set(userId, { accounts: [...merged.values()], updatedAt: Date.now() })
}
export function getBrowserStatus(userId: number) {
  const hit = globalMap.get(userId)
  if (!hit || Date.now() - hit.updatedAt > TTL) return []
  return hit.accounts
}
