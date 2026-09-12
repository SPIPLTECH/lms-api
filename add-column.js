const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.$executeRaw`ALTER TABLE "Course" ADD COLUMN "dripContentEnabled" BOOLEAN NOT NULL DEFAULT false`
  .then(console.log)
  .catch(console.error)
  .finally(()=>prisma.$disconnect());
