import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { asciiOnly, build, bundleAdapter, convertModule, manifestFor, readVendor } from '../scripts/build.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const webpilot = process.env.WEBPILOT_SRC || path.resolve(root, '..', 'Project Web Pilot');
const haveWebPilot = fs.existsSync(path.join(webpilot, 'src', 'chatgpt-composer.mjs'));
const skip = haveWebPilot ? false : 'нет исходников Project Web Pilot (WEBPILOT_SRC)';

test('module conversion keeps exports and refuses unsupported syntax', () => {
  const converted = convertModule('a.mjs', "import { x, y as z } from './b.mjs';\nexport const one = 1;\nexport function two() { return x; }\nexport class Three {}\n");
  assert.deepEqual(converted.exports, ['one', 'two', 'Three']);
  assert.deepEqual(converted.imports, [{ from: 'b.mjs', names: ['x', 'y: z'] }]);
  assert.throws(() => convertModule('a.mjs', "import fs from 'node:fs';"), /неподдерживаемый import/);
  assert.throws(() => convertModule('a.mjs', 'export default 1;'), /неподдерживаемый export/);
  assert.throws(() => convertModule('a.mjs', "const m = await import('./x.mjs');"), /окружения Node/);
});

test('adapter bundle refuses Web Pilot sources without the exports the extension uses', () => {
  const sources = { 'chatgpt-composer.mjs': { relative: 'src/chatgpt-composer.mjs', hash: 'x', text: 'function pageOperation() {}\nexport function pageScript() {}\n' } };
  assert.throws(() => bundleAdapter(sources, { source: 'test', commit: 'x' }), /нет экспорта: CHATGPT_SELECTORS, createChatGPTDOM, chatGPTDOMScript, pageOperation/);
});

test('manifests differ only where browsers differ', () => {
  const chrome = manifestFor('chrome', '1.0.0');
  const safari = manifestFor('safari', '1.0.0');
  const testBuild = manifestFor('chrome-test', '1.0.0');
  assert.equal(chrome.background.service_worker, 'background.js');
  assert.equal(chrome.side_panel.default_path, 'sidepanel.html');
  assert.ok(chrome.permissions.includes('sidePanel'));
  assert.deepEqual(safari.background, { scripts: ['build-config.js', 'background.js'], persistent: false });
  assert.equal(safari.side_panel, undefined);
  assert.ok(!safari.permissions.includes('sidePanel'));
  for (const m of [chrome, safari]) {
    assert.deepEqual(m.host_permissions, ['https://chatgpt.com/*'], 'no broad host access');
    assert.deepEqual(m.content_scripts[0].matches, ['https://chatgpt.com/*']);
    assert.equal(m.content_scripts[0].all_frames, false);
  }
  assert.ok(testBuild.content_scripts[0].matches.includes('http://127.0.0.1/*'));
});

test('release manifests drop stage 0 wording and never include the test target', () => {
  for (const target of ['chrome', 'safari']) {
    assert.match(manifestFor(target, '1.0.0').description, /этап 0/);
    assert.doesNotMatch(manifestFor(target, '1.0.0', { release: true }).description, /этап 0/);
  }
  assert.throws(() => manifestFor('chrome-test', '1.0.0', { release: true }), /chrome-test/);
});

test('ascii escaping keeps the meaning of scripts', () => {
  const source = "const word = 'Пакет «готов» 😀'; const re = /[а-я]+/u; const t = `шаблон ${word}`; // комментарий\n[word, re.test('слово'), t];";
  const escaped = asciiOnly(source);
  assert.match(escaped, /^[\x00-\x7f]*$/);
  assert.equal(JSON.stringify(vm.runInNewContext(escaped)), JSON.stringify(vm.runInNewContext(source)));
});

