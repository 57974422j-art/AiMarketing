
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()
;(async () => {
  const exist = await prisma.agentTool.findUnique({ where: { name: 'browser_use_execute' } })
  if (exist) { console.log('已存在'); return }
  await prisma.agentTool.create({
    data: {
      name: 'browser_use_execute',
      title: 'AI浏览器操作',
      description: 'AI 驱动浏览器自动操作（Browser Use）——自动打开网页、上传文件、填表、点按钮，抗平台改版。触发词：用AI浏览器/自动操作网页/发布到XX（AI方式）。参数 task（自然语言任务描述，含平台/操作/内容）、files（可选，文件URL/路径数组）。执行在客户端（复用已登录浏览器）。',
      parameters: JSON.stringify({ task: { type: 'string', description: '自然语言任务描述（如：打开小红书发布页，上传视频，用平台智能封面，点发布）' }, files: { type: 'array', items: { type: 'string' }, description: '可选：文件URL/路径数组' } }),
      endpoint: 'browser_use',
      enabled: true,
      roles: 'admin',
    },
  })
  console.log('browser_use_execute 注册 OK')
})().finally(() => prisma.$disconnect())
