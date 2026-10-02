#!/bin/bash
# Web Pilot Sidebar — установщик и пульт этапа 0 для macOS.
# Двойной щелчок в Finder открывает это окно Терминала. Всё, что нужно сделать
# самому пользователю, объясняется системными окнами macOS. Помощник ничего не
# удаляет и не меняет Project Web Pilot. Совместим с /bin/bash 3.2 (macOS).

[ -n "${LANG:-}" ] || export LANG="en_US.UTF-8"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT" || exit 1

TITLE="Web Pilot Sidebar"
DATA="$ROOT/mock-host/.data"
TOOLS="$ROOT/tools"
CHROME_DIST="$ROOT/dist/chrome"
HOST_LOG="$DATA/host.log"
HOST_PID="$DATA/host.pid"
CODE_FILE="$DATA/pairing-code.json"
PORT_FILE="$DATA/port"
TUNNEL_LOG="$DATA/tunnel.log"
TUNNEL_PID="$DATA/tunnel.pid"
NL=$'\n'
NODE=""; WEBPILOT=""; TUNNEL=""; CODE=""; CODE_UNTIL=""
DONE_ITEMS=""

mkdir -p "$DATA"

# ---------- вывод в Терминал ----------
BOLD=$'\033[1m'; TEAL=$'\033[36m'; GREEN=$'\033[32m'; RED=$'\033[31m'; YELLOW=$'\033[33m'; RESET=$'\033[0m'
step() { printf '\n%s▸ %s%s\n' "$BOLD$TEAL" "$1" "$RESET"; }
ok()   { printf '  %s✓%s %s\n' "$GREEN" "$RESET" "$1"; }
warn() { printf '  %s!%s %s\n' "$YELLOW" "$RESET" "$1"; }
fail() { printf '  %s✗%s %s\n' "$RED" "$RESET" "$1"; }
done_item() { DONE_ITEMS="$DONE_ITEMS• $1$NL"; }

# ---------- системные окна macOS (текст передаётся аргументами, без экранирования) ----------
dialog() { # dialog "текст" "кнопка" ... — печатает нажатую кнопку; последняя — по умолчанию
  osascript - "$TITLE" "$@" <<'APPLESCRIPT' 2>/dev/null
on run argv
  set theButtons to items 3 thru -1 of argv
  try
    set r to display dialog (item 2 of argv) buttons theButtons default button (last item of theButtons) with title (item 1 of argv) with icon note
    return button returned of r
  on error number -128
    return ""
  end try
end run
APPLESCRIPT
}

choose() { # choose many|one "вопрос" вариант ... — печатает выбранные варианты построчно
  osascript - "$TITLE" "$@" <<'APPLESCRIPT' 2>/dev/null
on run argv
  set theItems to items 4 thru -1 of argv
  if item 2 of argv is "many" then
    set r to choose from list theItems with title (item 1 of argv) with prompt (item 3 of argv) default items {item 1 of theItems} OK button name "Продолжить" cancel button name "Отмена" with multiple selections allowed
  else
    set r to choose from list theItems with title (item 1 of argv) with prompt (item 3 of argv) default items {item 1 of theItems} OK button name "Выбрать" cancel button name "Выход"
  end if
  if r is false then return ""
  set AppleScript's text item delimiters to linefeed
  return r as text
end run
APPLESCRIPT
}

choose_folder() {
  osascript - "$1" <<'APPLESCRIPT' 2>/dev/null
on run argv
  try
    return POSIX path of (choose folder with prompt (item 1 of argv))
  on error number -128
    return ""
  end try
end run
APPLESCRIPT
}

copy_text() { printf '%s' "$1" | pbcopy; }
confirm() { [ "$(dialog "$1" "Отмена" "${2:-Готово}")" = "${2:-Готово}" ]; }

# Убить процесс по pid-файлу, только если это действительно наш процесс.
stop_pid_file() { # stop_pid_file файл шаблон-команды
  [ -f "$1" ] || return 0
  local pid; pid="$(cat "$1" 2>/dev/null)"
  if [ -n "$pid" ] && ps -p "$pid" -o command= 2>/dev/null | grep -q "$2"; then kill "$pid" 2>/dev/null; fi
  rm -f "$1"
}

