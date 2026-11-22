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

test('new projects have zero blocks; Stop before Play does nothing', async t => {
  const { store } = fixture(t);
  await store.create('  Lab09  ');
  const fresh = project(store);
  assert.equal(fresh.name, 'Lab09');
  assert.equal(fresh.collapsed, false);
  assert.deepEqual(fresh.blocks, []);
  await store.update(fresh.id, 'stop');
  assert.deepEqual(project(store), fresh);
});

test('Play is idempotent; Stop finishes only the latest block; resuming makes another block', async t => {
  const { store, advance } = fixture(t);
  await store.create('Lab09');
  const id = project(store).id;
  await store.update(id, 'start');
  advance(60000);
  await store.update(id, 'start');
  assert.equal(project(store).blocks.length, 1);
  advance(60000);
  await store.update(id, 'stop');
  const first = project(store).blocks[0];
  assert.equal(Date.parse(first.end) - Date.parse(first.start), 120000);
  advance(5000);
  await store.update(id, 'stop');
  assert.deepEqual(project(store).blocks[0], first);
  await store.update(id, 'start');
  advance(30000);
  await store.update(id, 'stop');
  const blocks = project(store).blocks;
  assert.equal(blocks.length, 2);
  assert.equal(Date.parse(blocks[1].end) - Date.parse(blocks[1].start), 30000);
  assert.equal(blocks.reduce((total, b) => total + Date.parse(b.end) - Date.parse(b.start), 0), 150000);
});

test('projects run independently and stopAll records a common closing time', async t => {
  const { store, advance } = fixture(t);
  await store.create('Lab09');
  await store.create('Lab08');
  const [a, b] = store.snapshot().projects;
  await store.update(a.id, 'start');
  advance(1000);
  await store.update(b.id, 'start');
  assert.equal(store.snapshot().projects.filter(p => p.blocks.at(-1).end === null).length, 2);
  advance(5000);
  await store.stopAll();
  const stopped = store.snapshot();
  assert.equal(stopped.projects[0].blocks[0].end, stopped.projects[1].blocks[0].end);
  advance(1000);
  await store.stopAll();
  assert.deepEqual(store.snapshot(), stopped);
});

test('heartbeat is separate from project blocks, and recovery excludes downtime', async t => {
  const { directory, store, advance, clock } = fixture(t);
  await store.create('Lab09');
  await store.update(project(store).id, 'start');
  const activeJSON = fs.readFileSync(store.file, 'utf8');
  advance(5000);
  await store.heartbeat();
  assert.equal(fs.readFileSync(store.file, 'utf8'), activeJSON);
  assert.equal(project(store).blocks[0].end, null);
  advance(3600000);
  const reopened = new TimerStore(directory, clock);
  assert.equal(reopened.recovered, 1);
  const block = project(reopened).blocks[0];
  assert.equal(Date.parse(block.end) - Date.parse(block.start), 5000);
  assert.equal(new TimerStore(directory, clock).recovered, 0);
});

test('normal closing persists final times and does not recover timers on reopen', async t => {
  const { directory, store, advance, clock } = fixture(t);
  await store.create('Lab09');
  await store.update(project(store).id, 'start');
  advance(12345);
  await store.stopAll();
  advance(800000);
  const reopened = new TimerStore(directory, clock);
  assert.equal(reopened.recovered, 0);
  assert.equal(Date.parse(project(reopened).blocks[0].end) - Date.parse(project(reopened).blocks[0].start), 12345);
});

test('missing or malformed heartbeat safely recovers unfinished blocks at their start', async t => {
  for (const contents of [null, '{bad json', '{"lastSeenAt":"invalid"}']) {
    const { directory, store, advance, clock } = fixture(t);
    await store.create('Lab09');
    await store.update(project(store).id, 'start');
    if (contents === null) fs.unlinkSync(store.heartbeatFile);
    else fs.writeFileSync(store.heartbeatFile, contents);
    advance(60000);
    const reopened = new TimerStore(directory, clock);
    const block = project(reopened).blocks[0];
    assert.equal(block.start, block.end);
  }
});

