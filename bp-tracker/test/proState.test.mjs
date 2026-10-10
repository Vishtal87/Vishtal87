import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeProState, encodeProState, isProNow, nextProState, PRO_GRACE_MS } from '../src/proState.mjs';

const T0 = Date.parse('2026-10-10T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

test('нет сохранённого значения: Pro нет', () => {
  const s = decodeProState(null);
  assert.equal(isProNow(s, T0), false);
});

test('старый формат true/false: считается непроверенным, Pro не действует', () => {
  assert.equal(isProNow(decodeProState('true'), T0), false);
  assert.equal(decodeProState('false').active, false);
});

test('повреждённое значение: Pro нет, без падения', () => {
  assert.equal(isProNow(decodeProState('{не json'), T0), false);
  assert.equal(isProNow(decodeProState('{"active":"yes","checkedAt":1}'), T0), false);
  assert.equal(isProNow(decodeProState('{"active":true}'), T0), false);
});

test('успешная проверка «активна»: Pro действует в пределах срока', () => {
  const s = nextProState({ active: false, checkedAt: 0 }, 'active', T0);
  assert.equal(isProNow(s, T0 + 6 * DAY), true);
  assert.equal(isProNow(s, T0 + 8 * DAY), false);
});

test('нестабильная сеть (unknown) не продлевает срок', () => {
  const checked = nextProState({ active: false, checkedAt: 0 }, 'active', T0);
  const afterUnknown = nextProState(checked, 'unknown', T0 + 5 * DAY);
  assert.deepEqual(afterUnknown, checked);
  assert.equal(isProNow(afterUnknown, T0 + 8 * DAY), false);
});

test('магазин подтверждает «неактивна»: Pro сразу выключается', () => {
  const active = nextProState({ active: false, checkedAt: 0 }, 'active', T0);
  const expired = nextProState(active, 'inactive', T0 + DAY);
  assert.equal(isProNow(expired, T0 + DAY), false);
});

test('возврат в активное состояние после проверки снова открывает Pro', () => {
  const off = nextProState({ active: true, checkedAt: T0 }, 'inactive', T0 + DAY);
  const on = nextProState(off, 'active', T0 + 2 * DAY);
  assert.equal(isProNow(on, T0 + 2 * DAY), true);
});

test('часы назад: проверка «из будущего» не даёт Pro', () => {
  const s = { active: true, checkedAt: T0 + 5 * DAY };
  assert.equal(isProNow(s, T0), false);
});

test('тестовые сборки: ttl = Infinity, срок не истекает', () => {
  const s = { active: true, checkedAt: T0 };
  assert.equal(isProNow(s, T0 + 365 * DAY, Infinity), true);
});

test('запись и чтение обратимы', () => {
  const s = { active: true, checkedAt: T0 };
  assert.deepEqual(decodeProState(encodeProState(s)), s);
  assert.equal(PRO_GRACE_MS, 7 * DAY);
});
