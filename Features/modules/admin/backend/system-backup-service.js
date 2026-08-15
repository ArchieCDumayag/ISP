const archiver = require('archiver');
const crypto = require('crypto');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { pipeline } = require('stream/promises');
const yauzl = require('yauzl');
const { getPool } = require('../../../../core/data/db');
const { isRelationalReady } = require('../../../../core/data/db-relational');
const { getStorageDriver } = require('../../../../core/config/storage-mode');
const { DATA_DIR, PROJECT_ROOT, PUBLIC_ROOT, isPathInside } = require('../../../../core/runtime/paths');
const { countStoreRecords } = require('./factory-reset');

const BACKUP_KIND = 'isp-full-system-backup';
const BACKUP_SCHEMA_VERSION = 1;
const RESTORE_CONFIRMATION_PHRASE = 'RESTORE ALL DATA';
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const TABLE_NAME_PATTERN = /^[A-Za-z0-9_]+$/;
const MAX_ARCHIVE_BYTES = Number(process.env.SYSTEM_BACKUP_MAX_ARCHIVE_BYTES) || (2 * 1024 * 1024 * 1024);
const MAX_UNCOMPRESSED_BYTES = Number(process.env.SYSTEM_BACKUP_MAX_UNCOMPRESSED_BYTES) || (10 * 1024 * 1024 * 1024);
const MAX_ARCHIVE_ENTRIES = Number(process.env.SYSTEM_BACKUP_MAX_ENTRIES) || 100000;
const MANIFEST_MAX_BYTES = 5 * 1024 * 1024;
const STORE_TABLE = String(process.env.MYSQL_STORE_TABLE || 'app_store').trim() || 'app_store';

const EXCLUDED_JSON_FILES = new Set([
  'customer_sessions.json',
  'master-key.backup.json',
  'master-key.json',
  'mysql-config.backup.json',
  'mysql-config.json',
  'sessions.json'
]);
const EXCLUDED_MYSQL_TABLES = new Set(['sessions']);
const EXCLUDED_APP_STORE_KEYS = new Set(['customer_sessions', 'sessions']);
const FILE_ROOTS = Object.freeze([
  Object.freeze({ scope: 'data-uploads', root: path.join(DATA_DIR, 'uploads') }),
  Object.freeze({ scope: 'public-uploads', root: path.join(PUBLIC_ROOT, 'uploads') })
]);
const EXCLUDED_SCOPE = Object.freeze([
  'Runtime Admin and customer sessions',
  'CONFIG_MASTER_KEY and MySQL connection files',
  'Firebase/service-account credential files',
  'Generated backups, payment-history backups, and PDF cache',
  'Environment files, logs, source code, and Android offline storage'
]);

const cloneJson = (value) => JSON.parse(JSON.stringify(value));
const sum = (items, field) => (items || []).reduce((total, item) => total + Number(item?.[field] || 0), 0);
const toPosixPath = (value) => String(value || '').split(path.sep).join('/');
const archiveStorePath = (fileName) => `records/json/${encodeURIComponent(fileName)}`;
const archiveTablePath = (tableName) => `records/mysql/${encodeURIComponent(tableName)}.json`;
const archiveUploadPath = (scope, relativePath) => `files/${scope}/${toPosixPath(relativePath)}`;

const isSensitiveJsonFile = (fileName) => {
  const normalized = String(fileName || '').trim().toLowerCase();
  if (!normalized || EXCLUDED_JSON_FILES.has(normalized)) return true;
  return normalized.includes('firebase-service-account')
    || normalized.startsWith('service-account')
    || normalized.includes('-service-account');
};

const assertSafeFileName = (fileName, label = 'file') => {
  const normalized = String(fileName || '').trim();
  if (!normalized || normalized === '.' || normalized === '..' || normalized.includes('\0')) {
    throw new Error(`Invalid ${label} name in backup.`);
  }
  if (path.basename(normalized) !== normalized || normalized.includes('/') || normalized.includes('\\')) {
    throw new Error(`Unsafe ${label} name in backup: ${normalized}`);
  }
  return normalized;
};

const assertSafeRelativePath = (relativePath, label = 'file') => {
  const normalized = String(relativePath || '').trim().replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || normalized.includes('\0')) {
    throw new Error(`Invalid ${label} path in backup.`);
  }
  const cleaned = path.posix.normalize(normalized);
  if (cleaned !== normalized || cleaned === '..' || cleaned.startsWith('../')) {
    throw new Error(`Unsafe ${label} path in backup: ${normalized}`);
  }
  return normalized;
};

const assertTableName = (tableName) => {
  const normalized = String(tableName || '').trim();
  if (!TABLE_NAME_PATTERN.test(normalized)) {
    throw new Error(`Unsupported MySQL table name: ${normalized || '(blank)'}`);
  }
  return normalized;
};

const quoteIdentifier = (identifier) => `\`${assertTableName(identifier)}\``;

const hashFile = async (filePath) => {
  const hash = crypto.createHash('sha256');
  let bytes = 0;
  const input = fs.createReadStream(filePath);
  input.on('data', (chunk) => {
    hash.update(chunk);
    bytes += chunk.length;
  });
  await pipeline(input, new (require('stream').Writable)({
    write(_chunk, _encoding, callback) {
      callback();
    }
  }));
  return { sha256: hash.digest('hex'), bytes };
};

const writeJsonFile = async (filePath, value) => {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
};

