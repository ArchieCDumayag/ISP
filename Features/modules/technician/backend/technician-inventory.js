const crypto = require('crypto');
const express = require('express');
const createError = require('http-errors');
const { readJson, writeJson } = require('../../../../core/data/data-store');
const { isJsonStorageMode } = require('../../../../core/config/storage-mode');
const { requireTechnicianAuth } = require('../../customer-management/backend/customer-draft-submissions');
const jobsRouter = require('./jobs');

const STORE_KEY = 'technician-inventory';
const STORE_SCHEMA_VERSION = 1;
const TRANSACTION_TYPES = new Set(['issue', 'use', 'return']);
const TECHNICIAN_TRANSACTION_TYPES = new Set(['use', 'return']);
const storeMutationTails = new Map();

const safeText = (value, maxLength = 0) => {
  const normalized = String(value ?? '').trim();
  return maxLength > 0 ? normalized.slice(0, maxLength) : normalized;
};

const normalizeKey = (value) => safeText(value).toLowerCase();

const assertTechnicianTransactionType = (value) => {
  const normalized = normalizeKey(value);
  if (!TECHNICIAN_TRANSACTION_TYPES.has(normalized)) {
    throw createError(403, 'Technicians may only record material use or returns. Stock issuance requires Admin or warehouse authorization.');
  }
  return normalized;
};

const positiveQuantity = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed * 1000) / 1000;
};

const normalizeBoolean = (value, fallback = false) => {
  if (value === true || value === false) return value;
  if (value === 1 || value === 0) return Boolean(value);
  const normalized = normalizeKey(value);
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
};

const normalizeSerialNumbers = (value) => {
  const source = Array.isArray(value)
    ? value
    : safeText(value)
        .split(/[\n,;]+/)
        .map((entry) => entry.trim())
        .filter(Boolean);
  const seen = new Set();
  const result = [];
  source.forEach((entry) => {
    const serialNumber = safeText(entry, 120);
    const key = normalizeKey(serialNumber);
    if (!key || seen.has(key)) return;
    seen.add(key);
    result.push(serialNumber);
  });
  return result;
};

const normalizeStore = (value) => {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    ...source,
    schemaVersion: STORE_SCHEMA_VERSION,
    branches: source.branches && typeof source.branches === 'object' && !Array.isArray(source.branches)
      ? source.branches
      : {}
  };
};

const normalizeBranchStore = (value) => {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    ...source,
    technicians: source.technicians && typeof source.technicians === 'object' && !Array.isArray(source.technicians)
      ? source.technicians
      : {},
    transactions: Array.isArray(source.transactions) ? source.transactions : []
  };
};

const normalizeTechnicianStore = (value) => {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    ...source,
    stock: source.stock && typeof source.stock === 'object' && !Array.isArray(source.stock)
      ? source.stock
      : {}
  };
};

const withStoreMutationLock = async (storeKey, task) => {
  const key = safeText(storeKey) || STORE_KEY;
  const previous = storeMutationTails.get(key) || Promise.resolve();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const tail = previous.catch(() => {}).then(() => gate);
  storeMutationTails.set(key, tail);
  await previous.catch(() => {});
  try {
    return await task();
  } finally {
    release();
    if (storeMutationTails.get(key) === tail) storeMutationTails.delete(key);
  }
};

const normalizeTechnician = (technician = {}) => {
  const branchId = Number(technician?.branchId);
  const technicianId = safeText(technician?.id, 64);
  if (!Number.isInteger(branchId) || branchId <= 0) {
    throw createError(400, 'Branch assignment is required for inventory access.');
  }
  if (!technicianId) throw createError(401, 'Technician identity is required.');
  return {
    branchId,
    technicianId,
    technicianUsername: safeText(technician?.username || technician?.name, 120)
  };
};

