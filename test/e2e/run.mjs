#!/usr/bin/env node
// End-to-end check of the Chrome build against a local ChatGPT fixture and
// the test host. Requires Playwright with Chromium (not a project dependency):
//   npm i -g playwright && npx playwright install chromium
//   WEBPILOT_SRC="../Project Web Pilot" node test/e2e/run.mjs
// On a machine without a display run it under xvfb-run.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from '../../scripts/build.mjs';
import { createMockHost } from '../../mock-host/server.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const output = path.join(root, 'test', 'e2e', 'output');
const require = createRequire(import.meta.url);
function loadPlaywright() {
  try { return require('playwright'); } catch { /* try the global install */ }
  return require(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'playwright'));
}
const { chromium } = loadPlaywright();
const waitUntil = async (predicate, { timeout = 20_000, step = 200, label = 'условие' } = {}) => {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('Не дождались: ' + label);
    await new Promise(r => setTimeout(r, step));
  }
};

async function main() {
  fs.mkdirSync(output, { recursive: true });
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'wps-e2e-dist-'));
  build({ targets: ['chrome-test'], webpilot: process.env.WEBPILOT_SRC || path.resolve(root, '..', 'Project Web Pilot'), updateLock: false, out: dist });
  const extension = path.join(dist, 'chrome-test');

  const host = createMockHost({ allowTestUrls: true, stateFile: path.join(dist, 'host-state.json') });
  await new Promise(r => host.server.listen(0, '127.0.0.1', r));
  const hostUrl = `http://127.0.0.1:${host.server.address().port}`;
  const fixture = fs.readFileSync(path.join(root, 'test', 'e2e', 'fixture-chatgpt.html'));
  const site = http.createServer((req, res) => {
    if (req.url === '/favicon.ico') { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(fixture);
  });
  await new Promise(r => site.listen(0, '127.0.0.1', r));
  const siteUrl = `http://127.0.0.1:${site.address().port}`;

  const context = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'wps-e2e-profile-')), {
    headless: false,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    viewport: { width: 1360, height: 860 },
  });
  const errors = [];
  const watch = (page, name) => {
    page.on('pageerror', error => errors.push(`${name}: ${error.message}`));
    page.on('console', message => {
      if (message.type() !== 'error') return;
      const source = message.location()?.url ?? '';
      if (/favicon\.ico$/.test(source) || (hostUrl && source.startsWith(hostUrl))) return; // fixture favicon; deliberate CORS probe in step 8
      errors.push(`${name}: ${message.text()} ${source}`);
    });
  };
  try {
    let [worker] = context.serviceWorkers();
    worker ??= await context.waitForEvent('serviceworker');
    const extensionId = new URL(worker.url()).host;
    const results = [];
    const ok = label => { results.push('✓ ' + label); console.log('✓ ' + label); };

    // 1. Pairing in the panel opened as a tab.
    const panel = await context.newPage(); watch(panel, 'panel');
    await panel.setViewportSize({ width: 380, height: 860 });
    await panel.goto(`chrome-extension://${extensionId}/panel.html`);
    await panel.fill('#wps-hostUrl', hostUrl);
    await panel.fill('#wps-code', 'WRON-GCOD');
    await panel.getByRole('button', { name: 'Подключить', exact: true }).click();
    await panel.waitForSelector('text=Неверный код подключения');
    ok('неверный код отклонён с понятной ошибкой');
    await panel.fill('#wps-code', host.pairingCode.toLowerCase());
    await panel.getByRole('button', { name: 'Подключить', exact: true }).click();
    await panel.waitForSelector('text=Project Web Pilot');
    await panel.waitForSelector('text=Этап 0 · проверка расширения');
    ok('сопряжение по коду, проекты и план загружены');
    await panel.screenshot({ path: path.join(output, '1-panel-tab.png') });
    await panel.evaluate(() => chrome.storage.local.set({ prefs: { inline: 'on', layout: 'push', render: 'auto', width: 340 } }));

    // 2. Panel on the page (forced inline in Chrome; automatic in Safari).
    const chat = await context.newPage(); watch(chat, 'chat');
    await chat.goto(siteUrl + '/');
    const frame = chat.frameLocator('wps-sidebar iframe');
    await frame.locator('text=Project Web Pilot').waitFor();
    assert.equal(await chat.evaluate(() => document.documentElement.classList.contains('wps-push')), true);
    await frame.locator('text=найдено').waitFor();
    ok('панель на странице в iframe, страница сдвинута, поле ввода найдено');
    await chat.waitForTimeout(600);
    await chat.screenshot({ path: path.join(output, '2-inline-push.png') });

    // 3. New session: create on host, open new chat, insert packet, send, bind chatUrl.
    await frame.locator('button.project', { hasText: 'Web Pilot Sidebar' }).click();
    await frame.locator('text=Сессий пока нет').waitFor();
    await frame.getByRole('button', { name: 'Новая сессия · Chat' }).click();
    const bound = await waitUntil(async () => {
      const state = JSON.parse(fs.readFileSync(path.join(dist, 'host-state.json'), 'utf8'));
      return state.projects.find(p => p.projectId === 'demo-sidebar').sessions.find(s => s.chatUrl);
    }, { timeout: 30_000, label: 'привязка chatUrl на хосте' });
    assert.equal(bound.chatUrl, new URL(chat.url()).origin + new URL(chat.url()).pathname);
    const userText = await chat.locator('[data-message-author-role=user]').first().textContent();
    assert.match(userText, /requestId: wps-[0-9a-f]{12}/);
    assert.equal(await chat.locator('[data-message-author-role=user]').count(), 1, 'пакет отправлен ровно один раз');
    ok('новая сессия: пакет вставлен и отправлен один раз, chatUrl привязан на хосте');
    const frame2 = chat.frameLocator('wps-sidebar iframe');
    await frame2.locator('.agent[data-running=true]').waitFor({ timeout: 10_000 });
    ok('индикатор «агент работает» по кнопке Stop');
    await frame2.locator('text=Сессия привязана').waitFor({ timeout: 10_000 });
    await frame2.getByRole('button', { name: /^Открыть чат/ }).first().waitFor();
    await chat.screenshot({ path: path.join(output, '3-session-bound.png') });
    await frame2.locator('.agent[data-running=false]').waitFor({ timeout: 15_000 });
    ok('после паузы 5 с агент снова свободен');

    // 4. Stage 0 checks: selectors, 180 KB insert.
    await frame2.locator('summary', { hasText: 'Проверки этапа 0' }).click();
    await frame2.getByRole('button', { name: 'Проверить страницу' }).click();
    await frame2.locator('.log li', { hasText: 'поле ✓' }).waitFor();
    await frame2.getByRole('button', { name: 'Вставить 180 КБ' }).click();
    const large = await frame2.locator('.log li', { hasText: 'R4 180 КБ' }).textContent();
    assert.match(large, /filled, \d+ КБ за \d+ мс(, [\w.]+)?/);
    ok('R6 селекторы и R4 вставка: ' + large.trim());
    await chat.evaluate(() => { document.getElementById('prompt-textarea').textContent = ''; });

    // 4b. Editor that ignores synthetic paste: the previous Web Pilot method is used instead.
    await chat.goto(siteUrl + '/?nopaste');
    const frameNoPaste = chat.frameLocator('wps-sidebar iframe');
    await frameNoPaste.locator('summary', { hasText: 'Проверки этапа 0' }).click();
    await frameNoPaste.getByRole('button', { name: 'Вставить тест' }).click();
    const fallback = await frameNoPaste.locator('.log li', { hasText: 'R1 вставка' }).textContent();
    assert.match(fallback, /filled.*execCommand\.insertText/);
    assert.match(await chat.locator('#prompt-textarea').innerText(), /проверка вставки/);
    ok('запасной способ вставки, если редактор не принял paste: ' + fallback.trim());
    await chat.goto(siteUrl + '/');
    await chat.frameLocator('wps-sidebar iframe').locator('summary', { hasText: 'Проверки этапа 0' }).click();
    await chat.frameLocator('wps-sidebar iframe').getByRole('button', { name: 'Вставить тест' }).click();
    const pasted = await chat.frameLocator('wps-sidebar iframe').locator('.log li', { hasText: 'R1 вставка' }).textContent();
    if (/ClipboardEvent/.test(large)) assert.match(pasted, /filled.*ClipboardEvent\.paste/);
    ok('основной способ вставки: ' + pasted.trim());
    await chat.evaluate(() => { document.getElementById('prompt-textarea').textContent = ''; });
    const frame2b = chat.frameLocator('wps-sidebar iframe');

    // 5. Overlay layout, then in-place rendering instead of iframe.
    await frame2b.locator('#wps-pref-layout').selectOption('overlay');
    await waitUntil(() => chat.evaluate(() => !document.documentElement.classList.contains('wps-push')), { label: 'режим поверх' });
    await chat.waitForTimeout(400);
    await chat.screenshot({ path: path.join(output, '4-inline-overlay.png') });
    ok('режим «поверх» без сдвига страницы');
    await frame2b.locator('#wps-pref-render').selectOption('shadow');
    await chat.locator('wps-sidebar .panel-root >> text=Project Web Pilot').waitFor();
    ok('запасная встроенная отрисовка без iframe');
    await chat.locator('wps-sidebar .panel-root summary').click();
    await chat.locator('wps-sidebar .panel-root #wps-pref-render').selectOption('auto');
    await chat.frameLocator('wps-sidebar iframe').locator('text=Project Web Pilot').waitFor();

    // 6. Open the bound session from the panel.
    const frame3 = chat.frameLocator('wps-sidebar iframe');
    await chat.goto(siteUrl + '/');
    await chat.frameLocator('wps-sidebar iframe').locator('button.project', { hasText: 'Web Pilot Sidebar' }).click();
    await chat.frameLocator('wps-sidebar iframe').getByRole('button', { name: /^Открыть чат/ }).first().click();
    await chat.waitForURL(bound.chatUrl);
    ok('«Открыть» переходит в привязанный чат');
    void frame3;

    // 7. Phone-sized page: panel starts collapsed, WP tab opens it.
    const phone = await context.newPage(); watch(phone, 'phone');
    await phone.setViewportSize({ width: 390, height: 844 });
    await phone.goto(siteUrl + '/');
    await phone.locator('wps-sidebar .toggle').waitFor();
    assert.equal(await phone.evaluate(() => document.querySelector('wps-sidebar').dataset.hidden), 'true');
    await phone.screenshot({ path: path.join(output, '5-phone-collapsed.png') });
    await phone.locator('wps-sidebar .toggle').click();
    await phone.frameLocator('wps-sidebar iframe').locator('text=Project Web Pilot').waitFor();
    await phone.waitForTimeout(400);
    await phone.screenshot({ path: path.join(output, '6-phone-open.png') });
    ok('узкий экран: панель свёрнута, кнопка WP открывает её поверх');

    // 8. A web page cannot talk to the host directly.
    const blocked = await chat.evaluate(async url => { try { const r = await fetch(url + '/v1/health'); return r.status; } catch { return 'blocked'; } }, hostUrl);
    assert.ok(blocked === 'blocked' || blocked === 403, 'страница не должна читать хост: ' + blocked);
    ok('страница сайта не может обратиться к хосту (CORS/403)');

    const unexpected = errors.filter(e => !/Access-Control-Allow-Origin|ORIGIN_FORBIDDEN/i.test(e));
    if (unexpected.length) throw new Error('Ошибки в консоли:\n' + unexpected.join('\n'));
    ok('без ошибок в консоли страниц расширения');
    fs.writeFileSync(path.join(output, 'results.txt'), results.join('\n') + '\n');
    console.log(`\nВсе проверки пройдены (${results.length}). Скриншоты: ${path.relative(root, output)}`);
  } finally {
    await context.close();
    host.server.close(); site.close();
  }
}

main().catch(error => { console.error('✗ ' + (error.stack ?? error)); process.exitCode = 1; });
