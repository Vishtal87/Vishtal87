// Bluetooth-приборы по стандартным профилям (тонометр, глюкометр, весы). Нативная часть — react-native-ble-plx.
import { PermissionsAndroid, Platform } from 'react-native';
import { BleManager, State } from 'react-native-ble-plx';
import { DEVICE_KINDS, PARSERS, base64ToBytes } from './ble.mjs';

let manager = null;
function getManager() {
  if (!manager) manager = new BleManager();
  return manager;
}

// На Android 12+ нужны права на поиск и подключение. Старым версиям нужна геолокация (для поиска по Bluetooth).
export async function requestBlePermissions() {
  if (Platform.OS !== 'android') return true;
  if (Platform.Version >= 31) {
    const res = await PermissionsAndroid.requestMultiple([
      'android.permission.BLUETOOTH_SCAN',
      'android.permission.BLUETOOTH_CONNECT',
    ]);
    return Object.values(res).every((v) => v === PermissionsAndroid.RESULTS.GRANTED);
  }
  const res = await PermissionsAndroid.request('android.permission.ACCESS_FINE_LOCATION');
  return res === PermissionsAndroid.RESULTS.GRANTED;
}

export async function bluetoothPowered() {
  return (await getManager().state()) === State.PoweredOn;
}

// Какой прибор рекламирует устройство: по UUID сервиса. Возвращает ключ из DEVICE_KINDS или null.
export function kindOf(device) {
  const uuids = (device.serviceUUIDs ?? []).map((u) => String(u).toLowerCase());
  return Object.keys(DEVICE_KINDS).find((key) => uuids.includes(DEVICE_KINDS[key].service)) ?? null;
}

// Ищет приборы заданное время и возвращает найденные. Подписка на сканирование закрывается сама.
export function scanDevices(timeoutMs = 12000) {
  const m = getManager();
  const found = new Map();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      m.stopDeviceScan();
      resolve([...found.values()]);
    }, timeoutMs);
    m.startDeviceScan(Object.values(DEVICE_KINDS).map((k) => k.service), null, (error, device) => {
      if (error) {
        clearTimeout(timer);
        m.stopDeviceScan();
        reject(error);
        return;
      }
      if (device && kindOf(device) && !found.has(device.id)) found.set(device.id, device);
    }).catch(reject);
  });
}

// Подключается к прибору и подписывается на измерения. onValue получает разобранное значение.
// Возвращает функцию остановки: она отписывается и отключает прибор.
export async function listenMeasurements(deviceId, kindKey, onValue) {
  const m = getManager();
  const kind = DEVICE_KINDS[kindKey];
  const device = await m.connectToDevice(deviceId, { timeout: 15000 });
  await device.discoverAllServicesAndCharacteristics();
  const sub = m.monitorCharacteristicForService(kind.service, kind.characteristic, (error, ch) => {
    if (error || !ch?.value) return;
    const parsed = PARSERS[kindKey](base64ToBytes(ch.value));
    if (parsed) onValue(parsed);
  });
  return async () => {
    sub.remove();
    await m.cancelDeviceConnection(deviceId).catch(() => {});
  };
}
