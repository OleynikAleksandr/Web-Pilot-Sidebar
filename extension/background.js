// Web Pilot Sidebar — background script.
// The only network participant (D5): fixed Host API operations, the device
// token, and message routing between the panel and the page content script.
if (typeof importScripts === 'function' && !globalThis.WPS_BUILD) importScripts('build-config.js');

const api = globalThis.browser ?? globalThis.chrome;
const BUILD = globalThis.WPS_BUILD ?? { target: 'unknown', testMode: false };
// Stage 0 test actions write into the chat; release builds refuse them here, not only in the panel.
const PAGE_ACTIONS = ['inspect', 'toggle-panel', ...(BUILD.channel === 'release' ? [] : ['fill-test', 'fill-large', 'send-test'])];
const PENDING_TTL_MS = 3 * 60_000;
const REQUEST_TIMEOUT_MS = 15_000;
const ID = /^[A-Za-z0-9_-]{1,80}$/;
const boundSessions = new Map(); // tabId -> sessionId (for agent-run reports)

function codeError(code, message) { return Object.assign(new Error(message), { code }); }

function quiet(promise) { try { promise?.catch?.(() => {}); } catch { /* no receiver */ } }

function validHostUrl(value) {
  let url;
  try { url = new URL(String(value).trim()); } catch { return null; }
  if (url.username || url.password) return null;
  const local = url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname);
  if (url.protocol !== 'https:' && !local) return null;
  return url.origin;
}

function validChatUrl(value) {
  let url;
  try { url = new URL(value); } catch { return null; }
  const real = url.protocol === 'https:' && url.hostname === 'chatgpt.com' && !url.port;
  const fixture = BUILD.testMode && url.protocol === 'http:' && url.hostname === '127.0.0.1';
  return (real || fixture) && !url.username && !url.password ? url.href : null;
}

const checkId = id => { if (typeof id !== 'string' || !ID.test(id)) throw codeError('ID_INVALID', 'Неверный идентификатор.'); return id; };

async function fetchJson(base, method, path, { token, body } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;
  try {
    const headers = {};
    if (token) headers.Authorization = 'Bearer ' + token;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    response = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal, cache: 'no-store' });
  } catch (error) {
    throw codeError('HOST_UNREACHABLE', error?.name === 'AbortError' ? 'Mac не ответил вовремя.' : 'Mac недоступен: нет соединения с хостом.');
  } finally { clearTimeout(timer); }
  let data = null;
  try { data = await response.json(); } catch { /* empty or non-JSON body */ }
  if (!response.ok) throw codeError(data?.error?.code ?? 'HTTP_' + response.status, data?.error?.message ?? 'Хост ответил ошибкой ' + response.status + '.');
  return data;
}

async function hostRequest(method, path, body) {
  const { hostUrl, token } = await api.storage.local.get(['hostUrl', 'token']);
  if (!hostUrl || !token) throw codeError('NOT_PAIRED', 'Устройство не подключено к Mac.');
  try {
    return await fetchJson(hostUrl, method, path, { token, body });
  } catch (error) {
    if (error.code === 'AUTH_REQUIRED') await api.storage.local.remove('token');
    throw error;
  }
}

function broadcast(event) {
  const message = { channel: 'wps-event', at: Date.now(), ...event };
  try { quiet(api.runtime.sendMessage(message)); } catch { /* no extension page open */ }
  if (Number.isInteger(event.tabId)) { try { quiet(api.tabs.sendMessage(event.tabId, message)); } catch { /* tab gone */ } }
}

async function targetTab(sender, tabId) {
  if (Number.isInteger(sender.tab?.id)) return sender.tab.id;
  if (Number.isInteger(tabId)) return tabId;
  const [tab] = await api.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab) throw codeError('NO_TAB', 'Нет активной вкладки.');
  return tab.id;
}

