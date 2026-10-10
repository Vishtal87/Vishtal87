// Восстановление из резервной копии с защитой данных.
// Порядок: 1) проверка файла, 2) снимок текущих данных, 3) запись новых значений.
// Если снимок не сохранён — ничего не меняем. Если запись прервалась — возвращаем старые значения.
import { buildBackup, parseBackup } from './backup.mjs';

export const STORAGE = Object.freeze({
  records: 'health-records-v2',
  meds: 'meds-v1',
  intake: 'intake-v1',
  units: 'health-units-v1',
  undo: 'restore-undo-v1',
});

// storage — объект с методами getItem, setItem, removeItem (подходит AsyncStorage).
async function writeAll(storage, values) {
  const previous = {};
  for (const key of Object.keys(values)) previous[key] = await storage.getItem(key);
  try {
    for (const [key, value] of Object.entries(values)) await storage.setItem(key, value);
  } catch (e) {
    await restoreRaw(storage, previous);
    throw e;
  }
}

async function restoreRaw(storage, previous) {
  for (const [key, value] of Object.entries(previous)) {
    try {
      if (value === null) await storage.removeItem(key);
      else await storage.setItem(key, value);
    } catch (e) {
      // Откат — лучшая попытка. Если и он не удался, ошибка уже будет показана пользователю.
    }
  }
}

function valuesFrom(data, current) {
  return {
    [STORAGE.records]: JSON.stringify(data.records),
    [STORAGE.meds]: JSON.stringify(data.meds),
    [STORAGE.intake]: JSON.stringify(data.intake),
    [STORAGE.units]: JSON.stringify({ ...current.units, ...data.units }),
  };
}

// Возвращает { ok, error, data }. При ok=false данные не изменены.
export async function restoreFromBackup(storage, text, current, now = Date.now()) {
  const parsed = parseBackup(text, now);
  if (parsed.error) return { ok: false, error: parsed.error, data: null };

  const snapshot = buildBackup(current, now);
  try {
    await storage.setItem(STORAGE.undo, snapshot);
  } catch (e) {
    return { ok: false, error: 'err_restore_snapshot', data: null };
  }

  try {
    await writeAll(storage, valuesFrom(parsed.data, current));
  } catch (e) {
    return { ok: false, error: 'err_restore_write', data: null };
  }
  return { ok: true, error: null, data: { ...parsed.data, units: { ...current.units, ...parsed.data.units } } };
}

// Возвращает данные из последнего снимка до восстановления.
export async function undoRestore(storage, now = Date.now()) {
  const text = await storage.getItem(STORAGE.undo);
  if (!text) return { ok: false, error: 'err_restore_none', data: null };
  const parsed = parseBackup(text, now);
  if (parsed.error) return { ok: false, error: parsed.error, data: null };
  try {
    await writeAll(storage, valuesFrom(parsed.data, { units: {} }));
  } catch (e) {
    return { ok: false, error: 'err_restore_write', data: null };
  }
  return { ok: true, error: null, data: parsed.data };
}