# ---------- Node.js ----------
find_node() {
  local candidate major
  for candidate in "$(command -v node 2>/dev/null)" /opt/homebrew/bin/node /usr/local/bin/node "$HOME/.volta/bin/node"; do
    [ -n "$candidate" ] && [ -x "$candidate" ] || continue
    major="$("$candidate" -p 'process.versions.node.split(".")[0]' 2>/dev/null)" || continue
    if [ "${major:-0}" -ge 22 ] 2>/dev/null; then NODE="$candidate"; return 0; fi
  done
  return 1
}

ensure_node() {
  [ -n "$NODE" ] && return 0
  step "Node.js"
  local answer
  while ! find_node; do
    if command -v brew >/dev/null 2>&1; then
      answer="$(dialog "Для сборки расширения и тестового хоста нужен Node.js 22 или новее.${NL}${NL}На этом Mac есть Homebrew — можно установить одной командой." "Отмена" "Открыть сайт Node.js" "Установить")"
      case "$answer" in
        "Установить") brew install node || fail "Homebrew не смог установить Node.js." ;;
        "Открыть сайт Node.js") open "https://nodejs.org/en/download"; confirm "Скачайте установщик Node.js для macOS (LTS), установите его и нажмите «Готово»." || return 1 ;;
        *) return 1 ;;
      esac
    else
      confirm "Для сборки расширения и тестового хоста нужен Node.js 22 или новее.${NL}${NL}Сейчас откроется сайт Node.js: скачайте установщик для macOS (LTS), установите его и вернитесь к этому окну." "Открыть сайт" || return 1
      open "https://nodejs.org/en/download"
      confirm "Node.js установлен?" || return 1
    fi
  done
  ok "Node.js $("$NODE" --version)"
}

# ---------- исходники Project Web Pilot ----------
find_webpilot() {
  WEBPILOT="$ROOT/../Project Web Pilot"
  [ -f "$WEBPILOT/src/chatgpt-composer.mjs" ] && return 0
  if [ -f "$DATA/webpilot-path" ]; then
    WEBPILOT="$(cat "$DATA/webpilot-path")"
    [ -f "$WEBPILOT/src/chatgpt-composer.mjs" ] && return 0
  fi
  return 1
}

ensure_webpilot() {
  step "Исходники Project Web Pilot"
  local chosen
  while ! find_webpilot; do
    confirm "Расширение берёт код работы со страницей ChatGPT из папки Project Web Pilot, но рядом с этой папкой её нет.${NL}${NL}Укажите, где лежит Project Web Pilot." "Выбрать папку" || return 1
    chosen="$(choose_folder "Папка Project Web Pilot")"
    [ -n "$chosen" ] || return 1
    if [ -f "${chosen%/}/src/chatgpt-composer.mjs" ]; then printf '%s' "${chosen%/}" > "$DATA/webpilot-path"
    else dialog "В этой папке нет src/chatgpt-composer.mjs — это не Project Web Pilot." "Понятно" >/dev/null; fi
  done
  WEBPILOT="$(cd "$WEBPILOT" && pwd)"
  ok "$WEBPILOT"
}

# ---------- сборка и самопроверка ----------
build_extension() {
  step "Сборка расширения"
  local out
  if out="$("$NODE" scripts/build.mjs --webpilot "$WEBPILOT" 2>&1)"; then ok "собрано: dist/chrome и dist/safari"; return 0; fi
  if printf '%s' "$out" | grep -q 'изменился'; then
    printf '%s\n' "$out"
    confirm "Код работы со страницей ChatGPT в Project Web Pilot изменился с тех пор, как его закрепили для расширения.${NL}${NL}Если вы обновляли Web Pilot — это ожидаемо. Принять новую версию и собрать?" "Принять и собрать" || return 1
    if out="$("$NODE" scripts/build.mjs --webpilot "$WEBPILOT" --update-lock 2>&1)"; then ok "собрано с новой версией адаптера Web Pilot"; return 0; fi
  fi
  fail "Сборка не удалась:"; printf '%s\n' "$out"
  dialog "Сборка не удалась. Подробности — в окне Терминала." "Понятно" >/dev/null
  return 1
}

