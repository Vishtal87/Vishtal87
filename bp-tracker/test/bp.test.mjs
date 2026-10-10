import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORIES, classify, validate, averageForDays, sortNewestFirst, toCsv, makeReading, parseTakenAt } from '../src/bp.mjs';
import { STRINGS, translate, detectLanguage, LANGUAGES } from '../src/i18n.mjs';

test('категории по таблице AHA', () => {
  assert.equal(classify(110, 70), CATEGORIES.NORMAL);
  assert.equal(classify(125, 75), CATEGORIES.ELEVATED);
  assert.equal(classify(135, 75), CATEGORIES.STAGE1);
  assert.equal(classify(118, 85), CATEGORIES.STAGE1);
  assert.equal(classify(150, 95), CATEGORIES.STAGE2);
  assert.equal(classify(185, 80), CATEGORIES.CRISIS);
  assert.equal(classify(100, 125), CATEGORIES.CRISIS);
});

test('валидация возвращает ключи ошибок', () => {
  assert.equal(validate({ systolic: 120, diastolic: 80, pulse: '' }), null);
  assert.equal(validate({ systolic: 50, diastolic: 80, pulse: '' }), 'err_systolic');
  assert.equal(validate({ systolic: 120, diastolic: 20, pulse: '' }), 'err_diastolic');
  assert.equal(validate({ systolic: 80, diastolic: 90, pulse: '' }), 'err_order');
  assert.equal(validate({ systolic: 120, diastolic: 80, pulse: '300' }), 'err_pulse');
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

test('CSV на русском и английском', () => {
  const readings = [
    { takenAt: Date.parse('2026-10-01T08:00:00Z'), systolic: 150, diastolic: 95, pulse: null },
    { takenAt: Date.parse('2026-10-02T08:00:00Z'), systolic: 118, diastolic: 76, pulse: 64 },
  ];
  const ru = toCsv(readings, 'ru').split('\n');
  assert.equal(ru[0], 'дата,верхнее,нижнее,пульс,категория');
  assert.equal(ru[1], '2026-10-02T08:00:00.000Z,118,76,64,Нормальное');
  assert.equal(ru[2], '2026-10-01T08:00:00.000Z,150,95,,Гипертензия 2 степени');
  const en = toCsv(readings, 'en').split('\n');
  assert.equal(en[0], 'date,systolic,diastolic,pulse,category');
  assert.equal(en[1], '2026-10-02T08:00:00.000Z,118,76,64,Normal');
  assert.equal(en[2], '2026-10-01T08:00:00.000Z,150,95,,Hypertension stage 2');
});

test('makeReading приводит числа и пустой пульс к null', () => {
  const r = makeReading({ systolic: '121', diastolic: '79', pulse: '' }, 1000);
  assert.equal(r.systolic, 121);
  assert.equal(r.diastolic, 79);
  assert.equal(r.pulse, null);
  assert.equal(r.takenAt, 1000);
});

test('дата: пусто — сейчас, полная дата и время, ошибки', () => {
  const now = new Date(2026, 9, 10, 12, 0).getTime();
  assert.equal(parseTakenAt('', now).takenAt, now);
  assert.equal(parseTakenAt('  ', now).takenAt, now);
  assert.equal(parseTakenAt('01.10.2026 08:30', now).takenAt, new Date(2026, 9, 1, 8, 30).getTime());
  assert.equal(parseTakenAt('5.3.2026', now).takenAt, new Date(2026, 2, 5, 0, 0).getTime());
  assert.equal(parseTakenAt('31.02.2026', now).error, 'err_date_invalid');
  assert.equal(parseTakenAt('11.10.2026', now).error, 'err_date_future');
  assert.equal(parseTakenAt('вчера', now).error, 'err_date_format');
});

test('каждый ключ переведён на все языки', () => {
  const keys = Object.keys(STRINGS.en);
  for (const lang of LANGUAGES) {
    for (const key of keys) {
      assert.ok(STRINGS[lang][key], `нет перевода ${key} для ${lang}`);
    }
    assert.deepEqual(Object.keys(STRINGS[lang]).sort(), keys.sort(), `разные ключи в ${lang}`);
  }
});

test('подстановка переменных и запасной язык', () => {
  assert.equal(translate('en', 'chartTitle', { n: 5 }), 'Last 5 readings');
  assert.equal(translate('ru', 'chartTitle', { n: 5 }), 'Последние 5 измерений');
  assert.equal(translate('xx', 'save'), 'Save');
  assert.equal(translate('en', 'unknown_key'), 'unknown_key');
});

test('язык по умолчанию от системы', () => {
  assert.equal(detectLanguage('ru-RU'), 'ru');
  assert.equal(detectLanguage('en-US'), 'en');
  assert.equal(detectLanguage('de-DE'), 'en');
  assert.equal(detectLanguage(undefined), 'en');
});
