const { URL } = require('node:url');
const fs = require('fs');
const path = require('path');

const fetchFn = typeof fetch === 'function'
  ? fetch
  : require('undici').fetch;

const CONFIG_PATH = path.join(__dirname, '..', 'login.json');

const loadLoginConfig = () => {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
};

const loginConfig = loadLoginConfig();
const getDefault = (value, fallback) => {
  if (value === undefined || value === null) return fallback;
  return String(value).trim() || fallback;
};

const BASE_URL = process.env.CENTRAL_URL || 'http://localhost:3000';
const overrideUsername =
  process.env.CUSTOMER_USERNAME ??
  process.env.TEST_CUSTOMER_USERNAME ??
  loginConfig.username;
const overridePassword =
  process.env.CUSTOMER_PASSWORD ??
  process.env.TEST_CUSTOMER_PASSWORD ??
  loginConfig.password;
const CREDENTIALS = {
  username: overrideUsername || getDefault(loginConfig.username, 'Sample Customer'),
  password: overridePassword || getDefault(loginConfig.password, '1234567890'),
  app: getDefault(loginConfig.app, 'customer'),
};

async function postLoginPayload() {
  const loginUrl = new URL('/api/auth/login', BASE_URL);
  const response = await fetchFn(loginUrl.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(CREDENTIALS),
  });

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    throw new Error(`Login failed (${response.status}): ${bodyText}`);
  }

  return response.json();
}

async function main() {
  console.log(`Logging in ${CREDENTIALS.username} against ${BASE_URL}/api/auth/login`);
  const payload = await postLoginPayload();
  if (!payload.token) {
    throw new Error('Login response did not include a token');
  }

  console.log('Login succeeded, token (truncated):', payload.token.slice(0, 32));
  return payload.token;
}

main()
  .then(() => {})
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
