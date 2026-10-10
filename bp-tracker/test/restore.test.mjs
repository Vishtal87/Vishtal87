import { test } from 'node:test';
import assert from 'node:assert/strict';
import { restoreFromBackup, undoRestore, STORAGE } from '../src/restore.mjs';
import { buildBackup } from '../src/backup.mjs';
import { TYPES } from '../src/measurements.mjs';

const NOW = Date.parse('2026-10-10T12:00:00Z');
const rec = (id, systolic = 120) => ({ id, type: TYPES.bp, takenAt: NOW - 1000, values: { systolic, diastolic: 80, pulse: null } });

// Память вместо AsyncStorage. failOn — ключ, на котором запись падает.
function memory(initial = {}, { failOn = null, failSnapshot = false } = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    async getItem(k) { return data.has(k) ? data.get(k) : null; },
    async setItem(k, v) {
      if (failSnapshot && k === STORAGE.undo) throw new Error('disk full');
      if (k === failOn) throw new Error('disk full');
      data.set(k, v);
    },
    async removeItem(k) { data.delete(k); },
  };
}

function currentState() {
  return { records: [rec('old1', 130), rec('old2', 140)], meds: [{ id: 'mo', name: 'Старое', times: [] }], intake: [], units: { glucose: 'mmol', weight: 'kg' } };
}

function seedFrom(state) {
  return {
    [STORAGE.records]: JSON.stringify(state.records),
    [STORAGE.meds]: JSON.stringify(state.meds),
    [STORAGE.intake]: JSON.stringify(state.intake),
    [STORAGE.units]: JSON.stringify(state.units),
  };
}

const incomingText = buildBackup({ records: [rec('new1', 110)], meds: [], intake: [], units: { glucose: 'mgdl', weight: 'kg' } }, NOW);

test('успешное восстановление: новые данные записаны, снимок текущих сохранён', async () => {
  const current = currentState();
  const store = memory(seedFrom(current));
  const r = await restoreFromBackup(store, incomingText, current, NOW);
  assert.equal(r.ok, true);
  assert.deepEqual(r.data.records.map((x) => x.id), ['new1']);
  assert.deepEqual(JSON.parse(store.data.get(STORAGE.records)).map((x) => x.id), ['new1']);
  assert.deepEqual(JSON.parse(store.data.get(STORAGE.units)), { glucose: 'mgdl', weight: 'kg' });
  const snapshot = JSON.parse(store.data.get(STORAGE.undo));
  assert.deepEqual(snapshot.records.map((x) => x.id), ['old1', 'old2']);
});

test('неверный файл: ничего не меняется и снимок не создаётся', async () => {
  const current = currentState();
  const store = memory(seedFrom(current));
  const before = new Map(store.data);
  const r = await restoreFromBackup(store, '{"app":"health-diary","version":1,"records":[{"id":"x"}],"meds":[],"intake":[]}', current, NOW);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'err_backup_invalid');
  assert.deepEqual(store.data, before);
});

test('ошибка снимка: восстановление не начинается', async () => {
  const current = currentState();
  const store = memory(seedFrom(current), { failSnapshot: true });
  const before = new Map(store.data);
  const r = await restoreFromBackup(store, incomingText, current, NOW);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'err_restore_snapshot');
  assert.deepEqual(store.data, before);
});

test('ошибка записи посреди восстановления: старые значения возвращаются', async () => {
  const current = currentState();
  const store = memory(seedFrom(current), { failOn: STORAGE.meds });
  const r = await restoreFromBackup(store, incomingText, current, NOW);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'err_restore_write');
  assert.equal(store.data.get(STORAGE.records), seedFrom(current)[STORAGE.records]);
  assert.equal(store.data.get(STORAGE.meds), seedFrom(current)[STORAGE.meds]);
});

test('ошибка записи, когда раньше значения не было: ключ удаляется при откате', async () => {
  const current = { records: [], meds: [], intake: [], units: {} };
  const store = memory({}, { failOn: STORAGE.meds });
  const r = await restoreFromBackup(store, incomingText, current, NOW);
  assert.equal(r.ok, false);
  assert.equal(store.data.has(STORAGE.records), false);
});

test('отмена восстановления возвращает данные до восстановления', async () => {
  const current = currentState();
  const store = memory(seedFrom(current));
  await restoreFromBackup(store, incomingText, current, NOW);
  const u = await undoRestore(store, NOW);
  assert.equal(u.ok, true);
  assert.deepEqual(u.data.records.map((x) => x.id), ['old1', 'old2']);
  assert.deepEqual(JSON.parse(store.data.get(STORAGE.records)).map((x) => x.id), ['old1', 'old2']);
});

test('отмена без снимка: понятная ошибка, данные не трогаются', async () => {
  const store = memory(seedFrom(currentState()));
  const before = new Map(store.data);
  const u = await undoRestore(store, NOW);
  assert.equal(u.ok, false);
  assert.equal(u.error, 'err_restore_none');
  assert.deepEqual(store.data, before);
});

test('повреждённый снимок не применяется при отмене', async () => {
  const store = memory({ ...seedFrom(currentState()), [STORAGE.undo]: '{"app":"health-diary","version":1,"records":"x"}' });
  const before = new Map(store.data);
  const u = await undoRestore(store, NOW);
  assert.equal(u.ok, false);
  assert.deepEqual(store.data, before);
});
