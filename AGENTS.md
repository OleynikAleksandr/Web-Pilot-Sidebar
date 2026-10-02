# Web Pilot Sidebar — границы разработки

- Имя проекта выбрано пользователем: Web Pilot Sidebar. Рабочий корень — папка этого репозитория; Project Web Pilot лежит рядом, в `../Project Web Pilot`.
- Сначала прочитать `docs/PRODUCT.md`, `docs/architecture/OVERVIEW.md` и `docs/DECISIONS.md`. Принятые решения D1–D11 не пересматривать без поручения пользователя.
- Расширение — только отображение и управление. Проекты, сессии, план и пакет восстановления принадлежат Project Web Pilot на Mac. Расширение не пишет `todo-plan.md` и не хранит проектные данные.
- Не выгружать и не зеркалировать ответы ChatGPT/Claude. Адаптер страницы делает только операции из `docs/modules/provider-adapter.md`.
- Сетевые запросы — только из фонового скрипта расширения к фиксированным операциям Host API. Контент-скрипт не делает fetch и не принимает команды через `window.postMessage`.
- Удаление и архивирование проектов через расширение не реализовывать.
- Адаптеры ChatGPT переиспользовать из Project Web Pilot (`src/chatgpt-dom.mjs`, `src/chatgpt-composer.mjs`, `src/chatgpt-experience.mjs`; правило паузы 5 с — как в `src/agent-timer.mjs`), не переписывать заново.
- Host API реализуется в репозитории Project Web Pilot (`../Project Web Pilot`) по его собственному workflow. Здесь — только контракт `docs/modules/host-api.md`.
- Реальные токены и адреса туннелей в репозиторий не попадают.
- Подписанные выпуски (`scripts/release-apple.sh`, `npm run package:chrome`) — только из рабочей сборки `dist/release/`. Учётные данные Apple и Google живут в Xcode и консолях магазинов, не в репозитории и не в скриптах.
- Проект Xcode приложения-обёртки — `apple/`; список ресурсов расширения в нём должен совпадать с файлами `dist/release/safari` (это проверяет тест). Новый файл расширения — добавить и в проект.
- Помощник `Web Pilot Sidebar.command` должен работать в `/bin/bash` 3.2 (macOS): без возможностей bash 4+. Все вопросы пользователю — через системные окна, тексты передаются аргументами `osascript`, без экранирования.
- Проверки: `npm test` (хост, сборка и помощник с поддельными инструментами macOS), `npm run e2e` (Chrome-сборка на фикстуре ChatGPT, нужен Playwright; на Linux без экрана — через `xvfb-run`). Сборка: `npm run build`; адаптер Web Pilot закреплён в `vendor.lock.json`, обновлять только осознанно через `--update-lock`.
