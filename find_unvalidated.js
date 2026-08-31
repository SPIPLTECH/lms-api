const fs = require('fs');
const path = require('path');

const directoryPath = path.join(__dirname, 'src', 'modules');

function findRouteFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) {
      findRouteFiles(filePath, fileList);
    } else if (file.endsWith('.routes.js') || file.endsWith('.route.js')) {
      fileList.push(filePath);
    }
  }
  return fileList;
}

const routeFiles = findRouteFiles(directoryPath);
const unvalidatedEndpoints = [];

for (const file of routeFiles) {
  const content = fs.readFileSync(file, 'utf-8');
  const moduleName = path.basename(path.dirname(file));
  
  // Very basic regex to match route definitions like router.post("/path", ...
  const routeRegex = /router\.(post|put|patch|delete)\s*\(\s*["']([^"']+)["']/g;
  let match;
  
  while ((match = routeRegex.exec(content)) !== null) {
    const method = match[1].toUpperCase();
    const routePath = match[2];
    
    const startIndex = match.index;
    let openParens = 0;
    let blockEndIndex = -1;
    let foundOpen = false;
    
    for (let i = startIndex; i < content.length; i++) {
      if (content[i] === '(') {
        openParens++;
        foundOpen = true;
      } else if (content[i] === ')') {
        openParens--;
      }
      
      if (foundOpen && openParens === 0) {
        blockEndIndex = i;
        break;
      }
    }
    
    if (blockEndIndex !== -1) {
      const blockContent = content.substring(startIndex, blockEndIndex + 1);
      // We ignore GET requests for input validation typically.
      // We also might want to ignore upload routes, but let's list them and we can filter later.
      if (!blockContent.includes('validate(')) {
        unvalidatedEndpoints.push({
          module: moduleName,
          method,
          path: routePath,
          file: path.basename(file)
        });
      }
    }
  }
}

// Group by module
const grouped = {};
for (const ep of unvalidatedEndpoints) {
  if (!grouped[ep.module]) grouped[ep.module] = [];
  grouped[ep.module].push(`${ep.method} ${ep.path}`);
}

console.log(JSON.stringify(grouped, null, 2));
