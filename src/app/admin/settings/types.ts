/** Settings 页面所有类型定义 */

// ====== 状态指示器 ======
export type StatusType = 'ok' | 'fail' | null

export interface StatusMap {
  [key: string]: StatusType
}

// ====== API Key 配置 ======
export interface ApiKeyState {
  deepseek: string
  volcano: string
  siliconflow: string
  dashscope: string
}

export interface ApiKeyVisibility {
  deepseek: boolean
  volcano: boolean
  siliconflow: boolean
  dashscope: boolean
}

export interface TestingState {
  deepseek: boolean
  volcano: boolean
  siliconflow: boolean
  dashscope: boolean
}

export interface TestResult {
  type: 'success' | 'error'
  message: string
}

// ====== OSS 配置 ======
export interface OSSConfig {
  region: string
  accessKeyId: string
  accessKeySecret: string
  bucket: string
}

// ====== TTS 配置 =====_
export interface TTSConfig {
  appId: string
  accessKey: string
  resourceId: string
}

export interface TTSVisibility {
  appId: boolean
  accessKey: boolean
  resourceId: boolean
}

// ====== 自动化引擎 =====_
export type QueryEngine = 'mediacrawler' | 'douyin-official'
export type ActionEngine = 'q1-adb' | 'fingerprint'

// ====== MediaCrawler ======
export type MCHealthStatus = 'idle' | 'checking' | 'ok' | 'fail'

// ====== 扫码登录 =====_
export type LoginStatus =
  | 'idle'
  | 'starting'
  | 'waiting_scan'
  | 'scanned'
  | 'confirmed'
  | 'success'
  | 'error'
  | 'timeout'
  | 'killed'

// ====== Cookie 状态 =====_
export type CookieStatus =
  | 'loading'
  | 'valid'
  | 'expired'
  | 'missing'
  | 'error'
  | 'unknown'

export interface CookieFile {
  name: string
  size: number
  modifiedAt: string
}

export interface CookieSummary {
  totalFiles: number
  totalSize: number
}

// ====== IP 代理池 =====_
export interface ProxyItem {
  id: string
  host: string
  port: string
  protocol: 'http' | 'https' | 'socks5'
  username: string
  password: string
  label: string
  region: string
  enabled: boolean
  testStatus?: 'ok' | 'slow' | 'fail'
  testLatencyMs?: number
}

export interface NewProxyForm {
  host: string
  port: string
  protocol: 'http' | 'https' | 'socks5'
  username: string
  password: string
  label: string
  region: string
}

export interface ProxyStats {
  total: number
  enabled: number
  ok: number
  fail: number
  untested: number
}

// ====== 保存消息 ======
export interface SaveMessage {
  type: 'success' | 'error'
  text: string
}
