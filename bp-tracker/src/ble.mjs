// Стандартные профили Bluetooth SIG: тонометр (0x1810), глюкометр (0x1808), весы (0x181D).
// Разбор байтов без нативных модулей, поэтому его можно проверить тестами.
import { TYPES } from './measurements.mjs';

const BASE = (short) => `0000${short}-0000-1000-8000-00805f9b34fb`;

export const DEVICE_KINDS = Object.freeze({
  bp: { type: TYPES.bp, service: BASE('1810'), characteristic: BASE('2a35') },
  glucose: { type: TYPES.glucose, service: BASE('1808'), characteristic: BASE('2a18') },
  weight: { type: TYPES.weight, service: BASE('181d'), characteristic: BASE('2a9d') },
});

// Base64 → байты (без зависимости от atob, которого может не быть в старых движках).
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function base64ToBytes(b64) {
  const clean = String(b64).replace(/=+$/, '');
  const out = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of clean) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) continue;
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

// SFLOAT: 12 бит мантиссы и 4 бита порядка. Служебные значения (NaN, бесконечность) возвращаем как null.
export function parseSfloat(lo, hi) {
  const raw = (hi << 8) | lo;
  if ([0x07ff, 0x0800, 0x07fe, 0x0801, 0x0802].includes(raw)) return null;
  let mantissa = raw & 0x0fff;
  if (mantissa >= 0x0800) mantissa -= 0x1000;
  let exponent = raw >> 12;
  if (exponent >= 0x08) exponent -= 0x10;
  return mantissa * 10 ** exponent;
}

const KPA_TO_MMHG = 7.50062;

// Blood Pressure Measurement (0x2A35): флаги, систолическое, диастолическое, MAP, [время], [пульс].
export function parseBloodPressure(bytes) {
  if (!bytes || bytes.length < 7) return null;
  const flags = bytes[0];
  const kpa = (flags & 0x01) !== 0;
  const sys = parseSfloat(bytes[1], bytes[2]);
  const dia = parseSfloat(bytes[3], bytes[4]);
  if (sys === null || dia === null) return null;
  let i = 7; // после MAP
  if (flags & 0x02) i += 7; // отметка времени
  let pulse = null;
  if (flags & 0x04 && bytes.length >= i + 2) pulse = parseSfloat(bytes[i], bytes[i + 1]);
  const k = kpa ? KPA_TO_MMHG : 1;
  return {
    systolic: Math.round(sys * k),
    diastolic: Math.round(dia * k),
    pulse: pulse === null ? null : Math.round(pulse),
  };
}

// Glucose Measurement (0x2A18): флаги, номер, базовое время, [смещение], концентрация. Возвращаем ммоль/л.
// Контекст (натощак, до еды и т. д.) в простом профиле не разбираем: пишем «другое».
export function parseGlucose(bytes) {
  if (!bytes || bytes.length < 10) return null;
  const flags = bytes[0];
  if (!(flags & 0x02)) return null;
  let i = 10; // флаги(1) + номер(2) + базовое время(7)
  if (flags & 0x01) i += 2;
  if (bytes.length < i + 2) return null;
  const conc = parseSfloat(bytes[i], bytes[i + 1]);
  if (conc === null) return null;
  const molar = (flags & 0x04) !== 0; // моль/л, иначе кг/л
  const mmol = molar ? conc * 1000 : (conc * 1e5) / 18.0156;
  return { value: Math.round(mmol * 10) / 10, context: 'other' };
}

// Weight Measurement (0x2A9D): флаги и вес. Единицы выбирает бит 0: 0 — килограммы (0.005 кг), 1 — фунты (0.01 фунта).
export function parseWeight(bytes) {
  if (!bytes || bytes.length < 3) return null;
  const flags = bytes[0];
  const raw = bytes[1] | (bytes[2] << 8);
  if (raw === 0xffff) return null;
  const kg = flags & 0x01 ? raw * 0.01 * 0.45359237 : raw * 0.005;
  return { value: Math.round(kg * 10) / 10 };
}

export const PARSERS = Object.freeze({ bp: parseBloodPressure, glucose: parseGlucose, weight: parseWeight });
