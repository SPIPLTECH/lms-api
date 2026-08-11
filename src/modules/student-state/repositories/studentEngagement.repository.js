const prisma = require("../../../config/database");

const upsertByStateId = (stateId, fields, client = prisma) => {
  return client.studentEngagement.upsert({
    where: { stateId },
    create: { stateId, ...fields },
    update: fields,
  });
};

const findByStateId = (stateId, client = prisma) => {
  return client.studentEngagement.findUnique({ where: { stateId } });
};

module.exports = { upsertByStateId, findByStateId };
