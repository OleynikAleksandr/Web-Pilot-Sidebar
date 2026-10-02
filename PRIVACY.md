# Политика конфиденциальности Web Pilot Sidebar

*Действует с 2 октября 2026 года.* [English version below](#privacy-policy-web-pilot-sidebar).

Web Pilot Sidebar — расширение браузера, которое показывает боковую панель Project Web Pilot на странице chatgpt.com. Расширение работает только с вашим собственным хостом Web Pilot: на вашем Mac или на вашем сервере.

## Что расширение делает на странице

- Работает только на `https://chatgpt.com/`.
- Находит на странице поле ввода, кнопки «Отправить» и «Стоп» и признак входа в аккаунт. Это нужно, чтобы показать состояние страницы и агента.
- По вашей команде вставляет в поле ввода и отправляет текст, полученный от вашего хоста Web Pilot (например, пакет восстановления сессии).
- Не сохраняет и не передаёт ваши переписки и ответы ChatGPT. Содержимое поля ввода проверяется только на странице, чтобы убедиться, что вставлен нужный текст.

## Какие данные куда передаются

Расширение связывается только с адресом хоста, который вы указали сами при подключении. Разработчик расширения и третьи лица эти данные не получают.

На ваш хост передаются:
- имя устройства, которое вы ввели при подключении;
- выбранный проект и сессия, адрес чата ChatGPT, к которому привязана сессия;
- признак «агент работает / свободен» и время смены этого состояния.

С вашего хоста приходят список проектов и сессий, план работы и тексты для вставки в чат.

## Что хранится в браузере

В локальном хранилище расширения хранятся адрес хоста, ключ доступа, выданный хостом при подключении, и настройки панели. Кнопка «Отключить устройство» удаляет адрес и ключ. Удаление расширения удаляет всё.

## Чего расширение не делает

- Нет аналитики, рекламы, отслеживания и сторонних сервисов.
- Данные не продаются и не передаются третьим лицам.
- Расширение не работает на других сайтах.

## Связь

Вопросы и сообщения о проблемах: [Issues репозитория](https://github.com/OleynikAleksandr/Web-Pilot-Sidebar/issues).

---

# Privacy Policy: Web Pilot Sidebar

*Effective October 2, 2026.*

Web Pilot Sidebar is a browser extension that shows the Project Web Pilot sidebar on chatgpt.com. It works only with your own Web Pilot host, running on your Mac or your server.

## What the extension does on the page

- Runs only on `https://chatgpt.com/`.
- Locates the message field, the Send and Stop buttons and the signed-in indicator to show the state of the page and the agent.
- On your command, inserts into the message field and sends text received from your Web Pilot host (for example, a session recovery packet).
- Does not store or transmit your conversations or ChatGPT's answers. The message field is checked only on the page, to confirm the right text was inserted.

## What data goes where

The extension talks only to the host address you entered when connecting. Neither the developer nor any third party receives this data.

Sent to your host:
- the device name you entered when connecting;
- the selected project and session, and the ChatGPT chat address bound to the session;
- whether the agent is busy or idle, and when that changed.

Received from your host: projects and sessions, the work plan, and texts to insert into the chat.

## What is stored in the browser

The extension's local storage keeps the host address, the access key issued by your host when connecting, and panel settings. "Disconnect device" removes the address and key; removing the extension removes everything.

## What the extension does not do

- No analytics, ads, tracking or third-party services.
- No sale or transfer of data to third parties.
- It does not run on any other website.

## Contact

Questions and bug reports: [repository issues](https://github.com/OleynikAleksandr/Web-Pilot-Sidebar/issues).
