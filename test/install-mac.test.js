const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { installMacApp } = require('../scripts/install-mac');

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

test('updating an old bundle imports internal history into an empty external store and preserves a backup', t => {
  const f = legacyFixture(t, []);
  installMacApp(f.source, f.applications, f.copy);
  assert.equal(fs.readFileSync(path.join(f.external, 'projects.json'), 'utf8'), f.original);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.external, 'heartbeat.json'), 'utf8')).lastSeenAt, '2026-11-22T14:00:00Z');
  const backup = fs.readdirSync(f.external).find(name => name.startsWith('legacy-app-backup-'));
  assert.equal(fs.readFileSync(path.join(f.external, backup, 'projects.json'), 'utf8'), f.original);
});

test('updating preserves existing external projects and separately backs up the old internal history', t => {
  const projects = [{ id: 'external', name: 'Keep these times', collapsed: false, blocks: [] }];
  const f = legacyFixture(t, projects);
  installMacApp(f.source, f.applications, f.copy);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.external, 'projects.json'), 'utf8')).projects, projects);
  const backup = fs.readdirSync(f.external).find(name => name.startsWith('legacy-app-backup-'));
  assert.equal(fs.readFileSync(path.join(f.external, backup, 'projects.json'), 'utf8'), f.original);
});

test('a failed legacy-data backup leaves the installed app and its history in place', t => {
  const f = legacyFixture(t, []);
  assert.throws(() => installMacApp(f.source, f.applications, (from, to) => {
    if (from === f.legacy) throw new Error('Backup disk full');
    f.copy(from, to);
  }), /Backup disk full/);
  assert.equal(fs.readFileSync(path.join(f.legacy, 'projects.json'), 'utf8'), f.original);
  assert.equal(fs.readFileSync(path.join(f.destination, 'version'), 'utf8'), 'new');
});
