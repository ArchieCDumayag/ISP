const fs = require('fs');
const { getModule, listModules, resolveModulePath } = require('./module-registry');

function getRuntimeEntry(moduleId, entryName) {
  const manifest = getModule(moduleId);
  const runtime = manifest.runtime && typeof manifest.runtime === 'object'
    ? manifest.runtime
    : {};
  const descriptor = runtime[entryName];
  if (!descriptor) return null;

  const relativePath = typeof descriptor === 'string'
    ? descriptor
    : String(descriptor.entry || '').trim();
  if (!relativePath) return null;

  const absolutePath = resolveModulePath(moduleId, relativePath);
  return {
    module: manifest,
    entryName,
    relativePath,
    absolutePath,
    descriptor
  };
}

function loadModuleBackend(moduleId, options = {}) {
  const entry = getRuntimeEntry(moduleId, 'backend');
  if (!entry) {
    if (options.required) throw new Error(`Module backend is not configured: ${moduleId}`);
    return null;
  }
  if (!fs.existsSync(entry.absolutePath)) {
    throw new Error(`Module backend is missing: ${entry.absolutePath}`);
  }
  if (options.fresh) delete require.cache[require.resolve(entry.absolutePath)];
  return require(entry.absolutePath);
}

function getModuleWebRoot(moduleId, options = {}) {
  const entry = getRuntimeEntry(moduleId, 'web');
  if (!entry) {
    if (options.required) throw new Error(`Module web root is not configured: ${moduleId}`);
    return null;
  }
  if (!fs.existsSync(entry.absolutePath) || !fs.statSync(entry.absolutePath).isDirectory()) {
    throw new Error(`Module web root is missing: ${entry.absolutePath}`);
  }
  return entry.absolutePath;
}

function loadModuleRuntimes(options = {}) {
  const runtimes = new Map();
  listModules({ refresh: options.refresh }).forEach((module) => {
    const backend = loadModuleBackend(module.id, {
      required: options.requireBackend,
      fresh: options.fresh
    });
    const webRoot = getModuleWebRoot(module.id, {
      required: options.requireWeb
    });
    runtimes.set(module.id, Object.freeze({
      id: module.id,
      module,
      backend,
      webRoot
    }));
  });
  return runtimes;
}

module.exports = {
  getRuntimeEntry,
  loadModuleBackend,
  getModuleWebRoot,
  loadModuleRuntimes
};
