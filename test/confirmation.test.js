const { test } = require('node:test');
const assert = require('node:assert/strict');
const { confirmDelete } = require('../src/confirmation');

class Dialog extends EventTarget {
  open = false;
  returnValue = '';
  showModal() { this.open = true; }
  close(value) {
    if (value !== undefined) this.returnValue = value;
    this.open = false;
    this.dispatchEvent(new Event('close'));
  }
}

function fixture() {
  const dialog = new Dialog();
  let focused = false;
  const cancel = { focus: () => { focused = true; } };
  return { dialog, cancel, focused: () => focused };
}

test('in-app confirmation focuses Cancel and requires an explicit Delete response', async () => {
  const { dialog, cancel, focused } = fixture();
  const result = confirmDelete(dialog, cancel);
  assert.equal(dialog.open, true);
  assert.equal(focused(), true);
  dialog.close('delete');
  assert.equal(await result, true);
});

test('Cancel and Escape-style dismissal both keep the data', async () => {
  const { dialog, cancel } = fixture();
  let result = confirmDelete(dialog, cancel);
  dialog.close('cancel');
  assert.equal(await result, false);
  result = confirmDelete(dialog, cancel);
  dialog.close();
  assert.equal(await result, false);
});

test('a previous Delete response cannot carry over to the next confirmation', async () => {
  const { dialog, cancel } = fixture();
  let result = confirmDelete(dialog, cancel);
  dialog.close('delete');
  assert.equal(await result, true);
  result = confirmDelete(dialog, cancel);
  dialog.close();
  assert.equal(await result, false);
});

test('a second request cannot bypass an already open confirmation', async () => {
  const { dialog, cancel } = fixture();
  const first = confirmDelete(dialog, cancel);
  assert.equal(await confirmDelete(dialog, cancel), false);
  dialog.close('cancel');
  assert.equal(await first, false);
});

test('a dialog that cannot open reports the failure instead of confirming deletion', async () => {
  const { dialog, cancel } = fixture();
  dialog.showModal = () => { throw new Error('Unable to open'); };
  await assert.rejects(confirmDelete(dialog, cancel), /Unable to open/);
});
