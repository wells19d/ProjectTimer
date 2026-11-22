const $ = selector => document.querySelector(selector);
let data = { projects: [] };
let editingId = null;
let busy = false;
let resizeTimeout;
let lastFitHeight = 0;
const sessionView = SessionView.createSessionView();
let sessionEdit = null;
// Keep unchanged cards and their clock bindings across IPC snapshots.
const projectCards = new Map();
const historyPages = new Map();
const historyPageSize = 25;
const sessionClock = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const clockDisplay = ClockDisplay.createClockDisplay({ formatTime });
const displayScheduler = DisplayScheduler.createDisplayScheduler({
  update: updateClocks,
  isRunning: clockDisplay.isRunning,
  isVisible: () => document.visibilityState === 'visible'
});

// Fit only after a deliberate content change. Observing the widget's size also
// observes layouts caused by dragging a native window edge, creating feedback.
function scheduleFit() {
  if (!window.timer) return;
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(() => {
    const height = $('#widget').getBoundingClientRect().height;
    if (Math.abs(height - lastFitHeight) > 1) {
      lastFitHeight = height;
      window.timer.resize(height).catch(error => notice('#error', error.message));
    }
  }, 100);
}

function formatTime(milliseconds) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map(value => String(value).padStart(2, '0')).join(':');
}

function formatDate(timestamp) {
  const date = new Date(timestamp);
  return [date.getMonth() + 1, date.getDate(), date.getFullYear() % 100]
    .map(value => String(value).padStart(2, '0')).join('-');
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(className, text, title, action) {
  const node = element('button', className, text);
  node.type = 'button';
  node.title = title;
  node.setAttribute('aria-label', title);
  node.addEventListener('click', action);
  return node;
}

function notice(selector, message) {
  const node = $(selector);
  const text = message || '';
  const changed = node.textContent !== text || node.hidden !== !message;
  node.textContent = text;
  node.hidden = !message;
  if (changed) scheduleFit();
}

async function perform(action) {
  if (busy) return;
  busy = true;
  notice('#error', null);
  let changed = false;
  try {
    const next = await action();
    changed = next !== data;
    if (changed) data = next;
  } catch (error) { notice('#error', error.message); }
  finally { busy = false; if (changed) render(); }
}

function showNameDialog(project = null) {
  editingId = project?.id ?? null;
  $('#dialog-title').textContent = project ? 'Rename project' : 'New project';
  $('#save-name').textContent = project ? 'Save name' : 'Create project';
  $('#project-name').value = project?.name ?? '';
  notice('#name-error', null);
  $('#name-dialog').showModal();
  $('#project-name').focus();
  $('#project-name').select();
}

function confirmDeletion(title, message) {
  $('#delete-title').textContent = title;
  $('#delete-message').textContent = message;
  return Confirmation.confirmDelete($('#delete-dialog'), $('#cancel-delete'));
}

function renderSessionEditor(project, index, block) {
  const draft = sessionEdit;
  const locked = project.blocks.at(-1)?.end === null;
  const form = element('form', 'session-editor');
  const fields = element('div', 'session-edit-fields');
  const inputs = {};
  for (const [key, labelText] of [['start', 'Start'], ['end', 'End']]) {
    const field = element('div');
    const label = element('label', '', labelText);
    const input = element('input');
    input.type = 'datetime-local';
    input.step = '60';
    input.required = true;
    input.id = `session-${key}-${project.id}`;
    input.dataset.field = key;
    label.htmlFor = input.id;
    input.value = draft[key];
    // Capture the browser-normalized value to preserve unchanged timestamps
    // through daylight-saving transitions and fractional-second formatting.
    if (!draft.originalInputs) draft.originalInputs = {};
    if (!(key in draft.originalInputs)) draft.originalInputs[key] = input.value;
    draft[key] = input.value;
    input.disabled = locked || draft.saving;
    field.append(label, input);
    fields.append(field);
    inputs[key] = input;
  }
  const preview = element('p', 'history-hint');
  const times = () => Object.fromEntries(['start', 'end'].map(key => [key,
    block && inputs[key].value === draft.originalInputs[key] ? block[key] : SessionTime.fromLocalInput(inputs[key].value)
  ]));
  const updatePreview = () => {
    for (const key of ['start', 'end']) draft[key] = inputs[key].value;
    try {
      const edited = times();
      const elapsed = Date.parse(edited.end) - Date.parse(edited.start);
      preview.textContent = elapsed < 0 ? 'The end must be at or after the start.' : `Session duration: ${formatTime(elapsed)}`;
    } catch { preview.textContent = inputs.start.value && inputs.end.value ? 'Enter a valid start and end date/time.' : 'Duration: —'; }
  };
  for (const input of Object.values(inputs)) input.addEventListener('input', () => {
    draft.error = '';
    const error = form.querySelector('.form-error');
    if (error) error.hidden = true;
    updatePreview();
  });
  updatePreview();
  const error = element('p', 'form-error', draft.error || '');
  error.setAttribute('role', 'alert');
  error.hidden = !draft.error;
  const actions = element('div', 'dialog-actions');
  const cancel = button('', 'Cancel', 'Cancel session changes', () => { sessionEdit = null; render(); });
  cancel.disabled = draft.saving;
  const save = element('button', 'create', draft.adding ? 'Add session' : 'Save changes');
  save.type = 'submit';
  save.disabled = locked || draft.saving;
  actions.append(cancel, save);
  if (draft.adding) form.append(element('h3', '', 'Add missing session'));
  form.append(fields, preview, error, actions);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || locked || draft.saving) return;
    try {
      const changes = times();
      draft.saving = true;
      busy = true;
      draft.error = '';
      render();
      data = draft.adding
        ? await window.timer.addSession(project.id, changes)
        : await window.timer.editSession(project.id, index, changes);
      sessionEdit = null;
      notice('#error', null);
    } catch (problem) { draft.error = problem.message; }
    finally { draft.saving = false; busy = false; render(); }
  });
  return form;
}

