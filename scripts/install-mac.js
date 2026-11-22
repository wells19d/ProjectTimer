const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { upgradeDataFile } = require('../src/store');

function assertAppClosed(bundle, listProcesses = () => execFileSync('/bin/ps', ['-axww', '-o', 'comm='], { encoding: 'utf8' })) {
  if (!fs.existsSync(bundle)) return;
  const prefix = `${path.resolve(bundle)}${path.sep}Contents${path.sep}`;
  const running = listProcesses().split('\n').some(command => command.trim().startsWith(prefix));
  if (running) throw new Error('Project Timer is still running. Quit it with ⌘Q, then run yarn build:mac again.');
}

function signBundle(bundle) {
  execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', bundle], { stdio: 'pipe' });
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle], { stdio: 'pipe' });
}

function preserveInstalledData(destination, next, copy, upgrade = upgradeDataFile) {
  const oldApp = path.join(destination, 'Contents', 'Resources', 'app');
  const newApp = path.join(next, 'Contents', 'Resources', 'app');
  const target = path.join(newApp, 'data');
  const internal = path.join(oldApp, 'data');
  let existing = internal;

  // Recover the store from the short-lived build that incorrectly pointed to
  // an external development folder, only when no installed store exists.
  const oldConfig = path.join(oldApp, 'desktop-config.json');
  if (!fs.existsSync(path.join(internal, 'projects.json')) && fs.existsSync(oldConfig)) {
    const config = JSON.parse(fs.readFileSync(oldConfig, 'utf8'));
    if (typeof config.dataDirectory === 'string' && path.isAbsolute(config.dataDirectory)) existing = config.dataDirectory;
  }

  // Discard any accidental build-time sample data, never installed user data.
  fs.rmSync(target, { recursive: true, force: true });
  fs.rmSync(path.join(newApp, 'desktop-config.json'), { force: true });
  if (fs.existsSync(existing) && fs.existsSync(destination)) {
    copy(existing, target);
    for (const name of ['projects.json', 'heartbeat.json']) {
      const original = path.join(existing, name);
      if (fs.existsSync(original) && (!fs.existsSync(path.join(target, name)) ||
          !fs.readFileSync(original).equals(fs.readFileSync(path.join(target, name))))) {
        throw new Error(`The installed ${name} could not be preserved. The old app has not been replaced.`);
      }
    }
  } else {
    fs.mkdirSync(target, { recursive: true });
  }

  const projects = path.join(target, 'projects.json');
  if (fs.existsSync(projects)) upgrade(projects);
  // Data conversions happen in the staged copy. The old installation remains
  // untouched if preservation, migration, validation, or signing fails.
}

function installMacApp(source, applications = '/Applications', copy = (from, to) => execFileSync('/usr/bin/ditto', [from, to]), options = {}) {
  const destination = path.join(applications, 'Project Timer.app');
  const checkClosed = options.checkClosed || assertAppClosed;
  const sign = options.sign || signBundle;
  if (fs.existsSync(destination)) {
    let ours = false;
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(destination, 'Contents', 'Resources', 'app', 'package.json'), 'utf8'));
      ours = !fs.lstatSync(destination).isSymbolicLink() && manifest.name === 'project-timer';
    } catch { /* Leave an unrelated app at the same path alone. */ }
    if (!ours) throw new Error(`${destination} already exists and is not a recognized Project Timer build.`);
    checkClosed(destination);
  }

  // Complete and verify the new installation before renaming the old one.
  const staging = fs.mkdtempSync(path.join(applications, '.project-timer-install-'));
  const next = path.join(staging, 'Project Timer.app');
  const previous = path.join(staging, 'previous.app');
  let preserveBackup = false;
  try {
    copy(source, next);
    if (!fs.existsSync(path.join(next, 'Contents', 'Resources', 'app', 'package.json'))) {
      throw new Error('The new app was not copied completely. The installed app has not been replaced.');
    }
    if (fs.existsSync(destination)) {
      checkClosed(destination);
      preserveInstalledData(destination, next, copy, options.upgrade || upgradeDataFile);
      sign(next);
      // Catch an app relaunched while the replacement was being prepared.
      checkClosed(destination);
      fs.renameSync(destination, previous);
    } else {
      preserveInstalledData(destination, next, copy, options.upgrade || upgradeDataFile);
      sign(next);
    }
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

module.exports = { installMacApp, assertAppClosed };
