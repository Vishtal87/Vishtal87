# Карточка приложения и анкеты магазинов / Store listing and forms

Черновик. Заполните оставшиеся поля в квадратных скобках до отправки.

## Блокеры до отправки на проверку

1. **Покупка не подключена.** Кнопка «Подписаться» сейчас показывает заглушку. Apple и Google отклонят приложение с платными функциями без работающей покупки. Нужно подключить in-app покупки (например, RevenueCat или expo-iap) и создать продукты в App Store Connect и Google Play Console.
2. **Восстановление покупки** тоже заглушка (нужна для App Store, правило 3.1.1).
3. **Идентификаторы** `com.example.bptracker` (iOS bundleIdentifier и Android package) нужно заменить на свои. После публикации их нельзя изменить.
4. **Ссылки** на политику конфиденциальности и условия должны быть опубликованы по постоянному URL (например, GitHub Pages) и указаны в карточке и в приложении.
5. **Цена Pro** не выбрана. Она нужна в условиях, в тексте подписки и в продуктах магазина.
6. **Иконка 1024×1024 и скриншоты** iPhone (6.9″ / 6.5″) и Android (телефон, не менее 2 шт.) — нужно сделать с финальной версией.

## Название и подзаголовок

- Название: Дневник здоровья
- Подзаголовок (iOS, до 30 символов): Давление, сахар, вес
- Краткое описание Google Play (до 80 символов): Записи давления, сахара и веса. PDF-отчёт для врача.

## Описание (RU)

Дневник здоровья — простой способ вести записи измерений и не терять их.

Что можно записывать:
- артериальное давление и пульс — категория по таблице AHA 2017 для каждой записи;
- уровень сахара в крови — с отметкой «натощак», «до еды», «после еды» или «перед сном»;
- вес;
- приём лекарств: время приёма, напоминания и отметки «принял» / «пропустил» (журнал — Pro, напоминания для одного лекарства бесплатно);

Что есть:
- история и графики за выбранный период;
- среднее давление за неделю;
- экспорт в CSV;
- PDF-отчёт для врача (Pro);
- резервная копия и восстановление (Pro);
- синхронизация с Health Connect на Android (Pro).

Данные хранятся на телефоне. Регистрации нет, реклама не показывается.

Приложение не ставит диагнозов и не даёт рекомендаций. Оно не заменяет врача.

Подписка Pro: 199 ₽ в месяц или 1 490 ₽ в год. Оплата списывается с аккаунта магазина приложений (App Store или RuStore). Подписка продлевается автоматически, отменить можно в настройках магазина.
Политика конфиденциальности: https://vishtal87.github.io/Vishtal87/bp-tracker/site/privacy.html. Условия: https://vishtal87.github.io/Vishtal87/bp-tracker/site/terms.html.

## Description (EN)

Health Diary is a simple way to keep your health measurements in one place.

Record:
- blood pressure and pulse, with the AHA 2017 category for each reading;
- blood glucose, tagged as fasting, before meal, after meal or bedtime;
- weight;
- medicine times with reminders, and "taken" / "missed" marks (intake log is Pro; reminders for one medicine are free).

Also:
- history and charts for a chosen period;
- 7-day blood pressure average;
- CSV export;
- doctor PDF report (Pro);
- backup and restore (Pro);
- Health Connect sync on Android (Pro).

Your data stays on your phone. No sign-up, no ads.

Health Diary is not a medical device. It does not diagnose or recommend treatment and does not replace your doctor.

Pro subscription: 199 RUB per month or 1,490 RUB per year. Payment is charged to your App Store or RuStore account. The subscription renews automatically; cancel in store settings.
Privacy policy: https://vishtal87.github.io/Vishtal87/bp-tracker/site/privacy.html. Terms: https://vishtal87.github.io/Vishtal87/bp-tracker/site/terms.html.

## Категория и возрастной рейтинг

- Категория: Здоровье и фитнес (Health & Fitness).
- App Store: 4+ (нет пользовательского контента, веб-доступа и азартных механик). Не указывать «медицинское приложение» без регулирования; формулировки не обещают диагностики.
- Google Play: заполнить анкету рейтинга IARC (ответы «нет» на насилие, контент для взрослых, азартные игры, пользовательский контент).

## Apple: App Privacy (анкета)

- Сбор данных: **Данные не собираются** (Data Not Collected), если не добавлены аналитика или отчёты о сбоях, отправляемые разработчику.
- Health и Fitness: приложение не использует HealthKit (в версии 1.0 не подключено).
- Покупки: обрабатываются App Store.

## Google Play: Data safety

- Данные собираются: **нет**. Передаются третьим лицам: **нет**.
- Шифрование при передаче: не применимо (данные не передаются с устройства по сети приложением).
- Пользователь может удалить данные: да, в приложении и удалением приложения.
- Health Connect: приложение записывает данные о давлении, глюкозе и весе по действию пользователя и читает те же типы данных, чтобы импортировать измерения приборов. Данные не передаются третьим лицам. Декларация Health Connect в Play Console обязательна: указать цель «личный дневник измерений» и чтение и запись по каждому типу.

## Заметки для проверяющих (App Review / Google)

Приложение — личный дневник измерений. Оно не ставит диагнозов и не даёт медицинских рекомендаций.
Для проверки Pro: [тестовый аккаунт песочницы / тестовый сценарий], либо описать, что Pro открывается покупкой в песочнице.
Health Connect (Android) используется для записи и чтения измерений давления, сахара и веса по действию пользователя.