function renderSessions(project) {
  const section = element('section', 'session-history');
  section.id = `sessions-${project.id}`;
  section.setAttribute('aria-label', `Session history for ${project.name}`);
  const locked = project.blocks.at(-1)?.end === null;
  const title = element('div', 'history-heading');
  const add = button('add-session', '+', 'Add missing session', () => {
    if (busy || locked) return;
    sessionEdit = { projectId: project.id, index: null, adding: true, start: '', end: '', saving: false, error: '' };
    render();
    document.getElementById(`session-start-${project.id}`)?.focus();
  });
  add.disabled = locked || busy;
  title.append(element('h2', '', 'Session History'), add);
  section.append(title);
  if (locked) section.append(element('p', 'notice', 'Stop this project’s timer before changing sessions.'));
  if (sessionEdit?.projectId === project.id && sessionEdit.adding) section.append(renderSessionEditor(project, null, null));
  if (!project.blocks.length) section.append(element('p', 'history-hint', 'No recorded sessions yet.'));
  const list = element('div', 'session-list');
  const page = Math.min(historyPages.get(project.id) || 0, Math.max(0, Math.ceil(project.blocks.length / historyPageSize) - 1));
  historyPages.set(project.id, page);
  const first = page * historyPageSize;
  const endIndex = Math.min(first + historyPageSize, project.blocks.length);
  if (project.blocks.length > historyPageSize) {
    const pages = element('div', 'history-pages');
    const navigate = offset => {
      historyPages.set(project.id, page + offset);
      sessionEdit = null;
      render();
    };
    const previous = button('', '‹', 'Previous sessions', () => navigate(-1));
    const next = button('', '›', 'Next sessions', () => navigate(1));
    previous.disabled = page === 0 || busy;
    next.disabled = endIndex === project.blocks.length || busy;
    const range = element('span', 'history-hint', `${first + 1}–${endIndex} of ${project.blocks.length}`);
    range.setAttribute('aria-live', 'polite');
    pages.append(previous, range, next);
    section.append(pages);
  }
  for (let index = first; index < endIndex; index++) {
    const block = project.blocks[index];
    const row = element('div', 'session-row');
    const heading = element('div', 'session-row-heading');
    const duration = element('span', 'history-duration');
    duration.dataset.sessionDuration = String(index);
    const edit = button('edit-session', 'Edit', `Edit session ${index + 1}`, () => {
      if (busy || locked) return;
      sessionEdit = { projectId: project.id, index, start: SessionTime.minuteInput(block.start), end: SessionTime.minuteInput(block.end), saving: false, error: '' };
      render();
      document.getElementById(`session-start-${project.id}`)?.focus();
    });
    edit.disabled = locked || busy;
    const remove = button('delete-session', 'Delete', `Delete session ${index + 1}`, () => perform(async () => {
      if (!await confirmDeletion(`Delete session ${index + 1}?`, `This permanently removes the session from “${project.name}”. Its totals and dates will be recalculated.`)) return data;
      const snapshot = await window.timer.deleteSession(project.id, index);
      const updated = snapshot.projects.find(item => item.id === project.id);
      if (updated && updated.blocks.length < project.blocks.length && sessionEdit?.projectId === project.id) sessionEdit = null;
      return snapshot;
    }));
    remove.disabled = locked || busy;
    heading.append(element('strong', '', `Session ${index + 1}`), duration, edit, remove);
    const stamps = element('div', 'session-range');
    const start = new Date(block.start);
    const end = block.end === null ? null : new Date(block.end);
    const startText = `${formatDate(block.start)} · ${sessionClock.format(start)}`;
    const endText = end === null ? 'Running…'
      : `${start.toDateString() === end.toDateString() ? '' : `${formatDate(block.end)} · `}${sessionClock.format(end)}`;
    const arrow = element('span', 'session-range-arrow', '→');
    arrow.setAttribute('aria-hidden', 'true');
    stamps.setAttribute('aria-label', `Start: ${startText}. End: ${endText}.`);
    stamps.append(element('span', '', startText), arrow, element('span', '', endText));
    row.append(heading, stamps);
    if (sessionEdit?.projectId === project.id && sessionEdit.index === index) row.append(renderSessionEditor(project, index, block));
    list.append(row);
  }
  section.append(list);
  return section;
}

