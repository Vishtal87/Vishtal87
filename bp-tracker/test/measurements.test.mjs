import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TYPES,
  validateMeasurement,
  makeRecord,
  migrateRecords,
  formatValue,
  unitLabel,
  toCsvRecords,
  toCanonical,
} from '../src/measurements.mjs';
import { validateMed, makeMed } from '../src/meds.mjs';
import { classify } from '../src/bp.mjs';
import { STRINGS } from '../src/i18n.mjs';

test('давление: проверка, как раньше', () => {
  assert.equal(validateMeasurement(TYPES.bp, { systolic: 120, diastolic: 80, pulse: '' }).error, null);
  assert.equal(validateMeasurement(TYPES.bp, { systolic: 50, diastolic: 80 }).error, 'err_systolic');
  assert.equal(validateMeasurement(TYPES.bp, { systolic: 80, diastolic: 90 }).error, 'err_order');
});

test('сахар: ммоль/л и мг/дл приводятся к ммоль/л', () => {
  const mmol = validateMeasurement(TYPES.glucose, { value: '5,6', context: 'fasting' }, { glucose: 'mmol' });
  assert.equal(mmol.error, null);
  assert.equal(mmol.values.value, 5.6);
  const mg = validateMeasurement(TYPES.glucose, { value: '100', context: 'fasting' }, { glucose: 'mgdl' });
  assert.equal(mg.error, null);
  assert.equal(mg.values.value, 5.6);
});

test('сахар: неизвестный контекст становится other, пустое значение — ошибка', () => {
  assert.equal(validateMeasurement(TYPES.glucose, { value: '6', context: 'weird' }).values.context, 'other');
  assert.equal(validateMeasurement(TYPES.glucose, { value: '' }).error, 'err_glucose');
  assert.equal(validateMeasurement(TYPES.glucose, { value: '60' }, { glucose: 'mmol' }).error, 'err_glucose');
});

test('вес: фунты переводятся в килограммы', () => {
  assert.equal(toCanonical(TYPES.weight, 220.462, 'lb').toFixed(1), '100.0');
  const r = validateMeasurement(TYPES.weight, { value: '70' }, { weight: 'kg' });
  assert.equal(r.values.value, 70);
  assert.equal(validateMeasurement(TYPES.weight, { value: '10' }).error, 'err_weight');
});

test('отображение единиц', () => {
  const g = makeRecord(TYPES.glucose, { value: 5.6, context: 'fasting' }, 1);
  assert.equal(formatValue(g, { glucose: 'mmol' }), '5.6');
  assert.equal(formatValue(g, { glucose: 'mgdl' }), '101');
  assert.equal(unitLabel(TYPES.glucose, { glucose: 'mgdl' }), 'мг/дл');
  const w = makeRecord(TYPES.weight, { value: 70 }, 1);
  assert.equal(formatValue(w, { weight: 'lb' }), '154.3');
});

test('миграция: старые записи давления получают тип bp и сохраняют значения', () => {
  const old = [{ id: 'a', takenAt: 5, systolic: 120, diastolic: 80, pulse: 70 }];
  const [r] = migrateRecords(old);
  assert.equal(r.id, 'a');
  assert.equal(r.type, TYPES.bp);
  assert.deepEqual(r.values, { systolic: 120, diastolic: 80, pulse: 70 });
  // Уже новые записи не меняются
  const fresh = makeRecord(TYPES.weight, { value: 70 }, 9);
  assert.deepEqual(migrateRecords([fresh])[0], fresh);
});

test('CSV: строки всех типов, категория только у давления', () => {
  const recs = [
    makeRecord(TYPES.bp, { systolic: 150, diastolic: 95, pulse: null }, Date.parse('2026-10-02T08:00:00Z')),
    makeRecord(TYPES.glucose, { value: 5.6, context: 'fasting' }, Date.parse('2026-10-01T08:00:00Z')),
  ];
  const csv = toCsvRecords(recs, 'en', {}, classify).split('\n');
  assert.equal(csv[0], 'date,type,value,unit,context,category');
  assert.equal(csv[1], '2026-10-02T08:00:00.000Z,bp,150/95,mmHg,,Hypertension stage 2');
  assert.equal(csv[2], '2026-10-01T08:00:00.000Z,glucose,5.6,mmol/L,fasting,');
});

test('лекарства: время нормализуется, дубли убираются, ошибки', () => {
  const ok = validateMed({ name: ' Таблетка ', times: '20:00, 8:00 20:00' });
  assert.equal(ok.error, null);
  assert.equal(ok.name, 'Таблетка');
  assert.deepEqual(ok.times, ['08:00', '20:00']);
  assert.equal(validateMed({ name: '', times: '08:00' }).error, 'err_med_name');
  assert.equal(validateMed({ name: 'A', times: '25:00' }).error, 'err_med_times');
  assert.equal(validateMed({ name: 'A', times: '' }).error, 'err_med_times');
  const med = makeMed({ name: 'A', times: ['08:00'] }, 1);
  assert.match(med.id, /^med-/);
});

test('новые ключи переведены на оба языка', () => {
  for (const key of Object.keys(STRINGS.en)) assert.ok(STRINGS.ru[key], key);
});
