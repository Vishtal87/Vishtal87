// Меняет идентификатор приложения сразу для iOS и Android: node scripts/set-app-id.mjs ru.имя.dnevnik
// Идентификатор нельзя поменять после первой загрузки в магазин, поэтому выбирайте внимательно.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const id = process.argv[2];
const valid = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){2,}$/i;
if (!id || !valid.test(id) || id.startsWith('com.example')) {
  console.error('Укажите идентификатор вида ru.имя.dnevnik (латиница, минимум три части, не com.example).');
  process.exit(1);
}
const path = join(dirname(fileURLToPath(import.meta.url)), '..', 'app.json');
const app = JSON.parse(readFileSync(path, 'utf8'));
app.expo.ios = { ...app.expo.ios, bundleIdentifier: id };
app.expo.android = { ...app.expo.android, package: id };
writeFileSync(path, JSON.stringify(app, null, 2) + '\n', 'utf8');
console.log(`Идентификатор установлен: ${id} (iOS и Android). Проверка: node scripts/check-release.mjs`);
