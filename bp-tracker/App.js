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
  Vibration,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import {
  classify,
  makeReading,
  parseTakenAt,
  sortNewestFirst,
  toCsv,
  validate,
} from './src/bp.mjs';
import { translate, localeTag, detectLanguage, LANGUAGES } from './src/i18n.mjs';

const STORAGE_KEY = 'bp-readings-v1';
const LANG_KEY = 'bp-lang-v1';
const CHART_POINTS = 30;
const CHART_MIN = 40;
const CHART_MAX = 200;
const CHART_HEIGHT = 220;

const CATEGORY_COLORS = {
  normal: '#22c55e',
  elevated: '#eab308',
  stage1: '#f97316',
  stage2: '#ef4444',
  crisis: '#991b1b',
};

const LIGHT = {
  bg: '#f5f5f4',
  card: '#ffffff',
  text: '#1c1917',
  muted: '#78716c',
  border: '#e7e5e4',
  accent: '#2563eb',
  inputBg: '#ffffff',
  tabBar: '#ffffff',
};

const DARK = {
  bg: '#0c0a09',
  card: '#1c1917',
  text: '#fafaf9',
  muted: '#a8a29e',
  border: '#292524',
  accent: '#60a5fa',
  inputBg: '#292524',
  tabBar: '#1c1917',
};

const TABS = [
  { key: 'input', label: 'tabInput', icon: 'add-circle-outline' },
  { key: 'history', label: 'tabHistory', icon: 'list-outline' },
  { key: 'charts', label: 'tabCharts', icon: 'bar-chart-outline' },
];