self_check() {
  step "Самопроверка"
  local out passed
  out="$(env -u NODE_TEST_CONTEXT WEBPILOT_SRC="$WEBPILOT" "$NODE" --test test/mock-host.test.mjs test/build.test.mjs 2>&1)"
  passed="$(printf '%s\n' "$out" | sed -n 's/^# pass //p')"
  if printf '%s\n' "$out" | grep -q '^# fail 0'; then ok "проверки пройдены: ${passed:-?}"; return 0; fi
  # Собранное расширение с ошибкой не заработает в браузере — дальше не идём.
  fail "самопроверка не прошла:"; printf '%s\n' "$out" | sed -n '/^not ok/,/^  \.\.\./p' | head -n 60
  dialog "Самопроверка не прошла: расширение собрано, но работать в браузере не будет. Подробности — в окне Терминала.${NL}${NL}Частая причина — обновление Project Web Pilot, несовместимое с расширением." "Понятно" >/dev/null
  return 1
}

# ---------- тестовый хост ----------
host_port() { cat "$PORT_FILE" 2>/dev/null || echo "${WPS_HOST_PORT:-8787}"; }
host_url() { echo "http://127.0.0.1:$(host_port)"; }
host_alive() { curl -fsS --max-time 2 "$(host_url)/v1/health" 2>/dev/null | grep -q 'Тестовый хост Web Pilot'; }
port_busy() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

start_host() {
  step "Тестовый хост"
  if host_alive; then
    if [ -f "$CODE_FILE" ]; then ok "уже работает: $(host_url)"; return 0; fi
    warn "хост уже запущен в другом окне — код подключения смотрите там"; return 0
  fi
  local port="${WPS_HOST_PORT:-8787}" attempt
  while port_busy "$port"; do
    port=$((port + 1))
    if [ "$port" -gt $(( ${WPS_HOST_PORT:-8787} + 12 )) ]; then fail "нет свободного порта рядом с ${WPS_HOST_PORT:-8787}"; return 1; fi
  done
  printf '%s' "$port" > "$PORT_FILE"
  nohup "$NODE" mock-host/server.mjs --port "$port" --code-file "$CODE_FILE" --pid-file "$HOST_PID" >> "$HOST_LOG" 2>&1 < /dev/null &
  for attempt in $(seq 1 50); do
    if host_alive && [ -f "$CODE_FILE" ]; then ok "запущен в фоне: $(host_url) (журнал: mock-host/.data/host.log)"; return 0; fi
    sleep 0.2
  done
  fail "хост не запустился. Последние строки журнала:"; tail -n 15 "$HOST_LOG"
  dialog "Тестовый хост не запустился. Подробности — в окне Терминала." "Понятно" >/dev/null
  return 1
}

read_code() { # печатает "КОД|ЧЧ:ММ|осталось_мс"
  "$NODE" -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(d.code+"|"+new Date(d.expiresAt).toTimeString().slice(0,5)+"|"+(d.expiresAt-Date.now()))' "$CODE_FILE" 2>/dev/null
}

fresh_code() { # $1=force — всегда новый код
  local info left pid
  info="$(read_code)" || return 1
  left="${info##*|}"
  if [ "${1:-}" = "force" ] || [ "${left:-0}" -lt 90000 ] 2>/dev/null; then
    pid="$(cat "$HOST_PID" 2>/dev/null)"
    if [ -n "$pid" ] && ps -p "$pid" -o command= 2>/dev/null | grep -q 'mock-host/server.mjs'; then
      kill -USR2 "$pid" 2>/dev/null; sleep 0.6; info="$(read_code)" || return 1
    fi
  fi
  CODE="${info%%|*}"; info="${info#*|}"; CODE_UNTIL="${info%%|*}"
}

show_code() {
  if ! fresh_code force; then dialog "Код подключения показан в окне, где запущен тестовый хост." "Понятно" >/dev/null; return; fi
  copy_text "$CODE"
  dialog "Код подключения:${NL}${NL}        $CODE${NL}${NL}Действует до $CODE_UNTIL, одноразовый. Уже скопирован — вставьте его в панели (⌘V).${NL}Адрес хоста на этом Mac: $(host_url)" "Готово" >/dev/null
}

