#!/usr/bin/env node
// Builds the extension for each browser into dist/<target>/.
// The ChatGPT page adapter is taken from Project Web Pilot (decision D11):
// sources are pinned by SHA-256 in vendor.lock.json and converted from ES
// modules into one classic script, because content scripts cannot be modules.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
export const TARGETS = ['chrome', 'safari', 'chrome-test'];
const DEFAULT_TARGETS = ['chrome', 'safari'];
const CONTENT_SCRIPTS = ['build-config.js', 'webpilot-adapter.js', 'panel-ui.js', 'content.js'];
const PAGE_FILES = ['background.js', 'content.js', 'panel-ui.js', 'panel-host.js', 'panel.html', 'sidepanel.html'];
const sha256 = text => crypto.createHash('sha256').update(text).digest('hex');

class BuildError extends Error {}

function parseArgs(argv) {
  const options = { targets: DEFAULT_TARGETS, webpilot: process.env.WEBPILOT_SRC || path.resolve(root, '..', 'Project Web Pilot'), updateLock: false, release: false, out: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--target') {
      const value = argv[++i];
      options.targets = value === 'all' ? TARGETS : value.split(',');
      for (const t of options.targets) if (!TARGETS.includes(t)) throw new BuildError('Неизвестная цель сборки: ' + t);
    } else if (arg === '--webpilot') options.webpilot = path.resolve(argv[++i]);
    else if (arg === '--out') options.out = path.resolve(argv[++i]);
    else if (arg === '--update-lock') options.updateLock = true;
    else if (arg === '--release') options.release = true;
    else throw new BuildError('Неизвестный параметр: ' + arg);
  }
  // Release builds (signed apps, stores) live apart from the dev builds loaded unpacked.
  options.out ??= path.join(root, 'dist', ...(options.release ? ['release'] : []));
  return options;
}

