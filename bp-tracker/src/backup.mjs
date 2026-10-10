// Резервная копия: все данные в одном JSON.
// Импорт проверяет каждую запись по тем же правилам, что и ввод. Неподходящий файл не меняет данные:
// результат либо полностью принят, либо отклонён с ключом ошибки.
import { TYPES, GLUCOSE_CONTEXTS, validateMeasurement } from './measurements.mjs';
import { validateMed } from './meds.mjs';
import { INTAKE_STATUS } from './intake.mjs';

export const BACKUP_VERSION = 1;
export const BACKUP_MAX_CHARS = 5 * 1024 * 1024;
export const BACKUP_MAX_ITEMS = 100000;

const DAY = 24 * 60 * 60 * 1000;
const MIN_TAKEN_AT = Date.parse('1900-01-01T00:00:00Z');
const ID_MAX = 100;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const UNITS = { glucose: ['mmol', 'mgdl'], weight: ['kg', 'lb'] };
const SOURCES = ['health', 'device'];

export function buildBackup({ records, meds, intake, units }, now = Date.now()) {
  return JSON.stringify({ app: 'health-diary', version: BACKUP_VERSION, createdAt: new Date(now).toISOString(), records, meds, intake, units }, null, 2);
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const fail = (error) => ({ error, data: null, counts: null });

// Возвращает { error, data, counts }. error — ключ перевода или null.
// data — очищенные данные: в них попадают только известные поля, лишнее отбрасывается.
export function parseBackup(text, now = Date.now()) {
  if (typeof text !== 'string' || text.length === 0) return fail('err_backup_format');
  if (text.length > BACKUP_MAX_CHARS) return fail('err_backup_size');

  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    return fail('err_backup_format');
  }
  if (!isObject(obj) || obj.app !== 'health-diary') return fail('err_backup_format');
  if (!Number.isInteger(obj.version) || obj.version < 1) return fail('err_backup_format');
  if (obj.version > BACKUP_VERSION) return fail('err_backup_version');
  if (!Array.isArray(obj.records) || !Array.isArray(obj.meds) || !Array.isArray(obj.intake)) return fail('err_backup_format');
  if (obj.records.length > BACKUP_MAX_ITEMS || obj.meds.length > BACKUP_MAX_ITEMS || obj.intake.length > BACKUP_MAX_ITEMS) return fail('err_backup_size');

  const units = cleanUnits(obj.units);
  if (units === null) return fail('err_backup_invalid');

  const records = cleanAll(obj.records, (r) => cleanRecord(r, now));
  const meds = cleanAll(obj.meds, cleanMed);
  const intake = cleanAll(obj.intake, cleanIntake);
  if (!records || !meds || !intake) return fail('err_backup_invalid');

  return { error: null, data: { records, meds, intake, units }, counts: { records: records.length, meds: meds.length, intake: intake.length } };
}

// Все элементы должны пройти проверку, id не должны повторяться.
function cleanAll(list, clean) {
  const out = [];
  const ids = new Set();
  for (const item of list) {
    const c = clean(item);
    if (!c || ids.has(c.id)) return null;
    ids.add(c.id);
    out.push(c);
  }
  return out;
}

function cleanUnits(units) {
  if (units === undefined || units === null) return {};
  if (!isObject(units)) return null;
  const out = {};
  for (const [key, allowed] of Object.entries(UNITS)) {
    if (units[key] === undefined) continue;
    if (!allowed.includes(units[key])) return null;
    out[key] = units[key];
  }
  return out;
}

function cleanId(v) {
  return typeof v === 'string' && v.length > 0 && v.length <= ID_MAX ? v : null;
}

function cleanRecord(r, now) {
  if (!isObject(r) || !isObject(r.values)) return null;
  const id = cleanId(r.id);
  if (!id) return null;
  if (typeof r.takenAt !== 'number' || !Number.isInteger(r.takenAt) || r.takenAt < MIN_TAKEN_AT || r.takenAt > now + DAY) return null;
  const v = r.values;
  let checked;
  if (r.type === TYPES.bp) {
    if (typeof v.systolic !== 'number' || typeof v.diastolic !== 'number') return null;
    if (v.pulse !== null && v.pulse !== undefined && typeof v.pulse !== 'number') return null;
    checked = validateMeasurement(TYPES.bp, { systolic: v.systolic, diastolic: v.diastolic, pulse: v.pulse ?? null }, {});
  } else if (r.type === TYPES.glucose) {
    if (typeof v.value !== 'number' || !GLUCOSE_CONTEXTS.includes(v.context)) return null;
    // В копии сахар всегда хранится в ммоль/л, поэтому единицы здесь mmol.
    checked = validateMeasurement(TYPES.glucose, { value: v.value, context: v.context }, { glucose: 'mmol' });
  } else if (r.type === TYPES.weight) {
    if (typeof v.value !== 'number') return null;
    checked = validateMeasurement(TYPES.weight, { value: v.value }, { weight: 'kg' });
  } else {
    return null;
  }
  if (checked.error) return null;

  const out = { id, type: r.type, takenAt: r.takenAt, values: checked.values };
  if (r.version !== undefined) {
    if (!Number.isInteger(r.version) || r.version < 1) return null;
    out.version = r.version;
  }
  if (r.source !== undefined) {
    if (!SOURCES.includes(r.source)) return null;
    out.source = r.source;
  }
  return out;
}

function cleanMed(m) {
  if (!isObject(m)) return null;
  const id = cleanId(m.id);
  if (!id || typeof m.name !== 'string' || !Array.isArray(m.times) || !m.times.every((t) => typeof t === 'string')) return null;
  const checked = validateMed({ name: m.name, times: m.times.join(', ') });
  if (checked.error) return null;
  return { id, name: checked.name, times: checked.times };
}

function cleanIntake(i) {
  if (!isObject(i)) return null;
  const id = cleanId(i.id);
  const medId = cleanId(i.medId);
  if (!id || !medId) return null;
  if (typeof i.date !== 'string' || !DATE_RE.test(i.date) || Number.isNaN(Date.parse(`${i.date}T00:00:00Z`))) return null;
  if (typeof i.time !== 'string' || !TIME_RE.test(i.time)) return null;
  if (i.status !== INTAKE_STATUS.TAKEN && i.status !== INTAKE_STATUS.MISSED) return null;
  return { id, medId, date: i.date, time: i.time, status: i.status };
}
