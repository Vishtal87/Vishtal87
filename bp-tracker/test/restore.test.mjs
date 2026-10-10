import { test } from 'node:test';
import assert from 'node:assert/strict';
import { restoreFromBackup, undoRestore, STORAGE } from '../src/restore.mjs';
import { buildBackup } from '../src/backup.mjs';
import { TYPES } from '../src/measurements.mjs';

const NOW = Date.parse('2026-10-10T12:00:00Z');
const rec = (id, systolic = 120) => ({ id, type: TYPES.bp, takenAt: NOW - 1000, values: { systolic, diastolic: 80, pulse: null } });

// Хранилище в памяти с правилами отказа.
// fault: { op: 'getItem'|'setItem'|'removeItem', key, after = 0, times = 1 }
// Правило срабатывает на вызовах с номером >= after (считая вызовы этой операции по этому ключу) и
// отказывает times раз подряд. Так можно сломать именно запись, именно откат или именно проверку чтением.
function memory(initial = {}, faults = []) {
  const data = new Map(Object.entries(initial));
  const calls = new Map();
  const left = faults.map((f) => ({ ...f, after: f.after ?? 0, times: f.times ?? 1 }));
  const maybeFail = (op, key) => {
    const id = `${op}:${key}`;
    const n = calls.get(id) ?? 0;
    calls.set(id, n + 1);
    for (const f of left) {
      if (f.op === op && f.key === key && n >= f.after && f.times > 0) {
        f.times -= 1;
        throw new Error(`сбой ${op} ${key}`);
      }
    }
  };
  return {
    data,
    async getItem(k) { maybeFail('getItem', k); return data.has(k) ? data.get(k) : null; },
    async setItem(k, v) { maybeFail('setItem', k); data.set(k, v); },
    async removeItem(k) { maybeFail('removeItem', k); data.delete(k); },
  };
}

const ORIGINAL_RECORDS = [rec('old1', 130), rec('old2', 140)];
const ORIGINAL_MEDS = [{ id: 'mo', name: 'Старое', times: [] }];
const ORIGINAL_INTAKE = [];
const ORIGINAL_UNITS = { glucose: 'mmol', weight: 'kg' };
const current = () => ({ records: ORIGINAL_RECORDS, meds: ORIGINAL_MEDS, intake: ORIGINAL_INTAKE, units: ORIGINAL_UNITS });
const seeded = () => ({
  [STORAGE.records]: JSON.stringify(ORIGINAL_RECORDS),
  [STORAGE.meds]: JSON.stringify(ORIGINAL_MEDS),
  [STORAGE.intake]: JSON.stringify(ORIGINAL_INTAKE),
  [STORAGE.units]: JSON.stringify(ORIGINAL_UNITS),
});
const NEW_TEXT = buildBackup({ records: [rec('new1', 110)], meds: [], intake: [], units: { glucose: 'mgdl', weight: 'kg' } }, NOW);
const NEW_RECORDS_JSON = JSON.stringify([rec('new1', 110)]);

// Что лежит в хранилище по нашим ключам (null — ключа нет).
// Данные приложения (без ключа отмены): по ним проверяем, что восстановление не оставило следов.
const DATA_KEYS = [STORAGE.records, STORAGE.meds, STORAGE.intake, STORAGE.units];
const snapshotOf = (store) => Object.fromEntries(DATA_KEYS.map((k) => [k, store.data.has(k) ? store.data.get(k) : null]));

test('успешное восстановление: новые значения записаны, снимок текущих сохранён', async () => {
  const store = memory(seeded());
  const r = await restoreFromBackup(store, NEW_TEXT, current(), NOW);
  assert.equal(r.ok, true);
  assert.equal(r.error, null);
  assert.equal(store.data.get(STORAGE.records), NEW_RECORDS_JSON);
  assert.deepEqual(JSON.parse(store.data.get(STORAGE.units)), { glucose: 'mgdl', weight: 'kg' });
  assert.deepEqual(JSON.parse(store.data.get(STORAGE.undo)).records.map((x) => x.id), ['old1', 'old2']);
});

