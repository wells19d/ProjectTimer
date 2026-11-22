const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSessionView } = require('../src/session-view');

test('opening history temporarily collapses other projects without changing saved states', () => {
  const projects = [{ id: 'a', collapsed: false }, { id: 'b', collapsed: false }, { id: 'c', collapsed: true }];
  const before = structuredClone(projects);
  const view = createSessionView();
  view.toggle('a');
  assert.deepEqual(projects.map(project => view.isCollapsed(project)), [false, true, true]);
  assert.deepEqual(projects, before);
  view.toggle('a');
  assert.deepEqual(projects.map(project => view.isCollapsed(project)), [false, false, true]);
  assert.deepEqual(projects, before);
});

test('timer and name updates do not erase saved collapse states while history is open', () => {
  const view = createSessionView();
  view.toggle('a');
  const updated = [{ id: 'a', collapsed: false, name: 'Renamed' }, { id: 'b', collapsed: false, running: true }];
  view.sync(updated);
  assert.equal(view.isCollapsed(updated[1]), true);
  view.close();
  assert.equal(view.isCollapsed(updated[1]), false);
});

test('switching history focus and deleting the focused project restore the remaining saved states', () => {
  const projects = [{ id: 'a', collapsed: false }, { id: 'b', collapsed: false }, { id: 'c', collapsed: true }];
  const view = createSessionView();
  view.toggle('a');
  view.toggle('b');
  assert.equal(view.isOpen('a'), false);
  assert.equal(view.isOpen('b'), true);
  assert.deepEqual(projects.map(project => view.isCollapsed(project)), [true, false, true]);
  view.sync([projects[0], projects[2]]);
  assert.equal(view.isOpen('b'), false);
  assert.equal(view.isCollapsed(projects[0]), false);
  assert.equal(view.isCollapsed(projects[2]), true);
});
