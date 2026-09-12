const countBlocksByType = (course) => {
  const counts = {};
  let totalLessons = 0;

  for (const moduleEntry of course.modules || []) {
    for (const lesson of moduleEntry.lessons || []) {
      totalLessons += 1;
      for (const block of lesson.content || []) {
        counts[block.blockType] = (counts[block.blockType] || 0) + 1;
      }
    }
  }

  return { totalModules: (course.modules || []).length, totalLessons, counts };
};

const findUnmapped = (course) => {
  const unmapped = [];
  for (const moduleEntry of course.modules || []) {
    for (const lesson of moduleEntry.lessons || []) {
      for (const block of lesson.content || []) {
        if (block.blockType === "unknown") {
          unmapped.push({ module: moduleEntry.title, lesson: lesson.title, original: block.original });
        }
      }
    }
  }
  return unmapped;
};

const findBrokenLocalReferences = (course) => {
  const broken = [];
  for (const moduleEntry of course.modules || []) {
    for (const lesson of moduleEntry.lessons || []) {
      for (const block of lesson.content || []) {
        if (block.blockType === "unknown" && block.original?.reason?.includes("broken")) {
          broken.push({ module: moduleEntry.title, lesson: lesson.title, path: block.original.sourcePath });
        }
      }
    }
  }
  return broken;
};

const findDuplicateTitles = (items) => {
  const counts = new Map();
  for (const item of items) {
    const key = (item.title || "").trim().toLowerCase();
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([title, count]) => ({ title, count }));
};

/** Produces the "Import Validation" report shown in the preview UI. */
const validateCourse = (course) => {
  const { totalModules, totalLessons, counts } = countBlocksByType(course);
  const unmapped = findUnmapped(course);
  const brokenReferences = findBrokenLocalReferences(course);
  const duplicateModuleTitles = findDuplicateTitles(course.modules || []);

  const errors = [];
  if (!course.title || !course.title.trim()) errors.push("Course title is missing.");
  if (totalModules === 0) errors.push("No modules were detected.");

  const warnings = [];
  if (unmapped.length) warnings.push(`${unmapped.length} element(s) could not be mapped automatically.`);
  if (brokenReferences.length) warnings.push(`${brokenReferences.length} broken local reference(s) detected.`);
  if (duplicateModuleTitles.length) warnings.push(`${duplicateModuleTitles.length} duplicate module title(s) detected.`);

  return {
    summary: { totalModules, totalLessons, counts },
    errors,
    warnings,
    unmapped,
    brokenReferences,
    duplicateModuleTitles,
    isValid: errors.length === 0,
  };
};

module.exports = { validateCourse };
