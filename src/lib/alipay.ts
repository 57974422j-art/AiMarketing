import crypto from 'crypto'

// 支付宝对接（手写 RSA2 签名/验签，不依赖第三方 SDK）
// 算法：RSA2 = SHA256withRSA

export interface AlipayConfig {
  appId: string
  privateKey: string // 应用私钥 PEM（PKCS1/PKCS8 均可）
  publicKey: string // 支付宝公钥（可带/不带 PEM 头）
  gateway: string // https://openapi.alipay.com/gateway.do
  notifyUrl: string
  returnUrl?: string
  charset?: string
  signType?: string
  version?: string
}

const CHARSET = 'utf-8'
const SIGN_TYPE = 'RSA2'
const VERSION = '1.0'

/** 东八区 yyyy-MM-dd HH:mm:ss（支付宝要求） */
function alipayTimestamp(d = new Date()): string {
  const utc = d.getTime() + d.getTimezoneOffset() * 60000
  const cn = new Date(utc + 8 * 3600000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${cn.getFullYear()}-${p(cn.getMonth() + 1)}-${p(cn.getDate())} ${p(cn.getHours())}:${p(cn.getMinutes())}:${p(cn.getSeconds())}`
}

/** 过滤空值并按 ASCII 升序拼成 k=v&k=v */
function formatParams(params: Record<string, any>): string {
  return Object.keys(params)
    .filter(k => params[k] !== undefined && params[k] !== null && params[k] !== '')
    .sort()
    .map(k => `${k}=${params[k]}`)
    .join('&')
}

function normalizePrivateKey(key: string): string {
  let k = key.trim()
  if (!k.includes('-----BEGIN')) {
    k = `-----BEGIN RSA PRIVATE KEY-----\n${k}\n-----END RSA PRIVATE KEY-----`
  }
  return k
}

function normalizePublicKey(key: string): string {
  let k = key.trim()
  if (!k.includes('-----BEGIN')) {
    k = `-----BEGIN PUBLIC KEY-----\n${k}\n-----END PUBLIC KEY-----`
  }
  return k
}

/** RSA2 签名，返回 Base64 */
export function sign(params: Record<string, any>, privateKey: string): string {
  const content = formatParams(params)
  const signer = crypto.createSign('RSA-SHA256')
  signer.update(content, 'utf8')
  return signer.sign(normalizePrivateKey(privateKey), 'base64')
}

/** 用支付宝公钥验签（通知参数，sign 已在其中）。返回是否通过 */
export function verifySign(params: Record<string, any>, alipayPublicKey: string): boolean {
  const sig = params['sign']
  if (!sig) return false
  const verifyParams: Record<string, any> = { ...params }
  delete verifyParams['sign']
  delete verifyParams['sign_type']
  const content = formatParams(verifyParams)
  const verifier = crypto.createVerify('RSA-SHA256')
  verifier.update(content, 'utf8')
  try {
    return verifier.verify(normalizePublicKey(alipayPublicKey), sig, 'base64')
  } catch {
    return false
  }
}

/** 构造电脑网站支付（alipay.trade.page.pay）跳转 URL（前端 window.location 即可拉起支付宝收银台） */
export function buildPagePayUrl(cfg: AlipayConfig, bizContent: Record<string, any>): string {
  const params: Record<string, any> = {
    app_id: cfg.appId,
    method: 'alipay.trade.page.pay',
    charset: cfg.charset || CHARSET,
    sign_type: cfg.signType || SIGN_TYPE,
    timestamp: alipayTimestamp(),
    version: cfg.version || VERSION,
    notify_url: cfg.notifyUrl,
    return_url: cfg.returnUrl || cfg.notifyUrl,
    biz_content: JSON.stringify(bizContent),
  }
  params.sign = sign(params, cfg.privateKey)
  const query = Object.keys(params)
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
    .join('&')
  return `${cfg.gateway}?${query}`
}