guide_pairing() { # guide_pairing адрес "где" [remote]
  local address="$1" where="$2" remote="${3:-}" answer
  while :; do
    if [ -z "$remote" ]; then
      copy_text "$address"
      dialog "Подключение · $where${NL}${NL}1. В панели Web Pilot Sidebar в поле «Адрес хоста» вставьте адрес (уже скопирован, ⌘V):${NL}$address${NL}${NL}2. Нажмите «Дальше» — скопирую код подключения." "Дальше" >/dev/null
    fi
    if ! fresh_code; then dialog "Код подключения показан в окне, где запущен тестовый хост." "Понятно" >/dev/null; return; fi
    if [ -n "$remote" ]; then
      copy_text "$CODE"
      answer="$(dialog "Подключение · $where${NL}${NL}В панели на $where введите:${NL}${NL}Адрес хоста:${NL}$address${NL}${NL}Код:  $CODE   (действует до $CODE_UNTIL)${NL}${NL}Если на устройствах один Apple ID и включён общий буфер обмена — код уже можно вставить." "Не получилось" "Подключилось")"
    else
      copy_text "$CODE"
      answer="$(dialog "Подключение · $where${NL}${NL}Вставьте код в поле «Код подключения» (⌘V):${NL}${NL}        $CODE${NL}${NL}Действует до $CODE_UNTIL. Нажмите «Подключить» в панели. Появился список проектов?" "Не получилось" "Подключилось")"
    fi
    if [ "$answer" = "Подключилось" ]; then ok "$where: подключено"; done_item "$where: установлено и подключено"; return 0; fi
    answer="$(dialog "Что проверить:${NL}• адрес вставлен полностью, без пробелов;${NL}• код ещё действует (он одноразовый — после удачного подключения нужен новый);${NL}• это окно Терминала открыто — в нём работает тестовый хост.${NL}${NL}Попробовать с новым кодом?" "Пропустить" "Новый код")"
    [ "$answer" = "Новый код" ] || { warn "$where: подключение пропущено"; return 0; }
    fresh_code force
  done
}

# ---------- Chrome ----------
chrome_app() {
  local app
  for app in "/Applications/Google Chrome.app" "$HOME/Applications/Google Chrome.app"; do
    [ -d "$app" ] && { echo "$app"; return 0; }
  done
  mdfind "kMDItemCFBundleIdentifier == 'com.google.Chrome'" 2>/dev/null | head -n 1
}
chrome_has_extension() {
  grep -rlsF --include='Secure Preferences' --include='Preferences' "\"$CHROME_DIST\"" "$HOME/Library/Application Support/Google/Chrome" >/dev/null 2>&1
}

