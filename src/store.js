const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { CURRENT_DATA_VERSION, migrateData } = require('./data-version');

function timestamp(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
}

function validate(data) {
  if (!data || data.version !== CURRENT_DATA_VERSION || !Array.isArray(data.projects)) {
    throw new Error(`Expected version: ${CURRENT_DATA_VERSION} and a projects array.`);
  }
  const ids = new Set();
  for (const project of data.projects) {
    if (!project || typeof project.id !== 'string' || !project.id || ids.has(project.id)) {
      throw new Error('Each project must have a unique, nonempty id.');
    }
    ids.add(project.id);
    if (typeof project.name !== 'string' || !project.name.trim() || project.name.length > 120 ||
        typeof project.collapsed !== 'boolean' || !Array.isArray(project.blocks)) {
      throw new Error('Each project needs a name (1–120 characters), collapsed boolean, and blocks array.');
    }
    let previousEnd = -Infinity;
    for (const [index, block] of project.blocks.entries()) {
      if (!block || !timestamp(block.start) || (block.end !== null && !timestamp(block.end))) {
        throw new Error(`Invalid start/end timestamp in ${project.name}. Use ISO dates and null for an active end.`);
      }
      const start = Date.parse(block.start);
      const end = block.end === null ? Infinity : Date.parse(block.end);
      if (end < start || start < previousEnd || (end === Infinity && index !== project.blocks.length - 1)) {
        throw new Error(`Blocks in ${project.name} must be chronological, without overlaps, with only the last block allowed to run.`);
      }
      previousEnd = end;
    }
  }
  return data;
}

// Write beside the destination, flush to disk, then rename: a partial write never replaces the JSON.
function atomicWrite(file, data) {
  const temp = `${file}.tmp`;
  let fd;
  try {
    fd = fs.openSync(temp, 'w', 0o600);
    fs.writeFileSync(fd, `${JSON.stringify(data, null, 2)}\n`);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temp, file);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}

