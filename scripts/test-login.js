const { PrismaClient } = require('@prisma/client');
const { randomBytes, scrypt, timingSafeEqual } = require('crypto');
const { promisify } = require('util');

const prisma = new PrismaClient();
const scryptAsync = promisify(scrypt);

async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hashed = await scryptAsync(password, salt, 64);
  return `${salt}:${hashed.toString('hex')}`;
}

async function verifyPassword(password, storedHash) {
  const [salt, hash] = storedHash.split(':');
  const hashed = await scryptAsync(password, salt, 64);
  const storedHashBuffer = Buffer.from(hash, 'hex');
  return timingSafeEqual(hashed, storedHashBuffer);
}

async function testPassword() {
  console.log('🔑 测试密码验证...\n');
  const testPassword = '123456';

  console.log('测试哈希与验证:');
  const hashed = await hashPassword(testPassword);
  console.log(`  原始: ${testPassword}`);
  console.log(`  哈希: ${hashed}`);

  const isValid = await verifyPassword(testPassword, hashed);
  console.log(`  验证: ${isValid ? '✅ 正确' : '❌ 错误'}`);

  console.log('\n📊 数据库中的用户:');
  const user = await prisma.user.findUnique({ where: { username: 'zhoutao' } });
  if (user) {
    console.log(`  用户ID: ${user.id}`);
    console.log(`  密码哈希: ${user.passwordHash.substring(0, 50)}...`);
    console.log(`  哈希长度: ${user.passwordHash.length}`);
  }
}

testPassword()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
