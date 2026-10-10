import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDevice, RokuDevice, SamsungDevice } from '../src/index.mjs';

test('createDevice выбирает драйвер по бренду', () => {
  assert.ok(createDevice('roku', { host: '10.0.0.2' }) instanceof RokuDevice);
  assert.ok(createDevice('samsung', { host: '10.0.0.3' }) instanceof SamsungDevice);
});

test('неподдерживаемый бренд даёт понятную ошибку', () => {
  assert.throws(() => createDevice('tuvio-yandex', { host: '10.0.0.4' }), /не поддерживается/);
});
