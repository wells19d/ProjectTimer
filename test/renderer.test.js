const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// A small DOM double lets the real renderer run without starting Electron or
// introducing a browser dependency. Identity assertions detect unwanted redraws.
function fixture(projects) {
  let document;
  class Node {
    constructor(tag = 'div') {
      this.tagName = tag;
      this.children = [];
      this.dataset = {};
      this.className = '';
      this.listeners = new Map();
      this.attributes = {};
      this.parentElement = null;
      this.scrollTop = 0;
      this.value = '';
      this._text = '';
    }
    get textContent() { return this._text + this.children.map(node => node.textContent).join(''); }
    set textContent(value) { this._text = value; this.replaceChildren(); }
    get isConnected() { return this === document.body || !!this.parentElement?.isConnected; }
    append(...nodes) { for (const node of nodes) this.insertBefore(node, null); }
    insertBefore(node, before) {
      node.remove();
      const index = before ? this.children.indexOf(before) : this.children.length;
      this.children.splice(index, 0, node);
      node.parentElement = this;
      return node;
    }
    replaceChildren(...nodes) { for (const node of [...this.children]) node.remove(); this.append(...nodes); }
    remove() {
      if (this.parentElement) {
        const siblings = this.parentElement.children;
        siblings.splice(siblings.indexOf(this), 1);
        this.parentElement = null;
      }
    }
    replaceWith(node) { const parent = this.parentElement; parent.insertBefore(node, this); this.remove(); }
    setAttribute(name, value) { this.attributes[name] = value; }
    matches(selector) {
      if (selector.startsWith('.')) return this.className.split(' ').includes(selector.slice(1));
      if (selector.startsWith('#')) return this.id === selector.slice(1);
      if (selector.startsWith('[data-')) {
        const key = selector.slice(6, -1).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
        return key in this.dataset;
      }
      return this.tagName === selector;
    }
    querySelectorAll(selector) {
      return this.children.flatMap(node => [...(node.matches(selector) ? [node] : []), ...node.querySelectorAll(selector)]);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
    addEventListener(type, callback) {
      const callbacks = this.listeners.get(type) || [];
      callbacks.push(callback);
      this.listeners.set(type, callbacks);
    }
    async fire(type) {
      if (this.disabled) return;
      for (const callback of this.listeners.get(type) || []) await callback({ preventDefault() {} });
    }
    focus() { document.activeElement = this; }
    select() {}
    showModal() {}
    close() {}
  }
  document = {
    body: new Node('body'), visibilityState: 'visible', activeElement: null,
    createElement: tag => new Node(tag),
    querySelector: selector => document.body.querySelector(selector),
    querySelectorAll: selector => document.body.querySelectorAll(selector),
    getElementById: id => document.body.querySelector(`#${id}`),
    addEventListener() {}
  };
  for (const id of ['widget', 'projects', 'empty', 'summary', 'footer-timezone', 'create', 'show-data', 'cancel-name',
    'name-form', 'project-name', 'save-name', 'name-dialog', 'dialog-title', 'name-error', 'error', 'save-error',
    'recovery', 'delete-title', 'delete-message', 'delete-dialog', 'cancel-delete']) {
    const node = new Node(); node.id = id; document.body.append(node);
  }
  let deleteCalls = 0;
  const context = vm.createContext({
    document, console, Intl, Date, setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    window: { addEventListener() {}, timer: {
      load: async () => ({ projects: structuredClone(projects) }),
      onSaveStatus() {},
      delete: async () => { deleteCalls++; throw new Error('Unexpected delete'); },
      resize: async () => {}
    } }
  });
  for (const name of ['session-time', 'session-view', 'confirmation', 'clock-display', 'display-scheduler', 'renderer']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, `../src/${name}.js`), 'utf8'), context);
  }
  const run = code => vm.runInContext(code, context);
  const card = id => document.querySelectorAll('[data-project]').find(node => node.dataset.project === id);
  return { document, context, run, card, deleteCalls: () => deleteCalls };
}
const stamp = seconds => new Date(seconds * 1000).toISOString();
const block = index => ({ start: stamp(index * 120), end: stamp(index * 120 + 60) });
const project = (id, count = 2, collapsed = false) => ({ id, name: id, collapsed, blocks: Array.from({ length: count }, (_, index) => block(index)) });
const ready = () => new Promise(resolve => setImmediate(resolve));