test('collapse and rename persist without changing time blocks', async t => {
  const { directory, store, clock } = fixture(t);
  await store.create('Lab09');
  const id = project(store).id;
  await store.update(id, 'start');
  await store.update(id, 'stop');
  const blocks = project(store).blocks;
  await store.update(id, 'collapse', true);
  await store.update(id, 'rename', 'Lab10');
  const reopened = new TimerStore(directory, clock);
  assert.equal(project(reopened).collapsed, true);
  assert.equal(project(reopened).name, 'Lab10');
  assert.deepEqual(project(reopened).blocks, blocks);
});

test('deleting a running project removes its complete history from disk', async t => {
  const { directory, store, clock } = fixture(t);
  await store.create('Lab09');
  const id = project(store).id;
  await store.update(id, 'start');
  await store.update(id, 'delete');
  assert.deepEqual(new TimerStore(directory, clock).snapshot().projects, []);
});

test('manual corrections and added blocks are loaded on reopen', async t => {
  const { directory, store, clock } = fixture(t);
  await store.create('Lab09');
  const edited = store.snapshot();
  edited.projects[0].blocks.push({ start: '2026-11-21T10:00:00-06:00', end: '2026-11-21T11:30:00-06:00' });
  fs.writeFileSync(store.file, JSON.stringify(edited));
  const reopened = new TimerStore(directory, clock);
  assert.deepEqual(reopened.snapshot(), edited);
});

test('damaged or invalid project data is rejected and never overwritten', async t => {
  const { directory, store, clock } = fixture(t);
  for (const contents of ['{broken', '{"version":2,"projects":[]}', JSON.stringify({ version: 1, projects: [{ id: 'a', name: 'Lab', collapsed: false, blocks: [
    { start: '2026-11-22T14:00:00Z', end: null }, { start: '2026-11-22T15:00:00Z', end: null }
  ] }] })]) {
    fs.writeFileSync(store.file, contents);
    assert.throws(() => new TimerStore(directory, clock));
    assert.equal(fs.readFileSync(store.file, 'utf8'), contents);
  }
});

test('failed writes do not change in-memory projects or replace saved JSON', async t => {
  const { store } = fixture(t);
  await store.create('Lab09');
  const before = store.snapshot();
  const originalFile = fs.readFileSync(store.file, 'utf8');
  fs.mkdirSync(`${store.file}.tmp`);
  await assert.rejects(() => store.update(project(store).id, 'start'));
  assert.deepEqual(store.snapshot(), before);
  assert.equal(fs.readFileSync(store.file, 'utf8'), originalFile);
});

test('clock moving backward never records a negative duration or overlap', async t => {
  const { store, advance } = fixture(t);
  await store.create('Lab09');
  const id = project(store).id;
  await store.update(id, 'start');
  advance(-5000);
  await store.update(id, 'stop');
  await store.update(id, 'start');
  await store.update(id, 'stop');
  for (const block of project(store).blocks) assert.equal(block.start, block.end);
});

test('invalid actions and names leave data unchanged', async t => {
  const { store } = fixture(t);
  await store.create('Lab09');
  const before = store.snapshot();
  await assert.rejects(() => store.create('   '));
  await assert.rejects(() => store.create('x'.repeat(121)));
  await assert.rejects(() => store.update('unknown', 'start'));
  await assert.rejects(() => store.update(project(store).id, 'collapse', 'yes'));
  await assert.rejects(() => store.update(project(store).id, 'anything'));
  assert.deepEqual(store.snapshot(), before);
});

test('creating a project restores a removed data directory with all in-memory history', async t => {
  const { store, directory, clock } = fixture(t);
  await store.create('Existing lab');
  const id = project(store).id;
  await store.update(id, 'start');
  await store.update(id, 'stop');
  const original = project(store);
  fs.rmSync(directory, { recursive: true });
  await store.create('New lab');
  const restored = new TimerStore(directory, clock).snapshot();
  assert.equal(restored.projects.length, 2);
  assert.deepEqual(restored.projects[0], original);
  assert.equal(restored.projects[1].name, 'New lab');
});

test('autosave restores a removed folder and its project history before saving a recovery timestamp', async t => {
  const { store, directory, clock, advance } = fixture(t);
  await store.create('Existing lab');
  await store.update(project(store).id, 'start');
  fs.rmSync(directory, { recursive: true });
  advance(5000);
  await store.heartbeat();
  const restored = new TimerStore(directory, clock);
  assert.equal(project(restored).name, 'Existing lab');
  const block = project(restored).blocks[0];
  assert.equal(Date.parse(block.end) - Date.parse(block.start), 5000);
});

