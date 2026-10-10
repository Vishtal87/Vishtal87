import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeReminderCount, canAddReminder, reminderSlots } from '../src/reminders.mjs';
import { chartPoints, scaleRange } from '../src/chart.mjs';
import { toggleIntake, dateKey, statusFor, INTAKE_STATUS } from '../src/intake.mjs';
import { buildReportHtml } from '../src/report.mjs';
import { healthTypeFor } from '../src/healthSync.mjs';
import { TYPES } from '../src/measurements.mjs';

const med = (id, name, times) => ({ id, name, times });

test('напоминания: бесплатно одно лекарство, Pro — без лимита', () => {
  const none = [med('a', 'A', [])];
  const one = [med('a', 'A', ['08:00'])];
  assert.equal(activeReminderCount(none), 0);
  assert.equal(activeReminderCount(one), 1);
  assert.equal(canAddReminder(none, false), true);
  assert.equal(canAddReminder(one, false), false);
  assert.equal(canAddReminder(one, true), true);
});

test('напоминания: слоты по времени суток', () => {
  const slots = reminderSlots([med('a', 'Бета', ['20:00', '08:30']), med('b', 'Альфа', ['08:30'])]);
  assert.deepEqual(slots.map((s) => `${s.time}:${s.name}`), ['08:30:Альфа', '08:30:Бета', '20:00:Бета']);
  assert.equal(slots[0].hour, 8);
  assert.equal(slots[0].minute, 30);
});

test('график: давление — диапазон, сахар — одно значение, последние N', () => {
  const records = [
    { id: '1', type: TYPES.bp, takenAt: 2, values: { systolic: 130, diastolic: 80 } },
    { id: '2', type: TYPES.bp, takenAt: 1, values: { systolic: 120, diastolic: 70 } },
    { id: '3', type: TYPES.glucose, takenAt: 3, values: { value: 5.5, context: 'fasting' } },
  ];
  assert.deepEqual(chartPoints(records, TYPES.bp, 10).map((p) => p.id), ['2', '1']);
  assert.deepEqual(chartPoints(records, TYPES.bp, 1).map((p) => p.id), ['1']);
  assert.deepEqual(chartPoints(records, TYPES.glucose, 10)[0], { id: '3', takenAt: 3, low: 5.5, high: 5.5 });
});

test('шкала: отступ для одного значения и заданные пределы', () => {
  const r = scaleRange([{ low: 5, high: 5 }]);
  assert.ok(r.min < 5 && r.max > 5);
  assert.deepEqual(scaleRange([], { min: 40, max: 200 }), { min: 40, max: 200 });
  assert.equal(scaleRange([]).max > scaleRange([]).min, true);
});

test('отметка приёма: повтор снимает, другая заменяет', () => {
  const args = { medId: 'm', date: '2026-10-10', time: '08:00' };
  let list = toggleIntake([], { ...args, status: INTAKE_STATUS.TAKEN }, 'x1');
  assert.equal(statusFor(list, 'm', '2026-10-10', '08:00'), 'taken');
  list = toggleIntake(list, { ...args, status: INTAKE_STATUS.MISSED }, 'x2');
  assert.equal(statusFor(list, 'm', '2026-10-10', '08:00'), 'missed');
  assert.equal(list.length, 1);
  list = toggleIntake(list, { ...args, status: INTAKE_STATUS.MISSED }, 'x3');
  assert.equal(list.length, 0);
});

test('отчёт: ключи дат локальные, подпись периода не «за 7 дней»', () => {
  const now = new Date(2026, 9, 10, 12, 0).getTime();
  const from = new Date(2026, 9, 1, 0, 30).getTime();
  const meds = [med('m1', 'Тест', ['08:00'])];
  const intake = [{ id: 'i', medId: 'm1', date: dateKey(from), time: '08:00', status: 'taken' }];
  const html = buildReportHtml({
    records: [],
    meds,
    intake,
    lang: 'ru',
    fromMs: from,
    toMs: now,
    dateFmt: (ms) => dateKey(ms),
  });
  assert.ok(html.includes('Среднее за период'));
  assert.ok(!html.includes('Среднее за 7 дней'));
  // Отметка за первый день периода попадает в отчёт, даже если UTC-день другой.
  assert.ok(html.includes('<td>Тест</td><td>08:00</td><td>1</td><td>0</td>'));
});