test('unchanged snapshots preserve cards, history rows, scroll and focused input nodes', async () => {
  const f = fixture([project('a'), project('b')]); await ready();
  await f.card('a').querySelector('.session-count').fire('click');
  await f.card('a').querySelector('.edit-session').fire('click');
  const a = f.card('a'), b = f.card('b');
  const list = a.querySelector('.session-list'); list.scrollTop = 55;
  const input = a.querySelector('input'); input.focus();
  f.run('data = JSON.parse(JSON.stringify(data)); render();');
  assert.equal(f.card('a'), a);
  assert.equal(f.card('b'), b);
  assert.equal(f.document.activeElement, input);
  assert.equal(list.scrollTop, 55);
});

test('a change to one project preserves other cards and updates its own clocks', async () => {
  const f = fixture([project('a'), project('b')]); await ready();
  const a = f.card('a'), b = f.card('b');
  f.run("data = JSON.parse(JSON.stringify(data)); data.projects[0].blocks[0].end = new Date(90000).toISOString(); render();");
  assert.notEqual(f.card('a'), a);
  assert.equal(f.card('b'), b);
  assert.equal(f.card('a').querySelector('.total-time').textContent, '00:02:30');
});

test('cancelled deletion keeps the original card and never calls the delete IPC', async () => {
  const f = fixture([project('a')]); await ready();
  const a = f.card('a');
  f.run('Confirmation.confirmDelete = async () => false;');
  await a.querySelector('.delete').fire('click');
  assert.equal(f.card('a'), a);
  assert.equal(f.deleteCalls(), 0);
});

test('opening and closing history restores saved collapse states and preserves unaffected cards', async () => {
  const f = fixture([project('a'), project('b'), project('c', 2, true)]); await ready();
  const b = f.card('b'), c = f.card('c');
  await f.card('a').querySelector('.session-count').fire('click');
  assert.equal(f.card('b').className, 'project collapsed');
  assert.equal(f.card('c'), c);
  assert.notEqual(f.card('b'), b);
  await f.card('a').querySelector('.session-count').fire('click');
  assert.equal(f.card('b').className, 'project');
  assert.equal(f.card('c'), c);
});

test('large histories have bounded rows, correct global session indices and paged durations', async () => {
  const f = fixture([project('a', 1003)]); await ready();
  await f.card('a').querySelector('.session-count').fire('click');
  assert.equal(f.card('a').querySelectorAll('.session-row').length, 25);
  assert.match(f.card('a').querySelector('.history-pages').textContent, /1–25 of 1003/);
  await f.card('a').querySelector('.history-pages').querySelectorAll('button')[1].fire('click');
  const first = f.card('a').querySelector('.session-row');
  assert.match(first.textContent, /Session 26/);
  assert.equal(first.querySelector('.history-duration').textContent, '00:01:00');
  await first.querySelector('.edit-session').fire('click');
  assert.equal(f.run('sessionEdit.index'), 25);
  assert.equal(f.card('a').querySelectorAll('.session-row').length, 25);
});

test('shrinking history clamps the page; removing projects removes their cards and page state', async () => {
  const f = fixture([project('a', 26), project('b')]); await ready();
  await f.card('a').querySelector('.session-count').fire('click');
  await f.card('a').querySelector('.history-pages').querySelectorAll('button')[1].fire('click');
  assert.equal(f.card('a').querySelectorAll('.session-row').length, 1);
  f.run('data = JSON.parse(JSON.stringify(data)); data.projects[0].blocks.pop(); render();');
  assert.equal(f.card('a').querySelectorAll('.session-row').length, 25);
  assert.equal(f.card('a').querySelector('.history-pages'), null);
  f.run('data = {projects: data.projects.slice(1)}; render();');
  assert.equal(f.card('a'), undefined);
  assert.equal(f.run("historyPages.has('a')"), false);
  assert.equal(f.card('b').className, 'project');
});

