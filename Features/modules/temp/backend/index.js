const path = require('path');

const entries = Object.freeze({
  workspace: './workspace-router'
});

function load(entryName) {
  const relativePath = entries[entryName];
  if (!relativePath) throw new Error(`Unknown Temp backend entry: ${entryName}`);
  return require(path.join(__dirname, relativePath));
}

module.exports = Object.freeze({
  id: 'temp',
  entries,
  load
});
