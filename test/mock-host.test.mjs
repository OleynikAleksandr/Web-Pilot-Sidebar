import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMockHost, normalizeChatUrl, MAX_CODE_ATTEMPTS } from '../mock-host/server.mjs';
import { TASK_STEP_MS } from '../mock-host/fixtures.mjs';

const EXT = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';

async function startHost(options = {}) {
  let clock = options.start ?? 1_800_000_000_000;
  const stateFile = options.stateFile ?? path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wps-host-')), 'state.json');
  const host = createMockHost({ now: () => clock, stateFile, allowTestUrls: options.allowTestUrls ?? false });
  await new Promise(resolve => host.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${host.server.address().port}`;
  const call = async (method, url, { body, token, origin = EXT, raw } = {}) => {
    const headers = {};
    if (origin) headers.Origin = origin;
    if (token) headers.Authorization = 'Bearer ' + token;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(base + url, { method, headers, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
    const text = await response.text();
    return { status: response.status, headers: response.headers, json: text ? JSON.parse(text) : null };
  };
  const pair = async () => (await call('POST', '/v1/pair', { body: { code: host.pairingCode, deviceName: 'test' } })).json.token;
  return { host, call, pair, stateFile, advance: ms => { clock += ms; }, close: () => new Promise(r => host.server.close(r)) };
}

test('pairing issues a token, rotates the code and stores only a hash', async t => {
  const h = await startHost(); t.after(h.close);
  const code = h.host.pairingCode;
  const result = await h.call('POST', '/v1/pair', { body: { code: code.toLowerCase(), deviceName: 'iPad' } });
  assert.equal(result.status, 200);
  assert.match(result.json.token, /^[A-Za-z0-9_-]{40,}$/);
  assert.notEqual(h.host.pairingCode, code, 'code is single-use');
  const saved = fs.readFileSync(h.stateFile, 'utf8');
  assert.ok(!saved.includes(result.json.token), 'raw token never written');
  assert.equal(JSON.parse(saved).tokens[0].deviceName, 'iPad');
  const reuse = await h.call('POST', '/v1/pair', { body: { code } });
  assert.equal(reuse.status, 401);
});

test('wrong codes lock and rotate the pairing code; expired codes are rejected', async t => {
  const h = await startHost(); t.after(h.close);
  const first = h.host.pairingCode;
  for (let i = 1; i < MAX_CODE_ATTEMPTS; i++) assert.equal((await h.call('POST', '/v1/pair', { body: { code: 'AAAA-AAAA' } })).json.error.code, 'PAIRING_INVALID');
  assert.equal((await h.call('POST', '/v1/pair', { body: { code: 'AAAA-AAAA' } })).json.error.code, 'PAIRING_LOCKED');
  assert.notEqual(h.host.pairingCode, first);
  h.advance(6 * 60_000);
  const expired = await h.call('POST', '/v1/pair', { body: { code: h.host.pairingCode } });
  assert.equal(expired.json.error.code, 'PAIRING_EXPIRED');
});

test('every data endpoint requires a valid token; health does not', async t => {
  const h = await startHost(); t.after(h.close);
  assert.equal((await h.call('GET', '/v1/health')).status, 200);
  for (const [method, url] of [['GET', '/v1/state'], ['GET', '/v1/projects/demo-web-pilot/plan'], ['POST', '/v1/projects/demo-web-pilot/sessions']]) {
    assert.equal((await h.call(method, url)).status, 401, url);
    assert.equal((await h.call(method, url, { token: 'x'.repeat(43) })).status, 401, url);
  }
});

test('repeated authentication failures are throttled', async t => {
  const h = await startHost(); t.after(h.close);
  let last;
  for (let i = 0; i < 31; i++) last = await h.call('GET', '/v1/state', { token: 'y'.repeat(43) });
  assert.equal(last.status, 429);
  const token = h.host.pairingCode && await h.pair();
  assert.equal((await h.call('GET', '/v1/state', { token })).status, 429, 'block applies for its window');
  h.advance(61_000);
  assert.equal((await h.call('GET', '/v1/state', { token })).status, 200);
});

test('only extension origins get CORS; web origins are refused', async t => {
  const h = await startHost(); t.after(h.close);
  const preflight = await h.call('OPTIONS', '/v1/state');
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), EXT);
  assert.match(preflight.headers.get('access-control-allow-headers'), /Authorization/);
  for (const origin of ['safari-web-extension://1234-ABCD', 'moz-extension://e0b4c5d6']) {
    assert.equal((await h.call('GET', '/v1/health', { origin })).headers.get('access-control-allow-origin'), origin);
  }
  const web = await h.call('GET', '/v1/health', { origin: 'https://chatgpt.com' });
  assert.equal(web.status, 403);
  assert.equal(web.headers.get('access-control-allow-origin'), null);
});

test('state lists projects with sessions newest first', async t => {
  const h = await startHost(); t.after(h.close);
  const token = await h.pair();
  const { json } = await h.call('GET', '/v1/state', { token });
  assert.deepEqual(json.projects.map(p => p.name), ['Project Web Pilot', 'WorkflowKit', 'Web Pilot Sidebar']);
  const sessions = json.projects[0].sessions;
  assert.ok(sessions[0].createdAt >= sessions[1].createdAt);
  assert.deepEqual(Object.keys(sessions[0]).sort(), ['chatUrl', 'createdAt', 'experience', 'fixture', 'provider', 'sessionId', 'title']);
});

test('plan uses the Web Pilot projection and advances over time', async t => {
  const h = await startHost(); t.after(h.close);
  const token = await h.pair();
  const first = (await h.call('GET', '/v1/projects/demo-web-pilot/plan', { token })).json;
  assert.equal(first.planView.state, 'working');
  assert.equal(first.planView.completed, 0);
  assert.equal(first.planView.tasks[0].status, 'current');
  assert.equal(first.nextTaskId, 'T001');
  h.advance(2 * TASK_STEP_MS);
  const later = (await h.call('GET', '/v1/projects/demo-web-pilot/plan', { token })).json;
  assert.equal(later.planView.completed, 2);
  assert.equal(later.planRevision, first.planRevision + 2);
  h.advance(4 * TASK_STEP_MS);
  assert.equal((await h.call('GET', '/v1/projects/demo-web-pilot/plan', { token })).json.planView.state, 'awaiting-acceptance');
  assert.equal((await h.call('GET', '/v1/projects/demo-workflow-kit/plan', { token })).json.planView.state, 'not-created');
  assert.equal((await h.call('GET', '/v1/projects/nope/plan', { token })).status, 404);
});

test('new session returns a packet containing its requestId and appears in state', async t => {
  const h = await startHost(); t.after(h.close);
  const token = await h.pair();
  const created = await h.call('POST', '/v1/projects/demo-sidebar/sessions', { token, body: { provider: 'chatgpt', experience: 'work' } });
  assert.equal(created.status, 200);
  const { sessionId, requestId, packet } = created.json;
  assert.ok(packet.text.includes(requestId));
  assert.equal(packet.bytes, Buffer.byteLength(packet.text));
  const state = (await h.call('GET', '/v1/state', { token })).json;
  const session = state.projects.find(p => p.projectId === 'demo-sidebar').sessions[0];
  assert.equal(session.sessionId, sessionId);
  assert.equal(session.experience, 'work');
  assert.equal(session.chatUrl, null);
  for (const body of [{ provider: 'claude', experience: 'chat' }, { provider: 'chatgpt', experience: 'other' }]) {
    assert.equal((await h.call('POST', '/v1/projects/demo-sidebar/sessions', { token, body })).status, 400);
  }
});

test('chatUrl binding validates, normalizes and rejects reuse', async t => {
  const h = await startHost(); t.after(h.close);
  const token = await h.pair();
  const make = async () => (await h.call('POST', '/v1/projects/demo-web-pilot/sessions', { token, body: { provider: 'chatgpt', experience: 'chat' } })).json.sessionId;
  const a = await make(); const b = await make();
  const bound = await h.call('PATCH', '/v1/sessions/' + a, { token, body: { chatUrl: 'https://chatgpt.com/c/abcdef12-3456?x=1#y' } });
  assert.equal(bound.status, 200);
  assert.equal(bound.json.chatUrl, 'https://chatgpt.com/c/abcdef12-3456');
  assert.equal((await h.call('PATCH', '/v1/sessions/' + b, { token, body: { chatUrl: 'https://chatgpt.com/c/abcdef12-3456/' } })).json.error.code, 'CHAT_IN_USE');
  for (const chatUrl of ['https://evil.example/c/abcdef123456', 'https://chatgpt.com/', 'https://chatgpt.com/c/WEB:1234', 'http://127.0.0.1:9/c/abcdefgh123']) {
    assert.equal((await h.call('PATCH', '/v1/sessions/' + b, { token, body: { chatUrl } })).json.error.code, 'CHAT_URL_INVALID', chatUrl);
  }
  const renamed = await h.call('PATCH', '/v1/sessions/' + b, { token, body: { title: '  Новое   имя ' } });
  assert.equal(renamed.json.title, 'Новое имя');
  assert.equal((await h.call('PATCH', '/v1/sessions/' + b, { token, body: { title: '   ' } })).status, 400);
});

test('test mode accepts local fixture conversation URLs only when enabled', () => {
  assert.equal(normalizeChatUrl('http://127.0.0.1:5173/c/abcdefgh1234'), null);
  assert.equal(normalizeChatUrl('http://127.0.0.1:5173/c/abcdefgh1234', { allowTestUrls: true }), 'http://127.0.0.1:5173/c/abcdefgh1234');
  assert.equal(normalizeChatUrl('https://chatgpt.com/work/c/abcdefgh1234'), 'https://chatgpt.com/work/c/abcdefgh1234');
  assert.equal(normalizeChatUrl('https://user:pw@chatgpt.com/c/abcdefgh1234'), null);
});

test('agent-run and fresh packet endpoints validate input', async t => {
  const h = await startHost(); t.after(h.close);
  const token = await h.pair();
  const id = (await h.call('POST', '/v1/projects/demo-web-pilot/sessions', { token, body: { provider: 'chatgpt', experience: 'chat' } })).json.sessionId;
  assert.equal((await h.call('POST', `/v1/sessions/${id}/agent-run`, { token, body: { running: true, at: 1 } })).status, 200);
  assert.equal((await h.call('POST', `/v1/sessions/${id}/agent-run`, { token, body: { running: 'yes' } })).status, 400);
  const fresh = (await h.call('POST', `/v1/sessions/${id}/packet`, { token })).json;
  assert.ok(fresh.packet.text.includes(fresh.requestId));
  assert.equal((await h.call('POST', '/v1/sessions/missing/packet', { token })).status, 404);
});

test('malformed bodies, unknown routes and wrong methods get explicit errors', async t => {
  const h = await startHost(); t.after(h.close);
  const token = await h.pair();
  assert.equal((await h.call('POST', '/v1/projects/demo-web-pilot/sessions', { token, raw: '{oops', body: undefined })).status, 415);
  const bad = await fetch(`http://127.0.0.1:${h.host.server.address().port}/v1/projects/demo-web-pilot/sessions`, {
    method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: '{oops' });
  assert.equal(bad.status, 400);
  const big = await fetch(`http://127.0.0.1:${h.host.server.address().port}/v1/pair`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'x'.repeat(1_100_000) }) });
  assert.equal(big.status, 413);
  assert.equal((await h.call('GET', '/v1/nothing', { token })).status, 404);
  assert.equal((await h.call('DELETE', '/v1/state', { token })).status, 405);
});

