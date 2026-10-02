// Runs the macOS helper "Web Pilot Sidebar.command" end to end with fake
// macOS tools (osascript, open, pbcopy, ...) placed first in PATH. Checks the
// dialog sequence, clipboard contents, build output and host lifecycle.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const webpilot = process.env.WEBPILOT_SRC || path.resolve(root, '..', 'Project Web Pilot');
const haveBash = spawnSync('bash', ['-c', 'exit 0']).status === 0;
const skip = process.platform === 'win32' || !haveBash ? 'нужен bash'
  : !fs.existsSync(path.join(webpilot, 'src', 'chatgpt-composer.mjs')) ? 'нет исходников Project Web Pilot (WEBPILOT_SRC)' : false;

const FAKES = {
  // Answers come from a queue file; every call is recorded in the transcript.
  osascript: `#!/bin/bash
cat > /dev/null
answer="$(head -n 1 "$WPS_FAKE_ANSWERS")"
tail -n +2 "$WPS_FAKE_ANSWERS" > "$WPS_FAKE_ANSWERS.tmp" && mv "$WPS_FAKE_ANSWERS.tmp" "$WPS_FAKE_ANSWERS"
printf 'DIALOG %s\\n  -> %s\\n' "$3" "$answer" >> "$WPS_FAKE_LOG"
printf '%s\\n' "$answer"
`,
  pbcopy: `#!/bin/bash
cat > "$WPS_FAKE_DIR/clipboard"; printf 'CLIPBOARD %s\\n' "$(cat "$WPS_FAKE_DIR/clipboard")" >> "$WPS_FAKE_LOG"
`,
  open: `#!/bin/bash
printf 'OPEN %s\\n' "$*" >> "$WPS_FAKE_LOG"
case "$*" in *chrome://extensions/*)
  d="$HOME/Library/Application Support/Google/Chrome/Default"; mkdir -p "$d"
  printf '{"extensions":{"settings":{"x":{"path":"%s"}}}}' "$WPS_ROOT/dist/chrome" > "$d/Secure Preferences";;
esac
`,
  lsof: '#!/bin/bash\nexit 1\n',
  mdfind: '#!/bin/bash\necho "/Applications/Google Chrome.app"\n',
  'xcode-select': '#!/bin/bash\nexit 1\n',
};

test('macOS helper installs into Chrome, shows a fresh code and stops the host', { skip, timeout: 180_000 }, () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wps-installer-'));
  const project = path.join(work, 'Web Pilot Sidebar');
  const skipDirs = new Set(['dist', 'build', 'tools', 'node_modules', '.git', '.data', 'output']);
  fs.cpSync(root, project, { recursive: true, filter: source => !skipDirs.has(path.basename(source)) });
  const bin = path.join(work, 'bin'); fs.mkdirSync(bin);
  for (const [name, body] of Object.entries(FAKES)) fs.writeFileSync(path.join(bin, name), body, { mode: 0o755 });
  const answers = path.join(work, 'answers'); const log = path.join(work, 'transcript');
  fs.writeFileSync(answers, [
    'Установить или обновить расширение', 'Начать', 'Chrome',
    'Выбрать папку', webpilot + '/',           // Project Web Pilot is not next to the copy
    'Готово', 'Пропустить', 'Панель открыта', 'Дальше', 'Подключилось', 'Готово',
    'Показать код подключения', 'Готово',
    'Остановить тестовый хост', 'Выход',
  ].join('\n') + '\n');
  fs.writeFileSync(log, '');
  const home = path.join(work, 'home'); fs.mkdirSync(home);
  const result = spawnSync('bash', [path.join(project, 'Web Pilot Sidebar.command')], {
    cwd: project, encoding: 'utf8', timeout: 170_000,
    env: { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'NODE_TEST_CONTEXT')), HOME: home, PATH: bin + path.delimiter + process.env.PATH, WPS_INSTALLER_TEST: '1',
      WPS_HOST_PORT: String(18000 + Math.floor(Math.random() * 2000)),
      WPS_FAKE_ANSWERS: answers, WPS_FAKE_LOG: log, WPS_FAKE_DIR: work, WPS_ROOT: project },
  });
  const transcript = fs.readFileSync(log, 'utf8');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(fs.readFileSync(answers, 'utf8').trim(), '', 'every prepared answer was used:\n' + transcript);
  assert.ok(fs.existsSync(path.join(project, 'dist', 'chrome', 'manifest.json')));
  assert.ok(fs.existsSync(path.join(project, 'dist', 'safari', 'manifest.json')));
  assert.match(transcript, new RegExp('CLIPBOARD ' + project.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/dist/chrome'));
  assert.match(transcript, /OPEN -a \/Applications\/Google Chrome\.app chrome:\/\/extensions\//);
  const codes = [...transcript.matchAll(/CLIPBOARD ([A-Z2-9]{4}-[A-Z2-9]{4})/g)].map(m => m[1]);
  assert.equal(codes.length, 2, 'code for pairing and code from the menu');
  assert.notEqual(codes[0], codes[1], 'the menu always shows a fresh code');
  assert.match(result.stdout, /проверки пройдены/);
  assert.match(result.stdout, /Chrome: подключено/);
  assert.ok(!fs.existsSync(path.join(project, 'mock-host', '.data', 'host.pid')), 'host stopped');
  assert.ok(!fs.existsSync(path.join(project, 'mock-host', '.data', 'pairing-code.json')), 'code file removed with the host');
});