async function toPage(tabId, message) {
  let response;
  try { response = await api.tabs.sendMessage(tabId, { channel: 'wps-cs', ...message }); }
  catch { throw codeError('PAGE_UNAVAILABLE', 'В этой вкладке нет страницы ChatGPT с расширением. Откройте chatgpt.com.'); }
  if (!response) throw codeError('PAGE_UNAVAILABLE', 'Страница не ответила. Обновите вкладку chatgpt.com.');
  if (!response.ok) throw codeError(response.error?.code ?? 'PAGE_ERROR', response.error?.message ?? 'Ошибка на странице.');
  return response.result;
}

async function getPending() {
  const { pendingDelivery } = await api.storage.local.get('pendingDelivery');
  if (pendingDelivery && Date.now() - pendingDelivery.createdAt > PENDING_TTL_MS) {
    await api.storage.local.remove('pendingDelivery');
    broadcast({ kind: 'flow', tabId: pendingDelivery.tabId, stage: 'failed', message: 'Новая сессия не завершилась за 3 минуты.' });
    return null;
  }
  return pendingDelivery ?? null;
}

async function setPending(pending) { await api.storage.local.set({ pendingDelivery: pending }); }

async function failFlow(pending, message) {
  await api.storage.local.remove('pendingDelivery');
  broadcast({ kind: 'flow', tabId: pending.tabId, projectId: pending.projectId, sessionId: pending.sessionId, stage: 'failed', message });
}

async function bindChat(pending, url) {
  if (pending.stage !== 'binding') return;
  pending.stage = 'saving';
  await setPending(pending);
  try {
    const session = await hostRequest('PATCH', `/v1/sessions/${checkId(pending.sessionId)}`, { chatUrl: url });
    boundSessions.set(pending.tabId, pending.sessionId);
    await api.storage.local.remove('pendingDelivery');
    broadcast({ kind: 'flow', tabId: pending.tabId, projectId: pending.projectId, sessionId: pending.sessionId, stage: 'bound', chatUrl: session.chatUrl });
  } catch (error) { await failFlow(pending, 'Не удалось привязать чат: ' + error.message); }
}

async function onPageReady(tabId) {
  const pending = await getPending();
  if (!pending || pending.tabId !== tabId || pending.stage !== 'navigating') return;
  pending.stage = 'delivering';
  await setPending(pending);
  broadcast({ kind: 'flow', tabId, projectId: pending.projectId, sessionId: pending.sessionId, stage: 'delivering' });
  try {
    const result = await toPage(tabId, { op: 'deliver', text: pending.text, requestId: pending.requestId, experience: pending.experience });
    if (result.state !== 'sent') return failFlow(pending, 'Пакет не отправлен: ' + (result.reason ?? result.state));
    pending.stage = 'binding';
    await setPending(pending);
    broadcast({ kind: 'flow', tabId, projectId: pending.projectId, sessionId: pending.sessionId, stage: 'binding' });
    if (result.conversation) await bindChat(pending, result.url);
  } catch (error) { await failFlow(pending, error.message); }
}

async function onPageStatus(tabId, status) {
  broadcast({ kind: 'page', tabId, status });
  if (!status.conversation) return;
  const pending = await getPending();
  if (pending && pending.tabId === tabId && pending.stage === 'binding') await bindChat(pending, status.url);
}

async function onAgent(tabId, agent) {
  broadcast({ kind: 'agent', tabId, agent });
  const sessionId = boundSessions.get(tabId);
  if (sessionId) quiet(hostRequest('POST', `/v1/sessions/${checkId(sessionId)}/agent-run`, { running: agent.running, at: Date.now() }));
}

