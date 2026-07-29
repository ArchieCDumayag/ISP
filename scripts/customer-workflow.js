const fs = require('fs');
const path = require('path');
const { resolveProjectPath } = require('../core/runtime/paths');

const CONFIG_PATH = resolveProjectPath('login.json');
const BASE_URL = process.env.CENTRAL_URL || 'http://localhost:3000';

const fetchFn = typeof fetch === 'function' ? fetch : require('undici').fetch;

const loadLoginConfig = () => {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
};

const loginConfig = loadLoginConfig();
const username =
  process.env.CUSTOMER_USERNAME ??
  process.env.TEST_CUSTOMER_USERNAME ??
  loginConfig.username ??
  'Sample Customer';
const password =
  process.env.CUSTOMER_PASSWORD ??
  process.env.TEST_CUSTOMER_PASSWORD ??
  loginConfig.password ??
  '1234567890';

const printJson = (label, obj) => {
  console.log(`${label}:`);
  console.log(JSON.stringify(obj, null, 2));
};

const loginCustomer = async () => {
  const url = `${BASE_URL}/api/customers/login`;
  const response = await fetchFn(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Customer login failed (${response.status}): ${body}`);
  }
  const payload = await response.json();
  const rawCookie = response.headers.get('set-cookie') || '';
  const sessionCookie = rawCookie.split(';')[0];
  if (!sessionCookie) {
    throw new Error('Login response did not include a session cookie.');
  }
  return { payload, sessionCookie };
};

const downloadStatement = async (sessionCookie, accountNumber) => {
  const url = `${BASE_URL}/api/statements/account/${encodeURIComponent(accountNumber)}/pdf`;
  const response = await fetchFn(url, {
    headers: {
      Cookie: sessionCookie,
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`PDF download failed (${response.status}): ${body}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const outputPath = path.join(process.cwd(), `account-${accountNumber}.pdf`);
  fs.writeFileSync(outputPath, buffer);
  return outputPath;
};

const main = async () => {
  console.log(`Logging in ${username} against ${BASE_URL}/api/customers/login`);
  const { payload, sessionCookie } = await loginCustomer();
  printJson('Customer payload', payload);
  const accountNumber = String(payload.customer?.accountNumber || payload.accountNumber || '').trim();
  if (!accountNumber) {
    throw new Error('Account number is missing; cannot download statement.');
  }
  console.log(`Downloading PDF for account ${accountNumber}...`);
  const savedPath = await downloadStatement(sessionCookie, accountNumber);
  console.log(`PDF saved to ${savedPath}`);
};

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
