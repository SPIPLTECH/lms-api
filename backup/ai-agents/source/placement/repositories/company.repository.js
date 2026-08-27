const prisma = require("../../../config/database");

const findAllActive = (client = prisma) => client.company.findMany({ where: { isActive: true } });

const findByName = (name, client = prisma) => client.company.findUnique({ where: { name } });

const findById = (id, client = prisma) => client.company.findUnique({ where: { id } });

/** Idempotent batch upsert of the seeded employer catalog — safe to call on every bootstrap(). */
const ensureSeeded = async (seedData, client = prisma) => {
  const byName = new Map();
  for (const company of seedData) {
    const row = await client.company.upsert({
      where: { name: company.name },
      create: company,
      update: { industry: company.industry, website: company.website, description: company.description },
    });
    byName.set(company.name, row);
  }
  return byName;
};

module.exports = { findAllActive, findByName, findById, ensureSeeded };