test('sessions and tokens survive a host restart', async t => {
  const first = await startHost();
  const token = await first.pair();
  const id = (await first.call('POST', '/v1/projects/demo-web-pilot/sessions', { token, body: { provider: 'chatgpt', experience: 'chat' } })).json.sessionId;
  await first.close();
  const second = await startHost({ stateFile: first.stateFile }); t.after(second.close);
  const state = (await second.call('GET', '/v1/state', { token })).json;
  assert.ok(state.projects[0].sessions.some(s => s.sessionId === id));
});

test('command line host publishes the code to a private file and rotates it on SIGUSR2', async () => {
  const { spawn } = await import('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wps-cli-'));
  const codeFile = path.join(dir, 'code.json'); const pidFile = path.join(dir, 'host.pid');
  const child = spawn(process.execPath, ['mock-host/server.mjs', '--port', '0', '--code-file', codeFile, '--pid-file', pidFile], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  const until = async (check, label) => {
    for (let i = 0; i < 100; i++) { if (check()) return; await new Promise(r => setTimeout(r, 50)); }
    throw new Error('timeout: ' + label + '\n' + output);
  };
  try {
    await until(() => /Адрес: http:\/\/127\.0\.0\.1:\d+/.test(output) && fs.existsSync(pidFile), 'listen');
    assert.equal(Number(fs.readFileSync(pidFile, 'utf8')), child.pid);
    const first = JSON.parse(fs.readFileSync(codeFile, 'utf8'));
    assert.match(first.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    assert.equal(fs.statSync(codeFile).mode & 0o077, 0, 'owner-only permissions');
    child.kill('SIGUSR2');
    await until(() => JSON.parse(fs.readFileSync(codeFile, 'utf8')).code !== first.code, 'rotation');
    child.kill('SIGTERM');
    await until(() => !fs.existsSync(pidFile) && !fs.existsSync(codeFile), 'cleanup');
  } finally { if (child.exitCode === null) child.kill('SIGKILL'); }
});
