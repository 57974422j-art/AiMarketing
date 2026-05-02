
import { PrismaClient } from '@prisma/client'
import { randomBytes, scrypt } from 'crypto'
import { promisify } from 'util'

const prisma = new PrismaClient()
const scryptAsync = promisify(scrypt)

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex')
  const hashed = await scryptAsync(password, salt, 64) as Buffer
  return `${salt}:${hashed.toString('hex')}`
}

async function main() {
  console.log('开始初始化数据库...')

  // 创建测试管理员用户
  const existingAdmin = await prisma.user.findFirst({
    where: { username: 'admin' }
  })

  let adminUser
  if (!existingAdmin) {
    const passwordHash = await hashPassword('admin123')
    adminUser = await prisma.user.create({
      data: {
        username: 'admin',
        email: 'admin@example.com',
        passwordHash,
        name: 'Administrator',
        role: 'admin'
      }
    })
    console.log(`创建管理员用户: admin (密码: admin123)`)
  } else {
    adminUser = existingAdmin
    console.log(`管理员用户已存在: admin`)
  }

  // 检查是否已有邀请码
  const existingCodes = await prisma.inviteCode.count()
  if (existingCodes > 0) {
    console.log('数据库中已有邀请码，跳过初始化')
    return
  }

  // 生成初始邀请码（使用 admin 用户作为 creator）
  const inviteCodes = [
    'TEST2024',
    'START2024',
    'FIRSTUSER',
    'INVITE2024',
    'WELCOME2024'
  ]

  for (const code of inviteCodes) {
    await prisma.inviteCode.create({
      data: {
        code,
        createdBy: adminUser.id
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
