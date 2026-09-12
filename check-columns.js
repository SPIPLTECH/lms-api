const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.$queryRaw`SELECT column_name FROM information_schema.columns WHERE table_name = 'Course'`.then(console.log).finally(()=>prisma.$disconnect());
