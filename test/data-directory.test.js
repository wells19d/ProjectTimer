const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveDataDirectory } = require('../src/data-directory');

test('development uses the project data folder', () => {
  assert.equal(resolveDataDirectory({ appDirectory: '/workspace/ProjectTimer', packaged: false }), '/workspace/ProjectTimer/data');
});

test('an installed app uses its own internal data folder without a Desktop dependency', () => {
  const appDirectory = '/Applications/Project Timer.app/Contents/Resources/app';
  for (const packaged of [false, true]) {
    assert.equal(resolveDataDirectory({ appDirectory, packaged }), `${appDirectory}/data`);
  }
});

test('an explicit manual override is still supported', () => {
  assert.equal(resolveDataDirectory({ appDirectory: '/unused', override: '/custom/timer-data' }), '/custom/timer-data');
});
