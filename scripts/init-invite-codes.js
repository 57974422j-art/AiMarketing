
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  console.log('🚀 开始生成邀请码...\n');

  try {
    // 检查是否已有邀请码
    const existingCodes = await prisma.inviteCode.count();
    if (existingCodes > 0) {
      const codes = await prisma.inviteCode.findMany();
      console.log('✅ 数据库中已有邀请码:\n');
      codes.forEach(c => console.log(`  - ${c.code} (已使用: ${c.isUsed})`));
      return;
    }

    // 创建初始管理员用户（如果不存在）
    let adminUser = await prisma.user.findFirst({ where: { role: 'admin' } });
    if (!adminUser) {
      adminUser = await prisma.user.create({
        data: {
          username: 'admin',
          email: 'admin@example.com',
          passwordHash: 'temp:password',
          role: 'admin',
          plan: 'pro'
        }
      });
      console.log('👤 创建临时管理员用户');
    }

    // 生成多个邀请码
    const inviteCodes = [
      'AIMARKET2024',
      'START2024',
      'FIRSTUSER',
      'INVITE2024',
      'WELCOME2024'
    ];

    for (const code of inviteCodes) {
      await prisma.inviteCode.create({
        data: {
          code,
          createdBy: adminUser.id,
        }
      });
      console.log(`✓ 创建邀请码: ${code}`);
    }

    console.log('\n✅ 初始化完成！\n');
    console.log('📋 可用邀请码列表:\n');
    inviteCodes.forEach(code => console.log(`  - ${code}`));
    console.log('\n现在你可以使用上述任意邀请码注册了！');

  } catch (error) {
    console.error('❌ 错误:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();

