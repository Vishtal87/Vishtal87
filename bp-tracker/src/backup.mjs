// Резервная копия: все данные в одном JSON. Импорт проверяет структуру до записи.
export const BACKUP_VERSION = 1;

export function buildBackup({ records, meds, intake, units }, now = Date.now()) {
  return JSON.stringify({ app: 'health-diary', version: BACKUP_VERSION, createdAt: new Date(now).toISOString(), records, meds, intake, units }, null, 2);
}

// Возвращает { error, data }. error — ключ перевода или null.
export function parseBackup(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    return { error: 'err_backup_format', data: null };
  }
  if (!obj || obj.app !== 'health-diary' || typeof obj.version !== 'number') return { error: 'err_backup_format', data: null };
  if (obj.version > BACKUP_VERSION) return { error: 'err_backup_version', data: null };
  if (!Array.isArray(obj.records) || !Array.isArray(obj.meds) || !Array.isArray(obj.intake)) return { error: 'err_backup_format', data: null };
  return { error: null, data: { records: obj.records, meds: obj.meds, intake: obj.intake, units: obj.units ?? {} } };
}
