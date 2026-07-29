#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..', '..');
const modulesRoot = path.join(projectRoot, 'Features', 'modules');

const ignoredDirectoryNames = new Set([
  '.ai_coord',
  '.git',
  '.tmp',
  'backups',
  'data',
  'dist',
  'logs',
  'node_modules',
  'releases'
]);

const sharedDomainPatterns = [
  'server.js',
  'public/api.js',
  'public/app.js',
  'public/index.html',
  'public/layout.js',
  'public/sidebar.html',
  'public/styles.css',
  'public/theme-init.js',
  'public/theme.js',
  'public/topbar.html',
  'public/css/account-view-shared.css',
  'public/css/base.css',
  'public/css/dashboard.css',
  'public/css/tabler-app.css',
  'public/js/account-view-shared.js',
  'public/js/confirm-dialog.js',
  'public/js/public-branding.js',
  'public/js/tabler-enhance.js',
  'public/vendor/**'
];

function toProjectPath(filePath) {
  return path.relative(projectRoot, filePath).split(path.sep).join('/');
}

function walkFiles(directory, result = []) {
  if (!fs.existsSync(directory)) return result;
  const entries = fs.readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name));

  entries.forEach((entry) => {
    if (entry.isDirectory() && ignoredDirectoryNames.has(entry.name)) return;
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walkFiles(entryPath, result);
    } else if (entry.isFile()) {
      result.push(toProjectPath(entryPath));
    }
  });
  return result;
}

function listProjectFiles() {
  try {
    const output = execFileSync(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
      { cwd: projectRoot, encoding: 'utf8' }
    );
    return output
      .split('\0')
      .filter(Boolean)
      .filter((filePath) => fs.existsSync(path.join(projectRoot, filePath)))
      .map((filePath) => filePath.replace(/\\/g, '/'))
      .sort();
  } catch (_error) {
    return walkFiles(projectRoot).sort();
  }
}

function globToRegExp(pattern) {
  let source = '^';
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === '*') {
      if (pattern[index + 1] === '*') {
        source += '.*';
        index += 1;
      } else {
        source += '[^/]*';
      }
    } else if (char === '?') {
      source += '[^/]';
    } else {
      source += char.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
    }
  }
  return new RegExp(`${source}$`);
}

function matchesPattern(filePath, pattern) {
  return globToRegExp(String(pattern).replace(/\\/g, '/')).test(filePath);
}

function readModuleManifests() {
  if (!fs.existsSync(modulesRoot)) return [];
  return fs.readdirSync(modulesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => {
      const manifestPath = path.join(modulesRoot, entry.name, 'module.json');
      if (!fs.existsSync(manifestPath)) {
        return {
          id: entry.name,
          _manifestPath: toProjectPath(manifestPath),
          _manifestError: 'module.json is missing'
        };
      }
      try {
        return {
          ...JSON.parse(fs.readFileSync(manifestPath, 'utf8')),
          _manifestPath: toProjectPath(manifestPath)
        };
      } catch (error) {
        return {
          id: entry.name,
          _manifestPath: toProjectPath(manifestPath),
          _manifestError: error.message
        };
      }
    });
}

function ownersForPath(filePath, manifests) {
  return manifests
    .filter((manifest) => (manifest.ownedPaths || []).some((pattern) => matchesPattern(filePath, pattern)))
    .map((manifest) => manifest.id);
}

function isDomainCandidate(filePath) {
  const extension = path.posix.extname(filePath);
  if (!filePath.includes('/') && extension === '.js') return true;
  return filePath.startsWith('public/') && ['.css', '.html', '.js'].includes(extension);
}

function resolveLocalRequire(fromPath, request) {
  const basePath = path.resolve(projectRoot, path.dirname(fromPath), request);
  const candidates = [
    basePath,
    `${basePath}.js`,
    `${basePath}.json`,
    path.join(basePath, 'index.js')
  ];
  const resolved = candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
  return resolved ? toProjectPath(resolved) : null;
}

function scanCommonJsDependencies(files) {
  const edges = [];
  const missing = [];
  const requirePattern = /require\s*\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g;

  files.filter((filePath) => filePath.endsWith('.js')).forEach((filePath) => {
    const absolutePath = path.join(projectRoot, filePath);
    let contents;
    try {
      contents = fs.readFileSync(absolutePath, 'utf8');
    } catch (_error) {
      return;
    }
    requirePattern.lastIndex = 0;
    let match;
    while ((match = requirePattern.exec(contents)) !== null) {
      const resolved = resolveLocalRequire(filePath, match[1]);
      const edge = { from: filePath, request: match[1], resolved };
      edges.push(edge);
      if (!resolved) missing.push(edge);
    }
  });

  return {
    edges: edges.sort((left, right) => `${left.from}:${left.request}`.localeCompare(`${right.from}:${right.request}`)),
    missing
  };
}

