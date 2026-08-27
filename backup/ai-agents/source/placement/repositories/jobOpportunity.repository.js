const prisma = require("../../../config/database");
const { OPPORTUNITY_STATUS } = require("../constants");

const findAllOpen = (client = prisma) =>
  client.jobOpportunity.findMany({ where: { status: OPPORTUNITY_STATUS.OPEN }, include: { company: { select: { id: true, name: true } } } });

const findById = (id, client = prisma) => client.jobOpportunity.findUnique({ where: { id }, include: { company: true } });

const search = ({ skip, take, companyId, employmentType, isRemote, location } = {}, client = prisma) =>
  client.jobOpportunity.findMany({
    where: {
      status: OPPORTUNITY_STATUS.OPEN,
      companyId: companyId || undefined,
      employmentType: employmentType || undefined,
      isRemote: typeof isRemote === "boolean" ? isRemote : undefined,
      location: location ? { contains: location, mode: "insensitive" } : undefined,
    },
    include: { company: { select: { id: true, name: true, industry: true } } },
    orderBy: { postedAt: "desc" },
    skip,
    take,
  });

/** Idempotent batch upsert of the seeded job catalog — safe to call on every bootstrap(). */
const ensureSeeded = async (seedData, companyByName, client = prisma) => {
  let count = 0;
  for (const job of seedData) {
    const company = companyByName.get(job.companyName);
    if (!company) continue;

    await client.jobOpportunity.upsert({
      where: { companyId_title: { companyId: company.id, title: job.title } },
      create: {
        companyId: company.id,
        title: job.title,
        description: job.description,
        requiredSkills: job.requiredSkills,
        employmentType: job.employmentType,
        location: job.location,
        isRemote: job.isRemote,
        salaryMin: job.salaryMin,
        salaryMax: job.salaryMax,
      },
      update: {
        description: job.description,
        requiredSkills: job.requiredSkills,
        employmentType: job.employmentType,
        location: job.location,
        isRemote: job.isRemote,
        salaryMin: job.salaryMin,
        salaryMax: job.salaryMax,
      },
    });
    count += 1;
  }
  return count;
};

module.exports = { findAllOpen, findById, search, ensureSeeded };
