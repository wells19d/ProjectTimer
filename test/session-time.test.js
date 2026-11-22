const { test } = require('node:test');
const assert = require('node:assert/strict');
const { localInput, minuteInput, fromLocalInput, duration } = require('../src/session-time');

process.env.TZ = 'America/Chicago';

test('local session fields round-trip UTC times without losing seconds or milliseconds', () => {
  const timestamp = '2026-11-22T15:12:34.567Z';
  assert.equal(localInput(timestamp), '2026-11-22T09:12:34.567');
  assert.equal(fromLocalInput(localInput(timestamp)), timestamp);
  assert.equal(fromLocalInput('2026-11-22T09:12'), '2026-11-22T15:12:00.000Z');
});

test('local edits reject missing, impossible and daylight-saving-skipped times', () => {
  for (const value of ['', 'bad', '2026-02-30T09:00', '2026-03-08T02:30']) {
    assert.throws(() => fromLocalInput(value));
  }
});

test('session durations retain full hours beyond one day', () => {
  assert.equal(duration(100 * 3600000 + 61000), '100:01:01');
  assert.equal(duration(-1000), '00:00:00');
});

test('minute-only edit fields use hour and minute input values', () => {
  const original = '2026-11-22T15:12:34.567Z';
  assert.equal(minuteInput(original), '2026-11-22T09:12');
  assert.equal(fromLocalInput(minuteInput(original)), '2026-11-22T15:12:00.000Z');
});
