#!/usr/bin/env node
// Stage 0 test host. Implements the Host API contract (docs/modules/host-api.md)
// with fixture data, so the extension can be checked without touching
// Project Web Pilot. Node.js 22+, no dependencies.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { initialProjects, planFor, packetText } from './fixtures.mjs';

export const VERSION = '0.1.0-stage0';
export const MAX_BODY_BYTES = 1024 * 1024;
export const CODE_TTL_MS = 5 * 60_000;
export const MAX_CODE_ATTEMPTS = 5;
const AUTH_FAILURE_WINDOW_MS = 60_000;
const AUTH_FAILURE_LIMIT = 30;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 symbols, no 0/O/1/I
const EXTENSION_ORIGIN = /^(chrome-extension|moz-extension|safari-web-extension):\/\/[A-Za-z0-9._-]+$/;
const CHAT_PATH = /^(\/work)?(\/g\/[A-Za-z0-9_-]+)?\/c\/[A-Za-z0-9_-]{8,}\/?$/;

class HttpError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const normalizeCode = value => typeof value === 'string' ? value.toUpperCase().replace(/[\s-]/g, '') : '';
export const formatCode = code => code.slice(0, 4) + '-' + code.slice(4);

export function randomCode() {
  // 256 is a multiple of 32, so the modulo keeps the distribution uniform.
  return [...crypto.randomBytes(8)].map(byte => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join('');
}

function equalSecret(a, b) {
  const left = Buffer.from(a); const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

// Accepts only persisted ChatGPT conversation URLs (or local fixture URLs in
// test mode) and returns them normalized without query, hash or trailing slash.
export function normalizeChatUrl(input, { allowTestUrls = false } = {}) {
  if (typeof input !== 'string' || input.length > 500) return null;
  let url;
  try { url = new URL(input); } catch { return null; }
  if (url.username || url.password) return null;
  const real = url.protocol === 'https:' && url.hostname === 'chatgpt.com' && !url.port;
  const fixture = allowTestUrls && url.protocol === 'http:' && url.hostname === '127.0.0.1';
  if (!real && !fixture) return null;
  if (!CHAT_PATH.test(url.pathname)) return null;
  return url.origin + url.pathname.replace(/\/+$/, '');
}

function loadState(file, now) {
  if (file && fs.existsSync(file)) {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Array.isArray(data.tokens) && Array.isArray(data.projects)) return data;
    } catch { /* fall through to a clean state; the broken file is replaced on the next write */ }
  }
  return { tokens: [], projects: initialProjects(now) };
}

function saveState(file, state) {
  if (!file) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(state, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, file);
}

