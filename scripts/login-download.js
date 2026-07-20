const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.CENTRAL_URL || 'http://localhost:3000';
const ACCOUNT_NUMBER = process.env.TEST_ACCOUNT_NUMBER || '10000004';
const CREDENTIALS = {
  username: process.env.TEST_CUSTOMER_USERNAME || 'Liza Soberano',
  password: process.env.TEST_CUSTOMER_PASSWORD || '10000004',
  app: 'customer',
};

const STATEMENT_PATH = path.join(__dirname, `../account-${ACCOUNT_NUMBER}.pdf`);

async function getLoginToken() {
  const url = `${BASE_URL}/api/auth/login`;
  const payload = JSON.stringify(CREDENTIALS);
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Login failed (${response.status}): ${body}`);
  }
  return response.json();
}

async function downloadPdf(token) {
  const url = `${BASE_URL}/api/statements/account/${encodeURIComponent(ACCOUNT_NUMBER)}/pdf`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`PDF download failed (${response.status}): ${body}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(STATEMENT_PATH, buffer);
  return STATEMENT_PATH;
}

async function main() {
  console.log(`Logging in ${CREDENTIALS.username} against ${BASE_URL}/api/auth/login`);
  const payload = await getLoginToken();
  if (!payload.token) {
    throw new Error('Login response did not include a token');
  }
  console.log('Login succeeded, token acquired (truncated):', payload.token.slice(0, 32));
  console.log('Downloading statement PDF...');
  const saved = await downloadPdf(payload.token);
  console.log(`Saved PDF to ${saved}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