test('неверный файл: хранилище не меняется, снимок не создаётся', async () => {
  const store = memory(seeded());
  const before = snapshotOf(store);
  const r = await restoreFromBackup(store, '{"app":"health-diary","version":1,"records":[{"id":"x"}],"meds":[],"intake":[]}', current(), NOW);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'err_backup_invalid');
  assert.deepEqual(snapshotOf(store), before);
});

test('сбой снимка: запись данных не начинается', async () => {
  const store = memory(seeded(), [{ op: 'setItem', key: STORAGE.undo }]);
  const before = snapshotOf(store);
  const r = await restoreFromBackup(store, NEW_TEXT, current(), NOW);
  assert.equal(r.error, 'err_restore_snapshot');
  assert.deepEqual(snapshotOf(store), before);
});

test('сбой чтения прежних значений перед записью: ничего не пишем', async () => {
  const store = memory(seeded(), [{ op: 'getItem', key: STORAGE.meds, after: 0 }]);
  const before = snapshotOf(store);
  const r = await restoreFromBackup(store, NEW_TEXT, current(), NOW);
  assert.equal(r.error, 'err_restore_snapshot');
  // Снимок записан до чтения, поэтому ключ отмены появился; данные по-прежнему прежние.
  const after = snapshotOf(store);
  for (const k of [STORAGE.records, STORAGE.meds, STORAGE.intake, STORAGE.units]) assert.equal(after[k], before[k]);
});

test('частичная запись (сбой на meds), откат подтверждён: данные как до восстановления', async () => {
  const store = memory(seeded(), [{ op: 'setItem', key: STORAGE.meds, after: 0 }]);
  const before = snapshotOf(store);
  const r = await restoreFromBackup(store, NEW_TEXT, current(), NOW);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'err_restore_write');
  assert.equal(r.failedKey, STORAGE.meds);
  assert.equal(JSON.parse(store.data.get(STORAGE.undo)).records.length, 2);
  assert.equal(r.rollback.verified, true);
  assert.deepEqual(r.rollback.unverifiedKeys, []);
  // Фактическое состояние хранилища: всё как было до начала.
  assert.deepEqual(snapshotOf(store), before);
});

test('сбой отката: записанный ключ не возвращён — ошибка говорит об этом, а не о восстановлении', async () => {
  // Запись records прошла (вызов 0), meds упал (вызов 0). Откат records (вызов 1) тоже падает.
  const store = memory(seeded(), [
    { op: 'setItem', key: STORAGE.meds, after: 0, times: 1 },
    { op: 'setItem', key: STORAGE.records, after: 1, times: 1 },
  ]);
  const r = await restoreFromBackup(store, NEW_TEXT, current(), NOW);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'err_restore_rollback_failed');
  assert.equal(r.rollback.verified, false);
  assert.deepEqual(r.rollback.unverifiedKeys, [STORAGE.records]);
  assert.ok(r.rollback.details.some((d) => d.key === STORAGE.records && d.stage === 'rollback-write'));
  // Фактическое состояние: records остался новым, остальные ключи — прежние.
  assert.equal(store.data.get(STORAGE.records), NEW_RECORDS_JSON);
  assert.equal(store.data.get(STORAGE.meds), seeded()[STORAGE.meds]);
  assert.equal(store.data.get(STORAGE.intake), seeded()[STORAGE.intake]);
  assert.equal(store.data.get(STORAGE.units), seeded()[STORAGE.units]);
});