test('build refuses changed Web Pilot sources unless the lock is updated', { skip }, () => {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'wps-webpilot-'));
  fs.mkdirSync(path.join(copy, 'src'));
  for (const file of ['chatgpt-dom.mjs', 'chatgpt-composer.mjs', 'chatgpt-experience.mjs']) fs.copyFileSync(path.join(webpilot, 'src', file), path.join(copy, 'src', file));
  assert.doesNotThrow(() => readVendor(copy));
  fs.appendFileSync(path.join(copy, 'src', 'chatgpt-dom.mjs'), '\n// changed\n');
  assert.throws(() => readVendor(copy), /изменился: src\/chatgpt-dom\.mjs/);
  const lockCopy = path.join(copy, 'vendor.lock.json');
  fs.copyFileSync(path.join(root, 'vendor.lock.json'), lockCopy);
  readVendor(copy, { updateLock: true, lockFile: lockCopy });
  assert.doesNotThrow(() => readVendor(copy, { lockFile: lockCopy }));
});

test('built adapter exposes Web Pilot page operations as a classic script', { skip }, () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'wps-dist-'));
  build({ targets: ['chrome', 'safari'], webpilot, updateLock: false, out });
  for (const target of ['chrome', 'safari']) {
    const dir = path.join(out, target);
    for (const file of ['manifest.json', 'background.js', 'content.js', 'panel-ui.js', 'panel-host.js', 'panel.html', 'webpilot-adapter.js', 'build-config.js', 'icons/icon-128.png']) {
      assert.ok(fs.existsSync(path.join(dir, file)), `${target}/${file}`);
    }
    const sandbox = { document: { querySelectorAll: () => [] } };
    sandbox.globalThis = sandbox;
    vm.runInNewContext(fs.readFileSync(path.join(dir, 'webpilot-adapter.js'), 'utf8'), sandbox);
    const A = sandbox.WebPilotAdapter;
    for (const name of ['createChatGPTDOM', 'pageOperation', 'ChatGPTComposer', 'chatGPTEntrypoint', 'isPendingChatGPTConversation']) assert.equal(typeof A[name], 'function', name);
    assert.equal(A.chatGPTEntrypoint('chat'), 'https://chatgpt.com/');
    vm.runInNewContext(fs.readFileSync(path.join(dir, 'build-config.js'), 'utf8'), sandbox);
    assert.equal(sandbox.WPS_BUILD.target, target);
    assert.equal(sandbox.WPS_BUILD.testMode, false);
    assert.equal(sandbox.WPS_BUILD.channel, 'dev');
    for (const file of fs.readdirSync(dir).filter(name => name.endsWith('.js'))) {
      assert.match(fs.readFileSync(path.join(dir, file), 'utf8'), /^[\x00-\x7f]*$/, `${target}/${file} is plain ASCII (Safari mojibake)`);
    }
  }
});

test('release build is separate and marked as release', { skip }, () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'wps-release-'));
  build({ targets: ['chrome', 'safari'], webpilot, updateLock: false, out, release: true });
  for (const target of ['chrome', 'safari']) {
    const sandbox = {}; sandbox.globalThis = sandbox;
    vm.runInNewContext(fs.readFileSync(path.join(out, target, 'build-config.js'), 'utf8'), sandbox);
    assert.equal(sandbox.WPS_BUILD.channel, 'release');
    assert.doesNotMatch(JSON.parse(fs.readFileSync(path.join(out, target, 'manifest.json'), 'utf8')).description, /этап 0/);
  }
  assert.throws(() => build({ targets: ['chrome-test'], webpilot, updateLock: false, out, release: true }), /chrome-test/);
});

test('Safari container app bundles exactly the files of the release build', { skip }, () => {
  const project = path.join(root, 'apple', 'Web Pilot Sidebar.xcodeproj', 'project.pbxproj');
  const listed = [...fs.readFileSync(project, 'utf8').matchAll(/path = "?\.\.\/\.\.\/dist\/release\/safari\/([^";]+)"?;/g)].map(m => m[1]);
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'wps-apple-'));
  build({ targets: ['safari'], webpilot, updateLock: false, out, release: true });
  assert.deepEqual([...new Set(listed)].sort(), fs.readdirSync(path.join(out, 'safari')).sort(), 'apple/ must list every top-level file of dist/release/safari');
});
