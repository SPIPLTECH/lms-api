const prisma = require("../../../config/database");
const { DRIVE_STATUS } = require("../constants");

const findAllUpcoming = (client = prisma) =>
  client.placementDrive.findMany({
    where: { status: { in: [DRIVE_STATUS.UPCOMING, DRIVE_STATUS.ONGOING] } },
    include: { company: { select: { id: true, name: true } } },
    orderBy: { driveDate: "asc" },
  });

const findById = (id, client = prisma) => client.placementDrive.findUnique({ where: { id }, include: { company: true } });

/** Idempotent batch upsert of the seeded drive catalog — offset-days fields are resolved to absolute dates relative to `now` at seed time, safe to call on every bootstrap(). */
const ensureSeeded = async (seedData, companyByName, now = new Date(), client = prisma) => {
  const dayMs = 24 * 3600 * 1000;
  let count = 0;

  for (const drive of seedData) {
    const company = companyByName.get(drive.companyName);
    if (!company) continue;

    await client.placementDrive.upsert({
      where: { companyId_title: { companyId: company.id, title: drive.title } },
      create: {
        companyId: company.id,
        title: drive.title,
        description: drive.description,
        eligibilityCriteria: drive.eligibilityCriteria,
        driveDate: new Date(now.getTime() + drive.driveDateOffsetDays * dayMs),
        registrationDeadline: new Date(now.getTime() + drive.registrationDeadlineOffsetDays * dayMs),
      },
      update: {
        description: drive.description,
        eligibilityCriteria: drive.eligibilityCriteria,
      },
    });
    count += 1;
  }
  return count;
};

module.exports = { findAllUpcoming, findById, ensureSeeded };
