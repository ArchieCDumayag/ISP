const crypto = require('crypto');

const DISPATCH_SCHEMA_VERSION = 1;

const DISPATCH_STATUSES = Object.freeze([
  'unassigned',
  'assigned',
  'accepted',
  'traveling',
  'on_site',
  'completed',
  'failed',
  'rescheduled',
  'needs_team',
  'rejected',
  'cancelled'
]);

const PRIORITIES = Object.freeze(['low', 'normal', 'high', 'urgent', 'emergency']);

const TECHNICIAN_TRANSITIONS = Object.freeze({
  assigned: ['accepted', 'completed', 'rejected', 'rescheduled'],
  // `completed` remains available from assigned/accepted/traveling for compatibility
  // with the existing one-tap "Done" technician clients. The standalone
  // technician app can still guide users through the full field workflow.
  accepted: ['traveling', 'on_site', 'completed', 'rescheduled', 'needs_team', 'rejected'],
  traveling: ['on_site', 'completed', 'rescheduled', 'needs_team'],
  on_site: ['completed', 'failed', 'rescheduled', 'needs_team'],
  failed: ['rescheduled', 'needs_team'],
  rescheduled: ['accepted'],
  needs_team: ['accepted']
});

const toSafeText = (value, maxLength = 0) => {
  const text = String(value == null ? '' : value).trim();
  return maxLength > 0 ? text.slice(0, maxLength) : text;
};

const normalizeCode = (value) => toSafeText(value, 80)
  .toLowerCase()
  .replace(/[\s-]+/g, '_');

const hasAssignedTechnician = (value) => {
  const normalized = toSafeText(value, 120).toLowerCase();
  return Boolean(normalized) && !['unassigned', 'pending assignment'].includes(normalized);
};

const normalizeDispatchStatus = (value, { technician = '', fallback = 'unassigned' } = {}) => {
  const normalized = normalizeCode(value);
  if (DISPATCH_STATUSES.includes(normalized)) return normalized;
  if (['done', 'closed', 'resolved'].includes(normalized)) return 'completed';
  if (['in_progress', 'inprogress'].includes(normalized)) return 'accepted';
  if (normalized === 'scheduled') return hasAssignedTechnician(technician) ? 'assigned' : 'unassigned';
  return DISPATCH_STATUSES.includes(fallback) ? fallback : 'unassigned';
};

const isDispatchStatusValue = (value) => {
  const normalized = normalizeCode(value);
  return DISPATCH_STATUSES.includes(normalized)
    || ['done', 'closed', 'resolved', 'in_progress', 'inprogress', 'scheduled'].includes(normalized);
};

const toLegacyJobStatus = (workflowStatus) => {
  const normalized = normalizeDispatchStatus(workflowStatus);
  if (['completed', 'cancelled'].includes(normalized)) return 'done';
  if (['accepted', 'traveling', 'on_site'].includes(normalized)) return 'in-progress';
  return 'scheduled';
};

const normalizePriority = (value, fallback = 'normal') => {
  const normalized = normalizeCode(value);
  return PRIORITIES.includes(normalized) ? normalized : fallback;
};

const toIsoDateTime = (value) => {
  if (value == null || value === '') return '';
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) return '';
  return parsed.toISOString();
};

const toNullableNumber = (value, min, max) => {
  if (value == null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) return null;
  return number;
};

