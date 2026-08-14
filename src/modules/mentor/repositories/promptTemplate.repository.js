const prisma = require("../../../config/database");
const { PROMPT_TEMPLATE_SEED_DATA } = require("../constants/promptTemplates.seed");

const findByKey = (key, client = prisma) => client.promptTemplate.findUnique({ where: { key } });

const findByRole = (role, client = prisma) => client.promptTemplate.findFirst({ where: { role, isActive: true } });

/** Idempotent — upserts every seeded template by its unique key, safe to call on every boot (same pattern as Career's IndustryRole/Placement's Company). */
const ensureSeeded = async (client = prisma) => {
  for (const entry of PROMPT_TEMPLATE_SEED_DATA) {
    await client.promptTemplate.upsert({
      where: { key: entry.key },
      create: entry,
      update: { template: entry.template, description: entry.description, role: entry.role },
    });
  }
  return PROMPT_TEMPLATE_SEED_DATA.length;
};

module.exports = { findByKey, findByRole, ensureSeeded };
