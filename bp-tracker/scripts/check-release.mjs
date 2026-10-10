// Проверка готовности к выпуску. Печатает блокеры (без них магазин не примет сборку) и предупреждения.
// Запуск: node scripts/check-release.mjs. Код выхода 1, если есть блокеры.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RUSTORE_PLUGIN = './plugins/withRuStorePay';
const PLACEHOLDER_FILES = ['docs/privacy-policy.md', 'docs/terms.md', 'docs/store-listing.md'];
const NATIVE_MODULES = ['expo-iap', 'react-native-ble-plx', 'react-native-health-connect', 'expo-notifications', 'expo-file-system', 'expo-document-picker', 'expo-print', 'expo-sharing'];

// Проверяет папку проекта. Возвращает { blockers, warnings, placeholders }; сам ничего не меняет.
export function checkRelease(root) {
  const exists = (p) => existsSync(join(root, p));
  const read = (p) => readFileSync(join(root, p), 'utf8');
  const blockers = [];
  const warnings = [];
  const placeholders = [];

  const app = JSON.parse(read('app.json')).expo;
  const eas = JSON.parse(read('eas.json'));

  const bundleId = app.ios?.bundleIdentifier ?? '';
  const pkg = app.android?.package ?? '';
  if (!bundleId || !pkg) blockers.push('Не задан bundleIdentifier (iOS) или package (Android) в app.json.');
  if (bundleId.startsWith('com.example') || pkg.startsWith('com.example')) {
    blockers.push(`Идентификатор ${bundleId || '—'} / ${pkg || '—'} — заглушка com.example. Нужен свой, например ru.имя.dnevnik. Команда: node scripts/set-app-id.mjs.`);
  }
  if (bundleId && pkg && bundleId !== pkg) warnings.push(`iOS (${bundleId}) и Android (${pkg}) идентификаторы различаются. Обычно их делают одинаковыми.`);
  if (!app.version) blockers.push('Не задана версия app.json → expo.version.');
  if (app.android?.allowBackup !== false) warnings.push('android.allowBackup не false: данные приложения могут попасть в облачную копию Google Drive.');
  if (!(app.android?.blockedPermissions ?? []).includes('android.permission.SYSTEM_ALERT_WINDOW')) {
    warnings.push('SYSTEM_ALERT_WINDOW не заблокирован в android.blockedPermissions: Play попросит обоснование.');
  }

  if (eas.build?.production?.android?.buildType !== 'app-bundle') {
    blockers.push('В eas.json production должен собирать AAB (app-bundle) для Google Play.');
  }
  if (!exists('secrets/play-service-account.json')) {
    warnings.push('Нет secrets/play-service-account.json: автоматическая отправка в Google Play (eas submit) не заработает.');
  }

  // RuStore: без id приложения из RuStore Console покупки в Android не работают.
  const ruPlugin = (app.plugins ?? []).find((p) => Array.isArray(p) && p[0] === RUSTORE_PLUGIN);
  if (!ruPlugin) {
    blockers.push(`Нет плагина ${RUSTORE_PLUGIN} в app.json: оплата в RuStore не подключена.`);
  } else if (!ruPlugin[1]?.consoleAppId) {
    blockers.push('Не задан consoleAppId в плагине RuStore (app.json): без него оплата в RuStore не заработает.');
  }
  if (!exists('src/libs/RuStoreReactPay/index.tsx')) blockers.push('Нет официального моста RuStore Pay в src/libs/RuStoreReactPay.');

  // Незаполненные поля в документах: показываем каждое место, а не только количество.
  for (const f of PLACEHOLDER_FILES) {
    read(f).split('\n').forEach((line, i) => {
      for (const m of line.matchAll(/\[[^\]\n]{2,}\]/g)) placeholders.push({ file: f, line: i + 1, text: m[0] });
    });
  }
  if (placeholders.length) blockers.push(`В документах не заполнено полей: ${placeholders.length}. Список ниже.`);

  const productIds = ['health_diary_pro_monthly', 'health_diary_pro_yearly'];
  const purchases = read('src/purchases.mjs');
  if (!productIds.every((id) => purchases.includes(id))) blockers.push('В src/purchases.mjs нет идентификаторов подписок.');
  warnings.push(`Продукты подписки ${productIds.join(' и ')} нужно создать в App Store Connect, Google Play и RuStore с этими же идентификаторами.`);

  if (!exists('site/privacy.html') || !exists('site/terms.html')) {
    blockers.push('Нет site/privacy.html и site/terms.html: запустите python3 scripts/build-site.py.');
  }
  warnings.push('Включите GitHub Pages (Settings → Pages → ветка с этим кодом, папка /) и проверьте ссылки из src/links.mjs.');

  if (!app.extra?.eas?.projectId) warnings.push('Нет expo.extra.eas.projectId: выполните npx eas init от аккаунта Expo.');

  const declared = Object.keys(JSON.parse(read('package.json')).dependencies ?? {});
  const missing = NATIVE_MODULES.filter((m) => !declared.includes(m));
  if (missing.length) blockers.push(`Нативные модули не указаны в package.json: ${missing.join(', ')}.`);

  return { blockers, warnings, placeholders };
}

function printReport({ blockers, warnings, placeholders }) {
  const print = (title, items) => {
    if (items.length === 0) return;
    console.log(`\n${title}`);
    for (const item of items) console.log(`  - ${item}`);
  };
  print('БЛОКЕРЫ', blockers);
  if (placeholders.length) {
    console.log('\nНезаполненные поля:');
    for (const p of placeholders) console.log(`  - ${p.file}:${p.line}  ${p.text}`);
  }
  print('ПРЕДУПРЕЖДЕНИЯ', warnings);
  console.log(blockers.length ? `\nИтог: блокеров ${blockers.length}.` : '\nИтог: блокеров нет.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const result = checkRelease(root);
  printReport(result);
  process.exit(result.blockers.length ? 1 : 0);
}
