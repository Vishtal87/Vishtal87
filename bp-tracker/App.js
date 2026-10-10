import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  ScrollView,
  Share,
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
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { classify, parseTakenAt } from './src/bp.mjs';
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
} from './src/measurements.mjs';
import { validateMed, makeMed } from './src/meds.mjs';
import { PRO_FEATURES, isUnlocked } from './src/entitlements.mjs';
import { INTAKE_STATUS, setIntake, statusFor, dateKey } from './src/intake.mjs';
import { buildBackup, parseBackup } from './src/backup.mjs';
import { buildReportHtml } from './src/report.mjs';
import { toHealthRecord, pendingRecords, WRITE_PERMISSIONS } from './src/healthSync.mjs';
import { translate, localeTag, detectLanguage, LANGUAGES } from './src/i18n.mjs';

const RECORDS_KEY = 'health-records-v2';
const OLD_BP_KEY = 'bp-readings-v1';
const LANG_KEY = 'bp-lang-v1';
const UNITS_KEY = 'health-units-v1';
const MEDS_KEY = 'meds-v1';
const PRO_KEY = 'pro-v1';
const INTAKE_KEY = 'intake-v1';
const HC_SYNCED_KEY = 'hc-synced-v1';
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

  const [medName, setMedName] = useState('');
  const [medTimes, setMedTimes] = useState('');
  const [medError, setMedError] = useState(null);
  const [isPro, setIsPro] = useState(false);
  const [intake, setIntakeList] = useState([]);
  const [reportDays, setReportDays] = useState(30);
  const [restoreText, setRestoreText] = useState('');
  const [hcSynced, setHcSynced] = useState([]);
  const [hcReady, setHcReady] = useState(false);

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
      if (pro) setIsPro(pro === 'true');
      else if (TEST_PRO_BUILD) setIsPro(true);
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

  async function hcConnect() {
    if (Platform.OS !== 'android') return Alert.alert(tr('hcTitle'), tr('hcIosLater'));
    try {
      const ok = await HealthConnect.initialize();
      if (!ok) return Alert.alert(tr('hcTitle'), tr('hcUnavailable'));
      const granted = await HealthConnect.requestPermission(WRITE_PERMISSIONS);
      if (!granted || granted.length === 0) return Alert.alert(tr('hcTitle'), tr('hcDenied'));
      setHcReady(true);
      await hcSync();
    } catch (e) {
      Alert.alert(tr('hcTitle'), String(e.message ?? e));
    }
  }

  async function hcSync() {
    const todo = pendingRecords(records, hcSynced);
    if (todo.length === 0) return Alert.alert(tr('hcTitle'), tr('hcDone', { n: 0 }));
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
    Alert.alert(tr('hcTitle'), tr('hcDone', { n: sent.length }));
  }

  function toggleTestPro() {
    const next = !isPro;
    setIsPro(next);
    AsyncStorage.setItem(PRO_KEY, String(next)).catch(() => {});
  }

  // Функция доступна с Pro. Без Pro показываем заглушку и кнопку теста.
  function gated(feature, action) {
    if (isUnlocked(feature, isPro)) return action();
    // Без подписки — экран с условиями. В релизной сборке тестового входа нет.
    const buttons = [
      { text: tr('cancel'), style: 'cancel' },
      { text: tr('subscribeButton'), onPress: () => Alert.alert(tr('subscribeTitle'), tr('subscribeNotReady')) },
    ];
    if (SHOW_TEST_PRO) buttons.push({ text: tr('proTestUnlock'), onPress: () => toggleTestPro() });
    Alert.alert(tr('subscribeTitle'), `${tr('subscribeIncludes')}\n\n${tr('subscribePrice')}\n\n${tr('subscribeTerms')}`, buttons);
  }

  function markIntake(medId, time, status) {
    setIntakeList((prev) => setIntake(prev, { medId, date: dateKey(Date.now()), time, status }));
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
      await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
    } catch (e) {
      Alert.alert(tr('reportMake'), String(e.message ?? e));
    }
  }

  function exportBackup() {
    const text = buildBackup({ records, meds, intake, units });
    Share.share({ title: tr('backupTitle'), message: text });
  }

  function restoreBackup() {
    const check = parseBackup(restoreText);
    if (check.error) return Alert.alert(tr('backupTitle'), tr(check.error));
    Alert.alert(tr('backupTitle'), tr('backupReplaceWarn'), [
      { text: tr('cancel'), style: 'cancel' },
      {
        text: tr('backupRestore'),
        style: 'destructive',
        onPress: () => {
          setRecords(check.data.records);
          setMeds(check.data.meds);
          setIntakeList(check.data.intake);
          if (check.data.units && check.data.units.glucose) changeUnits(check.data.units);
          setRestoreText('');
          Alert.alert(tr('backupTitle'), tr('backupDone'));
        },
      },
    ]);
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

  function save() {
    const input = type === TYPES.bp ? { systolic, diastolic, pulse } : { value, context };
    const check = validateMeasurement(type, input, units);
    if (check.error) return setError(tr(check.error));
    const date = parseTakenAt(when);
    if (date.error) return setError(tr(date.error));
    setError(null);
    setRecords((prev) => [makeRecord(type, check.values, date.takenAt), ...prev]);
    setSystolic('');
    setDiastolic('');
    setPulse('');
    setValue('');
    setWhen('');
    Vibration.vibrate(15);
  }

  function remove(id) {
    Alert.alert(tr('deleteTitle'), '', [
      { text: tr('cancel'), style: 'cancel' },
      { text: tr('delete'), style: 'destructive', onPress: () => setRecords((prev) => prev.filter((r) => r.id !== id)) },
    ]);
  }

  function addMed() {
    const check = validateMed({ name: medName, times: medTimes });
    if (check.error) return setMedError(tr(check.error));
    setMedError(null);
    setMeds((prev) => [makeMed({ name: check.name, times: check.times }), ...prev]);
    setMedName('');
    setMedTimes('');
  }

  function removeMed(id) {
    Alert.alert(tr('medDelete') + '?', '', [
      { text: tr('cancel'), style: 'cancel' },
      { text: tr('delete'), style: 'destructive', onPress: () => setMeds((prev) => prev.filter((m) => m.id !== id)) },
    ]);
  }

  const catLabel = (cat) => tr(`cat_${cat}`);
  const formatDate = (ms) => new Date(ms).toLocaleString(localeTag(lang));
  const typeLabel = (k) => tr(`type_${k}`);

  return (
    <View style={[styles.root, { backgroundColor: t.bg }]}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: t.text }]}>{tr('appTitle')}</Text>
          <View style={[styles.langSwitch, { borderColor: t.border }]}>
            {LANGUAGES.map((code) => (
              <TouchableOpacity key={code} onPress={() => switchLanguage(code)} style={[styles.langBtn, lang === code && { backgroundColor: t.accent }]}>
                <Text style={[styles.langText, { color: lang === code ? '#fff' : t.muted }]}>{code.toUpperCase()}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {tab === 'input' && (
          <>
            <Chips
              t={t}
              items={Object.values(TYPES).map((k) => ({ key: k, label: typeLabel(k), icon: TYPE_ICONS[k] }))}
              active={type}
              onPick={setType}
            />
            <Hero type={type} records={records} t={t} tr={tr} catLabel={catLabel} units={units} lang={lang} fmt={formatDate} />
            <Card t={t}>
              <Text style={[styles.h2, { color: t.text }]}>{typeLabel(type)}</Text>
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
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <TouchableOpacity style={[styles.button, { backgroundColor: t.accent }]} onPress={save}>
                <Ionicons name="checkmark-circle" size={20} color="#fff" />
                <Text style={styles.buttonText}>{tr('save')}</Text>
              </TouchableOpacity>
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
                    <TouchableOpacity key={r.id} style={[styles.item, { borderTopColor: t.border }]} onLongPress={() => remove(r.id)}>
                      <Ionicons name={TYPE_ICONS[r.type]} size={22} color={color} />
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.itemMain, { color: t.text }]}>
                          {formatValue(r, units)} <Text style={[styles.muted, { color: t.muted }]}>{unitLabel(r.type, units, lang)}</Text>
                          {r.type === TYPES.bp && r.values.pulse ? <Text style={[styles.muted, { color: t.muted }]}>  · {tr('pulseShort', { v: r.values.pulse })}</Text> : null}
                        </Text>
                        <Text style={[styles.itemDate, { color: t.muted }]}>
                          {typeLabel(r.type)} · {formatDate(r.takenAt)}
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
                style={[styles.button, { backgroundColor: records.length ? t.accent : t.muted }]}
                disabled={records.length === 0}
                onPress={() => Share.share({ title: tr('shareTitle'), message: toCsvRecords(records, lang, units, classify) })}
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
              <TouchableOpacity style={[styles.button, { backgroundColor: t.accent }]} onPress={() => gated(PRO_FEATURES.backup, exportBackup)}>
                <Ionicons name="cloud-download-outline" size={20} color="#fff" />
                <Text style={styles.buttonText}>{tr('backupExport')}</Text>
              </TouchableOpacity>
              <TextInput
                style={[styles.input, { color: t.text, backgroundColor: t.inputBg, borderColor: t.border, minHeight: 60 }]}
                value={restoreText}
                onChangeText={setRestoreText}
                placeholder={tr('backupPasteHint')}
                placeholderTextColor={t.muted}
                multiline
                autoCapitalize="none"
              />
              <TouchableOpacity style={[styles.button, { backgroundColor: restoreText ? t.accent : t.muted }]} disabled={!restoreText} onPress={() => gated(PRO_FEATURES.backup, restoreBackup)}>
                <Ionicons name="cloud-upload-outline" size={20} color="#fff" />
                <Text style={styles.buttonText}>{tr('backupRestore')}</Text>
              </TouchableOpacity>
            </Card>
            <Card t={t}>
              <View style={styles.titleRow}>
                <Text style={[styles.h2, { color: t.text }]}>{tr('hcTitle')}</Text>
                <ProBadge tr={tr} />
              </View>
              <Text style={[styles.muted, { color: t.muted }]}>{tr('hcHint')}</Text>
              <Text style={[styles.muted, { color: t.muted, fontSize: 12 }]}>{tr('hcCount', { n: hcSynced.length })}</Text>
              <TouchableOpacity style={[styles.button, { backgroundColor: t.accent }]} onPress={() => gated(PRO_FEATURES.healthSync, hcReady ? hcSync : hcConnect)}>
                <Ionicons name="heart-circle-outline" size={20} color="#fff" />
                <Text style={styles.buttonText}>{hcReady ? tr('hcSync') : tr('hcConnect')}</Text>
              </TouchableOpacity>
            </Card>
            <Card t={t}>
              <Text style={[styles.h2, { color: t.text }]}>{tr('subscribeTitle')}</Text>
              <Text style={[styles.muted, { color: t.muted }]}>{tr('subscribeIncludes')}</Text>
              <Text style={[styles.muted, { color: t.muted, fontSize: 12 }]}>{tr('subscribeTerms')}</Text>
              <TouchableOpacity style={[styles.button, { backgroundColor: t.accent }]} onPress={() => Alert.alert(tr('subscribeTitle'), tr('subscribeNotReady'))}>
                <Text style={styles.buttonText}>{tr('subscribeButton')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.button, { backgroundColor: t.muted }]} onPress={() => Alert.alert(tr('restorePurchases'), tr('subscribeNotReady'))}>
                <Text style={styles.buttonText}>{tr('restorePurchases')}</Text>
              </TouchableOpacity>
              {SHOW_TEST_PRO ? (
                <TouchableOpacity style={[styles.button, { backgroundColor: '#78716c' }]} onPress={toggleTestPro}>
                  <Text style={styles.buttonText}>{`${isPro ? tr('proTestLock') : tr('proTestUnlock')} (${tr('proDevOnly')})`}</Text>
                </TouchableOpacity>
              ) : null}
            </Card>
          </>
        )}

        {tab === 'charts' && (
          <>
            <Chart readings={ofType(records, TYPES.bp)} t={t} tr={tr} catLabel={catLabel} />
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
              <TouchableOpacity style={[styles.button, { backgroundColor: t.accent }]} onPress={() => gated(PRO_FEATURES.pdfReport, makeReport)}>
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
                    <View key={`${m.id}-${time}`} style={[styles.item, { borderTopColor: t.border }]}>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.itemMain, { color: t.text }]}>{m.name} · {time}</Text>
                        <Text style={[styles.muted, { color: t.muted, fontSize: 12 }]}>
                          {status === 'taken' ? tr('intakeTaken') : status === 'missed' ? tr('intakeMissed') : tr('intakeNone')}
                        </Text>
                      </View>
                      <TouchableOpacity style={[styles.chip, { borderColor: t.border, backgroundColor: status === 'taken' ? '#22c55e' : t.card }]} onPress={() => markIntake(m.id, time, INTAKE_STATUS.TAKEN)}>
                        <Text style={[styles.chipText, { color: status === 'taken' ? '#fff' : t.text }]}>{tr('intakeTaken')}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.chip, { borderColor: t.border, backgroundColor: status === 'missed' ? '#ef4444' : t.card }]} onPress={() => markIntake(m.id, time, INTAKE_STATUS.MISSED)}>
                        <Text style={[styles.chipText, { color: status === 'missed' ? '#fff' : t.text }]}>{tr('intakeMissed')}</Text>
                      </TouchableOpacity>
                    </View>
                  );
                }),
              )}
            </Card>
            <Card t={t}>
              <Text style={[styles.h2, { color: t.text }]}>{tr('medsTitle')}</Text>
              <Text style={[styles.muted, { color: t.muted }]}>{tr('medsHint')}</Text>
              <Field label={tr('medName')} t={t} value={medName} onChange={setMedName} text />
              <Field label={tr('medTimes')} t={t} value={medTimes} onChange={setMedTimes} placeholder="08:00, 20:00" text />
              {medError ? <Text style={styles.error}>{medError}</Text> : null}
              <TouchableOpacity style={[styles.button, { backgroundColor: t.accent }]} onPress={addMed}>
                <Ionicons name="add-circle-outline" size={20} color="#fff" />
                <Text style={styles.buttonText}>{tr('medAdd')}</Text>
              </TouchableOpacity>
            </Card>
            <Card t={t}>
              {meds.length === 0 ? (
                <Text style={[styles.muted, { color: t.muted }]}>{tr('medEmpty')}</Text>
              ) : (
                meds.map((m) => (
                  <TouchableOpacity key={m.id} style={[styles.item, { borderTopColor: t.border }]} onLongPress={() => removeMed(m.id)}>
                    <Ionicons name="medkit-outline" size={22} color={t.accent} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.itemMain, { color: t.text }]}>{m.name}</Text>
                      <Text style={[styles.muted, { color: t.muted }]}>{m.times.join(', ')}</Text>
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
            <TouchableOpacity key={item.key} style={styles.tabItem} onPress={() => setTab(item.key)}>
              <Ionicons name={item.icon} size={22} color={color} />
              <Text style={[styles.tabLabel, { color }]}>{tr(item.label)}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

function glucoseWeekAverage(records, units, lang) {
  const since = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recent = ofType(records, TYPES.glucose).filter((r) => r.takenAt >= since);
  if (recent.length === 0) return '—';
  const avg = recent.reduce((a, r) => a + r.values.value, 0) / recent.length;
  const shown = units.glucose === 'mgdl' ? Math.round(avg * 18.0156) : avg.toFixed(1);
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

// Столбик на каждое давление: от нижнего до верхнего. Цвет — категория.
function Chart({ readings, t, tr, catLabel }) {
  const points = useMemo(() => [...readings].sort((a, b) => a.takenAt - b.takenAt).slice(-CHART_POINTS), [readings]);
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
  const scale = (v) => {
    const clamped = Math.min(CHART_MAX, Math.max(CHART_MIN, v));
    return ((clamped - CHART_MIN) / (CHART_MAX - CHART_MIN)) * CHART_HEIGHT;
  };
  return (
    <Card t={t}>
      <Text style={[styles.h2, { color: t.text }]}>{tr('chartTitle', { n: points.length })}</Text>
      <Text style={[styles.muted, { color: t.muted }]}>{tr('chartHint')}</Text>
      <View style={styles.chartWrap}>
        {[140, 120].map((line) => (
          <View key={line} style={[styles.refLine, { bottom: scale(line), borderColor: t.border }]}>
            <Text style={[styles.refLabel, { color: t.muted }]}>{line}</Text>
          </View>
        ))}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.bars}>
          {points.map((r) => {
            const cat = classify(r.values.systolic, r.values.diastolic);
            const bottom = scale(r.values.diastolic);
            const height = Math.max(4, scale(r.values.systolic) - bottom);
            return (
              <View key={r.id} style={styles.barCol}>
                <View style={[styles.bar, { bottom, height, backgroundColor: CATEGORY_COLORS[cat] }]} />
              </View>
            );
          })}
        </ScrollView>
      </View>
      <View style={styles.legend}>
        {Object.entries(CATEGORY_COLORS).map(([key, color]) => (
          <View key={key} style={styles.legendItem}>
            <View style={[styles.dot, { backgroundColor: color }]} />
            <Text style={[styles.legendText, { color: t.muted }]}>{catLabel(key)}</Text>
          </View>
        ))}
      </View>
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
  proBadge: { backgroundColor: '#B388FF', borderRadius: 0, borderWidth: 2, borderColor: '#000', paddingVertical: 2, paddingHorizontal: 8 },
  proBadgeText: { color: '#000', fontSize: 11, fontWeight: '900' },
  tabBar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', borderTopWidth: LINE, paddingBottom: 20, paddingTop: 8 },
  tabItem: { flex: 1, alignItems: 'center', gap: 2 },
  tabLabel: { fontSize: 11, fontWeight: '900', textTransform: 'uppercase' },
});