const pathExists = async (targetPath) => {
  try {
    await fsp.access(targetPath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
};

const removePath = async (targetPath) => {
  if (!targetPath) return;
  await fsp.rm(targetPath, { recursive: true, force: true });
};

const listRegularFiles = async (rootPath) => {
  const files = [];
  const warnings = [];
  const walk = async (directory, relativeBase = '') => {
    let entries = [];
    try {
      entries = await fsp.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relativePath = relativeBase ? path.join(relativeBase, entry.name) : entry.name;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        warnings.push(`Skipped symbolic link: ${toPosixPath(relativePath)}`);
      } else if (entry.isDirectory()) {
        await walk(absolutePath, relativePath);
      } else if (entry.isFile()) {
        files.push({ absolutePath, relativePath });
      } else {
        warnings.push(`Skipped unsupported file type: ${toPosixPath(relativePath)}`);
      }
    }
  };
  await walk(rootPath);
  return { files, warnings };
};

const encodeMysqlValue = (value) => {
  if (Buffer.isBuffer(value)) {
    return { __ispBackupType: 'buffer', base64: value.toString('base64') };
  }
  if (typeof value === 'bigint') {
    return { __ispBackupType: 'bigint', value: value.toString() };
  }
  if (value instanceof Date) {
    return { __ispBackupType: 'date', value: value.toISOString() };
  }
  return value;
};

const decodeMysqlValue = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  if (value.__ispBackupType === 'buffer') return Buffer.from(String(value.base64 || ''), 'base64');
  if (value.__ispBackupType === 'bigint') return String(value.value || '0');
  if (value.__ispBackupType === 'date') return String(value.value || '');
  return value;
};

const getApplicationVersion = async () => {
  try {
    const raw = await fsp.readFile(path.join(PROJECT_ROOT, 'package.json'), 'utf8');
    return String(JSON.parse(raw)?.version || 'unknown');
  } catch {
    return 'unknown';
  }
};

