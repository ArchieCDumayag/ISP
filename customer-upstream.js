const express = require('express');
const crypto = require('crypto');
const { readJson } = require('./data-store');
const { verifyPassword } = require('./passwords');
const customersModule = require('./customers');

const PORT = Number(process.env.CUSTOMER_UPSTREAM_PORT || 4001);
const HOST = String(process.env.CUSTOMER_UPSTREAM_HOST || '127.0.0.1').trim() || '127.0.0.1';
const NODE_ENV = String(process.env.NODE_ENV || '').trim().toLowerCase();
const ENABLE_STUB = NODE_ENV === 'production'
  ? String(process.env.ENABLE_CUSTOMER_UPSTREAM_STUB || '').trim().toLowerCase() === 'true'
  : process.env.ENABLE_CUSTOMER_UPSTREAM_STUB !== 'false';
const STORE_KEY = 'customers';

async function loadCustomers() {
  if (typeof customersModule.readVisibleCustomers === 'function') {
    return customersModule.readVisibleCustomers();
  }
  if (typeof customersModule.readCustomers === 'function') {
    return customersModule.readCustomers();
  }
  const parsed = await readJson(STORE_KEY, []);
  return Array.isArray(parsed) ? parsed : [];
}

function findCustomer(rawValue, password, customers) {
  if (!rawValue || !password) return null;
  const normalized = rawValue.trim().toLowerCase();
  const pass = String(password);
  return customers.find((customer) => {
    const username = String(customer.loginUsername || customer.username || '').trim().toLowerCase();
    const email = String(customer.email || '').trim().toLowerCase();
    const account = String(customer.accountNumber || '').trim().toLowerCase();
    const matchesUsername = username && username === normalized;
    const matchesEmail = email && email === normalized;
    const matchesAccount = account && account === normalized;
    const storedPass = String(customer.loginPassword || customer.password || '');
    const matchesPassword = verifyPassword(pass.trim(), storedPass.trim());
    return matchesPassword && (matchesUsername || matchesEmail || matchesAccount);
  }) || null;
}

function buildResponsePayload(customer) {
  const { loginPassword, loginUsername, ...rest } = customer;
  return {
    ok: true,
    loginType: 'Customer',
    customer: {
      ...rest,
      name: customer.name || `${customer.firstName || ''} ${customer.lastName || ''}`.trim(),
    }
  };
}

async function startCustomerUpstream() {
  if (!ENABLE_STUB) return null;
  const app = express();
  app.use(express.json());

  app.post('/api/auth/login', async (req, res) => {
    const { username, email, user, password } = req.body || {};
    const raw = (username || email || user || '').trim();
    const customers = await loadCustomers();
    if (!raw || !String(password).trim()) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const match = findCustomer(raw, password, customers);
    if (!match) {
      console.warn('Customer upstream login failed for', raw);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const sessionId = crypto.randomBytes(16).toString('hex');
    res.setHeader('Set-Cookie', `sessionId=${sessionId}; HttpOnly; Path=/; SameSite=Lax`);
    return res.json(buildResponsePayload(match));
  });

  app.listen(PORT, HOST, () => {
    console.log(`Customer upstream stub listening on http://${HOST}:${PORT}`);
  });
  return app;
}

module.exports = { startCustomerUpstream };
