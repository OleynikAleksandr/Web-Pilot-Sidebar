// Web Pilot Sidebar — panel UI. One classic script for every host:
// browser side panel, extension iframe on the page, or in-place rendering
// inside the content script (fallback). Data is rendered with DOM APIs only.
(() => {
  if (globalThis.WPSPanel) return;
  const api = globalThis.browser ?? globalThis.chrome;
  const BUILD = globalThis.WPS_BUILD ?? {};
  const RELEASE = BUILD.channel === 'release'; // signed apps and stores: no stage 0 test actions
  const STATE_POLL_MS = 15_000;
  const PLAN_POLL_MS = 5_000;
  const STALE_MS = 15_000;

  const HOST_LABELS = { sidepanel: 'боковая панель браузера', 'inline-iframe': 'на странице · iframe', 'inline-shadow': 'на странице · встроенная отрисовка', tab: 'отдельная вкладка' };
  const PLAN_STATES = { working: 'Работает', 'awaiting-acceptance': 'Ждёт приёмки', blocked: 'Заблокирован', closed: 'Закрыт', 'not-created': 'Плана нет' };
  const FLOW = {
    creating: ['Создаю сессию на Mac…', true], navigating: ['Открываю новый чат…', true], delivering: ['Вставляю и отправляю пакет…', true],
    binding: ['Жду адрес чата…', true], saving: ['Сохраняю привязку…', true], bound: ['Сессия привязана', false], failed: ['Не получилось', false],
  };

  const CSS = `
.wps{--teal:#087e80;--teal-soft:#e3f1f0;--text:#243346;--muted:#708092;--line:#e1e7ed;--bg:#f4f6f8;--card:#fff;--warn:#a5642a;--warn-soft:#fbf1e6;--err:#ac594b;--err-soft:#f9ece9;
  box-sizing:border-box;font:13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;color:var(--text);background:var(--bg);min-height:100%;padding:12px 12px 20px;-webkit-text-size-adjust:100%}
@media (prefers-color-scheme:dark){.wps{--teal:#53bbb7;--teal-soft:#203536;--text:#e7edf4;--muted:#9aa8b6;--line:#343b45;--bg:#1b1d22;--card:#22272d;--warn:#d3a06f;--warn-soft:#2e261d;--err:#e2a093;--err-soft:#2b2221}}
.wps *,.wps *::before,.wps *::after{box-sizing:border-box}
.wps button,.wps input,.wps select{font:inherit;color:inherit}
.wps .top{display:flex;align-items:center;gap:10px;margin-bottom:12px}
.wps .logo{width:32px;height:32px;border-radius:9px;background:var(--teal);color:#fff;display:grid;place-items:center;font-weight:700;font-size:12px;flex:none}
.wps .brand{flex:1;min-width:0}.wps .brand strong{display:block;font-size:14px}.wps .brand small{color:var(--muted);font-size:11px}
.wps .dot{width:9px;height:9px;border-radius:50%;background:var(--muted);flex:none}.wps .dot[data-ok=true]{background:#2fa36b}.wps .dot[data-ok=false]{background:var(--err)}
.wps .card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px;margin-bottom:10px}
.wps h2{font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);margin:0 0 8px;font-weight:600}
.wps .banner{border-radius:10px;padding:9px 11px;margin-bottom:10px;font-size:12px}.wps .banner.warn{background:var(--warn-soft);color:var(--warn)}.wps .banner.err{background:var(--err-soft);color:var(--err)}
.wps label{display:block;font-size:11px;font-weight:600;margin:8px 0 4px}
.wps input,.wps select{width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--bg)}
.wps input:focus-visible,.wps select:focus-visible,.wps button:focus-visible,.wps summary:focus-visible{outline:2px solid var(--teal);outline-offset:1px}
.wps .btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:8px 11px;border-radius:8px;border:1px solid var(--line);background:var(--card);cursor:pointer;min-height:34px}
.wps .btn:hover{border-color:var(--teal)}.wps .btn.primary{background:var(--teal);border-color:var(--teal);color:#fff}.wps .btn[disabled]{opacity:.5;cursor:default}
.wps .row{display:flex;gap:8px;flex-wrap:wrap}.wps .row .btn{flex:1 1 120px}
.wps .projects{list-style:none;margin:0;padding:0}
.wps .project{width:100%;display:flex;align-items:center;gap:8px;text-align:left;padding:8px 9px;border:1px solid transparent;border-radius:9px;background:none;cursor:pointer}
.wps .project:hover{background:var(--teal-soft)}.wps .project[aria-current=true]{background:var(--teal-soft);border-color:color-mix(in srgb,var(--teal) 35%,transparent)}
.wps .project strong{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.wps .count{color:var(--muted);font-size:11px}
.wps .sessions{list-style:none;margin:2px 0 6px 12px;padding:0 0 0 10px;border-left:2px solid var(--line)}
.wps .session{display:flex;align-items:center;gap:8px;padding:6px 4px;border-radius:7px}
.wps .session[data-active=true]{background:var(--teal-soft)}
.wps .session-copy{flex:1;min-width:0}.wps .session-copy span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.wps .session-copy small{color:var(--muted);font-size:11px}
.wps .badge{font-size:10px;padding:1px 6px;border-radius:99px;border:1px solid var(--line);color:var(--muted);flex:none}.wps .badge[data-exp=work]{border-color:var(--teal);color:var(--teal)}
.wps .link{background:none;border:0;color:var(--teal);cursor:pointer;padding:2px 4px;font-size:12px}
.wps .plan-head{display:flex;justify-content:space-between;align-items:baseline;gap:8px}.wps .plan-head strong{font-size:13px}
.wps .state{font-size:11px;font-weight:600;color:var(--teal)}.wps .state[data-state=blocked]{color:var(--warn)}.wps .state[data-state=not-created],.wps .state[data-state=closed]{color:var(--muted)}
.wps .bar{height:6px;border-radius:99px;background:var(--line);overflow:hidden;margin:9px 0 4px}.wps .bar i{display:block;height:100%;background:var(--teal);transition:width .4s ease}
.wps .meta{color:var(--muted);font-size:11px}.wps .meta[data-stale=true]{color:var(--warn)}
.wps .tasks{list-style:none;margin:8px 0 0;padding:0}.wps .task{display:flex;gap:8px;padding:4px 0;font-size:12px}
.wps .task b{width:16px;text-align:center;flex:none;color:var(--muted)}.wps .task[data-status=done] b{color:var(--teal)}.wps .task[data-status=current]{font-weight:600}.wps .task[data-status=current] b{color:var(--teal)}
.wps .task[data-status=done] span{color:var(--muted)}
.wps .flow{display:flex;align-items:center;gap:8px;font-size:12px;margin-top:8px}.wps .flow[data-stage=failed]{color:var(--err)}.wps .flow[data-stage=bound]{color:var(--teal)}
.wps .spin{width:13px;height:13px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:wps-spin .8s linear infinite;flex:none}
@keyframes wps-spin{to{transform:rotate(360deg)}}
.wps .kv{display:grid;grid-template-columns:auto 1fr;gap:3px 10px;font-size:12px}.wps .kv dt{color:var(--muted)}.wps .kv dd{margin:0;overflow-wrap:anywhere}
.wps details summary{cursor:pointer;color:var(--muted);font-size:12px;font-weight:600}
.wps .log{list-style:none;margin:8px 0 0;padding:0;font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace}.wps .log li{padding:3px 0;border-top:1px dashed var(--line);overflow-wrap:anywhere}
.wps .foot{display:flex;justify-content:space-between;gap:8px;align-items:center;color:var(--muted);font-size:11px;margin-top:6px}
.wps .agent[data-running=true]{color:var(--teal);font-weight:600}
@media (prefers-reduced-motion:reduce){.wps .spin{animation:none}.wps .bar i{transition:none}}`;

  function h(tag, props = {}, ...children) {
    const element = document.createElement(tag);
    for (const [key, value] of Object.entries(props ?? {})) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'class') element.className = value;
      else if (key === 'dataset') Object.assign(element.dataset, value);
      else if (key.startsWith('on')) element.addEventListener(key.slice(2), value);
      else if (key === 'text') element.textContent = value;
      else element.setAttribute(key, value === true ? '' : String(value));
    }
    for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) element.append(child instanceof Node ? child : String(child));
    return element;
  }

  const clock = at => new Date(at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const day = at => new Date(at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const duration = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const shortUrl = href => { try { const u = new URL(href); return u.host + (u.pathname.length > 28 ? u.pathname.slice(0, 27) + '…' : u.pathname); } catch { return href ?? '—'; } };

  function mount(root, { host = 'tab', styleTarget = null } = {}) {
    const style = document.createElement('style');
    style.textContent = CSS;
    (styleTarget ?? document.head ?? document.documentElement).appendChild(style);

    const s = {
      config: null, projects: [], selected: null, plan: null, planOkAt: 0, stateOkAt: 0, hostError: null,
      flow: null, agent: null, page: null, tabId: null, log: [], prefs: { inline: 'auto', layout: 'push', render: 'auto' },
      form: { hostUrl: 'http://127.0.0.1:8787', code: '', deviceName: navigator.platform || 'Устройство' }, pairing: false, pairError: null, working: false,
    };
    const ticking = [];

    const bg = async (op, payload = {}) => {
      const response = await api.runtime.sendMessage({ channel: 'wps', op, ...payload });
      if (!response) throw Object.assign(new Error('Фоновый скрипт расширения не ответил.'), { code: 'NO_BACKGROUND' });
      if (!response.ok) throw Object.assign(new Error(response.error?.message ?? 'Ошибка'), { code: response.error?.code });
      return response.result;
    };

    const addLog = line => { s.log.unshift(clock(Date.now()) + '  ' + line); s.log = s.log.slice(0, 10); render(); };

    async function onHostError(error) {
      s.hostError = error;
      if (error.code === 'AUTH_REQUIRED' || error.code === 'NOT_PAIRED') s.config = await bg('config').catch(() => s.config);
      render();
    }

    async function loadState() {
      if (!s.config?.paired) return;
      try {
        const data = await bg('host', { query: 'state' });
        s.projects = data.projects; s.stateOkAt = Date.now(); s.hostError = null;
        if (!s.projects.some(p => p.projectId === s.selected)) s.selected = s.projects[0]?.projectId ?? null;
        render();
      } catch (error) { await onHostError(error); }
    }

    async function loadPlan() {
      if (!s.config?.paired || !s.selected) return;
      const projectId = s.selected;
      try {
        const plan = await bg('host', { query: 'plan', projectId });
        if (projectId !== s.selected) return;
        s.plan = plan; s.planOkAt = Date.now(); s.hostError = null; render();
      } catch (error) { await onHostError(error); }
    }

    async function loadPage() {
      if (host === 'tab') return;
      try { s.page = await bg('page', { action: 'inspect', tabId: s.tabId ?? undefined }); }
      catch (error) { s.page = { unavailable: error.message }; }
      render();
    }

    async function pair(event) {
      event.preventDefault();
      s.pairing = true; s.pairError = null; render();
      try {
        await bg('pair', { hostUrl: s.form.hostUrl, code: s.form.code, deviceName: s.form.deviceName });
        s.form.code = ''; s.config = await bg('config'); await loadState(); await loadPlan();
      } catch (error) { s.pairError = error.message; }
      finally { s.pairing = false; render(); }
    }

    async function newSession(experience) {
      if (!s.selected) return;
      s.flow = { stage: 'creating' }; render();
      try { await bg('new-session', { projectId: s.selected, experience, tabId: s.tabId ?? undefined }); }
      catch (error) { s.flow = { stage: 'failed', message: error.message }; render(); }
    }

    async function openSession(session) {
      try { await bg('open-session', { sessionId: session.sessionId, chatUrl: session.chatUrl, tabId: s.tabId ?? undefined }); addLog('Открываю чат: ' + session.title); }
      catch (error) { addLog('Ошибка: ' + error.message); }
    }

    async function check(action, label) {
      s.working = true; render();
      try {
        const result = await bg('page', { action, tabId: s.tabId ?? undefined });
        if (action === 'inspect') { s.page = result; addLog(`${label}: поле ${result.selectors.editor ? '✓' : '✗'}, Send ${result.selectors.send ? '✓' : '✗'}, Stop ${result.selectors.stop ? 'виден' : 'нет'}, режимы ${result.selectors.modeButtons}, ${result.selectors.viewport}`); }
        else if (action === 'fill-large') addLog(`${label}: ${result.action}${result.reason ? ' (' + result.reason + ')' : ''}, ${Math.round(result.bytes / 1024)} КБ за ${result.ms} мс${result.insertionMethod ? ', ' + result.insertionMethod : ''}`);
        else addLog(`${label}: ${result.action ?? result.state ?? 'ок'}${result.reason ? ' (' + result.reason + ')' : ''}${result.insertionMethod ? ', ' + result.insertionMethod : ''}`);
      } catch (error) { addLog(`${label}: ошибка — ${error.message}`); }
      finally { s.working = false; render(); }
    }

    function selectProject(projectId) {
      if (!projectId || s.selected === projectId) return;
      s.selected = projectId; s.plan = null;
      try { api.storage.local.set({ ui: { selectedProjectId: projectId } })?.catch?.(() => {}); } catch { /* storage unavailable */ }
      render(); loadPlan();
    }

    async function setPref(key, value) {
      s.prefs = { ...s.prefs, [key]: value };
      const { prefs } = await api.storage.local.get('prefs');
      await api.storage.local.set({ prefs: { ...(prefs ?? {}), [key]: value } });
      render();
    }

    async function unpair() {
      await bg('unpair'); s.config = await bg('config'); s.projects = []; s.plan = null; render();
    }

    function onEvent(message) {
      if (message?.channel !== 'wps-event') return;
      if (s.tabId !== null && Number.isInteger(message.tabId) && message.tabId !== s.tabId) return;
      if (!s.config?.paired) return; // keep the pairing form stable while the user types
      if (message.kind === 'page') s.page = { ...(s.page?.unavailable ? {} : s.page), ...message.status };
      else if (message.kind === 'agent') s.agent = message.agent;
      else if (message.kind === 'flow') {
        s.flow = { stage: message.stage, message: message.message, title: message.title };
        if (message.projectId) selectProject(message.projectId);
        if (message.stage === 'navigating' || message.stage === 'bound') loadState();
      }
      render();
    }

    // ---------- rendering ----------
    function header() {
      const ok = !s.config?.paired ? null : s.hostError ? false : s.stateOkAt ? true : null;
      return h('header', { class: 'top' },
        h('div', { class: 'logo', 'aria-hidden': 'true', text: 'WP' }),
        h('div', { class: 'brand' }, h('strong', { text: 'Web Pilot Sidebar' }), h('small', { text: (RELEASE ? '' : 'этап 0 · ') + (HOST_LABELS[host] ?? host) })),
        h('span', { class: 'dot', dataset: { ok: String(ok) }, title: ok === false ? 'Mac недоступен' : ok ? 'Связь с Mac есть' : 'Нет данных', role: 'img', 'aria-label': ok === false ? 'Mac недоступен' : ok ? 'Связь с Mac есть' : 'Связь не проверена' }));
    }

    function pairingForm() {
      const field = (key, label, attrs = {}) => [h('label', { for: 'wps-' + key, text: label }),
        h('input', { id: 'wps-' + key, value: s.form[key], autocomplete: 'off', spellcheck: 'false', ...attrs, oninput: e => { s.form[key] = e.target.value; } })];
      return h('form', { class: 'card', onsubmit: pair },
        h('h2', { text: 'Подключить к Mac' }),
        h('p', { class: 'meta', text: RELEASE ? 'Адрес хоста и одноразовый код покажет помощник Web Pilot на Mac.' : 'Адрес хоста и одноразовый код из окна тестового хоста (npm run host).' }),
        field('hostUrl', 'Адрес хоста', { inputmode: 'url', placeholder: 'https://…' }),
        field('code', 'Код подключения', { placeholder: 'ABCD-EFGH', autocapitalize: 'characters', maxlength: '9' }),
        field('deviceName', 'Имя устройства'),
        s.pairError && h('div', { class: 'banner err', role: 'alert', text: s.pairError }),
        h('div', { class: 'row', style: 'margin-top:10px' }, h('button', { class: 'btn primary', type: 'submit', disabled: s.pairing, text: s.pairing ? 'Подключаю…' : 'Подключить' })));
    }

    function projectsCard() {
      const pageUrl = s.page?.url;
      return h('section', { class: 'card', 'aria-label': 'Проекты' },
        h('h2', { text: 'Проекты' }),
        s.projects.length === 0 ? h('p', { class: 'meta', text: 'Нет данных от Mac.' }) :
          h('ul', { class: 'projects' }, s.projects.map(project => h('li', {},
            h('button', { class: 'project', type: 'button', 'aria-current': String(project.projectId === s.selected), 'aria-expanded': String(project.projectId === s.selected),
              onclick: () => selectProject(project.projectId) },
            h('strong', { text: project.name }), h('span', { class: 'count', text: String(project.sessions.length) })),
            project.projectId === s.selected && h('ul', { class: 'sessions' },
              project.sessions.length === 0 && h('li', { class: 'meta', text: 'Сессий пока нет' }),
              project.sessions.map(session => h('li', { class: 'session', dataset: { active: String(!!session.chatUrl && !!pageUrl && pageUrl.startsWith(session.chatUrl)) } },
                h('div', { class: 'session-copy' }, h('span', { text: session.title }), h('small', { text: session.fixture ? 'тестовая, без чата' : session.chatUrl ? day(session.createdAt) : day(session.createdAt) + ' · чат не привязан' })),
                h('span', { class: 'badge', dataset: { exp: session.experience }, text: session.experience === 'work' ? 'Work' : 'Chat' }),
                session.chatUrl && h('button', { class: 'link', type: 'button', onclick: () => openSession(session), 'aria-label': 'Открыть чат ' + session.title, text: 'Открыть' }))))))),
        h('div', { class: 'row', style: 'margin-top:8px' },
          h('button', { class: 'btn primary', type: 'button', disabled: !s.selected || host === 'tab' || isFlowRunning(), onclick: () => newSession('chat'), text: 'Новая сессия · Chat' }),
          h('button', { class: 'btn', type: 'button', disabled: !s.selected || host === 'tab' || isFlowRunning(), onclick: () => newSession('work'), text: 'Work' })),
        flowLine());
    }

    const isFlowRunning = () => !!s.flow && FLOW[s.flow.stage]?.[1];

    function flowLine() {
      if (!s.flow) return null;
      const [label, spinning] = FLOW[s.flow.stage] ?? [s.flow.stage, false];
      return h('div', { class: 'flow', dataset: { stage: s.flow.stage }, role: 'status', 'aria-live': 'polite' },
        spinning ? h('span', { class: 'spin', 'aria-hidden': 'true' }) : h('span', { 'aria-hidden': 'true', text: s.flow.stage === 'bound' ? '✓' : '!' }),
        h('span', { text: label + (s.flow.message ? ': ' + s.flow.message : '') }));
    }

    function planCard() {
      const plan = s.plan;
      if (!plan) return h('section', { class: 'card' }, h('h2', { text: 'План' }), h('p', { class: 'meta', text: s.selected ? 'Загрузка…' : 'Выберите проект.' }));
      const view = plan.planView;
      const percent = view.total ? Math.round(view.completed / view.total * 100) : 0;
      const meta = h('span', { class: 'meta' });
      ticking.push(() => {
        const age = Date.now() - s.planOkAt;
        meta.dataset.stale = String(age > STALE_MS);
        meta.textContent = `ревизия ${plan.planRevision} · ${age > STALE_MS ? 'данные устарели, ' : ''}обновлено ${clock(s.planOkAt)}`;
      });
      return h('section', { class: 'card', 'aria-label': 'План' },
        h('h2', { text: 'Текущий план' }),
        h('div', { class: 'plan-head' }, h('strong', { text: plan.scopeTitle ?? 'Нет согласованного scope' }), h('span', { class: 'state', dataset: { state: view.state }, text: PLAN_STATES[view.state] ?? view.state })),
        view.total > 0 && h('div', { class: 'bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(view.total), 'aria-valuenow': String(view.completed), 'aria-label': `Выполнено ${view.completed} из ${view.total}` }, h('i', { style: `width:${percent}%` })),
        h('div', { class: 'plan-head' }, h('span', { class: 'meta', text: view.total ? `${view.completed} / ${view.total}` : (plan.objective ?? '') }), meta),
        view.total > 0 && h('ul', { class: 'tasks' }, view.tasks.map(task => h('li', { class: 'task', dataset: { status: task.status } },
          h('b', { 'aria-hidden': 'true', text: task.status === 'done' ? '✓' : task.status === 'current' ? '●' : '○' }),
          h('span', { text: `${task.id} · ${task.title}` }),
          h('span', { class: 'sr', style: 'position:absolute;left:-9999px', text: task.status === 'done' ? ' (выполнено)' : task.status === 'current' ? ' (в работе)' : ' (ожидает)' })))));
    }

    function pageCard() {
      if (host === 'tab') return null;
      const page = s.page;
      const agent = h('dd', { class: 'agent' });
      ticking.push(() => {
        const running = !!s.agent?.running;
        agent.dataset.running = String(running);
        agent.textContent = running ? 'работает · ' + duration(Date.now() - s.agent.startedAt) : s.agent ? 'свободен (последнее задание ' + duration(s.agent.durationMs ?? 0) + ')' : '—';
      });
      return h('section', { class: 'card', 'aria-label': 'Страница' },
        h('h2', { text: 'Страница ChatGPT' }),
        page?.unavailable ? h('p', { class: 'meta', text: page.unavailable }) :
          h('dl', { class: 'kv' },
            h('dt', { text: 'Адрес' }), h('dd', { text: shortUrl(page?.url) }),
            h('dt', { text: 'Поле ввода' }), h('dd', { text: page ? (page.editorAvailable ? (page.writable ? 'найдено' : 'только чтение') : 'не найдено') : '—' }),
            h('dt', { text: 'Вход' }), h('dd', { text: page ? (page.login ? 'нужен вход' : 'выполнен') : '—' }),
            page?.connectionError && h('dt', { text: 'Связь' }), page?.connectionError && h('dd', { text: 'прервана — ChatGPT показывает ошибку' }),
            h('dt', { text: 'Режим' }), h('dd', { text: page?.experience === 'work' ? 'Work' : page?.experience === 'chat' ? 'Chat' : '—' }),
            h('dt', { text: 'Агент' }), agent));
    }

    function checksCard() {
      const select = (key, label, options) => [h('label', { for: 'wps-pref-' + key, text: label }),
        h('select', { id: 'wps-pref-' + key, onchange: e => setPref(key, e.target.value) }, options.map(([value, text]) => h('option', { value, selected: s.prefs[key] === value, text })))];
      return h('details', { class: 'card' },
        h('summary', { text: RELEASE ? 'Настройки и проверка страницы' : 'Проверки этапа 0' }),
        host !== 'tab' && h('div', { class: 'row', style: 'margin-top:10px' },
          h('button', { class: 'btn', type: 'button', disabled: s.working, onclick: () => check('inspect', RELEASE ? 'Проверка страницы' : 'R6 селекторы'), text: 'Проверить страницу' }),
          // Stage 0 actions write into the chat; release builds do not offer them.
          !RELEASE && h('button', { class: 'btn', type: 'button', disabled: s.working, onclick: () => check('fill-test', 'R1 вставка'), text: 'Вставить тест' }),
          !RELEASE && h('button', { class: 'btn', type: 'button', disabled: s.working, onclick: () => check('fill-large', 'R4 180 КБ'), text: 'Вставить 180 КБ' }),
          !RELEASE && h('button', { class: 'btn', type: 'button', disabled: s.working, onclick: () => check('send-test', 'R1 отправка'), text: 'Отправить тест' })),
        select('inline', 'Панель на странице', [['auto', 'Авто (где нет боковой панели браузера)'], ['on', 'Показывать'], ['off', 'Не показывать']]),
        select('layout', 'Раскладка на странице', [['push', 'Сдвигать страницу'], ['overlay', 'Поверх страницы']]),
        select('render', 'Отрисовка на странице', [['auto', 'Авто (iframe, при блокировке — встроенная)'], ['iframe', 'Только iframe'], ['shadow', 'Только встроенная']]),
        s.log.length > 0 && h('ul', { class: 'log', 'aria-live': 'polite' }, s.log.map(line => h('li', { text: line }))));
    }

    function footer() {
      return h('footer', { class: 'foot' },
        h('span', { text: `${BUILD.target ?? ''} ${BUILD.version ?? ''} · адаптер ${String(BUILD.adapterCommit ?? '').slice(0, 7)}` }),
        s.config?.paired && h('button', { class: 'link', type: 'button', onclick: unpair, text: 'Отключить устройство' }));
    }

    function render() {
      const active = styleTarget?.activeElement ?? (root.contains(document.activeElement) ? document.activeElement : null);
      const focus = active?.id ? { id: active.id, start: active.selectionStart ?? null, end: active.selectionEnd ?? null } : null;
      ticking.length = 0;
      const body = h('div', { class: 'wps' }, header());
      if (!s.config) body.append(h('p', { class: 'meta', text: 'Загрузка…' }));
      else if (!s.config.paired) body.append(pairingForm(), checksCard());
      else {
        if (s.hostError && s.hostError.code !== 'AUTH_REQUIRED') body.append(h('div', { class: 'banner warn', role: 'status', text: (s.hostError.code === 'HOST_UNREACHABLE' ? 'Mac недоступен. ' : '') + s.hostError.message }));
        body.append(projectsCard(), planCard());
        const pageSection = pageCard(); if (pageSection) body.append(pageSection);
        body.append(checksCard());
      }
      body.append(footer());
      const openDetails = root.querySelector('details')?.open;
      root.replaceChildren(body);
      if (openDetails) root.querySelector('details').open = true;
      ticking.forEach(fn => fn());
      if (focus) {
        const element = styleTarget?.getElementById?.(focus.id) ?? document.getElementById(focus.id);
        element?.focus();
        if (element && focus.start !== null && typeof element.setSelectionRange === 'function') { try { element.setSelectionRange(focus.start, focus.end); } catch { /* not a text field */ } }
      }
    }

    // ---------- start ----------
    async function resolveTab() {
      if (host === 'inline-iframe' || host === 'inline-shadow') s.tabId = (await bg('whoami')).tabId;
      else if (host === 'sidepanel') {
        const [tab] = await api.tabs.query({ active: true, lastFocusedWindow: true });
        s.tabId = tab?.id ?? null;
        api.tabs.onActivated.addListener(info => { s.tabId = info.tabId; s.agent = null; loadPage(); });
        api.tabs.onUpdated.addListener((tabId, change) => { if (tabId === s.tabId && change.status === 'complete') loadPage(); });
      }
    }

    async function start() {
      render();
      api.runtime.onMessage.addListener(onEvent);
      try {
        const [{ prefs }, ui] = await Promise.all([api.storage.local.get('prefs'), api.storage.local.get('ui')]);
        s.prefs = { ...s.prefs, ...(prefs ?? {}) };
        s.selected = ui.ui?.selectedProjectId ?? null;
        s.config = await bg('config');
        await resolveTab();
      } catch (error) { s.hostError = error; }
      render();
      await Promise.all([loadState(), loadPage()]);
      await loadPlan();
      setInterval(() => { if (document.visibilityState === 'visible') loadState(); }, STATE_POLL_MS);
      setInterval(() => { if (document.visibilityState === 'visible') loadPlan(); }, PLAN_POLL_MS);
      setInterval(() => ticking.forEach(fn => fn()), 1000);
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { loadState(); loadPlan(); loadPage(); } });
    }
    start();
  }

  globalThis.WPSPanel = Object.freeze({ mount, CSS });
})();
