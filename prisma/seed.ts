
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('开始初始化数据库...')

  // 检查是否已有邀请码
  const existingCodes = await prisma.inviteCode.count()
  if (existingCodes > 0) {
    console.log('数据库中已有邀请码，跳过初始化')
    return
  }

  // 生成初始邀请码
  const inviteCodes = [
    'AIMARKET2024',
    'START2024',
    'FIRSTUSER'
  ]

  for (const code of inviteCodes) {
    await prisma.inviteCode.create({
      data: {
        code,
        createdBy: 1, // 默认用户ID
      }
    })
    console.log(`创建邀请码: ${code}`)
  }

  console.log('✅ 初始化完成！')
  console.log('可用邀请码:')
  inviteCodes.forEach(code => console.log(`  - ${code}`))
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
