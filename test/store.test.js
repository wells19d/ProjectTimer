const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { TimerStore } = require('../src/store');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'project-timer-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let now = Date.parse('2026-11-22T14:00:00.000Z');
  const clock = () => new Date(now);
  const store = new TimerStore(directory, clock);
  return { directory, store, clock, advance: milliseconds => { now += milliseconds; } };
}

function project(store) { return store.snapshot().projects[0]; }

test('new projects have zero blocks; Stop before Play does nothing', t => {
  const { store } = fixture(t);
  store.create('  Lab09  ');
  const fresh = project(store);
  assert.equal(fresh.name, 'Lab09');
  assert.equal(fresh.collapsed, false);
  assert.deepEqual(fresh.blocks, []);
  store.update(fresh.id, 'stop');
  assert.deepEqual(project(store), fresh);
});

test('Play is idempotent; Stop finishes only the latest block; resuming makes another block', t => {
  const { store, advance } = fixture(t);
  store.create('Lab09');
  const id = project(store).id;
  store.update(id, 'start');
  advance(60000);
  store.update(id, 'start');
  assert.equal(project(store).blocks.length, 1);
  advance(60000);
  store.update(id, 'stop');
  const first = project(store).blocks[0];
  assert.equal(Date.parse(first.end) - Date.parse(first.start), 120000);
  advance(5000);
  store.update(id, 'stop');
  assert.deepEqual(project(store).blocks[0], first);
  store.update(id, 'start');
  advance(30000);
  store.update(id, 'stop');
  const blocks = project(store).blocks;
  assert.equal(blocks.length, 2);
  assert.equal(Date.parse(blocks[1].end) - Date.parse(blocks[1].start), 30000);
  assert.equal(blocks.reduce((total, b) => total + Date.parse(b.end) - Date.parse(b.start), 0), 150000);
});

test('projects run independently and stopAll records a common closing time', t => {
  const { store, advance } = fixture(t);
  store.create('Lab09');
  store.create('Lab08');
  const [a, b] = store.snapshot().projects;
  store.update(a.id, 'start');
  advance(1000);
  store.update(b.id, 'start');
  assert.equal(store.snapshot().projects.filter(p => p.blocks.at(-1).end === null).length, 2);
  advance(5000);
  store.stopAll();
  const stopped = store.snapshot();
  assert.equal(stopped.projects[0].blocks[0].end, stopped.projects[1].blocks[0].end);
  advance(1000);
  store.stopAll();
  assert.deepEqual(store.snapshot(), stopped);
});

test('heartbeat is separate from project blocks, and recovery excludes downtime', t => {
  const { directory, store, advance, clock } = fixture(t);
  store.create('Lab09');
  store.update(project(store).id, 'start');
  const activeJSON = fs.readFileSync(store.file, 'utf8');
  advance(5000);
  store.heartbeat();
  assert.equal(fs.readFileSync(store.file, 'utf8'), activeJSON);
  assert.equal(project(store).blocks[0].end, null);
  advance(3600000);
  const reopened = new TimerStore(directory, clock);
  assert.equal(reopened.recovered, 1);
  const block = project(reopened).blocks[0];
  assert.equal(Date.parse(block.end) - Date.parse(block.start), 5000);
  assert.equal(new TimerStore(directory, clock).recovered, 0);
});

test('normal closing persists final times and does not recover timers on reopen', t => {
  const { directory, store, advance, clock } = fixture(t);
  store.create('Lab09');
  store.update(project(store).id, 'start');
  advance(12345);
  store.stopAll();
  advance(800000);
  const reopened = new TimerStore(directory, clock);
  assert.equal(reopened.recovered, 0);
  assert.equal(Date.parse(project(reopened).blocks[0].end) - Date.parse(project(reopened).blocks[0].start), 12345);
});