const parseCoordinatePair = (value) => {
  const raw = toSafeText(value, 120);
  if (!raw) return { latitude: null, longitude: null };
  const decoded = (() => {
    try {
      return decodeURIComponent(raw.replace(/\+/g, ' '));
    } catch (_error) {
      return raw;
    }
  })();
  const decimalMatch = decoded.match(/(?:@|[?&](?:q|query|ll)=)?(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)/i);
  if (decimalMatch) {
    const latitude = toNullableNumber(decimalMatch[1], -90, 90);
    const longitude = toNullableNumber(decimalMatch[2], -180, 180);
    if (latitude != null && longitude != null) return { latitude, longitude };
  }

  const plainParts = decoded.trim().split(/\s+/).filter(Boolean);
  if (plainParts.length === 2) {
    const latitude = toNullableNumber(plainParts[0], -90, 90);
    const longitude = toNullableNumber(plainParts[1], -180, 180);
    if (latitude != null && longitude != null) return { latitude, longitude };
  }

  const normalizedDms = decoded
    .replace(/[\u00BA\u02DA]/g, '\u00B0')
    .replace(/[\u2032\u2019]/g, "'")
    .replace(/[\u2033\u201C\u201D]/g, '"')
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const parseDmsSegment = (segment) => {
    const text = toSafeText(segment, 80).toUpperCase();
    const hemisphere = text.match(/[NSEW]/)?.[0] || '';
    const numericParts = text.replace(/[NSEW]/g, ' ').match(/-?\d+(?:\.\d+)?/g) || [];
    if (!hemisphere || !numericParts.length) return null;
    const degrees = Number(numericParts[0]);
    const minutes = Number(numericParts[1] || 0);
    const seconds = Number(numericParts[2] || 0);
    if (!Number.isFinite(degrees) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
    if (minutes < 0 || minutes >= 60 || seconds < 0 || seconds >= 60) return null;
    let decimal = Math.abs(degrees) + (minutes / 60) + (seconds / 3600);
    if (hemisphere === 'S' || hemisphere === 'W') decimal *= -1;
    return { value: decimal, hemisphere };
  };
  const segments = normalizedDms.match(/(?:[NSEW][^NSEW]+|[^NSEW]+[NSEW])/gi) || [];
  const parsedSegments = segments.map(parseDmsSegment).filter(Boolean);
  const latitudeEntry = parsedSegments.find((entry) => ['N', 'S'].includes(entry.hemisphere));
  const longitudeEntry = parsedSegments.find((entry) => ['E', 'W'].includes(entry.hemisphere));
  const latitude = toNullableNumber(latitudeEntry?.value, -90, 90);
  const longitude = toNullableNumber(longitudeEntry?.value, -180, 180);
  return { latitude, longitude };
};

const validateCoordinateInput = (input = {}) => {
  const hasCoordinateInput = ['mapPin', 'coordinates', 'latitude', 'longitude']
    .some((key) => Object.prototype.hasOwnProperty.call(input, key));
  if (!hasCoordinateInput) return '';

  const rawPair = toSafeText(input.mapPin ?? input.coordinates, 120);
  const hasLatitude = input.latitude !== undefined && input.latitude !== null && input.latitude !== '';
  const hasLongitude = input.longitude !== undefined && input.longitude !== null && input.longitude !== '';
  if (!rawPair && !hasLatitude && !hasLongitude) return '';

  const coordinates = rawPair
    ? parseCoordinatePair(rawPair)
    : {
        latitude: toNullableNumber(input.latitude, -90, 90),
        longitude: toNullableNumber(input.longitude, -180, 180)
      };
  if (coordinates.latitude == null || coordinates.longitude == null) {
    return 'Map Pin must contain a valid latitude and longitude, for example 14.5995, 120.9842.';
  }
  return '';
};

const parseJsonValue = (value, fallback) => {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch (_error) {
    return fallback;
  }
};

const normalizeStringList = (value, maxItems = 50, maxLength = 240) => {
  const list = Array.isArray(value)
    ? value
    : toSafeText(value).split(/\r?\n|,/);
  return list
    .map((item) => toSafeText(typeof item === 'object' ? item?.name || item?.label : item, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
};

const normalizeObjectList = (value, maxItems = 100) => {
  const list = parseJsonValue(value, []);
  if (!Array.isArray(list)) return [];
  return list.slice(0, maxItems).map((item) => {
    if (!item || typeof item !== 'object') {
      return { name: toSafeText(item, 160), quantity: 1 };
    }
    return {
      name: toSafeText(item.name || item.label || item.item, 160),
      quantity: Math.max(0, Number(item.quantity ?? item.qty ?? 1) || 0),
      unit: toSafeText(item.unit, 40),
      serialNumber: toSafeText(item.serialNumber || item.serial, 160)
    };
  }).filter((item) => item.name);
};

const normalizeDispatchPayload = (value = {}, current = {}) => {
  const input = parseJsonValue(value, {});
  const previous = parseJsonValue(current, {});
  const signal = input.signal && typeof input.signal === 'object' ? input.signal : previous.signal || {};
  const speedTest = input.speedTest && typeof input.speedTest === 'object'
    ? input.speedTest
    : previous.speedTest || {};
  return {
    diagnosis: toSafeText(input.diagnosis ?? previous.diagnosis, 4000),
    workPerformed: toSafeText(input.workPerformed ?? previous.workPerformed, 4000),
    instructions: toSafeText(input.instructions ?? previous.instructions, 4000),
    signal: {
      rxDbm: toNullableNumber(signal.rxDbm ?? signal.rx, -100, 100),
      txDbm: toNullableNumber(signal.txDbm ?? signal.tx, -100, 100)
    },
    speedTest: {
      downloadMbps: toNullableNumber(speedTest.downloadMbps ?? speedTest.download, 0, 100000),
      uploadMbps: toNullableNumber(speedTest.uploadMbps ?? speedTest.upload, 0, 100000),
      pingMs: toNullableNumber(speedTest.pingMs ?? speedTest.ping, 0, 100000)
    },
    equipment: normalizeObjectList(input.equipment ?? previous.equipment),
    materials: normalizeObjectList(input.materials ?? previous.materials),
    photos: normalizeStringList(input.photos ?? previous.photos, 30, 500),
    signature: input.signature && typeof input.signature === 'object'
      ? {
          name: toSafeText(input.signature.name, 200),
          fileUrl: toSafeText(input.signature.fileUrl || input.signature.url, 500),
          capturedAt: toIsoDateTime(input.signature.capturedAt)
        }
      : previous.signature || null,
    completionConfirmation: input.completionConfirmation && typeof input.completionConfirmation === 'object'
      ? {
          method: toSafeText(input.completionConfirmation.method, 40),
          confirmedAt: toIsoDateTime(input.completionConfirmation.confirmedAt),
          confirmedBy: toSafeText(input.completionConfirmation.confirmedBy, 200)
        }
      : previous.completionConfirmation || null,
    outcomeReason: toSafeText(input.outcomeReason ?? previous.outcomeReason, 2000),
    technicianNotes: toSafeText(input.technicianNotes ?? previous.technicianNotes, 4000)
  };
};

const normalizeDispatchFields = (input = {}, current = {}) => {
  const technician = toSafeText(input.technician ?? current.technician, 120);
  const currentCoordinates = {
    latitude: toNullableNumber(current.latitude, -90, 90),
    longitude: toNullableNumber(current.longitude, -180, 180)
  };
  const hasCoordinateInput = ['mapPin', 'coordinates', 'latitude', 'longitude']
    .some((key) => Object.prototype.hasOwnProperty.call(input, key));
  const parsedCoordinates = parseCoordinatePair(input.mapPin ?? input.coordinates);
  const latitude = hasCoordinateInput
    ? (toNullableNumber(input.latitude, -90, 90) ?? parsedCoordinates.latitude)
    : currentCoordinates.latitude;
  const longitude = hasCoordinateInput
    ? (toNullableNumber(input.longitude, -180, 180) ?? parsedCoordinates.longitude)
    : currentCoordinates.longitude;
  const appointmentStart = toIsoDateTime(
    input.appointmentStart ?? input.schedule ?? current.appointmentStart ?? current.schedule
  );
  const appointmentEnd = toIsoDateTime(input.appointmentEnd ?? current.appointmentEnd);
  const workflowStatus = normalizeDispatchStatus(
    input.workflowStatus ?? input.workflow_status ?? current.workflowStatus ?? current.status,
    { technician, fallback: hasAssignedTechnician(technician) ? 'assigned' : 'unassigned' }
  );

  return {
    schemaVersion: DISPATCH_SCHEMA_VERSION,
    customerAccountNumber: toSafeText(
      input.customerAccountNumber ?? input.accountNumber ?? current.customerAccountNumber,
      20
    ),
    customerName: toSafeText(input.customerName ?? current.customerName, 200),
    customerPhone: toSafeText(input.customerPhone ?? input.contact ?? current.customerPhone, 50),
    serviceAddress: toSafeText(input.serviceAddress ?? input.address ?? current.serviceAddress, 500),
    latitude,
    longitude,
    planName: toSafeText(input.planName ?? current.planName, 120),
    technician,
    priority: normalizePriority(input.priority ?? current.priority, current.priority || 'normal'),
    appointmentStart,
    appointmentEnd,
    slaDueAt: toIsoDateTime(input.slaDueAt ?? current.slaDueAt),
    workflowStatus,
    legacyStatus: toLegacyJobStatus(workflowStatus),
    dispatchPayload: normalizeDispatchPayload(
      input.dispatchPayload ?? input.details ?? input,
      current.dispatchPayload
    ),
    version: Math.max(1, Number(current.version || 0) || 1)
  };
};

const validateAppointmentWindow = (fields = {}) => {
  if (!fields.appointmentStart) return 'Appointment start is required.';
  const start = new Date(fields.appointmentStart);
  if (!Number.isFinite(start.getTime())) return 'Appointment start is invalid.';
  if (fields.appointmentEnd) {
    const end = new Date(fields.appointmentEnd);
    if (!Number.isFinite(end.getTime()) || end <= start) {
      return 'Appointment end must be later than the start.';
    }
  }
  return '';
};

const canTechnicianTransition = (fromStatus, toStatus) => {
  const from = normalizeDispatchStatus(fromStatus);
  const to = normalizeDispatchStatus(toStatus);
  return Array.isArray(TECHNICIAN_TRANSITIONS[from]) && TECHNICIAN_TRANSITIONS[from].includes(to);
};

const createMutationId = (prefix = 'job-event') => {
  if (typeof crypto.randomUUID === 'function') return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
};

const buildJobEvent = ({
  branchId,
  jobId,
  jobNumber,
  eventType,
  fromStatus,
  toStatus,
  actorType,
  actor,
  clientEventId,
  payload,
  eventAt = new Date().toISOString()
}) => ({
  id: createMutationId('job-event'),
  branchId: Number(branchId) || null,
  jobId: Number(jobId) || null,
  jobNumber: toSafeText(jobNumber, 50),
  eventType: normalizeCode(eventType || 'updated'),
  fromStatus: fromStatus ? normalizeDispatchStatus(fromStatus) : '',
  toStatus: toStatus ? normalizeDispatchStatus(toStatus) : '',
  actorType: normalizeCode(actorType || 'admin'),
  actorId: toSafeText(actor?.id ?? actor?.userId, 80),
  actorName: toSafeText(actor?.username || actor?.name || actor?.displayName, 160),
  clientEventId: toSafeText(clientEventId, 100),
  payload: payload && typeof payload === 'object' ? payload : {},
  eventAt: toIsoDateTime(eventAt) || new Date().toISOString()
});

module.exports = {
  DISPATCH_SCHEMA_VERSION,
  DISPATCH_STATUSES,
  PRIORITIES,
  TECHNICIAN_TRANSITIONS,
  toSafeText,
  normalizeDispatchStatus,
  isDispatchStatusValue,
  normalizePriority,
  toLegacyJobStatus,
  toIsoDateTime,
  parseCoordinatePair,
  validateCoordinateInput,
  parseJsonValue,
  normalizeDispatchPayload,
  normalizeDispatchFields,
  validateAppointmentWindow,
  hasAssignedTechnician,
  canTechnicianTransition,
  createMutationId,
  buildJobEvent
};
