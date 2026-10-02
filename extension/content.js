// Web Pilot Sidebar — content script on the provider page.
// Page operations come from Project Web Pilot (webpilot-adapter.js, D11).
// No network requests here and no commands via window.postMessage (D5).
(() => {
  if (globalThis.__wpsContentLoaded) return;
  globalThis.__wpsContentLoaded = true;

  const api = globalThis.browser ?? globalThis.chrome;
  const BUILD = globalThis.WPS_BUILD ?? { testMode: false };
  const A = globalThis.WebPilotAdapter;
  const testPage = BUILD.testMode && location.protocol === 'http:' && location.hostname === '127.0.0.1';
  const dom = A.createChatGPTDOM(A.CHATGPT_SELECTORS);
  const GRACE_MS = 5000; // the same idle grace as Web Pilot's AgentTimer
  const CONVERSATION = /^(\/work)?(\/g\/[A-Za-z0-9_-]+)?\/c\/[A-Za-z0-9_-]{8,}\/?$/;
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const codeError = (code, message) => Object.assign(new Error(message), { code });

  const page = args => A.pageOperation(args, dom);

  // Web Pilot's ChatGPTComposer is used unchanged. In Electron it runs the
  // page operation through webContents.executeJavaScript(pageScript(args));
  // here the same call is answered in place: the arguments are recovered from
  // the exact pageScript format, so no code is evaluated.
  const SCRIPT_PREFIX = '(' + A.pageOperation.toString() + ')(';
  const SCRIPT_SUFFIX = ', ' + A.chatGPTDOMScript() + ')';
  function legacyInsert(text) {
    // Fallback when the editor ignores a synthetic paste (possible in Safari):
    // nothing was inserted, so the previous Web Pilot method is safe to use.
    const editor = dom.editor();
    if (!editor) return { ...page({ action: 'inspect', text }), action: 'deferred', reason: 'INSERT_FAILED' };
    editor.focus();
    const selection = getSelection(); const range = document.createRange();
    range.selectNodeContents(editor); range.collapse(false); selection.removeAllRanges(); selection.addRange(range);
    const inserted = document.execCommand('insertText', false, text);
    return { ...page({ action: 'inspect', text }), action: inserted ? 'filled' : 'deferred', reason: inserted ? null : 'INSERT_FAILED', insertionMethod: 'execCommand.insertText' };
  }
  const contents = {
    // The composer accepts only chatgpt.com; the local test fixture is presented as such in test builds.
    getURL: () => testPage ? 'https://chatgpt.com' + location.pathname + location.search : location.href,
    async executeJavaScript(code) {
      if (typeof code !== 'string' || !code.startsWith(SCRIPT_PREFIX) || !code.endsWith(SCRIPT_SUFFIX)) {
        throw codeError('ADAPTER_INCOMPATIBLE', 'Формат команды адаптера Web Pilot изменился — нужна доработка расширения.');
      }
      const args = JSON.parse(code.slice(SCRIPT_PREFIX.length, code.length - SCRIPT_SUFFIX.length));
      const result = page(args);
      if (args.action === 'paste' && result.reason === 'PASTE_UNHANDLED') return legacyInsert(args.text);
      return result;
    },
  };
  const composer = () => new A.ChatGPTComposer(contents, { timeoutMs: 20_000 });

  const isConversation = href => {
    if (A.isPendingChatGPTConversation(href)) return false;
    try { return CONVERSATION.test(new URL(href).pathname); } catch { return false; }
  };

  function status() {
    const observed = page({ action: 'inspect' });
    return {
      url: location.href, conversation: isConversation(location.href),
      editorAvailable: observed.editorAvailable, writable: observed.writable, login: observed.login,
      busy: observed.busy, experience: observed.experience, userMessageCount: observed.userMessageCount,
      connectionError: observed.connectionError ?? null,
    };
  }

  const emit = (type, data) => {
    try { api.runtime.sendMessage({ channel: 'wps-cs-event', type, ...data })?.catch?.(() => {}); } catch { /* extension reloaded */ }
  };

  async function waitForComposer(timeoutMs = 20_000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const observed = page({ action: 'inspect' });
      if (observed.editorAvailable && observed.writable && !observed.login) return observed;
      if (observed.login && !observed.editorAvailable) throw codeError('LOGIN_REQUIRED', 'Нужен вход в ChatGPT.');
      if (Date.now() > deadline) throw codeError('EDITOR_NOT_FOUND', 'Поле ввода ChatGPT не найдено.');
      await pause(300);
    }
  }

  // Accounts without the Chat/Work switch have no mode buttons: nothing to select.
  async function ensureExperience(expected) {
    if (!expected || !dom.modeButtons().length) return null;
    for (let attempt = 0; attempt < 25; attempt++) {
      const result = page({ action: 'select-experience', expectedExperience: expected });
      if (result.action === 'experience-confirmed') return expected;
      if (result.action === 'deferred' && result.reason !== 'EXPERIENCE_UNCONFIRMED') throw codeError(result.reason, 'Режим не выбран: ' + result.reason);
      await pause(300);
    }
    throw codeError('EXPERIENCE_UNCONFIRMED', 'Не удалось выбрать режим ' + expected + '.');
  }

  async function deliver({ text, requestId, experience }) {
    await waitForComposer();
    const expectedExperience = await ensureExperience(experience);
    const result = await composer().deliver({ text, requestId, expectedExperience });
    await pause(300);
    return { state: result.state, reason: result.reason ?? null, url: location.href, conversation: isConversation(location.href) };
  }

  function largeText(bytes = 180_000) {
    const lines = []; let size = 0; let n = 0;
    while (size < bytes) {
      const line = `Строка ${++n} — проверка вставки большого пакета восстановления Web Pilot Sidebar (R4).`;
      lines.push(line); size += new TextEncoder().encode(line + '\n').length;
    }
    return lines.join('\n');
  }

  function selectorReport() {
    return {
      editor: !!dom.editor(), send: !!dom.sendButton(), stop: !!dom.first(A.CHATGPT_SELECTORS.stop),
      modeButtons: dom.modeButtons().length, userMessages: dom.messages('user').length,
      viewport: `${innerWidth}×${innerHeight}`, userAgent: navigator.userAgent,
    };
  }

  function navigateTo(url) {
    const target = new URL(url, location.href);
    const allowed = testPage ? target.origin === location.origin : target.origin === 'https://chatgpt.com';
    if (!allowed) throw codeError('URL_FORBIDDEN', 'Переход разрешён только на chatgpt.com.');
    setTimeout(() => location.assign(target.href), 50);
    return { url: target.href };
  }

  const operations = {
    inspect: () => ({ ...status(), selectors: selectorReport() }),
    'new-chat': ({ experience }) => navigateTo(testPage ? (experience === 'work' ? '/work/' : '/') : A.chatGPTEntrypoint(experience)),
    navigate: ({ url }) => navigateTo(url),
    deliver,
    'fill-test': async () => {
      const result = await composer().inspect({ action: 'fill', text: 'Web Pilot Sidebar: проверка вставки (без отправки).' });
      return { action: result.action, reason: result.reason ?? null, insertionMethod: result.insertionMethod ?? null };
    },
    'fill-large': async () => {
      const text = largeText();
      const started = performance.now();
      const result = await composer().inspect({ action: 'fill', text });
      return { action: result.action, reason: result.reason ?? null, insertionMethod: result.insertionMethod ?? null,
        ms: Math.round(performance.now() - started), bytes: new TextEncoder().encode(text).length };
    },
    'send-test': () => {
      const requestId = 'wps-test-' + Math.random().toString(16).slice(2, 10);
      return deliver({ text: `[Web Pilot Sidebar · проверка R1] requestId: ${requestId}. Ответь одним словом: «ок».`, requestId, experience: null })
        .then(result => ({ ...result, requestId }));
    },
    'toggle-panel': () => inline.toggle(),
    'panel-ready': () => inline.frameReady(),
  };

  api.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== api.runtime.id || message?.channel !== 'wps-cs' || !Object.hasOwn(operations, message.op)) return false;
    Promise.resolve().then(() => operations[message.op](message)).then(
      result => sendResponse({ ok: true, result }),
      error => sendResponse({ ok: false, error: { code: error.code ?? 'ERROR', message: error.message ?? String(error) } }),
    );
    return true;
  });

  // Status and agent observation, once per second.
  let lastStatus = '';
  let run = null;
  setInterval(() => {
    let current;
    try { current = status(); } catch { return; }
    const serialized = JSON.stringify(current);
    if (serialized !== lastStatus) { lastStatus = serialized; emit('status', { status: current }); }
    const at = Date.now();
    if (current.busy) {
      if (!run) { run = { startedAt: at, lastBusyAt: at }; emit('agent', { agent: { running: true, startedAt: at } }); }
      else run.lastBusyAt = at;
    } else if (run && at - run.lastBusyAt >= GRACE_MS) {
      emit('agent', { agent: { running: false, startedAt: run.startedAt, durationMs: run.lastBusyAt - run.startedAt } });
      run = null;
    }
  }, 1000);

  // ---------- Panel on the page (Safari, Firefox Android, or forced in Chrome) ----------
  const DEFAULT_PREFS = { inline: 'auto', layout: 'push', render: 'auto', width: 340 };
  const MIN_WIDTH = 260;
  const NARROW = 700;
  const inline = (() => {
    let container = null; let shadow = null; let frame = null; let readyTimer = null;
    let prefs = { ...DEFAULT_PREFS }; let config = null; let hidden = false; let renderMode = null;

    const pageStyle = document.createElement('style');
    pageStyle.textContent = 'html.wps-push{margin-left:var(--wps-width)!important;width:calc(100% - var(--wps-width))!important;overflow-x:hidden!important}html.wps-push body{transform:translateZ(0)}';

    const width = () => Math.max(MIN_WIDTH, Math.min(prefs.width, Math.round(innerWidth * 0.6)));
    const narrow = () => innerWidth < NARROW;

    function applyLayout() {
      if (!container) return;
      const push = prefs.layout === 'push' && !narrow() && !hidden;
      document.documentElement.style.setProperty('--wps-width', width() + 'px');
      document.documentElement.classList.toggle('wps-push', push);
      container.style.width = (narrow() ? Math.min(innerWidth - 40, 380) : width()) + 'px';
      container.dataset.hidden = String(hidden);
      container.dataset.mode = push ? 'push' : 'overlay';
    }

    function shadowStyles() {
      return `
        :host{all:initial}
        .wrap{position:fixed;top:0;left:0;bottom:0;width:inherit;display:flex;z-index:2147483646;box-shadow:0 0 0 1px rgba(36,51,70,.12),4px 0 18px rgba(36,51,70,.08);background:#f4f6f8;transition:transform .18s ease}
        :host([data-hidden=true]) .wrap{transform:translateX(-100%);box-shadow:none}
        iframe,.panel-root{flex:1;border:0;width:100%;height:100%;background:transparent;overflow:auto}
        .grip{position:absolute;top:0;right:-4px;width:8px;height:100%;cursor:ew-resize;touch-action:none}
        .grip:hover,.grip:focus-visible{background:rgba(8,126,128,.25);outline:none}
        .toggle{position:absolute;top:50%;right:-30px;width:30px;height:56px;margin-top:-28px;border:0;border-radius:0 10px 10px 0;background:#087e80;color:#fff;font:600 12px -apple-system,system-ui,sans-serif;cursor:pointer;box-shadow:2px 0 8px rgba(0,0,0,.15)}
        .toggle:focus-visible{outline:2px solid #fff;outline-offset:-4px}
        @media (prefers-color-scheme:dark){.wrap{background:#1b1d22;box-shadow:0 0 0 1px #343b45}}
        @media (prefers-reduced-motion:reduce){.wrap{transition:none}}`;
    }

    function mountShadowPanel(holder) {
      renderMode = 'shadow';
      holder.textContent = '';
      const root = document.createElement('div');
      root.className = 'panel-root';
      holder.appendChild(root);
      globalThis.WPSPanel.mount(root, { host: 'inline-shadow', styleTarget: shadow });
    }

    function mount() {
      if (container) return;
      container = document.createElement('wps-sidebar');
      container.style.cssText = 'position:fixed;top:0;left:0;bottom:0;z-index:2147483646;display:block';
      shadow = container.attachShadow({ mode: 'open' });
      const style = document.createElement('style'); style.textContent = shadowStyles();
      const wrap = document.createElement('div'); wrap.className = 'wrap';
      const holder = document.createElement('div'); holder.style.cssText = 'flex:1;display:flex;min-width:0';
      const grip = document.createElement('div'); grip.className = 'grip'; grip.tabIndex = 0; grip.setAttribute('role', 'separator'); grip.setAttribute('aria-label', 'Ширина панели');
      const toggle = document.createElement('button'); toggle.className = 'toggle'; toggle.type = 'button'; toggle.textContent = 'WP';
      toggle.setAttribute('aria-label', 'Показать или скрыть Web Pilot Sidebar');
      toggle.addEventListener('click', () => api_toggle());
      wrap.append(holder, grip, toggle);
      shadow.append(style, wrap);
      (document.head ?? document.documentElement).appendChild(pageStyle);
      document.documentElement.appendChild(container);

      if (prefs.render === 'shadow') mountShadowPanel(holder);
      else {
        renderMode = 'iframe-pending';
        frame = document.createElement('iframe');
        frame.title = 'Web Pilot Sidebar';
        frame.src = api.runtime.getURL('panel.html');
        frame.setAttribute('allow', 'clipboard-write');
        holder.appendChild(frame);
        // If the page's security policy blocks the extension frame, fall back to rendering in place.
        readyTimer = setTimeout(() => { if (renderMode === 'iframe-pending' && prefs.render === 'auto') { frame = null; mountShadowPanel(holder); } }, 5000);
      }

      let startX = 0; let startWidth = 0;
      grip.addEventListener('pointerdown', event => { startX = event.clientX; startWidth = width(); grip.setPointerCapture(event.pointerId); });
      grip.addEventListener('pointermove', event => {
        if (!grip.hasPointerCapture(event.pointerId)) return;
        prefs.width = Math.max(MIN_WIDTH, startWidth + event.clientX - startX); applyLayout();
      });
      grip.addEventListener('pointerup', event => { grip.releasePointerCapture(event.pointerId); savePrefs({ width: prefs.width }); });
      grip.addEventListener('keydown', event => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        prefs.width = Math.max(MIN_WIDTH, width() + (event.key === 'ArrowRight' ? 20 : -20)); applyLayout(); savePrefs({ width: prefs.width });
      });
      hidden = narrow(); // iPhone: start collapsed, the WP tab opens the panel
      applyLayout();
    }

    function unmount() {
      clearTimeout(readyTimer);
      container?.remove(); pageStyle.remove();
      document.documentElement.classList.remove('wps-push');
      container = null; shadow = null; frame = null; renderMode = null;
    }

    function api_toggle() { if (!container) { mount(); hidden = false; } else hidden = !hidden; applyLayout(); return { hidden, renderMode }; }

    async function savePrefs(patch) {
      const { prefs: stored } = await api.storage.local.get('prefs');
      await api.storage.local.set({ prefs: { ...DEFAULT_PREFS, ...(stored ?? {}), ...patch } });
    }

    async function refresh() {
      const { prefs: stored } = await api.storage.local.get('prefs');
      const next = { ...DEFAULT_PREFS, ...(stored ?? {}) };
      const renderChanged = next.render !== prefs.render;
      prefs = next;
      if (!config) {
        try { config = (await api.runtime.sendMessage({ channel: 'wps', op: 'config' }))?.result ?? {}; } catch { config = {}; }
      }
      const show = prefs.inline === 'on' || (prefs.inline === 'auto' && !config.sidePanel);
      if (!show) return unmount();
      if (container && renderChanged) unmount();
      mount();
      applyLayout();
    }

    api.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.prefs) refresh(); });
    addEventListener('resize', () => applyLayout());
    return {
      start: refresh,
      toggle: api_toggle,
      frameReady() { if (renderMode === 'iframe-pending') { renderMode = 'iframe'; clearTimeout(readyTimer); } return { renderMode }; },
      mode: () => renderMode,
    };
  })();

  inline.start();
  emit('ready', { status: status() });
})();
