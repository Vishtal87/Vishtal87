import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CATEGORIES,
  classify,
  validate,
  averageForDays,
  sortNewestFirst,
  toCsv,
  makeReading,
} from '../src/bp.mjs';

test('категории по таблице AHA', () => {
  assert.equal(classify(110, 70), CATEGORIES.NORMAL);
  assert.equal(classify(125, 75), CATEGORIES.ELEVATED);
  assert.equal(classify(135, 75), CATEGORIES.STAGE1);
  assert.equal(classify(118, 85), CATEGORIES.STAGE1);
  assert.equal(classify(150, 95), CATEGORIES.STAGE2);
  assert.equal(classify(185, 80), CATEGORIES.CRISIS);
  assert.equal(classify(100, 125), CATEGORIES.CRISIS);
});

test('валидация: границы и порядок значений', () => {
  assert.equal(validate({ systolic: 120, diastolic: 80, pulse: '' }), null);
  assert.match(validate({ systolic: 50, diastolic: 80, pulse: '' }), /Верхнее/);
  assert.match(validate({ systolic: 120, diastolic: 20, pulse: '' }), /Нижнее/);
  assert.match(validate({ systolic: 80, diastolic: 90, pulse: '' }), /меньше верхнего/);
  assert.match(validate({ systolic: 120, diastolic: 80, pulse: '300' }), /Пульс/);
  assert.equal(validate({ systolic: 120, diastolic: 80, pulse: '72' }), null);
});

test('среднее за последние дни учитывает только свежие записи', () => {
  const now = Date.parse('2026-10-10T12:00:00Z');
  const day = 24 * 60 * 60 * 1000;
  const readings = [
    { takenAt: now - 1 * day, systolic: 120, diastolic: 80 },
    { takenAt: now - 2 * day, systolic: 140, diastolic: 90 },
    { takenAt: now - 30 * day, systolic: 200, diastolic: 120 },
  ];
  assert.deepEqual(averageForDays(readings, 7, now), { count: 2, systolic: 130, diastolic: 85 });
  assert.equal(averageForDays(readings, 0.5, now), null);
});

test('сортировка: новые сверху', () => {
  const sorted = sortNewestFirst([{ takenAt: 1 }, { takenAt: 3 }, { takenAt: 2 }]);
  assert.deepEqual(sorted.map((r) => r.takenAt), [3, 2, 1]);
});

test('CSV: заголовок, строки, пустой пульс и категория', () => {
  const csv = toCsv([
    { takenAt: Date.parse('2026-10-01T08:00:00Z'), systolic: 150, diastolic: 95, pulse: null },
    { takenAt: Date.parse('2026-10-02T08:00:00Z'), systolic: 118, diastolic: 76, pulse: 64 },
  ]);
  const lines = csv.split('\n');
  assert.equal(lines[0], 'дата,верхнее,нижнее,пульс,категория');
  assert.equal(lines[1], '2026-10-02T08:00:00.000Z,118,76,64,Нормальное');
  assert.equal(lines[2], '2026-10-01T08:00:00.000Z,150,95,,Гипертензия 2 степени');
});

test('makeReading приводит числа и пустой пульс к null', () => {
  const r = makeReading({ systolic: '121', diastolic: '79', pulse: '' }, 1000);
  assert.equal(r.systolic, 121);
  assert.equal(r.diastolic, 79);
  assert.equal(r.pulse, null);
  assert.equal(r.takenAt, 1000);
});

test('дата: пусто — сейчас, полная дата и время, ошибки', async () => {
  const { parseTakenAt } = await import('../src/bp.mjs');
  const now = new Date(2026, 9, 10, 12, 0).getTime();
  assert.equal(parseTakenAt('', now).takenAt, now);
  assert.equal(parseTakenAt('  ', now).takenAt, now);
  assert.equal(parseTakenAt('01.10.2026 08:30', now).takenAt, new Date(2026, 9, 1, 8, 30).getTime());
  assert.equal(parseTakenAt('5.3.2026', now).takenAt, new Date(2026, 2, 5, 0, 0).getTime());
  assert.match(parseTakenAt('31.02.2026', now).error, /не существует/);
  assert.match(parseTakenAt('11.10.2026', now).error, /будущем/);
  assert.match(parseTakenAt('вчера', now).error, /дд\.мм/);
});
