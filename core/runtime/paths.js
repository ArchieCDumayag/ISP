const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const CORE_ROOT = path.join(PROJECT_ROOT, 'core');
const FEATURES_ROOT = path.join(PROJECT_ROOT, 'Features');
const MODULES_ROOT = path.join(FEATURES_ROOT, 'modules');
const PUBLIC_ROOT = path.join(PROJECT_ROOT, 'public');
const DATA_DIR = path.join(PROJECT_ROOT, 'data');
const FLAVORS_DIR = path.join(PROJECT_ROOT, 'flavors');
const SCRIPTS_ROOT = path.join(PROJECT_ROOT, 'scripts');
const ENV_FILE = path.join(PROJECT_ROOT, '.env');

function isPathInside(parentPath, candidatePath) {
  const relative = path.relative(parentPath, candidatePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolveProjectPath(...segments) {
  const candidate = path.resolve(PROJECT_ROOT, ...segments);
  if (!isPathInside(PROJECT_ROOT, candidate)) {
    throw new Error(`Path escapes project root: ${segments.join('/')}`);
  }
  return candidate;
}

module.exports = Object.freeze({
  PROJECT_ROOT,
  CORE_ROOT,
  FEATURES_ROOT,
  MODULES_ROOT,
  PUBLIC_ROOT,
  DATA_DIR,
  FLAVORS_DIR,
  SCRIPTS_ROOT,
  ENV_FILE,
  isPathInside,
  resolveProjectPath
});
