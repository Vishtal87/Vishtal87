// Драйвер Roku через External Control Protocol (ECP) по HTTP, порт 8060 в локальной сети.
// Документация: developer.roku.com (External Control API).
import { ROKU_KEY_MAP, mapKey } from './keys.mjs';

export const ROKU_PORT = 8060;

export class RokuDevice {
  constructor({ host, fetchImpl = globalThis.fetch, timeoutMs = 3000 }) {
    if (!host) throw new Error('Нужен адрес телевизора (host)');
    this.host = host;
    this.baseUrl = `http://${host}:${ROKU_PORT}`;
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async #request(path, { method = 'GET' } = {}) {
    const res = await this.fetch(`${this.baseUrl}${path}`, {
      method,
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) {
      throw new Error(`Roku ${method} ${path} вернул HTTP ${res.status}`);
    }
    return res;
  }

  async sendKey(key) {
    const code = mapKey(ROKU_KEY_MAP, key);
    await this.#request(`/keypress/${encodeURIComponent(code)}`, { method: 'POST' });
  }

  // Включение и выключение по ECP: отдельные команды, без «переключателя».
  async powerOn() {
    await this.#request('/keypress/PowerOn', { method: 'POST' });
  }

  async powerOff() {
    await this.#request('/keypress/PowerOff', { method: 'POST' });
  }

  // Ответ — XML с полями, в том числе <model-name> и <friendly-device-name>.
  async deviceInfo() {
    const res = await this.#request('/query/device-info');
    const xml = await res.text();
    return {
      modelName: matchTag(xml, 'model-name'),
      friendlyName: matchTag(xml, 'friendly-device-name'),
      serial: matchTag(xml, 'serial-number'),
    };
  }
}

function matchTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
  return m ? m[1] : null;
}
