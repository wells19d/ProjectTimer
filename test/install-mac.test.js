const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { installMacApp: install, assertAppClosed } = require('../scripts/install-mac');
const { resolveDataDirectory } = require('../src/data-directory');
const { TimerStore, upgradeDataFile } = require('../src/store');

// The filesystem/update behavior is real; native process checks and signing
// are supplied separately so these tests do not launch or sign applications.
const installMacApp = (source, applications, copy, options = {}) => install(source, applications, copy, { checkClosed: () => {}, sign: () => {}, ...options });

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'timer-install-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const applications = path.join(root, 'Applications');
  const source = path.join(root, 'build.app');
  const destination = path.join(applications, 'Project Timer.app');
  fs.mkdirSync(applications);
  const app = path.join(source, 'Contents', 'Resources', 'app');
  fs.mkdirSync(app, { recursive: true });
  fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({ name: 'project-timer' }));
  fs.writeFileSync(path.join(source, 'version'), 'new');
  return { applications, source, destination, copy: (from, to) => fs.cpSync(from, to, { recursive: true }) };
}

test('installs a built app in Applications and preserves the build copy', t => {
  const f = fixture(t);
  assert.equal(installMacApp(f.source, f.applications, f.copy), f.destination);
  assert.equal(fs.readFileSync(path.join(f.destination, 'version'), 'utf8'), 'new');
  assert.ok(fs.existsSync(f.source));
  assert.deepEqual(fs.readdirSync(f.applications), ['Project Timer.app']);
});

test('replaces an earlier Project Timer install with the new build', t => {
  const f = fixture(t);
  f.copy(f.source, f.destination);
  fs.writeFileSync(path.join(f.destination, 'version'), 'old');
  installMacApp(f.source, f.applications, f.copy);
  assert.equal(fs.readFileSync(path.join(f.destination, 'version'), 'utf8'), 'new');
  assert.deepEqual(fs.readdirSync(f.applications), ['Project Timer.app']);
});

test('a copy failure leaves the installed app intact', t => {
  const f = fixture(t);
  f.copy(f.source, f.destination);
  fs.writeFileSync(path.join(f.destination, 'version'), 'old');
  assert.throws(() => installMacApp(f.source, f.applications, () => { throw new Error('Disk full'); }), /Disk full/);
  assert.equal(fs.readFileSync(path.join(f.destination, 'version'), 'utf8'), 'old');
  assert.deepEqual(fs.readdirSync(f.applications), ['Project Timer.app']);
});

test('a failed final replacement restores the previous install', t => {
  const f = fixture(t);
  f.copy(f.source, f.destination);
  fs.writeFileSync(path.join(f.destination, 'version'), 'old');
  // Simulate a copy reporting success but leaving no new bundle to rename.
  assert.throws(() => installMacApp(f.source, f.applications, () => {}));
  assert.equal(fs.readFileSync(path.join(f.destination, 'version'), 'utf8'), 'old');
  assert.deepEqual(fs.readdirSync(f.applications), ['Project Timer.app']);
});

test('leaves an unrelated application with the same name alone', t => {
  const f = fixture(t);
  fs.mkdirSync(f.destination);
  fs.writeFileSync(path.join(f.destination, 'keep'), 'unrelated');
  assert.throws(() => installMacApp(f.source, f.applications, f.copy), /not a recognized/);
  assert.equal(fs.readFileSync(path.join(f.destination, 'keep'), 'utf8'), 'unrelated');
});

function legacyFixture(t, externalProjects) {
  const f = fixture(t);
  f.copy(f.source, f.destination);
  const external = path.join(f.applications, '..', 'data');
  fs.mkdirSync(external);
  const config = path.join(f.source, 'Contents', 'Resources', 'app', 'desktop-config.json');
  fs.writeFileSync(config, JSON.stringify({ dataDirectory: external }));
  const legacy = path.join(f.destination, 'Contents', 'Resources', 'app', 'data');
  fs.mkdirSync(legacy);
  const original = JSON.stringify({ version: 1, projects: [{ id: 'old', name: 'Existing project', collapsed: false, blocks: [] }] });
  fs.writeFileSync(path.join(legacy, 'projects.json'), original);
  fs.writeFileSync(path.join(legacy, 'heartbeat.json'), '{"lastSeenAt":"2026-11-22T14:00:00Z"}');
  fs.writeFileSync(path.join(external, 'projects.json'), JSON.stringify({ version: 1, projects: externalProjects }));
  return { ...f, external, legacy, original };
}

