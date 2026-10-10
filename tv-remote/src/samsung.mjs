// Драйвер Samsung (Tizen) через WebSocket в локальной сети.
// Порт 8001 (ws) или 8002 (wss). При первом подключении телевизор просит подтвердить
// доступ на экране и присылает token; его нужно сохранить и передавать при следующих подключениях.
// Протокол описан сообществом, поведение на конкретной модели проверяем на реальном ТВ.
import { SAMSUNG_KEY_MAP, mapKey } from './keys.mjs';

export const SAMSUNG_PORT = 8001;
const APP_NAME = 'TVRemoteCore';

export class SamsungDevice {
  constructor({
    host,
    token = null,
    onToken = () => {},
    WebSocketImpl = globalThis.WebSocket,
    connectTimeoutMs = 5000,
  }) {
    if (!host) throw new Error('Нужен адрес телевизора (host)');
    this.host = host;
    this.token = token;
    this.onToken = onToken;
    this.WebSocketImpl = WebSocketImpl;
    this.connectTimeoutMs = connectTimeoutMs;
    this.ws = null;
  }

  url() {
    const name = Buffer.from(APP_NAME).toString('base64');
    const tokenPart = this.token ? `&token=${encodeURIComponent(this.token)}` : '';
    return `ws://${this.host}:${SAMSUNG_PORT}/api/v2/channels/samsung.remote.control?name=${name}${tokenPart}`;
  }

  // Открывает соединение и ждёт ms.channel.connect. Если пришёл token, передаём его наверх.
  connect() {
    if (this.ws) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const ws = new this.WebSocketImpl(this.url());
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error('Таймаут подключения к Samsung'));
      }, this.connectTimeoutMs);

      ws.onmessage = (event) => {
        let msg;
        try {
          msg = JSON.parse(String(event.data));
        } catch {
          return;
        }
        if (msg.event === 'ms.channel.connect') {
          clearTimeout(timer);
          const token = msg.data?.token;
          if (token && token !== this.token) {
            this.token = token;
            this.onToken(token);
          }
          this.ws = ws;
          resolve();
        }
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error('Ошибка соединения с Samsung'));
      };
      ws.onclose = () => {
        this.ws = null;
      };
    });
  }

  async sendKey(key) {
    const code = mapKey(SAMSUNG_KEY_MAP, key);
    if (!this.ws) await this.connect();
    this.ws.send(
      JSON.stringify({
        method: 'ms.remote.control',
        params: {
          Cmd: 'Click',
          DataOfCmd: code,
          Option: 'false',
          TypeOfRemote: 'SendRemoteKey',
        },
      }),
    );
  }

  close() {
    if (this.ws) this.ws.close();
    this.ws = null;
  }
}
