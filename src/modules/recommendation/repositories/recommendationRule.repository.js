const prisma = require("../../../config/database");

const findActiveRules = (client = prisma) => client.recommendationRule.findMany({ where: { isActive: true } });

const upsertRule = ({ ruleKey, type, weightMultiplier, isActive, description }, client = prisma) =>
  client.recommendationRule.upsert({
    where: { ruleKey },
    create: { ruleKey, type: type || null, weightMultiplier, isActive, description: description || null },
    update: { type: type || null, weightMultiplier, isActive, description: description || null },
  });

module.exports = { findActiveRules, upsertRule };