function buildProjectCard(project, collapsed) {
  const last = project.blocks.at(-1);
  const running = last?.end === null;
  const card = element('article', `project${collapsed ? ' collapsed' : ''}`);
  card.dataset.project = project.id;
  const heading = element('div', 'project-heading');
  const toggle = button('toggle', collapsed ? '▸' : '▾', `${collapsed ? 'Expand' : 'Collapse'} ${project.name}`, () => {
    sessionView.close();
    perform(() => window.timer.update(project.id, 'collapse', !collapsed));
  });
  toggle.setAttribute('aria-expanded', String(!collapsed));
  heading.append(toggle);
  if (collapsed) {
    // Keep the compact row to its name and expand control.
    heading.append(element('span', 'project-name', project.name));
    if (running) {
      const dot = element('span', 'running-dot');
      dot.title = 'Timer running';
      dot.setAttribute('aria-label', 'Timer running');
      heading.append(dot);
    }
  } else {
    heading.append(button('project-name', project.name, `Rename ${project.name}`, () => showNameDialog(project)));
    const sessionCount = button('session-count', `(${project.blocks.length} ${project.blocks.length === 1 ? 'session' : 'sessions'})`, `Show or hide sessions for ${project.name}`, () => {
      sessionView.toggle(project.id);
      render();
    });
    sessionCount.setAttribute('aria-expanded', String(sessionView.isOpen(project.id)));
    sessionCount.setAttribute('aria-controls', `sessions-${project.id}`);
    heading.append(sessionCount);
    heading.append(button('delete', 'Delete', `Delete ${project.name}`, () => perform(async () => {
      if (!await confirmDeletion(`Delete “${project.name}”?`, 'This permanently deletes the project and all of its sessions.')) return data;
      return window.timer.delete(project.id);
    })));
  }
  card.append(heading);
  if (!collapsed) {
    const content = element('div', 'project-content');
    const controls = element('div', 'controls');
    const play = button('play', '▶ Play', `Start ${project.name}`, () => perform(() => window.timer.update(project.id, 'start')));
    const stop = button('stop', '■ Stop', `Stop ${project.name}`, () => perform(() => window.timer.update(project.id, 'stop')));
    play.disabled = running;
    stop.disabled = !running;
    controls.append(play, stop);
    const session = element('div', 'time');
    session.append(element('span', 'time-label', 'Session'), element('span', 'digits session-time'));
    const dates = element('div', 'dates');
    if (project.blocks.length) {
      const firstStart = project.blocks[0].start;
      const lastStop = project.blocks.findLast(block => block.end !== null)?.end;
      const from = element('span', '', `From: ${formatDate(firstStart)}`);
      from.title = new Date(firstStart).toLocaleString();
      dates.append(from);
      if (lastStop) {
        const till = element('span', '', `Till: ${formatDate(lastStop)}`);
        till.title = new Date(lastStop).toLocaleString();
        dates.append(till);
      }
    }
    const total = element('div', 'time');
    total.append(element('span', 'time-label', 'Total'), element('span', 'digits total-time'));
    content.append(controls, session, dates, total);
    card.append(content);
    if (sessionView.isOpen(project.id)) card.append(renderSessions(project));
  }
  return card;
}

function sameProject(left, right) {
  return left === right || (left.name === right.name && left.collapsed === right.collapsed &&
    left.blocks.length === right.blocks.length && left.blocks.every((block, index) =>
      block.start === right.blocks[index].start && block.end === right.blocks[index].end));
}

