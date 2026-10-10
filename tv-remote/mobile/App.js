import { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Button, StyleSheet, Text, TextInput, View } from 'react-native';
import { createDevice, KEYS } from '../src/index.mjs';

const BRANDS = ['roku', 'samsung'];

export default function App() {
  const [brand, setBrand] = useState('roku');
  const [host, setHost] = useState('');
  const [status, setStatus] = useState('Введите адрес телевизора');
  const [device, setDevice] = useState(null);

  function connect() {
    try {
      const d = createDevice(brand, { host: host.trim(), onToken: () => {} });
      setDevice(d);
      setStatus(`Готово: ${brand}, ${host.trim()}`);
    } catch (e) {
      setStatus(e.message);
    }
  }

  async function press(key) {
    if (!device) return setStatus('Сначала подключитесь');
    try {
      await device.sendKey(key);
      setStatus(`Отправлено: ${key}`);
    } catch (e) {
      setStatus(`Ошибка: ${e.message}`);
    }
  }

  async function powerOn() {
    if (!device?.powerOn) return setStatus('Включение по сети не поддерживается для этого бренда');
    try {
      await device.powerOn();
      setStatus('Команда включения отправлена');
    } catch (e) {
      setStatus(`Ошибка: ${e.message}`);
    }
  }

  return (
    <View style={styles.container}>
      <StatusBar style="auto" />
      <Text style={styles.title}>Пульт (тест)</Text>

      <View style={styles.row}>
        {BRANDS.map((b) => (
          <Button key={b} title={b} onPress={() => setBrand(b)} color={brand === b ? '#2563eb' : '#888'} />
        ))}
      </View>

      <TextInput
        style={styles.input}
        placeholder="IP телевизора, например 192.168.1.50"
        value={host}
        onChangeText={setHost}
        keyboardType="numbers-and-punctuation"
        autoCapitalize="none"
      />
      <Button title="Подключиться" onPress={connect} />

      <Text style={styles.status}>{status}</Text>

      <View style={styles.row}>
        <Button title="Вкл" onPress={powerOn} />
        <Button title="Выкл" onPress={() => device?.powerOff ? device.powerOff().catch((e) => setStatus(e.message)) : setStatus('Не поддерживается')} />
      </View>
      <View style={styles.row}>
        <Button title="Гр+" onPress={() => press(KEYS.VOLUME_UP)} />
        <Button title="Гр-" onPress={() => press(KEYS.VOLUME_DOWN)} />
        <Button title="Без звука" onPress={() => press(KEYS.MUTE)} />
      </View>
      <View style={styles.row}>
        <Button title="↑" onPress={() => press(KEYS.UP)} />
        <Button title="↓" onPress={() => press(KEYS.DOWN)} />
        <Button title="←" onPress={() => press(KEYS.LEFT)} />
        <Button title="→" onPress={() => press(KEYS.RIGHT)} />
      </View>
      <View style={styles.row}>
        <Button title="OK" onPress={() => press(KEYS.OK)} />
        <Button title="Назад" onPress={() => press(KEYS.BACK)} />
        <Button title="Домой" onPress={() => press(KEYS.HOME)} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, paddingTop: 60, gap: 12, backgroundColor: '#fff' },
  title: { fontSize: 22, fontWeight: '600' },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', justifyContent: 'center' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10 },
  status: { color: '#444', minHeight: 40 },
});
