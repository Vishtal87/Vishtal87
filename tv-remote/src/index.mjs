export { KEYS, UnsupportedKeyError } from './keys.mjs';
export { RokuDevice, ROKU_PORT } from './roku.mjs';
export { SamsungDevice, SAMSUNG_PORT } from './samsung.mjs';

import { RokuDevice } from './roku.mjs';
import { SamsungDevice } from './samsung.mjs';

// Единая точка создания драйвера по бренду. Новые бренды добавляются сюда отдельным модулем.
export function createDevice(brand, options) {
  switch (brand) {
    case 'roku':
      return new RokuDevice(options);
    case 'samsung':
      return new SamsungDevice(options);
    default:
      throw new Error(`Бренд пока не поддерживается: ${brand}`);
  }
}