export function createMockHost({ now = Date.now, stateFile = null, allowTestUrls = false, log = () => {}, onCode = () => {} } = {}) {
  const startedAt = now();
  const state = loadState(stateFile, startedAt);
  let pairing = null;
  let authFailures = [];
  let blockedUntil = 0;

  function regenerateCode() {
    pairing = { code: randomCode(), expiresAt: now() + CODE_TTL_MS, attempts: 0 };
    onCode(formatCode(pairing.code), pairing.expiresAt);
    return formatCode(pairing.code);
  }
  regenerateCode();

  const persist = () => saveState(stateFile, state);
  const findProject = id => state.projects.find(p => p.projectId === id) ?? (() => { throw new HttpError(404, 'PROJECT_NOT_FOUND', 'Проект не найден.'); })();
  const findSession = id => {
    for (const project of state.projects) {
      const session = project.sessions.find(s => s.sessionId === id);
      if (session) return { project, session };
    }
    throw new HttpError(404, 'SESSION_NOT_FOUND', 'Сессия не найдена.');
  };

  function authenticate(req) {
    if (now() < blockedUntil) throw new HttpError(429, 'TOO_MANY_FAILURES', 'Слишком много неудачных попыток. Повторите через минуту.');
    const header = req.headers.authorization ?? '';
    const match = /^Bearer ([A-Za-z0-9_-]{20,200})$/.exec(header);
    const record = match && state.tokens.find(t => equalSecret(t.hash, sha256(match[1])));
    if (!record) {
      const at = now();
      authFailures = authFailures.filter(t => at - t < AUTH_FAILURE_WINDOW_MS);
      authFailures.push(at);
      if (authFailures.length >= AUTH_FAILURE_LIMIT) { blockedUntil = at + AUTH_FAILURE_WINDOW_MS; authFailures = []; }
      throw new HttpError(401, 'AUTH_REQUIRED', 'Устройство не подключено или токен отозван.');
    }
    record.lastSeenAt = now();
    return record;
  }

  function newPacket(project, sessionId) {
    const requestId = 'wps-' + crypto.randomBytes(6).toString('hex');
    const text = packetText({ project, sessionId, requestId });
    return { requestId, packet: { text, bytes: Buffer.byteLength(text, 'utf8'), sha256: sha256(text) } };
  }

  const routes = [
    ['GET', /^\/v1\/health$/, false, () => ({ ok: true, name: 'Тестовый хост Web Pilot (этап 0)', version: VERSION })],
    ['POST', /^\/v1\/pair$/, false, (_m, body) => {
      const deviceName = typeof body.deviceName === 'string' ? body.deviceName.trim().slice(0, 80) : '';
      const code = normalizeCode(body.code);
      if (!pairing || now() > pairing.expiresAt) { regenerateCode(); throw new HttpError(401, 'PAIRING_EXPIRED', 'Код устарел. На хосте показан новый код.'); }
      if (code.length !== 8 || !equalSecret(code, pairing.code)) {
        pairing.attempts += 1;
        if (pairing.attempts >= MAX_CODE_ATTEMPTS) { regenerateCode(); throw new HttpError(401, 'PAIRING_LOCKED', 'Слишком много неверных попыток. На хосте показан новый код.'); }
        throw new HttpError(401, 'PAIRING_INVALID', 'Неверный код подключения.');
      }
      const token = crypto.randomBytes(32).toString('base64url');
      state.tokens.push({ hash: sha256(token), deviceName: deviceName || 'Без имени', createdAt: now(), lastSeenAt: now() });
      persist();
      regenerateCode();
      return { token, host: { name: 'Тестовый хост Web Pilot (этап 0)', version: VERSION } };
    }],
    ['GET', /^\/v1\/state$/, true, () => ({
      host: { name: 'Тестовый хост Web Pilot (этап 0)', version: VERSION, mock: true },
      projects: state.projects.map(({ projectId, name, sessions }) => ({
        projectId, name,
        sessions: [...sessions].sort((a, b) => b.createdAt - a.createdAt)
          .map(({ sessionId, title, experience, provider, chatUrl, createdAt, fixture }) => ({ sessionId, title, experience, provider, chatUrl, createdAt, fixture: !!fixture })),
      })),
      observedAt: now(),
    })],
    ['GET', /^\/v1\/projects\/([A-Za-z0-9_-]{1,80})\/plan$/, true, ([, projectId]) => planFor(findProject(projectId), { startedAt, now: now() })],
    ['POST', /^\/v1\/projects\/([A-Za-z0-9_-]{1,80})\/sessions$/, true, ([, projectId], body) => {
      const project = findProject(projectId);
      if (body.provider !== 'chatgpt') throw new HttpError(400, 'PROVIDER_UNSUPPORTED', 'На этапе 0 поддерживается только chatgpt.');
      if (!['chat', 'work'].includes(body.experience)) throw new HttpError(400, 'EXPERIENCE_INVALID', 'experience должен быть chat или work.');
      const sessionId = 'wps-s-' + crypto.randomBytes(5).toString('hex');
      const created = new Date(now());
      const title = 'Новая сессия ' + created.toTimeString().slice(0, 5);
      project.sessions.push({ sessionId, title, experience: body.experience, provider: 'chatgpt', chatUrl: null, createdAt: now() });
      persist();
      return { sessionId, title, ...newPacket(project, sessionId) };
    }],
    ['PATCH', /^\/v1\/sessions\/([A-Za-z0-9_-]{1,80})$/, true, ([, sessionId], body) => {
      const { session } = findSession(sessionId);
      if (body.chatUrl !== undefined) {
        const chatUrl = normalizeChatUrl(body.chatUrl, { allowTestUrls });
        if (!chatUrl) throw new HttpError(400, 'CHAT_URL_INVALID', 'Нужен адрес сохранённого разговора ChatGPT.');
        const owner = state.projects.flatMap(p => p.sessions).find(s => s.chatUrl === chatUrl && s.sessionId !== sessionId);
        if (owner) throw new HttpError(409, 'CHAT_IN_USE', 'Этот чат уже связан с другой сессией.');
        session.chatUrl = chatUrl;
      }
      if (body.title !== undefined) {
        const title = typeof body.title === 'string' ? body.title.replace(/\s+/g, ' ').trim().slice(0, 80) : '';
        if (!title) throw new HttpError(400, 'TITLE_INVALID', 'Нужно непустое название.');
        session.title = title;
      }
      persist();
      const { sessionId: id, title, experience, provider, chatUrl, createdAt } = session;
      return { sessionId: id, title, experience, provider, chatUrl, createdAt };
    }],
    ['POST', /^\/v1\/sessions\/([A-Za-z0-9_-]{1,80})\/packet$/, true, ([, sessionId]) => {
      const { project } = findSession(sessionId);
      return newPacket(project, sessionId);
    }],
    ['POST', /^\/v1\/sessions\/([A-Za-z0-9_-]{1,80})\/agent-run$/, true, ([, sessionId], body) => {
      const { session } = findSession(sessionId);
      if (typeof body.running !== 'boolean' || !Number.isFinite(body.at)) throw new HttpError(400, 'AGENT_RUN_INVALID', 'Нужны running (boolean) и at (число).');
      session.lastAgentRun = { running: body.running, at: body.at };
      return { ok: true };
    }],
  ];

  async function readJson(req) {
    if (!['POST', 'PATCH'].includes(req.method)) return {};
    const type = req.headers['content-type'] ?? '';
    const chunks = []; let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) throw new HttpError(413, 'BODY_TOO_LARGE', 'Слишком большой запрос.');
      chunks.push(chunk);
    }
    if (!size) return {};
    if (!type.startsWith('application/json')) throw new HttpError(415, 'JSON_REQUIRED', 'Нужен Content-Type: application/json.');
    let parsed;
    try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'JSON_INVALID', 'Тело запроса — не JSON.'); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new HttpError(400, 'JSON_INVALID', 'Нужен JSON-объект.');
    return parsed;
  }

  async function handle(req, res) {
    const started = now();
    const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    const origin = req.headers.origin;
    const send = (status, payload) => {
      res.writeHead(status, headers);
      res.end(payload === undefined ? '' : JSON.stringify(payload));
      log(`${req.method} ${req.url.split('?')[0]} → ${status} (${now() - started} мс)`);
    };
    try {
      if (origin) {
        if (!EXTENSION_ORIGIN.test(origin)) throw new HttpError(403, 'ORIGIN_FORBIDDEN', 'Запросы принимаются только от расширения.');
        Object.assign(headers, {
          'Access-Control-Allow-Origin': origin, Vary: 'Origin',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type',
          'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS', 'Access-Control-Max-Age': '600',
        });
      }
      if (req.method === 'OPTIONS') return send(204);
      const pathname = new URL(req.url, 'http://localhost').pathname;
      const candidates = routes.filter(([, pattern]) => pattern.test(pathname));
      if (!candidates.length) throw new HttpError(404, 'NOT_FOUND', 'Нет такого адреса.');
      const route = candidates.find(([method]) => method === req.method);
      if (!route) throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Метод не поддерживается.');
      const [, pattern, requiresAuth, handler] = route;
      if (requiresAuth) authenticate(req);
      const body = await readJson(req);
      return send(200, handler(pattern.exec(pathname), body));
    } catch (error) {
      if (error instanceof HttpError) return send(error.status, { error: { code: error.code, message: error.message } });
      log('Внутренняя ошибка: ' + (error?.stack ?? error));
      return send(500, { error: { code: 'INTERNAL', message: 'Внутренняя ошибка тестового хоста.' } });
    }
  }

  const server = http.createServer((req, res) => { handle(req, res); });
  return { server, state, regenerateCode, get pairingCode() { return formatCode(pairing.code); } };
}

