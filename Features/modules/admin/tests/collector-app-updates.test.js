const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');

const projectRoot = path.resolve(__dirname, '..', '..', '..', '..');
const pathsModulePath = require.resolve(path.join(projectRoot, 'core/runtime/paths'));
const updateModulePath = require.resolve(path.join(
  projectRoot,
  'Features/modules/admin/backend/collector-app-updates'
));

async function closeServer(server) {
  if (!server?.listening) return;
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function run() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'isp-collector-ota-http-'));
  const updateDir = path.join(tempRoot, 'collector-updates');
  const originalPaths = require(pathsModulePath);
  const originalPathsCacheExport = require.cache[pathsModulePath].exports;
  let server;

  try {
    fs.mkdirSync(updateDir, { recursive: true });
    const apkBytes = Buffer.from('isolated Collector OTA route fixture');
    const sha256 = crypto.createHash('sha256').update(apkBytes).digest('hex');
    const fileName = `THRE3J-Collector-v9.99-999-${sha256.slice(0, 12)}.apk`;
    fs.writeFileSync(path.join(updateDir, fileName), apkBytes);
    fs.writeFileSync(path.join(updateDir, 'update.json'), `${JSON.stringify({
      versionCode: 999,
      versionName: '9.99',
      packageName: 'com.example.myapplication',
      fileName,
      sha256,
      fileSize: apkBytes.length,
      required: false,
      minimumVersionCode: 0,
      releaseNotes: 'Isolated HTTP contract fixture.',
      publishedAt: '2026-09-01T00:00:00.000Z',
      publishedBy: 'Test'
    }, null, 2)}\n`);

    require.cache[pathsModulePath].exports = Object.freeze({
      ...originalPaths,
      DATA_DIR: tempRoot
    });
    delete require.cache[updateModulePath];
    const collectorAppUpdates = require(updateModulePath);

    const app = express();
    app.use('/collector-updates', collectorAppUpdates.publicRouter);
    app.use('/api/collector-app-updates', (req, _res, next) => {
      const role = String(req.get('x-test-role') || '').trim();
      if (role) req.user = { id: `test-${role.toLowerCase()}`, role };
      next();
    }, collectorAppUpdates.adminRouter);
    app.use(express.static(path.join(projectRoot, 'Features/modules/admin/web'), { index: false }));

    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const pageResponse = await fetch(`${baseUrl}/collector-app-update.html`);
    assert.equal(pageResponse.status, 200);
    assert.match(await pageResponse.text(), /id="collectorUpdateForm"/);

    const manifestResponse = await fetch(`${baseUrl}/collector-updates/update.json`);
    assert.equal(manifestResponse.status, 200);
    assert.match(manifestResponse.headers.get('cache-control') || '', /no-store/);
    const manifest = await manifestResponse.json();
    assert.equal(manifest.versionCode, 999);
    assert.equal(manifest.versionName, '9.99');
    assert.equal(manifest.packageName, 'com.example.myapplication');
    assert.equal(manifest.sha256, sha256);
    assert.equal(manifest.fileSize, apkBytes.length);
    assert.equal(
      manifest.apkUrl,
      `http://192.168.100.9:3000/collector-updates/${fileName}`
    );

    const apkResponse = await fetch(`${baseUrl}/collector-updates/${fileName}`);
    assert.equal(apkResponse.status, 200);
    assert.equal(apkResponse.headers.get('content-type'), 'application/vnd.android.package-archive');
    assert.equal(Number(apkResponse.headers.get('content-length')), apkBytes.length);
    assert.match(apkResponse.headers.get('content-disposition') || '', new RegExp(fileName));
    assert.equal(apkResponse.headers.get('etag'), `"sha256-${sha256}"`);
    assert.deepEqual(Buffer.from(await apkResponse.arrayBuffer()), apkBytes);

    const collectorApiResponse = await fetch(`${baseUrl}/api/collector-app-updates`, {
      headers: { 'x-test-role': 'Collector' }
    });
    assert.equal(collectorApiResponse.status, 403);
    const adminApiResponse = await fetch(`${baseUrl}/api/collector-app-updates`, {
      headers: { 'x-test-role': 'Admin' }
    });
    assert.equal(adminApiResponse.status, 200);

    console.log('PASS isolated Collector OTA page, LAN manifest/APK delivery, and Admin-only API contract');
  } finally {
    await closeServer(server);
    require.cache[pathsModulePath].exports = originalPathsCacheExport;
    delete require.cache[updateModulePath];
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
