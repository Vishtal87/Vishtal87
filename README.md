# Pulse · LIVE GEO NEWS

Новости, которые исследуют через географию. Интерактивная 3D-Земля ведёт от планеты к стране, региону,
району, городу, посёлку, хутору и точке. У каждого места с данными своя лента, даже у деревни на 50 жителей.
Публикации разных источников склеиваются в **события**. Для каждого события видны все оригиналы, время
каждого сообщения, таймлайн, метка «кто сообщает» и объяснение «почему это событие здесь». Новые
события приходят без перезагрузки страницы.

> **Статус: рабочий MVP, проверенный офлайн.** Всё собрано и протестировано в песочнице без доступа к
> новостным сайтам и к GeoNames. Поэтому источники здесь **синтетические**: стенд `devstand`, в интерфейсе
> висит баннер «Демо-режим». Газеттир — офлайн-подмножество GeoNames (235 тыс. н.п.). Коннекторы к реальным
> источникам и импортёр полного GeoNames написаны и покрыты тестами на данных того же формата, но на живых
> данных ещё не прогонялись. Подробно — в [docs/VERIFICATION.md](docs/VERIFICATION.md).

## Быстрый старт (Docker)

```bash
scripts/fetch_offline_data.sh            # не обязательно: Dockerfile скачивает бандл сам (нужен доступ к npm)
docker compose --profile demo up --build
```

- Интерфейс: <http://localhost:8080>. Демо-стенд источников: <http://localhost:8090>.
- Первый запуск ~4–5 минут: сервис `setup` применяет миграции и загружает газеттир (271 761 объект).
  Повторные запуски пропускают загрузку (`import-offline --if-empty`).
- Выпустить live-публикации демо-стенда: `curl -X POST 'localhost:8090/control/release?n=2'`.
  Через 20–40 с они появятся на карте и во всплывающем уведомлении.
- Без профиля `demo` синтетические источники не запускаются. Реальные источники подключаются через
  проверенный реестр: `geonews check-sources sources.ru.candidates.yaml --out …`, см. [docs/SOURCES.md](docs/SOURCES.md).

## Продакшн: свой сервер с доменом

