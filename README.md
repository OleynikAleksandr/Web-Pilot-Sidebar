# Web Pilot Sidebar

Расширение браузера, которое встраивает сайдбар Project Web Pilot в настоящую страницу chatgpt.com (позже — claude.ai). Слева — проекты, сессии и прогресс текущего плана, справа — обычный веб-чат провайдера с твоим входом.

Всё, что работает с проектами (репозитории, WorkflowKit, MCP, туннель), остаётся на Mac в Project Web Pilot. Расширение — только отображение и управление.

Статус: этап 0 пройден в Safari на Mac на настоящем chatgpt.com (новая сессия, вставка и отправка пакета, привязка чата, план, индикатор агента). Хост пока тестовый; Host API в Project Web Pilot — этап 1. Подписанная версия для Mac готова (.dmg, Developer ID, нотаризация Apple); на очереди TestFlight для iPad и iPhone и Chrome Web Store «по ссылке».

## Версии и связь с Web Pilot — 03.10.2026

Собственная версия расширения — **0.1.0**. Текущий локальный macOS Project Web Pilot — **0.6.80** (Electron 44.5.1, Node 24.21.0, Workflow Kit 1.5.1); последняя опубликованная парная macOS/Windows поставка — [0.6.78](https://github.com/OleynikAleksandr/Project-Web-Pilot/releases/tag/v0.6.78). Локальная 0.6.80 исправляет подпись/сохранение ScreenCapture: MCP-захват проверен после обновления и перезагрузки, пользователь подтвердил отсутствие новых запросов. [README хоста](https://github.com/OleynikAleksandr/Project-Web-Pilot/blob/main/README.md), [контракт исправления](https://github.com/OleynikAleksandr/Project-Web-Pilot/blob/main/docs/planning/macos-screen-permission-stability.md).

Production Host API в Web Pilot 0.6.80 ещё не реализован: этап 0 расширения по-прежнему использует тестовый хост. Проекты, сессии, current plan и recovery остаются ответственностью Web Pilot и Workflow Kit.

Адаптеры закреплены в `vendor.lock.json` на commit `0d2a026298d42cd2063f36f242885fe032f5e910`. При сверке с 0.6.80 SHA-256 DOM и experience совпали; Composer отличается: lock — `aa790c868fbd8bb5e9173d36848e74dc994840db3676c5ab5b92eb09b37c63b0`, текущий исходник хоста — `296f42fba2d151d82e949c7d0f1ab605fb356d8d89a5ee5fb97665e4c889af5a`. Перед сборкой с текущим исходником нужно отдельно принять обновлённый Composer, обновить lock штатным `--update-lock` и выполнить проверки/сборку. Эта документальная сверка не меняет lock или код расширения и не подтверждает его сборку с новым Composer. [Публичный контракт адаптера](https://github.com/OleynikAleksandr/Project-Web-Pilot/blob/main/docs/modules/chatgpt-dom-compatibility.md).

## Быстрый старт этапа 0

**Проще всего:** двойной щелчок по файлу **«Web Pilot Sidebar.command»** в этой папке. Помощник проверит Node.js, соберёт расширение, запустит тестовый хост и шаг за шагом проведёт по установке в Chrome, Safari на Mac и на iPad — всё, что нужно сделать вручную, он объяснит в отдельном окне. Тот же файл потом показывает новый код подключения, HTTPS-адрес для iPad и останавливает хост.

Вручную:

```sh
npm run build        # dist/chrome и dist/safari — для разработки (адаптер из ../Project Web Pilot)
npm run host         # тестовый хост: адрес и код подключения в терминале
npm test             # тесты хоста, сборки и помощника
```

Подписанные выпуски (на Mac с Xcode, вошедшим в аккаунт команды):

```sh
npm run release:mac     # Developer ID + нотаризация Apple → dist/release/Web-Pilot-Sidebar-<версия>.dmg
npm run release:ios     # загрузка в App Store Connect для TestFlight
npm run package:chrome  # dist/release/web-pilot-sidebar-chrome-<версия>.zip для Chrome Web Store
```

Политика конфиденциальности — [PRIVACY.md](PRIVACY.md); публикация в Chrome Web Store — [docs/store/chrome-web-store.md](docs/store/chrome-web-store.md).

Установка в Chrome, Safari на Mac и iPad и список проверок — [этап 0](docs/planning/stage-0-feasibility.md).

## Связанные проекты

- [Project Web Pilot](https://github.com/OleynikAleksandr/Project-Web-Pilot) — хост: проекты, сессии, план, пакет восстановления, MCP.
- [WorkflowKit](https://github.com/OleynikAleksandr/WorkflowKit) — current plan и recovery.

## Документы

Полный список — [каталог документации](docs/DOCUMENTATION_INDEX.md).
