/**
 * ★VF_FILELINK_V1（2026-10-12 用户原话「你至少包装一下 怎么这么现实出来了 连我服务器地址什么都搞出来了」）
 * =============================================================================
 * 病灶：交付回复里直接把 **OSS 原始签名地址**贴出来 ——
 *   `https://<bucket>.oss-cn-xxx.aliyuncs.com/storage/1/gen_xxx.html?OSSAccessKeyId=LTAI5t...&Signature=...`
 *   ⇒ 桶名、区域、AccessKeyId、内部 key 结构、userId 全暴露；看着也不专业。
 *
 * 现口径：对外只给**本站短链** `/f/<uid>/<文件名>?t=<过期时间>.<签名>`，
 *   由 `src/app/f/[uid]/[name]/route.ts` 校验签名后 **302 跳到真地址**（不代理流量、不落盘、无状态）。
 *   · 无数据库：签名 = HMAC(uid|name|exp)，16 位十六进制，够短；
 *   · 密钥来自环境（`AGENT_FILE_SECRET` → `JWT_SECRET` → `OSS_ACCESS_KEY_SECRET` 派生），不写在代码里；
 *   · `t` 里带过期时间 ⇒ 链接会自己失效（默认 7 天），过期后回应用里再出一份就有新链接；
 *   · 校验失败 = 403，过期 = 410（**分开报**，免得用户把"过期"当"坏了"）。
 *
 * ⚠️ 纯函数式设计（除了读环境变量），便于单测：`temp/_exp/daily/test-filelink.mjs`。
 */
import crypto from 'node:crypto'

function secret(): string {
  return String(
    process.env.AGENT_FILE_SECRET
    || process.env.JWT_SECRET
    || process.env.OSS_ACCESS_KEY_SECRET
    || 'vf-file-link-dev',
  )
}

/** 派生一把与用途绑定的密钥（不直接拿 OSS 密钥当 HMAC key） */
function key(): Buffer {
  return crypto.createHash('sha256').update('vflink|' + secret()).digest()
}

function sign(uid: string, name: string, exp: number): string {
  return crypto.createHmac('sha256', key()).update(`${uid}|${name}|${exp}`).digest('hex').slice(0, 16)
}

/** 生成短链路径（相对路径；调用方自己拼 origin）。`secs` 默认 7 天。 */
export function fileLinkPath(uid: string | number, name: string, secs = 7 * 86400): string {
  const u = String(uid)
  const exp = Math.floor(Date.now() / 1000) + Math.max(60, Math.floor(secs))
  return `/f/${encodeURIComponent(u)}/${encodeURIComponent(name)}?t=${exp}.${sign(u, name, exp)}`
}

/** 校验短链参数；返回 ok 与过期时间（`ok=false` 时看 exp 是否已过 ⇒ 410 还是 403） */
export function verifyFileLink(uid: string, name: string, t: string): { ok: boolean; exp: number } {
  const m = /^(\d{6,})\.([0-9a-f]{8,64})$/.exec(String(t || ''))
  if (!m) return { ok: false, exp: 0 }
  const exp = Number(m[1])
  if (!exp || exp < Math.floor(Date.now() / 1000)) return { ok: false, exp }
  const want = sign(uid, name, exp)
  const got = m[2]
  if (want.length !== got.length) return { ok: false, exp }
  try {
    if (!crypto.timingSafeEqual(Buffer.from(want), Buffer.from(got))) return { ok: false, exp }
  } catch { return { ok: false, exp } }
  return { ok: true, exp }
}
