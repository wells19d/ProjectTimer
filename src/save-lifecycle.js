// Recovery saving is independent of visibility. Idle apps need no heartbeat
// timer, and a slow disk must never accumulate overlapping heartbeat requests.
function createHeartbeat({ store, report, schedule = setTimeout, cancel = clearTimeout }) {
  let timer = null;
  let inFlight = false;
  let paused = false;
  let disposed = false;
  let status = null;

  function reportStatus(message) {
    if (message === status) return;
    status = message;
    report(message);
  }

  function clear() {
    if (timer !== null) cancel(timer);
    timer = null;
  }

  function sync() {
    if (disposed) return;
    if (paused || !store.hasRunning()) {
      clear();
      if (!store.hasRunning()) reportStatus(null);
      return;
    }
    if (timer === null && !inFlight) timer = schedule(tick, 5000);
  }

  async function tick() {
    timer = null;
    if (disposed || paused || !store.hasRunning()) return;
    inFlight = true;
    try {
      await store.heartbeat();
      if (!disposed) reportStatus(null);
    } catch (error) {
      if (!disposed) reportStatus(`Autosave failed: ${error.message}. Your crash-recovery timestamp is not updating.`);
    } finally {
      inFlight = false;
      sync();
    }
  }

  return {
    sync,
    pause() { paused = true; clear(); },
    resume() { paused = false; sync(); },
    dispose() { disposed = true; clear(); }
  };
}

// Electron cannot await a close event. Prevent the first close, drain the save
// queue, then request quit again. A failed save leaves the window usable.
function createCloseGuard({ save, pause, resume, finish, reportError }) {
  let closing = false;
  let complete = false;
  return {
    isClosing: () => closing,
    async handle(event) {
      if (complete) return;
      event.preventDefault();
      if (closing) return;
      closing = true;
      try {
        pause();
        await save();
        complete = true;
        finish();
      } catch (error) {
        closing = false;
        complete = false;
        resume();
        reportError(error);
      }
    }
  };
}

module.exports = { createHeartbeat, createCloseGuard };
