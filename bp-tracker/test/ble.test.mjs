import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSfloat, parseBloodPressure, parseGlucose, parseWeight, base64ToBytes, DEVICE_KINDS } from '../src/ble.mjs';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

test('SFLOAT: мантисса, порядок и служебные значения', () => {
  assert.equal(parseSfloat(0x7b, 0x00), 123);
  close(parseSfloat(0x3c, 0xf0), 6); // 60 × 10^-1
  assert.equal(parseSfloat(0xff, 0x0f), -1); // мантисса −1
  assert.equal(parseSfloat(0xff, 0x07), null); // NaN
  assert.equal(parseSfloat(0x00, 0x08), null); // NRes
});

test('base64: декодирование байтов', () => {
  assert.deepEqual([...base64ToBytes('AQID')], [1, 2, 3]);
  assert.deepEqual([...base64ToBytes('AA==')], [0]);
});

test('тонометр: мм рт. ст., пульс, кПа', () => {
  // флаги 0x00 (мм рт. ст.), 120/80, MAP 93
  assert.deepEqual(parseBloodPressure(Uint8Array.from([0x00, 0x78, 0x00, 0x50, 0x00, 0x5d, 0x00])), { systolic: 120, diastolic: 80, pulse: null });
  // флаги 0x04: есть пульс 72
  assert.deepEqual(parseBloodPressure(Uint8Array.from([0x04, 0x78, 0x00, 0x50, 0x00, 0x5d, 0x00, 0x48, 0x00])), { systolic: 120, diastolic: 80, pulse: 72 });
  // флаги 0x01: кПа, 16.0 и 10.7 кПа → 120 и 80 мм рт. ст.
  assert.deepEqual(parseBloodPressure(Uint8Array.from([0x01, 0xa0, 0xf0, 0x6b, 0xf0, 0x00, 0x00, 0x00])), { systolic: 120, diastolic: 80, pulse: null });
  // флаги 0x06: отметка времени (7 байт), затем пульс
  const timed = [0x06, 0x78, 0x00, 0x50, 0x00, 0x5d, 0x00, 0xe8, 0x07, 1, 1, 8, 0, 0, 0x48, 0x00]; // время: год(2) месяц день час мин сек
  assert.deepEqual(parseBloodPressure(Uint8Array.from(timed)), { systolic: 120, diastolic: 80, pulse: 72 });
  assert.equal(parseBloodPressure(Uint8Array.from([0x00, 0x78])), null);
});

test('глюкометр: кг/л переводим в ммоль/л, моль/л — как есть', () => {
  // 0.00099 кг/л = 99 мг/дл = 5.5 ммоль/л; без смещения времени
  const kgPerL = [0x02, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x63, 0xb0];
  assert.deepEqual(parseGlucose(Uint8Array.from(kgPerL)), { value: 5.5, context: 'other' });
  // флаги 0x06: моль/л, 0.0055 → 5.5 ммоль/л
  const molar = [0x06, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x37, 0xc0];
  assert.deepEqual(parseGlucose(Uint8Array.from(molar)), { value: 5.5, context: 'other' });
  // флаги 0x03: есть смещение времени (2 байта) перед концентрацией
  const withOffset = [0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x63, 0xb0];
  assert.deepEqual(parseGlucose(Uint8Array.from(withOffset)), { value: 5.5, context: 'other' });
  assert.equal(parseGlucose(Uint8Array.from([0x00, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x63, 0xb0])), null);
});

test('весы: килограммы, фунты и неизвестное значение', () => {
  assert.deepEqual(parseWeight(Uint8Array.from([0x00, 0x14, 0x37])), { value: 70.5 }); // 14100 × 0.005 кг
  assert.deepEqual(parseWeight(Uint8Array.from([0x01, 0x46, 0x3c])), { value: 70 }); // 154.3 фунта ≈ 70.0 кг
  assert.equal(parseWeight(Uint8Array.from([0x00, 0xff, 0xff])), null);
});

test('виды приборов: стандартные UUID Bluetooth SIG', () => {
  assert.equal(DEVICE_KINDS.bp.service, '00001810-0000-1000-8000-00805f9b34fb');
  assert.equal(DEVICE_KINDS.bp.characteristic, '00002a35-0000-1000-8000-00805f9b34fb');
  assert.equal(DEVICE_KINDS.glucose.service, '00001808-0000-1000-8000-00805f9b34fb');
  assert.equal(DEVICE_KINDS.weight.characteristic, '00002a9d-0000-1000-8000-00805f9b34fb');
});
