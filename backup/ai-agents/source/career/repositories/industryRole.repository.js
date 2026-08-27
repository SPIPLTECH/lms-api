const prisma = require("../../../config/database");

const findAllActive = (client = prisma) => client.industryRole.findMany({ where: { isActive: true } });

const findById = (id, client = prisma) => client.industryRole.findUnique({ where: { id } });

const findByName = (name, client = prisma) => client.industryRole.findUnique({ where: { name } });

/** Idempotent batch upsert of the seeded taxonomy — safe to call on every bootstrap(), only writes when a row is genuinely new or the seed data changed. */
const ensureSeeded = async (seedData, client = prisma) => {
  let created = 0;
  for (const role of seedData) {
    const result = await client.industryRole.upsert({
      where: { name: role.name },
      create: role,
      update: {
        category: role.category,
        description: role.description,
        requiredSkills: role.requiredSkills,
        minReadinessScore: role.minReadinessScore,
      },
    });
    if (result) created += 1;
  }
  return created;
};

/** Refreshes only the job-market-sourced fields — never touches requiredSkills/category, which are curriculum decisions, not market data. */
const updateMarketFields = (name, { industryDemandScore, avgSalaryMin, avgSalaryMax }, client = prisma) =>
  client.industryRole.updateMany({
    where: { name },
    data: { industryDemandScore, avgSalaryMin: avgSalaryMin ?? undefined, avgSalaryMax: avgSalaryMax ?? undefined },
  });

module.exports = { findAllActive, findById, findByName, ensureSeeded, updateMarketFields };