function resolveMountedWebAsset(urlPath, fileSet) {
  const normalizedUrlPath = String(urlPath || '').replace(/^\/+/, '');
  const publicCandidate = `public/${normalizedUrlPath}`;
  if (fileSet.has(publicCandidate)) return publicCandidate;

  const suffix = `/web/${normalizedUrlPath}`;
  const moduleCandidates = [...fileSet]
    .filter((filePath) => filePath.startsWith('Features/modules/') && filePath.endsWith(suffix));
  if (moduleCandidates.length === 1) return moduleCandidates[0];
  return publicCandidate;
}

function resolveHtmlAsset(htmlPath, reference, fileSet) {
  const trimmed = String(reference || '').trim();
  if (!trimmed || /^(?:https?:)?\/\//i.test(trimmed)) return null;
  if (/^(?:about:|data:|mailto:|tel:|#)/i.test(trimmed)) return null;

  const cleanPath = trimmed.split('#')[0].split('?')[0];
  if (!/\.(?:css|js|mjs)$/i.test(cleanPath)) return null;
  const moduleWebMatch = /^(Features\/modules\/[^/]+\/web)\/(.+)$/i.exec(htmlPath);
  if (moduleWebMatch) {
    const webRoot = moduleWebMatch[1];
    const htmlUrlPath = moduleWebMatch[2];
    const urlPath = cleanPath.startsWith('/')
      ? cleanPath.replace(/^\/+/, '')
      : path.posix.normalize(path.posix.join(path.posix.dirname(htmlUrlPath), cleanPath));
    const moduleCandidate = `${webRoot}/${urlPath}`;
    if (fileSet.has(moduleCandidate)) return moduleCandidate;
    return resolveMountedWebAsset(urlPath, fileSet);
  }
  if (cleanPath.startsWith('/')) {
    return resolveMountedWebAsset(cleanPath, fileSet);
  }
  if (htmlPath.startsWith('public/')) {
    const urlPath = path.posix.normalize(
      path.posix.join(path.posix.dirname(htmlPath).replace(/^public\/?/, ''), cleanPath)
    );
    return resolveMountedWebAsset(urlPath, fileSet);
  }
  return path.posix.normalize(path.posix.join(path.posix.dirname(htmlPath), cleanPath));
}

function scanHtmlAssets(files, fileSet) {
  const references = [];
  const missing = [];
  const patterns = [
    /<script\b[^>]*\bsrc\s*=\s*['"]([^'"]+)['"][^>]*>/gi,
    /<link\b[^>]*\bhref\s*=\s*['"]([^'"]+)['"][^>]*>/gi
  ];

  files.filter((filePath) => filePath.endsWith('.html')).forEach((htmlPath) => {
    const contents = fs.readFileSync(path.join(projectRoot, htmlPath), 'utf8');
    patterns.forEach((pattern) => {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(contents)) !== null) {
        const resolved = resolveHtmlAsset(htmlPath, match[1], fileSet);
        if (!resolved) continue;
        const record = { from: htmlPath, reference: match[1], resolved };
        references.push(record);
        if (!fileSet.has(resolved)) missing.push(record);
      }
    });
  });

  return {
    references: references.sort((left, right) => `${left.from}:${left.reference}`.localeCompare(`${right.from}:${right.reference}`)),
    missing
  };
}

function buildInventory() {
  const files = listProjectFiles()
    .filter((filePath) => filePath !== 'docs/refactor/phase-01-inventory.json')
    .sort();
  const fileSet = new Set(files);
  const manifests = readModuleManifests();
  const manifestErrors = manifests
    .filter((manifest) => manifest._manifestError)
    .map((manifest) => ({ path: manifest._manifestPath, error: manifest._manifestError }));
  const ownershipCollisions = [];

  files.forEach((filePath) => {
    const owners = ownersForPath(filePath, manifests);
    if (owners.length > 1) ownershipCollisions.push({ path: filePath, owners });
  });

  const missingOwnedPatterns = [];
  const modules = manifests.map((manifest) => {
    const ownedFiles = files.filter((filePath) => ownersForPath(filePath, [manifest]).length === 1);
    (manifest.ownedPaths || []).forEach((pattern) => {
      if (!files.some((filePath) => matchesPattern(filePath, pattern))) {
        missingOwnedPatterns.push({ module: manifest.id, pattern });
      }
    });

    const requiredPaths = [
      manifest._manifestPath,
      manifest.contextFile,
      ...(manifest.webEntryPoints || [])
    ].filter(Boolean);
    const missingRequiredPaths = requiredPaths.filter((requiredPath) => !fileSet.has(requiredPath));

    return {
      id: manifest.id,
      displayName: manifest.displayName || manifest.id,
      status: manifest.status || 'unknown',
      manifestPath: manifest._manifestPath,
      contextFile: manifest.contextFile || null,
      apiPrefixes: manifest.apiPrefixes || [],
      webEntryPoints: manifest.webEntryPoints || [],
      ownedFiles,
      missingRequiredPaths
    };
  });

  const sharedDomainFiles = files.filter((filePath) => (
    isDomainCandidate(filePath)
    && sharedDomainPatterns.some((pattern) => matchesPattern(filePath, pattern))
  ));
  const unownedDomainFiles = files.filter((filePath) => (
    isDomainCandidate(filePath)
    && ownersForPath(filePath, manifests).length === 0
    && !sharedDomainPatterns.some((pattern) => matchesPattern(filePath, pattern))
  ));
  const commonJs = scanCommonJsDependencies(files);
  const htmlAssets = scanHtmlAssets(files, fileSet);

  return {
    schemaVersion: 1,
    project: 'ISP Billing System',
    architectureState: 'manifest-driven modular monolith',
    counts: {
      files: files.length,
      javascriptFiles: files.filter((filePath) => filePath.endsWith('.js')).length,
      htmlFiles: files.filter((filePath) => filePath.endsWith('.html')).length,
      cssFiles: files.filter((filePath) => filePath.endsWith('.css')).length,
      modules: modules.length,
      localRequireEdges: commonJs.edges.length,
      localHtmlAssetReferences: htmlAssets.references.length
    },
    modules,
    sharedDomainFiles,
    validation: {
      manifestErrors,
      ownershipCollisions,
      missingOwnedPatterns,
      unownedDomainFiles,
      missingLocalRequires: commonJs.missing,
      missingHtmlAssets: htmlAssets.missing,
      modulesWithMissingRequiredPaths: modules
        .filter((module) => module.missingRequiredPaths.length)
        .map((module) => ({ module: module.id, paths: module.missingRequiredPaths }))
    },
    dependencies: commonJs.edges,
    htmlAssets: htmlAssets.references
  };
}

function validationFailures(inventory) {
  const validation = inventory.validation;
  return [
    ['manifest errors', validation.manifestErrors],
    ['ownership collisions', validation.ownershipCollisions],
    ['owned patterns without files', validation.missingOwnedPatterns],
    ['unowned domain files', validation.unownedDomainFiles],
    ['missing local require targets', validation.missingLocalRequires],
    ['missing HTML script/style assets', validation.missingHtmlAssets],
    ['module required paths missing', validation.modulesWithMissingRequiredPaths]
  ].filter(([, values]) => values.length);
}

function printSummary(inventory) {
  console.log(`Modules: ${inventory.counts.modules}`);
  console.log(`Files inventoried: ${inventory.counts.files}`);
  console.log(`Local require edges: ${inventory.counts.localRequireEdges}`);
  console.log(`HTML script/style references: ${inventory.counts.localHtmlAssetReferences}`);
  inventory.modules.forEach((module) => {
    console.log(`- ${module.id}: ${module.ownedFiles.length} owned files`);
  });
}

function main() {
  const args = process.argv.slice(2);
  const writeIndex = args.indexOf('--write');
  const outputPath = writeIndex >= 0 ? args[writeIndex + 1] : '';
  const inventory = buildInventory();
  printSummary(inventory);

  if (outputPath) {
    const absoluteOutputPath = path.resolve(projectRoot, outputPath);
    fs.mkdirSync(path.dirname(absoluteOutputPath), { recursive: true });
    fs.writeFileSync(absoluteOutputPath, `${JSON.stringify(inventory, null, 2)}\n`, 'utf8');
    console.log(`Inventory written: ${toProjectPath(absoluteOutputPath)}`);
  }

  const failures = validationFailures(inventory);
  if (failures.length) {
    console.error('REFACTOR BASELINE FAILED');
    failures.forEach(([label, values]) => {
      console.error(`- ${label}: ${values.length}`);
      values.slice(0, 20).forEach((value) => console.error(`  ${JSON.stringify(value)}`));
    });
    process.exitCode = 1;
    return;
  }

  console.log('REFACTOR BASELINE PASSED');
}

main();
