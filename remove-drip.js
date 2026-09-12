const fs = require('fs');

const replaceInFile = (file, regex, replacement) => {
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(regex, replacement);
  fs.writeFileSync(file, content);
};

// 1. dripAccess.js
replaceInFile('src/utils/dripAccess.js', /dripContentEnabled: true/g, '/* dripContentEnabled removed */');
replaceInFile('src/utils/dripAccess.js', /if \(\!course\?\.dripContentEnabled\) \{/g, 'if (true) { // drip content removed');

// 2. job.controller.js
replaceInFile('src/modules/course-import/controllers/job.controller.js', /dripContentEnabled:\s*false/g, '/* dripContent removed */');

// 3. course.validation.js
replaceInFile('src/modules/courses/course.validation.js', /dripContentEnabled:\s*Joi\.boolean\(\)\.optional\(\),/g, '');

// 4. course.service.js
replaceInFile('src/modules/courses/course.service.js', /dripContentEnabled:\s*source\.dripContentEnabled,/g, '');

// 5. v2PackageImporter.service.js
replaceInFile('src/modules/course-import/services/v2PackageImporter.service.js', /dripContentEnabled:\s*Boolean\(settings\?\.dripContentEnabled\),/g, '');

// 6. courseMapper.js
replaceInFile('src/modules/import/mappers/courseMapper.js', /dripContentEnabled:\s*Boolean\(course\.dripContentEnabled\)/g, '');

// 7. aiCourseGenerator.service.js
replaceInFile('src/modules/course-import/services/aiCourseGenerator.service.js', /dripContentEnabled:\s*false,/g, '');

console.log("dripContentEnabled removed from backend files.");
