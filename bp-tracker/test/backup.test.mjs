import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBackup, parseBackup, BACKUP_VERSION, BACKUP_MAX_CHARS } from '../src/backup.mjs';
import { TYPES } from '../src/measurements.mjs';

const NOW = Date.parse('2026-10-10T12:00:00Z');
const bp = (id, extra = {}) => ({ id, type: TYPES.bp, takenAt: NOW - 1000, values: { systolic: 120, diastolic: 80, pulse: 70 }, ...extra });
const glucose = (id) => ({ id, type: TYPES.glucose, takenAt: NOW - 1000, values: { value: 5.5, context: 'fasting' } });
const weight = (id) => ({ id, type: TYPES.weight, takenAt: NOW - 1000, values: { value: 81.2 } });
const med = (id) => ({ id, name: 'Витамин D', times: ['08:00', '20:00'] });
const intake = (id) => ({ id, medId: 'm1', date: '2026-10-09', time: '08:00', status: 'taken' });

function make(overrides = {}) {
  const base = {
    app: 'health-diary',
    version: BACKUP_VERSION,
    records: [bp('r1'), glucose('r2'), weight('r3')],
    meds: [med('m1')],
    intake: [intake('i1')],
    units: { glucose: 'mmol', weight: 'kg' },
  };
  return JSON.stringify({ ...base, ...overrides });
}

test('корректная копия принимается и очищается от лишних полей', () => {
  const text = JSON.stringify({ app: 'health-diary', version: 1, records: [{ ...bp('r1'), extra: 'x', values: { systolic: 120, diastolic: 80, pulse: 70, junk: 1 } }], meds: [], intake: [] });
  const r = parseBackup(text, NOW);
  assert.equal(r.error, null);
  assert.deepEqual(r.data.records[0].values, { systolic: 120, diastolic: 80, pulse: 70 });
  assert.equal('extra' in r.data.records[0], false);
  assert.deepEqual(r.counts, { records: 1, meds: 0, intake: 0 });
});

test('полная копия из buildBackup проходит проверку без потерь', () => {
  const original = { records: [bp('r1'), glucose('r2'), weight('r3')], meds: [med('m1')], intake: [intake('i1')], units: { glucose: 'mmol', weight: 'kg' } };
  const r = parseBackup(buildBackup(original, NOW), NOW);
  assert.equal(r.error, null);
  assert.deepEqual(r.data.records.map((x) => x.id), ['r1', 'r2', 'r3']);
  assert.deepEqual(r.data.meds, [{ id: 'm1', name: 'Витамин D', times: ['08:00', '20:00'] }]);
  assert.deepEqual(r.data.intake, [intake('i1')]);
});

test('повреждённые файлы: пустой, не JSON, не объект, другое приложение', () => {
  assert.equal(parseBackup('', NOW).error, 'err_backup_format');
  assert.equal(parseBackup(undefined, NOW).error, 'err_backup_format');
  assert.equal(parseBackup('{"app":"health-diary", "records": [', NOW).error, 'err_backup_format');
  assert.equal(parseBackup('[1,2,3]', NOW).error, 'err_backup_format');
  assert.equal(parseBackup('null', NOW).error, 'err_backup_format');
  assert.equal(parseBackup(make({ app: 'other' }), NOW).error, 'err_backup_format');
});

test('версия: будущая отклоняется, нецелая и нулевая — формат', () => {
  assert.equal(parseBackup(make({ version: BACKUP_VERSION + 1 }), NOW).error, 'err_backup_version');
  assert.equal(parseBackup(make({ version: 0 }), NOW).error, 'err_backup_format');
  assert.equal(parseBackup(make({ version: 1.5 }), NOW).error, 'err_backup_format');
  assert.equal(parseBackup(make({ version: '1' }), NOW).error, 'err_backup_format');
});

test('неполная структура: поля не массивы', () => {
  assert.equal(parseBackup(make({ records: 'x' }), NOW).error, 'err_backup_format');
  assert.equal(parseBackup(make({ meds: undefined }), NOW).error, 'err_backup_format');
  assert.equal(parseBackup(make({ intake: {} }), NOW).error, 'err_backup_format');
});