test('Health Connect: тип записи по типу измерения', () => {
  assert.equal(healthTypeFor(TYPES.bp), 'BloodPressure');
  assert.equal(healthTypeFor(TYPES.glucose), 'BloodGlucose');
  assert.equal(healthTypeFor(TYPES.weight), 'Weight');
  assert.equal(healthTypeFor('other'), null);
});

import { formatTakenAt, parseTakenAt } from '../src/bp.mjs';
import { toInputUnits, toCanonical } from '../src/measurements.mjs';
import { validateMed } from '../src/meds.mjs';

test('дата: формат поля ввода обратим для parseTakenAt', () => {
  const ms = new Date(2026, 4, 5, 8, 7).getTime();
  assert.equal(formatTakenAt(ms), '05.05.2026 08:07');
  assert.equal(parseTakenAt(formatTakenAt(ms), Date.now()).takenAt, ms);
});

test('единицы: обратное преобразование к каноническим', () => {
  assert.equal(toInputUnits(TYPES.glucose, 5.5, 'mmol'), 5.5);
  assert.equal(toInputUnits(TYPES.glucose, 5.5, 'mgdl'), 99.1);
  assert.equal(toInputUnits(TYPES.weight, 70, 'lb'), 154.3);
  assert.ok(Math.abs(toCanonical(TYPES.glucose, toInputUnits(TYPES.glucose, 6.2, 'mgdl'), 'mgdl') - 6.2) < 0.06);
});

test('лекарство: время необязательно, но если задано — проверяется', () => {
  assert.deepEqual(validateMed({ name: 'Витамин D', times: '' }), { error: null, name: 'Витамин D', times: [] });
  assert.deepEqual(validateMed({ name: 'A', times: '8:00, 20:00, 08:00' }), { error: null, name: 'A', times: ['08:00', '20:00'] });
  assert.equal(validateMed({ name: 'A', times: '25:00' }).error, 'err_med_times');
  assert.equal(validateMed({ name: '  ', times: '' }).error, 'err_med_name');
});

import { PRO_PLANS, PRO_SKUS, sortPlans, buildSubscriptionRequest, hasProPurchase } from '../src/purchases.mjs';

test('подписки: порядок тарифов и запрос покупки для iOS и Android', () => {
  const products = [{ id: PRO_PLANS.yearly }, { id: 'other' }, { id: PRO_PLANS.monthly }];
  assert.deepEqual(sortPlans(products).map((p) => p.id), [PRO_PLANS.monthly, PRO_PLANS.yearly]);
  assert.deepEqual(buildSubscriptionRequest({ id: PRO_PLANS.monthly }, 'ios'), {
    type: 'subs',
    request: { apple: { sku: PRO_PLANS.monthly } },
  });
  const android = buildSubscriptionRequest({ id: PRO_PLANS.yearly, subscriptionOffers: [{ sku: PRO_PLANS.yearly, offerToken: 'tok' }] }, 'android');
  assert.deepEqual(android.request.google.subscriptionOffers, [{ sku: PRO_PLANS.yearly, offerToken: 'tok' }]);
  assert.equal(buildSubscriptionRequest({ id: PRO_PLANS.yearly, subscriptionOffers: [] }, 'android'), null);
  assert.equal(buildSubscriptionRequest(undefined, 'ios'), null);
});

test('подписки: активная покупка Pro распознаётся', () => {
  assert.equal(hasProPurchase([{ productId: PRO_SKUS[0] }]), true);
  assert.equal(hasProPurchase([{ productId: 'unknown' }]), false);
  assert.equal(hasProPurchase([]), false);
  assert.equal(hasProPurchase(null), false);
});

import { PRIVACY_URL, TERMS_URL } from '../src/links.mjs';

test('ссылки на документы указывают на https', () => {
  assert.match(PRIVACY_URL, /^https:\/\//);
  assert.match(TERMS_URL, /^https:\/\//);
});