const operations = {
  async config() {
    const { hostUrl, token, hostName } = await api.storage.local.get(['hostUrl', 'token', 'hostName']);
    return { paired: !!(hostUrl && token), hostUrl: hostUrl ?? '', hostName: hostName ?? '', build: BUILD, sidePanel: !!api.sidePanel };
  },
  async whoami(_message, sender) { return { tabId: sender.tab?.id ?? null }; },
  async pair({ hostUrl, code, deviceName }) {
    const base = validHostUrl(hostUrl);
    if (!base) throw codeError('HOST_URL_INVALID', 'Нужен адрес https://… (или http://127.0.0.1:порт для этого же Mac).');
    if (typeof code !== 'string' || code.replace(/[\s-]/g, '').length !== 8) throw codeError('PAIRING_INVALID', 'Код состоит из 8 символов.');
    const result = await fetchJson(base, 'POST', '/v1/pair', { body: { code, deviceName: String(deviceName ?? '').slice(0, 80) } });
    await api.storage.local.set({ hostUrl: base, token: result.token, hostName: result.host?.name ?? '' });
    return { paired: true, hostName: result.host?.name ?? '' };
  },
  async unpair() { await api.storage.local.remove(['token', 'pendingDelivery']); return { paired: false }; },
  async host({ query, projectId }) {
    if (query === 'health') return hostRequest('GET', '/v1/health');
    if (query === 'state') return hostRequest('GET', '/v1/state');
    if (query === 'plan') return hostRequest('GET', `/v1/projects/${checkId(projectId)}/plan`);
    throw codeError('QUERY_INVALID', 'Неизвестный запрос к хосту.');
  },
  async 'new-session'({ projectId, experience, tabId: requested }, sender) {
    if (!['chat', 'work'].includes(experience)) throw codeError('EXPERIENCE_INVALID', 'Режим должен быть Chat или Work.');
    const tabId = await targetTab(sender, requested);
    await toPage(tabId, { op: 'inspect' }); // fail early if the tab is not a ChatGPT page
    const created = await hostRequest('POST', `/v1/projects/${checkId(projectId)}/sessions`, { provider: 'chatgpt', experience });
    await setPending({ tabId, projectId, sessionId: created.sessionId, requestId: created.requestId, text: created.packet.text, experience, stage: 'navigating', createdAt: Date.now() });
    broadcast({ kind: 'flow', tabId, projectId, sessionId: created.sessionId, stage: 'navigating', title: created.title });
    await toPage(tabId, { op: 'new-chat', experience });
    return { sessionId: created.sessionId, title: created.title };
  },
  async 'open-session'({ sessionId, chatUrl, tabId: requested }, sender) {
    const url = validChatUrl(chatUrl);
    if (!url) throw codeError('CHAT_URL_INVALID', 'У сессии нет адреса чата.');
    const tabId = await targetTab(sender, requested);
    boundSessions.set(tabId, checkId(sessionId));
    await toPage(tabId, { op: 'navigate', url });
    return { tabId };
  },
  async page({ action, tabId: requested }, sender) {
    if (!PAGE_ACTIONS.includes(action)) throw codeError('ACTION_INVALID', 'Неизвестное действие на странице.');
    return toPage(await targetTab(sender, requested), { op: action });
  },
  async 'cancel-flow'() { await api.storage.local.remove('pendingDelivery'); return { cancelled: true }; },
  async 'panel-ready'(_message, sender) {
    if (Number.isInteger(sender.tab?.id)) quiet(toPage(sender.tab.id, { op: 'panel-ready' }));
    return { ok: true };
  },
};

api.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== api.runtime.id || !message || typeof message !== 'object') return false;
  if (message.channel === 'wps-cs-event' && Number.isInteger(sender.tab?.id)) {
    const tabId = sender.tab.id;
    if (message.type === 'ready') { broadcast({ kind: 'page', tabId, status: message.status }); onPageReady(tabId); }
    else if (message.type === 'status') onPageStatus(tabId, message.status);
    else if (message.type === 'agent') onAgent(tabId, message.agent);
    return false;
  }
  if (message.channel !== 'wps' || !Object.hasOwn(operations, message.op)) return false;
  operations[message.op](message, sender).then(
    result => sendResponse({ ok: true, result }),
    error => sendResponse({ ok: false, error: { code: error.code ?? 'ERROR', message: error.message ?? String(error) } }),
  );
  return true;
});

// Chrome/Edge: the toolbar button opens the native side panel.
// Safari: there is no side panel, the button shows or hides the panel on the page.
if (api.sidePanel?.setPanelBehavior) {
  quiet(api.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }));
} else if (api.action?.onClicked) {
  api.action.onClicked.addListener(tab => { if (Number.isInteger(tab?.id)) quiet(toPage(tab.id, { op: 'toggle-panel' })); });
}