// Runtime saves use nonblocking file operations. The synchronous writer remains
// for startup recovery and the standalone installer, before the window is used.
async function atomicWriteAsync(file, data) {
  const temp = `${file}.tmp`;
  let handle;
  let opened = false;
  try {
    handle = await fs.promises.open(temp, 'w', 0o600);
    opened = true;
    await handle.writeFile(`${JSON.stringify(data, null, 2)}\n`);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fs.promises.rename(temp, file);
  } finally {
    if (handle) await handle.close();
    if (opened) await fs.promises.unlink(temp).catch(error => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}

class TimerStore {
  constructor(directory, now = () => new Date()) {
    this.directory = directory;
    this.file = path.join(directory, 'projects.json');
    this.heartbeatFile = path.join(directory, 'heartbeat.json');
    this.now = now;
    this.recovered = 0;
    this.pending = Promise.resolve();
    fs.mkdirSync(directory, { recursive: true });
    this.data = fs.existsSync(this.file)
      ? upgradeDataFile(this.file)
      : { version: CURRENT_DATA_VERSION, projects: [] };
    let lastSeen = null;
    if (fs.existsSync(this.heartbeatFile)) {
      try {
        const heartbeat = JSON.parse(fs.readFileSync(this.heartbeatFile, 'utf8'));
        if (timestamp(heartbeat.lastSeenAt)) lastSeen = Date.parse(heartbeat.lastSeenAt);
      } catch { /* Missing or damaged heartbeat: recover at start instead of inventing time. */ }
    }
    for (const project of this.data.projects) {
      const block = project.blocks.at(-1);
      if (block && block.end === null) {
        block.end = new Date(Math.max(Date.parse(block.start), Math.min(lastSeen ?? Date.parse(block.start), this.now().getTime()))).toISOString();
        this.recovered++;
      }
    }
    if (this.recovered || !fs.existsSync(this.file)) atomicWrite(this.file, this.data);
  }

  snapshot() { return structuredClone(this.data); }

  // Every runtime write, including heartbeat and close, shares one queue. A
  // failed write rejects its caller without poisoning later saves or retries.
  enqueue(operation) {
    const task = this.pending.then(operation);
    this.pending = task.catch(() => {});
    return task;
  }

  flush() { return this.pending; }

  hasRunning() { return this.data.projects.some(project => project.blocks.at(-1)?.end === null); }

  change(operation) {
    return this.enqueue(async () => {
      const next = this.snapshot();
      if (operation(next) === false) return this.snapshot();
      validate(next);
      // A removed folder must not discard history still held in memory.
      await fs.promises.mkdir(this.directory, { recursive: true });
      // Persist recovery before an active block. Publish the in-memory change
      // only after the complete project file has been safely replaced.
      await atomicWriteAsync(this.heartbeatFile, { lastSeenAt: this.now().toISOString() });
      await atomicWriteAsync(this.file, next);
      this.data = next;
      return this.snapshot();
    });
  }

  create(name) {
    return this.change(data => data.projects.push({ id: randomUUID(), name: this.name(name), collapsed: false, blocks: [] }));
  }

  name(value) {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 120) {
      throw new Error('Enter a project name between 1 and 120 characters.');
    }
    return value.trim();
  }

  editSession(id, index, changes) {
    return this.change(data => {
      const project = data.projects.find(item => item.id === id);
      if (!project) throw new Error('This project no longer exists.');
      if (project.blocks.some(block => block.end === null)) {
        throw new Error('Stop this project’s timer before editing any of its sessions.');
      }
      if (!Number.isInteger(index) || index < 0 || index >= project.blocks.length) {
        throw new Error('Choose an existing session to edit.');
      }
      if (!changes || !timestamp(changes.start) || !timestamp(changes.end)) {
        throw new Error('Enter a valid start and end date/time.');
      }
      const start = Date.parse(changes.start);
      const end = Date.parse(changes.end);
      if (end < start) throw new Error('The end must be at or after the start.');
      if (index > 0 && start < Date.parse(project.blocks[index - 1].end)) {
        throw new Error('The start cannot be before the previous session ends.');
      }
      if (index + 1 < project.blocks.length && end > Date.parse(project.blocks[index + 1].start)) {
        throw new Error('The end cannot be after the next session starts.');
      }
      project.blocks[index] = {
        ...project.blocks[index], start: new Date(start).toISOString(), end: new Date(end).toISOString()
      };
    });
  }

  deleteSession(id, index) {
    return this.change(data => {
      const project = data.projects.find(item => item.id === id);
      if (!project) throw new Error('This project no longer exists.');
      if (project.blocks.some(block => block.end === null)) {
        throw new Error('Stop this project’s timer before deleting any of its sessions.');
      }
      if (!Number.isInteger(index) || index < 0 || index >= project.blocks.length) {
        throw new Error('Choose an existing session to delete.');
      }
      project.blocks.splice(index, 1);
    });
  }

  addSession(id, times) {
    return this.change(data => {
      const project = data.projects.find(item => item.id === id);
      if (!project) throw new Error('This project no longer exists.');
      if (project.blocks.some(block => block.end === null)) {
        throw new Error('Stop this project’s timer before adding a session.');
      }
      if (!times || !timestamp(times.start) || !timestamp(times.end)) {
        throw new Error('Enter a valid start and end date/time.');
      }
      const start = Date.parse(times.start);
      const end = Date.parse(times.end);
      if (end <= start) throw new Error('The end must be after the start.');
      const conflict = project.blocks.findIndex(block => start < Date.parse(block.end) && end > Date.parse(block.start));
      if (conflict !== -1) {
        throw new Error(`This overlaps session ${conflict + 1}. Edit the existing session or choose a different time range.`);
      }
      const next = project.blocks.findIndex(block => Date.parse(block.start) > start);
      project.blocks.splice(next === -1 ? project.blocks.length : next, 0, {
        start: new Date(start).toISOString(), end: new Date(end).toISOString()
      });
    });
  }

  update(id, action, value) {
    const requestedAt = this.now().getTime();
    return this.change(data => {
      const project = data.projects.find(item => item.id === id);
      if (!project) throw new Error('This project no longer exists.');
      const last = project.blocks.at(-1);
      switch (action) {
        case 'rename': project.name = this.name(value); break;
        case 'collapse':
          if (typeof value !== 'boolean') throw new Error('Invalid collapse state.');
          project.collapsed = value;
          break;
        case 'start':
          if (!last || last.end !== null) {
            const start = Math.max(requestedAt, last ? Date.parse(last.end) : 0);
            project.blocks.push({ start: new Date(start).toISOString(), end: null });
          } else return false;
          break;
        case 'stop':
          if (last && last.end === null) last.end = new Date(Math.max(requestedAt, Date.parse(last.start))).toISOString();
          else return false;
          break;
        case 'delete': data.projects = data.projects.filter(item => item.id !== id); break;
        default: throw new Error('Unknown timer action.');
      }
    });
  }

  heartbeat() {
    return this.enqueue(async () => {
      if (!this.hasRunning()) return false;
      await fs.promises.mkdir(this.directory, { recursive: true });
      try { await fs.promises.access(this.file); }
      catch (error) {
        if (error.code !== 'ENOENT') throw error;
        await atomicWriteAsync(this.file, this.data);
      }
      await atomicWriteAsync(this.heartbeatFile, { lastSeenAt: this.now().toISOString() });
      return true;
    });
  }

  stopAll() {
    const requestedAt = this.now().getTime();
    // Check inside the queue: a Play request may still be saving when close is
    // requested. The final stop must include it and wait for earlier saves.
    return this.change(data => {
      if (!data.projects.some(project => project.blocks.at(-1)?.end === null)) return false;
      for (const project of data.projects) {
        const block = project.blocks.at(-1);
        if (block && block.end === null) block.end = new Date(Math.max(requestedAt, Date.parse(block.start))).toISOString();
      }
    });
  }
}

function upgradeDataFile(file, { targetVersion = CURRENT_DATA_VERSION, migrations, validateData = validate } = {}) {
  const original = fs.readFileSync(file, 'utf8');
  const parsed = JSON.parse(original);
  const migrated = migrateData(parsed, { targetVersion, migrations });
  validateData(migrated);
  if (parsed.version !== migrated.version) {
    const backup = `${file}.v${parsed.version}.${randomUUID()}.backup.json`;
    fs.writeFileSync(backup, original, { flag: 'wx', mode: 0o600 });
    atomicWrite(file, migrated);
  }
  return migrated;
}

module.exports = { TimerStore, validate, atomicWrite, atomicWriteAsync, upgradeDataFile };
