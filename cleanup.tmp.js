const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async () => {
  await p.course.deleteMany({ where: { id: "ytembed_verify_course" } });   // cascades modules/lessons/topics/contents/enrollments
  await p.studentProfile.deleteMany({ where: { userId: "ytembed_verify_stu" } });
  await p.user.deleteMany({ where: { id: { in: ["ytembed_verify_inst", "ytembed_verify_stu"] } } });
  const left = await p.user.count({ where: { email: { contains: "ytembed_verify" } } });
  const courses = await p.course.count({ where: { id: "ytembed_verify_course" } });
  console.log("remaining fixture users:", left, "| courses:", courses);
  await p.$disconnect();
})().catch(async e => { console.error("ERR", e.message.slice(0,150)); await p.$disconnect(); process.exit(1); });
