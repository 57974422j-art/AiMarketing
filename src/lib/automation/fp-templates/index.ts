/**
 * 指纹浏览器模板注册表
 *
 * 用途：
 *   1. 前端获取可用模板列表（meta 信息）
 *   2. Electron 主进程按 key 查找并执行对应模板
 *   3. 扩展新平台/新功能只需添加一个 .ts 文件 + 在此注册
 */

import { FingerprintTemplate, TemplateMeta, TemplateParamDef } from './types'
import douyinPublish from './douyin-publish'
import douyinLike from './douyin-like'
import douyinComment from './douyin-comment'
import xiaohongshuPublish from './xiaohongshu-publish'

/** 所有已注册的模板 */
export const templateRegistry: Map<string, FingerprintTemplate> = new Map([
  [douyinPublish.meta.key, douyinPublish],
  [douyinLike.meta.key, douyinLike],
  [douyinComment.meta.key, douyinComment],
  [xiaohongshuPublish.meta.key, xiaohongshuPublish],
])

/** 获取所有模板的元信息（用于前端展示，不暴露执行函数） */
export function getAllTemplateMetas(): TemplateMeta[] {
  return Array.from(templateRegistry.values()).map(t => t.meta)
}

/** 获取指定模板参数定义 */
export function getTemplateParams(key: string): TemplateParamDef[] | null {
  return templateRegistry.get(key)?.params || null
}

/** 按平台筛选可用模板 */
export function getTemplatesByPlatform(platform: string): TemplateMeta[] {
  return getAllTemplateMetas().filter(t => t.platforms.includes(platform))
}

/**
 * 执行指定模板
 * @param page Playwright Page 对象
 * @param key 模板标识
 * @param params 模板参数
 * @param log 日志回调
 */
export async function executeTemplate(
  page: any,
  key: string,
  params: Record<string, any>,
  log: (msg: string) => void,
) {
  const tmpl = templateRegistry.get(key)
  if (!tmpl) throw new Error(`未知模板: ${key}`)
  return await tmpl.execute(page, params, log)
}

/** 导出所有模板 meta（供前端静态引用） */
export const TEMPLATE_METAS = getAllTemplateMetas()
