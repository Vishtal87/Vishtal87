// Импорт из Health Connect: чистая логика без доступа к телефону, поэтому её можно проверить тестами.
// Правила:
// 1) запись Health Connect, которую уже обработали, пропускаем (по id);
// 2) измерение, совпадающее по типу, времени (±60 с) и значению с уже сохранённым, не добавляем дважды
//    (ручная запись или запись другого приложения);
// 3) запись, не прошедшая проверку, не запоминается: она будет проверена снова при следующем запуске.
import { validateMeasurement, makeRecord, TYPES } from './measurements.mjs';

const DAY = 24 * 60 * 60 * 1000;
export const MATCH_WINDOW_MS = 60 * 1000;
// Id, которые старше этого срока, не вернутся в окне импорта (окно не длиннее 90 дней).
export const SEEN_KEEP_MS = 100 * DAY;
const TOLERANCE = { [TYPES.glucose]: 0.05, [TYPES.weight]: 0.05 };
const UNITS = { glucose: 'mmol', weight: 'kg' };

function sameValues(type, a, b) {
  if (type === TYPES.bp) return a.systolic === b.systolic && a.diastolic === b.diastolic;
  return Math.abs(a.value - b.value) <= (TOLERANCE[type] ?? 0);
}

function alreadyStored(list, type, takenAt, values) {
  return list.some((r) => r.type === type && Math.abs(r.takenAt - takenAt) <= MATCH_WINDOW_MS && sameValues(type, r.values, values));
}

// Приводит сохранённый список id к виду [{ id, at }]. Старый формат — просто строки.
export function normalizeSeen(raw, now) {
  return (raw ?? []).map((x) => (typeof x === 'string' ? { id: x, at: now } : x)).filter((x) => x && typeof x.id === 'string');
}

// incoming: [{ sourceId, type, takenAt, input }]. records: уже сохранённые записи. seen: [{ id, at }].
// Возвращает { added, seen, counts }: новые записи, обновлённый список id и итоги для сообщения пользователю.
export function planImport({ incoming, records, seen, now = Date.now() }) {
  const known = new Set(seen.map((s) => s.id));
  const added = [];
  const newSeen = [];
  const counts = { added: 0, duplicate: 0, matched: 0, invalid: 0 };

  for (const item of incoming) {
    if (known.has(item.sourceId)) {
      counts.duplicate += 1;
      continue;
    }
    const check = validateMeasurement(item.type, item.input, UNITS);
    if (check.error) {
      counts.invalid += 1;
      continue; // id не запоминаем: запись проверим снова при следующем импорте
    }
    known.add(item.sourceId);
    newSeen.push({ id: item.sourceId, at: now });
    if (alreadyStored([...records, ...added], item.type, item.takenAt, check.values)) {
      counts.matched += 1;
      continue;
    }
    added.push({ ...makeRecord(item.type, check.values, item.takenAt), source: 'health' });
    counts.added += 1;
  }

  const kept = [...seen, ...newSeen].filter((s) => now - s.at <= SEEN_KEEP_MS);
  return { added, seen: kept, counts };
}
