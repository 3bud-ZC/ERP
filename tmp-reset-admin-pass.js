const bcrypt = require("/var/www/og-erp/current/node_modules/bcryptjs");
const { PrismaClient } = require("/var/www/og-erp/current/node_modules/@prisma/client");

(async () => {
  const prisma = new PrismaClient();
  const email = "admin@erp.com";
  const password = "Abdo";
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.log("USER_NOT_FOUND");
    process.exit(2);
  }
  const hash = await bcrypt.hash(password, 10);
  await prisma.user.update({ where: { email }, data: { password: hash, isActive: true } });
  await prisma.session.deleteMany({ where: { userId: user.id } });
  console.log("OK_PASSWORD_UPDATED");
  await prisma.$disconnect();
})();