function parseArgs(argv) {
  const options = { port: 8787, listen: '127.0.0.1', allowTestUrls: false, codeFile: null, pidFile: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--port') options.port = Number(argv[++i]);
    else if (arg === '--listen') options.listen = argv[++i];
    else if (arg === '--allow-test-urls') options.allowTestUrls = true;
    else if (arg === '--code-file') options.codeFile = path.resolve(argv[++i]);
    else if (arg === '--pid-file') options.pidFile = path.resolve(argv[++i]);
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error('Неизвестный параметр: ' + arg);
  }
  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) throw new Error('Неверный порт.');
  return options;
}

function writePrivate(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(temporary, text, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('node mock-host/server.mjs [--port 8787] [--listen 127.0.0.1] [--allow-test-urls] [--code-file путь] [--pid-file путь]');
    console.log('Новый код подключения: Enter в этом окне или сигнал SIGUSR2.');
    return;
  }
  const root = path.dirname(fileURLToPath(import.meta.url));
  const host = createMockHost({
    stateFile: path.join(root, '.data', 'state.json'),
    allowTestUrls: options.allowTestUrls,
    log: line => console.log(new Date().toTimeString().slice(0, 8) + '  ' + line),
    onCode: (code, expiresAt) => {
      // The installer shows the current code from this local file (owner-only access).
      if (options.codeFile) writePrivate(options.codeFile, JSON.stringify({ code, expiresAt }) + '\n');
      console.log(`\n  Код подключения: ${code}  (действует до ${new Date(expiresAt).toTimeString().slice(0, 5)}; новый код — Enter)\n`);
    },
  });
  const cleanup = () => {
    for (const file of [options.pidFile, options.codeFile]) if (file) { try { fs.unlinkSync(file); } catch { /* already gone */ } }
  };
  host.server.on('error', error => {
    console.error(error.code === 'EADDRINUSE' ? `Порт ${options.port} занят другой программой.` : 'Не удалось запустить хост: ' + error.message);
    cleanup();
    process.exit(1);
  });
  host.server.listen(options.port, options.listen, () => {
    const { port } = host.server.address();
    if (options.pidFile) writePrivate(options.pidFile, String(process.pid) + '\n');
    console.log(`Web Pilot Sidebar — тестовый хост этапа 0 (${VERSION})`);
    console.log(`Адрес: http://${options.listen}:${port}`);
    console.log(`  Код подключения: ${host.pairingCode}  (новый код — Enter, выход — Ctrl+C)`);
  });
  process.on('SIGUSR2', () => host.regenerateCode());
  // SIGHUP is left alone: under nohup it stays ignored, so the host survives a closed Terminal window.
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => { cleanup(); host.server.close(); process.exit(0); });
  }
  if (process.stdin.isTTY) {
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', () => host.regenerateCode());
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
