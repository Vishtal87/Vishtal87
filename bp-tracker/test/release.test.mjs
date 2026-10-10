import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkRelease } from '../scripts/check-release.mjs';

const RU = './plugins/withRuStorePay';
const NATIVE = ['expo-iap', 'react-native-ble-plx', 'react-native-health-connect', 'expo-notifications', 'expo-file-system', 'expo-document-picker', 'expo-print', 'expo-sharing'];

// Минимальный проект во временной папке: только файлы, которые читает проверка.
function fixture({ app = {}, eas = {}, docs = {}, skipRuStore = false, consoleAppId = 'ru-test-123', deps = NATIVE } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'release-check-'));
  const write = (p, text) => {
    mkdirSync(join(root, p.split('/').slice(0, -1).join('/') || '.'), { recursive: true });
    writeFileSync(join(root, p), text, 'utf8');
  };
  const baseApp = {
    version: '1.0.0',
    ios: { bundleIdentifier: 'ru.test.dnevnik' },
    android: { package: 'ru.test.dnevnik', allowBackup: false, blockedPermissions: ['android.permission.SYSTEM_ALERT_WINDOW'] },
    plugins: skipRuStore ? [] : [[RU, { consoleAppId }]],
    extra: { eas: { projectId: 'x' } },
    ...app,
  };
  write('app.json', JSON.stringify({ expo: baseApp }));
  write('eas.json', JSON.stringify({ build: { production: { android: { buildType: 'app-bundle' } } }, ...eas }));
  write('package.json', JSON.stringify({ dependencies: Object.fromEntries(deps.map((d) => [d, '1'])) }));
  write('src/purchases.mjs', "export const PRO_PLANS = { monthly: 'health_diary_pro_monthly', yearly: 'health_diary_pro_yearly' };");
  write('src/libs/RuStoreReactPay/index.tsx', 'export {};');
  write('site/privacy.html', '<html></html>');
  write('site/terms.html', '<html></html>');
  const clean = 'Документ без пропусков.\n';
  write('docs/privacy-policy.md', docs['privacy-policy.md'] ?? clean);
  write('docs/terms.md', docs['terms.md'] ?? clean);
  write('docs/store-listing.md', docs['store-listing.md'] ?? clean);
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function run(opts) {
  const f = fixture(opts);
  try {
    return checkRelease(f.root);
  } finally {
    f.cleanup();
  }
}

test('полностью заполненный проект: блокеров нет', () => {
  const r = run();
  assert.deepEqual(r.blockers, []);
  assert.deepEqual(r.placeholders, []);
});

test('заглушка com.example в идентификаторах — блокер', () => {
  const r = run({ app: { ios: { bundleIdentifier: 'com.example.bptracker' }, android: { package: 'com.example.bptracker', allowBackup: false, blockedPermissions: ['android.permission.SYSTEM_ALERT_WINDOW'] } } });
  assert.ok(r.blockers.some((b) => b.includes('com.example')));
});

test('пустой consoleAppId для RuStore — блокер', () => {
  const r = run({ consoleAppId: '' });
  assert.ok(r.blockers.some((b) => b.includes('consoleAppId')));
});

test('нет плагина RuStore — блокер', () => {
  const r = run({ skipRuStore: true });
  assert.ok(r.blockers.some((b) => b.includes(RU)));
});

test('незаполненные поля перечисляются с файлом и строкой', () => {
  const r = run({ docs: { 'privacy-policy.md': 'Заголовок\n\nДата: [ДАТА / DATE]\nКонтакт: [EMAIL]\n', 'terms.md': 'Цена: [ЦЕНА И ПЕРИОД]\n' } });
  assert.equal(r.placeholders.length, 3);
  assert.deepEqual(r.placeholders[0], { file: 'docs/privacy-policy.md', line: 3, text: '[ДАТА / DATE]' });
  assert.ok(r.blockers.some((b) => b.includes('3')));
});

test('квадратные скобки без текста (например, [1]) не считаются полем', () => {
  const r = run({ docs: { 'terms.md': 'Пункт [1] и [x]\n' } });
  assert.deepEqual(r.placeholders, []);
});

test('allowBackup не false — предупреждение о облачной копии', () => {
  const r = run({ app: { android: { package: 'ru.test.dnevnik', allowBackup: true, blockedPermissions: ['android.permission.SYSTEM_ALERT_WINDOW'] } } });
  assert.ok(r.warnings.some((w) => w.includes('allowBackup')));
});

test('не хватает нативного модуля в package.json — блокер', () => {
  const r = run({ deps: NATIVE.filter((d) => d !== 'react-native-ble-plx') });
  assert.ok(r.blockers.some((b) => b.includes('react-native-ble-plx')));
});

test('не app-bundle в production — блокер', () => {
  const r = run({ eas: { build: { production: { android: { buildType: 'apk' } } } } });
  assert.ok(r.blockers.some((b) => b.includes('app-bundle')));
});

test('проверка не меняет файлы проекта', () => {
  const f = fixture();
  try {
    const before = readFileSync(join(f.root, 'app.json'), 'utf8');
    checkRelease(f.root);
    assert.equal(readFileSync(join(f.root, 'app.json'), 'utf8'), before);
  } finally {
    f.cleanup();
  }
});
