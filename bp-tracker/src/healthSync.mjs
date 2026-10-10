// Перевод записей дневника в формат Health Connect (Android).
// Значения перечислений совпадают с константами библиотеки react-native-health-connect (constants.ts).
// Записи пишутся с clientRecordId = id записи в дневнике, поэтому повтор не создаёт дубликат.
import { TYPES } from './measurements.mjs';

export const HC = Object.freeze({
  relationToMeal: { GENERAL: 1, FASTING: 2, BEFORE_MEAL: 3, AFTER_MEAL: 4, UNKNOWN: 0 },
  specimenWholeBlood: 6,
  bodyPositionUnknown: 0,
  measurementLocationUnknown: 0,
});

const CONTEXT_TO_RELATION = {
  fasting: HC.relationToMeal.FASTING,
  beforeMeal: HC.relationToMeal.BEFORE_MEAL,
  afterMeal: HC.relationToMeal.AFTER_MEAL,
  bedtime: HC.relationToMeal.GENERAL,
  other: HC.relationToMeal.UNKNOWN,
};

// Время в ISO 8601. Для Health Connect нужен момент, а не локальная дата.
function metadataFor(record) {
  return { clientRecordId: record.id, clientRecordVersion: 1 };
}

// Возвращает объект записи для insertRecords или null, если тип не поддерживается.
export function toHealthRecord(record) {
  const time = new Date(record.takenAt).toISOString();
  const metadata = metadataFor(record);

  if (record.type === TYPES.bp) {
    return {
      recordType: 'BloodPressure',
      time,
      systolic: { value: record.values.systolic, unit: 'millimetersOfMercury' },
      diastolic: { value: record.values.diastolic, unit: 'millimetersOfMercury' },
      bodyPosition: HC.bodyPositionUnknown,
      measurementLocation: HC.measurementLocationUnknown,
      metadata,
    };
  }

  if (record.type === TYPES.glucose) {
    return {
      recordType: 'BloodGlucose',
      time,
      level: { value: record.values.value, unit: 'millimolesPerLiter' },
      specimenSource: HC.specimenWholeBlood,
      mealType: 0,
      relationToMeal: CONTEXT_TO_RELATION[record.values.context] ?? HC.relationToMeal.UNKNOWN,
      metadata,
    };
  }

  if (record.type === TYPES.weight) {
    return {
      recordType: 'Weight',
      time,
      weight: { value: record.values.value, unit: 'kilograms' },
      metadata,
    };
  }

  return null;
}

// Какие разрешения просим: только запись. Чтение появится отдельным шагом.
export const WRITE_PERMISSIONS = Object.freeze([
  { accessType: 'write', recordType: 'BloodPressure' },
  { accessType: 'write', recordType: 'BloodGlucose' },
  { accessType: 'write', recordType: 'Weight' },
]);

// Какие записи ещё не отправлены. Отправленные помечаем в списке id.
export function pendingRecords(records, syncedIds) {
  const done = new Set(syncedIds);
  return records.filter((r) => !done.has(r.id) && toHealthRecord(r) !== null);
}
