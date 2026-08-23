// 2026-08-23: 客户端浏览器登录态（内存，5 分钟有效）——agent 页上报，AI publish_content 查询
const globalMap = new Map<number, { accounts: { id: string; name: string; loggedIn: boolean }[]; updatedAt: number }>()
const TTL = 5 * 60 * 1000

export function setBrowserStatus(userId: number, accounts: any[]) {
  globalMap.set(userId, { accounts, updatedAt: Date.now() })
}
export function getBrowserStatus(userId: number) {
  const hit = globalMap.get(userId)
  if (!hit || Date.now() - hit.updatedAt > TTL) return []
  return hit.accounts
}
