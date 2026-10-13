/**
 * ★VF_DAILY_V19（2026-10-13 用户拍板「A 执行」= 本地镜像 + 同级扁平图）：
 *   **HTML 里的相对图名 → 本站签名短链** 的纯改写逻辑（从 `api/storage/htmlview/route.ts` 抽出来，
 *   就为了能单测 —— 这条规则错了，客户端里就是"一片黄底"，而闸门看不见）。
 *
 * 背景（为什么必须在服务端改写）：
 *   · 客户端预览 = 父页 fetch + `<iframe sandbox="allow-scripts" srcDoc>`（**无同源**）
 *     ⇒ 相对 `gen_..._p1.jpg` 会打到服务器站点的相对路径上（没有那条路由）⇒ 空图；
 *   · `/api/storage/file` 需要 cookie，而 sandbox 无同源的 iframe 发请求算跨站
 *     ⇒ SameSite=Lax 的会话 cookie 不一定带上 ⇒ 401；
 *   · `/f/<uid>/<名>?t=<过期>.<签名>` **不需要 cookie**、同站点 ⇒ iframe 里稳定出图。
 *
 * 本地那一路不受影响：仓库里的 HTML 仍是**相对扁平名**，与图同目录时离线双击也能看。
 */
import { fileLinkPath } from './file-link'

/** 个人仓库文件名口径（与读/删接口一致：**禁 `/`**，允许 `A-Za-z0-9._-`） */
export const REF_NAME_OK = /^[a-zA-Z0-9._\-]+$/

/** 是不是"站点内的相对引用"（只有这一类才改写） */
export function isRelativeRef(raw: string): boolean {
  const s = String(raw || '').trim()
  if (!s) return false
  if (/^(https?:)?\/\//i.test(s)) return false              // 绝对 / 协议相对
  if (/^(data|blob|mailto|tel|javascript):/i.test(s)) return false
  if (s.startsWith('#') || s.startsWith('/')) return false   // 页内锚点 / 站内绝对路径（已改写过的不再动）
  return true
}

/** 取相对引用的文件名（`images/1.jpg?v=2` → `1.jpg`）—— 与"镜像拍平"同口径 */
export function refFileName(raw: string): string {
  const noQ = String(raw || '').split(/[?#]/)[0]
  const parts = noQ.split('/').filter(Boolean)
  return parts.length ? parts[parts.length - 1] : ''
}

/**
 * 把 HTML 里的相对引用换成短链（纯函数）：
 *   `src="X"` / `src='X'` / `url(X)` / `url('X')` / `url("X")`
 *   —— 已是 http/data/#/`/` 开头的一律**不碰**（所以重复调用是幂等的）。
 * 返回：`done` = 改写了几个；`names` = 用到的图名（去重，供调用方报日志）。
 */
export function rewriteRelativeRefs(
  html: string,
  uid: string | number,
  secs = 7 * 86400,
): { html: string; done: number; names: string[] } {
  let done = 0
  const seen = new Set<string>()
  const sign = (raw: string): string | null => {
    const fn = refFileName(raw)
    if (!fn || !REF_NAME_OK.test(fn)) return null
    done++
    seen.add(fn)
    return fileLinkPath(uid, fn, secs)
  }
  let out = String(html || '')
  const run = (re: RegExp, wrap: (v: string) => string) => {
    out = out.replace(re, (m, ...args: any[]) => {
      const v = String(args[0] ?? '')
      if (!isRelativeRef(v)) return m
      const s = sign(v)
      return s ? wrap(s) : m
    })
  }
  run(/\bsrc\s*=\s*"([^"]*)"/g, (s) => `src="${s}"`)
  run(/\bsrc\s*=\s*'([^']*)'/g, (s) => `src='${s}'`)
  run(/url\(\s*"([^"]*)"\s*\)/g, (s) => `url("${s}")`)
  run(/url\(\s*'([^']*)'\s*\)/g, (s) => `url('${s}')`)
  run(/url\(\s*([^)'"]+?)\s*\)/g, (s) => `url(${s})`)
  return { html: out, done, names: Array.from(seen) }
}