function createSystemBackupService(options = {}) {
  const dataDir = path.resolve(options.dataDir || DATA_DIR);
  const publicRoot = path.resolve(options.publicRoot || PUBLIC_ROOT);
  const fileRoots = options.fileRoots || [
    { scope: 'data-uploads', root: path.join(dataDir, 'uploads') },
    { scope: 'public-uploads', root: path.join(publicRoot, 'uploads') }
  ];
  const storageDriver = options.getStorageDriver || getStorageDriver;
  const relationalReady = options.isRelationalReady || isRelationalReady;
  const acquirePool = options.getPool || getPool;
  const stagingRoot = path.resolve(options.stagingRoot || path.join(dataDir, 'backups', '.system-backup-staging'));
  const backupRoot = path.resolve(options.backupRoot || path.join(dataDir, 'backups'));

  const createWorkingDirectory = async (prefix) => {
    await fsp.mkdir(stagingRoot, { recursive: true });
    return fsp.mkdtemp(path.join(stagingRoot, prefix));
  };

  const captureJsonRecords = async (workspace) => {
    let entries = [];
    try {
      entries = await fsp.readdir(dataDir, { withFileTypes: true });
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    const stores = [];
    const warnings = [];
    const candidates = entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
      .sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of candidates) {
      if (isSensitiveJsonFile(entry.name)) continue;
      const fileName = assertSafeFileName(entry.name, 'JSON store');
      const sourcePath = path.join(dataDir, fileName);
      const destinationPath = path.join(workspace, archiveStorePath(fileName).split('/').join(path.sep));
      await fsp.mkdir(path.dirname(destinationPath), { recursive: true });
      await fsp.copyFile(sourcePath, destinationPath);
      let parsed;
      try {
        parsed = JSON.parse(await fsp.readFile(destinationPath, 'utf8'));
      } catch (error) {
        throw new Error(`Cannot export invalid JSON store ${fileName}: ${error.message}`);
      }
      const digest = await hashFile(destinationPath);
      const key = fileName.slice(0, -5);
      stores.push({
        key,
        fileName,
        archivePath: archiveStorePath(fileName),
        records: countStoreRecords(key, parsed),
        ...digest
      });
    }
    return { stores, warnings };
  };

  const getMysqlTables = async (connection) => {
    const [rows] = await connection.query(
      `SELECT TABLE_NAME AS tableName, ENGINE AS engine
       FROM information_schema.tables
       WHERE table_schema = DATABASE()
         AND TABLE_TYPE = 'BASE TABLE'
       ORDER BY TABLE_NAME`
    );
    return (rows || [])
      .map((row) => ({
        tableName: assertTableName(row.tableName || row.TABLE_NAME),
        engine: String(row.engine || row.ENGINE || '')
      }))
      .filter((row) => !EXCLUDED_MYSQL_TABLES.has(row.tableName));
  };

  const getMysqlColumns = async (connection, tableName) => {
    const [rows] = await connection.query(
      `SELECT COLUMN_NAME AS columnName,
              COLUMN_TYPE AS columnType,
              IS_NULLABLE AS isNullable,
              COLUMN_DEFAULT AS columnDefault,
              EXTRA AS extra,
              ORDINAL_POSITION AS ordinalPosition
       FROM information_schema.columns
       WHERE table_schema = DATABASE()
         AND table_name = ?
       ORDER BY ORDINAL_POSITION`,
      [tableName]
    );
    return (rows || []).map((row) => ({
      name: String(row.columnName || row.COLUMN_NAME || ''),
      type: String(row.columnType || row.COLUMN_TYPE || '').toLowerCase(),
      nullable: String(row.isNullable || row.IS_NULLABLE || '').toUpperCase() === 'YES',
      defaultValue: row.columnDefault ?? row.COLUMN_DEFAULT ?? null,
      extra: String(row.extra || row.EXTRA || ''),
      ordinal: Number(row.ordinalPosition || row.ORDINAL_POSITION || 0)
    }));
  };

  const captureMysqlRecords = async (workspace) => {
    if (!(await relationalReady())) {
      throw new Error('MySQL storage is selected, but the relational schema is not available.');
    }
    const pool = await acquirePool();
    if (!pool) throw new Error('MySQL connection is not available.');
    const connection = await pool.getConnection();
    try {
      const tableList = await getMysqlTables(connection);
      const tables = [];
      for (const tableInfo of tableList) {
        const columns = await getMysqlColumns(connection, tableInfo.tableName);
        const insertColumns = columns
          .filter((column) => !column.extra.toUpperCase().includes('GENERATED'))
          .map((column) => column.name);
        let sql = `SELECT * FROM ${quoteIdentifier(tableInfo.tableName)}`;
        const params = [];
        if (tableInfo.tableName === STORE_TABLE && EXCLUDED_APP_STORE_KEYS.size) {
          sql += ` WHERE store_key NOT IN (${[...EXCLUDED_APP_STORE_KEYS].map(() => '?').join(', ')})`;
          params.push(...EXCLUDED_APP_STORE_KEYS);
        }
        const [rows] = await connection.query(sql, params);
        const encodedRows = (rows || []).map((row) => Object.fromEntries(
          insertColumns.map((columnName) => [columnName, encodeMysqlValue(row[columnName])])
        ));
        const archivePath = archiveTablePath(tableInfo.tableName);
        const destinationPath = path.join(workspace, archivePath.split('/').join(path.sep));
        await writeJsonFile(destinationPath, { rows: encodedRows });
        const digest = await hashFile(destinationPath);
        tables.push({
          tableName: tableInfo.tableName,
          engine: tableInfo.engine,
          columns,
          insertColumns,
          archivePath,
          records: encodedRows.length,
          ...digest
        });
      }
      return { tables, warnings: [] };
    } finally {
      connection.release();
    }
  };

  const captureUploads = async (workspace) => {
    const files = [];
    const warnings = [];
    for (const fileRoot of fileRoots) {
      const scope = String(fileRoot.scope || '').trim();
      if (!FILE_ROOTS.some((known) => known.scope === scope)) {
        throw new Error(`Unsupported upload scope: ${scope}`);
      }
      const discovered = await listRegularFiles(fileRoot.root);
      warnings.push(...discovered.warnings.map((warning) => `${scope}: ${warning}`));
      for (const source of discovered.files) {
        const relativePath = assertSafeRelativePath(toPosixPath(source.relativePath), `${scope} upload`);
        const archivePath = archiveUploadPath(scope, relativePath);
        const destinationPath = path.join(workspace, archivePath.split('/').join(path.sep));
        await fsp.mkdir(path.dirname(destinationPath), { recursive: true });
        await fsp.copyFile(source.absolutePath, destinationPath);
        const digest = await hashFile(destinationPath);
        files.push({ scope, relativePath, archivePath, ...digest });
      }
    }
    return { files, warnings };
  };

  const buildSnapshot = async () => {
    const workspace = await createWorkingDirectory('export-');
    try {
      const driver = String(storageDriver() || '').trim().toLowerCase();
      if (!['json', 'mysql'].includes(driver)) {
        throw new Error(`Unsupported storage driver for backup: ${driver || '(blank)'}`);
      }
      const recordResult = driver === 'mysql'
        ? await captureMysqlRecords(workspace)
        : await captureJsonRecords(workspace);
      const uploadResult = await captureUploads(workspace);
      const jsonStores = recordResult.stores || [];
      const mysqlTables = recordResult.tables || [];
      const recordContainers = driver === 'mysql' ? mysqlTables : jsonStores;
      const manifest = {
        kind: BACKUP_KIND,
        schemaVersion: BACKUP_SCHEMA_VERSION,
        snapshotId: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        applicationVersion: await getApplicationVersion(),
        storageDriver: driver,
        records: { jsonStores, mysqlTables },
        uploads: {
          roots: fileRoots.map((item) => String(item.scope)),
          files: uploadResult.files
        },
        summary: {
          recordContainerCount: recordContainers.length,
          recordCount: sum(recordContainers, 'records'),
          uploadFileCount: uploadResult.files.length,
          uploadBytes: sum(uploadResult.files, 'bytes')
        },
        excluded: [...EXCLUDED_SCOPE],
        warnings: [...(recordResult.warnings || []), ...(uploadResult.warnings || [])]
      };
      await writeJsonFile(path.join(workspace, 'manifest.json'), manifest);
      return { workspace, manifest };
    } catch (error) {
      await removePath(workspace).catch(() => {});
      throw error;
    }
  };

  const createArchiveAt = async (destinationPath) => {
    const snapshot = await buildSnapshot();
    try {
      await fsp.mkdir(path.dirname(destinationPath), { recursive: true });
      await new Promise((resolve, reject) => {
        const output = fs.createWriteStream(destinationPath);
        const archive = archiver('zip', { zlib: { level: 6 } });
        let settled = false;
        const finish = (error) => {
          if (settled) return;
          settled = true;
          if (error) reject(error); else resolve();
        };
        output.on('close', () => finish());
        output.on('error', finish);
        archive.on('error', finish);
        archive.pipe(output);
        archive.directory(snapshot.workspace, false);
        archive.finalize().catch(finish);
      });
      return { destinationPath, manifest: snapshot.manifest };
    } catch (error) {
      await fsp.unlink(destinationPath).catch(() => {});
      throw error;
    } finally {
      await removePath(snapshot.workspace).catch(() => {});
    }
  };

  const createTemporaryArchive = async () => {
    const tempRoot = await createWorkingDirectory('download-');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `isp-full-system-backup-${stamp}.isp-backup.zip`;
    const destinationPath = path.join(tempRoot, fileName);
    const result = await createArchiveAt(destinationPath);
    return { ...result, fileName, tempRoot };
  };

  const createPreImportBackup = async () => {
    await fsp.mkdir(backupRoot, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `pre-import-system-backup-${stamp}-${crypto.randomUUID().slice(0, 8)}.isp-backup.zip`;
    const destinationPath = path.join(backupRoot, fileName);
    const result = await createArchiveAt(destinationPath);
    return { ...result, fileName };
  };

  const receiveArchive = async (request) => {
    const stageRoot = await createWorkingDirectory('import-');
    const archivePath = path.join(stageRoot, 'incoming.isp-backup.zip');
    let bytes = 0;
    try {
      const declaredBytes = Number(request.headers?.['content-length'] || 0);
      if (declaredBytes > MAX_ARCHIVE_BYTES) {
        const error = new Error('Backup archive exceeds the configured upload limit.');
        error.statusCode = 413;
        throw error;
      }
      const limiter = new (require('stream').Transform)({
        transform(chunk, _encoding, callback) {
          bytes += chunk.length;
          if (bytes > MAX_ARCHIVE_BYTES) {
            const error = new Error('Backup archive exceeds the configured upload limit.');
            error.statusCode = 413;
            callback(error);
            return;
          }
          callback(null, chunk);
        }
      });
      await pipeline(request, limiter, fs.createWriteStream(archivePath, { flags: 'wx' }));
      if (!bytes) throw new Error('The selected backup file is empty.');
      return { stageRoot, archivePath, archiveBytes: bytes };
    } catch (error) {
      await removePath(stageRoot).catch(() => {});
      throw error;
    }
  };

  const extractArchive = async (archivePath, contentRoot) => {
    await fsp.mkdir(contentRoot, { recursive: true });
    const extracted = new Map();
    let entryCount = 0;
    let totalBytes = 0;

    await new Promise((resolve, reject) => {
      yauzl.open(archivePath, { lazyEntries: true, autoClose: true, validateEntrySizes: true }, (openError, zip) => {
        if (openError) {
          reject(new Error(`Invalid backup ZIP archive: ${openError.message}`));
          return;
        }
        let failed = false;
        const fail = (error) => {
          if (failed) return;
          failed = true;
          try { zip.close(); } catch { /* ignore close failure */ }
          reject(error);
        };
        zip.on('error', fail);
        zip.on('end', () => {
          if (!failed) resolve();
        });
        zip.on('entry', (entry) => {
          if (failed) return;
          const entryName = String(entry.fileName || '');
          if (!entryName || entryName.includes('\\') || entryName.includes('\0')) {
            fail(new Error('Backup contains an unsafe ZIP entry name.'));
            return;
          }
          const normalized = path.posix.normalize(entryName);
          if (normalized !== entryName || normalized.startsWith('/') || normalized === '..' || normalized.startsWith('../')) {
            fail(new Error(`Backup contains an unsafe ZIP entry: ${entryName}`));
            return;
          }
          if (entryName.endsWith('/')) {
            zip.readEntry();
            return;
          }
          entryCount += 1;
          totalBytes += Number(entry.uncompressedSize || 0);
          if (entryCount > MAX_ARCHIVE_ENTRIES || totalBytes > MAX_UNCOMPRESSED_BYTES) {
            fail(new Error('Backup archive expands beyond the configured safety limits.'));
            return;
          }
          if (extracted.has(entryName)) {
            fail(new Error(`Backup contains a duplicate ZIP entry: ${entryName}`));
            return;
          }
          const destinationPath = path.resolve(contentRoot, ...entryName.split('/'));
          if (!isPathInside(contentRoot, destinationPath)) {
            fail(new Error(`Backup entry escapes the extraction directory: ${entryName}`));
            return;
          }
          zip.openReadStream(entry, async (streamError, readStream) => {
            if (streamError) {
              fail(streamError);
              return;
            }
            try {
              await fsp.mkdir(path.dirname(destinationPath), { recursive: true });
              const hash = crypto.createHash('sha256');
              let writtenBytes = 0;
              const hasher = new (require('stream').Transform)({
                transform(chunk, _encoding, callback) {
                  writtenBytes += chunk.length;
                  hash.update(chunk);
                  callback(null, chunk);
                }
              });
              await pipeline(readStream, hasher, fs.createWriteStream(destinationPath, { flags: 'wx' }));
              extracted.set(entryName, { bytes: writtenBytes, sha256: hash.digest('hex'), destinationPath });
              zip.readEntry();
            } catch (error) {
              fail(error);
            }
          });
        });
        zip.readEntry();
      });
    });
    return { extracted, entryCount, totalBytes };
  };

  const assertManifestFile = (descriptor, extracted, expectedPaths, expectedPrefix) => {
    const archivePath = assertSafeRelativePath(descriptor?.archivePath, 'archive entry');
    if (!archivePath.startsWith(expectedPrefix)) {
      throw new Error(`Backup entry is outside its declared section: ${archivePath}`);
    }
    if (expectedPaths.has(archivePath)) throw new Error(`Backup manifest repeats entry: ${archivePath}`);
    expectedPaths.add(archivePath);
    const actual = extracted.get(archivePath);
    if (!actual) throw new Error(`Backup is missing declared entry: ${archivePath}`);
    const declaredBytes = Number(descriptor?.bytes);
    const declaredHash = String(descriptor?.sha256 || '').toLowerCase();
    if (!Number.isSafeInteger(declaredBytes) || declaredBytes < 0 || declaredBytes !== actual.bytes) {
      throw new Error(`Backup size check failed for ${archivePath}.`);
    }
    if (!HASH_PATTERN.test(declaredHash) || declaredHash !== actual.sha256) {
      throw new Error(`Backup checksum check failed for ${archivePath}.`);
    }
    return actual.destinationPath;
  };

  const validateArchive = async (received) => {
    const contentRoot = path.join(received.stageRoot, 'contents');
    try {
      const extraction = await extractArchive(received.archivePath, contentRoot);
      const manifestEntry = extraction.extracted.get('manifest.json');
      if (!manifestEntry) throw new Error('Backup manifest.json is missing.');
      if (manifestEntry.bytes > MANIFEST_MAX_BYTES) throw new Error('Backup manifest is too large.');
      let manifest;
      try {
        manifest = JSON.parse(await fsp.readFile(manifestEntry.destinationPath, 'utf8'));
      } catch (error) {
        throw new Error(`Backup manifest is invalid JSON: ${error.message}`);
      }
      if (manifest?.kind !== BACKUP_KIND || Number(manifest?.schemaVersion) !== BACKUP_SCHEMA_VERSION) {
        throw new Error('This file is not a supported ISP full-system backup.');
      }
      const driver = String(manifest.storageDriver || '').trim().toLowerCase();
      if (!['json', 'mysql'].includes(driver)) throw new Error('Backup storage driver is invalid.');
      const currentDriver = String(storageDriver() || '').trim().toLowerCase();
      if (driver !== currentDriver) {
        throw new Error(`Backup uses ${driver.toUpperCase()} storage, but this server uses ${currentDriver.toUpperCase()} storage.`);
      }

      const jsonStores = Array.isArray(manifest?.records?.jsonStores) ? manifest.records.jsonStores : [];
      const mysqlTables = Array.isArray(manifest?.records?.mysqlTables) ? manifest.records.mysqlTables : [];
      const uploadFiles = Array.isArray(manifest?.uploads?.files) ? manifest.uploads.files : [];
      const uploadRoots = Array.isArray(manifest?.uploads?.roots) ? manifest.uploads.roots : [];
      if (driver === 'json' && mysqlTables.length) throw new Error('JSON backup unexpectedly declares MySQL tables.');
      if (driver === 'mysql' && jsonStores.length) throw new Error('MySQL backup unexpectedly declares JSON stores.');
      const knownScopes = new Set(fileRoots.map((item) => item.scope));
      if (
        uploadRoots.length !== knownScopes.size
        || new Set(uploadRoots).size !== knownScopes.size
        || uploadRoots.some((scope) => !knownScopes.has(scope))
      ) {
        throw new Error('Backup does not declare the complete upload-root set.');
      }

      const expectedPaths = new Set(['manifest.json']);
      const parsedStores = new Map();
      const storeFiles = new Set();
      for (const descriptor of jsonStores) {
        const fileName = assertSafeFileName(descriptor?.fileName, 'JSON store');
        if (isSensitiveJsonFile(fileName)) throw new Error(`Backup attempts to restore excluded secret/session file: ${fileName}`);
        if (storeFiles.has(fileName)) throw new Error(`Backup repeats JSON store: ${fileName}`);
        storeFiles.add(fileName);
        const expectedKey = fileName.slice(0, -5);
        if (String(descriptor?.key || '') !== expectedKey || descriptor?.archivePath !== archiveStorePath(fileName)) {
          throw new Error(`Backup JSON store identity is inconsistent for ${fileName}.`);
        }
        const storePath = assertManifestFile(descriptor, extraction.extracted, expectedPaths, 'records/json/');
        let parsed;
        try {
          parsed = JSON.parse(await fsp.readFile(storePath, 'utf8'));
        } catch (error) {
          throw new Error(`Backup JSON store ${fileName} is invalid: ${error.message}`);
        }
        if (Number(descriptor.records) !== countStoreRecords(expectedKey, parsed)) {
          throw new Error(`Backup record count check failed for JSON store ${fileName}.`);
        }
        parsedStores.set(fileName, parsed);
      }

      const parsedTables = new Map();
      const tableNames = new Set();
      for (const descriptor of mysqlTables) {
        const tableName = assertTableName(descriptor?.tableName);
        if (EXCLUDED_MYSQL_TABLES.has(tableName)) throw new Error(`Backup attempts to restore excluded session table: ${tableName}`);
        if (tableNames.has(tableName)) throw new Error(`Backup repeats MySQL table: ${tableName}`);
        tableNames.add(tableName);
        if (!Array.isArray(descriptor.columns) || !Array.isArray(descriptor.insertColumns)) {
          throw new Error(`Backup schema metadata is missing for table ${tableName}.`);
        }
        if (descriptor.archivePath !== archiveTablePath(tableName)) {
          throw new Error(`Backup table identity is inconsistent for ${tableName}.`);
        }
        const columnNames = descriptor.columns.map((column) => assertTableName(column?.name));
        if (new Set(columnNames).size !== columnNames.length) {
          throw new Error(`Backup repeats a schema column for table ${tableName}.`);
        }
        const expectedInsertColumns = descriptor.columns
          .filter((column) => !String(column?.extra || '').toUpperCase().includes('GENERATED'))
          .map((column) => column.name);
        if (JSON.stringify(descriptor.insertColumns) !== JSON.stringify(expectedInsertColumns)) {
          throw new Error(`Backup insert-column metadata is inconsistent for table ${tableName}.`);
        }
        const tablePath = assertManifestFile(descriptor, extraction.extracted, expectedPaths, 'records/mysql/');
        let parsed;
        try {
          parsed = JSON.parse(await fsp.readFile(tablePath, 'utf8'));
        } catch (error) {
          throw new Error(`Backup table ${tableName} is invalid JSON: ${error.message}`);
        }
        if (!Array.isArray(parsed?.rows) || parsed.rows.length !== Number(descriptor.records || 0)) {
          throw new Error(`Backup row count check failed for table ${tableName}.`);
        }
        for (const row of parsed.rows) {
          if (!row || typeof row !== 'object' || Array.isArray(row)) {
            throw new Error(`Backup contains an invalid row for table ${tableName}.`);
          }
          if (descriptor.insertColumns.some((columnName) => !Object.prototype.hasOwnProperty.call(row, columnName))) {
            throw new Error(`Backup row is missing a declared column for table ${tableName}.`);
          }
          if (tableName === STORE_TABLE && EXCLUDED_APP_STORE_KEYS.has(String(row.store_key || ''))) {
            throw new Error('Backup attempts to restore excluded runtime session data through app_store.');
          }
        }
        parsedTables.set(tableName, parsed.rows);
      }

      const uploadKeys = new Set();
      for (const descriptor of uploadFiles) {
        const scope = String(descriptor?.scope || '').trim();
        if (!knownScopes.has(scope)) throw new Error(`Backup contains unknown upload scope: ${scope}`);
        const relativePath = assertSafeRelativePath(descriptor?.relativePath, `${scope} upload`);
        const uploadKey = `${scope}:${relativePath}`;
        if (uploadKeys.has(uploadKey)) throw new Error(`Backup repeats upload file: ${uploadKey}`);
        uploadKeys.add(uploadKey);
        if (descriptor.archivePath !== archiveUploadPath(scope, relativePath)) {
          throw new Error(`Backup upload identity is inconsistent for ${uploadKey}.`);
        }
        assertManifestFile(descriptor, extraction.extracted, expectedPaths, `files/${scope}/`);
      }
      const extraPaths = [...extraction.extracted.keys()].filter((entryName) => !expectedPaths.has(entryName));
      if (extraPaths.length) throw new Error(`Backup contains undeclared entries, starting with ${extraPaths[0]}.`);

      if (driver === 'json') {
        const accounts = parsedStores.get('accounts.json');
        if (!Array.isArray(accounts) || !accounts.some((account) => (
          account?.isActive !== false
          && String(account?.role || '').toLowerCase().includes('admin')
        ))) {
          throw new Error('Backup does not contain an active Admin account record.');
        }
      } else {
        const users = parsedTables.get('users');
        if (!Array.isArray(users) || !users.some((user) => (
          user?.is_active !== 0
          && user?.is_active !== false
          && String(user?.role || '').toLowerCase().includes('admin')
        ))) {
          throw new Error('Backup does not contain an Admin user record.');
        }
        await validateMysqlCompatibility(mysqlTables);
      }

      const archiveRecordContainers = driver === 'json' ? jsonStores : mysqlTables;
      return {
        ...received,
        contentRoot,
        manifest: cloneJson(manifest),
        parsedStores,
        parsedTables,
        summary: {
          recordContainerCount: archiveRecordContainers.length,
          recordCount: sum(archiveRecordContainers, 'records'),
          uploadFileCount: uploadFiles.length,
          uploadBytes: sum(uploadFiles, 'bytes')
        }
      };
    } catch (error) {
      await removePath(received.stageRoot).catch(() => {});
      throw error;
    }
  };

  const validateMysqlCompatibility = async (archiveTables) => {
    if (!(await relationalReady())) throw new Error('MySQL relational schema is not available.');
    const pool = await acquirePool();
    if (!pool) throw new Error('MySQL connection is not available.');
    const connection = await pool.getConnection();
    try {
      const currentTables = await getMysqlTables(connection);
      const currentNames = currentTables.map((table) => table.tableName).sort();
      const archiveNames = archiveTables.map((table) => table.tableName).sort();
      if (JSON.stringify(currentNames) !== JSON.stringify(archiveNames)) {
        throw new Error('MySQL schema table set differs from this backup; update the application/schema before restoring.');
      }
      const currentByName = new Map(currentTables.map((table) => [table.tableName, table]));
      for (const archiveTable of archiveTables) {
        const currentInfo = currentByName.get(archiveTable.tableName);
        if (String(currentInfo?.engine || '').toLowerCase() !== 'innodb') {
          throw new Error(`Table ${archiveTable.tableName} is not transactional InnoDB; safe restore is unavailable.`);
        }
        const currentColumns = await getMysqlColumns(connection, archiveTable.tableName);
        const currentSignature = currentColumns.map((column) => `${column.name}:${column.type}`);
        const archiveSignature = archiveTable.columns.map((column) => `${column.name}:${String(column.type || '').toLowerCase()}`);
        if (JSON.stringify(currentSignature) !== JSON.stringify(archiveSignature)) {
          throw new Error(`MySQL schema columns differ for ${archiveTable.tableName}; safe restore stopped.`);
        }
      }
    } finally {
      connection.release();
    }
  };

  const inspectCurrentUploads = async () => {
    let fileCount = 0;
    let bytes = 0;
    for (const fileRoot of fileRoots) {
      const discovered = await listRegularFiles(fileRoot.root);
      fileCount += discovered.files.length;
      for (const file of discovered.files) {
        const stat = await fsp.stat(file.absolutePath);
        bytes += Number(stat.size || 0);
      }
    }
    return { uploadFileCount: fileCount, uploadBytes: bytes };
  };

  const inspectCurrent = async () => {
    const driver = String(storageDriver() || '').trim().toLowerCase();
    const uploads = await inspectCurrentUploads();
    if (driver === 'json') {
      let entries = [];
      try {
        entries = await fsp.readdir(dataDir, { withFileTypes: true });
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
      const stores = [];
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.json') || isSensitiveJsonFile(entry.name)) continue;
        let parsed = null;
        try {
          parsed = JSON.parse(await fsp.readFile(path.join(dataDir, entry.name), 'utf8'));
        } catch {
          parsed = null;
        }
        stores.push({ records: countStoreRecords(entry.name.slice(0, -5), parsed) });
      }
      return {
        storageDriver: driver,
        recordContainerCount: stores.length,
        recordCount: sum(stores, 'records'),
        ...uploads
      };
    }
    if (!(await relationalReady())) throw new Error('MySQL relational schema is not available.');
    const pool = await acquirePool();
    if (!pool) throw new Error('MySQL connection is not available.');
    const connection = await pool.getConnection();
    try {
      const tables = await getMysqlTables(connection);
      let recordCount = 0;
      for (const table of tables) {
        let sql = `SELECT COUNT(*) AS count FROM ${quoteIdentifier(table.tableName)}`;
        const params = [];
        if (table.tableName === STORE_TABLE && EXCLUDED_APP_STORE_KEYS.size) {
          sql += ` WHERE store_key NOT IN (${[...EXCLUDED_APP_STORE_KEYS].map(() => '?').join(', ')})`;
          params.push(...EXCLUDED_APP_STORE_KEYS);
        }
        const [rows] = await connection.query(sql, params);
        recordCount += Number(rows?.[0]?.count || 0);
      }
      return { storageDriver: driver, recordContainerCount: tables.length, recordCount, ...uploads };
    } finally {
      connection.release();
    }
  };

  const moveIfExists = async (sourcePath, destinationPath) => {
    if (!(await pathExists(sourcePath))) return false;
    await fsp.mkdir(path.dirname(destinationPath), { recursive: true });
    await fsp.rename(sourcePath, destinationPath);
    return true;
  };

  const swapFilesystem = async (prepared, includeJsonStores) => {
    const rollbackRoot = path.join(prepared.stageRoot, 'rollback');
    const installedTargets = [];
    const originalTargets = [];
    await fsp.mkdir(rollbackRoot, { recursive: true });
    try {
      if (includeJsonStores) {
        let currentEntries = [];
        try {
          currentEntries = await fsp.readdir(dataDir, { withFileTypes: true });
        } catch (error) {
          if (error?.code !== 'ENOENT') throw error;
        }
        const currentFiles = currentEntries
          .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json') && !isSensitiveJsonFile(entry.name))
          .map((entry) => entry.name);
        for (const fileName of currentFiles) {
          const sourcePath = path.join(dataDir, fileName);
          const rollbackPath = path.join(rollbackRoot, 'json', fileName);
          if (await moveIfExists(sourcePath, rollbackPath)) originalTargets.push({ targetPath: sourcePath, rollbackPath });
        }
        for (const descriptor of prepared.manifest.records.jsonStores) {
          const targetPath = path.join(dataDir, descriptor.fileName);
          const sourcePath = path.join(prepared.contentRoot, ...descriptor.archivePath.split('/'));
          await fsp.mkdir(path.dirname(targetPath), { recursive: true });
          await fsp.rename(sourcePath, targetPath);
          installedTargets.push(targetPath);
        }
        const invalidatedAt = new Date().toISOString();
        for (const sessionFile of ['sessions.json', 'customer_sessions.json']) {
          const targetPath = path.join(dataDir, sessionFile);
          const rollbackPath = path.join(rollbackRoot, 'sessions', sessionFile);
          if (await moveIfExists(targetPath, rollbackPath)) originalTargets.push({ targetPath, rollbackPath });
          await writeJsonFile(targetPath, { sessions: {}, updatedAt: invalidatedAt });
          installedTargets.push(targetPath);
        }
      }

      for (const fileRoot of fileRoots) {
        const targetPath = path.resolve(fileRoot.root);
        const allowedRoot = fileRoot.scope === 'data-uploads' ? dataDir : publicRoot;
        if (!isPathInside(allowedRoot, targetPath) || targetPath === allowedRoot) {
          throw new Error(`Unsafe upload restore target: ${targetPath}`);
        }
        const rollbackPath = path.join(rollbackRoot, 'uploads', fileRoot.scope);
        if (await moveIfExists(targetPath, rollbackPath)) originalTargets.push({ targetPath, rollbackPath });
        const sourcePath = path.join(prepared.contentRoot, 'files', fileRoot.scope);
        if (!(await pathExists(sourcePath))) await fsp.mkdir(sourcePath, { recursive: true });
        await fsp.mkdir(path.dirname(targetPath), { recursive: true });
        await fsp.rename(sourcePath, targetPath);
        installedTargets.push(targetPath);
      }
    } catch (error) {
      for (const targetPath of [...installedTargets].reverse()) await removePath(targetPath).catch(() => {});
      for (const item of [...originalTargets].reverse()) {
        await moveIfExists(item.rollbackPath, item.targetPath).catch(() => {});
      }
      throw error;
    }

    return {
      commit: async () => removePath(rollbackRoot),
      rollback: async () => {
        for (const targetPath of [...installedTargets].reverse()) await removePath(targetPath).catch(() => {});
        for (const item of [...originalTargets].reverse()) {
          await moveIfExists(item.rollbackPath, item.targetPath).catch(() => {});
        }
        await removePath(rollbackRoot).catch(() => {});
      }
    };
  };

  const insertMysqlRows = async (connection, descriptor, rows) => {
    if (!rows.length) return;
    const columns = descriptor.insertColumns.map((column) => assertTableName(column));
    const chunkSize = 100;
    for (let index = 0; index < rows.length; index += chunkSize) {
      const chunk = rows.slice(index, index + chunkSize);
      const placeholders = chunk.map(() => `(${columns.map(() => '?').join(', ')})`).join(', ');
      const params = [];
      for (const row of chunk) {
        for (const column of columns) params.push(decodeMysqlValue(row[column]));
      }
      await connection.query(
        `INSERT INTO ${quoteIdentifier(descriptor.tableName)} (${columns.map(quoteIdentifier).join(', ')}) VALUES ${placeholders}`,
        params
      );
    }
  };

  const restoreMysql = async (prepared) => {
    await validateMysqlCompatibility(prepared.manifest.records.mysqlTables);
    const pool = await acquirePool();
    if (!pool) throw new Error('MySQL connection is not available.');
    const connection = await pool.getConnection();
    let filesystemSwap = null;
    let foreignKeysDisabled = false;
    try {
      await connection.beginTransaction();
      await connection.query('SET FOREIGN_KEY_CHECKS = 0');
      foreignKeysDisabled = true;
      const tables = prepared.manifest.records.mysqlTables;
      for (const descriptor of [...tables].reverse()) {
        await connection.query(`DELETE FROM ${quoteIdentifier(descriptor.tableName)}`);
      }
      const [sessionTableRows] = await connection.query(
        `SELECT COUNT(*) AS count
         FROM information_schema.tables
         WHERE table_schema = DATABASE()
           AND table_name = 'sessions'`
      );
      if (Number(sessionTableRows?.[0]?.count || 0) > 0) {
        await connection.query('DELETE FROM `sessions`');
      }
      for (const descriptor of tables) {
        await insertMysqlRows(connection, descriptor, prepared.parsedTables.get(descriptor.tableName) || []);
      }
      filesystemSwap = await swapFilesystem(prepared, false);
      await connection.commit();
      await filesystemSwap.commit().catch(() => {});
    } catch (error) {
      await connection.rollback().catch(() => {});
      if (filesystemSwap) await filesystemSwap.rollback().catch(() => {});
      throw error;
    } finally {
      if (foreignKeysDisabled) await connection.query('SET FOREIGN_KEY_CHECKS = 1').catch(() => {});
      connection.release();
    }
  };

  const restoreJson = async (prepared) => {
    const filesystemSwap = await swapFilesystem(prepared, true);
    await filesystemSwap.commit().catch(() => {});
  };

  const restorePrepared = async (prepared) => {
    const currentDriver = String(storageDriver() || '').trim().toLowerCase();
    if (prepared.manifest.storageDriver !== currentDriver) {
      throw new Error('Server storage mode changed after preview. Select and validate the backup again.');
    }
    const preImportBackup = await createPreImportBackup();
    try {
      if (currentDriver === 'mysql') await restoreMysql(prepared);
      else await restoreJson(prepared);
      return {
        restoredAt: new Date().toISOString(),
        summary: cloneJson(prepared.summary),
        preImportBackup: {
          fileName: preImportBackup.fileName,
          relativePath: toPosixPath(path.relative(dataDir, preImportBackup.destinationPath))
        }
      };
    } catch (error) {
      error.preImportBackup = preImportBackup.fileName;
      throw error;
    }
  };

  const cleanupPrepared = async (prepared) => {
    if (!prepared?.stageRoot) return;
    await removePath(prepared.stageRoot);
  };

  return Object.freeze({
    createTemporaryArchive,
    createPreImportBackup,
    receiveArchive,
    validateArchive,
    inspectCurrent,
    restorePrepared,
    cleanupPrepared,
    get constants() {
      return Object.freeze({
        BACKUP_KIND,
        BACKUP_SCHEMA_VERSION,
        RESTORE_CONFIRMATION_PHRASE,
        EXCLUDED_SCOPE: [...EXCLUDED_SCOPE]
      });
    }
  });
}

module.exports = {
  BACKUP_KIND,
  BACKUP_SCHEMA_VERSION,
  RESTORE_CONFIRMATION_PHRASE,
  EXCLUDED_SCOPE,
  isSensitiveJsonFile,
  assertSafeRelativePath,
  createSystemBackupService
};
