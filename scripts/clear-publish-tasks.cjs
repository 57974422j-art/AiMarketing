// 历史 AgentPublishTask 清理（opencli 发布已迁移 browser_use）——服务器跑：
//   node scripts/clear-publish-tasks.cjs
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()
;(async () => {
  try {
    const r = await prisma.agentPublishTask.updateMany({
      where: { status: 'pending' },
      data: { status: 'cancelled', error: '已迁移 AI 浏览器发布（browser_use）——请重新通过 AGENT 发布' },
    })
    console.log('已清理 pending 发布任务:', r.count, '条')
  } catch (e) { console.error('清理失败:', e.message) } finally { await prisma.$disconnect() }
})()
