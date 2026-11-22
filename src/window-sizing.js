// Automatic fitting owns the height only until the user adjusts the window.
// Keep the decision in the main process so already queued resize requests cannot
// override a drag that has just started.
function createAutoSizer(window, screen, { minimumHeight = 220 } = {}) {
  let automatic = true;
  let applyingSize = false;
  let expected = window.getBounds();
  window.on('will-resize', () => { automatic = false; });
  window.on('will-move', () => { automatic = false; });
  // Some native resize paths do not deliver will-resize. An unexpected size
  // change still hands control to the user before queued fitting can run.
  window.on('resize', () => {
    if (applyingSize || !automatic) return;
    const actual = window.getBounds();
    if (actual.width !== expected.width || actual.height !== expected.height) automatic = false;
  });

  return height => {
    if (!automatic || !Number.isFinite(height) || height <= 0 || window.isDestroyed() ||
        window.isMaximized() || window.isFullScreen()) return;
    const bounds = window.getBounds();
    const workArea = screen.getDisplayMatching(bounds).workArea;
    const [, contentHeight] = window.getContentSize();
    const chrome = bounds.height - contentHeight;
    const maximum = workArea.height - 32;
    const desired = Math.min(maximum, Math.max(minimumHeight, Math.ceil(height) + chrome));
    const y = Math.max(workArea.y, Math.min(bounds.y, workArea.y + workArea.height - desired));
    if (bounds.height === desired && bounds.y === y) return;
    applyingSize = true;
    try {
      expected = { ...bounds, height: desired };
      // A size change should not start a native window move. Reposition only
      // when fitting actually needs room at the bottom of the display.
      if (bounds.height !== desired) window.setSize(bounds.width, desired, false);
      if (bounds.y !== y) window.setPosition(bounds.x, y, false);
      expected = window.getBounds();
    } finally {
      applyingSize = false;
    }
  };
}

module.exports = { createAutoSizer };
