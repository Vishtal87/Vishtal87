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
