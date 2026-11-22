const $ = selector => document.querySelector(selector);
let data = { projects: [] };
let editingId = null;
let busy = false;
let resizeTimeout;
let lastFitHeight = 0;

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
  try {
    data = await action();
    render();
  } catch (error) { notice('#error', error.message); }
  finally { busy = false; }
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

function render() {
  const focused = document.activeElement;
  const focusedProject = focused?.closest('[data-project]')?.dataset.project;
  const focusedClass = focused?.className;
  $('#projects').replaceChildren();
  $('#empty').hidden = data.projects.length !== 0;
  for (const project of data.projects) {
    const last = project.blocks.at(-1);
    const running = last?.end === null;
    const card = element('article', `project${project.collapsed ? ' collapsed' : ''}`);
    card.dataset.project = project.id;
    const heading = element('div', 'project-heading');
    const toggle = button('toggle', project.collapsed ? '▸' : '▾', `${project.collapsed ? 'Expand' : 'Collapse'} ${project.name}`, () => perform(() => window.timer.update(project.id, 'collapse', !project.collapsed)));
    toggle.setAttribute('aria-expanded', String(!project.collapsed));
    heading.append(toggle);
    if (project.collapsed) {
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
      heading.append(element('span', 'session-count', `(${project.blocks.length} ${project.blocks.length === 1 ? 'session' : 'sessions'})`));
      heading.append(button('delete', 'Delete', `Delete ${project.name}`, () => perform(() => window.timer.delete(project.id))));
    }
    card.append(heading);
    if (!project.collapsed) {
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
        const lastStop = [...project.blocks].reverse().find(block => block.end !== null)?.end;
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
    }
    $('#projects').append(card);
  }
  updateClocks();
  scheduleFit();
  if (focusedProject && focusedClass) {
    const card = [...document.querySelectorAll('[data-project]')].find(node => node.dataset.project === focusedProject);
    [...(card?.querySelectorAll('button') ?? [])].find(node => node.className === focusedClass)?.focus({ preventScroll: true });
  }
}

function updateClocks() {
  const now = Date.now();
  let active = 0;
  for (const project of data.projects) {
    const last = project.blocks.at(-1);
    if (last?.end === null) active++;
    const card = [...document.querySelectorAll('[data-project]')].find(node => node.dataset.project === project.id);
    if (!card || project.collapsed) continue;
    const duration = block => Math.max(0, (block.end === null ? now : Date.parse(block.end)) - Date.parse(block.start));
    card.querySelector('.session-time').textContent = formatTime(last ? duration(last) : 0);
    card.querySelector('.total-time').textContent = formatTime(project.blocks.reduce((sum, block) => sum + duration(block), 0));
  }
  $('#summary').textContent = data.projects.length
    ? `${data.projects.length} ${data.projects.length === 1 ? 'project' : 'projects'} · ${active ? `${active} running` : 'All timers stopped'}`
    : 'Your time, project by project.';
}

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
    try {
      data = editingId ? await window.timer.update(editingId, 'rename', name) : await window.timer.create(name);
      $('#name-dialog').close();
      notice('#error', null);
      render();
    } catch (error) { notice('#name-error', error.message); }
    finally { save.disabled = false; busy = false; }
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
  setInterval(updateClocks, 250);
}