install_chrome() {
  step "Chrome"
  local app answer attempt
  app="$(chrome_app)"
  if [ -z "$app" ]; then
    [ "$(dialog "Google Chrome не найден на этом Mac. Его можно установить с сайта google.com/chrome и потом снова запустить помощник." "Пропустить" "Открыть сайт")" = "Открыть сайт" ] && open "https://www.google.com/chrome/"
    warn "Chrome пропущен"; return 0
  fi
  if chrome_has_extension; then
    ok "расширение уже загружено в Chrome"
    answer="$(dialog "Web Pilot Sidebar уже установлен в Chrome. После новой сборки его нужно обновить: на странице «Расширения» у Web Pilot Sidebar нажмите кнопку обновления ⟳, затем перезагрузите вкладку chatgpt.com." "Пропустить" "Открыть «Расширения»")"
    [ "$answer" = "Открыть «Расширения»" ] && { open -a "$app" "chrome://extensions/"; confirm "Нажмите ⟳ у Web Pilot Sidebar и затем «Готово»." >/dev/null; }
  else
    copy_text "$CHROME_DIST"
    open -a "$app" "chrome://extensions/"
    confirm "Установка в Chrome — три действия на открывшейся странице «Расширения»:${NL}${NL}1. Справа вверху включите «Режим разработчика».${NL}2. Нажмите «Загрузить распакованное расширение».${NL}3. В окне выбора папки нажмите ⌘⇧G, вставьте путь (он уже скопирован, ⌘V), нажмите Enter, затем «Выбрать».${NL}${NL}Путь: $CHROME_DIST${NL}${NL}Если страница не открылась — наберите в адресной строке Chrome: chrome://extensions" || { warn "Chrome пропущен"; return 0; }
    for attempt in 1 2 3 4 5 6; do chrome_has_extension && break; sleep 1; done
    while ! chrome_has_extension; do
      answer="$(dialog "Пока не вижу расширение в настройках Chrome (иногда Chrome записывает их с задержкой).${NL}${NL}Проверьте, что в списке «Расширения» появилась карточка Web Pilot Sidebar без ошибок." "Пропустить проверку" "Проверить ещё раз")"
      [ "$answer" = "Проверить ещё раз" ] || break
      sleep 1
    done
    chrome_has_extension && ok "расширение загружено в Chrome"
  fi
  answer="$(dialog "Удобнее, когда панель слева, а значок всегда под рукой:${NL}${NL}• Настройки Chrome → «Внешний вид» → положение боковой панели → «Слева».${NL}• Значок-пазл справа от адресной строки → булавка у Web Pilot Sidebar." "Пропустить" "Открыть настройки")"
  [ "$answer" = "Открыть настройки" ] && { open -a "$app" "chrome://settings/appearance"; confirm "Когда закончите с настройками, нажмите «Готово»." >/dev/null; }
  open -a "$app" "https://chatgpt.com/"
  confirm "Откройте панель: на вкладке chatgpt.com нажмите значок Web Pilot Sidebar. Появится боковая панель с формой «Подключить к Mac».${NL}${NL}Если вы не вошли в ChatGPT — войдите как обычно." "Панель открыта" || { warn "Chrome: подключение пропущено"; return 0; }
  guide_pairing "$(host_url)" "Chrome"
}

# ---------- Safari на Mac ----------
SAFARI_DEV="$ROOT/dist/safari"
signed_app() { # подписанное и нотаризованное приложение-обёртка в «Программах»
  local app
  for app in "/Applications/Web Pilot Sidebar.app" "$HOME/Applications/Web Pilot Sidebar.app"; do
    [ -d "$app" ] && spctl --assess --type execute "$app" >/dev/null 2>&1 && { echo "$app"; return 0; }
  done
  return 1
}
signed_dmg() { ls -t "$ROOT"/dist/release/Web-Pilot-Sidebar-*.dmg 2>/dev/null | head -n 1; }
safari_major() { defaults read /Applications/Safari.app/Contents/Info.plist CFBundleShortVersionString 2>/dev/null | cut -d. -f1; }

install_safari_signed() { # ставит подписанную версию, если она есть; иначе возвращает 1
  local app dmg
  app="$(signed_app)" || {
    dmg="$(signed_dmg)"; [ -n "$dmg" ] || return 1
    open "$dmg"
    confirm "Откроется окно установки Web Pilot Sidebar. Перетащите значок приложения в папку «Программы» (Applications), затем нажмите «Готово»." || return 1
    app="$(signed_app)" || { warn "подписанное приложение в «Программах» не найдено"; return 1; }
  }
  ok "подписанное приложение: $app"
  open "$app"
  confirm "Откроется окно «Web Pilot Sidebar». Нажмите в нём «Закрыть и открыть настройки Safari» и включите Web Pilot Sidebar в разделе «Расширения».${NL}${NL}Расширение подписано: меню «Разработка» и временная установка не нужны." || return 1
  done_item "Safari на Mac: подписанная версия"
}

install_safari_temporary() { # версия для разработки: Safari 26+ загружает расширение прямо из папки
  local major; major="$(safari_major)"
  if [ -n "$major" ] && [ "$major" -lt 26 ]; then
    dialog "Временная установка расширения появилась в Safari 26, у вас Safari $major.${NL}${NL}Обновите macOS или поставьте подписанную версию (.dmg)." "Понятно" >/dev/null
    return 1
  fi
  copy_text "$SAFARI_DEV"
  confirm "Подписанной версии на этом Mac нет — ставлю версию для разработки.${NL}${NL}1. Safari → Настройки → «Дополнения»: включите «Показывать функции для веб-разработчиков».${NL}2. Safari → Настройки → «Разработчик» → «Добавить временное расширение…» (Add Temporary Extension), подтвердите паролем или Touch ID.${NL}3. В окне выбора папки нажмите ⌘⇧G, вставьте путь (уже скопирован, ⌘V) и нажмите «Выбрать»:${NL}$SAFARI_DEV${NL}4. Safari → Настройки → «Расширения»: проверьте, что Web Pilot Sidebar включён.${NL}${NL}При закрытии Safari временное расширение выгружается — тогда повторите шаги 2–3." || return 1
  done_item "Safari на Mac: версия для разработки (временная)"
}