test('некорректные значения измерений: одна плохая запись отклоняет всю копию', () => {
  const cases = [
    { systolic: 'abc', diastolic: 80, pulse: 70 },
    { systolic: '120', diastolic: 80, pulse: 70 },
    { systolic: 1e9, diastolic: 80, pulse: 70 },
    { systolic: 120, diastolic: 130, pulse: 70 },
    { systolic: 120, diastolic: 80, pulse: 'x' },
    { systolic: null, diastolic: 80, pulse: 70 },
  ];
  for (const values of cases) {
    const text = make({ records: [{ ...bp('bad'), values }] });
    assert.equal(parseBackup(text, NOW).error, 'err_backup_invalid', JSON.stringify(values));
  }
});

test('сахар и вес: тип, контекст, диапазон', () => {
  assert.equal(parseBackup(make({ records: [{ ...glucose('g'), values: { value: '5.5', context: 'fasting' } }] }), NOW).error, 'err_backup_invalid');
  assert.equal(parseBackup(make({ records: [{ ...glucose('g'), values: { value: 5.5, context: 'nope' } }] }), NOW).error, 'err_backup_invalid');
  assert.equal(parseBackup(make({ records: [{ ...glucose('g'), values: { value: 500, context: 'fasting' } }] }), NOW).error, 'err_backup_invalid');
  assert.equal(parseBackup(make({ records: [{ ...weight('w'), values: { value: 5 } }] }), NOW).error, 'err_backup_invalid');
});

test('даты: отсутствующая, нечисловая, в будущем, слишком старая', () => {
  const bad = [undefined, '2026-10-10', 1.5, Date.parse('1800-01-01T00:00:00Z'), NOW + 3 * 24 * 60 * 60 * 1000];
  for (const takenAt of bad) {
    const rec = { ...bp('x') };
    if (takenAt === undefined) delete rec.takenAt;
    else rec.takenAt = takenAt;
    assert.equal(parseBackup(make({ records: [rec] }), NOW).error, 'err_backup_invalid', String(takenAt));
  }
});

test('тип записи и id: неизвестный тип, пустой или повторяющийся id', () => {
  assert.equal(parseBackup(make({ records: [{ ...bp('x'), type: 'steps' }] }), NOW).error, 'err_backup_invalid');
  assert.equal(parseBackup(make({ records: [bp('')] }), NOW).error, 'err_backup_invalid');
  assert.equal(parseBackup(make({ records: [bp('dup'), bp('dup')] }), NOW).error, 'err_backup_invalid');
  assert.equal(parseBackup(make({ records: [{ ...bp('x'), id: 42 }] }), NOW).error, 'err_backup_invalid');
});

test('лекарства и приём: время, название, статус, дата', () => {
  assert.equal(parseBackup(make({ meds: [{ id: 'm', name: 'A', times: ['25:00'] }] }), NOW).error, 'err_backup_invalid');
  assert.equal(parseBackup(make({ meds: [{ id: 'm', name: '', times: [] }] }), NOW).error, 'err_backup_invalid');
  assert.equal(parseBackup(make({ meds: [{ id: 'm', name: 'A', times: [800] }] }), NOW).error, 'err_backup_invalid');
  assert.equal(parseBackup(make({ intake: [{ ...intake('i'), status: 'maybe' }] }), NOW).error, 'err_backup_invalid');
  assert.equal(parseBackup(make({ intake: [{ ...intake('i'), date: '2026-13-40' }] }), NOW).error, 'err_backup_invalid');
  assert.equal(parseBackup(make({ intake: [{ ...intake('i'), time: '8:00' }] }), NOW).error, 'err_backup_invalid');
});

test('единицы: только известные значения', () => {
  assert.equal(parseBackup(make({ units: { glucose: 'ppm' } }), NOW).error, 'err_backup_invalid');
  assert.equal(parseBackup(make({ units: 'kg' }), NOW).error, 'err_backup_invalid');
  assert.deepEqual(parseBackup(make({ units: { weight: 'lb' } }), NOW).data.units, { weight: 'lb' });
});

test('слишком большой файл отклоняется до разбора', () => {
  const huge = 'x'.repeat(BACKUP_MAX_CHARS + 1);
  assert.equal(parseBackup(huge, NOW).error, 'err_backup_size');
});

test('служебные ключи не попадают в данные', () => {
  const text = '{"app":"health-diary","version":1,"records":[],"meds":[],"intake":[],"__proto__":{"polluted":true},"constructor":{}}';
  const r = parseBackup(text, NOW);
  assert.equal(r.error, null);
  assert.equal(Object.prototype.polluted, undefined);
  assert.deepEqual(Object.keys(r.data).sort(), ['intake', 'meds', 'records', 'units']);
});
