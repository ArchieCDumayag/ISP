const path = require('path');
const { projectRoot, writeLauncher } = require('./flavor-tools');

const name = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
if (!name) {
  console.error('Flavor name is required. Example: npm run flavor:launcher -- dante-fiber');
  process.exit(1);
}

try {
  const filePath = writeLauncher(name);
  console.log(`Created ${path.relative(projectRoot, filePath)}.`);
} catch (error) {
  console.error(error.message || error);
  process.exitCode = 1;
}
