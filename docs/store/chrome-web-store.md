# Chrome Web Store — публикация «по ссылке»

Первая версия — для себя и близких: видимость **Unlisted** (ставится по ссылке, в поиске магазина её нет). Тот же архив подходит для магазина Microsoft Edge Add-ons (бесплатно).

## Один раз

1. Зарегистрироваться разработчиком: <https://chrome.google.com/webstore/devconsole>. Google-аккаунт с двухэтапной проверкой, разовый взнос. Адрес почты разработчика потом не меняется.
2. В консоли разработчика заполнить профиль (имя издателя, контактная почта).

## Каждая версия

1. Поднять `version` в `package.json` (магазин не примет тот же номер).
2. `npm run package:chrome` → `dist/release/web-pilot-sidebar-chrome-<версия>.zip`.
3. Консоль разработчика → **New item** (или пакет существующего) → загрузить архив.
4. Заполнить разделы ниже → **Submit for review**. Проверка обычно занимает от нескольких дней.

## Store listing

- **Название:** Web Pilot Sidebar (берётся из манифеста).
- **Краткое описание:** берётся из манифеста.
- **Категория:** Productivity → Workflow & Planning.
- **Язык:** русский; английское описание — вторым языком.
- **Скриншоты:** 1280×800, хотя бы один — панель на chatgpt.com в Chrome (рабочая сборка, без «этап 0»).
- **Значок:** 128×128 — `extension/icons/icon-128.png`.

**Подробное описание (RU):**

> Web Pilot Sidebar показывает панель Project Web Pilot прямо на странице chatgpt.com: ваши проекты и сессии, текущий план работы с прогрессом и состояние агента. Новая сессия создаётся в один щелчок: расширение открывает новый чат, вставляет и отправляет пакет восстановления от вашего Web Pilot и привязывает чат к сессии.
>
> Нужен ваш собственный хост Project Web Pilot (на Mac или на сервере): расширение подключается к нему по одноразовому коду и работает только с ним. Без аналитики и сторонних сервисов; переписки не сохраняются и никуда не передаются.

**Detailed description (EN):**

> Web Pilot Sidebar shows the Project Web Pilot panel right on chatgpt.com: your projects and sessions, the current work plan with progress, and the agent state. A new session takes one click: the extension opens a new chat, inserts and sends the recovery packet from your Web Pilot and binds the chat to the session.
>
> Requires your own Project Web Pilot host (on a Mac or a server); the extension pairs with it by a one-time code and talks only to it. No analytics or third-party services; conversations are never stored or transmitted.

## Privacy practices

- **Single purpose:** показывать на chatgpt.com панель вашего Project Web Pilot (проекты, сессии, план) и по вашей команде отправлять в чат тексты от вашего хоста.
- **Permission justification:**
  - `storage` — адрес вашего хоста, ключ доступа к нему и настройки панели;
  - `sidePanel` — панель Web Pilot в боковой панели Chrome;
  - host permission `https://chatgpt.com/*` — показать панель на странице, найти поле ввода и кнопки, вставить и отправить текст по команде пользователя.
- **Remote code:** No — весь код в пакете, включая адаптер страницы из Project Web Pilot.
- **Data usage** (передаётся только на хост, указанный пользователем, разработчик данных не получает):
  - *Web history* — адрес чата ChatGPT, привязанного к сессии;
  - *Authentication information* — ключ доступа к вашему хосту (хранится локально, отправляется только на ваш хост).
  - Подтвердить три пункта: данные не продаются, не используются вне назначения, не используются для кредитных решений.
- **Privacy policy URL:** <https://github.com/OleynikAleksandr/Web-Pilot-Sidebar/blob/main/PRIVACY.md>
