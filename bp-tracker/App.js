import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useColorScheme,
  Platform,
  Vibration,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import * as HealthConnect from 'react-native-health-connect';
import * as Notifications from 'expo-notifications';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useIAP, isUserCancelledError } from 'expo-iap';
import { classify, parseTakenAt, formatTakenAt } from './src/bp.mjs';
import {
  TYPES,
  GLUCOSE_CONTEXTS,
  validateMeasurement,
  makeRecord,
  migrateRecords,
  formatValue,
  unitLabel,
  ofType,
  sortNewestFirst,
  toCsvRecords,
  toInputUnits,
} from './src/measurements.mjs';
import { validateMed, makeMed } from './src/meds.mjs';
import { PRO_FEATURES, isUnlocked } from './src/entitlements.mjs';
import { INTAKE_STATUS, toggleIntake, statusFor, dateKey } from './src/intake.mjs';
import { buildBackup, parseBackup } from './src/backup.mjs';
import { restoreFromBackup, undoRestore, hasUndo, STORAGE } from './src/restore.mjs';
import { buildReportHtml } from './src/report.mjs';
import { toHealthRecord, pendingRecords, healthTypeFor, fromHealthRecord, ALL_PERMISSIONS, READ_PERMISSIONS } from './src/healthSync.mjs';
import { planImport, normalizeSeen } from './src/hcImport.mjs';
import { canAddReminder, reminderSlots } from './src/reminders.mjs';
import { DEVICE_KINDS } from './src/ble.mjs';
import { ruStoreAvailable, ruStorePlans, ruStoreActive, ruStoreBuy, isRuStoreCancel } from './src/rustore.js';
import { requestBlePermissions, bluetoothPowered, scanDevices, kindOf, listenMeasurements } from './src/devices.js';
import { chartPoints, scaleRange } from './src/chart.mjs';
import { PRIVACY_URL, TERMS_URL } from './src/links.mjs';
import { PRO_PLANS, PRO_SKUS, sortPlans, buildSubscriptionRequest } from './src/purchases.mjs';
import { decodeProState, encodeProState, isProNow, nextProState, PRO_GRACE_MS } from './src/proState.mjs';
import { translate, localeTag, detectLanguage, LANGUAGES } from './src/i18n.mjs';

const RECORDS_KEY = STORAGE.records;
const OLD_BP_KEY = 'bp-readings-v1';
const LANG_KEY = 'bp-lang-v1';
const UNITS_KEY = STORAGE.units;
const MEDS_KEY = STORAGE.meds;
const PRO_KEY = 'pro-v1';
const INTAKE_KEY = STORAGE.intake;
const HC_SYNCED_KEY = 'hc-synced-v1';
const HC_IMPORT_KEY = 'hc-imported-v1';
const REMINDER_CHANNEL = 'medicine';
const DAY = 24 * 60 * 60 * 1000;
const CHART_POINTS = 30;
const CHART_MIN = 40;
const CHART_MAX = 200;
const CHART_HEIGHT = 220;

const CATEGORY_COLORS = {
  normal: '#A3FF12',
  elevated: '#FFE600',
  stage1: '#FF9F1C',
  stage2: '#FF4D6D',
  crisis: '#7A0000',
};

// Необрутализм: толстые рамки, плоские яркие цвета, жёсткие тени. В тёмной теме рамки и тени белые.
const LIGHT = { bg: '#FFF6D6', card: '#FFFFFF', text: '#000000', muted: '#3f3f46', border: '#000000', shadow: '#000000', accent: '#FF3D8B', inputBg: '#FFFFFF', tabBar: '#FFFFFF' };
const DARK = { bg: '#121212', card: '#1E1E1E', text: '#FFFFFF', muted: '#D4D4D8', border: '#FFFFFF', shadow: '#FFFFFF', accent: '#FFE600', inputBg: '#262626', tabBar: '#1E1E1E' };
const LINE = 3;
// Тестовый переключатель Pro есть только в разработке и в сборке с флагом EXPO_PUBLIC_TEST_PRO=1.
// Магазинные сборки этот флаг не получают.
const TEST_PRO_BUILD = process.env.EXPO_PUBLIC_TEST_PRO === '1';
const SHOW_TEST_PRO = __DEV__ || TEST_PRO_BUILD;
const SHADOW = 6;

// Показ напоминаний на экране и в шторке, когда приложение открыто.
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

const TABS = [
  { key: 'input', label: 'tabInput', icon: 'add-circle-outline' },
  { key: 'history', label: 'tabHistory', icon: 'list-outline' },
  { key: 'charts', label: 'tabCharts', icon: 'bar-chart-outline' },
  { key: 'meds', label: 'tabMeds', icon: 'medkit-outline' },
];

const TYPE_ICONS = { bp: 'heart-outline', glucose: 'water-outline', weight: 'scale-outline' };

