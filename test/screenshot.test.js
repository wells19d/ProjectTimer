const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { saveScreenshot } = require('../src/screenshot');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'timer-screenshot-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const bytes = Buffer.from('real capture bytes');
  let captured = false;
  const window = {
    isDestroyed: () => false,
    webContents: { capturePage: async () => {
      captured = true;
      return { isEmpty: () => false, toPNG: () => bytes };
    } }
  };
  const file = path.join(directory, 'screenshot.png');
  const dialog = { showSaveDialog: async (parent, options) => {
    assert.equal(parent, window);
    assert.equal(captured, true, 'capture must happen before the save sheet opens');
    assert.deepEqual(options.filters, [{ name: 'PNG image', extensions: ['png'] }]);
    return { canceled: false, filePath: file };
  } };
  return { directory, bytes, window, dialog, file, defaultDirectory: directory };
}

test('saves the native capture after the user chooses a location', async t => {
  const f = fixture(t);
  assert.equal(await saveScreenshot(f), f.file);
  assert.deepEqual(fs.readFileSync(f.file), f.bytes);
});

test('canceling the save dialog writes no screenshot', async t => {
  const f = fixture(t);
  f.dialog.showSaveDialog = async () => ({ canceled: true });
  assert.equal(await saveScreenshot(f), null);
  assert.deepEqual(fs.readdirSync(f.directory), []);
});

test('capture errors do not open a save dialog or create files', async t => {
  const f = fixture(t);
  f.window.webContents.capturePage = async () => { throw new Error('Capture failed'); };
  f.dialog.showSaveDialog = async () => assert.fail('Save dialog should not open');
  await assert.rejects(saveScreenshot(f), /Capture failed/);
  assert.deepEqual(fs.readdirSync(f.directory), []);
});

test('a stalled native capture times out instead of waiting forever', async t => {
  const f = fixture(t);
  f.window.webContents.capturePage = () => new Promise(() => {});
  await assert.rejects(saveScreenshot({ ...f, timeoutMs: 10 }), /took too long/);
  assert.deepEqual(fs.readdirSync(f.directory), []);
});

test('an empty capture cannot be saved', async t => {
  const f = fixture(t);
  f.window.webContents.capturePage = async () => ({ isEmpty: () => true });
  await assert.rejects(saveScreenshot(f), /could not be captured/);
});

test('adds a PNG extension so selecting another filename does not overwrite a different file type', async t => {
  const f = fixture(t);
  const json = path.join(f.directory, 'projects.json');
  fs.writeFileSync(json, '{"version":1,"projects":[]}');
  f.dialog.showSaveDialog = async () => ({ canceled: false, filePath: json });
  assert.equal(await saveScreenshot(f), `${json}.png`);
  assert.equal(fs.readFileSync(json, 'utf8'), '{"version":1,"projects":[]}');
});

test('file-write errors are reported to the caller', async t => {
  const f = fixture(t);
  f.dialog.showSaveDialog = async () => ({ canceled: false, filePath: path.join(f.directory, 'missing', 'screenshot.png') });
  await assert.rejects(saveScreenshot(f), { code: 'ENOENT' });
});
