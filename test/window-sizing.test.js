const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createAutoSizer } = require('../src/window-sizing');

function fixture(options) {
  const window = new EventEmitter();
  let bounds = { x: 100, y: 100, width: 490, height: 310 };
  let changes = 0;
  Object.assign(window, {
    getBounds: () => ({ ...bounds }),
    getContentSize: () => [bounds.width, bounds.height - 28],
    isDestroyed: () => false,
    isMaximized: () => false,
    isFullScreen: () => false,
    setBounds: next => { bounds = { ...next }; changes++; },
    setSize: (width, height) => {
      bounds = { ...bounds, width, height };
      changes++;
      window.emit('resize');
    },
    setPosition: (x, y) => { bounds = { ...bounds, x, y }; changes++; }
  });
  const screen = { getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } }) };
  return { window, resize: createAutoSizer(window, screen, options), changes: () => changes };
}

test('manual dragging prevents pending and future automatic sizes from overriding the user', () => {
  const { window, resize, changes } = fixture();
  resize(400);
  window.emit('will-resize');
  window.setBounds({ x: 120, y: 160, width: 600, height: 250 });
  const manual = window.getBounds();
  const before = changes();
  // Includes a request that could already have been queued when the drag started.
  resize(600);
  resize(1000);
  resize(200);
  assert.deepEqual(window.getBounds(), manual);
  assert.equal(changes(), before);
});

test('automatic fitting can grow and shrink, caps at the screen, and avoids repeated native moves', () => {
  const { window, resize, changes } = fixture();
  resize(400);
  assert.equal(window.getBounds().height, 428);
  resize(400);
  assert.equal(changes(), 1);
  resize(1200);
  const large = window.getBounds();
  assert.ok(large.y >= 0);
  assert.ok(large.y + large.height <= 900);
  assert.equal(large.width, 490);
  resize(240);
  assert.equal(window.getBounds().height, 268);
});

test('a fresh window automatically fits again after a previous launch used manual sizing', () => {
  const first = fixture();
  first.window.emit('will-resize');
  first.resize(500);
  assert.equal(first.changes(), 0);
  const reopened = fixture();
  reopened.resize(500);
  assert.equal(reopened.window.getBounds().height, 528);
});

test('maximized, fullscreen, destroyed windows and invalid requests do not trigger native moves', () => {
  const { window, resize, changes } = fixture();
  for (const value of [NaN, Infinity, -10, 0, '400']) resize(value);
  for (const state of ['isMaximized', 'isFullScreen', 'isDestroyed']) {
    window[state] = () => true;
    resize(400);
    window[state] = () => false;
  }
  assert.equal(changes(), 0);
});

test('an empty-window resize takes priority even when the native will-resize event is missing', () => {
  const { window, resize, changes } = fixture();
  // Simulate the first resize, before the initial content-fit request arrives.
  window.setSize(650, 240);
  const manual = window.getBounds();
  const before = changes();
  resize(280);
  resize(600);
  assert.deepEqual(window.getBounds(), manual);
  assert.equal(changes(), before);
});

test('ordinary fitting changes the size without initiating a native window move', () => {
  const { window, resize } = fixture();
  window.setPosition = () => { throw new Error('Unexpected native move'); };
  window.setBounds = () => { throw new Error('Unexpected combined move and resize'); };
  resize(250);
  assert.equal(window.getBounds().height, 278);
  // A delayed resize notification from the programmatic size is still safe.
  window.emit('resize');
  resize(400);
  assert.equal(window.getBounds().height, 428);
});

test('moving the window manually also cancels pending automatic repositioning', () => {
  const { window, resize, changes } = fixture();
  window.emit('will-move');
  const before = changes();
  resize(1200);
  assert.equal(changes(), before);
});

test('automatic fitting keeps the taller startup size while still allowing a smaller manual size', () => {
  const { window, resize } = fixture({ minimumHeight: 388 });
  resize(180);
  assert.equal(window.getBounds().height, 388);
  resize(500);
  assert.equal(window.getBounds().height, 528);
  resize(180);
  assert.equal(window.getBounds().height, 388);
  window.emit('will-resize');
  window.setSize(540, 240);
  resize(180);
  assert.equal(window.getBounds().height, 240);
});