test('an update carries internal history and heartbeat forward without changing the data location', t => {
  const f = legacyFixture(t, []);
  installMacApp(f.source, f.applications, f.copy);
  assert.equal(fs.readFileSync(path.join(f.legacy, 'projects.json'), 'utf8'), f.original);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.legacy, 'heartbeat.json'), 'utf8')).lastSeenAt, '2026-11-22T14:00:00Z');
  assert.equal(resolveDataDirectory({ appDirectory: path.dirname(f.legacy), packaged: true }), f.legacy);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.external, 'projects.json'), 'utf8')).projects, []);
});

test('developer sample data never replaces an installed app history during an update', t => {
  const projects = [{ id: 'external', name: 'Developer sample', collapsed: false, blocks: [] }];
  const f = legacyFixture(t, projects);
  installMacApp(f.source, f.applications, f.copy);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.external, 'projects.json'), 'utf8')).projects, projects);
  assert.equal(fs.readFileSync(path.join(f.legacy, 'projects.json'), 'utf8'), f.original);
  assert.equal(resolveDataDirectory({ appDirectory: path.dirname(f.legacy), packaged: true }), f.legacy);
});

test('failed data preservation leaves the installed app and its history untouched', t => {
  const f = legacyFixture(t, []);
  fs.writeFileSync(path.join(f.destination, 'version'), 'old');
  assert.throws(() => installMacApp(f.source, f.applications, (from, to) => {
    if (from === f.legacy) throw new Error('Data copy failed');
    f.copy(from, to);
  }), /Data copy failed/);
  assert.equal(fs.readFileSync(path.join(f.legacy, 'projects.json'), 'utf8'), f.original);
  assert.equal(fs.readFileSync(path.join(f.destination, 'version'), 'utf8'), 'old');
});

test('creating a new project after repeated app updates succeeds and retains existing projects', t => {
  const f = legacyFixture(t, []);
  for (let update = 0; update < 2; update++) {
    installMacApp(f.source, f.applications, f.copy);
    const directory = resolveDataDirectory({ appDirectory: path.dirname(f.legacy), packaged: true });
    const store = new TimerStore(directory);
    store.create(`Added after update ${update + 1}`);
  }
  const saved = JSON.parse(fs.readFileSync(path.join(f.legacy, 'projects.json'), 'utf8'));
  assert.deepEqual(saved.projects.map(p => p.name), ['Existing project', 'Added after update 1', 'Added after update 2']);
});

test('repairs the external-path build by carrying its active history into the installed app without changing the source file', t => {
  const f = fixture(t);
  const appPath = bundle => path.join(bundle, 'Contents', 'Resources', 'app');
  f.copy(f.source, f.destination);
  const external = path.join(f.applications, '..', 'existing-data');
  fs.mkdirSync(external);
  const original = JSON.stringify({ version: 1, projects: [{ id: 'mine', name: 'My actual work', collapsed: false, blocks: [] }] });
  fs.writeFileSync(path.join(external, 'projects.json'), original);
  fs.writeFileSync(path.join(appPath(f.destination), 'desktop-config.json'), JSON.stringify({ dataDirectory: external }));
  fs.writeFileSync(path.join(appPath(f.source), 'desktop-config.json'), JSON.stringify({ dataDirectory: path.join(f.applications, '..', 'different-clone-data') }));
  installMacApp(f.source, f.applications, f.copy);
  const installedData = path.join(appPath(f.destination), 'data');
  assert.equal(resolveDataDirectory({ appDirectory: appPath(f.destination), packaged: true }), installedData);
  assert.equal(fs.readFileSync(path.join(installedData, 'projects.json'), 'utf8'), original);
  assert.equal(fs.existsSync(path.join(appPath(f.destination), 'desktop-config.json')), false);
  assert.equal(fs.readFileSync(path.join(external, 'projects.json'), 'utf8'), original);
});

test('the original Electron-named build retains its actual internal store despite its misleading config', t => {
  const f = legacyFixture(t, [{ id: 'sample', name: 'Sample', collapsed: false, blocks: [] }]);
  fs.writeFileSync(path.join(path.dirname(f.legacy), 'desktop-config.json'), JSON.stringify({ dataDirectory: f.external }));
  const executables = path.join(f.destination, 'Contents', 'MacOS');
  fs.mkdirSync(executables);
  fs.writeFileSync(path.join(executables, 'Electron'), 'original runtime');
  installMacApp(f.source, f.applications, f.copy);
  assert.equal(resolveDataDirectory({ appDirectory: path.dirname(f.legacy), packaged: true }), f.legacy);
  assert.equal(fs.readFileSync(path.join(f.legacy, 'projects.json'), 'utf8'), f.original);
});