async function completedSessions(t) {
  const f = fixture(t);
  await f.store.create('Lab09');
  const id = project(f.store).id;
  await f.store.update(id, 'start');
  f.advance(60000);
  await f.store.update(id, 'stop');
  f.advance(60000);
  await f.store.update(id, 'start');
  f.advance(120000);
  await f.store.update(id, 'stop');
  return { ...f, id };
}

test('editing a stopped session persists corrections without changing session count or project metadata', async t => {
  const { store, directory, clock, id } = await completedSessions(t);
  const before = project(store);
  await store.editSession(id, 0, { start: '2026-11-22T13:59:00Z', end: '2026-11-22T14:01:30Z' });
  const reopened = new TimerStore(directory, clock);
  const edited = project(reopened);
  assert.equal(edited.name, before.name);
  assert.equal(edited.id, before.id);
  assert.equal(edited.collapsed, before.collapsed);
  assert.equal(edited.blocks.length, before.blocks.length);
  assert.deepEqual(edited.blocks[1], before.blocks[1]);
  assert.equal(edited.blocks[0].start, '2026-11-22T13:59:00.000Z');
  assert.equal(edited.blocks.reduce((sum, b) => sum + Date.parse(b.end) - Date.parse(b.start), 0), 270000);
});

test('a running project cannot change any session, including completed earlier sessions', async t => {
  const { store, id } = await completedSessions(t);
  await store.update(id, 'start');
  const before = store.snapshot();
  const saved = fs.readFileSync(store.file, 'utf8');
  for (const index of [0, 1, 2]) {
    await assert.rejects(() => store.editSession(id, index, { start: '2026-11-22T13:00:00Z', end: '2026-11-22T13:30:00Z' }), /Stop this project/);
  }
  assert.deepEqual(store.snapshot(), before);
  assert.equal(fs.readFileSync(store.file, 'utf8'), saved);
});

test('another project can run while a stopped project has its sessions corrected', async t => {
  const { store, id } = await completedSessions(t);
  await store.create('Another lab');
  const other = store.snapshot().projects[1].id;
  await store.update(other, 'start');
  await store.editSession(id, 0, { start: '2026-11-22T14:00:00Z', end: '2026-11-22T14:00:30Z' });
  assert.equal(store.snapshot().projects[1].blocks[0].end, null);
  assert.equal(project(store).blocks[0].end, '2026-11-22T14:00:30.000Z');
});

test('session corrections reject invalid times, reverse durations and nonexistent session indexes without writes', async t => {
  const { store, id } = await completedSessions(t);
  const original = fs.readFileSync(store.file, 'utf8');
  for (const [index, times] of [
    [-1, { start: '2026-11-22T14:00:00Z', end: '2026-11-22T14:01:00Z' }],
    [2, { start: '2026-11-22T14:00:00Z', end: '2026-11-22T14:01:00Z' }],
    [0, { start: 'bad', end: '2026-11-22T14:01:00Z' }],
    [0, { start: '2026-11-22T14:00:00Z', end: null }],
    [0, { start: '2026-11-22T14:01:00Z', end: '2026-11-22T14:00:00Z' }]
  ]) await assert.rejects(() => store.editSession(id, index, times));
  assert.equal(fs.readFileSync(store.file, 'utf8'), original);
});

test('session corrections cannot overlap neighboring blocks or change their order', async t => {
  const { store, id } = await completedSessions(t);
  const before = store.snapshot();
  await assert.rejects(() => store.editSession(id, 0, { start: '2026-11-22T14:00:00Z', end: '2026-11-22T14:02:01Z' }), /next session/);
  await assert.rejects(() => store.editSession(id, 1, { start: '2026-11-22T14:00:59Z', end: '2026-11-22T14:04:00Z' }), /previous session/);
  assert.deepEqual(store.snapshot(), before);
});

