/** Settings 页面所有类型定义 */

// ====== 状态指示器 ======
export type StatusType = string | null

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
  type: string
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
export type QueryEngine = string
export type ActionEngine = string

// ====== MediaCrawler ======
export type MCHealthStatus = string

// ====== 扫码登录 =====_
export type LoginStatus = string

// ====== Cookie 状态 =====_
export type CookieStatus = string

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
  protocol: string
  username: string
  password: string
  label: string
  region: string
  enabled: boolean
  testStatus?: string
  testLatencyMs?: number
}

export interface NewProxyForm {
  host: string
  port: string
  protocol: string
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
  type: string
  text: string
}