test('missing or malformed heartbeat safely recovers unfinished blocks at their start', t => {
  for (const contents of [null, '{bad json', '{"lastSeenAt":"invalid"}']) {
    const { directory, store, advance, clock } = fixture(t);
    store.create('Lab09');
    store.update(project(store).id, 'start');
    if (contents === null) fs.unlinkSync(store.heartbeatFile);
    else fs.writeFileSync(store.heartbeatFile, contents);
    advance(60000);
    const reopened = new TimerStore(directory, clock);
    const block = project(reopened).blocks[0];
    assert.equal(block.start, block.end);
  }
});

test('collapse and rename persist without changing time blocks', t => {
  const { directory, store, clock } = fixture(t);
  store.create('Lab09');
  const id = project(store).id;
  store.update(id, 'start');
  store.update(id, 'stop');
  const blocks = project(store).blocks;
  store.update(id, 'collapse', true);
  store.update(id, 'rename', 'Lab10');
  const reopened = new TimerStore(directory, clock);
  assert.equal(project(reopened).collapsed, true);
  assert.equal(project(reopened).name, 'Lab10');
  assert.deepEqual(project(reopened).blocks, blocks);
});

test('deleting a running project removes its complete history from disk', t => {
  const { directory, store, clock } = fixture(t);
  store.create('Lab09');
  const id = project(store).id;
  store.update(id, 'start');
  store.update(id, 'delete');
  assert.deepEqual(new TimerStore(directory, clock).snapshot().projects, []);
});

test('manual corrections and added blocks are loaded on reopen', t => {
  const { directory, store, clock } = fixture(t);
  store.create('Lab09');
  const edited = store.snapshot();
  edited.projects[0].blocks.push({ start: '2026-11-21T10:00:00-06:00', end: '2026-11-21T11:30:00-06:00' });
  fs.writeFileSync(store.file, JSON.stringify(edited));
  const reopened = new TimerStore(directory, clock);
  assert.deepEqual(reopened.snapshot(), edited);
});

test('damaged or invalid project data is rejected and never overwritten', t => {
  const { directory, store, clock } = fixture(t);
  for (const contents of ['{broken', '{"version":2,"projects":[]}', JSON.stringify({ version: 1, projects: [{ id: 'a', name: 'Lab', collapsed: false, blocks: [
    { start: '2026-11-22T14:00:00Z', end: null }, { start: '2026-11-22T15:00:00Z', end: null }
  ] }] })]) {
    fs.writeFileSync(store.file, contents);
    assert.throws(() => new TimerStore(directory, clock));
    assert.equal(fs.readFileSync(store.file, 'utf8'), contents);
  }
});

test('failed writes do not change in-memory projects or replace saved JSON', t => {
  const { store } = fixture(t);
  store.create('Lab09');
  const before = store.snapshot();
  const originalFile = fs.readFileSync(store.file, 'utf8');
  fs.mkdirSync(`${store.file}.tmp`);
  assert.throws(() => store.update(project(store).id, 'start'));
  assert.deepEqual(store.snapshot(), before);
  assert.equal(fs.readFileSync(store.file, 'utf8'), originalFile);
});

test('clock moving backward never records a negative duration or overlap', t => {
  const { store, advance } = fixture(t);
  store.create('Lab09');
  const id = project(store).id;
  store.update(id, 'start');
  advance(-5000);
  store.update(id, 'stop');
  store.update(id, 'start');
  store.update(id, 'stop');
  for (const block of project(store).blocks) assert.equal(block.start, block.end);
});

test('invalid actions and names leave data unchanged', t => {
  const { store } = fixture(t);
  store.create('Lab09');
  const before = store.snapshot();
  assert.throws(() => store.create('   '));
  assert.throws(() => store.create('x'.repeat(121)));
  assert.throws(() => store.update('unknown', 'start'));
  assert.throws(() => store.update(project(store).id, 'collapse', 'yes'));
  assert.throws(() => store.update(project(store).id, 'anything'));
  assert.deepEqual(store.snapshot(), before);
});