const normalizeTransactionInput = (type, payload = {}) => {
  const normalizedType = normalizeKey(type || payload?.type);
  if (!TRANSACTION_TYPES.has(normalizedType)) {
    throw createError(400, 'Inventory transaction type must be issue, use, or return.');
  }
  const clientEventId = safeText(payload?.clientEventId, 100);
  if (!clientEventId) throw createError(400, 'clientEventId is required.');
  const sku = safeText(
    payload?.sku || payload?.itemId || payload?.itemCode || payload?.materialCode,
    80
  ).toUpperCase();
  if (!sku) throw createError(400, 'Material SKU is required.');
  const quantity = positiveQuantity(payload?.quantity);
  if (!quantity) throw createError(400, 'Quantity must be greater than zero.');
  const serialNumbers = normalizeSerialNumbers(
    payload?.serialNumbers || payload?.serials || payload?.serialNumber
  );
  const serializedWasSpecified = Object.prototype.hasOwnProperty.call(payload, 'serialized');
  const serialized = serializedWasSpecified
    ? normalizeBoolean(payload.serialized, false)
    : serialNumbers.length > 0;
  const jobId = safeText(payload?.jobId, 64);
  if (normalizedType === 'use' && !jobId) {
    throw createError(400, 'jobId is required when materials are used.');
  }
  return {
    type: normalizedType,
    clientEventId,
    sku,
    quantity,
    itemName: safeText(payload?.itemName || payload?.name || sku, 160),
    unit: safeText(payload?.unit || 'piece', 30),
    serialized,
    serializedWasSpecified,
    serialNumbers,
    jobId,
    notes: safeText(payload?.notes, 500)
  };
};

const transactionFingerprint = (input) => JSON.stringify({
  type: input.type,
  sku: input.sku,
  quantity: input.quantity,
  itemName: input.itemName,
  unit: input.unit,
  serialized: input.serialized,
  serialNumbers: input.serialNumbers.map(normalizeKey).sort(),
  jobId: input.jobId,
  notes: input.notes
});

const publicStockItem = (item = {}) => ({
  sku: safeText(item.sku, 80),
  itemId: safeText(item.sku, 80),
  itemName: safeText(item.itemName, 160),
  unit: safeText(item.unit, 30),
  serialized: Boolean(item.serialized),
  onHand: Math.max(0, Number(item.onHand) || 0),
  serialNumbers: Boolean(item.serialized) && Array.isArray(item.serialNumbers)
    ? [...item.serialNumbers]
    : [],
  updatedAt: item.updatedAt || ''
});

const publicTransaction = (transaction = {}) => ({
  id: safeText(transaction.id, 64),
  clientEventId: safeText(transaction.clientEventId, 100),
  type: safeText(transaction.type, 20),
  sku: safeText(transaction.sku, 80),
  itemId: safeText(transaction.sku, 80),
  itemName: safeText(transaction.itemName, 160),
  unit: safeText(transaction.unit, 30),
  serialized: Boolean(transaction.serialized),
  quantity: Number(transaction.quantity) || 0,
  direction: safeText(transaction.direction, 10),
  balanceAfter: Math.max(0, Number(transaction.balanceAfter) || 0),
  serialNumbers: Array.isArray(transaction.serialNumbers) ? [...transaction.serialNumbers] : [],
  jobId: safeText(transaction.jobId, 64),
  jobNumber: safeText(transaction.jobNumber, 64),
  customerAccountNumber: safeText(transaction.customerAccountNumber, 40),
  notes: safeText(transaction.notes, 500),
  createdAt: transaction.createdAt || ''
});

const findBranchSerialOwner = (branch, serialNumber) => {
  const target = normalizeKey(serialNumber);
  for (const [technicianId, technicianValue] of Object.entries(branch.technicians || {})) {
    const technician = normalizeTechnicianStore(technicianValue);
    for (const item of Object.values(technician.stock)) {
      const match = (Array.isArray(item?.serialNumbers) ? item.serialNumbers : [])
        .find((entry) => normalizeKey(entry) === target);
      if (match) return { technicianId, sku: safeText(item?.sku, 80), serialNumber: match };
    }
  }
  return null;
};

const resolveJobSnapshot = async (jobsModule, technician, jobId) => {
  if (!jobId) return null;
  if (typeof jobsModule?.readJobsForTechnician !== 'function') {
    throw createError(500, 'Technician job lookup is unavailable.');
  }
  const jobs = await jobsModule.readJobsForTechnician(technician.branchId, technician, {
    includeClosed: true,
    includeUnassigned: false
  });
  const match = (Array.isArray(jobs) ? jobs : []).find((job) => {
    if (
      (isJsonStorageMode() || job?.branchId != null)
      && Number(job?.branchId) !== Number(technician.branchId)
    ) return false;
    return safeText(job?.id, 64) === safeText(jobId, 64);
  });
  if (!match) throw createError(404, 'Job was not found for this technician.');
  return {
    id: safeText(match.id, 64),
    jobNumber: safeText(match.jobNumber, 64),
    customerAccountNumber: safeText(
      match.customerAccountNumber || match?.dispatchPayload?.customerAccountNumber,
      40
    )
  };
};

