// Session focus affects presentation only; saved project collapse states stay
// untouched, including when timers or names are updated while history is open.
(() => {
  function createSessionView() {
    let active = null;
    return {
      toggle(id) { active = active === id ? null : id; },
      close() { active = null; },
      isOpen(id) { return active === id; },
      isCollapsed(project) { return active === null ? project.collapsed : project.id !== active; },
      sync(projects) { if (active !== null && !projects.some(project => project.id === active)) active = null; }
    };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { createSessionView };
  else globalThis.SessionView = { createSessionView };
})();
