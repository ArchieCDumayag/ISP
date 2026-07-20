const { readJson, writeJson } = require('../data-store');
const { resetPool } = require('../db');

const BILLING_CLOCK_GUARD_KEY = 'billing-clock-guard';
const ONE_HOUR_MS = 60 * 60 * 1000;
const MANILA_OFFSET_MS = 8 * ONE_HOUR_MS;

function pad(value) {
  return String(value).padStart(2, '0');
}

function getManilaToday() {
  const manilaNow = new Date(Date.now() + MANILA_OFFSET_MS);
  return `${manilaNow.getUTCFullYear()}-${pad(manilaNow.getUTCMonth() + 1)}-${pad(manilaNow.getUTCDate())}`;
}

function parseArgs(argv) {
  const result = {};
  argv.forEach((arg) => {
    if (typeof arg !== 'string' || !arg.startsWith('--')) return;
    const [key, ...rest] = arg.slice(2).split('=');
    result[key] = rest.join('=');
  });
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const clear = String(args.clear || '').trim().toLowerCase() === 'true';
  if (clear) {
    await writeJson(BILLING_CLOCK_GUARD_KEY, {});
    console.log(JSON.stringify({ ok: true, cleared: true }, null, 2));
    return;
  }

  const existing = await readJson(BILLING_CLOCK_GUARD_KEY, {});
  const safeDate = String(args.date || '').trim() || getManilaToday();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(safeDate)) {
    throw new Error(`Invalid --date value: ${safeDate || '(empty)'}`);
  }

  const nowIso = new Date().toISOString();
  const nextState = {
    ...(existing && typeof existing === 'object' ? existing : {}),
    lastSeenDate: safeDate,
    lastSeenAt: nowIso,
    lastSeenSource: 'reset-script',
    lastSafeDate: safeDate,
    lastSafeAt: nowIso,
    lastSafeSource: 'reset-script',
    blocked: false,
    blockedAt: null,
    blockedSource: null,
    blockedObservedDate: null,
    blockedLastSafeDate: null,
    blockedDiffDays: null,
    reason: null
  };
  await writeJson(BILLING_CLOCK_GUARD_KEY, nextState);
  console.log(JSON.stringify({ ok: true, state: nextState }, null, 2));
}

main()
  .catch((error) => {
    console.error(error.stack || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await resetPool().catch(() => {});
  });
