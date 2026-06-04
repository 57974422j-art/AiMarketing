/**
 * 指纹浏览器自动化模板类型定义
 *
 * 所有模板统一接口：
 *   execute(page, params, log) => TemplateResult
 *
 * page  : Playwright Page 对象（已打开的浏览器页面）
 * params: 模板参数对象
 * log   : 日志回调函数
 */

/** 模板执行结果 */
export interface TemplateResult {
  success: boolean
  message: string
  /** 是否需要用户手动确认 */
  needConfirm?: boolean
}

/** 日志回调函数 */
export type LogFn = (msg: string) => void

/** 模板执行函数签名 */
export type TemplateExecutor = (
  page: any,
  params: Record<string, any>,
  log: LogFn,
) => Promise<TemplateResult>

/** 模板元信息（用于前端展示） */
export interface TemplateMeta {
  key: string           // 唯一标识 'douyin-publish'
  label: string         // 显示名 '📝 抖音发帖'
  description: string   // 简短描述
  platforms: string[]    // 适用平台 ['douyin']
  version: string       // 版本号
  author?: string       // 作者
}

/** 模板参数定义（用于前端表单生成） */
export interface TemplateParamDef {
  key: string           // 参数键名
  label: string         // 显示标签
  type: 'text' | 'textarea' | 'number' | 'url' | 'file' | 'select'
  placeholder?: string
  required?: boolean
  defaultValue?: any
  options?: { label: string; value: any }[]  // select 类型的选项
  min?: number
  max?: number
}

/** 完整模板定义 */
export interface FingerprintTemplate {
  meta: TemplateMeta
  params: TemplateParamDef[]
  execute: TemplateExecutor
}