test('editing a session on a later page submits its original index and updates its duration', async () => {
  const f = fixture([project('a', 26), project('b')]); await ready();
  await f.card('a').querySelector('.session-count').fire('click');
  await f.card('a').querySelector('.history-pages').querySelectorAll('button')[1].fire('click');
  await f.card('a').querySelector('.edit-session').fire('click');
  const other = f.card('b');
  let editedIndex;
  f.context.window.timer.editSession = async (id, index) => {
    editedIndex = index;
    const next = JSON.parse(f.run('JSON.stringify(data)'));
    next.projects[0].blocks[index].end = stamp(index * 120 + 30);
    return next;
  };
  await f.card('a').querySelector('form').fire('submit');
  assert.equal(editedIndex, 25);
  assert.equal(f.card('b'), other);
  assert.equal(f.card('a').querySelector('.history-duration').textContent, '00:00:30');
  assert.equal(f.card('a').querySelector('form'), null);
});

test('failed session saves keep the draft and show the error without rebuilding other cards', async () => {
  const f = fixture([project('a'), project('b')]); await ready();
  await f.card('a').querySelector('.session-count').fire('click');
  await f.card('a').querySelector('.edit-session').fire('click');
  const other = f.card('b');
  f.context.window.timer.editSession = async () => { throw new Error('Times overlap'); };
  await f.card('a').querySelector('form').fire('submit');
  assert.equal(f.card('b'), other);
  assert.equal(f.card('a').querySelector('.form-error').textContent, 'Times overlap');
  assert.equal(f.card('a').querySelector('input').disabled, false);
  assert.equal(f.run('sessionEdit.index'), 0);
});

test('deleting the last session on a later page returns to a valid page and recomputes totals', async () => {
  const f = fixture([project('a', 26)]); await ready();
  await f.card('a').querySelector('.session-count').fire('click');
  await f.card('a').querySelector('.history-pages').querySelectorAll('button')[1].fire('click');
  f.run('Confirmation.confirmDelete = async () => true;');
  let removedIndex;
  f.context.window.timer.deleteSession = async (id, index) => {
    removedIndex = index;
    const next = JSON.parse(f.run('JSON.stringify(data)'));
    next.projects[0].blocks.splice(index, 1);
    return next;
  };
  await f.card('a').querySelector('.delete-session').fire('click');
  assert.equal(removedIndex, 25);
  assert.equal(f.card('a').querySelectorAll('.session-row').length, 25);
  assert.equal(f.card('a').querySelector('.total-time').textContent, '00:25:00');
});

test('running clocks stay current across page changes and lock editing on every page', async () => {
  const p = project('a', 26);
  p.blocks[25].end = null;
  const f = fixture([p]); await ready();
  f.run('Date = class extends Date { static now() { return 3100000; } }; updateClocks();');
  await f.card('a').querySelector('.session-count').fire('click');
  assert.equal(f.card('a').querySelector('.session-time').textContent, '00:01:40');
  assert.equal(f.card('a').querySelector('.add-session').disabled, true);
  assert.equal(f.card('a').querySelector('.edit-session').disabled, true);
  await f.card('a').querySelector('.history-pages').querySelectorAll('button')[1].fire('click');
  assert.equal(f.card('a').querySelector('.history-duration').textContent, '00:01:40');
  f.run('Date = class extends Date { static now() { return 3102000; } }; updateClocks();');
  assert.equal(f.card('a').querySelector('.history-duration').textContent, '00:01:42');
  assert.equal(f.card('a').querySelector('.total-time').textContent, '00:26:42');
  assert.equal(f.card('a').querySelector('.delete-session').disabled, true);
});