test('a failed session-edit save preserves both the original file and in-memory history', async t => {
  const { store, id } = await completedSessions(t);
  const before = store.snapshot();
  const saved = fs.readFileSync(store.file, 'utf8');
  fs.mkdirSync(`${store.file}.tmp`);
  await assert.rejects(() => store.editSession(id, 0, { start: '2026-11-22T14:00:00Z', end: '2026-11-22T14:00:30Z' }));
  assert.deepEqual(store.snapshot(), before);
  assert.equal(fs.readFileSync(store.file, 'utf8'), saved);
});

test('deleting the first session retains the project and the remaining session timestamps', async t => {
  const { store, id, directory, clock } = await completedSessions(t);
  const before = project(store);
  await store.deleteSession(id, 0);
  const remaining = project(new TimerStore(directory, clock));
  assert.equal(remaining.id, before.id);
  assert.equal(remaining.name, before.name);
  assert.deepEqual(remaining.blocks, [before.blocks[1]]);
  assert.equal(remaining.blocks.reduce((sum, b) => sum + Date.parse(b.end) - Date.parse(b.start), 0), 120000);
});

test('deleting all sessions keeps an empty project ready to start again', async t => {
  const { store, id } = await completedSessions(t);
  await store.deleteSession(id, 1);
  await store.deleteSession(id, 0);
  assert.equal(project(store).name, 'Lab09');
  assert.deepEqual(project(store).blocks, []);
  await store.update(id, 'start');
  assert.equal(project(store).blocks.length, 1);
  assert.equal(project(store).blocks[0].end, null);
});

test('a running project cannot delete either a completed session or its active block', async t => {
  const { store, id } = await completedSessions(t);
  await store.update(id, 'start');
  const before = store.snapshot();
  const saved = fs.readFileSync(store.file, 'utf8');
  for (const index of [0, 1, 2]) await assert.rejects(() => store.deleteSession(id, index), /Stop this project/);
  assert.deepEqual(store.snapshot(), before);
  assert.equal(fs.readFileSync(store.file, 'utf8'), saved);
});

test('a stopped project can delete a session while a different project runs', async t => {
  const { store, id } = await completedSessions(t);
  await store.create('Other project');
  const otherId = store.snapshot().projects[1].id;
  await store.update(otherId, 'start');
  await store.deleteSession(id, 0);
  assert.equal(project(store).blocks.length, 1);
  assert.equal(store.snapshot().projects[1].blocks[0].end, null);
});

test('invalid session deletions leave the file untouched', async t => {
  const { store, id } = await completedSessions(t);
  const before = fs.readFileSync(store.file, 'utf8');
  for (const index of [-1, 2, '0', null]) await assert.rejects(() => store.deleteSession(id, index));
  await assert.rejects(() => store.deleteSession('missing-project', 0));
  assert.equal(fs.readFileSync(store.file, 'utf8'), before);
});

test('a failed deletion save retains the complete history on disk and in memory', async t => {
  const { store, id } = await completedSessions(t);
  const before = store.snapshot();
  const saved = fs.readFileSync(store.file, 'utf8');
  fs.mkdirSync(`${store.file}.tmp`);
  await assert.rejects(() => store.deleteSession(id, 0));
  assert.deepEqual(store.snapshot(), before);
  assert.equal(fs.readFileSync(store.file, 'utf8'), saved);
});

async function missingSessionFixture(t) {
  const f = fixture(t);
  await f.store.create('Lab09');
  const id = project(f.store).id;
  const stamp = time => `2026-11-20T${time}:00-06:00`;
  for (const [start, end] of [['13:00', '14:00'], ['14:45', '15:45'], ['15:55', '16:20']]) {
    await f.store.addSession(id, { start: stamp(start), end: stamp(end) });
  }
  return { ...f, id, stamp };
}

test('adding rejects contained, partial, identical and encompassing overlaps without altering existing sessions', async t => {
  const { store, id, stamp } = await missingSessionFixture(t);
  const before = store.snapshot();
  const saved = fs.readFileSync(store.file, 'utf8');
  for (const [start, end] of [
    ['14:55', '15:25'], ['12:55', '13:05'], ['13:50', '14:10'],
    ['12:00', '17:00'], ['14:45', '15:45'], ['14:40', '14:50'], ['15:40', '15:50']
  ]) await assert.rejects(() => store.addSession(id, { start: stamp(start), end: stamp(end) }), /overlaps session/);
  assert.deepEqual(store.snapshot(), before);
  assert.equal(fs.readFileSync(store.file, 'utf8'), saved);
});

