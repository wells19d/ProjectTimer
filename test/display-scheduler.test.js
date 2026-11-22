const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createDisplayScheduler } = require('../src/display-scheduler');

function fixture() {
  const state = { active: 0, visible: true, now: 0 };
  const jobs = new Map();
  const updates = [];
  const delays = [];
  let nextId = 0;
  const scheduler = createDisplayScheduler({
    isRunning: () => state.active > 0,
    isVisible: () => state.visible,
    update: () => updates.push(state.now),
    schedule: (callback, delay) => {
      delays.push(delay);
      const id = nextId++;
      jobs.set(id, callback);
      return id;
    },
    cancel: id => jobs.delete(id)
  });
  const tick = () => {
    state.now += 500;
    for (const callback of [...jobs.values()]) callback();
  };
  return { state, jobs, updates, delays, scheduler, tick };
}

test('an empty or stopped app has no recurring display timer', () => {
  const f = fixture();
  f.scheduler.sync();
  f.tick();
  assert.equal(f.jobs.size, 0);
  assert.deepEqual(f.updates, []);
  assert.deepEqual(f.delays, []);
});

test('visible running timers refresh every 500ms with only one shared display interval', () => {
  const f = fixture();
  f.state.active = 2;
  f.scheduler.sync();
  f.scheduler.sync();
  f.scheduler.sync();
  assert.equal(f.jobs.size, 1);
  assert.deepEqual(f.delays, [500]);
  f.tick();
  f.tick();
  assert.deepEqual(f.updates, [500, 1000]);
});

test('stopping one independent project keeps refreshing until the last timer stops', () => {
  const f = fixture();
  f.state.active = 2;
  f.scheduler.sync();
  f.state.active = 1;
  f.scheduler.sync();
  assert.equal(f.jobs.size, 1);
  f.tick();
  f.state.active = 0;
  f.scheduler.sync();
  f.tick();
  assert.equal(f.jobs.size, 0);
  assert.deepEqual(f.updates, [500]);
});

test('minimizing or hiding pauses refreshes; restoring catches up immediately from wall-clock time', () => {
  const f = fixture();
  f.state.active = 1;
  f.scheduler.sync();
  f.tick();
  f.state.visible = false;
  f.scheduler.sync({ refresh: true });
  assert.equal(f.jobs.size, 0);
  f.state.now += 120000;
  assert.deepEqual(f.updates, [500]);
  f.state.visible = true;
  f.scheduler.sync({ refresh: true });
  assert.deepEqual(f.updates, [500, 120500]);
  assert.equal(f.jobs.size, 1);
  f.tick();
  assert.deepEqual(f.updates, [500, 120500, 121000]);
});

test('a stopped app refreshes once when restored without starting a recurring timer', () => {
  const f = fixture();
  f.state.visible = false;
  f.scheduler.sync({ refresh: true });
  assert.deepEqual(f.updates, []);
  f.state.visible = true;
  f.scheduler.sync({ refresh: true });
  assert.deepEqual(f.updates, [0]);
  assert.equal(f.jobs.size, 0);
});

test('a project started while hidden does not start display polling until the window is restored', () => {
  const f = fixture();
  f.state.visible = false;
  f.state.active = 1;
  f.scheduler.sync();
  assert.equal(f.jobs.size, 0);
  f.state.visible = true;
  f.scheduler.sync({ refresh: true });
  assert.deepEqual(f.updates, [0]);
  assert.equal(f.jobs.size, 1);
});

test('a pending tick rechecks visibility and stopped state before updating', () => {
  for (const change of [state => { state.visible = false; }, state => { state.active = 0; }]) {
    const f = fixture();
    f.state.active = 1;
    f.scheduler.sync();
    change(f.state);
    f.tick();
    assert.deepEqual(f.updates, []);
    assert.equal(f.jobs.size, 0);
  }
});

test('unloading clears the timer and prevents late callbacks from restarting it', () => {
  const f = fixture();
  f.state.active = 1;
  f.scheduler.sync();
  const pending = [...f.jobs.values()][0];
  f.scheduler.dispose();
  f.scheduler.dispose();
  f.scheduler.sync({ refresh: true });
  pending();
  assert.equal(f.jobs.size, 0);
  assert.deepEqual(f.updates, []);
});
