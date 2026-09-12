const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.$queryRaw`SELECT schemaname, tablename FROM pg_tables WHERE tablename = 'Progress'`.then(console.log).finally(()=>prisma.$disconnect());