test('a missing session can fill a gap exactly and is inserted in chronological order', async t => {
  const { store, id, stamp, directory, clock } = await missingSessionFixture(t);
  const original = project(store).blocks;
  await store.addSession(id, { start: stamp('14:00'), end: stamp('14:45') });
  const blocks = project(new TimerStore(directory, clock)).blocks;
  assert.equal(blocks.length, 4);
  assert.deepEqual(blocks[0], original[0]);
  assert.deepEqual(blocks[2], original[1]);
  assert.deepEqual(blocks[3], original[2]);
  assert.deepEqual(Object.keys(blocks[1]).sort(), ['end', 'start']);
  assert.equal(Date.parse(blocks[1].end) - Date.parse(blocks[1].start), 2700000);
});

test('missing sessions can be added before and after the history without changing older blocks', async t => {
  const { store, id, stamp } = await missingSessionFixture(t);
  const original = project(store).blocks;
  await store.addSession(id, { start: stamp('17:00'), end: stamp('18:00') });
  await store.addSession(id, { start: stamp('11:00'), end: stamp('12:00') });
  assert.deepEqual(project(store).blocks.slice(1, 4), original);
  assert.equal(project(store).blocks[0].start, new Date(stamp('11:00')).toISOString());
  assert.equal(project(store).blocks.at(-1).end, new Date(stamp('18:00')).toISOString());
});

test('adding sessions uses absolute timestamps across dates and timezone offsets', async t => {
  const { store } = fixture(t);
  await store.create('Overnight work');
  const id = project(store).id;
  await store.addSession(id, { start: '2026-11-20T23:00:00-06:00', end: '2026-11-21T01:00:00-06:00' });
  await assert.rejects(() => store.addSession(id, { start: '2026-11-21T05:30:00Z', end: '2026-11-21T06:30:00Z' }), /overlaps/);
  await store.addSession(id, { start: '2026-11-21T07:00:00Z', end: '2026-11-21T08:00:00Z' });
  assert.equal(project(store).blocks.length, 2);
});

test('adding requires a stopped project but does not stop or block another project', async t => {
  const { store, id, stamp } = await missingSessionFixture(t);
  await store.update(id, 'start');
  await assert.rejects(() => store.addSession(id, { start: stamp('11:00'), end: stamp('12:00') }), /Stop this project/);
  await store.update(id, 'stop');
  await store.create('Another lab');
  await store.update(store.snapshot().projects[1].id, 'start');
  await store.addSession(id, { start: stamp('11:00'), end: stamp('12:00') });
  assert.equal(store.snapshot().projects[1].blocks[0].end, null);
});

test('invalid or zero-length missing sessions do not change stored history', async t => {
  const { store, id, stamp } = await missingSessionFixture(t);
  const saved = fs.readFileSync(store.file, 'utf8');
  for (const times of [null, { start: 'bad', end: stamp('12:00') },
    { start: stamp('11:00'), end: null }, { start: stamp('12:00'), end: stamp('11:00') },
    { start: stamp('11:00'), end: stamp('11:00') }]) await assert.rejects(() => store.addSession(id, times));
  await assert.rejects(() => store.addSession('missing-project', { start: stamp('11:00'), end: stamp('12:00') }));
  assert.equal(fs.readFileSync(store.file, 'utf8'), saved);
});

test('a failed missing-session save keeps the original history on disk and in memory', async t => {
  const { store, id, stamp } = await missingSessionFixture(t);
  const before = store.snapshot();
  const saved = fs.readFileSync(store.file, 'utf8');
  fs.mkdirSync(`${store.file}.tmp`);
  await assert.rejects(() => store.addSession(id, { start: stamp('11:00'), end: stamp('12:00') }));
  assert.deepEqual(store.snapshot(), before);
  assert.equal(fs.readFileSync(store.file, 'utf8'), saved);
});

