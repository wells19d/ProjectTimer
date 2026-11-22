const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

function timestamp(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
}

function validate(data) {
  if (!data || data.version !== 1 || !Array.isArray(data.projects)) {
    throw new Error('Expected version: 1 and a projects array.');
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

class TimerStore {
  constructor(directory, now = () => new Date()) {
    this.directory = directory;
    this.file = path.join(directory, 'projects.json');
    this.heartbeatFile = path.join(directory, 'heartbeat.json');
    this.now = now;
    this.recovered = 0;
    fs.mkdirSync(directory, { recursive: true });
    this.data = fs.existsSync(this.file)
      ? validate(JSON.parse(fs.readFileSync(this.file, 'utf8')))
      : { version: 1, projects: [] };
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

  change(operation) {
    const next = this.snapshot();
    operation(next);
    validate(next);
    // Save the heartbeat first so a newly persisted active block has a recovery timestamp.
    atomicWrite(this.heartbeatFile, { lastSeenAt: this.now().toISOString() });
    atomicWrite(this.file, next);
    this.data = next;
    return this.snapshot();
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

  update(id, action, value) {
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
            const start = Math.max(this.now().getTime(), last ? Date.parse(last.end) : 0);
            project.blocks.push({ start: new Date(start).toISOString(), end: null });
          }
          break;
        case 'stop':
          if (last && last.end === null) last.end = new Date(Math.max(this.now().getTime(), Date.parse(last.start))).toISOString();
          break;
        case 'delete': data.projects = data.projects.filter(item => item.id !== id); break;
        default: throw new Error('Unknown timer action.');
      }
    });
  }

  heartbeat() {
    if (this.data.projects.some(project => project.blocks.at(-1)?.end === null)) {
      atomicWrite(this.heartbeatFile, { lastSeenAt: this.now().toISOString() });
    }
  }

  stopAll() {
    if (!this.data.projects.some(project => project.blocks.at(-1)?.end === null)) return this.snapshot();
    return this.change(data => {
      const now = this.now().getTime();
      for (const project of data.projects) {
        const block = project.blocks.at(-1);
        if (block && block.end === null) block.end = new Date(Math.max(now, Date.parse(block.start))).toISOString();
      }
    });
  }
}

module.exports = { TimerStore, validate, atomicWrite };
