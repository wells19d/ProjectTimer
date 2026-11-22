// Controls display refreshes only. Recorded time and recovery saving are
// independent of this loop and continue while the window is hidden.
(() => {
  function createDisplayScheduler({
    update, isRunning, isVisible,
    schedule = (callback, delay) => globalThis.setInterval(callback, delay),
    cancel = id => globalThis.clearInterval(id)
  }) {
    let interval = null;
    let disposed = false;

    function sync({ refresh = false } = {}) {
      if (disposed) return;
      const visible = isVisible();
      const running = isRunning();
      if ((!visible || !running) && interval !== null) {
        cancel(interval);
        interval = null;
      }
      if (visible && refresh) update();
      if (visible && running && interval === null) {
        interval = schedule(() => {
          // Recheck before painting in case state changed before its event was
          // delivered. Do not catch up by replaying missed refresh callbacks.
          if (disposed) return;
          if (!isVisible() || !isRunning()) { sync(); return; }
          update();
        }, 500);
      }
    }

    function dispose() {
      disposed = true;
      if (interval !== null) cancel(interval);
      interval = null;
    }

    return { sync, dispose };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { createDisplayScheduler };
  else globalThis.DisplayScheduler = { createDisplayScheduler };
})();