HTTPS (Let's Encrypt через Caddy), настоящие источники, ежедневные копии базы. На чистом Ubuntu/Debian-сервере
под root достаточно одной команды: адрес сайта она выведет в конце.

```bash
curl -fsSL https://raw.githubusercontent.com/Vishtal87/Vishtal87/claude/geo-news-interactive-map-29asu8/scripts/bootstrap-server.sh | bash
```

То же вручную, одним скриптом:

```bash
cp .env.example .env && nano .env        # домен, IP, пароль БД
scripts/prod.sh init                     # сборка, схема, базовая база мест
scripts/prod.sh geonames RU              # полная база мест России (все хутора)
scripts/prod.sh verify-sources           # проверка источников Кубани и федеральных СМИ
scripts/prod.sh up                       # запуск: https://ваш-домен
```

Пошагово, с подготовкой сервера и ответами на частые проблемы: [docs/DEPLOY.md](docs/DEPLOY.md).

## Локальная разработка

Нужны PostgreSQL 16 + PostGIS 3.4, Python 3.11, Node 22 + pnpm.

```bash
# данные
scripts/fetch_offline_data.sh                         # world-atlas, cities.json, iso3166-2-db → data/vendor
# бэкенд
cd backend && python3.11 -m venv .venv && .venv/bin/pip install -e '.[dev]'
createuser geonews -P && createdb -O geonews geonews   # пароль geonews или свой GEONEWS_DSN
sudo -u postgres psql -d geonews -c 'CREATE EXTENSION postgis; CREATE EXTENSION pg_trgm'
.venv/bin/python -m geonews.cli migrate
.venv/bin/python -m geonews.cli load-categories
.venv/bin/python -m geonews.cli import-offline         # ~3,5 мин
.venv/bin/python -m geonews.cli load-sources           # sources.demo.yaml по умолчанию
# фронтенд
cd ../frontend && pnpm install
# всё вместе: db api ingest process maintenance devstand web; логи в .run/
cd .. && scripts/devctl.sh start          # затем откройте http://localhost:5173
```

Полный газеттир со всеми хуторами и деревнями (нужен доступ к download.geonames.org):

```bash
scripts/fetch_geonames.sh RU DE            # или allCountries (~400 МБ)
backend/.venv/bin/python -m geonews.cli import-geonames RU DE
```

## Проверки

```bash
cd backend && .venv/bin/python -m pytest -q                      # 41 тест (unit + интеграционные на geonews_test)
.venv/bin/python -m geonews.tools.eval_geoparse                    # golden-набор геолокации, 45 случаев
.venv/bin/python -m geonews.tools.eval_pipeline -v                 # сквозная сверка с gold-разметкой devstand
cd ../frontend && pnpm typecheck && node e2e/acceptance.mjs        # 14 шагов критерия готовности (нужен свежий стенд)
cd .. && backend/.venv/bin/python scripts/loadtest.py insert       # нагрузка: 1 млн событий; затем measure, cleanup
```

## Конфигурация (переменные окружения)

| Переменная | По умолчанию | Назначение |
|---|---|---|
| `GEONEWS_DSN` | `postgresql://geonews:geonews@127.0.0.1:5432/geonews` | БД |
| `GEONEWS_SOURCES` | `sources.demo.yaml` | реестр источников (имя файла в `backend/config/` или путь) |
| `DEVSTAND_URL` | `http://127.0.0.1:8090` | адрес демо-стенда для `sources.demo.yaml` |
| `GEONEWS_LANGUAGES` | `ru,uk,en,de,fr,es,it,pl,zh,pt,tr,be,kk` | языки детектора |
| `GEONEWS_RAW_RETENTION_DAYS` | `30` | сколько хранить сырые ответы источников |
| `GEONEWS_LIVE_MAX_AGE_HOURS` | `72` | материалы старше этого не считаются «живыми» |
| `GEONEWS_HOST_INTERVAL_S` | `1.0` | минимальный интервал запросов к одному хосту |
| `GEONEWS_MAINTENANCE_INTERVAL_S` | `30` | период фонового слияния событий и очистки |
| `GEONEWS_USER_AGENT` | `GeoNewsBot/0.1 (+…)` | User-Agent сборщика, укажите контакт |
| `GEONEWS_CORS` | `http://localhost:5173,…` | разрешённые origin для API |

## Структура

```
backend/geonews/
  domain/        нормализация текста и лемматизация, таксономия мест, лексикон типов н.п., геоматематика
  gazetteer/     импорт GeoNames (офлайн-бандл и полные дампы), иерархия, поиск мест
  ingestion/     вежливый fetcher (robots.txt, rate-limit, условный GET) и коннекторы rss/atom, telegram, youtube, html, gdelt
  pipeline/      normalize → language → dates → geoparse → classify → dedup → clustering → trust → event_builder
  queue/         очередь задач на Postgres (SKIP LOCKED)
  workers/       ingest, process, maintenance
  realtime/      LISTEN/NOTIFY → SSE-подписчики
  api/           FastAPI: гео-поиск, агрегаты карты, ленты мест, карточка события, SSE, векторные тайлы
backend/config/  категории, алиасы газеттира, реестры источников (demo и example)
devstand/        симулятор источников с gold-разметкой, выпуском live-записей и инъекцией сбоев
frontend/src/    React + MapLibre: глобус, поиск, фильтры, панель места, карточка события, live
docs/            исследование, архитектура, модель данных, конвейер, источники, журнал проверок
```

## Документация

- [docs/RESEARCH.md](docs/RESEARCH.md): исследование технологий и обоснование выбора
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): архитектура и ADR
- [docs/DATA_MODEL.md](docs/DATA_MODEL.md): схема PostGIS и индексы под обязательные запросы
- [docs/PIPELINE.md](docs/PIPELINE.md): геолокация, дедупликация, кластеризация, доверие
- [docs/SOURCES.md](docs/SOURCES.md): источники, модель доступа, правовые правила, проверка кандидатов
- [docs/DEPLOY.md](docs/DEPLOY.md): развёртывание на VPS с доменом, бэкапы, обновления
- [docs/VERIFICATION.md](docs/VERIFICATION.md): что проверено, как и с какими цифрами; red team; нагрузка

## Данные и лицензии

GeoNames (CC-BY 4.0, атрибуция показана на карте) · Natural Earth через `world-atlas` (public domain) ·
`cities.json` (CC-BY 4.0) · `iso3166-2-db` (MIT) · глифы Noto через `smp-noto-glyphs` (OFL) · Roboto Flex (OFL).
