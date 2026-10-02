# Модули проекта

| Модуль / часть проекта | Спецификация | Ответственность |
| --- | --- | --- |
| Панель | [docs/modules/panel.md](modules/panel.md) | Интерфейс сайдбара: проекты, сессии, план, состояние агента и связи; три хозяина отображения |
| Адаптер провайдера | [docs/modules/provider-adapter.md](modules/provider-adapter.md) | Операции со страницей чата: вставить, отправить, новый чат, открыть чат, состояние, адрес, заголовок |
| Фоновый скрипт | [docs/modules/host-api.md](modules/host-api.md) (клиентская часть) | Единственный сетевой участник: токен, фиксированные операции, маршрутизация сообщений |
| Host API (в Project Web Pilot) | [docs/modules/host-api.md](modules/host-api.md) | Контракт между расширением и Web Pilot на Mac; реализуется в репозитории Web Pilot |
| Сборка под браузеры | `scripts/build.mjs`, `vendor.lock.json` | Перенос адаптера Web Pilot с проверкой SHA-256 и нужных экспортов, манифесты Chrome и Safari, сборки для разработки (`dist/`) и рабочая (`dist/release/`), ASCII-скрипты |
| Приложение-обёртка Safari | `apple/`, `scripts/apple-icons.py` | Проект Xcode для macOS и iOS: экран-подсказка «включите расширение», значки; ресурсы расширения берутся из `dist/release/safari` |
| Подписанные выпуски | `scripts/release-apple.sh`, `npm run package:chrome`, [docs/store/chrome-web-store.md](store/chrome-web-store.md), `PRIVACY.md` | Developer ID + нотаризация + .dmg для Mac, загрузка в TestFlight, архив и материалы для Chrome Web Store, политика конфиденциальности |
| Помощник установки (macOS) | `Web Pilot Sidebar.command`, тест `test/installer.test.mjs` | Пошаговая установка и пульт: Node.js, сборка, хост, Chrome; Safari на Mac — подписанная версия, иначе временная установка; iPad — TestFlight и HTTPS-адрес |
| Тестовый хост (этап 0) | `mock-host/`, [docs/modules/host-api.md](modules/host-api.md) | Контракт Host API с тестовыми данными, без Project Web Pilot |
| Проверки | `test/`, [docs/planning/stage-0-feasibility.md](planning/stage-0-feasibility.md) | Модульные тесты хоста и сборки; сквозной прогон на фикстуре ChatGPT |