test('concurrent saves are serialized without lost updates or temporary-file collisions', async t => {
  const { store } = fixture(t);
  await Promise.all(Array.from({ length: 12 }, (_, index) => store.create(`Project ${index}`)));
  await store.flush();
  const saved = JSON.parse(fs.readFileSync(store.file, 'utf8'));
  assert.equal(saved.projects.length, 12);
  assert.deepEqual(saved, store.snapshot());
  assert.equal(fs.existsSync(`${store.file}.tmp`), false);
  assert.equal(fs.existsSync(`${store.heartbeatFile}.tmp`), false);
});

test('close waits for a queued Play and uses the requested close time rather than delayed disk completion', async t => {
  const { store, advance } = fixture(t);
  await store.create('Lab');
  const id = project(store).id;
  let release;
  store.enqueue(() => new Promise(resolve => { release = resolve; }));
  await new Promise(resolve => setImmediate(resolve));
  const start = store.update(id, 'start');
  advance(12345);
  const close = store.stopAll();
  advance(60000);
  release();
  await Promise.all([start, close]);
  const saved = project(store).blocks[0];
  assert.equal(Date.parse(saved.end) - Date.parse(saved.start), 12345);
  assert.deepEqual(JSON.parse(fs.readFileSync(store.file, 'utf8')), store.snapshot());
});

test('queued heartbeat sees a pending Play and a failed save does not poison later retries', async t => {
  const { store } = fixture(t);
  await store.create('Lab');
  const id = project(store).id;
  const start = store.update(id, 'start');
  const heartbeat = store.heartbeat();
  await start;
  assert.equal(await heartbeat, true);
  fs.mkdirSync(`${store.file}.tmp`);
  await assert.rejects(store.update(id, 'rename', 'Failed rename'));
  assert.equal(project(store).name, 'Lab');
  fs.rmdirSync(`${store.file}.tmp`);
  await store.update(id, 'rename', 'Retry succeeded');
  assert.equal(project(store).name, 'Retry succeeded');
});

test('runtime saves and heartbeats use no synchronous filesystem writes', async t => {
  const { store, advance } = fixture(t);
  for (const method of ['openSync', 'writeFileSync', 'fsyncSync', 'closeSync', 'renameSync', 'mkdirSync', 'existsSync']) {
    t.mock.method(fs, method, () => { throw new Error(`Runtime called ${method}`); });
  }
  await store.create('Lab');
  await store.update(project(store).id, 'start');
  advance(5000); await store.heartbeat();
  await store.stopAll();
  t.mock.restoreAll();
});

test('idle heartbeat and redundant Play/Stop do not write or change recovery timestamps', async t => {
  const { store, advance } = fixture(t);
  await store.create('Lab');
  const id = project(store).id;
  let before = fs.readFileSync(store.heartbeatFile, 'utf8');
  advance(1000); await store.heartbeat(); await store.update(id, 'stop'); await store.stopAll();
  assert.equal(fs.readFileSync(store.heartbeatFile, 'utf8'), before);
  await store.update(id, 'start');
  before = fs.readFileSync(store.heartbeatFile, 'utf8');
  advance(1000); await store.update(id, 'start');
  assert.equal(fs.readFileSync(store.heartbeatFile, 'utf8'), before);
});

test('a failed asynchronous rename leaves the last good file intact and cleans its temporary file', async t => {
  const { store } = fixture(t);
  const before = fs.readFileSync(store.file, 'utf8');
  const { atomicWriteAsync } = require('../src/store');
  t.mock.method(fs.promises, 'rename', async () => { throw new Error('Rename failed'); });
  await assert.rejects(atomicWriteAsync(store.file, { version: 1, projects: [] }), /Rename failed/);
  assert.equal(fs.readFileSync(store.file, 'utf8'), before);
  assert.equal(fs.existsSync(`${store.file}.tmp`), false);
});

test('a queued heartbeat cannot restart saving after the last project has stopped', async t => {
  const { store, advance } = fixture(t);
  await store.create('Lab');
  const id = project(store).id;
  await store.update(id, 'start');
  advance(5000);
  const stop = store.update(id, 'stop');
  const heartbeat = store.heartbeat();
  await stop;
  const saved = fs.readFileSync(store.heartbeatFile, 'utf8');
  assert.equal(await heartbeat, false);
  assert.equal(fs.readFileSync(store.heartbeatFile, 'utf8'), saved);
  assert.equal(store.hasRunning(), false);
});
