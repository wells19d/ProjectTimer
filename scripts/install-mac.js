const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { resolveDataDirectory } = require('../src/data-directory');

function preserveLegacyData(source, destination, copy) {
  const legacy = path.join(destination, 'Contents', 'Resources', 'app', 'data');
  if (!fs.existsSync(path.join(legacy, 'projects.json'))) return;
  const dataDirectory = resolveDataDirectory({ appDirectory: path.join(source, 'Contents', 'Resources', 'app'), packaged: true });
  const relative = path.relative(destination, dataDirectory);
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    throw new Error('The new data folder must be outside the installed application.');
  }
  fs.mkdirSync(dataDirectory, { recursive: true });
  const backup = fs.mkdtempSync(path.join(dataDirectory, 'legacy-app-backup-'));
  copy(legacy, backup);
  const target = path.join(dataDirectory, 'projects.json');
  // Preserve existing external history. An empty external store can safely
  // receive the old app's history, with its matching recovery heartbeat.
  const needsImport = !fs.existsSync(target) || JSON.parse(fs.readFileSync(target, 'utf8')).projects?.length === 0;
  if (needsImport) {
    for (const name of ['projects.json', 'heartbeat.json']) {
      if (fs.existsSync(path.join(legacy, name))) fs.copyFileSync(path.join(legacy, name), path.join(dataDirectory, name));
    }
  }
  console.log(`Preserved old app data: ${backup}`);
}

function installMacApp(source, applications = '/Applications', copy = (from, to) => execFileSync('/usr/bin/ditto', [from, to])) {
  const destination = path.join(applications, 'Project Timer.app');
  if (fs.existsSync(destination)) {
    let ours = false;
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(destination, 'Contents', 'Resources', 'app', 'package.json'), 'utf8'));
      ours = !fs.lstatSync(destination).isSymbolicLink() && manifest.name === 'project-timer';
    } catch { /* Leave an unrelated app at the same path alone. */ }
    if (!ours) throw new Error(`${destination} already exists and is not a recognized Project Timer build.`);
  }

  // Copy completely before replacing an existing install. Both renames stay on
  // the Applications volume, and a failed replacement restores the old app.
  const staging = fs.mkdtempSync(path.join(applications, '.project-timer-install-'));
  const next = path.join(staging, 'Project Timer.app');
  const previous = path.join(staging, 'previous.app');
  let preserveBackup = false;
  try {
    copy(source, next);
    preserveLegacyData(source, destination, copy);
    if (fs.existsSync(destination)) fs.renameSync(destination, previous);
    try {
      fs.renameSync(next, destination);
    } catch (error) {
      if (fs.existsSync(previous)) {
        try { fs.renameSync(previous, destination); }
        catch (restoreError) {
          preserveBackup = true;
          throw new Error(`Could not restore the old app: ${restoreError.message}. It is preserved at ${previous}.`);
        }
      }
      throw error;
    }
    return destination;
  } finally {
    if (!preserveBackup) fs.rmSync(staging, { recursive: true, force: true });
  }
}

module.exports = { installMacApp };
