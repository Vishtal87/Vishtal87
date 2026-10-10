import { useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, Share, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
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

const COLORS = {
  normal: '#16a34a',
  elevated: '#ca8a04',
  stage1: '#ea580c',
  stage2: '#dc2626',
  crisis: '#7f1d1d',
};

export default function App() {
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

  const week = useMemo(() => averageForDays(readings, 7), [readings]);
  const sorted = useMemo(() => sortNewestFirst(readings), [readings]);

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
  }

  function remove(id) {
    Alert.alert('Удалить запись?', '', [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Удалить', style: 'destructive', onPress: () => setReadings((prev) => prev.filter((r) => r.id !== id)) },
    ]);
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <StatusBar style="auto" />
      <Text style={styles.title}>Дневник давления</Text>
      <Text style={styles.disclaimer}>
        Приложение ведёт записи и показывает категорию по таблице AHA. Оно не ставит диагноз. По вопросам
        лечения обращайтесь к врачу.
      </Text>

      <View style={styles.card}>
        <Text style={styles.h2}>Новое измерение</Text>
        <View style={styles.row}>
          <TextInput style={styles.input} placeholder="Верх" keyboardType="number-pad" value={systolic} onChangeText={setSystolic} />
          <TextInput style={styles.input} placeholder="Низ" keyboardType="number-pad" value={diastolic} onChangeText={setDiastolic} />
          <TextInput style={styles.input} placeholder="Пульс" keyboardType="number-pad" value={pulse} onChangeText={setPulse} />
        </View>
        <TextInput
          style={styles.input}
          placeholder="Когда? дд.мм.гггг чч:мм (пусто — сейчас)"
          value={when}
          onChangeText={setWhen}
          autoCapitalize="none"
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <TouchableOpacity style={styles.button} onPress={save}>
          <Text style={styles.buttonText}>Сохранить</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.card}>
        <Text style={styles.h2}>Среднее за 7 дней</Text>
        {week ? (
          <Text style={styles.big}>
            {week.systolic}/{week.diastolic} · записей: {week.count}
          </Text>
        ) : (
          <Text style={styles.muted}>Пока нет записей за последнюю неделю</Text>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.h2}>История</Text>
        {sorted.length === 0 ? <Text style={styles.muted}>Записей пока нет</Text> : null}
        {sorted.map((r) => {
          const cat = classify(r.systolic, r.diastolic);
          return (
            <TouchableOpacity key={r.id} style={styles.item} onLongPress={() => remove(r.id)}>
              <Text style={styles.itemMain}>
                {r.systolic}/{r.diastolic}
                {r.pulse ? `  · пульс ${r.pulse}` : ''}
              </Text>
              <Text style={styles.itemDate}>{new Date(r.takenAt).toLocaleString('ru-RU')}</Text>
              <Text style={[styles.badge, { color: COLORS[cat] }]}>{CATEGORY_LABELS[cat]}</Text>
            </TouchableOpacity>
          );
        })}
        {sorted.length > 0 ? <Text style={styles.muted}>Долгое нажатие на запись — удалить</Text> : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.h2}>Экспорт</Text>
        <Text style={styles.muted}>Отправить все записи в CSV (почта, мессенджер, файлы):</Text>
        <TouchableOpacity
          style={[styles.button, readings.length === 0 && styles.buttonDisabled]}
          disabled={readings.length === 0}
          onPress={() => Share.share({ title: 'Дневник давления', message: toCsv(readings) })}
        >
          <Text style={styles.buttonText}>Поделиться CSV</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f5f5f4' },
  content: { padding: 16, paddingTop: 60, gap: 12 },
  title: { fontSize: 24, fontWeight: '700' },
  disclaimer: { color: '#57534e', fontSize: 13 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 14, gap: 8 },
  h2: { fontSize: 16, fontWeight: '600' },
  row: { flexDirection: 'row', gap: 8 },
  input: { flex: 1, borderWidth: 1, borderColor: '#d6d3d1', borderRadius: 8, padding: 10, fontSize: 16 },
  button: { backgroundColor: '#1d4ed8', borderRadius: 8, padding: 12, alignItems: 'center' },
  buttonDisabled: { backgroundColor: '#a8a29e' },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  error: { color: '#dc2626' },
  big: { fontSize: 22, fontWeight: '600' },
  muted: { color: '#78716c' },
  item: { borderTopWidth: 1, borderTopColor: '#e7e5e4', paddingVertical: 8 },
  itemMain: { fontSize: 18, fontWeight: '600' },
  itemDate: { color: '#78716c', fontSize: 13 },
  badge: { fontSize: 13, fontWeight: '600', marginTop: 2 },
  code: { fontFamily: 'monospace', fontSize: 12, color: '#44403c' },
});
