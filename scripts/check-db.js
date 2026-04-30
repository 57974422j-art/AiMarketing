const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  console.log('🔍 检查数据库数据...\n');

  // 检查用户
  const users = await prisma.user.findMany();
  console.log(`📊 找到 ${users.length} 个用户：`);
  users.forEach(user => {
    console.log(`  - ID: ${user.id}, 用户名: ${user.username}, 邮箱: ${user.email}, 角色: ${user.role}`);
  });

  // 检查邀请码
  const inviteCodes = await prisma.inviteCode.findMany();
  console.log(`\n🎟️ 找到 ${inviteCodes.length} 个邀请码：`);
  inviteCodes.forEach(code => {
    console.log(`  - ${code.code}, 已使用: ${code.isUsed}, 创建者ID: ${code.createdBy}`);
  });
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
