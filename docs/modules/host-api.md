# Host API

## Где живёт

Новый модуль Project Web Pilot в основном процессе Electron — HTTP-сервер. Он использует тот же store сессий (`src/workspace-session.mjs`), ту же проекцию плана (`planView`) и тот же пакет восстановления (`workflow recover --format packet`), что и сайдбар Electron. Реализуется в репозитории Web Pilot по его workflow; здесь — только контракт.

## Принципы

- Явные идентификаторы: каждый запрос указывает `projectId` или `sessionId`. API не меняет выбранную сессию в окне Web Pilot на Mac.
- План только читается. Записи в `todo-plan.md` нет.
- Разрушительных операций нет: удаление и архивирование проектов остаются в интерфейсе Web Pilot.
- Ответы — JSON. Ошибки — `{ "error": { "code": "...", "message": "..." } }`, коды как у `WorkspaceError` Web Pilot.

## Авторизация

1. В настройках Web Pilot — «Подключить устройство»: одноразовый код (8 символов, действует 5 минут, ограничение попыток).
2. Расширение: адрес хоста + код → `POST /v1/pair` → токен устройства (256 бит).
3. Web Pilot хранит только хеш токена, имя устройства и время последнего доступа; отзыв — в настройках.
4. Каждый запрос: `Authorization: Bearer <token>`. Только HTTPS, кроме `127.0.0.1`. Ограничение частоты запросов.

Токен хранится в `storage.local` расширения и известен только фоновому скрипту.

## Эндпоинты v1

| Метод | Путь | Назначение |
| --- | --- | --- |
| GET | `/v1/health` | Проверка связи без данных и без токена |
| POST | `/v1/pair` | Обмен одноразового кода на токен устройства |
| GET | `/v1/state` | Активные проекты и их сессии (`sessionId`, `title`, `experience`, `provider`, `chatUrl`, `createdAt`); версия хоста |
| GET | `/v1/projects/{projectId}/plan` | Проекция плана Web Pilot: `projectId`, `name`, `planRevision`, `scopeId`, `scopeTitle`, `objective`, `scopeStatus`, `deliveryStatus`, `nextTaskId`, `nextTaskTitle`, `planView: {state, completed, total, tasks[{id, title, status}], blockedReason}` и `observedAt`. `state`: `working`, `awaiting-acceptance`, `blocked`, `closed`, `not-created` |
| POST | `/v1/projects/{projectId}/sessions` | Новая сессия: `{provider, experience}` → `{sessionId, requestId, packet: {text, bytes, sha256}}` |
| PATCH | `/v1/sessions/{sessionId}` | Привязать `chatUrl` после первого сообщения; обновить `title` |
| POST | `/v1/sessions/{sessionId}/packet` | Свежий пакет для явного «обновить контекст» в существующем чате |
| POST | `/v1/sessions/{sessionId}/agent-run` | `{running, at}` — для индикатора и таймера Web Pilot |

Формат `planView` и статусы задач (`done`, `current`, `pending`) совпадают с существующей проекцией в `src/workspace-session.mjs`.

Поле `provider` у сессии — новое: в текущем store Web Pilot его нет, существующие сессии считаются `chatgpt`.

Позже, не в v1: создание проекта (`POST /v1/projects` поверх preview/apply `WorkspaceSetup`), события сервера `GET /v1/events`.

## Соответствие IPC сайдбара Electron

| IPC Web Pilot | Host API |
| --- | --- |
| `pilot:get-state` | `GET /v1/state` и план проекта |
| `pilot:new-session` | `POST /v1/projects/{id}/sessions` |
| `pilot:select-session` | Нет: выбор локален для устройства |
| `pilot:rename-session` | `PATCH /v1/sessions/{id}` с `title` |
| `pilot:state-changed` | Опрос; позже SSE |
| `pilot:delete-project`, `pilot:archive-*`, настройки, Доктор, рантайм | Не предоставляются |

Тестовая реализация контракта для этапа 0 — `mock-host/server.mjs` (тесты — `test/mock-host.test.mjs`).

## Транспорт

- Этапы 0–1: тот же Mac (`127.0.0.1`) и временный HTTPS для iPad.
- Удалённые устройства — открытый вопрос Q1 в [DECISIONS](../DECISIONS.md).
- Запросы идут только из фонового скрипта расширения (контент-скрипты подчиняются политике одного источника). CORS разрешается только для origin своих расширений; основная защита — токен.
- Safari на iOS принимает только доверенный сертификат: самоподписанный не подойдёт.

## Что меняется в Project Web Pilot

Этап 0 Web Pilot не трогает. С этапа 1 нужны доработки — в его репозитории и по его workflow:

1. **Модуль Host API** — HTTP-сервер в основном процессе, фасад над существующими функциями: снимок store, `bindChat` (с проверкой `CHAT_IN_USE`), `updateSession`, проекция плана, `recover --format packet`, `AgentTimer`.
2. **Подключение устройств** — раздел в настройках: одноразовый код, хеши токенов, список устройств, отзыв.
3. **Store сессий** — поле `provider` (миграция схемы с резервной копией, как принято в Web Pilot); сессии, созданные с устройства, сразу появляются в сайдбаре на Mac.
4. **План любого проекта по запросу** — сейчас `PlanMonitor` следит только за выбранной сессией.
5. **Внешние сигналы для `AgentTimer`** — «агент работает» с устройства.
6. **Жизненный цикл приложения** — сейчас закрытие окна завершает приложение (`window-all-closed` → `app.quit()`), и Host API исчез бы вместе с ним. Нужен фоновый режим (DECISIONS, Q7).

Не меняются: адаптеры ChatGPT (копируются), WorkflowKit, MCP, туннель.