export default function App() {
  const scheme = useColorScheme();
  const t = scheme === 'dark' ? DARK : LIGHT;
  const [lang, setLang] = useState(detectLanguage(Intl.DateTimeFormat().resolvedOptions().locale));
  const tr = (key, vars) => translate(lang, key, vars);
  const [tab, setTab] = useState('input');
  const [readings, setReadings] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [systolic, setSystolic] = useState('');
  const [diastolic, setDiastolic] = useState('');
  const [pulse, setPulse] = useState('');
  const [when, setWhen] = useState('');
  const [error, setError] = useState(null);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => setReadings(raw ? JSON.parse(raw) : []))
      .catch(() => setReadings([]))
      .finally(() => setLoaded(true));
    AsyncStorage.getItem(LANG_KEY).then((saved) => {
      if (saved && LANGUAGES.includes(saved)) setLang(saved);
    });
  }, []);

  useEffect(() => {
    if (!loaded) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(readings)).catch(() => {});
  }, [readings, loaded]);

  function switchLanguage(next) {
    setLang(next);
    AsyncStorage.setItem(LANG_KEY, next).catch(() => {});
  }

  const sorted = useMemo(() => sortNewestFirst(readings), [readings]);
  const latest = sorted[0] ?? null;
  const week = useMemo(() => averageWeek(readings), [readings]);

  function averageWeek(list) {
    const since = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recent = list.filter((r) => r.takenAt >= since);
    if (recent.length === 0) return null;
    const s = recent.reduce((a, r) => a + r.systolic, 0) / recent.length;
    const d = recent.reduce((a, r) => a + r.diastolic, 0) / recent.length;
    return { count: recent.length, systolic: Math.round(s), diastolic: Math.round(d) };
  }

  function save() {
    const v = { systolic, diastolic, pulse };
    const problem = validate(v);
    if (problem) return setError(tr(problem));
    const date = parseTakenAt(when);
    if (date.error) return setError(tr(date.error));
    setError(null);
    setReadings((prev) => [makeReading(v, date.takenAt), ...prev]);
    setSystolic('');
    setDiastolic('');
    setPulse('');
    setWhen('');
    Vibration.vibrate(15);
  }

  function remove(id) {
    Alert.alert(tr('deleteTitle'), '', [
      { text: tr('cancel'), style: 'cancel' },
      { text: tr('delete'), style: 'destructive', onPress: () => setReadings((prev) => prev.filter((r) => r.id !== id)) },
    ]);
  }

  const catLabel = (cat) => tr(`cat_${cat}`);

  return (
    <View style={[styles.root, { backgroundColor: t.bg }]}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: t.text }]}>{tr('appTitle')}</Text>
          <View style={[styles.langSwitch, { borderColor: t.border }]}>
            {LANGUAGES.map((code) => (
              <TouchableOpacity
                key={code}
                onPress={() => switchLanguage(code)}
                style={[styles.langBtn, lang === code && { backgroundColor: t.accent }]}
              >
                <Text style={[styles.langText, { color: lang === code ? '#fff' : t.muted }]}>{code.toUpperCase()}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {tab === 'input' && (
          <>
            <Hero latest={latest} t={t} tr={tr} catLabel={catLabel} fmt={formatDate} />
            <Card t={t}>
              <Text style={[styles.h2, { color: t.text }]}>{tr('newReading')}</Text>
              <View style={styles.row}>
                <Field label={tr('systolic')} t={t} value={systolic} onChange={setSystolic} />
                <Field label={tr('diastolic')} t={t} value={diastolic} onChange={setDiastolic} />
                <Field label={tr('pulse')} t={t} value={pulse} onChange={setPulse} />
              </View>
              <Field label={tr('dateLabel')} t={t} value={when} onChange={setWhen} placeholder="05.10.2026 08:30" text />
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <TouchableOpacity style={[styles.button, { backgroundColor: t.accent }]} onPress={save}>
                <Ionicons name="checkmark-circle" size={20} color="#fff" />
                <Text style={styles.buttonText}>{tr('save')}</Text>
              </TouchableOpacity>
            </Card>
            <Card t={t}>
              <Text style={[styles.h2, { color: t.text }]}>{tr('weekAverage')}</Text>
              {week ? (
                <Text style={[styles.big, { color: t.text }]}>
                  {week.systolic}/{week.diastolic}
                  <Text style={[styles.muted, { color: t.muted }]}>  · {tr('records')}: {week.count}</Text>
                </Text>
              ) : (
                <Text style={[styles.muted, { color: t.muted }]}>{tr('noWeek')}</Text>
              )}
            </Card>
            <Text style={[styles.disclaimer, { color: t.muted }]}>{tr('disclaimer')}</Text>
          </>
        )}

        {tab === 'history' && (
          <>
            <Card t={t}>
              {sorted.length === 0 ? (
                <View style={styles.empty}>
                  <Ionicons name="heart-outline" size={40} color={t.muted} />
                  <Text style={[styles.muted, { color: t.muted }]}>{tr('historyEmpty')}</Text>
                </View>
              ) : (
                sorted.map((r) => {
                  const cat = classify(r.systolic, r.diastolic);
                  return (
                    <TouchableOpacity key={r.id} style={[styles.item, { borderTopColor: t.border }]} onLongPress={() => remove(r.id)}>
                      <View style={[styles.dot, { backgroundColor: CATEGORY_COLORS[cat] }]} />
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.itemMain, { color: t.text }]}>
                          {r.systolic}/{r.diastolic}
                          {r.pulse ? <Text style={[styles.muted, { color: t.muted }]}>  · {tr('pulseShort', { v: r.pulse })}</Text> : null}
                        </Text>
                        <Text style={[styles.itemDate, { color: t.muted }]}>{formatDate(r.takenAt)}</Text>
                        <Text style={[styles.badge, { color: CATEGORY_COLORS[cat] }]}>{catLabel(cat)}</Text>
                      </View>
                    </TouchableOpacity>
                  );
                })
              )}
              {sorted.length > 0 ? <Text style={[styles.muted, { color: t.muted, marginTop: 6 }]}>{tr('deleteHint')}</Text> : null}
            </Card>
            <Card t={t}>
              <Text style={[styles.h2, { color: t.text }]}>{tr('exportTitle')}</Text>
              <Text style={[styles.muted, { color: t.muted }]}>{tr('exportHint')}</Text>
              <TouchableOpacity
                style={[styles.button, { backgroundColor: readings.length ? t.accent : t.muted }]}
                disabled={readings.length === 0}
                onPress={() => Share.share({ title: tr('shareTitle'), message: toCsv(readings, lang) })}
              >
                <Ionicons name="share-outline" size={20} color="#fff" />
                <Text style={styles.buttonText}>{tr('share')}</Text>
              </TouchableOpacity>
            </Card>
          </>
        )}

        {tab === 'charts' && <Chart readings={readings} t={t} tr={tr} catLabel={catLabel} />}
      </ScrollView>

      <View style={[styles.tabBar, { backgroundColor: t.tabBar, borderTopColor: t.border }]}>
        {TABS.map((item) => {
          const active = tab === item.key;
          const color = active ? t.accent : t.muted;
          return (
            <TouchableOpacity key={item.key} style={styles.tabItem} onPress={() => setTab(item.key)}>
              <Ionicons name={item.icon} size={24} color={color} />
              <Text style={[styles.tabLabel, { color }]}>{tr(item.label)}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );

  function formatDate(ms) {
    return new Date(ms).toLocaleString(localeTag(lang));
  }
}

function Hero({ latest, t, tr, catLabel, fmt }) {
  if (!latest) {
    return (
      <Card t={t}>
        <Text style={[styles.muted, { color: t.muted }]}>{tr('firstHint')}</Text>
      </Card>
    );
  }
  const cat = classify(latest.systolic, latest.diastolic);
  // На жёлтом фоне белый текст плохо читается: берём тёмный.
  const ink = cat === 'elevated' ? '#1c1917' : '#ffffff';
  return (
    <View style={[styles.hero, { backgroundColor: CATEGORY_COLORS[cat] }]}>
      <Text style={[styles.heroLabel, { color: ink, opacity: 0.85 }]}>{tr('lastReading')}</Text>
      <Text style={[styles.heroValue, { color: ink }]}>
        {latest.systolic}/{latest.diastolic}
      </Text>
      <Text style={[styles.heroCategory, { color: ink }]}>{catLabel(cat)}</Text>
      <Text style={[styles.heroDate, { color: ink, opacity: 0.8 }]}>{fmt(latest.takenAt)}</Text>
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
        keyboardType={text ? 'default' : 'number-pad'}
        autoCapitalize="none"
      />
    </View>
  );
}

function Card({ children, t }) {
  return <View style={[styles.card, { backgroundColor: t.card }]}>{children}</View>;
}

// Столбик на каждое измерение: от нижнего до верхнего давления. Цвет — категория.
function Chart({ readings, t, tr, catLabel }) {
  const points = useMemo(() => {
    return [...readings].sort((a, b) => a.takenAt - b.takenAt).slice(-CHART_POINTS);
  }, [readings]);

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
            const cat = classify(r.systolic, r.diastolic);
            const bottom = scale(r.diastolic);
            const height = Math.max(4, scale(r.systolic) - bottom);
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
  title: { fontSize: 26, fontWeight: '700', flexShrink: 1, marginRight: 8 },
  langSwitch: { flexDirection: 'row', borderWidth: 1, borderRadius: 8, overflow: 'hidden' },
  langBtn: { paddingVertical: 6, paddingHorizontal: 10 },
  langText: { fontSize: 13, fontWeight: '700' },
  card: { borderRadius: 16, padding: 16, gap: 10 },
  h2: { fontSize: 16, fontWeight: '600' },
  big: { fontSize: 30, fontWeight: '700' },
  muted: { fontSize: 14 },
  disclaimer: { fontSize: 12, textAlign: 'center', marginTop: 4 },
  row: { flexDirection: 'row', gap: 8 },
  field: { flex: 1, minWidth: 0, gap: 4 },
  label: { fontSize: 12, fontWeight: '500' },
  input: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 17, minWidth: 0 },
  button: { flexDirection: 'row', gap: 8, borderRadius: 12, padding: 14, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  error: { color: '#ef4444', fontSize: 14 },
  hero: { borderRadius: 20, padding: 20, gap: 4 },
  heroLabel: { fontSize: 14, fontWeight: '500' },
  heroValue: { fontSize: 52, fontWeight: '800' },
  heroCategory: { fontSize: 16, fontWeight: '600' },
  heroDate: { fontSize: 13, marginTop: 4 },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 20 },
  item: { flexDirection: 'row', gap: 12, alignItems: 'center', borderTopWidth: 1, paddingVertical: 12 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  itemMain: { fontSize: 18, fontWeight: '600' },
  itemDate: { fontSize: 13, marginTop: 2 },
  badge: { fontSize: 13, fontWeight: '600', marginTop: 2 },
  chartWrap: { height: CHART_HEIGHT + 8, marginTop: 8, justifyContent: 'flex-end' },
  refLine: { position: 'absolute', left: 0, right: 0, borderTopWidth: 1, borderStyle: 'dashed' },
  refLabel: { fontSize: 11, position: 'absolute', right: 0, top: -14 },
  bars: { alignItems: 'flex-end', gap: 8, paddingRight: 8, height: CHART_HEIGHT },
  barCol: { width: 14, height: CHART_HEIGHT, justifyContent: 'flex-end' },
  bar: { position: 'absolute', left: 0, right: 0, borderRadius: 7 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendText: { fontSize: 11 },
  tabBar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', borderTopWidth: 1, paddingBottom: 20, paddingTop: 8 },
  tabItem: { flex: 1, alignItems: 'center', gap: 2 },
  tabLabel: { fontSize: 12, fontWeight: '500' },
});
