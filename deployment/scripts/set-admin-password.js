/**
 * One-off: set admin@erp.com password (run on VPS as erp user)
 * Usage: node set-admin-password.js <newPassword>
 */
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const email = process.env.ADMIN_EMAIL || 'admin@erp.com';
const password = process.argv[2] || 'admin';

async function main() {
  const prisma = new PrismaClient();
  const hash = await bcrypt.hash(password, 10);
  const user = await prisma.user.update({
    where: { email },
    data: { password: hash },
  });
  console.log('PASSWORD_UPDATED:', user.email);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
