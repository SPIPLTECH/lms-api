const prisma = require('./src/config/database');

async function main() {
  const rows = await prisma.studentState.groupBy({
    by: ['studentId', 'courseId'],
    _count: { id: true },
    having: { id: { _count: { gt: 1 } } },
  });
  console.log('DUPLICATE GROUPS:', rows.length);
  console.log(rows);

  const total = await prisma.studentState.count();
  console.log('TOTAL ROWS:', total);
}

main().catch((e) => console.log('FATAL:', e)).finally(() => prisma.$disconnect());