function render() {
  sessionView.sync(data.projects);
  if (sessionEdit && !data.projects.some(project => project.id === sessionEdit.projectId)) sessionEdit = null;
  const focused = document.activeElement;
  const focusedProject = focused?.closest('[data-project]')?.dataset.project;
  const focusedClass = focused?.className;
  const focusedField = focused?.dataset.field;
  const container = $('#projects');
  const ids = new Set(data.projects.map(project => project.id));
  let layoutChanged = false;
  for (const [id, entry] of projectCards) {
    if (ids.has(id)) continue;
    entry.card.remove();
    projectCards.delete(id);
    historyPages.delete(id);
    layoutChanged = true;
  }
  $('#empty').hidden = data.projects.length !== 0;
  clockDisplay.reset(data.projects, $('#summary'));
  for (const [index, project] of data.projects.entries()) {
    const collapsed = sessionView.isCollapsed(project);
    const open = !collapsed && sessionView.isOpen(project.id);
    const draftKey = () => open && sessionEdit?.projectId === project.id ? JSON.stringify(sessionEdit) : '';
    const page = historyPages.get(project.id) || 0;
    let entry = projectCards.get(project.id);
    if (!entry || !sameProject(entry.project, project) || entry.collapsed !== collapsed ||
        entry.open !== open || entry.draft !== draftKey() || entry.page !== page ||
        (open && entry.busy !== busy)) {
      const scrollTop = entry?.card.querySelector('.session-list')?.scrollTop || 0;
      const card = buildProjectCard(project, collapsed);
      if (entry) entry.card.replaceWith(card);
      const list = card.querySelector('.session-list');
      if (list) list.scrollTop = entry?.page === page ? scrollTop : 0;
      entry = {
        card, project, collapsed, open, draft: draftKey(),
        page: historyPages.get(project.id) || 0, busy,
        clocks: collapsed ? null : {
          session: card.querySelector('.session-time'),
          total: card.querySelector('.total-time'),
          history: new Map([...card.querySelectorAll('[data-session-duration]')]
            .map(node => [Number(node.dataset.sessionDuration), node]))
        }
      };
      projectCards.set(project.id, entry);
      layoutChanged = true;
    }
    if (container.children[index] !== entry.card) {
      container.insertBefore(entry.card, container.children[index] || null);
      layoutChanged = true;
    }
    // IPC clones every project. Reuse unchanged models too, so cached cards
    // do not retain a second copy of a large history.
    data.projects[index] = entry.project;
    if (entry.clocks) clockDisplay.register(entry.project, entry.clocks);
  }
  if (document.visibilityState === 'visible') updateClocks();
  displayScheduler.sync();
  if (layoutChanged) scheduleFit();
  if (focusedProject && !focused.isConnected && (focusedClass || focusedField)) {
    const card = projectCards.get(focusedProject)?.card;
    const target = focusedField
      ? [...(card?.querySelectorAll('input') ?? [])].find(node => node.dataset.field === focusedField)
      : [...(card?.querySelectorAll('button') ?? [])].find(node => node.className === focusedClass);
    target?.focus({ preventScroll: true });
  }
}

function updateClocks() {
  clockDisplay.update();
}

$('#footer-timezone').textContent = `Times shown in ${Intl.DateTimeFormat().resolvedOptions().timeZone}`;

if (!window.timer) {
  notice('#error', 'Launch Project Timer from VS Code with “yarn start” to open the desktop widget.');
  $('#create').disabled = true;
  $('#show-data').disabled = true;
} else {
  $('#create').addEventListener('click', () => showNameDialog());
  $('#cancel-name').addEventListener('click', () => $('#name-dialog').close());
  $('#name-form').addEventListener('submit', async event => {
    event.preventDefault();
    const name = $('#project-name').value.trim();
    if (!name) { notice('#name-error', 'Please enter a project name.'); return; }
    const save = $('#save-name');
    if (save.disabled || busy) return;
    save.disabled = true;
    busy = true;
    let changed = false;
    try {
      data = editingId ? await window.timer.update(editingId, 'rename', name) : await window.timer.create(name);
      $('#name-dialog').close();
      notice('#error', null);
      changed = true;
    } catch (error) { notice('#name-error', error.message); }
    finally { save.disabled = false; busy = false; if (changed) render(); }
  });
  $('#show-data').addEventListener('click', async () => {
    try { await window.timer.showData(); }
    catch (error) { notice('#error', error.message); }
  });
  window.timer.onSaveStatus(message => notice('#save-error', message));

  window.timer.load().then(initial => {
    data = initial;
    $('#show-data').title = initial.dataFile;
    if (initial.recovered) notice('#recovery', `Recovered ${initial.recovered} unfinished ${initial.recovered === 1 ? 'timer' : 'timers'} at the last saved heartbeat. Timers are stopped.`);
    render();
  }).catch(error => notice('#error', error.message));
  document.addEventListener('visibilitychange', () => displayScheduler.sync({ refresh: true }));
  window.addEventListener('beforeunload', () => displayScheduler.dispose(), { once: true });
}
