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
  CATEGORY_LABELS,
  averageForDays,
  classify,
  makeReading,
  parseTakenAt,
  sortNewestFirst,
  toCsv,
  validate,
} from './src/bp.mjs';

const STORAGE_KEY = 'bp-readings-v1';
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
  { key: 'input', label: 'Ввод', icon: 'add-circle-outline' },
  { key: 'history', label: 'История', icon: 'list-outline' },
  { key: 'charts', label: 'Графики', icon: 'bar-chart-outline' },
];

export default function App() {
  const scheme = useColorScheme();
  const t = scheme === 'dark' ? DARK : LIGHT;
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
  }, []);

  useEffect(() => {
    if (!loaded) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(readings)).catch(() => {});
  }, [readings, loaded]);

  const sorted = useMemo(() => sortNewestFirst(readings), [readings]);
  const latest = sorted[0] ?? null;
  const week = useMemo(() => averageForDays(readings, 7), [readings]);

  function save() {
    const v = { systolic, diastolic, pulse };
    const problem = validate(v);
    if (problem) return setError(problem);
    const date = parseTakenAt(when);
    if (date.error) return setError(date.error);
    setError(null);
    setReadings((prev) => [makeReading(v, date.takenAt), ...prev]);
    setSystolic('');
    setDiastolic('');
    setPulse('');
    setWhen('');
    Vibration.vibrate(15);
  }

  function remove(id) {
    Alert.alert('Удалить запись?', '', [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Удалить', style: 'destructive', onPress: () => setReadings((prev) => prev.filter((r) => r.id !== id)) },
    ]);
  }

  return (
    <View style={[styles.root, { backgroundColor: t.bg }]}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.title, { color: t.text }]}>Дневник давления</Text>

        {tab === 'input' && (
          <>
            <Hero latest={latest} t={t} />
            <Card t={t}>
              <Text style={[styles.h2, { color: t.text }]}>Новое измерение</Text>
              <View style={styles.row}>
                <Field label="Верхнее" t={t} value={systolic} onChange={setSystolic} />
                <Field label="Нижнее" t={t} value={diastolic} onChange={setDiastolic} />
                <Field label="Пульс" t={t} value={pulse} onChange={setPulse} />
              </View>
              <Field label="Дата и время (необязательно)" t={t} value={when} onChange={setWhen} placeholder="05.10.2026 08:30" text />
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <TouchableOpacity style={[styles.button, { backgroundColor: t.accent }]} onPress={save}>
                <Ionicons name="checkmark-circle" size={20} color="#fff" />
                <Text style={styles.buttonText}>Сохранить</Text>
              </TouchableOpacity>
            </Card>
            <Card t={t}>
              <Text style={[styles.h2, { color: t.text }]}>Среднее за 7 дней</Text>
              {week ? (
                <Text style={[styles.big, { color: t.text }]}>
                  {week.systolic}/{week.diastolic}
                  <Text style={[styles.muted, { color: t.muted }]}>  · записей: {week.count}</Text>
                </Text>
              ) : (
                <Text style={[styles.muted, { color: t.muted }]}>Нет записей за неделю</Text>
              )}
            </Card>
            <Text style={[styles.disclaimer, { color: t.muted }]}>
              Приложение показывает категорию по таблице AHA и не ставит диагноз. По лечению обращайтесь к врачу.
            </Text>
          </>
        )}

        {tab === 'history' && (
          <>
            <Card t={t}>
              {sorted.length === 0 ? (
                <View style={styles.empty}>
                  <Ionicons name="heart-outline" size={40} color={t.muted} />
                  <Text style={[styles.muted, { color: t.muted }]}>Записей пока нет</Text>
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
                          {r.pulse ? <Text style={[styles.muted, { color: t.muted }]}>  · пульс {r.pulse}</Text> : null}
                        </Text>
                        <Text style={[styles.itemDate, { color: t.muted }]}>{new Date(r.takenAt).toLocaleString('ru-RU')}</Text>
                        <Text style={[styles.badge, { color: CATEGORY_COLORS[cat] }]}>{CATEGORY_LABELS[cat]}</Text>
                      </View>
                    </TouchableOpacity>
                  );
                })
              )}
              {sorted.length > 0 ? <Text style={[styles.muted, { color: t.muted, marginTop: 6 }]}>Долгое нажатие — удалить запись</Text> : null}
            </Card>
            <Card t={t}>
              <Text style={[styles.h2, { color: t.text }]}>Экспорт</Text>
              <Text style={[styles.muted, { color: t.muted }]}>CSV для врача или для себя</Text>
              <TouchableOpacity
                style={[styles.button, { backgroundColor: readings.length ? t.accent : t.muted }]}
                disabled={readings.length === 0}
                onPress={() => Share.share({ title: 'Дневник давления', message: toCsv(readings) })}
              >
                <Ionicons name="share-outline" size={20} color="#fff" />
                <Text style={styles.buttonText}>Поделиться CSV</Text>
              </TouchableOpacity>
            </Card>
          </>
        )}

        {tab === 'charts' && <Chart readings={readings} t={t} />}
      </ScrollView>

      <View style={[styles.tabBar, { backgroundColor: t.tabBar, borderTopColor: t.border }]}>
        {TABS.map((item) => {
          const active = tab === item.key;
          const color = active ? t.accent : t.muted;
          return (
            <TouchableOpacity key={item.key} style={styles.tabItem} onPress={() => setTab(item.key)}>
              <Ionicons name={item.icon} size={24} color={color} />
              <Text style={[styles.tabLabel, { color }]}>{item.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

function Hero({ latest, t }) {
  if (!latest) {
    return (
      <Card t={t}>
        <Text style={[styles.muted, { color: t.muted }]}>Введите первое измерение ниже</Text>
      </Card>
    );
  }
  const cat = classify(latest.systolic, latest.diastolic);
  // На жёлтом фоне белый текст плохо читается: берём тёмный.
  const ink = cat === 'elevated' ? '#1c1917' : '#ffffff';
  return (
    <View style={[styles.hero, { backgroundColor: CATEGORY_COLORS[cat] }]}>
      <Text style={[styles.heroLabel, { color: ink, opacity: 0.85 }]}>Последнее измерение</Text>
      <Text style={[styles.heroValue, { color: ink }]}>
        {latest.systolic}/{latest.diastolic}
      </Text>
      <Text style={[styles.heroCategory, { color: ink }]}>{CATEGORY_LABELS[cat]}</Text>
      <Text style={[styles.heroDate, { color: ink, opacity: 0.8 }]}>{new Date(latest.takenAt).toLocaleString('ru-RU')}</Text>
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
function Chart({ readings, t }) {
  const points = useMemo(() => {
    return [...readings].sort((a, b) => a.takenAt - b.takenAt).slice(-CHART_POINTS);
  }, [readings]);

  if (points.length === 0) {
    return (
      <Card t={t}>
        <View style={styles.empty}>
          <Ionicons name="analytics-outline" size={40} color={t.muted} />
          <Text style={[styles.muted, { color: t.muted }]}>Графики появятся после первых записей</Text>
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
      <Text style={[styles.h2, { color: t.text }]}>Последние {points.length} измерений</Text>
      <Text style={[styles.muted, { color: t.muted }]}>Столбик — от нижнего до верхнего давления</Text>
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
            <Text style={[styles.legendText, { color: t.muted }]}>{CATEGORY_LABELS[key]}</Text>
          </View>
        ))}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 16, paddingTop: 60, paddingBottom: 110, gap: 12 },
  title: { fontSize: 28, fontWeight: '700', marginBottom: 4 },
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
  heroLabel: { color: 'rgba(255,255,255,0.85)', fontSize: 14, fontWeight: '500' },
  heroValue: { color: '#fff', fontSize: 52, fontWeight: '800' },
  heroCategory: { color: '#fff', fontSize: 16, fontWeight: '600' },
  heroDate: { color: 'rgba(255,255,255,0.8)', fontSize: 13, marginTop: 4 },
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
