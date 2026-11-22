const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createClockDisplay } = require('../src/clock-display');

const stamp = seconds => new Date(seconds * 1000).toISOString();
const block = (start, end) => ({ start: stamp(start), end: end === null ? null : stamp(end) });
const project = blocks => ({ blocks });
function cell() {
  let text = '';
  return {
    writes: 0,
    get textContent() { return text; },
    set textContent(value) { text = value; this.writes++; }
  };
}
function fixture() {
  let timestamp = 100000;
  const display = createClockDisplay({
    now: () => timestamp,
    formatTime: ms => String(Math.floor(ms / 1000))
  });
  const summary = cell();
  const bind = p => {
    const refs = { session: cell(), total: cell(), history: p.blocks.map(cell) };
    display.register(p, refs);
    return refs;
  };
  return { display, summary, bind, at: ms => { timestamp = ms; display.update(); } };
}

test('empty projects show zero and stopped projects show their latest session and full total', () => {
  const f = fixture();
  const empty = project([]), stopped = project([block(0, 20), block(30, 50)]);
  f.display.reset([empty, stopped], f.summary);
  const e = f.bind(empty), s = f.bind(stopped);
  assert.equal(e.session.textContent, '0');
  assert.equal(e.total.textContent, '0');
  assert.equal(s.session.textContent, '20');
  assert.equal(s.total.textContent, '40');
  assert.deepEqual(s.history.map(node => node.textContent), ['20', '20']);
  assert.equal(f.display.isRunning(), false);
  f.at(900000);
  assert.equal(s.total.writes, 1);
});

test('independent running clocks use cached completed totals and update only changed seconds', () => {
  const f = fixture();
  const a = project([block(0, 20), block(80, null)]), b = project([block(90, null)]);
  f.display.reset([a, b], f.summary);
  const ar = f.bind(a), br = f.bind(b);
  assert.equal(ar.total.textContent, '40');
  assert.equal(br.total.textContent, '10');
  f.at(100500);
  assert.equal(ar.session.writes, 1);
  assert.equal(ar.total.writes, 1);
  f.at(101000);
  assert.equal(ar.session.textContent, '21');
  assert.equal(ar.total.textContent, '41');
  assert.equal(ar.history[1].textContent, '21');
  assert.equal(ar.history[0].writes, 1);
  assert.equal(br.total.textContent, '11');
  assert.equal(f.summary.writes, 1);
});

test('refreshes do not read project history or parse timestamps after registration', () => {
  const f = fixture();
  const p = project([block(0, 20), block(80, null)]);
  f.display.reset([p], f.summary);
  const refs = f.bind(p);
  Object.defineProperty(p, 'blocks', { get() { throw new Error('History read during refresh'); } });
  const parse = Date.parse;
  try {
    Date.parse = () => { throw new Error('Timestamp parsed during refresh'); };
    f.at(102000);
  } finally { Date.parse = parse; }
  assert.equal(refs.total.textContent, '42');
});

test('rebuilding after edit, addition and deletion recalculates totals without retaining old elements', () => {
  const f = fixture();
  let old;
  for (const [blocks, total] of [
    [[block(0, 20), block(80, null)], '40'],
    [[block(0, 25), block(80, 100)], '45'],
    [[block(0, 25), block(30, 40), block(80, 100)], '55'],
    [[block(30, 40), block(80, 100)], '30']
  ]) {
    const p = project(blocks);
    f.display.reset([p], f.summary);
    const refs = f.bind(p);
    assert.equal(refs.total.textContent, total);
    const writes = old?.total.writes;
    f.at(100000);
    if (old) assert.equal(old.total.writes, writes);
    old = refs;
  }
  assert.equal(f.display.isRunning(), false);
});

test('collapsed running projects count toward status without needing timer elements', () => {
  const f = fixture();
  f.display.reset([project([block(80, null)]), project([])], f.summary);
  assert.equal(f.display.isRunning(), true);
  assert.equal(f.summary.textContent, '2 projects · 1 running');
  assert.doesNotThrow(() => f.at(120000));
  f.display.reset([], f.summary);
  assert.equal(f.display.isRunning(), false);
  assert.equal(f.summary.textContent, 'Your time, project by project.');
});

test('restoring catches up from wall clock and backwards clock adjustments never produce negative durations', () => {
  const f = fixture();
  const p = project([block(0, 20), block(80, null)]);
  f.display.reset([p], f.summary);
  const refs = f.bind(p);
  f.at(200000);
  assert.equal(refs.session.textContent, '120');
  assert.equal(refs.total.textContent, '140');
  f.at(70000);
  assert.equal(refs.session.textContent, '0');
  assert.equal(refs.total.textContent, '20');
});

test('reusing a card binding after another project changes does not rescan or reparse its history', () => {
  const f = fixture();
  const p = project([block(0, 20), block(80, null)]);
  f.display.reset([p], f.summary);
  const refs = f.bind(p);
  f.display.reset([p], f.summary);
  const parse = Date.parse;
  try {
    Date.parse = () => { throw new Error('Unchanged card reparsed'); };
    f.display.register(p, refs);
    f.at(103000);
  } finally { Date.parse = parse; }
  assert.equal(refs.total.textContent, '43');
});

test('paged history uses absolute indices and updates the running row only when that page is visible', () => {
  const f = fixture();
  const p = project([block(0, 20), block(30, 50), block(80, null)]);
  f.display.reset([p], f.summary);
  const completed = cell(), running = cell();
  const refs = { session: cell(), total: cell(), history: new Map([[1, completed], [2, running]]) };
  f.display.register(p, refs);
  f.at(104000);
  assert.equal(completed.textContent, '20');
  assert.equal(completed.writes, 1);
  assert.equal(running.textContent, '24');
  assert.equal(refs.total.textContent, '64');
});
