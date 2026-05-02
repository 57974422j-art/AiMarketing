// 定时清理任务：删除 public/outputs/ 中超过 7 天的视频文件

import { existsSync, readdirSync, unlinkSync, statSync } from 'fs'
import { join } from 'path'

// 清理超过指定天数的文件
export function cleanupOldFiles(daysOld: number = 7): { deleted: string[], errors: string[] } {
  const outputsDir = join(process.cwd(), 'public', 'outputs')
  const deleted: string[] = []
  const errors: string[] = []
  
  if (!existsSync(outputsDir)) {
    console.log('outputs 目录不存在，跳过清理')
    return { deleted, errors }
  }
  
  const now = Date.now()
  const maxAge = daysOld * 24 * 60 * 60 * 1000 // 转换为毫秒
  
  try {
    const files = readdirSync(outputsDir)
    
    for (const file of files) {
      if (!file.endsWith('.mp4')) continue // 只处理 mp4 文件
      
      const filePath = join(outputsDir, file)
      
      try {
        const stats = statSync(filePath)
        const fileAge = now - stats.mtimeMs
        
        if (fileAge > maxAge) {
          unlinkSync(filePath)
          deleted.push(file)
          console.log(`已删除过期文件: ${file}`)
        }
      } catch (err) {
        const errorMsg = `处理文件 ${file} 失败: ${err instanceof Error ? err.message : err}`
        errors.push(errorMsg)
        console.error(errorMsg)
      }
    }
  } catch (err) {
    const errorMsg = `读取目录失败: ${err instanceof Error ? err.message : err}`
    errors.push(errorMsg)
    console.error(errorMsg)
  }
  
  return { deleted, errors }
}

// 可以被外部调用的清理函数
export async function runCleanup() {
  console.log('开始执行清理任务...')
  const result = cleanupOldFiles(7)
  console.log(`清理完成: 删除 ${result.deleted.length} 个文件`)
  if (result.errors.length > 0) {
    console.log(`失败 ${result.errors.length} 个`)
  }
  return result
}

// 如果直接运行此脚本，执行清理
if (require.main === module) {
  runCleanup()
}
