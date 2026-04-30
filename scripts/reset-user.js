const { PrismaClient } = require('@prisma/client');
const { randomBytes, scrypt } = require('crypto');
const { promisify } = require('util');

const prisma = new PrismaClient();
const scryptAsync = promisify(scrypt);

async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hashed = await scryptAsync(password, salt, 64);
  return `${salt}:${hashed.toString('hex')}`;
}

async function main() {
  const testPassword = '123456';
  const hashedPassword = await hashPassword(testPassword);

  console.log('🔄 重置用户密码...\n');

  // 更新现有用户密码
  const updated = await prisma.user.update({
    where: { username: 'zhoutao' },
    data: { passwordHash: hashedPassword }
  });

  console.log('✅ 用户密码已重置！');
  console.log('\n📋 登录信息:');
  console.log('  用户名: zhoutao');
  console.log('  密码: 123456');
  console.log('\n现在可以用这个密码登录了！');
}

main()
  .catch(async (e) => {
    console.error('❌ 错误:', e);
    // 如果用户不存在，创建一个测试用户
    console.log('\n尝试创建测试用户...');
    const testPassword = '123456';
    const hashedPassword = await hashPassword(testPassword);
    await prisma.user.create({
      data: {
        username: 'test',
        email: 'test@example.com',
        passwordHash: hashedPassword,
        role: 'viewer',
        inviteCode: 'TEST'
      }
    });
    console.log('✅ 测试用户创建成功！');
    console.log('\n📋 测试登录信息:');
    console.log('  用户名: test');
    console.log('  密码: 123456');
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
