// Восстановление из резервной копии с защитой данных.
// Порядок: 1) проверка файла, 2) снимок текущих данных, 3) запись новых значений.
// Если запись прервалась, прежние значения возвращаются и проверяются чтением.
// Прежние данные считаются восстановленными только если чтение подтвердило каждое значение.
import { buildBackup, parseBackup } from './backup.mjs';

export const STORAGE = Object.freeze({
  records: 'health-records-v2',
  meds: 'meds-v1',
  intake: 'intake-v1',
  units: 'health-units-v1',
  undo: 'restore-undo-v1',
});

// Ошибки, которые видит пользователь. err_restore_write — только когда откат подтверждён.
const ERR = Object.freeze({
  snapshot: 'err_restore_snapshot',
  write: 'err_restore_write',
  rollback: 'err_restore_rollback_failed',
  none: 'err_restore_none',
});

const describe = (cause) => (cause && cause.message) || String(cause);

// Значения всех ключей до записи. Ошибка чтения здесь означает: писать ничего нельзя.
async function readAll(storage, keys) {
  const out = {};
  for (const key of keys) out[key] = await storage.getItem(key);
  return out;
}

// Запись по очереди. При первой ошибке останавливаемся: часть значений уже записана.
async function writeAll(storage, values) {
  for (const [key, value] of Object.entries(values)) {
    try {
      await storage.setItem(key, value);
    } catch (cause) {
      return { ok: false, failedKey: key, cause: describe(cause) };
    }
  }
  return { ok: true };
}

// Возвращает прежние значения и проверяет каждое чтением. Ошибки не скрываются: они попадают в details.
async function rollback(storage, previous) {
  const details = [];
  for (const [key, value] of Object.entries(previous)) {
    try {
      if (value === null) await storage.removeItem(key);
      else await storage.setItem(key, value);
    } catch (cause) {
      details.push({ key, stage: 'rollback-write', cause: describe(cause) });
    }
  }
  const unverifiedKeys = [];
  for (const [key, value] of Object.entries(previous)) {
    try {
      const actual = await storage.getItem(key);
      if (actual !== value) {
        unverifiedKeys.push(key);
        details.push({ key, stage: 'verify', cause: 'значение не совпало с прежним' });
      }
    } catch (cause) {
      unverifiedKeys.push(key);
      details.push({ key, stage: 'verify', cause: describe(cause) });
    }
  }
  return { verified: unverifiedKeys.length === 0, unverifiedKeys, details };
}

// Запись набора ключей как одной операции. Возвращает либо { ok: true }, либо причину и результат отката.
async function transact(storage, values) {
  let previous;
  try {
    previous = await readAll(storage, Object.keys(values));
  } catch (cause) {
    return { ok: false, stage: 'read', cause: describe(cause), rollback: { verified: true, unverifiedKeys: [], details: [] } };
  }
  const written = await writeAll(storage, values);
  if (written.ok) return { ok: true };
  const back = await rollback(storage, previous);
  return { ok: false, stage: 'write', failedKey: written.failedKey, cause: written.cause, rollback: back };
}

function failure(error, outcome = null) {
  return {
    ok: false,
    error,
    data: null,
    failedKey: outcome?.failedKey ?? null,
    rollback: outcome?.rollback ?? null,
  };
}

function valuesFrom(data, current) {
  return {
    [STORAGE.records]: JSON.stringify(data.records),
    [STORAGE.meds]: JSON.stringify(data.meds),
    [STORAGE.intake]: JSON.stringify(data.intake),
    [STORAGE.units]: JSON.stringify({ ...current.units, ...data.units }),
  };
}

// Ошибка записи: если откат подтверждён — err_restore_write, иначе — err_restore_rollback_failed.
function writeError(outcome) {
  if (outcome.stage === 'read') return failure(ERR.snapshot, outcome);
  return failure(outcome.rollback.verified ? ERR.write : ERR.rollback, outcome);
}

// Возвращает { ok, error, data, failedKey, rollback }. При ok=false поле rollback говорит, что известно о хранилище.
export async function restoreFromBackup(storage, text, current, now = Date.now()) {
  const parsed = parseBackup(text, now);
  if (parsed.error) return failure(parsed.error);

  const snapshot = buildBackup(current, now);
  try {
    await storage.setItem(STORAGE.undo, snapshot);
  } catch (cause) {
    return failure(ERR.snapshot, { failedKey: STORAGE.undo, rollback: { verified: true, unverifiedKeys: [], details: [{ key: STORAGE.undo, stage: 'snapshot-write', cause: describe(cause) }] } });
  }

  const outcome = await transact(storage, valuesFrom(parsed.data, current));
  if (outcome.ok) {
    return { ok: true, error: null, data: { ...parsed.data, units: { ...current.units, ...parsed.data.units } }, failedKey: null, rollback: null };
  }
  return writeError(outcome);
}

// Возвращает данные из последнего снимка до восстановления. Запись тоже атомарна.
export async function undoRestore(storage, now = Date.now()) {
  let text;
  try {
    text = await storage.getItem(STORAGE.undo);
  } catch (cause) {
    return failure(ERR.snapshot);
  }
  if (!text) return failure(ERR.none);
  const parsed = parseBackup(text, now);
  if (parsed.error) return failure(parsed.error);

  const outcome = await transact(storage, valuesFrom(parsed.data, { units: {} }));
  if (outcome.ok) return { ok: true, error: null, data: parsed.data, failedKey: null, rollback: null };
  return writeError(outcome);
}