install_safari_mac() {
  step "Safari на Mac"
  install_safari_signed || install_safari_temporary || { warn "Safari на Mac пропущен"; return 0; }
  open -a Safari "https://chatgpt.com/"
  confirm "На chatgpt.com нажмите значок Web Pilot Sidebar (слева от адресной строки или в меню расширений) и разрешите доступ к сайту chatgpt.com. Панель появится на странице слева." "Панель видна" || { warn "Safari на Mac: подключение пропущено"; return 0; }
  guide_pairing "$(host_url)" "Safari на Mac"
}

# ---------- iPad / iPhone ----------
cloudflared_bin() {
  if command -v cloudflared >/dev/null 2>&1; then command -v cloudflared; return 0; fi
  [ -x "$TOOLS/cloudflared" ] && { echo "$TOOLS/cloudflared"; return 0; }
  return 1
}

ensure_cloudflared() {
  CLOUDFLARED="$(cloudflared_bin)" && return 0
  confirm "iPad и iPhone подключаются к Mac только по HTTPS. Для проверки нужен временный HTTPS-адрес — его даёт бесплатная программа cloudflared от Cloudflare.${NL}${NL}Скачать её в папку проекта (tools/)? Систему она не меняет." "Скачать" || return 1
  local arch; arch="$(uname -m)"; [ "$arch" = "arm64" ] || arch="amd64"
  mkdir -p "$TOOLS"
  if curl -fL --progress-bar -o "$TOOLS/cloudflared.tgz" "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-$arch.tgz" \
     && tar -xzf "$TOOLS/cloudflared.tgz" -C "$TOOLS" && chmod +x "$TOOLS/cloudflared"; then
    rm -f "$TOOLS/cloudflared.tgz"; CLOUDFLARED="$TOOLS/cloudflared"; ok "cloudflared скачан в tools/"; return 0
  fi
  rm -f "$TOOLS/cloudflared.tgz"; fail "не удалось скачать cloudflared"; return 1
}

