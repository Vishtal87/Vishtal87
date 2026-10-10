// Проверка готовности к выпуску. Печатает блокеры (без них магазин не примет сборку) и предупреждения.
// Запуск: node scripts/check-release.mjs. Код выхода 1, если есть блокеры.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const app = JSON.parse(read('app.json')).expo;
const eas = JSON.parse(read('eas.json'));
const blockers = [];
const warnings = [];

const bundleId = app.ios?.bundleIdentifier ?? '';
const pkg = app.android?.package ?? '';
if (bundleId.startsWith('com.example') || pkg.startsWith('com.example')) {
  blockers.push(`Идентификатор приложения ${bundleId || '—'} / ${pkg || '—'} — заглушка com.example. Нужен свой (например ru.имя.dnevnik).`);
}
if (!app.version) blockers.push('Не задана версия app.json → expo.version.');
if (!eas.build?.production?.android?.buildType || eas.build.production.android.buildType !== 'app-bundle') {
  blockers.push('В eas.json production должен собирать AAB (app-bundle) для Google Play.');
}
if (!existsSync(join(root, 'secrets/play-service-account.json'))) {
  warnings.push('Нет secrets/play-service-account.json: автоматическая отправка в Google Play (eas submit) не заработает. Первую загрузку можно сделать вручную.');
}

// Плейсхолдеры в юридических документах и карточке магазина: [ЧТО-ТО].
for (const f of ['docs/privacy-policy.md', 'docs/terms.md', 'docs/store-listing.md']) {
  const found = [...new Set(read(f).match(/\[[^\]\n]{2,}\]/g) ?? [])];
  if (found.length) blockers.push(`${f}: не заполнено ${found.length} полей, например ${found.slice(0, 3).join(', ')}.`);
}

// Продукты подписки должны быть созданы в магазинах с этими идентификаторами.
const purchases = read('src/purchases.mjs');
if (!/health_diary_pro_monthly/.test(purchases) || !/health_diary_pro_yearly/.test(purchases)) {
  blockers.push('В src/purchases.mjs нет идентификаторов подписок.');
}
warnings.push('Продукты подписки health_diary_pro_monthly / health_diary_pro_yearly нужно создать в App Store Connect и Google Play Console с этими же идентификаторами.');

// Страницы с политикой должны быть собраны и опубликованы (GitHub Pages).
if (!existsSync(join(root, 'site/privacy.html')) || !existsSync(join(root, 'site/terms.html'))) {
  blockers.push('Нет site/privacy.html и site/terms.html: запустите python3 scripts/build-site.py.');
}
warnings.push('Включите GitHub Pages (Settings → Pages → ветка с этим кодом, папка /) и проверьте, что открываются ссылки из src/links.mjs.');

if (!existsSync(join(root, 'eas.json'))) blockers.push('Нет eas.json.');
if (!app.extra?.eas?.projectId) {
  warnings.push('Нет expo.extra.eas.projectId: выполните `npx eas init` от аккаунта Expo (это действие в вашем аккаунте).');
}

const print = (title, items) => {
  if (items.length === 0) return;
  console.log(`\n${title}`);
  for (const item of items) console.log(`  - ${item}`);
};
print('БЛОКЕРЫ', blockers);
print('ПРЕДУПРЕЖДЕНИЯ', warnings);
console.log(blockers.length ? `\nИтог: блокеров ${blockers.length}.` : '\nИтог: блокеров нет.');
process.exit(blockers.length ? 1 : 0);
