const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
async function main() {
  const accounts = await p.account.findMany({ where: { bindType: 'manual' }, select: { id: true, userId: true, deviceId: true, accountId: true, cdpPort: true } });
  console.log(JSON.stringify(accounts, null, 2));
  await p.$disconnect();
}
main();
