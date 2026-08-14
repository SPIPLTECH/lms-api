const prisma = require('./src/config/database');

async function main() {
  try {
    const invalidRows = await prisma.$queryRawUnsafe(
      `SELECT id, type, title, "htmlContent" FROM "Content" WHERE type::text NOT IN ('VIDEO', 'DOCUMENT', 'TEXT', 'LINK', 'PRESENTATION', 'IMAGE', 'PDF', 'FILE', 'EXTERNAL_LINK', 'HTML', 'CODE', 'ASSIGNMENT', 'CODING_EXERCISE', 'SCORM', 'INTERACTIVE_LAB', 'AUDIO', 'EMBED')`
    );
    console.log('INVALID ROWS FOUND:', invalidRows);

    if (invalidRows.length > 0) {
      const updateResult = await prisma.$executeRawUnsafe(
        `UPDATE "Content" SET type = 'HTML' WHERE type::text NOT IN ('VIDEO', 'DOCUMENT', 'TEXT', 'LINK', 'PRESENTATION', 'IMAGE', 'PDF', 'FILE', 'EXTERNAL_LINK', 'HTML', 'CODE', 'ASSIGNMENT', 'CODING_EXERCISE', 'SCORM', 'INTERACTIVE_LAB', 'AUDIO', 'EMBED')`
      );
      console.log('UPDATED ROWS COUNT:', updateResult);
    }
  } catch (err) {
    console.error('ERROR:', err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
