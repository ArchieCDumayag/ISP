const fs = require('fs');
const path = require('path');
const { MODULES_ROOT, isPathInside } = require('./paths');

let cachedRegistry = null;

function readManifest(moduleDirectory) {
  const manifestPath = path.join(moduleDirectory, 'module.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Module manifest is missing: ${manifestPath}`);
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    throw new Error(`Invalid module manifest ${manifestPath}: ${error.message}`);
  }

  const directoryId = path.basename(moduleDirectory);
  const id = String(manifest.id || '').trim();
  if (!id || id !== directoryId) {
    throw new Error(`Module id must match its directory (${directoryId}): ${manifestPath}`);
  }
  if (!Array.isArray(manifest.ownedPaths)) {
    throw new Error(`Module ownedPaths must be an array: ${manifestPath}`);
  }

  const contextFile = String(manifest.contextFile || '').trim();
  if (!contextFile) {
    throw new Error(`Module contextFile is required: ${manifestPath}`);
  }

  return Object.freeze({
    ...manifest,
    id,
    moduleRoot: moduleDirectory,
    manifestPath
  });
}

function buildRegistry() {
  if (!fs.existsSync(MODULES_ROOT)) {
    throw new Error(`Modules directory is missing: ${MODULES_ROOT}`);
  }

  const registry = new Map();
  const directories = fs.readdirSync(MODULES_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name));

  directories.forEach((entry) => {
    const moduleDirectory = path.join(MODULES_ROOT, entry.name);
    const manifest = readManifest(moduleDirectory);
    if (registry.has(manifest.id)) {
      throw new Error(`Duplicate module id: ${manifest.id}`);
    }
    registry.set(manifest.id, manifest);
  });

  return registry;
}

function getRegistry(options = {}) {
  if (!cachedRegistry || options.refresh) cachedRegistry = buildRegistry();
  return cachedRegistry;
}

function listModules(options = {}) {
  return Array.from(getRegistry(options).values());
}

function getModule(moduleId, options = {}) {
  const id = String(moduleId || '').trim();
  const manifest = getRegistry(options).get(id);
  if (!manifest && options.required !== false) {
    throw new Error(`Unknown module: ${id || '<empty>'}`);
  }
  return manifest || null;
}

function resolveModulePath(moduleId, ...segments) {
  const manifest = getModule(moduleId);
  const candidate = path.resolve(manifest.moduleRoot, ...segments);
  if (!isPathInside(manifest.moduleRoot, candidate)) {
    throw new Error(`Path escapes module ${manifest.id}: ${segments.join('/')}`);
  }
  return candidate;
}

function clearModuleRegistryCache() {
  cachedRegistry = null;
}

module.exports = {
  listModules,
  getModule,
  resolveModulePath,
  clearModuleRegistryCache
};