const createInventoryService = ({
  readStore = () => readJson(STORE_KEY, { schemaVersion: STORE_SCHEMA_VERSION, branches: {} }),
  writeStore = (value) => writeJson(STORE_KEY, value),
  jobsModule = jobsRouter,
  now = () => new Date(),
  randomUUID = () => crypto.randomUUID(),
  mutationKey = STORE_KEY
} = {}) => {
  const listStock = async (technicianInput) => {
    const technician = normalizeTechnician(technicianInput);
    const store = normalizeStore(await readStore());
    const branch = normalizeBranchStore(store.branches[String(technician.branchId)]);
    const owner = normalizeTechnicianStore(branch.technicians[technician.technicianId]);
    return Object.values(owner.stock)
      .map(publicStockItem)
      .filter((item) => item.sku)
      .sort((left, right) => left.itemName.localeCompare(right.itemName) || left.sku.localeCompare(right.sku));
  };

  const listTransactions = async (technicianInput, filters = {}) => {
    const technician = normalizeTechnician(technicianInput);
    const store = normalizeStore(await readStore());
    const branch = normalizeBranchStore(store.branches[String(technician.branchId)]);
    const type = normalizeKey(filters.type);
    const jobId = safeText(filters.jobId, 64);
    const limit = Math.min(Math.max(Number.parseInt(filters.limit, 10) || 100, 1), 500);
    return branch.transactions
      .filter((entry) => safeText(entry?.technicianId, 64) === technician.technicianId)
      .filter((entry) => !type || normalizeKey(entry?.type) === type)
      .filter((entry) => !jobId || safeText(entry?.jobId, 64) === jobId)
      .sort((left, right) => new Date(right?.createdAt || 0).getTime() - new Date(left?.createdAt || 0).getTime())
      .slice(0, limit)
      .map(publicTransaction);
  };

  const transact = async (technicianInput, type, payload = {}) => {
    const technician = normalizeTechnician(technicianInput);
    const input = normalizeTransactionInput(type, payload);
    const fingerprint = transactionFingerprint(input);
    const initialStore = normalizeStore(await readStore());
    const initialBranch = normalizeBranchStore(initialStore.branches[String(technician.branchId)]);
    const initialEvent = initialBranch.transactions.find((entry) => (
      safeText(entry?.technicianId, 64) === technician.technicianId
      && safeText(entry?.clientEventId, 100) === input.clientEventId
    ));
    if (initialEvent) {
      if (safeText(initialEvent.fingerprint) !== fingerprint) {
        throw createError(409, 'clientEventId was already used for a different inventory transaction.');
      }
      const owner = normalizeTechnicianStore(initialBranch.technicians[technician.technicianId]);
      return {
        duplicate: true,
        transaction: publicTransaction(initialEvent),
        stock: publicStockItem(owner.stock[input.sku] || {})
      };
    }
    const job = await resolveJobSnapshot(jobsModule, technicianInput, input.jobId);

    return withStoreMutationLock(mutationKey, async () => {
      const store = normalizeStore(await readStore());
      const branchKey = String(technician.branchId);
      const branch = normalizeBranchStore(store.branches[branchKey]);
      store.branches[branchKey] = branch;
      const existingEvent = branch.transactions.find((entry) => (
        safeText(entry?.technicianId, 64) === technician.technicianId
        && safeText(entry?.clientEventId, 100) === input.clientEventId
      ));
      if (existingEvent) {
        if (safeText(existingEvent.fingerprint) !== fingerprint) {
          throw createError(409, 'clientEventId was already used for a different inventory transaction.');
        }
        const owner = normalizeTechnicianStore(branch.technicians[technician.technicianId]);
        return {
          duplicate: true,
          transaction: publicTransaction(existingEvent),
          stock: publicStockItem(owner.stock[input.sku] || {})
        };
      }

      const owner = normalizeTechnicianStore(branch.technicians[technician.technicianId]);
      branch.technicians[technician.technicianId] = owner;
      const current = owner.stock[input.sku] ? publicStockItem(owner.stock[input.sku]) : null;
      if (!current && input.type !== 'issue') {
        throw createError(409, `No ${input.sku} stock is available for this technician.`);
      }
      const serialized = current ? current.serialized : input.serialized;
      if (current && input.serializedWasSpecified && input.serialized !== current.serialized) {
        throw createError(409, `Serialized setting for ${input.sku} does not match existing stock.`);
      }
      if (serialized) {
        if (!Number.isInteger(input.quantity) || input.serialNumbers.length !== input.quantity) {
          throw createError(400, 'Serialized material requires one unique serial number per whole item.');
        }
      } else if (input.serialNumbers.length) {
        throw createError(400, 'Serial numbers are only allowed for serialized material.');
      }

      const direction = input.type === 'issue' ? 'in' : 'out';
      const delta = direction === 'in' ? input.quantity : -input.quantity;
      const currentOnHand = current?.onHand || 0;
      const nextOnHand = Math.round((currentOnHand + delta) * 1000) / 1000;
      if (nextOnHand < 0) {
        throw createError(409, `Insufficient ${input.sku} stock. Available: ${currentOnHand}.`);
      }

      let nextSerialNumbers = current?.serialNumbers ? [...current.serialNumbers] : [];
      if (serialized && direction === 'in') {
        input.serialNumbers.forEach((serialNumber) => {
          const ownerRecord = findBranchSerialOwner(branch, serialNumber);
          if (ownerRecord) {
            throw createError(409, `Serial number ${serialNumber} is already in branch stock.`);
          }
        });
        nextSerialNumbers.push(...input.serialNumbers);
      }
      if (serialized && direction === 'out') {
        const held = new Map(nextSerialNumbers.map((serialNumber) => [normalizeKey(serialNumber), serialNumber]));
        const missing = input.serialNumbers.find((serialNumber) => !held.has(normalizeKey(serialNumber)));
        if (missing) throw createError(409, `Serial number ${missing} is not in this technician's stock.`);
        const removed = new Set(input.serialNumbers.map(normalizeKey));
        nextSerialNumbers = nextSerialNumbers.filter((serialNumber) => !removed.has(normalizeKey(serialNumber)));
      }

      const timestamp = now().toISOString();
      const nextItem = {
        sku: input.sku,
        itemName: current?.itemName || input.itemName,
        unit: current?.unit || input.unit,
        serialized,
        onHand: nextOnHand,
        serialNumbers: serialized ? nextSerialNumbers : [],
        updatedAt: timestamp
      };
      owner.stock[input.sku] = nextItem;
      const transaction = {
        id: randomUUID(),
        branchId: technician.branchId,
        technicianId: technician.technicianId,
        technicianUsername: technician.technicianUsername,
        clientEventId: input.clientEventId,
        fingerprint,
        type: input.type,
        direction,
        sku: input.sku,
        itemName: nextItem.itemName,
        unit: nextItem.unit,
        serialized,
        quantity: input.quantity,
        balanceAfter: nextOnHand,
        serialNumbers: [...input.serialNumbers],
        jobId: job?.id || '',
        jobNumber: job?.jobNumber || '',
        customerAccountNumber: job?.customerAccountNumber || '',
        notes: input.notes,
        createdAt: timestamp
      };
      branch.transactions.push(transaction);
      branch.updatedAt = timestamp;
      await writeStore(store);
      return {
        duplicate: false,
        transaction: publicTransaction(transaction),
        stock: publicStockItem(nextItem)
      };
    });
  };

  return { listStock, listTransactions, transact };
};

