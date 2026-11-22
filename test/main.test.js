const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function fixture() {
  const handlers = new Map(), timers = new Map(), errors = [];
  let window, quitCalls = 0;
  const store = {
    file: '/temporary/profile-data/projects.json', recovered: 0,
    snapshot: () => ({ version: 1, projects: [] }),
    flush: async () => {}, hasRunning: () => false,
    create: async () => ({ version: 1, projects: [{ id: 'created' }] }),
    stopAll: async () => ({ version: 1, projects: [] })
  };
  const app = new EventEmitter();
  Object.assign(app, {
    setName() {}, requestSingleInstanceLock: () => true, whenReady: async () => {},
    getAppPath: () => '/temporary/project-timer', getVersion: () => '1.0.1',
    dock: { setIcon() {} }, setAboutPanelOptions() {}, quit: () => quitCalls++
  });
  class Window extends EventEmitter {
    constructor() {
      super(); window = this;
      this.webContents = new EventEmitter();
      Object.assign(this.webContents, {
        mainFrame: {}, setWindowOpenHandler() {}, isDestroyed: () => false,
        send() {}
      });
    }
    getBounds() { return { x: 0, y: 0, width: 540, height: 388 }; }
    loadFile() {}
    isDestroyed() { return false; }
  }
  const electron = {
    app, BrowserWindow: Window,
    ipcMain: { handle: (channel, callback) => handlers.set(channel, callback) },
    dialog: { showErrorBox: (...args) => errors.push(args) }, shell: {}, screen: {},
    Menu: { buildFromTemplate: template => template, setApplicationMenu() {} }
  };
  const context = vm.createContext({
    process: { platform: 'darwin', env: {} }, __dirname: path.resolve(__dirname, '../src'),
    setTimeout: (callback, delay) => { const id = timers.size; timers.set(id, { callback, delay }); return id; },
    clearTimeout: id => timers.delete(id),
    require: name => {
      if (name === 'electron') return electron;
      if (name === './store') return { TimerStore: class { constructor() { return store; } } };
      if (name.startsWith('.')) return require(path.join(__dirname, '../src', name));
      return require(name);
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  const call = (channel, ...args) => handlers.get(channel)({ sender: window.webContents, senderFrame: window.webContents.mainFrame }, ...args);
  return { store, app, window, errors, handlers, call, quitCalls: () => quitCalls };
}

test('IPC awaits asynchronous saves and returns their committed snapshot', async () => {
  const f = await fixture();
  let release;
  f.store.create = () => new Promise(resolve => { release = resolve; });
  let settled = false;
  const pending = f.call('timer:create', 'Lab').then(result => { settled = true; return result; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false);
  release({ projects: [{ id: 'saved' }] });
  const result = await pending;
  assert.equal(result.ok, true);
  assert.equal(result.value.projects[0].id, 'saved');
});

test('asynchronous save errors reach the renderer in the existing error envelope', async () => {
  const f = await fixture();
  f.store.create = async () => { throw new Error('Disk full'); };
  const result = await f.call('timer:create', 'Lab');
  assert.equal(result.ok, false);
  assert.equal(result.error, 'Disk full');
});

test('close blocks new requests while waiting for the final save and quits only after success', async () => {
  const f = await fixture();
  let release;
  f.store.stopAll = () => new Promise(resolve => { release = resolve; });
  let prevented = false;
  const close = f.window.listeners('close')[0]({ preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(f.quitCalls(), 0);
  const result = await f.call('timer:create', 'Too late');
  assert.equal(result.ok, false);
  assert.match(result.error, /closing/);
  release(); await close;
  assert.equal(f.quitCalls(), 1);
});

test('failed close reports the problem and leaves IPC available for retrying', async () => {
  const f = await fixture();
  f.store.stopAll = async () => { throw new Error('Read-only disk'); };
  await f.window.listeners('close')[0]({ preventDefault() {} });
  assert.equal(f.quitCalls(), 0);
  assert.match(f.errors[0][1], /Read-only disk/);
  assert.equal((await f.call('timer:create', 'Retry')).ok, true);
});

test('untrusted IPC remains rejected before invoking any store operation', async () => {
  const f = await fixture();
  await assert.rejects(f.handlers.get('timer:create')({ sender: {}, senderFrame: {} }, 'Lab'), /Invalid request source/);
});