tunnel_url() { grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" 2>/dev/null | tail -n 1; }
tunnel_alive() { [ -f "$TUNNEL_PID" ] && ps -p "$(cat "$TUNNEL_PID")" -o command= 2>/dev/null | grep -q cloudflared; }

start_tunnel() {
  step "HTTPS-адрес для iPad и iPhone"
  if tunnel_alive && [ -n "$(tunnel_url)" ]; then TUNNEL="$(tunnel_url)"; ok "уже работает: $TUNNEL"; return 0; fi
  ensure_cloudflared || return 1
  : > "$TUNNEL_LOG"
  nohup "$CLOUDFLARED" tunnel --no-autoupdate --url "$(host_url)" >> "$TUNNEL_LOG" 2>&1 < /dev/null &
  echo $! > "$TUNNEL_PID"
  local attempt
  TUNNEL=""
  for attempt in $(seq 1 100); do TUNNEL="$(tunnel_url)"; [ -n "$TUNNEL" ] && break; sleep 0.3; done
  if [ -z "$TUNNEL" ]; then fail "адрес не получен. Журнал:"; tail -n 15 "$TUNNEL_LOG"; return 1; fi
  for attempt in $(seq 1 40); do curl -fsS --max-time 3 "$TUNNEL/v1/health" >/dev/null 2>&1 && break; sleep 1; done
  ok "$TUNNEL (временный, пока работает этот пульт или до остановки хоста)"
}

show_tunnel() {
  copy_text "$TUNNEL"
  dialog "Адрес хоста для iPad и iPhone:${NL}${NL}$TUNNEL${NL}${NL}Уже скопирован. Адрес временный: после остановки хоста он перестанет работать, при следующем запуске будет новый." "Готово" >/dev/null
}

install_ipad() {
  step "Safari на iPad или iPhone"
  start_tunnel || { warn "iPad пропущен: нет HTTPS-адреса"; return 0; }
  confirm "Установка на iPad или iPhone — через TestFlight:${NL}${NL}1. Поставьте из App Store бесплатное приложение TestFlight.${NL}2. Откройте приглашение Web Pilot Sidebar — оно приходит на почту вашего Apple ID после того, как сборка загружена в App Store Connect (scripts/release-apple.sh ios).${NL}3. В TestFlight нажмите «Установить».${NL}${NL}Если приглашения ещё нет — нажмите «Отмена» и вернитесь к этому шагу позже." "Установлено" || { warn "iPad пропущен"; return 0; }
  confirm "На iPad: Настройки → Приложения → Safari → Расширения → Web Pilot Sidebar → включить и разрешить для chatgpt.com.${NL}${NL}Затем откройте chatgpt.com в Safari — панель появится слева (на iPhone — нажмите вкладку WP у левого края)." "Панель видна" || { warn "iPad: подключение пропущено"; return 0; }
  guide_pairing "$TUNNEL" "iPad или iPhone" remote
}

# ---------- остановка ----------
stop_all() {
  step "Остановка"
  stop_pid_file "$TUNNEL_PID" cloudflared
  stop_pid_file "$HOST_PID" 'mock-host/server.mjs'
  sleep 0.5
  host_alive && warn "хост ещё отвечает — возможно, он запущен вручную в другом окне" || ok "тестовый хост и HTTPS-адрес остановлены"
}

# ---------- сценарии ----------
install_wizard() {
  DONE_ITEMS=""
  confirm "Помощник:${NL}• соберёт расширение из этой папки;${NL}• запустит на этом Mac тестовый хост (тестовые данные, Project Web Pilot не меняется);${NL}• проведёт вас по установке в выбранные браузеры и подключению.${NL}${NL}Там, где нужно ваше действие, появится такое окно с инструкцией." "Начать" || return
  local targets
  targets="$(choose many "Куда установить? Можно выбрать несколько (⌘-щелчок)." "Chrome" "Safari на Mac" "Safari на iPad или iPhone")"
  [ -n "$targets" ] || return
  ensure_node || return
  ensure_webpilot || return
  build_extension || return
  self_check || return
  start_host || return
  done_item "Тестовый хост работает: $(host_url)"
  case "$targets" in *Chrome*) install_chrome ;; esac
  case "$targets" in *"на Mac"*) install_safari_mac ;; esac
  case "$targets" in *iPad*) install_ipad ;; esac
  dialog "Готово.${NL}${NL}${DONE_ITEMS}${NL}Тестовый хост работает в фоне. Новый код подключения, адрес для iPad или остановка — снова откройте «Web Pilot Sidebar.command».${NL}${NL}Что проверять дальше — в docs/planning/stage-0-feasibility.md." "Готово" >/dev/null
}

main_menu() {
  local choice
  while :; do
    if host_alive; then printf '\n%sТестовый хост: работает, %s%s\n' "$BOLD" "$(host_url)" "$RESET"; else printf '\n%sТестовый хост: остановлен%s\n' "$BOLD" "$RESET"; fi
    choice="$(choose one "Что сделать?" "Установить или обновить расширение" "Показать код подключения" "HTTPS-адрес для iPad и iPhone" "Остановить тестовый хост" "Выход")"
    case "$choice" in
      "Установить или обновить расширение") install_wizard ;;
      "Показать код подключения") ensure_node && start_host && show_code ;;
      "HTTPS-адрес для iPad и iPhone") ensure_node && start_host && start_tunnel && show_tunnel ;;
      "Остановить тестовый хост") stop_all ;;
      *) break ;;
    esac
  done
}

if [ "$(uname -s)" != "Darwin" ] && [ -z "${WPS_INSTALLER_TEST:-}" ]; then
  echo "Этот помощник работает только на macOS."; exit 1
fi
printf '%sWeb Pilot Sidebar — помощник установки (этап 0)%s\nПапка: %s\n' "$BOLD" "$RESET" "$ROOT"
main_menu
if host_alive; then printf '\nТестовый хост продолжает работать в фоне. Окно можно закрыть.\n'; fi