const createInventoryRouter = ({ service = createInventoryService(), authMiddleware = requireTechnicianAuth } = {}) => {
  const router = express.Router();
  router.use((req, res, next) => (req.technician ? next() : authMiddleware(req, res, next)));

  const sendStock = async (req, res, next) => {
    try {
      const stock = await service.listStock(req.technician);
      return res.json({ ok: true, count: stock.length, stock });
    } catch (error) {
      return next(error);
    }
  };

  router.get('/', sendStock);
  router.get('/stock', sendStock);
  router.get('/transactions', async (req, res, next) => {
    try {
      const transactions = await service.listTransactions(req.technician, req.query || {});
      return res.json({ ok: true, count: transactions.length, transactions });
    } catch (error) {
      return next(error);
    }
  });

  const postTransaction = (type = '') => async (req, res, next) => {
    try {
      const resolvedType = assertTechnicianTransactionType(type || req.body?.type);
      const result = await service.transact(req.technician, resolvedType, req.body || {});
      return res.status(result.duplicate ? 200 : 201).json({ ok: true, ...result });
    } catch (error) {
      return next(error);
    }
  };

  router.post('/transactions', postTransaction());
  router.post('/use', postTransaction('use'));
  router.post('/return', postTransaction('return'));
  return router;
};

const router = createInventoryRouter();

module.exports = router;
module.exports.STORE_KEY = STORE_KEY;
module.exports.createInventoryService = createInventoryService;
module.exports.createInventoryRouter = createInventoryRouter;
module.exports.normalizeTransactionInput = normalizeTransactionInput;
module.exports.assertTechnicianTransactionType = assertTechnicianTransactionType;
module.exports.withStoreMutationLock = withStoreMutationLock;
