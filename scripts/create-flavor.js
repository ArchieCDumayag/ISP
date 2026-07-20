const { createFlavorInteractively, projectRoot } = require('./flavor-tools');
const path = require('path');

const name = process.argv.slice(2).find((arg) => !arg.startsWith('--'));

createFlavorInteractively(name)
  .then((filePath) => {
    console.log(`Created ${path.relative(projectRoot, filePath)}.`);
  })
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
