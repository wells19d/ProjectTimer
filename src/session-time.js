// These helpers are shared by the history renderer and its Node tests.
(() => {
  const pad = (value, length = 2) => String(value).padStart(length, '0');
  function localInput(timestamp) {
    const date = new Date(timestamp);
    return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
  }
  function fromLocalInput(value) {
    const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(value);
    if (!parts) throw new Error('Enter a complete date and time.');
    const date = new Date(value);
    const expected = parts.slice(1, 7).map(part => Number(part || 0));
    const milliseconds = Number((parts[7] || '').padEnd(3, '0'));
    const actual = [date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds()];
    if (!Number.isFinite(date.getTime()) || actual.some((part, index) => part !== expected[index]) || date.getMilliseconds() !== milliseconds) {
      throw new Error('This local date/time does not exist. Check the date and daylight-saving time.');
    }
    return date.toISOString();
  }
  function minuteInput(timestamp) { return localInput(timestamp).slice(0, 16); }
  function duration(milliseconds) {
    const seconds = Math.max(0, Math.floor(milliseconds / 1000));
    return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(value => pad(value)).join(':');
  }
  const api = { localInput, minuteInput, fromLocalInput, duration };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalThis.SessionTime = api;
})();
