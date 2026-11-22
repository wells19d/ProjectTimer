const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { CURRENT_DATA_VERSION, migrateData } = require('../src/data-version');
const { upgradeDataFile } = require('../src/store');

function fixture(t, version = 1) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'timer-data-version-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const data = { version, projects: [{ id: 'lab', name: 'Lab09', collapsed: true, blocks: [
    { start: '2026-11-20T15:00:00Z', end: '2026-11-20T16:30:00Z' }
  ] }] };
  const file = path.join(directory, 'projects.json');
  const original = JSON.stringify(data, null, 4) + '\n';
  fs.writeFileSync(file, original);
  return { directory, file, data, original };
}

test('app 1.0.1 keeps data format 1 and does not rewrite existing compatible data', t => {
  const f = fixture(t);
  assert.equal(CURRENT_DATA_VERSION, 1);
  assert.deepEqual(upgradeDataFile(f.file), f.data);
  assert.equal(fs.readFileSync(f.file, 'utf8'), f.original);
  assert.deepEqual(fs.readdirSync(f.directory), ['projects.json']);
});

test('future migrations run in order while keeping projects, names, collapse states and time blocks', () => {
  const original = { version: 2, projects: [{ id: 'work', name: 'Work', collapsed: true, blocks: [{ start: '2026-11-20T15:00:00Z', end: '2026-11-20T16:00:00Z' }] }] };
  const calls = [];
  const migrated = migrateData(original, { targetVersion: 4, migrations: {
    2: data => { calls.push(2); return { ...data, preferences: {} }; },
    3: data => { calls.push(3); return { ...data, units: 'seconds' }; }
  } });
  assert.deepEqual(calls, [2, 3]);
  assert.equal(migrated.version, 4);
  assert.deepEqual(migrated.projects, original.projects);
  assert.equal(original.version, 2);
  assert.equal(original.preferences, undefined);
});

test('missing conversion steps fail without touching the original data file', t => {
  const f = fixture(t);
  assert.throws(() => upgradeDataFile(f.file, { targetVersion: 2 }), /No data migration/);
  assert.equal(fs.readFileSync(f.file, 'utf8'), f.original);
});

test('a migration that mutates its copy and fails cannot corrupt the original', t => {
  const f = fixture(t, 3);
  assert.throws(() => upgradeDataFile(f.file, { targetVersion: 4, migrations: {
    3: data => { data.projects.length = 0; throw new Error('Conversion failed'); }
  } }), /Conversion failed/);
  assert.equal(fs.readFileSync(f.file, 'utf8'), f.original);
});

test('failed validation after conversion leaves the data file untouched', t => {
  const f = fixture(t, 3);
  assert.throws(() => upgradeDataFile(f.file, {
    targetVersion: 4, migrations: { 3: data => data },
    validateData: () => { throw new Error('Invalid converted data'); }
  }), /Invalid converted data/);
  assert.equal(fs.readFileSync(f.file, 'utf8'), f.original);
});
