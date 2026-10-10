import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRO_FEATURES, isUnlocked, reminderAllowed, FREE_REMINDER_LIMIT } from '../src/entitlements.mjs';
import { setIntake, statusFor, summary, dateKey, INTAKE_STATUS } from '../src/intake.mjs';
import { buildBackup, parseBackup, BACKUP_VERSION } from '../src/backup.mjs';
import { buildReportHtml } from '../src/report.mjs';
import { makeRecord, TYPES } from '../src/measurements.mjs';
import { STRINGS } from '../src/i18n.mjs';

test('Pro: платные функции закрыты без Pro, открыты с Pro', () => {
  assert.equal(isUnlocked(PRO_FEATURES.pdfReport, false), false);
  assert.equal(isUnlocked(PRO_FEATURES.pdfReport, true), true);
  assert.equal(isUnlocked('unknown', false), true);
});

test('напоминания: одно бесплатно, остальные только с Pro', () => {
  assert.equal(reminderAllowed(0, false), true);
  assert.equal(reminderAllowed(FREE_REMINDER_LIMIT, false), false);
  assert.equal(reminderAllowed(5, true), true);
});

test('журнал приёма: отметка заменяет прежнюю за то же время', () => {
  let list = [];
  list = setIntake(list, { medId: 'm1', date: '2026-10-10', time: '08:00', status: INTAKE_STATUS.TAKEN }, 'a');
  list = setIntake(list, { medId: 'm1', date: '2026-10-10', time: '08:00', status: INTAKE_STATUS.MISSED }, 'b');
  assert.equal(list.length, 1);
  assert.equal(statusFor(list, 'm1', '2026-10-10', '08:00'), 'missed');
  assert.equal(statusFor(list, 'm1', '2026-10-10', '20:00'), null);
});

test('журнал приёма: сводка за период', () => {
  let list = [];
  list = setIntake(list, { medId: 'm1', date: '2026-10-01', time: '08:00', status: 'taken' }, 'a');
  list = setIntake(list, { medId: 'm1', date: '2026-10-02', time: '08:00', status: 'missed' }, 'b');
  list = setIntake(list, { medId: 'm1', date: '2026-09-01', time: '08:00', status: 'taken' }, 'c');
  assert.deepEqual(summary(list, 'm1', '2026-10-01', '2026-10-31'), { taken: 1, missed: 1, total: 2 });
  assert.equal(dateKey(new Date(2026, 9, 5, 10).getTime()), '2026-10-05');
});

test('резервная копия: сохраняется и читается обратно', () => {
  const data = { records: [makeRecord(TYPES.bp, { systolic: 120, diastolic: 80, pulse: null }, 1)], meds: [{ id: 'm', name: 'A', times: ['08:00'] }], intake: [], units: { glucose: 'mmol' } };
  const text = buildBackup(data);
  const back = parseBackup(text);
  assert.equal(back.error, null);
  assert.deepEqual(back.data.records, data.records);
  assert.deepEqual(back.data.meds, data.meds);
});

test('резервная копия: чужой файл и новая версия отклоняются', () => {
  assert.equal(parseBackup('не json').error, 'err_backup_format');
  assert.equal(parseBackup(JSON.stringify({ app: 'other', version: 1 })).error, 'err_backup_format');
  assert.equal(parseBackup(JSON.stringify({ app: 'health-diary', version: BACKUP_VERSION + 1, records: [], meds: [], intake: [] })).error, 'err_backup_version');
  assert.equal(parseBackup(JSON.stringify({ app: 'health-diary', version: 1, records: 'x', meds: [], intake: [] })).error, 'err_backup_format');
});

test('отчёт: содержит период, измерения, лекарства и дисклеймер, экранирует HTML', () => {
  const now = Date.parse('2026-10-10T12:00:00Z');
  const records = [makeRecord(TYPES.bp, { systolic: 146, diastolic: 94, pulse: 78 }, now - 3600e3)];
  const meds = [{ id: 'm1', name: '<b>A</b>', times: ['08:00'] }];
  const intake = [{ id: 'i', medId: 'm1', date: dateKey(now), time: '08:00', status: 'taken' }];
  const html = buildReportHtml({
    records, meds, intake, units: {}, lang: 'ru',
    fromMs: now - 30 * 864e5, toMs: now, dateFmt: (ms) => new Date(ms).toISOString().slice(0, 10),
  });
  assert.match(html, /146\/94/);
  assert.match(html, /Гипертензия 2 степени/);
  assert.match(html, /&lt;b&gt;A&lt;\/b&gt;/);
  assert.ok(!html.includes('<b>A</b>'));
  assert.match(html, /диагноз/);
});

test('новые ключи переведены', () => {
  for (const key of Object.keys(STRINGS.en)) assert.ok(STRINGS.ru[key], key);
});
