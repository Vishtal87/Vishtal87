import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RokuDevice } from '../src/roku.mjs';
import { UnsupportedKeyError, KEYS } from '../src/keys.mjs';

function fakeFetch(handler) {
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    calls.push({ url, method: opts.method ?? 'GET' });
    return handler(url, opts);
  };
  return { fetchImpl, calls };
}

const ok = (body = '') => ({ ok: true, status: 200, text: async () => body });

test('sendKey шлёт POST на /keypress с кодом Roku', async () => {
  const { fetchImpl, calls } = fakeFetch(() => ok());
  const tv = new RokuDevice({ host: '192.168.1.50', fetchImpl });
  await tv.sendKey(KEYS.VOLUME_UP);
  assert.deepEqual(calls, [{ url: 'http://192.168.1.50:8060/keypress/VolumeUp', method: 'POST' }]);
});

test('кнопка OK переводится в Select', async () => {
  const { fetchImpl, calls } = fakeFetch(() => ok());
  const tv = new RokuDevice({ host: '10.0.0.2', fetchImpl });
  await tv.sendKey(KEYS.OK);
  assert.equal(calls[0].url, 'http://10.0.0.2:8060/keypress/Select');
});

test('неизвестная кнопка даёт UnsupportedKeyError и не уходит в сеть', async () => {
  const { fetchImpl, calls } = fakeFetch(() => ok());
  const tv = new RokuDevice({ host: '10.0.0.2', fetchImpl });
  await assert.rejects(() => tv.sendKey('nonexistent'), UnsupportedKeyError);
  assert.equal(calls.length, 0);
});

test('HTTP-ошибка от телевизора превращается в исключение', async () => {
  const { fetchImpl } = fakeFetch(() => ({ ok: false, status: 500 }));
  const tv = new RokuDevice({ host: '10.0.0.2', fetchImpl });
  await assert.rejects(() => tv.sendKey(KEYS.UP), /HTTP 500/);
});

test('powerOn и powerOff — отдельные команды ECP', async () => {
  const { fetchImpl, calls } = fakeFetch(() => ok());
  const tv = new RokuDevice({ host: '10.0.0.2', fetchImpl });
  await tv.powerOn();
  await tv.powerOff();
  assert.deepEqual(
    calls.map((c) => c.url),
    ['http://10.0.0.2:8060/keypress/PowerOn', 'http://10.0.0.2:8060/keypress/PowerOff'],
  );
});

test('deviceInfo разбирает XML ответа', async () => {
  const xml = `<device-info><model-name>3940X</model-name><friendly-device-name>Гостиная</friendly-device-name><serial-number>ABC123</serial-number></device-info>`;
  const { fetchImpl } = fakeFetch(() => ok(xml));
  const tv = new RokuDevice({ host: '10.0.0.2', fetchImpl });
  assert.deepEqual(await tv.deviceInfo(), {
    modelName: '3940X',
    friendlyName: 'Гостиная',
    serial: 'ABC123',
  });
});

test('пустой host запрещён', () => {
  assert.throws(() => new RokuDevice({ host: '' }), /host/);
});