test('откат записал значение, но проверка чтением упала: прежние данные не утверждаются', async () => {
  // Запись meds падает. Откат проходит, но чтение records при проверке (второе чтение) падает.
  const store = memory(seeded(), [
    { op: 'setItem', key: STORAGE.meds, after: 0, times: 1 },
    { op: 'getItem', key: STORAGE.records, after: 1, times: 1 },
  ]);
  const r = await restoreFromBackup(store, NEW_TEXT, current(), NOW);
  assert.equal(r.error, 'err_restore_rollback_failed');
  assert.deepEqual(r.rollback.unverifiedKeys, [STORAGE.records]);
  assert.ok(r.rollback.details.some((d) => d.key === STORAGE.records && d.stage === 'verify'));
  // Фактически откат прошёл: проверяем, что состояние совпадает с прежним, даже если проверка не подтвердила.
  assert.equal(store.data.get(STORAGE.records), seeded()[STORAGE.records]);
});

test('ключа не было до восстановления: откат удаляет записанный ключ и подтверждает это', async () => {
  const store = memory({ [STORAGE.records]: JSON.stringify([]), [STORAGE.meds]: JSON.stringify([]), [STORAGE.intake]: JSON.stringify([]) }, [
    { op: 'setItem', key: STORAGE.units, after: 0, times: 1 },
  ]);
  const before = snapshotOf(store);
  const r = await restoreFromBackup(store, NEW_TEXT, { records: [], meds: [], intake: [], units: {} }, NOW);
  assert.equal(r.error, 'err_restore_write');
  assert.equal(r.rollback.verified, true);
  assert.deepEqual(snapshotOf(store), before);
  assert.equal(store.data.has(STORAGE.units), false);
  assert.equal(JSON.parse(store.data.get(STORAGE.undo)).records.length, 0);
});

test('отмена восстановления возвращает данные до восстановления', async () => {
  const store = memory(seeded());
  await restoreFromBackup(store, NEW_TEXT, current(), NOW);
  const u = await undoRestore(store, NOW);
  assert.equal(u.ok, true);
  assert.deepEqual(u.data.records.map((x) => x.id), ['old1', 'old2']);
  assert.equal(store.data.get(STORAGE.records), seeded()[STORAGE.records]);
});

test('отмена с частичной записью и подтверждённым откатом: состояние до отмены сохранено', async () => {
  const store = memory(seeded());
  await restoreFromBackup(store, NEW_TEXT, current(), NOW);
  const beforeUndo = snapshotOf(store);
  // Теперь ломаем запись при отмене на meds. Копируем всё хранилище, включая снимок отмены.
  const broken = memory(Object.fromEntries(store.data), [
    { op: 'setItem', key: STORAGE.meds, after: 0, times: 1 },
  ]);
  const u = await undoRestore(broken, NOW);
  assert.equal(u.error, 'err_restore_write');
  assert.equal(u.rollback.verified, true);
  assert.deepEqual(snapshotOf(broken), beforeUndo);
  assert.equal(u.failedKey, STORAGE.meds);
});

test('отмена с неподтверждённым откатом: честная ошибка', async () => {
  const store = memory(seeded());
  await restoreFromBackup(store, NEW_TEXT, current(), NOW);
  const broken = memory(Object.fromEntries(store.data), [
    { op: 'setItem', key: STORAGE.meds, after: 0, times: 1 },
    { op: 'setItem', key: STORAGE.records, after: 1, times: 1 },
  ]);
  const u = await undoRestore(broken, NOW);
  assert.equal(u.error, 'err_restore_rollback_failed');
  assert.equal(u.rollback.verified, false);
  assert.ok(u.rollback.unverifiedKeys.length > 0);
});

test('отмена без снимка: понятная ошибка, данные не трогаются', async () => {
  const store = memory(seeded());
  const before = snapshotOf(store);
  const u = await undoRestore(store, NOW);
  assert.equal(u.error, 'err_restore_none');
  assert.deepEqual(snapshotOf(store), before);
});

test('повреждённый снимок не применяется при отмене', async () => {
  const store = memory({ ...seeded(), [STORAGE.undo]: '{"app":"health-diary","version":1,"records":"x"}' });
  const before = snapshotOf(store);
  const u = await undoRestore(store, NOW);
  assert.equal(u.ok, false);
  assert.deepEqual(snapshotOf(store), before);
});
