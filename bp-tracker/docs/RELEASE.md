# Выпуск: что уже сделано и что нужно от владельца

Всё, что можно подготовить без аккаунтов, подготовлено в репозитории. Ниже только действия, которые требуют вашего входа, оплаты или решения.

## Уже готово в коде
- Иконка, адаптивная иконка Android, favicon: `scripts/make-icons.py`.
- Покупка подписки через App Store / Google Play (`expo-iap`), тарифы с ценами из магазина, восстановление покупки, проверка подписки при запуске, сохранение статуса без сети.
- Ссылки на политику конфиденциальности и условия в экране подписки (требование App Store и Google Play).
- Напоминания о приёме, редактирование записей и лекарств, экспорт и резервная копия файлом.
- Страницы документов: `site/` собираются из `docs/` командой `python3 scripts/build-site.py`.
- Скриншоты для магазинов: `store/screenshots/android` (1080×1920) и `store/screenshots/ios` (1290×2796). Feature graphic: `store/feature-graphic-1024x500.png`.
- Тексты карточки магазина, анкеты конфиденциальности Apple, Data safety и декларация Health Connect: `docs/store-listing.md`.
- Проверка готовности: `node scripts/check-release.mjs`. Она показывает, что ещё блокирует выпуск.
- Смена идентификатора: `node scripts/set-app-id.mjs ru.имя.dnevnik`.

## Что нужно сделать владельцу (по порядку)

1. **Идентификатор приложения.** Выберите и выполните: `node scripts/set-app-id.mjs ru.ваше-имя.dnevnik`.
2. **Данные разработчика.** Имя или название, контактный e-mail, дату вступления в силу, цену и срок Pro. Поля в квадратных скобках в `docs/privacy-policy.md`, `docs/terms.md`, `docs/store-listing.md`. Затем `python3 scripts/build-site.py`.
3. **GitHub Pages.** В репозитории: Settings → Pages → Source: ветка с этим кодом, папка `/`. Ссылки появятся по адресам из `src/links.mjs`. Проверьте, что `privacy.html` открывается.
4. **Аккаунт Expo.** `npx eas login`, затем `npx eas init` в папке `bp-tracker`. Команда запишет projectId в `app.json`.
5. **Важно для России.** Google Play Billing для российских пользователей не работает. Android-подписка в России идёт через **RuStore** (RuStore Pay SDK): код подключён (`plugins/withRuStorePay.js`, `src/rustore.js`, официальный мост в `src/libs/RuStoreReactPay`). Чтобы оплата заработала:
   - создайте приложение в RuStore Console с тем же пакетом, что в `app.json`;
   - создайте подписки `health_diary_pro_monthly` (199 ₽) и `health_diary_pro_yearly` (1 490 ₽) типа SUBSCRIPTION и опубликуйте их;
   - скопируйте id приложения из адреса страницы приложения (число между `apps/` и `/versions`) в `app.json` → плагин `./plugins/withRuStorePay` → `consoleAppId`;
   - подпись APK должна совпадать с подписью, которой вы публикуете приложение в RuStore (ключ можно скачать из EAS: `npx eas credentials`);
   - пересоберите приложение (`npx eas build -p android --profile production`).
   Без RuStore Console покупку проверить нельзя: сборка работает, но покупки вернут ошибку.

   Google Play Console ($25 один раз), если нужен выход вне России. Создайте приложение с тем же идентификатором. Подписки: два продукта с идентификаторами `health_diary_pro_monthly` и `health_diary_pro_yearly`, у каждого базовый план с предложением по умолчанию.
   - Личный аккаунт: перед продакшеном закрытое тестирование, 12 тестировщиков, 14 дней.
   - Первую сборку AAB загрузите вручную. Сборка: `npx eas build -p android --profile production`.
   - Для автоматической отправки: сервисный аккаунт Google, JSON-файл в `secrets/play-service-account.json` (папка в .gitignore), затем `npx eas submit -p android --latest`.
6. **App Store Connect** ($99 в год). Создайте приложение, подписки с теми же идентификаторами (группа подписок Pro). Сборка: `npx eas build -p ios --profile production`, отправка: `npx eas submit -p ios --latest`. Сначала TestFlight, потом проверка.

## Важно
- Идентификатор нельзя менять после первой загрузки.
- Покупки работают только в собранной сборке с подключёнными подписками. В Expo Go и в тестовых APK покупки недоступны.
- Тестовая сборка с флагом `EXPO_PUBLIC_TEST_PRO=1` не должна попасть в магазин. Профиль `production` этот флаг не задаёт.
- Проверка готовности (`scripts/check-release.mjs`) ничего не отправляет в магазины. Отправка всегда делается отдельной командой, которую запускает владелец.
