const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const logsDir = path.join(projectRoot, 'logs');
const cloudflaredConfig = process.env.CLOUDFLARED_CONFIG
  ? path.resolve(projectRoot, process.env.CLOUDFLARED_CONFIG)
  : path.join(projectRoot, '.cloudflared', 'config.yml');
const cloudflaredLog = process.env.CLOUDFLARED_LOG
  ? path.resolve(projectRoot, process.env.CLOUDFLARED_LOG)
  : path.join(logsDir, 'cloudflared.log');
let cloudflaredProc = null;
let cloudflaredRestartTimer = null;
let cloudflaredRestartAttempts = 0;
let cloudflaredStopping = false;

function resolveCloudflaredBin() {
  const candidates = [
    process.env.CLOUDFLARED_BIN,
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'cloudflared', 'cloudflared.exe'),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'cloudflared', 'cloudflared.exe')
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return 'cloudflared';
}

function clearCloudflaredRestartTimer() {
  if (!cloudflaredRestartTimer) return;
  clearTimeout(cloudflaredRestartTimer);
  cloudflaredRestartTimer = null;
}

if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

function startCloudflared() {
  if (String(process.env.DISABLE_CLOUDFLARED || '').trim() === '1') {
    console.warn('[warn] cloudflared disabled for this start.');
    return;
  }
  clearCloudflaredRestartTimer();
  if (cloudflaredProc && !cloudflaredProc.killed) {
    return;
  }
  if (!fs.existsSync(cloudflaredConfig)) {
    console.warn('[warn] cloudflared config not found; skipping tunnel.');
    return;
  }

  try {
    const rawConfig = fs.readFileSync(cloudflaredConfig, 'utf8');
    if (rawConfig.includes('YOUR_TUNNEL_ID')) {
      console.warn('[warn] cloudflared config still has placeholder YOUR_TUNNEL_ID.');
    }
  } catch (err) {
    console.warn(`[warn] Failed to read cloudflared config: ${err.message}`);
  }

  let logFd;
  let logClosed = false;
  const closeLog = () => {
    if (logClosed || typeof logFd !== 'number') return;
    logClosed = true;
    fs.closeSync(logFd);
  };
  try {
    logFd = fs.openSync(cloudflaredLog, 'a');
  } catch (err) {
    console.warn(`[warn] Failed to open cloudflared log: ${err.message}`);
    logFd = 'ignore';
  }

  cloudflaredProc = spawn(
    resolveCloudflaredBin(),
    ['tunnel', '--config', cloudflaredConfig, 'run'],
    { cwd: projectRoot, windowsHide: true, stdio: ['ignore', logFd, logFd] }
  );

  cloudflaredProc.on('error', (err) => {
    cloudflaredProc = null;
    console.warn(`[warn] Failed to start cloudflared: ${err.message}`);
    closeLog();
  });

  cloudflaredProc.on('exit', (code, signal) => {
    cloudflaredProc = null;
    closeLog();
    if (code && code !== 0) {
      console.warn(`[warn] cloudflared exited with code ${code}${signal ? ` (signal ${signal})` : ''}`);
    }
    if (!cloudflaredStopping) {
      cloudflaredRestartAttempts += 1;
      const delayMs = Math.min(60000, 5000 * cloudflaredRestartAttempts);
      console.warn(`[warn] Restarting cloudflared in ${Math.round(delayMs / 1000)}s...`);
      clearCloudflaredRestartTimer();
      cloudflaredRestartTimer = setTimeout(() => {
        startCloudflared();
      }, delayMs);
    }
  });

  cloudflaredStopping = false;
  cloudflaredRestartAttempts = 0;
  console.log(`[info] cloudflared logs -> ${path.relative(projectRoot, cloudflaredLog)}`);
}

function stopCloudflared() {
  cloudflaredStopping = true;
  clearCloudflaredRestartTimer();
  if (!cloudflaredProc || cloudflaredProc.killed) return;
  try {
    cloudflaredProc.kill();
  } catch {
    // Best-effort shutdown.
  }
}

startCloudflared();

const server = spawn(process.execPath, ['server.js'], { cwd: projectRoot, stdio: 'inherit' });
server.on('error', (err) => {
  console.error(`[error] Failed to start server: ${err.message}`);
  stopCloudflared();
  process.exit(1);
});

server.on('exit', (code) => {
  stopCloudflared();
  process.exit(code ?? 0);
});

process.on('SIGINT', () => {
  stopCloudflared();
  server.kill('SIGINT');
});

process.on('SIGTERM', () => {
  stopCloudflared();
  server.kill('SIGTERM');
});
