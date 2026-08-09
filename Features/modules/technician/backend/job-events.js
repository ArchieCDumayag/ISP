const { readJson, writeJson } = require('../../../../core/data/data-store');
const { query } = require('../../../../core/data/db');
const { isRelationalReady } = require('../../../../core/data/db-relational');
const { buildJobEvent, parseJsonValue, toSafeText, toIsoDateTime } = require('./dispatch-workflow');

const STORE_KEY = 'technician_job_events';

const mapJobEvent = (row = {}) => ({
  id: toSafeText(row.id, 100),
  branchId: Number(row.branch_id ?? row.branchId) || null,
  jobId: Number(row.job_id ?? row.jobId) || null,
  jobNumber: toSafeText(row.job_number ?? row.jobNumber, 50),
  eventType: toSafeText(row.event_type ?? row.eventType, 40),
  fromStatus: toSafeText(row.from_status ?? row.fromStatus, 30),
  toStatus: toSafeText(row.to_status ?? row.toStatus, 30),
  actorType: toSafeText(row.actor_type ?? row.actorType, 30),
  actorId: toSafeText(row.actor_id ?? row.actorId, 80),
  actorName: toSafeText(row.actor_name ?? row.actorName, 160),
  clientEventId: toSafeText(row.client_event_id ?? row.clientEventId, 100),
  payload: parseJsonValue(row.payload_json ?? row.payload, {}),
  eventAt: toIsoDateTime(row.event_at ?? row.eventAt)
});

const readJsonEvents = async () => {
  const stored = await readJson(STORE_KEY, []);
  return Array.isArray(stored) ? stored.map(mapJobEvent) : [];
};

const findExistingEvent = async (branchId, clientEventId) => {
  const normalizedClientId = toSafeText(clientEventId, 100);
  if (!normalizedClientId) return null;

  if (await isRelationalReady()) {
    const [rows] = await query(
      `SELECT id, branch_id, job_id, job_number, event_type, from_status, to_status,
              actor_type, actor_id, actor_name, client_event_id, payload_json, event_at
       FROM technician_job_events
       WHERE branch_id = ? AND client_event_id = ?
       LIMIT 1`,
      [branchId, normalizedClientId]
    );
    return rows?.length ? mapJobEvent(rows[0]) : null;
  }

  const events = await readJsonEvents();
  return events.find((event) =>
    Number(event.branchId) === Number(branchId) && event.clientEventId === normalizedClientId
  ) || null;
};

const appendJobEvent = async (input = {}) => {
  const event = input.id ? mapJobEvent(input) : buildJobEvent(input);
  if (!event.branchId || !event.jobId) {
    throw new Error('Branch and job are required for a job event.');
  }

  const existing = await findExistingEvent(event.branchId, event.clientEventId);
  if (existing) return { event: existing, duplicate: true };

  if (await isRelationalReady()) {
    try {
      await query(
        `INSERT INTO technician_job_events (
          id, branch_id, job_id, job_number, event_type, from_status, to_status,
          actor_type, actor_id, actor_name, client_event_id, payload_json, event_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          event.id,
          event.branchId,
          event.jobId,
          event.jobNumber || null,
          event.eventType || null,
          event.fromStatus || null,
          event.toStatus || null,
          event.actorType || null,
          event.actorId || null,
          event.actorName || null,
          event.clientEventId || null,
          JSON.stringify(event.payload || {}),
          event.eventAt.slice(0, 19).replace('T', ' ')
        ]
      );
      return { event, duplicate: false };
    } catch (error) {
      if (Number(error?.errno || 0) === 1062 && event.clientEventId) {
        const duplicate = await findExistingEvent(event.branchId, event.clientEventId);
        if (duplicate) return { event: duplicate, duplicate: true };
      }
      throw error;
    }
  }

  const events = await readJsonEvents();
  events.push(event);
  events.sort((left, right) => new Date(left.eventAt || 0) - new Date(right.eventAt || 0));
  await writeJson(STORE_KEY, events);
  return { event, duplicate: false };
};

const readJobEvents = async (branchId, jobId) => {
  if (!branchId || !jobId) return [];
  if (await isRelationalReady()) {
    const [rows] = await query(
      `SELECT id, branch_id, job_id, job_number, event_type, from_status, to_status,
              actor_type, actor_id, actor_name, client_event_id, payload_json, event_at
       FROM technician_job_events
       WHERE branch_id = ? AND job_id = ?
       ORDER BY event_at ASC, id ASC`,
      [branchId, jobId]
    );
    return Array.isArray(rows) ? rows.map(mapJobEvent) : [];
  }

  const events = await readJsonEvents();
  return events.filter((event) =>
    Number(event.branchId) === Number(branchId) && Number(event.jobId) === Number(jobId)
  );
};

module.exports = {
  STORE_KEY,
  mapJobEvent,
  findExistingEvent,
  appendJobEvent,
  readJobEvents
};