// Reads the pinned Web Pilot sources and refuses silently changed code.
export function readVendor(webpilot, { updateLock = false, lockFile = path.join(root, 'vendor.lock.json') } = {}) {
  const lock = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
  const sources = {};
  const changed = [];
  for (const [relative, expected] of Object.entries(lock.files)) {
    const file = path.join(webpilot, relative);
    if (!fs.existsSync(file)) throw new BuildError(`Не найден исходник Web Pilot: ${file}\nУкажите путь: --webpilot "<папка Project Web Pilot>" или WEBPILOT_SRC.`);
    const text = fs.readFileSync(file, 'utf8');
    if (sha256(text) !== expected) changed.push(relative);
    sources[path.basename(relative)] = { relative, text, hash: sha256(text) };
  }
  if (changed.length && !updateLock) {
    throw new BuildError(`Адаптер в Web Pilot изменился: ${changed.join(', ')}.\nПроверьте изменения и пересоберите с --update-lock, чтобы принять новую версию.`);
  }
  if (changed.length) {
    for (const source of Object.values(sources)) lock.files[source.relative] = source.hash;
    try { lock.commit = execFileSync('git', ['-C', webpilot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { lock.commit = 'unknown'; }
    fs.writeFileSync(lockFile, JSON.stringify(lock, null, 2) + '\n');
  }
  return { lock, sources };
}

// What the extension uses from the adapter (contract: docs/modules/provider-adapter.md).
export const REQUIRED_EXPORTS = ['CHATGPT_SELECTORS', 'createChatGPTDOM', 'chatGPTDOMScript', 'pageOperation', 'ChatGPTComposer', 'chatGPTEntrypoint', 'isPendingChatGPTConversation'];
const IMPORT_LINE = /^import\s*\{([^}]*)\}\s*from\s*'\.\/([\w.-]+\.mjs)';\s*$/;
const EXPORT_DECL = /^export\s+(?:(?:async\s+)?function\*?|class|const|let)\s+([A-Za-z_$][\w$]*)/;

// Converts one simple ES module into a function body returning its exports.
export function convertModule(name, text) {
  const imports = []; const exports = []; const body = [];
  for (const line of text.split('\n')) {
    if (/^import\b/.test(line)) {
      const match = IMPORT_LINE.exec(line);
      if (!match) throw new BuildError(`${name}: неподдерживаемый import — нужна только форма import { a, b } from './file.mjs'`);
      const names = match[1].split(',').map(s => s.trim()).filter(Boolean).map(s => s.replace(/\s+as\s+/, ': '));
      imports.push({ from: match[2], names });
      continue;
    }
    if (/^export\b/.test(line)) {
      const match = EXPORT_DECL.exec(line);
      if (!match) throw new BuildError(`${name}: неподдерживаемый export: ${line.slice(0, 60)}`);
      exports.push(match[1]);
      body.push(line.replace(/^export\s+/, ''));
      continue;
    }
    if (/\bimport\s*\(|\brequire\s*\(|\bprocess\.|['"]node:/.test(line)) throw new BuildError(`${name}: код зависит от окружения Node или динамического импорта.`);
    body.push(line);
  }
  return { name, imports, exports, body: body.join('\n') };
}

export function bundleAdapter(sources, lock) {
  const modules = Object.fromEntries(Object.entries(sources).map(([name, s]) => [name, convertModule(name, s.text)]));
  const ordered = []; const visiting = new Set();
  const visit = name => {
    if (ordered.includes(name)) return;
    if (visiting.has(name)) throw new BuildError('Циклический импорт: ' + name);
    if (!modules[name]) throw new BuildError('Импорт вне закреплённого набора: ' + name);
    visiting.add(name);
    for (const dep of modules[name].imports) visit(dep.from);
    visiting.delete(name); ordered.push(name);
  };
  Object.keys(modules).sort().forEach(visit);
  const parts = ordered.map(name => {
    const m = modules[name];
    const deps = m.imports.map(i => `  const { ${i.names.join(', ')} } = modules[${JSON.stringify(i.from)}];`).join('\n');
    return `modules[${JSON.stringify(name)}] = (() => {\n${deps}\n${m.body}\n  return { ${m.exports.join(', ')} };\n})();`;
  });
  const all = ordered.flatMap(name => modules[name].exports);
  const missing = REQUIRED_EXPORTS.filter(name => !all.includes(name));
  if (missing.length) throw new BuildError(`В адаптере Web Pilot нет экспорта: ${missing.join(', ')}. На него опирается расширение (docs/modules/provider-adapter.md).`);
  return [
    '// Сгенерировано scripts/build.mjs — не редактировать.',
    `// Источник: ${lock.source} ${lock.commit}`,
    ...Object.values(sources).map(s => `// ${s.relative} sha256 ${s.hash}`),
    '(() => {',
    'const modules = {};',
    ...parts,
    `globalThis.WebPilotAdapter = Object.freeze({ ${all.map(n => `${n}: modules[${JSON.stringify(ordered.find(o => modules[o].exports.includes(n)))}].${n}`).join(', ')} });`,
    '})();',
    '',
  ].join('\n');
}

// Safari reads the background scripts of its generated background page as
// Latin-1, so Cyrillic text turns into mojibake. Plain ASCII reads the same in
// every browser: non-ASCII characters become \uXXXX escapes, which are valid
// in strings, templates, regular expressions, identifiers and comments alike.
export const asciiOnly = text => text.replace(/[^\x00-\x7f]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));

const DESCRIPTION = {
  dev: 'Сайдбар Project Web Pilot внутри страницы ChatGPT — этап 0, проверка осуществимости.',
  release: 'Боковая панель Project Web Pilot на странице ChatGPT: проекты, сессии и ход плана работы.',
};

export function manifestFor(target, version, { release = false } = {}) {
  if (release && target === 'chrome-test') throw new BuildError('Тестовая сборка chrome-test не бывает рабочей (--release).');
  const chatMatches = ['https://chatgpt.com/*'];
  if (target === 'chrome-test') chatMatches.push('http://127.0.0.1/*');
  const icons = { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png', 48: 'icons/icon-48.png', 128: 'icons/icon-128.png' };
  const manifest = {
    manifest_version: 3,
    name: 'Web Pilot Sidebar',
    version,
    description: DESCRIPTION[release ? 'release' : 'dev'],
    icons,
    action: { default_title: 'Web Pilot Sidebar', default_icon: icons },
    permissions: ['storage'],
    host_permissions: chatMatches,
    content_scripts: [{ matches: chatMatches, js: CONTENT_SCRIPTS, run_at: 'document_idle', all_frames: false }],
    web_accessible_resources: [{ resources: ['panel.html', 'panel-ui.js', 'panel-host.js', 'build-config.js', 'icons/icon-32.png'], matches: chatMatches }],
  };
  if (target === 'safari') {
    // iOS Safari: service workers can stop permanently; a non-persistent background page wakes reliably.
    manifest.background = { scripts: ['build-config.js', 'background.js'], persistent: false };
  } else {
    manifest.background = { service_worker: 'background.js' };
    manifest.side_panel = { default_path: 'sidepanel.html' };
    manifest.permissions.push('sidePanel');
  }
  return manifest;
}

export function build(options) {
  const release = !!options.release;
  for (const target of options.targets) manifestFor(target, pkg.version, { release }); // refuse invalid combinations before writing
  const { lock, sources } = readVendor(options.webpilot, { updateLock: options.updateLock });
  const adapter = bundleAdapter(sources, lock);
  const extension = path.join(root, 'extension');
  const built = [];
  for (const target of options.targets) {
    const out = path.join(options.out, target);
    fs.rmSync(out, { recursive: true, force: true });
    fs.mkdirSync(path.join(out, 'icons'), { recursive: true });
    for (const file of PAGE_FILES) {
      const text = fs.readFileSync(path.join(extension, file), 'utf8');
      fs.writeFileSync(path.join(out, file), file.endsWith('.js') ? asciiOnly(text) : text);
    }
    for (const icon of fs.readdirSync(path.join(extension, 'icons'))) fs.copyFileSync(path.join(extension, 'icons', icon), path.join(out, 'icons', icon));
    fs.writeFileSync(path.join(out, 'webpilot-adapter.js'), asciiOnly(adapter));
    const config = { target, version: pkg.version, channel: release ? 'release' : 'dev', testMode: target === 'chrome-test', adapterCommit: lock.commit };
    fs.writeFileSync(path.join(out, 'build-config.js'), asciiOnly(`globalThis.WPS_BUILD = Object.freeze(${JSON.stringify(config)});\n`));
    fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifestFor(target, pkg.version, { release }), null, 2) + '\n');
    built.push(out);
  }
  return built;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const built = build(parseArgs(process.argv.slice(2)));
    for (const out of built) console.log('Собрано: ' + path.relative(root, out));
  } catch (error) {
    if (error instanceof BuildError) { console.error(error.message); process.exitCode = 1; }
    else throw error;
  }
}
