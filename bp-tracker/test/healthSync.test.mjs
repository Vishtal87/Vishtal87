import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toHealthRecord, pendingRecords, WRITE_PERMISSIONS, HC } from '../src/healthSync.mjs';
import { makeRecord, TYPES } from '../src/measurements.mjs';

const T = Date.parse('2026-10-10T08:30:00Z');

test('давление: систолическое, диастолическое, миллиметры ртутного столба и clientRecordId', () => {
  const r = makeRecord(TYPES.bp, { systolic: 120, diastolic: 80, pulse: 70 }, T);
  const hc = toHealthRecord(r);
  assert.equal(hc.recordType, 'BloodPressure');
  assert.equal(hc.time, '2026-10-10T08:30:00.000Z');
  assert.deepEqual(hc.systolic, { value: 120, unit: 'millimetersOfMercury' });
  assert.deepEqual(hc.diastolic, { value: 80, unit: 'millimetersOfMercury' });
  assert.equal(hc.metadata.clientRecordId, r.id);
});

test('сахар: ммоль/л, цельная кровь, контекст переводится в relationToMeal', () => {
  const fasting = toHealthRecord(makeRecord(TYPES.glucose, { value: 5.6, context: 'fasting' }, T));
  assert.equal(fasting.recordType, 'BloodGlucose');
  assert.deepEqual(fasting.level, { value: 5.6, unit: 'millimolesPerLiter' });
  assert.equal(fasting.relationToMeal, HC.relationToMeal.FASTING);
  assert.equal(fasting.specimenSource, HC.specimenWholeBlood);
  const after = toHealthRecord(makeRecord(TYPES.glucose, { value: 7, context: 'afterMeal' }, T));
  assert.equal(after.relationToMeal, HC.relationToMeal.AFTER_MEAL);
  const bed = toHealthRecord(makeRecord(TYPES.glucose, { value: 6, context: 'bedtime' }, T));
  assert.equal(bed.relationToMeal, HC.relationToMeal.GENERAL);
});

test('вес: килограммы', () => {
  const hc = toHealthRecord(makeRecord(TYPES.weight, { value: 70.5 }, T));
  assert.equal(hc.recordType, 'Weight');
  assert.deepEqual(hc.weight, { value: 70.5, unit: 'kilograms' });
});

test('неизвестный тип не отправляется', () => {
  assert.equal(toHealthRecord({ id: 'x', type: 'other', takenAt: T, values: {} }), null);
});

test('отправляются только новые записи', () => {
  const a = makeRecord(TYPES.weight, { value: 70 }, T);
  const b = makeRecord(TYPES.weight, { value: 71 }, T + 1000);
  assert.deepEqual(pendingRecords([a, b], [a.id]).map((r) => r.id), [b.id]);
});

test('разрешения: только запись трёх типов', () => {
  assert.equal(WRITE_PERMISSIONS.length, 3);
  assert.ok(WRITE_PERMISSIONS.every((p) => p.accessType === 'write'));
});

import { fromHealthRecord, ALL_PERMISSIONS, READ_PERMISSIONS } from '../src/healthSync.mjs';

test('импорт: давление, сахар и вес из чужих записей Health Connect', () => {
  const bp = fromHealthRecord({
    recordType: 'BloodPressure',
    time: '2026-10-01T08:30:00.000Z',
    systolic: { inMillimetersOfMercury: 121.4 },
    diastolic: { inMillimetersOfMercury: 79 },
    metadata: { id: 'hc-1', dataOrigin: 'com.omron.connect' },
  }, { ownPackage: 'ru.test.app' });
  assert.deepEqual(bp, { sourceId: 'hc-1', type: 'bp', takenAt: Date.parse('2026-10-01T08:30:00.000Z'), input: { systolic: 121, diastolic: 79, pulse: '' } });

  const glucose = fromHealthRecord({
    recordType: 'BloodGlucose',
    time: '2026-10-01T07:00:00.000Z',
    level: { inMillimolesPerLiter: 5.6 },
    relationToMeal: 2,
    metadata: { id: 'hc-2', dataOrigin: 'com.other' },
  });
  assert.equal(glucose.input.context, 'fasting');
  assert.equal(glucose.input.value, 5.6);

  const weight = fromHealthRecord({ recordType: 'Weight', time: '2026-10-01T06:00:00.000Z', weight: { inKilograms: 81.2 }, metadata: { id: 'hc-3', dataOrigin: 'com.scale' } });
  assert.deepEqual(weight.input, { value: 81.2 });
});

test('импорт: свои записи и записи без id пропускаются', () => {
  const own = { recordType: 'Weight', time: '2026-10-01T06:00:00.000Z', weight: { inKilograms: 80 }, metadata: { id: 'x', dataOrigin: 'ru.test.app' } };
  assert.equal(fromHealthRecord(own, { ownPackage: 'ru.test.app' }), null);
  const withClientId = { ...own, metadata: { id: 'y', clientRecordId: 'diary-1', dataOrigin: 'other' } };
  assert.equal(fromHealthRecord(withClientId), null);
  assert.equal(fromHealthRecord({ ...own, metadata: {} }), null);
  assert.equal(fromHealthRecord({ ...own, recordType: 'Steps', metadata: { id: 'z' } }), null);
});

test('разрешения: запрос включает чтение и запись', () => {
  assert.equal(READ_PERMISSIONS.every((p) => p.accessType === 'read'), true);
  assert.equal(ALL_PERMISSIONS.length, 6);
});
