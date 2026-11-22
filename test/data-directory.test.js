const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveDataDirectory } = require('../src/data-directory');

test('development keeps the original project data folder', () => {
  assert.equal(resolveDataDirectory({ appDirectory: '/workspace/ProjectTimer', packaged: false }), '/workspace/ProjectTimer/data');
});

test('packaged apps read and keep their external JSON folder even when the app moves', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'timer-bundle-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const external = path.join(root, 'original-project', 'data');
  const bundle = path.join(root, 'Project Timer.app');
  fs.mkdirSync(bundle);
  fs.writeFileSync(path.join(bundle, 'desktop-config.json'), JSON.stringify({ dataDirectory: external }));
  assert.equal(resolveDataDirectory({ appDirectory: bundle, packaged: true }), external);
  assert.equal(resolveDataDirectory({ appDirectory: bundle, packaged: false }), external, 'desktop config must win even when Electron reports an unpackaged runtime');
  const moved = path.join(root, 'moved.app');
  fs.renameSync(bundle, moved);
  assert.equal(resolveDataDirectory({ appDirectory: moved, packaged: true }), external);
  assert.equal(fs.existsSync(external), false, 'resolving a path must not modify existing project data');
});

test('environment overrides work for both development and desktop builds', () => {
  for (const packaged of [true, false]) {
    assert.equal(resolveDataDirectory({ appDirectory: '/unused', packaged, override: '/custom/timer-data' }), '/custom/timer-data');
  }
});

test('invalid desktop configuration fails instead of silently saving inside the app', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'timer-config-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const dataDirectory of ['data', null, 42]) {
    fs.writeFileSync(path.join(root, 'desktop-config.json'), JSON.stringify({ dataDirectory }));
    assert.throws(() => resolveDataDirectory({ appDirectory: root, packaged: true }), /absolute dataDirectory/);
  }
});
