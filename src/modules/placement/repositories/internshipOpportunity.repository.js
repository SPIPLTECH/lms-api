const prisma = require("../../../config/database");
const { OPPORTUNITY_STATUS } = require("../constants");

const findAllOpen = (client = prisma) =>
  client.internshipOpportunity.findMany({ where: { status: OPPORTUNITY_STATUS.OPEN }, include: { company: { select: { id: true, name: true } } } });

const findById = (id, client = prisma) => client.internshipOpportunity.findUnique({ where: { id }, include: { company: true } });

const search = ({ skip, take, companyId, isRemote, isPPO, location } = {}, client = prisma) =>
  client.internshipOpportunity.findMany({
    where: {
      status: OPPORTUNITY_STATUS.OPEN,
      companyId: companyId || undefined,
      isRemote: typeof isRemote === "boolean" ? isRemote : undefined,
      isPPO: typeof isPPO === "boolean" ? isPPO : undefined,
      location: location ? { contains: location, mode: "insensitive" } : undefined,
    },
    include: { company: { select: { id: true, name: true, industry: true } } },
    orderBy: { postedAt: "desc" },
    skip,
    take,
  });

/** Idempotent batch upsert of the seeded internship catalog — safe to call on every bootstrap(). */
const ensureSeeded = async (seedData, companyByName, client = prisma) => {
  let count = 0;
  for (const internship of seedData) {
    const company = companyByName.get(internship.companyName);
    if (!company) continue;

    await client.internshipOpportunity.upsert({
      where: { companyId_title: { companyId: company.id, title: internship.title } },
      create: {
        companyId: company.id,
        title: internship.title,
        description: internship.description,
        requiredSkills: internship.requiredSkills,
        durationWeeks: internship.durationWeeks,
        stipend: internship.stipend,
        location: internship.location,
        isRemote: internship.isRemote,
        isPPO: internship.isPPO,
      },
      update: {
        description: internship.description,
        requiredSkills: internship.requiredSkills,
        durationWeeks: internship.durationWeeks,
        stipend: internship.stipend,
        location: internship.location,
        isRemote: internship.isRemote,
        isPPO: internship.isPPO,
      },
    });
    count += 1;
  }
  return count;
};

module.exports = { findAllOpen, findById, search, ensureSeeded };
