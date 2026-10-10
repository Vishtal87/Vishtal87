import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planImport, normalizeSeen, SEEN_KEEP_MS } from '../src/hcImport.mjs';
import { pendingRecords } from '../src/healthSync.mjs';
import { TYPES } from '../src/measurements.mjs';

const NOW = Date.parse('2026-10-10T12:00:00Z');
const bpIn = (sourceId, takenAt = NOW - 3600e3, systolic = 120, diastolic = 80) => ({
  sourceId,
  type: TYPES.bp,
  takenAt,
  input: { systolic, diastolic, pulse: '' },
});
const manual = (id, takenAt, systolic = 120, diastolic = 80) => ({
  id,
  type: TYPES.bp,
  takenAt,
  values: { systolic, diastolic, pulse: null },
});

test('новые записи добавляются с пометкой «из Здоровья»', () => {
  const p = planImport({ incoming: [bpIn('a'), bpIn('b', NOW - 7200e3, 130, 85)], records: [], seen: [], now: NOW });
  assert.equal(p.counts.added, 2);
  assert.ok(p.added.every((r) => r.source === 'health'));
  assert.deepEqual(p.seen.map((s) => s.id), ['a', 'b']);
});

test('повторный запуск с теми же записями ничего не добавляет', () => {
  const first = planImport({ incoming: [bpIn('a')], records: [], seen: [], now: NOW });
  const second = planImport({ incoming: [bpIn('a')], records: first.added, seen: first.seen, now: NOW + 60e3 });
  assert.equal(second.counts.added, 0);
  assert.equal(second.counts.duplicate, 1);
});

test('ручная запись того же измерения (± 60 с, то же значение) не дублируется', () => {
  const stored = [manual('m1', NOW - 3600e3 + 30e3)];
  const p = planImport({ incoming: [bpIn('a')], records: stored, seen: [], now: NOW });
  assert.equal(p.counts.added, 0);
  assert.equal(p.counts.matched, 1);
  assert.deepEqual(p.seen.map((s) => s.id), ['a']); // запоминаем, чтобы не сравнивать снова
});

test('то же время, другое значение — это другое измерение, добавляем', () => {
  const stored = [manual('m1', NOW - 3600e3, 150, 95)];
  const p = planImport({ incoming: [bpIn('a')], records: stored, seen: [], now: NOW });
  assert.equal(p.counts.added, 1);
});

test('другой тип измерения с тем же временем не считается совпадением', () => {
  const stored = [{ id: 'g1', type: TYPES.glucose, takenAt: NOW - 3600e3, values: { value: 120, context: 'other' } }];
  const p = planImport({ incoming: [bpIn('a')], records: stored, seen: [], now: NOW });
  assert.equal(p.counts.added, 1);
});

test('дубль внутри одной пачки добавляется один раз', () => {
  const p = planImport({ incoming: [bpIn('a'), bpIn('b')], records: [], seen: [], now: NOW });
  assert.equal(p.counts.added, 1);
  assert.equal(p.counts.matched, 1);
});

test('запись, не прошедшая проверку, не запоминается и будет проверена снова', () => {
  const bad = { sourceId: 'bad', type: TYPES.bp, takenAt: NOW - 3600e3, input: { systolic: 999, diastolic: 80, pulse: '' } };
  const first = planImport({ incoming: [bad], records: [], seen: [], now: NOW });
  assert.equal(first.counts.invalid, 1);
  assert.equal(first.seen.some((s) => s.id === 'bad'), false);
  // Если правила проверки позже изменились и запись стала корректной — она импортируется.
  const fixed = { ...bad, input: { systolic: 110, diastolic: 70, pulse: '' } };
  const second = planImport({ incoming: [fixed], records: [], seen: first.seen, now: NOW });
  assert.equal(second.counts.added, 1);
});

test('старые id удаляются из списка после срока хранения', () => {
  const old = [{ id: 'old', at: NOW - SEEN_KEEP_MS - 1 }, { id: 'fresh', at: NOW - 1000 }];
  const p = planImport({ incoming: [], records: [], seen: old, now: NOW });
  assert.deepEqual(p.seen.map((s) => s.id), ['fresh']);
});

test('старый формат списка id (строки) переводится в новый', () => {
  assert.deepEqual(normalizeSeen(['x', 'y'], NOW), [{ id: 'x', at: NOW }, { id: 'y', at: NOW }]);
  assert.deepEqual(normalizeSeen(undefined, NOW), []);
  assert.deepEqual(normalizeSeen([{ id: 'z', at: 5 }, null, 3], NOW), [{ id: 'z', at: 5 }]);
});

test('импортированные записи не отправляются обратно в Health Connect', () => {
  const records = [
    { id: 'own', type: TYPES.bp, takenAt: NOW, values: { systolic: 120, diastolic: 80, pulse: null } },
    { id: 'imp', type: TYPES.bp, takenAt: NOW, values: { systolic: 121, diastolic: 81, pulse: null }, source: 'health' },
  ];
  assert.deepEqual(pendingRecords(records, []).map((r) => r.id), ['own']);
});