test('a failed signature check leaves the old app and data intact', t => {
  const f = legacyFixture(t, []);
  fs.writeFileSync(path.join(f.destination, 'version'), 'old');
  assert.throws(() => installMacApp(f.source, f.applications, f.copy, { sign: () => { throw new Error('Signing failed'); } }), /Signing failed/);
  assert.equal(fs.readFileSync(path.join(f.destination, 'version'), 'utf8'), 'old');
  assert.equal(fs.readFileSync(path.join(f.legacy, 'projects.json'), 'utf8'), f.original);
});

test('an installer refuses to touch a running app', t => {
  const f = legacyFixture(t, []);
  let copied = false;
  assert.throws(() => installMacApp(f.source, f.applications, () => { copied = true; }, { checkClosed: () => { throw new Error('App is running'); } }), /App is running/);
  assert.equal(copied, false);
  assert.equal(fs.readFileSync(path.join(f.legacy, 'projects.json'), 'utf8'), f.original);
});

test('process detection recognizes the main process and helpers without matching another app', t => {
  const f = fixture(t);
  f.copy(f.source, f.destination);
  assert.throws(() => assertAppClosed(f.destination, () => `${f.destination}/Contents/MacOS/Project Timer\n`), /still running/);
  assert.throws(() => assertAppClosed(f.destination, () => `${f.destination}/Contents/Frameworks/Electron Helper.app/Contents/MacOS/Electron Helper\n`), /still running/);
  assert.doesNotThrow(() => assertAppClosed(f.destination, () => '/Applications/Some Other App.app/Contents/MacOS/app\n'));
});

test('a first install starts empty even if the build contains sample history', t => {
  const f = fixture(t);
  const sample = path.join(f.source, 'Contents', 'Resources', 'app', 'data');
  fs.mkdirSync(sample);
  fs.writeFileSync(path.join(sample, 'projects.json'), JSON.stringify({ version: 1, projects: [{ id: 'sample', name: 'My screenshot project', collapsed: false, blocks: [] }] }));
  installMacApp(f.source, f.applications, f.copy);
  const installedData = path.join(f.destination, 'Contents', 'Resources', 'app', 'data');
  const store = new TimerStore(installedData);
  assert.deepEqual(store.snapshot(), { version: 1, projects: [] });
  assert.equal(JSON.parse(fs.readFileSync(path.join(sample, 'projects.json'), 'utf8')).projects.length, 1);
});

test('unsupported newer data stops the update without changing the installed app or its file', t => {
  const f = legacyFixture(t, []);
  const newer = JSON.stringify({ version: 4, projects: [{ id: 'work', name: 'Important work', blocks: [] }] });
  fs.writeFileSync(path.join(f.legacy, 'projects.json'), newer);
  fs.writeFileSync(path.join(f.destination, 'version'), 'old');
  assert.throws(() => installMacApp(f.source, f.applications, f.copy), /newer than this app supports/);
  assert.equal(fs.readFileSync(path.join(f.legacy, 'projects.json'), 'utf8'), newer);
  assert.equal(fs.readFileSync(path.join(f.destination, 'version'), 'utf8'), 'old');
});

test('a supported future version 3 to 4 conversion preserves installed history and an original backup', t => {
  const f = legacyFixture(t, []);
  const data = JSON.parse(f.original);
  data.version = 3;
  const original = JSON.stringify(data);
  fs.writeFileSync(path.join(f.legacy, 'projects.json'), original);
  installMacApp(f.source, f.applications, f.copy, {
    upgrade: file => upgradeDataFile(file, {
      targetVersion: 4,
      migrations: { 3: data => ({ ...data, settings: {} }) },
      validateData: data => { assert.equal(data.version, 4); assert.ok(Array.isArray(data.projects)); }
    })
  });
  const migrated = JSON.parse(fs.readFileSync(path.join(f.legacy, 'projects.json'), 'utf8'));
  assert.equal(migrated.version, 4);
  assert.deepEqual(migrated.projects, data.projects);
  const backup = fs.readdirSync(f.legacy).find(name => name.endsWith('.backup.json'));
  assert.equal(fs.readFileSync(path.join(f.legacy, backup), 'utf8'), original);
});

test('a failed conversion leaves the old app and its data completely unchanged', t => {
  const f = legacyFixture(t, []);
  fs.writeFileSync(path.join(f.destination, 'version'), 'old');
  assert.throws(() => installMacApp(f.source, f.applications, f.copy, {
    upgrade: () => { throw new Error('Migration failed'); }
  }), /Migration failed/);
  assert.equal(fs.readFileSync(path.join(f.legacy, 'projects.json'), 'utf8'), f.original);
  assert.equal(fs.readFileSync(path.join(f.destination, 'version'), 'utf8'), 'old');
});
