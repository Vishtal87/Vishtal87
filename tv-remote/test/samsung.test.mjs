import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SamsungDevice } from '../src/samsung.mjs';
import { KEYS, UnsupportedKeyError } from '../src/keys.mjs';

// Подменный WebSocket: сам отправляет ms.channel.connect при создании и запоминает отправленное.
function makeWsClass({ token = 'TOKEN-1', autoConnect = true, fail = false } = {}) {
  const instances = [];
  class FakeWS {
    constructor(url) {
      this.url = url;
      this.sent = [];
      this.closed = false;
      instances.push(this);
      setTimeout(() => {
        if (fail) return this.onerror?.();
        if (autoConnect) {
          this.onmessage?.({
            data: JSON.stringify({
              event: 'ms.channel.connect',
              data: token ? { token } : {},
            }),
          });
        }
      }, 0);
    }
    send(data) {
      this.sent.push(JSON.parse(data));
    }
    close() {
      this.closed = true;
      this.onclose?.();
    }
  }
  return { FakeWS, instances };
}

test('URL содержит base64-имя приложения и порт 8001', () => {
  const { FakeWS } = makeWsClass();
  const tv = new SamsungDevice({ host: '192.168.1.60', WebSocketImpl: FakeWS });
  const url = tv.url();
  assert.ok(url.startsWith('ws://192.168.1.60:8001/api/v2/channels/samsung.remote.control?name='));
  assert.ok(url.includes(Buffer.from('TVRemoteCore').toString('base64')));
  assert.ok(!url.includes('token='));
});

test('после подтверждения на ТВ токен передаётся наверх и попадает в следующий URL', async () => {
  const saved = [];
  const { FakeWS } = makeWsClass({ token: 'SECRET-42' });
  const tv = new SamsungDevice({
    host: '192.168.1.60',
    WebSocketImpl: FakeWS,
    onToken: (t) => saved.push(t),
  });
  await tv.connect();
  assert.deepEqual(saved, ['SECRET-42']);
  assert.ok(tv.url().includes('&token=SECRET-42'));
});

test('sendKey отправляет команду ms.remote.control с кодом Samsung', async () => {
  const { FakeWS, instances } = makeWsClass();
  const tv = new SamsungDevice({ host: '192.168.1.60', WebSocketImpl: FakeWS });
  await tv.sendKey(KEYS.VOLUME_DOWN);
  const ws = instances[0];
  assert.deepEqual(ws.sent[0], {
    method: 'ms.remote.control',
    params: { Cmd: 'Click', DataOfCmd: 'KEY_VOLDOWN', Option: 'false', TypeOfRemote: 'SendRemoteKey' },
  });
  tv.close();
});

test('неизвестная кнопка Samsung даёт UnsupportedKeyError', async () => {
  const { FakeWS } = makeWsClass();
  const tv = new SamsungDevice({ host: '192.168.1.60', WebSocketImpl: FakeWS });
  await assert.rejects(() => tv.sendKey('nope'), UnsupportedKeyError);
  tv.close();
});

test('таймаут подключения отклоняет промис', async () => {
  class Silent {
    constructor() {
      this.closed = false;
    }
    close() {
      this.closed = true;
    }
  }
  const tv = new SamsungDevice({ host: '192.168.1.60', WebSocketImpl: Silent, connectTimeoutMs: 20 });
  await assert.rejects(() => tv.connect(), /Таймаут/);
});

test('ошибка сокета отклоняет подключение', async () => {
  const { FakeWS } = makeWsClass({ fail: true });
  const tv = new SamsungDevice({ host: '192.168.1.60', WebSocketImpl: FakeWS, connectTimeoutMs: 500 });
  await assert.rejects(() => tv.connect(), /Ошибка соединения/);
});
