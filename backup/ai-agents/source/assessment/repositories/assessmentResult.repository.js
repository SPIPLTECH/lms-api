const prisma = require("../../../config/database");

const create = (attemptId, studentId, fields, client = prisma) => {
  return client.assessmentResult.create({ data: { attemptId, studentId, ...fields } });
};

const findByStudent = (studentId, { skip, take } = {}, client = prisma) => {
  return client.assessmentResult.findMany({
    where: { studentId },
    orderBy: { evaluatedAt: "desc" },
    skip,
    take,
  });
};

module.exports = { create, findByStudent };
