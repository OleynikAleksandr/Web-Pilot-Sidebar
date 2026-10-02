# Web Pilot Sidebar

Расширение браузера, которое встраивает сайдбар Project Web Pilot в настоящую страницу chatgpt.com (позже — claude.ai). Слева — проекты, сессии и прогресс текущего плана, справа — обычный веб-чат провайдера с твоим входом.

Всё, что работает с проектами (репозитории, WorkflowKit, MCP, туннель), остаётся на Mac в Project Web Pilot. Расширение — только отображение и управление.

Статус: этап 0 пройден в Safari на Mac на настоящем chatgpt.com (новая сессия, вставка и отправка пакета, привязка чата, план, индикатор агента). Хост пока тестовый; Host API в Project Web Pilot — этап 1. Готовятся подписанные версии: .dmg для Mac, TestFlight для iPad и iPhone, Chrome Web Store «по ссылке».

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
