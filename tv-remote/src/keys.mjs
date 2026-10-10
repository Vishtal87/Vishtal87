// Единые названия кнопок приложения. Каждый драйвер переводит их в код своего бренда.
export const KEYS = Object.freeze({
  UP: 'up',
  DOWN: 'down',
  LEFT: 'left',
  RIGHT: 'right',
  OK: 'ok',
  BACK: 'back',
  HOME: 'home',
  VOLUME_UP: 'volumeUp',
  VOLUME_DOWN: 'volumeDown',
  MUTE: 'mute',
});

export const ROKU_KEY_MAP = Object.freeze({
  [KEYS.UP]: 'Up',
  [KEYS.DOWN]: 'Down',
  [KEYS.LEFT]: 'Left',
  [KEYS.RIGHT]: 'Right',
  [KEYS.OK]: 'Select',
  [KEYS.BACK]: 'Back',
  [KEYS.HOME]: 'Home',
  [KEYS.VOLUME_UP]: 'VolumeUp',
  [KEYS.VOLUME_DOWN]: 'VolumeDown',
  [KEYS.MUTE]: 'VolumeMute',
});

export const SAMSUNG_KEY_MAP = Object.freeze({
  [KEYS.UP]: 'KEY_UP',
  [KEYS.DOWN]: 'KEY_DOWN',
  [KEYS.LEFT]: 'KEY_LEFT',
  [KEYS.RIGHT]: 'KEY_RIGHT',
  [KEYS.OK]: 'KEY_ENTER',
  [KEYS.BACK]: 'KEY_RETURN',
  [KEYS.HOME]: 'KEY_HOME',
  [KEYS.VOLUME_UP]: 'KEY_VOLUP',
  [KEYS.VOLUME_DOWN]: 'KEY_VOLDOWN',
  [KEYS.MUTE]: 'KEY_MUTE',
});

export class UnsupportedKeyError extends Error {
  constructor(key) {
    super(`Неизвестная кнопка: ${key}`);
    this.name = 'UnsupportedKeyError';
  }
}

export function mapKey(map, key) {
  const code = map[key];
  if (!code) throw new UnsupportedKeyError(key);
  return code;
}
