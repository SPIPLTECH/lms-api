const prisma = require("../../../config/database");

const upsertByStateId = (stateId, fields, client = prisma) => {
  return client.studentProgress.upsert({
    where: { stateId },
    create: { stateId, ...fields },
    update: fields,
  });
};

const findByStateId = (stateId, client = prisma) => {
  return client.studentProgress.findUnique({ where: { stateId } });
};

module.exports = { upsertByStateId, findByStateId };
