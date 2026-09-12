const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

// MOCK Progress to return empty data so backend logic doesn't crash
prisma.progress = new Proxy({}, {
  get(target, prop) {
    if (prop === 'count') return async () => 0;
    if (prop === 'findMany') return async () => [];
    if (prop === 'findUnique') return async () => null;
    if (prop === 'groupBy') return async () => [];
    if (prop === 'upsert') return async () => ({});
    if (prop === 'create') return async () => ({});
    if (prop === 'deleteMany') return async () => ({ count: 0 });
    return async () => null;
  }
});

module.exports = prisma;