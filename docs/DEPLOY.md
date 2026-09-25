# Развёртывание на своём сервере (VPS + домен)

Результат: сайт на `https://ваш-домен` с настоящими новостями. Сертификат HTTPS выпускается и продлевается
автоматически, новости собираются круглосуточно, база ежедневно копируется в `./backups`.

Время: ~30–40 минут, из них большую часть занимает загрузка баз мест.

## 1. Что понадобится

| Что | Минимум | Комментарий |
|---|---|---|
| VPS | 2 vCPU, **4 ГБ RAM**, 40 ГБ SSD, Ubuntu 22.04/24.04 | На 8 ГБ комфортнее, если позже будет вся Россия и много источников |
| Домен | любой, например `news.example.ru` | Нужна A-запись на IP сервера |
| Доступ | SSH от root или от пользователя с sudo | |

## 2. Домен

В панели регистратора домена создайте **A-запись**: имя `news` (или `@` для корня) → IP вашего сервера.
Проверить, что запись видна: `ping news.example.ru` должен показать IP сервера. Обычно запись начинает
работать через 5–30 минут.

## 3. Подготовка сервера (один раз)

```bash
ssh root@IP-сервера
apt update && apt -y upgrade
curl -fsSL https://get.docker.com | sh             # Docker + Docker Compose
ufw allow 22,80,443/tcp && ufw allow 443/udp && ufw --force enable   # SSH и веб, остальное закрыто
```

## 4. Установка

```bash
git clone -b claude/geo-news-interactive-map-29asu8 https://github.com/Vishtal87/Vishtal87.git /opt/pulse
cd /opt/pulse
cp .env.example .env
nano .env
```

В `.env` заполните:

- `DOMAIN` — ваш домен (`news.example.ru`);
- `ACME_EMAIL` — почта для уведомлений Let's Encrypt;
- `POSTGRES_PASSWORD` — пароль базы. Сгенерируйте командой `openssl rand -hex 24`;
- `GEONEWS_USER_AGENT` — как сборщик представляется сайтам. Укажите свой домен и почту.

Для сервера с 8 ГБ поднимите `PG_SHARED_BUFFERS`, `PG_EFFECTIVE_CACHE` и `API_WORKERS`: подсказка есть в самом файле.

Затем выполните по очереди:

```bash
scripts/prod.sh init             # сборка, схема БД, базовая база мест (~5–10 мин)
scripts/prod.sh geonames RU      # полная база мест России: все хутора и деревни (~10–20 мин)
scripts/prod.sh verify-sources   # проверка источников Кубани и федеральных СМИ
scripts/prod.sh up               # запуск
```

`verify-sources` проверяет кандидатов из `backend/config/sources.ru.candidates.yaml`: доступность,
разрешение robots.txt, поиск RSS на главной странице, свежесть. Рабочие источники он записывает в
`backend/config/sources.ru.yaml`. Откройте этот файл и уберите лишнее. Telegram-каналы добавляются так же,
как в разделе «Источники» ниже.

После `up` откройте `https://ваш-домен`. Первые новости появятся через несколько минут: источники
опрашиваются раз в 5 минут.

## 5. Повседневные команды

| Команда | Что делает |
|---|---|
| `scripts/prod.sh status` | состояние контейнеров и ответ сайта |
| `scripts/prod.sh logs worker` | журнал сбора и обработки новостей (также `api`, `caddy`, `db`) |
| `scripts/prod.sh update` | подтянуть новую версию из GitHub и перезапустить; миграции применяются сами |
| `scripts/prod.sh backup` | сделать копию базы сейчас; автоматически копии делаются раз в `BACKUP_EVERY_HOURS` часов |
| `scripts/prod.sh restore geonews-….dump` | восстановить базу из `./backups` (сбор и API на это время останавливаются) |
| `scripts/prod.sh down` | остановить всё; данные остаются |

Копии базы лежат в `/opt/pulse/backups`. Хранится `BACKUP_KEEP` последних. Время от времени уносите их
с сервера, например `scp root@IP:/opt/pulse/backups/*.dump .`

## 6. Источники

- Список лежит в `backend/config/sources.ru.yaml`; после правки выполните `scripts/prod.sh up`.
- Публичный Telegram-канал добавляется записью:
  ```yaml
  - {slug: tg-kanal, name: "Название канала", type: telegram, connector: telegram_public, access_model: public_web,
     url: "https://t.me/s/имя_канала", languages: [ru], country: RU, timezone: Europe/Moscow,
     home: {q: "Динская", cc: RU, kind: locality}}
  ```
  Поле `home` — территория, о которой пишет канал. Это главный сигнал для выбора между одноимёнными сёлами.
- Правила, которые соблюдает сборщик (robots.txt, частота, только отрывок и ссылка на оригинал),
  описаны в [SOURCES.md](SOURCES.md).

## 7. Как это устроено на сервере

```
Интернет → Caddy (:443, HTTPS, сертификат Let's Encrypt)
            → web (nginx: сайт + прокси /api, /tiles)
               → api (FastAPI, API_WORKERS процессов)
                  ↔ db (PostgreSQL + PostGIS, наружу закрыт)
            worker (сбор, обработка, слияние событий) ↔ db
            backup (pg_dump по расписанию → ./backups)
```

Наружу открыты только порты 80 и 443. На 80 работает перенаправление на HTTPS и проверка Let's Encrypt.

## 8. Если что-то не так

| Симптом | Что проверить |
|---|---|
| Сайт не открывается, в `logs caddy` ошибки сертификата | A-запись указывает на сервер? Порты 80/443 открыты (`ufw status`)? |
| `up` пишет «sources.ru.yaml not found» | Не выполнен `scripts/prod.sh verify-sources` |
| Карта есть, новостей нет | `scripts/prod.sh logs worker`: есть ли строки `polled …`, нет ли `robots.txt`/HTTP-ошибок |
| Баннер «N источников временно недоступны» | Сайт источника не отвечает или сменил адрес фида. Проверьте его в `verify-sources` |
| Мало памяти (`docker stats`) | Уменьшите `API_WORKERS` и `PG_SHARED_BUFFERS` в `.env`, затем `scripts/prod.sh up` |

Смена `POSTGRES_PASSWORD` после первого запуска **не меняет** пароль уже созданной базы. Оставьте прежний
или смените его в самой базе.
