const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHeartbeat, createCloseGuard } = require('../src/save-lifecycle');

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture() {
  const jobs = new Map(), messages = [], delays = [];
  let next = 0, active = false, saves = 0;
  let save = async () => { saves++; };
  const heartbeat = createHeartbeat({
    store: { hasRunning: () => active, heartbeat: () => save() },
    report: message => messages.push(message),
    schedule: (callback, delay) => { const id = next++; jobs.set(id, callback); delays.push(delay); return id; },
    cancel: id => jobs.delete(id)
  });
  return {
    heartbeat, jobs, messages, delays, saves: () => saves,
    active(value) { active = value; }, save(callback) { save = callback; },
    async tick() { const [id, callback] = [...jobs.entries()][0]; jobs.delete(id); await callback(); }
  };
}

test('idle has no heartbeat timer or status traffic; active timers share one five-second timeout', async () => {
  const f = fixture();
  f.heartbeat.sync();
  assert.equal(f.jobs.size, 0);
  f.active(true); f.heartbeat.sync(); f.heartbeat.sync();
  assert.equal(f.jobs.size, 1);
  await f.tick();
  assert.equal(f.saves(), 1);
  assert.equal(f.jobs.size, 1);
  assert.deepEqual(f.delays, [5000, 5000]);
  assert.deepEqual(f.messages, []);
  f.active(false); f.heartbeat.sync();
  assert.equal(f.jobs.size, 0);
});

test('a slow heartbeat cannot queue another heartbeat until it settles', async () => {
  const f = fixture(), gate = deferred();
  f.active(true); f.save(() => gate.promise); f.heartbeat.sync();
  const pending = f.tick();
  f.heartbeat.sync(); f.heartbeat.sync();
  assert.equal(f.jobs.size, 0);
  gate.resolve(); await pending;
  assert.equal(f.jobs.size, 1);
});

test('repeated save errors are reported once and recovery clears the status once', async () => {
  const f = fixture();
  f.active(true); f.save(async () => { throw new Error('Disk full'); });
  f.heartbeat.sync(); await f.tick(); await f.tick();
  assert.equal(f.messages.length, 1);
  assert.match(f.messages[0], /Disk full/);
  f.save(async () => {}); await f.tick(); await f.tick();
  assert.deepEqual(f.messages.slice(1), [null]);
});

test('pausing for close blocks rescheduling even when a heartbeat is already saving', async () => {
  const f = fixture(), gate = deferred();
  f.active(true); f.save(() => gate.promise); f.heartbeat.sync();
  const pending = f.tick();
  f.heartbeat.pause(); gate.resolve(); await pending;
  assert.equal(f.jobs.size, 0);
  f.heartbeat.resume();
  assert.equal(f.jobs.size, 1);
  const stale = [...f.jobs.values()][0];
  f.heartbeat.dispose(); await stale(); f.heartbeat.sync();
  assert.equal(f.jobs.size, 0);
});

test('stopping the last project clears an obsolete autosave error without restarting polling', async () => {
  const f = fixture();
  f.active(true); f.save(async () => { throw new Error('No access'); });
  f.heartbeat.sync(); await f.tick();
  f.active(false); f.heartbeat.sync();
  assert.equal(f.jobs.size, 0);
  assert.equal(f.messages.at(-1), null);
});

test('close waits for saving, deduplicates requests and allows the final quit to pass', async () => {
  const gate = deferred(), events = [];
  const guard = createCloseGuard({
    pause: () => events.push('pause'), resume: () => events.push('resume'),
    save: () => { events.push('save'); return gate.promise; },
    finish: () => events.push('quit'), reportError: () => events.push('error')
  });
  let prevented = 0;
  const event = { preventDefault: () => prevented++ };
  const pending = guard.handle(event);
  await guard.handle(event);
  assert.equal(prevented, 2);
  assert.equal(guard.isClosing(), true);
  assert.deepEqual(events, ['pause', 'save']);
  gate.resolve(); await pending; await guard.handle(event);
  assert.equal(prevented, 2);
  assert.deepEqual(events, ['pause', 'save', 'quit']);
});

test('failed final save keeps the app open, resumes recovery saving and permits a close retry', async () => {
  const events = [];
  let failed = true;
  const guard = createCloseGuard({
    pause() {}, resume: () => events.push('resume'),
    save: async () => { if (failed) throw new Error('Disk full'); },
    finish: () => events.push('quit'), reportError: error => events.push(error.message)
  });
  const event = { preventDefault() {} };
  await guard.handle(event);
  assert.equal(guard.isClosing(), false);
  assert.deepEqual(events, ['resume', 'Disk full']);
  failed = false; await guard.handle(event);
  assert.deepEqual(events, ['resume', 'Disk full', 'quit']);
});