export default function App() {
  const scheme = useColorScheme();
  const t = scheme === 'dark' ? DARK : LIGHT;
  const [lang, setLang] = useState(detectLanguage(Intl.DateTimeFormat().resolvedOptions().locale));
  const tr = (key, vars) => translate(lang, key, vars);
  const [tab, setTab] = useState('input');
  const [type, setType] = useState(TYPES.bp);
  const [historyFilter, setHistoryFilter] = useState('all');
  const [chartType, setChartType] = useState(TYPES.bp);
  const [records, setRecords] = useState([]);
  const [meds, setMeds] = useState([]);
  const [units, setUnits] = useState({ glucose: 'mmol', weight: 'kg' });
  const [loaded, setLoaded] = useState(false);

  const [systolic, setSystolic] = useState('');
  const [diastolic, setDiastolic] = useState('');
  const [pulse, setPulse] = useState('');
  const [value, setValue] = useState('');
  const [context, setContext] = useState('fasting');
  const [when, setWhen] = useState('');
  const [error, setError] = useState(null);
  const [editingId, setEditingId] = useState(null);

  const [medName, setMedName] = useState('');
  const [medTimes, setMedTimes] = useState('');
  const [medError, setMedError] = useState(null);
  const [editingMedId, setEditingMedId] = useState(null);
  // Статус Pro: { active, checkedAt }. Действует ограниченное время без новой проверки в магазине.
  const [proState, setProState] = useState(decodeProState(null));
  // Тестовые сборки и режим разработки не отключают Pro по сроку.
  const proTtl = TEST_PRO_BUILD || __DEV__ ? Infinity : PRO_GRACE_MS;
  const isPro = isProNow(proState, Date.now(), proTtl);
  // Магазин: null — ещё не известно, true — RuStore (Android), false — App Store / Google Play.
  const [ruStore, setRuStore] = useState(null);
  // Покупки магазина. Результат покупки приходит в обработчики, а не в возвращаемое значение.
  const iap = useIAP({
    onPurchaseSuccess: async (purchase) => {
      try {
        await iap.finishTransaction({ purchase, isConsumable: false });
      } catch (e) {
        // Транзакция останется в очереди магазина и закроется при следующем запуске.
      }
      commitCheck('active');
      Alert.alert(tr('subscribeTitle'), tr('purchaseDone'));
    },
    onPurchaseError: (e) => {
      if (!isUserCancelledError(e)) Alert.alert(tr('subscribeTitle'), tr('purchaseFailed'));
    },
  });
  const [intake, setIntakeList] = useState([]);
  const [reportDays, setReportDays] = useState(30);
  const [hcSynced, setHcSynced] = useState([]);
  const [hcReady, setHcReady] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [devices, setDevices] = useState([]);
  const [deviceStatus, setDeviceStatus] = useState(null);
  const stopListeningRef = useRef(null);

  // Есть ли снимок для отмены восстановления (сохраняется между запусками).
  useEffect(() => {
    refreshCanUndo();
  }, []);

  // При уходе с экрана отключаем прибор, если к нему подключены.
  useEffect(() => () => {
    if (stopListeningRef.current) stopListeningRef.current();
  }, []);

  useEffect(() => {
    (async () => {
      const [rawNew, rawOld, rawLang, rawUnits, rawMeds] = await Promise.all([
        AsyncStorage.getItem(RECORDS_KEY),
        AsyncStorage.getItem(OLD_BP_KEY),
        AsyncStorage.getItem(LANG_KEY),
        AsyncStorage.getItem(UNITS_KEY),
        AsyncStorage.getItem(MEDS_KEY),
      ]);
      if (rawNew) setRecords(JSON.parse(rawNew));
      else if (rawOld) setRecords(migrateRecords(JSON.parse(rawOld)));
      if (rawLang && LANGUAGES.includes(rawLang)) setLang(rawLang);
      if (rawUnits) setUnits(JSON.parse(rawUnits));
      if (rawMeds) setMeds(JSON.parse(rawMeds));
      setLoaded(true);
    })().catch(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (!loaded) return;
    AsyncStorage.setItem(RECORDS_KEY, JSON.stringify(records)).catch(() => {});
  }, [records, loaded]);

  useEffect(() => {
    if (!loaded) return;
    AsyncStorage.setItem(MEDS_KEY, JSON.stringify(meds)).catch(() => {});
  }, [meds, loaded]);

  useEffect(() => {
    AsyncStorage.multiGet([PRO_KEY, INTAKE_KEY]).then((pairs) => {
      const [pro, intakeRaw] = pairs.map((p) => p[1]);
      if (pro === null && TEST_PRO_BUILD) setProState({ active: true, checkedAt: Date.now() });
      else setProState(decodeProState(pro));
      if (intakeRaw) setIntakeList(JSON.parse(intakeRaw));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    AsyncStorage.setItem(INTAKE_KEY, JSON.stringify(intake)).catch(() => {});
  }, [intake]);

  useEffect(() => {
    AsyncStorage.getItem(HC_SYNCED_KEY).then((raw) => {
      if (raw) setHcSynced(JSON.parse(raw));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    AsyncStorage.setItem(HC_SYNCED_KEY, JSON.stringify(hcSynced)).catch(() => {});
  }, [hcSynced]);

  // Health Connect есть только на Android. Если разрешение уже выдано, сразу показываем «Синхронизировать».
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    (async () => {
      const ok = await HealthConnect.initialize();
      if (!ok) return;
      const granted = await HealthConnect.getGrantedPermissions();
      setHcReady(granted.some((p) => p.accessType === 'write'));
    })().catch(() => {});
  }, []);

  // Канал уведомлений на Android. Название берём на текущем языке.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    Notifications.setNotificationChannelAsync(REMINDER_CHANNEL, {
      name: translate(lang, 'reminderChannel'),
      importance: Notifications.AndroidImportance.HIGH,
    }).catch(() => {});
  }, [lang]);

  // Напоминания пересоздаются при каждом изменении списка лекарств.
  useEffect(() => {
    if (!loaded) return;
    scheduleReminders(meds, (key, vars) => translate(lang, key, vars)).catch(() => {});
  }, [meds, loaded, lang]);

  // Поиск приборов по Bluetooth: тонометр, глюкометр, весы со стандартными профилями.
  async function searchDevices() {
    setDevices([]);
    setDeviceStatus(tr('devicesSearching'));
    try {
      if (!(await requestBlePermissions())) return setDeviceStatus(tr('blePermission'));
      if (!(await bluetoothPowered())) return setDeviceStatus(tr('bleOff'));
      const found = await scanDevices(12000);
      setDevices(found.map((d) => ({ id: d.id, name: d.localName || d.name || d.id, kind: kindOf(d) })).filter((d) => d.kind));
      setDeviceStatus(found.length ? tr('devicesFound', { n: found.length }) : tr('devicesNone'));
    } catch (e) {
      setDeviceStatus(tr('devFailed'));
    }
  }

  // Подключаемся к прибору и записываем каждое измерение. Слушаем минуту, потом отключаемся.
  async function listenTo(device) {
    if (stopListeningRef.current) {
      await stopListeningRef.current();
      stopListeningRef.current = null;
    }
    setDeviceStatus(tr('devWaiting'));
    try {
      const stop = await listenMeasurements(device.id, device.kind, (parsed) => {
        const kind = DEVICE_KINDS[device.kind];
        const input = device.kind === 'bp'
          ? { systolic: parsed.systolic, diastolic: parsed.diastolic, pulse: parsed.pulse ?? '' }
          : device.kind === 'glucose'
            ? { value: parsed.value, context: parsed.context }
            : { value: parsed.value };
        const check = validateMeasurement(kind.type, input, { glucose: 'mmol', weight: 'kg' });
        if (check.error) return;
        const rec = { ...makeRecord(kind.type, check.values, Date.now()), source: 'device' };
        setRecords((prev) => [rec, ...prev]);
        setDeviceStatus(tr('devGot', { value: formatValue(rec, units) }));
      });
      stopListeningRef.current = stop;
      setTimeout(async () => {
        if (stopListeningRef.current !== stop) return;
        await stop();
        stopListeningRef.current = null;
        setDeviceStatus(tr('devTimeout'));
      }, 60000);
    } catch (e) {
      setDeviceStatus(tr('devFailed'));
    }
  }

  async function hcConnect() {
    if (Platform.OS !== 'android') return;
    try {
      const ok = await HealthConnect.initialize();
      if (!ok) return Alert.alert(tr('hcTitle'), tr('hcUnavailable'));
      const granted = await HealthConnect.requestPermission(ALL_PERMISSIONS);
      if (!granted || granted.length === 0) return Alert.alert(tr('hcTitle'), tr('hcDenied'));
      setHcReady(true);
      await hcSync();
    } catch (e) {
      Alert.alert(tr('hcTitle'), String(e.message ?? e));
    }
  }

  // Синхронизация в обе стороны: сначала отправляем свои записи, потом забираем чужие из «Здоровья».
  async function hcSync() {
    const todo = pendingRecords(records, hcSynced);
    const sent = [];
    try {
      for (let i = 0; i < todo.length; i += 100) {
        const batch = todo.slice(i, i + 100);
        await HealthConnect.insertRecords(batch.map(toHealthRecord));
        sent.push(...batch.map((r) => r.id));
      }
    } finally {
      if (sent.length) setHcSynced((prev) => [...prev, ...sent]);
    }
    let imported = 0;
    let importError = null;
    try {
      imported = await hcImport();
    } catch (e) {
      importError = String(e.message ?? e);
    }
    const lines = [tr('hcDone', { n: sent.length })];
    lines.push(importError ? tr('hcImportFailed') : tr('hcImported', { n: imported }));
    Alert.alert(tr('hcTitle'), lines.join('\n'));
  }

  // Забираем давление, сахар и вес, которые записали другие приложения или приборы.
  // Правила дедупликации и повторной проверки — в src/hcImport.mjs.
  async function hcImport() {
    const granted = await HealthConnect.getGrantedPermissions();
    if (!granted.some((p) => p.accessType === 'read')) {
      await HealthConnect.requestPermission(READ_PERMISSIONS);
    }
    const now = Date.now();
    const raw = await AsyncStorage.getItem(HC_IMPORT_KEY).catch(() => null);
    const state = raw ? JSON.parse(raw) : { done: false, seen: [] };
    const seen = normalizeSeen(state.seen, now);
    // Первый импорт берёт 90 дней, дальше — последние 7: поздно синхронизированные измерения тоже попадут.
    const since = new Date(now - (state.done ? 7 : 90) * DAY).toISOString();
    const incoming = [];
    for (const recordType of ['BloodPressure', 'BloodGlucose', 'Weight']) {
      let pageToken;
      do {
        const res = await HealthConnect.readRecords(recordType, {
          timeRangeFilter: { operator: 'after', startTime: since },
          pageSize: 1000,
          pageToken,
        });
        for (const r of res.records) {
          const rec = fromHealthRecord({ ...r, recordType });
          if (rec) incoming.push(rec);
        }
        pageToken = res.pageToken;
      } while (pageToken);
    }
    const plan = planImport({ incoming, records, seen, now });
    // Сначала записи, потом список обработанных id: если сохранение прервётся, при повторе ручные записи
    // защитят от дублей (сопоставление по времени и значению).
    if (plan.added.length) setRecords((prev) => [...plan.added, ...prev]);
    await AsyncStorage.setItem(HC_IMPORT_KEY, JSON.stringify({ done: true, seen: plan.seen })).catch(() => {});
    return plan.counts.added;
  }

  // Записываем результат проверки магазина. 'unknown' (сеть или магазин недоступны) статус не меняет.
  function commitCheck(check) {
    const next = nextProState(proState, check, Date.now());
    if (next === proState) return;
    setProState(next);
    AsyncStorage.setItem(PRO_KEY, encodeProState(next)).catch(() => {});
  }

  // Проверка подписки в магазине: 'active', 'inactive' или 'unknown'.
  // rustore: true — RuStore, false — App Store / Google Play, null — магазин ещё не определён.
  async function checkStore(rustore) {
    try {
      if (rustore === null) return 'unknown';
      if (rustore) return (await ruStoreActive()) ? 'active' : 'inactive';
      if (!iap.connected) return 'unknown';
      return (await iap.hasActiveSubscriptions(PRO_SKUS)) ? 'active' : 'inactive';
    } catch (e) {
      return 'unknown';
    }
  }

  // Ссылка на последнюю версию проверки: обработчик возврата в приложение вызывает её с актуальным состоянием.
  const recheckRef = useRef(null);
  recheckRef.current = () => checkStore(ruStore).then(commitCheck);

  // Определяем магазин: RuStore на Android, если он установлен. Иначе App Store или Google Play.
  useEffect(() => {
    ruStoreAvailable().then((available) => {
      setRuStore(available);
      if (available) checkStore(true).then(commitCheck);
    });
  }, []);

  // Для App Store и Google Play: тарифы и проверка подписки, когда магазин подключился.
  useEffect(() => {
    if (!iap.connected || ruStore !== false) return;
    iap.fetchProducts({ skus: PRO_SKUS, type: 'subs' }).catch(() => {});
    checkStore(false).then(commitCheck);
  }, [iap.connected, ruStore]);

  // Возврат в приложение: подписку могли отменить, продлить или вернуть. Проверяем заново.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && recheckRef.current) recheckRef.current();
    });
    return () => sub.remove();
  }, []);

  async function openPaywall() {
    const plans = ruStore ? await ruStorePlans().catch(() => []) : sortPlans(iap.subscriptions);
    if (plans.length === 0) return Alert.alert(tr('subscribeTitle'), tr('subscribeNotReady'));
    const buttons = plans.map((product) => ({
      text: `${tr(product.id === PRO_PLANS.yearly ? 'planYearly' : 'planMonthly')} — ${product.displayPrice}`,
      onPress: () => buyPlan(product),
    }));
    buttons.push({ text: tr('cancel'), style: 'cancel' });
    Alert.alert(tr('subscribeTitle'), `${tr('subscribeIncludes')}\n\n${tr('subscribeTerms')}`, buttons);
  }

  async function buyPlan(product) {
    if (ruStore) {
      try {
        await ruStoreBuy(product.id);
        commitCheck('active');
        Alert.alert(tr('subscribeTitle'), tr('purchaseDone'));
      } catch (e) {
        if (!isRuStoreCancel(e)) Alert.alert(tr('subscribeTitle'), tr('purchaseFailed'));
      }
      return;
    }
    const request = buildSubscriptionRequest(product, Platform.OS);
    if (!request) return Alert.alert(tr('subscribeTitle'), tr('subscribeNotReady'));
    try {
      await iap.requestPurchase(request);
    } catch (e) {
      if (!isUserCancelledError(e)) Alert.alert(tr('subscribeTitle'), tr('purchaseFailed'));
    }
  }

  async function restorePurchase() {
    try {
      if (ruStore === false) await iap.restorePurchases();
      const check = await checkStore(ruStore);
      if (check === 'unknown') return Alert.alert(tr('restorePurchases'), tr('purchaseFailed'));
      commitCheck(check);
      Alert.alert(tr('restorePurchases'), tr(check === 'active' ? 'restoreDone' : 'restoreNone'));
    } catch (e) {
      Alert.alert(tr('restorePurchases'), tr('purchaseFailed'));
    }
  }

  // Тестовый переключатель (только сборки с флагом и режим разработки).
  function toggleTestPro() {
    const next = { active: !isPro, checkedAt: Date.now() };
    setProState(next);
    AsyncStorage.setItem(PRO_KEY, encodeProState(next)).catch(() => {});
  }

  // Функция доступна с Pro. Без Pro показываем заглушку и кнопку теста.
  function gated(feature, action) {
    if (isUnlocked(feature, isPro)) return action();
    // Без подписки — экран с условиями. В релизной сборке тестового входа нет.
    const buttons = [
      { text: tr('cancel'), style: 'cancel' },
      { text: tr('subscribeButton'), onPress: () => openPaywall() },
    ];
    if (SHOW_TEST_PRO) buttons.push({ text: tr('proTestUnlock'), onPress: () => toggleTestPro() });
    Alert.alert(tr('subscribeTitle'), `${tr('subscribeIncludes')}\n\n${tr('subscribeTerms')}`, buttons);
  }

  function markIntake(medId, time, status) {
    setIntakeList((prev) => toggleIntake(prev, { medId, date: dateKey(Date.now()), time, status }));
  }

  async function makeReport() {
    const now = Date.now();
    const html = buildReportHtml({
      records,
      meds,
      intake,
      units,
      lang,
      fromMs: now - reportDays * DAY,
      toMs: now,
      dateFmt: (ms) => new Date(ms).toLocaleDateString(localeTag(lang)),
    });
    try {
      const { uri } = await Print.printToFileAsync({ html });
      await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: tr('reportTitle') });
    } catch (e) {
      Alert.alert(tr('reportMake'), String(e.message ?? e));
    }
  }

  async function exportCsv() {
    try {
      // BOM нужен, чтобы Excel правильно открыл кириллицу.
      const csv = '﻿' + toCsvRecords(records, lang, units, classify);
      await shareFile(`diary-${dateKey(Date.now())}.csv`, csv, 'text/csv', 'public.comma-separated-values-text', tr('shareTitle'));
    } catch (e) {
      Alert.alert(tr('exportTitle'), String(e.message ?? e));
    }
  }

  // Копия — открытый файл с данными о здоровье. Перед отправкой предупреждаем, куда он может попасть.
  function exportBackup() {
    Alert.alert(tr('backupTitle'), tr('backupExportWarn'), [
      { text: tr('cancel'), style: 'cancel' },
      {
        text: tr('backupExportContinue'),
        onPress: async () => {
          try {
            const text = buildBackup({ records, meds, intake, units });
            await shareFile(`health-diary-backup-${dateKey(Date.now())}.json`, text, 'application/json', 'public.json', tr('backupTitle'));
          } catch (e) {
            Alert.alert(tr('backupTitle'), String(e.message ?? e));
          }
        },
      },
    ]);
  }

  // Сначала проверяем файл и показываем, сколько записей в нём. Данные меняются только после подтверждения.
  async function pickBackup() {
    let text;
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ['application/json', 'text/plain', 'application/octet-stream'],
        copyToCacheDirectory: true,
      });
      if (res.canceled) return;
      const picked = new File(res.assets[0].uri);
      try {
        text = await picked.text();
      } finally {
        if (picked.exists) picked.delete();
      }
    } catch (e) {
      return Alert.alert(tr('backupTitle'), tr('backupBadFile'));
    }
    const check = parseBackup(text);
    if (check.error) return Alert.alert(tr('backupTitle'), tr(check.error));
    const current = { records, meds, intake, units };
    Alert.alert(tr('backupTitle'), tr('backupConfirm', { n: check.counts.records, m: records.length }), [
      { text: tr('cancel'), style: 'cancel' },
      {
        text: tr('backupRestore'),
        style: 'destructive',
        onPress: async () => {
          const res = await restoreFromBackup(AsyncStorage, text, current, Date.now());
          if (!res.ok) return Alert.alert(tr('backupTitle'), tr(res.error));
          setRecords(res.data.records);
          setMeds(res.data.meds);
          setIntakeList(res.data.intake);
          setUnits({ ...units, ...res.data.units });
          refreshCanUndo();
          Alert.alert(tr('backupTitle'), tr('backupDone'));
        },
      },
    ]);
  }

  // Кнопка показывает то, что реально лежит в хранилище: после перезапуска, успешной и неудачной отмены.
  function refreshCanUndo() {
    hasUndo(AsyncStorage).then(setCanUndo).catch(() => setCanUndo(false));
  }

  async function undoLastRestore() {
    const res = await undoRestore(AsyncStorage, Date.now());
    refreshCanUndo();
    if (!res.ok) return Alert.alert(tr('backupTitle'), tr(res.error));
    setRecords(res.data.records);
    setMeds(res.data.meds);
    setIntakeList(res.data.intake);
    setUnits({ ...units, ...res.data.units });
    Alert.alert(tr('backupTitle'), tr('backupUndone'));
  }

  function switchLanguage(next) {
    setLang(next);
    AsyncStorage.setItem(LANG_KEY, next).catch(() => {});
  }

  function changeUnits(patch) {
    const next = { ...units, ...patch };
    setUnits(next);
    AsyncStorage.setItem(UNITS_KEY, JSON.stringify(next)).catch(() => {});
  }

  const sorted = useMemo(() => sortNewestFirst(records), [records]);
  const shown = historyFilter === 'all' ? sorted : sorted.filter((r) => r.type === historyFilter);

  function clearForm() {
    setSystolic('');
    setDiastolic('');
    setPulse('');
    setValue('');
    setWhen('');
    setError(null);
  }

  function startEdit(r) {
    setEditingId(r.id);
    setType(r.type);
    setError(null);
    setWhen(formatTakenAt(r.takenAt));
    if (r.type === TYPES.bp) {
      setSystolic(String(r.values.systolic));
      setDiastolic(String(r.values.diastolic));
      setPulse(r.values.pulse ? String(r.values.pulse) : '');
    } else if (r.type === TYPES.glucose) {
      setValue(String(toInputUnits(TYPES.glucose, r.values.value, units.glucose)));
      setContext(r.values.context);
    } else {
      setValue(String(toInputUnits(TYPES.weight, r.values.value, units.weight)));
    }
    setTab('input');
  }

  function cancelEdit() {
    setEditingId(null);
    clearForm();
  }

  function save() {
    // При правке тип записи не меняется: форма открыта для того же вида измерения.
    const editing = editingId ? records.find((r) => r.id === editingId) : null;
    const useType = editing ? editing.type : type;
    const input = useType === TYPES.bp ? { systolic, diastolic, pulse } : { value, context };
    const check = validateMeasurement(useType, input, units);
    if (check.error) return setError(tr(check.error));
    const date = parseTakenAt(when);
    if (date.error) return setError(tr(date.error));
    if (editing) {
      // Версия растёт: при синхронизации Health Connect заменит старую запись, а не добавит дубль.
      setRecords((prev) => prev.map((r) => (r.id === editing.id ? { ...r, values: check.values, takenAt: date.takenAt, version: (r.version ?? 1) + 1 } : r)));
      setHcSynced((prev) => prev.filter((id) => id !== editing.id));
      setEditingId(null);
    } else {
      setRecords((prev) => [makeRecord(useType, check.values, date.takenAt), ...prev]);
    }
    clearForm();
    Vibration.vibrate(15);
  }

  function remove(record) {
    Alert.alert(tr('deleteTitle'), '', [
      { text: tr('cancel'), style: 'cancel' },
      { text: tr('delete'), style: 'destructive', onPress: () => deleteRecord(record) },
    ]);
  }

  async function deleteRecord(record) {
    setRecords((prev) => prev.filter((r) => r.id !== record.id));
    if (editingId === record.id) cancelEdit();
    if (!hcSynced.includes(record.id)) return;
    setHcSynced((prev) => prev.filter((id) => id !== record.id));
    if (Platform.OS !== 'android') return;
    try {
      await HealthConnect.deleteRecordsByUuids(healthTypeFor(record.type), [], [record.id]);
    } catch (e) {
      Alert.alert(tr('hcTitle'), tr('hcDeleteFailed'));
    }
  }

  async function addMed() {
    const check = validateMed({ name: medName, times: medTimes });
    if (check.error) return setMedError(tr(check.error));
    const others = meds.filter((m) => m.id !== editingMedId);
    if (check.times.length > 0 && !canAddReminder(others, isPro)) return setMedError(tr('remindersLimit'));
    setMedError(null);
    if (check.times.length > 0 && !(await ensureNotifications())) {
      Alert.alert(tr('reminderChannel'), tr('reminderDenied'));
    }
    if (editingMedId) {
      setMeds((prev) => prev.map((m) => (m.id === editingMedId ? { ...m, name: check.name, times: check.times } : m)));
      setEditingMedId(null);
    } else {
      setMeds((prev) => [makeMed({ name: check.name, times: check.times }), ...prev]);
    }
    setMedName('');
    setMedTimes('');
  }

  function startEditMed(m) {
    setEditingMedId(m.id);
    setMedName(m.name);
    setMedTimes(m.times.join(', '));
    setMedError(null);
  }

  function cancelEditMed() {
    setEditingMedId(null);
    setMedName('');
    setMedTimes('');
    setMedError(null);
  }

  function removeMed(id) {
    Alert.alert(tr('medDelete') + '?', '', [
      { text: tr('cancel'), style: 'cancel' },
      {
        text: tr('delete'),
        style: 'destructive',
        onPress: () => {
          setMeds((prev) => prev.filter((m) => m.id !== id));
          if (editingMedId === id) cancelEditMed();
        },
      },
    ]);
  }

  const catLabel = (cat) => tr(`cat_${cat}`);
  const formatDate = (ms) => new Date(ms).toLocaleString(localeTag(lang));
  const typeLabel = (k) => tr(`type_${k}`);
  const editingRecord = editingId ? records.find((r) => r.id === editingId) : null;

  return (
    <View style={[styles.root, { backgroundColor: t.bg }]}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={[styles.title, { color: t.text }]} accessibilityRole="header">{tr('appTitle')}</Text>
          <View style={[styles.langSwitch, { borderColor: t.border }]}>
            {LANGUAGES.map((code) => (
              <TouchableOpacity
                key={code}
                onPress={() => switchLanguage(code)}
                accessibilityRole="button"
                accessibilityState={{ selected: lang === code }}
                style={[styles.langBtn, lang === code && { backgroundColor: t.accent }]}
              >
                <Text style={[styles.langText, { color: lang === code ? '#fff' : t.muted }]}>{code.toUpperCase()}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {tab === 'input' && (
          <>
            {!editingId ? (
              <Chips
                t={t}
                items={Object.values(TYPES).map((k) => ({ key: k, label: typeLabel(k), icon: TYPE_ICONS[k] }))}
                active={type}
                onPick={setType}
              />
            ) : null}
            <Hero type={type} records={records} t={t} tr={tr} catLabel={catLabel} units={units} lang={lang} fmt={formatDate} />
            <Card t={t}>
              <Text style={[styles.h2, { color: t.text }]}>{editingRecord ? tr('editTitle') : typeLabel(type)}</Text>
              {type === TYPES.bp ? (
                <View style={styles.row}>
                  <Field label={tr('systolic')} t={t} value={systolic} onChange={setSystolic} />
                  <Field label={tr('diastolic')} t={t} value={diastolic} onChange={setDiastolic} />
                  <Field label={tr('pulse')} t={t} value={pulse} onChange={setPulse} />
                </View>
              ) : (
                <>
                  <Field
                    label={`${typeLabel(type)}, ${unitLabel(type, units, lang)}`}
                    t={t}
                    value={value}
                    onChange={setValue}
                  />
                  <Chips
                    t={t}
                    small
                    items={[
                      type === TYPES.glucose
                        ? { key: 'mmol', label: unitLabel(TYPES.glucose, { glucose: 'mmol' }, lang) }
                        : { key: 'kg', label: unitLabel(TYPES.weight, { weight: 'kg' }, lang) },
                      type === TYPES.glucose
                        ? { key: 'mgdl', label: unitLabel(TYPES.glucose, { glucose: 'mgdl' }, lang) }
                        : { key: 'lb', label: unitLabel(TYPES.weight, { weight: 'lb' }, lang) },
                    ]}
                    active={type === TYPES.glucose ? units.glucose : units.weight}
                    onPick={(k) => changeUnits(type === TYPES.glucose ? { glucose: k } : { weight: k })}
                  />
                  {type === TYPES.glucose ? (
                    <>
                      <Text style={[styles.label, { color: t.muted }]}>{tr('glucoseContext')}</Text>
                      <Chips
                        t={t}
                        small
                        items={GLUCOSE_CONTEXTS.map((c) => ({ key: c, label: tr(`ctx_${c}`) }))}
                        active={context}
                        onPick={setContext}
                      />
                    </>
                  ) : null}
                </>
              )}
              <Field label={tr('dateLabel')} t={t} value={when} onChange={setWhen} placeholder="05.10.2026 08:30" text />
              {error ? <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}
              <TouchableOpacity style={[styles.button, { backgroundColor: t.accent }]} onPress={save} accessibilityRole="button">
                <Ionicons name="checkmark-circle" size={20} color="#fff" />
                <Text style={styles.buttonText}>{tr('save')}</Text>
              </TouchableOpacity>
              {editingRecord ? (
                <TouchableOpacity style={[styles.button, { backgroundColor: '#E4E4E7' }]} onPress={cancelEdit} accessibilityRole="button">
                  <Text style={styles.buttonText}>{tr('editCancel')}</Text>
                </TouchableOpacity>
              ) : null}
            </Card>
            <Text style={[styles.disclaimer, { color: t.muted }]}>{tr('disclaimer')}</Text>
          </>
        )}

        {tab === 'history' && (
          <>
            <Chips
              t={t}
              small
              items={[{ key: 'all', label: tr('historyFilterAll') }, ...Object.values(TYPES).map((k) => ({ key: k, label: typeLabel(k) }))]}
              active={historyFilter}
              onPick={setHistoryFilter}
            />
            <Card t={t}>
              {shown.length === 0 ? (
                <View style={styles.empty}>
                  <Ionicons name="document-text-outline" size={40} color={t.muted} />
                  <Text style={[styles.muted, { color: t.muted }]}>{tr('historyEmpty')}</Text>
                </View>
              ) : (
                shown.map((r) => {
                  const cat = r.type === TYPES.bp ? classify(r.values.systolic, r.values.diastolic) : null;
                  const color = cat ? CATEGORY_COLORS[cat] : t.accent;
                  return (
                    <TouchableOpacity
                      key={r.id}
                      style={[styles.item, { borderTopColor: t.border }]}
                      onPress={() => startEdit(r)}
                      onLongPress={() => remove(r)}
                      accessibilityRole="button"
                      accessibilityHint={tr('editHint')}
                    >
                      <Ionicons name={TYPE_ICONS[r.type]} size={22} color={color} />
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.itemMain, { color: t.text }]}>
                          {formatValue(r, units)} <Text style={[styles.muted, { color: t.muted }]}>{unitLabel(r.type, units, lang)}</Text>
                          {r.type === TYPES.bp && r.values.pulse ? <Text style={[styles.muted, { color: t.muted }]}>  · {tr('pulseShort', { v: r.values.pulse })}</Text> : null}
                        </Text>
                        <Text style={[styles.itemDate, { color: t.muted }]}>
                          {typeLabel(r.type)} · {formatDate(r.takenAt)}{r.source === 'health' ? ` · ${tr('fromHealth')}` : r.source === 'device' ? ` · ${tr('fromDevice')}` : ''}
                        </Text>
                        {cat ? <Text style={[styles.badge, { color }]}>{catLabel(cat)}</Text> : null}
                        {r.type === TYPES.glucose ? <Text style={[styles.muted, { color: t.muted, fontSize: 12 }]}>{tr(`ctx_${r.values.context}`)}</Text> : null}
                      </View>
                    </TouchableOpacity>
                  );
                })
              )}
              {shown.length > 0 ? <Text style={[styles.muted, { color: t.muted, marginTop: 6 }]}>{tr('deleteHint')}</Text> : null}
            </Card>
            <Card t={t}>
              <Text style={[styles.h2, { color: t.text }]}>{tr('exportTitle')}</Text>
              <Text style={[styles.muted, { color: t.muted }]}>{tr('exportHint')}</Text>
              <TouchableOpacity
                style={[styles.button, { backgroundColor: records.length ? t.accent : '#E4E4E7' }]}
                disabled={records.length === 0}
                onPress={exportCsv}
                accessibilityRole="button"
              >
                <Ionicons name="share-outline" size={20} color="#fff" />
                <Text style={styles.buttonText}>{tr('share')}</Text>
              </TouchableOpacity>
            </Card>
            <Card t={t}>
              <View style={styles.titleRow}>
                <Text style={[styles.h2, { color: t.text }]}>{tr('backupTitle')}</Text>
                <ProBadge tr={tr} />
              </View>
              <Text style={[styles.muted, { color: t.muted }]}>{tr('backupHint')}</Text>
              <TouchableOpacity style={[styles.button, { backgroundColor: t.accent }]} onPress={() => gated(PRO_FEATURES.backup, exportBackup)} accessibilityRole="button">
                <Ionicons name="cloud-download-outline" size={20} color="#fff" />
                <Text style={styles.buttonText}>{tr('backupExport')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.button, { backgroundColor: t.accent }]} onPress={() => gated(PRO_FEATURES.backup, pickBackup)} accessibilityRole="button">
                <Ionicons name="cloud-upload-outline" size={20} color="#fff" />
                <Text style={styles.buttonText}>{tr('backupPick')}</Text>
              </TouchableOpacity>
              {canUndo ? (
                <TouchableOpacity style={[styles.button, { backgroundColor: '#E4E4E7' }]} onPress={() => gated(PRO_FEATURES.backup, undoLastRestore)} accessibilityRole="button">
                  <Ionicons name="arrow-undo-outline" size={20} color="#000" />
                  <Text style={styles.buttonText}>{tr('backupUndo')}</Text>
                </TouchableOpacity>
              ) : null}
            </Card>
            {Platform.OS === 'android' ? (
              <Card t={t}>
                <View style={styles.titleRow}>
                  <Text style={[styles.h2, { color: t.text }]}>{tr('hcTitle')}</Text>
                  <ProBadge tr={tr} />
                </View>
                <Text style={[styles.muted, { color: t.muted }]}>{tr('hcHint')}</Text>
                <Text style={[styles.muted, { color: t.muted, fontSize: 12 }]}>{tr('hcCount', { n: hcSynced.length })}</Text>
                <TouchableOpacity style={[styles.button, { backgroundColor: t.accent }]} onPress={() => gated(PRO_FEATURES.healthSync, hcReady ? hcSync : hcConnect)} accessibilityRole="button">
                  <Ionicons name="heart-circle-outline" size={20} color="#fff" />
                  <Text style={styles.buttonText}>{hcReady ? tr('hcSync') : tr('hcConnect')}</Text>
                </TouchableOpacity>
              </Card>
            ) : null}
            <Card t={t}>
              <View style={styles.titleRow}>
                <Text style={[styles.h2, { color: t.text }]}>{tr('devicesTitle')}</Text>
                <ProBadge tr={tr} />
              </View>
              <Text style={[styles.muted, { color: t.muted }]}>{tr('devicesHint')}</Text>
              <TouchableOpacity style={[styles.button, { backgroundColor: t.accent }]} onPress={() => gated(PRO_FEATURES.devices, searchDevices)} accessibilityRole="button">
                <Ionicons name="bluetooth-outline" size={20} color="#fff" />
                <Text style={styles.buttonText}>{tr('devicesButton')}</Text>
              </TouchableOpacity>
              {deviceStatus ? <Text style={[styles.muted, { color: t.muted }]} accessibilityLiveRegion="polite">{deviceStatus}</Text> : null}
              {devices.map((d) => (
                <TouchableOpacity
                  key={d.id}
                  style={[styles.item, { borderTopColor: t.border }]}
                  onPress={() => gated(PRO_FEATURES.devices, () => listenTo(d))}
                  accessibilityRole="button"
                >
                  <Ionicons name="bluetooth-outline" size={22} color={t.accent} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.itemMain, { color: t.text }]}>{d.name}</Text>
                    <Text style={[styles.muted, { color: t.muted }]}>{tr(`devKind_${d.kind}`)}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </Card>
            <Card t={t}>
              <Text style={[styles.h2, { color: t.text }]}>{tr('subscribeTitle')}</Text>
              <Text style={[styles.muted, { color: t.muted }]}>{tr('subscribeIncludes')}</Text>
              <Text style={[styles.muted, { color: t.muted, fontSize: 12 }]}>{tr('subscribeTerms')}</Text>
              <View style={styles.linkRow}>
                <TouchableOpacity onPress={() => Linking.openURL(PRIVACY_URL)} accessibilityRole="link">
                  <Text style={[styles.linkText, { color: t.text }]}>{tr('privacyLink')}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => Linking.openURL(TERMS_URL)} accessibilityRole="link">
                  <Text style={[styles.linkText, { color: t.text }]}>{tr('termsLink')}</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity style={[styles.button, { backgroundColor: t.accent }]} onPress={openPaywall} accessibilityRole="button">
                <Text style={styles.buttonText}>{tr('subscribeButton')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.button, { backgroundColor: '#E4E4E7' }]} onPress={restorePurchase} accessibilityRole="button">
                <Text style={styles.buttonText}>{tr('restorePurchases')}</Text>
              </TouchableOpacity>
              {SHOW_TEST_PRO ? (
                <TouchableOpacity style={[styles.button, { backgroundColor: '#78716c' }]} onPress={toggleTestPro} accessibilityRole="button">
                  <Text style={styles.buttonText}>{`${isPro ? tr('proTestLock') : tr('proTestUnlock')} (${tr('proDevOnly')})`}</Text>
                </TouchableOpacity>
              ) : null}
            </Card>
          </>
        )}

        {tab === 'charts' && (
          <>
            <Chips
              t={t}
              small
              items={Object.values(TYPES).map((k) => ({ key: k, label: typeLabel(k), icon: TYPE_ICONS[k] }))}
              active={chartType}
              onPick={setChartType}
            />
            <Chart type={chartType} records={records} units={units} t={t} tr={tr} catLabel={catLabel} lang={lang} />
            <Card t={t}>
              <View style={styles.titleRow}>
                <Text style={[styles.h2, { color: t.text }]}>{tr('reportTitle')}</Text>
                <ProBadge tr={tr} />
              </View>
              <Text style={[styles.label, { color: t.muted }]}>{tr('reportPeriod')}</Text>
              <Chips
                t={t}
                small
                items={[
                  { key: 30, label: tr('period30') },
                  { key: 90, label: tr('period90') },
                  { key: 365, label: tr('period365') },
                ]}
                active={reportDays}
                onPick={setReportDays}
              />
              <TouchableOpacity style={[styles.button, { backgroundColor: t.accent }]} onPress={() => gated(PRO_FEATURES.pdfReport, makeReport)} accessibilityRole="button">
                <Ionicons name="document-text-outline" size={20} color="#fff" />
                <Text style={styles.buttonText}>{tr('reportMake')}</Text>
              </TouchableOpacity>
            </Card>
            <Card t={t}>
              <Text style={[styles.h2, { color: t.text }]}>{tr('glucoseAverage')}</Text>
              <Text style={[styles.big, { color: t.text }]}>{glucoseWeekAverage(records, units, lang)}</Text>
            </Card>
          </>
        )}

        {tab === 'meds' && (
          <>
            <Card t={t}>
              <Text style={[styles.h2, { color: t.text }]}>{tr('intakeTitle')}</Text>
              {meds.length === 0 ? <Text style={[styles.muted, { color: t.muted }]}>{tr('medEmpty')}</Text> : null}
              {meds.map((m) =>
                m.times.map((time) => {
                  const status = statusFor(intake, m.id, dateKey(Date.now()), time);
                  return (
                    <View key={`${m.id}-${time}`} style={[styles.intakeRow, { borderTopColor: t.border }]}>
                      <Text style={[styles.itemMain, { color: t.text }]}>{m.name} · {time}</Text>
                      <Text style={[styles.muted, { color: t.muted, fontSize: 12 }]}>
                        {status === 'taken' ? tr('intakeTaken') : status === 'missed' ? tr('intakeMissed') : tr('intakeNone')}
                      </Text>
                      <View style={styles.intakeButtons}>
                        <TouchableOpacity
                          style={[styles.intakeBtn, { borderColor: t.border, backgroundColor: status === 'taken' ? '#22c55e' : t.card }]}
                          onPress={() => markIntake(m.id, time, INTAKE_STATUS.TAKEN)}
                          accessibilityRole="button"
                          accessibilityState={{ selected: status === 'taken' }}
                        >
                          <Text style={[styles.chipText, { color: status === 'taken' ? '#fff' : t.text }]}>{tr('intakeTaken')}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.intakeBtn, { borderColor: t.border, backgroundColor: status === 'missed' ? '#ef4444' : t.card }]}
                          onPress={() => markIntake(m.id, time, INTAKE_STATUS.MISSED)}
                          accessibilityRole="button"
                          accessibilityState={{ selected: status === 'missed' }}
                        >
                          <Text style={[styles.chipText, { color: status === 'missed' ? '#fff' : t.text }]}>{tr('intakeMissed')}</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                }),
              )}
            </Card>
            <Card t={t}>
              <Text style={[styles.h2, { color: t.text }]}>{editingMedId ? tr('medEditTitle') : tr('medsTitle')}</Text>
              <Text style={[styles.muted, { color: t.muted }]}>{tr('medsHint')}</Text>
              <Field label={tr('medName')} t={t} value={medName} onChange={setMedName} text />
              <Field label={tr('medTimes')} t={t} value={medTimes} onChange={setMedTimes} placeholder="08:00, 20:00" text />
              {medError ? <Text style={styles.error} accessibilityLiveRegion="polite">{medError}</Text> : null}
              <TouchableOpacity style={[styles.button, { backgroundColor: t.accent }]} onPress={addMed} accessibilityRole="button">
                <Ionicons name={editingMedId ? 'checkmark-circle' : 'add-circle-outline'} size={20} color="#fff" />
                <Text style={styles.buttonText}>{editingMedId ? tr('save') : tr('medAdd')}</Text>
              </TouchableOpacity>
              {editingMedId ? (
                <TouchableOpacity style={[styles.button, { backgroundColor: '#E4E4E7' }]} onPress={cancelEditMed} accessibilityRole="button">
                  <Text style={styles.buttonText}>{tr('editCancel')}</Text>
                </TouchableOpacity>
              ) : null}
            </Card>
            <Card t={t}>
              {meds.length === 0 ? (
                <Text style={[styles.muted, { color: t.muted }]}>{tr('medEmpty')}</Text>
              ) : (
                meds.map((m) => (
                  <TouchableOpacity
                    key={m.id}
                    style={[styles.item, { borderTopColor: t.border }]}
                    onPress={() => startEditMed(m)}
                    onLongPress={() => removeMed(m.id)}
                    accessibilityRole="button"
                    accessibilityHint={tr('editHint')}
                  >
                    <Ionicons name="medkit-outline" size={22} color={t.accent} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.itemMain, { color: t.text }]}>{m.name}</Text>
                      <Text style={[styles.muted, { color: t.muted }]}>{m.times.length ? m.times.join(', ') : tr('medNoTimes')}</Text>
                    </View>
                  </TouchableOpacity>
                ))
              )}
              {meds.length > 0 ? <Text style={[styles.muted, { color: t.muted, marginTop: 6 }]}>{tr('deleteHint')}</Text> : null}
            </Card>
          </>
        )}
      </ScrollView>

      <View style={[styles.tabBar, { backgroundColor: t.tabBar, borderTopColor: t.border }]}>
        {TABS.map((item) => {
          const active = tab === item.key;
          const color = active ? t.accent : t.muted;
          return (
            <TouchableOpacity
              key={item.key}
              style={styles.tabItem}
              onPress={() => setTab(item.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
            >
              <Ionicons name={item.icon} size={22} color={color} />
              <Text style={[styles.tabLabel, { color }]}>{tr(item.label)}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

// Файл во временной папке и системное окно «Поделиться». Старый файл с тем же именем заменяется.
// Файл во временной папке удаляем сразу после отправки: копия с данными о здоровье не должна лежать на телефоне.
async function shareFile(name, text, mimeType, uti, dialogTitle) {
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  file.create();
  file.write(text);
  try {
    await Sharing.shareAsync(file.uri, { mimeType, UTI: uti, dialogTitle });
  } finally {
    if (file.exists) file.delete();
  }
}

async function ensureNotifications() {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const asked = await Notifications.requestPermissionsAsync();
  return Boolean(asked.granted);
}

// Пересоздаём все напоминания по расписанию. Без разрешения ничего не ставим.
async function scheduleReminders(meds, tr) {
  const current = await Notifications.getPermissionsAsync();
  await Notifications.cancelAllScheduledNotificationsAsync();
  if (!current.granted) return;
  for (const slot of reminderSlots(meds)) {
    await Notifications.scheduleNotificationAsync({
      identifier: slot.key,
      content: { title: tr('reminderTitle'), body: tr('reminderBody', { name: slot.name, time: slot.time }) },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour: slot.hour,
        minute: slot.minute,
        channelId: REMINDER_CHANNEL,
      },
    });
  }
}

function glucoseWeekAverage(records, units, lang) {
  const since = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recent = ofType(records, TYPES.glucose).filter((r) => r.takenAt >= since);
  if (recent.length === 0) return '—';
  const avg = recent.reduce((a, r) => a + r.values.value, 0) / recent.length;
  const shown = units.glucose === 'mgdl' ? Math.round(toInputUnits(TYPES.glucose, avg, 'mgdl')) : avg.toFixed(1);
  return `${shown} ${unitLabel(TYPES.glucose, units, lang)}`;
}

function ProBadge({ tr }) {
  return (
    <View style={styles.proBadge}>
      <Text style={styles.proBadgeText}>{tr('proBadge')}</Text>
    </View>
  );
}

function Hero({ type, records, t, tr, catLabel, units, lang, fmt }) {
  const latest = sortNewestFirst(ofType(records, type))[0];
  if (!latest) {
    return (
      <Card t={t}>
        <Text style={[styles.muted, { color: t.muted }]}>{tr('firstHint')}</Text>
      </Card>
    );
  }
  const cat = type === TYPES.bp ? classify(latest.values.systolic, latest.values.diastolic) : null;
  const bg = cat ? CATEGORY_COLORS[cat] : t.accent;
  const ink = cat === 'crisis' ? '#ffffff' : '#000000';
  return (
    <Shadowed t={t}>
    <View style={[styles.hero, { backgroundColor: bg, borderColor: t.border }]}>
      <Text style={[styles.heroLabel, { color: ink, opacity: 0.85 }]}>{tr('lastReading')}</Text>
      <Text style={[styles.heroValue, { color: ink }]}>
        {formatValue(latest, units)}
        <Text style={[styles.heroUnit, { color: ink }]}> {unitLabel(type, units, lang)}</Text>
      </Text>
      {cat ? <Text style={[styles.heroCategory, { color: ink }]}>{catLabel(cat)}</Text> : null}
      {type === TYPES.glucose ? <Text style={[styles.heroCategory, { color: ink }]}>{tr(`ctx_${latest.values.context}`)}</Text> : null}
      <Text style={[styles.heroDate, { color: ink, opacity: 0.8 }]}>{fmt(latest.takenAt)}</Text>
    </View>
    </Shadowed>
  );
}

function Chips({ items, active, onPick, t, small }) {
  return (
    <View style={styles.chips}>
      {items.map((it) => {
        const on = it.key === active;
        return (
          <TouchableOpacity
            key={it.key}
            onPress={() => onPick(it.key)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            style={[styles.chip, small && styles.chipSmall, { borderColor: t.border, backgroundColor: on ? '#FFE600' : t.card }]}
          >
            {it.icon ? <Ionicons name={it.icon} size={16} color="#000" /> : null}
            <Text style={[styles.chipText, { color: '#000' }]}>{it.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function Field({ label, t, value, onChange, placeholder, text }) {
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: t.muted }]}>{label}</Text>
      <TextInput
        style={[styles.input, { color: t.text, backgroundColor: t.inputBg, borderColor: t.border }]}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={t.muted}
        keyboardType={text ? 'default' : 'decimal-pad'}
        autoCapitalize="none"
        accessibilityLabel={label}
      />
    </View>
  );
}

// Жёсткая тень: копия блока смещена вправо-вниз под ним.
function Shadowed({ children, t, style }) {
  return (
    <View style={[{ marginRight: SHADOW, marginBottom: SHADOW }, style]}>
      <View style={{ position: 'absolute', top: SHADOW, bottom: -SHADOW, left: SHADOW, right: -SHADOW, backgroundColor: t.shadow }} />
      {children}
    </View>
  );
}

function Card({ children, t }) {
  return (
    <Shadowed t={t}>
      <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>{children}</View>
    </Shadowed>
  );
}

// График по выбранному виду измерения. Давление — столбики «нижнее–верхнее» по категориям.
// Сахар и вес — столбики от минимума шкалы до значения.
function Chart({ type, records, units, t, tr, catLabel, lang }) {
  const points = useMemo(() => chartPoints(records, type, CHART_POINTS), [records, type]);
  if (points.length === 0) {
    return (
      <Card t={t}>
        <View style={styles.empty}>
          <Ionicons name="analytics-outline" size={40} color={t.muted} />
          <Text style={[styles.muted, { color: t.muted }]}>{tr('chartEmpty')}</Text>
        </View>
      </Card>
    );
  }
  const isBp = type === TYPES.bp;
  const { min, max } = scaleRange(points, isBp ? { min: CHART_MIN, max: CHART_MAX } : null);
  const scale = (v) => {
    const clamped = Math.min(max, Math.max(min, v));
    return ((clamped - min) / (max - min)) * CHART_HEIGHT;
  };
  const unitKey = type === TYPES.glucose ? units.glucose : units.weight;
  const shownValue = (v) => Math.round(toInputUnits(type, v, unitKey) * 10) / 10;
  const lows = points.map((p) => p.low);
  const highs = points.map((p) => p.high);
  return (
    <Card t={t}>
      <Text style={[styles.h2, { color: t.text }]}>{tr('chartTitle', { n: points.length })}</Text>
      <Text style={[styles.muted, { color: t.muted }]}>{isBp ? tr('chartHint') : tr('chartHintSingle')}</Text>
      <View style={styles.chartWrap}>
        {isBp
          ? [140, 120].map((line) => (
              <View key={line} style={[styles.refLine, { bottom: scale(line), borderColor: t.border }]}>
                <Text style={[styles.refLabel, { color: t.muted }]}>{line}</Text>
              </View>
            ))
          : null}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.bars}>
          {points.map((p) => {
            const bottom = isBp ? scale(p.low) : scale(min);
            const height = Math.max(4, scale(p.high) - bottom);
            const color = isBp ? CATEGORY_COLORS[classify(p.high, p.low)] : t.accent;
            return (
              <View key={p.id} style={styles.barCol}>
                <View style={[styles.bar, { bottom, height, backgroundColor: color }]} />
              </View>
            );
          })}
        </ScrollView>
      </View>
      {isBp ? (
        <View style={styles.legend}>
          {Object.entries(CATEGORY_COLORS).map(([key, color]) => (
            <View key={key} style={styles.legendItem}>
              <View style={[styles.dot, { backgroundColor: color }]} />
              <Text style={[styles.legendText, { color: t.muted }]}>{catLabel(key)}</Text>
            </View>
          ))}
        </View>
      ) : (
        <Text style={[styles.muted, { color: t.muted, fontSize: 13 }]}>
          {tr('chartRange', { min: shownValue(Math.min(...lows)), max: shownValue(Math.max(...highs)), unit: unitLabel(type, units, lang) })}
        </Text>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 16, paddingTop: 60, paddingBottom: 110, gap: 12 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  title: { fontSize: 26, fontWeight: '900', textTransform: 'uppercase', flexShrink: 1, marginRight: 8 },
  langSwitch: { flexDirection: 'row', borderWidth: LINE, borderRadius: 0, overflow: 'hidden' },
  langBtn: { paddingVertical: 6, paddingHorizontal: 10 },
  langText: { fontSize: 13, fontWeight: '900' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: LINE, borderRadius: 0, paddingVertical: 8, paddingHorizontal: 12 },
  chipSmall: { paddingVertical: 6, paddingHorizontal: 10 },
  chipText: { fontSize: 14, fontWeight: '800' },
  card: { borderRadius: 0, borderWidth: LINE, padding: 16, gap: 10 },
  h2: { fontSize: 17, fontWeight: '900', textTransform: 'uppercase' },
  big: { fontSize: 30, fontWeight: '700' },
  muted: { fontSize: 14 },
  disclaimer: { fontSize: 12, textAlign: 'center', marginTop: 4 },
  row: { flexDirection: 'row', gap: 8 },
  field: { flex: 1, minWidth: 0, gap: 4 },
  label: { fontSize: 12, fontWeight: '500' },
  input: { borderWidth: LINE, borderRadius: 0, padding: 12, fontSize: 17, minWidth: 0 },
  button: { flexDirection: 'row', gap: 8, borderRadius: 0, borderWidth: LINE, borderColor: '#000', padding: 14, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: '#000', fontWeight: '900', fontSize: 16, textTransform: 'uppercase' },
  error: { color: '#ef4444', fontSize: 14 },
  hero: { borderRadius: 0, borderWidth: LINE, padding: 20, gap: 4 },
  heroLabel: { fontSize: 14, fontWeight: '500' },
  heroValue: { fontSize: 52, fontWeight: '900' },
  heroUnit: { fontSize: 18, fontWeight: '600' },
  heroCategory: { fontSize: 16, fontWeight: '600' },
  heroDate: { fontSize: 13, marginTop: 4 },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 20 },
  item: { flexDirection: 'row', gap: 12, alignItems: 'center', borderTopWidth: 2, paddingVertical: 12 },
  dot: { width: 12, height: 12, borderRadius: 0, borderWidth: 2, borderColor: '#000' },
  itemMain: { fontSize: 18, fontWeight: '600' },
  itemDate: { fontSize: 13, marginTop: 2 },
  badge: { fontSize: 13, fontWeight: '600', marginTop: 2 },
  chartWrap: { height: CHART_HEIGHT + 8, marginTop: 8, justifyContent: 'flex-end' },
  refLine: { position: 'absolute', left: 0, right: 0, borderTopWidth: 2, borderStyle: 'dashed' },
  refLabel: { fontSize: 11, position: 'absolute', right: 0, top: -14 },
  bars: { alignItems: 'flex-end', gap: 8, paddingRight: 8, height: CHART_HEIGHT },
  barCol: { width: 14, height: CHART_HEIGHT, justifyContent: 'flex-end' },
  bar: { position: 'absolute', left: 0, right: 0, borderRadius: 0, borderWidth: 2, borderColor: '#000' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendText: { fontSize: 11 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  linkRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  intakeRow: { gap: 6, borderTopWidth: 2, paddingVertical: 12 },
  intakeButtons: { flexDirection: 'row', gap: 8, marginTop: 4 },
  intakeBtn: { flex: 1, alignItems: 'center', borderWidth: LINE, borderRadius: 0, paddingVertical: 10 },
  linkText: { fontSize: 14, fontWeight: '700', textDecorationLine: 'underline' },
  proBadge: { backgroundColor: '#B388FF', borderRadius: 0, borderWidth: 2, borderColor: '#000', paddingVertical: 2, paddingHorizontal: 8 },
  proBadgeText: { color: '#000', fontSize: 11, fontWeight: '900' },
  tabBar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', borderTopWidth: LINE, paddingBottom: 20, paddingTop: 8 },
  tabItem: { flex: 1, alignItems: 'center', gap: 2 },
  tabLabel: { fontSize: 11, fontWeight: '900', textTransform: 'uppercase' },
});
