// Test data for stage 0. Shapes follow the Project Web Pilot projections
// (src/workspace-session.mjs): sessions and planView are the same fields the
// Electron sidebar already renders.

export const TASK_STEP_MS = 20_000;

const STAGE0_TASKS = [
  ['T001', 'Тестовый хост'],
  ['T002', 'Сборка и адаптеры Web Pilot'],
  ['T003', 'Панель и контент-скрипт'],
  ['T004', 'Новая сессия и привязка chatUrl'],
  ['T005', 'Проверка на iPad'],
  ['DOCS', 'Актуализация всех документов проекта'],
];

export function initialProjects(now) {
  return [
    {
      projectId: 'demo-web-pilot', name: 'Project Web Pilot',
      sessions: [
        { sessionId: 'demo-s1', title: 'Синхронизация названий сессий', experience: 'chat', provider: 'chatgpt', chatUrl: null, createdAt: now - 3 * 86400_000, fixture: true },
        { sessionId: 'demo-s2', title: 'Удалённый интерфейс — исследование', experience: 'work', provider: 'chatgpt', chatUrl: null, createdAt: now - 4 * 86400_000, fixture: true },
      ],
    },
    {
      projectId: 'demo-workflow-kit', name: 'WorkflowKit',
      sessions: [
        { sessionId: 'demo-s3', title: 'Single active plan', experience: 'chat', provider: 'chatgpt', chatUrl: null, createdAt: now - 6 * 86400_000, fixture: true },
      ],
    },
    { projectId: 'demo-sidebar', name: 'Web Pilot Sidebar', sessions: [] },
  ];
}

function projection(project, plan, observedAt) {
  const tasks = plan.tasks;
  const completed = tasks.filter(t => t.status === 'done').length;
  const current = tasks.find(t => t.status === 'current') ?? tasks.find(t => t.status !== 'done');
  return {
    projectId: project.projectId, name: project.name,
    planRevision: plan.revision, scopeId: plan.scopeId, scopeTitle: plan.scopeTitle, objective: plan.objective,
    scopeStatus: plan.scopeStatus, deliveryStatus: plan.deliveryStatus,
    nextTaskId: current?.id ?? null, nextTaskTitle: current?.title ?? null,
    planView: { state: plan.state, completed, total: tasks.length, tasks, blockedReason: null },
    observedAt,
  };
}

// Project Web Pilot gets a plan that moves forward on its own, so the panel
// shows live progress without a real agent: one task per TASK_STEP_MS, then
// "awaiting acceptance" for one step, then the cycle restarts.
export function planFor(project, { startedAt, now }) {
  if (project.projectId === 'demo-web-pilot') {
    const cycle = STAGE0_TASKS.length + 1;
    const step = Math.floor(Math.max(0, now - startedAt) / TASK_STEP_MS);
    const position = step % cycle;
    const tasks = STAGE0_TASKS.map(([id, title], index) => ({
      id, title, status: index < position ? 'done' : index === position ? 'current' : 'pending',
    }));
    const finished = position === STAGE0_TASKS.length;
    return projection(project, {
      revision: 700 + step, scopeId: 'remote-sidebar-stage0', scopeTitle: 'Этап 0 · проверка расширения',
      objective: 'Проверить сайдбар Web Pilot внутри страницы ChatGPT в Chrome и Safari.',
      scopeStatus: 'ACTIVE', deliveryStatus: finished ? 'READY_FOR_ACCEPTANCE' : 'IN_PROGRESS',
      state: finished ? 'awaiting-acceptance' : 'working', tasks,
    }, now);
  }
  if (project.projectId === 'demo-sidebar') {
    return projection(project, {
      revision: 12, scopeId: 'design-001', scopeTitle: 'Проектные документы',
      objective: 'Спроектировать расширение.', scopeStatus: 'ACTIVE', deliveryStatus: 'READY_FOR_ACCEPTANCE',
      state: 'awaiting-acceptance',
      tasks: [{ id: 'T001', title: 'Проектные документы', status: 'done' }, { id: 'DOCS', title: 'Актуализация всех документов проекта', status: 'done' }],
    }, now);
  }
  return projection(project, {
    revision: 3, scopeId: null, scopeTitle: null,
    objective: 'Если поручение уже ясно, создайте короткий план и приступайте; иначе обсудите следующий этап проекта.',
    scopeStatus: 'NONE', deliveryStatus: 'IN_PROGRESS', state: 'not-created', tasks: [],
  }, now);
}

export function packetText({ project, sessionId, requestId }) {
  return [
    '[Web Pilot Sidebar · этап 0 · тестовый пакет]',
    `requestId: ${requestId}`,
    `Проект: ${project.name}`,
    `Сессия: ${sessionId}`,
    '',
    'Это проверочное сообщение расширения Web Pilot Sidebar. Настоящий пакет восстановления здесь сформирует Project Web Pilot.',
    `Ответь одной короткой строкой: «Пакет ${requestId} получен».`,
  ].join('\n');
}
