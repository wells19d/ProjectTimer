// Cache totals and element references when cards are built. Refreshes touch only
// running clocks; completed history never needs scanning on a display tick.
(() => {
  function createClockDisplay({ formatTime, now = () => Date.now() }) {
    let running = [];
    let active = 0;
    // A binding belongs to one immutable card/model. Reusing cards avoids
    // rescanning their history; removed cards can be garbage-collected.
    const bindings = new WeakMap();

    function write(node, milliseconds) {
      if (!node) return;
      const text = formatTime(milliseconds);
      if (node.textContent !== text) node.textContent = text;
    }

    function reset(projects, summary) {
      running = [];
      active = projects.filter(project => project.blocks.at(-1)?.end === null).length;
      const text = projects.length
        ? `${projects.length} ${projects.length === 1 ? 'project' : 'projects'} · ${active ? `${active} running` : 'All timers stopped'}`
        : 'Your time, project by project.';
      if (summary.textContent !== text) summary.textContent = text;
    }

    function paint(clock, timestamp) {
      const elapsed = Math.max(0, timestamp - clock.start);
      write(clock.session, elapsed);
      write(clock.total, clock.completed + elapsed);
      write(clock.history, elapsed);
    }

    function register(project, refs) {
      const { session, total, history = [] } = refs;
      const timestamp = now();
      let clock = bindings.get(refs);
      if (!clock) {
        const historyAt = index => history instanceof Map ? history.get(index) : history[index];
        let completed = 0;
        let latest = 0;
        let start = null;
        for (const [index, block] of project.blocks.entries()) {
          const startTime = Date.parse(block.start);
          latest = Math.max(0, (block.end === null ? timestamp : Date.parse(block.end)) - startTime);
          if (block.end === null) start = startTime;
          else completed += latest;
          write(historyAt(index), latest);
        }
        clock = { session, total, completed, start, history: historyAt(project.blocks.length - 1) };
        bindings.set(refs, clock);
        if (start === null) {
          write(session, latest);
          write(total, completed);
        }
      }
      if (clock.start !== null) {
        running.push(clock);
        paint(clock, timestamp);
      }
    }

    function update() {
      const timestamp = now();
      for (const clock of running) paint(clock, timestamp);
    }

    return { reset, register, update, isRunning: () => active > 0 };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { createClockDisplay };
  else globalThis.ClockDisplay = { createClockDisplay };
})();
